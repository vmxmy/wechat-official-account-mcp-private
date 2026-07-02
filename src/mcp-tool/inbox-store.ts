export const MAX_MARK_PROCESSED_IDS = 100;
export const MAX_PROCESSING_NOTE_LENGTH = 500;

export interface InboundMessageRecord {
  id: number;
  dedupKey: string;
  toUserName: string;
  fromUserName: string;
  type: string;
  eventType?: string | null;
  rawXml: string;
  parsedPayload: Record<string, string>;
  createTime: number;
  receivedAt: number;
  processedAt?: number | null;
  processingNote?: string | null;
}

export interface InboxListOptions {
  pendingOnly?: boolean;
  type?: string;
  openid?: string;
  limit?: number;
  offset?: number;
}

export interface InboxListResult {
  items: InboundMessageRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface MarkProcessedOptions {
  ids: number[];
  processedAt?: number;
  note?: string;
}

export interface InboxStore {
  listMessages(options: InboxListOptions): Promise<InboxListResult>;
  getMessage(id: number): Promise<InboundMessageRecord | null>;
  markProcessed(options: MarkProcessedOptions): Promise<number>;
}
