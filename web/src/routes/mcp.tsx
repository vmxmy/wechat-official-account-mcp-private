import { createFileRoute } from '@tanstack/react-router';
import { CodeBlock, Heading, Link, Text, VStack } from '@astryxdesign/core';
import { PageGrid, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import {
  claudeMcpCli,
  claudeMcpConfig,
  codexMcpCli,
  codexMcpConfig,
  mcpUrl,
} from '../lib/mcp-config.js';
import { requireWebSession } from '../route-guards.js';

export const Route = createFileRoute('/mcp')({
  beforeLoad: requireWebSession,
  component: McpPage,
});

function McpPage() {
  return (
    <>
      <PageHeader
        eyebrow="远程连接"
        title="远程 MCP 配置"
        description="复制 Streamable HTTP endpoint 到支持原生 Remote MCP/OAuth 的客户端。配置不包含 OAuth token，也不恢复本地 stdio/SSE。"
      />
      <PageStack>
        <SurfaceSection title="Endpoint" tone="accent">
          <VStack gap={2}>
            <p className="section-copy mono">{mcpUrl()}</p>
            <p className="section-copy">授权由客户端通过 OAuth 完成；不要把 AppSecret 或 access token 写进 MCP 配置文件。</p>
          </VStack>
        </SurfaceSection>
        <SurfaceSection title="客户端配置">
          <PageGrid columns={{ minWidth: 320, max: 2 }}>
            <VStack gap={2}>
              <Heading level={3}>Codex</Heading>
              <CodeBlock code={codexMcpConfig()} language="toml" title="~/.codex/config.toml" width="100%" />
            </VStack>
            <VStack gap={2}>
              <Heading level={3}>Claude Code</Heading>
              <CodeBlock code={JSON.stringify(claudeMcpConfig(), null, 2)} language="json" title=".mcp.json" width="100%" />
            </VStack>
          </PageGrid>
        </SurfaceSection>
        <SurfaceSection title="CLI 生成">
          <VStack gap={4}>
            <PageGrid columns={{ minWidth: 320, max: 2 }}>
              <VStack gap={2}>
                <Heading level={3}>Claude Code CLI</Heading>
                <Text type="supporting" as="p">添加用户级远程 MCP，并通过浏览器完成 OAuth 登录。</Text>
                <CodeBlock code={claudeMcpCli()} language="bash" title="terminal" width="100%" size="sm" />
              </VStack>
              <VStack gap={2}>
                <Heading level={3}>Codex CLI</Heading>
                <Text type="supporting" as="p">写入 Codex MCP 配置，并通过浏览器完成 OAuth 登录。</Text>
                <CodeBlock code={codexMcpCli()} language="bash" title="terminal" width="100%" size="sm" />
              </VStack>
            </PageGrid>
            <p className="section-copy">需要帮助请联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>。</p>
          </VStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
