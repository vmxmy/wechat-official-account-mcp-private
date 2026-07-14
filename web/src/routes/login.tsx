import { createFileRoute } from '@tanstack/react-router';
import { Banner, Button, Card, Divider, FormLayout, Heading, Link, Text, TextInput, VStack } from '@astryxdesign/core';
import { Github } from 'lucide-react';
import { useMemo, useState } from 'react';
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
  const emailLoginAvailable = Boolean(turnstileSiteKey);

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
              <span className="page-eyebrow">微信公众号远程接入</span>
              <h1 className="auth-story-title">安全连接公众号与 AI 客户端</h1>
              <p className="auth-story-description">
                在一个入口中配置公众号凭据、连接远程 MCP，并查看授权与套餐用量。
              </p>
            </div>

            <ul className="auth-fact-list">
              <li>AppSecret 仅发送到受保护的服务端，不写入浏览器配置。</li>
              <li>AI 客户端通过 OAuth 连接远程 MCP，无需复制访问令牌。</li>
              <li>会话、授权和套餐用量可随时查看与撤销。</li>
            </ul>
          </div>

          <p className="auth-story-meta">远程 MCP · OAuth 授权 · 凭据加密存储</p>
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

                  <form method="post" action="/api/v1/auth/email-code/request">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <FormLayout className="auth-email-request-grid">
                      <TextInput
                        label="邮箱地址（必填）"
                        type="email"
                        htmlName="email"
                        value={email}
                        onChange={setEmail}
                        placeholder="operator@example.com"
                        status={emailError ? { type: 'error', message: emailError } : undefined}
                        aria-required="true"
                        hasAutoFocus={!isCodeSent}
                      />
                      {turnstileSiteKey ? (
                        <div className="auth-turnstile cf-turnstile" data-sitekey={turnstileSiteKey} />
                      ) : !isCodeSent ? (
                        <Banner
                          status="warning"
                          title="邮箱验证码登录暂不可用"
                          description="请暂时使用 GitHub 登录，或联系支持人员。"
                        />
                      ) : null}
                      {isCodeSent ? (
                        <div className="auth-success" role="status">验证码已发送，请查收邮箱并在下方输入 6 位数字。</div>
                      ) : null}
                      <Button
                        label={isCodeSent ? '重新发送验证码' : '发送验证码'}
                        type="submit"
                        variant="primary"
                        className="auth-full-width"
                        isDisabled={!emailLoginAvailable || !!emailError || !email}
                      />
                    </FormLayout>
                  </form>

                  {isCodeSent ? (
                    <form method="post" action="/api/v1/auth/email-code/verify">
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="email" value={email} />
                      <FormLayout>
                        <VerificationCodeInput
                          value={code}
                          onChange={setCode}
                          hasAutoFocus
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
                  ) : null}

                  <Divider label="其他登录方式" />

                  <Button
                    label="使用 GitHub 登录"
                    href={githubLoginHref}
                    icon={<Github aria-hidden="true" size={18} strokeWidth={1.8} />}
                    className="auth-full-width auth-provider-button"
                  />
                </VStack>
              </Card>

              <Text className="auth-support" type="supporting" as="p" justify="center">
                <Link href="/legal/terms">服务条款</Link> · <Link href="/legal/privacy">隐私说明</Link> · 无法登录请联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>
              </Text>
            </VStack>
          </div>
        </main>
      </div>
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
