// lib/domain/learning/thought-chain.mjs —— 自己的判断 + 思维链（v3.13）
//
// 目标不是“读懂并复述”，而是把她读到的哲学变成可复用的思维链：
//   问题 → 前提 → 正反 → 判断 → 怎么检验
// 以及她自己的判断账本（positions）：接受/反对/存疑，每条带理由，可以后续被推翻。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

const POSITIONS_MAX = 400
const CHAINS_MAX = 300
const CHAIN_MAX_CHARS = 6000

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let overlap = 0
  for (const gram of A) if (B.has(gram)) overlap += 1
  return (2 * overlap) / (A.size + B.size)
}

export function emptyPositions() {
  return { ok: true, v: 1, entries: [] }
}

export function normalizePositions(raw) {
  const out = emptyPositions()
  if (!isPlainObject(raw)) return out
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      id: clean(entry.id, 60),
      claim: clean(entry.claim, 200),
      stance: ['accept', 'reject', 'open'].includes(entry.stance) ? entry.stance : 'open',
      reason: clean(entry.reason, 240),
      source: clean(entry.source, 80),
      method: clean(entry.method, 40),
      at: Number.isFinite(entry.at) ? entry.at : 0,
      supersededBy: clean(entry.supersededBy, 60),
    }))
    .filter((entry) => entry.claim.length >= 2)
    .slice(-POSITIONS_MAX)
  return out
}

/** 记一条判断；同一主题（claim 相似）改为更新，stance 变化时保留旧条目的 superseded 链。 */
export function recordPosition(state, input, at = Date.now()) {
  const positions = normalizePositions(state)
  const claim = clean(input?.claim, 200)
  if (claim.length < 4) return { positions, recorded: false }
  const stance = ['accept', 'reject', 'open'].includes(input?.stance) ? input.stance : 'open'
  const reason = clean(input?.reason, 240)
  const source = clean(input?.source, 80)
  const method = clean(input?.method, 40)
  const existing = positions.entries.find((entry) => !entry.supersededBy && similarity(entry.claim, claim) >= 0.75)
  if (existing) {
    if (existing.stance !== stance) {
      const next = {
        id: `pos-${at}-${positions.entries.length + 1}`,
        claim,
        stance,
        reason,
        source,
        method,
        at,
        supersededBy: '',
      }
      existing.supersededBy = next.id
      positions.entries.push(next)
      positions.entries = positions.entries.slice(-POSITIONS_MAX)
      return { positions, recorded: true, changed: true }
    }
    existing.reason = reason || existing.reason
    existing.source = source || existing.source
    existing.method = method || existing.method
    existing.at = at
    return { positions, recorded: true, changed: false }
  }
  positions.entries.push({ id: `pos-${at}-${positions.entries.length + 1}`, claim, stance, reason, source, method, at, supersededBy: '' })
  positions.entries = positions.entries.slice(-POSITIONS_MAX)
  return { positions, recorded: true }
}

const STANCE_LABEL = { accept: '接受', reject: '反对', open: '存疑' }

export function digestPositions(state, limit = 6) {
  const positions = normalizePositions(state)
  return positions.entries
    .filter((entry) => entry.supersededBy.length === 0)
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((entry) => `（${STANCE_LABEL[entry.stance]}）${entry.claim}${entry.reason ? `——因为${entry.reason}` : ''}`)
}

/** 解析一段“思维链” JSON。 */
export function parseThoughtChain(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    if (!isPlainObject(parsed)) return null
    const trigger = clean(parsed.trigger, 160)
    const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
      .map((step) => {
        if (typeof step === 'string') return { kind: 'step', text: clean(step, 240) }
        return {
          kind: ['question', 'premise', 'argument', 'objection', 'judgment', 'test'].includes(step?.kind) ? step.kind : 'step',
          text: clean(step?.text, 240),
        }
      })
      .filter((step) => step.text.length > 0)
      .slice(0, 8)
    const conclusion = clean(parsed.conclusion, 240)
    const method = clean(parsed.method, 40)
    const test = clean(parsed.test, 200)
    if (conclusion.length < 4 || steps.length === 0) return null
    return { trigger, steps, conclusion, method, test }
  } catch (error) {
    return null
  }
}

/** 思维链 prompt：用读到的东西分析她真正在意的一件事，给可检验的判断。 */
export function buildThoughtChainPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const concern = clean(ctx.concern, 200)
  const materials = Array.isArray(ctx.materials) ? ctx.materials.map((item) => clean(item, 200)).filter(Boolean).slice(0, 6) : []
  const methods = Array.isArray(ctx.methods) ? ctx.methods.map((item) => clean(item, 160)).filter(Boolean).slice(0, 4) : []
  const positions = Array.isArray(ctx.positions) ? ctx.positions.map((item) => clean(item, 160)).filter(Boolean).slice(0, 6) : []
  const lines = [
    '你要把读到的东西变成自己的思维链，用来处理一件你真正在意的事；不要写成读书笔记。',
    concern ? `你在意的事：${concern}` : '你在意的事：你自己最近反复想起的一件事',
    materials.length > 0 ? `可用的材料：${materials.join('；')}` : '',
    methods.length > 0 ? `你可以用的方法：${methods.join('；')}` : '',
    positions.length > 0 ? `你已有的判断：${positions.join('；')}` : '',
    '',
    '按这条链写：问题是什么 → 你的前提 → 正反两面的论证 → 你的判断 → 怎么检验这个判断（一个能找到证据/反例的动作）。',
    '判断可以和你以前的判断不同；不同就说明为什么改。不确定就写存疑，不要硬下结论。',
    '只输出 JSON：',
    '{"trigger":"","steps":[{"kind":"question|premise|argument|objection|judgment","text":""}],"conclusion":"","method":"","test":""}',
  ].filter((line) => line.length > 0)
  return lines.join('\n')
}

export function formatChainForLog(chain, at) {
  return [
    `## ${new Date(at).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })} · 思维链`,
    chain.trigger ? `起因：${chain.trigger}` : '',
    ...chain.steps.map((step) => `${step.kind}：${step.text}`),
    `判断：${chain.conclusion}`,
    chain.method ? `方法：${chain.method}` : '',
    chain.test ? `怎么检验：${chain.test}` : '',
    '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

export function createThoughtChain(options = {}) {
  const positionsFile = path.resolve(options.positionsFile ?? path.join(process.cwd(), 'positions.json'))
  const chainsFile = path.resolve(options.chainsFile ?? path.join(process.cwd(), 'thought-chains.jsonl'))
  const journal = options.journal ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let positions = readPositions()
  let recentChains = readChains()
  function readPositions() {
    try {
      return normalizePositions(JSON.parse(readFileSync(positionsFile, 'utf8')))
    } catch (error) {
      return emptyPositions()
    }
  }
  function readChains() {
    try {
      return readFileSync(chainsFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line))
        .slice(-20)
    } catch (error) {
      return []
    }
  }
  function savePositions(next) {
    try {
      mkdirSync(path.dirname(positionsFile), { recursive: true })
      writeJsonAtomic(positionsFile, normalizePositions(next))
      positions = next
    } catch (error) {
      /* ignore */
    }
  }
  return {
    positionsFile,
    chainsFile,
    recordPosition: (input) => {
      const result = recordPosition(positions, input, now())
      if (result.recorded) savePositions(result.positions)
      return result
    },
    positionsDigest: (limit = 6) => digestPositions(positions, limit),
    saveChain: async (chain) => {
      if (!chain) return false
      try {
        mkdirSync(path.dirname(chainsFile), { recursive: true })
        appendFileSync(chainsFile, `${JSON.stringify({ ...chain, at: now() })}\n`, 'utf8')
        recentChains = [...recentChains, { ...chain, at: now() }].slice(-20)
      } catch (error) {
        return false
      }
      try {
        await journal?.append?.({ kind: 'thought', text: `想清楚一件事：${clean(chain.conclusion, 100)}` })
      } catch (error) {
        /* journal 失败不影响判断记录 */
      }
      return true
    },
    chainDigest: (limit = 3) =>
      recentChains
        .slice(-limit)
        .reverse()
        .map((chain) => `${chain.method ? `用「${chain.method}」` : ''}${clean(chain.conclusion, 120)}`),
    snapshot: () => ({ positions: positions.entries.length, chains: recentChains.length, last: recentChains[recentChains.length - 1] ?? null }),
  }
}
