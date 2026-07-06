## ADDED Requirements

### Requirement: MCP context management
The MCP surface SHALL expose authorized management tools for current Operator, Tenant, resource, plan, and quota context.

#### Scenario: Context shows accessible Tenant
- **WHEN** an authorized MCP client calls the context tool
- **THEN** the tool returns the current Operator, Tenant, default resource, scopes, plan, and quota summary without raw secrets

#### Scenario: Unauthenticated MCP challenged
- **WHEN** an MCP client connects to `/mcp` without authorization
- **THEN** the system returns an OAuth challenge and does not expose tools

### Requirement: MCP WeChat resource management
The MCP surface SHALL allow authorized Tenant owners to create, rename, configure, status-check, default-select, and delete WeChat resources subject to plan and scope rules.

#### Scenario: MCP account create persists
- **WHEN** an authorized Tenant owner calls the MCP resource create action within account allowance
- **THEN** the system persists an unconfigured WeChat resource and returns its opaque ID

#### Scenario: MCP account configure validates
- **WHEN** an authorized Tenant owner calls the MCP configure action with AppID/AppSecret
- **THEN** the system validates credentials through the same backend use case as Web and CLI

#### Scenario: MCP create above allowance rejected
- **WHEN** an authorized Tenant owner calls the MCP create action above account allowance
- **THEN** the system rejects the action before persisting the resource and returns upgrade guidance

### Requirement: MCP does not create Tenants in first release
The MCP surface SHALL NOT create new Tenants in the first release.

#### Scenario: Tenant create unavailable
- **WHEN** an MCP client requests Tenant creation
- **THEN** the system rejects or omits that action and explains that Tenants are created during login onboarding

### Requirement: MCP billing guidance
The MCP surface SHALL provide billing and upgrade guidance without initiating Stripe Checkout.

#### Scenario: MCP quota exceeded
- **WHEN** an MCP operation is denied due to quota or account allowance
- **THEN** the MCP response includes plan, limit, reset timing, and Web/CLI upgrade guidance

#### Scenario: MCP checkout not created
- **WHEN** an MCP client asks to upgrade plan
- **THEN** the system does not create a Stripe Checkout session from MCP and directs the Operator to Web or CLI

### Requirement: MCP native Streamable HTTP only
The product SHALL officially support native Streamable HTTP/OAuth MCP clients only.

#### Scenario: No local MCP restoration
- **WHEN** users configure MCP clients for the SaaS
- **THEN** official guidance points to the hosted `/mcp` endpoint and does not restore local stdio/SSE MCP server paths

### Requirement: MCP operation safety
The MCP surface SHALL require explicit confirmation only for delete operations in the first release.

#### Scenario: MCP delete requires confirmation
- **WHEN** an MCP client calls a delete action without the required confirmation marker
- **THEN** the system refuses the delete action

#### Scenario: MCP publish does not require extra confirmation
- **WHEN** an authorized MCP client publishes article or image content within quota
- **THEN** the system may execute the publish without an extra confirmation marker beyond authentication, authorization, quota, and audit controls
