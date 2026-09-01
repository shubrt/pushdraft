import { describe, expect, test } from "vite-plus/test";

import { seedPreviewAccount } from "../src/auth/repository";
import { compactSql, createFakeDatabase } from "./helpers";

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
