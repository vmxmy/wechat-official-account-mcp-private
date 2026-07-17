export interface McpDescriptor {
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
  headers: Record<string, never>;
}

export function createMcpDescriptor(server = 'https://woa.ziikoo.app'): McpDescriptor {
  const base = new URL(server);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
    throw new Error('mcp descriptor requires an HTTPS server URL.');
  }
  return {
    name: 'wechat-woa',
    transport: 'streamable-http',
    url: new URL('/mcp', base).toString(),
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

export function renderMcpDescriptor(server?: string): string {
  return `${JSON.stringify(createMcpDescriptor(server), null, 2)}\n`;
}
