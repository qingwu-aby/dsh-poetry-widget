// client-src/tabs-poetry.js —— 诗词面板的基础 tab（v1.85 从 client.js 抽出）。
//
// 这些组件只负责视图；共享 UI 基础组件与 describeDataError 由 client 在运行时注入，
// 因此模块不依赖 client 的闭包，也不需要 React 打包（React/h 由 ctx 传入）。
export function createPoetryTabs(ctx = {}) {
  const React = ctx.React
  const h = ctx.h
  const EmptyState = ctx.EmptyState
  const LoadingState = ctx.LoadingState
  const PoemBody = ctx.PoemBody
  const AnalysisBody = ctx.AnalysisBody
  const KnowledgeCardView = ctx.KnowledgeCardView
  const describeDataError = ctx.describeDataError
  const normalizeSettings = ctx.normalizeSettings
  const cx = ctx.cx
  const switchNode = ctx.switchNode
  const num = ctx.num

function TodayTab(props) {
const api = props.api || {}
const poem = api.poem
if (!poem) {
 if (api.boot && api.boot.status === 'error') {
  return h(EmptyState, {
  title: '诗词数据尚未就绪',
  message: describeDataError(api.boot.error),
  onRetry: api.retryBootstrap,
  })
 }
 if (api.poemsRes && api.poemsRes.status === 'error') {
  return h(EmptyState, {
  title: '今日一诗暂时不可用',
  message: describeDataError(api.poemsRes.error),
  onRetry: () => api.reloadPoems && api.reloadPoems().catch(() => {}),
  })
 }
 return h(LoadingState, { text: '正在载入今日一诗…' })
}
const items = Array.isArray(api.poemItems) ? api.poemItems : []
const index = items.findIndex((item) => item && item.id === poem.id)
const total = items.length
return h(
 'div',
 null,
 api.weatherChip || api.moodChip
  ? h(
  'div',
  { className: 'dshp-weather', style: { marginTop: 0 } },
  h(
   'div',
   { className: 'dshp-chip-row' },
   api.weatherChip ? h('span', { className: 'dshp-weather-chip' }, String(api.weatherChip)) : null,
   api.moodChip ? h('span', { className: 'dshp-weather-chip dshp-mood-chip', title: api.moodChipTitle || '' }, String(api.moodChip)) : null,
  ),
  api.weatherNote ? h('div', { className: 'dshp-weather-note' }, String(api.weatherNote)) : null,
  )
  : null,
 h(
  'div',
  { className: 'dshp-pager', style: { marginTop: 0 } },
  h('span', { className: 'dshp-pager-label' }, (api.weatherActive ? '天气推荐' : (api.settings.mode === 'random' ? '随机' : '每日')) + ' · 第 ' + Math.max(1, index + 1) + (total ? ' / ' + total : '') + ' 首'),
  h(
  'span',
  { className: 'dshp-field-control' },
  h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: api.changePoem }, '换一首'),
  poem.id !== api.todayPoemId
   ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: api.backToToday }, '回到今日')
   : null,
  ),
 ),
 h(PoemBody, { poem, script: api.settings.script, showTones: api.settings.showTones }),
 h('div', { className: 'dshp-subtitle' }, '格律解析'),
 h(AnalysisBody, { poem }),
)
}

function ClassTab(props) {
const api = props.api || {}
const [index, setIndex] = React.useState(0)
const resource = api.knowledgeRes || {}
if (resource.status === 'error') {
 return h(EmptyState, {
  title: '格律课堂暂时不可用',
  message: describeDataError(resource.error),
  onRetry: () => api.reloadKnowledge && api.reloadKnowledge().catch(() => {}),
 })
}
const cards = resource.data && Array.isArray(resource.data.cards) ? resource.data.cards : []
if (!cards.length) {
 if (resource.status === 'ready') {
  return h(EmptyState, { title: '暂无知识卡', message: '课堂内容还在准备中，请稍后再来。' })
 }
 return h(LoadingState, { text: '正在载入格律课堂…' })
}
const safeIndex = Math.min(Math.max(0, index), cards.length - 1)
const card = cards[safeIndex]
return h(
 'div',
 null,
 h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '格律小课堂 · 共 ' + cards.length + ' 张卡'),
 h(KnowledgeCardView, { card }),
 h(
  'div',
  { className: 'dshp-pager' },
  h('button', {
  type: 'button',
  className: 'dshp-btn dshp-btn-small',
  disabled: safeIndex <= 0,
  onClick: () => setIndex(safeIndex - 1),
  }, '上一张'),
  h('span', { className: 'dshp-pager-label' }, '第 ' + (safeIndex + 1) + ' / ' + cards.length + ' 张'),
  h('button', {
  type: 'button',
  className: 'dshp-btn dshp-btn-small',
  disabled: safeIndex >= cards.length - 1,
  onClick: () => setIndex(safeIndex + 1),
  }, '下一张'),
 ),
 h(
  'div',
  { className: 'dshp-tags', style: { marginTop: '10px' } },
  cards.map((item, cardIndex) => h('button', {
  key: (item && item.id) || cardIndex,
  type: 'button',
  className: 'dshp-tag',
  style: {
   cursor: 'pointer',
   borderColor: cardIndex === safeIndex ? 'var(--dshp-accent)' : undefined,
   color: cardIndex === safeIndex ? 'var(--dshp-accent)' : undefined,
  },
  onClick: () => setIndex(cardIndex),
  }, (cardIndex + 1) + '. ' + String((item && item.title) || '卡片'))),
 ),
)
}

function YunTab(props) {
const api = props.api || {}
const [expanded, setExpanded] = React.useState(null)
const resource = api.yunRes || {}
if (resource.status === 'error') {
 return h(EmptyState, {
  title: '韵部数据暂时不可用',
  message: describeDataError(resource.error),
  onRetry: () => api.reloadYun && api.reloadYun().catch(() => {}),
 })
}
const volumes = resource.data && Array.isArray(resource.data.volumes) ? resource.data.volumes : []
if (!volumes.length) {
 if (resource.status === 'ready') {
  return h(EmptyState, { title: '暂无韵部数据', message: '声律启蒙数据还不完整，请稍后再来。' })
 }
 return h(LoadingState, { text: '正在载入声律启蒙…' })
}
return h(
 'div',
 null,
 h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '声律启蒙 · 平声三十韵部（上卷 15 / 下卷 15）'),
 volumes.map((volume, volumeIndex) => {
  const chapters = volume && Array.isArray(volume.chapters) ? volume.chapters : []
  return h(
  'div',
  { key: 'volume-' + volumeIndex },
  h('div', { className: 'dshp-subtitle' }, String(volume.title || '')),
  chapters.map((chapter, chapterIndex) => {
   const key = volumeIndex + '-' + chapterIndex
   const open = expanded === key
   const chars = Array.isArray(chapter.exampleChars) ? chapter.exampleChars : []
   return h(
    'div',
    { key },
    h(
    'button',
    {
     type: 'button',
     className: cx('dshp-row', open && 'dshp-is-open'),
     onClick: () => setExpanded(open ? null : key),
     'aria-expanded': open,
    },
    h(
     'span',
     { className: 'dshp-row-main' },
     h('span', { className: 'dshp-row-title' }, String(chapter.name || '')),
     chars.length ? h('span', { className: 'dshp-row-sub' }, ' 例字：' + chars.join('、')) : null,
    ),
    h('span', { className: 'dshp-muted', style: { flex: 'none' } }, open ? '▾' : '▸'),
    ),
    open
    ? h(
     'div',
     { className: 'dshp-row-body' },
     (Array.isArray(chapter.paragraphs) ? chapter.paragraphs : []).map((paragraph, index) => h('p', { key: index, className: 'dshp-p' }, String(paragraph == null ? '' : paragraph))),
     chapter.exampleLine
      ? h('div', { className: 'dshp-example', style: { marginTop: '6px' } }, h('div', { className: 'dshp-example-text' }, String(chapter.exampleLine)))
      : null,
    )
    : null,
   )
  }),
  )
 }),
)
}

function CiTab(props) {
const api = props.api || {}
const [subTab, setSubTab] = React.useState('poems')
const [query, setQuery] = React.useState('')
const [rhythmic, setRhythmic] = React.useState('')
const [visible, setVisible] = React.useState(40)
const [openId, setOpenId] = React.useState(null)
const knowledge = api.knowledgeRes || {}
const ciRes = api.ciRes || {}
const ciCards = knowledge.data && Array.isArray(knowledge.data.ciCards) ? knowledge.data.ciCards : []
const items = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : []
const ciBankCounts = React.useMemo(() => {
 const map = {}
 const bankItems = api.ciBankRes && api.ciBankRes.data && Array.isArray(api.ciBankRes.data.items) ? api.ciBankRes.data.items : []
 for (const item of bankItems) {
  if (item && item.rhythmic) map[item.rhythmic] = (map[item.rhythmic] || 0) + 1
 }
 return map
}, [api.ciBankRes])
const ciSelectedCounts = React.useMemo(() => {
 const map = {}
 for (const item of items) {
  if (item && item.rhythmic) map[item.rhythmic] = (map[item.rhythmic] || 0) + 1
 }
 return map
}, [items])
const rhythms = React.useMemo(() => {
 const seen = {}
 items.forEach((item) => {
  if (item && item.rhythmic) seen[item.rhythmic] = true
 })
 return Object.keys(seen).sort((a, b) => a.localeCompare(b, 'zh'))
}, [items])
const filtered = React.useMemo(() => {
 const keyword = query.trim()
 return items.filter((item) => {
  if (!item) return false
  if (rhythmic && item.rhythmic !== rhythmic) return false
  if (!keyword) return true
  const haystack = [item.title, item.author, item.rhythmic, item.quote]
  .concat(Array.isArray(item.lines) ? item.lines : [])
  .join(' ')
  return haystack.indexOf(keyword) >= 0
 })
}, [items, query, rhythmic])
React.useEffect(() => {
 setVisible(40)
}, [query, rhythmic])

if (knowledge.status === 'error') {
 return h(EmptyState, {
  title: '词牌数据暂时不可用',
  message: describeDataError(knowledge.error),
  onRetry: () => api.reloadKnowledge && api.reloadKnowledge().catch(() => {}),
 })
}

function renderCards() {
 if (!ciCards.length) {
  if (knowledge.status === 'ready') return h(EmptyState, { title: '暂无词牌卡', message: '词牌内容还在准备中，请稍后再来。' })
  return h(LoadingState, { text: '正在载入词牌卡…' })
 }
 return h(
  'div',
  { className: 'dshp-list' },
  ciCards.map((card, index) => h(
  'div',
  { key: (card && card.id) || index, className: 'dshp-card', style: { padding: '8px 2px', borderBottom: '1px solid var(--dshp-border)' } },
  h(
   'div',
   { className: 'dshp-card-title', style: { fontSize: '14px' } },
   String((card && card.name) || '词牌'),
   card && Array.isArray(card.aliases) && card.aliases.length
    ? h('span', { className: 'dshp-muted', style: { fontSize: '11.5px', fontWeight: 400 } }, '（' + card.aliases.join('、') + '）')
    : null,
  ),
  card && card.form ? h('div', { className: 'dshp-card-summary' }, String(card.form) + (card.rhyme ? ' · ' + String(card.rhyme) : '')) : null,
  card && card.note ? h('p', { className: 'dshp-p' }, String(card.note)) : null,
  card && card.example
   ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-text' }, String(card.example)))
   : null,
  card && card.name
   ? h('div', { className: 'dshp-fh-actions' },
    h('button', {
     type: 'button',
     className: 'dshp-link',
     onClick: () => { if (api.openCiSelectedForRhythmic) api.openCiSelectedForRhythmic(card.name) },
    }, '同词牌精选' + (ciSelectedCounts[card.name] ? '（' + ciSelectedCounts[card.name] + ' 首）' : '')),
    h('button', {
     type: 'button',
     className: 'dshp-link dshp-muted',
     onClick: () => { if (api.openCiBankForRhythmic) api.openCiBankForRhythmic(card.name) },
    }, '全库' + (ciBankCounts[card.name] ? '（' + ciBankCounts[card.name] + ' 首）' : '同词牌')))
   : null,
  )),
 )
}

function renderPoems() {
 if (ciRes.status === 'error') {
  return h(EmptyState, {
  title: '名篇词暂时不可用',
  message: describeDataError(ciRes.error),
  onRetry: () => api.reloadCi && api.reloadCi().catch(() => {}),
  })
 }
 if (!items.length) {
  if (ciRes.status === 'ready') return h(EmptyState, { title: '暂无词作', message: '名篇词数据正在准备中。' })
  return h(LoadingState, { text: '正在载入名篇词…' })
 }
 const shown = filtered.slice(0, visible)
 return h(
  'div',
  null,
  h(
  'div',
  { className: 'dshp-search' },
  h('input', {
   className: 'dshp-input',
   type: 'search',
   value: query,
   placeholder: '搜索词牌 / 作者 / 词句',
   'aria-label': '搜索名篇词',
   onChange: (event) => setQuery(event.target.value),
  }),
  h(
   'select',
   {
    className: 'dshp-select',
    value: rhythmic,
    'aria-label': '按词牌筛选',
    onChange: (event) => setRhythmic(event.target.value),
   },
   h('option', { value: '' }, '全部词牌'),
   rhythms.map((name) => h('option', { key: name, value: name }, name)),
  ),
  ),
  h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '共 ' + filtered.length + ' 首（总计 ' + items.length + ' 首）'),
  h(
  'div',
  { className: 'dshp-list' },
  shown.map((ci, index) => {
   const ciId = ci.id || 'ci-' + index
   const open = openId === ciId
   return h(
    'div',
    { key: ciId },
    h(
    'button',
    {
     type: 'button',
     className: cx('dshp-row', open && 'dshp-is-open'),
     onClick: () => setOpenId(open ? null : ciId),
     'aria-expanded': open,
    },
    h(
     'span',
     { className: 'dshp-row-main' },
     h('span', { className: 'dshp-row-title' }, String(ci.title || ci.rhythmic || '无题')),
     h('span', { className: 'dshp-row-sub' }, String(ci.author || '') + (ci.rhythmic ? ' · ' + String(ci.rhythmic) : '')),
    ),
    h('span', { className: 'dshp-muted', style: { flex: 'none' } }, open ? '▾' : '▸'),
    ),
    open
    ? h(
     'div',
     { className: 'dshp-row-body' },
     h('div', { className: 'dshp-ci-lines' }, (Array.isArray(ci.lines) ? ci.lines : []).map((line, lineIndex) => h('div', { key: lineIndex }, String(line)))),
     ci.quote ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-text' }, String(ci.quote))) : null,
    ci.rhythmic
     ? h('div', { className: 'dshp-fh-actions' },
      h('button', {
       type: 'button',
       className: 'dshp-link',
       onClick: () => { if (api.openCiSelectedForRhythmic) api.openCiSelectedForRhythmic(ci.rhythmic) },
      }, '同词牌精选' + (ciSelectedCounts[ci.rhythmic] ? '（' + ciSelectedCounts[ci.rhythmic] + ' 首）' : '')),
      h('button', {
       type: 'button',
       className: 'dshp-link dshp-muted',
       onClick: () => { if (api.openCiBankForRhythmic) api.openCiBankForRhythmic(ci.rhythmic) },
      }, '全库' + (ciBankCounts[ci.rhythmic] ? '（' + ciBankCounts[ci.rhythmic] + ' 首）' : '同词牌')))
     : null,
    )
    : null,
   )
  }),
  ),
  filtered.length > visible
  ? h(
   'div',
   { style: { textAlign: 'center', marginTop: '10px' } },
   h('button', {
    type: 'button',
    className: 'dshp-btn',
    onClick: () => setVisible(visible + 60),
   }, '加载更多（剩余 ' + (filtered.length - visible) + ' 首）'),
  )
  : null,
 )
}

return h(
 'div',
 null,
 h(
  'div',
  { className: 'dshp-seg', style: { marginBottom: '10px' } },
  h('button', {
  type: 'button',
  className: cx('dshp-seg-btn', subTab === 'poems' && 'dshp-is-active'),
  onClick: () => setSubTab('poems'),
  }, '名篇词'),
  h('button', {
  type: 'button',
  className: cx('dshp-seg-btn', subTab === 'cards' && 'dshp-is-active'),
  onClick: () => setSubTab('cards'),
  }, '词牌卡'),
 ),
 subTab === 'cards' ? renderCards() : renderPoems(),
)
}

/** 诗词二级菜单里的设置（v1.76：从主设置降权搬来）。 */
function PoetrySettingsTab(props) {
const api = props.api || {}
const settings = (api.settings && typeof api.settings === 'object') ? api.settings : normalizeSettings()
const update = api.updateSettings || (() => {})
const seg = (options, current, onPick) => h(
 'div',
 { className: 'dshp-seg' },
 options.map((option) => h('button', {
  key: String(option.value),
  type: 'button',
  className: cx('dshp-seg-btn', current === option.value && 'dshp-is-active'),
  onClick: () => onPick(option.value),
 }, option.label)),
)
return h(
 'div',
 { className: 'dshp-settings' },
 h('div', { className: 'dshp-field' }, h('div', { className: 'dshp-field-label' }, h('b', null, '诗词设置'), h('small', null, '二级菜单里的配置；主设置只留成长/外观'))),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '平仄标注'), h('small', null, '平蓝 / 仄红 / 多音灰')),
  switchNode(settings.showTones, () => update({ showTones: !settings.showTones }), '平仄标注开关'),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '点诗模式'), h('small', null, '「换一首」的策略')),
  seg([
   { value: 'daily', label: '每日' },
   { value: 'random', label: '随机' },
  ], settings.mode, (value) => update({ mode: value })),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '自动轮播'), h('small', null, '气泡自动推进间隔')),
  h(
   'select',
   {
    className: 'dshp-select',
    value: String(settings.autoplay),
    'aria-label': '自动轮播间隔',
    onChange: (event) => update({ autoplay: num(event.target.value, 0) }),
   },
   h('option', { value: '0' }, '关闭'),
   h('option', { value: '30' }, '30 秒'),
   h('option', { value: '60' }, '1 分钟'),
   h('option', { value: '300' }, '5 分钟'),
  ),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '显示文字'), h('small', null, '简体或诗词原文')),
  seg([
   { value: 'simplified', label: '简体' },
   { value: 'original', label: '原文' },
  ], settings.script, (value) => update({ script: value })),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '按天气选诗'), h('small', null, '今日诗与形象跟随天气')),
  switchNode(settings.weatherPoem, () => update({ weatherPoem: !settings.weatherPoem }), '按天气选诗开关'),
 ),
 h('div', { className: 'dshp-muted', style: { fontSize: '11.5px', lineHeight: 1.6 } }, '诗词是二级菜单：从「成长」页底部的入口进入；大小/吸附/自言自语/隐藏仍在主设置。'),
)
}

  return { TodayTab, ClassTab, YunTab, CiTab, PoetrySettingsTab }
}
