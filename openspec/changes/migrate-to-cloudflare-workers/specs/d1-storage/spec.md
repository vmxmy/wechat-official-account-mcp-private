## ADDED Requirements

### Requirement: D1-backed storage implementation
The system SHALL provide a D1-backed implementation of the existing `StorageManager` interface covering the six tables (`config`, `access_tokens`, `media`, `permanent_media`, `drafts`, `publishes`), using the same schema and query semantics as the current SQLite implementation. The Node `sqlite3` implementation SHALL remain for stdio/local mode.

#### Scenario: Same CRUD on both backends
- **WHEN** the same sequence of `getConfig`/`saveConfig`, `saveMedia`/`getMedia`, draft and publish operations runs on D1 and on local SQLite
- **THEN** both backends return identical results

#### Scenario: D1 schema applied by migration
- **WHEN** the Worker is deployed for the first time
- **THEN** a D1 migration creates all six tables with the existing column definitions and the deployment succeeds without manual SQL

### Requirement: Selectable backend by runtime
`StorageManager` SHALL select its backend based on the runtime (D1 binding on Workers, `sqlite3` on Node) behind one interface, so tool handlers and `AuthManager` remain backend-agnostic.

#### Scenario: Handler code unchanged
- **WHEN** a tool handler calls `storageManager.saveMedia(...)`
- **THEN** the call works on both Workers (D1) and Node (SQLite) without the handler knowing which backend is active

### Requirement: Field-level encryption retained
The D1 implementation SHALL preserve AES-256 field-level encryption of sensitive fields (`app_secret`, `token`, `encoding_aes_key`, `access_token`) with the `enc:` prefix convention when `WECHAT_MCP_SECRET_KEY` is set. On Workers the key SHALL be sourced from Cloudflare Secrets Store, not plaintext env.

#### Scenario: Secret encrypted at rest on D1
- **WHEN** the app secret is saved with a configured secret key
- **THEN** the value stored in D1 begins with `enc:` and decrypts correctly on read
