#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { ALLOWED_MEDIA_TYPES, FILE_SIZE_LIMITS } from '../utils/validation.js';

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

interface CliTenantSelection {
  tenantId: string;
}

interface CliAccountSelection extends CliTenantSelection {
  accountId: string;
  isDefault: boolean;
}

interface CliRemoteContext {
  defaultTenantId?: string;
  defaultAccountId?: string;
  tenants: CliTenantSelection[];
  accounts: CliAccountSelection[];
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
const CONFIG_PATH = process.env.WOA_CLI_CONFIG || path.join(homedir(), '.config', 'woa', 'cli.json');

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

  if (root === 'usage' || (root === 'quota' && (!sub || sub === 'status'))) {
    const tenantId = await resolveTenantId(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/usage`, parsed.flags), null, 2));
    return;
  }

  if (root === 'billing' && sub === 'checkout') {
    await billingCheckout(parsed.flags);
    return;
  }

  if (root === 'account') {
    await handleAccountCommand(sub, leaf, parsed.flags);
    return;
  }

  if (root === 'draft' && sub === 'list') {
    const { tenantId, accountId } = await resolveTenantAccount(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/drafts${paginationQuery(parsed.flags)}`, parsed.flags), null, 2));
    return;
  }

  if (root === 'draft' && sub === 'delete') {
    await deleteDraft(leaf, parsed.flags);
    return;
  }

  if (root === 'publish' && sub === 'list') {
    const { tenantId, accountId } = await resolveTenantAccount(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/publishes${paginationQuery(parsed.flags)}`, parsed.flags), null, 2));
    return;
  }

  if (root === 'publish' && sub === 'delete') {
    await deletePublish(leaf, parsed.flags);
    return;
  }

  if (root === 'inbox' && sub === 'list') {
    const { tenantId, accountId } = await resolveTenantAccount(parsed.flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/inbox${paginationQuery(parsed.flags)}`, parsed.flags), null, 2));
    return;
  }

  if (root === 'media' && sub === 'upload') {
    await uploadLocalMedia(leaf, parsed.flags);
    return;
  }

  if (root === 'mcp' && sub === 'config') {
    await writeMcpConfig(leaf, parsed.flags);
    return;
  }

  throw new Error(`Unknown command: ${parsed.command.join(' ')}`);
}

async function handleAccountCommand(
  sub: string | undefined,
  leaf: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (sub === 'list') {
    const tenantId = await resolveTenantId(flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts`, flags), null, 2));
    return;
  }

  if (sub === 'create') {
    const tenantId = await resolveTenantId(flags);
    const body = {
      name: stringFlag(flags, 'name'),
      appId: stringFlag(flags, 'app-id') || stringFlag(flags, 'appId'),
      appSecret: stringFlag(flags, 'app-secret') || stringFlag(flags, 'appSecret'),
    };
    console.log(JSON.stringify(await apiPost(`/api/v1/tenants/${tenantId}/accounts`, body, flags), null, 2));
    return;
  }

  if (sub === 'status') {
    const { tenantId, accountId } = await resolveTenantAccount(flags);
    console.log(JSON.stringify(await apiGet(`/api/v1/tenants/${tenantId}/accounts/${accountId}/status`, flags), null, 2));
    return;
  }

  if (sub === 'rename') {
    const tenantId = await resolveTenantId(flags);
    const accountId = stringFlag(flags, 'account') || stringFlag(flags, 'account-id') || leaf;
    const name = requiredString(flags, 'name', 'account rename requires --name <display-name>.');
    if (!accountId) throw new Error('account rename requires <accountId> or --account <accountId>.');
    console.log(JSON.stringify(await apiPatch(`/api/v1/tenants/${tenantId}/accounts/${accountId}`, { name }, flags), null, 2));
    return;
  }

  if (sub === 'default') {
    const tenantId = await resolveTenantId(flags);
    const accountId = stringFlag(flags, 'account') || stringFlag(flags, 'account-id') || leaf;
    if (!accountId) throw new Error('account default requires <accountId> or --account <accountId>.');
    const response = await apiPatch(`/api/v1/tenants/${tenantId}`, { defaultAccountId: accountId }, flags);
    await saveConfig({ ...(await loadConfig()), activeTenantId: tenantId, activeAccountId: accountId });
    console.log(JSON.stringify(response, null, 2));
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

  if (sub === 'delete') {
    const selectionFlags = { ...flags, account: leaf || flags.account || flags['account-id'] };
    if (flags['dry-run']) {
      const { tenantId, accountId } = await resolveTenantAccountForDryRun(selectionFlags);
      const route = `/api/v1/tenants/${tenantId}/accounts/${accountId}/disable`;
      printDeleteDryRun('account', route, { tenantId, accountId });
      return;
    }
    const { tenantId, accountId } = await resolveTenantAccount(selectionFlags);
    const route = `/api/v1/tenants/${tenantId}/accounts/${accountId}/disable`;
    requireDeleteConfirmation(flags, 'account');
    console.log(JSON.stringify(await apiPost(route, { confirmDelete: true }, flags), null, 2));
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

async function billingCheckout(flags: Record<string, string | boolean>): Promise<void> {
  const tenantId = await resolveTenantId(flags);
  const plan = requiredString(flags, 'plan', 'billing checkout requires --plan plus|pro.');
  if (plan !== 'plus' && plan !== 'pro') {
    throw new Error('billing checkout --plan must be plus or pro.');
  }
  const config = await loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || config.server || '');
  if (!server) {
    throw new Error('billing checkout requires --server <url> or a saved login server.');
  }
  const response = await apiPost(`/api/v1/tenants/${tenantId}/billing/checkout`, {
    plan,
    successUrl: stringFlag(flags, 'success-url') || new URL('/billing/success', server).toString(),
    cancelUrl: stringFlag(flags, 'cancel-url') || new URL('/billing/cancel', server).toString(),
  }, flags);
  const url = checkoutUrl(response);
  console.log(JSON.stringify(response, null, 2));
  if (url) {
    console.log(`Stripe Checkout URL: ${url}`);
    if (!flags['no-open']) {
      openBrowser(url);
    }
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
  let settled = false;
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
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
    server.once('error', reject);
    server.listen(preferredPort, '127.0.0.1', () => resolve());
  });

  const timeout = setTimeout(() => {
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
      clearTimeout(timeout);
      await new Promise<void>(resolve => server.close(() => resolve()));
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

async function apiPatch(route: string, body: unknown, flags: Record<string, string | boolean>): Promise<unknown> {
  return await apiRequest('PATCH', route, body, flags);
}

async function apiDelete(route: string, flags: Record<string, string | boolean>): Promise<unknown> {
  return await apiRequest('DELETE', route, undefined, flags);
}

async function uploadLocalMedia(fileArg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const filePath = path.resolve(fileArg || stringFlag(flags, 'file') || '');
  if (!fileArg && !stringFlag(flags, 'file')) {
    throw new Error('media upload requires a local file path. Example: woa media upload ./cover.png');
  }

  const bytes = await readFile(filePath);
  const maxBytes = Math.max(...Object.values(FILE_SIZE_LIMITS));
  if (bytes.byteLength === 0) {
    throw new Error(`media upload refuses empty file: ${filePath}`);
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(`media upload file exceeds ${maxBytes} bytes: ${bytes.byteLength}`);
  }

  const fileName = stringFlag(flags, 'name') || stringFlag(flags, 'file-name') || path.basename(filePath);
  const mimeType = stringFlag(flags, 'content-type') || stringFlag(flags, 'mime-type') || inferMediaMimeType(fileName);
  if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error(`Unsupported media type ${mimeType}. Pass --content-type with one of: ${ALLOWED_MEDIA_TYPES.join(', ')}`);
  }

  const config = await loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || config.server || '');
  if (!server) {
    throw new Error('Missing server. Run `woa login --server <url>` or pass --server.');
  }
  const token = stringFlag(flags, 'token') || config.accessToken;
  if (!token) {
    throw new Error('Missing OAuth access token. Run `woa login --server <url>` or pass --token.');
  }

  const { tenantId, accountId } = await resolveTenantAccount(flags);
  const query = new URLSearchParams({ filename: fileName });
  const route = `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/media/uploads?${query}`;
  const response = await fetch(new URL(route, server), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': mimeType,
      'content-length': String(bytes.byteLength),
      ...(stringFlag(flags, 'scopes') ? { 'x-woa-scopes': stringFlag(flags, 'scopes') as string } : {}),
    },
    body: bytes,
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(`Remote media upload failed with ${response.status}: ${text}`);
  }
  console.log(JSON.stringify(withMediaUploadHints(data, accountId), null, 2));
}

function withMediaUploadHints(value: unknown, accountId: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data)) return value;
  const data = root.data as Record<string, unknown>;
  if (data.next || typeof data.r2Key !== 'string') return value;

  const common = {
    r2Key: data.r2Key,
    fileName: data.fileName,
    mimeType: data.mimeType,
    accountId,
  };
  return {
    ...root,
    data: {
      ...data,
      next: {
        contentImage: {
          tool: 'wechat_upload_img',
          arguments: common,
        },
        permanentMedia: {
          tool: 'wechat_permanent_media',
          arguments: { action: 'add', ...common },
          requiredArgument: 'type: image | thumb | voice | video',
        },
      },
    },
  };
}

function inferMediaMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.mp3':
      return 'audio/mpeg';
    case '.amr':
      return 'audio/amr';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

async function deleteDraft(idArg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const mediaId = stringFlag(flags, 'media-id') || stringFlag(flags, 'mediaId') || idArg;
  if (!mediaId) {
    throw new Error('draft delete requires --media-id <media_id> or positional <media_id>.');
  }
  if (flags['dry-run']) {
    const { tenantId, accountId } = await resolveTenantAccountForDryRun(flags);
    const route = `/api/v1/tenants/${tenantId}/accounts/${accountId}/drafts/${encodeURIComponent(mediaId)}`;
    printDeleteDryRun('draft', route, { tenantId, accountId, mediaId });
    return;
  }
  const { tenantId, accountId } = await resolveTenantAccount(flags);
  const route = `/api/v1/tenants/${tenantId}/accounts/${accountId}/drafts/${encodeURIComponent(mediaId)}`;
  requireDeleteConfirmation(flags, 'draft');
  console.log(JSON.stringify(await apiDelete(route, flags), null, 2));
}

async function deletePublish(idArg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const articleId = stringFlag(flags, 'article-id') || stringFlag(flags, 'articleId') || idArg;
  if (!articleId) {
    throw new Error('publish delete requires --article-id <article_id> or positional <article_id>.');
  }
  const index = optionalNonNegativeIntFlag(flags, 'index');
  const query = index === undefined ? '' : `?index=${index}`;
  if (flags['dry-run']) {
    const { tenantId, accountId } = await resolveTenantAccountForDryRun(flags);
    const route = `/api/v1/tenants/${tenantId}/accounts/${accountId}/publishes/${encodeURIComponent(articleId)}${query}`;
    printDeleteDryRun('publish', route, { tenantId, accountId, articleId, index: index ?? null });
    return;
  }
  const { tenantId, accountId } = await resolveTenantAccount(flags);
  const route = `/api/v1/tenants/${tenantId}/accounts/${accountId}/publishes/${encodeURIComponent(articleId)}${query}`;
  requireDeleteConfirmation(flags, 'publish');
  console.log(JSON.stringify(await apiDelete(route, flags), null, 2));
}

function printDeleteDryRun(kind: 'draft' | 'publish' | 'account', route: string, target: Record<string, unknown>): void {
  console.log(JSON.stringify({
    success: true,
    dryRun: true,
    operation: `${kind}.delete`,
    target,
    route,
    note: 'No remote request was sent. Add --confirm-delete without --dry-run to perform the irreversible delete.',
  }, null, 2));
}

function requireDeleteConfirmation(flags: Record<string, string | boolean>, kind: 'draft' | 'publish' | 'account'): void {
  const value = flags['confirm-delete'];
  const confirmed = value === true || value === 'true' || value === 'yes' || value === `CONFIRM:${kind}.delete`;
  if (!confirmed) {
    throw new Error(`Refusing to delete ${kind} without confirmation. Retry with --confirm-delete after verifying the target ID, or use --dry-run.`);
  }
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
  const explicitTenantId = stringFlag(flags, 'tenant') || stringFlag(flags, 'tenant-id');
  const explicitAccountId = stringFlag(flags, 'account') || stringFlag(flags, 'account-id');
  if (explicitTenantId && explicitAccountId) {
    return { tenantId: explicitTenantId, accountId: explicitAccountId };
  }

  const current = await getCliRemoteContext(flags);
  const accountCandidateId = explicitAccountId || config.activeAccountId;
  const tenantCandidateId = explicitTenantId || config.activeTenantId;
  const accountCandidate = accountCandidateId
    ? current.accounts.find(account =>
      account.accountId === accountCandidateId &&
      (!explicitTenantId || account.tenantId === explicitTenantId),
    )
    : undefined;

  if (explicitAccountId && !accountCandidate) {
    throw new Error(`Account ${explicitAccountId} is not accessible for the current Operator. Run \`woa account list\` and retry with an accessible account ID.`);
  }

  const accessibleTenantIds = new Set([
    ...current.tenants.map(tenant => tenant.tenantId),
    ...current.accounts.map(account => account.tenantId),
  ]);
  if (explicitTenantId && !accessibleTenantIds.has(explicitTenantId)) {
    throw new Error(`Tenant ${explicitTenantId} is not accessible for the current Operator. Run \`woa tenant list\` and retry.`);
  }

  const tenantId = explicitTenantId
    || accountCandidate?.tenantId
    || (tenantCandidateId && accessibleTenantIds.has(tenantCandidateId) ? tenantCandidateId : undefined)
    || (current.defaultTenantId && accessibleTenantIds.has(current.defaultTenantId) ? current.defaultTenantId : undefined)
    || current.tenants[0]?.tenantId
    || current.accounts[0]?.tenantId;
  if (!tenantId) {
    throw new Error('No accessible tenant is available for the current Operator. Complete onboarding or pass an explicit tenant ID.');
  }

  const tenantAccounts = current.accounts.filter(account => account.tenantId === tenantId);
  const account = accountCandidate?.tenantId === tenantId
    ? accountCandidate
    : tenantAccounts.find(item => item.accountId === current.defaultAccountId)
      ?? tenantAccounts.find(item => item.isDefault)
      ?? tenantAccounts[0];
  if (!account) {
    throw new Error(`No accessible WeChat account is available in tenant ${tenantId}. Create an account or pass an explicit accessible account ID.`);
  }

  return { tenantId, accountId: account.accountId };
}

async function resolveTenantAccountForDryRun(flags: Record<string, string | boolean>): Promise<{ tenantId: string; accountId: string }> {
  const config = await loadConfig();
  return {
    tenantId: stringFlag(flags, 'tenant') || stringFlag(flags, 'tenant-id') || config.activeTenantId || '<server-default-tenant>',
    accountId: stringFlag(flags, 'account') || stringFlag(flags, 'account-id') || config.activeAccountId || '<server-default-account>',
  };
}

async function resolveTenantId(flags: Record<string, string | boolean>): Promise<string> {
  const config = await loadConfig();
  const explicitTenantId = stringFlag(flags, 'tenant') || stringFlag(flags, 'tenant-id');
  if (explicitTenantId) return explicitTenantId;

  const current = await getCliRemoteContext(flags);
  const accessibleTenantIds = new Set([
    ...current.tenants.map(tenant => tenant.tenantId),
    ...current.accounts.map(account => account.tenantId),
  ]);
  const tenantId = config.activeTenantId && accessibleTenantIds.has(config.activeTenantId)
    ? config.activeTenantId
    : current.defaultTenantId && accessibleTenantIds.has(current.defaultTenantId)
      ? current.defaultTenantId
      : current.tenants[0]?.tenantId ?? current.accounts[0]?.tenantId;
  if (!tenantId) {
    throw new Error('No accessible tenant is available for the current Operator. Complete onboarding or pass --tenant <tenantId>.');
  }
  return tenantId;
}

async function getCliRemoteContext(flags: Record<string, string | boolean>): Promise<CliRemoteContext> {
  const response = await apiGet('/api/v1/me', flags);
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  if (!data) {
    throw new Error('Remote /api/v1/me returned an invalid context response.');
  }
  const tenants = Array.isArray(data.tenants)
    ? data.tenants.flatMap(value => {
      const tenant = asRecord(value);
      const tenantId = stringValue(tenant?.tenantId);
      return tenantId ? [{ tenantId }] : [];
    })
    : [];
  const accounts = Array.isArray(data.accounts)
    ? data.accounts.flatMap(value => {
      const account = asRecord(value);
      const tenantId = stringValue(account?.tenantId);
      const accountId = stringValue(account?.accountId);
      return tenantId && accountId
        ? [{ tenantId, accountId, isDefault: account?.isDefault === true }]
        : [];
    })
    : [];
  return {
    defaultTenantId: stringValue(data.defaultTenantId),
    defaultAccountId: stringValue(data.defaultAccountId),
    tenants,
    accounts,
  };
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

function optionalNonNegativeIntFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function checkoutUrl(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const root = response as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object'
    ? root.data as Record<string, unknown>
    : root;
  return typeof data.url === 'string' ? data.url : null;
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
  console.log(`woa — remote-only CLI for @ziikoo/woa

Usage:
  woa login --server <url> [--token <oauth-token>]
  woa whoami [--server <url>] [--token <oauth-token>]
  woa tenant list
  woa tenant usage [--tenant <tenantId>]
  woa usage [--tenant <tenantId>]
  woa quota status [--tenant <tenantId>]
  woa account list [--tenant <tenantId>]
  woa account create [--tenant <tenantId>] [--name <name>]
  woa account status [--tenant <tenantId>] [--account <accountId>]
  woa account rename <accountId> --name <name> [--tenant <tenantId>]
  woa account default <accountId> [--tenant <tenantId>]
  woa account configure --tenant <tenantId> --account <accountId> --app-id <wx...> --app-secret <secret>
  woa account delete <accountId> --confirm-delete [--tenant <tenantId>]
  woa billing checkout --plan plus|pro [--tenant <tenantId>] [--no-open]
  woa draft list [--tenant <tenantId>] [--account <accountId>] [--count 20]
  woa draft delete <media_id> --confirm-delete [--tenant <tenantId>] [--account <accountId>]
  woa publish list [--tenant <tenantId>] [--account <accountId>] [--count 20]
  woa publish delete <article_id> [--index <n>] --confirm-delete [--tenant <tenantId>] [--account <accountId>]
  woa inbox list [--tenant <tenantId>] [--account <accountId>] [--limit 20]
  woa media upload <local-file> [--tenant <tenantId>] [--account <accountId>] [--content-type <mime>]
  woa mcp config codex --server <url> [--output <path>]
  woa mcp config claude --server <url> [--output <path>]

Runtime posture:
  - Remote-only: commands call the OAuth-protected Worker REST API or generate remote /mcp config.
  - No local MCP server, stdio transport, SSE transport, SQLite, or local WeChat runtime.
  - Local files use \`woa media upload <path>\` to stage binary bytes in R2; remote MCP tools receive only r2Key/fileUrl, never a local path or base64 payload.
  - Destructive delete commands require --confirm-delete; use --dry-run first to verify the target.
  - The CLI stores OAuth/session data only; WeChat app secrets are sent over HTTPS for account configuration and are not persisted locally.
  - Native MCP config points to https://woa.ziikoo.app/mcp and never embeds OAuth tokens.`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
