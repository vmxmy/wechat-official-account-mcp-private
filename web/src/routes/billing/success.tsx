import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../../components/Page.js';

export const Route = createFileRoute('/billing/success')({
  component: BillingSuccessPage,
});

function BillingSuccessPage() {
  return (
    <>
      <PageHeader title="订阅处理中" description="Stripe 已返回成功页面。Webhook 同步完成后，Tenant 额度会更新。" />
      <PageStack>
        <SurfaceSection title="下一步">
          <p className="section-copy">返回订阅页确认当前计划、周期结束时间和剩余额度。</p>
          <div className="inline-actions" style={{ marginTop: 16 }}>
            <Button label="查看订阅" href="/billing" variant="primary" />
            <Button label="配置 MCP" href="/mcp" />
          </div>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
