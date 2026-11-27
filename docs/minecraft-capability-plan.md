# 小鲸鱼能力建设任务计划 v1

> 定位：自动化是**过程量**，不是结果量。本计划只建设“能力长出来的条件”，不把自动化写成目标。
> 决策已定：
> 1. 宏由她自己保存（不自动、不提醒）；能力解锁按累计次数，阈值 **8 次**；
> 2. 生存反射属于保命层，任务租约只负责“不间断执行”，不替她做选择；
> 3. 记忆分层：接受“记大概、忘细节”，L4 每晚重写；
> 4. 反射与租约只进台账，不进情景记忆，夜间汇总成一句；
> 5. “验证实验”类记录只保留失败的。

## 0. 总原则（写进所有任务的前置约束）

1. **自动化不进目标系统**：`game-project.json`、立项 prompt、复盘 prompt 里不出现“自动化/红石/机器”。
2. **能力靠重复长出来**：同类动作累计 8 次 → 新原语出现在她的工具里；不提醒、不引导。
3. **宏是她自己的**：只有她主动 `mc_macro save` 才存在；系统不问“要不要保存”。
4. **度量是仪表盘**：自动化率等指标只进 `mc_status`，不进 prompt。

## 1. 阶段与任务

### 阶段 A：让产出留得住（容器闭环）

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| A1 | 重写 `mc_store` / `mc_take`：按物品名/分类存取，返回箱子实际数量 | e2e：存 3 组铁→取回 1 组→数量正确 | — |
| A2 | `mc_use_container` 做扎实：打开箱子/熔炉/漏斗，列内容 | e2e：列出箱子内 5 种物品并带数量 | A1 |
| A3 | 背包容量管理：`mc_inventory` 报告占用/剩余，超 80% 时在**回执里**提示“背包快满了”（事实，不是命令） | e2e：塞满后回执含占用率 | — |
| A4 | 垃圾清理原语：`mc_drop`（指定物品/类别，限数量） | e2e：丢掉 32 个泥土，数量正确 | A3 |
| A5 | 箱子分类约定：`mc_store` 支持 `category=ore/food/tool/build`，按类别存 | e2e：矿进矿箱、食物进食物箱 | A1 |

### 阶段 B：让重复劳动可复用（宏）

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| B1 | 动作序列记录器：bot 侧记录最近 N 步（工具+参数+结果），滚动 200 步 | 单元测试：序列结构正确 | — |
| B2 | `mc_macro save name=…`：把最近一段成功序列存成命名宏（她主动调用） | e2e：存“挖矿-回箱-存”三步宏 | B1, A1 |
| B3 | `mc_macro run name=…`：重放宏，逐步执行，遇到失败即停并如实报告第几步失败 | e2e：重放成功；人为制造失败→报告步号 | B2 |
| B4 | `mc_macro list` / `mc_macro delete` | e2e：列表与删除 | B2 |
| B5 | 宏持久化到 `~/.dsh/.dsh-poetry/mc-macros.json`，重启存活 | 重启后 `list` 仍在 | B4 |

### 阶段 C：能力按 8 次解锁（过程量）

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| C1 | 计数器：按动作类别统计累计次数（挖矿/采集/种植/搬运/烧炼…），落盘 | 单元测试：计数与阈值判定 | — |
| C2 | 解锁表（8 次）：见 §2 | 单元测试：未达阈值不可见，达到即可见 | C1 |
| C3 | 解锁只影响“工具可见性”，不影响 prompt | 快照测试：prompt 不含解锁提示文案 | C1 |
| C4 | 新原语实现（按解锁顺序）：`mc_tunnel`（连续矿道）、`mc_farm_loop`（定点种收）、`mc_haul`（箱子间转运） | 各自 e2e 场景 | C2, A1 |

### 阶段 M：记忆优化（反射与租约的前置）

> 实测问题：`game-memory/todo.md` 288 KB、`world.md` 全是「出生点大约…（join）」重复、
> `game-memory.json` 302 条停在 11-17；重要事（死亡/第一次/里程碑）被噪声稀释。

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| M1 | 四层结构落盘：L1 台账（events.jsonl）/ L2 情景 / L3 程序 / L4 叙事 | 目录与 schema 测试通过 | — |
| M2 | 归属字段 `actor = self / reflex / lease`：所有写入必须带 | 单元测试：缺 actor 拒绝写入 | M1 |
| M3 | L1 永不进 prompt；L2 只收 salient（死亡/首次/里程碑/学到方法） | 快照：prompt 只含 L2≤3 条 + L4 一段 | M1, M2 |
| M4 | 去噪：同文本 24h 去重；join/出生点每天仅 1 条；验证实验仅保留失败 | 单元测试：注入 100 条重复→保留 1 条 | M1 |
| M5 | 淘汰：L2 按 显著度×新鲜度 保留 ≤300 条 | 单元测试：超出后淘汰低分 | M4 |
| M6 | L4 每晚重写（不追加）：合并 L1 摘要与 L2 高显著项 | 连续两晚：文件长度不增长 | M3 |
| M7 | 反射/租约夜间汇总一句进 L2（例："昨夜靠反射躲过 3 次僵尸"） | 测试：给定台账→生成一句摘要 | M2, M6 |
| M8 | 迁移历史噪声：现有 todo.md / world.md 清洗并归档，L4 从零重写 | 清洗后 todo.md < 20 KB | M1, M4 |

### 阶段 D：活下来（生存反射，L0）

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| D1 | 反射层开关：bot 侧独立循环（不占模型决策），默认开 | e2e：低血+怪物→自动后撤/格挡 | — |
| D2 | 自动进食：饿<14 且有熟食→吃；只有生食→先烧（有熔炉时） | e2e：饥饿恢复 | D1 |
| D3 | 夜间默认：22:00 后无床→回最近已验收小屋，回不去→就地封闭（如实报告） | e2e：夜间行为符合 | D1, A1 |
| D4 | 危险自动脱离：溺水/岩浆/坠落 | e2e：溺水场景自动上浮 | D1 |
| D5 | 反射不写进项目/不改目标 | 测试：反射触发后 project 无变化 | D1 |

### 阶段 E：长任务后台执行（任务租约）

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| E1 | `mc_task start`：把蓝图/循环交给后台执行，立即返回“已受理” | e2e：受理后 30 秒内持续推进 | D1 |
| E2 | 检查点回报：开工/缺料/威胁/完工 四类事件写回执 | e2e：缺料时准确上报缺什么 | E1 |
| E3 | 中断续做：死亡/重连后任务保留，可继续 | e2e：杀 bot→重启→继续施工 | E2 |
| E4 | 任务与项目分离：任务只是执行手段，不改项目里程碑 | 测试：任务完成后 project 未变 | E3 |

### 阶段 F：仪表盘（只读度量）

| ID | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| F1 | 自动化率、手工占比、无人值守产出三项计算 | 单元测试 | C1 |
| F2 | 进 `mc_status` 一行，不进 prompt | 快照测试 | F1 |
| F3 | e2e + 全量测试纳入 `npm test` / `e2e-regression.mjs` | 全部绿 | 所有 |

## 2. 解锁表（8 次）

| 累计动作类别 | 阈值 | 解锁原语 |
|---|---|---|
| 挖方块（mc_mine） | 64 | `mc_tunnel`（沿方向连续挖矿道，自动插火把） |
| 种植/收获（mc_till/mc_plant/mc_harvest） | 64 | `mc_farm_loop`（固定农田循环：收→种→浇） |
| 箱子存取（mc_store/mc_take） | 64 | `mc_haul`（箱子间批量转运） |
| 烧炼（mc_smelt） | 64 | `mc_smelt_batch`（批量烧炼，按产物分类） |
| 战斗（mc_attack/mc_defend） | 64 | `mc_guard`（守卫模式：守住据点入口） |

> 解锁只增加工具可见性；她可以永远不用。

## 3. 不做（非目标）

- 不生成“自动化”项目、不给“该自动化了”的提示。
- 不自动保存宏，不做“你已重复 3 次，要保存吗”的弹窗式打扰。
- 不做成就/等级 UI（能力等级只在 `mc_status` 里以数字出现）。
- 不为了自动化而自动化：任何原语都必须能在她的真实行为里自然被用到。

## 4. 度量（最终验收）

| 指标 | 目标 | 采集 |
|---|---|---|
| 连续存活时长 | > 6 小时无死亡 | 服务器日志 |
| 长任务完成率 | 5×5 小屋一次建成率 > 80% | 任务租约回执 |
| 手工动作占比 | 30 天后下降 > 40% | 计数器 |
| 资源净流入 | 每天入箱矿物/食物 > 0 | 箱子快照 |
| 无人值守产出 | 离开基地 10 分钟后仍有产出 | 定时快照 |
| 记忆信噪比 | L2 中 salient 占比 > 80% | M3/M4 统计 |
| prompt 记忆注入 | ≤ 3 条情景 + 1 段叙事（≤200 字） | 快照 |
| 叙事文件大小 | L4 每晚重写后稳定（不增长） | M6 检查 |

## 5. 执行顺序与节奏

```text
A（容器） → D（生存反射） → M（记忆优化） → E（任务租约） → B（宏） → C（解锁原语） → F（仪表盘）
```

理由：
- A 是所有产出的底座；
- D 保证不被死亡打断；
- **M 必须在 E 之前**：租约会批量产生回执，反射会持续产生动作，没有归属与 L2 筛选，记忆会被噪声淹没；
- B（宏）本质是 L3 程序记忆，依赖 M 的结构；
- C/F 最后。

每个阶段完成后：

```text
1. npm test + npm run check
2. node e2e-regression.mjs（含该阶段新增场景）
3. 重启 DSH、重启生存 bot
4. 更新 docs/minecraft-flow-status.md 与 CHANGELOG
```

## 6. 风险

| 风险 | 应对 |
|---|---|
| 反射层让她“变笨”（不再自己决策生存） | 反射只做保命动作，不替她做选择；触发时回执如实记录 |
| 宏变成我们的脚本 | 宏只能由她 `mc_macro save` 创建，代码里不存在预置宏 |
| 解锁原语破坏平衡（太强） | 每个原语都与手工效率相当，只省操作次数，不省资源 |
| 任务租约让她“失去控制” | 任何时刻可 `mc_task stop`；任务不改变项目 |
| 记忆压缩让她“忘了自己做过什么” | L4 每晚重写保留自我连续；L1 台账永不删除，可回溯 |
| 反射动作被误记成“她的决定” | 所有写入强制带 actor，reflex 不进 L2 |


## 7. v1 交付状态（2026-11-27）

本轮按“整体开工”执行，各阶段 v1 骨架已落地：

| 阶段 | 状态 | 已实现 | 待补 |
|---|---|---|---|
| A 容器 | ✅ v1 | `mc_store`/`mc_take` 按物品/分类批量存取；`mc_inventory` 报占用率（≥80% 提示快满）；`mc_drop` 丢物品/杂物；`mc_use_container` 列内容 | 箱子分类自动路由（按类别找对应箱） |
| D 反射 | ✅ v1 | 独立 3 秒循环：低血+贴脸怪自动后撤、饿<14 自动吃熟食、水/岩浆自动上浮 | 夜间归巢、格挡、坠落 |
| M 记忆 | ✅ v1 | 四层模块 `minecraft-memory-v2.mjs`（台账/情景/程序/叙事）+ 归属 actor + 去噪 + 300 条淘汰 + 叙事重写 + 台账汇总；已接入 world 的 prompt/receipt/event/status | L4 每晚定时重写、程序记忆与宏打通 |
| E 租约 | ✅ v1 | `mc_task start/stop/status`，后台 1.2 秒推进、失败/完成回报事件 | 缺料检查点、死亡续做 |
| B 宏 | ✅ v1 | 动作环缓存、`mc_macro save/run/list/delete`、持久化 `mc-macros.json` | 失败步号回报已有；跨会话验证 |
| C 解锁 | ✅ v1（计数） | 计数器落盘（mine/farm/haul/smelt/fight），8 次解锁清单进观测 `capability` | 解锁原语实现（tunnel/farm_loop/haul/smelt_batch/guard）、按解锁隐藏工具 |
| F 仪表盘 | ✅ v1 | `mc_status` 追加记忆统计；观测含 capability/ores | 自动化率、手工占比、无人值守产出 |

### 记忆噪声清理

```text
game-memory/world.md          71 行 → 0（全是“出生点大致”噪声，已备份）
game-memory/PARTNER_GAME.md   785 → 353 行
game-memory/todo.md           1443 → 151 行（288 KB → 28 KB，备份 todo.md.bak-11271035）
```

### 验证

```text
npm test        1129 tests / 1129 pass
npm run check   通过（含体量、依赖、catch 规范）
e2e-regression  11/11 通过（新增 mine_opportunistic）
```


## 8. v2 补齐（2026-11-27 下午）

v1 的待办全部补齐：

| 待办 | 状态 | 实现 |
|---|---|---|
| C：解锁原语 | ✅ | `mc_tunnel`（矿道+火把+顺路收矿）、`mc_farm_loop`（收→种）、`mc_haul`（箱子间转运）、`mc_smelt_batch`（批量烧炼）、`mc_guard`（守卫） |
| C：按解锁隐藏 | ✅ | 未达 8 次的 5 个原语**不出现在她的工具列表里**（prompt 门控，不是命令行拒绝） |
| E：缺料检查点 | ✅ | 租约步骤失败且原因含“没有/缺/不够/需要” → 标记 `blocked` 并上报“缺材料”，不再无效重试 |
| E：死亡续做 | ✅ | 租约落盘 `mc-lease.json`；重生时若 10 分钟内有未完成租约 → 自动续做并提示“（续做）” |
| M：叙事每晚重写 | ✅ | 插件启动 + 每 6 小时 `rewriteNarrative`（合并项目标题、反射与租约台账摘要），**重写不追加** |
| F：过程量指标 | ✅ | 自动化动作/手工动作分开计数 → `automationRate`、`manualShare`、`unattended`；进 `mc_status`「过程量：自动化率 X%、手工占比 Y%」 |

### 工具上限调整

能力原语增加后工具数 63 → 68，超过 manifest 的 `toolsMax: 64`，已调整为 **80**（`lib/core/activity-manifest.mjs`）。
快照 `MINECRAFT_TOOLS_SNAPSHOT` 由 tools 模块自动重建，顺序与 `MINECRAFT_TOOLS` 保持一致。

### 验证

```text
npm test        1129 / 1129 通过
npm run check   通过
e2e-regression  14 / 14 通过（新增 primitives / haul_roundtrip / smelt_roundtrip）
```

新增 e2e 覆盖：

```text
✓ primitives        mc_farm_loop:✓ mc_guard:✓ mc_tunnel:✓
✓ haul_roundtrip    搬了 8 个 ore：coal_ore×8
✓ smelt_roundtrip   烧出了 2 个 raw_iron 的产物
```


## 9. 设计来源：.schem 蓝图导入（2026-11-27 傍晚）

用户要求：解开门控 + 让她能“学习并沉淀”网上的建筑（sereyka / minecraft.pl / mineschematic）。

### 门控解开

```text
UNLOCK_AT：64 → 8
（同类动作成功 8 次就解锁对应原语；她一小时就能达到）
```

### 蓝图库（新能力）

```text
lib/domain/play/minecraft-schematic.mjs   .schem 解析（Sponge v1/v2/v3 + root.Schematic 包装 + Blocks 子复合）
scripts/import-schematic.mjs              下载/读取 .schem → 蓝图 JSON（含尺寸、材料清单）
~/.dsh/.dsh-poetry/blueprints/*.json      蓝图库
mc_build action=list                      她能查“我会盖哪些建筑”
mc_build from=<名字>                      按蓝图施工（分批、断点续建、地基悬空检查）
```

已导入的蓝图（来自 minecraft.pl 的真实建筑）：

```text
starter-house      12× 8×12    362 块   新手小屋
sredni-dom         12× 9×12    418 块   中型住宅
kamienny-zamek     19×14×19   1282 块   石堡
obronna-wieza      12×51×12   1287 块   防御塔（51 格高）
jiuguan            37×49×33   9007 块   酒馆（复式大建筑）
zhenshitang        48×33×28   5820 块   市政厅
yuanshi-nongchang  11×26×12    959 块   刷石机（红石机械）
```

### 施工健壮性

```text
· 蓝图 y=0 锚到「脚下第一块实地」，不再悬空
· 四角地基检查：角上悬空就拒建并说明原因
· 动工前自动站到图外（避免方块放进自己身体导致 place_failed）
· 同蓝图未完工时接着上次进度，不重置
```

e2e 实测（创意服，分批 12 块/次）：

```text
✓ blueprint_build   蓝图施工进度 12 → 24 → 36
```

全量回归 **16/16 通过**，单测 **1132 通过**。


## 10. 真实 .litematic 导入 + 材料缺口报告（2026-11-27 傍晚）

用户提供 `/Users/yangyuan/Desktop/DAWN VINERY.litematic`，直接导入成功：

```text
dawn-vinery   80×38×73   17249 块
主材：dark_oak_planks×2851、stripped_spruce_log×1339、tuff×1109、spruce_stairs×930、
     calcite×807、spruce_trapdoor×761、spruce_planks×736、stone×642
```

### 新增能力

```text
· .litematic 解析（Regions/BlockStates 位打包解包、多区域合并、负 Size 方向）
· scripts/import-schematic.mjs --dir <目录>   批量导入
· mc_build action=list            列出全部蓝图 + 尺寸 + 主材
· mc_build from=<名字>            动手前报「还缺材料：dark_oak_planks 缺 2819…」
```

实测回执：

```text
BP-LIST  可盖的蓝图：dawn-vinery（80×38×73，17249 块；主材 dark_oak_planks×2851…）…
BP-BUILD 本轮放了 0 块，进度 0/17249（missing_item×1）；
         还缺材料：dark_oak_planks 缺 2819、stripped_spruce_log 缺 1323、tuff 缺 1101、spruce_stairs 缺 930
```

### 自动下载的可行性（实测）

| 站点 | 结果 |
|---|---|
| minecraft.pl | ✅ 直链 `.schem`，已导入 7 张 |
| sereyka.com | ❌ 需登录/付费，探测 4 个下载端点均 404 |
| mineschematic.com | ❌ 需要 CAPTCHA（接口返回 `CAPTCHA verification required`） |
| planetminecraft.com | ❌ Cloudflare 403 + 登录墙 |

结论：**自动下载只对 minecraft.pl 可行**；其它站点需要手动下载到本地，再用 `--dir` 批量导入。

### 规模提示

17k 块按每次 24 块 → 约 700 次施工调用；材料缺口按千计。
所以“漂亮大建筑”的真正瓶颈不是施工接口，而是**材料供应与物流**（产业阶段）。


## 11. 蓝图库与索引（2026-11-27 晚）

用户提供了多个蓝图文件，并希望“她自己去选怎么盖”，卡住时还可以反向求助宿主找蓝图。

### 蓝图库（11 张）

```text
house       starter-house 362 / sredni-dom 418 / kamienny-zamek 1282
tower       obronna-wieza 1287
farm        free-starter-house 3554
redstone    yuanshi-nongchang 959
mega        zhenshitang 5820 / jiuguan 9007 / dawn-vinery 17249
            master-estate-stablemaster 45938 / roswaal-house 182081
```

来源记在 `blueprints/sources.json`：
minecraft.pl（7 张自动下载）+ 用户提供（DAWN VINERY / FREE Starter House / Desktop/mc 两张）。

### 索引

```text
scripts/build-blueprint-index.mjs
→ blueprints/index.json（机器读，mc_build action=list 用）
→ blueprints/INDEX.md（人读：类别/尺寸/方块数/主材/来源 + 她提的需求）
```

分类自动推断：redstone（红石元件占比）、transport（铁轨）、farm（作物占比）、
tower（高宽比 ≥2）、mega（≥3000 块）、house（其余）。

### 她可以反向求助

```text
mc_build action=request category=红石 need=一个自动甘蔗农场
→ 写入 blueprints/requests.jsonl + 上报事件
→ 宿主用 scripts/blueprint-requests.mjs 查看
→ 用户找到对应 .schem/.litematic 丢进目录，再 --dir 导入
```

### 她可以自己查“怎么盖”

新增 `minecraft-building-knowledge.mjs`（接在建造类问题的第一优先级）：

```text
「照着蓝图盖」  → 备料 → 定基 → 分层 → 封顶 → 收尾，够不到就垫脚手架
「材料不够」    → 按主材分组，木头连片砍、石用 mc_tunnel、玻璃/砖用 mc_smelt_batch
「放不上去」    → 站到 4 格内、脚下垫实心、别站在要放的位置上
```

### 自动下载的边界（实测）

```text
minecraft.pl     ✅ 直链 .schem
sereyka.com      ❌ 需登录/付费（4 个下载端点全 404）
mineschematic.com ❌ 接口要求 CAPTCHA（"CAPTCHA verification required"）
planetminecraft   ❌ Cloudflare 403 + 登录墙
```

所以：**自动下载只对 minecraft.pl 可行**；其余靠用户手动下载 + `--dir` 批量导入。

### 规模现实

```text
roswaal-house 182081 块 ÷ 24 块/次 ≈ 7587 次施工调用
材料按十万计 —— 这是「产业 + 物流」阶段的目标，不是现在
```
