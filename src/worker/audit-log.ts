import type { D1DatabaseLike, D1Value } from '../storage/d1-storage-manager.js';

const SECRET_FIELD_PATTERN = /(secret|token|encoding.?aes.?key|access.?token|client.?secret|proxy.?token|app.?secret)/i;

export interface AuditLogEvent {
  userId?: string | null;
  oauthClientId?: string | null;
  tenantId?: string | null;
  accountId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  metadata?: unknown;
  occurredAt?: number;
}

export interface AuditLogWriter {
  write(event: AuditLogEvent): Promise<void>;
}

export interface AuditLogQuery {
  tenantId: string;
  accountId?: string | null;
  action?: string | null;
  limit?: number;
  offset?: number;
}

export interface AuditLogRecord {
  id: number;
  userId?: string | null;
  oauthClientId?: string | null;
  tenantId?: string | null;
  accountId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  metadata: unknown;
  occurredAt: number;
}

export class D1AuditLogWriter implements AuditLogWriter {
  private schemaReady = false;

  constructor(private readonly db: D1DatabaseLike) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    for (const statement of AUDIT_LOGS_SCHEMA_SQL.split(';').map(part => part.trim()).filter(Boolean)) {
      await this.db.prepare(statement).run();
    }
    this.schemaReady = true;
  }

  async write(event: AuditLogEvent): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare(
      `INSERT INTO audit_logs (
        user_id,
        oauth_client_id,
        tenant_id,
        account_id,
        action,
        target_type,
        target_id,
        request_id,
        metadata_json,
        occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.userId ?? null,
      event.oauthClientId ?? null,
      event.tenantId ?? null,
      event.accountId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.requestId ?? null,
      JSON.stringify(sanitizeAuditMetadata(event.metadata ?? {})),
      event.occurredAt ?? Date.now(),
    ).run();
  }

  async list(query: AuditLogQuery): Promise<AuditLogRecord[]> {
    await this.ensureSchema();
    const conditions = ['tenant_id = ?'];
    const values: D1Value[] = [query.tenantId];
    if (query.accountId) {
      conditions.push('account_id = ?');
      values.push(query.accountId);
    }
    if (query.action) {
      conditions.push('action = ?');
      values.push(query.action);
    }
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = Math.max(0, query.offset ?? 0);
    values.push(limit, offset);
    const rows = await this.db.prepare(
      `SELECT id,
              user_id,
              oauth_client_id,
              tenant_id,
              account_id,
              action,
              target_type,
              target_id,
              request_id,
              metadata_json,
              occurred_at
       FROM audit_logs
       WHERE ${conditions.join(' AND ')}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    ).bind(...values).all<Record<string, unknown>>();
    return (rows.results ?? []).map(row => ({
      id: numberValue(row.id),
      userId: stringValue(row.user_id),
      oauthClientId: stringValue(row.oauth_client_id),
      tenantId: stringValue(row.tenant_id),
      accountId: stringValue(row.account_id),
      action: stringValue(row.action) ?? 'unknown',
      targetType: stringValue(row.target_type),
      targetId: stringValue(row.target_id),
      requestId: stringValue(row.request_id),
      metadata: parseMetadata(row.metadata_json),
      occurredAt: numberValue(row.occurred_at),
    }));
  }

  async purgeOlderThan(cutoff: number): Promise<number> {
    await this.ensureSchema();
    const result = await this.db.prepare(
      `DELETE FROM audit_logs
       WHERE occurred_at < ?`,
    ).bind(cutoff).run();
    return result.meta?.changes ?? 0;
  }
}

export const AUDIT_LOGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  oauth_client_id TEXT,
  tenant_id TEXT,
  account_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  request_id TEXT,
  metadata_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON audit_logs(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_account_time ON audit_logs(account_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, occurred_at);
`;

export function sanitizeAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeAuditMetadata(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = SECRET_FIELD_PATTERN.test(key)
      ? redactSecretValue(item)
      : sanitizeAuditMetadata(item);
  }
  return sanitized;
}

function redactSecretValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '[REDACTED]';
  }
  if (value.length <= 8) {
    return '[REDACTED]';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function requireConfirmationMarker(
  operation: string,
  confirmation: string | null | undefined,
): void {
  const expected = `CONFIRM:${operation}`;
  if (confirmation !== expected) {
    throw new Error(`Confirmation required. Retry with confirmation marker ${expected}`);
  }
}

export type AuditD1Value = D1Value;

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
