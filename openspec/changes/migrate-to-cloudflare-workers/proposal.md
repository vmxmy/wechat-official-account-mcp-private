## Why

The project is cutting over to a single production MCP runtime: Cloudflare Workers Streamable HTTP `/mcp`. The old Node/local surfaces created operational and security drag: SSE long-connections hit Workers/edge idle timeouts, per-process token refresh collides with WeChat `45009`, native sqlite3/axios/form-data/filePath code cannot run in Workers, and the old REST tool surface was unauthenticated. The final design uses Agents SDK `McpAgent` + Durable Objects + D1/R2 + OAuth and removes local desktop stdio/CLI, MCP-over-SSE, Node/Axios executor, SQLite storage, and local filePath media upload code.

## What Changes

- **ADD** Cloudflare Workers deployment target exposing all existing MCP tools plus a new `wechat_inbox` tool over standard MCP **Streamable HTTP** at `/mcp` via `McpAgent.serve()`. MCP-over-SSE and local stdio are removed; clients use native Streamable HTTP or an external `mcp-remote` bridge.
- **ADD** A shared Durable Object singleton (or D1-backed token row) as the sole WeChat Access Token owner, replacing the per-process in-memory `refreshPromise` lock. Global refresh dedup + proactive pre-expiry refresh via DO `schedule()`/alarm.
- **ADD** An `HttpExecutor` abstraction over outbound HTTP so `WechatApiClient` runs on Workers fetch/Web FormData/Uint8Array without Node/Axios dependencies. The API methods and tool handlers stay shared.
- **ADD** D1 migration of the business tables (`config`, `access_tokens`, `media`, `permanent_media`, `drafts`, `publishes`, plus `inbound_messages`); `StorageManager` is D1-backed in the HTTP-only runtime.
- **ADD** R2-backed/media URL pipeline: upload via `fileUrl`, R2 key, or `fileData`, replacing `fs.readFile(filePath)`. `filePath` is rejected because the local runtime has been removed.
- **ADD** OAuth 2.0 authorization on the `/mcp` endpoint via `@cloudflare/workers-oauth-provider`, replacing the unauthenticated REST route. **BREAKING** for REST consumers: the raw `POST /api/wechat/tools/:toolName` endpoint is replaced by authenticated MCP `tools/call` over `/mcp`.
- **REMOVE** the npm stdio package / local desktop CLI path (`npx wechat-official-account-mcp mcp ...`). Tool handlers and Zod schemas remain shared inside the HTTP-only Workers runtime.
- **ADD** a WeChat webhook receiver on the Worker (`/wx/callback`: signature verify + message/event ingestion into a D1 `inbound_messages` table) — a capability the current product entirely lacks and a prerequisite for production. The handler is write-only; querying/processing inbound messages is exposed to **external** AI agents via the new `wechat_inbox` MCP tool (`list_pending` / `list_all` / `get` / `mark_processed`). No server-side cron or Agent loop.

## Capabilities

### New Capabilities
- `remote-mcp-server`: Serve all 16 MCP tools over standard MCP Streamable HTTP on Cloudflare Workers via `McpAgent`, with hibernation, stream resumability, and session state.
- `token-lifecycle`: Globally-unique, durable WeChat Access Token management with refresh deduplication and proactive pre-expiry refresh, replacing the in-process `refreshPromise` lock.
- `http-executor`: HTTP client abstraction allowing `WechatApiClient` methods to run on Workers fetch/Web FormData without Node dependencies.
- `d1-storage`: Durable, shared storage of config/tokens/media/drafts/publishes/inbound messages via Cloudflare D1.
- `media-pipeline`: HTTP-only media upload via `fileUrl` (HTTP fetch), R2, or `fileData`, removing the Node-only `fs.readFile` dependency.
- `mcp-auth`: OAuth 2.0 protection of the remote MCP endpoint and removal of the unauthenticated REST tool-call surface.
- `wechat-webhook`: Inbound WeChat message/event receiver with signature verification; persists verified messages to a D1 `inbound_messages` table and exposes them to external AI agents via the `wechat_inbox` MCP query tool. The webhook handler is write-only; the Worker runs no cron/scheduler.

### Modified Capabilities
<!-- None: openspec/specs/ is empty today; there are no existing specs to amend. -->

## Impact

- **Code**: `api-client.ts` — require explicit Workers HTTP executor; `storage/types.ts` + `d1-storage-manager.ts` provide D1 storage; token logic lives in `TokenOwner` DO/D1; MCP-over-SSE and local stdio/CLI are removed and superseded by `McpAgent.serve("/mcp")`; old REST tool execution is replaced by OAuth MCP `/mcp`; Node Buffer/fs media branches are removed in favor of Worker-safe wrappers.
- **Dependencies**: keep `agents`, `@cloudflare/workers-oauth-provider`; remove `axios`/`sqlite3`/Node `form-data` runtime dependencies; use `wrangler.jsonc`, D1 + R2 + DO bindings.
- **APIs**: `POST /api/wechat/tools/:toolName` removed (BREAKING); new standard MCP `tools/call` at `/mcp`; new `/wx/callback` webhook.
- **Systems**: Cloudflare Workers + D1 + R2 + Durable Objects + Secrets Store; WeChat token refresh goes from N-replicas to 1 singleton.
- **Security**: closes the open REST tool-call hole; adds OAuth, signature verification, and Workers-native rate limiting.
- **Risk surface**: `api-client.ts` rewrite is large and mechanical; Streamable-HTTP client compatibility (Cursor/Claude Code remote MCP) must be verified; DO session-state-reset caveat means token/credentials must live in shared storage, not `setState`.
