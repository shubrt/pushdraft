import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, test } from "vite-plus/test";

import { sha256 } from "../src/lib/crypto";
import {
  consumeDraftShareAccessTicket,
  createDraftShare,
  createDraftShareAccessTicket,
  findActiveDraftShare,
  getStoredSharedReference,
  listActiveDraftShares,
  revokeDraftShare,
} from "../src/shares/repository";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  type FakeDatabase,
  type QueryCall,
  unexpectedQuery,
} from "./helpers";

const ACCOUNT_ID = "acct_shares";
const SHARE_ID = "ShareId1234567890Abc";
const SOURCE_VERSION_ID = "SourceVersionId12345";
const TARGET_DRAFT_ID = "mnopqrstuvwx";
const CREATED_AT = "2026-09-01T10:00:00.000Z";
const EXPIRES_AT = "2026-09-08T10:00:00.000Z";

type FakeResult = {
  rows?: QueryResultRow[];
  rowCount?: number;
};

type QueryHandler = (call: QueryCall) => FakeResult | Promise<FakeResult>;

describe("draft share creation", () => {
  test("stores only the token hash and snapshots the current source and reference versions", async () => {
    const database = transactionalDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("SELECT d.id AS draft_id")) {
        return {
          rows: [
            {
              draft_id: TEST_DRAFT_ID,
              draft_version_id: SOURCE_VERSION_ID,
              version_number: 7,
              reference_count: 1,
            },
          ],
        };
      }
      if (sql.startsWith("INSERT INTO draft_shares")) {
        return { rows: [{ created_at: CREATED_AT, expires_at: EXPIRES_AT }] };
      }
      if (sql.startsWith("INSERT INTO draft_share_references")) return { rowCount: 1 };
      return unexpectedQuery(call);
    });

    const share = await createDraftShare(database, TEST_CONFIG, ACCOUNT_ID, TEST_DRAFT_ID, 604_800);

    expect(share).not.toBeNull();
    if (!share) throw new Error("Expected a created draft share.");
    expect(share).toMatchObject({
      draftId: TEST_DRAFT_ID,
      versionNumber: 7,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    });
    expect(share.url).toBe(`https://pushdraft.example/s/${share.token}`);

    const sourceLookup = database.calls.find((call) =>
      compactSql(call.text).startsWith("SELECT d.id AS draft_id"),
    );
    const sourceSql = compactSql(sourceLookup?.text ?? "");
    expect(sourceLookup?.values).toEqual([TEST_DRAFT_ID, ACCOUNT_ID]);
    expect(sourceSql).toContain("v.id = d.current_version_id");
    expect(sourceSql).toContain("FOR SHARE OF d");

    const shareInsert = database.calls.find((call) =>
      compactSql(call.text).startsWith("INSERT INTO draft_shares"),
    );
    expect(shareInsert?.values).toEqual([
      share.id,
      TEST_DRAFT_ID,
      SOURCE_VERSION_ID,
      sha256(share.token),
      604_800,
    ]);
    expect(shareInsert?.values).not.toContain(share.token);

    const snapshotInsert = database.calls.find((call) =>
      compactSql(call.text).startsWith("INSERT INTO draft_share_references"),
    );
    const snapshotSql = compactSql(snapshotInsert?.text ?? "");
    expect(snapshotInsert?.values).toEqual([
      share.id,
      SOURCE_VERSION_ID,
      ACCOUNT_ID,
      ["image/png", "image/jpeg", "image/webp"],
    ]);
    expect(snapshotSql).toContain("reference.source_version_id = $2");
    expect(snapshotSql).toContain("target.account_id = $3");
    expect(snapshotSql).toContain("target.deleted_at IS NULL");
    expect(snapshotSql).toContain("target.disabled_at IS NULL");
    expect(snapshotSql).toContain("target_file.media_type = ANY($4::text[])");
    expect(snapshotSql).toContain("target_version.id = target.current_version_id");
    expect(snapshotSql).toContain("target_version_id");
  });

  test("rejects creation when every source reference cannot be snapshotted", async () => {
    const database = transactionalDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("SELECT d.id AS draft_id")) {
        return {
          rows: [
            {
              draft_id: TEST_DRAFT_ID,
              draft_version_id: SOURCE_VERSION_ID,
              version_number: 7,
              reference_count: 1,
            },
          ],
        };
      }
      if (sql.startsWith("INSERT INTO draft_shares")) {
        return { rows: [{ created_at: CREATED_AT, expires_at: EXPIRES_AT }] };
      }
      if (sql.startsWith("INSERT INTO draft_share_references")) return { rowCount: 0 };
      return unexpectedQuery(call);
    });

    await expect(
      createDraftShare(database, TEST_CONFIG, ACCOUNT_ID, TEST_DRAFT_ID, 604_800),
    ).rejects.toThrow("Draft references could not be shared.");
  });
});

describe("owner share management", () => {
  test("lists only active shares for the owned draft", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("FROM draft_shares AS share")) {
        return {
          rows: [
            {
              id: SHARE_ID,
              draft_id: TEST_DRAFT_ID,
              version_number: 7,
              created_at: CREATED_AT,
              expires_at: EXPIRES_AT,
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    await expect(listActiveDraftShares(database, ACCOUNT_ID, TEST_DRAFT_ID)).resolves.toEqual([
      {
        id: SHARE_ID,
        draftId: TEST_DRAFT_ID,
        versionNumber: 7,
        createdAt: CREATED_AT,
        expiresAt: EXPIRES_AT,
      },
    ]);

    const call = database.calls[0];
    const sql = compactSql(call?.text ?? "");
    expect(call?.values).toEqual([ACCOUNT_ID, TEST_DRAFT_ID]);
    expect(sql).toContain("draft.account_id = $1");
    expect(sql).toContain("draft.id = $2");
    expect(sql).toContain("share.revoked_at IS NULL");
    expect(sql).toContain("share.expires_at > now()");
  });

  test("revokes a share only through its owner and draft", async () => {
    const database = createFakeDatabase((call) => {
      if (compactSql(call.text).startsWith("UPDATE draft_shares AS share")) {
        return { rowCount: 1 };
      }
      return unexpectedQuery(call);
    });

    await expect(revokeDraftShare(database, ACCOUNT_ID, TEST_DRAFT_ID, SHARE_ID)).resolves.toBe(
      true,
    );

    const call = database.calls[0];
    const sql = compactSql(call?.text ?? "");
    expect(call?.values).toEqual([SHARE_ID, TEST_DRAFT_ID, ACCOUNT_ID]);
    expect(sql).toContain("share.draft_id = $2");
    expect(sql).toContain("draft.account_id = $3");
    expect(sql).toContain("share.revoked_at IS NULL");
  });
});

describe("draft share access", () => {
  test("hashes share and ticket tokens and consumes the ticket in one query", async () => {
    const rawShareToken = "raw-share-token";
    const ticketDatabase = createFakeDatabase((call) => {
      if (compactSql(call.text).startsWith("WITH expired_tickets AS")) {
        return { rows: [{ draft_id: TEST_DRAFT_ID, version_number: 7 }] };
      }
      return unexpectedQuery(call);
    });

    const ticket = await createDraftShareAccessTicket(ticketDatabase, rawShareToken);

    expect(ticket).not.toBeNull();
    if (!ticket) throw new Error("Expected a draft share access ticket.");
    expect(ticket).toMatchObject({ draftId: TEST_DRAFT_ID, versionNumber: 7 });
    const createCall = ticketDatabase.calls[0];
    const createSql = compactSql(createCall?.text ?? "");
    expect(createCall?.values).toEqual([sha256(rawShareToken), sha256(ticket.token), 60]);
    expect(createCall?.values).not.toContain(rawShareToken);
    expect(createCall?.values).not.toContain(ticket.token);
    expect(createSql).toContain("DELETE FROM draft_share_access_tickets");
    expect(createSql).toContain("expires_at <= now()");
    expect(createSql).toContain("INSERT INTO draft_share_access_tickets");

    const consumeDatabase = createFakeDatabase((call) => {
      if (compactSql(call.text).startsWith("WITH active_ticket AS MATERIALIZED")) {
        return {
          rows: [
            {
              share_id: SHARE_ID,
              draft_id: TEST_DRAFT_ID,
              version_number: 7,
              expires_at: EXPIRES_AT,
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    await expect(
      consumeDraftShareAccessTicket(consumeDatabase, ticket.token, TEST_DRAFT_ID),
    ).resolves.toEqual({
      shareId: SHARE_ID,
      draftId: TEST_DRAFT_ID,
      versionNumber: 7,
      expiresAt: EXPIRES_AT,
    });

    const consumeCall = consumeDatabase.calls[0];
    const consumeSql = compactSql(consumeCall?.text ?? "");
    expect(consumeCall?.values).toEqual([sha256(ticket.token), TEST_DRAFT_ID]);
    expect(consumeCall?.values).not.toContain(ticket.token);
    expect(consumeSql).toContain("DELETE FROM draft_share_access_tickets AS ticket");
    expect(consumeSql).toContain("JOIN consumed_ticket USING (token_hash)");
  });

  test("looks up only an active share for the expected draft", async () => {
    const database = createFakeDatabase((call) => {
      if (compactSql(call.text).includes("FROM draft_shares AS share")) {
        return {
          rows: [
            {
              share_id: SHARE_ID,
              draft_id: TEST_DRAFT_ID,
              version_number: 7,
              expires_at: EXPIRES_AT,
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    await expect(findActiveDraftShare(database, SHARE_ID, TEST_DRAFT_ID)).resolves.toEqual({
      shareId: SHARE_ID,
      draftId: TEST_DRAFT_ID,
      versionNumber: 7,
      expiresAt: EXPIRES_AT,
    });

    const call = database.calls[0];
    const sql = compactSql(call?.text ?? "");
    expect(call?.values).toEqual([SHARE_ID, TEST_DRAFT_ID]);
    expect(sql).toContain("share.id = $1");
    expect(sql).toContain("share.draft_id = $2");
    expect(sql).toContain("share.revoked_at IS NULL");
    expect(sql).toContain("share.expires_at > now()");
  });

  test("loads a reference from its snapshotted target version", async () => {
    const bytes = Buffer.from("snapshotted image bytes");
    const database = createFakeDatabase((call) => {
      if (compactSql(call.text).includes("FROM draft_shares AS share")) {
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

    await expect(
      getStoredSharedReference(database, SHARE_ID, TEST_DRAFT_ID, "hero"),
    ).resolves.toEqual({
      draftId: TARGET_DRAFT_ID,
      versionNumber: 4,
      mediaType: "image/webp",
      filename: "hero.webp",
      bytes,
    });

    const call = database.calls[0];
    const sql = compactSql(call?.text ?? "");
    expect(call?.values).toEqual([
      SHARE_ID,
      TEST_DRAFT_ID,
      "hero",
      ["image/png", "image/jpeg", "image/webp"],
    ]);
    expect(sql).toContain("target_version.id = reference.target_version_id");
    expect(sql).not.toContain("target.current_version_id");
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
