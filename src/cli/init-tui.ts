import { createInterface } from 'node:readline/promises';
import { cancel, intro, isCancel, log, note, outro, select } from '@clack/prompts';
import type { InitPhase, InitProtocolEvent } from './init.js';
import type { InitRenderer, InitRendererAction } from './init-runner.js';

const STEP_RAIL: Array<{ phase: InitPhase; label: string }> = [
  { phase: 'environment_check', label: '环境检查' },
  { phase: 'woa_login_required', label: 'WOA 登录' },
  { phase: 'wechat_ip_allowlist_required', label: '微信 IP 白名单' },
  { phase: 'wechat_credentials_required', label: '公众号凭据' },
  { phase: 'remote_mcp_required', label: '远程 MCP' },
  { phase: 'host_oauth_required', label: '宿主 OAuth' },
  { phase: 'tool_verification_required', label: '工具验证' },
  { phase: 'test_draft_required', label: '测试草稿' },
];

export interface InitTuiOptions {
  width?: number;
  headless?: boolean;
}

export class ProgressiveInitTuiRenderer implements InitRenderer {
  private started = false;
  private ended = false;

  constructor(private readonly options: InitTuiOptions = {}) {}

  async render(event: InitProtocolEvent): Promise<InitRendererAction | void> {
    if (!this.started) {
      intro('WOA 微信 MCP 接入');
      log.info('如需读屏或保留纯文本日志，可随时改用 `woa init --plain`。');
      this.started = true;
    }

    note(renderStepRail(event, this.options.width ?? process.stdout.columns ?? 80), '接入进度');
    if (event.type === 'done') {
      outro(event.nextAction?.reason || '接入流程已完成。');
      this.ended = true;
      return;
    }
    if (event.type === 'error' || event.type === 'unsupported') {
      log.error(`${event.error?.message || '当前环境不支持继续。'}${event.error?.code ? ` (${event.error.code})` : ''}`);
    }
    if (event.type === 'paused') {
      outro(`已保存检查点。恢复：woa init resume ${event.runId}`);
      this.ended = true;
      return;
    }

    const action = event.nextAction;
    if (!action) return;
    renderCurrentAction(event);
    const choice = await select({
      message: '当前只需完成这一项：',
      options: tuiOptions(event, this.options.headless === true),
    });
    if (isCancel(choice) || choice === 'pause') {
      if (isCancel(choice)) {
        cancel('已中断；正在保存检查点。');
        return { kind: 'interrupt' };
      }
      cancel('稍后继续；正在保存检查点。');
      return { kind: 'pause' };
    }
    if (choice === 'open' && action.kind === 'open_url') return { kind: 'open_url', url: action.url };
    if (choice === 'acknowledge') return { kind: 'acknowledge' };
    if (choice === 'remote_mcp_added') return { kind: 'remote_mcp_added' };
    if (choice === 'host_oauth_completed') return { kind: 'host_oauth_completed' };
    if (choice === 'host_tool_verified' && action.kind === 'call_mcp_tool') {
      return {
        kind: 'host_tool_verified',
        tool: action.tool === 'woa_context' ? 'woa_context' : 'wechat_draft_count',
      };
    }
    if (choice === 'confirm') return { kind: 'confirm' };
    if (choice === 'decline') return { kind: 'decline' };
    return { kind: 'pause' };
  }

  restore(): void {
    if (this.started && !this.ended && process.stdout.isTTY) process.stdout.write('\u001b[?25h');
  }
}

export interface PlainInitRendererOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  width?: number;
  headless?: boolean;
}

/** 无颜色、无动画、无光标控制的正式纯文本交互路径。 */
export class PlainInitRenderer implements InitRenderer {
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;

  constructor(private readonly options: PlainInitRendererOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  async render(event: InitProtocolEvent): Promise<InitRendererAction | void> {
    this.output.write(`\nWOA 微信 MCP 接入\n${renderStepRail(event, this.options.width ?? this.output.columns ?? 80, true)}\n`);
    if (event.type === 'done') {
      this.output.write(`完成：${event.nextAction?.reason || '接入流程已完成。'}\n`);
      return;
    }
    if (event.type === 'paused') {
      this.output.write(`已保存检查点。恢复：woa init resume ${event.runId} --plain\n`);
      return;
    }
    if (event.error) this.output.write(`错误：${event.error.message} (${event.error.code})\n`);
    if (!event.nextAction) return;
    this.output.write(`${plainActionText(event)}\n`);

    const menu = plainMenu(event, this.options.headless === true);
    this.output.write(`${menu.label}\n`);
    const terminal = createInterface({
      input: this.input,
      output: this.output,
      terminal: false,
    });
    try {
      const answer = (await terminal.question('选择：')).trim().toLowerCase();
      return menu.actions[answer] ?? { kind: 'pause' };
    } finally {
      terminal.close();
    }
  }

  restore(): void {
    // readline.close() 会恢复输入；纯文本模式不得输出任何控制序列。
  }
}

export function renderStepRail(event: InitProtocolEvent, width = 80, ascii = false): string {
  const currentIndex = event.phase === 'completed'
    ? STEP_RAIL.length
    : STEP_RAIL.findIndex(step => step.phase === event.phase);
  const completed = new Set(event.completedPhases);
  const rows = STEP_RAIL.map((step, index) => {
    const state = completed.has(step.phase) || event.phase === 'completed'
      ? ascii ? '[x] 已完成' : '✓ 已完成'
      : index === currentIndex
        ? event.error
          ? ascii ? '[!] 需处理' : '! 需处理'
          : ascii ? '[>] 当前' : '→ 当前'
        : ascii ? '[ ] 未开始' : '○ 未开始';
    return `${state}  ${step.label}`;
  });
  if (width < 60) return rows.join('\n');
  return rows.map((row, index) => `${String(index + 1).padStart(2, '0')}. ${row}`).join('\n');
}

function renderCurrentAction(event: InitProtocolEvent): void {
  const action = event.nextAction;
  if (!action) return;
  if (action.kind === 'update_wechat_ip_allowlist') {
    note(action.ips.join('\n'), '请加入全部出口 IP');
  } else if (action.kind === 'open_url') {
    note(action.url, '用户授权地址');
  } else if (action.kind === 'add_remote_mcp') {
    note(
      `${action.descriptor.transport}\n${action.descriptor.url}\n\n查看标准描述：woa mcp descriptor --server ${event.server}`,
      '远程 MCP',
    );
  } else if (action.kind === 'start_native_oauth') {
    log.step(`请在宿主中启动原生 OAuth；完成后选择继续。恢复事件：host_oauth_completed`);
  } else if (action.kind === 'call_mcp_tool') {
    log.step(`请让宿主调用 ${action.tool}，成功后选择继续。恢复事件：host_tool_verified`);
  } else {
    log.step(action.reason);
  }
}

function tuiOptions(event: InitProtocolEvent, headless: boolean) {
  const action = event.nextAction;
  if (action?.kind === 'open_url') {
    return headless
      ? [{ value: 'pause', label: '地址已显示，稍后恢复' }]
      : [
          { value: 'open', label: '打开浏览器', hint: '授权完成后自动继续' },
          { value: 'pause', label: '稍后继续' },
        ];
  }
  if (action?.kind === 'update_wechat_ip_allowlist') {
    return [
      { value: 'acknowledge', label: '我已在微信后台保存', hint: '后续仍会通过 relay 实际验证' },
      { value: 'pause', label: '稍后继续' },
    ];
  }
  if (action?.kind === 'confirm_test_draft') {
    return [
      { value: 'confirm', label: '确认只创建未发布测试草稿' },
      { value: 'decline', label: '不创建测试草稿' },
      { value: 'pause', label: '稍后继续' },
    ];
  }
  if (action?.kind === 'add_remote_mcp') {
    return [
      { value: 'remote_mcp_added', label: '宿主已添加远程 MCP，继续' },
      { value: 'pause', label: '保存并稍后继续' },
    ];
  }
  if (action?.kind === 'start_native_oauth') {
    return [
      { value: 'host_oauth_completed', label: '宿主 OAuth 已完成，继续' },
      { value: 'pause', label: '保存并稍后继续' },
    ];
  }
  if (action?.kind === 'call_mcp_tool') {
    return [
      { value: 'host_tool_verified', label: `宿主调用 ${action.tool} 已成功，继续` },
      { value: 'pause', label: '保存并稍后继续' },
    ];
  }
  return [{ value: 'pause', label: '保存并稍后继续' }];
}

function plainActionText(event: InitProtocolEvent): string {
  const action = event.nextAction;
  if (!action) return '当前没有待处理动作。';
  if (action.kind === 'update_wechat_ip_allowlist') {
    return `当前操作：把以下全部 IP 加入目标公众号白名单：${action.ips.join(', ')}`;
  }
  if (action.kind === 'open_url') return `当前操作：在用户浏览器完成授权。地址：${action.url}`;
  if (action.kind === 'add_remote_mcp') {
    return `当前操作：运行 woa mcp descriptor --server ${event.server} 查看标准描述，由宿主添加 ${action.descriptor.transport} MCP：${action.descriptor.url}；完成事件 remote_mcp_added。`;
  }
  if (action.kind === 'start_native_oauth') {
    return '当前操作：在宿主中完成原生 OAuth；完成事件 host_oauth_completed。';
  }
  if (action.kind === 'call_mcp_tool') {
    return `当前操作：由宿主调用 ${action.tool}；成功后提交 host_tool_verified。`;
  }
  return `当前操作：${action.reason}`;
}

function plainMenu(event: InitProtocolEvent, headless: boolean): {
  label: string;
  actions: Record<string, InitRendererAction>;
} {
  const action = event.nextAction;
  if (action?.kind === 'open_url' && !headless) {
    return {
      label: '[o] 打开浏览器  [q] 稍后继续',
      actions: { o: { kind: 'open_url', url: action.url }, q: { kind: 'pause' } },
    };
  }
  if (action?.kind === 'update_wechat_ip_allowlist') {
    return {
      label: '[Enter] 我已在微信后台保存  [q] 稍后继续',
      actions: { '': { kind: 'acknowledge' }, q: { kind: 'pause' } },
    };
  }
  if (action?.kind === 'confirm_test_draft') {
    return {
      label: '[y] 确认只创建未发布测试草稿  [d] 不创建  [q] 稍后继续',
      actions: { y: { kind: 'confirm' }, d: { kind: 'decline' }, q: { kind: 'pause' } },
    };
  }
  if (action?.kind === 'add_remote_mcp') {
    return {
      label: '[Enter] 宿主已添加远程 MCP，继续  [q] 稍后继续',
      actions: { '': { kind: 'remote_mcp_added' }, q: { kind: 'pause' } },
    };
  }
  if (action?.kind === 'start_native_oauth') {
    return {
      label: '[Enter] 宿主 OAuth 已完成，继续  [q] 稍后继续',
      actions: { '': { kind: 'host_oauth_completed' }, q: { kind: 'pause' } },
    };
  }
  if (action?.kind === 'call_mcp_tool') {
    return {
      label: `[Enter] 宿主调用 ${action.tool} 已成功，继续  [q] 稍后继续`,
      actions: {
        '': {
          kind: 'host_tool_verified',
          tool: action.tool === 'woa_context' ? 'woa_context' : 'wechat_draft_count',
        },
        q: { kind: 'pause' },
      },
    };
  }
  return { label: '[q] 保存并稍后继续', actions: { q: { kind: 'pause' } } };
}
