# Changelog

## Unreleased

- **移除静态自言自语池**：删除 `MURMUR_POOL`/`MURMUR_TEMPLATES`/本地候选与 `fallbackSpontCard`；模型生成失败时保持安静（不显示本地文案、不弹错误），碎碎念完全由模型/自身状态驱动；保留模型结果缓存与自主行为 action 气泡。
- **按任务自选推理等级**：mood low / self-talk high / growth high / voice high（模型默认 deepseek-account/deepseek-flash，env `DSH_POETRY_MODEL_PROVIDER`/`DSH_POETRY_MODEL`/`DSH_POETRY_REASONING_*` 可覆盖）；self-talk 超时 35s、growth/voice 40s、client self-talk 35s。
- **插件模型候选**：优先 `opencode-go/deepseek-v4.1-flash`，调用前失败自动回落 `deepseek-account/deepseek-flash`；不改 DSH 全局模型/子代理白名单；部分输出后失败不重试。
- **修复 OpenCode Go 400**：opencode-go/deepseek-v4.1-flash 为 reasoning 模型且 catalog 无 `supportsTemperature`，插件请求不再发送 `temperature`；回落 deepseek-account 时保留温度；失败日志含 provider/model/status 便于定位。
- **接入 dsh-opencode-go 适配器**：插件模型候选改为 `dsh-opencode-go/deepseek-v4.1-flash` → 原生 `opencode-go` → `deepseek-account`；新适配器走 `https://opencode.ai/inference/go/v1`、无 temperature、保留 reasoningEffort；失败诊断写 `model-errors.jsonl`（provider/model/status，无提示词）。
- **修复 dsh-opencode-go 空响应（task-71）**：Go 网关的 `deepseek-v4.1-flash` 默认开启 thinking、catalog 无 `off` 档无法关闭，推理 token 与正文共享 `max_tokens`；心情 220 / 碎碎念 200 的小预算偶尔被推理吃光 → 正文 0 字符（`EMPTY_RESPONSE`）。策略给 dsh 候选附 `maxTokensFloor`（心情/成长/声音 1600、碎碎念 1200），四服务取 `max(角色预算, floor)`，正文长度仍由提示词约束。
- **候选链收敛**：原生 `opencode-go` 的 zen/go 网关已废弃、必然 400，现仅在 `dsh-opencode-go` 不可用时兜底；dsh 可用时不再每次调用先浪费一次 400。
- **夜间自主巡护修复（task-72）**：夜间 journal 只有 mood/murmur、**0 条 thought**——自驱成长整夜失败。根因：宿主 selection 指向原生 `opencode-go`（zen/go 网关要求 `x-opencode-session` 头，原生 provider 不发 → 必然 400），dsh 候选失败后兜底到它再失败。修复：dsh 可用时若 selection 是原生 `opencode-go`，改用 `deepseek-account/deepseek-flash` 兜底；growth 的 `EMPTY_RESPONSE` 诊断新增 `chunkTypes`/`finishKind`（不含正文）；客户端心情超时 25s→35s 给兜底留时间。
- **兼容补丁脚本** `scripts/patch-dsh-opencode-go.mjs`：`dsh-opencode-go@0.1.24` 从 `@deepseek-ai/dsh-typert-protocol` 导入的 `RemoteError` 在 DSH 0.2.1-rc.2 已移除，导致插件加载失败、provider 不注册；脚本幂等收窄导入并内联等价类，首次修改自动备份，打完重启 DSH 生效。
- 单测：data 42 / host 211 / client 117 = **370 / 370 pass**。

## 0.1.3 — 2026-10-23

从「诗词格律挂件」变成「会自己长大的鲸鱼娘」：成长优先的面板、自主行为循环、记忆中枢与声音档案。

### 成长与记忆

- **成长主页**：面板顶层改为「成长 / 诗词 / 设置」，默认落在成长页；诗词格律收进诗词模块的二级导航（今日/课堂/韵部/词牌/诗库/飞花）。
- **内在状态** `self-state.json`：精力/好奇/社交/饥饿/口渴按分钟自己漂移；睡眠中回精力、饥饿/口渴减速；原子持久化，60s tick。
- **自驱循环**：每 60min 自省写 journal `thought`；每 90min 自学（话题库种子 + 最近学习笔记），写 `learning-log.md`，合法话题只进 `topics-candidates.json` 候选区。
- **记忆中枢**：统一登记 10 个记忆文件，健康检查（缺失/JSON 损坏/大小骤减）、启动/每 6h 自动备份（保留 20 份 + manifest sha256）、只补缺失文件、`GET memory.json` + 手动备份路由。
- **声音档案** `voice.json`：从 journal 白名单旧记忆均匀抽样，模型提炼自己的句长/节奏/语气/开头收尾（不是固定人设），每 24h 自更新；self-talk 注入 voice + 3 句语气参照。
- **记忆检索**：碎碎念前读 journal 旧想法/旧心情/学习笔记/相关话题；生成多行后按中文 bigram 相似度排序，默认只留最不重复的一句。
- **自主行为** `self-actions.json`：按需求阈值自己吃/喝/玩/冒泡/睡/醒（≥3min 间隔）；self.json 暴露 latest/recent actions，页面用自己的气泡显示，成长页可看五行状态与最近行为。

### 心情与语言

- 心情由模型根据真实情境自主决定：聊天/工具/报错/天气/时段/饭点/闲置/节日/最近在做/正在体验的情绪；动画图鉴 106 个 webm（dsh-pet MIT，本地 `_ref/pet-media/`）。
- 心情图鉴支持 video 优先、最近 20 张软排除；`recentImages` 视频排除修复；静态图 92 张 + 动画共 198 种心情立绘。
- 心情失败容错：客户端 25s 超时、保留上次模型心情、12–25s 重试（最多 5 次）、事件触发 20s 最小间隔、失败原因显示（不再「未知原因」）。
- mood-ai 排除改为软建议（返回最近用过的图也接受），修复体验要求与排除冲突导致回退本地。
- 心情词汇扩展：27 个细腻人类情绪词（怅然/眷恋/释然/雀跃/忐忑/倦怠/……），不再只用「开心/难过/累」。
- journal：心情**每条都保留**（不再限频/归档）；碎碎念 3min 限频；修掉心情/碎碎念刷屏；记忆文件保留 raw 备份。
- 碎碎念：最近上下文 5→12；话题库（`agent-memory/topics.json`，222 条：海洋/动物/植物/食物/地理/天文/历史/科技/心理/哲学/语言，热重载）；话题轮换 + 表达类型轮换 + 反重复；1–2min 间隔（事件唤醒 2–5s）。
- 心情/图片/碎碎念双向联动：碎碎念请求带当前 moodLabel/moodReason/image/imageLabel，prompt 要求与立绘动作/表情自然对上；最近自述仍反哺 mood-ai 选心情。
- webm 立绘尺寸统一：`object-fit:cover` + 1.12 缩放，和 512×512 静态图视觉高度对齐。
- 移除已取消的自动刷新实现与测试。

### 测试

data 42 / host 196 / client 118 = **356 / 356 pass**；`node --check` 全过。


## 0.1.2 — 2026-10-21

- **新增自主记忆日志**：模型生成的自言自语（murmur）与心情决定（mood）会**只追加**写入 `$DSH_HOME/agent-memory/`
  - `journal.jsonl`：结构化记录 `{ts,kind,text?,label?,reason?,image?,model?}`
  - `journal.md`：人类可读的追加条目
  - 只保存模型生成的内容与时间/模型名，**不写入任何会话消息、用户原文或查询参数**；只追加、不改写/删除旧条目；写失败不影响路由。
- 测试：data 42 / host 91 / client 87 = **220 / 220 pass**。

## 0.1.1 — 2026-10-21

- **自言自语改为模型实时生成**：每隔 8–15 分钟（≥30 分钟无人互动则 7–12 分钟、硬底 5 分钟、无每日上限）由当前配置的模型说一句**自己的随想**；不背诗、不引诗、不用静态文案池随机；失败时静默回退本地随想池；预览不计次数。
  - Host 新路由 `GET /api/dsh-poetry/self-talk.json`（`ctx.llm.stream` + 当前默认模型，prompt 仅含日期/天气/心情/聚合统计/最近自述，不读会话内容）。
- **心情改为模型自主决定（不再伪随机）**：模型根据当天真实情境（聊天/工具调用/报错/天气/时段/饭点/闲置/节日…）从图鉴中选择心情标签、理由与配图。
  - Host 新路由 `GET /api/dsh-poetry/mood-ai.json`；10 分钟缓存、`force=1` 手动刷新、30 分钟/显著事件自动刷新。
  - **92 张本地立绘全部可用**：89 张心情图由模型任选 + 3 张面板探头图（今日/设置/其他 tab）；图鉴 `assets/data/mood-catalog.json`。
  - 模型不可用/失败时回退原启发式心情；设置中显示心情 label/理由/来源并可「刷新心情」。
- 测试：data 42 / host 81 / client 87 = **210 / 210 pass**；集成 verify 68/68。

## 0.1.0 — 2026-10-21

首个公开版本。

- 每日一诗：320 首唐诗/千家诗精选，逐字平仄、体式/起式/韵脚解析；支持简体/原文切换。
- 格律小课堂 12 卡、声律启蒙 30 韵部、15 张词牌卡 + 宋词名篇。
- 诗库：25,268 首（诗经 305、楚辞 65、千家诗 219、唐诗三百首古体 135、全唐诗/全宋诗精选 4,500、全量宋词 20,044 按需展开；宋词默认精选 283）。
- 格律检测器：平水韵 106 韵部逐字标注，诗体/韵部/粘对/拗字/三平调/孤平检测，支持自定义 4/8 句。
- 飞花令：完整句句库（基础 3,244 / 扩展 22,551 / 含全量宋词 155,504），接龙赛 + 图鉴。
- 天气诗词：Open-Meteo 实时天气（城市可设），按晴/云/雨/雪/雷/风/冷/夜推荐诗词。
- 心情系统：按会话活跃/工作强度/天气/时段/饭点/闲置/飞花战绩计算 9 种心情，切换 92 张本地立绘；低频「想读的诗」彩蛋。
- 全部离线：诗词/立绘本地随包；设置持久化；路由信任栅栏；零凭据。
