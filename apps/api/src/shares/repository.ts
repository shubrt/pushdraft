import type { QueryResultRow } from "pg";

import type { AppConfig } from "../config";
import type { Database } from "../db/database";
import type { StoredContent } from "../drafts/repository";
import { randomToken, sha256 } from "../lib/crypto";
import { newInternalId } from "../lib/ids";

export const DRAFT_SHARE_TTL_SECONDS = [3_600, 86_400, 604_800, 2_592_000] as const;

const DRAFT_SHARE_ACCESS_TICKET_TTL_SECONDS = 60;
const RASTER_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type DraftShareTtlSeconds = (typeof DRAFT_SHARE_TTL_SECONDS)[number];

export type DraftShareSummary = {
  id: string;
  draftId: string;
  versionNumber: number;
  createdAt: string;
  expiresAt: string;
};

export type CreatedDraftShare = DraftShareSummary & {
  token: string;
  url: string;
};

export type ActiveDraftShare = {
  shareId: string;
  draftId: string;
  versionNumber: number;
  expiresAt: string;
};

export type DraftShareAccessTicket = {
  token: string;
  draftId: string;
  versionNumber: number;
};

export type ConsumedDraftShareAccessTicket = ActiveDraftShare;

type CurrentDraftRow = QueryResultRow & {
  draft_id: string;
  draft_version_id: string;
  version_number: number | string;
  reference_count: number | string;
};

type ShareTimestampsRow = QueryResultRow & {
  created_at: Date | string;
  expires_at: Date | string;
};

type DraftShareRow = QueryResultRow & {
  id: string;
  draft_id: string;
  version_number: number | string;
  created_at: Date | string;
  expires_at: Date | string;
};

type ActiveDraftShareRow = QueryResultRow & {
  share_id: string;
  draft_id: string;
  version_number: number | string;
  expires_at: Date | string;
};

type DraftShareTicketRow = QueryResultRow & {
  draft_id: string;
  version_number: number | string;
};

type StoredContentRow = QueryResultRow & {
  draft_id: string;
  version_number: number | string;
  media_type: string;
  original_filename: string;
  storage_backend: "postgres" | "r2";
  inline_bytes: Buffer | null;
};

export function isDraftShareTtlSeconds(value: number): value is DraftShareTtlSeconds {
  return DRAFT_SHARE_TTL_SECONDS.includes(value as DraftShareTtlSeconds);
}

export async function createDraftShare(
  database: Database,
  config: Pick<AppConfig, "publicUrl">,
  accountId: string,
  draftId: string,
  ttlSeconds: number,
): Promise<CreatedDraftShare | null> {
  if (!isDraftShareTtlSeconds(ttlSeconds)) {
    throw new RangeError("Draft share TTL is not allowed.");
  }

  const shareId = newInternalId();
  const token = randomToken(32);

  return database.transaction(async (client) => {
    const draftResult = await client.query<CurrentDraftRow>(
      `
        SELECT
          d.id AS draft_id,
          v.id AS draft_version_id,
          v.version_number,
          (
            SELECT COUNT(*)::int
            FROM draft_version_references AS reference
            WHERE reference.source_version_id = v.id
          ) AS reference_count
        FROM drafts AS d
        JOIN draft_versions AS v
          ON v.id = d.current_version_id
         AND v.draft_id = d.id
        WHERE d.id = $1
          AND d.account_id = $2
          AND d.deleted_at IS NULL
          AND d.disabled_at IS NULL
        FOR SHARE OF d
      `,
      [draftId, accountId],
    );
    const draft = draftResult.rows[0];
    if (!draft) return null;

    const inserted = await client.query<ShareTimestampsRow>(
      `
        INSERT INTO draft_shares (
          id, draft_id, draft_version_id, token_hash, expires_at
        ) VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))
        RETURNING created_at, expires_at
      `,
      [shareId, draft.draft_id, draft.draft_version_id, sha256(token), ttlSeconds],
    );
    const timestamps = inserted.rows[0];
    if (!timestamps) throw new Error("Draft share insert did not return its timestamps.");

    const snapshottedReferences = await client.query(
      `
        INSERT INTO draft_share_references (
          share_id, name, target_draft_id, target_version_id
        )
        SELECT $1, reference.name, target.id, target_version.id
        FROM draft_version_references AS reference
        JOIN drafts AS target ON target.id = reference.target_draft_id
        JOIN draft_versions AS target_version
          ON target_version.id = target.current_version_id
         AND target_version.draft_id = target.id
        JOIN files AS target_file ON target_file.id = target_version.file_id
        WHERE reference.source_version_id = $2
          AND target.account_id = $3
          AND target.deleted_at IS NULL
          AND target.disabled_at IS NULL
          AND target_file.media_type = ANY($4::text[])
      `,
      [shareId, draft.draft_version_id, accountId, RASTER_IMAGE_MEDIA_TYPES],
    );
    if ((snapshottedReferences.rowCount ?? 0) !== Number(draft.reference_count)) {
      throw new DraftShareReferencesUnavailableError();
    }

    return {
      id: shareId,
      draftId: draft.draft_id,
      versionNumber: Number(draft.version_number),
      createdAt: asIso(timestamps.created_at),
      expiresAt: asIso(timestamps.expires_at),
      token,
      url: new URL(`/s/${token}`, config.publicUrl).toString(),
    };
  });
}

export async function listActiveDraftShares(
  database: Database,
  accountId: string,
  draftId: string,
): Promise<DraftShareSummary[]> {
  const result = await database.query<DraftShareRow>(
    `
      SELECT
        share.id,
        share.draft_id,
        version.version_number,
        share.created_at,
        share.expires_at
      FROM draft_shares AS share
      JOIN drafts AS draft ON draft.id = share.draft_id
      JOIN draft_versions AS version
        ON version.id = share.draft_version_id
       AND version.draft_id = share.draft_id
      WHERE draft.account_id = $1
        AND draft.id = $2
        AND draft.deleted_at IS NULL
        AND draft.disabled_at IS NULL
        AND share.revoked_at IS NULL
        AND share.expires_at > now()
      ORDER BY share.created_at DESC
    `,
    [accountId, draftId],
  );
  return result.rows.map(mapDraftShare);
}

export async function revokeDraftShare(
  database: Database,
  accountId: string,
  draftId: string,
  shareId: string,
): Promise<boolean> {
  const result = await database.query(
    `
      UPDATE draft_shares AS share
      SET revoked_at = now()
      FROM drafts AS draft
      WHERE share.id = $1
        AND share.draft_id = $2
        AND draft.id = share.draft_id
        AND draft.account_id = $3
        AND share.revoked_at IS NULL
    `,
    [shareId, draftId, accountId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createDraftShareAccessTicket(
  database: Database,
  rawShareToken: string,
): Promise<DraftShareAccessTicket | null> {
  if (!rawShareToken) return null;

  const token = randomToken(32);
  const result = await database.query<DraftShareTicketRow>(
    `
      WITH expired_tickets AS (
        DELETE FROM draft_share_access_tickets
        WHERE expires_at <= now()
        RETURNING token_hash
      ), active_share AS MATERIALIZED (
        SELECT
          share.id AS share_id,
          share.draft_id,
          version.version_number,
          share.expires_at
        FROM draft_shares AS share
        JOIN drafts AS draft ON draft.id = share.draft_id
        JOIN draft_versions AS version
          ON version.id = share.draft_version_id
         AND version.draft_id = share.draft_id
        WHERE share.token_hash = $1
          AND share.revoked_at IS NULL
          AND share.expires_at > now()
          AND draft.deleted_at IS NULL
          AND draft.disabled_at IS NULL
      ), inserted_ticket AS (
        INSERT INTO draft_share_access_tickets (token_hash, share_id, expires_at)
        SELECT
          $2,
          active_share.share_id,
          LEAST(
            active_share.expires_at,
            now() + ($3 * interval '1 second')
          )
        FROM active_share
        RETURNING share_id
      )
      SELECT active_share.draft_id, active_share.version_number
      FROM inserted_ticket
      JOIN active_share ON active_share.share_id = inserted_ticket.share_id
    `,
    [sha256(rawShareToken), sha256(token), DRAFT_SHARE_ACCESS_TICKET_TTL_SECONDS],
  );
  const row = result.rows[0];
  return row
    ? {
        token,
        draftId: row.draft_id,
        versionNumber: Number(row.version_number),
      }
    : null;
}

export async function consumeDraftShareAccessTicket(
  database: Database,
  rawTicket: string,
  expectedDraftId: string,
): Promise<ConsumedDraftShareAccessTicket | null> {
  if (!rawTicket) return null;

  const result = await database.query<ActiveDraftShareRow>(
    `
      WITH active_ticket AS MATERIALIZED (
        SELECT
          ticket.token_hash,
          share.id AS share_id,
          share.draft_id,
          version.version_number,
          share.expires_at
        FROM draft_share_access_tickets AS ticket
        JOIN draft_shares AS share ON share.id = ticket.share_id
        JOIN drafts AS draft ON draft.id = share.draft_id
        JOIN draft_versions AS version
          ON version.id = share.draft_version_id
         AND version.draft_id = share.draft_id
        WHERE ticket.token_hash = $1
          AND ticket.expires_at > now()
          AND share.draft_id = $2
          AND share.revoked_at IS NULL
          AND share.expires_at > now()
          AND draft.deleted_at IS NULL
          AND draft.disabled_at IS NULL
      ), consumed_ticket AS (
        DELETE FROM draft_share_access_tickets AS ticket
        USING active_ticket
        WHERE ticket.token_hash = active_ticket.token_hash
        RETURNING ticket.token_hash
      )
      SELECT
        active_ticket.share_id,
        active_ticket.draft_id,
        active_ticket.version_number,
        active_ticket.expires_at
      FROM active_ticket
      JOIN consumed_ticket USING (token_hash)
    `,
    [sha256(rawTicket), expectedDraftId],
  );
  return mapActiveDraftShare(result.rows[0]);
}

export async function findActiveDraftShare(
  database: Database,
  shareId: string,
  expectedDraftId: string,
): Promise<ActiveDraftShare | null> {
  const result = await database.query<ActiveDraftShareRow>(
    `
      SELECT
        share.id AS share_id,
        share.draft_id,
        version.version_number,
        share.expires_at
      FROM draft_shares AS share
      JOIN drafts AS draft ON draft.id = share.draft_id
      JOIN draft_versions AS version
        ON version.id = share.draft_version_id
       AND version.draft_id = share.draft_id
      WHERE share.id = $1
        AND share.draft_id = $2
        AND share.revoked_at IS NULL
        AND share.expires_at > now()
        AND draft.deleted_at IS NULL
        AND draft.disabled_at IS NULL
      LIMIT 1
    `,
    [shareId, expectedDraftId],
  );
  return mapActiveDraftShare(result.rows[0]);
}

export async function getStoredSharedContent(
  database: Database,
  shareId: string,
  expectedDraftId: string,
): Promise<StoredContent | null> {
  const result = await database.query<StoredContentRow>(
    `
      SELECT
        draft.id AS draft_id,
        version.version_number,
        file.media_type,
        file.original_filename,
        file.storage_backend,
        file.inline_bytes
      FROM draft_shares AS share
      JOIN drafts AS draft ON draft.id = share.draft_id
      JOIN draft_versions AS version
        ON version.id = share.draft_version_id
       AND version.draft_id = share.draft_id
      JOIN files AS file ON file.id = version.file_id
      WHERE share.id = $1
        AND share.draft_id = $2
        AND share.revoked_at IS NULL
        AND share.expires_at > now()
        AND draft.deleted_at IS NULL
        AND draft.disabled_at IS NULL
      LIMIT 1
    `,
    [shareId, expectedDraftId],
  );
  const row = result.rows[0];
  return row ? mapStoredContent(row) : null;
}

export async function getStoredSharedReference(
  database: Database,
  shareId: string,
  expectedDraftId: string,
  name: string,
): Promise<StoredContent | null> {
  const result = await database.query<StoredContentRow>(
    `
      SELECT
        target.id AS draft_id,
        target_version.version_number,
        target_file.media_type,
        target_file.original_filename,
        target_file.storage_backend,
        target_file.inline_bytes
      FROM draft_shares AS share
      JOIN drafts AS source ON source.id = share.draft_id
      JOIN draft_versions AS source_version
        ON source_version.id = share.draft_version_id
       AND source_version.draft_id = share.draft_id
      JOIN draft_share_references AS reference
        ON reference.share_id = share.id
       AND reference.name = $3
      JOIN drafts AS target ON target.id = reference.target_draft_id
      JOIN draft_versions AS target_version
        ON target_version.id = reference.target_version_id
       AND target_version.draft_id = reference.target_draft_id
      JOIN files AS target_file ON target_file.id = target_version.file_id
      WHERE share.id = $1
        AND share.draft_id = $2
        AND share.revoked_at IS NULL
        AND share.expires_at > now()
        AND source.deleted_at IS NULL
        AND source.disabled_at IS NULL
        AND target.account_id = source.account_id
        AND target.deleted_at IS NULL
        AND target.disabled_at IS NULL
        AND target_file.media_type = ANY($4::text[])
      LIMIT 1
    `,
    [shareId, expectedDraftId, name, RASTER_IMAGE_MEDIA_TYPES],
  );
  const row = result.rows[0];
  return row ? mapStoredContent(row) : null;
}

function mapDraftShare(row: DraftShareRow): DraftShareSummary {
  return {
    id: row.id,
    draftId: row.draft_id,
    versionNumber: Number(row.version_number),
    createdAt: asIso(row.created_at),
    expiresAt: asIso(row.expires_at),
  };
}

function mapActiveDraftShare(row: ActiveDraftShareRow | undefined): ActiveDraftShare | null {
  return row
    ? {
        shareId: row.share_id,
        draftId: row.draft_id,
        versionNumber: Number(row.version_number),
        expiresAt: asIso(row.expires_at),
      }
    : null;
}

function mapStoredContent(row: StoredContentRow): StoredContent {
  if (row.storage_backend !== "postgres" || !row.inline_bytes) {
    throw new Error("The configured content storage backend is not available.");
  }
  return {
    draftId: row.draft_id,
    versionNumber: Number(row.version_number),
    mediaType: row.media_type,
    filename: row.original_filename,
    bytes: row.inline_bytes,
  };
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

class DraftShareReferencesUnavailableError extends Error {
  readonly status = 422;

  constructor() {
    super("Draft references could not be shared.");
  }
}
