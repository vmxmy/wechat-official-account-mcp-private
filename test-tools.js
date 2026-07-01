// 简单测试脚本验证工具注册与运行时 seam
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import assert from 'assert/strict';
import { mcpTools } from './dist/src/mcp-tool/tools/index.js';
import { AccessTokenHttpExecutor } from './dist/src/wechat/http-executor.js';
import { NodeHttpExecutor } from './dist/src/wechat/node-http-executor.js';
import { WorkersHttpExecutor } from './dist/src/wechat/workers-http-executor.js';
import { SqliteStorageManager } from './dist/src/storage/storage-manager.js';
import { D1StorageManager } from './dist/src/storage/d1-storage-manager.js';

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
check(mcpTools.length === 15, mcpTools.length === 15
  ? '成功！所有15个工具都已正确注册为MCP工具'
  : `失败！期望15个工具，实际注册了${mcpTools.length}个工具`);

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
  [typeof NodeHttpExecutor === 'function', 'NodeHttpExecutor 已导出'],
  [typeof WorkersHttpExecutor === 'function', 'WorkersHttpExecutor 已导出'],
  [typeof SqliteStorageManager === 'function', 'SqliteStorageManager 已导出'],
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

console.log('\n=== D1/SQLite Storage fixture parity 验证 ===');

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

const tempDir = await mkdtemp(path.join(tmpdir(), 'wechat-mcp-sqlite-'));
const sqlitePath = path.join(tempDir, 'fixture.db');
const memoryD1 = new MemoryD1Database();
const d1Storage = new D1StorageManager(memoryD1, { get: async () => 'STORAGE_SECRET' });
const sqliteStorage = new SqliteStorageManager(sqlitePath, 'STORAGE_SECRET');

let storageParityOk = false;
try {
  const [d1Result, sqliteResult] = await Promise.all([
    exerciseStorage(d1Storage),
    exerciseStorage(sqliteStorage),
  ]);
  assert.deepStrictEqual(d1Result, sqliteResult);
  storageParityOk = true;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

check(storageParityOk, 'D1StorageManager 与 SqliteStorageManager fixture CRUD 结果一致');
check(memoryD1.config === null, 'D1StorageManager clearConfig 清空配置');
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

if (failed) {
  process.exit(1);
}
