import { readJsonBody } from "../_shared/json-body.ts";
import { isInsideMunicipality, type MunicipalBoundary } from "./boundary.ts";

const categories = [
  "baches",
  "luminarias",
  "residuos",
  "desagues",
  "otros",
] as const;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const maxBodyBytes = 8_192;

export interface ReportSubmission {
  requestId: string;
  category: typeof categories[number];
  description: string;
  latitude: number;
  longitude: number;
}

export type StoredReport =
  | { trackingNumber: string; status: "pending_review"; created: boolean }
  | { code: "request_conflict" };

export type ReportStore = (report: ReportSubmission) => Promise<StoredReport>;

interface HandlerOptions {
  allowedOrigins: readonly string[];
  boundary: MunicipalBoundary;
  store: ReportStore;
}

type ErrorCode =
  | "invalid_request"
  | "outside_municipality"
  | "request_conflict"
  | "service_unavailable";

function validateReport(input: unknown): ReportSubmission | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const { requestId, category, description, latitude, longitude } =
    input as Record<string, unknown>;
  const acceptedCategory = categories.find((value) => value === category);
  if (
    typeof requestId !== "string" || !uuidPattern.test(requestId) ||
    !acceptedCategory ||
    typeof description !== "string" ||
    typeof latitude !== "number" || !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  const trimmed = description.trim();
  // PostgreSQL text cannot store NUL or unpaired surrogate code units.
  if (
    !trimmed || [...trimmed].length > 400 || trimmed.includes("\0") ||
    !trimmed.isWellFormed()
  ) {
    return null;
  }

  return {
    requestId: requestId.toLowerCase(),
    category: acceptedCategory,
    description: trimmed,
    latitude,
    longitude,
  };
}

export function createReportHandler(
  { allowedOrigins, boundary, store }: HandlerOptions,
) {
  const origins = new Set(allowedOrigins);

  return async function handleReport(request: Request): Promise<Response> {
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
      headers.set("access-control-allow-methods", "POST, OPTIONS");
      headers.set(
        "access-control-allow-headers",
        "authorization, apikey, content-type, x-client-info",
      );
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      headers.set("allow", "POST, OPTIONS");
      return error(405, "invalid_request");
    }

    const report = validateReport(await readJsonBody(request, maxBodyBytes));
    if (!report) {
      return error(400, "invalid_request");
    }

    if (!isInsideMunicipality(boundary, report.latitude, report.longitude)) {
      return error(422, "outside_municipality");
    }

    try {
      const result = await store(report);
      if ("code" in result) {
        return error(409, result.code);
      }

      const { trackingNumber, status, created } = result;
      return Response.json({ trackingNumber, status }, {
        status: created ? 201 : 200,
        headers,
      });
    } catch {
      return error(503, "service_unavailable");
    }
  };
}
