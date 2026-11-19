# 24h Soak Runbook（Gate O3）

> 工具：`scripts/soak-24h.mjs`。每轮跑 `load-baseline` + `fault-inject`（只读业务数据），把结果追加到 JSONL。
> 默认 **24h / 5min 一轮**；支持 `--once` 短测、`--resume` 断点续跑、Ctrl-C 优雅收尾。

## 启动

```bash
# 1) 先短测一轮（确认环境/脚本可用，约几十秒）
node scripts/soak-24h.mjs --once --out /tmp/soak-smoke.jsonl --json

# 2) 后台跑 24h（nohup；日志与报告分开）
mkdir -p /tmp/dsh-soak
nohup node scripts/soak-24h.mjs \
  --out /tmp/dsh-soak/soak-24h.jsonl \
  > /tmp/dsh-soak/soak.out 2>&1 &
echo $! > /tmp/dsh-soak/soak.pid

# 3) 自定义时长/间隔（例如 1h 快速回归）
node scripts/soak-24h.mjs --duration-ms 3600000 --interval-ms 60000 --out /tmp/soak-1h.jsonl
```

退出码：`0` 无失败；`1` 有失败或参数非法。结束时追加一行 `{"type":"summary",...}`。

## 查看进度

```bash
tail -f /tmp/dsh-soak/soak-24h.jsonl | jq -c '{ts,round,ok,elapsedMs}'
# 失败轮次
jq -c 'select(.ok==false)' /tmp/dsh-soak/soak-24h.jsonl
# 汇总（最后一轮 summary）
tail -1 /tmp/dsh-soak/soak-24h.jsonl | jq .
```

每行字段：`ts/round/elapsedMs/ok/metrics/errors`；`metrics` 含 `loadOk/loadScenarios/faultOk/faultScenarios`。

## 断点续跑

- 中途停止（Ctrl-C 或 kill）后会写 `summary`（`stopped:true`），已完成轮次保留在 JSONL。
- 继续：`node scripts/soak-24h.mjs --resume --out /tmp/dsh-soak/soak-24h.jsonl`
  - 从既有 `summary.startedAt`/最后轮次恢复，总时长仍按原 `--duration-ms` 计算；
  - 更换 `--out` 即视为新任务（不会误续旧报告）。

## 失败处理

- 单轮失败（load/fault 非 0/解析失败）**不会中断**，会累计到 `failures` 与 `errors`，最终退出码 1。
- 先看失败轮 `errors` 与对应 metrics；常见原因：宿主重启、脚本依赖缺失、磁盘满。
- 修复后可 `--resume` 继续；若失败是系统性的，先 `--once` 复现再决定是否重跑。

## 系统休眠说明

- soak 用**墙钟时间**判断是否到达 duration；Mac 合盖/休眠会暂停进程，唤醒后 `elapsedMs` 会跳变，可能补跑一轮后立即结束。
- 需要真跑满 24h：用 `caffeinate -i` 包住进程（或接电源 + 关闭自动休眠）：
  ```bash
  nohup caffeinate -i node scripts/soak-24h.mjs --out /tmp/dsh-soak/soak-24h.jsonl > /tmp/dsh-soak/soak.out 2>&1 &
  ```
- 睡眠期间的轮次不会补跑（只保证墙钟总时长）；需要轮次覆盖均匀时，用 launchd 定时跑 `--once` 更稳。

## 安全边界

- 只写 `--out` 指定 JSONL（默认 `$TMPDIR/dsh-poetry-soak/soak-24h.jsonl`），不修改业务数据/live 文件。
- `load-baseline`/`fault-inject` 均以 `--json` 只读方式调用；不触发真实模型/训练。
- 报告可能含错误栈摘要，不含密钥；分享前可自行脱敏。
