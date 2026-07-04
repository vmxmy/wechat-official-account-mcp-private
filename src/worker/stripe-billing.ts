import { D1UsageQuotaStore } from './usage-store.js';
import {
  normalizeSubscriptionPlan,
  type SubscriptionPlan,
} from './quota-policy.js';

export interface StripePriceIds {
  plus?: string | null;
  pro?: string | null;
}

export interface StripeCheckoutServiceOptions {
  secretKey: string;
  priceIds: StripePriceIds;
  usageStore: D1UsageQuotaStore;
  defaultSuccessUrl?: string | null;
  defaultCancelUrl?: string | null;
  fetch?: typeof fetch;
}

export interface CreateStripeCheckoutSessionInput {
  tenantId: string;
  plan: Exclude<SubscriptionPlan, 'free'>;
  successUrl?: string | null;
  cancelUrl?: string | null;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  plan: Exclude<SubscriptionPlan, 'free'>;
  tenantId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export interface StripeBillingService {
  createCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult>;
}

export interface StripeWebhookOptions {
  webhookSecret: string | null;
  usageStore: D1UsageQuotaStore;
  priceIds?: StripePriceIds;
  now?: number;
}

interface StripeEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: Record<string, unknown>;
  };
}

const STRIPE_CHECKOUT_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export function createStripeCheckoutService(options: StripeCheckoutServiceOptions): StripeBillingService {
  return {
    async createCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult> {
      const priceId = priceIdForPlan(input.plan, options.priceIds);
      if (!priceId) {
        throw new StripeBillingError('stripe_price_unconfigured', `Stripe price ID is not configured for plan: ${input.plan}.`, 503);
      }

      const successUrl = resolveCheckoutRedirectUrl(input.successUrl, options.defaultSuccessUrl, 'successUrl');
      const cancelUrl = resolveCheckoutRedirectUrl(input.cancelUrl, options.defaultCancelUrl, 'cancelUrl');
      if (!successUrl || !cancelUrl) {
        throw new StripeBillingError('stripe_checkout_url_required', 'successUrl and cancelUrl are required for Stripe Checkout.', 400);
      }

      const entitlement = await options.usageStore.getEntitlement(input.tenantId);
      const body = new URLSearchParams();
      body.set('mode', 'subscription');
      body.set('line_items[0][price]', priceId);
      body.set('line_items[0][quantity]', '1');
      body.set('success_url', successUrl);
      body.set('cancel_url', cancelUrl);
      body.set('client_reference_id', input.tenantId);
      body.set('metadata[tenant_id]', input.tenantId);
      body.set('metadata[plan]', input.plan);
      body.set('subscription_data[metadata][tenant_id]', input.tenantId);
      body.set('subscription_data[metadata][plan]', input.plan);
      body.set('allow_promotion_codes', 'true');
      if (entitlement.stripeCustomerId) {
        body.set('customer', entitlement.stripeCustomerId);
      }

      const response = await (options.fetch ?? fetch)(STRIPE_CHECKOUT_SESSIONS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const text = await response.text();
      const data = safeJsonObject(text);

      if (!response.ok) {
        throw new StripeBillingError(
          'stripe_checkout_failed',
          stripeErrorMessage(data) || `Stripe Checkout session creation failed with HTTP ${response.status}.`,
          502,
        );
      }

      const id = stringField(data.id);
      const url = stringField(data.url);
      if (!id || !url) {
        throw new StripeBillingError('stripe_checkout_invalid_response', 'Stripe Checkout response did not include id and url.', 502);
      }

      return {
        id,
        url,
        plan: input.plan,
        tenantId: input.tenantId,
        stripeCustomerId: stripeId(data.customer),
        stripeSubscriptionId: stripeId(data.subscription),
      };
    },
  };
}

export async function handleStripeWebhookRequest(
  request: Request,
  options: StripeWebhookOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return stripeJson({ success: false, error: { code: 'method_not_allowed', message: 'Stripe webhook requires POST.' } }, 405);
  }
  if (!options.webhookSecret) {
    return stripeJson({ success: false, error: { code: 'stripe_webhook_unconfigured', message: 'Stripe webhook secret is not configured.' } }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  try {
    await verifyStripeWebhookSignature(rawBody, signature, options.webhookSecret, options.now);
  } catch (error) {
    return stripeJson({
      success: false,
      error: {
        code: 'stripe_signature_invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    }, 400);
  }

  let event: StripeEvent;
  try {
    event = parseJsonRecord(rawBody) as StripeEvent;
  } catch (error) {
    return stripeJson({
      success: false,
      error: {
        code: 'stripe_payload_invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    }, 400);
  }
  const result = await syncStripeEventToEntitlement(event, options);
  return stripeJson({ success: true, received: true, ...result });
}

export async function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string,
  now: number = Date.now(),
): Promise<void> {
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    throw new Error('Missing Stripe webhook timestamp or v1 signature.');
  }

  const ageSeconds = Math.abs(Math.floor(now / 1000) - parsed.timestamp);
  if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook signature timestamp is outside tolerance.');
  }

  const expected = await hmacSha256Hex(webhookSecret, `${parsed.timestamp}.${payload}`);
  if (!parsed.signatures.some(signature => constantTimeEqual(signature, expected))) {
    throw new Error('No Stripe webhook signatures matched the expected signature.');
  }
}

async function syncStripeEventToEntitlement(
  event: StripeEvent,
  options: StripeWebhookOptions,
): Promise<Record<string, unknown>> {
  const type = event.type;
  const object = event.data?.object;
  const eventId = stringField(event.id);
  if (!eventId || !type || !object) {
    return { handled: false, reason: 'missing_event_object' };
  }

  if (type === 'checkout.session.completed') {
    const tenantId = stringField(nestedMetadata(object).tenant_id) || stringField(object.client_reference_id);
    const plan = paidPlan(nestedMetadata(object).plan);
    const subscriptionId = stripeId(object.subscription);
    const customerId = stripeId(object.customer);
    if (!tenantId || !plan) {
      return { handled: false, type, reason: 'missing_checkout_tenant_or_plan' };
    }
    if (await options.usageStore.hasStripeBillingEvent(eventId)) {
      return { handled: false, type, duplicate: true, reason: 'duplicate_stripe_event' };
    }
    const stale = await staleSubscriptionResult(options, type, tenantId, subscriptionId);
    if (stale) {
      await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
      return stale;
    }

    await options.usageStore.upsertEntitlement({
      tenantId,
      plan,
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
    await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
    return { handled: true, type, tenantId, plan, status: 'active' };
  }

  if (type?.startsWith('customer.subscription.')) {
    const subscriptionId = stripeId(object.id);
    const tenantId = stringField(nestedMetadata(object).tenant_id)
      || await findTenantIdForSubscription(options.usageStore, subscriptionId);
    if (!tenantId) {
      return { handled: false, type, reason: 'missing_subscription_tenant' };
    }
    if (await options.usageStore.hasStripeBillingEvent(eventId)) {
      return { handled: false, type, duplicate: true, reason: 'duplicate_stripe_event' };
    }

    const stale = await staleSubscriptionResult(options, type, tenantId, subscriptionId, {
      requireCurrentMatch: type === 'customer.subscription.deleted',
    });
    if (stale) {
      await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
      return stale;
    }

    const subscriptionStatus = stringField(object.status) || (type === 'customer.subscription.deleted' ? 'canceled' : 'active');
    const planFromEvent = paidPlan(nestedMetadata(object).plan)
      || planFromSubscriptionPrice(object, options.priceIds);
    const plan = type === 'customer.subscription.deleted'
      ? 'free'
      : entitlementPlanForSubscriptionStatus(subscriptionStatus, planFromEvent);
    const status = type === 'customer.subscription.deleted'
      ? 'cancelled'
      : entitlementStatusForSubscriptionStatus(subscriptionStatus);

    await options.usageStore.upsertEntitlement({
      tenantId,
      plan,
      status,
      stripeCustomerId: stripeId(object.customer),
      stripeSubscriptionId: subscriptionId,
      currentPeriodStart: stripeTimestampMs(object.current_period_start),
      currentPeriodEnd: stripeTimestampMs(object.current_period_end),
    });
    await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
    return { handled: true, type, tenantId, plan, status, stripeSubscriptionId: subscriptionId };
  }

  return { handled: false, type, reason: 'event_type_ignored' };
}

async function findTenantIdForSubscription(
  usageStore: D1UsageQuotaStore,
  subscriptionId: string | null,
): Promise<string | null> {
  if (!subscriptionId) return null;
  const entitlement = await usageStore.findEntitlementByStripeSubscriptionId(subscriptionId);
  return entitlement?.tenantId ?? null;
}

async function staleSubscriptionResult(
  options: StripeWebhookOptions,
  type: string,
  tenantId: string,
  subscriptionId: string | null,
  settings: { requireCurrentMatch?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const current = await options.usageStore.getEntitlement(tenantId);
  if (settings.requireCurrentMatch && current.stripeSubscriptionId !== subscriptionId) {
    return {
      handled: false,
      type,
      stale: true,
      reason: 'stale_subscription_event',
      tenantId,
      stripeSubscriptionId: subscriptionId,
      currentStripeSubscriptionId: current.stripeSubscriptionId ?? null,
    };
  }
  if (
    subscriptionId &&
    current.stripeSubscriptionId &&
    current.stripeSubscriptionId !== subscriptionId
  ) {
    return {
      handled: false,
      type,
      stale: true,
      reason: 'stale_subscription_event',
      tenantId,
      stripeSubscriptionId: subscriptionId,
      currentStripeSubscriptionId: current.stripeSubscriptionId,
    };
  }
  return null;
}

async function recordProcessedStripeEvent(
  options: StripeWebhookOptions,
  event: StripeEvent,
  eventType: string,
  tenantId?: string | null,
  subscriptionId?: string | null,
): Promise<void> {
  const eventId = stringField(event.id);
  if (!eventId) return;
  await options.usageStore.recordStripeBillingEvent({
    eventId,
    eventType,
    tenantId,
    stripeSubscriptionId: subscriptionId,
    eventCreatedAt: stripeTimestampMs(event.created),
  });
}

function priceIdForPlan(plan: Exclude<SubscriptionPlan, 'free'>, priceIds: StripePriceIds): string | null {
  return plan === 'plus' ? stringField(priceIds.plus) : stringField(priceIds.pro);
}

function planFromSubscriptionPrice(object: Record<string, unknown>, priceIds?: StripePriceIds): Exclude<SubscriptionPlan, 'free'> | null {
  const items = object.items;
  const itemList = isRecord(items) && Array.isArray(items.data) ? items.data : [];
  for (const item of itemList) {
    if (!isRecord(item)) continue;
    const price = item.price;
    const priceId = isRecord(price) ? stringField(price.id) : null;
    if (priceId && priceId === priceIds?.plus) return 'plus';
    if (priceId && priceId === priceIds?.pro) return 'pro';
  }
  return null;
}

function paidPlan(value: unknown): Exclude<SubscriptionPlan, 'free'> | null {
  const plan = normalizeSubscriptionPlan(value);
  return plan === 'plus' || plan === 'pro' ? plan : null;
}

function entitlementPlanForSubscriptionStatus(
  status: string,
  plan: Exclude<SubscriptionPlan, 'free'> | null,
): SubscriptionPlan {
  if (!plan) return 'free';
  return ['canceled', 'cancelled', 'incomplete_expired', 'unpaid'].includes(status) ? 'free' : plan;
}

function entitlementStatusForSubscriptionStatus(status: string): string {
  if (status === 'canceled') return 'cancelled';
  if (status === 'active' || status === 'trialing') return 'active';
  return status;
}

function stripeTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value) * 1000;
  return null;
}

function nestedMetadata(object: Record<string, unknown>): Record<string, unknown> {
  return isRecord(object.metadata) ? object.metadata : {};
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value)) return stringField(value.id);
  return null;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonRecord(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error('Stripe webhook payload must be a JSON object.');
  }
  return parsed;
}

function stripeErrorMessage(data: Record<string, unknown>): string | null {
  const error = data.error;
  return isRecord(error) ? stringField(error.message) : null;
}

function resolveCheckoutRedirectUrl(
  requested: string | null | undefined,
  configured: string | null | undefined,
  field: string,
): string | null {
  const selected = stringField(requested) || stringField(configured);
  if (!selected) return null;

  let selectedUrl: URL;
  try {
    selectedUrl = new URL(selected);
  } catch {
    throw new StripeBillingError('stripe_checkout_url_invalid', `${field} must be a valid URL.`, 400);
  }
  if (selectedUrl.protocol !== 'https:') {
    throw new StripeBillingError('stripe_checkout_url_invalid', `${field} must use https.`, 400);
  }

  if (requested && configured) {
    const configuredUrl = new URL(configured);
    if (selectedUrl.origin !== configuredUrl.origin) {
      throw new StripeBillingError('stripe_checkout_url_forbidden', `${field} must use the configured application origin.`, 400);
    }
  }

  return selectedUrl.toString();
}

function parseStripeSignatureHeader(header: string | null): { timestamp: number | null; signatures: string[] } {
  const result: { timestamp: number | null; signatures: string[] } = { timestamp: null, signatures: [] };
  if (!header) return result;

  for (const part of header.split(',')) {
    const [rawKey, ...rawValue] = part.split('=');
    const key = rawKey.trim();
    const value = rawValue.join('=').trim();
    if (key === 't' && /^\d+$/.test(value)) {
      result.timestamp = Number(value);
    } else if (key === 'v1' && /^[a-f0-9]+$/i.test(value)) {
      result.signatures.push(value.toLowerCase());
    }
  }
  return result;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripeJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export class StripeBillingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'StripeBillingError';
  }
}
