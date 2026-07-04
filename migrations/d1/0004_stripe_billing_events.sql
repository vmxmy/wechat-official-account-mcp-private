-- Stripe webhook event idempotency ledger.
-- Keeps subscription entitlement sync replay-safe and gives operators a minimal audit trail.

CREATE TABLE IF NOT EXISTS stripe_billing_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  tenant_id TEXT,
  stripe_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_billing_events_tenant_time
  ON stripe_billing_events(tenant_id, processed_at);
