# SaaS Onboarding Preflight Review

- Review timestamp: 2026-07-06T16:14:12Z
- OpenSpec change: `saas-onboarding`
- Scope: `CONTEXT.md`, `docs/adr/0001-*.md` through `docs/adr/0117-*.md`, and `docs/design/anti-ai-slop-rules.md`.

## Outcome

This review locks the implementation constraints for the current SaaS onboarding branch:

1. Cloudflare Workers remains the only production MCP runtime; no local stdio, SSE, SQLite, Node/Axios executor, or `filePath` media upload path is restored.
2. REST/OAuth/D1/Stripe are the backend authority; Web, CLI, and MCP are entrypoints over the same tenant/resource/quota concepts.
3. Public onboarding is email-code-first with GitHub optional; legacy shared-password OAuth remains a tracked blocker until fully removed.
4. Free/Plus/Pro limits stay aligned with OpenSpec: accounts 1/3/10, tool calls 300/3000/30000, published content 30/300/3000 where implemented.
5. The Web entrypoint must use Astryx + TanStack Router + TanStack Query and avoid the anti-slop visual/copy patterns documented in `docs/design/anti-ai-slop-rules.md`.
6. Production-only verification gates remain separate from local implementation evidence: live Stripe, production WeChat credential reconfiguration, and deployed OAuth/MCP smoke are not considered completed without live run logs.

## Files reviewed

- `CONTEXT.md` — product/domain context and implementation constraints.
- `docs/design/anti-ai-slop-rules.md` — mandatory visual/copy acceptance constraints for the SaaS Web entrypoint.

## ADR inventory reviewed

- `docs/adr/0001-saas-onboarding-entrypoints.md` — Use REST as the onboarding authority with Web, CLI, and MCP entrypoints
- `docs/adr/0002-use-github-login-with-email-fallback.md` — Use email code login first with GitHub as an optional provider
- `docs/adr/0003-bootstrap-default-tenant-and-unconfigured-wechat-resource.md` — Bootstrap a default tenant and unconfigured WeChat resource on first login
- `docs/adr/0004-defer-team-invites-while-preserving-tenant-isolation.md` — Defer team invites while preserving tenant isolation
- `docs/adr/0005-limit-wechat-resources-by-subscription-plan.md` — Limit WeChat resources by subscription plan
- `docs/adr/0006-count-monthly-publish-allowance-on-successful-publish.md` — Count monthly publish allowance on successful publish
- `docs/adr/0007-meter-total-tool-calls-in-addition-to-publishes.md` — Meter total tool calls in addition to successful publishes
- `docs/adr/0008-bind-subscriptions-to-tenants.md` — Bind subscriptions to tenants
- `docs/adr/0009-activate-free-plan-without-payment-method.md` — Activate the Free plan without a payment method
- `docs/adr/0010-allow-credential-configuration-from-all-entrypoints.md` — Allow credential configuration from Web, CLI, and MCP
- `docs/adr/0011-validate-wechat-credentials-before-activation.md` — Validate WeChat credentials before activation
- `docs/adr/0012-use-a-platform-https-relay-for-wechat-api-egress.md` — Use a platform HTTPS relay for WeChat API egress
- `docs/adr/0013-make-wechat-webhook-configuration-optional-during-onboarding.md` — Make WeChat webhook configuration optional during onboarding
- `docs/adr/0014-distribute-remote-only-woa-cli-through-npm.md` — Distribute the remote-only woa CLI through npm
- `docs/adr/0015-use-cli-login-as-first-registration.md` — Use CLI login as first registration
- `docs/adr/0016-allow-mcp-account-creation-but-not-tenant-creation.md` — Allow MCP account creation but not tenant creation in the first release
- `docs/adr/0017-use-httponly-web-sessions-and-bearer-tokens-for-non-web-clients.md` — Use HttpOnly Web sessions and bearer tokens for non-Web clients
- `docs/adr/0018-use-resend-for-email-identity-fallback.md` — Use Resend for email identity fallback
- `docs/adr/0019-link-operator-identities-by-verified-email.md` — Link Operator identities by verified email
- `docs/adr/0020-use-opaque-public-resource-identifiers.md` — Use opaque public resource identifiers
- `docs/adr/0021-assign-legacy-default-tenant-to-the-owner-operator.md` — Assign the legacy default tenant shell to the first Operator without inheriting secrets
- `docs/adr/0022-remove-legacy-oauth-password-authorization-on-new-identity-launch.md` — Remove legacy OAuth password authorization on new identity launch
- `docs/adr/0023-allow-dynamic-public-oauth-clients-with-pkce.md` — Allow dynamic public OAuth clients with PKCE
- `docs/adr/0024-grant-full-owner-scopes-in-the-first-release.md` — Grant full owner scopes in the first release
- `docs/adr/0025-require-explicit-confirmation-only-for-delete-operations.md` — Require explicit confirmation only for delete operations
- `docs/adr/0026-retain-key-audit-logs-for-180-days.md` — Retain key audit logs for 180 days
- `docs/adr/0027-store-tenant-wechat-secrets-encrypted-in-d1.md` — Store tenant WeChat secrets encrypted in D1
- `docs/adr/0028-mark-onboarding-complete-after-first-validated-wechat-resource.md` — Mark onboarding complete after the first validated WeChat resource
- `docs/adr/0029-ship-a-minimal-web-entrypoint-not-a-full-dashboard.md` — Ship a minimal Web entrypoint, not a full dashboard
- `docs/adr/0030-lock-excess-wechat-resources-after-plan-downgrade.md` — Lock excess WeChat resources after plan downgrade
- `docs/adr/0031-support-article-and-image-publishing-in-the-first-release.md` — Support article and image publishing in the first release
- `docs/adr/0032-do-not-embed-oauth-tokens-in-generated-mcp-config.md` — Do not embed OAuth tokens in generated MCP config
- `docs/adr/0033-soft-delete-wechat-resources-and-purge-secrets.md` — Soft-delete WeChat resources and purge secrets
- `docs/adr/0034-support-request-based-operator-deletion-in-the-first-release.md` — Support request-based Operator deletion in the first release
- `docs/adr/0035-implement-the-backend-source-of-truth-before-entrypoints.md` — Implement the backend source of truth before entrypoints
- `docs/adr/0036-verify-onboarding-directly-in-production.md` — Verify onboarding directly in production
- `docs/adr/0037-store-runtime-secrets-in-cloudflare-and-limit-ci-secrets-to-deploy.md` — Store runtime secrets in Cloudflare and limit CI secrets to deploy
- `docs/adr/0038-price-plus-at-9-and-pro-at-29-monthly.md` — Price Plus at $9/month and Pro at $29/month
- `docs/adr/0039-support-monthly-subscriptions-only-in-the-first-release.md` — Support monthly subscriptions only in the first release
- `docs/adr/0040-apply-subscription-downgrades-at-period-end.md` — Apply subscription downgrades at period end
- `docs/adr/0041-meter-usage-by-billing-period-with-free-tenant-anniversary.md` — Meter usage by billing period with Free tenant anniversary
- `docs/adr/0042-use-turnstile-and-rate-limits-for-public-signup.md` — Use Turnstile and rate limits for public signup
- `docs/adr/0043-treat-rest-as-an-internal-stable-api-for-entrypoints.md` — Treat REST as an internal stable API for entrypoints
- `docs/adr/0044-generate-default-resource-names-from-the-operator-display-name.md` — Generate default resource names from the Operator display name
- `docs/adr/0045-support-renaming-wechat-resources-but-defer-tenant-renaming.md` — Support renaming WeChat resources but defer tenant renaming
- `docs/adr/0046-use-a-tenant-default-wechat-resource-for-implicit-account-resolution.md` — Use a tenant default WeChat resource for implicit account resolution
- `docs/adr/0047-do-not-persist-invalid-wechat-secrets.md` — Do not persist invalid WeChat secrets
- `docs/adr/0048-prioritize-the-hosted-saas-over-self-hosting.md` — Prioritize the hosted SaaS over self-hosting
- `docs/adr/0049-use-woa-ziikoo-app-as-the-production-origin.md` — Use woa.ziikoo.app as the production origin
- `docs/adr/0050-publish-the-cli-package-as-ziikoo-woa.md` — Publish the CLI package as @ziikoo/woa
- `docs/adr/0051-require-removal-of-the-old-npm-package.md` — Require removal of the old npm package
- `docs/adr/0052-keep-the-source-repository-private-for-the-first-public-package.md` — Keep the source repository private for the first public package
- `docs/adr/0053-keep-the-public-npm-package-under-mit.md` — Keep the public npm package under MIT
- `docs/adr/0054-support-only-native-streamable-http-mcp-clients.md` — Support only native Streamable HTTP MCP clients
- `docs/adr/0055-use-chinese-first-product-documentation.md` — Use Chinese-first product documentation
- `docs/adr/0056-sync-grilling-decisions-into-openspec-before-implementation.md` — Sync grilling decisions into OpenSpec before implementation
- `docs/adr/0057-create-a-dedicated-saas-onboarding-openspec-change.md` — Create a dedicated SaaS onboarding OpenSpec change
- `docs/adr/0058-do-not-ship-placeholder-onboarding-operations.md` — Do not ship placeholder onboarding operations
- `docs/adr/0059-use-auth-github-callback-for-github-login.md` — Use /auth/github/callback for GitHub login
- `docs/adr/0060-use-six-digit-email-codes-for-email-fallback-login.md` — Use six-digit email codes for fallback login
- `docs/adr/0061-expire-email-login-codes-after-ten-minutes-and-five-attempts.md` — Expire email login codes after ten minutes and five attempts
- `docs/adr/0062-reject-over-quota-operations-before-wechat-api-calls.md` — Reject over-quota operations before WeChat API calls
- `docs/adr/0063-count-failed-publish-attempts-against-tool-call-allowance.md` — Count failed publish attempts against tool-call allowance
- `docs/adr/0064-support-server-side-session-and-token-revocation.md` — Support server-side session and token revocation
- `docs/adr/0065-use-one-hour-access-tokens-and-thirty-day-refresh-tokens.md` — Use one-hour access tokens and thirty-day refresh tokens
- `docs/adr/0066-use-seven-day-sliding-web-sessions.md` — Use seven-day sliding Web sessions
- `docs/adr/0067-ship-minimal-terms-and-privacy-pages-for-public-signup.md` — Ship minimal Terms and Privacy pages for public signup
- `docs/adr/0068-use-support-ziikoo-app-as-the-public-support-contact.md` — Use support@ziikoo.app as the public support contact
- `docs/adr/0069-monitor-errors-auth-credential-stripe-and-quota-signals.md` — Monitor errors, auth, credential, Stripe, and quota signals
- `docs/adr/0070-open-public-signup-with-abuse-controls.md` — Open public signup with abuse controls
- `docs/adr/0071-do-not-let-mcp-create-stripe-checkout-sessions.md` — Do not let MCP create Stripe Checkout sessions
- `docs/adr/0072-open-and-print-stripe-checkout-urls-from-the-cli.md` — Open and print Stripe Checkout URLs from the CLI
- `docs/adr/0073-use-the-operator-verified-email-for-stripe-customers.md` — Use the Operator verified email for Stripe Customers
- `docs/adr/0074-create-one-stripe-customer-per-tenant.md` — Create one Stripe Customer per tenant
- `docs/adr/0075-verify-stripe-with-live-mode-in-production.md` — Verify Stripe with live mode in production
- `docs/adr/0076-let-the-first-operator-login-claim-the-legacy-default-tenant.md` — Let the first Operator login claim the legacy default tenant
- `docs/adr/0077-open-signup-directly-despite-first-login-legacy-claim-risk.md` — Open signup directly despite first-login legacy claim risk
- `docs/adr/0078-do-not-inherit-legacy-wechat-secrets-during-first-login-claim.md` — Do not inherit legacy WeChat secrets during first-login claim
- `docs/adr/0079-purge-legacy-wechat-secrets-during-identity-migration.md` — Purge legacy WeChat secrets during identity migration
- `docs/adr/0080-accept-short-wechat-api-downtime-during-identity-migration.md` — Accept short WeChat API downtime during identity migration
- `docs/adr/0081-accept-direct-d1-migration-without-backup.md` — Accept direct D1 migration without backup
- `docs/adr/0082-show-consent-for-dynamic-cli-and-mcp-oauth-clients.md` — Show consent for dynamic CLI and MCP OAuth clients
- `docs/adr/0083-remember-oauth-consent-until-revoked.md` — Remember OAuth consent until revoked
- `docs/adr/0084-include-a-minimal-web-security-sessions-page.md` — Include a minimal Web security sessions page
- `docs/adr/0085-require-email-code-completion-when-github-lacks-a-verified-email.md` — Require email code completion when GitHub lacks a verified email
- `docs/adr/0086-enforce-global-uniqueness-for-active-wechat-appids.md` — Enforce global uniqueness for active WeChat AppIDs
- `docs/adr/0087-release-wechat-appids-after-resource-deletion.md` — Release WeChat AppIDs after resource deletion
- `docs/adr/0088-retain-r2-media-inputs-for-thirty-days.md` — Retain R2 media inputs for thirty days
- `docs/adr/0089-retain-inbound-messages-for-ninety-days.md` — Retain inbound messages for ninety days
- `docs/adr/0090-keep-all-tools-visible-to-free-tenants.md` — Keep all tools visible to Free tenants
- `docs/adr/0091-use-astryx-as-the-required-web-design-system.md` — Use Astryx as the required Web design system
- `docs/adr/0092-add-astryx-core-and-cli-as-project-dependencies.md` — Add Astryx core and CLI as project dependencies
- `docs/adr/0093-remove-tailwind-from-the-saas-web-ui-surface.md` — Remove Tailwind from the SaaS Web UI surface
- `docs/adr/0094-adopt-zhiyun-style-anti-ai-slop-rules-for-the-woa-web.md` — Adopt zhiyun-style anti-AI-slop rules for the WOA Web
- `docs/adr/0095-require-astryx-dense-docs-before-web-component-work.md` — Require Astryx dense docs before Web component work
- `docs/adr/0096-use-tanstack-router-for-the-web-entrypoint.md` — Use TanStack Router for the Web entrypoint
- `docs/adr/0097-remove-react-router-when-adopting-tanstack-router.md` — Remove React Router when adopting TanStack Router
- `docs/adr/0098-use-tanstack-router-file-based-routing.md` — Use TanStack Router file-based routing
- `docs/adr/0099-generate-tanstack-file-routes-with-the-vite-plugin.md` — Generate TanStack file routes with the Vite plugin
- `docs/adr/0100-use-a-central-applink-adapter-for-astryx-and-tanstack-router.md` — Use a central AppLink adapter for Astryx and TanStack Router
- `docs/adr/0101-use-tanstack-query-for-web-server-state.md` — Use TanStack Query for Web server state
- `docs/adr/0102-use-native-forms-with-zod-for-web-onboarding.md` — Use native forms with Zod for Web onboarding
- `docs/adr/0103-use-shared-types-and-zod-boundaries-for-the-web-api-client.md` — Use shared types and Zod boundaries for the Web API client
- `docs/adr/0104-test-web-viewmodels-api-client-and-critical-page-smoke.md` — Test Web viewmodels, API client boundaries, and critical page smoke
- `docs/adr/0105-require-screenshot-review-for-web-anti-slop-acceptance.md` — Require screenshot review for Web anti-slop acceptance
- `docs/adr/0106-move-the-saas-web-entrypoint-into-a-web-directory.md` — Move the SaaS Web entrypoint into a web directory
- `docs/adr/0107-serve-web-dist-as-cloudflare-worker-assets.md` — Serve web/dist as Cloudflare Worker assets
- `docs/adr/0108-manage-web-dependencies-from-the-root-package.md` — Manage Web dependencies from the root package
- `docs/adr/0109-use-a-restrained-ziikoo-semantic-astryx-theme.md` — Use a restrained Ziikoo semantic Astryx theme
- `docs/adr/0110-ship-login-onboarding-billing-mcp-security-and-legal-web-routes.md` — Ship login, onboarding, billing, MCP, security, and legal Web routes
- `docs/adr/0111-redirect-unauthenticated-web-routes-to-login-with-returnto.md` — Redirect unauthenticated Web routes to login with returnTo
- `docs/adr/0112-prioritize-email-code-login-in-the-web-login-ui.md` — Prioritize email code login in the Web login UI
- `docs/adr/0113-revise-identity-priority-to-email-first.md` — Revise identity priority to email first
- `docs/adr/0114-use-email-first-login-for-the-cli-browser-authorization-flow.md` — Use email-first login for the CLI browser authorization flow
- `docs/adr/0115-keep-github-login-in-the-first-release-as-an-optional-provider.md` — Keep GitHub login in the first release as an optional provider
- `docs/adr/0116-require-turnstile-for-email-code-requests-in-web-and-cli-oauth-flows.md` — Require Turnstile for email code requests in Web and CLI OAuth flows
- `docs/adr/0117-include-chinese-copy-in-anti-slop-acceptance.md` — Include Chinese copy in anti-slop acceptance

## Follow-up blockers preserved

- Remove legacy shared-password authorization only after the email/GitHub identity flow and consent pages are actually wired end-to-end.
- Do not mark production smoke, live Stripe, or production WeChat verification tasks complete until dated logs are captured.
- Do not mark screenshot/visual review complete until screenshot artifacts are stored or linked.
