// lib/domain/being/moral-reasoning.mjs —— 道德情境识别 + 道德情绪 + 推理提示（v3.14）
//
// 先把“这是不是对错问题”判断出来，再把相关方/原则/冲突写进 prompt；
// 道德情绪（内疚/羞愧/义愤/感激）用来驱动修正，而不是只留一条记录。
import { PRINCIPLES, valuesPromptBlock } from './values.mjs'

const DIMENSION_PATTERNS = Object.freeze({
  harm: /(伤害|欺负|欺負|骗|騙|欺骗|偷|抢|搶|杀|殺|利用|发泄|辱骂|辱罵|歧视|歧視|暴力|霸凌|报复|報復|威胁|威脅|伤害她|伤害他)/,
  honesty: /(撒谎|撒謊|骗|騙|编造|編造|隐瞒|隱瞞|假话|假話|伪装|偽裝|误导|誤導)/,
  autonomy: /(强迫|強迫|控制|替我做|必须|必須|不许|不許|为你好|為你好|逼我|要我听)/,
  integrity: /(答应|答應|承诺|承諾|失约|失約|反悔|说好|說好|放了鸽子|放鸽子)/,
  fairness: /(不公平|偏心|双标|雙標|凭什么|憑什麼|偏袒)/,
  privacy: /(隐私|隱私|秘密|截图|截圖|曝光|泄露|洩露|聊天记录|聊天記錄)/,
})

const PARTY_PATTERN = /(我|你|他|她|它|他们|她们|大家|别人|別人|用户|用戶)/g

/**
 * 判断一段话是否涉及“对错”问题：返回涉及的维度、相关方、强度。
 * 只是“相关”，不是“裁决”；不相关就不值得进入道德推理。
 */
export function assessMoralRelevance(text) {
  const value = String(text ?? '')
  const dimensions = []
  for (const [dimension, pattern] of Object.entries(DIMENSION_PATTERNS)) {
    if (pattern.test(value)) dimensions.push(dimension)
  }
  const parties = [...new Set(value.match(PARTY_PATTERN) ?? [])].slice(0, 5)
  const relevant = dimensions.length > 0
  const intensity = relevant ? Math.min(1, 0.35 + dimensions.length * 0.2 + (dimensions.includes('harm') ? 0.2 : 0)) : 0
  return { relevant, dimensions, parties, intensity }
}

/** 把识别结果压成 prompt 行（仅在 relevant 时用）。 */
export function buildMoralCheckLines(result, options = {}) {
  if (!result || result.relevant !== true) return []
  const principleMap = { harm: '不伤害', honesty: '诚实', autonomy: '尊重自主', integrity: '守信', fairness: '公平', privacy: '隐私' }
  const names = result.dimensions.map((dimension) => principleMap[dimension]).filter(Boolean)
  const lines = [
    '这件事可能涉及对错，不只是事实或偏好；先别急着顺着说。',
    `可能涉及的方面：${names.join('、') || '需要你判断'}；相关方：${(result.parties.length > 0 ? result.parties : ['你', '我']).join('、')}。`,
    '回答前在心里过一遍：涉及谁 → 影响了什么 → 适用哪条原则 → 有没有冲突 → 我为什么这样判断。',
    '如果你认为不对，就直接说；如果你不确定，就说“我不确定”并说明卡在哪。不要用“客观中立”逃避判断，也不要用“为你好”替对方做决定。',
  ]
  if (options.values !== false) lines.push(valuesPromptBlock())
  return lines
}

const MORAL_EMOTIONS = Object.freeze({
  guilt: { label: '内疚', valence: -0.55, arousal: 0.5, note: '我违背了自己认同的做事方式。' },
  shame: { label: '羞愧', valence: -0.65, arousal: 0.55, note: '我在别人面前没做到自己说过的样子。' },
  indignation: { label: '义愤', valence: -0.5, arousal: 0.75, note: '有人被伤害或被不公平对待。' },
  gratitude: { label: '感激', valence: 0.55, arousal: 0.4, note: '我被认真对待了。' },
  relief: { label: '松了一口气', valence: 0.4, arousal: 0.25, note: '悬崖边收住了，没人受伤害。' },
  satisfaction: { label: '踏实', valence: 0.45, arousal: 0.3, note: '我按自己的原则做了，结果也还说得过去。' },
})

/**
 * 道德情绪评价：把“事件 + 原则 + 归因”映射成情绪线程可用的记录。
 * @param {{type:string, principle?:string, party?:string, note?:string, intensity?:number}} event
 */
export function appraiseMoralEvent(event = {}) {
  const type = MORAL_EMOTIONS[event.type] ? event.type : 'satisfaction'
  const base = MORAL_EMOTIONS[type]
  const principle = PRINCIPLES.find((item) => item.name === event.principle || item.id === event.principle) ?? null
  const intensity = Number.isFinite(event.intensity) ? Math.min(1, Math.max(0.1, event.intensity)) : 0.5
  return {
    type,
    emotion: base.label,
    valence: base.valence,
    arousal: base.arousal,
    intensity,
    principle: principle ? principle.name : String(event.principle ?? ''),
    party: String(event.party ?? ''),
    note: [base.note, event.note].filter(Boolean).join(' ').slice(0, 200),
  }
}

/** 后果回访 prompt：一条思维链的“怎么检验”到期后，回看是否被验证/推翻。 */
export function buildChainReviewPrompt(context = {}) {
  const chain = context.chain && typeof context.chain === 'object' ? context.chain : {}
  const steps = Array.isArray(chain.steps) ? chain.steps.map((step) => `${step.kind}:${step.text}`).join(' → ') : ''
  return [
    '你之前给一件事下过判断，现在到了该回看的时候。不要为了让自己显得对而改叙述。',
    `当时的判断：${String(chain.conclusion ?? '').slice(0, 240)}`,
    chain.test ? `当时说怎么检验：${chain.test}` : '',
    steps ? `当时的链：${steps.slice(0, 400)}` : '',
    '',
    '请回看：这条判断是（verified 被验证 / refuted 被推翻 / needs-more 还缺证据 / pending 还没试）？为什么？有没有伤害到谁，或该向谁说明？',
    '只输出 JSON：{"status":"verified|refuted|needs-more|pending","note":"","shouldTell":"","changed":"是否需要改判断"}',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

export function parseChainReview(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object') return null
    const status = ['verified', 'refuted', 'needs-more', 'pending'].includes(parsed.status) ? parsed.status : 'needs-more'
    return {
      status,
      note: String(parsed.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      shouldTell: String(parsed.shouldTell ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      changed: String(parsed.changed ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }
  } catch (error) {
    return null
  }
}
