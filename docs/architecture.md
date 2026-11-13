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
- **仍独立定时的服务**（后续 P1 继续迁）：心情、碎碎念、学习评价、日常、镜像、自训练等；迁移目标是把“所有循环”变成心跳注册表里的可观测任务。
- **跨域耦合**：`node scripts/check-deps.mjs` 会打印跨域依赖与 facade 比例；当前 75 条跨域边、0% 走 facade（历史债）。`STRICT_FACADE=1` 时低于 50% 会失败，用于逐步收紧。
- **推荐方向**：跨域改走各域 `index.mjs` facade；`domain-services` 按域拆装配函数；状态文件收敛到 StateStore。
