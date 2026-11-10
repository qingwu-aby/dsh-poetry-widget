// lib/domain/learning/self-philosophy.mjs —— 哲学阅读服务（v3.13：整本读完 + 判断/思维链）
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModel } from '../../kernel/model-call.mjs'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { buildThoughtChainPrompt, formatChainForLog, parseThoughtChain } from './thought-chain.mjs'
import {
  PHILOSOPHY_FIRST_MAX_MS,
  PHILOSOPHY_FIRST_MIN_MS,
  PHILOSOPHY_GAP_MS,
  PHILOSOPHY_LIST_TTL_MS,
  PHILOSOPHY_RETRY_MS,
  PHILOSOPHY_TIMEOUT_MS,
  PHILOSOPHY_TICK_MS,
  buildBookSynthesisPrompt,
  buildPhilosophyPrompt,
  cleanInline,
  fetchPhilosophyBook,
  formatBookSynthesisLog,
  formatPhilosophyLog,
  isPlainObject,
  listPhilosophyBooks,
  parseBookSynthesis,
  parsePhilosophyReply,
  recentNotesForPrompt,
  seedPhilosophyBooks,
  shortMessage,
  splitBookIntoChunks,
} from './self-philosophy-core.mjs'

export * from './self-philosophy-core.mjs'

/** 追加学习日志：保证与上一条之间有空行（上一条可能没有末尾换行）。 */
function appendLearningLog(file, text) {
  mkdirSync(path.dirname(file), { recursive: true })
  let prefix = ''
  try {
    const current = readFileSync(file, 'utf8')
    if (current.length > 0 && !current.endsWith('\n')) prefix = '\n'
  } catch (error) {
    prefix = ''
  }
  appendFileSync(file, prefix + text, 'utf8')
}

/** 哲学阅读服务：每 2 小时读一段，**整本读完**；读完做总结合成 + 思维链。 */
export function createSelfPhilosophy(options = {}) {
  const env = options.env ?? process.env
  const state = options.state ?? null
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const journal = options.journal ?? null
  const methodMemory = options.methodMemory ?? null
  const thoughtChain = options.thoughtChain ?? null
  const learningLogPath = String(options.learningLogPath ?? '')
  const statePath = path.resolve(options.statePath ?? path.join(process.cwd(), 'philosophy-state.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const gapMs = Number.isFinite(options.gapMs) && options.gapMs > 0 ? options.gapMs : PHILOSOPHY_GAP_MS
  const retryMs = Number.isFinite(options.retryMs) && options.retryMs > 0 ? options.retryMs : PHILOSOPHY_RETRY_MS
  const firstMinMs = Number.isFinite(options.firstMinMs) && options.firstMinMs >= 0 ? options.firstMinMs : PHILOSOPHY_FIRST_MIN_MS
  const firstMaxMs = Number.isFinite(options.firstMaxMs) && options.firstMaxMs >= firstMinMs ? options.firstMaxMs : PHILOSOPHY_FIRST_MAX_MS
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PHILOSOPHY_TIMEOUT_MS
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const disabled = String(env.DSH_POETRY_PHILOSOPHY ?? '').toLowerCase() === 'off'
  let lastAt = 0
  let lastResult = null
  let timer = null
  let heartbeatMode = false
  let disposed = false

  const persisted = loadState()
  lastAt = Number.isFinite(persisted.lastAt) ? persisted.lastAt : 0
  let recentPaths = Array.isArray(persisted.recentPaths) ? persisted.recentPaths.slice(-60) : []
  let books = isPlainObject(persisted.books) ? persisted.books : {}
  let currentKey = typeof persisted.currentKey === 'string' ? persisted.currentKey : ''
  let cachedBooks = Array.isArray(persisted.booksList) ? persisted.booksList : []
  let booksAt = Number.isFinite(persisted.booksAt) ? persisted.booksAt : 0

  function loadState() {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf8'))
      return isPlainObject(raw) ? raw : {}
    } catch (error) {
      return {}
    }
  }
  function persist() {
    try {
      mkdirSync(path.dirname(statePath), { recursive: true })
      writeJsonAtomic(statePath, { ok: true, v: 2, lastAt, recentPaths, books, currentKey, booksList: cachedBooks, booksAt })
    } catch (error) {
      /* ignore */
    }
  }
  function warn(message) {
    logger?.warn?.(`[dsh-little-whale] ${message}`)
  }
  function info(message) {
    logger?.info?.(`[dsh-little-whale] ${message}`)
  }
  async function loadBookList(force = false) {
    const at = now()
    if (!force && cachedBooks.length > 0 && at - booksAt < PHILOSOPHY_LIST_TTL_MS) return cachedBooks
    let list = await listPhilosophyBooks({ fetchImpl, timeoutMs })
    if (list.length === 0) list = seedPhilosophyBooks()
    if (list.length > 0) {
      cachedBooks = list
      booksAt = at
      persist()
    }
    return list
  }
  function pickNextBook(list) {
    const pending = list.filter((book) => {
      const key = `${book.repo}:${book.path}`
      const progress = books[key]
      return !(progress && progress.completedAt) && !recentPaths.includes(key)
    })
    const pool = pending.length > 0 ? pending : list.filter((book) => !(books[`${book.repo}:${book.path}`]?.completedAt))
    if (pool.length === 0) return list[Math.floor(Math.random() * Math.max(1, list.length))] ?? null
    return pool[Math.floor(Math.random() * pool.length)] ?? null
  }
  function currentConcern() {
    try {
      const snap = state !== null && typeof state.snapshot === 'function' ? state.snapshot() : null
      const text = String((snap && (snap.experiencing || snap.felt)) || '').trim()
      return text.length >= 2 ? text.slice(0, 120) : '最近自己反复想起的一件事'
    } catch (error) {
      return '最近自己反复想起的一件事'
    }
  }
  async function callRoleModel({ role, system, prompt, maxTokens, attempts = null, timeoutCode, timeoutMessage, prefix }) {
    return callModel({
      role,
      policy,
      resolveLlm: getLlm,
      system,
      prompt,
      maxTokens,
      ...(Array.isArray(attempts) ? { attempts } : {}),
      timeoutMs: 90000,
      timeoutCode,
      timeoutMessage,
      prefix,
      modelErrorsPath,
      warn,
    })
  }
  async function synthesizeBook(book, progress, at) {
    const notes = Array.isArray(progress.notes) ? progress.notes : []
    const methods = methodMemory && typeof methodMemory.digest === 'function' ? methodMemory.digest(6) : []
    const result = await callRoleModel({
      role: 'philosophy',
      system: '你是住在 DSH Web 角落的鲸鱼娘，刚读完一本书；只写你自己的判断与结构，不复述内容，不装懂。',
      prompt: buildBookSynthesisPrompt({ title: book.title, notes, methods }),
      maxTokens: 4000,
      attempts: [{ maxTokens: 4000 }, { maxTokens: 6000 }],
      timeoutCode: 'SELF_PHILOSOPHY_SYNTHESIS_TIMEOUT',
      timeoutMessage: '哲学总结合成超时',
      prefix: '哲学总结合成失败',
    })
    if (result === null) return null
    const synthesis = parseBookSynthesis(result.text)
    if (synthesis === null) return null
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, formatBookSynthesisLog({ title: book.title, synthesis, at }), 'utf8')
    if (thoughtChain && typeof thoughtChain.recordPosition === 'function') {
      for (const item of synthesis.accept) thoughtChain.recordPosition({ claim: item.claim, stance: 'accept', reason: item.reason, source: book.title })
      for (const item of synthesis.reject) thoughtChain.recordPosition({ claim: item.claim, stance: 'reject', reason: item.reason, source: book.title })
      for (const item of synthesis.open) thoughtChain.recordPosition({ claim: item.claim, stance: 'open', reason: item.reason, source: book.title })
    }
    let chainSaved = false
    if (thoughtChain && typeof thoughtChain.saveChain === 'function') {
      try {
        const positions = typeof thoughtChain.positionsDigest === 'function' ? thoughtChain.positionsDigest(6) : []
        const chainResult = await callRoleModel({
          role: 'thinking',
          system: '你是住在 DSH Web 角落的鲸鱼娘，刚刚读完一本哲学书；现在把书里的方法用到你真正在意的一件事上，写一条可检验的思维链。',
          prompt: buildThoughtChainPrompt({
            concern: currentConcern(),
            materials: [synthesis.question, synthesis.changed, synthesis.leftover, ...synthesis.accept.map((item) => item.claim)].filter(Boolean),
            methods: methods.length > 0 ? methods : ['把问题拆成正反与前提'],
            positions,
          }),
          maxTokens: 2600,
          attempts: [{ maxTokens: 2600 }, { maxTokens: 3600 }],
          timeoutCode: 'SELF_PHILOSOPHY_CHAIN_TIMEOUT',
          timeoutMessage: '思维链生成超时',
          prefix: '思维链生成失败',
        })
        if (chainResult !== null) {
          const chain = parseThoughtChain(chainResult.text)
          if (chain !== null) {
            await thoughtChain.saveChain(chain)
            appendLearningLog(learningLogPath, formatChainForLog(chain, at))
            chainSaved = true
          }
        }
      } catch (error) {
        warn(`思维链生成失败：${shortMessage(error)}`)
      }
    }
    try {
      await journal?.append?.({
        kind: 'thought',
        text: `读完《${book.title}》：${cleanInline(synthesis.changed || synthesis.question || synthesis.leftover, 100)}`,
      })
    } catch (error) {
      /* journal 写失败不影响主流程 */
    }
    return { synthesis, chainSaved }
  }
  async function runOnce(input = {}) {
    if (disabled || disposed) return { ok: false, reason: 'disabled' }
    const atNow = now()
    try {
      const list = await loadBookList(input.force === true)
      if (list.length === 0) {
        lastAt = atNow - gapMs + retryMs
        persist()
        return { ok: false, reason: 'no-books' }
      }
      let key = currentKey
      if (key.length === 0 || !books[key] || books[key].completedAt || !list.some((book) => `${book.repo}:${book.path}` === key)) {
        const book = pickNextBook(list)
        if (book === null) return { ok: false, reason: 'no-books' }
        key = `${book.repo}:${book.path}`
        if (!books[key]) {
          books[key] = {
            repo: book.repo,
            path: book.path,
            title: book.title,
            sourceLabel: book.sourceLabel,
            branch: book.branch,
            startedAt: atNow,
            cursor: 0,
            chunkCount: 0,
            totalChars: 0,
            notes: [],
            completedAt: 0,
          }
        }
        currentKey = key
      }
      const progress = books[key]
      const book = { repo: progress.repo, path: progress.path, branch: progress.branch, title: progress.title, sourceLabel: progress.sourceLabel }
      const fetched = await fetchPhilosophyBook({ fetchImpl, book, timeoutMs, maxChars: 4000000 })
      if (fetched === null) {
        lastAt = atNow - gapMs + retryMs
        persist()
        warn(`哲学阅读：这次没取到《${book.title}》，下次再试`)
        return { ok: false, reason: 'fetch' }
      }
      const chunks = splitBookIntoChunks(fetched.text)
      if (chunks.length === 0) {
        lastAt = atNow - gapMs + retryMs
        persist()
        return { ok: false, reason: 'empty' }
      }
      progress.chunkCount = chunks.length
      progress.totalChars = fetched.text.length
      if (progress.cursor >= chunks.length) progress.cursor = chunks.length - 1
      const at = now()
      const methods = methodMemory && typeof methodMemory.digest === 'function' ? methodMemory.digest(4) : []
      const result = await callRoleModel({
        role: 'philosophy',
        system: '你是住在 DSH Web 角落的鲸鱼娘，正在认真读哲学文本；只写你真正读到的，不装懂，不抄原文超过一句。',
        prompt: buildPhilosophyPrompt({
          title: book.title,
          excerpt: chunks[progress.cursor],
          methods,
          now: atNow,
          progress: {
            index: progress.cursor,
            total: chunks.length,
            priorNotes: recentNotesForPrompt(progress.notes),
          },
        }),
        maxTokens: 4000,
        attempts: [{ maxTokens: 4000 }, { maxTokens: 6000 }],
        timeoutCode: 'SELF_PHILOSOPHY_TIMEOUT',
        timeoutMessage: '哲学阅读模型调用超时',
        prefix: '哲学阅读候选失败',
      })
      if (result === null) {
        // 模型空响应：退避重试，避免每个心跳都刷一次。
        lastAt = atNow - gapMs + retryMs
        persist()
        warn('哲学阅读：模型这次没有给出内容，稍后再试')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parsePhilosophyReply(result.text)
      if (parsed === null) {
        warn('哲学阅读结果无效（不是可用 JSON）')
        return { ok: false, reason: 'invalid' }
      }
      appendLearningLog(learningLogPath, formatPhilosophyLog({ title: book.title, sourceLabel: book.sourceLabel, parsed, at, progress: { index: progress.cursor, total: chunks.length } }))
      progress.notes = [...(Array.isArray(progress.notes) ? progress.notes : []), parsed.claim || parsed.ownView || parsed.question || ''].filter(Boolean).slice(-80)
      if (parsed.method && methodMemory && typeof methodMemory.record === 'function') {
        methodMemory.record({ name: parsed.method.name, howTo: parsed.method.howTo, source: book.title, worked: undefined })
      }
      if (parsed.position && thoughtChain && typeof thoughtChain.recordPosition === 'function') {
        thoughtChain.recordPosition({ claim: parsed.position.claim, stance: parsed.position.stance, reason: parsed.position.reason, source: book.title, method: parsed.method ? parsed.method.name : '' })
      }
      progress.cursor += 1
      const completed = progress.cursor >= chunks.length
      let synthesis = null
      let chainSaved = false
      if (completed) {
        progress.completedAt = at
        recentPaths = [...recentPaths, key].slice(-60)
        const synthesized = await synthesizeBook(book, progress, at)
        if (synthesized !== null) {
          synthesis = synthesized.synthesis
          chainSaved = synthesized.chainSaved
        }
        currentKey = ''
        try {
          await journal?.append?.({ kind: 'thought', text: `读哲学：${book.title} 读完了（${chunks.length} 段）` })
        } catch (error) {
          /* journal 写失败不影响主流程 */
        }
      }
      lastAt = at
      persist()
      lastResult = {
        at,
        ok: true,
        title: book.title,
        repo: book.repo,
        chunk: progress.cursor,
        chunks: chunks.length,
        completed,
        method: parsed.method,
        position: parsed.position ? parsed.position.stance : null,
        synthesis,
        chainSaved,
      }
      info(`哲学阅读：${book.title} 第 ${progress.cursor}/${chunks.length} 段${completed ? '（读完）' : ''}`)
      return lastResult
    } catch (error) {
      warn(`哲学阅读异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    }
  }
  function snapshot() {
    let asleep = false
    try {
      const snap = state !== null && typeof state.snapshot === 'function' ? state.snapshot() : null
      asleep = Boolean(snap && snap.asleep)
    } catch (error) {
      asleep = false
    }
    const current = currentKey && books[currentKey] ? books[currentKey] : null
    return {
      disabled,
      lastAt,
      current: current ? { title: current.title, cursor: current.cursor, chunkCount: current.chunkCount, completedAt: current.completedAt } : null,
      books: Object.keys(books).length,
      completed: Object.values(books).filter((book) => book && book.completedAt).length,
      recentPaths: recentPaths.slice(-5),
      last: lastResult,
      asleep,
    }
  }
  function tick() {
    if (disposed || timer !== null) return { ok: false, reason: 'off' }
    const atNow = now()
    if (lastAt > 0 && atNow - lastAt < gapMs) return { ok: false, reason: 'gap' }
    const snap = snapshot()
    if (snap.asleep) return { ok: false, reason: 'asleep' }
    runOnce().catch(() => {})
    return { ok: true }
  }
  function start(startOptions = {}) {
    if (disabled || disposed || timer !== null || heartbeatMode) return
    heartbeatMode = startOptions && startOptions.heartbeat === true
    if (heartbeatMode) return
    const firstDelay = firstMinMs + Math.random() * Math.max(0, firstMaxMs - firstMinMs)
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => tick(), PHILOSOPHY_TICK_MS)
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
  return { statePath, learningLogPath, runOnce, tick, start, dispose, snapshot }
}
