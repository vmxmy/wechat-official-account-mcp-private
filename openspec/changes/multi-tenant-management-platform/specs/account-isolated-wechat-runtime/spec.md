## ADDED Requirements

### Requirement: Account-scoped WeChat configuration
The system SHALL store WeChat Official Account configuration per `(tenant_id, account_id)`, including app ID, encrypted app secret, encrypted webhook token, encrypted EncodingAESKey, status, and timestamps.

#### Scenario: Configure account
- **WHEN** a tenant admin configures a WeChat account with app ID and app secret
- **THEN** the system stores the app secret encrypted and associates the config with that tenant and account only

#### Scenario: Read account config
- **WHEN** an authorized user reads account configuration
- **THEN** the system returns non-secret metadata and masked secret status, not raw app secret or access token values

### Requirement: Account-scoped token owner
The system SHALL refresh and cache WeChat access tokens through a Durable Object keyed by account, not through a global singleton.

#### Scenario: Concurrent refresh same account
- **WHEN** multiple requests for the same account require token refresh concurrently
- **THEN** the system coalesces them into one WeChat token refresh for that account

#### Scenario: Concurrent refresh different accounts
- **WHEN** two different accounts require token refresh concurrently
- **THEN** each account uses its own token owner and tokens are never written into the other account's token storage

### Requirement: Account-scoped storage access
The system SHALL scope all resource storage and queries for media, permanent media, drafts, publishes, inbound messages, and account tokens by tenant and account.

#### Scenario: List account media
- **WHEN** an authorized user lists media for account `A1`
- **THEN** only rows with `tenant_id` and `account_id` for `A1` are returned

#### Scenario: ID collision across tenants
- **WHEN** two accounts have the same WeChat `media_id`
- **THEN** each media row remains distinct by `(tenant_id, account_id, media_id)`

### Requirement: Account-scoped API client construction
The system SHALL construct `WechatApiClient` only after resolving an authorized account context and SHALL inject that account's token provider, storage, inbox store, media namespace, and proxy configuration.

#### Scenario: Authorized client construction
- **WHEN** a user with access to account `A1` calls a WeChat operation
- **THEN** the system constructs an API client using `A1` credentials and token owner

#### Scenario: Unauthorized client construction blocked
- **WHEN** a user without access to account `A1` attempts a WeChat operation
- **THEN** the system does not construct an API client for `A1`

### Requirement: Backfill default tenant and account
The system SHALL provide a forward-only migration path that backfills existing single-tenant configuration and data into a default tenant and account before switching runtime reads/writes.

#### Scenario: Existing config row backfilled
- **WHEN** the migration runs against a deployment with an existing single-tenant config row
- **THEN** the system creates a default tenant/account and stores equivalent account config in the new tenant-aware tables

#### Scenario: Rollback window
- **WHEN** the new Worker is rolled back during the initial migration window
- **THEN** the old single-tenant tables still exist and have not been destructively modified by this change

### Requirement: Account-scoped R2 namespace
The system SHALL store uploaded or cached media under R2 keys namespaced by tenant and account.

#### Scenario: Upload media through account
- **WHEN** media is uploaded for account `A1`
- **THEN** the R2 key begins with a tenant/account namespace for `A1`

#### Scenario: Cross-account R2 lookup
- **WHEN** account `A2` attempts to reference an R2 key belonging to account `A1`
- **THEN** the system rejects the lookup before uploading to WeChat
