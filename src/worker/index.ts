/**
 * Cloudflare Workers entrypoint skeleton.
 *
 * The stdio/Node runtime remains under src/cli.ts. This file only establishes
 * the Workers bindings and exported Durable Object classes needed for the
 * OpenSpec migration; the McpAgent/OAuth implementation lands in later stories.
 */

type SecretStoreBinding = {
  get(): Promise<string | null>;
};

export interface WorkerEnv {
  WECHAT_MCP_AGENT: unknown;
  TOKEN_OWNER: unknown;
  DB: unknown;
  MEDIA: unknown;
  WECHAT_APP_ID: SecretStoreBinding;
  WECHAT_APP_SECRET: SecretStoreBinding;
  WECHAT_MCP_SECRET_KEY: SecretStoreBinding;
  WECHAT_WEBHOOK_TOKEN: SecretStoreBinding;
  WECHAT_ENCODING_AES_KEY: SecretStoreBinding;
  OAUTH_CLIENT_ID: SecretStoreBinding;
  OAUTH_CLIENT_SECRET: SecretStoreBinding;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

/** Placeholder session DO. Will extend McpAgent in the remote-MCP story. */
export class WechatMcpAgent {
  async fetch(): Promise<Response> {
    return json(
      {
        success: false,
        error: 'WechatMcpAgent skeleton only; /mcp is implemented in a later OpenSpec story.',
      },
      { status: 501 },
    );
  }
}

/** Placeholder singleton token owner DO. Token refresh logic lands later. */
export class TokenOwner {
  async fetch(): Promise<Response> {
    return json(
      {
        success: false,
        error: 'TokenOwner skeleton only; token lifecycle is implemented in a later OpenSpec story.',
      },
      { status: 501 },
    );
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        success: true,
        runtime: 'cloudflare-workers',
        mcpEndpoint: '/mcp',
        webhookEndpoint: '/wx/callback',
      });
    }

    if (url.pathname === '/mcp') {
      return json(
        {
          success: false,
          error: 'Remote MCP endpoint skeleton is configured; McpAgent.serve("/mcp") lands in a later OpenSpec story.',
        },
        { status: 501 },
      );
    }

    if (url.pathname === '/sse' || url.pathname === '/messages') {
      return json(
        {
          success: false,
          error: 'MCP-over-SSE is not ported to Workers; use the Streamable HTTP /mcp endpoint.',
        },
        { status: 404 },
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};
