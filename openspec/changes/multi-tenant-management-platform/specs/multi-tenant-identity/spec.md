## ADDED Requirements

### Requirement: Tenant records
The system SHALL represent each organization as a tenant with a stable opaque `tenant_id`, a unique slug, a display name, a lifecycle status, and creation/update timestamps.

#### Scenario: Create tenant
- **WHEN** an authorized platform or tenant-creation workflow creates a tenant with slug `acme`
- **THEN** the system stores a tenant row with a stable `tenant_id`, slug `acme`, status `active`, and timestamps

#### Scenario: Tenant slug conflict
- **WHEN** a tenant is created with a slug that already belongs to another tenant
- **THEN** the system rejects the request with a conflict error and does not create a second tenant row

### Requirement: User records
The system SHALL represent human operators as users with stable opaque `user_id`, email, display name, lifecycle status, and creation/update timestamps.

#### Scenario: Resolve existing user
- **WHEN** an OAuth identity maps to an existing email or provider subject
- **THEN** the system resolves the existing user instead of creating an unrelated duplicate user

#### Scenario: Disabled user access
- **WHEN** a disabled user attempts to authorize or call a protected endpoint
- **THEN** the system denies access before tenant or account context is created

### Requirement: Tenant memberships
The system SHALL grant tenant access only through explicit tenant membership rows connecting `tenant_id`, `user_id`, role, status, and creation timestamp.

#### Scenario: Active member accesses tenant
- **WHEN** a user with an active membership requests tenant data
- **THEN** the system allows access according to that membership role and requested scopes

#### Scenario: Non-member accesses tenant
- **WHEN** a user without an active membership requests tenant data by guessing `tenant_id`
- **THEN** the system returns an authorization failure and MUST NOT reveal tenant-internal resources

### Requirement: Role permissions
The system SHALL enforce role permissions for tenant and account operations using server-side membership data, not client-supplied role claims alone.

#### Scenario: Tenant admin configures account
- **WHEN** a user with tenant admin or owner role submits a valid account configuration request
- **THEN** the system permits the operation if the OAuth scope also allows account administration

#### Scenario: Viewer attempts mutation
- **WHEN** a user with viewer role attempts to update a WeChat account configuration
- **THEN** the system rejects the operation even if the request includes a target tenant and account ID

### Requirement: WeChat account membership boundary
The system SHALL treat WeChat accounts as resources owned by exactly one tenant and SHALL authorize account access through the owning tenant membership.

#### Scenario: Account belongs to tenant
- **WHEN** an account is created under tenant `T1`
- **THEN** all future reads, writes, tokens, webhooks, media, and inbox rows for that account are associated with `T1`

#### Scenario: Cross-tenant account access
- **WHEN** a member of tenant `T2` requests account `A1` owned by tenant `T1`
- **THEN** the system denies access and MUST NOT run a WeChat API request for `A1`
