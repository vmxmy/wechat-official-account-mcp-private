import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { redactSensitiveValue, requiredToolConfirmation } from './api-safety.js';
import { redactTerminalText } from './init-ink.js';
import type {
  UiAccount,
  UiConsoleExitAction,
  UiConsoleServices,
  UiConsoleSnapshot,
  UiContentItem,
  UiMutationResult,
  UiSession,
  UiTenant,
} from './ui-console-types.js';

type UiPage = 'overview' | 'setup' | 'accounts' | 'content' | 'tools' | 'usage' | 'connection';
type FocusRegion = 'navigation' | 'main' | 'context';
type ContentTab = 'drafts' | 'publishes' | 'inbox' | 'media';

interface TextDialog {
  kind:
    | 'create-account'
    | 'rename-account'
    | 'configure-account'
    | 'upload-media'
    | 'tool-json'
    | 'tool-confirm';
  value: string;
  account?: UiAccount;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  expectedConfirmation?: string;
}

interface ConfirmDialog {
  kind: 'confirm-account' | 'confirm-draft' | 'confirm-publish' | 'confirm-session';
  value: string;
  target: UiAccount | UiContentItem | UiSession;
}

interface PreviewDialog {
  kind: 'preview-account' | 'preview-draft' | 'preview-publish' | 'preview-tool';
  target?: UiAccount | UiContentItem;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  expectedConfirmation?: string;
}

interface MenuDialog {
  kind: 'help' | 'commands' | 'scope' | 'checkout' | 'detail' | 'search';
  index: number;
  value?: string;
}

type UiDialog = TextDialog | ConfirmDialog | PreviewDialog | MenuDialog | null;

const NAV_ITEMS: ReadonlyArray<{ id: UiPage; label: string; hotkey: string }> = [
  { id: 'overview', label: '总览', hotkey: '1' },
  { id: 'setup', label: '接入', hotkey: '2' },
  { id: 'accounts', label: '账号', hotkey: '3' },
  { id: 'content', label: '内容', hotkey: '4' },
  { id: 'tools', label: '工具', hotkey: '5' },
  { id: 'usage', label: '用量', hotkey: '6' },
  { id: 'connection', label: '连接', hotkey: '7' },
];

const CONTENT_TABS: ReadonlyArray<{ id: ContentTab; label: string; hotkey: string }> = [
  { id: 'drafts', label: '草稿', hotkey: '1' },
  { id: 'publishes', label: '已发布', hotkey: '2' },
  { id: 'inbox', label: '收件箱', hotkey: '3' },
  { id: 'media', label: '媒体', hotkey: '4' },
];

export interface UiConsoleScreenProps {
  snapshot: UiConsoleSnapshot;
  services: UiConsoleServices;
  color?: boolean;
  screenReader?: boolean;
  onExit: (action: UiConsoleExitAction) => void;
}

/**
 * Full-screen console. Network and credential ownership remains in the CLI
 * entry point through UiConsoleServices; this component only renders redacted
 * projections and emits deliberate exit actions for trusted input flows.
 */
export function UiConsoleScreen(props: UiConsoleScreenProps): ReactNode {
  const width = useTerminalWidth();
  const [snapshot, setSnapshot] = useState(props.snapshot);
  const [page, setPage] = useState<UiPage>('overview');
  const [focus, setFocus] = useState<FocusRegion>('navigation');
  const [navIndex, setNavIndex] = useState(0);
  const [mainIndex, setMainIndex] = useState(0);
  const [contentTab, setContentTab] = useState<ContentTab>('drafts');
  const [toolIndex, setToolIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialog, setDialog] = useState<UiDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toolResult, setToolResult] = useState<string | null>(null);
  const operationInFlight = useRef(false);

  useEffect(() => setSnapshot(props.snapshot), [props.snapshot]);
  useEffect(() => setMainIndex(0), [page, contentTab]);

  const activeTenant = snapshot.tenants.find(item => item.tenantId === snapshot.activeTenantId)
    ?? snapshot.tenants[0];
  const tenantAccounts = activeTenant
    ? snapshot.accounts.filter(item => item.tenantId === activeTenant.tenantId)
    : snapshot.accounts;
  const activeAccount = tenantAccounts.find(item => item.accountId === snapshot.activeAccountId)
    ?? tenantAccounts.find(item => item.isDefault)
    ?? tenantAccounts[0];
  const pageAccounts = snapshot.accounts
    .filter(item => !activeTenant || item.tenantId === activeTenant.tenantId)
    .filter(item => matchesQuery(searchQuery, item.name, item.accountId, item.status));
  const selectedAccount = pageAccounts[Math.min(mainIndex, Math.max(pageAccounts.length - 1, 0))];
  const rawContentItems = contentItemsForTab(snapshot, contentTab);
  const contentItems = rawContentItems.filter(item => matchesQuery(searchQuery, item.title, item.id, item.subtitle, item.status));
  const selectedContent = contentItems[Math.min(mainIndex, Math.max(contentItems.length - 1, 0))];
  const visibleTools = snapshot.tools.filter(tool => matchesQuery(searchQuery, tool.name, tool.description));
  const selectedTool = visibleTools[Math.min(toolIndex, Math.max(visibleTools.length - 1, 0))];
  const visibleSessions = snapshot.sessions.filter(session => matchesQuery(searchQuery, session.label, session.id, session.kind));

  useEffect(() => {
    if (width < 60 || props.screenReader === true) setFocus(current => current === 'navigation' ? 'main' : current);
  }, [width, props.screenReader]);
  useEffect(() => {
    if (page === 'tools') {
      setToolIndex(current => normalizeIndex(current, visibleTools.length));
      return;
    }
    const count = page === 'accounts'
      ? pageAccounts.length
      : page === 'content'
        ? contentItems.length
        : page === 'connection'
          ? visibleSessions.length
          : 0;
    setMainIndex(current => normalizeIndex(current, count));
  }, [page, contentTab, pageAccounts.length, contentItems.length, visibleTools.length, visibleSessions.length]);

  const refresh = async (successMessage = '已刷新远程状态。'): Promise<void> => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy('正在刷新远程状态…');
    try {
      setSnapshot(await props.services.refresh());
      setNotice(successMessage);
    } catch (error) {
      setNotice(`刷新失败：${safeError(error)}`);
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  };

  const mutate = async (label: string, action: () => Promise<UiMutationResult>): Promise<void> => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(label);
    let result: UiMutationResult;
    try {
      result = await action();
    } catch (error) {
      setNotice(`${label.replace(/…$/, '')}失败：${safeError(error)}`);
      operationInFlight.current = false;
      setBusy(null);
      return;
    }
    try {
      setSnapshot(await props.services.refresh());
      setNotice(result.message);
    } catch (error) {
      setNotice(`${result.message} 远程状态刷新失败：${safeError(error)}`);
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  };

  const closeDialog = (): void => setDialog(null);
  const moveDialog = (delta: number, count: number): void => {
    if (!dialog || !('index' in dialog)) return;
    setDialog({ ...dialog, index: (dialog.index + delta + count) % count });
  };

  const submitDialog = async (): Promise<void> => {
    if (!dialog || busy) return;
    if (dialog.kind === 'create-account') {
      if (!activeTenant || !dialog.value.trim()) {
        setNotice('请输入公众号名称。');
        return;
      }
      closeDialog();
      await mutate('正在创建公众号…', async () => await props.services.createAccount({
        tenantId: activeTenant.tenantId,
        name: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'rename-account') {
      if (!dialog.account || !dialog.value.trim()) {
        setNotice('请输入新的公众号名称。');
        return;
      }
      closeDialog();
      await mutate('正在重命名公众号…', async () => await props.services.renameAccount({
        tenantId: dialog.account!.tenantId,
        accountId: dialog.account!.accountId,
        name: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'configure-account') {
      if (!dialog.account || !dialog.value.trim()) {
        setNotice('请输入 AppID。');
        return;
      }
      props.onExit({
        kind: 'configure_account',
        tenantId: dialog.account.tenantId,
        accountId: dialog.account.accountId,
        appId: dialog.value.trim(),
      });
      return;
    }
    if (dialog.kind === 'upload-media') {
      if (!activeAccount || !dialog.value.trim()) {
        setNotice('请输入本地文件路径。');
        return;
      }
      closeDialog();
      await mutate('正在上传媒体…', async () => await props.services.uploadMedia({
        tenantId: activeAccount.tenantId,
        accountId: activeAccount.accountId,
        filePath: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'tool-json') {
      const tool = dialog.toolName ? snapshot.tools.find(item => item.name === dialog.toolName) : undefined;
      if (!tool) {
        setNotice('所选 MCP 工具已不可用，请刷新后重试。');
        closeDialog();
        return;
      }
      let args: Record<string, unknown>;
      try {
        const parsed = JSON.parse(dialog.value || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('工具参数必须是 JSON 对象。');
        args = parsed as Record<string, unknown>;
      } catch (error) {
        setNotice(`参数无效：${safeError(error)}`);
        return;
      }
      const confirmation = requiredToolConfirmation(tool, args);
      if (confirmation) {
        setDialog({
          kind: 'preview-tool',
          toolName: dialog.toolName,
          toolArguments: args,
          expectedConfirmation: confirmation,
        });
        return;
      }
      closeDialog();
      await callTool(tool, args);
      return;
    }
    if (dialog.kind === 'preview-tool') {
      setDialog({
        kind: 'tool-confirm',
        value: '',
        toolName: dialog.toolName,
        toolArguments: dialog.toolArguments,
        expectedConfirmation: dialog.expectedConfirmation,
      });
      return;
    }
    if (dialog.kind === 'tool-confirm') {
      const tool = dialog.toolName ? snapshot.tools.find(item => item.name === dialog.toolName) : undefined;
      const expected = tool && dialog.toolArguments ? requiredToolConfirmation(tool, dialog.toolArguments) : null;
      if (!tool || !dialog.toolArguments || !expected) {
        setNotice('工具确认状态已失效，请重新输入参数。');
        closeDialog();
        return;
      }
      if (dialog.value.trim() !== expected) {
        setNotice(`确认文本必须完全等于 ${expected}`);
        return;
      }
      closeDialog();
      await callTool(tool, dialog.toolArguments, expected);
      return;
    }
    if (dialog.kind === 'confirm-account') {
      const account = dialog.target as UiAccount;
      const expected = `DELETE ${account.accountId}`;
      if (dialog.value.trim() !== expected) {
        setNotice(`确认文本必须完全等于 ${expected}`);
        return;
      }
      closeDialog();
      await mutate('正在停用公众号…', async () => await props.services.disableAccount({
        tenantId: account.tenantId,
        accountId: account.accountId,
        confirmation: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'preview-account') {
      if (!dialog.target) return;
      setDialog({ kind: 'confirm-account', target: dialog.target as UiAccount, value: '' });
      return;
    }
    if (dialog.kind === 'confirm-draft') {
      const item = dialog.target as UiContentItem;
      const expected = `DELETE ${item.id}`;
      if (dialog.value.trim() !== expected || !activeAccount) {
        setNotice(`确认文本必须完全等于 ${expected}`);
        return;
      }
      closeDialog();
      await mutate('正在删除草稿…', async () => await props.services.deleteDraft({
        tenantId: activeAccount.tenantId,
        accountId: activeAccount.accountId,
        mediaId: item.id,
        confirmation: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'preview-draft') {
      if (!dialog.target) return;
      setDialog({ kind: 'confirm-draft', target: dialog.target as UiContentItem, value: '' });
      return;
    }
    if (dialog.kind === 'confirm-publish') {
      const item = dialog.target as UiContentItem;
      const expected = `DELETE ${item.id}`;
      if (dialog.value.trim() !== expected || !activeAccount) {
        setNotice(`确认文本必须完全等于 ${expected}`);
        return;
      }
      closeDialog();
      await mutate('正在删除发布记录…', async () => await props.services.deletePublish({
        tenantId: activeAccount.tenantId,
        accountId: activeAccount.accountId,
        articleId: item.id,
        confirmation: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'preview-publish') {
      if (!dialog.target) return;
      setDialog({ kind: 'confirm-publish', target: dialog.target as UiContentItem, value: '' });
      return;
    }
    if (dialog.kind === 'confirm-session') {
      const session = dialog.target as UiSession;
      const expected = `REVOKE ${session.id}`;
      if (dialog.value.trim() !== expected) {
        setNotice(`确认文本必须完全等于 ${expected}`);
        return;
      }
      closeDialog();
      await mutate('正在撤销会话…', async () => await props.services.revokeSession({
        sessionId: session.id,
        confirmation: dialog.value.trim(),
      }));
      return;
    }
    if (dialog.kind === 'scope') {
      const account = snapshot.accounts[dialog.index];
      if (!account) return;
      closeDialog();
      await mutate('正在切换公众号…', async () => await props.services.switchScope({
        tenantId: account.tenantId,
        accountId: account.accountId,
      }));
      return;
    }
    if (dialog.kind === 'checkout') {
      const plan = dialog.index === 0 ? 'plus' : 'pro';
      if (!activeTenant) {
        setNotice('请先选择租户。');
        return;
      }
      closeDialog();
      await mutate('正在创建支付页面…', async () => await props.services.checkout({ tenantId: activeTenant.tenantId, plan }));
      return;
    }
    if (dialog.kind === 'commands') {
      const action = ['overview', 'setup', 'accounts', 'content', 'tools', 'usage', 'connection', 'login'] as const;
      const selected = action[dialog.index];
      closeDialog();
      if (selected === 'login') props.onExit({ kind: 'login' });
      else if (selected) activatePage(selected);
      return;
    }
    if (dialog.kind === 'search') {
      setSearchQuery(dialog.value || '');
      closeDialog();
      return;
    }
    closeDialog();
  };

  const callTool = async (tool: NonNullable<typeof selectedTool>, args: Record<string, unknown>, confirmation?: string): Promise<void> => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(`正在调用 ${tool.name}…`);
    try {
      const result = await props.services.callTool({ tool, arguments: args, confirmation });
      setToolResult(formatJson(result));
      const message = result.isError ? `${tool.name} 返回了错误结果。` : `${tool.name} 调用完成。`;
      try {
        setSnapshot(await props.services.refresh());
        setNotice(message);
      } catch (error) {
        setNotice(`${message} 远程状态刷新失败：${safeError(error)}`);
      }
    } catch (error) {
      setNotice(`工具调用失败：${safeError(error)}`);
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  };

  const activatePage = (next: UiPage): void => {
    setPage(next);
    setNavIndex(NAV_ITEMS.findIndex(item => item.id === next));
    setFocus('main');
    setToolResult(null);
    setSearchQuery('');
  };

  const handleMainShortcut = (input: string, key: { return?: boolean; leftArrow?: boolean; rightArrow?: boolean }): void => {
    if (page === 'overview') {
      if (input === 'n' || key.return) props.onExit('start');
      else if (input === 'c' && snapshot.init.canResume) props.onExit('resume');
      return;
    }
    if (page === 'setup') {
      if (input === 'n') props.onExit('start');
      else if ((input === 'c' || key.return) && snapshot.init.canResume) props.onExit('resume');
      return;
    }
    if (page === 'accounts') {
      if (input === 'c') setDialog({ kind: 'create-account', value: '' });
      else if (input === 'e' && selectedAccount) setDialog({ kind: 'rename-account', account: selectedAccount, value: selectedAccount.name || '' });
      else if (input === 'k' && selectedAccount) setDialog({ kind: 'configure-account', account: selectedAccount, value: selectedAccount.appId || '' });
      else if (input === 'd' && selectedAccount) {
        void mutate('正在设为默认公众号…', async () => await props.services.setDefaultAccount({
          tenantId: selectedAccount.tenantId,
          accountId: selectedAccount.accountId,
        }));
      } else if (input === 't' && selectedAccount) {
        void mutate('正在刷新公众号 Token…', async () => await props.services.refreshAccountToken({
          tenantId: selectedAccount.tenantId,
          accountId: selectedAccount.accountId,
        }));
      } else if (input === 'x' && selectedAccount) setDialog({ kind: 'preview-account', target: selectedAccount });
      else if (key.return && selectedAccount) setDialog({ kind: 'detail', index: 0, value: formatJson(selectedAccount) });
      return;
    }
    if (page === 'content') {
      const tab = CONTENT_TABS.find(item => item.hotkey === input);
      if (tab) {
        setContentTab(tab.id);
        return;
      }
      if (key.leftArrow) setContentTab(previousContentTab(contentTab));
      if (key.rightArrow) setContentTab(nextContentTab(contentTab));
      if (input === 'u' && contentTab === 'media') setDialog({ kind: 'upload-media', value: '' });
      else if (input === 'x' && selectedContent && contentTab === 'drafts') setDialog({ kind: 'preview-draft', target: selectedContent });
      else if (input === 'x' && selectedContent && contentTab === 'publishes') setDialog({ kind: 'preview-publish', target: selectedContent });
      else if (key.return && selectedContent) setDialog({ kind: 'detail', index: 0, value: formatJson(selectedContent.detail ?? selectedContent) });
      return;
    }
    if (page === 'tools') {
      if (key.return && selectedTool) setDialog({ kind: 'tool-json', toolName: selectedTool.name, value: '' });
      return;
    }
    if (page === 'usage') {
      if (input === 'b' || key.return) setDialog({ kind: 'checkout', index: 0 });
      return;
    }
    if (page === 'connection') {
      if (input === 'l' || key.return) props.onExit({ kind: 'login' });
      else if (input === 'm') setDialog({ kind: 'detail', index: 0, value: snapshot.mcpDescriptor || '未配置 MCP descriptor。' });
      else if (input === 'c') setDialog({ kind: 'detail', index: 0, value: snapshot.mcpConfig || '未配置 Codex MCP config。' });
      else if (input === 'v') {
        const session = visibleSessions[Math.min(mainIndex, Math.max(visibleSessions.length - 1, 0))];
        if (session && !session.current) setDialog({ kind: 'confirm-session', target: session, value: '' });
      }
    }
  };

  useInput((input, key) => {
    if (dialog) {
      if (key.escape) {
        closeDialog();
        return;
      }
      if ('value' in dialog && dialog.kind !== 'detail') {
        const currentValue = dialog.value || '';
        if (key.return) {
          void submitDialog();
          return;
        }
        if (key.backspace || key.delete) {
          setDialog({ ...dialog, value: currentValue.slice(0, -1) } as UiDialog);
          return;
        }
        if (isPrintableInput(input) && !key.ctrl && !key.meta) {
          setDialog({ ...dialog, value: `${currentValue}${input}` } as UiDialog);
          return;
        }
      }
      if (key.upArrow || input === 'k') {
        if (dialog.kind === 'scope') moveDialog(-1, Math.max(snapshot.accounts.length, 1));
        else if (dialog.kind === 'checkout') moveDialog(-1, 2);
        else if (dialog.kind === 'commands') moveDialog(-1, 8);
        return;
      }
      if (key.downArrow || input === 'j') {
        if (dialog.kind === 'scope') moveDialog(1, Math.max(snapshot.accounts.length, 1));
        else if (dialog.kind === 'checkout') moveDialog(1, 2);
        else if (dialog.kind === 'commands') moveDialog(1, 8);
        return;
      }
      if (key.return) void submitDialog();
      return;
    }

    if ((key.ctrl && input === 'c') || input === 'q') {
      props.onExit('exit');
      return;
    }
    if (operationInFlight.current) return;
    if (input === '?') {
      setDialog({ kind: 'help', index: 0 });
      return;
    }
    if (input === ':') {
      setDialog({ kind: 'commands', index: 0 });
      return;
    }
    if (input === '/') {
      setDialog({ kind: 'search', index: 0, value: searchQuery });
      return;
    }
    if (input === 'g') {
      setDialog({ kind: 'scope', index: Math.max(snapshot.accounts.findIndex(item => item.accountId === activeAccount?.accountId), 0) });
      return;
    }
    if (input === 'r') {
      void refresh();
      return;
    }
    if (key.tab) {
      setFocus(current => current === 'navigation' ? 'main' : current === 'main' ? 'context' : 'navigation');
      return;
    }
    if (focus === 'navigation') {
      if (key.upArrow || input === 'k') setNavIndex(value => (value - 1 + NAV_ITEMS.length) % NAV_ITEMS.length);
      else if (key.downArrow || input === 'j') setNavIndex(value => (value + 1) % NAV_ITEMS.length);
      else {
        const byHotkey = NAV_ITEMS.findIndex(item => item.hotkey === input);
        if (byHotkey >= 0) activatePage(NAV_ITEMS[byHotkey]!.id);
        else if (key.return) activatePage(NAV_ITEMS[navIndex]!.id);
      }
      return;
    }
    if (focus === 'main') {
      const count = page === 'accounts'
        ? pageAccounts.length
        : page === 'content'
          ? contentItems.length
          : page === 'tools'
            ? visibleTools.length
            : page === 'connection'
              ? visibleSessions.length
              : 0;
      if (key.upArrow || input === 'k') {
        if (page === 'tools') setToolIndex(value => wrap(value - 1, Math.max(visibleTools.length, 1)));
        else if (count > 0) setMainIndex(value => wrap(value - 1, count));
        return;
      }
      if (key.downArrow || input === 'j') {
        if (page === 'tools') setToolIndex(value => wrap(value + 1, Math.max(visibleTools.length, 1)));
        else if (count > 0) setMainIndex(value => wrap(value + 1, count));
        return;
      }
      handleMainShortcut(input, key);
    }
  }, { isActive: true });

  const compact = width < 80;
  const narrow = width < 60;
  const linear = props.screenReader === true;
  const context = <ContextPanel snapshot={snapshot} activeTenant={activeTenant} activeAccount={activeAccount} color={props.color !== false} />;
  const main = (
    <MainPanel
      page={page}
      snapshot={snapshot}
      activeTenant={activeTenant}
      activeAccount={activeAccount}
      selectedAccount={selectedAccount}
      selectedContent={selectedContent}
      selectedTool={selectedTool}
      accounts={pageAccounts}
      contentItems={contentItems}
      tools={visibleTools}
      sessions={visibleSessions}
      searchQuery={searchQuery}
      mainIndex={mainIndex}
      toolIndex={toolIndex}
      contentTab={contentTab}
      toolResult={toolResult}
      focus={focus === 'main'}
      color={props.color !== false}
    />
  );

  return (
    <Box flexDirection="column" paddingX={narrow ? 0 : 1}>
      <Header snapshot={snapshot} activeAccount={activeAccount} color={props.color !== false} />
      {narrow || linear ? (
        <Box flexDirection="column" marginTop={1}>
          {linear ? <Text dimColor>当前页面：{NAV_ITEMS.find(item => item.id === page)?.label}</Text> : null}
          {main}
          <Box marginTop={1}>{context}</Box>
        </Box>
      ) : (
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Navigation page={page} navIndex={navIndex} focused={focus === 'navigation'} color={props.color !== false} />
          <Box flexDirection="column" flexGrow={1}>{main}</Box>
          {!compact ? context : null}
        </Box>
      )}
      {compact && !narrow ? <Box marginTop={1}>{context}</Box> : null}
      {notice ? <Notice text={notice} color={props.color !== false} /> : null}
      {busy ? <Box marginTop={1}><Text color={props.color ? 'cyan' : undefined}>● {busy}</Text></Box> : null}
      <Footer page={page} contentTab={contentTab} />
      {dialog ? <DialogView dialog={dialog} snapshot={snapshot} color={props.color !== false} /> : null}
    </Box>
  );
}

function Header(props: { snapshot: UiConsoleSnapshot; activeAccount?: UiAccount; color: boolean }): ReactNode {
  const status = props.snapshot.authenticated ? '已连接' : '需要登录';
  const statusColor = props.color ? props.snapshot.authenticated ? 'green' : 'yellow' : undefined;
  return (
    <Box justifyContent="space-between" flexWrap="wrap">
      <Box>
        <Text bold>WOA Console</Text>
        <Text dimColor> · 微信公众号 MCP 控制台</Text>
      </Box>
      <Text color={statusColor}>[{props.snapshot.authenticated ? '●' : '!'}] {status}{props.snapshot.server ? ` · ${shortText(props.snapshot.server, 42)}` : ''}</Text>
      {props.activeAccount ? <Text dimColor> · {shortText(props.activeAccount.name || props.activeAccount.accountId, 24)}</Text> : null}
    </Box>
  );
}

function Navigation(props: { page: UiPage; navIndex: number; focused: boolean; color: boolean }): ReactNode {
  return (
    <Box flexDirection="column" width={18} borderStyle="round" borderColor={props.color ? 'gray' : undefined} paddingX={1}>
      <Text bold>导航</Text>
      {NAV_ITEMS.map((item, index) => {
        const selected = item.id === props.page;
        const cursor = props.focused && index === props.navIndex ? '›' : ' ';
        return <Text key={item.id} color={props.color && selected ? 'cyan' : undefined}>{cursor} [{item.hotkey}] {item.label}</Text>;
      })}
    </Box>
  );
}

function ContextPanel(props: { snapshot: UiConsoleSnapshot; activeTenant?: UiTenant; activeAccount?: UiAccount; color: boolean }): ReactNode {
  return (
    <Box flexDirection="column" width={26} borderStyle="round" borderColor={props.color ? 'gray' : undefined} paddingX={1}>
      <Text bold>当前范围</Text>
      <Text dimColor>租户</Text>
      <Text>{shortText(props.activeTenant?.name || props.activeTenant?.tenantId || '未选择', 24)}</Text>
      <Text dimColor>公众号</Text>
      <Text>{shortText(props.activeAccount?.name || props.activeAccount?.accountId || '未选择', 24)}</Text>
      <Text dimColor>授权</Text>
      <Text>{props.snapshot.authenticated ? 'OAuth 会话有效' : '未登录或已失效'}</Text>
      {props.snapshot.operator?.scopes?.length ? <Text dimColor>Scope: {shortText(props.snapshot.operator.scopes.join(', '), 20)}</Text> : null}
      <Text dimColor>g 切换公众号</Text>
    </Box>
  );
}

function MainPanel(props: {
  page: UiPage;
  snapshot: UiConsoleSnapshot;
  activeTenant?: UiTenant;
  activeAccount?: UiAccount;
  selectedAccount?: UiAccount;
  selectedContent?: UiContentItem;
  selectedTool?: UiConsoleSnapshot['tools'][number];
  accounts: UiAccount[];
  contentItems: UiContentItem[];
  tools: UiConsoleSnapshot['tools'];
  sessions: UiSession[];
  searchQuery: string;
  mainIndex: number;
  toolIndex: number;
  contentTab: ContentTab;
  toolResult: string | null;
  focus: boolean;
  color: boolean;
}): ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.color ? 'cyan' : undefined} paddingX={1} flexGrow={1}>
      {props.searchQuery.trim() ? <Text dimColor>筛选：{shortText(props.searchQuery, 48)}</Text> : null}
      {props.page === 'overview' ? <Overview snapshot={props.snapshot} activeAccount={props.activeAccount} color={props.color} /> : null}
      {props.page === 'setup' ? <Setup snapshot={props.snapshot} color={props.color} /> : null}
      {props.page === 'accounts' ? <Accounts accounts={props.accounts} selected={props.selectedAccount} index={props.mainIndex} focused={props.focus} color={props.color} /> : null}
      {props.page === 'content' ? <Content tab={props.contentTab} items={props.contentItems} selected={props.selectedContent} index={props.mainIndex} focused={props.focus} color={props.color} /> : null}
      {props.page === 'tools' ? <Tools tools={props.tools} selected={props.selectedTool} index={props.toolIndex} focused={props.focus} result={props.toolResult} color={props.color} /> : null}
      {props.page === 'usage' ? <Usage snapshot={props.snapshot} color={props.color} /> : null}
      {props.page === 'connection' ? <Connection snapshot={props.snapshot} sessions={props.sessions} index={props.mainIndex} focused={props.focus} color={props.color} /> : null}
    </Box>
  );
}

function Overview(props: { snapshot: UiConsoleSnapshot; activeAccount?: UiAccount; color: boolean }): ReactNode {
  const event = props.snapshot.init.event;
  return (
    <Box flexDirection="column">
      <Text bold>总览</Text>
      {props.snapshot.init.canResume && event ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={props.color ? 'yellow' : undefined}>● 有一个可恢复的接入流程</Text>
          <Text>阶段：{event.phase} · 运行：{shortText(event.runId, 22)}</Text>
          <Text color={props.color ? 'cyan' : undefined}>[c] 继续接入  [n] 开始新的接入流程</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>{props.snapshot.authenticated ? '当前没有待恢复的接入流程。' : '登录后即可管理远程微信公众号资源。'}</Text>
          <Text color={props.color ? 'cyan' : undefined}>[n] 开始接入</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>公众号健康</Text>
        {props.activeAccount ? <>
          <Text color={statusColor(props.activeAccount.status, props.color)}>[{statusMarker(props.activeAccount.status)}] {props.activeAccount.name || props.activeAccount.accountId}</Text>
          <Text>凭据：{props.activeAccount.configured || props.activeAccount.hasAppSecret ? '已配置' : '待配置'}</Text>
        </> : <Text dimColor>尚未选择或创建公众号。</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>快速入口</Text>
        <Text>[3] 管理公众号  [4] 查看内容  [5] 调用 MCP 工具  [6] 查看用量</Text>
      </Box>
      {props.snapshot.errors.length ? <Box flexDirection="column" marginTop={1}>
        <Text color={props.color ? 'yellow' : undefined}>部分远程信息不可用</Text>
        {props.snapshot.errors.slice(0, 2).map(error => <Text key={error.area} dimColor>{error.area}：{shortText(error.message, 72)}</Text>)}
      </Box> : null}
    </Box>
  );
}

function Setup(props: { snapshot: UiConsoleSnapshot; color: boolean }): ReactNode {
  const event = props.snapshot.init.event;
  return (
    <Box flexDirection="column">
      <Text bold>接入公众号</Text>
      {event ? <>
        <Text>最近流程：{event.runId}</Text>
        <Text color={statusColor(event.status, props.color)}>[{statusMarker(event.status)}] {event.status} · {event.phase}</Text>
        <Text>{event.nextAction?.reason ? shortText(event.nextAction.reason, 100) : '流程状态已保存。'}</Text>
        <Text color={props.color ? 'cyan' : undefined}>{props.snapshot.init.canResume ? '[c / Enter] 继续此流程  [n] 新建流程' : '[n] 开始接入流程'}</Text>
      </> : <>
        <Text>接入会检查环境、OAuth、固定出口 IP、凭据、远程 MCP 和测试草稿。</Text>
        <Text color={props.color ? 'cyan' : undefined}>[n / Enter] 开始接入流程</Text>
      </>}
    </Box>
  );
}

function Accounts(props: { accounts: UiAccount[]; selected?: UiAccount; index: number; focused: boolean; color: boolean }): ReactNode {
  const accounts = props.accounts;
  return (
    <Box flexDirection="column">
      <Text bold>公众号账号</Text>
      {accounts.length === 0 ? <Text dimColor>暂无可访问公众号。按 c 创建。</Text> : accounts.map((account, index) => {
        const cursor = props.focused && index === props.index ? '›' : ' ';
        const defaultMark = account.isDefault ? ' ★' : '';
        return <Text key={`${account.tenantId}:${account.accountId}`} color={props.color && account.accountId === props.selected?.accountId ? 'cyan' : undefined}>{cursor} [{statusMarker(account.status)}] {shortText(account.name || account.accountId, 36)}{defaultMark}</Text>;
      })}
      {props.selected ? <Box flexDirection="column" marginTop={1}>
        <Text bold>账号详情</Text>
        <Text>ID：{props.selected.accountId}</Text>
        <Text>状态：{props.selected.status || '未知'} · 凭据：{props.selected.configured || props.selected.hasAppSecret ? '已配置' : '待配置'}</Text>
        <Text dimColor>[c] 创建  [e] 重命名  [d] 设默认  [k] 配置凭据  [t] 刷新 Token  [x] 停用</Text>
      </Box> : null}
    </Box>
  );
}

function Content(props: { tab: ContentTab; items: UiContentItem[]; selected?: UiContentItem; index: number; focused: boolean; color: boolean }): ReactNode {
  const tab = CONTENT_TABS.find(item => item.id === props.tab)!;
  const items = props.items;
  return (
    <Box flexDirection="column">
      <Text bold>内容中心</Text>
      <Text>{CONTENT_TABS.map(item => item.id === props.tab ? `›[${item.hotkey}] ${item.label}` : ` [${item.hotkey}] ${item.label}`).join('  ')}</Text>
      {props.tab === 'media' ? <Box flexDirection="column" marginTop={1}>
        <Text>本地媒体会先安全暂存到当前租户/公众号的 R2，再返回 r2Key。</Text>
        <Text color={props.color ? 'cyan' : undefined}>[u] 选择本地文件并上传</Text>
      </Box> : items.length === 0 ? <Text dimColor>没有可显示的{tab.label}。</Text> : items.map((item, index) => {
        const cursor = props.focused && index === props.index ? '›' : ' ';
        return <Text key={item.id} color={props.color && item.id === props.selected?.id ? 'cyan' : undefined}>{cursor} [{statusMarker(item.status)}] {shortText(item.title, 60)} <Text dimColor>{shortText(item.id, 16)}</Text></Text>;
      })}
      {props.selected && props.tab !== 'inbox' ? <Text dimColor>[Enter] 查看详情  [x] 删除当前{tab.label === '草稿' ? '草稿' : '发布记录'}</Text> : null}
    </Box>
  );
}

function Tools(props: { tools: UiConsoleSnapshot['tools']; selected?: UiConsoleSnapshot['tools'][number]; index: number; focused: boolean; result: string | null; color: boolean }): ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>动态 MCP 工具</Text>
      {props.tools.length === 0 ? <Text dimColor>未找到匹配工具。请检查筛选或 OAuth、Server 和 wechat.mcp Scope。</Text> : <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" width={28}>
          {props.tools.map((tool, index) => <Text key={tool.name} color={props.color && index === props.index ? 'cyan' : undefined}>{props.focused && index === props.index ? '›' : ' '} {shortText(tool.name, 24)}</Text>)}
        </Box>
        {props.selected ? <Box flexDirection="column" flexGrow={1}>
          <Text bold>{props.selected.name}</Text>
          <Text>{shortText(props.selected.description || '服务端未提供描述。', 70)}</Text>
          <Text dimColor>必填：{props.selected.inputSchema.required?.join(', ') || '无'}</Text>
          <Text dimColor>{props.selected.annotations?.readOnlyHint ? '只读' : props.selected.annotations?.destructiveHint ? '高风险' : '写入或未知影响'}</Text>
          <Text color={props.color ? 'cyan' : undefined}>[Enter] 输入 JSON 参数并调用</Text>
        </Box> : null}
      </Box>}
      {props.result ? <Box flexDirection="column" marginTop={1}>
        <Text bold>最近结果</Text>
        <Text wrap="wrap">{shortText(props.result, 2_400)}</Text>
      </Box> : null}
    </Box>
  );
}

function Usage(props: { snapshot: UiConsoleSnapshot; color: boolean }): ReactNode {
  const usage = props.snapshot.usage;
  return (
    <Box flexDirection="column">
      <Text bold>用量与套餐</Text>
      {usage ? <>
        <Text>套餐：{usage.plan || '未知'}{usage.resetAt ? ` · 重置：${usage.resetAt}` : ''}</Text>
        {usage.metrics.length ? usage.metrics.map(metric => <Text key={metric.name}>{shortText(metric.name, 24)}  {metric.used ?? 0}{metric.limit !== undefined ? ` / ${metric.limit}` : ''}{metric.unit ? ` ${metric.unit}` : ''} {usageBar(metric.used, metric.limit)}</Text>) : <Text dimColor>服务端未提供细分用量。</Text>}
        {usage.upgradePrompt ? <Text color={props.color ? 'yellow' : undefined}>{shortText(usage.upgradePrompt, 90)}</Text> : null}
        <Text color={props.color ? 'cyan' : undefined}>[b / Enter] 创建升级支付页面</Text>
      </> : <Text dimColor>尚未读取到套餐用量；请检查 usage Scope。</Text>}
    </Box>
  );
}

function Connection(props: { snapshot: UiConsoleSnapshot; sessions: UiSession[]; index: number; focused: boolean; color: boolean }): ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>连接与会话</Text>
      <Text>Server：{props.snapshot.server || '未设置'}</Text>
      <Text>身份：{props.snapshot.operator?.displayName || props.snapshot.operator?.email || (props.snapshot.authenticated ? '已登录操作员' : '未登录')}</Text>
      <Text>Scope：{props.snapshot.operator?.scopes?.join(', ') || '尚未读取'}</Text>
      <Text color={props.color ? 'cyan' : undefined}>[l / Enter] 重新登录  [m] MCP 描述  [c] Codex 配置</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>安全会话</Text>
        {props.sessions.length ? props.sessions.map((session, index) => <Text key={session.id} color={props.color && props.focused && index === props.index ? 'cyan' : undefined}>{props.focused && index === props.index ? '›' : ' '} {shortText(session.label, 42)}{session.current ? '（当前）' : ''}</Text>) : <Text dimColor>没有可显示的其他会话。</Text>}
        {props.sessions.some(item => !item.current) ? <Text dimColor>[v] 撤销所选会话</Text> : null}
      </Box>
    </Box>
  );
}

function Notice(props: { text: string; color: boolean }): ReactNode {
  return <Box marginTop={1}><Text color={props.color && props.text.includes('失败') ? 'red' : props.color ? 'cyan' : undefined}>› {shortText(props.text, 180)}</Text></Box>;
}

function Footer(props: { page: UiPage; contentTab: ContentTab }): ReactNode {
  const pageHelp = props.page === 'accounts'
    ? 'c 创建  e 重命名  d 默认  k 凭据  x 停用'
    : props.page === 'content'
      ? props.contentTab === 'media' ? 'u 上传媒体' : '1-4 切换内容  Enter 详情  x 删除'
      : props.page === 'tools'
        ? '↑↓ 选择工具  Enter 调用'
        : props.page === 'connection'
          ? 'l 登录  m 描述  c 配置  v 撤销会话'
          : props.page === 'setup' ? 'n 新建  c 继续' : 'Enter 执行主要操作';
  return <Box marginTop={1}><Text dimColor>{pageHelp}  ·  Tab 焦点  / 筛选  g 切换账号  r 刷新  : 命令  ? 帮助  q 退出</Text></Box>;
}

function DialogView(props: { dialog: UiDialog; snapshot: UiConsoleSnapshot; color: boolean }): ReactNode {
  const dialog = props.dialog;
  if (!dialog) return null;
  if (dialog.kind === 'help') {
    return <Dialog title="键盘帮助" color={props.color}><Text>Tab 切换区域；↑↓/jk 选择；Enter 执行；Esc 关闭。</Text><Text>g 切换公众号；r 刷新；: 命令；q 退出。</Text><Text>高风险操作必须输入完整确认文本。</Text></Dialog>;
  }
  if (dialog.kind === 'commands') {
    const commands = ['总览', '接入', '账号', '内容', '工具', '用量', '连接', '重新登录'];
    return <Dialog title="命令面板" color={props.color}>{commands.map((label, index) => <Text key={label} color={props.color && index === dialog.index ? 'cyan' : undefined}>{index === dialog.index ? '›' : ' '} {label}</Text>)}</Dialog>;
  }
  if (dialog.kind === 'scope') {
    return <Dialog title="切换当前公众号" color={props.color}>{props.snapshot.accounts.map((account, index) => <Text key={`${account.tenantId}:${account.accountId}`} color={props.color && index === dialog.index ? 'cyan' : undefined}>{index === dialog.index ? '›' : ' '} {shortText(account.name || account.accountId, 46)}</Text>)}</Dialog>;
  }
  if (dialog.kind === 'checkout') {
    return <Dialog title="选择升级套餐" color={props.color}><Text color={props.color && dialog.index === 0 ? 'cyan' : undefined}>{dialog.index === 0 ? '›' : ' '} Plus</Text><Text color={props.color && dialog.index === 1 ? 'cyan' : undefined}>{dialog.index === 1 ? '›' : ' '} Pro</Text><Text dimColor>确认后将在浏览器打开 Stripe Checkout。</Text></Dialog>;
  }
  if (dialog.kind === 'detail') {
    return <Dialog title="详情" color={props.color}><Text wrap="wrap">{shortText(dialog.value || '', 4_000)}</Text><Text dimColor>Esc 返回</Text></Dialog>;
  }
  if (dialog.kind === 'search') {
    return <Dialog title="筛选当前列表" color={props.color}>
      <Text>输入名称、ID、状态或说明：</Text>
      <Text color={props.color ? 'cyan' : undefined}>› {dialog.value || ''}_</Text>
      <Text dimColor>Enter 应用筛选 · Esc 取消</Text>
    </Dialog>;
  }
  if (dialog.kind === 'preview-account') {
    const account = dialog.target as UiAccount | undefined;
    return <Dialog title="Dry Run：停用公众号" color={props.color}>
      <Text>目标：{account?.name || account?.accountId || '未知公众号'}</Text>
      <Text>作用：删除远程凭据并停用该公众号。</Text>
      <Text dimColor>未发送远程请求。Enter 进入最终确认。</Text>
    </Dialog>;
  }
  if (dialog.kind === 'preview-draft' || dialog.kind === 'preview-publish') {
    const item = dialog.target as UiContentItem | undefined;
    const label = dialog.kind === 'preview-draft' ? '草稿' : '发布记录';
    return <Dialog title={`Dry Run：删除${label}`} color={props.color}>
      <Text>目标：{item?.title || item?.id || '未知对象'}</Text>
      <Text>ID：{item?.id || '未知'}</Text>
      <Text>未发送远程请求。Enter 进入最终确认。</Text>
    </Dialog>;
  }
  if (dialog.kind === 'preview-tool') {
    const tool = dialog.toolName ? props.snapshot.tools.find(item => item.name === dialog.toolName) : undefined;
    return <Dialog title="Dry Run：受保护的 MCP 调用" color={props.color}>
      <Text>工具：{tool?.name || '未知工具'}</Text>
      <Text wrap="wrap">参数：{shortText(formatJson(dialog.toolArguments || {}), 1_000)}</Text>
      <Text>确认文本：{dialog.expectedConfirmation || '未知'}</Text>
      <Text dimColor>Dry Run 不会建立 MCP 连接。Enter 进入最终确认。</Text>
    </Dialog>;
  }
  const title = dialog.kind === 'create-account'
    ? '创建公众号'
    : dialog.kind === 'rename-account'
      ? '重命名公众号'
      : dialog.kind === 'configure-account'
        ? '配置公众号凭据'
        : dialog.kind === 'upload-media'
          ? '上传本地媒体'
          : dialog.kind === 'tool-json'
            ? '输入 MCP JSON 参数'
            : dialog.kind === 'tool-confirm'
              ? '确认高风险 MCP 操作'
              : dialog.kind === 'confirm-account'
                ? '确认停用公众号'
                : dialog.kind === 'confirm-draft'
                  ? '确认删除草稿'
                  : dialog.kind === 'confirm-publish'
                    ? '确认删除发布记录'
                    : '确认撤销会话';
  const inputDialog = dialog as TextDialog | ConfirmDialog;
  const prompt = dialogPrompt(inputDialog);
  return <Dialog title={title} color={props.color}>
    {prompt ? <Text>{prompt}</Text> : null}
    <Text color={props.color ? 'cyan' : undefined}>› {inputDialog.value}_</Text>
    <Text dimColor>Enter 确认 · Esc 取消</Text>
  </Dialog>;
}

function Dialog(props: { title: string; color: boolean; children: ReactNode }): ReactNode {
  return <Box flexDirection="column" borderStyle="double" borderColor={props.color ? 'cyan' : undefined} paddingX={1} marginTop={1}><Text bold>{props.title}</Text>{props.children}</Box>;
}

function dialogPrompt(dialog: TextDialog | ConfirmDialog): string | undefined {
  if (dialog.kind === 'create-account') return '输入公众号显示名称：';
  if (dialog.kind === 'rename-account') return '输入新的公众号显示名称：';
  if (dialog.kind === 'configure-account') return '输入 AppID；下一步会离开界面并在可信终端无回显输入 AppSecret：';
  if (dialog.kind === 'upload-media') return '输入本地文件路径：';
  if (dialog.kind === 'tool-json') return '输入一个 JSON 对象。复杂参数建议使用单行粘贴：';
  if (dialog.kind === 'tool-confirm') return `输入精确确认文本：${dialog.expectedConfirmation || '请重新确认'}`;
  if (dialog.kind === 'confirm-account') return `此操作会清除公众号凭据。输入 DELETE ${(dialog.target as UiAccount).accountId}：`;
  if (dialog.kind === 'confirm-draft') return `草稿删除不可恢复。输入 DELETE ${(dialog.target as UiContentItem).id}：`;
  if (dialog.kind === 'confirm-publish') return `发布记录删除不可恢复。输入 DELETE ${(dialog.target as UiContentItem).id}：`;
  const session = (dialog as ConfirmDialog).target as UiSession;
  return `输入 REVOKE ${session.id}：`;
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

function previousContentTab(current: ContentTab): ContentTab {
  const index = CONTENT_TABS.findIndex(item => item.id === current);
  return CONTENT_TABS[wrap(index - 1, CONTENT_TABS.length)]!.id;
}

function nextContentTab(current: ContentTab): ContentTab {
  const index = CONTENT_TABS.findIndex(item => item.id === current);
  return CONTENT_TABS[wrap(index + 1, CONTENT_TABS.length)]!.id;
}

function contentItemsForTab(snapshot: UiConsoleSnapshot, tab: ContentTab): UiContentItem[] {
  switch (tab) {
    case 'drafts': return snapshot.drafts;
    case 'publishes': return snapshot.publishes;
    case 'inbox': return snapshot.inbox;
    case 'media': return [];
  }
}

function normalizeIndex(index: number, length: number): number {
  return length > 0 ? Math.min(Math.max(index, 0), length - 1) : 0;
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function statusMarker(status?: string): string {
  if (status === 'active' || status === 'done' || status === 'success' || status === 'published') return '✓';
  if (status === 'error' || status === 'disabled' || status === 'locked' || status === 'failed') return '!';
  if (status === 'pending' || status === 'action_required' || status === 'paused') return '●';
  return '○';
}

function statusColor(status: string | undefined, color: boolean): string | undefined {
  if (!color) return undefined;
  if (status === 'active' || status === 'done' || status === 'success' || status === 'published') return 'green';
  if (status === 'error' || status === 'disabled' || status === 'locked' || status === 'failed') return 'red';
  if (status === 'pending' || status === 'action_required' || status === 'paused') return 'yellow';
  return 'cyan';
}

function usageBar(used?: number, limit?: number): string {
  if (used === undefined || !limit || limit <= 0) return '';
  const filled = Math.min(10, Math.max(0, Math.round((used / limit) * 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function safeError(error: unknown): string {
  return redactTerminalText(error instanceof Error ? error.message : String(error));
}

function formatJson(value: unknown): string {
  try {
    return redactTerminalText(JSON.stringify(redactSensitiveValue(value), null, 2));
  } catch {
    return '[无法序列化结果]';
  }
}

function shortText(value: string, max: number): string {
  const safe = redactTerminalText(value).replace(/\s+/g, ' ').trim();
  return safe.length > max ? `${safe.slice(0, Math.max(0, max - 1))}…` : safe;
}

function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return values.some(value => value?.toLocaleLowerCase().includes(needle));
}

function isPrintableInput(input: string): boolean {
  return input.length > 0 && [...input].every(character => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f;
  });
}
