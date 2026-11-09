#!/bin/bash
export PATH="$HOME/.venvs/mlx/bin:/opt/homebrew/bin:/usr/bin:/bin"
export TMPDIR="${TMPDIR:-/tmp}"
LIB="${WHALE_MLX_HOME:-$HOME/Library/Application Support/dsh-whale-mlx}"
MODEL="${WHALE_MLX_MODEL:-$LIB/model-1.5b}"
ADAPTER="${WHALE_MLX_ADAPTER:-$LIB/adapters-live}"
PORT="${WHALE_MLX_PORT:-8080}"
exec "$HOME/.venvs/mlx/bin/python" -u -m mlx_lm.server \
  --model "$MODEL" \
  --adapter-path "$ADAPTER" \
  --host 127.0.0.1 --port "$PORT"
