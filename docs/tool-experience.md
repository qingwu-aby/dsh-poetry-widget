# 通用工具经验（跨 Activity）

`lib/core/tool-experience.mjs` 把“情境 → 工具 → 成败”从 Minecraft 抽成通用层。

## Scope

- `activity:minecraft`
- `activity:reading`
- `activity:study`
- `activity:video`
- `global`（只放元策略，不放具体工具）

每个 scope 独立，避免游戏经验污染学习。

## 记录

```js
record({ scope, tool, context, ok, arguments })
```

contextKey 用布尔/数字特征稳定生成。

## 读取

```js
summary({ scope, context, limit })
```

返回成功率、尝试次数、最近参数；90 天未用衰减，单 scope 上下文上限 100。

## 接入

- Minecraft：World 回执；
- Workflow：非 Minecraft 步骤回执；
- 其他 Activity 可复用自己的 `contextProvider`。


## Activity 情境

`lib/core/tool-experience-service.mjs` 提供：

- reading：hasPath/hasPage/hasNote
- study：hasQuestion/hasQuery/hasNote/noSources
- video：hasUrl/hasPath/noSubtitle
- chat：hasPeer

Workflow 的非 Minecraft 步骤已经用这些特征记录到对应 `activity:*` scope。
