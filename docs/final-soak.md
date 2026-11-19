# 最终稳定性验收（Soak）

日期：2026-11-18
HEAD：`53d0b6c`（最终代码；文档提交在 `f79454f` 之后）
范围：Gate A–H 与 Activation H3–H6 完成后的重复测试、压力、故障注入、备份恢复演练。

## 1. 重复测试

连续 5 次 `npm test`：

| 次数 | 结果 |
|---|---|
| 1–5 | 858/858 pass，0 fail/skip |

`npm run check`：exit 0（213 模块，0 循环、0 分层违规；tsc/biome 通过）。

## 2. 压力基线

模型场景（300 请求 / 40 并发 / 4 槽 / 队列 16 / 排队超时 50ms / 30% 慢 / 5% 挂起），重复 3 次：

```text
rejected: queueFull=280, timeout=6
errors: 0
durationMs: ~93ms
```

结果三次一致；队列满/超时均显式拒绝，没有无限排队。

任务场景（500 任务 / maxRunning 4 / 30ms / 10% 取消），重复 3 次：

```text
completed=461, cancelled=39, failed=0, p95=30ms
```

事件场景（5000 事件 / 容量 500 / 10% 未知类型）：

```text
produced=5000, processed=450, dropped=4500（有界丢弃，符合设计）, peakDepth=500
```

## 3. 故障注入

`node scripts/fault-inject.mjs` 连续 3 次：

- 9/9 场景通过；
- 覆盖：模型超时、空响应、闸门队列满、排队超时、任务取消、租约过期、进程重启、磁盘写失败、未知事件保留；
- 0 errors。

## 4. 备份与恢复演练

- 真实备份：6832 文件 / 115.7MB，`reason=soak-check`；
- 恢复检查（默认只读演练）：exit 0，`ok=true`，`errors=0`；
- 未覆盖 live 数据，未删除旧备份。

## 5. 结论

- 重复测试、压力、故障注入、备份恢复均通过；
- 有界队列/任务租约/事件背压在压力下行为符合预期；
- 代码层验收完成。

## 6. 仍需外部完成的验收

- 重启 DSH + 硬刷新，确认新设置页/路由；
- `DSH_POETRY_HUB=shadow` 与 full + `task.create` 的真实宿主冒烟；
- 真实 provider/游戏/聊天 24h soak（本报告为本地 mock/脚本级）；
- Memory 写入目前只接了 game-memory 双写，journal/methods 未迁移。


## 7. O3/O4 短时验收（补充）

- 3 轮 `load-baseline --scenario all` + `fault-inject`：
  - 任务 100/轮，完成 96、取消 4、失败 0；
  - 事件 500 丢弃（有界，符合容量）；
  - 故障场景 9/9 通过，0 errors；
- 真实 24h soak 未执行；O1 设置页截图因 browser-skill 未连接未执行；O2 需重启加载最新路由后做 live 冒烟。


## 8. 10 轮扩展 soak（补充）

- 10 轮独立 `load-baseline --scenario all` + `fault-inject`：**0 轮异常**（0 errors、故障 9/9）；
- 仍非 24h 连续运行；真实 provider/游戏长稳需单独安排。


## 9. O4 真实 provider 延迟（2026-11-18）

对 `game-world` observe 做 3 次真实模型调用（本地宿主、当前 provider）：

| 样本 | HTTP | 延迟 |
|---|---|---|
| 1 | 200 | 6.47s |
| 2 | 200 | 4.76s |
| 3 | 200 | 4.87s |

均返回合法 `mc_explore` 决策；真实 provider p95 需更多样本/长时间采样，本次仅作冒烟。


## 10. O3 soak 运行器短测（2026-11-19）

`node scripts/soak-24h.mjs --duration-ms 10000 --interval-ms 3000 --out /tmp/o3-short.jsonl --json`：

- 3 轮完成，failures=0，errors=0；
- 每轮 load+fault（fault 9/9）；
- 24h 实跑尚未开始；使用 `docs/soak-runbook.md` 启动。


## 11. 真实 24h soak 已启动（2026-11-19 13:24）

- 命令：`node scripts/soak-24h.mjs --duration-ms 86400000 --interval-ms 300000 --out ~/.dsh/.dsh-poetry/soak-24h.jsonl`
- 后台 job：`bash-1772f2a1d00b48e3`
- 首轮：`round=1 ok=true loadOk=true faultOk=true faultScenarios=9`
- 报告：`~/.dsh/.dsh-poetry/soak-24h.jsonl`
- 24h 结束后检查 summary；中途机器休眠/会话结束可能中断，需 resume。
