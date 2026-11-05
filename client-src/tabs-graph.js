// client-src/tabs-graph.js —— 认知图谱面板（v2.94）
// 在插件面板里直接画图谱：节点/关系/判断，点节点看详情。
const TYPE_COLOR = { person: '#e0a458', institution: '#5fb3d4', event: '#d46a6a', place: '#7fcb8f', concept: '#a78bfa', work: '#d4a5e0' }
const REL_LABEL = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' }
const TYPE_LABEL = { person: '人', institution: '制度', event: '事件', place: '地方', concept: '概念', work: '作品' }

function bigrams(value) {
  const chars = Array.from(String(value || '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

function computeLayout(data, width, height) {
  const nodes = Array.isArray(data && data.nodes) ? data.nodes.filter((n) => n && typeof n.name === 'string') : []
  const edges = Array.isArray(data && data.edges) ? data.edges : []
  const ids = new Map(nodes.map((node, index) => [node.name, index]))
  const links = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  const cx = width / 2
  const cy = height / 2
  const points = nodes.map((node) => ({ x: cx + (Math.random() - 0.5) * width * 0.7, y: cy + (Math.random() - 0.5) * height * 0.7, vx: 0, vy: 0, node }))
  for (let step = 0; step < 240; step += 1) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = points[j].x - points[i].x
        const dy = points[j].y - points[i].y
        const d2 = dx * dx + dy * dy + 0.01
        const d = Math.sqrt(d2)
        const force = 2600 / d2
        points[i].vx -= (dx / d) * force
        points[i].vy -= (dy / d) * force
        points[j].vx += (dx / d) * force
        points[j].vy += (dy / d) * force
      }
    }
    for (const link of links) {
      const a = points[ids.get(link.from)]
      const b = points[ids.get(link.to)]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const force = (d - 120) * 0.02
      a.vx += (dx / d) * force
      a.vy += (dy / d) * force
      b.vx -= (dx / d) * force
      b.vy -= (dy / d) * force
    }
    for (const p of points) {
      p.vx += (cx - p.x) * 0.0012
      p.vy += (cy - p.y) * 0.0012
      p.vx *= 0.85
      p.vy *= 0.85
      p.x += p.vx
      p.y += p.vy
    }
  }
  return { nodes, links, points, ids }
}

export function createGraphTab(ctx = {}) {
  const h = ctx.h
  const React = ctx.React

  function GraphTab() {
    const [data, setData] = React.useState(null)
    const [error, setError] = React.useState('')
    const [selected, setSelected] = React.useState(null)
    const [size, setSize] = React.useState({ width: 380, height: 300 })
    const [reloadKey, setReloadKey] = React.useState(0)
    const boxRef = React.useRef(null)

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

    React.useEffect(() => {
      const measure = () => {
        const box = boxRef.current
        if (!box || typeof box.getBoundingClientRect !== 'function') return
        const rect = box.getBoundingClientRect()
        if (rect.width > 40) setSize({ width: Math.round(rect.width), height: Math.max(240, Math.min(380, Math.round(rect.width * 0.8))) })
      }
      measure()
      if (typeof window !== 'undefined') window.addEventListener('resize', measure)
      return () => {
        if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
      }
    }, [data])

    const layout = React.useMemo(() => computeLayout(data, size.width, size.height), [data, size.width, size.height])
    const nodeCount = layout.nodes.length
    const last = data && data.last ? data.last : null
    const lastText = last ? (last.ok === true ? `抽取 +${last.addedNodes || 0} 节点` : `抽取失败：${last.reason || 'unknown'}`) : '尚未抽取'
    const selectedNode = selected ? layout.nodes.find((node) => node.name === selected) : null
    const selectedRels = selectedNode && data && Array.isArray(data.edges)
      ? data.edges.filter((edge) => edge.from === selectedNode.name || edge.to === selectedNode.name)
      : []
    const selectedClaims = selectedNode && data && Array.isArray(data.claims)
      ? data.claims.filter((claim) => Array.isArray(claim.nodes) && claim.nodes.includes(selectedNode.name))
      : []

    const detail = selectedNode
      ? h('div', { style: { marginTop: 10, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 12, lineHeight: 1.6 } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
          h('strong', null, selectedNode.name),
          h('span', { style: { color: TYPE_COLOR[selectedNode.type] || '#8aa2b4' } }, TYPE_LABEL[selectedNode.type] || selectedNode.type || '条目')),
        selectedNode.summary ? h('div', { style: { opacity: 0.8, marginTop: 4 } }, selectedNode.summary) : null,
        selectedRels.length > 0
          ? h('div', { style: { marginTop: 6, opacity: 0.85 } },
            selectedRels.slice(0, 8).map((edge) => h('div', { key: edge.id || edge.from + edge.to + edge.relation },
              edge.from === selectedNode.name
                ? `${REL_LABEL[edge.relation] || '关联'} ${edge.to}`
                : `${edge.from} ${REL_LABEL[edge.relation] || '关联'} 它`,
              edge.note ? `（${edge.note}）` : '', ' ', h('span', { style: { opacity: 0.5 } }, '[' + (edge.confidence || 'low') + ']'))))
          : null,
        selectedClaims.length > 0
          ? h('div', { style: { marginTop: 6, opacity: 0.85 } },
            selectedClaims.slice(0, 4).map((claim) => h('div', { key: claim.id || claim.text }, '判断：' + claim.text + ' [' + (claim.confidence || 'low') + ']')))
          : null)
      : null

    const linkEls = layout.links.map((edge, index) => {
      const a = layout.points[layout.ids.get(edge.from)]
      const b = layout.points[layout.ids.get(edge.to)]
      if (!a || !b) return null
      return h('line', { key: 'l' + index, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'rgba(140,170,190,0.35)', strokeWidth: 1 })
    })
    const nodeEls = layout.points.map((p) => h('g', { key: 'n' + p.node.name, style: { cursor: 'pointer' }, onClick: () => setSelected(p.node.name) },
      h('circle', { cx: p.x, cy: p.y, r: selected === p.node.name ? 9 : 6, fill: TYPE_COLOR[p.node.type] || '#8aa2b4', stroke: '#0f1720', strokeWidth: 2 }),
      h('text', { x: p.x + 9, y: p.y + 4, fill: 'rgba(210,225,235,0.9)', fontSize: 11 }, p.node.name)))
    const svgEl = nodeCount === 0
      ? null
      : h('div', { ref: boxRef, style: { position: 'relative', width: '100%', borderRadius: 10, overflow: 'hidden', background: 'rgba(10,16,22,0.55)' } },
        h('svg', { viewBox: `0 0 ${size.width} ${size.height}`, width: '100%', height: size.height, style: { display: 'block' } }, linkEls, nodeEls),
        detail)
    const emptyEl = nodeCount === 0
      ? h('div', { style: { fontSize: 12, lineHeight: 1.7, opacity: 0.85 } },
        '图谱还在长：后台每 2 小时从学习日志里抽一轮。', h('br'), '当前状态：' + lastText + '。')
      : null
    const errorEl = error
      ? h('div', { style: { fontSize: 12, color: '#e0a458' } }, '读取图谱失败：' + error, h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', style: { marginLeft: 8 }, onClick: () => setReloadKey((n) => n + 1) }, '重试'))
      : null
    const body = errorEl || emptyEl || svgEl

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 } },
        h('strong', null, '认知图谱'),
        h('span', { style: { opacity: 0.7 } }, nodeCount + ' 节点 / ' + (layout.links.length) + ' 关系'),
        h('span', { style: { opacity: 0.55 } }, lastText)),
      body,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, opacity: 0.6 } },
        h('span', null, data && data.updatedAt ? '更新：' + new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''),
        h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setReloadKey((n) => n + 1) }, '重新载入')))
  }
  return GraphTab
}
