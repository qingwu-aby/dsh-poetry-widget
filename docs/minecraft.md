# 小鲸鱼玩 Minecraft（v0.6.0）

## 架构

```
26.1 离线服务器 127.0.0.1:25566（launchd 常驻）
  ├─ 小鲸鱼 bot：mineflayer 26.1，直连服务器
  │    └─ 每 ~22s：观察 → POST /api/dsh-poetry/game-decide.json → 她的模型返回 JSON 动作 → 执行
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
