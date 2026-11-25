# 为什么她的动作不连贯（2026-11-24 实测）

## 数据

最近 1 小时 Minecraft 事件（hub-events）：

- 决策 117 次、回执 120 次
- 工具分布：`mc_move_to` 34、`mc_mine` 21、`mc_find` 21、`mc_craft` 16、`mc_inquire` 6、`mc_collect` 6、`mc_wait` 4
- **回执 → 下一次决策的空档：中位数 20.3 秒，p90 38.1 秒**

也就是说：每个动作做完，她要站 20 秒左右才决定下一步。

## 原因

1. **一次决策只做一个动作**：`queue`（2–6 步连做）能力早就有了，但实际几乎不用（日志里 0 次）。
2. **空档 = 模型思考时间**：`deepseek-v4.1-flash` thinking 常开，单次 drive 调用 15–20 秒很常见。
3. **重复的定位开销**：`mc_find` 21 次 + `mc_move_to` 34 次，说明她每轮都在重新找目标，没有把“找到的坐标 → 走过去 → 挖”串成一步。
4. **误判卡住**：`mc_inquire` 6 次/小时，每次都会占掉一轮思考但不产出动作。

## 已做的调整

- prompt 里把 queue 从“可以加”改成“能确定两步以上就一起给”，并给出四组常用组合；
- 连续 6 步都是单动作时，提示“节奏会被想的时间拖慢，可以 2–3 步一起给”。

## 没解决的根本问题

单次模型延迟（15–20 秒）不会因为 prompt 变好而消失。  
如果 queue 用起来，理论上吞吐能到 2–3 倍；如果还是慢，只能换更快模型或砍 prompt。


## Minecraft 专用模型候选（2026-11-24）

Minecraft 的决策/计划只要快，不要求深思：

```text
1) deepseek-account/deepseek-flash, reasoningEffort=off  （关 thinking，首选）
2) dsh-opencode-go/deepseek-v4.1-flash, low            （兜底，带 thinking）
```

只作用于 `minecraft-world` 自己的调用（decide / plan / guide 总结），其他场景仍走全局策略。

实测：用 `deepseek-flash + off` 跑 `plan_build` 成功出计划，没有 UNSUPPORTED_REASONING_EFFORT。


## 她其实在挖，但不往下挖（2026-11-24 统计）

全部回执 7061 条，其中：

| 工具 | 次数 |
|---|---|
| mc_mine | 1757 |
| mc_move_to | 1642 |
| mc_find | 999 |
| mc_craft | 656 |
| mc_plan | 390 |

`mc_mine` 挖到的方块：

```text
dirt 911、oak_log 485、stone 227、grass_block 78、birch_log 41、cobblestone 1
```

结论：她不是不挖，是**只挖地表**——从没下过矿洞，也没挖到铁/煤。

## 两个根因

1. **没有“往下走”的打法**：她只会找脚下附近的方块，不会做台阶下矿；
2. **目标漂移**：`mc_find` 999 次 + `mc_move_to` 1642 次，每轮都在换目标（queue 依然 0 次）。

## 已加

- **采矿战术**（本地，不走 wiki）：台阶下矿、别垂直挖、几步一插火把、圆石够做石镐、铁矿在 y=16 以下；
- **目标锚**：连续 3 步同一工具 + 相似理由时提示「先把这件事做完再换目标」。

## 未解决

- 她仍然可能一次只做一个动作（queue=0）；
- 没有“矿洞入口”这种地标记忆。


## 关思考也走 dsh-opencode-go（2026-11-25）

实测三种组合（用 plan_build 触发真实调用）：

```text
dsh-opencode-go/deepseek-v4.1-flash + off → UNSUPPORTED_REASONING_EFFORT（该模型不支持关思考）
dsh-opencode-go/deepseek-v4-pro  + off → 成功（支持 off）
dsh-opencode-go/hy4-flash-free   + off → 成功
```

因此关思考的候选改成：

```text
1) dsh-opencode-go/deepseek-v4-pro, off, maxTokensFloor 1500
2) dsh-opencode-go/deepseek-v4.1-flash, low, maxTokensFloor 2200（兜底）
```

开思考仍然回落到全局策略（v4.1-flash low）。两条路都不再使用 deepseek-account。


## 统一模型（2026-11-25 晚）

放弃 deepseek-v4-pro/off 方案，Minecraft 与其他场景统一：

```text
dsh-opencode-go / deepseek-v4.1-flash (low)
maxTokensFloor 2200
```

原因：v4.1-flash 不支持 effort=off（实测 UNSUPPORTED_REASONING_EFFORT），
而 v4-pro 虽然支持 off，但没必要为游戏单独维护第二套模型。
设置页的“决策思考”开关暂时只表示“是否走全局策略”，两档实际是同一个模型。
