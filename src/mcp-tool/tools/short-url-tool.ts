import { z } from 'zod';
import { McpTool } from '../types.js';
import { WechatApiClient } from '../../wechat/api-client.js';

const shortUrlToolSchema = z.object({
  action: z.enum(['generate', 'fetch']),
  longUrl: z.string().optional().describe('需要转换的长链接/长信息（兼容旧参数名）'),
  longData: z.string().optional().describe('需要转换的长信息，官方限制不超过4KB'),
  shortKey: z.string().optional().describe('短 key，用于还原长信息'),
  expireSeconds: z.number().int().positive().max(2592000).optional().describe('过期秒数，最大30天（2592000）'),
});

export const shortUrlMcpTool: McpTool = {
  name: 'wechat_short_url',
  description: '微信公众号长信息与短链工具。按微信官方新版 shorten/gen 与 shorten/fetch 接口，将不超过4KB的长信息转换为 short_key，或通过 short_key 还原长信息。',
  inputSchema: {
    action: z.enum(['generate', 'fetch']),
    longUrl: z.string().optional().describe('需要转换的长链接/长信息（兼容旧参数名）'),
    longData: z.string().optional().describe('需要转换的长信息，官方限制不超过4KB'),
    shortKey: z.string().optional().describe('短 key，用于还原长信息'),
    expireSeconds: z.number().int().positive().max(2592000).optional().describe('过期秒数，最大30天（2592000）'),
  },
  handler: async (params: unknown, apiClient: WechatApiClient) => {
    const args = shortUrlToolSchema.parse(params);

    if (args.action === 'generate') {
      const longData = args.longData ?? args.longUrl;
      if (!longData) {
        throw new Error('generate 操作需要 longData 或 longUrl 参数');
      }

      const result = await apiClient.generateShortKey(longData, args.expireSeconds ?? 2592000);

      return {
        content: [{
          type: 'text' as const,
          text: `短 key 生成成功\n\n原始长信息: ${longData}\nShort Key: ${result.shortKey}\n有效期: ${args.expireSeconds ?? 2592000} 秒\n\n说明: 微信官方旧 URL Shortener 文档已升级为“长信息与短链”，当前接口返回 short_key，不再返回传统 short_url。`,
        }],
      };
    }

    if (!args.shortKey) {
      throw new Error('fetch 操作需要 shortKey 参数');
    }

    const result = await apiClient.fetchShortKey(args.shortKey);
    return {
      content: [{
        type: 'text' as const,
        text: `短 key 还原成功\n\nShort Key: ${args.shortKey}\n长信息: ${result.longData}\n创建时间: ${result.createTime ?? '未知'}\n剩余有效期: ${result.expireSeconds ?? '未知'} 秒`,
      }],
    };
  },
};
