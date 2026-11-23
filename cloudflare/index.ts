import municipalBoundary from "../data/villa-gobernador-galvez.geojson";
import { readJsonBody } from "../supabase/functions/_shared/json-body.ts";
import { createReportDirectoryHandler, isOffset, type TrackingStatus } from "../supabase/functions/report-directory/handler.ts";
import { createReportHandler } from "../supabase/functions/submit-report/handler.ts";
import type { MunicipalBoundary } from "../supabase/functions/submit-report/boundary.ts";
import { createModeratorSession, isModerator, type ModeratorCredentials } from "./moderator.ts";
import { createReportsStore, type ReportsDatabase } from "./reports-store.ts";

interface Environment extends ModeratorCredentials {
  REPORTS_DB: ReportsDatabase;
  ALLOWED_ORIGINS?: string;
}

const boundary: MunicipalBoundary = JSON.parse(municipalBoundary);
const githubPagesOrigin = "https://paginanicor2027-sudo.github.io";
const adminPaths = new Set(["/auth/v1/token", "/rest/v1/report_moderators", "/rest/v1/reports"]);
const reportStatuses: readonly TrackingStatus[] = ["pending_review", "published", "in_progress", "resolved", "rejected"];
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function isReportStatus(value: unknown): value is TrackingStatus {
  return reportStatuses.some((status) => status === value);
}

async function moderate(request: Request, url: URL, env: Environment, allowedOrigins: string[]) {
  const origin = request.headers.get("origin");
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (origin !== null) {
    if (!allowedOrigins.includes(origin)) return respond({ code: "invalid_request" }, 400);
    headers.set("access-control-allow-origin", origin);
  }
  if (request.method === "OPTIONS") {
    headers.set("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, content-type, apikey, prefer");
    return new Response(null, { status: 204, headers });
  }

  try {
    if (url.pathname === "/auth/v1/token") {
      if (request.method !== "POST" || url.searchParams.get("grant_type") !== "password") {
        return respond({ code: "invalid_request" }, 400);
      }
      const login = await readJsonBody(request, 1024);
      if (!login || typeof login !== "object" || !("email" in login) || !("password" in login)) {
        return respond({ code: "invalid_request" }, 400);
      }
      const session = await createModeratorSession(env, login.email, login.password);
      return session ? respond(session) : respond({ code: "invalid_credentials" }, 400);
    }

    if (!await isModerator(env, request.headers.get("authorization"))) {
      return respond({ code: "unauthorized" }, 401);
    }
    if (url.pathname === "/rest/v1/report_moderators" && request.method === "GET") {
      return respond([{ user_id: "moderator" }]);
    }
    if (url.pathname !== "/rest/v1/reports") return respond({ code: "invalid_request" }, 405);

    const store = createReportsStore(env.REPORTS_DB);
    const statusFilter = url.searchParams.get("status");
    const expected = statusFilter?.startsWith("eq.") ? statusFilter.slice(3) : null;

    if (request.method === "GET") {
      const offsetParam = url.searchParams.get("offset") ?? "0";
      const offset = Number(offsetParam);
      if ((statusFilter !== null && !isReportStatus(expected)) || !/^\d+$/.test(offsetParam) || !isOffset(offset)) {
        return respond({ code: "invalid_request" }, 400);
      }
      return respond(await store.listForModeration({ status: expected, offset }));
    }

    if (request.method === "PATCH") {
      const requestFilter = url.searchParams.get("request_id");
      const requestId = requestFilter?.startsWith("eq.") ? requestFilter.slice(3) : "";
      const body = await readJsonBody(request, 1024);
      if (!uuidPattern.test(requestId) || !isReportStatus(expected) ||
        !body || typeof body !== "object" || !("status" in body) || !isReportStatus(body.status)) {
        return respond({ code: "invalid_request" }, 400);
      }
      const result = await store.updateStatus(requestId, expected, body.status);
      return respond(result ? [result] : []);
    }
    return respond({ code: "invalid_request" }, 405);
  } catch {
    return respond({ code: "service_unavailable" }, 503);
  }
}

export default {
  fetch(request: Request, env: Environment) {
    const url = new URL(request.url);
    const allowedOrigins = [githubPagesOrigin, ...(env.ALLOWED_ORIGINS ?? "").split(",")
      .map((origin) => origin.trim()).filter(Boolean)];
    const store = createReportsStore(env.REPORTS_DB);

    switch (url.pathname) {
      case "/api/reclamos":
        return createReportHandler({ allowedOrigins, boundary, store: store.submit })(request);
      case "/api/reclamos-publicados":
        return createReportDirectoryHandler({ allowedOrigins, store: store.directory })(request);
      default:
        if (adminPaths.has(url.pathname)) return moderate(request, url, env, allowedOrigins);
        return Response.json({ code: "not_found" }, { status: 404 });
    }
  },
};
