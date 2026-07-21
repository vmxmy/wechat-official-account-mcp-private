import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { cleanup, render as renderInk } from 'ink-testing-library';
import {
  InkInitRenderer,
  InitScreen,
  buildInitActionChoices,
  redactTerminalText,
  renderInitSummary,
} from '../src/cli/init-ink.js';
import { runInkUiShell, UiShellScreen } from '../src/cli/ui-shell.js';
import {
  createInitRun,
  toInitProtocolEvent,
  transitionInitRun,
  type InitProtocolEvent,
  type InitRun,
} from '../src/cli/init.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const RUN_ID = 'run_abcdefabcdefabcdefabcdefabcdefab';

test('Ink onboarding renders persistent wide and compact context without color-only state', t => {
  t.after(cleanup);
  const event = eventAtAllowlist();
  const wide = renderInk(<InitScreen event={event} width={100} color={false} onAction={() => undefined} />);
  assert.match(wide.lastFrame() ?? '', /WOA 微信 MCP 接入/);
  assert.match(wide.lastFrame() ?? '', /接入进度/);
  assert.match(wide.lastFrame() ?? '', /当前操作/);
  assert.match(wide.lastFrame() ?? '', /101\.34\.57\.185/);
  assert.match(wide.lastFrame() ?? '', /\[>\]|\[x\]/);
  assert.equal((wide.lastFrame() ?? '').includes('\u001b'), false);

  wide.rerender(<InitScreen event={event} width={48} color={false} onAction={() => undefined} />);
  const compact = wide.lastFrame() ?? '';
  assert.match(compact, /101\.34\.57\.185/);
  assert.ok(compact.indexOf('接入进度') < compact.indexOf('当前操作'));
});

test('Ink action model covers browser, allowlist, host, tool, draft, pause, and headless choices', () => {
  assert.deepEqual(buildInitActionChoices(eventAtLogin(), false).map(item => item.id), ['open', 'pause']);
  assert.deepEqual(buildInitActionChoices(eventAtLogin(), true).map(item => item.id), ['pause']);
  assert.deepEqual(buildInitActionChoices(eventAtAllowlist()).map(item => item.id), ['allowlist', 'pause']);

  let run = runAtRemoteMcp();
  assert.deepEqual(buildInitActionChoices(toInitProtocolEvent(run)).map(item => item.id), ['remote-mcp', 'pause']);
  run = transitionInitRun(run, { kind: 'remote_mcp_added' });
  assert.deepEqual(buildInitActionChoices(toInitProtocolEvent(run)).map(item => item.id), ['host-oauth', 'pause']);
  run = transitionInitRun(run, { kind: 'host_oauth_completed' });
  assert.deepEqual(buildInitActionChoices(toInitProtocolEvent(run)).map(item => item.id), ['tool-verified', 'pause']);
  run = transitionInitRun(run, { kind: 'host_tool_verified', tool: 'woa_context' });
  assert.deepEqual(buildInitActionChoices(toInitProtocolEvent(run)).map(item => item.id), ['tool-verified', 'pause']);
  run = transitionInitRun(run, { kind: 'host_tool_verified', tool: 'wechat_draft_count' });
  assert.deepEqual(buildInitActionChoices(toInitProtocolEvent(run)).map(item => item.id), ['confirm', 'decline', 'pause']);
});

test('Ink keyboard focus returns explicit typed actions', async t => {
  t.after(cleanup);
  const actions: unknown[] = [];
  const view = renderInk(<InitScreen event={eventAtAllowlist()} width={80} color={false} onAction={action => actions.push(action)} />);
  await nextTurn();
  view.stdin.write('a');
  await nextTurn();
  assert.deepEqual(actions, [{ kind: 'acknowledge' }]);
  view.stdin.write('q');
  await nextTurn();
  assert.deepEqual(actions.at(-1), { kind: 'pause' });
  view.stdin.write('\u0003');
  await nextTurn();
  assert.deepEqual(actions.at(-1), { kind: 'interrupt' });

  const navigated: unknown[] = [];
  const navigation = renderInk(<InitScreen event={eventAtAllowlist()} width={80} color={false} onAction={action => navigated.push(action)} />);
  await nextTurn();
  navigation.stdin.write('j');
  await nextTurn();
  assert.match(navigation.lastFrame() ?? '', /> \[q\] 保存并稍后继续/);
  navigation.stdin.write('\r');
  await nextTurn();
  assert.deepEqual(navigated, [{ kind: 'pause' }]);
});

test('Ink frames cover paused, error, unsupported, and done projections', t => {
  t.after(cleanup);
  const fixtures = [eventPaused(), eventFailed(), eventUnsupported(), eventDone()];
  const view = renderInk(<InitScreen event={fixtures[0]} width={80} color={false} onAction={() => undefined} />);
  assert.match(view.lastFrame() ?? '', /已暂停/);
  view.rerender(<InitScreen event={fixtures[1]} width={80} color={false} onAction={() => undefined} />);
  assert.match(view.lastFrame() ?? '', /timeout|需处理/);
  view.rerender(<InitScreen event={fixtures[2]} width={80} color={false} onAction={() => undefined} />);
  assert.match(view.lastFrame() ?? '', /node_runtime_missing|需处理/);
  view.rerender(<InitScreen event={fixtures[3]} width={80} color={false} onAction={() => undefined} />);
  assert.match(view.lastFrame() ?? '', /已完成/);
});

test('WOA UI shell exposes start, resume, status, and exit actions', async t => {
  t.after(cleanup);
  const selections: string[] = [];
  const view = renderInk(
    <UiShellScreen
      snapshot={{ event: eventPaused(), canResume: true }}
      color={false}
      onSelect={selection => selections.push(selection)}
    />,
  );
  const initial = view.lastFrame() ?? '';
  assert.match(initial, /开始新的接入流程/);
  assert.match(initial, /恢复最近的接入流程/);
  assert.match(initial, /查看最近状态/);
  assert.match(initial, /退出/);
  await nextTurn();
  view.stdin.write('s');
  await nextTurn();
  assert.match(view.lastFrame() ?? '', /状态详情/);
  view.stdin.write('r');
  await nextTurn();
  assert.deepEqual(selections, ['resume']);
  view.stdin.write('n');
  await nextTurn();
  assert.deepEqual(selections, ['resume', 'start']);
});

test('WOA UI shell restores terminal state when the process receives SIGTERM', async () => {
  const previousExitCode = process.exitCode;
  const { input, output, errorOutput, rendered } = ttyStreams();
  try {
    const selection = runInkUiShell({ event: eventPaused(), canResume: true }, {
      input,
      output,
      errorOutput,
      color: false,
    });
    await nextTurn();
    process.emit('SIGTERM');
    assert.equal(await selection, 'exit');
    assert.equal(process.exitCode, 143);
    assert.equal(rendered.stdout.includes('\u001b[?1049h'), true);
    assert.equal(rendered.stdout.includes('\u001b[?1049l'), true);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('WOA UI shell uses compatibility redraws instead of incremental line appends', async () => {
  const { input, output, errorOutput, rendered } = ttyStreams();
  const selection = runInkUiShell({ event: eventPaused(), canResume: true }, {
    input,
    output,
    errorOutput,
    color: false,
  });
  try {
    await nextTurn();
    const initialLength = rendered.stdout.length;
    input.write('s');
    await new Promise(resolve => setTimeout(resolve, 75));
    const update = rendered.stdout.slice(initialLength);
    assert.match(update, /状态详情/);
    assert.equal(update.includes('\u001b[2K'), true);
    assert.equal(update.includes('\u001b[1A'), true);
    assert.equal(update.includes('\u001b[E'), false);
  } finally {
    input.write('q');
    assert.equal(await selection, 'exit');
  }
});

test('persistent Ink renderer reuses one alternate screen and resolves one action per event', async () => {
  const { input, output, errorOutput, rendered } = ttyStreams();
  const renderer = new InkInitRenderer({ input, output, errorOutput, color: false });
  const allowlistAction = renderer.render(eventAtAllowlist());
  await nextTurn();
  input.write('a');
  assert.deepEqual(await allowlistAction, { kind: 'acknowledge' }, rendered.stderr);

  const initialLength = rendered.stdout.length;
  const remoteAction = renderer.render(toInitProtocolEvent(runAtRemoteMcp()));
  await new Promise(resolve => setTimeout(resolve, 75));
  const update = rendered.stdout.slice(initialLength);
  assert.equal(update.includes('\u001b[2K'), true);
  assert.equal(update.includes('\u001b[1A'), true);
  assert.equal(update.includes('\u001b[E'), false);
  input.write('c');
  assert.deepEqual(await remoteAction, { kind: 'remote_mcp_added' });
  await renderer.render(eventPaused());
  await renderer.restore();

  assert.equal(count(rendered.stdout, '\u001b[?1049h'), 1);
  assert.equal(count(rendered.stdout, '\u001b[?1049l'), 1);
  assert.match(rendered.stdout, /WOA 接入已暂停.*woa init resume/s);
  assert.doesNotMatch(rendered.stdout + rendered.stderr, /access_token|refresh_token|appSecret/i);
});

test('renderer failure resolves an interrupt and restores terminal state', async () => {
  const { input, output, errorOutput, rendered } = ttyStreams();
  const BrokenScreen = () => {
    throw new Error('render failed with access_token=NEVER_PRINT');
  };
  const renderer = new InkInitRenderer({ input, output, errorOutput, color: false, screen: BrokenScreen });
  const action = await Promise.race([
    renderer.render(eventAtAllowlist()),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('renderer failure timeout')), 2_000)),
  ]);
  assert.deepEqual(action, { kind: 'interrupt' });
  await renderer.restore();
  assert.match(rendered.stderr, /WOA TUI render error/);
  assert.doesNotMatch(rendered.stderr, /NEVER_PRINT/);
  assert.equal(rendered.stdout.includes('\u001b[?1049l'), true);
});

test('trusted secure input suspends Ink ownership and never renders the sensitive buffer', async () => {
  const { input, output, errorOutput, rendered } = ttyStreams();
  const renderer = new InkInitRenderer({ input, output, errorOutput, color: false });
  const action = renderer.render(eventAtAllowlist());
  await nextTurn();
  const result = await renderer.suspendForSecureInput(async () => 'DIRECT_SECRET_BUFFER');
  assert.equal(result, 'DIRECT_SECRET_BUFFER');
  await nextTurn();
  input.write('a');
  assert.deepEqual(await action, { kind: 'acknowledge' });
  await renderer.render(eventPaused());
  await renderer.restore();
  assert.equal(count(rendered.stdout, '\u001b[?1049h'), 2);
  assert.equal(count(rendered.stdout, '\u001b[?1049l'), 2);
  assert.doesNotMatch(rendered.stdout + rendered.stderr, /DIRECT_SECRET_BUFFER/);
});

test('terminal summaries redact secret assignments and raw OAuth callback URLs', () => {
  const failed = eventFailed();
  failed.error = {
    code: 'timeout',
    recoverable: true,
    message: 'Bearer TOKEN access_token=SECRET http://127.0.0.1:8787/callback?code=AUTH&state=S',
  };
  const summary = renderInitSummary(failed);
  assert.doesNotMatch(summary, /TOKEN|SECRET|code=AUTH/);
  assert.match(summary, /\[REDACTED\]/);
  assert.doesNotMatch(redactTerminalText('appSecret=VERY_SECRET'), /VERY_SECRET/);
});

test('woa ui rejects pipes without ANSI and ordinary commands do not statically import Ink', async () => {
  const result = await runCli(['ui']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /requires directly operated TTY/);
  assert.equal((result.stdout + result.stderr).includes('\u001b'), false);

  const version = await runCli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  const entrySource = readFileSync(path.join(projectRoot, 'src/cli/woa.ts'), 'utf8');
  const commandSource = readFileSync(path.join(projectRoot, 'src/cli/init-command.ts'), 'utf8');
  assert.doesNotMatch(entrySource, /^import .*ui-shell/m);
  assert.doesNotMatch(entrySource, /^import .*init-ink/m);
  assert.match(entrySource, /await import\('\.\/ui-shell\.js'\)/);
  assert.match(commandSource, /await import\('\.\/init-ink\.js'\)/);
});

test('pseudo-TTY woa ui and interactive init restore alternate screen and print a resume summary', async t => {
  if (process.platform === 'win32') {
    t.skip('pseudo-TTY contract uses the POSIX script command');
    return;
  }
  const ui = await runPseudoTty(['ui'], 'q');
  assert.equal(ui.code, 0, ui.stderr || ui.stdout);
  assert.equal(ui.stdout.includes('\u001b[?1049h'), true);
  assert.equal(ui.stdout.includes('\u001b[?1049l'), true);

  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/.well-known/oauth-authorization-server') {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      response.end(JSON.stringify({
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
      }));
      return;
    }
    if (request.url === '/oauth/register' && request.method === 'POST') {
      response.writeHead(201);
      response.end(JSON.stringify({ client_id: 'ink-pty-client' }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address() as { port: number };
    const init = await runPseudoTty([
      'init', '--server', `http://127.0.0.1:${address.port}`, '--no-open', '--timeout', '10',
    ], 'q');
    assert.equal(init.code, 0, init.stderr || init.stdout);
    assert.equal(init.stdout.includes('\u001b[?1049h'), true);
    assert.equal(init.stdout.includes('\u001b[?1049l'), true);
    assert.match(init.stdout, /WOA 接入已暂停.*woa init resume/s);
    assert.doesNotMatch(init.stdout + init.stderr, /access_token|refresh_token|client_secret/i);

    const interrupted = await runPseudoTty([
      'init', '--server', `http://127.0.0.1:${address.port}`, '--no-open', '--timeout', '10',
    ], '\u0003');
    assert.ok(interrupted.code === 130 || (process.platform === 'darwin' && interrupted.code === 0), interrupted.stderr || interrupted.stdout);
    assert.equal(interrupted.stdout.includes('\u001b[?1049l'), true);
    assert.match(interrupted.stdout, /WOA 接入已暂停.*woa init resume/s);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

function eventAtLogin(): InitProtocolEvent {
  let run = createInitRun({ server: 'https://woa.example', runId: RUN_ID });
  run = transitionInitRun(run, { kind: 'environment_supported' });
  run = transitionInitRun(run, { kind: 'cli_oauth_prepared', authorizationUrl: 'https://woa.example/authorize?state=STATE' });
  return toInitProtocolEvent(run);
}

function eventAtAllowlist(): InitProtocolEvent {
  return toInitProtocolEvent(runAtAllowlist());
}

function runAtAllowlist(): InitRun {
  let run = createInitRun({ server: 'https://woa.example', runId: RUN_ID });
  run = transitionInitRun(run, { kind: 'environment_supported' });
  run = transitionInitRun(run, { kind: 'cli_authenticated' });
  return transitionInitRun(run, {
    kind: 'egress_ips_loaded',
    ips: ['101.34.57.185', '203.0.113.22'],
    configVersion: 'relay-v2',
  });
}

function runAtRemoteMcp(): InitRun {
  let run = runAtAllowlist();
  run = transitionInitRun(run, { kind: 'wechat_allowlist_acknowledged' });
  return transitionInitRun(run, { kind: 'wechat_credentials_verified' });
}

function eventPaused(): InitProtocolEvent {
  return toInitProtocolEvent(transitionInitRun(runAtAllowlist(), { kind: 'pause' }));
}

function eventFailed(): InitProtocolEvent {
  return toInitProtocolEvent(transitionInitRun(runAtAllowlist(), {
    kind: 'fail',
    error: { code: 'timeout', message: 'Remote request timed out.', recoverable: true },
  }));
}

function eventUnsupported(): InitProtocolEvent {
  const run = createInitRun({ server: 'https://woa.example', runId: RUN_ID });
  return toInitProtocolEvent(transitionInitRun(run, {
    kind: 'unsupported',
    error: { code: 'node_runtime_missing', message: 'Node.js 20 or newer is required.', recoverable: false },
  }));
}

function eventDone(): InitProtocolEvent {
  let run = runAtRemoteMcp();
  run = transitionInitRun(run, { kind: 'remote_mcp_added' });
  run = transitionInitRun(run, { kind: 'host_oauth_completed' });
  run = transitionInitRun(run, { kind: 'host_tool_verified', tool: 'woa_context' });
  run = transitionInitRun(run, { kind: 'host_tool_verified', tool: 'wechat_draft_count' });
  return toInitProtocolEvent(transitionInitRun(run, { kind: 'test_draft_declined' }));
}

function ttyStreams(): {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  errorOutput: NodeJS.WriteStream;
  rendered: { stdout: string; stderr: string };
} {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  const errorOutput = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperty(input, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(output, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(output, 'columns', { configurable: true, value: 100 });
  Object.defineProperty(output, 'rows', { configurable: true, value: 30 });
  Object.defineProperty(errorOutput, 'isTTY', { configurable: true, value: true });
  let raw = false;
  input.setRawMode = mode => {
    raw = mode;
    return input;
  };
  Object.defineProperty(input, 'isRaw', { configurable: true, get: () => raw });
  input.ref = () => input;
  input.unref = () => input;
  const rendered = { stdout: '', stderr: '' };
  output.on('data', chunk => { rendered.stdout += chunk.toString('utf8'); });
  errorOutput.on('data', chunk => { rendered.stderr += chunk.toString('utf8'); });
  return { input, output, errorOutput, rendered };
}

async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/woa.ts', ...args], {
    cwd: projectRoot,
    env: { ...process.env, CI: '', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { code, stdout, stderr };
}

async function runPseudoTty(args: string[], input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-ink-pty-'));
  const cli = [process.execPath, '--import', 'tsx', path.join(projectRoot, 'src/cli/woa.ts'), ...args]
    .map(shellQuote)
    .join(' ');
  const env = [
    'CI=',
    'NO_COLOR=1',
    'TERM=xterm-256color',
    `WOA_CLI_CONFIG=${shellQuote(path.join(tempRoot, 'config.json'))}`,
    `WOA_INIT_DIR=${shellQuote(path.join(tempRoot, 'runs'))}`,
  ].join(' ');
  const delayedInput = input === 'q'
    ? `(sleep 1; while printf q; do sleep 1; done)`
    : `(sleep 3; printf ${shellQuote(input)})`;
  const command = process.platform === 'darwin'
    ? `${delayedInput} | script -q /dev/null env ${env} ${cli}`
    : `${delayedInput} | script -q -e -c ${shellQuote(`env ${env} ${cli}`)} /dev/null`;
  const child = spawn('/bin/sh', ['-c', command], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timeout = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child.pid);
  }, 30_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (timedOut) {
      throw new Error(`pseudo-TTY command timed out after 30 seconds\n${stderr || stdout}`);
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) killProcessGroup(child.pid);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The process group may already have exited between the state check and kill.
  }
}

function shellQuote(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 25));
}
