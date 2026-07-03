## ADDED Requirements

### Requirement: Remote-only CLI runtime
The CLI SHALL operate as a remote client for the production server and SHALL NOT run a local MCP server, local stdio transport, SSE transport, or local WeChat API runtime.

#### Scenario: CLI help
- **WHEN** a user runs CLI help
- **THEN** the CLI documents remote server configuration and does not advertise local `wechat-mcp mcp -a -s` server mode

#### Scenario: WeChat operation
- **WHEN** a user lists drafts through the CLI
- **THEN** the CLI calls the remote API or MCP endpoint with OAuth credentials rather than using local WeChat app secrets

### Requirement: CLI OAuth login
The CLI SHALL authenticate through the unified OAuth authority and store only OAuth client/session tokens locally.

#### Scenario: Login starts browser flow
- **WHEN** a user runs `woa login --server https://woa.ziikoo.app`
- **THEN** the CLI starts an OAuth authorization flow against that server

#### Scenario: Local token storage
- **WHEN** login succeeds
- **THEN** the CLI stores OAuth tokens in a local user config with restrictive permissions and does not store WeChat app secrets

### Requirement: CLI tenant and account commands
The CLI SHALL provide commands to inspect the current user, list/select tenants, list/select accounts, and configure account credentials through remote protected APIs.

#### Scenario: Whoami
- **WHEN** a user runs `woa whoami`
- **THEN** the CLI displays the authenticated user, active tenant/account, and available scopes

#### Scenario: Configure account
- **WHEN** a tenant admin runs `woa account configure --tenant T --account A --app-id ... --app-secret ...`
- **THEN** the CLI sends credentials to the remote API over HTTPS and does not persist the app secret locally after the request completes

### Requirement: CLI WeChat operation commands
The CLI SHALL provide common account-scoped commands for drafts, publish records, inbox, account status, and token refresh.

#### Scenario: Draft list
- **WHEN** a user runs `woa draft list --account A`
- **THEN** the CLI lists drafts for account `A` using server-side account authorization and official default pagination limits

#### Scenario: Inbox list
- **WHEN** a user runs `woa inbox list --account A`
- **THEN** the CLI displays inbound messages from account `A` only

### Requirement: CLI MCP client configuration helpers
The CLI SHALL optionally write Codex, Claude Code, or other supported client MCP configuration pointing to the remote `/mcp` endpoint.

#### Scenario: Configure Codex MCP
- **WHEN** a user runs `woa mcp config codex --server https://woa.ziikoo.app`
- **THEN** the CLI writes a Streamable HTTP MCP config using `https://woa.ziikoo.app/mcp` and OAuth settings

#### Scenario: No local WeChat credentials in MCP config
- **WHEN** the CLI writes MCP client configuration
- **THEN** the generated config does not include WeChat app ID or app secret
