import type { D1DatabaseLike } from '../storage/d1-storage-manager.js';

export type AgentInitRunStatus = 'active' | 'completed' | 'failed' | 'expired';
export type AgentCredentialHandoffStatus = 'pending' | 'claimed' | 'processing' | 'verified' | 'failed' | 'expired';
export type AgentInitIdempotencyStatus = 'pending' | 'completed' | 'failed';

export interface AgentInitRunRecord {
  runId: string;
  operatorId: string;
  tenantId: string;
  accountId: string;
  oauthClientId?: string | null;
  status: AgentInitRunStatus;
  phase: string;
  version: number;
  egressConfigVersion: string;
  egressConfirmedAt?: number | null;
  credentialsVerifiedAt?: number | null;
  relayProbeAt?: number | null;
  testAssetChecksum?: string | null;
  testAssetMediaId?: string | null;
  testDraftMediaId?: string | null;
  lastErrorCode?: string | null;
  activeHandoffId?: string | null;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentCredentialHandoffRecord {
  handoffId: string;
  runId: string;
  operatorId: string;
  tenantId: string;
  accountId: string;
  status: AgentCredentialHandoffStatus;
  errorCode?: string | null;
  expiresAt: number;
  claimedAt?: number | null;
  consumedAt?: number | null;
  verifiedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConsumedAgentCredentialHandoffRecord extends AgentCredentialHandoffRecord {
  leaseOwner: string;
}

export interface AgentInitIdempotencyRecord {
  tenantId: string;
  accountId: string;
  toolName: string;
  runId: string;
  status: AgentInitIdempotencyStatus;
  resultRef?: string | null;
  leaseExpiresAt?: number | null;
  expiresAt: number;
}

export class AgentInitStateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AgentInitStateError';
  }
}

export const AGENT_INIT_RUN_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENT_CREDENTIAL_HANDOFF_TTL_MS = 10 * 60 * 1000;
export const AGENT_INIT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const AGENT_INIT_LEASE_TTL_MS = 10 * 60 * 1000;

export class D1AgentInitStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async createOrGetRun(input: {
    operatorId: string;
    tenantId: string;
    accountId: string;
    oauthClientId?: string | null;
    idempotencyKey: string;
    egressConfigVersion: string;
    now?: number;
  }): Promise<{ run: AgentInitRunRecord; created: boolean }> {
    const now = input.now ?? Date.now();
    const requestKeyHash = await scopedHash(
      input.operatorId,
      input.tenantId,
      input.accountId,
      input.idempotencyKey,
    );
    const existing = await this.findRunByRequestHash(input.operatorId, requestKeyHash);
    if (existing) {
      if (existing.expiresAt <= now || existing.status === 'expired') {
        await this.expireRun(existing.runId, now);
        throw new AgentInitStateError('init_run_expired', 'The initialization run has expired.', 410);
      }
      return { run: existing, created: false };
    }

    const runId = opaqueId('init');
    try {
      await this.db.prepare(
        `INSERT INTO agent_init_runs (
           id, operator_id, tenant_id, account_id, request_key_hash, oauth_client_id,
           status, phase, run_version, egress_config_version,
           expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'context_ready', 1, ?, ?, ?, ?)`,
      ).bind(
        runId,
        input.operatorId,
        input.tenantId,
        input.accountId,
        requestKeyHash,
        input.oauthClientId ?? null,
        input.egressConfigVersion,
        now + AGENT_INIT_RUN_TTL_MS,
        now,
        now,
      ).run();
    } catch (error) {
      // A concurrent retry can win the UNIQUE(operator_id, request_key_hash) race.
      const raced = await this.findRunByRequestHash(input.operatorId, requestKeyHash);
      if (raced) return { run: raced, created: false };
      throw error;
    }

    const run = await this.getRun(input.operatorId, runId, now);
    if (!run) throw new AgentInitStateError('init_run_conflict', 'Initialization run creation did not persist.', 409);
    return { run, created: true };
  }

  async getRun(operatorId: string, runId: string, now: number = Date.now()): Promise<AgentInitRunRecord | null> {
    const row = await this.db.prepare(
      `SELECT * FROM agent_init_runs WHERE id = ? AND operator_id = ? LIMIT 1`,
    ).bind(runId, operatorId).first<Record<string, unknown>>();
    if (!row) return null;
    const run = rowToRun(row);
    if (run.expiresAt <= now && run.status === 'active') {
      await this.expireRun(run.runId, now);
      return { ...run, status: 'expired', phase: 'expired', updatedAt: now };
    }
    return run;
  }

  /** 在任何远端副作用前以 runVersion 做 CAS，并以哈希 owner 串行化同一 init run。 */
  async acquireRunActionLease(input: {
    operatorId: string;
    runId: string;
    expectedVersion: number;
    leaseOwner: string;
    now?: number;
  }): Promise<AgentInitRunRecord> {
    const now = input.now ?? Date.now();
    const ownerHash = await sha256Text(input.leaseOwner);
    const result = await this.db.prepare(
      `UPDATE agent_init_runs
       SET lease_owner_hash = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND operator_id = ? AND status = 'active'
         AND expires_at > ? AND run_version = ?
         AND (lease_owner_hash IS NULL OR COALESCE(lease_expires_at, 0) <= ? OR lease_owner_hash = ?)`,
    ).bind(
      ownerHash,
      Math.min(now + AGENT_INIT_LEASE_TTL_MS, now + AGENT_INIT_RUN_TTL_MS),
      now,
      input.runId,
      input.operatorId,
      now,
      input.expectedVersion,
      now,
      ownerHash,
    ).run();
    if (changes(result) === 0) {
      await this.throwRunMutationError(input.operatorId, input.runId, input.expectedVersion, now);
    }
    return await this.requireActiveRun(input.operatorId, input.runId, now);
  }

  async releaseRunActionLease(input: {
    operatorId: string;
    runId: string;
    leaseOwner: string;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `UPDATE agent_init_runs
       SET lease_owner_hash = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND operator_id = ? AND lease_owner_hash = ?`,
    ).bind(now, input.runId, input.operatorId, await sha256Text(input.leaseOwner)).run();
  }

  async confirmEgress(input: {
    operatorId: string;
    runId: string;
    expectedVersion: number;
    egressConfigVersion: string;
    now?: number;
  }): Promise<AgentInitRunRecord> {
    const now = input.now ?? Date.now();
    const result = await this.db.prepare(
      `UPDATE agent_init_runs
       SET egress_confirmed_at = COALESCE(egress_confirmed_at, ?),
           egress_config_version = ?,
           phase = CASE WHEN credentials_verified_at IS NULL THEN 'egress_confirmed' ELSE phase END,
           run_version = run_version + 1,
           updated_at = ?
       WHERE id = ? AND operator_id = ? AND status = 'active'
         AND expires_at > ? AND run_version = ?
         AND (lease_owner_hash IS NULL OR COALESCE(lease_expires_at, 0) <= ?)`,
    ).bind(
      now,
      input.egressConfigVersion,
      now,
      input.runId,
      input.operatorId,
      now,
      input.expectedVersion,
      now,
    ).run();
    if (changes(result) === 0) {
      await this.throwRunMutationError(input.operatorId, input.runId, input.expectedVersion, now);
    }
    return await this.requireRun(input.operatorId, input.runId, now);
  }

  async createCredentialHandoff(input: {
    operatorId: string;
    runId: string;
    expectedVersion: number;
    now?: number;
  }): Promise<{ handoff: AgentCredentialHandoffRecord; urlToken: string; run: AgentInitRunRecord }> {
    const now = input.now ?? Date.now();
    const initial = await this.requireActiveRun(input.operatorId, input.runId, now);
    if (!initial.egressConfirmedAt) {
      throw new AgentInitStateError(
        'wechat_egress_confirmation_required',
        'Confirm the controlled WeChat egress IP before entering credentials.',
        409,
      );
    }
    const leaseOwner = `credential-handoff-create:${crypto.randomUUID()}`;
    const run = await this.acquireRunActionLease({
      operatorId: input.operatorId,
      runId: input.runId,
      expectedVersion: input.expectedVersion,
      leaseOwner,
      now,
    });
    const handoffId = opaqueId('handoff');
    const urlToken = randomOpaqueToken();
    const expiresAt = Math.min(run.expiresAt, now + AGENT_CREDENTIAL_HANDOFF_TTL_MS);
    try {
      // 旧 URL/已领取 cookie 都立即失效；只有 run.active_handoff_id 指向的新记录可被 claim/consume。
      await this.db.prepare(
        `UPDATE agent_credential_handoffs
         SET status = 'expired', error_code = 'credential_handoff_superseded', updated_at = ?
         WHERE run_id = ? AND operator_id = ? AND status IN ('pending', 'claimed', 'processing')`,
      ).bind(now, run.runId, run.operatorId).run();
      await this.db.prepare(
        `INSERT INTO agent_credential_handoffs (
           id, run_id, operator_id, tenant_id, account_id, url_token_hash,
           status, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).bind(
        handoffId,
        run.runId,
        run.operatorId,
        run.tenantId,
        run.accountId,
        await sha256Text(urlToken),
        expiresAt,
        now,
        now,
      ).run();

      const update = await this.db.prepare(
        `UPDATE agent_init_runs
         SET phase = 'credential_handoff_pending', active_handoff_id = ?,
             run_version = run_version + 1, lease_owner_hash = NULL,
             lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND operator_id = ? AND status = 'active'
           AND expires_at > ? AND run_version = ? AND egress_confirmed_at IS NOT NULL
           AND lease_owner_hash = ?`,
      ).bind(
        handoffId,
        now,
        run.runId,
        run.operatorId,
        now,
        input.expectedVersion,
        await sha256Text(leaseOwner),
      ).run();
      if (changes(update) === 0) {
        await this.db.prepare(
          `UPDATE agent_credential_handoffs
           SET status = 'expired', error_code = 'init_run_conflict', updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        ).bind(now, handoffId).run();
        await this.throwRunMutationError(input.operatorId, input.runId, input.expectedVersion, now);
      }

      const handoff = await this.getHandoff(input.operatorId, run.runId, handoffId, now);
      if (!handoff || handoff.status !== 'pending') {
        throw new AgentInitStateError('init_run_conflict', 'Credential handoff creation did not persist.', 409);
      }
      return {
        handoff,
        urlToken,
        run: await this.requireRun(input.operatorId, input.runId, now),
      };
    } finally {
      await this.releaseRunActionLease({
        operatorId: input.operatorId,
        runId: input.runId,
        leaseOwner,
        now,
      });
    }
  }

  async getHandoff(
    operatorId: string,
    runId: string,
    handoffId: string,
    now: number = Date.now(),
  ): Promise<AgentCredentialHandoffRecord | null> {
    const row = await this.db.prepare(
      `SELECT h.*, r.credentials_verified_at AS run_credentials_verified_at,
              r.active_handoff_id AS run_active_handoff_id
       FROM agent_credential_handoffs h
       INNER JOIN agent_init_runs r ON r.id = h.run_id AND r.operator_id = h.operator_id
       WHERE h.id = ? AND h.run_id = ? AND h.operator_id = ? LIMIT 1`,
    ).bind(handoffId, runId, operatorId).first<Record<string, unknown>>();
    if (!row) return null;
    let handoff = rowToHandoff(row);
    if (
      handoff.status === 'processing' &&
      numberValue(row.run_credentials_verified_at) &&
      stringValue(row.run_active_handoff_id) === handoff.handoffId
    ) {
      await this.db.prepare(
        `UPDATE agent_credential_handoffs
         SET status = 'verified', error_code = NULL, verified_at = ?, updated_at = ?
         WHERE id = ? AND operator_id = ? AND status = 'processing'`,
      ).bind(now, now, handoff.handoffId, operatorId).run();
      handoff = { ...handoff, status: 'verified', verifiedAt: now, updatedAt: now };
    }
    if (handoff.expiresAt <= now && ['pending', 'claimed'].includes(handoff.status)) {
      await this.db.prepare(
        `UPDATE agent_credential_handoffs
         SET status = 'expired', error_code = 'init_run_expired', updated_at = ?
         WHERE id = ? AND status IN ('pending', 'claimed')`,
      ).bind(now, handoff.handoffId).run();
      return { ...handoff, status: 'expired', errorCode: 'init_run_expired', updatedAt: now };
    }
    return handoff;
  }

  async claimCredentialHandoff(input: {
    operatorId: string;
    urlToken: string;
    now?: number;
  }): Promise<{ handoff: AgentCredentialHandoffRecord; cookieToken: string }> {
    const now = input.now ?? Date.now();
    const cookieToken = randomOpaqueToken();
    const cookieTokenHash = await sha256Text(cookieToken);
    const update = await this.db.prepare(
      `UPDATE agent_credential_handoffs
       SET status = 'claimed', cookie_token_hash = ?, claimed_at = ?, updated_at = ?
       WHERE url_token_hash = ? AND operator_id = ? AND status = 'pending'
         AND claimed_at IS NULL AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM agent_init_runs r
           WHERE r.id = agent_credential_handoffs.run_id
             AND r.operator_id = agent_credential_handoffs.operator_id
             AND r.active_handoff_id = agent_credential_handoffs.id
             AND r.status = 'active' AND r.expires_at > ?
         )`,
    ).bind(
      cookieTokenHash,
      now,
      now,
      await sha256Text(input.urlToken),
      input.operatorId,
      now,
      now,
    ).run();
    if (changes(update) === 0) {
      throw new AgentInitStateError(
        'credential_handoff_invalid',
        'This credential handoff is invalid, expired, already opened, or belongs to another Operator.',
        410,
      );
    }
    const row = await this.db.prepare(
      `SELECT * FROM agent_credential_handoffs
       WHERE cookie_token_hash = ? AND operator_id = ? LIMIT 1`,
    ).bind(cookieTokenHash, input.operatorId).first<Record<string, unknown>>();
    if (!row) throw new AgentInitStateError('credential_handoff_invalid', 'Credential handoff claim did not persist.', 410);
    return { handoff: rowToHandoff(row), cookieToken };
  }

  async getClaimedCredentialHandoff(input: {
    operatorId: string;
    cookieToken: string;
    now?: number;
  }): Promise<AgentCredentialHandoffRecord | null> {
    const now = input.now ?? Date.now();
    const row = await this.db.prepare(
      `SELECT * FROM agent_credential_handoffs
       WHERE cookie_token_hash = ? AND operator_id = ? AND status = 'claimed'
         AND consumed_at IS NULL AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM agent_init_runs r
           WHERE r.id = agent_credential_handoffs.run_id
             AND r.operator_id = agent_credential_handoffs.operator_id
             AND r.active_handoff_id = agent_credential_handoffs.id
             AND r.status = 'active' AND r.expires_at > ?
         )
       LIMIT 1`,
    ).bind(await sha256Text(input.cookieToken), input.operatorId, now, now).first<Record<string, unknown>>();
    return row ? rowToHandoff(row) : null;
  }

  async consumeCredentialHandoff(input: {
    operatorId: string;
    cookieToken: string;
    now?: number;
  }): Promise<ConsumedAgentCredentialHandoffRecord> {
    const now = input.now ?? Date.now();
    const cookieTokenHash = await sha256Text(input.cookieToken);
    const claimedRow = await this.db.prepare(
      `SELECT h.* FROM agent_credential_handoffs h
       INNER JOIN agent_init_runs r ON r.id = h.run_id AND r.operator_id = h.operator_id
       WHERE h.cookie_token_hash = ? AND h.operator_id = ? AND h.status = 'claimed'
         AND h.consumed_at IS NULL AND h.expires_at > ?
         AND r.active_handoff_id = h.id AND r.status = 'active' AND r.expires_at > ?
       LIMIT 1`,
    ).bind(cookieTokenHash, input.operatorId, now, now).first<Record<string, unknown>>();
    if (!claimedRow) {
      throw new AgentInitStateError(
        'credential_handoff_consumed',
        'This credential handoff is expired or has already been submitted.',
        410,
      );
    }
    const handoff = rowToHandoff(claimedRow);
    const run = await this.requireActiveRun(input.operatorId, handoff.runId, now);
    const leaseOwner = credentialHandoffLeaseOwner();
    await this.acquireRunActionLease({
      operatorId: input.operatorId,
      runId: handoff.runId,
      expectedVersion: run.version,
      leaseOwner,
      now,
    });
    try {
      const update = await this.db.prepare(
        `UPDATE agent_credential_handoffs
         SET status = 'processing', consumed_at = ?, updated_at = ?
         WHERE cookie_token_hash = ? AND operator_id = ? AND status = 'claimed'
           AND consumed_at IS NULL AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM agent_init_runs r
             WHERE r.id = agent_credential_handoffs.run_id
               AND r.active_handoff_id = agent_credential_handoffs.id
               AND r.lease_owner_hash = ? AND r.lease_expires_at > ?
           )`,
      ).bind(
        now,
        now,
        cookieTokenHash,
        input.operatorId,
        now,
        await sha256Text(leaseOwner),
        now,
      ).run();
      if (changes(update) === 0) {
        throw new AgentInitStateError(
          'credential_handoff_consumed',
          'This credential handoff is expired or has already been submitted.',
          410,
        );
      }
      const row = await this.db.prepare(
        `SELECT * FROM agent_credential_handoffs
         WHERE cookie_token_hash = ? AND operator_id = ? LIMIT 1`,
      ).bind(cookieTokenHash, input.operatorId).first<Record<string, unknown>>();
      if (!row) throw new AgentInitStateError('credential_handoff_consumed', 'Credential handoff is unavailable.', 410);
      return { ...rowToHandoff(row), leaseOwner };
    } catch (error) {
      await this.releaseRunActionLease({
        operatorId: input.operatorId,
        runId: handoff.runId,
        leaseOwner,
        now,
      });
      throw error;
    }
  }

  async completeCredentialHandoff(input: {
    operatorId: string;
    handoffId: string;
    leaseOwner: string;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    const row = await this.db.prepare(
      `SELECT h.run_id FROM agent_credential_handoffs h
       INNER JOIN agent_init_runs r ON r.id = h.run_id AND r.operator_id = h.operator_id
       WHERE h.id = ? AND h.operator_id = ? AND h.status = 'processing'
         AND r.active_handoff_id = h.id AND r.status = 'active'
       LIMIT 1`,
    ).bind(input.handoffId, input.operatorId).first<Record<string, unknown>>();
    const runId = stringValue(row?.run_id);
    if (!runId) throw new AgentInitStateError('credential_handoff_consumed', 'Credential handoff is no longer active.', 410);
    const run = await this.requireActiveRun(input.operatorId, runId, now);
    await this.acquireRunActionLease({
      operatorId: input.operatorId,
      runId,
      expectedVersion: run.version,
      leaseOwner: input.leaseOwner,
      now,
    });
    const updateRun = await this.db.prepare(
      `UPDATE agent_init_runs
       SET credentials_verified_at = ?, relay_probe_at = ?, phase = 'credentials_verified',
           last_error_code = NULL, run_version = run_version + 1,
           lease_owner_hash = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND operator_id = ? AND status = 'active'
         AND active_handoff_id = ? AND run_version = ? AND lease_owner_hash = ?`,
    ).bind(
      now,
      now,
      now,
      runId,
      input.operatorId,
      input.handoffId,
      run.version,
      await sha256Text(input.leaseOwner),
    ).run();
    if (changes(updateRun) === 0) {
      await this.releaseRunActionLease({ operatorId: input.operatorId, runId, leaseOwner: input.leaseOwner, now });
      await this.throwRunMutationError(input.operatorId, runId, run.version, now);
    }
    // run 是权威提交记录；若此投影写失败，getHandoff 会根据 run 状态自动修复。
    try {
      await this.db.prepare(
        `UPDATE agent_credential_handoffs
         SET status = 'verified', error_code = NULL, verified_at = ?, updated_at = ?
         WHERE id = ? AND operator_id = ? AND status = 'processing'`,
      ).bind(now, now, input.handoffId, input.operatorId).run();
    } catch {
      // 可恢复投影，不回滚已经验证并持久化的凭据事实。
    }
  }

  async failCredentialHandoff(input: {
    operatorId: string;
    handoffId: string;
    leaseOwner: string;
    errorCode: string;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    const row = await this.db.prepare(
      `SELECT run_id FROM agent_credential_handoffs
       WHERE id = ? AND operator_id = ? AND status = 'processing' LIMIT 1`,
    ).bind(input.handoffId, input.operatorId).first<Record<string, unknown>>();
    const runId = stringValue(row?.run_id);
    await this.db.prepare(
      `UPDATE agent_credential_handoffs
       SET status = 'failed', error_code = ?, updated_at = ?
       WHERE id = ? AND operator_id = ? AND status = 'processing'`,
    ).bind(input.errorCode, now, input.handoffId, input.operatorId).run();
    if (runId) {
      await this.db.prepare(
        `UPDATE agent_init_runs
         SET relay_probe_at = ?, phase = 'credential_handoff_failed', last_error_code = ?,
             active_handoff_id = NULL, run_version = run_version + 1,
             lease_owner_hash = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND operator_id = ? AND status = 'active'
           AND active_handoff_id = ? AND lease_owner_hash = ?`,
      ).bind(
        now,
        input.errorCode,
        now,
        runId,
        input.operatorId,
        input.handoffId,
        await sha256Text(input.leaseOwner),
      ).run();
      await this.releaseRunActionLease({ operatorId: input.operatorId, runId, leaseOwner: input.leaseOwner, now });
    }
  }

  async recordTestDraftResult(input: {
    operatorId: string;
    runId: string;
    expectedVersion: number;
    coverChecksum: string;
    coverMediaId: string;
    draftIdempotencyKey: string;
    draftMediaId: string;
    leaseOwner: string;
    now?: number;
  }): Promise<AgentInitRunRecord> {
    const now = input.now ?? Date.now();
    const run = await this.requireActiveRun(input.operatorId, input.runId, now);
    if (!run.credentialsVerifiedAt) {
      throw new AgentInitStateError(
        'wechat_credentials_required',
        'WeChat credentials must be verified before creating the test draft.',
        409,
      );
    }
    const result = await this.db.prepare(
      `UPDATE agent_init_runs
       SET test_asset_checksum = ?, test_asset_media_id = ?,
           test_draft_idempotency_key_hash = ?, test_draft_media_id = ?,
           phase = 'test_draft_verified', last_error_code = NULL,
           run_version = run_version + 1, lease_owner_hash = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND operator_id = ? AND status = 'active'
         AND expires_at > ? AND run_version = ? AND credentials_verified_at IS NOT NULL
         AND lease_owner_hash = ? AND lease_expires_at > ?`,
    ).bind(
      input.coverChecksum,
      input.coverMediaId,
      await scopedHash(run.tenantId, run.accountId, 'wechat_draft', input.draftIdempotencyKey),
      input.draftMediaId,
      now,
      input.runId,
      input.operatorId,
      now,
      input.expectedVersion,
      await sha256Text(input.leaseOwner),
      now,
    ).run();
    if (changes(result) === 0) {
      await this.throwRunMutationError(input.operatorId, input.runId, input.expectedVersion, now);
    }
    return await this.requireRun(input.operatorId, input.runId, now);
  }

  /**
   * 为测试素材/草稿副作用预留租约。key 只存哈希；完成结果只允许非敏感引用（例如 media_id）。
   */
  async reserveIdempotency(input: {
    operatorId: string;
    tenantId: string;
    accountId: string;
    toolName: string;
    idempotencyKey: string;
    runId: string;
    leaseOwner: string;
    now?: number;
  }): Promise<{ record: AgentInitIdempotencyRecord; acquired: boolean }> {
    const now = input.now ?? Date.now();
    const run = await this.requireActiveRun(input.operatorId, input.runId, now);
    if (run.tenantId !== input.tenantId || run.accountId !== input.accountId) {
      throw new AgentInitStateError(
        'init_run_conflict',
        'Idempotency scope does not match the initialization run account.',
        409,
      );
    }
    if (!run.credentialsVerifiedAt) {
      throw new AgentInitStateError(
        'wechat_credentials_required',
        'WeChat credentials must be verified before reserving a test side effect.',
        409,
      );
    }
    const keyHash = await scopedHash(input.tenantId, input.accountId, input.toolName, input.idempotencyKey);
    const leaseOwnerHash = await sha256Text(input.leaseOwner);
    try {
      await this.db.prepare(
        `INSERT INTO agent_init_idempotency (
           tenant_id, account_id, tool_name, idempotency_key_hash, run_id,
           status, lease_owner_hash, lease_expires_at, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      ).bind(
        input.tenantId,
        input.accountId,
        input.toolName,
        keyHash,
        input.runId,
        leaseOwnerHash,
        now + AGENT_INIT_LEASE_TTL_MS,
        now + AGENT_INIT_IDEMPOTENCY_TTL_MS,
        now,
        now,
      ).run();
      return {
        record: await this.requireIdempotency(input.tenantId, input.accountId, input.toolName, keyHash),
        acquired: true,
      };
    } catch (error) {
      const existing = await this.getIdempotency(input.tenantId, input.accountId, input.toolName, keyHash);
      if (!existing) throw error;
      if (existing.status === 'completed') return { record: existing, acquired: false };
      if ((existing.leaseExpiresAt ?? 0) > now) return { record: existing, acquired: false };
      const update = await this.db.prepare(
        `UPDATE agent_init_idempotency
         SET status = 'pending', run_id = ?, lease_owner_hash = ?, lease_expires_at = ?,
             expires_at = ?, updated_at = ?
         WHERE tenant_id = ? AND account_id = ? AND tool_name = ? AND idempotency_key_hash = ?
           AND status != 'completed' AND COALESCE(lease_expires_at, 0) <= ?`,
      ).bind(
        input.runId,
        leaseOwnerHash,
        now + AGENT_INIT_LEASE_TTL_MS,
        now + AGENT_INIT_IDEMPOTENCY_TTL_MS,
        now,
        input.tenantId,
        input.accountId,
        input.toolName,
        keyHash,
        now,
      ).run();
      return {
        record: await this.requireIdempotency(input.tenantId, input.accountId, input.toolName, keyHash),
        acquired: changes(update) > 0,
      };
    }
  }

  async completeIdempotency(input: {
    tenantId: string;
    accountId: string;
    toolName: string;
    idempotencyKey: string;
    leaseOwner: string;
    resultRef: string;
    now?: number;
  }): Promise<boolean> {
    const now = input.now ?? Date.now();
    const keyHash = await scopedHash(input.tenantId, input.accountId, input.toolName, input.idempotencyKey);
    const result = await this.db.prepare(
      `UPDATE agent_init_idempotency
       SET status = 'completed', result_ref = ?, lease_owner_hash = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE tenant_id = ? AND account_id = ? AND tool_name = ? AND idempotency_key_hash = ?
         AND status = 'pending' AND lease_owner_hash = ?`,
    ).bind(
      input.resultRef,
      now,
      input.tenantId,
      input.accountId,
      input.toolName,
      keyHash,
      await sha256Text(input.leaseOwner),
    ).run();
    return changes(result) > 0;
  }

  async failIdempotency(input: {
    tenantId: string;
    accountId: string;
    toolName: string;
    idempotencyKey: string;
    leaseOwner: string;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `UPDATE agent_init_idempotency
       SET status = 'failed', lease_owner_hash = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE tenant_id = ? AND account_id = ? AND tool_name = ? AND idempotency_key_hash = ?
         AND status = 'pending' AND lease_owner_hash = ?`,
    ).bind(
      now,
      input.tenantId,
      input.accountId,
      input.toolName,
      await scopedHash(input.tenantId, input.accountId, input.toolName, input.idempotencyKey),
      await sha256Text(input.leaseOwner),
    ).run();
  }

  private async findRunByRequestHash(operatorId: string, requestKeyHash: string): Promise<AgentInitRunRecord | null> {
    const row = await this.db.prepare(
      `SELECT * FROM agent_init_runs WHERE operator_id = ? AND request_key_hash = ? LIMIT 1`,
    ).bind(operatorId, requestKeyHash).first<Record<string, unknown>>();
    return row ? rowToRun(row) : null;
  }

  private async requireRun(operatorId: string, runId: string, now: number): Promise<AgentInitRunRecord> {
    const run = await this.getRun(operatorId, runId, now);
    if (!run) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
    return run;
  }

  private async requireActiveRun(operatorId: string, runId: string, now: number): Promise<AgentInitRunRecord> {
    const run = await this.requireRun(operatorId, runId, now);
    if (run.status === 'expired' || run.expiresAt <= now) {
      throw new AgentInitStateError('init_run_expired', 'The initialization run has expired.', 410);
    }
    if (run.status !== 'active') {
      throw new AgentInitStateError('init_run_conflict', 'The initialization run is no longer active.', 409);
    }
    return run;
  }

  private async throwRunMutationError(operatorId: string, runId: string, expectedVersion: number, now: number): Promise<never> {
    const run = await this.getRun(operatorId, runId, now);
    if (!run) throw new AgentInitStateError('init_run_not_found', 'Initialization run was not found.', 404);
    if (run.status === 'expired' || run.expiresAt <= now) {
      throw new AgentInitStateError('init_run_expired', 'The initialization run has expired.', 410);
    }
    if (run.version !== expectedVersion || run.status !== 'active') {
      throw new AgentInitStateError('init_run_conflict', 'Initialization run version conflict.', 409);
    }
    throw new AgentInitStateError('init_run_conflict', 'Initialization run update was not applied.', 409);
  }

  private async expireRun(runId: string, now: number): Promise<void> {
    await this.db.prepare(
      `UPDATE agent_init_runs
       SET status = 'expired', phase = 'expired', last_error_code = 'init_run_expired', updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(now, runId).run();
  }

  private async getIdempotency(
    tenantId: string,
    accountId: string,
    toolName: string,
    keyHash: string,
  ): Promise<AgentInitIdempotencyRecord | null> {
    const row = await this.db.prepare(
      `SELECT tenant_id, account_id, tool_name, run_id, status, result_ref, lease_expires_at, expires_at
       FROM agent_init_idempotency
       WHERE tenant_id = ? AND account_id = ? AND tool_name = ? AND idempotency_key_hash = ?
       LIMIT 1`,
    ).bind(tenantId, accountId, toolName, keyHash).first<Record<string, unknown>>();
    return row ? rowToIdempotency(row) : null;
  }

  private async requireIdempotency(
    tenantId: string,
    accountId: string,
    toolName: string,
    keyHash: string,
  ): Promise<AgentInitIdempotencyRecord> {
    const record = await this.getIdempotency(tenantId, accountId, toolName, keyHash);
    if (!record) throw new AgentInitStateError('init_run_conflict', 'Idempotency reservation did not persist.', 409);
    return record;
  }
}

export function publicAgentInitRun(run: AgentInitRunRecord): Record<string, unknown> {
  return {
    runId: run.runId,
    tenantId: run.tenantId,
    accountId: run.accountId,
    status: run.status,
    phase: run.phase,
    version: run.version,
    egressConfigVersion: run.egressConfigVersion,
    egressConfirmedAt: run.egressConfirmedAt ?? null,
    credentialsVerifiedAt: run.credentialsVerifiedAt ?? null,
    relayProbeAt: run.relayProbeAt ?? null,
    testAsset: run.testAssetMediaId ? {
      checksum: run.testAssetChecksum,
      mediaId: run.testAssetMediaId,
    } : null,
    testDraftMediaId: run.testDraftMediaId ?? null,
    lastErrorCode: run.lastErrorCode ?? null,
    expiresAt: run.expiresAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function publicCredentialHandoff(handoff: AgentCredentialHandoffRecord): Record<string, unknown> {
  return {
    handoffId: handoff.handoffId,
    runId: handoff.runId,
    tenantId: handoff.tenantId,
    accountId: handoff.accountId,
    status: handoff.status,
    errorCode: handoff.errorCode ?? null,
    expiresAt: handoff.expiresAt,
    claimedAt: handoff.claimedAt ?? null,
    consumedAt: handoff.consumedAt ?? null,
    verifiedAt: handoff.verifiedAt ?? null,
    createdAt: handoff.createdAt,
    updatedAt: handoff.updatedAt,
  };
}

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function opaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function credentialHandoffLeaseOwner(): string {
  return `credential-handoff-submit:${crypto.randomUUID()}`;
}

async function scopedHash(...parts: string[]): Promise<string> {
  return await sha256Text(parts.join('\u0000'));
}

function changes(result: { meta?: { changes?: number } }): number {
  return typeof result.meta?.changes === 'number' ? result.meta.changes : 0;
}

function rowToRun(row: Record<string, unknown>): AgentInitRunRecord {
  return {
    runId: stringValue(row.id) || '',
    operatorId: stringValue(row.operator_id) || '',
    tenantId: stringValue(row.tenant_id) || '',
    accountId: stringValue(row.account_id) || '',
    oauthClientId: stringValue(row.oauth_client_id),
    status: (stringValue(row.status) || 'active') as AgentInitRunStatus,
    phase: stringValue(row.phase) || 'context_ready',
    version: numberValue(row.run_version) ?? 1,
    egressConfigVersion: stringValue(row.egress_config_version) || '',
    egressConfirmedAt: numberValue(row.egress_confirmed_at),
    credentialsVerifiedAt: numberValue(row.credentials_verified_at),
    relayProbeAt: numberValue(row.relay_probe_at),
    testAssetChecksum: stringValue(row.test_asset_checksum),
    testAssetMediaId: stringValue(row.test_asset_media_id),
    testDraftMediaId: stringValue(row.test_draft_media_id),
    lastErrorCode: stringValue(row.last_error_code),
    activeHandoffId: stringValue(row.active_handoff_id),
    expiresAt: numberValue(row.expires_at) ?? 0,
    createdAt: numberValue(row.created_at) ?? 0,
    updatedAt: numberValue(row.updated_at) ?? 0,
  };
}

function rowToHandoff(row: Record<string, unknown>): AgentCredentialHandoffRecord {
  return {
    handoffId: stringValue(row.id) || '',
    runId: stringValue(row.run_id) || '',
    operatorId: stringValue(row.operator_id) || '',
    tenantId: stringValue(row.tenant_id) || '',
    accountId: stringValue(row.account_id) || '',
    status: (stringValue(row.status) || 'pending') as AgentCredentialHandoffStatus,
    errorCode: stringValue(row.error_code),
    expiresAt: numberValue(row.expires_at) ?? 0,
    claimedAt: numberValue(row.claimed_at),
    consumedAt: numberValue(row.consumed_at),
    verifiedAt: numberValue(row.verified_at),
    createdAt: numberValue(row.created_at) ?? 0,
    updatedAt: numberValue(row.updated_at) ?? 0,
  };
}

function rowToIdempotency(row: Record<string, unknown>): AgentInitIdempotencyRecord {
  return {
    tenantId: stringValue(row.tenant_id) || '',
    accountId: stringValue(row.account_id) || '',
    toolName: stringValue(row.tool_name) || '',
    runId: stringValue(row.run_id) || '',
    status: (stringValue(row.status) || 'pending') as AgentInitIdempotencyStatus,
    resultRef: stringValue(row.result_ref),
    leaseExpiresAt: numberValue(row.lease_expires_at),
    expiresAt: numberValue(row.expires_at) ?? 0,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
