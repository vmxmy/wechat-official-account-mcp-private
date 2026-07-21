import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAgentHelpManifest } from '../src/cli/agent-help.js';
import {
  InitJsonlValidationError,
  JsonlInitRenderer,
  serializeInitEvent,
} from '../src/cli/init-jsonl.js';
import {
  FileInitRunStore,
  InitRunnerError,
  runInit,
} from '../src/cli/init-runner.js';
import { PlainInitRenderer } from '../src/cli/init-tui.js';
import {
  createInitRun,
  toInitProtocolEvent,
  transitionInitRun,
  validateInitRun,
} from '../src/cli/init.js';
import { createMcpDescriptor } from '../src/cli/mcp-descriptor.js';
import { authorizationCodeFromCallback } from '../src/cli/oauth-callback.js';
import {
  readSecureJson,
  writeSecureJson,
} from '../src/cli/secure-config.js';
import {
  detectTerminalCapabilities,
  interactiveConsoleUnavailableReason,
  normalizeInkCiEnvironment,
} from '../src/cli/terminal-capabilities.js';
import { readSecureInput } from '../src/cli/secure-input.js';
import { CLI_VERSION } from '../src/cli/version.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const RUN_ID = 'run_0123456789abcdef0123456789abcdef';

function runWoa(args, options = {}) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-cli-test-'));
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli/woa.ts', ...args],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        WOA_CLI_CONFIG: path.join(tempRoot, 'config', 'cli.json'),
        WOA_INIT_DIR: path.join(tempRoot, 'runs'),
        ...options.env,
      },
      input: options.input,
    },
  );
  rmSync(tempRoot, { recursive: true, force: true });
  return result;
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for child-process evidence.');
}

function eventAtAllowlist() {
  let run = createInitRun({
    server: 'https://woa.example',
    runId: RUN_ID,
    now: new Date('2026-07-18T00:00:00.000Z'),
  });
  run = transitionInitRun(run, { kind: 'environment_supported' });
  run = transitionInitRun(run, { kind: 'cli_authenticated' });
  run = transitionInitRun(run, {
    kind: 'egress_ips_loaded',
    ips: ['101.34.57.185'],
    configVersion: 'relay-v1',
  });
  return toInitProtocolEvent(run);
}

function eventAtRemoteMcp() {
  let run = createInitRun({ server: 'https://woa.example', runId: RUN_ID });
  run = transitionInitRun(run, { kind: 'environment_supported' });
  run = transitionInitRun(run, { kind: 'cli_authenticated' });
  run = transitionInitRun(run, { kind: 'egress_ips_loaded', ips: ['101.34.57.185'], configVersion: 'v1' });
  run = transitionInitRun(run, { kind: 'wechat_allowlist_acknowledged' });
  run = transitionInitRun(run, { kind: 'wechat_credentials_verified' });
  return run;
}

test('Agent Help is embedded, versioned, client-neutral, and contains exact resume events', () => {
  const result = runWoa(['help', 'agent', '--format', 'json']);

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.cliVersion, CLI_VERSION);
  assert.deepEqual(manifest.entrypoint.args, ['init', '--agent', '--format', 'jsonl']);
  assert.deepEqual(
    manifest.resumeEvents.map(item => item.event),
    [
      'allowlist_saved',
      'remote_mcp_added',
      'host_oauth_completed',
      'host_tool_verified',
      'test_draft_confirmed|test_draft_declined',
    ],
  );
  const allowlist = manifest.resumeEvents.find(item => item.event === 'allowlist_saved');
  const draftChoice = manifest.resumeEvents.find(item => item.event === 'test_draft_confirmed|test_draft_declined');
  assert.deepEqual(allowlist.resumeCommands, [{
    command: 'woa',
    args: ['init', 'resume', '<runId>', '--event', 'allowlist_saved'],
  }]);
  assert.deepEqual(draftChoice.resumeCommands, [
    {
      command: 'woa',
      args: ['init', 'resume', '<runId>', '--event', 'test_draft_confirmed'],
    },
    {
      command: 'woa',
      args: ['init', 'resume', '<runId>', '--event', 'test_draft_declined'],
    },
  ]);
  assert.equal(allowlist.resumeCommands.some(command => command.args.includes('--agent')), false);
  assert.equal(draftChoice.resumeCommands.some(command => command.args.includes('--agent')), false);

  const serialized = JSON.stringify(manifest).toLowerCase();
  for (const forbidden of ['claude', 'codex', 'kimi', 'bearer', '--app-secret', '--token', 'callback-url']) {
    assert.equal(serialized.includes(forbidden), false, `Agent contract contains forbidden content: ${forbidden}`);
  }
  assert.deepEqual(createAgentHelpManifest().successCriteria, manifest.successCriteria);
});

test('version and generic MCP descriptor expose no reusable credential', () => {
  const version = runWoa(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), CLI_VERSION);

  const descriptor = createMcpDescriptor('https://woa.example');
  assert.equal(descriptor.transport, 'streamable-http');
  assert.equal(descriptor.url, 'https://woa.example/mcp');
  assert.equal(descriptor.authentication.type, 'oauth2');
  assert.deepEqual(descriptor.headers, {});
  assert.equal(JSON.stringify(descriptor).toLowerCase().includes('bearer'), false);
});

test('business commands reject static OAuth token arguments and require the refreshable session', () => {
  const result = runWoa([
    'whoami', '--server', 'http://127.0.0.1:9', '--token', 'STATIC_ACCESS',
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--token.*not.*OAuth|OAuth.*does not accept.*--token/i);
  assert.equal(result.stdout, '');
});

test('pure init machine emits a secret-free exact-version OAuth resume action', () => {
  const initial = createInitRun({
    server: 'https://woa.ziikoo.app',
    runId: RUN_ID,
    now: new Date('2026-07-18T00:00:00.000Z'),
  });
  const environmentReady = transitionInitRun(
    initial,
    { kind: 'environment_supported' },
    new Date('2026-07-18T00:00:01.000Z'),
  );
  assert.equal(toInitProtocolEvent(environmentReady).type, 'state');
  const loginRequired = transitionInitRun(
    environmentReady,
    { kind: 'cli_oauth_prepared', authorizationUrl: 'https://woa.ziikoo.app/authorize?state=opaque' },
    new Date('2026-07-18T00:00:02.000Z'),
  );
  const event = toInitProtocolEvent(loginRequired);

  assert.equal(event.type, 'action_required');
  assert.equal(event.phase, 'woa_login_required');
  assert.equal(event.nextAction?.kind, 'open_url');
  assert.deepEqual(event.resume, {
    command: 'woa',
    args: ['init', 'resume', initial.runId, '--agent', '--format', 'jsonl'],
    packageVersion: CLI_VERSION,
  });
  assert.equal(JSON.stringify(event).includes('appSecret'), false);
});

test('terminal detection selects TUI, plain, and strict JSONL modes from observable capabilities', () => {
  const tty = { isTTY: true };
  const wideTty = { isTTY: true, columns: 100 };
  const interactive = detectTerminalCapabilities({ stdin: tty, stdout: wideTty, stderr: tty, env: {} });
  assert.equal(interactive.mode, 'tui');
  assert.equal(interactive.directlyOperated, true);
  assert.equal(interactiveConsoleUnavailableReason(interactive), null);
  assert.equal(detectTerminalCapabilities({ plain: true, stdin: tty, stdout: wideTty, stderr: tty, env: {} }).mode, 'plain');
  assert.equal(detectTerminalCapabilities({ agent: true, stdin: tty, stdout: wideTty, stderr: tty, env: {} }).mode, 'jsonl');
  assert.equal(detectTerminalCapabilities({ stdin: tty, stdout: wideTty, stderr: tty, env: { CI: '1' } }).mode, 'jsonl');
  assert.equal(detectTerminalCapabilities({ stdin: tty, stdout: wideTty, stderr: tty, env: { CONTINUOUS_INTEGRATION: '1' } }).mode, 'jsonl');
  const falseLikeCi = { CI: '' };
  assert.equal(detectTerminalCapabilities({ stdin: tty, stdout: wideTty, stderr: tty, env: falseLikeCi }).mode, 'tui');
  normalizeInkCiEnvironment(falseLikeCi);
  assert.equal(falseLikeCi.CI, 'false');
  const piped = detectTerminalCapabilities({
    stdin: { isTTY: false },
    stdout: { isTTY: false, columns: undefined },
    stderr: { isTTY: false },
    env: {},
  });
  assert.equal(piped.mode, 'jsonl');
  assert.match(interactiveConsoleUnavailableReason(piped), /requires directly operated TTY/);
});

test('JSONL validates discriminants, refuses secret/control fields, and treats EPIPE as a clean stop', async () => {
  const event = eventAtAllowlist();
  const line = serializeInitEvent(event);
  assert.deepEqual(JSON.parse(line), event);
  assert.equal(line.includes('\u001b'), false);

  assert.throws(
    () => serializeInitEvent({ ...event, appSecret: 'never' }),
    InitJsonlValidationError,
  );
  assert.throws(
    () => serializeInitEvent({ ...event, server: 'https://woa.example/\u001b[2J' }),
    InitJsonlValidationError,
  );
  assert.throws(
    () => serializeInitEvent({ ...event, unexpected: true }),
    InitJsonlValidationError,
  );
  assert.throws(
    () => serializeInitEvent({
      ...event,
      nextAction: { ...event.nextAction, shellCommand: 'do-not-run' },
    }),
    InitJsonlValidationError,
  );

  class EpipeWritable extends Writable {
    _write(_chunk, _encoding, callback) {
      const error = new Error('closed pipe');
      error.code = 'EPIPE';
      callback(error);
    }
  }
  const action = await new JsonlInitRenderer(new EpipeWritable()).render(event);
  assert.equal(action?.kind, 'epipe');
});

test('init run and JSONL schemas reject unknown fields and inconsistent phase/status projections', () => {
  const run = createInitRun({ server: 'https://woa.example', runId: RUN_ID });
  assert.throws(() => validateInitRun({ ...run, serverCommand: 'unexpected' }), /unknown field/i);
  assert.throws(() => validateInitRun({ ...run, status: 'action_required' }), /action-required/i);

  const event = toInitProtocolEvent(run);
  assert.throws(
    () => serializeInitEvent({ ...event, type: 'done' }),
    InitJsonlValidationError,
  );
  assert.throws(
    () => serializeInitEvent({ ...event, phase: 'completed' }),
    InitJsonlValidationError,
  );
  assert.throws(
    () => serializeInitEvent({
      ...event,
      nextAction: { kind: 'call_mcp_tool', tool: 'unknown_tool', arguments: {}, reason: 'server text' },
    }),
    InitJsonlValidationError,
  );
});

test('plain renderer contains no ANSI/control sequences and presents one current action', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.defineProperty(input, 'isTTY', { value: true });
  Object.defineProperty(output, 'isTTY', { value: true });
  let rendered = '';
  output.on('data', chunk => { rendered += chunk.toString('utf8'); });
  input.end('q\n');
  const action = await new PlainInitRenderer({ input, output, width: 48, headless: true }).render(eventAtAllowlist());
  assert.equal(action?.kind, 'pause');
  assert.equal(rendered.includes('\u001b'), false);
  assert.match(rendered, /101\.34\.57\.185/);
  assert.match(rendered, /\[x\]|\[>\]|\[ \]/);
});

test('plain host steps expose executable continuation actions for MCP, OAuth, and tool evidence', async () => {
  let run = eventAtRemoteMcp();
  const fixtures = [];
  fixtures.push({
    event: toInitProtocolEvent(run),
    input: '\n',
    action: { kind: 'remote_mcp_added' },
    output: /woa mcp descriptor.*remote_mcp_added/s,
  });
  run = transitionInitRun(run, { kind: 'remote_mcp_added' });
  fixtures.push({
    event: toInitProtocolEvent(run),
    input: '\n',
    action: { kind: 'host_oauth_completed' },
    output: /宿主.*OAuth.*host_oauth_completed/s,
  });
  run = transitionInitRun(run, { kind: 'host_oauth_completed' });
  fixtures.push({
    event: toInitProtocolEvent(run),
    input: '\n',
    action: { kind: 'host_tool_verified', tool: 'woa_context' },
    output: /woa_context.*host_tool_verified/s,
  });

  for (const fixture of fixtures) {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = '';
    output.on('data', chunk => { rendered += chunk.toString('utf8'); });
    input.end(fixture.input);
    const action = await new PlainInitRenderer({ input, output, width: 80 }).render(fixture.event);
    assert.deepEqual(action, fixture.action);
    assert.match(rendered, fixture.output);
  }
});

test('secure config is atomic, owner-only, repairs permissive mode, and refuses symlinks', async t => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-secure-config-'));
  const configPath = path.join(tempRoot, 'nested', 'cli.json');
  try {
    await writeSecureJson(configPath, { accessToken: 'local-only' });
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(configPath)).mode & 0o777, 0o700);
    assert.deepEqual(await readSecureJson(configPath), { accessToken: 'local-only' });

    chmodSync(configPath, 0o644);
    await readSecureJson(configPath);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);

    if (process.platform === 'win32') {
      t.diagnostic('symlink ownership contract is POSIX-only');
    } else {
      const target = path.join(tempRoot, 'target.json');
      await writeSecureJson(target, { ok: true });
      const link = path.join(tempRoot, 'link.json');
      symlinkSync(target, link);
      await assert.rejects(() => readSecureJson(link), error => error?.code === 'insecure_config_symlink');
      assert.equal(lstatSync(link).isSymbolicLink(), true);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('headless OAuth callback is accepted only through no-echo TTY input and exact state/origin validation', async () => {
  const originalCi = process.env.CI;
  delete process.env.CI;
  const input = new PassThrough();
  const output = new PassThrough();
  Object.defineProperty(input, 'isTTY', { value: true });
  Object.defineProperty(output, 'isTTY', { value: true });
  const rawModes = [];
  input.isRaw = false;
  input.setRawMode = mode => {
    rawModes.push(mode);
    input.isRaw = mode;
    return input;
  };
  let terminalText = '';
  output.on('data', chunk => { terminalText += chunk.toString('utf8'); });
  try {
    const callback = 'http://127.0.0.1:8787/callback?code=AUTH_CODE&state=EXPECTED';
    const readPromise = readSecureInput({ prompt: 'OAuth: ', input, output });
    input.write(`${callback}\n`);
    const entered = await readPromise;
    assert.equal(entered, callback);
    assert.deepEqual(rawModes, [true, false]);
    assert.equal(terminalText.includes('AUTH_CODE'), false);
    assert.equal(authorizationCodeFromCallback(entered, {
      redirectUri: 'http://127.0.0.1:8787/callback',
      state: 'EXPECTED',
    }), 'AUTH_CODE');
    assert.throws(() => authorizationCodeFromCallback(
      'http://127.0.0.1:8787/callback?code=AUTH_CODE&state=WRONG',
      { redirectUri: 'http://127.0.0.1:8787/callback', state: 'EXPECTED' },
    ), /state mismatch/);
    assert.throws(() => authorizationCodeFromCallback(
      'https://attacker.example/callback?code=AUTH_CODE&state=EXPECTED',
      { redirectUri: 'http://127.0.0.1:8787/callback', state: 'EXPECTED' },
    ), /does not match/);
    await assert.rejects(
      () => readSecureInput({ prompt: 'OAuth: ', input, output, agent: true }),
      error => error?.code === 'secure_input_required',
    );
  } finally {
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
  }
});

test('desktop OAuth uses an ephemeral loopback callback and completes without copying a token', async () => {
  const requests = [];
  let origin = '';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ url: request.url, method: request.method, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/.well-known/oauth-authorization-server') {
      response.end(JSON.stringify({
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
      }));
      return;
    }
    if (request.url === '/oauth/register' && request.method === 'POST') {
      response.writeHead(201);
      response.end(JSON.stringify({ client_id: 'desktop-loopback-client' }));
      return;
    }
    if (request.url === '/oauth/token' && request.method === 'POST') {
      response.end(JSON.stringify({
        access_token: 'DESKTOP_ACCESS',
        refresh_token: 'DESKTOP_REFRESH',
        token_type: 'bearer',
        expires_in: 28800,
      }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-desktop-oauth-'));
  const configPath = path.join(tempRoot, 'config', 'cli.json');
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, [
    '--import', 'tsx', 'src/cli/woa.ts',
    'login', '--server', origin, '--no-open', '--timeout', '5',
  ], {
    cwd: projectRoot,
    env: { ...process.env, WOA_CLI_CONFIG: configPath, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const authorizeUrl = await waitUntil(() => {
      const match = stdout.match(new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/authorize\\?[^\\s]+`));
      return match?.[0] ? new URL(match[0]) : null;
    });
    const redirectUri = authorizeUrl.searchParams.get('redirect_uri');
    assert.ok(redirectUri);
    const callback = new URL(redirectUri);
    assert.equal(callback.hostname, '127.0.0.1');
    assert.notEqual(callback.port, '0');
    callback.searchParams.set('code', 'DESKTOP_CODE');
    callback.searchParams.set('state', authorizeUrl.searchParams.get('state'));
    const callbackResponse = await fetch(callback);
    assert.equal(callbackResponse.status, 200);

    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(exitCode, 0, stderr);
    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    const tokenRequest = requests.find(item => item.url === '/oauth/token');
    assert.match(tokenRequest?.body ?? '', /code=DESKTOP_CODE/);
    assert.match(tokenRequest?.body ?? '', /code_verifier=/);
    assert.equal(saved.accessToken, 'DESKTOP_ACCESS');
    assert.equal(saved.refreshToken, 'DESKTOP_REFRESH');
    assert.equal(saved.pkce, undefined);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.match(stdout, /OAuth login complete/);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('file runner reaches done through resumable host evidence and creates one unpublished draft', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-runner-'));
  const store = new FileInitRunStore(tempRoot);
  const openedUrls = [];
  let createDraftCalls = 0;
  const effects = {
    isCliAuthenticated: async () => true,
    loadWechatEgress: async () => ({
      ips: ['101.34.57.185'],
      configVersion: 'relay-v1',
      remote: {
        runId: 'init_remote_1',
        version: 1,
        status: 'active',
        phase: 'context_ready',
        tenantId: 'ten_a',
        accountId: 'acct_a',
      },
    }),
    confirmWechatEgress: async () => ({ remoteVersion: 2 }),
    createCredentialHandoff: async () => ({
      handoffId: 'handoff_1',
      remoteVersion: 3,
      handoffUrl: 'https://woa.example/init/credentials?handoff=one-time-secret',
    }),
    getCredentialHandoffStatus: async () => ({ status: 'verified', remoteVersion: 4 }),
    openUrl: async url => { openedUrls.push(url); },
    createTestDraft: async () => {
      createDraftCalls += 1;
      return { mediaId: 'draft_media_1', remoteVersion: 5 };
    },
  };
  const renderedEvents = [];
  const renderer = {
    render: async event => {
      renderedEvents.push(event);
      if (event.nextAction?.kind === 'update_wechat_ip_allowlist') return { kind: 'acknowledge' };
      if (event.nextAction?.kind === 'confirm_test_draft') return { kind: 'confirm' };
      if (event.type !== 'done') return { kind: 'pause' };
    },
  };
  try {
    let result = await runInit({
      mode: 'create',
      server: 'https://woa.example',
      store,
      renderer,
      effects,
      installSignalHandlers: false,
    });
    const runId = result.event.runId;
    assert.equal(result.event.phase, 'remote_mcp_required');
    assert.equal(result.event.status, 'paused');

    result = await runInit({
      mode: 'resume', runId, store, renderer, effects,
      resumeEvent: { kind: 'remote_mcp_added' }, installSignalHandlers: false,
    });
    assert.equal(result.event.phase, 'host_oauth_required');
    result = await runInit({
      mode: 'resume', runId, store, renderer, effects,
      resumeEvent: { kind: 'host_oauth_completed' }, installSignalHandlers: false,
    });
    assert.equal(result.event.nextAction?.kind, 'call_mcp_tool');
    result = await runInit({
      mode: 'resume', runId, store, renderer, effects,
      resumeEvent: { kind: 'host_tool_verified', tool: 'woa_context' }, installSignalHandlers: false,
    });
    assert.equal(result.event.nextAction?.kind, 'call_mcp_tool');
    result = await runInit({
      mode: 'resume', runId, store, renderer, effects,
      resumeEvent: { kind: 'host_tool_verified', tool: 'wechat_draft_count' }, installSignalHandlers: false,
    });

    assert.equal(result.event.type, 'done');
    assert.equal(result.event.nextAction?.kind, 'done');
    assert.equal(result.event.nextAction?.evidence[0], 'testDraftMediaId:draft_media_1');
    assert.equal(createDraftCalls, 1);
    assert.equal(openedUrls.length, 1);
    assert.equal(JSON.stringify(renderedEvents).includes('one-time-secret'), false);
    assert.equal(statSync(path.join(tempRoot, `${runId}.json`)).mode & 0o777, 0o600);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runner records interrupt as a resumable paused checkpoint with exit 130', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-interrupt-'));
  const store = new FileInitRunStore(tempRoot);
  try {
    const result = await runInit({
      mode: 'create',
      server: 'https://woa.example',
      store,
      installSignalHandlers: false,
      effects: {
        isCliAuthenticated: async () => true,
        loadWechatEgress: async () => ({ ips: ['101.34.57.185'], configVersion: 'v1' }),
      },
      renderer: {
        render: async event => event.type === 'paused' ? undefined : { kind: 'interrupt' },
      },
    });
    assert.equal(result.exitCode, 130);
    assert.equal(result.event.status, 'paused');
    assert.equal((await store.load(result.event.runId))?.status, 'paused');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SIGTERM aborts a long effect, checkpoints paused state, and returns exit 143', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-sigterm-'));
  const store = new FileInitRunStore(tempRoot);
  try {
    const running = runInit({
      mode: 'create',
      server: 'https://woa.example',
      store,
      effects: {
        checkEnvironment: async (_run, signal) => await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ supported: true }), 2_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        }),
      },
      renderer: { render: async () => undefined },
    });
    setTimeout(() => process.emit('SIGTERM'), 25);
    const result = await running;
    assert.equal(result.exitCode, 143);
    assert.equal(result.event.status, 'paused');
    assert.equal((await store.load(result.event.runId))?.status, 'paused');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SIGINT during OAuth preserves the latest automatic checkpoint before pausing', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-oauth-sigint-'));
  const store = new FileInitRunStore(tempRoot);
  try {
    const running = runInit({
      mode: 'create',
      server: 'https://woa.example',
      store,
      effects: {
        isCliAuthenticated: async () => false,
        prepareCliOAuth: async (_run, signal) => await new Promise((_, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      },
      renderer: { render: async () => undefined },
    });
    setTimeout(() => process.emit('SIGINT'), 50);
    const result = await running;
    assert.equal(result.exitCode, 130);
    assert.equal(result.event.status, 'paused');
    assert.equal(result.event.phase, 'woa_login_required');
    assert.equal((await store.load(result.event.runId))?.phase, 'woa_login_required');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('a repeated SIGINT keeps checkpoint semantics instead of bypassing cleanup with process.exit', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-double-sigint-'));
  const moduleUrl = new URL('../src/cli/init-runner.ts', import.meta.url).href;
  const script = `
    import { FileInitRunStore, runInit } from ${JSON.stringify(moduleUrl)};
    const store = new FileInitRunStore(${JSON.stringify(tempRoot)});
    const initialSignalListeners = process.listenerCount('SIGINT');
    const running = runInit({
      mode: 'create', server: 'https://woa.example', store,
      effects: { checkEnvironment: async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { supported: true };
      } },
      renderer: { render: async () => undefined },
    });
    while (process.listenerCount('SIGINT') <= initialSignalListeners) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    process.emit('SIGINT');
    process.emit('SIGINT');
    const result = await running;
    process.stdout.write(JSON.stringify({ exitCode: result.exitCode, status: result.event.status }));
    process.exitCode = result.exitCode;
  `;
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 130, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { exitCode: 130, status: 'paused' });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('run leases reject concurrent resume and exact-version mismatch fails closed', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-lease-'));
  const store = new FileInitRunStore(tempRoot);
  const run = createInitRun({ server: 'https://woa.example', runId: RUN_ID });
  try {
    await store.create(run);
    const lease = await store.acquireLease(run.runId);
    await assert.rejects(
      () => store.acquireLease(run.runId),
      error => error instanceof InitRunnerError && error.code === 'init_run_conflict',
    );
    await store.releaseLease(lease);

    await assert.rejects(
      () => runInit({
        mode: 'status',
        runId: run.runId,
        store,
        renderer: { render: async () => undefined },
        packageVersion: '999.0.0',
        installSignalHandlers: false,
      }),
      error => error instanceof InitRunnerError && error.code === 'cli_upgrade_required',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runner heartbeats a short file lease throughout a long OAuth-style effect', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-heartbeat-'));
  let initialLeaseExpiresAt = 0;
  let renewedPastInitialExpiry = false;
  class ShortLeaseStore extends FileInitRunStore {
    async acquireLease(runId, ttlMs = 1_200) {
      const lease = await super.acquireLease(runId, ttlMs);
      if (!initialLeaseExpiresAt) initialLeaseExpiresAt = lease.expiresAt;
      return lease;
    }

    async renewLease(lease, ttlMs) {
      const renewed = await super.renewLease(lease, ttlMs);
      if (Date.now() > initialLeaseExpiresAt) renewedPastInitialExpiry = true;
      return renewed;
    }
  }
  const store = new ShortLeaseStore(tempRoot);
  let competingLease;
  let releaseEffect = () => undefined;
  const effectGate = new Promise(resolve => {
    releaseEffect = resolve;
  });
  try {
    const running = runInit({
      mode: 'create',
      server: 'https://woa.example',
      store,
      installSignalHandlers: false,
      effects: {
        checkEnvironment: async () => {
          await effectGate;
          return { supported: false, reason: 'test stop' };
        },
      },
      renderer: { render: async () => undefined },
    });
    const run = await waitUntil(() => store.latest(), 5_000);
    assert.ok(run);
    await waitUntil(() => renewedPastInitialExpiry, 8_000);
    let conflict;
    try {
      competingLease = await store.acquireLease(run.runId);
      conflict = false;
    } catch (error) {
      conflict = error instanceof InitRunnerError && error.code === 'init_run_conflict';
    }
    if (competingLease) await store.releaseLease(competingLease);
    releaseEffect();
    const result = await running.catch(error => error);

    assert.equal(conflict, true, 'a second process must not steal a lease during a long effect');
    assert.equal(result instanceof Error, false, result?.message);
    assert.equal(result.event.status, 'unsupported');
  } finally {
    releaseEffect();
    if (competingLease) await store.releaseLease(competingLease);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resuming a recoverable timeout returns to running and retries the interrupted effect', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-timeout-resume-'));
  const store = new FileInitRunStore(tempRoot);
  let attempts = 0;
  const effects = {
    isCliAuthenticated: async () => false,
    prepareCliOAuth: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary probe timeout');
      return { authorizationUrl: 'https://woa.example/authorize?retry=reached' };
    },
  };
  const renderer = { render: async () => undefined };
  try {
    const failed = await runInit({
      mode: 'create', server: 'https://woa.example', store, renderer, effects, installSignalHandlers: false,
    });
    assert.equal(failed.event.status, 'error');
    assert.equal(failed.event.error?.recoverable, true);
    assert.equal(failed.event.nextAction?.kind, 'wait');

    const retried = await runInit({
      mode: 'resume', runId: failed.event.runId, store, renderer, effects, installSignalHandlers: false,
    });
    assert.equal(attempts, 2);
    assert.equal(retried.event.status, 'action_required');
    assert.equal(retried.event.nextAction?.kind, 'open_url');
    assert.match(retried.event.nextAction?.url ?? '', /retry=reached/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Agent mode projects an invalid init transition as one schema-valid JSONL error', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-state-error-'));
  const initDirectory = path.join(tempRoot, 'runs');
  const run = eventAtRemoteMcp();
  try {
    await writeSecureJson(path.join(initDirectory, `${run.runId}.json`), run);
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'src/cli/woa.ts',
      'init', 'resume', run.runId,
      '--agent', '--format', 'jsonl',
      '--event', 'host_oauth_completed',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        WOA_CLI_CONFIG: path.join(tempRoot, 'config', 'cli.json'),
        WOA_INIT_DIR: initDirectory,
      },
    });

    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.type, 'error');
    assert.equal(event.status, 'error');
    assert.equal(event.error.code, 'init_run_conflict');
    assert.doesNotThrow(() => serializeInitEvent(event));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Agent mode fail-closes a malformed checkpoint as a synthetic schema-valid JSONL error', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-init-malformed-checkpoint-'));
  const initDirectory = path.join(tempRoot, 'runs');
  const malformed = { ...createInitRun({ server: 'https://woa.example', runId: RUN_ID }), unknown: true };
  try {
    await writeSecureJson(path.join(initDirectory, `${RUN_ID}.json`), malformed);
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'src/cli/woa.ts',
      'init', 'resume', RUN_ID, '--agent', '--format', 'jsonl',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        WOA_CLI_CONFIG: path.join(tempRoot, 'config', 'cli.json'),
        WOA_INIT_DIR: initDirectory,
      },
    });

    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.type, 'error');
    assert.equal(event.error.code, 'init_run_conflict');
    assert.equal(event.error.recoverable, false);
    assert.equal(event.resume, undefined);
    assert.doesNotThrow(() => serializeInitEvent(event));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Agent, pipe, and CI cannot submit human-only init events', () => {
  const result = runWoa([
    'init', 'resume', RUN_ID,
    '--agent', '--format', 'jsonl',
    '--event', 'allowlist_saved',
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /human-only.*directly operated TTY/i);
  assert.equal(result.stdout, '');
});

test('test fixture itself never leaves local secrets in the repository', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8').toLowerCase();
  const forbiddenFixture = ['wx', 'app', 'secret', 'fixture', 'value'].join('_');
  assert.equal(source.includes(forbiddenFixture), false);
});
