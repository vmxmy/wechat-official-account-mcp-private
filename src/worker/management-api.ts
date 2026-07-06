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
  type AccountContext,
  type TenantRequestContext,
} from './tenant-context.js';
import {
  D1UsageQuotaStore,
  QuotaExceededError,
  reserveMcpToolQuota,
  type QuotaMetadata,
} from './usage-store.js';
import {
  StripeBillingError,
  type StripeBillingService,
} from './stripe-billing.js';
import { normalizeSubscriptionPlan } from './quota-policy.js';
import {
  AccountAllowanceError,
  D1SaasOnboardingStore,
  DuplicateAppIdError,
  type WechatResourceRecord,
} from './saas-onboarding-store.js';

export interface ManagementApiDeps {
  createApiClient(): Promise<WechatApiClient>;
  appId?: string | null;
  defaultUserId?: string | null;
  defaultClientId?: string | null;
  usageStore?: D1UsageQuotaStore;
  billing?: StripeBillingService;
  onboardingStore?: D1SaasOnboardingStore;
  validateWechatCredentials?(config: WechatConfig, account: AccountContext): Promise<{ accessToken: string; expiresIn: number; expiresAt: number } | null | undefined>;
  trustedContext?: TenantRequestContext;
  allowUnsafeHeaderContextForTests?: boolean;
}

export async function handleManagementApiRequest(
  request: Request,
  deps: ManagementApiDeps,
): Promise<Response> {
  let context: TenantRequestContext | undefined;
  try {
    if (deps.trustedContext) {
      context = deps.trustedContext;
    } else {
      if (!deps.allowUnsafeHeaderContextForTests) {
        throw new ApiError(
          'unauthorized',
          'OAuth-protected management context is required for /api/v1 routes.',
          401,
        );
      }
      context = createRestTenantContext(request, {
        appId: deps.appId,
        defaultUserId: deps.defaultUserId,
        defaultClientId: deps.defaultClientId,
      });
    }

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
          '/api/v1/tenants/:tenantId/usage',
          '/api/v1/tenants/:tenantId/billing/checkout',
          '/api/v1/tenants/:tenantId/accounts',
          '/api/v1/tenants/:tenantId/accounts/:accountId/drafts',
          '/api/v1/tenants/:tenantId/accounts/:accountId/drafts/:mediaId',
          '/api/v1/tenants/:tenantId/accounts/:accountId/publishes',
          '/api/v1/tenants/:tenantId/accounts/:accountId/publishes/:articleId',
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
    if (error instanceof QuotaExceededError) {
      return jsonResponse({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: context?.requestId,
        },
      }, { status: 429 });
    }
    if (error instanceof AccountAllowanceError) {
      return jsonResponse({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: context?.requestId,
        },
      }, { status: 402 });
    }
    if (error instanceof DuplicateAppIdError) {
      return jsonResponse({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: { appId: error.appId },
          requestId: context?.requestId,
        },
      }, { status: 409 });
    }
    if (error instanceof StripeBillingError) {
      return jsonResponse({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: context?.requestId,
        },
      }, { status: error.status });
    }
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

  if (request.method === 'GET' && segments.length === 3 && segments[2] === 'usage') {
    requireScope(context, 'woa:usage:read');
    if (!deps.usageStore) {
      throw new ApiError('runtime_unavailable', 'Usage quota store is not configured in this runtime.', 500);
    }
    const summary = await deps.usageStore.getUsageSummary(tenantId);
    return jsonResponse({
      success: true,
      data: summary,
      meta: {
        upgradePrompt: summary.upgradePrompt,
      },
      requestId: context.requestId,
    });
  }

  if (request.method === 'POST' && segments.length === 4 && segments[2] === 'billing' && segments[3] === 'checkout') {
    requireScope(context, 'woa:billing:write');
    if (!deps.billing) {
      throw new ApiError('stripe_billing_unconfigured', 'Stripe billing is not fully configured in this runtime.', 503);
    }
    const body = await readJsonBody(request) as Record<string, unknown>;
    const plan = normalizeSubscriptionPlan(body.plan);
    if (plan !== 'plus' && plan !== 'pro') {
      throw new ApiError('validation_error', 'plan must be plus or pro.', 400, { field: 'plan' });
    }
    const session = await deps.billing.createCheckoutSession({
      tenantId,
      plan,
      successUrl: stringValue(body.successUrl),
      cancelUrl: stringValue(body.cancelUrl),
    });
    return jsonResponse({
      success: true,
      data: session,
      requestId: context.requestId,
    }, { status: 201 });
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
    if (deps.onboardingStore) {
      const accounts = await deps.onboardingStore.listWechatResources(tenantId);
      return jsonResponse({ success: true, data: { accounts: accounts.map(publicWechatResource) }, requestId: context.requestId });
    }
    const accounts = context.accounts.filter(account => account.tenantId === tenantId);
    return jsonResponse({ success: true, data: { accounts: publicAccounts(accounts) }, requestId: context.requestId });
  }

  if (request.method === 'POST' && segments.length === 3) {
    requireScope(context, 'woa:account:write');
    const body = await readJsonBody(request) as Record<string, unknown>;
    if (deps.onboardingStore) {
      const account = await deps.onboardingStore.createWechatResource({
        tenantId,
        name: stringValue(body.name) ?? stringValue(body.displayName),
        slug: stringValue(body.slug),
      });
      return jsonResponse({
        success: true,
        data: { account: publicWechatResource(account) },
        requestId: context.requestId,
      }, { status: 201 });
    }
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
    if (deps.onboardingStore) {
      const resource = await deps.onboardingStore.getWechatResource(tenantId, accountId);
      return jsonResponse({ success: true, data: { account: resource ? publicWechatResource(resource) : account?.account }, requestId: context.requestId });
    }
    return jsonResponse({ success: true, data: { account: account?.account }, requestId: context.requestId });
  }

  if ((request.method === 'PATCH' || request.method === 'PUT') && segments.length === 4) {
    requireScope(context, 'woa:account:write');
    const body = await readJsonBody(request) as Record<string, unknown>;
    if (deps.onboardingStore) {
      let resource = await deps.onboardingStore.getWechatResource(tenantId, accountId);
      if (!resource) {
        throw new ApiError('account_not_found', `Account ${accountId} was not found.`, 404);
      }
      const name = stringValue(body.name) ?? stringValue(body.displayName);
      if (name) {
        resource = await deps.onboardingStore.renameWechatResource({ tenantId, resourceId: accountId, name });
      }
      if (body.isDefault === true || body.default === true) {
        resource = await deps.onboardingStore.setDefaultWechatResource({ tenantId, resourceId: accountId });
      }
      return jsonResponse({
        success: true,
        data: { account: publicWechatResource(resource) },
        requestId: context.requestId,
      });
    }
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
    const body = await readJsonBody(request) as Record<string, unknown>;
    if (deps.onboardingStore) {
      await deps.onboardingStore.softDeleteWechatResource({
        tenantId,
        resourceId: accountId,
        confirmation: stringValue(body.confirmation) ?? '',
      });
      return jsonResponse({
        success: true,
        data: { accountId, deleted: true, secretsPurged: true },
        requestId: context.requestId,
      });
    }
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
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'woa_account',
      action: 'configure',
      params: { action: 'configure', tenantId, accountId },
    }, async () => {
      const config = {
        appId: body.appId,
        appSecret: body.appSecret,
        token: body.token,
        encodingAESKey: body.encodingAESKey,
      };
      if (deps.onboardingStore) {
        if (!deps.validateWechatCredentials) {
          throw new ApiError('runtime_unavailable', 'WeChat credential validation is not configured in this runtime.', 500);
        }
        const tokenInfo = await deps.validateWechatCredentials(config, account);
        const resource = await deps.onboardingStore.configureValidatedWechatCredentials({
          tenantId,
          resourceId: accountId,
          config,
          tokenInfo,
        });
        return publicWechatResource(resource);
      }
      const apiClient = await deps.createApiClient();
      await apiClient.getAuthManager().setConfig(config);
      return {
        tenantId,
        accountId,
        appId: body.appId,
        hasAppSecret: true,
        hasToken: !!body.token,
        hasEncodingAESKey: !!body.encodingAESKey,
      };
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'status') {
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'woa_account',
      action: 'status',
      params: { action: 'status', tenantId, accountId },
    }, async () => {
      if (deps.onboardingStore) {
        const resource = await deps.onboardingStore.getWechatResource(tenantId, accountId);
        return {
          account: resource ? publicWechatResource(resource) : account?.account,
          configured: resource?.status === 'active' && resource.hasAppSecret,
          config: resource ? {
            appId: resource.appId,
            hasAppSecret: resource.hasAppSecret,
            hasToken: resource.hasWebhookToken,
            hasEncodingAESKey: resource.hasEncodingAESKey,
          } : null,
        };
      }
      const apiClient = await deps.createApiClient();
      const config = await apiClient.getAuthManager().getConfig();
      return {
        account: account?.account,
        configured: !!(config?.appId && config?.appSecret),
        config: maskConfig(config),
      };
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'POST' && segments.length === 6 && segments[4] === 'token' && segments[5] === 'refresh') {
    requireScope(context, 'woa:account:write');
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'wechat_auth',
      action: 'refresh_token',
      params: { action: 'refresh_token', tenantId, accountId },
    }, async () => {
      const apiClient = await deps.createApiClient();
      const token = await apiClient.getAuthManager().refreshAccessToken();
      return {
        accountId,
        expiresIn: token.expiresIn,
        expiresAt: token.expiresAt,
      };
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'drafts') {
    requireScope(context, 'woa:content:read');
    const url = new URL(request.url);
    const params = {
      action: 'list',
      offset: intQuery(url, 'offset', 0),
      count: clampIntQuery(url, 'count', 20, 1, 20),
      no_content: clampIntQuery(url, 'no_content', 1, 0, 1),
      tenantId,
      accountId,
    };
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'wechat_draft',
      action: 'list',
      params,
    }, async () => {
      const apiClient = await deps.createApiClient();
      return await apiClient.post('/cgi-bin/draft/batchget', {
        offset: params.offset,
        count: params.count,
        no_content: params.no_content,
      });
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'DELETE' && segments.length === 6 && segments[4] === 'drafts') {
    requireScope(context, 'woa:content:write');
    const mediaId = decodePathSegment(segments[5], 'mediaId');
    const params = {
      action: 'delete',
      mediaId,
      tenantId,
      accountId,
    };
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'wechat_draft',
      action: 'delete',
      params,
    }, async () => {
      const apiClient = await deps.createApiClient();
      await apiClient.post('/cgi-bin/draft/delete', {
        media_id: mediaId,
      });
      return {
        deleted: true,
        tenantId,
        accountId,
        mediaId,
      };
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'publishes') {
    requireScope(context, 'woa:content:read');
    const url = new URL(request.url);
    const params = {
      action: 'list',
      offset: intQuery(url, 'offset', 0),
      count: clampIntQuery(url, 'count', 20, 1, 20),
      no_content: clampIntQuery(url, 'no_content', 1, 0, 1),
      tenantId,
      accountId,
    };
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'wechat_publish',
      action: 'list',
      params,
    }, async () => {
      const apiClient = await deps.createApiClient();
      return await apiClient.post('/cgi-bin/freepublish/batchget', {
        offset: params.offset,
        count: params.count,
        no_content: params.no_content,
      });
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'DELETE' && segments.length === 6 && segments[4] === 'publishes') {
    requireScope(context, 'woa:content:write');
    const url = new URL(request.url);
    const articleId = decodePathSegment(segments[5], 'articleId');
    const index = url.searchParams.has('index')
      ? clampIntQuery(url, 'index', 0, 0, 20)
      : undefined;
    const params = {
      action: 'delete',
      articleId,
      index,
      tenantId,
      accountId,
    };
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'wechat_publish',
      action: 'delete',
      params,
    }, async () => {
      const apiClient = await deps.createApiClient();
      await apiClient.post('/cgi-bin/freepublish/delete', {
        article_id: articleId,
        ...(index === undefined ? {} : { index }),
      });
      return {
        deleted: true,
        tenantId,
        accountId,
        articleId,
        index: index ?? null,
      };
    });
    return apiSuccess(data, context, quota);
  }

  if (request.method === 'GET' && segments.length === 5 && segments[4] === 'inbox') {
    requireScope(context, 'woa:inbox:read');
    const url = new URL(request.url);
    const pendingOnly = url.searchParams.get('pending') !== 'false';
    const params = {
      action: pendingOnly ? 'list_pending' : 'list_all',
      tenantId,
      accountId,
      pendingOnly,
      type: url.searchParams.get('type') ?? undefined,
      openid: url.searchParams.get('openid') ?? undefined,
      limit: clampIntQuery(url, 'limit', 20, 1, 100),
      offset: intQuery(url, 'offset', 0),
    };
    const { data, quota } = await runWithOptionalQuota(deps, context, account, {
      toolName: 'wechat_inbox',
      action: params.action,
      params,
    }, async () => {
      const apiClient = await deps.createApiClient();
      const inboxStore = getInboxStore(apiClient);
      return await inboxStore.listMessages({
        pendingOnly: params.pendingOnly,
        type: params.type,
        openid: params.openid,
        limit: params.limit,
        offset: params.offset,
        tenantId,
        accountId,
      });
    });
    return apiSuccess(data, context, quota);
  }

  throw new ApiError('not_found', 'Account API route not found.', 404);
}

async function runWithOptionalQuota<T>(
  deps: ManagementApiDeps,
  context: TenantRequestContext,
  account: AccountContext | undefined,
  quotaRequest: {
    toolName: string;
    action: string;
    params: Record<string, unknown>;
  },
  operation: () => Promise<T>,
): Promise<{ data: T; quota?: QuotaMetadata }> {
  if (!deps.usageStore) {
    return { data: await operation() };
  }

  const tenantId = account?.tenantId ?? context.defaultTenantId ?? String(quotaRequest.params.tenantId ?? 'tenant_unknown');
  const accountId = account?.accountId ?? context.defaultAccountId ?? stringValue(quotaRequest.params.accountId);
  const reservation = await reserveMcpToolQuota({
    store: deps.usageStore,
    tenantId,
    accountId,
    userId: context.userId,
    oauthClientId: context.oauthClientId,
    requestId: context.requestId,
    toolName: quotaRequest.toolName,
    action: quotaRequest.action,
    params: quotaRequest.params,
  });

  try {
    const data = await operation();
    await reservation.commit();
    return { data, quota: reservation.metadata() };
  } catch (error) {
    await reservation.refund('rest_operation_error');
    throw error;
  }
}

function apiSuccess(data: unknown, context: TenantRequestContext, quota?: QuotaMetadata): Response {
  return jsonResponse({
    success: true,
    data,
    ...(quota ? { meta: { quota } } : {}),
    requestId: context.requestId,
  });
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

function decodePathSegment(value: string | undefined, field: string): string {
  if (!value) {
    throw new ApiError('validation_error', `${field} is required.`, 400, { field });
  }
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.trim()) {
      throw new Error('empty');
    }
    return decoded;
  } catch {
    throw new ApiError('validation_error', `${field} must be URL encoded path text.`, 400, { field });
  }
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


function publicWechatResource(resource: WechatResourceRecord): Record<string, unknown> {
  return {
    tenantId: resource.tenantId,
    accountId: resource.accountId,
    slug: resource.slug,
    name: resource.name,
    appId: resource.appId,
    status: resource.status,
    isDefault: resource.isDefault === true,
    hasAppSecret: resource.hasAppSecret,
    hasWebhookToken: resource.hasWebhookToken,
    hasEncodingAESKey: resource.hasEncodingAESKey,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
