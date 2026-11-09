# 架构重构进度（对照 docs/refactor-plan.md）

## W0 工程护栏 ✅（2026-11-09，commit a316bf4）
- [x] `scripts/check-deps.mjs`：循环依赖 + 分层反向依赖检查（90 模块 0 违规）
- [x] `scripts/check-size.mjs`：index.js/单模块体量检查（非严格模式，W1 后收紧）
- [x] `lib/kernel/json-store.mjs`：统一 JSON 读写（原子写、备份轮转、migrate/normalize、损坏回退）
- [x] `tests/kernel.test.mjs` + 加入 npm test（496/496）
- [x] biome（lint+format）仅覆盖新代码；`.github/workflows/ci.yml`
- [x] `docs/state-files.md`：全部持久化文件清点

## W1 基础设施收敛（进行中）
- [x] `lib/kernel/state-schema.mjs` + `lib/composition/state-specs.mjs`：worldview / knowledge-graph / relationship / emotional-state / commitments 五个文件纳入注册表；启动时规范化/迁移，dry-run 支持，失败不覆盖；health 暴露 `stateMigrations`
- [x] `lib/kernel/model-call.mjs`：统一调用层（attempts/parse/debugFile；已接 knowledge-extract 与 worldview，500/500）
- [x] `lib/kernel/config.mjs`：37 项配置注册表 + `scripts/gen-config-doc.mjs` → `docs/config.md`
- [ ] `lib/kernel/logger.mjs`：结构化日志 + 静默失败计数
- [x] 第一批路由抽取：assets/pet-media/memory/model-errors/presence/works/self/graph → `composition/readonly-routes.mjs`；
- [x] 第二批：聊天服务 → `composition/chat-service.mjs`（OCR/关系/情绪/日常/承诺/图谱/本地声音），twin/manual-read/attention/project 路由 → `composition/interactive-routes.mjs`；index.js **1725 → 1390 行**（500/500）
- [ ] `kernel/service.mjs` + 注册表：统一 start/stop/tick/snapshot
- [ ] 收紧 check-size 为 `--strict`

## 下一步（按顺序）
1. 拆 index.js 成 `composition/{services,routes,lifecycle}.mjs`（目标 <300 行，导出面不变）
2. `kernel/service.mjs` + 注册表：统一 start/stop/tick/snapshot
3. 测试拆分（memory/chat 先迁到 tests/domains/）
4. 收紧 `check-size --strict`
