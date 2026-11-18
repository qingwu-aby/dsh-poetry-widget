# 小鲸鱼 v2（Activity Hub）验收记录

日期：2026-11-18
HEAD：`ba22f78`（Gate A–H 实现 + Activation H3/H4）
范围：按 `docs/task-plan-v2.md` 的 Gate A–H 执行；本轮完成模块、装配、控制面与安全/数据/运维基建。

## 1. 自动验证

| 项 | 结果 |
|---|---|
| `npm test` | **849/849 pass**，0 fail/skip |
| `npm run check` | **exit 0**（212 模块，0 循环、0 分层违规，tsc/biome 通过） |
| `npm run load:baseline -- --json` | exit 0；模型/任务/事件三场景有 p50/p95/拒绝/内存指标 |
| `npm run fault:inject -- --json` | 9/9 场景通过（模型超时/空响应、队列满/超时、任务取消/租约、重启、磁盘失败、未知事件保留） |
| `npm run state:backup -- --dry-run --json` | exit 0；6551 文件 / 约 115.6MB，可备份、可恢复检查 |
| `npm run logs:rotate -- --json` | exit 0；dry-run 不修改日志 |
| 路由 | 40 条（含 Hub/训练/模型策略） |
| 工作区 | clean，origin/main 同步 |

## 2. 已交付能力

### Gate A 地基与安全
- 模型网关：有界队列/排队超时/预算批量写盘；health 指标。
- Task Supervisor：状态机、租约、超时、取消、幂等、并发。
- Activity manifest 权限契约 + 威胁模型/权限文档。
- 状态备份/恢复演练 + 迁移/回滚文档。
- health 结构化指标/告警阈值 + 日志轮转。
- 成本闸门：role/activity 分钟/日限流 + 软告警。
- 事件契约/幂等/版本兼容/背压设计。
- 基线压测 + 故障注入脚本（9 场景）。

### Gate B/C/D/E/F/G/H
- Hub Core：Event Bus、Task Board、Scheduler、Activity Registry、Hub Control API。
- Memory：Gateway、Feedback Ledger、现有记忆只读适配、质量/隐私控制。
- World：Chat/Minecraft Activity 适配器、World Supervisor、Hub 装配。
- Runtime：Hub Runtime（默认 off）、Chat/Minecraft shadow 观测、Memory 只读查询、Hub HTTP API。
- 控制面：模型策略 store/API/设置页、Hub 设置页、训练配置/服务/API（默认关闭）。
- 训练：配置/评估闸门/promote/rollback 骨架，runner 默认不注入。

## 3. 当前运行默认值

- `DSH_POETRY_HUB` 未设置：Hub **off**；仅装配/生命周期，不调度、不执行、不桥接。
- 训练：`training-config.enabled=false`；runner 未注入 → 即使 run 也 `RUNNER_UNAVAILABLE`。
- 模型策略：空配置 = 现有行为；可通过设置页/`model-policy.json` 覆盖。
- 记忆写入：仍走现有路径；Memory Gateway **只读**，未接管写入。
- 现有聊天/游戏/心跳行为未改变。

## 4. Activation 已补（H3/H4）

- Hub full 模式可注入真实 Chat/Minecraft 执行适配器；`task.create` 仅 full 模式允许，默认 off/shadow 不执行。
- 设置页新增训练配置区（查看/编辑配置、二次确认运行/取消/上线/回滚、runner 未注入明确提示）。

## 5. 已知未完成/未验证

1. **Full 模式仍需显式启用并验证**：需重启宿主、`DSH_POETRY_HUB=1`、`task.create` 显式触发；默认不自动运行。
2. **Memory 写入未迁移**：C1 Gateway 写能力/C4 质量建议未接现有写入，仍以只读为主。
3. **训练未接 runner**：配置/UI 已有，但运行时 runner 未注入，run 仍拒绝。
4. **真实宿主未重启验证**：新路由（hub/model-policy/training）与设置页 UI 需要重启 DSH + 硬刷新后才生效；本轮只做代码/测试/脚本验证。
5. **真实 provider/网络/磁盘负载未压测**：load baseline 为 mock，不覆盖真实限流/网络/多实例。
6. **多会话隔离、Activity SDK 沙箱执行、权限强制拦截**仍在契约阶段，未上真实执行。

## 6. 下一步激活清单

1. 重启 DSH + 硬刷新页面，确认设置页「模型与推理」「Hub」两区出现；
2. 设置 `DSH_POETRY_HUB=shadow`，观察 `hub.json`/health 的 shadow 事件与指标；
3. 把 chat/minecraft execute adapter 注入 Hub（feature flag full 前必须完成）；
4. 迁移 Memory 写入到 Gateway（先 memory，再 journal/methods）；
5. 需要训练时：配置 `enabled=true` + 注入 runner + API `confirm:true`，先测评估闸门/回滚；
6. 跑一次真实游戏/聊天冒烟和 24h soak。

## 7. 结论

Gate A–H 的**实现、测试、文档、提交**已完成；系统从“多套独立循环”升级为“可装配的 Hub + Activity + Memory/Feedback + 控制面”骨架，默认保持 off/shadow，零行为变化。  
但要把它变成日常运行形态，还需要完成上述“未完成/未验证”中的真实适配器、记忆写入迁移、训练 runner/UI 与宿主重启验收。
