export type SubscriptionPlan = 'free' | 'plus' | 'pro';
export type QuotaWindow = 'day' | 'month';

export type QuotaMetric =
  | 'tool_calls_day'
  | 'tool_calls_month'
  | 'published_articles_month'
  | 'media_uploads_month'
  | 'stats_queries_month'
  | 'message_sends_month'
  | 'qr_codes_month'
  | 'high_risk_ops_month';

export interface PlanQuotaPolicy {
  plan: SubscriptionPlan;
  displayName: string;
  limits: Record<QuotaMetric, number>;
}

export interface QuotaConsumption {
  metric: QuotaMetric;
  amount: number;
  window: QuotaWindow;
  period: string;
  resetAt: number;
  limit: number;
  label: string;
}

export interface QuotaPeriodContext {
  plan: SubscriptionPlan;
  periodAnchorAt?: number | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
}

export interface ToolQuotaSignal {
  metric: QuotaMetric;
  amount?: number;
}

export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlan = 'free';

/**
 * Product-plan quotas. These are SaaS limits, not WeChat official API limits.
 * Free deliberately exposes every tool and constrains usage with small quotas.
 */
export const PLAN_QUOTA_POLICIES: Record<SubscriptionPlan, PlanQuotaPolicy> = {
  free: {
    plan: 'free',
    displayName: 'Free',
    limits: {
      tool_calls_day: 50,
      tool_calls_month: 300,
      published_articles_month: 30,
      media_uploads_month: 30,
      stats_queries_month: 100,
      message_sends_month: 100,
      qr_codes_month: 30,
      high_risk_ops_month: 30,
    },
  },
  plus: {
    plan: 'plus',
    displayName: 'Plus',
    limits: {
      tool_calls_day: 500,
      tool_calls_month: 3_000,
      published_articles_month: 300,
      media_uploads_month: 500,
      stats_queries_month: 1_000,
      message_sends_month: 5_000,
      qr_codes_month: 500,
      high_risk_ops_month: 300,
    },
  },
  pro: {
    plan: 'pro',
    displayName: 'Pro',
    limits: {
      tool_calls_day: 5_000,
      tool_calls_month: 30_000,
      published_articles_month: 3_000,
      media_uploads_month: 5_000,
      stats_queries_month: 10_000,
      message_sends_month: 50_000,
      qr_codes_month: 5_000,
      high_risk_ops_month: 3_000,
    },
  },
};

export const QUOTA_METRIC_LABELS: Record<QuotaMetric, string> = {
  tool_calls_day: '每日 MCP 工具调用次数',
  tool_calls_month: '每月 MCP 工具调用次数',
  published_articles_month: '每月发布篇数',
  media_uploads_month: '每月素材上传次数',
  stats_queries_month: '每月数据统计查询次数',
  message_sends_month: '每月消息发送次数',
  qr_codes_month: '每月二维码创建次数',
  high_risk_ops_month: '每月高风险操作次数',
};

export const QUOTA_METRIC_WINDOWS: Record<QuotaMetric, QuotaWindow> = {
  tool_calls_day: 'day',
  tool_calls_month: 'month',
  published_articles_month: 'month',
  media_uploads_month: 'month',
  stats_queries_month: 'month',
  message_sends_month: 'month',
  qr_codes_month: 'month',
  high_risk_ops_month: 'month',
};

const HIGH_RISK_TOOL_ACTIONS: Record<string, Set<string>> = {
  wechat_account: new Set(['clear_quota']),
  wechat_auth: new Set(['configure', 'clear']),
  wechat_blacklist: new Set(['block', 'unblock']),
  wechat_comment: new Set(['open', 'close', 'mark_elect', 'unmark_elect', 'delete', 'reply', 'delete_reply']),
  wechat_draft: new Set(['delete']),
  wechat_kf_account: new Set(['add', 'update', 'delete']),
  wechat_mass_send: new Set(['send_by_tag', 'send_by_openid', 'delete']),
  wechat_menu: new Set(['create', 'delete', 'add_conditional', 'delete_conditional']),
  wechat_publish: new Set(['submit', 'delete']),
  wechat_tag: new Set(['delete', 'batch_tagging', 'batch_untagging']),
  wechat_template_msg: new Set(['set_industry', 'add_template', 'delete']),
  woa_account: new Set(['create', 'update', 'disable', 'configure']),
  woa_tenant: new Set(['update']),
};

const MESSAGE_SEND_ACTIONS: Record<string, Set<string>> = {
  wechat_customer_service: new Set([
    'send_text',
    'send_image',
    'send_voice',
    'send_video',
    'send_music',
    'send_news',
    'send_mpnews',
  ]),
  wechat_mass_send: new Set(['send_by_tag', 'send_by_openid', 'preview']),
  wechat_subscribe_msg: new Set(['send']),
  wechat_template_msg: new Set(['send']),
};

export function normalizeSubscriptionPlan(value: unknown): SubscriptionPlan {
  return value === 'plus' || value === 'pro' || value === 'free'
    ? value
    : DEFAULT_SUBSCRIPTION_PLAN;
}

export function getPlanQuotaPolicy(plan: unknown): PlanQuotaPolicy {
  return PLAN_QUOTA_POLICIES[normalizeSubscriptionPlan(plan)];
}

export function mergePlanLimits(
  plan: SubscriptionPlan,
  overrides?: Record<string, unknown> | null,
): Record<QuotaMetric, number> {
  const limits = { ...PLAN_QUOTA_POLICIES[plan].limits };
  if (!overrides) return limits;

  for (const metric of Object.keys(limits) as QuotaMetric[]) {
    const override = overrides[metric];
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
      limits[metric] = Math.floor(override);
    }
  }
  return limits;
}

export function createQuotaConsumptions(options: {
  toolName: string;
  params: unknown;
  plan: SubscriptionPlan;
  limitOverrides?: Record<string, unknown> | null;
  periodContext?: QuotaPeriodContext | null;
  now?: number;
}): QuotaConsumption[] {
  const now = options.now ?? Date.now();
  const limits = mergePlanLimits(options.plan, options.limitOverrides);
  const signals = resolveToolQuotaSignals(options.toolName, options.params);
  const merged = new Map<QuotaMetric, number>();

  for (const signal of signals) {
    const current = merged.get(signal.metric) ?? 0;
    merged.set(signal.metric, current + Math.max(1, Math.floor(signal.amount ?? 1)));
  }

  return [...merged.entries()].map(([metric, amount]) => {
    const window = QUOTA_METRIC_WINDOWS[metric];
    const resolvedPeriod = quotaPeriodForContext(window, now, options.periodContext);
    return {
      metric,
      amount,
      window,
      period: resolvedPeriod.period,
      resetAt: resolvedPeriod.resetAt,
      limit: limits[metric],
      label: QUOTA_METRIC_LABELS[metric],
    };
  });
}

export function resolveToolQuotaSignals(toolName: string, params: unknown): ToolQuotaSignal[] {
  const action = getAction(params);
  const signals: ToolQuotaSignal[] = [
    { metric: 'tool_calls_day' },
    { metric: 'tool_calls_month' },
  ];

  if (isSuccessfulPublishAttempt(toolName, action)) {
    signals.push({ metric: 'published_articles_month', amount: publishArticleAmount(params) });
  }

  if (isMediaUpload(toolName, action)) {
    signals.push({ metric: 'media_uploads_month' });
  }

  if (toolName === 'wechat_statistics') {
    signals.push({ metric: 'stats_queries_month' });
  }

  if (MESSAGE_SEND_ACTIONS[toolName]?.has(action)) {
    signals.push({ metric: 'message_sends_month', amount: messageSendAmount(toolName, action, params) });
  }

  if (toolName === 'wechat_qrcode' && (action === 'create_temp' || action === 'create_permanent')) {
    signals.push({ metric: 'qr_codes_month' });
  }

  if (HIGH_RISK_TOOL_ACTIONS[toolName]?.has(action)) {
    signals.push({ metric: 'high_risk_ops_month' });
  }

  return signals;
}

export function isSuccessfulPublishAttempt(toolName: string, action: string): boolean {
  return (toolName === 'wechat_publish' && action === 'submit')
    || (toolName === 'wechat_content_publish'
      && (action === 'publish_draft' || action === 'create_and_publish'));
}

export function quotaPeriod(window: QuotaWindow, now: number = Date.now()): string {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return window === 'day' ? `${year}-${month}-${day}` : `${year}-${month}`;
}

export function quotaResetAt(window: QuotaWindow, now: number = Date.now()): number {
  const date = new Date(now);
  if (window === 'day') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0);
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

export function quotaPeriodForContext(
  window: QuotaWindow,
  now: number = Date.now(),
  context?: QuotaPeriodContext | null,
): { period: string; resetAt: number } {
  if (window === 'day' || !context) {
    return { period: quotaPeriod(window, now), resetAt: quotaResetAt(window, now) };
  }

  const paidStart = finiteTimestamp(context.currentPeriodStart);
  const paidEnd = finiteTimestamp(context.currentPeriodEnd);
  if (context.plan !== 'free' && paidStart !== null && paidEnd !== null && paidEnd > paidStart && now < paidEnd) {
    return {
      period: `billing:${paidStart}:${paidEnd}`,
      resetAt: paidEnd,
    };
  }

  const anchor = context.plan === 'free'
    ? finiteTimestamp(context.periodAnchorAt)
    : paidStart;
  if (anchor === null) {
    return { period: quotaPeriod(window, now), resetAt: quotaResetAt(window, now) };
  }
  const range = anniversaryMonthRange(anchor, now);
  return {
    period: `${context.plan === 'free' ? 'anniversary' : 'billing'}:${range.start}`,
    resetAt: range.end,
  };
}

function anniversaryMonthRange(anchor: number, now: number): { start: number; end: number } {
  if (now < anchor) {
    return { start: anchor, end: addUtcMonthsClamped(anchor, 1) };
  }
  const anchorDate = new Date(anchor);
  const nowDate = new Date(now);
  let months = (nowDate.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12
    + nowDate.getUTCMonth() - anchorDate.getUTCMonth();
  let start = addUtcMonthsClamped(anchor, months);
  if (start > now) {
    months -= 1;
    start = addUtcMonthsClamped(anchor, months);
  }
  return { start, end: addUtcMonthsClamped(anchor, months + 1) };
}

function addUtcMonthsClamped(timestamp: number, months: number): number {
  const source = new Date(timestamp);
  const targetMonthStart = new Date(Date.UTC(
    source.getUTCFullYear(),
    source.getUTCMonth() + months,
    1,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  ));
  const lastDay = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return targetMonthStart.getTime();
}

function finiteTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getAction(params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return '';
  }
  const action = (params as Record<string, unknown>).action;
  return typeof action === 'string' ? action : '';
}

function isMediaUpload(toolName: string, action: string): boolean {
  if (toolName === 'wechat_upload_img') return true;
  if (toolName === 'wechat_media_upload') return action === 'upload';
  if (toolName === 'wechat_permanent_media') return action === 'add';
  return false;
}

function publishArticleAmount(params: unknown): number {
  const record = isRecord(params) ? params : {};
  const explicitArticleCount = record.articleCount ?? record.article_count;
  if (typeof explicitArticleCount === 'number' && Number.isFinite(explicitArticleCount) && explicitArticleCount > 0) {
    return Math.floor(explicitArticleCount);
  }
  if (Array.isArray(record.articles) && record.articles.length > 0) {
    return record.articles.length;
  }
  // freepublish/submit receives a media_id only; count one publish unit unless a caller passes a known count.
  return 1;
}

function messageSendAmount(toolName: string, action: string, params: unknown): number {
  if (toolName === 'wechat_mass_send' && action === 'send_by_openid' && isRecord(params) && Array.isArray(params.toUser)) {
    return Math.max(1, params.toUser.length);
  }
  return 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
