import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, test } from "vite-plus/test";

import { findOrCreateAccountForIdentity, seedPreviewAccount } from "../src/auth/repository";
import type { Database } from "../src/db/database";
import { compactSql, createFakeDatabase, type QueryCall } from "./helpers";

const SEED = {
  accountId: "acct_preview",
  accountName: "Preview",
  apiKeyHash: "ab".repeat(32),
};

describe("preview account seeding", () => {
  test("inserts the account and key hash without overwriting existing rows", async () => {
    const database = createFakeDatabase();

    await seedPreviewAccount(database, SEED);

    expect(database.calls).toHaveLength(2);

    const accountInsert = database.calls[0]!;
    expect(compactSql(accountInsert.text)).toContain(
      "INSERT INTO accounts (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    );
    expect(accountInsert.values).toEqual(["acct_preview", "Preview"]);

    const keyInsert = database.calls[1]!;
    expect(compactSql(keyInsert.text)).toContain("ON CONFLICT (key_hash) DO NOTHING");
    expect(keyInsert.values.slice(1)).toEqual(["acct_preview", "preview-seed", "ab".repeat(32)]);
    expect(keyInsert.values[0]).toMatch(/^[0-9a-zA-Z]{20}$/);
  });
});

const PROFILE = {
  email: "janis@example.com",
  emailVerified: true,
  displayName: "Janis",
  pictureUrl: null,
  piiSubject: "pii_stable",
};

function createTransactionDatabase(
  handler: (call: QueryCall) => { rows?: QueryResultRow[] },
): Database & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const query = async (text: string, values?: readonly unknown[]) => {
    const call = { text, values: values ?? [] };
    calls.push(call);
    const rows = handler(call).rows ?? [];
    return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
  };
  return {
    calls,
    query: query as Database["query"],
    transaction: (run) => run({ query } as unknown as PoolClient),
    async migrate() {},
    async close() {},
  };
}

describe("preview account adoption at sign-in", () => {
  test("attaches a new identity to the seeded account when adoption is requested", async () => {
    const database = createTransactionDatabase((call) => {
      if (call.text.includes("FROM identities")) return { rows: [] };
      if (call.text.includes("SELECT id FROM accounts")) return { rows: [{ id: "acct_preview" }] };
      return {};
    });

    const identity = await findOrCreateAccountForIdentity(
      database,
      "shoo",
      "ps_new",
      PROFILE,
      "acct_preview",
    );

    expect(identity.accountId).toBe("acct_preview");
    const statements = database.calls.map((call) => compactSql(call.text));
    expect(statements.some((text) => text.startsWith("INSERT INTO accounts"))).toBe(false);
    const identityInsert = database.calls.find((call) =>
      call.text.includes("INSERT INTO identities"),
    );
    expect(identityInsert?.values[1]).toBe("acct_preview");
  });

  test("creates a fresh account when the adoption target does not exist", async () => {
    const database = createTransactionDatabase((call) => {
      if (call.text.includes("FROM identities")) return { rows: [] };
      if (call.text.includes("SELECT id FROM accounts")) return { rows: [] };
      return {};
    });

    const identity = await findOrCreateAccountForIdentity(
      database,
      "shoo",
      "ps_new",
      PROFILE,
      "acct_missing",
    );

    expect(identity.accountId).toMatch(/^acct_/);
    expect(identity.accountId).not.toBe("acct_missing");
    const statements = database.calls.map((call) => compactSql(call.text));
    expect(statements.some((text) => text.startsWith("INSERT INTO accounts"))).toBe(true);
  });

  test("keeps the existing account when the identity is already known", async () => {
    const database = createTransactionDatabase((call) => {
      if (call.text.includes("FROM identities")) {
        return { rows: [{ account_id: "acct_existing", account_name: "Janis" }] };
      }
      return {};
    });

    const identity = await findOrCreateAccountForIdentity(
      database,
      "shoo",
      "ps_known",
      PROFILE,
      "acct_preview",
    );

    expect(identity.accountId).toBe("acct_existing");
    expect(database.calls.some((call) => call.text.includes("SELECT id FROM accounts"))).toBe(
      false,
    );
  });
});
