import type { D1DatabaseLike, D1Value } from '../storage/d1-storage-manager.js';
import type {
  InboxListOptions,
  InboxListResult,
  InboxStore,
  InboundMessageRecord,
  MarkProcessedOptions,
} from '../mcp-tool/inbox-store.js';
import { MAX_MARK_PROCESSED_IDS, MAX_PROCESSING_NOTE_LENGTH } from '../mcp-tool/inbox-store.js';

export interface InboundMessageInsert {
  dedupKey: string;
  toUserName: string;
  fromUserName: string;
  type: string;
  eventType?: string | null;
  rawXml: string;
  parsedPayload: Record<string, string>;
  createTime: number;
  receivedAt: number;
}

export class D1InboxStore implements InboxStore {
  private schemaReady = false;

  constructor(private readonly db: D1DatabaseLike) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    for (const statement of INBOUND_MESSAGES_SCHEMA_SQL.split(';').map(part => part.trim()).filter(Boolean)) {
      await this.db.prepare(statement).run();
    }
    this.schemaReady = true;
  }

  async insertMessage(message: InboundMessageInsert): Promise<{ inserted: boolean }> {
    await this.ensureSchema();
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO inbound_messages (
        dedup_key,
        to_user_name,
        from_user_name,
        type,
        event_type,
        raw_xml,
        parsed_payload_json,
        create_time,
        received_at,
        processed_at,
        processing_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      message.dedupKey,
      message.toUserName,
      message.fromUserName,
      message.type,
      message.eventType ?? null,
      message.rawXml,
      JSON.stringify(message.parsedPayload),
      message.createTime,
      message.receivedAt,
    ).run();

    return { inserted: (result.meta?.changes ?? 0) > 0 };
  }

  async listMessages(options: InboxListOptions): Promise<InboxListResult> {
    await this.ensureSchema();
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const { whereSql, values } = buildWhereClause(options);

    const countRow = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM inbound_messages ${whereSql}`,
    ).bind(...values).first<{ total: number }>();

    const result = await this.db.prepare(
      `SELECT * FROM inbound_messages ${whereSql} ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(...values, limit, offset).all<InboundMessageRow>();

    return {
      items: (result.results ?? []).map(toInboundMessageRecord),
      total: Number(countRow?.total ?? 0),
      limit,
      offset,
    };
  }

  async getMessage(id: number): Promise<InboundMessageRecord | null> {
    await this.ensureSchema();
    const row = await this.db.prepare('SELECT * FROM inbound_messages WHERE id = ? LIMIT 1')
      .bind(id)
      .first<InboundMessageRow>();
    return row ? toInboundMessageRecord(row) : null;
  }

  async markProcessed(options: MarkProcessedOptions): Promise<number> {
    await this.ensureSchema();
    const ids = [...new Set(options.ids.map(id => Math.trunc(id)).filter(id => id > 0))];
    if (ids.length === 0) return 0;
    if (ids.length > MAX_MARK_PROCESSED_IDS) {
      throw new Error(`mark_processed 最多支持 ${MAX_MARK_PROCESSED_IDS} 个消息 ID`);
    }
    if (options.note && options.note.length > MAX_PROCESSING_NOTE_LENGTH) {
      throw new Error(`processing_note 最多支持 ${MAX_PROCESSING_NOTE_LENGTH} 字符`);
    }

    const placeholders = ids.map(() => '?').join(', ');
    const processedAt = options.processedAt ?? Date.now();
    const result = await this.db.prepare(
      `UPDATE inbound_messages
       SET processed_at = ?, processing_note = ?
       WHERE id IN (${placeholders})`,
    ).bind(processedAt, options.note ?? null, ...ids).run();

    return result.meta?.changes ?? 0;
  }
}

export const INBOUND_MESSAGES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbound_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE,
  to_user_name TEXT NOT NULL,
  from_user_name TEXT NOT NULL,
  type TEXT NOT NULL,
  event_type TEXT,
  raw_xml TEXT NOT NULL,
  parsed_payload_json TEXT NOT NULL,
  create_time INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  processing_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_pending ON inbound_messages(processed_at, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_type ON inbound_messages(type, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_openid ON inbound_messages(from_user_name, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_received_at ON inbound_messages(received_at);
`;

type InboundMessageRow = {
  id: number;
  dedup_key: string;
  to_user_name: string;
  from_user_name: string;
  type: string;
  event_type?: string | null;
  raw_xml: string;
  parsed_payload_json: string;
  create_time: number;
  received_at: number;
  processed_at?: number | null;
  processing_note?: string | null;
};

function buildWhereClause(options: InboxListOptions): { whereSql: string; values: D1Value[] } {
  const clauses: string[] = [];
  const values: D1Value[] = [];

  if (options.pendingOnly) {
    clauses.push('processed_at IS NULL');
  }

  if (options.type) {
    clauses.push('type = ?');
    values.push(options.type);
  }

  if (options.openid) {
    clauses.push('from_user_name = ?');
    values.push(options.openid);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

function toInboundMessageRecord(row: InboundMessageRow): InboundMessageRecord {
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    toUserName: row.to_user_name,
    fromUserName: row.from_user_name,
    type: row.type,
    eventType: row.event_type ?? null,
    rawXml: row.raw_xml,
    parsedPayload: parsePayload(row.parsed_payload_json),
    createTime: row.create_time,
    receivedAt: row.received_at,
    processedAt: row.processed_at ?? null,
    processingNote: row.processing_note ?? null,
  };
}

function parsePayload(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
