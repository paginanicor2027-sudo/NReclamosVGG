import { readJsonBody } from "../_shared/json-body.ts";
import { isCategory } from "../_shared/report-category.ts";

export { isCategory, type Category } from "../_shared/report-category.ts";
const publicStatuses = ["published", "in_progress", "resolved"] as const;
const trackingPattern = /^VGG-[0-9A-F]{16}$/i;

export type PublicStatus = typeof publicStatuses[number];
export type TrackingStatus = PublicStatus | "pending_review" | "rejected";

export interface DirectoryQuery {
  category: string | null;
  status: PublicStatus | null;
  offset: number;
}

export interface PublishedReport {
  category: string;
  description: string;
  latitude: number;
  longitude: number;
  status: PublicStatus;
  updatedAt: string;
}

export interface ReportDirectoryPage {
  reports: PublishedReport[];
  nextOffset: number | null;
}

export interface TrackedReport {
  status: TrackingStatus;
  updatedAt: string;
}

export interface ReportDirectoryStore {
  list(query: DirectoryQuery): Promise<ReportDirectoryPage>;
  track(trackingNumber: string): Promise<TrackedReport | null>;
}

interface HandlerOptions {
  allowedOrigins: readonly string[];
  store: ReportDirectoryStore;
  acceptsCategory?: (value: unknown) => value is string;
}

type ErrorCode = "invalid_request" | "report_not_found" | "service_unavailable";

export function isPublicStatus(value: unknown): value is PublicStatus {
  return publicStatuses.some((status) => status === value);
}

export function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= 2_147_483_647;
}

function parseDirectoryQuery(
  url: string,
  acceptsCategory: (value: unknown) => value is string,
): DirectoryQuery | null {
  const params = new URL(url).searchParams;
  const categories = params.getAll("category");
  const statuses = params.getAll("status");
  const offsets = params.getAll("offset");
  if (categories.length > 1 || statuses.length > 1 || offsets.length > 1) {
    return null;
  }

  const category = categories[0] ?? null;
  const status = statuses[0] ?? null;
  const offsetParam = offsets[0] ?? "0";
  if (
    (category !== null && !acceptsCategory(category)) ||
    (status !== null && !isPublicStatus(status)) ||
    !/^\d{1,10}$/.test(offsetParam)
  ) {
    return null;
  }

  const offset = Number(offsetParam);
  return isOffset(offset) ? { category, status, offset } : null;
}

async function readTrackingNumber(request: Request): Promise<string | null> {
  const body = await readJsonBody(request, 1024);
  if (
    typeof body !== "object" || body === null || !("trackingNumber" in body)
  ) {
    return null;
  }

  if (typeof body.trackingNumber !== "string") {
    return null;
  }

  const trackingNumber = body.trackingNumber.trim();
  return trackingPattern.test(trackingNumber)
    ? trackingNumber.toUpperCase()
    : null;
}

export function createReportDirectoryHandler(
  { allowedOrigins, store, acceptsCategory = isCategory }: HandlerOptions,
) {
  const origins = new Set(allowedOrigins);

  return async function handleDirectory(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "cache-control": "no-store",
      vary: "Origin",
    });

    function error(status: number, code: ErrorCode): Response {
      return Response.json({ code }, { status, headers });
    }

    if (origin !== null) {
      if (!origins.has(origin)) {
        return error(400, "invalid_request");
      }
      headers.set("access-control-allow-origin", origin);
    }

    if (request.method === "OPTIONS" && origin !== null) {
      headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
      headers.set(
        "access-control-allow-headers",
        "authorization, apikey, content-type, x-client-info",
      );
      return new Response(null, { status: 204, headers });
    }

    try {
      if (request.method === "GET") {
        const query = parseDirectoryQuery(request.url, acceptsCategory);
        if (!query) {
          return error(400, "invalid_request");
        }

        const { reports, nextOffset } = await store.list(query);
        return Response.json({ reports, nextOffset }, { headers });
      }

      if (request.method === "POST") {
        const trackingNumber = await readTrackingNumber(request);
        if (!trackingNumber) {
          return error(400, "invalid_request");
        }

        const tracked = await store.track(trackingNumber);
        if (tracked === null) {
          return error(404, "report_not_found");
        }

        const { status, updatedAt } = tracked;
        return Response.json({ status, updatedAt }, { headers });
      }
    } catch {
      return error(503, "service_unavailable");
    }

    headers.set("allow", "GET, POST, OPTIONS");
    return error(405, "invalid_request");
  };
}
