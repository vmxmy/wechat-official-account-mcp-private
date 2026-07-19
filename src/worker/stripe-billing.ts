import { D1UsageQuotaStore } from './usage-store.js';
import {
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
  resolveOwnerEmail?: (tenantId: string) => Promise<string | null | undefined>;
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
  resolveSubscription?: (
    subscriptionId: string,
    eventObject: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  reconcileAccountLocks?: (
    tenantId: string,
    plan: SubscriptionPlan,
    stripeEventId: string,
  ) => Promise<unknown>;
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
const STRIPE_SUBSCRIPTIONS_URL = 'https://api.stripe.com/v1/subscriptions';
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
      } else {
        const ownerEmail = await options.resolveOwnerEmail?.(input.tenantId);
        if (!ownerEmail) {
          throw new StripeBillingError(
            'stripe_customer_email_required',
            'Tenant owner verified email is required before creating Stripe Checkout.',
            409,
          );
        }
        body.set('customer_email', ownerEmail);
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

export function createStripeSubscriptionResolver(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): StripeWebhookOptions['resolveSubscription'] {
  return async subscriptionId => {
    const response = await fetchImpl(`${STRIPE_SUBSCRIPTIONS_URL}/${encodeURIComponent(subscriptionId)}`, {
      headers: { authorization: `Bearer ${secretKey}` },
    });
    const body = safeJsonObject(await response.text());
    if (!response.ok || stripeId(body.id) !== subscriptionId) {
      throw new Error(`Stripe subscription reconciliation failed with HTTP ${response.status}.`);
    }
    return body;
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
    const subscriptionId = stripeId(object.subscription);
    if (!tenantId || !subscriptionId) {
      return { handled: false, type, reason: 'missing_checkout_tenant_or_subscription' };
    }
    if (await options.usageStore.hasStripeBillingEvent(eventId)) {
      return { handled: false, type, duplicate: true, reason: 'duplicate_stripe_event' };
    }
    const stale = await staleSubscriptionResult(options, type, tenantId, subscriptionId);
    if (stale) {
      await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
      return stale;
    }

    await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
    return {
      handled: false,
      type,
      tenantId,
      stripeSubscriptionId: subscriptionId,
      reason: 'awaiting_authoritative_subscription_event',
    };
  }

  if (type?.startsWith('customer.subscription.')) {
    const subscriptionId = stripeId(object.id);
    if (!subscriptionId) {
      return { handled: false, type, reason: 'missing_subscription_id' };
    }
    if (await options.usageStore.hasStripeBillingEvent(eventId)) {
      return { handled: false, type, duplicate: true, reason: 'duplicate_stripe_event' };
    }
    const alreadyCommitted = await options.usageStore.findEntitlementByLastStripeEventId(eventId);
    if (alreadyCommitted) {
      await options.reconcileAccountLocks?.(alreadyCommitted.tenantId, alreadyCommitted.plan, eventId);
      await recordProcessedStripeEvent(options, event, type, alreadyCommitted.tenantId, subscriptionId);
      return {
        handled: true,
        type,
        tenantId: alreadyCommitted.tenantId,
        stripeSubscriptionId: subscriptionId,
        reason: 'entitlement_already_committed',
      };
    }
    const isDeletion = type === 'customer.subscription.deleted';
    let subscriptionObject = isDeletion
      ? object
      : await requireStripeSubscriptionResolver(options)(subscriptionId, object);
    const boundEntitlement = await options.usageStore.findEntitlementByStripeSubscriptionId(subscriptionId);
    const metadataTenantId = stringField(nestedMetadata(subscriptionObject).tenant_id);
    const tenantId = boundEntitlement?.tenantId || metadataTenantId;
    if (!tenantId) {
      return { handled: false, type, reason: 'missing_subscription_tenant' };
    }
    const ordering = stripeEntitlementEventOrdering(event);
    const currentEntitlement = boundEntitlement ?? await options.usageStore.getEntitlement(tenantId);
    let transition = subscriptionEntitlementTransition(
      type,
      tenantId,
      subscriptionId,
      subscriptionObject,
      options.priceIds,
    );
    let effectiveOrdering = orderingForEntitlement(ordering, currentEntitlement, !isDeletion);
    const allowCreatedReplacement = allowsCreatedSubscriptionReplacement(
      type,
      subscriptionId,
      currentEntitlement,
      transition.stripeCustomerId,
      transition.subscriptionStatus,
    );
    const stale = staleSubscriptionResultForEntitlement(type, tenantId, subscriptionId, currentEntitlement, {
      requireCurrentMatch: type === 'customer.subscription.deleted',
      allowDifferentSubscription: allowCreatedReplacement,
      incomingCustomerId: transition.stripeCustomerId,
    });
    if (stale) {
      await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
      return stale;
    }

    let applied = await options.usageStore.upsertEntitlementFromStripeEvent(transition.entitlementUpdate, {
      ...effectiveOrdering,
      enforceExpectedCurrentStripeSubscriptionId: true,
      expectedCurrentStripeSubscriptionId: currentEntitlement.stripeSubscriptionId ?? null,
      enforceExpectedCurrentStripeEventId: true,
      expectedCurrentStripeEventId: currentEntitlement.lastStripeEventId ?? null,
    });
    if (!applied) {
      // 任何并发 watermark 变化都要求重新读取 Stripe 权威订阅快照，再基于新的
      // subscription/event 双 CAS 重试；避免同秒事件按数据库完成顺序回写旧快照。
      const refreshedEntitlement = await options.usageStore.getEntitlement(tenantId);
      if (refreshedEntitlement.lastStripeEventId === eventId) {
        await options.reconcileAccountLocks?.(tenantId, refreshedEntitlement.plan, eventId);
        await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
        return {
          handled: true,
          type,
          tenantId,
          stripeSubscriptionId: subscriptionId,
          reason: 'entitlement_already_committed',
        };
      }
      if (!isDeletion) {
        subscriptionObject = await requireStripeSubscriptionResolver(options)(subscriptionId, subscriptionObject);
        const refreshedBinding = await options.usageStore.findEntitlementByStripeSubscriptionId(subscriptionId);
        const refreshedMetadataTenantId = stringField(nestedMetadata(subscriptionObject).tenant_id);
        const refreshedTenantId = refreshedBinding?.tenantId || refreshedMetadataTenantId;
        if (refreshedTenantId !== tenantId) {
          throw new Error('Stripe subscription tenant changed during reconciliation; retry the webhook event.');
        }
        transition = subscriptionEntitlementTransition(
          type,
          tenantId,
          subscriptionId,
          subscriptionObject,
          options.priceIds,
        );
      }
      effectiveOrdering = orderingForEntitlement(ordering, refreshedEntitlement, !isDeletion);
      const refreshedStale = staleSubscriptionResultForEntitlement(
        type,
        tenantId,
        subscriptionId,
        refreshedEntitlement,
        {
          requireCurrentMatch: type === 'customer.subscription.deleted',
          incomingCustomerId: transition.stripeCustomerId,
          allowDifferentSubscription: allowsCreatedSubscriptionReplacement(
            type,
            subscriptionId,
            refreshedEntitlement,
            transition.stripeCustomerId,
            transition.subscriptionStatus,
          ),
        },
      );
      if (refreshedStale) {
        await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
        return refreshedStale;
      }
      applied = await options.usageStore.upsertEntitlementFromStripeEvent(transition.entitlementUpdate, {
        ...effectiveOrdering,
        enforceExpectedCurrentStripeSubscriptionId: true,
        expectedCurrentStripeSubscriptionId: refreshedEntitlement.stripeSubscriptionId ?? null,
        enforceExpectedCurrentStripeEventId: true,
        expectedCurrentStripeEventId: refreshedEntitlement.lastStripeEventId ?? null,
      });
    }
    if (!applied) {
      const finalEntitlement = await options.usageStore.getEntitlement(tenantId);
      if (finalEntitlement.lastStripeEventId === eventId) {
        await options.reconcileAccountLocks?.(tenantId, finalEntitlement.plan, eventId);
        await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
        return {
          handled: true,
          type,
          tenantId,
          stripeSubscriptionId: subscriptionId,
          reason: 'entitlement_already_committed',
        };
      }
      const finalStale = staleSubscriptionResultForEntitlement(
        type,
        tenantId,
        subscriptionId,
        finalEntitlement,
        {
          requireCurrentMatch: type === 'customer.subscription.deleted',
          incomingCustomerId: transition.stripeCustomerId,
          allowDifferentSubscription: allowsCreatedSubscriptionReplacement(
            type,
            subscriptionId,
            finalEntitlement,
            transition.stripeCustomerId,
            transition.subscriptionStatus,
          ),
        },
      );
      if (finalStale) {
        await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
        return finalStale;
      }
      if (stripeEventPrecedesEntitlementWatermark(ordering, finalEntitlement)) {
        await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
        return outOfOrderStripeEventResult(type, tenantId, subscriptionId);
      }
      throw new Error('Stripe entitlement update remained contended; retry the webhook event.');
    }
    await options.reconcileAccountLocks?.(tenantId, transition.plan, ordering.id);
    await recordProcessedStripeEvent(options, event, type, tenantId, subscriptionId);
    return {
      handled: true,
      type,
      tenantId,
      plan: transition.plan,
      status: transition.status,
      pendingPlan: transition.pendingPlan,
      pendingPlanEffectiveAt: transition.pendingPlanEffectiveAt,
      stripeSubscriptionId: subscriptionId,
    };
  }

  return { handled: false, type, reason: 'event_type_ignored' };
}

function subscriptionEntitlementTransition(
  type: string,
  tenantId: string,
  subscriptionId: string,
  subscriptionObject: Record<string, unknown>,
  priceIds?: StripePriceIds,
): {
  stripeCustomerId: string;
  subscriptionStatus: string;
  plan: SubscriptionPlan;
  status: string;
  pendingPlan: SubscriptionPlan | null;
  pendingPlanEffectiveAt: number | null;
  entitlementUpdate: {
    tenantId: string;
    plan: SubscriptionPlan;
    status: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    currentPeriodStart: number | null;
    currentPeriodEnd: number | null;
    pendingPlan: SubscriptionPlan | null;
    pendingPlanEffectiveAt: number | null;
  };
} {
  const isDeletion = type === 'customer.subscription.deleted';
  const stripeCustomerId = stripeId(subscriptionObject.customer);
  if (!stripeCustomerId) {
    throw new Error('Stripe subscription is missing a valid customer id.');
  }
  const subscriptionStatus = stringField(subscriptionObject.status) || (isDeletion ? 'canceled' : 'active');
  const planItem = isDeletion ? null : subscriptionPlanItem(subscriptionObject, priceIds);
  const periodStart = planItem
    ? subscriptionPeriodTimestampMs(subscriptionObject, planItem.item, 'current_period_start')
    : null;
  const periodEnd = planItem
    ? subscriptionPeriodTimestampMs(subscriptionObject, planItem.item, 'current_period_end')
    : null;
  if (!isDeletion) assertValidSubscriptionPeriod(periodStart, periodEnd);
  const cancelAtPeriodEnd = booleanField(subscriptionObject.cancel_at_period_end);
  if (cancelAtPeriodEnd && periodEnd === null) {
    throw new Error('Stripe subscription cancellation is missing a verified plan-item period end.');
  }
  const planFromEvent = planItem?.plan ?? null;
  const computedPlan = isDeletion
    ? 'free'
    : entitlementPlanForSubscriptionStatus(subscriptionStatus, planFromEvent);
  const plan = cancelAtPeriodEnd && !isDeletion ? planFromEvent! : computedPlan;
  let status = entitlementStatusForSubscriptionStatus(subscriptionStatus);
  if (cancelAtPeriodEnd && !isDeletion) status = 'active';
  else if (isDeletion) status = 'cancelled';
  const pendingPlan: SubscriptionPlan | null = cancelAtPeriodEnd && !isDeletion ? 'free' : null;
  const pendingPlanEffectiveAt = pendingPlan ? periodEnd : null;
  return {
    stripeCustomerId,
    subscriptionStatus,
    plan,
    status,
    pendingPlan,
    pendingPlanEffectiveAt,
    entitlementUpdate: {
      tenantId,
      plan,
      status,
      stripeCustomerId,
      stripeSubscriptionId: plan === 'free' ? null : subscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      pendingPlan,
      pendingPlanEffectiveAt,
    },
  };
}

function orderingForEntitlement(
  ordering: { id: string; createdAt: number; priority: number },
  entitlement: Awaited<ReturnType<D1UsageQuotaStore['getEntitlement']>>,
  allowMigrationPromotion: boolean,
): { id: string; createdAt: number; priority: number } {
  if (
    allowMigrationPromotion &&
    entitlement.lastStripeEventId?.startsWith('migration:') &&
    stripeEventPrecedesEntitlementWatermark(ordering, entitlement) &&
    entitlement.lastStripeEventCreatedAt !== null &&
    entitlement.lastStripeEventCreatedAt !== undefined
  ) {
    return {
      ...ordering,
      createdAt: entitlement.lastStripeEventCreatedAt,
      priority: (entitlement.lastStripeEventPriority ?? 100) + 1,
    };
  }
  return ordering;
}

function stripeEventPrecedesEntitlementWatermark(
  event: { createdAt: number; priority: number },
  entitlement: Awaited<ReturnType<D1UsageQuotaStore['getEntitlement']>>,
): boolean {
  const currentCreatedAt = entitlement.lastStripeEventCreatedAt;
  if (currentCreatedAt === null || currentCreatedAt === undefined) return false;
  if (event.createdAt !== currentCreatedAt) return event.createdAt < currentCreatedAt;
  return event.priority < (entitlement.lastStripeEventPriority ?? -1);
}

function allowsCreatedSubscriptionReplacement(
  type: string,
  subscriptionId: string,
  current: Awaited<ReturnType<D1UsageQuotaStore['getEntitlement']>>,
  incomingCustomerId: string | null,
  incomingStatus: string,
): boolean {
  if (type !== 'customer.subscription.created') return false;
  if (current.stripeCustomerId && current.stripeCustomerId !== incomingCustomerId) return false;
  if (!current.stripeSubscriptionId || current.stripeSubscriptionId === subscriptionId) return true;
  if (['canceled', 'cancelled', 'incomplete_expired', 'unpaid'].includes(incomingStatus)) return false;
  if (current.plan === 'free' || current.pendingPlan === 'free' || current.status === 'cancelled') return true;
  throw new Error('Stripe replacement subscription is awaiting authoritative cancellation; retry the webhook event.');
}

function stripeEntitlementEventOrdering(
  event: StripeEvent,
): { id: string; createdAt: number; priority: number } {
  const id = stringField(event.id);
  const createdAt = stripeTimestampMs(event.created);
  if (!id || createdAt === null) {
    throw new Error('Stripe entitlement event is missing id or created timestamp.');
  }
  // 同一秒内的所有订阅事件都从 Stripe 重新读取当前订阅状态，因此类型之间
  // 不应互相压制；subscription ID 的 CAS 负责阻止旧订阅覆盖新绑定。
  return { id, createdAt, priority: 40 };
}

function outOfOrderStripeEventResult(
  type: string,
  tenantId: string,
  subscriptionId: string | null,
): Record<string, unknown> {
  return {
    handled: false,
    type,
    stale: true,
    reason: 'out_of_order_stripe_event',
    tenantId,
    stripeSubscriptionId: subscriptionId,
  };
}

function requireStripeSubscriptionResolver(
  options: StripeWebhookOptions,
): NonNullable<StripeWebhookOptions['resolveSubscription']> {
  if (!options.resolveSubscription) {
    throw new Error('Stripe subscription resolver is required for entitlement reconciliation.');
  }
  return options.resolveSubscription;
}

async function staleSubscriptionResult(
  options: StripeWebhookOptions,
  type: string,
  tenantId: string,
  subscriptionId: string | null,
  settings: { requireCurrentMatch?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const current = await options.usageStore.getEntitlement(tenantId);
  return staleSubscriptionResultForEntitlement(type, tenantId, subscriptionId, current, settings);
}

function staleSubscriptionResultForEntitlement(
  type: string,
  tenantId: string,
  subscriptionId: string | null,
  current: Awaited<ReturnType<D1UsageQuotaStore['getEntitlement']>>,
  settings: {
    requireCurrentMatch?: boolean;
    allowDifferentSubscription?: boolean;
    incomingCustomerId?: string | null;
  } = {},
): Record<string, unknown> | null {
  if (
    settings.incomingCustomerId &&
    current.stripeCustomerId &&
    current.stripeCustomerId !== settings.incomingCustomerId
  ) {
    return {
      handled: false,
      type,
      stale: true,
      reason: 'stale_stripe_customer_event',
      tenantId,
      stripeSubscriptionId: subscriptionId,
    };
  }
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
    current.stripeSubscriptionId !== subscriptionId &&
    !settings.allowDifferentSubscription
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

function subscriptionPlanItem(
  object: Record<string, unknown>,
  priceIds?: StripePriceIds,
): { plan: Exclude<SubscriptionPlan, 'free'>; item: Record<string, unknown> } | null {
  const items = object.items;
  const itemList = isRecord(items) && Array.isArray(items.data) ? items.data : [];
  const matches: Array<{ plan: Exclude<SubscriptionPlan, 'free'>; item: Record<string, unknown> }> = [];
  for (const item of itemList) {
    if (!isRecord(item)) continue;
    const price = item.price;
    const priceId = isRecord(price) ? stringField(price.id) : null;
    if (priceId && priceId === priceIds?.plus) matches.push({ plan: 'plus', item });
    if (priceId && priceId === priceIds?.pro) matches.push({ plan: 'pro', item });
  }
  if (matches.length !== 1) {
    throw new Error(`Stripe subscription must contain exactly one configured plan price item; received ${matches.length}.`);
  }
  return matches[0];
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

function subscriptionPeriodTimestampMs(
  object: Record<string, unknown>,
  planItem: Record<string, unknown>,
  field: 'current_period_start' | 'current_period_end',
): number | null {
  const itemTimestamp = stripeTimestampMs(planItem[field]);
  if (itemTimestamp === null) {
    throw new Error(`Stripe subscription plan item is missing ${field}.`);
  }
  const topLevelTimestamp = stripeTimestampMs(object[field]);
  if (topLevelTimestamp !== null && topLevelTimestamp !== itemTimestamp) {
    throw new Error(`Stripe subscription ${field} conflicts with the configured plan item.`);
  }
  return itemTimestamp;
}

function assertValidSubscriptionPeriod(periodStart: number | null, periodEnd: number | null): void {
  if (
    periodStart === null ||
    periodEnd === null ||
    !Number.isInteger(periodStart) ||
    !Number.isInteger(periodEnd) ||
    periodStart <= 0 ||
    periodEnd <= periodStart
  ) {
    throw new Error('Stripe subscription plan item has an invalid current period interval.');
  }
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

function booleanField(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
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
