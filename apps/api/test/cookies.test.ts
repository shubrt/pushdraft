import { describe, expect, test } from "bun:test";

import {
  createAuthStateCookie,
  createCsrfCookie,
  createDraftSessionCookie,
  createSessionCookie,
} from "../src/auth/session";
import { TEST_CONFIG, TEST_DRAFT_ID } from "./helpers";

describe("host-only authentication cookies", () => {
  test("session, OAuth-state, and draft cookies carry the __Host protections", () => {
    const sessionCookie = createSessionCookie(TEST_CONFIG, "opaque-session-token");
    const authStateCookie = createAuthStateCookie(TEST_CONFIG, {
      purpose: "oauth-state",
      state: "oauth-state",
      verifier: "pkce-verifier",
      next: "/drafts",
    });
    const draftCookie = createDraftSessionCookie(TEST_CONFIG, {
      webSessionId: "web-session-id",
      draftId: TEST_DRAFT_ID,
    });
    const cookies = [sessionCookie, authStateCookie, draftCookie];

    for (const cookie of cookies) {
      expect(cookie).toStartWith("__Host-");
      expectCookieAttribute(cookie, "Path=/");
      expectCookieAttribute(cookie, "Secure");
      expectCookieAttribute(cookie, "HttpOnly");
      expect(cookie.toLowerCase()).not.toContain("domain=");
    }

    expectCookieAttribute(sessionCookie, "SameSite=Lax");
    expectCookieAttribute(authStateCookie, "SameSite=Lax");
    expectCookieAttribute(draftCookie, "SameSite=Strict");
  });

  test("the CSRF cookie remains host-only but readable for double-submit forms", () => {
    const cookie = createCsrfCookie(TEST_CONFIG, "csrf-token");

    expect(cookie).toStartWith("__Host-");
    expectCookieAttribute(cookie, "Path=/");
    expectCookieAttribute(cookie, "Secure");
    expectCookieAttribute(cookie, "SameSite=Strict");
    expect(cookie.toLowerCase()).not.toContain("domain=");
    expect(cookie.toLowerCase()).not.toContain("httponly");
  });
});

function expectCookieAttribute(cookie: string, expected: string): void {
  const attributes = cookie
    .split(";")
    .slice(1)
    .map((value) => value.trim().toLowerCase());
  expect(attributes).toContain(expected.toLowerCase());
}
