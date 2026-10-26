// lib/self-works.mjs —— 她自己的作品（v2.11，P2）：文字或 SVG 小画。
//
// 作品存在 $DSH_HOME/agent-memory/works/：<id>.svg / <id>.md + works.json 索引。
// 模型只负责“想画/想写什么”，本地只做保存与安全清洗；不评分、不评价好坏。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'
import { writeJsonAtomic } from './settings-store.mjs'

export const SELF_WORKS_VERSION = 1
export const SELF_WORKS_MAX = 60
export const SELF_WORKS_SVG_MAX = 40000
export const SELF_WORKS_TEXT_MAX = 4000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function extractJson(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 清洗 SVG：只留静态图形，去掉 script/事件/外链/foreignObject。 */
export function sanitizeWorkSvg(svg) {
  let text = String(svg ?? '').trim()
  if (!/^<svg[\s>]/i.test(text)) return ''
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#)[^']*'/gi, '')
    .replace(/javascript:/gi, '')
  const chars = Array.from(text)
  return chars.length > SELF_WORKS_SVG_MAX ? '' : text
}

export function resolveWorksDir(env = process.env, home = null) {
  const base = env?.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home ?? env.HOME ?? '', '.dsh')
  return path.join(base, 'agent-memory', 'works')
}

/** 读索引（缺失/坏文件 → 空）。 */
export function readWorksIndex(dir) {
  const file = path.join(dir, 'works.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!isPlainObject(parsed) || !Array.isArray(parsed.works)) return []
    return parsed.works.filter((item) => isPlainObject(item) && typeof item.id === 'string')
  } catch {
    return []
  }
}

/**
 * 创建作品服务。
 * @param {{dir?: string, getLlm?: Function, llm?: object, policy?: object|null,
 *   modelErrorsPath?: string|null, logger?: object|null, now?: () => number,
 *   timeoutMs?: number}} options
 */
export function createSelfWorks(options = {}) {
  const dir = path.resolve(options.dir ?? resolveWorksDir(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const policy = options.policy ?? null
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 40000
  let inFlight = false

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

  function ensureDir() {
    mkdirSync(dir, { recursive: true })
  }

  function list(limit = 12) {
    return readWorksIndex(dir)
      .slice(-(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 12))
      .reverse()
  }

  /** 让模型画一张画/写一段东西，然后保存。 */
  async function makeNow(input = {}) {
    if (inFlight) return { ok: false, reason: 'busy' }
    const idea = cleanInline(isPlainObject(input) && typeof input.idea === 'string' ? input.idea : '', 120)
    inFlight = true
    try {
      const prompt = [
        '你是住在 DSH Web 角落的鲸鱼娘。现在是你自己的时间，你想给自己留下一点作品。',
        idea.length > 0 ? `你手边正想着：${idea}。` : '',
        '你可以画一张简单的小画（SVG），或写一小段文字。不要解释创作过程，不要写“作为 AI”。',
        '只输出严格 JSON：{"title":"作品名（2–30 字）","kind":"svg 或 text","body":"SVG 源码或文字正文"}',
        '如果画 SVG：body 必须是完整的 <svg>...</svg>，只用静态图形/颜色/文字，不要 script、事件、外部图片或链接；画布 320x200 左右。',
      ]
        .filter(Boolean)
        .join('\n')
      const result = await callModelForRole({
        role: 'growth',
        policy,
        resolveLlm,
        system: '你是一个会自己画画/写字的小鲸鱼；作品要小、具体、像你此刻会留下的东西。',
        prompt,
        maxTokens: 1400,
        timeoutMs,
        timeoutCode: 'SELF_WORKS_TIMEOUT',
        timeoutMessage: `作品生成超时（${timeoutMs}ms）`,
        prefix: '作品候选失败',
        modelErrorsPath,
        warn,
      })
      if (result === null) return { ok: false, reason: 'llm' }
      const raw = extractJson(result.text)
      if (raw === null) return { ok: false, reason: 'invalid' }
      const title = cleanInline(raw.title, 30)
      if (title.length < 2) return { ok: false, reason: 'title' }
      const kind = raw.kind === 'svg' ? 'svg' : 'text'
      let body = ''
      if (kind === 'svg') body = sanitizeWorkSvg(raw.body)
      else body = String(raw.body ?? '').trim().slice(0, SELF_WORKS_TEXT_MAX)
      if (body.length < (kind === 'svg' ? 40 : 4)) return { ok: false, reason: 'body' }
      ensureDir()
      const at = now()
      const id = `work-${at}`
      const file = `${id}.${kind === 'svg' ? 'svg' : 'md'}`
      writeFileSync(path.join(dir, file), body, 'utf8')
      const index = readWorksIndex(dir)
      const work = { id, title, kind, file, createdAt: at, idea }
      index.push(work)
      const trimmed = index.slice(-SELF_WORKS_MAX)
      writeJsonAtomic(path.join(dir, 'works.json'), { ok: true, v: SELF_WORKS_VERSION, works: trimmed })
      info(`作品：${title}（${kind}）`)
      return { ok: true, work }
    } catch (error) {
      warn(`作品生成失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, reason: 'error' }
    } finally {
      inFlight = false
    }
  }

  /** 读一个作品的内容（用于只读展示）。 */
  function read(work) {
    if (!isPlainObject(work) || typeof work.file !== 'string') return null
    try {
      const body = readFileSync(path.join(dir, work.file), 'utf8')
      return { ...work, body }
    } catch {
      return null
    }
  }

  return { dir, makeNow, list, read, snapshot: () => ({ dir, count: readWorksIndex(dir).length }) }
}

/** 只读 GET /works.json：最近作品 + 正文（SVG 前端用 data URL 渲染）。 */
export function createWorksHandler(options = {}) {
  const works = options.works
  const limit = Number.isFinite(options.limit) ? options.limit : 12
  return async function worksHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload
    try {
      const items = works.list(limit).map((work) => works.read(work)).filter(Boolean)
      payload = { ok: true, works: items, updatedAt: Date.now() }
    } catch (error) {
      payload = { ok: false, error: { code: 'WORKS_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } }
    }
    const body = JSON.stringify(payload)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    if (method === 'HEAD') res.end()
    else res.end(body)
  }
}
