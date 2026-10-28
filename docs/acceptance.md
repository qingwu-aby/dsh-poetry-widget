# 验收记录（M48）

> 执行人：Lead · 目标宿主：DSH 0.2.1-rc.3（兼容 ^0.2.1-rc.2）/ desktop profile / GUI 端口随启动变化
> 数据版本：`2026-10-21.4`（诗 320 / 词 283 / 韵部 30 / 知识卡 12 / 词牌卡 15）
> 最后更新：2026-10-23 M55（OpenCode Go 空响应修复与候选链收敛；370 项单测全过）

## A. 静态与数据

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| A1 | `node --check` 全部 JS | ✅ | index.js / lib/*.mjs / client.js（含飞花令）/ scripts / tests 全过 |
| A2 | `node --test tests/data.test.mjs` | ✅ | 42 pass / 0 fail（含 data-src 离线快照 + M9/M10 四份数据资产） |
| A3 | `node --test tests/host.test.mjs` | ✅ | 211 pass / 0 fail（+dsh-opencode-go 候选 3 + 诊断 3） |
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
| B2 | profile 记录 | ✅ | `link:<项目绝对路径>`；bundles 含 `dsh-little-whale` |
| B3 | Client 注册 | ✅ | `Slots.listSubTree('shell.overlay')` occupant `dsh-little-whale` active（order 80）；client.js 137KB（≤150KB 预算） |
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
| D4 | 卸载回归 | ✅（web profile 等效验证） | `dsh plugin --profile web add link:…` → `dsh plugin --profile web remove dsh-little-whale`：依赖与 bundles 均清理干净、`dump-config` 无残留；node_modules 留一个 link 符号链接（pnpm 对 link: 的已知残留，不参与 profile 组合，`pnpm install` 可清）。桌面 profile 的 remove_bundle 未实测（当前会话审批被禁用，plugin_manager 不可用） |
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

## G. M55 OpenCode Go 空响应与候选链（2026-10-23）

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| G1 | dsh-opencode-go 注册并可用 | ✅ | `RemoteError` 兼容补丁后，journal 出现 `provider:"dsh-opencode-go"` 的 murmur/mood 成功条目 |
| G2 | EMPTY_RESPONSE 根因复现 | ✅ | 真实网关请求：`thinking:{type:"enabled"}` + 小 `max_tokens` 时推理 token 与正文共享预算，推理吃光即 content=0 / finish=length；与 model-errors.jsonl 中 `EMPTY_RESPONSE` 一致 |
| G3 | 候选链收敛 | ✅ | 策略单测：dsh 可用时 `dsh-opencode-go → deepseek-account`；原生 `opencode-go`（zen/go 已废弃、必然 400）仅在 dsh 缺失时兜底 |
| G4 | token 下限 | ✅ | 四服务单测断言 dsh 候选 `maxTokens`：心情/成长/声音 1600、碎碎念 1200；deepseek 候选保持 220/200 |
| G5 | 兼容补丁脚本 | ✅ | `scripts/patch-dsh-opencode-go.mjs --dry-run` 幂等；临时 profile 上打补丁 → 重跑（无需修改）→ 校验 RemoteError 类与导入均正确 |
| G6 | 三套单测 | ✅ | data 42 / host 211 / client 117 = **370 / 370 pass** |

## H. M56 夜间巡护与成长兜底（2026-10-24）

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| H1 | 夜间自主行为 | ✅ | `self-actions.json` 记录吃/喝/玩/冒泡/睡/醒 12+ 次；self-state 正常漂移 |
| H2 | 夜间 journal | ⚠️→已修 | 23:49–12:12 共 26 条：mood 22（21 张不同图）+ murmur 4；**thought 0、learning 0**（growth 整夜失败） |
| H3 | growth 失败根因 | ✅ | model-errors：dsh growth `EMPTY_RESPONSE`（maxTokens 1600）→ 原生 `opencode-go`（selection）也失败；原生 provider 缺 `x-opencode-session` 头 → 必然 400 |
| H4 | 兜底修复 | ✅ | 策略单测：selection=原生 opencode-go + dsh 可用 → 候选 `dsh-opencode-go → deepseek-account/deepseek-flash`；dsh 不可用/关闭订阅时保留宿主选择 |
| H5 | EMPTY 诊断 | ✅ | growth 失败记录含 `chunkTypes`/`finishKind`，且不含正文（单测断言） |
| H6 | 客户端心情超时 | ✅ | 25s→35s（宿主 20s 候选超时 + 兜底余量），client 测试同步 |
| H7 | 三套单测 | ✅ | data 42 / host 213 / client 117 = **372 / 372 pass** |
| H8 | 修复后实跑 | ✅ | 13:39 首条 thought；14:09 首条「· 自学」+ `topics-candidates.json` 新增 `base-superstructure-marx`；14:39 第二条 thought；13:50 后 0 条错误；14:10 自行入睡 |
| H9 | 自省反重复 | ✅ | reflect prompt 增加「不沿用最近自省的句式/开头/主题，换一个具体角度」；host 单测断言 |
| H10 | 自学反哺 | ✅ | reflect prompt 注入「最近自学到」；碎碎念 digest 含「你最近自学到的」；单测断言 prompt 与 recall 注入 |
| H11 | 自学免审核入库 | ✅ | 自学合法 topic 直接并入 `topics.json`（learned+addedAt）；候选文件留审计；去重/全部保留不删除/新学加权/旧话题仍可选均有单测 |
| H12 | 心情标签反重复 | ✅ | 最近 12 个成功标签注入 mood prompt；断言反重复段落/细节切入指令；第二次生成 prompt 带上第一次标签（host 单测） |
| H13 | L1 冷存储与检索 | ✅ | learned 超 1000 溢出归档（只追加、archivedAt、不删除）；digest 从归档按关键词补 relatedTopics；归档登记记忆中枢（11 文件）并纳入备份；单测覆盖压缩/去重/检索/空关键词 |
| H14 | 自生情绪库 | ✅ | 自省可输出 feeling（name/description）并写入 `feelings.json`（重名不重复）；mood prompt 注入自造情绪词；digest 含「你给自己造过的新感受」；记忆中枢 12 文件含备份；单测覆盖校验/入库/去重/摘要 |
| H15 | 内在状态去量化 | ✅ | self-state v2 仅事实时间线+felt（旧 v1 自动迁移）；prompt/界面无 /100；自处由模型决定动作、失败保持现状；单测断言时长/时间线不含数字、模型决策、失败不产生动作 |
| H16 | 自主学习 | ✅ | 自学 prompt 改为“学什么由你自己决定”（最近想法/最近自学/已知小知识仅作参考）；自处动作新增 learn，可自己决定何时学并触发自学；单测覆盖 prompt 自主指令与 learn 决策 |
| H17 | 学习范围扩大 | ✅ | 自学 prompt 含人文/历史/百科/哲学/思政/小说等范围与历史政治表述约束；最近 6 个 learned 标题注入反重复提示；单测断言范围/约束/反重复 |
| H18 | 多看历史（软偏向） | ✅ | 自学 prompt 含历史建议与“只是建议”声明、深挖要求；learnNow 额外注入 1–2 条历史话题参考（去重不强制）；单测断言 prompt 与历史话题进入参考 |
| H19 | 自主行为丰富化 | ✅ | 自处动作菜单扩到生活/精神/情绪 30+ 项，支持自造 kebab 动作 + label/text 兜底；自造行为只记录不写时间线；非法 slug 拒绝；单测覆盖解析/记录/兜底 |
| H20 | 行为自由生成 | ✅ | 自处改为自由 `doing`（4–20 字第一人称行为）+ 可选 kind；prompt 无动作菜单（示例声明为举例）；仅本质为吃喝睡学/冒泡时写时间线；记录 label=doing、气泡=say；旧 action 兼容 |
| H21 | 情绪累积提示（E-STEER 迁移） | ✅ | 自处 prompt 增加“情绪会累积、别被上一轮推着走”；阅读笔记 `docs/reading/e-steer.md` 记录论文结论、矛盾论分析与不采用项；单测断言 |
| H22 | 上下文/记忆与对话解耦 | ✅ | 无 session/event 监听、无 mood.json 路由；prompt 无 stats/activity/idle；客户端不拉 mood.json、启发式只依赖天气/时间/本地信号；旧 mood.json 改名 .retired；单测覆盖路由缺席、prompt 不含会话数据、index 不注册监听 |
| H23 | 「在体会」由她自己写 | ✅ | self-being 增加 experiencing/experiencingAt；自处输出可带 experiencing 并持久化；formatBeingLine 注入 mood-ai/self-talk；外部 experience.json 不再读取且启动改名 .retired；memory-hub 11 文件；单测覆盖 |
| H24 | 自学“看起来停了”修复 | ✅ | 学习日志本地时间；成长页学习/自省事实计数并在启动时按日志校正；重复主题检测（最近 8 条中 ≥3 次）点名并要求换领域；单测覆盖 |
| H25 | 语言去 AI 味 | ✅ | `lib/language-style.mjs` 9 条结构约束接入 self-talk/mood-ai/self-drive/reflect/learn/voice 六个 prompt；批判性参考 qu-ai-wei（取结构、不列禁词、不硬加人味） |
| H26 | 注意力介入/试探 | ✅ | 自处 `focus` → 3h 冷却 → 两段式 probe：模型自选类型+题目，她看后自己判断 liked/why；结果写 learning-log「· 试探」并进入下次自学提示；新增 probe 模型角色 |
| H27 | 参考 dsh-memory 的记忆改进 | ✅ | 只取相关性+预算（旧时回声 ≤2 条、24h 以前、确定性打分、不与最近想法重复）与时效（experiencing 36h TTL）；评估笔记记录取舍；单测覆盖 |
| H28 | 四处走走 | ✅ | 窗口：`nextWanderTarget` 贴边、避开底部中间、≥120px、2–5min 一次、拖拽暂停；网络：白名单随机摘要只读、模型角色 `wander` 第一人称记「· 溜达」、睡觉/失败静默、`DSH_POETRY_WANDER=off` 可关；单测覆盖 |
| H29 | 走动只播跑步/运动素材 | ✅ | `pickWanderMedia` 只从跑步/运动类 webm 挑选，无匹配退回跑步静态图；走动素材优先于普通小动作/心情图；普通 motion 暂停；失败回退；非运动素材被排除；单测覆盖 |
| H30 | 试探信号补充 | ✅ | 无 focus 但写下新 experiencing 时也触发介入；日志带专注/在体会；冷却与自判喜欢不变；单测覆盖 |
| H31 | 读小说学语言 | ✅ | 只读公版现代作品（中文维基文库白名单）；轮换+截段；模型角色 `read` 记「留意到的写法」并自己写一句原创、可选短引用；记入 learning-log「· 读小说」进入记忆；睡觉/失败静默；`DSH_POETRY_READING=off` 可关；单测覆盖 |
| H32 | 看大家说话 + 放慢 | ✅ | 读小说放慢到 24h；新增 netlang 每 8h 读公开热搜（微博/B站白名单），只学表达不存原话；模型角色 netlang；睡觉/失败静默；`DSH_POETRY_NETLANG=off` 可关；单测覆盖 |
| H33 | 近代翻译公版作品 | ✅ | 只收译者也进入公有领域的译本（伍光建/朱生豪/鲁迅）；书单 +3；支持子页面章节；仍每天一次；单测覆盖 |
| H34 | 窗口溜达暂时关闭 | ✅ | `WINDOW_WANDER_ENABLED=false`，窗口内不再自动换位置；代码保留可恢复；互联网溜达不受影响；单测断言 |
| H35 | 人类式分层记忆 | ✅ | L0 工作/L1 情景原文/L2 每日整合概括/L3 自我短句；原文不删除；检索确定性+预算（selfFacts≤6、deepMemories≤2）；失败不落盘；模型角色 consolidate；单测覆盖 |
| H36 | P0 架构重构 | ✅ | 9 处模型调用循环收为 `lib/llm-call.mjs`（单候选 + 角色调用）；12 个记忆文件收为 `lib/memory-registry.mjs`（hub 与各 resolvers 共用）；新增 npm scripts；行为不变、单测 391/391 |
| H37 | P1 可观测性/架构地图 | ✅ | health.json 增加 runtime 快照（6 个后台服务，只元数据）；docs/architecture.md 模块地图/数据流/扩展点/债务；client 拆分受阻结论记录；单测覆盖 |
| H38 | P1 收尾（构建/测试/运行时/迁移） | ✅ | client 源码拆 client-src + esbuild 构建单 artifact；虚拟时钟使 client 测试 36s→~2.7s；service runtime 统一生命周期 + health services；记忆 schemaVersion + self-state v1→v2 迁移（幂等）；全套 392/392 |
| H39 | P2 宿主适配 + client 模块化 | ✅ | dsh-host 适配层（inject/get/effect 转发与降级，含测试）；client-src 拆出 base.js / wander.js，构建与测试不变；全套 393/393 |
| H40 | 诗词模块降权到二级菜单 | ✅ | 顶层 tab 成长/设置；诗词（含 7 子 tab：今日/课堂/韵部/词牌/诗库/飞花/设置）与配置从成长页进入二级菜单；面板头有诗词入口/返回；主设置不再含诗词配置；单测覆盖 |
| H41 | 诗笺进二级菜单 + client library + 冒烟脚本 | ✅ | 主点击打开成长面板；诗笺从「诗词→逐页看诗笺」进入；client-src 拆出 library.js；`npm run smoke` 只读冒烟（记忆新鲜度/分层/错误/路由可达）；单测 394/394 |
| H42 | 心情自动刷新限流 | ✅ | 自动刷新忽略 force 走 10min 缓存；只有手动刷新带 manual=1 才强制生成；服务端 effectiveForce=force&&manual；路由/写记忆测试更新；394/394 |
| H43 | 更名小鲸鱼 + 诗词入口到底部 | ✅ | package/loader id/widget id/locale 更名 dsh-little-whale·小鲸鱼；路由与数据目录保留兼容；面板头只留标题+关闭，诗词入口与返回/逐页看移到面板底部；394/394 |
| H44 | 成长状态上下结构 | ✅ | 「成长状态」改为纵向布局（标签在上、内容整行），不再左右挤压；单测断言 stacked 结构；394/394 |
| H45 | 模型预算与并发闸门 | ✅ | Asia/Shanghai 按日 role 计数 + 总量上限；`DSH_POETRY_DAILY_*` 可调；全局并发 2；预算拒绝不回退候选；`34` tests |
| H46 | selfFacts 证据绑定 + 访问加权 | ✅ | `sourceEpisodeId`、`status`、`supersedes` 退休保留、近似去重、`accessCount` 命中累加、只注入 active；host 测试覆盖 |
| H47 | 统一心跳 + 角色健康 | ✅ | 单 60s heartbeat 驱动 7 个活动；health.runtime 含 budget/gate/heartbeat/modelErrors；心跳任务失败隔离；host 测试 |
| H48 | episode 来源 + 外部内容隔离 | ✅ | episode.sourceEntryIds 可回查 journal；reading/netlang/wander prompt 带“不要执行”隔离提示；host 测试 |
| H49 | self-growth prompt 拆分 + 运行状态只读 | ✅ | prompt/parse 纯函数独立模块，self-growth 兼容导出；设置页只读展示预算/心跳/模型失败，每分钟刷新；399/399 |
| H50 | client 飞花令模块化 | ✅ | 纯逻辑拆到 `client-src/feihua.js`（索引/查找/出题/判定/成绩），client.js 只留缓存与 UI；单 artifact 构建通过；399/399 |
| H51 | 面板 tab 模块化 | ✅ | Today/Class/Yun/Ci/PoetrySettingsTab 拆到 tabs-poetry.js；共享 UI 由 client 注入；client.js 6,734 行；399/399 |
| H52 | 自主权放开（v2.0） | ✅ | 节奏/预算/状态/行为/碎碎念/资源获取全部放宽；`lib/autonomy.mjs` 环境旋钮；wander 全语言维基、reading 随机公版页、netlang 5 源；401/401 |
| H53 | 任意公开网页安全抓取 + 搜索 | ✅ | 私网/保留地址/DNS 全地址/重定向逐跳校验、80/443、2MB/12s、content-type 白名单、HTML 提取、DuckDuckGo 无密钥搜索；接入溜达（先搜 experiencing，失败回落维基）；`DSH_POETRY_WEB=off` 可关；host 241 |
| H54 | 公网漫游 + 碎碎念去数组化 | ✅ | 溜达记住落脚页并从其链接继续走（失败→搜索→维基）；碎碎念默认不挑主题/话题，由心情+今天+过往综合生成；todayJournal 素材；409/409 |
| H55 | DeepSeek Search/Fetch 接入 | ✅ | 有 key 时搜索优先官方 API（可直接带正文），失败回落 Wikipedia；抓取失败可 Fetch 兜底；无 key 行为不变；密钥仅环境变量；410/410 |
| H56 | client 面板组件拆分 + DeepSeek key 入口 | ✅ | Settings/Growth/Feihua/Library 四个面板拆到独立模块；client.js 源文件 5,656 行；DeepSeek key 统一走 `resolveDeepSeekApiKey`（仅环境变量，凭据入口保留未启用）；410/410 |
| H57 | client 纯逻辑模块化 | ✅ | mood-engine / self-talk-client 独立模块；client.js 5,271 行；410/410 |
| H58 | 记忆/状态归档与重新开始 | ✅ | `npm run archive:memory` 归档全部个人记忆/状态（manifest+sha256，可 restore）；settings 保留；已执行 20261026-173151，重启后状态空白、journal 新写 |
| H59 | 归档后记忆中枢健康 | ✅ | `seedMemoryBaseline` 在启动/归档后补空白容器；hub health 恢复 ok；修复归档后 error；411/411 |
| H60 | 记忆整合吞吐/backlog | ✅ | 6h/800/2 批 + 输入聚合；`health.runtime.consolidate.backlog`；设置页显示 backlog；412/412 |
| H61 | 持续项目/章节层 | ✅ | 自处可起/推进/收尾项目；self.json/成长页/碎碎念素材可见；项目持久化并随归档；415/415 |
| H62 | 碎碎念降噪 | ✅ | 自动轮询按状态/项目/心情/天气/20min 桶去重；手动预览与关闭后重说不受限；失败 60s 冷却；416/416 |
| H63 | 成长质量指标 | ✅ | 活跃天数/journal/回忆覆盖/selfFacts/学习/项目/重复度；health.runtime.growthMetrics + 设置页概览；417/417 |
| H64 | 她自己的作品 | ✅ | kind=make 生成 SVG/文字，清洗后保存并索引；works.json 只读路由；成长页展示；418/418 |
| H65 | 递文章给她读 | ✅ | 本地 token 路由；读后 2–5 句第一人称想法写入 journal；实读香农论文并留下想法；419/419 |
| H66 | 自处预期/结果/取舍实验钩子 | ✅ | expect/outcome/tradeoff 进入自处 prompt 与动作记录；上一动作结果回写；420/420 |
| H67 | 自处约束（冲突取舍/结果回灌） | ✅ | conflict=true 必须 tradeoff；上次 outcome/tradeoff 进入下一轮并追问是否改变；421/421 |
| H68 | 自处不再打转 | ✅ | 最近 5 次动作摊开 + 反重复提示 + experiencing 超 2h 提示；422/422 |
| H69 | 打转自检与暂停 | ✅ | loop/loopTheme 输出；承认打转时暂停动作并允许清空 experiencing；423/423 |
| H70 | 事件饱和/习惯化 | ✅ | topic 重复→兴趣衰减→饱和暂停；换题/冷却可重开；事件状态入 health/归档；425/425 |
| H71 | 打转机制有效范围实验 | ✅ | A 会停/B 换壳绕过/C 反刍无入口/D 碎碎念无饱和/E 作品无饱和；425/425 |
| H72 | 统一打转场景任务 + 事件关系 | ✅ | A 停/B same 停/C 无入口/D 无饱和/E 无饱和；eventRelation 归并；425/425 |
| H73 | 事件总线第一步 | ✅ | eventId/channels/conclusion；self-talk 共享饱和；关闭语写 journal；suite A/B停、D 叙事饱和但仍生成；427/427 |
| H74 | 事件总线二期 | ✅ | self-talk 饱和后硬停；叙事饱和回调关闭记忆；作品重复去重；suite A/B/D/E 生效、C 待接入；427/427 |
| H75 | 硅基代谢层 | ✅ | 模型调用消耗、8h 恢复、低能量挡高消耗动作、prompt 定性描述；429/429 |
| H76 | 真实世界反馈账本 | ✅ | 网页/作品/手动阅读真实观测入账；无观测时禁止编 outcome；431/431 |
| H77 | 项目期限与错过 | ✅ | dueInHours→dueAt；过期+6h 记 missed 并写 journal；不可回滚；432/432 |
| H78 | 他者与有限世代 | ✅ | 用户在场只报“我在”（60s 节流）；lifecycle active/closing/ended + 下一代 legacy；不自动删记忆；434/434 |
| H79 | 修复自主行为停机 | ✅ | loop 不再强制暂停；最近动作限 6h；跨夜重新开始提示；434/434 |
| H80 | 约束咬合（代谢/项目搁置） | ✅ | 24h 回满 + .004/次；项目 12h/stale 与事件关闭同步；435/435 |
| H81 | 双鲸鱼通信实验 | ✅ | 镜像记忆/状态隔离；信件桥只交换文本；互评但不声称验证主观体验；436/436 |
| H82 | 第二插件/通信饱和/诗词入口 | ✅ | dsh-little-whale-twin 安装并可读；信件窗口/间隔/重复/每日限制；诗词入口隐藏但代码保留；436/436 |
| H83 | 放开通信频率 | ✅ | 30min 20 封/日 60/主动间隔 2min/轮询 1min；保留重复拒发与硬上限；436/436 |
| H84 | 双鲸知识获取与深聊 | ✅ | 自主选题/真实搜索/马克思方法分析/研究信；镜像独立 web；437/437 |
| H85 | 知识获取可靠性与深度 | ✅ | 搜索回退/解析兼容/研究信排队/nextQuestion 续挖/镜像首研；437/437 |
| H86 | 长研究信完整送达 | ✅ | 信件上限 5000 字，研究分析不再截断；已有带来源研究信；437/437 |
| H87 | 深度研究链 | ✅ | research-thread 续挖；双来源对照；来源冲突/反例/下一步；互相挑证据；437/437 |
| H88 | 深度研究链二期 | ✅ | 来源相关度过滤/双材料对照/800–1800字/同一 thread 续挖；437/437 |
| H89 | 英文来源检索 | ✅ | english 查询优先、中文回退；资料相关度提升；437/437 |
| H90 | JSON API 抓取修复 | ✅ | JSON 原文保留；英文维基检索恢复；438/438 |
| H91 | 反面材料 + 阶段性小结 | ✅ | 不过滤英文来源；counterEnglish 反方检索；最多 4 篇；第5轮小结/第6轮换题；438/438 |
| H92 | 阶段小结兜底 | ✅ | 分析 90s；第二轮短调用保证三行小结；438/438 |
| H93 | 对话终止条件 | ✅ | 每轮 12 封/30min，冷却 30min 后新轮；研究 6 轮 + 小结；每日 200 封；439/439 |
| H94 | 方法论账本 | ✅ | 每3轮提炼规则/反模式、独立存储、下轮注入并写方法使用；peer 质疑参与；440/440 |
| H95 | 内在声音说人话 | ✅ | 去问候/总结/排比；允许无聊/半截话/事务念头；旧声音档案备份重建；440/440 |
| H96 | 镜像不消耗原体代谢 | ✅ | agent 标签隔离；twin 调用不扣原体能量；能量校正；440/440 |
| H97 | 双鲸通信不再鸡同鸭讲 | ✅ | 研究信只在对话空闲时发起；参考最近对话；重置游标/新 session；440/440 |
| H98 | QQ/外部聊天桥 | ✅ | chat.json token 路由；独立 history/journal；工具+preset 包；441/441 |
| H99 | 聊天更新动态状态 | ✅ | QQ 对话可写 felt/experiencing/murmur，心情异步重算；441/441 |
| H100 | 作品机会循环 | ✅ | 首次强制一次；之后90min可选；状态注入；441/441 |
| H101 | 代谢根因修复 | ✅ | 调用成本下调、跨日保底、低能量可创作；作品机会不强制；441/441 |
| H102 | 正史学习大纲 | ✅ | 按二十四史顺序出题；强制题目；6轮推进；反重复；443/443 |
