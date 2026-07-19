import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deleteWechatResourceWithAudit,
  persistCredentialConfigurationWithAudit,
} from '../src/worker/agent-init.js';
import { createTenantManagementMcpTools } from '../src/mcp-tool/tools/tenant-management-tools.js';
import { D1AuditLogWriter } from '../src/worker/audit-log.js';
import { handleManagementApiRequest } from '../src/worker/management-api.js';
import { handleStripeWebhookRequest } from '../src/worker/stripe-billing.js';
import type { TenantRequestContext } from '../src/worker/tenant-context.js';

const STRIPE_SECRET = 'whsec_audit_fixture';
const STRIPE_NOW = Date.UTC(2026, 6, 19, 8, 0, 0);

function stripeRequest(event: Record<string, unknown>): Request {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(STRIPE_NOW / 1000);
  const signature = createHmac('sha256', STRIPE_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return new Request('https://worker.example/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body: payload,
  });
}

function subscriptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_audit_fixture',
    type: 'customer.subscription.updated',
    created: Math.floor(STRIPE_NOW / 1000),
    data: {
      object: {
        id: 'sub_audit_fixture',
        customer: 'cus_audit_fixture',
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_plus_fixture' },
            current_period_start: Math.floor(STRIPE_NOW / 1000),
            current_period_end: Math.floor(STRIPE_NOW / 1000) + 2_592_000,
          }],
        },
        metadata: { tenant_id: 'tenant_metadata' },
        ...overrides,
      },
    },
  };
}

function entitlement(tenantId: string, overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    plan: 'plus',
    status: 'active',
    limitOverrides: { tool_calls_month: 77 },
    stripeCustomerId: 'cus_audit_fixture',
    stripeSubscriptionId: 'sub_audit_fixture',
    currentPeriodStart: STRIPE_NOW,
    currentPeriodEnd: STRIPE_NOW + 2_592_000_000,
    pendingPlan: null,
    pendingPlanEffectiveAt: null,
    lastStripeEventCreatedAt: null,
    lastStripeEventPriority: null,
    lastStripeEventId: null,
    ...overrides,
  };
}

test('Stripe duplicate delivery is short-circuited before authoritative subscription fetch', async () => {
  let resolverCalls = 0;
  const response = await handleStripeWebhookRequest(stripeRequest(subscriptionEvent()), {
    webhookSecret: STRIPE_SECRET,
    now: STRIPE_NOW,
    priceIds: { plus: 'price_plus_fixture', pro: 'price_pro_fixture' },
    usageStore: {
      hasStripeBillingEvent: async () => true,
    } as any,
    resolveSubscription: async () => {
      resolverCalls += 1;
      throw new Error('duplicate must not fetch Stripe');
    },
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.reason, 'duplicate_stripe_event');
  assert.equal(resolverCalls, 0);
});

test('existing local subscription binding wins over mutable Stripe metadata tenant', async () => {
  let appliedTenant: string | null = null;
  const bound = entitlement('tenant_bound');
  const response = await handleStripeWebhookRequest(stripeRequest(subscriptionEvent()), {
    webhookSecret: STRIPE_SECRET,
    now: STRIPE_NOW,
    priceIds: { plus: 'price_plus_fixture', pro: 'price_pro_fixture' },
    usageStore: {
      hasStripeBillingEvent: async () => false,
      findEntitlementByStripeSubscriptionId: async () => bound,
      findEntitlementByLastStripeEventId: async () => null,
      getEntitlement: async (tenantId: string) => entitlement(tenantId),
      upsertEntitlementFromStripeEvent: async (input: { tenantId: string }) => {
        appliedTenant = input.tenantId;
        return true;
      },
      recordStripeBillingEvent: async () => undefined,
    } as any,
    resolveSubscription: async (_id, object) => object,
  });
  assert.equal(response.status, 200);
  assert.equal(appliedTenant, 'tenant_bound');
});

test('Stripe subscription event without a customer id fails closed before entitlement mutation', async () => {
  let writes = 0;
  await assert.rejects(
    handleStripeWebhookRequest(stripeRequest(subscriptionEvent({ customer: null })), {
      webhookSecret: STRIPE_SECRET,
      now: STRIPE_NOW,
      priceIds: { plus: 'price_plus_fixture', pro: 'price_pro_fixture' },
      usageStore: {
        hasStripeBillingEvent: async () => false,
        findEntitlementByStripeSubscriptionId: async () => null,
        findEntitlementByLastStripeEventId: async () => null,
        getEntitlement: async () => entitlement('tenant_metadata', {
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        }),
        upsertEntitlementFromStripeEvent: async () => {
          writes += 1;
          return true;
        },
        recordStripeBillingEvent: async () => undefined,
      } as any,
      resolveSubscription: async (_id, object) => object,
    }),
    /customer/i,
  );
  assert.equal(writes, 0);
});

test('retry after committed Stripe entitlement reruns lock reconciliation before marking processed', async () => {
  const event = subscriptionEvent({
    id: 'sub_deleted_fixture',
    status: 'canceled',
    items: { data: [] },
    metadata: { tenant_id: 'tenant_metadata' },
  });
  event.id = 'evt_deleted_committed_fixture';
  event.type = 'customer.subscription.deleted';
  let reconciliations = 0;
  let recorded = 0;
  const response = await handleStripeWebhookRequest(stripeRequest(event), {
    webhookSecret: STRIPE_SECRET,
    now: STRIPE_NOW,
    usageStore: {
      hasStripeBillingEvent: async () => false,
      findEntitlementByLastStripeEventId: async () => entitlement('tenant_bound', {
        plan: 'free',
        status: 'cancelled',
        stripeSubscriptionId: null,
        lastStripeEventId: 'evt_deleted_committed_fixture',
      }),
      findEntitlementByStripeSubscriptionId: async () => null,
      getEntitlement: async () => entitlement('tenant_metadata', { stripeSubscriptionId: null }),
      recordStripeBillingEvent: async () => { recorded += 1; },
    } as any,
    reconcileAccountLocks: async () => { reconciliations += 1; },
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.reason, 'entitlement_already_committed');
  assert.equal(reconciliations, 1);
  assert.equal(recorded, 1);
});

test('credential finalization reconciles an indeterminate error before deciding rollback', async () => {
  const steps: string[] = [];
  const result = await persistCredentialConfigurationWithAudit({
    writeStartedAudit: async () => { steps.push('started'); },
    assertLeaseHeld: async () => { steps.push('lease'); },
    persist: async () => { steps.push('persisted'); return 'saved'; },
    writeSucceededAudit: async () => { steps.push('unexpected-standalone-success-audit'); },
    finalizeWithSucceededAudit: async () => { steps.push('finalize+audit'); throw new Error('unknown commit'); },
    reconcileFinalization: async () => { steps.push('reconciled'); return 'committed'; },
    rollback: async () => { steps.push('rollback'); },
  });
  assert.equal(result, 'saved');
  assert.equal(steps.includes('rollback'), false);
  assert.equal(steps.includes('unexpected-standalone-success-audit'), false);
  assert.equal(steps.at(-1), 'reconciled');
});

test('credential rollback is fenced by the account operation lease', async () => {
  const steps: string[] = [];
  await assert.rejects(persistCredentialConfigurationWithAudit({
    writeStartedAudit: async () => undefined,
    assertLeaseHeld: async () => {
      steps.push('lease');
      if (steps.length > 1) throw new Error('lease lost');
    },
    persist: async () => 'saved',
    writeSucceededAudit: async () => { throw new Error('audit failed'); },
    rollback: async () => { steps.push('rollback'); },
  }), (error: any) => error?.name === 'CredentialOperationIndeterminateError' && error?.cause?.message === 'lease lost');
  assert.equal(steps.includes('rollback'), false);
});

test('delete reconciliation does not restore a token after an indeterminate committed delete', async () => {
  const steps: string[] = [];
  await deleteWechatResourceWithAudit({
    writeStartedAudit: async () => undefined,
    assertLeaseHeld: async () => undefined,
    clearToken: async () => { steps.push('cleared'); },
    deleteWithSucceededAudit: async () => { throw new Error('unknown delete commit'); },
    isDeleted: async () => true,
    restoreToken: async () => { steps.push('restored'); },
  });
  assert.deepEqual(steps, ['cleared']);
});

test('delete does not restore a token when the lease check fails before mutation starts', async () => {
  const steps: string[] = [];
  await assert.rejects(deleteWechatResourceWithAudit({
    writeStartedAudit: async () => undefined,
    assertLeaseHeld: async () => { throw new Error('lease unavailable'); },
    clearToken: async () => { steps.push('cleared'); },
    deleteWithSucceededAudit: async () => undefined,
    restoreToken: async () => { steps.push('restored'); },
  }), /lease unavailable/);
  assert.deepEqual(steps, []);
});

test('delete reconciliation is not consulted before the delete transaction is attempted', async () => {
  let reconciliationCalls = 0;
  let restores = 0;
  await assert.rejects(deleteWechatResourceWithAudit({
    writeStartedAudit: async () => undefined,
    assertLeaseHeld: async () => undefined,
    clearToken: async () => { throw new Error('token clear failed'); },
    deleteWithSucceededAudit: async () => undefined,
    isDeleted: async () => { reconciliationCalls += 1; return true; },
    restoreToken: async () => { restores += 1; },
  }), /token clear failed/);
  assert.equal(reconciliationCalls, 0);
  assert.equal(restores, 1);
});

test('final Stripe CAS retry recognizes the same event committed by a concurrent delivery', async () => {
  const event = subscriptionEvent();
  let reads = 0;
  let reconciliations = 0;
  let recorded = 0;
  const response = await handleStripeWebhookRequest(stripeRequest(event), {
    webhookSecret: STRIPE_SECRET,
    now: STRIPE_NOW,
    priceIds: { plus: 'price_plus_fixture', pro: 'price_pro_fixture' },
    usageStore: {
      hasStripeBillingEvent: async () => false,
      findEntitlementByLastStripeEventId: async () => null,
      findEntitlementByStripeSubscriptionId: async () => entitlement('tenant_bound'),
      getEntitlement: async () => {
        reads += 1;
        return reads >= 2
          ? entitlement('tenant_bound', { lastStripeEventId: event.id })
          : entitlement('tenant_bound');
      },
      upsertEntitlementFromStripeEvent: async () => false,
      recordStripeBillingEvent: async () => { recorded += 1; },
    } as any,
    resolveSubscription: async (_id, object) => object,
    reconcileAccountLocks: async () => { reconciliations += 1; },
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.reason, 'entitlement_already_committed');
  assert.equal(reconciliations, 1);
  assert.equal(recorded, 1);
});

test('Stripe retry rejects a tenant binding change after authoritative refresh', async () => {
  let bindingReads = 0;
  let resolverReads = 0;
  let writes = 0;
  await assert.rejects(handleStripeWebhookRequest(stripeRequest(subscriptionEvent()), {
    webhookSecret: STRIPE_SECRET,
    now: STRIPE_NOW,
    priceIds: { plus: 'price_plus_fixture', pro: 'price_pro_fixture' },
    usageStore: {
      hasStripeBillingEvent: async () => false,
      findEntitlementByLastStripeEventId: async () => null,
      findEntitlementByStripeSubscriptionId: async () => {
        bindingReads += 1;
        return bindingReads === 1 ? entitlement('tenant_bound') : null;
      },
      getEntitlement: async () => entitlement('tenant_bound'),
      upsertEntitlementFromStripeEvent: async () => { writes += 1; return false; },
      recordStripeBillingEvent: async () => undefined,
    } as any,
    resolveSubscription: async (_id, object) => {
      resolverReads += 1;
      return resolverReads === 1
        ? object
        : { ...object, metadata: { tenant_id: 'tenant_changed' } };
    },
  }), /tenant changed during reconciliation/i);
  assert.equal(writes, 1);
});

test('delayed Stripe deletion cannot cross the migration sentinel without authoritative reconciliation', async () => {
  const created = Math.floor(STRIPE_NOW / 1000) - 3_600;
  const event = {
    id: 'evt_delayed_deletion_fixture',
    type: 'customer.subscription.deleted',
    created,
    data: { object: {
      id: 'sub_audit_fixture',
      customer: 'cus_audit_fixture',
      status: 'canceled',
      metadata: { tenant_id: 'tenant_bound' },
    } },
  };
  const sentinel = entitlement('tenant_bound', {
    lastStripeEventCreatedAt: STRIPE_NOW,
    lastStripeEventPriority: 100,
    lastStripeEventId: 'migration:0012',
  });
  const attemptedCreatedAt: number[] = [];
  const response = await handleStripeWebhookRequest(stripeRequest(event), {
    webhookSecret: STRIPE_SECRET,
    now: STRIPE_NOW,
    usageStore: {
      hasStripeBillingEvent: async () => false,
      findEntitlementByLastStripeEventId: async () => null,
      findEntitlementByStripeSubscriptionId: async () => sentinel,
      getEntitlement: async () => sentinel,
      upsertEntitlementFromStripeEvent: async (_update: unknown, ordering: { createdAt: number }) => {
        attemptedCreatedAt.push(ordering.createdAt);
        return false;
      },
      recordStripeBillingEvent: async () => undefined,
    } as any,
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.reason, 'out_of_order_stripe_event');
  assert.deepEqual(attemptedCreatedAt, [created * 1000, created * 1000]);
});

function trustedContext(): TenantRequestContext {
  return {
    userId: 'operator_audit',
    oauthClientId: 'client_audit',
    scopes: ['woa:tenant:read', 'woa:account:read', 'woa:account:write'],
    tenants: [{ tenantId: 'tenant_audit', slug: 'tenant-audit', name: 'Audit', role: 'owner', status: 'active' }],
    accounts: [{
      tenantId: 'tenant_audit',
      accountId: 'account_audit',
      slug: 'account-audit',
      name: 'Audit',
      status: 'active',
      isDefault: true,
    }],
    defaultTenantId: 'tenant_audit',
    defaultAccountId: 'account_audit',
    requestId: 'request_audit',
    source: 'test',
  };
}

test('orchestrated account deletion works without the legacy onboarding store dependency', async () => {
  let deleted = false;
  const response = await handleManagementApiRequest(
    new Request('https://worker.example/api/v1/tenants/tenant_audit/accounts/account_audit/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE account_audit' }),
    }),
    {
      trustedContext: trustedContext(),
      createApiClient: async () => { throw new Error('legacy client must not run'); },
      deleteWechatResource: async () => { deleted = true; },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(deleted, true);
});

test('fallback REST credential persistence remains audited when a delegated callback is merely configured', async () => {
  const audits: Array<Record<string, unknown>> = [];
  let delegatedCalls = 0;
  const response = await handleManagementApiRequest(
    new Request('https://worker.example/api/v1/tenants/tenant_audit/accounts/account_audit/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: 'wx1234567890abcdef',
        appSecret: 'fixture-app-secret',
      }),
    }),
    {
      trustedContext: trustedContext(),
      createApiClient: async () => ({
        getAuthManager: () => ({ setConfig: async () => undefined }),
      }) as any,
      persistValidatedWechatCredentials: async () => {
        delegatedCalls += 1;
        throw new Error('must not run without onboarding store');
      },
      auditLog: {
        write: async event => { audits.push(event as unknown as Record<string, unknown>); },
        list: async () => [],
      } as any,
    },
  );
  assert.equal(response.status, 200);
  assert.equal(delegatedCalls, 0);
  assert.equal(audits.some(event => event.action === 'account.credentials_configured'), true);
});

test('delegated MCP credential persistence receives complete security audit metadata', async () => {
  let capturedMetadata: Record<string, unknown> | null = null;
  const tools = createTenantManagementMcpTools({
    onboardingStore: {} as any,
    validateWechatCredentials: async () => ({ accessToken: 'fixture', expiresIn: 7200, expiresAt: STRIPE_NOW }),
    persistValidatedWechatCredentials: async input => {
      capturedMetadata = input.auditMetadata;
      return {
        tenantId: input.account.tenantId,
        accountId: input.account.accountId,
        slug: 'account-audit',
        name: 'Audit',
        appId: input.config.appId,
        status: 'active',
        isDefault: true,
        hasAppSecret: true,
        hasWebhookToken: true,
        hasEncodingAESKey: true,
        createdAt: 1,
        updatedAt: 2,
      };
    },
  });
  const accountTool = tools.find(tool => tool.name === 'woa_account')!;
  const context = trustedContext();
  const result = await accountTool.handler({
    action: 'configure',
    tenantId: 'tenant_audit',
    accountId: 'account_audit',
    appId: 'wx1234567890abcdef',
    appSecret: 'abcdef0123456789abcdef0123456789',
    token: 'fixture-webhook-token',
    encodingAESKey: 'A'.repeat(43),
    __woaContext: context,
  }, {} as any);
  assert.equal(result.isError, undefined);
  assert.deepEqual(capturedMetadata, {
    appId: 'wx1234567890abcdef',
    hasWebhookToken: true,
    hasEncodingAESKey: true,
  });
});

test('audit statement defers default timestamp generation until D1 executes the statement', async () => {
  let insertQuery = '';
  let insertValues: unknown[] = [];
  const db = {
    prepare(query: string) {
      const normalized = query.replace(/\s+/g, ' ').trim();
      return {
        bind(...values: unknown[]) {
          if (normalized.startsWith('INSERT INTO audit_logs')) {
            insertQuery = normalized;
            insertValues = values;
          }
          return this;
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() { return null; },
        async all() {
          if (normalized.startsWith('PRAGMA table_info')) {
            return { results: [{ name: 'occurred_at' }] };
          }
          return { results: [] };
        },
      };
    },
  };
  await new D1AuditLogWriter(db as any).prepareWriteStatement({ action: 'account.delete' });
  assert.match(insertQuery, /COALESCE\(\?,/);
  assert.equal(insertValues.at(-1), null);
});

test('production sources restrict lease self-test and include post-0011 safety migration', () => {
  const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');
  const agentStore = readFileSync(new URL('../src/worker/agent-init-store.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/d1/0012_audit_hardening.sql', import.meta.url), 'utf8');
  assert.match(worker, /credential-lease'[\s\S]+DEBUG_SELF_TEST_TOKEN[\s\S]+x-woa-debug-token/);
  assert.match(worker, /renewCredentialConfigurationLease/);
  assert.match(worker, /expectedCredentialRevision: credentialRevision/);
  assert.match(worker, /operationLeaseId: leaseId/);
  assert.match(agentStore, /Atomic D1 batch support is required for credential handoff failure/);
  assert.match(agentStore, /lease_owner_hash = \? AND lease_expires_at > \?/);
  assert.match(agentStore, /finally \{[\s\S]+releaseRunActionLease/);
  assert.match(migration, /account_operation_guards/);
  assert.match(migration, /credential_revision INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /migration:0012/);
});
