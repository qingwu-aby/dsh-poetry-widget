#!/bin/bash
# agent-loop 常驻巡检入口：headless dsh + resident profile + 持久 session。
set -euo pipefail
ROOT="${WHALE_WORKSPACE:-$HOME/Documents/deepseek-harness/default-workspace}"
LOOP="$ROOT/agent-loop"
mkdir -p "$LOOP/state" "$LOOP/logs"
LOCK="$LOOP/state/lock.d"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "already running"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
# 凭据格式可能是扁平 key: value，也可能是 refs 下的嵌套 value/token：用 node 读取，避免 bash 引号问题。
export PATH="$HOME/.local/bin:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
CREDS="$HOME/.dsh/.credentials.yaml"
KEY=""
if [ -f "$CREDS" ]; then
  NODE_BIN=$(command -v node || true)
  if [ -z "$NODE_BIN" ]; then
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/Library/pnpm/node"; do
      [ -x "$candidate" ] && NODE_BIN="$candidate" && break
    done
  fi
  if [ -n "$NODE_BIN" ]; then
    KEY=$("$NODE_BIN" "$LOOP/read-key.mjs" "$CREDS" 2>/dev/null || true)
  fi
fi
export OPENCODE_GO_API_KEY="${KEY:-}"
cd "$ROOT"
STAMP=$(date +%Y%m%d-%H%M%S)
PROMPT=$(cat "$LOOP/prompt.md")
if [ -f "$LOOP/state/session-id" ]; then
  SID=$(cat "$LOOP/state/session-id")
  dsh --profile resident --session-id "$SID" "$PROMPT" >> "$LOOP/logs/$STAMP.log" 2>&1 || { echo "run failed, see logs/$STAMP.log"; exit 1; }
else
  dsh --profile resident --json "$PROMPT" > "$LOOP/logs/$STAMP.jsonl" 2>>"$LOOP/logs/$STAMP.log" || true
  SID=$(head -1 "$LOOP/logs/$STAMP.jsonl" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')
  [ -n "$SID" ] && echo "$SID" > "$LOOP/state/session-id"
  echo "started session: ${SID:-unknown}"
fi
