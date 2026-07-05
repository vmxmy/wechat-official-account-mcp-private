import { z } from 'zod';
import { WechatToolDefinition, McpTool } from '../types.js';
import { authTool, authMcpTool } from './auth-tool.js';
import { createWorkerMediaTools } from '../../worker/media-tools.js';
import { draftTool, draftMcpTool } from './draft-tool.js';
import { publishTool, publishMcpTool } from './publish-tool.js';
import { contentPublishMcpTool } from './content-publish-tool.js';
import { userMcpTool } from './user-tool.js';
import { tagMcpTool } from './tag-tool.js';
import { menuMcpTool } from './menu-tool.js';
import { templateMsgMcpTool } from './template-msg-tool.js';
import { customerServiceMcpTool } from './customer-service-tool.js';
import { statisticsMcpTool } from './statistics-tool.js';
import { autoReplyMcpTool } from './auto-reply-tool.js';
import { massSendMcpTool } from './mass-send-tool.js';
import { subscribeMsgMcpTool } from './subscribe-msg-tool.js';
import { inboxMcpTool } from './inbox-tool.js';
import { qrcodeMcpTool } from './qrcode-tool.js';
import { shortUrlMcpTool } from './short-url-tool.js';
import { commentMcpTool } from './comment-tool.js';
import { blacklistMcpTool } from './blacklist-tool.js';
import { kfAccountMcpTool } from './kf-account-tool.js';
import { accountMcpTool } from './account-tool.js';
import {
  tenantManagementMcpTools,
  woaAccountMcpTool,
  woaAuditMcpTool,
  woaContextMcpTool,
  woaTenantMcpTool,
} from './tenant-management-tools.js';

const accountIdInput = z.string()
  .min(1)
  .max(128)
  .optional()
  .describe('公众号账号 ID（多租户模式可选；省略时使用默认/唯一账号）');

const [rawMediaUploadTool, rawUploadImgTool, rawPermanentMediaTool] = createWorkerMediaTools();

export function withOptionalAccountId(tool: McpTool): McpTool {
  if (Object.prototype.hasOwnProperty.call(tool.inputSchema, 'accountId')) {
    return tool;
  }

  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      accountId: accountIdInput,
    },
  };
}

export const mediaUploadTool = withOptionalAccountId(rawMediaUploadTool);
export const uploadImgTool = withOptionalAccountId(rawUploadImgTool);
export const permanentMediaTool = withOptionalAccountId(rawPermanentMediaTool);

const wechatOperationMcpTools: McpTool[] = [
  authMcpTool,
  draftMcpTool,
  publishMcpTool,
  contentPublishMcpTool,
  permanentMediaTool,
  mediaUploadTool,
  uploadImgTool,
  userMcpTool,
  tagMcpTool,
  menuMcpTool,
  templateMsgMcpTool,
  customerServiceMcpTool,
  subscribeMsgMcpTool,
  statisticsMcpTool,
  autoReplyMcpTool,
  massSendMcpTool,
  inboxMcpTool,
  qrcodeMcpTool,
  shortUrlMcpTool,
  commentMcpTool,
  blacklistMcpTool,
  kfAccountMcpTool,
  accountMcpTool,
].map(withOptionalAccountId);

/**
 * 所有微信公众号 MCP 工具
 */
export const wechatTools: WechatToolDefinition[] = [
  authTool,
  draftTool,
  publishTool,
];

/**
 * Worker 运行时共享 MCP 工具列表；媒体工具在 Worker init 中重新创建以注入 R2/D1 保存器。
 */
export const workerSharedMcpTools: McpTool[] = [
  ...wechatOperationMcpTools.filter(tool => ![
    'wechat_media_upload',
    'wechat_upload_img',
    'wechat_permanent_media',
  ].includes(tool.name)),
  ...tenantManagementMcpTools,
];

/**
 * MCP工具列表
 */
export const mcpTools: McpTool[] = [
  ...wechatOperationMcpTools,
  ...tenantManagementMcpTools,
];

export {
  authTool,
  authMcpTool,
  draftTool,
  draftMcpTool,
  publishTool,
  publishMcpTool,
  contentPublishMcpTool,
  userMcpTool,
  tagMcpTool,
  menuMcpTool,
  templateMsgMcpTool,
  customerServiceMcpTool,
  statisticsMcpTool,
  autoReplyMcpTool,
  massSendMcpTool,
  subscribeMsgMcpTool,
  inboxMcpTool,
  qrcodeMcpTool,
  shortUrlMcpTool,
  commentMcpTool,
  blacklistMcpTool,
  kfAccountMcpTool,
  accountMcpTool,
  woaContextMcpTool,
  woaTenantMcpTool,
  woaAccountMcpTool,
  woaAuditMcpTool,
};
