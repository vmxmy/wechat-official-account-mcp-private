## 1. Preflight and contract lock

- [x] 1.1 Run `openspec validate saas-onboarding` and fix schema/format issues before implementation.
- [x] 1.2 Review `CONTEXT.md`, `docs/adr/0001-*.md` through `docs/adr/0117-*.md`, and `docs/design/anti-ai-slop-rules.md` before coding.
- [x] 1.3 Snapshot current production `/health`, unauthenticated `/mcp`, authenticated `tools/list`, `woa_context`, `woa_account.status`, draft list, publish list, and Stripe webhook behavior.
- [x] 1.4 Confirm production secrets that will be required in Cloudflare: Resend, Turnstile, GitHub OAuth, Stripe live keys/prices/webhook secret, WeChat relay, encryption key, session/OAuth signing secrets.
- [x] 1.5 Write a migration runbook that explicitly notes accepted risks: direct production D1 migration without required backup, live Stripe verification, and short WeChat API downtime.

## 2. D1 schema and repository foundation

- [x] 2.1 Add additive D1 migration for Operators, identities, email codes, Web sessions, OAuth clients, OAuth consents, OAuth refresh/session records, and public signup rate-limit counters.
- [x] 2.2 Add or reconcile D1 schema for Tenants, tenant owners, WeChat resources, default resource selection, encrypted credential fields, resource deletion status, and active AppID uniqueness.
- [x] 2.3 Add D1 schema for Tenant subscription state, Stripe Customer/subscription IDs, plan period anchors, account allowance lock state, usage counters, and usage events.
- [x] 2.4 Add D1 schema for audit logs, monitoring events, R2 media retention metadata, inbound message retention metadata, and operator deletion requests.
- [x] 2.5 Implement repository methods for Operator identity create/link/lookup by verified email and provider subject.
- [x] 2.6 Implement repository methods for email-code issue/verify/expire/attempt-count and signup/login rate limits.
- [x] 2.7 Implement repository methods for Web sessions, OAuth clients, consent records, token/session revocation, and refresh token expiry.
- [x] 2.8 Implement repository methods for Tenant bootstrap, owner lookup, WeChat resource create/list/get/rename/default/delete, AppID uniqueness, and encrypted credential save/clear.
- [x] 2.9 Implement repository methods for subscription entitlements, Stripe mapping, usage period resolution, quota reservation, and over-quota error details.
- [x] 2.10 Add repository tests for cross-tenant denial, duplicate AppID denial, deleted AppID release, failed credential non-persistence, quota period math, and secret redaction.

## 3. Identity, sessions, and OAuth

- [x] 3.1 Implement Resend-backed email code request route with Turnstile verification, IP/email/provider rate limits, 10-minute expiry, and 5-attempt invalidation.
- [x] 3.2 Implement email code verification route that creates or resolves Operator identity and starts the Web/OAuth authorization session.
- [x] 3.3 Implement optional GitHub OAuth login at `/auth/github/callback`, verified-email linking, and email-code completion when GitHub lacks verified email.
- [x] 3.4 Implement first-login bootstrap that creates default Tenant and one unconfigured WeChat resource for Operators without memberships.
- [x] 3.5 Implement HttpOnly 7-day sliding Web session issuance, validation, logout, and server-side revocation.
- [x] 3.6 Replace legacy shared authorization-password logic with email/GitHub identity login and consent pages.
- [x] 3.7 Implement dynamic public OAuth client registration with PKCE, redirect URI validation, consent display, remembered consent, access token 8h TTL, rotating refresh token 180d TTL, dynamic client 365d TTL, and revocation.
- [x] 3.8 Add tests for new Operator signup, existing Operator login, GitHub verified-email linking, missing verified email completion, Turnstile failure, rate limiting, token expiry, and revoked token denial.

## 4. Tenant and WeChat resource onboarding

- [x] 4.1 Replace placeholder Tenant/WeChat resource create/update/status behavior with real persisted use cases.
- [x] 4.2 Implement opaque ID generation for Tenants and WeChat resources and migrate code away from relying on `tenant_default/acct_default` as public IDs for new tenants.
- [x] 4.3 Implement WeChat resource creation subject to Free/Plus/Pro account allowance.
- [x] 4.4 Implement Tenant default WeChat resource resolution and Web/CLI/MCP default-resource update.
- [x] 4.5 Implement credential validation through the account-scoped WeChat API client and platform HTTPS relay before saving AppSecret.
- [x] 4.6 Ensure failed credential validation does not persist AppSecret and returns actionable relay/IP allowlist guidance.
- [x] 4.7 Implement resource rename and soft delete with AppSecret/webhook/token purge, AppID release, audit logging, and delete confirmation enforcement.
- [x] 4.8 Implement optional webhook credential configuration and inbox setup guidance for unconfigured inbound-message features.
- [x] 4.9 Add tests for onboarding completion after first valid credentials, webhook optionality, default-account inference, multiple-account default switching, soft delete, and AppID uniqueness.

## 5. Billing, quotas, and Stripe

- [ ] 5.1 Configure Stripe Products/Prices for Plus $9/month and Pro $29/month and document live-mode IDs as Cloudflare runtime secrets.
- [x] 5.2 Implement Tenant-scoped Stripe Customer creation using owner verified email.
- [x] 5.3 Implement Web/CLI checkout session creation for Plus/Pro and reject MCP checkout creation.
- [x] 5.4 Implement Stripe webhook handling for subscription create/update/cancel, period-end downgrades, and entitlement updates.
- [x] 5.5 Implement Free plan activation without payment method and Tenant-anniversary rolling periods for Free usage.
- [x] 5.6 Implement account allowances Free=1, Plus=3, Pro=10 and lock excess resources after period-end downgrade.
- [x] 5.7 Implement successful-publish allowances Free=30, Plus=300, Pro=3000 and count only successful article/image publishes.
- [x] 5.8 Implement tool-call allowances Free=300, Plus=3000, Pro=30000 across Web/CLI/MCP/API protected operations.
- [x] 5.9 Ensure failed publish attempts consume tool-call allowance but not successful-publish allowance.
- [x] 5.10 Ensure over-quota operations are rejected before WeChat API calls and include plan, limit, remaining/reset, and upgrade guidance.
- [x] 5.11 Add tests for checkout creation, webhook entitlement updates, quota resets, downgrade locking, over-quota preflight, and MCP upgrade guidance.

## 6. Web entrypoint with Astryx and TanStack

- [x] 6.1 Add `@astryxdesign/core`, `@astryxdesign/cli`, TanStack Router, TanStack Router Vite plugin, and TanStack Query dependencies; remove React Router once TanStack routes are wired.
- [x] 6.2 Move Web source to `web/`, configure Vite/TanStack file routes, output `web/dist`, and update Worker static asset serving and build scripts.
- [x] 6.3 Run Astryx dense docs bootstrap and record component/template choices before implementing Web pages.
- [x] 6.4 Implement Astryx theme CSS with required layer order, `ThemeProvider`, and `LinkProvider` with a central TanStack `AppLink` adapter.
- [x] 6.5 Implement shared Web API client with TypeScript types and Zod response boundaries for `/me`, onboarding, account, billing, MCP config, quotas, and sessions.
- [x] 6.6 Implement TanStack Query provider, query keys, mutation invalidation, and route guards with `returnTo` redirect behavior.
- [x] 6.7 Implement email-first login page with Turnstile, email code request/verify, and optional GitHub login.
- [x] 6.8 Implement onboarding page for Tenant/resource status, platform relay allowlist guidance, AppID/AppSecret configuration, validation errors, and completion state.
- [x] 6.9 Implement billing page and Stripe success/cancel/status routes.
- [x] 6.10 Implement MCP config page that outputs native Streamable HTTP config for Codex/Claude without OAuth tokens.
- [x] 6.11 Implement security sessions page for authorized client/session listing and revocation.
- [x] 6.12 Implement Terms and Privacy pages with `support@ziikoo.app` contact and credential/payment/retention disclosures.
- [x] 6.13 Add Web tests for API client/Zod boundaries, route guards, login/onboarding/billing/security page smoke rendering, and copy/viewmodel helpers.
- [x] 6.14 Capture screenshots of critical Web pages and review them against `docs/design/anti-ai-slop-rules.md`.

## 7. CLI onboarding package

- [x] 7.1 Rename public package metadata to `@ziikoo/woa` while preserving `woa` bin and private repository metadata policy.
- [x] 7.2 Implement `woa login` against the new OAuth flow, including PKCE, browser callback, email-first authorization page, token storage, and reauthorization after legacy token rejection.
- [x] 7.3 Implement CLI commands for `whoami`, account list/create/rename/default/configure/status/delete, quota/status, and Tenant context display.
- [x] 7.4 Implement `woa billing checkout --plan plus|pro` to create checkout, print URL, and open browser.
- [x] 7.5 Implement MCP config generation for Codex and Claude pointing to `https://woa.ziikoo.app/mcp` without tokens or local MCP transports.
- [x] 7.6 Enforce destructive delete confirmation before remote delete calls.
- [x] 7.7 Add CLI smoke tests with mocked server responses proving no WeChat secrets are stored locally and no local MCP/stdio/SSE commands are restored.
- [x] 7.8 Prepare npm publish workflow for `@ziikoo/woa` and track old package removal as an external npm policy task.

## 8. MCP management onboarding

- [x] 8.1 Update MCP registration/context creation to derive Operator/Tenant/resource/plan from trusted OAuth/session data and D1 lookup.
- [x] 8.2 Implement real `woa_context` response including Operator, Tenant, default resource, plan, quota summary, scopes, and secret-safe config state.
- [x] 8.3 Implement MCP WeChat resource create/rename/default/configure/status/delete actions through shared backend use cases.
- [x] 8.4 Remove or reject Tenant create from MCP in the first release with clear guidance.
- [x] 8.5 Implement MCP plan-limit and quota responses with reset timing and Web/CLI upgrade guidance while not creating Stripe checkout sessions.
- [x] 8.6 Ensure MCP tools remain visible for Free Tenants while quota enforcement protects operations.
- [x] 8.7 Add MCP tests for unauthenticated challenge, context, resource create/configure/status, over-allowance rejection, delete confirmation, and no checkout creation.

## 9. Security, retention, and operations

- [x] 9.1 Implement secret redaction checks across Web/API/CLI/MCP/audit/log outputs.
- [x] 9.2 Implement audit logging for login, credential configuration, publish, delete, billing change, quota rejection, and session revocation with 180-day retention support.
- [x] 9.3 Implement R2 temporary media input 30-day cleanup and inbound message 90-day cleanup.
- [x] 9.4 Implement monitoring event capture for Worker errors, OAuth/login failures, credential validation failures, Stripe webhook failures, and quota rejections.
- [x] 9.5 Implement operator deletion request flow that cancels subscriptions, purges WeChat secrets, disables access, and records audit/support state.
- [x] 9.6 Implement direct migration that purges legacy WeChat secrets and marks legacy default resource unconfigured.
- [x] 9.7 Update Cloudflare secret binding docs/runbook for runtime secrets and keep GitHub CI limited to deployment credentials.

## 10. Documentation and product copy

- [x] 10.1 Update README with hosted SaaS onboarding, email-first login, Web/CLI/MCP entrypoints, native Streamable HTTP MCP config, plan limits, and platform relay allowlist instructions.
- [x] 10.2 Update CLI help text and examples for `@ziikoo/woa`, email-first login, billing checkout, account configuration, and MCP config generation.
- [x] 10.3 Document legal/support pages and `support@ziikoo.app` contact.
- [x] 10.4 Document video publishing as unsupported in the first release while article and image/贴图 publishing are supported.
- [x] 10.5 Document migration behavior: legacy password removal, legacy secret purge, required reconfiguration, and accepted short downtime.
- [x] 10.6 Run Chinese copy anti-slop review for Web, CLI, README, and onboarding error messages.

## 11. Verification and release gates

- [x] 11.1 Run `openspec validate saas-onboarding`.
- [x] 11.2 Run `npm run check`.
- [x] 11.3 Run `npm run lint`.
- [x] 11.4 Run `npm test`.
- [x] 11.5 Run Web build and Worker dry-run deploy validation.
- [x] 11.6 Run local or deployed smoke for email login, Web session, OAuth consent, CLI login, MCP tools/list, `woa_context`, account configure/status, quota rejection, and session revocation.
- [ ] 11.7 Run live Stripe production smoke for checkout, webhook entitlement update, and cancellation/downgrade behavior, treating all payments as real operations.
- [ ] 11.8 Run production WeChat credential reconfiguration through the new onboarding path and verify article/image publish still works.
- [x] 11.9 Capture final Web screenshots and complete anti-AI-slop reviewer pass before declaring release ready.

## 12. Agent-first contract and architecture

- [x] 12.1 Add `agent-guided-onboarding` and reconcile proposal/design plus Web, identity, tenant-resource, MCP, CLI, and security capability specs.
- [x] 12.2 Add an ADR covering CLI Help as the only Agent workflow source, no client adapters, human-in-the-loop boundaries, trusted relay egress IP rotation, minimal scopes, resumable init, and unpublished idempotent test drafts.
- [x] 12.3 Validate the updated `saas-onboarding` change before implementation continues.

## 13. CLI Agent Help, init protocol, and TUI

- [x] 13.1 Implement `woa --version` and a structured manifest rendered by `woa help agent --format markdown|json` without client brands, static bearer configuration, argv secrets, or server-injected commands.
- [x] 13.2 Implement a pure init state machine plus effect runner with typed actions/events, exact-version structured resume, atomic checkpoint, lease/CAS run version, signals, EPIPE, and idempotent reconciliation.
- [x] 13.3 Implement terminal capability detection, progressive `@clack/prompts@0.11.0` TUI, no-control `--plain` mode, and strict non-interactive behavior without alternate screen or scrollback clearing.
- [x] 13.4 Implement stable secret-free JSONL envelopes with discriminated type, sequence, run version, schema validation, pure stdout, fixed exit codes, and no prompts in Agent/pipe/CI modes.
- [x] 13.5 Replace echoed AppSecret/callback input with isolated human-only secure input and enforce restrictive, atomic local OAuth/checkpoint storage.
- [x] 13.6 Replace first-run client-specific config guidance with the generic `woa mcp descriptor`; retain any compatibility aliases outside Agent Help only if the ADR permits them.
- [x] 13.7 Add pseudo-TTY, plain, JSONL, signal, EPIPE, checkpoint, concurrent resume, secret-redaction, Node 18/20 and Agent Help contract tests.

## 14. Worker OAuth, init context, and idempotent backend

- [x] 14.1 Return RFC 9728 protected-resource metadata from unauthenticated `/mcp` and verify authorization-server metadata, DCR, PKCE, refresh and revocation behavior.
- [x] 14.2 Remove authenticated global default Tenant/account fallback, separate CLI/host grants, and enforce minimal init/MCP scopes fail closed.
- [x] 14.3 Add authenticated init context backed by trusted `WECHAT_EGRESS_IPS` with configuration versioning and no relay URL/token disclosure.
- [x] 14.4 Add short-lived same-Operator write-only credential handoff with hashed single-use token, clean URL, HttpOnly continuation, no-store/no-referrer, no third-party scripts, relay validation and stable allowlist errors.
- [x] 14.5 Add non-sensitive init run persistence with TTL, atomic/CAS transitions, authorization checks, and idempotent material/draft result records.
- [x] 14.6 Require a successful WeChat access-token probe through relay before allowlist verification and keep failed AppSecret validation non-persistent.
- [x] 14.7 Add tenant/account/tool/idempotency-key reuse for the onboarding test cover and draft so retries return the same media ID without publish.
- [x] 14.8 Add Worker/OAuth/init/tenant-isolation/allowlist/handoff/idempotency tests and secret-redaction assertions.

## 15. Stateless public Web handoff

- [x] 15.1 Move the authenticated overview from `/` to `/app` and implement a public root containing concrete business copy, one bootstrap prompt, one `复制给 Agent` action, a secret-safety note and secondary management/legal links.
- [x] 15.2 Ensure the public root renders without `/me`/health requests or authenticated navigation chrome and remains operable at 320px, 400% zoom, keyboard and screen reader modes.
- [x] 15.3 Add Clipboard success announcement and manual selection/Cmd-Ctrl-C fallback without focus loss or silent failure.
- [x] 15.4 Remove client-brand tabs/commands and Bearer examples from the primary MCP page/config model; expose only generic Streamable HTTP/OAuth descriptor facts and empty headers.
- [x] 15.5 Update SSR smoke, route/API tests and screenshots for public root, `/app`, clipboard fallback and generic MCP configuration.

## 16. End-to-end verification and release sequence

- [ ] 16.1 Verify host-native OAuth and MCP evidence separately from CLI login/probe: protected-resource discovery, host grant, initialize, tools/list, `woa_context`, and draft count.
- [x] 16.2 Verify user-confirmed, idempotent unpublished test cover/draft creation and read-back across timeout and host restart without duplicate side effects.
- [x] 16.3 Run OpenSpec validation, typecheck, lint, full tests, Web build, Worker dry-run, package content checks, and secret/client-brand/stdio regression searches.
- [x] 16.4 Run `npm pack` tarball smoke at the minimum supported Node 18 and Node 20 for import, TTY, plain, pipe/CI, JSONL, pause/signals, cursor restoration and exit codes.
- [ ] 16.5 Publish an exact provenance-enabled prerelease to `next`, validate the exact version, promote the same version to `latest`, verify `@latest` and integrity, and only then deploy the public root.
- [ ] 16.6 Run production smoke recording trusted egress configuration, relay allowlist token probe, redacted grants/request IDs and test-draft media ID without publishing.
