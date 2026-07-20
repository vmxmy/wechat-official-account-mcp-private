import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { loadCliJsonObject, normalizeDraftArticlesInput, parseJsonObject } from '../src/cli/api-input.js';
import {
  assertToolConfirmation,
  createToolDryRun,
  filterWechatTools,
  redactSensitiveValue,
  requiredToolConfirmation,
} from '../src/cli/api-safety.js';
import { CliMcpApiClient, type CliMcpTool } from '../src/cli/mcp-api-client.js';
import { cliScopesForProfile, DEFAULT_CLI_SCOPES, WECHAT_FULL_CLI_SCOPES } from '../src/cli/oauth-scopes.js';
import { mcpTools } from '../src/mcp-tool/tools/index.js';

const execFileAsync = promisify(execFile);

test('CLI JSON input accepts one object source and rejects ambiguous or scalar input', async () => {
  assert.deepEqual(parseJsonObject('{"action":"count"}'), { action: 'count' });
  assert.throws(() => parseJsonObject('[]'), /must be an object/);
  assert.throws(() => parseJsonObject('{'), /Invalid JSON/);
  await assert.rejects(
    loadCliJsonObject({ input: '{}', stdin: true }, Readable.from(['{}'])),
    /exactly one JSON input source/,
  );
  assert.deepEqual(
    await loadCliJsonObject({ stdin: true }, Readable.from(['{"action":', '"list"}'])),
    { action: 'list' },
  );
});

test('draft article input normalizes article objects without changing full call objects', () => {
  assert.deepEqual(
    normalizeDraftArticlesInput({ title: '标题', content: '<p>正文</p>' }),
    { articles: [{ title: '标题', content: '<p>正文</p>' }] },
  );
  const full = { action: 'add', articles: [{ title: '标题' }] };
  assert.equal(normalizeDraftArticlesInput(full), full);
});

test('dangerous calls require exact confirmation and dry-run redacts secrets', () => {
  const tool: CliMcpTool = { name: 'wechat_draft', inputSchema: { type: 'object' } };
  assert.equal(requiredToolConfirmation(tool, { action: 'delete' }), 'wechat_draft:delete');
  assert.throws(() => assertToolConfirmation(tool, { action: 'delete' }), /--confirm wechat_draft:delete/);
  assert.doesNotThrow(() => assertToolConfirmation(tool, { action: 'delete' }, 'wechat_draft:delete'));
  assert.equal(requiredToolConfirmation(tool, { action: 'add' }), null);

  const preview = createToolDryRun('wechat_auth', {
    action: 'configure',
    appSecret: 'secret-value',
    nested: { refresh_token: 'refresh-value', title: 'safe' },
  });
  assert.deepEqual(preview.arguments, {
    action: 'configure',
    appSecret: '[REDACTED]',
    nested: { refresh_token: '[REDACTED]', title: 'safe' },
  });
  assert.equal(JSON.stringify(redactSensitiveValue({ authorization: 'Bearer value' })).includes('Bearer value'), false);
});

test('CLI gateway covers every current WeChat MCP tool without exposing management tools by default', () => {
  const advertised = mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object' as const },
  }));
  const filtered = filterWechatTools(advertised);
  assert.equal(filtered.length, 23);
  assert.deepEqual(
    filtered.map(tool => tool.name).sort(),
    mcpTools.filter(tool => tool.name.startsWith('wechat_')).map(tool => tool.name).sort(),
  );
  assert.equal(filtered.some(tool => tool.name.startsWith('woa_')), false);
});

test('full WeChat scope profile is explicit and default login stays least privilege', () => {
  assert.equal(cliScopesForProfile(), DEFAULT_CLI_SCOPES);
  assert.equal(DEFAULT_CLI_SCOPES.includes('woa:content:publish'), false);
  assert.equal(DEFAULT_CLI_SCOPES.includes('woa:inbox:read'), false);
  assert.equal(cliScopesForProfile('wechat-full'), WECHAT_FULL_CLI_SCOPES);
  assert.equal(WECHAT_FULL_CLI_SCOPES.includes('woa:content:publish'), true);
  assert.equal(WECHAT_FULL_CLI_SCOPES.includes('woa:inbox:read'), true);
  assert.throws(() => cliScopesForProfile('unknown'), /supports only wechat-full/);
});

test('authenticated Streamable HTTP client lists and calls tools', async t => {
  let authenticatedRequests = 0;
  const app = createMcpExpressApp();
  app.post('/mcp', async (request, response) => {
    if (request.headers.authorization !== 'Bearer test-access-token') {
      response.status(401).json({ error: 'invalid_token' });
      return;
    }
    authenticatedRequests += 1;
    const server = new McpServer({ name: 'woa-cli-test', version: '1.0.0' });
    server.registerTool('wechat_draft', {
      description: 'draft test tool',
      inputSchema: {
        action: z.enum(['count', 'add', 'get']),
        articles: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
        accountId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async ({ action, articles, accountId }) => ({
      content: [{
        type: 'text',
        text: action === 'count'
          ? 'count=3'
          : action === 'add'
            ? `created=${articles?.[0]?.title};account=${accountId}`
            : 'Missing required OAuth scope: woa:content:publish',
      }],
      ...(action === 'get' ? { isError: true } : {}),
    }));
    server.registerTool('woa_context', {
      description: 'management test tool',
      inputSchema: {},
    }, async () => ({ content: [{ type: 'text', text: 'context' }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
  });
  app.get('/mcp', (_request, response) => response.status(405).end());
  app.delete('/mcp', (_request, response) => response.status(405).end());
  app.get('/api/v1/me', (request, response) => {
    if (request.headers.authorization !== 'Bearer test-access-token') {
      response.status(401).json({ error: 'invalid_token' });
      return;
    }
    response.json({
      success: true,
      data: {
        defaultTenantId: 'tenant-1',
        defaultAccountId: 'account-1',
        tenants: [{ tenantId: 'tenant-1' }],
        accounts: [{ tenantId: 'tenant-1', accountId: 'account-1', isDefault: true }],
      },
    });
  });

  const httpServer = app.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  t.after(() => httpServer.close());
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');

  const client = new CliMcpApiClient({
    server: `http://127.0.0.1:${address.port}`,
    clientVersion: 'test',
    fetch: async (url, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', 'Bearer test-access-token');
      return await fetch(url, { ...init, headers });
    },
  });
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['wechat_draft', 'woa_context']);
  const result = await client.callTool('wechat_draft', { action: 'count' });
  assert.equal(result.isError, undefined);
  assert.equal((result.content[0] as { text?: string }).text, 'count=3');
  assert.ok(authenticatedRequests >= 3);

  const directory = await mkdtemp(path.join(tmpdir(), 'woa-cli-api-test-'));
  const configPath = path.join(directory, 'cli.json');
  const articlePath = path.join(directory, 'article.json');
  await writeFile(configPath, JSON.stringify({
    server: `http://127.0.0.1:${address.port}`,
    accessToken: 'test-access-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    activeTenantId: 'tenant-1',
    activeAccountId: 'account-1',
  }), { mode: 0o600 });
  await chmod(configPath, 0o600);
  await writeFile(articlePath, JSON.stringify({ title: 'CLI 草稿', content: '<p>正文</p>' }));
  const env = {
    ...process.env,
    WOA_CLI_CONFIG: configPath,
    WOA_INIT_DIR: path.join(directory, 'init-runs'),
  };
  const list = await execFileAsync(process.execPath, [
    '--import', 'tsx', 'src/cli/woa.ts', 'api', 'list',
  ], { cwd: process.cwd(), env });
  const listJson = JSON.parse(list.stdout);
  assert.deepEqual(listJson.data.tools.map((tool: { name: string }) => tool.name), ['wechat_draft']);

  const add = await execFileAsync(process.execPath, [
    '--import', 'tsx', 'src/cli/woa.ts',
    'draft', 'add', '--file', articlePath,
    '--tenant', 'tenant-1', '--account', 'account-1',
  ], { cwd: process.cwd(), env });
  const addJson = JSON.parse(add.stdout);
  assert.match(addJson.content[0].text, /created=CLI 草稿;account=account-1/);

  const requestCountBeforeDryRun = authenticatedRequests;
  const dryRun = await execFileAsync(process.execPath, [
    '--import', 'tsx', 'src/cli/woa.ts',
    'api', 'call', 'wechat_draft', '--input', '{"action":"delete","mediaId":"draft-1"}', '--dry-run',
  ], { cwd: process.cwd(), env });
  const dryRunJson = JSON.parse(dryRun.stdout);
  assert.equal(dryRunJson.dryRun, true);
  assert.equal(dryRunJson.requiredConfirmation, 'wechat_draft:delete');
  assert.equal(authenticatedRequests, requestCountBeforeDryRun);

  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import', 'tsx', 'src/cli/woa.ts',
      'api', 'call', 'wechat_draft', '--input', '{"action":"get"}',
      '--tenant', 'tenant-1', '--account', 'account-1',
    ], { cwd: process.cwd(), env }),
    error => {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      assert.equal(failure.code, 1);
      assert.equal(JSON.parse(failure.stdout ?? '{}').isError, true);
      assert.match(failure.stderr ?? '', /--scope-profile wechat-full/);
      return true;
    },
  );
});
