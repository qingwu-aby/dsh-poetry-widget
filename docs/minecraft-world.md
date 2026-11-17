# Minecraft World（v0.9.0）

P0–P2 把 Minecraft 从“action JSON 支线”改成 World：**事件 + 工具 + 回执**。

## P0 协议

`POST /api/dsh-poetry/game-world.json`（chat token）：

- `{"action":"observe","observation":{...}}`：bot 交观察；World 让模型选一个工具，返回
  `{"ok":true,"command":{"id","tool","arguments","reason"}}`
- `{"action":"receipt","receipt":{"tool","ok","detail","facts"}}`：bot 交可验证回执，World 写事件记忆；
- `{"action":"interrupt","reason":"..."}`：打断当前工具；bot 每 2.5 秒轮询 `GET /game-world.json?token=...`；
- `{"action":"permission","level":"control|observe|..."}`：切换权限。

工具：`mc_move_to`、`mc_mine`、`mc_place`、`mc_say`、`mc_follow`、`mc_learn`、`mc_build`、`mc_wait`。
回执 facts 只放服务器可验证的值（实际位置、方块名、背包变化、放置数）。

旧 `game-decide` 的 JSON 动作仍保留为降级：模型输出不是合法工具时，`mc_legacy` 执行旧动作。

## P1 文件记忆

`$DSH_HOME/.dsh-poetry/game-memory/`：

```text
PARTNER_GAME.md   # 每次进 prompt 的短画像
world.md
players.md
build/home.md
methods.md
todo.md
log/2026-11.md    # 绝对日期
archive/
```

- 每条 `record` 写对应文件并 **git commit**（`git init` 自动）；
- 原有 `game-memory.json` 自动迁移；
- `promptLines` 带短画像 + 分类摘要。

## P2 权限与状态

- 权限：`control`（可动手）/ `observe`（只看）/ `ask-once` / `never`；
- 状态：`GET /api/dsh-poetry/minecraft-control.json` 返回 `world.lastCommand/lastReceipt/permission`；
- 设置页 Minecraft 卡片显示她的位置、最近工具，并可切换权限。

## 打断与让位

- 聊天/GUI 消息打断游戏：chat-service 调 `world.interrupt('聊天打断')`，bot 中止当前工具；
- bot 的工具循环检查 abort，回执照实写“被打断”；
- 旧 `focus` 仍然保证她游戏时不并发聊天模型。

## World 事件（v0.9.1）

`POST /game-world.json {"action":"event","event":{"type":"spawn|death|chat","detail":"..."}}`

- bot 在出生、死亡、玩家说话时上报；
- death 写 `event` 分类，其余写 `session`；
- 与工具回执一起构成 World 的“可观察事实”。

## 权限

- `control`：直接控制；
- `observe`：只看，控制工具被替换成 `mc_wait`；
- `ask-once`：需要设置页「允许 30 分钟」；未授权时等同 `observe`；
- `never`：等同 `observe`。
- 记忆文件超过 80 行时，旧行自动归档到 `archive/<category>-YYYY-MM.md`（plan/build 除外）。

## 建造器（v0.9.4）

- 选址：3×3 平地 + 上方空气，扫描半径 16；
- 清场：挖掉 3×3×3 内占地方块；
- 材料：按背包存量选最多的一种（木板/泥土/圆石/沙），不足 30 块先就地挖地面补；
- 结构：3×3、两格高墙、留门、平屋顶；地板跳过玩家脚下；
- 放置：逐块 `placeBlock` + 读回方块校验，≥80% 才算完成；
- 建造阶段不做长距离寻路，避免 keepalive 超时；线上实测 24/25 块。

## 科学实践循环（v0.10.0）

她可以自己选择 `mc_inquire`，把最近失败、回执、方法记忆交给调研服务：

```json
{"action":"inquire","problem":"房子只放上一半"}
```

调研返回、并写入 `inquiry` 记忆：

```json
{
  "problem": "重新表述的问题",
  "cause": "她判断的原因",
  "hypothesis": "一个可验证的假设",
  "experiment": { "tool": "mc_place", "arguments": { "block": "dirt" } },
  "success": "怎样算验证成功",
  "next": "验证后下一步"
}
```

- 工具是**可选项**，World prompt 只陈列事实与工具，是否停下来调研由她判断；
- 调研结果进入 `method` / `plan` / `inquiry`，下一次决策会带上；
- 不强制固定“先观察再假设”的流程，基础设施只提供材料与回执。
