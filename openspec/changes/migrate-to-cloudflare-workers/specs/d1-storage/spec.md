## ADDED Requirements

### Requirement: D1-backed storage implementation
The system SHALL provide a D1-backed implementation of the `StorageManager` interface covering the HTTP-only runtime tables (`config`, `access_tokens`, `media`, `permanent_media`, `drafts`, `publishes`, and `inbound_messages` via the inbox store). Local SQLite storage SHALL NOT be part of the runtime or build output.

#### Scenario: D1 CRUD works
- **WHEN** `getConfig`/`saveConfig`, `saveMedia`/`getMedia`, token save/read/clear, and media list operations run on D1
- **THEN** they return the expected normalized TypeScript shapes

#### Scenario: D1 schema applied by migration
- **WHEN** the Worker is deployed for the first time
- **THEN** D1 migrations create the required tables and the deployment succeeds without manual SQL

### Requirement: Single HTTP runtime storage backend
`StorageManager` SHALL be backed by D1 in the HTTP-only runtime. Tool handlers SHALL remain storage-backend agnostic, but the repository SHALL NOT keep a Node SQLite implementation for local stdio.

#### Scenario: No local storage build artifact
- **WHEN** the production build completes
- **THEN** no `dist/src/storage/storage-manager.js` SQLite artifact is emitted

### Requirement: Field-level encryption retained
The D1 implementation SHALL preserve AES-256 field-level encryption of sensitive fields (`app_secret`, `token`, `encoding_aes_key`, `access_token`) with the `enc:` prefix convention when `WECHAT_MCP_SECRET_KEY` is set. On Workers the key SHALL be sourced from Cloudflare Secrets Store, not plaintext env.

#### Scenario: Secret encrypted at rest on D1
- **WHEN** the app secret is saved with a configured secret key
- **THEN** the value stored in D1 begins with `enc:` and decrypts correctly on read
