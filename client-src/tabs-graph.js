// client-src/tabs-graph.js —— 认知图谱面板（v3.20：sigma.js WebGL + 类型/关系配色 + 搜索/高亮）
import Graph from 'graphology'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'

const TYPE_COLOR = {
  person: '#e6b566',
  institution: '#63b6d8',
  event: '#d97373',
  place: '#84cf93',
  concept: '#a78bfa',
  work: '#d7a8e8',
}
const TYPE_LABEL = { person: '人', institution: '制度', event: '事件', place: '地方', concept: '概念', work: '作品' }
const ALL_TYPES = ['person', 'institution', 'event', 'place', 'concept', 'work']
const REL_LABEL = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }
const REL_COLOR = {
  causal: 'rgba(230,181,102,0.42)',
  temporal: 'rgba(99,182,216,0.40)',
  contrast: 'rgba(217,115,115,0.40)',
  part_of: 'rgba(132,207,147,0.40)',
  example_of: 'rgba(167,139,250,0.40)',
}
const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' }
const GRAPH_VIEW_HEIGHT = 380
const LAYOUT_FORCE_MAX = 6000

let sigmaModulePromise = null
function loadSigma() {
  if (sigmaModulePromise === null) sigmaModulePromise = import('sigma')
  return sigmaModulePromise
}

function hexAlpha(hex, alpha) {
  const value = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#8aa2b4'
  const a = Math.max(0, Math.min(1, Number(alpha)))
  return value + Math.round(a * 255).toString(16).padStart(2, '0')
}

function sizeOf(node, degree) {
  const base = node.type === 'person' || node.type === 'institution' ? 6.5 : 5.2
  return Math.min(16, base + Math.sqrt(Math.max(0, degree)) * 1.6)
}

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
    links.push({
      source: source.__id,
      target: target.__id,
      relation: edge.relation,
      note: edge.note,
      confidence: edge.confidence,
    })
    if (links.length >= 40000) break
  }
  if (nodes.length <= LAYOUT_FORCE_MAX) {
    const simNodes = nodes.map((node) => ({ id: node.__id }))
    const simLinks = links.map((link) => ({ source: link.source, target: link.target }))
    const simulation = forceSimulation(simNodes)
      .force('link', forceLink(simLinks).id((item) => item.id).distance(64).strength(0.18))
      .force('charge', forceManyBody().strength(-30).theta(0.9))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide().radius(7))
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
  const degree = new Map()
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) || 0) + 1)
    degree.set(link.target, (degree.get(link.target) || 0) + 1)
  }
  const graph = new Graph({ multi: false })
  for (const node of nodes) {
    if (graph.hasNode(node.__id)) continue
    graph.addNode(node.__id, {
      label: node.name,
      x: node.x,
      y: node.y,
      size: sizeOf(node, degree.get(node.__id) || 0),
      color: TYPE_COLOR[node.type] || '#8aa2b4',
      labelColor: '#e7eef7',
      labelSize: 11,
      __node: node,
    })
  }
  for (const link of links) {
    if (graph.hasEdge(link.source, link.target)) continue
    const high = link.confidence === 'high'
    graph.addEdge(link.source, link.target, {
      color: REL_COLOR[link.relation] || 'rgba(140,170,190,0.30)',
      size: high ? 1.1 : 0.65,
      label: link.relation,
      __relation: link.relation,
      __note: link.note,
    })
  }
  return { graph, nodes, links, idSet: ids, degree }
}

export function createGraphTab(ctx = {}) {
  const h = ctx.h
  const React = ctx.React

  function GraphTab() {
    const [data, setData] = React.useState(null)
    const [error, setError] = React.useState('')
    const [selected, setSelected] = React.useState(null)
    const [hovered, setHovered] = React.useState(null)
    const [query, setQuery] = React.useState('')
    const [reloadKey, setReloadKey] = React.useState(0)
    const [stats, setStats] = React.useState({ nodes: 0, edges: 0, big: false })
    const containerRef = React.useRef(null)
    const rendererRef = React.useRef(null)
    const viewRef = React.useRef({ selected: null, hovered: null, query: '' })
    viewRef.current = { selected, hovered, query }

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
              labelDensity: 0.10,
              labelGridCellSize: 80,
              labelRenderedSizeThreshold: 6,
              minCameraRatio: 0.02,
              maxCameraRatio: 8,
              enableEdgeEvents: false,
              allowInvalidContainer: true,
              defaultEdgeType: 'line',
              nodeReducer: (node, dataAttributes) => {
                const view = viewRef.current
                const attrs = { ...dataAttributes }
                const baseSize = dataAttributes.size || 5
                if (view.selected === node) {
                  attrs.size = baseSize * 2.1
                  attrs.color = '#ffe9b8'
                  attrs.zIndex = 20
                  attrs.labelColor = '#fff3d1'
                } else if (view.hovered === node) {
                  attrs.size = baseSize * 1.45
                  attrs.zIndex = 10
                } else if (view.selected) {
                  attrs.color = hexAlpha(attrs.color, 0.42)
                  attrs.labelColor = 'rgba(220,232,245,0.35)'
                }
                if (view.query.trim().length > 0) {
                  const matched = String(dataAttributes.label || '').includes(view.query.trim())
                  if (!matched) {
                    attrs.color = hexAlpha(attrs.color, 0.18)
                    attrs.labelColor = 'rgba(220,232,245,0.18)'
                    attrs.size = Math.max(2.5, baseSize * 0.7)
                  } else if (view.selected !== node) {
                    attrs.color = '#ffe9b8'
                    attrs.zIndex = 12
                  }
                }
                return attrs
              },
              edgeReducer: (edge, dataAttributes) => {
                const view = viewRef.current
                const attrs = { ...dataAttributes }
                if (view.selected) {
                  let ends = []
                  try {
                    ends = built.graph.extremities(edge)
                  } catch {
                    ends = []
                  }
                  const connected = ends.includes(view.selected)
                  attrs.color = connected ? 'rgba(255,224,150,0.85)' : 'rgba(150,170,190,0.10)'
                  attrs.size = connected ? 1.8 : 0.4
                }
                return attrs
              },
            })
            renderer.on('clickNode', ({ node }) => {
              try {
                const attributes = built.graph.getNodeAttributes(node)
                if (attributes && attributes.__node) setSelected(attributes.__node.name)
              } catch {
                /* ignore */
              }
            })
            renderer.on('clickStage', () => setSelected(null))
            renderer.on('enterNode', ({ node }) => {
              try {
                const attributes = built.graph.getNodeAttributes(node)
                if (attributes && attributes.__node) setHovered(attributes.__node.name)
              } catch {
                /* ignore */
              }
            })
            renderer.on('leaveNode', () => setHovered(null))
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

    React.useEffect(() => {
      try { rendererRef.current && rendererRef.current.refresh() } catch { /* ignore */ }
    }, [selected, hovered, query])

    const resetView = () => {
      try { rendererRef.current && rendererRef.current.getCamera().animatedReset() } catch { /* ignore */ }
    }
    const zoomBy = (factor) => {
      try { rendererRef.current && rendererRef.current.getCamera().animatedZoom(factor) } catch { /* ignore */ }
    }
    const focusMatch = () => {
      const needle = query.trim()
      if (needle.length === 0) return
      const renderer = rendererRef.current
      if (!renderer) return
      try {
        const sigmaGraph = renderer.getGraph()
        let found = null
        sigmaGraph.forEachNode((node, attributes) => {
          if (found === null && String(attributes.label || '').includes(needle)) found = { node, attributes }
        })
        if (found === null) return
        renderer.getCamera().animate(
          { x: found.attributes.x, y: found.attributes.y, ratio: 0.45 },
          { duration: 450 },
        )
        setSelected(found.attributes.__node ? found.attributes.__node.name : null)
      } catch {
        /* ignore */
      }
    }

    const nodes = (Array.isArray(data && data.nodes) ? data.nodes : []).slice(0, 20000)
    const edges = (Array.isArray(data && data.edges) ? data.edges : []).slice(0, 40000)
    const selectedNode = selected ? nodes.find((node) => node.name === selected) : null
    const selectedRels = selectedNode ? edges.filter((edge) => edge.from === selectedNode.name || edge.to === selectedNode.name) : []
    const selectedClaims = selectedNode && Array.isArray(data && data.claims) ? data.claims.filter((claim) => Array.isArray(claim.nodes) && claim.nodes.includes(selectedNode.name)) : []
    const last = data && data.last ? data.last : null
    const lastText = last ? (last.ok === true ? `抽取 +${last.addedNodes || 0} 节点` : `抽取失败：${last.reason || 'unknown'}`) : '尚未抽取'
    const typeCounts = {}
    for (const node of nodes) {
      const type = node.type || 'concept'
      typeCounts[type] = (typeCounts[type] || 0) + 1
    }

    const detail = selectedNode
      ? h(
        'div',
        {
          style: {
            marginTop: 8,
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 12,
            lineHeight: 1.65,
            background: 'linear-gradient(135deg, rgba(255,233,184,0.10), rgba(120,160,200,0.06))',
            border: '1px solid rgba(255,233,184,0.28)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
          },
        },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 } },
          h('strong', { style: { fontSize: 14 } }, selectedNode.name),
          h('span', {
            style: {
              fontSize: 10,
              padding: '1px 7px',
              borderRadius: 9,
              color: '#0d1218',
              background: TYPE_COLOR[selectedNode.type] || '#8aa2b4',
              fontWeight: 600,
            },
          }, TYPE_LABEL[selectedNode.type] || selectedNode.type || '条目'),
          h('span', { style: { opacity: 0.55, marginLeft: 'auto' } }, '点空白处关闭')),
        selectedNode.summary ? h('div', { style: { opacity: 0.85, marginTop: 3 } }, selectedNode.summary) : null,
        selectedRels.length > 0
          ? h('div', { style: { marginTop: 8 } },
            h('div', { style: { opacity: 0.55, marginBottom: 4 } }, '关系'),
            ...selectedRels.slice(0, 8).map((edge) => h('div', { key: edge.id || edge.from + edge.to + edge.relation, style: { display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 } },
              h('span', { style: { fontSize: 10, padding: '0 6px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', opacity: 0.85 } }, REL_LABEL[edge.relation] || '关联'),
              h('span', null, edge.from === selectedNode.name ? `→ ${edge.to}` : `${edge.from} →`),
              edge.note ? h('span', { style: { opacity: 0.55 } }, `（${edge.note}）`) : null)))
          : null,
        selectedClaims.length > 0
          ? h('div', { style: { marginTop: 8 } },
            h('div', { style: { opacity: 0.55, marginBottom: 4 } }, '判断'),
            ...selectedClaims.slice(0, 4).map((claim) => h('div', { key: claim.id || claim.text, style: { marginBottom: 2 } },
              '“' + claim.text + '”',
              h('span', { style: { marginLeft: 6, fontSize: 10, opacity: 0.6 } }, '[' + (CONFIDENCE_LABEL[claim.confidence] || claim.confidence || '?') + ']'))))
          : null,
      )
      : null

    const legend = h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', fontSize: 11, opacity: 0.8 } },
      ...ALL_TYPES.filter((type) => typeCounts[type]).map((type) => h(
        'span',
        { key: 'legend-' + type, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { width: 8, height: 8, borderRadius: 4, background: TYPE_COLOR[type] } }),
        TYPE_LABEL[type] + ' ' + typeCounts[type],
      )),
      h('span', { style: { marginLeft: 'auto', opacity: 0.7 } }, '关系：'),
      ...Object.entries(REL_LABEL).map(([relation, label]) => h(
        'span',
        { key: 'legend-rel-' + relation, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { width: 14, height: 2, background: REL_COLOR[relation], borderRadius: 1 } }),
        label,
      )),
    )

    const hoverTooltip = hovered && hovered !== selected
      ? (() => {
        const node = nodes.find((item) => item.name === hovered)
        if (!node) return null
        return h(
          'div',
          {
            style: {
              position: 'absolute',
              left: 10,
              top: 10,
              maxWidth: 260,
              padding: '6px 9px',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.5,
              color: '#eaf1f8',
              background: 'rgba(10,16,24,0.86)',
              border: '1px solid ' + (TYPE_COLOR[node.type] || '#8aa2b4'),
              pointerEvents: 'none',
              zIndex: 5,
            },
          },
          h('div', { style: { fontWeight: 600, marginBottom: 2 } }, node.name),
          node.summary ? h('div', { style: { opacity: 0.75 } }, String(node.summary).slice(0, 100)) : null,
        )
      })()
      : null

    const body = error
      ? h('div', { style: { fontSize: 12, color: '#e0a458' } }, '读取/渲染图谱失败：' + error, h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', style: { marginLeft: 8 }, onClick: () => setReloadKey((n) => n + 1) }, '重试'))
      : nodes.length === 0
        ? h('div', { style: { fontSize: 12, lineHeight: 1.7, opacity: 0.85 } }, '图谱还在长：后台每 2 小时从学习日志里抽一轮。', h('br'), '当前状态：' + lastText + '。')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h(
            'div',
            {
              ref: containerRef,
              style: {
                position: 'relative',
                width: '100%',
                height: GRAPH_VIEW_HEIGHT + 'px',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'radial-gradient(120% 100% at 18% 8%, rgba(72,110,140,0.30), rgba(8,12,18,0.94) 62%), radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0)',
                backgroundSize: 'auto, 22px 22px',
                border: '1px solid rgba(140,180,210,0.22)',
                boxShadow: 'inset 0 0 40px rgba(0,0,0,0.30), 0 8px 24px rgba(0,0,0,0.18)',
              },
            },
            hoverTooltip,
          ),
          h('div', { style: { position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 4 } },
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '放大', onClick: () => zoomBy(1.4) }, '+'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '缩小', onClick: () => zoomBy(0.7) }, '−'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '复位', onClick: resetView }, '复位')),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              type: 'search',
              value: query,
              placeholder: '搜索节点…',
              'aria-label': '搜索图谱节点',
              onChange: (event) => setQuery(String((event && event.target && event.target.value) || '')),
              onKeyDown: (event) => { if (event && event.key === 'Enter') focusMatch() },
              style: {
                flex: '1 1 160px',
                minWidth: 120,
                padding: '5px 9px',
                borderRadius: 8,
                fontSize: 12,
                color: 'inherit',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                outline: 'none',
              },
            }),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: focusMatch }, '定位'),
            query.trim().length > 0 ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setQuery('') }, '清除') : null),
          detail)

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 } },
        h('strong', { style: { fontSize: 15, letterSpacing: 1.5, background: 'linear-gradient(90deg, #e6b566, #63b6d8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } }, '认知图谱'),
        h('span', { style: { opacity: 0.75 } }, stats.nodes + ' 节点 · ' + stats.edges + ' 关系 · ' + (data && data.claims ? data.claims.length : 0) + ' 判断'),
        h('span', { style: { opacity: 0.5, marginLeft: 'auto' } }, lastText)),
      body,
      legend,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, opacity: 0.55 } },
        h('span', null, 'WebGL · 滚轮缩放 · 拖动平移 · 点节点看详情' + (stats.big ? ' · 超大图已用简化布局' : '')),
        h('span', null, data && data.updatedAt ? '更新：' + new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '')),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setReloadKey((n) => n + 1) }, '重新载入')))
  }
  return GraphTab
}
