## Why

The project currently runs only as a long-lived Node process (Express + native `sqlite3`) or an npm stdio package, which blocks production-grade remote delivery: SSE long-connections hit Workers/edge idle timeouts, each Node replica refreshes its own WeChat Access Token and collides with WeChat's `45009` rate limit, and the REST surface (`api/routes/wechat.ts`) exposes `POST /api/wechat/tools/:toolName` with **no auth or rate limiting**. Migrating the remote surface onto the Cloudflare official Agents SDK `McpAgent` + Durable Object pattern delivers a standards-compliant Streamable HTTP MCP server (protocol-level zero lock-in), a globally-unique token singleton, hibernation-based cost model, and native OAuth/security primitives — while the local stdio npm package stays unchanged.

## What Changes

- **ADD** Cloudflare Workers deployment target exposing all existing MCP tools plus a new `wechat_inbox` tool over standard MCP **Streamable HTTP** at `/mcp` via `McpAgent.serve()`. SSE transport is deprecated upstream and will not be ported (stdio clients unaffected).
- **ADD** A shared Durable Object singleton (or D1-backed token row) as the sole WeChat Access Token owner, replacing the per-process in-memory `refreshPromise` lock. Global refresh dedup + proactive pre-expiry refresh via DO `schedule()`/alarm.
- **ADD** An `HttpExecutor` abstraction over the HTTP client so `WechatApiClient` runs on both Node (`axios` + Node `form-data`) and Workers (Web `fetch` + Web `FormData` + `Uint8Array`). The 46 API methods and tool handlers stay shared.
- **ADD** D1 migration of the six existing SQLite tables (`config`, `access_tokens`, `media`, `permanent_media`, `drafts`, `publishes`); `StorageManager` gains a D1-backed implementation. The Node `sqlite3` path remains for stdio/local mode.
- **ADD** R2-backed media pipeline: upload via `fileUrl` (Worker `fetch` → WeChat) or R2 key, replacing `fs.readFile(filePath)` which is impossible on Workers. The `filePath` branch stays Node-only.
- **ADD** OAuth 2.0 authorization on the `/mcp` endpoint via `@cloudflare/workers-oauth-provider`, replacing the unauthenticated REST route. **BREAKING** for REST consumers: the raw `POST /api/wechat/tools/:toolName` endpoint is replaced by authenticated MCP `tools/call` over `/mcp`.
- **KEEP** the npm stdio package (`npx wechat-official-account-mcp mcp ...`) unchanged for Claude Desktop / Cursor local usage. Tool handlers and Zod schemas are shared between both runtimes.
- **ADD** a WeChat webhook receiver on the Worker (`/wx/callback`: signature verify + message/event ingestion into a D1 `inbound_messages` table) — a capability the current product entirely lacks and a prerequisite for production. The handler is write-only; querying/processing inbound messages is exposed to **external** AI agents via the new `wechat_inbox` MCP tool (`list_pending` / `list_all` / `get` / `mark_processed`). No server-side cron or Agent loop.

## Capabilities

### New Capabilities
- `remote-mcp-server`: Serve the 15 MCP tools over standard MCP Streamable HTTP on Cloudflare Workers via `McpAgent`, with hibernation, stream resumability, and session state.
- `token-lifecycle`: Globally-unique, durable WeChat Access Token management with refresh deduplication and proactive pre-expiry refresh, replacing the in-process `refreshPromise` lock.
- `http-executor`: Runtime-agnostic HTTP client abstraction allowing `WechatApiClient` and its 46 methods to run on both Node and Workers (fetch/Web FormData) without duplication.
- `d1-storage`: Durable, shared storage of config/tokens/media/drafts/publishes via Cloudflare D1, sharing schema with the existing SQLite implementation.
- `media-pipeline`: Runtime-agnostic media upload via `fileUrl` (HTTP fetch) and R2, removing the Node-only `fs.readFile` dependency for Workers.
- `mcp-auth`: OAuth 2.0 protection of the remote MCP endpoint and removal of the unauthenticated REST tool-call surface.
- `wechat-webhook`: Inbound WeChat message/event receiver with signature verification; persists verified messages to a D1 `inbound_messages` table and exposes them to external AI agents via the `wechat_inbox` MCP query tool. The webhook handler is write-only; the Worker runs no cron/scheduler.

### Modified Capabilities
<!-- None: openspec/specs/ is empty today; there are no existing specs to amend. -->

## Impact

- **Code**: `api-client.ts` (1238 lines, 46 methods) — extract `HttpExecutor`, swap transport; `storage-manager.ts` — add D1 impl behind existing interface; `auth-manager.ts` — token logic moves behind DO/D1; `transport/sse.ts` — superseded by `McpAgent.serve()`; `api/routes/wechat.ts` — replaced by MCP `/mcp` (REST routes deprecated/removed). Tool handlers in `src/mcp-tool/tools/*` stay shared but their `Buffer`/`fs` branches need Workers fallbacks.
- **Dependencies**: add `agents`, `@cloudflare/workers-oauth-provider`; `axios`/`sqlite3`/Node `form-data` remain for stdio/Node mode only; new `wrangler.jsonc`, D1 + R2 + DO bindings.
- **APIs**: `POST /api/wechat/tools/:toolName` removed (BREAKING); new standard MCP `tools/call` at `/mcp`; new `/wx/callback` webhook.
- **Systems**: Cloudflare Workers + D1 + R2 + Durable Objects + Secrets Store; WeChat token refresh goes from N-replicas to 1 singleton.
- **Security**: closes the open REST tool-call hole; adds OAuth, signature verification, and Workers-native rate limiting.
- **Risk surface**: `api-client.ts` rewrite is large and mechanical; Streamable-HTTP client compatibility (Cursor/Claude Code remote MCP) must be verified; DO session-state-reset caveat means token/credentials must live in shared storage, not `setState`.
