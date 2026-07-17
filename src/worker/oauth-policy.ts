/**
 * OAuth 生命周期统一策略。
 * Access token 保持相对短期；长期登录依赖可撤销、会轮换的 refresh token。
 */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;
export const OAUTH_DYNAMIC_CLIENT_TTL_SECONDS = 365 * 24 * 60 * 60;

export const OAUTH_ACCESS_TOKEN_TTL_MS = OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000;
export const OAUTH_REFRESH_TOKEN_TTL_MS = OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000;

/** Provider 能够签发的完整 scope 集；授权页只签发客户端实际请求的子集。 */
export const OAUTH_SUPPORTED_SCOPES = [
  'wechat.mcp',
  'woa:context:read',
  'woa:tenant:read',
  'woa:tenant:write',
  'woa:account:read',
  'woa:account:write',
  'woa:content:read',
  'woa:content:write',
  'woa:content:publish',
  'woa:inbox:read',
  'woa:usage:read',
  'woa:billing:write',
  'woa:audit:read',
  'woa:security:read',
  'woa:security:write',
] as const;

/** Native MCP host 未显式请求 scope 时的最小默认授权；发布等高风险能力按需追加。 */
export const OAUTH_MCP_DEFAULT_SCOPES = [
  'wechat.mcp',
  'woa:context:read',
  'woa:account:read',
  'woa:content:read',
  'woa:content:write',
] as const;

/** `woa init` 首次配置所需的最小权限，不包含发布、账单、审计和租户写权限。 */
export const OAUTH_INIT_SCOPES = [
  'woa:context:read',
  'woa:account:read',
  'woa:account:write',
  'woa:content:read',
  'woa:content:write',
] as const;

export function normalizeRequestedOAuthScopes(scopes: readonly string[] | null | undefined): string[] {
  const requested = [...new Set((scopes ?? []).map(scope => scope.trim()).filter(Boolean))];
  return requested.length > 0 ? requested : [...OAUTH_MCP_DEFAULT_SCOPES];
}

export function unsupportedOAuthScopes(scopes: readonly string[]): string[] {
  const supported = new Set<string>(OAUTH_SUPPORTED_SCOPES);
  return scopes.filter(scope => !supported.has(scope));
}
