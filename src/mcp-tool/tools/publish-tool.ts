import { z } from 'zod';
import { WechatToolDefinition, WechatToolContext, WechatToolResult, McpTool, WechatApiClient } from '../types.js';
import { logger } from '../../utils/logger.js';

const OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT = 20;
const DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT = 1;

// 发布工具参数 Schema
const publishToolSchema = z.object({
  action: z.enum(['submit', 'get', 'delete', 'list']),
  mediaId: z.string().optional(),
  publishId: z.string().optional(),
  offset: z.number().int().min(0).default(0),
  count: z.number().int().min(1).max(20).default(OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT),
  noContent: z.number().int().min(0).max(1).optional(),
  no_content: z.number().int().min(0).max(1).default(DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT),
});

const PUBLISH_STATUS_MAP: { [key: number]: string } = {
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
 * 发布工具处理器
 */
async function handlePublishTool(context: WechatToolContext): Promise<WechatToolResult> {
  const { args, apiClient } = context;
  
  try {
    const validatedArgs = publishToolSchema.parse(args);
    const { action } = validatedArgs;

    switch (action) {
      case 'submit': {
        const { mediaId } = validatedArgs;
        
        if (!mediaId) {
          throw new Error('草稿ID不能为空');
        }
        
        try {
          const result = await apiClient.post('/cgi-bin/freepublish/submit', {
            media_id: mediaId
          }) as any;
          
          return {
            content: [{
              type: 'text',
              text: `发布提交成功！\n发布ID: ${result.publish_id}\n草稿ID: ${mediaId}\n\n注意：发布结果将通过事件推送通知，请关注推送消息。`,
            }],
          };
        } catch (error) {
          throw new Error(`发布提交失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      case 'get': {
        const { publishId } = validatedArgs;
        
        if (!publishId) {
          throw new Error('发布ID不能为空');
        }
        
        try {
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
        } catch (error) {
          throw new Error(`查询发布状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      case 'delete': {
        const { publishId: deletePublishId } = validatedArgs;
        
        if (!deletePublishId) {
          throw new Error('发布ID不能为空');
        }
        
        try {
          await apiClient.post('/cgi-bin/freepublish/delete', {
            publish_id: deletePublishId
          }) as any;
          
          return {
            content: [{
              type: 'text',
              text: `发布删除成功！\n发布ID: ${deletePublishId}\n\n注意：删除发布不会删除草稿，如需删除草稿请使用草稿管理工具。`,
            }],
          };
        } catch (error) {
          throw new Error(`删除发布失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      case 'list': {
        const {
          offset = 0,
          count = OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT,
          noContent,
          no_content,
        } = validatedArgs;
        const resolvedNoContent = noContent ?? no_content ?? DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT;
        
        try {
          const result = await apiClient.post('/cgi-bin/freepublish/batchget', {
            offset,
            count,
            no_content: resolvedNoContent,
          }) as any;
          
          return {
            content: [{
              type: 'text',
              text: formatPublishList(result, offset, count, resolvedNoContent),
            }],
          };
        } catch (error) {
          throw new Error(`获取发布列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error('Publish tool error:', error);
    return {
      content: [{
        type: 'text',
        text: `发布操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }],
      isError: true,
    };
  }
}

/**
 * MCP发布工具处理器
 */
async function handlePublishMcpTool(args: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> {
  const {
    action,
    mediaId,
    publishId,
    offset = 0,
    count = OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT,
    noContent,
    no_content,
  } = args as any;
  
  try {
    switch (action) {
      case 'submit': {
        if (!mediaId) {
          throw new Error('草稿ID不能为空');
        }
        
        try {
          const result = await apiClient.post('/cgi-bin/freepublish/submit', {
            media_id: mediaId
          }) as any;
          
          return {
            content: [{
              type: 'text',
              text: `发布提交成功！\n发布ID: ${result.publish_id}\n草稿ID: ${mediaId}\n\n注意：发布结果将通过事件推送通知，请关注推送消息。`,
            }],
          };
        } catch (error) {
          throw new Error(`发布提交失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      case 'get': {
        if (!publishId) {
          throw new Error('发布ID不能为空');
        }
        
        try {
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
        } catch (error) {
          throw new Error(`查询发布状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      case 'delete': {
        if (!publishId) {
          throw new Error('发布ID不能为空');
        }
        
        try {
          await apiClient.post('/cgi-bin/freepublish/delete', {
            publish_id: publishId
          }) as any;
          
          return {
            content: [{
              type: 'text',
              text: `发布删除成功！\n发布ID: ${publishId}\n\n注意：删除发布不会删除草稿，如需删除草稿请使用草稿管理工具。`,
            }],
          };
        } catch (error) {
          throw new Error(`删除发布失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      case 'list': {
        const resolvedNoContent = noContent ?? no_content ?? DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT;

        try {
          const result = await apiClient.post('/cgi-bin/freepublish/batchget', {
            offset,
            count,
            no_content: resolvedNoContent,
          }) as any;
          
          return {
            content: [{
              type: 'text',
              text: formatPublishList(result, offset, count, resolvedNoContent),
            }],
          };
        } catch (error) {
          throw new Error(`获取发布列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error('Publish MCP tool error:', error);
    return {
      content: [{
        type: 'text',
        text: `发布操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }],
      isError: true,
    };
  }
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
        description: '发布 ID',
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
    publishId: z.string().optional().describe('发布 ID（查询状态、删除时必需）'),
    offset: z.number().int().min(0).default(0).describe('偏移量（列表时使用，默认0）'),
    count: z.number().int().min(1).max(20).default(OFFICIAL_FREEPUBLISH_BATCHGET_MAX_COUNT).describe('数量（列表时使用，默认20，官方上限20）'),
    noContent: z.number().int().min(0).max(1).optional().describe('是否不返回 content 字段（列表时使用，默认1；传0可返回正文内容）'),
    no_content: z.number().int().min(0).max(1).default(DEFAULT_FREEPUBLISH_BATCHGET_NO_CONTENT).describe('noContent 的官方字段别名（列表时使用，默认1）'),
  },
  handler: handlePublishMcpTool,
};
