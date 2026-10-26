# 小鲸鱼插件架构地图（2026-10-26，v1.73）

给以后改代码/加能力的人（包括我自己）一张地图。先看这里，再去翻模块。

## 1. 两个进程/两个半区

| 半区 | 文件 | 职责 |
| --- | --- | --- |
| Host（Node） | `index.js` + `lib/*.mjs` | 记忆、模型调用、后台循环、HTTP 路由、信任栅栏、静态素材 |
| Client（浏览器） | `client.js` | 挂件 UI、面板、飞花令、心情/媒体展示、本地交互（单文件，无构建） |

Host 与 Client 只通过 HTTP 路由 + 静态资源通信；Client 不直接读文件、不持有模型密钥。

## 2. Host 模块分组

- 入口：`index.js`（组合根）——建服务、注册路由、起定时器、清理。
- 数据/契约：`data-store`（诗词 JSON）、`settings-store`（设置+原子写）、`trust`（请求栅栏）、`routes`（全部 JSON 路由表）。
- 记忆：`memory-journal`（journal 只追加）、`memory-recall`（检索/摘要）、`memory-layers`（情景/语义/自我分层 + 每日整合）、`memory-hub`（12 个文件登记/健康/备份/恢复）、`memory-registry`（记忆文件唯一登记表）、`feelings`、`self-talk-topics`（话题库+冷存储）。
- “她自己”：`self-being`（L0 状态：felt/在体会/时间线）、`self-drive`（15–30min 自处，决定做什么）、`self-actions`（行为记录）、`self-growth`（自省/自学/试探/成长计数）、`self-talk`（碎碎念）、`mood-ai`（心情+配图）、`voice-memory`（声音档案）。
- 外部输入：`self-wander`（维基随机摘要）、`self-reading`（公版现代/翻译作品）、`self-netlang`（微博/B站公开热搜）。
- 模型：`model-policy`（角色/候选/effort/预算）、`llm-call`（唯一模型调用循环）、`model-errors`（失败诊断）。
- 其它：`weather`、`assets`、`pet-media`、`feihua-full`、`paths`、`language-style`（去 AI 味约束）。

## 3. 关键数据流

1. 自处：`self-drive` 拿 `self-being` 快照 → 模型 → 写 felt/doing/experiencing/focus → 记录 `self-actions`；focus/experiencing 触发 `self-growth.probeNow()`。
2. 碎碎念：`self-talk` → `memory-recall.digest()`（最近想法/心情/学习/话题/旧时回声/分层概括/自我短句）→ 模型 → journal。
3. 记忆分层：`memory-layers` 每天把两天前的 journal 整合成回忆概括 + 自我短句；检索仍走 `memory-recall`。
4. 外部活动：wander/reading/netlang 定时取公开内容 → 模型写自己的笔记 → `learning-log.md`。
5. HTTP：`routes` 生成 `/api/dsh-poetry/*.json`，全部过 `trust` 栅栏；`health.json` 额外带后台服务快照。

## 4. 加能力时改哪里

| 想加 | 现在要改 |
| --- | --- |
| 新自主活动（读书/看热搜类） | 新 `lib/self-*.mjs`（工厂 + 定时器 + prompt/parse）+ `llm-call` + `index` 注册 + `model-policy` 加 role + 测试 + 文档 |
| 新模型角色 | `model-policy`（role/effort/floor/label）+ `index` 的 candidate 日志列表 + 测试 |
| 新记忆文件 | **只改 `memory-registry` 一处**（id/kind/optional/路径），hub/备份/健康自动带上；再写模块自己的读写 |
| 新 HTTP 路由 | `routes` 表 + `trust` 栅栏（数据类必须 fenced）+ 契约文档 + 测试 |
| 新 UI 面板/tab | **`client.js` 单文件**（当前最大瓶颈；见下）——改组件/CSS/交互 + client 测试 |
| 新外部数据源 | 复制 `self-wander` 模式：白名单域名 + 超时 + 只读 + 只存自己的笔记 |

## 5. 已知约束与债务

- **Client 是单文件 7,768 行**：DSH 的浏览器产物是“一个 lazy factory/package”的单个 artifact；相对 import 不会自动打包，`dsh.client.external` 只声明基线外依赖。要真拆分需要引入 Client 构建工具（如 esbuild，把 `client-src/` 打成 `client.js`），这会改变发布/打包流程，暂缓。
- **Client 测试 36s**：大量真实 `sleep`/定时器；提速需要虚拟时钟改造测试 harness（只动测试、不动 UI），可单独做。
- **index.js 仍有 9 段独立 `hostCtx.effect` 清理**：可收成 service runtime（start/dispose 一处），但当前每段都短、风险低，暂缓。
- **记忆文件没有统一 schemaVersion/迁移层**：各模块宽容解析；字段演进靠 normalize。真要长期演进再加迁移层。
- **单进程、无锁**：写都是原子写/只追加；跨文件读改写靠单飞标志（learning/probing）避免重入；未来若并发多来源写同一文件需要文件锁。

## 6. 测试与命令

- `npm test`（391 用例：data 42 / host 230 / client 119）
- `npm run test:fast`（data+host，约 4s）
- `npm run test:client`（约 36s）
- `npm run check`（语法检查）
