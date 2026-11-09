# ADR 0003：统一模型调用层

- 状态：已采纳（2026-11-09）
- 背景：EMPTY_RESPONSE（thinking 吃光 token）在 graph/worldview/mood/self-talk 反复出现，各模块分别打补丁。
- 决策：
  1. `lib/kernel/model-call.mjs` 提供 `callRole(profileId, { attempts, parse, debugFile })`；
  2. 角色 profile 定义 token 下限、超时、错误前缀；
  3. 失败自动换更大 token 重试；解析失败落 `*-debug.json`；错误区分 empty/invalid；
  4. 新角色先加 profile，不允许再复制 callModelForRole 的重试逻辑。
- 后果：knowledge-extract / worldview 已迁移；其余角色按波次迁移。
