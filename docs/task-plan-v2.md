# 小鲸鱼 v2 任务计划

> 依据：`docs/architecture-v2.md`、近几轮对模型闸门/任务监管/记忆增长/可观测性的瓶颈分析。
> 原则：先加固地基，再收 Activity；不重写现有 domain；每阶段保持测试和检查绿。

## 0. 当前基线

- 现有架构：kernel / composition / 14 个 domain / client / 独立 Minecraft 进程；
- 测试 586 条，`npm run check` 通过；
- 已有：Minecraft World、工具/回执/打断、文件化 + Git 游戏记忆、插件设置页、token 上限配置；
- 已知瓶颈：模型闸门仅 2 并发且队列无上限、心跳任务无租约/超时、无 Task 抽象、记忆/备份 234M、日志无轮转、无指标。

## 1. 阶段与任务

### Sprint 0：地基加固（必须先做）

| ID | 任务 | 交付物 | 验收 |
|---|---|---|---|
| H1 | 模型网关加固 | 可配置并发、队列上限、排队超时、按角色预算、异步批量预算写盘 | 慢调用不会无界堆积；队列满时明确拒绝；`health` 可见队列深度 |
| H2 | 任务监管骨架 | Task 租约、心跳、超时、取消、幂等键 | 长任务可被强制结束；重启不重复执行 |
| H3 | 可观测性 | traceId、任务/模型/事件指标、日志轮转、成本统计 | 一次任务可串起事件→模型→工具→回执 |
| H4 | 记忆与日志治理 | journal/backups 保留策略、归档、索引；日志大小上限 | 234M 可降到可控范围；检索不随历史线性变慢 |
| H5 | 基线压测 | 并发/长任务/模型故障/重启测试脚本 | 形成基线报告，后续每阶段对比 |

**依赖**：H1/H2 可并行；H3/H4 与 H1/H2 并行；H5 最后。

### Sprint 1：Hub Core

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| C1 | Event Bus | 命名空间、只追加、订阅、回放、保留窗口 | H3 |
| C2 | Task Board | 状态机、优先级、成功标准、等待/阻塞、幂等 | H2 |
| C3 | Scheduler | 单前台、后台低优先级、抢占/恢复、预算 | C1, C2 |
| C4 | Activity Registry | manifest、启停、健康、权限、资源声明 | C1 |
| C5 | Control API | tasks/activities/events 只读与控制端点 | C2, C3 |

**验收**：同一时刻只有一个前台 Task；暂停/恢复/打断可用；事件可回放。

### Sprint 2：Memory / Feedback

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| M1 | Memory Gateway | 唯一读写入口；事件/情景/语义/方法/愿景 | C1 |
| M2 | Feedback Ledger | 假设→实验→回执→结论→方法 | M1 |
| M3 | 先接只读 | journal / game-memory / methods 只读接入 | M1 |
| M4 | 再切写入 | 各域写入逐步改走 Gateway；保留旧接口兼容 | M3 |

**验收**：所有 Task 结束有 feedback；长期记忆无直接旁路写入。

### Sprint 3：World 迁移

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| W1 | Chat World | 消息事件、回复工具、抢占、回执 | C3, M1 |
| W2 | Minecraft World | `game-world` 收进 Hub，工具/回执/中断统一 | C3, M1 |
| W3 | World 隔离 | 独立进程/健康/崩溃重启；互不直接依赖 | C4 |
| W4 | 验证器 | 每个工具回执可验证事实；失败进 Feedback | M2 |

**验收**：杀掉 Minecraft 不影响聊天；反之亦然。

### Sprint 4：新 Activity

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| A1 | Reading | 打开/翻页/高亮/笔记/卡住事件 | W1-W3 |
| A2 | Video | 观看/摘要/主题事件；可复用 dsh-bili-scroll | W1-W3 |
| A3 | Study/Research | 问题→资料→假设→验证→方法 | A1/A2 |
| A4 | Activity SDK | `defineActivity`、manifest 校验、设置页活动管理 | C4 |

**验收**：新 Activity 只注册 manifest 即可出现，不改 Hub 核心。

### Sprint 5：控制面

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| U1 | 模型/推理面板 | provider/model、角色 effort、token、fallback、测试连接 | C5 |
| U2 | Task 控制台 | 当前/排队/暂停/恢复/最近回执 | C5 |
| U3 | 记忆浏览器 | 查看/编辑/导出/重建索引 | M1 |
| U4 | CLI/API | tasks/models/activities/memory/training | C5, M1 |

### Sprint 6：训练旁路

| ID | 任务 | 交付物 | 依赖 |
|---|---|---|---|
| T1 | 数据集导出 | 按活动/主题/时间导出；清洗/脱敏 | M1 |
| T2 | 训练配置 | 基座/adapter、rank/steps/lr、确认、预算、取消 | U1 |
| T3 | 评估闸门 | 语气/回归/安全评估；candidate 不直接上线 | T2 |
| T4 | Promote/Rollback | candidate→live、回滚、状态页 | T3 |

**原则**：训练不阻塞在线 Task；不直接写长期记忆；默认关闭。

### Sprint 7：清理与验收

| ID | 任务 | 交付物 |
|---|---|---|
| F1 | 删除重复循环/入口 | 旧心跳 job、旧设置入口、重复模型调用 |
| F2 | 全量测试 | 单测 + 契约 + 真实浏览器/游戏冒烟 |
| F3 | 鲁棒性验收 | 并发、中断、重启、模型故障、训练旁路 |
| F4 | 文档 | 架构、权限、运维、升级说明 |

## 2. 并行与依赖

```text
H1 ─┐
H2 ─┼─→ C1 ─→ C2 ─→ C3 ─→ W1/W2 ─→ A1/A2/A3
H3 ─┤        └─→ C4 ─────────────┘
H4 ─┘
H5 ─────────────────────────────────→ F3

M1 ─→ M2 ─→ M3 ─→ M4 ─→ A1/A2/A3
C5 ─→ U1/U2/U3/U4
T1/T2/T3/T4 依赖 M1/U1，始终旁路
```

可并行：H1/H2/H3/H4；M1-M4 与 C1-C4 并行；A1/A2 与 U1/U2 并行。

## 3. 不建议现在做

- 不重写 2.9 万行 domain；
- 不把每个 domain 都改造成 Activity；
- 不用本地模型训练来替代规划/工具校验；
- 不做无上限并发的 Activity；
- 不在训练管线未隔离前开放自动训练。

## 4. Definition of Done

- 单前台 Task、单模型调用，队列有界；
- 所有工具调用有回执，所有 Task 有 feedback；
- 活动间 0 直接依赖，崩溃可隔离；
- 记忆唯一写入口，可审计/可回滚；
- 模型/训练/任务/记忆有用户可改的界面或 API；
- 压测、故障注入、重启恢复通过。
