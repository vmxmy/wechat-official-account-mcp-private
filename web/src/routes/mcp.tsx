import { createFileRoute } from '@tanstack/react-router';
import { CodeBlock, Link, VStack } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { claudeMcpConfig, codexMcpConfig, mcpUrl } from '../lib/mcp-config.js';

export const Route = createFileRoute('/mcp')({
  component: McpPage,
});

function McpPage() {
  return (
    <>
      <PageHeader
        title="远程 MCP 配置"
        description="复制 Streamable HTTP endpoint 到支持原生 Remote MCP/OAuth 的客户端。配置不包含 OAuth token，也不恢复本地 stdio/SSE。"
      />
      <PageStack>
        <SurfaceSection title="Endpoint">
          <VStack gap={2}>
            <p className="section-copy mono">{mcpUrl()}</p>
            <p className="section-copy">授权由客户端通过 OAuth 完成；不要把 AppSecret 或 access token 写进 MCP 配置文件。</p>
          </VStack>
        </SurfaceSection>
        <SurfaceSection title="Codex">
          <CodeBlock code={JSON.stringify(codexMcpConfig(), null, 2)} language="json" title="codex mcp config" width="100%" />
        </SurfaceSection>
        <SurfaceSection title="Claude">
          <CodeBlock code={JSON.stringify(claudeMcpConfig(), null, 2)} language="json" title="claude mcp config" width="100%" />
        </SurfaceSection>
        <SurfaceSection title="CLI 生成">
          <VStack gap={2}>
            <CodeBlock code="npx -y --package @ziikoo/woa woa mcp config codex --server https://woa.ziikoo.app" language="bash" title="terminal" width="100%" />
            <p className="section-copy">需要帮助请联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>。</p>
          </VStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
