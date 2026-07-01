// 简单测试脚本验证工具注册
import { mcpTools } from './dist/src/mcp-tool/tools/index.js';
import { AccessTokenHttpExecutor } from './dist/src/wechat/http-executor.js';
import { NodeHttpExecutor } from './dist/src/wechat/node-http-executor.js';
import { SqliteStorageManager } from './dist/src/storage/storage-manager.js';

console.log('=== MCP工具注册验证 ===');
console.log(`总共注册的工具数量: ${mcpTools.length}`);
console.log('\n已注册的工具列表:');

mcpTools.forEach((tool, index) => {
  console.log(`${index + 1}. ${tool.name} - ${tool.description}`);
});

console.log('\n=== 验证结果 ===');
let failed = false;

if (mcpTools.length === 15) {
  console.log('✅ 成功！所有15个工具都已正确注册为MCP工具');
} else {
  console.log(`❌ 失败！期望15个工具，实际注册了${mcpTools.length}个工具`);
  failed = true;
}

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
  [typeof SqliteStorageManager === 'function', 'SqliteStorageManager 已导出'],
  [fakeExecutor.calls[0]?.path === '/cgi-bin/user/get?access_token=TEST_TOKEN', 'GET 自动注入 access_token'],
  [fakeExecutor.calls[1]?.path === '/cgi-bin/menu/delete?access_token=EXISTING_TOKEN', '已有 access_token 不重复注入'],
  [fakeExecutor.calls[2]?.path === '/cgi-bin/media/upload?type=image&access_token=TEST_TOKEN', 'postForm 保留 query 并注入 access_token'],
];

for (const [ok, message] of seamChecks) {
  console.log(`${ok ? '✅' : '❌'} ${message}`);
  failed ||= !ok;
}

if (failed) {
  process.exit(1);
}
