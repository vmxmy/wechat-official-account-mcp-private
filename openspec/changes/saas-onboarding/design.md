## Context

The Worker already exposes OAuth-protected Streamable HTTP MCP at `/mcp`, management REST under `/api/v1`, D1/R2/Durable Object infrastructure, a usage-quota foundation, Stripe billing scaffolding, and a minimal React/Vite frontend. However, the current identity model is still effectively an operator/password gate with default tenant/account compatibility, and several tenant/account create/update surfaces return placeholder responses.

The target product is a hosted SaaS at `https://woa.ziikoo.app` where an Operator can register publicly, receive an isolated Tenant, configure one or more WeChat Official Account resources according to subscription plan, and use Web, CLI, and MCP entrypoints against the same backend authority.

## Goals / Non-Goals

**Goals:**

- Make REST/OAuth/D1/Stripe the source of truth for onboarding; Web, CLI, and MCP are entrypoints over the same use cases.
- Support public email-code-first login with optional GitHub login, Turnstile protection, sessions, OAuth consent, and revocation.
- Bootstrap a default Tenant and unconfigured WeChat Official Account resource on first login.
- Replace onboarding placeholders with real persistent Tenant/WeChat resource/config/status/billing operations.
- Validate WeChat AppID/AppSecret before activating a resource and route validation through the platform HTTPS relay.
- Enforce Free/Plus/Pro allowances consistently across Web, CLI, MCP, and REST.
- Ship a minimal Astryx/TanStack Web entrypoint with anti-AI-slop visual/copy acceptance.
- Keep the CLI remote-only and publish it as `@ziikoo/woa` with the `woa` command.
- Make the public onboarding handoff Agent-first while keeping the actual workflow versioned inside the CLI.
- Provide a single resumable `woa init` state machine with progressive human TUI, plain-text accessibility mode, and strict JSONL Agent mode.
- Prove the current WeChat relay IP allowlist, host-native OAuth/MCP initialization, read-only WeChat access, and an idempotent unpublished test draft before claiming end-to-end completion.
- Remove legacy shared-password authorization and purge legacy WeChat secrets during migration.

**Non-Goals:**

- Full WeChat operations dashboard in Web; operations remain MCP/CLI/API-first.
- Team invitations, multi-role RBAC UI, or multi-Operator collaboration in the first release.
- Public third-party REST API product commitments beyond the internal stable API used by entrypoints.
- Local MCP server, stdio transport, SSE transport, local SQLite, local filePath uploads, or `mcp-remote` bridge documentation.
- Video publishing; the first release supports article and image/贴图 publishing only.
- Annual billing, usage-based overage billing, or invitation-only signup.

## Decisions

### Backend authority and entrypoints

REST/OAuth/D1/Stripe is the source of truth. Web uses HttpOnly session cookies; CLI and MCP use OAuth bearer/refresh tokens. MCP is authorized post-login management and operations, not the unauthenticated signup entrypoint. This keeps registration, billing, account configuration, and quotas consistent across entrypoints.

### Identity and OAuth

Email code login is the primary public identity path. GitHub remains a first-release optional provider. Email login uses six-digit codes that expire after 10 minutes or 5 failed attempts, sent through Resend, and protected by Turnstile in both Web and CLI browser authorization flows. GitHub identities link by verified email; if GitHub lacks verified email, the Operator must complete email-code verification.

Dynamic public OAuth clients are allowed for CLI/MCP with PKCE and redirect URI validation. The Web entrypoint uses a fixed confidential client/session model. Dynamic CLI/MCP authorization shows a consent page with requested scopes and remembers consent until revocation. Access tokens last 8 hours; rotating, revocable refresh tokens last 180 days; dynamic client registrations last 365 days. Web sessions are HttpOnly, sliding 7-day sessions. No flow introduces a non-expiring bearer token.

### Tenant and WeChat resource model

First login creates a default Tenant and one unconfigured WeChat Official Account resource. Tenants are single-owner in the first release; team invites and RBAC UI are deferred. WeChat resources use opaque public IDs, support rename, can be soft-deleted, and release their AppID after deletion. Active WeChat AppIDs are globally unique across tenants. Each Tenant has a default WeChat resource used for implicit account resolution, and Web/CLI/MCP can change that default.

Credential configuration is available from Web, CLI, and authorized MCP. Submitted credentials are validated by obtaining a WeChat access token before activation. Failed credentials are not persisted. Webhook Token/EncodingAESKey configuration is optional during onboarding and required only before inbox/inbound features are used.

### Billing and quotas

Subscriptions bind to Tenants. Free is automatic and requires no payment method. Plus is $9/month and Pro is $29/month in Stripe live mode, monthly only. Stripe Customer records are per Tenant and use the owner Operator verified email. Checkout is initiated by Web or CLI; MCP returns upgrade guidance but does not create Checkout sessions.

Account allowances are Free 1, Plus 3, Pro 10. Successful published-content allowances are Free 30, Plus 300, Pro 3000 per period. Tool-call allowances are Free 300, Plus 3000, Pro 30000 per period. Paid periods follow Stripe billing periods; Free uses the Tenant creation anniversary. Failed publish attempts count against tool-call allowance but not successful published-content allowance. Over-quota operations are rejected before calling WeChat and include reset/upgrade guidance. Downgrades apply at period end and lock excess resources without deleting data.

### Web architecture

The Web entrypoint moves to `web/`, builds to `web/dist`, and is served as Worker assets. Dependencies remain in the root `package.json`. The Web uses Astryx as the required design system, TanStack Router file-based routing generated with the Vite plugin, a central `AppLink` adapter passed to Astryx `LinkProvider`, TanStack Query for server state, native forms plus Zod for validation, and shared TypeScript/Zod API boundaries.

React Router is removed when TanStack Router is adopted. Tailwind UI usage is removed from the Web surface. The initial Web route set covers login, onboarding, billing, MCP config, security sessions, Terms, and Privacy. Auth guards redirect unauthenticated requests to login with `returnTo`.

### Agent-first onboarding contract

The public `/` route is a stateless handoff page, not an onboarding state machine. It contains a concrete business explanation, one bootstrap prompt, one `复制给 Agent` action, a secret-safety note, and secondary management/legal links. It does not require login, fetch `/me` or health, poll connection state, render client-brand tabs, or claim that copying configuration completes MCP setup. The existing authenticated overview moves to `/app`.

`woa help agent` is the only versioned, offline Agent workflow source. It is generated from one structured manifest bundled with the exact CLI package and contains no client-specific adapter, static Bearer header, argv secret, or executable instruction derived from server text. The site and README only bootstrap that command.

`woa init` is the only first-run orchestration entrypoint. A direct interactive invocation uses a progressive prompt TUI that preserves terminal scrollback; `--plain` provides an ASCII/no-control accessibility path; `--agent --format jsonl` and all non-TTY/CI execution emit strict, secret-free JSONL without prompts. State, effect runner, TUI renderer, JSONL renderer, terminal capability detection, and secure input are separate modules. The same state fixtures drive every renderer.

Each init run has a non-secret `runId`, monotonic `sequence`, CAS `runVersion`, atomic checkpoint, and exact-package structured resume data. User pause exits successfully after checkpoint; signals restore cursor/raw mode/echo and preserve signal exit semantics. A `runId` never replaces current Operator/Tenant/account authorization.

The CLI reads current relay egress IPs from trusted deployment configuration, asks the user to add all of them to the target WeChat account allowlist, and then proves the change through a relay access-token request. A checkbox or Enter key is not completion evidence. AppID/AppSecret entry occurs through a short-lived same-Operator HTTPS write-only handoff or a no-echo terminal path used only by a directly operating human; Agent/JSONL/pipe/CI paths never read those secrets.

CLI OAuth and the target host's MCP OAuth are separate grants. Host support requires standards-based protected-resource discovery, PKCE and refresh tokens; no static token fallback is allowed. CLI protocol probes are diagnostic only. Host success requires the host's own OAuth grant, MCP initialization, `woa_context`, and `wechat_draft(action=count)` call. After explicit user confirmation, the host creates and reads back one unpublished test draft under an idempotency key; it never publishes or silently duplicates the draft.

### Anti-slop and frontend acceptance

`docs/design/anti-ai-slop-rules.md` is part of Web acceptance. Web work must run Astryx dense docs before component work, use Astryx templates/components before custom JSX, keep copy concrete and Chinese-first, avoid AI SaaS visual tropes, and provide screenshots for critical page review. Tests cover API/viewmodel boundaries, route guards, and critical page smoke; browser E2E is deferred.

### Operations and migration

Production origin is `https://woa.ziikoo.app`. Runtime secrets live in Cloudflare; GitHub CI only holds deployment credentials. WeChat API egress uses a platform HTTPS relay. Public signup opens directly, and the first successful Operator login may claim the legacy default tenant shell, but legacy WeChat secrets are purged during migration and not inherited. A short WeChat API downtime during reconfiguration is accepted. D1 migration is direct without a required backup by explicit product-owner decision.

## Risks / Trade-offs

- **Public first-login claim race** → Legacy WeChat secrets are purged and not inherited, so a wrong first login cannot control the existing公众号 without fresh credentials.
- **No required D1 backup** → Direct migration is faster but risks unrecoverable production data loss; implementation must keep migration SQL small, forward-only, and reviewable.
- **Live Stripe production verification** → Smoke tests can create real payments/subscriptions; test scripts and runbooks must treat checkout/cancel/refund as real operations.
- **Email-first public signup abuse** → Turnstile, IP/email/provider rate limits, quotas, and audit logging reduce abuse surface.
- **D1 `enc:` secret storage** → Simpler than per-tenant Cloudflare Secrets but depends on `WECHAT_MCP_SECRET_KEY`; secret rotation must be planned separately.
- **MCP native HTTP only** → Some clients may not work without bridge tooling; first-release support intentionally favors the clean Streamable HTTP/OAuth contract.
- **Astryx/TanStack adoption** → Adds frontend dependencies and migration work; dense-doc and screenshot gates reduce UI slop and API drift.

## Migration Plan

1. Add D1 schema and repositories for Operators, identities, verification codes, sessions, OAuth clients/consents/tokens, tenant ownership, WeChat resources, subscription state, quota counters, audit logs, and retention metadata.
2. Implement identity/OAuth/session routes with email-code-first login, optional GitHub login, Turnstile, consent, revocation, and Web session cookies.
3. Implement first-login Tenant/resource bootstrap and direct migration that purges legacy WeChat secrets.
4. Replace placeholder tenant/resource create/update/configure/status paths with real persisted use cases and account-scoped WeChat client creation.
5. Implement Stripe Tenant billing, live monthly prices, checkout from Web/CLI, webhook entitlement updates, quota periods, and downgrade locking.
6. Build the Astryx/TanStack Web entrypoint under `web/` and configure Worker static assets from `web/dist`.
7. Update the remote-only CLI package metadata and commands for login, configure, status, billing checkout, MCP config, and account/default selection.
8. Update MCP management tools to use real tenant/resource store and quota/upgrade responses.
9. Run typecheck, lint, tests, OpenSpec validation, Worker dry-run, Web screenshots, and direct production smoke checks.
10. Publish and verify an exact CLI prerelease before moving the same version to `latest`; deploy the public bootstrap page only after the `@latest` smoke passes.

## Open Questions

None. The grilling session locked the baseline decisions; future changes require explicit new decisions or a new OpenSpec delta.
