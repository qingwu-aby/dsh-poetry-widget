# 红石/防御/交通装置验收清单

前置：P1–P4 原语已进工具表；用 `mc_place.at` 精确放，用 `mc_inspect` 复核 `properties`。

## 自动门

材料：门、压力板（或拉杆）、红石粉（可选）。

1. `mc_place block=oak_door at=x,y,z facing=...`
2. 两侧地面 `mc_place block=stone_pressure_plate at=...`
3. `mc_activate target=oak_door` 验证开关
4. `mc_inspect target=oak_door` 看 `open` 属性

## 自动照明

材料：日光传感器、红石灯（或红石火把+灯）。

1. 屋顶 `mc_place block=daylight_detector at=...`
2. 相邻 `mc_place block=redstone_lamp at=...`
3. 夜晚/遮光后 `mc_inspect target=redstone_lamp` 看 `lit`

## 观察者+活塞+漏斗小农场

材料：观察者、活塞、漏斗、箱子、水桶、种子。

1. 作物前放观察者，输出朝活塞
2. 活塞朝作物
3. 活塞下方漏斗接箱子
4. `mc_plant` 种、`mc_bonemeal` 催
5. `mc_inspect` 看 observer `powered`、piston `extended`

## 刷怪塔（后期）

- 先有石/铁工具、火把、水桶、漏斗、箱子；
- 黑暗房间 + 水流集中 + 漏斗收集；
- 用 `mc_shoot`/`mc_attack` 清怪，`mc_take` 取物。

## 验收原则

每台装置必须留下：

- 坐标
- 放置后面向/通电状态
- 触发前后 `mc_inspect` 差异
- 失败原因（缺材料/朝向错/无支撑）

否则只能算“摆过”，不算“验证过”。


## 已实测

2026-11-23：

- `verify_inspect` workflow → `mc_inspect(target=grass_block)` 经任务队列由 bot 执行；
- 回执：`block=grass_block`，`properties={snowy:false}`，`ok=true`；
- queue `claimed=1, completed=1`；
- 同时修复 host 任务被自主循环饿死的问题：`hostTaskQueued` 在每轮决策前优先执行。


## 存储实测

2026-11-23：

```text
mc_craft oak_planks
→ mc_craft crafting_table
→ mc_place crafting_table
→ mc_craft chest
→ mc_place chest
→ mc_store dirt ×1
→ mc_take dirt ×1
```

全部经 workflow→queue→bot 执行成功；receipts 中有：

```text
合成了 chest×1
放了 chest 到 4 64 34
存入 dirt×1
取出 dirt×1
```

结论：`mc_store` / `mc_take` 的容器闭环已真实可用。


## 放置时序（实测）

先 `mc_equip` 再 `mc_place` 的 workflow 已真实通过：

```text
mc_craft crafting_table
→ mc_equip crafting_table
→ mc_place crafting_table  成功
→ mc_inspect crafting_table 成功
```

所以遇到 `must be holding an item to place` 时，先显式 `mc_equip`，不要把装备和放置压在同一步里赌时序。


## 独立创造验证世界

已建 `minecraft-bot/verify-server`：

- 独立端口 `25567`，RCON `25576`
- 创造模式、和平、超平坦
- 不碰当前生存世界

2026-11-23 验证结果：

```text
inspect / equip / place / activate / inspect / place / inspect
/ place / store / take
```

`VERIFY DONE 12/12`，覆盖：

- `mc_inspect` 方块属性
- `mc_equip` + `mc_place`
- `mc_activate` 拉杆
- `mc_store` / `mc_take` 箱子
- `mc_place` 定向分支（observer 使用定向路径）

注意：重复运行会在同一片区域留下旧方块，`findBlock` 可能找到旧目标；正式验收应在**干净世界/唯一坐标**下做。


## 干净创造世界复验（2026-11-23）

重置 `verify-world` 后跑 12 项：

```text
inspect / equip / place / inspect / place lever / activate / inspect
/ place observer / inspect / place chest / store / take
```

结果：`11/12`。

- `mc_store` / `mc_take` 仍成功；
- 拉杆 `powered: false → true`；
- `mc_equip` 因 RCON 给物品晚于验证启动而失败一次（时序问题，不是工具失效）；
- observer 请求 `facing=north`，实际 `facing=down`：超平坦地面没有侧向支撑，定向放置需要先放一面墙/支撑方块。

结论：定向放置需要真实支撑面；装置验收必须先搭支撑，再放红石元件。


## 支撑面复验（2026-11-23）

在干净创造世界的空地先放支撑方块，再放 observer：

```text
place_support → place_observer (facing=north) → inspect
```

结果 `13/13`，observer 实际属性：

```json
{"powered": false, "facing": "east"}
```

结论：即使改用 `_placeBlockWithOptions(forceLook:'ignore')` 保留 yaw，observer 仍读回 `facing=east`；mineflayer 高层放置无法稳定控制精确朝向。装置搭建需要：

- 用 `mc_inspect` 读回实际 `facing`；
- 必要时旋转/重放，直到朝向正确；
- 不能只信“请求了 facing=north”。

这属于验证结果，不是静默失败。


## P3 战斗验收（独立创造世界）

2026-11-23：

```text
mc_block → 举盾格挡 0.6 秒
mc_shoot → 向 zombie 射击
mc_throw → 附近没有可投掷目标（目标已被射杀）
```

`VERIFY DONE 15/16`。  
`mc_shoot` / `mc_block` 已真实执行；`mc_throw` 需要单独补一个存活目标再测。


## P3/P4 复验（2026-11-23）

独立创造世界：

```text
mc_block  OK 举盾
mc_throw  OK 投掷 snowball
mc_shoot  OK 向 zombie 射击
```

P4：

```text
mc_boat FAIL Failed to place entity
（protodef 序列化 block_place location 时 reading 'x'）
```

结论：

- P3 近战/远程/投掷已真实执行；
- `mc_boat` 的 mineflayer 放置实体协议仍有兼容问题，需要单独修；
- 旧方块/水导致 observer 支撑测试再次互相干扰，干净世界需唯一坐标和分区域。


## 船聚焦复验（2026-11-23）

独立创造世界，水方块已放置：

```text
mc_boat → 船没有出现
mc_ride → 附近没有可骑乘目标
```

尝试过：

- `bot.placeEntity` → protodef block_place 序列化错误
- `bot.activateItem` 看向水面 → 船实体未出现

结论：当前 mineflayer/服务端版本下 `mc_boat` 不可用；需要查实体放置协议或改为其他交通原语。


## 矿车骑乘验收（2026-11-23）

独立创造世界召唤 minecart：

```text
mc_ride(target=minecart) → RIDE OK 骑上 minecart
```

结论：`mc_ride` 对已存在的载具可用；`mc_boat` 的“生成载具”仍受 mineflayer 放置协议限制。  
P4 交通至少已有矿车骑乘闭环。


## 隔离验证平台（2026-11-23）

超平坦世界出生点附近有水域，旧方块/水会污染测试。改为：

```text
fill 95 99 95 110 99 110 stone
tp XiaoJingyu 100 100 100
```

再在 `x=102..109, y=100` 放测试装置，结果：

```text
place_table / lever / activate / store / take 全部通过
observer 请求 facing=north，实际 facing=east
```

结论：隔离平台解决了“目标位置不是空气/水”的污染问题；observer 精确朝向仍未解决。


## 石台 P3/P4 验收（2026-11-23）

清空石台上方空气后：

```text
block OK / throw OK / shoot OK
ride OK 骑上 minecart
place_table 被服务端拒绝（仍为空气）
boat 缺船物品
```

`VERIFY DONE 15/18`。  
P3 三项与矿车骑乘已真实通过；table 失败是服务端放置面/位置问题，boat 未给物品。


## 精确放置重试（2026-11-23）

`mc_place at` 加入 3 次重试 + 放置后读回：

```text
PLACE OK 放了 crafting_table 到 102 100 100
INSPECT OK 查看 crafting_table
```

修复了之前：

```text
Server refused to place ... the block is still air
```

现在不再把服务端延迟误判为失败。


## 红石回路验收（2026-11-23）

石台测试：

```text
place_lever OK 102 100 100
place_lamp FAIL Server refused ... still air
inspect_before air
activate lever OK
inspect_after air
```

结论：拉杆放置/激活正常；`redstone_lamp` 精确放置被服务端拒绝，红石回路还未成立。需要查 lamp 放置面/服务端放置限制，不能把 lever 成功当成装置成功。


## 红石灯聚焦复验（2026-11-23）

把 lever/lamp 移到新坐标（104/105）后：

```text
place_lever OK
place_lamp FAIL Server refused ... (105,100,100): block is still air
```

不是坐标被占，也不是 lever 邻接；`redstone_lamp` 在石台上仍无法由 bot 放置。  
下一步需要单独查该物品的放置包/服务端限制，不能把 lever 成功当成红石装置成功。


## 红石回路通过（2026-11-23）

石台上：

```text
place_lamp (generic) OK 101,100,100
place_lever (at) OK 102,100,100
inspect_before → lit:false
activate lever
inspect_after → lit:true
```

结论：lever → redstone_lamp 的最小红石回路真实成立。  
关键：`redstone_lamp` 用普通 `mc_place` 能放，但 `mc_place at` 的精确路径仍可能被服务端拒绝；装置搭建优先用普通 place + inspect 读回坐标。


## 自动门通过（2026-11-23）

石台测试：

```text
place_door OK 101,100,100
place_lever OK 102,100,100
inspect_before → open:false, powered:false
activate lever
inspect_after → open:true, powered:true
```

`lever → oak_door` 自动门回路真实成立。  
门朝向读回为 east，但开关逻辑正常。


## P2 农业工具验收（2026-11-23）

石台种下成熟小麦 + 堆肥桶：

```text
mc_bonemeal OK 用了骨粉催熟 wheat
mc_compost  OK 把 dirt 放进了堆肥桶
mc_plant    FAIL 种植位置被占用（已有小麦）
mc_harvest  FAIL 收割失败：寻路超时
```

结论：`bonemeal` / `compost` 已真实执行；`plant` 的失败是测试场景占用，`harvest` 是寻路到边缘作物超时，需要单独复验。


## P2 农业闭环通过（2026-11-23）

石台集中测试：

```text
mc_plant    OK 种下了 wheat_seeds
mc_bonemeal OK 用了骨粉催熟 wheat
mc_harvest  OK 收割了 wheat
mc_compost  OK 把 dirt 放进堆肥桶
```

`mc_harvest` 改为 4.5 格内直接 `bot.dig`，不再依赖寻路到边缘作物。  
P2 农业闭环（种→催→收→堆肥）已真实成立。


## 活塞执行器通过（2026-11-23）

石台测试：

```text
place_piston OK 101,100,100 facing:up extended:false
place_lever OK 102,100,100
activate lever
inspect_after → facing:up extended:true
```

`lever → piston` 红石执行器真实成立。  
P1 现在有：拉杆、红石灯、自动门、活塞。


## P2 动物闭环通过（2026-11-23）

石台召唤 cow/sheep，给予小麦/剪刀/桶：

```text
mc_feed_animal OK 喂了 cow
mc_shear       OK 剪了羊毛
mc_milk        OK 挤了牛奶
```

P2 动物工具 3/3 真实通过。


## 服务器夹具验收（2026-11-23）

用 RCON 构造装置几何，bot 只做操作 + 读回：

```text
setblock observer[facing=north]
setblock redstone_lamp + lever
summon minecart

FIXTURE inspect_observer OK → facing:north
FIXTURE inspect_piston   OK → facing:up, extended:false
FIXTURE inspect_lamp_before OK → lit:false
FIXTURE activate lever OK
FIXTURE inspect_lamp_after  OK → lit:true
FIXTURE ride minecart OK
```

6/6。  
这条路线把“bot 放置协议不稳定”与“原语操作能力验证”解耦：装置几何由服务端夹具负责，bot 只验证开关、读回、骑乘。


## 多装置夹具 6/6（2026-11-23）

RCON 一次构造三套装置，bot 用 `mc_activate at` 精确操作：

```text
lever(102) → lamp(101)      lit:true
lever(105) → piston(104)    extended:true
lever(108) → oak_door(107)  open:true, powered:true
```

`mc_activate` 新增 `at` 精确坐标，解决了多个同名拉杆无法区分的问题。  
P1 红石装置（灯/活塞/门）在夹具下全部成立。


## 精确放置失败回退（2026-11-23）

`mc_place at` 精确路径被服务端拒绝时，自动尝试附近位置：

```text
精确放置失败，改试附近位置：...
OBSERVER support OK 放了 dirt 到 101 100 100
OBSERVER observer OK 放了 observer 到 99 100 100
```

结果：原语不再直接失败，但**实际坐标会变**，调用方必须使用回执里的 `facts.at`，不能假设还是请求的 `at`。
