import { randomBytes } from 'node:crypto';
import { open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  createInitRun,
  InitStateError,
  type InitErrorCode,
  type InitProtocolEvent,
  type RemoteInitRunReference,
  type InitRun,
  toInitProtocolEvent,
  transitionInitRun,
  validateInitRun,
} from './init.js';
import { defaultInitDirectory, ensureSecureDirectory, readSecureJson, writeSecureJson } from './secure-config.js';
import { CLI_VERSION } from './version.js';

const DEFAULT_LEASE_MS = 30_000;

export interface InitRunLease {
  runId: string;
  token: string;
  expiresAt: number;
}

interface LeaseFile extends InitRunLease {
  pid: number;
}

export interface InitRunStore {
  create(run: InitRun): Promise<void>;
  load(runId: string): Promise<InitRun | null>;
  latest(): Promise<InitRun | null>;
  acquireLease(runId: string, ttlMs?: number): Promise<InitRunLease>;
  renewLease(lease: InitRunLease, ttlMs?: number): Promise<InitRunLease>;
  checkpoint(run: InitRun, expectedRunVersion: number, lease: InitRunLease): Promise<void>;
  releaseLease(lease: InitRunLease): Promise<void>;
}

export class InitRunnerError extends Error {
  readonly code: InitErrorCode;

  constructor(code: InitErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class FileInitRunStore implements InitRunStore {
  readonly directory: string;

  constructor(directory = defaultInitDirectory()) {
    this.directory = path.resolve(directory);
  }

  async create(run: InitRun): Promise<void> {
    validateInitRun(run);
    await ensureSecureDirectory(this.directory);
    if (await this.load(run.runId)) {
      throw new InitRunnerError('init_run_conflict', `Init run already exists: ${run.runId}`);
    }
    await writeSecureJson(this.runPath(run.runId), run);
  }

  async load(runId: string): Promise<InitRun | null> {
    assertRunId(runId);
    const value = await readSecureJson<InitRun>(this.runPath(runId));
    if (!value) return null;
    validateInitRun(value);
    return value;
  }

  async latest(): Promise<InitRun | null> {
    await ensureSecureDirectory(this.directory);
    const names = await readdir(this.directory);
    const candidates = await Promise.all(names
      .filter(name => /^run_[a-f0-9]{32}\.json$/.test(name))
      .map(async name => {
        const filePath = path.join(this.directory, name);
        const info = await stat(filePath);
        return { name, mtimeMs: info.mtimeMs };
      }));
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!candidates[0]) return null;
    return await this.load(candidates[0].name.slice(0, -'.json'.length));
  }

  async acquireLease(runId: string, ttlMs = DEFAULT_LEASE_MS): Promise<InitRunLease> {
    assertRunId(runId);
    await ensureSecureDirectory(this.directory);
    const leasePath = this.leasePath(runId);
    const lease: LeaseFile = {
      runId,
      token: randomBytes(16).toString('hex'),
      expiresAt: Date.now() + ttlMs,
      pid: process.pid,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(leasePath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(lease)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        return lease;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readLease(leasePath);
        if (existing && existing.expiresAt > Date.now()) {
          throw new InitRunnerError('init_run_conflict', `Init run ${runId} is already being resumed.`);
        }
        if (!existing) {
          const info = await stat(leasePath).catch(() => null);
          if (info && Date.now() - info.mtimeMs < ttlMs) {
            throw new InitRunnerError('init_run_conflict', `Init run ${runId} has a live lease that is being updated.`);
          }
        }
        await unlink(leasePath).catch(() => undefined);
      }
    }
    throw new InitRunnerError('init_run_conflict', `Could not acquire the init run lease: ${runId}`);
  }

  async renewLease(lease: InitRunLease, ttlMs = DEFAULT_LEASE_MS): Promise<InitRunLease> {
    const leasePath = this.leasePath(lease.runId);
    let handle;
    try {
      handle = await open(leasePath, 'r+');
      const parsed = parseLease(await handle.readFile('utf8'));
      if (!parsed || parsed.token !== lease.token || parsed.runId !== lease.runId || parsed.expiresAt <= Date.now()) {
        throw new InitRunnerError('init_run_conflict', `Init run lease cannot be renewed: ${lease.runId}`);
      }
      const renewed: LeaseFile = {
        ...parsed,
        expiresAt: Date.now() + ttlMs,
      };
      const bytes = Buffer.from(`${JSON.stringify(renewed)}\n`, 'utf8');
      await handle.write(bytes, 0, bytes.length, 0);
      await handle.truncate(bytes.length);
      await handle.sync();
      const verified = await readLease(leasePath);
      if (!verified || verified.token !== lease.token || verified.expiresAt !== renewed.expiresAt) {
        throw new InitRunnerError('init_run_conflict', `Init run lease ownership changed during renewal: ${lease.runId}`);
      }
      return { runId: renewed.runId, token: renewed.token, expiresAt: renewed.expiresAt };
    } catch (error) {
      if (error instanceof InitRunnerError) throw error;
      throw new InitRunnerError('init_run_conflict', `Init run lease renewal failed: ${lease.runId}`);
    } finally {
      await handle?.close();
    }
  }

  async checkpoint(run: InitRun, expectedRunVersion: number, lease: InitRunLease): Promise<void> {
    validateInitRun(run);
    await this.assertLease(lease);
    const current = await this.load(run.runId);
    if (!current || current.runVersion !== expectedRunVersion || run.runVersion !== expectedRunVersion + 1) {
      throw new InitRunnerError('init_run_conflict', `Init run ${run.runId} changed while it was being resumed.`);
    }
    try {
      await writeSecureJson(this.runPath(run.runId), run);
    } catch (error) {
      if (error instanceof InitRunnerError) throw error;
      throw new InitRunnerError(
        'checkpoint_save_failed',
        `Failed to save the init checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async releaseLease(lease: InitRunLease): Promise<void> {
    const current = await readLease(this.leasePath(lease.runId));
    if (current?.token === lease.token) await unlink(this.leasePath(lease.runId)).catch(() => undefined);
  }

  private async assertLease(lease: InitRunLease): Promise<void> {
    const current = await readLease(this.leasePath(lease.runId));
    if (!current || current.token !== lease.token || current.expiresAt <= Date.now()) {
      throw new InitRunnerError('init_run_conflict', `Init run lease is missing or expired: ${lease.runId}`);
    }
  }

  private runPath(runId: string): string {
    return path.join(this.directory, `${runId}.json`);
  }

  private leasePath(runId: string): string {
    return path.join(this.directory, `${runId}.lease`);
  }
}

export interface EnvironmentCheckResult {
  supported: boolean;
  reason?: string;
}

export interface InitRunnerEffects {
  checkEnvironment?: (run: InitRun, signal: AbortSignal) => Promise<EnvironmentCheckResult>;
  isCliAuthenticated?: (run: InitRun, signal: AbortSignal) => Promise<boolean>;
  prepareCliOAuth?: (run: InitRun, signal: AbortSignal) => Promise<{ authorizationUrl: string }>;
  completeCliOAuth?: (run: InitRun, signal: AbortSignal) => Promise<void>;
  loadWechatEgress?: (
    run: InitRun,
    signal: AbortSignal,
  ) => Promise<{ ips: string[]; configVersion: string; remote?: RemoteInitRunReference }>;
  confirmWechatEgress?: (run: InitRun, signal: AbortSignal) => Promise<{ remoteVersion: number }>;
  createCredentialHandoff?: (
    run: InitRun,
    signal: AbortSignal,
  ) => Promise<{ handoffId: string; remoteVersion: number; handoffUrl: string }>;
  getCredentialHandoffStatus?: (
    run: InitRun,
    signal: AbortSignal,
  ) => Promise<{
    status: 'pending' | 'claimed' | 'processing' | 'verified' | 'failed' | 'expired';
    errorCode?: string;
    remoteVersion?: number;
  }>;
  createTestDraft?: (
    run: InitRun,
    signal: AbortSignal,
  ) => Promise<{ mediaId: string; remoteVersion?: number }>;
  openUrl?: (url: string, signal: AbortSignal) => Promise<void>;
}

export type InitRendererAction =
  | { kind: 'pause' }
  | { kind: 'interrupt' }
  | { kind: 'confirm' }
  | { kind: 'open_url'; url: string }
  | { kind: 'acknowledge' }
  | { kind: 'remote_mcp_added' }
  | { kind: 'host_oauth_completed' }
  | { kind: 'host_tool_verified'; tool: 'woa_context' | 'wechat_draft_count' }
  | { kind: 'decline' }
  | { kind: 'epipe' };

export interface InitRenderer {
  render(event: InitProtocolEvent): Promise<InitRendererAction | void>;
  restore?(): Promise<void> | void;
}

export interface RunInitOptions {
  mode: 'create' | 'resume' | 'status';
  server?: string;
  runId?: string;
  store: InitRunStore;
  renderer: InitRenderer;
  effects?: InitRunnerEffects;
  packageVersion?: string;
  cliVersion?: string;
  installSignalHandlers?: boolean;
  resumeEvent?:
    | { kind: 'allowlist_saved' }
    | { kind: 'remote_mcp_added' }
    | { kind: 'host_oauth_completed' }
    | { kind: 'host_tool_verified'; tool: 'woa_context' | 'wechat_draft_count' }
    | { kind: 'test_draft_confirmed' }
    | { kind: 'test_draft_declined' };
}

export interface RunInitResult {
  event: InitProtocolEvent;
  exitCode: number;
  epipe?: boolean;
}

/**
 * Effect runner 是状态机与 I/O 的唯一连接点。每次输出前先 checkpoint；renderer 不执行网络或写文件。
 */
export async function runInit(options: RunInitOptions): Promise<RunInitResult> {
  const version = options.packageVersion ?? CLI_VERSION;
  if (options.mode === 'status') {
    const run = options.runId ? await options.store.load(options.runId) : await options.store.latest();
    if (!run) throw new InitRunnerError('init_run_expired', 'No resumable init run was found.');
    assertExactVersion(run, version);
    const event = toInitProtocolEvent(run);
    const action = await options.renderer.render(event);
    return { event, exitCode: event.type === 'error' ? 1 : 0, epipe: action?.kind === 'epipe' };
  }

  let run: InitRun;
  if (options.mode === 'create') {
    run = createInitRun({
      server: options.server || 'https://woa.ziikoo.app',
      cliVersion: options.cliVersion ?? CLI_VERSION,
      packageVersion: version,
    });
    await options.store.create(run);
  } else {
    if (!options.runId) throw new InitRunnerError('init_run_expired', 'init resume requires a runId.');
    const loaded = await options.store.load(options.runId);
    if (!loaded) throw new InitRunnerError('init_run_expired', `Init run not found: ${options.runId}`);
    assertExactVersion(loaded, version);
    run = loaded;
  }

  const lease = await options.store.acquireLease(run.runId);
  const controller = new AbortController();
  const heartbeat = startLeaseHeartbeat(options.store, lease, controller);
  const signalState = options.installSignalHandlers === false
    ? null
    : installSignals(controller);
  try {
    if (options.mode === 'resume' && ['paused', 'error', 'unsupported'].includes(run.status)) {
      run = await checkpointTransition(options.store, lease, run, { kind: 'resume' });
    }
    if (options.mode === 'resume' && options.resumeEvent) {
      run = await applyResumeEvent(run, options.resumeEvent, options.store, lease, options.effects ?? {}, controller.signal);
    }
    run = await advanceAutomatic(run, options.store, lease, options.effects ?? {}, controller.signal);

    while (true) {
      const event = toInitProtocolEvent(run);
      const signal = signalState?.received();
      if (signal) return await finishSignal(signal, run, options, lease, controller);

      const rendererAction = await options.renderer.render(event);
      const signalAfterRender = signalState?.received();
      if (signalAfterRender) return await finishSignal(signalAfterRender, run, options, lease, controller);
      if (rendererAction?.kind === 'epipe') return { event, exitCode: 0, epipe: true };

      if (rendererAction?.kind === 'open_url' && options.effects?.openUrl) {
        await options.effects.openUrl(rendererAction.url, controller.signal);
        if (run.phase === 'woa_login_required' && options.effects.completeCliOAuth) {
          await options.effects.completeCliOAuth(run, controller.signal);
          if (await options.effects.isCliAuthenticated?.(run, controller.signal)) {
            run = await checkpointTransition(options.store, lease, run, { kind: 'cli_authenticated' });
            run = await advanceAutomatic(run, options.store, lease, options.effects, controller.signal);
            continue;
          }
        }
        run = await checkpointTransition(options.store, lease, run, { kind: 'pause' });
        const paused = toInitProtocolEvent(run);
        await options.renderer.render(paused);
        return { event: paused, exitCode: 0 };
      }
      if (rendererAction?.kind === 'acknowledge' && run.phase === 'wechat_ip_allowlist_required') {
        run = await applyAllowlistConfirmation(run, options.store, lease, options.effects ?? {}, controller.signal);
        run = await advanceAutomatic(run, options.store, lease, options.effects ?? {}, controller.signal);
        continue;
      }
      if (rendererAction?.kind === 'remote_mcp_added' && run.phase === 'remote_mcp_required') {
        run = await checkpointTransition(options.store, lease, run, { kind: 'remote_mcp_added' });
        continue;
      }
      if (rendererAction?.kind === 'host_oauth_completed' && run.phase === 'host_oauth_required') {
        run = await checkpointTransition(options.store, lease, run, { kind: 'host_oauth_completed' });
        continue;
      }
      if (rendererAction?.kind === 'host_tool_verified' && run.phase === 'tool_verification_required') {
        run = await checkpointTransition(options.store, lease, run, {
          kind: 'host_tool_verified',
          tool: rendererAction.tool,
        });
        continue;
      }
      if (rendererAction?.kind === 'decline' && run.phase === 'test_draft_required') {
        run = await checkpointTransition(options.store, lease, run, { kind: 'test_draft_declined' });
        continue;
      }
      if (rendererAction?.kind === 'confirm' && run.phase === 'test_draft_required') {
        run = await checkpointTransition(options.store, lease, run, { kind: 'test_draft_confirmed' });
        run = await advanceAutomatic(run, options.store, lease, options.effects ?? {}, controller.signal);
        continue;
      }
      if (rendererAction?.kind === 'pause') {
        run = await checkpointTransition(options.store, lease, run, { kind: 'pause' });
        const paused = toInitProtocolEvent(run);
        await options.renderer.render(paused);
        return { event: paused, exitCode: 0 };
      }
      if (rendererAction?.kind === 'interrupt') {
        run = await checkpointTransition(options.store, lease, run, { kind: 'pause' });
        const paused = toInitProtocolEvent(run);
        await options.renderer.render(paused);
        return { event: paused, exitCode: 130 };
      }
      return { event, exitCode: event.type === 'error' ? 1 : 0 };
    }
  } catch (error) {
    const heartbeatError = heartbeat.error();
    if (heartbeatError) throw heartbeatError;
    const signal = signalState?.received();
    if (signal) return await finishSignal(signal, run, options, lease, controller);
    if (error instanceof InitRunnerError || error instanceof InitStateError) throw error;
    const persisted = await options.store.load(run.runId).catch(() => null);
    if (persisted && persisted.runVersion >= run.runVersion) run = persisted;
    const failed = transitionInitRun(run, {
      kind: 'fail',
      error: {
        code: 'timeout',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      },
    });
    try {
      await options.store.checkpoint(failed, run.runVersion, lease);
      const event = toInitProtocolEvent(failed);
      await options.renderer.render(event);
      return { event, exitCode: 1 };
    } catch (checkpointError) {
      const event = checkpointFailureEvent(run, checkpointError);
      await options.renderer.render(event);
      return { event, exitCode: 1 };
    }
  } finally {
    signalState?.dispose();
    await heartbeat.stop();
    await options.renderer.restore?.();
    await options.store.releaseLease(lease);
  }
}

interface LeaseHeartbeat {
  error(): InitRunnerError | null;
  stop(): Promise<void>;
}

function startLeaseHeartbeat(
  store: InitRunStore,
  initialLease: InitRunLease,
  controller: AbortController,
): LeaseHeartbeat {
  const ttlMs = Math.max(30, initialLease.expiresAt - Date.now());
  const intervalMs = Math.max(10, Math.floor(ttlMs / 3));
  let current = initialLease;
  let stopped = false;
  let failure: InitRunnerError | null = null;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;

  const schedule = () => {
    if (stopped || failure) return;
    timer = setTimeout(() => {
      inFlight = store.renewLease(current, ttlMs)
        .then(renewed => {
          current = renewed;
        })
        .catch(error => {
          failure = error instanceof InitRunnerError
            ? error
            : new InitRunnerError('init_run_conflict', 'Init run lease heartbeat failed.');
          controller.abort(failure);
        })
        .finally(() => {
          inFlight = null;
          schedule();
        });
    }, intervalMs);
    timer.unref?.();
  };
  schedule();

  return {
    error: () => failure,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}

async function applyResumeEvent(
  run: InitRun,
  event: NonNullable<RunInitOptions['resumeEvent']>,
  store: InitRunStore,
  lease: InitRunLease,
  effects: InitRunnerEffects,
  signal: AbortSignal,
): Promise<InitRun> {
  switch (event.kind) {
    case 'allowlist_saved':
      return await applyAllowlistConfirmation(run, store, lease, effects, signal);
    case 'remote_mcp_added':
      return await checkpointTransition(store, lease, run, { kind: 'remote_mcp_added' });
    case 'host_oauth_completed':
      return await checkpointTransition(store, lease, run, { kind: 'host_oauth_completed' });
    case 'host_tool_verified':
      return await checkpointTransition(store, lease, run, { kind: 'host_tool_verified', tool: event.tool });
    case 'test_draft_confirmed':
      return await checkpointTransition(store, lease, run, { kind: 'test_draft_confirmed' });
    case 'test_draft_declined':
      return await checkpointTransition(store, lease, run, { kind: 'test_draft_declined' });
  }
}

async function applyAllowlistConfirmation(
  run: InitRun,
  store: InitRunStore,
  lease: InitRunLease,
  effects: InitRunnerEffects,
  signal: AbortSignal,
): Promise<InitRun> {
  const confirmation = effects.confirmWechatEgress
    ? await effects.confirmWechatEgress(run, signal)
    : undefined;
  let next = await checkpointTransition(store, lease, run, {
    kind: 'wechat_allowlist_acknowledged',
    remoteVersion: confirmation?.remoteVersion,
  });
  if (effects.createCredentialHandoff) {
    const handoff = await effects.createCredentialHandoff(next, signal);
    next = await checkpointTransition(store, lease, next, {
      kind: 'credential_handoff_created',
      handoffId: handoff.handoffId,
      remoteVersion: handoff.remoteVersion,
    });
    if (effects.openUrl) await effects.openUrl(handoff.handoffUrl, signal);
  }
  return next;
}

async function advanceAutomatic(
  initial: InitRun,
  store: InitRunStore,
  lease: InitRunLease,
  effects: InitRunnerEffects,
  signal: AbortSignal,
): Promise<InitRun> {
  let run = initial;
  if (run.phase === 'environment_check') {
    const result = effects.checkEnvironment
      ? await effects.checkEnvironment(run, signal)
      : defaultEnvironmentCheck();
    if (!result.supported) {
      return await checkpointTransition(store, lease, run, {
        kind: 'unsupported',
        error: {
          code: 'node_runtime_missing',
          message: result.reason || 'Node.js 18 or newer is required.',
          recoverable: false,
        },
      });
    }
    run = await checkpointTransition(store, lease, run, { kind: 'environment_supported' });
  }

  if (run.phase === 'woa_login_required' && effects.isCliAuthenticated) {
    if (await effects.isCliAuthenticated(run, signal)) {
      run = await checkpointTransition(store, lease, run, { kind: 'cli_authenticated' });
    } else if (run.status === 'running' && effects.prepareCliOAuth) {
      const prepared = await effects.prepareCliOAuth(run, signal);
      run = await checkpointTransition(store, lease, run, {
        kind: 'cli_oauth_prepared',
        authorizationUrl: prepared.authorizationUrl,
      });
    }
  }

  if (
    run.phase === 'wechat_ip_allowlist_required' &&
    run.status === 'running' &&
    effects.loadWechatEgress
  ) {
    const egress = await effects.loadWechatEgress(run, signal);
    run = await checkpointTransition(store, lease, run, {
      kind: 'egress_ips_loaded',
      ips: egress.ips,
      configVersion: egress.configVersion,
      remote: egress.remote,
    });
  }
  if (
    run.phase === 'wechat_credentials_required' &&
    run.remote?.handoffId &&
    effects.getCredentialHandoffStatus
  ) {
    const handoff = await effects.getCredentialHandoffStatus(run, signal);
    if (handoff.status === 'verified') {
      run = await checkpointTransition(store, lease, run, {
        kind: 'wechat_credentials_verified',
        remoteVersion: handoff.remoteVersion,
      });
    } else if (handoff.status === 'failed' || handoff.status === 'expired') {
      run = await checkpointTransition(store, lease, run, {
        kind: 'fail',
        error: {
          code: credentialErrorCode(handoff.errorCode),
          message: `Credential handoff ${handoff.status}${handoff.errorCode ? `: ${handoff.errorCode}` : '.'}`,
          recoverable: true,
        },
      });
    }
  }
  if (
    run.phase === 'test_draft_required' &&
    run.status === 'running' &&
    run.nextAction?.kind === 'wait' &&
    run.nextAction.operation === 'create_test_draft' &&
    effects.createTestDraft
  ) {
    const draft = await effects.createTestDraft(run, signal);
    run = await checkpointTransition(store, lease, run, {
      kind: 'test_draft_created',
      mediaId: draft.mediaId,
      remoteVersion: draft.remoteVersion,
    });
  }
  return run;
}

async function checkpointTransition(
  store: InitRunStore,
  lease: InitRunLease,
  current: InitRun,
  transition: Parameters<typeof transitionInitRun>[1],
): Promise<InitRun> {
  const next = transitionInitRun(current, transition);
  await store.checkpoint(next, current.runVersion, lease);
  return next;
}

function defaultEnvironmentCheck(): EnvironmentCheckResult {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
  return major >= 18
    ? { supported: true }
    : { supported: false, reason: `Node.js ${process.versions.node} is unsupported; install Node.js 18 or newer.` };
}

function assertExactVersion(run: InitRun, version: string): void {
  if (run.packageVersion !== version) {
    throw new InitRunnerError(
      'cli_upgrade_required',
      `Init run ${run.runId} requires exact CLI version ${run.packageVersion}; current version is ${version}.`,
    );
  }
}

function checkpointFailureEvent(run: InitRun, error: unknown): InitProtocolEvent {
  const failed: InitRun = {
    ...run,
    status: 'error',
    error: {
      code: 'checkpoint_save_failed',
      message: error instanceof Error ? error.message : String(error),
      recoverable: false,
    },
    nextAction: undefined,
  };
  const event = toInitProtocolEvent(failed);
  delete event.resume;
  return event;
}

interface SignalState {
  received(): NodeJS.Signals | null;
  dispose(): void;
}

function installSignals(controller: AbortController): SignalState {
  let current: NodeJS.Signals | null = null;
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[]) {
    const handler = () => {
      current ??= signal;
      controller.abort(new Error(signal));
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return {
    received: () => current,
    dispose: () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    },
  };
}

async function finishSignal(
  signal: NodeJS.Signals,
  run: InitRun,
  options: RunInitOptions,
  lease: InitRunLease,
  controller: AbortController,
): Promise<RunInitResult> {
  controller.abort(new Error(signal));
  const persisted = await options.store.load(run.runId).catch(() => null);
  if (persisted && persisted.runVersion >= run.runVersion) run = persisted;
  let event = toInitProtocolEvent(run);
  if (run.status !== 'done') {
    try {
      const paused = transitionInitRun(run, { kind: 'pause' });
      await withTimeout(options.store.checkpoint(paused, run.runVersion, lease), 1_500);
      event = toInitProtocolEvent(paused);
    } catch {
      // 信号路径仅 best-effort；未保存成功时不输出虚假的可恢复声明。
      event = checkpointFailureEvent(run, new InitRunnerError('checkpoint_save_failed', 'Signal checkpoint did not complete.'));
    }
  }
  await options.renderer.restore?.();
  await options.renderer.render(event).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EPIPE') throw error;
  });
  if (signal === 'SIGINT') return { event, exitCode: 130 };

  // 调用方在 finally 释放 lease 后以 128+signal 的语义退出；不把信号伪装成普通业务错误。
  return { event, exitCode: signal === 'SIGTERM' ? 143 : 129 };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readLease(filePath: string): Promise<LeaseFile | null> {
  try {
    return parseLease(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseLease(value: string): LeaseFile | null {
  try {
    const parsed = JSON.parse(value) as Partial<LeaseFile>;
    if (
      typeof parsed.runId === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      typeof parsed.pid === 'number'
    ) return parsed as LeaseFile;
    return null;
  } catch {
    return null;
  }
}

function assertRunId(runId: string): void {
  if (!/^run_[a-f0-9]{32}$/.test(runId)) {
    throw new InitRunnerError('init_run_expired', 'Invalid init runId.');
  }
}

function credentialErrorCode(code: string | undefined): InitErrorCode {
  if (code === 'wechat_ip_not_allowlisted') return 'wechat_ip_not_allowlisted';
  if (code === 'wechat_relay_unavailable') return 'wechat_relay_unavailable';
  if (code === 'wechat_invalid_credentials' || code === 'wechat_credentials_rejected') return 'wechat_invalid_credentials';
  return 'secure_input_required';
}
