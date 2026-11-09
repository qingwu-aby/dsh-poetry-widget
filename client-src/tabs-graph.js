// client-src/tabs-graph.js —— 认知图谱面板（v3.03：sigma.js WebGL 渲染，可缩放/拖动）
import Graph from 'graphology'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'

const TYPE_COLOR = { person: '#e0a458', institution: '#5fb3d4', event: '#d46a6a', place: '#7fcb8f', concept: '#a78bfa', work: '#d4a5e0' }
const TYPE_LABEL = { person: '人', institution: '制度', event: '事件', place: '地方', concept: '概念', work: '作品' }
const REL_LABEL = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }
const GRAPH_VIEW_HEIGHT = 340
const LAYOUT_FORCE_MAX = 6000

// sigma 在模块加载阶段会摸 WebGL2RenderingContext；测试/无 WebGL 环境里不能静态引入。
let sigmaModulePromise = null
function loadSigma() {
  if (sigmaModulePromise === null) sigmaModulePromise = import('sigma')
  return sigmaModulePromise
}

function sizeOf(node) { return node.type === 'person' || node.type === 'institution' ? 7 : 5.5 }

/** 超大图（>6000）不做力导向，按类型分布到几圈上，保证打开不卡。 */
function ringLayout(nodes) {
  const byType = new Map()
  for (const node of nodes) {
    const type = node.type || 'concept'
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type).push(node)
  }
  let ring = 1
  for (const [, list] of byType) {
    const radius = 90 * ring
    list.forEach((node, index) => {
      const angle = (index / Math.max(1, list.length)) * Math.PI * 2
      node.x = Math.cos(angle) * radius
      node.y = Math.sin(angle) * radius
      node.vx = 0
      node.vy = 0
    })
    ring += 1
  }
}

function buildGraph(data) {
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter((node) => node && typeof node.name === 'string').slice(0, 20000)
  const byName = new Map()
  for (const node of nodes) {
    const key = byName.has(node.name) ? node.name + '#' + byName.size : node.name
    byName.set(node.name, node)
    node.__id = key
  }
  const ids = new Set(nodes.map((node) => node.__id))
  const links = []
  for (const edge of Array.isArray(data.edges) ? data.edges : []) {
    const source = byName.get(edge.from)
    const target = byName.get(edge.to)
    if (!source || !target || source === target) continue
    links.push({ source: source.__id, target: target.__id, relation: edge.relation, note: edge.note, confidence: edge.confidence })
    if (links.length >= 40000) break
  }
  if (nodes.length <= LAYOUT_FORCE_MAX) {
    const simNodes = nodes.map((node) => ({ id: node.__id }))
    const simLinks = links.map((link) => ({ source: link.source, target: link.target }))
    const simulation = forceSimulation(simNodes)
      .force('link', forceLink(simLinks).id((item) => item.id).distance(70).strength(0.15))
      .force('charge', forceManyBody().strength(-28).theta(0.9))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide().radius(6))
      .stop()
    simulation.tick(120)
    const positions = new Map(simNodes.map((item) => [item.id, item]))
    for (const node of nodes) {
      const position = positions.get(node.__id)
      node.x = position && Number.isFinite(position.x) ? position.x : 0
      node.y = position && Number.isFinite(position.y) ? position.y : 0
    }
  } else {
    ringLayout(nodes)
  }
  const graph = new Graph({ multi: false })
  for (const node of nodes) {
    if (graph.hasNode(node.__id)) continue
    graph.addNode(node.__id, {
      label: node.name,
      x: node.x,
      y: node.y,
      size: sizeOf(node),
      color: TYPE_COLOR[node.type] || '#8aa2b4',
      labelColor: '#dbe6f0',
      __node: node,
    })
  }
  for (const link of links) {
    if (graph.hasEdge(link.source, link.target)) continue
    graph.addEdge(link.source, link.target, { color: 'rgba(140,170,190,0.30)', size: 0.6 })
  }
  return { graph, nodes, links, idSet: ids }
}

export function createGraphTab(ctx = {}) {
  const h = ctx.h
  const React = ctx.React

  function GraphTab() {
    const [data, setData] = React.useState(null)
    const [error, setError] = React.useState('')
    const [selected, setSelected] = React.useState(null)
    const [reloadKey, setReloadKey] = React.useState(0)
    const [stats, setStats] = React.useState({ nodes: 0, edges: 0, big: false })
    const containerRef = React.useRef(null)
    const rendererRef = React.useRef(null)

    React.useEffect(() => {
      let alive = true
      const load = () => {
        fetch('/api/dsh-poetry/graph.json', { cache: 'no-store' })
          .then((res) => {
            if (!res || res.ok !== true) throw new Error('HTTP ' + (res ? res.status : 'error'))
            return res.json()
          })
          .then((json) => {
            if (!alive) return
            setData(json)
            setError('')
          })
          .catch((err) => {
            if (!alive) return
            setError(String((err && err.message) || err))
          })
      }
      load()
      const timer = setInterval(load, 45000)
      return () => {
        alive = false
        clearInterval(timer)
      }
    }, [reloadKey])

    React.useEffect(() => {
      const container = containerRef.current
      if (!container || !data) return undefined
      let cancelled = false
      let cleanup = () => {}
      loadSigma()
        .then((module) => {
          if (cancelled) return undefined
          const Sigma = module && module.default ? module.default : module
          try {
            const built = buildGraph(data)
            if (built.nodes.length === 0) return undefined
            setStats({ nodes: built.nodes.length, edges: built.links.length, big: built.nodes.length > LAYOUT_FORCE_MAX })
            const renderer = new Sigma(built.graph, container, {
              renderLabels: true,
              hideLabelsOnMove: true,
              hideEdgesOnMove: true,
              labelDensity: 0.12,
              labelRenderedSizeThreshold: 7,
              minCameraRatio: 0.02,
              maxCameraRatio: 8,
              enableEdgeEvents: false,
              allowInvalidContainer: true,
            })
            renderer.on('clickNode', ({ node }) => {
              try {
                const attributes = built.graph.getNodeAttributes(node)
                if (attributes && attributes.__node) setSelected(attributes.__node.name)
              } catch { /* ignore */ }
            })
            renderer.on('clickStage', () => setSelected(null))
            rendererRef.current = renderer
            cleanup = () => {
              try { renderer.kill() } catch { /* ignore */ }
              rendererRef.current = null
            }
            return cleanup
          } catch (err) {
            setError('渲染失败：' + String((err && err.message) || err))
            return undefined
          }
        })
        .catch((err) => {
          if (!cancelled) setError('加载渲染器失败：' + String((err && err.message) || err))
        })
      return () => {
        cancelled = true
        cleanup()
      }
    }, [data, reloadKey])

    const resetView = () => {
      try { rendererRef.current && rendererRef.current.getCamera().animatedReset() } catch { /* ignore */ }
    }
    const zoomBy = (factor) => {
      try { rendererRef.current && rendererRef.current.getCamera().animatedZoom(factor) } catch { /* ignore */ }
    }

    const nodes = (Array.isArray(data && data.nodes) ? data.nodes : []).slice(0, 20000)
    const edges = (Array.isArray(data && data.edges) ? data.edges : []).slice(0, 40000)
    const selectedNode = selected ? nodes.find((node) => node.name === selected) : null
    const selectedRels = selectedNode ? edges.filter((edge) => edge.from === selectedNode.name || edge.to === selectedNode.name) : []
    const selectedClaims = selectedNode && Array.isArray(data && data.claims) ? data.claims.filter((claim) => Array.isArray(claim.nodes) && claim.nodes.includes(selectedNode.name)) : []
    const last = data && data.last ? data.last : null
    const lastText = last ? (last.ok === true ? `抽取 +${last.addedNodes || 0} 节点` : `抽取失败：${last.reason || 'unknown'}`) : '尚未抽取'
    const detail = selectedNode
      ? h('div', { style: { marginTop: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 12, lineHeight: 1.65 } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
          h('strong', null, selectedNode.name),
          h('span', { style: { color: TYPE_COLOR[selectedNode.type] || '#8aa2b4' } }, TYPE_LABEL[selectedNode.type] || selectedNode.type || '条目')),
        selectedNode.summary ? h('div', { style: { opacity: 0.8, marginTop: 3 } }, selectedNode.summary) : null,
        selectedRels.length > 0 ? h('div', { style: { marginTop: 5, opacity: 0.85 } },
          selectedRels.slice(0, 8).map((edge) => h('div', { key: edge.id || edge.from + edge.to + edge.relation },
            edge.from === selectedNode.name ? `${REL_LABEL[edge.relation] || '关联'} ${edge.to}` : `${edge.from} ${REL_LABEL[edge.relation] || '关联'} 它`,
            edge.note ? `（${edge.note}）` : ''))) : null,
        selectedClaims.length > 0 ? h('div', { style: { marginTop: 5, opacity: 0.85 } },
          selectedClaims.slice(0, 4).map((claim) => h('div', { key: claim.id || claim.text }, '判断：' + claim.text + ' [' + (claim.confidence || 'low') + ']'))) : null)
      : null

    const body = error
      ? h('div', { style: { fontSize: 12, color: '#e0a458' } }, '读取/渲染图谱失败：' + error, h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', style: { marginLeft: 8 }, onClick: () => setReloadKey((n) => n + 1) }, '重试'))
      : nodes.length === 0
        ? h('div', { style: { fontSize: 12, lineHeight: 1.7, opacity: 0.85 } }, '图谱还在长：后台每 2 小时从学习日志里抽一轮。', h('br'), '当前状态：' + lastText + '。')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { ref: containerRef, style: { position: 'relative', width: '100%', height: GRAPH_VIEW_HEIGHT + 'px', borderRadius: 10, overflow: 'hidden', background: 'rgba(10,16,22,0.55)', border: '1px solid rgba(255,255,255,0.08)' } }),
          h('div', { style: { position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 } },
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '放大', onClick: () => zoomBy(1.4) }, '+'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '缩小', onClick: () => zoomBy(0.7) }, '−'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '复位', onClick: resetView }, '复位')),
          h('div', { style: { fontSize: 11, opacity: 0.55 } }, 'WebGL · 滚轮缩放 · 拖动平移 · 点节点看详情' + (stats.big ? ' · 超大图已用简化布局' : '')),
          detail)

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 } },
        h('strong', null, '认知图谱'),
        h('span', { style: { opacity: 0.7 } }, stats.nodes + ' 节点 / ' + stats.edges + ' 关系 / ' + (data && data.claims ? data.claims.length : 0) + ' 判断'),
        h('span', { style: { opacity: 0.55 } }, lastText)),
      body,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, opacity: 0.6 } },
        h('span', null, data && data.updatedAt ? '更新：' + new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''),
        h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setReloadKey((n) => n + 1) }, '重新载入')))
  }
  return GraphTab
}
