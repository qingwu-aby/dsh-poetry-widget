# 模型不稳定的原因（2026-11-24 诊断）

## 证据

`~/.dsh/.dsh-poetry/model-errors.jsonl` 最近 200 条：

| 代码 | 次数 |
|---|---|
| EMPTY_RESPONSE | 72 |
| MODEL_TIMEOUT | 34 |
| SELF_GROWTH_TIMEOUT | 31 |
| SELF_DRIVE_TIMEOUT | 27 |
| GRAPH_EXTRACT_TIMEOUT | 13 |
| TRANSPORT | 9 |

按 provider：

- `dsh-opencode-go/deepseek-v4.1-flash`：97
- `deepseek-account/deepseek-flash`：72
- `dsh-opencode-go/hy4-flash-free`：31

## 根因 1：小预算角色被 thinking 吃光（EMPTY_RESPONSE 主因）

deepseek-v4.1-flash 在 Go 网关 **thinking 常开**，推理 token 与正文共享 `max_tokens`。

EMPTY_RESPONSE 的 maxTokens 分布：

```text
260 ×25   220 ×19   700 ×7
```

而 mood 的预算是 220。推理一开就把预算用光，正文 0 字 → 空回复。

**更关键**：插件本来给 dsh-opencode-go 候选配了 `maxTokensFloor`（mood 2400），但那只在「默认候选路径」生效；  
一旦在设置页把 13 个角色都显式覆盖成 `dsh-opencode-go`，走的是 `roleOverride` 分支，**floor 丢失**，于是 mood 又回到 220。

已修：override 路径同样补 floor。

## 根因 2：mood prompt 过大

mood 的 prompt 达 **12,000+ 字符**，主要来自整份心情图鉴（每个候选一行 file｜label｜tags｜media｜when）。

配合 220 的小预算：又慢又容易空。

已修：候选上限 40 条；mood 超时 20s → 30s。

## 根因 3：drive/growth 超时是真实的慢

`drive` 53 次超时、`growth` 32 次，prompt 中位数约 3.3k 字符。  
v4.1-flash 带 thinking 时首字延迟高，20s 的 drive 超时偏紧。

## 未修的部分

- drive/growth 超时暂未调整（改大会拖慢她的循环）；
- 12k 字符的 mood prompt 已降到约 4k，但未实测；
- provider 侧偶发 TRANSPORT（9 次）属于网络/网关，插件层无法根治。
