import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_API_URL,
  fingerprintApiKey,
  mappedDraftId,
  normalizeApiUrl,
  resolveAuth,
  type DraftState,
} from "../src/state.js";

describe("resolveAuth", () => {
  test("defaults to the production domain", () => {
    expect(DEFAULT_API_URL).toBe("https://pushover.dev");
  });

  test("uses overrides, environment, and saved values in order", () => {
    const base = {
      env: { API_URL: "https://env.example", API_KEY: "env-key" },
      config: { apiUrl: "https://saved.example" },
      credentials: { apiKey: "saved-key" },
    };

    expect(resolveAuth({ ...base, apiUrlOverride: "https://flag.example/" })).toEqual({
      apiUrl: "https://flag.example",
      apiKey: "env-key",
    });
    expect(resolveAuth({ ...base, env: {} })).toEqual({
      apiUrl: "https://saved.example",
      apiKey: "saved-key",
    });
  });

  test("requires a key unless a command opts out", () => {
    const withoutKey = { env: {}, config: {}, credentials: {} };
    expect(() => resolveAuth(withoutKey)).toThrow("Missing API key");
    expect(resolveAuth({ ...withoutKey, requireApiKey: false }).apiKey).toBeUndefined();
  });

  test("exposes a verified account only for the saved key", () => {
    const credentials = { apiKey: "saved-key", accountId: "account_1" };

    expect(resolveAuth({ env: {}, config: {}, credentials })).toMatchObject({
      apiKey: "saved-key",
      accountId: "account_1",
    });
    expect(resolveAuth({ env: { API_KEY: "saved-key" }, config: {}, credentials })).toMatchObject({
      accountId: "account_1",
    });
    expect(
      resolveAuth({ env: { API_KEY: "other-key" }, config: {}, credentials }).accountId,
    ).toBeUndefined();
  });
});

describe("draft mappings", () => {
  const fingerprint = fingerprintApiKey("pushover_secret");
  const state: DraftState = {
    files: {
      "/repo/plan.html": {
        draftId: "draft_123",
        publicUrl: "https://draft_123.pushover.example",
        rawUrl: "https://draft_123.pushover.example/raw",
        latestVersionNumber: 2,
        updatedAt: "2026-08-13T12:00:00.000Z",
        apiUrl: "https://pushover.example",
        apiKeyFingerprint: fingerprint,
        accountId: "account_1",
      },
    },
  };

  test("reuses a mapping only for the same API and key", () => {
    expect(mappedDraftId(state, "/repo/plan.html", "https://pushover.example/", fingerprint)).toBe(
      "draft_123",
    );
    expect(
      mappedDraftId(state, "/repo/plan.html", "https://other.example", fingerprint),
    ).toBeUndefined();
    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://pushover.example",
        fingerprintApiKey("another_key"),
      ),
    ).toBeUndefined();
  });

  test("does not reuse a legacy mapping without a key fingerprint", () => {
    const mapping = state.files["/repo/plan.html"];
    if (mapping === undefined) throw new Error("Missing test mapping.");
    const legacyState: DraftState = {
      files: { "/repo/plan.html": { ...mapping, apiKeyFingerprint: undefined } },
    };

    expect(
      mappedDraftId(legacyState, "/repo/plan.html", "https://pushover.example", fingerprint),
    ).toBeUndefined();
  });

  test("survives key rotation only within the same verified account", () => {
    const rotatedFingerprint = fingerprintApiKey("rotated_key");

    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://pushover.example",
        rotatedFingerprint,
        "account_1",
      ),
    ).toBe("draft_123");
    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://pushover.example",
        rotatedFingerprint,
        "account_2",
      ),
    ).toBeUndefined();
  });
});

test("fingerprintApiKey is stable and does not expose the key", () => {
  const fingerprint = fingerprintApiKey("pushover_secret");
  expect(fingerprint).toHaveLength(64);
  expect(fingerprint).toBe(fingerprintApiKey("pushover_secret"));
  expect(fingerprint).not.toContain("pushover_secret");
});

test("normalizeApiUrl rejects non-http URLs and credentials", () => {
  expect(normalizeApiUrl("https://pushover.example/")).toBe("https://pushover.example");
  expect(() => normalizeApiUrl("file:///tmp/pushover")).toThrow("http or https");
  expect(() => normalizeApiUrl("https://user:secret@pushover.example")).toThrow(
    "cannot contain credentials",
  );
});
