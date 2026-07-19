-- Close post-0011 ordering and audit atomicity gaps without replaying applied
-- migrations. Migration sentinels are recognizable by the Worker so the first
-- delayed webhook is reconciled from authoritative Stripe state.

CREATE TABLE IF NOT EXISTS account_operation_guards (
  operation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

ALTER TABLE wechat_accounts ADD COLUMN credential_revision INTEGER NOT NULL DEFAULT 0;

UPDATE tenant_entitlements
SET last_stripe_event_created_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    last_stripe_event_priority = 100,
    last_stripe_event_id = 'migration:0012'
WHERE last_stripe_event_id = 'migration:0011';

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_last_stripe_event_id
  ON tenant_entitlements(last_stripe_event_id);
