import { afterEach, describe, expect, test } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadPayloadSchema } from "@pushdraft/contracts";

import { runCli } from "../src/app.js";
import {
  createStatePaths,
  fingerprintApiKey,
  mappedDraftId,
  readDraftState,
  saveCredentials,
} from "../src/state.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pushdraft-context-"));
  directories.push(directory);
  const htmlFile = path.join(directory, "page.html");
  const imageFile = path.join(directory, "hero.png");
  const manifest = path.join(directory, "refs.json");
  fs.writeFileSync(htmlFile, '<img src="refs/hero">');
  fs.writeFileSync(imageFile, Buffer.from("image"));
  fs.writeFileSync(manifest, JSON.stringify({ hero: "./hero.png" }));
  const statePaths = createStatePaths(directory);
  const requests: Array<{ filename: string | undefined; draftId: string | null | undefined }> = [];
  let created = 0;
  async function upload(apiUrl: string, apiKey: string, accountId?: string, forceNew = false) {
    saveCredentials(statePaths, apiKey, apiUrl, accountId);
    await runCli(["upload", htmlFile, "--refs-file", manifest, ...(forceNew ? ["--new"] : [])], {
      statePaths,
      version: "test",
      output: { log() {}, warn() {} },
      fetchImpl: async (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected JSON body");
        const payload = uploadPayloadSchema.parse(JSON.parse(init.body) as unknown);
        requests.push({ filename: payload.filename, draftId: payload.draftId });
        const draftId = payload.draftId ?? `draft${String(++created).padStart(7, "0")}`;
        return Response.json({
          ok: true,
          draftId,
          versionId: `version-${requests.length}`,
          versionNumber: requests.length,
          title: "Page",
          requestId: null,
          publicUrl: `${apiUrl}/${draftId}`,
          rawUrl: `${apiUrl}/${draftId}/raw`,
          warnings: [],
        });
      },
    });
  }
  return { htmlFile, imageFile, statePaths, requests, upload };
}

describe("upload contexts", () => {
  test("restores production mappings after visiting a preview", async () => {
    const { requests, upload } = fixture();
    await upload("https://production.example", "key", "account");
    await upload("https://preview.example", "key", "account");
    await upload("https://production.example/", "key", "account");
    await upload("https://preview.example", "key", "account");
    expect(requests.map((request) => request.draftId)).toEqual([
      null,
      null,
      null,
      null,
      "draft0000001",
      "draft0000002",
      "draft0000003",
      "draft0000004",
    ]);
  });

  test("restores each account and keeps verified key rotation", async () => {
    const { requests, upload } = fixture();
    await upload("https://api.example", "key-a", "account-a");
    await upload("https://api.example", "key-b", "account-b");
    await upload("https://api.example", "rotated-a", "account-a");
    await upload("https://api.example", "rotated-b", "account-b");
    expect(requests.map((request) => request.draftId)).toEqual([
      null,
      null,
      null,
      null,
      "draft0000001",
      "draft0000002",
      "draft0000003",
      "draft0000004",
    ]);
  });

  test("separates unverified keys and restores their original mappings", async () => {
    const { requests, upload } = fixture();
    await upload("https://api.example", "key-a");
    await upload("https://api.example", "key-b");
    await upload("https://api.example", "key-a");
    expect(requests.map((request) => request.draftId)).toEqual([
      null,
      null,
      null,
      null,
      "draft0000001",
      "draft0000002",
    ]);
  });

  test("keeps the latest draft through exact-key use and verified rotation", async () => {
    const { requests, upload } = fixture();
    await upload("https://api.example", "key-a", "account-a");
    await upload("https://api.example", "key-a", undefined, true);
    await upload("https://api.example", "rotated-a", "account-a");
    expect(requests.map((request) => request.draftId)).toEqual([
      null,
      null,
      "draft0000001",
      null,
      "draft0000001",
      "draft0000003",
    ]);
  });

  test("preserves valid legacy mappings across the first context switch", async () => {
    const { htmlFile, imageFile, statePaths, requests, upload } = fixture();
    saveCredentials(statePaths, "old-key", "https://old.example", "old-account");
    const legacy = {
      draftId: "legacy000001",
      publicUrl: "https://old.example/legacy000001",
      rawUrl: "https://old.example/legacy000001/raw",
      latestVersionNumber: 1,
      updatedAt: "2026-09-05T00:00:00.000Z",
      apiUrl: "https://old.example",
      apiKeyFingerprint: fingerprintApiKey("old-key"),
      accountId: "old-account",
    };
    fs.writeFileSync(
      statePaths.drafts,
      JSON.stringify({
        files: { [htmlFile]: legacy, [imageFile]: { ...legacy, draftId: "legacy000002" } },
      }),
    );
    await upload("https://new.example", "new-key", "new-account");
    const state = readDraftState(statePaths);
    expect(
      mappedDraftId(
        state,
        htmlFile,
        "https://old.example",
        fingerprintApiKey("rotated-key"),
        "old-account",
      ),
    ).toBe("legacy000001");
    await upload("https://old.example", "rotated-key", "old-account");
    expect(requests.map((request) => request.draftId)).toEqual([
      null,
      null,
      "legacy000002",
      "legacy000001",
    ]);
    expect(fs.readFileSync(statePaths.drafts, "utf8")).not.toContain("rotated-key");
  });
});
