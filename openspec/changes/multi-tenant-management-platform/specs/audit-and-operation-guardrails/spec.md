## ADDED Requirements

### Requirement: Audit log for mutating operations
The system SHALL write audit logs for tenant/account mutations and WeChat mutating operations, including user ID, OAuth client ID, tenant ID, account ID when applicable, action, target type, target ID, request ID, timestamp, and sanitized metadata.

#### Scenario: Account credential update audit
- **WHEN** a tenant admin updates an account app secret
- **THEN** the system writes an audit log recording the action and account but not the raw app secret

#### Scenario: Draft creation audit
- **WHEN** a user creates a draft through MCP, API, or CLI
- **THEN** the system writes an audit log with the resolved tenant/account and operation metadata

### Requirement: High-risk operation scope gates
The system SHALL require elevated scopes for high-risk operations including publish submit, mass send, menu overwrite/delete, credential changes, quota clear, and destructive batch deletes.

#### Scenario: Publish scope required
- **WHEN** a user without `woa:content:publish` attempts to submit a publish operation
- **THEN** the system rejects the operation before calling WeChat

#### Scenario: Account admin scope required
- **WHEN** a user without `woa:account:admin` attempts to rotate an app secret
- **THEN** the system rejects the operation and writes a denied-operation audit event when appropriate

### Requirement: Explicit confirmation for destructive or public operations
The system SHALL require an explicit confirmation marker or operation job approval for destructive or public-impacting actions.

#### Scenario: Missing confirmation
- **WHEN** a user calls a mass-send, menu delete, publish submit, or batch-delete operation without the required confirmation marker
- **THEN** the system returns a confirmation-required error and does not call WeChat

#### Scenario: Confirmation provided
- **WHEN** the same operation is retried with the required confirmation marker and valid scopes
- **THEN** the system proceeds and records the confirmation in sanitized audit metadata

### Requirement: Operation jobs for long-running or retryable workflows
The system SHALL represent long-running, polling, retryable, or bulk workflows as account-scoped operation jobs when immediate synchronous execution is unsafe or insufficient.

#### Scenario: Mass send polling job
- **WHEN** a mass-send operation requires result polling
- **THEN** the system stores an operation job scoped to tenant/account and updates status as polling progresses

#### Scenario: Bulk delete limit
- **WHEN** a destructive bulk operation exceeds the per-request safe limit
- **THEN** the system limits the current execution and records remaining work through a job or explicit continuation response

### Requirement: Secret-safe logs and responses
The system SHALL never include raw app secrets, webhook tokens, EncodingAESKeys, access tokens, OAuth client secrets, or relay proxy tokens in audit logs, errors, tool responses, API responses, or CLI output.

#### Scenario: WeChat API error
- **WHEN** a WeChat API call fails
- **THEN** the system returns a useful sanitized error without raw access token or credential values

#### Scenario: Audit metadata sanitization
- **WHEN** a request body contains secret fields
- **THEN** the audit metadata stores only masked or redacted values for those fields

### Requirement: Audit query authorization
The system SHALL allow audit log queries only to users with audit-read permission for the relevant tenant and SHALL filter results by tenant and account access.

#### Scenario: Tenant audit query
- **WHEN** a tenant admin with `woa:audit:read` queries audit logs
- **THEN** the system returns audit events for that tenant according to account filters

#### Scenario: Cross-tenant audit query
- **WHEN** a user from tenant `T2` attempts to query audit logs for tenant `T1`
- **THEN** the system denies access and returns no audit rows from `T1`
