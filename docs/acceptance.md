# 验收记录（M48）

> 执行人：Lead · 目标宿主：DSH 0.2.1-rc.2 / desktop profile / GUI http://127.0.0.1:57623
> 数据版本：`2026-10-21.4`（诗 320 / 词 283 / 韵部 30 / 知识卡 12 / 词牌卡 15）
> 最后更新：2026-10-23 M48（v0.1.3 发布整理：自驱成长/记忆中枢/自主行为/声音档案；356 项单测全过）

## A. 静态与数据

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| A1 | `node --check` 全部 JS | ✅ | index.js / lib/*.mjs / client.js（含飞花令）/ scripts / tests 全过 |
| A2 | `node --test tests/data.test.mjs` | ✅ | 42 pass / 0 fail（含 data-src 离线快照 + M9/M10 四份数据资产） |
| A3 | `node --test tests/host.test.mjs` | ✅ | 199 pass / 0 fail（+模型策略 3） |
| A4 | `node --test tests/client.test.mjs` | ✅ | 117 pass / 0 fail（-静态池，仅模型生成） |
| A5 | 三套合计 | ✅ | **358 tests / 358 pass / 0 fail**（data 42 / host 199 / client 117） |
| A6 | `node scripts/validate-data.mjs` | ✅ | 0 错误 / 0 warning（含押韵门、体式、简体残留、生僻字、词牌覆盖） |
| A7 | `node tests/integration/verify.mjs` | ✅ | **64/64 passed, 0 failed, 10 warnings（栅栏 401 属预期；含 4 份 assets/data 资产）** |
| A8 | 数据构建可复现 | ✅ | 连续两次构建 4 个数据文件 sha256 一致 |
| A9 | 数据抽检 | ✅ | data-pipeline 5 首诗 + 5 首词全文抽检；content-author 独立押韵 QA；Lead 扫描词作者/词牌/缺字/异体 |

## B. 安装与加载

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| B1 | `plugin_manager install_bundle` | ✅ | `application: applied`（首次用 public npm registry 规避 corp mirror 缺 dsh-context@0.73.3 的问题） |
| B2 | profile 记录 | ✅ | `link:<项目绝对路径>`；bundles 含 `dsh-poetry-widget` |
| B3 | Client 注册 | ✅ | `Slots.listSubTree('shell.overlay')` occupant `dsh-poetry-widget` active（order 80）；client.js 137KB（≤150KB 预算） |
| B4 | 宿主路由存活 | ✅ | `GET /api/dsh-poetry/assets` → 200 image/webp；其余 10 条数据/设置/天气/心晴路由 → 401（DSH 信任栅栏，浏览器同源可访问） |
| B5 | 宿主半区重载方式 | ✅ | 改宿主代码后 `plugin_manager set_bundle(enabled:false→true)` 即重载新模块（无需重启 App）；M7 新增 weather 路由后同样 toggle 生效 |

## C. 功能（浏览器目视/交互）

| # | 检查 | 结果 | 备注 |
|---|---|---|---|
| C1 | 形象可见、不遮挡输入框 | ✅ | 用户确认「看到了，形象在左下角」 |
| C2 | 今日一诗 + 逐字平仄着色 + 韵脚下划线 | ✅ | 用户确认「① 今日一诗与平仄着色正常」 |
| C3 | 点击序列 + 气泡圆点直切 | ✅ | 用户确认「圆点切换现在正常了」；点 1–5 直达卡片、第 6 个收起；22 条 client 单测覆盖 |
| C4 | 面板 5 tab（今日/课堂/韵部/词牌/设置） | ✅ | 用户确认「面板 5 tab 正常」 |
| C5 | 拖拽/吸附/缩放/隐藏恢复 | ✅ | 用户确认「拖拽/缩放/设置正常」 |
| C6 | 设置持久化（刷新/重启后保留） | ✅（刷新维度） | 用户确认设置即时生效并保留；host 单测覆盖校验/原子写/损坏回退；跨重启未单独复验 |
| C7 | 繁简切换（simplified ↔ original） | ✅ | 用户确认「设置正常」（含繁简切换项）；数据含 linesOriginal，单测覆盖 |
| C8 | 空态/接口失败不白屏 | ✅ | client 单测覆盖 `{ok:false}`/500/超时；ErrorBoundary |
| C9 | 暗色/主题变量 | ⚠️ 代码级验证 | 全部颜色走 `--dsw-alias-*` + fallback；未做暗色实机目测（可由用户切主题确认） |
| C10 | 飞花令入口（面板第 6 tab + 气泡第 6 卡） | ✅ | 用户确认「入口正常（面板 6 tab + 气泡第 6 张）」 |
| C11 | 飞花令自由输入对句（系统出句→玩家输入→校验出处/令字/本局重复→系统接句；**出处查全量诗词**（按令字分片懒加载，`_ref/feihua-full` 不随包，缺失回退本地库）；不扣命；本字最佳；图鉴保留） | ✅ | 用户要求「全量诗词中查找」；构建 333,555 首/1,512,542 句/1,792,390 条（32 令字，167MB）；Host 14 路由 + gzip；client 92 测试覆盖加载/合并/回退 |
| C12 | 天气 chip + 按天气选的今日诗 | ✅ | 用户确认「有 chip，诗也是天气主题」；host 真实 Open-Meteo 冒烟 + client 端到端用例 |
| C13 | 形象随天气切换（晴/云/雨/雪/雷/冷/夜） | ✅ | 用户确认「形象随天气切换正常」；92 张本地立绘（12.69MB，MIT） |
| C14 | 设置城市/按天气选诗开关/刷新天气 | ✅ | 用户确认「城市/开关/刷新正常」；设置持久化到 settings.json |
| C15 | 飞花令输赢/思考立绘反馈 | ✅ | 用户确认「飞花令立绘反馈正常」（2.5s 后回天气/默认） |
| C16 | 心情 chip + 心情理由/刷新心情（**实时事件驱动**：聊天/工具/报错/面板/自语/飞花/天气/回前台/时段饭点，2–4s 防抖，无固定间隔，force=1） | ✅ | 用户要求「心情实时变化，不需要间隔」；client 99 测试覆盖事件/防抖/in-flight pending/失败回退 |
| C17 | 心情立绘：92 静态 + 106 dsh-pet webm；mood-ai 优先动画且避开最近 20 张，15min 刷新；心情之间每 3–6min 轮转播放动画（15–25s） | ✅ | 用户反馈「图像没怎么更新/动图没用到」后修复；journal 统计 41 次心情仅 8 次视频且只有 2 个动画；client 98 / host 117 测试覆盖轮转与多样性 |
| C18 | 自言自语（**纯模型随想**，不背诗/不引诗；**无时间闸门**：20–40s 轮询 + 事件唤醒、3s 安静、一卡制、25s 自动关、无每日次数；失败回退本地随想池；可关/预览） | ✅ | 用户要求「不限制时间、随时随地」；client 88 测试覆盖随时触发/一卡制/事件唤醒/后台不弹；Host prompt 禁止引诗 |
| C19 | 诗库 tab（7 tab；分类/搜索/分页/详情，5,224 首） | ✅ | 用户验收；data 41 项 + client 59 项测试覆盖真实数据渲染 |
| C20 | 格律检测器（选中诗 + 自定义输入；106 韵部/诗体/韵部/粘对/拗字） | ✅ | 用户验收；真实示例「登鹳雀楼」输出五绝/仄起/十一尤/0 拗字 |
| C21 | 飞花令句库扩容（32,427 句，花 991/月 979/风 1,564） | ✅ | 用户验收；图鉴含诗经/全唐诗句子 |
| C22 | 立绘彩蛋（双击随机表情、每日 greet、idle ≥45min） | ✅ | 用户验收；22 张表情+greet 状态接入，失败回滚 celebrate |
| C23 | 宋词默认精选 283 首；「全部宋词」按需展开（20,044 首，7.2MB 懒加载）；搜索范围精选/全库；切回不重复加载 | ✅ | 用户反馈「太多了」后改为精选默认 + 全库按需；client 69 测试覆盖默认不拉全库、显式加载、切回不重复 |
| C24 | 词牌「同词牌精选 N 首」主入口 + 「全库 M 首」次级入口；飞花令句库完整句（基础 3,244 / 扩展 22,551 / 含宋词全库 155,504） | ✅ | 用户反馈半句后改为合句口径；句库/选项/系统出句/图鉴均以 。！？结尾，71 项 client 测试覆盖 |

## D. 安全与卸载

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| D1 | 数据 GET 走信任栅栏 | ✅ | 裸 curl → 401；伪造 Host → 403（host 单测 + 实机） |
| D2 | settings PUT 仅回环来源 | ✅ | host 单测覆盖 403/FORBIDDEN、clamp、白名单 |
| D3 | 零外部网络/零凭据/零遥测 | ✅ | 代码审查：仅 fetch 同源 `/api/dsh-poetry/*`；无凭据读取 |
| D4 | 卸载回归 | ✅（web profile 等效验证） | `dsh plugin --profile web add link:…` → `dsh plugin --profile web remove dsh-poetry-widget`：依赖与 bundles 均清理干净、`dump-config` 无残留；node_modules 留一个 link 符号链接（pnpm 对 link: 的已知残留，不参与 profile 组合，`pnpm install` 可清）。桌面 profile 的 remove_bundle 未实测（当前会话审批被禁用，plugin_manager 不可用） |
| D5 | 重装回归 | ✅（web profile 等效验证） | add → remove 后再 add 同一路径成功（91–96ms），bundles 恢复；桌面端 link 安装同理，重装即恢复 |

## E. M7 本地资源与离线

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| E1 | 92 张立绘本地化 | ✅ | `assets/generated/` 92 个 WebP / 12,692,916 B（与上游一致），经本地 assets 路由提供 |
| E2 | curated 源快照 | ✅ | `data-src/` 10 文件 / 892KB（唐诗三百首/宋词三百首/千家诗/声律启蒙/诗经/楚辞 + LICENSE/README/source.json） |
| E3 | 完整语料本地缓存 | ✅ | `_ref/poetry-source/b8594f81a897/` 326.7MB / 1330 文件（项目同级，不随包）；`_ref/feihua-full/` 167MB / 32 令字分片（飞花令全量校验，不随包）；`_ref/pet-media/` 52MB / 106 个 webm（心情动画，MIT，不随包） |
| E4 | 完全离线重建 | ✅ | `node scripts/fetch-data.mjs --offline` 通过；`build-data --offline` 产物 sha256 与在线构建一致 |
| E5 | 天气依赖 | ⚠️ 运行时唯一外网 | 仅 Open-Meteo 两个固定域名；失败静默回退，不阻塞其他功能 |
| E6 | M9 扩展数据资产 | ✅ | `assets/data/`：anthology 724 首 356KB / poems-bank 4,500 首 2.12MB / pingshui 106 韵部 160KB；`scripts/build-assets-data.mjs --offline` 可复现；静态路由 200 实测 |
| E7 | M10 宋词全库资产 | ✅ | `assets/data/ci-bank.json` 20,044 首 / 150,649 行 / 7.58MB（源 21,050：去重 −63、Ext-B −14、缺字占位 −929）；4 资产一次构建、连跑 sha256 一致；静态路由 200 实测 |

## F. 未覆盖边界（如实记录）

- Electron 内无法做 DOM 自动化截图；视觉以用户确认为准。
- 未在 `dsh web`（web profile）与 Windows/Linux 验证；天气数据依赖 Open-Meteo 可达性（失败静默回退普通选诗）。
- 词牌不提供逐字词谱；押韵只在构建期用《平水韵》校验，界面不展示 106 韵部字表。
- 卸载/重装回归未实际执行（命令与回滚方式已写入 README）。
