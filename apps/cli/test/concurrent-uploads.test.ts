import { afterEach, describe, expect, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { uploadPayloadSchema, type UploadPayload } from "@pushdraft/contracts";

import { runCli } from "../src/app.js";
import { createStatePaths, readDraftState, saveCredentials } from "../src/state.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pushdraft-concurrent-"));
  directories.push(directory);
  const statePaths = createStatePaths(directory);
  const files = [path.join(directory, "a.html"), path.join(directory, "b.html")];
  for (const file of files) fs.writeFileSync(file, "<title>Concurrent upload</title>");
  const runner = path.join(directory, "run.ts");
  fs.writeFileSync(
    runner,
    `
    import { runCli } from ${JSON.stringify(new URL("../src/app.ts", import.meta.url).href)};
    import { createStatePaths } from ${JSON.stringify(new URL("../src/state.ts", import.meta.url).href)};
    await runCli(["upload", process.argv[2]], { statePaths: createStatePaths(process.argv[3]), version: "test", output: { log() {}, warn() {} } });
  `,
  );
  function upload(file: string) {
    return new Promise<void>((resolve, reject) => {
      const env = { ...process.env };
      delete env.API_KEY;
      delete env.API_URL;
      const child = spawn("bun", [runner, file, directory], {
        env,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let errors = "";
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        errors += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`CLI exited ${code}: ${errors}`)),
      );
    });
  }
  return { directory, statePaths, files, upload };
}

async function serve(handler: (payload: UploadPayload) => Promise<string>) {
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const payload = uploadPayloadSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString()) as unknown,
      );
      const draftId = await handler(payload);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          draftId,
          versionId: "version",
          versionNumber: 1,
          title: "Draft",
          requestId: null,
          publicUrl: `https://${draftId}.example`,
          rawUrl: `https://${draftId}.example/raw`,
          warnings: [],
        }),
      );
    })().catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("concurrent CLI processes", () => {
  test("retains different files at a response barrier and reuses both IDs", async () => {
    const { files, statePaths, upload } = fixture();
    const payloads: UploadPayload[] = [];
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await serve(async (payload) => {
      payloads.push(payload);
      if (payloads.length === 2) release();
      await barrier;
      return payload.filename === "a.html" ? "aaaaaaaaaaaa" : "bbbbbbbbbbbb";
    });
    saveCredentials(statePaths, "test-key", server.url);
    try {
      await Promise.all(files.map(upload));
      const state = readDraftState(statePaths);
      expect(files.map((file) => state.files[file]?.draftId)).toEqual([
        "aaaaaaaaaaaa",
        "bbbbbbbbbbbb",
      ]);
      await Promise.all(files.map(upload));
      expect(payloads.slice(0, 2).map((payload) => payload.draftId)).toEqual([null, null]);
      expect(
        payloads
          .slice(2)
          .map((payload) => payload.draftId)
          .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
      ).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    } finally {
      release();
      await server.close();
    }
  });

  test("serializes first uploads of the same file before choosing create or update", async () => {
    const { files, statePaths, upload } = fixture();
    const file = files[0];
    if (file === undefined) throw new Error("Missing file");
    const draftIds: Array<string | null | undefined> = [];
    const server = await serve(async (payload) => {
      draftIds.push(payload.draftId);
      await setTimeout(100);
      return "aaaaaaaaaaaa";
    });
    saveCredentials(statePaths, "test-key", server.url);
    try {
      await Promise.all([upload(file), upload(file)]);
      expect(draftIds).toEqual([null, "aaaaaaaaaaaa"]);
    } finally {
      await server.close();
    }
  });

  test("releases file locks after failed requests", async () => {
    const { files, statePaths } = fixture();
    const file = files[0];
    if (file === undefined) throw new Error("Missing file");
    saveCredentials(statePaths, "test-key", "https://api.example");
    const options = {
      statePaths,
      version: "test",
      output: { log() {}, warn() {} },
      fetchImpl: async () => new Response("failed", { status: 500 }),
    };
    await expect(runCli(["upload", file], options)).rejects.toThrow("HTTP 500");
    await expect(runCli(["upload", file], options)).rejects.toThrow("HTTP 500");
    expect(fs.readdirSync(statePaths.directory).filter((name) => name.includes(".lock"))).toEqual(
      [],
    );
  });
});
