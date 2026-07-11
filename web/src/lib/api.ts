import { z } from 'zod';

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

const successEnvelopeBase = z.object({
  success: z.literal(true),
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});

const failureEnvelope = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
  requestId: z.string().optional(),
});

const quotaSummaryDataSchema = z.object({
  tenantId: z.string().optional(),
  plan: z.enum(['free', 'plus', 'pro']).catch('free'),
  counters: z.array(z.object({
    kind: z.string(),
    limit: z.number(),
    used: z.number(),
    remaining: z.number(),
    resetAt: z.number().optional(),
  })).default([]),
  upgradePrompt: z.string().optional(),
}).passthrough();

export const quotaSummarySchema = z.preprocess(normalizeQuotaSummary, quotaSummaryDataSchema);

const currentOperatorDataSchema = z.object({
  operator: z.object({
    operatorId: z.string().optional(),
    email: z.string().email().optional(),
    displayName: z.string().optional(),
  }).optional(),
  userId: z.string().optional(),
  tenants: z.array(z.unknown()).default([]),
  accounts: z.array(z.unknown()).default([]),
  defaultTenantId: z.string().optional(),
  defaultAccountId: z.string().optional(),
  scopes: z.array(z.string()).default([]),
}).passthrough();

export const currentOperatorSchema = z.preprocess(normalizeCurrentOperator, currentOperatorDataSchema);

export const onboardingStatusSchema = z.object({
  tenantId: z.string().optional(),
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  appId: z.string().optional(),
  configured: z.boolean().default(false),
  relayRequired: z.boolean().default(true),
  webhookConfigured: z.boolean().default(false),
  completionState: z.enum(['unconfigured', 'credential_pending', 'complete']).default('unconfigured'),
}).passthrough();

export const accountSchema = z.object({
  accountId: z.string(),
  tenantId: z.string(),
  slug: z.string().optional(),
  name: z.string().optional(),
  accountName: z.string().optional(),
  appId: z.string().optional(),
  status: z.string().optional(),
  isDefault: z.boolean().optional(),
  hasAppSecret: z.boolean().optional(),
  hasWebhookToken: z.boolean().optional(),
  hasEncodingAESKey: z.boolean().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
}).passthrough();

const accountListSchema = z.object({
  accounts: z.array(accountSchema).default([]),
});

const accountMutationSchema = z.object({
  account: accountSchema,
});

const accountDeleteSchema = z.object({
  accountId: z.string(),
  deleted: z.boolean(),
  secretsPurged: z.boolean(),
});

const accountStatusSchema = z.object({
  account: accountSchema.nullish(),
  configured: z.boolean().default(false),
  config: z.object({
    appId: z.string().optional(),
    hasAppSecret: z.boolean().optional(),
    hasToken: z.boolean().optional(),
    hasEncodingAESKey: z.boolean().optional(),
  }).nullish(),
}).passthrough();

export const billingStatusSchema = z.object({
  plan: z.enum(['free', 'plus', 'pro']).catch('free'),
  status: z.string().optional(),
  currentPeriodEnd: z.number().optional(),
}).passthrough();

export const checkoutSessionSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  plan: z.enum(['plus', 'pro']),
  tenantId: z.string(),
}).passthrough();

export const mcpConfigStatusSchema = z.object({
  endpoint: z.string().url(),
  client: z.enum(['codex', 'claude']).optional(),
  includesToken: z.literal(false).default(false),
}).passthrough();

export const securitySessionSchema = z.object({
  id: z.string(),
  kind: z.enum(['web', 'oauth']).optional(),
  clientName: z.string().optional(),
  clientId: z.string().optional(),
  createdAt: z.union([z.string(), z.number()]).optional(),
  lastSeenAt: z.union([z.string(), z.number()]).optional(),
  expiresAt: z.union([z.string(), z.number()]).optional(),
  revokedAt: z.union([z.string(), z.number()]).nullish(),
  canRevoke: z.boolean().default(true),
}).passthrough();

const securitySessionsSchema = z.object({
  sessions: z.array(securitySessionSchema).default([]),
});

export class WebApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WebApiError';
  }
}

export async function getCurrentOperator(): Promise<z.infer<typeof currentOperatorSchema>> {
  return await apiGet('/api/v1/me', currentOperatorSchema);
}

export async function getAccounts(tenantId: string): Promise<z.infer<typeof accountListSchema>> {
  return await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts`, accountListSchema);
}

export async function getAccountStatus(tenantId: string, accountId: string): Promise<z.infer<typeof accountStatusSchema>> {
  return await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/status`, accountStatusSchema);
}

export async function createAccount(input: {
  tenantId: string;
  name: string;
}): Promise<z.infer<typeof accountSchema>> {
  const { account } = await apiPost(
    `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts`,
    { name: input.name },
    accountMutationSchema,
  );
  return account;
}

export async function updateAccount(input: {
  tenantId: string;
  accountId: string;
  name?: string;
  isDefault?: boolean;
}): Promise<z.infer<typeof accountSchema>> {
  const { account } = await apiPatch(
    `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}`,
    {
      name: input.name,
      isDefault: input.isDefault,
    },
    accountMutationSchema,
  );
  return account;
}

export async function deleteAccount(input: {
  tenantId: string;
  accountId: string;
}): Promise<z.infer<typeof accountDeleteSchema>> {
  return await apiPost(
    `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}/disable`,
    { confirmation: `DELETE ${input.accountId}` },
    accountDeleteSchema,
  );
}

export async function configureAccount(input: {
  tenantId: string;
  accountId: string;
  appId: string;
  appSecret: string;
  token?: string;
  encodingAESKey?: string;
}): Promise<z.infer<typeof accountSchema>> {
  return await apiPost(
    `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/accounts/${encodeURIComponent(input.accountId)}/configure`,
    {
      appId: input.appId,
      appSecret: input.appSecret,
      token: input.token || undefined,
      encodingAESKey: input.encodingAESKey || undefined,
    },
    accountSchema,
  );
}

export async function getOnboardingStatus(
  current: z.infer<typeof currentOperatorSchema>,
): Promise<z.infer<typeof onboardingStatusSchema>> {
  const tenantId = current.defaultTenantId ?? tenantIdFromUnknown(current.tenants[0]);
  if (!tenantId) {
    return onboardingStatusSchema.parse({ configured: false, relayRequired: true, completionState: 'unconfigured' });
  }

  const { accounts } = await getAccounts(tenantId);
  const defaultAccountId = current.defaultAccountId;
  const account = accounts.find(item => item.accountId === defaultAccountId) ?? accounts.find(item => item.isDefault) ?? accounts[0];
  if (!account) {
    return onboardingStatusSchema.parse({ tenantId, configured: false, relayRequired: true, completionState: 'unconfigured' });
  }

  const status = await getAccountStatus(tenantId, account.accountId);
  const appId = status.config?.appId ?? account.appId;
  const configured = status.configured || account.status === 'active';
  return onboardingStatusSchema.parse({
    tenantId,
    resourceId: account.accountId,
    resourceName: account.name ?? account.accountName,
    appId,
    configured,
    relayRequired: true,
    webhookConfigured: Boolean(account.hasWebhookToken || status.config?.hasToken),
    completionState: configured ? 'complete' : appId ? 'credential_pending' : 'unconfigured',
  });
}

export async function getQuotaSummary(tenantId: string): Promise<z.infer<typeof quotaSummarySchema>> {
  return await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/usage`, quotaSummarySchema);
}

export async function getBillingStatus(tenantId: string): Promise<z.infer<typeof billingStatusSchema>> {
  const quota = await getQuotaSummary(tenantId);
  return billingStatusSchema.parse({
    plan: quota.plan,
    status: quota.plan === 'free' ? 'active_free' : 'active_paid',
    currentPeriodEnd: quota.counters.find(counter => counter.resetAt)?.resetAt,
  });
}

export async function createCheckoutSession(input: {
  tenantId: string;
  plan: 'plus' | 'pro';
  successUrl: string;
  cancelUrl: string;
}): Promise<z.infer<typeof checkoutSessionSchema>> {
  return await apiPost(
    `/api/v1/tenants/${encodeURIComponent(input.tenantId)}/billing/checkout`,
    { plan: input.plan, successUrl: input.successUrl, cancelUrl: input.cancelUrl },
    checkoutSessionSchema,
  );
}

export async function revokeSecuritySession(sessionId: string): Promise<unknown> {
  return await apiRequest(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    schema: z.unknown(),
  });
}

export async function getSecuritySessions(): Promise<z.infer<typeof securitySessionsSchema>> {
  return await apiGet('/api/v1/sessions', securitySessionsSchema);
}

export async function logout(): Promise<void> {
  await apiPost('/api/v1/auth/logout', {}, z.unknown());
}

async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  return await apiRequest(path, { method: 'GET', schema });
}

async function apiPost<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.infer<T>> {
  return await apiRequest(path, { method: 'POST', body, schema });
}

async function apiPatch<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.infer<T>> {
  return await apiRequest(path, { method: 'PATCH', body, schema });
}

async function apiRequest<T extends z.ZodType>(path: string, options: {
  method: string;
  body?: unknown;
  schema: T;
}): Promise<z.infer<T>> {
  const response = await fetch(path, {
    method: options.method,
    credentials: 'include',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const raw = text ? parseJson(text) : null;
  const envelopeKind = z.object({ success: z.boolean() }).passthrough().safeParse(raw);

  if (!envelopeKind.success) {
    throw new WebApiError(`Unexpected API response for ${options.method} ${path}.`, response.status, 'invalid_response', envelopeKind.error.flatten());
  }

  if (!envelopeKind.data.success) {
    const parsedFailure = failureEnvelope.safeParse(raw);
    if (!parsedFailure.success) {
      throw new WebApiError(`Unexpected API response for ${options.method} ${path}.`, response.status, 'invalid_response', parsedFailure.error.flatten());
    }
    throw new WebApiError(parsedFailure.data.error.message, response.status, parsedFailure.data.error.code, parsedFailure.data.error.details);
  }

  const parsedSuccess = successEnvelopeBase.safeParse(raw);
  if (!parsedSuccess.success) {
    throw new WebApiError(`Unexpected API response for ${options.method} ${path}.`, response.status, 'invalid_response', parsedSuccess.error.flatten());
  }
  const parsedData = options.schema.safeParse(parsedSuccess.data.data);
  if (!parsedData.success) {
    throw new WebApiError(`Unexpected API response data for ${options.method} ${path}.`, response.status, 'invalid_response', parsedData.error.flatten());
  }
  if (!response.ok) {
    throw new WebApiError(`Remote API ${options.method} ${path} failed with HTTP ${response.status}.`, response.status);
  }

  return parsedData.data;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function tenantIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tenantId = (value as { tenantId?: unknown }).tenantId;
  return typeof tenantId === 'string' ? tenantId : undefined;
}

function normalizeCurrentOperator(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.user)) return value;

  const userId = stringFromUnknown(value.user.userId) ?? stringFromUnknown(value.userId);
  const email = stringFromUnknown(value.user.email);
  const displayName = stringFromUnknown(value.user.displayName);
  const existingOperator = isRecord(value.operator) ? value.operator : null;

  return {
    ...value,
    userId,
    operator: existingOperator ?? {
      operatorId: userId,
      email,
      displayName,
    },
  };
}

function normalizeQuotaSummary(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.entitlement) || !Array.isArray(value.metrics)) {
    return value;
  }

  const upgradePrompt = isRecord(value.upgradePrompt)
    ? stringFromUnknown(value.upgradePrompt.message)
    : stringFromUnknown(value.upgradePrompt);

  return {
    ...value,
    tenantId: stringFromUnknown(value.tenantId) ?? stringFromUnknown(value.entitlement.tenantId),
    plan: value.entitlement.plan,
    counters: value.metrics.map(metric => {
      if (!isRecord(metric)) return metric;
      return {
        kind: metric.metric,
        limit: metric.limit,
        used: metric.used,
        remaining: metric.remaining,
        resetAt: metric.resetAt,
      };
    }),
    upgradePrompt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
