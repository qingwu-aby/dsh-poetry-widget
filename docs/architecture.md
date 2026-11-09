# 架构（2026-11-09，重构中）

## 分层

```
index.js（插件入口：host.inject + 主流程，1343 行）
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
└─ lib/*.mjs            既有实现（逐步迁入 domain）
```

## 依赖规则（scripts/check-deps.mjs 强制）

1. 禁止循环依赖；
2. `kernel/*` 不得依赖 `domain/*`、`composition/*`、`index.js`；
3. `domain A` 不得直接 import `domain B` 的内部文件，只能依赖 `B/index.mjs`；
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
