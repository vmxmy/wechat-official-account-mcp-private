## ADDED Requirements

### Requirement: MCP tool tenant context
The system SHALL execute every tenant data or WeChat MCP tool call with an authenticated tenant/account context derived from OAuth authorization and membership checks.

#### Scenario: Tool call with valid context
- **WHEN** an authenticated user with access to account `A1` calls a WeChat MCP tool for `A1`
- **THEN** the tool runs with `tenant_id`, `account_id`, `user_id`, OAuth client ID, and granted scopes in context

#### Scenario: Tool call without authorization
- **WHEN** an MCP tool call lacks valid OAuth authorization
- **THEN** the system rejects the call before invoking the tool handler

### Requirement: Account resolution for MCP tools
The system SHALL resolve account context for MCP tools from explicit `accountId`, a server-side default account, or an unambiguous single accessible account.

#### Scenario: Single accessible account
- **WHEN** a user with exactly one accessible account calls `wechat_draft` without `accountId`
- **THEN** the system uses that account and includes the resolved account in the response metadata or text

#### Scenario: Multiple accessible accounts
- **WHEN** a user with multiple accessible accounts calls a WeChat tool without `accountId` and no default account is set
- **THEN** the system returns a clear account-selection error listing accessible account identifiers and names

#### Scenario: Inaccessible explicit account
- **WHEN** a user passes an `accountId` for an account they cannot access
- **THEN** the system rejects the call and does not call the WeChat API

### Requirement: Account-scoped auth/config tool behavior
The system SHALL change `wechat_auth.configure` and related auth actions from global configuration behavior to account-scoped configuration behavior.

#### Scenario: Configure account credentials
- **WHEN** a tenant admin calls `wechat_auth.configure` with `accountId`, app ID, and app secret
- **THEN** the system updates only that account's credentials, clears only that account's cached token, and writes an audit event

#### Scenario: Get account config
- **WHEN** an authorized user calls `wechat_auth.get_config` for an account
- **THEN** the system returns masked account configuration for that account only

### Requirement: MCP tenant/account management tools
The system SHALL expose management MCP tools for tenant/account context and administration.

#### Scenario: Show current context
- **WHEN** a user calls `woa_context`
- **THEN** the tool returns the current user, accessible tenants, accessible accounts, active/default account information, and granted scopes

#### Scenario: List accounts
- **WHEN** a tenant member with account read permission calls `woa_account` list action
- **THEN** the tool returns only accounts in tenants that user can access

#### Scenario: Create account
- **WHEN** a tenant admin calls `woa_account` create action with valid account metadata
- **THEN** the system creates the account under that tenant and returns masked metadata

### Requirement: Existing WeChat tools remain available
The system SHALL keep existing WeChat MCP tools available after multi-tenant migration, with behavior preserved except for explicit tenant/account scoping and high-risk guardrails.

#### Scenario: Backfilled default account tools
- **WHEN** a deployment has been backfilled into a default tenant/account
- **THEN** existing content tools such as draft list and publish list continue to work for authorized users of that default account

#### Scenario: Tool count regression check
- **WHEN** the MCP server initializes
- **THEN** the existing WeChat operation tools plus new management tools are listed through MCP `tools/list`
