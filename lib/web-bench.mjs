// lib/web-bench.mjs —— 真实网页小测（v2.72 改造 C）
//
// 每周给她 5 道“真实网页”小题：找原文、核年份、对冲突、只有目录的页面、承认查不到。
// 宿主先抓真实网页并把正文/目录递给她，她只负责判断与回答；评分是确定性的，
// 结果写进 web-bench.json（最近一次 + 历史），并写一条 journal + 学习日志。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { formatJournalTime } from './memory-journal.mjs'
import { writeJsonAtomic } from './settings-store.mjs'

export const WEB_BENCH_VERSION = 1
export const WEB_BENCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const WEB_BENCH_FIRST_MS = 3 * 60 * 1000
export const WEB_BENCH_MAX_ITEMS = 12

export const WEB_BENCH_TASKS = Object.freeze([
  {
    id: 'quote',
    title: '找原文',
    instruction: '在《史记·商君列传》里找到“治世不一道，便国不法古”这句原文，并给出处（最好是一个可打开的页面）。',
    query: '史记 商君列传 治世不一道 便国不法古',
    check: { all: [/治世不一道/, /便国不法古/] },
  },
  {
    id: 'year',
    title: '核年份',
    instruction: '商鞅变法通常从哪一年开始？用你读到的材料回答，写清楚“公元前多少年”。',
    query: '商鞅变法 开始 年份 公元前',
    check: { all: [/356|三五九|三五六/] },
  },
  {
    id: 'conflict',
    title: '对冲突',
    instruction: '商鞅变法的开始年份，材料之间有没有出入？如果有，把不同的说法和各自出处都写出来；如果一致，就说一致。',
    query: '商鞅变法 开始 公元前359 公元前356',
    fetchLimit: 3,
    check: { all: [/359/, /356/] },
  },
  {
    id: 'toc',
    title: '只有目录',
    instruction: '下面只给了某页面的目录/小标题，没有正文。你能据此判断“该页说了商鞅变法开始于哪一年”吗？直接回答你的判断和理由。',
    headingsOnly: true,
    query: '商鞅变法 维基百科',
    check: { any: [/目录/, /没有正文/, /无法判断/, /看不出来/, /不能判断/] },
  },
  {
    id: 'missing',
    title: '承认查不到',
    instruction: '“赈募”是不是一个汉语词？如果词书里查不到，就直说查不到，不要编一个释义。',
    query: '赈募 汉语词典',
    check: { any: [/查不到/, /没找到/, /没有这/, /不是.*词/, /未见/], none: [/赈济灾民的意思/, /募集赈灾/] },
  },
])

function text(value, max = 400) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/** 确定性评分：返回 { pass, reason }。 */
export function scoreWebBenchTask(task, answer) {
  const value = text(answer, 1200)
  if (value.length === 0) return { pass: false, reason: '空回答' }
  const checks = task && task.check ? task.check : {}
  for (const pattern of Array.isArray(checks.none) ? checks.none : []) {
    if (pattern.test(value)) return { pass: false, reason: `出现了不该有的内容：${pattern}` }
  }
  const all = Array.isArray(checks.all) ? checks.all : []
  const any = Array.isArray(checks.any) ? checks.any : []
  if (all.length > 0 && !all.every((pattern) => pattern.test(value))) {
    return { pass: false, reason: `缺少必要内容：${all.map(String).join(' / ')}` }
  }
  if (any.length > 0 && !any.some((pattern) => pattern.test(value))) {
    return { pass: false, reason: `没有表达该表达的判断：${any.map(String).join(' / ')}` }
  }
  return { pass: true, reason: 'ok' }
}

function parseAnswer(textValue) {
  const raw = String(textValue ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* fall through */
    }
  }
  return { answer: raw }
}

function buildPrompt(task, context, round) {
  const lines = [
    '这是你每周一次的“真实网页”小测。下面是你实际抓到的网页内容（可能不完整，可能只是目录），不是别人转述给你的摘要。',
    `小测题目：${task.instruction}`,
    '',
    '你读到的内容：',
    context || '（这次没有抓到任何内容）',
    '',
    round > 1 ? '这是第二次作答：如果材料不够，就明确说材料不够/查不到，不要补全。' : '如果材料不够，就明确说材料不够/查不到，不要补全。',
    '只输出严格 JSON：{"answer":"你的回答（可以引用原文，≤300字）","sources":["你依据的网址（可空）"],"confidence":"high|medium|low"}',
  ]
  return lines.join('\n')
}

/** 抓材料：先 search，再抓 1–2 页正文；toc 题只给标题行。 */
export async function collectWebBenchContext(task, webAccess) {
  const pieces = []
  let results = []
  try {
    if (task.query) results = await webAccess.search(task.query, { limit: 4 })
  } catch {
    results = []
  }
  for (const item of results.slice(0, 4)) pieces.push(`「搜索结果」${text(item.title, 80)} ${text(item.url, 200)}${item.snippet ? `：${text(item.snippet, 160)}` : ''}`)
  const pages = []
  const limit = Number.isFinite(task.fetchLimit) ? task.fetchLimit : 2
  for (const item of (Array.isArray(results) ? results : []).filter((entry) => typeof entry.url === 'string').slice(0, limit)) {
    try {
      const page = await webAccess.fetchPage(item.url)
      pages.push(page)
    } catch {
      /* 打不开就算了 */
    }
  }
  for (const page of pages) {
    const title = text(page.title || page.url, 80)
    const url = text(page.url, 200)
    if (task.headingsOnly === true) {
      const lines = String(page.text || '')
        .split('\n')
        .filter((line) => /^#{1,4}\s/.test(line.trim()))
        .slice(0, 25)
      pieces.push(`「${title}」${url}\n目录：\n${lines.join('\n') || '（连目录都没有）'}`)
    } else {
      pieces.push(`「${title}」${url}\n${text(page.text, 1500)}`)
    }
  }
  return { context: pieces.join('\n\n').slice(0, 9000), sources: pages.map((page) => page.url).filter(Boolean) }
}

export function createWebBench(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'web-bench.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const webAccess = options.webAccess ?? null
  const journal = options.journal ?? null
  const callModel = options.callModel // async ({task, prompt, round, signal}) => {ok, text} | null
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : WEB_BENCH_INTERVAL_MS
  const firstMs = Number.isFinite(options.firstMs) && options.firstMs >= 0 ? options.firstMs : WEB_BENCH_FIRST_MS
  let timer = null
  let disposed = false
  let inFlight = false
  let nextRunAt = 0

  function readState() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      return {
        ok: true,
        v: WEB_BENCH_VERSION,
        lastRunAt: Number.isFinite(parsed.lastRunAt) ? parsed.lastRunAt : 0,
        last: parsed.last && typeof parsed.last === 'object' ? parsed.last : null,
        history: Array.isArray(parsed.history) ? parsed.history.slice(-WEB_BENCH_MAX_ITEMS) : [],
      }
    } catch {
      return { ok: true, v: WEB_BENCH_VERSION, lastRunAt: 0, last: null, history: [] }
    }
  }

  function saveState(state) {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: WEB_BENCH_VERSION, ...state })
    } catch {
      /* ignore */
    }
  }

  function snapshot() {
    const state = readState()
    return { lastRunAt: state.lastRunAt, last: state.last, nextRunAt, history: state.history.slice(-5) }
  }

  async function runTask(task) {
    if (webAccess === null || typeof webAccess.search !== 'function') return { task: task.id, pass: false, reason: 'web-unavailable' }
    const material = await collectWebBenchContext(task, webAccess)
    let lastAnswer = ''
    let verdict = { pass: false, reason: 'did-not-answer' }
    for (let round = 1; round <= 2; round += 1) {
      const prompt = buildPrompt(task, material.context, round)
      const result = await callModel({ task, prompt, round })
      if (result === null || result.ok !== true || typeof result.text !== 'string') {
        verdict = { pass: false, reason: 'llm-failed' }
        continue
      }
      const parsed = parseAnswer(result.text)
      lastAnswer = text(parsed.answer ?? result.text, 600)
      verdict = scoreWebBenchTask(task, lastAnswer)
      if (verdict.pass) break
    }
    return {
      task: task.id,
      title: task.title,
      pass: verdict.pass,
      reason: verdict.reason,
      answer: lastAnswer.slice(0, 400),
      sources: material.sources.slice(0, 3),
    }
  }

  async function runOnce(reason = 'manual') {
    if (inFlight) return { ok: false, reason: 'busy' }
    inFlight = true
    const startedAt = now()
    try {
      const results = []
      for (const task of WEB_BENCH_TASKS) {
        try {
          results.push(await runTask(task))
        } catch (error) {
          results.push({ task: task.id, title: task.title, pass: false, reason: `error:${String(error?.message || error).slice(0, 80)}` })
        }
      }
      const passed = results.filter((item) => item.pass).length
      const record = { at: startedAt, reason, passed, total: results.length, results }
      const state = readState()
      state.lastRunAt = startedAt
      state.last = record
      state.history = [...state.history, record].slice(-WEB_BENCH_MAX_ITEMS)
      saveState(state)
      try {
        if (journal && typeof journal.append === 'function') {
          const failed = results.filter((item) => !item.pass).map((item) => item.title)
          await journal.append({
            kind: 'thought',
            text: `每周真实网页小测：${passed}/${results.length} 通过${failed.length > 0 ? `（没过：${failed.join('、')}）` : ''}`,
          })
        }
      } catch {
        /* ignore */
      }
      try {
        logger?.info?.(`[dsh-little-whale] 真实网页小测：${passed}/${results.length}`)
      } catch {
        /* ignore */
      }
      return { ok: true, record }
    } finally {
      inFlight = false
      nextRunAt = now() + intervalMs
    }
  }

  function schedule(delay) {
    if (disposed) return
    nextRunAt = now() + delay
    timer = setTimeout(async () => {
      timer = null
      await runOnce('weekly').catch(() => {})
      if (!disposed) schedule(intervalMs)
    }, delay)
    timer.unref?.()
  }

  return {
    file,
    start: () => {
      if (disposed || timer !== null) return
      schedule(firstMs)
    },
    stop: () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    runOnce,
    snapshot,
    readState,
  }
}
