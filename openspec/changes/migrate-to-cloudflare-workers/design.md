## Context

Today the project ships as two surfaces over one core: an npm **stdio** MCP package (Claude Desktop / Cursor local) and an **Express REST + SSE** server (`api/`). Both share `AuthManager`, `WechatApiClient` (46 methods, 1238 lines), `WechatMcpTool`, and the 15 tool handlers backed by `sqlite3` (native) on local disk.

The remote surface cannot reach production cleanly: SSE long-connections break on edge/Workers idle timeouts; native `sqlite3`, `axios`, Node `form-data`, `fs.readFile`, and `Buffer` are all unavailable in the V8 isolate; the in-process `refreshPromise` token lock is per-replica so multi-instance deployments hammer WeChat's token endpoint (`45009`); and `POST /api/wechat/tools/:toolName` is fully unauthenticated.

Stakeholders: AI-client end users (stdio path must not regress), REST/web consumers (need migration notice), and operators (cost, rate limits, security).

## Goals / Non-Goals

**Goals:**
- Deliver a standards-compliant MCP **Streamable HTTP** server on Workers (`McpAgent.serve("/mcp")`) covering all 15 tools, with hibernation and stream resumability.
- Make the token refresh globally unique and durable via a Durable Object.
- Keep `WechatApiClient` logic single-sourced across Node and Workers behind an `HttpExecutor`.
- Migrate the six SQLite tables to D1 (schema-preserving); keep Node `sqlite3` for stdio.
- Replace filesystem media upload with `fileUrl` + R2 on Workers; keep `filePath` Node-only.
- Close the auth hole with OAuth 2.0 and remove the raw REST tool-call route.
- Add the missing WeChat inbound webhook (`/wx/callback`).

**Non-Goals:**
- Multi-tenant SaaS sharding (single tenant for now; `config` stays effectively one logical record).
- Rewriting the React/Vite frontend (out of scope; stays as-is).
- Porting the deprecated SSE transport to Workers.
- Changing tool semantics, Zod schemas, or the `WechatToolResult` shape.
- Replacing `crypto-js` AES (kept for column-level encryption on D1).

## Decisions

### D1: McpAgent + Durable Object, not raw `createMcpHandler`
**Choice**: Use the `McpAgent` class (`agents/mcp`) over stateless `createMcpHandler`.
**Rationale**: We need session state, hibernation, stream resumability, and `elicitInput` (human-in-the-loop confirmations before publish/mass-send). `createMcpHandler` only gives a stateless streamable endpoint. `McpAgent` is a DO subclass, so we also get `schedule()`/alarm and `sql` for free.
**Alternatives**: hand-rolled Express SSE on Workers (breaks on idle watchdog; non-standard); stateless handler only (loses session + elicitation).

### D2: Separate singleton DO owns the token, McpAgent instances own sessions
**Choice**: Two DO classes — `WechatMcpAgent` (one instance per MCP session, hibernatable) and a single-instance `TokenOwner` DO (obtained via `getAgentByName(env.TOKEN_OWNER, "global")`) that owns refresh.
**Rationale**: The official docs warn that `McpAgent` session state resets on reconnect. Putting the token in session state would force a refresh every new session. A dedicated named-singleton DO is the canonical pattern for a globally-unique mutable resource, and gives us proactive pre-expiry refresh via `schedule()`.
**Alternatives**: D1 row + optimistic locking for the token (works, but no single-writer guarantee without a DO; still need DO for alarm-based proactive refresh); per-session refresh (rejected — collides with `45009`).

### D3: `HttpExecutor` interface, two implementations
**Choice**: Extract a minimal `HttpExecutor` interface (`get/post/postForm`) used by `WechatApiClient`; provide `NodeHttpExecutor` (axios) and `WorkersHttpExecutor` (fetch + Web FormData). Token injection and safe-error-logging move into a shared wrapper.
**Rationale**: 1238 lines / 46 methods must not be forked per runtime. The transport seam is small and mechanical.
**Alternatives**: full rewrite to fetch everywhere (drops axios in Node for no benefit, larger blast radius); generate two clients from a spec (overkill).

### D4: D1, not DO SQLite, for business data
**Choice**: D1 for `config` / `media` / `permanent_media` / `drafts` / `publishes`; DO `sql` only for token + session bookkeeping.
**Rationale**: Business data needs cross-instance querying (lists, counts, joins) — D1 is the right tool. DO SQLite is per-instance and not queryable from outside.
**Alternatives**: put everything in one DO (locks all reads/writes to one instance; bottleneck).

### D5: R2 for media, `fileUrl` as the Workers upload primitive
**Choice**: On Workers, tool upload params accept `fileUrl` (fetched server-side) or an R2 key; `filePath` is Node-only. R2 → WeChat stays on-network.
**Rationale**: No filesystem on Workers; R2 egress to WeChat is free; `fileUrl` is the simplest model for AI clients.
**Alternatives**: base64 in body (already supported, but bloats context and risks the 128 MB memory ceiling for video).

### D6: OAuth via `@cloudflare/workers-oauth-provider`, remove REST tool route
**Choice**: Wrap `McpAgent.serve("/mcp")` in `OAuthProvider`; delete `api/routes/wechat.ts` tool-execution route. Keep only a versioned, authenticated thin REST shim if a non-MCP HTTP consumer truly exists (to be confirmed).
**Rationale**: Closes the open tool-call hole; MCP `tools/call` over `/mcp` is strictly more standard than a bespoke REST route.
**Alternatives**: API-key middleware on the REST route (weaker than OAuth for human clients; not MCP-native).

### D7: Webhook is write-only; inbound messages are exposed via an MCP query tool (no server-side cron)
**Choice**: The `/wx/callback` handler does only signature verify → AES decrypt → write to a new `inbound_messages` D1 table → ack WeChat within 5s. The Worker then exposes a new `wechat_inbox` MCP tool (`list_pending` / `list_all` / `get` / `mark_processed`) alongside the existing 15 tools. **The Worker runs NO cron, NO scheduler, NO autonomous Agent loop** — an external AI agent (e.g. a Claude Code / Cursor client on its own schedule) calls `wechat_inbox` to pull pending messages, decide what to do, reply via existing outbound tools (`wechat_customer_service` / `wechat_auto_reply`), then `mark_processed`.
**Rationale**: (1) MCP tools are passive by design — they are called, they do not self-schedule; (2) WeChat requires ack within ~5s, so the webhook must not do inline AI inference or outbound calls; (3) keeping all scheduling and decision logic in the external agent means the Worker has strictly less state, fewer moving parts, and no timer/alarm billing; (4) the external agent already has richer scheduling/orchestration than anything we'd build server-side.
**Alternatives**: server-side cron Agent scanning `inbound_messages` (rejected per stakeholder — processing belongs to the external agent; the Worker only exposes the data); push to a connected MCP session via server notification (requires client-side push support, not portable); Cloudflare Queues → consumer Worker (adds infra for a job the external agent already does).

## Risks / Trade-offs

- **`api-client.ts` rewrite size** → mechanical but error-prone. Mitigation: land `HttpExecutor` first behind the existing interface, keep axios as the Node executor, add `WorkersHttpExecutor`, run both through a shared test harness that replays fixture requests/responses.
- **`McpAgent` session-state reset on reconnect** → token/credentials lost if placed in `setState`. Mitigation: enforce (via spec + review) that durable data lives only in `TokenOwner` DO or D1, never in session state.
- **Remote-MCP client compatibility** → not all AI clients support Streamable HTTP yet. Mitigation: verify Cursor / Claude Code / Claude Desktop remote support during MVP; document `npx mcp-remote` bridge as fallback.
- **Workers CPU/memory limits** → AES decrypt of large inbound payloads or large media could exceed limits. Mitigation: stream where possible; reject oversize inputs early (spec requirement in `media-pipeline`).
- **BREAKING REST removal** → existing REST consumers break. Mitigation: deprecate-and-redirect notice on the old route for one release; confirm consumer list before hard removal.
- **Two runtimes to maintain** → stdio Node and Workers share handlers but diverge on executor/storage. Mitigation: keep the seam narrow (`HttpExecutor`, `StorageManager` interface); CI smoke-tests both.

## Migration Plan

1. **Phase 0 — seams (no behavior change on Node).** Introduce `HttpExecutor` interface and `StorageManager` interface; retrofit existing code behind them. Ship stdio as today.
2. **Phase 1 — D1 + Workers skeleton.** Add `wrangler.jsonc`, D1 binding + migration for the six tables, R2 binding. Implement D1 + Workers executors. Deploy an MVP `WechatMcpAgent` exposing `wechat_auth` + `wechat_draft` only, behind OAuth.
3. **Phase 2 — token singleton.** Add `TokenOwner` DO; point the Workers executor at it; verify dedup + proactive refresh against WeChat's staging credentials.
4. **Phase 3 — all tools + media + inbox.** Port the remaining tools (now 16 with the new `wechat_inbox`); add `fileUrl`/R2 upload paths; stream resumability via `DurableObjectEventStore`.
5. **Phase 4 — webhook.** Add `/wx/callback` (verify + decrypt + persist to `inbound_messages` + ack). No server-side processing — `wechat_inbox` tool already exposes the data to external agents.
6. **Phase 5 — cutover.** Deprecate REST tool route; route traffic to `/mcp`; remove Express SSE transport from Workers path (Node stdio untouched).
- **Rollback**: Workers and Node paths are independent; a bad Worker deploy rolls back via `wrangler rollback` with zero impact on the npm stdio package. D1 migrations are forward-only; each migration is additive (no destructive ALTER) so rollback does not require data loss.

## Open Questions

- Are there any non-MCP HTTP consumers of `/api/wechat/tools/*` that cannot migrate to MCP `tools/call`? (Determines whether we keep a thin authenticated REST shim.)
- Which AI clients must be supported for remote MCP, and do their current versions support Streamable HTTP? (Drives MVP acceptance + `mcp-remote` fallback docs.)
- **RESOLVED** — Where do decrypted inbound webhook messages go and who processes them? → Decision D7: webhook writes them to a D1 `inbound_messages` table and acks WeChat; the Worker exposes a `wechat_inbox` MCP tool (`list_pending` / `list_all` / `get` / `mark_processed`). No server-side cron or Agent loop — an **external** AI agent calls the tool on its own schedule to pull, process, reply, and mark processed.
- Do we run `TokenOwner` in a specific jurisdiction for data residency, or global? (Default: global.)
