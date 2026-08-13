import type { QueryResult, QueryResultRow } from "pg";

import type { AppConfig } from "../src/config";
import type { Database } from "../src/db/database";

export const TEST_DRAFT_ID = "abcdefghijkl";

export const TEST_CONFIG: AppConfig = {
  port: 3003,
  databaseUrl: "postgres://unused",
  publicUrl: new URL("https://pp.example"),
  sessionSecret: "test-session-secret-with-at-least-32-bytes",
  shooBaseUrl: new URL("https://shoo.dev"),
  maxHtmlBytes: 512 * 1024,
  isProduction: true,
};

export type QueryCall = {
  text: string;
  values: readonly unknown[];
};

type FakeQueryResult = {
  rows?: QueryResultRow[];
  rowCount?: number;
};

type QueryHandler = (call: QueryCall) => FakeQueryResult | Promise<FakeQueryResult>;

export type FakeDatabase = Database & {
  calls: QueryCall[];
};

export function createFakeDatabase(handler?: QueryHandler): FakeDatabase {
  const calls: QueryCall[] = [];

  const query = async <Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> => {
    const call = { text, values: values ?? [] };
    calls.push(call);
    const result = (await handler?.(call)) ?? {};
    const rows = (result.rows ?? []) as Row[];

    return {
      command: "SELECT",
      rowCount: result.rowCount ?? rows.length,
      oid: 0,
      fields: [],
      rows,
    };
  };

  return {
    calls,
    query,
    async transaction() {
      throw new Error("Unexpected transaction in HTTP test.");
    },
    async migrate() {},
    async close() {},
  };
}

export function unexpectedQuery(call: QueryCall): never {
  throw new Error(`Unexpected database query: ${compactSql(call.text)}`);
}

export function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
