#!/bin/bash
# 自训练入口：给 DSH 插件定时调用；日志落在 ~/Library/Application Support/dsh-whale-mlx/self-train/
set -uo pipefail
LOGDIR="${WHALE_MLX_HOME:-$HOME/Library/Application Support/dsh-whale-mlx}/self-train"
mkdir -p "$LOGDIR"
STAMP=$(date +%Y%m%d-%H%M%S)
export PATH="$HOME/.local/bin:$HOME/.venvs/mlx/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "${WHALE_WORKSPACE:-$HOME/dsh-workspace}" || exit 1
node agent-loop/self-train.mjs >> "$LOGDIR/run-$STAMP.log" 2>&1
echo "exit=$?" >> "$LOGDIR/run-$STAMP.log"
