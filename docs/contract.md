# dsh-poetry-widget 接口契约 v1（冻结）

> 冻结时间：2026-10-21 · Owner：Lead
> 任何字段/路由变更必须先通知 Lead，由 Lead 更新本文件并同步 host / client / data 三方。
> 本文件是 M1–M3 的唯一接口依据；PLAN.md 描述整体方案，两者冲突以本文件为准。

## 0. 标识与安装形态

| 项 | 值 |
|---|---|
| npm 包名 | `dsh-poetry-widget` |
| Loader row id | `dsh-poetry-widget` |
| 客户端模块 id | `dsh-poetry-widget`（`window.__ModuleLoader__.load({id})`） |
| 宿主插件名 | `dsh-poetry-widget` |
| 路由前缀 | `/api/dsh-poetry/` |
| 设置数据目录 | `$DSH_HOME/.dsh-poetry/`（`settings.json`） |
| 安装形态 | `plugin_manager install_bundle` → profile 内 `link:` 到本项目目录 |
| 目标宿主 | DSH `^0.2.1-rc.2`（实测 rc.3），desktop profile |

### 开发期生效方式（M0 实测）

- 宿主 `index.js` / `lib/**` 改动：需要重启宿主（Electron 应用）或依赖宿主 HMR；不能假设热更。
- 客户端 `client.js` 改动：页面刷新后重新拉取（`window.__ModuleLoader__` 惰性 factory）；以 `cordis_inspect_query` Client `Slots.listSubTree` 的 `shell.overlay` occupants 验证。
- 数据 `data/*.json` 改动：宿主进程内存缓存按 `dataVersion`/mtime 失效（host 实现须支持），客户端刷新即可。
- **不要**让任何 teammate 执行 `plugin_manager` 或 `dsh plugin`；安装/卸载只由 Lead 做。

## 1. 路由总表

所有响应均为 **HTTP 200 + JSON**（`{ok:true,...}` 或 `{ok:false,error}`），除非是静态资源 404。
`health.json` 例外于「数据缺失」规则：永远 `ok:true`，用 `dataAvailable` 表达数据状态。
栅栏范围：**assets 静态路由不套信任栅栏**（只读、仅 GET、非 GET 返回 405）；**其余数据 GET 与 settings PUT 全部套** DSH 信任栅栏；settings PUT 额外做本机来源写保护。

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/dsh-poetry/assets?f=<相对路径>` | GET | `assets/` 下只读文件（webp/svg/png/css/js/json），`Cache-Control: public, max-age=3600`；路径越界 404 |
| `/api/dsh-poetry/health.json` | GET | 永远 200：`{ok:true, version, dataVersion: string\|null, dataAvailable: boolean}`，供判活（不因数据未就绪而红） |
| `/api/dsh-poetry/bootstrap.json` | GET | 首屏聚合：版本、数据版本、今日诗 id、计数、**当前设置** |
| `/api/dsh-poetry/poems.json` | GET | 全部诗（500 首，见 §2.2） |
| `/api/dsh-poetry/ci.json` | GET | 全部词（300 首，见 §2.3） |
| `/api/dsh-poetry/yun.json` | GET | 声律启蒙 30 韵部（见 §2.4） |
| `/api/dsh-poetry/knowledge.json` | GET | 12 张格律卡 + 15 张词牌卡（见 §2.5） |
| `/api/dsh-poetry/settings.json` | GET | `{ok:true, settings:{...完整 §2.6...}}` |
| `/api/dsh-poetry/settings.json` | PUT | 部分设置合并写入；仅回环来源；`{ok:true, settings:{...合并后完整...}}` |
| `/api/dsh-poetry/pet-media` | GET/HEAD | **静态心情动画素材**（不套栅栏，与 assets 同类）：`?f=catalog.json` → dsh-pet 106 个 webm 图鉴（`{ok,entries:[{file:"webm/…",label,media:"video",tags}]}`）；`?f=webm/<名>.webm` → `video/webm`（含 ATTRIBUTION）；素材位于 `_ref/pet-media/`，不随包；缺失时 404，客户端回退 92 张静态图 |
| `/api/dsh-poetry/feihua-full.json` | GET | 飞花令**全量校验句库**按令字分片：`?char=花` → `{ok:true,char,count,entries:[[句子,出处],…]}`（来自全量 chinese-poetry 语料构建的 `_ref/feihua-full/<char>.json`，不随包）；缺失/旧宿主 → `FEIHUA_FULL_UNAVAILABLE`（200+JSON）。用于把飞花令的「有没有出处」判定扩到全量诗词 |
| `/api/dsh-poetry/mood-ai.json` | GET | 让模型根据她自己的情境（她的状态/天气/时段/自述/最近用过图）从 92 张本地立绘图鉴里**自主决定心情与配图**（非随机）；返回心情标签/理由/图片文件名；失败 `MOOD_AI_UNAVAILABLE`（200+JSON，永不 5xx） |
| `/api/dsh-poetry/self-talk.json` | GET | 让挂件用当前默认模型实时生成一句「自言自语」（诗句/随想/引出句）；宿主侧 `ctx.llm.stream` + `agentDefaultModel.currentSelection()`，2 句/批、20s 超时、失败返回 `SELF_TALK_UNAVAILABLE`（200+JSON，永不 5xx）；只使用聚合统计/天气/时间/今日诗元数据，不读会话内容 |
| `/api/dsh-poetry/weather.json` | GET | 按 `settings.weatherCity` 取当前天气（Open-Meteo 地理编码+forecast；20 分钟缓存；`?refresh=1` 强制绕过缓存；失败返回 `{ok:false,error:{code:"WEATHER_UNAVAILABLE"}}`，永不 5xx） |
| `/api/dsh-poetry/about.json` | GET | 版本、数据版本、数据源 commit/许可、脱敏后的数据文件状态 |

### 1.1 错误约定

- 数据文件缺失/损坏：`{ok:false, error:{code:"DATA_UNAVAILABLE", message:"..."}}`，仍 200。
- PUT 非回环来源：`403`，JSON `{ok:false, error:{code:"FORBIDDEN", message:"..."}}`。
- PUT 非法字段：`400`，`{ok:false, error:{code:"INVALID_SETTINGS", message, fields:[...]}}`。
- 未知路由：交由 DSH 默认 404（不要注册 fallback）。

## 2. JSON 形状

> 字段类型约定：`string` / `number` / `boolean` / `string[]`。所有面向用户的文本默认**简体**（见 §2.2 `script`），数据构建期生成，客户端不再转换。

### 2.1 dataVersion

`dataVersion`：`"<YYYY-MM-DD>.<n>"`，例如 `"2026-10-21.1"`；数据重新生成即递增，写入 `data/manifest.json`。
`bootstrap`/`health`/`about` 都返回它，供客户端缓存失效。

### 2.2 诗 `POEM`（`data/poems.json`）

```json
{
  "id": "tang-003217",
  "title": "送杜少府之任蜀州",
  "titleOriginal": "送杜少府之任蜀州",
  "author": "王勃",
  "authorOriginal": "王勃",
  "dynasty": "tang",                  // "tang" | "song"
  "lines": [
    "城阙辅三秦，风烟望五津。",
    "与君离别意，同是宦游人。",
    "海内存知己，天涯若比邻。",
    "无为在歧路，儿女共沾巾。"
  ],
  "linesOriginal": [                  // 原文（繁体；与 lines 逐字符等长，供「原文」开关使用）
    "城闕輔三秦，風煙望五津。",
    "與君離別意，同是宦遊人。",
    "海內存知己，天涯若比鄰。",
    "無爲在歧路，兒女共沾巾。"
  ],
  "tones": [                          // 与 lines 逐字符等长（标点位置用原标点）
    "平平仄仄平，平仄仄平平。",
    "仄平平仄仄，平仄仄平平。",
    "仄仄平平仄，平平仄仄平。",
    "平平仄仄仄，平仄仄平平。"
  ],
  "form": "五律",                     // "五绝" | "七绝" | "五律" | "七律"
  "start": "仄起",                    // "平起" | "仄起"（按首句第二字）
  "firstRhyme": true,                 // 首句是否入韵（首句末字平声）
  "rhymeIdx": [0, 1, 3],              // 入韵句的 0-based 行号
  "meter": "仄起首句入韵",             // 标准格式之一，用于解析文案
  "analysis": "五律，仄起首句入韵。二四六分明，粘对成立；颔联、颈联对仗。", // 预生成简体解析
  "score": 128000.0,                  // 热度（对数归一化前原始加权值，仅供排序/展示）
  "source": "strains"                 // "strains" | "curated-matched"
}
```

约束：

- `lines.length ∈ {4,8}`；每行去标点后 5 或 7 字；`tones` 与 `lines` **逐字符等长**。
- `linesOriginal` 与 `lines` / `tones` **逐字符等长**（繁体原文；构建期用 OpenCC 逐字转换，转换后长度不一致的行必须回退并报告）。
- `tones` 允许字符：`平` `仄` `○`（多音可平可仄）以及原标点 `，。！？；、`；**不允许 `？`**（含 `？` 的诗已在构建期剔除）。
- `rhymeIdx` 升序；包含所有偶数行（1,3,5,7 中 < lines.length 的）以及 `firstRhyme=true` 时的 0。
- `form` 与 `lines` 长度/字数一致；`meter` ∈ `{平起首句入韵, 平起首句不入韵, 仄起首句入韵, 仄起首句不入韵}`。

### 2.3 词 `CI`（`data/ci.json`）

```json
{
  "id": "ci-000123",
  "author": "苏轼",
  "rhythmic": "水调歌头",              // 词牌（来自原数据 rhythmic 字段）
  "lines": ["明月几时有，把酒问青天。", "..."],
  "title": "水调歌头·明月几时有",        // 构建期生成：词牌 + "·" + 首句截断（便于列表展示）
  "score": 80000.0,
  "quote": "但愿人长久，千里共婵娟。"      // 构建期人工/规则挑选的名句；没有则为 ""
}
```

约束：`lines` 原样保留（简体）；`rhythmic` 非空；`id` 唯一；`title` ≤ 40 字符。

### 2.4 韵部 `YUN`（`data/yun.json`）

```json
{
  "volumes": [
    {
      "title": "上卷",
      "chapters": [
        {
          "name": "一 东",
          "rhyme": "东",
          "paragraphs": ["云对雨，雪对风，晚照对晴空。……", "……", "……"],
          "exampleChars": ["风", "空", "虫", "弓", "东"],
          "exampleLine": "云对雨，雪对风，晚照对晴空。"
        }
      ]
    }
  ]
}
```

约束：`volumes.length===2`；每卷 `chapters.length===15`；`name` 形如 `"一 东"`；`paragraphs.length===3`；`exampleChars.length ∈ [3,8]`（构建期从韵部内提取的示例字，允许人工校正）。

### 2.5 知识 `KNOWLEDGE`（`data/knowledge.json`）

```json
{
  "cards": [
    {
      "id": "tones",
      "title": "四声与平仄",
      "summary": "一句话导语（≤40 字）",
      "paragraphs": ["正文段落 1", "正文段落 2"],
      "examples": [
        { "text": "白日依山尽，黄河入海流。", "note": "「日」「入」「落」都是入声，今读平声，格律上归仄。" }
      ]
    }
  ],
  "ciCards": [
    {
      "id": "huanxisha",
      "name": "浣溪沙",
      "aliases": ["浣溪纱"],
      "form": "双调四十二字，上片三句三平韵，下片三句两平韵",
      "rhyme": "平韵",
      "note": "一句话风格/用法说明",
      "example": "一曲新词酒一杯，去年天气旧亭台。"
    }
  ]
}
```

约束：`cards.length===12`，`id` 唯一、稳定；`ciCards.length===15`，`name` 唯一；`paragraphs` 每段 ≤ 160 字；`examples[].text` 必须是诗词原文（可与数据中诗一致）。客户端按数组顺序展示。

### 2.6 设置 `SETTINGS`（`$DSH_HOME/.dsh-poetry/settings.json`）

`script` 语义：`simplified` → 客户端渲染 `lines`/`title`/`author`；`original` → 渲染 `linesOriginal`/`titleOriginal`/`authorOriginal`。
词（ci）原文通常已是简体，`original` 对其等价。韵部（yun）与知识卡（knowledge）不提供原文切换，始终简体。

```json
{
  "schemaVersion": 1,
  "scale": 1.0,             // 0.6–1.6
  "showTones": true,
  "mode": "daily",          // "daily" | "random"
  "autoplay": 0,            // 0 | 30 | 60 | 300（秒，0=关）
  "snap": "left",           // "left" | "right" | "free"
  "script": "simplified",   // "simplified" | "original"
  "hidden": false,
  "theme": "auto",          // "auto" | "light" | "dark"
  "weatherCity": "北京",     // 1–20 字符；空串/超长 → 归一为默认「北京」
  "weatherPoem": true,      // 是否按天气选今日诗/切换形象
  "mood": true,             // 是否按心情切换立绘
  "spontaneousPoem": true,  // 是否允许低频「自己想读的诗」彩蛋
  "lastPoemId": null,       // string | null
  "tutorialSeen": false,
  "updatedAt": 0            // epoch ms，host 写入
}
```

校验规则（host 侧白名单 + 类型/枚举）：

- 只接受上表字段；其他字段忽略。
- `scale` 数值，clamp 到 `[0.6, 1.6]`；`autoplay` 只接受 `0|30|60|300`；`mode`/`snap`/`script`/`theme` 只接受枚举值；`hidden`/`showTones`/`tutorialSeen` 布尔；`lastPoemId` 为字符串或 null（若不在诗列表内则置 null）。
- 损坏的设置文件：`.bak` 备份后回退默认，不崩溃。

### 2.7 bootstrap 响应

```json
{
  "ok": true,
  "version": "0.1.0",
  "dataVersion": "2026-10-21.1",
  "source": {
    "repo": "chinese-poetry/chinese-poetry",
    "commit": "b8594f81a89752241442f2ce267d6f66f96704ee",
    "license": "MIT"
  },
  "today": { "date": "2026-10-21", "poemId": "tang-003217" },
  "counts": { "poems": 500, "ci": 300, "yun": 30, "cards": 12, "ciCards": 15 },
  "settings": { /* §2.6 完整设置 */ }
}
```

`today.poemId` 由 host 按 `date + dataVersion` 确定性计算（与客户端算法一致时客户端只用返回值，不要自行重算）。

### 2.8 about 响应

```json
{
  "ok": true,
  "version": "0.1.0",
  "dataVersion": "2026-10-21.1",
  "source": { "repo": "...", "commit": "...", "license": "MIT" },
  "files": [
    { "name": "poems.json", "bytes": 380123, "ok": true },
    { "name": "ci.json", "bytes": 190000, "ok": true }
  ],
  "settingsPath": "~/.dsh/.dsh-poetry/settings.json",
  "builtAt": "2026-10-21T03:00:00.000Z"
}
```

### 2.9 天气 `WEATHER`（`/api/dsh-poetry/weather.json`）

成功（永远 HTTP 200）：
```json
{
  "ok": true,
  "city": "北京",
  "weather": {
    "category": "rain",        // clear | cloud | fog | rain | snow | thunder | wind | cold | unknown
    "label": "小雨",            // 中文天气描述（host 侧映射，客户端直接展示）
    "tempC": 18.5,
    "feelsLikeC": 17.2,
    "humidity": 71,
    "windKph": 12.4,
    "isDay": true,
    "code": 61,                // WMO weather code（原样保留便于排查）
    "latitude": 39.9075,
    "longitude": 116.39723,
    "updatedAt": 1760000000000,
    "source": "open-meteo"
  },
  "stale": false
}
```
失败：`{ "ok": false, "error": { "code": "WEATHER_UNAVAILABLE", "message": "..." } }`（200；客户端静默回退常规/季节选诗）。
映射规则（host 实现，客户端只消费 category/label/isDay/tempC）：
- WMO 0 → clear；1–3 → cloud；45/48 → fog；51–57/61–67/80–82 → rain；71–77/85–86 → snow；95–99 → thunder；
- 非 rain/snow/thunder 时：先 `windKph ≥ 25` → wind，再 `tempC ≤ 0` → cold（降水类不被风/低温覆盖）；
- 其余 → unknown；`isDay=0` 时客户端优先「月/夜」诗池。
缓存：地理编码按城市 24h、天气 20min；刷新按钮/城市变更可主动失效。请求超时 6s，失败保留上次结果并标 `stale:true`。

### 2.15 心情动画素材 `PET-MEDIA`（M18，`/api/dsh-poetry/pet-media`）

来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）的 106 个透明 webm 动画，作为心情立绘的**动画状态**扩展（原有 92 张静态图保留）。素材由 Lead 落入项目同级 `_ref/pet-media/`（webm 52MB + catalog.json + ATTRIBUTION），**不随插件包**；`DSH_PET_MEDIA_DIR` 可覆盖。

- Host 启动时读取 `<dir>/catalog.json`，把 `media:'video'` 条目并入心情图鉴（`moodImages`），mood-ai 的模型可从 106 个动画里选；`image` 字段返回 `webm/<名>.webm`。
- 静态路由（**不套信任栅栏**，只读、无用户数据，供 `<video>` 直接加载）：`GET/HEAD /api/dsh-poetry/pet-media?f=<相对路径>`：
  - 白名单：`catalog.json`、`webm/*.webm`；MIME `application/json` / `video/webm`；`Cache-Control: public, max-age=3600`；支持 Content-Length/HEAD；404 缺文件；拒绝 `..`/绝对路径/反斜杠/空字节/非白名单扩展。
- Client：设置 mood 开启时懒加载 `?f=catalog.json` 并合并图鉴；`.webm` 心情用 `<video autoPlay muted loop playsInline>` 渲染（`.dshp-mascot-video` 与图片同样式），加载失败回退静态图；页面隐藏时暂停；动画图鉴加载失败则只用 92 张静态图（mood-ai 返回视频时按未知图回退启发式）。

### 2.14 飞花令全量校验句库 `FEIHUA-FULL`（M17，`/api/dsh-poetry/feihua-full.json`）

飞花令「是否算接上」的出处查找不再局限于当前已加载句库：客户端按**当前令字**懒加载全量校验分片，与本地句库合并后做 plain/小句/整句匹配。

- 数据：由 `scripts/build-feihua-full.mjs` 从全量 chinese-poetry 语料（全唐诗/全宋诗/全宋词/蒙学）构建，输出 `_ref/feihua-full/<令字>.json`（项目同级，**不随插件包**）：
  - 每个文件：`{ok:true,v:1,char:"花",entries:[["句子","作者《篇名》"],…]}`
  - `manifest.json`：语料规模/各令字句数/字节数
- 路由：`GET /api/dsh-poetry/feihua-full.json?char=<单字>`（信任栅栏、200+JSON 永不 5xx）：
  - 成功 `{ok:true,char,count,entries,cached}`；宿主进程内按 char 缓存（LRU ≤4）避免重复读盘；
  - 目录缺失/该字分片缺失/JSON 损坏/旧宿主 → `{ok:false,error:{code:'FEIHUA_FULL_UNAVAILABLE',message}}`；
  - 环境变量 `DSH_POETRY_FULL_INDEX` 可覆盖目录（测试/自定义语料）。
- 客户端：进入飞花/切换令字时拉取（8–20s 超时，可失败），成功则把 entries 并入句库索引（byChar/plain/clauseMap），显示「全量校验已启用（N 句）」；失败静默回退本地句库并提示「未启用全量校验」；同一令字/数据版本缓存。

### 2.13 自主记忆日志（M14，非路由副作用）

插件把**模型自己生成**的自言自语与心情决定，追加写入 `$DSH_HOME/agent-memory/`（只追加，不改写/删除；`DSH_AGENT_MEMORY_DIR` 可覆盖路径供测试）：

- `journal.jsonl`：一行一条 JSON `{ts, kind:'murmur'|'mood', text?, label?, reason?, image?, model?}`
- `journal.md`：人类可读的追加条目（日期时间 + 类型 + 内容）

边界：只写**模型生成的文本**（self-talk 的 murmur、mood-ai 的 label/reason/image）与时间/模型名；**绝不写入任何会话消息、用户原文、查询参数或插件运行数据**；写失败只记日志，不影响路由响应。

### 2.12 模型心情 `MOOD-AI`（M13，`/api/dsh-poetry/mood-ai.json`）

心情不再由伪随机/固定规则换图：模型读取**本地心情图鉴**（`assets/data/mood-catalog.json`，92 张，含中文标签/tags/节日 when）与当天真实情境，自主决定此刻心情与配图。
GET query（均可选）：`force=1`（绕过缓存）、`mood`（当前心情 key）、`weather`（天气类别/描述）、`idleMinutes`、`recent`（最近 3 条自言自语，`|` 分隔）、`recentImages`（最近用过的图片/动画文件名，`|` 分隔，**≤20**，宿主会剔除它们强制轮换）。
成功：`{ok:true, mood:{label, image, reason, energy?}, model:{provider,model}, generatedAt, cached:boolean}`。
失败：`{ok:false,error:{code:'MOOD_AI_UNAVAILABLE'|'MOOD_AI_RATE_LIMITED', message}}`（200）。
约束（v1.59）：prompt 只含日期时间/天气/她自己的状态（felt）与「最近在体会/琢磨什么」（她自己写进 self-state，不是外部文件）/最近自述/最近图片 + 图鉴（文件+中文标签+tags+media+when，**每次打乱顺序**），**不读会话内容，也不再读外部 experience.json**；模型必须从图鉴（89 静态 + 106 动画）里选，**提示词要求优先选 media=video 的动画**、不要连续重复，返回严格 JSON（label ≤12 字、reason ≤40 字、image 必须是图鉴文件名）；recentImages（≤20）会从图鉴列表移除以引导轮换；**但这只是软建议：模型若仍返回最近用过的图，只要在图鉴内就接受，不判失败**；节日图仅在对应日期可用；temperature 1.0–1.1；时长 20s、缓存 10 分钟（force 绕过）、并发去重、最小间隔 3s；无效 JSON/未知图片/空结果 → 失败。宿主启动时读取图鉴，文件缺失时返回失败（客户端回退启发式心情）。

图鉴静态资产：`GET /api/dsh-poetry/assets?f=data/mood-catalog.json` → `{ok,version,images:[{file,label,tags,scope,when?}],moodImages:[...],panelImages:[...]}`（89 心情图 + 3 panel 图）。

## 3. 客户端组件契约（client-widget 使用）（M12，`/api/dsh-poetry/self-talk.json`）

挂件「自言自语」的**随想 murmur 由当前默认模型实时生成**（只说自己此刻的想法，不引用/背诵/化用古诗文；生成失败时客户端回退本地随想池）。GET query（均可选，客户端只传非敏感上下文）：

| 参数 | 说明 |
|---|---|
| `kind` | 固定 `murmur`（自由随想 8–60 字；`intro` 已废弃，收到按 murmur 处理） |
| `mood` | 当前心情 key（happy/tired/…，客户端 mood 引擎输出） |
| `weather` | 天气类别或中文描述（rain/clear/…） |
| `idleMinutes` | 距上次用户交互的分钟数 |
| `recent` | 最近已说过的句子（≤5 句，`|` 分隔、URI 编码），用于避免重复 |

成功：`{ok:true, lines:[{text,ts}], model:{provider,model}, generatedAt, cached:boolean}`（每批 1–2 句）。
失败：`{ok:false,error:{code:'SELF_TALK_UNAVAILABLE'|'SELF_TALK_BUSY'|'SELF_TALK_RATE_LIMITED', message}}`（200）。
约束：宿主只把「日期时间、天气、心情 key、mood 聚合数字（消息/工具调用/活跃分钟）、recent 文本」发给模型（**不再发送今日诗标题/作者**，避免诱导背诗）；**不读消息内容、不带会话原文**；prompt 明确禁止引用/背诵/化用古诗文原句；模型调用超时 20s；同一实例并发去重、两次生成最小间隔 3s；空/超长/重复结果丢弃。宿主不可用（旧版未重载/模型未配置/网络失败）时客户端静默回退静态池并可在设置里提示「当前使用本地句子池」。

## 3. 客户端组件契约（client-widget 使用）（`/api/dsh-poetry/mood.json`）

宿主监听 `session/event`（`user/message` / `assistant/message` / `tool/call` / `tool/result` / `turn/start` / `turn/end`）在内存累计，防抖写 `$DSH_HOME/.dsh-poetry/mood.json`；本地日切换时归零（保留 lastActivityAt 用于「最近活动」）。

```json
{
  "ok": true,
  "date": "2026-10-21",
  "stats": {
    "userMessages": 12,        // 用户消息条数（≈聊了多少句）
    "assistantMessages": 34,
    "toolCalls": 128,          // 工具调用（工作强度）
    "toolErrors": 2,
    "turns": 9,
    "turnsCompleted": 8,
    "turnsErrored": 1,
    "activeMs": 1860000,       // 当日会话活跃时长（事件间隔累加，单段上限 10min）
    "sessions": 3,
    "firstActivityAt": 1760000000000,
    "lastActivityAt": 1760009999999
  },
  "updatedAt": 1760009999999
}
```
失败/无数据：返回 `{ok:true,date:"...",stats:{全 0},updatedAt:0}`（永不 5xx，客户端不应因此报错）。

### 2.11 扩展静态数据资产（`assets/data/`，M9）

扩展数据**不新增 Host 路由、不改 data/ 主产物**，直接放 `assets/data/`，由既有静态资源路由提供：
`GET /api/dsh-poetry/assets?f=data/<name>.json&v=<dataVersion>`（`v` 仅用于客户端缓存失效，服务端忽略）。

| 文件 | 形状 | 用途 |
|---|---|---|
| `data/anthology.json` | `{ok,dataVersion,items:[{id,category,title,author,lines:string[]}],categories:[{id,name,count}]}` | 扩展诗库（诗经/楚辞/千家诗/唐诗三百首古体），诗库 tab、飞花令句库、天气/彩蛋选诗池 |
| `data/poems-bank.json` | `{ok,dataVersion,items:[{id,title,author,dynasty,lines,tones?,form?,start?,firstRhyme?,rhymeIdx?,source:'bank'}]}` | 全唐诗/全宋诗精选库（3000–5000），诗库 tab、飞花令句库、天气/彩蛋池（不进「今日一诗」默认路径） |
| `data/pingshui.json` | `{ok,dataVersion,source,categories:[{name,short,tone,chars}],charIndex:{<char>:[categoryIndex,...]}}` | 格律检测器：106 韵部平仄/韵部查询 |
| `data/ci-bank.json` | `{ok,dataVersion,count,items:[{id,author,rhythmic,title,lines:string[]}]}` | 全量宋词库（去重后 ~20,984 首）：诗库「宋词全库」分类、词牌「全库同词牌」、飞花令句库（懒加载并入） |
| `data/manifest.json` | 三文件 bytes/sha256/dataVersion 生成信息 | 审计/可复现 |

约束：三文件为**只读静态资产**、不含用户数据；生成命令 `node scripts/build-assets-data.mjs --offline`；`dataVersion` 与主数据一致（当前 `2026-10-21.4`）。体积预算：anthology ≤400KB、poems-bank ≤8MB、pingshui ≤400KB、ci-bank ≤12MB。

## 3. 客户端组件契约（client-widget 使用）

- 注册：`ctx.slots.register({ name: 'shell.overlay', id: 'dsh-poetry-widget', order: 80 }, Component)`，`Component` 为 React 组件，props 来自 `shell.overlay`（当前无额外 owner props；无需使用 standardProps）。
- 根节点：单一 `div[data-dsh-poetry-widget="root"]`，`position:fixed`，`pointer-events:auto`；其余 overlay 区域保持 click-through。
- provider/数据获取：不引入状态库；使用 `fetch('/api/dsh-poetry/bootstrap.json')` 等；模块级缓存 + `localStorage` 仅存「上次数据」用于首屏直出。
- 主题：只用宿主 CSS 变量（`--dsw-alias-*`），同时准备 fallback 色值；暗色由变量自动切换。
- 类名：统一 `dshp-` 前缀；样式通过组件内 `<style>` 或注入一次并在 `ctx.effect` 清理。
- 不得读取其他插件 DOM / 全局业务 DOM；不得 append 到 `document.body`（M0 的 React 插槽方式为准）。
- 文案：zh-CN 为默认；为 en 提供 key 回退（v1 允许中文直接回退，但不得出现乱码/占位符）。

## 4. 体积与性能预算

| 项 | 预算 |
|---|---|
| `data/poems.json` | ≤ 620 KB（含繁体原文） |
| `data/ci.json` | ≤ 220 KB |
| `data/yun.json` | ≤ 80 KB |
| `data/knowledge.json` | ≤ 90 KB |
| `client.js`（含内联样式，M6–M21 全部功能） | ≤ 350 KB |
| 首屏请求 | bootstrap + 今日诗所需的 poems.json（可接受 ~620KB 一次拉取；后续面板复用） |
| 宿主静态/数据路由响应 | 单文件 ≤ 1 MB |

## 5. 数据构建约定（data-pipeline 使用）

- 输入源：`_ref/poetry-data`（blobless clone）或 `scripts/fetch-data.mjs` 下载；构建必须可复现：记录源 commit + 构建时间；同一输入 + 同一脚本 → 相同 `dataVersion`（除构建时间外字节级一致）。
- 原始数据只读，不改 `_ref/`；产物只写 `data/`。
- `data/manifest.json` 结构：

```json
{
  "dataVersion": "2026-10-21.1",
  "source": { "repo": "chinese-poetry/chinese-poetry", "commit": "b8594f81a89752241442f2ce267d6f66f96704ee", "license": "MIT" },
  "builtAt": "2026-10-21T03:00:00.000Z",
  "stats": { "poemCandidates": 57871, "poemsKept": 500, "ciKept": 300, "droppedNoStrain": 0 },
  "files": { "poems.json": 380123, "ci.json": 190000, "yun.json": 50000, "knowledge.json": 60000 }
}
```

- **繁简转换**：诗文本（全唐诗/全宋诗）为繁体；构建期用 `node_modules/opencc-js`（devDependency，仅构建用、不随包）逐行转换：`Converter({from:'t',to:'cn'})`。每行转换后需与原文逐字符等长，否则逐字转换或该行回退原文并在 `stats` 里计数；`title`/`author` 同样处理。
- 数据文件顶层：`{"ok":true,"dataVersion":"...","items":[...]}`（poems/ci）或 `{"ok":true,"dataVersion":"...","volumes":[...]}`（yun）或 `{"ok":true,"dataVersion":"...","cards":[...],"ciCards":[...]}`（knowledge）。
- **冒烟数据集**：M1 第一交付 = 全链路可跑的小数据集（诗 ≥30、词 ≥20、yun 全 30 韵部、cards 可先用占位），让 host/client 能联调；第二交付再替换为最终 500/300 + 完整内容。

## 6. 分工与写作用域（互斥）

| 角色 | 写作用域 | 只读 |
|---|---|---|
| Lead | `package.json`、`cordis.patch.yml`、`README.md`、`dsh-plugin.naming.json`、`locale/**`、`docs/**`、`tests/integration/**`、`PLAN.md` | 其他全部 |
| data-pipeline | `scripts/**`、`data/**`、`tests/data/**` | `_ref/poetry-data`、`content/**` |
| host-plugin | `index.js`、`lib/**`、`tests/host/**` | `data/**`（只读） |
| client-widget | `client.js`、`assets/**`（除 `assets/icon.webp`、`assets/mascot-celebrate.webp`）、`tests/client/**` | `data/**`、`locale/**` |
| content-author | `content/**` | `_ref/poetry-data`、`data/**` |

- 所有成员先 `team_task_get` → `team_task_update(claim)` → 完成后 `team_task_update(complete)` 并 send_message 给 Lead。
- 任何 schema/契约疑问：先问 Lead，不擅自改契约。
- 安装/重启/页面刷新：只由 Lead 或用户执行。

## 修订记录

- **v1.1（2026-10-21）**：数据数量不再固定 500/300。`rank/` 热度选择被证实不可靠（宋诗/冷门诗人比例过高），改为「唐三百 + 千家诗精选匹配为主、名家白名单补足」；**最终数量以 `data/manifest.json` 的 `stats` 与各数据文件实际长度为准**（下限：诗 ≥250、词 ≥150；上限不变）。客户端不得写死数量，一律读 `bootstrap.counts`/数组长度。
- v1.1 同时明确：抛体判定允许「违例 ≤2 的拗体/变格」，analysis 追加说明；三平调/孤平仍丢弃。押韵校验在构建期用公版平水韵表（`_ref/pingshui`，MIT，仅构建期 QA，不随包）完成。
- **v1.18（2026-10-23，M25）**：小动作频率提高——MOTION 间隔 3–6min→**1.5–3.5min**，播放 15–25s→**20–30s**；若当前心情图是静态图且无动作，10–20s 内尽快播一个 webm；同时修复 recentImages 对 webm 的排除失效（M24，视频重复 31/40 的根因）。
- **v1.17（2026-10-23，M23）**：新增「体验/情绪」通道——`$DSH_HOME/.dsh-poetry/experience.json`（`{title,kind,emotion,note?,at}`，超过 2h 忽略）；mood-ai prompt 注入「你最近在体验：《…》，此刻心情：感动/紧张/开心…」并优先匹配该情绪选图（感人→温柔共情、紧张→屏息专注、开心→笑等）；仍保留 video 优先/避开最近 20/活动匹配。体验文件由我（agent）在读书/看视频时写入，local 不随包；journal 不写体验正文。
- **v1.16（2026-10-23，M22）**：Host 增加「最近活动」感知——从 `tool/call` **名称**（不读参数/内容）记录最近 ≤12 条工具，归类为 看视频/逛网页、查资料/学习、写代码/跑命令、聊天/思考、发呆（60s 无调用）；mood-ai prompt 带「你最近在做：<label>」并优先匹配对应动画，仍遵守 video 优先/避开最近 20 张/不连续重复。
- **v1.15（2026-10-23，M21）**：Client 新增两套生活行为——**快速拖动晕眩**（拖拽速度 ≥1800px/s → 转圈 webm + 摇晃 + 💫 + 提示，1.5–2.5s 恢复）与**饭点吃饭**（早 07–09 / 午 11:30–13:30 / 晚 17:30–19:30，每天每餐一次，播吃饭动画 + 提醒气泡，25–40s 回心情图）；优先级 `pulse > panel > dizzy > meal > expression > motion > mood`。
- **v1.14（2026-10-23，M20）**：心情实时化——Client 去掉 15min 定时与 10min 分钟级限频，改为**事件驱动**（消息/工具/报错/面板/self-talk/飞花/天气/回前台/时段饭点等，2–4s 防抖，in-flight pending 合并），请求固定 `force=1` 绕过宿主机 10min 缓存；失败静默回退启发式。宿主的 3s 最小生成间隔仍作为防抖兜底。
- **v1.13（2026-10-23，M19）**：心情多样性——mood-ai 每次打乱图鉴、提示词优先选 video 动画、`recentImages` 上限 5→20 并从图鉴剔除；Client 心情刷新 30→15 分钟，新增「小动作」层：心情之间每 3–6 分钟按**轮转顺序**播放 106 个 webm 里的下一个（15–25s）后回心情图，优先级 `pulse > panel > expression > motion > mood`，面板/隐藏时暂停，保证全部动画都会露脸。
- **v1.12（2026-10-23，M18）**：新增心情动画素材（dsh-pet 106 个 MIT webm，`_ref/pet-media/` 不随包）；Host 静态路由 `GET /api/dsh-poetry/pet-media` + 启动时把视频并入 mood-ai 图鉴；Client 支持 `<video>` 立绘渲染与失败回退。
- **v1.11（2026-10-21，M17）**：飞花令判定出处扩到**全量诗词**（新增 `GET /api/dsh-poetry/feihua-full.json` 按令字分片路由 + `scripts/build-feihua-full.mjs`；数据位于 `_ref/` 不随包，缺失时回退本地句库）。
- **v1.10（2026-10-21，M14）**：新增自主记忆日志副作用（`$DSH_HOME/agent-memory/journal.{md,jsonl}`，只追加，仅模型生成的 self-talk/mood 内容，不含会话原文）。
- **v1.9（2026-10-21，M13）**：新增模型心情路由 `GET /api/dsh-poetry/mood-ai.json` 与本地心情图鉴 `assets/data/mood-catalog.json`（92 张全部纳入：89 心情 + 3 探头）；Client 由模型决定心情标签/理由/配图（失败回退现有启发式），面板打开时使用 3 张 peek 图。
- **v1.8b（2026-10-21，M12c）**：self-talk 收敛为**纯随想**（不念诗/不引诗、不发送今日诗上下文；客户端不再有 poem/hybrid 自言自语类型，兜底改用随想池）。
- **v1.8（2026-10-21，M12）**：自言自语 murmur/intro 改为**当前默认模型实时生成**（新 Host 路由 `GET /api/dsh-poetry/self-talk.json`）；诗句卡片仍用本地诗词；失败回退本地静态池。不新增 settings 字段、不改 data/。
- **v1.7（2026-10-21，M11）**：原「偶尔读诗」升级为「自言自语」——支持诗句 / 原创随想 / 混合三种内容，基础间隔 8–15min、≥30min 无交互的自言自语态 7–12min、硬底 5min、取消每日次数上限；沿用 `settings.spontaneousPoem`，不新增 Host 路由/字段；client 预算 260→280KB。
- **v1.6（2026-10-21，M10）**：新增 `assets/data/ci-bank.json`（全量宋词 ~20,984 首，≤12MB）；诗库新增「宋词全库」分类、词牌「全库同词牌」联动、飞花令句库懒加载并入；client 预算 240→260KB。仍不新增 Host 路由。
- **v1.5（2026-10-21，M9）**：新增扩展静态数据资产（`assets/data/` 下 anthology / poems-bank / pingshui，走既有 assets 路由）；`client.js` 预算 165→240KB；客户端新增「诗库」tab、飞花令/天气/彩蛋句库扩容、格律检测器、剩余立绘彩蛋。不新增 Host 路由、不改 data/ 主产物。
- **v1.4（2026-10-21，M8）**：`client.js` 体积预算 150→165KB；新增心情系统——Host `GET /api/dsh-poetry/mood.json`（监听 session/event 统计当日活跃/工作强度，日滚动持久化）；settings 增加 `mood`/`spontaneousPoem`；Client 用心智（聊天数/工具调用/失败/活跃时长/天气/时段/饭点/闲置/飞花战绩）计算心情并映射立绘（限频 ≥20min；飞花瞬时反馈除外），并以 45–90min 随机间隔、每日 ≤3 次、7 天内不重句的低频彩蛋展示「它想读的诗」。
- **v1.3（2026-10-21，M7）**：新增天气推荐——Host 路由 `/api/dsh-poetry/weather.json`（Open-Meteo、20min 缓存、失败降级）、settings 增加 `weatherCity`/`weatherPoem`；`assets/generated/*` 本地 92 张立绘（dsh-whale-musume，MIT）经现有 `/assets?f=generated/...` 路由提供，客户端按天气/对局状态切换形象。数据产物不变（选诗在客户端用本地 poems/ci 完成）。
- **v1.2（2026-10-21，M6）**：新增「飞花令」为**纯前端功能**——不新增路由、不改 data/、不改 settings schema；句库由客户端从已加载的 poems/ci 运行时建索引；最佳成绩存 `localStorage` key `dshp-feihua-best-v1`（`{overall, chars}`）。`client.js` 体积预算放宽至 ≤150 KB。

- **v1.65（2026-10-26，M76）**：窗口溜达期间只允许跑步/运动类媒体——`pickWanderMedia` 从 dsh-pet webm 按关键词（跑/奔/踏步/踱步/走路/跳跃/踢/抛接/伸懒腰/运动/锻炼/健身）过滤，无匹配退回静态 `dsh-whale-state-running.webp`；走动素材优先级在表情之下、普通小动作与心情图之上，走动期间普通 motion 暂停。
- **v1.64（2026-10-26，M75）**：新增「四处走走」——客户端窗口溜达（贴边换位、避开输入框、拖拽暂停，纯前端）；Host 新增 `lib/self-wander.mjs`：每 3h 只读访问白名单域名（zh/en.wikipedia.org）随机条目摘要，模型角色 `wander` 写第一人称笔记（允许“没意思”），记入 learning-log「· 溜达」；无用户信息/cookie/登录/评论，`DSH_POETRY_WANDER=off` 可关。
- **v1.63（2026-10-26，M74）**：参考 dsh-memory 只取两小块——memory-recall 新增 `recallEchoes`（24h 以前 journal 条目按关键词确定性打分，≤2 条，进摘要「你以前写下过的（旧时回声）」，不与最近想法重复）；`experiencing` 增加 36h 时效，过期不再作为“最近在体会”注入。不引入 MCP/Rust/确定性语义裁判/固定身份锚点。
- **v1.62（2026-10-26，M73）**：新增「注意力介入/试探」——自处 prompt 输出 `focus`（仅在真专注时填）；focus 非空 + 醒着 + 距上次 ≥3h 触发 `probe` 角色两段式模型调用（自选 domain/title/hook → 她写 impression 并自己给 liked/why）；结果写入 learning-log「· 试探」，probe-state.json 记 lastProbeAt；喜欢/不喜欢进入自学提示。新增模型策略角色 `probe`（effort low，token floor 1400）。
- **v1.61（2026-10-26，M72）**：新增 `lib/language-style.mjs` 结构约束并接入 self-talk/mood-ai/self-drive/reflect/learn/voice 六个 prompt（去 AI 味；参考 qu-ai-wei 编辑思路，不列禁词）。
- **v1.59（2026-10-26，M70）**：外部 `experience.json` 退役——她的「最近在体会/琢磨什么」改由自处模型写进 `self-state.json`（`experiencing/experiencingAt`），mood-ai/self-talk prompt 从这里读取；旧文件启动改名 `.retired-*`，不参与记忆中枢（11 个文件）。
- **v1.58（2026-10-26，M69）**：插件上下文与记忆和对话彻底解耦——移除 `GET /api/dsh-poetry/mood.json` 与 `session/event` 监听；不再统计/传递会话活跃数据（消息数、工具调用、回合、活跃时长、最近活动、互动间隔）；mood-ai/self-talk prompt 与客户端启发式心情不再读取这些数据；旧 `mood.json` 启动时改名为 `.retired-*` 保留、不参与记忆中枢。心情/自处/碎碎念只依赖她自己的状态、天气、时间与记忆。
