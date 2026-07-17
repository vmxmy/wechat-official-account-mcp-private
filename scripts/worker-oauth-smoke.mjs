import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const persistDir = mkdtempSync(path.join(tmpdir(), 'woa-worker-oauth-smoke-'));
const logs = [];

applyLocalMigrations(persistDir);

const child = spawn(process.execPath, [
  wranglerEntry,
  'dev',
  '--local',
  '--port',
  String(port),
  '--log-level',
  'error',
  '--persist-to',
  persistDir,
  '--var',
  'ENVIRONMENT:development',
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NO_COLOR: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', chunk => logs.push(chunk.toString('utf8')));
child.stderr.on('data', chunk => logs.push(chunk.toString('utf8')));

try {
  await waitForWorker(origin, child, logs);

  const challenge = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'woa-worker-oauth-smoke', version: '1' },
      },
    }),
  });
  const authenticate = challenge.headers.get('www-authenticate') ?? '';
  assert.equal(challenge.status, 401);
  assert.match(authenticate, /^Bearer /);
  assert.match(authenticate, /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.match(authenticate, /error="invalid_token"/);

  const protectedResourceUrl = extractQuotedParameter(authenticate, 'resource_metadata');
  const protectedResourceResponse = await fetch(protectedResourceUrl);
  assert.equal(protectedResourceResponse.status, 200);
  const protectedResource = await protectedResourceResponse.json();
  assert.match(protectedResource.resource, /\/mcp$/);
  assert.ok(protectedResource.authorization_servers?.length > 0);
  assert.ok(protectedResource.scopes_supported?.includes('wechat.mcp'));
  assert.deepEqual(protectedResource.bearer_methods_supported, ['header']);

  const authorizationServerResponse = await fetch(`${origin}/.well-known/oauth-authorization-server`);
  assert.equal(authorizationServerResponse.status, 200);
  const authorizationServer = await authorizationServerResponse.json();
  assert.match(authorizationServer.authorization_endpoint, /\/authorize$/);
  assert.match(authorizationServer.token_endpoint, /\/oauth\/token$/);
  assert.match(authorizationServer.registration_endpoint, /\/oauth\/register$/);
  assert.ok(authorizationServer.grant_types_supported?.includes('authorization_code'));
  assert.ok(authorizationServer.grant_types_supported?.includes('refresh_token'));
  assert.deepEqual(authorizationServer.code_challenge_methods_supported, ['S256']);
  assert.ok(authorizationServer.revocation_endpoint);

  const redirectUri = `http://127.0.0.1:${port + 1}/callback`;
  const registrationResponse = await fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'WOA Worker OAuth smoke',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  assert.ok(registration.client_id);
  assert.deepEqual(registration.redirect_uris, [redirectUri]);
  assert.equal(registration.token_endpoint_auth_method, 'none');

  const email = `worker-smoke-${Date.now()}@example.com`;
  const codeRequest = await fetch(`${origin}/api/v1/auth/email-code/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  await assertResponseStatus(codeRequest, 200, 'email-code request', logs);
  const codeRequestBody = await codeRequest.json();
  assert.equal(codeRequestBody.data.delivery, 'not_configured');
  assert.match(codeRequestBody.data.debugCode, /^\d{6}$/);

  const codeVerify = await fetch(`${origin}/api/v1/auth/email-code/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: codeRequestBody.data.debugCode }),
  });
  await assertResponseStatus(codeVerify, 200, 'email-code verify', logs);
  const codeVerifyBody = await codeVerify.json();
  const webSessionId = codeVerifyBody.data.session.sessionId;
  const sessionCookie = cookieFromResponse(codeVerify);
  assert.ok(sessionCookie);

  const me = await fetch(`${origin}/api/v1/me`, { headers: { cookie: sessionCookie } });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.data.user.email, email);
  const tenantId = meBody.data.defaultTenantId;
  const accountId = meBody.data.defaultAccountId;
  assert.ok(tenantId && accountId);

  const verifier = randomBytes(32).toString('base64url');
  const challengeValue = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL('/authorize', origin);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', registration.client_id);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', [
    'wechat.mcp',
    'woa:context:read',
    'woa:tenant:read',
    'woa:account:read',
    'woa:content:read',
    'woa:usage:read',
    'woa:security:read',
    'woa:security:write',
  ].join(' '));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challengeValue);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const consentPage = await fetch(authorize, {
    headers: { cookie: sessionCookie },
    redirect: 'manual',
  });
  assert.equal(consentPage.status, 200);
  assert.match(await consentPage.text(), /授权访问微信公众号 MCP/);

  const consent = await fetch(authorize, {
    method: 'POST',
    headers: {
      cookie: sessionCookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ consent: 'approve' }),
    redirect: 'manual',
  });
  assert.equal(consent.status, 302);
  const callback = new URL(consent.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), state);
  assert.ok(callback.searchParams.get('code'));

  const tokenResponse = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: registration.client_id,
      code: callback.searchParams.get('code'),
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const token = await tokenResponse.json();
  assert.ok(token.access_token && token.refresh_token);

  const refreshResponse = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: registration.client_id,
      refresh_token: token.refresh_token,
    }),
  });
  assert.equal(refreshResponse.status, 200);
  const refreshed = await refreshResponse.json();
  assert.ok(refreshed.access_token && refreshed.refresh_token);
  assert.notEqual(refreshed.refresh_token, token.refresh_token);

  const mcpHeaders = {
    authorization: `Bearer ${refreshed.access_token}`,
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  const initialized = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'woa-worker-oauth-smoke', version: '1' },
      },
    }),
  });
  assert.equal(initialized.status, 200);
  const mcpSessionId = initialized.headers.get('mcp-session-id');
  assert.ok(mcpSessionId);
  const initializeMessage = await mcpMessage(initialized);
  assert.equal(initializeMessage.result.serverInfo.name, 'wechat-official-account-mcp');

  const toolsResponse = await mcpRequest({
    origin,
    headers: mcpHeaders,
    sessionId: mcpSessionId,
    id: 3,
    method: 'tools/list',
  });
  assert.equal(toolsResponse.result.tools.length, 27);
  assert.ok(toolsResponse.result.tools.some(tool => tool.name === 'woa_context'));

  const contextResponse = await mcpRequest({
    origin,
    headers: mcpHeaders,
    sessionId: mcpSessionId,
    id: 4,
    method: 'tools/call',
    params: { name: 'woa_context', arguments: {} },
  });
  const contextText = contextResponse.result.content?.[0]?.text ?? '';
  assert.match(contextText, new RegExp(tenantId));
  assert.match(contextText, new RegExp(accountId));
  assert.doesNotMatch(contextText, /appSecret|access_token|refresh_token/);

  const accountStatus = await fetch(
    `${origin}/api/v1/tenants/${tenantId}/accounts/${accountId}/status`,
    { headers: { authorization: `Bearer ${refreshed.access_token}` } },
  );
  assert.equal(accountStatus.status, 200);
  assert.equal((await accountStatus.json()).data.configured, false);

  const sessions = await fetch(`${origin}/api/v1/sessions`, { headers: { cookie: sessionCookie } });
  assert.equal(sessions.status, 200);
  assert.ok((await sessions.json()).data.sessions.some(session => session.id === webSessionId));
  const revoked = await fetch(`${origin}/api/v1/sessions/${webSessionId}`, {
    method: 'DELETE',
    headers: { cookie: sessionCookie },
  });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).data.revoked, true);
  assert.equal((await fetch(`${origin}/api/v1/me`, { headers: { cookie: sessionCookie } })).status, 401);

  process.stdout.write(`${JSON.stringify({
    challenge: true,
    protectedResourceMetadata: true,
    authorizationServerMetadata: true,
    dynamicClientRegistration: true,
    emailLogin: true,
    webSession: true,
    consent: true,
    pkce: true,
    refreshRotation: true,
    mcpInitialize: true,
    toolsList: 27,
    context: true,
    accountStatus: true,
    sessionRevocation: true,
  })}\n`);
} finally {
  await stopChild(child);
  rmSync(persistDir, { recursive: true, force: true });
}

function applyLocalMigrations(persistenceDirectory) {
  const result = spawnSync(process.execPath, [
    wranglerEntry,
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--persist-to',
    persistenceDirectory,
  ], {
    cwd: projectRoot,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Failed to apply local D1 migrations.\n${result.stderr || result.stdout}`);
  }
}

async function assertResponseStatus(response, expected, label, output) {
  if (response.status === expected) return;
  const body = await response.clone().text().catch(() => '<unreadable>');
  assert.equal(
    response.status,
    expected,
    `${label} failed. body=${body}\nwrangler=${output.join('')}`,
  );
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(selectedPort));
    });
  });
}

async function waitForWorker(workerOrigin, processHandle, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Wrangler exited before readiness (${processHandle.exitCode}).\n${output.join('')}`);
    }
    try {
      const response = await fetch(`${workerOrigin}/health`);
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Wrangler.\n${output.join('')}`);
}

function extractQuotedParameter(header, name) {
  const match = new RegExp(`${name}="([^"]+)"`).exec(header);
  assert.ok(match?.[1], `Missing ${name} in WWW-Authenticate.`);
  return match[1];
}

function cookieFromResponse(response) {
  return (response.headers.get('set-cookie') ?? '').split(';', 1)[0];
}

async function mcpRequest({ origin: workerOrigin, headers, sessionId, id, method, params }) {
  const response = await fetch(`${workerOrigin}/mcp`, {
    method: 'POST',
    headers: { ...headers, 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });
  assert.equal(response.status, 200);
  return await mcpMessage(response);
}

async function mcpMessage(response) {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split('\n').find(line => line.startsWith('data: '));
    assert.ok(data, `Missing MCP SSE data line: ${text}`);
    return JSON.parse(data.slice('data: '.length));
  }
  return JSON.parse(text);
}

async function stopChild(processHandle) {
  if (processHandle.exitCode !== null) return;
  processHandle.kill('SIGINT');
  const exited = await Promise.race([
    new Promise(resolve => processHandle.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited && processHandle.exitCode === null) {
    processHandle.kill('SIGTERM');
    await new Promise(resolve => processHandle.once('exit', resolve));
  }
}
