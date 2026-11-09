// lib/knowledge-extract.mjs —— 从学习日志里增量抽取认知图谱（v2.92）
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callRole } from '../../kernel/model-call.mjs'
import { readLearningSections } from '../../memory-recall.mjs'
import { mergeGraph, normalizeGraph, queryGraph, readGraph, saveGraph, formatGraphDigest, graphSnapshot, graphGaps, worldviewGraphDigest } from './knowledge-graph.mjs'
import { writeJsonAtomic } from '../../settings-store.mjs'

export const GRAPH_EXTRACT_INTERVAL_MS = 2 * 60 * 60 * 1000
export const GRAPH_EXTRACT_FIRST_MS = 2 * 60 * 1000
export const GRAPH_EXTRACT_BATCH = 16

export function buildKnowledgeExtractionPrompt(sections) {
  const list = (Array.isArray(sections) ? sections : []).map((section, index) => `【材料${index + 1}】${String(section).replace(/\s+/g, ' ').slice(0, 300)}`)
  return [
    '你在为小鲸鱼维护她自己的认知图谱。只根据下面的材料抽取，不要用材料之外的知识补全，不要编造。',
    ...list,
    '抽取规则：',
    '1) nodes：材料里真正出现的实体（人、制度、事件、地点、概念、作品），name 用材料里的叫法（≤20字），summary 用材料里的事实写一句（≤40字）。',
    '2) edges：只有材料明确说了或直接蕴含的关系才写；relation 只能是 causal（导致/因为）、temporal（先后）、contrast（相反/对照）、part_of（属于/组成）、example_of（例子）。',
    '3) claims：材料里能当判断用的一句话（≤80字），标 confidence（high=材料直接说，medium=材料可推出，low=推测）。',
    '4) 每条都要能在上面材料里找到依据；没有就宁可少写。最多 10 个节点、10 条关系、5 条判断。',
    '只输出严格 JSON：{"nodes":[{"name":"…","type":"person|concept|event|place|institution|work","summary":"…"}],"edges":[{"from":"节点名","to":"节点名","relation":"causal|temporal|contrast|part_of|example_of","note":"…","confidence":"high|medium|low"}],"claims":[{"text":"…","nodes":["节点名"],"confidence":"high|medium|low"}]}',
  ].join('\n')
}

export function parseKnowledgeExtraction(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try {
    raw = JSON.parse(source.slice(first, last + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter((n) => n && typeof n.name === 'string' && n.name.trim().length > 0)
    .slice(0, 12)
    .map((n) => ({
      name: String(n.name).trim().slice(0, 20),
      type: ['person', 'concept', 'event', 'place', 'institution', 'work'].includes(n.type) ? n.type : 'concept',
      summary: String(n.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }))
  const names = new Set(nodes.map((n) => n.name))
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string' && names.has(e.from) && names.has(e.to))
    .slice(0, 12)
    .map((e) => ({
      from: String(e.from), to: String(e.to),
      relation: ['causal', 'temporal', 'contrast', 'part_of', 'example_of'].includes(e.relation) ? e.relation : 'temporal',
      note: String(e.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      confidence: ['high', 'medium', 'low'].includes(e.confidence) ? e.confidence : 'low',
    }))
  const claims = (Array.isArray(raw.claims) ? raw.claims : [])
    .filter((c) => c && typeof c.text === 'string' && c.text.trim().length >= 4)
    .slice(0, 8)
    .map((c) => ({
      text: String(c.text).replace(/\s+/g, ' ').trim().slice(0, 100),
      nodes: (Array.isArray(c.nodes) ? c.nodes : []).filter((n) => names.has(n)).slice(0, 5),
      confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'low',
    }))
  if (nodes.length === 0 && edges.length === 0 && claims.length === 0) return null
  return { nodes, edges, claims }
}

export function createKnowledgeExtractor(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'knowledge-graph.json'))
  const statePath = path.resolve(options.statePath ?? path.join(path.dirname(file), 'knowledge-graph-state.json'))
  const learningLogPath = String(options.learningLogPath ?? '')
  const policy = options.policy ?? null
  const resolveLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const journal = options.journal ?? null
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const batchSize = Number.isFinite(options.batchSize) && options.batchSize > 0 ? options.batchSize : GRAPH_EXTRACT_BATCH
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : GRAPH_EXTRACT_INTERVAL_MS
  const firstMs = Number.isFinite(options.firstMs) && options.firstMs >= 0 ? options.firstMs : GRAPH_EXTRACT_FIRST_MS
  const disabled = String(env.DSH_POETRY_GRAPH ?? '').toLowerCase() === 'off'
  let timer = null
  let inFlight = false
  let lastResult = null

  function readState() {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf8'))
      return { lastExtractedCount: Number.isFinite(raw.lastExtractedCount) ? raw.lastExtractedCount : 0, lastRunAt: Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : 0 }
    } catch {
      return { lastExtractedCount: 0, lastRunAt: 0 }
    }
  }
  function saveState(state) {
    try {
      mkdirSync(path.dirname(statePath), { recursive: true })
      writeJsonAtomic(statePath, { ok: true, v: 1, ...state })
    } catch { /* ignore */ }
  }

  async function runOnce() {
    if (disabled || inFlight) return { ok: false, reason: disabled ? 'disabled' : 'busy' }
    inFlight = true
    try {
      const sections = learningLogPath.length > 0 ? readLearningSections(learningLogPath, 100000) : []
      const state = readState()
      if (state.lastExtractedCount >= sections.length) return { ok: true, done: true, addedNodes: 0 }
      const batch = sections.slice(state.lastExtractedCount, state.lastExtractedCount + batchSize)
      const extraction = await callRole('knowledge_extract', {
        attempts: [
          { maxTokens: 8000, prompt: buildKnowledgeExtractionPrompt(batch) },
          { maxTokens: 12000, prompt: buildKnowledgeExtractionPrompt(batch.slice(0, Math.min(6, batch.length))) },
        ],
        parse: parseKnowledgeExtraction,
        debugFile: path.join(path.dirname(file), 'knowledge-graph-debug.json'),
        policy,
        resolveLlm,
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
      if (extraction.ok !== true) {
        logger?.warn?.('[dsh-little-whale] 认知图谱抽取没有产出可用 JSON')
        lastResult = { at: now(), ok: false, reason: extraction.error === 'invalid' ? 'invalid-json' : 'empty' }
        return { ok: false, reason: lastResult.reason }
      }
      const parsed = extraction.parsed
      const merged = mergeGraph(readGraph(file), parsed, now(), state.lastExtractedCount)
      saveGraph(file, merged.graph)
      const nextState = { lastExtractedCount: state.lastExtractedCount + batch.length, lastRunAt: now() }
      saveState(nextState)
      lastResult = { at: now(), ok: true, addedNodes: merged.addedNodes, addedEdges: merged.addedEdges, addedClaims: merged.addedClaims }
      try {
        await journal?.append?.({ kind: 'thought', text: `知识图谱：+${merged.addedNodes} 节点 / ${merged.addedEdges} 关系 / ${merged.addedClaims} 判断` })
      } catch { /* ignore */ }
      logger?.info?.(`[dsh-little-whale] 知识图谱：+${merged.addedNodes} 节点 / ${merged.addedEdges} 关系 / ${merged.addedClaims} 判断`)
      return { ok: true, ...lastResult }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    } finally {
      inFlight = false
    }
  }

  function gaps(limit = 4) {
    try {
      return graphGaps(readGraph(file), { limit })
    } catch {
      return []
    }
  }
  function worldviewLines(limit = 8) {
    try {
      return worldviewGraphDigest(readGraph(file), { limit })
    } catch {
      return []
    }
  }
  function digest(query, limit = 3) {
    try {
      return formatGraphDigest(queryGraph(readGraph(file), query, { limit }))
    } catch {
      return []
    }
  }
  function snapshot() {
    return { ...graphSnapshot(readGraph(file)), state: readState(), last: lastResult, disabled }
  }
  function start() {
    if (disabled || timer !== null) return
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => runOnce().catch(() => {}), intervalMs)
      timer.unref?.()
    }, firstMs)
    timer.unref?.()
  }
  function stop() {
    if (timer !== null) { clearTimeout(timer); clearInterval(timer); timer = null }
  }
  return { file, statePath, start, stop, runOnce, digest, gaps, worldviewLines, snapshot }
}
