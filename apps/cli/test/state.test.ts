import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_API_URL,
  fingerprintApiKey,
  mappedDraftId,
  normalizeApiUrl,
  resolveAuth,
  setDraftMapping,
  type DraftMapping,
  type DraftState,
} from "../src/state.js";

describe("resolveAuth", () => {
  test("defaults to the production domain", () => {
    expect(DEFAULT_API_URL).toBe("https://draft.shubrt.me");
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
  const fingerprint = fingerprintApiKey("pushdraft_secret");
  const state: DraftState = {
    files: {
      "/repo/plan.html": {
        draftId: "draft_123",
        publicUrl: "https://draft_123.pushdraft.example",
        rawUrl: "https://draft_123.pushdraft.example/raw",
        latestVersionNumber: 2,
        updatedAt: "2026-08-13T12:00:00.000Z",
        apiUrl: "https://pushdraft.example",
        apiKeyFingerprint: fingerprint,
        accountId: "account_1",
      },
    },
  };

  test("reuses a mapping only for the same API and key", () => {
    expect(mappedDraftId(state, "/repo/plan.html", "https://pushdraft.example/", fingerprint)).toBe(
      "draft_123",
    );
    expect(
      mappedDraftId(state, "/repo/plan.html", "https://other.example", fingerprint),
    ).toBeUndefined();
    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://pushdraft.example",
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
      mappedDraftId(legacyState, "/repo/plan.html", "https://pushdraft.example", fingerprint),
    ).toBeUndefined();
  });

  test("survives key rotation only within the same verified account", () => {
    const rotatedFingerprint = fingerprintApiKey("rotated_key");

    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://pushdraft.example",
        rotatedFingerprint,
        "account_1",
      ),
    ).toBe("draft_123");
    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://pushdraft.example",
        rotatedFingerprint,
        "account_2",
      ),
    ).toBeUndefined();
  });
});

test("fingerprintApiKey is stable and does not expose the key", () => {
  const fingerprint = fingerprintApiKey("pushdraft_secret");
  expect(fingerprint).toHaveLength(64);
  expect(fingerprint).toBe(fingerprintApiKey("pushdraft_secret"));
  expect(fingerprint).not.toContain("pushdraft_secret");
});

test("normalizeApiUrl rejects non-http URLs and credentials", () => {
  expect(normalizeApiUrl("https://pushdraft.example/")).toBe("https://pushdraft.example");
  expect(() => normalizeApiUrl("file:///tmp/pushdraft")).toThrow("http or https");
  expect(() => normalizeApiUrl("https://user:secret@pushdraft.example")).toThrow(
    "cannot contain credentials",
  );
});

describe("legacy pushdraft.dev origin", () => {
  const fingerprint = fingerprintApiKey("pushdraft_secret");
  const legacyMapping: DraftMapping = {
    draftId: "q43kvvtxix1x",
    publicUrl: "https://q43kvvtxix1x.pushdraft.dev",
    rawUrl: "https://q43kvvtxix1x.pushdraft.dev/raw",
    latestVersionNumber: 3,
    updatedAt: "2026-09-01T12:00:00.000Z",
    apiUrl: "https://pushdraft.dev",
    apiKeyFingerprint: fingerprint,
    accountId: "account_1",
  };

  test("normalizeApiUrl maps only the old production origin", () => {
    for (const legacy of [
      "https://pushdraft.dev",
      "https://pushdraft.dev/",
      "HTTPS://PushDraft.dev",
      "https://pushdraft.dev:443",
    ]) {
      expect(normalizeApiUrl(legacy)).toBe("https://draft.shubrt.me");
    }
    for (const other of [
      "https://staging.pushdraft.dev",
      "https://pushdraft-pr-12.preview.pushdraft.dev",
      "https://pushdraft.dev/api",
      "http://pushdraft.dev",
    ]) {
      expect(normalizeApiUrl(other)).toBe(other);
    }
  });

  test("resolveAuth moves a saved legacy config to the new domain", () => {
    expect(
      resolveAuth({
        env: {},
        config: { apiUrl: "https://pushdraft.dev" },
        credentials: { apiKey: "saved-key" },
      }).apiUrl,
    ).toBe("https://draft.shubrt.me");
  });

  test("reuses legacy mappings on the new domain", () => {
    const state: DraftState = { files: { "/repo/plan.html": legacyMapping } };

    expect(
      mappedDraftId(
        state,
        "/repo/plan.html",
        "https://draft.shubrt.me",
        fingerprintApiKey("rotated_key"),
        "account_1",
      ),
    ).toBe("q43kvvtxix1x");
    expect(mappedDraftId(state, "/repo/plan.html", "https://draft.shubrt.me", fingerprint)).toBe(
      "q43kvvtxix1x",
    );
  });

  test("setDraftMapping replaces the legacy context entry", () => {
    const state: DraftState = {
      files: { "/repo/plan.html": legacyMapping },
      contexts: { "/repo/plan.html": [legacyMapping] },
    };
    const mapping: DraftMapping = {
      ...legacyMapping,
      latestVersionNumber: 4,
      apiUrl: "https://draft.shubrt.me",
    };

    setDraftMapping(state, "/repo/plan.html", mapping);

    expect(state.contexts?.["/repo/plan.html"]).toEqual([mapping]);
    expect(state.files["/repo/plan.html"]).toEqual(mapping);
  });
});
