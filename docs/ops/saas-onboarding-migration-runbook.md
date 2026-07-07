# SaaS Onboarding Migration Runbook

- Prepared: 2026-07-06T16:14:12Z
- Change: `saas-onboarding`
- Production origin: `https://woa.ziikoo.app`

## Purpose

Run the SaaS onboarding migration and release checks without mixing local verification evidence with live production verification. This runbook records the accepted risks required by OpenSpec task 1.5 and keeps destructive/live steps explicit.

## Accepted risks

1. **Direct production D1 migration without required backup**
   - Product decision: direct migration is accepted for this release.
   - Operational guardrail: run additive migrations only; inspect SQL before applying; record the exact migration command and timestamp.
   - Known risk: unrecoverable D1 data loss remains possible if the production database state differs from fixtures.

2. **Live Stripe verification**
   - Product decision: Plus/Pro checkout and webhook smoke may use live Stripe mode.
   - Operational guardrail: treat every checkout, subscription, cancellation, downgrade, refund, and webhook as a real financial operation; record Stripe event IDs and tenant IDs.
   - Known risk: real charges/subscriptions can be created and must be cancelled/refunded manually if needed.

3. **Short WeChat API downtime**
   - Product decision: legacy secrets are purged/reconfiguration is required; short downtime is accepted.
   - Operational guardrail: do not inherit legacy AppSecret into the new public onboarding path; reconfigure AppID/AppSecret through the new onboarding path and verify article/image publish after reconfiguration.
   - Known risk: publishing/API operations may fail until a fresh credential validation succeeds through the platform relay.

## Pre-migration checklist

- [ ] Confirm Cloudflare account/project target and production Worker name.
- [ ] Confirm D1 database binding points at production `wechat-official-account-mcp-prod`.
- [ ] Confirm runtime business secrets are Cloudflare bindings/secrets, not GitHub CI secrets.
- [ ] Confirm `WECHAT_PROXY_URL` and relay allowlist are active.
- [ ] Confirm Stripe live product/price IDs and webhook secret are configured.
- [ ] Confirm Resend, Turnstile, GitHub OAuth, session/OAuth signing, and encryption secrets are configured before public signup.
- [ ] Capture `/health`, unauthenticated `/mcp`, authenticated `tools/list`, `woa_context`, `woa_account.status`, draft list, publish list, and Stripe webhook behavior before migration.

## 2026-07-07 safe readiness observation

Non-destructive production checks were run from the local operator shell at `2026-07-07T00:20Z`:

- `npx wrangler secret list` returned Cloudflare Worker secret bindings for OAuth, Stripe,
  WeChat credentials/webhook/encryption, and the WeChat relay (`WECHAT_PROXY_URL` /
  `WECHAT_PROXY_TOKEN`).
- Missing Cloudflare Worker secrets for the new email-first/GitHub public login surface:
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `TURNSTILE_SECRET_KEY`,
  `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`.
- `npx wrangler deploy --dry-run` succeeded and confirmed production bindings for
  `WECHAT_MCP_AGENT`, `TOKEN_OWNER`, `OAUTH_KV`, `DB`, `MEDIA`, `ASSETS`, and
  `ENVIRONMENT=production`.
- `https://woa.ziikoo.app/health` returned `200` with `mcpEndpoint: "/mcp"`.
- Unauthenticated `https://woa.ziikoo.app/mcp` returned `401` with a Bearer challenge.
- `https://woa.ziikoo.app/sse` returned the static Web SPA (`200`) before this run's fix;
  the Worker now explicitly returns `404` for removed `/sse` and `/messages` MCP-over-SSE
  paths and must be redeployed before the production smoke can be considered clean.
- Authenticated MCP, live Stripe checkout/webhook, production WeChat credential
  reconfiguration, and publish smoke were not run in this safe pass. Treat them as
  external-production blockers until a fresh operator-approved live run records evidence.

## Local verification before production

```bash
openspec validate saas-onboarding
npm run check
npm run lint
npm test
npx wrangler deploy --dry-run
```

## Production execution outline

1. Apply D1 migrations in order and record output.
2. Deploy Worker with assets and bindings.
3. Verify `/health` and OAuth challenge behavior on `/mcp`.
4. Run public login/session/OAuth consent smoke.
5. Configure a WeChat resource with fresh AppID/AppSecret through the new onboarding path.
6. Verify MCP `tools/list`, `woa_context`, account status, quota rejection, and session revocation.
7. Run live Stripe checkout/webhook/cancel or downgrade smoke and record event IDs.
8. Verify article and image/贴图 publish; confirm video publish remains explicitly unsupported.

## Rollback / containment

- If Worker deploy fails, rollback to the previous Worker version from Cloudflare deployment history.
- If D1 migration causes incompatibility, stop writes and restore from available D1 export/snapshot if one exists; no required backup is assumed by this release decision.
- If Stripe live smoke creates unintended subscriptions, cancel/refund in Stripe and record the event IDs.
- If WeChat credential validation fails due to relay/IP allowlist, keep the resource unconfigured and fix relay configuration before retrying.
