## ADDED Requirements

### Requirement: Tenant subscription plans
The system SHALL assign each Tenant a subscription plan of Free, Plus, or Pro.

#### Scenario: New Tenant starts Free
- **WHEN** the system creates a Tenant during onboarding
- **THEN** the Tenant receives the Free plan without requiring a payment method

#### Scenario: Subscription belongs to Tenant
- **WHEN** a Tenant upgrades or changes subscription
- **THEN** the billing state and allowances apply to the Tenant rather than an individual Operator or WeChat resource

### Requirement: Stripe monthly billing
The system SHALL support monthly Stripe subscriptions for Plus and Pro in live mode.

#### Scenario: Plus checkout
- **WHEN** a Tenant owner starts Plus checkout from Web or CLI
- **THEN** the system creates a live Stripe Checkout session for a $9 monthly subscription

#### Scenario: Pro checkout
- **WHEN** a Tenant owner starts Pro checkout from Web or CLI
- **THEN** the system creates a live Stripe Checkout session for a $29 monthly subscription

#### Scenario: Stripe Customer per Tenant
- **WHEN** the system creates a Stripe Customer
- **THEN** it creates one Customer per Tenant using the owner Operator verified email

#### Scenario: MCP does not create checkout
- **WHEN** a Tenant reaches a plan limit through MCP
- **THEN** MCP returns upgrade guidance and does not create a Stripe Checkout session

### Requirement: Account allowance
The system SHALL enforce WeChat resource account allowances by plan.

#### Scenario: Free account allowance
- **WHEN** a Free Tenant creates WeChat resources
- **THEN** the system allows at most 1 active/configurable resource

#### Scenario: Plus account allowance
- **WHEN** a Plus Tenant creates WeChat resources
- **THEN** the system allows at most 3 active/configurable resources

#### Scenario: Pro account allowance
- **WHEN** a Pro Tenant creates WeChat resources
- **THEN** the system allows at most 10 active/configurable resources

### Requirement: Published content allowance
The system SHALL meter successful published-content operations by plan.

#### Scenario: Free publish allowance
- **WHEN** a Free Tenant successfully publishes article or image content
- **THEN** the system counts it toward a 30-successful-publishes allowance for the Tenant period

#### Scenario: Plus publish allowance
- **WHEN** a Plus Tenant successfully publishes article or image content
- **THEN** the system counts it toward a 300-successful-publishes allowance for the Tenant period

#### Scenario: Pro publish allowance
- **WHEN** a Pro Tenant successfully publishes article or image content
- **THEN** the system counts it toward a 3000-successful-publishes allowance for the Tenant period

#### Scenario: Failed publish does not count as successful publish
- **WHEN** a publish operation fails
- **THEN** the system does not consume successful published-content allowance

### Requirement: Tool-call allowance
The system SHALL meter all MCP, CLI, Web, and API tool/use-case calls by Tenant plan.

#### Scenario: Free tool-call allowance
- **WHEN** a Free Tenant performs protected operations
- **THEN** the system enforces a 300 tool-call allowance for the Tenant period

#### Scenario: Plus tool-call allowance
- **WHEN** a Plus Tenant performs protected operations
- **THEN** the system enforces a 3000 tool-call allowance for the Tenant period

#### Scenario: Pro tool-call allowance
- **WHEN** a Pro Tenant performs protected operations
- **THEN** the system enforces a 30000 tool-call allowance for the Tenant period

#### Scenario: Failed publish consumes tool-call allowance
- **WHEN** a publish operation is attempted and fails
- **THEN** the system consumes tool-call allowance but not successful published-content allowance

### Requirement: Quota periods
The system SHALL calculate usage periods from billing periods for paid Tenants and Tenant anniversary for Free Tenants.

#### Scenario: Paid period follows Stripe
- **WHEN** a Tenant has an active paid subscription
- **THEN** the system uses the current Stripe billing period for allowance reset timing

#### Scenario: Free period follows Tenant anniversary
- **WHEN** a Tenant is on Free
- **THEN** the system uses a rolling monthly period anchored to Tenant creation time

### Requirement: Over-quota behavior
The system SHALL reject over-quota operations before calling WeChat APIs.

#### Scenario: Over-quota request rejected
- **WHEN** an operation would exceed account, publish, or tool-call allowance
- **THEN** the system rejects the operation before calling WeChat and returns quota details, reset timing, and upgrade guidance

### Requirement: Subscription downgrade behavior
The system SHALL apply cancellations and downgrades at period end and lock excess resources without deleting them.

#### Scenario: Downgrade at period end
- **WHEN** Stripe reports a cancellation or downgrade scheduled for period end
- **THEN** the system preserves current paid allowances until the period ends

#### Scenario: Excess resources locked
- **WHEN** a Tenant's new plan has a lower account allowance than its current resource count
- **THEN** the system locks excess resources beyond the allowance without deleting data or secrets until the owner upgrades or removes resources

### Requirement: Full tool visibility for Free
The system SHALL keep all tools visible to Free Tenants while enforcing allowances.

#### Scenario: Free tool list visible
- **WHEN** a Free Tenant lists available MCP tools or CLI/API capabilities
- **THEN** the system exposes the same feature surface as paid plans subject to quotas and permissions
