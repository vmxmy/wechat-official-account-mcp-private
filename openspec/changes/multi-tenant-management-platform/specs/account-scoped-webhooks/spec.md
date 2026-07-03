## ADDED Requirements

### Requirement: Account-addressable callback route
The system SHALL expose WeChat callback routes that identify the target account before signature verification.

#### Scenario: Account route receives handshake
- **WHEN** WeChat sends a server verification request to `/wx/callback/:accountId`
- **THEN** the system resolves the account, loads that account's webhook token, verifies the signature, and returns the expected challenge response

#### Scenario: Unknown account route
- **WHEN** a callback request targets an unknown or disabled account ID
- **THEN** the system rejects the request and does not parse trusted message content

### Requirement: Per-account signature verification and decrypt
The system SHALL verify plaintext and encrypted WeChat callback signatures using the resolved account's webhook token and SHALL decrypt encrypted messages using that account's EncodingAESKey.

#### Scenario: Valid plaintext callback
- **WHEN** a plaintext callback has a valid signature for account `A1`
- **THEN** the system accepts and processes the message as account `A1`

#### Scenario: Invalid signature
- **WHEN** a callback signature does not match the resolved account token
- **THEN** the system returns 403 and does not write an inbound message row

#### Scenario: Encrypted callback appid mismatch
- **WHEN** an encrypted callback decrypts successfully but the decrypted appid does not match the configured app ID for the account
- **THEN** the system rejects the callback and does not write an inbound message row

### Requirement: Account-scoped inbox persistence
The system SHALL persist inbound callback messages with tenant and account identifiers and deterministic deduplication per account.

#### Scenario: Store inbound message
- **WHEN** a valid callback is received for account `A1`
- **THEN** the system inserts an inbound message row scoped to `A1` with parsed payload, raw XML, timestamps, and `processed_at` unset

#### Scenario: Retry deduplication
- **WHEN** WeChat retries the same callback for account `A1`
- **THEN** the system does not create duplicate pending messages for that account

#### Scenario: Same source message across accounts
- **WHEN** two accounts receive messages with overlapping WeChat identifiers
- **THEN** the deduplication keys remain account-scoped and do not suppress the other account's message

### Requirement: Webhook handler fast acknowledgement
The webhook handler SHALL only verify, decrypt if needed, persist, deduplicate, and acknowledge; it MUST NOT perform outbound WeChat API calls or AI inference inline.

#### Scenario: Valid message ack
- **WHEN** a valid callback is received
- **THEN** the handler writes the inbox row and returns the WeChat acknowledgement within the expected response window

#### Scenario: No inline outbound processing
- **WHEN** a callback message is stored
- **THEN** the handler does not send customer-service replies, trigger publish operations, or call external AI services inline

### Requirement: Old callback route migration guidance
The system SHALL handle the old single `/wx/callback` route with explicit migration guidance or a compatible default only when a safe single-account fallback is configured.

#### Scenario: Ambiguous old route
- **WHEN** `/wx/callback` receives a request in a multi-account deployment without a safe default
- **THEN** the system rejects the request with migration guidance and does not process ambiguous account data

#### Scenario: Documented migration
- **WHEN** account callback settings are viewed through API, MCP, or CLI
- **THEN** the system displays the correct account-addressable callback URL to configure in the WeChat dashboard
