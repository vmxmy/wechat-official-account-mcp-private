# Production deployment

This repository deploys the HTTP-only WeChat Official Account MCP Worker to Cloudflare Workers.

## Production resources

- Worker: `wechat-official-account-mcp`
- URL: `https://woa.ziikoo.app`
- MCP endpoint: `/mcp`
- Webhook endpoint: `/wx/callback`
- D1 database: `wechat-official-account-mcp-prod`
- KV namespace binding: `OAUTH_KV`
- R2 bucket: `wechat-official-account-mcp-media`

The Worker intentionally does not expose MCP-over-SSE. `/sse` should return `404`.

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

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_MCP_SECRET_KEY`
- `WECHAT_WEBHOOK_TOKEN`
- `WECHAT_ENCODING_AES_KEY`
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`
- Optional: `WECHAT_PROXY_URL`
- Optional: `WECHAT_PROXY_TOKEN`

Local generated values are stored in `.env.production.local`, which is ignored by Git.

## Smoke checks

```bash
curl -i https://woa.ziikoo.app/health
curl -i https://woa.ziikoo.app/mcp
curl -i https://woa.ziikoo.app/sse
```

Expected:

- `/health` returns `200` with `mcpEndpoint: "/mcp"`
- `/mcp` returns `401 Unauthorized` without OAuth
- `/sse` returns `404 Not Found`

The workers.dev fallback may remain available for direct operational smoke checks, but client MCP configuration should prefer the custom domain above.
