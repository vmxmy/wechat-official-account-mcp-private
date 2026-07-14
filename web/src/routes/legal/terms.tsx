import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, PageStack, SurfaceSection } from '../../components/Page.js';

export const Route = createFileRoute('/legal/terms')({
  component: TermsPage,
});

function TermsPage() {
  return (
    <>
      <PageHeader title="服务条款" description="适用于 WOA 托管 Web、远程 MCP 与命令行客户端服务。生效日期：2026 年 7 月 15 日。" />
      <PageStack>
        <SurfaceSection title="服务说明">
          <ul className="notice-list">
            <li>WOA 提供微信公众号远程接入、OAuth 授权、用量管理和相关客户端配置能力。</li>
            <li>功能可用性受微信公众号接口权限、平台限制和所选套餐额度影响。</li>
            <li>服务发生重要变更时，WOA 会通过产品页面或注册邮箱提供说明。</li>
          </ul>
        </SurfaceSection>
        <SurfaceSection title="使用边界">
          <ul className="notice-list">
            <li>用户必须确保提交的微信公众号凭据属于其有权管理的公众号。</li>
            <li>视频发布首版不支持；文章和图片/贴图发布受微信官方接口与订阅额度限制。</li>
            <li>不得利用服务发送违法、侵权、欺诈或未经授权的内容与消息。</li>
          </ul>
        </SurfaceSection>
        <SurfaceSection title="支持">
          <p className="section-copy">账单、删除请求和安全问题请联系 support@ziikoo.app。</p>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
