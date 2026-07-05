import { z } from 'zod';
import { McpTool, WechatApiClient, WechatToolResult } from '../types.js';
import { draftArticleSchema, mediaIdSchema } from '../../utils/validation.js';
import { formatDraftArticle } from './draft-tool.js';

const contentPublishToolSchema = z.object({
  action: z.enum(['create_draft', 'publish_draft', 'create_and_publish']),
  contentType: z.enum(['article', 'image', 'video']).default('article')
    .describe('内容类型：article=图文消息，image=图片消息/贴图(newspic)，video=视频素材（官方发布接口暂不支持视频草稿发布）'),
  mediaId: mediaIdSchema.optional().describe('草稿 Media ID（publish_draft 时必需）'),
  title: z.string().min(1).max(64).optional().describe('标题；未传 articles/article 时用于构造单篇内容'),
  content: z.string().min(1).optional().describe('正文；图片消息仅支持纯文本和部分特殊功能标签'),
  author: z.string().max(32).optional(),
  digest: z.string().max(256).optional(),
  contentSourceUrl: z.string().optional(),
  thumbMediaId: mediaIdSchema.optional().describe('图文消息封面永久MediaID（article 必需）'),
  imageMediaIds: z.array(mediaIdSchema).min(1).max(20).optional()
    .describe('图片消息/贴图永久MediaID列表（image 必需，最多20张）'),
  needOpenComment: z.number().int().min(0).max(1).optional(),
  onlyFansCanComment: z.number().int().min(0).max(1).optional(),
  article: draftArticleSchema.optional().describe('单篇草稿内容；优先于 title/content 等顶层字段'),
  articles: z.array(draftArticleSchema).min(1).max(8).optional().describe('多篇草稿内容；优先级最高'),
});

function unsupportedVideoPublishResult(): WechatToolResult {
  return {
    content: [{
      type: 'text',
      text: '官方服务号发布接口目前只支持将图文/图片消息草稿提交发布（/cgi-bin/freepublish/submit）。未发现视频草稿发布 API。视频可使用 wechat_permanent_media 上传永久视频素材（/cgi-bin/material/add_material?type=video），或用 wechat_mass_send 的 mpvideo 进行群发。',
    }],
    isError: true,
  };
}

function buildArticles(args: z.infer<typeof contentPublishToolSchema>) {
  if (args.articles?.length) {
    return args.articles;
  }
  if (args.article) {
    return [args.article];
  }

  if (!args.title || !args.content) {
    throw new Error('create_draft/create_and_publish 需要 articles、article，或同时提供 title 和 content');
  }

  if (args.contentType === 'image') {
    if (!args.imageMediaIds?.length) {
      throw new Error('图片消息/贴图需要 imageMediaIds（永久图片素材 MediaID，最多20张）');
    }
    return [{
      articleType: 'newspic' as const,
      title: args.title,
      content: args.content,
      imageMediaIds: args.imageMediaIds,
      needOpenComment: args.needOpenComment,
      onlyFansCanComment: args.onlyFansCanComment,
    }];
  }

  if (!args.thumbMediaId) {
    throw new Error('图文消息需要 thumbMediaId（永久图片素材 MediaID）');
  }
  return [{
    articleType: 'news' as const,
    title: args.title,
    author: args.author,
    digest: args.digest,
    content: args.content,
    contentSourceUrl: args.contentSourceUrl,
    thumbMediaId: args.thumbMediaId,
    needOpenComment: args.needOpenComment,
    onlyFansCanComment: args.onlyFansCanComment,
  }];
}

function formatSubmitResult(result: any, mediaId: string): string {
  return `发布提交成功！\n发布ID: ${result.publish_id}\n草稿ID: ${mediaId}\n消息数据ID: ${result.msg_data_id ?? '未返回'}\n\n注意：发布接口只表示任务提交成功，最终结果请使用 wechat_publish.get 查询或等待 PUBLISHJOBFINISH 事件。`;
}

export const contentPublishMcpTool: McpTool = {
  name: 'wechat_content_publish',
  description: '统一创建并发布公众号内容：支持图文(article)和图片消息/贴图(image/newspic)；视频仅支持官方素材上传/群发，不支持作为草稿发布',
  inputSchema: {
    action: z.enum(['create_draft', 'publish_draft', 'create_and_publish']).describe('create_draft=创建草稿，publish_draft=提交发布已有草稿，create_and_publish=创建后立即提交发布'),
    contentType: z.enum(['article', 'image', 'video']).default('article').describe('article=图文消息，image=图片消息/贴图(newspic)，video=视频素材（官方发布接口不支持视频草稿发布）'),
    mediaId: z.string().optional().describe('草稿 Media ID（publish_draft 时必需）'),
    title: z.string().optional().describe('标题；未传 articles/article 时用于构造单篇内容'),
    content: z.string().optional().describe('正文；图片消息仅支持纯文本和部分特殊功能标签'),
    author: z.string().optional().describe('作者（article 可选）'),
    digest: z.string().optional().describe('摘要（article 可选）'),
    contentSourceUrl: z.string().optional().describe('阅读原文链接（article 可选）'),
    thumbMediaId: z.string().optional().describe('图文消息封面永久MediaID（article 必需）'),
    imageMediaIds: z.array(z.string()).optional().describe('图片消息/贴图永久MediaID列表（image 必需，最多20张）'),
    needOpenComment: z.number().int().min(0).max(1).optional().describe('是否开启评论'),
    onlyFansCanComment: z.number().int().min(0).max(1).optional().describe('是否仅粉丝可评论'),
    article: draftArticleSchema.optional().describe('单篇草稿内容；优先于 title/content 等顶层字段'),
    articles: z.array(draftArticleSchema).optional().describe('多篇草稿内容；优先级最高'),
  },
  handler: async (params: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
    const args = contentPublishToolSchema.parse(params);

    if (args.contentType === 'video') {
      return unsupportedVideoPublishResult();
    }

    if (args.action === 'publish_draft') {
      if (!args.mediaId) {
        throw new Error('publish_draft 需要 mediaId（草稿 Media ID）');
      }
      const result = await apiClient.post('/cgi-bin/freepublish/submit', {
        media_id: args.mediaId,
      }) as any;
      return {
        content: [{ type: 'text', text: formatSubmitResult(result, args.mediaId) }],
      };
    }

    const articles = buildArticles(args);
    const draftResult = await apiClient.post('/cgi-bin/draft/add', {
      articles: articles.map(formatDraftArticle),
    }) as any;
    const createdMediaId = draftResult.media_id;
    if (!createdMediaId) {
      throw new Error(`草稿创建接口未返回 media_id: ${JSON.stringify(draftResult)}`);
    }

    if (args.action === 'create_draft') {
      return {
        content: [{
          type: 'text',
          text: `草稿创建成功！\n内容类型: ${args.contentType}\n草稿ID: ${createdMediaId}\n包含文章数: ${articles.length}`,
        }],
      };
    }

    const submitResult = await apiClient.post('/cgi-bin/freepublish/submit', {
      media_id: createdMediaId,
    }) as any;

    return {
      content: [{
        type: 'text',
        text: `草稿创建并提交发布成功！\n内容类型: ${args.contentType}\n草稿ID: ${createdMediaId}\n包含文章数: ${articles.length}\n\n${formatSubmitResult(submitResult, createdMediaId)}`,
      }],
    };
  },
};
