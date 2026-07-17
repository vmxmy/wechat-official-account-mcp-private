export type TurnstileSecretBinding = string | { get(): Promise<string | null> };

export interface TurnstileVerificationResult {
  ok: boolean;
  message?: string;
}

/** Fail closed in production; local development may omit Turnstile deliberately. */
export async function verifyTurnstile(input: {
  secretBinding?: TurnstileSecretBinding;
  production: boolean;
  request: Request;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileVerificationResult> {
  let secret: string | null = null;
  try {
    secret = typeof input.secretBinding === 'string'
      ? input.secretBinding
      : await input.secretBinding?.get() ?? null;
  } catch {
    return { ok: false, message: 'Turnstile 校验配置暂不可用。' };
  }
  if (!secret) {
    return input.production
      ? { ok: false, message: 'Turnstile 校验配置不可用。' }
      : { ok: true };
  }
  if (!input.token) return { ok: false, message: '缺少 Turnstile 校验 token。' };

  const body = new FormData();
  body.set('secret', secret);
  body.set('response', input.token);
  const ip = input.request.headers.get('cf-connecting-ip');
  if (ip) body.set('remoteip', ip);

  try {
    const response = await (input.fetchImpl ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    if (!response.ok) return { ok: false, message: 'Turnstile 校验服务暂不可用。' };
    const result = await response.json() as { success?: boolean };
    return result.success
      ? { ok: true }
      : { ok: false, message: 'Turnstile 校验未通过。' };
  } catch {
    return { ok: false, message: 'Turnstile 校验服务暂不可用。' };
  }
}
