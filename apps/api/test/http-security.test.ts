import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";

import { createApp } from "../src/app";
import { CSRF_COOKIE, SESSION_COOKIE, createDraftSessionCookie } from "../src/auth/session";
import { sha256 } from "../src/lib/crypto";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  unexpectedQuery,
} from "./helpers";

const DRAFT_ORIGIN = `https://${TEST_DRAFT_ID}.pp.example`;
const OWNER_TOKEN = "pp_owner-token";
const FOREIGN_TOKEN = "pp_foreign-token";
const WEB_SESSION_TOKEN = "web-session-token";
const CSRF_TOKEN = "csrf-token";

describe("host classification", () => {
  test.each([
    ["foreign hostname", "https://evil.example/"],
    ["nested draft hostname", `https://nested.${TEST_DRAFT_ID}.pp.example/raw`],
    ["trailing dot on apex", "https://pp.example./"],
    ["trailing dot on draft hostname", `https://${TEST_DRAFT_ID}.pp.example./raw`],
  ])("rejects %s", async (_label, url) => {
    const response = await request(url, createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(421);
    expect(await response.text()).not.toContain("Authenticated static HTML");
  });

  test("accepts only the exact apex and one draft-id label", async () => {
    const database = createFakeDatabase(unexpectedQuery);
    const apexResponse = await request("https://pp.example/", database);
    const draftResponse = await request(`${DRAFT_ORIGIN}/raw`, database);

    expect(apexResponse.status).toBe(200);
    expect(draftResponse.status).toBe(401);
  });
});

describe("draft authentication", () => {
  test("raw content requires authentication", async () => {
    const response = await request(`${DRAFT_ORIGIN}/raw`, createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="pp"');
  });

  test("an Authorization header wins over a valid draft cookie", async () => {
    const content = Buffer.from("<!doctype html><title>must not leak</title>");
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("UPDATE api_keys AS k")) return { rows: [] };
      if (sql.includes("FROM web_sessions AS s")) {
        return { rows: [{ account_id: "acct_owner" }] };
      }
      if (sql.includes("JOIN files AS f")) return { rows: [contentRow(content)] };
      return unexpectedQuery(call);
    });
    const draftCookie = cookiePair(
      createDraftSessionCookie(TEST_CONFIG, {
        webSessionId: "web-session-id",
        draftId: TEST_DRAFT_ID,
      }),
    );

    const response = await request(`${DRAFT_ORIGIN}/raw`, database, {
      headers: {
        authorization: "Bearer invalid-token",
        cookie: draftCookie,
      },
    });

    expect(response.status).toBe(401);
    expect(database.calls).toHaveLength(1);
    expect(compactSql(database.calls[0]?.text ?? "")).toContain("UPDATE api_keys AS k");
  });

  test("a valid bearer receives 404 for another account's draft", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("UPDATE api_keys AS k")) {
        return call.values[0] === sha256(FOREIGN_TOKEN)
          ? { rows: [apiKeyRow("acct_foreign")] }
          : { rows: [] };
      }
      if (sql.includes("JOIN files AS f")) return { rows: [] };
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}/raw`, database, {
      headers: { authorization: `Bearer ${FOREIGN_TOKEN}` },
    });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("foreign");
  });

  test("serves the stored bytes unchanged with Postplan-compatible headers", async () => {
    const stored = Buffer.from("<!doctype html>\r\n<title>Exact bytes</title>\r\n<p>ä</p>", "utf8");
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("UPDATE api_keys AS k")) {
        return call.values[0] === sha256(OWNER_TOKEN)
          ? { rows: [apiKeyRow("acct_owner")] }
          : { rows: [] };
      }
      if (sql.includes("JOIN files AS f")) {
        expect(call.values).toEqual([TEST_DRAFT_ID, "acct_owner", null]);
        return { rows: [contentRow(stored)] };
      }
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}/raw`, database, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(stored));
    expect(response.headers.get("x-postplan-draft-id")).toBe(TEST_DRAFT_ID);
    expect(response.headers.get("x-postplan-draft-version")).toBe("4");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("browser draft handshake", () => {
  test("preserves the requested immutable version while returning to the apex", async () => {
    const response = await request(`${DRAFT_ORIGIN}/v/7`, createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://pp.example/${TEST_DRAFT_ID}?version=7`);
  });

  test("sets the draft cookie before navigating away from the exchange page", async () => {
    const ticket = "draft-access-ticket";
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("DELETE FROM draft_access_tickets AS t")) {
        expect(call.values).toEqual([sha256(ticket), TEST_DRAFT_ID]);
        return {
          rows: [
            {
              web_session_id: "web-session-id",
              draft_id: TEST_DRAFT_ID,
              version_number: 7,
            },
          ],
        };
      }
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}/_auth/exchange`, database, {
      method: "POST",
      headers: {
        origin: "https://pp.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `ticket=${encodeURIComponent(ticket)}`,
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toStartWith("__Host-pp_draft=");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'none'");
    expect(body).toContain('window.location.replace("/v/7")');
  });

  test("allows only the concrete draft exchange endpoint from the apex bridge", async () => {
    const response = await request(`https://pp.example/${TEST_DRAFT_ID}`, bridgePageDatabase(), {
      headers: { cookie: `${SESSION_COOKIE}=${WEB_SESSION_TOKEN}` },
    });
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(response.status).toBe(200);
    expect(policy).toContain(`form-action ${DRAFT_ORIGIN}/_auth/exchange`);
    expect(policy).not.toContain(`form-action ${DRAFT_ORIGIN};`);
  });
});

describe("browser mutations", () => {
  test("keeps same-origin form origins available for CSRF validation", async () => {
    const response = await request("https://pp.example/", createFakeDatabase(unexpectedQuery));

    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
  });

  test("accepts an exact origin with matching session and CSRF tokens", async () => {
    const response = await request("https://pp.example/cli/auth/keys", browserMutationDatabase(), {
      method: "POST",
      headers: browserMutationHeaders("https://pp.example"),
      body: `csrf=${encodeURIComponent(CSRF_TOKEN)}`,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Your new API key");
  });

  test("still rejects a null origin with valid cookies and CSRF token", async () => {
    const database = browserMutationDatabase();
    const response = await request("https://pp.example/cli/auth/keys", database, {
      method: "POST",
      headers: browserMutationHeaders("null"),
      body: `csrf=${encodeURIComponent(CSRF_TOKEN)}`,
    });

    expect(response.status).toBe(403);
    expect(database.calls).toHaveLength(1);
  });
});

async function request(
  url: string,
  database: ReturnType<typeof createFakeDatabase>,
  init?: RequestInit,
) {
  const app = createApp({ config: TEST_CONFIG, database });
  return app.handle(new Request(url, init));
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

function apiKeyRow(accountId: string): QueryResultRow {
  return {
    id: `key_${accountId}`,
    account_id: accountId,
    name: "test key",
    account_name: accountId,
  };
}

function browserMutationDatabase() {
  return createFakeDatabase((call) => {
    const sql = compactSql(call.text);
    if (sql.startsWith("WITH active_session AS")) {
      return {
        rows: [
          {
            id: "web_session",
            account_id: "acct_owner",
            account_name: "Owner",
            email: "owner@example.test",
            picture_url: null,
            csrf_token_hash: sha256(CSRF_TOKEN),
          },
        ],
      };
    }
    if (sql.startsWith("INSERT INTO api_keys")) return { rowCount: 1 };
    return unexpectedQuery(call);
  });
}

function bridgePageDatabase() {
  return createFakeDatabase((call) => {
    const sql = compactSql(call.text);
    if (sql.startsWith("WITH active_session AS")) {
      return {
        rows: [
          {
            id: "web-session-id",
            account_id: "acct_owner",
            account_name: "Owner",
            email: "owner@example.test",
            picture_url: null,
            csrf_token_hash: sha256(CSRF_TOKEN),
          },
        ],
      };
    }
    if (sql.startsWith("INSERT INTO draft_access_tickets")) {
      return { rows: [{ token_hash: "created" }] };
    }
    return unexpectedQuery(call);
  });
}

function browserMutationHeaders(origin: string): HeadersInit {
  return {
    origin,
    "content-type": "application/x-www-form-urlencoded",
    cookie: `${SESSION_COOKIE}=${WEB_SESSION_TOKEN}; ${CSRF_COOKIE}=${CSRF_TOKEN}`,
  };
}

function contentRow(bytes: Buffer): QueryResultRow {
  return {
    draft_id: TEST_DRAFT_ID,
    version_number: 4,
    media_type: "text/html",
    original_filename: "draft.html",
    storage_backend: "postgres",
    inline_bytes: bytes,
  };
}
