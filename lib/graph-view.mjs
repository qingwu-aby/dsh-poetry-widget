// lib/graph-view.mjs —— 认知图谱的可视化页面（v2.93）
// 单文件 SVG 力导向图：只读 /api/dsh-poetry/graph.json，不依赖外部库。
export function graphViewHtml(options = {}) {
  const title = String(options.title ?? '小鲸鱼的认知图谱')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1720; color: #dbe6f0; font: 14px/1.5 -apple-system, "PingFang SC", sans-serif; }
  header { padding: 14px 20px; border-bottom: 1px solid #22303d; display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .muted { color: #7f93a6; font-size: 12px; }
  #wrap { display: flex; height: calc(100vh - 56px); }
  #stage { flex: 1; position: relative; }
  svg { width: 100%; height: 100%; display: block; cursor: grab; }
  #panel { width: 300px; border-left: 1px solid #22303d; padding: 16px; overflow: auto; }
  #panel h2 { font-size: 14px; margin: 0 0 8px; }
  #panel .item { border: 1px solid #22303d; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
  #panel .item:hover { border-color: #3d5568; }
  .tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid #33475a; color: #9fb6c9; margin-right: 6px; }
  #detail { margin-top: 14px; border-top: 1px solid #22303d; padding-top: 12px; }
  #detail .row { margin-bottom: 8px; }
  #detail .label { color: #7f93a6; font-size: 12px; }
  #legend { position: absolute; left: 14px; bottom: 14px; font-size: 12px; color: #7f93a6; }
  #legend span { margin-right: 10px; }
</style></head>
<body>
<header><h1>${title}</h1><span class="muted" id="stats">加载中…</span></header>
<div id="wrap"><div id="stage"><svg id="svg"><g id="viewport"></g></svg>
<div id="legend"></div></div>
<div id="panel"><h2>节点</h2><div id="list"></div><div id="detail"></div></div></div>
<script>
const TYPE_COLOR = { person: '#e0a458', institution: '#5fb3d4', event: '#d46a6a', place: '#7fcb8f', concept: '#a78bfa', work: '#d4a5e0' };
const REL_LABEL = { causal: '导致', temporal: '先后于', contrast: '对照', part_of: '属于', example_of: '例如' };
let graph = { nodes: [], edges: [], claims: [] };
const svg = document.getElementById('svg');
const g = document.getElementById('viewport');
const W = () => svg.clientWidth || 900;
const H = () => svg.clientHeight || 600;
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs) { const node = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v); return node; }
function render() {
  g.innerHTML = '';
  const nodes = graph.nodes.filter((n) => n.name);
  if (nodes.length === 0) { document.getElementById('stats').textContent = '图谱还是空的：等抽取跑完再来'; return; }
  const ids = new Map(nodes.map((n, i) => [n.name, i]));
  const links = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const pos = nodes.map((n) => ({ x: W() / 2 + (Math.random() - 0.5) * W() * 0.7, y: H() / 2 + (Math.random() - 0.5) * H() * 0.7, vx: 0, vy: 0, node: n }));
  for (let step = 0; step < 260; step += 1) {
    for (let i = 0; i < pos.length; i += 1) for (let j = i + 1; j < pos.length; j += 1) {
      const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y; const d2 = dx * dx + dy * dy + 0.01; const d = Math.sqrt(d2);
      const force = 2200 / d2; pos[i].vx -= (dx / d) * force; pos[i].vy -= (dy / d) * force; pos[j].vx += (dx / d) * force; pos[j].vy += (dy / d) * force;
    }
    for (const link of links) {
      const a = pos[ids.get(link.from)], b = pos[ids.get(link.to)]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = (d - 130) * 0.02; a.vx += (dx / d) * force; a.vy += (dy / d) * force; b.vx -= (dx / d) * force; b.vy -= (dy / d) * force;
    }
    for (const p of pos) { p.vx += (W() / 2 - p.x) * 0.001; p.vy += (H() / 2 - p.y) * 0.001; p.vx *= 0.85; p.vy *= 0.85; p.x += p.vx; p.y += p.vy; }
  }
  for (const link of links) {
    const a = pos[ids.get(link.from)], b = pos[ids.get(link.to)];
    const line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#33475a', 'stroke-width': 1 });
    line.addEventListener('mouseenter', () => { line.setAttribute('stroke', '#7fb2d4'); showEdge(link); });
    line.addEventListener('mouseleave', () => { line.setAttribute('stroke', '#33475a'); });
    g.appendChild(line);
  }
  for (const p of pos) {
    const node = p.node;
    const circle = el('circle', { cx: p.x, cy: p.y, r: 7, fill: TYPE_COLOR[node.type] || '#8aa2b4', stroke: '#0f1720', 'stroke-width': 2, style: 'cursor:pointer' });
    circle.addEventListener('click', () => showNode(node));
    circle.addEventListener('mouseenter', () => showNode(node));
    g.appendChild(circle);
    const text = el('text', { x: p.x + 10, y: p.y + 4, fill: '#9fb6c9', 'font-size': 11 });
    text.textContent = node.name;
    g.appendChild(text);
  }
  document.getElementById('stats').textContent = nodes.length + ' 节点 / ' + graph.edges.length + ' 关系 / ' + graph.claims.length + ' 判断';
  const list = document.getElementById('list'); list.innerHTML = '';
  for (const node of nodes.slice(0, 200)) {
    const item = document.createElement('div'); item.className = 'item';
    item.innerHTML = '<span class="tag" style="color:' + (TYPE_COLOR[node.type] || '#8aa2b4') + '">' + (node.type || 'concept') + '</span>' + node.name;
    item.addEventListener('click', () => showNode(node));
    list.appendChild(item);
  }
}
function showNode(node) {
  const detail = document.getElementById('detail');
  const rels = graph.edges.filter((e) => e.from === node.name || e.to === node.name).map((e) => {
    const other = e.from === node.name ? e.to : e.from;
    return (e.from === node.name ? (REL_LABEL[e.relation] || '关联') + ' ' + other : other + ' ' + (REL_LABEL[e.relation] || '关联') + ' ' + (e.from === node.name ? node.name : e.from)) + ' [' + e.confidence + ']';
  });
  const claims = graph.claims.filter((c) => (c.nodes || []).includes(node.name)).map((c) => c.text + ' [' + c.confidence + ']');
  detail.innerHTML = '<div class="row"><div class="label">节点</div><strong>' + node.name + '</strong></div>' +
    '<div class="row"><div class="label">类型 / 摘要</div>' + (node.type || '') + ' · ' + (node.summary || '（无摘要）') + '</div>' +
    (rels.length ? '<div class="row"><div class="label">关系</div>' + rels.join('<br>') + '</div>' : '') +
    (claims.length ? '<div class="row"><div class="label">判断</div>' + claims.join('<br>') + '</div>' : '');
}
function showEdge(edge) {
  document.getElementById('detail').innerHTML = '<div class="row"><div class="label">关系</div>' + edge.from + ' ' + (REL_LABEL[edge.relation] || '关联') + ' ' + edge.to + '</div>' +
    (edge.note ? '<div class="row"><div class="label">说明</div>' + edge.note + '</div>' : '') + '<div class="row"><div class="label">置信度</div>' + (edge.confidence || '') + '</div>';
}
fetch('/api/dsh-poetry/graph.json', { cache: 'no-store' }).then((r) => r.json()).then((data) => {
  const source = data || {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const kept = nodes.length > 300 ? nodes.slice(-300) : nodes;
  const names = new Set(kept.map((n) => n.name));
  graph = { ...source, nodes: kept, edges: (Array.isArray(source.edges) ? source.edges : []).filter((e) => names.has(e.from) && names.has(e.to)).slice(-600), claims: (Array.isArray(source.claims) ? source.claims : []).slice(-200) };
  render();
}).catch((error) => { document.getElementById('stats').textContent = '加载失败：' + error; });
window.addEventListener('resize', () => render());
</script></body></html>`
}
