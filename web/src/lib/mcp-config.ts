export const PRODUCTION_ORIGIN = 'https://woa.ziikoo.app';

export type McpClientId = 'kimi' | 'claude' | 'codex' | 'other';

export type McpClientGuideStep = {
  title: string;
  description: string;
  code?: string;
  language?: 'text' | 'bash';
};

export type McpClientGuide = {
  id: McpClientId;
  label: string;
  summary: string;
  steps: McpClientGuideStep[];
};

export function mcpUrl(origin = PRODUCTION_ORIGIN): string {
  return new URL('/mcp', normalizeOrigin(origin)).toString();
}

export function getMcpClientGuide(
  client: McpClientId,
  origin = PRODUCTION_ORIGIN,
): McpClientGuide {
  const url = mcpUrl(origin);

  if (client === 'claude') {
    return {
      id: 'claude',
      label: 'Claude Code',
      summary: '使用 Claude Code 原生 Streamable HTTP 与 OAuth 登录。',
      steps: [
        {
          title: '1. 添加远程 MCP',
          description: '把 WOA 添加为用户级 HTTP MCP server。',
          code: claudeMcpAddCli(origin),
          language: 'bash',
        },
        {
          title: '2. 完成 OAuth 授权',
          description: '命令会打开浏览器；登录并批准一次即可。',
          code: 'claude mcp login wechat-woa',
          language: 'bash',
        },
        {
          title: '3. 验证连接',
          description: '确认 wechat-woa 已连接。',
          code: 'claude mcp list',
          language: 'bash',
        },
      ],
    };
  }

  if (client === 'codex') {
    return {
      id: 'codex',
      label: 'Codex',
      summary: '使用 Codex 原生 Streamable HTTP 与 OAuth 登录。',
      steps: [
        {
          title: '1. 添加远程 MCP',
          description: '把 WOA 写入 Codex 的用户配置。',
          code: codexMcpAddCli(origin),
          language: 'bash',
        },
        {
          title: '2. 完成 OAuth 授权',
          description: '命令会打开浏览器；登录并批准一次即可。',
          code: 'codex mcp login wechat-woa',
          language: 'bash',
        },
        {
          title: '3. 验证连接',
          description: '确认 wechat-woa 已连接。',
          code: 'codex mcp list',
          language: 'bash',
        },
      ],
    };
  }

  if (client === 'other') {
    return {
      id: 'other',
      label: '其他客户端',
      summary: '客户端必须原生支持 Streamable HTTP、OAuth discovery、PKCE、动态客户端注册和凭据刷新。',
      steps: [
        {
          title: '1. 添加远程地址',
          description: '在客户端的远程 MCP 配置中添加以下地址。',
          code: url,
          language: 'text',
        },
        {
          title: '2. 完成 OAuth 授权',
          description: '由客户端响应 OAuth challenge，并在浏览器中完成登录和同意授权。',
        },
        {
          title: '3. 验证自动刷新能力',
          description: '确认客户端会安全保存 OAuth 凭据，并在 access token 到期后刷新。',
        },
      ],
    };
  }

  return {
    id: 'kimi',
    label: 'Kimi Code',
    summary: '使用 Kimi Code 内置的 MCP 配置与 OAuth 登录，不需要填写请求头或复制 token。',
    steps: [
      {
        title: '1. 添加远程 MCP',
        description: '在 Kimi Code 中打开配置向导，按下面的字段添加用户级 HTTP server。',
        code: [
          '/mcp-config',
          '',
          '名称: wechat-woa',
          '范围: 用户级',
          '传输: HTTP',
          `URL: ${url}`,
        ].join('\n'),
        language: 'text',
      },
      {
        title: '2. 完成 OAuth 授权',
        description: 'Kimi Code 会打开浏览器；登录并批准一次即可。',
        code: '/mcp-config login wechat-woa',
        language: 'text',
      },
      {
        title: '3. 验证连接',
        description: '确认状态为 connected，并能看到 WOA 工具。',
        code: '/mcp',
        language: 'text',
      },
    ],
  };
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
  return [
    claudeMcpAddCli(origin),
    'claude mcp login wechat-woa',
  ].join('\n');
}

export function codexMcpCli(origin = PRODUCTION_ORIGIN): string {
  return [
    codexMcpAddCli(origin),
    'codex mcp login wechat-woa',
  ].join('\n');
}

function claudeMcpAddCli(origin = PRODUCTION_ORIGIN): string {
  const url = mcpUrl(origin);
  return [
    'claude mcp add \\',
    '  --transport http \\',
    '  --scope user \\',
    '  wechat-woa \\',
    `  ${url}`,
  ].join('\n');
}

function codexMcpAddCli(origin = PRODUCTION_ORIGIN): string {
  const url = mcpUrl(origin);
  return [
    'codex mcp add \\',
    '  wechat-woa \\',
    '  --url \\',
    `  ${url}`,
  ].join('\n');
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '/') || PRODUCTION_ORIGIN;
}
