---
max_concurrency: 1
poll_interval_ms: 5000
max_retry_backoff_ms: 30000
model: gpt-5.5
project_url: https://linear.app/ziikoo/project/wechat-official-account-8acb7d184ea6
agent_timeout_ms: 600000
stall_timeout_ms: 120000
tracker:
  type: linear
  assignee_id: dee4ae24-e192-4314-93f6-3a43c7b12773
agent:
  type: codex
codex:
  binary_path: codex app-server
  sandbox: danger-full-access
linear:
  issue_details:
    enabled: true
  sync_comments:
    enabled: false
---
# Linear Workflow: WeChat Official Account

You are working on vmxmy/wechat-official-account-mcp-private.
## Issue
Title: {{ issue.title }}
Description:
{{ issue.description }}
URL: {{ issue.url }}

## Instructions
- Make focused, minimal changes for the issue.
- Keep existing behavior unless the issue explicitly requests a change.
- Add or update tests/docs when requested by acceptance criteria.
- Run relevant checks before reporting completion.
- You MUST create a real git commit before reporting completion:
  1. Run `git status --short` to confirm the changed files.
  2. Run `git add <changed-files>` and `git commit -m "fix(web): update login logo text"` (or an equally concise issue-specific message).
  3. Run `git rev-parse HEAD` and ensure it differs from the starting HEAD.
  4. Do not say the task is complete unless the commit exists on the current branch.
