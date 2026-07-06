import { createFileRoute } from '@tanstack/react-router';
import { Button, StatusDot } from '@astryxdesign/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DefinitionList, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { createCheckoutSession } from '../lib/api.js';
import { PRODUCTION_ORIGIN } from '../lib/mcp-config.js';
import { requireWebSession } from '../route-guards.js';

type PaidPlan = 'plus' | 'pro';

const plans: Array<{ name: string; plan: 'free' | PaidPlan; price: string; accounts: string; publishes: string; calls: string }> = [
  { name: 'Free', plan: 'free', price: '$0/月', accounts: '1 个资源', publishes: '30 次成功发布', calls: '300 次工具调用' },
  { name: 'Plus', plan: 'plus', price: '$9/月', accounts: '3 个资源', publishes: '300 次成功发布', calls: '3,000 次工具调用' },
  { name: 'Pro', plan: 'pro', price: '$29/月', accounts: '10 个资源', publishes: '3,000 次成功发布', calls: '30,000 次工具调用' },
];

export const Route = createFileRoute('/billing')({
  beforeLoad: requireWebSession,
  component: BillingPage,
});

function BillingPage() {
  const queryClient = useQueryClient();
  const checkout = useMutation({
    mutationFn: async (plan: PaidPlan) => await createCheckoutSession({
      tenantId: 'current',
      plan,
      successUrl: new URL('/billing/success', PRODUCTION_ORIGIN).toString(),
      cancelUrl: new URL('/billing/cancel', PRODUCTION_ORIGIN).toString(),
    }),
    onSuccess: async session => {
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      window.location.assign(session.url);
    },
  });

  return (
    <>
      <PageHeader
        title="订阅与用量"
        description="订阅绑定 Tenant。Free 自动生效；Plus/Pro 由 Web 或 CLI 创建 Stripe Checkout，MCP 只返回升级指引。"
      />
      <PageStack>
        {plans.map(plan => (
          <SurfaceSection key={plan.name} title={`${plan.name} ${plan.price}`}>
            <DefinitionList items={[
              { label: '资源额度', value: plan.accounts },
              { label: '发布额度', value: plan.publishes },
              { label: '工具调用', value: plan.calls },
              { label: '状态', value: <span className="inline-status"><StatusDot variant={plan.plan === 'free' ? 'neutral' : 'accent'} label={plan.name} />{plan.plan === 'free' ? '自动启用' : 'Stripe 月付'}</span> },
            ]} />
            {plan.plan !== 'free' ? (
              <div className="inline-actions" style={{ marginTop: 16 }}>
                <Button
                  label={`升级到 ${plan.name}`}
                  variant="primary"
                  isLoading={checkout.isPending}
                  clickAction={async () => checkout.mutate(plan.plan)}
                />
                <span className="section-copy mono">woa billing checkout --plan {plan.plan}</span>
              </div>
            ) : null}
          </SurfaceSection>
        ))}
        {checkout.error ? (
          <SurfaceSection title="Checkout 未创建">
            <p className="section-copy">{checkout.error instanceof Error ? checkout.error.message : '请稍后重试。'}</p>
          </SurfaceSection>
        ) : null}
      </PageStack>
    </>
  );
}
