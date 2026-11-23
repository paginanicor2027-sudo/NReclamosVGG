import { type AdminRpcOptions, createAdminRpc } from "../_shared/admin-rpc.ts";
import {
  isCategory,
  isOffset,
  isPublicStatus,
  type PublishedReport,
  type ReportDirectoryStore,
  type TrackedReport,
  type TrackingStatus,
} from "./handler.ts";

const pageSize = 100;

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isTrackingStatus(value: unknown): value is TrackingStatus {
  return value === "pending_review" || value === "rejected" ||
    isPublicStatus(value);
}

function isCoordinate(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value) <= max;
}

function parsePublicReport(result: unknown): PublishedReport {
  if (typeof result !== "object" || result === null) {
    throw new Error("Report directory returned an invalid report");
  }

  const { category, description, latitude, longitude, status, updatedAt } =
    result as Record<string, unknown>;
  if (
    !isCategory(category) || typeof description !== "string" ||
    !isCoordinate(latitude, 90) || !isCoordinate(longitude, 180) ||
    !isPublicStatus(status) || !isDateTime(updatedAt)
  ) {
    throw new Error("Report directory returned an invalid report");
  }

  return { category, description, latitude, longitude, status, updatedAt };
}

function parseTrackedReport(result: unknown): TrackedReport | null {
  if (result === null) {
    return null;
  }

  if (typeof result === "object") {
    const { status, updatedAt } = result as Record<string, unknown>;
    if (isTrackingStatus(status) && isDateTime(updatedAt)) {
      return { status, updatedAt };
    }
  }

  throw new Error("Report directory returned an invalid tracking result");
}

export function createReportDirectoryStore(
  options: AdminRpcOptions,
): ReportDirectoryStore {
  const rpc = createAdminRpc(options);
  return {
    async list({ category, status, offset }) {
      const result = await rpc("list_published_reports", {
        p_category: category,
        p_status: status,
        p_offset: offset,
      });

      if (typeof result !== "object" || result === null) {
        throw new Error("Report directory returned an invalid page");
      }

      const { reports, nextOffset } = result as Record<string, unknown>;
      if (
        !Array.isArray(reports) || reports.length > pageSize ||
        (nextOffset !== null &&
          (!isOffset(nextOffset) || nextOffset !== offset + pageSize))
      ) {
        throw new Error("Report directory returned an invalid page");
      }

      return { reports: reports.map(parsePublicReport), nextOffset };
    },

    async track(trackingNumber) {
      const result = await rpc("track_report", {
        p_tracking_number: trackingNumber,
      });
      return parseTrackedReport(result);
    },
  };
}
