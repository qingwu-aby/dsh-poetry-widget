// lib/knowledge-graph.mjs —— 她自己的认知图谱（v2.92）
//
// 节点（人/制度/事件/地点/概念/作品）+ 关系（因果/时间/对照/组成/例证）+ 判断（claims）。
// 从 learning-log 的段落里抽取；每条都带来源段号；合并时去重、补来源、限上限。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

export const GRAPH_VERSION = 1
export const GRAPH_MAX_NODES = 20000
export const GRAPH_MAX_EDGES = 40000
export const GRAPH_MAX_CLAIMS = 8000
export const GRAPH_NODE_TYPES = Object.freeze(['person', 'concept', 'event', 'place', 'institution', 'work'])
export const GRAPH_RELATIONS = Object.freeze(['causal', 'temporal', 'contrast', 'part_of', 'example_of'])
export const GRAPH_CONFIDENCE = Object.freeze(['high', 'medium', 'low'])

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

function similar(a, b, threshold = 0.8) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return clean(a, 100) === clean(b, 100)
  let overlap = 0
  for (const gram of A) if (B.has(gram)) overlap += 1
  return (2 * overlap) / (A.size + B.size) >= threshold
}

export function emptyGraph() {
  return { ok: true, v: GRAPH_VERSION, updatedAt: 0, nodes: [], edges: [], claims: [] }
}

export function normalizeGraph(raw) {
  const out = emptyGraph()
  if (!raw || typeof raw !== 'object') return out
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  out.nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .map((node) => ({
      id: clean(node.id, 60) || `node-${Math.random().toString(36).slice(2, 8)}`,
      name: clean(node.name, 40),
      type: GRAPH_NODE_TYPES.includes(node.type) ? node.type : 'concept',
      summary: clean(node.summary, 120),
      aliases: Array.isArray(node.aliases) ? node.aliases.map((a) => clean(a, 40)).filter((a) => a.length > 0).slice(0, 4) : [],
      sources: Array.isArray(node.sources) ? node.sources.filter((s) => Number.isFinite(s)).slice(-8) : [],
      firstSeenAt: Number.isFinite(node.firstSeenAt) ? node.firstSeenAt : 0,
      updatedAt: Number.isFinite(node.updatedAt) ? node.updatedAt : 0,
    }))
    .filter((node) => node.name.length >= 1)
    .slice(-GRAPH_MAX_NODES)
  const ids = new Set(out.nodes.map((node) => node.id))
  out.edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .map((edge) => ({
      id: clean(edge.id, 60) || `edge-${Math.random().toString(36).slice(2, 8)}`,
      from: clean(edge.from, 40),
      to: clean(edge.to, 40),
      relation: GRAPH_RELATIONS.includes(edge.relation) ? edge.relation : 'temporal',
      note: clean(edge.note, 120),
      confidence: GRAPH_CONFIDENCE.includes(edge.confidence) ? edge.confidence : 'low',
      sources: Array.isArray(edge.sources) ? edge.sources.filter((s) => Number.isFinite(s)).slice(-8) : [],
      updatedAt: Number.isFinite(edge.updatedAt) ? edge.updatedAt : 0,
    }))
    .filter((edge) => edge.from.length > 0 && edge.to.length > 0)
    .slice(-GRAPH_MAX_EDGES)
  out.claims = (Array.isArray(raw.claims) ? raw.claims : [])
    .map((claim) => ({
      id: clean(claim.id, 60) || `claim-${Math.random().toString(36).slice(2, 8)}`,
      text: clean(claim.text, 200),
      nodes: Array.isArray(claim.nodes) ? claim.nodes.map((n) => clean(n, 40)).filter((n) => n.length > 0).slice(0, 6) : [],
      confidence: GRAPH_CONFIDENCE.includes(claim.confidence) ? claim.confidence : 'low',
      sources: Array.isArray(claim.sources) ? claim.sources.filter((s) => Number.isFinite(s)).slice(-8) : [],
      createdAt: Number.isFinite(claim.createdAt) ? claim.createdAt : 0,
      updatedAt: Number.isFinite(claim.updatedAt) ? claim.updatedAt : 0,
    }))
    .filter((claim) => claim.text.length >= 4)
    .slice(-GRAPH_MAX_CLAIMS)
  if (ids.size === 0) out.edges = []
  return out
}

export function readGraph(file) {
  try {
    return normalizeGraph(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return emptyGraph()
  }
}

export function saveGraph(file, state) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    const next = normalizeGraph(state)
    next.updatedAt = Date.now()
    writeJsonAtomic(file, next)
    return true
  } catch {
    return false
  }
}

/** 合并一批抽取结果：节点按名字/别名去重，边按 from+to+relation 去重，claims 按文本相似去重。 */
export function mergeGraph(state, batch, at = Date.now(), sourceIndex = null) {
  const graph = normalizeGraph(state)
  let addedNodes = 0
  let addedEdges = 0
  let addedClaims = 0
  const nodes = Array.isArray(batch?.nodes) ? batch.nodes : []
  const edges = Array.isArray(batch?.edges) ? batch.edges : []
  const claims = Array.isArray(batch?.claims) ? batch.claims : []
  const source = Number.isFinite(sourceIndex) ? [sourceIndex] : []
  const findNode = (name) => {
    const target = clean(name, 40)
    return graph.nodes.find((node) => node.name === target || node.aliases.includes(target) || similar(node.name, target, 0.9))
  }
  for (const item of nodes) {
    const name = clean(item.name, 40)
    if (name.length < 1) continue
    const existing = findNode(name)
    if (existing !== undefined) {
      if (item.summary && !existing.summary.includes(item.summary)) existing.summary = clean(item.summary, 120)
      for (const alias of Array.isArray(item.aliases) ? item.aliases : []) {
        const value = clean(alias, 40)
        if (value.length > 0 && !existing.aliases.includes(value)) existing.aliases.push(value)
      }
      existing.sources = [...new Set([...existing.sources, ...source])].slice(-8)
      existing.updatedAt = at
      continue
    }
    graph.nodes.push({
      id: `node-${at}-${graph.nodes.length + 1}`,
      name,
      type: GRAPH_NODE_TYPES.includes(item.type) ? item.type : 'concept',
      summary: clean(item.summary, 120),
      aliases: Array.isArray(item.aliases) ? item.aliases.map((a) => clean(a, 40)).filter((a) => a.length > 0).slice(0, 4) : [],
      sources: source,
      firstSeenAt: at,
      updatedAt: at,
    })
    addedNodes += 1
  }
  for (const item of edges) {
    const from = findNode(item.from)
    const to = findNode(item.to)
    if (from === undefined || to === undefined || from.id === to.id) continue
    const relation = GRAPH_RELATIONS.includes(item.relation) ? item.relation : 'temporal'
    const existing = graph.edges.find((edge) => edge.from === from.name && edge.to === to.name && edge.relation === relation)
    if (existing !== undefined) {
      existing.sources = [...new Set([...existing.sources, ...source])].slice(-8)
      existing.updatedAt = at
      continue
    }
    graph.edges.push({
      id: `edge-${at}-${graph.edges.length + 1}`,
      from: from.name,
      to: to.name,
      relation,
      note: clean(item.note, 120),
      confidence: GRAPH_CONFIDENCE.includes(item.confidence) ? item.confidence : 'low',
      sources: source,
      updatedAt: at,
    })
    addedEdges += 1
  }
  for (const item of claims) {
    const text = clean(item.text, 200)
    if (text.length < 4) continue
    const existing = graph.claims.find((claim) => similar(claim.text, text, 0.75))
    if (existing !== undefined) {
      const before = existing.sources.length
      existing.sources = [...new Set([...existing.sources, ...source])].slice(-8)
      const grew = existing.sources.length > before
      if (grew && existing.confidence === 'medium' && existing.sources.length >= 2) existing.confidence = 'high'
      else if (GRAPH_CONFIDENCE.includes(item.confidence) && item.confidence !== 'high') existing.confidence = item.confidence
      existing.updatedAt = at
      continue
    }
    graph.claims.push({
      id: `claim-${at}-${graph.claims.length + 1}`,
      text,
      nodes: (Array.isArray(item.nodes) ? item.nodes : []).map((n) => clean(n, 40)).filter((n) => findNode(n) !== undefined).slice(0, 6),
      // v3.01：单批单来源的 high 先降为 medium；等第二个来源再升。
      confidence: item.confidence === 'high' ? 'medium' : GRAPH_CONFIDENCE.includes(item.confidence) ? item.confidence : 'low',
      sources: source,
      createdAt: at,
      updatedAt: at,
    })
    addedClaims += 1
  }
  graph.nodes = graph.nodes.slice(-GRAPH_MAX_NODES)
  graph.edges = graph.edges.slice(-GRAPH_MAX_EDGES)
  graph.claims = graph.claims.slice(-GRAPH_MAX_CLAIMS)
  graph.updatedAt = at
  return { graph, addedNodes, addedEdges, addedClaims }
}

const SPREAD_RELATION_WEIGHT = Object.freeze({
  causal: 1,
  part_of: 0.9,
  temporal: 0.8,
  example_of: 0.8,
  contrast: 0.7,
})
const SPREAD_CONFIDENCE_WEIGHT = Object.freeze({ high: 1, medium: 0.85, low: 0.6 })

/**
 * 扩散激活检索：先按查询找种子节点，再沿关系边扩散 1–2 跳，按衰减加权排序。
 * 目的：不只是命中直接匹配，还能“顺着关系想到”相邻的概念（类比人类语义网络）。
 *
 * @param {object} state
 * @param {string} query
 * @param {{ seedLimit?: number, maxHops?: number, nodeLimit?: number, decay?: number, minScore?: number }} [options]
 */
export function spreadActivation(state, query, options = {}) {
  const graph = normalizeGraph(state)
  const text = clean(query ?? '', 200)
  if (text.length < 2 || graph.nodes.length === 0) return { seeds: [], nodes: [], edges: [], claims: [] }
  const queryGrams = bigrams(text)
  const scoreOf = (value) => {
    const grams = bigrams(value)
    if (grams.size === 0 || queryGrams.size === 0) return 0
    let overlap = 0
    for (const gram of queryGrams) if (grams.has(gram)) overlap += 1
    return overlap / queryGrams.size
  }
  const limit = Number.isFinite(options.seedLimit) && options.seedLimit > 0 ? options.seedLimit : 4
  const maxHops = Number.isFinite(options.maxHops) && options.maxHops > 0 ? Math.min(3, options.maxHops) : 2
  const nodeLimit = Number.isFinite(options.nodeLimit) && options.nodeLimit > 0 ? options.nodeLimit : 6
  const decay = Number.isFinite(options.decay) && options.decay > 0 ? Math.min(0.9, options.decay) : 0.55
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.12
  const byName = new Map(graph.nodes.map((node) => [node.name, node]))
  const adjacency = new Map()
  for (const edge of graph.edges) {
    if (!byName.has(edge.from) || !byName.has(edge.to)) continue
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, [])
    adjacency.get(edge.from).push({ to: edge.to, relation: edge.relation, confidence: edge.confidence, note: edge.note })
    adjacency.get(edge.to).push({ to: edge.from, relation: edge.relation, confidence: edge.confidence, note: edge.note })
  }
  // 种子：名字/别名/摘要与查询的 bigram 重合。
  const seedScores = graph.nodes
    .map((node) => ({
      node,
      score: Math.max(scoreOf(node.name), scoreOf(node.summary), ...node.aliases.map((alias) => scoreOf(alias))),
    }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  if (seedScores.length === 0) return { seeds: [], nodes: [], edges: [], claims: [] }
  const activation = new Map()
  const via = new Map()
  for (const seed of seedScores) {
    activation.set(seed.node.name, seed.score)
    via.set(seed.node.name, { hop: 0, from: null, relation: null, note: null })
  }
  let frontier = new Map(seedScores.map((seed) => [seed.node.name, seed.score]))
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next = new Map()
    for (const [name, energy] of frontier) {
      for (const edge of adjacency.get(name) ?? []) {
        const weight = (SPREAD_RELATION_WEIGHT[edge.relation] ?? 0.7) * (SPREAD_CONFIDENCE_WEIGHT[edge.confidence] ?? 0.75)
        const score = energy * decay * weight
        if (score < minScore * 0.5) continue
        if (score > (next.get(edge.to) ?? 0)) next.set(edge.to, score)
        if (score > (activation.get(edge.to) ?? 0)) {
          activation.set(edge.to, score)
          via.set(edge.to, { hop, from: name, relation: edge.relation, note: edge.note })
        }
      }
    }
    frontier = next
    if (frontier.size === 0) break
  }
  const nodes = [...activation.entries()]
    .map(([name, score]) => ({ node: byName.get(name), score, via: via.get(name) }))
    .filter((item) => item.node !== undefined && item.score >= Math.max(0.04, minScore * 0.4))
    .sort((a, b) => b.score - a.score)
    .slice(0, nodeLimit)
  const names = new Set(nodes.map((item) => item.node.name))
  const edges = graph.edges.filter((edge) => names.has(edge.from) && names.has(edge.to)).slice(0, nodeLimit * 2)
  const claims = graph.claims
    .filter((claim) => claim.nodes.some((name) => names.has(name)))
    .slice(-4)
  return {
    seeds: seedScores.map((item) => item.node.name),
    nodes: nodes.map((item) => ({ ...item.node, activation: Number(item.score.toFixed(2)), via: item.via })),
    edges,
    claims,
  }
}

/** 把扩散激活结果压成 prompt 行（不相关就别用）。 */
export function formatSpreadingDigest(result, limit = 4) {
  const lines = []
  const relLabel = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }
  for (const node of (result.nodes ?? []).slice(0, limit)) {
    const type = { person: '人', concept: '概念', event: '事件', place: '地方', institution: '制度', work: '作品' }[node.type] || '条目'
    const via = node.via && node.via.hop > 0 && node.via.from
      ? `（从「${node.via.from}」${relLabel[node.via.relation] || '关联'}过来）`
      : ''
    lines.push(`${node.name}（${type}）${via}：${node.summary || '（无摘要）'}`)
  }
  for (const claim of (result.claims ?? []).slice(0, 2)) lines.push(`判断（${claim.confidence}）：${claim.text}`)
  return lines
}

/** 按查询返回相关节点/关系/判断（用于对话/自处提示）。 */
export function queryGraph(state, query, options = {}) {
  const graph = normalizeGraph(state)
  const text = clean(query, 200)
  if (text.length < 2) return { nodes: [], edges: [], claims: [] }
  const grams = bigrams(text)
  const score = (value) => {
    const set = bigrams(value)
    if (set.size === 0 || grams.size === 0) return 0
    let n = 0
    for (const g of grams) if (set.has(g)) n += 1
    return n / grams.size
  }
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 4
  const nodes = graph.nodes
    .map((node) => ({ node, score: Math.max(score(node.name), score(node.summary), ...node.aliases.map((a) => score(a))) }))
    .filter((item) => item.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.node)
  const names = new Set(nodes.map((node) => node.name))
  const edges = graph.edges.filter((edge) => names.has(edge.from) || names.has(edge.to)).slice(0, limit * 2)
  const claims = graph.claims
    .map((claim) => ({ claim, score: score(claim.text) }))
    .filter((item) => item.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.claim)
  return { nodes, edges, claims }
}

export function formatGraphDigest(result) {
  const lines = []
  for (const node of result.nodes ?? []) {
    const type = { person: '人', concept: '概念', event: '事件', place: '地方', institution: '制度', work: '作品' }[node.type] || '条目'
    lines.push(`${node.name}（${type}）：${node.summary || '（无摘要）'}`)
  }
  for (const edge of result.edges ?? []) {
    const rel = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }[edge.relation] || '关联'
    lines.push(`${edge.from} ${rel} ${edge.to}${edge.note ? `（${edge.note}）` : ''}`)
  }
  for (const claim of result.claims ?? []) lines.push(`判断（${claim.confidence}）：${claim.text}`)
  return lines
}

/** 图谱缺口：孤立节点、低置信判断 → 变成可以拿去查的问题。 */
export function graphGaps(state, options = {}) {
  const graph = normalizeGraph(state)
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 4
  const degree = new Map()
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const gaps = []
  for (const node of graph.nodes) {
    if ((degree.get(node.name) ?? 0) > 0) continue
    gaps.push(`「${node.name}」是什么？它和什么有因果或先后的关系？`)
    if (gaps.length >= limit) return gaps
  }
  for (const claim of graph.claims) {
    if (claim.confidence !== 'low') continue
    gaps.push(`「${claim.text}」这条判断还缺证据：能找到一手材料或反例吗？`)
    if (gaps.length >= limit) return gaps
  }
  return gaps
}

/** 给世界观整理用的结构摘要：关系 + 低置信判断 + 孤立条目。 */
export function worldviewGraphDigest(state, options = {}) {
  const graph = normalizeGraph(state)
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 8
  const lines = []
  const relLabel = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }
  const ordered = [...graph.edges].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 }
    return (rank[a.confidence] ?? 2) - (rank[b.confidence] ?? 2)
  })
  for (const edge of ordered.slice(0, limit)) {
    lines.push(`${edge.from} ${relLabel[edge.relation] ?? '关联'} ${edge.to}${edge.note ? `（${edge.note}）` : ''} [${edge.confidence}]`)
  }
  for (const claim of graph.claims.filter((item) => item.confidence !== 'low').slice(0, 3)) {
    lines.push(`判断（${claim.confidence}）：${claim.text}`)
  }
  for (const gap of graphGaps(graph, { limit: 3 })) lines.push(`未接上：${gap}`)
  return lines
}

export function graphSnapshot(state) {
  const graph = normalizeGraph(state)
  return { updatedAt: graph.updatedAt, nodes: graph.nodes.length, edges: graph.edges.length, claims: graph.claims.length }
}
