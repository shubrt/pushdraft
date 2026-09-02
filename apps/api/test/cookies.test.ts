import { describe, expect, test } from "vite-plus/test";

import {
  createAuthStateCookie,
  createCsrfCookie,
  createDraftShareSessionCookie,
  createDraftSessionCookie,
  createSessionCookie,
  readDraftShareSession,
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
    const draftShareCookie = createDraftShareSessionCookie(
      TEST_CONFIG,
      { shareId: "share-id", draftId: TEST_DRAFT_ID },
      60,
    );
    const cookies = [sessionCookie, authStateCookie, draftCookie, draftShareCookie];

    for (const cookie of cookies) {
      expect(cookie).toMatch(/^__Host-/);
      expectCookieAttribute(cookie, "Path=/");
      expectCookieAttribute(cookie, "Secure");
      expectCookieAttribute(cookie, "HttpOnly");
      expect(cookie.toLowerCase()).not.toContain("domain=");
    }

    expectCookieAttribute(sessionCookie, "SameSite=Lax");
    expectCookieAttribute(authStateCookie, "SameSite=Lax");
    expectCookieAttribute(draftCookie, "SameSite=Strict");
    expectCookieAttribute(draftShareCookie, "SameSite=Strict");
  });

  test("binds a share cookie to one draft", () => {
    const cookie = createDraftShareSessionCookie(
      TEST_CONFIG,
      { shareId: "share-id", draftId: TEST_DRAFT_ID },
      60,
    );
    const headers = new Headers({ cookie: cookie.split(";", 1)[0] ?? "" });

    expect(readDraftShareSession(TEST_CONFIG, headers, TEST_DRAFT_ID)).toEqual({
      purpose: "draft-share-session",
      shareId: "share-id",
      draftId: TEST_DRAFT_ID,
    });
    expect(readDraftShareSession(TEST_CONFIG, headers, "mnopqrstuvwx")).toBeNull();
  });

  test("rejects invalid share cookie lifetimes", () => {
    expect(() =>
      createDraftShareSessionCookie(
        TEST_CONFIG,
        { shareId: "share-id", draftId: TEST_DRAFT_ID },
        0,
      ),
    ).toThrow("positive integer");
  });

  test("the CSRF cookie remains host-only but readable for double-submit forms", () => {
    const cookie = createCsrfCookie(TEST_CONFIG, "csrf-token");

    expect(cookie).toMatch(/^__Host-/);
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
