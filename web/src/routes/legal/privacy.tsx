import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, PageStack, SurfaceSection } from '../../components/Page.js';

export const Route = createFileRoute('/legal/privacy')({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <>
      <PageHeader title="隐私说明" description="说明 WOA 如何处理登录、凭据、支付和保留周期数据。" />
      <PageStack>
        <SurfaceSection title="凭据与支付">
          <ul className="notice-list">
            <li>WeChat AppSecret 加密存储在 Cloudflare D1，失败验证不会持久化。</li>
            <li>Stripe 处理支付方式；WOA 保存 Tenant 订阅状态和 Stripe 标识符，不保存银行卡号。</li>
            <li>CLI 本地只保存 OAuth/session 数据，不保存微信 AppSecret。</li>
          </ul>
        </SurfaceSection>
        <SurfaceSection title="保留周期">
          <ul className="notice-list">
            <li>关键 audit log 保留 180 天。</li>
            <li>R2 临时媒体输入保留 30 天。</li>
            <li>入站消息保留 90 天。</li>
          </ul>
        </SurfaceSection>
        <SurfaceSection title="联系">
          <p className="section-copy">删除请求、数据问题和安全报告：support@ziikoo.app。</p>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
