## ADDED Requirements

### Requirement: Single OAuth authority
The system SHALL use one OAuth authority for MCP Streamable HTTP, REST API, and CLI access.

#### Scenario: MCP authorization
- **WHEN** an MCP client connects to `/mcp` without a bearer token
- **THEN** the system responds with an OAuth challenge and does not expose MCP tools

#### Scenario: REST authorization
- **WHEN** a REST client calls `/api/v1/me` with a valid bearer token issued by the same authority
- **THEN** the system returns the authenticated user and accessible tenant context

#### Scenario: CLI authorization
- **WHEN** the CLI starts login
- **THEN** it uses the same OAuth authorization and token endpoints as MCP and REST clients

### Requirement: OAuth clients
The system SHALL store OAuth clients with stable client IDs, client type, allowed redirect URIs, allowed scopes, optional tenant binding, and secret hash when the client is confidential.

#### Scenario: Redirect URI validation
- **WHEN** an OAuth authorization request uses a redirect URI not registered for the client
- **THEN** the system rejects the authorization request before user approval

#### Scenario: Public CLI client
- **WHEN** the CLI uses a public client
- **THEN** the system requires PKCE and MUST NOT require the CLI to store a client secret

### Requirement: Scope enforcement
The system SHALL enforce OAuth scopes server-side for every protected MCP tool, REST route, and CLI-backed operation.

#### Scenario: Missing scope
- **WHEN** an authenticated user calls a publish operation without `woa:content:publish`
- **THEN** the system rejects the operation before calling the WeChat API

#### Scenario: Read scope allowed
- **WHEN** an authenticated user calls a draft list operation with `woa:content:read`
- **THEN** the system allows the operation if tenant membership and account access also pass

### Requirement: Authorization context
The system SHALL derive `user_id`, tenant memberships, OAuth client ID, granted scopes, and optional default tenant/account context from trusted OAuth/session data and server-side lookup.

#### Scenario: Context created
- **WHEN** a bearer token is valid and the user has an active membership
- **THEN** the system creates a request context containing user, client, scopes, and accessible tenants

#### Scenario: Forged context parameter
- **WHEN** a request includes a tenant or role parameter that conflicts with server-side membership data
- **THEN** the system ignores the forged value and enforces the server-side membership result

### Requirement: Token and session revocation
The system SHALL provide a way to revoke OAuth client sessions or credentials so future MCP, API, and CLI requests fail authorization.

#### Scenario: Revoked session
- **WHEN** an OAuth session or refresh token is revoked
- **THEN** subsequent requests using derived access tokens are rejected at or before the next token validation window

#### Scenario: Revoked client
- **WHEN** an OAuth client is disabled
- **THEN** new authorization requests and token refreshes for that client are rejected
