## ADDED Requirements

### Requirement: Tenant ownership boundary
The system SHALL treat Tenants as single-owner isolation boundaries in the first release.

#### Scenario: Tenant owner can access tenant resources
- **WHEN** an authenticated Tenant owner requests resources under their Tenant
- **THEN** the system allows access according to the owner's scopes and plan allowances

#### Scenario: Non-owner cannot access tenant resources
- **WHEN** an authenticated Operator guesses another Tenant ID
- **THEN** the system rejects access and does not reveal tenant-internal WeChat resource data

### Requirement: Opaque resource identifiers
The system SHALL expose opaque public identifiers for Tenants and WeChat Official Account resources.

#### Scenario: Tenant ID is opaque
- **WHEN** the system creates a Tenant
- **THEN** the public Tenant ID is an opaque non-sequential identifier

#### Scenario: WeChat resource ID is opaque
- **WHEN** the system creates a WeChat Official Account resource
- **THEN** the public resource ID is an opaque non-sequential identifier suitable for API and webhook URLs

### Requirement: WeChat resource creation and allowance
The system SHALL persistently create WeChat Official Account resources under a Tenant subject to subscription account allowance.

#### Scenario: Resource create succeeds within allowance
- **WHEN** a Tenant owner creates a WeChat Official Account resource and the Tenant is below its account allowance
- **THEN** the system persists the resource in unconfigured status and returns a secret-safe response

#### Scenario: Resource create denied above allowance
- **WHEN** a Tenant owner creates a WeChat Official Account resource and the Tenant is at its account allowance
- **THEN** the system rejects the operation before storing the resource and returns plan-limit upgrade guidance

### Requirement: Default WeChat resource resolution
The system SHALL maintain a Tenant default WeChat Official Account resource for operations that omit account ID.

#### Scenario: Omitted account ID uses default resource
- **WHEN** an authenticated operation omits account ID and the Tenant has a default resource
- **THEN** the system targets the default resource

#### Scenario: Default resource can be changed
- **WHEN** a Tenant owner sets a different accessible resource as default through Web, CLI, or MCP
- **THEN** subsequent operations that omit account ID target the new default resource

### Requirement: Credential configuration and validation
The system SHALL validate WeChat AppID/AppSecret before activating a WeChat Official Account resource.

#### Scenario: Valid credentials activate resource
- **WHEN** a Tenant owner submits AppID/AppSecret and the system obtains a valid WeChat access token through the platform relay
- **THEN** the system stores encrypted credentials, stores the token, and marks the resource active

#### Scenario: Invalid credentials are not persisted
- **WHEN** credential validation fails due to invalid secret, IP allowlist, relay, or WeChat API error
- **THEN** the system returns the failure and does not persist the submitted AppSecret

#### Scenario: Current relay egress IPs are authoritative
- **WHEN** an authenticated onboarding client requests init context
- **THEN** the system returns all current egress IPs from trusted `WECHAT_EGRESS_IPS` deployment configuration with a configuration version and does not infer them from user input, request headers, or frontend constants

#### Scenario: Allowlist completion requires relay probe
- **WHEN** the user reports adding the current egress IPs to the target WeChat allowlist
- **THEN** the system marks allowlist verification complete only after the AppID/AppSecret token request succeeds through the configured relay

#### Scenario: Secret-safe status response
- **WHEN** a client requests resource status
- **THEN** the system returns app ID, status, and secret presence flags without returning raw secrets

### Requirement: WeChat AppID uniqueness
The system SHALL enforce global uniqueness for active WeChat AppIDs.

#### Scenario: Duplicate active AppID denied
- **WHEN** a Tenant owner configures a WeChat AppID already assigned to another active resource
- **THEN** the system rejects the configuration before storing credentials

#### Scenario: Deleted resource releases AppID
- **WHEN** a WeChat resource is soft-deleted and its secrets are purged
- **THEN** its AppID becomes available for configuration on another resource

### Requirement: Resource rename and deletion
The system SHALL support resource rename and soft deletion with secret purge.

#### Scenario: Rename resource
- **WHEN** a Tenant owner renames a WeChat Official Account resource
- **THEN** the system persists the new display name without changing the resource ID

#### Scenario: Delete resource
- **WHEN** a Tenant owner confirms deletion of a WeChat Official Account resource
- **THEN** the system disables the resource, purges AppSecret/webhook credentials/access tokens, and retains non-sensitive audit history

### Requirement: Optional webhook configuration
The system SHALL make webhook configuration optional during onboarding and required before inbound-message features.

#### Scenario: Onboarding completes without webhook
- **WHEN** the first WeChat resource credentials validate successfully but webhook Token/EncodingAESKey are absent
- **THEN** the system marks onboarding complete

#### Scenario: Inbox requires webhook setup
- **WHEN** a Tenant owner uses inbox or inbound-message features without webhook credentials and callback configuration
- **THEN** the system returns setup guidance rather than silently failing

### Requirement: Supported publish content types
The system SHALL support article and image/贴图 publishing in the first release and SHALL not claim video publishing support.

#### Scenario: Article publish supported
- **WHEN** a Tenant owner publishes article content through supported tools
- **THEN** the system uses the official article publishing path and can count successful publishes

#### Scenario: Image publish supported
- **WHEN** a Tenant owner publishes image/贴图 content through supported tools
- **THEN** the system uses the official image publish path and can count successful publishes

#### Scenario: Video publish rejected
- **WHEN** a Tenant owner requests video publishing through this SaaS surface
- **THEN** the system returns an explicit unsupported response without claiming official support
