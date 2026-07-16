import type { D1DatabaseLike } from '../storage/d1-storage-manager.js';
import { D1AuditLogWriter } from './audit-log.js';
import type { R2MediaUploadBucket } from './media-upload.js';
import { D1SaasOnboardingStore } from './saas-onboarding-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MaintenanceResult {
  auditLogsDeleted: number;
  inboundMessagesDeleted: number;
  accountInboundMessagesDeleted: number;
  r2ObjectsDeleted: number;
  r2ObjectsFailed: number;
  operatorDeletionsCompleted: number;
  operatorDeletionsFailed: number;
}

/**
 * 每日保留期任务。R2 lifecycle 是第一道 30 天清理保障；D1 ledger 让任务可观测、可重试。
 */
export async function runRetentionMaintenance(options: {
  db: D1DatabaseLike;
  mediaBucket?: R2MediaUploadBucket;
  now?: number;
  batchSize?: number;
  stripeSecretKey?: string | null;
  fetch?: typeof fetch;
}): Promise<MaintenanceResult> {
  const now = options.now ?? Date.now();
  const batchSize = Math.min(500, Math.max(1, options.batchSize ?? 100));
  const auditLogsDeleted = await new D1AuditLogWriter(options.db).purgeOlderThan(now - 180 * DAY_MS);
  const inbound = await options.db.prepare(
    `DELETE FROM inbound_messages
     WHERE received_at < ?`,
  ).bind(now - 90 * DAY_MS).run();
  const accountInbound = await options.db.prepare(
    `DELETE FROM account_inbound_messages
     WHERE received_at < ?`,
  ).bind(now - 90 * DAY_MS).run();

  let r2ObjectsDeleted = 0;
  let r2ObjectsFailed = 0;
  if (options.mediaBucket?.delete) {
    const expired = await options.db.prepare(
      `SELECT object_key
       FROM r2_media_retention_metadata
       WHERE expires_at <= ? AND deleted_at IS NULL
       ORDER BY expires_at ASC
       LIMIT ?`,
    ).bind(now, batchSize).all<Record<string, unknown>>();
    for (const row of expired.results ?? []) {
      const objectKey = typeof row.object_key === 'string' ? row.object_key : '';
      if (!objectKey) continue;
      try {
        await options.mediaBucket.delete(objectKey);
        await options.db.prepare(
          `UPDATE r2_media_retention_metadata
           SET deleted_at = ?
           WHERE object_key = ? AND deleted_at IS NULL`,
        ).bind(now, objectKey).run();
        r2ObjectsDeleted += 1;
      } catch {
        r2ObjectsFailed += 1;
      }
    }
  }

  let operatorDeletionsCompleted = 0;
  let operatorDeletionsFailed = 0;
  const onboardingStore = new D1SaasOnboardingStore(options.db);
  const deletionRequests = await onboardingStore.listPendingOperatorDeletionRequests(batchSize);
  for (const deletionRequest of deletionRequests) {
    try {
      const result = await onboardingStore.executeOperatorDeletion({
        requestId: deletionRequest.requestId,
        operatorId: deletionRequest.operatorId,
        now,
        cancelStripeSubscription: options.stripeSecretKey
          ? async subscriptionId => await cancelStripeSubscription(
            subscriptionId,
            options.stripeSecretKey as string,
            options.fetch ?? fetch,
          )
          : undefined,
      });
      for (const tenantId of result.tenantIds) {
        await new D1AuditLogWriter(options.db).write({
          userId: deletionRequest.operatorId,
          tenantId,
          action: 'operator.deletion_completed',
          targetType: 'operator',
          targetId: deletionRequest.operatorId,
          metadata: {
            requestId: deletionRequest.requestId,
            subscriptionsCancelled: result.subscriptionsCancelled,
            secretsPurged: true,
            accessDisabled: true,
          },
          occurredAt: now,
        });
      }
      operatorDeletionsCompleted += 1;
    } catch (error) {
      operatorDeletionsFailed += 1;
      await onboardingStore.recordMonitoringEvent({
        eventType: 'operator.deletion_failed',
        severity: 'error',
        metadata: {
          requestId: deletionRequest.requestId,
          operatorId: deletionRequest.operatorId,
          message: error instanceof Error ? error.message : String(error),
        },
        now,
      });
    }
  }

  return {
    auditLogsDeleted,
    inboundMessagesDeleted: inbound.meta?.changes ?? 0,
    accountInboundMessagesDeleted: accountInbound.meta?.changes ?? 0,
    r2ObjectsDeleted,
    r2ObjectsFailed,
    operatorDeletionsCompleted,
    operatorDeletionsFailed,
  };
}

async function cancelStripeSubscription(
  subscriptionId: string,
  secretKey: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${secretKey}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Stripe subscription cancellation failed with HTTP ${response.status}.`);
  }
}
