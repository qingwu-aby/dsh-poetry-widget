# 持久化状态文件清点（W0 基线，2026-11-09）

> 目标：所有状态文件进入「注册表 + schema + 迁移 + 备份」体系（见 docs/refactor-plan.md W1）。
> 当前状态：**多数文件各自 readFileSync/JSON.parse、无统一版本号**；本表是迁移基线。

## A. 插件设置目录 `~/.dsh/.dsh-poetry/`

| 文件 | 写入模块 | 版本/规范化 | 备注 |
|---|---|---|---|
| settings.json | settings-store | schemaVersion | 插件设置 |
| self-state.json | self-state/self-being | — | 自身状态（felt/experiencing） |
| self-actions.json | self-actions | — | 动作历史 |
| self-events.json | self-events | — | 事件流 |
| self-lifecycle.json | self-lifecycle | — | 睡眠/清醒周期 |
| self-metabolism.json | self-metabolism | — | 代谢/饥饿 |
| self-projects.json | self-projects | — | 项目账本 |
| self-curriculum.json | self-curriculum | — | 课程/阶段 |
| attention.json | attention | — | 待回应事项 |
| experience.json | experience | — | 经历账本 |
| feelings.json | feelings | v/feelings | 自造感受词 |
| world-feedback.json | world-feedback | — | 行动反馈 |
| worldview.json | worldview | v/history | 世界观；**曾发生字段漂移事故** |
| methodology.json | index 内联 / 方法规则 | rules/antiPatterns | 方法规则本 |
| probe-state.json | self-growth | — | 试探状态 |
| knowledge-graph.json | knowledge-graph | v | 认知图谱（上限 20000/40000/8000） |
| knowledge-graph-state.json | knowledge-extract | v | 抽取进度 |
| knowledge-graph-debug.json | knowledge-extract | — | 解析失败原始输出（排查用，可删） |
| relationship.json | relationship-memory | v/entries | 关系记忆 |
| emotional-state.json | emotional-continuity | v/threads | 情绪线程 |
| commitments.json | commitments | v/entries | 承诺账本 |
| habits.json | habit-memory | v | 情境→动作→结果的习惯记忆（v3.11） |
| methods.json | method-memory | v | 方法论账本（读哲学抽出的分析方法，v3.12） |
| philosophy-state.json | self-philosophy | v | 哲学阅读进度/书目缓存（v3.12） |
| positions.json | thought-chain | v | 自己的判断账本（接受/反对/存疑 + 理由，v3.13） |
| thought-chains.jsonl | thought-chain | — | 思维链（问题→前提→正反→判断→检验，v3.13） |
| moral-state.json | moral-practice | v | 道德实践状态（内疚去重/已回访链，v3.14） |
| chain-reviews.jsonl | moral-practice | — | 思维链后果回访记录（v3.14） |
| internal-rules.json | internal-rules | v | 内生规则（经验总结 + 置信度，v3.15） |
| affect-state.json | affect-homeostasis | v | 底层效价/唤醒状态（事件累加 + 身体基线，v3.15） |
| action-policy.json | action-policy | v | 动作策略权重（情境→动作→结果，v3.16） |
| appraisal-state.json | appraisal | v | 情绪评价游标（v3.11） |
| nightly-consolidation.json | nightly-consolidation | v | 夜间巩固报告（学习汇总/合并/冲突，v3.10） |
| nightly-consolidation-state.json | nightly-consolidation | v | 夜间巩固当天已跑标记（v3.10） |
| daily-life.jsonl | daily-life | — | 日常素材（追加写） |
| chat-history.json | chat-bridge | — | 对话历史（按 peerId） |
| chat-token.json | chat-media | — | 聊天令牌 |
| gui-inbox.json | gui-inbox | — | 待推送消息 |
| gui-push-state.json | gui-push | v/last | 推送状态 |
| outbox.json | outbox | — | 出站消息 |
| proactive-chat-state.json | proactive-chat | — | 主动消息冷却 |
| model-budget.json | model-budget | — | 模型预算 |
| media-budget.json | media-budget | — | 媒体生成预算 |
| model-errors.jsonl | model-errors | — | 模型失败日志（追加） |
| web-bench.json | web-bench | v | 真实网页任务成绩 |
| twin-bridge/* | twin-system | — | 镜像通信：letters.jsonl / read-*.json / session.json |

## B. 记忆目录 `~/.dsh/agent-memory/`

| 文件 | 写入模块 | 版本/规范化 | 备注 |
|---|---|---|---|
| journal.jsonl | memory-journal | — | 全部记忆事件（追加） |
| topics.json | self-talk-topics | — | 碎碎念话题 |
| topics-archive.jsonl | self-talk-topics | — | 话题冷存储 |
| topics-candidates.json | self-growth | — | 候选话题 |
| feelings.json | feelings | v/feelings | 与设置目录同名文件（待确认唯一来源） |
| layers.json | memory-layers | — | 分层记忆概括 |
| projects.json | self-projects | — | 项目（与 self-projects.json 关系待确认） |
| voice.json | voice-memory | — | 声音档案（手工改过，备份在 voice.json.bak-*） |
| works/works.json + work-*.svg/.md | self-works | — | 作品索引与文件 |
| video-courses/ | manual-reading/bookshelf | — | 书架资料（只读） |

## C. 插件目录之外

| 路径 | 写入模块 | 备注 |
|---|---|---|
| `~/Library/Application Support/dsh-whale-mlx/self-train/state.json` | self-train.mjs | 自训练进度 |
| `~/Library/Application Support/dsh-whale-mlx/self-train/scheduler.json` | self-trainer | 周排期 |
| `~/Library/Application Support/dsh-whale-mlx/self-train/report.md` | self-train.mjs | 训练报告 |
| `~/Library/Application Support/dsh-whale-mlx/agent-loop/state/` | agent-loop-runner | 常驻会话状态 |
| `dsh-agent-loop/` workspace `agent-loop/` | 常驻巡检 | ledger / queue / logs |

## D. 迁移原则

1. 每个文件进入 `kernel/json-store` + `state-schema` 注册表：`{ file, version, normalize, migrate, backup }`；
2. 读取失败/损坏 → 返回 fallback 并记 warn（不再静默空对象）；
3. 写入前统一 `writeJsonAtomic`（临时文件 + rename），迁移前 `.bak-<ts>`；
4. jsonl 追加型（journal/daily-life/model-errors/letters）保持追加，不做整体重写；备份按大小轮转；
5. 迁移执行方式：启动后 60s dry-run 日志 → 默认执行（可用 `DSH_POETRY_MIGRATE=off` 关闭）。
