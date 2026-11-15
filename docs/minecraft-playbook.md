# Minecraft 建造 playbook（v0.6.5）

这份文档记录小鲸鱼建房时踩过的坑和可复用的方法；同时以 `method` 分类写进她的游戏记忆，下次建房会先读这些方法。

## 一、放置方块

- `bot.placeBlock(referenceBlock, faceVector)` 的参考必须是**相邻实体方块**，不能直接对空气放；
- 放置前要 `equip`，并 `lookAt` 目标/参考位置（社区补丁在 `_genericPlace` 前加 `await bot.lookAt(dest)`）；
- `placeBlock` 会等 `blockUpdate`（默认 5 秒）；幽灵方块会导致整轮超时，社区做法是缩短等待并自己复核；
- 用 `GoalPlaceBlock` 站到“能看见这个面”的位置，而不是简单走到目标附近；
- 放完必须**读回方块**（`bot.blockAt(pos).name === item.name`），不能以“调用没报错”判定成功。

参考：
- [mineflayer issue #3447：placeBlock 前 lookAt](https://github.com/PrismarineJS/mineflayer/issues/3447)
- [mineflayer issue #3471：blockUpdate 等待过长](https://github.com/PrismarineJS/mineflayer/issues/3471)
- [StackOverflow：placeBlock 需要 block 实例 + equip](https://stackoverflow.com/questions/55584006/programming-a-bot-to-place-a-block/55584100)
- [Mineflayer DeepWiki: Placing Blocks](https://deepwiki.com/PrismarineJS/mineflayer/9.2-placing-blocks)

## 二、采集材料

- 新区块加载前 `bot.blockAt` 会返回 `null`：先 `waitForChunksToLoad()`，再找方块；
- `findBlock` 的 `matching` 用方块 ID 数组比谓词更稳；
- 挖掉方块不等于进背包：要 `collectBlock.collect(block)`（或走到掉落物上）；
- 材料统计要覆盖所有变体（`jungle_planks` 等），不能只数 oak/birch；
- 没树时先探索 8 个方向（每次 ~24 格），不要原地死等。

## 三、选址与建造顺序

1. 找 3×3 平地，并确认上方 3 格都是空气；
2. 站到屋外/屋子中心（视墙面而定），不要站在目标方块里；
3. 顺序：地板 → 墙（留门）→ 屋顶；
4. 每块放完读回校验；成功率 < 60% 不算完成；
5. 失败时换参考面/换站位重试，而不是直接跳过。

## 四、可复用方法（写入 `method` 记忆）

- “放方块：先 lookAt → equip → place → 读回确认”
- “找不到树：先确认区块加载 → 探索 8 方向 → 材料统计覆盖所有木板”
- “建房顺序：地板→墙→屋顶，每块读回确认，成功率 ≥60% 才算完成”
