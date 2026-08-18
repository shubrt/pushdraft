import { afterEach, describe, expect, test } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadPayloadSchema } from "@pushdraft/contracts";

import { runCli, type CliOutput } from "../src/app.js";
import {
  createStatePaths,
  fingerprintApiKey,
  readDraftState,
  saveCredentials,
} from "../src/state.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("upload", () => {
  test("sends bearer auth and reuses the saved draft mapping", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "plan.html");
    fs.writeFileSync(htmlFile, "<!doctype html><title>Private plan</title>");
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");

    const payloads: unknown[] = [];
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer pushdraft_secret");
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      payloads.push(JSON.parse(init.body) as unknown);
      return Response.json({
        ok: true,
        draftId: "q43kvvtxix1x",
        versionId: "version_1",
        versionNumber: payloads.length,
        title: "Private plan",
        requestId: null,
        publicUrl: "https://q43kvvtxix1x.pushdraft.example",
        rawUrl: "https://q43kvvtxix1x.pushdraft.example/raw",
        warnings: [],
      });
    };
    const output = captureOutput();

    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });

    const firstPayload = uploadPayloadSchema.parse(payloads[0]);
    const secondPayload = uploadPayloadSchema.parse(payloads[1]);
    expect(firstPayload.draftId).toBeNull();
    expect(secondPayload.draftId).toBe("q43kvvtxix1x");
    expect(firstPayload.metadata?.fileSha256).toHaveLength(64);
    expect(output.logs).toContain("Uploaded draft");
    expect(output.logs).toContain("Updated draft");
    expect(readDraftState(statePaths).files[htmlFile]?.apiKeyFingerprint).toBe(
      fingerprintApiKey("pushdraft_secret"),
    );
    expect(fs.readFileSync(statePaths.drafts, "utf8")).not.toContain("pushdraft_secret");
  });

  test("sends named references with HTML uploads", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "gallery.html");
    fs.writeFileSync(htmlFile, '<img src="./refs/hero-image">');
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");

    let submittedPayload: unknown;
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      submittedPayload = JSON.parse(init.body) as unknown;
      return uploadResponse();
    };

    await runCli(["upload", htmlFile, "--ref", "hero-image=q43kvvtxix1x"], {
      version: "0.1.0",
      statePaths,
      fetchImpl,
      output: captureOutput(),
    });

    const payload = uploadPayloadSchema.parse(submittedPayload);
    expect(payload.html).toContain("./refs/hero-image");
    expect(payload.references).toEqual({ "hero-image": "q43kvvtxix1x" });
  });

  test.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("base64-encodes .%s files as %s", async (extension, mediaType) => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const imageBytes = Buffer.from([0, 1, 2, 253, 254, 255]);
    const imageFile = path.join(homeDirectory, `image.${extension}`);
    fs.writeFileSync(imageFile, imageBytes);
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");

    let submittedPayload: unknown;
    const output = captureOutput();
    await runCli(["upload", imageFile, "--new"], {
      version: "0.1.0",
      statePaths,
      fetchImpl: async (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
        submittedPayload = JSON.parse(init.body) as unknown;
        return uploadResponse();
      },
      output,
    });

    const payload = uploadPayloadSchema.parse(submittedPayload);
    if (payload.image === undefined) throw new Error("Expected an image payload.");
    expect(payload.metadata?.fileSha256).toHaveLength(64);
    expect(payload.image).toEqual({ mediaType, base64: imageBytes.toString("base64") });
    expect(output.logs).toContain("Raw image: https://q43kvvtxix1x.pushdraft.example/raw");
  });

  test("rejects references on image uploads before the request", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const imageFile = path.join(homeDirectory, "hero.png");
    fs.writeFileSync(imageFile, Buffer.from("image"));
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");

    await expect(
      runCli(["upload", imageFile, "--ref", "hero=q43kvvtxix1x"], {
        version: "0.1.0",
        statePaths,
        fetchImpl: async () => {
          throw new Error("The CLI should reject the upload before making a request.");
        },
        output: captureOutput(),
      }),
    ).rejects.toThrow("References can only be attached to HTML uploads.");
  });

  test("preserves HTML uploads that use another filename extension", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "plan.htm");
    fs.writeFileSync(htmlFile, "<!doctype html><title>Legacy filename</title>");
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");

    let submittedPayload: unknown;
    await runCli(["upload", htmlFile], {
      version: "0.1.0",
      statePaths,
      fetchImpl: async (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
        submittedPayload = JSON.parse(init.body) as unknown;
        return uploadResponse();
      },
      output: captureOutput(),
    });

    const payload = uploadPayloadSchema.parse(submittedPayload);
    expect(payload.html).toContain("Legacy filename");
  });

  test("fails before the request when no API key exists", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const htmlFile = path.join(homeDirectory, "plan.html");
    fs.writeFileSync(htmlFile, "<title>Private plan</title>");

    try {
      await runCli(["upload", htmlFile], {
        version: "0.1.0",
        statePaths: createStatePaths(homeDirectory),
      });
      throw new Error("Expected upload to reject missing credentials.");
    } catch (error) {
      expect(error).toHaveProperty("message", "Missing API key. Run: pushdraft auth login");
    }
  });

  test("does not reuse a mapping after the API key changes", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "plan.html");
    fs.writeFileSync(htmlFile, "<title>Private plan</title>");
    saveCredentials(statePaths, "first_key", "https://pushdraft.example");

    const draftIds: Array<string | null | undefined> = [];
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      draftIds.push(uploadPayloadSchema.parse(JSON.parse(init.body) as unknown).draftId);
      return Response.json({
        ok: true,
        draftId: "q43kvvtxix1x",
        versionId: "version_1",
        versionNumber: 1,
        title: "Private plan",
        requestId: null,
        publicUrl: "https://q43kvvtxix1x.pushdraft.example",
        rawUrl: "https://q43kvvtxix1x.pushdraft.example/raw",
        warnings: [],
      });
    };

    const output = captureOutput();
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });
    saveCredentials(statePaths, "second_key");
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });

    expect(draftIds).toEqual([null, null]);
  });

  test("reuses a mapping after verified key rotation in the same account", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "plan.html");
    fs.writeFileSync(htmlFile, "<title>Private plan</title>");
    saveCredentials(statePaths, "first_key", "https://pushdraft.example", "account_1");

    const draftIds: Array<string | null | undefined> = [];
    const fetchImpl = uploadRecorder(draftIds);
    const output = captureOutput();
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });
    saveCredentials(statePaths, "rotated_key", undefined, "account_1");
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });

    expect(draftIds).toEqual([null, "q43kvvtxix1x"]);
    expect(readDraftState(statePaths).files[htmlFile]?.accountId).toBe("account_1");
  });

  test("does not reuse a mapping after a verified account change", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "plan.html");
    fs.writeFileSync(htmlFile, "<title>Private plan</title>");
    saveCredentials(statePaths, "first_key", "https://pushdraft.example", "account_1");

    const draftIds: Array<string | null | undefined> = [];
    const fetchImpl = uploadRecorder(draftIds);
    const output = captureOutput();
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });
    saveCredentials(statePaths, "other_key", undefined, "account_2");
    await runCli(["upload", htmlFile], { version: "0.1.0", statePaths, fetchImpl, output });

    expect(draftIds).toEqual([null, null]);
  });

  test("does not reuse a persisted mapping without a key fingerprint", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "plan.html");
    fs.writeFileSync(htmlFile, "<title>Private plan</title>");
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");
    fs.writeFileSync(
      statePaths.drafts,
      `${JSON.stringify({
        files: {
          [htmlFile]: {
            draftId: "legacy_draft",
            publicUrl: "https://legacy.pushdraft.example",
            rawUrl: "https://legacy.pushdraft.example/raw",
            latestVersionNumber: 3,
            updatedAt: "2026-08-13T12:00:00.000Z",
            apiUrl: "https://pushdraft.example",
          },
        },
      })}\n`,
    );

    let submittedDraftId: string | null | undefined;
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      submittedDraftId = uploadPayloadSchema.parse(JSON.parse(init.body) as unknown).draftId;
      return Response.json({
        ok: true,
        draftId: "q43kvvtxix1x",
        versionId: "version_1",
        versionNumber: 1,
        title: "Private plan",
        requestId: null,
        publicUrl: "https://q43kvvtxix1x.pushdraft.example",
        rawUrl: "https://q43kvvtxix1x.pushdraft.example/raw",
        warnings: [],
      });
    };

    await runCli(["upload", htmlFile], {
      version: "0.1.0",
      statePaths,
      fetchImpl,
      output: captureOutput(),
    });

    expect(submittedDraftId).toBeNull();
  });

  test("forwards documents larger than 512 KiB to the API", async () => {
    const homeDirectory = makeTemporaryDirectory();
    const statePaths = createStatePaths(homeDirectory);
    const htmlFile = path.join(homeDirectory, "large.html");
    const html = `<title>Large plan</title>${"x".repeat(512 * 1_024)}`;
    fs.writeFileSync(htmlFile, html);
    saveCredentials(statePaths, "pushdraft_secret", "https://pushdraft.example");

    let uploadedLength = 0;
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      const payload = uploadPayloadSchema.parse(JSON.parse(init.body) as unknown);
      if (payload.html === undefined) throw new Error("Expected an HTML payload.");
      uploadedLength = payload.html.length;
      return Response.json({
        ok: true,
        draftId: "q43kvvtxix1x",
        versionId: "version_1",
        versionNumber: 1,
        title: "Large plan",
        requestId: null,
        publicUrl: "https://q43kvvtxix1x.pushdraft.example",
        rawUrl: "https://q43kvvtxix1x.pushdraft.example/raw",
        warnings: [],
      });
    };

    await runCli(["upload", htmlFile], {
      version: "0.1.0",
      statePaths,
      fetchImpl,
      output: captureOutput(),
    });

    expect(uploadedLength).toBe(html.length);
  });
});

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pushdraft-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function captureOutput(): CliOutput & { logs: string[]; warnings: string[] } {
  const logs: string[] = [];
  const warnings: string[] = [];
  return {
    logs,
    warnings,
    log: (message = "") => logs.push(message),
    warn: (message = "") => warnings.push(message),
  };
}

function uploadRecorder(
  draftIds: Array<string | null | undefined>,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (_input, init) => {
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
    draftIds.push(uploadPayloadSchema.parse(JSON.parse(init.body) as unknown).draftId);
    return Response.json({
      ok: true,
      draftId: "q43kvvtxix1x",
      versionId: "version_1",
      versionNumber: draftIds.length,
      title: "Private plan",
      requestId: null,
      publicUrl: "https://q43kvvtxix1x.pushdraft.example",
      rawUrl: "https://q43kvvtxix1x.pushdraft.example/raw",
      warnings: [],
    });
  };
}

function uploadResponse(versionNumber = 1): Response {
  return Response.json({
    ok: true,
    draftId: "q43kvvtxix1x",
    versionId: `version_${versionNumber}`,
    versionNumber,
    title: "Draft",
    requestId: null,
    publicUrl: "https://q43kvvtxix1x.pushdraft.example",
    rawUrl: "https://q43kvvtxix1x.pushdraft.example/raw",
    warnings: [],
  });
}
