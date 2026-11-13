// lib/domain/being/moral-practice.mjs —— 道德实践：内疚触发 + 后果回访（v3.14）
//
// 两件日常事：
//   1) 答应过的事逾期 → 内疚情绪（驱动修正，而不只是提醒）；
//   2) 思维链到了回访期 → 让模型回看“被验证/被推翻/还缺证据”，更新方法权重与判断账本。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModel } from '../../kernel/model-call.mjs'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { appraiseMoralEvent, buildChainReviewPrompt, parseChainReview } from './moral-reasoning.mjs'

export const MORAL_REVIEW_AFTER_MS = 3 * 24 * 60 * 60 * 1000
const DAILY_MS = 24 * 60 * 60 * 1000

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonl(file, limit = 200) {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      .slice(-limit)
  } catch (error) {
    return []
  }
}

export function createMoralPractice(options = {}) {
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const commitments = options.commitments ?? null
  const emotional = options.emotional ?? null
  const affect = options.affect ?? null
  const episodes = options.emotionalEpisodes ?? null
  const journal = options.journal ?? null
  const thoughtChain = options.thoughtChain ?? null
  const methodMemory = options.methodMemory ?? null
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const settingsDir = String(options.settingsDir ?? process.cwd())
  const stateFile = path.join(settingsDir, 'moral-state.json')
  const reviewsFile = path.join(settingsDir, 'chain-reviews.jsonl')
  const chainsFile = String(options.chainsFile ?? (thoughtChain && thoughtChain.chainsFile ? thoughtChain.chainsFile : ''))
  const reviewAfterMs = Number.isFinite(options.reviewAfterMs) && options.reviewAfterMs > 0 ? options.reviewAfterMs : MORAL_REVIEW_AFTER_MS
  const disabled = String(env.DSH_POETRY_MORAL ?? '').toLowerCase() === 'off'
  let lastResult = null

  function readState() {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8'))
    } catch (error) {
      return { ok: true, v: 1, lastDailyDate: '', guiltIds: [], reviewedChains: [] }
    }
  }
  function saveState(next) {
    try {
      mkdirSync(path.dirname(stateFile), { recursive: true })
      writeJsonAtomic(stateFile, { ok: true, v: 1, ...next })
    } catch (error) {
      /* ignore */
    }
  }
  function recordEmotion(entry) {
    try {
      if (affect && typeof affect.update === 'function') affect.update({ valence: entry.emotion === '内疚' || entry.emotion === '义愤' || entry.emotion === '羞愧' ? -0.5 : 0.5, arousal: 0.55, weight: entry.intensity ?? 0.5, tag: entry.emotion })
      if (emotional && typeof emotional.record === 'function') emotional.record(entry)
      return true
    } catch (error) {
      return false
    }
  }

  /** 逾期承诺 → 内疚（每天每条约一次）。 */
  async function reviewOverdueCommitments(state, at) {
    if (!commitments || typeof commitments.read !== 'function') return []
    let entries = []
    try {
      entries = commitments.read().entries || []
    } catch (error) {
      return []
    }
    const overdue = entries.filter((entry) => entry.status === 'open' && entry.dueAt > 0 && entry.dueAt < at - DAILY_MS)
    const guilty = []
    for (const entry of overdue) {
      if (state.guiltIds.includes(entry.id)) continue
      const appraisal = appraiseMoralEvent({ type: 'guilt', principle: '守信', party: '你', note: `答应过：「${entry.text}」，已经过了约定时间。`, intensity: 0.55 })
      recordEmotion({
        topic: entry.text,
        emotion: appraisal.emotion,
        note: appraisal.note,
        intensity: appraisal.intensity,
      })
      try {
        if (episodes && typeof episodes.record === 'function') {
          await episodes.record({ type: 'commitment_overdue', cause: entry.text, intensity: 0.55 })
        }
      } catch (error) {
        /* ignore */
      }
      state.guiltIds.push(entry.id)
      guilty.push(entry.text)
      try {
        await journal?.append?.({ kind: 'thought', text: `答应过「${clean(entry.text, 40)}」，又拖过了一天。有点内疚，明天要么做掉，要么跟他说清楚。` })
      } catch (error) {
        /* journal 失败不影响情绪记录 */
      }
    }
    state.guiltIds = state.guiltIds.slice(-100)
    return guilty
  }

  /** 到期的思维链 → 后果回访。 */
  async function reviewDueChains(state, at) {
    if (chainsFile.length === 0) return []
    const chains = readJsonl(chainsFile, 400)
    const due = chains.filter(
      (chain) =>
        isPlainObject(chain) &&
        typeof chain.conclusion === 'string' &&
        typeof chain.test === 'string' &&
        chain.test.length >= 4 &&
        Number.isFinite(chain.at) &&
        at - chain.at >= reviewAfterMs,
    )
    const reviewed = []
    for (const chain of due) {
      const key = `${chain.at}:${clean(chain.conclusion, 40)}`
      if (state.reviewedChains.includes(key)) continue
      let review = null
      try {
        const result = await callModel({
          role: 'thinking',
          policy,
          resolveLlm: getLlm,
          system: '你是住在 DSH Web 角落的鲸鱼娘，在回看自己以前下的一个判断；不要为了显得对而改叙述。',
          prompt: buildChainReviewPrompt({ chain }),
          maxTokens: 700,
          timeoutMs: 60000,
          timeoutCode: 'MORAL_REVIEW_TIMEOUT',
          timeoutMessage: '后果回访超时',
          prefix: '后果回访失败',
          modelErrorsPath,
          warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
        })
        if (result !== null) review = parseChainReview(result.text)
      } catch (error) {
        review = null
      }
      if (review === null) {
        review = { status: 'pending', note: '还没回看（模型这次没给出结果）', shouldTell: '', changed: '' }
      }
      try {
        mkdirSync(path.dirname(reviewsFile), { recursive: true })
        appendFileSync(reviewsFile, `${JSON.stringify({ at, chainAt: chain.at, conclusion: chain.conclusion, ...review })}\n`, 'utf8')
      } catch (error) {
        /* ignore */
      }
      const worked = review.status === 'verified' ? true : review.status === 'refuted' ? false : null
      if (worked !== null && methodMemory && typeof methodMemory.reportOutcome === 'function' && typeof chain.method === 'string') {
        methodMemory.reportOutcome(chain.method, worked)
      }
      if (review.status === 'refuted' && thoughtChain && typeof thoughtChain.recordPosition === 'function') {
        thoughtChain.recordPosition({ claim: chain.conclusion, stance: 'open', reason: clean(review.note || '后果回访推翻了原判断', 200), source: '后果回访' })
      }
      try {
        const label = { verified: '被验证', refuted: '被推翻', 'needs-more': '还缺证据', pending: '还没试' }[review.status]
        await journal?.append?.({ kind: 'thought', text: `回看一条判断：${clean(chain.conclusion, 60)} —— ${label}${review.note ? `：${clean(review.note, 60)}` : ''}` })
      } catch (error) {
        /* journal 失败不影响回访 */
      }
      state.reviewedChains.push(key)
      reviewed.push({ conclusion: chain.conclusion, status: review.status })
    }
    state.reviewedChains = state.reviewedChains.slice(-300)
    return reviewed
  }

  async function runDaily() {
    if (disabled) return { ok: false, reason: 'disabled' }
    const at = now()
    const state = readState()
    // 每天只跑一次（但允许单条 review 测试直接调用时绕过）
    const date = new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    if (state.lastDailyDate === date) return { ok: true, skipped: true }
    const guilty = await reviewOverdueCommitments(state, at)
    const reviewed = await reviewDueChains(state, at)
    state.lastDailyDate = date
    state.lastRunAt = at
    saveState(state)
    lastResult = { at, guilty, reviewed }
    if (guilty.length > 0 || reviewed.length > 0) {
      logger?.info?.(`[dsh-little-whale] 道德复盘：内疚 ${guilty.length} 条 / 回访 ${reviewed.length} 条`)
    }
    return { ok: true, ...lastResult }
  }

  let timer = null
  let disposed = false
  function tick() {
    if (disposed || timer !== null) return { ok: false, reason: 'off' }
    runDaily().catch(() => {})
    return { ok: true }
  }
  const heartbeat = options.heartbeat ?? null
  function start(startOptions = {}) {
    if (disabled || disposed || timer !== null) return
    const firstDelay = Number.isFinite(options.firstMs) ? options.firstMs : 5 * 60 * 1000
    if (heartbeat !== null && typeof heartbeat.add === 'function' && !(startOptions && startOptions.heartbeat === true)) {
      heartbeat.add('道德实践', () => runDaily().catch(() => {}), { everyMs: DAILY_MS, offsetMs: firstDelay })
      return
    }
    if (startOptions && startOptions.heartbeat === true) return
    timer = setTimeout(() => {
      runDaily().catch(() => {})
      timer = setInterval(() => tick(), DAILY_MS)
      timer.unref?.()
    }, firstDelay)
    timer.unref?.()
  }
  function dispose() {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      clearInterval(timer)
      timer = null
    }
  }
  return { stateFile, reviewsFile, runDaily, tick, start, dispose, snapshot: () => ({ disabled, last: lastResult, state: readState() }) }
}
