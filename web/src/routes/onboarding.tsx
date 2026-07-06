import { createFileRoute } from '@tanstack/react-router';
import { Button, StatusDot, TextInput } from '@astryxdesign/core';
import { useState } from 'react';
import { DefinitionList, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { requireWebSession } from '../route-guards.js';

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireWebSession,
  component: OnboardingPage,
});

function OnboardingPage() {
  const [appId, setAppId] = useState('');
  const [resourceName, setResourceName] = useState('默认微信公众号资源');

  return (
    <>
      <PageHeader
        title="配置微信公众号资源"
        description="每个 Tenant 至少有一个未配置资源。AppID/AppSecret 通过平台 HTTPS relay 验证成功后才会激活；Webhook 凭据可稍后补充。"
      />
      <PageStack>
        <SurfaceSection title="Tenant 与资源状态">
          <DefinitionList items={[
            { label: 'Tenant', value: '默认 Tenant（首次登录自动创建）' },
            { label: '微信公众号资源', value: resourceName || '默认微信公众号资源' },
            { label: '凭据状态', value: <span className="inline-status"><StatusDot variant="warning" label="未配置" />未配置 AppID/AppSecret</span> },
            { label: 'Webhook', value: '可选；仅收件箱和入站消息能力需要' },
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
          <form className="form-grid" method="post" action="/api/v1/tenants/current/accounts/current/configure">
            <TextInput label="资源名称" htmlName="name" value={resourceName} onChange={setResourceName} />
            <TextInput label="AppID" htmlName="appId" value={appId} onChange={setAppId} placeholder="wx..." isRequired />
            <TextInput label="AppSecret" htmlName="appSecret" type="password" value="" onChange={() => undefined} placeholder="只发送到远程 Worker，不保存在浏览器" isRequired />
            <div className="inline-actions">
              <Button label="验证并保存" type="submit" variant="primary" isDisabled={!appId} />
              <Button label="稍后配置 Webhook" href="/mcp" />
            </div>
          </form>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
