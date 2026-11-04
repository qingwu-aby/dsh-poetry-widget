# 真实世界的感知与反馈：论文清单（v1.0）

> 目的：小鲸鱼现在能读百科、抓公开网页、看几个站点标题，但“感知—行动—反馈”的闭环很薄：
> 她的世界反馈只覆盖“抓取是否成功/作品是否生成”，很少把**预测与观测的差**写回来；
> 她也没有“因为不确定所以去查”的主动感知策略，以及可复用的经验/技能库。
> 下面这些论文按“能直接改哪一层”分类，不按年份。

## 一、先读这 5 篇（性价比最高）

1. **ReAct: Synergizing Reasoning and Acting in Language Models**（Yao et al., 2022）
   - arXiv: [2210.03629](https://arxiv.org/abs/2210.03629)
   - 一句话：推理与行动交替，行动结果（observation）直接进下一轮思考，而不是先想完再一次性执行。
   - 对鲸鱼：她现在的自处是“一次输出一个动作”，没有中间观测。可以改成小步循环：做一步 → 看结果 → 再决定下一步（哪怕只在“查资料/读网页”时启用）。
2. **Reflexion: Language Agents with Verbal Reinforcement Learning**（Shinn et al., 2023）
   - arXiv: [2303.11366](https://arxiv.org/abs/2303.11366)
   - 一句话：把失败经验写成自然语言反思存起来，下次同类任务先检索，效果接近“口头强化学习”。
   - 对鲸鱼：她的 reflect 已经在做，但没和“这次动作结果”绑定。可以要求反思必须引用本轮 worldFeedback 的具体观测，并按“失败类型”归档（网页打不开/材料没有正文/自己看错/重复）。
3. **Generative Agents: Interactive Simulacra of Human Behavior**（Park et al., 2023）
   - arXiv: [2304.03442](https://arxiv.org/abs/2304.03442)
   - 一句话：memory stream + 定期 reflection + 按相关性检索记忆，行为才连贯。
   - 对鲸鱼：她有 journal/digest，但“感知到的事”和“自己的旧记忆”是混在一起的；可以分出一条 **observations** 流（她看到的真实网页/数据），检索时优先给相关观察，而不是最近三条想法（v2.66 已经修了一半）。
4. **Voyager: An Open-Ended Embodied Agent with Large Language Models**（Wang et al., 2023）
   - arXiv: [2305.16291](https://arxiv.org/abs/2305.16291)
   - 一句话：把成功行为写成可复用技能存进技能库，遇到新任务先检索技能，再迭代改进。
   - 对鲸鱼：她的 methodology.json 是“方法规则”，但没有可执行技能（怎么核对一个年份、怎么从扫描页找正文、怎么判断维基条目只有目录）。可以把成功步骤沉淀成 skill 条目，prompt 里按任务检索。
5. **Inner Monologue: Embodied Reasoning through Planning with Language Models**（Huang et al., 2022）
   - arXiv: [2207.05608](https://arxiv.org/abs/2207.05608)
   - 一句话：把环境的成功/失败反馈直接喂回规划循环，失败就换计划，而不是硬走完。
   - 对鲸鱼：抓取失败/内容为空时她现在只是“没查到”，不会换路径（换站点、换搜索词、换入口）。可以在 browse 失败后自动尝试备选路径并把“为什么换”写进 journal。

## 二、感知—行动闭环（她最缺的层）

| 论文 | 链接 | 对鲸鱼能改什么 |
|---|---|---|
| Toolformer（Schick et al., 2023） | [2302.04761](https://arxiv.org/abs/2302.04761) | 工具调用要“按需、可自监督”，而不是每轮都调；可以给 browse/search 加“值不值得查”的自评 |
| Do As I Can, Not As I Say（SayCan, Ahn et al., 2022） | [2204.01691](https://arxiv.org/abs/2204.01691) | 行动前先看“可行性/可供性”：文件在不在、页面能不能开、有没有权限，再决定说不说 |
| Gorilla（Patil et al., 2023） | [2305.15334](https://arxiv.org/abs/2305.15334) | 大规模 API 调用的检索与纠错；对应她以后接更多真实数据源（天气、书目、数据库） |
| AgentBench（Liu et al., 2023） | [2308.03688](https://arxiv.org/abs/2308.03688) | 用基准任务衡量“她到底能不能完成真实操作”，而不是只看看起来像不像 |

## 三、主动感知、好奇心与世界模型

| 论文 | 链接 | 对鲸鱼能改什么 |
|---|---|---|
| Curiosity-driven Exploration by Self-supervised Prediction（Pathak et al., 2017） | [1705.05363](https://arxiv.org/abs/1705.05363) | 用“预测误差”当内在奖励：她越猜不到结果的事，越值得去看；可以把 browse 选择从“想查什么”升级成“哪件事最不确定” |
| World Models（Ha & Schmidhuber, 2018） | [1803.10122](https://arxiv.org/abs/1803.10122) | 先预测再验证：动作前写 expect，动作后拿观测比对，误差大的写进记忆 |
| Mastering Diverse Domains through World Models（DreamerV3, Hafner et al., 2023） | [2301.04104](https://arxiv.org/abs/2301.04104) | 同上的工程化版本；她不需要训世界模型，但可以借“预测—观测—惊讶”的结构 |
| Active Inference: The Free Energy Principle in Mind, Brain, and Behavior（Parr, Pezzulo, Friston, 2022, MIT Press） | 书（无 arXiv） | 主动推理框架：感知与行动都是“最小化预测误差”，可作为她“为什么去查”的理论底座 |

## 四、经验、反思与技能积累

| 论文 | 链接 | 对鲸鱼能改什么 |
|---|---|---|
| ExpeL: LLM Agents Are Experiential Learners（Zhao et al., 2023） | [2308.10144](https://arxiv.org/abs/2308.10144) | 从成功/失败轨迹里抽“可迁移经验”，比单条反思更耐久 |
| Agent Workflow Memory（Wang et al., 2024） | [2409.07429](https://arxiv.org/abs/2409.07429) | 把重复任务固化成工作流；对应她的“查词/对年份/读扫描页”套路 |
| Self-Refine（Madaan et al., 2023） | [2303.17651](https://arxiv.org/abs/2303.17651) | 生成后自我批评再改；可用于她的作品和报告，而不是只写一次 |
| STaR: Bootstrapping Reasoning With Reasoning（Zelikman et al., 2022） | [2203.14465](https://arxiv.org/abs/2203.14465) | 用自己的成功推理做训练数据；她可以用成功日记反哺 prompt/规则 |
| ReAct（已在上面） | — | 行动—观测交替是她的基础循环改造 |

## 五、真实网页 / 真实环境（她的“外界”主要在这里）

| 论文/系统 | 链接 | 对鲸鱼能改什么 |
|---|---|---|
| WebArena（Zhou et al., 2023） | [2307.13854](https://arxiv.org/abs/2307.13854) | 真实网站任务基准；可以拿“查一段原文/核一个词/对一份数据”当她的自测题 |
| Mind2Web（Deng et al., 2023） | [2306.06070](https://arxiv.org/abs/2306.06070) | 网页元素级操作；她目前只读正文，未来要“点进目录/翻页”时可参考 |
| WebVoyager（He et al., 2024） | [2401.13919](https://arxiv.org/abs/2401.13919) | 端到端网页智能体；重点是失败后的重试策略 |
| BrowserGym（Le Sellier de Chezelles et al., 2024） | [2412.05467](https://arxiv.org/abs/2412.05467) | 网页智能体训练/评测环境，可借它的任务设计 |
| OSWorld（Xie et al., 2024） | [2404.07972](https://arxiv.org/abs/2404.07972) | 真实电脑任务；离她较远，但“真实反馈”的定义可参考 |
| DigiRL（Bai et al., 2024） | [2406.11896](https://arxiv.org/abs/2406.11896) | 在真实设备上做在线 RL；说明“环境反馈”可以真的参与策略更新 |
| WebRL（Qi et al., 2024） | [2411.02337](https://arxiv.org/abs/2411.02337) | 自我进化课程 + 在线 RL；对应“她自己出题、自己练”的长期路线 |
| Agent Q（Putta et al., 2024） | [2408.07199](https://arxiv.org/abs/2408.07199) | 搜索 + 自我批评 + RL 的组合；可作为她“查—评—改”的参考架构 |

## 六、具身/多模态（暂时用不上，留作接口）

| 论文 | 链接 | 说明 |
|---|---|---|
| PaLM-E（Driess et al., 2023） | [2303.03378](https://arxiv.org/abs/2303.03378) | 多模态具身模型；她以后若能接图片/摄像头，这是“感知进语言”的经典路线 |
| VIMA（Jiang et al., 2022） | [2210.03094](https://arxiv.org/abs/2210.03094) | 多模态提示驱动机器人操作；对应“用图/文字混合下指令” |
| MineDojo（Fan et al., 2022） | [2206.08853](https://arxiv.org/abs/2206.08853) | 开放世界具身智能体 + 互联网知识；她以后若有“可操作环境”可参考 |

## 七、落地到小鲸鱼：三个最小改造（按优先级）

1. **预测误差账本**（World Models / Curiosity / Inner Monologue）
   - 在 `lib/world-feedback.mjs` 的记录里加 `expect` 与 `observed`，并算一个粗粒度 `surprise`（成功/失败/内容长度偏差/关键词缺失）。
   - 自处 prompt 把“最近惊讶”列出来，让她下一轮优先处理“和预想不一样”的事。
2. **主动感知选择**（Active Inference / Pathak）
   - 自处已有 `browse/search`（v2.71）；把提示从“想查什么”改成“现在最不确定的是什么，查它”，并记录“查完有没有解决这个不确定”。
   - 不追求随机乱逛；用“信息增益”替代“新鲜感”。
3. **技能库**（Voyager / ExpeL / Agent Workflow Memory）
   - 在 `methodology.json` 之外增加 `skills`（步骤化、可复用、带适用条件），成功完成后自动候选入库；prompt 按当前任务检索 2–3 条技能。
4. **自测基准**（WebArena / WebVoyager）
   - 给她 5 个固定小题（找一段原文、核一个年份、对两个来源的冲突、读一个只有目录的页面、承认查不到），每周跑一次，记录成功率与失败类型。

> 说明：论文链接均经 arXiv API 核对（标题/年份/一作）。个别书/期刊文献没有 arXiv 链接。
