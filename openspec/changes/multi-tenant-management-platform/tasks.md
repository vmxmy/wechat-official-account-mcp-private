## 0. Preflight and contract lock

- [x] 0.1 Run `openspec validate multi-tenant-management-platform` and fix proposal/design/spec formatting before implementation.
- [ ] 0.2 Snapshot current production behavior for `/health`, anonymous `/mcp`, authenticated `tools/list`, `wechat_auth.get_config`, draft list, publish list, and webhook callback.
- [x] 0.3 Review `WECHAT_OFFICIAL_API_CONTRACT.md` before touching any WeChat API operation and record any endpoint/field uncertainty as a follow-up.
- [x] 0.4 Preserve current uncommitted changes in `src/worker/index.ts` or explicitly reconcile them before starting code edits.
- [x] 0.5 Add regression tests for the current default single-account MCP flow so the backfilled default tenant/account remains compatible.

## 1. D1 schema and migration foundation

- [x] 1.1 Add an additive D1 migration for `tenants`, `users`, `oauth_identities`, `tenant_memberships`, `oauth_clients`, `wechat_accounts`, `wechat_access_tokens`, `audit_logs`, and `operation_jobs`.
- [x] 1.2 Add tenant/account columns and indexes for new tenant-aware resource tables or replacement tables for media, permanent media, drafts, publishes, and inbound messages.
- [x] 1.3 Ensure all new secret columns store encrypted values with the existing `enc:` compatibility model.
- [x] 1.4 Add unique constraints for tenant slugs, OAuth client IDs, account slugs within tenant, and `(tenant_id, account_id)` token rows.
- [x] 1.5 Add a local migration test fixture proving the new schema applies cleanly to an empty D1-like database.
- [x] 1.6 Add a migration/backfill script or task that creates a default tenant, default admin user, default membership, and default WeChat account from existing single-tenant config.
- [x] 1.7 Add a backfill test fixture for an existing single-tenant config row and verify old tables remain intact.

## 2. Tenant-aware storage layer

- [x] 2.1 Define shared `TenantContext`, `AccountContext`, role, scope, and account metadata types.
- [ ] 2.2 Implement tenant repository methods for tenant CRUD/list scoped by membership.
- [x] 2.3 Implement user, OAuth identity, and tenant membership repository methods.
- [x] 2.4 Implement account repository methods for create/list/get/update/disable/configure with encrypted secret handling.
- [x] 2.5 Implement account-scoped token repository methods replacing global `access_tokens` access for the new runtime path.
- [x] 2.6 Implement tenant/account-scoped media and R2 key helpers.
- [x] 2.7 Implement tenant/account-scoped inbox store queries and `mark_processed` behavior.
- [ ] 2.8 Add cross-tenant negative tests for each repository family.

## 3. Authorization and context resolution

- [x] 3.1 Implement OAuth client storage and validation for client ID, type, redirect URIs, scopes, status, and secret hash for confidential clients.
- [x] 3.2 Replace password-only authorization user resolution with server-side user, identity, membership, and OAuth client resolution.
- [x] 3.3 Implement OAuth scope constants and reusable scope-check helpers.
- [x] 3.4 Implement request context resolution for Worker fetch requests, including user ID, OAuth client ID, scopes, tenant memberships, and request ID.
- [x] 3.5 Implement account resolution rules: explicit account ID, server-side default account, single accessible account inference, and multiple-account ambiguity error.
- [ ] 3.6 Add tests for anonymous, disabled user, disabled client, missing scope, non-member tenant, and multiple-account ambiguity cases.
- [x] 3.7 Keep anonymous `/mcp` returning OAuth challenge behavior.

## 4. Account-isolated WeChat runtime

- [x] 4.1 Change TokenOwner lookup from global name to account-scoped name such as `token:{tenantId}:{accountId}`.
- [x] 4.2 Update TokenOwner storage schema or wrapper so each DO instance stores only its account's token and metrics.
- [x] 4.3 Update token refresh to load WeChat app ID/app secret from the resolved account config.
- [x] 4.4 Implement `WechatApiClientFactory` that requires `AccountContext` and injects account-scoped token provider, inbox store, media namespace, and proxy config.
- [x] 4.5 Ensure configured relay proxy remains Worker-compatible and is applied consistently for token refresh and normal WeChat API calls.
- [ ] 4.6 Add concurrency tests proving same-account refresh coalesces and different-account refreshes do not collide.
- [x] 4.7 Add tests proving unauthorized account access does not construct a WeChat API client or call WeChat.

## 5. MCP adapter and tools

- [x] 5.1 Update MCP tool registration wrapper to resolve tenant/account context before invoking tenant data or WeChat operation tools.
- [x] 5.2 Extend relevant existing MCP tool schemas with optional `accountId` while preserving default single-account behavior.
- [x] 5.3 Change `wechat_auth.configure`, `get_config`, `get_token`, `refresh_token`, and `clear` semantics to be account-scoped.
- [x] 5.4 Add `woa_context` MCP tool for current user, tenants, accounts, default account, and scopes.
- [x] 5.5 Add `woa_tenant` MCP tool for tenant list/get/update according to role and scopes.
- [x] 5.6 Add `woa_account` MCP tool for list/create/update/disable/configure/status according to role and scopes.
- [x] 5.7 Add `woa_audit` MCP tool for audit log query with tenant/account filters.
- [ ] 5.8 Add MCP tests for single-account inference, multiple-account ambiguity, inaccessible account rejection, account-scoped auth config, and existing tool compatibility.
- [x] 5.9 Update `test-tools.js` expected tool inventory and fixtures after adding management tools.

## 6. Management REST API

- [x] 6.1 Add `/api/v1/me` route with authenticated user, scopes, tenants, and accounts response.
- [ ] 6.2 Add tenant list/create/read/update routes with membership and scope enforcement.
- [x] 6.3 Add account list/create/read/update/disable/configure/status/token-refresh routes with secret-safe responses.
- [x] 6.4 Add draft, publish, inbox, and audit routes that call the same use cases as MCP tools.
- [x] 6.5 Add structured JSON error helpers with stable error code, message, details, and request ID.
- [x] 6.6 Keep `/api/wechat/tools/*` removed and covered by a regression test that proves no tool execution occurs.
- [x] 6.7 Add REST integration tests for anonymous 401, missing scope, cross-tenant ID tampering, validation errors, and successful account-scoped operations.

## 7. Remote-only CLI

- [x] 7.1 Decide CLI source layout and package entrypoint while keeping runtime remote-only.
- [x] 7.2 Implement `woa login --server <url>` OAuth flow with PKCE for public CLI clients.
- [x] 7.3 Implement local OAuth token storage with restrictive file permissions and no WeChat secret persistence.
- [x] 7.4 Implement `woa whoami`, `woa tenant list`, `woa account list`, and account selection/default commands.
- [x] 7.5 Implement `woa account configure` to submit WeChat credentials over HTTPS and discard raw secrets locally.
- [x] 7.6 Implement common operation commands for draft list, publish list, inbox list, and token refresh.
- [x] 7.7 Implement `woa mcp config codex` and `woa mcp config claude` helpers that write Streamable HTTP MCP config pointing at `/mcp` with OAuth settings.
- [x] 7.8 Add CLI smoke tests with mocked server responses and assertions that old local MCP server flags are absent.

## 8. Account-scoped webhooks

- [x] 8.1 Add account-addressable callback route, choosing either opaque `accountId` or tenant/account slug path and documenting the final form.
- [x] 8.2 Update webhook handler to resolve account config before signature verification.
- [x] 8.3 Verify plaintext signatures with the resolved account webhook token.
- [x] 8.4 Verify encrypted callback signatures, decrypt with the resolved account EncodingAESKey, and validate decrypted appid.
- [x] 8.5 Persist inbound messages with tenant/account identifiers and account-scoped deduplication keys.
- [x] 8.6 Keep webhook handler write-only and fast: no outbound WeChat API calls, no MCP notifications, no AI inference inline.
- [x] 8.7 Make old `/wx/callback` return migration guidance unless a safe single-account compatibility mode is explicitly configured.
- [x] 8.8 Add webhook tests for valid plaintext, invalid signature, encrypted appid mismatch, duplicate retry, cross-account dedup isolation, and old-route guidance.

## 9. Audit and high-risk guardrails

- [x] 9.1 Implement audit-log writer with sanitized metadata and request/user/client/tenant/account/action fields.
- [ ] 9.2 Add audit logging to account config changes, credential rotation, token refresh requests, draft mutations, publish operations, menu mutations, mass-send operations, inbox processing, and destructive deletes.
- [ ] 9.3 Implement high-risk scope checks for publish, mass-send, menu overwrite/delete, credential changes, quota clear, and destructive batch delete.
- [x] 9.4 Implement explicit confirmation marker or job approval checks for public-impacting or destructive operations.
- [ ] 9.5 Implement account-scoped operation jobs for long-running, polling, retryable, or bulk workflows where needed.
- [x] 9.6 Add tests proving secrets are redacted from audit logs, errors, MCP responses, API responses, and CLI output.
- [ ] 9.7 Add audit query tests for tenant admin success and cross-tenant denial.

## 10. Documentation and rollout

- [x] 10.1 Update README with multi-tenant concepts, OAuth, tenant/account setup, remote MCP, REST API, CLI, and webhook URL migration.
- [x] 10.2 Add an operator runbook for D1 migration, default tenant/account backfill, OAuth client setup, and rollback.
- [x] 10.3 Add a WeChat dashboard webhook migration guide showing the account-addressable callback URL.
- [x] 10.4 Update AGENTS.md / CLAUDE.md project notes to reflect multi-tenant runtime rules and HTTP-only CLI posture.
- [x] 10.5 Document high-risk operation confirmation behavior for MCP, API, and CLI users.
- [x] 10.6 Document secret rotation guidance for WeChat credentials, OAuth clients, and relay proxy tokens.

## 11. Verification and release gates

- [x] 11.1 Run `openspec validate multi-tenant-management-platform` and fix all issues.
- [x] 11.2 Run `npm run check`.
- [x] 11.3 Run `npm test` and ensure tool inventory and tenant fixtures pass.
- [x] 11.4 Run `npm run lint`.
- [x] 11.5 Run `npx wrangler deploy --dry-run`.
- [ ] 11.6 Run local/preview MCP smoke tests for `tools/list`, `woa_context`, account-scoped `wechat_auth.get_config`, draft list, publish list, and inbox list.
- [x] 11.7 Run local/preview REST smoke tests for `/api/v1/me`, tenant list, account list, account config, draft list, and audit query.
- [x] 11.8 Run CLI smoke tests for login mock, whoami, account list, draft list, and MCP config generation.
- [x] 11.9 Verify production rollout plan includes additive migration first, backfill, Worker deploy, OAuth client setup, webhook URL update, and rollback checkpoint.
