## Context

`woa` is a remote-only TypeScript/Node CLI whose command entrypoint currently mixes command routing with REST, OAuth, and MCP orchestration. Human onboarding already has three deliberately separate render paths: a Clack prompt renderer for interactive terminals, a control-sequence-free plain renderer, and a strict JSONL renderer for Agents, pipes, and CI. The onboarding domain itself is in better shape than the renderer: `InitRun` is a pure state machine, `runInit` owns effects and checkpoints, and renderers receive validated `InitProtocolEvent` values and return typed actions.

The new TUI must preserve those boundaries. It cannot turn Ink into a second workflow engine, expose credentials to React state, change the remote-only runtime posture, or make machine-oriented commands depend on an interactive renderer. The published package currently claims Node.js 18 support and validates Node 18 and 20; Ink 6 and React 19 require raising the minimum to Node.js 20.

## Goals / Non-Goals

**Goals:**

- Provide a maintainable Ink 6 terminal shell through `woa ui` for directly operated interactive terminals.
- Reuse the same Ink onboarding components for the default interactive `woa init` experience.
- Preserve the existing onboarding state machine, action protocol, checkpoint storage, secure handoffs, signal semantics, and server-side validation.
- Keep plain and JSONL modes deterministic, control-sequence-free where required, and independent of Ink initialization.
- Support wide and narrow terminals, explicit no-color/plain operation, predictable focus, and complete terminal restoration.
- Establish Node.js 20 as the published minimum and test that exact minimum in the packed npm artifact.

**Non-Goals:**

- Rewriting REST, OAuth, MCP, secure configuration, or onboarding effects as React hooks.
- Adding account, draft, publish, inbox, media, billing, or general MCP-explorer screens in this first change.
- Replacing ordinary one-shot commands or their JSON output with an interactive interface.
- Supporting Node.js 18 after this breaking release.
- Accepting AppSecret, OAuth callback URLs, tokens, or other reusable credentials in ordinary Ink text inputs.
- Adding a local MCP server, daemon, database, stdio transport, or non-Worker production runtime.

## Decisions

### 1. Use Ink 6 on Node.js 20 with the existing React 19 toolchain

Add an Ink 6 release compatible with React 19 and declare `engines.node` as `>=20.0.0`. Keep JSX compilation in the existing TypeScript pipeline and use `.js` extensions for emitted ESM imports. Remove Node.js 18 from the CI matrix and packed-package smoke test; Node.js 20 becomes the required minimum-version lane.

This is preferred over Bubble Tea because it avoids a Go build, platform binaries, IPC, and duplicated OAuth/MCP clients. Ink 7 is not selected because it requires Node.js 22, which is a larger compatibility jump than the approved baseline. Ink 5 is not selected because it targets the older React generation and would retain a runtime that the project has chosen to drop.

### 2. Keep Ink behind an interactive command boundary

Add `woa ui` to the existing command router. It SHALL require directly operated TTY stdin/stdout and SHALL fail cleanly with guidance when invoked in a pipe, CI, Agent, `TERM=dumb`, or explicitly plain environment. The Ink module and TSX application SHALL be dynamically imported only after this gate so existing JSON, JSONL, help, and plain paths do not initialize Ink or emit terminal control sequences.

`woa init` continues to call `detectTerminalCapabilities`. Its interactive `tui` branch selects the Ink renderer; its `plain` and `jsonl` branches remain separate implementations. This preserves the existing externally visible mode-selection contract.

### 3. Make `woa ui` an onboarding shell, not a second backend

The first `woa ui` screen is a small shell that can start a new onboarding run, resume the latest compatible paused/recoverable run, show its current phase, or exit. Selecting start/resume delegates to the same `runInit`, `FileInitRunStore`, and effect construction used by `woa init`. There are no placeholder operational screens in the MVP.

The shell runs in Ink's alternate screen so it does not pollute shell history. After unmount, the CLI writes one concise plain-text completion, error, or resume summary to the primary screen. The standalone `woa init` Ink flow uses the same host and summary behavior for consistency.

### 4. Adapt the existing renderer interface to one persistent React mount

Implement an `InkInitRenderer` that still satisfies `InitRenderer`. On its first `render(event)` call it creates one Ink instance and an internal controller. Later calls update the event presented to the mounted component rather than mounting a new React tree. Each call returns a promise resolved by the next typed UI action.

The controller is a narrow bridge:

```text
runInit -> InitProtocolEvent -> InkInitRenderer/controller -> React props
runInit <- InitRendererAction <- controller/action promise <- key selection
```

The renderer does not perform network requests, write checkpoints, or transition `InitRun`. React state is limited to presentation concerns such as focus, selected action, compact layout, and temporary status text. The runner remains the sole owner of workflow effects and persisted state.

### 5. Build a small project-owned component surface

Use Ink primitives (`Box`, `Text`, input/focus/window hooks) and project-owned components instead of adopting a large third-party widget suite. The initial component surface consists of an app shell, step rail, current-action panel, recovery/error panel, action menu, and key-help footer. This keeps Chinese-width behavior, terminology, confirmation semantics, and snapshot output under project control.

At widths below 60 columns the layout stacks vertically, uses short action labels, and omits decorative borders before truncating required content. At wider widths the step rail and current action may render side by side. Required IP addresses, URLs, error codes, resume commands, and confirmation consequences must wrap rather than disappear.

### 6. Preserve security boundaries outside React state

Ink components receive only the already-approved `InitProtocolEvent` projection and typed action metadata. They SHALL NOT receive the saved OAuth configuration, access/refresh tokens, client secrets, AppSecret, raw credential handoff submissions, or full secure-input buffers.

If an operation needs trusted no-echo terminal input, the Ink host must unmount or suspend terminal ownership before delegating to the existing `readSecureInput` path, then remount only with the redacted result state. The initial onboarding MVP continues to prefer the one-time HTTPS credential handoff and therefore does not add an Ink secret field. Debug output rendered inside the UI must use the existing redaction rules and a bounded event projection rather than arbitrary object serialization.

### 7. Make cancellation and cleanup explicit

Ink's automatic Ctrl+C exit is disabled for the onboarding app. `q` requests a normal pause and Ctrl+C returns an interrupt action so `runInit` can checkpoint before exiting with its existing exit-code semantics. Process signals continue to be owned by the runner. The host awaits Ink unmount, restores raw mode/cursor/screen state, disposes listeners, stops timers, and only then prints the final plain summary.

Unexpected render errors use an error boundary, trigger cleanup, and return a non-zero CLI failure without swallowing an already persisted checkpoint. `restore()` remains idempotent so runner cleanup and error cleanup can safely converge.

### 8. Test components and the packed CLI at their natural boundaries

Use an Ink-compatible testing library to assert deterministic frames and keyboard actions without a real terminal. Component tests cover wide/narrow layouts, focus movement, action selection, errors, paused/done states, color-disabled output, and the absence of credential fields. Integration tests use pseudo-TTY execution to verify mode routing, Ctrl+C/q checkpoint behavior, alternate-screen and cursor restoration, final summary output, and absence of ANSI in plain/JSONL modes.

The packed npm smoke test runs under Node.js 20 and continues to validate imports, version/help, descriptor output, plain onboarding, JSONL onboarding, signal handling, and secret redaction.

## Risks / Trade-offs

- [Node.js 18 consumers can no longer install or run the next release] -> Publish the change as a breaking release, declare `>=20.0.0`, document the upgrade, and test the packed artifact with Node.js 20.
- [Ink adds package size and renderer lifecycle complexity] -> Keep the component set small, dynamically load the TUI, and avoid adding a general UI kit until repeated needs justify it.
- [Raw mode or alternate-screen cleanup can fail on signals or render errors] -> Keep signal ownership in `runInit`, make renderer restoration idempotent, add pseudo-TTY signal tests, and print summaries only after unmount.
- [React state or debug rendering could accidentally retain sensitive values] -> Pass only validated protocol projections, prohibit secret fields, reuse redaction, and test output for known secret key patterns.
- [Different terminals render CJK width, color, or resize behavior differently] -> Provide a stacked narrow layout, respect `NO_COLOR`/plain selection, avoid layout-critical emoji, and keep required values as wrapping text.
- [`woa ui` could drift into a parallel command implementation] -> Require all actions to delegate to existing runner/service modules; future screens must follow the same separation before being added.

## Migration Plan

1. Update the Node engine, CI minimum lane, packed-package smoke matrix, Ink dependency, and documentation as one breaking compatibility change.
2. Introduce the Ink host/controller and project-owned components behind dynamic interactive imports while retaining the Clack renderer until parity tests pass.
3. Route interactive `woa init` and the new `woa ui` onboarding shell to Ink, then remove the unused Clack dependency and renderer code.
4. Run the repository's full release validation plus pseudo-TTY and packed Node.js 20 checks before publishing the next breaking CLI release.
5. Rollback requires only restoring the previous CLI package version, command routing, dependency set, and Node 18 matrix; there is no server or persisted-data migration.

## Open Questions

None for the MVP. Additional operational screens require separate capability proposals after the onboarding shell is validated in real terminals.
