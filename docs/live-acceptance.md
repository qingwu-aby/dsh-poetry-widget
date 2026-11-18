# 真实宿主验收记录（重启后）

日期：2026-11-18
GUI：`http://127.0.0.1:49259`
HEAD：`834c36b`（重启后复验；含 shadow live 验证）

## 1. 路由与状态

| 检查 | 结果 |
|---|---|
| `GET /api/dsh-poetry/hub.json` | 200；`available=true`、`assembled=true`、`mode=off` |
| Hub 图 | EventBus/TaskBoard/Scheduler/Registry/Memory/Feedback/WorldSupervisor 全部 available |
| Activity | chat、minecraft 已注册，均 stopped（expected off） |
| 任务 | total 0、running 0 |
| Memory | providers journal/game-memory/method-memory，`write=false`（只读），查询可用 |
| `GET /model-policy.json` | 200；当前生效 `dsh-opencode-go` / `deepseek-v4.1-flash`，来源 default-chain |
| `GET /training.json` | 200；enabled=false、phase=idle、runnerAvailable=true |
| 设置页 Slot | `settings.section` 中 `dsh-little-whale` active，order 30 |

## 2. 负向验收

| 操作 | 结果 |
|---|---|
| Hub off 时 `task.create` | `HUB_FULL_REQUIRED`，未创建任务 |
| 训练默认关闭时 `run` | `TRAINING_DISABLED`，未训练 |
| `memory.query` | 只读查询成功，返回 game-memory 结果 |

## 3. 发现并修复

- `PUT /model-policy.json {reset:true}` 返回了 provider/model 的误报错误（空配置把 null 当非法）。已修复 `normalizeModelPolicy` 接受 null，提交 `f202b86`；宿主重启后生效。

## 3.1 重启后复验（2026-11-18）

- Hub：`available=true/assembled=true/mode=off`，activity chat/minecraft 已注册 stopped；
- Memory：journal/game-memory/method-memory 只读 provider，`write=false`；
- `PUT /model-policy.json {reset:true}`：`ok=true`、`reports=[]`（reset 误报已修复并 live 验证）；
- `GET /training.json`：enabled=false、phase=idle、runnerAvailable=true；
- 设置页 Slot：dsh-little-whale active（order 30）；
- Hub off 时 `task.create` 仍正确拒绝 `HUB_FULL_REQUIRED`。

## 3.2 Shadow live 验证（2026-11-18）

- 启动环境：`DSH_POETRY_HUB=shadow`（launchctl setenv + 重启继承）；
- `hub.json`：`mode="shadow"`、`featureFlag.enabled=true`、`shadow=true`、`source=env`；
- EventBus live：`stored=7`、`published=7`、`duplicates=0`、`rejected=0`；
- 通过 `/api/dsh-poetry/chat.json` 发送一次 `shadow-smoke` 消息，回复正常（focus game 时 deferred），shadow 事件进入 EventBus；
- Activity chat/minecraft 仍 `enabled=false/stopped`（shadow 不启动真实 World，符合设计）；
- Memory 仍只读；训练仍关闭。
- 注意：`shadowEventCount=0` 是因为已有 EventBus 时事件走总线，本地 shadow 环不再累积；EventBus metrics 才是正确证据。

## 3.3 Full live 验证（2026-11-18）

- 启动环境：`DSH_POETRY_HUB=1`，`hub.json`：`mode="full"`、`featureFlag.enabled=true/shadow=false/source=env`；
- adapters: `['chat', 'minecraft']`；活动注册表仍 stopped（full 不自动启动 World，符合当前实现）；
- 通过 `POST hub.json {action:'task.create', kind:'chat.turn', idempotencyKey:'full-smoke-chat-1'}` 触发真实 Chat 任务：
  - task `tb-1` created → running → done；
  - receipt `ok=true`，replyId `hub-chat-full-smoke-1`，回复正常；
  - feedback `records=1/successes=1`；
  - EventBus `published=5`、duplicates=0、rejected=0。

## 3.4 Activation I1–I4（2026-11-18）

- I1/J4 Hub 持久化：TaskBoard 快照 + EventBus JSONL 默认开启（`$DSH_HOME/.dsh-poetry/hub-taskboard.json`、`hub-events.jsonl`）；
  `DSH_POETRY_HUB_PERSIST=0` 或 `settings.persist=false` 可显式关闭（关闭后零写盘）；
- I2 设置页 Hub 控制台：任务列表暂停/恢复/取消、活动启停、记忆查询；
- I3 全量任务列表：GET tasks.list（最多 100 条），UI 优先 list、回退 recentEvents；
- I4 journal/methods 写入桥：默认旧路径，`memoryWrite` 开启后旁路写 Memory Gateway。
- 当前测试 880/880。

## 4. 未验证

- 浏览器扩展未连接（browser-skill 报 no browser connected），无法截图/点击验证设置页「模型与推理/Hub/训练」的实际渲染；
- Hub shadow/full 需要以 `DSH_POETRY_HUB=shadow/1` 重启后才能做真实事件/任务冒烟；
- `/health.json` 需要 DSH trust fence，curl token 不适用（UI 内正常）。

## 5. 下一步

1. 若要截图/点击验收：打开 browser-skill 扩展并保持连接；
2. `DSH_POETRY_HUB=shadow` 重启，确认 hub.json 有 shadow 事件；
3. full 模式用 `task.create` 触发一次 smoke；
4. model-policy reset 修复重启后复验；
5. 最后跑真实聊天/游戏冒烟与 soak。
