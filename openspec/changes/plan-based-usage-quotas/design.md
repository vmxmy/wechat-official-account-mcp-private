## Context

The platform already exposes a multi-tenant Cloudflare Workers Remote MCP runtime. The next product step is plan-based access for a public SaaS: Free users should receive all tools, but low usage ceilings; Plus and Pro should raise ceilings. WeChat official API limits remain separate from SaaS plan limits.

## Goals

- Full-tool Free experience with quota-only restrictions.
- Tenant-scoped plan entitlement that defaults to Free when absent.
- Centralized MCP quota enforcement in the Worker adapter.
- Successful tool executions count; failed handlers refund reserved usage.
- Quota metadata is machine-readable for MCP clients and support tooling.
- D1 schema is additive and Stripe-ready.

## Non-Goals

- Stripe Checkout, customer portal, webhook handling, invoice state, or payment UI in this change.
- REST/CLI quota enforcement in this first implementation pass; the store/policy is reusable for those adapters later.
- Per-seat billing or resource-count enforcement beyond usage counters.
- Changing WeChat official API request fields, endpoints, or official API quota semantics.

## Decisions

### D1: Quota-only Free tier

Free gets all current MCP tools. The plan differs only by limits such as monthly publish units, total tool calls, media uploads, stats queries, message sends, QR-code creates, and high-risk operations.

### D2: Worker MCP adapter enforcement

Quota checks happen around `tool.handler(...)` in the Worker MCP registration path. This avoids copy/paste checks in each tool and ensures new tools inherit baseline `tool_calls_day` and `tool_calls_month` quotas.

### D3: Reserve then refund

The adapter reserves quota before executing a tool, preventing a known over-limit operation from reaching WeChat. If the handler throws or returns `isError`, the reservation is refunded so final counters represent successful business usage.

### D4: Additive, Stripe-ready D1 schema

`tenant_entitlements` stores the plan and future Stripe IDs. `usage_counters` stores tenant/period/metric counters. `usage_events` stores append-only event metadata for support and analytics. Foreign keys are intentionally omitted from the usage schema so onboarding and partially backfilled tenant contexts cannot block quota telemetry.

## Risks / Follow-ups

- Concurrent requests can still race around the pre-read path; the SQL upsert contains a conditional update, but high-concurrency behavior should be stress-tested before large public rollout.
- `wechat_publish.submit` receives a draft media ID, so it currently counts one publish unit unless an explicit article count is supplied by the caller.
- REST and CLI should call the same `D1UsageQuotaStore` in the next pass.
- Stripe webhook integration should update `tenant_entitlements.plan`, `status`, and Stripe IDs.
