import municipalBoundary from "../data/villa-gobernador-galvez.geojson";
import { readJsonBody } from "../supabase/functions/_shared/json-body.ts";
import { createReportDirectoryHandler, isOffset, isPublicStatus, type TrackingStatus } from "../supabase/functions/report-directory/handler.ts";
import { createReportHandler } from "../supabase/functions/submit-report/handler.ts";
import type { MunicipalBoundary } from "../supabase/functions/submit-report/boundary.ts";
import { isWorkerCategory } from "./categories.ts";
import { createModeratorSession, isModerator, type ModeratorCredentials } from "./moderator.ts";
import { emptyReportDetails, maxSubmissionBytes, parseReportDetails } from "./report-details.ts";
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

function submitReport(
  request: Request,
  allowedOrigins: string[],
  store: ReturnType<typeof createReportsStore>,
) {
  let details = emptyReportDetails();
  return createReportHandler({
    allowedOrigins,
    boundary,
    acceptsCategory: isWorkerCategory,
    async readBody(input) {
      const body = await readJsonBody(input, maxSubmissionBytes);
      if (!body || typeof body !== "object" || Array.isArray(body)) return null;
      const parsedDetails = parseReportDetails((body as Record<string, unknown>).extra);
      if (!parsedDetails) return null;
      details = parsedDetails;
      return body;
    },
    store: (report) => store.submit(report, details),
  })(request);
}

async function readReportItem(request: Request, url: URL, env: Environment, allowedOrigins: string[]) {
  const origin = request.headers.get("origin");
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin, Authorization" });
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (origin !== null) {
    if (!allowedOrigins.includes(origin)) return respond({ code: "invalid_request" }, 400);
    headers.set("access-control-allow-origin", origin);
  }
  if (request.method === "OPTIONS") {
    headers.set("access-control-allow-methods", "GET, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, apikey, content-type");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    headers.set("allow", "GET, OPTIONS");
    return respond({ code: "invalid_request" }, 405);
  }

  const ids = url.searchParams.getAll("id");
  if (ids.length !== 1 || !uuidPattern.test(ids[0])) {
    return respond({ code: "invalid_request" }, 400);
  }
  const id = ids[0].toLowerCase();
  const store = createReportsStore(env.REPORTS_DB);
  try {
    if (url.pathname === "/api/reclamos-publicados") {
      const report = await store.getPublishedReport(id);
      return respond({ reports: report ? [report] : [], nextOffset: null });
    }

    const moderator = await isModerator(env, request.headers.get("authorization"));
    const photo = await store.getReportPhoto(id, moderator);
    if (!photo) return respond({ code: "report_not_found" }, 404);
    const decoded = atob(photo);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index);
    }
    headers.set("content-type", "image/jpeg");
    headers.set("x-content-type-options", "nosniff");
    return new Response(bytes, { headers });
  } catch {
    return respond({ code: "service_unavailable" }, 503);
  }
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
    headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
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

    const requestFilter = url.searchParams.get("request_id");
    const requestId = requestFilter?.startsWith("eq.") ? requestFilter.slice(3) : "";
    if (request.method === "PATCH") {
      const body = await readJsonBody(request, 1024);
      if (!uuidPattern.test(requestId) || !isReportStatus(expected) ||
        !body || typeof body !== "object" || !("status" in body) || !isReportStatus(body.status)) {
        return respond({ code: "invalid_request" }, 400);
      }
      const result = await store.updateStatus(requestId, expected, body.status);
      return respond(result ? [result] : []);
    }
    if (request.method === "DELETE") {
      if (!uuidPattern.test(requestId) || !isPublicStatus(expected) ||
        url.searchParams.getAll("request_id").length !== 1 || url.searchParams.getAll("status").length !== 1) {
        return respond({ code: "invalid_request" }, 400);
      }
      const result = await store.deletePublicReport(requestId.toLowerCase(), expected);
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
        return submitReport(request, allowedOrigins, store);
      case "/api/reclamos-publicados":
        if (url.searchParams.has("id") && (request.method === "GET" || request.method === "OPTIONS")) {
          return readReportItem(request, url, env, allowedOrigins);
        }
        return createReportDirectoryHandler({
          allowedOrigins,
          store: store.directory,
          acceptsCategory: isWorkerCategory,
        })(request);
      case "/api/reclamos-foto":
        return readReportItem(request, url, env, allowedOrigins);
      default:
        if (adminPaths.has(url.pathname)) return moderate(request, url, env, allowedOrigins);
        return Response.json({ code: "not_found" }, { status: 404 });
    }
  },
};
