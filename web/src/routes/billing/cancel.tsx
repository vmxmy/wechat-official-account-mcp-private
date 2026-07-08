import { createFileRoute } from '@tanstack/react-router';
import { Button, HStack } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../../components/Page.js';
import { requireWebSession } from '../../route-guards.js';

export const Route = createFileRoute('/billing/cancel')({
  beforeLoad: requireWebSession,
  component: BillingCancelPage,
});

function BillingCancelPage() {
  return (
    <>
      <PageHeader title="Checkout 已取消" description="未创建新的订阅。Free 计划仍可继续使用当前额度。" />
      <PageStack>
        <SurfaceSection title="继续操作">
          <p className="section-copy">可以重新选择 Plus/Pro，或先完成微信公众号资源配置。</p>
          <HStack gap={3} wrap="wrap">
            <Button label="返回订阅" href="/billing" variant="primary" />
            <Button label="配置公众号" href="/onboarding" />
          </HStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
