# 可观测性：健康指标、告警阈值与日志轮转（Gate A5）

> 目标：把“只能翻日志”变成可观察——先看 `health.json` 的指标/告警，再定位到具体日志。
> 相关代码：`lib/composition/health.mjs`、`scripts/log-rotate.mjs`、`lib/kernel/model-errors.mjs`、
> `lib/domain/host/model-budget.mjs`（Gate A1）、`lib/core/task-supervisor.mjs`（Gate A2）。

## 1. health.json 结构

`GET /api/dsh-poetry/health.json` 返回宿主快照（路由带信任栅栏，仅本机/授权页面可读）：

```js
{
  ok: true,
  version, dataVersion, dataAvailable,
  runtime: {
    // …既有字段保持不变（growth/drive/wander/reading/netlang/consolidate/services/
    //   budget/gate/heartbeat/web/modelErrors/growthMetrics/works/…）
    budget, gate, modelErrors,
    metrics: { … },   // v3.2（Gate A5）新增：结构化指标
    alerts: [ … ],    // v3.2（Gate A5）新增：阈值告警
  },
}
```

### 1.1 metrics

| 字段 | 含义 | 用途 |
|---|---|---|
| `generatedAt` | 快照生成时间（ms） | 判断数据新鲜度 |
| `gate.active` | 正在执行的模型调用数 | 并发是否打满 |
| `gate.queued` | 排队中的模型调用数 | 队列深度（瓶颈第一指标） |
| `gate.maxConcurrent` / `gate.maxQueue` / `gate.queueTimeoutMs` | 闸门配置 | 判断当前容量 |
| `gate.saturation` | `queued / maxQueue`（0–1） | 队列饱和度 |
| `gate.rejected` | `{queueFull, timeout}` 累计拒绝数（进程内） | 是否在丢调用 |
| `gate.lastReject` | 最近一次拒绝 `{reason, at, message, role}` | 定位哪个 role 被拒 |
| `budget.day` / `total` / `totalLimit` | 今日模型调用总数与上限 | 预算消耗 |
| `budget.usageRatio` | `total / totalLimit`（未设上限为 0） | 预算逼近度 |
| `budget.lastReject` / `pendingWrite` | 最近预算拒绝 / 是否有未落盘计数 | 预算诊断 |
| `tasks.available` | Task 监管器是否接线（Gate A2 尚未接入 Hub → `false`） | 占位标记 |
| `tasks.total/queued/running/waiting/blocked/maxRunning/byState` | 任务数 | 长任务是否卡住 |
| `events.available/queued/capacity/dropped/oldestQueuedAt/note` | 事件积压占位（Gate B 接线前 `available:false`、`note:'placeholder'`） | 背压观测入口 |
| `memory.rssBytes/heapUsedBytes/heapTotalBytes/externalBytes/heapUsedRatio` | 进程内存 | 泄漏/堆压力 |
| `memory.systemTotalBytes/systemFreeBytes` | 系统内存 | 机器整体压力 |
| `disk.available/path/totalBytes/freeBytes/usedRatio` | 状态目录所在磁盘 | 备份/日志能否写入 |
| `modelErrors.total/byRole/byCode/lastAt` | 最近 24h 模型错误聚合 | provider/凭证问题 |
| `minecraft.available/ok/lastObservationAt/lastCommandAt/permission/granted/interrupted/staleMs` | Minecraft World 状态（未接线时 `available:false, reason:'not-wired'`） | 游戏侧是否还活着 |

### 1.2 alerts

每条告警：`{ code, level: 'warn'|'critical', message, value, threshold }`。阈值集中在
`HEALTH_ALERT_THRESHOLDS`（`lib/composition/health.mjs`），可整体覆盖用于测试/调参。

| code | 触发条件（默认阈值） | 建议处置 |
|---|---|---|
| `gate-queue-saturated` | `queued / maxQueue ≥ 0.8` | 模型调用在排队：查慢调用/降低并发活动；必要时调 `DSH_POETRY_MODEL_MAX_QUEUE` 或并发 |
| `gate-rejections` | 累计拒绝 ≥ 1 | 有调用被拒（队列满/排队超时）：同上，并查 `gate.lastReject.role` |
| `budget-near-limit` | `usageRatio ≥ 0.9`（仅当设了上限） | 今日预算快用完：活动会安静跳过到明天，或调 `DSH_POETRY_DAILY_*` |
| `budget-rejected` | `budget.lastReject != null` | 已有调用因预算被拒：确认是否符合预期 |
| `model-errors-spike` | 24h 模型错误 ≥ 20 | 看 `modelErrors.byCode/byRole` 与 `model-errors.jsonl`（provider/超时/凭证） |
| `heap-pressure` | `heapUsedRatio ≥ 0.85` | 内存压力：重启插件/排查泄漏（长期记录 rss 趋势） |
| `disk-low` | `usedRatio ≥ 0.9`（空闲 < 10%） | **critical**：备份/日志可能写失败；清理旧备份/日志，扩盘 |
| `tasks-blocked` | `blocked ≥ 5`（tasks 接线后） | 长任务大量阻塞：查依赖/人工介入 |
| `event-backlog` | `queued / capacity ≥ 0.8`（events 接线后） | 事件消费跟不上：扩消费者/降生产 |
| `minecraft-stale` | 观察数据超过 10 分钟未更新（minecraft 可用时） | 查 Minecraft 进程/launchd/日志 |

> 告警是**被动可观测**：只出现在 `health.json` 的 `alerts[]`，不会主动弹窗/发消息。

## 2. 日志在哪里

| 日志 | 位置 | 说明 |
|---|---|---|
| Minecraft server/proxy/bot | `~/Library/Logs/whale-minecraft-*.log`（launchd 常驻） | 由外部进程写；用 `scripts/log-rotate.mjs` 轮转 |
| 插件运行日志 | 宿主 logger（DSH 日志）| `logger.warn/info` 转发；本插件不单独建大日志文件 |
| 模型失败诊断 | `$DSH_HOME/.dsh-poetry/model-errors.jsonl`（JSONL，最多 200 行） | 只含 status/code/message（≤500 字）与请求元数据，**不含 prompt/正文**；只读路由 `/api/dsh-poetry/model-errors.json` 返回最近 20 条 |
| 记忆/状态 | `$DSH_HOME/agent-memory/`、`$DSH_HOME/.dsh-poetry/` | 这是“她的记忆”，不是运维日志，不要当日志清理（见 `docs/state-migration.md`） |
| 备份 | `$DSH_HOME/state-backups/` | Gate A4 全量快照（manifest 含哈希） |

## 3. 日志轮转

`scripts/log-rotate.mjs` 只处理目标目录下匹配 `whale-*.log` 的普通文件（跳过符号链接/目录/其他应用日志）。

```bash
# 默认 dry-run：看会轮转/清理什么（不改文件）
node scripts/log-rotate.mjs
# 执行：默认阈值 10MB、每个日志保留 5 份
node scripts/log-rotate.mjs --apply
# 自定义阈值/保留/模式
node scripts/log-rotate.mjs --dir ~/Library/Logs --max-size 20M --keep 7 --apply
# 列出活动日志与轮转文件
node scripts/log-rotate.mjs --list
# 恢复某份轮转文件（默认 dry-run，--apply 执行）
node scripts/log-rotate.mjs --restore whale-minecraft-bot.20261118-113515.log --apply
```

行为：

- 轮转文件名固定 `<base>.<YYYYMMDD-HHmmss>.log`；清理只删除匹配该命名的文件，且不会超出目标目录；
- **copytruncate（默认）**：先复制到轮转文件再清空原文件——写日志的进程不需要重启，继续写同一个 inode；
  复制与清空之间的极短窗口内新写入的行可能丢失（日志可接受）；
- **rename**：重命名后重建空文件——如果写日志的进程一直持有旧 fd，会继续写轮转文件，需要重启该进程
  （`--mode rename` 适合能重启/能重新打开日志的场景）；
- 恢复 = 把轮转文件内容拼回原日志（旧内容在前、当前内容在后），然后删除轮转文件；重复恢复会失败（文件已不在）；
- 安全：默认 dry-run；不碰非 `whale-*.log`；不删目录；`--json` 可机器读；退出码 0/1。

建议：手动在升级/清理磁盘时跑；或加一条 launchd/cron（每周 `--apply`）。轮转本身不删除活动日志内容。

## 4. 排障流程（症状 → 指标 → 日志）

1. **她回复变慢/活动变少**
   - `health.runtime.metrics.gate`：`queued`/`saturation` 高 → 模型调用在排队；
   - 看 `gate.lastReject` 的 role；必要时提高 `maxQueue`/并发，或减少同时跑的活动；
   - 看 `budget.usageRatio`：预算用尽会安静跳过。
2. **模型频繁失败/回退本地**
   - `health.runtime.metrics.modelErrors`（24h total/byCode/byRole）；
   - 看 `$DSH_HOME/.dsh-poetry/model-errors.jsonl` 或 `/api/dsh-poetry/model-errors.json`；
   - 常见 code：`TIMEOUT`（超时）、`EMPTY_RESPONSE`（空响应）、`HTTP 400/429`（provider/限流）。
3. **磁盘告警 `disk-low`**
   - 清理旧备份：`ls $DSH_HOME/state-backups`（保留策略默认 7 份，可手动删旧的）；
   - 轮转日志：`node scripts/log-rotate.mjs --apply`；
   - 检查 `agent-memory/backups`、`works/` 体积。
4. **Minecraft 不动/卡住**
   - `metrics.minecraft.staleMs`（>10min 触发告警）；`permission/granted` 是否被收回；
   - 查 `~/Library/Logs/whale-minecraft-*.log` 与 launchd 服务状态；
   - 轮转只影响日志文件，不会杀进程。
5. **任务卡住（tasks 接线后）**
   - `metrics.tasks.byState.blocked` 高 → 看 Hub 任务详情/依赖；`waiting` 高 → 等外部事件；
   - 用 Task 监管器的 cancel/tick（Gate A2）清理过期租约。
6. **内存压力 `heap-pressure`**
   - 记录 `metrics.memory.rssBytes` 趋势（客户端 health 轮询 60s 一次）；
   - 重启插件/宿主；若持续增长，抓 heap snapshot 排查。

## 5. 与 Gate A5 验收对应

| 验收项 | 对应 |
|---|---|
| health 可看到瓶颈指标 | `metrics.gate.queued/saturation/rejected`、`budget.usageRatio`、`tasks.*`、`memory/disk`、`modelErrors`、`minecraft` |
| 告警阈值建议 | 本文第 1.2 节 + `HEALTH_ALERT_THRESHOLDS` |
| 日志轮转安全可回滚 | `scripts/log-rotate.mjs` 默认 dry-run、只动 `whale-*.log`、`--restore` 恢复、单测覆盖 |
| 测试 | `tests/kernel.test.mjs` 的 `health A5` / `log-rotate A5` 用例 |

## 6. 后续（非本 Gate）

- Gate B：`events` 从占位改为真实 Event Bus 积压（queued/capacity/dropped）。
- Gate D：`tasks` 从占位改为 Activity Hub 的 Task Board 快照（`createTaskSupervisor` 接线）。
- Gate D：`minecraft` 由 World 对象接入 `health`（`deps.minecraftWorld`）。
- 告警外发（消息/桌面通知）不在本 Gate；先保证 `health.json` 可读、可脚本轮询。
