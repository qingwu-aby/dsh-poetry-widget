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
- [x] 第二批：聊天服务 → `composition/chat-service.mjs`（OCR/关系/情绪/日常/承诺/图谱/本地声音），twin/manual-read/attention/project 路由 → `composition/interactive-routes.mjs`；
- [x] 第三批：基础服务 → `composition/base-services.mjs`，知识/关系/情绪服务 → `composition/knowledge-services.mjs`，清理函数 → `composition/lifecycle.mjs`；index.js **1725 → 1342 行**（500/500）
- [ ] `kernel/service.mjs` + 注册表：统一 start/stop/tick/snapshot
- [ ] 收紧 check-size 为 `--strict`

## W2（进行中）
- [x] 13 个域 facade（`lib/domain/*/index.mjs`）
- [x] 域内迁第一批：**memory**（8 模块）、**emotion**（4）、**relationship**（3）、**knowledge**（3）——旧路径保留 re-export shim，502/502
- [x] 域内迁第二批：learning（10）/ chat（7）/ works（5）/ being（9）/ voice（4）/ twin（3）/ life（4）/ host（7）/ integration（5）——**全部 13 个域完成内迁**，旧路径保留 shim，502/502
- [x] 模型服务抽取：localVoice / feihua-full / voice → `composition/model-services.mjs`（index 1344 → 1322）
- [x] 记忆栈抽取：memory layers/recall/consolidator/hub → `composition/memory-services.mjs`
- [x] 学习循环抽取：wander/reading/netlang → `composition/learning-loop-services.mjs`
- [x] being 栈抽取：growth → `composition/being-services.mjs`，selfDrive → `composition/self-drive-service.mjs`
- [x] chat 运行时抽取：chatBridge/guiPush/outbox/proactiveChat/workLoop → `composition/chat-runtime.mjs`（index 1149 → 1035）
- [ ] index.js 剩余服务组装迁移（memory 栈 / mood+selfTalk / being（selfState/selfDrive/growth）/ chatBridge+outbox+guiPush / 宿主服务，目标 <300 行）
- [ ] 测试拆分（tests/domains/）

## W3/W4（backlog）
- [ ] 客户端 store/hook 层与 tab 注册表；HTTP JSON 契约测试
- [ ] JSDoc/@ts-check + tsc --noEmit；coverage 门槛；PLAN.md 归档与 README 精简
- [ ] 收紧 check-size --strict（依赖 index.js 服务组装完成）

## 已知债务
1. index.js 仍有 ~1343 行、约 30 个服务在入口创建，互相引用顺序敏感；
2. 域 facade 目前只是 re-export，内部文件仍在 `lib/` 平铺；
3. host.test.mjs 仍 12k 行未拆；
4. 客户端 client.js 仍 ~5.6k 行；无 TS/覆盖率门槛。
