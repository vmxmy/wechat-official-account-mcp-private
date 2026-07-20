import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface CliMcpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CliMcpCallResult {
  content: unknown[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CliMcpApiClientOptions {
  server: string;
  clientVersion: string;
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
}

/** 单命令生命周期的标准 Streamable HTTP MCP 客户端。 */
export class CliMcpApiClient {
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private connected = false;

  constructor(options: CliMcpApiClientOptions) {
    const mcpUrl = new URL('/mcp', options.server);
    this.client = new Client({
      name: 'woa-cli',
      version: options.clientVersion,
    }, {
      capabilities: {},
    });
    this.transport = new StreamableHTTPClientTransport(mcpUrl, {
      fetch: options.fetch,
    });
  }

  async listTools(): Promise<CliMcpTool[]> {
    await this.connect();
    const tools: CliMcpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools as CliMcpTool[]);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CliMcpCallResult> {
    await this.connect();
    return await this.client.callTool({ name, arguments: args }) as CliMcpCallResult;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.client.close();
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }
}
