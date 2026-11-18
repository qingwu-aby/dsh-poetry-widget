# 基线压测与故障注入（Gate A8）

> 目标：给后续 Hub 一个**可复现的运行基线**，并能在本地复现 Gate A 的队列/超时/恢复问题。
> 脚本：`scripts/load-baseline.mjs`（压测）、`scripts/fault-inject.mjs`（故障注入）。
> 约束：全部使用本地 mock，**不联网、不调用真实模型、不写 live 数据**；只有显式 `--out` 才写一个 JSON 报告文件。

## 1. 怎么跑

```bash
# 1) 基线压测（默认小规模冒烟：模型 200 / 任务 100 / 事件 1000，约 1s）
node scripts/load-baseline.mjs
# 只看配置与计划（不执行）
node scripts/load-baseline.mjs --dry-run
# 单场景 + 自定义参数 + 存 JSON 便于对比
node scripts/load-baseline.mjs --scenario model --requests 500 --concurrency 50 \
  --max-concurrent 2 --max-queue 24 --queue-timeout-ms 200 --json --out /tmp/baseline-model.json
node scripts/load-baseline.mjs --scenario task --tasks 500
node scripts/load-baseline.mjs --scenario event --events 5000 --event-capacity 1000

# 2) 故障注入（默认全部 9 个场景，约 0.1s）
node scripts/fault-inject.mjs
node scripts/fault-inject.mjs --list
node scripts/fault-inject.mjs --scenario task-cancel
node scripts/fault-inject.mjs --dry-run --json
```

参数（`load-baseline`）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--scenario` | `all` | `all` / `model` / `task` / `event` |
| `--seed` | 42 | 随机种子；同 seed + 同配置结果可对比 |
| `--requests` / `--concurrency` | 200 / 20 | 模型调用总数 / 并发客户端数 |
| `--max-concurrent` / `--max-queue` / `--queue-timeout-ms` | 2 / 24 / 200 | 直接传给真实 `createModelGate`（Gate A1） |
| `--service-ms` / `--slow-ratio` / `--slow-ms` / `--hang-ratio` | 2 / 0.1 / 25 / 0.02 | mock 模型时延分布（挂起=调用方超时） |
| `--tasks` / `--max-running` / `--task-ms` / `--cancel-ratio` | 100 / 4 / 20 / 0.05 | Task 监管器（Gate A2）压测 |
| `--events` / `--event-capacity` / `--unknown-ratio` | 1000 / 500 / 0.1 | 事件生产/消费与背压（Gate A7 契约 + 有界队列） |
| `--dry-run` / `--json` / `--out` | — | 只打印计划 / JSON 输出 / 写本地 JSON 报告 |

mock 模型假设：每个调用在 `serviceMs`（默认 2ms）内返回固定文本；按 `slowRatio` 变成 `slowMs`；
按 `hangRatio` 模拟“永不返回”（由调用方在 `queueTimeoutMs + 100ms` 后超时释放，避免压测永久卡死）。
**不调用任何真实 provider。**

## 2. 输出字段

`load-baseline --json` 返回：

| 字段 | 含义 |
|---|---|
| `model.requests/granted/rejected{queueFull,timeout,other}` | 模型调用总数 / 通过 / 各类拒绝 |
| `model.latencyMs{p50,p95,p99,max,avg}` | 端到端时延（排队 + mock 服务时间；不含挂起超时） |
| `model.queue{peak,maxQueue,maxConcurrent,final}` | 队列峰值深度 / 配置 / 结束快照（真实 `gate.snapshot()`） |
| `model.throughputPerSec` | 通过调用 / 秒 |
| `tasks{total,completed,cancelled,failed,byState,slotsUsed}` | Task 监管器结果（含 `task-supervisor` 状态计数） |
| `tasks.durationMsStats{p50,p95,...}` | 任务从创建到完成（注入时钟，不受机器负载影响） |
| `events{produced,processed,retainedUnknown,duplicates,dropped,peakDepth,invalid}` | 事件生产/消费/背压/未知保留 |
| `memory{rssBytes,heapUsedBytes,heapTotalBytes}` | 进程内存（运行结束时） |
| `durationMs` / `config` / `seed` | 运行耗时 / 生效配置 / 种子（对比用） |

`fault-inject --json` 返回 `{ok, scenarios:[{id,name,ok,durationMs,details|error}], durationMs}`。

## 3. 参考基线（本机，2026-11-18，macOS arm64 / Node 22）

> 仅作**参考**：绝对数字受机器负载影响；对比时请固定 seed + 配置，并看相对变化。

**默认配置（健康基线，`node scripts/load-baseline.mjs`）**

| 指标 | 数值 |
|---|---|
| 总耗时 | ~890ms |
| 模型：200 次 / 并发 20 / 闸门 2+24 队列 | 通过 200，拒绝 0；p50 73ms、p95 181ms、p99 189ms；峰值队列 20/24；吞吐 ~229/s |
| 任务：100 个 / maxRunning 4 | 完成 96、取消 4、失败 0；p50 18ms、p95 20ms；结束时槽位 0 |
| 事件：1000 条 / 容量 500 / 未知 10% | 处理 450、未知保留 98、丢弃 500（背压生效）、峰值队列 500 |
| 内存 | rss ~52MB / heap ~5.5MB |

**压力配置（复现队列满，`--scenario model --requests 300 --concurrency 60 --max-concurrent 2 --max-queue 16 --queue-timeout-ms 50 --hang-ratio 0.03`）**

| 指标 | 数值 |
|---|---|
| 模型 | 通过 18，拒绝 **队列满 282**；p50 16ms、p95 46ms；峰值队列 16/16 |
| 结论 | 队列满被明确拒绝（不无限等待），与 Gate A1 契约一致 |

**事件压力（`--scenario event --events 2000 --event-capacity 200`）**

| 指标 | 数值 |
|---|---|
| 事件 | 处理 179、未知保留 191、丢弃 1800、峰值队列 200 |
| 结论 | 有界队列触发背压；未知事件按 retain 策略保留（未执行） |

## 4. 阈值建议（回归判读）

对比“同 seed + 同配置”的两次结果；超过阈值先查机器负载，再查代码：

| 指标 | 建议阈值 | 触发后 |
|---|---|---|
| 模型 p95 时延 | > 基线 3 倍 | 查闸门排队（`model.queue.peak` 是否长期贴顶）/慢调用 |
| 模型拒绝率 | > 1%（默认配置） | 容量不足：调 `maxQueue`/并发，或降活动频率（`docs/cost-policy.md`） |
| 队列峰值 | 持续 ≥ 80% `maxQueue` | 同上；关注 `health.metrics.gate.saturation` |
| 任务 p95 时长 | > 基线 2 倍 | 查 Task 补位/阻塞（`byState.blocked`） |
| 事件丢弃率 | > 10%（压力配置除外） | 队列容量/消费速率；见 `docs/event-contract.md` 背压策略 |
| 内存 rss | 单次运行增长 > 20% 或多次持续上涨 | 查泄漏（长期记录 `memory.rssBytes`） |

> 默认配置是“健康基线”（拒绝应为 0）；压力配置用于**验证拒绝路径**，两者不要混比。

## 5. 故障注入场景（`scripts/fault-inject.mjs`）

| 场景 | 模拟 | 通过标准 |
|---|---|---|
| `model-timeout` | mock 模型永不返回，调用方 20ms 超时 | 超时错误码可识别；并发槽位释放；可再次获取 |
| `model-empty` | mock 返回空文本 | 判失败（`FAULT_EMPTY_RESPONSE`）；槽位释放 |
| `gate-queue-full` | 并发打满 + 队列满 | 立即拒绝 `MODEL_GATE_QUEUE_FULL`；拒绝不占队列 |
| `gate-queue-timeout` | 排队超过 `queueTimeoutMs` | 拒绝 `MODEL_GATE_QUEUE_TIMEOUT`；队列自愈；随后可再获取 |
| `task-cancel` | 取消运行中任务 | 终态 `cancelled`；取消信号触发；槽位释放；queued 补位 |
| `task-lease-expiry` | 租约过期后 tick | 自动 `failed`（`TASK_LEASE_EXPIRED`）；槽位释放 |
| `process-restart` | 预算落盘 + 新实例 | 预算计数保留（2）；Task 监管器新实例为空（内存态，需 Hub 重建） |
| `disk-write-failure` | 预算写盘抛 ENOSPC | 内存计数不受影响；`flush()` 不抛异常；有告警 |
| `event-unknown-retain` | 未知事件类型 | 版本判定 `unknown-type` + `action:'retain'`（不丢弃、不执行） |

全部场景只操作内存与系统临时目录（用后删除），无网络、无真实模型、无 live 数据写入。

## 6. 与 Gate A 的对应

| Gate A 能力 | 压测/故障注入如何覆盖 |
|---|---|
| A1 模型网关（有界队列/排队超时/预算写盘） | `model` 场景用真实 `createModelGate`；`gate-queue-full/timeout`、`disk-write-failure` 场景 |
| A2 Task 监管（租约/取消/并发） | `task` 场景用真实 `createTaskSupervisor`；`task-cancel`、`task-lease-expiry`、`process-restart` 场景 |
| A4 备份/恢复（落盘语义） | `process-restart` 场景验证“预算落盘保留 vs 内存态清空”的契约边界 |
| A6 成本治理 | 拒绝路径与 A1 一致（`COST_RATE_LIMITED` 的窗口语义由 `cost-guard` 单测覆盖；压测可用 `--max-concurrent` 模拟瓶颈） |
| A7 事件契约/背压 | `event` 场景用真实 `event-schema` 校验 + 有界队列；`event-unknown-retain` 场景 |

## 7. 结果记录方式

- 每次压测用 `--out baseline-<YYYYMMDD>-<scenario>.json` 存本地（不要提交含机器路径的报告）；
- 对比：固定 `seed` 与参数，比较 `latencyMs.p95`、`rejected`、`queue.peak`、`tasks.durationMsStats.p95`、`events.dropped`；
- 升级/改 Gate A 相关代码后：先跑 `fault-inject`（必须全绿），再跑一次默认基线对比阈值；
- 结果可贴到 PR/发布记录（只贴关键数字，不贴完整机器信息）。

## 8. 局限

- mock 模型不是真实 provider：不能反映网络/限流/真实 token 生成耗时；
- 单进程内存模拟：不覆盖多实例、磁盘 IO、真实 Event Bus 存储；
- 时延数字受机器负载影响，p95 抖动属正常；以“同机同配置相对变化”为准；
- 事件场景的“消费”是同步循环，不代表真实消费者吞吐上限（背压阈值以 `EVENT_BACKPRESSURE_DEFAULTS` 为准）。

## 9. Gate A8 验收对应

| 验收项 | 对应 |
|---|---|
| 能复现 Gate A 的队列/超时/恢复问题 | `load-baseline` 压力配置（队列满/峰值）+ `fault-inject` 9 个场景 |
| 基线数据可对比 | 固定 seed/配置 + `--json` 字段 + 本文 §3/§4 阈值 |
| 测试绿 | `tests/kernel.test.mjs` 的 `load-baseline A8` / `fault-inject A8` 用例；脚本默认 dry-run/无外部副作用 |
