export const PRODUCTION_ORIGIN = 'https://woa.ziikoo.app';

export type McpDescriptor = {
  name: 'wechat-woa';
  transport: 'streamable-http';
  url: string;
  authentication: {
    type: 'oauth2';
    protectedResourceMetadata: true;
    pkce: 'S256';
    dynamicClientRegistration: true;
    refreshToken: true;
  };
  headers: Record<string, string>;
};

export const MCP_OAUTH_GUIDANCE = {
  desktop: '桌面环境通常会打开浏览器；登录并批准一次即可。',
  headless: '无浏览器服务器应把宿主输出的授权 URL 复制到可信设备，并按宿主支持的 loopback、SSH 或远程回调方式完成授权。不要把完整 OAuth callback URL 发到聊天、日志或工单。',
  unsupported: '如果宿主不能原生完成 OAuth discovery、PKCE、动态客户端注册和访问令牌刷新，则当前不受支持；不要改用静态 Bearer 或自定义请求头。',
} as const;

export function mcpUrl(origin = PRODUCTION_ORIGIN): string {
  return new URL('/mcp', normalizeOrigin(origin)).toString();
}

export function getMcpDescriptor(origin = PRODUCTION_ORIGIN): McpDescriptor {
  return {
    name: 'wechat-woa',
    transport: 'streamable-http',
    url: mcpUrl(origin),
    authentication: {
      type: 'oauth2',
      protectedResourceMetadata: true,
      pkce: 'S256',
      dynamicClientRegistration: true,
      refreshToken: true,
    },
    headers: {},
  };
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '/') || PRODUCTION_ORIGIN;
}
