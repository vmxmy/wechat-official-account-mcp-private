import type { Writable } from 'node:stream';
import {
  INIT_PHASES,
  InitStateError,
  validateInitNextAction,
  validateInitRunError,
  validateInitStateProjection,
  type InitPhase,
  type InitProtocolEvent,
  type InitRunStatus,
} from './init.js';
import type { InitRenderer, InitRendererAction } from './init-runner.js';

const SECRET_FIELD = /^(?:access_?token|refresh_?token|authorization_?code|code_verifier|pkce_verifier|app_?secret|client_?secret|callback_?url)$/i;
const EVENT_TYPES = new Set(['state', 'action_required', 'paused', 'error', 'done', 'unsupported']);

export class InitJsonlValidationError extends Error {}

export function serializeInitEvent(event: InitProtocolEvent): string {
  validateProtocolEvent(event);
  const line = JSON.stringify(event);
  return `${line}\n`;
}

export function validateProtocolEvent(event: InitProtocolEvent): void {
  if (!isRecord(event)) throw new InitJsonlValidationError('Invalid init event object.');
  assertExactKeys(event, [
    'schemaVersion', 'type', 'sequence', 'cliVersion', 'packageVersion', 'runId', 'runVersion',
    'phase', 'status', 'completedPhases', 'server', 'nextAction', 'error', 'resume',
  ], 'init event');
  if (event.schemaVersion !== 1 || !EVENT_TYPES.has(event.type)) {
    throw new InitJsonlValidationError('Invalid init event discriminant.');
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || !Number.isSafeInteger(event.runVersion) || event.runVersion < 1) {
    throw new InitJsonlValidationError('Invalid init event sequence/runVersion.');
  }
  if (!/^run_[a-f0-9]{32}$/.test(event.runId)) throw new InitJsonlValidationError('Invalid init event runId.');
  if (
    typeof event.cliVersion !== 'string' || !event.cliVersion.trim() ||
    typeof event.packageVersion !== 'string' || !event.packageVersion.trim() ||
    typeof event.server !== 'string' || !event.server.trim() ||
    !INIT_PHASES.includes(event.phase as InitPhase) ||
    !['running', 'action_required', 'paused', 'error', 'done', 'unsupported'].includes(event.status)
  ) {
    throw new InitJsonlValidationError('Invalid init event identity/state.');
  }
  if (
    !Array.isArray(event.completedPhases) ||
    event.completedPhases.some(phase => !INIT_PHASES.includes(phase)) ||
    new Set(event.completedPhases).size !== event.completedPhases.length
  ) {
    throw new InitJsonlValidationError('Invalid init event completed phases.');
  }
  const expectedType = event.status === 'running' ? 'state' : event.status;
  if (event.type !== expectedType) throw new InitJsonlValidationError('Init event type/status mismatch.');
  try {
    if (event.nextAction !== undefined) validateInitNextAction(event.nextAction);
    if (event.error !== undefined) validateInitRunError(event.error);
    validateInitStateProjection(
      event.phase as InitPhase,
      event.status as InitRunStatus,
      event.nextAction,
      event.error,
    );
  } catch (error) {
    if (error instanceof InitStateError) throw new InitJsonlValidationError(error.message);
    throw error;
  }
  assertSecretFree(event);
  if (event.resume) {
    if (!isRecord(event.resume)) throw new InitJsonlValidationError('Invalid resume instruction.');
    assertExactKeys(event.resume, ['command', 'args', 'packageVersion'], 'resume instruction');
    if (
      event.resume.command !== 'woa' ||
      event.resume.packageVersion !== event.packageVersion ||
      !Array.isArray(event.resume.args) ||
      event.resume.args.join('\u0000') !== ['init', 'resume', event.runId, '--agent', '--format', 'jsonl'].join('\u0000')
    ) {
      throw new InitJsonlValidationError('Invalid locally constructed resume instruction.');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const allowlist = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allowlist.has(key));
  if (unknown.length > 0) throw new InitJsonlValidationError(`${label} contains unknown field: ${unknown[0]}.`);
}

export class JsonlInitRenderer implements InitRenderer {
  constructor(private readonly output: Writable = process.stdout) {}

  async render(event: InitProtocolEvent): Promise<InitRendererAction | void> {
    const line = serializeInitEvent(event);
    const written = await writeLine(this.output, line);
    return written ? undefined : { kind: 'epipe' };
  }
}

export class JsonInitRenderer implements InitRenderer {
  constructor(private readonly output: Writable = process.stdout) {}

  async render(event: InitProtocolEvent): Promise<InitRendererAction | void> {
    validateProtocolEvent(event);
    const written = await writeLine(this.output, `${JSON.stringify(event, null, 2)}\n`);
    return written ? undefined : { kind: 'epipe' };
  }
}

async function writeLine(output: Writable, line: string): Promise<boolean> {
  if (output.destroyed) return false;
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const finish = (result: boolean, error?: Error | null) => {
      if (settled) return;
      settled = true;
      output.off('error', onError);
      if (error && (error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error);
      else resolve(result);
    };
    const onError = (error: Error) => finish(false, error);
    output.once('error', onError);
    output.write(line, error => {
      // Writable streams emit `error` after invoking the write callback. Keep
      // the listener installed for that event so EPIPE cannot become unhandled.
      if (!error) finish(true);
    });
  });
}

function assertSecretFree(value: unknown, path: string[] = []): void {
  if (typeof value === 'string') {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code === 27 || code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        throw new InitJsonlValidationError(`Init event contains a terminal control character at ${path.join('.')}.`);
      }
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, [...path, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) {
      throw new InitJsonlValidationError(`Init event contains forbidden field: ${[...path, key].join('.')}`);
    }
    assertSecretFree(child, [...path, key]);
  }
}
