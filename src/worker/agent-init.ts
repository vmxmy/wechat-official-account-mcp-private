import type { AccessTokenInfo, WechatConfig } from '../mcp-tool/types.js';
import {
  ApiError,
  requireConfigurableAccount,
  requireOperationalAccount,
  requireScope,
  requireTenantScope,
  resolveAccountContext,
  type AccountContext,
  type TenantRequestContext,
} from './tenant-context.js';
import {
  AGENT_CREDENTIAL_HANDOFF_TTL_MS,
  AgentInitStateError,
  D1AgentInitStore,
  publicAgentInitRun,
  publicCredentialHandoff,
  type AgentCredentialHandoffRecord,
} from './agent-init-store.js';
import { OAUTH_INIT_SCOPES } from './oauth-policy.js';

export interface AgentInitEgressContext {
  ips: string[];
  configVersion: string;
  updatedAt: string;
}

export type WechatCredentialProbeErrorCode =
  | 'wechat_egress_ip_unavailable'
  | 'wechat_ip_not_allowlisted'
  | 'wechat_relay_unavailable'
  | 'wechat_credentials_rejected'
  | 'oauth_revoked'
  | 'membership_scope_denied'
  | 'account_plan_locked'
  | 'credential_configuration_busy';

export class WechatCredentialProbeError extends Error {
  constructor(
    public readonly code: WechatCredentialProbeErrorCode,
    message: string,
    public readonly status: number,
    public readonly wechatErrorCode?: number,
  ) {
    super(message);
    this.name = 'WechatCredentialProbeError';
  }
}

export interface AgentInitManagementDeps {
  store: D1AgentInitStore;
  egress: AgentInitEgressContext | null;
  testCoverChecksum?: string;
  uploadTestCover?(input: {
    runId: string;
    account: AccountContext;
  }): Promise<{ mediaId: string; checksum: string }>;
  findTestCover?(input: {
    runId: string;
    account: AccountContext;
  }): Promise<{ mediaId: string; checksum: string } | null>;
  createTestDraft?(input: {
    runId: string;
    account: AccountContext;
    coverMediaId: string;
  }): Promise<{ mediaId: string; title: string }>;
  findTestDraft?(input: {
    runId: string;
    account: AccountContext;
  }): Promise<{ mediaId: string; title: string } | null>;
  readTestDraft?(input: {
    account: AccountContext;
    mediaId: string;
    expectedTitle: string;
  }): Promise<{ mediaId: string; title: string; articleCount: number; readBack: true }>;
}

export interface CredentialHandoffDeps {
  store: D1AgentInitStore;
  operatorId?: string | null;
  egress: AgentInitEgressContext | null;
  assertAuthority?(handoff: AgentCredentialHandoffRecord): Promise<void>;
  validatePersistAndComplete(input: {
    handoff: AgentCredentialHandoffRecord;
    config: WechatConfig;
    complete(): Promise<void>;
  }): Promise<AccessTokenInfo>;
}

export async function persistCredentialConfigurationWithAudit<T>(deps: {
  writeStartedAudit(): Promise<void>;
  persist(): Promise<T>;
  writeSucceededAudit(): Promise<void>;
  finalize?(): Promise<void>;
  rollback(): Promise<void>;
  writeRollbackAudit?(): Promise<void>;
}): Promise<T> {
  // Establish an audit record before any credential mutation. If the success
  // audit fails after persistence, restore the prior credential/token state so
  // the caller never observes an unaudited successful configuration.
  await deps.writeStartedAudit();
  try {
    const result = await deps.persist();
    await deps.writeSucceededAudit();
    await deps.finalize?.();
    return result;
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    let rollbackSucceeded = false;
    try {
      await deps.rollback();
      rollbackSucceeded = true;
    } catch (rollbackError) {
      rollbackFailures.push(rollbackError);
    }
    if (rollbackSucceeded) {
      try {
        await deps.writeRollbackAudit?.();
      } catch (rollbackAuditError) {
        rollbackFailures.push(rollbackAuditError);
      }
    }
    if (rollbackFailures.length > 0) {
      const combined = new Error('Credential configuration failed and rollback did not complete cleanly.');
      (combined as Error & { causes?: unknown[] }).causes = [error, ...rollbackFailures];
      throw combined;
    }
    throw error;
  }
}

export async function deleteWechatResourceWithAudit(deps: {
  writeStartedAudit(): Promise<void>;
  clearToken(): Promise<void>;
  deleteWithSucceededAudit(): Promise<void>;
  restoreToken(): Promise<void>;
}): Promise<void> {
  await deps.writeStartedAudit();
  try {
    await deps.clearToken();
    await deps.deleteWithSucceededAudit();
  } catch (error) {
    try {
      await deps.restoreToken();
    } catch (rollbackError) {
      const combined = new Error('WeChat resource deletion failed and token rollback did not complete.');
      (combined as Error & { causes?: unknown[] }).causes = [error, rollbackError];
      throw combined;
    }
    throw error;
  }
}

export async function releaseCredentialOperationLeaseBestEffort(
  release: () => Promise<void>,
  onFailure?: (error: unknown) => void,
): Promise<void> {
  try {
    await release();
  } catch (error) {
    // Lease cleanup is non-authoritative and the TokenOwner lease expires on its
    // own. Never turn an already committed credential/delete operation into a
    // reported failure because cleanup RPC delivery was interrupted.
    try {
      onFailure?.(error);
    } catch {
      // Logging/monitoring must not reintroduce a post-commit throw.
    }
  }
}

const CREDENTIAL_HANDOFF_COOKIE = 'woa_credential_handoff';
const MAX_INIT_JSON_BYTES = 16 * 1024;
const MAX_CREDENTIAL_FORM_BYTES = 8 * 1024;

export function resolveAgentInitEgressContext(input: {
  ips?: string | null;
  configVersion?: string | null;
  updatedAt?: string | null;
}): AgentInitEgressContext | null {
  const ips = (input.ips ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(isPublicIpLiteral);
  const configVersion = input.configVersion?.trim() ?? '';
  const updatedAtMs = Date.parse(input.updatedAt?.trim() ?? '');
  if (ips.length === 0 || !configVersion || !Number.isFinite(updatedAtMs)) return null;
  return {
    ips: [...new Set(ips)],
    configVersion,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

export function wechatCredentialProbeErrorForResponse(input: {
  errcode?: number;
  httpStatus?: number;
}): WechatCredentialProbeError {
  if (input.errcode === 40164) {
    return new WechatCredentialProbeError(
      'wechat_ip_not_allowlisted',
      'The controlled WeChat egress IP is not allowlisted for this Official Account.',
      409,
      input.errcode,
    );
  }
  if (typeof input.errcode === 'number' && input.errcode !== 0) {
    return new WechatCredentialProbeError(
      'wechat_credentials_rejected',
      'WeChat rejected the AppID or AppSecret.',
      400,
      input.errcode,
    );
  }
  return new WechatCredentialProbeError(
    'wechat_relay_unavailable',
    'The controlled WeChat relay is temporarily unavailable.',
    503,
    input.errcode,
  );
}

export async function handleAgentInitManagementRoute(
  request: Request,
  segments: string[],
  context: TenantRequestContext,
  deps: AgentInitManagementDeps | undefined,
): Promise<Response | null> {
  if (segments[0] !== 'init') return null;
  if (!deps) {
    throw new ApiError('runtime_unavailable', 'Agent initialization is not configured in this runtime.', 503);
  }

  try {
    requireScope(context, 'woa:context:read');

    if (request.method === 'GET' && segments.length === 2 && segments[1] === 'context') {
      requireScope(context, 'woa:account:read');
      const egress = requireEgressContext(deps.egress);
      return initJson({
        success: true,
        data: {
          egress,
          oauth: {
            requiredScopes: [...OAUTH_INIT_SCOPES],
            elevatedScopesAreOptional: true,
          },
          credentialHandoff: {
            browserOnly: true,
            singleUse: true,
            ttlSeconds: Math.floor(AGENT_CREDENTIAL_HANDOFF_TTL_MS / 1000),
          },
        },
        requestId: context.requestId,
      });
    }

    if (request.method === 'POST' && segments.length === 2 && segments[1] === 'runs') {
      requireScope(context, 'woa:account:read');
      requireScope(context, 'woa:account:write');
      const egress = requireEgressContext(deps.egress);
      const body = await readBoundedJson(request, MAX_INIT_JSON_BYTES);
      const account = resolveAccountContext({
        tenantId: stringValue(body.tenantId),
        accountId: stringValue(body.accountId),
      }, context, { requireAccount: true });
      if (!account) throw new ApiError('account_required', 'An accessible WeChat account is required.', 403);
      requireConfigurableAccount(account);
      requireTenantScope(context, account.tenantId, 'woa:account:read');
      requireTenantScope(context, account.tenantId, 'woa:account:write');
      const idempotencyKey = requireIdempotencyKey(request);
      const result = await deps.store.createOrGetRun({
        operatorId: context.userId,
        tenantId: account.tenantId,
        accountId: account.accountId,
        oauthClientId: context.oauthClientId,
        idempotencyKey,
        egressConfigVersion: egress.configVersion,
      });
      return initJson({
        success: true,
        data: { run: publicAgentInitRun(result.run), created: result.created },
        requestId: context.requestId,
      }, { status: result.created ? 201 : 200 });
    }

    if (segments.length >= 3 && segments[1] === 'runs') {
      requireScope(context, 'woa:account:read');
      const runId = decodePathSegment(segments[2], 'runId');

      if (request.method === 'GET' && segments.length === 3) {
        const run = await deps.store.getRun(context.userId, runId);
        if (!run) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
        assertRunAccountAccessible(run.tenantId, run.accountId, context);
        requireTenantScope(context, run.tenantId, 'woa:account:read');
        return initJson({ success: true, data: { run: publicAgentInitRun(run) }, requestId: context.requestId });
      }

      if (request.method === 'POST' && segments.length === 4 && segments[3] === 'egress-confirmation') {
        requireScope(context, 'woa:account:write');
        const egress = requireEgressContext(deps.egress);
        const body = await readBoundedJson(request, MAX_INIT_JSON_BYTES);
        if (body.confirmed !== true) {
          throw new ApiError('validation_error', 'confirmed must be true.', 400, { field: 'confirmed' });
        }
        const expectedVersion = requireExpectedVersion(body.expectedVersion);
        const suppliedVersion = stringValue(body.egressConfigVersion);
        if (suppliedVersion !== egress.configVersion) {
          throw new ApiError('init_run_conflict', 'The controlled egress configuration changed; reload init context.', 409, {
            currentEgressConfigVersion: egress.configVersion,
          });
        }
        const existing = await deps.store.getRun(context.userId, runId);
        if (!existing) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
        assertRunAccountAccessible(existing.tenantId, existing.accountId, context);
        requireTenantScope(context, existing.tenantId, 'woa:account:write');
        const run = await deps.store.confirmEgress({
          operatorId: context.userId,
          runId,
          expectedVersion,
          egressConfigVersion: egress.configVersion,
        });
        return initJson({ success: true, data: { run: publicAgentInitRun(run) }, requestId: context.requestId });
      }

      if (request.method === 'POST' && segments.length === 4 && segments[3] === 'credential-handoffs') {
        requireScope(context, 'woa:account:write');
        requireEgressContext(deps.egress);
        const body = await readBoundedJson(request, MAX_INIT_JSON_BYTES);
        const expectedVersion = requireExpectedVersion(body.expectedVersion);
        const existing = await deps.store.getRun(context.userId, runId);
        if (!existing) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
        assertRunAccountAccessible(existing.tenantId, existing.accountId, context);
        requireTenantScope(context, existing.tenantId, 'woa:account:write');
        const result = await deps.store.createCredentialHandoff({
          operatorId: context.userId,
          runId,
          expectedVersion,
        });
        const handoffUrl = new URL('/init/credentials', request.url);
        handoffUrl.searchParams.set('handoff', result.urlToken);
        return initJson({
          success: true,
          data: {
            run: publicAgentInitRun(result.run),
            handoff: publicCredentialHandoff(result.handoff),
            handoffUrl: handoffUrl.toString(),
          },
          requestId: context.requestId,
        }, { status: 201 });
      }

      if (request.method === 'POST' && segments.length === 4 && segments[3] === 'test-draft') {
        requireScope(context, 'woa:content:read');
        requireScope(context, 'woa:content:write');
        if (
          !deps.findTestCover ||
          !deps.uploadTestCover ||
          !deps.findTestDraft ||
          !deps.createTestDraft ||
          !deps.readTestDraft
        ) {
          throw new ApiError('runtime_unavailable', 'The initialization test-draft workflow is unavailable.', 503);
        }
        const body = await readBoundedJson(request, MAX_INIT_JSON_BYTES);
        const expectedVersion = requireExpectedVersion(body.expectedVersion);
        // Header is still mandatory for replay diagnostics, but the side-effect identity is
        // server-derived from runId so a caller cannot create duplicates by changing the header.
        requireIdempotencyKey(request);
        const run = await deps.store.getRun(context.userId, runId);
        if (!run) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
        requireTenantScope(context, run.tenantId, 'woa:content:read');
        requireTenantScope(context, run.tenantId, 'woa:content:write');
        const account = resolveAccountContext({
          tenantId: run.tenantId,
          accountId: run.accountId,
        }, context, { requireAccount: true });
        if (!account) throw new ApiError('account_required', 'An accessible WeChat account is required.', 403);
        requireOperationalAccount(account);
        if (!run.credentialsVerifiedAt) {
          throw new ApiError(
            'wechat_credentials_required',
            'WeChat credentials must be verified before creating the test draft.',
            409,
          );
        }

        const expectedTitle = testDraftTitle(runId);
        if (run.testDraftMediaId && run.testAssetMediaId) {
          const readBack = await deps.readTestDraft({
            account,
            mediaId: run.testDraftMediaId,
            expectedTitle,
          });
          return initJson({
            success: true,
            data: {
              run: publicAgentInitRun(run),
              cover: {
                mediaId: run.testAssetMediaId,
                checksum: run.testAssetChecksum ?? deps.testCoverChecksum ?? '',
                created: false,
              },
              draft: { ...readBack, created: false, published: false },
              reused: true,
            },
            requestId: context.requestId,
          });
        }

        const leaseOwner = `test-draft:${crypto.randomUUID()}`;
        await deps.store.acquireRunActionLease({
          operatorId: context.userId,
          runId,
          expectedVersion,
          leaseOwner,
        });
        try {
        const actionKey = `woa-init:${runId}`;
        const coverKey = `${actionKey}:cover`;
        const coverReservation = await deps.store.reserveIdempotency({
          operatorId: context.userId,
          tenantId: run.tenantId,
          accountId: run.accountId,
          toolName: 'wechat_permanent_media:test_cover',
          idempotencyKey: coverKey,
          runId,
          leaseOwner,
        });
        let coverMediaId = coverReservation.record.resultRef ?? '';
        let coverChecksum = run.testAssetChecksum ?? deps.testCoverChecksum ?? '';
        let coverCreated = false;
        if (!coverMediaId) {
          if (!coverReservation.acquired) {
            throw new ApiError('init_run_conflict', 'The test cover is already being created; retry this run.', 409);
          }
          try {
            const recovered = await deps.findTestCover({ runId, account });
            const uploaded = recovered ?? await deps.uploadTestCover({ runId, account });
            coverMediaId = uploaded.mediaId;
            coverChecksum = uploaded.checksum;
            const recorded = await deps.store.completeIdempotency({
              tenantId: run.tenantId,
              accountId: run.accountId,
              toolName: 'wechat_permanent_media:test_cover',
              idempotencyKey: coverKey,
              leaseOwner,
              resultRef: coverMediaId,
            });
            if (!recorded) throw new ApiError('init_run_conflict', 'The test-cover lease expired before completion.', 409);
            coverCreated = !recovered;
          } catch (error) {
            await deps.store.failIdempotency({
              tenantId: run.tenantId,
              accountId: run.accountId,
              toolName: 'wechat_permanent_media:test_cover',
              idempotencyKey: coverKey,
              leaseOwner,
            });
            throw safeTestDraftError(error);
          }
        }

        const draftKey = `${actionKey}:draft`;
        const draftReservation = await deps.store.reserveIdempotency({
          operatorId: context.userId,
          tenantId: run.tenantId,
          accountId: run.accountId,
          toolName: 'wechat_draft:add_unpublished_test',
          idempotencyKey: draftKey,
          runId,
          leaseOwner,
        });
        let draftMediaId = draftReservation.record.resultRef ?? '';
        let draftCreated = false;
        if (!draftMediaId) {
          if (!draftReservation.acquired) {
            throw new ApiError('init_run_conflict', 'The test draft is already being created; retry this run.', 409);
          }
          try {
            const recovered = await deps.findTestDraft({ runId, account });
            const created = recovered ?? await deps.createTestDraft({ runId, account, coverMediaId });
            if (created.title !== expectedTitle) {
              throw new Error('Unexpected test-draft title returned by runtime.');
            }
            draftMediaId = created.mediaId;
            const recorded = await deps.store.completeIdempotency({
              tenantId: run.tenantId,
              accountId: run.accountId,
              toolName: 'wechat_draft:add_unpublished_test',
              idempotencyKey: draftKey,
              leaseOwner,
              resultRef: draftMediaId,
            });
            if (!recorded) throw new ApiError('init_run_conflict', 'The test-draft lease expired before completion.', 409);
            draftCreated = !recovered;
          } catch (error) {
            await deps.store.failIdempotency({
              tenantId: run.tenantId,
              accountId: run.accountId,
              toolName: 'wechat_draft:add_unpublished_test',
              idempotencyKey: draftKey,
              leaseOwner,
            });
            throw safeTestDraftError(error);
          }
        }

        let readBack: { mediaId: string; title: string; articleCount: number; readBack: true };
        try {
          readBack = await deps.readTestDraft({
            account,
            mediaId: draftMediaId,
            expectedTitle,
          });
        } catch (error) {
          throw safeTestDraftError(error);
        }

        const currentRun = await deps.store.getRun(context.userId, runId);
        if (!currentRun) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
        const updatedRun = currentRun.testDraftMediaId === draftMediaId && currentRun.testAssetMediaId === coverMediaId
          ? currentRun
          : await deps.store.recordTestDraftResult({
            operatorId: context.userId,
            runId,
            expectedVersion,
            coverChecksum,
            coverMediaId,
            draftIdempotencyKey: draftKey,
            draftMediaId,
            leaseOwner,
          });
        return initJson({
          success: true,
          data: {
            run: publicAgentInitRun(updatedRun),
            cover: { mediaId: coverMediaId, checksum: coverChecksum, created: coverCreated },
            draft: { ...readBack, created: draftCreated, published: false },
            reused: !coverCreated && !draftCreated,
          },
          requestId: context.requestId,
        }, { status: coverCreated || draftCreated ? 201 : 200 });
        } finally {
          await deps.store.releaseRunActionLease({
            operatorId: context.userId,
            runId,
            leaseOwner,
          });
        }
      }

      if (
        request.method === 'GET' &&
        segments.length === 6 &&
        segments[3] === 'credential-handoffs'
      ) {
        const handoffId = decodePathSegment(segments[4], 'handoffId');
        if (segments[5] !== 'status') return null;
        const handoff = await deps.store.getHandoff(context.userId, runId, handoffId);
        if (!handoff) throw new ApiError('credential_handoff_not_found', 'Credential handoff was not found.', 404);
        assertRunAccountAccessible(handoff.tenantId, handoff.accountId, context);
        requireTenantScope(context, handoff.tenantId, 'woa:account:read');
        return initJson({
          success: true,
          data: { handoff: publicCredentialHandoff(handoff) },
          requestId: context.requestId,
        });
      }
    }

    throw new ApiError('not_found', 'Agent initialization route not found.', 404);
  } catch (error) {
    if (error instanceof AgentInitStateError) {
      throw new ApiError(error.code, error.message, error.status);
    }
    throw error;
  }
}

export async function handleCredentialHandoffRequest(
  request: Request,
  deps: CredentialHandoffDeps,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/init/credentials') return new Response('Not Found', { status: 404 });

  if (request.method !== 'GET' && request.method !== 'POST') {
    return credentialPage('method_not_allowed', '仅支持浏览器 GET/POST。', 405, request, {
      allow: 'GET, POST',
    });
  }
  if (!deps.operatorId) {
    return credentialPage(
      'operator_session_required',
      '请先在此浏览器登录 WOA，再重新打开 CLI 提供的一次性链接。',
      401,
      request,
    );
  }

  try {
    if (request.method === 'GET' && url.searchParams.has('handoff')) {
      const urlToken = url.searchParams.get('handoff') ?? '';
      if (!/^[a-f0-9]{64}$/.test(urlToken)) {
        throw new AgentInitStateError('credential_handoff_invalid', '一次性链接无效或已过期。', 410);
      }
      const claimed = await deps.store.claimCredentialHandoff({
        operatorId: deps.operatorId,
        urlToken,
      });
      const cleanUrl = new URL('/init/credentials', request.url);
      return new Response(null, {
        status: 303,
        headers: credentialSecurityHeaders({
          location: cleanUrl.toString(),
          'set-cookie': credentialCookie(claimed.cookieToken, request),
        }),
      });
    }

    const cookieToken = parseCookies(request.headers.get('cookie'))[CREDENTIAL_HANDOFF_COOKIE];
    if (!cookieToken) {
      throw new AgentInitStateError('credential_handoff_invalid', '一次性链接无效或已过期。', 410);
    }

    if (request.method === 'GET') {
      const handoff = await deps.store.getClaimedCredentialHandoff({
        operatorId: deps.operatorId,
        cookieToken,
      });
      if (!handoff) {
        throw new AgentInitStateError('credential_handoff_invalid', '一次性链接无效或已过期。', 410);
      }
      return credentialFormPage(handoff, request);
    }

    assertSameOriginFormPost(request);
    requireEgressContext(deps.egress);
    const form = await readBoundedForm(request, MAX_CREDENTIAL_FORM_BYTES);
    const appId = form.get('appId')?.trim() ?? '';
    const appSecret = form.get('appSecret') ?? '';
    if (!/^wx[0-9a-fA-F]{16}$/.test(appId)) {
      throw new ApiError('validation_error', 'AppID 格式不正确。', 400);
    }
    if (appSecret.length < 16 || appSecret.length > 128 || /\s/.test(appSecret)) {
      throw new ApiError('validation_error', 'AppSecret 格式不正确。', 400);
    }

    const handoff = await deps.store.consumeCredentialHandoff({
      operatorId: deps.operatorId,
      cookieToken,
    });
    try {
      await deps.assertAuthority?.(handoff);
      await deps.validatePersistAndComplete({
        handoff,
        config: { appId, appSecret },
        complete: async () => {
          await deps.store.completeCredentialHandoff({
            operatorId: deps.operatorId!,
            handoffId: handoff.handoffId,
            leaseOwner: handoff.leaseOwner,
          });
        },
      });
      return credentialPage(
        'credentials_verified',
        '公众号凭据已通过固定出口 relay 实测并安全保存。现在可以关闭此页面，CLI 会继续完成配置。',
        200,
        request,
        { 'set-cookie': clearCredentialCookie(request) },
      );
    } catch (error) {
      const probeError = normalizeProbeError(error);
      await deps.store.failCredentialHandoff({
        operatorId: deps.operatorId,
        handoffId: handoff.handoffId,
        leaseOwner: handoff.leaseOwner,
        errorCode: probeError.code,
      });
      const currentIps = probeError.code === 'wechat_ip_not_allowlisted'
        ? ` 当前固定出口 IP：${deps.egress?.ips.join('、') || '不可用'}。`
        : '';
      return credentialPage(
        probeError.code,
        `${probeError.message}${currentIps} 此一次性链接已作废，请回到 CLI 重试。`,
        probeError.status,
        request,
        { 'set-cookie': clearCredentialCookie(request) },
      );
    }
  } catch (error) {
    if (error instanceof AgentInitStateError) {
      return credentialPage(error.code, error.message, error.status, request, {
        'set-cookie': clearCredentialCookie(request),
      });
    }
    if (error instanceof ApiError) {
      return credentialPage(error.code, error.message, error.status, request);
    }
    return credentialPage(
      'wechat_relay_unavailable',
      '固定出口 relay 暂时不可用，请稍后回到 CLI 重试。',
      503,
      request,
      { 'set-cookie': clearCredentialCookie(request) },
    );
  }
}

function requireEgressContext(egress: AgentInitEgressContext | null): AgentInitEgressContext {
  if (!egress) {
    throw new ApiError(
      'wechat_egress_ip_unavailable',
      'Controlled WeChat egress IP metadata is unavailable.',
      503,
    );
  }
  return egress;
}

export function testDraftTitle(runId: string): string {
  return `WOA 接入测试 · ${runId.slice(-8)}`;
}

export function testCoverFilename(runId: string): string {
  return `woa-init-cover-${runId.slice(-8)}.bmp`;
}

function safeTestDraftError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AgentInitStateError) return new ApiError(error.code, error.message, error.status);
  if (error instanceof WechatCredentialProbeError) {
    return new ApiError(error.code, error.message, error.status);
  }
  return new ApiError(
    'wechat_test_draft_failed',
    'WeChat test cover or draft verification failed; no publish action was attempted.',
    502,
  );
}

function assertRunAccountAccessible(tenantId: string, accountId: string, context: TenantRequestContext): void {
  resolveAccountContext({ tenantId, accountId }, context, { requireAccount: true });
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError('validation_error', 'Content-Type must be application/json.', 415);
  }
  const text = await readBoundedText(request, maxBytes);
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError('validation_error', 'Invalid JSON request body.', 400);
  }
}

async function readBoundedForm(request: Request, maxBytes: number): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    throw new ApiError('validation_error', '表单格式不正确。', 415);
  }
  return new URLSearchParams(await readBoundedText(request, maxBytes));
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError('request_too_large', 'Request body is too large.', 413);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('request_too_large').catch(() => undefined);
        throw new ApiError('request_too_large', 'Request body is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError('validation_error', 'Request body must be valid UTF-8.', 400);
  }
}

function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new ApiError(
      'validation_error',
      'Idempotency-Key must contain 8-128 safe ASCII characters.',
      400,
      { field: 'Idempotency-Key' },
    );
  }
  return value;
}

function requireExpectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError('validation_error', 'expectedVersion must be a positive integer.', 400, {
      field: 'expectedVersion',
    });
  }
  return value;
}

function decodePathSegment(value: string | undefined, field: string): string {
  if (!value) throw new ApiError('validation_error', `${field} is required.`, 400, { field });
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.trim()) throw new Error('empty');
    return decoded;
  } catch {
    throw new ApiError('validation_error', `${field} must be URL encoded path text.`, 400, { field });
  }
}

function normalizeProbeError(error: unknown): WechatCredentialProbeError {
  if (error instanceof WechatCredentialProbeError) return error;
  if (error instanceof ApiError) {
    const code = error.code === 'oauth_revoked' ||
      error.code === 'membership_scope_denied' ||
      error.code === 'account_plan_locked' ||
      error.code === 'credential_configuration_busy'
      ? error.code
      : 'wechat_credentials_rejected';
    return new WechatCredentialProbeError(code, error.message, error.status);
  }
  return wechatCredentialProbeErrorForResponse({
    httpStatus: numberValue((error as { response?: { status?: unknown } } | null)?.response?.status) ?? undefined,
  });
}

function assertSameOriginFormPost(request: Request): void {
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  if (origin && origin !== 'null') {
    const allowedOrigins = new Set([requestUrl.origin]);
    const host = normalizedHostHeader(request.headers.get('host'));
    if (host) allowedOrigins.add(`${requestUrl.protocol}//${host}`);
    try {
      if (allowedOrigins.has(new URL(origin).origin)) return;
    } catch {
      // Malformed origins remain fail-closed.
    }
  } else if (
    request.headers.get('sec-fetch-site')?.toLowerCase() === 'same-origin' &&
    request.headers.get('sec-fetch-mode')?.toLowerCase() === 'navigate'
  ) {
    return;
  }
  throw new ApiError('invalid_origin', 'Credential form origin validation failed.', 403);
}

function normalizedHostHeader(value: string | null): string | null {
  const host = value?.trim().toLowerCase() ?? '';
  if (!host || /[\s/?#@]/.test(host)) return null;
  return host;
}

function credentialFormPage(handoff: AgentCredentialHandoffRecord, request: Request): Response {
  const expiresAt = new Date(handoff.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const body = `
    <p class="eyebrow">WOA 安全配置</p>
    <h1>连接微信公众号</h1>
    <p>凭据只会提交到当前站点，经固定出口 relay 实测成功后才会加密保存。</p>
    <form method="post" action="/init/credentials" autocomplete="off">
      <label>AppID<input name="appId" inputmode="text" spellcheck="false" required maxlength="18" placeholder="wx…"></label>
      <label>AppSecret<input name="appSecret" type="password" spellcheck="false" required maxlength="128"></label>
      <button type="submit">验证并保存</button>
    </form>
    <p class="meta">一次性页面，有效至 ${escapeHtml(expiresAt)}。提交后不可重复使用。</p>`;
  return htmlPage('连接微信公众号', body, 200, request);
}

function credentialPage(
  code: string,
  message: string,
  status: number,
  request: Request,
  extraHeaders: HeadersInit = {},
): Response {
  const body = `
    <p class="eyebrow">WOA 安全配置</p>
    <h1>${status < 400 ? '配置完成' : '暂时无法继续'}</h1>
    <p>${escapeHtml(message)}</p>
    <p class="meta">状态码：${escapeHtml(code)}</p>`;
  return htmlPage(status < 400 ? '配置完成' : '配置未完成', body, status, request, extraHeaders);
}

function htmlPage(
  title: string,
  body: string,
  status: number,
  _request: Request,
  extraHeaders: HeadersInit = {},
): Response {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f5f3ee;color:#161616;font:16px/1.6 system-ui,sans-serif}.card{box-sizing:border-box;max-width:560px;margin:8vh auto;padding:40px;background:#fff;border:1px solid #ddd7cc;border-radius:18px;box-shadow:0 18px 60px #322b2018}.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71695e}h1{font-size:34px;line-height:1.15;margin:.25em 0}form{display:grid;gap:18px;margin-top:28px}label{display:grid;gap:7px;font-weight:650}input{box-sizing:border-box;width:100%;padding:12px 14px;border:1px solid #bdb5a8;border-radius:10px;font:inherit}button{border:0;border-radius:10px;padding:13px 18px;background:#151515;color:#fff;font:650 16px system-ui;cursor:pointer}.meta{margin-top:24px;color:#71695e;font-size:13px}@media(max-width:640px){.card{margin:0;min-height:100vh;border:0;border-radius:0;padding:32px 22px}}</style></head><body><main class="card">${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: credentialSecurityHeaders({
      'content-type': 'text/html; charset=utf-8',
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    }),
  });
}

function initJson(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: credentialSecurityHeaders({
      'content-type': 'application/json; charset=utf-8',
      ...Object.fromEntries(new Headers(init.headers).entries()),
    }),
  });
}

function credentialSecurityHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  return headers;
}

function credentialCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${CREDENTIAL_HANDOFF_COOKIE}=${encodeURIComponent(token)}; Path=/init/credentials; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(AGENT_CREDENTIAL_HANDOFF_TTL_MS / 1000)}${secure}`;
}

function clearCredentialCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${CREDENTIAL_HANDOFF_COOKIE}=; Path=/init/credentials; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value.join('='));
    } catch {
      // Ignore malformed cookies; capability validation remains fail-closed.
    }
  }
  return result;
}

function isPublicIpLiteral(value: string): boolean {
  if (/^(10\.|127\.|169\.254\.|192\.168\.|0\.|224\.|240\.)/.test(value)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return false;
  if (/^(::1|fc|fd|fe8|fe9|fea|feb)/i.test(value)) return false;
  const ipv4 = value.split('.');
  if (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return true;
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
