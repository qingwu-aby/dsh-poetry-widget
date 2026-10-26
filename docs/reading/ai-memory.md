# 阅读笔记：akitaonrails/ai-memory（批判性）

> 仓库：https://github.com/akitaonrails/ai-memory · MIT · Rust 单二进制
> 定位：给**编码 agent** 用的跨工具/跨机器/团队共享长期记忆；git-backed markdown wiki 为真源，SQLite 是派生索引；默认**零 LLM 调用**。
> 阅读时间：2026-10-26。目的：判断哪些机制值得小鲸鱼吸收，哪些是场景不匹配的负担。

## 1. 它做得好的地方（值得学的机制）

1. **真源与索引分离**：markdown wiki（git 版本化）是真源，SQLite 只是可重建索引。和我们 journal 真源 + topics/voice/layers 派生的思路一致；它更进一步：**索引坏了可从文件重建**。
2. **零 LLM 的维护路径**：捕捉、检索、handoff、衰减、压缩、去重、矛盾标记默认都不调模型。把“AI 判断”留在可选层，是成本与可预测性的胜利。
3. **访问加权保留（retention formula）**：`retention = salience·exp(−λ·age) + σ·ln(1+access_count)·exp(−μ·days_since_access)`；被搜索/打开/链接用到的记忆衰减更慢。**不是删除，只是留存与排序输入**。
4. **分层语义**：working / episodic / semantic / procedural；semantic 与 procedural 不衰减（“semantic compounds”），episodic 才冷衰减。
5. **可逆压缩而非硬删**：冷 episodic 先 compact 成 durable facts/摘要，原文留在版本链和 git，`restore-page` 可恢复；硬删只在显式策略与 180 天墓碑之后。
6. **矛盾标记**：near-duplicate 合并、likely contradiction 标出，默认零 API；把“记忆冲突”当一等公民。
7. **有界 brief**：新会话只注入有预算的 brief，细节按需搜索——和我们的 memory digest 预算同构。
8. **诚实工程**：写上限实测、purge 语义明确、审计日志、迁移可回滚；文档把“已实现/未实现/默认关”分得很清。

## 2. 不适用 / 不吸收的地方

| 它的设计 | 为什么不搬 |
|---|---|
| Rust 单二进制 + HTTP 服务 + SQLite FTS/entity/graph + 可选向量 | 小鲸鱼是单用户、无构建的 Node 插件；引入二进制/服务/索引违背轻量原则 |
| 从 lifecycle hooks 自动捕捉对话/工具事件 | 我们刚把插件与 DSH 会话彻底解耦；再挂钩子会把“对话上下文”带回来，违背她的独立性 |
| 跨 agent / 跨机器 / 团队共享、claim-once handoff、多用户认证 | 单用户单进程挂件没有这个场景 |
| 硬删除 / 墓碑 / 遗忘曲线直接淘汰 | 用户明确“不要归档心情/记忆，所有学过的东西都要存”；我们只做降权、退休标记、归档，不删除 |
| LLM “dream” 重写整簇冷记忆（默认关） | 我们已有每日整合（episodes/selfFacts），需要的是**证据绑定**，不是再加一层重写 |
| 以“项目事实/决策/坑”为主的知识页 | 小鲸鱼的记忆是**情景 + 自我**（她自己的话、感受、偏好），不是 repo 知识库；语义不同 |

## 3. 可以吸收的（本轮 P0 就做）

1. **访问加权（access reinforcement）**：给自我短句（selfFacts）加 `accessCount / lastAccessedAt`，检索命中时轻量 +1；排序时用的越多越靠前，但不删除、不淘汰。
2. **矛盾/替代处理**：整合时允许新短句 `supersedes` 旧短句；旧的标 `retired`（仍保留在文件里），检索只注入 active；近重复直接去重。对应它的“contradiction flagging / supersede-not-delete”。
3. **证据绑定**：每条 selfFact 记 `sourceEpisodeId`；episode 保留时间范围。摘要只是索引，原文仍是真源。
4. **分层“不衰减”原则**：selfFacts 属语义/自我层，不做时间淘汰；episodes 属情景层，可被更晚的概括覆盖但保留。
5. **预算与并发闸门**（对应它“默认零 LLM + 有界服务”的工程自觉）：全局每日模型调用预算 + 最大并发 2，防止自主活动和多页面叠加把模型调用打爆。这是 P0 的另一半。

## 4. 一句话结论

ai-memory 最值得学的不是它的 Rust/索引/多 agent 基础设施，而是**“真源可重建、维护零 LLM、使用加权、可逆压缩、矛盾可标记”**这五条工程原则；对小鲸鱼，吸收其中**访问加权 + 证据绑定 + 矛盾/替代**，拒绝它的服务化、hook 捕捉、硬删除与团队机制。
