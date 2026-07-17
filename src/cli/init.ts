import { randomBytes } from 'node:crypto';
import { CLI_VERSION } from './version.js';

export const INIT_SCHEMA_VERSION = 1 as const;

export const INIT_PHASES = [
  'environment_check',
  'woa_login_required',
  'wechat_ip_allowlist_required',
  'wechat_credentials_required',
  'remote_mcp_required',
  'host_oauth_required',
  'tool_verification_required',
  'test_draft_required',
  'completed',
] as const;

export type InitPhase = typeof INIT_PHASES[number];
export type InitRunStatus = 'running' | 'action_required' | 'paused' | 'error' | 'done' | 'unsupported';
export type InitEventType = 'state' | 'action_required' | 'paused' | 'error' | 'done' | 'unsupported';

export type InitErrorCode =
  | 'node_runtime_missing'
  | 'official_registry_required'
  | 'cli_upgrade_required'
  | 'browser_action_required'
  | 'secure_input_required'
  | 'oauth_pending'
  | 'oauth_revoked'
  | 'target_selection_required'
  | 'wechat_invalid_credentials'
  | 'wechat_egress_ip_unavailable'
  | 'wechat_ip_not_allowlisted'
  | 'wechat_relay_unavailable'
  | 'host_mcp_capability_missing'
  | 'host_oauth_capability_missing'
  | 'host_reload_required'
  | 'target_tool_verification_failed'
  | 'draft_asset_required'
  | 'test_draft_confirmation_required'
  | 'test_draft_declined'
  | 'init_run_expired'
  | 'init_run_conflict'
  | 'checkpoint_save_failed'
  | 'timeout';

interface ReasonedAction {
  reason: string;
}

export type InitNextAction =
  | ({ kind: 'confirm_install' } & ReasonedAction)
  | ({ kind: 'open_url'; url: string; userOnly: true } & ReasonedAction)
  | ({
      kind: 'wait';
      retryAfterSeconds?: number;
      operation?: 'prepare_cli_oauth' | 'load_server_context' | 'poll_credential_handoff' | 'create_test_draft';
      idempotencyKey?: string;
    } & ReasonedAction)
  | ({ kind: 'choose_target'; targets: Array<{ tenantId: string; accountId: string; name?: string }> } & ReasonedAction)
  | ({ kind: 'secure_user_input'; method: 'https_handoff' | 'trusted_terminal' } & ReasonedAction)
  | ({ kind: 'update_wechat_ip_allowlist'; ips: string[]; source: 'server'; configVersion: string } & ReasonedAction)
  | ({ kind: 'add_remote_mcp'; descriptor: { name: string; transport: 'streamable-http'; url: string } } & ReasonedAction)
  | ({ kind: 'start_native_oauth' } & ReasonedAction)
  | ({ kind: 'reload_host' } & ReasonedAction)
  | ({ kind: 'call_mcp_tool'; tool: string; arguments: Record<string, string | number | boolean | null> } & ReasonedAction)
  | ({ kind: 'confirm_test_draft'; title: string; publish: false } & ReasonedAction)
  | ({ kind: 'done'; evidence: string[] } & ReasonedAction)
  | ({ kind: 'unsupported'; code: InitErrorCode } & ReasonedAction);

export interface InitRunError {
  code: InitErrorCode;
  message: string;
  recoverable: boolean;
}

export interface RemoteInitRunReference {
  runId: string;
  version: number;
  status: string;
  phase: string;
  tenantId: string;
  accountId: string;
  handoffId?: string;
}

export interface InitRun {
  schemaVersion: 1;
  runId: string;
  runVersion: number;
  sequence: number;
  cliVersion: string;
  packageVersion: string;
  server: string;
  phase: InitPhase;
  status: InitRunStatus;
  completedPhases: InitPhase[];
  remote?: RemoteInitRunReference;
  hostEvidence?: {
    contextToolVerified: boolean;
    draftCountVerified: boolean;
  };
  nextAction?: InitNextAction;
  error?: InitRunError;
  createdAt: string;
  updatedAt: string;
}

export interface InitResumeInstruction {
  command: 'woa';
  args: ['init', 'resume', string, '--agent', '--format', 'jsonl'];
  packageVersion: string;
}

export interface InitProtocolEvent {
  schemaVersion: 1;
  type: InitEventType;
  sequence: number;
  cliVersion: string;
  packageVersion: string;
  runId: string;
  runVersion: number;
  phase: InitPhase;
  status: InitRunStatus;
  completedPhases: InitPhase[];
  server: string;
  nextAction?: InitNextAction;
  error?: InitRunError;
  resume?: InitResumeInstruction;
}

export type InitTransition =
  | { kind: 'environment_supported' }
  | { kind: 'cli_oauth_prepared'; authorizationUrl: string }
  | { kind: 'cli_authenticated' }
  | {
      kind: 'egress_ips_loaded';
      ips: string[];
      configVersion: string;
      remote?: RemoteInitRunReference;
    }
  | { kind: 'wechat_allowlist_acknowledged'; remoteVersion?: number }
  | { kind: 'credential_handoff_created'; handoffId: string; remoteVersion: number }
  | { kind: 'wechat_credentials_verified'; remoteVersion?: number }
  | { kind: 'remote_mcp_added' }
  | { kind: 'host_oauth_completed' }
  | { kind: 'host_tool_verified'; tool: 'woa_context' | 'wechat_draft_count' }
  | { kind: 'test_draft_confirmed' }
  | { kind: 'test_draft_created'; mediaId: string; remoteVersion?: number }
  | { kind: 'test_draft_declined' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'fail'; error: InitRunError }
  | { kind: 'unsupported'; error: InitRunError };

export interface CreateInitRunOptions {
  server: string;
  now?: Date;
  runId?: string;
  cliVersion?: string;
  packageVersion?: string;
}

export class InitStateError extends Error {
  readonly code: InitErrorCode;

  constructor(message: string, code: InitErrorCode = 'init_run_conflict') {
    super(message);
    this.code = code;
  }
}

export function createInitRun(options: CreateInitRunOptions): InitRun {
  const now = (options.now ?? new Date()).toISOString();
  const version = options.cliVersion ?? CLI_VERSION;
  return {
    schemaVersion: INIT_SCHEMA_VERSION,
    runId: options.runId ?? `run_${randomBytes(16).toString('hex')}`,
    runVersion: 1,
    sequence: 1,
    cliVersion: version,
    packageVersion: options.packageVersion ?? version,
    server: normalizeServer(options.server),
    phase: 'environment_check',
    status: 'running',
    completedPhases: [],
    nextAction: {
      kind: 'wait',
      reason: 'Checking the local runtime and package contract.',
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** 纯状态转移：不访问终端、网络或文件系统。 */
export function transitionInitRun(run: InitRun, transition: InitTransition, now = new Date()): InitRun {
  validateInitRun(run);
  const update = (patch: Partial<InitRun>): InitRun => ({
    ...run,
    ...patch,
    runVersion: run.runVersion + 1,
    sequence: run.sequence + 1,
    updatedAt: now.toISOString(),
  });
  const completed = (phase: InitPhase) => uniquePhases([...run.completedPhases, phase]);

  if (transition.kind === 'pause') {
    if (run.status === 'done') throw new InitStateError('A completed init run cannot be paused.');
    return update({ status: 'paused' });
  }
  if (transition.kind === 'resume') {
    if (run.status !== 'paused' && run.status !== 'error' && run.status !== 'unsupported') {
      throw new InitStateError(`Init run ${run.runId} is not paused or recoverable.`);
    }
    if ((run.status === 'error' || run.status === 'unsupported') && run.error?.recoverable !== true) {
      throw new InitStateError(`Init run ${run.runId} has a non-recoverable error.`, run.error?.code);
    }
    return update({
      status: !run.nextAction || run.nextAction.kind === 'wait' ? 'running' : 'action_required',
      error: undefined,
    });
  }
  if (transition.kind === 'fail') {
    return update({ status: 'error', error: transition.error });
  }
  if (transition.kind === 'unsupported') {
    return update({
      status: 'unsupported',
      error: transition.error,
      nextAction: { kind: 'unsupported', code: transition.error.code, reason: transition.error.message },
    });
  }

  switch (transition.kind) {
    case 'environment_supported':
      requirePhase(run, 'environment_check');
      return update({
        phase: 'woa_login_required',
        status: 'running',
        completedPhases: completed('environment_check'),
        nextAction: {
          kind: 'wait',
          operation: 'prepare_cli_oauth',
          reason: 'Preparing a PKCE authorization request for the separate CLI grant.',
        },
        error: undefined,
      });
    case 'cli_oauth_prepared': {
      requirePhase(run, 'woa_login_required');
      const authorizationUrl = new URL(transition.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' && !isLoopback(authorizationUrl.hostname)) {
        throw new InitStateError('The OAuth authorization endpoint must use HTTPS.');
      }
      return update({
        status: 'action_required',
        nextAction: {
          kind: 'open_url',
          url: authorizationUrl.toString(),
          userOnly: true,
          reason: 'A user must authorize the separate CLI grant. In headless use, finish through direct trusted-terminal secure input, then resume this run.',
        },
        error: undefined,
      });
    }
    case 'cli_authenticated':
      requirePhase(run, 'woa_login_required');
      return update({
        phase: 'wechat_ip_allowlist_required',
        status: 'running',
        completedPhases: completed('woa_login_required'),
        nextAction: {
          kind: 'wait',
          operation: 'load_server_context',
          reason: 'Loading the current relay egress IPs and idempotent server init run.',
        },
        error: undefined,
      });
    case 'egress_ips_loaded':
      requirePhase(run, 'wechat_ip_allowlist_required');
      if (transition.ips.length === 0 || transition.ips.some(ip => !isIpAddress(ip))) {
        throw new InitStateError('The server egress IP payload is empty or invalid.', 'wechat_egress_ip_unavailable');
      }
      return update({
        status: 'action_required',
        ...(transition.remote ? { remote: transition.remote } : {}),
        nextAction: {
          kind: 'update_wechat_ip_allowlist',
          ips: [...new Set(transition.ips)],
          source: 'server',
          configVersion: transition.configVersion,
          reason: 'A user must add every current egress IP to the target WeChat account allowlist.',
        },
        error: undefined,
      });
    case 'wechat_allowlist_acknowledged':
      requirePhase(run, 'wechat_ip_allowlist_required');
      if (run.nextAction?.kind !== 'update_wechat_ip_allowlist') {
        throw new InitStateError('The current run has no server-sourced allowlist action to acknowledge.');
      }
      return update({
        phase: 'wechat_credentials_required',
        status: 'action_required',
        ...(run.remote && transition.remoteVersion ? {
          remote: { ...run.remote, version: transition.remoteVersion, phase: 'egress_confirmed' },
        } : {}),
        nextAction: {
          kind: 'secure_user_input',
          method: 'https_handoff',
          reason: 'A user must open the trusted one-time HTTPS handoff from a directly operated terminal. Agent, pipe, and CI modes cannot receive the URL or secret.',
        },
        error: undefined,
      });
    case 'credential_handoff_created':
      requirePhase(run, 'wechat_credentials_required');
      if (!run.remote) throw new InitStateError('Credential handoff requires a server init run.');
      return update({
        remote: {
          ...run.remote,
          version: transition.remoteVersion,
          phase: 'credential_handoff_pending',
          handoffId: transition.handoffId,
        },
        status: 'action_required',
        nextAction: {
          kind: 'secure_user_input',
          method: 'https_handoff',
          reason: 'The one-time HTTPS handoff was opened locally. Complete it as the same Operator, then resume; no secret is read by this renderer.',
        },
        error: undefined,
      });
    case 'wechat_credentials_verified':
      requirePhase(run, 'wechat_credentials_required');
      return update({
        phase: 'remote_mcp_required',
        status: 'action_required',
        completedPhases: uniquePhases([...completed('wechat_ip_allowlist_required'), 'wechat_credentials_required']),
        ...(run.remote ? {
          remote: {
            ...run.remote,
            ...(transition.remoteVersion ? { version: transition.remoteVersion } : {}),
            phase: 'credentials_verified',
          },
        } : {}),
        nextAction: {
          kind: 'add_remote_mcp',
          descriptor: {
            name: 'wechat-woa',
            transport: 'streamable-http',
            url: new URL('/mcp', run.server).toString(),
          },
          reason: 'The host must add this standard remote MCP endpoint using its native capability.',
        },
        error: undefined,
      });
    case 'remote_mcp_added':
      requirePhase(run, 'remote_mcp_required');
      return update({
        phase: 'host_oauth_required',
        status: 'action_required',
        completedPhases: completed('remote_mcp_required'),
        nextAction: {
          kind: 'start_native_oauth',
          reason: 'The host must complete its own OAuth grant; the CLI grant cannot substitute for it.',
        },
        error: undefined,
      });
    case 'host_oauth_completed':
      requirePhase(run, 'host_oauth_required');
      return update({
        phase: 'tool_verification_required',
        status: 'action_required',
        completedPhases: completed('host_oauth_required'),
        hostEvidence: { contextToolVerified: false, draftCountVerified: false },
        nextAction: {
          kind: 'call_mcp_tool',
          tool: 'woa_context',
          arguments: {},
          reason: 'The host must prove its own authenticated MCP tool path with a read-only call.',
        },
        error: undefined,
      });
    case 'host_tool_verified':
      requirePhase(run, 'tool_verification_required');
      if (transition.tool === 'woa_context') {
        return update({
          status: 'action_required',
          hostEvidence: {
            contextToolVerified: true,
            draftCountVerified: run.hostEvidence?.draftCountVerified === true,
          },
          nextAction: {
            kind: 'call_mcp_tool',
            tool: 'wechat_draft',
            arguments: { action: 'count' },
            reason: 'The host must independently verify target-account draft access; CLI REST or MCP probes cannot substitute.',
          },
          error: undefined,
        });
      }
      if (run.hostEvidence?.contextToolVerified !== true) {
        throw new InitStateError('wechat_draft count cannot complete host verification before woa_context evidence.');
      }
      return update({
        phase: 'test_draft_required',
        status: 'action_required',
        completedPhases: completed('tool_verification_required'),
        hostEvidence: { contextToolVerified: true, draftCountVerified: true },
        nextAction: {
          kind: 'confirm_test_draft',
          title: 'WOA MCP 连接测试',
          publish: false,
          reason: 'A user must explicitly approve creating one unpublished, idempotent connection-test draft.',
        },
        error: undefined,
      });
    case 'test_draft_confirmed':
      requirePhase(run, 'test_draft_required');
      return update({
        status: 'running',
        nextAction: {
          kind: 'wait',
          operation: 'create_test_draft',
          idempotencyKey: `woa-init:${run.runId}`,
          reason: 'The CLI will invoke the authenticated, idempotent init action that prepares a cover, creates one unpublished draft, and reads it back. It never calls publish.',
        },
        error: undefined,
      });
    case 'test_draft_created':
      requirePhase(run, 'test_draft_required');
      if (!transition.mediaId.trim()) throw new InitStateError('Test draft evidence requires a mediaId.');
      return update({
        phase: 'completed',
        status: 'done',
        completedPhases: uniquePhases([...completed('test_draft_required'), 'completed']),
        ...(run.remote && transition.remoteVersion ? {
          remote: { ...run.remote, version: transition.remoteVersion, phase: 'test_draft_verified' },
        } : {}),
        nextAction: {
          kind: 'done',
          evidence: [`testDraftMediaId:${transition.mediaId}`],
          reason: 'The host created and verified one unpublished test draft.',
        },
        error: undefined,
      });
    case 'test_draft_declined':
      requirePhase(run, 'test_draft_required');
      return update({
        phase: 'completed',
        status: 'done',
        completedPhases: uniquePhases([...completed('test_draft_required'), 'completed']),
        nextAction: {
          kind: 'done',
          evidence: ['basicConnectionVerified', 'testDraftDeclined'],
          reason: 'Basic connection completed; the user declined the optional test draft.',
        },
        error: undefined,
      });
  }
}

export function toInitProtocolEvent(run: InitRun): InitProtocolEvent {
  validateInitRun(run);
  return {
    schemaVersion: INIT_SCHEMA_VERSION,
    type: eventTypeForStatus(run.status),
    sequence: run.sequence,
    cliVersion: run.cliVersion,
    packageVersion: run.packageVersion,
    runId: run.runId,
    runVersion: run.runVersion,
    phase: run.phase,
    status: run.status,
    completedPhases: [...run.completedPhases],
    server: run.server,
    ...(run.nextAction ? { nextAction: run.nextAction } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.status !== 'done' ? {
      resume: {
        command: 'woa',
        args: ['init', 'resume', run.runId, '--agent', '--format', 'jsonl'],
        packageVersion: run.packageVersion,
      } satisfies InitResumeInstruction,
    } : {}),
  };
}

export function validateInitRun(value: unknown): asserts value is InitRun {
  const run = value as Partial<InitRun> | null;
  if (!isRecord(run)) throw new InitStateError('Invalid init run schema.');
  assertExactKeys(run, [
    'schemaVersion', 'runId', 'runVersion', 'sequence', 'cliVersion', 'packageVersion', 'server',
    'phase', 'status', 'completedPhases', 'remote', 'hostEvidence', 'nextAction', 'error',
    'createdAt', 'updatedAt',
  ], 'init run');
  if (run.schemaVersion !== 1 || typeof run.runId !== 'string' || !/^run_[a-f0-9]{32}$/.test(run.runId)) {
    throw new InitStateError('Invalid init run schema.');
  }
  if (!Number.isSafeInteger(run.runVersion) || (run.runVersion ?? 0) < 1 || !Number.isSafeInteger(run.sequence) || (run.sequence ?? 0) < 1) {
    throw new InitStateError('Invalid init run sequence/version.');
  }
  if (!INIT_PHASES.includes(run.phase as InitPhase)) throw new InitStateError('Invalid init run phase.');
  if (!['running', 'action_required', 'paused', 'error', 'done', 'unsupported'].includes(run.status ?? '')) {
    throw new InitStateError('Invalid init run status.');
  }
  if (!isNonEmptyString(run.cliVersion) || !isNonEmptyString(run.packageVersion) || !isNonEmptyString(run.server)) {
    throw new InitStateError('Invalid init run identity.');
  }
  try {
    const server = new URL(run.server);
    if (server.protocol !== 'https:' && !isLoopback(server.hostname)) throw new Error('insecure');
  } catch {
    throw new InitStateError('Invalid init run server URL.');
  }
  if (!Array.isArray(run.completedPhases) || run.completedPhases.some(phase => !INIT_PHASES.includes(phase))) {
    throw new InitStateError('Invalid completed init phases.');
  }
  if (new Set(run.completedPhases).size !== run.completedPhases.length) {
    throw new InitStateError('Completed init phases must be unique.');
  }
  if (!isIsoDate(run.createdAt) || !isIsoDate(run.updatedAt)) throw new InitStateError('Invalid init run timestamps.');
  if (run.remote !== undefined) validateRemoteRunReference(run.remote);
  if (run.hostEvidence !== undefined) {
    if (!isRecord(run.hostEvidence)) throw new InitStateError('Invalid host evidence.');
    assertExactKeys(run.hostEvidence, ['contextToolVerified', 'draftCountVerified'], 'host evidence');
    if (typeof run.hostEvidence.contextToolVerified !== 'boolean' || typeof run.hostEvidence.draftCountVerified !== 'boolean') {
      throw new InitStateError('Invalid host evidence.');
    }
  }
  if (run.nextAction !== undefined) validateInitNextAction(run.nextAction);
  if (run.error !== undefined) validateInitRunError(run.error);
  validateInitStateProjection(run.phase as InitPhase, run.status as InitRunStatus, run.nextAction, run.error);
}

export function validateInitNextAction(value: unknown): asserts value is InitNextAction {
  if (!isRecord(value) || !isNonEmptyString(value.kind) || !isNonEmptyString(value.reason)) {
    throw new InitStateError('Invalid init nextAction.');
  }
  const base = ['kind', 'reason'];
  switch (value.kind) {
    case 'confirm_install':
      assertExactKeys(value, base, 'confirm_install action');
      return;
    case 'open_url': {
      assertExactKeys(value, [...base, 'url', 'userOnly'], 'open_url action');
      if (value.userOnly !== true || !isNonEmptyString(value.url)) throw new InitStateError('Invalid open_url action.');
      let url: URL;
      try { url = new URL(value.url); } catch { throw new InitStateError('Invalid open_url action URL.'); }
      if (url.protocol !== 'https:' && !isLoopback(url.hostname)) throw new InitStateError('Invalid open_url action URL.');
      return;
    }
    case 'wait':
      assertExactKeys(value, [...base, 'retryAfterSeconds', 'operation', 'idempotencyKey'], 'wait action');
      if (
        value.retryAfterSeconds !== undefined &&
        (typeof value.retryAfterSeconds !== 'number' || !Number.isSafeInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 0)
      ) {
        throw new InitStateError('Invalid wait retry interval.');
      }
      if (value.operation !== undefined && !['prepare_cli_oauth', 'load_server_context', 'poll_credential_handoff', 'create_test_draft'].includes(String(value.operation))) {
        throw new InitStateError('Invalid wait operation.');
      }
      if (value.idempotencyKey !== undefined && !isNonEmptyString(value.idempotencyKey)) throw new InitStateError('Invalid wait idempotency key.');
      return;
    case 'choose_target':
      assertExactKeys(value, [...base, 'targets'], 'choose_target action');
      if (!Array.isArray(value.targets) || value.targets.length === 0) throw new InitStateError('Invalid choose_target action.');
      for (const target of value.targets) {
        if (!isRecord(target)) throw new InitStateError('Invalid choose_target target.');
        assertExactKeys(target, ['tenantId', 'accountId', 'name'], 'choose_target target');
        if (!isNonEmptyString(target.tenantId) || !isNonEmptyString(target.accountId) || (target.name !== undefined && !isNonEmptyString(target.name))) {
          throw new InitStateError('Invalid choose_target target.');
        }
      }
      return;
    case 'secure_user_input':
      assertExactKeys(value, [...base, 'method'], 'secure_user_input action');
      if (value.method !== 'https_handoff' && value.method !== 'trusted_terminal') throw new InitStateError('Invalid secure input method.');
      return;
    case 'update_wechat_ip_allowlist':
      assertExactKeys(value, [...base, 'ips', 'source', 'configVersion'], 'allowlist action');
      if (!Array.isArray(value.ips) || value.ips.length === 0 || value.ips.some(ip => typeof ip !== 'string' || !isIpAddress(ip))) {
        throw new InitStateError('Invalid allowlist IPs.');
      }
      if (value.source !== 'server' || !isNonEmptyString(value.configVersion)) throw new InitStateError('Invalid allowlist source.');
      return;
    case 'add_remote_mcp':
      assertExactKeys(value, [...base, 'descriptor'], 'add_remote_mcp action');
      if (!isRecord(value.descriptor)) throw new InitStateError('Invalid remote MCP descriptor.');
      assertExactKeys(value.descriptor, ['name', 'transport', 'url'], 'remote MCP descriptor');
      if (!isNonEmptyString(value.descriptor.name) || value.descriptor.transport !== 'streamable-http' || !isNonEmptyString(value.descriptor.url)) {
        throw new InitStateError('Invalid remote MCP descriptor.');
      }
      try {
        const url = new URL(value.descriptor.url);
        if (url.protocol !== 'https:' && !isLoopback(url.hostname)) throw new Error('insecure');
      } catch {
        throw new InitStateError('Invalid remote MCP descriptor URL.');
      }
      return;
    case 'start_native_oauth':
    case 'reload_host':
      assertExactKeys(value, base, `${value.kind} action`);
      return;
    case 'call_mcp_tool':
      assertExactKeys(value, [...base, 'tool', 'arguments'], 'call_mcp_tool action');
      if (!['woa_context', 'wechat_draft'].includes(String(value.tool)) || !isRecord(value.arguments)) {
        throw new InitStateError('Invalid MCP tool action.');
      }
      if (value.tool === 'woa_context') {
        assertExactKeys(value.arguments, [], 'woa_context arguments');
      } else {
        assertExactKeys(value.arguments, ['action'], 'wechat_draft arguments');
        if (value.arguments.action !== 'count') throw new InitStateError('Invalid wechat_draft verification action.');
      }
      return;
    case 'confirm_test_draft':
      assertExactKeys(value, [...base, 'title', 'publish'], 'confirm_test_draft action');
      if (!isNonEmptyString(value.title) || value.publish !== false) throw new InitStateError('Invalid test draft confirmation.');
      return;
    case 'done':
      assertExactKeys(value, [...base, 'evidence'], 'done action');
      if (!Array.isArray(value.evidence) || value.evidence.some(item => !isNonEmptyString(item))) throw new InitStateError('Invalid completion evidence.');
      return;
    case 'unsupported':
      assertExactKeys(value, [...base, 'code'], 'unsupported action');
      if (!isInitErrorCode(value.code)) throw new InitStateError('Invalid unsupported error code.');
      return;
    default:
      throw new InitStateError(`Unknown init nextAction kind: ${String(value.kind)}.`);
  }
}

export function validateInitRunError(value: unknown): asserts value is InitRunError {
  if (!isRecord(value)) throw new InitStateError('Invalid init error.');
  assertExactKeys(value, ['code', 'message', 'recoverable'], 'init error');
  if (!isInitErrorCode(value.code) || !isNonEmptyString(value.message) || typeof value.recoverable !== 'boolean') {
    throw new InitStateError('Invalid init error.');
  }
}

export function validateInitStateProjection(
  phase: InitPhase,
  status: InitRunStatus,
  nextAction?: InitNextAction,
  error?: InitRunError,
): void {
  if ((phase === 'completed') !== (status === 'done')) throw new InitStateError('Init phase/status are inconsistent.');
  if (status === 'done' && nextAction?.kind !== 'done') throw new InitStateError('Completed init run requires done evidence.');
  if (status === 'running' && nextAction && nextAction.kind !== 'wait') throw new InitStateError('Running init run may only wait for an automatic effect.');
  if (status === 'action_required' && (!nextAction || ['wait', 'done', 'unsupported'].includes(nextAction.kind))) {
    throw new InitStateError('Action-required init run has no valid user/host action.');
  }
  if (status === 'error' && !error) throw new InitStateError('Error init run requires a structured error.');
  if (status === 'unsupported' && (!error || nextAction?.kind !== 'unsupported')) {
    throw new InitStateError('Unsupported init run requires matching error/action data.');
  }
  if (!['error', 'unsupported'].includes(status) && error) throw new InitStateError('Non-error init run cannot retain an error.');
  if (nextAction && nextAction.kind !== 'unsupported') {
    const allowedByPhase: Record<InitPhase, InitNextAction['kind'][]> = {
      environment_check: ['wait'],
      woa_login_required: ['wait', 'open_url'],
      wechat_ip_allowlist_required: ['wait', 'update_wechat_ip_allowlist'],
      wechat_credentials_required: ['secure_user_input'],
      remote_mcp_required: ['add_remote_mcp'],
      host_oauth_required: ['start_native_oauth', 'reload_host'],
      tool_verification_required: ['call_mcp_tool'],
      test_draft_required: ['confirm_test_draft', 'wait'],
      completed: ['done'],
    };
    if (!allowedByPhase[phase].includes(nextAction.kind)) throw new InitStateError('Init phase/nextAction are inconsistent.');
  }
}

function requirePhase(run: InitRun, phase: InitPhase): void {
  if (run.phase !== phase) {
    throw new InitStateError(`Transition requires phase ${phase}; current phase is ${run.phase}.`);
  }
}

function eventTypeForStatus(status: InitRunStatus): InitEventType {
  return status === 'running' ? 'state' : status;
}

function uniquePhases(phases: InitPhase[]): InitPhase[] {
  return [...new Set(phases)];
}

function normalizeServer(server: string): string {
  const url = new URL(server || 'https://woa.ziikoo.app');
  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
    throw new InitStateError('woa init requires an HTTPS server URL.', 'official_registry_required');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isIpAddress(value: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
}

const INIT_ERROR_CODES = new Set<InitErrorCode>([
  'node_runtime_missing',
  'official_registry_required',
  'cli_upgrade_required',
  'browser_action_required',
  'secure_input_required',
  'oauth_pending',
  'oauth_revoked',
  'target_selection_required',
  'wechat_invalid_credentials',
  'wechat_egress_ip_unavailable',
  'wechat_ip_not_allowlisted',
  'wechat_relay_unavailable',
  'host_mcp_capability_missing',
  'host_oauth_capability_missing',
  'host_reload_required',
  'target_tool_verification_failed',
  'draft_asset_required',
  'test_draft_confirmation_required',
  'test_draft_declined',
  'init_run_expired',
  'init_run_conflict',
  'checkpoint_save_failed',
  'timeout',
]);

function isInitErrorCode(value: unknown): value is InitErrorCode {
  return typeof value === 'string' && INIT_ERROR_CODES.has(value as InitErrorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const allowlist = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowlist.has(key));
  if (unknown.length > 0) throw new InitStateError(`${label} contains unknown field: ${unknown[0]}.`);
}

function validateRemoteRunReference(value: unknown): asserts value is RemoteInitRunReference {
  if (!isRecord(value)) throw new InitStateError('Invalid remote init run reference.');
  assertExactKeys(value, ['runId', 'version', 'status', 'phase', 'tenantId', 'accountId', 'handoffId'], 'remote init run reference');
  if (
    !isNonEmptyString(value.runId) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    !isNonEmptyString(value.status) ||
    !isNonEmptyString(value.phase) ||
    !isNonEmptyString(value.tenantId) ||
    !isNonEmptyString(value.accountId) ||
    (value.handoffId !== undefined && !isNonEmptyString(value.handoffId))
  ) {
    throw new InitStateError('Invalid remote init run reference.');
  }
}
