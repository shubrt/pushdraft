import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { AppConfig } from "../config";
import { randomToken } from "../lib/crypto";

export type Pkce = {
  verifier: string;
  challenge: string;
  state: string;
};

export type ShooClaims = JWTPayload & {
  pairwise_sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  pii_sub?: string;
};

export function buildPkce(): Pkce {
  const verifier = randomToken(32);
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomToken(24),
  };
}

export function buildAuthorizeUrl(
  config: AppConfig,
  values: Pick<Pkce, "state" | "challenge"> & { redirectUri: string },
): string {
  const url = new URL("/authorize", config.shooBaseUrl);
  url.searchParams.set("redirect_uri", values.redirectUri);
  url.searchParams.set("state", values.state);
  url.searchParams.set("code_challenge", values.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("pii", "true");
  return url.toString();
}

export async function exchangeAndVerifyShooCode(
  config: AppConfig,
  values: { code: string; verifier: string; redirectUri: string },
): Promise<ShooClaims> {
  const response = await fetch(new URL("/token", config.shooBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: values.redirectUri,
      code: values.code,
      code_verifier: values.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body: unknown = await response.json().catch(() => null);
  const idToken = readString(body, "id_token");
  if (!response.ok || !idToken) {
    throw new Error(`Shoo token exchange failed with status ${response.status}.`);
  }

  const discoveryResponse = await fetch(
    new URL("/.well-known/openid-configuration", config.shooBaseUrl),
    { signal: AbortSignal.timeout(10_000) },
  );
  const discovery: unknown = await discoveryResponse.json().catch(() => null);
  const issuer = readString(discovery, "issuer");
  if (!discoveryResponse.ok || !issuer) throw new Error("Shoo discovery failed.");

  const { payload } = await jwtVerify(
    idToken,
    createRemoteJWKSet(new URL("/.well-known/jwks.json", config.shooBaseUrl)),
    {
      issuer,
      audience: `origin:${config.publicUrl.origin}`,
      algorithms: ["ES256"],
    },
  );
  if (typeof payload.pairwise_sub !== "string" || !payload.pairwise_sub) {
    throw new Error("Shoo id_token is missing pairwise_sub.");
  }
  return payload as ShooClaims;
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : null;
}
