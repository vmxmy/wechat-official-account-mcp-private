import { z } from 'zod';

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

const successEnvelope = <T extends z.ZodType>(data: T) => z.object({
  success: z.literal(true),
  data,
  meta: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});

const failureEnvelope = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
  requestId: z.string().optional(),
});

export const quotaSummarySchema = z.object({
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

export const currentOperatorSchema = z.object({
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

export const onboardingStatusSchema = z.object({
  tenantId: z.string().optional(),
  resourceId: z.string().optional(),
  configured: z.boolean().default(false),
  relayRequired: z.boolean().default(true),
  webhookConfigured: z.boolean().default(false),
  completionState: z.enum(['unconfigured', 'credential_pending', 'complete']).default('unconfigured'),
}).passthrough();

export const accountSchema = z.object({
  accountId: z.string(),
  tenantId: z.string(),
  accountName: z.string().optional(),
  appId: z.string().optional(),
  status: z.string().optional(),
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
  clientName: z.string().optional(),
  createdAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
  expiresAt: z.string().optional(),
  canRevoke: z.boolean().default(true),
}).passthrough();

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

export async function getQuotaSummary(tenantId: string): Promise<z.infer<typeof quotaSummarySchema>> {
  return await apiGet(`/api/v1/tenants/${encodeURIComponent(tenantId)}/usage`, quotaSummarySchema);
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

async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  return await apiRequest(path, { method: 'GET', schema });
}

async function apiPost<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.infer<T>> {
  return await apiRequest(path, { method: 'POST', body, schema });
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
  const envelopeSchema = z.union([successEnvelope(options.schema), failureEnvelope]);
  const parsed = envelopeSchema.safeParse(raw);

  if (!parsed.success) {
    throw new WebApiError(`Unexpected API response for ${options.method} ${path}.`, response.status, 'invalid_response', parsed.error.flatten());
  }

  if (parsed.data.success === false) {
    throw new WebApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.details);
  }

  if (!response.ok) {
    throw new WebApiError(`Remote API ${options.method} ${path} failed with HTTP ${response.status}.`, response.status);
  }

  return parsed.data.data as z.infer<T>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
