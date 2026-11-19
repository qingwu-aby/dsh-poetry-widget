# Minecraft 洞窟脱困与 DeepSeek 账号模型

## 1. 卡洞窟自救

Bot 侧（`~/dsh-workspace/minecraft-bot/bot-play.mjs`）：

- `observation()` 记录最近 4 次位置；若连续 4 次四舍五入位置相同，标记 `stuck: true`、`stuckForMs`；
- 观察里带 `stuck`；卡住时 bot 会先自动执行一次 `mc_inquire`（10 分钟冷却），再让模型行动。

World 侧（`lib/domain/play/minecraft-world.mjs`）：

- `buildWorldPrompt` 在 `stuck` 时明确提示：
  > 不要重复刚才失败的动作；先用 `mc_inquire` 查脱困方法，或用 `mc_learn` 学习，再尝试 `mc_mine` 向上/向前挖、`mc_place` 垫脚或 `mc_move_to` 找出口，并把有效方法记下来。
- 这是“让她自己查/学”，不写死固定脱困路线；她可以用现有工具组合尝试。

## 2. DeepSeek 账号模型

DeepSeek 官方 Chat Completions API（参考官方文档）：

- `POST https://api.deepseek.com/chat/completions`
- Header：`Authorization: Bearer <DEEPSEEK_API_KEY>`、`Content-Type: application/json`
- Body：`{"model":"deepseek-flash","messages":[...],"stream":false,...}`
- 官方当前模型 ID：`deepseek-flash`、`deepseek-v4-pro`
- 文档：https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/

本插件不新增直连 fetch；DSH 宿主已内置 `deepseek-account` provider（OAuth 账号凭据，`~/.dsh/.credentials.yaml` 中的 `deepseek-account-platform/default`），直接复用即可。

已通过模型策略 API 切换；DeepSeek flash 常开 thinking，插件为 store 显式选择附加 **maxTokensFloor=4096**，避免低预算角色（selfTalk/mood/consolidate）以及 `maxTokens=0` 的“不封顶”调用被 thinking 吃光返回空文本。



```json
// ~/.dsh/.dsh-poetry/model-policy.json
{"provider":"deepseek-account","model":"deepseek-flash","roles":{},"tokenLimit":0}
```

效果：所有角色默认走 `deepseek-account / deepseek-flash`；仍可在设置页/API 按角色覆盖。

## 3. 验证

- `GET /api/dsh-poetry/model-policy.json` 的 `effective` 显示 `source: store`；
- `game-world` observe 返回正常决策（实测 1.66s）；
- 重启 DSH 后 World 的 stuck 提示才会加载（宿主需重启）。


## 4. 学习/调研的模型角色

DeepSeek 账号下 `thinking` 角色在实测中返回空响应；`game-learning` 与 `minecraft-inquiry` 已改用 `drive` 角色（同一模型，已验证 world 决策可用），保证脱困调研能真正调用模型。

## 5. 官方 API 直连示例（备用）

如果以后要绕过 DSH provider 直连官方 API，可用 `fetch`：

```js
const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '你好' }],
    stream: false,
  }),
})
const data = await res.json()
console.log(data.choices?.[0]?.message?.content)
```

注意：
- 官方模型 ID 当前是 `deepseek-flash` / `deepseek-v4-pro`；
- DSH 的 `deepseek-account` provider 使用账号 OAuth 凭据，不需要 `DEEPSEEK_API_KEY`，优先用它；
- 直连需要单独管理 API key，不要把 key 写进日志/记忆。

参考：[DeepSeek Chat Completions API](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)


## 6. Live 验证（2026-11-19）

- `game-learn`「Minecraft 洞窟脱困方法」：成功 5.7s，sourceCount=4，返回火把标记/阶梯/沿水流找出口。
- `game-world inquire`「洞窟找不到出口」：成功，返回原因/假设/实验/下一步。
- 模型策略：deepseek-account/deepseek-flash，drive 角色正常。
- 未出现新的 EMPTY_RESPONSE（旧记录来自修复前）。


## 7. OpenCode Go 限额后的降级

模型策略现在对**显式覆盖**（设置页/store/env）自动追加默认账号兜底：

```text
主候选（如 dsh-opencode-go / deepseek-v4.1-flash）
→ deepseek-account / deepseek-flash
```

- 主候选额度用完/空响应/生成失败且未产出文本时，`callModelForRole` 会继续尝试兜底；
- 兜底候选带 `maxTokensFloor=4096`，避免 DeepSeek thinking 空响应；
- 如果主候选本身就是 `deepseek-account`，不会重复追加。
