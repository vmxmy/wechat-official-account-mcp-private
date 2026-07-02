## 0. Official WeChat contract verification

- [x] 0.1 Review `wechat-official-api-contract.md` before implementation and re-open official docs for any endpoint being touched
- [x] 0.2 Fix `wechat_subscribe_msg` contract before/while migrating: use the official endpoint (`/cgi-bin/message/subscribe/bizsend` for service-account subscription notifications, or `/cgi-bin/message/template/subscribe` for one-time subscription) and official field names (`template_id`)
- [x] 0.3 Clarify and fix `wechat_permanent_media` `news` support: either expose `news` in the schema and map to official `material/add_news`, or remove unreachable news branches
- [x] 0.4 Verify `wechat_customer_service.get_records` has an official endpoint implementation or remove/replace the action
- [x] 0.5 Decide whether missing official APIs (`tags/getidlist`, template set/add, mass get/speed set/get/uploadnews) are in scope for this migration or documented as follow-up gaps

## 1. Seams

- [x] 1.1 Define `HttpExecutor` interface (`get`, `post`, `postForm`) and extract token-injection + safe-error-logging into a shared wrapper
- [x] 1.2 Refactor `WechatApiClient` to depend on `HttpExecutor`; final runtime injects `WorkersHttpExecutor` via `AccessTokenHttpExecutor`
- [x] 1.3 Define `StorageManager` interface and implement the final runtime with `D1StorageManager`
- [x] 1.4 Run `npm run check`, `npm run build:prod`, `node test-tools.js`; verify HTTP-only build outputs no stdio/CLI artifacts

## 2. Workers project skeleton

- [x] 2.1 Add `wrangler.jsonc` with `nodejs_compat`, DO bindings (`WECHAT_MCP_AGENT`, `TOKEN_OWNER`), D1 binding (`DB`), R2 binding (`MEDIA`), Secrets Store references
- [x] 2.2 Add DO migration (`new_sqlite_classes` for both DO classes, tag `v1`)
- [x] 2.3 Create D1 migration creating the six tables (`config`, `access_tokens`, `media`, `permanent_media`, `drafts`, `publishes`) with existing column definitions
- [x] 2.4 Add `agents`, `@cloudflare/workers-oauth-provider` deps; verify `npm run check` still passes

## 3. D1 + Workers executors

- [x] 3.1 Implement `WorkersHttpExecutor` using `fetch` + Web `FormData` + `Uint8Array`
- [x] 3.2 Implement `D1StorageManager` against the `StorageManager` interface
- [x] 3.3 Preserve AES field encryption with `enc:` prefix on D1; source key from a Worker secret binding
- [x] 3.4 Add a fixture-based test harness for Workers executor token injection, relay proxy behavior, multipart FormData, and arraybuffer responses

## 4. McpAgent MVP (auth + draft only)

- [x] 4.1 Create `WechatMcpAgent extends McpAgent`; register `wechat_auth` + `wechat_draft` in `init()` via `this.server.tool(...)`
- [x] 4.2 Wire `export default WechatMcpAgent.serve("/mcp")`; confirm `initialize` + `tools/list` + `tools/call` round-trip via `npx mcp-remote`
- [x] 4.3 Confirm hibernation: idle a session, reconnect, verify session state preserved
- [x] 4.4 Wrap `/mcp` in `OAuthProvider` (`apiHandlers`); reject anonymous `tools/call` with 401

## 5. Token singleton DO

- [x] 5.1 Create `TokenOwner` DO obtained via `getAgentByName(env.TOKEN_OWNER, "global")`; implement refresh with single-writer semantics
- [x] 5.2 Persist token + expiry to DO storage; expose read to executors so cold starts skip refresh
- [x] 5.3 Add proactive pre-expiry refresh via DO `schedule()`/alarm (5-minute window)
- [x] 5.4 Verify concurrent requests coalesce to one WeChat token call; verify multi-edge coalescing

## 6. Remaining tools + media pipeline

- [x] 6.1 Port the remaining 13 tools into `WechatMcpAgent.init()`; verify all 15 still listed via `tools/list`
- [x] 6.2 Add `fileUrl` upload path to `wechat_media_upload`, `wechat_upload_img`, `wechat_permanent_media` (Worker `fetch` → WeChat)
- [x] 6.3 Add R2-key upload path; confirm R2 → WeChat stays on-network (no egress)
- [x] 6.4 Reject `filePath` with a clear error; local Node/stdin filePath runtime is removed
- [x] 6.5 Enforce `ALLOWED_MEDIA_TYPES` + `FILE_SIZE_LIMITS` + Workers 128 MB ceiling before upload
- [x] 6.6 Configure `DurableObjectEventStore` for stream resumability; test `Last-Event-ID` replay on a `wechat_mass_send` polling stream

## 7. WeChat webhook (write-only) + `wechat_inbox` MCP tool

- [x] 7.1 Add `inbound_messages` table to the D1 migration (id, `dedup_key` UNIQUE, `to_user_name`, `from_user_name`, type, event type, raw XML, parsed payload JSON, `CreateTime`, received_at, processed_at NULL)
- [x] 7.2 Implement `GET/POST /wx/callback` with official WeChat signature verification: plaintext `signature` = SHA1(sorted token/timestamp/nonce); encrypted `msg_signature` = SHA1(sorted token/timestamp/nonce/Encrypt); reject invalid signatures with 403
- [x] 7.3 Implement `echostr` handshake response for WeChat server verification
- [x] 7.4 Implement XML parse + AES-CBC-256/PKCS#7 decrypt of `<Encrypt>` using `encoding_aes_key`; validate decrypted appid matches `WECHAT_APP_ID`
- [x] 7.5 Verify signature → decrypt if needed → INSERT into `inbound_messages` (processed_at NULL, deterministic `dedup_key`) → respond to WeChat within 5s; confirm the handler makes NO outbound WeChat call, NO MCP notification, and schedules NO task
- [x] 7.6 Implement `wechat_inbox` MCP tool (new file `src/mcp-tool/tools/inbox-tool.ts`) with actions: `list_pending`, `list_all`, `get`, `mark_processed`; Zod schema following the existing tool pattern (see `user-tool.ts`)
- [x] 7.7 Register `wechat_inbox` in `src/mcp-tool/tools/index.ts` `mcpTools` array; update `test-tools.js` expected count from 15 to 16
- [x] 7.8 Implement D1 queries behind the tool (pagination newest-first, type/openid filters, batch `mark_processed` returning updated count)
- [x] 7.9 Add tests: valid/invalid signature, encrypted decrypt, ack-within-5s, dedup on retry; tool `list_pending` / filters / `mark_processed` behavior

## 8. Auth cutover + REST removal

- [x] 8.1 Audit for non-MCP consumers of `POST /api/wechat/tools/:toolName` (resolve Open Question in design.md)
- [x] 8.2 Add deprecation notice on the old REST route for one release; return 410/404 with migration guidance
- [x] 8.3 Remove `api/routes/wechat.ts` tool-execution route, MCP-over-SSE transport, and local stdio/CLI runtime; keep Workers `/mcp` Streamable HTTP
- [x] 8.4 Move all secrets to Cloudflare Secrets Store / `wrangler secret`; confirm none in `wrangler.jsonc` or committed config
- [x] 8.5 Document remote-MCP client setup (Claude Desktop / Cursor / Claude Code + `mcp-remote` fallback)
- [x] 8.6 Remove local desktop code: `src/cli.ts`, `src/mcp-server/`, `AuthManager`, SQLite storage, Node/Axios executor, and Node media tools

## 9. Verification + docs

- [x] 9.1 `openspec validate migrate-to-cloudflare-workers` passes
- [x] 9.2 `npm run check` + `npm run build:prod` + `node test-tools.js` (16 tools) pass for HTTP-only build
- [x] 9.3 `wrangler deploy --dry-run` passes; staging deploy is credential-gated, so local Wrangler smoke-tests all 16 tools over `/mcp` via an MCP client flow
- [x] 9.4 Update `README.md`, `AGENTS.md`, `CLAUDE.md` with the Workers deployment + remote MCP instructions
- [x] 9.5 Prepare archive-ready evidence; run `openspec archive migrate-to-cloudflare-workers` only after production cutover is stable
