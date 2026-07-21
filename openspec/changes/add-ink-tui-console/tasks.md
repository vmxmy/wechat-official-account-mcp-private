## 1. Runtime and dependency baseline

- [x] 1.1 Raise `package.json` `engines.node` to `>=20.0.0`, add an Ink 6 release compatible with React 19 plus the selected Ink test dependency, and regenerate the npm lockfile without changing Worker runtime dependencies.
- [x] 1.2 Remove Node.js 18 from the CLI CI matrix and packed-package smoke loop while retaining Node.js 20 as the explicit minimum-runtime lane.
- [x] 1.3 Update environment checks, help text, error messages, and test fixtures that still describe Node.js 18 as supported.

## 2. Reusable interactive initialization boundary

- [x] 2.1 Extract the initialization store/effect/runner construction currently embedded in CLI command handling into a reusable CLI module without changing plain or JSONL behavior.
- [x] 2.2 Extend terminal capability routing with an explicit directly operated TTY predicate for `woa ui`, including CI, Agent, `TERM=dumb`, and plain-mode rejection guidance.
- [x] 2.3 Add a dynamic Ink host import that is reachable only after interactive capability validation and verify ordinary commands can run without initializing Ink.

## 3. Ink onboarding components

- [x] 3.1 Implement project-owned Ink status mapping, step rail, current-action, recovery/error, action-menu, and key-help components using validated `InitProtocolEvent` data.
- [x] 3.2 Implement responsive wide and sub-60-column layouts that wrap required IPs, URLs, error codes, resume commands, and confirmation consequences.
- [x] 3.3 Implement keyboard and focus behavior for start, resume, status, open/acknowledge, confirm, decline, pause, and exit actions without relying on color as the only state indicator.
- [x] 3.4 Implement the `woa ui` onboarding shell that discovers the latest compatible initialization run and delegates new, resume, and status selections to the reusable initialization runner.

## 4. Persistent renderer and terminal lifecycle

- [x] 4.1 Implement `InkInitRenderer` as a persistent single-mount adapter from `InitProtocolEvent` updates to promised typed `InitRendererAction` results.
- [x] 4.2 Keep workflow transitions, remote effects, leases, and checkpoints in `runInit`; restrict React state to presentation and ensure sensitive OAuth/configuration objects cannot enter component props, state, debug output, or snapshots.
- [x] 4.3 Implement q and Ctrl+C handling through pause/interrupt actions so the runner checkpoints before returning the established exit codes.
- [x] 4.4 Implement idempotent unmount and restoration for raw mode, cursor visibility, alternate screen, listeners, timers, and render failures, then print one redacted plain completion/error/resume summary after restoration.
- [x] 4.5 Ensure any trusted no-echo input path releases Ink terminal ownership before calling the existing secure reader and remounts only after the sensitive buffer is discarded.

## 5. CLI routing and fallback preservation

- [x] 5.1 Add `woa ui` routing and help documentation with a non-interactive failure path that emits no ANSI and points callers to ordinary, plain, or JSONL commands.
- [x] 5.2 Route the interactive TTY branch of `woa init` to the shared Ink renderer while leaving `--plain`, `--agent --format jsonl`, pipe, and CI selection unchanged.
- [x] 5.3 Remove the superseded Clack progressive renderer and `@clack/prompts` dependency only after Ink parity tests pass; retain the standalone plain renderer.

## 6. Automated regression coverage

- [x] 6.1 Add Ink component tests for wide/narrow frames, resize behavior, focus movement, all action choices, paused/error/unsupported/done states, `NO_COLOR`, and required-value wrapping.
- [x] 6.2 Add renderer/controller tests proving a single persistent mount accepts successive protocol events and resolves exactly one typed action per actionable render.
- [x] 6.3 Add security assertions that terminal frames, summaries, thrown errors, and snapshots contain no AppSecret, access token, refresh token, client secret, raw OAuth callback, or secure-input buffer.
- [x] 6.4 Add pseudo-TTY integration tests for `woa ui`, interactive `woa init`, q pause, Ctrl+C interrupt, alternate-screen/cursor restoration, render failure cleanup, and final primary-screen summaries.
- [x] 6.5 Preserve and extend plain/JSONL tests to prove those paths do not import Ink or emit prompts, color, cursor controls, or alternate-screen sequences.
- [x] 6.6 Update packed-package compatibility tests to run under Node.js 20 and cover import, help, descriptor, `woa ui` gating, plain, JSONL, signal handling, exit codes, and redaction.

## 7. Documentation and release validation

- [x] 7.1 Update README installation/runtime guidance for Node.js 20+, document `woa ui`, and retain explicit guidance for `woa init --plain` and Agent JSONL use.
- [x] 7.2 Document the Node.js 18 removal as a breaking CLI compatibility change and note that Worker, MCP, OAuth, REST, and stored initialization data require no migration.
- [x] 7.3 Run `npm run check`, `npm run lint`, `npm run build:prod`, `npm test`, the Node.js 20 packed-package smoke test, `npm run pack:dry`, and `npx wrangler deploy --dry-run`; resolve all failures before handoff.
