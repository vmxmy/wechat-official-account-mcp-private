## ADDED Requirements

### Requirement: CLI runtime uses the approved Node and Ink baseline
The published CLI MUST declare Node.js 20 or newer and SHALL use Ink 6 with the existing React 19 runtime for its interactive terminal interface.

#### Scenario: Install on the minimum supported Node release
- **WHEN** the packed npm artifact is installed and exercised with Node.js 20
- **THEN** its public module import, CLI help, plain mode, JSONL mode, and interactive entrypoint load successfully

#### Scenario: Node 18 is outside the compatibility contract
- **WHEN** a consumer inspects the published package metadata
- **THEN** the engine requirement states Node.js `>=20.0.0` and project CI does not claim Node.js 18 compatibility

### Requirement: Human operators can launch an interactive console
The CLI SHALL expose `woa ui` as an Ink terminal application only for directly operated interactive TTY sessions.

#### Scenario: Launch from an interactive terminal
- **WHEN** a human runs `woa ui` with TTY stdin and stdout outside CI and Agent mode
- **THEN** the CLI opens an interactive onboarding shell with start, compatible-resume, status, and exit actions

#### Scenario: Reject a non-interactive console launch
- **WHEN** `woa ui` is invoked from a pipe, CI, Agent mode, `TERM=dumb`, or another non-interactive environment
- **THEN** the CLI exits non-zero without terminal control sequences and directs the caller to ordinary commands, `woa init --plain`, or JSONL mode as appropriate

### Requirement: Interactive onboarding reuses the authoritative workflow
The Ink onboarding experience SHALL render and control the existing `InitRun` state machine through validated `InitProtocolEvent` and `InitRendererAction` values without implementing workflow transitions or remote effects inside React components.

#### Scenario: Start onboarding from the console
- **WHEN** the operator chooses to start onboarding in `woa ui`
- **THEN** the CLI creates and runs an initialization checkpoint through the same runner, store, and effects used by `woa init`

#### Scenario: Resume a compatible checkpoint
- **WHEN** the console finds a paused or recoverable initialization run created by the current compatible CLI version and the operator chooses resume
- **THEN** the existing run is leased and resumed without recreating completed phases

#### Scenario: Use interactive woa init
- **WHEN** a human runs `woa init` in a supported interactive TTY without requesting plain or Agent output
- **THEN** the CLI uses the shared Ink onboarding components and preserves the existing phase, checkpoint, confirmation, and exit-code semantics

### Requirement: The TUI keeps workflow context visible and responsive
The Ink onboarding screen SHALL continuously present overall phase progress, the current required action, recoverable error information, available choices, and key help without hiding required operational values.

#### Scenario: Render a wide terminal
- **WHEN** the terminal is at least 60 columns wide
- **THEN** the screen presents the progress rail and current-action context in a stable readable layout with a visible focused action

#### Scenario: Render a narrow terminal
- **WHEN** the terminal is narrower than 60 columns or is resized below that width
- **THEN** the screen switches to a stacked compact layout while keeping required IPs, URLs, error codes, resume commands, and confirmation consequences readable

#### Scenario: Render a paused or failed run
- **WHEN** the initialization event is paused, recoverably failed, unsupported, or complete
- **THEN** the screen shows the authoritative status and the exact safe recovery or completion guidance supplied by the workflow

### Requirement: TUI actions remain safe and explicit
The interactive interface MUST preserve user-only action boundaries and SHALL present consequential actions with their target and effect before returning a typed confirmation action.

#### Scenario: Confirm the test draft
- **WHEN** the workflow requests confirmation for its unpublished test draft
- **THEN** the TUI states that publishing will not occur and offers distinct confirm, decline, and pause actions

#### Scenario: Handle a user-only browser or allowlist action
- **WHEN** the workflow requests browser authorization, an IP allowlist update, or another human-only action
- **THEN** the TUI presents the server-sourced value and does not allow Agent, pipe, or CI execution to acknowledge it

#### Scenario: Preview an error without leaking input
- **WHEN** an operation fails after receiving sensitive configuration or OAuth state
- **THEN** the TUI shows a stable error code and redacted recovery message without rendering credentials, tokens, or raw secure-input buffers

### Requirement: Secrets remain outside the Ink component tree
The CLI MUST NOT collect or retain reusable credentials in ordinary Ink component state, props, logs, snapshots, or terminal frames.

#### Scenario: Credential configuration is required
- **WHEN** onboarding reaches a credential step
- **THEN** the TUI delegates to the existing one-time HTTPS handoff or a separately owned trusted no-echo terminal input path and receives only a redacted completion result

#### Scenario: Trusted terminal input is needed
- **WHEN** an approved operation requires direct no-echo input
- **THEN** Ink releases terminal input ownership before the secure reader starts and restores the TUI only after the sensitive buffer has been discarded

### Requirement: Cancellation preserves recoverability and terminal state
The Ink host SHALL checkpoint recoverable workflow state before normal interactive cancellation and MUST restore terminal modes on every exit path.

#### Scenario: Pause with q
- **WHEN** the operator presses `q` during an actionable onboarding phase
- **THEN** the run is checkpointed as paused, the TUI exits successfully, and a plain resume command is printed after terminal restoration

#### Scenario: Interrupt with Ctrl+C
- **WHEN** the operator presses Ctrl+C during onboarding
- **THEN** the runner attempts the existing interrupt checkpoint, exits with the established interrupt status, and restores raw mode, cursor visibility, screen buffer, timers, and listeners

#### Scenario: Renderer failure
- **WHEN** the Ink component tree throws or terminal rendering fails
- **THEN** cleanup is idempotently completed, an already persisted checkpoint remains usable, and the CLI exits non-zero with a redacted error

### Requirement: Automation and accessible fallbacks remain stable
Introducing Ink SHALL NOT change the existing non-interactive contracts for plain output, Agent JSONL, piped execution, or one-shot JSON commands.

#### Scenario: Explicit plain onboarding
- **WHEN** a human runs `woa init --plain` or sets the established plain-mode environment control
- **THEN** the CLI uses the control-sequence-free plain renderer and does not initialize Ink

#### Scenario: Agent or CI onboarding
- **WHEN** onboarding runs with `--agent --format jsonl`, in CI, or through non-TTY streams
- **THEN** it emits only validated JSONL protocol events with no prompts, Ink frames, colors, or cursor-control sequences

#### Scenario: No-color interactive onboarding
- **WHEN** an interactive operator sets `NO_COLOR`
- **THEN** the Ink layout remains usable without color being the only indicator of progress, focus, errors, or completion

#### Scenario: Existing one-shot command
- **WHEN** a caller runs an existing command such as `woa api list`, `woa draft list`, or `woa mcp descriptor`
- **THEN** its documented output and exit behavior remain unchanged and no Ink application is mounted

### Requirement: Interactive behavior is regression tested
The project SHALL include deterministic component, pseudo-TTY, and packed-package tests for the Ink interface and preserved fallback contracts.

#### Scenario: Component interaction test
- **WHEN** tests render onboarding fixtures and send keyboard input through an Ink test renderer
- **THEN** they can assert wide and narrow frames, focus movement, action results, error states, and the absence of sensitive fields without a real terminal

#### Scenario: Packed minimum-runtime test
- **WHEN** CI installs the packed package under Node.js 20 and exercises TTY, plain, JSONL, signal, and help flows
- **THEN** all flows satisfy their output, cleanup, exit-code, and redaction contracts
