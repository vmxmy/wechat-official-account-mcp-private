## 1. Schema and policy

- [x] 1.1 Add D1 migration for tenant entitlements, usage counters, and usage events.
- [x] 1.2 Define Free/Plus/Pro plan limits with Free publish quota of 30/month.
- [x] 1.3 Map MCP tool/action pairs to usage metrics while keeping all tools visible.

## 2. Runtime enforcement

- [x] 2.1 Implement D1 usage store with entitlement lookup, reservation, refund, and usage event recording.
- [x] 2.2 Wrap Worker MCP tool execution with quota reservation before handler execution.
- [x] 2.3 Refund quota on thrown handler errors or `isError` tool results.
- [x] 2.4 Return structured `quota_exceeded` MCP errors and quota metadata.
- [x] 2.5 Align Worker MCP tenant/account defaults with the resolved D1 account context.

## 3. Verification

- [x] 3.1 Add fixtures proving Free has all tools but lower limits.
- [x] 3.2 Add fixtures proving Free publish call 31 is rejected after 30 successful calls.
- [x] 3.3 Add fixtures proving Plus entitlement uses Plus limits.
- [x] 3.4 Add fixtures proving failed handlers refund business usage.
- [x] 3.5 Run `npm run check`, `npm run lint`, `npm test`, `openspec validate`, and `npx wrangler deploy --dry-run`.

## 4. Follow-up

- [ ] 4.1 Implement Stripe Checkout and webhook plan synchronization.
- [ ] 4.2 Apply the same quota wrapper to REST and CLI operation adapters.
- [ ] 4.3 Add dashboard/API endpoints for usage visibility and plan upgrade prompts.
