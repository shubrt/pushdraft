import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, test } from "vite-plus/test";

import {
  getDraftDetail,
  getStoredReference,
  InvalidDraftReferenceError,
  uploadDraft,
} from "../src/drafts/repository";
import type { HtmlValidation } from "../src/drafts/html-policy";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  type FakeDatabase,
  type QueryCall,
  unexpectedQuery,
} from "./helpers";

const ACCOUNT_ID = "acct_references";
const API_KEY_ID = "key_references";
const TARGET_DRAFT_ID = "mnopqrstuvwx";

type FakeResult = {
  rows?: QueryResultRow[];
  rowCount?: number;
};

type QueryHandler = (call: QueryCall) => FakeResult | Promise<FakeResult>;

describe("draft uploads", () => {
  test("stores named image references on the immutable HTML version", async () => {
    const database = transactionalDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("SELECT id, title FROM drafts")) {
        return { rows: [{ id: TEST_DRAFT_ID, title: "Existing page" }] };
      }
      if (sql.startsWith("SELECT target.id AS target_draft_id")) {
        return { rows: [{ target_draft_id: TARGET_DRAFT_ID }] };
      }
      if (sql.includes("COALESCE(MAX(version_number), 0) + 1")) {
        return { rows: [{ next_version: 2 }] };
      }
      if (sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE drafts SET")) {
        return { rows: [] };
      }
      return unexpectedQuery(call);
    });

    const result = await uploadDraft(
      database,
      TEST_CONFIG,
      {
        html: '<!doctype html><title>Gallery</title><img src="./refs/hero">',
        draftId: TEST_DRAFT_ID,
        references: { hero: TARGET_DRAFT_ID },
      },
      validHtml("Gallery"),
      uploadContext(),
    );

    expect(result.versionNumber).toBe(2);
    expect(result.title).toBe("Gallery");

    const targetLookup = database.calls.find((call) =>
      compactSql(call.text).startsWith("SELECT target.id AS target_draft_id"),
    );
    expect(targetLookup?.values).toEqual([
      [TARGET_DRAFT_ID],
      ACCOUNT_ID,
      ["image/png", "image/jpeg", "image/webp"],
    ]);

    const referenceInsert = database.calls.find((call) =>
      compactSql(call.text).startsWith("INSERT INTO draft_version_references"),
    );
    expect(referenceInsert?.values.slice(1)).toEqual([["hero"], [TARGET_DRAFT_ID]]);
  });

  test("rejects a reference that is not an active owned raster image", async () => {
    const database = transactionalDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("SELECT id, title FROM drafts")) {
        return { rows: [{ id: TEST_DRAFT_ID, title: "Existing page" }] };
      }
      if (sql.startsWith("SELECT target.id AS target_draft_id")) return { rows: [] };
      return unexpectedQuery(call);
    });

    const upload = uploadDraft(
      database,
      TEST_CONFIG,
      {
        html: '<!doctype html><title>Gallery</title><img src="./refs/hero">',
        draftId: TEST_DRAFT_ID,
        references: { hero: TARGET_DRAFT_ID },
      },
      validHtml("Gallery"),
      uploadContext(),
    );

    await expect(upload).rejects.toBeInstanceOf(InvalidDraftReferenceError);
    expect(database.calls.some((call) => compactSql(call.text).startsWith("INSERT INTO"))).toBe(
      false,
    );
  });

  test("stores raster image bytes with image metadata", async () => {
    const database = transactionalDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE drafts SET")) {
        return { rows: [] };
      }
      return unexpectedQuery(call);
    });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    const result = await uploadDraft(
      database,
      TEST_CONFIG,
      {
        image: { mediaType: "image/png", base64: bytes.toString("base64") },
        filename: "hero.png",
      },
      null,
      uploadContext(),
    );

    expect(result.title).toBe("hero.png");
    expect(result.warnings).toEqual([]);
    const fileInsert = database.calls.find((call) =>
      compactSql(call.text).startsWith("INSERT INTO files"),
    );
    expect(fileInsert?.values[1]).toBe("image/png");
    expect(fileInsert?.values[2]).toBe("hero.png");
    expect(fileInsert?.values[3]).toBe(bytes.byteLength);
    expect(fileInsert?.values[5]).toEqual(bytes);

    const versionInsert = database.calls.find((call) =>
      compactSql(call.text).startsWith("INSERT INTO draft_versions"),
    );
    expect(versionInsert?.values[13]).toBe(false);
    expect(versionInsert?.values[14]).toBe("[]");
  });
});

describe("live draft references", () => {
  test("resolves a source version name to the target's current image version", async () => {
    const bytes = Buffer.from("current image bytes");
    const database = createFakeDatabase((call) => {
      if (compactSql(call.text).includes("FROM drafts AS source")) {
        return {
          rows: [
            {
              draft_id: TARGET_DRAFT_ID,
              version_number: 4,
              media_type: "image/webp",
              original_filename: "hero.webp",
              storage_backend: "postgres",
              inline_bytes: bytes,
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    const content = await getStoredReference(database, ACCOUNT_ID, TEST_DRAFT_ID, 2, "hero");

    expect(content).toEqual({
      draftId: TARGET_DRAFT_ID,
      versionNumber: 4,
      mediaType: "image/webp",
      filename: "hero.webp",
      bytes,
    });
    expect(database.calls[0]?.values).toEqual([
      TEST_DRAFT_ID,
      ACCOUNT_ID,
      2,
      "hero",
      ["image/png", "image/jpeg", "image/webp"],
    ]);
  });

  test("returns null when the reference cannot be resolved", async () => {
    const database = createFakeDatabase((call) =>
      compactSql(call.text).includes("FROM drafts AS source")
        ? { rows: [] }
        : unexpectedQuery(call),
    );

    await expect(
      getStoredReference(database, ACCOUNT_ID, TEST_DRAFT_ID, undefined, "missing"),
    ).resolves.toBeNull();
  });
});

describe("draft version descriptors", () => {
  test("maps raster image versions and keeps the version URL directory-relative", async () => {
    const createdAt = "2026-08-18T20:00:00.000Z";
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("COUNT(all_versions.id)::int AS version_count")) {
        return {
          rows: [
            {
              id: TEST_DRAFT_ID,
              title: "Hero",
              description: null,
              repo_org: null,
              repo_name: null,
              repo_host: null,
              created_at: createdAt,
              updated_at: createdAt,
              disabled_at: null,
              latest_version_number: 1,
              latest_version_at: createdAt,
              version_count: 1,
            },
          ],
        };
      }
      if (sql.includes("FROM draft_versions AS v JOIN files AS f")) {
        return {
          rows: [
            {
              id: "version_image",
              version_number: 1,
              created_at: createdAt,
              git_branch: null,
              git_commit_sha: null,
              git_commit_subject: null,
              git_dirty: null,
              cli_version: null,
              ci_provider: null,
              ci_run_url: null,
              ci_actor: null,
              file_id: "file_image",
              media_type: "image/png",
              original_filename: "hero.png",
              byte_size: 4,
              sha256: "a".repeat(64),
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    const detail = await getDraftDetail(database, TEST_CONFIG, ACCOUNT_ID, TEST_DRAFT_ID);

    expect(detail?.versions[0]?.file.content).toEqual({
      kind: "image",
      mediaType: "image/png",
    });
    expect(detail?.versions[0]?.publicUrl).toBe(`https://${TEST_DRAFT_ID}.pushdraft.example/v/1/`);
  });
});

function transactionalDatabase(handler: QueryHandler): FakeDatabase {
  const database = createFakeDatabase(handler);
  database.transaction = async <Value>(
    run: (client: PoolClient) => Promise<Value>,
  ): Promise<Value> => {
    const query = (text: string, values?: readonly unknown[]) => database.query(text, values);
    return run({ query } as unknown as PoolClient);
  };
  return database;
}

function validHtml(title: string): HtmlValidation {
  return {
    ok: true,
    errors: [],
    warnings: [],
    title,
    stats: { hasInlineScript: false, externalImageHosts: [] },
  };
}

function uploadContext() {
  return {
    apiKeyId: API_KEY_ID,
    accountId: ACCOUNT_ID,
    sourceIp: null,
    userAgent: null,
    requestId: null,
  };
}
