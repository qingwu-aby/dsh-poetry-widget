// client-src/tabs-graph.js —— 认知图谱面板（v3.02：canvas + d3 力导向，可缩放/拖动）
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import { zoom, zoomIdentity } from 'd3-zoom'
import { select } from 'd3-selection'

const TYPE_COLOR = { person: '#e0a458', institution: '#5fb3d4', event: '#d46a6a', place: '#7fcb8f', concept: '#a78bfa', work: '#d4a5e0' }
const REL_LABEL = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }
const TYPE_LABEL = { person: '人', institution: '制度', event: '事件', place: '地方', concept: '概念', work: '作品' }
const GRAPH_VIEW_HEIGHT = 340

function sizeOf(node) { return node.type === 'person' || node.type === 'institution' ? 6.5 : 5.2 }

export function createGraphTab(ctx = {}) {
  const h = ctx.h
  const React = ctx.React

  function GraphTab() {
    const [data, setData] = React.useState(null)
    const [error, setError] = React.useState('')
    const [selected, setSelected] = React.useState(null)
    const [reloadKey, setReloadKey] = React.useState(0)
    const [zoomLevel, setZoomLevel] = React.useState(1)
    const wrapRef = React.useRef(null)
    const canvasRef = React.useRef(null)
    const graphRef = React.useRef(null)
    const transformRef = React.useRef(zoomIdentity)
    const selectedRef = React.useRef(null)

    React.useEffect(() => { selectedRef.current = selected }, [selected])

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
      const timer = setInterval(load, 30000)
      return () => {
        alive = false
        clearInterval(timer)
      }
    }, [reloadKey])

    // 用 d3-force 建图 + d3-zoom 缩放；canvas 每帧重绘。
    React.useEffect(() => {
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas || !data) return undefined
      const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter((node) => node && typeof node.name === 'string').slice(0, 3000).map((node) => ({ ...node }))
      const byName = new Map(nodes.map((node) => [node.name, node]))
      const links = (Array.isArray(data.edges) ? data.edges : [])
        .filter((edge) => byName.has(edge.from) && byName.has(edge.to))
        .slice(0, 6000)
        .map((edge) => ({ source: edge.from, target: edge.to, relation: edge.relation, note: edge.note, confidence: edge.confidence }))
      if (nodes.length === 0) { graphRef.current = null; return undefined }

      const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
      const width = Math.max(260, wrap.clientWidth || 360)
      const height = GRAPH_VIEW_HEIGHT
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      const context = canvas.getContext('2d')
      if (!context) return undefined
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      const draw = () => {
        const transform = transformRef.current
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.clearRect(0, 0, width, height)
        context.save()
        context.translate(transform.x, transform.y)
        context.scale(transform.k, transform.k)
        context.lineWidth = 0.6 / transform.k
        context.strokeStyle = 'rgba(140,170,190,0.30)'
        context.beginPath()
        for (const link of links) {
          if (!link.source || typeof link.source.x !== 'number' || !link.target || typeof link.target.x !== 'number') continue
          context.moveTo(link.source.x, link.source.y)
          context.lineTo(link.target.x, link.target.y)
        }
        context.stroke()
        const selectedName = selectedRef.current
        const showLabels = transform.k >= 0.55
        for (const node of nodes) {
          if (typeof node.x !== 'number' || typeof node.y !== 'number') continue
          const radius = sizeOf(node) + (node.name === selectedName ? 3 : 0)
          context.beginPath()
          context.fillStyle = TYPE_COLOR[node.type] || '#8aa2b4'
          context.arc(node.x, node.y, radius, 0, Math.PI * 2)
          context.fill()
          if (node.name === selectedName) {
            context.strokeStyle = '#ffffff'
            context.lineWidth = 2 / transform.k
            context.stroke()
          }
        }
        if (showLabels) {
          context.fillStyle = 'rgba(210,225,235,0.92)'
          const fontSize = 10 / transform.k
          context.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif'
          context.textBaseline = 'middle'
          for (const node of nodes) {
            if (typeof node.x !== 'number') continue
            context.fillText(node.name, node.x + (sizeOf(node) + 3) / transform.k, node.y)
          }
        }
        context.restore()
      }

      const simulation = forceSimulation(nodes)
        .force('link', forceLink(links).id((node) => node.name).distance(70).strength(0.18))
        .force('charge', forceManyBody().strength(-30).theta(0.9))
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide().radius((node) => sizeOf(node) + 2))
        .alphaDecay(0.035)
        .stop()
      simulation.tick(160)
      draw()
      simulation.on('tick', draw)
      simulation.alpha(0.25).restart()

      const zoomBehavior = zoom()
        .scaleExtent([0.08, 8])
        .on('zoom', (event) => {
          transformRef.current = event.transform
          setZoomLevel(Number(event.transform.k.toFixed(2)))
          draw()
        })
      const selection = select(canvas)
      selection.call(zoomBehavior)
      selection.on('dblclick.zoom', null)

      const pickNode = (event) => {
        const rect = canvas.getBoundingClientRect()
        const transform = transformRef.current
        const gx = (event.clientX - rect.left - transform.x) / transform.k
        const gy = (event.clientY - rect.top - transform.y) / transform.k
        let best = null
        let bestDistance = 14
        for (const node of nodes) {
          if (typeof node.x !== 'number') continue
          const distance = Math.hypot(node.x - gx, node.y - gy)
          if (distance < bestDistance) { best = node; bestDistance = distance }
        }
        if (best !== null) setSelected(best.name)
      }
      canvas.addEventListener('click', pickNode)
      graphRef.current = { nodes, links, simulation, width, height }

      return () => {
        simulation.stop()
        selection.on('.zoom', null)
        canvas.removeEventListener('click', pickNode)
        graphRef.current = null
      }
    }, [data, reloadKey])

    const resetView = () => {
      const graph = graphRef.current
      if (!graph || !canvasRef.current) return
      const reset = zoomIdentity.translate(0, 0).scale(1)
      select(canvasRef.current).call(zoom().transform, reset)
      transformRef.current = reset
      setZoomLevel(1)
    }
    const nudgeZoom = (factor) => {
      const graph = graphRef.current
      if (!graph || !canvasRef.current) return
      const behavior = zoom().scaleExtent([0.08, 8])
      select(canvasRef.current).call(behavior.scaleBy, factor)
    }

    const nodes = (Array.isArray(data && data.nodes) ? data.nodes : [])
    const edges = (Array.isArray(data && data.edges) ? data.edges : [])
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
      ? h('div', { style: { fontSize: 12, color: '#e0a458' } }, '读取图谱失败：' + error, h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', style: { marginLeft: 8 }, onClick: () => setReloadKey((n) => n + 1) }, '重试'))
      : nodes.length === 0
        ? h('div', { style: { fontSize: 12, lineHeight: 1.7, opacity: 0.85 } }, '图谱还在长：后台每 2 小时从学习日志里抽一轮。', h('br'), '当前状态：' + lastText + '。')
        : h('div', { ref: wrapRef, style: { position: 'relative', width: '100%', borderRadius: 10, overflow: 'hidden', background: 'rgba(10,16,22,0.55)', border: '1px solid rgba(255,255,255,0.08)' } },
          h('canvas', { ref: canvasRef, style: { display: 'block', cursor: 'grab' } }),
          h('div', { style: { position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 } },
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '放大', onClick: () => nudgeZoom(1.3) }, '+'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '缩小', onClick: () => nudgeZoom(0.77) }, '−'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '复位', onClick: resetView }, '复位')),
          h('div', { style: { position: 'absolute', left: 8, bottom: 8, fontSize: 11, opacity: 0.55 } }, '滚轮缩放 · 拖动平移 · 点节点看详情 · ' + zoomLevel + '×'),
          detail)

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 } },
        h('strong', null, '认知图谱'),
        h('span', { style: { opacity: 0.7 } }, nodes.length + ' 节点 / ' + edges.length + ' 关系 / ' + (data && data.claims ? data.claims.length : 0) + ' 判断'),
        h('span', { style: { opacity: 0.55 } }, lastText)),
      body,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, opacity: 0.6 } },
        h('span', null, data && data.updatedAt ? '更新：' + new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''),
        h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setReloadKey((n) => n + 1) }, '重新载入')))
  }
  return GraphTab
}
