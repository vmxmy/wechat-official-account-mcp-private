import type { CliMcpTool } from './mcp-api-client.js';

const SENSITIVE_KEY = /(?:authorization|access[_-]?token|refresh[_-]?token|app[_-]?secret|client[_-]?secret|password|encoding[_-]?aes[_-]?key|proxy[_-]?token|\btoken\b)/i;

const CURRENT_WECHAT_TOOLS = new Set([
  'wechat_auth',
  'wechat_draft',
  'wechat_publish',
  'wechat_content_publish',
  'wechat_permanent_media',
  'wechat_media_upload',
  'wechat_upload_img',
  'wechat_user',
  'wechat_tag',
  'wechat_menu',
  'wechat_template_msg',
  'wechat_customer_service',
  'wechat_subscribe_msg',
  'wechat_statistics',
  'wechat_auto_reply',
  'wechat_mass_send',
  'wechat_inbox',
  'wechat_qrcode',
  'wechat_short_url',
  'wechat_comment',
  'wechat_blacklist',
  'wechat_kf_account',
  'wechat_account',
]);

const KNOWN_ACTIONS: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries({
    wechat_auth: ['get_token', 'refresh_token', 'get_config'],
    wechat_draft: ['add', 'update', 'get', 'delete', 'list', 'count'],
    wechat_publish: ['submit', 'get', 'delete', 'list'],
    wechat_content_publish: ['create_draft', 'publish_draft', 'create_and_publish'],
    wechat_permanent_media: ['add', 'get', 'delete', 'list', 'count'],
    wechat_media_upload: ['upload', 'get', 'list'],
    wechat_user: ['get_user_list', 'get_user_info', 'batch_get_user_info', 'set_remark', 'get_user_summary', 'get_user_cumulate'],
    wechat_tag: ['create', 'get_list', 'update', 'delete', 'batch_tagging', 'batch_untagging', 'get_tag_users'],
    wechat_menu: ['create', 'get', 'delete', 'add_conditional', 'delete_conditional', 'get_selfmenu_info'],
    wechat_template_msg: ['send', 'set_industry', 'add_template', 'get_all_templates', 'delete', 'get_industry'],
    wechat_customer_service: ['send_text', 'send_image', 'send_voice', 'send_video', 'send_music', 'send_news', 'send_mpnews', 'get_records'],
    wechat_subscribe_msg: ['send'],
    wechat_statistics: ['get_article_summary', 'get_article_total', 'get_user_read', 'get_user_share', 'get_article_read', 'get_article_share', 'get_biz_summary', 'get_article_total_detail', 'get_upstream_message', 'get_interface_summary', 'get_interface_summary_hour'],
    wechat_auto_reply: ['get_current_info'],
    wechat_mass_send: ['send_by_tag', 'send_by_openid', 'delete', 'preview'],
    wechat_inbox: ['list_pending', 'list_all', 'get', 'mark_processed'],
    wechat_qrcode: ['create_temp', 'create_permanent', 'get_url'],
    wechat_short_url: ['generate', 'fetch'],
    wechat_comment: ['open', 'close', 'list', 'mark_elect', 'unmark_elect', 'delete', 'reply', 'delete_reply'],
    wechat_blacklist: ['get_list', 'block', 'unblock'],
    wechat_kf_account: ['add', 'update', 'delete', 'get_list'],
    wechat_account: ['clear_quota', 'get_quota'],
  }).map(([tool, actions]) => [tool, new Set(actions)]),
);

const HIGH_IMPACT_ACTIONS = new Set([
  'wechat_draft:delete',
  'wechat_publish:submit',
  'wechat_publish:delete',
  'wechat_content_publish:publish_draft',
  'wechat_content_publish:create_and_publish',
  'wechat_permanent_media:delete',
  'wechat_tag:delete',
  'wechat_menu:create',
  'wechat_menu:delete',
  'wechat_menu:add_conditional',
  'wechat_menu:delete_conditional',
  'wechat_template_msg:send',
  'wechat_template_msg:delete',
  'wechat_customer_service:send_text',
  'wechat_customer_service:send_image',
  'wechat_customer_service:send_voice',
  'wechat_customer_service:send_video',
  'wechat_customer_service:send_music',
  'wechat_customer_service:send_news',
  'wechat_customer_service:send_mpnews',
  'wechat_subscribe_msg:send',
  'wechat_mass_send:send_by_tag',
  'wechat_mass_send:send_by_openid',
  'wechat_mass_send:delete',
  'wechat_comment:close',
  'wechat_comment:delete',
  'wechat_comment:delete_reply',
  'wechat_blacklist:block',
  'wechat_blacklist:unblock',
  'wechat_kf_account:delete',
  'wechat_account:clear_quota',
]);

export function isWechatToolName(name: string): boolean {
  return name.startsWith('wechat_');
}

export function filterWechatTools(tools: CliMcpTool[]): CliMcpTool[] {
  return tools.filter(tool => isWechatToolName(tool.name));
}

export function requiredToolConfirmation(
  tool: CliMcpTool,
  args: Record<string, unknown>,
): string | null {
  const action = typeof args.action === 'string' ? args.action : '';
  const value = action ? `${tool.name}:${action}` : tool.name;
  if (tool.annotations?.destructiveHint === true) return value;
  if (HIGH_IMPACT_ACTIONS.has(value)) return value;
  if (action && !KNOWN_ACTIONS[tool.name]?.has(action)) return value;
  if (!CURRENT_WECHAT_TOOLS.has(tool.name) && tool.annotations?.readOnlyHint !== true) return value;
  return null;
}

export function assertToolConfirmation(
  tool: CliMcpTool,
  args: Record<string, unknown>,
  confirmation?: string,
): void {
  const required = requiredToolConfirmation(tool, args);
  if (required && confirmation !== required) {
    throw new Error(`Refusing protected operation without exact confirmation. Retry with --confirm ${required}, or inspect it first with --dry-run.`);
  }
}

export function redactSensitiveValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactSensitiveValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([childKey, childValue]) => [childKey, redactSensitiveValue(childValue, childKey)]),
    );
  }
  return value;
}

export function createToolDryRun(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    success: true,
    dryRun: true,
    operation: 'mcp.tools/call',
    tool: toolName,
    arguments: redactSensitiveValue(args),
    note: 'No MCP connection or tool call was made.',
  };
}
