function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderAuthorizationConsentForm(input: {
  query: string;
  clientId: string;
  scopes: string[];
  error?: string;
}): Response {
  const errorHtml = input.error
    ? `<p class="error">${escapeHtml(input.error)}</p>`
    : '';
  const scopeItems = input.scopes.length > 0
    ? input.scopes.map(scope => `<li>${escapeHtml(scope)}</li>`).join('')
    : '<li>基础登录授权</li>';

  return new Response(
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>微信公众号 MCP 授权</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #f7f7f8; }
    form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; min-width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,.06); }
    h1 { margin: 0 0 16px; font-size: 18px; }
    label { display: block; margin-bottom: 8px; color: #374151; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
    button { width: 100%; border: 0; border-radius: 8px; padding: 10px 12px; background: #111827; color: white; font-weight: 600; cursor: pointer; }
    .error { color: #dc2626; margin: 0 0 12px; }
  </style>
</head>
<body>
  <form method="POST" action="/authorize?${escapeHtml(input.query)}">
    <h1>授权访问微信公众号 MCP</h1>
    ${errorHtml}
    <p>客户端 <strong>${escapeHtml(input.clientId || 'unknown client')}</strong> 请求访问你的 WOA 租户。</p>
    <label>授权范围</label>
    <ul>${scopeItems}</ul>
    <input type="hidden" name="consent" value="approve" />
    <button type="submit">授权</button>
  </form>
</body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // OAuth 表单会在同源 POST 后跳转到已验证的动态 redirect_uri；form-action 会校验整条重定向链并拦截 CLI 本机回调。
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}
