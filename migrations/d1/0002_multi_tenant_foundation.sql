-- Additive multi-tenant foundation for tenant/account-isolated WeChat runtime.
-- Old single-tenant tables from 0001 remain intact for rollback during the rollout window.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  default_account_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  default_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
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
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS wechat_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  app_id TEXT,
  app_secret TEXT,
  webhook_token TEXT,
  encoding_aes_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_id, slug),
  UNIQUE(tenant_id, id),
  UNIQUE(app_id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS wechat_access_tokens (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  expires_in INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, account_id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(account_id) REFERENCES wechat_accounts(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  user_id TEXT,
  oauth_client_id TEXT,
  tenant_id TEXT,
  account_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  FOREIGN KEY(account_id) REFERENCES wechat_accounts(id)
);

-- Tenant/account-scoped replacement tables. Legacy tables remain untouched.
CREATE TABLE IF NOT EXISTS account_media (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  url TEXT,
  PRIMARY KEY (tenant_id, account_id, media_id)
);

CREATE TABLE IF NOT EXISTS account_permanent_media (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  update_time INTEGER,
  url TEXT,
  PRIMARY KEY (tenant_id, account_id, media_id)
);

CREATE TABLE IF NOT EXISTS account_drafts (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  content TEXT NOT NULL,
  update_time INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, account_id, media_id)
);

CREATE TABLE IF NOT EXISTS account_publishes (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  publish_id TEXT NOT NULL,
  msg_data_id TEXT NOT NULL,
  idx INTEGER,
  article_url TEXT,
  content TEXT,
  publish_time INTEGER NOT NULL,
  publish_status INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, account_id, publish_id)
);

CREATE TABLE IF NOT EXISTS account_inbound_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  to_user_name TEXT NOT NULL,
  from_user_name TEXT NOT NULL,
  type TEXT NOT NULL,
  event_type TEXT,
  raw_xml TEXT NOT NULL,
  parsed_payload_json TEXT NOT NULL,
  create_time INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  processing_note TEXT,
  UNIQUE(tenant_id, account_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wechat_accounts_tenant ON wechat_accounts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wechat_accounts_default ON wechat_accounts(tenant_id, is_default, status);
CREATE INDEX IF NOT EXISTS idx_wechat_access_tokens_expires_at ON wechat_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_account_time ON audit_logs(tenant_id, account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operation_jobs_account_status ON operation_jobs(tenant_id, account_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_account_media_type_created ON account_media(tenant_id, account_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_account_permanent_media_type_created ON account_permanent_media(tenant_id, account_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_account_drafts_update_time ON account_drafts(tenant_id, account_id, update_time);
CREATE INDEX IF NOT EXISTS idx_account_publishes_status ON account_publishes(tenant_id, account_id, publish_status);
CREATE INDEX IF NOT EXISTS idx_account_publishes_time ON account_publishes(tenant_id, account_id, publish_time);
CREATE INDEX IF NOT EXISTS idx_account_inbound_pending ON account_inbound_messages(tenant_id, account_id, processed_at, received_at);
CREATE INDEX IF NOT EXISTS idx_account_inbound_type ON account_inbound_messages(tenant_id, account_id, type, received_at);
CREATE INDEX IF NOT EXISTS idx_account_inbound_openid ON account_inbound_messages(tenant_id, account_id, from_user_name, received_at);

-- Forward-only default backfill from the legacy single-tenant config row.
INSERT OR IGNORE INTO tenants (id, slug, name, status, default_account_id, created_at, updated_at)
SELECT 'tenant_default', 'default', 'Default Tenant', 'active', 'acct_default', created_at, updated_at
FROM config
WHERE id = 1;

INSERT OR IGNORE INTO users (id, email, display_name, status, created_at, updated_at)
SELECT 'user_default_admin', NULL, 'Default Admin', 'active', created_at, updated_at
FROM config
WHERE id = 1;

INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, scopes_json, default_account_id, status, created_at, updated_at)
SELECT 'tenant_default', 'user_default_admin', 'owner', '["woa:*"]', 'acct_default', 'active', created_at, updated_at
FROM config
WHERE id = 1;

INSERT OR IGNORE INTO wechat_accounts (
  id,
  tenant_id,
  slug,
  name,
  app_id,
  app_secret,
  webhook_token,
  encoding_aes_key,
  status,
  is_default,
  created_at,
  updated_at
)
SELECT
  'acct_default',
  'tenant_default',
  'default',
  'Default WeChat Official Account',
  app_id,
  app_secret,
  token,
  encoding_aes_key,
  'active',
  1,
  created_at,
  updated_at
FROM config
WHERE id = 1;

INSERT OR IGNORE INTO wechat_access_tokens (
  tenant_id,
  account_id,
  access_token,
  expires_in,
  expires_at,
  created_at,
  updated_at
)
SELECT
  'tenant_default',
  'acct_default',
  access_token,
  expires_in,
  expires_at,
  created_at,
  created_at
FROM access_tokens
ORDER BY created_at DESC
LIMIT 1;
-- Backfill legacy account resources into scoped tables when the default account exists.
INSERT OR IGNORE INTO account_media (tenant_id, account_id, media_id, type, created_at, url)
SELECT 'tenant_default', 'acct_default', media_id, type, created_at, url
FROM media
WHERE EXISTS (SELECT 1 FROM wechat_accounts WHERE id = 'acct_default');

INSERT OR IGNORE INTO account_permanent_media (tenant_id, account_id, media_id, type, name, created_at, update_time, url)
SELECT 'tenant_default', 'acct_default', media_id, type, name, created_at, update_time, url
FROM permanent_media
WHERE EXISTS (SELECT 1 FROM wechat_accounts WHERE id = 'acct_default');

INSERT OR IGNORE INTO account_drafts (tenant_id, account_id, media_id, content, update_time)
SELECT 'tenant_default', 'acct_default', media_id, content, update_time
FROM drafts
WHERE EXISTS (SELECT 1 FROM wechat_accounts WHERE id = 'acct_default');

INSERT OR IGNORE INTO account_publishes (tenant_id, account_id, publish_id, msg_data_id, idx, article_url, content, publish_time, publish_status)
SELECT 'tenant_default', 'acct_default', publish_id, msg_data_id, idx, article_url, content, publish_time, publish_status
FROM publishes
WHERE EXISTS (SELECT 1 FROM wechat_accounts WHERE id = 'acct_default');

INSERT OR IGNORE INTO account_inbound_messages (
  tenant_id,
  account_id,
  dedup_key,
  to_user_name,
  from_user_name,
  type,
  event_type,
  raw_xml,
  parsed_payload_json,
  create_time,
  received_at,
  processed_at,
  processing_note
)
SELECT
  'tenant_default',
  'acct_default',
  dedup_key,
  to_user_name,
  from_user_name,
  type,
  event_type,
  raw_xml,
  parsed_payload_json,
  create_time,
  received_at,
  processed_at,
  processing_note
FROM inbound_messages
WHERE EXISTS (SELECT 1 FROM wechat_accounts WHERE id = 'acct_default');

