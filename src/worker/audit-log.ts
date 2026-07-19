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
  private timeColumn: AuditTimeColumn = 'occurred_at';

  constructor(private readonly db: D1DatabaseLike) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.prepare(AUDIT_LOGS_TABLE_SQL).run();
    const columns = await this.db.prepare('PRAGMA table_info(audit_logs)').all<{ name?: unknown }>();
    const columnNames = new Set((columns.results ?? []).map(column => stringValue(column.name)).filter(Boolean));
    if (columnNames.has('occurred_at')) {
      this.timeColumn = 'occurred_at';
    } else if (columnNames.has('created_at')) {
      // 0002_multi_tenant_foundation.sql 的已部署旧版本使用 created_at。
      // D1 不会重放被修改过的历史 migration，因此运行时必须兼容该列名。
      this.timeColumn = 'created_at';
    } else {
      throw new Error('audit_logs schema is missing occurred_at/created_at timestamp column');
    }
    for (const statement of auditLogIndexesSql(this.timeColumn)) {
      await this.db.prepare(statement).run();
    }
    this.schemaReady = true;
  }

  async write(event: AuditLogEvent): Promise<void> {
    await (await this.prepareWriteStatement(event)).run();
  }

  async prepareWriteStatement(event: AuditLogEvent) {
    await this.ensureSchema();
    return this.db.prepare(
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
        ${this.timeColumn}
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CAST(strftime('%s', 'now') AS INTEGER) * 1000))`,
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
      event.occurredAt ?? null,
    );
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
              ${this.timeColumn} AS occurred_at
       FROM audit_logs
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${this.timeColumn} DESC, id DESC
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
       WHERE ${this.timeColumn} < ?`,
    ).bind(cutoff).run();
    return result.meta?.changes ?? 0;
  }
}

const AUDIT_LOGS_TABLE_SQL = `
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
)
`;

export const AUDIT_LOGS_SCHEMA_SQL = `${AUDIT_LOGS_TABLE_SQL};
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON audit_logs(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_account_time ON audit_logs(account_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, occurred_at);`;

type AuditTimeColumn = 'occurred_at' | 'created_at';

function auditLogIndexesSql(timeColumn: AuditTimeColumn): string[] {
  return [
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON audit_logs(tenant_id, ${timeColumn})`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_account_time ON audit_logs(account_id, ${timeColumn})`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, ${timeColumn})`,
  ];
}

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
