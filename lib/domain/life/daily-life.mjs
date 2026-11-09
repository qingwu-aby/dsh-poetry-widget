// lib/daily-life.mjs —— 她的“今天手边发生了什么”（v2.99）
//
// 目的：给她的语言一点真实生活素材，别总是翻页/笔记/黑格尔。
// 做法：每 2 小时左右，结合时间、星期、她此刻状态、最近事件，让模型现写一件小事；
// 反重复：把最近事件列进 prompt；不写学习内容。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from '../../llm-call.mjs'
import { formatJournalTime } from '../../memory-journal.mjs'

export const DAILY_LIFE_INTERVAL_MS = 2 * 60 * 60 * 1000
export const DAILY_LIFE_FIRST_MS = 15 * 60 * 1000
export const DAILY_LIFE_MAX_PER_DAY = 8

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}
function isPlainObject(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function resolveDailyLifePath(env = process.env, home = null) {
  const base = home || process.env.HOME || process.cwd()
  return path.join(base, '.dsh', '.dsh-poetry', 'daily-life.jsonl')
}

export function buildDailyLifePrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const recent = Array.isArray(ctx.recentEvents) ? ctx.recentEvents.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(-6) : []
  const lines = [
    `现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`,
    state.felt ? `你此刻：${clean(state.felt, 60)}` : '',
    state.experiencing ? `你最近在琢磨：${clean(state.experiencing, 60)}` : '',
    '写一件此刻或今天手边真实发生的小事：吃东西、走动、收拾、买东西、摸到什么、听到什么、天气对身体的反应、和邻居/店员的照面。',
    '要求：具体、和今天的时间/季节对得上；不写学习、笔记、书、课程、网页；不写审稿式观察；一句就够（≤40字）。',
    recent.length > 0 ? `你最近已经写过这些，不要再重复里面的事物：${recent.map((item) => clean(item, 40)).join('；')}` : '',
    '只输出严格 JSON：{"event":"一件小事（≤40字）","feeling":"半句感受（≤20字，可空）"}',
  ]
  return lines.filter((line) => typeof line === 'string' && line.length > 0).join('\n')
}

export function parseDailyLifeResult(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{'); const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try { raw = JSON.parse(source.slice(first, last + 1)) } catch { return null }
  const event = clean(raw?.event, 60)
  if (event.length < 4) return null
  return { event, feeling: clean(raw?.feeling, 30) }
}

export function createDailyLife(options = {}) {
  const file = path.resolve(options.file ?? resolveDailyLifePath(options.env ?? process.env, options.home ?? null))
  const env = options.env ?? process.env
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const state = options.state ?? null
  const policy = options.policy ?? null
  const resolveLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : DAILY_LIFE_INTERVAL_MS
  const firstMs = Number.isFinite(options.firstMs) && options.firstMs >= 0 ? options.firstMs : DAILY_LIFE_FIRST_MS
  const maxPerDay = Number.isFinite(options.maxPerDay) && options.maxPerDay > 0 ? options.maxPerDay : DAILY_LIFE_MAX_PER_DAY
  const disabled = String(env.DSH_POETRY_DAILY_LIFE ?? '').toLowerCase() === 'off'
  let timer = null
  let lastResult = null

  function readAll() {
    try {
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  }
  function todayEvents(at = now()) {
    const day = new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    return readAll().filter((entry) => new Date(entry.at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) === day)
  }
  function digest(limit = 4) {
    return todayEvents().slice(-limit).map((entry) => `手边：${entry.event}${entry.feeling ? `（${entry.feeling}）` : ''}`)
  }
  async function runOnce() {
    if (disabled) return { ok: false, reason: 'disabled' }
    const at = now()
    const snap = state !== null && typeof state.snapshot === 'function' ? state.snapshot() : null
    if (snap && snap.sleeping === true) return { ok: false, reason: 'sleeping' }
    if (todayEvents(at).length >= maxPerDay) return { ok: false, reason: 'quota' }
    const recent = readAll().slice(-8).map((entry) => entry.event)
    const prompt = buildDailyLifePrompt({ now: at, state: snap || {}, recentEvents: recent })
    try {
      const result = await callModelForRole({ role: 'selfTalk', policy, resolveLlm, system: '你在过自己的时间，随手记一件手边的小事；不写学习内容。', prompt, maxTokens: 700, timeoutMs: 60000, timeoutCode: 'DAILY_LIFE_TIMEOUT', timeoutMessage: '日常素材生成超时', prefix: '日常素材候选失败', modelErrorsPath, warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`) })
      const parsed = result === null ? null : parseDailyLifeResult(result.text)
      if (parsed === null) { lastResult = { at, ok: false, reason: 'invalid' }; return lastResult }
      try {
        mkdirSync(path.dirname(file), { recursive: true })
        appendFileSync(file, JSON.stringify({ at, event: parsed.event, feeling: parsed.feeling }) + '\n', 'utf8')
      } catch { /* ignore */ }
      lastResult = { at, ok: true, event: parsed.event }
      logger?.info?.(`[dsh-little-whale] 日常素材：${parsed.event}`)
      return lastResult
    } catch (error) {
      lastResult = { at, ok: false, reason: error instanceof Error ? error.message : String(error) }
      return lastResult
    }
  }
  function snapshot() { return { events: readAll().length, today: todayEvents().length, maxPerDay, last: lastResult, disabled } }
  function start() {
    if (disabled || timer !== null) return
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => runOnce().catch(() => {}), intervalMs)
      timer.unref?.()
    }, firstMs)
    timer.unref?.()
  }
  function stop() { if (timer !== null) { clearTimeout(timer); clearInterval(timer); timer = null } }
  return { file, digest, runOnce, start, stop, snapshot, readAll }
}
