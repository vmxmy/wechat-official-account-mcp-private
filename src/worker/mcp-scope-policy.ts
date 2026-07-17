import { requireTenantScope, type TenantRequestContext } from './tenant-context.js';

const CONTENT_READ_TOOLS = new Set([
  'wechat_statistics',
  'wechat_auto_reply',
]);

const PUBLISH_TOOLS = new Set([
  'wechat_mass_send',
]);

const READ_ACTIONS: Record<string, Set<string>> = {
  wechat_draft: new Set(['get', 'list', 'count']),
  wechat_publish: new Set(['get', 'list']),
  wechat_permanent_media: new Set(['get', 'list', 'count']),
  wechat_media_upload: new Set(['get', 'list']),
  wechat_user: new Set(['get_user_list', 'get_user_info', 'batch_get_user_info', 'get_user_summary', 'get_user_cumulate']),
  wechat_tag: new Set(['get_list', 'get_tag_users']),
  wechat_menu: new Set(['get', 'get_selfmenu_info']),
  wechat_template_msg: new Set(['get_all_templates', 'get_industry']),
  wechat_customer_service: new Set(['get_records']),
  wechat_qrcode: new Set(['get_url']),
  wechat_short_url: new Set(['fetch']),
  wechat_comment: new Set(['list']),
  wechat_blacklist: new Set(['get_list']),
  wechat_kf_account: new Set(['get_list']),
  wechat_account: new Set(['get_quota']),
};

const PUBLISH_ACTIONS: Record<string, Set<string>> = {
  wechat_publish: new Set(['submit', 'delete']),
  wechat_content_publish: new Set(['publish_draft', 'create_and_publish']),
};

export function requiredScopeForMcpTool(toolName: string, action: string): string | null {
  // Management tools implement their own action-specific scope checks.
  if (toolName.startsWith('woa_')) return null;
  if (toolName === 'wechat_inbox') return 'woa:inbox:read';
  if (toolName === 'wechat_auth') {
    return action === 'get_config' ? 'woa:account:read' : 'woa:account:write';
  }
  if (PUBLISH_TOOLS.has(toolName) || PUBLISH_ACTIONS[toolName]?.has(action)) {
    return 'woa:content:publish';
  }
  if (CONTENT_READ_TOOLS.has(toolName) || READ_ACTIONS[toolName]?.has(action)) {
    return 'woa:content:read';
  }
  // Unknown/new WeChat actions default to write rather than inheriting read.
  return 'woa:content:write';
}

export function requireMcpToolScope(
  context: TenantRequestContext,
  toolName: string,
  action: string,
  tenantId: string,
): string | null {
  const scope = requiredScopeForMcpTool(toolName, action);
  if (scope) requireTenantScope(context, tenantId, scope);
  return scope;
}
