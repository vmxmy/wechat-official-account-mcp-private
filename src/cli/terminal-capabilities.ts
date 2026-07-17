export type InitOutputMode = 'tui' | 'plain' | 'jsonl';

export interface TerminalCapabilities {
  mode: InitOutputMode;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  interactive: boolean;
  ci: boolean;
  agent: boolean;
  plainRequested: boolean;
  ansi: boolean;
  color: boolean;
  width: number;
  narrow: boolean;
}

export interface TerminalCapabilityOptions {
  agent?: boolean;
  plain?: boolean;
  env?: NodeJS.ProcessEnv;
  stdin?: Pick<NodeJS.ReadStream, 'isTTY'>;
  stdout?: Pick<NodeJS.WriteStream, 'isTTY' | 'columns'>;
  stderr?: Pick<NodeJS.WriteStream, 'isTTY'>;
}

/** 只探测可验证的终端事实；不声称能够自动识别读屏软件。 */
export function detectTerminalCapabilities(options: TerminalCapabilityOptions = {}): TerminalCapabilities {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdinIsTTY = stdin.isTTY === true;
  const stdoutIsTTY = stdout.isTTY === true;
  const stderrIsTTY = stderr.isTTY === true;
  const ci = envFlag(env.CI);
  const agent = options.agent === true;
  const plainRequested = options.plain === true || envFlag(env.WOA_PLAIN) || env.TERM === 'dumb';
  const interactive = stdinIsTTY && stdoutIsTTY && !ci && !agent;
  const width = Number.isFinite(stdout.columns) && (stdout.columns ?? 0) > 0 ? stdout.columns! : 80;
  const mode: InitOutputMode = agent || !interactive
    ? 'jsonl'
    : plainRequested
      ? 'plain'
      : 'tui';
  const ansi = mode === 'tui' && env.TERM !== 'dumb';
  const forceColorDisabled = env.FORCE_COLOR !== undefined && !envFlag(env.FORCE_COLOR);
  const color = ansi && !Object.prototype.hasOwnProperty.call(env, 'NO_COLOR') && !forceColorDisabled;
  return {
    mode,
    stdinIsTTY,
    stdoutIsTTY,
    stderrIsTTY,
    interactive,
    ci,
    agent,
    plainRequested,
    ansi,
    color,
    width,
    narrow: width < 60,
  };
}

function envFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}
