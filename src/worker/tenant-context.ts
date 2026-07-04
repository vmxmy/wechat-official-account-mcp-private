import type { WechatToolResult } from '../mcp-tool/types.js';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_TENANT_ID,
} from '../storage/types.js';

export type TenantRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface TenantSummary {
  tenantId: string;
  slug: string;
  name: string;
  role: TenantRole;
  status: 'active' | 'disabled';
}

export interface AccountSummary {
  tenantId: string;
  accountId: string;
  slug: string;
  name: string;
  appId?: string;
  status: 'active' | 'disabled' | 'unconfigured';
  isDefault?: boolean;
}

export interface TenantRequestContext {
  userId: string;
  oauthClientId?: string;
  scopes: string[];
  tenants: TenantSummary[];
  accounts: AccountSummary[];
  defaultTenantId?: string;
  defaultAccountId?: string;
  requestId: string;
  source: 'mcp' | 'rest' | 'cli' | 'test';
}

export interface AccountContext {
  tenantId: string;
  accountId: string;
  account: AccountSummary;
}

export interface TenantAwareParams extends Record<string, unknown> {
  accountId?: string;
  tenantId?: string;
  __woaContext?: TenantRequestContext;
  __woaAccountContext?: AccountContext;
}

const DEFAULT_SCOPES = [
  'wechat.mcp',
  'woa:context:read',
  'woa:tenant:read',
  'woa:account:read',
  'woa:account:write',
  'woa:content:read',
  'woa:content:write',
  'woa:content:publish',
  'woa:inbox:read',
  'woa:audit:read',
];

const MANAGEMENT_CONTEXT_ONLY_TOOLS = new Set([
  'woa_context',
  'woa_tenant',
  'woa_audit',
]);

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AccountResolutionError extends ApiError {}

export function createDefaultTenantContext(options: {
  userId?: string | null;
  oauthClientId?: string | null;
  scopes?: string[] | string | null;
  requestId?: string | null;
  source: TenantRequestContext['source'];
  appId?: string | null;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  accountId?: string | null;
  accountSlug?: string | null;
  accountName?: string | null;
}): TenantRequestContext {
  const tenantId = options.tenantId || DEFAULT_TENANT_ID;
  const accountId = options.accountId || DEFAULT_ACCOUNT_ID;
  const scopes = normalizeScopes(options.scopes);

  return {
    userId: options.userId || 'wechat-admin',
    oauthClientId: options.oauthClientId || undefined,
    scopes: scopes.length > 0 ? scopes : [...DEFAULT_SCOPES],
    requestId: options.requestId || cryptoRandomId('req'),
    source: options.source,
    defaultTenantId: tenantId,
    defaultAccountId: accountId,
    tenants: [{
      tenantId,
      slug: options.tenantSlug || 'default',
      name: options.tenantName || 'Default Tenant',
      role: 'owner',
      status: 'active',
    }],
    accounts: [{
      tenantId,
      accountId,
      slug: options.accountSlug || 'default',
      name: options.accountName || 'Default WeChat Official Account',
      appId: options.appId || undefined,
      status: options.appId ? 'active' : 'unconfigured',
      isDefault: true,
    }],
  };
}

export function resolveRestAuthorization(request: Request): { token: string; scopes: string[] } {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match?.[1]) {
    throw new ApiError('unauthorized', 'OAuth bearer authorization is required for /api/v1 routes.', 401);
  }

  return {
    token: match[1],
    scopes: normalizeScopes(request.headers.get('x-woa-scopes')),
  };
}

export function createRestTenantContext(request: Request, options: {
  appId?: string | null;
  defaultUserId?: string | null;
  defaultClientId?: string | null;
} = {}): TenantRequestContext {
  const auth = resolveRestAuthorization(request);
  const headerUserId = request.headers.get('x-woa-user-id');
  const headerClientId = request.headers.get('x-woa-client-id');
  const headerTenantId = request.headers.get('x-woa-tenant-id');
  const headerAccountId = request.headers.get('x-woa-account-id');

  return createDefaultTenantContext({
    userId: headerUserId || options.defaultUserId || `oauth:${auth.token.slice(0, 8)}`,
    oauthClientId: headerClientId || options.defaultClientId || undefined,
    scopes: auth.scopes.length > 0 ? auth.scopes : DEFAULT_SCOPES,
    requestId: request.headers.get('x-request-id'),
    source: 'rest',
    appId: options.appId,
    tenantId: headerTenantId,
    accountId: headerAccountId,
  });
}

export function resolveAccountContext(
  params: Record<string, unknown>,
  context: TenantRequestContext,
  options: { requireAccount?: boolean } = {},
): AccountContext | undefined {
  const explicitTenantId = stringParam(params.tenantId);
  const explicitAccountId = stringParam(params.accountId);
  const requestedAccountId = explicitAccountId || context.defaultAccountId;
  const requestedTenantId = explicitTenantId || context.defaultTenantId;

  if (!requestedAccountId && !options.requireAccount) {
    return undefined;
  }

  const accessible = context.accounts.filter(account =>
    (!requestedTenantId || account.tenantId === requestedTenantId) &&
    (!explicitAccountId || account.accountId === explicitAccountId),
  );

  if (explicitAccountId) {
    const account = accessible.find(item => item.accountId === explicitAccountId);
    if (!account) {
      throw new AccountResolutionError(
        'account_forbidden',
        `Account ${explicitAccountId} is not accessible for the current user.`,
        403,
        { accounts: publicAccounts(context.accounts) },
      );
    }
    return { tenantId: account.tenantId, accountId: account.accountId, account };
  }

  const defaultAccount = context.accounts.find(account =>
    account.accountId === requestedAccountId && (!requestedTenantId || account.tenantId === requestedTenantId),
  );
  if (defaultAccount) {
    return { tenantId: defaultAccount.tenantId, accountId: defaultAccount.accountId, account: defaultAccount };
  }

  if (accessible.length === 1) {
    const [account] = accessible;
    return { tenantId: account.tenantId, accountId: account.accountId, account };
  }

  if (accessible.length > 1) {
    throw new AccountResolutionError(
      'account_ambiguous',
      'Multiple accessible accounts are available. Pass accountId explicitly.',
      400,
      { accounts: publicAccounts(accessible) },
    );
  }

  if (options.requireAccount) {
    throw new AccountResolutionError(
      'account_required',
      'No accessible WeChat Official Account is available for this operation.',
      403,
      { accounts: [] },
    );
  }

  return undefined;
}

export function enrichMcpToolParams(
  params: unknown,
  context: TenantRequestContext,
  toolName: string,
): { params: TenantAwareParams; account?: AccountContext } {
  const base = isRecord(params) ? { ...params } : {};
  const requireAccount = !MANAGEMENT_CONTEXT_ONLY_TOOLS.has(toolName);
  const account = resolveAccountContext(base, context, { requireAccount });

  return {
    account,
    params: {
      ...base,
      tenantId: stringParam(base.tenantId) || account?.tenantId,
      accountId: stringParam(base.accountId) || account?.accountId,
      __woaContext: context,
      __woaAccountContext: account,
    },
  };
}

export function attachTenantMetadata(
  result: WechatToolResult,
  context: TenantRequestContext,
  account?: AccountContext,
): WechatToolResult {
  return {
    ...result,
    _meta: {
      ...(isRecord(result._meta) ? result._meta : {}),
      tenantId: account?.tenantId ?? context.defaultTenantId,
      accountId: account?.accountId ?? context.defaultAccountId,
      userId: context.userId,
      requestId: context.requestId,
    },
  };
}

export function contextFromParams(params: unknown): TenantRequestContext {
  const record = isRecord(params) ? params : {};
  const context = record.__woaContext;
  if (isTenantRequestContext(context)) {
    return context;
  }

  return createDefaultTenantContext({ source: 'test' });
}

export function accountFromParams(params: unknown): AccountContext | undefined {
  const record = isRecord(params) ? params : {};
  const account = record.__woaAccountContext;
  if (isAccountContext(account)) {
    return account;
  }

  const context = contextFromParams(params);
  return resolveAccountContext(record, context, { requireAccount: false });
}

export function publicContext(context: TenantRequestContext): Record<string, unknown> {
  return {
    user: {
      userId: context.userId,
    },
    oauthClient: context.oauthClientId ? { clientId: context.oauthClientId } : null,
    scopes: context.scopes,
    tenants: context.tenants,
    accounts: publicAccounts(context.accounts),
    defaultTenantId: context.defaultTenantId,
    defaultAccountId: context.defaultAccountId,
    requestId: context.requestId,
  };
}

export function publicAccounts(accounts: AccountSummary[]): Array<Record<string, unknown>> {
  return accounts.map(account => ({
    tenantId: account.tenantId,
    accountId: account.accountId,
    slug: account.slug,
    name: account.name,
    appId: account.appId,
    status: account.status,
    isDefault: account.isDefault === true,
  }));
}

export function requireScope(context: TenantRequestContext, scope: string): void {
  if (!context.scopes.includes(scope)) {
    throw new ApiError('missing_scope', `Missing required OAuth scope: ${scope}`, 403, { scope });
  }
}

export function apiErrorToResponse(error: unknown, requestId?: string): Response {
  if (error instanceof ApiError) {
    return jsonResponse({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      },
    }, { status: error.status });
  }

  return jsonResponse({
    success: false,
    error: {
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
      requestId,
    },
  }, { status: 500 });
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

function normalizeScopes(scopes: string[] | string | null | undefined): string[] {
  if (Array.isArray(scopes)) {
    return scopes.map(scope => scope.trim()).filter(Boolean);
  }
  if (!scopes) return [];
  return scopes.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean);
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTenantRequestContext(value: unknown): value is TenantRequestContext {
  return isRecord(value) && Array.isArray(value.tenants) && Array.isArray(value.accounts) && typeof value.userId === 'string';
}

function isAccountContext(value: unknown): value is AccountContext {
  return isRecord(value) && typeof value.tenantId === 'string' && typeof value.accountId === 'string' && isRecord(value.account);
}

function cryptoRandomId(prefix: string): string {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.randomUUID) {
    return `${prefix}_${cryptoLike.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
