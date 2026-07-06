import { createFileRoute } from '@tanstack/react-router';
import { Button, Link, TextInput } from '@astryxdesign/core';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';

const loginSearchSchema = z.object({
  returnTo: z.string().optional(),
}).catch({});

const emailSchema = z.string().email('请输入可接收验证码的邮箱。');

export const Route = createFileRoute('/login')({
  validateSearch: search => loginSearchSchema.parse(search),
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const emailError = useMemo(() => {
    if (!email) return undefined;
    const parsed = emailSchema.safeParse(email);
    return parsed.success ? undefined : parsed.error.issues[0]?.message;
  }, [email]);

  return (
    <>
      <PageHeader
        title="邮箱优先登录"
        description="输入邮箱获取 6 位验证码。Turnstile 校验和频率限制由 Worker API 处理；GitHub 仅作为可选身份提供方。"
      />
      <PageStack>
        <SurfaceSection title="请求验证码">
          <form className="form-grid" method="post" action="/api/v1/auth/email-code/request">
            <input type="hidden" name="returnTo" value={search.returnTo ?? '/onboarding'} />
            <TextInput
              label="邮箱"
              type="email"
              htmlName="email"
              value={email}
              onChange={setEmail}
              placeholder="operator@example.com"
              status={emailError ? { type: 'error', message: emailError } : undefined}
              isRequired
            />
            <div className="section-copy">这里预留 Turnstile 小组件挂载点；服务端仍必须验证 token 后才发验证码。</div>
            <div className="inline-actions">
              <Button label="发送验证码" type="submit" variant="primary" isDisabled={!!emailError || !email} />
              <Button label="使用 GitHub 登录" href="/auth/github/callback" />
            </div>
          </form>
        </SurfaceSection>
        <SurfaceSection title="输入验证码">
          <form className="form-grid" method="post" action="/api/v1/auth/email-code/verify">
            <input type="hidden" name="returnTo" value={search.returnTo ?? '/onboarding'} />
            <TextInput label="邮箱" type="email" htmlName="email" value={email} onChange={setEmail} isRequired />
            <TextInput label="6 位验证码" htmlName="code" value={code} onChange={setCode} placeholder="123456" isRequired />
            <Button label="完成登录" type="submit" variant="primary" isDisabled={!email || code.length < 6} />
          </form>
          <p className="section-copy" style={{ marginTop: 14 }}>
            旧共享授权密码将在新身份系统上线时移除。已有 CLI/MCP 客户端需要重新授权。
          </p>
          <p className="section-copy" style={{ marginTop: 8 }}>
            无法收信？联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>。
          </p>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
