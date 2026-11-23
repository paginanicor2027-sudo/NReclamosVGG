export interface ModeratorCredentials {
  MODERATOR_EMAIL?: string;
  MODERATOR_ACCESS_KEY?: string;
}

const sessionLifetimeSeconds = 30 * 60;
const expiryBytes = 8;
const nonceBytes = 16;
const signatureBytes = 32;
const payloadBytes = expiryBytes + nonceBytes;
const tokenBytes = payloadBytes + signatureBytes;
const tokenCharacters = Math.ceil(tokenBytes * 4 / 3);
const encoder = new TextEncoder();
const keyProofContext = encoder.encode(
  "reclamosvgg:moderator-api:key-proof:v1",
);

function normalizeEmail(value: unknown): string | null {
  // Printable ASCII with a single @ and no surrounding whitespace.
  if (
    typeof value !== "string" || value.length > 254 ||
    !/^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+$/.test(value)
  ) {
    return null;
  }

  return value.toLowerCase();
}

function parseAccessKey(value: unknown): ArrayBuffer | null {
  if (
    typeof value !== "string" || value.length !== 64 ||
    !/^[a-f0-9]{64}$/i.test(value)
  ) {
    return null;
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes.buffer;
}

function readCredentials(credentials: ModeratorCredentials) {
  const email = normalizeEmail(credentials.MODERATOR_EMAIL);
  const key = parseAccessKey(credentials.MODERATOR_ACCESS_KEY);
  return email && key ? { email, key } : null;
}

function importHmacKey(
  key: ArrayBuffer,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function sessionMessage(email: string, payload: Uint8Array): ArrayBuffer {
  const context = encoder.encode(
    "reclamosvgg:moderator-api:session:v1\0" + email + "\0",
  );
  const message = new Uint8Array(context.length + payload.length);
  message.set(context);
  message.set(payload, context.length);
  return message.buffer;
}

function encodeToken(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/, "");
}

function decodeToken(authorization: string): Uint8Array | null {
  const parts = /^Bearer +([A-Za-z0-9_-]+)$/i.exec(authorization);
  const value = parts?.[1];
  if (!value || value.length !== tokenCharacters) {
    return null;
  }

  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const decoded = Uint8Array.from(
    atob(padded),
    (character) => character.charCodeAt(0),
  );
  return decoded.length === tokenBytes && encodeToken(decoded) === value
    ? decoded
    : null;
}

function currentSecond(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export async function createModeratorSession(
  credentials: ModeratorCredentials,
  email: unknown,
  key: unknown,
): Promise<{ access_token: string; expires_in: number } | null> {
  const moderator = readCredentials(credentials);
  const requestedEmail = normalizeEmail(email);
  const requestedKey = parseAccessKey(key);
  if (!moderator || !requestedEmail || !requestedKey) {
    return null;
  }

  try {
    const [moderatorKey, guessedKey] = await Promise.all([
      importHmacKey(moderator.key, ["sign", "verify"]),
      importHmacKey(requestedKey, ["sign"]),
    ]);
    // Compare the guessed key with Web Crypto's native HMAC verification.
    const proof = await crypto.subtle.sign("HMAC", guessedKey, keyProofContext);
    const matches = await crypto.subtle.verify(
      "HMAC",
      moderatorKey,
      proof,
      keyProofContext,
    );
    if (!matches || requestedEmail !== moderator.email) {
      return null;
    }

    const payload = new Uint8Array(payloadBytes);
    new DataView(payload.buffer).setBigUint64(
      0,
      currentSecond() + BigInt(sessionLifetimeSeconds),
    );
    crypto.getRandomValues(payload.subarray(expiryBytes));
    const signature = await crypto.subtle.sign(
      "HMAC",
      moderatorKey,
      sessionMessage(moderator.email, payload),
    );

    const token = new Uint8Array(tokenBytes);
    token.set(payload);
    token.set(new Uint8Array(signature), payloadBytes);
    return {
      access_token: encodeToken(token),
      expires_in: sessionLifetimeSeconds,
    };
  } catch {
    return null;
  }
}

export async function isModerator(
  credentials: ModeratorCredentials,
  authorization: string | null,
): Promise<boolean> {
  const moderator = readCredentials(credentials);
  if (!moderator || authorization === null) {
    return false;
  }

  try {
    const token = decodeToken(authorization);
    if (
      !token || new DataView(token.buffer).getBigUint64(0) <= currentSecond()
    ) {
      return false;
    }

    const payload = token.subarray(0, payloadBytes);
    const signature = token.slice(payloadBytes).buffer;
    const key = await importHmacKey(moderator.key, ["verify"]);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      sessionMessage(moderator.email, payload),
    );
  } catch {
    return false;
  }
}
