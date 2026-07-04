-- Plan-based usage quotas and Stripe-ready tenant entitlements.
-- This migration is additive: Free/Plus/Pro expose all MCP tools, with usage limits enforced by Worker code.

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'pro')),
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start INTEGER,
  current_period_end INTEGER,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  limit_value INTEGER NOT NULL CHECK (limit_value >= 0),
  reset_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period, metric)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT,
  user_id TEXT,
  oauth_client_id TEXT,
  request_id TEXT,
  tool_name TEXT NOT NULL,
  action TEXT,
  plan TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_plan ON tenant_entitlements(plan, status);
CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_stripe_customer ON tenant_entitlements(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_stripe_subscription ON tenant_entitlements(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_usage_counters_metric_period ON usage_counters(metric, period);
CREATE INDEX IF NOT EXISTS idx_usage_counters_tenant_reset ON usage_counters(tenant_id, reset_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_time ON usage_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_account_time ON usage_events(tenant_id, account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_tool_time ON usage_events(tool_name, created_at);

-- Existing tenants default to Free. Plan upgrades are written by the future Stripe subscription flow.
INSERT OR IGNORE INTO tenant_entitlements (tenant_id, plan, status, limits_json, created_at, updated_at)
SELECT id, 'free', 'active', '{}', unixepoch() * 1000, unixepoch() * 1000
FROM tenants;
