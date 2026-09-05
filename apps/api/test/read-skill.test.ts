import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";

import { readDraft, resolveDraftUrl } from "../../../skills/pushdraft-read/scripts/read.mjs";
import { createApp } from "../src/app";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  unexpectedQuery,
} from "./helpers";

const APEX = TEST_CONFIG.publicUrl.origin;
const ORIGIN = `https://${TEST_DRAFT_ID}.pushdraft.example`;

describe("read skill saved credentials", () => {
  test.each([
    [undefined, "saved-key"],
    ["", "saved-key"],
    [" \t ", "saved-key"],
    ["environment-key", "environment-key"],
  ])("uses saved credentials unless API_KEY is nonempty: %j", async (apiKey, expectedKey) => {
    const directory = await mkdtemp(path.join(tmpdir(), "read-skill-auth-test-"));
    try {
      await mkdir(path.join(directory, ".pushdraft"));
      await writeFile(
        path.join(directory, ".pushdraft", "credentials.json"),
        JSON.stringify({ apiKey: "saved-key" }),
      );
      const preload = path.join(directory, "preload.mjs");
      await writeFile(
        preload,
        `import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
os.homedir = () => ${JSON.stringify(directory)};
syncBuiltinESMExports();
globalThis.fetch = async (input, init) => {
  if (input !== ${JSON.stringify(`${ORIGIN}/raw`)}) throw new Error("Unexpected request URL");
  if (new Headers(init.headers).get("authorization") !== ${JSON.stringify(`Bearer ${expectedKey}`)}) {
    throw new Error("Wrong credential selected");
  }
  return new Response("<p>Verified draft</p>", { headers: {
    "x-postplan-draft-id": ${JSON.stringify(TEST_DRAFT_ID)},
    "x-postplan-draft-version": "1",
    "content-type": "text/html"
  } });
};`,
      );
      const env = { ...process.env, API_URL: APEX, API_KEY: apiKey };
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          pathToFileURL(preload).href,
          fileURLToPath(
            new URL("../../../skills/pushdraft-read/scripts/read.mjs", import.meta.url),
          ),
          ORIGIN,
        ],
        { env },
      );
      expect(result.stdout).toBe("<p>Verified draft</p>");
      expect(result.stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("read skill URL mapping", () => {
  test.each([
    [`${APEX}/${TEST_DRAFT_ID}?version=2`, "/v/2/raw"],
    [`${APEX}/${TEST_DRAFT_ID}/?version=2#section`, "/v/2/raw"],
    [`${APEX}/${TEST_DRAFT_ID}`, "/raw"],
    [ORIGIN, "/raw"],
    [`${ORIGIN}/raw`, "/raw"],
    [`${ORIGIN}/v/2`, "/v/2/raw"],
    [`${ORIGIN}/v/2/`, "/v/2/raw"],
    [`${ORIGIN}/v/2/raw`, "/v/2/raw"],
  ])("maps %s to the authenticated route", (input, pathname) => {
    expect(resolveDraftUrl(input, APEX).rawUrl).toBe(`${ORIGIN}${pathname}`);
  });

  test.each([
    `${APEX}/s/${"a".repeat(43)}`,
    `${APEX}/drafts/${TEST_DRAFT_ID}`,
    `${APEX}/${TEST_DRAFT_ID}?version=2/raw`,
    `${APEX}/${TEST_DRAFT_ID}?version=2&version=3`,
    `${ORIGIN}/v/0`,
    `${ORIGIN}/v/2147483648`,
    `${ORIGIN}/raw?version=2`,
    `https://${TEST_DRAFT_ID}.evil.example/raw`,
    `https://nested.${TEST_DRAFT_ID}.pushdraft.example/raw`,
    `https://user:secret@${TEST_DRAFT_ID}.pushdraft.example/raw`,
    `http://${TEST_DRAFT_ID}.pushdraft.example/raw`,
  ])("rejects unsupported or mismatched URL %s", (input) => {
    expect(() => resolveDraftUrl(input, APEX)).toThrow();
  });

  test("preserves the configured preview origin and local port", () => {
    const apex = "http://preview.localhost:3003";
    expect(resolveDraftUrl(`${apex}/${TEST_DRAFT_ID}?version=2`, apex).rawUrl).toBe(
      `http://${TEST_DRAFT_ID}.preview.localhost:3003/v/2/raw`,
    );
  });
});

describe("read skill responses", () => {
  test("reads version 2 from the real authenticated API", async () => {
    const html = "<!doctype html><title>Version two</title>\n<p>Exact draft bytes</p>";
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("UPDATE api_keys AS k")) {
        return {
          rows: [
            { id: "key_owner", account_id: "acct_owner", name: "test", account_name: "Owner" },
          ],
        };
      }
      if (sql.includes("JOIN files AS f")) {
        expect(call.values).toEqual([TEST_DRAFT_ID, "acct_owner", 2]);
        return {
          rows: [
            {
              draft_id: TEST_DRAFT_ID,
              version_number: 2,
              media_type: "text/html",
              original_filename: "draft.html",
              storage_backend: "postgres",
              inline_bytes: Buffer.from(html),
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });
    const app = createApp({ config: TEST_CONFIG, database });
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      return app.handle(new Request(input, init));
    };
    expect(
      await readDraft(resolveDraftUrl(`${APEX}/${TEST_DRAFT_ID}?version=2`, APEX), "test-key", {
        fetchImpl,
      }),
    ).toBe(html);
  });

  test("rejects the real HTTP-200 sign-in page", async () => {
    const app = createApp({ config: TEST_CONFIG, database: createFakeDatabase(unexpectedQuery) });
    const fetchImpl = async () => app.handle(new Request(`${APEX}/${TEST_DRAFT_ID}?version=2/raw`));
    await expect(
      readDraft(resolveDraftUrl(ORIGIN, APEX), "test-key", { fetchImpl }),
    ).rejects.toThrow("not the requested draft");
  });

  test.each([
    [401, TEST_DRAFT_ID, "2", "text/html", "HTTP 401"],
    [404, TEST_DRAFT_ID, "2", "text/html", "HTTP 404"],
    [302, TEST_DRAFT_ID, "2", "text/html", "HTTP 302"],
    [200, "otherdraft12", "2", "text/html", "not the requested draft"],
    [200, TEST_DRAFT_ID, "3", "text/html", "not the requested draft"],
    [200, TEST_DRAFT_ID, "2", "image/png", "not HTML"],
  ])("rejects invalid response %s %s %s %s", async (status, id, version, contentType, error) => {
    const fetchImpl = async () =>
      new Response("not draft HTML", {
        status,
        headers: {
          "x-postplan-draft-id": id,
          "x-postplan-draft-version": version,
          "content-type": contentType,
        },
      });
    await expect(
      readDraft(resolveDraftUrl(`${ORIGIN}/v/2`, APEX), "test-key", { fetchImpl }),
    ).rejects.toThrow(error);
  });

  test("isolates concurrent private files and cleans up after success or failure", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "read-skill-test-"));
    let arrived = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = async () => {
      const response = new Response("unused", {
        headers: {
          "x-postplan-draft-id": TEST_DRAFT_ID,
          "x-postplan-draft-version": "2",
          "content-type": "text/html",
        },
      });
      response.arrayBuffer = async () => {
        const invocation = ++arrived;
        if (arrived === 2) release();
        await bothStarted;
        const directories = await readdir(tempRoot);
        expect(directories).toHaveLength(2);
        for (const directory of directories) {
          expect((await stat(path.join(tempRoot, directory))).mode & 0o777).toBe(0o700);
        }
        return new TextEncoder().encode(`document ${invocation}`).buffer;
      };
      return response;
    };
    try {
      const target = resolveDraftUrl(ORIGIN, APEX);
      const contents = await Promise.all([
        readDraft(target, "test-key", { fetchImpl, tempRoot }),
        readDraft(target, "test-key", { fetchImpl, tempRoot }),
      ]);
      expect(contents.sort()).toEqual(["document 1", "document 2"]);
      expect(await readdir(tempRoot)).toEqual([]);
      const failFetch = async () => {
        const response = await fetchImpl();
        response.arrayBuffer = async () => {
          throw new Error("Body interrupted");
        };
        return response;
      };
      await expect(
        readDraft(target, "test-key", { fetchImpl: failFetch, tempRoot }),
      ).rejects.toThrow("Body interrupted");
      expect(await readdir(tempRoot)).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
