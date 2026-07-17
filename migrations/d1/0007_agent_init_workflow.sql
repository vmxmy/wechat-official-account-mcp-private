-- Non-sensitive state for resumable first-run initialization.
-- Credential values never enter these tables: URL/cookie capabilities and
-- idempotency keys are SHA-256 hashes, while results are non-secret media IDs.

CREATE TABLE IF NOT EXISTS agent_init_runs (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  request_key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  phase TEXT NOT NULL DEFAULT 'context_ready',
  run_version INTEGER NOT NULL DEFAULT 1,
  egress_config_version TEXT NOT NULL,
  egress_confirmed_at INTEGER,
  credentials_verified_at INTEGER,
  relay_probe_at INTEGER,
  test_asset_checksum TEXT,
  test_asset_media_id TEXT,
  test_draft_idempotency_key_hash TEXT,
  test_draft_media_id TEXT,
  last_error_code TEXT,
  lease_owner_hash TEXT,
  lease_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(operator_id, request_key_hash),
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);

CREATE TABLE IF NOT EXISTS agent_credential_handoffs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  url_token_hash TEXT NOT NULL UNIQUE,
  cookie_token_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  consumed_at INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_init_runs(id),
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);

CREATE TABLE IF NOT EXISTS agent_init_idempotency (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_ref TEXT,
  lease_owner_hash TEXT,
  lease_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id, account_id, tool_name, idempotency_key_hash),
  FOREIGN KEY(run_id) REFERENCES agent_init_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_init_runs_operator
  ON agent_init_runs(operator_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_init_runs_account
  ON agent_init_runs(tenant_id, account_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_credential_handoffs_run
  ON agent_credential_handoffs(run_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_init_idempotency_expiry
  ON agent_init_idempotency(expires_at, status);
