## ADDED Requirements

### Requirement: Webhook endpoint with signature verification
The system SHALL expose `GET` and `POST /wx/callback` on the Worker to receive WeChat server verification and inbound messages/events. In plaintext mode, the endpoint SHALL verify `signature` using SHA1 over the sorted values `token`, `timestamp`, and `nonce`. In encrypted/safe mode (`encrypt_type=aes`), the endpoint SHALL verify `msg_signature` using SHA1 over the sorted values `token`, `timestamp`, `nonce`, and the XML `Encrypt` value; it SHALL NOT use `signature` to validate encrypted messages. Invalid signatures SHALL be rejected with 403.

#### Scenario: WeChat server verification handshake
- **WHEN** WeChat sends `GET /wx/callback?signature=...&echostr=...&timestamp=...&nonce=...` with a valid plaintext signature
- **THEN** the server returns the `echostr` plaintext to complete binding

#### Scenario: Invalid plaintext signature rejected
- **WHEN** a plaintext request to `/wx/callback` carries a `signature` that does not match SHA1 over sorted `token`, `timestamp`, and `nonce`
- **THEN** the server returns 403 and performs no further processing

#### Scenario: Invalid encrypted signature rejected
- **WHEN** an encrypted request to `/wx/callback?encrypt_type=aes&msg_signature=...` carries a `msg_signature` that does not match SHA1 over sorted `token`, `timestamp`, `nonce`, and XML `Encrypt`
- **THEN** the server returns 403 and performs no further processing

### Requirement: Synchronous persistence and acknowledgement within WeChat timeout
On a verified `POST /wx/callback`, the system SHALL verify, decrypt if needed, persist the inbound message/event to D1, and then acknowledge to WeChat with an empty body or `success` within WeChat's ~5-second timeout. The system SHALL NOT perform any downstream processing, outbound API call, AI inference, or dispatch before acknowledgement. If persistence fails, the system MAY fail the request so that WeChat retries, preserving at-least-once delivery.

#### Scenario: Persist then acknowledge within timeout
- **WHEN** a verified inbound message arrives
- **THEN** the server verifies/decrypts it, inserts the D1 record, and responds to WeChat within 5 seconds

#### Scenario: Processing does not block acknowledgement
- **WHEN** a verified inbound message arrives
- **THEN** the server does not wait for any reply decision, outbound WeChat API call, MCP notification, or external-agent action before returning `success`/empty body

### Requirement: Encrypted payload support
When `encoding_aes_key` is configured and `encrypt_type=aes`, the system SHALL decrypt the WeChat `Encrypt` field using AES-CBC-256 with PKCS#7 padding and the configured EncodingAESKey. The decrypted payload format SHALL be `random(16B) + msg_len(4B network byte order) + msg + appid`, and the system SHALL validate that the decrypted appid matches the configured `WECHAT_APP_ID` before accepting the message.

#### Scenario: Encrypted message decrypted
- **WHEN** an inbound payload contains an `<Encrypt>` block with a valid `msg_signature`
- **THEN** the system decrypts it, validates appid, extracts the inner XML message/event, and continues to D1 persistence

#### Scenario: Decrypted appid mismatch rejected
- **WHEN** the decrypted payload appid does not match the configured `WECHAT_APP_ID`
- **THEN** the server rejects the request and does not persist the message

### Requirement: Persist inbound messages to D1
The system SHALL persist every verified (and decrypted, if applicable) inbound message/event to a new `inbound_messages` table in D1 with at least: an internal id, a `dedup_key`, `to_user_name`, `from_user_name` (OpenID), message type (`text`/`image`/`event`/...), event type (nullable), raw XML, parsed JSON payload, `CreateTime`, `received_at`, and `processed_at` (nullable, null = pending). For ordinary messages, `dedup_key` SHALL use `MsgId` when present. For events that do not include `MsgId`, `dedup_key` SHALL be deterministically derived from stable fields such as `FromUserName`, `CreateTime`, `MsgType`, `Event`, `EventKey`, `Ticket`, and/or other event-specific identifiers. The webhook handler SHALL write this record; it SHALL NOT process, dispatch, or reply to the user.

#### Scenario: Text message persisted as pending
- **WHEN** WeChat POSTs a verified text-message XML containing `MsgId`
- **THEN** a row is inserted into `inbound_messages` with `dedup_key = MsgId`, type `text`, the OpenID, parsed content, `processed_at = NULL`, and the handler returns `success`/empty body to WeChat

#### Scenario: Event persisted as pending
- **WHEN** a `subscribe` / `SCAN` / `LOCATION` / `CLICK` / `VIEW` event arrives and verifies
- **THEN** it is inserted into `inbound_messages` with type `event`, its event type and payload, a deterministic event `dedup_key`, and `processed_at = NULL`

#### Scenario: Replay/dedup is idempotent
- **WHEN** WeChat retries the same message or event
- **THEN** the system does not insert a duplicate row (enforced by a uniqueness constraint on `dedup_key`)

### Requirement: MCP tool exposes inbound message querying and processing-state updates
The system SHALL expose a new MCP tool `wechat_inbox` (registered alongside the existing 15 tools via `McpAgent.init()`) so that an **external** AI agent can query and process inbound messages on its own schedule. The Worker SHALL NOT run any cron, scheduler, Agent loop, or autonomous processing of inbound messages — all processing is driven by the external agent calling this tool. The tool SHALL support at minimum:
- `action: "list_pending"` — return pending rows (`processed_at IS NULL`), paginated, newest-first, with optional type/openid filters
- `action: "list_all"` — return any rows matching filters (including processed), with pagination
- `action: "get"` — return a single message by id
- `action: "mark_processed"` — set `processed_at` (and optional processing note) on one message or a batch, returning updated counts

#### Scenario: External agent lists pending messages
- **WHEN** an authorized client calls `wechat_inbox` with `action="list_pending"`
- **THEN** the tool returns pending rows (`processed_at IS NULL`) newest-first, with pagination metadata

#### Scenario: External agent marks a message processed
- **WHEN** an authorized client calls `wechat_inbox` with `action="mark_processed"` and a message id (or list)
- **THEN** the tool sets `processed_at` on the matching rows and returns the count updated

#### Scenario: External agent filters by type/openid
- **WHEN** `list_pending` or `list_all` is called with `type="text"` and/or `openid=...`
- **THEN** the result is filtered accordingly

#### Scenario: Tool is the only processing path
- **WHEN** no external agent is connected or calling the tool
- **THEN** pending messages accumulate in `inbound_messages` unchanged; no server-side process auto-handles them

### Requirement: Webhook does not dispatch or process inline
The webhook handler SHALL NOT call any outbound WeChat API, push to any MCP session, schedule any task, or process messages. Its only job is verify → decrypt → persist → ack. All processing and replying is the responsibility of the external agent that consumes the `wechat_inbox` tool.

#### Scenario: Webhook stays write-only
- **WHEN** an inbound message is verified and persisted
- **THEN** no outbound WeChat call, no MCP notification, and no scheduled task happens in the request that handled the webhook
