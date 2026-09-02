CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN,
  display_name TEXT,
  picture_url TEXT,
  pii_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  storage_backend TEXT NOT NULL CHECK (storage_backend IN ('postgres', 'r2')),
  inline_bytes BYTEA,
  object_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT files_storage_location_check CHECK (
    (storage_backend = 'postgres' AND inline_bytes IS NOT NULL AND object_key IS NULL)
    OR
    (storage_backend = 'r2' AND inline_bytes IS NULL AND object_key IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  repo_org TEXT,
  repo_name TEXT,
  repo_host TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT
);

CREATE TABLE IF NOT EXISTS draft_versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  source_ip TEXT,
  user_agent TEXT,
  cli_version TEXT,
  git_branch TEXT,
  git_commit_sha TEXT,
  git_commit_subject TEXT,
  git_dirty BOOLEAN,
  request_id TEXT,
  has_inline_script BOOLEAN NOT NULL DEFAULT false,
  external_image_hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ci_provider TEXT,
  ci_run_url TEXT,
  ci_actor TEXT,
  UNIQUE (draft_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drafts_current_version_id_fkey'
  ) THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES draft_versions(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_versions_draft_id_id_key'
  ) THEN
    ALTER TABLE draft_versions
      ADD CONSTRAINT draft_versions_draft_id_id_key UNIQUE (draft_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS draft_version_references (
  source_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_draft_id TEXT NOT NULL REFERENCES drafts(id),
  PRIMARY KEY (source_version_id, name)
);

CREATE TABLE IF NOT EXISTS draft_shares (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  draft_version_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CONSTRAINT draft_shares_version_fkey
    FOREIGN KEY (draft_id, draft_version_id)
    REFERENCES draft_versions(draft_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS draft_share_references (
  share_id TEXT NOT NULL REFERENCES draft_shares(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  target_version_id TEXT NOT NULL,
  PRIMARY KEY (share_id, name),
  CONSTRAINT draft_share_references_target_version_fkey
    FOREIGN KEY (target_draft_id, target_version_id)
    REFERENCES draft_versions(draft_id, id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_shares_version_fkey'
  ) THEN
    ALTER TABLE draft_shares
      ADD CONSTRAINT draft_shares_version_fkey
      FOREIGN KEY (draft_id, draft_version_id)
      REFERENCES draft_versions(draft_id, id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_share_references_target_version_fkey'
  ) THEN
    ALTER TABLE draft_share_references
      ADD CONSTRAINT draft_share_references_target_version_fkey
      FOREIGN KEY (target_draft_id, target_version_id)
      REFERENCES draft_versions(draft_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS upload_events (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  draft_version_id TEXT REFERENCES draft_versions(id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  event_type TEXT NOT NULL,
  source_ip TEXT,
  user_agent TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_access_tickets (
  token_hash TEXT PRIMARY KEY,
  web_session_id TEXT NOT NULL REFERENCES web_sessions(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  version_number INTEGER CHECK (version_number IS NULL OR version_number > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_share_access_tickets (
  token_hash TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES draft_shares(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

-- Existing pre-release databases used target_path before the destination was
-- narrowed to a version number. Keep the migration repeatable while upgrading them.
ALTER TABLE draft_access_tickets
  ADD COLUMN IF NOT EXISTS version_number INTEGER;
ALTER TABLE draft_access_tickets
  DROP COLUMN IF EXISTS target_path;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_access_tickets_version_number_check'
  ) THEN
    ALTER TABLE draft_access_tickets
      ADD CONSTRAINT draft_access_tickets_version_number_check
      CHECK (version_number IS NULL OR version_number > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS identities_account_id_idx ON identities(account_id);
CREATE INDEX IF NOT EXISTS api_keys_account_id_idx ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS web_sessions_account_id_idx ON web_sessions(account_id);
CREATE INDEX IF NOT EXISTS web_sessions_expires_at_idx ON web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS drafts_account_id_updated_at_idx ON drafts(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS draft_versions_draft_id_version_idx
  ON draft_versions(draft_id, version_number DESC);
CREATE INDEX IF NOT EXISTS draft_version_references_target_draft_id_idx
  ON draft_version_references(target_draft_id);
CREATE INDEX IF NOT EXISTS draft_shares_draft_id_created_at_idx
  ON draft_shares(draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS draft_shares_expires_at_idx
  ON draft_shares(expires_at);
CREATE INDEX IF NOT EXISTS draft_share_references_target_draft_id_idx
  ON draft_share_references(target_draft_id);
CREATE INDEX IF NOT EXISTS upload_events_draft_id_idx ON upload_events(draft_id);
CREATE INDEX IF NOT EXISTS draft_access_tickets_expires_at_idx
  ON draft_access_tickets(expires_at);
CREATE INDEX IF NOT EXISTS draft_share_access_tickets_expires_at_idx
  ON draft_share_access_tickets(expires_at);
