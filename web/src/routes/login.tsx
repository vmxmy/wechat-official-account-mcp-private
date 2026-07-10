import { createFileRoute } from '@tanstack/react-router';
import { Button, Card, Divider, FormLayout, Heading, Link, Text, TextInput, VStack } from '@astryxdesign/core';
import { Activity, Cable, Github, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { VerificationCodeInput } from '../components/VerificationCodeInput.js';

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
  const errorCode = notice?.get('error');
  const isCodeSent = notice?.get('sent') === '1';
  const isCodeComplete = /^\d{6}$/.test(code);

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-story" aria-label="WOA 产品介绍">
          <div className="auth-story-content">
            <div className="auth-brand-row">
              <div className="auth-logo" aria-hidden="true">W</div>
              <div>
                <strong className="auth-brand-name">WOA</strong>
                <span className="auth-brand-subtitle">微信公众号 MCP</span>
              </div>
            </div>

            <div className="auth-story-copy">
              <span className="page-eyebrow">REMOTE CONTROL CENTER</span>
              <h1 className="auth-story-title">让公众号能力，安全地进入你的 AI 工作流。</h1>
              <p className="auth-story-description">
                WOA 将微信 API、OAuth、租户隔离和边缘运行统一成一个清晰、可控的远程 MCP 入口。
              </p>
            </div>

            <div className="auth-benefit-list">
              <AuthBenefit
                icon={<Cable aria-hidden="true" size={19} strokeWidth={1.8} />}
                title="远程 MCP"
                description="Streamable HTTP 与原生 OAuth 授权"
              />
              <AuthBenefit
                icon={<ShieldCheck aria-hidden="true" size={19} strokeWidth={1.8} />}
                title="凭据隔离"
                description="AppSecret 只进入受保护的 Worker"
              />
              <AuthBenefit
                icon={<Activity aria-hidden="true" size={19} strokeWidth={1.8} />}
                title="持续可控"
                description="用量、会话和授权状态集中可见"
              />
            </div>
          </div>

          <p className="auth-story-meta">Cloudflare Workers · OAuth · D1 / R2</p>
        </section>

        <main className="auth-panel">
          <div className="auth-panel-inner">
            <VStack gap={5}>
              <VStack className="auth-panel-heading" gap={2}>
                <span className="page-eyebrow">安全登录</span>
                <Heading level={1} type="display-3" textWrap="balance">欢迎回来</Heading>
                <Text type="supporting" as="p" textWrap="pretty">
                  登录后继续管理公众号接入、MCP 授权、用量与订阅。
                </Text>
              </VStack>

              <Card className="auth-card" padding={6} width="100%" maxWidth={480}>
                <VStack gap={4}>
                  {errorCode ? (
                    <div className="form-error" role="alert">登录请求未完成：{loginErrorMessage(errorCode)}</div>
                  ) : null}

                  <Button
                    label="使用 GitHub 继续"
                    href={githubLoginHref}
                    icon={<Github aria-hidden="true" size={18} strokeWidth={1.8} />}
                    variant="primary"
                    className="auth-full-width auth-provider-button"
                  />

                  <Divider label="或使用邮箱验证码" />

                  <form method="post" action="/api/v1/auth/email-code/request">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <FormLayout className="auth-email-request-grid">
                      <TextInput
                        label="邮箱地址"
                        type="email"
                        htmlName="email"
                        value={email}
                        onChange={setEmail}
                        placeholder="operator@example.com"
                        status={emailError ? { type: 'error', message: emailError } : undefined}
                        isRequired
                        hasAutoFocus={!isCodeSent}
                      />
                      {turnstileSiteKey ? (
                        <div className="auth-turnstile cf-turnstile" data-sitekey={turnstileSiteKey} />
                      ) : (
                        <Text className="auth-build-note" type="supporting" as="p">
                          当前构建未配置 Turnstile site key；生产环境必须配置后端 secret 并启用小组件。
                        </Text>
                      )}
                      {isCodeSent ? (
                        <div className="auth-success" role="status">验证码已发送，请查收邮箱并在下方输入 6 位数字。</div>
                      ) : null}
                      <Button
                        label="发送验证码"
                        type="submit"
                        className="auth-full-width"
                        isDisabled={!!emailError || !email}
                      />
                    </FormLayout>
                  </form>

                  <form method="post" action="/api/v1/auth/email-code/verify">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="email" value={email} />
                    <FormLayout>
                      <VerificationCodeInput
                        value={code}
                        onChange={setCode}
                        hasAutoFocus={isCodeSent}
                      />
                      <Button
                        label="完成登录"
                        type="submit"
                        variant="primary"
                        className="auth-full-width"
                        isDisabled={!email || !isCodeComplete}
                      />
                    </FormLayout>
                  </form>
                </VStack>
              </Card>

              <Text className="auth-support" type="supporting" as="p" justify="center">
                无法登录？联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>
              </Text>
            </VStack>
          </div>
        </main>
      </div>
    </div>
  );
}

function AuthBenefit({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="auth-benefit">
      <span className="auth-benefit-icon">{icon}</span>
      <span className="auth-benefit-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </div>
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
    case 'turnstile':
      return '人机校验未通过，请刷新后重试。';
    case 'rate_limited':
      return '验证码请求过于频繁，请稍后重试。';
    case 'email_delivery_failed':
      return '验证码邮件发送失败，请稍后重试。';
    case 'invalid_email':
      return '请输入有效邮箱。';
    default:
      return code ?? 'unknown';
  }
}
