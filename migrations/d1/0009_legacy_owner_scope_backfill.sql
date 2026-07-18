-- Backfill the legacy default-tenant owner membership created before the
-- context/content/usage scopes were introduced. OAuth grants still intersect
-- with the requested scopes, so this only restores the persisted membership
-- ceiling required by the current owner onboarding contract.

UPDATE tenant_memberships
SET scopes_json = '["wechat.mcp","woa:context:read","woa:tenant:read","woa:tenant:write","woa:account:read","woa:account:write","woa:content:read","woa:content:write","woa:content:publish","woa:inbox:read","woa:usage:read","woa:billing:write","woa:audit:read"]',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE tenant_id = 'tenant_default'
  AND user_id = 'user_default_admin'
  AND role = 'owner'
  AND status = 'active'
  AND scopes_json = '["woa:*"]';
