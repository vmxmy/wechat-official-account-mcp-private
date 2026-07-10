import { z } from 'zod';
import type { McpTool, MediaInfo, WechatToolResult } from '../mcp-tool/types.js';
import { ALLOWED_MEDIA_TYPES, FILE_SIZE_LIMITS } from '../utils/validation.js';
import { accountFromParams } from './tenant-context.js';
import { createMediaUploadPrefix } from './media-upload.js';

const WORKERS_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const UPLOAD_IMG_SIZE_LIMIT_BYTES = 1024 * 1024;

type MediaKind = keyof typeof FILE_SIZE_LIMITS;

type WorkerMediaArgs = {
  filePath?: string;
  fileData?: string;
  fileUrl?: string;
  r2Key?: string;
  fileName?: string;
  mimeType?: string;
};

type ResolvedMedia = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  source: 'fileData' | 'fileUrl' | 'r2Key';
};

type R2ObjectBodyLike = {
  key?: string;
  size?: number;
  httpMetadata?: {
    contentType?: string;
  };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type R2BucketLike = {
  get(key: string): Promise<R2ObjectBodyLike | null>;
};

export interface WorkerMediaToolOptions {
  mediaBucket?: unknown;
  saveMedia?: (media: MediaInfo) => Promise<void>;
}

/**
 * Workers 专用媒体工具。
 *
 * MCP schema 仅公开 `fileUrl` 与 R2 key，避免本地路径失效或 base64 占用模型上下文。
 * `fileData` 仅保留为 handler 级短期兼容，不再向模型公开。
 */
export function createWorkerMediaTools(options: WorkerMediaToolOptions = {}): McpTool[] {
  return [
    createTemporaryMediaTool(options),
    createUploadImgTool(options),
    createPermanentMediaTool(options),
  ];
}

function createTemporaryMediaTool(options: WorkerMediaToolOptions): McpTool {
  return {
    name: 'wechat_media_upload',
    description: '上传和管理微信公众号临时素材（使用 fileUrl 或 r2Key；本地文件先通过 woa media upload 暂存到 R2）',
    inputSchema: {
      action: z.enum(['upload', 'get', 'list']).describe('操作类型：upload-上传素材, get-获取素材, list-列表素材'),
      type: z.enum(['image', 'voice', 'video', 'thumb']).optional().describe('素材类型：image-图片, voice-语音, video-视频, thumb-缩略图'),
      fileUrl: z.string().url().optional().describe('Workers 上传路径：远程 HTTPS 文件 URL'),
      r2Key: z.string().optional().describe('Workers 上传路径：Cloudflare R2 对象 key'),
      fileName: z.string().optional().describe('文件名（upload操作可选）'),
      mimeType: z.string().optional().describe('MIME 类型（R2 元数据缺失时建议提供）'),
      mediaId: z.string().optional().describe('媒体文件ID（get操作必需）'),
      title: z.string().optional().describe('视频素材的标题（video类型upload操作可选）'),
      introduction: z.string().optional().describe('视频素材的描述（video类型upload操作可选）'),
    },
    handler: async (args: unknown, apiClient: any): Promise<WechatToolResult> => {
      const params = args as WorkerMediaArgs & {
        action?: 'upload' | 'get' | 'list';
        type?: MediaKind;
        mediaId?: string;
        title?: string;
        introduction?: string;
      };

      try {
        switch (params.action) {
          case 'upload': {
            if (!params.type) {
              throw new Error('Media type is required for upload');
            }

            const media = await resolveWorkerMedia(params, {
              mediaBucket: options.mediaBucket,
              defaultFileName: defaultFileNameForType(params.type),
              maxBytes: FILE_SIZE_LIMITS[params.type],
            });
            validateMediaPayload(media, params.type, FILE_SIZE_LIMITS[params.type], allowedMimeTypesForMediaType(params.type));

            const formData = toWechatFormData(media);
            if (params.type === 'video' && (params.title || params.introduction)) {
              formData.append('description', JSON.stringify({
                title: params.title || '视频标题',
                introduction: params.introduction || '视频简介',
              }));
            }

            const result = await apiClient.postForm(`/cgi-bin/media/upload?type=${params.type}`, formData) as any;

            if (options.saveMedia && result.media_id) {
              await options.saveMedia({
                mediaId: result.media_id,
                type: result.type as MediaKind,
                createdAt: Number(result.created_at ?? Math.floor(Date.now() / 1000)) * 1000,
                url: `${media.source}:${media.fileName}`,
              });
            }

            return {
              content: [{
                type: 'text',
                text: `临时素材上传成功！\n素材ID: ${result.media_id}\n类型: ${result.type}\n文件名: ${media.fileName}\n来源: ${media.source}\n创建时间: ${new Date(Number(result.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toLocaleString()}`,
              }],
            };
          }

          case 'get': {
            if (!params.mediaId) {
              throw new Error('素材ID不能为空');
            }
            await apiClient.get(`/cgi-bin/media/get?media_id=${params.mediaId}`);
            return {
              content: [{
                type: 'text',
                text: `获取临时素材请求成功！\n素材ID: ${params.mediaId}\nWorkers 运行时不会写入本地文件系统。`,
              }],
            };
          }

          case 'list':
            return {
              content: [{
                type: 'text',
                text: '临时素材列表功能暂不支持，临时素材有效期为3天，建议使用永久素材功能',
              }],
            };

          default:
            throw new Error(`Unknown action: ${String(params.action)}`);
        }
      } catch (error) {
        return toolError('素材操作失败', error);
      }
    },
  };
}

function createUploadImgTool(options: WorkerMediaToolOptions): McpTool {
  return {
    name: 'wechat_upload_img',
    description: '上传图文消息内所需的图片，不占用素材库限制（使用 fileUrl 或 r2Key；本地文件先通过 woa media upload 暂存到 R2）',
    inputSchema: {
      fileUrl: z.string().url().optional().describe('Workers 上传路径：远程 HTTPS 图片 URL'),
      r2Key: z.string().optional().describe('Workers 上传路径：Cloudflare R2 图片对象 key'),
      fileName: z.string().optional().describe('文件名（可选，默认从 URL/R2 key 提取或使用 image.jpg）'),
      mimeType: z.string().optional().describe('MIME 类型（R2 元数据缺失时建议提供）'),
    },
    handler: async (args: unknown, apiClient: any): Promise<WechatToolResult> => {
      try {
        const media = await resolveWorkerMedia(args as WorkerMediaArgs, {
          mediaBucket: options.mediaBucket,
          defaultFileName: 'image.jpg',
          maxBytes: UPLOAD_IMG_SIZE_LIMIT_BYTES,
        });
        validateMediaPayload(media, 'image', UPLOAD_IMG_SIZE_LIMIT_BYTES, new Set(['image/jpeg', 'image/jpg', 'image/png']));

        const response = await apiClient.postForm('/cgi-bin/media/uploadimg', toWechatFormData(media)) as any;

        return {
          content: [{
            type: 'text',
            text: `图片上传成功！\n图片URL: ${response.url}\n文件名: ${media.fileName}\n文件大小: ${media.bytes.byteLength} 字节\n格式: ${media.mimeType}`,
          }],
        };
      } catch (error) {
        return toolError('图片上传失败', error);
      }
    },
  };
}

function createPermanentMediaTool(options: WorkerMediaToolOptions): McpTool {
  return {
    name: 'wechat_permanent_media',
    description: '管理微信公众号永久素材，上传使用 fileUrl 或 r2Key；本地文件先通过 woa media upload 暂存到 R2',
    inputSchema: {
      action: z.enum(['add', 'get', 'delete', 'list', 'count']).describe('操作类型：add-添加素材, get-获取素材, delete-删除素材, list-获取素材列表, count-获取素材总数'),
      type: z.enum(['image', 'voice', 'video', 'thumb', 'news']).optional().describe('素材类型：image-图片, voice-语音, video-视频, thumb-缩略图, news-图文素材'),
      mediaId: z.string().optional().describe('媒体文件ID（get和delete操作必需）'),
      fileUrl: z.string().url().optional().describe('Workers 上传路径：远程 HTTPS 文件 URL'),
      r2Key: z.string().optional().describe('Workers 上传路径：Cloudflare R2 对象 key'),
      fileName: z.string().optional().describe('文件名（add操作可选）'),
      mimeType: z.string().optional().describe('MIME 类型（R2 元数据缺失时建议提供）'),
      articles: z.array(z.any()).optional().describe('图文素材文章列表（news类型add操作必需）'),
      title: z.string().optional().describe('视频素材的标题（video类型add操作必需）'),
      introduction: z.string().optional().describe('视频素材的描述（video类型add操作必需）'),
      offset: z.number().int().min(0).default(0).describe('从全部素材中的该偏移位置开始返回（list操作可选，默认0）'),
      count: z.number().int().min(1).max(20).default(20).describe('返回素材的数量（list操作可选，默认20，最大20）'),
    },
    handler: async (args: unknown, apiClient: any): Promise<WechatToolResult> => {
      const params = args as WorkerMediaArgs & {
        action?: 'add' | 'get' | 'delete' | 'list' | 'count';
        type?: MediaKind | 'news';
        mediaId?: string;
        articles?: any[];
        title?: string;
        introduction?: string;
        offset?: number;
        count?: number;
      };

      try {
        switch (params.action) {
          case 'add': {
            if (!params.type) {
              throw new Error('素材类型不能为空');
            }

            if (params.type === 'news') {
              if (!params.articles || params.articles.length === 0) {
                throw new Error('news 类型 add 操作需要 articles 参数');
              }
              const result = await apiClient.addNews(params.articles) as any;
              return {
                content: [{
                  type: 'text',
                  text: `永久图文素材创建成功！\n素材ID: ${result.mediaId}\n包含文章数: ${params.articles.length}`,
                }],
              };
            }

            const mediaType = params.type;
            const media = await resolveWorkerMedia(params, {
              mediaBucket: options.mediaBucket,
              defaultFileName: defaultFileNameForType(mediaType),
              maxBytes: FILE_SIZE_LIMITS[mediaType],
            });
            validateMediaPayload(media, mediaType, FILE_SIZE_LIMITS[mediaType], allowedMimeTypesForMediaType(mediaType));

            const formData = toWechatFormData(media);
            if (mediaType === 'video' && (params.title || params.introduction)) {
              formData.append('description', JSON.stringify({
                title: params.title || '视频标题',
                introduction: params.introduction || '视频简介',
              }));
            }

            const result = await apiClient.postForm(`/cgi-bin/material/add_material?type=${mediaType}`, formData) as any;
            return {
              content: [{
                type: 'text',
                text: `永久素材上传成功！\n素材ID: ${result.media_id}${result.url ? `\n素材URL: ${result.url}` : ''}\n文件名: ${media.fileName}\n来源: ${media.source}`,
              }],
            };
          }

          case 'get': {
            if (!params.mediaId) {
              throw new Error('素材ID不能为空');
            }
            const result = await apiClient.post('/cgi-bin/material/get_material', { media_id: params.mediaId }) as any;
            if (result.news_item) {
              const articles = result.news_item.map((item: any, index: number) =>
                `第${index + 1}篇:\n` +
                `标题: ${item.title}\n` +
                `作者: ${item.author || '未设置'}\n` +
                `摘要: ${item.digest || '无'}\n` +
                `链接: ${item.url}\n` +
                `封面图: ${item.thumb_url}\n`,
              ).join('\n');

              return {
                content: [{
                  type: 'text',
                  text: `获取永久图文素材成功！\n\n${articles}`,
                }],
              };
            }

            return {
              content: [{
                type: 'text',
                text: `获取永久素材成功！\n素材ID: ${params.mediaId}${result.url ? `\n素材URL: ${result.url}` : ''}`,
              }],
            };
          }

          case 'delete': {
            if (!params.mediaId) {
              throw new Error('素材ID不能为空');
            }
            await apiClient.post('/cgi-bin/material/del_material', { media_id: params.mediaId });
            return {
              content: [{
                type: 'text',
                text: `永久素材删除成功！\n素材ID: ${params.mediaId}`,
              }],
            };
          }

          case 'list': {
            if (!params.type) {
              throw new Error('素材类型不能为空');
            }
            const offset = params.offset ?? 0;
            const count = params.count ?? 20;
            const result = await apiClient.post('/cgi-bin/material/batchget_material', {
              type: params.type,
              offset,
              count,
            }) as any;
            const items = result.item ?? [];

            if (params.type === 'news') {
              const newsList = items.map((item: any, index: number) => {
                const articles = (item.content?.news_item ?? []).map((article: any, articleIndex: number) =>
                  `  第${articleIndex + 1}篇: ${article.title}`,
                ).join('\n');
                return `${offset + index + 1}. 素材ID: ${item.media_id}\n` +
                  `   更新时间: ${new Date(Number(item.update_time ?? 0) * 1000).toLocaleString()}\n` +
                  `   文章列表:\n${articles}`;
              }).join('\n\n');

              return {
                content: [{
                  type: 'text',
                  text: `永久图文素材列表 (${offset + 1}-${offset + items.length}/${result.total_count ?? items.length}):\n\n${newsList}`,
                }],
              };
            }

            const mediaList = items.map((item: any, index: number) =>
              `${offset + index + 1}. 素材ID: ${item.media_id}\n` +
              `   文件名: ${item.name}\n` +
              `   更新时间: ${new Date(Number(item.update_time ?? 0) * 1000).toLocaleString()}${item.url ? `\n   URL: ${item.url}` : ''}`,
            ).join('\n\n');

            return {
              content: [{
                type: 'text',
                text: `永久${params.type}素材列表 (${offset + 1}-${offset + items.length}/${result.total_count ?? items.length}):\n\n${mediaList}`,
              }],
            };
          }

          case 'count': {
            const result = await apiClient.get('/cgi-bin/material/get_materialcount') as any;
            return {
              content: [{
                type: 'text',
                text: `永久素材统计信息：\n` +
                  `图片素材: ${result.image_count} 个\n` +
                  `语音素材: ${result.voice_count} 个\n` +
                  `视频素材: ${result.video_count} 个\n` +
                  `图文素材: ${result.news_count} 个`,
              }],
            };
          }

          default:
            throw new Error(`Unknown action: ${String(params.action)}`);
        }
      } catch (error) {
        return toolError('永久素材操作失败', error);
      }
    },
  };
}

async function resolveWorkerMedia(
  args: WorkerMediaArgs,
  options: { mediaBucket?: unknown; defaultFileName: string; maxBytes?: number },
): Promise<ResolvedMedia> {
  if (args.filePath) {
    throw new Error('HTTP-only 运行时不支持 filePath，本地文件请先执行 woa media upload <path>，再使用返回的 r2Key。');
  }

  const sourceCount = [args.fileData, args.fileUrl, args.r2Key].filter(Boolean).length;
  if (sourceCount === 0) {
    throw new Error('请提供 fileUrl 或 r2Key；本地文件请先通过 woa media upload 暂存到 R2');
  }
  if (sourceCount > 1) {
    throw new Error('fileUrl、r2Key、fileData 只能提供一个，避免上传来源歧义');
  }

  if (args.fileUrl) {
    const maxBytes = maxResolvedMediaBytes(options);
    const url = new URL(args.fileUrl);
    if (url.protocol !== 'https:') {
      throw new Error('fileUrl 仅支持 HTTPS URL，避免远程媒体在上传前经过明文传输');
    }

    const response = await fetch(url.toString(), { redirect: 'manual' });
    rejectUnsafeRedirect(response, url);
    if (!response.ok) {
      throw new Error(`下载 fileUrl 失败: HTTP ${response.status}`);
    }

    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    assertSizeLimit(declaredSize, maxBytes, 'fileUrl content-length');
    const bytes = await readResponseBytes(response, maxBytes);
    return {
      bytes,
      fileName: args.fileName || fileNameFromPath(url.pathname) || options.defaultFileName,
      mimeType: normalizeMimeType(args.mimeType || response.headers.get('content-type') || inferMimeType(args.fileName || url.pathname)),
      source: 'fileUrl',
    };
  }

  if (args.r2Key) {
    const maxBytes = maxResolvedMediaBytes(options);
    assertStagedR2KeyAccess(args, args.r2Key);
    const bucket = options.mediaBucket as R2BucketLike | undefined;
    if (!bucket?.get) {
      throw new Error('R2 MEDIA binding is not configured; cannot read r2Key');
    }

    const object = await bucket.get(args.r2Key);
    if (!object) {
      throw new Error(`R2 对象不存在: ${args.r2Key}`);
    }

    if (typeof object.size !== 'number') {
      throw new Error('R2 object size unavailable; cannot enforce upload size before reading');
    }
    assertSizeLimit(object.size, maxBytes, 'R2 object size');
    const bytes = object.body
      ? await readStreamBytes(object.body, maxBytes, 'R2 object stream')
      : new Uint8Array(await object.arrayBuffer());
    assertSizeLimit(bytes.byteLength, maxBytes, 'R2 object bytes');
    return {
      bytes,
      fileName: args.fileName || fileNameFromPath(args.r2Key) || options.defaultFileName,
      mimeType: normalizeMimeType(args.mimeType || object.httpMetadata?.contentType || inferMimeType(args.fileName || args.r2Key)),
      source: 'r2Key',
    };
  }

  const bytes = base64ToBytes(args.fileData ?? '', maxResolvedMediaBytes(options));
  return {
    bytes,
    fileName: args.fileName || options.defaultFileName,
    mimeType: normalizeMimeType(args.mimeType || inferMimeType(args.fileName || options.defaultFileName)),
    source: 'fileData',
  };
}

function assertStagedR2KeyAccess(args: WorkerMediaArgs, r2Key: string): void {
  if (!r2Key.startsWith('staging/tenants/')) return;
  const account = accountFromParams(args);
  if (!account) return;
  const allowedPrefix = createMediaUploadPrefix(account.tenantId, account.accountId);
  if (!r2Key.startsWith(allowedPrefix)) {
    throw new Error('R2 对象不属于当前租户/公众号账号，已拒绝跨账号媒体读取');
  }
}

function validateMediaPayload(
  media: ResolvedMedia,
  mediaType: MediaKind,
  sizeLimit: number,
  allowedForType: Set<string>,
): void {
  assertWorkersMemoryLimit(media.bytes.byteLength, 'resolved media');

  if (media.bytes.byteLength <= 0) {
    throw new Error('文件内容为空');
  }

  if (media.bytes.byteLength > sizeLimit) {
    const maxSize = (sizeLimit / (1024 * 1024)).toFixed(2);
    const actualSize = (media.bytes.byteLength / (1024 * 1024)).toFixed(2);
    throw new Error(`文件大小超过 ${mediaType} 限制。最大允许: ${maxSize}MB, 实际大小: ${actualSize}MB`);
  }

  if (!ALLOWED_MEDIA_TYPES.includes(media.mimeType as any) || !allowedForType.has(media.mimeType)) {
    throw new Error(`不支持的文件类型: ${media.mimeType}。请使用 ${[...allowedForType].join(', ')}`);
  }
}

function assertWorkersMemoryLimit(size: number, label: string): void {
  if (size > WORKERS_MEMORY_LIMIT_BYTES) {
    throw new Error(`${label} 超过 Workers 128MB 内存上限，已在上传到微信前拒绝`);
  }
}

function maxResolvedMediaBytes(options: { maxBytes?: number }): number {
  return Math.min(options.maxBytes ?? WORKERS_MEMORY_LIMIT_BYTES, WORKERS_MEMORY_LIMIT_BYTES);
}

function assertSizeLimit(size: number, limit: number, label: string): void {
  assertWorkersMemoryLimit(size, label);
  if (size > limit) {
    const maxSize = (limit / (1024 * 1024)).toFixed(2);
    const actualSize = (size / (1024 * 1024)).toFixed(2);
    throw new Error(`${label} 超过上传大小限制。最大允许: ${maxSize}MB, 实际大小: ${actualSize}MB`);
  }
}

function rejectUnsafeRedirect(response: Response, sourceUrl: URL): void {
  if (response.status < 300 || response.status >= 400) {
    return;
  }

  const location = response.headers.get('location');
  if (location) {
    const redirectUrl = new URL(location, sourceUrl);
    if (redirectUrl.protocol !== 'https:') {
      throw new Error('fileUrl 重定向目标必须保持 HTTPS，已拒绝明文降级');
    }
  }

  throw new Error('fileUrl 不跟随重定向；请提供最终 HTTPS 文件 URL');
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertSizeLimit(bytes.byteLength, maxBytes, 'fileUrl bytes');
    return bytes;
  }

  return await readStreamBytes(response.body, maxBytes, 'fileUrl stream');
}

async function readStreamBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      assertSizeLimit(total, maxBytes, label);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function toWechatFormData(media: ResolvedMedia): FormData {
  const body = media.bytes.buffer.slice(
    media.bytes.byteOffset,
    media.bytes.byteOffset + media.bytes.byteLength,
  ) as ArrayBuffer;
  const formData = new FormData();
  formData.append('media', new Blob([body], { type: media.mimeType }), media.fileName);
  return formData;
}

function base64ToBytes(value: string, maxBytes: number): Uint8Array {
  const payload = (value.includes(',') ? value.slice(value.lastIndexOf(',') + 1) : value).replace(/\s/g, '');
  assertSizeLimit(estimateBase64DecodedLength(payload), maxBytes, 'fileData base64 payload');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function estimateBase64DecodedLength(payload: string): number {
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function allowedMimeTypesForMediaType(type: MediaKind): Set<string> {
  switch (type) {
    case 'image':
    case 'thumb':
      return new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp']);
    case 'voice':
      return new Set(['audio/mp3', 'audio/mpeg', 'audio/amr']);
    case 'video':
      return new Set(['video/mp4']);
    default:
      return new Set(ALLOWED_MEDIA_TYPES);
  }
}

function defaultFileNameForType(type: MediaKind): string {
  switch (type) {
    case 'voice':
      return 'media.mp3';
    case 'video':
      return 'media.mp4';
    case 'thumb':
      return 'thumb.jpg';
    case 'image':
    default:
      return 'media.jpg';
  }
}

function normalizeMimeType(value: string | null | undefined): string {
  return (value || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
}

function inferMimeType(name: string | null | undefined): string {
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.mp3')) return 'audio/mp3';
  if (lower.endsWith('.mpeg')) return 'audio/mpeg';
  if (lower.endsWith('.amr')) return 'audio/amr';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function fileNameFromPath(value: string): string | null {
  const cleaned = value.split('?')[0].split('#')[0];
  const name = cleaned.split('/').filter(Boolean).pop();
  return name || null;
}

function toolError(prefix: string, error: unknown): WechatToolResult {
  return {
    content: [{
      type: 'text',
      text: `${prefix}: ${error instanceof Error ? error.message : '未知错误'}`,
    }],
    isError: true,
  };
}
