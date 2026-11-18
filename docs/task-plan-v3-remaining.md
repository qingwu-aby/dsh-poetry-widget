# 小鲸鱼 v3 剩余任务计划

> 基线：HEAD `6387013`，v0.17.0，**880/880 tests**，Hub 已 full 运行（手动 `task.create`），shadow 事件已通。
> 已完成：Gate A–H + Activation H3–H6 + I1–I4（详见 `docs/acceptance-v2.md`、`docs/live-acceptance.md`）。
> 本文件只列**尚未完成**的任务；用于评审，不自动执行。

## 1. 当前确认的边界

- Hub full 只执行显式 `task.create`；事件→任务自动路由未接。
- Activity 注册表有 chat/minecraft，但都 stopped；full 不会自动启动 World。
- Minecraft 的 Hub adapter 目前是“回执回写”，bot 仍自己执行工具。
- Memory：journal/game-memory/methods 只做**可选双写**；Gateway 写 provider 是内存态，重启丢；未成为唯一写入者。
- EventBus/TaskBoard 持久化默认开启（J4）：`DSH_POETRY_HUB_PERSIST=0` / `settings.persist=false` 可显式关闭；默认重启恢复任务/事件。
- 训练：runner 已注入，但默认关闭；`dataset.available=false`，`evaluatorAvailable=false`，从未真实训练。
- 设置页有模型/Hub/训练/任务控制台，但视觉/点击未验收（browser-skill 未连接）。
- 权限只有 manifest 契约与查询，没有执行级拦截；多会话无隔离。

## 2. 执行状态（2026-11-18）

已完成：

- **J2** Chat 所有权切换 Hub（full 接管，旧路径停用）— `b64f123`
- **J3** Minecraft 任务队列 + bot claim/receipt — `4d9cb56`，live 验证 tb-2 done
- **J4** Hub 持久化默认开启 — `8729516`，live restore 2 tasks
- **J5** Chat 上下文等价 — `3f746f1`，897 tests
- bot 端 Host 任务轮询 — 已改 `bot-play.mjs` / `start-bot.sh`

未完成：
- J1 事件→任务自动路由（目前显式 task.create）
- K/L/M/N/O 全部

下一批执行队列：K1 → K2 → L1 → L2 → L3 → L4 → M1 → M2。

## 2. 剩余任务总表

### J. 闭环：事件 → 任务 → World

| ID | 任务 | 优先级 | 依赖 | 交付/验收 | 风险 |
|---|---|---|---|---|---|
| J1 | Event→Task Router（订阅 EventBus，规则映射事件到任务，幂等/去重/限流） | P0 | — | 事件自动生成 queued 任务；无重复；可 dry-run | 中 |
| J2 | 单一聊天所有权（full 时由 Hub 执行 chat.turn，旧 chat 回复停用，避免双重回复） | P0 | J1 | full 下每条消息只回复一次；可回退 shadow | 高 |
| J3 | Minecraft Task Queue（bot 拉取 Hub 任务、执行 mc_*、回传 receipt，Hub 完成任务） | P0 | J1 | 真实 bot 由 Hub 驱动；断线/超时/取消有回执 | 高 |
| J4 | Hub 生命周期恢复（persist 默认策略、崩溃后任务租约/恢复、事件 replay） | P1 | J1/J3 | 重启不丢任务/事件；重复副作用为 0 | 中 |
| J5 | 全量任务列表与执行归因（已部分做：I3；补执行耗时/失败原因/traceId） | P2 | J3 | 每个任务可追踪到事件/回执/反馈 | 低 |

### K. Memory 收口

| ID | 任务 | 优先级 | 依赖 | 交付/验收 | 风险 |
|---|---|---|---|---|---|
| K1 | 持久化 Memory Gateway provider（文件+Git，替代内存 provider） | P0 | — | 双写记录重启不丢；可查询/回滚 | 中 |
| K2 | 写入迁移审计（列出所有长期记忆写入点，逐个切 Gateway 或标注只读） | P0 | K1 | 写入点清单 100% 覆盖；剩余直写为 0 或有豁免理由 | 中 |
| K3 | 质量/隐私执行层（quality 建议→实际 merge/archive；export/delete 真执行，带 confirm/审计） | P1 | K1 | 用户可导出/删除；冲突可裁决 | 高 |
| K4 | 记忆污染/回归评估（来源可信度、重复检测、错误方法回滚） | P1 | K1/K2 | 错误记忆不会无限放大；有回归样例 | 中 |
| K5 | 记忆浏览器 UI（按 category/activity/时间过滤，编辑/删除） | P2 | K3 | 设置页可浏览/操作记忆 | 低 |

### L. Activity 扩展

| ID | 任务 | 优先级 | 依赖 | 交付/验收 | 风险 |
|---|---|---|---|---|---|
| L1 | Activity SDK（defineActivity、manifest 校验、工具包装、生命周期、版本兼容） | P0 | — | 新 Activity 只实现 SDK 即可注册；契约测试 | 中 |
| L2 | Reading Activity（打开本地书/PDF、翻页、高亮、笔记、卡住事件） | P1 | L1 | 她可读书并留下笔记；fs.read 权限 | 中 |
| L3 | Video Activity（复用 dsh-bili-scroll 或本地视频，观看/摘要/主题事件） | P1 | L1 | 她可刷视频并把主题交给 Study | 中 |
| L4 | Study/Research Activity（问题→来源→假设→实验→方法） | P1 | L1/L2/L3 | 调研结果进 Feedback/Memory；来源可追溯 | 中 |
| L5 | Desktop Activity（CUA，可选/后置） | P2 | L1 | 桌面操作有权限/回执/中断 | 高 |
| L6 | Activity 管理 UI（启停、权限授权、健康、资源用量） | P2 | L1 | 用户可一键停任意活动 | 低 |

### M. 训练旁路

| ID | 任务 | 优先级 | 依赖 | 交付/验收 | 风险 |
|---|---|---|---|---|---|
| M1 | 训练数据集导出（journal/game/methods；清洗/脱敏；JSONL+manifest） | P0 | K1 | `dataset.available=true`，条数/来源可见 | 中 |
| M2 | 评估器（语气/回归/安全三组；candidate 分数） | P0 | M1 | `evaluatorAvailable=true`；不过线不能 promote | 高 |
| M3 | 真实训练演练（一次小 LoRA：run→eval→promote→rollback） | P1 | M2 | 全流程可回滚；日志/产物可查 | 高 |
| M4 | 训练数据治理（同意/许可/保留/导出/删除） | P1 | M1 | 数据可追溯、可删除 | 中 |

### N. 安全/运维/发布

| ID | 任务 | 优先级 | 依赖 | 交付/验收 | 风险 |
|---|---|---|---|---|---|
| N1 | 权限执行与 Activity 沙箱（fs/net/model/tool 实际拦截；进程隔离） | P0 | L1 | 越权工具调用被拒；有攻击测试 | 高 |
| N2 | 多会话隔离（session-scoped task/memory/budget） | P1 | J4 | 两个会话互不抢任务/预算 | 中 |
| N3 | 成本/预算 UI 与告警（按活动配额、软/硬阈值、外发通知） | P1 | — | 用户可设限额；超限可见 | 低 |
| N4 | 运维自动化（log rotate apply、定时备份、恢复演练、告警外发） | P1 | — | 无人值守跑一周不爆盘 | 低 |
| N5 | 发布/升级/回滚（DSH 宿主兼容、插件升级演练、feature flag 文档） | P1 | — | 升级/回滚有 runbook + 彩排 | 中 |

### O. 真实验收

| ID | 任务 | 优先级 | 依赖 | 交付/验收 |
|---|---|---|---|---|
| O1 | 设置页视觉/点击验收（截图、任务/活动/训练按钮） | P0 | — | 浏览器连接后全流程通过 |
| O2 | Full 真实聊天 + Minecraft 冒烟（含取消/失败/恢复） | P0 | J2/J3 | 各 1 次完整闭环 |
| O3 | 真实 24h soak（聊天/游戏/训练旁路并发） | P0 | O2/N4 | 无雪崩、无重复、无丢任务 |
| O4 | 性能基线（真实 provider p95、队列、磁盘、内存） | P1 | O3 | 达到阈值并记录 |

## 3. 推荐批次

```text
批次 1（闭环）：J1 → J2/J3 → O2
批次 2（记忆）：K1 → K2 → K3/K4
批次 3（扩展）：L1 → L2/L3/L4 → L6
批次 4（训练）：M1 → M2 → M3/M4
批次 5（稳态）：N1/N2/N3/N4/N5 → O1/O3/O4
```

批次 1 是最高价值：完成后 Hub 才真正“接管”聊天和 Minecraft，而不只是观测/手动触发。

## 4. 已拍板（2026-11-18）

1. **J2 聊天所有权**：Hub 接管后，原有 chat 回复路径停用，避免双重回复。
2. **J3 Minecraft 驱动**：允许 Hub 任务队列直接驱动 bot 工具。
3. **persist 默认**：`DSH_POETRY_HUB_PERSIST` 默认开启。
4. **训练数据**：聊天/journal 可用于训练，后续补数据治理。
5. **Activity 顺序**：Reading → Study → Video，之后扩展更多场景（包括她自己探索的）。
6. **UI 验收**：browser-skill 连接后再补截图/点击验收（当前未连接）。

## 5. 总体 Definition of Done

- 聊天/游戏事件能自动生成任务，且只执行一次；
- Minecraft 由 Hub 任务队列真实驱动并回执；
- Memory 唯一写入口 + 持久化 + 可导出/删除；
- Reading/Video/Study 至少各有一个真实 Activity；
- 训练数据集/评估器可用，candidate 不自动上线且可回滚；
- 权限执行、多会话隔离、成本/运维告警可用；
- O1–O4 全部通过。
