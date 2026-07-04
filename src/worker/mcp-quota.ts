import type { WechatApiClient, WechatToolResult, McpTool } from '../mcp-tool/types.js';
import {
  attachTenantMetadata,
  enrichMcpToolParams,
  type TenantRequestContext,
} from './tenant-context.js';
import {
  D1UsageQuotaStore,
  QuotaExceededError,
  formatQuotaExceededMessage,
  reserveMcpToolQuota,
  type QuotaMetadata,
} from './usage-store.js';
import { getAction } from './quota-policy.js';

export interface ExecuteMcpToolWithQuotaOptions {
  tool: McpTool;
  apiClient: WechatApiClient;
  params: unknown;
  tenantContext: TenantRequestContext;
  usageStore: D1UsageQuotaStore;
}

export async function executeMcpToolWithQuota(
  options: ExecuteMcpToolWithQuotaOptions,
): Promise<WechatToolResult> {
  const scoped = enrichMcpToolParams(options.params, options.tenantContext, options.tool.name);
  const tenantId = scoped.account?.tenantId ?? options.tenantContext.defaultTenantId ?? 'tenant_unknown';
  const accountId = scoped.account?.accountId ?? options.tenantContext.defaultAccountId ?? null;
  const action = getAction(scoped.params);

  try {
    const reservation = await reserveMcpToolQuota({
      store: options.usageStore,
      tenantId,
      accountId,
      userId: options.tenantContext.userId,
      oauthClientId: options.tenantContext.oauthClientId,
      requestId: options.tenantContext.requestId,
      toolName: options.tool.name,
      action,
      params: scoped.params,
    });

    try {
      const result = await options.tool.handler(scoped.params, options.apiClient);
      if (result.isError) {
        await reservation.refund('tool_result_error');
        return attachQuotaMetadata(
          attachTenantMetadata(result, options.tenantContext, scoped.account),
          reservation.metadata(),
          true,
        );
      }

      await reservation.commit();
      return attachQuotaMetadata(
        attachTenantMetadata(result, options.tenantContext, scoped.account),
        reservation.metadata(),
      );
    } catch (error) {
      await reservation.refund('tool_exception');
      throw error;
    }
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return attachTenantMetadata(quotaExceededResult(error), options.tenantContext, scoped.account);
    }
    throw error;
  }
}

export function attachQuotaMetadata(
  result: WechatToolResult,
  quota: QuotaMetadata,
  refunded = false,
): WechatToolResult {
  const currentMeta = result._meta && typeof result._meta === 'object' && !Array.isArray(result._meta)
    ? result._meta as Record<string, unknown>
    : {};

  return {
    ...result,
    _meta: {
      ...currentMeta,
      quota: {
        ...quota,
        refunded,
      },
    },
  };
}

export function quotaExceededResult(error: QuotaExceededError): WechatToolResult {
  return {
    content: [{
      type: 'text',
      text: formatQuotaExceededMessage(error),
    }],
    isError: true,
    _meta: {
      error: {
        code: error.code,
        details: error.details,
      },
      quota: {
        plan: error.details.plan,
        exceeded: {
          metric: error.details.metric,
          label: error.details.label,
          used: error.details.used,
          limit: error.details.limit,
          requested: error.details.requested,
          remaining: error.details.remaining,
          period: error.details.period,
          resetAt: error.details.resetAt,
        },
      },
    },
  };
}
