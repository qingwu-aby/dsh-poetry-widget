# 架构（2026-11-09，重构中）

## 分层

```
index.js（插件入口：38 行，只做 bootstrap + host.inject）
├─ lib/composition/     组装层（新）
│   ├─ base-services.mjs       基础服务（journal/projects/events/feedback/lifecycle）
│   ├─ knowledge-services.mjs  知识/关系/情绪服务
│   ├─ model-call 相关         （待抽 model-services.mjs）
│   ├─ health.mjs              health 快照组装
│   ├─ chat-service.mjs        聊天 HTTP 服务（OCR/提示摘要/本地声音）
│   ├─ readonly-routes.mjs     只读/静态路由
│   ├─ interactive-routes.mjs  twin/manual-read/attention/project 路由
│   ├─ state-specs.mjs         状态文件 schema 注册
│   └─ lifecycle.mjs           清理函数统一释放
├─ lib/domain/<name>/   域（memory/emotion/relationship/knowledge 已内迁；其余 facade re-export）
│   memory emotion relationship learning knowledge chat works being voice twin life host integration
├─ lib/kernel/          基础设施（新）
│   json-store  state-schema  model-call  config  logger  service
├─ lib/legacy/          旧路径兼容 shim（72 个，只做 export *；新代码不要引用）
└─ lib/*.mjs            未归域的共享实现（settings-store/paths/llm-call 等）
```

## 依赖规则（scripts/check-deps.mjs 强制）

1. 禁止循环依赖；
2. `kernel/*` 不得依赖 `domain/*`、`composition/*`、`index.js`；
3. `domain` 之间允许直接依赖具体模块（必须无循环），优先走对方 `index.mjs` facade；不得依赖 `lib/legacy/` 或 lib 根模块；
4. 跨域副作用走事件或注入端口，不互相调内部函数。

## 契约

- **Service**：`{name, start, stop, tick, snapshot, dispose}`（`lib/kernel/service.mjs` + 注册表）；
- **State**：`{id, file, version, normalizer, migrate}` 注册表 + 启动迁移（`kernel/state-schema.mjs`）；
- **Model**：`callRole(profileId, {attempts, parse, debugFile})`（`kernel/model-call.mjs`）；
- **Config**：`lib/kernel/config.mjs` 单一注册表，`npm run config:doc` 生成 `docs/config.md`。

## 门禁

- `npm test`：502 测试；
- `npm run check:eng`：依赖 + 体量；
- `npm run lint`：biome（kernel/composition/domain 新代码）；
- CI：`.github/workflows/ci.yml`。

## 状态文件

见 `docs/state-files.md`；首批迁移：worldview / knowledge-graph / relationship / emotional-state / commitments。

## 重构状态

见 `docs/refactor-progress.md`；ADR 见 `docs/adr/`。

## 运行时调度与耦合观测（v0.2.2）

- **统一心跳**：`lib/domain/host/heartbeat.mjs` 每 60s 一拍；任务按 `everyMs/offsetMs` 到点触发，失败隔离。
  `health.runtime.heartbeat.jobs` 现包含 `nextAt / lastDurationMs / consecutiveErrors / skippedRuns`。
- **已迁移**：成长弧（`成长弧`，每 24h，首跑 3min）从自带定时器迁到心跳；哲学/溜达/读小说/看大家说话等原本就在心跳上。
- **已迁移**：自训练、日常、学习评价、道德实践也已改为心跳任务；心跳注册表现有 13 个作业。
- **仍独立定时的服务**（后续 P1 继续迁）：心情、碎碎念、镜像、夜间整合（部分已由心跳 tick 驱动）等。
- **跨域耦合**：`node scripts/check-deps.mjs` 会打印跨域依赖与 facade 比例；当前 75 条跨域边、0% 走 facade（历史债）。`STRICT_FACADE=1` 时低于 50% 会失败，用于逐步收紧。
- **推荐方向**：跨域改走各域 `index.mjs` facade；`domain-services` 按域拆装配函数；状态文件收敛到 StateStore。

## 装配层拆分（v0.2.3）

`lib/composition/domain-services.mjs` 原来 565 行，现按域拆成 5 个装配模块（约 415 + 各子模块）：

| 模块 | 负责 |
|---|---|
| `memory-knowledge-services.mjs` | 分层记忆、认知图谱、affect/情绪事件、世界观、记忆整合、阅读提示 |
| `language-mood-services.mjs` | 声音档案、自说、心情 AI、内部规则、动作策略、飞花令全量 |
| `chat-entry-services.mjs` | 聊天运行时、推送/outbox、手动阅读、chat token |
| `learning-being-services.mjs` | 哲学阅读、思维链/方法账本、成长弧、道德实践、规则总结 |
| `domain-services.mjs` | 只保留跨域编排、顺序与引用（selfDrive/philosophy/growthArc 的 getter） |

后续 P1：把 `self-growth`、`memory-layers`、`mood-ai-core`、`routes` 等大文件继续按职责拆分。

## 路由表拆分（v0.2.4）

`lib/domain/integration/routes.mjs` 由 681 行降到约 350 行，只保留 helper 与 orchestrator；路由条目按组拆到 `lib/domain/integration/routes/`：

| 模块 | 负责 |
|---|---|
| `base-routes.mjs` | health / bootstrap / poems·ci·yun·knowledge / memory backup / about |
| `settings-weather-routes.mjs` | settings GET·PUT / weather |
| `mood-routes.mjs` | mood-ai（含 recentImages 解析与缓存） |
| `feihua-routes.mjs` | feihua-full 分片 + gzip |
| `self-talk-routes.mjs` | self-talk 聚合上下文 |

后续 P1：`self-growth`（780）、`memory-layers`（756）、`mood-ai-core`（751）、`memory-recall`（717）按职责拆。

## 大文件拆分（v0.2.5）

- `self-growth.mjs` 780 → 636 行；抽出 `self-growth-topics.mjs`（readTopics / 重复主题 / 哲学/历史/随机话题采样）与 `self-growth-log.mjs`（自学日志、试探历史、probe 状态、试探日志）。
- 后续顺序：`memory-layers`（756）→ `mood-ai-core`（751）→ `memory-recall`（717）。

## memory-layers 拆分（v0.2.6）

- `memory-layers.mjs` 756 → 314 行：只保留分层记忆存储（episode/selfFacts）与读取；
- `memory-layers-core.mjs`：常量与小工具；
- `memory-consolidator.mjs`：每日整合服务、consolidation prompt/parse、journal 计数/读取；
- 原导出由 `memory-layers.mjs` re-export，外部行为不变。
- 后续：`mood-ai-core`（751）→ `memory-recall`（717）。
