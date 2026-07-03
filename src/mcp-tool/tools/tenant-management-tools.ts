import { z } from 'zod';
import type { McpTool, WechatApiClient, WechatToolResult, WechatConfig } from '../types.js';
import {
  accountFromParams,
  contextFromParams,
  publicAccounts,
  publicContext,
  requireScope,
} from '../../worker/tenant-context.js';
import { appIdSchema, appSecretSchema } from '../../utils/validation.js';

const accountIdSchema = z.string().min(1).max(128).optional();
const tenantIdSchema = z.string().min(1).max(128).optional();

const contextSchema = z.object({
  accountId: accountIdSchema,
});

const tenantSchema = z.object({
  action: z.enum(['list', 'get', 'update']),
  tenantId: tenantIdSchema,
  displayName: z.string().min(1).max(128).optional(),
});

const accountSchema = z.object({
  action: z.enum(['list', 'get', 'status', 'configure', 'create', 'update', 'disable']),
  tenantId: tenantIdSchema,
  accountId: accountIdSchema,
  slug: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(128).optional(),
  appId: appIdSchema.optional(),
  appSecret: appSecretSchema.optional(),
  token: z.string().max(128).optional(),
  encodingAESKey: z.string().length(43).optional(),
});

const auditSchema = z.object({
  tenantId: tenantIdSchema,
  accountId: accountIdSchema,
  action: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const woaContextMcpTool: McpTool = {
  name: 'woa_context',
  description: '查看当前 OAuth 用户、租户、公众号账号、默认账号和授权 scope 上下文',
  inputSchema: {
    accountId: accountIdSchema.describe('可选：要设为当前上下文的公众号账号 ID'),
  },
  handler: async (params: unknown): Promise<WechatToolResult> => {
    contextSchema.parse(params ?? {});
    const context = contextFromParams(params);
    const account = accountFromParams(params);

    return textResult('当前 WOA 上下文', {
      ...publicContext(context),
      activeAccount: account ? {
        tenantId: account.tenantId,
        accountId: account.accountId,
        name: account.account.name,
        status: account.account.status,
      } : null,
    });
  },
};

export const woaTenantMcpTool: McpTool = {
  name: 'woa_tenant',
  description: '租户管理：按当前成员身份列出租户、读取租户，更新接口预留给租户存储层',
  inputSchema: {
    action: z.enum(['list', 'get', 'update']).describe('操作类型：list(列表), get(详情), update(更新显示名)'),
    tenantId: tenantIdSchema.describe('租户 ID（get/update 时必需）'),
    displayName: z.string().min(1).max(128).optional().describe('租户显示名（update 时使用）'),
  },
  handler: async (params: unknown): Promise<WechatToolResult> => {
    const validated = tenantSchema.parse(params);
    const context = contextFromParams(params);
    requireScope(context, 'woa:tenant:read');

    if (validated.action === 'list') {
      return textResult('可访问租户', { tenants: context.tenants });
    }

    const tenant = context.tenants.find(item => item.tenantId === validated.tenantId);
    if (!tenant) {
      throw new Error(`租户不可访问: ${validated.tenantId}`);
    }

    if (validated.action === 'get') {
      return textResult('租户详情', { tenant });
    }

    return textResult('租户更新已接收', {
      tenant,
      requestedDisplayName: validated.displayName,
      note: '租户持久化更新由 tenant-aware storage lane 提供；当前 surface 已执行成员与 scope 校验。',
    });
  },
};

export const woaAccountMcpTool: McpTool = {
  name: 'woa_account',
  description: '公众号账号管理：列表、详情、状态、配置凭据；响应不会返回原始 secret',
  inputSchema: {
    action: z.enum(['list', 'get', 'status', 'configure', 'create', 'update', 'disable']).describe('操作类型'),
    tenantId: tenantIdSchema.describe('租户 ID'),
    accountId: accountIdSchema.describe('公众号账号 ID；省略时使用默认/唯一账号'),
    slug: z.string().min(1).max(64).optional().describe('账号 slug（create/update 时使用）'),
    name: z.string().min(1).max(128).optional().describe('账号名称（create/update 时使用）'),
    appId: z.string().optional().describe('微信公众号 AppID（configure 时必需）'),
    appSecret: z.string().optional().describe('微信公众号 AppSecret（configure 时必需；不会持久化到 CLI 本地）'),
    token: z.string().optional().describe('微信回调 Token（可选）'),
    encodingAESKey: z.string().optional().describe('微信回调 EncodingAESKey（可选）'),
  },
  handler: async (params: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
    const validated = accountSchema.parse(params);
    const context = contextFromParams(params);
    requireScope(context, 'woa:account:read');

    if (validated.action === 'list') {
      return textResult('可访问公众号账号', { accounts: publicAccounts(context.accounts) });
    }

    const account = accountFromParams(params);
    if (!account) {
      throw new Error('账号操作需要 accountId，或需要存在默认/唯一可访问账号。');
    }

    if (validated.action === 'get') {
      return textResult('公众号账号详情', { account: account.account });
    }

    if (validated.action === 'status') {
      const config = await apiClient.getAuthManager().getConfig();
      return textResult('公众号账号状态', {
        account: account.account,
        configured: !!(config?.appId && config?.appSecret),
        config: maskConfig(config),
      });
    }

    if (validated.action === 'configure') {
      requireScope(context, 'woa:account:write');
      if (!validated.appId || !validated.appSecret) {
        throw new Error('configure 需要 appId 和 appSecret');
      }

      await apiClient.getAuthManager().setConfig({
        appId: validated.appId,
        appSecret: validated.appSecret,
        token: validated.token,
        encodingAESKey: validated.encodingAESKey,
      });

      return textResult('公众号账号配置已更新', {
        tenantId: account.tenantId,
        accountId: account.accountId,
        appId: validated.appId,
        hasAppSecret: true,
        hasToken: !!validated.token,
        hasEncodingAESKey: !!validated.encodingAESKey,
        note: '当前兼容路径写入 backfilled default account 的既有配置存储；tenant-aware storage lane 接入后会切换为账号级表。',
      });
    }

    return textResult('公众号账号变更已接收', {
      action: validated.action,
      account: account.account,
      requested: {
        slug: validated.slug,
        name: validated.name,
      },
      note: 'create/update/disable 的持久化由 tenant-aware storage lane 提供；当前 surface 已执行账号解析与 scope 校验。',
    });
  },
};

export const woaAuditMcpTool: McpTool = {
  name: 'woa_audit',
  description: '查询审计日志的 MCP 管理工具；按租户/账号过滤，secret 永不回显',
  inputSchema: {
    tenantId: tenantIdSchema.describe('租户 ID'),
    accountId: accountIdSchema.describe('公众号账号 ID'),
    action: z.string().optional().describe('按动作过滤'),
    limit: z.number().int().min(1).max(100).default(20).describe('分页数量，默认20，最大100'),
    offset: z.number().int().min(0).default(0).describe('分页偏移，默认0'),
  },
  handler: async (params: unknown): Promise<WechatToolResult> => {
    const validated = auditSchema.parse(params ?? {});
    const context = contextFromParams(params);
    const account = accountFromParams(params);
    requireScope(context, 'woa:audit:read');

    return textResult('审计日志', {
      tenantId: validated.tenantId ?? account?.tenantId ?? context.defaultTenantId,
      accountId: validated.accountId ?? account?.accountId ?? context.defaultAccountId,
      filterAction: validated.action,
      limit: validated.limit,
      offset: validated.offset,
      items: [],
      note: '审计写入/查询持久化由 audit lane 提供；当前 surface 固定返回结构化空结果。',
    });
  },
};

export const tenantManagementMcpTools: McpTool[] = [
  woaContextMcpTool,
  woaTenantMcpTool,
  woaAccountMcpTool,
  woaAuditMcpTool,
];

function textResult(title: string, data: unknown): WechatToolResult {
  return {
    content: [{
      type: 'text',
      text: `${title}:\n${JSON.stringify(data, null, 2)}`,
    }],
  };
}

function maskConfig(config: WechatConfig | null): Record<string, unknown> | null {
  if (!config) return null;
  return {
    appId: config.appId,
    hasAppSecret: !!config.appSecret,
    hasToken: !!config.token,
    hasEncodingAESKey: !!config.encodingAESKey,
  };
}
