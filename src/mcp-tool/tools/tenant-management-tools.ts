import { z } from 'zod';
import type {
  AccessTokenInfo,
  McpTool,
  WechatApiClient,
  WechatConfig,
  WechatToolResult,
} from '../types.js';
import {
  accountFromParams,
  contextFromParams,
  publicAccounts,
  publicContext,
  requireScope,
  type AccountContext,
  type TenantRequestContext,
} from '../../worker/tenant-context.js';
import { appIdSchema, appSecretSchema } from '../../utils/validation.js';
import type { D1UsageQuotaStore } from '../../worker/usage-store.js';
import {
  AccountAllowanceError,
  DuplicateAppIdError,
  type D1SaasOnboardingStore,
  type WechatResourceRecord,
} from '../../worker/saas-onboarding-store.js';
import type { D1AuditLogWriter } from '../../worker/audit-log.js';

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
  action: z.enum(['list', 'get', 'status', 'configure', 'create', 'update', 'set_default', 'delete', 'disable']),
  tenantId: tenantIdSchema,
  accountId: accountIdSchema,
  slug: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(128).optional(),
  appId: appIdSchema.optional(),
  appSecret: appSecretSchema.optional(),
  token: z.string().max(128).optional(),
  encodingAESKey: z.string().length(43).optional(),
  confirmation: z.string().max(256).optional(),
});

const auditSchema = z.object({
  tenantId: tenantIdSchema,
  accountId: accountIdSchema,
  action: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export interface TenantManagementMcpToolOptions {
  onboardingStore?: D1SaasOnboardingStore;
  usageStore?: D1UsageQuotaStore;
  auditLog?: D1AuditLogWriter;
  validateWechatCredentials?: (
    config: WechatConfig,
    account: AccountContext,
  ) => Promise<AccessTokenInfo | null | undefined>;
}

/**
 * 创建租户管理 MCP 工具。
 *
 * 无依赖时保留库级兼容行为；Workers 注入 D1/配额/审计依赖后，所有管理操作
 * 使用与 Web/CLI 相同的持久化仓库，不再返回占位结果。
 */
export function createTenantManagementMcpTools(
  options: TenantManagementMcpToolOptions = {},
): McpTool[] {
  return [
    createContextTool(options),
    createTenantTool(options),
    createAccountTool(options),
    createAuditTool(options),
  ];
}

function createContextTool(options: TenantManagementMcpToolOptions): McpTool {
  return {
    name: 'woa_context',
    description: '查看当前 OAuth 用户、租户、公众号账号、默认账号、订阅计划和配额上下文',
    inputSchema: {
      accountId: accountIdSchema.describe('可选：要查看的公众号账号 ID'),
    },
    handler: async (params: unknown): Promise<WechatToolResult> => {
      contextSchema.parse(params ?? {});
      const context = contextFromParams(params);
      requireScope(context, 'woa:context:read');
      const account = accountFromParams(params);
      const tenantId = account?.tenantId ?? context.defaultTenantId;
      const operator = options.onboardingStore
        ? await options.onboardingStore.findOperatorById(context.userId)
        : null;
      const quota = tenantId && options.usageStore
        ? await options.usageStore.getUsageSummary(tenantId)
        : null;
      const resource = account && options.onboardingStore
        ? await options.onboardingStore.getWechatResource(account.tenantId, account.accountId)
        : null;

      const data = publicContext(context);
      if (operator) {
        Object.assign(data.user as Record<string, unknown>, {
          email: operator.verifiedEmail,
          displayName: operator.displayName,
          status: operator.status,
        });
      }

      return textResult('当前 WOA 上下文', {
        ...data,
        activeAccount: account ? publicResource(resource ?? account.account) : null,
        plan: quota?.entitlement ?? null,
        quota: quota ? {
          generatedAt: quota.generatedAt,
          metrics: quota.metrics,
          upgradePrompt: quota.upgradePrompt,
        } : null,
      });
    },
  };
}

function createTenantTool(options: TenantManagementMcpToolOptions): McpTool {
  return {
    name: 'woa_tenant',
    description: '租户管理：列出、读取或更新当前 Operator 可访问的租户；首版不允许通过 MCP 创建租户',
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

      const tenant = requireAccessibleTenant(context, validated.tenantId);
      if (validated.action === 'get') {
        return textResult('租户详情', { tenant });
      }

      requireScope(context, 'woa:tenant:write');
      if (!validated.displayName) {
        return structuredError('validation_error', 'update 需要 displayName');
      }
      if (!options.onboardingStore) {
        return structuredError('runtime_unavailable', '租户持久化存储未配置。');
      }

      const updated = await options.onboardingStore.renameTenant({
        tenantId: tenant.tenantId,
        name: validated.displayName,
      });
      await writeAudit(options, context, {
        tenantId: tenant.tenantId,
        action: 'tenant.rename',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        metadata: { name: validated.displayName },
      });
      return textResult('租户已更新', { tenant: updated });
    },
  };
}

function createAccountTool(options: TenantManagementMcpToolOptions): McpTool {
  return {
    name: 'woa_account',
    description: '公众号资源管理：列表、创建、重命名、设为默认、配置凭据、状态和删除；响应不会返回原始 secret',
    inputSchema: {
      action: accountSchema.shape.action.describe('操作类型'),
      tenantId: tenantIdSchema.describe('租户 ID；省略时使用默认租户'),
      accountId: accountIdSchema.describe('公众号账号 ID；省略时使用默认/唯一账号'),
      slug: accountSchema.shape.slug.describe('账号 slug（create 时可选）'),
      name: accountSchema.shape.name.describe('账号名称（create/update 时使用）'),
      appId: z.string().optional().describe('微信公众号 AppID（configure 时必需）'),
      appSecret: z.string().optional().describe('微信公众号 AppSecret（configure 时必需；不会回显）'),
      token: z.string().optional().describe('微信回调 Token（可选）'),
      encodingAESKey: z.string().optional().describe('微信回调 EncodingAESKey（可选）'),
      confirmation: z.string().optional().describe('删除确认标记：DELETE <accountId>'),
    },
    handler: async (params: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
      const validated = accountSchema.parse(params);
      const context = contextFromParams(params);
      requireScope(context, 'woa:account:read');

      try {
        if (validated.action === 'list') {
          const tenant = requireAccessibleTenant(context, validated.tenantId);
          const accounts = options.onboardingStore
            ? (await options.onboardingStore.listWechatResources(tenant.tenantId)).map(publicResource)
            : publicAccounts(context.accounts.filter(item => item.tenantId === tenant.tenantId));
          return textResult('可访问公众号账号', { tenantId: tenant.tenantId, accounts });
        }

        if (validated.action === 'create') {
          requireScope(context, 'woa:account:write');
          const tenant = requireAccessibleTenant(context, validated.tenantId);
          if (!options.onboardingStore) {
            return structuredError('runtime_unavailable', '公众号资源持久化存储未配置。');
          }
          const created = await options.onboardingStore.createWechatResource({
            tenantId: tenant.tenantId,
            name: validated.name,
            slug: validated.slug,
          });
          await writeAudit(options, context, {
            tenantId: tenant.tenantId,
            accountId: created.accountId,
            action: 'account.create',
            targetType: 'wechat_account',
            targetId: created.accountId,
            metadata: { name: created.name },
          });
          return textResult('公众号资源已创建', { account: publicResource(created) });
        }

        const account = requireAccessibleAccount(params);
        if (validated.action === 'get') {
          const resource = await getResource(options, account);
          return textResult('公众号账号详情', { account: publicResource(resource ?? account.account) });
        }

        if (validated.action === 'status') {
          const resource = await getResource(options, account);
          if (resource) {
            return textResult('公众号账号状态', {
              account: publicResource(resource),
              configured: resource.status === 'active' && resource.hasAppSecret,
              inbox: resource.hasWebhookToken && resource.hasEncodingAESKey
                ? { configured: true, callbackPath: `/wx/callback/${resource.accountId}` }
                : {
                  configured: false,
                  guidance: '入站消息需要配置 webhook Token、EncodingAESKey，并在微信后台设置账号专属回调地址。',
                },
            });
          }
          return legacyAccountStatus(account, await apiClient.getAuthManager().getConfig());
        }

        requireScope(context, 'woa:account:write');
        if (validated.action === 'configure') {
          if (!validated.appId || !validated.appSecret) {
            return structuredError('validation_error', 'configure 需要 appId 和 appSecret');
          }
          if (!options.onboardingStore) {
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
            });
          }
          if (!options.validateWechatCredentials) {
            return structuredError('runtime_unavailable', 'WeChat 凭据校验器未配置。');
          }
          const config: WechatConfig = {
            appId: validated.appId,
            appSecret: validated.appSecret,
            token: validated.token,
            encodingAESKey: validated.encodingAESKey,
          };
          const configured = await options.onboardingStore.validateAndPersistWechatCredentials({
            tenantId: account.tenantId,
            resourceId: account.accountId,
            config,
            validate: async current => await options.validateWechatCredentials!(current, account),
          });
          await writeAudit(options, context, {
            tenantId: account.tenantId,
            accountId: account.accountId,
            action: 'account.credentials_configured',
            targetType: 'wechat_account',
            targetId: account.accountId,
            metadata: {
              appId: configured.appId,
              hasWebhookToken: configured.hasWebhookToken,
              hasEncodingAESKey: configured.hasEncodingAESKey,
            },
          });
          return textResult('公众号账号配置已验证并保存', {
            account: publicResource(configured),
            inbox: configured.hasWebhookToken && configured.hasEncodingAESKey
              ? { configured: true, callbackPath: `/wx/callback/${configured.accountId}` }
              : {
                configured: false,
                guidance: 'Webhook 为可选项；如需收件箱，请补充 Token/EncodingAESKey 并配置账号专属回调地址。',
              },
          });
        }

        if (!options.onboardingStore) {
          return structuredError('runtime_unavailable', '公众号资源持久化存储未配置。');
        }

        if (validated.action === 'update') {
          if (!validated.name) {
            return structuredError('validation_error', 'update 需要 name');
          }
          const updated = await options.onboardingStore.renameWechatResource({
            tenantId: account.tenantId,
            resourceId: account.accountId,
            name: validated.name,
          });
          await writeAudit(options, context, {
            tenantId: account.tenantId,
            accountId: account.accountId,
            action: 'account.rename',
            targetType: 'wechat_account',
            targetId: account.accountId,
            metadata: { name: validated.name },
          });
          return textResult('公众号资源已重命名', { account: publicResource(updated) });
        }

        if (validated.action === 'set_default') {
          const updated = await options.onboardingStore.setDefaultWechatResource({
            tenantId: account.tenantId,
            resourceId: account.accountId,
          });
          await writeAudit(options, context, {
            tenantId: account.tenantId,
            accountId: account.accountId,
            action: 'account.set_default',
            targetType: 'wechat_account',
            targetId: account.accountId,
          });
          return textResult('默认公众号资源已更新', { account: publicResource(updated) });
        }

        const confirmation = validated.confirmation ?? '';
        await options.onboardingStore.softDeleteWechatResource({
          tenantId: account.tenantId,
          resourceId: account.accountId,
          confirmation,
        });
        await writeAudit(options, context, {
          tenantId: account.tenantId,
          accountId: account.accountId,
          action: 'account.delete',
          targetType: 'wechat_account',
          targetId: account.accountId,
          metadata: { secretsPurged: true },
        });
        return textResult('公众号资源已删除', {
          tenantId: account.tenantId,
          accountId: account.accountId,
          deleted: true,
          secretsPurged: true,
        });
      } catch (error) {
        if (error instanceof AccountAllowanceError) {
          return structuredError(error.code, error.message, error.details);
        }
        if (error instanceof DuplicateAppIdError) {
          return structuredError(error.code, error.message, { appId: error.appId });
        }
        if (error instanceof Error && /confirmation marker/i.test(error.message)) {
          return structuredError('confirmation_required', error.message);
        }
        throw error;
      }
    },
  };
}

function createAuditTool(options: TenantManagementMcpToolOptions): McpTool {
  return {
    name: 'woa_audit',
    description: '查询按租户/账号隔离的审计日志；响应不会返回原始 secret',
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
      requireScope(context, 'woa:audit:read');
      const tenant = requireAccessibleTenant(context, validated.tenantId);
      if (validated.accountId) {
        requireAccessibleAccount(params);
      }
      const items = options.auditLog
        ? await options.auditLog.list({
          tenantId: tenant.tenantId,
          accountId: validated.accountId,
          action: validated.action,
          limit: validated.limit,
          offset: validated.offset,
        })
        : [];
      return textResult('审计日志', {
        tenantId: tenant.tenantId,
        accountId: validated.accountId,
        filterAction: validated.action,
        limit: validated.limit,
        offset: validated.offset,
        items,
      });
    },
  };
}

function requireAccessibleTenant(context: TenantRequestContext, tenantId?: string) {
  const requested = tenantId ?? context.defaultTenantId ?? context.tenants[0]?.tenantId;
  const tenant = context.tenants.find(item => item.tenantId === requested);
  if (!tenant) {
    throw new Error(`租户不可访问: ${requested ?? 'unknown'}`);
  }
  return tenant;
}

function requireAccessibleAccount(params: unknown): AccountContext {
  const account = accountFromParams(params);
  if (!account) {
    throw new Error('账号操作需要 accountId，或需要存在默认/唯一可访问账号。');
  }
  return account;
}

async function getResource(
  options: TenantManagementMcpToolOptions,
  account: AccountContext,
): Promise<WechatResourceRecord | null> {
  return options.onboardingStore
    ? await options.onboardingStore.getWechatResource(account.tenantId, account.accountId)
    : null;
}

function legacyAccountStatus(account: AccountContext, config: WechatConfig | null): WechatToolResult {
  return textResult('公众号账号状态', {
    account: account.account,
    configured: !!(config?.appId && config?.appSecret),
    config: maskConfig(config),
  });
}

function publicResource(resource: WechatResourceRecord | AccountContext['account']): Record<string, unknown> {
  const detailed = resource as Partial<WechatResourceRecord>;
  return {
    tenantId: resource.tenantId,
    accountId: resource.accountId,
    slug: resource.slug,
    name: resource.name,
    appId: resource.appId,
    status: resource.status,
    isDefault: resource.isDefault === true,
    ...(typeof detailed.hasAppSecret === 'boolean' ? {
      hasAppSecret: detailed.hasAppSecret,
      hasWebhookToken: detailed.hasWebhookToken === true,
      hasEncodingAESKey: detailed.hasEncodingAESKey === true,
      createdAt: detailed.createdAt,
      updatedAt: detailed.updatedAt,
    } : {}),
  };
}

async function writeAudit(
  options: TenantManagementMcpToolOptions,
  context: TenantRequestContext,
  event: {
    tenantId?: string | null;
    accountId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: unknown;
  },
): Promise<void> {
  await options.auditLog?.write({
    ...event,
    userId: context.userId,
    oauthClientId: context.oauthClientId,
    requestId: context.requestId,
  });
}

function textResult(title: string, data: unknown): WechatToolResult {
  return {
    content: [{
      type: 'text',
      text: `${title}:\n${JSON.stringify(data, null, 2)}`,
    }],
  };
}

function structuredError(code: string, message: string, details?: unknown): WechatToolResult {
  return {
    content: [{ type: 'text', text: `操作失败：${message}` }],
    isError: true,
    _meta: {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
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

export const tenantManagementMcpTools = createTenantManagementMcpTools();
export const [
  woaContextMcpTool,
  woaTenantMcpTool,
  woaAccountMcpTool,
  woaAuditMcpTool,
] = tenantManagementMcpTools;
