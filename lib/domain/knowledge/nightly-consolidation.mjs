// lib/domain/knowledge/nightly-consolidation.mjs —— 夜间离线巩固（v3.10）
//
// 灵感：互补学习系统 + 睡眠重放（Kumaran 2016 / Rasch & Born 2013）。
// 白天学习只追加；夜里做四件离线工作：
//   1) 汇总当天学到的条目（确定性提取，不花模型）；
//   2) 合并图谱里的重复节点（近似名/别名）；
//   3) 校准判断置信度（单来源 high→medium，多来源 low→medium）；
//   4) 写一份 nightly-consolidation.json + journal 一条「夜里整理」。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeGraph, readGraph, saveGraph } from './knowledge-graph.mjs'
import { writeJsonAtomic, resolveSettingsPath } from '../../kernel/settings-store.mjs'

const LEARNED_KINDS = new Set(['自学', '自主研究', '读小说', '看大家说话'])

function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

function similar(a, b, threshold = 0.92) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return String(a).trim() === String(b).trim()
  let overlap = 0
  for (const gram of A) if (B.has(gram)) overlap += 1
  return (2 * overlap) / (A.size + B.size) >= threshold
}

/** 从 learning-log 里取出 since 之后的学习条目（标题级，确定性）。 */
export function collectRecentLearning(learningLogPath, sinceMs, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 40
  if (typeof learningLogPath !== 'string' || !existsSync(learningLogPath)) return []
  let raw = ''
  try {
    raw = readFileSync(learningLogPath, 'utf8')
  } catch (error) {
    return []
  }
  const items = []
  const sections = raw.split(/\n(?=##\s+)/)
  for (const section of sections) {
    const header = section.split('\n', 1)[0] ?? ''
    const match = header.match(/^##\s+(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*·\s*(.+)$/)
    if (!match) continue
    const at = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? '0'),
    ).getTime()
    if (!(at >= sinceMs)) continue
    const kind = match[7].trim()
    if (!LEARNED_KINDS.has(kind)) continue
    const body = section.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()
    const title = body
      .replace(/^(Q[:：]|题目[:：]|问题[:：])\s*/, '')
      .replace(/\s*(答[:：]|她自己的结论[:：]).*$/, '')
      .slice(0, 60)
    items.push({ at, kind, title, date: `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` })
  }
  return items.sort((a, b) => a.at - b.at).slice(-limit)
}

/** 合并重复节点 + 校准判断置信度（纯函数，便于测试）。 */
export function consolidateGraphState(state, options = {}) {
  const graph = normalizeGraph(state)
  const stats = { mergedNodes: 0, adjustedClaims: 0 }
  const removeIndexes = new Set()
  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (removeIndexes.has(i)) continue
    for (let j = i + 1; j < graph.nodes.length; j += 1) {
      if (removeIndexes.has(j)) continue
      const a = graph.nodes[i]
      const b = graph.nodes[j]
      const sameType = a.type === b.type || a.type === 'concept' || b.type === 'concept'
      if (!sameType) continue
      if (!similar(a.name, b.name) && !a.aliases.some((alias) => similar(alias, b.name)) && !b.aliases.some((alias) => similar(alias, a.name))) continue
      // 保留信息更多/更早的节点，把另一个并入。
      const keep = Array.from(a.name).length >= Array.from(b.name).length ? a : b
      const drop = keep === a ? b : a
      keep.summary = Array.from(keep.summary).length >= Array.from(drop.summary).length ? keep.summary : drop.summary
      keep.aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].filter((alias) => alias !== keep.name).slice(0, 6)
      keep.sources = [...new Set([...keep.sources, ...drop.sources])].slice(-8)
      keep.updatedAt = Math.max(keep.updatedAt, drop.updatedAt)
      removeIndexes.add(keep === a ? j : i)
      stats.mergedNodes += 1
    }
  }
  const droppedNames = new Set([...removeIndexes].map((index) => graph.nodes[index].name))
  graph.nodes = graph.nodes.filter((_, index) => !removeIndexes.has(index))
  if (droppedNames.size > 0) {
    graph.edges = graph.edges
      .map((edge) => ({
        ...edge,
        from: droppedNames.has(edge.from) ? graph.nodes.find((node) => node.aliases.includes(edge.from))?.name ?? edge.from : edge.from,
        to: droppedNames.has(edge.to) ? graph.nodes.find((node) => node.aliases.includes(edge.to))?.name ?? edge.to : edge.to,
      }))
      .filter((edge) => edge.from !== edge.to)
    const seen = new Set()
    graph.edges = graph.edges.filter((edge) => {
      const key = `${edge.from}|${edge.to}|${edge.relation}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    graph.claims = graph.claims.map((claim) => ({ ...claim, nodes: claim.nodes.map((name) => (droppedNames.has(name) ? graph.nodes.find((node) => node.aliases.includes(name))?.name ?? name : name)) }))
  }
  // 置信度校准：单来源 high→medium；多来源 low→medium。
  for (const claim of graph.claims) {
    const sources = Array.isArray(claim.sources) ? claim.sources.length : 0
    if (claim.confidence === 'high' && sources < 2) {
      claim.confidence = 'medium'
      stats.adjustedClaims += 1
    } else if (claim.confidence === 'low' && sources >= 3) {
      claim.confidence = 'medium'
      stats.adjustedClaims += 1
    }
  }
  graph.updatedAt = Date.now()
  return { graph, stats }
}

export function createNightlyConsolidator(options = {}) {
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const journal = options.journal ?? null
  const settingsDir = options.settingsDir ?? resolveSettingsPath(env).dir
  const graphFile = options.graphFile ?? path.join(settingsDir, 'knowledge-graph.json')
  const learningLogPath = options.learningLogPath ?? path.join(path.dirname(settingsDir), 'agent-memory', 'learning-log.md')
  const reportFile = options.reportFile ?? path.join(settingsDir, 'nightly-consolidation.json')
  const runHour = Number.isFinite(options.runHour) ? options.runHour : 3
  const checkIntervalMs = Number.isFinite(options.checkIntervalMs) ? options.checkIntervalMs : 60 * 60 * 1000
  const disabled = String(env.DSH_POETRY_CONSOLIDATE ?? '').toLowerCase() === 'off'
  let timer = null
  let lastResult = null

  function readState() {
    try {
      return JSON.parse(readFileSync(path.join(settingsDir, 'nightly-consolidation-state.json'), 'utf8'))
    } catch (error) {
      return { lastRunDate: '' }
    }
  }
  function saveState(state) {
    try {
      writeJsonAtomic(path.join(settingsDir, 'nightly-consolidation-state.json'), { ok: true, v: 1, ...state })
    } catch (error) {
      /* ignore */
    }
  }

  async function runOnce(input = {}) {
    const at = now()
    const since = Number.isFinite(input.since) ? input.since : at - 24 * 60 * 60 * 1000
    let learned = []
    try {
      learned = collectRecentLearning(learningLogPath, since, { limit: 60 })
    } catch (error) {
      learned = []
    }
    let graphResult = { graph: null, stats: { mergedNodes: 0, adjustedClaims: 0 } }
    try {
      graphResult = consolidateGraphState(readGraph(graphFile))
      if (graphResult.stats.mergedNodes > 0 || graphResult.stats.adjustedClaims > 0) saveGraph(graphFile, graphResult.graph)
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] 夜间巩固图谱失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const date = new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    const report = {
      ok: true,
      at,
      date,
      learned: learned.map((item) => ({ kind: item.kind, title: item.title })),
      stats: graphResult.stats,
    }
    try {
      writeJsonAtomic(reportFile, report)
    } catch (error) {
      /* ignore */
    }
    try {
      if (journal && typeof journal.append === 'function') {
        await journal.append({
          kind: 'thought',
          text: `夜里整理：今天学到 ${learned.length} 条，图谱合并 ${graphResult.stats.mergedNodes} 个重复节点、调整 ${graphResult.stats.adjustedClaims} 条判断`,
        })
      }
    } catch (error) {
      /* ignore */
    }
    lastResult = report
    saveState({ lastRunDate: date, lastRunAt: at })
    logger?.info?.(`[dsh-little-whale] 夜间巩固：${learned.length} 条学习 / 合并 ${graphResult.stats.mergedNodes} 节点 / 调整 ${graphResult.stats.adjustedClaims} 判断`)
    return report
  }

  function shouldRunTonight(at = now()) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(at)))
    if (hour < runHour || hour > runHour + 2) return false
    const date = new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    return readState().lastRunDate !== date
  }

  function start() {
    if (disabled || timer !== null) return
    timer = setInterval(() => {
      if (!shouldRunTonight()) return
      runOnce().catch((error) => logger?.warn?.(`[dsh-little-whale] 夜间巩固失败：${error instanceof Error ? error.message : String(error)}`))
    }, checkIntervalMs)
    timer.unref?.()
  }
  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
  function snapshot() {
    return { disabled, lastResult, state: readState() }
  }
  return { graphFile, learningLogPath, reportFile, runOnce, start, stop, snapshot }
}
