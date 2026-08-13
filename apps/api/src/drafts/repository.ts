import type {
  DraftDetailResponse,
  DraftListResponse,
  DraftSummary,
  DraftVersion,
  UploadPayload,
  UploadResponse,
} from "@pp/contracts";
import type { QueryResultRow } from "pg";

import type { AppConfig } from "../config";
import type { Database } from "../db/database";
import { sha256 } from "../lib/crypto";
import { newDraftId, newInternalId } from "../lib/ids";
import { draftUrl } from "../lib/urls";
import type { HtmlValidation } from "./html-policy";

type UploadContext = {
  apiKeyId: string;
  accountId: string;
  sourceIp: string | null;
  userAgent: string | null;
  requestId: string | null;
};

type DraftRow = QueryResultRow & {
  id: string;
  title: string;
  description: string | null;
  repo_org: string | null;
  repo_name: string | null;
  repo_host: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  disabled_at: Date | string | null;
  latest_version_number: number | string | null;
  latest_version_at: Date | string | null;
  version_count: number | string;
};

type VersionRow = QueryResultRow & {
  id: string;
  version_number: number | string;
  created_at: Date | string;
  git_branch: string | null;
  git_commit_sha: string | null;
  git_commit_subject: string | null;
  git_dirty: boolean | null;
  cli_version: string | null;
  ci_provider: string | null;
  ci_run_url: string | null;
  ci_actor: string | null;
  file_id: string;
  media_type: string;
  original_filename: string;
  byte_size: number | string;
  sha256: string;
};

export type StoredContent = {
  draftId: string;
  versionNumber: number;
  mediaType: string;
  filename: string;
  bytes: Uint8Array;
};

export async function uploadHtml(
  database: Database,
  config: AppConfig,
  payload: UploadPayload,
  validation: HtmlValidation,
  context: UploadContext,
): Promise<UploadResponse> {
  const bytes = Buffer.from(payload.html, "utf8");
  const metadata = payload.metadata ?? {};

  return database.transaction(async (client) => {
    const existing = payload.draftId
      ? await client.query<QueryResultRow & { id: string; title: string }>(
          `
            SELECT id, title
            FROM drafts
            WHERE id = $1
              AND account_id = $2
              AND deleted_at IS NULL
              AND disabled_at IS NULL
            FOR UPDATE
          `,
          [payload.draftId, context.accountId],
        )
      : null;
    const existingDraft = existing?.rows[0] ?? null;
    if (payload.draftId && !existingDraft) throw new DraftNotFoundError();

    const draftId = existingDraft?.id ?? newDraftId();
    const fileId = newInternalId();
    const versionId = newInternalId();
    const filename = cleanText(payload.filename) ?? "draft.html";
    const title =
      validation.title ?? existingDraft?.title ?? cleanText(payload.filename) ?? "Untitled Draft";
    const description = cleanText(payload.description, 1_000);
    const versionNumber = existingDraft
      ? Number(
          (
            await client.query<QueryResultRow & { next_version: number | string }>(
              `
                SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
                FROM draft_versions
                WHERE draft_id = $1
              `,
              [draftId],
            )
          ).rows[0]?.next_version ?? 1,
        )
      : 1;

    if (!existingDraft) {
      await client.query(
        `
          INSERT INTO drafts (
            id, account_id, title, description, repo_org, repo_name, repo_host
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          draftId,
          context.accountId,
          title,
          description,
          cleanText(metadata.repoOrg),
          cleanText(metadata.repoName),
          cleanText(metadata.repoHost),
        ],
      );
    }

    await client.query(
      `
        INSERT INTO files (
          id, media_type, original_filename, byte_size, sha256,
          storage_backend, inline_bytes
        ) VALUES ($1, 'text/html', $2, $3, $4, 'postgres', $5)
      `,
      [fileId, filename, bytes.byteLength, sha256(bytes), bytes],
    );

    await client.query(
      `
        INSERT INTO draft_versions (
          id, draft_id, file_id, version_number, created_by_api_key_id,
          source_ip, user_agent, cli_version, git_branch, git_commit_sha,
          git_commit_subject, git_dirty, request_id, has_inline_script,
          external_image_hosts, ci_provider, ci_run_url, ci_actor
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15::jsonb, $16, $17, $18
        )
      `,
      [
        versionId,
        draftId,
        fileId,
        versionNumber,
        context.apiKeyId,
        context.sourceIp,
        context.userAgent,
        cleanText(metadata.cliVersion),
        cleanText(metadata.gitBranch),
        cleanText(metadata.gitCommitSha),
        cleanText(metadata.gitCommitSubject),
        metadata.gitDirty ?? null,
        context.requestId,
        validation.stats.hasInlineScript,
        JSON.stringify(validation.stats.externalImageHosts),
        cleanText(metadata.ciProvider),
        cleanText(metadata.ciRunUrl),
        cleanText(metadata.ciActor),
      ],
    );

    await client.query(
      `
        UPDATE drafts
        SET current_version_id = $1,
            title = $2,
            description = COALESCE($3, description),
            repo_org = COALESCE($4, repo_org),
            repo_name = COALESCE($5, repo_name),
            repo_host = COALESCE($6, repo_host),
            updated_at = now()
        WHERE id = $7
      `,
      [
        versionId,
        title,
        description,
        cleanText(metadata.repoOrg),
        cleanText(metadata.repoName),
        cleanText(metadata.repoHost),
        draftId,
      ],
    );

    await client.query(
      `
        INSERT INTO upload_events (
          id, draft_id, draft_version_id, api_key_id, event_type,
          source_ip, user_agent, metadata_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        newInternalId(),
        draftId,
        versionId,
        context.apiKeyId,
        existingDraft ? "draft.updated" : "draft.created",
        context.sourceIp,
        context.userAgent,
        JSON.stringify(metadata),
      ],
    );

    return {
      ok: true,
      draftId,
      versionId,
      versionNumber,
      title,
      requestId: context.requestId,
      publicUrl: draftUrl(config, draftId),
      rawUrl: draftUrl(config, draftId, "/raw"),
      warnings: validation.warnings,
    };
  });
}

export async function listDrafts(
  database: Database,
  config: AppConfig,
  accountId: string,
): Promise<DraftListResponse> {
  const result = await database.query<DraftRow>(
    `
      SELECT
        d.id,
        d.title,
        d.description,
        d.repo_org,
        d.repo_name,
        d.repo_host,
        d.created_at,
        d.updated_at,
        d.disabled_at,
        current_version.version_number AS latest_version_number,
        current_version.created_at AS latest_version_at,
        COUNT(all_versions.id)::int AS version_count
      FROM drafts AS d
      LEFT JOIN draft_versions AS current_version ON current_version.id = d.current_version_id
      LEFT JOIN draft_versions AS all_versions ON all_versions.draft_id = d.id
      WHERE d.account_id = $1 AND d.deleted_at IS NULL
      GROUP BY d.id, current_version.version_number, current_version.created_at
      ORDER BY d.updated_at DESC
    `,
    [accountId],
  );
  return { ok: true, drafts: result.rows.map((row) => mapDraft(config, row)) };
}

export async function getDraftDetail(
  database: Database,
  config: AppConfig,
  accountId: string,
  draftId: string,
): Promise<DraftDetailResponse | null> {
  const draftResult = await database.query<DraftRow>(
    `
      SELECT
        d.id,
        d.title,
        d.description,
        d.repo_org,
        d.repo_name,
        d.repo_host,
        d.created_at,
        d.updated_at,
        d.disabled_at,
        current_version.version_number AS latest_version_number,
        current_version.created_at AS latest_version_at,
        COUNT(all_versions.id)::int AS version_count
      FROM drafts AS d
      LEFT JOIN draft_versions AS current_version ON current_version.id = d.current_version_id
      LEFT JOIN draft_versions AS all_versions ON all_versions.draft_id = d.id
      WHERE d.id = $1 AND d.account_id = $2 AND d.deleted_at IS NULL
      GROUP BY d.id, current_version.version_number, current_version.created_at
    `,
    [draftId, accountId],
  );
  const row = draftResult.rows[0];
  if (!row) return null;

  const versions = await database.query<VersionRow>(
    `
      SELECT
        v.id,
        v.version_number,
        v.created_at,
        v.git_branch,
        v.git_commit_sha,
        v.git_commit_subject,
        v.git_dirty,
        v.cli_version,
        v.ci_provider,
        v.ci_run_url,
        v.ci_actor,
        f.id AS file_id,
        f.media_type,
        f.original_filename,
        f.byte_size,
        f.sha256
      FROM draft_versions AS v
      JOIN files AS f ON f.id = v.file_id
      WHERE v.draft_id = $1
      ORDER BY v.version_number DESC
    `,
    [draftId],
  );
  return {
    ok: true,
    draft: mapDraft(config, row),
    versions: versions.rows.map((version) => mapVersion(config, draftId, version)),
  };
}

export async function getStoredContent(
  database: Database,
  accountId: string,
  draftId: string,
  versionNumber?: number,
): Promise<StoredContent | null> {
  const result = await database.query<
    QueryResultRow & {
      draft_id: string;
      version_number: number | string;
      media_type: string;
      original_filename: string;
      storage_backend: "postgres" | "r2";
      inline_bytes: Buffer | null;
    }
  >(
    `
      SELECT
        d.id AS draft_id,
        v.version_number,
        f.media_type,
        f.original_filename,
        f.storage_backend,
        f.inline_bytes
      FROM drafts AS d
      JOIN draft_versions AS v ON v.draft_id = d.id
      JOIN files AS f ON f.id = v.file_id
      WHERE d.id = $1
        AND d.account_id = $2
        AND d.deleted_at IS NULL
        AND d.disabled_at IS NULL
        AND (
          ($3::integer IS NULL AND v.id = d.current_version_id)
          OR v.version_number = $3
        )
      LIMIT 1
    `,
    [draftId, accountId, versionNumber ?? null],
  );
  const row = result.rows[0];
  if (!row) return null;
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

function mapDraft(config: AppConfig, row: DraftRow): DraftSummary {
  return {
    draftId: row.id,
    title: row.title,
    description: row.description,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
    repoHost: row.repo_host,
    latestVersionNumber:
      row.latest_version_number === null ? null : Number(row.latest_version_number),
    versionCount: Number(row.version_count),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    latestVersionAt: row.latest_version_at ? asIso(row.latest_version_at) : null,
    disabled: row.disabled_at !== null,
    publicUrl: draftUrl(config, row.id),
    rawUrl: draftUrl(config, row.id, "/raw"),
  };
}

function mapVersion(config: AppConfig, draftId: string, row: VersionRow): DraftVersion {
  const versionNumber = Number(row.version_number);
  if (row.media_type !== "text/html" && row.media_type !== "application/pdf") {
    throw new Error(`Unsupported stored media type: ${row.media_type}`);
  }
  return {
    versionId: row.id,
    versionNumber,
    createdAt: asIso(row.created_at),
    publicUrl: draftUrl(config, draftId, `/v/${versionNumber}`),
    rawUrl: draftUrl(config, draftId, `/v/${versionNumber}/raw`),
    file: {
      fileId: row.file_id,
      filename: row.original_filename,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
      content:
        row.media_type === "text/html"
          ? { kind: "html", mediaType: "text/html" }
          : { kind: "pdf", mediaType: "application/pdf" },
    },
    metadata: {
      gitBranch: row.git_branch,
      gitCommitSha: row.git_commit_sha,
      gitCommitSubject: row.git_commit_subject,
      gitDirty: row.git_dirty,
      cliVersion: row.cli_version,
      ciProvider: row.ci_provider,
      ciRunUrl: row.ci_run_url,
      ciActor: row.ci_actor,
    },
  };
}

function cleanText(value: string | null | undefined, maxLength = 255): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class DraftNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super("Draft not found.");
  }
}
