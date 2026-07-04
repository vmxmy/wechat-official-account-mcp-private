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

type SecretBinding = string | { get(): Promise<string | null> };
type DurableObjectNamespaceLike = unknown;
type KVNamespaceLike = unknown;

export interface WorkerEnv {
  WECHAT_MCP_AGENT: DurableObjectNamespaceLike;
  TOKEN_OWNER: DurableObjectNamespaceLike;
  DB: D1DatabaseLike;
  MEDIA: unknown;
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
    const currentConfig = await apiClient.getAuthManager().getConfig();
    const tenantContext = createDefaultTenantContext({
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
    const trustedContext = createDefaultTenantContext({
      source: 'rest',
      userId: props.userId || await resolveSecret(env.OAUTH_CLIENT_ID) || 'wechat-admin',
      oauthClientId: props.oauthClientId,
      scopes: props.scopes,
      requestId: request.headers.get('x-request-id'),
      appId: await resolveSecret(env.WECHAT_APP_ID),
    });

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

  if (request.method === 'GET') {
    return renderAuthorizationForm(url.searchParams.toString());
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, POST' },
    });
  }

  const expectedPassword = await resolveSecret(env.OAUTH_CLIENT_SECRET);
  if (!expectedPassword) {
    return new Response('Server misconfigured: missing OAUTH_CLIENT_SECRET.', { status: 500 });
  }

  const formData = await request.formData();
  const password = String(formData.get('password') ?? '');
  if (password !== expectedPassword) {
    return renderAuthorizationForm(url.searchParams.toString(), '授权密码不正确。');
  }

  const userId = await resolveSecret(env.OAUTH_CLIENT_ID) ?? 'wechat-admin';
  const { redirectTo } = await provider.completeAuthorization({
    request: oauthRequest,
    userId,
    scope: oauthRequest.scope,
    props: {
      userId,
      oauthClientId: oauthRequest.clientId,
      scopes: oauthRequest.scope,
    },
    metadata: {
      mcpServer: 'wechat-official-account-mcp',
    },
  });

  return Response.redirect(redirectTo, 302);
}

function renderAuthorizationForm(query: string, error?: string): Response {
  const errorHtml = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : '';

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
  <form method="POST" action="/authorize?${escapeHtml(query)}">
    <h1>授权访问微信公众号 MCP</h1>
    ${errorHtml}
    <label for="password">授权密码</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" />
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

    if (isStripeWebhookPath(url.pathname)) {
      return await handleStripeWebhookRequest(request, {
        webhookSecret: await resolveSecret(env.STRIPE_WEBHOOK_SECRET),
        usageStore: new D1UsageQuotaStore(env.DB),
        priceIds: await resolveStripePriceIds(env),
      });
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
