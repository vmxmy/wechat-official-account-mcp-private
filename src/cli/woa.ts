#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ALLOWED_MEDIA_TYPES, FILE_SIZE_LIMITS } from '../utils/validation.js';
import { ensureFreshOAuthSession } from './oauth-session.js';
import { cliScopesForProfile, DEFAULT_CLI_SCOPES } from './oauth-scopes.js';
import { authorizationCodeFromCallback } from './oauth-callback.js';
import { renderAgentHelp } from './agent-help.js';
import { loadCliJsonObject, normalizeDraftArticlesInput } from './api-input.js';
import {
  assertToolConfirmation,
  createToolDryRun,
  filterWechatTools,
  isWechatToolName,
  requiredToolConfirmation,
} from './api-safety.js';
import { CliUsageError } from './cli-errors.js';
import {
  executeInitCommand,
  loadInitConsoleSnapshot,
  type InitCommandServices,
} from './init-command.js';
import { InitRunnerError } from './init-runner.js';
import { renderMcpDescriptor } from './mcp-descriptor.js';
import { CliMcpApiClient, type CliMcpTool } from './mcp-api-client.js';
import { defaultCliConfigPath, readSecureJson, writeSecureJson } from './secure-config.js';
import { readSecureInput } from './secure-input.js';
import {
  detectTerminalCapabilities,
  interactiveConsoleUnavailableReason,
  normalizeInkCiEnvironment,
} from './terminal-capabilities.js';
import type {
  UiAccount,
  UiConsoleServices,
  UiConsoleSnapshot,
  UiContentItem,
  UiSession,
  UiTenant,
  UiUsageMetric,
  UiUsageSummary,
} from './ui-console-types.js';
import { CLI_VERSION } from './version.js';

interface CliConfig {
  server?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  activeTenantId?: string;
  activeAccountId?: string;
  pkce?: {
    verifier: string;
    state: string;
    server?: string;
    redirectUri?: string;
    scope?: string;
    createdAt?: number;
    clientId?: string;
    clientSecret?: string;
    tokenEndpoint?: string;
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
const CONFIG_PATH = defaultCliConfigPath();

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

interface PreparedInitOAuthAuthorization {
  authorizationUrl: string;
  complete: () => Promise<void>;
  close: () => Promise<void>;
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const [root, sub, leaf] = parsed.command;

  if (stringFlag(parsed.flags, 'token') && !(root === 'account' && sub === 'configure')) {
    throw new CliUsageError('--token is not an OAuth authentication option. Complete `woa login` and use the refreshable saved OAuth session.');
  }

  if (parsed.flags.version || parsed.flags.v) {
    console.log(CLI_VERSION);
    return;
  }

  if (root === 'help' && sub === 'agent') {
    const format = stringFlag(parsed.flags, 'format') || 'markdown';
    if (format !== 'markdown' && format !== 'json') {
      throw new CliUsageError('help agent --format must be markdown or json.');
    }
    process.stdout.write(renderAgentHelp(format));
    return;
  }

  if (!root || root === 'help' || parsed.flags.help || parsed.flags.h) {
    printHelp();
    return;
  }

  if (root === 'init') {
    await handleInitCommand(sub, leaf, parsed.flags);
    return;
  }

  if (root === 'ui') {
    await handleUiCommand(parsed.flags);
    return;
  }

  if (root === 'login') {
    if (sub === 'complete') {
      await completeHeadlessLogin(parsed.flags);
    } else {
      await login(parsed.flags);
    }
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

  if (root === 'api') {
    await handleMcpApiCommand(sub, leaf, parsed.flags);
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

  if (root === 'draft' && ['add', 'update', 'get', 'count'].includes(sub ?? '')) {
    await handleDraftMcpCommand(sub!, leaf, parsed.flags);
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

  if (root === 'mcp' && sub === 'descriptor') {
    await printMcpDescriptor(parsed.flags);
    return;
  }

  if (root === 'mcp' && sub === 'config') {
    await writeMcpConfig(leaf, parsed.flags);
    return;
  }


  if (root === 'mcp' && ['tools', 'describe', 'call'].includes(sub ?? '')) {
    await handleMcpApiCommand(sub === 'tools' ? 'list' : sub, leaf, parsed.flags);
    return;
  }

  throw new Error(`Unknown command: ${parsed.command.join(' ')}`);
}

async function handleInitCommand(
  sub: string | undefined,
  leaf: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const result = await executeInitCommand({ sub, leaf, flags, services: createInitCommandServices() });
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

async function handleUiCommand(flags: Record<string, string | boolean>): Promise<void> {
  const capabilities = detectTerminalCapabilities({
    agent: flagEnabled(flags, 'agent'),
    plain: flagEnabled(flags, 'plain'),
  });
  const unavailable = interactiveConsoleUnavailableReason(capabilities);
  if (unavailable) throw new CliUsageError(unavailable);
  const services = createUiConsoleServices(flags);
  while (true) {
    const consoleSnapshot = await services.refresh();
    normalizeInkCiEnvironment();
    const { runInkUiShell } = await import('./ui-shell.js');
    const selection = await runInkUiShell(consoleSnapshot.init, {
      color: capabilities.color,
      console: { snapshot: consoleSnapshot, services },
    });
    if (selection === 'exit') return;
    if (selection === 'resume') {
      if (!consoleSnapshot.init.canResume || !consoleSnapshot.init.event) {
        throw new CliUsageError('No compatible resumable initialization run is available.');
      }
      await handleInitCommand('resume', consoleSnapshot.init.event.runId, flags);
      continue;
    }
    if (selection === 'start') {
      await handleInitCommand(undefined, undefined, flags);
      continue;
    }
    if (selection.kind === 'login') {
      const config = await loadConfig();
      await login({ ...flags, server: stringFlag(flags, 'server') || config.server || 'https://woa.ziikoo.app' });
      continue;
    }
    if (selection.kind === 'configure_account') {
      await handleAccountCommand('configure', selection.accountId, {
        ...flags,
        tenant: selection.tenantId,
        account: selection.accountId,
        'app-id': selection.appId,
      });
      continue;
    }
  }
}

function createUiConsoleServices(flags: Record<string, string | boolean>): UiConsoleServices {
  return {
    refresh: async () => await loadUiConsoleSnapshot(flags),
    switchScope: async input => {
      const config = await loadConfig();
      await saveConfig({ ...config, activeTenantId: input.tenantId, activeAccountId: input.accountId });
      return { message: '已切换当前租户和公众号。' };
    },
    createAccount: async input => {
      await apiPost(`/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts`, { name: input.name }, flags);
      return uiMutation('公众号已创建。');
    },
    renameAccount: async input => {
      await apiPatch(
        `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}`,
        { name: input.name },
        flags,
      );
      return uiMutation('公众号名称已更新。');
    },
    setDefaultAccount: async input => {
      await apiPatch(
        `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}`,
        { isDefault: true },
        flags,
      );
      const config = await loadConfig();
      await saveConfig({ ...config, activeTenantId: input.tenantId, activeAccountId: input.accountId });
      return uiMutation('已设为默认公众号。');
    },
    disableAccount: async input => {
      const expected = `DELETE ${input.accountId}`;
      if (input.confirmation !== expected) throw new Error(`公众号停用需要确认文本：${expected}`);
      await apiPost(
        `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}/disable`,
        { confirmation: input.confirmation },
        flags,
      );
      return uiMutation('公众号已停用，服务端已清除关联凭据。');
    },
    refreshAccountToken: async input => {
      await apiPost(
        `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}/token/refresh`,
        {},
        flags,
      );
      return uiMutation('公众号访问 Token 已刷新。');
    },
    deleteDraft: async input => {
      const expected = `DELETE ${input.mediaId}`;
      if (input.confirmation !== expected) throw new Error(`草稿删除需要确认文本：${expected}`);
      await apiDelete(
        `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}/drafts/${encodeURIComponent(input.mediaId)}`,
        flags,
      );
      return uiMutation('草稿已删除。');
    },
    deletePublish: async input => {
      const expected = `DELETE ${input.articleId}`;
      if (input.confirmation !== expected) throw new Error(`发布记录删除需要确认文本：${expected}`);
      await apiDelete(
        `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}/publishes/${encodeURIComponent(input.articleId)}`,
        flags,
      );
      return uiMutation('发布记录已删除。');
    },
    uploadMedia: async input => {
      await uploadLocalMediaResult(input.filePath, {
        ...flags,
        tenant: input.tenantId,
        account: input.accountId,
      });
      return uiMutation('媒体已上传至受保护的暂存区。');
    },
    callTool: async input => {
      const client = await createCliMcpApiClient(flags);
      try {
        const tool = (await client.listTools()).find(candidate => candidate.name === input.tool.name);
        if (!tool || !isWechatToolName(tool.name)) throw new Error(`WeChat MCP tool not found: ${input.tool.name}`);
        const args = await injectToolAccount(tool, input.arguments, flags);
        assertToolConfirmation(tool, args, input.confirmation);
        return await client.callTool(tool.name, args);
      } finally {
        await client.close();
      }
    },
    checkout: async input => {
      const config = await loadConfig();
      const server = normalizeServer(stringFlag(flags, 'server') || config.server || '');
      if (!server) throw new Error('缺少 Server。请先登录或在命令中提供 --server。');
      const response = await apiPost(`/api/v1/tenants/${encodeURIComponent(input.tenantId)}/billing/checkout`, {
        plan: input.plan,
        successUrl: new URL('/billing/success', server).toString(),
        cancelUrl: new URL('/billing/cancel', server).toString(),
      }, flags);
      const url = checkoutUrl(response);
      if (!url) throw new Error('服务端没有返回可用的 Stripe Checkout 地址。');
      openBrowser(url);
      return uiMutation(`已在浏览器打开 ${input.plan.toUpperCase()} 套餐支付页面。`);
    },
    revokeSession: async input => {
      const expected = `REVOKE ${input.sessionId}`;
      if (input.confirmation !== expected) throw new Error(`撤销会话需要确认文本：${expected}`);
      await apiDelete(`/api/v1/sessions/${encodeURIComponent(input.sessionId)}`, flags);
      return uiMutation('会话已撤销。');
    },
  };
}

async function loadUiConsoleSnapshot(flags: Record<string, string | boolean>): Promise<UiConsoleSnapshot> {
  const [init, config] = await Promise.all([
    loadInitConsoleSnapshot(CONFIG_PATH),
    loadConfig(),
  ]);
  const snapshot: UiConsoleSnapshot = {
    init,
    server: stringFlag(flags, 'server') || config.server,
    authenticated: false,
    tenants: [],
    accounts: [],
    drafts: [],
    publishes: [],
    inbox: [],
    tools: [],
    sessions: [],
    errors: [],
    refreshedAt: Date.now(),
  };
  if (snapshot.server) {
    try {
      snapshot.mcpDescriptor = renderMcpDescriptor(snapshot.server);
      snapshot.mcpConfig = renderUiMcpConfig(snapshot.server);
    } catch (error) {
      snapshot.errors.push({ area: 'MCP 描述', message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!snapshot.server || (!config.accessToken && !config.refreshToken)) return snapshot;

  const contextResponse = await uiOptional('身份与范围', async () => await apiGet('/api/v1/me', flags), snapshot);
  const context = uiEnvelopeData(contextResponse);
  if (!context) return snapshot;
  snapshot.authenticated = true;
  snapshot.operator = uiOperator(context);
  snapshot.tenants = uiTenants(context.tenants);
  snapshot.accounts = uiAccounts(context.accounts);
  snapshot.activeTenantId = selectUiTenantId(config, context, snapshot.tenants, snapshot.accounts);
  snapshot.activeAccountId = selectUiAccountId(config, context, snapshot.activeTenantId, snapshot.accounts);

  if (snapshot.activeTenantId) {
    const accountResponse = await uiOptional('公众号列表', async () => await apiGet(
      `/api/v1/tenants/${encodeURIComponent(snapshot.activeTenantId!)}/accounts`,
      flags,
    ), snapshot);
    const accountData = uiEnvelopeData(accountResponse);
    const detailed = uiAccounts(accountData?.accounts);
    if (detailed.length > 0) snapshot.accounts = mergeUiAccounts(snapshot.accounts, detailed);
    snapshot.activeAccountId = selectUiAccountId(config, context, snapshot.activeTenantId, snapshot.accounts);

    const usageResponse = await uiOptional('租户用量', async () => await apiGet(
      `/api/v1/tenants/${encodeURIComponent(snapshot.activeTenantId!)}/usage`,
      flags,
    ), snapshot);
    snapshot.usage = uiUsage(uiEnvelopeData(usageResponse));
  }

  if (snapshot.activeTenantId && snapshot.activeAccountId) {
    const tenantId = snapshot.activeTenantId;
    const accountId = snapshot.activeAccountId;
    const [statusResponse, draftResponse, publishResponse, inboxResponse] = await Promise.all([
      uiOptional('账号状态', async () => await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/status`, flags), snapshot),
      uiOptional('草稿', async () => await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/drafts?count=20`, flags), snapshot),
      uiOptional('发布记录', async () => await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/publishes?count=20`, flags), snapshot),
      uiOptional('收件箱', async () => await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/inbox?limit=20`, flags), snapshot),
    ]);
    const status = uiEnvelopeData(statusResponse);
    const index = snapshot.accounts.findIndex(item => item.tenantId === tenantId && item.accountId === accountId);
    if (index >= 0) {
      snapshot.accounts[index] = {
        ...snapshot.accounts[index],
        configured: status?.configured === true,
        ...(uiAccounts(status?.account)[0] || {}),
      };
    }
    snapshot.drafts = uiContentItems(uiEnvelopeData(draftResponse), 'draft');
    snapshot.publishes = uiContentItems(uiEnvelopeData(publishResponse), 'publish');
    snapshot.inbox = uiContentItems(uiEnvelopeData(inboxResponse), 'inbox');
  }

  const [toolList, sessionResponse] = await Promise.all([
    uiOptional('MCP 工具目录', async () => {
      const client = await createCliMcpApiClient(flags);
      try {
        return await client.listTools();
      } finally {
        await client.close();
      }
    }, snapshot),
    uiOptional('安全会话', async () => await apiGet('/api/v1/sessions', flags), snapshot),
  ]);
  if (Array.isArray(toolList)) snapshot.tools = filterWechatTools(toolList);
  snapshot.sessions = uiSessions(uiEnvelopeData(sessionResponse)?.sessions);
  return snapshot;
}

async function uiOptional<T>(
  area: string,
  operation: () => Promise<T>,
  snapshot: UiConsoleSnapshot,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    snapshot.errors.push({ area, message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function uiMutation(message: string): { message: string } {
  return { message };
}

function uiEnvelopeData(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  return asRecord(root?.data) ?? root;
}

function uiOperator(context: Record<string, unknown>): UiConsoleSnapshot['operator'] {
  const user = asRecord(context.user);
  return {
    displayName: stringValue(user?.displayName),
    email: stringValue(user?.email),
    scopes: Array.isArray(context.scopes) ? context.scopes.filter((item): item is string => typeof item === 'string') : [],
  };
}

function uiTenants(value: unknown): UiTenant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const record = asRecord(item);
    const tenantId = stringValue(record?.tenantId);
    return tenantId ? [{
      tenantId,
      name: stringValue(record?.name),
      slug: stringValue(record?.slug),
      role: stringValue(record?.role),
      status: stringValue(record?.status),
    }] : [];
  });
}

function uiAccounts(value: unknown): UiAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const record = asRecord(item);
    const tenantId = stringValue(record?.tenantId);
    const accountId = stringValue(record?.accountId);
    return tenantId && accountId ? [{
      tenantId,
      accountId,
      name: stringValue(record?.name),
      slug: stringValue(record?.slug),
      appId: stringValue(record?.appId),
      status: stringValue(record?.status),
      isDefault: record?.isDefault === true,
      hasAppSecret: record?.hasAppSecret === true,
      configured: record?.configured === true,
      updatedAt: typeof record?.updatedAt === 'number' ? record.updatedAt : undefined,
    }] : [];
  });
}

function mergeUiAccounts(existing: UiAccount[], detailed: UiAccount[]): UiAccount[] {
  const byKey = new Map(existing.map(account => [`${account.tenantId}:${account.accountId}`, account]));
  for (const account of detailed) {
    const key = `${account.tenantId}:${account.accountId}`;
    byKey.set(key, { ...byKey.get(key), ...account });
  }
  return [...byKey.values()];
}

function selectUiTenantId(
  config: CliConfig,
  context: Record<string, unknown>,
  tenants: UiTenant[],
  accounts: UiAccount[],
): string | undefined {
  const allowed = new Set([...tenants.map(item => item.tenantId), ...accounts.map(item => item.tenantId)]);
  const candidates = [config.activeTenantId, stringValue(context.defaultTenantId), tenants[0]?.tenantId, accounts[0]?.tenantId];
  return candidates.find((item): item is string => typeof item === 'string' && allowed.has(item));
}

function selectUiAccountId(
  config: CliConfig,
  context: Record<string, unknown>,
  tenantId: string | undefined,
  accounts: UiAccount[],
): string | undefined {
  const candidates = accounts.filter(account => !tenantId || account.tenantId === tenantId);
  const configured = [
    config.activeAccountId,
    stringValue(context.defaultAccountId),
    candidates.find(account => account.isDefault)?.accountId,
    candidates[0]?.accountId,
  ];
  return configured.find((item): item is string => typeof item === 'string' && candidates.some(account => account.accountId === item));
}

function uiUsage(value: Record<string, unknown> | null): UiUsageSummary | undefined {
  if (!value) return undefined;
  const entitlement = asRecord(value.entitlement);
  const source = entitlement ?? value;
  const metrics = uiUsageMetrics(value);
  return {
    plan: stringValue(source.plan) || stringValue(source.planId),
    resetAt: uiTimestamp(source.resetAt) || uiTimestamp(source.periodEnd),
    metrics,
    upgradePrompt: stringValue(value.upgradePrompt),
  };
}

function uiUsageMetrics(value: Record<string, unknown>): UiUsageMetric[] {
  const candidates = [value.metrics, value.counters, value.usage];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const metrics = candidate.flatMap(item => {
        const record = asRecord(item);
        const name = stringValue(record?.name) || stringValue(record?.metric) || stringValue(record?.key);
        return name ? [{
          name,
          used: numberValue(record?.used) ?? numberValue(record?.value),
          limit: numberValue(record?.limit) ?? numberValue(record?.limitValue),
          unit: stringValue(record?.unit),
        }] : [];
      });
      if (metrics.length) return metrics;
    }
  }
  return [];
}

function uiContentItems(value: Record<string, unknown> | null, kind: 'draft' | 'publish' | 'inbox'): UiContentItem[] {
  if (!value) return [];
  const candidates = [value.items, value.item, value.messages, value.list, value.data];
  const source = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!source) return [];
  return source.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const content = asRecord(record.content);
    const newsItems = Array.isArray(content?.news_item) ? content?.news_item : Array.isArray(record.news_item) ? record.news_item : [];
    const firstArticle = asRecord(newsItems[0]);
    const id = stringValue(record.media_id)
      || stringValue(record.mediaId)
      || stringValue(record.article_id)
      || stringValue(record.articleId)
      || stringValue(record.msg_id)
      || stringValue(record.messageId)
      || stringValue(record.id)
      || `${kind}-${index + 1}`;
    const title = stringValue(record.title)
      || stringValue(firstArticle?.title)
      || stringValue(record.type)
      || `${kind === 'draft' ? '草稿' : kind === 'publish' ? '发布记录' : '收件箱消息'} ${index + 1}`;
    const subtitle = stringValue(record.author)
      || stringValue(record.update_time)
      || stringValue(record.create_time);
    return [{
      id,
      title,
      subtitle,
      status: kind === 'publish' ? stringValue(record.publish_status) || 'published' : stringValue(record.status),
      updatedAt: uiTimestamp(record.update_time) || uiTimestamp(record.create_time),
      detail: uiContentDetail(record, firstArticle, id, title, kind, newsItems.length),
    }];
  });
}

function uiContentDetail(
  record: Record<string, unknown>,
  firstArticle: Record<string, unknown> | null,
  id: string,
  title: string,
  kind: 'draft' | 'publish' | 'inbox',
  articleCount: number,
): Record<string, string | number | boolean | null> {
  return {
    id,
    title,
    kind,
    status: stringValue(record.status) || stringValue(record.publish_status) || null,
    type: stringValue(record.type) || null,
    author: stringValue(record.author) || stringValue(firstArticle?.author) || null,
    articleCount: articleCount || null,
    updatedAt: uiTimestamp(record.update_time) || null,
    createdAt: uiTimestamp(record.create_time) || null,
  };
}

function uiSessions(value: unknown): UiSession[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const record = asRecord(item);
    const id = stringValue(record?.id) || stringValue(record?.sessionId);
    if (!id) return [];
    return [{
      id,
      label: stringValue(record?.label) || stringValue(record?.clientName) || stringValue(record?.kind) || id,
      kind: stringValue(record?.kind),
      current: record?.current === true,
      createdAt: uiTimestamp(record?.createdAt),
      lastSeenAt: uiTimestamp(record?.lastSeenAt) || uiTimestamp(record?.updatedAt),
    }];
  });
}

function uiTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(milliseconds).toISOString();
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function renderUiMcpConfig(server: string): string {
  const mcpUrl = new URL('/mcp', server).toString();
  return `${JSON.stringify({
    mcp_servers: {
      wechat: { type: 'streamable-http', url: mcpUrl },
    },
  }, null, 2)}\n`;
}

function createInitCommandServices(): InitCommandServices {
  return {
    configPath: CONFIG_PATH,
    loadConfig,
    apiGet,
    prepareCliOAuth: prepareInitOAuthAuthorization,
    completeHeadlessLogin: async () => await completeHeadlessLogin({}, { quiet: true }),
    initApiRequest,
    selectInitTarget,
    openBrowser,
    isLikelyHeadlessEnvironment,
  };
}

async function printMcpDescriptor(flags: Record<string, string | boolean>): Promise<void> {
  const format = stringFlag(flags, 'format') || 'json';
  if (format !== 'json') throw new CliUsageError('mcp descriptor --format must be json.');
  const config = await loadConfig();
  const server = stringFlag(flags, 'server') || config.server || 'https://woa.ziikoo.app';
  process.stdout.write(renderMcpDescriptor(server));
}

async function initApiRequest(
  method: 'GET' | 'POST',
  server: string,
  route: string,
  body: unknown,
  flags: Record<string, string | boolean>,
  idempotencyKey?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchWithOAuth(new URL(route, server), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  }, { ...flags, server });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const root = asRecord(data);
    const error = asRecord(root?.error);
    const serverCode = stringValue(error?.code);
    throw new InitRunnerError(
      stableInitErrorCode(serverCode, response.status),
      `Remote init request failed (${response.status}${serverCode ? `, ${serverCode}` : ''}).`,
    );
  }
  return data;
}

async function selectInitTarget(flags: Record<string, string | boolean>): Promise<{ tenantId: string; accountId: string }> {
  const context = await getCliRemoteContext(flags);
  const explicitTenant = stringFlag(flags, 'tenant') || stringFlag(flags, 'tenant-id');
  const explicitAccount = stringFlag(flags, 'account') || stringFlag(flags, 'account-id');
  const candidates = context.accounts.filter(account => !explicitTenant || account.tenantId === explicitTenant);

  if (explicitAccount) {
    const selected = candidates.find(account => account.accountId === explicitAccount);
    if (!selected) throw new InitRunnerError('target_selection_required', 'The requested WeChat account is not accessible in the selected tenant.');
    return { tenantId: selected.tenantId, accountId: selected.accountId };
  }
  if (candidates.length !== 1) {
    throw new InitRunnerError(
      'target_selection_required',
      candidates.length === 0
        ? 'No accessible WeChat account is available for initialization.'
        : 'Multiple WeChat accounts are accessible; resume with an explicit --tenant and --account.',
    );
  }
  return { tenantId: candidates[0].tenantId, accountId: candidates[0].accountId };
}

function stableInitErrorCode(serverCode: string | undefined, status: number): ConstructorParameters<typeof InitRunnerError>[0] {
  switch (serverCode) {
    case 'init_run_conflict': return 'init_run_conflict';
    case 'init_run_expired':
    case 'init_run_not_found': return 'init_run_expired';
    case 'wechat_ip_not_allowlisted': return 'wechat_ip_not_allowlisted';
    case 'wechat_egress_ip_unavailable': return 'wechat_egress_ip_unavailable';
    case 'wechat_relay_unavailable': return 'wechat_relay_unavailable';
    case 'wechat_credentials_rejected':
    case 'wechat_invalid_credentials': return 'wechat_invalid_credentials';
    case 'target_selection_required':
    case 'account_required': return 'target_selection_required';
    case 'credential_handoff_invalid':
    case 'credential_handoff_not_found': return 'secure_input_required';
    default: return status === 401 || status === 403 ? 'oauth_revoked' : 'timeout';
  }
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
    if (stringFlag(flags, 'app-secret') || stringFlag(flags, 'appSecret')) {
      throw new CliUsageError('Do not pass AppSecret in command arguments. Configure it through the secure handoff.');
    }
    const body = {
      name: stringFlag(flags, 'name'),
      appId: stringFlag(flags, 'app-id') || stringFlag(flags, 'appId'),
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
    if (stringFlag(flags, 'app-secret') || stringFlag(flags, 'appSecret')) {
      throw new CliUsageError('Do not pass AppSecret in command arguments. Run this command in a trusted TTY and enter it without echo.');
    }
    const appId = stringFlag(flags, 'app-id') || stringFlag(flags, 'appId');
    if (!appId) throw new CliUsageError('account configure requires --app-id <wx...>.');
    const appSecret = await readSecureInput({ prompt: 'AppSecret（输入不回显）: ' });
    const body = {
      appId,
      appSecret,
      token: stringFlag(flags, 'token'),
      encodingAESKey: stringFlag(flags, 'encoding-aes-key') || stringFlag(flags, 'encodingAESKey'),
    };
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

  const metadata = await discoverOAuthMetadata(server);
  const scopeProfile = stringFlag(flags, 'scope-profile');
  if (scopeProfile && scopeProfile !== 'wechat-full') {
    throw new CliUsageError('login --scope-profile currently supports only wechat-full.');
  }
  const scope = stringFlag(flags, 'scope')
    || stringFlag(flags, 'scopes')
    || cliScopesForProfile(scopeProfile);
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  const timeoutSeconds = Number(stringFlag(flags, 'timeout') || '300');
  const explicitlyHeadless = flags.headless === true || flags.headless === 'true';
  const noOpen = flags['no-open'] === true || flags['no-open'] === 'true';
  const headless = explicitlyHeadless || (!noOpen && isLikelyHeadlessEnvironment());
  const callbackPort = Number(stringFlag(flags, 'callback-port') || (headless ? '8787' : '0'));
  if (!Number.isInteger(callbackPort) || callbackPort < 0 || callbackPort > 65535 || (headless && callbackPort === 0)) {
    throw new Error('login --callback-port must be an integer from 1 to 65535 in headless mode.');
  }
  const callback = headless
    ? null
    : await startLocalCallbackServer(state, Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 300_000, callbackPort);
  const redirectUri = callback?.redirectUri || `http://127.0.0.1:${callbackPort}/callback`;
  const registration = await registerOAuthClient(metadata, server, redirectUri, requestedClientId, scope);
  const authorizeUrl = new URL(metadata.authorization_endpoint || new URL('/authorize', server).toString());
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', registration.client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', scope);

  await savePendingOAuth({
    server,
    clientId: registration.client_id,
    clientSecret: registration.client_secret,
    tokenEndpoint: metadata.token_endpoint,
    verifier,
    state,
    redirectUri,
    scope,
  });

  console.log('Open this OAuth URL in a browser to continue login:');
  console.log(authorizeUrl.toString());
  if (headless) {
    console.log('\nAfter approval, the browser may fail to open the localhost callback. Copy its full address-bar URL, then run:');
    console.log('woa login complete');
    return;
  }
  if (!flags['no-open']) {
    openBrowser(authorizeUrl.toString());
  }
  console.log(`Waiting for OAuth callback on ${redirectUri} ...`);

  try {
    const code = await callback!.waitForCode;
    const tokenResponse = await exchangeAuthorizationCode(metadata, server, {
      code,
      verifier,
      redirectUri,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
    });
    await saveOAuthTokenResponse(tokenResponse, scope, {
      server,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      tokenEndpoint: metadata.token_endpoint,
    });
    console.log(`OAuth login complete for ${server}. Token saved to ${CONFIG_PATH}; no WeChat app secret was stored locally.`);
  } finally {
    await callback!.close();
  }
}

async function completeHeadlessLogin(
  flags: Record<string, string | boolean>,
  options: { quiet?: boolean } = {},
): Promise<void> {
  const config = await loadConfig();
  const pending = config.pkce;
  const pendingServer = pending?.server || config.server;
  const pendingClientId = pending?.clientId || config.clientId;
  const pendingClientSecret = pending?.clientSecret || config.clientSecret;
  const pendingTokenEndpoint = pending?.tokenEndpoint || config.tokenEndpoint;
  if (!pendingServer || !pendingClientId || !pending?.verifier || !pending.state || !pending.redirectUri) {
    throw new Error('No pending headless OAuth login. Start with `woa login --server <url> --headless`.');
  }
  if (pending.createdAt && Date.now() - pending.createdAt > 15 * 60 * 1000) {
    throw new Error('Pending headless OAuth login is older than 15 minutes. Start `woa login --headless` again.');
  }

  if (stringFlag(flags, 'callback-url')) {
    throw new CliUsageError('Do not pass the OAuth authorization response in command arguments. Run `woa login complete` in a trusted TTY.');
  }
  const callbackUrlText = await readSecureInput({ prompt: '粘贴 OAuth 返回地址（输入不回显）: ' });
  const code = authorizationCodeFromCallback(callbackUrlText, {
    redirectUri: pending.redirectUri,
    state: pending.state,
  });

  const tokenResponse = await exchangeAuthorizationCode({ token_endpoint: pendingTokenEndpoint }, pendingServer, {
    code,
    verifier: pending.verifier,
    redirectUri: pending.redirectUri,
    clientId: pendingClientId,
    clientSecret: pendingClientSecret,
  });
  await saveOAuthTokenResponse(tokenResponse, pending.scope || DEFAULT_CLI_SCOPES, {
    server: pendingServer,
    clientId: pendingClientId,
    clientSecret: pendingClientSecret,
    tokenEndpoint: pendingTokenEndpoint,
  });
  if (!options.quiet) {
    console.log(`OAuth login complete for ${pendingServer}. Token saved to ${CONFIG_PATH}; no WeChat app secret was stored locally.`);
  }
}

async function saveOAuthTokenResponse(
  tokenResponse: OAuthTokenResponse,
  fallbackScope: string,
  client?: { server: string; clientId: string; clientSecret?: string; tokenEndpoint?: string },
): Promise<void> {
  await saveConfig({
    ...(await loadConfig()),
    ...(client ? {
      server: client.server,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      tokenEndpoint: client.tokenEndpoint,
    } : {}),
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type,
    scope: tokenResponse.scope || fallbackScope,
    expiresAt: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : undefined,
    pkce: undefined,
  });
}

async function savePendingOAuth(input: {
  server: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  verifier: string;
  state: string;
  redirectUri: string;
  scope: string;
}): Promise<void> {
  await saveConfig({
    ...(await loadConfig()),
    pkce: {
      server: input.server,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      tokenEndpoint: input.tokenEndpoint,
      verifier: input.verifier,
      state: input.state,
      redirectUri: input.redirectUri,
      scope: input.scope,
      createdAt: Date.now(),
    },
  });
}

async function prepareInitOAuthAuthorization(
  server: string,
  options: {
    headless: boolean;
    callbackPort: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<PreparedInitOAuthAuthorization> {
  if (
    !Number.isInteger(options.callbackPort) ||
    options.callbackPort < 0 ||
    options.callbackPort > 65535 ||
    (options.headless && options.callbackPort === 0)
  ) {
    throw new CliUsageError('woa init --callback-port must be an integer from 1 to 65535 in headless mode.');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new CliUsageError('woa init --timeout must be a positive number of seconds.');
  }
  const metadata = await discoverOAuthMetadata(server, options.signal);
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  const callback = options.headless
    ? null
    : await startLocalCallbackServer(state, options.timeoutMs, options.callbackPort);
  const redirectUri = callback?.redirectUri || `http://127.0.0.1:${options.callbackPort}/callback`;
  try {
    const registration = await registerOAuthClient(
      metadata,
      server,
      redirectUri,
      `${DEFAULT_CLIENT_ID}-init`,
      DEFAULT_CLI_SCOPES,
      options.signal,
    );
    const authorizeUrl = new URL(metadata.authorization_endpoint || new URL('/authorize', server).toString());
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', registration.client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', DEFAULT_CLI_SCOPES);
    await savePendingOAuth({
      server,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      tokenEndpoint: metadata.token_endpoint,
      verifier,
      state,
      redirectUri,
      scope: DEFAULT_CLI_SCOPES,
    });
    return {
      authorizationUrl: authorizeUrl.toString(),
      complete: async () => {
        if (!callback) {
          await completeHeadlessLogin({}, { quiet: true });
          return;
        }
        const code = await waitForCallbackCode(callback.waitForCode, options.signal);
        const tokenResponse = await exchangeAuthorizationCode(metadata, server, {
          code,
          verifier,
          redirectUri,
          clientId: registration.client_id,
          clientSecret: registration.client_secret,
        }, options.signal);
        await saveOAuthTokenResponse(tokenResponse, DEFAULT_CLI_SCOPES, {
          server,
          clientId: registration.client_id,
          clientSecret: registration.client_secret,
          tokenEndpoint: metadata.token_endpoint,
        });
      },
      close: async () => await callback?.close(),
    };
  } catch (error) {
    await callback?.close();
    throw error;
  }
}

async function waitForCallbackCode(waitForCode: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return await waitForCode;
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('OAuth callback aborted.');
  return await new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('OAuth callback aborted.'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    waitForCode.then(
      code => { cleanup(); resolve(code); },
      error => { cleanup(); reject(error); },
    );
  });
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

async function discoverOAuthMetadata(server: string, signal?: AbortSignal): Promise<OAuthServerMetadata> {
  const fallback = {
    authorization_endpoint: new URL('/authorize', server).toString(),
    token_endpoint: new URL('/oauth/token', server).toString(),
    registration_endpoint: new URL('/oauth/register', server).toString(),
  };
  try {
    const response = await fetch(new URL('/.well-known/oauth-authorization-server', server), { signal });
    if (!response.ok) return fallback;
    return { ...fallback, ...await response.json() as OAuthServerMetadata };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return fallback;
  }
}

async function registerOAuthClient(
  metadata: OAuthServerMetadata,
  server: string,
  redirectUri: string,
  requestedClientId: string,
  scope: string,
  signal?: AbortSignal,
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
    signal,
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
  signal?: AbortSignal,
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
    signal,
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
    child.once('error', () => {
      // URL 已打印；缺少桌面 opener 时由用户改用 headless 流程。
    });
    child.unref();
  } catch {
    // Printing the URL above is the reliable fallback for headless environments.
  }
}

function isLikelyHeadlessEnvironment(): boolean {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return true;
  return process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
}

async function handleMcpApiCommand(
  sub: string | undefined,
  toolName: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (sub === 'list') {
    const client = await createCliMcpApiClient(flags);
    try {
      const tools = await client.listTools();
      const selected = flagEnabled(flags, 'all') ? tools : filterWechatTools(tools);
      console.log(JSON.stringify({
        success: true,
        data: {
          count: selected.length,
          tools: selected.map(tool => ({
            name: tool.name,
            description: tool.description,
            annotations: tool.annotations,
          })),
        },
      }, null, 2));
    } finally {
      await client.close();
    }
    return;
  }

  if (sub === 'describe') {
    if (!toolName) throw new CliUsageError('api describe requires a tool name.');
    if (!isWechatToolName(toolName) && !flagEnabled(flags, 'all')) {
      throw new CliUsageError('api describe defaults to wechat_* tools. Pass --all only when inspecting a management tool.');
    }
    const client = await createCliMcpApiClient(flags);
    try {
      const tool = (await client.listTools()).find(candidate => candidate.name === toolName);
      if (!tool) throw new Error(`MCP tool not found: ${toolName}`);
      console.log(JSON.stringify({ success: true, data: tool }, null, 2));
    } finally {
      await client.close();
    }
    return;
  }

  if (sub === 'call') {
    if (!toolName) throw new CliUsageError('api call requires a wechat_* tool name.');
    const args = await loadCliJsonObject({
      input: stringFlag(flags, 'input'),
      file: stringFlag(flags, 'file'),
      stdin: flagEnabled(flags, 'stdin'),
    });
    await executeWechatMcpCall(toolName, args, flags);
    return;
  }

  throw new CliUsageError(`Unknown API command: api ${sub ?? ''}`.trim());
}

async function handleDraftMcpCommand(
  action: string,
  mediaIdArg: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (action === 'get') {
    const mediaId = mediaIdArg || stringFlag(flags, 'media-id') || stringFlag(flags, 'mediaId');
    if (!mediaId) throw new CliUsageError('draft get requires <mediaId> or --media-id <mediaId>.');
    await executeWechatMcpCall('wechat_draft', { action, mediaId }, flags);
    return;
  }
  if (action === 'count') {
    await executeWechatMcpCall('wechat_draft', { action }, flags);
    return;
  }

  const loaded = normalizeDraftArticlesInput(await loadCliJsonObject({
    input: stringFlag(flags, 'input'),
    file: stringFlag(flags, 'file'),
    stdin: flagEnabled(flags, 'stdin'),
  }));
  const articles = loaded.articles;
  if (!Array.isArray(articles) || articles.length === 0) {
    throw new CliUsageError(`draft ${action} requires article JSON through --input, --file, or --stdin.`);
  }

  if (action === 'add') {
    await executeWechatMcpCall('wechat_draft', { ...loaded, action, articles }, flags);
    return;
  }

  const mediaId = mediaIdArg || stringFlag(flags, 'media-id') || stringFlag(flags, 'mediaId');
  const index = optionalNonNegativeIntFlag(flags, 'index');
  if (!mediaId) throw new CliUsageError('draft update requires <mediaId> or --media-id <mediaId>.');
  if (index === undefined) throw new CliUsageError('draft update requires --index <n>.');
  if (articles.length !== 1) throw new CliUsageError('draft update requires exactly one article.');
  await executeWechatMcpCall('wechat_draft', {
    ...loaded,
    action,
    mediaId,
    index,
    articles,
  }, flags);
}

async function executeWechatMcpCall(
  toolName: string,
  rawArgs: Record<string, unknown>,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (!isWechatToolName(toolName)) {
    throw new CliUsageError('woa api call is limited to wechat_* tools. Use the dedicated woa management commands for SaaS administration.');
  }

  if (flagEnabled(flags, 'dry-run')) {
    const args = await injectDryRunAccount(rawArgs, flags);
    const syntheticTool: CliMcpTool = {
      name: toolName,
      inputSchema: { type: 'object' },
    };
    console.log(JSON.stringify({
      ...createToolDryRun(toolName, args),
      requiredConfirmation: requiredToolConfirmation(syntheticTool, args),
    }, null, 2));
    return;
  }

  const client = await createCliMcpApiClient(flags);
  try {
    const tool = (await client.listTools()).find(candidate => candidate.name === toolName);
    if (!tool || !isWechatToolName(tool.name)) throw new Error(`WeChat MCP tool not found: ${toolName}`);
    const args = await injectToolAccount(tool, rawArgs, flags);
    assertToolConfirmation(tool, args, stringFlag(flags, 'confirm'));
    const result = await client.callTool(tool.name, args);
    console.log(JSON.stringify(result, null, 2));
    if (result.isError === true) {
      printMcpScopeRecovery(result);
      process.exitCode = 1;
    }
  } catch (error) {
    printMcpScopeRecovery(error);
    throw error;
  } finally {
    await client.close();
  }
}

async function createCliMcpApiClient(flags: Record<string, string | boolean>): Promise<CliMcpApiClient> {
  const config = await loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || config.server || '');
  if (!server) throw new Error('Missing server. Run `woa login --server <url>` or pass --server.');
  return new CliMcpApiClient({
    server,
    clientVersion: CLI_VERSION,
    fetch: async (input, init = {}) => await fetchWithOAuth(new URL(input.toString()), init, flags),
  });
}

async function injectToolAccount(
  tool: CliMcpTool,
  args: Record<string, unknown>,
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  const acceptsAccount = Object.prototype.hasOwnProperty.call(tool.inputSchema.properties ?? {}, 'accountId');
  if (!acceptsAccount) return args;
  const argumentAccountId = typeof args.accountId === 'string' && args.accountId.trim() ? args.accountId.trim() : undefined;
  const flagAccountId = stringFlag(flags, 'account') || stringFlag(flags, 'account-id');
  if (argumentAccountId && flagAccountId && argumentAccountId !== flagAccountId) {
    throw new CliUsageError('Tool input accountId conflicts with --account. Choose one target account.');
  }
  const selectionFlags = argumentAccountId ? { ...flags, account: argumentAccountId } : flags;
  const { accountId } = await resolveTenantAccount(selectionFlags);
  return argumentAccountId ? args : { ...args, accountId };
}

async function injectDryRunAccount(
  args: Record<string, unknown>,
  flags: Record<string, string | boolean>,
): Promise<Record<string, unknown>> {
  if (typeof args.accountId === 'string' && args.accountId.trim()) return args;
  const config = await loadConfig();
  const accountId = stringFlag(flags, 'account') || stringFlag(flags, 'account-id') || config.activeAccountId;
  return accountId ? { ...args, accountId } : args;
}

function printMcpScopeRecovery(value: unknown): void {
  const text = value instanceof Error ? value.message : JSON.stringify(value);
  if (!/missing[_ -]?scope|woa:[a-z]+:[a-z]+/i.test(text)) return;
  const match = text.match(/woa:[a-z]+:[a-z]+/i);
  console.error(
    `CLI OAuth grant lacks${match ? ` ${match[0]}` : ' a required scope'}. Reauthorize explicitly with: ` +
    'woa login --server <url> --scope-profile wechat-full',
  );
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
  const result = await uploadLocalMediaResult(fileArg, flags);
  console.log(JSON.stringify(result, null, 2));
}

async function uploadLocalMediaResult(fileArg: string | undefined, flags: Record<string, string | boolean>): Promise<unknown> {
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
  const { tenantId, accountId } = await resolveTenantAccount(flags);
  const query = new URLSearchParams({ filename: fileName });
  const route = `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/media/uploads?${query}`;
  const response = await fetchWithOAuth(new URL(route, server), {
    method: 'POST',
    headers: {
      'content-type': mimeType,
      'content-length': String(bytes.byteLength),
      ...(stringFlag(flags, 'scopes') ? { 'x-woa-scopes': stringFlag(flags, 'scopes') as string } : {}),
    },
    body: bytes,
  }, flags);
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(`Remote media upload failed with ${response.status}: ${text}`);
  }
  return withMediaUploadHints(data, accountId);
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
    throw new Error('Missing server. Run `woa login --server <url>` or pass --server.');
  }
  const response = await fetchWithOAuth(new URL(route, server), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(stringFlag(flags, 'scopes') ? { 'x-woa-scopes': stringFlag(flags, 'scopes') as string } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, flags);
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
  return await readSecureJson<CliConfig>(CONFIG_PATH) ?? {};
}

async function saveConfig(config: CliConfig): Promise<void> {
  await writeSecureJson(CONFIG_PATH, config);
}

async function fetchWithOAuth(
  input: URL,
  init: RequestInit,
  flags: Record<string, string | boolean>,
): Promise<Response> {
  const saved = await loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || saved.server || input.origin);
  if (!server) {
    throw new Error('Missing server. Run `woa login --server <url>` or pass --server.');
  }

  let session: CliConfig = { ...saved, server };
  const fresh = await ensureFreshOAuthSession(session);
  session = fresh.session as CliConfig;
  if (fresh.refreshed) await saveConfig(session);
  if (!session.accessToken) {
    throw new Error('Missing OAuth access token. Run `woa login --server <url>` and complete the refreshable OAuth session.');
  }

  const send = async (accessToken: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${accessToken}`);
    return await fetch(input, { ...init, headers });
  };

  let response = await send(session.accessToken);
  if (response.status === 401 && session.refreshToken) {
    await response.arrayBuffer();
    const fresh = await ensureFreshOAuthSession(session, { forceRefresh: true });
    session = fresh.session as CliConfig;
    await saveConfig(session);
    response = await send(session.accessToken!);
  }
  return response;
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

function flagEnabled(flags: Record<string, string | boolean>, name: string): boolean {
  const value = flags[name];
  return value === true || value === 'true' || value === '1';
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
  woa --version
  woa help agent [--format markdown|json]
  woa ui
  woa init [--server <url>] [--headless] [--plain] [--no-open]
  woa init --agent [--server <url>] --format jsonl
  woa init status [--run <runId>] [--format json]
  woa init resume <runId> [--plain]
  woa init resume <runId> --agent --format jsonl
  woa mcp descriptor [--server <url>] [--format json]
  woa mcp tools
  woa mcp describe <wechat_tool>
  woa mcp call <wechat_tool> [--input <json> | --file <path> | --stdin]
  woa api list [--all]
  woa api describe <wechat_tool>
  woa api call <wechat_tool> [--input <json> | --file <path> | --stdin]
  woa login --server <url> [--headless] [--scope-profile wechat-full]
  woa login complete
  woa whoami [--server <url>]
  woa tenant list
  woa tenant usage [--tenant <tenantId>]
  woa usage [--tenant <tenantId>]
  woa quota status [--tenant <tenantId>]
  woa account list [--tenant <tenantId>]
  woa account create [--tenant <tenantId>] [--name <name>]
  woa account status [--tenant <tenantId>] [--account <accountId>]
  woa account rename <accountId> --name <name> [--tenant <tenantId>]
  woa account default <accountId> [--tenant <tenantId>]
  woa account configure --tenant <tenantId> --account <accountId> --app-id <wx...>
  woa account delete <accountId> --confirm-delete [--tenant <tenantId>]
  woa billing checkout --plan plus|pro [--tenant <tenantId>] [--no-open]
  woa draft add [--input <json> | --file <path> | --stdin] [--tenant <tenantId>] [--account <accountId>]
  woa draft update <media_id> --index <n> [--input <json> | --file <path> | --stdin]
  woa draft get <media_id> [--tenant <tenantId>] [--account <accountId>]
  woa draft count [--tenant <tenantId>] [--account <accountId>]
  woa draft list [--tenant <tenantId>] [--account <accountId>] [--count 20]
  woa draft delete <media_id> --confirm-delete [--tenant <tenantId>] [--account <accountId>]
  woa publish list [--tenant <tenantId>] [--account <accountId>] [--count 20]
  woa publish delete <article_id> [--index <n>] --confirm-delete [--tenant <tenantId>] [--account <accountId>]
  woa inbox list [--tenant <tenantId>] [--account <accountId>] [--limit 20]
  woa media upload <local-file> [--tenant <tenantId>] [--account <accountId>] [--content-type <mime>]

Runtime posture:
  - Node.js 20 or newer is required by the published CLI.
  - Human-operated TTY: use \`woa ui\` or \`woa init\`; command-capable Agents first read \`woa help agent\`.
  - Plain, pipe, CI, and Agent paths never mount Ink; use \`woa init --plain\` or strict JSONL.
  - Remote-only: commands call the OAuth-protected Worker REST API or the standard remote /mcp endpoint.
  - \`woa api list/describe/call\` exposes the authoritative current wechat_* MCP tool surface without duplicating REST routes.
  - Prefer --file or --stdin for long or sensitive structured input; do not place secrets in --input or shell history.
  - Protected MCP actions require exact --confirm <tool>:<action>; --dry-run never opens an MCP connection.
  - No local MCP server, stdio transport, SSE transport, SQLite, or local WeChat runtime.
  - Local files use \`woa media upload <path>\` to stage binary bytes in R2; remote MCP tools receive only r2Key/fileUrl, never a local path or base64 payload.
  - Destructive delete commands require --confirm-delete; use --dry-run first to verify the target.
  - Secrets and OAuth authorization responses are accepted only by direct no-echo human input or the one-time HTTPS handoff.
  - Headless servers use two-step PKCE login: authorize in a user browser, then run \`woa login complete\` in a trusted TTY.
  - The MCP descriptor contains only the remote URL and OAuth capabilities; it contains no reusable credential.`);
}

main(process.argv.slice(2)).catch(error => {
  if ((error as NodeJS.ErrnoException)?.code === 'EPIPE') {
    process.exitCode = 0;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliUsageError ? 2 : 1;
});
