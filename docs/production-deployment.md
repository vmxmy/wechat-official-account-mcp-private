# Production deployment

This repository deploys the HTTP-only WeChat Official Account MCP Worker to Cloudflare Workers.

## Production resources

- Worker: `wechat-official-account-mcp`
- URL: `https://woa.ziikoo.app`
- MCP endpoint: `/mcp`
- Webhook endpoint: `/wx/callback`
- Stripe webhook endpoint: `/api/stripe/webhook`
- D1 database: `wechat-official-account-mcp-prod`
- KV namespace binding: `OAUTH_KV`
- R2 bucket: `wechat-official-account-mcp-media`

The Worker intentionally does not expose MCP-over-SSE. `/sse` and the old `/messages`
transport path should return `404`.

## GitHub Actions

Workflow: `.github/workflows/deploy-production.yml`

On push to `main` or manual `workflow_dispatch`, CI runs:

1. `npm ci`
2. `npm run check`
3. `npm test`
4. `npm run lint`
5. `npx wrangler d1 migrations apply wechat-official-account-mcp-prod --remote`
6. `npx wrangler deploy --minify --keep-vars`

Deployment steps run only when these GitHub Actions secrets exist:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

`CLOUDFLARE_API_TOKEN` should be scoped to this Cloudflare account and allow Workers deploys plus D1 migration execution.

## Worker secrets

Runtime secrets are stored in Cloudflare Worker Secrets, not in GitHub:

Core runtime and encryption:

- `WECHAT_MCP_SECRET_KEY`
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`

WeChat production credentials and relay:

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_WEBHOOK_TOKEN`
- `WECHAT_ENCODING_AES_KEY`
- `WECHAT_PROXY_URL`
- `WECHAT_PROXY_TOKEN`

Email-first public login:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `TURNSTILE_SECRET_KEY`

Optional GitHub login provider:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Stripe billing:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PLUS_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_BILLING_SUCCESS_URL`
- `STRIPE_BILLING_CANCEL_URL`

Stripe Checkout is fail-closed: paid checkout creation is unavailable unless the secret key,
webhook secret, both paid price IDs, and default success/cancel URLs are all configured.
Email-code login is fail-closed when `RESEND_API_KEY` is missing. Turnstile verification is
enforced only when `TURNSTILE_SECRET_KEY` is configured, but public signup should not be opened
without both the backend secret and the frontend `VITE_TURNSTILE_SITE_KEY` build variable.
GitHub login remains unavailable until both GitHub OAuth secrets are configured and the callback
implementation is enabled.

Local generated values are stored in `.env.production.local`, which is ignored by Git.

## Smoke checks

```bash
curl -i https://woa.ziikoo.app/health
curl -i https://woa.ziikoo.app/mcp
curl -i https://woa.ziikoo.app/sse
curl -i https://woa.ziikoo.app/messages
```

Expected:

- `/health` returns `200` with `mcpEndpoint: "/mcp"`
- `/mcp` returns `401 Unauthorized` without OAuth
- `/sse` returns `404 Not Found`
- `/messages` returns `404 Not Found`

The workers.dev fallback may remain available for direct operational smoke checks, but client MCP configuration should prefer the custom domain above.
