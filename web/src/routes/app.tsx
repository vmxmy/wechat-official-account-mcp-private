import { createFileRoute } from '@tanstack/react-router';
import { Banner, Button, HStack, Link, List, ListItem, ProgressBar, StatusDot, Text, VStack } from '@astryxdesign/core';
import { useQuery } from '@tanstack/react-query';
import { DefinitionList, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { getCurrentOperator, getOnboardingStatus, getQuotaSummary } from '../lib/api.js';
import { mcpUrl } from '../lib/mcp-config.js';
import { requireWebSession } from '../route-guards.js';

const planLabels = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
} as const;

const quotaLabels: Record<string, string> = {
  tool_calls_day: '每日 MCP 工具调用',
  tool_calls_month: '每月 MCP 工具调用',
  published_articles_month: '每月成功发布',
  media_uploads_month: '每月素材上传',
  stats_queries_month: '每月数据统计查询',
  message_sends_month: '每月消息发送',
  qr_codes_month: '每月二维码创建',
  high_risk_ops_month: '每月高风险操作',
};

const numberFormatter = new Intl.NumberFormat('zh-CN');

export const Route = createFileRoute('/app')({
  beforeLoad: requireWebSession,
  component: AppOverviewPage,
});

function AppOverviewPage() {
  const current = useQuery({
    queryKey: ['current-operator'],
    queryFn: getCurrentOperator,
  });
  const onboarding = useQuery({
    queryKey: ['onboarding', current.data?.defaultTenantId, current.data?.defaultAccountId],
    queryFn: () => getOnboardingStatus(current.data!),
    enabled: Boolean(current.data),
  });
  const tenantId = current.data?.defaultTenantId ?? onboarding.data?.tenantId;
  const quota = useQuery({
    queryKey: ['quota-summary', tenantId],
    queryFn: async () => await getQuotaSummary(tenantId!),
    enabled: Boolean(tenantId),
  });

  const accountConfigured = onboarding.data?.configured === true;
  const accountStatus = onboarding.isLoading
    ? '正在检查配置'
    : onboarding.error
      ? '状态暂不可用'
      : accountConfigured
        ? `已配置${onboarding.data?.resourceName ? ` · ${onboarding.data.resourceName}` : ''}`
        : '等待配置 AppID / AppSecret';
  const plan = quota.data?.plan;
  const nextStep = onboarding.error
    ? {
        title: '公众号状态暂不可用',
        description: '当前无法确认公众号是否已连接。重新读取后再继续配置 MCP 或公众号凭据。',
        label: '重新检查状态',
        clickAction: () => { void onboarding.refetch(); },
      }
    : accountConfigured
      ? {
          title: '连接你的 AI 客户端',
          description: '公众号凭据已就绪。将远程 MCP 添加到支持 Streamable HTTP 与 OAuth 的宿主并完成授权。',
          label: '查看通用 MCP 参数',
          href: '/mcp',
        } : {
          title: '完成公众号连接',
          description: '先验证 AppID / AppSecret，之后远程 MCP 才能调用这个公众号的能力。',
          label: '配置微信公众号',
          href: '/onboarding',
        };

  return (
    <>
      <PageHeader
        eyebrow="控制台"
        title="WOA 概览"
        description="查看公众号连接、远程 MCP 地址和当前套餐用量，并继续完成下一步。"
      />
      <PageStack>
        <SurfaceSection title="接入状态" tone="accent" className="overview-status-section">
          <VStack gap={5}>
            <DefinitionList items={[
              {
                label: '微信公众号',
                value: (
                  <HStack gap={2} as="span" vAlign="center">
                    <StatusDot
                      variant={onboarding.error ? 'error' : onboarding.isLoading ? 'neutral' : accountConfigured ? 'success' : 'warning'}
                      label={accountStatus}
                    />
                    <Text>{accountStatus}</Text>
                  </HStack>
                ),
              },
              {
                label: 'AppID',
                value: onboarding.data?.appId ?? (onboarding.isLoading ? '读取中…' : '尚未配置'),
              },
              {
                label: 'MCP 地址',
                value: (
                  <VStack gap={1}>
                    <HStack gap={2} as="span" vAlign="center">
                      <StatusDot variant="success" label="MCP 地址已就绪" />
                      <Text weight="medium">已就绪 · OAuth</Text>
                    </HStack>
                    <Text type="code" color="secondary">{mcpUrl()}</Text>
                  </VStack>
                ),
              },
              {
                label: '当前套餐',
                value: plan ? planLabels[plan] : quota.isLoading ? '读取中…' : tenantId ? '暂不可用' : '等待工作空间',
              },
            ]} />
            <div className="next-step-panel">
              <VStack gap={3}>
                <VStack gap={2}>
                  <Text type="large" weight="semibold">{nextStep.title}</Text>
                  <Text type="supporting" as="p" textWrap="pretty">{nextStep.description}</Text>
                </VStack>
                <HStack gap={3} wrap="wrap">
                  <Button
                    label={nextStep.label}
                    variant="primary"
                    href={'href' in nextStep ? nextStep.href : undefined}
                    clickAction={'clickAction' in nextStep ? nextStep.clickAction : undefined}
                  />
                  <Button label="查看订阅与用量" href="/billing" />
                </HStack>
              </VStack>
            </div>
          </VStack>
        </SurfaceSection>

        <SurfaceSection title="本周期用量">
          {!tenantId ? (
            <Text type="supporting" as="p">当前用户尚无可读取配额的工作空间。</Text>
          ) : quota.isLoading ? (
            <ProgressBar label="正在读取配额" isIndeterminate />
          ) : quota.error ? (
            <Banner
              status="error"
              title="套餐用量读取失败"
              description={quota.error instanceof Error ? quota.error.message : '请稍后重试。'}
              endContent={<Button label="重新读取" size="sm" clickAction={() => { void quota.refetch(); }} />}
            />
          ) : quota.data?.counters.length ? (
            <List header="本周期配额明细" hasDividers density="balanced">
              {quota.data.counters.map(counter => (
                <ListItem
                  key={counter.kind}
                  label={`${quotaLabels[counter.kind] ?? counter.kind} · ${numberFormatter.format(counter.used)} / ${numberFormatter.format(counter.limit)}`}
                  description={(
                    <VStack gap={1}>
                      <ProgressBar
                        label={quotaLabels[counter.kind] ?? counter.kind}
                        value={counter.used}
                        max={counter.limit}
                        isLabelHidden
                        variant={quotaVariant(counter.used, counter.limit)}
                      />
                      <Text type="supporting">
                        剩余 {numberFormatter.format(counter.remaining)}
                        {counter.resetAt ? ` · ${formatResetAt(counter.resetAt)} 重置` : ''}
                      </Text>
                    </VStack>
                  )}
                />
              ))}
            </List>
          ) : (
            <Text type="supporting" as="p">服务端暂未返回可展示的配额计数。</Text>
          )}
        </SurfaceSection>

        <SurfaceSection title="账户与支持" tone="quiet">
          <VStack gap={4}>
            <DefinitionList columns="multi" items={[
              {
                label: '当前用户',
                value: current.data?.operator?.displayName ?? current.data?.operator?.email ?? current.data?.userId ?? (current.isLoading ? '读取中…' : '当前用户'),
              },
              { label: '工作空间', value: tenantId ?? (current.isLoading || onboarding.isLoading ? '读取中…' : '尚未创建') },
            ]} />
            <Text type="supporting" as="p">
              法务与支持：<Link href="/legal/terms">服务条款</Link>、<Link href="/legal/privacy">隐私说明</Link>、<Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>。
            </Text>
          </VStack>
        </SurfaceSection>
      </PageStack>
    </>
  );
}

function quotaVariant(used: number, limit: number): 'accent' | 'warning' | 'error' {
  if (limit <= 0 || used >= limit) return 'error';
  if (used / limit >= 0.8) return 'warning';
  return 'accent';
}

function formatResetAt(resetAt: number): string {
  const timestamp = resetAt < 1_000_000_000_000 ? resetAt * 1000 : resetAt;
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
