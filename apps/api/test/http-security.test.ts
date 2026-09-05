import { describe, expect, test } from "vite-plus/test";
import type { PoolClient, QueryResultRow } from "pg";

import { createApp } from "../src/app";
import {
  CSRF_COOKIE,
  DRAFT_SHARE_SESSION_COOKIE,
  SESSION_COOKIE,
  createDraftSessionCookie,
  createDraftShareSessionCookie,
} from "../src/auth/session";
import { sha256 } from "../src/lib/crypto";
import {
  TEST_CONFIG,
  TEST_DRAFT_ID,
  compactSql,
  createFakeDatabase,
  unexpectedQuery,
} from "./helpers";

import { PNG } from "./image-fixtures";

const DRAFT_ORIGIN = `https://${TEST_DRAFT_ID}.pushdraft.example`;
const OWNER_TOKEN = "pushdraft_owner-token";
const FOREIGN_TOKEN = "pushdraft_foreign-token";
const WEB_SESSION_TOKEN = "web-session-token";
const CSRF_TOKEN = "csrf-token";
const SHARE_TOKEN = "A".repeat(43);
const SHARE_TICKET = "share-access-ticket";
const SHARE_ID = "share1234567890abcde";
const SHARED_VERSION = 7;
const SHARE_EXPIRES_AT = "2099-09-01T12:00:00.000Z";

describe("host classification", () => {
  test.each([
    ["foreign hostname", "https://evil.example/"],
    ["nested draft hostname", `https://nested.${TEST_DRAFT_ID}.pushdraft.example/raw`],
    ["trailing dot on apex", "https://pushdraft.example./"],
    ["trailing dot on draft hostname", `https://${TEST_DRAFT_ID}.pushdraft.example./raw`],
  ])("rejects %s", async (_label, url) => {
    const response = await request(url, createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(421);
    expect(await response.text()).not.toContain("Authenticated static HTML");
  });

  test("accepts only the exact apex and one draft-id label", async () => {
    const database = createFakeDatabase(unexpectedQuery);
    const apexResponse = await request("https://pushdraft.example/", database);
    const draftResponse = await request(`${DRAFT_ORIGIN}/raw`, database);

    expect(apexResponse.status).toBe(200);
    expect(draftResponse.status).toBe(401);
  });
});

describe("draft authentication", () => {
  test("raw content requires authentication", async () => {
    const response = await request(`${DRAFT_ORIGIN}/raw`, createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="pushdraft"');
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
    expect(response.headers.get("content-security-policy")).toContain("img-src 'self'");
  });

  test.each([
    ["current parent version", "/refs/hero", null],
    ["chosen parent version", "/v/7/refs/hero", 7],
  ])("serves a live image reference for the %s", async (_label, path, versionNumber) => {
    const stored = PNG;
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("UPDATE api_keys AS k")) {
        return call.values[0] === sha256(OWNER_TOKEN)
          ? { rows: [apiKeyRow("acct_owner")] }
          : { rows: [] };
      }
      if (sql.includes("FROM drafts AS source")) {
        expect(call.values).toEqual([
          TEST_DRAFT_ID,
          "acct_owner",
          versionNumber,
          "hero",
          ["image/png", "image/jpeg", "image/webp"],
        ]);
        return { rows: [referenceContentRow(stored)] };
      }
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}${path}`, database, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(stored));
  });

  test("does not redirect an unauthenticated subresource request", async () => {
    const response = await request(
      `${DRAFT_ORIGIN}/refs/hero`,
      createFakeDatabase(unexpectedQuery),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
  });

  test("uses the parent draft cookie to authorize its referenced image", async () => {
    const stored = PNG;
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("SELECT s.account_id FROM web_sessions AS s")) {
        expect(call.values).toEqual(["web-session-id"]);
        return { rows: [{ account_id: "acct_owner" }] };
      }
      if (sql.includes("FROM drafts AS source")) return { rows: [referenceContentRow(stored)] };
      return unexpectedQuery(call);
    });
    const draftCookie = cookiePair(
      createDraftSessionCookie(TEST_CONFIG, {
        webSessionId: "web-session-id",
        draftId: TEST_DRAFT_ID,
      }),
    );

    const response = await request(`${DRAFT_ORIGIN}/refs/hero`, database, {
      headers: { cookie: draftCookie },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});

describe("browser draft handshake", () => {
  test.each(["/v/7", "/v/007/"])(
    "canonicalizes %s so relative references retain the version path",
    async (path) => {
      const response = await request(`${DRAFT_ORIGIN}${path}`, createFakeDatabase(unexpectedQuery));

      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(`${DRAFT_ORIGIN}/v/7/`);
    },
  );

  test("preserves the requested immutable version while returning to the apex", async () => {
    const response = await request(`${DRAFT_ORIGIN}/v/7/`, createFakeDatabase(unexpectedQuery));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://pushdraft.example/${TEST_DRAFT_ID}?version=7`,
    );
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
        origin: "https://pushdraft.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `ticket=${encodeURIComponent(ticket)}`,
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-pushdraft_draft=/);
    expect(response.headers.get("content-security-policy")).toContain("form-action 'none'");
    expect(body).toContain('window.location.replace("/v/7/")');
  });

  test("allows only the concrete draft exchange endpoint from the apex bridge", async () => {
    const response = await request(
      `https://pushdraft.example/${TEST_DRAFT_ID}`,
      bridgePageDatabase(),
      {
        headers: { cookie: `${SESSION_COOKIE}=${WEB_SESSION_TOKEN}` },
      },
    );
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(response.status).toBe(200);
    expect(policy).toContain(`form-action ${DRAFT_ORIGIN}/_auth/exchange`);
    expect(policy).not.toContain(`form-action ${DRAFT_ORIGIN};`);
  });
});

describe("shared draft handshake", () => {
  test("turns an anonymous capability URL into a noindex exchange page", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("WITH expired_tickets AS")) {
        expect(call.values[0]).toBe(sha256(SHARE_TOKEN));
        expect(call.values[1]).toEqual(expect.any(String));
        expect(call.values[2]).toBe(60);
        return {
          rows: [{ draft_id: TEST_DRAFT_ID, version_number: SHARED_VERSION }],
        };
      }
      return unexpectedQuery(call);
    });

    const response = await request(`https://pushdraft.example/s/${SHARE_TOKEN}`, database);
    const body = await response.text();
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(policy).toContain("script-src 'nonce-");
    expect(policy).toContain(`form-action ${DRAFT_ORIGIN}/_share/exchange`);
    expect(policy).not.toContain(`form-action ${DRAFT_ORIGIN};`);
    expect(body).toContain(
      `id="share-bridge" method="post" action="${DRAFT_ORIGIN}/_share/exchange"`,
    );
    expect(body).toContain('history.replaceState(null,"","/share")');
    expect(body).not.toContain(SHARE_TOKEN);
    expect(database.calls).toHaveLength(1);
  });

  test("rejects a malformed capability without querying the database", async () => {
    const database = createFakeDatabase(unexpectedQuery);
    const response = await request("https://pushdraft.example/s/not-a-token", database);

    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(await response.text()).toContain("This link is unavailable.");
    expect(database.calls).toHaveLength(0);
  });

  test("accepts an exchange only from the exact apex and sets a strict share cookie", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("WITH active_ticket AS MATERIALIZED")) {
        expect(call.values).toEqual([sha256(SHARE_TICKET), TEST_DRAFT_ID]);
        return {
          rows: [activeShareRow()],
        };
      }
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}/_share/exchange`, database, {
      method: "POST",
      headers: {
        origin: "https://pushdraft.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `ticket=${encodeURIComponent(SHARE_TICKET)}`,
    });
    const body = await response.text();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toMatch(new RegExp(`^${DRAFT_SHARE_SESSION_COOKIE}=`));
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'none'");
    expect(body).toContain(`window.location.replace("/v/${SHARED_VERSION}/")`);
  });

  test.each(["https://pushdraft.example.evil", DRAFT_ORIGIN, "null"])(
    "rejects share exchange origin %s before consuming a ticket",
    async (origin) => {
      const database = createFakeDatabase(unexpectedQuery);
      const response = await request(`${DRAFT_ORIGIN}/_share/exchange`, database, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `ticket=${encodeURIComponent(SHARE_TICKET)}`,
      });

      expect(response.status).toBe(401);
      expect(database.calls).toHaveLength(0);
    },
  );
});

describe("shared draft access", () => {
  test("serves only the pinned document and its snapshotted image", async () => {
    const html = Buffer.from("<!doctype html><title>Shared v7</title>");
    const image = PNG;
    const database = activeShareDatabase((call, sql) => {
      if (sql.includes("JOIN draft_share_references AS reference")) {
        expect(call.values).toEqual([
          SHARE_ID,
          TEST_DRAFT_ID,
          "hero",
          ["image/png", "image/jpeg", "image/webp"],
        ]);
        return { rows: [referenceContentRow(image)] };
      }
      if (sql.includes("JOIN files AS file ON file.id = version.file_id")) {
        expect(call.values).toEqual([SHARE_ID, TEST_DRAFT_ID]);
        return { rows: [contentRow(html, SHARED_VERSION)] };
      }
      return unexpectedQuery(call);
    });
    const cookie = shareCookie();

    const documentResponse = await request(`${DRAFT_ORIGIN}/v/${SHARED_VERSION}/`, database, {
      headers: { cookie },
    });
    const imageResponse = await request(`${DRAFT_ORIGIN}/v/${SHARED_VERSION}/refs/hero`, database, {
      headers: { cookie },
    });

    expect(documentResponse.status).toBe(200);
    expect(await documentResponse.text()).toBe(html.toString());
    expect(documentResponse.headers.get("x-postplan-draft-version")).toBe(String(SHARED_VERSION));
    expect(documentResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toBe("image/png");
    expect(imageResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(new Uint8Array(image));
  });

  test.each([`/v/${SHARED_VERSION + 1}/`, "/raw"])(
    "denies a share cookie on %s without loading content",
    async (path) => {
      const database = activeShareDatabase((_call, _sql) => {
        throw new Error("Share policy must reject the route before loading content.");
      });

      const response = await request(`${DRAFT_ORIGIN}${path}`, database, {
        headers: { cookie: shareCookie() },
      });

      expect(response.status).toBe(404);
      expect(database.calls).toHaveLength(1);
    },
  );

  test("stops serving a document when the share is no longer active", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.startsWith("SELECT share.id AS share_id")) {
        expect(call.values).toEqual([SHARE_ID, TEST_DRAFT_ID]);
        return { rows: [] };
      }
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}/v/${SHARED_VERSION}/`, database, {
      headers: { cookie: shareCookie() },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(await response.text()).toContain("This link is unavailable.");
    expect(database.calls).toHaveLength(1);
  });

  test("an invalid Bearer header wins over a valid share cookie", async () => {
    const database = createFakeDatabase((call) => {
      const sql = compactSql(call.text);
      if (sql.includes("UPDATE api_keys AS k")) return { rows: [] };
      return unexpectedQuery(call);
    });

    const response = await request(`${DRAFT_ORIGIN}/v/${SHARED_VERSION}/`, database, {
      headers: {
        authorization: "Bearer invalid-token",
        cookie: shareCookie(),
      },
    });

    expect(response.status).toBe(401);
    expect(database.calls).toHaveLength(1);
    expect(compactSql(database.calls[0]?.text ?? "")).toContain("UPDATE api_keys AS k");
  });
});

describe("browser mutations", () => {
  test("keeps same-origin form origins available for CSRF validation", async () => {
    const response = await request(
      "https://pushdraft.example/",
      createFakeDatabase(unexpectedQuery),
    );

    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
  });

  test("accepts an exact origin with matching session and CSRF tokens", async () => {
    const response = await request(
      "https://pushdraft.example/cli/auth/keys",
      browserMutationDatabase(),
      {
        method: "POST",
        headers: browserMutationHeaders("https://pushdraft.example"),
        body: `csrf=${encodeURIComponent(CSRF_TOKEN)}`,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Your new API key");
  });

  test("still rejects a null origin with valid cookies and CSRF token", async () => {
    const database = browserMutationDatabase();
    const response = await request("https://pushdraft.example/cli/auth/keys", database, {
      method: "POST",
      headers: browserMutationHeaders("null"),
      body: `csrf=${encodeURIComponent(CSRF_TOKEN)}`,
    });

    expect(response.status).toBe(403);
    expect(database.calls).toHaveLength(1);
  });

  test("creates and revokes an owner share with valid Origin and CSRF tokens", async () => {
    const database = shareMutationDatabase();
    const createResponse = await request(
      `https://pushdraft.example/drafts/${TEST_DRAFT_ID}/shares`,
      database,
      {
        method: "POST",
        headers: browserMutationHeaders("https://pushdraft.example"),
        body: `csrf=${encodeURIComponent(CSRF_TOKEN)}&ttlSeconds=604800`,
      },
    );
    const createBody = await createResponse.text();
    const revokeResponse = await request(
      `https://pushdraft.example/drafts/${TEST_DRAFT_ID}/shares/${SHARE_ID}/revoke`,
      database,
      {
        method: "POST",
        headers: browserMutationHeaders("https://pushdraft.example"),
        body: `csrf=${encodeURIComponent(CSRF_TOKEN)}`,
      },
    );

    expect(createResponse.status).toBe(201);
    expect(createBody).toContain("This link is shown once.");
    expect(createBody).toMatch(/https:\/\/pushdraft\.example\/s\/[A-Za-z0-9_-]{43}/);
    expect(revokeResponse.status).toBe(303);
    expect(revokeResponse.headers.get("location")).toBe(
      `https://pushdraft.example/drafts/${TEST_DRAFT_ID}`,
    );
    expect(
      database.calls.some((call) => compactSql(call.text).startsWith("INSERT INTO draft_shares")),
    ).toBe(true);
    expect(
      database.calls.some((call) => compactSql(call.text).startsWith("UPDATE draft_shares")),
    ).toBe(true);
  });

  test("rejects an unsupported share TTL before starting a transaction", async () => {
    const database = shareMutationDatabase();
    const response = await request(
      `https://pushdraft.example/drafts/${TEST_DRAFT_ID}/shares`,
      database,
      {
        method: "POST",
        headers: browserMutationHeaders("https://pushdraft.example"),
        body: `csrf=${encodeURIComponent(CSRF_TOKEN)}&ttlSeconds=5`,
      },
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toBe("Invalid share expiration.");
    expect(database.calls).toHaveLength(1);
    expect(compactSql(database.calls[0]?.text ?? "")).toContain("WITH active_session AS");
  });

  test("does not create a link when a referenced image cannot be snapshotted", async () => {
    const database = shareMutationDatabase(0);
    const response = await request(
      `https://pushdraft.example/drafts/${TEST_DRAFT_ID}/shares`,
      database,
      {
        method: "POST",
        headers: browserMutationHeaders("https://pushdraft.example"),
        body: `csrf=${encodeURIComponent(CSRF_TOKEN)}&ttlSeconds=604800`,
      },
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toBe("Draft references could not be shared.");
  });

  test.each([
    [`/drafts/${TEST_DRAFT_ID}/shares`, `csrf=${CSRF_TOKEN}&ttlSeconds=604800`],
    [`/drafts/${TEST_DRAFT_ID}/shares/${SHARE_ID}/revoke`, `csrf=${CSRF_TOKEN}`],
  ])("does not mutate %s with a foreign Origin", async (path, body) => {
    const database = shareMutationDatabase();
    const response = await request(`https://pushdraft.example${path}`, database, {
      method: "POST",
      headers: browserMutationHeaders("https://evil.example"),
      body,
    });

    expect(response.status).toBe(403);
    expect(database.calls).toHaveLength(1);
    expect(compactSql(database.calls[0]?.text ?? "")).toContain("WITH active_session AS");
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

function shareMutationDatabase(snapshotRowCount = 1) {
  const database = createFakeDatabase((call) => {
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
    if (sql.startsWith("SELECT d.id AS draft_id")) {
      expect(call.values).toEqual([TEST_DRAFT_ID, "acct_owner"]);
      return {
        rows: [
          {
            draft_id: TEST_DRAFT_ID,
            draft_version_id: "version-7",
            version_number: SHARED_VERSION,
            reference_count: 1,
          },
        ],
      };
    }
    if (sql.startsWith("INSERT INTO draft_shares")) {
      expect(call.values[1]).toBe(TEST_DRAFT_ID);
      expect(call.values[2]).toBe("version-7");
      expect(call.values[4]).toBe(604_800);
      return {
        rows: [
          {
            created_at: "2026-09-01T12:00:00.000Z",
            expires_at: "2026-09-08T12:00:00.000Z",
          },
        ],
      };
    }
    if (sql.startsWith("INSERT INTO draft_share_references")) {
      return { rowCount: snapshotRowCount };
    }
    if (sql.startsWith("UPDATE draft_shares AS share")) {
      expect(call.values).toEqual([SHARE_ID, TEST_DRAFT_ID, "acct_owner"]);
      return { rowCount: 1 };
    }
    return unexpectedQuery(call);
  });
  database.transaction = async <Value>(
    run: (client: PoolClient) => Promise<Value>,
  ): Promise<Value> => {
    const query = (text: string, values?: readonly unknown[]) => database.query(text, values);
    return run({ query } as unknown as PoolClient);
  };
  return database;
}

function activeShareDatabase(
  handleContent: (
    call: ReturnType<typeof createFakeDatabase>["calls"][number],
    sql: string,
  ) => { rows?: QueryResultRow[]; rowCount?: number },
) {
  return createFakeDatabase((call) => {
    const sql = compactSql(call.text);
    if (sql.startsWith("SELECT share.id AS share_id")) {
      expect(call.values).toEqual([SHARE_ID, TEST_DRAFT_ID]);
      return { rows: [activeShareRow()] };
    }
    return handleContent(call, sql);
  });
}

function shareCookie(): string {
  return cookiePair(
    createDraftShareSessionCookie(
      TEST_CONFIG,
      { shareId: SHARE_ID, draftId: TEST_DRAFT_ID },
      3_600,
    ),
  );
}

function activeShareRow(): QueryResultRow {
  return {
    share_id: SHARE_ID,
    draft_id: TEST_DRAFT_ID,
    version_number: SHARED_VERSION,
    expires_at: SHARE_EXPIRES_AT,
  };
}

function browserMutationHeaders(origin: string): HeadersInit {
  return {
    origin,
    "content-type": "application/x-www-form-urlencoded",
    cookie: `${SESSION_COOKIE}=${WEB_SESSION_TOKEN}; ${CSRF_COOKIE}=${CSRF_TOKEN}`,
  };
}

function contentRow(bytes: Buffer, versionNumber = 4): QueryResultRow {
  return {
    draft_id: TEST_DRAFT_ID,
    version_number: versionNumber,
    media_type: "text/html",
    original_filename: "draft.html",
    storage_backend: "postgres",
    inline_bytes: bytes,
  };
}

function referenceContentRow(bytes: Buffer): QueryResultRow {
  return {
    draft_id: "mnopqrstuvwx",
    version_number: 9,
    media_type: "image/png",
    original_filename: "hero.png",
    storage_backend: "postgres",
    inline_bytes: bytes,
  };
}
