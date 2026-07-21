## Why

The current CLI has a safe progressive onboarding flow, but its Clack renderer presents one prompt at a time and cannot provide the persistent context, responsive layout, focus management, and testable screen states needed for a richer human-operated console. The repository already uses TypeScript, React 19, and a pure onboarding state machine, so Ink is the lowest-friction path to a maintainable full-screen TUI without duplicating OAuth or MCP logic in another language.

## What Changes

- Add an Ink 6 interactive terminal application exposed through `woa ui` for directly operated TTY sessions.
- Replace the human TTY renderer used by `woa init` with a shared Ink onboarding screen that preserves the existing state machine, checkpoints, secure handoffs, pause/resume semantics, and server-sourced evidence.
- Keep `woa init --plain`, `woa init --agent --format jsonl`, non-TTY execution, CI behavior, and existing machine-readable command output as stable non-Ink paths.
- Add deterministic component and interaction tests for terminal frames, focus, keyboard input, resize behavior, cancellation, and cleanup.
- **BREAKING** Raise the published CLI runtime baseline from Node.js 18 to Node.js 20 and remove Node.js 18 from package and CI compatibility validation.
- Add Ink 6 and its supported terminal component/test dependencies while retaining React 19.

## Capabilities

### New Capabilities

- `interactive-cli-console`: Provides the Ink-based `woa ui` shell and shared interactive onboarding experience, including TTY gating, responsive rendering, accessibility fallback, safe lifecycle handling, and preservation of automation contracts.

### Modified Capabilities

None.

## Impact

- CLI entrypoint and rendering code under `src/cli/`, especially command routing, terminal capability detection, initialization rendering, signal cleanup, and secure-input boundaries.
- Package metadata and lockfile: Node.js engine requirement becomes `>=20`, Ink 6 is added, and the existing React 19 dependency remains authoritative.
- CI and package smoke coverage: Node.js 18 jobs are removed; Node.js 20 remains the minimum-version contract and newer release tooling may continue to use later Node versions.
- Published npm consumers running Node.js 18 must upgrade Node before installing the new major-compatible CLI release.
- Worker runtime, `/mcp`, REST APIs, WeChat API contracts, OAuth server behavior, storage, and MCP tool schemas are unchanged.
