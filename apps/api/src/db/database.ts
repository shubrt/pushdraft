import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import type { AppConfig } from "../config";

const { Pool } = pg;

export type Database = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  transaction<Value>(run: (client: PoolClient) => Promise<Value>): Promise<Value>;
  migrate(): Promise<void>;
  close(): Promise<void>;
};

export function createDatabase(config: Pick<AppConfig, "databaseUrl">): Database {
  const pool = new Pool({ connectionString: config.databaseUrl });

  return {
    query: <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) =>
      pool.query<Row>(text, values ? [...values] : undefined),
    async transaction<Value>(run: (client: PoolClient) => Promise<Value>): Promise<Value> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await run(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async migrate() {
      const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
      await pool.query(await readFile(schemaPath, "utf8"));
    },
    close: () => pool.end(),
  };
}
