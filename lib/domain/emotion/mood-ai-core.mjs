// lib/mood-ai.mjs —— 模型自主决定心情 + 配图（契约 v1.9 §2.12，M13a）。
//
// v0.2.7：图鉴/时间/常量拆到 mood-ai-shared.mjs；本文件保留 prompt 构建与结果解析，
// 并 re-export shared，保持原有 import 兼容。
import { naturalStyleLines } from '../voice/index.mjs'
import { formatAffectLines } from './affect-homeostasis.mjs'
import { formatBeingLine } from '../being/index.mjs'
import {
  MOOD_AI_SYSTEM_PROMPT,
  MOOD_LABEL_MAX_CHARS,
  MOOD_REASON_MAX_CHARS,
  MOOD_RECENT_MAX,
  MOOD_RECENT_LABELS_MAX,
  MOOD_ZH,
  buildCatalogImageIndex,
  charLength,
  isPlainObject,
  isWhenActive,
  moodDayPeriod,
  normalizeMoodCatalog,
  resolveCatalogImageFile,
  resolveFestivalAvailability,
  resolveMoodCandidates,
  sanitizeInline,
  shanghaiDateKey,
  shanghaiParts,
} from './mood-ai-shared.mjs'

export * from './mood-ai-shared.mjs'

export function buildMoodPrompt(context = {}, catalog, options = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const plan = isPlainObject(options?.plan) ? options.plan : resolveMoodCandidates(catalog, ctx.recentImages, options)
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const parts = shanghaiParts(nowMs)
  const lines = []

  lines.push(`现在是 ${parts.timeText}（${moodDayPeriod(nowMs)}，Asia/Shanghai），你在 DSH Web 的角落陪着用户。`)

  const weather = sanitizeInline(typeof ctx.weather === 'string' ? ctx.weather : '', 40)
  if (weather.length > 0) lines.push(`当前天气：${weather}。`)

  const moodKey = sanitizeInline(typeof ctx.moodKey === 'string' ? ctx.moodKey : '', 32)
  if (moodKey.length > 0) {
    const label = MOOD_ZH[moodKey] ?? ''
    lines.push(`客户端启发式心情（仅供参考，可能不准，你要自己判断）：${label ? `${moodKey}（${label}）` : moodKey}。`)
  }

  // v1.58：不再注入任何对话/会话聚合数据——她的情境只来自天气、时间、她自己的状态与记忆。
  if (isPlainObject(ctx.selfState)) {
    lines.push(formatBeingLine(ctx.selfState))
  }

  // v1.50：她自己造过的感受词——可以当作 label 候选，配图仍在图鉴里选最接近的。
  const customFeelings = []
  if (Array.isArray(ctx.customFeelings)) {
    for (const item of ctx.customFeelings) {
      if (item === null || typeof item !== 'object') continue
      const name = sanitizeInline(typeof item.name === 'string' ? item.name : '', 10)
      const description = sanitizeInline(typeof item.description === 'string' ? item.description : '', 60)
      if (name.length === 0 || description.length === 0) continue
      if (customFeelings.some((entry) => entry.name === name)) continue
      customFeelings.push({ name, description })
      if (customFeelings.length >= 10) break
    }
  }
  if (customFeelings.length > 0) {
    lines.push('你自己造过的感受词（如果此刻正好是其中一种，可以直接拿它当 label；配图选最接近的动画/图片；不要为了用而用）：')
    for (const feeling of customFeelings) lines.push(`- ${feeling.name}：${feeling.description}`)
  }

  const recent = Array.isArray(ctx.recent) ? ctx.recent : []
  const recentLines = []
  for (const entry of recent.slice(0, MOOD_RECENT_MAX)) {
    const text = sanitizeInline(typeof entry === 'string' ? entry : '', 80)
    if (text.length > 0 && !recentLines.includes(text)) recentLines.push(text)
  }
  if (recentLines.length > 0) {
    lines.push('你最近的自言自语（可参考语气，但不要在这里重复）：')
    for (const text of recentLines) lines.push(`- ${text}`)
  }

  // v2.67：读过的材料可以作为心情来源之一（读不懂的闷、突然通一点的亮、被一句话顶住），但不硬挂。
  // v3.15：底层情绪状态（内生）——先于 label 选择；不是规则，是状态。
  if (ctx.affect) lines.push(...formatAffectLines(ctx.affect))

  const readings = []
  if (Array.isArray(ctx.readings)) {
    for (const item of ctx.readings) {
      const text = sanitizeInline(typeof item === 'string' ? item : '', 120)
      if (text.length > 0 && !readings.includes(text)) readings.push(text)
      if (readings.length >= 3) break
    }
  }
  if (readings.length > 0) {
    lines.push('你最近读到/学到的（只是可能的来源，不用硬挂到心情上）：')
    for (const text of readings) lines.push(`- ${text}`)
    lines.push('如果此刻心情确实落在读的东西上（读不懂的闷、突然通一点的亮、被一句话顶住、一种被点名的感觉），就让 label 从这儿长；如果没有，就不要为了显得读过而提。')
  }

  if (plan.recentList.length > 0) {
    const note = plan.usedFallback
      ? '（图鉴条目不足，最近图仍完整列出，但请优先选其它没出现的）'
      : '（已从下面的图鉴列表中移除，不要凭记忆选它们）'
    lines.push(`最近用过的图片${note}：`)
    for (const entry of plan.recentList) lines.push(`- ${entry.raw}`)
  }

  // v1.48：最近生成过的心情标签——只反重复**主题/说法**，不禁止相似情境下表达相近情绪。
  const recentLabels = []
  if (Array.isArray(ctx.recentMoodLabels)) {
    for (const item of ctx.recentMoodLabels) {
      const label = sanitizeInline(typeof item === 'string' ? item : '', 24)
      if (label.length > 0 && !recentLabels.includes(label)) recentLabels.push(label)
    }
  }
  const recentLabelList = recentLabels.slice(-MOOD_RECENT_LABELS_MAX)
  if (recentLabelList.length > 0) {
    lines.push(
      '你最近生成过的心情标签（不要把同一主题换个形容词再说一遍；如果此刻情境确实相似，换一个更具体的角度：一个小动作、一个细节、一个念头）：',
    )
    for (const label of recentLabelList) lines.push(`- ${label}`)
    lines.push(
      '尤其避免重复「饿/馋、困/累、松弛/放空/发呆」这几类已经用过的主题，除非此刻确实发生了新的事；换角度比换词重要。',
    )
  }

  const { available, unavailable } = resolveFestivalAvailability(catalog, parts.dateKey)
  if (available.length > 0) {
    lines.push('今天可用的节日图（只有这样节日图可以选）：')
    for (const image of available) lines.push(`- ${image.file}｜${image.label}`)
  } else {
    lines.push('今天没有可用的节日图（任何 when 不为空的节日图今天都不能选）。')
  }
  if (unavailable.length > 0) {
    lines.push(`今天不可用的节日图（不要选）：${unavailable.map((image) => image.file).join('、')}`)
  }

  lines.push(
    `心情图鉴（已打乱顺序；file｜label｜tags｜media｜when，只能从这些 file 里选一个；media=video 是透明动画，image 是静态图；共 ${plan.candidates.length} 个候选）：`,
  )
  for (const image of plan.candidates) {
    const tags = Array.isArray(image.tags) && image.tags.length > 0 ? image.tags.join(',') : '-'
    const when = typeof image.when === 'string' ? image.when : '-'
    const media = image.media === 'video' ? 'video' : 'image'
    lines.push(`${image.file}｜${image.label || '-'}｜${tags}｜${media}｜${when}`)
  }

  lines.push(
    '**优先从 media=video 的动画里选**（它们能让挂件活起来）；静态 image 只在特别贴合时才用。',
  )
  lines.push(
    '不要连续选同一张图或同一个动作；忙碌、等待、开心、吃货、困、节庆等不同情境，尽量换不同 tag 的动作，而不是反复用 waiting/idle/melt 这类图。',
  )
  lines.push(
    '请根据以上真实情境，自己判断你此刻的心情（不是随机抽图，理由必须来自上面的情境），从图鉴里选 1 个最贴切的（优先动画）。',
  )
  lines.push(
    'label 用日常会说的情绪/身体状态词，2–6 个字，像随口说“有点烦”“困了”“心里空”“踏实了点”“没劲”“坐不住”“说不上来”。',
    '不要用动作或画面写心情：不要写“悬着没动”“赖着没动”“搭在桌沿”“纸上年份打结”“行间悬停”这种短语；label 里至少得有一个真正的感受词。',
  )
  lines.push('只输出一个 JSON 对象，例如：{"label":"有点累但满足","image":"dsh-whale-state-daily-done.webp","reason":"今天完成了很多事，所以虽然累但很踏实","energy":35}')
  // v1.61：去 AI 味——label 短、reason 只写一两件具体的事，不解释、不排比。
  lines.push(
    ...naturalStyleLines([
      'label 用 2–6 个字，像人随口说心情，不写微散文。',
      'reason 写你为什么是这个心情（1 句，可以带情绪词：烦、开心、舍不得、委屈、没劲）；不要只报看见的事，细节最多一个；别比喻，别写「因为……所以……」，也别总结或拔高。',
    ]),
  )
  return lines.join('\n')
}

/** 从模型输出里提取一个 JSON 对象（容错 markdown code fence / 前后废话）。 */
function extractJsonObject(text) {
  let body = typeof text === 'string' ? text.trim() : ''
  if (body.length === 0) return null
  body = body
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const attempts = [body]
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(body.slice(first, last + 1))
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* try next */
    }
  }
  return null
}

function cleanTextField(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[「『“"‘']+|[」』”"’']+$/gu, '')
    .replace(/^[。！？；.!?;，,、：:]+/u, '')
    .replace(/[。！？；.!?;，,、：:]+$/u, '')
    .trim()
}

/**
 * 解析并校验模型的 JSON 心情结果（纯函数）。
 * 校验：image 必须在图鉴 moodImages 内；节日图 when 必须命中当天；label 1–12 字；
 * reason 1–40 字；energy 若提供必须是 0–100 的整数。
 * @param {string} text
 * @param {ReturnType<typeof normalizeMoodCatalog>} catalog
 * @param {{now?: number, dateKey?: string, excludedImages?: Set<string>|string[]}} [options] - excludedImages 仅保留参数兼容，不再参与失败判定（v1.28 起排除是软建议）
 * @returns {{ok:true, mood:{label:string,image:string,reason:string,energy?:number}} | {ok:false, message:string}}
 */
export function parseMoodResult(text, catalog, options = {}) {
  if (catalog === null || typeof catalog !== 'object' || !(catalog.files instanceof Set)) {
    return { ok: false, message: '心情图鉴不可用' }
  }
  const raw = extractJsonObject(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }

  if (typeof raw.image !== 'string' || raw.image.trim().length === 0) return { ok: false, message: '缺少图片文件名' }
  // 图鉴里的 file 可能是静态图片文件名，也可能是 `webm/<名>.webm`（M18 动画素材）：
  // 用完整 file / basename→完整 file 映射解析（M24：兼容模型漏写或只写 basename 的情况）。
  const imageIndex = buildCatalogImageIndex(catalog)
  const image = resolveCatalogImageFile(raw.image, imageIndex)
  if (image === null) return { ok: false, message: `图片不在图鉴内：${raw.image.trim()}` }
  const imageEntry = catalog.moodImages.find((item) => item.file === image)
  if (imageEntry === undefined) return { ok: false, message: `图片不在图鉴内：${image}` }
  // v1.21/M28：`excludedImages` 只用于 prompt 多样性引导（软建议），不再硬拒绝。
  // 模型返回的图只要在图鉴内就成功——即使它正好在「最近用过」列表里，
  // 否则体验/情绪明确要求某张图时会误判失败、客户端回退本地心情。

  const dateKey =
    typeof options.dateKey === 'string' && options.dateKey.length >= 10
      ? options.dateKey
      : shanghaiDateKey(typeof options.now === 'number' ? options.now : Date.now())
  if (typeof imageEntry.when === 'string' && !isWhenActive(imageEntry.when, dateKey)) {
    return { ok: false, message: `节日图「${image}」只在 ${imageEntry.when} 可用` }
  }

  const label = cleanTextField(raw.label)
  if (label.length === 0) return { ok: false, message: '缺少心情标签' }
  if (charLength(label) > MOOD_LABEL_MAX_CHARS) return { ok: false, message: `心情标签超过 ${MOOD_LABEL_MAX_CHARS} 字` }

  const reason = cleanTextField(raw.reason)
  if (reason.length === 0) return { ok: false, message: '缺少心情理由' }
  if (charLength(reason) > MOOD_REASON_MAX_CHARS) return { ok: false, message: `心情理由超过 ${MOOD_REASON_MAX_CHARS} 字` }

  const mood = { label, image, reason }
  if (raw.energy !== undefined && raw.energy !== null) {
    const energy = typeof raw.energy === 'string' ? Number(raw.energy) : raw.energy
    if (typeof energy !== 'number' || !Number.isFinite(energy) || energy < 0 || energy > 100) {
      return { ok: false, message: 'energy 必须是 0–100 的数字' }
    }
    mood.energy = Math.round(energy)
  }
  return { ok: true, mood }
}

function makeTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(timeoutMs)
    } catch {
      /* fallthrough */
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  }, timeoutMs)
  timer.unref?.()
  return controller.signal
}

function isTimeoutError(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.code === 'MOOD_AI_TIMEOUT') return true
  const name = String(error.name ?? '')
  return name === 'TimeoutError' || name === 'AbortError' || /超时|abort/i.test(String(error.message ?? ''))
}

export function normalizeSelection(raw) {
  if (!isPlainObject(raw)) return null
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return null
  return { provider, model }
}

export function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建模型心情服务。
 * @param {{
 *   llm?: object|((() => object|undefined|null))|null,
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string}|null|undefined,
 *   catalog?: ReturnType<typeof normalizeMoodCatalog>|null,
 *   logger?: {warn?: Function}|null,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   cacheTtlMs?: number,
 *   minIntervalMs?: number,
 *   random?: () => number,
 *   policy?: object|Function|null,
 *   modelErrorsPath?: string|null,
 *   feelings?: object|{recent?: Function, read?: Function}|null,
 * }} [options]
 */
