import { z } from 'zod';
import { WechatToolDefinition, WechatToolContext, WechatToolResult, McpTool, WechatApiClient } from '../types.js';

const OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT = 20;
const DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT = 1;

// 发布工具参数 Schema
const publishToolSchema = z.object({
  action: z.enum(['submit', 'get', 'delete', 'list']),
  mediaId: z.string().optional(),
  publishId: z.string().optional(),
  articleId: z.string().optional(),
  index: z.number().int().min(0).max(20).optional(),
  offset: z.number().int().min(0).default(0),
  count: z.number().int().min(1).max(20).default(OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT),
  noContent: z.number().int().min(0).max(1).optional(),
  no_content: z.number().int().min(0).max(1).default(DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT),
});

// 发布状态映射（模块级常量）
const PUBLISH_STATUS_MAP: Record<number, string> = {
  0: '成功',
  1: '发布失败',
  2: '发布成功',
  3: '发布中',
  4: '原创失败',
};

function formatPublishList(result: any, offset: number, count: number, noContent: number): string {
  const publishList = result.item.map((item: any, index: number) => {
    const newsItems = item.content?.news_item ?? item.article_detail?.item ?? [];
    const firstArticle = newsItems[0];
    const articleCount = item.article_detail?.count ?? newsItems.length;
    const publishIdOrArticleId = item.publish_id ?? item.article_id ?? '未知';
    const updateTime = item.article_detail?.create_time ?? item.content?.update_time ?? item.update_time;

    if (!firstArticle) {
      return `${offset + index + 1}. 发布ID/文章ID: ${publishIdOrArticleId}\n` +
             `   状态: ${PUBLISH_STATUS_MAP[item.publish_status] || '未返回'}\n` +
             `   标题: 未返回（no_content=${noContent}）\n` +
             `   更新时间: ${updateTime ? new Date(updateTime * 1000).toLocaleString() : '未知'}\n` +
             `   提示: 如需标题/正文摘要，请显式传 noContent: 0 后重试`;
    }

    return `${offset + index + 1}. 发布ID/文章ID: ${publishIdOrArticleId}\n` +
           `   状态: ${PUBLISH_STATUS_MAP[item.publish_status] || '未知状态'}\n` +
           `   标题: ${firstArticle.title}${articleCount > 1 ? ` (共${articleCount}篇)` : ''}\n` +
           `   作者: ${firstArticle.author || '未设置'}\n` +
           `   发布时间: ${updateTime ? new Date(updateTime * 1000).toLocaleString() : '未发布'}\n` +
           `   文章链接: ${firstArticle.url || '暂无'}`;
  }).join('\n\n');

  return `发布列表 (${offset + 1}-${offset + result.item.length}/${result.total_count}, count=${count}, no_content=${noContent}):\n\n${publishList}`;
}

/**
 * 发布工具核心处理逻辑
 */
async function handlePublishCore(
  action: string,
  params: {
    mediaId?: string;
    publishId?: string;
    articleId?: string;
    index?: number;
    offset?: number;
    count?: number;
    noContent?: number;
  },
  apiClient: WechatApiClient
): Promise<WechatToolResult> {
  switch (action) {
    case 'submit': {
      const { mediaId } = params;

      if (!mediaId) {
        throw new Error('草稿ID不能为空');
      }

      const result = await apiClient.post('/cgi-bin/freepublish/submit', {
        media_id: mediaId
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `发布提交成功！\n发布ID: ${result.publish_id}\n草稿ID: ${mediaId}\n\n注意：发布结果将通过事件推送通知，请关注推送消息。`,
        }],
      };
    }

    case 'get': {
      const { publishId } = params;

      if (!publishId) {
        throw new Error('发布ID不能为空');
      }

      const result = await apiClient.post('/cgi-bin/freepublish/get', {
        publish_id: publishId
      }) as any;

      const firstArticle = result.article_detail.item[0];
      const articleCount = result.article_detail.count;

      return {
        content: [{
          type: 'text',
          text: `发布状态查询成功！\n` +
                `发布ID: ${publishId}\n` +
                `发布状态: ${PUBLISH_STATUS_MAP[result.publish_status] || '未知状态'}\n` +
                `文章数量: ${articleCount}\n` +
                `首篇标题: ${firstArticle.title}\n` +
                `作者: ${firstArticle.author || '未设置'}\n` +
                `文章链接: ${firstArticle.url || '暂无'}\n` +
                `发布时间: ${result.article_detail.create_time ? new Date(result.article_detail.create_time * 1000).toLocaleString() : '未发布'}`,
        }],
      };
    }

    case 'delete': {
      const deleteArticleId = params.articleId ?? params.publishId;

      if (!deleteArticleId) {
        throw new Error('文章ID不能为空');
      }

      await apiClient.post('/cgi-bin/freepublish/delete', {
        article_id: deleteArticleId,
        ...(params.index === undefined ? {} : { index: params.index }),
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `发布文章删除成功！\n文章ID: ${deleteArticleId}\n索引: ${params.index ?? '未指定'}\n\n注意：删除已发布文章不可逆，且不会删除原始草稿。`,
        }],
      };
    }

    case 'list': {
      const {
        offset = 0,
        count = OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT,
        noContent = DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT,
      } = params;

      const result = await apiClient.post('/cgi-bin/freepublish/batchget', {
        offset,
        count,
        no_content: noContent,
      }) as any;

      return {
        content: [{
          type: 'text',
          text: formatPublishList(result, offset, count, noContent),
        }],
      };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * 发布工具处理器 (WechatToolContext)
 */
async function handlePublishTool(context: WechatToolContext): Promise<WechatToolResult> {
  const { args, apiClient } = context;
  const validatedArgs = publishToolSchema.parse(args);
  const { action, mediaId, publishId, articleId, index, offset, count, noContent, no_content } = validatedArgs;

  return handlePublishCore(action, {
    mediaId,
    publishId,
    articleId,
    index,
    offset,
    count,
    noContent: noContent ?? no_content,
  }, apiClient);
}

/**
 * MCP发布工具处理器
 */
async function handlePublishMcpTool(args: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> {
  const validatedArgs = publishToolSchema.parse(args);
  const { action, mediaId, publishId, articleId, index, offset, count, noContent, no_content } = validatedArgs;

  return handlePublishCore(action, {
    mediaId,
    publishId,
    articleId,
    index,
    offset,
    count,
    noContent: noContent ?? no_content,
  }, apiClient);
}

/**
 * 微信公众号发布工具
 */
export const publishTool: WechatToolDefinition = {
  name: 'wechat_publish',
  description: '管理微信公众号文章发布',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['submit', 'get', 'delete', 'list'],
        description: '操作类型',
      },
      mediaId: {
        type: 'string',
        description: '草稿 Media ID',
      },
      publishId: {
        type: 'string',
        description: '发布 ID（get 查询状态时必需；delete 兼容旧参数但建议使用 articleId）',
      },
      articleId: {
        type: 'string',
        description: '已发布文章 article_id（delete 时必需）',
      },
      index: {
        type: 'number',
        minimum: 0,
        maximum: 20,
        description: '要删除的图文索引（delete 时可选；不传则按官方接口默认行为处理）',
      },
      offset: {
        type: 'number',
        minimum: 0,
        default: 0,
        description: '偏移量（list 时使用，默认0）',
      },
      count: {
        type: 'number',
        minimum: 1,
        maximum: OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT,
        default: OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT,
        description: '数量（list 时使用，默认20，官方上限20）',
      },
      noContent: {
        type: 'number',
        enum: [0, 1],
        description: '是否不返回 content 字段（list 时使用，默认1；传0可返回正文内容）',
      },
      no_content: {
        type: 'number',
        enum: [0, 1],
        default: DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT,
        description: 'noContent 的官方字段别名（list 时使用，默认1）',
      },
    },
    required: ['action'],
  },
  handler: handlePublishTool,
};

/**
 * MCP发布工具
 */
export const publishMcpTool: McpTool = {
  name: 'wechat_publish',
  description: '管理微信公众号文章发布',
  inputSchema: {
    action: z.enum(['submit', 'get', 'delete', 'list']).describe('操作类型：submit(提交发布), get(查询状态), delete(删除发布), list(发布列表)'),
    mediaId: z.string().optional().describe('草稿 Media ID（提交发布时必需）'),
    publishId: z.string().optional().describe('发布 ID（查询状态时必需；delete 兼容旧参数但建议使用 articleId）'),
    articleId: z.string().optional().describe('已发布文章 article_id（删除已发布文章时必需）'),
    index: z.number().int().min(0).max(20).optional().describe('要删除的图文索引（删除已发布文章时可选；不传则按官方接口默认行为处理）'),
    offset: z.number().int().min(0).default(0).describe('偏移量（列表时使用，默认0）'),
    count: z.number().int().min(1).max(20).default(OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT).describe('数量（列表时使用，默认20，官方上限20）'),
    noContent: z.number().int().min(0).max(1).optional().describe('是否不返回 content 字段（列表时使用，默认1；传0可返回正文内容）'),
    no_content: z.number().int().min(0).max(1).default(DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT).describe('noContent 的官方字段别名（列表时使用，默认1）'),
  },
  handler: handlePublishMcpTool,
};
