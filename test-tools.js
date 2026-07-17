// 简单测试脚本验证工具注册与运行时 seam
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import CryptoJS from 'crypto-js';
import { mcpTools, wechatTools } from './dist/src/mcp-tool/tools/index.js';
import { createTenantManagementMcpTools } from './dist/src/mcp-tool/tools/tenant-management-tools.js';
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
  quotaPeriodForContext,
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
import {
  AccountAllowanceError,
  D1SaasOnboardingStore,
  DuplicateAppIdError,
} from './dist/src/worker/saas-onboarding-store.js';
import { removedMcpTransportResponseForRequest } from './dist/src/worker/transport-guards.js';
import { runRetentionMaintenance } from './dist/src/worker/maintenance.js';
import {
  createGitHubAuthorizeUrl,
  exchangeGitHubOAuthCode,
  fetchGitHubOAuthProfile,
  selectVerifiedGitHubEmail,
} from './dist/src/worker/github-oauth.js';
import { renderAuthorizationConsentForm } from './dist/src/worker/oauth-consent.js';
import {
  configureAccount as configureWebAccount,
  createAccount as createWebAccount,
  deleteAccount as deleteWebAccount,
  getAccountStatus as getWebAccountStatus,
  getAccounts as getWebAccounts,
  updateAccount as updateWebAccount,
} from './dist/web/src/lib/api.js';
import { getMcpClientGuide } from './dist/web/src/lib/mcp-config.js';

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

function collectTextFiles(dir, extensions = new Set(['.html', '.js', '.css', '.map'])) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectTextFiles(path, extensions));
      continue;
    }
    const dotIndex = entry.lastIndexOf('.');
    const extension = dotIndex >= 0 ? entry.slice(dotIndex) : '';
    if (extensions.has(extension)) files.push(path);
  }
  return files;
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
check(mcpTools.length === 27, mcpTools.length === 27
  ? '成功！所有23个既有/内容工具 + 4个多租户管理工具都已正确注册为MCP工具'
  : `失败！期望27个工具，实际注册了${mcpTools.length}个工具`);

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

const webDistFiles = collectTextFiles('./web/dist');
const webDistTraeMatches = webDistFiles.flatMap(file => {
  const text = readFileSync(file, 'utf8');
  const matches = text.match(/TraeBadgePlugin|trae-badge|trae\.ai|trae-inspector/g) ?? [];
  return matches.map(match => `${file}:${match}`);
});
check(
  webDistFiles.length > 0 && webDistTraeMatches.length === 0,
  webDistTraeMatches.length === 0
    ? '生产 Web 构建不包含 Trae badge/广告链接/inspector 注入'
    : `生产 Web 构建包含 Trae 残留：${webDistTraeMatches.slice(0, 5).join(', ')}`,
);

const appLinkSource = readFileSync('./web/src/components/AppLink.tsx', 'utf8');
const loginRouteSource = readFileSync('./web/src/routes/login.tsx', 'utf8');
const routeGuardSource = readFileSync('./web/src/route-guards.ts', 'utf8');
check(
  appLinkSource.includes("href.startsWith('/auth/')") &&
    loginRouteSource.includes('/auth/github/callback?returnTo='),
  'GitHub OAuth 登录链接使用文档导航，/auth callback 会到达 Worker 而不是 SPA router',
);
const protectedWebRouteFiles = [
  './web/src/routes/index.tsx',
  './web/src/routes/onboarding.tsx',
  './web/src/routes/billing.tsx',
  './web/src/routes/billing/success.tsx',
  './web/src/routes/billing/cancel.tsx',
  './web/src/routes/mcp.tsx',
  './web/src/routes/security.tsx',
];
const publicWebRouteFiles = [
  './web/src/routes/login.tsx',
  './web/src/routes/legal/privacy.tsx',
  './web/src/routes/legal/terms.tsx',
];
check(
  protectedWebRouteFiles.every(file => {
    const source = readFileSync(file, 'utf8');
    return source.includes('requireWebSession') && source.includes('beforeLoad: requireWebSession');
  }) &&
    publicWebRouteFiles.every(file => {
      const source = readFileSync(file, 'utf8');
      return !source.includes('beforeLoad: requireWebSession');
    }) &&
    routeGuardSource.includes('getCurrentOperator') &&
    routeGuardSource.includes('/login?returnTo=') &&
    routeGuardSource.includes('error.status === 401'),
  'Web 业务页面通过 /api/v1/me 校验会话并保留 returnTo；登录与法务页面保持公开',
);

const providersSource = readFileSync('./web/src/providers.tsx', 'utf8');
const webCssEntrySource = readFileSync('./web/src/styles/index.css', 'utf8');
check(
  providersSource.includes("@astryxdesign/theme-stone/built") &&
    providersSource.includes('stoneTheme') &&
    webCssEntrySource.includes('@astryxdesign/theme-stone/theme.css') &&
    !existsSync('./web/src/ziikoo-woa.css') &&
    !existsSync('./web/src/ziikoo-woa.js'),
  'Astryx 使用官方预构建 Stone 主题 CSS/JS，避免本地主题漂移和运行时 style injection',
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
await datacubeClient.getArticleRead('2026-07-04', '2026-07-04');
await datacubeClient.getArticleShare('2026-07-04', '2026-07-04');
await datacubeClient.getBizSummary('2026-07-04', '2026-07-04');
await datacubeClient.getArticleTotalDetail('2026-07-04', '2026-07-04');
await datacubeClient.getArticleSummary('2026-07-04', '2026-07-04');
await datacubeClient.getInterfaceSummary('2026-07-04', '2026-07-04');
check(
  datacubeCalls.length === 8 &&
    datacubeCalls.every(call => call.method === 'POST') &&
    datacubeCalls.every(call => call.data?.begin_date === '2026-07-04' && call.data?.end_date === '2026-07-04') &&
    datacubeCalls.some(call => call.path === '/datacube/getusersummary') &&
    datacubeCalls.some(call => call.path === '/datacube/getarticleread') &&
    datacubeCalls.some(call => call.path === '/datacube/getarticleshare') &&
    datacubeCalls.some(call => call.path === '/datacube/getbizsummary') &&
    datacubeCalls.some(call => call.path === '/datacube/getarticletotaldetail') &&
    datacubeCalls.some(call => call.path === '/datacube/getinterfacesummary') &&
    datacubeCalls.every(call => !call.path.startsWith('/cgi-bin/datacube/')) &&
    !datacubeCalls.some(call => ['/datacube/getarticlesummary', '/datacube/getarticletotal', '/datacube/getuserread', '/datacube/getusershare'].includes(call.path)),
  'WechatApiClient datacube 使用根路径 /datacube；旧图文统计 action 已迁移到官方新版发表内容统计接口',
);

const officialPayloadCalls = [];
const officialPayloadClient = new WechatApiClient({
  getConfig: async () => null,
  setConfig: async () => undefined,
  clearConfig: async () => undefined,
  getAccessToken: async () => ({ accessToken: 'TOKEN', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
  refreshAccessToken: async () => ({ accessToken: 'TOKEN', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
  clearAccessToken: async () => undefined,
}, {
  httpExecutor: {
    get: async (path, config) => {
      officialPayloadCalls.push({ method: 'GET', path, config });
      return { data: { template_list: [{ template_id: 'TPL_ID', title: '模板', content: '内容', example: '示例' }], primary_industry: { first_class: 'IT', second_class: '互联网' }, secondary_industry: { first_class: '服务', second_class: '咨询' } }, status: 200, headers: {} };
    },
    post: async (path, data, config) => {
      officialPayloadCalls.push({ method: 'POST', path, data, config });
      if (path === '/cgi-bin/shorten/gen') return { data: { errcode: 0, errmsg: 'ok', short_key: 'SHORT_KEY' }, status: 200, headers: {} };
      if (path === '/cgi-bin/shorten/fetch') return { data: { errcode: 0, errmsg: 'ok', long_data: 'LONG_DATA', create_time: 1, expire_seconds: 2 }, status: 200, headers: {} };
      if (path === '/cgi-bin/message/template/send') return { data: { errcode: 0, errmsg: 'ok', msgid: 123 }, status: 200, headers: {} };
      if (path === '/cgi-bin/message/custom/send') return { data: { errcode: 0, errmsg: 'ok' }, status: 200, headers: {} };
      return { data: { errcode: 0, errmsg: 'ok' }, status: 200, headers: {} };
    },
    postForm: async (path, data, config) => ({ data: {}, status: 200, headers: {} }),
  },
});
await officialPayloadClient.generateShortKey('LONG_DATA', 86400);
await officialPayloadClient.fetchShortKey('SHORT_KEY');
await officialPayloadClient.sendTemplateMessage({ touser: 'OPENID', templateId: 'TPL_ID', data: { first: { value: 'hello' } } });
await officialPayloadClient.sendCustomMessage({ touser: 'OPENID', msgtype: 'image', image: { mediaId: 'MEDIA_ID' } });
const templateList = await officialPayloadClient.getAllPrivateTemplates();
const industry = await officialPayloadClient.getTemplateIndustry();
check(
  officialPayloadCalls.some(call => call.path === '/cgi-bin/shorten/gen' && call.data?.long_data === 'LONG_DATA' && call.data?.expire_seconds === 86400) &&
    officialPayloadCalls.some(call => call.path === '/cgi-bin/shorten/fetch' && call.data?.short_key === 'SHORT_KEY') &&
    officialPayloadCalls.some(call => call.path === '/cgi-bin/message/template/send' && call.data?.template_id === 'TPL_ID' && !('templateId' in call.data)) &&
    officialPayloadCalls.some(call => call.path === '/cgi-bin/message/custom/send' && call.data?.image?.media_id === 'MEDIA_ID' && !('mediaId' in call.data.image)) &&
    templateList.template_list[0]?.templateId === 'TPL_ID' &&
    industry.primary_industry.firstClass === 'IT',
  '短链、模板消息、客服消息按微信官方字段出站，并归一化官方 snake_case 返回字段',
);

const contentPublishCalls = [];
const contentPublishTool = mcpTools.find(tool => tool.name === 'wechat_content_publish');
const contentPublishResult = await contentPublishTool.handler({
  action: 'create_and_publish',
  contentType: 'image',
  title: '贴图测试',
  content: '贴图消息正文',
  imageMediaIds: ['IMAGE_MEDIA_ID'],
}, {
  post: async (path, data) => {
    contentPublishCalls.push({ path, data });
    if (path === '/cgi-bin/draft/add') return { media_id: 'DRAFT_MEDIA_ID' };
    if (path === '/cgi-bin/freepublish/submit') return { publish_id: 'PUBLISH_ID', msg_data_id: 'MSG_DATA_ID' };
    return {};
  },
});
const videoPublishResult = await contentPublishTool.handler({
  action: 'create_draft',
  contentType: 'video',
  title: '视频测试',
  content: '视频测试',
}, {
  post: async (path, data) => {
    contentPublishCalls.push({ path, data });
    return {};
  },
});
check(
  contentPublishCalls.some(call =>
    call.path === '/cgi-bin/draft/add' &&
    call.data?.articles?.[0]?.article_type === 'newspic' &&
    call.data?.articles?.[0]?.image_info?.image_list?.[0]?.image_media_id === 'IMAGE_MEDIA_ID' &&
    !('thumb_media_id' in call.data.articles[0])
  ) &&
    contentPublishCalls.some(call => call.path === '/cgi-bin/freepublish/submit' && call.data?.media_id === 'DRAFT_MEDIA_ID') &&
    contentPublishResult.content?.[0]?.text?.includes('草稿创建并提交发布成功') &&
    videoPublishResult.isError === true &&
    videoPublishResult.content?.[0]?.text?.includes('未发现视频草稿发布 API'),
  'wechat_content_publish 按官方 newspic 草稿结构发布图片消息；视频发布返回明确官方限制',
);

let diagnosticErrorMessage = '';
const diagnosticClient = new WechatApiClient({
  getConfig: async () => null,
  setConfig: async () => undefined,
  clearConfig: async () => undefined,
  getAccessToken: async () => ({ accessToken: 'TOKEN', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
  refreshAccessToken: async () => ({ accessToken: 'TOKEN', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
  clearAccessToken: async () => undefined,
}, {
  httpExecutor: {
    get: async () => ({ data: { errcode: 65400, errmsg: 'please enable new custom service' }, status: 200, headers: {} }),
    post: async () => ({ data: { errcode: 48001, errmsg: 'api unauthorized' }, status: 200, headers: {} }),
    postForm: async () => ({ data: {}, status: 200, headers: {} }),
  },
});
try {
  await diagnosticClient.createQrCode({ actionName: 'QR_SCENE', sceneId: 1 });
} catch (error) {
  diagnosticErrorMessage = error.message;
}
check(
  diagnosticErrorMessage.includes('api unauthorized') && diagnosticErrorMessage.includes('认证服务号'),
  '微信 48001/权限受限错误会返回面向运营的认证/权限诊断',
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

const stagedPngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const stagedMediaWrites = [];
const stagedMediaBucket = {
  async put(key, value, options) {
    if (!(value instanceof Uint8Array)) {
      throw new Error('R2 put() must have a known length');
    }
    const bytes = new Uint8Array(value);
    stagedMediaWrites.push({ key, bytes, options });
    return { key, size: bytes.byteLength, etag: 'fixture-etag' };
  },
};
const stagedMediaResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/media/uploads?filename=cover.png`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'image/png',
      'content-length': String(stagedPngBytes.byteLength),
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:write',
    },
    body: stagedPngBytes,
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    mediaBucket: stagedMediaBucket,
    createApiClient: async () => { throw new Error('media staging must not construct WeChat api client'); },
  },
);
const stagedMediaBody = await stagedMediaResponse.json();
check(
  stagedMediaResponse.status === 201 &&
    stagedMediaWrites.length === 1 &&
    stagedMediaWrites[0]?.key === stagedMediaBody.data?.r2Key &&
    stagedMediaWrites[0]?.key.startsWith(`staging/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/uploads/`) &&
    stagedMediaWrites[0]?.options?.httpMetadata?.contentType === 'image/png' &&
    Buffer.from(stagedMediaWrites[0]?.bytes ?? []).equals(Buffer.from(stagedPngBytes)) &&
    stagedMediaBody.data?.size === stagedPngBytes.byteLength &&
    !JSON.stringify(stagedMediaBody).includes(stagedPngBytes.toString()),
  'REST 媒体暂存接口将未知长度请求流收敛为定长字节后写入租户/账号隔离的 R2 key，响应不回显文件数据',
);

const deniedMediaWriteCount = stagedMediaWrites.length;
const deniedMediaResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/media/uploads?filename=cover.png`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'image/png',
      'x-woa-scopes': 'woa:tenant:read woa:account:read',
    },
    body: stagedPngBytes,
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    mediaBucket: stagedMediaBucket,
    createApiClient: async () => { throw new Error('denied media staging must not construct WeChat api client'); },
  },
);
check(
  deniedMediaResponse.status === 403 && stagedMediaWrites.length === deniedMediaWriteCount,
  'REST 媒体暂存接口缺少 woa:content:write 时拒绝且不写 R2',
);

const invalidMediaResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/media/uploads?filename=cover.png`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'image/png',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:write',
    },
    body: new TextEncoder().encode('not a png'),
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    mediaBucket: stagedMediaBucket,
    createApiClient: async () => { throw new Error('invalid media staging must not construct WeChat api client'); },
  },
);
check(
  invalidMediaResponse.status === 415 && stagedMediaWrites.length === deniedMediaWriteCount,
  'REST 媒体暂存接口校验 MIME 对应文件头，伪造图片不会写入 R2',
);

const oversizedMediaResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/media/uploads?filename=large.mp4`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'video/mp4',
      'content-length': String(10 * 1024 * 1024 + 1),
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:write',
    },
    body: new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]),
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    mediaBucket: stagedMediaBucket,
    createApiClient: async () => { throw new Error('oversized media staging must not construct WeChat api client'); },
  },
);
check(
  oversizedMediaResponse.status === 413 && stagedMediaWrites.length === deniedMediaWriteCount,
  'REST 媒体暂存接口在读取正文前按 Content-Length 拒绝超过 10MB 的文件',
);

const oversizedStreamFirstChunk = new Uint8Array(6 * 1024 * 1024);
oversizedStreamFirstChunk.set(stagedPngBytes, 0);
const oversizedStreamResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/media/uploads?filename=streamed.png`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer TEST_TOKEN',
      'content-type': 'image/png',
      'x-woa-scopes': 'woa:tenant:read woa:account:read woa:content:write',
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedStreamFirstChunk);
        controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        controller.close();
      },
    }),
    duplex: 'half',
  }),
  {
    appId: 'wx1234567890abcdef',
    defaultUserId: 'wechat-admin',
    defaultClientId: 'test-client',
    allowUnsafeHeaderContextForTests: true,
    mediaBucket: stagedMediaBucket,
    createApiClient: async () => { throw new Error('oversized streamed media must not construct WeChat api client'); },
  },
);
check(
  oversizedStreamResponse.status === 413 && stagedMediaWrites.length === deniedMediaWriteCount,
  'REST 媒体暂存接口在缺少 Content-Length 时仍按流式累计字节拒绝超过 10MB 的文件',
);

const packageManifest = JSON.parse(readFileSync('./package.json', 'utf8'));
check(
  packageManifest.name === '@ziikoo/woa' &&
    packageManifest.bin?.woa === 'dist/src/cli/woa.js',
  'npm 包元数据已切换为 @ziikoo/woa 且保留 woa bin',
);

const woaHelp = execFileSync(process.execPath, ['./dist/src/cli/woa.js', '--help'], { encoding: 'utf8' });
check(
  woaHelp.includes('remote-only') &&
    woaHelp.includes('woa billing checkout --plan plus|pro') &&
    woaHelp.includes('woa quota status') &&
    woaHelp.includes('woa account default <accountId>') &&
    !woaHelp.includes('wechat-mcp mcp -a -s'),
  'woa CLI 帮助只宣传 remote-only 工作流并包含 billing/quota/account onboarding 命令',
);
const webApiClientSource = readFileSync('./web/src/lib/api.ts', 'utf8');
check(
  [
    'getCurrentOperator',
    'getOnboardingStatus',
    'getAccounts',
    'getAccountStatus',
    'createAccount',
    'updateAccount',
    'deleteAccount',
    'configureAccount',
    'getBillingStatus',
    'mcpConfigStatusSchema',
    'getQuotaSummary',
    'getSecuritySessions',
    'revokeSecuritySession',
  ].every(symbol => webApiClientSource.includes(symbol)) &&
    webApiClientSource.includes('/api/v1/sessions') &&
    webApiClientSource.includes('/api/v1/me'),
  'Web API client 覆盖 /me、onboarding、account、billing、MCP config、quota 与 sessions 的 Zod 边界',
);
const webAccountApiRequests = [];
const originalWebAccountFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  webAccountApiRequests.push({ url, method, body });
  const account = {
    tenantId: 'ten_web',
    accountId: 'acct_web',
    name: body?.name ?? 'Web 公众号',
    appId: body?.appId ?? 'wx_web',
    status: 'active',
    isDefault: body?.isDefault === true,
    hasAppSecret: true,
    hasWebhookToken: true,
    hasEncodingAESKey: true,
  };
  let data;
  let status = 200;
  if (method === 'GET' && url.endsWith('/accounts')) {
    data = { accounts: [account] };
  } else if (method === 'GET' && url.endsWith('/status')) {
    data = { account, configured: true, config: { appId: account.appId, hasAppSecret: true, hasToken: true, hasEncodingAESKey: true } };
  } else if (method === 'POST' && url.endsWith('/accounts')) {
    data = { account };
    status = 201;
  } else if (method === 'PATCH') {
    data = { account };
  } else if (method === 'POST' && url.endsWith('/configure')) {
    data = account;
  } else if (method === 'POST' && url.endsWith('/disable')) {
    data = { accountId: 'acct_web', deleted: true, secretsPurged: true };
  } else {
    return new Response(JSON.stringify({ success: false, error: { code: 'unexpected_test_request', message: `${method} ${url}` } }), { status: 500 });
  }
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
};
let listedWebAccounts;
let webAccountStatus;
let createdWebAccount;
let updatedWebAccount;
let configuredWebAccount;
let deletedWebAccount;
try {
  listedWebAccounts = await getWebAccounts('ten_web');
  webAccountStatus = await getWebAccountStatus('ten_web', 'acct_web');
  createdWebAccount = await createWebAccount({ tenantId: 'ten_web', name: '新公众号' });
  updatedWebAccount = await updateWebAccount({ tenantId: 'ten_web', accountId: 'acct_web', name: '更新公众号', isDefault: true });
  configuredWebAccount = await configureWebAccount({ tenantId: 'ten_web', accountId: 'acct_web', appId: 'wx_web', appSecret: 'APP_SECRET' });
  deletedWebAccount = await deleteWebAccount({ tenantId: 'ten_web', accountId: 'acct_web' });
} finally {
  globalThis.fetch = originalWebAccountFetch;
}
check(
  listedWebAccounts.accounts[0]?.accountId === 'acct_web' &&
    webAccountStatus.configured === true &&
    createdWebAccount.name === '新公众号' &&
    updatedWebAccount.name === '更新公众号' && updatedWebAccount.isDefault === true &&
    configuredWebAccount.hasAppSecret === true &&
    deletedWebAccount.deleted === true && deletedWebAccount.secretsPurged === true &&
    webAccountApiRequests.some(request => request.method === 'POST' && request.url.endsWith('/accounts') && request.body?.name === '新公众号') &&
    webAccountApiRequests.some(request => request.method === 'PATCH' && request.body?.name === '更新公众号' && request.body?.isDefault === true) &&
    webAccountApiRequests.some(request => request.method === 'POST' && request.url.endsWith('/configure') && request.body?.appSecret === 'APP_SECRET') &&
    webAccountApiRequests.some(request => request.method === 'POST' && request.url.endsWith('/disable') && request.body?.confirmation === 'DELETE acct_web'),
  'Web 公众号资源 API 行为级覆盖查询、新建、重命名/设默认、配置授权与确认删除',
);
const onboardingRouteSource = readFileSync('./web/src/routes/onboarding.tsx', 'utf8');
const securityRouteSource = readFileSync('./web/src/routes/security.tsx', 'utf8');
check(
  onboardingRouteSource.includes('getAccounts') &&
    onboardingRouteSource.includes('getAccountStatus') &&
    onboardingRouteSource.includes('createAccount') &&
    onboardingRouteSource.includes('updateAccount') &&
    onboardingRouteSource.includes('deleteAccount') &&
    onboardingRouteSource.includes('configureAccount') &&
    onboardingRouteSource.includes('validateSearch') &&
    onboardingRouteSource.includes('title="连接概览"') &&
    onboardingRouteSource.includes('<DefinitionList') &&
    onboardingRouteSource.includes('<List') &&
    onboardingRouteSource.includes('<Dialog') &&
    onboardingRouteSource.includes('onboarding-config-drawer') &&
    onboardingRouteSource.includes('<AlertDialog') &&
    !onboardingRouteSource.includes('/api/v1/tenants/current/accounts/current/configure') &&
    securityRouteSource.includes('getSecuritySessions') &&
    securityRouteSource.includes('revokeSecuritySession') &&
    securityRouteSource.includes("invalidateQueries({ queryKey: ['security-sessions'] })"),
  'Web 公众号资源页支持真实 CRUD/授权管理，security 页面使用真实会话 API',
);
const webMcpConfigSource = readFileSync('./web/src/lib/mcp-config.ts', 'utf8');
const webMcpRouteSource = readFileSync('./web/src/routes/mcp.tsx', 'utf8');
const kimiMcpGuide = getMcpClientGuide('kimi', 'https://worker.example.test');
check(
  kimiMcpGuide.label === 'Kimi Code' &&
    kimiMcpGuide.steps.map(step => step.code ?? '').join('\n').includes('/mcp-config login wechat-woa') &&
    kimiMcpGuide.steps.map(step => step.code ?? '').join('\n').includes('https://worker.example.test/mcp') &&
    kimiMcpGuide.steps.at(-1)?.code === '/mcp',
  'Web MCP client guide 提供 Kimi Code 添加、OAuth 登录和状态验证流程',
);
const oauthFirstMcpGuides = ['kimi', 'claude', 'codex', 'other']
  .map(client => getMcpClientGuide(client, 'https://worker.example.test'));
const oauthFirstMcpGuideCode = oauthFirstMcpGuides
  .flatMap(guide => guide.steps.map(step => step.code ?? ''))
  .join('\n');
check(
  oauthFirstMcpGuides.map(guide => guide.label).join('|') === 'Kimi Code|Claude Code|Codex|其他客户端' &&
    oauthFirstMcpGuideCode.includes('claude mcp login wechat-woa') &&
    oauthFirstMcpGuideCode.includes('codex mcp login wechat-woa') &&
    !/Authorization|Bearer|access_token|refresh_token|headers|bearerTokenEnvVar/i.test(oauthFirstMcpGuideCode),
  'Web MCP client guides 仅提供原生 OAuth，不生成静态 Bearer/header/token 配置',
);
check(
  webMcpConfigSource.includes('[mcp_servers.wechat-woa]') &&
    webMcpConfigSource.includes('getMcpClientGuide') &&
    webMcpConfigSource.includes('/mcp-config login wechat-woa') &&
    webMcpConfigSource.includes('claude mcp add') &&
    webMcpConfigSource.includes('--transport http') &&
    webMcpConfigSource.includes('--scope user') &&
    webMcpConfigSource.includes('claude mcp login wechat-woa') &&
    webMcpConfigSource.includes('codex mcp add') &&
    webMcpConfigSource.includes('--url') &&
    webMcpConfigSource.includes('codex mcp login wechat-woa') &&
    webMcpRouteSource.includes('validateSearch') &&
    webMcpRouteSource.includes('role="tablist"') &&
    webMcpRouteSource.includes('无需复制 token') &&
    webMcpRouteSource.includes('为什么没有 Bearer 配置') &&
    !webMcpRouteSource.includes('Authorization: Bearer') &&
    !webMcpRouteSource.includes('npx -y --package @ziikoo/woa'),
  'Web MCP 页面提供 Kimi/Claude/Codex OAuth-first 向导，并为 Codex 保留原生 TOML 配置',
);
const woaConfig = execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'mcp', 'config', 'codex', '--server', 'https://worker.example.test'], { encoding: 'utf8' });
check(
  woaConfig.includes('https://worker.example.test/mcp') &&
    !/appSecret|WECHAT_APP_SECRET|app_secret/i.test(woaConfig),
  'woa mcp config 生成远程 /mcp 配置且不包含微信凭据',
);
const mediaCliRequests = [];
const mediaCliServer = createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    mediaCliRequests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      body: Buffer.concat(chunks),
    });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: {
        r2Key: `staging/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/uploads/fixture-cover.png`,
        fileName: 'cover.png',
        mimeType: 'image/png',
        size: stagedPngBytes.byteLength,
      },
    }));
  });
});
await new Promise(resolve => mediaCliServer.listen(0, '127.0.0.1', resolve));
const mediaCliTempDir = mkdtempSync(path.join(tmpdir(), 'woa-media-upload-'));
try {
  const mediaCliFile = path.join(mediaCliTempDir, 'cover.png');
  writeFileSync(mediaCliFile, stagedPngBytes);
  const address = mediaCliServer.address();
  const mediaCliPort = typeof address === 'object' && address ? address.port : 0;
  const mediaCliOutput = await execFileText(process.execPath, [
    './dist/src/cli/woa.js',
    'media',
    'upload',
    mediaCliFile,
    '--server',
    `http://127.0.0.1:${mediaCliPort}`,
    '--token',
    'TEST_TOKEN',
    '--tenant',
    DEFAULT_TENANT_ID,
    '--account',
    DEFAULT_ACCOUNT_ID,
  ]);
  check(
    mediaCliRequests.length === 1 &&
      mediaCliRequests[0]?.method === 'POST' &&
      mediaCliRequests[0]?.url === `/api/v1/tenants/${DEFAULT_TENANT_ID}/accounts/${DEFAULT_ACCOUNT_ID}/media/uploads?filename=cover.png` &&
      mediaCliRequests[0]?.authorization === 'Bearer TEST_TOKEN' &&
      mediaCliRequests[0]?.contentType === 'image/png' &&
      mediaCliRequests[0]?.body.equals(Buffer.from(stagedPngBytes)) &&
      mediaCliOutput.includes('"r2Key"') &&
      mediaCliOutput.includes('wechat_permanent_media'),
    'woa media upload 从本地路径读取二进制并上传到受保护接口，输出 r2Key 与后续 MCP 调用提示',
  );
} finally {
  rmSync(mediaCliTempDir, { recursive: true, force: true });
  await new Promise(resolve => mediaCliServer.close(resolve));
}
const dynamicAccountCliRequests = [];
const dynamicAccountCliServer = createServer((req, res) => {
  dynamicAccountCliRequests.push(req.url);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/v1/me') {
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      data: {
        defaultTenantId: 'tenant_default',
        defaultAccountId: 'acct_dynamic_default',
        tenants: [{ tenantId: 'tenant_default', name: '默认租户' }],
        accounts: [{
          tenantId: 'tenant_default',
          accountId: 'acct_dynamic_default',
          name: '动态默认账号',
          status: 'active',
          isDefault: true,
        }],
      },
    }));
    return;
  }
  if (req.url === '/api/v1/tenants/tenant_default/accounts/acct_dynamic_default/status') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: { configured: true, accountId: 'acct_dynamic_default' } }));
    return;
  }
  res.writeHead(403);
  res.end(JSON.stringify({
    success: false,
    error: {
      code: 'account_forbidden',
      message: 'Account acct_default is not accessible for the current user.',
    },
  }));
});
await new Promise(resolve => dynamicAccountCliServer.listen(0, '127.0.0.1', resolve));
const dynamicAccountCliTempDir = mkdtempSync(path.join(tmpdir(), 'woa-dynamic-account-'));
try {
  const address = dynamicAccountCliServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const output = await execFileText(process.execPath, [
    './dist/src/cli/woa.js',
    'account',
    'status',
    '--server',
    `http://127.0.0.1:${port}`,
    '--token',
    'TEST_TOKEN',
  ], {
    env: {
      ...process.env,
      WOA_CLI_CONFIG: path.join(dynamicAccountCliTempDir, 'cli.json'),
    },
  });
  check(
    dynamicAccountCliRequests[0] === '/api/v1/me' &&
      dynamicAccountCliRequests[1] === '/api/v1/tenants/tenant_default/accounts/acct_dynamic_default/status' &&
      output.includes('acct_dynamic_default') &&
      !dynamicAccountCliRequests.some(request => request?.includes('/acct_default/')),
    'woa CLI 未显式选择账号时从 /api/v1/me 使用当前 Operator 的动态默认账号，不回退旧 acct_default 常量',
  );
} finally {
  rmSync(dynamicAccountCliTempDir, { recursive: true, force: true });
  await new Promise(resolve => dynamicAccountCliServer.close(resolve));
}
const woaDraftDeleteDryRun = JSON.parse(execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'draft', 'delete', 'MEDIA_ID_FOR_DELETE', '--dry-run'], { encoding: 'utf8' }));
const woaPublishDeleteDryRun = JSON.parse(execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'publish', 'delete', 'ARTICLE_ID_FOR_DELETE', '--index', '1', '--dry-run'], { encoding: 'utf8' }));
const woaAccountDeleteDryRun = JSON.parse(execFileSync(process.execPath, ['./dist/src/cli/woa.js', 'account', 'delete', 'ACCOUNT_ID_FOR_DELETE', '--dry-run'], { encoding: 'utf8' }));
check(
  woaDraftDeleteDryRun.dryRun === true &&
    woaDraftDeleteDryRun.operation === 'draft.delete' &&
    woaDraftDeleteDryRun.target?.mediaId === 'MEDIA_ID_FOR_DELETE' &&
    woaPublishDeleteDryRun.dryRun === true &&
    woaPublishDeleteDryRun.operation === 'publish.delete' &&
    woaPublishDeleteDryRun.target?.articleId === 'ARTICLE_ID_FOR_DELETE' &&
    woaPublishDeleteDryRun.target?.index === 1 &&
    woaAccountDeleteDryRun.dryRun === true &&
    woaAccountDeleteDryRun.operation === 'account.delete' &&
    woaAccountDeleteDryRun.target?.accountId === 'ACCOUNT_ID_FOR_DELETE',
  'woa CLI 删除命令默认支持 dry-run 预检，不要求本地 MCP 或微信凭据',
);
const workerIndexSource = readFileSync('./src/worker/index.ts', 'utf8');
const oauthConsentResponse = renderAuthorizationConsentForm({
  query: 'response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fcallback',
  clientId: 'cli_test',
  scopes: ['wechat.mcp'],
});
const oauthConsentCsp = oauthConsentResponse.headers.get('content-security-policy') ?? '';
const oauthConsentHtml = await oauthConsentResponse.text();
check(
  oauthConsentHtml.includes('method="POST"') &&
    oauthConsentHtml.includes('name="consent" value="approve"') &&
    !/(?:^|;)\s*form-action\b/.test(oauthConsentCsp),
  'OAuth 授权页允许已验证 redirect_uri 的表单重定向链到达 CLI 本机回调',
);
check(
  workerIndexSource.includes("'/api/v1': managementApiHandler") &&
    workerIndexSource.includes('handleWebSessionManagementApiRequest') &&
    workerIndexSource.includes('if (!sessionToken) return null') &&
    workerIndexSource.includes('return await createOAuthProvider().fetch'),
  '生产 Worker /api/v1 默认通过 OAuthProvider 保护；仅已验证 HttpOnly Web session cookie 使用受控 fast-path',
);
check(
  workerIndexSource.includes("from './transport-guards.js'") &&
    workerIndexSource.includes('removedMcpTransportResponseForRequest(request)') &&
    workerIndexSource.includes("serve('/mcp'"),
  'Workers 在入口层调用旧 SSE/messages 传输 guard，仅保留 /mcp Streamable HTTP',
);
const removedTransportResponses = [
  removedMcpTransportResponseForRequest(new Request('https://worker.example.test/sse')),
  removedMcpTransportResponseForRequest(new Request('https://worker.example.test/sse/session')),
  removedMcpTransportResponseForRequest(new Request('https://worker.example.test/messages?sessionId=1')),
  removedMcpTransportResponseForRequest(new Request('https://worker.example.test/messages/session')),
];
check(
  removedTransportResponses.every(response => response?.status === 404) &&
    removedMcpTransportResponseForRequest(new Request('https://worker.example.test/mcp')) === null &&
    removedMcpTransportResponseForRequest(new Request('https://worker.example.test/login')) === null,
  '旧传输 guard 行为级验证：/sse 和 /messages 返回 404，/mcp 与 Web 路由不被拦截',
);

const ciWorkflowSource = readFileSync('./.github/workflows/ci.yml', 'utf8');
const deployWorkflowSource = readFileSync('./.github/workflows/deploy-production.yml', 'utf8');
const npmPublishWorkflowSource = readFileSync('./.github/workflows/npm-publish.yml', 'utf8');
const turnstileWorkflowSource = readFileSync('./.github/workflows/configure-turnstile.yml', 'utf8');
const turnstileConfigureSource = readFileSync('./scripts/ops/configure-turnstile.mjs', 'utf8');
const pinnedCheckoutSha = 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0';
const pinnedSetupNodeSha = 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e';
check(
  ciWorkflowSource.includes('pull_request:') &&
    ciWorkflowSource.includes('cancel-in-progress: true') &&
    ciWorkflowSource.includes('npm run check') &&
    ciWorkflowSource.includes('npm run lint') &&
    ciWorkflowSource.includes('npm test') &&
    ciWorkflowSource.includes('wrangler deploy --dry-run') &&
    ciWorkflowSource.includes(pinnedCheckoutSha) &&
    ciWorkflowSource.includes(pinnedSetupNodeSha),
  'PR CI 独立执行 check/lint/test/Worker dry-run，并固定第三方 Action commit SHA',
);
check(
  deployWorkflowSource.includes('environment:') &&
    deployWorkflowSource.includes('name: production') &&
    deployWorkflowSource.includes('Missing required production secrets') &&
    !deployWorkflowSource.includes('Skipping production deploy') &&
    deployWorkflowSource.indexOf('Validate Worker bundle before remote changes') < deployWorkflowSource.indexOf('Apply D1 migrations') &&
    deployWorkflowSource.includes('Verify production health and MCP auth boundary') &&
    deployWorkflowSource.includes(pinnedCheckoutSha) &&
    deployWorkflowSource.includes(pinnedSetupNodeSha),
  '生产部署 fail-closed，在远程 migration 前验证 bundle，并在部署后检查 health 与 /mcp OAuth 边界',
);
check(
  npmPublishWorkflowSource.includes('name: npm-release') &&
    npmPublishWorkflowSource.includes('npm@12.0.1') &&
    npmPublishWorkflowSource.includes('expected_tag="woa-v${package_version}"') &&
    npmPublishWorkflowSource.includes('git merge-base --is-ancestor') &&
    npmPublishWorkflowSource.includes('local_shasum=') &&
    npmPublishWorkflowSource.includes('local_tarball=') &&
    npmPublishWorkflowSource.includes('Array.isArray(packResult)') &&
    npmPublishWorkflowSource.includes("packResult['@ziikoo/woa'] ?? Object.values(packResult)[0]") &&
    npmPublishWorkflowSource.includes('diff --recursive --brief --no-dereference') &&
    npmPublishWorkflowSource.includes('extracted package contents match') &&
    npmPublishWorkflowSource.includes('https://registry.npmjs.org/${encodeURIComponent(process.env.PACKAGE_NAME)}') &&
    npmPublishWorkflowSource.includes('AbortSignal.timeout(15000)') &&
    npmPublishWorkflowSource.includes("cache: 'no-store'") &&
    npmPublishWorkflowSource.includes('already published with the expected tarball and dist-tag; skipping publish') &&
    npmPublishWorkflowSource.includes('Verify npm automation token') &&
    npmPublishWorkflowSource.includes('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}') &&
    npmPublishWorkflowSource.includes('npm whoami --registry=https://registry.npmjs.org/') &&
    npmPublishWorkflowSource.includes('Publish with npm automation token') &&
    npmPublishWorkflowSource.includes("NPM_CONFIG_PROVENANCE: 'false'") &&
    !npmPublishWorkflowSource.includes("NPM_CONFIG_PROVENANCE: 'true'") &&
    npmPublishWorkflowSource.includes(pinnedCheckoutSha) &&
    npmPublishWorkflowSource.includes(pinnedSetupNodeSha),
  'npm 发布校验 tag/version/main 可达性与包内容，验证自动化 Token，并支持私有源码仓库的跨环境幂等发布',
);
check(
  turnstileWorkflowSource.includes('group: turnstile-production') &&
    turnstileWorkflowSource.includes('CLOUDFLARE_TURNSTILE_API_TOKEN') &&
    turnstileConfigureSource.includes('const apiToken = process.env.CLOUDFLARE_TURNSTILE_API_TOKEN;') &&
    !turnstileConfigureSource.includes('CLOUDFLARE_TURNSTILE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN') &&
    turnstileWorkflowSource.includes(pinnedCheckoutSha) &&
    turnstileWorkflowSource.includes(pinnedSetupNodeSha),
  'Turnstile 配置必须使用专用 API Token，不再回退到通用 Cloudflare Token，并固定 Action SHA',
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
        periodAnchorAt,
        pendingPlan,
        pendingPlanEffectiveAt,
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
        period_anchor_at: existing?.period_anchor_at ?? periodAnchorAt,
        pending_plan: pendingPlan,
        pending_plan_effective_at: pendingPlanEffectiveAt,
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
const freeAnchor = Date.UTC(2026, 0, 31, 10, 0, 0);
const freeAnchorPeriod = quotaPeriodForContext(
  'month',
  Date.UTC(2026, 1, 28, 11, 0, 0),
  { plan: 'free', periodAnchorAt: freeAnchor },
);
const paidPeriodStart = Date.UTC(2026, 5, 12, 9, 30, 0);
const paidPeriodEnd = Date.UTC(2026, 6, 12, 9, 30, 0);
const paidBillingPeriod = quotaPeriodForContext(
  'month',
  Date.UTC(2026, 6, 4, 8, 0, 0),
  { plan: 'plus', currentPeriodStart: paidPeriodStart, currentPeriodEnd: paidPeriodEnd },
);
check(
  freeAnchorPeriod.period === `anniversary:${Date.UTC(2026, 1, 28, 10, 0, 0)}` &&
    freeAnchorPeriod.resetAt === Date.UTC(2026, 2, 31, 10, 0, 0) &&
    paidBillingPeriod.period === `billing:${paidPeriodStart}:${paidPeriodEnd}` &&
    paidBillingPeriod.resetAt === paidPeriodEnd,
  'Free 月配额按租户周年锚点滚动（含月末夹取），付费配额使用 Stripe 当前账期',
);
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

const contentPublishConsumptions = createQuotaConsumptions({
  toolName: 'wechat_content_publish',
  params: {
    action: 'create_and_publish',
    contentType: 'article',
    articles: [{ title: 'A' }, { title: 'B' }],
  },
  plan: 'free',
  now: quotaNow,
});
check(
  contentPublishConsumptions.some(item => item.metric === 'published_articles_month' && item.amount === 2),
  '统一图文/图片发布工具纳入成功发布配额，并按已知文章数计量',
);

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

const failedPublishStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
const failedPublishResult = await executeMcpToolWithQuota({
  tool: {
    name: 'wechat_content_publish',
    description: 'failed publish partial refund fixture',
    inputSchema: {},
    handler: async () => ({ content: [{ type: 'text', text: 'publish failed' }], isError: true }),
  },
  apiClient: {},
  params: { action: 'create_and_publish', contentType: 'image' },
  tenantContext: quotaContext,
  usageStore: failedPublishStore,
});
const failedPublishToolCounter = await failedPublishStore.getCounter('tenant_quota', 'tool_calls_month', quotaPeriod('month'));
const failedPublishSuccessCounter = await failedPublishStore.getCounter('tenant_quota', 'published_articles_month', quotaPeriod('month'));
check(
  failedPublishResult.isError === true &&
    failedPublishToolCounter?.used === 1 &&
    (failedPublishSuccessCounter?.used ?? 0) === 0,
  '失败发布保留 tool-call 用量，但退还成功发布用量',
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
    '--tenant',
    DEFAULT_TENANT_ID,
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
  resolveOwnerEmail: async tenantId => tenantId === DEFAULT_TENANT_ID ? 'owner@example.com' : null,
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
    stripeCheckoutCalls[0]?.bodyText.includes('customer_email=owner%40example.com') &&
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

const scheduledDowngradeStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
const scheduledDowngradeLocks = [];
const scheduledPeriodStartSeconds = Math.floor(Date.UTC(2026, 6, 1) / 1000);
const scheduledPeriodEndSeconds = Math.floor(Date.UTC(2026, 7, 1) / 1000);
await scheduledDowngradeStore.upsertEntitlement({
  tenantId: 'tenant_scheduled_downgrade',
  plan: 'plus',
  status: 'active',
  stripeCustomerId: 'cus_scheduled_fixture',
  stripeSubscriptionId: 'sub_scheduled_fixture',
});
const scheduledDowngradePayload = JSON.stringify({
  id: 'evt_scheduled_downgrade_fixture',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_scheduled_fixture',
      customer: 'cus_scheduled_fixture',
      status: 'active',
      cancel_at_period_end: true,
      current_period_start: scheduledPeriodStartSeconds,
      current_period_end: scheduledPeriodEndSeconds,
      metadata: {
        tenant_id: 'tenant_scheduled_downgrade',
        plan: 'plus',
      },
    },
  },
});
const scheduledDowngradeResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(scheduledDowngradePayload, stripeWebhookSecret),
    },
    body: scheduledDowngradePayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: scheduledDowngradeStore,
    reconcileAccountLocks: async (tenantId, plan) => scheduledDowngradeLocks.push({ tenantId, plan }),
  },
);
const scheduledDowngradeEntitlement = await scheduledDowngradeStore.getEntitlement('tenant_scheduled_downgrade');
const scheduledDeletionPayload = JSON.stringify({
  id: 'evt_scheduled_deletion_fixture',
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: 'sub_scheduled_fixture',
      customer: 'cus_scheduled_fixture',
      status: 'canceled',
      metadata: {
        tenant_id: 'tenant_scheduled_downgrade',
        plan: 'plus',
      },
    },
  },
});
const scheduledDeletionResponse = await handleStripeWebhookRequest(
  new Request('https://worker.example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSignatureHeader(scheduledDeletionPayload, stripeWebhookSecret),
    },
    body: scheduledDeletionPayload,
  }),
  {
    webhookSecret: stripeWebhookSecret,
    usageStore: scheduledDowngradeStore,
    reconcileAccountLocks: async (tenantId, plan) => scheduledDowngradeLocks.push({ tenantId, plan }),
  },
);
const scheduledDeletionEntitlement = await scheduledDowngradeStore.getEntitlement('tenant_scheduled_downgrade');
check(
  scheduledDowngradeResponse.status === 200 &&
    scheduledDowngradeEntitlement.plan === 'plus' &&
    scheduledDowngradeEntitlement.pendingPlan === 'free' &&
    scheduledDowngradeEntitlement.pendingPlanEffectiveAt === scheduledPeriodEndSeconds * 1000 &&
    scheduledDeletionResponse.status === 200 &&
    scheduledDeletionEntitlement.plan === 'free' &&
    scheduledDowngradeLocks.length === 1 &&
    scheduledDowngradeLocks[0].tenantId === 'tenant_scheduled_downgrade' &&
    scheduledDowngradeLocks[0].plan === 'free',
  'Stripe period-end 取消在账期结束前保留付费权益，删除事件生效后降级并触发账号锁定协调',
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



console.log('\n=== SaaS onboarding repository fixture 验证 ===');

class MemorySaasD1Database {
  operators = new Map();
  users = new Map();
  identities = new Map();
  emailCodes = new Map();
  webSessions = new Map();
  oauthClients = new Map();
  oauthConsents = new Map();
  oauthTokenSessions = new Map();
  rateLimits = new Map();
  tenants = new Map();
  tenantOwners = new Map();
  memberships = [];
  accounts = new Map();
  entitlements = new Map();
  accountTokens = new Map();
  monitoringEvents = new Map();
  deletionRequests = new Map();
  mediaRetention = new Map();

  prepare(query) {
    return new MemorySaasD1Statement(this, query);
  }
}

class MemorySaasD1Statement {
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
    if (/^(CREATE|CREATE INDEX)/.test(q)) return { success: true, meta: { changes: 0 } };

    if (q.startsWith('INSERT INTO operators')) {
      const [id, verifiedEmail, displayName, createdAt, updatedAt] = this.values;
      this.db.operators.set(id, { id, verified_email: verifiedEmail, display_name: displayName, status: 'active', created_at: createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO users')) {
      const [id, email, displayName, createdAt, updatedAt] = this.values;
      const existing = this.db.users.get(id);
      this.db.users.set(id, {
        id,
        email: existing?.email ?? email,
        display_name: existing?.display_name || displayName,
        status: existing?.status === 'disabled' ? 'disabled' : 'active',
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO operator_identities')) {
      const [id, operatorId, provider, providerSubject, verifiedEmail, createdAt, updatedAt] = this.values;
      const key = `${provider}:${providerSubject}`;
      const existing = this.db.identities.get(key);
      this.db.identities.set(key, { id: existing?.id ?? id, operator_id: operatorId, provider, provider_subject: providerSubject, verified_email: verifiedEmail, created_at: existing?.created_at ?? createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO operator_email_codes')) {
      const [id, email, codeHash, purpose, maxAttempts, issuedAt, expiresAt, ipHash, providerSubject, createdAt, updatedAt] = this.values;
      this.db.emailCodes.set(id, { id, email, code_hash: codeHash, purpose, attempts: 0, max_attempts: maxAttempts, issued_at: issuedAt, expires_at: expiresAt, consumed_at: null, ip_hash: ipHash, provider_subject: providerSubject, created_at: createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE operator_email_codes SET consumed_at')) {
      const [consumedAt, updatedAt, id] = this.values;
      const row = this.db.emailCodes.get(id);
      if (row) {
        row.consumed_at = consumedAt;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE operator_email_codes SET attempts')) {
      const [nextAttempts, compareAttempts, consumedAt, updatedAt, id] = this.values;
      const row = this.db.emailCodes.get(id);
      if (row) {
        row.attempts = nextAttempts;
        if (compareAttempts >= row.max_attempts) row.consumed_at = consumedAt;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO public_signup_rate_limits')) {
      const [bucket, keyHash, windowStart, count, resetAt, createdAt, updatedAt] = this.values;
      const key = `${bucket}:${keyHash}:${windowStart}`;
      const existing = this.db.rateLimits.get(key);
      this.db.rateLimits.set(key, { bucket, key_hash: keyHash, window_start: windowStart, count, reset_at: resetAt, created_at: existing?.created_at ?? createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO web_sessions')) {
      const [id, operatorId, sessionHash, createdAt, lastSeenAt, updatedAt, expiresAt] = this.values;
      this.db.webSessions.set(id, { id, operator_id: operatorId, session_hash: sessionHash, created_at: createdAt, last_seen_at: lastSeenAt, updated_at: updatedAt, expires_at: expiresAt, revoked_at: null });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE web_sessions SET last_seen_at')) {
      const [lastSeenAt, expiresAt, updatedAt, id] = this.values;
      const row = this.db.webSessions.get(id);
      if (row) {
        row.last_seen_at = lastSeenAt;
        row.expires_at = expiresAt;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE web_sessions SET revoked_at') && !q.includes('COALESCE')) {
      const [revokedAt, updatedAt, id, operatorId] = this.values;
      const row = this.db.webSessions.get(id);
      if (row && (!operatorId || row.operator_id === operatorId) && row.revoked_at === null) {
        row.revoked_at = revokedAt;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO oauth_clients')) {
      const [clientId, clientName, clientType, redirectUrisJson, scopesJson, tenantId, secretHash, createdAt, updatedAt] = this.values;
      const existing = this.db.oauthClients.get(clientId);
      this.db.oauthClients.set(clientId, { client_id: clientId, client_name: clientName, client_type: clientType, redirect_uris_json: redirectUrisJson, scopes_json: scopesJson, tenant_id: tenantId, secret_hash: secretHash, status: 'active', created_at: existing?.created_at ?? createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO oauth_consents')) {
      const [id, operatorId, clientId, scopesHash, scopesJson, createdAt, updatedAt] = this.values;
      const key = `${operatorId}:${clientId}:${scopesHash}`;
      const existing = this.db.oauthConsents.get(key);
      this.db.oauthConsents.set(key, { id: existing?.id ?? id, operator_id: operatorId, client_id: clientId, scopes_hash: scopesHash, scopes_json: scopesJson, created_at: existing?.created_at ?? createdAt, updated_at: updatedAt, revoked_at: null });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO oauth_token_sessions')) {
      const [id, operatorId, clientId, accessTokenHash, refreshTokenHash, scopesJson, accessExpiresAt, refreshExpiresAt, createdAt, updatedAt] = this.values;
      this.db.oauthTokenSessions.set(id, { id, operator_id: operatorId, client_id: clientId, access_token_hash: accessTokenHash, refresh_token_hash: refreshTokenHash, scopes_json: scopesJson, access_expires_at: accessExpiresAt, refresh_expires_at: refreshExpiresAt, created_at: createdAt, updated_at: updatedAt, revoked_at: null });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE oauth_token_sessions SET revoked_at') && !q.includes('COALESCE')) {
      const [revokedAt, updatedAt, id, operatorId] = this.values;
      const row = this.db.oauthTokenSessions.get(id);
      if (row && (!operatorId || row.operator_id === operatorId) && row.revoked_at === null) {
        row.revoked_at = revokedAt;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO tenants')) {
      const [id, slug, name, defaultAccountId, createdAt, updatedAt] = this.values;
      this.db.tenants.set(id, { id, slug, name, status: 'active', default_account_id: defaultAccountId, created_at: createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO tenant_owners')) {
      const [tenantId, operatorId, createdAt] = this.values;
      this.db.tenantOwners.set(tenantId, { tenant_id: tenantId, operator_id: operatorId, created_at: createdAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO tenant_memberships')) {
      const [tenantId, operatorId, scopesJson, defaultAccountId, createdAt, updatedAt] = this.values;
      const existing = this.db.memberships.find(row => row.tenant_id === tenantId && row.user_id === operatorId);
      if (existing) {
        Object.assign(existing, { role: 'owner', scopes_json: scopesJson, default_account_id: defaultAccountId, status: 'active', updated_at: updatedAt });
      } else {
        this.db.memberships.push({ tenant_id: tenantId, user_id: operatorId, role: 'owner', scopes_json: scopesJson, default_account_id: defaultAccountId, status: 'active', created_at: createdAt, updated_at: updatedAt });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO tenant_entitlements')) {
      if (q.includes("VALUES (?, 'free', 'active'")) {
        const [tenantId, periodAnchorAt, createdAt, updatedAt] = this.values;
        const existed = this.db.entitlements.has(tenantId);
        if (!existed) {
          this.db.entitlements.set(tenantId, {
            tenant_id: tenantId,
            plan: 'free',
            status: 'active',
            period_anchor_at: periodAnchorAt,
            limits_json: '{}',
            created_at: createdAt,
            updated_at: updatedAt,
          });
        }
        return { success: true, meta: { changes: existed ? 0 : 1 } };
      }
      const [tenantId, plan, status, periodAnchorAt, createdAt, updatedAt] = this.values;
      const existing = this.db.entitlements.get(tenantId);
      this.db.entitlements.set(tenantId, {
        tenant_id: tenantId,
        plan,
        status,
        period_anchor_at: existing?.period_anchor_at ?? periodAnchorAt,
        limits_json: existing?.limits_json ?? '{}',
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO wechat_accounts')) {
      const [id, tenantId, slug, name, status, isDefault, createdAt, updatedAt] = this.values;
      this.db.accounts.set(id, { id, tenant_id: tenantId, slug, name, app_id: null, app_secret: null, webhook_token: null, encoding_aes_key: null, status, is_default: isDefault, created_at: createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET name')) {
      const [name, updatedAt, tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      if (row && row.tenant_id === tenantId && row.status !== 'disabled') {
        row.name = name;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET is_default = 0')) {
      const [updatedAt, tenantId] = this.values;
      for (const row of this.db.accounts.values()) {
        if (row.tenant_id === tenantId) {
          row.is_default = 0;
          row.updated_at = updatedAt;
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET is_default = 1')) {
      const [updatedAt, tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      if (row && row.tenant_id === tenantId) {
        row.is_default = 1;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE tenants SET default_account_id')) {
      const [defaultAccountId, updatedAt, tenantId] = this.values;
      const row = this.db.tenants.get(tenantId);
      if (row) {
        row.default_account_id = defaultAccountId;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE tenants SET name')) {
      const [name, updatedAt, tenantId] = this.values;
      const row = this.db.tenants.get(tenantId);
      if (row && row.status !== 'disabled') {
        row.name = name;
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET app_id = NULL')) {
      if (!q.includes('AND id = ?')) {
        const [updatedAt, tenantId] = this.values;
        let changes = 0;
        for (const row of this.db.accounts.values()) {
          if (row.tenant_id !== tenantId) continue;
          Object.assign(row, {
            app_id: null,
            app_secret: null,
            webhook_token: null,
            encoding_aes_key: null,
            status: 'disabled',
            is_default: 0,
            updated_at: updatedAt,
          });
          changes += 1;
        }
        return { success: true, meta: { changes } };
      }
      const [updatedAt, tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      if (row && row.tenant_id === tenantId) {
        Object.assign(row, { app_id: null, app_secret: null, webhook_token: null, encoding_aes_key: null, status: 'disabled', is_default: 0, updated_at: updatedAt });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith("UPDATE wechat_accounts SET status = 'locked'")) {
      const [planLockedAt, planLockReason, updatedAt, tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      if (row && row.tenant_id === tenantId && row.status !== 'disabled') {
        Object.assign(row, {
          status: 'locked',
          plan_locked_at: planLockedAt,
          plan_lock_reason: planLockReason,
          updated_at: updatedAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET status = CASE')) {
      const [updatedAt, tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      if (row && row.tenant_id === tenantId && row.status === 'locked') {
        Object.assign(row, {
          status: row.app_secret === null ? 'unconfigured' : 'active',
          plan_locked_at: null,
          plan_lock_reason: null,
          updated_at: updatedAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('DELETE FROM wechat_access_tokens')) {
      if (!q.includes('account_id = ?')) {
        const [tenantId] = this.values;
        let changes = 0;
        for (const key of [...this.db.accountTokens.keys()]) {
          if (key.startsWith(`${tenantId}:`)) {
            this.db.accountTokens.delete(key);
            changes += 1;
          }
        }
        return { success: true, meta: { changes } };
      }
      const [tenantId, accountId] = this.values;
      const changed = this.db.accountTokens.delete(`${tenantId}:${accountId}`) ? 1 : 0;
      return { success: true, meta: { changes: changed } };
    }

    if (q.startsWith('UPDATE wechat_accounts SET app_id = ?')) {
      const [appId, appSecret, updateWebhookToken, webhookToken, updateEncodingAESKey, encodingAESKey, updatedAt, tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      if (row && row.tenant_id === tenantId && row.status !== 'disabled') {
        Object.assign(row, {
          app_id: appId,
          app_secret: appSecret,
          webhook_token: updateWebhookToken === 1 ? webhookToken : row.webhook_token,
          encoding_aes_key: updateEncodingAESKey === 1 ? encodingAESKey : row.encoding_aes_key,
          status: 'active',
          updated_at: updatedAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (q.startsWith('INSERT INTO wechat_access_tokens')) {
      const [tenantId, accountId, accessToken, expiresIn, expiresAt, createdAt, updatedAt] = this.values;
      const key = `${tenantId}:${accountId}`;
      const existing = this.db.accountTokens.get(key);
      this.db.accountTokens.set(key, { tenant_id: tenantId, account_id: accountId, access_token: accessToken, expires_in: expiresIn, expires_at: expiresAt, created_at: existing?.created_at ?? createdAt, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO monitoring_events')) {
      const [id, eventType, tenantId, accountId, severity, metadataJson, createdAt] = this.values;
      this.db.monitoringEvents.set(id, { id, event_type: eventType, tenant_id: tenantId, account_id: accountId, severity, metadata_json: metadataJson, created_at: createdAt });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO r2_media_retention_metadata')) {
      const [objectKey, tenantId, accountId, createdAt, expiresAt] = this.values;
      this.db.mediaRetention.set(objectKey, {
        object_key: objectKey,
        tenant_id: tenantId,
        account_id: accountId,
        created_at: createdAt,
        expires_at: expiresAt,
        deleted_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('INSERT INTO operator_deletion_requests')) {
      const [id, operatorId, requestedAt, supportNote] = this.values;
      this.db.deletionRequests.set(id, { id, operator_id: operatorId, status: 'requested', requested_at: requestedAt, completed_at: null, support_note: supportNote });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE tenant_entitlements SET plan')) {
      const [updatedAt, tenantId] = this.values;
      const row = this.db.entitlements.get(tenantId);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        plan: 'free',
        status: 'cancelled',
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_start: null,
        current_period_end: null,
        pending_plan: null,
        pending_plan_effective_at: null,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith('UPDATE tenant_memberships SET status')) {
      const [updatedAt, tenantId] = this.values;
      let changes = 0;
      for (const row of this.db.memberships) {
        if (row.tenant_id === tenantId) {
          row.status = 'disabled';
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (q.startsWith('UPDATE tenants SET status')) {
      const [updatedAt, tenantId] = this.values;
      const row = this.db.tenants.get(tenantId);
      if (row) Object.assign(row, { status: 'disabled', default_account_id: null, updated_at: updatedAt });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }

    if (q.startsWith('UPDATE web_sessions SET revoked_at = COALESCE')) {
      const [revokedAt, updatedAt, operatorId] = this.values;
      let changes = 0;
      for (const row of this.db.webSessions.values()) {
        if (row.operator_id === operatorId) {
          row.revoked_at ??= revokedAt;
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (q.startsWith('UPDATE oauth_token_sessions SET revoked_at = COALESCE')) {
      const [revokedAt, updatedAt, operatorId] = this.values;
      let changes = 0;
      for (const row of this.db.oauthTokenSessions.values()) {
        if (row.operator_id === operatorId) {
          row.revoked_at ??= revokedAt;
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (q.startsWith("UPDATE operators SET status = 'disabled'")) {
      const [updatedAt, operatorId] = this.values;
      const row = this.db.operators.get(operatorId);
      if (row) Object.assign(row, { status: 'disabled', updated_at: updatedAt });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }

    if (q.startsWith("UPDATE users SET status = 'disabled'")) {
      const [updatedAt, operatorId] = this.values;
      const row = this.db.users.get(operatorId);
      if (row) Object.assign(row, { status: 'disabled', updated_at: updatedAt });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }

    if (q.startsWith("UPDATE operator_deletion_requests SET status = 'completed'")) {
      const [completedAt, supportNote, requestId, operatorId] = this.values;
      const row = this.db.deletionRequests.get(requestId);
      if (row && row.operator_id === operatorId && row.status === 'requested') {
        Object.assign(row, {
          status: 'completed',
          completed_at: completedAt,
          support_note: row.support_note ?? supportNote,
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    throw new Error(`Unsupported SaaS D1 run query: ${q}`);
  }

  async first() {
    const q = this.query;

    if (q.startsWith('SELECT id, verified_email')) {
      const [value] = this.values;
      if (q.includes('WHERE id = ?')) {
        const row = this.db.operators.get(value);
        return row && row.status !== 'disabled' ? row : null;
      }
      return [...this.db.operators.values()].find(row => row.verified_email === value && row.status !== 'disabled') ?? null;
    }

    if (q.startsWith('SELECT op.id')) {
      const [tenantId] = this.values;
      const owner = this.db.tenantOwners.get(tenantId);
      const operator = owner ? this.db.operators.get(owner.operator_id) : null;
      return operator && operator.status !== 'disabled' ? operator : null;
    }

    if (q.startsWith('SELECT id AS tenant_id')) {
      const row = this.db.tenants.get(this.values[0]);
      return row && row.status !== 'disabled'
        ? {
          tenant_id: row.id,
          tenant_slug: row.slug,
          tenant_name: row.name,
          tenant_status: row.status,
          role: 'owner',
        }
        : null;
    }

    if (q.startsWith('SELECT id FROM users')) {
      const [email, operatorId] = this.values;
      return [...this.db.users.values()].find(row => row.email === email && row.id !== operatorId) ?? null;
    }

    if (q.startsWith('SELECT o.id')) {
      const [provider, providerSubject] = this.values;
      const identity = this.db.identities.get(`${provider}:${providerSubject}`);
      return identity ? this.db.operators.get(identity.operator_id) ?? null : null;
    }

    if (q.startsWith('SELECT id, code_hash')) {
      const [email] = this.values;
      return [...this.db.emailCodes.values()]
        .filter(row => row.email === email && row.consumed_at === null)
        .sort((a, b) => b.issued_at - a.issued_at)[0] ?? null;
    }

    if (q.startsWith('SELECT count, reset_at')) {
      const [bucket, keyHash, windowStart] = this.values;
      return this.db.rateLimits.get(`${bucket}:${keyHash}:${windowStart}`) ?? null;
    }

    if (q.startsWith('SELECT id, operator_id, expires_at')) {
      const [sessionHash, now] = this.values;
      return [...this.db.webSessions.values()].find(row => row.session_hash === sessionHash && row.revoked_at === null && row.expires_at > now) ?? null;
    }

    if (q.startsWith('SELECT id FROM oauth_consents')) {
      const [operatorId, clientId, scopesHash] = this.values;
      return this.db.oauthConsents.get(`${operatorId}:${clientId}:${scopesHash}`) ?? null;
    }

    if (q.startsWith('SELECT id FROM wechat_accounts WHERE app_id')) {
      const [appId, tenantId, resourceId] = this.values;
      return [...this.db.accounts.values()].find(row => row.app_id === appId && row.status !== 'disabled' && !(row.tenant_id === tenantId && row.id === resourceId)) ?? null;
    }

    if (q.startsWith('SELECT COUNT(*) AS count')) {
      const [tenantId] = this.values;
      return { count: [...this.db.accounts.values()].filter(row => row.tenant_id === tenantId && row.status !== 'disabled').length };
    }

    if (q.startsWith('SELECT plan, status')) {
      const [tenantId] = this.values;
      return this.db.entitlements.get(tenantId) ?? null;
    }

    if (q.startsWith('SELECT t.id AS tenant_id')) {
      const [operatorId] = this.values;
      const owned = [...this.db.tenantOwners.values()]
        .filter(row => row.operator_id === operatorId)
        .map(row => this.db.tenants.get(row.tenant_id))
        .filter(row => row && row.status !== 'disabled')
        .sort((a, b) => a.created_at - b.created_at)[0];
      return owned ? {
        tenant_id: owned.id,
        tenant_slug: owned.slug,
        tenant_name: owned.name,
        tenant_status: owned.status,
        tenant_default_account_id: owned.default_account_id,
      } : null;
    }

    if (q.startsWith('SELECT id, tenant_id, slug')) {
      const [tenantId, resourceId] = this.values;
      const row = this.db.accounts.get(resourceId);
      return row && row.tenant_id === tenantId && row.status !== 'disabled' ? row : null;
    }

    throw new Error(`Unsupported SaaS D1 first query: ${q}`);
  }

  async all() {
    const q = this.query;

    if (q.startsWith('SELECT t.id AS tenant_id')) {
      const [operatorId] = this.values;
      const rows = [];
      for (const membership of this.db.memberships.filter(row => row.user_id === operatorId && row.status === 'active')) {
        const tenant = this.db.tenants.get(membership.tenant_id);
        if (tenant && tenant.status !== 'disabled') {
          rows.push({
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
            tenant_name: tenant.name,
            tenant_status: tenant.status,
            tenant_default_account_id: tenant.default_account_id,
            role: membership.role,
            scopes_json: membership.scopes_json,
            member_default_account_id: membership.default_account_id,
          });
        }
      }
      return { success: true, results: rows.sort((a, b) => this.db.tenants.get(a.tenant_id).created_at - this.db.tenants.get(b.tenant_id).created_at) };
    }

    if (q.startsWith('SELECT id, tenant_id, slug')) {
      const [tenantId] = this.values;
      return {
        success: true,
        results: [...this.db.accounts.values()]
          .filter(row => row.tenant_id === tenantId && row.status !== 'disabled')
          .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.created_at - b.created_at),
      };
    }

    if (q.startsWith('SELECT id, app_secret, status, is_default')) {
      const [tenantId] = this.values;
      return {
        success: true,
        results: [...this.db.accounts.values()]
          .filter(row => row.tenant_id === tenantId && row.status !== 'disabled')
          .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.created_at - b.created_at),
      };
    }

    if (q.startsWith('SELECT id, operator_id, created_at, last_seen_at')) {
      const [operatorId, limit] = this.values;
      return {
        success: true,
        results: [...this.db.webSessions.values()]
          .filter(row => row.operator_id === operatorId)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit),
      };
    }

    if (q.startsWith('SELECT s.id, s.operator_id')) {
      const [operatorId, limit] = this.values;
      return {
        success: true,
        results: [...this.db.oauthTokenSessions.values()]
          .filter(row => row.operator_id === operatorId)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit)
          .map(row => ({
            ...row,
            client_name: this.db.oauthClients.get(row.client_id)?.client_name,
          })),
      };
    }

    if (q.startsWith('SELECT id, operator_id, requested_at')) {
      const [limit] = this.values;
      return {
        success: true,
        results: [...this.db.deletionRequests.values()]
          .filter(row => row.status === 'requested')
          .sort((a, b) => a.requested_at - b.requested_at)
          .slice(0, limit),
      };
    }

    if (q.startsWith('SELECT owner.tenant_id')) {
      const [operatorId] = this.values;
      const results = [...this.db.tenantOwners.values()]
        .filter(row => row.operator_id === operatorId)
        .map(row => ({
          tenant_id: row.tenant_id,
          stripe_subscription_id: this.db.entitlements.get(row.tenant_id)?.stripe_subscription_id ?? null,
        }));
      return { success: true, results };
    }

    throw new Error(`Unsupported SaaS D1 all query: ${q}`);
  }
}

const saasMigrationSql = readFileSync('./migrations/d1/0005_saas_onboarding_foundation.sql', 'utf8');
const requiredSaasTables = [
  'operators',
  'operator_identities',
  'operator_email_codes',
  'web_sessions',
  'oauth_clients',
  'oauth_consents',
  'oauth_token_sessions',
  'public_signup_rate_limits',
  'tenant_owners',
  'r2_media_retention_metadata',
  'inbound_message_retention_metadata',
  'monitoring_events',
  'operator_deletion_requests',
];
check(
  requiredSaasTables.every(table => saasMigrationSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) && /updated_at INTEGER NOT NULL/.test(saasMigrationSql),
  '0005 migration 声明 Operator/email-code/session/OAuth/retention/monitoring/deletion 基础表',
);
check(
  !/DROP TABLE|ALTER TABLE/i.test(saasMigrationSql),
  '0005 migration additive-only，不破坏既有 Workers/D1 表',
);
check(
  PLAN_QUOTA_POLICIES.free.limits.tool_calls_month === 300 &&
    PLAN_QUOTA_POLICIES.plus.limits.tool_calls_month === 3000 &&
    PLAN_QUOTA_POLICIES.pro.limits.tool_calls_month === 30000,
  'Free/Plus/Pro 每月 tool-call allowance 对齐 OpenSpec 300/3000/30000',
);

const saasDb = new MemorySaasD1Database();
const saasStore = new D1SaasOnboardingStore(saasDb, 'STORAGE_SECRET');
await saasStore.ensureSchema();
const issuedCode = await saasStore.issueEmailCode({ email: 'Owner@Example.COM', code: '123456', codeId: 'code_ok', now: 1000 });
const verifiedCode = await saasStore.verifyEmailCode({ email: 'owner@example.com', code: '123456', displayName: '公众号运营者', now: 1000 + 60_000 });
const existingOperator = await saasStore.createOrResolveOperatorByEmail({ email: 'OWNER@example.com', now: 1000 + 61_000 });
await saasStore.linkOperatorIdentity({ operatorId: verifiedCode.operator.operatorId, provider: 'github', providerSubject: 'gh_123', verifiedEmail: 'owner@example.com', now: 1000 + 62_000 });
const githubOperator = await saasStore.findOperatorByProviderSubject('github', 'gh_123');
const expiredCode = await saasStore.issueEmailCode({ email: 'late@example.com', code: '654321', codeId: 'code_expired', now: 1000 });
const expiredVerify = await saasStore.verifyEmailCode({ email: 'late@example.com', code: '654321', now: 1000 + 11 * 60_000 });
await saasStore.issueEmailCode({ email: 'tries@example.com', code: '111111', codeId: 'code_attempts', now: 2000 });
let attemptResult;
for (let i = 0; i < 5; i += 1) {
  attemptResult = await saasStore.verifyEmailCode({ email: 'tries@example.com', code: '000000', now: 3000 + i });
}
const rate1 = await saasStore.recordRateLimitHit({ bucket: 'email', key: 'owner@example.com', windowMs: 60_000, limit: 1, now: 1000 });
const rate2 = await saasStore.recordRateLimitHit({ bucket: 'email', key: 'owner@example.com', windowMs: 60_000, limit: 1, now: 1001 });
const ownerLegacyUser = saasDb.users.get(verifiedCode.operator.operatorId);
check(
  issuedCode.expiresAt === 1000 + 10 * 60_000 &&
    verifiedCode.ok === true &&
    existingOperator.created === false &&
    ownerLegacyUser?.email === 'owner@example.com' &&
    githubOperator?.operatorId === verifiedCode.operator.operatorId &&
    expiredCode.codeId === 'code_expired' &&
    expiredVerify.ok === false && expiredVerify.reason === 'expired' &&
    attemptResult.ok === false && attemptResult.reason === 'attempt_limit' &&
    rate1.allowed === true && rate2.allowed === false,
  'D1SaasOnboardingStore email-code 身份创建/复用/GitHub 绑定/过期/5次尝试/限流语义正确',
);

await saasStore.registerOAuthClient({ clientId: 'cli_test', clientName: 'WOA CLI', redirectUris: ['http://127.0.0.1:8787/callback'], scopes: ['wechat.mcp'], now: 10_000 });
let invalidRedirectRejected = false;
try {
  await saasStore.registerOAuthClient({ clientId: 'bad_cli', clientName: 'Bad', redirectUris: ['http://evil.example/callback'], scopes: ['wechat.mcp'], now: 10_000 });
} catch {
  invalidRedirectRejected = true;
}
await saasStore.rememberOAuthConsent({ operatorId: verifiedCode.operator.operatorId, clientId: 'cli_test', scopes: ['woa:account:read', 'wechat.mcp'], now: 10_000 });
const rememberedConsent = await saasStore.hasOAuthConsent({ operatorId: verifiedCode.operator.operatorId, clientId: 'cli_test', scopes: ['wechat.mcp', 'woa:account:read'] });
const tokenSession = await saasStore.issueOAuthTokenSession({ operatorId: verifiedCode.operator.operatorId, clientId: 'cli_test', accessToken: 'ACCESS', refreshToken: 'REFRESH', scopes: ['wechat.mcp'], now: 10_000 });
const webSession = await saasStore.createWebSession({ operatorId: verifiedCode.operator.operatorId, sessionToken: 'WEB_SESSION', sessionId: 'sess_test', now: 10_000 });
const slidingSession = await saasStore.getWebSession('WEB_SESSION', 20_000);
const securitySessionsBeforeRevoke = await saasStore.listSecuritySessions(verifiedCode.operator.operatorId, { now: 20_000 });
const wrongOperatorRevoke = await saasStore.revokeSecuritySession({ operatorId: 'op_other', sessionId: tokenSession.sessionId, now: 20_500 });
const oauthScopedRevoke = await saasStore.revokeSecuritySession({ operatorId: verifiedCode.operator.operatorId, sessionId: tokenSession.sessionId, now: 20_600 });
await saasStore.revokeWebSession('sess_test', 21_000);
const revokedSession = await saasStore.getWebSession('WEB_SESSION', 22_000);
check(
  invalidRedirectRejected && rememberedConsent &&
    tokenSession.accessExpiresAt === 10_000 + 60 * 60 * 1000 &&
    tokenSession.refreshExpiresAt === 10_000 + 30 * 24 * 60 * 60 * 1000 &&
    webSession.expiresAt === 10_000 + 7 * 24 * 60 * 60 * 1000 &&
    slidingSession?.expiresAt === 20_000 + 7 * 24 * 60 * 60 * 1000 &&
    revokedSession === null &&
    securitySessionsBeforeRevoke.some(item => item.id === 'sess_test' && item.kind === 'web' && item.canRevoke) &&
    securitySessionsBeforeRevoke.some(item => item.id === tokenSession.sessionId && item.kind === 'oauth' && item.clientName === 'WOA CLI') &&
    wrongOperatorRevoke.revoked === false &&
    oauthScopedRevoke.revoked === true && oauthScopedRevoke.kind === 'oauth',
  'D1SaasOnboardingStore OAuth client/consent/token TTL、7天滑动 Web session、授权列表与 operator-scoped revoke 正确',
);

const bootstrap = await saasStore.bootstrapDefaultTenantForOperator({ operatorId: verifiedCode.operator.operatorId, tenantId: 'ten_owner', resourceId: 'acct_default_owner', now: 50_000 });
const repeatBootstrap = await saasStore.bootstrapDefaultTenantForOperator({ operatorId: verifiedCode.operator.operatorId, now: 51_000 });
const orphanOperator = await saasStore.createOrResolveOperatorByEmail({ email: 'orphan@example.com', operatorId: 'op_orphan', now: 51_100 });
saasDb.tenants.set('ten_orphan_partial', {
  id: 'ten_orphan_partial',
  slug: 'ten_orphan_partial',
  name: '半初始化租户',
  status: 'active',
  default_account_id: 'acct_orphan_partial',
  created_at: 51_101,
  updated_at: 51_101,
});
saasDb.tenantOwners.set('ten_orphan_partial', {
  tenant_id: 'ten_orphan_partial',
  operator_id: orphanOperator.operator.operatorId,
  created_at: 51_101,
});
const repairedBootstrap = await saasStore.bootstrapDefaultTenantForOperator({ operatorId: orphanOperator.operator.operatorId, now: 51_200 });
const repairedContext = await saasStore.getTenantContextForOperator(orphanOperator.operator.operatorId, { source: 'rest' });
const ownerContext = await saasStore.getTenantContextForOperator({ operatorId: verifiedCode.operator.operatorId, scopes: ['woa:tenant:read', 'woa:account:read', 'woa:account:write'], requestId: 'req_owner' }, { source: 'rest' });
const routeSession = await saasStore.createWebSession({ operatorId: verifiedCode.operator.operatorId, sessionToken: 'WEB_SESSION_ROUTE', sessionId: 'sess_route', now: 51_500 });
const sessionListResponse = await handleManagementApiRequest(
  new Request('https://worker.example.test/api/v1/sessions'),
  {
    trustedContext: ownerContext,
    onboardingStore: saasStore,
    createApiClient: async () => {
      throw new Error('Session list must not construct WeChat api client');
    },
  },
);
const sessionListBody = await sessionListResponse.json();
const sessionRevokeResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/sessions/${routeSession.sessionId}`, { method: 'DELETE' }),
  {
    trustedContext: ownerContext,
    onboardingStore: saasStore,
    createApiClient: async () => {
      throw new Error('Session revoke must not construct WeChat api client');
    },
  },
);
const sessionRevokeBody = await sessionRevokeResponse.json();
check(
  sessionListResponse.status === 200 &&
    sessionListBody.data?.sessions?.some(item => item.id === 'sess_route' && item.kind === 'web') &&
    sessionRevokeResponse.status === 200 &&
    sessionRevokeBody.data?.revoked === true &&
    sessionRevokeBody.data?.kind === 'web',
  'REST /api/v1/sessions 返回当前 Operator 授权列表并支持 operator-scoped revoke',
);

check(
  repairedBootstrap.created === false &&
    repairedBootstrap.tenant.tenantId === 'ten_orphan_partial' &&
    repairedContext.defaultAccountId === 'acct_orphan_partial' &&
    repairedContext.accounts.some(account => account.accountId === 'acct_orphan_partial') &&
    saasDb.entitlements.get('ten_orphan_partial')?.plan === 'free',
  'D1SaasOnboardingStore 可补全 GitHub 首登失败留下的半初始化 tenant_owner/tenant 记录',
);

const authWorkerIndexSource = readFileSync('./src/worker/index.ts', 'utf8');
const webLoginSource = readFileSync('./web/src/routes/login.tsx', 'utf8');
const githubAuthorizeUrl = new URL(createGitHubAuthorizeUrl({
  clientId: 'github_client_fixture',
  redirectUri: 'https://worker.example.test/auth/github/callback',
  state: 'STATE_FIXTURE',
}));
const githubOAuthCalls = [];
const githubAccessToken = await exchangeGitHubOAuthCode({
  clientId: 'github_client_fixture',
  clientSecret: 'github_secret_fixture',
  code: 'CODE_FIXTURE',
  redirectUri: 'https://worker.example.test/auth/github/callback',
  fetch: async (input, init = {}) => {
    githubOAuthCalls.push({
      url: String(input),
      method: init.method,
      accept: new Headers(init.headers).get('accept'),
      userAgent: new Headers(init.headers).get('user-agent'),
      bodyText: init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? ''),
    });
    return new Response(JSON.stringify({ access_token: 'gho_fixture', token_type: 'bearer', scope: 'user:email' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
const githubProfileCalls = [];
const githubProfile = await fetchGitHubOAuthProfile({
  accessToken: githubAccessToken,
  fetch: async (input, init = {}) => {
    githubProfileCalls.push({
      url: String(input),
      authorization: new Headers(init.headers).get('authorization'),
      apiVersion: new Headers(init.headers).get('x-github-api-version'),
      userAgent: new Headers(init.headers).get('user-agent'),
    });
    if (String(input).endsWith('/user')) {
      return new Response(JSON.stringify({ id: 123, login: 'octocat', name: 'Mona Octocat', email: 'public@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([
      { email: 'secondary@example.com', primary: false, verified: true },
      { email: 'primary@example.com', primary: true, verified: true },
      { email: 'unverified@example.com', primary: false, verified: false },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
const githubProfileWithoutVerifiedEmail = await fetchGitHubOAuthProfile({
  accessToken: 'gho_no_verified_email',
  fetch: async input => {
    if (String(input).endsWith('/user')) {
      return new Response(JSON.stringify({ id: '456', login: 'noemail', name: null, email: 'public@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([{ email: 'public@example.com', primary: true, verified: false }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
check(
  githubAuthorizeUrl.origin + githubAuthorizeUrl.pathname === 'https://github.com/login/oauth/authorize' &&
    githubAuthorizeUrl.searchParams.get('client_id') === 'github_client_fixture' &&
    githubAuthorizeUrl.searchParams.get('redirect_uri') === 'https://worker.example.test/auth/github/callback' &&
    githubAuthorizeUrl.searchParams.get('scope') === 'read:user user:email' &&
    githubAccessToken === 'gho_fixture' &&
    githubOAuthCalls[0]?.url === 'https://github.com/login/oauth/access_token' &&
    githubOAuthCalls[0]?.method === 'POST' &&
    githubOAuthCalls[0]?.accept === 'application/json' &&
    githubOAuthCalls[0]?.userAgent === 'ziikoo-woa/2.2.0' &&
    githubOAuthCalls[0]?.bodyText.includes('client_secret=github_secret_fixture') &&
    githubProfile.providerSubject === '123' &&
    githubProfile.login === 'octocat' &&
    githubProfile.displayName === 'Mona Octocat' &&
    githubProfile.verifiedEmail === 'primary@example.com' &&
    githubProfileCalls.some(call => call.url === 'https://api.github.com/user' && call.authorization === 'Bearer gho_fixture' && call.userAgent === 'ziikoo-woa/2.2.0') &&
    githubProfileCalls.some(call => call.url === 'https://api.github.com/user/emails' && call.apiVersion === '2022-11-28' && call.userAgent === 'ziikoo-woa/2.2.0') &&
    selectVerifiedGitHubEmail([{ email: 'unverified@example.com', primary: true, verified: false }]) === null &&
    githubProfileWithoutVerifiedEmail.verifiedEmail === null &&
    githubProfileWithoutVerifiedEmail.fallbackEmail === 'public@example.com',
  'GitHub OAuth helper 按官方 Web flow 换 token、读取 /user + /user/emails，并只信任 verified email',
);
check(
  authWorkerIndexSource.includes('/api/v1/auth/email-code/request') &&
    authWorkerIndexSource.includes('/api/v1/auth/email-code/verify') &&
    authWorkerIndexSource.includes('exchangeGitHubOAuthCode') &&
    authWorkerIndexSource.includes('fetchGitHubOAuthProfile') &&
    authWorkerIndexSource.includes('github_verified_email_required') &&
    authWorkerIndexSource.includes('handlePublicAuthRequest') &&
    authWorkerIndexSource.includes('handleWebSessionManagementApiRequest') &&
    authWorkerIndexSource.includes('renderAuthorizationConsentForm') &&
    authWorkerIndexSource.includes('store.bootstrapDefaultTenantForOperator') &&
    authWorkerIndexSource.includes('sessionCookie(sessionToken, request)') &&
    !authWorkerIndexSource.includes('授权密码不正确') &&
    webLoginSource.includes('cf-turnstile') &&
    webLoginSource.includes('/auth/github/callback?returnTo=') &&
    webLoginSource.includes('github_verified_email_required') &&
    webLoginSource.includes('/api/v1/auth/email-code/request') &&
    webLoginSource.includes('/api/v1/auth/email-code/verify'),
  'Worker/Web email-code + GitHub 登录 contract 已接入公开路由、HttpOnly session、首登 bootstrap、Turnstile 挂载与 consent 授权页，并移除共享密码提示',
);

let freeAllowanceRejected = false;
try {
  await saasStore.createWechatResource({ tenantId: 'ten_owner', name: '第二个资源', resourceId: 'acct_second_blocked', now: 52_000 });
} catch (error) {
  freeAllowanceRejected = error instanceof AccountAllowanceError;
}
await saasStore.upsertTenantEntitlement({ tenantId: 'ten_owner', plan: 'plus', now: 53_000 });
const secondResource = await saasStore.createWechatResource({ tenantId: 'ten_owner', name: '第二个资源', resourceId: 'acct_second', now: 54_000 });
const renamedResource = await saasStore.renameWechatResource({ tenantId: 'ten_owner', resourceId: 'acct_second', name: '已验证公众号', now: 55_000 });
await saasStore.setDefaultWechatResource({ tenantId: 'ten_owner', resourceId: 'acct_second', now: 56_000 });
const defaultSwitchedContext = await saasStore.getTenantContextForOperator(verifiedCode.operator.operatorId, { source: 'mcp' });
const failedBefore = await saasStore.getWechatResource('ten_owner', 'acct_second');
let failedValidationDidNotPersist = false;
try {
  await saasStore.validateAndPersistWechatCredentials({
    tenantId: 'ten_owner',
    resourceId: 'acct_second',
    config: { appId: 'wx_failed', appSecret: 'SHOULD_NOT_PERSIST' },
    validate: async () => { throw new Error('invalid credential'); },
    now: 57_000,
  });
} catch {
  const failedAfter = await saasStore.getWechatResource('ten_owner', 'acct_second');
  failedValidationDidNotPersist = failedBefore.hasAppSecret === false && failedAfter.hasAppSecret === false && failedAfter.appId === undefined;
}
const configured = await saasStore.configureValidatedWechatCredentials({
  tenantId: 'ten_owner',
  resourceId: 'acct_second',
  config: { appId: 'wx_valid', appSecret: 'APP_SECRET', token: 'WEBHOOK_TOKEN', encodingAESKey: 'abcdefghijklmnopqrstuvwxyzABCDEFG123456789' },
  tokenInfo: { accessToken: 'ACCESS_TOKEN', expiresIn: 7200, expiresAt: 99_999 },
  now: 58_000,
});
const configuredRawBeforeUpdate = { ...saasDb.accounts.get('acct_second') };
const reconfigured = await saasStore.configureValidatedWechatCredentials({
  tenantId: 'ten_owner',
  resourceId: 'acct_second',
  config: { appId: 'wx_valid', appSecret: 'UPDATED_APP_SECRET' },
  now: 58_500,
});
const configuredRawAfterUpdate = saasDb.accounts.get('acct_second');
const optionalCredentialsPreserved =
  configuredRawAfterUpdate.webhook_token === configuredRawBeforeUpdate.webhook_token &&
  configuredRawAfterUpdate.encoding_aes_key === configuredRawBeforeUpdate.encoding_aes_key;
const thirdResource = await saasStore.createWechatResource({ tenantId: 'ten_owner', name: '第三个资源', resourceId: 'acct_third', now: 59_000 });
let duplicateDenied = false;
try {
  await saasStore.configureValidatedWechatCredentials({
    tenantId: 'ten_owner',
    resourceId: thirdResource.accountId,
    config: { appId: 'wx_valid', appSecret: 'OTHER_SECRET' },
    now: 60_000,
  });
} catch (error) {
  duplicateDenied = error instanceof DuplicateAppIdError;
}
await saasStore.softDeleteWechatResource({ tenantId: 'ten_owner', resourceId: 'acct_second', confirmation: 'DELETE acct_second', now: 61_000 });
const released = await saasStore.configureValidatedWechatCredentials({
  tenantId: 'ten_owner',
  resourceId: thirdResource.accountId,
  config: { appId: 'wx_valid', appSecret: 'OTHER_SECRET' },
  now: 62_000,
});
const rawStoredSecond = saasDb.accounts.get('acct_second');
const rawStoredThird = saasDb.accounts.get('acct_third');
check(
  bootstrap.created === true && bootstrap.tenant.tenantId.startsWith('ten_') && bootstrap.resource.status === 'unconfigured' &&
    repeatBootstrap.created === false && ownerContext.defaultAccountId === 'acct_default_owner' &&
    freeAllowanceRejected && secondResource.status === 'unconfigured' && renamedResource.name === '已验证公众号' &&
    defaultSwitchedContext.defaultAccountId === 'acct_second' && failedValidationDidNotPersist &&
    configured.status === 'active' && configured.hasAppSecret && configured.hasWebhookToken && configured.hasEncodingAESKey &&
    reconfigured.hasWebhookToken && reconfigured.hasEncodingAESKey && optionalCredentialsPreserved &&
    duplicateDenied && rawStoredSecond.app_secret === null && rawStoredSecond.status === 'disabled' &&
    released.appId === 'wx_valid' && rawStoredThird.app_secret.startsWith('enc:'),
  'D1SaasOnboardingStore 首登 bootstrap、Free 账号上限、Plus 创建、重命名/默认切换、凭据验证非持久化、AppID 唯一与删除释放正确',
);

const mcpUsageStore = new D1UsageQuotaStore(new MemoryUsageD1Database());
await mcpUsageStore.upsertEntitlement({ tenantId: 'ten_owner', plan: 'plus', now: 63_000 });
const managementAuditEvents = [];
const managementAuditLog = {
  async write(event) {
    managementAuditEvents.push(event);
  },
  async list(query) {
    return managementAuditEvents
      .filter(event => event.tenantId === query.tenantId)
      .filter(event => !query.accountId || event.accountId === query.accountId)
      .filter(event => !query.action || event.action === query.action)
      .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 20));
  },
};
const managementTools = createTenantManagementMcpTools({
  onboardingStore: saasStore,
  usageStore: mcpUsageStore,
  auditLog: managementAuditLog,
  validateWechatCredentials: async () => ({ accessToken: 'MCP_ACCESS_TOKEN', expiresIn: 7200, expiresAt: 99_999 }),
});
const managementTool = name => managementTools.find(tool => tool.name === name);
const mcpApiClientStub = {
  getAuthManager() {
    return {
      async getConfig() { return null; },
      async setConfig() {},
    };
  },
};
const mcpScopes = [
  'wechat.mcp',
  'woa:context:read',
  'woa:tenant:read',
  'woa:tenant:write',
  'woa:account:read',
  'woa:account:write',
  'woa:usage:read',
  'woa:audit:read',
];
let mcpManagementContext = await saasStore.getTenantContextForOperator({
  operatorId: verifiedCode.operator.operatorId,
  scopes: mcpScopes,
  requestId: 'req_mcp_management',
}, { source: 'mcp' });
const tenantRenameResult = await managementTool('woa_tenant').handler({
  action: 'update',
  tenantId: 'ten_owner',
  displayName: 'MCP 管理租户',
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
const mcpCreatedResult = await managementTool('woa_account').handler({
  action: 'create',
  tenantId: 'ten_owner',
  name: 'MCP 新资源',
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
const mcpCreatedPayload = JSON.parse(mcpCreatedResult.content[0].text.split('\n').slice(1).join('\n'));
const mcpCreatedAccountId = mcpCreatedPayload.account.accountId;
const mcpAllowanceResult = await managementTool('woa_account').handler({
  action: 'create',
  tenantId: 'ten_owner',
  name: '超额资源',
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
mcpManagementContext = await saasStore.getTenantContextForOperator({
  operatorId: verifiedCode.operator.operatorId,
  scopes: mcpScopes,
  requestId: 'req_mcp_management_refresh',
}, { source: 'mcp' });
const mcpConfiguredResult = await managementTool('woa_account').handler({
  action: 'configure',
  tenantId: 'ten_owner',
  accountId: mcpCreatedAccountId,
  appId: 'wx1234567890abcdef',
  appSecret: 'abcdef0123456789abcdef0123456789',
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
const mcpDefaultResult = await managementTool('woa_account').handler({
  action: 'set_default',
  tenantId: 'ten_owner',
  accountId: mcpCreatedAccountId,
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
const mcpDeleteDenied = await managementTool('woa_account').handler({
  action: 'delete',
  tenantId: 'ten_owner',
  accountId: mcpCreatedAccountId,
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
const mcpDeleteAccepted = await managementTool('woa_account').handler({
  action: 'delete',
  tenantId: 'ten_owner',
  accountId: mcpCreatedAccountId,
  confirmation: `DELETE ${mcpCreatedAccountId}`,
  __woaContext: mcpManagementContext,
}, mcpApiClientStub);
const refreshedAfterMcpDelete = await saasStore.getTenantContextForOperator({
  operatorId: verifiedCode.operator.operatorId,
  scopes: mcpScopes,
  requestId: 'req_mcp_after_delete',
}, { source: 'mcp' });
const mcpContextResult = await managementTool('woa_context').handler({
  __woaContext: refreshedAfterMcpDelete,
}, mcpApiClientStub);
const mcpAuditResult = await managementTool('woa_audit').handler({
  tenantId: 'ten_owner',
  limit: 20,
  offset: 0,
  __woaContext: refreshedAfterMcpDelete,
}, mcpApiClientStub);
check(
  tenantRenameResult.isError !== true && saasDb.tenants.get('ten_owner').name === 'MCP 管理租户' &&
    mcpCreatedResult.isError !== true && mcpCreatedAccountId.startsWith('acct_') &&
    mcpAllowanceResult.isError === true && mcpAllowanceResult._meta?.error?.code === 'account_allowance_exceeded' &&
    mcpAllowanceResult._meta?.error?.details?.upgrade?.webUrl?.includes('/billing') &&
    mcpConfiguredResult.isError !== true && !mcpConfiguredResult.content[0].text.includes('abcdef0123456789abcdef0123456789') &&
    mcpDefaultResult.isError !== true &&
    mcpDeleteDenied.isError === true && mcpDeleteDenied._meta?.error?.code === 'confirmation_required' &&
    mcpDeleteAccepted.isError !== true && !refreshedAfterMcpDelete.accounts.some(account => account.accountId === mcpCreatedAccountId) &&
    mcpContextResult.content[0].text.includes('"plan"') && mcpContextResult.content[0].text.includes('"quota"') &&
    mcpAuditResult.content[0].text.includes('account.credentials_configured') &&
    !managementTools.some(tool => tool.name.includes('billing')) &&
    managementTool('woa_account').inputSchema.action.safeParse('checkout').success === false,
  'MCP 管理工具使用真实 D1 use case：租户更新、账号创建/配置/默认/删除、配额升级提示、审计查询且不创建 Stripe Checkout',
);

const tenantOwner = await saasStore.findTenantOwner('ten_owner');
await saasStore.upsertTenantEntitlement({ tenantId: 'ten_owner', plan: 'pro', now: 64_000 });
await saasStore.createWechatResource({ tenantId: 'ten_owner', name: '降级锁定资源 A', resourceId: 'acct_lock_a', now: 64_100 });
await saasStore.createWechatResource({ tenantId: 'ten_owner', name: '降级锁定资源 B', resourceId: 'acct_lock_b', now: 64_200 });
const configuredSecretBeforeLock = saasDb.accounts.get('acct_third').app_secret;
const downgradeLockResult = await saasStore.reconcileAccountAllowanceLocks({ tenantId: 'ten_owner', plan: 'free', now: 64_300 });
const lockedAccounts = [...saasDb.accounts.values()]
  .filter(row => row.tenant_id === 'ten_owner' && row.status === 'locked')
  .map(row => ({ ...row }));
const upgradeUnlockResult = await saasStore.reconcileAccountAllowanceLocks({ tenantId: 'ten_owner', plan: 'pro', now: 64_400 });
const allowanceReconciliationOk =
  tenantOwner?.verifiedEmail === 'owner@example.com' &&
  downgradeLockResult.locked.length === 3 &&
  lockedAccounts.length === 3 &&
  lockedAccounts.every(row => row.plan_lock_reason === 'plan:free:account_allowance:1') &&
  saasDb.accounts.get('acct_third').app_secret === configuredSecretBeforeLock &&
  upgradeUnlockResult.unlocked.length === 3 &&
  [...saasDb.accounts.values()].filter(row => row.tenant_id === 'ten_owner' && row.status === 'locked').length === 0;
check(
  allowanceReconciliationOk,
  allowanceReconciliationOk
    ? 'Tenant owner verified email 可用于 Stripe Customer；Free/Plus/Pro 账号上限降级锁定且升级可恢复，锁定过程不清除凭据'
    : `账号锁定 fixture 偏差：${JSON.stringify({ tenantOwner, downgradeLockResult, lockedAccounts, upgradeUnlockResult })}`,
);

const otherOperator = await saasStore.createOrResolveOperatorByEmail({ email: 'other@example.com', operatorId: 'op_other', now: 70_000 });
const otherBootstrap = await saasStore.bootstrapDefaultTenantForOperator({ operatorId: otherOperator.operator.operatorId, tenantId: 'ten_other', resourceId: 'acct_other', now: 71_000 });
const forbiddenResponse = await handleManagementApiRequest(
  new Request(`https://worker.example.test/api/v1/tenants/${otherBootstrap.tenant.tenantId}/accounts`, { headers: { authorization: 'Bearer TEST' } }),
  {
    trustedContext: ownerContext,
    createApiClient: async () => { throw new Error('cross-tenant denial must not construct WeChat API client'); },
  },
);
await saasStore.recordMonitoringEvent({ eventType: 'credential_validation_failed', tenantId: 'ten_owner', accountId: 'acct_third', metadata: { appSecret: 'RAW_SECRET', reason: 'relay' }, eventId: 'mon_test', now: 80_000 });
const deletionRequestId = await saasStore.requestOperatorDeletion({ operatorId: verifiedCode.operator.operatorId, requestId: 'del_test', supportNote: '请求删除', now: 81_000 });
check(
  forbiddenResponse.status === 403 &&
    JSON.parse(saasDb.monitoringEvents.get('mon_test').metadata_json).appSecret === '***' &&
    deletionRequestId === 'del_test' && saasDb.deletionRequests.get('del_test').status === 'requested',
  'SaaS repository 跨租户 REST 访问拒绝，监控事件脱敏，Operator 删除请求可审计记录',
);

const deletionOperator = await saasStore.createOrResolveOperatorByEmail({
  email: 'delete-me@example.com',
  operatorId: 'op_delete_fixture',
  now: 82_000,
});
const deletionBootstrap = await saasStore.bootstrapDefaultTenantForOperator({
  operatorId: deletionOperator.operator.operatorId,
  tenantId: 'ten_delete_fixture',
  resourceId: 'acct_delete_fixture',
  now: 82_100,
});
await saasStore.configureValidatedWechatCredentials({
  tenantId: deletionBootstrap.tenant.tenantId,
  resourceId: deletionBootstrap.resource.accountId,
  config: { appId: 'wx_delete_fixture', appSecret: 'DELETE_SECRET' },
  tokenInfo: { accessToken: 'DELETE_ACCESS_TOKEN', expiresIn: 7200, expiresAt: 999_999 },
  now: 82_200,
});
const deletionEntitlementRow = saasDb.entitlements.get(deletionBootstrap.tenant.tenantId);
Object.assign(deletionEntitlementRow, {
  plan: 'plus',
  status: 'active',
  stripe_customer_id: 'cus_delete_fixture',
  stripe_subscription_id: 'sub_delete_fixture',
});
await saasStore.createWebSession({
  operatorId: deletionOperator.operator.operatorId,
  sessionToken: 'DELETE_WEB_SESSION',
  sessionId: 'sess_delete_fixture',
  now: 82_300,
});
const deletionContext = await saasStore.getTenantContextForOperator(
  deletionOperator.operator.operatorId,
  { source: 'rest' },
);
const deletionDeniedResponse = await handleManagementApiRequest(
  new Request('https://worker.example.test/api/v1/me/deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE WRONG' }),
  }),
  {
    trustedContext: deletionContext,
    onboardingStore: saasStore,
    auditLog: managementAuditLog,
    createApiClient: async () => { throw new Error('Deletion request must not construct WeChat API client'); },
  },
);
const deletionAcceptedResponse = await handleManagementApiRequest(
  new Request('https://worker.example.test/api/v1/me/deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: `DELETE ${deletionOperator.operator.operatorId}` }),
  }),
  {
    trustedContext: deletionContext,
    onboardingStore: saasStore,
    auditLog: managementAuditLog,
    createApiClient: async () => { throw new Error('Deletion request must not construct WeChat API client'); },
  },
);
const deletionAcceptedBody = await deletionAcceptedResponse.json();
const pendingDeletionRequests = await saasStore.listPendingOperatorDeletionRequests();
const cancelledSubscriptions = [];
const executedDeletion = await saasStore.executeOperatorDeletion({
  requestId: deletionAcceptedBody.data.requestId,
  operatorId: deletionOperator.operator.operatorId,
  cancelStripeSubscription: async subscriptionId => cancelledSubscriptions.push(subscriptionId),
  now: 82_400,
});
const deletedAccountRow = saasDb.accounts.get(deletionBootstrap.resource.accountId);
check(
  deletionDeniedResponse.status === 409 &&
    deletionAcceptedResponse.status === 202 &&
    pendingDeletionRequests.some(item => item.requestId === deletionAcceptedBody.data.requestId) &&
    cancelledSubscriptions[0] === 'sub_delete_fixture' &&
    executedDeletion.subscriptionsCancelled === 1 &&
    deletedAccountRow.status === 'disabled' &&
    deletedAccountRow.app_secret === null &&
    saasDb.entitlements.get(deletionBootstrap.tenant.tenantId).plan === 'free' &&
    saasDb.webSessions.get('sess_delete_fixture').revoked_at === 82_400 &&
    saasDb.operators.get(deletionOperator.operator.operatorId).status === 'disabled' &&
    saasDb.deletionRequests.get(deletionAcceptedBody.data.requestId).status === 'completed',
  'Operator 删除请求强制确认；执行时取消 Stripe 订阅、清除微信凭据、撤销会话并停用租户访问',
);

class MemoryMaintenanceD1Database {
  auditRows = [{ id: 1, occurred_at: 1 }, { id: 2, occurred_at: Date.UTC(2026, 6, 1) }];
  inboundRows = [{ received_at: 1 }, { received_at: Date.UTC(2026, 6, 1) }];
  accountInboundRows = [{ received_at: 1 }, { received_at: Date.UTC(2026, 6, 1) }];
  mediaRows = new Map([
    ['staging/expired-ok.png', { object_key: 'staging/expired-ok.png', expires_at: 1, deleted_at: null }],
    ['staging/expired-fail.png', { object_key: 'staging/expired-fail.png', expires_at: 2, deleted_at: null }],
    ['staging/fresh.png', { object_key: 'staging/fresh.png', expires_at: Date.UTC(2026, 7, 30), deleted_at: null }],
  ]);

  prepare(query) {
    const db = this;
    const normalized = query.replace(/\s+/g, ' ').trim();
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return null; },
      async all() {
        if (normalized === 'PRAGMA table_info(audit_logs)') {
          return {
            success: true,
            results: [
              { name: 'id' },
              { name: 'tenant_id' },
              { name: 'account_id' },
              { name: 'occurred_at' },
            ],
          };
        }
        if (normalized.startsWith('SELECT object_key')) {
          const [now, limit] = this.values;
          return {
            success: true,
            results: [...db.mediaRows.values()]
              .filter(row => row.expires_at <= now && row.deleted_at === null)
              .sort((a, b) => a.expires_at - b.expires_at)
              .slice(0, limit),
          };
        }
        if (normalized.startsWith('SELECT id, operator_id, requested_at')) {
          return { success: true, results: [] };
        }
        return { success: true, results: [] };
      },
      async run() {
        if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX')) {
          return { success: true, meta: { changes: 0 } };
        }
        if (normalized.startsWith('DELETE FROM audit_logs')) {
          const [cutoff] = this.values;
          const before = db.auditRows.length;
          db.auditRows = db.auditRows.filter(row => row.occurred_at >= cutoff);
          return { success: true, meta: { changes: before - db.auditRows.length } };
        }
        if (normalized.startsWith('DELETE FROM inbound_messages')) {
          const [cutoff] = this.values;
          const before = db.inboundRows.length;
          db.inboundRows = db.inboundRows.filter(row => row.received_at >= cutoff);
          return { success: true, meta: { changes: before - db.inboundRows.length } };
        }
        if (normalized.startsWith('DELETE FROM account_inbound_messages')) {
          const [cutoff] = this.values;
          const before = db.accountInboundRows.length;
          db.accountInboundRows = db.accountInboundRows.filter(row => row.received_at >= cutoff);
          return { success: true, meta: { changes: before - db.accountInboundRows.length } };
        }
        if (normalized.startsWith('UPDATE r2_media_retention_metadata')) {
          const [deletedAt, objectKey] = this.values;
          const row = db.mediaRows.get(objectKey);
          if (row && row.deleted_at === null) row.deleted_at = deletedAt;
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        throw new Error(`Unsupported maintenance D1 query: ${normalized}`);
      },
    };
  }

  async exec() { return {}; }
}

const maintenanceNow = Date.UTC(2026, 6, 16);
const maintenanceDb = new MemoryMaintenanceD1Database();
const maintenanceDeletedKeys = [];
const maintenanceResult = await runRetentionMaintenance({
  db: maintenanceDb,
  now: maintenanceNow,
  mediaBucket: {
    async put() { return null; },
    async delete(key) {
      if (key.endsWith('fail.png')) throw new Error('fixture delete failure');
      maintenanceDeletedKeys.push(key);
    },
  },
});
const releaseMigrationSql = readFileSync('./migrations/d1/0006_saas_release_completion.sql', 'utf8');
const wranglerSource = readFileSync('./wrangler.jsonc', 'utf8');
check(
  maintenanceResult.auditLogsDeleted === 1 &&
    maintenanceResult.inboundMessagesDeleted === 1 &&
    maintenanceResult.accountInboundMessagesDeleted === 1 &&
    maintenanceResult.r2ObjectsDeleted === 1 &&
    maintenanceResult.r2ObjectsFailed === 1 &&
    maintenanceDeletedKeys[0] === 'staging/expired-ok.png' &&
    releaseMigrationSql.includes('DELETE FROM access_tokens') &&
    releaseMigrationSql.includes("tenant_id = 'tenant_default' AND id = 'acct_default'") &&
    wranglerSource.includes('"17 3 * * *"'),
  '每日 retention 任务清理 180 天审计、90 天入站消息、30 天 R2 ledger 并可重试失败项；迁移会清除 legacy 微信 secret/token',
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
    if (this.query === 'PRAGMA table_info(audit_logs)') {
      return {
        success: true,
        results: [
          { name: 'id' },
          { name: 'tenant_id' },
          { name: 'account_id' },
          { name: 'occurred_at' },
        ],
      };
    }

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

class LegacyAuditD1Database {
  auditRows = [];
  queries = [];

  prepare(query) {
    return new LegacyAuditD1Statement(this, query);
  }
}

class LegacyAuditD1Statement {
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
    this.db.queries.push(this.query);
    if (this.query.startsWith('CREATE TABLE IF NOT EXISTS audit_logs')) {
      return { success: true, meta: { changes: 0 } };
    }
    if (this.query.startsWith('CREATE INDEX')) {
      if (this.query.includes('occurred_at')) {
        throw new Error('D1_ERROR: no such column: occurred_at at offset 79: SQLITE_ERROR');
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (this.query.startsWith('INSERT INTO audit_logs')) {
      if (this.query.includes('occurred_at')) {
        throw new Error('D1_ERROR: table audit_logs has no column named occurred_at: SQLITE_ERROR');
      }
      const [userId, oauthClientId, tenantId, accountId, action, targetType, targetId, requestId, metadataJson, createdAt] = this.values;
      this.db.auditRows.push({
        id: 1,
        user_id: userId,
        oauth_client_id: oauthClientId,
        tenant_id: tenantId,
        account_id: accountId,
        action,
        target_type: targetType,
        target_id: targetId,
        request_id: requestId,
        metadata_json: metadataJson,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.query.startsWith('DELETE FROM audit_logs')) {
      if (this.query.includes('occurred_at')) {
        throw new Error('D1_ERROR: no such column: occurred_at: SQLITE_ERROR');
      }
      const before = this.db.auditRows.length;
      this.db.auditRows = this.db.auditRows.filter(row => row.created_at >= this.values[0]);
      return { success: true, meta: { changes: before - this.db.auditRows.length } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async all() {
    this.db.queries.push(this.query);
    if (this.query === 'PRAGMA table_info(audit_logs)') {
      return {
        success: true,
        results: [
          { name: 'id' },
          { name: 'tenant_id' },
          { name: 'account_id' },
          { name: 'created_at' },
        ],
      };
    }
    if (this.query.startsWith('SELECT id,')) {
      if (!this.query.includes('created_at AS occurred_at')) {
        throw new Error('D1_ERROR: no such column: occurred_at at offset 79: SQLITE_ERROR');
      }
      return {
        success: true,
        results: this.db.auditRows.map(row => ({ ...row, occurred_at: row.created_at })),
      };
    }
    throw new Error(`Unsupported legacy audit all query: ${this.query}`);
  }

  async first() {
    throw new Error(`Unsupported legacy audit first query: ${this.query}`);
  }
}

const legacyAuditDb = new LegacyAuditD1Database();
const legacyAuditWriter = new D1AuditLogWriter(legacyAuditDb);
await legacyAuditWriter.write({
  tenantId: 'tenant_legacy',
  accountId: 'acct_legacy',
  action: 'account.status',
  occurredAt: 1710000500000,
});
const legacyAuditRows = await legacyAuditWriter.list({ tenantId: 'tenant_legacy' });
const legacyAuditPurged = await legacyAuditWriter.purgeOlderThan(1710000600000);
check(
  legacyAuditRows[0]?.occurredAt === 1710000500000 &&
    legacyAuditPurged === 1 &&
    legacyAuditDb.queries.some(query => query.includes('created_at AS occurred_at')),
  'AuditLogWriter 兼容已应用旧 migration 的 created_at 列并统一返回 occurredAt',
);

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
check(
  workerMediaTools.every(tool => !Object.prototype.hasOwnProperty.call(tool.inputSchema, 'fileData')) &&
    workerMediaTools.every(tool => !Object.prototype.hasOwnProperty.call(tool.inputSchema, 'filePath')),
  'Workers MCP 媒体工具 schema 不再向模型暴露 fileData/filePath，仅保留 fileUrl/r2Key',
);
const rejectingMediaApiClient = {
  async postForm() {
    throw new Error('postForm should not be called when media exceeds pre-upload limits');
  },
};

let crossTenantR2Reads = 0;
const scopedWorkerMediaTools = createWorkerMediaTools({
  mediaBucket: {
    async get() {
      crossTenantR2Reads += 1;
      return null;
    },
  },
});
const scopedUploadImgTool = scopedWorkerMediaTools.find(tool => tool.name === 'wechat_upload_img');
const crossTenantR2Result = await scopedUploadImgTool.handler({
  r2Key: 'staging/tenants/tenant_other/accounts/account_other/uploads/2026/07/10/cover.png',
  __woaAccountContext: {
    tenantId: 'tenant_current',
    accountId: 'account_current',
    account: {
      tenantId: 'tenant_current',
      accountId: 'account_current',
      slug: 'current',
      name: 'Current',
      status: 'active',
    },
  },
}, rejectingMediaApiClient);
check(
  crossTenantR2Result.isError === true &&
    crossTenantR2Result.content[0]?.text?.includes('R2 对象不属于当前租户/公众号账号') &&
    crossTenantR2Reads === 0,
  'Workers r2Key 对新租户化前缀执行账号隔离，跨账号 key 在读取 R2 前被拒绝',
);

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
