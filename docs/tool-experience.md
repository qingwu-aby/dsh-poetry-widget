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


## Prompt 注入

- Minecraft：World prompt 显示工具成功率；
- Reading：手动阅读 prompt 显示 reading scope 经验；
- Study：自学 prompt 显示 study scope 经验；
- Video：摘要由 provider 产生，暂未注入（下一层）。


## Chat 与探索

- Chat prompt 注入 `activity:chat` 经验；
- 没有经验时提示“可以试不同做法”；
- 样本少于 3 次时提示“可以偶尔换工具”，避免过早固化。


## Video 摘要层

`video.summary` 支持可选的 `summarize` 整理函数：

- provider 给出原始摘要/字幕；
- 模型层按 `activity:video` 经验整理成 3–5 句摘要 + 主题；
- 整理失败时保留 provider 原文，不让任务失败。
