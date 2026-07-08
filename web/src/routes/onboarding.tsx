import { createFileRoute } from '@tanstack/react-router';
import { Button, FormLayout, StatusDot, TextInput } from '@astryxdesign/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { DefinitionList, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { configureAccount, getOnboardingStatus } from '../lib/api.js';
import { requireWebSession } from '../route-guards.js';

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireWebSession,
  component: OnboardingPage,
});

function OnboardingPage() {
  const queryClient = useQueryClient();
  const onboarding = useQuery({
    queryKey: ['onboarding'],
    queryFn: getOnboardingStatus,
  });
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [encodingAESKey, setEncodingAESKey] = useState('');
  const [resourceName, setResourceName] = useState('默认微信公众号资源');
  const status = onboarding.data;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!status?.tenantId || !status.resourceId) {
        throw new Error('当前 Tenant 尚未创建可配置的微信公众号资源，请先完成登录引导。');
      }
      return await configureAccount({
        tenantId: status.tenantId,
        accountId: status.resourceId,
        appId,
        appSecret,
        token: webhookToken,
        encodingAESKey,
      });
    },
    onSuccess: async () => {
      setAppSecret('');
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <>
      <PageHeader
        title="配置微信公众号资源"
        description="每个 Tenant 至少有一个未配置资源。AppID/AppSecret 通过平台 HTTPS relay 验证成功后才会激活；Webhook 凭据可稍后补充。"
      />
      <PageStack>
        <SurfaceSection title="Tenant 与资源状态">
          <DefinitionList columns="multi" items={[
            { label: 'Tenant', value: status?.tenantId ?? (onboarding.isLoading ? '读取中…' : '未创建') },
            { label: '微信公众号资源', value: status?.resourceName ?? resourceName },
            { label: '凭据状态', value: <span className="inline-status"><StatusDot variant={status?.configured ? 'success' : 'warning'} label={status?.configured ? '已配置' : '未配置'} />{status?.configured ? `已验证 ${status.appId ?? ''}` : '未配置 AppID/AppSecret'}</span> },
            { label: 'Webhook', value: status?.webhookConfigured ? '已配置' : '可选；仅收件箱和入站消息能力需要' },
          ]} />
        </SurfaceSection>
        <SurfaceSection title="平台 relay 白名单">
          <p className="section-copy">在微信公众平台把 SaaS relay 的固定出口 IP 加入白名单后再提交凭据。验证失败不会保存 AppSecret。</p>
          <ul className="notice-list">
            <li>确认公众号类型支持对应接口权限。</li>
            <li>确认 AppSecret 未过期且与 AppID 匹配。</li>
            <li>如果微信返回 IP 白名单错误，先更新平台 relay 出口 IP，再重试验证。</li>
          </ul>
        </SurfaceSection>
        <SurfaceSection title="提交凭据">
          <form onSubmit={submitCredentials}>
            <FormLayout>
              <TextInput label="资源名称" htmlName="name" value={resourceName} onChange={setResourceName} />
              <TextInput label="AppID" htmlName="appId" value={appId} onChange={setAppId} placeholder="wx..." isRequired />
              <TextInput label="AppSecret" htmlName="appSecret" type="password" value={appSecret} onChange={setAppSecret} placeholder="只发送到远程 Worker，不保存在浏览器" isRequired />
              <TextInput label="Webhook Token（可选）" htmlName="token" value={webhookToken} onChange={setWebhookToken} placeholder="启用收件箱前再配置也可以" />
              <TextInput label="EncodingAESKey（可选）" htmlName="encodingAESKey" value={encodingAESKey} onChange={setEncodingAESKey} placeholder="安全模式回调需要" />
            </FormLayout>
            <div className="inline-actions">
              <Button label="验证并保存" type="submit" variant="primary" isLoading={mutation.isPending} isDisabled={!appId || !appSecret || !status?.tenantId || !status.resourceId} />
              <Button label="稍后配置 Webhook" href="/mcp" />
            </div>
          </form>
          {mutation.error ? (
            <p className="section-copy">
              {mutation.error instanceof Error ? mutation.error.message : '凭据验证失败，请确认微信白名单和 AppSecret。'}
            </p>
          ) : null}
          {onboarding.error ? (
            <p className="section-copy">
              {onboarding.error instanceof Error ? onboarding.error.message : '读取 onboarding 状态失败。'}
            </p>
          ) : null}
        </SurfaceSection>
      </PageStack>
    </>
  );
}
