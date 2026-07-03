## ADDED Requirements

### Requirement: Versioned protected API
The system SHALL expose a versioned REST API under `/api/v1/*` and require OAuth bearer authorization for all non-health API routes.

#### Scenario: Anonymous API request
- **WHEN** a request calls `/api/v1/me` without authorization
- **THEN** the system returns 401 and does not return user or tenant data

#### Scenario: Authorized API request
- **WHEN** a request calls `/api/v1/me` with a valid bearer token
- **THEN** the system returns the authenticated user, OAuth client, scopes, accessible tenants, and accessible accounts

### Requirement: Tenant management API
The system SHALL provide REST endpoints to list and administer tenants according to membership role and OAuth scopes.

#### Scenario: List tenants
- **WHEN** an authenticated user calls `GET /api/v1/tenants`
- **THEN** the system returns only tenants where the user has an active membership

#### Scenario: Create tenant without permission
- **WHEN** a user without tenant creation permission calls `POST /api/v1/tenants`
- **THEN** the system rejects the request with an authorization error

### Requirement: Account management API
The system SHALL provide REST endpoints for listing, creating, reading, updating, disabling, and configuring WeChat accounts under a tenant.

#### Scenario: Create account under tenant
- **WHEN** a tenant admin calls `POST /api/v1/tenants/:tenantId/accounts` with valid metadata
- **THEN** the system creates the account under that tenant and returns account metadata without raw secrets

#### Scenario: Update account credentials
- **WHEN** a tenant admin updates app secret or webhook token through the account API
- **THEN** the system encrypts the new secret, clears only that account's cached token when needed, and writes an audit event

### Requirement: WeChat operation API
The system SHALL provide REST routes for common WeChat management operations and SHALL call the same tenant-aware use cases as MCP tools.

#### Scenario: List drafts through API
- **WHEN** an authorized user calls `GET /api/v1/tenants/:tenantId/accounts/:accountId/drafts`
- **THEN** the system validates tenant/account access and returns drafts from that WeChat account using official pagination limits

#### Scenario: Submit publish through API
- **WHEN** an authorized user calls a publish submit route
- **THEN** the system enforces publish scope and guardrails before calling WeChat

### Requirement: Structured API errors
The system SHALL return structured JSON errors with stable error codes, human-readable messages, and request IDs for REST API failures.

#### Scenario: Validation error
- **WHEN** an API request body fails validation
- **THEN** the system returns 400 with a structured validation error and request ID

#### Scenario: Authorization error
- **WHEN** an API request targets a tenant/account the user cannot access
- **THEN** the system returns 403 or 404 according to the chosen privacy policy and MUST NOT call WeChat

### Requirement: Legacy REST tool execution remains removed
The system SHALL NOT restore unauthenticated legacy REST tool execution under `/api/wechat/tools/*`.

#### Scenario: Legacy route request
- **WHEN** a client calls `/api/wechat/tools/wechat_draft`
- **THEN** the system returns a migration/removal response and does not execute the tool
