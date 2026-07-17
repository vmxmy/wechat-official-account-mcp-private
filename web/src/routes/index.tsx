import { createFileRoute } from '@tanstack/react-router';
import { Button, CodeBlock, Link, Text } from '@astryxdesign/core';
import { useRef, useState } from 'react';
import { WOA_AGENT_PROMPT } from '../lib/agent-prompt.js';

type CopyState = 'idle' | 'copied' | 'manual';

export const Route = createFileRoute('/')({
  component: AgentLandingPage,
});

function AgentLandingPage() {
  const promptRef = useRef<HTMLPreElement>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function copyPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(WOA_AGENT_PROMPT);
      setCopyState('copied');
    } catch {
      selectPromptText();
    }
  }

  function selectPromptText() {
    const code = promptRef.current?.querySelector('code');
    const selection = window.getSelection();
    if (!code || !selection) {
      setCopyState('manual');
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
    setCopyState('manual');
  }

  const copyStatus = copyState === 'copied'
    ? '已复制。回到 Agent 粘贴并发送；这个页面现在可以关闭。'
    : copyState === 'manual'
      ? '浏览器未允许自动复制，任务文本已选中。请按 ⌘/Ctrl+C 复制。'
      : '';

  return (
    <section className="agent-landing" aria-labelledby="agent-landing-title">
      <header className="agent-landing-intro">
        <span className="page-eyebrow">Agent-first 接入</span>
        <h1 id="agent-landing-title">
          让 Agent 配好<span className="agent-headline-term">微信公众号</span> MCP
        </h1>
        <Text as="p" type="large" textWrap="pretty">
          连接后，你可以直接让 AI 管理公众号素材、草稿、发布与消息。复制下面的任务给 Agent，它会完成安装、登录、连接和测试。
        </Text>
      </header>

      <div className="agent-prompt" aria-labelledby="agent-prompt-heading">
        <h2 id="agent-prompt-heading">给 Agent 的任务</h2>
        <CodeBlock
          ref={promptRef}
          id="agent-prompt-content"
          code={WOA_AGENT_PROMPT}
          language="text"
          hasCopyButton={false}
          hasLanguageLabel={false}
          isWrapped
          className="agent-prompt-code"
          maxHeight="var(--agent-prompt-max-height, min(42vh, 380px))"
          size="sm"
          width="100%"
        />
        <div className="agent-copy-action">
          <Button
            label="复制给 Agent"
            variant="primary"
            size="lg"
            clickAction={copyPrompt}
          />
        </div>
        <p
          className="agent-copy-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {copyStatus}
        </p>
      </div>

      <p className="agent-safety-note" role="note">
        准备好公众号管理员权限、AppID 和 AppSecret。出口 IP 需要加入微信白名单；AppSecret 只在 WOA 安全页面或你自己的终端输入。
      </p>

      <footer className="agent-landing-footer">
        <nav className="agent-footer-links" aria-label="管理与法律链接">
          <Link href="/app">管理后台</Link>
          <Link href="/legal/privacy">隐私说明</Link>
          <Link href="/legal/terms">服务条款</Link>
          <Link href="mailto:support@ziikoo.app">联系支持</Link>
        </nav>
      </footer>
    </section>
  );
}
