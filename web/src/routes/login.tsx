import { createFileRoute } from '@tanstack/react-router';
import { Button, Card, Center, Divider, FormLayout, Heading, Link, Text, TextInput, VStack } from '@astryxdesign/core';
import { useMemo, useState } from 'react';
import { z } from 'zod';

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

  return (
    <div className="auth-page">
      <Center axis="both" height="100%">
        <VStack gap={4} hAlign="center" width="min(100%, 440px)">
          <VStack gap={2} hAlign="center">
            <div className="auth-logo" aria-hidden="true">WOA</div>
            <Heading level={1} type="display-3" justify="center" textWrap="balance">登录 WOA</Heading>
            <Text type="supporting" as="p" justify="center" textWrap="pretty">
              使用同一个账户管理微信公众号 MCP、OAuth 授权、用量和订阅。
            </Text>
          </VStack>

          <Card padding={8} width="100%" maxWidth={440}>
            <VStack gap={4}>
              {errorCode ? (
                <div className="form-error" role="alert">登录请求未完成：{loginErrorMessage(errorCode)}</div>
              ) : null}

              <Button
                label="使用 GitHub 继续"
                href={githubLoginHref}
                variant="primary"
                className="auth-full-width"
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
                    hasAutoFocus
                  />
                  {turnstileSiteKey ? (
                    <div className="auth-turnstile cf-turnstile" data-sitekey={turnstileSiteKey} />
                  ) : (
                    <Text type="supporting" as="p">当前构建未配置 Turnstile site key；生产环境必须配置后端 secret 并启用小组件。</Text>
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
                  <TextInput
                    label="6 位验证码"
                    htmlName="code"
                    value={code}
                    onChange={setCode}
                    placeholder="123456"
                    description="验证码有效期有限；如未收到，可重新发送。"
                    isRequired
                  />
                  <Button
                    label="完成登录"
                    type="submit"
                    variant="primary"
                    className="auth-full-width"
                    isDisabled={!email || code.length < 6}
                  />
                </FormLayout>
              </form>
            </VStack>
          </Card>

          <Text type="supporting" as="p" justify="center">
            无法登录？联系 <Link href="mailto:support@ziikoo.app">support@ziikoo.app</Link>
          </Text>
        </VStack>
      </Center>
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
