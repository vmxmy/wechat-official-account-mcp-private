import { z } from 'zod';
import {
  MAX_MARK_PROCESSED_IDS,
  MAX_PROCESSING_NOTE_LENGTH,
  type InboxStore,
  type InboundMessageRecord,
} from '../inbox-store.js';
import { McpTool, WechatApiClient, WechatToolResult } from '../types.js';
import { logger } from '../../utils/logger.js';

const inboxParamsSchema = z.object({
  action: z.enum(['list_pending', 'list_all', 'get', 'mark_processed']),
  id: z.number().int().positive().optional(),
  ids: z.array(z.number().int().positive()).max(MAX_MARK_PROCESSED_IDS).optional(),
  type: z.string().min(1).optional(),
  openid: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  note: z.string().max(MAX_PROCESSING_NOTE_LENGTH).optional(),
});

export const inboxMcpTool: McpTool = {
  name: 'wechat_inbox',
  description: '微信公众号入站消息收件箱 - 查询待处理消息、按类型/OpenID过滤、标记已处理',
  inputSchema: {
    action: z.enum(['list_pending', 'list_all', 'get', 'mark_processed']).describe('操作类型：list_pending-待处理列表, list_all-全部列表, get-获取单条, mark_processed-标记已处理'),
    id: z.number().int().positive().optional().describe('消息 ID（get 或单条 mark_processed 使用）'),
    ids: z.array(z.number().int().positive()).max(MAX_MARK_PROCESSED_IDS).optional().describe(`消息 ID 列表（批量 mark_processed 使用，最多 ${MAX_MARK_PROCESSED_IDS} 个）`),
    type: z.string().optional().describe('按消息类型过滤，如 text/image/event'),
    openid: z.string().optional().describe('按 FromUserName/OpenID 过滤'),
    limit: z.number().int().min(1).max(100).optional().describe('分页数量，默认20，最大100'),
    offset: z.number().int().min(0).optional().describe('分页偏移，默认0'),
    note: z.string().max(MAX_PROCESSING_NOTE_LENGTH).optional().describe(`处理备注（mark_processed 可选，最多 ${MAX_PROCESSING_NOTE_LENGTH} 字符）`),
  },
  handler: async (params: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
    try {
      const validated = inboxParamsSchema.parse(params);
      const inboxStore = getInboxStore(apiClient);

      switch (validated.action) {
        case 'list_pending':
        case 'list_all': {
          const result = await inboxStore.listMessages({
            pendingOnly: validated.action === 'list_pending',
            type: validated.type,
            openid: validated.openid,
            limit: validated.limit,
            offset: validated.offset,
          });
          return {
            content: [{
              type: 'text',
              text: formatListResult(validated.action === 'list_pending' ? '待处理消息' : '全部消息', result),
            }],
          };
        }

        case 'get': {
          if (!validated.id) {
            throw new Error('get 操作需要 id 参数');
          }
          const message = await inboxStore.getMessage(validated.id);
          if (!message) {
            throw new Error(`消息不存在: ${validated.id}`);
          }
          return {
            content: [{
              type: 'text',
              text: formatMessageDetail(message),
            }],
          };
        }

        case 'mark_processed': {
          const ids = validated.ids?.length ? validated.ids : validated.id ? [validated.id] : [];
          if (ids.length === 0) {
            throw new Error('mark_processed 操作需要 id 或 ids 参数');
          }
          const updated = await inboxStore.markProcessed({ ids, note: validated.note });
          return {
            content: [{
              type: 'text',
              text: `已标记处理完成：${updated} 条\n消息ID: ${ids.join(', ')}`,
            }],
          };
        }

        default:
          throw new Error(`未知的操作: ${validated.action}`);
      }
    } catch (error) {
      logger.error('Inbox tool error:', error);
      return {
        content: [{
          type: 'text',
          text: `收件箱操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
        }],
        isError: true,
      };
    }
  },
};

function getInboxStore(apiClient: WechatApiClient): InboxStore {
  const store = (apiClient as any).getInboxStore?.() as InboxStore | undefined;
  if (!store) {
    throw new Error('wechat_inbox 需要 Workers D1 inbox 存储；当前运行时未配置该能力');
  }
  return store;
}

function formatListResult(title: string, result: { items: InboundMessageRecord[]; total: number; limit: number; offset: number }): string {
  const rows = result.items.map(message =>
    `- #${message.id} ${message.type}${message.eventType ? `/${message.eventType}` : ''} from ${message.fromUserName}` +
    `\n  CreateTime: ${message.createTime}` +
    `\n  receivedAt: ${new Date(message.receivedAt).toISOString()}` +
    `\n  processedAt: ${message.processedAt ? new Date(message.processedAt).toISOString() : 'pending'}` +
    `\n  dedupKey: ${message.dedupKey}`,
  ).join('\n');

  return `${title}：${result.items.length}/${result.total} 条 (limit=${result.limit}, offset=${result.offset})\n${rows || '无匹配消息'}`;
}

function formatMessageDetail(message: InboundMessageRecord): string {
  return `消息 #${message.id}\n` +
    `dedupKey: ${message.dedupKey}\n` +
    `toUserName: ${message.toUserName}\n` +
    `fromUserName: ${message.fromUserName}\n` +
    `type: ${message.type}${message.eventType ? `/${message.eventType}` : ''}\n` +
    `createTime: ${message.createTime}\n` +
    `receivedAt: ${new Date(message.receivedAt).toISOString()}\n` +
    `processedAt: ${message.processedAt ? new Date(message.processedAt).toISOString() : 'pending'}\n` +
    `processingNote: ${message.processingNote ?? ''}\n` +
    `payload:\n${JSON.stringify(message.parsedPayload, null, 2)}\n` +
    `rawXml:\n${message.rawXml}`;
}
