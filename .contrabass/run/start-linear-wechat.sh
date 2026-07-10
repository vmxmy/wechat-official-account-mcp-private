#!/usr/bin/env bash
set -euo pipefail
cd /Users/xumingyang/github/wechat-official-account-mcp
# Load LINEAR_API_KEY from interactive zsh environment without printing it.
LINEAR_KEY="$(DISABLE_AUTO_UPDATE=true POWERLEVEL9K_DISABLE_GITSTATUS=true zsh -ic 'printf %s "$LINEAR_API_KEY"' 2>/dev/null)"
if [[ -z "$LINEAR_KEY" ]]; then
  echo "LINEAR_API_KEY missing" >&2
  exit 1
fi
export LINEAR_API_KEY="$LINEAR_KEY"
exec /Users/xumingyang/github/contrabass/contrabass \
  --config .contrabass/workflows/linear-wechat-official-account.md \
  --no-tui \
  --port 8081 \
  --log-level debug \
  --log-file .contrabass/logs/linear-wechat.log
