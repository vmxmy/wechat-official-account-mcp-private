import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CodeBlock, Heading, Link, Text, VStack } from '@astryxdesign/core';
import { z } from 'zod';
import type { KeyboardEvent } from 'react';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import {
  getMcpClientGuide,
  mcpUrl,
  type McpClientId,
} from '../lib/mcp-config.js';
import { requireWebSession } from '../route-guards.js';

const mcpClientIds: McpClientId[] = ['kimi', 'claude', 'codex', 'other'];
const mcpSearchSchema = z.object({
  client: z.string().optional(),
});

export const Route = createFileRoute('/mcp')({
  validateSearch: search => mcpSearchSchema.parse(search),
  beforeLoad: requireWebSession,
  component: McpPage,
});

function McpPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const client = mcpClientIds.includes(search.client as McpClientId)
    ? search.client as McpClientId
    : 'kimi';
  const guide = getMcpClientGuide(client);

  async function selectClient(nextClient: McpClientId) {
    await navigate({ to: '/mcp', search: { client: nextClient }, replace: true });
  }

  function moveClientSelection(event: KeyboardEvent<HTMLButtonElement>, currentClient: McpClientId) {
    const currentIndex = mcpClientIds.indexOf(currentClient);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % mcpClientIds.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + mcpClientIds.length) % mcpClientIds.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = mcpClientIds.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextClient = mcpClientIds[nextIndex]!;
    document.getElementById(`mcp-client-tab-${nextClient}`)?.focus();
    void selectClient(nextClient);
  }

  return (
    <>
      <PageHeader
        eyebrow="远程连接"
        title="连接远程 MCP"
        description="只需添加 MCP 地址。客户端会打开浏览器完成 OAuth，并在后续自动刷新访问令牌。"
      />
      <PageStack>
        <SurfaceSection title="远程 MCP 地址" tone="accent">
          <VStack gap={3}>
            <CodeBlock code={mcpUrl()} language="text" title="MCP endpoint" width="100%" size="sm" />
            <Text type="supporting" as="p">
              无需复制 token · 不要填写 Authorization header。授权与凭据刷新由客户端完成。
            </Text>
          </VStack>
        </SurfaceSection>

        <SurfaceSection title="选择客户端">
          <VStack gap={4}>
            <div className="mcp-client-switcher" role="tablist" aria-label="MCP 客户端">
              {mcpClientIds.map(clientId => {
                const option = getMcpClientGuide(clientId);
                const isSelected = clientId === guide.id;
                return (
                  <button
                    key={clientId}
                    id={`mcp-client-tab-${clientId}`}
                    className="mcp-client-option"
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-controls="mcp-client-panel"
                    tabIndex={isSelected ? 0 : -1}
                    data-selected={isSelected ? 'true' : 'false'}
                    onClick={() => { void selectClient(clientId); }}
                    onKeyDown={event => moveClientSelection(event, clientId)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div
              id="mcp-client-panel"
              className="mcp-client-panel"
              role="tabpanel"
              aria-labelledby={`mcp-client-tab-${guide.id}`}
            >
              <VStack gap={4}>
                <VStack gap={1}>
                  <Heading level={3}>{guide.label}</Heading>
                  <Text type="supporting" as="p">{guide.summary}</Text>
                </VStack>
                <ol className="mcp-step-list">
                  {guide.steps.map(step => (
                    <li key={step.title}>
                      <VStack gap={2}>
                        <Heading level={3}>{step.title}</Heading>
                        <Text type="supporting" as="p">{step.description}</Text>
                        {step.code ? (
                          <CodeBlock
                            code={step.code}
                            language={step.language ?? 'text'}
                            title={step.language === 'bash' ? 'terminal' : 'Kimi Code'}
                            width="100%"
                            size="sm"
                          />
                        ) : null}
                      </VStack>
                    </li>
                  ))}
                </ol>
                {guide.id === 'other' ? (
                  <p className="mcp-unsupported-note" role="note">
                    如果客户端只支持手工填写静态 Bearer token，当前不属于受支持客户端。请改用 Kimi Code、Claude Code 或 Codex。
                  </p>
                ) : null}
              </VStack>
            </div>
          </VStack>
        </SurfaceSection>

        <SurfaceSection title="OAuth 如何保持连接">
          <VStack gap={4}>
            <ol className="mcp-auth-flow">
              <li>添加 URL</li>
              <li>浏览器授权一次</li>
              <li>客户端保存凭据</li>
              <li>访问令牌到期后自动刷新</li>
            </ol>
            <Text type="supporting" as="p">
              自动刷新不代表永久授权。授权被撤销、长期失效或服务端拒绝 refresh token 后，需要重新登录。你可以在
              {' '}<Link href="/security">会话与授权客户端</Link>{' '}中查看或撤销授权。
            </Text>
          </VStack>
        </SurfaceSection>

        <SurfaceSection title="为什么没有 Bearer 配置" tone="quiet">
          <VStack gap={3}>
            <ul className="notice-list">
              <li>静态 Bearer 会过期，配置文件不会自动同步新 token。</li>
              <li>把 token 放入配置、截图或聊天记录会增加泄露风险。</li>
              <li>原生 OAuth 客户端能自动获取和刷新 token，因此本页面只提供 OAuth 方式。</li>
            </ul>
            <Text type="supporting" as="p">
              需要帮助请联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>。
            </Text>
          </VStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
