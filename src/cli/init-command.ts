import { JsonInitRenderer, JsonlInitRenderer } from './init-jsonl.js';
import {
  FileInitRunStore,
  InitRunnerError,
  runInit,
  type InitRenderer,
  type RunInitOptions,
} from './init-runner.js';
import { PlainInitRenderer } from './init-tui.js';
import {
  createInitRun,
  InitStateError,
  toInitProtocolEvent,
  transitionInitRun,
  type InitProtocolEvent,
  type RemoteInitRunReference,
} from './init.js';
import { defaultInitDirectory } from './secure-config.js';
import { detectTerminalCapabilities, normalizeInkCiEnvironment } from './terminal-capabilities.js';
import { CliUsageError } from './cli-errors.js';
import { CLI_VERSION } from './version.js';

export type CliFlags = Record<string, string | boolean>;

export interface InitCommandConfig {
  server?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface PreparedInitOAuthAuthorization {
  authorizationUrl: string;
  complete: () => Promise<void>;
  close: () => Promise<void>;
}

export interface InitCommandServices {
  configPath: string;
  loadConfig: () => Promise<InitCommandConfig>;
  apiGet: (route: string, flags: CliFlags) => Promise<unknown>;
  prepareCliOAuth: (
    server: string,
    options: {
      headless: boolean;
      callbackPort: number;
      timeoutMs: number;
      signal: AbortSignal;
    },
  ) => Promise<PreparedInitOAuthAuthorization>;
  completeHeadlessLogin: () => Promise<void>;
  initApiRequest: (
    method: 'GET' | 'POST',
    server: string,
    route: string,
    body: unknown,
    flags: CliFlags,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  selectInitTarget: (flags: CliFlags) => Promise<{ tenantId: string; accountId: string }>;
  openBrowser: (url: string) => void;
  isLikelyHeadlessEnvironment: () => boolean;
}

export interface ExecuteInitCommandOptions {
  sub?: string;
  leaf?: string;
  flags: CliFlags;
  services: InitCommandServices;
  renderer?: InitRenderer;
}

export interface InitConsoleSnapshot {
  event?: InitProtocolEvent;
  canResume: boolean;
}

export async function executeInitCommand(options: ExecuteInitCommandOptions): Promise<{ exitCode: number }> {
  const { sub, leaf, flags, services } = options;
  const agent = flagEnabled(flags, 'agent');
  const plain = flagEnabled(flags, 'plain');
  const format = stringFlag(flags, 'format');
  if (agent && format && format !== 'jsonl') {
    throw new CliUsageError('woa init --agent only supports --format jsonl.');
  }
  if (format && !['jsonl', 'json'].includes(format)) {
    throw new CliUsageError('woa init --format must be jsonl or json.');
  }
  if (format === 'json' && sub !== 'status') {
    throw new CliUsageError('--format json is only supported by woa init status.');
  }

  const mode = sub === 'resume' ? 'resume' : sub === 'status' ? 'status' : 'create';
  if (sub && sub !== 'resume' && sub !== 'status') {
    throw new CliUsageError(`Unknown init command: init ${sub}`);
  }
  const runId = mode === 'resume'
    ? leaf
    : mode === 'status'
      ? stringFlag(flags, 'run')
      : undefined;
  if (mode === 'resume' && !runId) throw new CliUsageError('woa init resume requires a runId.');

  const capabilities = detectTerminalCapabilities({ agent: agent || format === 'jsonl', plain });
  const resumeEvent = mode === 'resume'
    ? parseInitResumeEvent(flags, capabilities.interactive && capabilities.mode !== 'jsonl')
    : undefined;
  if (mode !== 'resume' && stringFlag(flags, 'event')) {
    throw new CliUsageError('--event is only valid with woa init resume.');
  }
  const renderer = options.renderer ?? await createRenderer({
    mode,
    format,
    capabilities,
    headless: flagEnabled(flags, 'headless'),
  });
  const store = new FileInitRunStore(defaultInitDirectory(services.configPath));
  const config = await services.loadConfig();
  const server = normalizeServer(stringFlag(flags, 'server') || config.server || 'https://woa.ziikoo.app');
  const initHeadless = flagEnabled(flags, 'headless') || !capabilities.interactive || services.isLikelyHeadlessEnvironment();
  const initOAuthState: { prepared: PreparedInitOAuthAuthorization | null } = { prepared: null };

  try {
    const result = await runInit({
      mode,
      runId,
      server,
      store,
      renderer,
      packageVersion: CLI_VERSION,
      cliVersion: CLI_VERSION,
      resumeEvent,
      effects: createInitEffects({
        flags,
        services,
        interactive: capabilities.interactive,
        initHeadless,
        initOAuthState,
      }),
    });
    return { exitCode: result.exitCode };
  } catch (error) {
    if ((error instanceof InitRunnerError || error instanceof InitStateError) && capabilities.mode === 'jsonl') {
      const existing = await (runId ? store.load(runId) : store.latest()).catch(() => null);
      const recoverable = Boolean(existing) && !['cli_upgrade_required', 'checkpoint_save_failed'].includes(error.code);
      if (existing && existing.phase !== 'completed' && existing.status !== 'done') {
        const event = toInitProtocolEvent(existing);
        event.type = 'error';
        event.status = 'error';
        event.error = { code: error.code, message: error.message, recoverable };
        if (!recoverable) delete event.resume;
        await renderer.render(event);
        return { exitCode: 1 };
      }
      const synthetic = transitionInitRun(createInitRun({
        server,
        ...(runId && /^run_[a-f0-9]{32}$/.test(runId) ? { runId } : {}),
        cliVersion: CLI_VERSION,
        packageVersion: CLI_VERSION,
      }), {
        kind: 'fail',
        error: { code: error.code, message: error.message, recoverable: false },
      });
      const event = toInitProtocolEvent(synthetic);
      delete event.resume;
      await renderer.render(event);
      return { exitCode: 1 };
    }
    throw error;
  } finally {
    await initOAuthState.prepared?.close();
  }
}

export async function loadInitConsoleSnapshot(configPath: string): Promise<InitConsoleSnapshot> {
  const store = new FileInitRunStore(defaultInitDirectory(configPath));
  const latest = await store.latest();
  if (!latest) return { canResume: false };
  const capture = new CaptureInitRenderer();
  let event: InitProtocolEvent;
  try {
    await runInit({
      mode: 'status',
      runId: latest.runId,
      store,
      renderer: capture,
      packageVersion: CLI_VERSION,
      cliVersion: CLI_VERSION,
      installSignalHandlers: false,
    });
    event = capture.event ?? toInitProtocolEvent(latest);
  } catch (error) {
    if (!(error instanceof InitRunnerError) || error.code !== 'cli_upgrade_required') throw error;
    event = toInitProtocolEvent(latest);
  }
  const canResume = latest.packageVersion === CLI_VERSION
    && latest.phase !== 'completed'
    && latest.status !== 'done'
    && (
      latest.status === 'paused'
      || latest.status === 'action_required'
      || (latest.status === 'error' && latest.error?.recoverable === true)
    );
  return { event, canResume };
}

class CaptureInitRenderer implements InitRenderer {
  event?: InitProtocolEvent;

  async render(event: InitProtocolEvent): Promise<void> {
    this.event = event;
  }
}

function createInitEffects(input: {
  flags: CliFlags;
  services: InitCommandServices;
  interactive: boolean;
  initHeadless: boolean;
  initOAuthState: { prepared: PreparedInitOAuthAuthorization | null };
}): NonNullable<RunInitOptions['effects']> {
  const { flags, services, interactive, initHeadless, initOAuthState } = input;
  return {
    isCliAuthenticated: async run => {
      const session = await services.loadConfig();
      if ((!session.accessToken && !session.refreshToken) || !session.server) return false;
      if (new URL(session.server).origin !== new URL(run.server).origin) return false;
      try {
        await services.apiGet('/api/v1/me', { server: run.server });
        return true;
      } catch {
        return false;
      }
    },
    prepareCliOAuth: async (run, signal) => {
      await initOAuthState.prepared?.close();
      initOAuthState.prepared = await services.prepareCliOAuth(run.server, {
        headless: initHeadless,
        callbackPort: Number(stringFlag(flags, 'callback-port') || (initHeadless ? '8787' : '0')),
        timeoutMs: Number(stringFlag(flags, 'timeout') || '300') * 1000,
        signal,
      });
      return { authorizationUrl: initOAuthState.prepared.authorizationUrl };
    },
    ...(interactive ? {
      completeCliOAuth: async () => {
        if (initOAuthState.prepared) await initOAuthState.prepared.complete();
        else await services.completeHeadlessLogin();
      },
    } : {}),
    loadWechatEgress: async (run, signal) => {
      const response = await services.initApiRequest('GET', run.server, '/api/v1/init/context', undefined, flags, undefined, signal);
      const root = asRecord(response);
      const data = asRecord(root?.data) ?? root;
      const egress = asRecord(data?.egress);
      const ips = Array.isArray(egress?.ips)
        ? egress.ips.filter((value): value is string => typeof value === 'string')
        : [];
      const configVersion = stringValue(egress?.configVersion);
      if (!configVersion || ips.length === 0) {
        throw new InitRunnerError('wechat_egress_ip_unavailable', 'The server did not return a trusted egress configuration.');
      }
      const target = await services.selectInitTarget({ ...flags, server: run.server });
      const serverRunResponse = await services.initApiRequest(
        'POST',
        run.server,
        '/api/v1/init/runs',
        target,
        flags,
        `woa-init:${run.runId}`,
        signal,
      );
      return { ips, configVersion, remote: parseRemoteInitRun(serverRunResponse) };
    },
    confirmWechatEgress: async (run, signal) => {
      if (!run.remote || run.nextAction?.kind !== 'update_wechat_ip_allowlist') {
        throw new InitRunnerError('init_run_conflict', 'The local run is missing its server init context.');
      }
      const response = await services.initApiRequest(
        'POST',
        run.server,
        `/api/v1/init/runs/${encodeURIComponent(run.remote.runId)}/egress-confirmation`,
        {
          confirmed: true,
          expectedVersion: run.remote.version,
          egressConfigVersion: run.nextAction.configVersion,
        },
        flags,
        undefined,
        signal,
      );
      return { remoteVersion: parseRemoteInitRun(response).version };
    },
    createCredentialHandoff: async (run, signal) => {
      if (!run.remote) throw new InitRunnerError('init_run_conflict', 'The local run is missing its server init context.');
      const response = await services.initApiRequest(
        'POST',
        run.server,
        `/api/v1/init/runs/${encodeURIComponent(run.remote.runId)}/credential-handoffs`,
        { expectedVersion: run.remote.version },
        flags,
        undefined,
        signal,
      );
      const root = asRecord(response);
      const data = asRecord(root?.data) ?? root;
      const remote = parseRemoteInitRun(response);
      const handoff = asRecord(data?.handoff);
      const handoffId = stringValue(handoff?.handoffId);
      const handoffUrl = stringValue(data?.handoffUrl);
      if (!handoffId || !handoffUrl) {
        throw new InitRunnerError('secure_input_required', 'The server did not create a valid one-time credential handoff.');
      }
      const parsedUrl = new URL(handoffUrl);
      if (parsedUrl.protocol !== 'https:' || parsedUrl.origin !== new URL(run.server).origin) {
        throw new InitRunnerError('secure_input_required', 'The credential handoff URL failed its origin check.');
      }
      return { handoffId, handoffUrl: parsedUrl.toString(), remoteVersion: remote.version };
    },
    getCredentialHandoffStatus: async (run, signal) => {
      if (!run.remote?.handoffId) {
        throw new InitRunnerError('secure_input_required', 'The local run has no credential handoff to reconcile.');
      }
      const response = await services.initApiRequest(
        'GET',
        run.server,
        `/api/v1/init/runs/${encodeURIComponent(run.remote.runId)}/credential-handoffs/${encodeURIComponent(run.remote.handoffId)}/status`,
        undefined,
        flags,
        undefined,
        signal,
      );
      const root = asRecord(response);
      const data = asRecord(root?.data) ?? root;
      const handoff = asRecord(data?.handoff);
      const status = stringValue(handoff?.status);
      if (!status || !['pending', 'claimed', 'processing', 'verified', 'failed', 'expired'].includes(status)) {
        throw new InitRunnerError('secure_input_required', 'The server returned an invalid credential handoff status.');
      }
      const remoteVersion = status === 'verified'
        ? parseRemoteInitRun(await services.initApiRequest(
            'GET',
            run.server,
            `/api/v1/init/runs/${encodeURIComponent(run.remote.runId)}`,
            undefined,
            flags,
            undefined,
            signal,
          )).version
        : undefined;
      return {
        status: status as 'pending' | 'claimed' | 'processing' | 'verified' | 'failed' | 'expired',
        errorCode: stringValue(handoff?.errorCode),
        remoteVersion,
      };
    },
    createTestDraft: async (run, signal) => {
      if (!run.remote || run.nextAction?.kind !== 'wait' || run.nextAction.operation !== 'create_test_draft') {
        throw new InitRunnerError('init_run_conflict', 'The test-draft server action is not ready.');
      }
      const response = await services.initApiRequest(
        'POST',
        run.server,
        `/api/v1/init/runs/${encodeURIComponent(run.remote.runId)}/test-draft`,
        { expectedVersion: run.remote.version },
        flags,
        run.nextAction.idempotencyKey,
        signal,
      );
      const root = asRecord(response);
      const data = asRecord(root?.data) ?? root;
      const draft = asRecord(data?.draft);
      const mediaId = stringValue(draft?.mediaId);
      if (!mediaId || draft?.readBack !== true || draft?.published !== false) {
        throw new InitRunnerError('target_tool_verification_failed', 'The server did not prove an unpublished test-draft read-back.');
      }
      return { mediaId, remoteVersion: parseRemoteInitRun(response).version };
    },
    openUrl: async url => {
      if (initHeadless || flagEnabled(flags, 'no-open')) {
        process.stderr.write(`请在用户浏览器打开此一次性地址：\n${url}\n`);
      } else {
        services.openBrowser(url);
      }
    },
  };
}

async function createRenderer(input: {
  mode: RunInitOptions['mode'];
  format?: string;
  capabilities: ReturnType<typeof detectTerminalCapabilities>;
  headless: boolean;
}): Promise<InitRenderer> {
  if (input.mode === 'status' && input.format === 'json') return new JsonInitRenderer();
  if (input.capabilities.mode === 'jsonl') return new JsonlInitRenderer();
  if (input.capabilities.mode === 'plain') {
    return new PlainInitRenderer({ width: input.capabilities.width, headless: input.headless });
  }
  normalizeInkCiEnvironment();
  const { InkInitRenderer } = await import('./init-ink.js');
  return new InkInitRenderer({ headless: input.headless, color: input.capabilities.color });
}

function parseInitResumeEvent(
  flags: CliFlags,
  directHuman: boolean,
): NonNullable<RunInitOptions['resumeEvent']> | undefined {
  const event = stringFlag(flags, 'event');
  if (!event) return undefined;
  if (event === 'allowlist_saved' || event === 'test_draft_confirmed' || event === 'test_draft_declined') {
    if (!directHuman) {
      throw new CliUsageError(`${event} is human-only and requires a directly operated TTY; Agent, pipe, and CI modes cannot submit it.`);
    }
    return { kind: event } as NonNullable<RunInitOptions['resumeEvent']>;
  }
  if (event === 'remote_mcp_added' || event === 'host_oauth_completed') return { kind: event };
  if (event === 'host_tool_verified') {
    const tool = stringFlag(flags, 'tool');
    if (tool !== 'woa_context' && tool !== 'wechat_draft_count') {
      throw new CliUsageError('host_tool_verified requires --tool woa_context|wechat_draft_count.');
    }
    return { kind: 'host_tool_verified', tool };
  }
  throw new CliUsageError('Unknown init resume event.');
}

function parseRemoteInitRun(response: unknown): RemoteInitRunReference {
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  const run = asRecord(data?.run);
  const runId = stringValue(run?.runId);
  const tenantId = stringValue(run?.tenantId);
  const accountId = stringValue(run?.accountId);
  const status = stringValue(run?.status);
  const phase = stringValue(run?.phase);
  const version = run?.version;
  if (!runId || !tenantId || !accountId || !status || !phase || typeof version !== 'number' || !Number.isSafeInteger(version)) {
    throw new InitRunnerError('init_run_conflict', 'The server returned an invalid init run envelope.');
  }
  return { runId, tenantId, accountId, status, phase, version };
}

function flagEnabled(flags: CliFlags, name: string): boolean {
  const value = flags[name];
  return value === true || value === 'true' || value === '1';
}

function stringFlag(flags: CliFlags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeServer(server: string): string {
  return server ? server.replace(/\/+$/, '/') : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
