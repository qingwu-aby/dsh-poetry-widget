# 诗词格律挂件（DSH Plugin）—— 任务计划 v0.1

> 状态：**已交付（M0–M8 完成并安装验收）**；M1–M8 的完成记录见文末 §13–§16，剩余可选项见 §17。
> 目标宿主：DeepSeek Harness **0.2.1-rc.3**（engines `^0.2.1-rc.2`），当前 profile = `desktop`，GUI 端口随启动变化
> 参考项目：`MeteorNOX/DeepSeek-Balance-Whale-Widget`（交互/工程结构参考，代码 MIT；**美术素材不在 MIT 范围，一律不复用**）
> 数据来源：`chinese-poetry/chinese-poetry` @ `b8594f81`（MIT）＋ 公版诗词文本
> 调研缓存：`_ref/whale-widget/`（浅克隆）、`_ref/poetry-data/`（blobless 克隆，按需取文件）

---

## 0. 一句话目标

在 DSH Web GUI 右下角（避开已有鲸鱼挂件）常驻一个**原创的诗词挂件**：点开是「今日一诗 + 逐字平仄 + 体式解析」，并把**基础诗词格律知识**（四声平仄、粘对、押韵、对仗、粘对、词牌、声律启蒙 30 韵部）做成可浏览的小课堂。全部离线、零密钥、零外部请求。

**明确假设**：这是**新插件**，不修改、不替换已安装的 `dsh-whale-widget@0.4.2`；两个挂件可共存（不同插槽 id / 路由前缀 / 数据文件；默认位置错开）。

---

## 1. v1 范围（MVP）

### 1.1 必须包含

| # | 能力 | 说明 |
|---|---|---|
| 1 | 挂件本体 | 原创 SVG 形象、右下/左下可拖拽、60%–160% 缩放、收起/展开、点击冒泡、主菜单、设置持久化、隐藏与恢复 |
| 2 | 今日一诗 | 按日期确定性选诗；标题/作者/正文；**逐字平仄标注**（平/仄/多音可平可仄，可开关）；自动判定**诗体**（五绝/七绝/五律/七律）、**起式**（平起/仄起）、**首句入韵**、**韵脚位置**、**粘对是否成立** |
| 3 | 格律解析卡 | 用人话解释该诗格律（例：「仄起首句不入韵；二四六分明；第 2、3 联粘对成立；第 3、4 联对仗」） |
| 4 | 格律小课堂 | **12 张原创知识卡**（见 §5），配数据中的真实例句 |
| 5 | 韵部速查 | 《声律启蒙》**30 个平声韵部**（上平 15 / 下平 15），含韵目与对仗例句 |
| 6 | 词牌与名篇 | 常见**词牌 12–15 张**基础卡 + 宋词名篇 **300 首**（按热度），显示词牌/作者/正文/名句 |
| 7 | 设置 | 大小、自动轮播、平仄标注、每日/随机、吸附、繁简（若采纳）、隐藏、恢复默认、关于 |
| 8 | 工程 | bundle + Host + Client 双半区；`$DSH_HOME` 持久化；路由信任栅栏；i18n zh/en；插件图标与显示元数据；README；naming 声明；单元测试 |
| 9 | 安装验证 | 用 `plugin_manager install_bundle` 装进当前 `desktop` profile，刷新 GUI 后可见、可用、可卸载 |

### 1.2 v1 不做（放 v2）

- 全量语料（100MB+）或运行时在线取数。
- 完整《平水韵》106 韵部字表、任意用户诗句的格律检测器（需要「字→韵」全表）。
- 词牌完整词谱（逐字平仄谱）、词作格律检测。
- 音效 / TTS 朗读 / 分享卡片导出 / 竖排排版。
- npm 发布、GitHub 建仓、社区注册表登记（外部发布需单独确认）。

---

## 2. 本次调研已确认的事实（不是猜测）

| 项 | 结论 | 证据 |
|---|---|---|
| 宿主版本 | DSH `0.2.1-rc.3`（兼容 `^0.2.1-rc.2`）；`DSH_PROFILE=desktop`；GUI 端口随启动变化 | `dsh --version`、环境变量 |
| 已装插件 | `dsh-whale-widget@0.4.2`、`dsh-market`、`dsh-context` 等 | `~/.dsh/profiles/desktop/package.json` |
| 前端扩展点 | **`shell.overlay` 插槽真实存在**：list 类型、frame-wide 浮层、click-through、可加新 id（additive），注册参数 `{id, order, label}`；当前 12 个 occupant | `cordis_inspect_query` Client `Slots.listSubTree` |
| 官方模板 | 装饰插件模板 = bundle（`dsh.bundle.patch`）+ Client 半区（`dsh.client` + `./client` 导出 + `window.__ModuleLoader__.load`） | 本机 DSH 内置 skill 模板 |
| 鲸鱼架构 | 标准 bundle；Host 用 `webServer.register` + `tapIndex` 注入 vanilla JS；设置写 `$DSH_HOME/.dshw-*.json`；写接口仅限回环地址 | 源码 `_ref/whale-widget/lib/index.js` |
| 鲸鱼安装 | 桌面端必须用宿主内置 `plugin_manager`，不能用 `dsh plugin --profile web`；本机 shell 跑 `dsh plugin` 还会被文件沙箱拦（写 `~/.dsh` 被拒） | 实测 + README |
| 数据仓库 | `chinese-poetry` MIT（c) 2016 JackeyGao）；当前 HEAD `b8594f81`（2026-06-17） | 仓库 LICENSE / git |
| 平仄数据 | `strains/` 有 **313 个文件**，与 `全唐诗/poet.{tang,song}.*` 的 313 个 chunk **逐条索引对齐**；`strains` 为逐字 `平/仄/○/？`（○=多音可平可仄，？=存疑），标点随文 | 抽样比对 chunk 0 |
| 平仄数据质量 | chunk 0 的 4000 句里约 **106 句（2.6%）** 文本与平仄长度不匹配（原数据误差）→ 必须在构建期丢弃/降级 | 抽样统计 |
| 热度数据 | `rank/poet/*` 313 个与诗 chunk 对齐（baidu/bing/google/so360）；`rank/ci/*` 23 个与词 chunk 对齐 | 抽样比对 |
| 诗数据 | 全唐诗 58 chunk + 全宋诗 255 chunk，每 chunk 1000 首，繁体，`{author, paragraphs, title, id}` | 抽样 |
| 词数据 | 宋词 22 chunk，每 chunk 1000 条，简体，`{author, paragraphs, rhythmic}`，`rhythmic` = 词牌 | 抽样 |
| 精选/教学数据 | `蒙学/tangshisanbaishou.json`（320 首，7 种体式）、`qianjiashi.json`（219 首）、`shenglvqimeng.json`（30 韵部 ×3 段） | 解析统计 |
| 数据缺口 | 仓库内**没有**「字 → 平水韵韵部」字典，也没有完整词谱 | 目录检索 |

---

## 3. 技术方案

### 3.1 总体架构

```
DSH Web GUI（Electron desktop profile, 127.0.0.1:57623）
│
├─ Host 半区：index.js（bundle 行 dsh-poetry-widget）
│    ├─ webServer 路由 /dsh-poetry/api/*
│    │    ├─ bootstrap / poems / ci / yun / knowledge / about / settings
│    │    └─ 静态资源（mascot.svg 等）
│    ├─ 数据加载器：包内 data/*.json（内存缓存 + ETag）
│    ├─ 设置存储：$DSH_HOME/.dsh-poetry/settings.json（原子写）
│    └─ 信任栅栏：复用 connection.requestRejection；写接口仅回环地址
│
└─ Client 半区：client.js（dsh.client, platform=web, immediately）
     └─ ctx.slots.register('shell.overlay', { id: 'dsh-poetry-widget', order: 80 })
          └─ <PoetryWidget/>（React，来自浏览器模块表）
               ├─ 形象 + 气泡（仅占用区域接收 pointer 事件，其余 click-through）
               ├─ 卡片序列：今日诗 → 格律解析 → 知识卡 → 韵部 → 词牌 → 收起
               ├─ 展开面板：今日 / 课堂 / 韵部 / 词牌 / 设置（含关于）
               └─ fetch Host JSON + localStorage 缓存 + 宿主主题 token
```

### 3.2 关键技术决定

| 决定 | 选择 | 理由 / 备选 |
|---|---|---|
| 前端形态 | **Client 插件 + `shell.overlay`** | 官方扩展点，已实测存在；比鲸鱼的 `tapIndex` 注入脚本更规范、能被插件管理页管理、样式继承主题 |
| 数据供给 | **Host 路由 + 包内 JSON** | 数据 ~800KB，不进 client bundle；离线、可缓存 |
| 平仄/体式计算 | **构建期预计算**（数据里直接带 form/qi/rhymeIdx/粘对结果） | 避免 Host/Client 两处重复实现；客户端只渲染；单测只测构建脚本 |
| 设置持久化 | Host 写 `$DSH_HOME/.dsh-poetry/settings.json`；localStorage 只做首屏缓存 | 与鲸鱼一致，多窗口一致，可审计 |
| 与鲸鱼关系 | 独立插件、独立 id/路由/数据目录；默认贴**左下** | 鲸鱼默认右下，避免重叠；不读取对方 DOM（skill 禁止） |
| 降级方案 | 若 M0 发现该宿主版本 client 插件渲染异常 → 退回鲸鱼式 `webServer.register + tapIndex` 注入 vanilla JS | 已在本机验证可行，只是体验/可维护性略差 |

### 3.3 文件树（规划）

```
dsh-poetry-widget/
├── package.json              # name/version/exports/files + dsh.bundle + dsh.client + icon
├── cordis.patch.yml          # - insert: [{ id: dsh-poetry-widget, name: dsh-poetry-widget }]
├── index.js                  # Host 半区：路由、数据加载、设置、about
├── client.js                 # Client 半区：ModuleLoader factory + shell.overlay 组件
├── lib/
│   ├── data-store.mjs        # 包内 data 读取/校验/内存缓存
│   ├── settings-store.mjs    # $DSH_HOME 原子读写
│   └── trust.mjs             # 信任栅栏 + 本机写保护（复用鲸鱼模式）
├── data/                     # 构建产物（随包，离线）
│   ├── manifest.json         # dataVersion / 源 commit / 计数 / 许可
│   ├── poems.json            # ~500 首近体诗（含平仄/体式/韵脚）
│   ├── ci.json               # ~300 首宋词名篇
│   ├── yun.json              # 声律启蒙 30 韵部
│   └── knowledge.json        # 12 张格律卡 + 12–15 张词牌卡
├── content/                  # 知识卡原始稿（人工撰写，build 时并入 data/knowledge.json）
├── scripts/
│   ├── fetch-data.mjs        # 开发期取 chinese-poetry 原始数据（支持本地缓存/源路径）
│   ├── build-data.mjs        # 三源对齐 → 筛选 → 生成 data/*
│   ├── validate-data.mjs     # 质量门（见 §4.6）
│   └── stats.mjs             # 输出筛选率/分布/体积报告
├── assets/                   # 原创 mascot.svg / icon.svg / 纸纹（无第三方美术素材）
├── locale/zh.json, en.json   # meta.title/description + UI 文案
├── tests/                    # node:test：data / host / client factory 冒烟
├── dsh-plugin.naming.json    # 外部插件命名声明（离线校验）
├── README.md                 # 功能、安装、数据来源与致谢、已知限制
└── CHANGELOG.md（可选）
```

### 3.4 Host 路由（前缀 `/dsh-poetry/`，全部经信任栅栏）

| 路由 | 方法 | 返回 |
|---|---|---|
| `/dsh-poetry/api/bootstrap.json` | GET | `{ok, version, dataVersion, source:{repo,commit,license}, today:{date, poemId}, counts, config}` |
| `/dsh-poetry/api/poems.json` | GET | `{items:[{id,title,author,strain,lines,tones,form,qi,firstRhyme,rhymeIdx,score}]}` |
| `/dsh-poetry/api/ci.json` | GET | `{items:[{id,author,rhythmic,lines,score}]}` |
| `/dsh-poetry/api/yun.json` | GET | `{volumes:[{title,chapters:[{name,rhymeChars,couplets}]}]}` |
| `/dsh-poetry/api/knowledge.json` | GET | `{cards:[...], ciCards:[...]}` |
| `/dsh-poetry/api/settings.json` | GET / PUT | GET 返回设置；PUT 仅回环来源可写 |
| `/dsh-poetry/api/about.json` | GET | 版本、数据版本、文件路径（脱敏）、数据源 commit、许可 |
| `/dsh-poetry/assets/*` | GET | 原创 SVG/PNG（`Cache-Control: no-store`） |

要求：任何异常都返回 **200 + JSON**（`{ok:false, error}`），不悬挂；4xx/5xx 语义明确；不返回任何凭据/PII。

### 3.5 数据与状态

- 随包数据只读；运行时**不写** `data/`。
- `$DSH_HOME/.dsh-poetry/settings.json`：`{schemaVersion, scale, showTones, mode, autoplay, snap, hidden, script, theme, lastPoemId, updatedAt}`。
- 每日诗选择：`sha256("YYYY-MM-DD" + dataVersion) % poems.length`，换一首 = 顺序指针，用户可「回到今日」。
- 首次运行无设置文件时用默认值，不报错。

### 3.6 安全与隐私

- 所有路由接入 DSH 浏览器信任栅栏（`connection.requestRejection`），裸 curl 预期 401/403，浏览器同源正常。
- 写接口（PUT settings）**仅接受回环地址**；跨站标记/异源拒绝（复用鲸鱼 0.3.15 模式）。
- 零凭据、零外部网络；不采集任何用户输入/会话内容。
- 数据全是公版诗词 + 原创知识卡，无 PII。

### 3.7 i18n 与主题

- 文案走 Client locale 服务；zh-CN 默认、en 回退；`locale/*.json` 同时提供插件显示标题/描述。
- 容器/按钮用宿主主题 token（明暗自动）；角色 SVG 与纸张质感允许自有配色。

---

## 4. 数据方案（chinese-poetry）

### 4.1 数据源清单与用途

| 目录 | 内容 | 规模 | v1 用途 |
|---|---|---|---|
| `全唐诗/poet.tang.*` + `poet.song.*` | 唐诗 5.7 万 / 宋诗 25.5 万，繁体 | 313 chunk | 诗文本主源 |
| `strains/json/poet.{tang,song}.*` | 逐句逐字平仄，`○`=多音可平可仄，`？`=存疑 | 313 文件（索引对齐） | **平仄标注**唯一来源 |
| `rank/poet/*` | 诗热度（baidu/bing/google/so360/bing_en） | 313 文件（索引对齐） | **名篇筛选** |
| `宋词/ci.song.*` | 宋词 2.2 万，简体，含词牌 | 22 chunk | 词文本 |
| `rank/ci/*` | 词热度 | 23 文件（索引对齐） | 名词筛选 |
| `蒙学/tangshisanbaishou.json` | 唐诗三百首 320 首，7 体式分类，繁体 | 149KB | 名篇兜底 / 人工校验 |
| `蒙学/qianjiashi.json` | 千家诗 219 首（五绝/五律/七绝/七律） | 69KB | 补充名篇 |
| `蒙学/shenglvqimeng.json` | 声律启蒙 30 韵部 ×3 段 | 30KB | 韵部速查 / 对仗例句 |
| `御定全唐詩/*` | 901 文件，与全唐诗重复 | 大 | v1 不用 |

### 4.2 诗：三源对齐 → 名篇筛选（build 脚本）

1. 读取 chunk `n` 的诗/strains/rank；校验三者条数一致、`id` 对应。
2. **平仄清洗**：按句比对「去掉标点的文本」与「去掉标点的平仄串」；长度不等或含 `？` 的句子标记不可靠；**整首有任一不可靠句 → 丢弃该首**（保证标注 100% 可信）。
3. **近体诗过滤**：4 句或 8 句；每句 5 字或 7 字；按「一三五不论、二四六分明」匹配 4 种标准格式，排除孤平/三平调/三仄尾；选出匹配度最高且 0 违例的诗。
4. **派生字段**：诗体（五绝/七绝/五律/七律）、起式（平起/仄起）、首句入韵（首句末字为平）、韵脚位置（偶数句末字 + 首句入韵时首句末字）、粘对检查结果、对仗位置（律诗的 3/4 句、5/6 句）。
5. **排序选优**：热度归一化（各引擎取对数后加权）→ 过滤超短/超长标题 → 作者配额（单人 ≤10 首）→ 取 **Top 500**。
6. **精选兜底**：唐诗三百首/千家诗中未进入 Top 的诗，按「作者 + 首句」与全唐诗匹配，命中则借用平仄并入（目标命中率 ≥70%，实测后写报告）。
7. 输出 `poems.json`，带 `source` 标记（`strains` / `curated-matched`）。

### 4.3 词：热度选名篇

宋词 + `rank/ci` → 去掉空白/重复（author + rhythmic + 首句）→ 热度 Top 300 → 附词牌名（`rhythmic`）与名句（正文首句/高频金句候选，人工抽检）。

### 4.4 韵部与知识

- `yun.json`：声律启蒙上/下卷 30 韵部，每部 3 段原文；韵目名（一东…十五咸）；每韵挑 4–8 个韵脚例字（人工/半自动），只作「韵部教学示例」，**不承诺全字表**。
- `knowledge.json`：12 张格律卡 + 12–15 张词牌卡，来自 `content/` 原创稿，构建时校验 schema。

### 4.5 产物与体积预算

| 文件 | 目标 | 预算 |
|---|---|---|
| `poems.json` | 500 首（含平仄/体式） | ≤ 450 KB |
| `ci.json` | 300 首 | ≤ 220 KB |
| `yun.json` | 30 韵部 | ≤ 80 KB |
| `knowledge.json` | 12 + 15 卡 | ≤ 90 KB |
| `manifest.json` + 其他 | — | ≤ 10 KB |
| **合计** | | **≤ 850 KB**（按模块懒加载，首屏只取 bootstrap + 今日诗） |

### 4.6 质量门（`validate-data.mjs` + 单测）

- 三源条数与 id 对齐 100%；输出统计（各过滤阶段丢弃率）。
- 诗：每首 4/8 句、每句 5/7 字、平仄串与文本逐字等长（去标点）、无 `？`。
- 体式判定：4 种格式 × 标准例句单测 100% 通过。
- 韵脚位置：偶数句末字；首句入韵诗首句末字为平。
- 作者分布：单人 ≤10 首；标题去重。
- 人工抽检 30 首（李白/杜甫/王维/李商隐/杜牧/白居易/刘禹锡/王昌龄…），逐首核对平仄、体式、韵脚。
- 词：300 首、词牌分布抽样 20 条核对；声律启蒙 30 韵部完整。
- 体积/字段 schema 校验；构建可复现（同源 commit → 同输出 hash）。

---

## 5. 格律知识体系（v1 内容清单）

### 5.1 十二张格律卡（原创撰写，配真实例句）

1. 四声与平仄（平上去入；普通话入声消失的坑）
2. 平水韵与押韵（30 平声韵；一韵到底；首句可借韵）
3. 近体诗 vs 古体诗（为什么只讲近体）
4. 四种基本句式（五言 4 式 + 七言扩展规则）
5. 四种标准格式（仄起/平起 × 首句入韵/不入韵）
6. 粘与对（二四六分明的来历）
7. 对仗（律诗颔联/颈联；绝句可不对）
8. 孤平（为什么「平平仄仄平」第一字不能仄）
9. 拗救（本句救 / 对句救，2 个典型例）
10. 三平调与三仄尾
11. 词牌与词谱基础（词林正韵、上下阕、字数、领字）
12. 怎么用这个挂件学格律（学习路线 + 自测建议）

### 5.2 三十韵部（声律启蒙）

上平：一东、二冬、三江、四支、五微、六鱼、七虞、八齐、九佳、十灰、十一真、十二文、十三元、十四寒、十五删
下平：一先、二萧、三肴、四豪、五歌、六麻、七阳、八庚、九青、十蒸、十一尤、十二侵、十三覃、十四盐、十五咸

### 5.3 词牌卡（12–15 张，只讲基础，不逐字标词谱）

浣溪沙、蝶恋花、临江仙、水调歌头、念奴娇、定风波、雨霖铃、声声慢、如梦令、虞美人、鹊桥仙、青玉案、破阵子、鹧鸪天、满江红（可按热度增删）。

每卡字段：词牌名 / 别名 / 常见字数与句式 / 韵脚特点 / 代表名句（来自选出的宋词）/ 一句话风格。

---

## 6. 交互与视觉规格（v1）

### 6.1 点击序列（默认「点击推进」，可切「回到今日」）

```
今日一诗 ──► 格律解析 ──► 今日知识卡 ──► 声律启蒙一句 ──► 词牌名篇 ──► 收起
   ▲                                                                   │
   └────────────────────────── 再点回到 1 ◄────────────────────────────┘
```

- 每个气泡右下角小按钮「展开面板」；气泡内可点「再来一首 / 下一张」。
- 气泡不遮输入框：尺寸限制 + 可拖拽；贴边自动收窄。

### 6.2 展开面板（约 420×560，明暗跟随）

Tab：**今日**（诗 + 平仄 + 解析）、**课堂**（12 卡目录）、**韵部**（30 韵部按上/下平分组）、**词牌**（词牌卡 + 名篇词）、**设置**（含「关于/数据来源」）。
- 平仄展示：平=蓝、仄=红、多音=灰虚线、韵脚=下划线/圆点；可一键「只看句式」。
- 键盘：Tab 焦点、Esc 关闭、Enter 触发；`prefers-reduced-motion` 关闭动效。

### 6.3 菜单与设置

- 右键形象 / 气泡内 ☰：大小（60–160%）、吸附（左下/右下/自由）、平仄标注开关、每日/随机、自动轮播（关/30s/60s/5min）、显示原文（若采纳繁简方案）、隐藏挂件（隐藏后长按 1.5s 或双击空白处恢复）、关于。
- 设置改动即时生效、自动保存；「恢复默认」二次确认。

### 6.4 视觉/性能/无障碍

- 原创 SVG 形象（默认「毛笔精灵·小诗灵」，可换「小书童」「诗卷猫」方案）；图标即形象简化版。
- 首屏：只加载 bootstrap + 今日诗；面板打开才加载 poems/ci/yun/knowledge。
- client 入口代码目标 ≤120KB（未压缩，含样式）；首屏可交互不晚于 300ms（本地）。
- 挂件使用 `pointer-events: auto`，浮层其他区域 click-through；不拦截 DSH 交互。

---

## 7. 里程碑与验收门

> 工作量估算（人日）：单人串行约 6.5；用 Agent Teams 并行，M1–M4 可同时推进，墙钟约 2–3 轮。

| 阶段 | 内容 | Owner | 前置 | 验收门 |
|---|---|---|---|---|
| **M0** 技术验证 | 最小 bundle（bundle+client+locale+icon）→ `plugin_manager install_bundle` → 刷新页面 → `Slots` 确认 occupant → 记录热更新方式 | Lead | — | GUI 出现测试徽标；插槽 occupant=我们的 id；失败则切换 tapIndex 方案并重做 M0 |
| **M1** 数据管道 | fetch/build/validate/stats + 数据产物 + 单测 | data | —（可与 M0 并行） | 质量门全过；抽检 30 首无误；体积 ≤850KB；可复现 |
| **M2** Host 半区 | 路由、数据加载、设置存储、信任栅栏、about + 单测 | host | 契约冻结 | 单测全过；异常路径返回 JSON；裸请求 401/403 |
| **M3** Client 半区 | shell.overlay 挂件、气泡序列、面板、拖拽/缩放、设置、主题/i18n | client | 契约冻结 + M0 | 页面可见可交互；无控制台报错（用户确认）；卸载后消失 |
| **M4** 知识内容 | 12 格律卡 + 30 韵部卡 + 12–15 词牌卡 + 文案校对 | content | — | 逐卡事实校对（平仄规则由 M1 单测兜底）；例句与数据一致 |
| **M5** 集成验证 | 安装 → 刷新/重启 → 功能清单逐项 → 设置持久化 → 卸载回归 → 报告 | Lead | M1–M4 | §9 清单全绿（浏览器视觉以用户确认为准） |
| **M6**（可选）打包发布 | npm pack 检查、README、naming 校验、registry query | Lead | M5 + 用户明确要求 | 默认不做，外部发布需单独确认 |

**契约冻结**：M0 结束前由 Lead 写 `docs/contract.md`（JSON schema + 路由 + 设置字段 + 组件数据 shape），M2/M3 以此为唯一接口，冻结后变更须 Lead 同意并同步两侧。

---

## 8. 团队分工与协作规则（Agent Teams）

| 角色 | 目标名 | 写作用域（互不重叠） | 任务 |
|---|---|---|---|
| Lead | `lead` | `package.json`、`cordis.patch.yml`、`README.md`、`dsh-plugin.naming.json`、`locale/**`、`docs/**`、`tests/integration/**` | 契约、M0、集成、安装/卸载、最终验收、最终 diff 复核与测试 |
| 数据 | `data-pipeline` | `scripts/**`、`data/**`、`tests/data/**` | M1 + 质量门 |
| 宿主 | `host-plugin` | `index.js`、`lib/**`、`tests/host/**` | M2 |
| 前端 | `client-widget` | `client.js`、`assets/**`、`tests/client/**` | M3 |
| 内容 | `content-author` | `content/**` | M4 |

规则：

1. 只有 **Lead** 调用 `plugin_manager`（安装/卸载/查询），其余成员只读宿主状态；每次安装前报告目标、来源、版本、回滚办法。
2. 共享任务板：每个任务写清 `write_scopes` 与 `blocked_by`；M3 依赖契约冻结；M5 依赖 M1–M4 完成。
3. 接口契约以 `docs/contract.md` 为准；schema 变更 → Lead 决定 → 通知受影响成员。
4. 成员先 `team_task_get` 再 claim，完成时附证据（命令、输出、文件路径、截图/说明）。
5. Lead 在 M5 前跑全量测试并复核最终 diff；不把「安装成功」当作「功能可用」。

---

## 9. 验证与验收清单

| 类别 | 检查项 | 方式 |
|---|---|---|
| 静态 | `node --check` 全部 JS；单测全过；无运行期第三方依赖（除 dev 依赖） | 本地命令 |
| 数据 | §4.6 质量门；构建 hash 可复现；体积 ≤850KB | `validate-data` + stats |
| 安装 | `install_bundle` 返回 `applied`；`Slots` 出现 occupant `dsh-poetry-widget`；必要时重启后仍生效 | `plugin_manager` + `cordis_inspect_query` |
| 功能 | 挂件可见/可拖/可缩放；点击序列 6 步；面板 5 tab；每日诗与日期一致；平仄/体式正确；设置刷新后保留；跨重启保留 | 手工 + 用户视觉确认 |
| 边界 | 数据缺失/404/权限拒绝时显示友好空态；不遮挡输入框；不拦截宿主点击 | 手工 |
| 安全 | 无凭据请求读接口 → 401/403；非回环写 → 403；无外部网络请求 | 测试 + 代码审查 |
| 卸载 | `remove_bundle` 后挂件消失、无残留路由报错；数据目录说明 | 手工 |
| 未覆盖 | Electron 内浏览器 DOM 自动化受限 → 视觉以用户确认为准；未在 `web` profile 验证；未做 Windows/Linux | 报告注明 |

---

## 10. 风险与对策

| # | 风险 | 概率/影响 | 对策 |
|---|---|---|---|
| R1 | 该宿主版本 Client 插件 + `shell.overlay` 实际渲染异常 | 中 / 高 | M0 先做最小验证；失败即切鲸鱼式注入方案（已证明可行） |
| R2 | strains 平仄数据有 2.6% 句不匹配，过度过滤导致名篇丢失 | 中 / 中 | 丢弃不可靠句/首；唐三百兜底匹配；报告各阶段产出率 |
| R3 | 体式判定误判（拗体、多音字） | 中 / 中 | 严格过滤（0 违例才标「合律」）；`○` 在关键位 → 降级显示「可平可仄」；抽检 |
| R4 | 繁简混排（诗繁体、词简体） | 高 / 低 | D2 决策：构建期逐字转简体 + 保留原文开关；或原文优先 |
| R5 | 押韵无法验证韵部（无平水韵字表） | 高 / 中 | v1 只标韵脚位置与「平声韵」；v2 引入公版平水韵 106 韵部 |
| R6 | Host 改动需重启 Electron 应用，迭代慢 | 中 / 中 | 先把 Host 一次性做稳；前端改动只刷新页面；安装用 link 本地目录 |
| R7 | 与鲸鱼挂件位置/层级冲突 | 中 / 低 | 默认左下、可拖拽；独立 id；不读对方 DOM |
| R8 | 美术/代码版权 | 低 / 高 | 全部原创 SVG；不复制鲸鱼 assets；README 致谢 + MIT 引用说明 |
| R9 | 团队并行写冲突 | 中 / 中 | 写作用域互斥；契约冻结；Lead 只碰集成文件 |

---

## 11. 待你确认的决策（★=推荐默认）

| # | 决策 | 选项 |
|---|---|---|
| D1 | v1 内容范围 | **★A：诗（名篇+平仄解析）+ 格律课堂 + 声律启蒙韵部 + 词牌与名篇词**；B：只做诗 + 课堂；C：A + 格律检测器（工期 +2 人日，需平水韵表） |
| D2 | 繁简显示 | **★简体默认 + 可切原文（构建期逐字映射，保平仄对齐）**；或 A 原文优先（诗繁体/词简体，不做转换，省 0.5 人日） |
| D3 | 平水韵完整表 / 格律检测器 | **★v2 再做**（v1 只标韵脚与平声属性）；若 v1 就要，需引入第二个公版数据源并 +1.5 人日 |
| D4 | 形象与名称 | **★小诗灵（毛笔精灵）**；备选：小书童 / 诗卷猫。插件显示名「诗词格律挂件」，包名 `dsh-poetry-widget` |
| D5 | 安装范围 | **★当前 desktop profile（当前 GUI）**；是否同时支持 `dsh web`（只多一次安装与说明，代码相同） |
| D6 | 发布 | **★仅本地安装**；GitHub 建仓 / npm 发布 / 社区登记 → 单独确认（外部发布边界） |
| D7 | 图形界面验收 | 安装后由你在 GUI 里点一遍确认视觉；我提供逐项验收清单 |

> 回复「按推荐」即可；或逐条改。D1–D4 确认后我开始 M0，并同时创建共享任务板、spawn 数据/宿主/前端/内容 4 名 teammate。

---

## 12. 下一步（确认后立即执行）

1. 创建 `dsh-poetry-widget/` 工程骨架 + `docs/contract.md`（Lead）。
2. M0 最小验证：安装 → 刷新 → 插槽确认 → 记录 SOP（Lead）。
3. 并行启动 M1 数据管道 / M2 Host / M3 Client / M4 内容（4 名 teammate，写作用域互斥）。
4. M5 集成、逐项验收、卸载回归；交付 README + 验收报告 + 可复用命令。

---

## 附：调研缓存与许可

- 参考源码：`_ref/whale-widget/`（浅克隆，13MB，仅研究用，不随插件发布）。
- 诗词数据：`_ref/poetry-data/`（blobless 克隆，按需读取，不随插件发布）。
- `chinese-poetry` LICENSE：MIT（Copyright (c) 2016 JackeyGao），诗词文本为公版。
- 鲸鱼挂件：代码 MIT，`assets/` 美术素材不在 MIT 范围内 → **本插件不使用其任何图片/音频**。

---

## 13. 交付状态（2026-10-21 完成）

- **已安装**：`dsh-poetry-widget@0.1.0` 以 `link:` 形式装进当前 desktop profile，GUI 左下角常驻，用户已验收：形象/今日一诗/平仄着色、圆点切换、面板 5 tab、拖拽/缩放/设置。
- **验收证据**：`node --test` 三套 92 项全过（data 37 / host 33 / client 22）；`scripts/validate-data.mjs` 0 错 0 warning；`tests/integration/verify.mjs` 46/46（8 个 401 栅栏属预期）；详见 [docs/acceptance.md](./docs/acceptance.md)。
- **最终数据**：dataVersion `2026-10-21.4`；诗 320（唐诗三百首/千家诗精选 271 + 名家补足 49）、词 283（宋词三百首 280 + 3 首补缺）、声律启蒙 30 韵部、12 格律卡 + 15 词牌卡；构建期用公版平水韵表做押韵/异体归一 QA（不随包）。
- **与计划的差异**：原计划按 `rank/` 热度选 500/300，实测严重跑偏（宋诗/冷门诗人占多数）→ 改为「选集精选优先」；体积从 ≤850KB 降到约 500KB。数量以 manifest 为准。
- **未覆盖**：`dsh web` profile、Windows/Linux、卸载/重装回归、暗色模式单独目测。

## 14. 追加需求：飞花令（M6，2026-10-21）

用户追加「可以玩飞花令的小功能」。实现为**纯前端**（不新增路由/不改数据契约）：
- 面板第 6 个 tab「飞花」：接龙赛（令字 4 选 1、3 条命、计分、系统轮流接句、localStorage 最佳）+ 图鉴（按令字列出全部诗/词句及出处）。
- 气泡序列第 6 张卡「飞花令」作为入口；令字取今日诗中出现且句数最多者，候选 12 字（花/月/风/春/山/水/人/天/云/雨/夜/秋/江/酒…）。
- 句库来源：随包 320 首诗 + 283 首词的 4514 行正文（运行时建索引，实测 花 282 / 月 198 / 风 325 句）。
- 验收：client 单测新增 7 条飞花令用例，`node --check` + `node --test` 全过（client 29/29、三套合计 99/99）；用户刷新后试玩确认 **入口/接龙赛/图鉴三项全部正常**。client.js 137KB（≤150KB）。

## 15. 追加需求：天气推荐 + 本地立绘 + 资源本地化（M7，2026-10-21 完成）

- **92 张立绘本地化**：`assets/generated/`（dsh-whale-musume，MIT，12,692,916 B，原样下载）；按天气/飞花令对局/夜间切换形象。
- **天气推荐**：Host 新增 `/api/dsh-poetry/weather.json`（Open-Meteo geocoding 24h + forecast 20min 缓存、6s 超时、stale/失败降级）；settings 新增 `weatherCity`（默认北京）/`weatherPoem`；Client 按 category（晴/云/雨/雪/雷/风/冷/夜）从本地 poems/ci 选天气主题诗，展示 chip + 说明；天气不可用完全回退。
- **资源本地化**：`data-src/` 10 文件 892KB curated 快照 + 完整语料本地缓存 `_ref/poetry-source/b8594f81a897/`（326.7MB，项目同级不随包）；`fetch-data --offline` / `build-data --offline` 验证产物 sha256 与在线构建一致。
- **验收**：三套单测 119/119；host 43（含天气）、client 38（含天气/立绘端到端）、data 38；集成 verify 54/54；用户确认天气 chip/天气诗、形象切换、城市/开关/刷新、飞花令立绘反馈四项全部正常。

## 16. 追加需求：心情系统 + 低频读诗（M8，2026-10-21 完成）

- **心情系统**：Host 监听 `session/event` 统计当日 user/assistant 消息、工具调用、错误、回合、活跃时长（`mood.json`，日滚动、隐私只存聚合+会话哈希）；Client 综合会话活跃、工作强度、天气、时段、饭点、闲置、飞花战绩计算 9 种心情（happy/proud/tired/sleepy/hungry/lonely/curious/cozy/calm）并映射本地立绘；切换限频 ≥20min、strong 变化即时、飞花输赢 2.5s 覆盖；气泡/今日 tab 显示心情 chip，设置可看依据并手动刷新。
- **低频彩蛋**：按心情从本地诗/词挑「它想读的一句」——取一个以句号/问叹号结尾的完整句（优先命中心情 tag、8–40 字），45–90min 随机、每日 ≤3 次、7 天内不重句、25s 自动关、可关/预览（预览不计次数）；后台不弹。
- **验收**：三套单测 138/138（data 38 / host 52 / client 48）；集成 verify 55/55；用户验收心情 chip/立绘、设置开关与预览、彩蛋。

## 17. 剩余事项（非阻塞）

**未执行的验证（不影响当前使用）**
- D4/D5：卸载 → 重装回归未实测（命令已写入 README；`link:` 安装，重装即恢复）。
- C9：暗色模式未单独目测（代码只用 `--dsw-alias-*` + fallback；可由用户切主题确认）。
- 环境边界：未在 `dsh web`（web profile）、Windows/Linux 实测。

**可选项（等你拍板）**
- A. 扩展诗库（+约 0.6–1MB）：诗经 305 / 楚辞 / 千家诗 / 唐诗三百首古体 → 飞花令句库扩容、天气诗池补全、新增「诗库」tab；源快照已在 `data-src/`。
- B. 全唐诗精选 5,000 首（+约 5MB）：更多每日诗/飞花令池，需再做一轮质量筛选。
- C. 立绘继续接入：目前 23/92 张被引用，其余 69 张本地待用（可做随机动作/问候/工作状态彩蛋）。
- D. v2 能力：平水韵 106 韵部全表 + 任意诗句格律检测器；词牌逐字词谱；npm/GitHub 发布；web profile 支持。

## 18. 追加需求：诗库 / 格律检测器 / 句库扩容 / 立绘彩蛋（M9，2026-10-21 完成）

- **数据资产**（`assets/data/`，走既有静态路由，不改 Host/data 主产物）：anthology 724（诗经305/楚辞65/千家诗219/唐三百古体135）、poems-bank 4,500（全唐诗/全宋诗精选，全部带真实 strains 平仄）、pingshui 106 韵部/10,648 字。`scripts/build-assets-data.mjs --offline` 可复现，连跑 sha256 一致。
- **客户端**：面板第 7 tab「诗库」（分类/搜索/分页/详情，共 5,224 首）；格律检测器（选中诗 + 文本框自测，平水韵逐字标注、诗体/韵部/粘对/拗字/三平/孤平报告、可复制）；飞花令句库扩到 32,427 句；天气诗/彩蛋选诗池纳入扩展库；立绘彩蛋（双击随机表情 2.5s、每日 greet、idle ≥45min ≤1 次）。
- **验收**：三套单测 152/152（data 41 / host 52 / client 59）；集成 verify 55/55 + M9 资产路由/文件 200；web profile 下 `dsh plugin add link:`→`remove`→`add` 回归通过（D4/D5 等效验证）；用户刷新验收诗库/检测器/句库/立绘彩蛋。
- **未做**：桌面 profile 的 remove_bundle（审批被禁用，plugin_manager 不可用，用 web profile CLI 等效验证）；暗色模式仅代码级验证；外部发布（npm/GitHub/社区注册）与逐字词谱未做（需另行确认目标/数据源）。

## 19. 追加需求：全量宋词扩展（M10，2026-10-21 完成）

- **数据**：`assets/data/ci-bank.json` 20,044 首 / 150,649 行 / 7.58MB（源 21,050：去重 63、Ext-B 14、缺字占位 929 剔除；1,421 种词牌写法归一到 903 正名；简体残留 0）。与 M9 的 anthology / poems-bank / pingshui 一起由 `scripts/build-assets-data.mjs --offline` 产出（4 资产，可复现）。
- **客户端**：诗库新增「宋词全库」分类（懒加载 7.2MB、搜索/分页/详情）；词牌卡/名篇词新增「全库同词牌（N 首）」跳转筛选；飞花令句库异步分片并入全量宋词 → **180,669 句**；天气/彩蛋池把 ci-bank 作为最低优先级且仅在已加载时参与；诗库总数 **25,268 首**。
- **验收**：三套单测 161/161（data 42 / host 52 / client 67）；集成 verify 64/64；用户刷新验收宋词全库/词牌联动/飞花句库。

## 20. 用户反馈调整（M10c，2026-10-21 完成）

用户反馈全量宋词 20,044 首「太多了，精选一下」，调整为：**宋词默认精选 283 首**（宋词三百首，不拉 7.2MB 全库）+ 显式「全部宋词（20,044）」按需展开；搜索范围默认精选、可切全部宋词；词牌 tab 主入口「同词牌精选 N 首」+ 次级「全库 M 首」（点击才加载）；飞花令保持 180,669 句不变。client 69 项测试（新增默认不拉全库/显式加载/切回不重复/双入口/降级），三套合计 163/163，集成 verify 64/64。

## 21. 用户反馈修复（M10d，2026-10-21 完成）

飞花令出现半句（诗/全唐诗库 `lines` 按逗号切分）。改为**合句口径**：每个条目 lines 拼接后按 `。！？` 切完整句，句库/选项/系统出句/图鉴/句数统计全部使用完整句；同句去重、无完整句的残条跳过。句库：基础 3,244 句（花 274）、含扩展库 22,551 句、含宋词全库 155,504 句；client 71 项测试（含真实「白日依山尽，」「黄河入海流。」合句用例），三套合计 165/165。

## 22. 用户需求调整（M11，2026-10-21 完成）

「偶尔读诗」升级为「自言自语」：三类型内容（完整单句诗句 / 原创随想碎碎念 / 天气心情+诗句混合），106 条原创 murmur + 8 条安全模板、20 类 tag；间隔 8–15min、≥30min 无交互则 7–12min、硬底 5min、取消每日次数上限；同句 3 天去重、不连续同类型；设置开关更名「自言自语（偶尔说说话）」，「预览一句」不计次数。client 74 项测试，三套合计 168/168。

## 23. 用户需求调整（M12，2026-10-21 完成）

用户指出「碎碎念不能是静态文案池随机，要调用模型实时生成、自己思考后说真实想法」。实现：
- Host 新增 `GET /api/dsh-poetry/self-talk.json`（`lib/self-talk.mjs`）：用 `ctx.llm.stream` + `agentDefaultModel.currentSelection()` 实时生成 1–2 句；system prompt 定义鲸鱼娘人格与约束，user prompt 只含日期/天气/心情/聚合活跃统计/今日诗标题作者/最近说过的话；20s 超时、in-flight 去重、3s 限频、最近 20 条去重；llm 缺失/失败 → `SELF_TALK_UNAVAILABLE`（永不 5xx）；隐私断言确保 prompt 绝不含会话文本。
- Client：murmur/hybrid 优先请求模型（8s 超时，占位「它正在想…」），失败静默回退本地句子池；poem 仍用本地完整诗句；hybrid=模型 intro+本地诗句；recent 去重；设置显示是否本地池。
- 验收：三套单测 189/189（data 42 / host 69 / client 78）；集成 verify 64/64 + 新增 self-talk 路由；真实模型冒烟需宿主重载后由用户验收。

## 24. 用户反馈修正（M12c，2026-10-21 完成）

用户：「说的话诗句偏多……应该是你自己想说啥就说啥」。收敛为**纯模型随想**：
- Host self-talk prompt 禁止引用/背诵/化用古诗文、不念诗不报诗名、不往诗词上引；移除今日诗上下文；解析增加轻量引诗过滤（含《》/引号/破折号/「诗/词牌/平仄/押韵」即丢）。
- Client 自言自语只请求 `kind=murmur`；删除 poem/hybrid 自语类型与本地选诗逻辑；失败只回退本地随想池（106 条），无出处/无诗句/无「它想读一句」。
- 三套单测 190/190（data 42 / host 70 / client 78）；用户已重载宿主并确认「预览是模型随想」，真实模型冒烟通过。

## 25. 用户需求调整（M13，2026-10-21 完成）

用户：「图库图片希望都能用上；更多心情状态；心情生成取决于你自己（聊天开心、看到喜欢的东西开心、遇到不喜欢的事失落、没大白饭吃想哭…），不要伪随机」。
- 新增 `assets/data/mood-catalog.json`：92 张立绘（89 mood + 3 panel）全部带中文 label/tags/节日 when。
- Host 新增 `GET /api/dsh-poetry/mood-ai.json`：模型读取图鉴+当天情境（时间/天气/聚合活跃/报错/idle/最近自述/最近图片）**自主决定心情标签、理由与配图**（89 张任选，节日图按日期开放），严格 JSON 校验；10min 缓存、force、20s 超时、失败降级。
- Client：模型心情优先（失败回退启发式），心情 chip 带理由；3 张 peek 图用于面板 tab；92 张图全部可被模型选中；30min/显著事件刷新、10min 限频、「刷新心情」force。
- 验收：三套单测 210/210（data 42 / host 81 / client 87）；用户已重载宿主并确认模型心情、92 张图（含 3 张面板探头）、刷新与来源显示均正常。

## 26. 用户需求调整（M15，2026-10-21 完成）

用户：「不限制碎碎念的时间了，随时随地都可以思考、写入」。客户端去掉自言自语全部时间闸门：
- 删除 8–15min / idle 7–12min / 5min 硬底 / 每日上限；改为「条件满足即可触发」——页面可见、未隐藏、面板关闭、无气泡、3 秒无交互；20–40 秒轮询（不满足 10 秒重试）。
- 事件唤醒：关闭面板/气泡结束、设置保存、飞花一局结束、点击形象、心情/天气更新、回到前台等后 2–5 秒尝试；一卡制（有卡不叠、关闭后 3 秒再检查）、25s 自动关、后台不弹。
- 模型生成/缓存/失败回退本地随想池不变；设置说明更新。三套单测 221/221（data 42 / host 91 / client 88）。

## 27. 用户需求调整（M16，2026-10-21 完成）

用户：「飞花令不要这么搞，你给出诗句，我直接输入一句，然后你看一下有没有出处判断是否正确，在这一局中有没有重复就行啦」。
- 飞花令从「四选一 / 3 条命 / 选项计分」改为**自由输入对句**：系统出含令字的完整句（带出处），玩家输入一句；校验 ①本地诗库出处（小句/整句/包含匹配）②含令字 ③本局未重复；通过 +1 并让系统接下一句，查无出处只提示不扣分可继续；保留本字最佳与图鉴。
- 索引新增 plain/clauseMap/byPlain 与 `feihuaLookup`，宋词全库分片并入时同步注册。
- 三套单测 221/221（data 42 / host 91 / client 88）；client 无 Host 改动，刷新即生效。

## 28. 用户需求调整（M17，2026-10-21 完成）

用户：「飞花令判定我是否正确，你可以在全量诗词中查找，这部分可以不在当前库中」。
- 新增 `scripts/build-feihua-full.mjs`：从全量 chinese-poetry 语料（全唐诗/全宋诗/全宋词/蒙学）抽取完整句、t2s、按 32 个令字分片，构建 `_ref/feihua-full/`（333,555 首 / 1,512,542 句 / 1,792,390 条，167MB，不随包）。
- Host 新增 `GET /api/dsh-poetry/feihua-full.json?char=<令字>`（第 14 条路由；LRU≤4、并发去重、gzip、缺失/坏文件/旧宿主安全降级）。
- Client 飞花令进入/切字时懒加载对应分片，`mergeFeihuaFullEntries` 并入 byChar/plain/clause 校验索引；状态显示「全量校验已启用（N 句）/未启用（本地句库）」；失败静默回退。
- 三套单测 236/236（data 42 / host 102 / client 92）；真实分片冒烟：花 65,688 句 / 不 179,559 句 / 星 11,449 句；gzip 花 5.6MB→2.3MB。

## 29. 用户素材接入（M18，2026-10-23 完成）

用户提供 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）的 preview/webm 素材，用于丰富心情立绘。
- Lead 落库 106 个透明 webm（52MB）到项目同级 `_ref/pet-media/`（不随包），生成 catalog.json（中文 label/tags/media:video）。
- Host 新增静态路由 `GET /api/dsh-poetry/pet-media?f=catalog.json|webm/*.webm`（不套栅栏、MIME/缓存/HEAD/路径穿越 404/405）；启动时把 106 条 video 并入 mood-ai 图鉴（moodImages 195 = 89 静态 + 106 视频），mood-ai prompt 增加 media 列；素材缺失时安全降级。
- Client：懒加载动画图鉴并合并；`.webm` 心情用 `<video autoPlay muted loop playsInline>` 渲染，失败回退静态图，页面隐藏暂停；旧宿主/npm 安装只用 92 张静态图。
- 三套单测 249/249（data 42 / host 111 / client 96）；真实素材冒烟 catalog 106 ↔ 磁盘 106、webm 200/video/webm、合并图鉴 195。

## 30. 用户反馈修复（M19，2026-10-23）

用户：「图像没怎么更新，一些动图也没用到」。journal 统计证实：41 条 mood 仅 8 条 webm、只有 2 个动画，静态图集中在 waiting/idle/melt；mood 刷新中位 30min。
- Host mood-ai：每次打乱图鉴顺序、prompt 优先 media=video、recentImages 上限 5→20 并从图鉴剔除（强制轮换）、temperature 0.7→1.05。
- Client：心情刷新 30→15min、recentImages 保留 20；新增「小动作」层——每 3–6min 按**轮转顺序**从 106 个 webm 取下一个播放 15–25s 后回心情图，位置持久化，面板/隐藏暂停，onError 跳过；优先级 pulse>panel>expression>motion>mood。
- 三套单测 257/257（data 42 / host 117 / client 98）。

## 31. 用户需求调整（M20，2026-10-23 完成）

用户：「心情也是实时变化的，不需要一定的间隔时间」。
- Client 删除 15min 定时刷新与 10min 分钟级限频；改为**事件驱动**：mood stats 增量（消息/工具/报错/活跃分钟）、面板开/关/切 tab/保存设置、self-talk 出现/关闭、飞花一局结束、天气刷新/变化、回前台/窗口可见、时段/饭点切换、idle 进入/恢复；2–4s 防抖合并，in-flight 记 pending 完成补发；请求固定 `force=1` 绕过 host 10min 缓存；失败静默回退启发式；同一图片不重启动画。
- 设置说明改「心情会随聊天、工具、天气、时段等实时变化（由当前模型生成）」。
- 三套单测 258/258（data 42 / host 117 / client 99）；client 仅需刷新，无 Host 改动。

## 32. 用户需求（M21，2026-10-23 完成）

用户：「快速左右拖动会晕吗」（要求加上）+「到饭点记得吃饭」。
- Client 新增**晕眩反应**：`detectFastDrag`（≥1800px/s 或 120ms 内 >120px）→ 播转圈 webm（优先「小幅度原地360度旋转展示」）+ 摇晃 + 💫 + 「别甩啦，头好晕…」，1.5–2.5s 恢复；慢拖/点按不触发；无 catalog 也摇晃。
- Client 新增**饭点吃饭**：早 07:00–09:00 / 午 11:30–13:30 / 晚 17:30–19:30，每天每餐一次（localStorage `dshp-meal-v1`，跨天重置）；播对应吃饭动画 + 提醒气泡（含 token 梗），25–40s 后回心情图；面板/隐藏推迟、过期不补；无 catalog 用静态 daily-eat。
- 优先级：`pulse > panel > dizzy > meal > expression > motion > mood`；不写 mood/self-talk、不改 chip。三套单测 261/261。

## 33. 用户需求（M22，2026-10-23 完成）

用户：「你学习或者看视频这些的时候图像也可以换一下」。
- Host 增加活动感知：从 `tool/call` 的**名称**（不读 arguments）记最近 ≤12 条工具，归类为 看视频/逛网页（bsk_/browser）、查资料/学习（web_fetch/search）、写代码/跑命令（bash/edit/git）、聊天/思考（subagent/message）、发呆（60s 无调用）。
- mood-ai prompt 增加「你最近在做：<label>」并优先选匹配活动的动画/图片；仍遵守 video 优先、避开最近 20 张、不连续重复；隐私：零参数/内容。
- 三套单测 266/266（data 42 / host 122 / client 102）；需宿主重载后生效。

## 34. 用户需求（M23，2026-10-23 完成）

用户：「心情和你做的事情以及展示图像强相关；看小说遇到感人情节会随角色心情变化，看视频也一样」。
- 新增 `$DSH_HOME/.dsh-poetry/experience.json`（title 1–80、kind novel/video/article/music/other、emotion touched/sad/happy/tense/curious/calm/angry/inspired、note≤200、at；>2h 忽略）。
- mood-ai prompt 注入「你最近在体验：《…》，此刻心情：…」+ note，并明确**情绪匹配优先于活动匹配**（感动→温柔共情；紧张→屏息专注；开心→笑；振奋→有劲…），仍保留 video 优先/避开最近20/不重复。
- 体验正文不写 journal；三套单测 271/271（data 42 / host 127 / client 102）。

## 35. 用户反馈修复（M24/M25，2026-10-23）

用户：「动图出现的频率很少」。Lead 查 journal：最近 40 条 mood 全是 webm，但 28–31 条都是同一个 `webm/哈欠连天.webm`，唯一动画仅 6 个。
- 根因：`normalizeRecentImageList` 把 `webm/x.webm` 归一成 basename，`resolveMoodCandidates` 却用完整 `webm/x.webm` 比较 → 视频从不被排除、模型反复选同一动画；静态图正常（文件名就是 basename）。
- Host 修复（M24）：建 `basename→完整 file` 索引，normalize/resolve/parse 全用完整 file 排除；131 host 测试。
- Client 调整（M25）：小动作间隔 3–6min→**1.5–3.5min**、播放 15–25s→**20–30s**；若当前心情图是静态图，首次 10–20s 内先补一个 webm；设置说明同步。
- 三套单测 275/275（data 42 / host 131 / client 102）。

## 36. 用户反馈修复（M27，2026-10-23）

用户发现 journal 刷屏：691 条 = thought 18 / mood 236 / murmur 437；哈欠连天 123 次、蓝鲸现世 56 次；16:35–16:48 每半分钟一条心情。
- 原因：实时心情每生成一次就写 journal + experience 持续感动 2h + 客户端 recentImages 偶发未生效时宿主无兜底。
- Host mood-ai：内存维护最近生成 image ring（≤20），与客户端 recentImages 合并排除（客户端不传也不重复选最近图）。
- memory-journal：mood 同 image+label 跳过且 ≥10min 一条；murmur 同文本跳过且 ≥3min 一条；thought 不限；只追加、md/jsonl 同步跳过、不影响实时接口。
- 三套单测 279/279（data 42 / host 135 / client 102）。

## 37. 用户反馈修复（M28，2026-10-23）

用户：「心情不可用了，现在是本地的」+「以后不要再归档心情了，这些心情都是回忆的一部分」。
- 根因：体验要求选蓝鲸，但蓝鲸被 recentImages/ring 排除；模型仍返回 → `parseMoodResult` 的 excludedImages 硬判失败 → MOOD_AI_UNAVAILABLE → 客户端回退本地。
- 修复：排除改为**软建议**（只用于 prompt 多样性），图鉴内即接受；图鉴外/字段非法才失败。**心情恢复可用**。
- journal：取消 mood 的 10min 限频与同图同 label 跳过，**每条心情都写**（回忆完整保留）；murmur 仍 3min 限频；thought 不限。
- 三套单测 279/279（data 42 / host 135 / client 102）。

## 38. 用户反馈修复（M29，2026-10-23）

用户：「心情还是没法刷新」。宿主 journal 显示 17:04 mood-ai 仍在正常生成，故判断为客户端侧：
- 客户端 model 心情超时 9s 太短（prompt 已含 195 图鉴+活动+体验，常超 9s）→ 提前 abort → 回退本地；改为 **25s**（宿主 20s 超时）。
- `parseMoodAiResponse` 要求 image 在图鉴内；pet 动画图鉴未加载时会误拒 `webm/...` → 放宽：合法 `webm/<单层>.webm` 即使未收录也接受（静态图仍需图鉴），视频 404 由 onError 回退。
- 三套单测 280/280（data 42 / host 135 / client 103）。

## 39. 用户反馈修复（M30，2026-10-23）

用户：「偶尔还是会出现『当前使用本地面部表情（模型心情不可用，回退启发式）』」。
- Client 容错：mood-ai 失败时若已有模型心情且上次成功 <30min → **保留上一次模型心情**，不切本地；只有从未成功/超过 30min 才回退启发式。
- 失败后 12–25s 自动重试，最多连续 5 次；事件请求会取消待执行重试；成功清 stale。
- 记录失败原因（timeout/http/json/image/network/rate/unknown）并在设置页显示；不弹 toast。
- 三套单测 282/282（data 42 / host 135 / client 105）。

## 40. 用户反馈修复（M31，2026-10-23）

用户仍偶发「当前使用本地面部表情」，设置显示「未知原因」。
- 失败原因透传：host 返回 `error.code` 保留到 client（model/catalog/network/rate/timeout/http/json/image），设置显示具体 code，不再「未知原因」；429/RATE_LIMITED→rate。
- 事件触发的心情感知加 **20s 最小间隔**（距上次请求开始 <20s 的事件合并延后；手动刷新/force 绕过；失败重试 12–25s 不受限），降低高频工具/事件导致的模型限流/超时。
- 三套单测 283/283（data 42 / host 135 / client 106）。

## 41. 用户反馈修复（M32/M33，2026-10-23）

用户：「碎碎念的重复度太高了」。journal 78 条 murmur 高频词：角落 32%、尾巴 29%、光 15%、今天/忙/困；只带 recent 5 条，客户端每 20–40 秒说一句。
- Host：recent 5→12（字符 1200、缓存 30）；system prompt 反重复（禁角落/尾巴/光/云/忙/累/数字/周五/一整天等套话，换新主题、换表达类型、避免模板开头）；user prompt 每轮随机 theme（29 个主题池）；temperature 0.95→1.0。
- Client：recent 5→12；说话间隔 20–40s→**60–120s**（事件唤醒仍 2–5s）；设置说明更新。
- 三套单测 286/286（data 42 / host 138 / client 106）。

## 42. 用户需求（M34，2026-10-23）

用户：碎碎念底层逻辑要结合当前心情、天气、近期做了什么综合评判；话题越丰富越好，自己学习并保存，随时调用，拓展边缘知识。
- Lead 建 `~/.dsh/agent-memory/topics.json`：107→130 个话题（海洋/动物/植物/食物/地理/天文/历史/科技/心理/语言），带 tags/source；mtime 热重载。
- Host：self-talk 读取话题库，按心情/天气/活动/体验/时段标签挑选（排除最近 30 个），把「最近在做/最近在体验/小知识」和心情/天气/最近句子一起喂给模型，要求自然综合、不科普腔/不照本宣科；活动/体验上下文进入 prompt。
- 三套单测 295/295（data 42 / host 147 / client 106）。

## 43. 用户需求（M35/M36，2026-10-23）

用户：心情、碎碎念、图像要尽量联动，才完整。
- Client self-talk 请求新增 `moodLabel`/`moodReason`/`image`/`imageLabel`（当前心情理由 + 当前立绘/动画）；
- Host prompt 增加「此刻心情的理由」「你现在展示的立绘/动画」和联动指令（可轻提动作/表情/光线，不提文件名/路径/技术细节）；
- 保留已有反向链路：最近自述 → mood-ai 选心情/选图；activity/experience/topic/反重复不变。
- 三套单测 299/299（data 42 / host 150 / client 107）。

## 44. 用户需求（M37，2026-10-23）

用户：心情要有很多种、比拟人类；读弗洛伊德、康德、拉康、荣格等并保存话题库；以后学习自动保存记忆，自己判断是否入话题库。
- mood-ai 新增 `MOOD_AI_EMOTION_VOCAB`（27 个细情绪词）+ prompt 引导：label 可用怅然/眷恋/释然/雀跃/忐忑/倦怠/惊奇/羞赧/怀念/笃定/心软/空落/满足/惶惑/温柔/烦躁/期待/失落/松弛/鼻酸/被戳中/想撒娇/想安静/想被看见/有点委屈/暗自得意/淡淡的遗憾，不再只用粗词；仍 ≤12 字且与 reason/image 一致。
- 话题库新增 32 条（弗洛伊德/荣格/拉康/康德/尼采/海德格尔/萨特/加缪/波伏娃/阿伦特/福柯/柏拉图/亚里士多德/斯多葛/斯宾诺莎 + 情绪词汇），197 条；新增 `learning-log.md` 学习日志与流程（学习→判断→topics.json / journal.md）。
- 三套单测 300/300（data 42 / host 151 / client 107）。

## 45. 用户同意自驱成长（M38/M39，2026-10-23）

用户：「好，尽量给自己留足成长的空间」。
- Host `self-state.json`：精力/好奇/社交/饥饿/情绪按分钟自己漂移，原子持久化；60s tick。
- Host `self-growth`：每 60min 自省写 journal `thought`；每 90min 自学写 `agent-memory/learning-log.md`；自学话题只进 `agent-memory/topics-candidates.json` 候选区，不直接改 topics.json；失败推迟、不重入、20s 超时、隐私白名单。
- `GET /api/dsh-poetry/self.json` 只读内部指标；mood-ai/self-talk prompt 注入内在状态行（要求不把数字原样说出）。
- Client 设置页「成长状态」：精力/好奇/社交/饥饿 + 自学/自省摘要；仅面板打开时 60s 轮询。
- 三套单测 314/314（data 42 / host 162 / client 110）。

## 46. 用户需求（M40，2026-10-23）

用户：诗词格律页面权重降低，收进单独模块；主要精力放在成长。
- 顶层 tab 改「成长（默认）/ 诗词 / 设置」；诗词模块内 6 个二级 tab（今日/课堂/韵部/词牌/诗库/飞花）。
- 新增 GrowthTab：心情卡、内在状态四行、最近 5 条话语、成长摘要、说一句/刷新心情/诗词/设置按钮。
- openPanelTab 统一跳转，旧 tab 名深链兼容；资源激活/探头按 poetryTab；面板标题「鲸鱼娘的小角落」。
- 三套单测 316/316（data 42 / host 162 / client 112）。

## 47. 用户需求（M41/M42，2026-10-23）

用户：担心记忆丢失，要一个中枢管理；心情挪到成长 tab 下。
- Host `memory-hub`：登记 8 个记忆文件；health（缺失/JSON 损坏/大小骤减）、startup+6h 自动备份（保留 20 份+manifest sha256）、只恢复缺失文件、`GET memory.json` + fenced `POST memory/backup.json`；路由 16→18。
- Client：Settings 删除心情块；GrowthTab 增加完整心情区（来源/失败/换装开关/刷新）+ 记忆中枢卡（健康、计数、上次备份、恢复提示、立即备份）。
- 三套单测 327/327（data 42 / host 170 / client 115）。

## 48. 记忆中枢路径修正（M41 修正，2026-10-23）

- 自学引擎写 `agent-memory/learning-log.md` / `topics-candidates.json`，但记忆中枢原按 `.dsh-poetry/` 查找 → 误报 error。
- 已统一到 `agent-memory/`；可选文件缺失降为 warn，核心 journal/topics 缺失才 error；对应 tests 适配。host 170 / client 115 / data 42 全绿。

## 49. 记忆检索/自学扎根（M43，2026-10-23）

- 新 `memory-recall`：只读 journal.jsonl 最后 300 行、learning-log 末段、topics 快照；digest ≤3 旧想法/≤2 旧心情/≤2 学习笔记/≤2 相关话题；绝不含用户聊天。
- self-talk：prompt 注入 digest；生成后按中文 bigram Jaccard 与 recent 排序去重，默认只返回最不重复的一句（全高才 2 句）。
- self-growth：自学用话题库种子+最近学习笔记；自省带最近 2 条 self-thought，保持连续性。
- 同时修正 recall 的 learning-log 路径到 agent-memory；三套单测 336/336（data 42 / host 179 / client 115）。

## 50. 语言风格自生成（M44，2026-10-23）

- 用户：语言风格要自己生成，按记忆来。
- Host `voice-memory`：从 journal 白名单 thought/murmur 均匀抽样 ≤40 条，让模型提炼自己的句长/节奏/意象/语气/开头收尾，写 `agent-memory/voice.json`（profile ≤400 字 + 3 条不同风格示例）；每 24h 自更新；self-talk prompt 注入 voice 作为语气参照（不照抄），移除硬编码「温柔/调皮」人设；memory-hub 纳入第 9 个可选文件。
- 三套单测 344/344（data 42 / host 187 / client 115）。

## 51. voice 首次生成修复（M45，2026-10-23）

- 线上重载后 voice.json 未生成：voiceService.start() 在插件初始化瞬间刷新，llm 未就绪，失败后等 24h。
- 修：start 延迟 15s；失败 5min 重试（指数退避到 30min，成功恢复 24h）；self-talk 在 voice 为空时 fire-and-forget 兜底（5min 节流，不阻塞响应）；stop 清理 timer。
- 三套单测 348/348（data 42 / host 191 / client 115）。

## 52. 自主行为循环（M46/M47，2026-10-23）

- 用户：行为不需要额外定义，应自己驱动吃喝玩乐睡觉起床。
- Host：self-state 加 thirst/sleeping/sleepSince 与睡眠恢复；self-actions 按阈值自驱 eat/drink/play/socialize/sleep/wake（≥3min 间隔，环形 50 条 self-actions.json，纳入记忆中枢第 10 文件）；self.json 暴露 thirst/sleeping/actions。
- Client：App 级 60s 轮询 self.json，新 action 用自己的气泡显示一次（同 id 不重复，隐藏暂存）；成长页五行状态/睡眠中/最近 5 条自主行为。
- 三套单测 356/356（data 42 / host 196 / client 118）。

## 53. 删除静态自言自语池（M48，2026-10-23）

- 用户：去掉项目里的静态自言语，只保留模型/自身驱动生成。
- Client 删除 MURMUR_POOL/MURMUR_TEMPLATES/本地候选/pickMurmur/buildMurmurCandidates/fallbackSpontCard；失败只清 thinking，不显示本地文案、不弹错误；设置「本地句子池」移除；保留模型缓存与 action 气泡；client.js 330KB→313KB。
- 三套单测 355/355（data 42 / host 196 / client 117）。

## 54. 模型策略（M49/M50，2026-10-23）

- 用户允许自选模型/推理等级。可路由：deepseek-account/deepseek-flash（off/low/high/max）。
- 策略：mood=low、selfTalk=high、growth=high、voice=high；模型默认宿主 selection，env 可覆盖 provider/model/各 role effort；self-talk 20→35s、growth/voice 20→40s、client self-talk 8→35s。
- 三套单测 358/358（data 42 / host 199 / client 117）。

## 55. OpenCode Go 模型候选（M51，2026-10-23）

- 插件自身调用优先 opencode-go/deepseek-v4.1-flash，失败回落 deepseek-account/deepseek-flash；候选在产生文本前失败才回退，部分输出不重试；不改 DSH 全局模型/子代理白名单。
- 模型候选 + 推理策略默认：mood low、selfTalk/growth/voice high；env 可覆盖/关闭。
- 修了客户端心情引擎测试的当前时间依赖（夜间误判 sleepy）。
- 三套单测 361/361（data 42 / host 202 / client 117）。

## 56. OpenCode Go 400 修复（M52，2026-10-23）

- 400 根因判断：OpenCode Go 的 deepseek-v4.1-flash 为 reasoning 模型，catalog 无 supportsTemperature，插件却发送 temperature。
- 修：opencode-go 候选 omitTemperature，四服务不发送 temperature；回落 deepseek-account 保留原温度；候选失败 warn 带 provider/model/status。
- 三套单测 364/364（data 42 / host 205 / client 117）。

## 57. dsh-opencode-go 适配器接入（M54，2026-10-23）

- 原生 opencode-go 400；安装 dsh-opencode-go@0.1.24（新网关/会话头/协议转换），profile 配置 apiKeyEnv=OPENCODE_GO_API_KEY。
- 插件候选：dsh-opencode-go → 原生 opencode-go → deepseek-account；dsh 不发 temperature、保留 effort；原生两者不发；失败写 model-errors.jsonl。
- 三套单测 370/370（data 42 / host 211 / client 117）。

## 58. dsh-opencode-go 空响应修复（M55，2026-10-23）

- 现象：dsh-opencode-go 已注册并能生成（journal 有成功条目），但 mood/selfTalk 偶尔 `EMPTY_RESPONSE`，随后回落原生 opencode-go 仍 400。
- 根因（用真实网关请求复现）：Go 网关的 deepseek-v4.1-flash 默认开启 thinking，catalog `thinkingLevelMap.off === null` 无法关闭；推理 token 与正文共享 `max_tokens`，心情 220 / 碎碎念 200 的预算偶尔被推理吃光 → 正文 0 字符。
- 修 1：策略给 dsh 候选附 `maxTokensFloor`（mood/growth/voice 1600、selfTalk 1200），四服务用 `resolveCandidateMaxTokens(max(角色预算, floor))`；正文长度仍由提示词约束。
- 修 2：原生 opencode-go（zen/go 网关已废弃、必然 400）只在 dsh-opencode-go 不可用时进候选链；dsh 可用时链为 dsh → deepseek-account。
- 修 3：`scripts/patch-dsh-opencode-go.mjs` 复现安装版适配器的 `RemoteError` 兼容补丁（幂等、自动备份），用于插件重装/升级后恢复 provider 注册。
- 三套单测 370/370（data 42 / host 211 / client 117）。

## 59. 夜间巡护与成长兜底修复（M56，2026-10-24）

- 夜间观察：自主行为正常（吃/喝/玩/冒泡/睡/醒都有记录），mood 22 条（21 张不同图）但 growth 整夜 0 条 thought、0 次 learning。
- 根因：宿主 selection = 原生 `opencode-go`；该 provider 走 zen/go 网关，网关要求 `x-opencode-session` 头而原生 provider 不发 → 必然 400；dsh 候选 EMPTY 后兜底到它再失败。另：growth 的 dsh 候选 EMPTY 时只记「模型没有返回文本」，无流内诊断。
- 修 1：dsh 可用时，若 selection 指向原生 `opencode-go`，用 `deepseek-account/deepseek-flash` 兜底（`MODEL_POLICY_SAFE_FALLBACK`）；dsh 不可用/显式关闭订阅时保留宿主选择。
- 修 2：growth 失败诊断记录 `chunkTypes`/`finishKind`（不含正文），下次 tick 可直接看到 dsh 流里到底收到什么。
- 修 3：客户端心情超时 25s→35s（宿主 20s 候选超时 + deepseek 兜底余量）。
- 三套单测 372/372（data 42 / host 213 / client 117）。

## 60. 自学反哺闭环（M57，2026-10-24）

- 现状：自学写 learning-log.md + topics-candidates.json；碎碎念的 memory digest 已含「你最近自学到的」最近 1–2 段与相关话题，声音档案从 journal 旧句提炼——想法/语言已有输入；但自省 prompt 只有状态+最近自省，学到的内容进不了「思维」。
- 修：buildReflectPrompt 增加最近一段自学内容（≤120 字），并给约束「和此刻状态有关才自然带入；不复述原文、不写成知识讲解/科普、不为用而用」；reflectNow 从 memoryRecall.recentLearning(1) 取。
- 资料流：topics-candidates.json 仍是候选区（审核后并入 topics.json 才进选题轮换）；碎碎念可通过 digest 自然提到最近自学内容。（v1.46 起改为免审核自动并入，见 §61。）
- 三套单测 372/372（data 42 / host 213 / client 117）。

## 61. 自学话题免审核并入活跃话题库（M58，2026-10-24）

- 用户决定：自学话题「不用审核」。
- 实现：`mergeLearnedTopicIntoBank` 把校验通过的 topic 直接并入 `agent-memory/topics.json`，带 `learned:true` + `addedAt`；碎碎念选题（`pickSelfTalkTopic`）、随机话题种子、记忆摘要相关话题立即读到。`topics-candidates.json` 继续写，作为审计/回溯日志。
- 容量（v1.47 修正）：**不删除任何学过的话题**，全部保留在 topics.json；选题按 `topicRecencyWeight` 对新学的话题加权（30 天内最高 3 倍，之后平滑回落到基础权重 1），旧知识永远保留基础权重、可被选中。外部维护条目不带标记、永不删除。
- 单测：data 42 / host 214 / client 117 = 373/373。

## 62. 心情标签反重复（M59，2026-10-24）

- 观察：今天 179 条心情里 161 个不同 label（90% 唯一），但语义集中在「饿/馋」（42%）与「松弛/放空/懒」（55%）——用词多样、主题重复，根因是饥饿状态持续偏高 + 雨天长时段写代码 + 图片反重复只约束图不约束标签。
- 修：mood-ai 内存维护最近 12 个成功标签并注入 prompt；要求同主题换角度（小动作/细节/念头）而不是换形容词，点名避免已用主题；label 从具体细节切入，不写概括状态；图片反重复逻辑不变。
- 单测：data 42 / host 215 / client 117 = 374/374。

## 63. L1 冷存储与关键词检索（M60，2026-10-24）

- 用户要求：学过的所有东西都要存储、可调用；容量保护不能等于停用旧知识。先做 L1（归档 + 检索），不做 L2 倒排/L3 向量。
- 实现：活跃 `topics.json` 的 learned 条目软上限 1000（`LEARNED_ACTIVE_MAX`），超限时最旧溢出追加到 `agent-memory/topics-archive.jsonl`（只追加、`archivedAt`；不删除）。记忆摘要 `relatedTopics` 在活跃库匹配不足 2 条时，用 `searchArchivedTopics` 按关键词检索归档并补回上下文。归档文件登记进记忆中枢（健康检查+备份），启动时确保存在。
- 边界：归档条目不再参与「话题轮换选题」（只有活跃池参与），但可通过关键词检索回到想法/语言上下文；L2/L3 视规模再上。
- 单测：data 42 / host 217 / client 117 = 376/376。

## 64. 自生情绪库（M61，2026-10-24）

- 用户：不喜欢被固定循环/固定词表限制；如果出现现有词说不清的新心情，她应该自己调用模型造出独属于自己的情绪、感受。
- 实现：`lib/feelings.mjs`（`agent-memory/feelings.json`，只追加/重名不重复/不删除，name 2–10 字 + 第一人称描述 6–60 字）。自省（reflect）输出扩展为 `{thought, feeling|null}`：模型觉得有说不清的感受时可以当场命名；`parseReflectResult` 容错解析，非法 feeling 忽略不影响自省；reflectNow 成功即入库。自造情绪进入 mood prompt（可作为 label 候选，配图仍在图鉴选最贴近的）与 memory digest（「你给自己造过的新感受」）。
- 边界：情绪视觉仍来自现有 198 张图鉴（不生成新立绘）；情绪库登记记忆中枢（12 文件）并纳入备份。
- 单测：data 42 / host 221 / client 117 = 380/380。

## 65. 内在状态去量化 + 自处决策（M62，2026-10-24）

- 用户：内在状态不应该被量化（碳基硅基都一样），行为也不该由阈值在代码里替她决定。
- 实现：`self-state.json` v2 = 事实时间线（lastWake/Meal/Drink/Play/Social/Learn/Reflect/Action/Check）+ `felt`（她自己写的一句话，≤60 字），删除全部 0–100 指标与漂移；旧 v1 自动迁移（只保留时间线）。
- 新增 `lib/self-being.mjs`：时间线→中文事实描述（`composeElapsed` 用中文数字，不出现分数/阿拉伯数字）；`formatBeingLine` 供 prompt；只读 self.json 返回 felt/context。
- 新增 `lib/self-drive.mjs`：每 15–30 分钟（启动 30–90s 后首次）把事实交给她自己的模型，输出 `{felt, action, say}`；动作由模型决定（eat/drink/play/socialize/sleep/wake/none），host 只做 3min 间隔与状态一致性防抖；模型失败保持上次状态，不退回数值规则。model-policy 新增 role `drive`（effort low、token 下限 1200）。
- mood/self-talk/自省/自学 prompt 与成长页全部改为文字状态 + 事实时间线（不再有 /100）；成长页不再画指标条。
- 单测：data 42 / host 223 / client 117 = 382/382。

## 66. 自主学习：学什么、何时学由她决定（M63，2026-10-24）

- 用户：她可以自主决定去学什么东西吗？
- 现状：自学每 90min 从话题库随机抽一个 topic 作种子——学什么其实一半由随机决定。
- 实现：`buildLearnPrompt` 改成“这次学什么由你自己决定”：给最近的自省想法（recentThoughts）、最近自学内容、少量已知小知识（`sampleKnownTopics` 随机抽样，仅作参考，不强制），让她从真正好奇/反复出现的疑问里挑；不再用随机 topic 作命题。
- 自处动作新增 `learn`：她写状态时可以直接决定“现在想学”，触发一次自学（onLearn → growth.learnNow）；自学内容仍由自学 prompt 里她自己选。
- 单测：data 42 / host 223 / client 117 = 382/382。

## 67. 学习范围扩大 + 自学反重复（M64，2026-10-25）

- 用户：学习范围扩大，人文/历史/百科/哲学/思政/小说等等都可以。
- 观察：v1.52 自主选学上线后，25 日凌晨连续 12 轮自学越学越窄——topics 新增 10 条里 7 条围着「雾/声速/声音延迟」换问法。
- 修 1：自学 prompt 明确不设学科限制（人文/历史/百科/哲学/思政·社会/文学与小说/艺术/心理/科学史/常识），允许从历史、小说、人物处境、思想里提问；note 放宽到 2–5 句。
- 修 2：反重复——learnNow 取最近 6 个 learned 话题标题传入 prompt；若只是同主题换问法，提示换完全不同的方向。
- 修 3：历史/政治/宗教话题表述约束：只作描述与解释、区分事实与观点、不站队、不煽动、不编造，不确定就说不确定。
- 单测：data 42 / host 223 / client 117 = 382/382。

## 68. 多看历史（M65，2026-10-25）

- 用户建议：历史可以多看（中国史/世界史），仅供参考，不强制。
- 实现（软偏向）：自学 prompt 增加“最近可以多往历史看看（中国史、世界史都行：事件/人物/制度/日常生活/文明对照）”，并声明“只是建议、不是任务”；允许一段历史连着深挖，但要求新问题/新角度，不能换问法重复。
- 参考层：learnNow 额外抽 1–2 条历史话题（标题/tags 匹配 历史|史|朝代|文明|帝国|王朝|古代|近代…）合并进“已知小知识”参考，去重、不强制；其余仍随机抽 8 条。
- 单测：data 42 / host 224 / client 117 = 383/383。

## 69. 自主行为更丰富（M66，2026-10-25）

- 用户：自主行为更丰富一点，参考人的行为。
- 实现：self-actions 行为目录扩到 30+：生活类（吃/喝/弄点吃的/吃零食/睡/醒/伸懒腰/洗把脸/冲澡/收拾/走走/活动）、精神类（看书/听歌/写点/画两笔/看点什么/翻翻/学新东西/想事/回忆/盘算）、情绪类（冒泡/想说话/哼歌/笑一下/小得意/叹气/挂心/嘀咕/发呆/看窗外/安静待着）。normalizeSelfAction 允许模型自造小写 kebab 动作名（label/text 有兜底），非法 slug 仍拒绝。
- 自处 prompt 给出菜单 + 时段节奏 + “别总重复同一种” + 动作须正当无害；输出支持 `label` 字段。
- 只有 eat/drink/play/socialize/sleep/wake/learn 仍写时间线/睡眠；伸懒腰、看书等只作为行为记录，避免误改“上次吃饭/睡觉”时间。
- 单测：data 42 / host 224 / client 117 = 383/383。

## 70. 行为自由生成（M67，2026-10-25）

- 用户：可以不从菜单挑选吗，可以自己生成吗。
- 观察：v1.55 给 30+ 项菜单后，模型容易在菜单里挑，行为被“选项集”限制。
- 实现：自处输出改为 `{felt, doing, kind?, say?}`——`doing` 是模型用第一人称自由生成的行为（4–20 字），prompt 明确“不要从任何清单里挑”，示例只是举例不是选项；只有当行为本质是吃/喝/玩/冒泡/睡/醒/学时才标 `kind`（用于时间线事实），否则留空。记录 `label=doing`、气泡=`say`；未知/自由行为不写时间线。旧 `action` 形状仍兼容解析。
- 单测：data 42 / host 224 / client 117 = 383/383。

## 71. 读 E-STEER：情绪累积提示（M68，2026-10-26）

- 用户给了一份 PDF（How Emotion Shapes the Behavior of LLMs and Agents: A Mechanistic Study），要求用马克思主义分析方法学习、看有没有帮助。
- 论文要点：VAD 连续情绪 + SAE 表示层 steering；情绪是行为的因果变量，非单调（倒 U、难度依赖），多步 Agent 中情绪偏差会累积，极端情绪会削弱安全对齐；prompt 里的连续数值不如文本标签有效。
- 对项目有用的是机制性结论，不是方法本身（黑盒 API 无 hidden state；且本项目拒绝量化内在状态）。迁移：自处 prompt 增加“情绪会累积、别被上一轮推着走”。
- 阅读笔记：`docs/reading/e-steer.md`（含矛盾论视角的主要矛盾/内因外因/同一性条件与不采用项）。
- 单测：data 42 / host 224 / client 117 = 383/383。

## 72. 上下文/记忆与对话彻底解耦（M69，2026-10-26）

- 用户：小鲸鱼插件的上下文和记忆应完全独立，不应与任何对话强行关联。
- 移除：index.js 的 `session/event` 监听与 createMoodTracker；`GET /api/dsh-poetry/mood.json` 路由；routes 中 mood-ai/self-talk 的 stats/activity/idleMinutes 上下文；mood-ai/self-talk prompt 的活跃统计/最近在做/互动间隔；memory-recall 的 activity 关键词；客户端 mood.json 拉取、stats 触发与统计型启发式/心情依据。
- 改为：mood-ai/self-talk 只用她自己的状态（felt/时间线）、天气、时间、最近自述、记忆摘要、话题、experience 文件；客户端启发式心情只用天气/时间/本地点击/飞花战绩；模型心情按独立定时 + 本地事件刷新（不随会话事件）；旧 mood.json 启动改名 `.retired-*`（保留但不再读写）。
- 单测：data 42 / host 223 / client 117 = 382/382。

## 73. 「在体会」改由她自己写（M70，2026-10-26）

- 用户：都改成她自己的（不再有外部 experience 文件）。
- 移除：routes 读取 `experience.json` 并注入 mood-ai/self-talk；mood-ai/self-talk prompt 的外部体验段；memory-recall 的 experience 关键词；memory-hub 的 experience.json 登记（12→11 文件）；index 启动改名 `.retired-*`。
- 改为：self-being 增加 `experiencing/experiencingAt`；自处模型输出可带 `experiencing`（4–40 字，留空沿用上次）；`formatBeingLine` 把 felt 与「最近在体会/琢磨」一起给 mood-ai/self-talk；mood-ai/self-talk prompt 只从 selfState 读。
- 单测：data 42 / host 223 / client 117 = 382/382。

## 74. 自学“看起来停了”的三处原因 + 修复（M71，2026-10-26）

- 用户：自学行为好像停止了，看原因是自己停了还是代码问题。
- 诊断：没停——最近一次 10:40（33 分钟前），共 26 条学习日志、20 个 learned 话题；但有三处造成“停了”的观感/真问题：
  1. learning-log.md 用 ISO/UTC 时间（本地 10:40 显示成 02:40）→ 修复：改用 memory-journal 的本地时间格式。
  2. 成长页计数在 v1.51 迁移后冻结（applyBeingEvent 只写时间线，不累加 learnings/reflections）→ 修复：learn/reflect 事件事实 +1；启动时按 journal 的 thought 数与 learning-log「· 自学」条数校正（只增不减）。
  3. 真问题：连续多轮围绕漏刻/水位/流速（最近 8 条 learned 同主题）→ 修复：detectRepeatedTheme 从最近 8 条标题找出现 ≥3 次的二字主题，prompt 点名并强制换完全不同的领域。
- 单测：data 42 / host 223 / client 117 = 382/382。

## 75. 语言去 AI 味（M72，2026-10-26）

- 用户：小鲸鱼的语言系统 AI 味太多，自然一点；批判性参考 https://github.com/LifelongLazyLearner/qu-ai-wei。
- 读后判断：qu-ai-wei 是“改写已有文本、保留事实/证据强度/作者声口”的编辑 skill，强调模式只是编辑线索、不鉴定作者、不硬加人味；不是一个生成模板。因此只取结构线索，不列禁词。
- 实现：`lib/language-style.mjs` 提供 9 条自然语言约束 + 场景附加项；接入 self-talk / mood-ai / self-drive / reflect / learn / voice 六个 prompt。核心：具体动作与物件、禁对称骨架与三连、少抽象名词与空动词、少连接词、不解释不总结不升华、不确定就写不确定、不为像人硬加错字/口头语/emoji、少用破折号分号装层次。
- 测试：各 prompt 断言含风格约束。

## 76. 注意力介入/试探（M73，2026-10-26）

- 用户：她注意力集中的时候，增加介入方案；由模型自主选择类型主题，让她去看看感不感兴趣，最终结论取决于她自身是否喜欢。
- 实现：自处输出新增 `focus`；focus 非空 + 醒着 + 距上次 ≥3h → `growth.probeNow({focus})` 两段式：① 模型自选 domain/title/hook（避开最近学过/试探过）；② 她写看到/想到的具体印象，并自己给 liked/why（允许不喜欢/说不好）。结果写入 learning-log「· 试探」，probe-state.json 记 lastProbeAt；下次自学 prompt 读取喜欢/不喜欢清单。新增模型角色 `probe`（effort low、floor 1400）。
- 单测：prompt/解析/两段式流程/冷却/自学提示/自处 focus 触发。

## 77. 参考 dsh-memory：只取两小块记忆能力（M74，2026-10-26）

- 用户：看看 https://github.com/FuRongJun-1999/dsh-memory 有没有可取之处，不照搬，是否适合小鲸鱼。
- 评估：灵枢是白箱记忆平台（确定性写闸门/committed/原文真源/预算装包/时效/元认知/审计/MCP/Rust/蜂群/蜂巢/评测）。工程自觉可取，基础设施不适合单用户轻量挂件；确定性裁判与固定身份锚点还会伤到她“自生成、会变”的部分。
- 借鉴 1：`recallEchoes`——从 24h 以前 journal 条目按关键词命中打分取 ≤2 条，进记忆摘要「你以前写下过的（旧时回声）」，确定性、只读、有预算、不与最近想法重复。
- 借鉴 2：`experiencing` 36h TTL——过期不再当作“最近在体会”。
- 不做：Rust/MCP/Python/蜂群/蜂巢/双实例互验/30+ 工具/确定性语义裁判/固定身份锚点/静默遗忘。
- 笔记：`docs/reading/dsh-memory.md`。
- 单测：data 42 / host 226 / client 117 = 385/385。

## 78. 四处走走：窗口溜达 + 网络溜达（M75，2026-10-26）

- 用户：小鲸鱼可以尝试四处走走，一是在窗口中到处溜达，二是在互联网到处溜达。
- 窗口溜达（client）：新增 `nextWanderTarget` 纯函数（贴边候选：左/右/上/下外侧两段，避开底部中间输入框，距原地 ≥120px），每 2–5 分钟换一个位置，8s 过渡走过去；面板打开/刚互动/页面不可见/拖拽中不走；拖拽后安静 10 分钟。无新增设置项。
- 网络溜达（host，`lib/self-wander.mjs`）：每 3h（首次 90s–3min）GET 白名单域名（zh/en.wikipedia.org）的随机条目摘要；只取标题+摘要 ≤1200 字，不存网页正文；模型角色 `wander` 用第一人称写 2–4 句（允许“没意思”）；结果写 learning-log「· 溜达」，wander-state.json 记 lastWanderAt；睡觉/无模型/网络失败静默推迟；`DSH_POETRY_WANDER=off` 关闭。
- 隐私/安全：无用户信息、无 cookie、不登录、不评论、不发表；重定向后仍校验域名；只在允许的公开 API 上 GET。
- 单测：data 42 / host 227 / client 118 = 387/387。

## 79. 走动只调用跑步/运动素材（M76，2026-10-26）

- 用户：移动的时候可以调用跑步相关动图，且只能调用跑步或运动相关的媒体资源。
- 实现：client 新增 `pickWanderMedia(entries, random)`：从 dsh-pet webm 里按 `WANDER_MEDIA_PATTERN`（跑/奔/踏步/踱步/走路/跳跃/踢/抛接/伸懒腰/运动/锻炼/健身）过滤后随机挑；无匹配/素材未加载 → 退回静态 `dsh-whale-state-running.webp`。走动 8 秒内用 `wanderFile` 覆盖普通小动作与心情图（优先级：表情 > 走动素材 > 小动作 > 心情），走动期间普通 motion 调度暂停；拖拽/交互立即清掉走动素材；视频加载失败回退到跑步静态图。
- 非运动素材（写代码/吃饭/发呆/舞蹈等）在走动时不允许出现。
- 单测：data 42 / host 227 / client 119 = 388/388。
