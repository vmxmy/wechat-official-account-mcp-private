import { Agent, getAgentByName } from 'agents';
import { DurableObjectEventStore, McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  OAuthProvider,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import CryptoJS from 'crypto-js';
import { logger } from '../utils/logger.js';
import type { AccessTokenInfo, WechatConfig } from '../mcp-tool/types.js';
import type { McpTool } from '../mcp-tool/types.js';
import { workerSharedMcpTools, withOptionalAccountId } from '../mcp-tool/tools/index.js';
import { createTenantManagementMcpTools } from '../mcp-tool/tools/tenant-management-tools.js';
import { D1StorageManager, type D1DatabaseLike } from '../storage/d1-storage-manager.js';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_SLUG,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG,
  type AccountContext,
} from '../storage/types.js';
import { AccessTokenHttpExecutor } from '../wechat/http-executor.js';
import { WorkersHttpExecutor } from '../wechat/workers-http-executor.js';
import type { OutboundProxyConfig } from '../wechat/proxy.js';
import { WechatApiClient } from '../wechat/api-client.js';
import { WechatApiClientFactory } from '../wechat/api-client-factory.js';
import { D1InboxStore } from './inbox-store.js';
import { createWorkerMediaTools } from './media-tools.js';
import type { R2MediaUploadBucket } from './media-upload.js';
import { handleWechatWebhook } from './wechat-webhook.js';
import { D1AuditLogWriter } from './audit-log.js';
import { handleManagementApiRequest } from './management-api.js';
import { executeMcpToolWithQuota } from './mcp-quota.js';
import {
  createStripeCheckoutService,
  createStripeSubscriptionResolver,
  handleStripeWebhookRequest,
  type StripeBillingService,
  type StripePriceIds,
} from './stripe-billing.js';
import {
  ApiError,
  requireConfigurableAccount,
  requireTenantScope,
  resolveAccountContext,
  scopesAllowedByAnyMembership,
  type TenantRequestContext,
} from './tenant-context.js';
import { D1UsageQuotaStore } from './usage-store.js';
import { getAction, isSuccessfulPublishAttempt } from './quota-policy.js';
import { D1SaasOnboardingStore } from './saas-onboarding-store.js';
import { removedMcpTransportResponseForRequest } from './transport-guards.js';
import {
  createGitHubAuthorizeUrl,
  exchangeGitHubOAuthCode,
  fetchGitHubOAuthProfile,
} from './github-oauth.js';
import { renderAuthorizationConsentForm } from './oauth-consent.js';
import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_DYNAMIC_CLIENT_TTL_SECONDS,
  OAUTH_INIT_SCOPES,
  OAUTH_SUPPORTED_SCOPES,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  normalizeRequestedOAuthScopes,
  unsupportedOAuthScopes,
} from './oauth-policy.js';
import { runRetentionMaintenance } from './maintenance.js';
import { verifyTurnstile } from './turnstile.js';
import { canUseLegacyGlobalWechatSecrets } from './account-config-policy.js';
import { D1AgentInitStore } from './agent-init-store.js';
import {
  deleteWechatResourceWithAudit,
  handleCredentialHandoffRequest,
  persistCredentialConfigurationWithAudit,
  resolveAgentInitEgressContext,
  testCoverFilename,
  testDraftTitle,
  WechatCredentialProbeError,
  wechatCredentialProbeErrorForResponse,
} from './agent-init.js';

type SecretBinding = string | { get(): Promise<string | null> };
type DurableObjectNamespaceLike = unknown;
type KVNamespaceLike = unknown;
type AssetsBindingLike = { fetch(request: Request): Promise<Response> };

export interface WorkerEnv {
  WECHAT_MCP_AGENT: DurableObjectNamespaceLike;
  TOKEN_OWNER: DurableObjectNamespaceLike;
  DB: D1DatabaseLike;
  MEDIA: R2MediaUploadBucket;
  ASSETS?: AssetsBindingLike;
  OAUTH_KV: KVNamespaceLike;
  OAUTH_PROVIDER: OAuthHelpers;
  WECHAT_APP_ID: SecretBinding;
  WECHAT_APP_SECRET: SecretBinding;
  WECHAT_MCP_SECRET_KEY: SecretBinding;
  WECHAT_WEBHOOK_TOKEN: SecretBinding;
  WECHAT_ENCODING_AES_KEY: SecretBinding;
  WECHAT_DEFAULT_WEBHOOK_ACCOUNT_ID?: SecretBinding;
  WECHAT_PROXY_URL?: SecretBinding;
  WECHAT_PROXY_TOKEN?: SecretBinding;
  OAUTH_CLIENT_ID: SecretBinding;
  OAUTH_CLIENT_SECRET: SecretBinding;
  STRIPE_SECRET_KEY?: SecretBinding;
  STRIPE_WEBHOOK_SECRET?: SecretBinding;
  STRIPE_PLUS_PRICE_ID?: SecretBinding;
  STRIPE_PRO_PRICE_ID?: SecretBinding;
  STRIPE_BILLING_SUCCESS_URL?: SecretBinding;
  STRIPE_BILLING_CANCEL_URL?: SecretBinding;
  RESEND_API_KEY?: SecretBinding;
  RESEND_FROM_EMAIL?: SecretBinding;
  TURNSTILE_SECRET_KEY?: SecretBinding;
  GITHUB_CLIENT_ID?: SecretBinding;
  GITHUB_CLIENT_SECRET?: SecretBinding;
  ENVIRONMENT?: string;
  WECHAT_EGRESS_IPS?: string;
  WECHAT_EGRESS_CONFIG_VERSION?: string;
  WECHAT_EGRESS_UPDATED_AT?: string;
}

type TokenOwnerRequestOptions = {
  forceRefresh?: boolean;
  accountContext?: AccountContext;
};

type TokenOwnerStub = {
  getAccessToken(options?: TokenOwnerRequestOptions): Promise<AccessTokenInfo>;
  refreshAccessToken(options?: TokenOwnerRequestOptions): Promise<AccessTokenInfo>;
  clearAccessToken(options?: { accountContext?: AccountContext }): Promise<void>;
  replaceAccessToken(tokenInfo: AccessTokenInfo, options?: { accountContext?: AccountContext }): Promise<void>;
  acquireCredentialConfigurationLease(input: { leaseId: string; ttlMs?: number }): Promise<boolean>;
  releaseCredentialConfigurationLease(input: { leaseId: string }): Promise<void>;
  getDebugStatus(): Promise<Record<string, unknown>>;
  runCoalescingSelfTest(): Promise<Record<string, unknown>>;
  runCredentialLeaseSelfTest(): Promise<Record<string, unknown>>;
};

type WechatMcpAgentStub = {
  runEventStoreSelfTest(): Promise<Record<string, unknown>>;
};

type McpAuthorizationProps = {
  userId?: string;
  oauthClientId?: string;
  scopes?: string[] | string;
};

const WORKER_SHARED_MCP_TOOLS = workerSharedMcpTools;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const WOA_SESSION_COOKIE = 'woa_session';
const GITHUB_OAUTH_COOKIE = 'woa_github_oauth';
const WEB_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const GITHUB_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const EMAIL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RATE_LIMIT_PER_WINDOW = 5;
const IP_RATE_LIMIT_PER_WINDOW = 30;
const INIT_TEST_COVER_SHA256 = 'c2402f8307a0d8b1424557674770de1aa7c3e057ef40dc1702a4aea55f99964d';

export function tokenOwnerNameForAccount(accountContext: AccountContext): string {
  return `token:${accountContext.tenantId}:${accountContext.accountId}`;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

async function resolveSecret(binding: SecretBinding | undefined): Promise<string | null> {
  if (!binding) return null;
  if (typeof binding === 'string') return binding;
  return await binding.get();
}

function isProductionEnv(env: WorkerEnv): boolean {
  return env.ENVIRONMENT === 'production';
}

function wantsJson(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const contentType = request.headers.get('content-type') ?? '';
  return accept.includes('application/json') || contentType.includes('application/json');
}

function normalizeEmailInput(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function randomDigits(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => String(byte % 10)).join('');
}

function randomOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function parseCookieHeader(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join('='));
  }
  return cookies;
}

function getSessionCookie(request: Request): string | null {
  return parseCookieHeader(request.headers.get('cookie'))[WOA_SESSION_COOKIE] || null;
}

function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${WOA_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEB_SESSION_MAX_AGE_SECONDS}${secure}`;
}

function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${WOA_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function githubOAuthStateCookie(state: string, returnTo: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const value = encodeURIComponent(JSON.stringify({ state, returnTo }));
  return `${GITHUB_OAUTH_COOKIE}=${value}; Path=/auth/github/callback; HttpOnly; SameSite=Lax; Max-Age=${GITHUB_OAUTH_STATE_MAX_AGE_SECONDS}${secure}`;
}

function clearGitHubOAuthStateCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${GITHUB_OAUTH_COOKIE}=; Path=/auth/github/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function getGitHubOAuthStateCookie(request: Request): { state: string; returnTo: string } | null {
  const raw = parseCookieHeader(request.headers.get('cookie'))[GITHUB_OAUTH_COOKIE];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; returnTo?: unknown };
    const state = String(parsed.state ?? '');
    if (!state) return null;
    return { state, returnTo: safeReturnTo(parsed.returnTo) };
  } catch {
    return null;
  }
}

function safeReturnTo(value: unknown, fallback = '/onboarding'): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  try {
    const parsed = new URL(text);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

async function readRequestData(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const value = await request.json().catch(() => ({}));
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  }
  const form = await request.formData();
  const data: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    data[key] = typeof value === 'string' ? value : value.name;
  }
  return data;
}

function jsonOrRedirect(
  request: Request,
  payload: Record<string, unknown>,
  redirectTo: string,
  init?: ResponseInit,
): Response {
  if (wantsJson(request)) return json(payload, init);
  return new Response(null, {
    status: init?.status && init.status >= 300 && init.status < 400 ? init.status : 303,
    headers: {
      location: new URL(redirectTo, request.url).toString(),
      ...(init?.headers ?? {}),
    },
  });
}

function isLegacyRestToolPath(pathname: string): boolean {
  return pathname === '/api/wechat/tools' || pathname.startsWith('/api/wechat/tools/');
}

function legacyRestToolRemovedResponse(): Response {
  return json(
    {
      success: false,
      error: 'Legacy unauthenticated REST tool execution has been removed from the Workers runtime.',
      migration: 'Use OAuth-protected MCP Streamable HTTP at /mcp with tools/list and tools/call.',
      mcpEndpoint: '/mcp',
    },
    { status: 404 },
  );
}

async function getTokenOwner(env: WorkerEnv, accountContext?: AccountContext): Promise<TokenOwnerStub> {
  return await getAgentByName(
    env.TOKEN_OWNER as any,
    tokenOwnerNameForAccount(accountContext ?? defaultAccountContext()),
  ) as unknown as TokenOwnerStub;
}

async function getDebugMcpAgent(env: WorkerEnv): Promise<WechatMcpAgentStub> {
  return await getAgentByName(
    env.WECHAT_MCP_AGENT as any,
    'streamable-http:debug-event-store',
  ) as unknown as WechatMcpAgentStub;
}

async function createD1Storage(env: WorkerEnv): Promise<D1StorageManager> {
  const storage = new D1StorageManager(env.DB, env.WECHAT_MCP_SECRET_KEY);
  await storage.initialize();
  return storage;
}

async function createSaasOnboardingStore(env: WorkerEnv): Promise<D1SaasOnboardingStore> {
  const store = new D1SaasOnboardingStore(env.DB, env.WECHAT_MCP_SECRET_KEY);
  await store.ensureSchema();
  return store;
}

async function persistValidatedWechatCredentialsForAccount(
  env: WorkerEnv,
  onboardingStore: D1SaasOnboardingStore,
  input: {
    config: WechatConfig;
    account: import('./tenant-context.js').AccountContext;
    tokenInfo: AccessTokenInfo | null | undefined;
    finalize?: () => Promise<void>;
    audit?: {
      userId?: string | null;
      oauthClientId?: string | null;
      successAction?: string;
      metadata?: Record<string, unknown>;
    };
  },
) {
  const accountContext = toStorageAccountContext(input.account);
  const tokenOwner = await getTokenOwner(env, accountContext);
  const leaseId = `credential-config-${crypto.randomUUID()}`;
  if (!(await tokenOwner.acquireCredentialConfigurationLease({ leaseId }))) {
    throw new ApiError(
      'credential_configuration_busy',
      'Another credential configuration is already in progress for this account.',
      409,
    );
  }
  try {
    const currentResource = await onboardingStore.getWechatResource(
      input.account.tenantId,
      input.account.accountId,
    );
    if (!currentResource || currentResource.status === 'disabled' || currentResource.status === 'locked') {
      throw new ApiError('account_not_configurable', 'The WeChat account is not configurable.', 409);
    }
    const snapshotStorage = await createD1Storage(env);
    const previousConfig = await snapshotStorage.getAccountConfig(accountContext);
    const previousToken = await snapshotStorage.getAccountAccessToken(accountContext);
    return await persistCredentialConfigurationWithAudit({
      writeStartedAudit: async () => await writeRequiredAudit(env, {
        userId: input.audit?.userId,
        oauthClientId: input.audit?.oauthClientId,
        tenantId: input.account.tenantId,
        accountId: input.account.accountId,
        action: 'account.credentials_configuration_started',
        targetType: 'wechat_account',
        targetId: input.account.accountId,
        metadata: input.audit?.metadata ?? {},
      }),
      persist: async () => {
        // 先让旧 DO token 失效，再提交新配置；任一步失败都不会让旧 AppID token
        // 在新配置名下继续被复用。
        await tokenOwner.clearAccessToken({ accountContext });
        const resource = await onboardingStore.configureValidatedWechatCredentials({
          tenantId: input.account.tenantId,
          resourceId: input.account.accountId,
          config: input.config,
          tokenInfo: input.tokenInfo,
        });
        if (input.tokenInfo) {
          await tokenOwner.replaceAccessToken(input.tokenInfo, { accountContext });
        }
        return resource;
      },
      writeSucceededAudit: async () => await writeRequiredAudit(env, {
        userId: input.audit?.userId,
        oauthClientId: input.audit?.oauthClientId,
        tenantId: input.account.tenantId,
        accountId: input.account.accountId,
        action: input.audit?.successAction ?? 'account.credentials_persisted',
        targetType: 'wechat_account',
        targetId: input.account.accountId,
        metadata: input.audit?.metadata ?? {},
      }),
      finalize: input.finalize,
      rollback: async () => await restoreWechatCredentialsForAccount(env, onboardingStore, {
        account: input.account,
        previousConfig,
        previousToken,
        previousStatus: currentResource.status,
      }),
      writeRollbackAudit: async () => await writeRequiredAudit(env, {
        userId: input.audit?.userId,
        oauthClientId: input.audit?.oauthClientId,
        tenantId: input.account.tenantId,
        accountId: input.account.accountId,
        action: 'account.credentials_configuration_rolled_back',
        targetType: 'wechat_account',
        targetId: input.account.accountId,
        metadata: input.audit?.metadata ?? {},
      }),
    });
  } finally {
    await tokenOwner.releaseCredentialConfigurationLease({ leaseId });
  }
}

async function softDeleteWechatResourceForAccount(
  env: WorkerEnv,
  onboardingStore: D1SaasOnboardingStore,
  input: {
    account: import('./tenant-context.js').AccountContext;
    confirmation: string;
    userId?: string | null;
    oauthClientId?: string | null;
  },
): Promise<void> {
  if (input.confirmation !== `DELETE ${input.account.accountId}`) {
    throw new Error(`Resource deletion requires confirmation marker: DELETE ${input.account.accountId}`);
  }
  const accountContext = toStorageAccountContext(input.account);
  const tokenOwner = await getTokenOwner(env, accountContext);
  const leaseId = `credential-delete-${crypto.randomUUID()}`;
  if (!(await tokenOwner.acquireCredentialConfigurationLease({ leaseId }))) {
    throw new ApiError(
      'credential_configuration_busy',
      'Another credential operation is already in progress for this account.',
      409,
    );
  }
  try {
    const storage = await createD1Storage(env);
    const previousToken = await storage.getAccountAccessToken(accountContext);
    const succeededAuditStatement = await new D1AuditLogWriter(env.DB).prepareWriteStatement({
      userId: input.userId,
      oauthClientId: input.oauthClientId,
      tenantId: input.account.tenantId,
      accountId: input.account.accountId,
      action: 'account.delete',
      targetType: 'wechat_account',
      targetId: input.account.accountId,
      metadata: { secretsPurged: true, tokenOwnerCleared: true },
    });
    await deleteWechatResourceWithAudit({
      writeStartedAudit: async () => await writeRequiredAudit(env, {
        userId: input.userId,
        oauthClientId: input.oauthClientId,
        tenantId: input.account.tenantId,
        accountId: input.account.accountId,
        action: 'account.deletion_started',
        targetType: 'wechat_account',
        targetId: input.account.accountId,
      }),
      clearToken: async () => await tokenOwner.clearAccessToken({ accountContext }),
      deleteWithSucceededAudit: async () => await onboardingStore.softDeleteWechatResourceAtomically({
        tenantId: input.account.tenantId,
        resourceId: input.account.accountId,
        confirmation: input.confirmation,
      }, [succeededAuditStatement]),
      restoreToken: async () => {
        if (previousToken) {
          await tokenOwner.replaceAccessToken(previousToken, { accountContext });
        }
      },
    });
  } finally {
    await tokenOwner.releaseCredentialConfigurationLease({ leaseId });
  }
}

async function restoreWechatCredentialsForAccount(
  env: WorkerEnv,
  onboardingStore: D1SaasOnboardingStore,
  input: {
    account: import('./tenant-context.js').AccountContext;
    previousConfig: WechatConfig | null;
    previousToken: AccessTokenInfo | null;
    previousStatus: string;
  },
): Promise<void> {
  const accountContext = toStorageAccountContext(input.account);
  const storage = await createD1Storage(env);
  const tokenOwner = await getTokenOwner(env, accountContext);
  await tokenOwner.clearAccessToken({ accountContext });
  await storage.clearAccountAccessToken(accountContext);
  if (input.previousConfig) {
    await onboardingStore.configureValidatedWechatCredentials({
      tenantId: input.account.tenantId,
      resourceId: input.account.accountId,
      config: input.previousConfig,
      tokenInfo: null,
    });
  } else {
    await storage.clearAccountConfig(accountContext);
  }
  await env.DB.prepare(
    `UPDATE wechat_accounts
     SET status = CASE WHEN status = 'locked' THEN status ELSE ? END,
         updated_at = ?
     WHERE tenant_id = ? AND id = ? AND status != 'disabled'`,
  ).bind(
    input.previousStatus || (input.previousConfig ? 'active' : 'unconfigured'),
    Date.now(),
    input.account.tenantId,
    input.account.accountId,
  ).run();
  if (input.previousToken) {
    await storage.saveAccountAccessToken(accountContext, input.previousToken);
    await tokenOwner.replaceAccessToken(input.previousToken, { accountContext });
  }
}

function createAgentInitDeps(env: WorkerEnv) {
  return {
    store: new D1AgentInitStore(env.DB),
    egress: resolveAgentInitEgressContext({
      ips: env.WECHAT_EGRESS_IPS,
      configVersion: env.WECHAT_EGRESS_CONFIG_VERSION,
      updatedAt: env.WECHAT_EGRESS_UPDATED_AT,
    }),
    testCoverChecksum: INIT_TEST_COVER_SHA256,
    findTestCover: async (input: { runId: string; account: import('./tenant-context.js').AccountContext }) => {
      const apiClient = (await createWorkerToolContext(env, toStorageAccountContext(input.account))).apiClient;
      const expectedName = testCoverFilename(input.runId);
      let offset = 0;
      for (let page = 0; page < 10; page += 1) {
        const result = await apiClient.post('/cgi-bin/material/batchget_material', {
          type: 'image',
          offset,
          count: 20,
        }) as {
          total_count?: number;
          item?: Array<{ media_id?: string; name?: string }>;
          errcode?: number;
        };
        if (result.errcode) throw new Error('WeChat test-cover reconciliation failed.');
        const items = Array.isArray(result.item) ? result.item : [];
        const existing = items.find(item => item.name === expectedName && item.media_id);
        if (existing?.media_id) {
          return { mediaId: existing.media_id, checksum: INIT_TEST_COVER_SHA256 };
        }
        offset += items.length;
        if (items.length === 0 || offset >= (result.total_count ?? offset)) break;
      }
      return null;
    },
    uploadTestCover: async (input: { runId: string; account: import('./tenant-context.js').AccountContext }) => {
      const apiClient = (await createWorkerToolContext(env, toStorageAccountContext(input.account))).apiClient;
      const bytes = createInitTestCoverBytes();
      const form = new FormData();
      form.append('media', new Blob([bytes], { type: 'image/bmp' }), testCoverFilename(input.runId));
      const result = await apiClient.postForm('/cgi-bin/material/add_material?type=image', form) as {
        media_id?: string;
        errcode?: number;
      };
      if (result.errcode || !result.media_id) {
        throw new Error('WeChat did not return a media_id for the init test cover.');
      }
      return { mediaId: result.media_id, checksum: INIT_TEST_COVER_SHA256 };
    },
    findTestDraft: async (input: { runId: string; account: import('./tenant-context.js').AccountContext }) => {
      const apiClient = (await createWorkerToolContext(env, toStorageAccountContext(input.account))).apiClient;
      const expectedTitle = testDraftTitle(input.runId);
      let offset = 0;
      for (let page = 0; page < 10; page += 1) {
        const result = await apiClient.post('/cgi-bin/draft/batchget', {
          offset,
          count: 20,
          no_content: 0,
        }) as {
          total_count?: number;
          item?: Array<{ media_id?: string; content?: { news_item?: Array<{ title?: string }> } }>;
          errcode?: number;
        };
        if (result.errcode) throw new Error('WeChat test-draft reconciliation failed.');
        const items = Array.isArray(result.item) ? result.item : [];
        const existing = items.find(item =>
          item.media_id && item.content?.news_item?.[0]?.title === expectedTitle,
        );
        if (existing?.media_id) return { mediaId: existing.media_id, title: expectedTitle };
        offset += items.length;
        if (items.length === 0 || offset >= (result.total_count ?? offset)) break;
      }
      return null;
    },
    createTestDraft: async (input: {
      runId: string;
      account: import('./tenant-context.js').AccountContext;
      coverMediaId: string;
    }) => {
      const apiClient = (await createWorkerToolContext(env, toStorageAccountContext(input.account))).apiClient;
      const title = testDraftTitle(input.runId);
      const result = await apiClient.post('/cgi-bin/draft/add', {
        articles: [{
          article_type: 'news',
          title,
          author: 'WOA',
          digest: '用于验证 MCP 连接与公众号草稿写入能力；不会自动发布。',
          content: '<p>这是 WOA 首次接入的未发布测试草稿。验证完成后可在公众号后台保留或手动删除。</p>',
          content_source_url: '',
          thumb_media_id: input.coverMediaId,
          show_cover_pic: 0,
          need_open_comment: 0,
          only_fans_can_comment: 0,
        }],
      }) as { media_id?: string; errcode?: number };
      if (result.errcode || !result.media_id) {
        throw new Error('WeChat did not return a media_id for the init test draft.');
      }
      return { mediaId: result.media_id, title };
    },
    readTestDraft: async (input: {
      account: import('./tenant-context.js').AccountContext;
      mediaId: string;
      expectedTitle: string;
    }) => {
      const apiClient = (await createWorkerToolContext(env, toStorageAccountContext(input.account))).apiClient;
      const result = await apiClient.post('/cgi-bin/draft/get', {
        media_id: input.mediaId,
      }) as { news_item?: Array<{ title?: string }>; errcode?: number };
      const articles = Array.isArray(result.news_item) ? result.news_item : [];
      const title = articles[0]?.title ?? '';
      if (result.errcode || title !== input.expectedTitle) {
        throw new Error('WeChat test draft read-back did not match the created draft.');
      }
      return {
        mediaId: input.mediaId,
        title,
        articleCount: articles.length,
        readBack: true as const,
      };
    },
  };
}

function createOAuthGrantManagementDeps(env: WorkerEnv) {
  return {
    listOAuthGrantSessions: async (operatorId: string) => {
      const sessions: Array<{
        id: string;
        kind: 'oauth';
        clientName: string;
        clientId?: string;
        createdAt: number;
        expiresAt: number;
        canRevoke: boolean;
      }> = [];
      let cursor: string | undefined;
      do {
        const page = await env.OAUTH_PROVIDER.listUserGrants(operatorId, { limit: 100, cursor });
        for (const grant of page.items) {
          sessions.push({
            id: grant.id,
            kind: 'oauth',
            clientId: grant.clientId,
            clientName: grant.clientId || 'OAuth client',
            createdAt: grant.createdAt * 1000,
            expiresAt: (grant.expiresAt ?? grant.createdAt) * 1000,
            canRevoke: !grant.expiresAt || grant.expiresAt * 1000 > Date.now(),
          });
        }
        cursor = page.cursor;
      } while (cursor);
      return sessions;
    },
    revokeOAuthGrant: async (grantId: string, operatorId: string): Promise<boolean> => {
      let cursor: string | undefined;
      do {
        const page = await env.OAUTH_PROVIDER.listUserGrants(operatorId, { limit: 100, cursor });
        if (page.items.some(grant => grant.id === grantId && grant.userId === operatorId)) {
          await env.OAUTH_PROVIDER.revokeGrant(grantId, operatorId);
          return true;
        }
        cursor = page.cursor;
      } while (cursor);
      return false;
    },
  };
}

async function hasActiveOAuthClientGrant(
  env: WorkerEnv,
  operatorId: string,
  clientId: string,
): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(operatorId, { limit: 100, cursor });
    if (page.items.some(grant =>
      grant.clientId === clientId &&
      (!grant.expiresAt || grant.expiresAt * 1000 > Date.now()) &&
      OAUTH_INIT_SCOPES.every(scope => grant.scope.includes(scope)),
    )) {
      return true;
    }
    cursor = page.cursor;
  } while (cursor);
  return false;
}

async function assertCredentialHandoffAuthority(
  env: WorkerEnv,
  onboardingStore: D1SaasOnboardingStore,
  initStore: D1AgentInitStore,
  operatorId: string,
  handoff: import('./agent-init-store.js').AgentCredentialHandoffRecord,
): Promise<import('./tenant-context.js').AccountContext> {
  const operatorContext = await onboardingStore.getTenantContextForOperator(operatorId, { source: 'rest' });
  const account = operatorContext.accounts.find(item =>
    item.tenantId === handoff.tenantId && item.accountId === handoff.accountId,
  );
  if (!account) {
    throw new ApiError(
      'membership_scope_denied',
      'The target WeChat account is no longer accessible to this Operator.',
      403,
    );
  }
  requireTenantScope(operatorContext, handoff.tenantId, 'woa:account:write');
  const accountContext = { tenantId: handoff.tenantId, accountId: handoff.accountId, account };
  requireConfigurableAccount(accountContext);
  const run = await initStore.getRun(operatorId, handoff.runId);
  if (
    !run?.oauthClientId ||
    !(await hasActiveOAuthClientGrant(env, operatorId, run.oauthClientId))
  ) {
    throw new ApiError(
      'oauth_revoked',
      'The OAuth grant that started this initialization run is no longer active or no longer has init scopes.',
      403,
    );
  }
  return accountContext;
}

function toStorageAccountContext(account: import('./tenant-context.js').AccountContext): AccountContext {
  return {
    tenantId: account.tenantId,
    tenantSlug: account.account.slug,
    tenantName: account.tenantId,
    accountId: account.accountId,
    accountSlug: account.account.slug,
    accountName: account.account.name,
    appId: account.account.appId,
    status: account.account.status,
    role: 'owner',
  };
}

/** 320×180 deterministic BMP; large enough to exercise the real cover path without remote assets. */
function createInitTestCoverBytes(): Uint8Array {
  const width = 320;
  const height = 180;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.byteLength, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowSize + x * 3;
      const accent = x > 36 && x < 52;
      bytes[offset] = accent ? 82 : 44;
      bytes[offset + 1] = accent ? 166 : 46;
      bytes[offset + 2] = accent ? 239 : 48;
    }
  }
  return bytes;
}

function getAgentEnv(agent: unknown): WorkerEnv {
  return (agent as { env: WorkerEnv }).env;
}

function defaultAccountContext(appId?: string): AccountContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    tenantSlug: DEFAULT_TENANT_SLUG,
    tenantName: 'Default Tenant',
    accountId: DEFAULT_ACCOUNT_ID,
    accountSlug: DEFAULT_ACCOUNT_SLUG,
    accountName: 'Default WeChat Official Account',
    appId,
    status: 'active',
    role: 'owner',
    scopes: ['woa:*'],
  };
}

class WorkersAuthManager {
  private config: WechatConfig | null = null;

  constructor(
    private readonly storage: D1StorageManager,
    private readonly tokenOwner: TokenOwnerStub,
    private readonly accountContext: AccountContext,
  ) {}

  async initialize(): Promise<void> {
    this.config = await this.storage.getAccountConfig(this.accountContext);
  }

  async setConfig(config: WechatConfig): Promise<void> {
    this.config = config;
    await this.storage.saveAccountConfig({
      tenantId: this.accountContext.tenantId,
      accountId: this.accountContext.accountId,
      accountSlug: this.accountContext.accountSlug,
      accountName: this.accountContext.accountName,
      config,
      isDefault: this.accountContext.tenantId === DEFAULT_TENANT_ID && this.accountContext.accountId === DEFAULT_ACCOUNT_ID,
    });
    await this.storage.clearAccountAccessToken(this.accountContext);
    await this.tokenOwner.clearAccessToken({ accountContext: this.accountContext });
  }

  async getConfig(): Promise<WechatConfig | null> {
    if (!this.config) {
      this.config = await this.storage.getAccountConfig(this.accountContext);
    }
    return this.config;
  }

  async getAccessToken(): Promise<AccessTokenInfo> {
    return await this.tokenOwner.getAccessToken({ accountContext: this.accountContext });
  }

  async refreshAccessToken(): Promise<AccessTokenInfo> {
    return await this.tokenOwner.refreshAccessToken({ accountContext: this.accountContext });
  }

  isConfigured(): boolean {
    return !!(this.config?.appId && this.config?.appSecret);
  }

  async clearAuth(): Promise<void> {
    this.config = null;
    await this.storage.clearAccountConfig(this.accountContext);
    await this.storage.clearAccountAccessToken(this.accountContext);
    await this.tokenOwner.clearAccessToken({ accountContext: this.accountContext });
  }
}

async function createWorkerToolContext(env: WorkerEnv, requestedAccountContext?: AccountContext): Promise<{
  apiClient: WechatApiClient;
  storage: D1StorageManager;
  inboxStore: D1InboxStore;
  accountContext: AccountContext;
}> {
  const storage = await createD1Storage(env);
  const inboxStore = new D1InboxStore(env.DB);
  await inboxStore.ensureSchema();
  const accountContext = requestedAccountContext
    ?? (await storage.getDefaultAccountContext())
    ?? defaultAccountContext();
  const tokenOwner = await getTokenOwner(env, accountContext);
  const proxy = await resolveWorkerProxyConfig(env);

  const factory = new WechatApiClientFactory({
    createAuthManager: async context => {
      const authManager = new WorkersAuthManager(storage, tokenOwner, context);
      await authManager.initialize();
      return authManager;
    },
    createHttpExecutor: async context => new AccessTokenHttpExecutor(
      await createWechatWorkersHttpExecutor(env, proxy),
      async () => (await tokenOwner.getAccessToken({ accountContext: context })).accessToken,
    ),
    createInboxStore: () => inboxStore,
  });

  const apiClient = await factory.create(accountContext);

  return { apiClient, storage, inboxStore, accountContext };
}

async function resolveWorkerProxyConfig(env: WorkerEnv): Promise<OutboundProxyConfig | undefined> {
  const proxyUrl = await resolveSecret(env.WECHAT_PROXY_URL);
  if (!proxyUrl) {
    return undefined;
  }

  return {
    mode: 'relay',
    url: proxyUrl,
    token: await resolveSecret(env.WECHAT_PROXY_TOKEN),
  };
}

async function createWechatWorkersHttpExecutor(
  env: WorkerEnv,
  proxy?: OutboundProxyConfig,
): Promise<WorkersHttpExecutor> {
  // McpAgent 工具调用与 TokenOwner token 刷新共享同一代理解析/校验入口，
  // 避免未来扩展代理配置时两条微信 API 出站路径出现策略漂移。
  return new WorkersHttpExecutor({
    proxy: proxy ?? await resolveWorkerProxyConfig(env),
  });
}

async function resolveStripePriceIds(env: WorkerEnv): Promise<StripePriceIds> {
  return {
    plus: await resolveSecret(env.STRIPE_PLUS_PRICE_ID),
    pro: await resolveSecret(env.STRIPE_PRO_PRICE_ID),
  };
}

async function createStripeBillingServiceForEnv(
  env: WorkerEnv,
  usageStore: D1UsageQuotaStore,
  onboardingStore: D1SaasOnboardingStore,
): Promise<StripeBillingService | undefined> {
  const secretKey = await resolveSecret(env.STRIPE_SECRET_KEY);
  const webhookSecret = await resolveSecret(env.STRIPE_WEBHOOK_SECRET);
  const priceIds = await resolveStripePriceIds(env);
  const defaultSuccessUrl = await resolveSecret(env.STRIPE_BILLING_SUCCESS_URL);
  const defaultCancelUrl = await resolveSecret(env.STRIPE_BILLING_CANCEL_URL);
  if (!secretKey || !webhookSecret || !priceIds.plus || !priceIds.pro || !defaultSuccessUrl || !defaultCancelUrl) {
    return undefined;
  }

  return createStripeCheckoutService({
    secretKey,
    priceIds,
    usageStore,
    resolveOwnerEmail: async tenantId => (await onboardingStore.findTenantOwner(tenantId))?.verifiedEmail,
    defaultSuccessUrl,
    defaultCancelUrl,
  });
}

async function handlePublicAuthRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const store = await createSaasOnboardingStore(env);

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/email-code/request') {
    const data = await readRequestData(request);
    const email = normalizeEmailInput(data.email);
    const returnTo = safeReturnTo(data.returnTo);
    if (!email || !email.includes('@')) {
      return jsonOrRedirect(request, {
        success: false,
        error: { code: 'validation_error', message: '请输入有效邮箱。' },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=invalid_email`, { status: wantsJson(request) ? 400 : 303 });
    }

    const turnstileToken = String(data.turnstileToken ?? data['cf-turnstile-response'] ?? '');
    const turnstile = await verifyTurnstileIfConfigured(env, request, turnstileToken);
    if (!turnstile.ok) {
      await recordLoginFailure(store, 'login.turnstile_failed', { email });
      return jsonOrRedirect(request, {
        success: false,
        error: { code: 'turnstile_failed', message: turnstile.message },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=turnstile`, { status: wantsJson(request) ? 403 : 303 });
    }

    const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
    const emailLimit = await store.recordRateLimitHit({
      bucket: 'email-code-email',
      key: email,
      windowMs: EMAIL_RATE_LIMIT_WINDOW_MS,
      limit: EMAIL_RATE_LIMIT_PER_WINDOW,
    });
    const ipLimit = await store.recordRateLimitHit({
      bucket: 'email-code-ip',
      key: ip,
      windowMs: EMAIL_RATE_LIMIT_WINDOW_MS,
      limit: IP_RATE_LIMIT_PER_WINDOW,
    });
    if (!emailLimit.allowed || !ipLimit.allowed) {
      await recordLoginFailure(store, 'login.rate_limited', {
        email,
        resetAt: Math.max(emailLimit.resetAt, ipLimit.resetAt),
      });
      return jsonOrRedirect(request, {
        success: false,
        error: {
          code: 'rate_limited',
          message: '验证码请求过于频繁，请稍后重试。',
          details: { resetAt: Math.max(emailLimit.resetAt, ipLimit.resetAt) },
        },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=rate_limited`, { status: wantsJson(request) ? 429 : 303 });
    }

    const code = randomDigits(6);
    const issued = await store.issueEmailCode({ email, code, ip });
    const delivery = await sendEmailCode(env, email, code);
    if (!delivery.ok && isProductionEnv(env)) {
      await recordLoginFailure(store, 'login.email_delivery_failed', { email, message: delivery.message });
      return jsonOrRedirect(request, {
        success: false,
        error: { code: 'email_delivery_failed', message: delivery.message },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=email_delivery_failed`, { status: wantsJson(request) ? 503 : 303 });
    }

    return jsonOrRedirect(request, {
      success: true,
      data: {
        email,
        codeId: issued.codeId,
        expiresAt: issued.expiresAt,
        delivery: delivery.ok ? 'sent' : 'not_configured',
        ...(isProductionEnv(env) ? {} : { debugCode: code }),
      },
    }, `/login?returnTo=${encodeURIComponent(returnTo)}&email=${encodeURIComponent(email)}&sent=1`, { status: wantsJson(request) ? 200 : 303 });
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/email-code/verify') {
    const data = await readRequestData(request);
    const email = normalizeEmailInput(data.email);
    const code = String(data.code ?? '').trim();
    const returnTo = safeReturnTo(data.returnTo);
    const verified = await store.verifyEmailCode({
      email,
      code,
      displayName: String(data.displayName ?? '').trim() || undefined,
    });
    if (!verified.ok) {
      await recordLoginFailure(store, 'login.email_code_failed', { email, reason: verified.reason });
      return jsonOrRedirect(request, {
        success: false,
        error: {
          code: `email_code_${verified.reason}`,
          message: emailCodeFailureMessage(verified.reason),
          details: { attemptsRemaining: verified.attemptsRemaining },
        },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&email=${encodeURIComponent(email)}&error=${encodeURIComponent(verified.reason)}`, { status: wantsJson(request) ? 400 : 303 });
    }

    await store.bootstrapDefaultTenantForOperator({ operatorId: verified.operator.operatorId });
    const sessionToken = randomOpaqueToken();
    const session = await store.createWebSession({
      operatorId: verified.operator.operatorId,
      sessionToken,
    });
    await recordLoginSuccess(env, store, verified.operator.operatorId, 'email');
    const response = jsonOrRedirect(request, {
      success: true,
      data: {
        operator: {
          operatorId: verified.operator.operatorId,
          email: verified.operator.verifiedEmail,
          displayName: verified.operator.displayName,
        },
        session: {
          sessionId: session.sessionId,
          expiresAt: session.expiresAt,
        },
        returnTo,
      },
    }, returnTo, { status: wantsJson(request) ? 200 : 303 });
    response.headers.append('set-cookie', sessionCookie(sessionToken, request));
    return response;
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    const sessionToken = getSessionCookie(request);
    if (sessionToken) {
      const session = await store.getWebSession(sessionToken);
      if (session) await store.revokeWebSession(session.sessionId);
    }
    const response = jsonOrRedirect(request, { success: true, data: { loggedOut: true } }, '/login', { status: wantsJson(request) ? 200 : 303 });
    response.headers.append('set-cookie', clearSessionCookie(request));
    return response;
  }

  if (request.method === 'GET' && url.pathname === '/auth/github/callback') {
    const clientId = await resolveSecret(env.GITHUB_CLIENT_ID);
    const clientSecret = await resolveSecret(env.GITHUB_CLIENT_SECRET);
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
    if (!clientId || !clientSecret) {
      await recordLoginFailure(store, 'login.github_unconfigured', {});
      return jsonOrRedirect(request, {
        success: false,
        error: {
          code: 'github_login_not_configured',
          message: 'GitHub 登录未配置，请先使用邮箱验证码登录。',
        },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=github_not_configured`, { status: wantsJson(request) ? 503 : 303 });
    }

    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      await recordLoginFailure(store, 'login.github_denied', { error: oauthError });
      const response = jsonOrRedirect(request, {
        success: false,
        error: {
          code: 'github_oauth_denied',
          message: 'GitHub 授权未完成，请重试或改用邮箱验证码。',
          details: { error: oauthError },
        },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=github_denied`, { status: wantsJson(request) ? 400 : 303 });
      response.headers.append('set-cookie', clearGitHubOAuthStateCookie(request));
      return response;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      const state = randomOpaqueToken();
      const redirectUri = new URL('/auth/github/callback', request.url).toString();
      const authorizeUrl = createGitHubAuthorizeUrl({ clientId, redirectUri, state });
      const response = wantsJson(request)
        ? json({ success: true, data: { authorizationUrl: authorizeUrl } })
        : new Response(null, { status: 302, headers: { location: authorizeUrl } });
      response.headers.append('set-cookie', githubOAuthStateCookie(state, returnTo, request));
      return response;
    }

    const stateCookie = getGitHubOAuthStateCookie(request);
    const state = url.searchParams.get('state') ?? '';
    if (!stateCookie || !state || stateCookie.state !== state) {
      await recordLoginFailure(store, 'login.github_state_mismatch', {});
      const response = jsonOrRedirect(request, {
        success: false,
        error: {
          code: 'github_state_mismatch',
          message: 'GitHub 登录状态已过期，请重新发起授权。',
        },
      }, `/login?returnTo=${encodeURIComponent(returnTo)}&error=github_state`, { status: wantsJson(request) ? 400 : 303 });
      response.headers.append('set-cookie', clearGitHubOAuthStateCookie(request));
      return response;
    }

    try {
      const redirectUri = new URL('/auth/github/callback', request.url).toString();
      const accessToken = await exchangeGitHubOAuthCode({
        clientId,
        clientSecret,
        code,
        redirectUri,
      });
      const profile = await fetchGitHubOAuthProfile({ accessToken });
      if (!profile.verifiedEmail) {
        await recordLoginFailure(store, 'login.github_verified_email_required', {
          providerSubject: profile.providerSubject,
        });
        const emailHint = profile.fallbackEmail ? `&email=${encodeURIComponent(profile.fallbackEmail)}` : '';
        const response = jsonOrRedirect(request, {
          success: false,
          error: {
            code: 'github_verified_email_required',
            message: 'GitHub 未返回已验证邮箱，请改用邮箱验证码完成登录。',
          },
        }, `/login?returnTo=${encodeURIComponent(stateCookie.returnTo)}&error=github_verified_email_required${emailHint}`, { status: wantsJson(request) ? 409 : 303 });
        response.headers.append('set-cookie', clearGitHubOAuthStateCookie(request));
        return response;
      }

      const existing = await store.findOperatorByProviderSubject('github', profile.providerSubject);
      const operator = existing ?? (await store.createOrResolveOperatorByEmail({
        email: profile.verifiedEmail,
        displayName: profile.displayName,
      })).operator;
      await store.linkOperatorIdentity({
        operatorId: operator.operatorId,
        provider: 'github',
        providerSubject: profile.providerSubject,
        verifiedEmail: profile.verifiedEmail,
      });
      await store.bootstrapDefaultTenantForOperator({ operatorId: operator.operatorId });
      const sessionToken = randomOpaqueToken();
      const session = await store.createWebSession({
        operatorId: operator.operatorId,
        sessionToken,
      });
      await recordLoginSuccess(env, store, operator.operatorId, 'github');
      const response = jsonOrRedirect(request, {
        success: true,
        data: {
          operator: {
            operatorId: operator.operatorId,
            email: operator.verifiedEmail,
            displayName: operator.displayName,
          },
          github: {
            login: profile.login,
            providerSubject: profile.providerSubject,
          },
          session: {
            sessionId: session.sessionId,
            expiresAt: session.expiresAt,
          },
          returnTo: stateCookie.returnTo,
        },
      }, stateCookie.returnTo, { status: wantsJson(request) ? 200 : 303 });
      response.headers.append('set-cookie', sessionCookie(sessionToken, request));
      response.headers.append('set-cookie', clearGitHubOAuthStateCookie(request));
      return response;
    } catch (error) {
      await recordLoginFailure(store, 'login.github_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      logger.error('GitHub OAuth login failed', {
        message: error instanceof Error ? error.message : String(error),
        returnTo: stateCookie.returnTo,
      });
      const response = jsonOrRedirect(request, {
        success: false,
        error: {
          code: 'github_oauth_failed',
          message: 'GitHub 登录暂不可用，请稍后重试或改用邮箱验证码。',
        },
      }, `/login?returnTo=${encodeURIComponent(stateCookie.returnTo)}&error=github_oauth_failed`, { status: wantsJson(request) ? 502 : 303 });
      response.headers.append('set-cookie', clearGitHubOAuthStateCookie(request));
      return response;
    }
  }

  return new Response('Not Found', { status: 404 });
}

async function recordLoginSuccess(
  env: WorkerEnv,
  store: D1SaasOnboardingStore,
  operatorId: string,
  provider: 'email' | 'github',
): Promise<void> {
  try {
    const context = await store.getTenantContextForOperator(operatorId, { source: 'rest' });
    await safeWriteAudit(env, {
      userId: operatorId,
      tenantId: context.defaultTenantId,
      accountId: context.defaultAccountId,
      action: 'login.success',
      targetType: 'operator',
      targetId: operatorId,
      metadata: { provider },
    });
  } catch {
    // 登录成功不应因 best-effort audit 写入失败而回滚。
  }
}

async function recordLoginFailure(
  store: D1SaasOnboardingStore,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await store.recordMonitoringEvent({
      eventType,
      severity: 'warning',
      metadata,
    });
  } catch {
    // 登录错误响应不应被 monitoring 写入失败覆盖。
  }
}

async function handleWebSessionManagementApiRequest(request: Request, env: WorkerEnv): Promise<Response | null> {
  const sessionToken = getSessionCookie(request);
  if (!sessionToken) return null;

  const usageStore = new D1UsageQuotaStore(env.DB);
  const onboardingStore = await createSaasOnboardingStore(env);
  const session = await onboardingStore.getWebSession(sessionToken);
  if (!session) return null;

  const trustedContext = await onboardingStore.getTenantContextForOperator({
    operatorId: session.operatorId,
    requestId: request.headers.get('x-request-id'),
  }, { source: 'rest' });

  return await handleManagementApiRequest(request, {
    appId: await resolveSecret(env.WECHAT_APP_ID),
    defaultUserId: session.operatorId,
    defaultClientId: 'web-session',
    usageStore,
    billing: await createStripeBillingServiceForEnv(env, usageStore, onboardingStore),
    mediaBucket: env.MEDIA,
    onboardingStore,
    auditLog: new D1AuditLogWriter(env.DB),
    agentInit: createAgentInitDeps(env),
    ...createOAuthGrantManagementDeps(env),
    validateWechatCredentials: async config => await validateWechatCredentialsForAccount(env, config),
    persistValidatedWechatCredentials: async input => await persistValidatedWechatCredentialsForAccount(
      env,
      onboardingStore,
      {
        ...input,
        audit: {
          userId: trustedContext.userId,
          oauthClientId: trustedContext.oauthClientId,
          successAction: 'account.credentials_configured',
        },
      },
    ),
    deleteWechatResource: async ({ account, confirmation }) => await softDeleteWechatResourceForAccount(
      env,
      onboardingStore,
      {
        account,
        confirmation,
        userId: trustedContext.userId,
        oauthClientId: trustedContext.oauthClientId,
      },
    ),
    trustedContext,
    createApiClient: async account => (await createWorkerToolContext(
      env,
      account ? toStorageAccountContext(account) : undefined,
    )).apiClient,
  });
}

async function verifyTurnstileIfConfigured(env: WorkerEnv, request: Request, token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await verifyTurnstile({
    secretBinding: env.TURNSTILE_SECRET_KEY,
    production: isProductionEnv(env),
    request,
    token,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message ?? 'Turnstile 校验未通过。' };
}

async function sendEmailCode(env: WorkerEnv, email: string, code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = await resolveSecret(env.RESEND_API_KEY);
  const from = await resolveSecret(env.RESEND_FROM_EMAIL) ?? 'WOA <no-reply@ziikoo.app>';
  if (!apiKey) {
    return { ok: false, message: 'Resend API key is not configured.' };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'WOA 登录验证码',
      text: `你的 WOA 登录验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略本邮件。`,
    }),
  });
  if (!response.ok) {
    return { ok: false, message: `Resend delivery failed with HTTP ${response.status}.` };
  }
  return { ok: true };
}

function emailCodeFailureMessage(reason: string): string {
  if (reason === 'expired') return '验证码已过期，请重新获取。';
  if (reason === 'attempt_limit') return '验证码尝试次数已用尽，请重新获取。';
  if (reason === 'invalid_code') return '验证码不正确。';
  return '未找到可用验证码，请先获取验证码。';
}

async function validateWechatCredentialsForAccount(
  env: WorkerEnv,
  config: WechatConfig,
): Promise<AccessTokenInfo> {
  const proxy = await resolveWorkerProxyConfig(env);
  if (!proxy) {
    throw new WechatCredentialProbeError(
      'wechat_relay_unavailable',
      'The controlled WeChat relay is not configured.',
      503,
    );
  }

  try {
    const executor = await createWechatWorkersHttpExecutor(env, proxy);
    const response = await executor.get<{
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    }>('/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid: config.appId,
        secret: config.appSecret,
      },
    });
    const result = response.data;
    if (result.errcode || !result.access_token || !result.expires_in) {
      throw wechatCredentialProbeErrorForResponse({ errcode: result.errcode });
    }
    return {
      accessToken: result.access_token,
      expiresIn: result.expires_in,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
  } catch (error) {
    if (error instanceof WechatCredentialProbeError) throw error;
    const httpStatus = (error as { response?: { status?: unknown } } | null)?.response?.status;
    throw wechatCredentialProbeErrorForResponse({
      httpStatus: typeof httpStatus === 'number' ? httpStatus : undefined,
    });
  }
}

async function resolveTrustedTenantContext(
  env: WorkerEnv,
  request: Request,
  props: { userId?: string; oauthClientId?: string; scopes: string[] },
  store: D1SaasOnboardingStore,
  source: TenantRequestContext['source'],
): Promise<TenantRequestContext> {
  if (!props.userId) {
    throw new ApiError('unauthorized', 'OAuth authorization is missing an Operator identity.', 401);
  }

  const stored = await store.getTenantContextForOperator({
    operatorId: props.userId,
    oauthClientId: props.oauthClientId,
    scopes: props.scopes,
    requestId: request.headers.get('x-request-id'),
  }, { source });
  if (stored.tenants.length === 0) {
    throw new ApiError(
      'tenant_required',
      'The authorized Operator has no accessible tenant. Re-authenticate after onboarding.',
      403,
    );
  }
  return stored;
}

function isStripeWebhookPath(pathname: string): boolean {
  return pathname === '/api/stripe/webhook';
}

function registerWorkerMcpTool(
  server: McpServer,
  tool: McpTool,
  resolveApiClient: (account: import('./tenant-context.js').AccountContext) => Promise<WechatApiClient>,
  resolveTenantContext: () => Promise<TenantRequestContext>,
  usageStore: D1UsageQuotaStore,
  auditLog: D1AuditLogWriter,
  onboardingStore: D1SaasOnboardingStore,
): void {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema as any,
    async (params: unknown) => {
      let failureContext: TenantRequestContext | undefined;
      let failureTenantId: string | undefined;
      let failureAccountId: string | undefined;
      try {
        const tenantContext = await resolveTenantContext();
        failureContext = tenantContext;
        try {
          const requested = params && typeof params === 'object' && !Array.isArray(params)
            ? params as Record<string, unknown>
            : {};
          const account = resolveAccountContext(requested, tenantContext, {
            requireAccount: !tool.name.startsWith('woa_'),
          });
          failureTenantId = account?.tenantId ?? tenantContext.defaultTenantId;
          failureAccountId = account?.accountId ?? tenantContext.defaultAccountId;
        } catch {
          failureTenantId = tenantContext.defaultTenantId;
          failureAccountId = tenantContext.defaultAccountId;
        }
        const result = await executeMcpToolWithQuota({
          tool,
          resolveApiClient,
          params,
          tenantContext,
          usageStore,
        });
        const action = getAction(params);
        const resultMeta = result._meta && typeof result._meta === 'object'
          ? result._meta as Record<string, unknown>
          : {};
        const tenantId = typeof resultMeta.tenantId === 'string'
          ? resultMeta.tenantId
          : failureTenantId;
        const accountId = typeof resultMeta.accountId === 'string'
          ? resultMeta.accountId
          : failureAccountId;
        const resultError = resultMeta.error;
        const quotaRejected = resultError &&
          typeof resultError === 'object' &&
          (resultError as Record<string, unknown>).code === 'quota_exceeded';
        if (quotaRejected) {
          await auditLog.write({
            userId: tenantContext.userId,
            oauthClientId: tenantContext.oauthClientId,
            tenantId,
            accountId,
            action: 'quota.rejected',
            targetType: 'mcp_tool',
            targetId: tool.name,
            requestId: tenantContext.requestId,
            metadata: { toolName: tool.name, action, error: resultError },
          });
          await onboardingStore.recordMonitoringEvent({
            eventType: 'quota.rejected',
            tenantId,
            accountId,
            severity: 'warning',
            metadata: { toolName: tool.name, action, requestId: tenantContext.requestId },
          });
        } else if (!result.isError && isSuccessfulPublishAttempt(tool.name, action)) {
          await auditLog.write({
            userId: tenantContext.userId,
            oauthClientId: tenantContext.oauthClientId,
            tenantId,
            accountId,
            action: 'publish.success',
            targetType: 'mcp_tool',
            targetId: tool.name,
            requestId: tenantContext.requestId,
            metadata: { toolName: tool.name, action },
          });
        }
        return result as any;
      } catch (error) {
        try {
          const tenantContext = failureContext ?? await resolveTenantContext();
          await onboardingStore.recordMonitoringEvent({
            eventType: 'mcp.tool_failed',
            tenantId: failureTenantId ?? tenantContext.defaultTenantId,
            accountId: failureAccountId ?? tenantContext.defaultAccountId,
            severity: 'warning',
            metadata: {
              toolName: tool.name,
              action: getAction(params),
              requestId: tenantContext.requestId,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        } catch {
          // MCP 原始错误优先于 best-effort monitoring。
        }
        if (error instanceof ApiError) {
          return {
            content: [{
              type: 'text' as const,
              text: `操作被拒绝：${error.message}`,
            }],
            isError: true,
            _meta: {
              error: {
                code: error.code,
                details: error.details,
              },
            },
          };
        }
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}

async function handleWechatCallbackRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const routeAccountId = getWechatCallbackAccountId(url.pathname);
  const resolved = routeAccountId
    ? await resolveAccountWebhookConfig(env, routeAccountId)
    : await resolveLegacyWebhookConfig(env);

  if (resolved.kind === 'ambiguous') {
    await safeWriteAudit(env, {
      action: 'webhook.legacy_route_rejected',
      targetType: 'wechat_webhook',
      requestId: request.headers.get('cf-ray') ?? crypto.randomUUID(),
      metadata: {
        path: url.pathname,
        reason: 'multiple_active_accounts',
        migration: '/wx/callback/{accountId}',
      },
    });
    return json(
      {
        success: false,
        error: 'Ambiguous WeChat callback route. Configure the account-addressable callback URL for this account.',
        migration: 'Use /wx/callback/{accountId}; accountId is the opaque WeChat account id from the management surface.',
      },
      { status: 409 },
    );
  }

  if (resolved.kind === 'missing') {
    await safeWriteAudit(env, {
      action: 'webhook.account_route_rejected',
      targetType: 'wechat_webhook',
      targetId: routeAccountId,
      requestId: request.headers.get('cf-ray') ?? crypto.randomUUID(),
      metadata: {
        path: url.pathname,
        reason: routeAccountId ? 'unknown_or_disabled_account' : 'missing_single_account_config',
      },
    });
    return new Response(
      routeAccountId
        ? 'Unknown or disabled WeChat account callback route.'
        : 'Webhook account is not configured. Use /wx/callback/{accountId} after account setup.',
      { status: routeAccountId ? 404 : 500 },
    );
  }

  const inboxStore = new D1InboxStore(env.DB);
  await inboxStore.ensureSchema();

  const response = await handleWechatWebhook(request, {
    token: resolved.config.token,
    appId: resolved.config.appId,
    encodingAESKey: resolved.config.encodingAESKey,
    tenantId: resolved.config.tenantId,
    accountId: resolved.config.accountId,
    inboxStore,
  });
  await safeWriteAudit(env, {
    action: response.status < 400 ? 'webhook.accepted' : 'webhook.rejected',
    tenantId: resolved.config.tenantId,
    accountId: resolved.config.accountId,
    targetType: 'wechat_webhook',
    targetId: resolved.config.accountId ?? routeAccountId,
    requestId: request.headers.get('cf-ray') ?? crypto.randomUUID(),
    metadata: {
      path: url.pathname,
      method: request.method,
      status: response.status,
      source: resolved.config.source,
      encrypted: url.searchParams.get('encrypt_type') === 'aes',
    },
  });
  return response;
}

type WebhookConfigResolution =
  | { kind: 'configured'; config: ResolvedWebhookConfig }
  | { kind: 'ambiguous' }
  | { kind: 'missing' };

type ResolvedWebhookConfig = {
  tenantId?: string | null;
  accountId?: string | null;
  appId: string | null;
  token: string | null;
  encodingAESKey?: string | null;
  source: 'account' | 'legacy';
};

function isWechatCallbackPath(pathname: string): boolean {
  return pathname === '/wx/callback' || pathname.startsWith('/wx/callback/');
}

export function getWechatCallbackAccountId(pathname: string): string | null {
  const prefix = '/wx/callback/';
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const accountId = decodeURIComponent(pathname.slice(prefix.length)).trim();
  if (!accountId || accountId.includes('/')) {
    return null;
  }
  return accountId;
}

async function resolveLegacyWebhookConfig(env: WorkerEnv): Promise<WebhookConfigResolution> {
  const explicitDefaultAccountId = await resolveSecret(env.WECHAT_DEFAULT_WEBHOOK_ACCOUNT_ID);
  if (explicitDefaultAccountId) {
    const explicit = await resolveAccountWebhookConfig(env, explicitDefaultAccountId);
    return explicit.kind === 'configured' ? explicit : { kind: 'missing' };
  }

  const accounts = await listActiveWebhookAccounts(env, 20);
  if (accounts && accounts.length > 1) {
    return { kind: 'ambiguous' };
  }
  if (accounts && accounts.length === 1) {
    return { kind: 'configured', config: await rowToWebhookConfig(accounts[0], env) };
  }

  const legacy = await resolveLegacySingleAccountConfig(env);
  return legacy ? { kind: 'configured', config: legacy } : { kind: 'missing' };
}

async function resolveAccountWebhookConfig(
  env: WorkerEnv,
  accountId: string,
): Promise<WebhookConfigResolution> {
  const row = await readWebhookAccountRow(env, accountId);
  if (!row || !isWebhookAccountEnabled(row)) {
    return { kind: 'missing' };
  }

  return { kind: 'configured', config: await rowToWebhookConfig(row, env) };
}

async function readWebhookAccountRow(
  env: WorkerEnv,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await env.DB.prepare('SELECT * FROM wechat_accounts WHERE id = ? LIMIT 1')
      .bind(accountId)
      .first<Record<string, unknown>>();
  } catch (error) {
    if (isMissingTenantTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function listActiveWebhookAccounts(
  env: WorkerEnv,
  limit: number,
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const result = await env.DB.prepare('SELECT * FROM wechat_accounts LIMIT ?')
      .bind(limit)
      .all<Record<string, unknown>>();
    return (result.results ?? []).filter(isWebhookAccountEnabled).slice(0, limit);
  } catch (error) {
    if (isMissingTenantTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function rowToWebhookConfig(
  row: Record<string, unknown>,
  env: WorkerEnv,
): Promise<ResolvedWebhookConfig> {
  return {
    tenantId: getString(row.tenant_id ?? row.tenantId),
    accountId: getString(row.id ?? row.account_id ?? row.accountId),
    appId: getString(row.app_id ?? row.appId),
    token: await decryptStoredSecret(getString(row.webhook_token ?? row.token), env),
    encodingAESKey: await decryptStoredSecret(getString(row.encoding_aes_key ?? row.encodingAESKey), env),
    source: 'account',
  };
}

async function resolveLegacySingleAccountConfig(env: WorkerEnv): Promise<ResolvedWebhookConfig | null> {
  const storage = await createD1Storage(env);
  const config = await storage.getConfig();
  const token = config?.token ?? await resolveSecret(env.WECHAT_WEBHOOK_TOKEN);
  const appId = config?.appId ?? await resolveSecret(env.WECHAT_APP_ID);
  const encodingAESKey = config?.encodingAESKey ?? await resolveSecret(env.WECHAT_ENCODING_AES_KEY);

  if (!token && !appId && !encodingAESKey) {
    return null;
  }

  return {
    token,
    appId,
    encodingAESKey,
    source: 'legacy',
  };
}

function isWebhookAccountEnabled(row: Record<string, unknown>): boolean {
  const status = getString(row.status)?.toLowerCase();
  return !status || ['active', 'enabled', 'configured'].includes(status);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function decryptStoredSecret(value: string | null, env: WorkerEnv): Promise<string | null> {
  if (!value || !value.startsWith('enc:')) {
    return value;
  }
  const secretKey = await resolveSecret(env.WECHAT_MCP_SECRET_KEY);
  if (!secretKey) {
    return null;
  }
  try {
    const bytes = CryptoJS.AES.decrypt(value.slice(4), secretKey);
    const text = bytes.toString(CryptoJS.enc.Utf8);
    return text || null;
  } catch {
    return null;
  }
}

function isMissingTenantTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|no such column|D1_ERROR/i.test(message) && /wechat_accounts|tenant|account/i.test(message);
}

async function safeWriteAudit(env: WorkerEnv, event: Parameters<D1AuditLogWriter['write']>[0]): Promise<void> {
  try {
    await new D1AuditLogWriter(env.DB).write(event);
  } catch {
    // Webhook ack/reject semantics must not depend on best-effort audit persistence.
  }
}

async function writeRequiredAudit(env: WorkerEnv, event: Parameters<D1AuditLogWriter['write']>[0]): Promise<void> {
  await new D1AuditLogWriter(env.DB).write(event);
}

export class WechatMcpAgent extends McpAgent<WorkerEnv, { initializedAt: number }, McpAuthorizationProps> {
  server = new McpServer({
    name: 'wechat-official-account-mcp',
    version: '2.0.0',
  });

  initialState = {
    initializedAt: Date.now(),
  };

  async init(): Promise<void> {
    const env = getAgentEnv(this);
    const usageStore = new D1UsageQuotaStore(env.DB);
    await usageStore.ensureSchema();
    const onboardingStore = await createSaasOnboardingStore(env);
    const authorizedScopes = normalizeOAuthScopes(this.props?.scopes);
    const resolveMcpTenantContext = async (): Promise<TenantRequestContext> => {
      return await resolveTrustedTenantContext(env, new Request('https://worker.internal/mcp'), {
        userId: this.props?.userId,
        oauthClientId: this.props?.oauthClientId,
        scopes: authorizedScopes,
      }, onboardingStore, 'mcp');
    };
    const auditLog = new D1AuditLogWriter(env.DB);
    const managementTools = createTenantManagementMcpTools({
      onboardingStore,
      usageStore,
      auditLog,
      validateWechatCredentials: async config => await validateWechatCredentialsForAccount(env, config),
      persistValidatedWechatCredentials: async input => await persistValidatedWechatCredentialsForAccount(
        env,
        onboardingStore,
        {
          ...input,
          audit: {
            userId: this.props?.userId,
            oauthClientId: this.props?.oauthClientId,
            successAction: 'account.credentials_configured',
          },
        },
      ),
      deleteWechatResource: async ({ account, confirmation }) => await softDeleteWechatResourceForAccount(
        env,
        onboardingStore,
        {
          account,
          confirmation,
          userId: this.props?.userId,
          oauthClientId: this.props?.oauthClientId,
        },
      ),
    });
    const mediaTools = createWorkerMediaTools({
      mediaBucket: env.MEDIA,
    }).map(withOptionalAccountId);

    const sharedTools = WORKER_SHARED_MCP_TOOLS.filter(tool => !tool.name.startsWith('woa_'));
    for (const tool of [...sharedTools, ...managementTools, ...mediaTools]) {
      registerWorkerMcpTool(
        this.server,
        tool,
        async account => (await createWorkerToolContext(env, toStorageAccountContext(account))).apiClient,
        resolveMcpTenantContext,
        usageStore,
        auditLog,
        onboardingStore,
      );
    }
  }

  protected getEventStore(): any {
    return new DurableObjectEventStore((this as any).ctx.storage);
  }

  async runEventStoreSelfTest(): Promise<Record<string, unknown>> {
    const eventStore = this.getEventStore();
    const streamId = 'wechat_mass_send_polling_stream';
    await eventStore.clearStream(streamId);

    const firstEventId = await eventStore.storeEvent(streamId, {
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: {
        tool: 'wechat_mass_send',
        phase: 'polling',
        step: 1,
      },
    } as any);
    const secondEventId = await eventStore.storeEvent(streamId, {
      jsonrpc: '2.0',
      id: 'wechat_mass_send:self-test',
      result: {
        status: 'done',
      },
    } as any);

    const replayed: Array<{ eventId: string; message: unknown }> = [];
    const resumedStreamId = await eventStore.replayEventsAfter(firstEventId, {
      send: async (eventId: string, message: unknown) => {
        replayed.push({ eventId, message });
      },
    });

    await eventStore.clearStream(streamId);

    return {
      configured: true,
      eventStore: 'DurableObjectEventStore',
      streamId,
      resumedStreamId,
      lastEventId: firstEventId,
      replayedIds: replayed.map(event => event.eventId),
      replayedCount: replayed.length,
      lastEventIdReplay: resumedStreamId === streamId && replayed.some(event => event.eventId === secondEventId),
    };
  }
}

export class TokenOwner extends Agent<WorkerEnv> {
  private refreshPromise: Promise<AccessTokenInfo> | null = null;
  private tokenTableReady = false;
  private tokenGeneration = 0;

  async getAccessToken(options: TokenOwnerRequestOptions = {}): Promise<AccessTokenInfo> {
    await this.ensureTokenTables();
    const accountContext = await this.resolveAccountContext(options.accountContext);
    return await this.getAccessTokenWithRefresh(
      { ...options, accountContext },
      () => this.refreshAndPersist(accountContext),
    );
  }

  async refreshAccessToken(options: TokenOwnerRequestOptions = {}): Promise<AccessTokenInfo> {
    return await this.getAccessToken({ ...options, forceRefresh: true });
  }

  async clearAccessToken(options: { accountContext?: AccountContext } = {}): Promise<void> {
    await this.ensureTokenTables();
    const accountContext = await this.resolveAccountContext(options.accountContext);
    this.tokenGeneration += 1;
    this.refreshPromise = null;
    void this.sql`DELETE FROM wechat_access_token`;
    const storage = await createD1Storage(getAgentEnv(this));
    await storage.clearAccountAccessToken(accountContext);
  }

  async replaceAccessToken(
    tokenInfo: AccessTokenInfo,
    options: { accountContext?: AccountContext } = {},
  ): Promise<void> {
    await this.ensureTokenTables();
    const accountContext = await this.resolveAccountContext(options.accountContext);
    this.tokenGeneration += 1;
    this.refreshPromise = null;
    await this.writeStoredToken(tokenInfo);
    const storage = await createD1Storage(getAgentEnv(this));
    await storage.saveAccountAccessToken(accountContext, tokenInfo);
    await this.schedulePreExpiryRefresh(tokenInfo, accountContext);
  }

  async acquireCredentialConfigurationLease(input: { leaseId: string; ttlMs?: number }): Promise<boolean> {
    await this.ensureTokenTables();
    const now = Date.now();
    const ttlMs = Math.min(10 * 60_000, Math.max(30_000, input.ttlMs ?? 5 * 60_000));
    void this.sql`DELETE FROM credential_configuration_lease WHERE expires_at <= ${now}`;
    const current = this.sql<{ lease_id: string }>`
      SELECT lease_id FROM credential_configuration_lease WHERE id = 1 LIMIT 1
    `[0];
    if (current && current.lease_id !== input.leaseId) return false;
    void this.sql`
      INSERT INTO credential_configuration_lease (id, lease_id, expires_at)
      VALUES (1, ${input.leaseId}, ${now + ttlMs})
      ON CONFLICT(id) DO UPDATE SET
        lease_id = excluded.lease_id,
        expires_at = excluded.expires_at
      WHERE credential_configuration_lease.lease_id = excluded.lease_id
    `;
    return true;
  }

  async releaseCredentialConfigurationLease(input: { leaseId: string }): Promise<void> {
    await this.ensureTokenTables();
    void this.sql`
      DELETE FROM credential_configuration_lease
      WHERE id = 1 AND lease_id = ${input.leaseId}
    `;
  }

  async getDebugStatus(): Promise<Record<string, unknown>> {
    await this.ensureTokenTables();
    const token = await this.readStoredToken();
    const metrics = this.readMetrics();
    return {
      hasToken: !!token,
      expiresAt: token?.expiresAt ?? null,
      expiresInMs: token ? Math.max(0, token.expiresAt - Date.now()) : null,
      refreshAttempts: metrics.refreshAttempts,
      refreshSuccesses: metrics.refreshSuccesses,
      coalescedRefreshes: metrics.coalescedRefreshes,
      lastRefreshAt: metrics.lastRefreshAt,
    };
  }

  async runCoalescingSelfTest(): Promise<Record<string, unknown>> {
    await this.ensureTokenTables();

    const previousRefreshPromise = this.refreshPromise;
    this.refreshPromise = null;

    let refreshCalls = 0;
    const fakeRefresh = async (): Promise<AccessTokenInfo> => {
      refreshCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        accessToken: `self-test-token-${Date.now()}`,
        expiresIn: 7200,
        expiresAt: Date.now() + 7200 * 1000,
      };
    };

    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => this.getAccessTokenWithRefresh({ forceRefresh: true }, fakeRefresh)),
      );
      const uniqueTokens = new Set(results.map(result => result.accessToken));

      return {
        requestCount: results.length,
        refreshCalls,
        uniqueTokenCount: uniqueTokens.size,
        singleWriter: refreshCalls === 1 && uniqueTokens.size === 1,
        tokenOwnerName: tokenOwnerNameForAccount(defaultAccountContext()),
      };
    } finally {
      this.refreshPromise = previousRefreshPromise;
    }
  }

  async runCredentialLeaseSelfTest(): Promise<Record<string, unknown>> {
    const firstLeaseId = `credential-lease-a-${Date.now()}`;
    const secondLeaseId = `credential-lease-b-${Date.now()}`;
    const first = await this.acquireCredentialConfigurationLease({ leaseId: firstLeaseId });
    const concurrent = await this.acquireCredentialConfigurationLease({ leaseId: secondLeaseId });
    await this.releaseCredentialConfigurationLease({ leaseId: secondLeaseId });
    const stillHeld = !(await this.acquireCredentialConfigurationLease({ leaseId: secondLeaseId }));
    await this.releaseCredentialConfigurationLease({ leaseId: firstLeaseId });
    const afterRelease = await this.acquireCredentialConfigurationLease({ leaseId: secondLeaseId });
    await this.releaseCredentialConfigurationLease({ leaseId: secondLeaseId });
    return {
      first,
      concurrentRejected: concurrent === false,
      wrongOwnerReleaseRejected: stillHeld,
      afterRelease,
      singleWriter: first && concurrent === false && stillHeld && afterRelease,
    };
  }

  async refreshBeforeExpiry(payload?: { expiresAt?: number; accountContext?: AccountContext }): Promise<void> {
    await this.ensureTokenTables();
    const accountContext = await this.resolveAccountContext(payload?.accountContext);
    const current = await this.readStoredToken();

    if (payload?.expiresAt && current && current.expiresAt !== payload.expiresAt) {
      return;
    }

    if (this.isUsable(current)) {
      await this.schedulePreExpiryRefresh(current, accountContext);
      return;
    }

    await this.getAccessToken({ forceRefresh: true, accountContext });
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/status')) {
      return json(await this.getDebugStatus());
    }

    return json(
      {
        success: false,
        error: 'TokenOwner accepts Durable Object RPC calls; HTTP surface is debug/status only.',
      },
      { status: 404 },
    );
  }

  private async refreshAndPersist(accountContext: AccountContext): Promise<AccessTokenInfo> {
    await this.incrementMetric('refreshAttempts');
    const generation = this.tokenGeneration;

    const config = await this.resolveWechatConfig(accountContext);
    const env = getAgentEnv(this);
    const executor = await createWechatWorkersHttpExecutor(env);
    const response = await executor.get<{
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    }>('/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid: config.appId,
        secret: config.appSecret,
      },
    });
    const result = response.data;

    if (result.errcode || !result.access_token || !result.expires_in) {
      throw new Error(
        `Failed to refresh WeChat access token: ${result.errmsg ?? 'invalid response'} (${result.errcode ?? response.status})`,
      );
    }

    const tokenInfo: AccessTokenInfo = {
      accessToken: result.access_token,
      expiresIn: result.expires_in,
      expiresAt: Date.now() + result.expires_in * 1000,
    };

    if (generation !== this.tokenGeneration) {
      throw new Error('Discarded a stale WeChat token refresh after account credentials changed.');
    }

    await this.writeStoredToken(tokenInfo);

    const storage = await createD1Storage(env);
    await storage.saveAccountAccessToken(accountContext, tokenInfo);
    await this.incrementMetric('refreshSuccesses');
    await this.setMetric('lastRefreshAt', Date.now());
    await this.schedulePreExpiryRefresh(tokenInfo, accountContext);

    return tokenInfo;
  }

  private async getAccessTokenWithRefresh(
    options: TokenOwnerRequestOptions,
    refresher: () => Promise<AccessTokenInfo>,
  ): Promise<AccessTokenInfo> {
    const current = await this.readStoredToken();
    if (!options.forceRefresh && this.isUsable(current)) {
      await this.schedulePreExpiryRefresh(current, options.accountContext);
      return current;
    }

    if (this.refreshPromise) {
      await this.incrementMetric('coalescedRefreshes');
      return await this.refreshPromise;
    }

    this.refreshPromise = refresher();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async resolveAccountContext(accountContext?: AccountContext): Promise<AccountContext> {
    if (accountContext) return accountContext;

    const storage = await createD1Storage(getAgentEnv(this));
    return (await storage.getDefaultAccountContext()) ?? defaultAccountContext();
  }

  private async resolveWechatConfig(accountContext: AccountContext): Promise<WechatConfig> {
    const storage = await createD1Storage(getAgentEnv(this));
    const stored = await storage.getAccountConfig(accountContext);
    if (stored?.appId && stored?.appSecret) {
      return stored;
    }

    if (!canUseLegacyGlobalWechatSecrets(accountContext)) {
      throw new Error(
        `Wechat config not found for account ${accountContext.accountId}. Configure this account before calling WeChat tools.`,
      );
    }

    const env = getAgentEnv(this);
    const appId = await resolveSecret(env.WECHAT_APP_ID);
    const appSecret = await resolveSecret(env.WECHAT_APP_SECRET);

    if (!appId || !appSecret) {
      throw new Error('Wechat config not found. Configure an account in D1 or WECHAT_APP_ID/WECHAT_APP_SECRET secrets first.');
    }

    return { appId, appSecret };
  }

  private async ensureTokenTables(): Promise<void> {
    if (this.tokenTableReady) return;

    void this.sql`
      CREATE TABLE IF NOT EXISTS wechat_access_token (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_token TEXT NOT NULL,
        expires_in INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    void this.sql`
      CREATE TABLE IF NOT EXISTS token_owner_metrics (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `;
    void this.sql`
      CREATE TABLE IF NOT EXISTS credential_configuration_lease (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lease_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `;
    this.tokenTableReady = true;
  }

  private async readStoredToken(): Promise<AccessTokenInfo | null> {
    const rows = this.sql<{
      access_token: string;
      expires_in: number;
      expires_at: number;
    }>`SELECT access_token, expires_in, expires_at FROM wechat_access_token WHERE id = 1 LIMIT 1`;

    const row = rows[0];
    if (!row) return null;

    return {
      accessToken: await this.decryptValue(row.access_token) ?? row.access_token,
      expiresIn: row.expires_in,
      expiresAt: row.expires_at,
    };
  }

  private async writeStoredToken(tokenInfo: AccessTokenInfo): Promise<void> {
    void this.sql`DELETE FROM wechat_access_token`;
    void this.sql`
      INSERT INTO wechat_access_token (id, access_token, expires_in, expires_at, updated_at)
      VALUES (1, ${await this.encryptValue(tokenInfo.accessToken)}, ${tokenInfo.expiresIn}, ${tokenInfo.expiresAt}, ${Date.now()})
    `;
  }

  private isUsable(token: AccessTokenInfo | null): token is AccessTokenInfo {
    return !!token && token.expiresAt > Date.now() + REFRESH_BEFORE_EXPIRY_MS;
  }

  private async schedulePreExpiryRefresh(tokenInfo: AccessTokenInfo, accountContext?: AccountContext): Promise<void> {
    const refreshAt = tokenInfo.expiresAt - REFRESH_BEFORE_EXPIRY_MS;
    const delaySeconds = Math.max(1, Math.floor((refreshAt - Date.now()) / 1000));

    await this.schedule(
      delaySeconds,
      'refreshBeforeExpiry',
      { expiresAt: tokenInfo.expiresAt, accountContext },
      { idempotent: true },
    );
  }

  private readMetrics(): {
    refreshAttempts: number;
    refreshSuccesses: number;
    coalescedRefreshes: number;
    lastRefreshAt: number | null;
  } {
    const rows = this.sql<{ name: string; value: number }>`SELECT name, value FROM token_owner_metrics`;
    const values = Object.fromEntries(rows.map(row => [row.name, row.value]));

    return {
      refreshAttempts: values.refreshAttempts ?? 0,
      refreshSuccesses: values.refreshSuccesses ?? 0,
      coalescedRefreshes: values.coalescedRefreshes ?? 0,
      lastRefreshAt: values.lastRefreshAt ?? null,
    };
  }

  private async incrementMetric(name: string): Promise<void> {
    void this.sql`
      INSERT INTO token_owner_metrics (name, value)
      VALUES (${name}, 1)
      ON CONFLICT(name) DO UPDATE SET value = value + 1
    `;
  }

  private async setMetric(name: string, value: number): Promise<void> {
    void this.sql`
      INSERT INTO token_owner_metrics (name, value)
      VALUES (${name}, ${value})
      ON CONFLICT(name) DO UPDATE SET value = excluded.value
    `;
  }

  private async encryptValue(value: string): Promise<string> {
    const secretKey = await resolveSecret(getAgentEnv(this).WECHAT_MCP_SECRET_KEY);
    if (!secretKey) return value;
    return `enc:${CryptoJS.AES.encrypt(value, secretKey).toString()}`;
  }

  private async decryptValue(value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    if (!value.startsWith('enc:')) return value;
    const secretKey = await resolveSecret(getAgentEnv(this).WECHAT_MCP_SECRET_KEY);
    if (!secretKey) return null;
    const cipher = value.slice(4);
    try {
      const bytes = CryptoJS.AES.decrypt(cipher, secretKey);
      const text = bytes.toString(CryptoJS.enc.Utf8);
      return text || null;
    } catch {
      return null;
    }
  }
}

const mcpHandler = WechatMcpAgent.serve('/mcp', {
  binding: 'WECHAT_MCP_AGENT',
});

const managementApiHandler = {
  async fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    const usageStore = new D1UsageQuotaStore(env.DB);
    const props = oauthPropsFromContext(ctx);
    const onboardingStore = await createSaasOnboardingStore(env);
    const trustedContext = await resolveTrustedTenantContext(env, request, props, onboardingStore, 'rest');

    if (url.pathname.includes('/billing/checkout') && !trustedContext.scopes.includes('woa:billing:write')) {
      return json({
        success: false,
        error: {
          code: 'missing_scope',
          message: 'Missing required OAuth scope: woa:billing:write',
          requestId: trustedContext.requestId,
        },
      }, { status: 403 });
    }

    return await handleManagementApiRequest(request, {
      appId: await resolveSecret(env.WECHAT_APP_ID),
      defaultUserId: await resolveSecret(env.OAUTH_CLIENT_ID),
      defaultClientId: await resolveSecret(env.OAUTH_CLIENT_ID),
      usageStore,
      billing: await createStripeBillingServiceForEnv(env, usageStore, onboardingStore),
      mediaBucket: env.MEDIA,
      onboardingStore,
      auditLog: new D1AuditLogWriter(env.DB),
      agentInit: createAgentInitDeps(env),
      ...createOAuthGrantManagementDeps(env),
      validateWechatCredentials: async config => await validateWechatCredentialsForAccount(env, config),
      persistValidatedWechatCredentials: async input => await persistValidatedWechatCredentialsForAccount(
        env,
        onboardingStore,
        {
          ...input,
          audit: {
            userId: trustedContext.userId,
            oauthClientId: trustedContext.oauthClientId,
            successAction: 'account.credentials_configured',
          },
        },
      ),
      deleteWechatResource: async ({ account, confirmation }) => await softDeleteWechatResourceForAccount(
        env,
        onboardingStore,
        {
          account,
          confirmation,
          userId: trustedContext.userId,
          oauthClientId: trustedContext.oauthClientId,
        },
      ),
      trustedContext,
      createApiClient: async account => (await createWorkerToolContext(
        env,
        account ? toStorageAccountContext(account) : undefined,
      )).apiClient,
    });
  },
};

const defaultHandler = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (isLegacyRestToolPath(url.pathname)) {
      return legacyRestToolRemovedResponse();
    }

    const removedTransportResponse = removedMcpTransportResponseForRequest(request);
    if (removedTransportResponse) return removedTransportResponse;

    if (url.pathname === '/init/credentials') {
      const onboardingStore = await createSaasOnboardingStore(env);
      const sessionToken = getSessionCookie(request);
      const session = sessionToken ? await onboardingStore.getWebSession(sessionToken) : null;
      const agentInit = createAgentInitDeps(env);
      return await handleCredentialHandoffRequest(request, {
        ...agentInit,
        operatorId: session?.operatorId,
        assertAuthority: async handoff => {
          await assertCredentialHandoffAuthority(
            env,
            onboardingStore,
            agentInit.store,
            session?.operatorId ?? '',
            handoff,
          );
        },
        validatePersistAndComplete: async ({ handoff, config, complete }) => {
          const tokenInfo = await validateWechatCredentialsForAccount(env, config);

          // The WeChat probe is a network boundary. Re-check the membership,
          // account lock, and initiating OAuth grant immediately before persist
          // so an administrator can revoke authority while the probe is pending.
          const account = await assertCredentialHandoffAuthority(
            env,
            onboardingStore,
            agentInit.store,
            session?.operatorId ?? '',
            handoff,
          );
          await persistValidatedWechatCredentialsForAccount(env, onboardingStore, {
            config,
            account,
            tokenInfo,
            finalize: complete,
            audit: {
              userId: session?.operatorId,
              successAction: 'account.credentials_configured_via_handoff',
              metadata: { handoffId: handoff.handoffId, relayProbe: true },
            },
          });
          return tokenInfo;
        },
      });
    }

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        success: true,
        runtime: 'cloudflare-workers',
        mcpEndpoint: '/mcp',
        webhookEndpoint: '/wx/callback/{accountId}',
        legacyWebhookEndpoint: '/wx/callback',
      });
    }

    if (url.pathname === '/authorize') {
      return await handleAuthorize(request, env);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

function oauthPropsFromContext(ctx: unknown): { userId?: string; oauthClientId?: string; scopes: string[] } {
  const props = (ctx as unknown as { props?: Record<string, unknown> }).props ?? {};
  const scopes = Array.isArray(props.scopes)
    ? props.scopes.filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0)
    : typeof props.scopes === 'string'
      ? props.scopes.split(/[\s,]+/).filter(Boolean)
      : [];
  return {
    userId: typeof props.userId === 'string' ? props.userId : undefined,
    oauthClientId: typeof props.oauthClientId === 'string' ? props.oauthClientId : undefined,
    scopes,
  };
}

function normalizeOAuthScopes(scopes: string[] | string | null | undefined): string[] {
  if (Array.isArray(scopes)) {
    return scopes.map(scope => scope.trim()).filter(Boolean);
  }
  if (typeof scopes !== 'string') return [];
  return scopes.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean);
}

async function handleAuthorize(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const provider = env.OAUTH_PROVIDER;

  if (!provider) {
    return new Response('OAuth provider binding is not available.', { status: 500 });
  }

  const oauthRequest = await provider.parseAuthRequest(request);
  const requestedScopes = normalizeRequestedOAuthScopes(oauthRequest.scope);
  const unsupportedScopes = unsupportedOAuthScopes(requestedScopes);
  if (unsupportedScopes.length > 0) {
    return json({
      error: 'invalid_scope',
      error_description: `Unsupported OAuth scopes: ${unsupportedScopes.join(' ')}`,
    }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, POST' },
    });
  }

  const store = await createSaasOnboardingStore(env);
  const sessionToken = getSessionCookie(request);
  const session = sessionToken ? await store.getWebSession(sessionToken) : null;
  if (!session) {
    const returnTo = `${url.pathname}${url.search}`;
    return Response.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, request.url).toString(), 302);
  }

  await store.bootstrapDefaultTenantForOperator({ operatorId: session.operatorId });
  const authorizationContext = await store.getTenantContextForOperator(session.operatorId, { source: 'rest' });
  const membershipAllowedScopes = new Set(scopesAllowedByAnyMembership(authorizationContext));
  const membershipDeniedScopes = requestedScopes.filter(scope => !membershipAllowedScopes.has(scope));
  if (membershipDeniedScopes.length > 0) {
    return json({
      error: 'invalid_scope',
      error_description: `Current tenant memberships do not allow scopes: ${membershipDeniedScopes.join(' ')}`,
    }, {
      status: 403,
      headers: { 'cache-control': 'no-store' },
    });
  }
  await store.registerOAuthClient({
    clientId: oauthRequest.clientId,
    clientName: oauthRequest.clientId || 'OAuth client',
    redirectUris: [oauthRequest.redirectUri],
    scopes: requestedScopes,
  });

  const hasConsent = await store.hasOAuthConsent({
    operatorId: session.operatorId,
    clientId: oauthRequest.clientId,
    scopes: requestedScopes,
  });

  if (request.method === 'GET' && !hasConsent) {
    return renderAuthorizationConsentForm({
      query: url.searchParams.toString(),
      clientId: oauthRequest.clientId,
      scopes: requestedScopes,
    });
  }

  if (request.method === 'POST') {
    const formData = await request.formData();
    if (String(formData.get('consent') ?? '') !== 'approve') {
      return renderAuthorizationConsentForm({
        query: url.searchParams.toString(),
        clientId: oauthRequest.clientId,
        scopes: requestedScopes,
        error: '请确认授权后继续。',
      });
    }
    await store.rememberOAuthConsent({
      operatorId: session.operatorId,
      clientId: oauthRequest.clientId,
      scopes: requestedScopes,
    });
  }

  const { redirectTo } = await provider.completeAuthorization({
    request: oauthRequest,
    userId: session.operatorId,
    scope: requestedScopes,
    props: {
      userId: session.operatorId,
      oauthClientId: oauthRequest.clientId,
      scopes: requestedScopes,
    },
    metadata: {
      mcpServer: 'wechat-official-account-mcp',
    },
  });

  return Response.redirect(redirectTo, 302);
}

function createOAuthProvider(): OAuthProvider<WorkerEnv> {
  return new OAuthProvider<WorkerEnv>({
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    apiHandlers: {
      '/mcp': mcpHandler,
      '/api/v1': managementApiHandler,
    },
    defaultHandler,
    accessTokenTTL: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    clientRegistrationTTL: OAUTH_DYNAMIC_CLIENT_TTL_SECONDS,
    scopesSupported: [...OAUTH_SUPPORTED_SCOPES],
    resourceMetadata: {
      scopes_supported: [...OAUTH_SUPPORTED_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'WeChat Official Account MCP',
    },
    tokenExchangeCallback: ({ props, requestedScope }) => ({
      accessTokenProps: {
        ...(props && typeof props === 'object' ? props : {}),
        scopes: [...requestedScope],
      },
      accessTokenScope: [...requestedScope],
    }),
    allowPlainPKCE: false,
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    if (isLegacyRestToolPath(url.pathname)) {
      return legacyRestToolRemovedResponse();
    }

    const removedTransportResponse = removedMcpTransportResponseForRequest(request);
    if (removedTransportResponse) return removedTransportResponse;

    if (
      url.pathname === '/api/v1/auth/email-code/request' ||
      url.pathname === '/api/v1/auth/email-code/verify' ||
      url.pathname === '/api/v1/auth/logout' ||
      url.pathname === '/auth/github/callback'
    ) {
      return await handlePublicAuthRequest(request, env);
    }

    if (isStripeWebhookPath(url.pathname)) {
      const onboardingStore = await createSaasOnboardingStore(env);
      const usageStore = new D1UsageQuotaStore(env.DB);
      const stripeSecretKey = await resolveSecret(env.STRIPE_SECRET_KEY);
      try {
        const response = await handleStripeWebhookRequest(request, {
          webhookSecret: await resolveSecret(env.STRIPE_WEBHOOK_SECRET),
          usageStore,
          priceIds: await resolveStripePriceIds(env),
          resolveSubscription: stripeSecretKey
            ? createStripeSubscriptionResolver(stripeSecretKey)
            : undefined,
          reconcileAccountLocks: async (tenantId, _plan, stripeEventId) => {
            const current = await usageStore.getEntitlement(tenantId);
            if (current.lastStripeEventId !== stripeEventId) return;
            await onboardingStore.reconcileAccountAllowanceLocks({
              tenantId,
              plan: current.plan,
              expectedStripeEventId: stripeEventId,
            });
          },
        });
        const result = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) {
          await onboardingStore.recordMonitoringEvent({
            eventType: 'stripe.webhook_failed',
            severity: 'error',
            metadata: { status: response.status, result },
          });
        } else if (result.handled === true && typeof result.tenantId === 'string') {
          await safeWriteAudit(env, {
            tenantId: result.tenantId,
            action: 'billing.subscription_updated',
            targetType: 'stripe_subscription',
            targetId: typeof result.stripeSubscriptionId === 'string' ? result.stripeSubscriptionId : null,
            metadata: {
              eventType: result.type,
              plan: result.plan,
              status: result.status,
              pendingPlan: result.pendingPlan,
              pendingPlanEffectiveAt: result.pendingPlanEffectiveAt,
            },
          });
        }
        return response;
      } catch (error) {
        await onboardingStore.recordMonitoringEvent({
          eventType: 'stripe.webhook_failed',
          severity: 'error',
          metadata: { message: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
    }

    if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
      const webSessionResponse = await handleWebSessionManagementApiRequest(request, env);
      if (webSessionResponse) return webSessionResponse;
    }

    if (
      url.pathname === '/health' ||
      url.pathname === '/api/health' ||
      isWechatCallbackPath(url.pathname)
    ) {
      if (isWechatCallbackPath(url.pathname)) {
        return await handleWechatCallbackRequest(request, env);
      }
      return await defaultHandler.fetch(request, env);
    }

    if (url.pathname === '/__debug/token-owner/coalescing' && isLocalhost(url.hostname)) {
      const tokenOwner = await getTokenOwner(env);
      return json(await tokenOwner.runCoalescingSelfTest());
    }

    if (url.pathname === '/api/__debug/token-owner/credential-lease' && !isProductionEnv(env)) {
      const tokenOwner = await getTokenOwner(env);
      return json(await tokenOwner.runCredentialLeaseSelfTest());
    }

    if (url.pathname === '/__debug/mcp-event-store/replay' && isLocalhost(url.hostname)) {
      const agent = await getDebugMcpAgent(env);
      return json(await agent.runEventStoreSelfTest());
    }

    return await createOAuthProvider().fetch(request, env, ctx as any);
  },
  async scheduled(_controller: unknown, env: WorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const result = await runRetentionMaintenance({
          db: env.DB,
          mediaBucket: env.MEDIA,
          stripeSecretKey: await resolveSecret(env.STRIPE_SECRET_KEY),
        });
        logger.info('SaaS retention maintenance completed', result);
        if (result.r2ObjectsFailed > 0) {
          const store = await createSaasOnboardingStore(env);
          await store.recordMonitoringEvent({
            eventType: 'maintenance.r2_cleanup_partial_failure',
            severity: 'warning',
            metadata: { ...result },
          });
        }
      } catch (error) {
        logger.error('SaaS retention maintenance failed', error);
        const store = await createSaasOnboardingStore(env);
        await store.recordMonitoringEvent({
          eventType: 'maintenance.failed',
          severity: 'error',
          metadata: { message: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
    })());
  },
};

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
