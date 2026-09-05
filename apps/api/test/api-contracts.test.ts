import { describe, expect, test } from "vite-plus/test";
import {
  apiErrorSchema,
  draftDetailResponseSchema,
  draftListResponseSchema,
  meResponseSchema,
  uploadResponseSchema,
} from "@pushdraft/contracts";
import type { PoolClient, QueryResultRow } from "pg";

import { createApp } from "../src/app";
import { getDraftDetail } from "../src/drafts/repository";
import { sha256 } from "../src/lib/crypto";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  unexpectedQuery,
  type FakeDatabase,
  type QueryCall,
} from "./helpers";

import {
  ANIMATED_PNG,
  CORRUPT_ANIMATED_PNG,
  CORRUPT_IMAGE_FIXTURES,
  IMAGE_FIXTURES,
  JPEG,
  OVERSIZED_PNG,
} from "./image-fixtures";

const API_TOKEN = "pushdraft_contract-test-token";
const ACCOUNT_ID = "acct_contracts";
const CREATED_AT = "2026-08-13T20:30:00.000Z";
const FILE_SHA256 = "a".repeat(64);

type FakeResult = {
  rows?: QueryResultRow[];
  rowCount?: number;
};

type QueryHandler = (call: QueryCall) => FakeResult | Promise<FakeResult>;

describe("API response contracts", () => {
  test("GET /api/me matches the shared contract", async () => {
    const response = await apiRequest("/api/me", authenticatedDatabase());

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await responseJson(response))).toEqual({
      accountId: ACCOUNT_ID,
      accountName: "Contract account",
      apiKeyId: "key_contracts",
      apiKeyName: "Contract key",
    });
  });

  test("GET /api/drafts matches the shared contract", async () => {
    const database = authenticatedDatabase((call) => {
      if (compactSql(call.text).includes("COUNT(all_versions.id)::int AS version_count")) {
        return { rows: [draftRow()] };
      }
      return unexpectedQuery(call);
    });

    const response = await apiRequest("/api/drafts", database);
    const body = draftListResponseSchema.parse(await responseJson(response));

    expect(response.status).toBe(200);
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0]?.draftId).toBe(TEST_DRAFT_ID);
  });

  test("POST /api/uploads creates an HTML-only payload without a filename", async () => {
    const database = transactionalDatabase(uploadWriteHandler());
    const response = await apiRequest("/api/uploads", database, {
      method: "POST",
      body: JSON.stringify({ html: "<!doctype html><title>New draft</title>" }),
    });
    const body = uploadResponseSchema.parse(await responseJson(response));

    expect(response.status).toBe(201);
    expect(body.versionNumber).toBe(1);
    expect(body.title).toBe("New draft");

    const fileInsert = database.calls.find((call) =>
      compactSql(call.text).startsWith("INSERT INTO files"),
    );
    expect(fileInsert?.values[2]).toBe("draft.html");
  });

  test("POST /api/uploads updates a known draft", async () => {
    const database = transactionalDatabase(
      uploadWriteHandler((call) => {
        const sql = compactSql(call.text);
        if (sql.startsWith("SELECT id, title FROM drafts")) {
          return { rows: [{ id: TEST_DRAFT_ID, title: "Old title" }] };
        }
        if (sql.includes("COALESCE(MAX(version_number), 0) + 1")) {
          return { rows: [{ next_version: 2 }] };
        }
        return null;
      }),
    );
    const response = await apiRequest("/api/uploads", database, {
      method: "POST",
      body: JSON.stringify({
        html: "<!doctype html><title>Updated draft</title>",
        draftId: TEST_DRAFT_ID,
      }),
    });
    const body = uploadResponseSchema.parse(await responseJson(response));

    expect(response.status).toBe(200);
    expect(body.draftId).toBe(TEST_DRAFT_ID);
    expect(body.versionNumber).toBe(2);
    expect(body.title).toBe("Updated draft");
  });

  test.each(IMAGE_FIXTURES)(
    "POST /api/uploads preserves validated %s bytes",
    async (mediaType, bytes) => {
      const database = transactionalDatabase(uploadWriteHandler());
      const response = await apiRequest("/api/uploads", database, {
        method: "POST",
        body: JSON.stringify({
          image: { mediaType, base64: bytes.toString("base64") },
          filename: "hero.image",
        }),
      });
      const body = uploadResponseSchema.parse(await responseJson(response));

      expect(response.status).toBe(201);
      expect(body.title).toBe("hero.image");
      const fileInsert = database.calls.find((call) =>
        compactSql(call.text).startsWith("INSERT INTO files"),
      );
      expect(fileInsert?.values.slice(1, 4)).toEqual([mediaType, "hero.image", bytes.byteLength]);
      expect(fileInsert?.values[5]).toEqual(bytes);
    },
  );
});

describe("API error contracts", () => {
  test.each([ANIMATED_PNG, CORRUPT_ANIMATED_PNG])(
    "rejects APNG before persistence",
    async (bytes) => {
      const database = authenticatedDatabase();
      const response = await apiRequest("/api/uploads", database, {
        method: "POST",
        body: JSON.stringify({
          image: { mediaType: "image/png", base64: bytes.toString("base64") },
        }),
      });
      expect(response.status).toBe(422);
      expect(await responseJson(response)).toEqual({
        ok: false,
        errors: ["Animated PNG images are not supported. Use a static PNG or animated WebP."],
        warnings: [],
      });
      expect(database.calls).toHaveLength(1);
    },
  );

  test.each([
    ...IMAGE_FIXTURES.map(([mediaType, bytes]) => [mediaType, bytes.subarray(0, 12)] as const),
    ...CORRUPT_IMAGE_FIXTURES,
  ])("rejects incomplete or corrupt %s before persistence", async (mediaType, bytes) => {
    const database = authenticatedDatabase();
    const response = await apiRequest("/api/uploads", database, {
      method: "POST",
      body: JSON.stringify({ image: { mediaType, base64: bytes.toString("base64") } }),
    });
    expect(response.status).toBe(422);
    expect(apiErrorSchema.parse(await responseJson(response)).ok).toBe(false);
    expect(database.calls).toHaveLength(1);
  });

  test("returns 422 before persistence for a small upload with too many pixels", async () => {
    const database = authenticatedDatabase();
    const response = await apiRequest("/api/uploads", database, {
      method: "POST",
      body: JSON.stringify({
        image: { mediaType: "image/png", base64: OVERSIZED_PNG.toString("base64") },
      }),
    });
    expect(response.status).toBe(422);
    expect(await responseJson(response)).toEqual({
      ok: false,
      errors: ["Image exceeds the limit of 16777216 decoded pixels."],
      warnings: [],
    });
    expect(database.calls).toHaveLength(1);
  });

  test("retains the supported format list by rejecting GIF", async () => {
    const database = authenticatedDatabase();
    const response = await apiRequest("/api/uploads", database, {
      method: "POST",
      body: JSON.stringify({
        image: {
          mediaType: "image/gif",
          base64: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        },
      }),
    });
    expect(response.status).toBe(422);
    expect(database.calls).toHaveLength(1);
  });

  test("returns a contract error for malformed JSON", async () => {
    const response = await apiRequest("/api/uploads", authenticatedDatabase(), {
      method: "POST",
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await responseJson(response))).toEqual({
      ok: false,
      error: "Malformed JSON body.",
    });
  });

  test("returns a contract error without bearer authentication", async () => {
    const response = await request("/api/me", createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await responseJson(response)).ok).toBe(false);
  });

  test("returns a contract error for an unknown owned draft", async () => {
    const database = transactionalDatabase((call) => {
      if (compactSql(call.text).startsWith("SELECT id, title FROM drafts")) {
        return { rows: [] };
      }
      return unexpectedQuery(call);
    });
    const response = await apiRequest("/api/uploads", database, {
      method: "POST",
      body: JSON.stringify({ html: "<title>Missing</title>", draftId: TEST_DRAFT_ID }),
    });

    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await responseJson(response))).toEqual({
      ok: false,
      error: "Draft not found.",
    });
  });

  test("returns a contract error when HTML validation fails", async () => {
    const response = await apiRequest("/api/uploads", authenticatedDatabase(), {
      method: "POST",
      body: JSON.stringify({ html: "<title>Blocked</title><form></form>" }),
    });
    const body = apiErrorSchema.parse(await responseJson(response));

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect("errors" in body ? body.errors : []).not.toHaveLength(0);
  });

  test("rejects image bytes that do not match the declared media type", async () => {
    const jpeg = JPEG;
    const response = await apiRequest("/api/uploads", authenticatedDatabase(), {
      method: "POST",
      body: JSON.stringify({
        image: { mediaType: "image/png", base64: jpeg.toString("base64") },
        filename: "pretend.png",
      }),
    });
    const body = apiErrorSchema.parse(await responseJson(response));

    expect(response.status).toBe(422);
    expect(body).toEqual({
      ok: false,
      errors: ["Image bytes do not match declared media type image/png."],
      warnings: [],
    });
  });
});

describe("draft detail contract", () => {
  test("does not expose file storage fields", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("COUNT(all_versions.id)::int AS version_count")) {
        return { rows: [draftRow()] };
      }
      if (sql.includes("FROM draft_versions AS v JOIN files AS f")) {
        return {
          rows: [
            {
              id: "version_contracts",
              version_number: 1,
              created_at: CREATED_AT,
              git_branch: "main",
              git_commit_sha: "b".repeat(40),
              git_commit_subject: "docs: add private plan",
              git_dirty: false,
              cli_version: "0.1.0",
              ci_provider: null,
              ci_run_url: null,
              ci_actor: null,
              file_id: "file_contracts",
              media_type: "text/html",
              original_filename: "plan.html",
              byte_size: 42,
              sha256: FILE_SHA256,
              storage_backend: "postgres",
              inline_bytes: Buffer.from("private bytes"),
              object_key: "drafts/private/plan.html",
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    const detail = draftDetailResponseSchema.parse(
      await getDraftDetail(database, TEST_CONFIG, ACCOUNT_ID, TEST_DRAFT_ID),
    );
    const serialized = JSON.stringify(detail);

    expect(detail.versions).toHaveLength(1);
    for (const field of [
      "storage_backend",
      "storageBackend",
      "inline_bytes",
      "inlineBytes",
      "object_key",
      "objectKey",
    ]) {
      expect(serialized).not.toContain(field);
    }
  });
});

function authenticatedDatabase(handler: QueryHandler = unexpectedQuery): FakeDatabase {
  return createFakeDatabase((call) => {
    if (compactSql(call.text).includes("UPDATE api_keys AS k")) {
      return call.values[0] === sha256(API_TOKEN)
        ? {
            rows: [
              {
                id: "key_contracts",
                account_id: ACCOUNT_ID,
                name: "Contract key",
                account_name: "Contract account",
              },
            ],
          }
        : { rows: [] };
    }
    return handler(call);
  });
}

function transactionalDatabase(handler: QueryHandler): FakeDatabase {
  const database = authenticatedDatabase(handler);
  database.transaction = async <Value>(
    run: (client: PoolClient) => Promise<Value>,
  ): Promise<Value> => {
    const query = (text: string, values?: readonly unknown[]) => database.query(text, values);
    return run({ query } as unknown as PoolClient);
  };
  return database;
}

function uploadWriteHandler(read?: (call: QueryCall) => FakeResult | null): QueryHandler {
  return (call) => {
    const selected = read?.(call);
    if (selected) return selected;
    const sql = compactSql(call.text);
    if (sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE drafts SET")) {
      return { rows: [] };
    }
    return unexpectedQuery(call);
  };
}

function draftRow(): QueryResultRow {
  return {
    id: TEST_DRAFT_ID,
    title: "Private plan",
    description: "Contract fixture",
    repo_org: "shubrt",
    repo_name: "pushdraft",
    repo_host: "github.com",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    disabled_at: null,
    latest_version_number: 1,
    latest_version_at: CREATED_AT,
    version_count: 1,
  };
}

async function apiRequest(
  path: string,
  database: FakeDatabase,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${API_TOKEN}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return request(path, database, { ...init, headers });
}

async function request(
  path: string,
  database: FakeDatabase,
  init?: RequestInit,
): Promise<Response> {
  const app = createApp({ config: TEST_CONFIG, database });
  return app.handle(new Request(new URL(path, TEST_CONFIG.publicUrl), init));
}

async function responseJson(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}
