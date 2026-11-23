export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0]
    .trim().toLowerCase();
  if (contentType !== "application/json" || !request.body) {
    return null;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let bodyBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      bodyBytes += value.byteLength;
      if (bodyBytes > maxBytes) {
        await reader.cancel();
        return null;
      }

      body += decoder.decode(value, { stream: true });
    }

    return JSON.parse(body + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
