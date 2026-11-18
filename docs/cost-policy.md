# 成本治理策略（Gate A6）

> 目标：设置 `modelTokenLimit` 默认不封顶后，仍然“花得可控”——单次成本、调用频率、每日总量三层各自可配。
> 相关代码：`lib/domain/host/cost-guard.mjs`（本 Gate 新增）、`lib/domain/host/model-budget.mjs`（Gate A1）、
> `lib/kernel/model-policy.mjs`（token 上限）、`lib/kernel/llm-call.mjs`（调用入口）。

## 1. 三层成本控制

| 层 | 管什么 | 配置 | 默认 | 超限行为 | 代码 |
|---|---|---|---|---|---|
| 单次 token 上限 | 一次生成最多多少 token | 设置项 `modelTokenLimit`（0 = 不封顶） | 0（不封顶） | provider 侧截断/请求参数 | `settings-store` → `model-policy.resolveCandidateMaxTokens` |
| 调用频率/窗口限流 | 每分钟 / 每日调用**次数**（可按 role/activity 细分） | env（见 §3）或未来设置页 | 硬上限不限；只有软告警阈值 | 返回 `COST_RATE_LIMITED`（明确 reason），调用方跳过本次 | `lib/domain/host/cost-guard.mjs` |
| 每日预算 | 按上海本地日统计 role/总调用次数 | `DSH_POETRY_DAILY_*` | 不限制（0） | 返回预算拒绝（`MODEL_BUDGET_EXHAUSTED`） | `lib/domain/host/model-budget.mjs` |

三者**互不重复计数**：token 上限不计数；cost-guard 只维护自己的滑动窗口计数；model-budget 只维护自己的按日计数。
一次模型调用如果接线了 cost-guard + model-budget，会各记一次（两个不同口径的统计，不是同一计数加两次）。

## 2. 配置优先级

```text
overrides（未来设置页 / 插件 UI）
        ↓ 覆盖
环境变量 DSH_POETRY_COST_*
        ↓ 覆盖
DEFAULT_COST_POLICY（内置默认）
```

- `modelTokenLimit` 来自插件设置（`settings.json`），与上面三层解耦；
- 未来设置页写入的 `overrides` 优先级最高，可随时调整/关闭，不需要重启。

## 3. 默认建议值

**硬上限默认全部不限**（保持“默认不封顶”），只给**软告警**（不拒绝调用，只上报/记录）：

| 维度 | 窗口 | 软告警阈值 | 说明 |
|---|---|---|---|
| 总量 total | 分钟 | 20 次 | 短时间大量模型调用（异常循环/并发活动过多） |
| 总量 total | 日 | 600 次 | 日常总调用量参考上限 |
| role `mood` | 日 | 100 次 | 心情刷新（5min 一次 ≈ 288/天，若只靠定时器会超；按事件触发时通常更低） |
| role `selfTalk` | 日 | 120 次 | 碎碎念（1–2 分钟一次，按清醒时段估算） |
| role `growth` | 日 | 80 次 | 自省/自学（小时级） |
| role `voice` | 日 | 60 次 | 本地语气层润色 |

> 这些是**建议值**，可按实际使用调整；软告警只在 `health`/回调里出现，不打断她做事。
> 硬上限（真正拒绝）默认不设；需要硬控时用 env 或未来设置页显式配置。

## 4. 环境变量

| 变量 | 作用 | 示例 |
|---|---|---|
| `DSH_POETRY_COST_GUARD=off` | 关闭限流（只读不拒、不计数） | `off` |
| `DSH_POETRY_COST_MINUTE_TOTAL` | 总量每分钟硬上限（0 = 不限） | `30` |
| `DSH_POETRY_COST_DAY_TOTAL` | 总量每日硬上限 | `800` |
| `DSH_POETRY_COST_ROLE_<ROLE>_MINUTE` / `_DAY` | role 维度硬上限（ROLE 用大写蛇形） | `DSH_POETRY_COST_ROLE_SELF_TALK_DAY=150` |
| `DSH_POETRY_COST_ACTIVITY_<NAME>_MINUTE` / `_DAY` | activity 维度硬上限 | `DSH_POETRY_COST_ACTIVITY_MINECRAFT_DAY=200` |
| `DSH_POETRY_COST_SOFT_MINUTE_TOTAL` / `_SOFT_DAY_TOTAL` | 总量软告警阈值 | `DSH_POETRY_COST_SOFT_DAY_TOTAL=400` |

非法/空值忽略（回退默认），不会导致启动失败。

## 5. 拒绝语义

`guard.acquire({ role, activity })` 返回：

```js
// 允许
{ ok: true, softAlerts: [{ code: 'COST_SOFT_ALERT', scope, name, window, used, threshold, ... }], usage: {...} }
// 超限
{
  ok: false,
  code: 'COST_RATE_LIMITED',
  reason: 'rate-limit',
  scope: 'total' | 'role' | 'activity',
  name: 'mood' | 'chat' | '',
  window: 'minute' | 'day',
  limit: 2,
  used: 2,
  retryAfterMs: 60000,   // 分钟窗口=最早时间戳出窗；日窗口=到上海次日 0 点
  message: 'role「mood」每分调用上限 2 已用完（2/2）'
}
```

调用方应：**跳过本次调用**（安静跳过/记日志），不要立刻换候选或重试；`retryAfterMs` 之后可再试。
被拒绝的调用**不计数**（不占用窗口额度）。

## 6. 与 model-budget 的兼容 / 接线建议

- cost-guard 不读 `model-budget.json`、不调用 `budget.tryConsume`，也不落盘；
- 未来 Sprint 接线位置（**不在本 Gate 写作用域**，需要改 `lib/kernel/llm-call.mjs`）：
  1. 预算检查（`modelRuntime.budget.tryConsume`）之后；
  2. 并发闸门 `gate.acquire` 之前（或之后均可，建议之前，避免排队后被限流浪费槽位）；
  3. 调用 `costGuard.acquire({ role, activity })`，`ok:false` 时返回 `{ ok:false, retryable:false, reason, code }`；
  4. 成功通过后按现有流程发请求；cost-guard 已在 acquire 内计数。
- 若某服务自己已计数（例如 future Hub 的 activity 计数），可用 `guard.peek()` 预检 + `guard.record()` 手动记账，保持口径一致。

## 7. 观测

`guard.snapshot()` 返回（供 health/CLI，不含任何 prompt/内容）：

```js
{
  enabled, now, day, tokenLimit,
  limits, softAlerts,                       // 当前生效策略
  usage: { total: { minute, day }, roles: { mood: {...} }, activities: { chat: {...} } },
  rejected: { minute, day },                // 进程内累计拒绝
  rejectedByScope: { total, role, activity },
  recentAlerts: [ ...最近 10 条软告警 ]
}
```

后续可把该快照接进 `health.json` 的 `metrics.cost`（Gate A5 的 metrics 结构已就绪，接线时再加字段即可）。

## 8. 窗口语义与边界

- **分钟窗口**：滑动窗口（保存最近 60s 的调用时间戳，出窗即释放），不是固定分钟桶；
- **日窗口**：按 Asia/Shanghai 本地日（与 model-budget 一致），跨日自动清零；
- **进程内状态**：计数不落盘，重启后清零——限流是“防止短时间失控”的近似保护，不承担跨重启精确配额
  （跨重启的日总量由 model-budget 的落盘计数负责）；
- **软告警冷却**：同 key 同窗口在冷却期内（分钟 1min / 日 1h）只上报一次，避免刷屏；
- **不做金额/token 统计**：本 Gate 只控“调用次数”；token 成本由 `modelTokenLimit` 与 provider 计费控制，
  后续如需按 token/美元预算，可在 acquire 时传入 estimated tokens 扩展。

## 9. 关闭方式

- 临时：`DSH_POETRY_COST_GUARD=off`（重启宿主生效；不计数、不拒绝）；
- 永久/按需：未来设置页开关（`overrides.enabled=false`，不重启生效）；
- 代码内：`createCostGuard({ enabled: false })`（测试/单进程场景）。

## 10. 验收对应（Gate A6）

| 验收项 | 对应 |
|---|---|
| 超限调用被拒绝且有 reason | `COST_RATE_LIMITED` + `reason:'rate-limit'` + scope/window/limit/used/retryAfterMs（测试覆盖分钟/日/role/activity） |
| 预算统计不重复 | cost-guard 与 model-budget 各自独立计数；单测模拟“一次调用各记一次”并断言两边都是 3 |
| 默认建议值、可关闭 | 本文 §3/§4/§9；`DEFAULT_COST_POLICY` + `DSH_POETRY_COST_GUARD=off` |
| 纯逻辑 + 测试 | `lib/domain/host/cost-guard.mjs`（无 fs/网络/定时器）；`tests/kernel.test.mjs` 的 `cost-guard A6` 用例 |
