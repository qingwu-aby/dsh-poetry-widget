# 小鲸鱼整体架构 v2（Activity Hub）

> 状态：设计稿。目标不是重写现有 2.9 万行 domain，而是加一层薄 Hub，把能力逐步收成 Activity + Task + Memory/Feedback 管线。

## 1. 当前架构（基线）

```text
DSH Host
└─ index.js
   └─ lib/composition/plugin-runtime.mjs
      ├─ lib/kernel/          12 文件：模型调用/策略、配置、状态、错误账本
      ├─ lib/composition/     29 文件：装配、路由、心跳、生命周期
      ├─ lib/domain/          14 领域 / 143 文件 / 约 2.9 万行
      │  being chat emotion host integration knowledge learning
      │  life memory play relationship twin voice works
      ├─ client-src/          挂件 + 插件设置页
      └─ external
         └─ ~/minecraft-bot/  Minecraft 进程、World 循环、建造器、服务器

现有入口：
  用户 ── chat-service ── chatBridge ── 模型 ── 回复
  心跳 ── 十几个 job ── 各服务 ── 各模型/状态
  游戏 ── game-world.json ── World 模型 ── 工具/回执
  设置 ── HTTP ── settings / minecraft-control
```

## 2. 目标架构：一个 Hub + 多条旁路

```text
DSH Host
└─ Plugin (index.js)
   └─ Activity Hub
      ├─ Event Bus          统一事件、只追加、可回放、命名空间
      ├─ Task Board         目标/状态/优先级/成功标准/预算
      ├─ Scheduler          单前台 + 后台低优先级 + 抢占/让位/恢复
      ├─ Activity Registry  活动注册、启停、健康、权限、manifest
      ├─ Model Gateway      角色模型、reasoning、token、预算、重试
      ├─ Memory Gateway     唯一读写入口：事件/情景/语义/方法/愿景
      ├─ Feedback Ledger    假设 → 实验 → 回执 → 结论 → 方法
      └─ Capabilities       emotion/learning/voice/relationship/...
            │
   ┌────────┴────────┬──────────────┬──────────────┐
   ↓                 ↓              ↓              ↓
 Chat World     Minecraft World  Reading World   Video World
 (对话)          (外部进程)        (书/PDF)        (B站等)
   ↓                 ↓              ↓              ↓
   └────────── 统一事件、任务、记忆、反馈 ──────────┘
                        │
   ┌────────────────────┴─────────────────────┐
   ↓                                          ↓
 对外控制面                                 旁路管线
 - 挂件气泡                                 - 反馈/反思
 - 插件设置页（模型/训练/活动）               - 训练/评估
 - Task 控制台                               - 记忆整理
 - 本地 HTTP API / CLI                       - 可观测性
```

### 主决策管线

```text
User / Heartbeat / World Event
        ↓
   Event Bus（规范化、命名空间）
        ↓
   Task Board（创建/排队/更新）
        ↓
   Scheduler（选中唯一前台 Task）
        ↓
   Memory Gateway（读当前任务相关记忆）
        ↓
   Persona 上下文 + Model Gateway（一次决策）
        ↓
   World Adapter（执行工具）
        ↓
   Receipt Verifier（可验证事实）
        ↓
   Feedback Ledger + Memory Gateway（写回）
        ↓
   Event Bus（产生后续事件）
```

### 四条旁路

| 旁路 | 触发 | 绝不做的 |
|---|---|---|
| 反馈/反思 | 失败、回执、空闲 | 阻塞前台 Task |
| 训练/评估 | 用户手动/周期 | 直接写在线 Memory/模型 |
| 记忆整理 | 夜间/积压 | 改 Event Log |
| 可观测性 | 始终 | 影响任务结果 |

## 3. 边界规则

1. **Activity 独立**：有自己的进程/状态/配置/权限/健康检查，互相不能直接调用。
2. **Hub 唯一**：事件、任务、调度、模型、记忆、权限都只有一套。
3. **World 只提供语义工具**：不暴露内部状态，不依赖 Persona 实现。
4. **Memory 唯一写入者**：各域/Activity 不直接写长期记忆。
5. **Receipt 必须可验证**：不能只写“成功”。
6. **一个前台 Task**：后台 Task 只在空闲/低优先级运行。
7. **训练离线**：产物先进 candidate，评估通过再 promote，可回滚。

## 4. Task 协议

```js
{
  id, kind, activity, world,
  goal, status, priority,
  plan: { steps, currentStep },
  observations, receipts,
  successCriteria,
  memoryRefs,
  budget: { modelCalls, tokens, timeMs },
  interrupt: { allowed, reason },
  feedback: { hypothesis, experiment, outcome },
  createdAt, updatedAt
}
```

生命周期：

```text
queued → running → waiting/blocked → done/failed
        ↘ 被用户/语音/更高优先级抢占 → waiting → 恢复
```

## 5. Activity manifest

```js
{
  id: 'reading',
  version: '1.0.0',
  name: '读书',
  world: { entry: './world.mjs', isolate: 'process', health: 'reading.health' },
  events: ['reading.started', 'reading.highlight', 'reading.finished'],
  tasks: [{ kind: 'reading.read', goal: '读一章并留下笔记', priority: 30, success: '章节完成 + 笔记' }],
  tools: ['book.open', 'book.page', 'book.highlight', 'book.note'],
  prompt: './ENV_PROMPT.md',
  permissions: ['fs.read:~/Books'],
  resources: { model: true, foreground: false, maxMinutes: 60 }
}
```

## 6. 任务划分（Work Packages）

| WP | 任务 | 交付物 | 依赖 | 可并行 |
|---|---|---|---|---|
| WP0 | 架构契约与盘点 | 本文档、接口契约、现有能力映射 | - | 否 |
| WP1 | Hub Core | Event Bus、Task Board、Scheduler、Activity Registry | WP0 | 否 |
| WP2 | Model Gateway | 角色模型/reasoning/token/预算统一入口 + 模型设置页/API | WP0 | 与 WP3 |
| WP3 | Memory/Feedback | Memory Gateway、Feedback Ledger、事件→情景→方法/愿景 | WP0 | 与 WP2 |
| WP4 | Chat/Minecraft World | 把现有 chat、game-world 收成 Activity/World，回执/中断统一 | WP1, WP2, WP3 | 否 |
| WP5 | Reading/Video/Study Activities | 活动 manifest、事件、工具、任务；复用 dsh-bili-scroll 思路 | WP4 | 可并行 |
| WP6 | 控制面 | 设置页模型/活动/Task 控制台、记忆浏览、CLI/API | WP2, WP3 | 与 WP5 |
| WP7 | 训练/评估旁路 | 数据集导出、LoRA、评估闸门、promote/rollback | WP3, WP6 | 否 |
| WP8 | 迁移清理 | 删除重复循环/入口、全量测试、真实冒烟 | WP4-WP7 | 否 |

### WP 详细任务

**WP1 Hub Core**
- `event-bus.mjs`：append-only、命名空间、订阅、回放；
- `task-board.mjs`：CRUD、状态机、优先级、waiting；
- `scheduler.mjs`：单前台、抢占、恢复、预算；
- `activity-registry.mjs`：manifest 注册/启停/健康；
- 测试：事件顺序、任务抢占、单模型调用。

**WP2 Model Gateway**
- 统一 `call(role, prompt, options)`；
- provider/model/reasoning/token/预算/fallback；
- UI：角色覆盖、当前模型、测试连接；
- 优先级：UI > env > host selection > fallback。

**WP3 Memory/Feedback**
- `memory-gateway.mjs`：read/write/query，文件+Git；
- `feedback-ledger.mjs`：假设/实验/回执/结论；
- 迁移 `journal`、`game-memory`、`methods` 先接只读，再切写；
- 测试：任何 Task 结束有 feedback。

**WP4 Chat/Minecraft**
- Chat Activity：消息事件、回复工具、抢占；
- Minecraft Activity：`game-world` 迁入 Hub，工具/回执/打断；
- 验收：断掉 Minecraft 不影响聊天，反之亦然。

**WP5 新活动**
- Reading：打开/翻页/高亮/笔记/卡住；
- Video：观看/摘要/主题；可参考 dsh-bili-scroll；
- Study：问题→调研→假设→方法；
- 它们只发事件/建 Task，不直接调 Minecraft。

**WP6 控制面**
- 设置页：模型、活动启停、Task 控制台、记忆浏览；
- API：tasks/models/activities/training/memory；
- CLI：tasks/model/train/memory。

**WP7 训练旁路**
- 数据集导出（按活动/主题/时间）；
- LoRA/本地 adapter；
- 评估闸门（语气/回归/安全）；
- candidate → live / rollback；
- 训练任务必须确认、预算、可取消。

## 7. 迁移顺序

```text
WP0 → WP1 → WP2/WP3 并行 → WP4 → WP5/WP6 并行 → WP7 → WP8
```

原则：**先包住现有行为，再迁 World，最后做新活动/训练**；每一阶段保持 `npm test` + `npm run check` 绿，不一次性替换。

## 8. 验收指标

- 同一时刻只有一个前台 Task，一个模型调用；
- 所有工具调用有 receipt，所有 Task 结束有 feedback；
- 所有长期记忆写入经过 Memory Gateway；
- Activity 之间 0 直接依赖；
- 杀掉任意 Activity 不影响 Hub 和其他 Activity；
- 新 Activity 只注册 manifest 即可出现，不改 Hub 核心；
- 训练旁路不影响在线 Task，且可回滚。

