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
