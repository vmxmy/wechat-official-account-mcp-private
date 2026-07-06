export const PRODUCTION_ORIGIN = 'https://woa.ziikoo.app';

export function mcpUrl(origin = PRODUCTION_ORIGIN): string {
  return new URL('/mcp', normalizeOrigin(origin)).toString();
}

export function codexMcpConfig(origin = PRODUCTION_ORIGIN): Record<string, unknown> {
  return {
    mcp_servers: {
      wechat: {
        type: 'streamable-http',
        url: mcpUrl(origin),
      },
    },
  };
}

export function claudeMcpConfig(origin = PRODUCTION_ORIGIN): Record<string, unknown> {
  return {
    mcpServers: {
      wechat: {
        type: 'http',
        url: mcpUrl(origin),
      },
    },
  };
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '/') || PRODUCTION_ORIGIN;
}
