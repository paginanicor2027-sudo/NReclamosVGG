import { type AdminRpcOptions, createAdminRpc } from "../_shared/admin-rpc.ts";
import type { ReportStore } from "./handler.ts";

export function createReportStore(options: AdminRpcOptions): ReportStore {
  const rpc = createAdminRpc(options);
  return async ({ requestId, category, description, latitude, longitude }) => {
    const result = await rpc("submit_report", {
      p_request_id: requestId,
      p_category: category,
      p_description: description,
      p_latitude: latitude,
      p_longitude: longitude,
    });

    if (typeof result === "object" && result !== null) {
      const { code, trackingNumber, status, created } = result as Record<
        string,
        unknown
      >;
      if (code === "request_conflict") {
        return { code };
      }

      if (
        typeof trackingNumber === "string" && trackingNumber.length > 0 &&
        status === "pending_review" && typeof created === "boolean"
      ) {
        return { trackingNumber, status, created };
      }
    }

    throw new Error("Report store returned an invalid result");
  };
}
