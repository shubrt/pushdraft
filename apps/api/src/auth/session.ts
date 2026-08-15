import type { AppConfig } from "../config";
import { readCookie, serializeHostCookie } from "../lib/cookies";
import { deriveSigningSecret, signToken, verifyToken } from "../lib/crypto";

export const SESSION_COOKIE = "__Host-pushdraft_session";
export const AUTH_STATE_COOKIE = "__Host-pushdraft_auth_state";
export const DRAFT_SESSION_COOKIE = "__Host-pushdraft_draft";
export const CSRF_COOKIE = "__Host-pushdraft_csrf";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_STATE_TTL_SECONDS = 10 * 60;
const DRAFT_SESSION_TTL_SECONDS = 12 * 60 * 60;

export type WebSession = {
  id: string;
  accountId: string;
  accountName: string;
  email: string | null;
  pictureUrl: string | null;
  csrfTokenHash: string;
};

type AuthState = {
  purpose: "oauth-state";
  state: string;
  verifier: string;
  next: string;
};

type DraftGrant = {
  purpose: "draft-session";
  webSessionId: string;
  draftId: string;
};

export function createSessionCookie(config: AppConfig, token: string): string {
  return serializeHostCookie(SESSION_COOKIE, token, cookieOptions(config, SESSION_TTL_SECONDS));
}

export function clearSessionCookie(config: AppConfig): string {
  return serializeHostCookie(SESSION_COOKIE, "", cookieOptions(config, 0));
}

export function readSessionToken(headers: Headers): string | null {
  return readCookie(headers, SESSION_COOKIE);
}

export function createCsrfCookie(config: AppConfig, token: string): string {
  return serializeHostCookie(CSRF_COOKIE, token, {
    ...cookieOptions(config, SESSION_TTL_SECONDS, "Strict"),
    httpOnly: false,
  });
}

export function clearCsrfCookie(config: AppConfig): string {
  return serializeHostCookie(CSRF_COOKIE, "", {
    ...cookieOptions(config, 0, "Strict"),
    httpOnly: false,
  });
}

export function readCsrfToken(headers: Headers): string | null {
  return readCookie(headers, CSRF_COOKIE);
}

export function createAuthStateCookie(config: AppConfig, state: AuthState): string {
  return serializeHostCookie(
    AUTH_STATE_COOKIE,
    signToken(
      state,
      deriveSigningSecret(config.sessionSecret, "oauth-state"),
      AUTH_STATE_TTL_SECONDS,
    ),
    cookieOptions(config, AUTH_STATE_TTL_SECONDS),
  );
}

export function clearAuthStateCookie(config: AppConfig): string {
  return serializeHostCookie(AUTH_STATE_COOKIE, "", cookieOptions(config, 0));
}

export function readAuthState(config: AppConfig, headers: Headers): AuthState | null {
  const token = readCookie(headers, AUTH_STATE_COOKIE);
  if (!token) return null;
  const payload = verifyToken<AuthState>(
    token,
    deriveSigningSecret(config.sessionSecret, "oauth-state"),
  );
  if (
    !payload ||
    payload.purpose !== "oauth-state" ||
    typeof payload.state !== "string" ||
    typeof payload.verifier !== "string" ||
    typeof payload.next !== "string"
  ) {
    return null;
  }
  return {
    purpose: "oauth-state",
    state: payload.state,
    verifier: payload.verifier,
    next: payload.next,
  };
}

export function createDraftSessionCookie(
  config: AppConfig,
  values: Pick<DraftGrant, "webSessionId" | "draftId">,
): string {
  const value = signToken(
    { ...values, purpose: "draft-session" },
    deriveSigningSecret(config.sessionSecret, "draft-session"),
    DRAFT_SESSION_TTL_SECONDS,
  );
  return serializeHostCookie(
    DRAFT_SESSION_COOKIE,
    value,
    cookieOptions(config, DRAFT_SESSION_TTL_SECONDS, "Strict"),
  );
}

export function readDraftSession(
  config: AppConfig,
  headers: Headers,
  expectedDraftId: string,
): DraftGrant | null {
  const token = readCookie(headers, DRAFT_SESSION_COOKIE);
  return token ? readDraftGrant(config, token, expectedDraftId, "draft-session") : null;
}

function readDraftGrant(
  config: AppConfig,
  token: string,
  expectedDraftId: string,
  purpose: DraftGrant["purpose"],
): DraftGrant | null {
  const payload = verifyToken<DraftGrant>(
    token,
    deriveSigningSecret(config.sessionSecret, "draft-session"),
  );
  if (
    !payload ||
    payload.purpose !== purpose ||
    payload.draftId !== expectedDraftId ||
    typeof payload.webSessionId !== "string"
  ) {
    return null;
  }
  return {
    webSessionId: payload.webSessionId,
    draftId: payload.draftId,
    purpose: payload.purpose,
  };
}

function cookieOptions(_config: AppConfig, maxAge: number, sameSite: "Lax" | "Strict" = "Lax") {
  return { maxAge, sameSite, secure: true };
}
