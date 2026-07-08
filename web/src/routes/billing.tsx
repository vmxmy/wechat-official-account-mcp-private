import { createFileRoute } from '@tanstack/react-router';
import { Button, Card, Grid, Heading, HStack, StatusDot, Text, VStack } from '@astryxdesign/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DefinitionList, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { createCheckoutSession, getBillingStatus, getCurrentOperator } from '../lib/api.js';
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
  const current = useQuery({
    queryKey: ['current-operator'],
    queryFn: getCurrentOperator,
  });
  const tenantId = current.data?.defaultTenantId;
  const billing = useQuery({
    queryKey: ['billing', tenantId],
    queryFn: async () => await getBillingStatus(tenantId!),
    enabled: !!tenantId,
  });
  const checkout = useMutation({
    mutationFn: async (plan: PaidPlan) => await createCheckoutSession({
      tenantId: tenantId!,
      plan,
      successUrl: new URL('/billing/success', PRODUCTION_ORIGIN).toString(),
      cancelUrl: new URL('/billing/cancel', PRODUCTION_ORIGIN).toString(),
    }),
    onSuccess: async session => {
      await queryClient.invalidateQueries({ queryKey: ['billing', tenantId] });
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
        <SurfaceSection title="当前订阅">
          <DefinitionList columns="multi" items={[
            { label: 'Tenant', value: tenantId ?? (current.isLoading ? '读取中…' : '未创建') },
            { label: 'Plan', value: billing.data?.plan ?? '—' },
            { label: '状态', value: billing.data?.status ?? (billing.isLoading ? '读取中…' : '—') },
            { label: '周期重置', value: billing.data?.currentPeriodEnd ? new Date(billing.data.currentPeriodEnd).toLocaleString('zh-CN', { hour12: false }) : '按服务端配额周期' },
          ]} />
        </SurfaceSection>
        {current.error || billing.error ? (
          <SurfaceSection title="订阅状态读取失败">
            <p className="section-copy">
              {(current.error instanceof Error && current.error.message) ||
                (billing.error instanceof Error && billing.error.message) ||
                '请刷新后重试。'}
            </p>
          </SurfaceSection>
        ) : null}
        <SurfaceSection title="套餐" isFlush>
          <Grid columns={{ minWidth: 260, max: 3 }} gap={4} align="stretch">
            {plans.map(plan => {
              const isPaidPlan = plan.plan !== 'free';
              const isCurrentAttempt = checkout.variables === plan.plan;
              return (
                <Card key={plan.name} padding={5} variant={plan.plan === 'pro' ? 'teal' : 'default'}>
                  <VStack gap={4}>
                    <VStack gap={1}>
                      <Heading level={3}>{plan.name}</Heading>
                      <Text type="large" weight="semibold">{plan.price}</Text>
                    </VStack>
                    <DefinitionList items={[
                      { label: '资源额度', value: plan.accounts },
                      { label: '发布额度', value: plan.publishes },
                      { label: '工具调用', value: plan.calls },
                      { label: '状态', value: <HStack gap={2} as="span"><StatusDot variant={plan.plan === 'free' ? 'neutral' : 'accent'} label={plan.name} />{plan.plan === 'free' ? '自动启用' : 'Stripe 月付'}</HStack> },
                    ]} />
                    {isPaidPlan ? (
                      <VStack gap={2}>
                        <Button
                          label={`升级到 ${plan.name}`}
                          variant="primary"
                          className="auth-full-width"
                          isLoading={checkout.isPending && isCurrentAttempt}
                          isDisabled={!tenantId || checkout.isPending}
                          clickAction={async () => checkout.mutate(plan.plan as PaidPlan)}
                        />
                        <Text type="supporting" as="p" className="mono">woa billing checkout --plan {plan.plan}</Text>
                        {checkout.isError && isCurrentAttempt ? (
                          <p className="form-error" role="alert">
                            {checkout.error instanceof Error ? checkout.error.message : '请稍后重试。'}
                          </p>
                        ) : null}
                      </VStack>
                    ) : null}
                  </VStack>
                </Card>
              );
            })}
          </Grid>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
