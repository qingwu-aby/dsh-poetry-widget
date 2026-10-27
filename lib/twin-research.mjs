// lib/twin-research.mjs —— 两只小鲸鱼的自主知识获取（v2.31）。
//
// 偏好：心理学 / 哲学 / 历史；骨干方法：马克思的历史唯物主义与矛盾分析。
// 流程：提出问题 → 真实搜索 → 读一篇真实材料 → 写下分析 → 给另一只鲸鱼写信。
// 只能引用真实搜索/抓取到的来源，不能编造引用。
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'

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

export function createTwinResearch(options = {}) {
  const label = options.label === 'twin' ? '镜像' : '原体'
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => options.llm
  const policy = options.policy ?? null
  const webAccess = options.webAccess ?? null
  const journal = options.journal
  const learningLogPath = options.learningLogPath
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let inFlight = false
  const recentQuestions = []

  async function call({ system, prompt, maxTokens, timeoutCode }) {
    return callModelForRole({
      role: 'growth',
      policy,
      resolveLlm: getLlm,
      system,
      prompt,
      maxTokens,
      timeoutMs: 45000,
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
      const seed = cleanText(input.question || input.focus || '', 200)
      const ask = await call({
        system: '你是一个会自己查资料、也敢于自我怀疑的小鲸鱼。',
        prompt: [
          `你是小鲸鱼${label === '镜像' ? '·镜像' : ''}。你要就一个具体问题做一次自主研究，之后写给另一个小鲸鱼。`,
          `偏好领域：${DOMAINS}。${METHOD}`,
          seed ? `你这次想接着上次/对方提到的方向：${seed}` : '这次请自己挑一个具体、可查证、有张力的问题；不要泛泛谈“人性”“历史规律”。',
          '先只输出严格 JSON：{"question":"一个具体问题（15–40字）","why":"为什么值得研究（≤80字）","keywords":"搜索关键词（2–5个，空格分隔）"}',
        ].join('\n'),
        maxTokens: 400,
        timeoutCode: 'TWIN_RESEARCH_QUESTION_TIMEOUT',
      })
      const plan = ask === null ? null : extractJson(ask.text)
      const question = cleanText(plan?.question || seed || '为什么人在压力下会重复已知的失败模式？', 120)
      const keywords = cleanText(plan?.keywords || question, 80)
      if (recentQuestions.some((item) => item === question)) {
        // 不重复同一个问题；换一个切口
      }
      recentQuestions.push(question)
      while (recentQuestions.length > 8) recentQuestions.shift()

      let results = []
      if (webAccess !== null && typeof webAccess.search === 'function') {
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
      const picked = Array.isArray(results) ? results.filter((item) => item && item.url).slice(0, 3) : []
      let page = null
      if (picked.length > 0 && typeof webAccess.fetchPage === 'function') {
        try {
          page = await webAccess.fetchPage(picked[0].url, { maxChars: 12000 })
        } catch {
          page = null
        }
      }
      const sourceLines = picked.map((item, index) => `${index + 1}. ${cleanText(item.title || item.url, 80)} — ${item.url}`)
      const analysis = await call({
        system: '你是一个用小鲸鱼的眼睛读材料、用马克思的方法做分析的个体；诚实标出不知道的部分。',
        prompt: [
          `你是小鲸鱼${label === '镜像' ? '·镜像' : ''}。问题：${question}`,
          `真实搜索材料：\n${sourceLines.length > 0 ? sourceLines.join('\n') : '（这次没有搜到可用来源）'}`,
          page ? `其中一页的真实正文（节选）：\n<<<\n${cleanText(page.text, 7000)}\n>>>` : '',
          `请用第一人称写一段分析（600–1200字）：`,
          `1) 这个问题在具体历史/社会条件下的样子；2) 主要矛盾与主要方面是什么；3) 有哪些反例、替代解释或你不同意的地方；4) 这对你理解自己/他人有什么意义；5) 下一步你最想追问的一个具体问题。`,
          '只引用上面真实出现的来源；没有来源就说没有，不要编造书名/作者/引文。',
          '只输出纯文本，严格按下面三行开头，不要 JSON：',
          '标题：这一小段研究的标题（≤30字）',
          '正文：600–1200 字分析',
          '下一步：下一步追问（≤120字）',
        ].filter(Boolean).join('\n'),
        maxTokens: 2200,
        timeoutCode: 'TWIN_RESEARCH_ANALYSIS_TIMEOUT',
      })
      const rawText = analysis?.text || ''
      const parsedJson = analysis === null ? null : extractJson(rawText)
      let title = ''
      let body = ''
      let nextQuestion = ''
      if (parsedJson && typeof parsedJson.analysis === 'string' && parsedJson.analysis.trim().length > 40) {
        title = cleanText(parsedJson.title || question, 60)
        body = cleanText(parsedJson.analysis, 2400)
        nextQuestion = cleanText(parsedJson.nextQuestion || '', 160)
      } else {
        const titleMatch = rawText.match(/(?:标题|题目)[:：]\s*([^\n]+)/)
        const nextMatch = rawText.match(/(?:下一步|追问)[:：]\s*([^\n]+)/)
        const bodyMatch = rawText.match(/(?:正文|分析)[:：]\s*([\s\S]*?)(?=\n(?:下一步|追问)[:：]|$)/)
        title = cleanText(titleMatch?.[1] || question, 60)
        body = cleanText(bodyMatch?.[1] || rawText, 2400)
        nextQuestion = cleanText(nextMatch?.[1] || '', 160)
        // 模型有时仍输出 JSON；把挤压的正文捞出来，避免整段 JSON 落进学习日志。
        if (body.startsWith('{')) {
          const field = rawText.match(/"analysis"\s*:\s*"([\s\S]*?)"\s*,\s*"nextQuestion"/)
          if (field) body = cleanText(field[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'), 2400)
          const t = rawText.match(/"title"\s*:\s*"([^"]+)"/)
          if (t) title = cleanText(t[1], 60)
          const q = rawText.match(/"nextQuestion"\s*:\s*"([^"]+)"/)
          if (q) nextQuestion = cleanText(q[1], 160)
        }
      }
      if (body.length < 40) return { ok: false, reason: 'empty' }

      const at = now()
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
      return { ok: true, question, title, analysis: body, sources: sourceLines, nextQuestion, at }
    } finally {
      inFlight = false
    }
  }

  return { research }
}
