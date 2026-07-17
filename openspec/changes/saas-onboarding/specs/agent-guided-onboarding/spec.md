## ADDED Requirements

### Requirement: Stateless Agent-first public handoff
The system SHALL provide a public, stateless onboarding handoff that gives any command-capable Agent one current bootstrap prompt.

#### Scenario: Public page provides one primary action
- **WHEN** a visitor opens the public root route
- **THEN** the page explains the WeChat MCP value, presents one prompt and one `复制给 Agent` action, and does not require authentication or connection polling

#### Scenario: Public page does not duplicate workflow knowledge
- **WHEN** onboarding steps, endpoints, client commands, or OAuth behavior change
- **THEN** the public page continues to bootstrap `woa help agent` instead of shipping a second workflow or client-specific adapter

### Requirement: Versioned CLI Agent Help
The CLI SHALL bundle a versioned, offline Agent onboarding contract exposed by `woa help agent`.

#### Scenario: Agent Help is available offline
- **WHEN** an Agent runs `woa help agent --format markdown` or `--format json` from an installed exact CLI version
- **THEN** the CLI renders the same structured manifest without fetching executable instructions from the server

#### Scenario: Agent Help remains client neutral and secret safe
- **WHEN** Agent Help is rendered
- **THEN** it contains no Codex/Claude/Kimi-specific branch, static Bearer header, argv AppSecret, complete OAuth callback URL handoff, or instruction to read local token storage

### Requirement: Single resumable init orchestration
The CLI SHALL use `woa init` as the only first-run orchestration entrypoint and SHALL persist non-secret, resumable progress.

#### Scenario: Human invocation uses progressive TUI
- **WHEN** stdin/stdout are interactive TTYs and a user runs `woa init`
- **THEN** the CLI shows one current action in a progressive TUI, preserves scrollback, and never enters alternate screen or clears completed history

#### Scenario: Plain mode remains fully operable
- **WHEN** a user selects `--plain`, `WOA_PLAIN=1`, or a dumb terminal
- **THEN** the same workflow is available with full ASCII text, no animation, color, single-key-only control, or cursor manipulation

#### Scenario: Agent and non-interactive modes never prompt
- **WHEN** `--agent` is used, CI is true, or either standard stream is not a TTY
- **THEN** the CLI emits a strict JSONL state event and exits without reading keys, callback URLs, or secrets

#### Scenario: Init resumes exact state safely
- **WHEN** a paused or interrupted run resumes
- **THEN** the CLI verifies current Operator/Tenant/account authority, locks the exact package version, uses CAS run versioning, and avoids repeating completed side effects

### Requirement: Stable Agent JSONL protocol
The init Agent protocol SHALL use a discriminated, secret-free JSONL envelope.

#### Scenario: JSONL event is machine safe
- **WHEN** init emits an Agent event
- **THEN** stdout contains one UTF-8 single-line JSON object with schema version, type, sequence, CLI/package version, run ID, run version, phase, typed payload, and structured resume data followed by a newline

#### Scenario: JSONL stdout remains pure
- **WHEN** init runs in Agent, pipe, or CI mode
- **THEN** stdout contains no ANSI, spinner, banner, pretty printing, logs, prompts, npm notices, secrets, or terminal control sequences

#### Scenario: Unknown executable data fails closed
- **WHEN** a server response contains an unknown action field or executable command text
- **THEN** the CLI rejects it and never copies server text into local command or argument fields

### Requirement: Human-only secure actions
The onboarding flow SHALL pause for human identity, consent, WeChat allowlist, secret input, target selection when ambiguous, and test-draft confirmation.

#### Scenario: Agent cannot read WeChat secret
- **WHEN** init reaches AppID/AppSecret configuration in Agent/JSONL/pipe/CI mode
- **THEN** it emits `secure_user_input` and pauses while the user enters credentials only through a same-Operator write-only HTTPS handoff

#### Scenario: Direct terminal secret input is hidden
- **WHEN** a directly operating user chooses the terminal fallback
- **THEN** an isolated secure-input module disables echo and prevents the secret or complete callback URL from entering events, checkpoints, configuration, logs, or Agent transcripts

### Requirement: Relay egress allowlist proof
The onboarding flow SHALL obtain current WeChat relay egress IPs from trusted deployment configuration and prove that the account allowlist accepts them.

#### Scenario: Current egress IPs require user action
- **WHEN** init reaches WeChat credential setup
- **THEN** it returns every current `WECHAT_EGRESS_IPS` value and pauses until the user reports saving them in the target WeChat account

#### Scenario: User confirmation is not proof
- **WHEN** the user confirms the allowlist action
- **THEN** the system performs a WeChat access-token request through the configured relay and marks the allowlist verified only after that request succeeds

### Requirement: Host-native OAuth and MCP evidence
The system SHALL distinguish CLI authorization/probes from the target host's own remote MCP authorization and tool calls.

#### Scenario: Host uses OAuth without static Bearer
- **WHEN** a supported host connects to `/mcp`
- **THEN** it discovers protected-resource metadata, completes PKCE authorization, receives refresh capability, and stores no static Authorization header in generated configuration

#### Scenario: CLI probe does not complete host state
- **WHEN** the CLI successfully logs in or performs its own MCP initialize/tools call
- **THEN** the run records diagnostic CLI evidence but does not mark host OAuth, host initialization, or host tool verification complete

#### Scenario: Host readiness uses real tool calls
- **WHEN** onboarding claims the target host is ready
- **THEN** that host has completed its own grant and MCP initialization and successfully called `woa_context` and `wechat_draft` count

### Requirement: Idempotent unpublished test draft
End-to-end onboarding SHALL create at most one confirmed, unpublished test draft per init run and read it back.

#### Scenario: Draft requires explicit confirmation
- **WHEN** the flow is ready to test a write operation
- **THEN** it shows the target account, title, cover and `只创建、不发布` consequence and waits for the user to confirm

#### Scenario: Draft retry is idempotent
- **WHEN** the same run retries after timeout, lost response, or host restart
- **THEN** the service reconciles the idempotency key and returns the same media ID instead of creating another material or draft

#### Scenario: Completion reads draft back
- **WHEN** the test draft is created
- **THEN** the host calls the draft get operation, verifies the expected title, reports the media ID, and never invokes publish
