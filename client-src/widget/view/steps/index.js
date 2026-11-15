// client-src/widget/view/steps/index.js —— 诗笺气泡第 1–6 张的内容分发
import { AnalysisStep } from './analysis-step.js'
import { CiStep } from './ci-step.js'
import { FeihuaStep } from './feihua-step.js'
import { KnowledgeStep } from './knowledge-step.js'
import { PoemStep } from './poem-step.js'
import { YunStep } from './yun-step.js'

/**
 * props.step：0 今日一诗 / 1 格律解析 / 2 知识卡 / 3 韵部 / 4 词牌 / 5 飞花令
 * 其余字段透传给对应 step 视图（数据 + 回调）。
 */
export function StepContent(props) {
  const step = props.step
  if (step === 0) return PoemStep(props)
  if (step === 1) return AnalysisStep(props)
  if (step === 2) return KnowledgeStep(props)
  if (step === 3) return YunStep(props)
  if (step === 4) return CiStep(props)
  return FeihuaStep(props)
}
