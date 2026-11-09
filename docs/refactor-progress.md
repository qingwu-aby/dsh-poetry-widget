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

## W2 ✅（2026-11-09，index.js 1725 → 38 行）
- [x] 组合根拆分：`composition/bootstrap.mjs`、`runtime-setup.mjs`、`domain-services.mjs`、`plugin-runtime.mjs`、`http-wiring.mjs`、`chat-runtime.mjs`、`health.mjs`、`lifecycle.mjs` 等
- [x] 全部 13 个域内迁 `lib/domain/`（旧路径 shim 兼容）
- [x] 体量门禁收紧：index.js ≤ 300 行通过；单模块上限 1100（4 个历史大模块待拆到 800）
- [x] 13 个域 facade（`lib/domain/*/index.mjs`）
- [x] 域内迁第一批：**memory**（8 模块）、**emotion**（4）、**relationship**（3）、**knowledge**（3）——旧路径保留 re-export shim，502/502
- [x] 域内迁第二批：learning（10）/ chat（7）/ works（5）/ being（9）/ voice（4）/ twin（3）/ life（4）/ host（7）/ integration（5）——**全部 13 个域完成内迁**，旧路径保留 shim，502/502
- [x] 模型服务抽取：localVoice / feihua-full / voice → `composition/model-services.mjs`（index 1344 → 1322）
- [x] 记忆栈抽取：memory layers/recall/consolidator/hub → `composition/memory-services.mjs`
- [x] 学习循环抽取：wander/reading/netlang → `composition/learning-loop-services.mjs`
- [x] being 栈抽取：growth → `composition/being-services.mjs`，selfDrive → `composition/self-drive-service.mjs`
- [x] chat 运行时抽取：chatBridge/guiPush/outbox/proactiveChat/workLoop → `composition/chat-runtime.mjs`
- [x] mood/selfTalk 抽取 → `composition/mood-talk-services.mjs`
- [x] 宿主服务抽取：web 栈/weather/webBench/agentLoop/mediaBudget → `composition/host-services.mjs`
- [x] 世界观服务抽取 → `composition/worldview-service.mjs`
- [x] HTTP 装配抽取 → `composition/http-wiring.mjs`（routes/twin/readonly/chat/interactive/启动标记）
- [x] 作品与生活服务抽取 → `composition/works-services.mjs`、`composition/life-services.mjs`
- [x] 启动期基础设施抽取 → `composition/runtime-setup.mjs`（配置/迁移/模型策略/web 栈/webBench/巡检/作品/话题/情绪库；index 770 → 740）
- [ ] index.js 剩余服务组装迁移（memory 栈 / mood+selfTalk / being（selfState/selfDrive/growth）/ chatBridge+outbox+guiPush / 宿主服务，目标 <300 行）
- [ ] 测试拆分（tests/domains/）

## W3/W4（进行中）
- [x] HTTP JSON 契约测试：`tests/domains/http-contract.test.mjs`（10 条：health/self/memory/graph/works/model-errors/settings/bootstrap/view=1/方法守卫；512/512）
- [x] PLAN.md 归档 → `docs/archive/PLAN.md`；新增 `npm run test:coverage`（仅报告，暂无门槛）
- [ ] 测试拆分：host.test.mjs（12k 行）→ tests/domains/（已建目录 + 契约测试）
- [x] 客户端数据层：`client-src/data.js`（fetch/超时/首屏缓存/getStorage，client.js 5598→5517）
- [ ] 客户端 state/hook 层与 tab 注册表（剩余 ~5.5k 行）
- [x] 覆盖率门槛：`npm run test:coverage` 强制 lines 65 / branches 65 / functions 70（当前 68/74/74），CI 已接入
- [ ] JSDoc/@ts-check + tsc --noEmit；README 精简
- [x] 4 个历史大模块已拆到 <800 行：mood-ai(322+747)、self-talk(451+569)、self-drive(583+423)、self-growth(763+109+317)；体量门禁收紧为单模块 ≤800

## 已知债务（W2 完成后）
1. index.js 38 行 ✅（组合根在 composition/）
2. 13 个域已内迁 ✅（旧路径保留 shim，后续可删）
3. host.test.mjs 仍 12k 行未拆（W3）
4. 客户端 client.js 仍 ~5.6k 行（W3）
5. 4 个历史大模块已拆分（2026-11-09）
6. 无 TS/覆盖率门槛（W4）
