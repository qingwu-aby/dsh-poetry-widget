# 事件契约、背压与回放设计（Gate A7）

> 状态：契约文档 + 纯函数校验实现（`lib/core/event-schema.mjs`）。**不实现存储/Event Bus**；
> 本契约供 Gate B 的 Event Bus、Activity SDK、回放工具直接使用。
> 关联：`docs/architecture-v2.md`（Hub 设计）、`lib/core/task-supervisor.mjs`（Task 状态机）、
> `lib/composition/health.mjs`（`metrics.events` 积压占位）。

## 1. 事件 envelope

```json
{
  "id": "evt-loyw3v28-1a2b3c4d",
  "activity": "reading",
  "type": "reading.highlight",
  "version": 1,
  "at": 1763424000000,
  "subject": "book-42",
  "topics": ["reading", "reading.highlight"],
  "payload": { "page": 3, "note": "好句" },
  "correlationId": "evt-loyw3v28-1a2b3c4d"
}
```

| 字段 | 必填 | 默认 | 校验 | 说明 |
|---|---|---|---|---|
| `id` | 是 | — | 8–128 位 `[A-Za-z0-9][A-Za-z0-9_.:-]*` | 事件唯一 id（重投保持同一 id） |
| `activity` | 是 | — | 3–40 位小写字母/数字/连字符 | 产生事件的活动 id（与 Activity manifest 的 id 一致） |
| `type` | 是 | — | `<namespace>.<name>[.<sub>]`，小写，≤120 | 事件类型；第一段是命名空间 |
| `version` | 是 | — | 1..1000 整数 | **该事件类型**的 payload schema 版本（不是 envelope 版本） |
| `at` | 是 | — | 毫秒时间戳 > 0 | 事件发生时间（生产方时钟） |
| `subject` | 是 | — | 1–200 字，无控制字符 | 聚合/实体 id（同一 subject 内保证顺序），如 task id、peerId、bookId |
| `topics` | 否 | `[activity, type]` | ≤16 个，去重，`[a-z0-9][a-z0-9._:-]*` | 路由/订阅用；至少含活动与类型，可加自定义 |
| `payload` | 否 | `{}` | 普通对象、JSON 可序列化、≤64KB | 事件内容；**不得放密钥/凭证** |
| `correlationId` | 否 | `id` | 同 id 规则 | 因果链 id：同一逻辑链/重投保持同一值（幂等键依赖它） |

校验入口：`validateEventEnvelope(raw)` / `createEventEnvelope(input, {now, random})`。
返回 `{ok:true, event}` 或 `{ok:false, errors:[{path, code, message}]}`（一次收集全部错误）。

## 2. 命名空间与事件类型

- 规则：`<namespace>.<name>[.<sub>]`，全小写；第一段为命名空间。
- **保留命名空间**（核心域，Activity 自定义事件不得占用）：
  `activity`、`chat`、`cost`、`memory`、`model`、`system`、`task`、`world`。
- Activity 用自己的 manifest id 作为命名空间，例如 `reading.started`、`reading.highlight`、`reading.finished`；
  工具事件可加子段：`reading.tool.open`。
- 事件类型必须在 Activity manifest 的 `events` 里声明（见 `docs/activity-permissions.md`），
  Hub 只路由已声明的事件；未声明的按未知事件策略处理（保留但不投递给该 Activity）。

## 3. 版本演进

- **每个 type 独立版本**，从 1 开始单调递增；`version` 表示 payload 结构版本。
- 只增不删：新增字段必须可选（消费方按缺省值处理）；删除/改名/语义变化 = 破坏性变更 → 升版本。
- 消费方声明兼容范围：`{ types: ['reading.highlight'], minVersion: 1, maxVersion: 2 }`（`types:'*'` 表示全接受）。
- 判定函数：`checkEventVersion(event, consumer)` → `{ok, status, action, reason}`：

| status | 含义 | action | 策略 |
|---|---|---|---|
| `compatible` | 类型支持且版本在范围内 | `process` | 正常处理 |
| `unknown-type` | 消费方没声明该类型 | `retain` | **保留**（存起来，等新消费者/升级后再处理），不报错、不丢弃 |
| `too-new` | 事件版本高于消费方已知 | `retain` | **保留**（等消费方升级），不报错、不丢弃 |
| `too-old` | 事件版本低于消费方最低支持 | `skip` | 跳过（可归档），计数告警，不阻塞总线 |
| `invalid` | envelope 结构非法 | `drop` | 丢弃并记录错误（生产方 bug，需修复） |

- 回放兼容：回放时同样逐条跑 `checkEventVersion`；`retain` 的事件保留在归档里，升级后重放；
  `skip` 的事件计入 `skipped` 指标，不静默丢弃。
- 未知事件策略常量：`UNKNOWN_EVENT_POLICY = 'retain'`（**默认保留**）。

## 4. 幂等键与 at-least-once

- 投递语义：**at-least-once**（可能重复、可能乱序；不承诺 exactly-once）。
- 幂等键：`buildIdempotencyKey(event)` = `${activity}:${type}:${subject}:${correlationId}`。
  - 同一条逻辑事件重投（同 correlationId/subject/type）→ 同一个 key；
  - 需要按内容去重时用 `{includeContentHash:true}` 追加 `contentHashOf(event)` 前 16 位；
  - `contentHashOf` 用稳定序列化（键排序），与对象键顺序无关。
- 消费方去重建议：内存/落盘 Set + TTL（如 24h）+ 上限（如 10 万条，LRU）；重复事件直接跳过。
- 副作用幂等：写记忆用 event id 去重；发消息/建造等外部副作用必须带任务幂等键
  （Gate A2 `task-supervisor` 的 `submit({key})`）或人工确认，不能只靠“事件只发一次”。

## 5. 顺序边界

- **同一 subject 内有序**：由单写者保证（一个 Activity/一个进程内按产生顺序投递）；
- **跨 subject / 跨 activity 不保证顺序**（并发生产、重放、重试都可能乱序）；
- 因果链用 `correlationId` 串联（如一次用户消息 → 模型调用 → 回复 → 记忆写入同一 correlationId）；
- 重放可能乱序：消费方按 `at` 排序或使用幂等键，不要依赖到达顺序。

## 6. 背压策略（不实现存储）

默认值（`EVENT_BACKPRESSURE_DEFAULTS`，env 可覆盖，见 `resolveEventBackpressure`）：

| 项 | 默认 | 含义 |
|---|---|---|
| `retentionHours` | 72h | 事件保留窗口；超过后归档/清理 |
| `maxEventsInMemory` | 10,000 | 内存中最多事件条数（超出触发背压） |
| `maxReplayEvents` | 5,000 | 单次回放上限（防回放风暴） |
| `archiveAfterHours` | 24h | 超过该时长先归档（JSONL 压缩）再清理 |
| `diskSoftLimitBytes` | 512MB | 软阈值：降采样/暂停低优先级生产 + 告警 |
| `diskHardLimitBytes` | 2GB | 硬阈值：拒绝新事件 + critical 告警（不能把磁盘写满） |
| `maxPayloadBytes` | 64KB | 单事件 payload 上限（校验期拒绝） |
| `unknownEventRetention` | `retain` | 未知/过新事件保留 |

env 覆盖：`DSH_POETRY_EVENT_RETENTION_HOURS`、`_MAX_MEMORY`、`_MAX_REPLAY`、`_ARCHIVE_HOURS`、
`_DISK_SOFT_BYTES`、`_DISK_HARD_BYTES`（非法/空回退默认）。

背压动作（Event Bus 实现时执行）：

1. **soft**：低优先级 Activity 生产降采样/暂停；`health.metrics.events` 显示积压；告警 `event-backlog`；
2. **hard**：拒绝新事件（生产方收到 `EVENT_BACKPRESSURE` 错误并退避），告警 `disk-low`/critical；
3. 保留窗口到期：归档到 `$DSH_HOME/agent-memory/archive/events-<日期>.jsonl.gz`（与 state 备份同盘），
   归档后从内存/热存储清理；归档文件纳入 Gate A4 备份范围（后续接线）。
4. 重放：只读、按 `activity`/`type`/时间范围过滤、上限 `maxReplayEvents`，逐条做版本兼容与幂等检查；
   有外部副作用的事件（发消息、建造、写文件）回放必须 `dry-run` 或人工确认。

## 7. 校验 API（`lib/core/event-schema.mjs`）

| 函数/常量 | 作用 |
|---|---|
| `validateEventEnvelope(raw)` | 校验 envelope，返回 `{ok,event}` / `{ok:false,errors}` |
| `createEventEnvelope(input, {now,random})` | 补默认值（id/at/correlationId/topics）后校验 |
| `generateEventId({now,random,prefix})` | 生成可测的事件 id |
| `buildIdempotencyKey(event, {includeContentHash})` | 幂等键；非法输入返回 `''` |
| `contentHashOf(event, fields)` / `canonicalJson(value)` | 稳定内容哈希（sha256）/键排序序列化 |
| `checkEventVersion(event, consumer)` / `isVersionCompatible` | 版本兼容判定 |
| `parseEventType(type)` / `isReservedNamespace` | 类型/命名空间解析 |
| `EVENT_SCHEMA_LIMITS` / `EVENT_ERROR_CODES` / `EVENT_VERSION_STATUS` | 上限/错误码/状态常量 |
| `EVENT_BACKPRESSURE_DEFAULTS` / `resolveEventBackpressure(env)` | 背压默认值与 env 解析 |
| `UNKNOWN_EVENT_POLICY` / `EVENT_RESERVED_NAMESPACES` | 未知事件策略 / 保留命名空间 |

错误码：`EVENT_INVALID_TYPE`、`EVENT_MISSING_FIELD`、`EVENT_INVALID_VALUE`、`EVENT_INVALID_TYPE_NAME`、
`EVENT_PAYLOAD_NOT_JSON`、`EVENT_PAYLOAD_TOO_LARGE`、`EVENT_TOO_MANY_TOPICS`、`EVENT_DUPLICATE_TOPIC`。

## 8. 与 Task / Activity / health 的关系

- Activity manifest 的 `events` 声明该活动会发的类型（命名空间 = manifest id）；
- Task 生命周期事件约定（Gate B 落地）：`task.queued`、`task.started`、`task.waiting`、`task.blocked`、
  `task.done`、`task.failed`、`task.cancelled`，`subject` = task id，`correlationId` = 发起它的请求链；
- `health.metrics.events` 目前是占位（`available:false`）；Event Bus 实现后填
  `{queued, capacity, dropped, oldestQueuedAt}`，并启用 `event-backlog` 告警。

## 9. 安全与隐私

- `payload` 不得包含模型 key、密码、完整聊天正文之外的非必要内容；事件不离开本机、不上传网络；
- 事件大小受限（≤64KB），避免把大文本/二进制塞进事件；
- 未知/过新事件保留但不执行（不因“看不懂”而误执行）；
- 回放带副作用的操作需人工确认或 dry-run；回放不修改 live 记忆，除非显式确认。

## 10. Gate A7 验收对应

| 验收项 | 对应 |
|---|---|
| 非法/未知版本策略明确 | §3 状态表（retain/skip/drop）+ `checkEventVersion` 测试 |
| 校验函数测试 | `tests/kernel.test.mjs` 的 `event-schema A7` 用例（envelope/幂等键/版本/背压） |
| 文档可供 Event Bus 实现直接使用 | §1–§7（字段、语义、背压默认值、API 签名、错误码） |
