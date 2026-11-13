// lib/domain/emotion/appraisal.mjs —— 学习/研究结果的情绪评价器（v3.11）
//
// 参考：Scherer 2005 的评价维度 + Damasio 躯体标记 + Barrett 构造情绪。
// 不是让模型自由发挥心情，而是对“刚发生的事”算四个维度，再映射成情绪线程。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

const LEARNED_KINDS = new Set(['自学', '自主研究', '读小说', '看大家说话', '溜达', '哲学'])
const FAILURE_PATTERNS = /(没读成|失败|超时|查不到|没找到|打不开|不可用|报错|没走出来|什么也没找着)/
const UNCERTAIN_PATTERNS = /(说不好|不确定|没法确认|没读到|只有目录|看不清|存疑|假说)/

/** 解析 learning-log 里 since 之后的新段落（标题 + 正文）。 */
export function readLearningEntries(learningLogPath, sinceMs, limit = 40) {
  if (typeof learningLogPath !== 'string' || !existsSync(learningLogPath)) return []
  let raw = ''
  try {
    raw = readFileSync(learningLogPath, 'utf8')
  } catch (error) {
    return []
  }
  const items = []
  for (const section of raw.split(/\n(?=##\s+)/)) {
    const header = section.split('\n', 1)[0] ?? ''
    const match = header.match(/^##\s+(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*·\s*(.+)$/)
    if (!match) continue
    const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? '0')).getTime()
    if (!(at > sinceMs)) continue
    const kind = match[7].trim()
    if (!LEARNED_KINDS.has(kind)) continue
    const body = section.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()
    const title = body
      .replace(/^(Q[:：]|题目[:：]|问题[:：]|地方[:：]|作品[:：])\s*/, '')
      .replace(/\s*(她写下的[:：]|答[:：]|她自己的结论[:：]).*$/, '')
      .slice(0, 60)
    items.push({ at, kind, title, body })
  }
  return items.sort((a, b) => a.at - b.at).slice(-limit)
}

/**
 * 对一条学习记录做评价：目标相关性、可控性、确定性、归因 → 情绪 + 强度。
 * @param {{kind:string,title:string,body:string}} entry
 * @param {{focus?: string}} [context]
 */
export function appraiseLearningEntry(entry, context = {}) {
  const kind = String(entry?.kind ?? '')
  const title = String(entry?.title ?? '').trim()
  const body = String(entry?.body ?? '')
  const focus = String(context.focus ?? '')
  const failed = FAILURE_PATTERNS.test(body) || FAILURE_PATTERNS.test(title)
  const uncertain = UNCERTAIN_PATTERNS.test(body) || UNCERTAIN_PATTERNS.test(title)
  // 目标相关性：研究/自学高；若与此刻 focus 重合再加成。
  const topicRelated = focus.length >= 2 && title.length >= 2 && title.includes(focus.slice(0, 6))
  const relevance = Math.min(1, (kind === '自主研究' ? 0.8 : kind === '自学' ? 0.7 : 0.5) + (topicRelated ? 0.2 : 0))
  const controllability = failed ? 0.25 : uncertain ? 0.5 : 0.75
  const certainty = failed ? 0.2 : uncertain ? 0.35 : 0.8
  const agency = 0.8 // 她自己的学习/研究，归因于自己
  const valence = failed ? -0.6 : uncertain ? -0.15 : 0.55
  const arousal = Math.min(1, 0.35 + relevance * 0.3 + (failed || uncertain ? 0.2 : 0))
  let emotion = '有点亮'
  if (failed && controllability < 0.4) emotion = '闷'
  else if (failed && relevance >= 0.7) emotion = '不甘'
  else if (!failed && uncertain) emotion = '悬着'
  else if (!failed && relevance >= 0.7) emotion = '踏实'
  return {
    dimensions: { relevance: round2(relevance), controllability: round2(controllability), certainty: round2(certainty), agency },
    valence: round2(valence),
    arousal: round2(arousal),
    emotion,
    intensity: round2(Math.max(0.2, Math.min(0.8, relevance * 0.5 + (failed ? 0.25 : 0)))),
    topic: title || kind,
  }
}

function round2(value) {
  return Number(Number(value).toFixed(2))
}

/** 给一条评价生成一句可写进 journal/情绪线程的短句。 */
export function formatAppraisal(appraisal, entry) {
  const label = appraisal?.emotion ?? '有点亮'
  const topic = String(entry?.title ?? '').slice(0, 40)
  return `这件事让我有点${label}：${topic}`
}

/** 每 30–60 分钟扫一次 learning-log，把新学习结果写进情绪线程。 */
export function createAppraisalLoop(options = {}) {
  const env = options.env ?? process.env
  const file = options.stateFile ?? null
  const learningLogPath = String(options.learningLogPath ?? '')
  const emotional = options.emotional ?? null
  const affect = options.affect ?? null
  const emotionalEpisodes = options.emotionalEpisodes ?? null
  const journal = options.journal ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : 45 * 60 * 1000
  const firstMs = Number.isFinite(options.firstMs) && options.firstMs >= 0 ? options.firstMs : 5 * 60 * 1000
  const disabled = String(env.DSH_POETRY_APPRAISAL ?? '').toLowerCase() === 'off'
  let timer = null
  let lastResult = null

  function readState() {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      return { lastSeenAt: 0 }
    }
  }
  function saveState(next) {
    if (file === null) return
    try {
      writeJsonAtomic(file, { ok: true, v: 1, ...next })
    } catch (error) {
      /* ignore */
    }
  }

  async function runOnce(input = {}) {
    const at = now()
    const since = Number.isFinite(input.since) ? input.since : readState().lastSeenAt || at - 6 * 60 * 60 * 1000
    const entries = readLearningEntries(learningLogPath, since, 20)
    const applied = []
    for (const entry of entries) {
      const appraisal = appraiseLearningEntry(entry, { focus: options.getFocus ? safeFocus(options.getFocus) : '' })
      try {
        if (affect && typeof affect.update === 'function') affect.update({ valence: appraisal.valence, arousal: appraisal.arousal, weight: appraisal.intensity, tag: appraisal.emotion })
      } catch (error) {
        /* 情绪状态写入失败不影响评价 */
      }
      try {
        if (emotionalEpisodes && typeof emotionalEpisodes.record === 'function') {
          const eventType = failed ? 'learning_failure' : uncertain ? 'research_stuck' : 'learning_success'
          await emotionalEpisodes.record({ type: eventType, cause: entry.title || entry.kind, intensity: appraisal.intensity })
        }
      } catch (error) {
        /* 情绪事件写入失败不影响评价 */
      }
      try {
        if (emotional && typeof emotional.record === 'function') {
          emotional.record({
            topic: appraisal.topic,
            emotion: appraisal.emotion,
            note: `学习结果评价：相关 ${appraisal.dimensions.relevance} / 可控 ${appraisal.dimensions.controllability} / 确定 ${appraisal.dimensions.certainty}`,
            intensity: appraisal.intensity,
          })
        }
        if (journal && typeof journal.append === 'function') {
          await journal.append({ kind: 'thought', text: formatAppraisal(appraisal, entry) })
        }
        applied.push({ title: appraisal.topic, emotion: appraisal.emotion, intensity: appraisal.intensity })
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] 情绪评价写入失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const latest = entries.length > 0 ? Math.max(...entries.map((entry) => entry.at)) : since
    saveState({ lastSeenAt: latest, lastRunAt: at })
    lastResult = { at, scanned: entries.length, applied: applied.length, appliedList: applied.slice(-5) }
    if (applied.length > 0) logger?.info?.(`[dsh-little-whale] 情绪评价：${applied.length} 条学习结果 → 情绪线程`)
    return lastResult
  }

  const heartbeat = options.heartbeat ?? null
  function start() {
    if (disabled || timer !== null) return
    if (heartbeat !== null && typeof heartbeat.add === 'function') {
      heartbeat.add('学习评价', () => runOnce().catch(() => {}), { everyMs: intervalMs, offsetMs: firstMs })
      return
    }
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => runOnce().catch(() => {}), intervalMs)
      timer.unref?.()
    }, firstMs)
    timer.unref?.()
  }
  function stop() {
    if (timer !== null) {
      clearTimeout(timer)
      clearInterval(timer)
      timer = null
    }
  }
  return { runOnce, start, stop, snapshot: () => ({ disabled, last: lastResult, state: readState() }) }
}

function safeFocus(getFocus) {
  try {
    const value = getFocus()
    return typeof value === 'string' ? value : ''
  } catch (error) {
    return ''
  }
}
