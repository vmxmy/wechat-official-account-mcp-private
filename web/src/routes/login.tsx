import { createFileRoute } from '@tanstack/react-router';
import { Button, Link, TextInput } from '@astryxdesign/core';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';

const loginSearchSchema = z.object({
  returnTo: z.string().optional(),
}).catch({});

const emailSchema = z.string().email('请输入可接收验证码的邮箱。');
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export const Route = createFileRoute('/login')({
  validateSearch: search => loginSearchSchema.parse(search),
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const notice = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const returnTo = search.returnTo ?? '/onboarding';
  const githubLoginHref = `/auth/github/callback?returnTo=${encodeURIComponent(returnTo)}`;
  const [email, setEmail] = useState(notice?.get('email') ?? '');
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
            <input type="hidden" name="returnTo" value={returnTo} />
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
            {turnstileSiteKey ? (
              <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
            ) : (
              <div className="section-copy">当前构建未配置 Turnstile site key；生产环境必须配置后端 secret 并启用小组件。</div>
            )}
            {notice?.get('sent') === '1' ? (
              <div className="section-copy">验证码已发送，请查收邮箱并在下方输入 6 位数字。</div>
            ) : null}
            {notice?.get('error') ? (
              <div className="form-error">登录请求未完成：{loginErrorMessage(notice.get('error'))}</div>
            ) : null}
            <div className="inline-actions">
              <Button label="发送验证码" type="submit" variant="primary" isDisabled={!!emailError || !email} />
              <Button label="使用 GitHub 登录" href={githubLoginHref} />
            </div>
          </form>
        </SurfaceSection>
        <SurfaceSection title="输入验证码">
          <form className="form-grid" method="post" action="/api/v1/auth/email-code/verify">
            <input type="hidden" name="returnTo" value={returnTo} />
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

function loginErrorMessage(code: string | null): string {
  switch (code) {
    case 'github_verified_email_required':
      return 'GitHub 未返回已验证邮箱，请使用邮箱验证码完成登录。';
    case 'github_state':
      return 'GitHub 登录状态已过期，请重新授权。';
    case 'github_denied':
      return 'GitHub 授权已取消，请重试或改用邮箱验证码。';
    case 'github_not_configured':
      return 'GitHub 登录暂未配置，请使用邮箱验证码。';
    case 'github_oauth_failed':
      return 'GitHub 登录暂不可用，请稍后重试或使用邮箱验证码。';
    default:
      return code ?? 'unknown';
  }
}
