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
const PROVENANCE_LABEL = { grounded: '读到', inferred: '推断', weak: '待定' }
const PROVENANCE_COLOR = {
  grounded: 'rgba(150,190,220,0.45)',
  inferred: 'rgba(150,170,190,0.22)',
  weak: 'rgba(190,170,140,0.30)',
}
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
      sources: edge.sources,
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
      __baseSize: sizeOf(node, degree.get(node.__id) || 0),
      color: TYPE_COLOR[node.type] || '#8aa2b4',
      labelColor: '#e7eef7',
      labelSize: 11,
      __node: node,
    })
  }
  for (const link of links) {
    if (graph.hasEdge(link.source, link.target)) continue
    const high = link.confidence === 'high'
    const sourceCount = Array.isArray(link.sources) ? link.sources.length : 0
    const provenance = sourceCount > 0 && (link.confidence === 'high' || link.confidence === 'medium')
      ? 'grounded'
      : sourceCount > 0
        ? 'weak'
        : 'inferred'
    graph.addEdge(link.source, link.target, {
      color: provenance === 'grounded' ? REL_COLOR[link.relation] || PROVENANCE_COLOR.grounded : PROVENANCE_COLOR[provenance],
      size: provenance === 'grounded' ? (high ? 1.1 : 0.8) : 0.5,
      label: link.relation,
      __relation: link.relation,
      __note: link.note,
      __provenance: provenance,
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
    const [rotateMode, setRotateMode] = React.useState(false)
    const [view3d, setView3d] = React.useState(false)
    const [reloadKey, setReloadKey] = React.useState(0)
    const [stats, setStats] = React.useState({ nodes: 0, edges: 0, big: false })
    const containerRef = React.useRef(null)
    const rendererRef = React.useRef(null)
    const fingerprintRef = React.useRef('')
    const layoutRef = React.useRef(null)
    const rotateModeRef = React.useRef(false)
    rotateModeRef.current = rotateMode
    const view3dRef = React.useRef(false)
    view3dRef.current = view3d
    const applyCameraRef = React.useRef(null)
    const cameraRef = React.useRef({ on: false, pitch: 0, yaw: 0, focal: 620 })
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
            const fingerprint = [json && json.updatedAt, json && Array.isArray(json.nodes) ? json.nodes.length : 0, json && Array.isArray(json.edges) ? json.edges.length : 0].join('|')
            if (fingerprint === fingerprintRef.current) {
              setError('')
              return
            }
            fingerprintRef.current = fingerprint
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
                // 不做任何“高光”染色：选中/悬停只微微放大，颜色保持原样。
                if (view.selected === node) {
                  attrs.size = baseSize * 1.4
                  attrs.zIndex = 20
                } else if (view.hovered === node) {
                  attrs.size = baseSize * 1.18
                  attrs.zIndex = 10
                }
                if (view.query.trim().length > 0) {
                  const matched = String(dataAttributes.label || '').includes(view.query.trim())
                  if (!matched) {
                    attrs.color = hexAlpha(attrs.color, 0.22)
                    attrs.labelColor = 'rgba(220,232,245,0.22)'
                    attrs.size = Math.max(2.5, baseSize * 0.75)
                  }
                }
                return attrs
              },
              edgeReducer: (edge, dataAttributes) => dataAttributes,
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

            // 动态布局：持续柔和的力导向 + 可拖拽节点 + 闲置时轻微“呼吸”，不是一张静态图。
            const simNodes = []
            const simIndex = new Map()
            built.graph.forEachNode((id, attributes) => {
              const item = { id, x: Number(attributes.x) || 0, y: Number(attributes.y) || 0 }
              simNodes.push(item)
              simIndex.set(id, item)
            })
            const simLinks = []
            built.graph.forEachEdge((edge, attributes, source, target) => simLinks.push({ source, target }))
            // 3D 相机：给节点一个按类型的“深度”，绕 X/Y 轴投影；标签始终正立，交互仍可用。
            const basePos = new Map()
            for (const item of simNodes) basePos.set(item.id, { x: item.x, y: item.y })
            const typeDepth = { person: 0, institution: 18, event: -18, place: 26, concept: 0, work: -26 }
            const depthOf = (id) => {
              const node = built.graph.getNodeAttributes(id)
              const type = node && node.__node ? node.__node.type : 'concept'
              let hash = 0
              const name = String((node && node.label) || id)
              for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 1000
              return (typeDepth[type] || 0) + (hash % 17) - 8
            }
            const applyCamera = () => {
              const camera = cameraRef.current
              const on = camera.on === true
              const cosYaw = Math.cos(camera.yaw)
              const sinYaw = Math.sin(camera.yaw)
              const cosPitch = Math.cos(camera.pitch)
              const sinPitch = Math.sin(camera.pitch)
              for (const item of simNodes) {
                const base = basePos.get(item.id)
                if (!base) continue
                const attributes = built.graph.getNodeAttributes(item.id)
                const baseSize = Number(attributes.__baseSize || attributes.size || 5)
                if (!on) {
                  built.graph.setNodeAttribute(item.id, 'x', base.x)
                  built.graph.setNodeAttribute(item.id, 'y', base.y)
                  built.graph.setNodeAttribute(item.id, 'size', baseSize)
                  continue
                }
                const z = depthOf(item.id)
                const x1 = base.x * cosYaw - z * sinYaw
                const z1 = base.x * sinYaw + z * cosYaw
                const y2 = base.y * cosPitch - z1 * sinPitch
                const z2 = base.y * sinPitch + z1 * cosPitch
                const scale = camera.focal / Math.max(160, camera.focal + z2)
                built.graph.setNodeAttribute(item.id, 'x', x1 * scale)
                built.graph.setNodeAttribute(item.id, 'y', y2 * scale)
                built.graph.setNodeAttribute(item.id, 'size', Math.max(2.2, baseSize * scale))
              }
              try {
                renderer.refresh()
              } catch {
                /* ignore */
              }
            }
            applyCameraRef.current = applyCamera

            const liveSim = forceSimulation(simNodes)
              .force('link', forceLink(simLinks).id((item) => item.id).distance(46).strength(0.22))
              .force('charge', forceManyBody().strength(-20).distanceMax(320))
              .force('center', forceCenter(0, 0))
              .force('collide', forceCollide((item) => (built.graph.getNodeAttributes(item.id).size || 5) + 1.5))
              .stop()
            let tickCount = 0
            liveSim.on('tick', () => {
              tickCount += 1
              if (tickCount % 2 !== 0) return
              for (const item of simNodes) {
                const base = basePos.get(item.id)
                if (base) {
                  base.x = item.x
                  base.y = item.y
                }
              }
              applyCamera()
            })
            layoutRef.current = liveSim
            liveSim.alpha(0.12).restart()

            let drag = null
            const toGraph = (clientX, clientY) => {
              const rect = container.getBoundingClientRect()
              return renderer.getCamera().viewportToFramedGraph({ x: clientX - rect.left, y: clientY - rect.top })
            }
            const onPointerMove = (event) => {
              if (drag === null) return
              try {
                const point = toGraph(event.clientX, event.clientY)
                const item = simIndex.get(drag.id)
                if (!item) return
                item.fx = point.x
                item.fy = point.y
                item.x = point.x
                item.y = point.y
                const base = basePos.get(item.id)
                if (base) {
                  base.x = point.x
                  base.y = point.y
                }
                applyCamera()
              } catch {
                /* ignore */
              }
            }
            const onPointerUp = () => {
              if (drag !== null) {
                const item = simIndex.get(drag.id)
                if (item) {
                  item.fx = null
                  item.fy = null
                }
              }
              drag = null
              try {
                liveSim.alpha(0.12).restart()
              } catch {
                /* ignore */
              }
            }
            renderer.on('downNode', (payload) => {
              try {
                if (rotateModeRef.current || view3dRef.current) return
                const id = payload.node
                const item = simIndex.get(id)
                if (!item) return
                drag = { id }
                item.fx = item.x
                item.fy = item.y
                liveSim.alpha(0.35).restart()
                if (typeof window !== 'undefined') {
                  window.addEventListener('pointermove', onPointerMove)
                  window.addEventListener('pointerup', onPointerUp)
                }
              } catch {
                /* ignore */
              }
            })
            const breatheTimer = setInterval(() => {
              try {
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
                if (drag !== null) return
                liveSim.alpha(0.03).restart()
              } catch {
                /* ignore */
              }
            }, 14000)

            // 拖动旋转：Shift + 拖动，或打开「旋转」模式后直接拖动画布；绕图中心整体转。
            let rotation = null
            const rotateBy = (deltaAngle) => {
              if (Math.abs(deltaAngle) < 0.001) return
              let centerX = 0
              let centerY = 0
              let count = 0
              built.graph.forEachNode((_id, attributes) => {
                centerX += Number(attributes.x) || 0
                centerY += Number(attributes.y) || 0
                count += 1
              })
              if (count === 0) return
              centerX /= count
              centerY /= count
              const cos = Math.cos(deltaAngle)
              const sin = Math.sin(deltaAngle)
              for (const item of simNodes) {
                const base = basePos.get(item.id)
                if (!base) continue
                const dx = base.x - centerX
                const dy = base.y - centerY
                const nextX = centerX + dx * cos - dy * sin
                const nextY = centerY + dx * sin + dy * cos
                base.x = nextX
                base.y = nextY
                item.x = nextX
                item.y = nextY
                item.fx = nextX
                item.fy = nextY
              }
              applyCamera()
            }
            const onRotatePointerMove = (event) => {
              if (rotation === null) return
              const angle = Math.atan2(event.clientY - rotation.startY, event.clientX - rotation.startX)
              const delta = angle - rotation.lastAngle
              rotation.lastAngle = angle
              rotateBy(delta)
              rotation.moved = true
            }
            const onRotatePointerUp = () => {
              if (rotation !== null) {
                built.graph.forEachNode((_id, _attributes) => {
                  const item = simIndex.get(_id)
                  if (item) {
                    item.fx = null
                    item.fy = null
                  }
                })
              }
              rotation = null
              if (typeof window !== 'undefined') {
                window.removeEventListener('pointermove', onRotatePointerMove)
                window.removeEventListener('pointerup', onRotatePointerUp)
              }
              try {
                liveSim.alpha(0.06).restart()
              } catch {
                /* ignore */
              }
              container.style.cursor = ''
            }
            const onRotatePointerDown = (event) => {
              if (view3dRef.current) return
              if (!(event.shiftKey || rotateModeRef.current)) return
              if (drag !== null) return
              event.preventDefault()
              event.stopPropagation()
              try {
                liveSim.stop()
              } catch {
                /* ignore */
              }
              rotation = {
                startX: event.clientX,
                startY: event.clientY,
                lastAngle: Math.atan2(0, 1),
                moved: false,
              }
              container.style.cursor = 'grabbing'
              if (typeof window !== 'undefined') {
                window.addEventListener('pointermove', onRotatePointerMove)
                window.addEventListener('pointerup', onRotatePointerUp)
              }
            }
            container.addEventListener('pointerdown', onRotatePointerDown, true)

            // 3D 视角下：拖动画布旋转相机（yaw/pitch），不移动布局。
            let cameraDrag = null
            const onCameraPointerMove = (event) => {
              if (cameraDrag === null) return
              const dx = event.clientX - cameraDrag.x
              const dy = event.clientY - cameraDrag.y
              cameraDrag.x = event.clientX
              cameraDrag.y = event.clientY
              cameraRef.current.yaw += dx * 0.006
              cameraRef.current.pitch = Math.max(-1.1, Math.min(1.1, cameraRef.current.pitch + dy * 0.006))
              applyCamera()
            }
            const onCameraPointerUp = () => {
              cameraDrag = null
              if (typeof window !== 'undefined') {
                window.removeEventListener('pointermove', onCameraPointerMove)
                window.removeEventListener('pointerup', onCameraPointerUp)
              }
              container.style.cursor = ''
              try {
                liveSim.alpha(0.05).restart()
              } catch {
                /* ignore */
              }
            }
            const onCameraPointerDown = (event) => {
              if (!view3dRef.current) return
              if (cameraDrag !== null) return
              event.preventDefault()
              event.stopPropagation()
              cameraDrag = { x: event.clientX, y: event.clientY }
              container.style.cursor = 'grabbing'
              if (typeof window !== 'undefined') {
                window.addEventListener('pointermove', onCameraPointerMove)
                window.addEventListener('pointerup', onCameraPointerUp)
              }
            }
            container.addEventListener('pointerdown', onCameraPointerDown, true)
            if (view3dRef.current) {
              cameraRef.current.on = true
              applyCamera()
            }

            cleanup = () => {
              try {
                liveSim.stop()
              } catch {
                /* ignore */
              }
              try {
                clearInterval(breatheTimer)
              } catch {
                /* ignore */
              }
              if (typeof window !== 'undefined') {
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerUp)
              }
              layoutRef.current = null
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
      const camera = cameraRef.current
      camera.on = view3d
      if (view3d) {
        camera.pitch = 0.52
        camera.yaw = -0.28
      } else {
        camera.pitch = 0
        camera.yaw = 0
      }
      try {
        if (applyCameraRef.current) applyCameraRef.current()
        if (rendererRef.current) rendererRef.current.refresh()
      } catch {
        /* ignore */
      }
    }, [view3d])

    React.useEffect(() => {
      try { rendererRef.current && rendererRef.current.refresh() } catch { /* ignore */ }
    }, [selected, hovered, query])

    const resetView = () => {
      if (view3dRef.current) {
        cameraRef.current.pitch = 0.52
        cameraRef.current.yaw = -0.28
        try { if (applyCameraRef.current) applyCameraRef.current() } catch { /* ignore */ }
        return
      }
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

    const focusNodeName = (name) => {
      const renderer = rendererRef.current
      if (!renderer || !name) return
      try {
        const sigmaGraph = renderer.getGraph()
        sigmaGraph.forEachNode((node, attributes) => {
          if (attributes && attributes.__node && attributes.__node.name === name) {
            renderer.getCamera().animate(
              { x: attributes.x, y: attributes.y, ratio: 0.5 },
              { duration: 450 },
            )
            setSelected(name)
          }
        })
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

    const nodeTypeByName = new Map(nodes.map((node) => [node.name, node.type || 'concept']))
    const degreeMap = new Map()
    const relationCounts = new Map()
    const confidenceWeight = { high: 3, medium: 2, low: 1 }
    for (const edge of edges) {
      degreeMap.set(edge.from, (degreeMap.get(edge.from) || 0) + 1)
      degreeMap.set(edge.to, (degreeMap.get(edge.to) || 0) + 1)
      relationCounts.set(edge.relation, (relationCounts.get(edge.relation) || 0) + 1)
    }
    const coreNodes = [...degreeMap.entries()]
      .map(([name, degree]) => ({ name, degree, type: nodeTypeByName.get(name) || 'concept' }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 5)
    const surprising = edges
      .filter((edge) => nodeTypeByName.get(edge.from) !== nodeTypeByName.get(edge.to))
      .map((edge) => {
        const rarity = 1 / Math.max(1, relationCounts.get(edge.relation) || 1)
        const score = (confidenceWeight[edge.confidence] || 1) * 2 + rarity * 3
        const fromType = nodeTypeByName.get(edge.from) || 'concept'
        const toType = nodeTypeByName.get(edge.to) || 'concept'
        return {
          edge,
          score,
          why: (TYPE_LABEL[fromType] || fromType) + ' × ' + (TYPE_LABEL[toType] || toType) + (edge.note ? '：' + String(edge.note).slice(0, 42) : ''),
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)

    const relationLabelOf = (relation) => REL_LABEL[relation] || '相关'
    const questions = []
    if (surprising.length > 0) {
      const top = surprising[0]
      questions.push('「' + top.edge.from + '」为什么会' + relationLabelOf(top.edge.relation) + '「' + top.edge.to + '」？')
    }
    if (surprising.length > 1) {
      const second = surprising[1]
      questions.push('「' + second.edge.from + '」和「' + second.edge.to + '」之间的这条线，是读到的还是推出来的？')
    }
    if (coreNodes.length > 0) {
      questions.push('「' + coreNodes[0].name + '」把这些线串起来，它是原因、结果，还是只是最常被提到？')
    }

    const exportObservation = () => {
      try {
        const now = new Date().toLocaleString('zh-CN', { hour12: false })
        const typeLines = Object.entries(typeCounts).map(([type, count]) => '- ' + (TYPE_LABEL[type] || type) + '：' + count + ' 个')
        const coreLines = coreNodes.map((item) => '- ' + item.name + '（' + (TYPE_LABEL[item.type] || item.type) + '，' + item.degree + ' 条关系）')
        const surpriseLines = surprising.map((item) => '- ' + item.edge.from + ' — ' + item.edge.to + '：' + item.why)
        const text = [
          '# 小鲸鱼的认知图谱观察',
          '',
          '> 生成时间：' + now + '；节点 ' + nodes.length + ' 个，关系 ' + edges.length + ' 条，判断 ' + (data && data.claims ? data.claims.length : 0) + ' 条。',
          '',
          '## 类型分布',
          '',
          ...typeLines,
          '',
          '## 核心节点（按连接度）',
          '',
          ...coreLines,
          '',
          '## 意外连接（跨类型，按置信度/稀有度）',
          '',
          ...(surpriseLines.length > 0 ? surpriseLines : ['- 暂无跨类型连接']),
          '',
          '## 可以追问',
          '',
          ...questions.map((question) => '- ' + question),
          '',
        ].join('\n')
        if (typeof window === 'undefined' || typeof document === 'undefined') return
        const blob = new window.Blob([text], { type: 'text/markdown;charset=utf-8' })
        const href = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = href
        link.download = 'whale-graph-observation.md'
        link.click()
        window.URL.revokeObjectURL(href)
      } catch {
        /* ignore */
      }
    }

    const insightCards = nodes.length > 0
      ? h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 } },
        h(
          'div',
          { style: { padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)' } },
          h('div', { style: { fontSize: 11, opacity: 0.6, marginBottom: 5, letterSpacing: 1 } }, '核心节点'),
          ...coreNodes.map((item) => h(
            'button',
            {
              key: 'core-' + item.name,
              type: 'button',
              onClick: () => focusNodeName(item.name),
              title: '定位到「' + item.name + '」',
              style: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '3px 0', background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left', fontSize: 12 },
            },
            h('span', { style: { width: 7, height: 7, borderRadius: 4, background: TYPE_COLOR[item.type] || '#8aa2b4', flex: '0 0 auto' } }),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
            h('span', { style: { opacity: 0.45, fontSize: 11 } }, item.degree + ' 条'),
          )),
        ),
        h(
          'div',
          { style: { padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)' } },
          h('div', { style: { fontSize: 11, opacity: 0.6, marginBottom: 5, letterSpacing: 1 } }, '意外连接'),
          surprising.length > 0
            ? surprising.map((item, index) => h(
              'button',
              {
                key: 'surprising-' + index,
                type: 'button',
                onClick: () => focusNodeName(item.edge.from),
                title: '定位到这组连接',
                style: { display: 'block', width: '100%', padding: '3px 0', background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left', fontSize: 12, lineHeight: 1.45 },
              },
              h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.edge.from + ' — ' + item.edge.to),
              h('div', { style: { opacity: 0.5, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.why),
            ))
            : h('div', { style: { fontSize: 12, opacity: 0.5 } }, '暂时没有跨类型连接'),
        ),
        h(
          'div',
          { style: { padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)' } },
          h('div', { style: { fontSize: 11, opacity: 0.6, marginBottom: 5, letterSpacing: 1 } }, '可以追问'),
          ...questions.map((question, index) => h(
            'div',
            { key: 'question-' + index, style: { fontSize: 12, lineHeight: 1.5, padding: '3px 0', opacity: 0.85 } },
            question,
          )),
        ),
      )
      : null

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
              h('span', { style: { fontSize: 10, opacity: 0.5 } }, (Array.isArray(edge.sources) && edge.sources.length > 0 ? '读到' : '推断')),
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
      h('span', { style: { opacity: 0.7 } }, '线：'),
      ...Object.entries(PROVENANCE_LABEL).map(([provenance, label]) => h(
        'span',
        { key: 'legend-prov-' + provenance, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { width: 14, height: 2, background: PROVENANCE_COLOR[provenance], borderRadius: 1 } }),
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
                background: 'linear-gradient(180deg, rgba(13,19,27,0.96), rgba(8,12,18,0.96)), radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
                backgroundSize: 'auto, 22px 22px',
                border: '1px solid rgba(140,180,210,0.16)',
              },
            },
            hoverTooltip,
          ),
          h('div', { style: { position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 4 } },
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '放大', onClick: () => zoomBy(1.4) }, '+'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '缩小', onClick: () => zoomBy(0.7) }, '−'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '复位', onClick: resetView }, '复位'),
            h('button', {
              type: 'button',
              className: 'dshp-btn dshp-btn-small',
              title: '3D 视角：拖动画布旋转相机，滚动缩放',
              style: view3d ? { borderColor: 'rgba(150,200,240,0.55)' } : undefined,
              onClick: () => setView3d((value) => !value),
            }, view3d ? '3D 中' : '3D'),
            h('button', {
              type: 'button',
              className: 'dshp-btn dshp-btn-small',
              title: '旋转模式：打开后直接拖动空白处旋转',
              style: rotateMode ? { borderColor: 'rgba(255,233,184,0.55)' } : undefined,
              onClick: () => setRotateMode((value) => !value),
            }, rotateMode ? '旋转中' : '旋转'),
            h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', title: '重新排布', onClick: () => { try { layoutRef.current && layoutRef.current.alpha(0.35).restart() } catch { /* ignore */ } } }, '重排')),
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
        h('strong', { style: { fontSize: 15, letterSpacing: 1.5 } }, '认知图谱'),
        h('span', { style: { opacity: 0.75 } }, stats.nodes + ' 节点 · ' + stats.edges + ' 关系 · ' + (data && data.claims ? data.claims.length : 0) + ' 判断'),
        h('span', { style: { opacity: 0.5, marginLeft: 'auto' } }, lastText)),
      body,
      insightCards,
      legend,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, opacity: 0.55 } },
        h('span', null, '动态布局 · 可拖动节点 · 3D 视角下拖动画布转视角 · Shift+拖动旋转 · 滚轮缩放' + (stats.big ? ' · 超大图已用简化布局' : '')),
        h('span', null, data && data.updatedAt ? '更新：' + new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '')),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
        h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: exportObservation }, '导出观察报告'),
        h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setReloadKey((n) => n + 1) }, '重新载入')))
  }
  return GraphTab
}
