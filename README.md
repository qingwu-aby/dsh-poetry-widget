# 诗词格律挂件 · dsh-poetry-widget

DeepSeek Harness（DSH）Web 界面的常驻诗词挂件（默认停在左下角，可拖拽/吸附）：**每日一诗 + 逐字平仄 + 体式解析**，并把基础的诗词格律知识做成可以随手翻的小课堂。

> 角色形象使用鲸鱼娘 celebrate 立绘（来自 [dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)，MIT；详见 [PROVENANCE.md](./PROVENANCE.md)）。
> 数据来自 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT）。

## 0.1.3 新增：成长优先

- **面板结构**：顶层只有「成长（默认）/ 诗词 / 设置」；每日一诗、格律、诗库、飞花令收进「诗词」模块的二级导航。
- **自驱成长**：内在状态（精力/好奇/社交/饥饿/口渴）按分钟自己漂移；定时自省、自学；自主行为循环会自己吃/喝/玩/睡/醒，不需要先被用户触发。
- **记忆中枢**：统一登记 10 个记忆文件，健康检查、启动/每 6h 自动备份（保留 20 份 + sha256 manifest）、只补缺失文件；成长页可手动「立即备份」。
- **声音档案**：语言风格从自己的旧 journal 里提炼成 `voice.json`（profile + 3 句语气参照），每 24h 自更新，不套固定「温柔/调皮」人设。
- **话题库**：`agent-memory/topics.json` 222 条边角知识，热重载；碎碎念会按心情/天气/最近活动/体验挑话题，并检索旧记忆；**自学到的新话题免审核直接并入**（`learned` 标记、只增不删；新学话题在选题里临时加权，旧知识仍永远可被调用），候选文件留作审计。


## 功能

- 🌱 **成长主页**：当前心情（label/理由/来源）、内在状态五行、最近说过的话、成长摘要、自主学习/自省进度；心情换装/刷新也在这里。
- 🧠 **自主行为**：按需求阈值自己吃/喝/玩/冒泡/睡/醒（≥3min 间隔），动作写 `self-actions.json`；页面用「自己」气泡显示，成长页可看最近行为与睡眠状态。
- 🗂️ **记忆中枢**：journal / 话题库 / 学习日志 / 候选 / 声音 / 体验 / 内在状态 / 自主行为 / README 统一登记，健康检查 + 自动/手动备份 + 缺失恢复。
- 🗣️ **声音档案**：从旧记忆提炼自己的语言风格，24h 刷新；碎碎念会读旧想法/旧心情/学习笔记/相关话题，并选最不重复的一句。
- 🐋 **常驻形状**：右下角（默认贴左下，可拖拽/吸附），可缩放、可收起、可隐藏；暗色主题自动跟随 DSH。
- 📜 **每日一诗**：按日期确定性选诗（唐诗三百首 / 千家诗精选 + 宋词三百首名篇）；显示标题/作者/正文，**逐字平仄着色**（平蓝、仄红、多音灰、韵脚下划线），可开关。
- 🧭 **格律解析**：自动判定诗体（五绝/七绝/五律/七律）、起式（平起/仄起）、首句入韵、韵脚位置、粘对与对仗提示，用人话解释。
- 🎓 **格律小课堂**：12 张原创知识卡（四声与平仄、平水韵、粘对、对仗、孤平、拗救、三平调、词牌基础……）。
- 📚 **诗库**：诗词模块 → 诗库。**宋词默认精选 283 首**（宋词三百首），可一键展开「全部宋词（20,044）」；另有诗经 305 + 楚辞 65 + 千家诗 219 + 唐诗三百首古体 135 + 全唐诗/全宋诗精选 4,500。分类筛选、标题/作者/诗句/词牌搜索、分页浏览、详情平仄/词牌标注。
- 🔍 **格律检测器**：对诗库任意一首，或自己输入 4/8 句（五言/七言，可含标点），用平水韵 106 韵部逐字标注，检测诗体/起式/首句入韵/韵脚韵部（含首句借邻韵）/粘对/拗字/三平调/孤平；结果可复制。
- 🖼️ **表情彩蛋**：双击形象随机换一张日常/meme/节日立绘（2.5s 回心境立绘）；每天首次交互先打招呼；静置 ≥45 分钟才可能随机换姿态（不打扰）。
- 🔊 **声律启蒙**：30 个平声韵部（上平 15 / 下平 15），含韵目、对仗例句与例字。
- 🎵 **词牌与名篇**：15 个常见词牌基础卡 + 《宋词三百首》283 首名篇；每个词牌可看「同词牌精选 N 首」，并可按需查看「全库同词牌 M 首」（宋词全库 891 个词牌、20,044 首）。
- 💭 **心情系统**：**由模型根据当天真实情境自主决定**（聊得多、工作强度/报错、天气、时段/饭点、闲置、飞花战绩、节日…）——心情标签、理由和换哪张立绘都由模型选，**不是随机抽图**；**198 种心情立绘**：92 张静态图（89 张心情 + 3 张面板探头：今日/设置/其他 tab）+ **106 个 dsh-pet 透明动画**（webm，MIT；动画素材在 `_ref/pet-media/` 不随包，link 安装可用，npm 安装回退 92 张静态图），心情**实时随事件变化**（聊天/工具/报错/面板/自言自语/飞花/天气/回前台/时段饭点，2–4s 防抖，无固定间隔），并感知**最近在做什么**（查资料/看视频/写代码/聊天/发呆，仅用工具名不读内容）；如果我在读小说/看视频，还会读 `~/.dsh/.dsh-poetry/experience.json` 里的「正在体验 + 此刻情绪」，让表情跟着情节走（**情绪匹配优先**）；模型从图鉴里优先选匹配活动动画、优先 video 并避开最近用过的 20 张；心情之间每 **1.5–3.5 分钟**会按**轮转顺序**播放 106 个动画里的下一个（20–30s；若当前是静态心情图，10–20s 内先补一个动画，保证全部都会露脸）；气泡与「今日」tab 显示心情 chip（悬停看理由）；成长页可看心情依据/来源/失败原因、打开心情换装并「刷新心情」；mood-ai 有 27 个细腻情绪词引导（怅然/眷恋/释然/雀跃/忐忑/倦怠/…）；最近 12 条心情标签会注入 prompt 做反重复（同主题换角度而非换形容词）。
- 📖 **自言自语**：**每隔 1–2 分钟可能冒一句**（60–120 秒轮询 + 关闭面板/气泡、心情/天气更新、回到前台等事件唤醒；不设每日次数）——**由当前配置的模型实时生成它此刻的随想**（会看天气、心情、活跃度、时段和最近说过的话；不背诗、不引诗、用自己的话）；**不限制每天次数**，≥30 分钟没人理它会进入自言自语态（7–12 分钟一次）；同一句近期不重复，25s 自动关、不打扰操作、后台不弹；会从 `agent-memory/topics.json` 话题库取话题、检索 journal 旧想法/学习笔记，并按 `voice.json` 延续自己的语气；模型不可用/生成失败时就保持安静，不显示本地文案兜底；设置里可关闭，也可用「预览一句」立即看（不计次数）。
- 🌦️ **天气诗词**：读取设置城市（默认北京）的实时天气（Open-Meteo，免密钥），按晴/云/雨/雪/雷/风/寒/夜给今日诗配一句「天气诗」，形象也会换成对应的鲸鱼娘（雨伞/雪/雷/冷/夜）；天气不可用时静默回退普通选诗。
- 🖼️ **本地立绘**：92 张静态图在 `assets/generated/`（dsh-whale-musume，MIT）离线随包；另有 106 个 dsh-pet 透明动画（MIT）放在项目同级 `_ref/pet-media/`（不随包），按心情/小动作轮换播放，不联网加载。
- 🌀 **生活反应**：**快速左右拖拽会晕**（转圈动画+摇晃+💫+「别甩啦，头好晕…」，1.5–2.5s 恢复）；**早/午/晚饭点会自动吃饭**（07–09 / 11:30–13:30 / 17:30–19:30，每天每餐一次，播吃饭动画并提醒你也吃）。
- 🧠 **自主记忆**：模型自己生成的心情/碎碎念/自省/自学写入 `$DSH_HOME/agent-memory/`（只追加）；心情每条都保留，碎碎念 journal 3 分钟限频；记忆中枢负责备份/恢复，`journal.raw-2026-10-23.*` 保留整理前原始记录；不写入任何会话消息或用户原文。
- 🎮 **飞花令**：诗词模块 → 飞花——**自由输入对句**：系统先出一句含令字的诗（带出处），你直接输入一句；校验「有没有出处 / 是否含令字 / 本局是否重复」——出处可在**全量诗词**里查（构建自全唐诗/全宋诗/全宋词/蒙学，按令字分片懒加载；数据在 `_ref/feihua-full/`，不随包，缺失时回退本地句库），接上后系统自动接下一句，能接多少看你的库存（句库 **155,504 句完整句**，含全量宋词；基础 3,244 句，按需并入扩展库）。不再四选一/扣命，只记本字最佳；另有「图鉴」按令字列句与出处。气泡第 6 张卡可直接进入。
- ⚙️ **设置**：大小、平仄标注、每日/随机、自动轮播、吸附方向、简体/原文、恢复默认；心情/成长状态在成长页，设置持久化到 `$DSH_HOME/.dsh-poetry/settings.json`。
- 🔒 **零密钥、零遥测**：诗词/立绘/话题库本地存储；外部调用仅插件自己的模型（优先 `dsh-opencode-go/deepseek-v4.1-flash`，再回落 `deepseek-account/deepseek-flash`；原生 `opencode-go` 只在 `dsh-opencode-go` 不可用时兜底；若宿主默认模型本身指向原生 `opencode-go`（缺 `x-opencode-session` 头会 400），插件会自动改用 deepseek 账号兜底；心情 low / 碎碎念·成长·声音 high 推理）与本机天气查询，无遥测；可用 `DSH_POETRY_MODEL_PROVIDER`/`DSH_POETRY_MODEL`/`DSH_POETRY_OPENCODE_GO`/`DSH_POETRY_REASONING_*` 覆盖。

## 安装

### 官方桌面端（Electron 客户端，当前主要形态）

桌面端 profile 由客户端独占，**不要**手改 `~/.dsh/profiles/desktop`。在 DSH 会话里让宿主内置 `plugin_manager` 安装本地目录（本项目为 `link:` 安装，改源码即生效）：

```
plugin_manager install_bundle
target: <本项目绝对路径，即包含 package.json 的那一层>
```

首次安装后如未出现挂件，完全退出客户端再打开；之后前端改动刷新页面即可，宿主 `index.js` 改动需要重启宿主。

### 从 GitHub 安装（插件市场同款，推荐分享给他人）

```sh
dsh plugin --profile web add github:qingwu-aby/dsh-poetry-widget
# 自然重启 dsh web，然后浏览器 Ctrl+F5
```

### 从 npm 安装（发布后可用）

```sh
dsh plugin --profile web add dsh-poetry-widget
```

### 本地开发安装（link）

```sh
dsh plugin --profile web add link:<本项目绝对路径>
# 重启 dsh web，然后浏览器 Ctrl+F5
```

## 使用

- 点击形象：按「今日诗 → 格律解析 → 知识卡 → 声律启蒙 → 词牌名篇 → 收起」循环。
- 气泡内「展开面板」：5 个 tab（今日 / 课堂 / 韵部 / 词牌 / 设置）。
- 右键/长按形象：菜单（大小、平仄标注、每日/随机、自动轮播、吸附、隐藏、关于）。
- 「换一首」：每日模式按日期滚动，随机模式随机。

## 数据来源与许可

| 数据 | 来源 | 许可 |
|---|---|---|
| 《唐诗三百首》《千家诗》精选 + 全唐诗/全宋诗语料 + 逐字平仄（strains） | [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) @ `b8594f81` | MIT |
| 《宋词三百首》280 首（默认精选）+ 全量宋词 20,044 首（按需展开）+ 词牌 | 同上（`宋词/ci.song.*.json`、`宋词/宋词三百首.json`） | MIT |
| 声律启蒙、唐诗三百首、千家诗 | 同上（`蒙学/`） | MIT / 公版文本 |
| 格律知识卡、词牌卡文案 | 本项目原创（公版格律常识） | MIT |
| 构建期押韵校验字表 | [rbnyng/pingshui_rhyme](https://github.com/rbnyng/pingshui_rhyme)（平水韵，公版文本） | MIT（仅构建期 QA，不随包） |
| 角色形象 | [dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume) | MIT |

诗词文本为公版古籍；数据构建期会做繁体→简体逐字转换并保留 `linesOriginal` 原文供切换，并用公版《平水韵》字表做构建期押韵校验（不随包）。构建脚本见 `scripts/`，产物见 `data/`；`data-src/` 内置构建所需的 curated 源快照，可完全离线重建（完整语料缓存路径见 `data-src/README.md`）。运行时的诗词/立绘全部本地，仅「天气」一项会请求 Open-Meteo（可关）。

## 致谢

- 交互与工程结构参考 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT，未使用其美术素材）。
- 角色形象来自 [dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)（MIT, Copyright (c) 2026 Sutera-Diffusus）。
- 数据来自 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT, Copyright (c) 2016 JackeyGao）。

## 卸载

```sh
# 桌面端：在会话里让宿主内置 plugin_manager 执行 remove_bundle，target=dsh-poetry-widget
# 命令行 dsh web：
dsh plugin --profile web remove dsh-poetry-widget
```

卸载后挂件与路由立即消失；用户数据在 `$DSH_HOME/.dsh-poetry/settings.json`，不需要可手动删除。

## 开发期生效方式

- 前端 `client.js` 改动：刷新页面（Cmd+R / Ctrl+F5）即可。
- 宿主 `index.js` / `lib/**` 改动：在 `plugin_manager` 里把本 bundle 关→开（`set_bundle` false/true）即可重新加载模块，无需重启整个客户端。
- 数据 `data/*.json`（link 安装）：宿主按文件 mtime 失效缓存，刷新页面即可。


## 开发

```sh
node scripts/build-data.mjs        # 从 chinese-poetry 生成 data/*（可复现，需 _ref/poetry-data 或网络）
node scripts/validate-data.mjs     # 数据质量门
node --test tests/data.test.mjs    # 数据管道单测
node --test tests/host.test.mjs    # 宿主路由/设置单测
node --test tests/client.test.mjs  # 客户端 factory/纯函数单测
node tests/integration/verify.mjs  # 集成验收（需要宿主已加载新代码）
```

接口契约见 [docs/contract.md](./docs/contract.md)，验收清单见 [docs/acceptance.md](./docs/acceptance.md)，整体计划见 [PLAN.md](./PLAN.md)。

目录：

```
index.js / lib/    宿主半区：静态资源 + /api/dsh-poetry/* 数据与设置接口
client.js          浏览器半区：shell.overlay 内的 React 挂件（无构建、无 JSX）
data/              离线数据产物（poems / ci / yun / knowledge / manifest）
scripts/           数据抓取、构建、校验
content/           格律知识卡与词牌卡原始稿（构建期并入 data/knowledge.json）
assets/            形象与图标
tests/             node:test 单测 + 集成验收脚本
```

## 兼容性说明：OpenCode Go 适配器（task-71）

`dsh-opencode-go@0.1.24` 是按更新版 DSH 构建的：它的 `lib/index.js` 从
`@deepseek-ai/dsh-typert-protocol` 导入 `RemoteError`，而 DSH `0.2.1`（rc.2 起）已移除该导出，
插件会加载失败、provider `dsh-opencode-go` 不注册，插件模型调用只能回落原生 `opencode-go`
（zen/go 网关已废弃，必然 400）。

本仓库提供幂等补丁脚本（只改已安装包里的一个文件，首次修改前自动备份）：

```
node scripts/patch-dsh-opencode-go.mjs --dry-run   # 检查
node scripts/patch-dsh-opencode-go.mjs             # 打补丁（默认 profile: desktop）
```

补丁把导入收窄为 `TypertRemoteService`，并内联等价的 `RemoteError` 类（`code`/`message`/`data`）。
打完补丁重启 DSH（或重载 profile）后，`dsh-opencode-go` 才会注册。插件升级/重装后可能需要重跑。

另一个已知行为：Go 网关上的 `deepseek-v4.1-flash` 默认开启 thinking，且 catalog 没有 `off`
档无法关闭，推理 token 与正文共享 `max_tokens`。因此策略给该候选附 `maxTokensFloor`
（心情/成长/声音 1600、碎碎念 1200），避免小预算被推理吃光后出现空响应；正文长度仍由提示词约束。

## 已知限制

- 押韵只标韵脚位置与「平声韵」属性（构建期已用《平水韵》校验韵脚，但界面不展示 106 韵部字表）；任意诗句格律检测器在 v2。
- 词牌卡只讲基础（字数/句式/韵脚概括），不提供逐字词谱。
- 未在 `dsh web`（web profile）与 Windows/Linux 实机验证。
- 数据为公版古籍文本，原书本身存在异文/讹字；构建脚本会丢弃平仄标注不可靠、押韵不合、含罕见扩展汉字的诗。
- 诗 320 首（选集精选 271 + 名家补足 49）、词 283 首（《宋词三百首》280 + 3 首补缺名篇）；部分名篇含拗救/变格，解析文案会注明（如《黄鹤楼》《登金陵凤凰台》）。

## 许可

代码 MIT；第三方数据/素材许可见 [PROVENANCE.md](./PROVENANCE.md)。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
