// lib/self-talk.mjs —— 「自言自语」实时生成（契约 v1.8 §2.11）。
//
// 挂件的气泡文案不再只来自静态池，而是让**当前默认模型**现想一句（纯随想 murmur）。
// v1.8b 用户反馈：自言自语要「自己想说啥就说啥」，**禁止引用/背诵/化用古诗文**，
// 也不要模型往「诗词」上引；因此 intro 已废弃（统一按 murmur 处理），且 **不再向模型
// 发送今日诗标题/作者**等诱导性上下文。
// Host 只把**非敏感聚合上下文**交给模型：日期时间、天气、心情 key/label、mood 聚合
// 数字、距上次交互分钟、客户端回传的 recent（最近说过的句子）。**绝不读取/发送会话
// 消息文本**——prompt 构造只白名单读取 buildSelfTalkPrompt 明确列出的字段，调用方即使
// 传入 messages/sessionMessages/poem 也会被丢弃。
//
// 生成约束：一次请求 2 行（每行一句）、20s 超时、in-flight 并发去重、两次生成最小间隔
// 3s、最近 30 条已生成文本参与去重；失败一律返回 {ok:false,error}，路由层永远 200。
// v1.26（M34）：话题库——service 每次从 $DSH_HOME/agent-memory/topics.json 挑一个话题（按心情/天气/
// 活动/体验/时段打分并回避最近 30 个），把「小知识」自然融入；prompt 要求综合心情/天气/最近在做/体验。
// v1.22（M32）：为降低重复度——recent 上限 5→12（总长 1200）、prompt 强调主题/意象/开头不重复、
// 表达类型轮换，并每轮从 SELF_TALK_THEMES 随机挑一个小主题；temperature 0.95→1.0。
import { callCandidate } from './llm-call.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { bigramJaccard, formatMemoryDigest } from './memory-recall.mjs'
import { formatBeingLine } from './self-being.mjs'
import { normalizeEffort } from './model-policy.mjs'
import { VOICE_FALLBACK_THROTTLE_MS } from './voice-memory.mjs'
import { SELF_TALK_TOPIC_RECENT_MAX, buildTopicPromptLine, pickSelfTalkTopic } from './self-talk-topics.mjs'

/** 允许的 kind。`intro` 已废弃（v1.8b）：收到也按 murmur 处理。 */
export const SELF_TALK_KINDS = Object.freeze(['murmur', 'intro'])
/** 两次成功生成之间的最小间隔（毫秒）。 */
export const SELF_TALK_MIN_INTERVAL_MS = 3000
/** 单次模型调用超时（毫秒），契约 v1.38 起 20s→35s（高 reasoning 需要更多时间）。 */
export const SELF_TALK_TIMEOUT_MS = 35000
/** 每批最多句数。 */
export const SELF_TALK_BATCH = 2
/** 参与去重的最近生成文本条数（v1.22：20→30，覆盖更长的重复窗口）。 */
export const SELF_TALK_RECENT_CACHE = 30
/** 客户端 recent query 的条数/字符上限（契约 §2.11；v1.22：5→12 条 / 500→1200 字符）。 */
export const SELF_TALK_RECENT_MAX = 12
export const SELF_TALK_RECENT_MAX_CHARS = 1200
/** 单句长度约束（按 Unicode 字符数，不含被剥离的标点）。 */
export const MURMUR_MIN_CHARS = 4
export const MURMUR_MAX_CHARS = 120
/** @deprecated v1.8b 起 intro 废弃，统一按 murmur 的长度约束。保留导出仅为兼容。 */
export const INTRO_MIN_CHARS = MURMUR_MIN_CHARS
export const INTRO_MAX_CHARS = MURMUR_MAX_CHARS
/** 模型输出上限（小请求，防止跑飞）。 */
export const SELF_TALK_MAX_TOKENS = 320
/** 采样温度：v1.22 起 0.95→1.0，想要自然、有性格、不模板化的嘀咕。 */
export const SELF_TALK_TEMPERATURE = 1.0

/**
 * 本轮碎碎念的候选小主题（host 每次随机挑一个，避免模型总回到固定意象）。
 * 只是「试着围绕」，不是命题作文——模型可自然地换成别的。
 */
export const SELF_TALK_THEMES = Object.freeze([
  '窗外的声音',
  '杯子',
  '光线',
  '键盘声',
  '小时候',
  '梦',
  '食物',
  '远处的人',
  '今天读到的一句话',
  '一个小问题',
  '想做的事',
  '对用户的吐槽',
  '夸自己',
  '天气',
  '时间',
  '身体的小动作',
  '发呆',
  '幻想',
  '记忆',
  '安静的感觉',
  '雨声',
  '台灯',
  '椅背',
  '口袋',
  '云',
  '路过的猫',
  '一首没念出口的诗',
  '明天',
  '今天没做成的事',
])

/** 从主题列表随机挑一个；可注入 random 便于测试。 */
export function pickSelfTalkTheme(random = Math.random) {
  const rng = typeof random === 'function' ? random : Math.random
  let roll = Number(rng())
  if (!Number.isFinite(roll)) roll = 0
  roll = Math.min(0.999999999, Math.max(0, roll))
  return SELF_TALK_THEMES[Math.floor(roll * SELF_TALK_THEMES.length)]
}

/** 写入代码的 System prompt（测试会断言其中的关键约束）。 */
export const SELF_TALK_SYSTEM_PROMPT = [
  '你是住在 DSH Web 界面角落的鲸鱼娘挂件，喜欢安静地陪着用户，正在小声地自言自语。',
  '用第一人称简体中文说话，说你自己此刻的想法。',
  '每行只输出一句话，8–60 个汉字。',
  '可以说此刻的感受、观察、吐槽、关心或闲想；自然口语或文艺一点的表达都可以，但要用你自己的话。',
  '不要引用、背诵或化用任何古诗文原句或名句，不要念诗、不要报诗名，也不要总把自己往「诗词」上引。',
  '你的语气以你自己从记忆里长出的声音为准；保持自然、第一人称、不迎合、不说教。',
  '不迎合、不说教、不用营销腔；不提 AI、模型、提示词、系统或程序。',
  '不编造用户隐私或会话内容，不假装知道没告诉你的事；不做医疗、法律、投资建议。',
  '不用引号、不用分点、不用 emoji，不解释、不加前言后语。',
  '每一次都要换一个具体的、新的小主题，不要总围绕「忙碌、疲惫、等待、尾巴、角落、光、云、数字、周五、一整天」这些词打转。',
  '不要重复你最近说过的句子的主题、意象或开头；避免「今天……」「忙了……」「一整天……」「周五……」这类模板化开头。',
  '表达类型要轮换：可以是一句观察、一句吐槽、一个很小的问题、一两句的小故事、一个具体的细节、一个愿望或念头；不要每句都是感慨或疲惫。',
].join('')

/** 心情 key → 中文说明（宿主侧只做展示，不参与客户端心情引擎）。 */
const MOOD_ZH = Object.freeze({
  happy: '开心',
  tired: '疲惫',
  sleepy: '困倦',
  cozy: '惬意',
  proud: '得意',
  busy: '忙碌',
  curious: '好奇',
  idle: '空闲',
  lonely: '有点孤单',
  calm: '平静',
})

/** 天气类别 → 中文说明（query 里可能传类别或中文描述）。 */
const WEATHER_ZH = Object.freeze({
  clear: '晴',
  cloud: '多云',
  fog: '雾',
  rain: '雨',
  snow: '雪',
  thunder: '雷雨',
  wind: '大风',
  cold: '寒冷',
  unknown: '天气不明',
})

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const SHANGHAI_FORMATTER = (() => {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    })
  } catch {
    return null
  }
})()

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 简短错误信息（日志用）。 */
function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** 统一失败响应体（路由层原样 JSON 化）。 */
export function selfTalkUnavailable(message, code = 'SELF_TALK_UNAVAILABLE') {
  return { ok: false, error: { code, message: String(message ?? '自言自语暂不可用') } }
}

/** 截断到指定字符数（按码点）。 */
function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/** 去掉控制字符/换行，供 prompt 中的外部短文本使用。 */
function sanitizeInline(value, maxChars) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, maxChars)
}

/** Asia/Shanghai 的日期时间文本（宿主时区无关）。 */
export function formatShanghaiTime(ms = Date.now()) {
  const date = new Date(typeof ms === 'number' ? ms : Date.now())
  if (SHANGHAI_FORMATTER !== null) {
    try {
      const parts = SHANGHAI_FORMATTER.formatToParts(date)
      const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
      const year = get('year')
      const month = get('month')
      const day = get('day')
      const hour = get('hour')
      const minute = get('minute')
      const weekday = get('weekday')
      if (year && month && day && hour && minute) {
        return `${year}-${month}-${day} ${weekday ? `(${weekday})` : ''} ${hour}:${minute}`
      }
    } catch {
      /* 回退本地时间 */
    }
  }
  const local = date
  const pad = (n) => String(n).padStart(2, '0')
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} (${WEEKDAY_ZH[local.getDay()]}) ${pad(local.getHours())}:${pad(local.getMinutes())}`
}

/** 按小时给一句时段描述（供模型理解语境）。 */
export function dayPeriod(ms = Date.now()) {
  let hour
  if (SHANGHAI_FORMATTER !== null) {
    try {
      const parts = SHANGHAI_FORMATTER.formatToParts(new Date(ms))
      hour = Number(parts.find((part) => part.type === 'hour')?.value)
    } catch {
      hour = new Date(ms).getHours()
    }
  } else {
    hour = new Date(ms).getHours()
  }
  if (!Number.isFinite(hour)) hour = new Date(ms).getHours()
  if (hour < 5) return '凌晨'
  if (hour < 9) return '早上'
  if (hour < 12) return '上午'
  if (hour < 13) return '中午'
  if (hour < 17) return '下午'
  if (hour < 19) return '傍晚'
  if (hour < 23) return '晚上'
  return '深夜'
}

/** 中文 bigram Jaccard 相似度（导出供测试；与 memory-recall 同一实现）。 */
export function selfTalkSimilarity(left, right) {
  return bigramJaccard(left, right)
}

/**
 * 从模型候选行里挑「最不重复」的句子（v1.33）：
 *   · 去 exact duplicate（归一化后相同只保留第一次出现）；
 *   · 与 recent 文本做中文 bigram Jaccard，取最大相似度；
 *   · 相似度升序排序，返回最不重复的一句；
 *   · 若所有候选相似度都 > threshold(0.8)，仍返回首选 + 第二行（避免无句可用）。
 * @param {string[]} lines
 * @param {string[]} recentTexts
 * @param {{threshold?: number}} [options]
 * @returns {string[]}
 */
export function selectDiverseSelfTalkLines(lines, recentTexts, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.8
  const recent = (Array.isArray(recentTexts) ? recentTexts : []).filter(
    (text) => typeof text === 'string' && text.trim().length > 0,
  )
  const seen = new Set()
  const candidates = []
  for (const raw of Array.isArray(lines) ? lines : []) {
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (text.length === 0) continue
    const key = text.replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    let similarity = 0
    for (const previous of recent) {
      similarity = Math.max(similarity, bigramJaccard(text, previous))
    }
    candidates.push({ text, similarity })
  }
  if (candidates.length === 0) return []
  candidates.sort((left, right) => left.similarity - right.similarity)
  const fresh = candidates.filter((candidate) => candidate.similarity <= threshold)
  if (fresh.length > 0) return [fresh[0].text]
  return candidates.slice(0, 2).map((candidate) => candidate.text)
}

/**
 * 构造发给模型的 user prompt（纯函数）。
 * 只读取本函数明确列出的非敏感字段：now / weather / moodKey / moodLabel / stats /
 * idleMinutes / recent。调用方传入的其它字段（尤其是会话消息文本、今日诗元数据）
 * 一律不会进入返回值。
 * @param {{
 *   now?: number,
 *   weather?: string|null,
 *   moodKey?: string|null,
 *   moodLabel?: string|null,
 *   moodReason?: string|null,
 *   image?: string|null,
 *   imageLabel?: string|null,
 *   recent?: string[]|null,
 *   theme?: string|null,
 *   topic?: {title?: string, fact?: string}|null,
 *   selfState?: {energy?: number, curiosity?: number, social?: number, hunger?: number}|null,
 *   memoryDigest?: string|null,
 *   voice?: {profile?: string, exemplars?: string[]}|null,
 * }} [context]
 * @returns {string}
 */
export function buildSelfTalkPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = []

  lines.push(`现在是 ${formatShanghaiTime(nowMs)}，${dayPeriod(nowMs)}，你在 DSH Web 的角落陪着用户。`)

  const weather = sanitizeInline(typeof ctx.weather === 'string' ? ctx.weather : '', 40)
  if (weather.length > 0) {
    const zh = WEATHER_ZH[weather]
    lines.push(`当前天气：${zh ? `${zh}（${weather}）` : weather}。`)
  }

  const moodKey = sanitizeInline(typeof ctx.moodKey === 'string' ? ctx.moodKey : '', 32)
  if (moodKey.length > 0) {
    const label = sanitizeInline(typeof ctx.moodLabel === 'string' && ctx.moodLabel.length > 0 ? ctx.moodLabel : MOOD_ZH[moodKey] ?? '', 24)
    lines.push(`你此刻的心情：${label ? `${moodKey}（${label}）` : moodKey}。`)
  }

  if (isPlainObject(ctx.selfState)) {
    lines.push(formatBeingLine(ctx.selfState))
  }

  const moodReason = sanitizeInline(typeof ctx.moodReason === 'string' ? ctx.moodReason : '', 80)
  if (moodReason.length > 0) lines.push(`此刻心情的理由：${moodReason}。`)

  const image = sanitizeInline(typeof ctx.image === 'string' ? ctx.image : '', 120)
  if (image.length > 0) {
    const imageLabel = sanitizeInline(typeof ctx.imageLabel === 'string' ? ctx.imageLabel : '', 24)
    const basename = image.split('/').pop() || image
    lines.push(`你现在展示的立绘/动画：${imageLabel.length > 0 ? imageLabel : basename}（${image}）。`)
    lines.push(
      '让这句自言自语和你此刻的心情、表情/动作、展示的画面自然对得上；可以轻轻提到画面里的动作/表情/光线，但不要提文件名、路径或技术细节，也不要生硬描述画面。',
    )
  }

  // v1.58：不再注入任何对话/会话聚合数据——她的情境只来自天气、时间、她自己的状态与记忆。
  const recent = Array.isArray(ctx.recent) ? ctx.recent : []
  const recentLines = []
  for (const entry of recent.slice(0, SELF_TALK_RECENT_MAX)) {
    const text = sanitizeInline(typeof entry === 'string' ? entry : '', 80)
    if (text.length > 0 && !recentLines.includes(text)) recentLines.push(text)
  }
  if (recentLines.length > 0) {
    lines.push('你最近说过的话（不要重复主题/意象/开头，也不要改写）：')
    for (const text of recentLines) lines.push(`- ${text}`)
  }

  // memoryDigest 是内部生成的多行结构文本，保留换行（只做长度限制）。
  const memoryDigest = clampText(typeof ctx.memoryDigest === 'string' ? ctx.memoryDigest.trim() : '', 1200)
  if (memoryDigest.length > 0) {
    lines.push(memoryDigest)
  }
  lines.push(
    '这句碎碎念不要从任何主题清单或话题库里挑；就从你此刻的心情、今天真实发生的事、以及你记得的以前的事里自然长出来——可以接今天的一件小事，可以顺着此刻的心情，也可以忽然想起很久以前的片段。不要为了用上某条记忆而硬提它。',
  )

  const voice = isPlainObject(ctx.voice) ? ctx.voice : null
  if (voice !== null) {
    const profile = clampText(typeof voice.profile === 'string' ? voice.profile.trim() : '', 400)
    if (profile.length > 0) {
      lines.push(`这是你自己从旧记忆里总结出来的声音（不是别人给你的人设）：${profile}`)
      const exemplars = Array.isArray(voice.exemplars)
        ? voice.exemplars.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 3)
        : []
      if (exemplars.length > 0) {
        lines.push('你过去说过、可作语气参照但不要复述的句子：')
        for (const example of exemplars) lines.push(`- ${clampText(example.trim(), 80)}`)
      }
      lines.push('请延续这个声音，但只说此刻真正想说的，不要照抄示例。')
    }
  }

  const topicLine = buildTopicPromptLine(isPlainObject(ctx.topic) ? ctx.topic : null)
  if (topicLine.length > 0) {
    lines.push(topicLine)
  } else {
    const theme = sanitizeInline(typeof ctx.theme === 'string' ? ctx.theme : '', 40)
    if (theme.length > 0) {
      lines.push(`这次试着围绕「${theme}」说一句（如果觉得不自然，可以换成此刻更真实的东西；不要写成命题作文）。`)
    }
  }

  lines.push(
    '请综合你此刻的心情、天气、最近在体验的内容（如有）以及上面的小知识，自然地写成一句碎碎念；' +
      '不要把各项逐条罗列，不要变成科普或知识讲解。',
  )
  lines.push(`请生成 ${SELF_TALK_BATCH} 行自言自语，每行一句：自由随想，一句 4–120 个汉字，用你自己的话说此刻的想法。`)
  lines.push(
    '只用简体中文；不要编号、不要引号、不要 emoji；不要重复最近说过的话；不要提到 AI/模型/提示词；' +
      '不要引用、背诵或化用古诗文，也不要往「诗词」上引。',
  )
  // v1.61：去 AI 味——像在心里说话，不像写文章（结构线索参考 qu-ai-wei，不列禁词）。
  lines.push(...naturalStyleLines())
  return lines.join('\n')
}

/** 逐字符判断是否存在中文（CJK 统一表意文字）。 */
function hasChinese(text) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)
}

/**
 * 轻量过滤「引诗/报诗名/往诗词上靠」的句子（v1.8b：自言自语是纯随想）：
 *   · 书名号/引号/破折号通常意味着在引用或标注出处；
 *   · 出现「诗/詞/词牌/平仄/押韵」等诗词相关字样（用户反馈「诗句偏多」，
 *     因此凡带「诗」的生成句都丢弃，宁缺毋滥；普通感受/观察句不受影响）。
 * 只做启发式，不做复杂文言检测。
 */
function looksLikePoetryCitation(text) {
  if (/[《》「」“”]/.test(text)) return true
  if (/——/.test(text)) return true
  return /[诗詩]|词牌|詞牌|平仄|押韵|押韻/u.test(text)
}

/** 比较用的归一形式：去掉空白、标点与符号。 */
export function normalizeForCompare(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 去掉行首编号、项目符号、引号等，再去掉行尾标点。 */
function cleanLine(raw) {
  let line = String(raw ?? '')
    .replace(/```+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  // 行首编号/项目符号：1. / 1、 / (1) / - / * / • / ① …
  line = line.replace(/^(?:[-*•·]+|\d{1,2}[.、)）]|[（(]\d{1,2}[)）]|[①-⑳])\s*/u, '')
  // 行首引号/括号
  line = line.replace(/^[「『“"'‘（(\[]+\s*/u, '')
  // 行尾引号/括号/标点
  line = line.replace(/[\s」』”"'‘’）)\]]+$/u, '')
  line = line.replace(/[。！？；.!?;，,、：:…~～]+$/u, '')
  line = line.replace(/^[。！？；.!?;，,、：:…~～]+/u, '')
  // 中文句子内部不需要空格
  line = line.replace(/\s+/g, ' ').trim()
  line = line.replace(/(?<=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/gu, '')
  return line.trim()
}

/**
 * 把模型输出拆成合格的句子（纯函数）。
 * 规则：按换行/句号拆分 → 去引号/编号/首尾标点 → 保留 8–60 字（intro 已废弃，按 murmur）
 * → 必须含中文 → 轻量过滤「疑似引诗/报诗名」的句子 → 批内去重 + 与 recent 去重 → 最多 limit 条。
 * @param {string} text
 * @param {{kind?: string, recent?: string[], limit?: number}} [options]
 * @returns {string[]}
 */
export function parseSelfTalkLines(text, options = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) return []
  // intro 已废弃（v1.8b）：无论传什么 kind，都按 murmur 的 8–60 字处理。
  const minChars = MURMUR_MIN_CHARS
  const maxChars = MURMUR_MAX_CHARS
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(SELF_TALK_BATCH, Math.floor(options.limit))
      : SELF_TALK_BATCH
  const recentKeys = new Set(
    (Array.isArray(options.recent) ? options.recent : [])
      .map((entry) => normalizeForCompare(entry))
      .filter((key) => key.length > 0),
  )

  const candidates = []
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[a-zA-Z]*\n?/g, '\n')
    .replace(/```/g, '\n')
  for (const rawLine of normalized.split('\n')) {
    for (const piece of rawLine.split(/[。！？；!?;]+/u)) candidates.push(piece)
  }

  const result = []
  const seen = new Set()
  for (const candidate of candidates) {
    const line = cleanLine(candidate)
    if (line.length === 0) continue
    const chars = Array.from(line)
    if (chars.length < minChars || chars.length > maxChars) continue
    if (!hasChinese(line)) continue
    if (looksLikePoetryCitation(line)) continue
    const key = normalizeForCompare(line)
    if (key.length === 0 || seen.has(key) || recentKeys.has(key)) continue
    seen.add(key)
    result.push(line)
    if (result.length >= limit) break
  }
  return result
}

/**
 * 读取 selection 并归一化；不抛异常。
 * 刻意只取 provider/model：自言自语是「一句话」级别的短请求，契约 §2.11 的调用形状也
 * v1.38：reasoningEffort 由 model policy 按 role 决定（无 policy 时维持旧行为不继承）。
 * 200 的预算（空文本）或把延迟拖过客户端 8s 超时。
 */
function normalizeSelection(raw) {
  if (!isPlainObject(raw)) return null
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return null
  return { provider, model }
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
  if (error.code === 'SELF_TALK_TIMEOUT') return true
  const name = String(error.name ?? '')
  return name === 'TimeoutError' || name === 'AbortError' || /超时|abort/i.test(String(error.message ?? ''))
}

/**
 * 创建自言自语服务。
 * @param {{
 *   llm?: object|((() => object|undefined|null))|null,
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string, reasoningEffort?: string}|null|undefined,
 *   logger?: {warn?: Function}|null,
 *   now?: () => number,
 *   minIntervalMs?: number,
 *   timeoutMs?: number,
 *   batch?: number,
 *   random?: () => number,
 *   theme?: string,
 *   topics?: object[]|{read: Function}|null,
 *   recall?: {digest: Function}|null,
 *   voice?: (() => object|null)|{get?: Function}|null,
 *   refreshVoice?: (() => Promise<unknown>|unknown)|null,
 *   policy?: object|Function|null,
 *   modelErrorsPath?: string|null,
 * }} [options]
 */
export function createSelfTalkService(options = {}) {
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : SELF_TALK_MIN_INTERVAL_MS
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SELF_TALK_TIMEOUT_MS
  const batch = Number.isFinite(options.batch) && options.batch > 0 ? Math.min(SELF_TALK_BATCH, Math.floor(options.batch)) : SELF_TALK_BATCH
  const recentCacheSize = Number.isFinite(options.recentCacheSize) ? options.recentCacheSize : SELF_TALK_RECENT_CACHE
  const random = typeof options.random === 'function' ? options.random : Math.random
  const fixedTheme = typeof options.theme === 'string' ? sanitizeInline(options.theme, 40) : ''
  // v2.2：默认不再从固定主题数组里挑；只有显式给 theme 或把概率调高时才带主题。
  const themeProbability =
    Number.isFinite(options.themeProbability) && options.themeProbability >= 0 && options.themeProbability <= 1
      ? options.themeProbability
      : 0
  // v2.2：话题库默认不参与“挑一个话题”；需要时用 DSH_POETRY_TALK_TOPICS=on 打开。
  const topicsEnabled = options.topicsEnabled === true
  /** v1.26：话题库来源（数组或带 read() 的读取器，读取器自带 mtime 缓存）。 */
  const topicsSource = options.topics ?? null
  /** v1.33：记忆检索器（只读 journal/learning-log/topics，异常静默）。 */
  const memoryRecall = options.recall ?? null
  /** v1.38：按 role 选择 provider/model/reasoningEffort。 */
  const policy = options.policy ?? null
  /** v1.41：模型失败诊断文件（null 则不落盘，只 warn）。 */
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  /** v1.34：声音档案 getter（函数或 {get()}；缺失/异常返回 null）。 */
  const voiceSource = options.voice ?? null
  /** v1.35：voice 为空时的兜底刷新回调（fire-and-forget，≥5min 节流，不阻塞响应）。 */
  const refreshVoice = typeof options.refreshVoice === 'function' ? options.refreshVoice : null
  let lastVoiceRefreshAttemptAt = 0

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
      push(readSelection())
    }
    return out
  }

  function readVoice() {
    try {
      const value =
        typeof voiceSource === 'function'
          ? voiceSource()
          : voiceSource !== null && voiceSource !== undefined && typeof voiceSource.get === 'function'
            ? voiceSource.get()
            : null
      if (!isPlainObject(value)) return null
      const profile = typeof value.profile === 'string' ? value.profile.trim() : ''
      if (profile.length === 0) return null
      const exemplars = Array.isArray(value.exemplars)
        ? value.exemplars.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 3)
        : []
      return { profile, exemplars }
    } catch {
      return null
    }
  }
  /** 最近用过的 topic id（ring ≤30，成功后记录；失败不记）。 */
  const recentTopicIds = []

  /** 读取话题库条目；任何异常都降级为空（不影响自言自语）。 */
  function readTopics() {
    try {
      if (Array.isArray(topicsSource)) return topicsSource
      if (topicsSource !== null && topicsSource !== undefined && typeof topicsSource.read === 'function') {
        const result = topicsSource.read()
        return result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
      }
      if (typeof topicsSource === 'function') {
        const result = topicsSource()
        return Array.isArray(result) ? result : []
      }
      return []
    } catch (error) {
      warn(`读取话题库失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  function rememberTopic(topicId) {
    if (typeof topicId !== 'string' || topicId.length === 0) return
    const existing = recentTopicIds.indexOf(topicId)
    if (existing >= 0) recentTopicIds.splice(existing, 1)
    recentTopicIds.push(topicId)
    while (recentTopicIds.length > SELF_TALK_TOPIC_RECENT_MAX) recentTopicIds.shift()
  }

  /** 最近生成过的句子（用于跨请求去重，上限 20）。 */
  const generatedRecent = []
  /** @type {{ok:true,lines:Array<{text:string,ts:number}>,model:{provider:string,model:string},generatedAt:number,cached:boolean}|null} */
  let lastResult = null
  let lastStartedAt = 0
  /** @type {Promise<object>|null} */
  let inFlight = null

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function readSelection() {
    try {
      return normalizeSelection(getSelection())
    } catch (error) {
      warn(`读取默认模型失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** v1.38：按 role 从 policy 取 provider/model/reasoningEffort；无 policy/缺失返回 null。 */
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

  function rememberLines(texts) {
    for (const text of texts) {
      generatedRecent.push(text)
      if (generatedRecent.length > recentCacheSize) generatedRecent.splice(0, generatedRecent.length - recentCacheSize)
    }
  }

  function cachedResponse() {
    if (lastResult === null) return null
    return { ...lastResult, cached: true }
  }



  async function doGenerate(context) {
    const request = isPlainObject(context) ? context : {}
    // intro 已废弃（v1.8b）：统一按 murmur 生成纯随想。
    const kind = 'murmur'
    const startedAt = now()
    lastStartedAt = startedAt
    const llm = (() => {
      try {
        return resolveLlm()
      } catch (error) {
        warn(`获取 llm 服务失败：${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    })()
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      return selfTalkUnavailable('当前宿主的模型服务不可用')
    }
    const candidates = modelCandidates('selfTalk')
    if (candidates.length === 0) return selfTalkUnavailable('宿主尚未配置默认模型')

    // v1.26：从话题库按「心情/天气/最近在做/体验/时段」挑一个话题（排除最近 30 个）；
    // 有 topic 时用 topic，没有话题库时退回 v1.22 的随机小主题。
    const topic = topicsEnabled
      ? pickSelfTalkTopic(
          readTopics(),
          {
            moodKey: request.moodKey,
            moodLabel: request.moodLabel,
            weather: request.weather,
            period: dayPeriod(startedAt),
          },
          recentTopicIds,
          { random, now: startedAt },
        )
      : null
    const theme =
      topic !== null
        ? ''
        : fixedTheme.length > 0
          ? fixedTheme
          : random() < themeProbability
            ? pickSelfTalkTheme(random)
            : ''
    const recentForPrompt = [...(Array.isArray(request.recent) ? request.recent : []), ...generatedRecent]
    // v1.33：带当前情境做一次记忆检索（失败静默为空）。
    let memoryDigest = ''
    try {
      if (memoryRecall !== null && typeof memoryRecall.digest === 'function') {
        memoryDigest = formatMemoryDigest(
          memoryRecall.digest({
            moodKey: request.moodKey,
            moodLabel: request.moodLabel,
            weather: request.weather,
            topic,
            recentTexts: recentForPrompt,
          }),
        )
      }
    } catch {
      memoryDigest = ''
    }
    const voiceNow = readVoice()
    if (voiceNow === null && refreshVoice !== null) {
      const current = now()
      if (lastVoiceRefreshAttemptAt === 0 || current - lastVoiceRefreshAttemptAt >= VOICE_FALLBACK_THROTTLE_MS) {
        lastVoiceRefreshAttemptAt = current
        try {
          // fire-and-forget：不 await，失败静默，绝不阻塞 self-talk 响应。
          Promise.resolve(refreshVoice()).catch(() => {})
        } catch {
          /* ignore */
        }
      }
    }
    const userPrompt = buildSelfTalkPrompt({
      kind,
      theme,
      topic,
      memoryDigest,
      voice: voiceNow,
      now: startedAt,
      weather: request.weather,
      moodKey: request.moodKey,
      moodLabel: request.moodLabel,
      moodReason: request.moodReason,
      image: request.image,
      imageLabel: request.imageLabel,
      selfState: request.selfState,
      // 客户端 recent + 服务端最近生成，一起用于避免重复
      recent: recentForPrompt,
    })

    /** 单个候选的一次尝试（独立超时；仅未产出任何文本前失败才可回退）。 */
    async function attempt(candidate) {
      return callCandidate({
        candidate,
        resolveLlm,
        system: SELF_TALK_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxTokens: SELF_TALK_MAX_TOKENS,
        temperature: SELF_TALK_TEMPERATURE,
        timeoutMs,
        timeoutCode: 'SELF_TALK_TIMEOUT',
        timeoutMessage: `自言自语生成超时（${timeoutMs}ms）`,
        role: 'selfTalk',
        prefix: '自言自语候选失败',
        modelErrorsPath,
        warn,
        honorFinishFailure: true,
      })
    }

    let payloadText = null
    let actualCandidate = null
    let lastMessage = '自言自语生成失败'
    for (const candidate of candidates) {
      const result = await attempt(candidate)
      if (result.ok === true) {
        payloadText = result.text
        actualCandidate = candidate
        break
      }
      lastMessage = result.message
      if (result.retryable !== true) return selfTalkUnavailable(result.message)
    }
    if (payloadText === null || actualCandidate === null) return selfTalkUnavailable(lastMessage)

    const lines = parseSelfTalkLines(payloadText, {
      kind,
      // 客户端 recent + 服务端最近生成缓存：两边都要避免重复。
      recent: [...(Array.isArray(request.recent) ? request.recent : []), ...generatedRecent],
      limit: batch,
    })
    if (lines.length === 0) {
      return selfTalkUnavailable('模型没有返回可用的句子')
    }
    // v1.33：在多行候选里挑最不重复的一句（全部太像时保留首选+第二行）。
    const selectedLines = selectDiverseSelfTalkLines(lines, recentForPrompt)
    const finalLines = selectedLines.length > 0 ? selectedLines : lines
    const generatedAt = now()
    const response = {
      ok: true,
      lines: finalLines.map((text) => ({ text, ts: generatedAt })),
      // v1.39：记录实际成功的候选 provider/model（回退后不写首候选）。
      model: { provider: actualCandidate.provider, model: actualCandidate.model },
      generatedAt,
      cached: false,
    }
    rememberLines(lines)
    if (topic !== null) rememberTopic(topic.id)
    lastResult = response
    return response
  }

  /**
   * 生成一批自言自语。
   * 契约 §2.11：in-flight 请求复用同一个结果；距上次生成 < 3s 时复用上次结果（cached:true），
   * 没有上次结果则返回 SELF_TALK_RATE_LIMITED。永不抛异常。
   * @param {object} context
   * @returns {Promise<object>}
   */
  async function generate(context) {
    if (inFlight !== null) {
      const shared = await inFlight
      if (isPlainObject(shared) && shared.ok === true) return { ...shared, cached: true }
      return shared
    }
    const current = now()
    if (lastStartedAt > 0 && current - lastStartedAt < minIntervalMs) {
      const reused = cachedResponse()
      if (reused !== null) return reused
      return selfTalkUnavailable(`自言自语生成太频繁（最小间隔 ${minIntervalMs}ms）`, 'SELF_TALK_RATE_LIMITED')
    }
    const task = doGenerate(context).catch((error) => {
      warn(`自言自语异常：${error instanceof Error ? error.message : String(error)}`)
      return selfTalkUnavailable('自言自语暂不可用')
    })
    inFlight = task
    try {
      return await task
    } finally {
      if (inFlight === task) inFlight = null
    }
  }

  return {
    generate,
    /** 测试/诊断用：最近生成缓存快照。 */
    recentLines: () => [...generatedRecent],
    /** 测试/诊断用：最近用过的 topic id（ring ≤30）。 */
    recentTopics: () => [...recentTopicIds],
    lastResult: () => lastResult,
  }
}

/**
 * 解析路由 query 的 recent 参数（`|` 分隔、≤12 条、总长 ≤1200 字符；v1.22 扩容）。
 * 调用方传 URLSearchParams 解码后的值；这里再做一次防御性清理。
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function parseRecentQuery(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return []
  const trimmed = raw.slice(0, SELF_TALK_RECENT_MAX_CHARS)
  const out = []
  for (const part of trimmed.split('|')) {
    const text = sanitizeInline(part, 80)
    if (text.length > 0 && !out.includes(text)) {
      out.push(text)
      if (out.length >= SELF_TALK_RECENT_MAX) break
    }
  }
  return out
}
