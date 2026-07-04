## ADDED Requirements

### Requirement: Free plan exposes every MCP tool with quota limits

The system SHALL keep every registered MCP tool visible and callable for Free tenants, and SHALL enforce Free access through usage quotas rather than static feature gates.

#### Scenario: Free tenant lists tools

- **GIVEN** a tenant on the Free plan
- **WHEN** an MCP client lists available tools
- **THEN** every current `wechat_*` and `woa_*` MCP tool remains present
- **AND** the tenant is subject to Free usage quotas when calling those tools

### Requirement: Worker MCP tool calls are quota checked centrally

The Worker MCP adapter SHALL perform tenant-level quota checks before invoking a tool handler and SHALL apply every tool call to the baseline daily and monthly total-call metrics.

#### Scenario: Tool call under quota

- **GIVEN** a tenant has remaining quota for the requested tool metrics
- **WHEN** the tenant calls an MCP tool
- **THEN** the Worker reserves the relevant counters before executing the handler
- **AND** the tool handler executes normally
- **AND** the successful result includes machine-readable quota metadata

#### Scenario: Tool call exceeds quota

- **GIVEN** a tenant has exhausted one relevant quota metric
- **WHEN** the tenant calls an MCP tool requiring that metric
- **THEN** the Worker does not invoke the tool handler
- **AND** the MCP response is an error with code `quota_exceeded`
- **AND** the response includes the metric, used value, limit, requested amount, and reset time

### Requirement: Free publish quota is 30 per month

The system SHALL limit Free tenants to 30 successful `wechat_publish.submit` publish units per month.

#### Scenario: Thirty-first Free publish is rejected

- **GIVEN** a Free tenant has 30 successful publish units in the current monthly period
- **WHEN** the tenant calls `wechat_publish` with action `submit`
- **THEN** the Worker returns `quota_exceeded`
- **AND** the publish handler is not invoked
- **AND** the publish usage counter remains at 30

### Requirement: Failed tool handlers do not consume business usage

The system SHALL refund reserved quota when a tool handler throws or returns an error result, so final business counters represent successful executions.

#### Scenario: Handler failure after reservation

- **GIVEN** a tenant calls a tool under quota
- **AND** the Worker reserves the relevant usage counters
- **WHEN** the tool handler fails
- **THEN** the Worker refunds the reserved counters
- **AND** the final usage counter does not include the failed execution

### Requirement: Tenant entitlements are Stripe-ready

The D1 entitlement model SHALL store tenant plan state and fields needed for future Stripe subscription synchronization.

#### Scenario: Plus tenant receives Plus limits

- **GIVEN** `tenant_entitlements` records a tenant as `plus`
- **WHEN** quota policy is resolved for that tenant
- **THEN** the Worker applies Plus limits instead of Free limits
- **AND** the entitlement record can store Stripe customer and subscription identifiers for future billing integration
