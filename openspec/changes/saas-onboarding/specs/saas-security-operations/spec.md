## ADDED Requirements

### Requirement: Secret storage and redaction
The system SHALL store tenant WeChat secrets encrypted in D1 using the `enc:` AES model and SHALL redact secrets in all responses and logs.

#### Scenario: Store WeChat secret encrypted
- **WHEN** valid WeChat credentials are persisted
- **THEN** AppSecret, webhook token, EncodingAESKey, and access tokens are stored encrypted or secret-safe according to the existing `enc:` model

#### Scenario: Raw secrets never returned
- **WHEN** Web, CLI, MCP, REST, audit, or logs report configuration status
- **THEN** they return masked values or presence flags and never return raw AppSecret or tokens

### Requirement: Platform relay for WeChat egress
The system SHALL route WeChat API calls through the platform HTTPS relay when configured.

#### Scenario: Credential validation uses relay
- **WHEN** the system validates AppID/AppSecret
- **THEN** the token request uses the same platform relay egress path as normal WeChat API calls

#### Scenario: Relay guidance visible
- **WHEN** credential validation fails due to WeChat IP allowlist or relay configuration
- **THEN** the system returns actionable guidance without exposing secrets

### Requirement: One-time credential handoff
The system SHALL provide a short-lived, same-Operator, write-only HTTPS handoff for Agent-guided WeChat credential entry.

#### Scenario: Handoff cannot read credentials
- **WHEN** a valid handoff token is opened and credentials are submitted
- **THEN** the token authorizes only a single write/validation attempt and no API or page can read the submitted AppSecret back

#### Scenario: Handoff limits browser leakage
- **WHEN** the credential page or response is served
- **THEN** it uses a token hash, short expiry, single use, same-Operator authentication, HttpOnly continuation cookie, clean URL, `no-store`, `no-referrer`, and no third-party scripts

#### Scenario: Agent path never receives secrets
- **WHEN** credential setup is initiated by Agent/JSONL/pipe/CI mode
- **THEN** events, stdout/stderr, checkpoints, logs, analytics, and local CLI config contain no AppSecret, OAuth callback code, PKCE verifier, or raw token

### Requirement: Init run integrity
The system SHALL persist only non-sensitive Agent init progress with atomic and concurrency-safe recovery.

#### Scenario: Run is not an authorization credential
- **WHEN** a client resumes by run ID
- **THEN** the server revalidates the current Operator, Tenant, account, grant and scopes before returning or advancing state

#### Scenario: Concurrent resume is rejected
- **WHEN** two runners attempt to advance the same run version
- **THEN** lease/CAS semantics allow one transition and return a stable conflict error to the other without repeating side effects

#### Scenario: Idempotent result contains no secret
- **WHEN** an init operation records material or draft reconciliation data
- **THEN** it stores only non-sensitive identifiers, hashes, status, versions, timestamps and expiry data

### Requirement: Audit logging
The system SHALL retain key audit logs for 180 days.

#### Scenario: Key operation audited
- **WHEN** login, credential configuration, publish, delete, billing change, quota rejection, or session revocation occurs
- **THEN** the system writes a tenant-scoped audit event without raw secrets

#### Scenario: Audit retention
- **WHEN** audit events are older than 180 days
- **THEN** the system may purge them according to retention policy

### Requirement: Operator session isolation
The system SHALL require explicit OAuth security scopes before exposing or revoking an Operator's Web and OAuth sessions.

#### Scenario: Low-privilege client cannot inspect sessions
- **WHEN** an OAuth client without `woa:security:read` requests the Operator session list
- **THEN** the system rejects the request before reading session or Provider grant data

#### Scenario: Low-privilege client cannot revoke another client
- **WHEN** an OAuth client without `woa:security:write` requests session revocation
- **THEN** the system rejects the request before revoking a Web session or OAuth Provider grant

### Requirement: Public signup abuse controls
The system SHALL protect public signup with Turnstile, rate limits, quotas, and audit logs.

#### Scenario: Rate limit enforced
- **WHEN** a single IP, email, or provider subject exceeds configured signup/login limits
- **THEN** the system rejects further attempts before sending email codes or creating sessions

### Requirement: Legal and support pages
The Web entrypoint SHALL expose minimal Terms, Privacy, and support contact information.

#### Scenario: Legal pages available
- **WHEN** a public visitor opens Terms or Privacy routes
- **THEN** the Web entrypoint returns pages explaining SaaS usage, WeChat credential handling, payment processing, and data retention

#### Scenario: Support contact visible
- **WHEN** legal, billing, error, or onboarding support copy is shown
- **THEN** it includes `support@ziikoo.app` as the public support contact where appropriate

### Requirement: Monitoring signals
The system SHALL surface production monitoring signals for onboarding-critical failures.

#### Scenario: Critical failure monitored
- **WHEN** Worker errors, OAuth/login failures, credential validation failures, Stripe webhook failures, or quota rejections occur
- **THEN** the system records enough structured signal to diagnose the issue

### Requirement: Data retention
The system SHALL limit retention for uploaded media inputs and inbound messages.

#### Scenario: R2 media input retention
- **WHEN** platform R2 media input objects exceed 30 days of age
- **THEN** the system may delete them according to retention policy

#### Scenario: Inbound message retention
- **WHEN** inbound inbox messages exceed 90 days of age
- **THEN** the system may delete them according to retention policy

### Requirement: Legacy migration guardrails
The system SHALL purge legacy WeChat secrets during identity migration and accept short WeChat API downtime.

#### Scenario: Legacy secrets purged
- **WHEN** the new identity migration runs
- **THEN** legacy AppSecret, webhook credentials, and access tokens are removed or made inactive before public onboarding can use them

#### Scenario: Reconfiguration required
- **WHEN** an Operator claims the legacy default Tenant shell after migration
- **THEN** the WeChat resource remains unconfigured until fresh credentials are submitted and validated

### Requirement: Production operations posture
The system SHALL use `https://woa.ziikoo.app` as production origin and Cloudflare runtime secrets for business secrets.

#### Scenario: Production origin used
- **WHEN** the system generates OAuth callbacks, Stripe URLs, MCP config, or email links
- **THEN** it uses `https://woa.ziikoo.app` for the first release

#### Scenario: Runtime secrets not stored in GitHub CI
- **WHEN** production runtime secrets are configured
- **THEN** GitHub Actions stores deployment credentials only and runtime business secrets live in Cloudflare bindings or Secrets Store

### Requirement: Direct production verification posture
The release SHALL verify onboarding directly in production according to confirmed risk decisions.

#### Scenario: Live Stripe verification
- **WHEN** subscription checkout smoke testing is performed
- **THEN** it uses live Stripe mode and treats payments/subscriptions as real operations

#### Scenario: D1 direct migration
- **WHEN** the onboarding migration runs
- **THEN** it may run against production D1 without a required pre-migration backup according to the accepted risk decision
