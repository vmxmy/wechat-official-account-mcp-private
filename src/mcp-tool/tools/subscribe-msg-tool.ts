import { z } from 'zod';
import { McpTool, WechatApiClient, WechatToolResult } from '../types.js';

// 验证 Schema
const templateIdSchema = z.string().min(1, '模板ID不能为空');
const openIdSchema = z.string().min(1, 'OpenID不能为空');

export const subscribeMsgMcpTool: McpTool = {
  name: 'wechat_subscribe_msg',
  description: '微信公众号服务号订阅通知 - 按官方 bizsend 接口发送订阅通知给用户',
  inputSchema: {
    action: z.enum([
      'send'
    ]),
    toUser: openIdSchema,
    templateId: templateIdSchema,
    page: z.string().optional(),
    miniProgramAppId: z.string().optional(),
    miniProgramPagePath: z.string().optional(),
    miniprogramState: z.enum(['developer', 'trial', 'formal']).optional(),
    lang: z.enum(['zh_CN', 'en_US', 'zh_HK', 'zh_TW']).optional(),
    clientMsgId: z.string().optional(),
    data: z.record(z.string(), z.object({
      value: z.string()
    })),
  },
  handler: async (params: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
    const validated = parseSubscribeMsgParams(params);

    switch (validated.action) {
      case 'send': {
        if (!validated.data || Object.keys(validated.data).length === 0) {
          throw new Error('send 操作需要 data 参数（模板数据）');
        }

        const data: any = {
          touser: validated.toUser,
          template_id: validated.templateId,
          data: validated.data
        };

        if (validated.page) {
          data.page = validated.page;
        }

        if (validated.miniProgramAppId && validated.miniProgramPagePath) {
          data.miniprogram = {
            appid: validated.miniProgramAppId,
            pagepath: validated.miniProgramPagePath
          };
        }

        if (validated.miniprogramState) {
          data.miniprogram_state = validated.miniprogramState;
        }

        if (validated.lang) {
          data.lang = validated.lang;
        }

        if (validated.clientMsgId) {
          data.client_msg_id = validated.clientMsgId;
        }

        const result = await apiClient.sendSubscribeMessage(data);

        return {
          content: [{
            type: 'text',
            text: `订阅通知发送成功\n` +
                  `- 接收者: ${validated.toUser}\n` +
                  `- 模板ID: ${validated.templateId}\n` +
                  `- 微信返回: ${result.errmsg || 'ok'}`
          }]
        };
      }

      default:
        throw new Error(`未知的操作: ${validated.action}`);
    }
  }
};

// 参数解析辅助函数
function parseSubscribeMsgParams(params: unknown) {
  return z.object({
    action: z.enum([
      'send'
    ]),
    toUser: z.string().min(1, 'OpenID不能为空'),
    templateId: z.string().min(1, '模板ID不能为空'),
    page: z.string().optional(),
    miniProgramAppId: z.string().optional(),
    miniProgramPagePath: z.string().optional(),
    miniprogramState: z.enum(['developer', 'trial', 'formal']).optional(),
    lang: z.enum(['zh_CN', 'en_US', 'zh_HK', 'zh_TW']).optional(),
    clientMsgId: z.string().optional(),
    data: z.record(z.string(), z.object({
      value: z.string()
    })),
  }).parse(params);
}
