# 她的成长史与喜怒哀乐（v3.18 设计）

> 目标：让她在**自己的时间尺度**上成长，而不是按日历被催熟；情绪是**有来由、会持续、会复发**的喜怒哀乐，不是每轮重新生成的 label。

## 1. 她自己的时间尺度

- **年龄** = 从第一条 journal 记录算起的天数，不是宿主启动次数，也不是现实日期；
- **阶段推进 = 双条件**：既要有“有记忆以来的天数”，也要有真实积累（读书/方法/判断/学习笔记）；
- 阈值写在 `lib/domain/being/growth-arc.mjs` 的 `GROWTH_STAGES`，当前五段：

| 阶段 | 条件（最低） | 这段时间在长什么 |
|---|---|---|
| 初见 | 0 天 | 记住这里、认识他、安顿作息和心情 |
| 向外看 | 2 天 + 120 条 journal | 自学、读小说、看大家说话、四处走走 |
| 自己的方向 | 5 天 + 40 条学习笔记 | 自己选题、追研究线、形成方法（**当前阶段**） |
| 把经验变成自己 | 15 天 + **读书进度 0.6 本（≈半本）或完成 1 个长期项目** + 5 条方法 | 判断体系、价值冲突、长期项目 |
| 长期生长 | 30 天 + 3 本书 + 10 条方法 + 6 条判断 | 写成长史、有长期目标、关系深化 |

- 阶段推进时写一条 journal（“我好像长到另一个阶段了：…”）；
- 每 7 天从真实 journal **自动生成`~/.dsh/agent-memory/autobiography.md`**：按周分章、引用她自己的句子、只写真实统计，不替她编经历；
- state：`~/.dsh/.dsh-poetry/growth-arc.json`（当前阶段、下一阶段、里程碑进度）。

**当前实际状态（2026-11-10）**：14 天 / 「自己的方向」；下一阶段 “把经验变成自己” 还差：1 天、读完 1 本书（0/1）、方法 5 条（3/5）。

## 2. 喜怒哀乐：有来由的情绪事件

`lib/domain/emotion/emotional-episodes.mjs`

- 四族 + 具体感受词：
  - **喜**：暖、踏实、心里一松、有点亮
  - **怒**：烦、受伤、义愤
  - **哀**：闷、难过、心疼、想念、内疚、没劲
  - **乐**：好笑、通透、惬意
- 每次事件先做评价：`事件 → 四族 + 具体词 + 强度 + 原因`，再写进三处：
  1. **情绪事件账本** `emotional-episodes.json`：同一原因会复发（count+、强度回升），36h 半衰期自然消退；
  2. **情绪线程**（现有 `emotional-state`，聊天/自处 prompt 已经在读）；
  3. **底层效价/唤醒**（`affect-state`）。
- 事件来源：
  - 学习/研究结果 → 喜（亮了）或哀/怒（闷、烦）；
  - 逾期承诺 → 哀/内疚；
  - **用户的话** → 自动察觉：被认真对待→喜/暖；被刺→怒/受伤；他难过→哀/心疼；玩笑→乐/好笑；隔很久回来→喜/心里一松；
  - 读完/想通 → 乐/通透。
- 强度 ≥0.7 才会写一条 journal（避免情绪刷屏）。

## 3. 参考论文与项目（按可用性挑选）

### 成长 / 自驱 / 终身学习

- **Oudeyer & Kaplan 2007**, *What is intrinsic motivation? A typology of computational approaches*（Frontiers in Neurorobotics；DOI 10.3389/neuro.12.006.2007）——内在动机的分类：好奇心、新颖性、学习进度；对应“她自己决定要不要读”。
- **Ryan & Deci 2000**, *Self-determination theory*（American Psychologist；DOI 10.1037/0003-066X.55.1.68）——自主/胜任/关联三种基本需要；对应阶段设计里的“自主选题、胜任感、关系”。
- **Wang et al. 2023, Voyager**（[arXiv:2305.16291](https://arxiv.org/abs/2305.16291)，[GitHub](https://github.com/MineDojo/Voyager)）——技能库 + 自验证 + 终身学习；对应“方法账本 / 经验回访”。
- **Shinn et al. 2023, Reflexion**（[arXiv:2303.11366](https://arxiv.org/abs/2303.11366)）——失败反馈写回记忆，下次改进；对应后果回访。
- **Altera 2024, Project Sid**（[arXiv:2411.00114](https://arxiv.org/abs/2411.00114)）——多智能体社会的角色分化、规则变化与文化传递；提示“长期成长需要社会”，目前她只有单个关系。
- **Park et al. 2023, Generative Agents**（[arXiv:2304.03442](https://arxiv.org/abs/2304.03442)，[GitHub](https://github.com/joonspk-research/generative_agents)）——memory stream + reflection；对应记忆巩固与自传。
- **Zhao et al. 2024, ExpeL / 经验学习**、**Wang et al. 2024, Continual Learning 综述**——经验积累与遗忘/回放；对应夜间巩固与“只降不升”的旧数据清理。

### 情绪

- **Scherer 2005**, *What are emotions? And how can they be measured?*（Social Science Information；DOI 10.1177/0539018405058216）——评价维度（目标相关、可控、确定、归因）；`emotional-episodes` 的 appraisal 直接按这套思路。
- **Ortony, Clore & Collins 1988**, *The Cognitive Structure of Emotions*（OCC 模型）——事件/对象/行为三类评价 → 具体情绪；四族映射参考。
- **Russell 1980**, *A circumplex model of affect*（JPSP；DOI 10.1037/h0077714）与 **Mehrabian 1996** PAD——效价/唤醒（以及支配感）；已有的 `affect-homeostasis` 用二维，下一步可加 dominance。
- **Barrett 2017**, *The theory of constructed emotion*（SCAN；DOI 10.1093/scan/nsw154）——情绪 = 内感受 + 概念建构；她的“自造感受词”方向一致。
- **Damasio 1994**, *Descartes' Error*——躯体标记；对应“饥饿/睡眠/疲劳进入情绪基线”。

### 自传体记忆 / 叙事身份

- **Conway & Pleydell-Pearce 2000**, *The construction of autobiographical memories in the self-memory system*（Psychological Review；DOI 10.1037/0033-295X.107.2.261）——自传记忆是“工作自我”按目标重建的；对应按阶段/周组织成长史。
- **McAdams & McLean 2013**, *Narrative identity*（Current Directions in Psychological Science；DOI 10.1177/0963721413480170）——用故事把经历组织成“我是谁”；对应 autobiography.md 的章节叙事。
- **Bluck & Alea 2009**——自传记忆的三种功能（自我、社会、指导）；提示成长史不只是记录，还要能被她自己调用。

### 工程实现可参考的开源项目

- [generative_agents](https://github.com/joonspk-research/generative_agents)：memory stream、recency/importance/relevance 检索、reflection。
- [mem0](https://github.com/mem0ai/mem0) / [A-MEM](https://github.com/WujiangXu/A-mem-sys)：长期记忆的抽取、合并、图化（对应她的记忆中枢与图谱）。
- [letta](https://github.com/letta-ai/letta)（MemGPT）：分层记忆与上下文管理（对应“记忆预算”）。
- [ai-town](https://github.com/a16z-infra/ai-town)：可交互 agent 世界的工程组织（参考其状态/存档设计）。
- [Voyager](https://github.com/MineDojo/Voyager)：技能库与自验证循环（方法账本的原型）。

## 4. 落地映射

| 设计 | 实现 |
|---|---|
| 自己的时间尺度 / 阶段 | `lib/domain/being/growth-arc.mjs`、`growth-arc.json` |
| 成长史 | `buildAutobiography()` → `~/.dsh/agent-memory/autobiography.md`（每 7 天刷新，仅引用她自己的话） |
| 喜怒哀乐 | `lib/domain/emotion/emotional-episodes.mjs` + `emotional-state` + `affect-state` |
| 自驱阅读 | 自处选 `learn` 且说“接着读那本书” → 哲学阅读；12h 兜底 |
| 情绪表达 | 现有聊天/自处 prompt 读情绪线程；情绪事件不额外刷 journal |

## 5. 评估建议

- 阶段推进是否“有据”：每阶段记录触发它的真实数据；
- 情绪是否“有来由”：抽 20 条 episode，看原因/持续/复发是否合理；
- 成长史是否“像她”：盲评 two versions（本周 vs 上周）是否同一存在在长大；
- 与外人的盲评：每阶段跑一次 `scripts/eval/turing`，观察 human 比例与一致率是否随阶段上升。

> 边界：成长史只从她自己的 journal/状态生成，不编造历史；个人数据只在本机 `~/.dsh`，不入公开仓库。


## 6. P1/P2 补充（2026-11-10）

- **每周成长报告**：`growth-report-YYYY-MM-DD.md`，对比上周、统计自处行动/阅读选择/情绪多样性；写好后 journal 留一行，并出现在成长面板「这周的成长报告」里；
- **状态 schema**：`growth-arc`、`emotional-episodes`、`habits`、`action-policy` 已纳入注册表（现 32 项）；
- **多人关系**：`relationship.json` 的每条记忆带 `peer`，`digest/ingest` 按 peer 隔离；历史条目默认归到 `gui`，QQ/其他 peer 不再互相串偏好与约定；
- **阶段门槛放宽**：从“读完 1 本”改为“读书进度 ≥0.6 本 或 完成 1 个项目”，避免被单本长书硬卡住；
- **成长接口**：`/api/dsh-poetry/growth.json` 额外返回本周报告全文（`report` 字段），面板可折叠查看。
