import { describe, expect, test } from "vite-plus/test";

import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/session";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  unexpectedQuery,
} from "./helpers";

const draftOrigin = `https://${TEST_DRAFT_ID}.pushdraft.example`;
const invalidVersions = [
  "2147483648",
  "9007199254740991",
  "999999999999999999999",
  "0",
  "-1",
  "1.5",
  "null",
  "1e2",
  "abc",
];

describe("version parameters", () => {
  test.each(invalidVersions)(
    "rejects %s across content, reference, and bridge routes",
    async (version) => {
      for (const path of [`/v/${version}/`, `/v/${version}/raw`, `/v/${version}/refs/hero`]) {
        const database = createFakeDatabase(unexpectedQuery);
        const result = await createApp({ config: TEST_CONFIG, database }).handle(
          new Request(`${draftOrigin}${path}`, {
            headers: { authorization: "Bearer owner" },
          }),
        );
        expect(result.status).toBe(404);
        expect(database.calls).toHaveLength(0);
      }
      const database = authenticatedDatabase();
      const result = await createApp({ config: TEST_CONFIG, database }).handle(
        new Request(`https://pushdraft.example/${TEST_DRAFT_ID}?version=${version}`, {
          headers: { cookie: `${SESSION_COOKIE}=session` },
        }),
      );
      expect(result.status).toBe(404);
      expect(database.calls).toHaveLength(1);
    },
  );

  test.each(["/raw", "/refs/hero", "/"])(
    "accepts the maximum database version on %s",
    async (suffix) => {
      const database = authenticatedDatabase((values) => expect(values[2]).toBe(2_147_483_647));
      const result = await createApp({ config: TEST_CONFIG, database }).handle(
        new Request(`${draftOrigin}/v/2147483647${suffix}`, {
          headers: { authorization: "Bearer owner" },
        }),
      );
      expect(result.status).toBe(404);
      expect(database.calls).toHaveLength(2);
    },
  );

  test.each([undefined, "2147483647"])(
    "passes the optional bridge version %s to the database",
    async (version) => {
      const database = authenticatedDatabase((values) =>
        expect(values[3]).toBe(version ? 2_147_483_647 : null),
      );
      const query = version ? `?version=${version}` : "";
      const result = await createApp({ config: TEST_CONFIG, database }).handle(
        new Request(`https://pushdraft.example/${TEST_DRAFT_ID}${query}`, {
          headers: { cookie: `${SESSION_COOKIE}=session` },
        }),
      );
      expect(result.status).toBe(404);
      expect(database.calls).toHaveLength(2);
    },
  );
});

function authenticatedDatabase(checkVersion?: (values: readonly unknown[]) => void) {
  return createFakeDatabase((call) => {
    const sql = compactSql(call.text);
    if (sql.includes("UPDATE api_keys AS k"))
      return { rows: [{ id: "key", account_id: "owner", name: "key", account_name: "Owner" }] };
    if (sql.startsWith("WITH active_session AS"))
      return {
        rows: [
          {
            id: "session",
            account_id: "owner",
            account_name: "Owner",
            email: "owner@example.test",
            picture_url: null,
            csrf_token_hash: "hash",
          },
        ],
      };
    if (
      checkVersion &&
      (sql.includes("JOIN files AS f") ||
        sql.includes("FROM drafts AS source") ||
        sql.startsWith("INSERT INTO draft_access_tickets"))
    ) {
      checkVersion(call.values);
      return { rows: [] };
    }
    return unexpectedQuery(call);
  });
}
