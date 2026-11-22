# Phase 3A：跨 Activity 工作流定义与预算

## 已实现

- 工作流 schema：名称、触发器、步骤、预算；
- 预算：
  - `maxSteps`：最多步骤
  - `maxTokens`：累计 token 上限
  - `maxDurationMs`：单轮最长执行
  - `maxRuns`：累计执行次数
- 状态：`runs / tokensUsed / totalDurationMs / lastStatus / lastError`；
- 持久化：`~/.dsh/.dsh-poetry/workflows.json`（0600）；
- API：`/api/dsh-poetry/workflows.json`；
- 只做定义/校验/预算账本，**不执行步骤**。

## API

```http
GET /api/dsh-poetry/workflows.json?token=...
```

返回 `{total, workflows:[{...budget, remainingRuns}]}`。

```http
PUT /api/dsh-poetry/workflows.json
{
  "token": "...",
  "name": "study_then_mine",
  "trigger": {"type":"interval","everyMs":60000},
  "steps": [
    {"activity":"study","tool":"study.ask","arguments":{"question":"怎么找矿"}},
    {"activity":"minecraft","tool":"mc_mine","arguments":{"block":"stone"}}
  ],
  "budget": {"maxSteps":4,"maxTokens":1000,"maxDurationMs":60000,"maxRuns":2}
}
```

```http
POST /api/dsh-poetry/workflows.json
{"token":"...","action":"check","name":"study_then_mine"}
{"token":"...","action":"record","name":"study_then_mine","result":{"ok":true,"tokensUsed":120,"durationMs":5000}}
{"token":"...","action":"enable|disable|delete","name":"..."}
```

## Phase 3B 已接

- Reading/Study/Video：通过 Hub Activity adapter 执行；
- Minecraft：写入 `minecraft-task-queue`，由 bot 领取执行；
- workflow 运行按步骤累计耗时/token，失败停止；
- Minecraft 步骤返回 `pending`，不在 workflow 内同步等待。

## Phase 3C 已接（基础）

- `runState`（runId/cursor/pendingTaskId/results）；
- Minecraft 步骤 `pending` 后保存游标；
- `POST action:"resume"` 检查队列任务，完成后回填并继续；
- 失败任务会结束 workflow 并记录错误。

## Phase 3C 未完成

- 自动轮询 resume（当前需手动调用）；
- 心跳/租约续期；
- workflow 级事件触发/优先级；
- 取消/回滚。

## 运行预算（实测/估算）

| 项 | 值 |
|---|---|
| 每轮模型调用 | 2–10 次（取决于步骤） |
| 每轮 token | 约 2k–10k |
| 每轮延迟 | 5–30s |
| 定义存储 | <1MB / 100 个 workflow |
| 运行时内存 | <20MB |
| 新增外部依赖 | 0 |
| 开发成本 | 3A 约 1–2 人日；3B/3C 另计 |
