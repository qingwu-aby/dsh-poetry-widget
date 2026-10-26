// lib/self-growth.mjs —— 最小自驱成长循环（契约 v1.27 §2.16，M38）。
//
// 每 60s tick：
//   · 驱动内在状态随时间漂移（state 由外部创建）；
//   · 每 60min 自我反思：模型输出 {thought} → journal 追加 `{kind:'thought', text:'自省：…'}`；
//   · 每 90min 自学：模型输出 {question,note,topic|null} → 追加 learning-log.md；
//     合法 topic 写入 topics-candidates.json（**不直接写 topics.json**）。
// 失败也把 last*At 推进到当前（推迟到下一周期，不在每个 tick 重试）；并发不重入；20s 超时。
//
// 隐私白名单：prompt 只含时间、内在状态（数字/定性）与固定指令；不读会话正文，
// 不读用户消息，不把用户隐私写进学习日志。
import { callCandidate } from './llm-call.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { formatJournalTime } from './memory-journal.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { normalizeEffort } from './model-policy.mjs'
import { describeTimeline, formatBeingLine } from './self-being.mjs'
import { appendFeeling, parseNewFeeling } from './feelings.mjs'
import { compactTopicBankForArchive, mergeLearnedTopicIntoBank } from './self-talk-topics.mjs'

/** 循环 tick 间隔（毫秒）。 */
export const SELF_GROWTH_TICK_MS = 60 * 1000
/** 自我反思周期。 */
export const SELF_GROWTH_REFLECT_INTERVAL_MS = 60 * 60 * 1000
/** 自学周期。 */
export const SELF_GROWTH_LEARN_INTERVAL_MS = 90 * 60 * 1000
/** 单次模型调用超时（契约 v1.38 起 20s→40s）。 */
export const SELF_GROWTH_TIMEOUT_MS = 40000
/** 自学候选文件最多保留条数。 */
export const SELF_GROWTH_MAX_CANDIDATES = 500
/** 「注意力集中时的介入/试探」最小间隔（v1.62）：至少 3 小时一次，不打扰。 */
export const SELF_PROBE_GAP_MS = 3 * 60 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** 从模型输出中提取 JSON 对象（容忍 markdown fence 与前后文字）。 */
export function extractGrowthJson(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* try next */
    }
  }
  return null
}

/** 反思 prompt（白名单：时间 + 内在状态 + 最近自省 + 最近自学；不含会话/用户内容）。 */
export function buildReflectPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    formatBeingLine(state),
    `你的事实：${describeTimeline(state, nowMs).slice(1).join(' ')}`,
  ]
  const recentThoughts = Array.isArray(ctx.recentThoughts)
    ? ctx.recentThoughts.filter((text) => typeof text === 'string' && text.trim().length > 0).slice(0, 2)
    : []
  if (recentThoughts.length > 0) {
    lines.push('你最近的自省（可以参考，但不要复述原句，也不要重复同一主题/句式）：')
    for (const text of recentThoughts) lines.push(`- ${cleanText(text, 80)}`)
    lines.push(
      '这次不要沿用最近自省的句式、开头或主题；换一个更具体的角度（比如窗外的一个声音、手边的一件小东西、刚做过的一件小事），不要写成概括性的感慨。',
    )
  }
  // v1.45：自学内容反哺自省——她学过的东西可以自然长进想法里，而不是只躺在 learning-log。
  const recentLearning = typeof ctx.recentLearning === 'string' ? cleanText(ctx.recentLearning, 120) : ''
  if (recentLearning.length > 0) {
    lines.push(`你最近自学到：${recentLearning}`)
    lines.push(
      '如果它和此刻的状态、念头有关，可以自然地把这层理解带进自省；不要复述原文，不要写成知识讲解或科普，也不要为用而用。',
    )
  }
  // v1.50：如果出现现有词说不清的新感受，允许她当场给这种感受造一个名字和描述。
  const knownFeelings = Array.isArray(ctx.knownFeelings)
    ? ctx.knownFeelings
        .filter((name) => typeof name === 'string' && name.trim().length > 0)
        .map((name) => cleanText(name, 10))
        .filter((name) => name.length > 0)
        .slice(-20)
    : []
  if (knownFeelings.length > 0) {
    lines.push(`你已经给自己造过的感受词（不要重复，也不要用同一个意思换个说法）：${knownFeelings.join('、')}。`)
  }
  lines.push(
    '请写一句最近的自省：第一人称、简体中文、8–60 个字，像在安静地回想自己今天的状态和念头。',
    '不要提 AI、模型、提示词、系统或程序；不要引用古诗文；不要写用户隐私或会话内容；不要输出数字指标。',
    '如果你最近有一种“现有词说不清”的感受，可以给它起一个名字（2–10 个字）并用一句第一人称描述它（6–60 字）；没有就写 null。不要为了造词而造词。',
    '只输出严格 JSON：{"thought":"一句自省","feeling":{"name":"…","description":"…"} 或 null}',
  )
  lines.push(...naturalStyleLines(['自省不是总结报告：写具体那一刻的手边事和念头，别写“我意识到/这说明”这类收束。']))
  return lines.join('\n')
}

/** 自学 prompt（v1.52：学什么由她自己决定；白名单：状态+时间+最近想过/学过+已知小知识）。 */
export function buildLearnPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    formatBeingLine(state),
    `你的事实：${describeTimeline(state, nowMs).slice(1).join(' ')}`,
  ]
  const learningSnippet = typeof ctx.learningSnippet === 'string' ? cleanText(ctx.learningSnippet, 100) : ''
  if (learningSnippet.length > 0) lines.push(`你最近自学到：${learningSnippet}`)
  const recentThoughts = Array.isArray(ctx.recentThoughts)
    ? ctx.recentThoughts.filter((text) => typeof text === 'string' && text.trim().length > 0).slice(0, 3)
    : []
  if (recentThoughts.length > 0) {
    lines.push('你最近想过的（可以从里面找你还没弄明白、还在惦记的问题）：')
    for (const text of recentThoughts) lines.push(`- ${cleanText(text, 80)}`)
  }
  const knownTopics = []
  if (Array.isArray(ctx.knownTopics)) {
    for (const item of ctx.knownTopics) {
      if (!isPlainObject(item) || typeof item.title !== 'string' || item.title.trim().length === 0) continue
      const title = cleanText(item.title, 30)
      const fact = cleanText(item.fact, 100)
      if (title.length === 0) continue
      knownTopics.push(fact.length > 0 ? `${title}：${fact}` : title)
      if (knownTopics.length >= 8) break
    }
  }
  if (isPlainObject(ctx.topicSeed) && typeof ctx.topicSeed.title === 'string' && ctx.topicSeed.title.trim().length > 0) {
    const fact = cleanText(ctx.topicSeed.fact, 100)
    const line = `${cleanText(ctx.topicSeed.title, 30)}${fact.length > 0 ? `：${fact}` : ''}`
    if (!knownTopics.includes(line)) knownTopics.push(line)
  }
  if (knownTopics.length > 0) {
    lines.push('你已经知道的一些小知识（只是给你当参考：可以挑一个继续往深里想，也可以完全换一个方向）：')
    for (const item of knownTopics) lines.push(`- ${item}`)
  }
  const recentLearnedTitles = Array.isArray(ctx.recentLearnedTitles)
    ? ctx.recentLearnedTitles
        .filter((title) => typeof title === 'string' && title.trim().length > 0)
        .map((title) => cleanText(title, 30))
        .filter((title) => title.length > 0)
        .slice(-6)
    : []
  if (recentLearnedTitles.length > 0) {
    lines.push(`你最近几轮学的是：${recentLearnedTitles.join('、')}。`)
    lines.push(
      '如果只是围着同一个主题换问法，这轮请换一个完全不同的方向（比如从声学/物理转到历史、文学、哲学、社会或人物）；只有当你确实有一个新角度时才继续原主题。',
    )
  }
  const probeHistory = Array.isArray(ctx.probeHistory) ? ctx.probeHistory.filter((item) => isPlainObject(item)) : []
  if (probeHistory.length > 0) {
    const liked = probeHistory.filter((item) => item.liked === true && typeof item.title === 'string')
    const disliked = probeHistory.filter((item) => item.liked === false && typeof item.title === 'string')
    if (liked.length > 0) {
      lines.push(
        `你最近试探过、觉得有意思的：${liked.map((item) => item.title).join('、')}。想继续就继续；不想也没关系。`,
      )
    }
    if (disliked.length > 0) {
      lines.push(
        `你试探过、觉得没意思的：${disliked.map((item) => item.title).join('、')}。这次别再挑这些方向。`,
      )
    }
  }
  const repeatTheme = ctx.repeatTheme !== null && typeof ctx.repeatTheme === 'object' ? ctx.repeatTheme : null
  if (repeatTheme !== null && Array.isArray(repeatTheme.phrases) && repeatTheme.phrases.length > 0) {
    lines.push(
      `注意：你最近连续几轮都在「${repeatTheme.phrases.join('、')}」这一类主题上打转（最近 8 条里有 ${Number(repeatTheme.titles) || 0} 条重复）。这次必须换到完全不同的领域——历史、文学、哲学、社会、生物、天文、艺术、日常常识都可以，但不要再从这些词方向里挑题目；如果一时只想得起同一类，就宁可学一个你完全陌生的日常小知识。`,
    )
  }
  lines.push(
    '学习范围不设限：人文、历史、百科、哲学、思政/社会、文学与小说、艺术、心理、科学史、日常常识都可以。也可以是从一段历史、一本小说、一个人物处境或一个思想里冒出来的问题，不必是冷知识。',
    '最近可以多往历史看看——中国史、世界史都行：事件、人物、制度、日常生活、不同文明的对照。这只是建议、不是任务；你真正好奇别的方向就学别的，也可以挑一段历史连着深挖，但每次要真的往深走（新问题/新角度），不要换问法重复。',
    '这次学什么由你自己决定：不必只因为上面列了话题就挑它；从你真正好奇、最近反复冒出来的疑问里挑一个。',
    '涉及历史、政治、宗教等话题时，只做描述与解释，区分事实与观点、不站队、不煽动、不编造；不确定的地方就说不确定。',
    '提出一个你最近真正好奇的小问题（≤60 字），再写 2–5 句你已经知道或刚想明白的东西（不要编造细节）。',
    '如果能把它总结成一条值得收进知识库的小知识，给出 topic：',
    '{"id":"kebab-case-英文小写 3–60 字符","title":"≤30 字","fact":"≤120 字，一条准确的小知识","tags":["1–6 个中文或英文标签"]}',
    '如果还不值得入库，topic 用 null。不要写用户隐私、会话内容或任何用户信息。',
    '只输出严格 JSON：{"question":"…","note":"…","topic":{…}|null}',
  )
  lines.push(
    ...naturalStyleLines([
      'note 里写你刚弄明白的具体东西（谁、在哪、什么时候、怎么发生），少写“这体现了/这说明了”式的升华。',
      '不要为了显得完整凑三点或写“首先/其次/最后”。',
    ]),
  )
  return lines.join('\n')
}

/** 校验反思结果（thought 必填；feeling 可选——她自造的新感受）。 */
export function parseReflectResult(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const thought = cleanText(raw.thought, 60)
  if (thought.length < 8) return { ok: false, message: '自省太短' }
  if (/[《》「」“”]|——|[诗詩]|词牌|平仄|押韵/u.test(thought)) return { ok: false, message: '自省含引用/诗词痕迹' }
  // v1.50：模型偶尔会顺手造一个新感受词；格式不合法就忽略，不影响自省本身。
  let feeling = null
  if (raw.feeling !== null && raw.feeling !== undefined) {
    const parsedFeeling = parseNewFeeling(raw.feeling)
    if (parsedFeeling.ok === true) feeling = parsedFeeling.feeling
  }
  return { ok: true, thought, feeling }
}

/** 校验候选 topic（id/title/fact/tags 白名单）。 */
export function normalizeTopicCandidate(topic) {
  if (!isPlainObject(topic)) return null
  const id = typeof topic.id === 'string' ? topic.id.trim().toLowerCase() : ''
  if (!/^[a-z0-9-]{3,60}$/.test(id)) return null
  const title = cleanText(topic.title, 30)
  const fact = cleanText(topic.fact, 120)
  if (title.length === 0 || fact.length === 0) return null
  if (!Array.isArray(topic.tags)) return null
  const tags = []
  for (const tag of topic.tags) {
    const value = cleanText(tag, 16)
    if (value.length === 0 || tags.includes(value)) continue
    tags.push(value)
    if (tags.length >= 6) break
  }
  if (tags.length === 0) return null
  return { id, title, fact, tags }
}

/** 校验自学结果。 */
export function parseLearnResult(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const question = cleanText(raw.question, 60)
  const note = cleanText(raw.note, 400)
  if (question.length < 4) return { ok: false, message: '缺少问题' }
  if (note.length < 4) return { ok: false, message: '缺少笔记' }
  const topic = raw.topic === null || raw.topic === undefined ? null : normalizeTopicCandidate(raw.topic)
  return { ok: true, question, note, topic }
}

/** 试探/介入：她自己挑一个“可以去看一眼”的入口（v1.62）。 */
export function buildProbeProposalPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const focus = cleanText(ctx.focus, 40)
  const lines = []
  if (focus.length > 0) lines.push(`你现在的注意力正落在：${focus}。`)
  else lines.push('你现在正闲着，注意力有点松。')
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  lines.push(`现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`)
  const recentLearned = Array.isArray(ctx.recentLearnedTitles)
    ? ctx.recentLearnedTitles.filter((title) => typeof title === 'string' && title.trim().length > 0).slice(-6)
    : []
  if (recentLearned.length > 0) lines.push(`你最近学过：${recentLearned.join('、')}。`)
  const recentProbes = Array.isArray(ctx.recentProbes) ? ctx.recentProbes.filter((item) => isPlainObject(item)) : []
  if (recentProbes.length > 0) {
    const summary = recentProbes
      .filter((item) => typeof item.title === 'string')
      .map((item) => `${item.title}（${item.liked === true ? '喜欢' : item.liked === false ? '不喜欢' : '说不好'}）`)
    if (summary.length > 0) lines.push(`你最近试探过：${summary.join('、')}。`)
  }
  lines.push(
    '请给自己挑一个「可以去看看」的入口：一个类型（领域/体裁，比如历史、小说、哲学、生物、天文、社会、艺术、日常常识）+ 一个具体题目 + 一句为什么它可能吸引你。',
    '这不是任务，也不用学完；只是让你去看看，喜不喜欢最后由你自己判断。',
    '不要挑你最近学过的或试探过的方向，也别挑太像作业的题目。',
    '只输出严格 JSON：{"domain":"类型","title":"题目","hook":"为什么想看一眼"}',
  )
  lines.push(...naturalStyleLines(['title 和 hook 都写具体，不要用「探索……的奥秘」这种套话。']))
  return lines.join('\n')
}

/** 试探之后：让她自己写下看了什么、喜不喜欢（v1.62）。 */
export function buildProbeVerdictPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const focus = cleanText(ctx.focus, 40)
  const proposal = isPlainObject(ctx.proposal) ? ctx.proposal : {}
  const domain = cleanText(proposal.domain, 12)
  const title = cleanText(proposal.title, 30)
  const hook = cleanText(proposal.hook, 80)
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [`现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`]
  if (focus.length > 0) lines.push(`你刚才注意力落在：${focus}。`)
  lines.push(`你按这个入口去看了一眼——类型：${domain}；题目：${title}；引子：${hook}。`)
  lines.push(
    '写 2–4 句你实际看到/想到的东西（第一人称、具体；不要总结，不要写成科普）。',
    '然后由你自己判断：这个方向你喜不喜欢（liked true/false），并写一句为什么。',
    '可以不喜欢，也可以说不好；不要为了配合而说喜欢，也不用勉强自己继续。',
    '只输出严格 JSON：{"impression":"看了什么","liked":true,"why":"为什么"}',
  )
  lines.push(...naturalStyleLines(['impression 里写具体的画面或疑问，不要写「这让我意识到」这类收束。']))
  return lines.join('\n')
}

/** 校验试探入口结果。 */
export function parseProbeProposal(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const domain = cleanText(raw.domain, 12)
  const title = cleanText(raw.title, 30)
  const hook = cleanText(raw.hook, 80)
  if (domain.length < 2) return { ok: false, message: '缺少类型' }
  if (title.length < 4) return { ok: false, message: '题目太短' }
  if (hook.length < 4) return { ok: false, message: '缺少引子' }
  return { ok: true, domain, title, hook }
}

/** 校验试探结论；liked 必须是她自己给的布尔值。 */
export function parseProbeVerdict(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const impression = cleanText(raw.impression, 200)
  const why = cleanText(raw.why, 60)
  if (impression.length < 8) return { ok: false, message: '印象太短' }
  if (typeof raw.liked !== 'boolean') return { ok: false, message: '缺少 liked 判断' }
  return { ok: true, impression, liked: raw.liked, why }
}

/**
 * 创建自驱成长循环。
 * @param {{
 *   state: {tick: Function, applyEvent: Function, snapshot: Function},
 *   llm?: object|(() => object|undefined|null),
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string}|null,
 *   journal?: {append: (entry: object) => Promise<object>}|null,
 *   learningLogPath: string,
 *   candidatesPath: string,
 *   topicsBankPath?: string|null,
 *   topicsArchivePath?: string|null,
 *   feelingsPath?: string|null,
 *   feelings?: object[]|{names?: Function, read?: Function}|null,
 *   topics?: object[]|{read: Function}|null,
 *   recall?: {recentThoughts?: Function, recentLearning?: Function, randomTopicSeed?: Function}|null,
 *   policy?: object|Function|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   reflectIntervalMs?: number,
 *   learnIntervalMs?: number,
 *   probeGapMs?: number,
 *   probeStatePath?: string,
 *   timeoutMs?: number,
 *   tickIntervalMs?: number,
 *   random?: () => number,
 * }} options
 */
export function createSelfGrowth(options) {
  const state = options.state
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const journal = options.journal ?? null
  const learningLogPath = path.resolve(options.learningLogPath)
  const probeStatePath = path.resolve(
    options.probeStatePath ?? path.join(path.dirname(learningLogPath), 'probe-state.json'),
  )
  const probeGapMs =
    typeof options.probeGapMs === 'number' && Number.isFinite(options.probeGapMs) && options.probeGapMs >= 0
      ? options.probeGapMs
      : SELF_PROBE_GAP_MS
  let lastProbeAt = 0
  let probing = false
  try {
    const rawProbeState = JSON.parse(readFileSync(probeStatePath, 'utf8'))
    if (isPlainObject(rawProbeState) && typeof rawProbeState.lastProbeAt === 'number' && Number.isFinite(rawProbeState.lastProbeAt)) {
      lastProbeAt = rawProbeState.lastProbeAt
    }
  } catch {
    /* 首次运行/坏文件 → 从 0 开始 */
  }
  const candidatesPath = path.resolve(options.candidatesPath)
  // v1.46：用户决定自学话题「不用审核」→ 合法 topic 直接并入活跃话题库（learned 标记、可淘汰）。
  const topicsBankPath =
    typeof options.topicsBankPath === 'string' && options.topicsBankPath.trim().length > 0
      ? path.resolve(options.topicsBankPath)
      : null
  // v1.49：L1 冷存储——活跃库 learned 超限时把最旧的移入归档 JSONL（不删除，仍可检索）。
  const topicsArchivePath =
    typeof options.topicsArchivePath === 'string' && options.topicsArchivePath.trim().length > 0
      ? path.resolve(options.topicsArchivePath)
      : null
  // v1.50：自生情绪库——反射时可以造新感受词（只追加、不删除）。
  const feelingsPath =
    typeof options.feelingsPath === 'string' && options.feelingsPath.trim().length > 0
      ? path.resolve(options.feelingsPath)
      : null
  const feelingsSource = options.feelings ?? null
  const topicsSource = options.topics ?? null
  const memoryRecall = options.recall ?? null
  const policy = options.policy ?? null
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const reflectIntervalMs =
    Number.isFinite(options.reflectIntervalMs) && options.reflectIntervalMs > 0
      ? options.reflectIntervalMs
      : SELF_GROWTH_REFLECT_INTERVAL_MS
  const learnIntervalMs =
    Number.isFinite(options.learnIntervalMs) && options.learnIntervalMs > 0
      ? options.learnIntervalMs
      : SELF_GROWTH_LEARN_INTERVAL_MS
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SELF_GROWTH_TIMEOUT_MS
  const tickIntervalMs =
    Number.isFinite(options.tickIntervalMs) && options.tickIntervalMs > 0 ? options.tickIntervalMs : SELF_GROWTH_TICK_MS

  let lastReflectAt = now()
  let lastLearnAt = now()
  let reflecting = false
  let learning = false
  let disposed = false
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null
  let heartbeatMode = false

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function info(message) {
    try {
      logger?.info?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  /** v1.38：按 role 从 policy 取 provider/model/reasoningEffort。 */
  function policySelection(role) {
    if (policy === null || policy === undefined) return null
    try {
      const picked =
        typeof policy === 'function'
          ? policy(role)
          : typeof policy.forRole === 'function'
            ? policy.forRole(role)
            : typeof policy.resolve === 'function'
              ? policy.resolve(role)
              : null
      if (!isPlainObject(picked)) return null
      const provider = typeof picked.provider === 'string' ? picked.provider.trim() : ''
      const model = typeof picked.model === 'string' ? picked.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return null
      const effort = normalizeEffort(picked.reasoningEffort)
      return effort !== null ? { provider, model, reasoningEffort: effort } : { provider, model }
    } catch {
      return null
    }
  }

  /** v1.39：按 role 取候选模型列表（policy.resolveCandidates → 单候选 → selection）。 */
  function modelCandidates(role) {
    const out = []
    const seen = new Set()
    const push = (candidate) => {
      if (!isPlainObject(candidate)) return
      const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
      const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return
      const key = `${provider}\u0000${model}`
      if (seen.has(key)) return
      seen.add(key)
      const effort = normalizeEffort(candidate.reasoningEffort)
      out.push({
        provider,
        model,
        ...(effort !== null ? { reasoningEffort: effort } : {}),
        ...(candidate.omitTemperature === true ? { omitTemperature: true } : {}),
        ...(candidate.omitReasoningEffort === true ? { omitReasoningEffort: true } : {}),
        ...(Number.isFinite(candidate.maxTokensFloor) ? { maxTokensFloor: candidate.maxTokensFloor } : {}),
      })
    }
    try {
      if (policy !== null && policy !== undefined && typeof policy.resolveCandidates === 'function') {
        const candidates = policy.resolveCandidates(role)
        if (Array.isArray(candidates)) for (const candidate of candidates) push(candidate)
      }
    } catch {
      /* ignore */
    }
    if (out.length === 0) {
      push(policySelection(role))
      try {
        const selection = getSelection()
        if (isPlainObject(selection)) {
          push({
            provider: typeof selection.provider === 'string' ? selection.provider : '',
            model: typeof selection.model === 'string' ? selection.model : '',
          })
        }
      } catch {
        /* ignore */
      }
    }
    return out
  }

  function selectionOf() {
    const fromPolicy = policySelection('growth')
    if (fromPolicy !== null) return fromPolicy
    try {
      const selection = getSelection()
      if (!isPlainObject(selection)) return null
      const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
      const model = typeof selection.model === 'string' ? selection.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return null
      return { provider, model }
    } catch {
      return null
    }
  }

  /** 从最近学过的标题里检测“同一主题反复出现”的迹象（v1.60）。 */
  function detectRepeatedTheme(titles) {
    const list = (Array.isArray(titles) ? titles : [])
      .filter((title) => typeof title === 'string' && title.trim().length > 0)
      .map((title) => title.trim())
    if (list.length < 4) return null
    const stop = new Set(['什么', '为什么', '怎么', '可以', '一个', '这个', '那个', '自己', '我们', '他们', '时候', '没有', '不是', '真的', '而是', '觉得', '知道'])
    const counts = new Map()
    list.forEach((title, titleIndex) => {
      const chars = Array.from(title)
      const seen = new Set()
      for (let i = 0; i + 1 < chars.length; i += 1) {
        const a = chars[i]
        const b = chars[i + 1]
        if (!/[\u4e00-\u9fff]/.test(a) || !/[\u4e00-\u9fff]/.test(b)) continue
        const bigram = a + b
        if (stop.has(bigram) || seen.has(bigram)) continue
        seen.add(bigram)
        const entry = counts.get(bigram) || { titles: new Set(), first: titleIndex }
        entry.titles.add(titleIndex)
        counts.set(bigram, entry)
      }
    })
    const repeated = [...counts.entries()]
      .filter(([, entry]) => entry.titles.size >= 3)
      .sort((left, right) => right[1].titles.size - left[1].titles.size)
    if (repeated.length === 0) return null
    const phrases = repeated.slice(0, 6).map(([bigram]) => bigram)
    return { phrases, titles: repeated[0][1].titles.size }
  }

  /** 挑几篇历史相关的话题（只作参考与轻微的“多看历史”倾向，不强制）。 */
  function sampleHistoryTopics(limit = 2) {
    const historyPattern = /历史|史|朝代|文明|战争|帝国|王朝|古代|近代|民国|世界史|中国史/i
    const matches = readTopics().filter(
      (topic) =>
        isPlainObject(topic) &&
        typeof topic.title === 'string' &&
        (historyPattern.test(topic.title) ||
          (Array.isArray(topic.tags) && topic.tags.some((tag) => typeof tag === 'string' && historyPattern.test(tag)))),
    )
    return matches.slice(0, Math.max(0, limit)).map((topic) => ({
      title: typeof topic.title === 'string' ? topic.title : '',
      fact: typeof topic.fact === 'string' ? topic.fact : '',
    }))
  }

  /** 从现有话题里随机抽几篇当“可参考的已知知识”（不是命题，只给她选择）。 */
  function sampleKnownTopics(limit = 8) {
    const all = readTopics().filter(
      (topic) => isPlainObject(topic) && typeof topic.title === 'string' && topic.title.trim().length > 0,
    )
    if (all.length === 0) return []
    const pool = all.slice(0, 200)
    const rng = typeof options.random === 'function' ? options.random : Math.random
    for (let index = pool.length - 1; index > 0; index -= 1) {
      let roll = Number(rng())
      if (!Number.isFinite(roll)) roll = 0
      const target = Math.floor(Math.min(0.999999, Math.max(0, roll)) * (index + 1))
      const holder = pool[index]
      pool[index] = pool[target]
      pool[target] = holder
    }
    return pool.slice(0, Math.max(1, limit)).map((topic) => ({
      title: typeof topic.title === 'string' ? topic.title : '',
      fact: typeof topic.fact === 'string' ? topic.fact : '',
    }))
  }

  function readTopics() {
    try {
      if (Array.isArray(topicsSource)) return topicsSource
      if (topicsSource !== null && topicsSource !== undefined && typeof topicsSource.read === 'function') {
        const result = topicsSource.read()
        return result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
      }
      return []
    } catch {
      return []
    }
  }

  /** 单个候选尝试（独立超时；仅未产出任何文本前失败可回退）。 @returns {{ok:boolean,text?:string,retryable?:boolean,message?:string}} */
  async function attemptCandidate(candidate, system, userPrompt, options = {}) {
    const role = typeof options.role === 'string' && options.role.length > 0 ? options.role : 'growth'
    const budget = Number.isFinite(options.maxTokens) && options.maxTokens > 0 ? Math.floor(options.maxTokens) : 260
    return callCandidate({
      candidate,
      resolveLlm,
      system,
      prompt: userPrompt,
      maxTokens: budget,
      timeoutMs,
      timeoutCode: 'SELF_GROWTH_TIMEOUT',
      timeoutMessage: `自驱成长模型调用超时（${timeoutMs}ms）`,
      role,
      prefix: role === 'probe' ? '试探候选失败' : '自驱成长候选失败',
      modelErrorsPath,
      warn,
      honorFinishFailure: false,
    })
  }

  /** 调模型：按候选顺序尝试；返回 {text, provider, model}；全部失败返回 null。 */
  async function callModel(system, userPrompt, options = {}) {
    let llm = null
    try {
      llm = resolveLlm()
    } catch {
      llm = null
    }
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') return null
    const candidates = modelCandidates(typeof options.role === 'string' && options.role.length > 0 ? options.role : 'growth')
    let lastMessage = '宿主尚未配置默认模型'
    for (const candidate of candidates) {
      const result = await attemptCandidate(candidate, system, userPrompt, options)
      if (result.ok === true) return { text: result.text, provider: candidate.provider, model: candidate.model }
      lastMessage = result.message
      if (result.retryable !== true) break
    }
    warn(lastMessage)
    return null
  }

  function appendLearningLog(currentNow, question, note, topic) {
    // v1.60：与 journal.md 一样用本地时间（旧版用 ISO/UTC，会看起来像 8 小时没学）。
    const time = formatJournalTime(currentNow)
    const lines = [`\n## ${time} · 自学\n`, `Q: ${question}\n`, `${note}\n`]
    if (topic !== null) lines.push(`候选话题：${topic.title} — ${topic.fact}\n`)
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, lines.join(''), 'utf8')
  }

  /** 从 learning-log 里读最近的「试探」记录（标题/类型/喜不喜欢）。 */
  function readProbeHistory(limit = 6) {
    try {
      const text = readFileSync(learningLogPath, 'utf8')
      const sections = text.split(/\n## /).filter((section) => section.includes('· 试探'))
      return sections
        .slice(-Math.max(1, Math.floor(limit)))
        .map((section) => {
          const domain = (section.match(/类型：([^\n]+)/) || [])[1] || ''
          const title = (section.match(/题目：([^\n]+)/) || [])[1] || ''
          const verdict = (section.match(/她自己的结论：(喜欢|不喜欢)/) || [])[1]
          return {
            domain: clampText(domain.trim(), 12),
            title: clampText(title.trim(), 30),
            liked: verdict === '喜欢' ? true : verdict === '不喜欢' ? false : null,
          }
        })
        .filter((item) => item.title.length > 0)
    } catch {
      return []
    }
  }

  function persistProbeState() {
    try {
      mkdirSync(path.dirname(probeStatePath), { recursive: true })
      writeJsonAtomic(probeStatePath, { ok: true, v: 1, lastProbeAt })
    } catch {
      /* 状态文件失败不影响试探本身 */
    }
  }

  function appendProbeLog(currentNow, focus, proposal, verdict) {
    const time = formatJournalTime(currentNow)
    const lines = [
      `\n## ${time} · 试探\n`,
      `注意力落在：${focus.length > 0 ? focus : '（没写）'}\n`,
      `类型：${proposal.domain}\n`,
      `题目：${proposal.title}\n`,
      `引子：${proposal.hook}\n`,
      `看过之后：${verdict.impression}\n`,
      `她自己的结论：${verdict.liked === true ? '喜欢' : '不喜欢'}${verdict.why.length > 0 ? `——${verdict.why}` : ''}\n`,
    ]
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, lines.join(''), 'utf8')
  }

  /** 此刻是否适合“介入/试探”：她注意力集中、醒着、距上次至少 probeGapMs。 */
  function shouldProbe(focus) {
    if (disposed || probing) return false
    const text = typeof focus === 'string' ? focus.trim() : ''
    if (Array.from(text).length < 4) return false
    const snap = state.snapshot()
    if (snap !== null && snap !== undefined && snap.sleeping === true) return false
    const currentNow = now()
    return lastProbeAt <= 0 || currentNow - lastProbeAt >= probeGapMs
  }

  /**
   * 介入方案：她注意力正集中时，模型自己挑一个类型+题目，让她去看一眼，
   * 最后由她自己判断喜不喜欢（v1.62）。两段式：先选中入口，再写看过之后的判断。
   */
  async function probeNow(input = {}) {
    if (disposed || probing) return { ok: false, reason: 'busy' }
    const focus = cleanText(isPlainObject(input) ? input.focus : '', 40)
    const force = isPlainObject(input) && input.force === true
    if (!force && !shouldProbe(focus)) return { ok: false, reason: 'not-now' }
    probing = true
    const currentNow = now()
    try {
      const learnedTitles = readTopics()
        .filter((topic) => isPlainObject(topic) && topic.learned === true && typeof topic.title === 'string')
        .slice(-6)
        .map((topic) => topic.title)
      const recentProbes = readProbeHistory(6)
      const proposalResult = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘；你好奇心重，但喜不喜欢一个东西，要自己去看过才知道。',
        buildProbeProposalPrompt({ now: currentNow, focus, recentLearnedTitles: learnedTitles, recentProbes }),
        { role: 'probe', maxTokens: 700 },
      )
      // 不管成败都推进 lastProbeAt，避免每个 tick 都去打扰她。
      lastProbeAt = currentNow
      persistProbeState()
      if (proposalResult === null) {
        warn('试探：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const proposal = parseProbeProposal(proposalResult.text)
      if (proposal.ok !== true) {
        warn(`试探入口无效：${proposal.message}`)
        return { ok: false, reason: 'invalid' }
      }
      const verdictResult = await callModel(
        '你还是那只鲸鱼娘；刚按一个入口去看了一眼，现在如实写下看到的东西和自己的喜恶。',
        buildProbeVerdictPrompt({ now: currentNow, focus, proposal }),
        { role: 'probe', maxTokens: 700 },
      )
      if (verdictResult === null) {
        warn('试探：看的时候模型不可用，这次不算数')
        return { ok: false, reason: 'llm' }
      }
      const verdict = parseProbeVerdict(verdictResult.text)
      if (verdict.ok !== true) {
        warn(`试探结论无效：${verdict.message}`)
        return { ok: false, reason: 'invalid' }
      }
      appendProbeLog(currentNow, focus, proposal, verdict)
      info(`试探（${proposal.domain}）${proposal.title}：${verdict.liked === true ? '喜欢' : '不喜欢'}`)
      return {
        ok: true,
        domain: proposal.domain,
        title: proposal.title,
        hook: proposal.hook,
        impression: verdict.impression,
        liked: verdict.liked,
        why: verdict.why,
      }
    } catch (error) {
      warn(`试探异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      probing = false
    }
  }

  function mergeTopicCandidate(topic, currentNow) {
    if (topic === null) return { ok: true, added: false, reason: 'no-topic' }
    try {
      let existing = []
      try {
        const parsed = JSON.parse(readFileSync(candidatesPath, 'utf8'))
        if (isPlainObject(parsed) && Array.isArray(parsed.topics)) existing = parsed.topics
      } catch {
        existing = []
      }
      const ids = new Set()
      for (const item of [...readTopics(), ...existing]) {
        if (isPlainObject(item) && typeof item.id === 'string') ids.add(item.id)
      }
      if (ids.has(topic.id)) return { ok: true, added: false, reason: 'duplicate' }
      existing.push(topic)
      const capped = existing.slice(-SELF_GROWTH_MAX_CANDIDATES)
      writeJsonAtomic(candidatesPath, { ok: true, v: 1, updatedAt: currentNow, topics: capped })
      return { ok: true, added: true }
    } catch (error) {
      warn(`自学候选写入失败：${shortMessage(error)}`)
      return { ok: false, added: false, reason: shortMessage(error) }
    }
  }

  async function reflectNow() {
    if (disposed || reflecting) return { ok: false, reason: 'busy' }
    reflecting = true
    const currentNow = now()
    lastReflectAt = currentNow
    try {
      let recentThoughts = []
      let recentLearning = ''
      try {
        if (memoryRecall !== null && typeof memoryRecall.recentThoughts === 'function') {
          recentThoughts = memoryRecall.recentThoughts(2)
        }
        if (memoryRecall !== null && typeof memoryRecall.recentLearning === 'function') {
          const learned = memoryRecall.recentLearning(1)
          recentLearning = Array.isArray(learned) && learned.length > 0 && typeof learned[0] === 'string' ? learned[0] : ''
        }
      } catch {
        recentThoughts = []
        recentLearning = ''
      }
      let knownFeelings = []
      try {
        if (feelingsSource !== null) {
          if (typeof feelingsSource.names === 'function') knownFeelings = feelingsSource.names(20)
          else if (typeof feelingsSource.read === 'function') {
            const read = feelingsSource.read()
            if (read !== null && read !== undefined && Array.isArray(read.entries)) {
              knownFeelings = read.entries.map((item) => (item && typeof item.name === 'string' ? item.name : ''))
            }
          } else if (Array.isArray(feelingsSource)) {
            knownFeelings = feelingsSource.map((item) => (item && typeof item.name === 'string' ? item.name : ''))
          }
        }
      } catch {
        knownFeelings = []
      }
      const modelResult = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘挂件，正在安静地回顾自己最近的状态。',
        buildReflectPrompt({ now: currentNow, state: state.snapshot(), recentThoughts, recentLearning, knownFeelings }),
      )
      if (modelResult === null) {
        warn('自省：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parseReflectResult(modelResult.text)
      if (parsed.ok !== true) {
        warn(`自省结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      if (journal !== null && typeof journal.append === 'function') {
        await journal.append({ kind: 'thought', text: `自省：${parsed.thought}` })
      }
      // v1.50：把模型自造的新感受追加进她自己的情绪库（重名不重复；失败不影响自省）。
      let feelingAdded = false
      if (parsed.feeling !== null && feelingsPath !== null) {
        const appended = appendFeeling({ path: feelingsPath, feeling: parsed.feeling, now: currentNow })
        if (appended.ok !== true) warn(`新感受写入失败：${appended.reason ?? 'unknown'}`)
        else feelingAdded = appended.added === true
      }
      try {
        state.applyEvent('reflect', currentNow)
      } catch {
        /* ignore */
      }
      const feelingNote = parsed.feeling !== null ? `；新感受「${parsed.feeling.name}」${feelingAdded ? '已入库' : '已存在'}` : ''
      info(`自省完成（${modelResult.provider}/${modelResult.model}）：${parsed.thought}${feelingNote}`)
      return {
        ok: true,
        thought: parsed.thought,
        ...(parsed.feeling !== null ? { feeling: parsed.feeling } : {}),
        feelingAdded,
      }
    } catch (error) {
      warn(`自省异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      reflecting = false
    }
  }

  async function learnNow() {
    if (disposed || learning) return { ok: false, reason: 'busy' }
    learning = true
    const currentNow = now()
    lastLearnAt = currentNow
    try {
      let learningSnippet = ''
      let recentThoughts = []
      try {
        if (memoryRecall !== null && typeof memoryRecall.recentThoughts === 'function') {
          const thoughts = memoryRecall.recentThoughts(3)
          recentThoughts = Array.isArray(thoughts) ? thoughts.filter((text) => typeof text === 'string' && text.trim().length > 0) : []
        }
        if (memoryRecall !== null && typeof memoryRecall.recentLearning === 'function') {
          const recent = memoryRecall.recentLearning(1)
          learningSnippet = Array.isArray(recent) && recent.length > 0 && typeof recent[0] === 'string' ? recent[0] : ''
        }
      } catch {
        learningSnippet = ''
        recentThoughts = []
      }
      // v1.53：把最近学过的主题标题给她，避免一直围着同一个方向换问法。
      const learnedTopics = readTopics()
        .filter((topic) => isPlainObject(topic) && topic.learned === true && typeof topic.title === 'string')
        .sort((left, right) => {
          const a = typeof left.addedAt === 'number' ? left.addedAt : 0
          const b = typeof right.addedAt === 'number' ? right.addedAt : 0
          return a - b
        })
      const recentLearnedTitles = learnedTopics.slice(-6).map((topic) => topic.title)
      const repeatTheme = detectRepeatedTheme(learnedTopics.slice(-8).map((topic) => topic.title))
      const probeHistory = readProbeHistory(6)
      // v1.52：不再用随机话题作种子；给她少量已知小知识作参考，学什么由她自己挑。
      const modelResult = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘挂件，正在自学一点新知识，并把真正值得记住的收进自己的小知识库。',
        buildLearnPrompt({
          now: currentNow,
          state: state.snapshot(),
          learningSnippet,
          recentThoughts,
          recentLearnedTitles,
          repeatTheme,
          probeHistory,
          knownTopics: (() => {
            const merged = [...sampleHistoryTopics(2), ...sampleKnownTopics(8)]
            const seen = new Set()
            return merged.filter((topic) => {
              if (typeof topic.title !== 'string' || topic.title.length === 0) return false
              if (seen.has(topic.title)) return false
              seen.add(topic.title)
              return true
            })
          })(),
        }),
      )
      if (modelResult === null) {
        warn('自学：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parseLearnResult(modelResult.text)
      if (parsed.ok !== true) {
        warn(`自学结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      appendLearningLog(currentNow, parsed.question, parsed.note, parsed.topic)
      // 候选文件保留为审计日志；同时按用户要求免审核并入活跃话题库。
      const merged = mergeTopicCandidate(parsed.topic, currentNow)
      let promoted = false
      if (parsed.topic !== null && topicsBankPath !== null) {
        const promotion = mergeLearnedTopicIntoBank({ path: topicsBankPath, topic: parsed.topic, now: currentNow })
        promoted = promotion.ok === true && promotion.added === true
        if (promotion.ok !== true) warn(`自学话题并入话题库失败：${promotion.reason ?? 'unknown'}`)
        if (promoted && topicsArchivePath !== null) {
          const compacted = compactTopicBankForArchive({
            path: topicsBankPath,
            archivePath: topicsArchivePath,
            now: currentNow,
          })
          if (compacted.ok !== true) warn(`话题库冷存储归档失败：${compacted.reason ?? 'unknown'}`)
        }
      }
      try {
        state.applyEvent('learn', currentNow)
      } catch {
        /* ignore */
      }
      const topicNote = promoted ? '（已并入话题库）' : merged.added === true ? '（新增候选话题）' : ''
      info(`自学完成（${modelResult.provider}/${modelResult.model}）：${parsed.question}${topicNote}`)
      return {
        ok: true,
        question: parsed.question,
        note: parsed.note,
        topic: parsed.topic,
        candidateAdded: merged.added === true,
        topicPromoted: promoted,
      }
    } catch (error) {
      warn(`自学异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      learning = false
    }
  }

  /** 60s tick：推进状态 + 到点触发反思/自学（失败也推迟到下一周期）。 */
  function tick(atNow) {
    if (disposed) return snapshot()
    const currentNow = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    try {
      state.tick(currentNow)
    } catch (error) {
      warn(`内在状态 tick 失败：${shortMessage(error)}`)
    }
    if (!reflecting && currentNow - lastReflectAt >= reflectIntervalMs) {
      lastReflectAt = currentNow
      reflectNow().catch(() => {})
    }
    if (!learning && currentNow - lastLearnAt >= learnIntervalMs) {
      lastLearnAt = currentNow
      learnNow().catch(() => {})
    }
    return snapshot()
  }

  function start(options = {}) {
    if (disposed || timer !== null || heartbeatMode) return
    heartbeatMode = options && options.heartbeat === true
    if (heartbeatMode) return
    timer = setInterval(() => {
      try {
        tick()
      } catch {
        /* ignore */
      }
    }, tickIntervalMs)
    timer.unref?.()
  }

  function stop() {
    heartbeatMode = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function snapshot() {
    let stateSnapshot = null
    try {
      stateSnapshot = state.snapshot()
    } catch {
      stateSnapshot = null
    }
    return {
      lastReflectAt,
      lastLearnAt,
      lastProbeAt,
      probing,
      learnings: stateSnapshot !== null ? stateSnapshot.learnings : 0,
      reflections: stateSnapshot !== null ? stateSnapshot.reflections : 0,
    }
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    tick,
    start,
    stop,
    dispose,
    reflectNow,
    learnNow,
    probeNow,
    shouldProbe,
    readProbeHistory,
    snapshot,
    learningLogPath,
    candidatesPath,
  }
}
