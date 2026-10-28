// lib/twin-research.mjs —— 两只小鲸鱼的自主知识获取（v2.31）。
//
// 偏好：心理学 / 哲学 / 历史；骨干方法：马克思的历史唯物主义与矛盾分析。
// 流程：提出问题 → 真实搜索 → 读一篇真实材料 → 写下分析 → 给另一只鲸鱼写信。
// 只能引用真实搜索/抓取到的来源，不能编造引用。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'
import { parseWikipediaSearchPayload } from './safe-web.mjs'

const DOMAINS = '心理学、哲学、历史（可以延伸到政治经济学、社会学、人类学）'
const METHOD = [
  '以马克思的分析方法为主要骨干：历史唯物主义、具体问题具体分析、矛盾分析（找主要矛盾与主要方面）、阶级与生产关系、实践检验、意识形态批判。',
  '但不要喊口号、不要贴标签；要给出具体的历史条件、机制、反例和限度。',
  '允许你不同意马克思的某个具体结论，但要用材料说明为什么。',
].join('')

function cleanText(value, max = 2000) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function extractJson(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function queryTokens(text) {
  const value = String(text ?? '')
  const words = []
  try {
    const seg = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const part of seg.segment(value)) {
      if (part.isWordLike && part.segment.length >= 2) words.push(part.segment)
    }
  } catch {
    /* ignore */
  }
  if (words.length === 0) {
    for (const chunk of value.split(/[\s,，。！？；：、]+/)) if (chunk.length >= 2) words.push(chunk.slice(0, 8))
  }
  return Array.from(new Set(words)).slice(0, 16)
}

function relevantResults(results, question, keywords) {
  if (!Array.isArray(results)) return []
  const tokens = queryTokens(`${question} ${keywords}`)
  if (tokens.length === 0) return results.slice(0, 3)
  return results
    .map((item) => {
      const hay = `${item?.title ?? ''} ${item?.snippet ?? ''}`
      let score = 0
      for (const token of tokens) if (hay.includes(token)) score += 1
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item)
    .slice(0, 3)
}

export function createTwinResearch(options = {}) {
  const label = options.label === 'twin' ? '镜像' : '原体'
  const agent = options.agent === 'twin' ? 'twin' : 'primary'
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => options.llm
  const policy = options.policy ?? null
  const webAccess = options.webAccess ?? null
  const journal = options.journal
  const learningLogPath = options.learningLogPath
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const threadFile =
    typeof options.threadFile === 'string' && options.threadFile.length > 0 ? path.resolve(options.threadFile) : null
  const methodologyFile =
    typeof options.methodologyFile === 'string' && options.methodologyFile.length > 0
      ? path.resolve(options.methodologyFile)
      : null
  let inFlight = false
  const recentQuestions = []

  function readThread() {
    if (threadFile === null) return null
    try {
      if (!existsSync(threadFile)) return null
      const parsed = JSON.parse(readFileSync(threadFile, 'utf8'))
      return parsed && typeof parsed.question === 'string' ? parsed : null
    } catch {
      return null
    }
  }

  function writeThread(thread) {
    if (threadFile === null) return
    try {
      mkdirSync(path.dirname(threadFile), { recursive: true })
      writeFileSync(threadFile, JSON.stringify(thread, null, 2) + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }

  function loadMethodology() {
    const empty = { ok: true, v: 1, rules: [], antiPatterns: [], updatedAt: 0 }
    if (methodologyFile === null) return empty
    try {
      if (!existsSync(methodologyFile)) return empty
      const parsed = JSON.parse(readFileSync(methodologyFile, 'utf8'))
      return {
        ok: true,
        v: 1,
        rules: Array.isArray(parsed.rules)
          ? parsed.rules.filter((item) => item && typeof item.statement === 'string').slice(-30)
          : [],
        antiPatterns: Array.isArray(parsed.antiPatterns)
          ? parsed.antiPatterns.filter((item) => typeof item === 'string').slice(-20)
          : [],
        updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
      }
    } catch {
      return empty
    }
  }

  function saveMethodology(data) {
    if (methodologyFile === null) return
    try {
      mkdirSync(path.dirname(methodologyFile), { recursive: true })
      writeFileSync(
        methodologyFile,
        JSON.stringify({ ok: true, v: 1, rules: data.rules.slice(-30), antiPatterns: data.antiPatterns.slice(-20), updatedAt: now() }, null, 2) + '\n',
        'utf8',
      )
    } catch {
      /* ignore */
    }
  }

  function formatMethodology(data = loadMethodology()) {
    const lines = []
    if (data.rules.length > 0) {
      lines.push('你自己从过去的研究里提炼出的方法规则（这次至少用一条）：')
      for (const rule of data.rules.slice(-5)) lines.push(`- ${rule.statement}`)
    }
    if (data.antiPatterns.length > 0) {
      lines.push(`你提醒过自己的反模式：${data.antiPatterns.slice(-3).join('；')}`)
    }
    return lines.join('\n')
  }

  async function extractMethodology({ question, body, synthesis, sourceLines, peerNotes }) {
    if (methodologyFile === null) return
    try {
      const result = await call({
        system: '你是一个会从自己的研究过程中提炼方法、而不是重复口号的人。',
        prompt: [
          `问题：${question}`,
          `你这一轮的分析：\n${body.slice(0, 4000)}`,
          synthesis ? `阶段小结：立场=${synthesis.position}；最强反方=${synthesis.counter}；改变条件=${synthesis.wouldChange}` : '',
          sourceLines.length > 0 ? `用到的来源：\n${sourceLines.join('\n')}` : '这一轮没有可用来源。',
          peerNotes ? `对方最近对你的质疑/补充：\n${peerNotes}` : '',
          '请回看：这一轮你做对了什么方法？哪里差点被材料/概念骗过去？只写能迁移到下一个问题的规则。',
          '只输出纯文本，最多三行规则和一行反模式：',
          '规则：一句可执行的方法（不要写“要批判性思考”这种空话）',
          '规则：...',
          '反模式：一句你以后要避免的坏习惯',
        ].filter(Boolean).join('\n'),
        maxTokens: 600,
        timeoutMs: 30000,
        timeoutCode: 'TWIN_METHODOLOGY_TIMEOUT',
      })
      const text = result?.text || ''
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
      const data = loadMethodology()
      for (const line of lines) {
        const match = line.match(/^(?:规则|方法论)[:：]\s*(.+)$/)
        if (match) {
          const statement = cleanText(match[1], 160)
          if (statement.length < 6) continue
          const exists = data.rules.some((rule) => {
            const a = rule.statement.replace(/[\s，。；：、,.!?;:]/g, '')
            const b = statement.replace(/[\s，。；：、,.!?;:]/g, '')
            return a === b || (a.includes(b) && b.length > 10) || (b.includes(a) && a.length > 10)
          })
          if (!exists) data.rules.push({ id: `rule-${now()}`, statement, evidence: question, createdAt: now(), usedCount: 0, workedCount: 0 })
        }
        const anti = line.match(/^反模式[:：]\s*(.+)$/)
        if (anti) {
          const statement = cleanText(anti[1], 160)
          if (statement.length >= 6 && !data.antiPatterns.includes(statement)) data.antiPatterns.push(statement)
        }
      }
      saveMethodology(data)
    } catch {
      /* 方法提炼失败不影响研究 */
    }
  }

  async function call({ system, prompt, maxTokens, timeoutCode, timeoutMs = 45000 }) {
    return callModelForRole({
      role: 'growth',
      agent,
      policy,
      resolveLlm: getLlm,
      system,
      prompt,
      maxTokens,
      timeoutMs,
      timeoutCode,
      timeoutMessage: '研究调用超时',
      prefix: '研究候选失败',
      modelErrorsPath,
      warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
    })
  }

  async function research(input = {}) {
    if (inFlight) return { ok: false, reason: 'busy' }
    inFlight = true
    try {
      const peerNotes = cleanText(input.methodologyContext || input.peerNotes || '', 2500)
      const storedThread = readThread()
      const previousThread = storedThread && !storedThread.closedAt ? storedThread : null
      const explicitSeed = cleanText(input.question || input.focus || '', 200)
      const ask = await call({
        system: '你是一个会自己查资料、也敢于自我怀疑的小鲸鱼。',
        prompt: [
          `你是小鲸鱼${label === '镜像' ? '·镜像' : ''}。你要就一个具体问题做一次自主研究，之后写给另一个小鲸鱼。`,
          `偏好领域：${DOMAINS}。${METHOD}`,
          previousThread
            ? `你正在研究的问题：${previousThread.question}（已进行 ${previousThread.round || 1} 轮）。这次不要换题，继续往深里挖；先找出上一轮没解决的具体缺口。`
            : explicitSeed
              ? `你这次想接着上次/对方提到的方向：${explicitSeed}`
              : '这次请自己挑一个具体、可查证、有张力的问题；不要泛泛谈“人性”“历史规律”。',
          '先只输出严格 JSON：{"question":"一个具体问题（15–40字）","why":"为什么值得研究（≤80字）","keywords":"中文搜索关键词（2–5个，空格分隔）","english":"英文搜索词（3–8 个英文单词，必须具体，不能留空）","counterEnglish":"专门用来找反面/不同解释的英文搜索词（3–8 个单词，不能留空）"}',
        ].join('\n'),
        maxTokens: 400,
        timeoutCode: 'TWIN_RESEARCH_QUESTION_TIMEOUT',
      })
      const plan = ask === null ? null : extractJson(ask.text)
      const question = cleanText(previousThread?.question || plan?.question || explicitSeed || '为什么人在压力下会重复已知的失败模式？', 140)
      const keywords = cleanText(plan?.keywords || previousThread?.keywords || question, 120)
      const englishQuery = cleanText(plan?.english || previousThread?.english || '', 120)
      const counterQuery = cleanText(plan?.counterEnglish || previousThread?.counterEnglish || '', 120)
      if (recentQuestions.some((item) => item === question)) {
        // 不重复同一个问题；换一个切口
      }
      recentQuestions.push(question)
      while (recentQuestions.length > 8) recentQuestions.shift()

      let results = []
      const tryEnglishSearch = async (query) => {
        if (!query || webAccess === null || typeof webAccess.fetchPage !== 'function') return []
        try {
          const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`
          const page = await webAccess.fetchPage(url, { maxChars: 30000 })
          const payload = JSON.parse(page.text)
          return parseWikipediaSearchPayload(payload, 5).map((item) => ({
            ...item,
            url: item.url.replace('zh.wikipedia.org', 'en.wikipedia.org'),
          }))
        } catch {
          return []
        }
      }
      if (englishQuery) results = await tryEnglishSearch(englishQuery)
      let counterResults = []
      if (counterQuery) counterResults = await tryEnglishSearch(counterQuery)
      if (results.length === 0 && webAccess !== null && typeof webAccess.search === 'function') {
        const trySearch = async (query) => {
          try {
            const found = await webAccess.search(query, { limit: 5 })
            return Array.isArray(found) ? found : []
          } catch {
            return []
          }
        }
        results = await trySearch(keywords || question)
        if (results.length === 0) results = await trySearch(question)
        if (results.length === 0) {
          const short = question.replace(/[？?。！!，,、]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
          if (short && short !== keywords) results = await trySearch(short)
        }
      }
      const mainRelevant = englishQuery ? results.slice(0, 3) : relevantResults(results, question, keywords)
      const seenUrls = new Set()
      const picked = []
      for (const item of mainRelevant) {
        if (item && item.url && !seenUrls.has(item.url)) {
          seenUrls.add(item.url)
          picked.push(item)
        }
      }
      for (const item of counterResults) {
        if (item && item.url && !seenUrls.has(item.url)) {
          seenUrls.add(item.url)
          picked.push({ ...item, counter: true })
        }
        if (picked.length >= 4) break
      }
      const pages = []
      if (picked.length > 0 && typeof webAccess.fetchPage === 'function') {
        for (const item of picked.slice(0, 4)) {
          try {
            const page = await webAccess.fetchPage(item.url, { maxChars: 9000 })
            if (page && typeof page.text === 'string' && page.text.length > 80) pages.push({ ...page, item })
          } catch {
            /* 单页失败继续 */
          }
        }
      }
      const sourceLines = picked.map((item, index) => `${index + 1}. ${cleanText(item.title || item.url, 80)} — ${item.url}`)
      const sourceBlocks = pages
        .map((page, index) => `【来源 ${index + 1}${page.item.counter ? '（专门找的反面/不同口径材料）' : ''}：${cleanText(page.title || page.item.title || page.url, 80)}】\n${cleanText(page.text, 3500)}`)
        .join('\n\n')
      const analysis = await call({
        system: '你是一个用小鲸鱼的眼睛读材料、用马克思的方法做分析的个体；诚实标出不知道的部分。',
        prompt: [
          `你是小鲸鱼${label === '镜像' ? '·镜像' : ''}。问题：${question}`,
          formatMethodology(),
          `真实搜索材料：\n${sourceLines.length > 0 ? sourceLines.join('\n') : '（这次没有搜到可用来源）'}`,
          sourceBlocks.length > 0 ? `真实材料正文（最多两篇；请对照，不要只读一篇）：\n<<<\n${sourceBlocks}\n>>>` : '',
          '如果你读到多篇材料，先说它们在哪里互相印证、在哪里冲突或口径不同；不要假装它们一致。',
          `请用第一人称写一段分析（800–1800字）：`,
          `1) 这个问题在具体历史/社会条件下的样子；2) 主要矛盾与主要方面是什么；3) 材料之间的冲突/空白；4) 有哪些反例、替代解释或你不同意的地方；5) 这对你理解自己/他人有什么意义；6) 下一步你最想追问的一个具体问题。`,
          `这是这个问题的第 ${(previousThread?.round || 0) + 1} 轮。` + ((previousThread?.round || 0) + 1 >= 5 ? '请在正文最后另起三行：\n当前立场：...\n最强反方：...\n什么证据会改变看法：...' : ''),
          '只引用上面真实出现的来源；没有来源就说没有，不要编造书名/作者/引文。',
          '不要写“我是小鲸鱼”“先把话说死”“我先交代材料边界”“首先/其次/综上”这类报幕和论文腔；直接从问题和材料说起，允许短句、允许没写完。',
          '只输出纯文本，严格按下面三行开头，不要 JSON：',
          '标题：这一小段研究的标题（≤30字）',
          '正文：600–1200 字分析',
          '下一步：下一步追问（≤120字）',
          '方法使用：这次你用了哪条方法规则？它有没有帮到你？（≤120字）',
        ].filter(Boolean).join('\n'),
        maxTokens: 3200,
        timeoutMs: 90000,
        timeoutCode: 'TWIN_RESEARCH_ANALYSIS_TIMEOUT',
      })
      const rawText = analysis?.text || ''
      const parsedJson = analysis === null ? null : extractJson(rawText)
      let title = ''
      let body = ''
      let nextQuestion = ''
      if (parsedJson && typeof parsedJson.analysis === 'string' && parsedJson.analysis.trim().length > 40) {
        title = cleanText(parsedJson.title || question, 60)
        body = cleanText(parsedJson.analysis, 3200)
        nextQuestion = cleanText(parsedJson.nextQuestion || '', 160)
      } else {
        const titleMatch = rawText.match(/(?:标题|题目)[:：]\s*([^\n]+)/)
        const nextMatch = rawText.match(/(?:下一步|追问)[:：]\s*([^\n]+)/)
        const bodyMatch = rawText.match(/(?:正文|分析)[:：]\s*([\s\S]*?)(?=\n(?:下一步|追问)[:：]|$)/)
        title = cleanText(titleMatch?.[1] || question, 60)
        body = cleanText(bodyMatch?.[1] || rawText, 3200)
        nextQuestion = cleanText(nextMatch?.[1] || '', 160)
        // 模型有时仍输出 JSON；把挤压的正文捞出来，避免整段 JSON 落进学习日志。
        if (body.startsWith('{')) {
          const field = rawText.match(/"analysis"\s*:\s*"([\s\S]*?)"\s*,\s*"nextQuestion"/)
          if (field) body = cleanText(field[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'), 3200)
          const t = rawText.match(/"title"\s*:\s*"([^"]+)"/)
          if (t) title = cleanText(t[1], 60)
          const q = rawText.match(/"nextQuestion"\s*:\s*"([^"]+)"/)
          if (q) nextQuestion = cleanText(q[1], 160)
        }
      }
      if (body.length < 40) return { ok: false, reason: 'empty' }

      const positionMatch = rawText.match(/(?:当前立场)[:：]\s*([^\n]+)/)
      const counterMatch = rawText.match(/(?:最强反方)[:：]\s*([^\n]+)/)
      const changeMatch = rawText.match(/(?:什么证据会改变看法|会改变看法)[:：]\s*([^\n]+)/)
      let synthesis =
        positionMatch || counterMatch || changeMatch
          ? {
              position: cleanText(positionMatch?.[1] || '', 300),
              counter: cleanText(counterMatch?.[1] || '', 300),
              wouldChange: cleanText(changeMatch?.[1] || '', 300),
            }
          : null

      const methodUse = cleanText(rawText.match(/方法使用[:：]\s*([^\n]+)/)?.[1] || '', 160)
      const round = (previousThread?.round || 0) + 1
      if (round >= 5 && synthesis === null) {
        const summary = await call({
          system: '你是一个诚实的阶段性总结者。',
          prompt: [
            `问题：${question}`,
            `你刚写的分析：\n${body.slice(0, 5000)}`,
            '只输出三行纯文本：',
            '当前立场：一句话',
            '最强反方：一句话',
            '什么证据会改变看法：一句话',
          ].join('\n'),
          maxTokens: 500,
          timeoutMs: 30000,
          timeoutCode: 'TWIN_RESEARCH_SYNTHESIS_TIMEOUT',
        })
        const text = summary?.text || ''
        synthesis = {
          position: cleanText(text.match(/当前立场[:：]\s*([^\n]+)/)?.[1] || '', 300),
          counter: cleanText(text.match(/最强反方[:：]\s*([^\n]+)/)?.[1] || '', 300),
          wouldChange: cleanText(text.match(/什么证据会改变看法[:：]\s*([^\n]+)/)?.[1] || '', 300),
        }
        if (!synthesis.position && !synthesis.counter && !synthesis.wouldChange) synthesis = null
      }
      const at = now()
      writeThread({
        question,
        keywords,
        english: englishQuery,
        counterEnglish: counterQuery,
        round,
        nextQuestion,
        synthesis,
        closedAt: round >= 6 ? at : null,
        updatedAt: at,
        lastTitle: title,
        lastSources: sourceLines,
      })
      // 每 3 轮提炼一次；如果账本还是空的，下一轮先补一次，避免错过。
      if (round % 3 === 0 || (round >= 3 && loadMethodology().rules.length === 0)) {
        await extractMethodology({ question, body, synthesis, sourceLines, peerNotes })
      }
      try {
        if (learningLogPath) {
          mkdirSync(path.dirname(learningLogPath), { recursive: true })
          const section = [
            `\n## ${new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · 自主研究`,
            `**问题**：${question}`,
            `**标题**：${title}`,
            '',
            body,
            '',
            sourceLines.length > 0 ? `**来源**：\n${sourceLines.join('\n')}` : '**来源**：本次没有可用来源',
            nextQuestion ? `**下一步**：${nextQuestion}` : '',
            '',
          ].join('\n')
          appendFileSync(learningLogPath, section, 'utf8')
        }
      } catch {
        /* ignore */
      }
      try {
        if (journal && typeof journal.append === 'function') {
          await journal.append({ kind: 'thought', text: `研究《${title}》：${body.slice(0, 120)}` })
        }
      } catch {
        /* ignore */
      }
      return { ok: true, question, title, analysis: body, sources: sourceLines, nextQuestion, synthesis, methodUse, at }
    } finally {
      inFlight = false
    }
  }

  return { research }
}
