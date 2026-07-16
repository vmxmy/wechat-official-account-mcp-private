# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WeChat Official Account MCP (Model Context Protocol) server exposing **27 MCP tools** (23 WeChat operations and 4 multi-tenant management tools), a hosted React Web entrypoint, and the remote-only `@ziikoo/woa` CLI. The runtime is HTTP-only: Cloudflare Workers Remote MCP (`/mcp`) with OAuth, D1/R2/Durable Objects, and account-addressable `/wx/callback/{accountId}` webhook ingestion. Local desktop stdio MCP and MCP-over-SSE have been removed. **WeChat API contracts are sourced only from official WeChat developer docs; see `WECHAT_OFFICIAL_API_CONTRACT.md` for verified endpoints and known mismatches.**

**Tech Stack**: TypeScript 5.8 (ES Modules), MCP SDK 1.29, Zod 4, Cloudflare Workers + Agents SDK `McpAgent` + Workers OAuth Provider + D1/R2/Durable Objects, React 19 + TanStack Router/Query + Astryx, crypto-js (AES). Node is used for build/test tooling, the remote-only CLI, and non-runtime fixtures.

## Essential Commands

```bash
# Build & checks
npm run build          # clean + tsc (dev tsconfig, strict:false)
npm run build:prod     # clean + tsc -p tsconfig.prod.json (stricter)
npm run build:full     # full pipeline: clean + check + prod build + verify (./scripts/build.sh)
npm run check          # tsc --noEmit (type errors only)
npm run lint           # eslint .

# Test (NOTE: fixture/regression harness, not a full unit-test suite)
npm test               # = npm run build:prod && node test-tools.js && node scripts/web-render-smoke.mjs
# test-tools.js asserts mcpTools.length === 27 plus Worker/OAuth/CLI/quota/billing/webhook fixtures

# Cloudflare Workers Remote MCP
npm run worker:dev
npx wrangler deploy --dry-run
npm run worker:deploy
npm run d1:migrate:local

# Packaging
npm run pack:dry        # npm pack --dry-run (inspect published contents)
```

**No local MCP transport:** configure clients against the Workers `/mcp` Streamable HTTP endpoint. The `woa` CLI is remote-only and never starts a local MCP server.

## Architecture

There are **two HTTP entry surfaces over one shared core/runtime seam**:

```
Remote clients  ─▶ Worker /mcp (OAuth + McpAgent) ─▶ shared tools + Worker media wrappers ─▶ fetch/D1/R2/DO
WeChat server   ─▶ Worker /wx/callback/{accountId} ─▶ signature/decrypt ─▶ D1 inbound_messages ─▶ wechat_inbox
```

The Workers path uses `WorkersAuthManager`, `TokenOwner` Durable Object, `D1StorageManager`, `WorkersHttpExecutor`, and Worker-only media wrappers while reusing shared tool handlers where possible. The old local stdio/SSE transports and unauthenticated REST tool execution surface are not part of the runtime; `/api/wechat/tools/*` returns a migration message and never executes a tool.

**Workers entry points** (`src/worker/`):
- `index.ts` — `WechatMcpAgent` (`/mcp`), account-scoped `TokenOwner` DO, OAuth provider wiring, management REST routes, hosted Web assets, and `/wx/callback/{accountId}`
- `media-tools.ts` — Worker-safe WeChat upload wrappers; MCP schema exposes only `fileUrl` and `r2Key` (`fileData` remains handler-level compatibility only)
- `media-upload.ts` — OAuth-protected raw binary staging into tenant/account-scoped R2 keys for `woa media upload <path>`
- `wechat-webhook.ts` — WeChat SHA1 signature verification, AES-CBC-256 decrypt, appid validation, D1 persistence input
- `inbox-store.ts` — D1 queries for `inbound_messages`

**Local Express scaffold** (`api/`):
- `api/index.ts` — Vercel Serverless entry (`@vercel/node` runtime)
- `api/server.ts` — local dev server on port 3001
- `api/app.ts` — Express app (CORS, JSON, `/api/auth`, `/api/health`, generic 404); no unauthenticated tool execution route in the current tree

**Core services** (`src/`):
- `wechat/api-client.ts` — shared WeChat API business methods behind an explicit `HttpExecutor`; HTTP-only runtime passes `WorkersHttpExecutor` wrapped by `AccessTokenHttpExecutor`. Do not instantiate it without an executor.
- `wechat/http-executor.ts`, `workers-http-executor.ts`, `proxy.ts` — fetch/Web FormData HTTP seam plus optional HTTPS relay proxy support. Node/Axios executor has been removed.
- `mcp-tool/tools/index.ts` — exports `mcpTools` (27 registered tools) and `wechatTools` (small legacy JSON-schema subset used by fixtures); media tools are Worker-safe wrappers.
- `cli/woa.ts` — remote-only OAuth/REST CLI and native Streamable HTTP MCP configuration generator; it stores no WeChat credentials locally.
- `mcp-tool/tools/inbox-tool.ts` + `mcp-tool/inbox-store.ts` — inbound message query/update tool interface.
- `storage/types.ts`, `storage/d1-storage-manager.ts` — D1 implementation with `enc:` AES encryption convention. Local SQLite storage has been removed.
- `utils/validation.ts` — Zod schemas, `sanitizeHtmlContent()`, `ALLOWED_MEDIA_TYPES` whitelist.
- `utils/logger.ts` — masks sensitive fields (`appSecret`, `access_token`, `token`, …) by truncation.

### Startup flow

1. Worker secrets/bindings provide WeChat credentials, D1/R2/DO namespaces, OAuth credentials, and optional relay proxy settings.
2. `WechatMcpAgent.init()` creates `D1StorageManager`, `D1InboxStore`, `WorkersAuthManager`, `TokenOwner`, and `WechatApiClient`.
3. `createWorkerMediaTools()` adds HTTP-safe media tools whose MCP schema exposes `fileUrl`/`r2Key`; local files are staged through the authenticated REST upload endpoint and `woa media upload <path>`.
4. `registerWorkerMcpTool()` registers all 27 tools on `McpServer`; calls resolve trusted tenant/account context, validate with Zod, enforce quota, call the shared handlers, and return `WechatToolResult`.
5. `/wx/callback/{accountId}` resolves account credentials, verifies/decrypts WeChat messages, writes tenant/account-scoped D1 inbox rows, and acks quickly; the old `/wx/callback` is limited to safe single-account compatibility.

## The 27 MCP Tools

Registered in `src/mcp-tool/tools/index.ts` (one file each):

| Category | Tools |
|---|---|
| Base | `wechat_auth`, `wechat_draft`, `wechat_publish`, `wechat_content_publish`, `wechat_permanent_media`, `wechat_media_upload`, `wechat_upload_img` |
| Users | `wechat_user` |
| Tags | `wechat_tag` |
| Menu | `wechat_menu` |
| Messaging | `wechat_template_msg`, `wechat_customer_service`, `wechat_subscribe_msg` |
| Analytics | `wechat_statistics` |
| Advanced | `wechat_auto_reply`, `wechat_mass_send`, `wechat_inbox`, `wechat_qrcode`, `wechat_short_url`, `wechat_comment`, `wechat_blacklist`, `wechat_kf_account`, `wechat_account` |
| Management | `woa_context`, `woa_tenant`, `woa_account`, `woa_audit` |

## Adding a Tool

1. Create `src/mcp-tool/tools/<name>-tool.ts` exporting a `McpTool` (Zod `inputSchema` as `ZodRawShape` + `handler(params, apiClient)`). Reuse schemas from `utils/validation.ts`.
2. Add it to the `mcpTools` array in `tools/index.ts`.
3. Bump the expected count in `test-tools.js` (currently hardcoded `=== 27`).
4. If it needs a new WeChat API endpoint, add a method to `WechatApiClient` — the token interceptor handles auth automatically.

Tool result shape (errors are auto-wrapped by `registerTools`):
```typescript
return { content: [{ type: 'text', text: '...' }] };        // success
return { content: [...], isError: true };                    // explicit error
```

## Critical Implementation Rules

- **Official WeChat docs are the only source of truth for API contracts.** Before adding/changing endpoints, request fields, signature logic, or webhook handling, check `WECHAT_OFFICIAL_API_CONTRACT.md` and re-open the linked official WeChat docs. Do not trust historical README claims or existing code if they conflict with official docs.
- **Known follow-up API gaps are documented, not guessed:** `tags/getidlist`, template set/add, mass get/speed/uploadnews and similar missing official APIs are recorded in `WECHAT_OFFICIAL_API_CONTRACT.md`; do not add them without fresh official-doc verification.
- **ES Modules + `.js` import extensions are mandatory.** `"type": "module"` is set; import `./foo.js` even for `foo.ts`. TypeScript will not rewrite these.
- **Do NOT use the `@/*` path alias in `src/` backend code.** It maps to `./src/*` in tsconfig/vite, but `tsc`-compiled Node code doesn't resolve it. Backend uses relative paths only; the alias is for the Vite frontend.
- **Never manually add `access_token` to WeChat URLs** — the shared `HttpExecutor` wrapper injects it. Just call `apiClient.<method>()`.
- **Two tsconfigs**: `tsconfig.json` (dev, `strict:false`) vs `tsconfig.prod.json` (stricter, excludes test/config files). `npm test` and publish run the prod build.
- **`npm test` is a build + fixture/SSR harness** — it builds, runs `test-tools.js` for 27 tools and Worker/OAuth/CLI/quota/billing/webhook fixtures, then runs the critical Web route SSR smoke. There are still no `.test.ts`/`.spec.ts` files. Run `npm run check` + `npm run lint` + `npm test` before committing.
- WeChat API errors carry `errcode`/`errmsg`; full response bodies are never logged (data-leak prevention in the response interceptor).
- D1 stores business tables and `inbound_messages`; R2 stores remote media inputs where applicable.

## Security

- **`WECHAT_MCP_SECRET_KEY`** → enables AES-256 encryption of `app_secret`/`token`/`encoding_aes_key`/`access_token`; encrypted values stored with `enc:` prefix. Strongly recommended in production.
- **`CORS_ORIGIN`** → comma-separated allowlist for the local REST/API scaffold. **Never `*` in production.**
- **Outbound proxy** → `WECHAT_PROXY_URL` enables an HTTPS relay proxy for all `api.weixin.qq.com` token/API/upload calls; optional `WECHAT_PROXY_TOKEN` is sent as `x-wechat-proxy-token`. Workers require the HTTPS relay pattern because native HTTP CONNECT proxying is unavailable.
- **Relay proxy operations** → the relay must validate `x-wechat-proxy-token` when configured, allow only `https://api.weixin.qq.com/*` targets, and disable or redact access logs for `x-wechat-proxy-target-url` / `x-wechat-proxy-token` headers because the target URL may contain `access_token` or AppSecret.
- **Workers secrets** → `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `WECHAT_MCP_SECRET_KEY`, `WECHAT_WEBHOOK_TOKEN`, `WECHAT_ENCODING_AES_KEY`, optional `WECHAT_PROXY_URL` / `WECHAT_PROXY_TOKEN`, `OAUTH_CLIENT_ID`, and `OAUTH_CLIENT_SECRET` must come from Cloudflare Secrets Store / Worker secrets, not plaintext `wrangler.jsonc`.
- **Remote MCP** → `/mcp` is OAuth-protected; `/api/wechat/tools/*` is removed from Workers and must not execute tools.
- Input validated by Zod at every tool boundary; HTML sanitized via `sanitizeHtmlContent()`.
- Media uploads validated against `ALLOWED_MEDIA_TYPES` + size limits.

## Environment Variables

| Var | Purpose |
|---|---|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | Credentials from Workers secret bindings |
| `WECHAT_MCP_SECRET_KEY` | AES-256 key for sensitive-field encryption (optional, recommended) |
| `WECHAT_PROXY_URL` / `WECHAT_PROXY_TOKEN` | Optional HTTPS relay proxy for WeChat API egress / IP whitelist |
| `CORS_ORIGIN` | Comma-separated allowlist (never `*` in prod) |
| `NODE_ENV` / `DEBUG` | Runtime mode / verbose logging (off in prod) |

Workers bindings are configured in `wrangler.jsonc` as Secrets Store references. Replace placeholder store IDs locally/operationally; never commit real secret values.

## Deployment

- **Cloudflare Workers Remote MCP**: deploy `src/worker/index.ts`; expose OAuth-protected `/mcp`, `/wx/callback/{accountId}`, management REST, hosted Web assets, D1/R2/DO bindings, and no `/sse` stream. Remote clients should use native Streamable HTTP MCP or the remote-only `woa` CLI.
- **Vercel**: `api/index.ts` is the serverless entry; `vercel.json` rewrites `/api/* → /api/index` and everything else → `/index.html` (SPA fallback).
- **Local API scaffold**: `tsx api/server.ts` (Express on 3001); Vite dev (5173) proxies `/api`. It is not an MCP transport.

## Related Docs

- `WECHAT_OFFICIAL_API_CONTRACT.md` — verified official WeChat API contracts, source URLs, current project coverage, and known mismatches
- `README.md` — full Chinese user guide (install, config, AI-client integration)
- `AGENTS.md` — Chinese agent/team guide (broader, includes full tree and naming conventions)
- `FEATURES_OVERVIEW.md` — feature comparison
- `CHANGELOG.md` — version history
