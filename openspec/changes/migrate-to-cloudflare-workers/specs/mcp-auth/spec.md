## ADDED Requirements

### Requirement: OAuth 2.0 on the MCP endpoint
The `/mcp` endpoint SHALL be protected by OAuth 2.0 using `@cloudflare/workers-oauth-provider` (authorization-code flow with PKCE). Anonymous access to `tools/call` SHALL be rejected. Authenticated caller identity and tokens SHALL be available to tools via the `McpAgent` `props`.

#### Scenario: Anonymous tool call rejected
- **WHEN** a client calls `tools/call` without a valid OAuth access token
- **THEN** the server rejects the request with 401 before any tool executes

#### Scenario: Authenticated identity reaches tools
- **WHEN** an authenticated client calls a tool
- **THEN** the handler can read the caller's identity (e.g. userId) from `this.props` to scope operations

### Requirement: Unauthenticated REST tool surface removed
The system SHALL remove the unauthenticated `POST /api/wechat/tools/:toolName` route and SHALL NOT expose a tool-execution surface that bypasses OAuth. **BREAKING** for existing REST consumers.

#### Scenario: Old REST route gone
- **WHEN** a legacy client POSTs to `/api/wechat/tools/wechat_draft`
- **THEN** the server returns 404 (route removed), never executes the tool

### Requirement: Secrets sourced from Secrets Store
Credentials and signing keys (`WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `WECHAT_MCP_SECRET_KEY`, OAuth client secrets, WeChat webhook token/`EncodingAESKey`) SHALL be stored in Cloudflare Secrets Store / Worker secrets and SHALL NOT appear in `wrangler.jsonc` or plaintext env.

#### Scenario: No secrets in config files
- **WHEN** inspecting `wrangler.jsonc` and committed config
- **THEN** no secret value is present; all secrets are referenced as bindings set via `wrangler secret` or Secrets Store
