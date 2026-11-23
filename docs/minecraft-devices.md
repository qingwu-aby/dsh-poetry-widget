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
