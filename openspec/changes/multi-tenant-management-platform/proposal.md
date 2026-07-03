## Why

The current Workers Remote MCP deployment is production-oriented but single-tenant: one logical WeChat Official Account config, one global token owner, one OAuth password gate, and shared storage rows. To support real WeChat Official Account management for multiple organizations and accounts, the platform needs tenant/account isolation, unified OAuth, REST management APIs, and a remote-only CLI while preserving the existing HTTP-only MCP direction.

## What Changes

- Add a multi-tenant domain model for tenants, users, memberships, OAuth clients, and WeChat Official Account instances.
- Scope all credentials, access tokens, media, inbound messages, jobs, and audit events by `(tenant_id, account_id)`.
- Replace global WeChat config/token semantics with account-scoped configuration and account-scoped token ownership.
- Extend MCP execution with authenticated tenant/account context and account resolution rules.
- Add tenant/account management MCP tools such as `woa_context`, `woa_tenant`, `woa_account`, and `woa_audit`.
- Add a versioned OAuth-protected REST API under `/api/v1/*` for tenant, account, inbox, draft/publish, and audit operations.
- Add a remote-only CLI that logs in through the same OAuth authority and calls remote API/MCP endpoints; it must not run a local MCP server.
- Change WeChat webhook routing to account-addressable callback URLs so the Worker can resolve the correct webhook token before signature verification.
- Add audit logging and high-risk operation guardrails for publish, mass-send, menu mutation, credential changes, and destructive actions.
- Preserve HTTP-only production posture: keep Workers `/mcp` Streamable HTTP + OAuth, and do not reintroduce local stdio, SSE, unauthenticated REST tool execution, SQLite, Node/Axios executor, or local `filePath` upload.
- **BREAKING**: webhook callback URLs move from a single `/wx/callback` endpoint to account-addressable endpoints. Existing WeChat dashboard callback URLs must be updated during rollout.
- **BREAKING**: `wechat_auth.configure` changes from global configuration semantics to tenant/account-scoped account configuration semantics.

## Capabilities

### New Capabilities

- `multi-tenant-identity`: tenant, user, membership, role, and account-access model.
- `unified-oauth`: one OAuth authority for MCP, REST API, and CLI access with scopes and tenant/account authorization context.
- `account-isolated-wechat-runtime`: account-scoped WeChat credentials, token ownership, storage access, proxy use, and API-client construction.
- `tenant-aware-mcp-tools`: MCP tool execution with tenant/account context, account resolution, and management tools.
- `management-rest-api`: versioned OAuth-protected HTTP API for tenants, accounts, WeChat operations, inbox, and audit logs.
- `remote-cli`: remote-only CLI that authenticates via OAuth and manages tenants/accounts/content without storing WeChat secrets locally.
- `account-scoped-webhooks`: account-addressable WeChat callback routing with per-account signature verification, decrypt, and inbox isolation.
- `audit-and-operation-guardrails`: audit trail and explicit guardrails for high-risk or destructive operations.

### Modified Capabilities

None. No archived OpenSpec capabilities currently exist; all behavior contracts for this platform expansion are introduced as new capabilities.

## Impact

- `src/worker/index.ts`: OAuth authorization, request routing, `/mcp`, `/api/v1/*`, webhook routing, token owner lookup, and context construction.
- `src/storage/d1-storage-manager.ts` and new storage modules: tenant-aware D1 schema, credential encryption, account-scoped CRUD, and migration/backfill support.
- `migrations/d1/`: additive multi-tenant schema migration plus default tenant/account backfill path.
- `src/wechat/api-client.ts`, `src/wechat/workers-http-executor.ts`, `src/wechat/proxy.ts`: per-account API-client factory and proxy configuration.
- `src/mcp-tool/tools/*`: account-resolution support, scoped auth/config behavior, and new management/audit tools.
- `src/worker/wechat-webhook.ts` and `src/worker/inbox-store.ts`: account-scoped webhook verification and inbox storage/querying.
- New CLI package/source entrypoint for remote API/MCP client commands.
- Documentation: README, deployment docs, OAuth setup, webhook migration runbook, CLI usage, and client configuration guides.
- CI/CD: tests must cover tenant isolation, OAuth authorization, token-owner partitioning, webhook routing, MCP tool context, REST API authorization, and CLI smoke paths.
