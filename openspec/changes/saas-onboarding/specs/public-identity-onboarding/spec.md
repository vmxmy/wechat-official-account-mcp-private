## ADDED Requirements

### Requirement: Email-code-first Operator identity
The system SHALL provide email-code-first public Operator login and registration, with GitHub as an optional identity provider.

#### Scenario: Email code creates a new Operator
- **WHEN** an unauthenticated person verifies a valid email code for an email that is not linked to an Operator
- **THEN** the system creates an Operator identity with that verified email

#### Scenario: Existing email resolves existing Operator
- **WHEN** an unauthenticated person verifies a valid email code for an email already linked to an active Operator
- **THEN** the system authenticates that existing Operator instead of creating a duplicate Operator

#### Scenario: GitHub login with verified email links identity
- **WHEN** GitHub returns a verified email that matches an existing Operator email
- **THEN** the system links the GitHub identity to that Operator

#### Scenario: GitHub login without verified email requires email code
- **WHEN** GitHub does not provide a verified email suitable for identity and billing
- **THEN** the system requires successful email-code verification before creating or linking the Operator

### Requirement: Email verification controls
The system SHALL protect email-code login with Turnstile, rate limits, short-lived codes, and attempt limits.

#### Scenario: Turnstile required for email code request
- **WHEN** a Web login page or CLI browser authorization page requests an email code
- **THEN** the system requires a valid Turnstile result before sending the code

#### Scenario: Email code expires
- **WHEN** an Operator submits an email code more than 10 minutes after issuance
- **THEN** the system rejects the code and does not authenticate the Operator

#### Scenario: Email code attempt limit
- **WHEN** an Operator fails verification for the same code 5 times
- **THEN** the system invalidates the code and requires a new code request

### Requirement: First-login bootstrap
The system SHALL bootstrap a default Tenant and one unconfigured WeChat Official Account resource for an Operator on first successful login when the Operator has no Tenant.

#### Scenario: New Operator receives default Tenant
- **WHEN** an Operator completes first login and has no Tenant memberships
- **THEN** the system creates a default Tenant with the Operator as owner

#### Scenario: New Operator receives unconfigured WeChat resource
- **WHEN** the system creates the default Tenant during first login
- **THEN** the system creates one unconfigured WeChat Official Account resource under that Tenant

#### Scenario: Existing Operator does not duplicate resources
- **WHEN** an existing Operator logs in again
- **THEN** the system returns the existing Tenant/resource context without creating duplicate default resources

### Requirement: Web sessions
The system SHALL use HttpOnly Web sessions for browser-authenticated Web routes.

#### Scenario: Web session issued
- **WHEN** an Operator completes Web login
- **THEN** the system issues an HttpOnly session cookie with a 7-day sliding expiration

#### Scenario: Web session revoked
- **WHEN** an Operator logs out or revokes a Web session
- **THEN** subsequent Web requests using that session fail authentication

### Requirement: OAuth clients and consent
The system SHALL support dynamic public OAuth clients for CLI/MCP with PKCE, redirect URI validation, consent, remembered authorization, and revocation.

#### Scenario: Public OAuth client requires PKCE
- **WHEN** a CLI or MCP OAuth client starts authorization
- **THEN** the system requires PKCE and validates the redirect URI before completing authorization

#### Scenario: Consent is shown for new client
- **WHEN** an Operator authorizes a dynamic OAuth client that has not been consented for the requested scope set
- **THEN** the system shows a consent page with client identity and requested scopes

#### Scenario: Consent is remembered until revoked
- **WHEN** an Operator has previously consented to an OAuth client and scope set
- **THEN** the system may complete authorization without repeating consent until that consent is revoked

#### Scenario: OAuth token lifetime
- **WHEN** the system issues CLI or MCP OAuth tokens
- **THEN** access tokens expire after 1 hour and refresh tokens expire after 30 days

#### Scenario: Revoked token fails
- **WHEN** an Operator revokes a CLI or MCP authorization
- **THEN** future use of its access or refresh token fails at or before the next token validation window

### Requirement: Legacy shared-password authorization removal
The system SHALL remove the legacy shared authorization-password flow when the new identity system launches.

#### Scenario: Legacy password form unavailable
- **WHEN** a client reaches the authorization flow after identity launch
- **THEN** the system authenticates through email/GitHub identity and does not accept the old shared authorization password

#### Scenario: Existing clients must reauthorize
- **WHEN** a CLI or MCP client has tokens from the legacy shared-password model
- **THEN** the client must reauthorize through the new identity flow before accessing protected resources
