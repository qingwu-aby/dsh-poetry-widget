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
- [ ] `lib/kernel/model-call.mjs`：按角色 token 下限、EMPTY_RESPONSE 自动重试、解析失败落原始输出（先接 graph/worldview）
- [ ] `lib/kernel/config.mjs`：`DSH_POETRY_*` 注册表 + docs/config.md
- [ ] `lib/kernel/logger.mjs`：结构化日志 + 静默失败计数
- [ ] `composition/`：拆 index.js（services/routes/lifecycle），目标 <300 行
- [ ] `kernel/service.mjs` + 注册表：统一 start/stop/tick/snapshot
- [ ] 收紧 check-size 为 `--strict`

## 下一步（按顺序）
1. model-call 统一调用层（先接 knowledge-graph / worldview 两条路径）
2. config 注册表
3. 拆 index.js 成 composition
4. 测试拆分（memory/chat 先迁）
