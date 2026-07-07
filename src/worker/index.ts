import { Agent, getAgentByName } from 'agents';
import { DurableObjectEventStore, McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  OAuthProvider,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import CryptoJS from 'crypto-js';
import type { AccessTokenInfo, WechatConfig } from '../mcp-tool/types.js';
import type { McpTool } from '../mcp-tool/types.js';
import { workerSharedMcpTools, withOptionalAccountId } from '../mcp-tool/tools/index.js';
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
import { handleWechatWebhook } from './wechat-webhook.js';
import { D1AuditLogWriter } from './audit-log.js';
import { handleManagementApiRequest } from './management-api.js';
import { executeMcpToolWithQuota } from './mcp-quota.js';
import {
  createStripeCheckoutService,
  handleStripeWebhookRequest,
  type StripeBillingService,
  type StripePriceIds,
} from './stripe-billing.js';
import {
  createDefaultTenantContext,
  type TenantRequestContext,
} from './tenant-context.js';
import { D1UsageQuotaStore } from './usage-store.js';
import { D1SaasOnboardingStore } from './saas-onboarding-store.js';
import { removedMcpTransportResponseForRequest } from './transport-guards.js';
import {
  createGitHubAuthorizeUrl,
  exchangeGitHubOAuthCode,
  fetchGitHubOAuthProfile,
} from './github-oauth.js';

type SecretBinding = string | { get(): Promise<string | null> };
type DurableObjectNamespaceLike = unknown;
type KVNamespaceLike = unknown;
type AssetsBindingLike = { fetch(request: Request): Promise<Response> };

export interface WorkerEnv {
  WECHAT_MCP_AGENT: DurableObjectNamespaceLike;
  TOKEN_OWNER: DurableObjectNamespaceLike;
  DB: D1DatabaseLike;
  MEDIA: unknown;
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
}

type TokenOwnerRequestOptions = {
  forceRefresh?: boolean;
  accountContext?: AccountContext;
};

type TokenOwnerStub = {
  getAccessToken(options?: TokenOwnerRequestOptions): Promise<AccessTokenInfo>;
  refreshAccessToken(options?: TokenOwnerRequestOptions): Promise<AccessTokenInfo>;
  clearAccessToken(options?: { accountContext?: AccountContext }): Promise<void>;
  getDebugStatus(): Promise<Record<string, unknown>>;
  runCoalescingSelfTest(): Promise<Record<string, unknown>>;
};

type WechatMcpAgentStub = {
  runEventStoreSelfTest(): Promise<Record<string, unknown>>;
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
  return Response.redirect(new URL(redirectTo, request.url).toString(), init?.status && init.status >= 300 && init.status < 400 ? init.status : 303);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
        : Response.redirect(authorizeUrl, 302);
      response.headers.append('set-cookie', githubOAuthStateCookie(state, returnTo, request));
      return response;
    }

    const stateCookie = getGitHubOAuthStateCookie(request);
    const state = url.searchParams.get('state') ?? '';
    if (!stateCookie || !state || stateCookie.state !== state) {
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
    } catch {
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
    billing: await createStripeBillingServiceForEnv(env, usageStore),
    onboardingStore,
    validateWechatCredentials: async config => await validateWechatCredentialsForAccount(env, config),
    trustedContext,
    createApiClient: async () => (await createWorkerToolContext(env)).apiClient,
  });
}

async function verifyTurnstileIfConfigured(env: WorkerEnv, request: Request, token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const secret = await resolveSecret(env.TURNSTILE_SECRET_KEY);
  if (!secret) return { ok: true };
  if (!token) return { ok: false, message: '缺少 Turnstile 校验 token。' };

  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const result = await response.json() as { success?: boolean };
    return result.success ? { ok: true } : { ok: false, message: 'Turnstile 校验未通过。' };
  } catch {
    return { ok: false, message: 'Turnstile 校验服务暂不可用。' };
  }
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
    const reason = result.errmsg ?? 'invalid response';
    throw new Error(`WeChat credential validation failed: ${reason}. 请确认 AppID/AppSecret 正确，并已将平台 HTTPS relay 出口 IP 加入微信公众号 IP 白名单。`);
  }
  return {
    accessToken: result.access_token,
    expiresIn: result.expires_in,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
}

async function resolveTrustedTenantContext(
  env: WorkerEnv,
  request: Request,
  props: { userId?: string; oauthClientId?: string; scopes: string[] },
  store: D1SaasOnboardingStore,
  source: TenantRequestContext['source'],
): Promise<TenantRequestContext> {
  if (props.userId) {
    const stored = await store.getTenantContextForOperator({
      operatorId: props.userId,
      oauthClientId: props.oauthClientId,
      scopes: props.scopes,
      requestId: request.headers.get('x-request-id'),
    }, { source });
    if (stored.tenants.length > 0) {
      return stored;
    }
  }

  const storage = await createD1Storage(env);
  const accountContext = await storage.getDefaultAccountContext();
  return createDefaultTenantContext({
    source,
    userId: props.userId || await resolveSecret(env.OAUTH_CLIENT_ID) || 'wechat-admin',
    oauthClientId: props.oauthClientId || await resolveSecret(env.OAUTH_CLIENT_ID),
    scopes: props.scopes,
    requestId: request.headers.get('x-request-id'),
    appId: accountContext?.appId ?? await resolveSecret(env.WECHAT_APP_ID),
    tenantId: accountContext?.tenantId,
    tenantSlug: accountContext?.tenantSlug,
    tenantName: accountContext?.tenantName,
    accountId: accountContext?.accountId,
    accountSlug: accountContext?.accountSlug,
    accountName: accountContext?.accountName,
  });
}

function isStripeWebhookPath(pathname: string): boolean {
  return pathname === '/api/stripe/webhook';
}

function registerWorkerMcpTool(
  server: McpServer,
  tool: McpTool,
  apiClient: WechatApiClient,
  tenantContext: TenantRequestContext,
  usageStore: D1UsageQuotaStore,
): void {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema as any,
    async (params: unknown) => {
      try {
        return await executeMcpToolWithQuota({
          tool,
          apiClient,
          params,
          tenantContext,
          usageStore,
        }) as any;
      } catch (error) {
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

export class WechatMcpAgent extends McpAgent<WorkerEnv, { initializedAt: number }, { userId?: string }> {
  server = new McpServer({
    name: 'wechat-official-account-mcp',
    version: '2.0.0',
  });

  initialState = {
    initializedAt: Date.now(),
  };

  async init(): Promise<void> {
    const env = getAgentEnv(this);
    const { apiClient, storage, accountContext } = await createWorkerToolContext(env);
    const usageStore = new D1UsageQuotaStore(env.DB);
    await usageStore.ensureSchema();
    const onboardingStore = await createSaasOnboardingStore(env);
    const currentConfig = await apiClient.getAuthManager().getConfig();
    let tenantContext = await resolveTrustedTenantContext(env, new Request('https://worker.internal/mcp'), {
      userId: this.props?.userId ?? await resolveSecret(env.OAUTH_CLIENT_ID) ?? undefined,
      oauthClientId: await resolveSecret(env.OAUTH_CLIENT_ID) ?? undefined,
      scopes: ['wechat.mcp', 'woa:context:read', 'woa:tenant:read', 'woa:account:read', 'woa:account:write', 'woa:content:read', 'woa:content:write', 'woa:content:publish', 'woa:inbox:read', 'woa:usage:read', 'woa:audit:read'],
    }, onboardingStore, 'mcp');
    if (tenantContext.tenants.length === 0) {
      tenantContext = createDefaultTenantContext({
        source: 'mcp',
        userId: this.props?.userId ?? await resolveSecret(env.OAUTH_CLIENT_ID),
        oauthClientId: await resolveSecret(env.OAUTH_CLIENT_ID),
        scopes: ['wechat.mcp', 'woa:context:read', 'woa:tenant:read', 'woa:account:read', 'woa:account:write', 'woa:content:read', 'woa:content:write', 'woa:content:publish', 'woa:inbox:read', 'woa:usage:read', 'woa:audit:read'],
        appId: currentConfig?.appId ?? await resolveSecret(env.WECHAT_APP_ID),
        tenantId: accountContext.tenantId,
        tenantSlug: accountContext.tenantSlug,
        tenantName: accountContext.tenantName,
        accountId: accountContext.accountId,
        accountSlug: accountContext.accountSlug,
        accountName: accountContext.accountName,
      });
    }
    const mediaTools = createWorkerMediaTools({
      mediaBucket: env.MEDIA,
      saveMedia: media => storage.saveMedia(media),
    }).map(withOptionalAccountId);

    for (const tool of [...WORKER_SHARED_MCP_TOOLS, ...mediaTools]) {
      registerWorkerMcpTool(this.server, tool, apiClient, tenantContext, usageStore);
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
    void this.sql`DELETE FROM wechat_access_token`;
    const storage = await createD1Storage(getAgentEnv(this));
    await storage.clearAccountAccessToken(accountContext);
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
      billing: await createStripeBillingServiceForEnv(env, usageStore),
      onboardingStore,
      validateWechatCredentials: async config => await validateWechatCredentialsForAccount(env, config),
      trustedContext,
      createApiClient: async () => (await createWorkerToolContext(env)).apiClient,
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

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        success: true,
        runtime: 'cloudflare-workers',
        mcpEndpoint: '/mcp',
        webhookEndpoint: '/wx/callback/{accountId}',
        legacyWebhookEndpoint: '/wx/callback',
      });
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="wechat-official-account-mcp"',
        },
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

async function handleAuthorize(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const provider = env.OAUTH_PROVIDER;

  if (!provider) {
    return new Response('OAuth provider binding is not available.', { status: 500 });
  }

  const oauthRequest = await provider.parseAuthRequest(request);

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
  await store.registerOAuthClient({
    clientId: oauthRequest.clientId,
    clientName: oauthRequest.clientId || 'OAuth client',
    redirectUris: [oauthRequest.redirectUri],
    scopes: oauthRequest.scope,
  });

  const hasConsent = await store.hasOAuthConsent({
    operatorId: session.operatorId,
    clientId: oauthRequest.clientId,
    scopes: oauthRequest.scope,
  });

  if (request.method === 'GET' && !hasConsent) {
    return renderAuthorizationConsentForm({
      query: url.searchParams.toString(),
      clientId: oauthRequest.clientId,
      scopes: oauthRequest.scope,
    });
  }

  if (request.method === 'POST') {
    const formData = await request.formData();
    if (String(formData.get('consent') ?? '') !== 'approve') {
      return renderAuthorizationConsentForm({
        query: url.searchParams.toString(),
        clientId: oauthRequest.clientId,
        scopes: oauthRequest.scope,
        error: '请确认授权后继续。',
      });
    }
    await store.rememberOAuthConsent({
      operatorId: session.operatorId,
      clientId: oauthRequest.clientId,
      scopes: oauthRequest.scope,
    });
  }

  const { redirectTo } = await provider.completeAuthorization({
    request: oauthRequest,
    userId: session.operatorId,
    scope: oauthRequest.scope,
    props: {
      userId: session.operatorId,
      oauthClientId: oauthRequest.clientId,
      scopes: oauthRequest.scope,
    },
    metadata: {
      mcpServer: 'wechat-official-account-mcp',
    },
  });

  return Response.redirect(redirectTo, 302);
}

function renderAuthorizationConsentForm(input: {
  query: string;
  clientId: string;
  scopes: string[];
  error?: string;
}): Response {
  const errorHtml = input.error
    ? `<p class="error">${escapeHtml(input.error)}</p>`
    : '';
  const scopeItems = input.scopes.length > 0
    ? input.scopes.map(scope => `<li>${escapeHtml(scope)}</li>`).join('')
    : '<li>基础登录授权</li>';

  return new Response(
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>微信公众号 MCP 授权</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #f7f7f8; }
    form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; min-width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,.06); }
    h1 { margin: 0 0 16px; font-size: 18px; }
    label { display: block; margin-bottom: 8px; color: #374151; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
    button { width: 100%; border: 0; border-radius: 8px; padding: 10px 12px; background: #111827; color: white; font-weight: 600; cursor: pointer; }
    .error { color: #dc2626; margin: 0 0 12px; }
  </style>
</head>
<body>
  <form method="POST" action="/authorize?${escapeHtml(input.query)}">
    <h1>授权访问微信公众号 MCP</h1>
    ${errorHtml}
    <p>客户端 <strong>${escapeHtml(input.clientId || 'unknown client')}</strong> 请求访问你的 WOA 租户。</p>
    <label>授权范围</label>
    <ul>${scopeItems}</ul>
    <input type="hidden" name="consent" value="approve" />
    <button type="submit">授权</button>
  </form>
</body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
      },
    },
  );
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
    scopesSupported: [
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
    ],
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
      return await handleStripeWebhookRequest(request, {
        webhookSecret: await resolveSecret(env.STRIPE_WEBHOOK_SECRET),
        usageStore: new D1UsageQuotaStore(env.DB),
        priceIds: await resolveStripePriceIds(env),
      });
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

    if (url.pathname === '/__debug/mcp-event-store/replay' && isLocalhost(url.hostname)) {
      const agent = await getDebugMcpAgent(env);
      return json(await agent.runEventStoreSelfTest());
    }

    if ((url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) && !request.headers.has('authorization')) {
      return await defaultHandler.fetch(request, env);
    }

    return await createOAuthProvider().fetch(request, env, ctx as any);
  },
};

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
