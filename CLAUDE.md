# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WeChat Official Account MCP (Model Context Protocol) server exposing **15 MCP tools** for common WeChat Official Account operations (auth, media, drafts, publishing, users, tags, menus, template/customer-service/subscribe messages, statistics, auto-reply, mass-send). Consumed by Claude Desktop, Cursor, Trae AI over stdio/SSE, **and** by web/HTTP clients via a parallel REST API layer. **WeChat API contracts are sourced only from official WeChat developer docs; see `WECHAT_OFFICIAL_API_CONTRACT.md` for verified endpoints and known mismatches.**

**Tech Stack**: Node.js 18+, TypeScript 5.8 (ES Modules), MCP SDK v1, SQLite (sqlite3), Axios, Zod, Express + Multer + JWT, Vercel (`@vercel/node`), crypto-js (AES). A minimal React 18 + Vite + Tailwind frontend scaffold exists but is nearly empty.

## Essential Commands

```bash
# Build & checks
npm run build          # clean + tsc (dev tsconfig, strict:false)
npm run build:prod     # clean + tsc -p tsconfig.prod.json (stricter)
npm run build:full     # full pipeline: clean + check + prod build + verify (./scripts/build.sh)
npm run check          # tsc --noEmit (type errors only)
npm run lint           # eslint .

# Test (NOTE: there are NO unit tests; "test" = build then verify tool registration)
npm test               # = npm run build:prod && node test-tools.js
# test-tools.js asserts mcpTools.length === 15 — update it if you add/remove tools

# Run MCP server (stdio default; -m sse for SSE)
npm run dev -- mcp -a <app_id> -s <app_secret>            # tsx, no build
node dist/src/cli.js mcp -a <app_id> -s <app_secret>      # built
npx wechat-official-account-mcp mcp -a <id> -s <secret>   # published package

# REST API server (Express, port 3001) — separate from MCP transport
npx nodemon             # or: tsx api/server.ts — watches api/, hot reload
npx vite                # frontend dev server (5173), proxies /api → :3001

# Packaging
npm run pack:dry        # npm pack --dry-run (inspect published contents)
npm run pack:test       # ./scripts/pack-test.sh
```

**CLI flags**: `-a/--app-id` (required), `-s/--app-secret` (required), `-m/--mode` (`stdio` default | `sse`), `-p/--port` (SSE, default 3000).

## Architecture

There are **two entry surfaces over one shared core**:

```
                    ┌─────────────────────────────────────────┐
   AI clients ─────▶│ MCP path: cli.ts → transport (stdio/sse) │──▶ WechatMcpTool ──▶ 15 tools
                    └─────────────────────────────────────────┘                        │
                    ┌─────────────────────────────────────────┐                        ▼
   HTTP clients ───▶│ REST path: api/* → routes/wechat.ts      │──▶ WechatMcpTool ──▶ WechatApiClient ──▶ WeChat API
                    └─────────────────────────────────────────┘
```

Both paths reuse `AuthManager`, `WechatApiClient`, `WechatMcpTool`, and the same `mcpTools` registry — the REST layer is a thin HTTP wrapper that calls `wechatTool.callTool(name, args)`.

**MCP entry points** (`src/`):
- `cli.ts` — Commander.js CLI → `McpServerOptions` → `initMcpServerWithTransport(mode)`
- `mcp-server/shared/init.ts` — `initWechatMcpServer()` wires `McpServer` + `AuthManager` + `WechatMcpTool`
- `mcp-server/transport/stdio.ts` / `sse.ts` — stdio (Claude Desktop default) and Express-based SSE

**REST entry points** (`api/`):
- `api/index.ts` — Vercel Serverless entry (`@vercel/node` runtime)
- `api/server.ts` — local dev server on port 3001
- `api/app.ts` — Express app (CORS, JSON, error/404 handlers); mounts `/api/auth` and `/api/wechat`
- `api/routes/wechat.ts` — **exposes all 15 MCP tools as REST**: `GET /api/wechat/tools`, `POST /api/wechat/tools/:toolName`, `POST|GET /api/wechat/config`, `GET /api/wechat/health`. Lazily initializes a singleton `AuthManager`/`WechatMcpTool` (with promise lock); config comes from env (`WECHAT_APP_ID`/`WECHAT_APP_SECRET`) or the `/config` endpoint.

**Core services** (`src/`):
- `auth/auth-manager.ts` — credentials + Access Token lifecycle. **Auto-refreshes 5 min before expiry** (`REFRESH_BEFORE_EXPIRY = 5 * 60 * 1000`), guarded by a `refreshPromise` lock to dedupe concurrent refreshes. (CLAUDE.md previously said "1 minute" — that was wrong.)
- `wechat/api-client.ts` — Axios instance; **request interceptor auto-injects `access_token`** (never add it manually to URLs), **response interceptor logs only errcode/errmsg** (no response bodies). ~46 public methods wrapping WeChat API.
- `mcp-tool/index.ts` — `WechatMcpTool`: registers tools and wraps every handler in uniform try/catch error handling.
- `mcp-tool/tools/index.ts` — exports `mcpTools` (the 15 registered tools) and `wechatTools` (a smaller internal set).
- `storage/storage-manager.ts` — SQLite CRUD with optional AES-256 field encryption.
- `utils/validation.ts` — Zod schemas, `sanitizeHtmlContent()`, `ALLOWED_MEDIA_TYPES` whitelist.
- `utils/logger.ts` — masks sensitive fields (`appSecret`, `access_token`, `token`, …) by truncation.
- `utils/db-init.ts` — schema bootstrap.

### Startup flow

1. CLI/REST args → `McpServerOptions` (or REST singleton init)
2. `AuthManager.initialize()` → loads/encrypts credentials from SQLite
3. `WechatMcpTool.initialize()` → `registerTools(mcpServer)` registers all 15 tools
4. On call: `handler(params, apiClient)` → validates with Zod → calls `apiClient.*` → returns `WechatToolResult`

## The 15 MCP Tools

Registered in `src/mcp-tool/tools/index.ts` (one file each):

| Category | Tools |
|---|---|
| Base | `wechat_auth`, `wechat_draft`, `wechat_publish`, `wechat_permanent_media`, `wechat_media_upload`, `wechat_upload_img` |
| Users | `wechat_user` |
| Tags | `wechat_tag` |
| Menu | `wechat_menu` |
| Messaging | `wechat_template_msg`, `wechat_customer_service`, `wechat_subscribe_msg` |
| Analytics | `wechat_statistics` |
| Advanced | `wechat_auto_reply`, `wechat_mass_send` |

## Adding a Tool

1. Create `src/mcp-tool/tools/<name>-tool.ts` exporting a `McpTool` (Zod `inputSchema` as `ZodRawShape` + `handler(params, apiClient)`). Reuse schemas from `utils/validation.ts`.
2. Add it to the `mcpTools` array in `tools/index.ts`.
3. Bump the expected count in `test-tools.js` (currently hardcoded `=== 15`).
4. If it needs a new WeChat API endpoint, add a method to `WechatApiClient` — the token interceptor handles auth automatically.

Tool result shape (errors are auto-wrapped by `registerTools`):
```typescript
return { content: [{ type: 'text', text: '...' }] };        // success
return { content: [...], isError: true };                    // explicit error
```

## Critical Implementation Rules

- **Official WeChat docs are the only source of truth for API contracts.** Before adding/changing endpoints, request fields, signature logic, or webhook handling, check `WECHAT_OFFICIAL_API_CONTRACT.md` and re-open the linked official WeChat docs. Do not trust historical README claims or existing code if they conflict with official docs.
- **Known contract mismatches to resolve before production/Workers migration:** `wechat_subscribe_msg` currently calls `/cgi-bin/message/subscribe/send` and uses `templateId`, but verified official contracts are `/cgi-bin/message/subscribe/bizsend` (service-account subscription notifications) or `/cgi-bin/message/template/subscribe` (one-time subscription), with `template_id`; `wechat_permanent_media` has an unreachable/ambiguous `news` branch; `wechat_customer_service.get_records` lacks a verified endpoint implementation.
- **ES Modules + `.js` import extensions are mandatory.** `"type": "module"` is set; import `./foo.js` even for `foo.ts`. TypeScript will not rewrite these.
- **Do NOT use the `@/*` path alias in `src/` backend code.** It maps to `./src/*` in tsconfig/vite, but `tsc`-compiled Node code doesn't resolve it. Backend uses relative paths only; the alias is for the Vite frontend.
- **Never manually add `access_token` to WeChat URLs** — the Axios request interceptor does it. Just call `apiClient.<method>()`.
- **Two tsconfigs**: `tsconfig.json` (dev, `strict:false`) vs `tsconfig.prod.json` (stricter, excludes test/config files). `npm test` and publish run the prod build.
- **`npm test` is NOT a unit test runner** — it builds then runs `test-tools.js`, which only checks that 15 tools registered. There are zero `.test.ts`/`.spec.ts` files. Run `npm run check` + `npm run build:prod` before committing.
- WeChat API errors carry `errcode`/`errmsg`; full response bodies are never logged (data-leak prevention in the response interceptor).
- SQLite DB at `./data/wechat-mcp.db` (auto-created; `data/` is gitignored). Tables: `config`, `access_tokens`, `media`, `permanent_media`, `drafts`, `publishes`.

## Security

- **`WECHAT_MCP_SECRET_KEY`** → enables AES-256 encryption of `app_secret`/`token`/`encoding_aes_key`/`access_token`; encrypted values stored with `enc:` prefix. Strongly recommended in production.
- **`CORS_ORIGIN`** → comma-separated allowlist for SSE/REST. **Never `*` in production.**
- Input validated by Zod at every tool boundary; HTML sanitized via `sanitizeHtmlContent()`.
- Media uploads validated against `ALLOWED_MEDIA_TYPES` + size limits.

## Environment Variables

| Var | Purpose |
|---|---|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | Credentials (REST path auto-loads these; MCP path uses CLI flags) |
| `WECHAT_MCP_SECRET_KEY` | AES-256 key for sensitive-field encryption (optional, recommended) |
| `CORS_ORIGIN` | Comma-separated allowlist (never `*` in prod) |
| `DB_PATH` | SQLite path (default `./data/wechat-mcp.db`) |
| `NODE_ENV` / `DEBUG` | Runtime mode / verbose logging (off in prod) |

## Deployment

- **npm package** (primary): `npx wechat-official-account-mcp mcp -a <id> -s <secret>` (`bin: wechat-mcp`).
- **Vercel**: `api/index.ts` is the serverless entry; `vercel.json` rewrites `/api/* → /api/index` and everything else → `/index.html` (SPA fallback).
- **Local SSE/REST**: `tsx api/server.ts` (Express on 3001); Vite dev (5173) proxies `/api`.

## Related Docs

- `WECHAT_OFFICIAL_API_CONTRACT.md` — verified official WeChat API contracts, source URLs, current project coverage, and known mismatches
- `README.md` — full Chinese user guide (install, config, AI-client integration)
- `AGENTS.md` — Chinese agent/team guide (broader, includes full tree and naming conventions)
- `FEATURES_OVERVIEW.md` — v2.0.0 feature comparison
- `CHANGELOG.md` — version history (v1.0.3 → v1.1.0 → v2.0.0)
