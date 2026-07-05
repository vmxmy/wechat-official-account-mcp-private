// 简单测试脚本验证工具注册与运行时 seam
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'fs';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import CryptoJS from 'crypto-js';
import { mcpTools, wechatTools } from './dist/src/mcp-tool/tools/index.js';
import { inboxMcpTool } from './dist/src/mcp-tool/tools/inbox-tool.js';
import { logger } from './dist/src/utils/logger.js';
import { WechatApiClient } from './dist/src/wechat/api-client.js';
import { AccessTokenHttpExecutor } from './dist/src/wechat/http-executor.js';
import { WorkersHttpExecutor } from './dist/src/wechat/workers-http-executor.js';
import { D1StorageManager } from './dist/src/storage/d1-storage-manager.js';
import { DEFAULT_ACCOUNT_ID, DEFAULT_TENANT_ID } from './dist/src/storage/types.js';
import { D1InboxStore } from './dist/src/worker/inbox-store.js';
import { createWorkerMediaTools } from './dist/src/worker/media-tools.js';
import { handleManagementApiRequest } from './dist/src/worker/management-api.js';
import {
  createInboundDedupKey,
  createWechatSignature,
  decryptWechatMessage,
  handleWechatWebhook,
} from './dist/src/worker/wechat-webhook.js';
import {
  D1AuditLogWriter,
  requireConfirmationMarker,
  sanitizeAuditMetadata,
} from './dist/src/worker/audit-log.js';
import { createDefaultTenantContext } from './dist/src/worker/tenant-context.js';
import {
  PLAN_QUOTA_POLICIES,
  createQuotaConsumptions,
  quotaPeriod,
} from './dist/src/worker/quota-policy.js';
import {
  D1UsageQuotaStore,
  QuotaExceededError,
  reserveMcpToolQuota,
} from './dist/src/worker/usage-store.js';
import { executeMcpToolWithQuota } from './dist/src/worker/mcp-quota.js';
import {
  createStripeCheckoutService,
  handleStripeWebhookRequest,
} from './dist/src/worker/stripe-billing.js';

let failed = false;

function check(ok, message) {
  console.log(`${ok ? '✅' : '❌'} ${message}`);
  failed ||= !ok;
}

function execFileText(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function usageCliRequestsOk(requests) {
  return requests.length === 1 &&
    requests[0].method === 'GET' &&
    requests[0].url === `/api/v1/tenants/${DEFAULT_TENANT_ID}/usage` &&
    requests[0].authorization === 'Bearer TEST_TOKEN';
}

function stripeSignatureHeader(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

console.log('=== MCP工具注册验证 ===');
console.log(`总共注册的工具数量: ${mcpTools.length}`);
console.log('\n已注册的工具列表:');

mcpTools.forEach((tool, index) => {
  console.log(`${index + 1}. ${tool.name} - ${tool.description}`);
});

console.log('\n=== 验证结果 ===');
check(mcpTools.length === 26, mcpTools.length === 26
  ? '成功！所有22个既有工具 + 4个多租户管理工具都已正确注册为MCP工具'
  : `失败！期望26个工具，实际注册了${mcpTools.length}个工具`);

const managementToolNames = ['woa_context', 'woa_tenant', 'woa_account', 'woa_audit'];
check(
  managementToolNames.every(name => mcpTools.some(tool => tool.name === name)),
  '多租户管理 MCP 工具 woa_context/woa_tenant/woa_account/woa_audit 已注册',
);
check(
  mcpTools.filter(tool => tool.name.startsWith('wechat_')).every(tool => tool.inputSchema.accountId?.safeParse(undefined).success === true),
  '既有 WeChat MCP 工具均接受可选 accountId 以支持账号解析',
);

check(
  !existsSync('./dist/src/cli.js') &&
    existsSync('./dist/src/cli/woa.js') &&
    !existsSync('./dist/src/mcp-server') &&
    readFileSync('./dist/src/worker/index.js', 'utf8').includes("serve('/mcp'"),
  '旧本地桌面 stdio CLI 构建产物未恢复；仅新增 remote-only woa CLI，Workers /mcp Streamable HTTP 保持',
);

console.log('\n=== HTTP/Storage Seam 验证 ===');

class FakeExecutor {
  calls = [];

  async get(path, config) {
    this.calls.push({ method: 'get', path, config });
    return { data: { ok: true }, status: 200, headers: {} };
  }

  async post(path, data, config) {
    this.calls.push({ method: 'post', path, data, config });
    return { data: { ok: true }, status: 200, headers: {} };
  }

  async postForm(path, formData, config) {
    this.calls.push({ method: 'postForm', path, formData, config });
    return { data: { ok: true }, status: 200, headers: {} };
  }
}

const fakeExecutor = new FakeExecutor();
const tokenExecutor = new AccessTokenHttpExecutor(fakeExecutor, async () => 'TEST_TOKEN');

await tokenExecutor.get('/cgi-bin/user/get');
await tokenExecutor.post('/cgi-bin/menu/delete?access_token=EXISTING_TOKEN');
await tokenExecutor.postForm('/cgi-bin/media/upload?type=image', {});

const seamChecks = [
  [typeof WorkersHttpExecutor === 'function', 'WorkersHttpExecutor 已导出'],
  [typeof D1StorageManager === 'function', 'D1StorageManager 已导出'],
  [fakeExecutor.calls[0]?.path === '/cgi-bin/user/get?access_token=TEST_TOKEN', 'GET 自动注入 access_token'],
  [fakeExecutor.calls[1]?.path === '/cgi-bin/menu/delete?access_token=EXISTING_TOKEN', '已有 access_token 不重复注入'],
  [fakeExecutor.calls[2]?.path === '/cgi-bin/media/upload?type=image&access_token=TEST_TOKEN', 'postForm 保留 query 并注入 access_token'],
];

for (const [ok, message] of seamChecks) {
  check(ok, message);
}

const datacubeCalls = [];
const datacubeClient = new WechatApiClient({
  getConfig: async () => null,
  setConfig: async () => undefined,
  clearConfig: async () => undefined,
  getAccessToken: async () => ({ accessToken: 'TOKEN', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
  refreshAccessToken: async () => ({ accessToken: 'TOKEN', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
  clearAccessToken: async () => undefined,
}, {
  httpExecutor: {
    get: async (path, config) => {
      datacubeCalls.push({ method: 'GET', path, config });
      return { data: { list: [] }, status: 200, headers: {} };
    },
    post: async (path, data, config) => {
      datacubeCalls.push({ method: 'POST', path, data, config });
      return { data: { list: [] }, status: 200, headers: {} };
    },
    postForm: async (path, data, config) => {
      datacubeCalls.push({ method: 'POST_FORM', path, data, config });
      return { data: {}, status: 200, headers: {} };
    },
  },
});
await datacubeClient.getUserSummary('2026-07-04', '2026-07-04');
await datacubeClient.getUserCumulate('2026-07-04', '2026-07-04');
await datacubeClient.getArticleSummary('2026-07-04', '2026-07-04');
await datacubeClient.getInterfaceSummary('2026-07-04', '2026-07-04');
check(
  datacubeCalls.length === 4 &&
    datacubeCalls.every(call => call.method === 'POST') &&
    datacubeCalls.every(call => call.data?.begin_date === '2026-07-04' && call.data?.end_date === '2026-07-04') &&
    datacubeCalls.some(call => call.path === '/datacube/getusersummary') &&
    datacubeCalls.some(call => call.path === '/datacube/getinterfacesummary') &&
    datacubeCalls.every(call => !call.path.startsWith('/cgi-bin/datacube/')),
  'WechatApiClient datacube 统计接口使用根路径 /datacube 和官方 POST body',
);

console.log('\n=== Workers HTTP Executor fixture 验证 ===');

const fetchCalls = [];
const fetchImpl = async (input, init = {}) => {
  const body = init.body;
  fetchCalls.push({
    url: String(input),
    method: init.method,
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    bodyKind: body?.constructor?.name ?? typeof body,
    bodyText: typeof body === 'string' ? body : undefined,
    isFormData: body instanceof FormData,
  });

  return new Response(JSON.stringify({ ok: true, call: fetchCalls.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const workersExecutor = new WorkersHttpExecutor({
  baseURL: 'https://api.weixin.qq.com',
  fetch: fetchImpl,
});
const tokenWorkersExecutor = new AccessTokenHttpExecutor(workersExecutor, async () => 'WORKER_TOKEN');

await tokenWorkersExecutor.get('/cgi-bin/user/get', { params: { next_openid: 'OPEN_ID' } });
await tokenWorkersExecutor.post('/cgi-bin/menu/create', { button: [] });
const webFormData = new FormData();
webFormData.append('media', new Blob([new Uint8Array([1, 2, 3])]), 'fixture.bin');
await tokenWorkersExecutor.postForm('/cgi-bin/media/upload?type=image', webFormData);

const proxyFetchCalls = [];
const proxyWorkersExecutor = new WorkersHttpExecutor({
  baseURL: 'https://api.weixin.qq.com',
  proxy: {
    mode: 'relay',
    url: 'https://proxy.example.test/wechat',
    token: 'PROXY_TOKEN',
  },
  fetch: async (input, init = {}) => {
    proxyFetchCalls.push({
      url: String(input),
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return new Response(JSON.stringify({ proxied: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
await proxyWorkersExecutor.get('/cgi-bin/token', {
  params: { grant_type: 'client_credential', appid: 'wx_proxy' },
});

const arrayExecutor = new WorkersHttpExecutor({
  baseURL: 'https://api.weixin.qq.com',
  fetch: async () => new Response(new Uint8Array([7, 8, 9]).buffer, { status: 200 }),
});
const arrayResponse = await arrayExecutor.get('/cgi-bin/media/get', { responseType: 'arraybuffer' });

check(
  fetchCalls[0]?.url === 'https://api.weixin.qq.com/cgi-bin/user/get?access_token=WORKER_TOKEN&next_openid=OPEN_ID',
  'WorkersHttpExecutor GET 合并 path token 与 config params',
);
check(fetchCalls[1]?.method === 'POST', 'WorkersHttpExecutor POST 使用 POST 方法');
check(fetchCalls[1]?.headers['content-type']?.includes('application/json'), 'WorkersHttpExecutor JSON POST 设置 content-type');
check(fetchCalls[1]?.bodyText === JSON.stringify({ button: [] }), 'WorkersHttpExecutor JSON POST 序列化请求体');
check(fetchCalls[2]?.isFormData === true, 'WorkersHttpExecutor postForm 使用 Web FormData 请求体');
check(!('content-type' in (fetchCalls[2]?.headers ?? {})), 'WorkersHttpExecutor postForm 不手动覆盖 multipart boundary');
check(arrayResponse.data instanceof ArrayBuffer && arrayResponse.data.byteLength === 3, 'WorkersHttpExecutor 支持 arraybuffer 响应');
check(
  proxyFetchCalls[0]?.url === 'https://proxy.example.test/wechat',
  'WorkersHttpExecutor relay 代理默认不把目标微信 URL 放入 query，避免 token/secret 进入访问日志',
);
check(
  proxyFetchCalls[0]?.headers['x-wechat-proxy-target-url'] === 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wx_proxy' &&
    proxyFetchCalls[0]?.headers['x-wechat-proxy-token'] === 'PROXY_TOKEN',
  'WorkersHttpExecutor relay 代理传递目标与代理 token header',
);

console.log('\n=== HTTP-only runtime fixture 验证 ===');
check(!existsSync('./dist/src/wechat/node-http-executor.js'), 'NodeHttpExecutor 构建产物已移除');
check(!existsSync('./dist/src/storage/storage-manager.js'), 'SQLite StorageManager 构建产物已移除');
check(!existsSync('./dist/src/auth/auth-manager.js'), '本地 AuthManager 构建产物已移除');

console.log('\n=== Multi-tenant surface fixture 验证 ===');

const anonymousRestResponse = await handleManagementApiRequest(
  new Request('https://worker.example.test/api/v1/me'),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    createApiClient: async () => { throw new Error('anonymous request must not construct api client'); },
  },
);
check(anonymousRestResponse.status === 401, 'REST /api/v1/me 匿名请求返回 401');

const authorizedRestResponse = await handleManagementApiRequest(
  new Request('https://worker.example.test/api/v1/me', {
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:context:read woa:tenant:read woa:account:read',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    createApiClient: async () => { throw new Error('/me must not construct api client'); },
  },
);
const authorizedRestBody = await authorizedRestResponse.json();
check(
  authorizedRestResponse.status === 200 &&
    authorizedRestBody.success === true &&
    authorizedRestBody.data?.accounts?.[0]?.accountId === DEFAULT_ACCOUNT_ID,
  'REST /api/v1/me 授权请求返回用户/租户/默认账号上下文',
);

const woaHelp = execFileSync(process.execPath, ['./dist/src/cli/woa.js', '--help'], { encoding: 'utf8' });
check(
  woaHelp.includes('remote-only') &&
    !woaHelp.includes('wechat-mcp mcp -a -s'),
  'woa CLI 帮助只宣传 remote-only 工作流，不恢复旧本地 MCP server 命令',
);
const woaConfig = execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'mcp', 'config', 'codex', '--server', 'https://worker.example.test'], { encoding: 'utf8' });
check(
  woaConfig.includes('https://worker.example.test/mcp') &&
    !/appSecret|WECHAT_APP_SECRET|app_secret/i.test(woaConfig),
  'woa mcp config 生成远程 /mcp 配置且不包含微信凭据',
);
const woaDraftDeleteDryRun = JSON.parse(execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'draft', 'delete', 'MEDIA_ID_FOR_DELETE', '--dry-run'], { encoding: 'utf8' }));
const woaPublishDeleteDryRun = JSON.parse(execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'publish', 'delete', 'ARTICLE_ID_FOR_DELETE', '--index', '1', '--dry-run'], { encoding: 'utf8' }));
check(
  woaDraftDeleteDryRun.dryRun === true &&
    woaDraftDeleteDryRun.operation === 'draft.delete' &&
    woaDraftDeleteDryRun.target?.mediaId === 'MEDIA_ID_FOR_DELETE' &&
    woaPublishDeleteDryRun.dryRun === true &&
    woaPublishDeleteDryRun.operation === 'publish.delete' &&
    woaPublishDeleteDryRun.target?.articleId === 'ARTICLE_ID_FOR_DELETE' &&
    woaPublishDeleteDryRun.target?.index === 1,
  'woa CLI 删除命令默认支持 dry-run 预检，不要求本地 MCP 或微信凭据',
);
const workerIndexSource = readFileSync('./src/worker/index.ts', 'utf8');
check(
  workerIndexSource.includes("'/api/v1': managementApiHandler") &&
    !workerIndexSource.includes("url.pathname.startsWith('/api/v1')"),
  '生产 Worker /api/v1 通过 OAuthProvider apiHandlers 保护，不在 OAuth 前手动执行 REST',
);

console.log('\n=== Plan quota fixture 验证 ===');

class MemoryUsageD1Database {
  entitlements = new Map();
  counters = new Map();
  events = [];
  stripeEvents = new Map();

  prepare(query) {
    return new MemoryUsageD1Statement(this, query);
  }

  async exec() {
    return {};
  }
}

class MemoryUsageD1Statement {
  values = [];

  constructor(db, query) {
    this.db = db;
    this.query = query.replace(/\s+/g, ' ').trim();
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    const q = this.query;

    if (q.startsWith('INSERT INTO tenant_entitlements')) {
      const [
        tenantId,
        plan,
        status,
        stripeCustomerId,
        stripeSubscriptionId,
        currentPeriodStart,
        currentPeriodEnd,
        limitsJson,
        createdAt,
        updatedAt,
      ] = this.values;
      const existing = this.db.entitlements.get(tenantId);
      this.db.entitlements.set(tenantId, {
        tenant_id: tenantId,
        plan,
        status,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        limits_json: limitsJson,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO usage_counters')) {
      const [tenantId, period, metric, amount, limitValue, resetAt, createdAt, updatedAt] = this.values;
      const key = `${tenantId}:${period}:${metric}`;
      const existing = this.db.counters.get(key);
      if (existing) {
        if (existing.used + amount <= limitValue) {
          existing.used += amount;
          existing.limit_value = limitValue;
          existing.reset_at = resetAt;
          existing.updated_at = updatedAt;
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      }
      this.db.counters.set(key, {
        tenant_id: tenantId,
        period,
        metric,
        used: amount,
        limit_value: limitValue,
        reset_at: resetAt,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE usage_counters SET used = MAX')) {
      const [amount, updatedAt, tenantId, period, metric] = this.values;
      const key = `${tenantId}:${period}:${metric}`;
      const existing = this.db.counters.get(key);
      if (existing) {
        existing.used = Math.max(0, existing.used - amount);
        existing.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO usage_events')) {
      const [
        id,
        tenantId,
        accountId,
        userId,
        oauthClientId,
        requestId,
        toolName,
        action,
        plan,
        metricsJson,
        outcome,
        createdAt,
      ] = this.values;
      this.db.events.push({
        id,
        tenant_id: tenantId,
        account_id: accountId,
        user_id: userId,
        oauth_client_id: oauthClientId,
        request_id: requestId,
        tool_name: toolName,
        action,
        plan,
        metrics_json: metricsJson,
        outcome,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO stripe_billing_events')) {
      const [eventId, eventType, tenantId, stripeSubscriptionId, createdAt, processedAt] = this.values;
      if (this.db.stripeEvents.has(eventId)) throw new Error(`Duplicate stripe event fixture: ${eventId}`);
      this.db.stripeEvents.set(eventId, {
        event_id: eventId,
        event_type: eventType,
        tenant_id: tenantId,
        stripe_subscription_id: stripeSubscriptionId,
        created_at: createdAt,
        processed_at: processedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE INDEX')) {
      return { success: true, meta: { changes: 0 } };
    }

    throw new Error(`Unsupported usage D1 run query: ${q}`);
  }

  async first() {
    const q = this.query;

    if (q.startsWith('SELECT plan, status, limits_json')) {
      return this.db.entitlements.get(this.values[0]) ?? null;
    }

    if (q.startsWith('SELECT tenant_id, plan, status, limits_json')) {
      const subscriptionId = this.values[0];
      return [...this.db.entitlements.values()].find(row => row.stripe_subscription_id === subscriptionId) ?? null;
    }

    if (q.startsWith('SELECT event_id FROM stripe_billing_events')) {
      return this.db.stripeEvents.get(this.values[0]) ?? null;
    }

    if (q.startsWith('SELECT used, limit_value, reset_at')) {
      const [tenantId, period, metric] = this.values;
      return this.db.counters.get(`${tenantId}:${period}:${metric}`) ?? null;
    }

    throw new Error(`Unsupported usage D1 first query: ${q}`);
  }

  async all() {
    return { success: true, results: [] };
  }
}

const quotaNow = Date.UTC(2026, 6, 4, 8, 0, 0);
const freePublishConsumptions = createQuotaConsumptions({
  toolName: 'wechat_publish',
  params: { action: 'submit' },
  plan: 'free',
  now: quotaNow,
});
const plusPublishConsumptions = createQuotaConsumptions({
  toolName: 'wechat_publish',
  params: { action: 'submit' },
  plan: 'plus',
  now: quotaNow,
});
check(
  PLAN_QUOTA_POLICIES.free.limits.published_articles_month === 30 &&
    freePublishConsumptions.some(item => item.metric === 'published_articles_month' && item.limit === 30) &&
    plusPublishConsumptions.some(item => item.metric === 'published_articles_month' && item.limit === 300),
  'Free/Plus plan 配额策略允许全工具但发布月额度分别为 30/300',
);
check(
  !Object.prototype.hasOwnProperty.call(PLAN_QUOTA_POLICIES.free, 'disabledTools') &&
    mcpTools.every(tool => createQuotaConsumptions({ toolName: tool.name, params: { action: 'list' }, plan: 'free', now: quotaNow }).length >= 2),
  'Free 计划不隐藏任何 MCP tool；所有工具至少受每日/月度总调用配额约束',
);
const quotaMigrationSql = readFileSync('./migrations/d1/0003_usage_quotas.sql', 'utf8');
const stripeBillingMigrationSql = readFileSync('./migrations/d1/0004_stripe_billing_events.sql', 'utf8');
check(
  ['tenant_entitlements', 'usage_counters', 'usage_events'].every(table => quotaMigrationSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) &&
    /stripe_customer_id TEXT/.test(quotaMigrationSql) &&
    /INSERT OR IGNORE INTO tenant_entitlements/.test(quotaMigrationSql),
  '0003 migration 声明 plan entitlement、usage counters/events，并为 Stripe 订阅字段预留落点',
);
check(
  stripeBillingMigrationSql.includes('CREATE TABLE IF NOT EXISTS stripe_billing_events') &&
    stripeBillingMigrationSql.includes('event_id TEXT PRIMARY KEY'),
  '0004 migration 声明 Stripe webhook event 幂等 ledger',
);

const quotaDb = new MemoryUsageD1Database();
const quotaStore = new D1UsageQuotaStore(quotaDb);
await quotaStore.ensureSchema();
const quotaContext = createDefaultTenantContext({
  source: 'test',
  userId: 'user_quota',
  tenantId: 'tenant_quota',
  accountId: 'acct_quota',
});
const quotaPublishTool = {
  name: 'wechat_publish',
  description: 'quota publish fixture',
  inputSchema: {},
  handler: async () => ({ content: [{ type: 'text', text: 'published' }] }),
};
let freePublishSuccesses = 0;
for (let index = 0; index < 30; index += 1) {
  const result = await executeMcpToolWithQuota({
    tool: quotaPublishTool,
    apiClient: {},
    params: { action: 'submit', mediaId: `MEDIA_${index}` },
    tenantContext: quotaContext,
    usageStore: quotaStore,
  });
  if (result.isError !== true) freePublishSuccesses += 1;
}
check(freePublishSuccesses === 30, 'Free 发布额度内 30 次调用均成功');
const overQuotaResult = await executeMcpToolWithQuota({
  tool: quotaPublishTool,
  apiClient: {},
  params: { action: 'submit', mediaId: 'MEDIA_OVER_LIMIT' },
  tenantContext: quotaContext,
  usageStore: quotaStore,
});
const publishCounter = await quotaStore.getCounter('tenant_quota', 'published_articles_month', quotaPeriod('month'));
check(
  publishCounter?.used === 30 &&
    overQuotaResult.isError === true &&
    overQuotaResult._meta?.error?.code === 'quota_exceeded',
  'Free 发布月额度第 31 次被 quota_exceeded 拦截且不增加已用量',
);

const plusQuotaStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
await plusQuotaStore.upsertEntitlement({ tenantId: 'tenant_plus', plan: 'plus' });
const plusReservation = await reserveMcpToolQuota({
  store: plusQuotaStore,
  tenantId: 'tenant_plus',
  toolName: 'wechat_publish',
  action: 'submit',
  params: { action: 'submit' },
});
check(
  plusReservation.metadata().checks.some(item => item.metric === 'published_articles_month' && item.limit === 300),
  'tenant_entitlements 可将租户升级到 Plus 并使用 Plus 配额',
);
await plusReservation.refund('fixture_cleanup');

let quotaExceededThrown = false;
try {
  await reserveMcpToolQuota({
    store: quotaStore,
    tenantId: 'tenant_quota',
    toolName: 'wechat_publish',
    action: 'submit',
    params: { action: 'submit' },
  });
} catch (error) {
  quotaExceededThrown = error instanceof QuotaExceededError;
}
check(quotaExceededThrown, '底层 quota reservation 在超额时抛出 QuotaExceededError');

const refundStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
const failingStatsTool = {
  name: 'wechat_statistics',
  description: 'quota refund fixture',
  inputSchema: {},
  handler: async () => { throw new Error('fixture failure'); },
};
try {
  await executeMcpToolWithQuota({
    tool: failingStatsTool,
    apiClient: {},
    params: { action: 'get_article_summary', beginDate: '2026-07-01', endDate: '2026-07-01' },
    tenantContext: quotaContext,
    usageStore: refundStore,
  });
} catch {
  // expected fixture failure
}
const refundedStatsCounter = await refundStore.getCounter('tenant_quota', 'stats_queries_month', quotaPeriod('month'));
check(
  (refundedStatsCounter?.used ?? 0) === 0,
  'handler 失败时业务配额会退款，不计入成功用量',
);

console.log('\n=== REST quota fixture 验证 ===');

const restQuotaStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
let restDraftCalls = 0;
const restDraftResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/drafts?count=20&no_content=1`, {
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:read',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: restQuotaStore,
    createApiClient: async () => ({
      post: async (path, data) => {
        restDraftCalls += 1;
        return { total_count: 0, item_count: 0, item: [], fixturePath: path, fixtureData: data };
      },
    }),
  },
);
const restDraftBody = await restDraftResponse.json();
const restToolCallCounter = await restQuotaStore.getCounter(DEFAULT_TENANT_ID, 'tool_calls_month', quotaPeriod('month'));
check(
  restDraftResponse.status === 200 &&
    restDraftCalls === 1 &&
    restDraftBody.meta?.quota?.checks?.some(item => item.metric === 'tool_calls_month') &&
    restToolCallCounter?.used === 1,
  'REST draft list 成功时提交 quota 并在响应 meta 返回机器可读 quota 信息',
);

const restDeleteQuotaStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
let restDeleteDraftCall = null;
const restDeleteDraftResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/drafts/${encodeURIComponent('MEDIA_ID_FOR_DELETE')}`, {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:write',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: restDeleteQuotaStore,
    createApiClient: async () => ({
      post: async (path, data) => {
        restDeleteDraftCall = { path, data };
        return { errcode: 0, errmsg: 'ok' };
      },
    }),
  },
);
const restDeleteDraftBody = await restDeleteDraftResponse.json();
check(
  restDeleteDraftResponse.status === 200 &&
    restDeleteDraftBody.data?.deleted === true &&
    restDeleteDraftCall?.path === '/cgi-bin/draft/delete' &&
    restDeleteDraftCall?.data?.media_id === 'MEDIA_ID_FOR_DELETE' &&
    restDeleteDraftBody.meta?.quota?.checks?.some(item => item.metric === 'high_risk_ops_month'),
  'REST draft delete 使用官方 media_id payload，受写权限与高风险 quota 保护',
);

let restDeletePublishCall = null;
const restDeletePublishResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/publishes/${encodeURIComponent('ARTICLE_ID_FOR_DELETE')}?index=1`, {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:write',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    createApiClient: async () => ({
      post: async (path, data) => {
        restDeletePublishCall = { path, data };
        return { errcode: 0, errmsg: 'ok' };
      },
    }),
  },
);
const restDeletePublishBody = await restDeletePublishResponse.json();
check(
  restDeletePublishResponse.status === 200 &&
    restDeletePublishBody.data?.deleted === true &&
    restDeletePublishCall?.path === '/cgi-bin/freepublish/delete' &&
    restDeletePublishCall?.data?.article_id === 'ARTICLE_ID_FOR_DELETE' &&
    restDeletePublishCall?.data?.index === 1,
  'REST publish delete 使用官方 article_id/index payload',
);

const restFailQuotaStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
let failingRestDraftCalls = 0;
const failingRestDraftResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/drafts`, {
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:read',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: restFailQuotaStore,
    createApiClient: async () => ({
      post: async () => {
        failingRestDraftCalls += 1;
        throw new Error('fixture upstream failure');
      },
    }),
  },
);
const failedRestToolCallCounter = await restFailQuotaStore.getCounter(DEFAULT_TENANT_ID, 'tool_calls_month', quotaPeriod('month'));
check(
  failingRestDraftResponse.status === 500 &&
    failingRestDraftCalls === 1 &&
    (failedRestToolCallCounter?.used ?? 0) === 0,
  'REST operation handler 失败时 quota 被退款，不消耗业务用量',
);

const restDeniedQuotaStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
await restDeniedQuotaStore.upsertEntitlement({
  tenantId: DEFAULT_TENANT_ID,
  plan: 'free',
  limitOverrides: { tool_calls_month: 0 },
});
let deniedRestDraftCalls = 0;
const deniedRestDraftResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/drafts`, {
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:read',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: restDeniedQuotaStore,
    createApiClient: async () => {
      deniedRestDraftCalls += 1;
      return { post: async () => ({}) };
    },
  },
);
const deniedRestBody = await deniedRestDraftResponse.json();
const deniedDayCounter = await restDeniedQuotaStore.getCounter(DEFAULT_TENANT_ID, 'tool_calls_day', quotaPeriod('day'));
check(
  deniedRestDraftResponse.status === 429 &&
    deniedRestBody.error?.code === 'quota_exceeded' &&
    deniedRestDraftCalls === 0 &&
    (deniedDayCounter?.used ?? 0) === 0,
  'REST quota_exceeded 在调用 apiClient 前拦截，且回滚已预占的其它 counter',
);

const usageVisibilityStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
await usageVisibilityStore.upsertEntitlement({
  tenantId: DEFAULT_TENANT_ID,
  plan: 'free',
  limitOverrides: {
    tool_calls_month: 1,
    tool_calls_day: 100,
  },
});
const usageVisibilityReservation = await reserveMcpToolQuota({
  store: usageVisibilityStore,
  tenantId: DEFAULT_TENANT_ID,
  accountId: DEFAULT_ACCOUNT_ID,
  toolName: 'wechat_draft',
  action: 'list',
  params: { action: 'list' },
});
await usageVisibilityReservation.commit();
let usageApiClientConstructed = false;
const usageVisibilityResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/usage`, {
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'x-woa-scopes': 'woa:tenant:read woa:usage:read',
    },
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: usageVisibilityStore,
    createApiClient: async () => {
      usageApiClientConstructed = true;
      throw new Error('usage visibility must not construct api client');
    },
  },
);
const usageVisibilityBody = await usageVisibilityResponse.json();
const usageToolCallMonth = usageVisibilityBody.data?.metrics?.find(item => item.metric === 'tool_calls_month');
check(
  usageVisibilityResponse.status === 200 &&
    usageApiClientConstructed === false &&
    usageVisibilityBody.data?.entitlement?.plan === 'free' &&
    usageVisibilityBody.data?.metrics?.length === Object.keys(PLAN_QUOTA_POLICIES.free.limits).length &&
    usageToolCallMonth?.used === 1 &&
    usageToolCallMonth?.limit === 1 &&
    usageVisibilityBody.data?.upgradePrompt?.recommended === true &&
    usageVisibilityBody.data?.upgradePrompt?.suggestedPlan === 'plus' &&
    usageVisibilityBody.meta?.upgradePrompt?.reasonCode === 'quota_exhausted',
  'REST usage visibility 返回全量指标/升级提示且不构造 WeChat API client',
);

const usageCliServerRequests = [];
const usageCliServer = createServer((req, res) => {
  usageCliServerRequests.push({
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization,
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    data: {
      tenantId: DEFAULT_TENANT_ID,
      metrics: [{ metric: 'tool_calls_month', used: 1, limit: 1 }],
      upgradePrompt: { recommended: true, suggestedPlan: 'plus' },
    },
  }));
});
await new Promise(resolve => usageCliServer.listen(0, '127.0.0.1', resolve));
try {
  const address = usageCliServer.address();
  const usageCliPort = typeof address === 'object' && address ? address.port : 0;
  const usageCliOutput = await execFileText(process.execPath, [
    './dist/src/cli/woa.js',
    'usage',
    '--server',
    `http://127.0.0.1:${usageCliPort}`,
    '--token',
    'TEST_TOKEN',
  ]);
  check(
    usageCliRequestsOk(usageCliServerRequests) &&
      usageCliOutput.includes('"upgradePrompt"') &&
      usageCliOutput.includes('"suggestedPlan": "plus"'),
    'woa usage CLI 调用远程 /api/v1/tenants/:tenantId/usage 并输出升级提示',
  );
} finally {
  await new Promise(resolve => usageCliServer.close(resolve));
}

console.log('\n=== Stripe billing fixture 验证 ===');

const stripeCheckoutStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
const stripeCheckoutCalls = [];
const stripeBilling = createStripeCheckoutService({
  secretKey: 'sk_test_fixture',
  priceIds: {
    plus: 'price_plus_fixture',
    pro: 'price_pro_fixture',
  },
  usageStore: stripeCheckoutStore,
  defaultSuccessUrl: 'https://app.example.test/billing/success',
  defaultCancelUrl: 'https://app.example.test/billing/cancel',
  fetch: async (input, init = {}) => {
    const bodyText = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? '');
    stripeCheckoutCalls.push({
      url: String(input),
      method: init.method,
      authorization: new Headers(init.headers).get('authorization'),
      bodyText,
    });
    return new Response(JSON.stringify({
      id: 'cs_test_fixture',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
      customer: 'cus_test_fixture',
      subscription: 'sub_test_fixture',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
const stripeCheckoutResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/billing/checkout`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'application/json',
      'x-woa-scopes': 'woa:tenant:read woa:billing:write',
    },
    body: JSON.stringify({ plan: 'plus' }),
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: stripeCheckoutStore,
    billing: stripeBilling,
    createApiClient: async () => {
      throw new Error('Stripe checkout must not construct WeChat api client');
    },
  },
);
const stripeCheckoutBody = await stripeCheckoutResponse.json();
check(
  stripeCheckoutResponse.status === 201 &&
    stripeCheckoutBody.data?.url === 'https://checkout.stripe.com/c/pay/cs_test_fixture' &&
    stripeCheckoutCalls[0]?.url === 'https://api.stripe.com/v1/checkout/sessions' &&
    stripeCheckoutCalls[0]?.authorization === 'Bearer sk_test_fixture' &&
    stripeCheckoutCalls[0]?.bodyText.includes('mode=subscription') &&
    stripeCheckoutCalls[0]?.bodyText.includes('line_items%5B0%5D%5Bprice%5D=price_plus_fixture') &&
    stripeCheckoutCalls[0]?.bodyText.includes(`metadata%5Btenant_id%5D=${DEFAULT_TENANT_ID}`) &&
    !JSON.stringify(stripeCheckoutBody).includes('sk_test_fixture'),
  'Stripe Checkout API 创建订阅 session，写入 tenant/plan metadata 且不回显 secret',
);

const stripeCheckoutMissingScopeResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/billing/checkout`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ plan: 'plus' }),
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    usageStore: stripeCheckoutStore,
    billing: stripeBilling,
    createApiClient: async () => {
      throw new Error('Stripe checkout missing-scope rejection must not construct WeChat api client');
    },
  },
);
const stripeCheckoutMissingScopeBody = await stripeCheckoutMissingScopeResponse.json();
check(
  stripeCheckoutMissingScopeResponse.status === 403 &&
    stripeCheckoutMissingScopeBody.error?.code === 'missing_scope',
  'Stripe Checkout REST route 缺少 woa:billing:write scope 时拒绝，避免伪 Bearer 默认写权限',
);

let offOriginCheckoutRejected = false;
try {
  await stripeBilling.createCheckoutSession({
    tenantId: DEFAULT_TENANT_ID,
    plan: 'plus',
    successUrl: 'https://evil.example.test/success',
  });
} catch (error) {
  offOriginCheckoutRejected = error?.code === 'stripe_checkout_url_forbidden';
}
let insecureCheckoutRejected = false;
try {
  await stripeBilling.createCheckoutSession({
    tenantId: DEFAULT_TENANT_ID,
    plan: 'plus',
    successUrl: 'http://app.example.test/billing/success',
  });
} catch (error) {
  insecureCheckoutRejected = error?.code === 'stripe_checkout_url_invalid';
}
check(
  offOriginCheckoutRejected && insecureCheckoutRejected,
  'Stripe Checkout redirect URL 只允许 HTTPS 且与配置 origin 一致',
);

const stripeWebhookSecret = 'webhook_secret_fixture';
const stripeWebhookStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
const stripeCheckoutEventPayload = JSON.stringify({
  id: 'evt_checkout_fixture',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_fixture',
      client_reference_id: DEFAULT_TENANT_ID,
      customer: 'cus_test_fixture',
      subscription: 'sub_test_fixture',
      metadata: {
        tenant_id: DEFAULT_TENANT_ID,
        plan: 'plus',
      },
    },
  },
});
const stripeCheckoutWebhookResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeCheckoutEventPayload, stripeWebhookSecret),
    },
    body: stripeCheckoutEventPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    priceIds: {
      plus: 'price_plus_fixture',
      pro: 'price_pro_fixture',
    },
  },
);
const stripeCheckoutWebhookBody = await stripeCheckoutWebhookResponse.json();
const plusEntitlement = await stripeWebhookStore.getEntitlement(DEFAULT_TENANT_ID);
check(
  stripeCheckoutWebhookResponse.status === 200 &&
    stripeCheckoutWebhookBody.handled === true &&
    plusEntitlement.plan === 'plus' &&
    plusEntitlement.status === 'active' &&
    plusEntitlement.stripeCustomerId === 'cus_test_fixture' &&
    plusEntitlement.stripeSubscriptionId === 'sub_test_fixture',
  'Stripe checkout.session.completed webhook 验签后同步 Plus entitlement 与 Stripe IDs',
);

const duplicateStripeCheckoutWebhookResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeCheckoutEventPayload, stripeWebhookSecret),
    },
    body: stripeCheckoutEventPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    priceIds: {
      plus: 'price_plus_fixture',
      pro: 'price_pro_fixture',
    },
  },
);
const duplicateStripeCheckoutWebhookBody = await duplicateStripeCheckoutWebhookResponse.json();
check(
  duplicateStripeCheckoutWebhookResponse.status === 200 &&
    duplicateStripeCheckoutWebhookBody.duplicate === true &&
    duplicateStripeCheckoutWebhookBody.reason === 'duplicate_stripe_event',
  'Stripe webhook 重复 event.id 幂等忽略',
);

await stripeWebhookStore.upsertEntitlement({
  tenantId: DEFAULT_TENANT_ID,
  plan: 'pro',
  status: 'active',
  stripeCustomerId: 'cus_test_fixture',
  stripeSubscriptionId: 'sub_new_fixture',
});
const stripeStaleCheckoutPayload = JSON.stringify({
  id: 'evt_checkout_stale_fixture',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_stale_fixture',
      client_reference_id: DEFAULT_TENANT_ID,
      customer: 'cus_test_fixture',
      subscription: 'sub_old_fixture',
      metadata: {
        tenant_id: DEFAULT_TENANT_ID,
        plan: 'plus',
      },
    },
  },
});
const stripeStaleCheckoutResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeStaleCheckoutPayload, stripeWebhookSecret),
    },
    body: stripeStaleCheckoutPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    priceIds: {
      plus: 'price_plus_fixture',
      pro: 'price_pro_fixture',
    },
  },
);
const staleCheckoutEntitlement = await stripeWebhookStore.getEntitlement(DEFAULT_TENANT_ID);
const staleCheckoutBody = await stripeStaleCheckoutResponse.json();
check(
  stripeStaleCheckoutResponse.status === 200 &&
    staleCheckoutBody.stale === true &&
    staleCheckoutEntitlement.plan === 'pro' &&
    staleCheckoutEntitlement.stripeSubscriptionId === 'sub_new_fixture',
  'Stripe 旧 checkout.session.completed 事件不会覆盖当前新订阅',
);

const stripeStaleSubscriptionDeletedPayload = JSON.stringify({
  id: 'evt_deleted_stale_fixture',
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: 'sub_old_fixture',
      customer: 'cus_test_fixture',
      status: 'canceled',
      metadata: {
        tenant_id: DEFAULT_TENANT_ID,
        plan: 'plus',
      },
    },
  },
});
const stripeStaleDeletedWebhookResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeStaleSubscriptionDeletedPayload, stripeWebhookSecret),
    },
    body: stripeStaleSubscriptionDeletedPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    priceIds: {
      plus: 'price_plus_fixture',
      pro: 'price_pro_fixture',
    },
  },
);
const staleEntitlement = await stripeWebhookStore.getEntitlement(DEFAULT_TENANT_ID);
const staleDeletedBody = await stripeStaleDeletedWebhookResponse.json();
check(
  stripeStaleDeletedWebhookResponse.status === 200 &&
    staleDeletedBody.stale === true &&
    staleEntitlement.plan === 'pro' &&
    staleEntitlement.stripeSubscriptionId === 'sub_new_fixture',
  'Stripe 旧 subscription.deleted 事件不会降级当前新订阅',
);

await stripeWebhookStore.upsertEntitlement({
  tenantId: DEFAULT_TENANT_ID,
  plan: 'pro',
  status: 'active',
  stripeCustomerId: 'cus_test_fixture',
  stripeSubscriptionId: null,
});
const stripeMissingCurrentSubscriptionDeletedPayload = JSON.stringify({
  id: 'evt_deleted_missing_current_fixture',
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: 'sub_unknown_fixture',
      customer: 'cus_test_fixture',
      status: 'canceled',
      metadata: {
        tenant_id: DEFAULT_TENANT_ID,
        plan: 'pro',
      },
    },
  },
});
const stripeMissingCurrentDeletedWebhookResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeMissingCurrentSubscriptionDeletedPayload, stripeWebhookSecret),
    },
    body: stripeMissingCurrentSubscriptionDeletedPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    priceIds: {
      plus: 'price_plus_fixture',
      pro: 'price_pro_fixture',
    },
  },
);
const missingCurrentDeletedBody = await stripeMissingCurrentDeletedWebhookResponse.json();
const missingCurrentEntitlement = await stripeWebhookStore.getEntitlement(DEFAULT_TENANT_ID);
check(
  stripeMissingCurrentDeletedWebhookResponse.status === 200 &&
    missingCurrentDeletedBody.stale === true &&
    missingCurrentEntitlement.plan === 'pro' &&
    missingCurrentEntitlement.stripeSubscriptionId === null,
  'Stripe subscription.deleted 在当前 entitlement 无 subscriptionId 时不会降级 paid 计划',
);

await stripeWebhookStore.upsertEntitlement({
  tenantId: DEFAULT_TENANT_ID,
  plan: 'pro',
  status: 'active',
  stripeCustomerId: 'cus_test_fixture',
  stripeSubscriptionId: 'sub_new_fixture',
});

class FailingOnceUsageStore extends D1UsageQuotaStore {
  failed = false;

  async upsertEntitlement(input) {
    if (!this.failed) {
      this.failed = true;
      throw new Error('fixture transient entitlement failure');
    }
    return await super.upsertEntitlement(input);
  }
}

const retryAfterFailureStore = new FailingOnceUsageStore(new MemoryUsageD1Database());
const retryAfterFailurePayload = JSON.stringify({
  id: 'evt_retry_after_failure_fixture',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_retry_fixture',
      client_reference_id: 'tenant_retry_fixture',
      customer: 'cus_retry_fixture',
      subscription: 'sub_retry_fixture',
      metadata: {
        tenant_id: 'tenant_retry_fixture',
        plan: 'plus',
      },
    },
  },
});
let retryFirstAttemptFailed = false;
try {
  await handleStripeWebhookRequest(
    new Request('https://worker.example.test/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': stripeSignatureHeader(retryAfterFailurePayload, stripeWebhookSecret),
      },
      body: retryAfterFailurePayload,
    }),
    {
      webhookSecret: stripeWebhookSecret,
      usageStore: retryAfterFailureStore,
    },
  );
} catch {
  retryFirstAttemptFailed = true;
}
const retrySecondResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(retryAfterFailurePayload, stripeWebhookSecret),
    },
    body: retryAfterFailurePayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: retryAfterFailureStore,
  },
);
const retryEntitlement = await retryAfterFailureStore.getEntitlement('tenant_retry_fixture');
check(
  retryFirstAttemptFailed &&
    retrySecondResponse.status === 200 &&
    retryEntitlement.plan === 'plus' &&
    retryEntitlement.stripeSubscriptionId === 'sub_retry_fixture',
  'Stripe entitlement 写入失败不会提前标记 event processed，重试可成功同步',
);

const stripeSubscriptionDeletedPayload = JSON.stringify({
  id: 'evt_deleted_fixture',
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: 'sub_new_fixture',
      customer: 'cus_test_fixture',
      status: 'canceled',
      metadata: {
        tenant_id: DEFAULT_TENANT_ID,
        plan: 'pro',
      },
    },
  },
});
const stripeDeletedWebhookResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeSubscriptionDeletedPayload, stripeWebhookSecret),
    },
    body: stripeSubscriptionDeletedPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    priceIds: {
      plus: 'price_plus_fixture',
      pro: 'price_pro_fixture',
    },
  },
);
const cancelledEntitlement = await stripeWebhookStore.getEntitlement(DEFAULT_TENANT_ID);
check(
  stripeDeletedWebhookResponse.status === 200 &&
    cancelledEntitlement.plan === 'free' &&
    cancelledEntitlement.status === 'cancelled',
  'Stripe customer.subscription.deleted webhook 将租户降级为 Free/cancelled',
);

const stripeInvalidSignatureResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': 't=1,v1=bad',
    },
    body: stripeCheckoutEventPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
    now: Date.now(),
  },
);
check(stripeInvalidSignatureResponse.status === 400, 'Stripe webhook 签名错误时拒绝处理');

const stripeInvalidJsonPayload = 'not-json';
const stripeInvalidJsonResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(stripeInvalidJsonPayload, stripeWebhookSecret),
    },
    body: stripeInvalidJsonPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: stripeWebhookStore,
  },
);
check(stripeInvalidJsonResponse.status === 400, 'Stripe webhook 已验签但非 JSON payload 时显式拒绝');

console.log('\n=== WeChat list default fixture 验证 ===');

class CapturingWechatApiClient {
  calls = [];

  async post(path, data) {
    this.calls.push({ path, data });
    if (path === '/cgi-bin/draft/batchget') {
      return { total_count: 0, item_count: 0, item: [] };
    }
    if (path === '/cgi-bin/freepublish/batchget') {
      return { total_count: 0, item_count: 0, item: [] };
    }
    if (path === '/cgi-bin/material/batchget_material') {
      return { total_count: 0, item_count: 0, item: [] };
    }
    throw new Error(`Unexpected fixture post path: ${path}`);
  }
}

const draftListTool = mcpTools.find(tool => tool.name === 'wechat_draft');
const publishListTool = mcpTools.find(tool => tool.name === 'wechat_publish');
const permanentMediaListTool = mcpTools.find(tool => tool.name === 'wechat_permanent_media');
const draftLegacyTool = wechatTools.find(tool => tool.name === 'wechat_draft');
const publishLegacyTool = wechatTools.find(tool => tool.name === 'wechat_publish');
const listDefaultApiClient = new CapturingWechatApiClient();

check(
  draftListTool.inputSchema.count.parse(undefined) === 20 &&
    draftListTool.inputSchema.no_content.parse(undefined) === 1 &&
    publishListTool.inputSchema.count.parse(undefined) === 20 &&
    publishListTool.inputSchema.no_content.parse(undefined) === 1 &&
    permanentMediaListTool.inputSchema.count.parse(undefined) === 20,
  'MCP Zod schema 机器可见默认值对齐官方上限与 no_content=1',
);
check(
  draftLegacyTool.inputSchema.properties.count.default === 20 &&
    draftLegacyTool.inputSchema.properties.no_content.default === 1 &&
    publishLegacyTool.inputSchema.properties.count.default === 20 &&
    publishLegacyTool.inputSchema.properties.no_content.default === 1,
  'legacy wechatTools JSON schema 暴露 list 默认 count/no_content',
);

await draftListTool.handler({ action: 'list' }, listDefaultApiClient);
await publishListTool.handler({ action: 'list' }, listDefaultApiClient);
await permanentMediaListTool.handler({ action: 'list', type: 'image' }, listDefaultApiClient);

check(
  JSON.stringify(listDefaultApiClient.calls[0]?.data) === JSON.stringify({ offset: 0, count: 20, no_content: 1 }),
  'wechat_draft list 默认使用官方上限 count=20 且 no_content=1',
);
check(
  JSON.stringify(listDefaultApiClient.calls[1]?.data) === JSON.stringify({ offset: 0, count: 20, no_content: 1 }),
  'wechat_publish list 默认使用官方上限 count=20 且 no_content=1',
);
check(
  JSON.stringify(listDefaultApiClient.calls[2]?.data) === JSON.stringify({ type: 'image', offset: 0, count: 20 }),
  'wechat_permanent_media list 默认使用官方上限 count=20',
);

const listOverrideApiClient = new CapturingWechatApiClient();
await draftListTool.handler({ action: 'list', count: 5, noContent: 0 }, listOverrideApiClient);
await publishListTool.handler({ action: 'list', count: 6, no_content: 0 }, listOverrideApiClient);
await permanentMediaListTool.handler({ action: 'list', type: 'image', count: 7 }, listOverrideApiClient);
await draftListTool.handler({ action: 'list', count: 8, no_content: 0 }, listOverrideApiClient);
await publishListTool.handler({ action: 'list', count: 9, noContent: 0 }, listOverrideApiClient);

check(
  JSON.stringify(listOverrideApiClient.calls[0]?.data) === JSON.stringify({ offset: 0, count: 5, no_content: 0 }),
  'wechat_draft list 支持显式 noContent=0 获取正文',
);
check(
  JSON.stringify(listOverrideApiClient.calls[1]?.data) === JSON.stringify({ offset: 0, count: 6, no_content: 0 }),
  'wechat_publish list 支持官方 no_content=0 别名获取正文',
);
check(
  JSON.stringify(listOverrideApiClient.calls[2]?.data) === JSON.stringify({ type: 'image', offset: 0, count: 7 }),
  'wechat_permanent_media list 支持显式 count 覆盖',
);
check(
  JSON.stringify(listOverrideApiClient.calls[3]?.data) === JSON.stringify({ offset: 0, count: 8, no_content: 0 }),
  'wechat_draft list 支持官方 no_content=0 别名获取正文',
);
check(
  JSON.stringify(listOverrideApiClient.calls[4]?.data) === JSON.stringify({ offset: 0, count: 9, no_content: 0 }),
  'wechat_publish list 支持显式 noContent=0 获取正文',
);

console.log('\n=== D1 Storage fixture 验证 ===');

class MemoryD1Database {
  config = null;
  accessTokens = [];
  media = new Map();
  tenants = new Map();
  users = new Map();
  memberships = [];
  accounts = new Map();
  accountTokens = new Map();
  accountMedia = new Map();

  prepare(query) {
    return new MemoryD1Statement(this, query);
  }
}

class MemoryD1Statement {
  values = [];

  constructor(db, query) {
    this.db = db;
    this.query = query.replace(/\s+/g, ' ').trim();
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    const q = this.query;

    if (q.startsWith('INSERT OR REPLACE INTO config')) {
      const [appId, appSecret, token, encodingAESKey, createdAt, updatedAt] = this.values;
      this.db.config = {
        id: 1,
        app_id: appId,
        app_secret: appSecret,
        token,
        encoding_aes_key: encodingAESKey,
        created_at: createdAt,
        updated_at: updatedAt,
      };
      return { success: true, meta: { changes: 1 } };
    }

    if (q === 'DELETE FROM config WHERE id = 1') {
      const changed = this.db.config ? 1 : 0;
      this.db.config = null;
      return { success: true, meta: { changes: changed } };
    }

    if (q === 'DELETE FROM access_tokens') {
      const changed = this.db.accessTokens.length;
      this.db.accessTokens = [];
      return { success: true, meta: { changes: changed } };
    }

    if (q.startsWith('INSERT INTO access_tokens')) {
      const [accessToken, expiresIn, expiresAt, createdAt] = this.values;
      this.db.accessTokens.push({
        id: this.db.accessTokens.length + 1,
        access_token: accessToken,
        expires_in: expiresIn,
        expires_at: expiresAt,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT OR REPLACE INTO media')) {
      const [mediaId, type, createdAt, url] = this.values;
      this.db.media.set(mediaId, {
        media_id: mediaId,
        type,
        created_at: createdAt,
        url,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT OR IGNORE INTO tenants')) {
      const [id, slug, name, defaultAccountId, createdAt, updatedAt] = this.values;
      if (!this.db.tenants.has(id)) {
        this.db.tenants.set(id, { id, slug, name, default_account_id: defaultAccountId, created_at: createdAt, updated_at: updatedAt });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT OR IGNORE INTO users')) {
      const [createdAt, updatedAt] = this.values;
      if (!this.db.users.has('user_default_admin')) {
        this.db.users.set('user_default_admin', { id: 'user_default_admin', display_name: 'Default Admin', created_at: createdAt, updated_at: updatedAt });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT OR IGNORE INTO tenant_memberships')) {
      const [tenantId, defaultAccountId, createdAt, updatedAt] = this.values;
      if (!this.db.memberships.some(row => row.tenant_id === tenantId && row.user_id === 'user_default_admin')) {
        this.db.memberships.push({ tenant_id: tenantId, user_id: 'user_default_admin', role: 'owner', default_account_id: defaultAccountId, created_at: createdAt, updated_at: updatedAt });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO wechat_accounts')) {
      const [accountId, tenantId, accountSlug, accountName, appId, appSecret, webhookToken, encodingAESKey, status, isDefault, createdAt, updatedAt] = this.values;
      const existing = this.db.accounts.get(accountId);
      this.db.accounts.set(accountId, {
        id: accountId,
        tenant_id: tenantId,
        slug: accountSlug,
        name: accountName,
        app_id: appId,
        app_secret: appSecret,
        webhook_token: webhookToken,
        encoding_aes_key: encodingAESKey,
        status,
        is_default: isDefault,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET app_id = NULL')) {
      const [, tenantId, accountId] = this.values;
      const account = this.db.accounts.get(accountId);
      if (account && account.tenant_id === tenantId) {
        account.app_id = null;
        account.app_secret = null;
        account.webhook_token = null;
        account.encoding_aes_key = null;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO wechat_access_tokens')) {
      const [tenantId, accountId, accessToken, expiresIn, expiresAt, createdAt, updatedAt] = this.values;
      this.db.accountTokens.set(`${tenantId}:${accountId}`, {
        tenant_id: tenantId,
        account_id: accountId,
        access_token: accessToken,
        expires_in: expiresIn,
        expires_at: expiresAt,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q === 'DELETE FROM wechat_access_tokens WHERE tenant_id = ? AND account_id = ?') {
      const [tenantId, accountId] = this.values;
      const changed = this.db.accountTokens.delete(`${tenantId}:${accountId}`) ? 1 : 0;
      return { success: true, meta: { changes: changed } };
    }

    if (q.startsWith('INSERT OR REPLACE INTO account_media')) {
      const [tenantId, accountId, mediaId, type, createdAt, url] = this.values;
      this.db.accountMedia.set(`${tenantId}:${accountId}:${mediaId}`, {
        tenant_id: tenantId,
        account_id: accountId,
        media_id: mediaId,
        type,
        created_at: createdAt,
        url,
      });
      return { success: true, meta: { changes: 1 } };
    }

    throw new Error(`Unsupported D1 run query: ${q}`);
  }

  async first() {
    const q = this.query;

    if (q === 'SELECT * FROM config WHERE id = 1') {
      return this.db.config;
    }

    if (q === 'SELECT * FROM access_tokens ORDER BY created_at DESC LIMIT 1') {
      return [...this.db.accessTokens].sort((a, b) => b.created_at - a.created_at)[0] ?? null;
    }

    if (q === 'SELECT * FROM media WHERE media_id = ?') {
      return this.db.media.get(this.values[0]) ?? null;
    }

    if (q.startsWith('SELECT a.id AS account_id')) {
      let account;
      if (this.values.length >= 2) {
        const [tenantId, accountId] = this.values;
        account = [...this.db.accounts.values()].find(row => row.tenant_id === tenantId && row.id === accountId && row.status !== 'disabled');
      } else {
        account = [...this.db.accounts.values()]
          .filter(row => row.status !== 'disabled')
          .sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(a.created_at) - Number(b.created_at))[0];
      }
      if (!account) return null;
      const tenant = this.db.tenants.get(account.tenant_id) ?? { id: account.tenant_id, slug: account.tenant_id, name: account.tenant_id };
      return {
        account_id: account.id,
        account_slug: account.slug,
        account_name: account.name,
        app_id: account.app_id,
        account_status: account.status,
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        tenant_name: tenant.name,
      };
    }

    if (q.startsWith('SELECT app_id, app_secret, webhook_token, encoding_aes_key FROM wechat_accounts')) {
      const [tenantId, accountId] = this.values;
      const account = this.db.accounts.get(accountId);
      if (!account || account.tenant_id !== tenantId || account.status === 'disabled') return null;
      return {
        app_id: account.app_id,
        app_secret: account.app_secret,
        webhook_token: account.webhook_token,
        encoding_aes_key: account.encoding_aes_key,
      };
    }

    if (q.startsWith('SELECT access_token, expires_in, expires_at FROM wechat_access_tokens')) {
      const [tenantId, accountId] = this.values;
      return this.db.accountTokens.get(`${tenantId}:${accountId}`) ?? null;
    }

    if (q.startsWith('SELECT media_id, type, created_at, url FROM account_media') && q.includes('media_id = ?')) {
      const [tenantId, accountId, mediaId] = this.values;
      return this.db.accountMedia.get(`${tenantId}:${accountId}:${mediaId}`) ?? null;
    }

    throw new Error(`Unsupported D1 first query: ${q}`);
  }

  async all() {
    const q = this.query;
    const rows = [...this.db.media.values()]
      .filter(row => q.includes('WHERE type = ?') ? row.type === this.values[0] : true)
      .sort((a, b) => b.created_at - a.created_at);

    if (q === 'SELECT * FROM media ORDER BY created_at DESC' || q === 'SELECT * FROM media WHERE type = ? ORDER BY created_at DESC') {
      return { success: true, results: rows };
    }

    if (q.startsWith('SELECT media_id, type, created_at, url FROM account_media')) {
      const [tenantId, accountId, maybeType] = this.values;
      const accountRows = [...this.db.accountMedia.values()]
        .filter(row => row.tenant_id === tenantId && row.account_id === accountId)
        .filter(row => q.includes('AND type = ?') ? row.type === maybeType : true)
        .sort((a, b) => b.created_at - a.created_at);
      return { success: true, results: accountRows };
    }

    if (q.startsWith('SELECT a.id AS account_id')) {
      const [tenantId] = this.values;
      const accountRows = [...this.db.accounts.values()]
        .filter(account => account.tenant_id === tenantId)
        .map(account => {
          const tenant = this.db.tenants.get(account.tenant_id) ?? { id: account.tenant_id, slug: account.tenant_id, name: account.tenant_id };
          return {
            account_id: account.id,
            account_slug: account.slug,
            account_name: account.name,
            app_id: account.app_id,
            app_secret: account.app_secret,
            webhook_token: account.webhook_token,
            encoding_aes_key: account.encoding_aes_key,
            account_status: account.status,
            is_default: account.is_default,
            created_at: account.created_at,
            updated_at: account.updated_at,
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
            tenant_name: tenant.name,
          };
        });
      return { success: true, results: accountRows };
    }

    throw new Error(`Unsupported D1 all query: ${q}`);
  }
}

async function exerciseStorage(storage) {
  const config = {
    appId: 'APP_ID',
    appSecret: 'APP_SECRET',
    token: 'WEBHOOK_TOKEN',
    encodingAESKey: 'ENCODING_AES_KEY',
  };
  const accessToken = {
    accessToken: 'ACCESS_TOKEN',
    expiresIn: 7200,
    expiresAt: 1893456000000,
  };
  const media = [
    { mediaId: 'MEDIA_1', type: 'image', createdAt: 2000, url: 'https://example.test/1.jpg' },
    { mediaId: 'MEDIA_2', type: 'voice', createdAt: 3000 },
  ];

  await storage.initialize();
  await storage.saveConfig(config);
  const loadedConfig = await storage.getConfig();
  await storage.saveAccessToken(accessToken);
  const loadedToken = await storage.getAccessToken();
  for (const item of media) {
    await storage.saveMedia(item);
  }
  const loadedMedia = await storage.getMedia('MEDIA_1');
  const allMedia = await storage.listMedia();
  const imageMedia = await storage.listMedia('image');
  await storage.clearAccessToken();
  const clearedToken = await storage.getAccessToken();
  await storage.clearConfig();
  const clearedConfig = await storage.getConfig();
  await storage.close();

  return {
    loadedConfig,
    loadedToken,
    loadedMedia,
    allMedia,
    imageMedia,
    clearedToken,
    clearedConfig,
  };
}

const memoryD1 = new MemoryD1Database();
const d1Storage = new D1StorageManager(memoryD1, { get: async () => 'STORAGE_SECRET' });
const d1Result = await exerciseStorage(d1Storage);

check(d1Result.loadedConfig?.appId === 'APP_ID' && d1Result.loadedConfig?.appSecret === 'APP_SECRET', 'D1StorageManager 读取并解密配置');
check(d1Result.loadedToken?.accessToken === 'ACCESS_TOKEN' && d1Result.clearedToken === null, 'D1StorageManager 保存并清空 access_token');
check(d1Result.loadedMedia?.mediaId === 'MEDIA_1' && d1Result.allMedia.length === 2 && d1Result.imageMedia.length === 1, 'D1StorageManager media CRUD 正常');
check(d1Result.clearedConfig === null && memoryD1.config === null, 'D1StorageManager clearConfig 清空配置');
check(memoryD1.accessTokens.length === 0, 'D1StorageManager clearAccessToken 清空 token');

const encryptionProbe = new MemoryD1Database();
const encryptionStorage = new D1StorageManager(encryptionProbe, 'STORAGE_SECRET');
await encryptionStorage.initialize();
await encryptionStorage.saveConfig({ appId: 'APP_ID', appSecret: 'APP_SECRET', token: 'TOKEN', encodingAESKey: 'AES_KEY' });
await encryptionStorage.saveAccessToken({ accessToken: 'ACCESS_TOKEN', expiresIn: 7200, expiresAt: 1893456000000 });
check(encryptionProbe.config?.app_secret?.startsWith('enc:'), 'D1StorageManager app_secret 使用 enc: 加密存储');
check(encryptionProbe.config?.token?.startsWith('enc:'), 'D1StorageManager webhook token 使用 enc: 加密存储');
check(encryptionProbe.config?.encoding_aes_key?.startsWith('enc:'), 'D1StorageManager encoding_aes_key 使用 enc: 加密存储');
check(encryptionProbe.accessTokens[0]?.access_token?.startsWith('enc:'), 'D1StorageManager access_token 使用 enc: 加密存储');

console.log('\n=== Multi-tenant D1 foundation fixture 验证 ===');

const migrationSql = readFileSync('./migrations/d1/0002_multi_tenant_foundation.sql', 'utf8');
const requiredMultiTenantTables = [
  'tenants',
  'users',
  'oauth_identities',
  'tenant_memberships',
  'oauth_clients',
  'wechat_accounts',
  'wechat_access_tokens',
  'audit_logs',
  'operation_jobs',
  'account_media',
  'account_permanent_media',
  'account_drafts',
  'account_publishes',
  'account_inbound_messages',
];
check(
  requiredMultiTenantTables.every(table => migrationSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)),
  '0002 additive migration 声明多租户身份、账号、token、审计、任务与账号资源表',
);
check(
  /UNIQUE\(tenant_id, slug\)/.test(migrationSql) &&
    /client_id TEXT PRIMARY KEY/.test(migrationSql) &&
    /PRIMARY KEY \(tenant_id, account_id\)/.test(migrationSql),
  '0002 migration 包含 tenant slug、OAuth client id、账号 token 唯一约束',
);
check(
  !/DROP TABLE|ALTER TABLE\s+(config|access_tokens|media|permanent_media|drafts|publishes|inbound_messages)/i.test(migrationSql),
  '0002 migration 不破坏旧单租户表，保留回滚窗口',
);
check(
  /INSERT OR IGNORE INTO wechat_accounts/.test(migrationSql) && /FROM config\s+WHERE id = 1/.test(migrationSql),
  '0002 migration 包含从旧 config row 回填默认 tenant/account 的 fixture',
);

const tenantProbe = new MemoryD1Database();
const tenantStorage = new D1StorageManager(tenantProbe, 'STORAGE_SECRET');
await tenantStorage.initialize();
await tenantStorage.saveConfig({ appId: 'APP_ID', appSecret: 'APP_SECRET', token: 'TOKEN', encodingAESKey: 'AES_KEY' });
const backfillResult = await tenantStorage.backfillDefaultTenantAndAccount();
const defaultContext = await tenantStorage.getDefaultAccountContext();
const defaultAccountConfig = await tenantStorage.getAccountConfig(defaultContext);
await tenantStorage.saveAccountAccessToken(defaultContext, { accessToken: 'ACCOUNT_TOKEN', expiresIn: 7200, expiresAt: 1893456000000 });
const loadedAccountToken = await tenantStorage.getAccountAccessToken(defaultContext);
await tenantStorage.saveAccountMedia(defaultContext, { mediaId: 'COLLIDE_MEDIA', type: 'image', createdAt: 1000 });
await tenantStorage.saveAccountConfig({
  tenantId: 'tenant_two',
  accountId: 'acct_two',
  accountSlug: 'second',
  accountName: 'Second Account',
  config: { appId: 'APP_ID_2', appSecret: 'APP_SECRET_2' },
});
const secondContext = await tenantStorage.getAccountContext('tenant_two', 'acct_two');
await tenantStorage.saveAccountMedia(secondContext, { mediaId: 'COLLIDE_MEDIA', type: 'image', createdAt: 2000 });
const defaultMedia = await tenantStorage.listAccountMedia(defaultContext);
const secondMedia = await tenantStorage.listAccountMedia(secondContext);
check(
  backfillResult.hasLegacyConfig === true &&
    defaultContext?.tenantId === DEFAULT_TENANT_ID &&
    defaultContext?.accountId === DEFAULT_ACCOUNT_ID &&
    tenantProbe.config?.app_id === 'APP_ID',
  'D1StorageManager 默认 tenant/account 回填成功且旧 config row 保持存在',
);
check(
  defaultAccountConfig?.appSecret === 'APP_SECRET' && tenantProbe.accounts.get(DEFAULT_ACCOUNT_ID)?.app_secret?.startsWith('enc:'),
  'D1StorageManager account config 读取解密且新 app_secret 使用 enc: 加密',
);
check(
  loadedAccountToken?.accessToken === 'ACCOUNT_TOKEN' && tenantProbe.accountTokens.get(`${DEFAULT_TENANT_ID}:${DEFAULT_ACCOUNT_ID}`)?.access_token?.startsWith('enc:'),
  'D1StorageManager account token 按 tenant/account 保存并加密',
);
check(
  defaultMedia.length === 1 && secondMedia.length === 1 && defaultMedia[0].createdAt !== secondMedia[0].createdAt,
  'D1StorageManager account_media 支持跨账号 media_id 碰撞隔离',
);
check(
  tenantStorage.namespaceR2Key(defaultContext, '/uploads/a.png') === `tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/uploads/a.png`,
  'D1StorageManager R2 key 按 tenant/account 命名空间隔离',
);

console.log('\n=== WeChat webhook / inbox fixture 验证 ===');

class MemoryInboxStore {
  records = [];
  nextId = 1;

  async insertMessage(message) {
    if (this.records.some(record => record.dedupKey === message.dedupKey)) {
      return { inserted: false };
    }
    this.records.push({
      id: this.nextId++,
      tenantId: message.tenantId ?? null,
      accountId: message.accountId ?? null,
      dedupKey: message.dedupKey,
      toUserName: message.toUserName,
      fromUserName: message.fromUserName,
      type: message.type,
      eventType: message.eventType ?? null,
      rawXml: message.rawXml,
      parsedPayload: message.parsedPayload,
      createTime: message.createTime,
      receivedAt: message.receivedAt,
      processedAt: null,
      processingNote: null,
    });
    return { inserted: true };
  }

  async listMessages(options = {}) {
    let items = [...this.records];
    if (options.pendingOnly) items = items.filter(item => item.processedAt === null);
    if (options.tenantId) items = items.filter(item => item.tenantId === options.tenantId);
    if (options.accountId) items = items.filter(item => item.accountId === options.accountId);
    if (options.type) items = items.filter(item => item.type === options.type);
    if (options.openid) items = items.filter(item => item.fromUserName === options.openid);
    items.sort((a, b) => b.receivedAt - a.receivedAt || b.id - a.id);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = Math.max(0, options.offset ?? 0);
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  }

  async getMessage(id) {
    return this.records.find(record => record.id === id) ?? null;
  }

  async markProcessed({ ids, note, processedAt = Date.now() }) {
    let updated = 0;
    for (const record of this.records) {
      if (ids.includes(record.id)) {
        record.processedAt = processedAt;
        record.processingNote = note ?? null;
        updated += 1;
      }
    }
    return updated;
  }
}

const webhookToken = 'WEBHOOK_TOKEN';
const timestamp = '1710000000';
const nonce = 'nonce-fixture';
const plaintextXml = '<xml>' +
  '<ToUserName><![CDATA[gh_test]]></ToUserName>' +
  '<FromUserName><![CDATA[openid_1]]></FromUserName>' +
  '<CreateTime>1710000000</CreateTime>' +
  '<MsgType><![CDATA[text]]></MsgType>' +
  '<Content><![CDATA[hello]]></Content>' +
  '<MsgId>1234567890</MsgId>' +
  '</xml>';
const validSignature = createWechatSignature([webhookToken, timestamp, nonce]);
const webhookStore = new MemoryInboxStore();
const startedAt = Date.now();
const validWebhookResponse = await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback?signature=${validSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: plaintextXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    inboxStore: webhookStore,
    now: () => 1710000000123,
  },
);
const validWebhookBody = await validWebhookResponse.text();
check(validWebhookResponse.status === 200 && validWebhookBody === 'success', 'Webhook 明文签名通过后返回 success');
check(Date.now() - startedAt < 5000, 'Webhook 明文持久化并在 5s 内 ack');
check(webhookStore.records.length === 1 && webhookStore.records[0]?.dedupKey === '1234567890', 'Webhook 使用 MsgId 去重并写入 pending 消息');

const invalidWebhookResponse = await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback?signature=bad&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: plaintextXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    inboxStore: webhookStore,
  },
);
check(invalidWebhookResponse.status === 403 && webhookStore.records.length === 1, 'Webhook 无效明文签名返回 403 且不入库');

const oversizedWebhookStore = new MemoryInboxStore();
const oversizedWebhookResponse = await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback?signature=${validSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    headers: { 'content-length': '64' },
    body: 'x'.repeat(64),
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    inboxStore: oversizedWebhookStore,
    maxBodyBytes: 32,
  },
);
check(oversizedWebhookResponse.status === 413 && oversizedWebhookStore.records.length === 0, 'Webhook 在读取前按 content-length 拒绝超限请求');

const oversizedWebhookStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('x'.repeat(20)));
    controller.enqueue(new TextEncoder().encode('x'.repeat(20)));
    controller.close();
  },
});
const oversizedWebhookStreamResponse = await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback?signature=${validSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: oversizedWebhookStream,
    duplex: 'half',
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    inboxStore: oversizedWebhookStore,
    maxBodyBytes: 32,
  },
);
check(oversizedWebhookStreamResponse.status === 413 && oversizedWebhookStore.records.length === 0, 'Webhook 流式读取超过上限时拒绝且不入库');

await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback?signature=${validSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: plaintextXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    inboxStore: webhookStore,
    now: () => 1710000000999,
  },
);
check(webhookStore.records.length === 1, 'Webhook 重试同一 MsgId 时保持幂等去重');

const scopedWebhookStore = new MemoryInboxStore();
await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback/account_A?signature=${validSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: plaintextXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    tenantId: 'tenant_1',
    accountId: 'account_A',
    inboxStore: scopedWebhookStore,
  },
);
await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback/account_B?signature=${validSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: plaintextXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    tenantId: 'tenant_1',
    accountId: 'account_B',
    inboxStore: scopedWebhookStore,
  },
);
check(
  scopedWebhookStore.records.length === 2 &&
    scopedWebhookStore.records[0]?.dedupKey === createInboundDedupKey({ MsgId: '1234567890' }, { tenantId: 'tenant_1', accountId: 'account_A' }) &&
    scopedWebhookStore.records[1]?.dedupKey === createInboundDedupKey({ MsgId: '1234567890' }, { tenantId: 'tenant_1', accountId: 'account_B' }),
  'Webhook 按 accountId 生成去重键，同一 MsgId 在不同账号下互不抑制',
);

const encodingAESKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64').replace(/=/g, '');
const eventXml = '<xml>' +
  '<ToUserName><![CDATA[gh_test]]></ToUserName>' +
  '<FromUserName><![CDATA[openid_2]]></FromUserName>' +
  '<CreateTime>1710000100</CreateTime>' +
  '<MsgType><![CDATA[event]]></MsgType>' +
  '<Event><![CDATA[subscribe]]></Event>' +
  '<EventKey><![CDATA[]]></EventKey>' +
  '</xml>';
const encryptedPayload = encryptWechatMessageForFixture(eventXml, 'wx1234567890abcdef', encodingAESKey);
const encryptedSignature = createWechatSignature([webhookToken, timestamp, nonce, encryptedPayload]);
const encryptedXml = `<xml><ToUserName><![CDATA[gh_test]]></ToUserName><Encrypt><![CDATA[${encryptedPayload}]]></Encrypt></xml>`;
const decryptedXml = decryptWechatMessage(encryptedPayload, encodingAESKey, 'wx1234567890abcdef');
const encryptedStore = new MemoryInboxStore();
const encryptedResponse = await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback?encrypt_type=aes&msg_signature=${encryptedSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: encryptedXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    encodingAESKey,
    inboxStore: encryptedStore,
    now: () => 1710000100123,
  },
);
check(decryptedXml === eventXml, 'Webhook AES-CBC-256/PKCS#7 解密并校验 appid');
check(encryptedResponse.status === 200 && encryptedStore.records[0]?.eventType === 'subscribe', 'Webhook 加密消息验签解密后入库 event');

const mismatchedEncryptedPayload = encryptWechatMessageForFixture(eventXml, 'wx_other_appid', encodingAESKey);
const mismatchedEncryptedSignature = createWechatSignature([webhookToken, timestamp, nonce, mismatchedEncryptedPayload]);
const mismatchedEncryptedXml = `<xml><ToUserName><![CDATA[gh_test]]></ToUserName><Encrypt><![CDATA[${mismatchedEncryptedPayload}]]></Encrypt></xml>`;
const mismatchedEncryptedStore = new MemoryInboxStore();
const mismatchedEncryptedResponse = await handleWechatWebhook(
  new Request(`https://worker.test/wx/callback/account_A?encrypt_type=aes&msg_signature=${mismatchedEncryptedSignature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: 'POST',
    body: mismatchedEncryptedXml,
  }),
  {
    token: webhookToken,
    appId: 'wx1234567890abcdef',
    encodingAESKey,
    tenantId: 'tenant_1',
    accountId: 'account_A',
    inboxStore: mismatchedEncryptedStore,
  },
);
check(
  mismatchedEncryptedResponse.status === 403 && mismatchedEncryptedStore.records.length === 0,
  'Webhook 加密消息 appid 不匹配时返回 403 且不入库',
);

class MemoryInboxD1Database {
  rows = [];
  auditRows = [];
  nextId = 1;

  prepare(query) {
    return new MemoryInboxD1Statement(this, query);
  }

  async exec() {
    return {};
  }
}

class MemoryInboxD1Statement {
  values = [];

  constructor(db, query) {
    this.db = db;
    this.query = query.replace(/\s+/g, ' ').trim();
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.query.startsWith('INSERT OR IGNORE INTO inbound_messages')) {
      const [
        tenantId,
        accountId,
        dedupKey,
        toUserName,
        fromUserName,
        type,
        eventType,
        rawXml,
        parsedPayloadJson,
        createTime,
        receivedAt,
      ] = this.values;
      if (this.db.rows.some(row => row.dedup_key === dedupKey)) {
        return { success: true, meta: { changes: 0 } };
      }
      this.db.rows.push({
        id: this.db.nextId++,
        tenant_id: tenantId,
        account_id: accountId,
        dedup_key: dedupKey,
        to_user_name: toUserName,
        from_user_name: fromUserName,
        type,
        event_type: eventType,
        raw_xml: rawXml,
        parsed_payload_json: parsedPayloadJson,
        create_time: createTime,
        received_at: receivedAt,
        processed_at: null,
        processing_note: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.query.startsWith('INSERT INTO audit_logs')) {
      const [
        userId,
        oauthClientId,
        tenantId,
        accountId,
        action,
        targetType,
        targetId,
        requestId,
        metadataJson,
        occurredAt,
      ] = this.values;
      this.db.auditRows.push({
        id: this.db.auditRows.length + 1,
        user_id: userId,
        oauth_client_id: oauthClientId,
        tenant_id: tenantId,
        account_id: accountId,
        action,
        target_type: targetType,
        target_id: targetId,
        request_id: requestId,
        metadata_json: metadataJson,
        occurred_at: occurredAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.query.startsWith('UPDATE inbound_messages SET processed_at = ?')) {
      const [processedAt, note] = this.values;
      const scopeValueCount = this.scopeValueCount();
      const ids = this.values.slice(2, this.values.length - scopeValueCount);
      const scopeValues = this.values.slice(this.values.length - scopeValueCount);
      let scopeIndex = 0;
      const tenantId = this.query.includes('tenant_id = ?') ? scopeValues[scopeIndex++] : undefined;
      const accountId = this.query.includes('account_id = ?') ? scopeValues[scopeIndex++] : undefined;
      let changes = 0;
      for (const row of this.db.rows) {
        if (
          ids.includes(row.id) &&
          (tenantId === undefined || row.tenant_id === tenantId) &&
          (accountId === undefined || row.account_id === accountId)
        ) {
          row.processed_at = processedAt;
          row.processing_note = note;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    return { success: true, meta: { changes: 0 } };
  }

  async first() {
    if (this.query.startsWith('SELECT COUNT(*) AS total FROM inbound_messages')) {
      return { total: this.filterRows().length };
    }

    if (this.query === 'SELECT * FROM inbound_messages WHERE id = ? LIMIT 1') {
      return this.db.rows.find(row => row.id === this.values[0]) ?? null;
    }

    throw new Error(`Unsupported inbox first query: ${this.query}`);
  }

  async all() {
    if (this.query.startsWith('SELECT * FROM inbound_messages')) {
      const filterValueCount = this.filterValueCount();
      const limit = this.values[filterValueCount];
      const offset = this.values[filterValueCount + 1];
      const rows = this.filterRows()
        .sort((a, b) => b.received_at - a.received_at || b.id - a.id)
        .slice(offset, offset + limit);
      return { success: true, results: rows };
    }

    throw new Error(`Unsupported inbox all query: ${this.query}`);
  }

  filterRows() {
    let index = 0;
    let rows = [...this.db.rows];
    if (this.query.includes('processed_at IS NULL')) {
      rows = rows.filter(row => row.processed_at === null);
    }
    if (this.query.includes('tenant_id = ?')) {
      const tenantId = this.values[index++];
      rows = rows.filter(row => row.tenant_id === tenantId);
    }
    if (this.query.includes('account_id = ?')) {
      const accountId = this.values[index++];
      rows = rows.filter(row => row.account_id === accountId);
    }
    if (this.query.includes('type = ?')) {
      const type = this.values[index++];
      rows = rows.filter(row => row.type === type);
    }
    if (this.query.includes('from_user_name = ?')) {
      const openid = this.values[index++];
      rows = rows.filter(row => row.from_user_name === openid);
    }
    return rows;
  }

  filterValueCount() {
    let count = 0;
    if (this.query.includes('tenant_id = ?')) count += 1;
    if (this.query.includes('account_id = ?')) count += 1;
    if (this.query.includes('type = ?')) count += 1;
    if (this.query.includes('from_user_name = ?')) count += 1;
    return count;
  }

  scopeValueCount() {
    let count = 0;
    if (this.query.includes('tenant_id = ?')) count += 1;
    if (this.query.includes('account_id = ?')) count += 1;
    return count;
  }
}

const inboxD1 = new MemoryInboxD1Database();
const d1InboxStore = new D1InboxStore(inboxD1);
await d1InboxStore.insertMessage({
  dedupKey: 'D1_MSG_1',
  toUserName: 'gh_test',
  fromUserName: 'openid_1',
  type: 'text',
  eventType: null,
  rawXml: plaintextXml,
  parsedPayload: { MsgType: 'text', Content: 'hello' },
  createTime: 1710000000,
  receivedAt: 1710000000123,
});
await d1InboxStore.insertMessage({
  dedupKey: 'D1_EVT_1',
  toUserName: 'gh_test',
  fromUserName: 'openid_2',
  type: 'event',
  eventType: 'subscribe',
  rawXml: eventXml,
  parsedPayload: { MsgType: 'event', Event: 'subscribe' },
  createTime: 1710000100,
  receivedAt: 1710000100123,
});
await d1InboxStore.insertMessage({
  dedupKey: 'D1_MSG_1',
  toUserName: 'gh_test',
  fromUserName: 'openid_1',
  type: 'text',
  eventType: null,
  rawXml: plaintextXml,
  parsedPayload: { MsgType: 'text', Content: 'hello' },
  createTime: 1710000000,
  receivedAt: 1710000000999,
});
await d1InboxStore.insertMessage({
  tenantId: 'tenant_1',
  accountId: 'account_A',
  dedupKey: createInboundDedupKey({ MsgId: 'D1_SHARED' }, { tenantId: 'tenant_1', accountId: 'account_A' }),
  toUserName: 'gh_test_a',
  fromUserName: 'openid_shared',
  type: 'text',
  eventType: null,
  rawXml: plaintextXml,
  parsedPayload: { MsgType: 'text', Content: 'hello A' },
  createTime: 1710000300,
  receivedAt: 1710000300123,
});
await d1InboxStore.insertMessage({
  tenantId: 'tenant_1',
  accountId: 'account_B',
  dedupKey: createInboundDedupKey({ MsgId: 'D1_SHARED' }, { tenantId: 'tenant_1', accountId: 'account_B' }),
  toUserName: 'gh_test_b',
  fromUserName: 'openid_shared',
  type: 'text',
  eventType: null,
  rawXml: plaintextXml,
  parsedPayload: { MsgType: 'text', Content: 'hello B' },
  createTime: 1710000300,
  receivedAt: 1710000300456,
});
const textList = await d1InboxStore.listMessages({ pendingOnly: true, type: 'text', openid: 'openid_1' });
const markCount = await d1InboxStore.markProcessed({ ids: [1], note: 'done', processedAt: 1710000200000 });
const pendingAfterMark = await d1InboxStore.listMessages({ pendingOnly: true });
const accountAList = await d1InboxStore.listMessages({ tenantId: 'tenant_1', accountId: 'account_A', pendingOnly: true });
const accountBMarkAttempt = await d1InboxStore.markProcessed({
  ids: [accountAList.items[0].id],
  tenantId: 'tenant_1',
  accountId: 'account_B',
  note: 'wrong account',
});
check(inboxD1.rows.length === 4 && textList.total === 1, 'D1InboxStore 入库去重并支持 type/openid/pending 过滤');
check(markCount === 1 && pendingAfterMark.total === 3, 'D1InboxStore mark_processed 更新 processed_at');
check(
  inboxD1.rows.length === 4 &&
    accountAList.total === 1 &&
    accountAList.items[0]?.accountId === 'account_A' &&
    accountBMarkAttempt === 0,
  'D1InboxStore 支持 accountId/tenantId 过滤且跨账号 mark_processed 不会误更新',
);

const auditWriter = new D1AuditLogWriter(inboxD1);
await auditWriter.write({
  userId: 'user_1',
  oauthClientId: 'client_1',
  tenantId: 'tenant_1',
  accountId: 'account_A',
  action: 'account.configure',
  targetType: 'wechat_account',
  targetId: 'account_A',
  metadata: {
    appSecret: 'SUPERSECRET_APP_SECRET',
    nested: { accessToken: 'ACCESS_TOKEN_SHOULD_NOT_APPEAR' },
    safeValue: 'kept',
  },
  occurredAt: 1710000400000,
});
const auditMetadata = JSON.parse(inboxD1.auditRows[0]?.metadata_json ?? '{}');
const directSanitizedMetadata = sanitizeAuditMetadata({ encodingAESKey: 'ENCODING_AES_KEY_SECRET', label: 'safe' });
let missingConfirmationRejected = false;
try {
  requireConfirmationMarker('wechat_publish.submit', undefined);
} catch {
  missingConfirmationRejected = true;
}
check(
  auditMetadata.appSecret !== 'SUPERSECRET_APP_SECRET' &&
    auditMetadata.nested?.accessToken !== 'ACCESS_TOKEN_SHOULD_NOT_APPEAR' &&
    auditMetadata.safeValue === 'kept' &&
    directSanitizedMetadata.label === 'safe',
  'AuditLogWriter/sanitizeAuditMetadata 写入审计元数据时脱敏 secret/token 字段',
);
check(missingConfirmationRejected, '高风险操作 confirmation marker 缺失时会被 guardrail 拒绝');

const inboxToolList = await inboxMcpTool.handler({
  action: 'list_pending',
  type: 'event',
}, {
  getInboxStore: () => d1InboxStore,
});
const inboxToolMark = await inboxMcpTool.handler({
  action: 'mark_processed',
  ids: [2],
  note: 'handled by test',
}, {
  getInboxStore: () => d1InboxStore,
});
const inboxToolTooManyIds = await inboxMcpTool.handler({
  action: 'mark_processed',
  ids: Array.from({ length: 101 }, (_, index) => index + 1),
}, {
  getInboxStore: () => d1InboxStore,
});
let d1TooManyIdsRejected = false;
try {
  await d1InboxStore.markProcessed({ ids: Array.from({ length: 101 }, (_, index) => index + 1) });
} catch {
  d1TooManyIdsRejected = true;
}
check(inboxToolList.content[0]?.text?.includes('event/subscribe'), 'wechat_inbox list_pending 返回过滤后的事件消息');
check(inboxToolMark.content[0]?.text?.includes('已标记处理完成：1 条'), 'wechat_inbox mark_processed 支持批量标记');
check(inboxToolTooManyIds.isError === true && d1TooManyIdsRejected, 'wechat_inbox 和 D1InboxStore 限制批量 mark_processed ID 数量');

console.log('\n=== Workers media size guard 验证 ===');

const workerMediaTools = createWorkerMediaTools();
const workerUploadImgTool = workerMediaTools.find(tool => tool.name === 'wechat_upload_img');
const rejectingMediaApiClient = {
  async postForm() {
    throw new Error('postForm should not be called when media exceeds pre-upload limits');
  },
};

const oversizedFileDataResult = await workerUploadImgTool.handler({
  fileData: 'A'.repeat(2 * 1024 * 1024),
  fileName: 'oversized.jpg',
  mimeType: 'image/jpeg',
}, rejectingMediaApiClient);
check(
  oversizedFileDataResult.isError === true &&
    oversizedFileDataResult.content[0]?.text?.includes('fileData base64 payload 超过上传大小限制'),
  'Workers fileData 上传在 base64 解码前按大小上限拒绝',
);

const httpFileUrlResult = await workerUploadImgTool.handler({
  fileUrl: 'http://example.test/plaintext.jpg',
}, rejectingMediaApiClient);
check(
  httpFileUrlResult.isError === true &&
    httpFileUrlResult.content[0]?.text?.includes('fileUrl 仅支持 HTTPS URL'),
  'Workers fileUrl 拒绝明文 HTTP URL',
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(null, {
  status: 302,
  headers: { location: 'http://example.test/plaintext-redirect.jpg' },
});
try {
  const redirectedFileUrlResult = await workerUploadImgTool.handler({
    fileUrl: 'https://example.test/redirect.jpg',
  }, rejectingMediaApiClient);
  check(
    redirectedFileUrlResult.isError === true &&
      redirectedFileUrlResult.content[0]?.text?.includes('fileUrl 重定向目标必须保持 HTTPS'),
    'Workers fileUrl 拒绝 HTTPS 到 HTTP 的重定向降级',
  );
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(700 * 1024));
    controller.enqueue(new Uint8Array(700 * 1024));
    controller.close();
  },
}), {
  status: 200,
  headers: { 'content-type': 'image/jpeg' },
});
try {
  const oversizedFileUrlResult = await workerUploadImgTool.handler({
    fileUrl: 'https://example.test/oversized.jpg',
  }, rejectingMediaApiClient);
  check(
    oversizedFileUrlResult.isError === true &&
      oversizedFileUrlResult.content[0]?.text?.includes('fileUrl stream 超过上传大小限制'),
    'Workers fileUrl 上传在流式读取超过上限时拒绝且不调用微信 API',
  );
} finally {
  globalThis.fetch = originalFetch;
}

if (failed) {
  process.exit(1);
}

function encryptWechatMessageForFixture(innerXml, appId, encodingAESKey) {
  const padded = `${encodingAESKey}${'='.repeat((4 - (encodingAESKey.length % 4)) % 4)}`;
  const key = CryptoJS.enc.Base64.parse(padded);
  const iv = CryptoJS.lib.WordArray.create(key.words.slice(0, 4), 16);
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(innerXml);
  const appIdBytes = encoder.encode(appId);
  const bytes = new Uint8Array(16 + 4 + messageBytes.length + appIdBytes.length);
  bytes.set(Uint8Array.from({ length: 16 }, (_, index) => index + 65), 0);
  new DataView(bytes.buffer).setUint32(16, messageBytes.length, false);
  bytes.set(messageBytes, 20);
  bytes.set(appIdBytes, 20 + messageBytes.length);
  const encrypted = CryptoJS.AES.encrypt(uint8ArrayToWordArray(bytes), key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
}

function uint8ArrayToWordArray(bytes) {
  const words = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

console.log('\n=== 日志输出通道验证 ===');
const originalLog = console.log;
const originalError = console.error;
const stdoutLogs = [];
const stderrLogs = [];

try {
  console.log = (...args) => {
    stdoutLogs.push(args);
  };
  console.error = (...args) => {
    stderrLogs.push(args);
  };

  logger.info('logger stderr channel smoke test');
} finally {
  console.log = originalLog;
  console.error = originalError;
}

assert(stdoutLogs.length === 0, 'logger 不应向 stdout 写日志，避免污染 MCP HTTP/协议响应');
assert(stderrLogs.length === 1, 'logger 应该向 stderr 写出一条日志');
console.log('✅ 成功！logger 日志只写入 stderr，不污染 stdout');
