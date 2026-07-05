import { WechatToolDefinition, McpTool, WechatApiClient, WechatToolContext, WechatToolResult } from '../types.js';
import { z } from 'zod';
import { draftArticleSchema, mediaIdSchema } from '../../utils/validation.js';

const OFFICIAL_DRAFT_BATCHGET_MAX_COUNT = 20;
const DEFAULT_DRAFT_BATCHGET_NO_CONTENT = 1;

// 草稿工具参数 Schema
const draftToolSchema = z.object({
  action: z.enum(['add', 'update', 'get', 'delete', 'list', 'count']),
  mediaId: mediaIdSchema.optional(),
  index: z.number().int().min(0).optional(),
  articles: z.array(draftArticleSchema).optional(),
  offset: z.number().int().min(0).default(0),
  count: z.number().int().min(1).max(20).default(OFFICIAL_DRAFT_BATCHGET_MAX_COUNT),
  noContent: z.number().int().min(0).max(1).optional(),
  no_content: z.number().int().min(0).max(1).default(DEFAULT_DRAFT_BATCHGET_NO_CONTENT),
});

function toOfficialCropPercentList(coverInfo: any) {
  const list = coverInfo?.cropPercentList;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list.map((item: any) => ({
    ...(item.ratio ? { ratio: item.ratio } : {}),
    ...(item.x1 ? { x1: item.x1 } : {}),
    ...(item.y1 ? { y1: item.y1 } : {}),
    ...(item.x2 ? { x2: item.x2 } : {}),
    ...(item.y2 ? { y2: item.y2 } : {}),
  }));
}

function toOfficialImageInfo(article: any) {
  if (article.imageInfo?.imageList?.length) {
    return {
      image_list: article.imageInfo.imageList.map((item: any) => ({
        image_media_id: item.imageMediaId,
      })),
    };
  }

  if (article.imageMediaIds?.length) {
    return {
      image_list: article.imageMediaIds.map((imageMediaId: string) => ({
        image_media_id: imageMediaId,
      })),
    };
  }

  return undefined;
}

export function formatDraftArticle(article: any) {
  const articleType = article.articleType ?? (article.imageInfo || article.imageMediaIds ? 'newspic' : 'news');
  const formatted: Record<string, unknown> = {
    article_type: articleType,
    title: article.title,
    content: article.content,
    need_open_comment: article.needOpenComment || 0,
    only_fans_can_comment: article.onlyFansCanComment || 0,
  };

  if (article.author) formatted.author = article.author;
  if (article.digest) formatted.digest = article.digest;
  if (article.contentSourceUrl) formatted.content_source_url = article.contentSourceUrl;

  if (articleType === 'news') {
    formatted.thumb_media_id = article.thumbMediaId;
    formatted.show_cover_pic = article.showCoverPic || 0;
    if (article.picCrop2351) formatted.pic_crop_235_1 = article.picCrop2351;
    if (article.picCrop11) formatted.pic_crop_1_1 = article.picCrop11;
    return formatted;
  }

  const imageInfo = toOfficialImageInfo(article);
  if (imageInfo) formatted.image_info = imageInfo;

  const cropPercentList = toOfficialCropPercentList(article.coverInfo);
  if (cropPercentList) {
    formatted.cover_info = { crop_percent_list: cropPercentList };
  }

  if (article.productInfo) formatted.product_info = article.productInfo;
  return formatted;
}

/**
 * 草稿工具核心处理逻辑
 * 统一处理所有草稿相关操作
 */
async function handleDraftOperations(
  action: string,
  params: {
    mediaId?: string;
    index?: number;
    articles?: any[];
    offset?: number;
    count?: number;
    noContent?: number;
  },
  apiClient: WechatApiClient
): Promise<WechatToolResult> {
  switch (action) {
    case 'add': {
      const { articles } = params;

      if (!articles || articles.length === 0) {
        throw new Error('文章内容不能为空');
      }

      const result = await apiClient.post('/cgi-bin/draft/add', {
        articles: articles.map((article: any) => formatDraftArticle(article))
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `草稿创建成功！\n草稿ID: ${result.media_id}\n包含文章数: ${articles.length}`,
        }],
      };
    }

    case 'update': {
      const { mediaId, index, articles } = params;

      if (!mediaId) {
        throw new Error('草稿ID不能为空');
      }

      if (index === undefined) {
        throw new Error('更新草稿时必须提供文章索引 index');
      }

      if (!articles || articles.length !== 1) {
        throw new Error('更新草稿时必须提供且仅提供一篇文章内容');
      }

      await apiClient.post('/cgi-bin/draft/update', {
        media_id: mediaId,
        index,
        articles: formatDraftArticle(articles[0]),
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `草稿更新成功！\n草稿ID: ${mediaId}\n更新索引: ${index}`,
        }],
      };
    }

    case 'get': {
      const { mediaId } = params;

      if (!mediaId) {
        throw new Error('草稿ID不能为空');
      }

      const result = await apiClient.post('/cgi-bin/draft/get', {
        media_id: mediaId
      }) as any;

      const articles = result.news_item.map((item: any, index: number) =>
        `第${index + 1}篇:\n` +
        `标题: ${item.title}\n` +
        `作者: ${item.author || '未设置'}\n` +
        `摘要: ${item.digest || '无'}\n` +
        `内容: ${item.content.substring(0, 100)}${item.content.length > 100 ? '...' : ''}\n` +
        `原文链接: ${item.content_source_url || '无'}\n` +
        `文章类型: ${item.article_type || 'news'}\n` +
        `封面图ID: ${item.thumb_media_id || item.image_info?.image_list?.[0]?.image_media_id || '无'}\n` +
        `显示封面: ${item.show_cover_pic ? '是' : '否'}\n`
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `获取草稿成功！\n草稿ID: ${mediaId}\n创建时间: ${new Date(result.create_time * 1000).toLocaleString()}\n更新时间: ${new Date(result.update_time * 1000).toLocaleString()}\n\n${articles}`,
        }],
      };
    }

    case 'delete': {
      const { mediaId } = params;

      if (!mediaId) {
        throw new Error('草稿ID不能为空');
      }

      await apiClient.post('/cgi-bin/draft/delete', {
        media_id: mediaId
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `草稿删除成功！\n草稿ID: ${mediaId}`,
        }],
      };
    }

    case 'list': {
      const {
        offset = 0,
        count = OFFICIAL_DRAFT_BATCHGET_MAX_COUNT,
        noContent = DEFAULT_DRAFT_BATCHGET_NO_CONTENT,
      } = params;

      const result = await apiClient.post('/cgi-bin/draft/batchget', {
        offset,
        count,
        no_content: noContent,
      }) as any;

      const draftList = result.item.map((item: any, index: number) => {
        const newsItems = item.content?.news_item ?? [];
        const firstArticle = newsItems[0];
        const articleCount = newsItems.length;
        const updateTime = item.content?.update_time ?? item.update_time;

        if (!firstArticle) {
          return `${offset + index + 1}. 草稿ID: ${item.media_id}\n` +
                 `   标题: 未返回（no_content=${noContent}）\n` +
                 `   更新时间: ${updateTime ? new Date(updateTime * 1000).toLocaleString() : '未知'}\n` +
                 `   提示: 如需标题/正文摘要，请显式传 noContent: 0 后重试`;
        }

        return `${offset + index + 1}. 草稿ID: ${item.media_id}\n` +
               `   标题: ${firstArticle.title}${articleCount > 1 ? ` (共${articleCount}篇)` : ''}\n` +
               `   类型: ${firstArticle.article_type || 'news'}\n` +
               `   作者: ${firstArticle.author || '未设置'}\n` +
               `   创建时间: ${item.content?.create_time ? new Date(item.content.create_time * 1000).toLocaleString() : '未知'}\n` +
               `   更新时间: ${updateTime ? new Date(updateTime * 1000).toLocaleString() : '未知'}`;
      }).join('\n\n');

      return {
        content: [{
          type: 'text',
          text: `草稿列表 (${offset + 1}-${offset + result.item.length}/${result.total_count}, count=${count}, no_content=${noContent}):\n\n${draftList}`,
        }],
      };
    }

    case 'count': {
      const result = await apiClient.post('/cgi-bin/draft/count') as any;

      return {
        content: [{
          type: 'text',
          text: `草稿统计信息：\n草稿总数: ${result.total_count} 个`,
        }],
      };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * 草稿工具处理器 (WechatToolContext)
 */
async function handleDraftTool(context: WechatToolContext): Promise<WechatToolResult> {
  const { args, apiClient } = context;
  const validatedArgs = draftToolSchema.parse(args);
  const { action, mediaId, index, articles, offset, count, noContent, no_content } = validatedArgs;

  return handleDraftOperations(action, {
    mediaId,
    index,
    articles,
    offset,
    count,
    noContent: noContent ?? no_content,
  }, apiClient);
}

/**
 * MCP草稿工具处理器 (直接参数)
 */
async function handleDraftMcpTool(args: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> {
  const validatedArgs = draftToolSchema.parse(args);
  const { action, mediaId, index, articles, offset, count, noContent, no_content } = validatedArgs;

  return handleDraftOperations(action, {
    mediaId,
    index,
    articles,
    offset,
    count,
    noContent: noContent ?? no_content,
  }, apiClient);
}

/**
 * 微信公众号草稿管理工具
 */
export const draftTool: WechatToolDefinition = {
  name: 'wechat_draft',
  description: '管理微信公众号草稿',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'update', 'get', 'delete', 'list', 'count'],
        description: '操作类型',
      },
      mediaId: {
        type: 'string',
        description: '草稿 Media ID',
      },
      index: {
        type: 'number',
        description: '草稿文章索引（update 时必需）',
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
        maximum: OFFICIAL_DRAFT_BATCHGET_MAX_COUNT,
        default: OFFICIAL_DRAFT_BATCHGET_MAX_COUNT,
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
        default: DEFAULT_DRAFT_BATCHGET_NO_CONTENT,
        description: 'noContent 的官方字段别名（list 时使用，默认1）',
      },
    },
    required: ['action'],
  },
  handler: handleDraftTool,
};

/**
 * MCP草稿工具
 */
export const draftMcpTool: McpTool = {
  name: 'wechat_draft',
  description: '管理微信公众号草稿',
  inputSchema: {
    action: z.enum(['add', 'update', 'get', 'delete', 'list', 'count']).describe('操作类型：add(创建), update(更新), get(获取), delete(删除), list(列表), count(统计)'),
    mediaId: z.string().optional().describe('草稿 Media ID（get、update、delete 时必需）'),
    index: z.number().int().min(0).optional().describe('草稿中的文章索引（update 时必需）'),
    articles: z.array(z.object({
      articleType: z.enum(['news', 'newspic']).optional().describe('官方文章类型：news=图文消息，newspic=图片消息/贴图；省略时按字段自动推断'),
      title: z.string().describe('文章标题'),
      author: z.string().optional().describe('作者'),
      digest: z.string().optional().describe('摘要'),
      content: z.string().describe('文章内容'),
      contentSourceUrl: z.string().optional().describe('原文链接'),
      thumbMediaId: z.string().optional().describe('图文消息封面图片永久MediaID（news 必需）'),
      imageMediaIds: z.array(z.string()).optional().describe('图片消息/贴图永久MediaID列表（newspic 必需，最多20张）'),
      imageInfo: z.object({
        imageList: z.array(z.object({
          imageMediaId: z.string().describe('图片消息里的图片永久MediaID'),
        })),
      }).optional().describe('官方 image_info 的 camelCase 结构；可用 imageMediaIds 简写替代'),
      coverInfo: z.object({
        cropPercentList: z.array(z.object({
          ratio: z.enum(['1_1', '16_9', '2.35_1']).optional(),
          x1: z.string().optional(),
          y1: z.string().optional(),
          x2: z.string().optional(),
          y2: z.string().optional(),
        })).optional(),
      }).optional().describe('图片消息封面裁剪信息'),
      productInfo: z.record(z.string(), z.unknown()).optional().describe('图片消息商品信息（如已开通相关能力）'),
      showCoverPic: z.number().optional().describe('是否显示封面图片'),
      needOpenComment: z.number().optional().describe('是否开启评论'),
      onlyFansCanComment: z.number().optional().describe('是否仅粉丝可评论'),
      picCrop2351: z.string().optional().describe('图文消息 2.35:1 封面裁剪坐标 X1_Y1_X2_Y2'),
      picCrop11: z.string().optional().describe('图文消息 1:1 封面裁剪坐标 X1_Y1_X2_Y2'),
    })).optional().describe('文章列表（add 时可传多篇，update 时必须且仅能传一篇）'),
    offset: z.number().int().min(0).default(0).describe('偏移量（列表时使用，默认0）'),
    count: z.number().int().min(1).max(20).default(OFFICIAL_DRAFT_BATCHGET_MAX_COUNT).describe('数量（列表时使用，默认20，官方上限20）'),
    noContent: z.number().int().min(0).max(1).optional().describe('是否不返回 content 字段（列表时使用，默认1；传0可返回正文内容）'),
    no_content: z.number().int().min(0).max(1).default(DEFAULT_DRAFT_BATCHGET_NO_CONTENT).describe('noContent 的官方字段别名（列表时使用，默认1）'),
  },
  handler: handleDraftMcpTool,
};
