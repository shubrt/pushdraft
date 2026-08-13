import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signToken<Payload extends Record<string, unknown>>(
  payload: Payload,
  secret: string,
  ttlSeconds: number,
): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: nowSeconds() + ttlSeconds })).toString(
    "base64url",
  );
  return `${body}.${hmac(body, secret)}`;
}

export function deriveSigningSecret(secret: string, purpose: string): string {
  return createHmac("sha256", secret).update(`pp:${purpose}`).digest("base64url");
}

export function verifyToken<Payload extends Record<string, unknown>>(
  token: string,
  secret: string,
): (Payload & { exp: number }) | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = hmac(body, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!isRecord(payload) || typeof payload.exp !== "number" || payload.exp < nowSeconds()) {
      return null;
    }
    return payload as Payload & { exp: number };
  } catch {
    return null;
  }
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
