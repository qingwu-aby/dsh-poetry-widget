# 小鲸鱼插件架构演进计划（v1，2026-11-09）

> 目标：在不改变现有行为的前提下，把 1725 行的入口、86 个平铺模块、20k 行测试巨石，
> 演进成**分层清晰、可独立演进、有工程护栏**的插件架构，为后续迭代（新数据源、新模型角色、
> 新行为、新面板、多用户/多镜像）留出扩展点。

## 0. 结论摘要

- 当前是"能跑但正在变慢"：功能都集中在 `index.js` 组装，状态文件各写各的，模型调用各修各的；
- 不建议大爆炸重写；用 **绞杀者模式（strangler）**：先加护栏 → 收敛基础设施 → 按域抽服务 → 最后收敛客户端；
- 每一波都可独立发布、独立回滚；硬性验收：**491 条测试全绿、行为零变化、单 PR 可回滚**。

## 1. 现状度量（2026-11-09）

| 指标 | 数值 | 说明 |
|---|---|---|
| `index.js` | 1725 行 / 76 imports / 18 处 inline 路由 | 组合根过重 |
| `lib/` | 86 模块 / 24,097 行 | 平铺目录，最大模块 1049 行 |
| `client-src/` | 9,148 行；`client.js` 5,598 行 | 前端主文件偏大 |
| 测试 | 19,510 行；`host.test.mjs` 12,146 行 | 单文件巨石 |
| 持久化 | 77 处原子写 / 48 处裸读 | 无统一 store / schema / 迁移 |
| 服务 | 74 个 `create*` / 28 个 `snapshot()` | 形态相似但无统一接口 |
| 工程基建 | 无 lint / format / tsc / CI / coverage | 静默失败只能靠人眼 |
| 模块循环 | 0 | 现状好的地方 |

已发生的真实事故（作为架构债务证据）：
1. `worldview.json` 的 `essay.version/at` 字段漂移 → 世界观静默停在 v4；
2. 图谱抽取 `EMPTY_RESPONSE` → 每个模块各自打 token/重试补丁；
3. 多个 `catch { /* ignore */ }` 让"停止运行"不可观测。

## 2. 目标架构

### 2.1 分层

```
┌─────────────────────────────────────────────┐
│ 插件入口（index.js，<300 行）                  │
└───────────────┬─────────────────────────────┘
                │ composition（组装）
┌───────────────▼─────────────────────────────┐
│ composition/                                 │
│  services.mjs   创建全部域服务                 │
│  routes.mjs     注册 HTTP JSON 路由            │
│  lifecycle.mjs  start/stop/disposers/heartbeat│
│  config.mjs     配置注册表（env/defaults）      │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│ domain/<domain>/（域服务，对外只暴露 facade）    │
│  memory/ emotion/ relationship/ learning/     │
│  knowledge/ chat/ mood/ voice/ works/         │
│  being/ life/ twin/ attention/                │
└───────────────┬─────────────────────────────┘
                │ 只依赖 kernel + ports
┌───────────────▼─────────────────────────────┐
│ kernel/（基础设施）                            │
│  json-store.mjs state-schema.mjs model-call.mjs│
│  config.mjs logger.mjs scheduler.mjs paths.mjs│
│  service.mjs（Service 契约）                   │
├─────────────────────────────────────────────┤
│ integration/（宿主/外部适配）                   │
│  routes/ web/ trust/ tcc/ assets/ client-bridge│
└─────────────────────────────────────────────┘
```

### 2.2 依赖规则（自动检查）

1. `domain/*` 不得 import `composition/*`、`index.js`；
2. `domain A` 不得直接 import `domain B` 的内部文件，只能依赖其 `facade`；
3. 所有跨领域副作用通过 **事件** 或显式注入的端口（port）完成；
4. `kernel/*` 不得 import `domain/*`；
5. 通过脚本 `scripts/check-deps.mjs` 在 CI 中强制（用 import 解析，允许白名单）。

### 2.3 核心契约

```js
// kernel/service.mjs
createService({
  name,
  start(), stop(), dispose(),
  tick(now),          // 可选的周期任务
  snapshot(),         // 健康快照（health.json 聚合）
  handle(event),      // 可选的事件订阅
})
```

```js
// kernel/json-store.mjs
readJson(file, { normalize, fallback, migrate })
writeJson(file, state, { backup, validate })
```

```js
// kernel/model-call.mjs
callRole(role, {
  prompt, system,
  maxTokens,          // 缺省取角色 profile 的 token 下限
  retryOnEmpty,       // 默认 true：EMPTY_RESPONSE 自动翻倍重试
  debugFile,          // 解析失败时落原始输出
})
// role profile 注册：maxTokensFloor / effort / timeout / retryPolicy / promptBuilder / parser / fallback
```

## 3. 域划分（86 模块 → 12 域 + kernel + integration）

| 目标包 | 现有模块（示例，完整映射在抽取时补表） | 职责 |
|---|---|---|
| domain/memory | memory-hub, memory-recall, memory-journal, memory-layers, memory-baseline, memory-migrations, memory-registry, data-store | 记忆读写/检索/分层/迁移 |
| domain/emotion | mood, mood-ai, emotional-continuity, feelings, self-being（部分） | 心情/情绪线程/感受词 |
| domain/relationship | relationship-memory, commitments, chat-bridge（关系部分）, attention | 关系记忆、约定、注意力 |
| domain/learning | self-growth, self-growth-prompts, self-curriculum, self-reading, self-wander, self-netlang, self-talk-topics, predict-check, world-feedback, experience | 自学/研究/读书/溜达/反馈 |
| domain/knowledge | knowledge-graph, knowledge-extract, graph-view(server 部分) | 图谱存储/抽取/查询 |
| domain/chat | chat-bridge, chat-media, proactive-chat, gui-inbox, gui-push, message-domain, outbox | 对话/主动消息/推送 |
| domain/works | self-works, work-loop, local-media, media-budget, pet-media | 作品与媒体 |
| domain/being | self-state, self-events, self-actions, self-lifecycle, self-drive, self-projects, presence, autonomy | 自身状态/行为/自处 |
| domain/voice | voice-memory, local-voice, language-style, prompt-layers | 声音/风格/提示层 |
| domain/twin | twin-system, twin-bridge, twin-research | 镜像/研究 |
| domain/life | daily-life, weather, self-trainer, agent-loop-runner | 生活素材/自训练/常驻 |
| domain/host | dsh-host, service-runtime, heartbeat, model-budget, model-policy, model-errors, llm-call（→ kernel） | 宿主能力 |
| kernel | settings-store→json-store, paths, llm-call, routes 基础, safe-web, trust, image-ocr | 基础设施 |
| composition | 新文件：services/routes/lifecycle/config | 组装 |

> 抽取时每个域建 `domain/<name>/index.mjs`（facade）+ 内部文件；原 `lib/* .mjs` 先保留 `export * from` 兼容层，W3 后删除。

## 4. 抽取策略（绞杀者）

1. **测试先行**：每个域抽取前，先把它现有测试从 `host.test.mjs` 拆到 `tests/domains/<name>.test.mjs`（纯移动，不改断言）；
2. **兼容层**：新路径实现后，旧文件改为 re-export，保证 index/client/测试引用不断；
3. **小步 PR**：一次只抽一个域 + 一个基础组件，单 PR < 800 行 diff；
4. **特性开关**：高风险替换（模型调用层、路由）用 env 开关双跑，观察一轮再删旧代码；
5. **验收门禁**：491+ 测试全绿、`npm run check`、`scripts/check-deps.mjs`、`scripts/check-index-size.mjs`。

## 5. 路线图（4 波，约 2–3 周）

### W0 工程护栏（0.5–1 天）
- [ ] biome（lint + format），只对 `lib/`、`index.js`、`client-src/` 启用，规则从推荐集开始、先修 P0 错误；
- [ ] `scripts/check-deps.mjs`（禁止循环、domain 反向依赖）；
- [ ] `scripts/check-size.mjs`（index.js < 300 行、单模块 < 800 行的告警门槛）；
- [ ] CI（GitHub Actions）：`npm test` + `npm run check` + lint；
- [ ] 覆盖率报告（node --test --experimental-test-coverage），先记录基线不设门槛；
- [ ] `docs/state-files.md`：清点全部持久化文件（路径/字段/版本/备份策略）。

**验收**：CI 绿；文档列出 30+ 个状态文件；lint 无 error。

### W1 基础设施收敛（2–3 天）
- [ ] `kernel/json-store.mjs`：读写/规范化/备份/校验；新代码先用，旧模块 touched 时迁移；
- [ ] `kernel/state-schema.mjs`：所有状态文件 schema + 版本 + migrate；启动时统一迁移（先 dry-run 日志）；
- [ ] `kernel/model-call.mjs`：角色 profile（token 下限/effort/超时/重试/解析器/调试落盘），把 graph/worldview 的补丁收进来；
- [ ] `kernel/config.mjs`：全部 `DSH_POETRY_*` 与周期注册表（默认值/说明/校验），生成 `docs/config.md`；
- [ ] `kernel/logger.mjs`：结构化日志 + 静默失败计数（health 暴露）；
- [ ] `composition/`：拆 index.js → services/routes/lifecycle；18 条 inline 路由迁到 `composition/routes.mjs`；
- [ ] `kernel/service.mjs` + `composition/registry.mjs`：统一 start/stop/tick/snapshot。

**验收**：index.js < 300 行；491 测试全绿；health.json 聚合所有服务快照；模型空响应重试统一。

### W2 域抽取 Wave 1（4–6 天）
- [ ] memory → domain/memory（先拆测试）
- [ ] emotion/mood → domain/emotion
- [ ] relationship/commitments/attention → domain/relationship
- [ ] learning（growth/reading/wander/netlang/predict/world-feedback）→ domain/learning
- [ ] knowledge（graph/extract）→ domain/knowledge
- 每域完成：facade + 内部文件 + 旧路径 re-export + 测试迁移

**验收**：域内无跨域直接 import（check-deps 白名单为 0）；旧测试引用不变仍绿。

### W3 域抽取 Wave 2 + 客户端收敛（4–6 天）
- [ ] chat/proactive/outbox、works、being、voice、twin、life 抽域；
- [ ] `client-src/store.js`：设置/数据缓存/fetch/错误统一；
- [ ] tab 注册表（id/label/lazy loader/data source），重依赖（sigma）保持动态 import；
- [ ] HTTP 契约测试：每个 `/api/dsh-poetry/*.json` 的顶层字段 schema；
- [ ] 删除兼容层，更新 docs/architecture.md。

**验收**：client.js 主文件 < 3500 行；所有 JSON 路由有契约测试；启动 smoke 通过。

### W4 扩展能力与观测（持续）
- [ ] 注册表化扩展点（见第 6 节）；
- [ ] 事件总线（domain events）落地；
- [ ] JSDoc/@ts-check + tsc --noEmit（先 kernel/domain facade）；
- [ ] ADR 目录 + 文档整理（PLAN.md 归档、README < 200 行）；
- [ ] 多用户/多镜像/远程访问预留（不实现，先拆接口）。

## 6. 扩展点设计（未来迭代直接“注册”，不改组合根）

1. **模型角色注册表**：新增角色只加 profile + prompt builder + parser，不再复制 callModel 逻辑；
2. **信息源注册表**：wiki / RSS / 搜索 / 一手文献各实现 `Source{ id, fetch, parse, qualityFilter }`；换源只加 adapter；
3. **行为注册表**：自处动作（吃/读/画/出去走/分享）实现 `Action{ id, canRun, perform, observe }`；行为不写在 self-drive 大 switch 里；
4. **客户端 tab 注册表**：面板 tab 实现 `{ id, label, lazyModule, dataKey }`，新增页不改 client.js；
5. **状态文件注册表**：`{ file, version, normalize, migrate, backup }`，新状态文件自动纳入迁移与健康检查；
6. **事件总线**：`memory.learned`、`mood.changed`、`research.completed`、`commitment.due`、`message.sent`——域间用事件，不互相调函数；
7. **预算/权限中间件**：模型调用、网页访问、媒体生成统一过 gate（预算 + 权限 + 频率）；
8. **观测钩子**：每个 service 的 tick/调用自动记录耗时/失败，health 汇总。

## 7. 质量门禁（CI 强制）

- [ ] `npm test` 全绿（目标 600+ 条，拆分后按域分布）；
- [ ] `scripts/check-deps.mjs` 通过；
- [ ] `scripts/check-size.mjs` 通过（index.js < 300、单文件 < 800）；
- [ ] 所有状态文件 schema 校验通过（启动 dry-run）；
- [ ] 所有 JSON 路由契约测试通过；
- [ ] 覆盖率基线 ≥ 60%（lib），逐季提升；
- [ ] 启动 < 3s、聊天 p95 延迟与改造前持平（基线记录在 docs/perf-baseline.md）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 状态迁移丢数据 | 迁移前自动备份 `.bak-<ts>`；先 dry-run 日志；失败保留旧文件 |
| 宿主热重载剥离工具 | 重构只动内部模块，不改插件导出/inject 列表；每次 smoke 验证 |
| 模型 API 抖动 | 统一重试层先落地；失败落 model-errors + debug 文件 |
| 客户端包膨胀 | sigma 等重依赖保持动态 import；tab 级 lazy |
| 测试迁移丢失覆盖 | 纯移动重建：先拆分，后改断言；覆盖率基线对比 |
| 重构期间功能迭代冲突 | 冻结大功能开发，按波次推进；每波结束打 tag |

## 9. 首批任务（可直接开工，按顺序）

1. `docs/state-files.md` + `scripts/check-deps.mjs` + `scripts/check-size.mjs`（0.5 天，无行为变化）
2. `kernel/json-store.mjs` + 单测；迁移 2 个新模块（relationship/commitments）验证（0.5 天）
3. `kernel/state-schema.mjs`：worldview/graph/relationship/emotional/daily-life/commitments 六个文件的 schema + migrate + dry-run（1 天）
4. `kernel/model-call.mjs`：先接 graph/worldview 两条路径，双跑验证（1 天）
5. `composition/` 拆 index.js：services/routes/lifecycle，保持导出不变（1–2 天）
6. 拆 tests：memory + chat 两个域先迁（0.5 天）

每步独立 commit + 491 测试全绿；完成 1–6 后评估进入 W2。

## 10. 需要确认的决策

1. 是否允许引入 **biome + GitHub Actions**（本地/远端 CI 权限与依赖）；
2. 客户端渲染库已用 sigma，是否保持“单 client.js 打包”约束（影响是否做真正的代码分割）；
3. 状态文件是否允许一次性批量迁移（会备份，但涉及她全部记忆/情绪/关系数据）；
4. 重构期间是否**冻结新功能**（建议冻结 1–2 周，只修 bug）。
