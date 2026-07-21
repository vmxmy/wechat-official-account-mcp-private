/* eslint-disable react-refresh/only-export-components */
import React, { useState, type ReactNode } from 'react';
import { Box, Text, render, useFocus, useInput, type Instance } from 'ink';
import type { InitConsoleSnapshot } from './init-command.js';
import { redactTerminalText } from './init-ink.js';

export type UiShellSelection = 'start' | 'resume' | 'exit';

export interface UiShellOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  errorOutput?: NodeJS.WriteStream;
  color?: boolean;
  alternateScreen?: boolean;
  screenReader?: boolean;
}

interface ShellAction {
  id: 'start' | 'resume' | 'status' | 'exit';
  label: string;
  hotkey: string;
}

export async function runInkUiShell(
  snapshot: InitConsoleSnapshot,
  options: UiShellOptions = {},
): Promise<UiShellSelection> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const instance: { current: Instance | null } = { current: null };
  let alternateScreenActive = false;
  let finishFromSignal: ((selection: UiShellSelection) => void) | null = null;
  const onSigint = () => {
    process.exitCode = 130;
    finishFromSignal?.('exit');
  };
  const onSigterm = () => {
    process.exitCode = 143;
    finishFromSignal?.('exit');
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  if (options.alternateScreen !== false && output.isTTY === true) {
    output.write('\u001b[?1049h\u001b[2J\u001b[H');
    alternateScreenActive = true;
  }
  try {
    return await new Promise<UiShellSelection>((resolve, reject) => {
      finishFromSignal = resolve;
      const finish = (selection: UiShellSelection) => resolve(selection);
      try {
        instance.current = render(
          <UiShellScreen snapshot={snapshot} color={options.color !== false} onSelect={finish} />,
          {
            stdin: input,
            stdout: output,
            stderr: errorOutput,
            exitOnCtrlC: false,
            patchConsole: false,
            incrementalRendering: true,
            isScreenReaderEnabled: options.screenReader ?? process.env.INK_SCREEN_READER === 'true',
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    finishFromSignal = null;
    instance.current?.unmount();
    instance.current?.cleanup();
    if (alternateScreenActive) output.write('\u001b[?1049l\u001b[?25h');
  }
}

export function UiShellScreen(props: {
  snapshot: InitConsoleSnapshot;
  color?: boolean;
  onSelect: (selection: UiShellSelection) => void;
}): ReactNode {
  const [showStatus, setShowStatus] = useState(false);
  const actions: ShellAction[] = [
    { id: 'start', label: '开始新的接入流程', hotkey: 'n' },
    ...(props.snapshot.canResume ? [{ id: 'resume' as const, label: '恢复最近的接入流程', hotkey: 'r' }] : []),
    ...(props.snapshot.event ? [{ id: 'status' as const, label: showStatus ? '隐藏最近状态' : '查看最近状态', hotkey: 's' }] : []),
    { id: 'exit', label: '退出', hotkey: 'q' },
  ];
  const [selected, setSelected] = useState(0);
  const { isFocused } = useFocus({ autoFocus: true, id: 'woa-ui-menu' });
  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || input === 'q') {
      props.onSelect('exit');
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelected(value => (value - 1 + actions.length) % actions.length);
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelected(value => (value + 1) % actions.length);
      return;
    }
    const direct = actions.find(item => item.hotkey === input);
    const action = direct ?? (key.return ? actions[selected] : undefined);
    if (!action) return;
    if (action.id === 'status') setShowStatus(value => !value);
    else props.onSelect(action.id);
  }, { isActive: isFocused });

  const event = props.snapshot.event;
  const statusColor = props.color ? event?.status === 'done'
    ? 'green'
    : event?.status === 'error' || event?.status === 'unsupported'
      ? 'red'
      : event?.status === 'paused'
        ? 'yellow'
        : 'cyan' : undefined;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>WOA Console</Text>
      <Text dimColor>微信公众号 MCP 终端控制台 · onboarding MVP</Text>
      {event ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>最近流程：{event.runId}</Text>
          <Text color={statusColor}>[{event.status}] {event.phase}</Text>
          {props.snapshot.canResume ? <Text>可安全恢复，不会重复已完成阶段。</Text> : null}
        </Box>
      ) : <Text>尚无本地接入检查点。</Text>}
      {showStatus && event ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>状态详情</Text>
          <Text>CLI: {event.cliVersion}</Text>
          <Text>Server: {event.server}</Text>
          <Text>已完成阶段：{event.completedPhases.length}</Text>
          {event.error ? <Text>[{event.error.code}] {redactTerminalText(event.error.message)}</Text> : null}
          {event.resume ? <Text>恢复：{event.resume.command} {event.resume.args.join(' ')}</Text> : null}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, index) => (
          <Text key={action.id}>
            {index === selected && isFocused ? '>' : ' '} [{action.hotkey}] {action.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓/jk 选择  Enter 确认  s 状态  q 退出</Text>
      </Box>
    </Box>
  );
}
