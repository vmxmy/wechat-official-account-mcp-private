import type { D1DatabaseLike, D1Value } from '../storage/d1-storage-manager.js';
import {
  DEFAULT_SUBSCRIPTION_PLAN,
  QUOTA_METRIC_LABELS,
  QUOTA_METRIC_WINDOWS,
  getPlanQuotaPolicy,
  createQuotaConsumptions,
  mergePlanLimits,
  quotaPeriod,
  quotaResetAt,
  normalizeSubscriptionPlan,
  type QuotaConsumption,
  type QuotaMetric,
  type QuotaWindow,
  type SubscriptionPlan,
} from './quota-policy.js';

export interface TenantEntitlement {
  tenantId: string;
  plan: SubscriptionPlan;
  status: 'active' | 'past_due' | 'cancelled' | 'disabled' | string;
  limitOverrides: Record<string, unknown> | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
}

export interface UsageCounterSnapshot {
  tenantId: string;
  metric: QuotaMetric;
  period: string;
  used: number;
  limit: number;
  resetAt: number;
  label: string;
}

export interface ReservedUsageCounter extends UsageCounterSnapshot {
  amount: number;
}

export interface QuotaReservationContext {
  tenantId: string;
  accountId?: string | null;
  userId?: string | null;
  oauthClientId?: string | null;
  requestId?: string | null;
  toolName: string;
  action?: string | null;
  params?: unknown;
  now?: number;
}

export interface McpQuotaReservation {
  tenantId: string;
  accountId?: string | null;
  plan: SubscriptionPlan;
  toolName: string;
  action?: string | null;
  counters: ReservedUsageCounter[];
  metadata(): QuotaMetadata;
  commit(): Promise<void>;
  refund(reason?: string): Promise<void>;
}

export interface QuotaMetadata {
  plan: SubscriptionPlan;
  checks: Array<{
    metric: QuotaMetric;
    label: string;
    used: number;
    limit: number;
    remaining: number;
    amount: number;
    period: string;
    resetAt: number;
  }>;
}

export interface QuotaExceededDetails {
  code: 'quota_exceeded';
  tenantId: string;
  accountId?: string | null;
  plan: SubscriptionPlan;
  metric: QuotaMetric;
  label: string;
  used: number;
  limit: number;
  requested: number;
  remaining: number;
  period: string;
  resetAt: number;
}

export interface UsageMetricSummary {
  metric: QuotaMetric;
  label: string;
  window: QuotaWindow;
  period: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
  percentUsed: number;
  status: 'ok' | 'approaching' | 'exhausted';
}

export interface UsageUpgradePrompt {
  recommended: boolean;
  suggestedPlan?: SubscriptionPlan;
  reasonCode?: 'quota_approaching' | 'quota_exhausted';
  message?: string;
  metrics: Array<Pick<UsageMetricSummary, 'metric' | 'label' | 'used' | 'limit' | 'remaining' | 'percentUsed' | 'resetAt'>>;
}

export interface TenantUsageSummary {
  tenantId: string;
  generatedAt: number;
  entitlement: {
    tenantId: string;
    plan: SubscriptionPlan;
    displayName: string;
    status: string;
    currentPeriodStart?: number | null;
    currentPeriodEnd?: number | null;
    hasStripeCustomer: boolean;
    hasStripeSubscription: boolean;
  };
  metrics: UsageMetricSummary[];
  upgradePrompt: UsageUpgradePrompt;
}

export class QuotaExceededError extends Error {
  readonly code = 'quota_exceeded';

  constructor(public readonly details: QuotaExceededDetails) {
    super(
      `Quota exceeded for ${details.label}: used ${details.used}/${details.limit}, requested ${details.requested}.`,
    );
    this.name = 'QuotaExceededError';
  }
}

export const USAGE_QUOTAS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start INTEGER,
  current_period_end INTEGER,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  limit_value INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period, metric)
);
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT,
  user_id TEXT,
  oauth_client_id TEXT,
  request_id TEXT,
  tool_name TEXT NOT NULL,
  action TEXT,
  plan TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_plan ON tenant_entitlements(plan, status);
CREATE INDEX IF NOT EXISTS idx_usage_counters_metric_period ON usage_counters(metric, period);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_time ON usage_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_tool_time ON usage_events(tool_name, created_at);
`;

export class D1UsageQuotaStore {
  private schemaReady = false;

  constructor(private readonly db: D1DatabaseLike) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    for (const statement of USAGE_QUOTAS_SCHEMA_SQL.split(';').map(part => part.trim()).filter(Boolean)) {
      await this.db.prepare(statement).run();
    }
    this.schemaReady = true;
  }

  async getEntitlement(tenantId: string): Promise<TenantEntitlement> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT plan, status, limits_json, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end
       FROM tenant_entitlements
       WHERE tenant_id = ?
       LIMIT 1`,
    ).bind(tenantId).first<Record<string, unknown>>();

    if (!row) {
      return {
        tenantId,
        plan: DEFAULT_SUBSCRIPTION_PLAN,
        status: 'active',
        limitOverrides: null,
      };
    }

    return {
      tenantId,
      plan: normalizeSubscriptionPlan(row.plan),
      status: stringValue(row.status) || 'active',
      limitOverrides: parseJsonObject(row.limits_json),
      stripeCustomerId: stringValue(row.stripe_customer_id),
      stripeSubscriptionId: stringValue(row.stripe_subscription_id),
      currentPeriodStart: numberValue(row.current_period_start),
      currentPeriodEnd: numberValue(row.current_period_end),
    };
  }

  async upsertEntitlement(input: {
    tenantId: string;
    plan: SubscriptionPlan;
    status?: string;
    limitOverrides?: Record<string, unknown> | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodStart?: number | null;
    currentPeriodEnd?: number | null;
    now?: number;
  }): Promise<void> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `INSERT INTO tenant_entitlements (
         tenant_id,
         plan,
         status,
         stripe_customer_id,
         stripe_subscription_id,
         current_period_start,
         current_period_end,
         limits_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         plan = excluded.plan,
         status = excluded.status,
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         limits_json = excluded.limits_json,
         updated_at = excluded.updated_at`,
    ).bind(
      input.tenantId,
      input.plan,
      input.status ?? 'active',
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      JSON.stringify(input.limitOverrides ?? {}),
      now,
      now,
    ).run();
  }

  async getCounter(tenantId: string, metric: QuotaMetric, period: string): Promise<UsageCounterSnapshot | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT used, limit_value, reset_at
       FROM usage_counters
       WHERE tenant_id = ? AND period = ? AND metric = ?
       LIMIT 1`,
    ).bind(tenantId, period, metric).first<Record<string, unknown>>();

    if (!row) return null;

    return {
      tenantId,
      metric,
      period,
      used: numberValue(row.used) ?? 0,
      limit: numberValue(row.limit_value) ?? 0,
      resetAt: numberValue(row.reset_at) ?? 0,
      label: '',
    };
  }

  async getUsageSummary(tenantId: string, now: number = Date.now()): Promise<TenantUsageSummary> {
    await this.ensureSchema();
    const entitlement = await this.getEntitlement(tenantId);
    const policy = getPlanQuotaPolicy(entitlement.plan);
    const limits = mergePlanLimits(entitlement.plan, entitlement.limitOverrides);
    const metrics: UsageMetricSummary[] = [];

    for (const metric of Object.keys(limits) as QuotaMetric[]) {
      const window = QUOTA_METRIC_WINDOWS[metric];
      const period = quotaPeriod(window, now);
      const resetAt = quotaResetAt(window, now);
      const counter = await this.getCounter(tenantId, metric, period);
      const used = counter?.used ?? 0;
      const limit = limits[metric];
      const remaining = Math.max(0, limit - used);
      const percentUsed = calculatePercentUsed(used, limit);
      metrics.push({
        metric,
        label: QUOTA_METRIC_LABELS[metric],
        window,
        period,
        used,
        limit,
        remaining,
        resetAt: counter?.resetAt || resetAt,
        percentUsed,
        status: metricUsageStatus(used, limit, percentUsed),
      });
    }

    return {
      tenantId,
      generatedAt: now,
      entitlement: {
        tenantId,
        plan: entitlement.plan,
        displayName: policy.displayName,
        status: entitlement.status,
        currentPeriodStart: entitlement.currentPeriodStart,
        currentPeriodEnd: entitlement.currentPeriodEnd,
        hasStripeCustomer: !!entitlement.stripeCustomerId,
        hasStripeSubscription: !!entitlement.stripeSubscriptionId,
      },
      metrics,
      upgradePrompt: createUsageUpgradePrompt(entitlement.plan, metrics),
    };
  }

  async reserveCounters(
    tenantId: string,
    consumptions: QuotaConsumption[],
    now: number = Date.now(),
  ): Promise<ReservedUsageCounter[]> {
    await this.ensureSchema();
    const reserved: ReservedUsageCounter[] = [];

    try {
      for (const consumption of consumptions) {
        const counter = await this.reserveCounter(tenantId, consumption, now);
        reserved.push(counter);
      }
      return reserved;
    } catch (error) {
      await this.refundCounters(tenantId, reserved, 'reserve_rollback');
      throw error;
    }
  }

  async refundCounters(
    tenantId: string,
    counters: Array<{ metric: QuotaMetric; period: string; amount: number }>,
    reason?: string,
  ): Promise<void> {
    await this.ensureSchema();
    void reason;
    const now = Date.now();
    for (const counter of counters) {
      await this.db.prepare(
        `UPDATE usage_counters
         SET used = MAX(0, used - ?), updated_at = ?
         WHERE tenant_id = ? AND period = ? AND metric = ?`,
      ).bind(counter.amount, now, tenantId, counter.period, counter.metric).run();
    }
  }

  async recordUsageEvent(input: {
    tenantId: string;
    accountId?: string | null;
    userId?: string | null;
    oauthClientId?: string | null;
    requestId?: string | null;
    toolName: string;
    action?: string | null;
    plan: SubscriptionPlan;
    counters: ReservedUsageCounter[];
    outcome: 'success' | 'refunded';
    now?: number;
  }): Promise<void> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `INSERT INTO usage_events (
         id,
         tenant_id,
         account_id,
         user_id,
         oauth_client_id,
         request_id,
         tool_name,
         action,
         plan,
         metrics_json,
         outcome,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId('evt'),
      input.tenantId,
      input.accountId ?? null,
      input.userId ?? null,
      input.oauthClientId ?? null,
      input.requestId ?? null,
      input.toolName,
      input.action ?? null,
      input.plan,
      JSON.stringify(input.counters.map(counter => ({
        metric: counter.metric,
        amount: counter.amount,
        used: counter.used,
        limit: counter.limit,
        period: counter.period,
        resetAt: counter.resetAt,
      }))),
      input.outcome,
      now,
    ).run();
  }

  private async reserveCounter(
    tenantId: string,
    consumption: QuotaConsumption,
    now: number,
  ): Promise<ReservedUsageCounter> {
    if (consumption.amount > consumption.limit) {
      throw new QuotaExceededError({
        code: 'quota_exceeded',
        tenantId,
        plan: DEFAULT_SUBSCRIPTION_PLAN,
        metric: consumption.metric,
        label: consumption.label,
        used: 0,
        limit: consumption.limit,
        requested: consumption.amount,
        remaining: consumption.limit,
        period: consumption.period,
        resetAt: consumption.resetAt,
      });
    }

    const before = await this.getCounter(tenantId, consumption.metric, consumption.period);
    const usedBefore = before?.used ?? 0;
    const remaining = Math.max(0, consumption.limit - usedBefore);
    if (usedBefore + consumption.amount > consumption.limit) {
      throw new QuotaExceededError({
        code: 'quota_exceeded',
        tenantId,
        plan: DEFAULT_SUBSCRIPTION_PLAN,
        metric: consumption.metric,
        label: consumption.label,
        used: usedBefore,
        limit: consumption.limit,
        requested: consumption.amount,
        remaining,
        period: consumption.period,
        resetAt: consumption.resetAt,
      });
    }

    const reserveResult = await this.db.prepare(
      `INSERT INTO usage_counters (
         tenant_id,
         period,
         metric,
         used,
         limit_value,
         reset_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, period, metric) DO UPDATE SET
         used = usage_counters.used + excluded.used,
         limit_value = excluded.limit_value,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at
       WHERE usage_counters.used + excluded.used <= excluded.limit_value`,
    ).bind(
      tenantId,
      consumption.period,
      consumption.metric,
      consumption.amount,
      consumption.limit,
      consumption.resetAt,
      now,
      now,
    ).run();

    if ((reserveResult.meta?.changes ?? 1) === 0) {
      const current = await this.getCounter(tenantId, consumption.metric, consumption.period);
      const used = current?.used ?? usedBefore;
      throw new QuotaExceededError({
        code: 'quota_exceeded',
        tenantId,
        plan: DEFAULT_SUBSCRIPTION_PLAN,
        metric: consumption.metric,
        label: consumption.label,
        used,
        limit: consumption.limit,
        requested: consumption.amount,
        remaining: Math.max(0, consumption.limit - used),
        period: consumption.period,
        resetAt: consumption.resetAt,
      });
    }

    const after = await this.getCounter(tenantId, consumption.metric, consumption.period);
    const usedAfter = after?.used ?? usedBefore;
    if (usedAfter < usedBefore + consumption.amount) {
      throw new QuotaExceededError({
        code: 'quota_exceeded',
        tenantId,
        plan: DEFAULT_SUBSCRIPTION_PLAN,
        metric: consumption.metric,
        label: consumption.label,
        used: usedAfter,
        limit: consumption.limit,
        requested: consumption.amount,
        remaining: Math.max(0, consumption.limit - usedAfter),
        period: consumption.period,
        resetAt: consumption.resetAt,
      });
    }

    return {
      tenantId,
      metric: consumption.metric,
      period: consumption.period,
      amount: consumption.amount,
      used: usedAfter,
      limit: consumption.limit,
      resetAt: consumption.resetAt,
      label: consumption.label,
    };
  }
}

export async function reserveMcpToolQuota(options: {
  store: D1UsageQuotaStore;
  tenantId: string;
  accountId?: string | null;
  userId?: string | null;
  oauthClientId?: string | null;
  requestId?: string | null;
  toolName: string;
  action?: string | null;
  params?: unknown;
  now?: number;
}): Promise<McpQuotaReservation> {
  const now = options.now ?? Date.now();
  const entitlement = await options.store.getEntitlement(options.tenantId);
  const consumptions = createQuotaConsumptions({
    toolName: options.toolName,
    params: options.params,
    plan: entitlement.plan,
    limitOverrides: entitlement.limitOverrides,
    now,
  });
  let counters: ReservedUsageCounter[];
  try {
    counters = await options.store.reserveCounters(options.tenantId, consumptions, now);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      throw new QuotaExceededError({
        ...error.details,
        tenantId: options.tenantId,
        accountId: options.accountId,
        plan: entitlement.plan,
      });
    }
    throw error;
  }

  for (const counter of counters) {
    // Fill the concrete plan into quota errors generated before the policy layer knew the plan.
    counter.tenantId = options.tenantId;
  }

  let finalized = false;

  return {
    tenantId: options.tenantId,
    accountId: options.accountId,
    plan: entitlement.plan,
    toolName: options.toolName,
    action: options.action,
    counters,
    metadata: () => quotaMetadata(entitlement.plan, counters),
    commit: async () => {
      if (finalized) return;
      finalized = true;
      await options.store.recordUsageEvent({
        tenantId: options.tenantId,
        accountId: options.accountId,
        userId: options.userId,
        oauthClientId: options.oauthClientId,
        requestId: options.requestId,
        toolName: options.toolName,
        action: options.action,
        plan: entitlement.plan,
        counters,
        outcome: 'success',
        now,
      });
    },
    refund: async reason => {
      if (finalized) return;
      finalized = true;
      await options.store.refundCounters(options.tenantId, counters, reason);
      await options.store.recordUsageEvent({
        tenantId: options.tenantId,
        accountId: options.accountId,
        userId: options.userId,
        oauthClientId: options.oauthClientId,
        requestId: options.requestId,
        toolName: options.toolName,
        action: options.action,
        plan: entitlement.plan,
        counters,
        outcome: 'refunded',
        now: Date.now(),
      });
    },
  };
}

export function quotaMetadata(plan: SubscriptionPlan, counters: ReservedUsageCounter[]): QuotaMetadata {
  return {
    plan,
    checks: counters.map(counter => ({
      metric: counter.metric,
      label: counter.label,
      used: counter.used,
      limit: counter.limit,
      remaining: Math.max(0, counter.limit - counter.used),
      amount: counter.amount,
      period: counter.period,
      resetAt: counter.resetAt,
    })),
  };
}

export function formatQuotaExceededMessage(error: QuotaExceededError): string {
  const details = error.details;
  const resetAt = new Date(details.resetAt).toISOString();
  return [
    '配额已用尽，操作未执行。',
    `计划: ${details.plan}`,
    `指标: ${details.label} (${details.metric})`,
    `当前用量: ${details.used}/${details.limit}`,
    `本次需要: ${details.requested}`,
    `重置时间: ${resetAt}`,
  ].join('\n');
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function calculatePercentUsed(used: number, limit: number): number {
  if (limit <= 0) {
    return used > 0 ? 100 : 0;
  }
  return Math.min(100, Math.round((used / limit) * 10_000) / 100);
}

function metricUsageStatus(
  used: number,
  limit: number,
  percentUsed: number,
): UsageMetricSummary['status'] {
  if (limit <= 0 || used >= limit) return 'exhausted';
  if (percentUsed >= 80) return 'approaching';
  return 'ok';
}

function createUsageUpgradePrompt(
  plan: SubscriptionPlan,
  metrics: UsageMetricSummary[],
): UsageUpgradePrompt {
  const suggestedPlan = plan === 'free' ? 'plus' : plan === 'plus' ? 'pro' : undefined;
  const exhausted = metrics.filter(metric => metric.status === 'exhausted');
  const approaching = metrics.filter(metric => metric.status === 'approaching');
  const highlighted = exhausted.length > 0 ? exhausted : approaching;

  if (!suggestedPlan || highlighted.length === 0) {
    return {
      recommended: false,
      metrics: [],
    };
  }

  const reasonCode = exhausted.length > 0 ? 'quota_exhausted' : 'quota_approaching';
  const labels = highlighted.slice(0, 3).map(metric => metric.label).join('、');
  return {
    recommended: true,
    suggestedPlan,
    reasonCode,
    message: reasonCode === 'quota_exhausted'
      ? `${labels} 已达到当前套餐上限，建议升级到 ${getPlanQuotaPolicy(suggestedPlan).displayName}。`
      : `${labels} 接近当前套餐上限，建议升级到 ${getPlanQuotaPolicy(suggestedPlan).displayName}。`,
    metrics: highlighted.map(metric => ({
      metric: metric.metric,
      label: metric.label,
      used: metric.used,
      limit: metric.limit,
      remaining: metric.remaining,
      percentUsed: metric.percentUsed,
      resetAt: metric.resetAt,
    })),
  };
}

function randomId(prefix: string): string {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.randomUUID) {
    return `${prefix}_${cryptoLike.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export type UsageQuotaD1Value = D1Value;
