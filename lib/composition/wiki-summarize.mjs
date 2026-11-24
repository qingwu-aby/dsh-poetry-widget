// @ts-check
// 把 Minecraft Wiki 段落提炼成“游戏里能照做”的步骤；失败就让调用方用原文兜底。
import { callModel } from '../kernel/model-call.mjs'

const SYSTEM = '你在把 Minecraft 中文 Wiki 的段落提炼成玩家能直接照做的步骤。只输出 JSON，不编造 wiki 里没有的内容。'

export function createWikiSummarize(options = {}) {
  const spec = /** @type {any} */ (options)
  const getLlm = spec.getLlm
  if (typeof getLlm !== 'function') return null
  return async function summarize(input = {}) {
    const spec2 = /** @type {any} */ (input)
    const query = spec2.query
    const question = spec2.question
    const guide = spec2.guide
    const steps = Array.isArray(guide?.steps) ? guide.steps.join('\n') : ''
    const source = [guide?.method ?? '', steps]
      .filter((item) => typeof item === 'string' && item.length > 0)
      .join('\n')
      .slice(0, 6000)
    if (source.length < 20) return null
    const result = await callModel({
      role: 'drive',
      policy: spec.policy ?? null,
      resolveLlm: getLlm,
      system: SYSTEM,
      prompt: [
        `她在游戏里问：${String(query || '').trim()}`,
        question ? `补充：${String(question).trim()}` : '',
        `Wiki 条目：${guide?.title || ''}${guide?.caveat ? `（${guide.caveat}）` : ''}${Array.isArray(guide?.sections) && guide.sections.length > 0 ? `｜小节：${guide.sections.join('、')}` : ''}`,
        '原文：',
        source,
        '',
        '只输出 JSON：{"method":"一句话方法（≤60字）","steps":["可执行步骤1","步骤2","步骤3"],"caveat":"注意事项，没有就空字符串"}',
        '步骤要求：写成她能用 mc_* 工具做的动作（例如“拿 X 右键 Y”“先放工作台再合成 Z”）；最多 5 条；wiki 没写的不要补。',
      ]
        .filter((line) => typeof line === 'string' && line.length > 0)
        .join('\n'),
      maxTokens: 700,
      timeoutMs: 30000,
      timeoutCode: 'WIKI_SUMMARY_TIMEOUT',
      timeoutMessage: 'Wiki 步骤提炼超时',
      prefix: 'Wiki 步骤提炼失败',
      modelErrorsPath: typeof spec.modelErrorsPath === 'string' ? spec.modelErrorsPath : null,
    })
    if (!result || typeof result.text !== 'string') return null
    const first = result.text.indexOf('{')
    const last = result.text.lastIndexOf('}')
    if (first < 0 || last <= first) return null
    try {
      const parsed = JSON.parse(result.text.slice(first, last + 1))
      const outSteps = Array.isArray(parsed.steps)
        ? parsed.steps
            .filter((item) => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
            .slice(0, 5)
        : []
      if (outSteps.length === 0) return null
      return {
        method: typeof parsed.method === 'string' ? parsed.method.trim() : '',
        steps: outSteps,
        caveat: typeof parsed.caveat === 'string' ? parsed.caveat.trim() : '',
      }
    } catch (_error) {
      return null
    }
  }
}
