import { describe, expect, test, vi } from "vite-plus/test";
import type { PoolClient } from "pg";

import { createApp } from "../src/app";
import { readAuthState, SESSION_COOKIE } from "../src/auth/session";
import { TEST_CONFIG, TEST_DRAFT_ID, createFakeDatabase, unexpectedQuery } from "./helpers";

vi.mock("../src/auth/shoo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/shoo")>()),
  exchangeAndVerifyShooCode: async () => ({ pairwise_sub: "test-subject", name: "Test account" }),
}));

describe("sign-in return targets", () => {
  test.each([`/drafts/${TEST_DRAFT_ID}`, `/drafts/${TEST_DRAFT_ID}/share`])(
    "preserves %s through sign-in and the callback",
    async (next) => {
      const database = createFakeDatabase();
      database.transaction = (run) =>
        run({ query: database.query.bind(database) } as unknown as PoolClient);
      const app = createApp({ config: TEST_CONFIG, database });
      const response = await app.handle(
        new Request(`https://pushdraft.example/auth/sign-in?${new URLSearchParams({ next })}`),
      );
      const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
      const headers = new Headers({ cookie });
      const state = readAuthState(TEST_CONFIG, headers);

      expect(response.status).toBe(303);
      expect(state?.next).toBe(next);
      const callback = await app.handle(
        new Request(
          `https://pushdraft.example/auth/callback?${new URLSearchParams({ state: state!.state, code: "test-code" })}`,
          { headers },
        ),
      );

      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe(`https://pushdraft.example${next}`);
      expect(callback.headers.get("set-cookie")).toContain(SESSION_COOKIE);
    },
  );

  test.each(["/drafts", "/cli/auth", `/${TEST_DRAFT_ID}`, `/${TEST_DRAFT_ID}?version=7`])(
    "retains the existing allowed target %s",
    async (next) => {
      expect(await signInTarget(next)).toBe(next);
    },
  );

  test.each([
    "https://evil.example/drafts/abcdefghijkl/share",
    "//evil.example/drafts/abcdefghijkl/share",
    "/\\evil.example/drafts/abcdefghijkl/share",
    "/drafts/abcdefghijk\\share",
    "/drafts/short",
    "/drafts/ABCDEFGHIJKL/share",
    "/drafts/abcdefghijklm/share",
    "/drafts/abcdefghijkl/shares",
    "/drafts/abcdefghijkl/share/extra",
    "/drafts/abcdefghijkl/share?next=https://evil.example",
    "/drafts/abcdefghijkl%2fshare",
  ])("rejects the invalid target %s", async (next) => {
    expect(await signInTarget(next)).toBe("/drafts");
  });
});

async function signInTarget(next: string): Promise<string | undefined> {
  const app = createApp({ config: TEST_CONFIG, database: createFakeDatabase(unexpectedQuery) });
  const response = await app.handle(
    new Request(`https://pushdraft.example/auth/sign-in?${new URLSearchParams({ next })}`),
  );
  expect(response.status).toBe(303);
  return readAuthState(
    TEST_CONFIG,
    new Headers({ cookie: response.headers.get("set-cookie")!.split(";")[0]! }),
  )?.next;
}
