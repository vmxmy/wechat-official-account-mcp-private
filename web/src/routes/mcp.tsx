import { createFileRoute } from '@tanstack/react-router';
import { CodeBlock, Link, Text, VStack } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { getMcpDescriptor, MCP_OAUTH_GUIDANCE } from '../lib/mcp-config.js';
import { requireWebSession } from '../route-guards.js';

export const Route = createFileRoute('/mcp')({
  beforeLoad: requireWebSession,
  component: McpPage,
});

function McpPage() {
  const descriptor = getMcpDescriptor();

  return (
    <>
      <PageHeader
        eyebrow="远程连接"
        title="远程 MCP 参数"
        description="使用宿主原生的 Streamable HTTP 与 OAuth 能力连接 WOA；CLI 不写宿主配置，也不嵌入访问令牌。"
      />
      <PageStack>
        <SurfaceSection title="通用 descriptor" tone="accent">
          <VStack gap={3}>
            <CodeBlock
              code={JSON.stringify(descriptor, null, 2)}
              language="json"
              title="MCP descriptor"
              width="100%"
              size="sm"
            />
            <Text type="supporting" as="p">
              <span className="mono">headers</span> 必须保持为空。Authorization 由 OAuth 协议与宿主凭据存储管理，不要手工填写静态请求头。
            </Text>
          </VStack>
        </SurfaceSection>

        <SurfaceSection title="OAuth 连接">
          <VStack gap={4}>
            <ol className="mcp-auth-flow">
              <li>添加 descriptor</li>
              <li>浏览器授权</li>
              <li>宿主保存凭据</li>
              <li>到期自动刷新</li>
            </ol>
            <VStack gap={2}>
              <Text type="supporting" as="p">{MCP_OAUTH_GUIDANCE.desktop}</Text>
              <Text type="supporting" as="p">{MCP_OAUTH_GUIDANCE.headless}</Text>
            </VStack>
          </VStack>
        </SurfaceSection>

        <SurfaceSection title="兼容性边界" tone="quiet">
          <VStack gap={3}>
            <Text type="supporting" as="p">{MCP_OAUTH_GUIDANCE.unsupported}</Text>
            <Text type="supporting" as="p">
              首次接入请返回 <Link href="/">公开入口</Link>，把唯一任务交给 Agent；授权与会话可在
              {' '}<Link href="/security">安全页面</Link>{' '}查看或撤销。
            </Text>
          </VStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
