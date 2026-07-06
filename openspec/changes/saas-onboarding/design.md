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

Dynamic public OAuth clients are allowed for CLI/MCP with PKCE and redirect URI validation. The Web entrypoint uses a fixed confidential client/session model. Dynamic CLI/MCP authorization shows a consent page with requested scopes and remembers consent until revocation. Access tokens last 1 hour; refresh tokens last 30 days and are revocable. Web sessions are HttpOnly, sliding 7-day sessions.

### Tenant and WeChat resource model

First login creates a default Tenant and one unconfigured WeChat Official Account resource. Tenants are single-owner in the first release; team invites and RBAC UI are deferred. WeChat resources use opaque public IDs, support rename, can be soft-deleted, and release their AppID after deletion. Active WeChat AppIDs are globally unique across tenants. Each Tenant has a default WeChat resource used for implicit account resolution, and Web/CLI/MCP can change that default.

Credential configuration is available from Web, CLI, and authorized MCP. Submitted credentials are validated by obtaining a WeChat access token before activation. Failed credentials are not persisted. Webhook Token/EncodingAESKey configuration is optional during onboarding and required only before inbox/inbound features are used.

### Billing and quotas

Subscriptions bind to Tenants. Free is automatic and requires no payment method. Plus is $9/month and Pro is $29/month in Stripe live mode, monthly only. Stripe Customer records are per Tenant and use the owner Operator verified email. Checkout is initiated by Web or CLI; MCP returns upgrade guidance but does not create Checkout sessions.

Account allowances are Free 1, Plus 3, Pro 10. Successful published-content allowances are Free 30, Plus 300, Pro 3000 per period. Tool-call allowances are Free 300, Plus 3000, Pro 30000 per period. Paid periods follow Stripe billing periods; Free uses the Tenant creation anniversary. Failed publish attempts count against tool-call allowance but not successful published-content allowance. Over-quota operations are rejected before calling WeChat and include reset/upgrade guidance. Downgrades apply at period end and lock excess resources without deleting data.

### Web architecture

The Web entrypoint moves to `web/`, builds to `web/dist`, and is served as Worker assets. Dependencies remain in the root `package.json`. The Web uses Astryx as the required design system, TanStack Router file-based routing generated with the Vite plugin, a central `AppLink` adapter passed to Astryx `LinkProvider`, TanStack Query for server state, native forms plus Zod for validation, and shared TypeScript/Zod API boundaries.

React Router is removed when TanStack Router is adopted. Tailwind UI usage is removed from the Web surface. The initial Web route set covers login, onboarding, billing, MCP config, security sessions, Terms, and Privacy. Auth guards redirect unauthenticated requests to login with `returnTo`.

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

## Open Questions

None. The grilling session locked the baseline decisions; future changes require explicit new decisions or a new OpenSpec delta.
