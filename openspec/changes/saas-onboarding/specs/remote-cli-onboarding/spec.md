## ADDED Requirements

### Requirement: npm-distributed remote CLI
The system SHALL distribute the remote-only CLI as the public npm package `@ziikoo/woa` exposing the `woa` command.

#### Scenario: CLI package name
- **WHEN** the CLI is published for public use
- **THEN** the npm package name is `@ziikoo/woa` and the executable command is `woa`

#### Scenario: CLI remains remote-only
- **WHEN** a user runs CLI commands
- **THEN** the CLI calls the hosted service and does not start a local MCP server, stdio transport, SSE transport, local SQLite runtime, or local WeChat API executor

### Requirement: CLI login and first registration
The CLI SHALL use `woa login` as the first registration and authorization flow.

#### Scenario: Login opens hosted authorization
- **WHEN** a user runs `woa login --server https://woa.ziikoo.app`
- **THEN** the CLI opens the hosted browser authorization flow and waits for the OAuth callback

#### Scenario: Email login primary in CLI authorization
- **WHEN** the CLI browser authorization page opens
- **THEN** email-code login is the primary path and GitHub is an alternative

#### Scenario: First login bootstraps Tenant
- **WHEN** CLI login completes for a new Operator
- **THEN** the server creates the Operator, default Tenant, and unconfigured WeChat resource according to the onboarding contract

### Requirement: CLI token storage
The CLI SHALL store only OAuth/session data locally and SHALL NOT store WeChat AppSecrets locally.

#### Scenario: Token saved locally
- **WHEN** CLI OAuth completes
- **THEN** the CLI saves OAuth token/session metadata with restrictive local file permissions

#### Scenario: WeChat secret not saved locally
- **WHEN** a user runs `woa account configure --app-id ... --app-secret ...`
- **THEN** the CLI sends the secret over HTTPS to the hosted API and does not persist it locally

### Requirement: CLI account onboarding commands
The CLI SHALL support Tenant/resource inspection, resource creation within allowance, default selection, credential configuration, and status.

#### Scenario: Account configure
- **WHEN** a user runs `woa account configure` with valid AppID/AppSecret
- **THEN** the hosted API validates credentials, activates the resource, and returns a secret-safe result

#### Scenario: Account create above allowance
- **WHEN** a user runs `woa account create` above the Tenant plan allowance
- **THEN** the CLI displays the plan-limit error and upgrade guidance from the server

#### Scenario: Set default account
- **WHEN** a user runs the CLI command to select a default WeChat resource
- **THEN** subsequent CLI commands that omit account ID target that default resource

### Requirement: CLI billing checkout
The CLI SHALL allow Tenant owners to initiate Stripe checkout for Plus or Pro.

#### Scenario: CLI checkout opens browser
- **WHEN** a user runs `woa billing checkout --plan plus` or `--plan pro`
- **THEN** the CLI requests a Checkout session, prints the URL, and attempts to open it in a browser

### Requirement: Generic CLI MCP descriptor
The CLI SHALL generate a client-neutral Streamable HTTP/OAuth descriptor without embedding OAuth tokens.

#### Scenario: Generate generic descriptor
- **WHEN** a user or Agent runs `woa mcp descriptor --format json`
- **THEN** the CLI outputs the hosted `/mcp` URL, Streamable HTTP transport, OAuth protected-resource/PKCE/refresh capabilities, and empty headers without a client-specific configuration shape

#### Scenario: Static Bearer configuration is never generated
- **WHEN** a user requests MCP connection information
- **THEN** the CLI does not output a bearer token, Authorization header, local stdio/SSE transport, or expiring token copy workflow

### Requirement: CLI-bundled Agent workflow
The CLI SHALL expose `woa help agent` as the only versioned Agent onboarding workflow source.

#### Scenario: Help formats share one manifest
- **WHEN** Agent Help is requested as Markdown or JSON
- **THEN** both formats render the same bundled manifest with CLI version, schema version, safety rules, capability checks, workflow, success criteria, and stop conditions

### Requirement: Guided CLI init
The CLI SHALL expose a resumable `woa init` command for first-run orchestration.

#### Scenario: Direct init guides a human
- **WHEN** a user runs `woa init` in an interactive terminal
- **THEN** the CLI uses a progressive TUI or explicit plain mode and displays only the current action, verified progress, and recovery path

#### Scenario: Agent init is non-interactive
- **WHEN** an Agent runs `woa init --agent --format jsonl`
- **THEN** the CLI emits typed state/action events and pauses instead of prompting for human identity, consent, secrets, or side-effect confirmation

### Requirement: CLI destructive confirmations
The CLI SHALL require explicit confirmation for delete operations.

#### Scenario: Delete without confirmation denied
- **WHEN** a user runs a delete command without the required confirmation marker
- **THEN** the CLI refuses to call the remote delete API
