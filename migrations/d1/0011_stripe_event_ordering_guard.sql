-- Prevent delayed Stripe webhooks from regressing an entitlement that already
-- reflects a newer event for the same tenant. The Worker updates these fields
-- in the same atomic UPSERT as the entitlement state.

ALTER TABLE tenant_entitlements ADD COLUMN last_stripe_event_created_at INTEGER;
ALTER TABLE tenant_entitlements ADD COLUMN last_stripe_event_priority INTEGER;
ALTER TABLE tenant_entitlements ADD COLUMN last_stripe_event_id TEXT;

-- Existing entitlements predate the watermark. Treat deployment time as their
-- reconciliation baseline so a delayed pre-deployment webhook cannot become
-- the first accepted event and regress live state.
UPDATE tenant_entitlements
SET last_stripe_event_created_at = (CAST(strftime('%s', 'now') AS INTEGER) - 1) * 1000,
    last_stripe_event_priority = 100,
    last_stripe_event_id = 'migration:0011'
WHERE last_stripe_event_created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_stripe_event_order
  ON tenant_entitlements(last_stripe_event_created_at, last_stripe_event_priority);
