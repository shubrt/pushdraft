import { describe, expect, test } from "vite-plus/test";

import { loadConfig } from "../src/config";

const BASE_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgres://pushdraft:pushdraft@localhost:5432/pushdraft",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("public URL resolution", () => {
  test("defaults to the local origin when nothing is configured", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.publicUrl.origin).toBe("http://localhost:3003");
  });

  test("uses PUBLIC_URL for local development", () => {
    const config = loadConfig({ ...BASE_ENV, PUBLIC_URL: "http://localhost:4000" });
    expect(config.publicUrl.origin).toBe("http://localhost:4000");
  });

  test("uses PUBLIC_URL in the Railway production environment", () => {
    const config = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      PUBLIC_URL: "https://pushdraft.dev",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_PUBLIC_DOMAIN: "api-production.up.railway.app",
    });
    expect(config.publicUrl.origin).toBe("https://pushdraft.dev");
  });

  test("prefers the Railway-generated domain in PR environments", () => {
    const config = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      PUBLIC_URL: "https://pushdraft.dev",
      RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12",
      RAILWAY_PUBLIC_DOMAIN: "api-pushdraft-pr-12.up.railway.app",
    });
    expect(config.publicUrl.origin).toBe("https://api-pushdraft-pr-12.up.railway.app");
  });

  test("falls back to PUBLIC_URL when a Railway environment has no domain", () => {
    const config = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      PUBLIC_URL: "https://pushdraft.dev",
      RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12",
    });
    expect(config.publicUrl.origin).toBe("https://pushdraft.dev");
  });
});

const SEED_ENV: NodeJS.ProcessEnv = {
  ...BASE_ENV,
  PREVIEW_SEED_ACCOUNT_ID: "acct_preview",
  PREVIEW_SEED_ACCOUNT_NAME: "Preview",
  PREVIEW_SEED_API_KEY_HASH: "AB".repeat(32),
};

describe("preview seed resolution", () => {
  test("is disabled without a Railway environment", () => {
    expect(loadConfig({ ...SEED_ENV }).previewSeed).toBeUndefined();
  });

  test("is disabled in the Railway production environment", () => {
    const config = loadConfig({ ...SEED_ENV, RAILWAY_ENVIRONMENT_NAME: "production" });
    expect(config.previewSeed).toBeUndefined();
  });

  test("is disabled in preview environments without seed variables", () => {
    const config = loadConfig({ ...BASE_ENV, RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12" });
    expect(config.previewSeed).toBeUndefined();
  });

  test("normalizes the seed values in preview environments", () => {
    const config = loadConfig({ ...SEED_ENV, RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12" });
    expect(config.previewSeed).toEqual({
      accountId: "acct_preview",
      accountName: "Preview",
      apiKeyHash: "ab".repeat(32),
    });
  });

  test("rejects partially configured seed variables", () => {
    const env: NodeJS.ProcessEnv = { ...SEED_ENV, RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12" };
    delete env.PREVIEW_SEED_ACCOUNT_NAME;
    expect(() => loadConfig(env)).toThrow(/must be set together/);
  });

  test("carries the PII subject when configured", () => {
    const config = loadConfig({
      ...SEED_ENV,
      RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12",
      PREVIEW_SEED_PII_SUBJECT: "pii_stable",
    });
    expect(config.previewSeed?.piiSubject).toBe("pii_stable");
  });

  test("omits the PII subject when the variable is not set", () => {
    const config = loadConfig({ ...SEED_ENV, RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12" });
    expect(config.previewSeed?.piiSubject).toBeUndefined();
  });

  test("rejects values that are not a sha256 hex hash", () => {
    const env = {
      ...SEED_ENV,
      RAILWAY_ENVIRONMENT_NAME: "pushdraft-pr-12",
      PREVIEW_SEED_API_KEY_HASH: "pushdraft_plaintext-key",
    };
    expect(() => loadConfig(env)).toThrow(/sha256/);
  });
});
