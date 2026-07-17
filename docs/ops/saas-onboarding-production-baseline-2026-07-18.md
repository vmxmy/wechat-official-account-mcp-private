# SaaS onboarding production baseline — 2026-07-18

Captured against `https://woa.ziikoo.app` before the Agent-first onboarding implementation. All probes were read-only except an unsigned Stripe webhook request that was expected to be rejected. Tokens, complete callback URLs, secrets, email addresses, account IDs, media IDs, titles, and article URLs are omitted.

| Surface | Result | Baseline evidence |
|---|---|---|
| `GET /api/health` | HTTP 200 | Worker runtime, `/mcp`, and WeChat callback paths reported healthy |
| unauthenticated `POST /mcp` initialize | HTTP 401 | `WWW-Authenticate` was only `Bearer realm="wechat-official-account-mcp"`; RFC 9728 `resource_metadata` was absent and remains a P0 migration target |
| authenticated MCP initialize + `tools/list` | success | Native Streamable HTTP session connected and listed 27 tools |
| `woa_context` | success | Returned current Operator/Tenant/account/plan/scope context without raw secrets |
| `woa_account(action=status)` | success | Default resource resolved active/configured and reported secret presence flags only |
| `wechat_draft(action=count)` | success | Returned one draft |
| `wechat_draft(action=list,count=1,noContent=1)` | success after retries | Two transient `fetch failed` attempts preceded one successful read-only list response |
| `wechat_publish(action=list,count=1,noContent=1)` | success | Returned one page from a six-item publish list |
| unsigned `POST /api/stripe/webhook` | HTTP 400 | Stable `stripe_signature_invalid` response reported a missing timestamp/v1 signature |

The intermittent MCP draft-list fetch failures match the previously observed network/relay flakiness. They did not alter data and succeeded on retry; the new init runner must surface retry/recovery without converting a transient failure into completion or duplicating side effects.
