export const PRODUCTION_ORIGIN = 'https://woa.ziikoo.app';

export function mcpUrl(origin = PRODUCTION_ORIGIN): string {
  return new URL('/mcp', normalizeOrigin(origin)).toString();
}

export function codexMcpConfig(origin = PRODUCTION_ORIGIN): string {
  return `[mcp_servers.wechat-woa]\nurl = "${mcpUrl(origin)}"`;
}

export function claudeMcpConfig(origin = PRODUCTION_ORIGIN): Record<string, unknown> {
  return {
    mcpServers: {
      'wechat-woa': {
        type: 'http',
        url: mcpUrl(origin),
      },
    },
  };
}

export function claudeMcpCli(origin = PRODUCTION_ORIGIN): string {
  const url = mcpUrl(origin);
  return [
    'claude mcp add \\',
    '  --transport http \\',
    '  --scope user \\',
    '  wechat-woa \\',
    `  ${url}`,
    'claude mcp login wechat-woa',
  ].join('\n');
}

export function codexMcpCli(origin = PRODUCTION_ORIGIN): string {
  const url = mcpUrl(origin);
  return [
    'codex mcp add \\',
    '  wechat-woa \\',
    '  --url \\',
    `  ${url}`,
    'codex mcp login wechat-woa',
  ].join('\n');
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '/') || PRODUCTION_ORIGIN;
}
