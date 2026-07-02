// 简单测试脚本验证工具注册与运行时 seam
import { existsSync, readFileSync } from 'fs';
import CryptoJS from 'crypto-js';
import { mcpTools, wechatTools } from './dist/src/mcp-tool/tools/index.js';
import { inboxMcpTool } from './dist/src/mcp-tool/tools/inbox-tool.js';
import { AccessTokenHttpExecutor } from './dist/src/wechat/http-executor.js';
import { WorkersHttpExecutor } from './dist/src/wechat/workers-http-executor.js';
import { D1StorageManager } from './dist/src/storage/d1-storage-manager.js';
import { D1InboxStore } from './dist/src/worker/inbox-store.js';
import { createWorkerMediaTools } from './dist/src/worker/media-tools.js';
import {
  createWechatSignature,
  decryptWechatMessage,
  handleWechatWebhook,
} from './dist/src/worker/wechat-webhook.js';

let failed = false;

function check(ok, message) {
  console.log(`${ok ? '✅' : '❌'} ${message}`);
  failed ||= !ok;
}

console.log('=== MCP工具注册验证 ===');
console.log(`总共注册的工具数量: ${mcpTools.length}`);
console.log('\n已注册的工具列表:');

mcpTools.forEach((tool, index) => {
  console.log(`${index + 1}. ${tool.name} - ${tool.description}`);
});

console.log('\n=== 验证结果 ===');
check(mcpTools.length === 16, mcpTools.length === 16
  ? '成功！所有16个工具都已正确注册为MCP工具'
  : `失败！期望16个工具，实际注册了${mcpTools.length}个工具`);

check(
  !existsSync('./dist/src/cli.js') &&
    !existsSync('./dist/src/mcp-server') &&
    readFileSync('./dist/src/worker/index.js', 'utf8').includes("serve('/mcp'"),
  '本地桌面 stdio/CLI 构建产物已移除，仅保留 Workers /mcp Streamable HTTP',
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

class MemoryInboxD1Database {
  rows = [];
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

    if (this.query.startsWith('UPDATE inbound_messages SET processed_at = ?')) {
      const [processedAt, note, ...ids] = this.values;
      let changes = 0;
      for (const row of this.db.rows) {
        if (ids.includes(row.id)) {
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
    if (this.query.includes('type = ?')) count += 1;
    if (this.query.includes('from_user_name = ?')) count += 1;
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
const textList = await d1InboxStore.listMessages({ pendingOnly: true, type: 'text', openid: 'openid_1' });
const markCount = await d1InboxStore.markProcessed({ ids: [1], note: 'done', processedAt: 1710000200000 });
const pendingAfterMark = await d1InboxStore.listMessages({ pendingOnly: true });
check(inboxD1.rows.length === 2 && textList.total === 1, 'D1InboxStore 入库去重并支持 type/openid/pending 过滤');
check(markCount === 1 && pendingAfterMark.total === 1, 'D1InboxStore mark_processed 更新 processed_at');

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
