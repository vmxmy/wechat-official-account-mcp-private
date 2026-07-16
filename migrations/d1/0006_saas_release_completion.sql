-- Complete SaaS billing-period and downgrade-lock state without rewriting existing rows.

ALTER TABLE tenant_entitlements ADD COLUMN period_anchor_at INTEGER;
ALTER TABLE tenant_entitlements ADD COLUMN pending_plan TEXT;
ALTER TABLE tenant_entitlements ADD COLUMN pending_plan_effective_at INTEGER;

ALTER TABLE wechat_accounts ADD COLUMN plan_locked_at INTEGER;
ALTER TABLE wechat_accounts ADD COLUMN plan_lock_reason TEXT;

UPDATE tenant_entitlements
SET period_anchor_at = COALESCE(
  period_anchor_at,
  (SELECT created_at FROM tenants WHERE tenants.id = tenant_entitlements.tenant_id),
  created_at
)
WHERE period_anchor_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_pending_plan
  ON tenant_entitlements(pending_plan_effective_at, pending_plan);
CREATE INDEX IF NOT EXISTS idx_wechat_accounts_plan_lock
  ON wechat_accounts(tenant_id, plan_locked_at);

-- Identity migration guardrail: keep the legacy shell but purge its WeChat
-- secrets before public onboarding can claim it.
UPDATE config
SET app_secret = '',
    token = NULL,
    encoding_aes_key = NULL,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1;

DELETE FROM access_tokens;

UPDATE wechat_accounts
SET app_secret = NULL,
    webhook_token = NULL,
    encoding_aes_key = NULL,
    status = 'unconfigured',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE tenant_id = 'tenant_default' AND id = 'acct_default';

DELETE FROM wechat_access_tokens
WHERE tenant_id = 'tenant_default' AND account_id = 'acct_default';
