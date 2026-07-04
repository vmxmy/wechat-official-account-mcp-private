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

### Requirement: Stripe subscriptions synchronize tenant entitlements

The OAuth-protected management API SHALL create Stripe Checkout subscription sessions for paid plans only when billing reconciliation is fully configured, and the Worker SHALL process signed Stripe subscription webhooks to synchronize `tenant_entitlements`.

#### Scenario: Tenant starts Plus Checkout

- **GIVEN** Stripe billing is configured with a Plus price ID
- **AND** an authenticated tenant member has `woa:billing:write`
- **WHEN** the member requests a Plus checkout session
- **THEN** the Worker creates a Stripe Checkout Session in subscription mode
- **AND** the session includes tenant ID and target plan metadata on both the Checkout Session and subscription data
- **AND** the response returns the Checkout session URL without exposing the Stripe secret key

#### Scenario: Checkout fails closed when reconciliation is not configured

- **GIVEN** Stripe billing is missing any required checkout or webhook configuration
- **WHEN** a tenant member requests a paid checkout session
- **THEN** the Worker rejects the request
- **AND** no Stripe Checkout Session is created

#### Scenario: Checkout completion upgrades entitlement

- **GIVEN** Stripe sends a `checkout.session.completed` webhook with a valid `Stripe-Signature`
- **AND** the event metadata contains the tenant ID and paid plan
- **WHEN** the Worker processes the webhook
- **THEN** it updates `tenant_entitlements` with the paid plan, active status, Stripe customer ID, and Stripe subscription ID

#### Scenario: Subscription deletion downgrades entitlement

- **GIVEN** Stripe sends a `customer.subscription.deleted` webhook with a valid `Stripe-Signature`
- **AND** the subscription ID matches the tenant's current Stripe subscription ID
- **WHEN** the Worker processes the webhook
- **THEN** it downgrades the tenant entitlement to Free
- **AND** records the entitlement status as cancelled

#### Scenario: Stale subscription deletion is ignored

- **GIVEN** a tenant has a current active Stripe subscription ID
- **WHEN** Stripe sends an older `customer.subscription.deleted` webhook for a different subscription ID
- **THEN** the Worker records the event as stale
- **AND** the tenant entitlement remains unchanged

#### Scenario: Duplicate Stripe event is ignored

- **GIVEN** a Stripe webhook event ID has already been processed
- **WHEN** Stripe retries the same event
- **THEN** the Worker treats the event as a duplicate
- **AND** does not apply entitlement changes a second time

#### Scenario: Failed entitlement write remains retryable

- **GIVEN** a signed Stripe webhook event has not completed entitlement synchronization
- **WHEN** entitlement persistence fails after signature verification
- **THEN** the Worker does not mark the event as processed
- **AND** a later Stripe retry can still apply the entitlement change

#### Scenario: Invalid Stripe signature is rejected

- **GIVEN** a Stripe webhook request has an invalid or stale signature
- **WHEN** the Worker receives the request
- **THEN** it returns an error
- **AND** it does not update tenant entitlement state

### Requirement: Tenants can inspect usage and upgrade prompts

The management API and remote-only CLI SHALL expose tenant usage summaries for dashboard and support workflows without constructing a WeChat API client.

#### Scenario: Usage summary returns all quota metrics

- **GIVEN** an authenticated tenant member with `woa:usage:read`
- **WHEN** the member requests the tenant usage summary
- **THEN** the response includes the current plan entitlement, every quota metric, used value, limit, remaining value, period, and reset time
- **AND** the response includes machine-readable upgrade prompt metadata

#### Scenario: Exhausted Free quota recommends Plus

- **GIVEN** a Free tenant has exhausted at least one quota metric
- **WHEN** the member requests the tenant usage summary
- **THEN** the upgrade prompt recommends the Plus plan
- **AND** the usage summary does not call the WeChat Official Account API
