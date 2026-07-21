import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = mkdtempSync(path.join(tmpdir(), 'woa-package-node-lts-'));

try {
  const packDir = path.join(tempRoot, 'pack');
  const consumerDir = path.join(tempRoot, 'consumer');
  mkdirSync(packDir);
  mkdirSync(consumerDir);

  const packResult = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: projectRoot });
  const packJson = JSON.parse(packResult.stdout);
  assert.equal(packJson.length, 1);
  const tarball = path.join(packDir, packJson[0].filename);

  writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify({
    name: 'woa-package-smoke-consumer',
    private: true,
    type: 'module',
  }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumerDir });

  const cliPath = path.join(consumerDir, 'node_modules', '@ziikoo', 'woa', 'dist', 'src', 'cli', 'woa.js');
  const results = [];
  for (const major of [20]) {
    const node = resolveNodeBinary(major);
    const version = run(node, ['--version']).stdout.trim();
    assert.match(version, new RegExp(`^v${major}\\.`));

    const imported = run(node, [
      '--input-type=module',
      '-e',
      'const api=await import("@ziikoo/woa"); if(!api.createDefaultTenantContext) process.exit(2);',
    ], { cwd: consumerDir });
    assert.equal(imported.status, 0);

    const cliVersion = run(node, [cliPath, '--version']).stdout.trim();
    assert.match(cliVersion, /^\d+\.\d+\.\d+$/);

    const agentHelp = JSON.parse(run(node, [cliPath, 'help', 'agent', '--format', 'json']).stdout);
    assert.equal(agentHelp.cliVersion, cliVersion);
    assert.deepEqual(agentHelp.entrypoint.args, ['init', '--agent', '--format', 'jsonl']);
    assert.doesNotMatch(JSON.stringify(agentHelp), /Bearer|appSecret|refresh_token|callback-url/i);

    const descriptor = JSON.parse(run(node, [
      cliPath,
      'mcp',
      'descriptor',
      '--server',
      'https://woa.example',
    ]).stdout);
    assert.equal(descriptor.transport, 'streamable-http');
    assert.deepEqual(descriptor.headers, {});

    const ui = run(node, [cliPath, 'ui'], {
      allowFailure: true,
      env: smokeEnv(path.join(tempRoot, `node-${major}-ui`), { CI: '1' }),
    });
    assert.equal(ui.status, 2);
    assert.match(ui.stderr, /CI cannot open `woa ui`|requires directly operated TTY/);
    assert.doesNotMatch(ui.stdout + ui.stderr, /\u001b/);

    const uiPseudoTty = runUiPseudoTty({ major, node, cliPath });
    assert.equal(uiPseudoTty.status, 0, uiPseudoTty.stderr || uiPseudoTty.stdout);
    assert.match(uiPseudoTty.stdout, /\u001b\[\?1049h/);
    assert.match(uiPseudoTty.stdout, /\u001b\[\?1049l/);

    const jsonlRoot = path.join(tempRoot, `node-${major}-jsonl`);
    const jsonl = run(node, [
      cliPath,
      'init',
      '--agent',
      '--format',
      'jsonl',
      '--server',
      'http://127.0.0.1:9',
    ], {
      allowFailure: true,
      env: smokeEnv(jsonlRoot, { CI: '1' }),
    });
    assert.equal(jsonl.status, 1);
    const jsonlEvents = jsonl.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(jsonlEvents.at(-1)?.type, 'error');
    assert.equal(jsonlEvents.at(-1)?.error?.recoverable, true);
    assert.doesNotMatch(jsonl.stdout, /\u001b|appSecret|refresh_token|access_token/);

    const plain = runPlainPseudoTty({ major, node, cliPath });
    assert.equal(plain.status, 0, plain.stderr || plain.stdout);
    assert.match(plain.stdout, /WOA 微信 MCP 接入/);
    assert.match(plain.stdout, /\[q\] 保存并稍后继续/);
    assert.doesNotMatch(plain.stdout, /\u001b/);

    await runSignalSmoke({ major, node, cliPath });
    results.push({ node: version, import: true, uiGate: true, uiPseudoTty: true, plainPseudoTty: true, jsonl: true, signalExit: 143 });
  }

  process.stdout.write(`${JSON.stringify({ tarball: path.basename(tarball), results })}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function resolveNodeBinary(major) {
  const result = run('npx', ['--yes', '--package', `node@${major}`, 'which', 'node']);
  return result.stdout.trim();
}

function runPlainPseudoTty({ major, node, cliPath }) {
  const root = path.join(tempRoot, `node-${major}-plain`);
  const wrapper = path.join(tempRoot, `node-${major}-plain.sh`);
  writeFileSync(wrapper, [
    '#!/bin/sh',
    `exec ${shellQuote(node)} ${shellQuote(cliPath)} init --plain --server http://127.0.0.1:9`,
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o700);
  const environment = envAssignments(smokeEnv(root)).map(shellQuote).join(' ');
  const command = process.platform === 'darwin'
    ? `printf 'q\\n' | script -q /dev/null env ${environment} ${shellQuote(wrapper)}`
    : `printf 'q\\n' | script -q -e -c ${shellQuote(`env ${environment} ${shellQuote(wrapper)}`)} /dev/null`;
  return run('/bin/sh', ['-c', command], { allowFailure: true });
}

function runUiPseudoTty({ major, node, cliPath }) {
  const root = path.join(tempRoot, `node-${major}-ui-pty`);
  const wrapper = path.join(tempRoot, `node-${major}-ui-pty.sh`);
  writeFileSync(wrapper, [
    '#!/bin/sh',
    `exec ${shellQuote(node)} ${shellQuote(cliPath)} ui`,
    '',
  ].join('\n'));
  chmodSync(wrapper, 0o700);
  const environment = envAssignments(smokeEnv(root, { CI: '', TERM: 'xterm-256color' })).map(shellQuote).join(' ');
  const delayedInput = `(sleep 1; printf q; sleep 1; printf q; sleep 1; printf q)`;
  const command = process.platform === 'darwin'
    ? `${delayedInput} | script -q /dev/null env ${environment} ${shellQuote(wrapper)}`
    : `${delayedInput} | script -q -e -c ${shellQuote(`env ${environment} ${shellQuote(wrapper)}`)} /dev/null`;
  return run('/bin/sh', ['-c', command], { allowFailure: true, timeout: 30_000 });
}

async function runSignalSmoke({ major, node, cliPath }) {
  const server = createServer((_request, _response) => {
    // Keep OAuth discovery pending until SIGTERM aborts fetch.
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const root = path.join(tempRoot, `node-${major}-signal`);
  const child = spawn(node, [
    cliPath,
    'init',
    '--agent',
    '--format',
    'jsonl',
    '--server',
    `http://127.0.0.1:${port}`,
  ], {
    env: smokeEnv(root, { CI: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    child.kill('SIGTERM');
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code));
    });
    assert.equal(status, 143, stderr || stdout);
    const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(events.at(-1)?.type, 'paused');
    assert.equal(events.at(-1)?.status, 'paused');
    assert.doesNotMatch(stdout, /\u001b|appSecret|refresh_token|access_token/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

function smokeEnv(root, extra = {}) {
  return {
    ...process.env,
    NO_COLOR: '1',
    WOA_CLI_CONFIG: path.join(root, 'config.json'),
    WOA_INIT_DIR: path.join(root, 'runs'),
    ...extra,
  };
}

function envAssignments(env) {
  const assignments = [
    `NO_COLOR=${env.NO_COLOR}`,
    `WOA_CLI_CONFIG=${env.WOA_CLI_CONFIG}`,
    `WOA_INIT_DIR=${env.WOA_INIT_DIR}`,
  ];
  if (env.CI !== undefined) assignments.push(`CI=${env.CI}`);
  if (env.TERM !== undefined) assignments.push(`TERM=${env.TERM}`);
  return assignments;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout,
  });
  if (result.error) throw result.error;
  const normalized = {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  if (!options.allowFailure && normalized.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${normalized.status}).\n${normalized.stderr || normalized.stdout}`);
  }
  return normalized;
}
