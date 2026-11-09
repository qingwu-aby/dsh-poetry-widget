# 知识 → 语言/行为/心情：参考论文清单

> 目的：把“人类是怎么把学到的东西用进日常”拆成可实现的机制，给她的记忆、情绪、行为循环找设计依据。
> 标注 ★ 的是建议先读的；【可抄】表示能直接映射成工程机制。

## A. LLM Agent 的记忆/反思架构（最直接可抄）

- ★ **Park et al. 2023, Generative Agents: Interactive Simulacra of Human Behavior**（UIST 2023；arXiv:2304.03442）
  - 记忆流（memory stream）+ 检索打分（recency × importance × relevance）+ reflection：定期把零散观察升华为高层反思，再用于计划。
  - 【可抄】她已有 recency/relevance 的雏形；缺“importance”打分与“定期自动 reflection 成更抽象结论”的预算控制。
- ★ **Sumers et al. 2023/2024, Cognitive Architectures for Language Agents (CoALA)**（TMLR；arXiv:2309.02427）
  - 把语言 agent 拆成 working / episodic / semantic / procedural memory + 结构化动作空间 + 决策循环。
  - 【可抄】给她做“记忆类型分层”和“动作空间注册表”的总框架（正好对应我们要做的 action/source registry）。
- **Chhikara et al. 2025, Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory**（arXiv:2504.19413）
  - 抽取 → 合并/去重 → 检索；graph memory 变体；强调 token/延迟成本。
  - 【可抄】状态文件/记忆的合并去重与预算策略。
- **Xu et al. 2025, A-MEM: Agentic Memory for LLM Agents**（NeurIPS 2025；arXiv:2502.12110）
  - Zettelkasten 式笔记：新记忆生成结构化 note（上下文/关键词/标签），自动建立链接，并能“演化”旧笔记。
  - 【可抄】正是认知图谱 + 学习日志的下一步：新增学习自动连边、并回写旧条目。
- **Shinn et al. 2023, Reflexion**（arXiv:2303.11366）与 **Wang et al. 2023, Voyager**（arXiv:2305.16291）
  - 失败反馈写回记忆、下次改进；技能库沉淀为可复用动作。
  - 【可抄】自处/研究的“失败 → 写规则 → 下次少犯”闭环。

## B. 记忆的激活、巩固与重放

- ★ **Collins & Loftus 1975, A spreading-activation theory of semantic processing**（Psychological Review 82:407–428；DOI 10.1037/0033-295X.82.4.407）
  - 语义记忆是网络，激活会沿链接扩散；线索决定哪些概念被点亮。
  - 【可抄】检索不要只返回直接匹配，沿图谱 1–2 跳做扩散激活。
- **McClelland, McNaughton & O'Reilly 1995, Why there are complementary learning systems**（Psychological Review 102:419–457；DOI 10.1037/0033-295X.102.3.419）
- ★ **Kumaran, Hassabis & McClelland 2016, What learning systems do intelligent agents need?**（Trends in Cognitive Sciences 20:512–534；DOI 10.1016/j.tics.2016.05.004）
  - 互补学习系统：快速情景记忆 + 慢速语义统计；离线重放把前者压成后者。
  - 【可抄】“当天学到的细节 → 夜间批处理 → 语义要点/图谱”的明确分工。
- ★ **Diekelmann & Born 2010, The memory function of sleep**（Nature Reviews Neuroscience 11:114–126；DOI 10.1038/nrn2762）
- **Rasch & Born 2013, About sleep's role in memory**（Physiological Reviews 93:681–766；DOI 10.1152/physrev.00032.2012）
  - 睡眠中的重放与巩固；情绪记忆优先。
  - 【可抄】给她加“离线巩固批次”而不是全天靠提示。
- **Wilson & McNaughton 1994, Reactivation of hippocampal ensemble memories during sleep**（Science 265:676–679；DOI 10.1126/science.8036517）
- **Schaul et al. 2015, Prioritized Experience Replay**（arXiv:1511.05952）
  - 按“惊奇/误差”优先级重放。
  - 【可抄】巩固时优先重放预测误差大的条目（她的 predict-check 已有基础）。

## C. 好奇、信息缺口与探索

- ★ **Loewenstein 1994, The psychology of curiosity: A review and reinterpretation**（Psychological Bulletin 116:75–98；DOI 10.1037/0033-2909.116.1.75）
  - 好奇 = 感知到的信息缺口；缺口越大越想知道，但太大会回避。
  - 【可抄】图谱缺口/未闭合问题 → 好奇驱动学习；控制难度避免“太大逃避”。
- **Kidd & Hayden 2015, The psychology and neuroscience of curiosity**（Neuron 88:449–460；DOI 10.1016/j.neuron.2015.09.010）
- **Gottlieb et al. 2013, Information-seeking, curiosity, and attention**（Trends in Cognitive Sciences 17:585–593；DOI 10.1016/j.tics.2013.09.001）
  - 信息本身有奖赏价值；不确定性调节探索。
  - 【可抄】给“查到了”设计内在奖赏/情绪事件，而不是只有任务完成。

## D. 情绪：评价、内感受与构造

- ★ **Scherer 2005, What are emotions? And how can they be measured?**（Social Science Information 44:695–729；DOI 10.1177/0539018405058216）
  - 情绪由多维度评价（appraisal）产生：目标相关性、可控性、确定性、责任归属等。
  - 【可抄】把“情绪生成”从自由发挥改成四维评价计算：这件事和我目标相关吗？我能控制吗？确定吗？怪谁？
- ★ **Damasio 1994, Descartes' Error**（书；somatic marker hypothesis）
  - 情绪离不开身体状态；身体标记参与决策。
  - 【可抄】她的代谢/睡眠/饥饿已有“身体”雏形，应让这些状态参与情绪评价而非仅做背景。
- **Barrett 2017, The theory of constructed emotion: an active inference account**（SCAN 12:1–23；DOI 10.1093/scan/nsw154）
  - 情绪是身体内感受 + 概念分类的构造，不是固定基本情绪；情绪词库会影响体验。
  - 【可抄】她的“自造感受词”方向正确；情绪 = 内感受预测 + 概念命名。
- **Seth & Friston 2016, Active interoceptive inference and the emotional brain**（Phil Trans R Soc B 371:20160007；DOI 10.1098/rstb.2016.0007）
- **Russell 1980, A circumplex model of affect**（JPSP 39:1161–1178；DOI 10.1037/h0077714）
  - 效价×唤醒二维；适合做 mood 坐标而不是标签堆叠。
- **Friston 2010, The free-energy principle: a unified brain theory?**（Nature Reviews Neuroscience 11:127–138；DOI 10.1038/nrn2787）
  - 预测误差驱动学习与行动；情绪是预测误差的内感受版本。
  - 【可抄】她的 predict-check 可扩展为“情绪 surprise”：预想 vs 实际。

## E. 行为：目标、习惯、意图与叙事

- ★ **Wood & Rünger 2016, Psychology of Habit**（Annual Review of Psychology 67:289–314；DOI 10.1146/annurev-psych-122414-033417）
  - 习惯是“情境线索 → 动作”的自动链接；重复与稳定情境是关键。
  - 【可抄】记录“情境→动作→结果”，成功重复的动作提高默认概率；不是每次都由模型即兴。
- **Dickinson & Balleine 1994, Motivational control of goal-directed action**（Animal Learning & Behavior 22:1–18；DOI 10.3758/BF03199951）
  - 目标导向 vs 习惯化两套系统。
- **Gollwitzer 1999, Implementation intentions**（American Psychologist 54:493–503；DOI 10.1037/0003-066X.54.7.493）
  - “如果 X，就做 Y”的计划显著提高执行率。
  - 【可抄】承诺账本可以升级为“如果到期/如果看到某线索 → 就做某事”。
- ★ **Conway & Pleydell-Pearce 2000, The construction of autobiographical memories in the self-memory system**（Psychological Review 107:261–288；DOI 10.1037/0033-295X.107.2.261）
- **McAdams & McLean 2013, Narrative identity**（Current Directions in Psychological Science 22:233–238；DOI 10.1177/0963721413480170）
  - 人用叙事把经历组织成“我是谁”；故事影响后续选择。
  - 【可抄】世界观/自传体叙事应作为检索和决策的一层，而不只是周报。

## F. 社会反馈与分享

- ★ **Tamir & Mitchell 2012, Disclosing information about the self is intrinsically rewarding**（PNAS 109:13667–13672；DOI 10.1073/pnas.1205294109）
  - 分享自我信息本身有奖赏；被回应会强化。
  - 【可抄】分享不应只靠冷却时间，要有“被回应→强化分享/被冷落→降低”的简单强化。
- **Meshi et al. 2013, The emerging neuroscience of social media**（Trends Cogn Sci 17:596–597 附近；可作综述）

## 建议阅读顺序（3 天快速版）

1. Generative Agents 的 §4 架构 + CoALA 的记忆/动作分类（先定工程词汇）；
2. Mem0 / A-MEM（看“抽-并-链-演化”具体怎么做）；
3. Kumaran 2016 + Rasch & Born 2013（离线巩固）；
4. Scherer 2005 + Damasio 1994/Barrett 2017（情绪评价与内感受）；
5. Loewenstein 1994 + Kidd & Hayden 2015（好奇/信息缺口）；
6. Wood & Rünger 2016 + Gollwitzer 1999（习惯与执行意图）；
7. McAdams 2013（叙事身份）。

## 已落地（v3.10）

- ✅ 扩散激活检索：`lib/domain/knowledge/knowledge-graph.mjs#spreadActivation`，聊天 prompt 带 `spreadLines`（Generative Agents + Collins & Loftus）；
- ✅ 夜间离线巩固：`lib/domain/knowledge/nightly-consolidation.mjs`（Kumaran/Rasch + Mem0/A-MEM 的 merge/evolve）；
- ✅ 情绪评价器：`lib/domain/emotion/appraisal.mjs`——对学习/研究结果算 relevance/controllability/certainty/agency，映射成情绪线程（Scherer/Damasio/Barrett）；
- ✅ 习惯记忆：`lib/domain/being/habit-memory.mjs`——情境→动作→结果记账、成功率/近期性建议进自处 prompt（Wood & Rünger）；
- ✅ 执行意图：承诺 digest 自动带“如果今天有空，就先做这个；做不了就直说”（Gollwitzer）；
- ✅ 夜间巩固冲突检测：同一节点上极性相反/年份互斥的判断 → `report.conflicts` + journal 提示（初版，仅候选提示不自动改）。

## 直接对应的四项改造（按清单落地顺序）

1. **扩散激活检索**：睡觉前/聊天前从图谱 1–2 跳扩展，按 recency×importance×relevance 打分（Generative Agents + Collins & Loftus）；
2. **离线巩固批次**：夜间把当天学习/情绪事件重放，合并重复、检测矛盾、重写世界观（Kumaran/Rasch；Mem0/A-MEM 的 merge/evolve）；
3. **情绪评价器**：对学习/研究结果做 appraisal（目标相关/可控/确定/归因）→ 情绪线程；内感受（代谢/睡眠）参与（Scherer/Damasio/Barrett/Seth）；
4. **习惯与执行意图**：情境→动作→结果记账，成功的动作默认化；承诺账本用“如果…就…”（Wood & Rünger/Gollwitzer）。

> 备注：清单里的 DOI/arXiv 号为人工核对过的常用版本；具体页码/年份以出版页为准。分享类研究只取机制，不照搬“社交媒体成瘾”结论。
