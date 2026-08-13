import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const schemaPath = new URL("../src/db/schema.sql", import.meta.url);

describe("database schema", () => {
  test("keeps immutable file contents separate from draft versions", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const files = tableSection(schema, "files");
    const versions = tableSection(schema, "draft_versions");
    const drafts = tableSection(schema, "drafts");
    const tickets = tableSection(schema, "draft_access_tickets");

    expect(files).toMatch(/media_type\s+TEXT\s+NOT NULL/i);
    expect(files).toMatch(/storage_backend\s+TEXT\s+NOT NULL/i);
    expect(files).toMatch(/inline_bytes\s+BYTEA/i);
    expect(files).toMatch(/object_key\s+TEXT/i);
    expect(files).toContain("files_storage_location_check");

    expect(versions).toMatch(/file_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+files\s*\(id\)/i);
    expect(versions).not.toMatch(
      /inline_bytes|object_key|storage_backend|\bhtml\s+(?:TEXT|BYTEA)/i,
    );
    expect(drafts).not.toMatch(/inline_bytes|object_key|storage_backend|\bhtml\s+(?:TEXT|BYTEA)/i);
    expect(tickets).toMatch(/version_number\s+INTEGER/i);
    expect(tickets).not.toMatch(/^\s*target_path\s+TEXT/im);
  });

  test("uses idempotent guards for repeatable migration DDL", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const createTables = schema.match(/\bCREATE\s+TABLE\b/gi) ?? [];
    const guardedTables = schema.match(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/gi) ?? [];
    const createIndexes = schema.match(/\bCREATE\s+INDEX\b/gi) ?? [];
    const guardedIndexes = schema.match(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi) ?? [];

    expect(createTables.length).toBeGreaterThan(0);
    expect(guardedTables).toHaveLength(createTables.length);
    expect(guardedIndexes).toHaveLength(createIndexes.length);
    expect(schema).toMatch(
      /IF\s+NOT\s+EXISTS\s*\([\s\S]*?pg_constraint[\s\S]*?ALTER\s+TABLE\s+drafts[\s\S]*?ADD\s+CONSTRAINT\s+drafts_current_version_id_fkey/i,
    );
  });
});

function tableSection(schema: string, tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`;
  const start = schema.indexOf(marker);
  if (start === -1) throw new Error(`Missing table ${tableName}.`);
  const nextTable = schema.indexOf("\nCREATE TABLE IF NOT EXISTS ", start + marker.length);
  return schema.slice(start, nextTable === -1 ? schema.length : nextTable);
}
