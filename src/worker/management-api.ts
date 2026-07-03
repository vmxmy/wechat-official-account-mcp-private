import type { WechatApiClient, WechatConfig } from '../mcp-tool/types.js';
import type { InboxStore } from '../mcp-tool/inbox-store.js';
import {
  ApiError,
  apiErrorToResponse,
  createRestTenantContext,
  jsonResponse,
  publicAccounts,
  publicContext,
  requireScope,
  resolveAccountContext,
  type TenantRequestContext,
} from './tenant-context.js';

export interface ManagementApiDeps {
  createApiClient(): Promise<WechatApiClient>;
  appId?: string | null;
  defaultUserId?: string | null;
  defaultClientId?: string | null;
}

export async function handleManagementApiRequest(
  request: Request,
  deps: ManagementApiDeps,
): Promise<Response> {
  let context: TenantRequestContext | undefined;
  try {
    context = createRestTenantContext(request, {
      appId: deps.appId,
      defaultUserId: deps.defaultUserId,
      defaultClientId: deps.defaultClientId,
    });

    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean);

    if (segments.length === 0) {
      return jsonResponse({
        success: true,
        api: 'woa-management-api',
        version: 'v1',
        requestId: context.requestId,
        routes: [
          '/api/v1/me',
          '/api/v1/tenants',
          '/api/v1/tenants/:tenantId/accounts',
          '/api/v1/tenants/:tenantId/accounts/:accountId/drafts',
          '/api/v1/tenants/:tenantId/accounts/:accountId/publishes',
          '/api/v1/tenants/:tenantId/accounts/:accountId/inbox',
          '/api/v1/audit',
        ],
      });
    }

    if (request.method === 'GET' && segments[0] === 'me' && segments.length === 1) {
      return jsonResponse({ success: true, data: publicContext(context), requestId: context.requestId });
    }

    if (segments[0] === 'tenants') {
      return await handleTenantRoutes(request, segments, context, deps);
    }

    if (segments[0] === 'audit') {
      requireScope(context, 'woa:audit:read');
      return jsonResponse({
        success: true,
        data: {
          tenantId: new URL(request.url).searchParams.get('tenantId') ?? context.defaultTenantId,
          accountId: new URL(request.url).searchParams.get('accountId') ?? context.defaultAccountId,
          items: [],
          note: 'Audit persistence is provided by the audit lane; this route is protected and returns the stable response shape.',
        },
        requestId: context.requestId,
      });
    }

    throw new ApiError('not_found', 'API route not found.', 404);
  } catch (error) {
    return apiErrorToResponse(error, context?.requestId);
  }
}

async function handleTenantRoutes(
  request: Request,
  segments: string[],
  context: TenantRequestContext,
  deps: ManagementApiDeps,
): Promise<Response> {
  requireScope(context, 'woa:tenant:read');

  if (request.method === 'GET' && segments.length === 1) {
    return jsonResponse({ success: true, data: { tenants: context.tenants }, requestId: context.requestId });
  }

  if (request.method === 'POST' && segments.length === 1) {
    requireScope(context, 'woa:tenant:write');
    const body = await readJsonBody(request);
    return jsonResponse({
      success: true,
      data: {
        requested: body,
        note: 'Tenant creation persistence is provided by the tenant-aware storage lane; this route enforces auth/scope and response shape.',
      },
      requestId: context.requestId,
    }, { status: 202 });
  }

  const tenantId = segments[1];
  const tenant = context.tenants.find(item => item.tenantId === tenantId);
  if (!tenant) {
    throw new ApiError('tenant_forbidden', `Tenant ${tenantId} is not accessible.`, 403);
  }

  if (request.method === 'GET' && segments.length === 2) {
    return jsonResponse({ success: true, data: { tenant }, requestId: context.requestId });
  }

  if (request.method === 'PATCH' && segments.length === 2) {
    requireScope(context, 'woa:tenant:write');
    const body = await readJsonBody(request);
    return jsonResponse({
      success: true,
      data: {
        tenant,
        requested: body,
        note: 'Tenant update persistence is provided by the tenant-aware storage lane.',
      },
      requestId: context.requestId,
    }, { status: 202 });
  }

  if (segments[2] === 'accounts') {
    return await handleAccountRoutes(request, segments, context, deps, tenantId);
  }

  throw new ApiError('not_found', 'Tenant API route not found.', 404);
}

async function handleAccountRoutes(
  request: Request,
  segments: string[],
  context: TenantRequestContext,
  deps: ManagementApiDeps,
  tenantId: string,
): Promise<Response> {
  requireScope(context, 'woa:account:read');

  if (request.method === 'GET' && segments.length === 3) {
    const accounts = context.accounts.filter(account => account.tenantId === tenantId);
    return jsonResponse({ success: true, data: { accounts: publicAccounts(accounts) }, requestId: context.requestId });
  }

  if (request.method === 'POST' && segments.length === 3) {
    requireScope(context, 'woa:account:write');
    const body = await readJsonBody(request);
    return jsonResponse({
      success: true,
      data: {
        requested: maskAccountBody(body),
        note: 'Account creation persistence is provided by the tenant-aware storage lane; raw secrets are not echoed.',
      },
      requestId: context.requestId,
    }, { status: 202 });
  }

  const accountId = segments[3];
  const account = resolveAccountContext({ tenantId, accountId }, context, { requireAccount: true });

  if (request.method === 'GET' && segments.length === 4) {
    return jsonResponse({ success: true, data: { account: account?.account }, requestId: context.requestId });
  }

  if ((request.method === 'PATCH' || request.method === 'PUT') && segments.length === 4) {
    requireScope(context, 'woa:account:write');
    const body = await readJsonBody(request);
    return jsonResponse({
      success: true,
      data: {
        account: account?.account,
        requested: maskAccountBody(body),
        note: 'Account update persistence is provided by the tenant-aware storage lane; raw secrets are not echoed.',
      },
      requestId: context.requestId,
    }, { status: 202 });
  }

  if (request.method === 'POST' && segments.length === 5 && segments[4] === 'disable') {
    requireScope(context, 'woa:account:write');
    return jsonResponse({
      success: true,
      data: {
        account: account?.account,
        note: 'Account disable persistence is provided by the tenant-aware storage lane.',
      },
      requestId: context.requestId,
    }, { status: 202 });
  }

  if (request.method === 'POST' && segments.length === 5 && segments[4] === 'configure') {
    requireScope(context, 'woa:account:write');
    const body = await readJsonBody(request) as Partial<WechatConfig>;
    if (!body.appId || !body.appSecret) {
      throw new ApiError('validation_error', 'appId and appSecret are required.', 400);
    }
    const apiClient = await deps.createApiClient();
    await apiClient.getAuthManager().setConfig({
      appId: body.appId,
      appSecret: body.appSecret,
      token: body.token,
      encodingAESKey: body.encodingAESKey,
    });
    return jsonResponse({
      success: true,
      data: {
        tenantId,
        accountId,
        appId: body.appId,
        hasAppSecret: true,
        hasToken: !!body.token,
        hasEncodingAESKey: !!body.encodingAESKey,
      },
      requestId: context.requestId,
    });
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'status') {
    const apiClient = await deps.createApiClient();
    const config = await apiClient.getAuthManager().getConfig();
    return jsonResponse({
      success: true,
      data: {
        account: account?.account,
        configured: !!(config?.appId && config?.appSecret),
        config: maskConfig(config),
      },
      requestId: context.requestId,
    });
  }

  if (request.method === 'POST' && segments.length === 6 && segments[4] === 'token' && segments[5] === 'refresh') {
    requireScope(context, 'woa:account:write');
    const apiClient = await deps.createApiClient();
    const token = await apiClient.getAuthManager().refreshAccessToken();
    return jsonResponse({
      success: true,
      data: {
        accountId,
        expiresIn: token.expiresIn,
        expiresAt: token.expiresAt,
      },
      requestId: context.requestId,
    });
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'drafts') {
    requireScope(context, 'woa:content:read');
    const apiClient = await deps.createApiClient();
    const url = new URL(request.url);
    const data = await apiClient.post('/cgi-bin/draft/batchget', {
      offset: intQuery(url, 'offset', 0),
      count: clampIntQuery(url, 'count', 20, 1, 20),
      no_content: clampIntQuery(url, 'no_content', 1, 0, 1),
    });
    return jsonResponse({ success: true, data, requestId: context.requestId });
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'publishes') {
    requireScope(context, 'woa:content:read');
    const apiClient = await deps.createApiClient();
    const url = new URL(request.url);
    const data = await apiClient.post('/cgi-bin/freepublish/batchget', {
      offset: intQuery(url, 'offset', 0),
      count: clampIntQuery(url, 'count', 20, 1, 20),
      no_content: clampIntQuery(url, 'no_content', 1, 0, 1),
    });
    return jsonResponse({ success: true, data, requestId: context.requestId });
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'inbox') {
    requireScope(context, 'woa:inbox:read');
    const apiClient = await deps.createApiClient();
    const inboxStore = getInboxStore(apiClient);
    const url = new URL(request.url);
    const data = await inboxStore.listMessages({
      pendingOnly: url.searchParams.get('pending') !== 'false',
      type: url.searchParams.get('type') ?? undefined,
      openid: url.searchParams.get('openid') ?? undefined,
      limit: clampIntQuery(url, 'limit', 20, 1, 100),
      offset: intQuery(url, 'offset', 0),
    });
    return jsonResponse({ success: true, data, requestId: context.requestId });
  }

  throw new ApiError('not_found', 'Account API route not found.', 404);
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return {};
  }

  try {
    return await request.json();
  } catch {
    throw new ApiError('validation_error', 'Invalid JSON request body.', 400);
  }
}

function intQuery(url: URL, name: string, fallback: number): number {
  const value = url.searchParams.get(name);
  if (value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new ApiError('validation_error', `${name} must be an integer.`, 400, { field: name });
  }
  return parsed;
}

function clampIntQuery(url: URL, name: string, fallback: number, min: number, max: number): number {
  const value = intQuery(url, name, fallback);
  if (value < min || value > max) {
    throw new ApiError('validation_error', `${name} must be between ${min} and ${max}.`, 400, { field: name, min, max });
  }
  return value;
}

function getInboxStore(apiClient: WechatApiClient): InboxStore {
  const store = (apiClient as any).getInboxStore?.() as InboxStore | undefined;
  if (!store) {
    throw new ApiError('runtime_unavailable', 'Inbox store is not configured in this runtime.', 500);
  }
  return store;
}

function maskConfig(config: WechatConfig | null): Record<string, unknown> | null {
  if (!config) return null;
  return {
    appId: config.appId,
    hasAppSecret: !!config.appSecret,
    hasToken: !!config.token,
    hasEncodingAESKey: !!config.encodingAESKey,
  };
}

function maskAccountBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const copy = { ...(body as Record<string, unknown>) };
  for (const key of ['appSecret', 'token', 'encodingAESKey', 'accessToken']) {
    if (key in copy) {
      copy[key] = '***';
    }
  }
  return copy;
}
