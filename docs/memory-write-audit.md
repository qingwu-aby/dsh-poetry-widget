# 长期记忆写入审计（Gate K2）

> 目的：为 Memory Gateway 迁移建立可核对清单。登记表在 `lib/core/memory-write-registry.mjs`，
> 本文件由登记表内容整理；**本审计不改任何现有写入行为**。
>
> 阶段定义：
> - **E0 已接 Gateway**：写入直接经 Memory Gateway（当前 0 项）。
> - **E1 双写桥**：旧文件/Git 写入不变，成功后经 onRecord → Hub `recordJournal`/`recordMemory`/`recordMethod`
>   旁路写入 Gateway（受 `memoryWrite` flag 控制，默认关闭）。
> - **E2 未接（直写）**：仍只写本地文件，尚未接 Gateway（迁移候选）。

## 概览

| 阶段 | 数量 | 说明 |
|---|---|---|
| E0 已接 Gateway | 0 | 暂无；本批只做双写桥 |
| E1 双写桥 | 3 | journal / game-memory / methods |
| E2 未接（直写） | 17 | 见下表；按优先级迁移 |

覆盖校验：`assertMemoryWriteCoverage()` 要求至少登记 **journal / game-memory / methods**，且阶段字段一致
（E1 必须 dualWrite+gateway；E2 必须非双写）。`npm test` 中有对应测试。

## 写入点清单

| id | owner | 模块 | 存储/文件 | 写入函数 | 主要调用方 | Gateway | 双写 | 阶段 | 优先级 | 风险 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| journal | memory | memory-journal.mjs | journal.md + journal.jsonl（append） | append | mood/murmur/thought 服务 | ✅ | ✅ | E1 | 1 | low | onRecord → hub-runtime.recordJournal；flag 关闭 no-op |
| game-memory | play | game-memory-workspace.mjs | game-memory/*.md + PARTNER_GAME.md（git） | record | minecraft/game 服务、world-feedback | ✅ | ✅ | E1 | 1 | low | H5 onRecord → hub-runtime.recordMemory |
| methods | learning | method-memory.mjs | methods.json（atomic） | record | 学习/后果回访服务 | ✅ | ✅ | E1 | 1 | low | I4 onRecord → hub-runtime.recordMethod |
| memory-layers | memory | memory-layers.mjs | memory-layers.json（atomic） | layers.write | memory-consolidator | ❌ | ❌ | E2 | 2 | medium | 整合结果；可接 semantic/reflection |
| memory-baseline | memory | memory-baseline.mjs | memory-baseline.md | writeBaseline | 启动/基线重建 | ❌ | ❌ | E2 | 3 | low | 人读快照，迁移价值低 |
| relationship | relationship | relationship-memory.mjs | relationship.json（atomic） | ingest | chat-service 回复后 ingest | ❌ | ❌ | E2 | 1 | high | 建议下一个接 Gateway（category=relationship） |
| commitments | relationship | commitments.mjs | commitments.json（atomic） | addAgreement | chat-service ingest 后 | ❌ | ❌ | E2 | 2 | medium | 可随 relationship 迁移 |
| emotional-episodes | emotion | emotional-episodes.mjs | emotional-episodes.json（atomic） | record | chat 情绪线程 | ❌ | ❌ | E2 | 2 | medium | 建议接 reflection |
| emotional-continuity | emotion | emotional-continuity.mjs | emotional-continuity.json（atomic） | recordFromChat | chat-service | ❌ | ❌ | E2 | 2 | medium | 与 episodes 合并迁移 |
| knowledge-graph | knowledge | knowledge-graph.mjs | knowledge-graph.json（atomic） | ingest | knowledge-extract、chat 提示 | ❌ | ❌ | E2 | 1 | high | 长期记忆主库，建议优先接 semantic |
| self-events | being | self-events.mjs | self-events.json（atomic） | record | 心跳/事件循环 | ❌ | ❌ | E2 | 3 | low | 运行事件日志，迁移价值低 |
| self-state | being | self-state.mjs | self-state.json（atomic） | save | 心跳/状态服务 | ❌ | ❌ | E2 | 3 | medium | 状态快照非记忆语义，保持直写 |
| habit-memory | being | habit-memory.mjs | habits.json（atomic） | record | 日常/习惯服务 | ❌ | ❌ | E2 | 2 | medium | 可接 preference |
| internal-rules | being | internal-rules.mjs | internal-rules.json（atomic） | record | 规则合成/chat 提示 | ❌ | ❌ | E2 | 2 | medium | 可接 preference |
| thought-chain | learning | thought-chain.mjs | thought-chain/*.md + positions.json | append | 碎碎念/思考链服务 | ❌ | ❌ | E2 | 2 | medium | 与 journal 同类，可复用 journal 桥 |
| worldview | learning | worldview.mjs | worldview.json（atomic） | save | 世界观/自省服务 | ❌ | ❌ | E2 | 2 | medium | 可接 reflection |
| self-philosophy | learning | self-philosophy.mjs | self-philosophy.md（append） | append | 哲学/自省链路 | ❌ | ❌ | E2 | 2 | medium | 可复用 journal 桥 |
| daily-life | life | daily-life.mjs | daily-life.jsonl（append） | record | 日常/心情链路 | ❌ | ❌ | E2 | 2 | medium | JSONL append，可复用 file provider 思路 |
| voice-memory | voice | voice-memory.mjs | voice-memory.json（atomic） | save | 语音记忆服务 | ❌ | ❌ | E2 | 3 | low | 资产索引，迁移价值低 |
| game-memory-legacy | play | game-memory.mjs | game-memory.json（atomic+rename） | save | legacy 迁移路径 | ❌ | ❌ | E2 | 3 | low | 已被 workspace 取代，保持兼容 |

> 说明：`memory-consolidator` 本身不直写记忆，经 `memory-layers` 落盘；`memory-hub` 只读聚合；
> `memory-migrations` 负责旧文件迁移，不新增长期写入。

## 下一步建议（迁移优先级）

1. **P1（高风险/核心）**：`relationship`、`knowledge-graph` —— 先加 onRecord 桥（复用 H5/I4 模式），
   category 分别映射 relationship / semantic。
2. **P2（表达/情绪/偏好）**：`thought-chain`、`self-philosophy`、`daily-life`（可复用 journal 桥）；
   `emotional-episodes`、`emotional-continuity`、`habit-memory`、`internal-rules`、`worldview`、
   `memory-layers`（各域 onRecord → Gateway）。
3. **P3（低价值）**：`memory-baseline`、`self-events`、`self-state`、`voice-memory`、`game-memory-legacy`
   保持直写或只读镜像，不强行迁移。

迁移每接一个域都要满足：默认 flag 关闭零行为变化；旧写入/文件格式不变；onRecord 失败隔离；
开启后 Gateway 可查询；`memory-write-registry.mjs` 中把该条 `phase` 从 `E2` 改为 `E1` 并更新本表。

## 如何验证

```bash
npm test   # 含 memory-write-registry 校验/覆盖测试
npm run check
```

```js
import { assertMemoryWriteCoverage, memoryWriteAuditSnapshot } from './lib/core/memory-write-registry.mjs'
assertMemoryWriteCoverage().ok        // 关键写入点已登记且字段一致
memoryWriteAuditSnapshot()            // {total, byPhase, dualWrite, directWrite, coverage}
```
