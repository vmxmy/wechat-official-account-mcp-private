-- SaaS onboarding backend foundation.
-- Additive only: public Operator identity, sessions, OAuth consent/token sessions,
-- tenant ownership, retention metadata, monitoring signals, and deletion requests.

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  verified_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_identities (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  verified_email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subject),
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS operator_email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  ip_hash TEXT,
  provider_subject TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS oauth_consents (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scopes_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(operator_id, client_id, scopes_hash),
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS oauth_token_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS public_signup_rate_limits (
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(bucket, key_hash, window_start)
);
CREATE TABLE IF NOT EXISTS tenant_owners (
  tenant_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start INTEGER,
  current_period_end INTEGER,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL DEFAULT '[]',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  tenant_id TEXT,
  secret_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS r2_media_retention_metadata (
  object_key TEXT PRIMARY KEY,
  tenant_id TEXT,
  account_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS inbound_message_retention_metadata (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  oldest_retained_at INTEGER,
  purge_before INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id, account_id)
);
CREATE TABLE IF NOT EXISTS monitoring_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_deletion_requests (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  support_note TEXT,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_operator_email_codes_email ON operator_email_codes(email, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_operator_identities_operator ON operator_identities(operator_id);
CREATE INDEX IF NOT EXISTS idx_web_sessions_operator ON web_sessions(operator_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_token_sessions_operator ON oauth_token_sessions(operator_id, revoked_at, refresh_expires_at);
CREATE INDEX IF NOT EXISTS idx_public_signup_rate_limits_reset ON public_signup_rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS idx_tenant_owners_operator ON tenant_owners(operator_id);
CREATE INDEX IF NOT EXISTS idx_r2_media_retention_expires ON r2_media_retention_metadata(expires_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_type_time ON monitoring_events(event_type, created_at);
