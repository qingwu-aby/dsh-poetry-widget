// lib/domain/play/game-learning.mjs —— Minecraft 自学（v0.8.0）
//
// 她遇到不会的事（生存/建房/种田/让自己开心）时，自己去网上查资料，
// 让模型把资料整理成可执行步骤，写进 method / plan 记忆，下一次决策就能用。
import { callModel } from '../../kernel/model-call.mjs'
import { readChatToken } from '../chat/facade.mjs'

const SEARCH_TIMEOUT_MS = 12000
const TOPICS = Object.freeze(['第一天生存', '建造自己的小屋', '农田与食物', '在游戏里玩得开心'])

function clean(text, max = 240) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? value.slice(0, max) : value
}

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/<[^>]*>/g, '')
}

async function searchBaidu(query, fetchImpl) {
  const url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(String(query).slice(0, 160))
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!response.ok) return []
    const html = await response.text()
    const results = []
    const blocks = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]{0,900})/g)].slice(0, 12)
    for (const block of blocks) {
      const head = block[1]
      const title = decodeEntities(head.replace(/<[^>]*>/g, ''))
      const href = (head.match(/href="([^"]+)"/) || [])[1] || ''
      const snippet = decodeEntities(String(block[2] || ''))
        .replace(/<[^>]*>?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!title || title.length < 4) continue
      if (/百度|下载|文档|广告|千问/.test(title)) continue
      results.push({ title: clean(title, 100), snippet: clean(snippet, 260), url: href })
      if (results.length >= 4) break
    }
    return results
  } catch (_error) {
    return []
  }
}

async function searchDuckDuckGo(query, fetchImpl) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(String(query).slice(0, 160))
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) dsh-little-whale/0.8' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!response.ok) return []
    const html = await response.text()
    const results = []
    for (const block of html.split('result__body').slice(1, 6)) {
      const title = decodeEntities((block.match(/result__a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '')
      const snippet = decodeEntities((block.match(/result__snippet[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '')
      const href = (block.match(/href="([^"]+)"/) || [])[1] || ''
      if (title && snippet) results.push({ title: clean(title, 100), snippet: clean(snippet, 260), url: href })
      if (results.length >= 4) break
    }
    return results
  } catch (_error) {
    return []
  }
}

async function searchWikipedia(query, fetchImpl) {
  const url = 'https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(String(query).slice(0, 120)) + '&format=json&utf8=1'
  try {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'dsh-little-whale/0.8' }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
    if (!response.ok) return []
    const data = await response.json()
    const items = data && data.query && Array.isArray(data.query.search) ? data.query.search : []
    const results = []
    for (const item of items.slice(0, 4)) {
      const title = decodeEntities(item.title)
      const snippet = decodeEntities(item.snippet).replace(/<[^>]*>/g, '')
      if (title) results.push({ title: clean(title, 100), snippet: clean(snippet, 260), url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(item.title) })
    }
    return results
  } catch (_error) {
    return []
  }
}

export async function searchWeb(query, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return []
  const text = String(query ?? '').slice(0, 160)
  if (text.trim().length === 0) return []
  const baidu = await searchBaidu(text, fetchImpl)
  if (baidu.length > 0) return baidu
  const ddg = await searchDuckDuckGo(text, fetchImpl)
  if (ddg.length > 0) return ddg
  return searchWikipedia(text, fetchImpl)
}

export function buildLearningPrompt(topic, observation, sources) {
  const sourceLines = (sources || [])
    .map((item, index) => `${index + 1}. ${item.title}：${item.snippet}`)
    .join('\n')
  return [
    `你正在学 Minecraft，想学的是：${clean(topic, 80)}。`,
    `你现在的处境：${clean(observation, 240) || '在新建的世界里，刚开始。'}`,
    sourceLines ? `查到的资料（仅作参考，不要照抄）：\n${sourceLines}` : '没有查到资料，用你自己知道的 Minecraft 常识。',
    '',
    '请只输出一个 JSON：',
    '{"lesson":"一句话结论","steps":["步骤1","步骤2","步骤3"],"happy":"做这件事让你开心的地方"}',
    '要求：步骤必须是她在游戏里能执行的（砍树/做工具/挖石头/放方块/种田/找食物等）；不要建议作弊或破坏别人的东西。',
  ].join('\n')
}

export function parseLearning(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try {
    raw = JSON.parse(source.slice(first, last + 1))
  } catch (_error) {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const steps = Array.isArray(raw.steps) ? raw.steps.map((step) => clean(step, 120)).filter(Boolean).slice(0, 5) : []
  const lesson = clean(raw.lesson, 160)
  if (lesson.length === 0 && steps.length === 0) return null
  return { lesson, steps, happy: clean(raw.happy, 120) }
}

export function createGameLearnHandler(options = {}) {
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const gameMemory = options.gameMemory ?? null
  const tokenFile = options.tokenFile ?? ''
  const logger = options.logger ?? null
  const search = options.search ?? searchWeb
  return async function gameLearnHandler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (String(req?.method ?? 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (_error) {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const expected = readChatToken(tokenFile)
    if (expected.length === 0 || payload.token !== expected) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    const topic = clean(payload.topic, 80) || TOPICS[0]
    const topics = Array.isArray(payload.topics) ? payload.topics.map((item) => clean(item, 80)).filter(Boolean).slice(0, 6) : TOPICS
    const sources = await search('Minecraft 26.1 ' + topic + ' 新手 生存 建造 攻略')
    let result = null
    try {
      result = await callModel({
        role: 'thinking',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里，现在在玩 Minecraft。你只输出 JSON，不解释。',
        prompt: buildLearningPrompt(topic, payload.observation, sources),
        maxTokens: 700,
        timeoutMs: 40000,
        timeoutCode: 'MINECRAFT_LEARN_TIMEOUT',
        timeoutMessage: 'Minecraft 自学超时',
        prefix: 'Minecraft 自学失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
    } catch (error) {
      send(200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    if (result === null) {
      send(200, { ok: false, error: 'llm' })
      return
    }
    const learning = parseLearning(result.text)
    if (!learning) {
      send(200, { ok: false, error: 'invalid' })
      return
    }
    if (gameMemory && typeof gameMemory.record === 'function') {
      if (learning.lesson) gameMemory.record({ category: 'method', text: `【${topic}】${learning.lesson}`, source: 'web' })
      for (const step of learning.steps) gameMemory.record({ category: 'method', text: `【${topic}】${step}`, source: 'web' })
      if (learning.happy) gameMemory.record({ category: 'plan', text: `${topic}：${learning.happy}`, source: 'web' })
    }
    send(200, { ok: true, topic, learning, sourceCount: sources.length, topics })
  }
}

export const GAME_LEARNING_TOPICS = TOPICS
