## Why

The hosted WOA service needs a real public SaaS onboarding loop: an operator should be able to sign in, receive an isolated tenant, configure a WeChat Official Account, upgrade a subscription, and connect MCP/CLI without manual database or secret work. The current runtime has OAuth-protected MCP/REST surfaces and partial tenant/account/billing foundations, but registration, persistent tenant/account provisioning, and Web/CLI/MCP onboarding are not yet a complete product path.

## What Changes

- Add public Operator login with email-code-first identity, optional GitHub login, Turnstile protection, server-side sessions, OAuth consent, token/session revocation, and first-login onboarding bootstrap.
- Add real persistent tenant and WeChat Official Account resource creation/configuration/status flows; placeholder create/update responses are not acceptable in the onboarding path.
- Add subscription plans and Stripe live-mode monthly billing for Free/Plus/Pro, including account allowances, published-content allowances, tool-call allowances, checkout from Web/CLI, webhook-driven plan changes, and downgrade locking.
- Add a minimal Astryx-based Web entrypoint under `web/` using TanStack Router file routes, TanStack Query, native forms with Zod, and anti-AI-slop visual/copy acceptance.
- Extend the remote-only npm CLI as `@ziikoo/woa` / `woa` so `woa login` can first-register an Operator, configure resources, open Stripe checkout, and print native Streamable HTTP MCP config without storing WeChat secrets locally.
- Add Agent-first onboarding: the public site hands one bootstrap prompt to any capable Agent; the versioned workflow ships inside the CLI as `woa help agent`; `woa init` orchestrates a resumable human TUI or a strict JSONL protocol without client-specific adapters.
- Require the user to complete only identity/consent, the current WeChat relay egress IP allowlist, secure AppSecret entry, and confirmation of an idempotent unpublished test draft. Completion requires real relay and host MCP evidence rather than a copied URL or user checkbox.
- Extend MCP management tools so authorized Operators can inspect context, create/configure/status WeChat resources within their tenant, and receive upgrade guidance, while MCP does not create Stripe checkout sessions.
- **BREAKING**: Remove the legacy shared authorization-password login path when the new identity system launches; existing CLI/MCP clients must re-authorize.
- **BREAKING**: Purge legacy WeChat secrets during identity migration; production WeChat API operations may be unavailable until credentials are reconfigured through the new onboarding flow.
- **BREAKING**: Official first-release MCP client support is native Streamable HTTP/OAuth only; local MCP/SSE/stdio and `mcp-remote` bridge documentation are not restored.

## Capabilities

### New Capabilities
- `public-identity-onboarding`: Operator login, registration, sessions, OAuth client consent, token revocation, and first-login tenant bootstrap.
- `tenant-wechat-resource-onboarding`: Tenant-owned WeChat Official Account resource creation, default resource resolution, credential validation, deletion, AppID uniqueness, and webhook optionality.
- `subscription-billing-quotas`: Free/Plus/Pro plan behavior, Stripe monthly subscriptions, quota periods, account allowances, published-content allowance, and tool-call allowance enforcement.
- `astryx-web-entrypoint`: Minimal Web routes, Astryx/TanStack frontend architecture, anti-AI-slop acceptance, and Web auth/session behavior.
- `remote-cli-onboarding`: npm-distributed remote-only CLI registration/login, account configuration, billing checkout, MCP config generation, and safety behavior.
- `mcp-management-onboarding`: Authorized MCP management tools for context/resource onboarding and plan-limit guidance.
- `saas-security-operations`: Secret storage, audit retention, rate limits, Turnstile, legal/support pages, monitoring, retention, and migration guardrails.
- `agent-guided-onboarding`: Versioned CLI Agent Help, resumable init state, progressive TUI/JSONL renderers, secure human handoffs, host-native OAuth/MCP proof, and idempotent test-draft verification.

### Modified Capabilities

- None; this change introduces a new SaaS onboarding contract and references existing multi-tenant/usage-quota work as implementation foundations.

## Impact

- Worker runtime: OAuth provider, Web session routes, GitHub/email identity flows, Turnstile verification, management REST routes, Stripe webhook/checkout routes, static asset serving, and migration behavior.
- Storage: D1 tables/repositories for operators, identities, sessions, OAuth clients/consents/tokens, tenants, memberships, WeChat resources, subscriptions, entitlements, counters, audit logs, verification codes, and retention jobs.
- MCP: management tools and quota enforcement must use the real tenant/account store, not default-only placeholder context.
- CLI: package metadata changes to `@ziikoo/woa`, remote login/onboarding/billing/config commands, token storage, and MCP config generation.
- CLI onboarding protocol: new state-machine/effect/renderer boundaries, terminal capability handling, exact-version resume, and secret-free JSONL events.
- Web: move frontend to `web/`, add Astryx/TanStack dependencies, remove React Router/Tailwind UI usage, and build `web/dist` as Worker assets.
- Operations: production origin `https://woa.ziikoo.app`, Cloudflare runtime secrets, live Stripe prices ($9 Plus / $29 Pro monthly), platform HTTPS relay, public signup, no required D1 backup, and direct production verification.
