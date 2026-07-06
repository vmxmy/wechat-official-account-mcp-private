import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, PageStack, SurfaceSection } from '../../components/Page.js';

export const Route = createFileRoute('/legal/terms')({
  component: TermsPage,
});

function TermsPage() {
  return (
    <>
      <PageHeader title="服务条款" description="首版公共 SaaS 条款摘要；正式上线前由产品负责人确认版本。" />
      <PageStack>
        <SurfaceSection title="使用边界">
          <ul className="notice-list">
            <li>WOA 仅提供远程 MCP、Web 和 CLI 入口，不提供本地 stdio/SSE 运行时。</li>
            <li>Operator 必须确保提交的微信公众号凭据属于其有权管理的 Tenant。</li>
            <li>视频发布首版不支持；文章和图片/贴图发布受微信官方接口与订阅额度限制。</li>
          </ul>
        </SurfaceSection>
        <SurfaceSection title="支持">
          <p className="section-copy">账单、删除请求和安全问题请联系 support@ziikoo.app。</p>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
