import type { ReportStore } from "./handler.ts";

interface StoreOptions {
  supabaseUrl?: string;
  secretKeys?: string;
  serviceRoleKey?: string;
  fetchImpl?: typeof fetch;
}

function readDefaultSecret(keys: string | undefined): string | undefined {
  if (!keys) {
    return undefined;
  }

  try {
    const { default: key } = JSON.parse(keys);
    return typeof key === "string" && key.startsWith("sb_secret_")
      ? key
      : undefined;
  } catch {
    return undefined;
  }
}

export function createReportStore({
  supabaseUrl,
  secretKeys,
  serviceRoleKey,
  fetchImpl = fetch,
}: StoreOptions): ReportStore {
  const secretKey = readDefaultSecret(secretKeys);
  const apiKey = secretKey ?? serviceRoleKey;

  return async ({ requestId, category, description, latitude, longitude }) => {
    if (!supabaseUrl || !apiKey) {
      throw new Error("Report store is not configured");
    }

    const endpoint = new URL("/rest/v1/rpc/submit_report", supabaseUrl);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        apikey: apiKey,
        ...(secretKey ? {} : { authorization: "Bearer " + apiKey }),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_request_id: requestId,
        p_category: category,
        p_description: description,
        p_latitude: latitude,
        p_longitude: longitude,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error("Report store request failed");
    }

    const result: unknown = await response.json();
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
