import { z } from 'zod';
import { McpTool, WechatApiClient, WechatToolResult } from '../types.js';

// 验证 Schema
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不正确，应为YYYY-MM-DD');

const statisticsActions = [
  // 兼容旧 action：内部已映射到微信官方新版发表内容统计接口
  'get_article_summary',
  'get_article_total',
  'get_user_read',
  'get_user_share',
  // 微信官方新版图文/发表内容统计接口
  'get_article_read',
  'get_article_share',
  'get_biz_summary',
  'get_article_total_detail',
  // 仍可用的消息/接口统计接口
  'get_upstream_message',
  'get_interface_summary',
  'get_interface_summary_hour',
] as const;

type StatisticsAction = typeof statisticsActions[number];

const legacyActionNotes: Partial<Record<StatisticsAction, string>> = {
  get_article_summary: '兼容提示: 微信官方 getarticlesummary 已停止维护，本工具已自动改用 getarticleread（发表内容每日阅读数据）。',
  get_article_total: '兼容提示: 微信官方 getarticletotal 已停止维护，本工具已自动改用 getarticletotaldetail（发表内容发表详细数据）。',
  get_user_read: '兼容提示: 微信官方 getuserread 已停止维护，本工具已自动改用 getarticleread（发表内容每日阅读数据）。',
  get_user_share: '兼容提示: 微信官方 getusershare 已停止维护，本工具已自动改用 getarticleshare（发表内容每日分享数据）。',
};

export const statisticsMcpTool: McpTool = {
  name: 'wechat_statistics',
  description: '微信公众号数据统计分析 - 获取发表内容、消息、接口等数据分析。旧图文统计 action 已按微信官方文档迁移到新版发表内容统计接口。',
  inputSchema: {
    action: z.enum(statisticsActions),
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  },
  handler: async (params: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
    const validated = parseStatisticsParams(params);

    if (!validated.beginDate || !validated.endDate) {
      throw new Error(`${validated.action} 操作需要 beginDate 和 endDate 参数`);
    }

    switch (validated.action) {
      case 'get_article_summary':
      case 'get_user_read':
      case 'get_article_read': {
        const result = await apiClient.getArticleRead(validated.beginDate, validated.endDate);
        return datacubeResult(
          '发表内容每日阅读数据',
          validated.beginDate,
          validated.endDate,
          result,
          legacyActionNotes[validated.action],
        );
      }

      case 'get_user_share':
      case 'get_article_share': {
        const result = await apiClient.getArticleShare(validated.beginDate, validated.endDate);
        return datacubeResult(
          '发表内容每日分享数据',
          validated.beginDate,
          validated.endDate,
          result,
          legacyActionNotes[validated.action],
        );
      }

      case 'get_article_total':
      case 'get_article_total_detail': {
        const result = await apiClient.getArticleTotalDetail(validated.beginDate, validated.endDate);
        return datacubeResult(
          '发表内容发表详细数据',
          validated.beginDate,
          validated.endDate,
          result,
          legacyActionNotes[validated.action],
        );
      }

      case 'get_biz_summary': {
        const result = await apiClient.getBizSummary(validated.beginDate, validated.endDate);
        return datacubeResult('发表内容概况总数据', validated.beginDate, validated.endDate, result);
      }

      case 'get_upstream_message': {
        const result = await apiClient.getUpstreamMessage(validated.beginDate, validated.endDate);
        const message = result.list.map(item =>
          `${value(item, 'refDate', 'ref_date')}:\n` +
          `  - 消息类型: ${value(item, 'msgType', 'msg_type')}\n` +
          `  - 上报发送用户数: ${value(item, 'msgUser', 'msg_user')}\n` +
          `  - 上报发送消息数: ${value(item, 'msgCount', 'msg_count')}`
        ).join('\n');

        return {
          content: [{
            type: 'text',
            text: `消息发送概况数据 (${validated.beginDate} 至 ${validated.endDate}):\n\n${message || '暂无数据'}`
          }]
        };
      }

      case 'get_interface_summary': {
        const result = await apiClient.getInterfaceSummary(validated.beginDate, validated.endDate);
        const summary = result.list.map(item =>
          `${value(item, 'refDate', 'ref_date')}:\n` +
          `  - 调用次数: ${value(item, 'callbackCount', 'callback_count')}\n` +
          `  - 失败次数: ${value(item, 'failCount', 'fail_count')}\n` +
          `  - 总耗时: ${value(item, 'totalTime', 'total_time')}ms\n` +
          `  - 最大耗时: ${value(item, 'maxTime', 'max_time')}ms`
        ).join('\n');

        return {
          content: [{
            type: 'text',
            text: `接口分析数据 (${validated.beginDate} 至 ${validated.endDate}):\n\n${summary || '暂无数据'}`
          }]
        };
      }

      case 'get_interface_summary_hour': {
        const result = await apiClient.getInterfaceSummaryHour(validated.beginDate, validated.endDate);
        const summary = result.list.slice(0, 24).map(item =>
          `${value(item, 'refDate', 'ref_date')} ${value(item, 'refHour', 'ref_hour')}:00:\n` +
          `  - 调用次数: ${value(item, 'callbackCount', 'callback_count')}\n` +
          `  - 失败次数: ${value(item, 'failCount', 'fail_count')}\n` +
          `  - 总耗时: ${value(item, 'totalTime', 'total_time')}ms\n` +
          `  - 最大耗时: ${value(item, 'maxTime', 'max_time')}ms`
        ).join('\n');

        return {
          content: [{
            type: 'text',
            text: `接口分析分时数据 (${validated.beginDate} 至 ${validated.endDate}):\n\n${summary || '暂无数据'}`
          }]
        };
      }

      default:
        throw new Error(`未知的操作: ${validated.action}`);
    }
  }
};

function datacubeResult(
  title: string,
  beginDate: string,
  endDate: string,
  result: { list?: Array<Record<string, unknown>>; is_delay?: boolean; isDelay?: boolean },
  note?: string,
): WechatToolResult {
  const list = result.list ?? [];
  const isDelay = result.is_delay ?? result.isDelay;
  const rows = list.map((item, index) => `${index + 1}. ${JSON.stringify(item, null, 2)}`).join('\n\n');
  const parts = [
    `${title} (${beginDate} 至 ${endDate})`,
    note,
    `记录数: ${list.length}`,
    isDelay === undefined ? undefined : `数据是否延迟: ${isDelay}`,
    rows || '暂无数据',
  ].filter(Boolean);

  return {
    content: [{
      type: 'text',
      text: parts.join('\n\n'),
    }],
  };
}

function value(item: unknown, ...keys: string[]): unknown {
  const record = (item ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return '';
}

// 参数解析辅助函数
function parseStatisticsParams(params: unknown) {
  return z.object({
    action: z.enum(statisticsActions),
    beginDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  }).parse(params);
}
