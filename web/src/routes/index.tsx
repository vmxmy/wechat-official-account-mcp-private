import { createFileRoute } from '@tanstack/react-router';
import { Button, Link, Text } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <PageHeader
        title="从登录到远程 MCP，一条 hosted onboarding 路径"
        description="WOA 面向 Operator、Tenant 和微信公众号资源建模。Web 负责首次登录、凭据配置、订阅回跳和远程 MCP 配置，不恢复本地 stdio/SSE 传输。"
      />
      <PageStack>
        <SurfaceSection title="当前入口">
          <p className="section-copy">先完成邮箱验证码登录，再配置 AppID/AppSecret。CLI 和 MCP 使用同一个远程 OAuth/Streamable HTTP 后端。</p>
          <div className="inline-actions" style={{ marginTop: 16 }}>
            <Button label="开始登录" variant="primary" href="/login" />
            <Button label="查看 MCP 配置" href="/mcp" />
          </div>
        </SurfaceSection>
        <SurfaceSection title="运行约束">
          <ul className="notice-list">
            <li>微信 AppSecret 只提交给远程 Worker，不写入浏览器或 CLI 本地配置。</li>
            <li>Codex/Claude 配置只包含 <span className="mono">https://woa.ziikoo.app/mcp</span>，不嵌入 OAuth token。</li>
            <li>视频发布首版不支持；文章与图片/贴图发布继续通过远程工具处理。</li>
          </ul>
          <Text type="supporting" as="p" display="block" style={{ marginTop: 14 }}>
            法务与支持：<Link href="/legal/terms">服务条款</Link>、<Link href="/legal/privacy">隐私说明</Link>、support@ziikoo.app。
          </Text>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
