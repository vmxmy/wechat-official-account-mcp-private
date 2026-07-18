-- Complete the legacy default-tenant owner membership ceiling. Migration 0009
-- restored onboarding scopes for the production cutover; owners also require
-- the security session scopes defined by the first-release owner policy.

UPDATE tenant_memberships
SET scopes_json = '["wechat.mcp","woa:context:read","woa:tenant:read","woa:tenant:write","woa:account:read","woa:account:write","woa:content:read","woa:content:write","woa:content:publish","woa:inbox:read","woa:usage:read","woa:billing:write","woa:audit:read","woa:security:read","woa:security:write"]',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE tenant_id = 'tenant_default'
  AND role = 'owner'
  AND status = 'active'
  AND scopes_json = '["wechat.mcp","woa:context:read","woa:tenant:read","woa:tenant:write","woa:account:read","woa:account:write","woa:content:read","woa:content:write","woa:content:publish","woa:inbox:read","woa:usage:read","woa:billing:write","woa:audit:read"]'
  AND (
    user_id = 'user_default_admin'
    OR user_id = (
      SELECT operator_id
      FROM tenant_owners
      WHERE tenant_id = 'tenant_default'
      ORDER BY created_at ASC
      LIMIT 1
    )
  );
