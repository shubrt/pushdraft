import { timingSafeEqual } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import type { Database } from "../db/database";
import { randomToken, sha256 } from "../lib/crypto";
import { newInternalId } from "../lib/ids";
import type { WebSession } from "./session";

const WEB_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DRAFT_TICKET_TTL_SECONDS = 60;

export type ApiKeyAuth = {
  id: string;
  accountId: string;
  name: string;
  accountName: string;
};

export type IdentityProfile = {
  email: string | null;
  emailVerified: boolean | null;
  displayName: string | null;
  pictureUrl: string | null;
  piiSubject: string | null;
};

export type AccountIdentity = {
  accountId: string;
  accountName: string;
  email: string | null;
  pictureUrl: string | null;
};

export type NewWebSession = {
  session: WebSession;
  sessionToken: string;
  csrfToken: string;
};

export type DraftTicket = {
  token: string;
};

export type ConsumedDraftTicket = {
  webSessionId: string;
  draftId: string;
  versionNumber: number | null;
};

type ApiKeyRow = QueryResultRow & {
  id: string;
  account_id: string;
  name: string;
  account_name: string;
};

type SessionRow = QueryResultRow & {
  id: string;
  account_id: string;
  account_name: string;
  email: string | null;
  picture_url: string | null;
  csrf_token_hash: string;
};

export async function findApiKeyByToken(
  database: Database,
  token: string,
): Promise<ApiKeyAuth | null> {
  if (!token) return null;
  const result = await database.query<ApiKeyRow>(
    `
      UPDATE api_keys AS k
      SET last_used_at = now()
      FROM accounts AS a
      WHERE k.key_hash = $1
        AND k.revoked_at IS NULL
        AND a.id = k.account_id
      RETURNING k.id, k.account_id, k.name, a.name AS account_name
    `,
    [sha256(token)],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, accountId: row.account_id, name: row.name, accountName: row.account_name }
    : null;
}

export async function createApiKey(
  database: Database,
  accountId: string,
  name: string,
): Promise<{ id: string; name: string; token: string }> {
  const id = newInternalId();
  const token = `pp_${randomToken(32)}`;
  await database.query(
    "INSERT INTO api_keys (id, account_id, name, key_hash) VALUES ($1, $2, $3, $4)",
    [id, accountId, name, sha256(token)],
  );
  return { id, name, token };
}

export async function revokeApiKey(
  database: Database,
  accountId: string,
  apiKeyId: string,
): Promise<boolean> {
  const result = await database.query(
    `
      UPDATE api_keys
      SET revoked_at = now()
      WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL
    `,
    [apiKeyId, accountId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listApiKeys(
  database: Database,
  accountId: string,
): Promise<Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>> {
  const result = await database.query<
    QueryResultRow & {
      id: string;
      name: string;
      created_at: Date | string;
      last_used_at: Date | string | null;
    }
  >(
    `
      SELECT id, name, created_at, last_used_at
      FROM api_keys
      WHERE account_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC
    `,
    [accountId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: asIso(row.created_at),
    lastUsedAt: row.last_used_at ? asIso(row.last_used_at) : null,
  }));
}

export async function findOrCreateAccountForIdentity(
  database: Database,
  provider: string,
  subject: string,
  profile: IdentityProfile,
): Promise<AccountIdentity> {
  return database.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      provider,
      subject,
    ]);

    const existing = await client.query<
      QueryResultRow & { account_id: string; account_name: string }
    >(
      `
        SELECT i.account_id, a.name AS account_name
        FROM identities AS i
        JOIN accounts AS a ON a.id = i.account_id
        WHERE i.provider = $1 AND i.subject = $2
      `,
      [provider, subject],
    );

    const accountId = existing.rows[0]?.account_id ?? `acct_${newInternalId()}`;
    const accountName = profile.displayName ?? profile.email ?? `pp ${subject.slice(-6)}`;
    if (existing.rowCount === 0) {
      await client.query("INSERT INTO accounts (id, name) VALUES ($1, $2)", [
        accountId,
        accountName,
      ]);
      await client.query(
        `
          INSERT INTO identities (
            id, account_id, provider, subject, email, email_verified,
            display_name, picture_url, pii_subject
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          newInternalId(),
          accountId,
          provider,
          subject,
          profile.email,
          profile.emailVerified,
          profile.displayName,
          profile.pictureUrl,
          profile.piiSubject,
        ],
      );
    } else {
      await updateIdentity(client, provider, subject, profile);
      await client.query("UPDATE accounts SET name = $2, updated_at = now() WHERE id = $1", [
        accountId,
        accountName,
      ]);
    }

    return {
      accountId,
      accountName,
      email: profile.email,
      pictureUrl: profile.pictureUrl,
    };
  });
}

export async function createWebSession(
  database: Database,
  identity: AccountIdentity,
  previousToken: string | null,
): Promise<NewWebSession> {
  const id = newInternalId();
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(32);
  const csrfTokenHash = sha256(csrfToken);

  await database.transaction(async (client) => {
    if (previousToken) {
      await client.query(
        "UPDATE web_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        [sha256(previousToken)],
      );
    }
    await client.query(
      `
        INSERT INTO web_sessions (
          id, account_id, token_hash, csrf_token_hash, expires_at
        ) VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))
      `,
      [id, identity.accountId, sha256(sessionToken), csrfTokenHash, WEB_SESSION_TTL_SECONDS],
    );
  });

  return {
    session: {
      id,
      accountId: identity.accountId,
      accountName: identity.accountName,
      email: identity.email,
      pictureUrl: identity.pictureUrl,
      csrfTokenHash,
    },
    sessionToken,
    csrfToken,
  };
}

export async function findWebSession(
  database: Database,
  token: string | null,
): Promise<WebSession | null> {
  if (!token) return null;
  const result = await database.query<SessionRow>(
    `
      WITH active_session AS (
        UPDATE web_sessions
        SET last_used_at = now()
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING id, account_id, csrf_token_hash
      )
      SELECT
        s.id,
        s.account_id,
        s.csrf_token_hash,
        a.name AS account_name,
        i.email,
        i.picture_url
      FROM active_session AS s
      JOIN accounts AS a ON a.id = s.account_id
      LEFT JOIN LATERAL (
        SELECT email, picture_url
        FROM identities
        WHERE account_id = s.account_id
        ORDER BY last_login_at DESC
        LIMIT 1
      ) AS i ON true
    `,
    [sha256(token)],
  );
  return mapSession(result.rows[0]);
}

export async function revokeWebSession(database: Database, sessionId: string): Promise<void> {
  await database.query(
    "UPDATE web_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
    [sessionId],
  );
}

export function validCsrfToken(
  session: Pick<WebSession, "csrfTokenHash">,
  cookieToken: string | null,
  submittedToken: string | null,
): boolean {
  if (!cookieToken || !submittedToken || !safeEqual(cookieToken, submittedToken)) return false;
  return safeEqual(sha256(cookieToken), session.csrfTokenHash);
}

export async function createDraftAccessTicket(
  database: Database,
  session: Pick<WebSession, "id" | "accountId">,
  draftId: string,
  versionNumber: number | null,
): Promise<DraftTicket | null> {
  const token = randomToken(32);
  const result = await database.query(
    `
      INSERT INTO draft_access_tickets (
        token_hash, web_session_id, draft_id, version_number, expires_at
      )
      SELECT $1, s.id, d.id, $4, now() + ($5 * interval '1 second')
      FROM web_sessions AS s
      JOIN drafts AS d ON d.id = $3 AND d.account_id = s.account_id
      WHERE s.id = $2
        AND s.account_id = $6
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND d.deleted_at IS NULL
        AND d.disabled_at IS NULL
      RETURNING token_hash
    `,
    [
      sha256(token),
      session.id,
      draftId,
      versionNumber,
      DRAFT_TICKET_TTL_SECONDS,
      session.accountId,
    ],
  );
  return result.rowCount ? { token } : null;
}

export async function consumeDraftAccessTicket(
  database: Database,
  token: string,
  expectedDraftId: string,
): Promise<ConsumedDraftTicket | null> {
  const result = await database.query<
    QueryResultRow & {
      web_session_id: string;
      draft_id: string;
      version_number: number | string | null;
    }
  >(
    `
      DELETE FROM draft_access_tickets AS t
      USING web_sessions AS s, drafts AS d
      WHERE t.token_hash = $1
        AND t.draft_id = $2
        AND t.expires_at > now()
        AND s.id = t.web_session_id
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND d.id = t.draft_id
        AND d.account_id = s.account_id
        AND d.deleted_at IS NULL
        AND d.disabled_at IS NULL
      RETURNING t.web_session_id, t.draft_id, t.version_number
    `,
    [sha256(token), expectedDraftId],
  );
  const row = result.rows[0];
  return row
    ? {
        webSessionId: row.web_session_id,
        draftId: row.draft_id,
        versionNumber: row.version_number === null ? null : Number(row.version_number),
      }
    : null;
}

export async function findActiveWebSessionById(
  database: Database,
  webSessionId: string,
): Promise<{ accountId: string } | null> {
  const result = await database.query<QueryResultRow & { account_id: string }>(
    `
      SELECT s.account_id
      FROM web_sessions AS s
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
    `,
    [webSessionId],
  );
  const accountId = result.rows[0]?.account_id;
  return accountId ? { accountId } : null;
}

async function updateIdentity(
  client: PoolClient,
  provider: string,
  subject: string,
  profile: IdentityProfile,
): Promise<void> {
  await client.query(
    `
      UPDATE identities
      SET email = $3,
          email_verified = $4,
          display_name = $5,
          picture_url = $6,
          pii_subject = COALESCE($7, pii_subject),
          last_login_at = now()
      WHERE provider = $1 AND subject = $2
    `,
    [
      provider,
      subject,
      profile.email,
      profile.emailVerified,
      profile.displayName,
      profile.pictureUrl,
      profile.piiSubject,
    ],
  );
}

function mapSession(row: SessionRow | undefined): WebSession | null {
  return row
    ? {
        id: row.id,
        accountId: row.account_id,
        accountName: row.account_name,
        email: row.email,
        pictureUrl: row.picture_url,
        csrfTokenHash: row.csrf_token_hash,
      }
    : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
