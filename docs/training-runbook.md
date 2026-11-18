# 训练演练 Runbook（Gate M3）

> 目标：提供一个**默认安全**的训练 drill 入口。默认只做 dry-run（不启动训练、不改 adapter）；
> 只有显式 `--confirm` + `DSH_POETRY_TRAIN_DRILL=1` 才会真正运行 `self-train.sh`。
>
> ⚠️ 风险：`self-train.sh` 自身可能替换线上语言层（`adapters-live`）。**真实 drill 前请先备份 adapter 目录**；
> drill 脚本本身不直接改 adapter，但无法阻止 self-train 脚本的自身行为。

## 1. 前置检查（dry-run）

```bash
node scripts/training-drill.mjs
```

输出（只读）：

- 训练脚本路径是否存在、训练配置（enabled/intervalDays/eval.minScore/current adapter）；
- 数据集 stats（available/entries/sufficient/file，来自 journal/game-memory/methods）；
- 最近评估报告（report.md/history.log：score/passed/source）；
- token 是否配置、adapters 目录内容；
- 风险/前置条件列表。

dry-run **不会** spawn 任何进程、不会写日志、不会改 adapter。

## 2. 真实 drill（需双重确认）

```bash
# 先备份线上 adapter（强烈建议）
cp -R "$HOME/Library/Application Support/dsh-whale-mlx/self-train/adapters/adapters-live" \
      "$HOME/Library/Application Support/dsh-whale-mlx/self-train/adapters/adapters-live.bak-$(date +%Y%m%d-%H%M%S)"

DSH_POETRY_TRAIN_DRILL=1 node scripts/training-drill.mjs --confirm [--timeout 1800000]
```

- `--confirm` 与 env 缺一不可；缺任一都只做 dry-run 并打印拒绝原因。
- 真实运行会调用 `~/dsh-workspace/agent-loop/self-train.sh`（可用 `DSH_POETRY_SELF_TRAIN_SCRIPT` 覆盖）。
- 流式日志：`$DSH_HOME/.dsh-poetry/training-logs/drill-<timestamp>.log`。
- 结束后读取 `report.md`（回退 `history.log`）打印评估结果；退出码：0=完成，1=失败/超时/被拒绝/缺脚本/缺 token。
- 超时默认 30 分钟（`--timeout <ms>` 或 `DSH_POETRY_TRAIN_DRILL_TIMEOUT` 不读取，仅 CLI 参数）；超时发 SIGTERM。
- 取消：Ctrl+C 终止父进程；脚本自身支持 `AbortSignal`（库调用时）。

## 3. 评估闸门（eval）

- evaluator 读取 `report.md` 的「评估：通过/未通过」「期望相似度均值」「nonEmpty/total」，复评段（通过闸门）优先；
- 无报告/坏报告 → `TRAINING_EVALUATOR_UNAVAILABLE`（不伪造通过）；
- 训练服务 run 后写入 `candidate.score/passed`；**promote 需要 `confirm:true` 且 `passed=true`**，不过线返回 `TRAINING_EVAL_NOT_PASSED`。

## 4. promote / rollback（训练服务 API）

```bash
# 运行（需 enabled=true + confirm:true；runner 注入才可跑）
curl -s -X POST http://127.0.0.1:<port>/api/dsh-poetry/training.json \
  -H 'Content-Type: application/json' \
  -d '{"token":"<chat-token>","action":"run","confirm":true}'

# 上线（评估通过后；confirm:true）
curl -s -X POST ... -d '{"token":"<chat-token>","action":"promote","confirm":true}'

# 回滚（恢复到 previous adapter；confirm:true）
curl -s -X POST ... -d '{"token":"<chat-token>","action":"rollback","confirm":true}'
```

## 5. 风险与恢复

| 风险 | 说明 | 恢复 |
|---|---|---|
| self-train 替换线上层 | self-train.sh 可能复制 candidate 到 adapters-live 并重启本地服务 | 备份 `adapters-live`；必要时回滚到 `.bak-*` 并重启 mlx 服务 |
| 评估误判 | report 解析取复评段；无报告视为 unavailable | 人工核对 `report.md`/`history.log`；不要跳过 eval 闸门 |
| 数据不足 | dataset entries < minEntries → plan `insufficient-data` | 先导出数据集（`dataset.export` confirm:true）或降低 minEntries |
| 超时/中断 | drill 超时 SIGTERM；self-train 可能留下半成品 candidate | 检查 `adapters/` 与 `report.md`；删除未完成 candidate，保留旧层 |
| 误触发 | 默认 dry-run；真实运行需 `--confirm` + env=1 | 不会自动触发；cron/CI 不要设置 `DSH_POETRY_TRAIN_DRILL=1` |

## 6. 相关文件

- 训练配置：`$DSH_HOME/.dsh-poetry/training-config.json`
- 训练日志：`$DSH_HOME/.dsh-poetry/training-logs/`
- self-train 产物：`~/Library/Application Support/dsh-whale-mlx/self-train/`（report.md、history.log、adapters/）
- 数据集导出：`$DSH_HOME/.dsh-poetry/training-data.jsonl`（`dataset.export`）
