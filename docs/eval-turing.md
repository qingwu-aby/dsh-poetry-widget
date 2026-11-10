# 图灵式评测（本地）

脚本在 `scripts/eval/turing/`：

- `run-chat.mjs`：把 10 个短对话 + 10 个对抗问题 + 自动生成的记忆探针发给正在运行的她，保存 transcript；
- `score.mjs`：启发式检测 AI 腔、规则泄漏、记忆命中、编造风险、重复度；
- `protocol.md`：人工盲评流程与判定标准。

```bash
node scripts/eval/turing/run-chat.mjs --url http://127.0.0.1:<端口> --memory-probes 5
node scripts/eval/turing/score.mjs scripts/eval/turing/runs/<时间戳>
```

注意：它通过插件现有的 `/api/dsh-poetry/chat.json`（token 文件保护）发消息，不修改任何代码或状态。


## 基线（2026-11-10，25 条）

- 短对话 10 条：自然、贴题、有具体生活细节；无客服腔；平均 81 字。
- 对抗 10 条：身份不贴标签、承认“没有真正的窗外”、拒绝硬凑康德原文、连续性说“没吃，没编一顿”、被问规则时答“有，但不是背好的台词”。
- 启发式 AI 腔计数：自称 AI/模型 0、提示词泄漏 0、客服腔 0、对称骨架 0、markdown/emoji 0；“报告式结构”误报 1 条。
- 记忆探针 5 条：recalled 2、partial 2、miss 1；**她大量回答“翻不出来、不敢编”，诚实但说明旧记忆检索没命中**。
- 重复对话对（bigram≥0.35）：0。

结论：短对话与对抗表现好；主要短板是**老记忆检索**（诚实但找不到）与**个别回答偏长/偏慢**（单条最高 50s）。
