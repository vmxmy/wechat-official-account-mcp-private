-- Optional idempotent backfill helper for local D1 verification.
-- The production path is migrations/d1/0002_multi_tenant_foundation.sql; this file keeps the rollout step explicit.
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

INSERT OR IGNORE INTO wechat_accounts (id, tenant_id, slug, name, app_id, app_secret, webhook_token, encoding_aes_key, status, is_default, created_at, updated_at)
SELECT 'acct_default', 'tenant_default', 'default', 'Default WeChat Official Account', app_id, app_secret, token, encoding_aes_key, 'active', 1, created_at, updated_at
FROM config
WHERE id = 1;
