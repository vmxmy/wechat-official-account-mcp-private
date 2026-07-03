## Context

The current production direction is a Cloudflare Workers Remote MCP server exposed through Streamable HTTP at `/mcp`, protected by `@cloudflare/workers-oauth-provider`, with business data in D1, media in R2, MCP sessions in `McpAgent`, and WeChat access-token refresh owned by a Durable Object. The previous Cloudflare migration intentionally kept the product single-tenant: one logical WeChat configuration, one global token owner, one OAuth password gate, and storage rows that are not scoped by tenant or account.

The target product is a full WeChat Official Account management surface for multiple organizations and multiple official accounts per organization. AI clients consume MCP tools, programmatic clients consume REST APIs, and operators use a CLI. These entrypoints must share the same identity, authorization, tenant/account isolation, WeChat API client construction, audit trail, and high-risk operation controls.

Constraints:
- The runtime remains HTTP-only on Cloudflare Workers. Local stdio, MCP-over-SSE, unauthenticated REST tool execution, native SQLite, Node/Axios HTTP, Node forward proxy, and local `filePath` upload must not return.
- TypeScript source must remain ESM-compatible with explicit `.js` import extensions for backend code.
- WeChat API endpoints, fields, signing rules, and limits remain governed by `WECHAT_OFFICIAL_API_CONTRACT.md` and official WeChat docs.
- Existing single-tenant production data must be migratable into a default tenant/account without destructive D1 changes.
- WeChat webhook signature verification requires resolving the correct account token before trusting the message body.

Stakeholders:
- Tenant administrators who configure and rotate WeChat credentials.
- Content operators who manage drafts, publishing, messages, users, tags, comments, and statistics.
- AI clients using MCP over `/mcp`.
- API/CLI clients automating management tasks.
- Platform operators responsible for security, billing, support, and incident response.

## Goals / Non-Goals

**Goals:**
- Introduce a durable multi-tenant identity and membership model.
- Scope every WeChat account, credential, token, media item, inbound message, operation job, and audit row by tenant/account.
- Use one OAuth authority for MCP, REST API, and CLI access.
- Preserve the existing Workers Remote MCP posture and existing WeChat tool semantics where possible.
- Add tenant/account management capabilities through MCP tools, REST APIs, and CLI commands.
- Make token refresh account-scoped and single-writer per account.
- Make webhook callback routing account-addressable and safely verifiable.
- Add audit logging and guardrails for destructive or high-risk WeChat operations.
- Provide a forward-only migration path from the current single-tenant deployment.

**Non-Goals:**
- Reintroducing local desktop stdio, MCP-over-SSE, or a local MCP server CLI.
- Reintroducing the legacy unauthenticated `/api/wechat/tools/*` execution surface.
- Building a full React dashboard in this change.
- Implementing billing, metering, or paid-plan enforcement.
- Replacing Cloudflare Workers, D1, R2, Durable Objects, or the current MCP SDK.
- Changing WeChat official API contract behavior beyond what is required for scoping and safety.

## Decisions

### D1: Domain/use-case core with MCP, REST, and CLI adapters

**Choice**: Extract shared tenant-aware use cases and context resolution behind adapters for MCP tools, REST routes, and CLI calls.

**Rationale**: MCP, API, and CLI must enforce the same tenant isolation, OAuth scopes, account resolution, audit logging, and WeChat API behavior. A shared use-case layer avoids divergent authorization and validation rules.

**Alternatives considered**:
- Keep MCP tools as the only business surface and implement REST/CLI as wrappers around MCP calls. Rejected because API/CLI need stable HTTP semantics, structured errors, and finer-grained integration tests.
- Duplicate logic in REST handlers and MCP tools. Rejected because it increases security drift risk.

### D2: Tenant/account context is mandatory for WeChat operations

**Choice**: Introduce `TenantContext`/`AccountContext` resolved before constructing `WechatApiClient` or touching tenant data. All WeChat operation use cases require an account context except pure discovery endpoints such as `GET /api/v1/me` or `woa_context`.

**Rationale**: The current single global config is the central isolation risk. Making context mandatory at the boundary prevents accidental global reads/writes.

**Alternatives considered**:
- Keep a global default account and add optional tenant filters. Rejected because optional scoping is easy to bypass.
- Encode tenant/account only in tool parameters. Rejected because trusted context must come from OAuth claims and membership checks, not user-supplied parameters alone.

### D3: Additive D1 schema with backfill before destructive cleanup

**Choice**: Add new tenant-aware tables and indexes, backfill existing single-tenant data into a default tenant/account, then migrate runtime reads/writes to the new tables. Old single-tenant tables remain during the initial rollout.

**Rationale**: D1 migrations are forward-only in practice. Additive changes allow safe deploy/rollback of Worker code without data loss.

**Alternatives considered**:
- ALTER old tables in-place. Rejected because rollback and partial-deploy safety are worse.
- Create a separate D1 database per tenant. Rejected because it complicates onboarding, queries, migrations, and account management for little benefit at current scale.

### D4: TokenOwner is account-scoped, not global

**Choice**: Resolve token-owner Durable Object names as `token:{tenantId}:{accountId}` or an equivalent stable account-scoped key. Each instance stores only one account's token and metrics.

**Rationale**: WeChat access tokens belong to one appid/appsecret pair. Account-scoped DOs preserve single-writer refresh semantics without cross-account collisions.

**Alternatives considered**:
- One global TokenOwner with tenant/account columns. Rejected because a bug can still mix token state and the global singleton can become a bottleneck.
- D1 optimistic locking only. Rejected because proactive pre-expiry refresh and cross-edge coalescing are simpler and safer with DO ownership.

### D5: OAuth authority issues access with tenant/account authorization context

**Choice**: Use the existing Workers OAuth Provider as the authority for MCP, REST, and CLI, but replace the single password user model with users, memberships, OAuth clients, scopes, and authorization context.

**Rationale**: One authority avoids separate credential systems. OAuth scopes and memberships provide the control plane needed for MCP clients, API clients, and CLI sessions.

**Alternatives considered**:
- Separate API keys for REST/CLI and OAuth for MCP. Rejected because it creates two auth systems and weakens revocation/audit consistency.
- Keep only password-based authorization. Rejected because it cannot model multi-user roles or tenant memberships.

### D6: Account-addressable webhook URL

**Choice**: Use account-addressable callback routes such as `/wx/callback/:accountId` or `/wx/:tenantSlug/:accountSlug/callback`.

**Rationale**: The Worker must know which webhook token and AES key to use before verifying the signature or decrypting the message. A single `/wx/callback` cannot safely resolve multiple accounts without trusting unverified body contents.

**Alternatives considered**:
- Parse `ToUserName` or encrypted body first to find account. Rejected because the body is not trusted before signature verification.
- Use one webhook token for all accounts. Rejected because it weakens account isolation and complicates credential rotation.

### D7: Remote-only CLI

**Choice**: Build CLI as a remote client for OAuth, REST API, and MCP configuration helpers. It must not run a local MCP server and must not store WeChat app secrets locally after account configuration.

**Rationale**: This preserves the HTTP-only production architecture while giving operators scriptable workflows.

**Alternatives considered**:
- Restore the old local `wechat-mcp mcp -a -s` mode. Rejected by runtime direction and tenant-isolation goals.
- Make CLI a thin `curl` wrapper only. Rejected because OAuth login, token storage, account selection, and client config writing require higher-level UX.

### D8: Audit-first guardrails for high-risk operations

**Choice**: Mutating operations write audit logs with user/client/tenant/account/action metadata. High-risk operations require explicit scopes and may require confirmation flags or job records.

**Rationale**: WeChat publish, mass-send, menu mutation, credential rotation, and destructive deletes can have public or irreversible effects. Auditability and explicit authorization reduce operational risk.

**Alternatives considered**:
- Rely on MCP client prompts only. Rejected because API/CLI clients also need guardrails and server-side enforcement.
- Audit only failures. Rejected because successful high-risk operations are the most important to trace.

## Risks / Trade-offs

- **Tenant isolation bypass through missed query filters** → Centralize storage access behind tenant-aware repositories; add tests that attempt cross-tenant ID tampering for each resource class.
- **OAuth model complexity** → Ship in phases: first local/password identity mapped to users/memberships, then add external IdP or richer login if needed; keep scope checks explicit and testable.
- **Migration split-brain between old and new tables** → Backfill once, switch reads/writes behind a feature flag or deployment milestone, and keep old tables read-only during rollback window.
- **Webhook URL breaking change** → Provide a migration runbook and keep the old `/wx/callback` returning explicit guidance rather than silently processing ambiguous messages.
- **TokenOwner cardinality growth** → One DO per active account is acceptable; monitor DO metrics and token refresh frequency.
- **MCP client UX with multiple accounts** → Provide `woa_context` and deterministic default-account resolution; when ambiguous, return a clear list of accessible accounts.
- **Secrets exposure through logs or tool output** → Keep encryption with `enc:` prefix, mask all credentials in output, and ensure audit metadata never stores raw secrets or access tokens.
- **CLI local token compromise** → Store only OAuth tokens in OS/user config with restrictive file permissions; never store WeChat app secrets after remote configuration.

## Migration Plan

1. Create additive D1 migration for tenants, users, memberships, OAuth clients, WeChat accounts, account-scoped tokens, audit logs, operation jobs, and tenant-aware resource tables/indexes.
2. Add a migration/backfill script that creates a default tenant, default admin user, and default account from the existing single-tenant `config` row and current app secrets.
3. Implement tenant-aware storage repositories while keeping old tables available for fallback during the initial rollout.
4. Introduce context resolution and account-scoped token-owner lookup; update `WechatApiClient` construction to require account context.
5. Update MCP adapter to resolve tenant/account context before tool calls and to expose account-management/context tools.
6. Add OAuth user/membership/client/scopes model and replace password-only authorization with membership-aware authorization.
7. Add REST `/api/v1/*` routes using the same use cases as MCP.
8. Add CLI OAuth login, account selection, common account/content/inbox commands, and MCP client config helpers.
9. Add account-addressable webhook routes and update docs/runbook for WeChat dashboard callback migration.
10. Add audit and high-risk operation guardrails across MCP, API, and CLI.
11. Run tenant-isolation, OAuth, token-refresh, webhook, MCP, REST, CLI, and migration tests; deploy to staging/preview if available.
12. Deploy production with additive schema and backfill; verify default tenant/account behavior; then update WeChat webhook URLs per account.
13. After stable production cutover, archive or deprecate old single-tenant tables in a later change.

Rollback strategy:
- Worker code can roll back with `wrangler rollback` while additive D1 tables remain harmless.
- During the first release window, old single-tenant tables are retained so the previous Worker version can still operate.
- Do not run destructive table cleanup in this change.

## Open Questions

- Should account-addressable webhook URLs use opaque `accountId` values or human-friendly tenant/account slugs? Opaque IDs reduce enumeration; slugs improve operator UX.
- Should the first OAuth identity source remain password-based admin login, or should an external IdP be introduced in the same change?
- Which high-risk MCP operations require server-side confirmation flags versus scope-only enforcement?
- Should CLI be packaged inside this npm package or split into a separate package after the first implementation?
- What is the desired default tenant/account naming for backfilled production data?
