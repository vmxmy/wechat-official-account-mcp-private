## Why

The public SaaS direction needs a Free tier that lets users experience the full WeChat Official Account MCP surface without feature gating, while still protecting platform cost, WeChat account safety, and abuse risk. Plus and Pro should increase usage ceilings without changing tool visibility.

## What Changes

- Add tenant-level plan entitlements for `free`, `plus`, and `pro`.
- Add usage counters and usage events in D1 for plan enforcement and future billing/analytics.
- Enforce quotas in the Worker MCP adapter so existing tool handlers do not each implement quota checks.
- Keep all MCP tools visible to Free users; Free is limited by low quotas rather than disabled features.
- Use pre-reservation with refund on handler failure so successful operations count, while failed tool executions do not consume business quotas.
- Return structured MCP quota metadata and `quota_exceeded` errors when a limit is reached.
- Reserve Stripe subscription fields in the entitlement table for the later checkout/webhook integration.

## Impact

- `src/worker/quota-policy.ts`: plan definitions, metric labels, and tool/action-to-metric mapping.
- `src/worker/usage-store.ts`: D1-backed tenant entitlements, counter reservation/refund, usage events, and quota errors.
- `src/worker/mcp-quota.ts`: Worker MCP wrapper helper for quota enforcement and metadata.
- `src/worker/index.ts`: registers all Worker MCP tools through quota enforcement.
- `migrations/d1/0003_usage_quotas.sql`: additive entitlement/counter/event schema.
- `test-tools.js`: quota policy, migration, limit, entitlement, and refund fixtures.
