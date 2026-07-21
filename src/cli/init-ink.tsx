/* eslint-disable react-refresh/only-export-components */
import React, { Component, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  Box,
  Text,
  render,
  useFocus,
  useInput,
  useStdout,
  type Instance,
} from 'ink';
import type { InitProtocolEvent } from './init.js';
import type { InitRenderer, InitRendererAction } from './init-runner.js';

const STEP_RAIL = [
  ['environment_check', '环境检查'],
  ['woa_login_required', 'WOA 登录'],
  ['wechat_ip_allowlist_required', '微信 IP 白名单'],
  ['wechat_credentials_required', '公众号凭据'],
  ['remote_mcp_required', '远程 MCP'],
  ['host_oauth_required', '宿主 OAuth'],
  ['tool_verification_required', '工具验证'],
  ['test_draft_required', '测试草稿'],
] as const;

export interface InkInitRendererOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  errorOutput?: NodeJS.WriteStream;
  headless?: boolean;
  color?: boolean;
  alternateScreen?: boolean;
  screenReader?: boolean;
  screen?: ComponentType<InitScreenProps>;
}

export interface InitActionChoice {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  action: InitRendererAction;
}

export interface InitScreenProps {
  event: InitProtocolEvent;
  headless?: boolean;
  color?: boolean;
  width?: number;
  onAction: (action: InitRendererAction) => void;
  onRenderError?: (error: Error) => void;
}

export class InkInitRenderer implements InitRenderer {
  private instance: Instance | null = null;
  private pending: ((action: InitRendererAction) => void) | null = null;
  private lastEvent: InitProtocolEvent | null = null;
  private alternateScreenActive = false;
  private restored = false;
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;
  private readonly errorOutput: NodeJS.WriteStream;
  private readonly handleProcessSignal = () => this.resolveAction({ kind: 'interrupt' });

  constructor(private readonly options: InkInitRendererOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.errorOutput = options.errorOutput ?? process.stderr;
    process.on('SIGINT', this.handleProcessSignal);
    process.on('SIGTERM', this.handleProcessSignal);
  }

  async render(event: InitProtocolEvent): Promise<InitRendererAction | void> {
    this.lastEvent = event;
    this.restored = false;
    if (isTerminalEvent(event)) {
      this.mountOrUpdate(event);
      await nextTurn();
      return;
    }
    return await new Promise<InitRendererAction>(resolve => {
      this.pending = resolve;
      try {
        this.mountOrUpdate(event);
      } catch (error) {
        this.pending = null;
        throw error;
      }
    });
  }

  async suspendForSecureInput<T>(callback: () => Promise<T>): Promise<T> {
    const event = this.lastEvent;
    this.unmount(false);
    try {
      return await callback();
    } finally {
      if (event && !this.restored) this.mountOrUpdate(event);
    }
  }

  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    process.off('SIGINT', this.handleProcessSignal);
    process.off('SIGTERM', this.handleProcessSignal);
    this.unmount(true);
    const summary = this.lastEvent ? renderInitSummary(this.lastEvent) : '';
    if (summary) this.output.write(`${summary}\n`);
  }

  private mountOrUpdate(event: InitProtocolEvent): void {
    const Screen = this.options.screen ?? InitScreen;
    const tree = (
      <InitErrorBoundary onError={error => this.resolveRenderError(error)}>
        <Screen
          event={event}
          headless={this.options.headless}
          color={this.options.color}
          onAction={action => this.resolveAction(action)}
        />
      </InitErrorBoundary>
    );
    if (this.instance) {
      this.instance.rerender(tree);
      return;
    }
    this.enterAlternateScreen();
    this.instance = render(tree, {
      stdin: this.input,
      stdout: this.output,
      stderr: this.errorOutput,
      exitOnCtrlC: false,
      patchConsole: false,
      incrementalRendering: false,
      isScreenReaderEnabled: this.options.screenReader ?? process.env.INK_SCREEN_READER === 'true',
    });
  }

  private resolveAction(action: InitRendererAction): void {
    const resolve = this.pending;
    if (!resolve) return;
    this.pending = null;
    resolve(action);
  }

  private resolveRenderError(error: Error): void {
    this.errorOutput.write(`WOA TUI render error: ${redactTerminalText(error.message)}\n`);
    this.resolveAction({ kind: 'interrupt' });
  }

  private unmount(final: boolean): void {
    if (this.instance) {
      this.instance.unmount();
      this.instance.cleanup();
      this.instance = null;
    }
    this.leaveAlternateScreen();
    if (final) this.pending = null;
  }

  private enterAlternateScreen(): void {
    if (this.options.alternateScreen === false || this.output.isTTY !== true || this.alternateScreenActive) return;
    this.output.write('\u001b[?1049h\u001b[2J\u001b[H');
    this.alternateScreenActive = true;
  }

  private leaveAlternateScreen(): void {
    if (!this.alternateScreenActive) return;
    this.output.write('\u001b[?1049l\u001b[?25h');
    this.alternateScreenActive = false;
  }
}

export function InitScreen(props: InitScreenProps): ReactNode {
  const terminalWidth = useTerminalWidth();
  const width = props.width ?? terminalWidth;
  const compact = width < 60;
  const actions = useMemo(
    () => buildInitActionChoices(props.event, props.headless === true),
    [props.event, props.headless],
  );
  const status = statusLabel(props.event);
  const accent = props.color === false ? undefined : status.color;

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 1}>
      <Box justifyContent="space-between" flexWrap="wrap">
        <Text bold>WOA 微信 MCP 接入</Text>
        <Text color={accent}>[{status.marker}] {status.label}</Text>
      </Box>
      <Text dimColor>Server: {props.event.server}</Text>
      <Box
        flexDirection={compact ? 'column' : 'row'}
        gap={compact ? 0 : 2}
        marginTop={1}
      >
        <Box flexDirection="column" width={compact ? undefined : 28}>
          <Text bold>接入进度</Text>
          <StepRail event={props.event} color={props.color !== false} />
        </Box>
        <Box flexDirection="column" flexGrow={1} marginTop={compact ? 1 : 0}>
          <Text bold>当前操作</Text>
          <CurrentAction event={props.event} color={props.color !== false} />
          {actions.length > 0 ? (
            <ActionMenu
              key={`${props.event.runVersion}:${props.event.sequence}`}
              actions={actions}
              onAction={props.onAction}
            />
          ) : null}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{actions.length > 0 ? '↑↓/jk 选择  Enter 确认  q 暂停  Ctrl+C 中断' : '正在保存最终状态…'}</Text>
      </Box>
    </Box>
  );
}

export function buildInitActionChoices(event: InitProtocolEvent, headless = false): InitActionChoice[] {
  const action = event.nextAction;
  if (!action || isTerminalEvent(event)) return [];
  const pause: InitActionChoice = { id: 'pause', label: '保存并稍后继续', hotkey: 'q', action: { kind: 'pause' } };
  switch (action.kind) {
    case 'open_url':
      return headless
        ? [pause]
        : [
            { id: 'open', label: '打开浏览器', hint: '授权完成后自动继续', hotkey: 'o', action: { kind: 'open_url', url: action.url } },
            pause,
          ];
    case 'update_wechat_ip_allowlist':
      return [
        { id: 'allowlist', label: '我已在微信后台保存全部 IP', hotkey: 'a', action: { kind: 'acknowledge' } },
        pause,
      ];
    case 'confirm_test_draft':
      return [
        { id: 'confirm', label: '创建未发布测试草稿', hotkey: 'y', action: { kind: 'confirm' } },
        { id: 'decline', label: '跳过测试草稿', hotkey: 'd', action: { kind: 'decline' } },
        pause,
      ];
    case 'add_remote_mcp':
      return [
        { id: 'remote-mcp', label: '宿主已添加远程 MCP', hotkey: 'c', action: { kind: 'remote_mcp_added' } },
        pause,
      ];
    case 'start_native_oauth':
      return [
        { id: 'host-oauth', label: '宿主 OAuth 已完成', hotkey: 'c', action: { kind: 'host_oauth_completed' } },
        pause,
      ];
    case 'call_mcp_tool':
      return [
        {
          id: 'tool-verified',
          label: `${action.tool} 调用已验证`,
          hotkey: 'c',
          action: {
            kind: 'host_tool_verified',
            tool: action.tool === 'woa_context' ? 'woa_context' : 'wechat_draft_count',
          },
        },
        pause,
      ];
    default:
      return [pause];
  }
}

export function renderInitSummary(event: InitProtocolEvent): string {
  if (event.type === 'done' || event.status === 'done') {
    return `WOA 接入完成：${redactTerminalText(event.nextAction?.reason || '验证已完成。')}`;
  }
  if (event.type === 'paused' || event.status === 'paused') {
    return `WOA 接入已暂停。恢复：woa init resume ${event.runId}`;
  }
  if (event.type === 'error' || event.status === 'error') {
    return `WOA 接入失败：${redactTerminalText(event.error?.message || '未知错误')} (${event.error?.code || 'unknown'})`;
  }
  if (event.type === 'unsupported' || event.status === 'unsupported') {
    return `WOA 接入暂不支持：${redactTerminalText(event.error?.message || '当前环境不受支持')} (${event.error?.code || 'unsupported'})`;
  }
  return '';
}

function StepRail(props: { event: InitProtocolEvent; color: boolean }): ReactNode {
  const completed = new Set(props.event.completedPhases);
  return (
    <Box flexDirection="column">
      {STEP_RAIL.map(([phase, label]) => {
        const done = completed.has(phase) || props.event.phase === 'completed';
        const current = props.event.phase === phase;
        const marker = done ? 'x' : current ? props.event.error ? '!' : '>' : ' ';
        const color = props.color ? done ? 'green' : current ? props.event.error ? 'red' : 'cyan' : undefined : undefined;
        return <Text key={phase} color={color}>[{marker}] {label}</Text>;
      })}
    </Box>
  );
}

function CurrentAction(props: { event: InitProtocolEvent; color: boolean }): ReactNode {
  const lines = currentActionLines(props.event);
  return (
    <Box flexDirection="column">
      {props.event.error ? (
        <Text color={props.color ? 'red' : undefined}>
          [{props.event.error.code}] {redactTerminalText(props.event.error.message)}
        </Text>
      ) : null}
      {lines.map((line, index) => <Text key={`${index}:${line}`} wrap="wrap">{line}</Text>)}
    </Box>
  );
}

function ActionMenu(props: { actions: InitActionChoice[]; onAction: (action: InitRendererAction) => void }): ReactNode {
  const [selected, setSelected] = useState(0);
  const { isFocused } = useFocus({ autoFocus: true, id: 'init-actions' });
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      props.onAction({ kind: 'interrupt' });
      return;
    }
    if (input === 'q') {
      props.onAction({ kind: 'pause' });
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelected(value => (value - 1 + props.actions.length) % props.actions.length);
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelected(value => (value + 1) % props.actions.length);
      return;
    }
    const direct = props.actions.find(item => item.hotkey === input);
    if (direct) {
      props.onAction(direct.action);
      return;
    }
    if (key.return) props.onAction(props.actions[selected]?.action ?? { kind: 'pause' });
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column" marginTop={1}>
      {props.actions.map((item, index) => (
        <Text key={item.id}>
          {index === selected && isFocused ? '>' : ' '} [{item.hotkey || 'Enter'}] {item.label}
          {item.hint ? <Text dimColor> — {item.hint}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}

function currentActionLines(event: InitProtocolEvent): string[] {
  const action = event.nextAction;
  if (!action) return ['当前没有待处理动作。'];
  switch (action.kind) {
    case 'update_wechat_ip_allowlist':
      return ['请把以下全部固定出口 IP 加入目标公众号白名单：', ...action.ips];
    case 'open_url':
      return ['请由当前用户在浏览器完成授权：', action.url];
    case 'add_remote_mcp':
      return ['请在宿主添加远程 MCP：', `${action.descriptor.transport}  ${action.descriptor.url}`, '完成后选择继续。'];
    case 'start_native_oauth':
      return ['请在宿主中完成原生 OAuth，完成后选择继续。'];
    case 'call_mcp_tool':
      return [`请让宿主调用 ${action.tool}，成功后选择继续。`];
    case 'confirm_test_draft':
      return [`将创建测试草稿《${action.title}》。`, '该操作只保存草稿，不会发布。'];
    case 'secure_user_input':
      return ['凭据必须通过一次性 HTTPS handoff 或可信无回显终端输入完成；TUI 不读取或保存秘密。'];
    case 'choose_target':
      return [`需要明确选择公众号目标（${action.targets.length} 个候选）。`, action.reason];
    case 'wait':
      return [action.reason, action.retryAfterSeconds ? `建议 ${action.retryAfterSeconds} 秒后重试。` : '正在等待安全状态收敛。'];
    case 'reload_host':
    case 'confirm_install':
    case 'done':
    case 'unsupported':
      return [action.reason];
  }
}

function statusLabel(event: InitProtocolEvent): { marker: string; label: string; color?: string } {
  if (event.status === 'done') return { marker: 'x', label: '已完成', color: 'green' };
  if (event.status === 'paused') return { marker: '-', label: '已暂停', color: 'yellow' };
  if (event.status === 'error' || event.status === 'unsupported') return { marker: '!', label: '需处理', color: 'red' };
  if (event.status === 'action_required') return { marker: '>', label: '等待操作', color: 'cyan' };
  return { marker: '*', label: '处理中', color: 'cyan' };
}

function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout.columns || 80);
  useEffect(() => {
    const onResize = () => setWidth(stdout.columns || 80);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return width;
}

function isTerminalEvent(event: InitProtocolEvent): boolean {
  return ['done', 'paused', 'error', 'unsupported'].includes(event.type)
    || ['done', 'paused', 'error', 'unsupported'].includes(event.status);
}

export function redactTerminalText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:Bearer\s+)[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(access_?token|refresh_?token|client_?secret|app_?secret|authorization_?code|code_verifier)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/([?&](?:code|access_token|refresh_token|client_secret|app_secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/127\.0\.0\.1(?::\d+)?\/[^\s]*callback[^\s]*/gi, '[REDACTED_CALLBACK_URL]')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

class InitErrorBoundary extends Component<{
  children: ReactNode;
  onError: (error: Error) => void;
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    if (this.state.error) return <Text>WOA TUI 无法继续，正在保存检查点。</Text>;
    return this.props.children;
  }
}
