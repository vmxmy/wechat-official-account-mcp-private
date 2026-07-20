## ADDED Requirements

### Requirement: CLI discovers the authoritative WeChat tool surface
The CLI SHALL connect to the configured OAuth-protected Streamable HTTP MCP endpoint and list the server-advertised `wechat_*` tools without maintaining a duplicated static tool catalog.

#### Scenario: List all WeChat tools
- **WHEN** an authenticated Operator runs `woa api list`
- **THEN** the CLI returns every server-advertised `wechat_*` tool with its name and description in machine-readable JSON

#### Scenario: Inspect a tool schema
- **WHEN** an authenticated Operator runs `woa api describe <wechat-tool>`
- **THEN** the CLI returns that tool's authoritative MCP input schema and metadata

### Requirement: CLI invokes every advertised WeChat tool
The CLI SHALL provide a generic call command capable of invoking every `wechat_*` tool returned by MCP `tools/list`, including tools added by compatible future server releases.

#### Scenario: Call a read action
- **WHEN** an Operator calls a discovered read action with valid JSON arguments
- **THEN** the CLI sends one MCP `tools/call` request and returns the complete MCP result as JSON

#### Scenario: Reject a non-WeChat management tool
- **WHEN** an Operator uses `woa api call` with a `woa_*` management tool
- **THEN** the CLI rejects the call and directs the Operator to the dedicated management command surface

#### Scenario: Propagate a tool error
- **WHEN** MCP returns a tool result with `isError: true`
- **THEN** the CLI prints the structured result and exits with a non-zero status

### Requirement: CLI accepts safe structured input
The CLI SHALL accept tool arguments from an inline JSON object, a JSON file, stdin, or an empty object, and SHALL reject ambiguous or non-object input.

#### Scenario: Read a JSON file
- **WHEN** an Operator passes `--file <path>` containing a JSON object
- **THEN** the CLI parses the file and uses that object as the tool arguments

#### Scenario: Read stdin
- **WHEN** an Operator passes `--stdin` and pipes a JSON object
- **THEN** the CLI reads the complete object without echoing it or adding it to command arguments

#### Scenario: Reject multiple sources
- **WHEN** more than one of `--input`, `--file`, or `--stdin` is supplied
- **THEN** the CLI exits before any remote request with a usage error

#### Scenario: Reject non-object JSON
- **WHEN** the selected input parses as an array, scalar, or null
- **THEN** the CLI exits before any remote request with a usage error

### Requirement: CLI preserves tenant and account isolation
The CLI SHALL resolve only accounts accessible to the current Operator and SHALL inject an account selection without overriding a valid explicit tool argument.

#### Scenario: Inject selected account
- **WHEN** a call omits `accountId` and the Operator supplies `--tenant` or `--account`
- **THEN** the CLI resolves an accessible account and injects its account ID before the MCP call

#### Scenario: Reject inaccessible account
- **WHEN** an Operator supplies an account outside the current OAuth context
- **THEN** the CLI rejects the call before invoking the tool

### Requirement: CLI protects high-impact actions
The CLI SHALL classify known destructive or broad-impact tool actions and require an exact confirmation value before invoking them.

#### Scenario: Refuse unconfirmed destructive action
- **WHEN** an Operator calls a protected action without `--confirm <tool>:<action>`
- **THEN** the CLI exits before MCP invocation and prints the required confirmation value

#### Scenario: Dry-run a protected action
- **WHEN** an Operator supplies `--dry-run` for any tool call
- **THEN** the CLI prints a redacted operation preview and performs no MCP network request

#### Scenario: Execute confirmed action
- **WHEN** an authorized Operator supplies the exact confirmation value for a protected action
- **THEN** the CLI invokes MCP and the server still enforces OAuth scope, tenant membership, quota, validation, and audit rules

### Requirement: CLI offers explicit complete WeChat authorization
The CLI SHALL retain least-privilege default login and SHALL provide an explicit scope profile that requests all scopes required by the current WeChat operating tools.

#### Scenario: Default login remains least privilege
- **WHEN** an Operator runs `woa login` without a scope profile
- **THEN** the CLI does not automatically request publish or inbox scope

#### Scenario: Request complete WeChat scope
- **WHEN** an Operator runs `woa login --scope-profile wechat-full`
- **THEN** the authorization request includes account read/write, content read/write/publish, context read, and inbox read scopes

#### Scenario: Explain missing scope recovery
- **WHEN** a tool call fails because the CLI grant lacks a required scope
- **THEN** the CLI reports the missing scope and a secret-free command for reauthorizing the CLI

### Requirement: CLI provides complete draft commands
The CLI SHALL expose add, update, get, count, list, and delete draft operations while preserving existing list/delete compatibility.

#### Scenario: Add a draft from file
- **WHEN** an Operator runs `woa draft add --file <json>` with valid article data
- **THEN** the CLI invokes `wechat_draft` action `add` for the selected account and returns the created draft result

#### Scenario: Update one draft article
- **WHEN** an Operator runs `woa draft update <mediaId> --index <n> --file <json>` with one article
- **THEN** the CLI invokes `wechat_draft` action `update` with that media ID, index, and article

#### Scenario: Get and count drafts
- **WHEN** an Operator runs `woa draft get <mediaId>` or `woa draft count`
- **THEN** the CLI invokes the corresponding MCP action and returns its result

### Requirement: CLI keeps credentials out of protocol output
The CLI SHALL reuse the saved refreshable OAuth session without placing reusable credentials in MCP descriptors, command output, dry-run previews, errors, or tool input logs.

#### Scenario: Refresh and retry MCP transport
- **WHEN** the saved access token requires refresh or the first MCP request returns 401
- **THEN** the CLI refreshes through the saved OAuth session, atomically stores rotated session state, and retries without printing either token

#### Scenario: Redact sensitive preview fields
- **WHEN** a dry-run input contains a key recognized as sensitive
- **THEN** the preview replaces its value with a redaction marker
