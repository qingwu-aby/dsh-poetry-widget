# 小鲸鱼玩 Minecraft（v0.6.0）

## 架构

```
26.1 离线服务器 127.0.0.1:25566（launchd 常驻）
  ├─ 小鲸鱼 bot：mineflayer 26.1，直连服务器
  │    └─ 每 ~4s：观察 → POST /api/dsh-poetry/game-world.json → 她的模型返回 JSON 动作 → 执行（`MC_BRAIN_INTERVAL_MS` 可调，默认 4000）
  └─ ViaProxy 127.0.0.1:25568（launchd 常驻）：把 26.3 客户端翻译进 26.1 服务器
```

## 决策协议

请求：`{"token":"…","observation":{"position":"x,y,z","health":20,"food":18,"timeOfDay":"白天","players":["Yuan_JY"],"nearbyBlocks":["oak_log"],"inventory":["bread×2"],"lastChat":"…"}}`

响应：`{"ok":true,"action":{"action":"idle|chat|look|jump|move|follow|eat", ...}}`

动作白名单：
- `idle` / `jump` / `eat`
- `chat`：`say`
- `look`：`yaw`（0–360）、`pitch`（-80–80）
- `move`：`direction`（forward/back/left/right）、`seconds`（1–3）
- `follow`：`player`（必须在附近玩家列表）

模型输出不是合法 JSON / 不在白名单 → 自动回退 `idle`；不写 journal、不进聊天历史。

## 启动/日志

- 服务：`com.yangyuan.whale.minecraft-server` / `-proxy` / `-bot`（launchd，KeepAlive）
- 日志：`~/Library/Logs/whale-minecraft-{server,proxy,bot}.log`
- 世界：`~/dsh-workspace/minecraft-bot/server261/world`
- 玩家连入（26.3）：`localhost:25568`（ViaProxy → 26.1）

## 游戏记忆（v0.6.1）

独立文件：`$DSH_HOME/.dsh-poetry/game-memory.json`，与 chat journal / learning / memory-layers **物理隔离**。

固定五类，互不混用：

| 分类 | 内容 | 用途 |
|---|---|---|
| `world` | 世界/服务器设定（端口、出生点） | 进游戏时知道在哪 |
| `player` | 一起玩的人、称呼、偏好 | 认人、不叫错 |
| `session` | 一次游玩的经过 | 记得上次一起做了什么 |
| `event` | 值得记住的瞬间（第一次见面、死亡、送东西） | 具体回忆 |
| `plan` | 她在游戏里想做的事 | 下一步目标 |
| `build` | 建造项目：选址、材料、进度 | 持续建房 |
| `method` | 可复用方法（放置/采集/选址/校验） | 下次遇到同类问题直接复用 |

- 只在 `game-decide` 的 prompt 里以「你记得的：…」出现，**不会进入普通聊天/日记/学习记忆**；
- 每类有上限（world 40 / player 80 / session 120 / event 200 / plan 40），同分类去重；
- bot 在出生、玩家说话、她说话、跟随玩家时自动 `POST /game-memory.json`。

## 一键开关

设置页「Minecraft」卡片：

- **一键启动 / 停止**：启动服务器 + 代理 + 她；
- **后台启动**：开 = launchd 常驻（关 DSH 也继续）；关 = 仅当前 DSH 进程内运行；
- **刷新状态**：显示服务器/代理端口与她的位置。

接口：`GET/POST /api/dsh-poetry/minecraft-control.json`（GET 状态；POST `{action:'start'|'stop', background:boolean}`）。

## 单一注意力（v0.7.0）

- 状态文件：`$DSH_HOME/.dsh-poetry/focus.json`，`focus=idle|chat|game|build`；
- bot 出生/每次决策向 `/api/dsh-poetry/game-focus.json` 报 `active=true`，2 分钟无刷新自动过期；
- 游戏/建造进行中，GUI 聊天**不再并行调用聊天模型**：返回一句「我在游戏里，手上正忙着，等会儿回你。」并把消息放进 `deferred` 队列；
- 这样她同一时刻只有一个专注，不会“聊天一个她、游戏一个她”。
