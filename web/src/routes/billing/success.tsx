import { createFileRoute } from '@tanstack/react-router';
import { Button, HStack } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../../components/Page.js';
import { requireWebSession } from '../../route-guards.js';

export const Route = createFileRoute('/billing/success')({
  beforeLoad: requireWebSession,
  component: BillingSuccessPage,
});

function BillingSuccessPage() {
  return (
    <>
      <PageHeader title="订阅处理中" description="Stripe 已确认结账返回。支付状态同步完成后，工作空间额度会自动更新。" />
      <PageStack>
        <SurfaceSection title="下一步">
          <p className="section-copy">返回订阅页确认当前计划、周期结束时间和剩余额度。</p>
          <HStack gap={3} wrap="wrap">
            <Button label="查看订阅" href="/billing" variant="primary" />
            <Button label="配置 MCP" href="/mcp" />
          </HStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
