#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_ACCOUNT_ID, DEFAULT_TENANT_ID } from '../storage/types.js';

interface CliConfig {
  server?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  activeTenantId?: string;
  activeAccountId?: string;
  pkce?: {
    verifier: string;
    state: string;
  };
}

interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean>;
}

const DEFAULT_CLIENT_ID = 'woa-cli';
const DEFAULT_SCOPES = [
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
].join(' ');
const CONFIG_PATH = process.env.WOA_CLI_CONFIG || path.join(homedir(), '.config', 'wechat-official-account-mcp', 'cli.json');

interface OAuthServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
}

interface OAuthClientRegistration {
  client_id: string;
  client_secret?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface LocalCallbackServer {
  redirectUri: string;
  waitForCode: Promise<string>;
  close: () => Promise<void>;
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const [root, sub, leaf] = parsed.command;

  if (!root || root === 'help' || parsed.flags.help || parsed.flags.h) {
    printHelp();
    return;
  }

  if (root === 'login') {
    await login(parsed.flags);
    return;
  }

  if (root === 'whoami') {
    console.log(JSON.stringify(await apiGet('/api/v1/me', parsed.flags), null, 2));
    return;
  }

  if (root === 'tenant' && sub === 'list') {
    console.log(JSON.stringify(await apiGet('/api/v1/tenants', parsed.flags), null, 2));
    return;
  }

  if (root === 'tenant' && sub === 'usage') {
    const tenantId = await resolveTenantId(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/usage`, parsed.flags), null, 2));
    return;
  }

  if (root === 'usage') {
    const tenantId = await resolveTenantId(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/usage`, parsed.flags), null, 2));
    return;
  }

  if (root === 'account') {
    await handleAccountCommand(sub, parsed.flags);
    return;
  }

  if (root === 'draft' && sub === 'list') {
    const { tenantId, accountId } = await resolveTenantAccount(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/drafts${paginationQuery(parsed.flags)}`, parsed.flags), null, 2));
    return;
  }

  if (root === 'publish' && sub === 'list') {
    const { tenantId, accountId } = await resolveTenantAccount(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/publishes${paginationQuery(parsed.flags)}`, parsed.flags), null, 2));
    return;
  }

  if (root === 'inbox' && sub === 'list') {
    const { tenantId, accountId } = await resolveTenantAccount(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/inbox${paginationQuery(parsed.flags)}`, parsed.flags), null, 2));
    return;
  }

  if (root === 'mcp' && sub === 'config') {
    await writeMcpConfig(leaf, parsed.flags);
    return;
  }

  throw new Error(`Unknown command: ${parsed.command.join(' ')}`);
}

async function handleAccountCommand(sub: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  if (sub === 'list') {
    const tenantId = await resolveTenantId(flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts`, flags), null, 2));
    return;
  }

  if (sub === 'status') {
    const { tenantId, accountId } = await resolveTenantAccount(flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/status`, flags), null, 2));
    return;
  }

  if (sub === 'configure') {
    const { tenantId, accountId } = await resolveTenantAccount(flags);
    const body = {
      appId: stringFlag(flags, 'app-id') || stringFlag(flags, 'appId'),
      appSecret: stringFlag(flags, 'app-secret') || stringFlag(flags, 'appSecret'),
      token: stringFlag(flags, 'token'),
      encodingAESKey: stringFlag(flags, 'encoding-aes-key') || stringFlag(flags, 'encodingAESKey'),
    };
    if (!body.appId || !body.appSecret) {
      throw new Error('account configure requires --app-id and --app-secret. The secret is sent to the remote server and is never saved locally.');
    }
    console.log(JSON.stringify(await apiPost(`/api/v1/tenants/${tenantId}/accounts/${accountId}/configure`, body, flags), null, 2));
    return;
  }

  if (sub === 'token' && flags.refresh) {
    const { tenantId, accountId } = await resolveTenantAccount(flags);
    console.log(JSON.stringify(await apiPost(`/api/v1/tenants/${tenantId}/accounts/${accountId}/token/refresh`, {}, flags), null, 2));
    return;
  }

  throw new Error(`Unknown account command: account ${sub ?? ''}`.trim());
}

async function login(flags: Record<string, string | boolean>): Promise<void> {
  const server = normalizeServer(requiredString(flags, 'server', 'login requires --server <url>'));
  const requestedClientId = stringFlag(flags, 'client-id') || DEFAULT_CLIENT_ID;
  const token = stringFlag(flags, 'token');

  if (token) {
    await saveConfig({ ...(await loadConfig()), server, clientId: requestedClientId, accessToken: token });
    console.log(`Saved OAuth access token for ${server}. No WeChat app secret was stored locally.`);
    return;
  }

  const metadata = await discoverOAuthMetadata(server);
  const scope = stringFlag(flags, 'scope') || stringFlag(flags, 'scopes') || DEFAULT_SCOPES;
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  const timeoutSeconds = Number(stringFlag(flags, 'timeout') || '300');
  const callbackPort = Number(stringFlag(flags, 'callback-port') || '0');
  const callback = await startLocalCallbackServer(state, Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 300_000, callbackPort);
  const registration = await registerOAuthClient(metadata, server, callback.redirectUri, requestedClientId, scope);
  const authorizeUrl = new URL(metadata.authorization_endpoint || new URL('/authorize', server).toString());
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', registration.client_id);
  authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', scope);

  await saveConfig({
    ...(await loadConfig()),
    server,
    clientId: registration.client_id,
    clientSecret: registration.client_secret,
    pkce: { verifier, state },
  });

  console.log('Open this OAuth URL in a browser to continue login:');
  console.log(authorizeUrl.toString());
  if (!flags['no-open']) {
    openBrowser(authorizeUrl.toString());
  }
  console.log(`Waiting for OAuth callback on ${callback.redirectUri} ...`);

  try {
    const code = await callback.waitForCode;
    const tokenResponse = await exchangeAuthorizationCode(metadata, server, {
      code,
      verifier,
      redirectUri: callback.redirectUri,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
    });
    await saveConfig({
      ...(await loadConfig()),
      server,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type,
      scope: tokenResponse.scope || scope,
      expiresAt: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : undefined,
      pkce: undefined,
    });
    console.log(`OAuth login complete for ${server}. Token saved to ${CONFIG_PATH}; no WeChat app secret was stored locally.`);
  } finally {
    await callback.close();
  }
}

async function discoverOAuthMetadata(server: string): Promise<OAuthServerMetadata> {
  const fallback = {
    authorization_endpoint: new URL('/authorize', server).toString(),
    token_endpoint: new URL('/oauth/token', server).toString(),
    registration_endpoint: new URL('/oauth/register', server).toString(),
  };
  try {
    const response = await fetch(new URL('/.well-known/oauth-authorization-server', server));
    if (!response.ok) return fallback;
    return { ...fallback, ...await response.json() as OAuthServerMetadata };
  } catch {
    return fallback;
  }
}

async function registerOAuthClient(
  metadata: OAuthServerMetadata,
  server: string,
  redirectUri: string,
  requestedClientId: string,
  scope: string,
): Promise<OAuthClientRegistration> {
  const endpoint = metadata.registration_endpoint || new URL('/oauth/register', server).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: requestedClientId,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope,
    }),
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(`OAuth client registration failed with ${response.status}: ${text}`);
  }
  const clientId = typeof (data as { client_id?: unknown })?.client_id === 'string'
    ? (data as { client_id: string }).client_id
    : '';
  if (!clientId) {
    throw new Error(`OAuth client registration did not return client_id: ${text}`);
  }
  return {
    client_id: clientId,
    client_secret: typeof (data as { client_secret?: unknown })?.client_secret === 'string'
      ? (data as { client_secret: string }).client_secret
      : undefined,
  };
}

async function exchangeAuthorizationCode(
  metadata: OAuthServerMetadata,
  server: string,
  input: {
    code: string;
    verifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret?: string;
  },
): Promise<OAuthTokenResponse> {
  const endpoint = metadata.token_endpoint || new URL('/oauth/token', server).toString();
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', input.code);
  body.set('redirect_uri', input.redirectUri);
  body.set('client_id', input.clientId);
  body.set('code_verifier', input.verifier);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with ${response.status}: ${text}`);
  }
  const accessToken = typeof (data as { access_token?: unknown })?.access_token === 'string'
    ? (data as { access_token: string }).access_token
    : '';
  if (!accessToken) {
    throw new Error(`OAuth token exchange did not return access_token: ${text}`);
  }
  return data as OAuthTokenResponse;
}

async function startLocalCallbackServer(expectedState: string, timeoutMs: number, preferredPort: number): Promise<LocalCallbackServer> {
  let server: Server | undefined;
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (requestUrl.pathname !== '/callback') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    const error = requestUrl.searchParams.get('error');
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');
    if (error) {
      finishCallback(response, false, `OAuth authorization failed: ${error}`);
      if (!settled) {
        settled = true;
        rejectCode(new Error(`OAuth authorization failed: ${error}`));
      }
      return;
    }
    if (!code || state !== expectedState) {
      finishCallback(response, false, 'OAuth callback state mismatch or missing code. You can close this window and retry `woa login`.');
      if (!settled) {
        settled = true;
        rejectCode(new Error('OAuth callback state mismatch or missing code.'));
      }
      return;
    }

    finishCallback(response, true, 'OAuth authorization received. You can close this window and return to the terminal.');
    if (!settled) {
      settled = true;
      resolveCode(code);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(preferredPort, '127.0.0.1', () => resolve());
  });

  timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCode(new Error(`OAuth callback timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }
  }, timeoutMs);

  const address = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    waitForCode,
    close: async () => {
      if (timeout) clearTimeout(timeout);
      await new Promise<void>(resolve => server!.close(() => resolve()));
    },
  };
}

function finishCallback(response: import('node:http').ServerResponse, ok: boolean, message: string): void {
  response.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><meta charset="utf-8"><title>woa OAuth</title><p>${escapeHtml(message)}</p>`);
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // Printing the URL above is the reliable fallback for headless environments.
  }
}

async function apiGet(route: string, flags: Record<string, string | boolean>): Promise<unknown> {
  return await apiRequest('GET', route, undefined, flags);
}

async function apiPost(route: string, body: unknown, flags: Record<string, string | boolean>): Promise<unknown> {
  return await apiRequest('POST', route, body, flags);
}

async function apiRequest(method: string, route: string, body: unknown, flags: Record<string, string | boolean>): Promise<unknown> {
  const config = await loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || config.server || '');
  if (!server) {
    throw new Error('Missing server. Run `woa login --server <url> --token <oauth-token>` or pass --server.');
  }
  const token = stringFlag(flags, 'token') || config.accessToken;
  if (!token) {
    throw new Error('Missing OAuth access token. Run `woa login --server <url>` and complete OAuth, or pass --token for smoke tests.');
  }

  const response = await fetch(new URL(route, server), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(stringFlag(flags, 'scopes') ? { 'x-woa-scopes': stringFlag(flags, 'scopes') as string } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(`Remote API ${method} ${route} failed with ${response.status}: ${text}`);
  }
  return data;
}

async function writeMcpConfig(target: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || config.server || '');
  if (!server) {
    throw new Error('mcp config requires --server <url> or a saved login server.');
  }
  const mcpUrl = new URL('/mcp', server).toString();
  const targetName = target || 'codex';
  const output = targetName === 'claude'
    ? { mcpServers: { wechat: { type: 'http', url: mcpUrl } } }
    : { mcp_servers: { wechat: { type: 'streamable-http', url: mcpUrl } } };
  const json = JSON.stringify(output, null, 2);
  const outputPath = stringFlag(flags, 'output');
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${json}\n`, 'utf8');
    console.log(`Wrote remote MCP config to ${outputPath}. No WeChat credentials were written.`);
    return;
  }
  console.log(json);
}

async function resolveTenantAccount(flags: Record<string, string | boolean>): Promise<{ tenantId: string; accountId: string }> {
  const config = await loadConfig();
  return {
    tenantId: stringFlag(flags, 'tenant') || stringFlag(flags, 'tenant-id') || config.activeTenantId || DEFAULT_TENANT_ID,
    accountId: stringFlag(flags, 'account') || stringFlag(flags, 'account-id') || config.activeAccountId || DEFAULT_ACCOUNT_ID,
  };
}

async function resolveTenantId(flags: Record<string, string | boolean>): Promise<string> {
  const config = await loadConfig();
  return stringFlag(flags, 'tenant') || stringFlag(flags, 'tenant-id') || config.activeTenantId || DEFAULT_TENANT_ID;
}

async function loadConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as CliConfig;
  } catch {
    return {};
  }
}

async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.slice(2).split('=', 2);
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        flags[name] = argv[i + 1];
        i += 1;
      } else {
        flags[name] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      flags[arg.slice(1)] = true;
    } else {
      command.push(arg);
    }
  }
  return { command, flags };
}

function paginationQuery(flags: Record<string, string | boolean>): string {
  const params = new URLSearchParams();
  for (const key of ['offset', 'count', 'limit', 'no_content']) {
    const value = stringFlag(flags, key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function requiredString(flags: Record<string, string | boolean>, name: string, message: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(message);
  return value;
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeServer(server: string): string {
  return server ? server.replace(/\/+$/, '/') : '';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64Url(data: Buffer): string {
  return data.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function printHelp(): void {
  console.log(`woa — remote-only WeChat Official Account management CLI

Usage:
  woa login --server <url> [--token <oauth-token>]
  woa whoami [--server <url>] [--token <oauth-token>]
  woa tenant list
  woa tenant usage [--tenant <tenantId>]
  woa usage [--tenant <tenantId>]
  woa account list [--tenant <tenantId>]
  woa account status [--tenant <tenantId>] [--account <accountId>]
  woa account configure --tenant <tenantId> --account <accountId> --app-id <wx...> --app-secret <secret>
  woa draft list [--tenant <tenantId>] [--account <accountId>] [--count 20]
  woa publish list [--tenant <tenantId>] [--account <accountId>] [--count 20]
  woa inbox list [--tenant <tenantId>] [--account <accountId>] [--limit 20]
  woa mcp config codex --server <url> [--output <path>]
  woa mcp config claude --server <url> [--output <path>]

Runtime posture:
  - Remote-only: commands call the OAuth-protected Worker REST API or generate remote /mcp config.
  - No local MCP server, stdio transport, SSE transport, SQLite, local WeChat runtime, or filePath upload.
  - The CLI stores OAuth/session data only; WeChat app secrets are sent over HTTPS for account configuration and are not persisted locally.`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
