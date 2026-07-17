import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpTool, WechatApiClient } from '../src/mcp-tool/types.js';
import { createTenantManagementMcpTools } from '../src/mcp-tool/tools/tenant-management-tools.js';
import {
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_INIT_SCOPES,
  OAUTH_MCP_DEFAULT_SCOPES,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from '../src/worker/oauth-policy.js';
import {
  handleAgentInitManagementRoute,
  handleCredentialHandoffRequest,
  resolveAgentInitEgressContext,
  testCoverFilename,
  testDraftTitle,
} from '../src/worker/agent-init.js';
import type {
  AgentInitRunRecord,
  D1AgentInitStore,
} from '../src/worker/agent-init-store.js';
import { executeMcpToolWithQuota } from '../src/worker/mcp-quota.js';
import { handleManagementApiRequest } from '../src/worker/management-api.js';
import { AccountAllowanceError, type D1SaasOnboardingStore } from '../src/worker/saas-onboarding-store.js';
import type { D1UsageQuotaStore } from '../src/worker/usage-store.js';
import type { TenantRequestContext } from '../src/worker/tenant-context.js';
import { verifyTurnstile } from '../src/worker/turnstile.js';
import { canUseLegacyGlobalWechatSecrets } from '../src/worker/account-config-policy.js';
import {
  enrichMcpToolParams,
  publicContext,
  requireTenantScope,
} from '../src/worker/tenant-context.js';
import { authMcpTool } from '../src/mcp-tool/tools/auth-tool.js';

const ACCOUNT_A = {
  tenantId: 'ten_a', accountId: 'acct_a', slug: 'acct-a', name: 'Account A', status: 'active' as const, isDefault: true,
};
const ACCOUNT_B = {
  tenantId: 'ten_b', accountId: 'acct_b', slug: 'acct-b', name: 'Account B', status: 'active' as const, isDefault: true,
};

function tenantContext(scopes: string[] = [
  'wechat.mcp',
  'woa:context:read',
  'woa:tenant:read',
  'woa:account:read',
  'woa:account:write',
  'woa:content:read',
  'woa:content:write',
  'woa:security:read',
  'woa:security:write',
]): TenantRequestContext {
  return {
    userId: 'op_test',
    oauthClientId: 'client_test',
    scopes,
    tenants: [
      { tenantId: 'ten_a', slug: 'ten-a', name: 'Tenant A', role: 'owner', status: 'active' },
      { tenantId: 'ten_b', slug: 'ten-b', name: 'Tenant B', role: 'owner', status: 'active' },
    ],
    accounts: [ACCOUNT_A, ACCOUNT_B],
    defaultTenantId: 'ten_a',
    defaultAccountId: 'acct_a',
    requestId: 'req_test',
    source: 'test',
  };
}

function initRun(): AgentInitRunRecord {
  return {
    runId: 'init_12345678',
    operatorId: 'op_test',
    tenantId: 'ten_a',
    accountId: 'acct_a',
    status: 'active',
    phase: 'credentials_verified',
    version: 1,
    egressConfigVersion: 'relay-v1',
    egressConfirmedAt: 1,
    credentialsVerifiedAt: 2,
    relayProbeAt: 2,
    expiresAt: Date.now() + 60_000,
    createdAt: 1,
    updatedAt: 2,
  };
}

function testDraftRequest(): Request {
  return new Request('https://woa.example/api/v1/init/runs/init_12345678/test-draft', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'init-test-key-1234',
    },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
}

test('Turnstile fails closed in production and rejects unsuccessful verification', async () => {
  const request = new Request('https://woa.example/login', {
    headers: { 'cf-connecting-ip': '203.0.113.10' },
  });
  assert.equal((await verifyTurnstile({ production: true, request, token: '' })).ok, false);
  assert.equal((await verifyTurnstile({ production: false, request, token: '' })).ok, true);
  const rejected = await verifyTurnstile({
    production: true,
    secretBinding: 'turnstile-secret',
    request,
    token: 'bad-token',
    fetchImpl: async () => Response.json({ success: false }),
  });
  assert.equal(rejected.ok, false);
});

test('OAuth lifetimes are finite and default/init grants exclude elevated scopes', () => {
  assert.ok(OAUTH_ACCESS_TOKEN_TTL_SECONDS > 0);
  assert.ok(OAUTH_REFRESH_TOKEN_TTL_SECONDS > OAUTH_ACCESS_TOKEN_TTL_SECONDS);
  for (const scope of [
    'woa:content:publish',
    'woa:billing:write',
    'woa:audit:read',
    'woa:tenant:write',
    'woa:security:read',
    'woa:security:write',
  ]) {
    assert.equal(OAUTH_MCP_DEFAULT_SCOPES.includes(scope as never), false);
    assert.equal(OAUTH_INIT_SCOPES.includes(scope as never), false);
  }
});

test('tenant authorization intersects OAuth grants with membership scopes and keeps them private', () => {
  const context = tenantContext([
    'woa:account:read',
    'woa:account:write',
    'woa:billing:write',
  ]);
  context.tenants[0] = {
    ...context.tenants[0],
    membershipScopes: ['woa:account:read'],
  };
  context.tenants[1] = {
    ...context.tenants[1],
    role: 'admin',
    membershipScopes: ['woa:account:read', 'woa:billing:write'],
  };

  assert.doesNotThrow(() => requireTenantScope(context, 'ten_a', 'woa:account:read'));
  assert.throws(
    () => requireTenantScope(context, 'ten_a', 'woa:account:write'),
    (error: any) => error?.code === 'membership_scope_denied' && error?.status === 403,
  );
  assert.throws(
    () => requireTenantScope(context, 'ten_b', 'woa:billing:write'),
    (error: any) => error?.code === 'membership_scope_denied' && error?.status === 403,
  );

  const visible = publicContext(context);
  assert.equal(JSON.stringify(visible).includes('membershipScopes'), false);
});

test('unconfigured tenant accounts fail closed and cannot inherit global legacy credentials', () => {
  assert.equal(canUseLegacyGlobalWechatSecrets({
    tenantId: 'tenant_default',
    accountId: 'acct_default',
  }), true);
  assert.equal(canUseLegacyGlobalWechatSecrets({
    tenantId: 'ten_customer',
    accountId: 'acct_customer',
  }), false);

  const context = tenantContext();
  context.accounts[0] = { ...context.accounts[0], status: 'unconfigured' };
  assert.throws(
    () => enrichMcpToolParams({ accountId: 'acct_a' }, context, 'wechat_draft'),
    (error: any) => error?.code === 'account_unconfigured' && error?.status === 409,
  );
  assert.doesNotThrow(() => enrichMcpToolParams({ accountId: 'acct_a', action: 'status' }, context, 'woa_account'));
});

test('plan-locked accounts fail before API or quota execution', async () => {
  const context = tenantContext();
  context.accounts[0] = { ...context.accounts[0], status: 'locked' };
  let apiResolved = false;
  let quotaRead = false;
  await assert.rejects(
    () => executeMcpToolWithQuota({
      tool: {
        name: 'wechat_draft',
        description: 'locked account probe',
        inputSchema: {},
        handler: async () => ({ content: [{ type: 'text', text: 'unexpected' }] }),
      },
      params: { action: 'count', accountId: 'acct_a' },
      tenantContext: context,
      usageStore: {
        getEntitlement: async () => {
          quotaRead = true;
          return { tenantId: 'ten_a', plan: 'free', status: 'active', limitOverrides: null };
        },
      } as unknown as D1UsageQuotaStore,
      resolveApiClient: async () => {
        apiResolved = true;
        return {} as WechatApiClient;
      },
    }),
    (error: any) => error?.code === 'account_plan_locked' && error?.status === 423,
  );
  assert.equal(apiResolved, false);
  assert.equal(quotaRead, false);
});

test('wechat_auth configuration responses never echo webhook secrets', async () => {
  const secretConfig = {
    appId: 'wx1234567890abcdef',
    appSecret: 'abcdef0123456789abcdef0123456789',
    token: 'webhook-token-value',
    encodingAESKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  };
  let current = secretConfig;
  const apiClient = {
    getAuthManager: () => ({
      setConfig: async (config: typeof secretConfig) => { current = config; },
      getConfig: async () => current,
    }),
  } as unknown as WechatApiClient;
  const configured = await authMcpTool.handler({ action: 'configure', ...secretConfig }, apiClient);
  const read = await authMcpTool.handler({ action: 'get_config' }, apiClient);
  const responseText = `${configured.content[0]?.text ?? ''}\n${read.content[0]?.text ?? ''}`;
  assert.doesNotMatch(responseText, /webhook-token-value/);
  assert.doesNotMatch(responseText, /abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/);
  assert.doesNotMatch(responseText, /abcdef0123456789abcdef0123456789/);
  assert.match(responseText, /Token: 已设置/);
  assert.match(responseText, /EncodingAESKey: 已设置/);
});

test('init context accepts only controlled public IP metadata', () => {
  assert.deepEqual(resolveAgentInitEgressContext({
    ips: '101.34.57.185, 10.0.0.1',
    configVersion: 'relay-v1',
    updatedAt: '2026-07-17T00:00:00+08:00',
  }), {
    ips: ['101.34.57.185'],
    configVersion: 'relay-v1',
    updatedAt: '2026-07-16T16:00:00.000Z',
  });
  assert.equal(resolveAgentInitEgressContext({ ips: '10.0.0.1', configVersion: 'v1', updatedAt: 'bad' }), null);
});

test('agent init rejects an oversized unknown-length stream before touching D1', async () => {
  let storeCalls = 0;
  const body = new Uint8Array(20 * 1024).fill(0x61);
  const request = new Request('https://woa.example/api/v1/init/runs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'oversized-init-body',
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body.subarray(0, 10 * 1024));
        controller.enqueue(body.subarray(10 * 1024));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await assert.rejects(
    () => handleAgentInitManagementRoute(request, ['init', 'runs'], tenantContext(), {
      store: {
        createOrGetRun: async () => {
          storeCalls += 1;
          throw new Error('must not reach D1');
        },
      } as unknown as D1AgentInitStore,
      egress: { ips: ['101.34.57.185'], configVersion: 'relay-v1', updatedAt: new Date().toISOString() },
    }),
    (error: any) => error?.code === 'request_too_large' && error?.status === 413,
  );
  assert.equal(storeCalls, 0);
});

test('credential URL token is exchanged once and redirected to a clean no-store URL', async () => {
  let claimedOperator = '';
  const store = {
    claimCredentialHandoff: async ({ operatorId }: { operatorId: string }) => {
      claimedOperator = operatorId;
      return {
        cookieToken: 'b'.repeat(64),
        handoff: {
          handoffId: 'handoff_1', runId: 'init_1', operatorId, tenantId: 'ten_a', accountId: 'acct_a',
          status: 'claimed', expiresAt: Date.now() + 60_000, createdAt: 1, updatedAt: 1,
        },
      };
    },
  } as unknown as D1AgentInitStore;
  const response = await handleCredentialHandoffRequest(
    new Request(`https://woa.example/init/credentials?handoff=${'a'.repeat(64)}`),
    {
      store,
      operatorId: 'op_test',
      egress: { ips: ['101.34.57.185'], configVersion: 'relay-v1', updatedAt: new Date().toISOString() },
      validateAndPersist: async () => ({ accessToken: 'unused', expiresIn: 7200, expiresAt: Date.now() + 7200_000 }),
    },
  );
  assert.equal(response.status, 303);
  assert.equal(claimedOperator, 'op_test');
  assert.equal(response.headers.get('location'), 'https://woa.example/init/credentials');
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly; SameSite=Strict/);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('test-draft retries reuse cover/draft media IDs and always read back without publish', async () => {
  let run = initRun();
  const completed = new Map<string, string>();
  let coverUploads = 0;
  let draftCreates = 0;
  let reads = 0;
  const store = {
    getRun: async () => run,
    acquireRunActionLease: async () => run,
    releaseRunActionLease: async () => true,
    reserveIdempotency: async ({ toolName }: { toolName: string }) => ({
      acquired: !completed.has(toolName),
      record: {
        tenantId: 'ten_a', accountId: 'acct_a', toolName, runId: run.runId,
        status: completed.has(toolName) ? 'completed' : 'pending',
        resultRef: completed.get(toolName) ?? null,
        expiresAt: run.expiresAt,
      },
    }),
    completeIdempotency: async ({ toolName, resultRef }: { toolName: string; resultRef: string }) => {
      completed.set(toolName, resultRef);
      return true;
    },
    failIdempotency: async () => undefined,
    recordTestDraftResult: async (input: { coverChecksum: string; coverMediaId: string; draftMediaId: string }) => {
      run = {
        ...run,
        phase: 'test_draft_verified',
        version: 2,
        testAssetChecksum: input.coverChecksum,
        testAssetMediaId: input.coverMediaId,
        testDraftMediaId: input.draftMediaId,
      };
      return run;
    },
  } as unknown as D1AgentInitStore;
  const deps = {
    store,
    egress: { ips: ['101.34.57.185'], configVersion: 'relay-v1', updatedAt: new Date().toISOString() },
    testCoverChecksum: 'cover-sha',
    findTestCover: async () => null,
    uploadTestCover: async () => {
      coverUploads += 1;
      return { mediaId: 'cover_media_1', checksum: 'cover-sha' };
    },
    findTestDraft: async () => null,
    createTestDraft: async () => {
      draftCreates += 1;
      return { mediaId: 'draft_media_1', title: testDraftTitle(run.runId) };
    },
    readTestDraft: async ({ mediaId, expectedTitle }: { mediaId: string; expectedTitle: string }) => {
      reads += 1;
      return { mediaId, title: expectedTitle, articleCount: 1, readBack: true as const };
    },
  };

  const first = await handleAgentInitManagementRoute(testDraftRequest(), ['init', 'runs', run.runId, 'test-draft'], tenantContext(), deps);
  assert.equal(first?.status, 201);
  assert.equal((await first?.json() as any).data.draft.published, false);
  const second = await handleAgentInitManagementRoute(testDraftRequest(), ['init', 'runs', run.runId, 'test-draft'], tenantContext(), deps);
  const secondBody = await second?.json() as any;
  assert.equal(second?.status, 200);
  assert.equal(secondBody.data.reused, true);
  assert.equal(secondBody.data.draft.mediaId, 'draft_media_1');
  assert.equal(coverUploads, 1);
  assert.equal(draftCreates, 1);
  assert.equal(reads, 2);
});

test('crash-window recovery reconciles deterministic remote cover/title before creating again', async () => {
  let run = initRun();
  const completed = new Map<string, string>();
  const failCompletionOnce = new Set([
    'wechat_permanent_media:test_cover',
    'wechat_draft:add_unpublished_test',
  ]);
  let remoteCover: string | null = null;
  let remoteDraft: string | null = null;
  let coverUploads = 0;
  let draftCreates = 0;
  const store = {
    getRun: async () => run,
    acquireRunActionLease: async () => run,
    releaseRunActionLease: async () => true,
    reserveIdempotency: async ({ toolName }: { toolName: string }) => ({
      acquired: !completed.has(toolName),
      record: {
        tenantId: 'ten_a', accountId: 'acct_a', toolName, runId: run.runId,
        status: completed.has(toolName) ? 'completed' : 'pending',
        resultRef: completed.get(toolName) ?? null,
        expiresAt: run.expiresAt,
      },
    }),
    completeIdempotency: async ({ toolName, resultRef }: { toolName: string; resultRef: string }) => {
      if (failCompletionOnce.delete(toolName)) throw new Error('simulated D1 loss after remote success');
      completed.set(toolName, resultRef);
      return true;
    },
    failIdempotency: async () => undefined,
    recordTestDraftResult: async (input: { coverChecksum: string; coverMediaId: string; draftMediaId: string }) => {
      run = {
        ...run,
        version: 2,
        phase: 'test_draft_verified',
        testAssetChecksum: input.coverChecksum,
        testAssetMediaId: input.coverMediaId,
        testDraftMediaId: input.draftMediaId,
      };
      return run;
    },
  } as unknown as D1AgentInitStore;
  const deps = {
    store,
    egress: { ips: ['101.34.57.185'], configVersion: 'relay-v1', updatedAt: new Date().toISOString() },
    testCoverChecksum: 'cover-sha',
    findTestCover: async () => remoteCover ? { mediaId: remoteCover, checksum: 'cover-sha' } : null,
    uploadTestCover: async () => {
      coverUploads += 1;
      remoteCover = 'cover_remote_1';
      return { mediaId: remoteCover, checksum: 'cover-sha' };
    },
    findTestDraft: async () => remoteDraft ? { mediaId: remoteDraft, title: testDraftTitle(run.runId) } : null,
    createTestDraft: async () => {
      draftCreates += 1;
      remoteDraft = 'draft_remote_1';
      return { mediaId: remoteDraft, title: testDraftTitle(run.runId) };
    },
    readTestDraft: async ({ mediaId, expectedTitle }: { mediaId: string; expectedTitle: string }) => ({
      mediaId, title: expectedTitle, articleCount: 1, readBack: true as const,
    }),
  };

  await assert.rejects(() => handleAgentInitManagementRoute(
    testDraftRequest(), ['init', 'runs', run.runId, 'test-draft'], tenantContext(), deps,
  ));
  await assert.rejects(() => handleAgentInitManagementRoute(
    testDraftRequest(), ['init', 'runs', run.runId, 'test-draft'], tenantContext(), deps,
  ));
  const recovered = await handleAgentInitManagementRoute(
    testDraftRequest(), ['init', 'runs', run.runId, 'test-draft'], tenantContext(), deps,
  );
  assert.equal(recovered?.status, 200);
  assert.equal((await recovered?.json() as any).data.draft.mediaId, 'draft_remote_1');
  assert.equal(coverUploads, 1);
  assert.equal(draftCreates, 1);
  assert.equal(testCoverFilename(run.runId), 'woa-init-cover-12345678.bmp');
});

test('MCP resolves an account-scoped API client for the explicitly authorized tenant/account', async () => {
  let resolvedAccount = '';
  const tool: McpTool = {
    name: 'wechat_account_probe',
    description: 'test',
    inputSchema: {},
    handler: async (_params, apiClient) => ({
      content: [{ type: 'text', text: (apiClient as unknown as { marker: string }).marker }],
    }),
  };
  const usageStore = {
    getEntitlement: async () => ({ tenantId: 'ten_b', plan: 'free', status: 'active', limitOverrides: null }),
    reserveCounters: async () => [],
    recordUsageEvent: async () => undefined,
    refundCounters: async () => undefined,
  } as unknown as D1UsageQuotaStore;
  const result = await executeMcpToolWithQuota({
    tool,
    params: { tenantId: 'ten_b', accountId: 'acct_b' },
    tenantContext: tenantContext(),
    usageStore,
    resolveApiClient: async account => {
      resolvedAccount = `${account.tenantId}/${account.accountId}`;
      return { marker: resolvedAccount } as unknown as WechatApiClient;
    },
  });
  assert.equal(resolvedAccount, 'ten_b/acct_b');
  assert.equal(result.content[0]?.text, 'ten_b/acct_b');
  assert.equal((result._meta as any).accountId, 'acct_b');
});

test('default minimal MCP grant keeps publish tools visible but denies execution before API/quota work', async () => {
  let apiResolved = false;
  let handlerCalled = false;
  let quotaRead = false;
  const tool: McpTool = {
    name: 'wechat_publish',
    description: 'visible publish tool',
    inputSchema: {},
    handler: async () => {
      handlerCalled = true;
      return { content: [{ type: 'text', text: 'unexpected' }] };
    },
  };
  const context = tenantContext([...OAUTH_MCP_DEFAULT_SCOPES]);
  const usageStore = {
    getEntitlement: async () => {
      quotaRead = true;
      return { tenantId: 'ten_a', plan: 'free', status: 'active', limitOverrides: null };
    },
  } as unknown as D1UsageQuotaStore;
  await assert.rejects(
    () => executeMcpToolWithQuota({
      tool,
      params: { action: 'submit', tenantId: 'ten_a', accountId: 'acct_a' },
      tenantContext: context,
      usageStore,
      resolveApiClient: async () => {
        apiResolved = true;
        return {} as WechatApiClient;
      },
    }),
    (error: any) => error?.code === 'missing_scope' && error?.details?.scope === 'woa:content:publish',
  );
  assert.equal(apiResolved, false);
  assert.equal(handlerCalled, false);
  assert.equal(quotaRead, false);
});

test('MCP management covers context/status/allowance/delete confirmation and exposes no checkout action', async () => {
  const context = tenantContext();
  const resource = {
    ...ACCOUNT_A,
    appId: 'wx0000000000000000',
    hasAppSecret: true,
    hasWebhookToken: false,
    hasEncodingAESKey: false,
    createdAt: 1,
    updatedAt: 2,
  };
  const store = {
    findOperatorById: async () => null,
    getWechatResource: async () => resource,
    createWechatResource: async () => {
      throw new AccountAllowanceError({
        code: 'account_allowance_exceeded',
        tenantId: 'ten_a', plan: 'free', limit: 1, used: 1, remaining: 0,
        upgrade: { webUrl: 'https://woa.example/billing', cliCommand: 'woa billing checkout --plan plus', guidance: 'upgrade' },
      });
    },
    softDeleteWechatResource: async () => {
      throw new Error('Resource deletion requires confirmation marker: DELETE acct_a');
    },
  } as unknown as D1SaasOnboardingStore;
  const tools = createTenantManagementMcpTools({ onboardingStore: store });
  const contextTool = tools.find(tool => tool.name === 'woa_context')!;
  const accountTool = tools.find(tool => tool.name === 'woa_account')!;
  const accountContext = { tenantId: 'ten_a', accountId: 'acct_a', account: ACCOUNT_A };
  const hidden = { __woaContext: context, __woaAccountContext: accountContext };
  const contextResult = await contextTool.handler({ accountId: 'acct_a', ...hidden }, {} as WechatApiClient);
  assert.doesNotMatch(contextResult.content[0]?.text ?? '', /appSecret|access_token/);
  const status = await accountTool.handler({ action: 'status', accountId: 'acct_a', ...hidden }, {} as WechatApiClient);
  assert.match(status.content[0]?.text ?? '', /"configured": true/);
  const allowance = await accountTool.handler({ action: 'create', tenantId: 'ten_a', ...hidden }, {} as WechatApiClient);
  assert.equal((allowance._meta as any).error.code, 'account_allowance_exceeded');
  const deletion = await accountTool.handler({ action: 'delete', accountId: 'acct_a', ...hidden }, {} as WechatApiClient);
  assert.equal((deletion._meta as any).error.code, 'confirmation_required');
  assert.equal((accountTool.inputSchema.action as any).safeParse('checkout').success, false);
});

test('OAuth session revocation calls Provider revokeGrant before reporting success', async () => {
  let revoked = '';
  let d1FallbackCalled = false;
  const response = await handleManagementApiRequest(
    new Request('https://woa.example/api/v1/sessions/grant_123', { method: 'DELETE' }),
    {
      trustedContext: tenantContext(),
      onboardingStore: {
        revokeSecuritySession: async () => {
          d1FallbackCalled = true;
          return { revoked: false };
        },
      } as unknown as D1SaasOnboardingStore,
      revokeOAuthGrant: async (grantId, operatorId) => {
        revoked = `${operatorId}/${grantId}`;
        return true;
      },
      createApiClient: async () => ({} as WechatApiClient),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(revoked, 'op_test/grant_123');
  assert.equal(d1FallbackCalled, false);
  assert.equal((await response.json() as any).data.kind, 'oauth');
});

test('OAuth clients need explicit security scopes to list or revoke Operator sessions', async () => {
  const lowPrivilege = tenantContext(['woa:context:read']);
  let listCalled = false;
  let revokeCalled = false;
  const common = {
    trustedContext: lowPrivilege,
    onboardingStore: {
      listSecuritySessions: async () => {
        listCalled = true;
        return [];
      },
      revokeSecuritySession: async () => {
        revokeCalled = true;
        return { revoked: false };
      },
    } as unknown as D1SaasOnboardingStore,
    revokeOAuthGrant: async () => {
      revokeCalled = true;
      return true;
    },
    createApiClient: async () => ({} as WechatApiClient),
  };
  const listed = await handleManagementApiRequest(
    new Request('https://woa.example/api/v1/sessions'),
    common,
  );
  const revoked = await handleManagementApiRequest(
    new Request('https://woa.example/api/v1/sessions/grant_123', { method: 'DELETE' }),
    common,
  );
  assert.equal(listed.status, 403);
  assert.equal(revoked.status, 403);
  assert.equal((await listed.json() as any).error.code, 'missing_scope');
  assert.equal((await revoked.json() as any).error.code, 'missing_scope');
  assert.equal(listCalled, false);
  assert.equal(revokeCalled, false);
});
