export interface AdminRpcOptions {
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

export function createAdminRpc({
  supabaseUrl,
  secretKeys,
  serviceRoleKey,
  fetchImpl = fetch,
}: AdminRpcOptions) {
  const secretKey = readDefaultSecret(secretKeys);
  const apiKey = secretKey ?? serviceRoleKey;

  return async (
    procedure: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!supabaseUrl || !apiKey) {
      throw new Error("Report store is not configured");
    }

    const endpoint = new URL("/rest/v1/rpc/" + procedure, supabaseUrl);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        apikey: apiKey,
        ...(secretKey ? {} : { authorization: "Bearer " + apiKey }),
        "content-type": "application/json",
      },
      body: JSON.stringify(parameters),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error("Report store request failed");
    }

    return await response.json();
  };
}
