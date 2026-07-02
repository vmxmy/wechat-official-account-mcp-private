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
import { authMcpTool } from '../mcp-tool/tools/auth-tool.js';
import { draftMcpTool } from '../mcp-tool/tools/draft-tool.js';
import { publishMcpTool } from '../mcp-tool/tools/publish-tool.js';
import { userMcpTool } from '../mcp-tool/tools/user-tool.js';
import { tagMcpTool } from '../mcp-tool/tools/tag-tool.js';
import { menuMcpTool } from '../mcp-tool/tools/menu-tool.js';
import { templateMsgMcpTool } from '../mcp-tool/tools/template-msg-tool.js';
import { customerServiceMcpTool } from '../mcp-tool/tools/customer-service-tool.js';
import { statisticsMcpTool } from '../mcp-tool/tools/statistics-tool.js';
import { autoReplyMcpTool } from '../mcp-tool/tools/auto-reply-tool.js';
import { massSendMcpTool } from '../mcp-tool/tools/mass-send-tool.js';
import { subscribeMsgMcpTool } from '../mcp-tool/tools/subscribe-msg-tool.js';
import { inboxMcpTool } from '../mcp-tool/tools/inbox-tool.js';
import { D1StorageManager, type D1DatabaseLike } from '../storage/d1-storage-manager.js';
import { AccessTokenHttpExecutor } from '../wechat/http-executor.js';
import { WorkersHttpExecutor } from '../wechat/workers-http-executor.js';
import type { OutboundProxyConfig } from '../wechat/proxy.js';
import { WechatApiClient } from '../wechat/api-client.js';
import { D1InboxStore } from './inbox-store.js';
import { createWorkerMediaTools } from './media-tools.js';
import { handleWechatWebhook } from './wechat-webhook.js';

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
  WECHAT_PROXY_URL?: SecretBinding;
  WECHAT_PROXY_TOKEN?: SecretBinding;
  OAUTH_CLIENT_ID: SecretBinding;
  OAUTH_CLIENT_SECRET: SecretBinding;
}

type TokenOwnerStub = {
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<AccessTokenInfo>;
  refreshAccessToken(): Promise<AccessTokenInfo>;
  clearAccessToken(): Promise<void>;
  getDebugStatus(): Promise<Record<string, unknown>>;
  runCoalescingSelfTest(): Promise<Record<string, unknown>>;
};

type WechatMcpAgentStub = {
  runEventStoreSelfTest(): Promise<Record<string, unknown>>;
};

const WORKER_SHARED_MCP_TOOLS = [
  authMcpTool,
  draftMcpTool,
  publishMcpTool,
  userMcpTool,
  tagMcpTool,
  menuMcpTool,
  templateMsgMcpTool,
  customerServiceMcpTool,
  statisticsMcpTool,
  autoReplyMcpTool,
  massSendMcpTool,
  inboxMcpTool,
  subscribeMsgMcpTool,
];
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const TOKEN_OWNER_NAME = 'global';

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

async function getTokenOwner(env: WorkerEnv): Promise<TokenOwnerStub> {
  return await getAgentByName(
    env.TOKEN_OWNER as any,
    TOKEN_OWNER_NAME,
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

class WorkersAuthManager {
  private config: WechatConfig | null = null;

  constructor(
    private readonly storage: D1StorageManager,
    private readonly tokenOwner: TokenOwnerStub,
  ) {}

  async initialize(): Promise<void> {
    this.config = await this.storage.getConfig();
  }

  async setConfig(config: WechatConfig): Promise<void> {
    this.config = config;
    await this.storage.saveConfig(config);
    await this.storage.clearAccessToken();
    await this.tokenOwner.clearAccessToken();
  }

  async getConfig(): Promise<WechatConfig | null> {
    if (!this.config) {
      this.config = await this.storage.getConfig();
    }
    return this.config;
  }

  async getAccessToken(): Promise<AccessTokenInfo> {
    return await this.tokenOwner.getAccessToken();
  }

  async refreshAccessToken(): Promise<AccessTokenInfo> {
    return await this.tokenOwner.refreshAccessToken();
  }

  isConfigured(): boolean {
    return !!(this.config?.appId && this.config?.appSecret);
  }

  async clearAuth(): Promise<void> {
    this.config = null;
    await this.storage.clearConfig();
    await this.storage.clearAccessToken();
    await this.tokenOwner.clearAccessToken();
  }
}

async function createWorkerToolContext(env: WorkerEnv): Promise<{
  apiClient: WechatApiClient;
  storage: D1StorageManager;
  inboxStore: D1InboxStore;
}> {
  const storage = await createD1Storage(env);
  const inboxStore = new D1InboxStore(env.DB);
  await inboxStore.ensureSchema();
  const tokenOwner = await getTokenOwner(env);
  const authManager = new WorkersAuthManager(storage, tokenOwner);
  await authManager.initialize();
  const proxy = await resolveWorkerProxyConfig(env);

  const apiClient = new WechatApiClient(authManager, {
    httpExecutor: new AccessTokenHttpExecutor(
      await createWechatWorkersHttpExecutor(env, proxy),
      async () => (await tokenOwner.getAccessToken()).accessToken,
    ),
    inboxStore,
  });

  return { apiClient, storage, inboxStore };
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

function registerWorkerMcpTool(
  server: McpServer,
  tool: McpTool,
  apiClient: WechatApiClient,
): void {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema as any,
    async (params: unknown) => {
      try {
        return await tool.handler(params, apiClient) as any;
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
  const storage = await createD1Storage(env);
  const config = await storage.getConfig();
  const inboxStore = new D1InboxStore(env.DB);
  await inboxStore.ensureSchema();

  return await handleWechatWebhook(request, {
    token: config?.token ?? await resolveSecret(env.WECHAT_WEBHOOK_TOKEN),
    appId: config?.appId ?? await resolveSecret(env.WECHAT_APP_ID),
    encodingAESKey: config?.encodingAESKey ?? await resolveSecret(env.WECHAT_ENCODING_AES_KEY),
    inboxStore,
  });
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
    const { apiClient, storage } = await createWorkerToolContext(env);
    const mediaTools = createWorkerMediaTools({
      mediaBucket: env.MEDIA,
      saveMedia: media => storage.saveMedia(media),
    });

    for (const tool of [...WORKER_SHARED_MCP_TOOLS, ...mediaTools]) {
      registerWorkerMcpTool(this.server, tool, apiClient);
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

  async getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<AccessTokenInfo> {
    await this.ensureTokenTables();
    return await this.getAccessTokenWithRefresh(options, () => this.refreshAndPersist());
  }

  async refreshAccessToken(): Promise<AccessTokenInfo> {
    return await this.getAccessToken({ forceRefresh: true });
  }

  async clearAccessToken(): Promise<void> {
    await this.ensureTokenTables();
    void this.sql`DELETE FROM wechat_access_token`;
    const storage = await createD1Storage(getAgentEnv(this));
    await storage.clearAccessToken();
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
        singletonName: TOKEN_OWNER_NAME,
      };
    } finally {
      this.refreshPromise = previousRefreshPromise;
    }
  }

  async refreshBeforeExpiry(payload?: { expiresAt?: number }): Promise<void> {
    await this.ensureTokenTables();
    const current = await this.readStoredToken();

    if (payload?.expiresAt && current && current.expiresAt !== payload.expiresAt) {
      return;
    }

    if (this.isUsable(current)) {
      await this.schedulePreExpiryRefresh(current);
      return;
    }

    await this.getAccessToken({ forceRefresh: true });
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

  private async refreshAndPersist(): Promise<AccessTokenInfo> {
    await this.incrementMetric('refreshAttempts');

    const config = await this.resolveWechatConfig();
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
    await storage.saveAccessToken(tokenInfo);
    await this.incrementMetric('refreshSuccesses');
    await this.setMetric('lastRefreshAt', Date.now());
    await this.schedulePreExpiryRefresh(tokenInfo);

    return tokenInfo;
  }

  private async getAccessTokenWithRefresh(
    options: { forceRefresh?: boolean },
    refresher: () => Promise<AccessTokenInfo>,
  ): Promise<AccessTokenInfo> {
    const current = await this.readStoredToken();
    if (!options.forceRefresh && this.isUsable(current)) {
      await this.schedulePreExpiryRefresh(current);
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

  private async resolveWechatConfig(): Promise<WechatConfig> {
    const storage = await createD1Storage(getAgentEnv(this));
    const stored = await storage.getConfig();
    if (stored?.appId && stored?.appSecret) {
      return stored;
    }

    const env = getAgentEnv(this);
    const appId = await resolveSecret(env.WECHAT_APP_ID);
    const appSecret = await resolveSecret(env.WECHAT_APP_SECRET);

    if (!appId || !appSecret) {
      throw new Error('Wechat config not found. Configure D1 config or WECHAT_APP_ID/WECHAT_APP_SECRET secrets first.');
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

  private async schedulePreExpiryRefresh(tokenInfo: AccessTokenInfo): Promise<void> {
    const refreshAt = tokenInfo.expiresAt - REFRESH_BEFORE_EXPIRY_MS;
    const delaySeconds = Math.max(1, Math.floor((refreshAt - Date.now()) / 1000));

    await this.schedule(
      delaySeconds,
      'refreshBeforeExpiry',
      { expiresAt: tokenInfo.expiresAt },
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
        webhookEndpoint: '/wx/callback',
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
    },
    defaultHandler,
    scopesSupported: ['wechat.mcp'],
    allowPlainPKCE: false,
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    if (isLegacyRestToolPath(url.pathname)) {
      return legacyRestToolRemovedResponse();
    }

    if (
      url.pathname === '/health' ||
      url.pathname === '/api/health' ||
      url.pathname === '/wx/callback'
    ) {
      if (url.pathname === '/wx/callback') {
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
