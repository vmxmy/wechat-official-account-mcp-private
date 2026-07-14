import { createFileRoute } from '@tanstack/react-router';
import { Button, Card, Grid, Heading, HStack, Link, StatusDot, Text, VStack } from '@astryxdesign/core';
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

const planOrder = { free: 0, plus: 1, pro: 2 } as const;
const planLabels = { free: 'Free', plus: 'Plus', pro: 'Pro' } as const;

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
  const currentPlan = billing.data?.plan;

  return (
    <>
      <PageHeader
        eyebrow="订阅管理"
        title="订阅与用量"
        description="查看当前套餐、周期重置时间和可用额度，并在需要时升级套餐。"
      />
      <PageStack>
        <SurfaceSection title="当前订阅" tone="accent">
          <DefinitionList columns="multi" items={[
            { label: '工作空间', value: tenantId ?? (current.isLoading ? '读取中…' : '未创建') },
            { label: '当前套餐', value: currentPlan ? planLabels[currentPlan] : billing.isLoading ? '读取中…' : '—' },
            { label: '订阅状态', value: billing.isLoading ? '读取中…' : formatBillingStatus(billing.data?.status) },
            { label: '周期重置', value: billing.data?.currentPeriodEnd ? formatBillingTime(billing.data.currentPeriodEnd) : '按服务端配额周期' },
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
        <SurfaceSection title="套餐">
          <Grid columns={{ minWidth: 260, max: 3 }} gap={4} align="stretch">
            {plans.map(plan => {
              const isPaidPlan = plan.plan !== 'free';
              const isCurrentPlan = currentPlan === plan.plan;
              const canUpgrade = isPaidPlan && (!currentPlan || planOrder[plan.plan] > planOrder[currentPlan]);
              const isCurrentAttempt = checkout.variables === plan.plan;
              return (
                <Card
                  key={plan.name}
                  className={`plan-card${plan.plan === 'pro' ? ' plan-card--featured' : ''}`}
                  padding={5}
                  variant={plan.plan === 'pro' ? 'teal' : 'default'}
                >
                  <VStack gap={4}>
                    <VStack gap={1}>
                      {isCurrentPlan ? <span className="plan-badge">当前套餐</span> : plan.plan === 'pro' ? <span className="plan-badge">适合高频运营</span> : null}
                      <Heading level={3}>{plan.name}</Heading>
                      <Text type="large" weight="semibold">{plan.price}</Text>
                    </VStack>
                    <DefinitionList items={[
                      { label: '资源额度', value: plan.accounts },
                      { label: '发布额度', value: plan.publishes },
                      { label: '工具调用', value: plan.calls },
                      { label: '状态', value: <HStack gap={2} as="span"><StatusDot variant={plan.plan === 'free' ? 'neutral' : 'accent'} label={plan.name} />{plan.plan === 'free' ? '自动启用' : 'Stripe 月付'}</HStack> },
                    ]} />
                    {canUpgrade ? (
                      <VStack gap={2}>
                        <Button
                          label={`升级到 ${plan.name}`}
                          variant="primary"
                          className="auth-full-width"
                          isLoading={checkout.isPending && isCurrentAttempt}
                          isDisabled={!tenantId || checkout.isPending}
                          clickAction={async () => checkout.mutate(plan.plan as PaidPlan)}
                        />
                        <Text type="supporting" as="p">将前往 Stripe 安全结账页面，付款前可再次确认价格。</Text>
                        {checkout.isError && isCurrentAttempt ? (
                          <p className="form-error" role="alert">
                            {checkout.error instanceof Error ? checkout.error.message : '请稍后重试。'}
                          </p>
                        ) : null}
                      </VStack>
                    ) : isCurrentPlan ? (
                      <HStack gap={2} vAlign="center">
                        <StatusDot variant="success" label={`${plan.name} 是当前套餐`} />
                        <Text type="supporting">当前正在使用</Text>
                      </HStack>
                    ) : null}
                  </VStack>
                </Card>
              );
            })}
          </Grid>
        </SurfaceSection>
        <SurfaceSection title="账单说明" tone="quiet">
          <Text type="supporting" as="p">
            订阅按月结算。支付由 Stripe 处理；WOA 不保存银行卡号。查看 <Link href="/legal/terms">服务条款</Link> 与 <Link href="/legal/privacy">隐私说明</Link>。
          </Text>
        </SurfaceSection>
      </PageStack>
    </>
  );
}

function formatBillingTime(value: number): string {
  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? '时间暂不可用'
    : date.toLocaleString('zh-CN', { hour12: false });
}

function formatBillingStatus(status: string | undefined): string {
  if (!status) return '暂不可用';
  if (status === 'active_free') return 'Free 套餐生效中';
  if (status === 'active_paid' || status === 'active') return '付费套餐生效中';
  if (status === 'past_due') return '付款需要处理';
  if (status === 'canceled') return '订阅已取消';
  return '状态待确认';
}
