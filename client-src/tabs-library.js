// client-src/tabs-library.js —— 诗库面板（v2.4 从 client.js 抽出）。
//
// 数据合并/筛选/分页逻辑在 library.js；这里只保留视图。共享组件与检测函数由 client 注入。
import {
  LIBRARY_PAGE,
  buildLibraryItems,
  ciBankRhythmics,
  ciSelectedLibraryItems,
  ciSelectedRhythmics,
  filterLibraryItems,
  libraryItemLabel,
  libraryPage,
} from './library.js'
import { num } from './base.js'

export function createLibraryTab(ctx = {}) {
  const LIBRARY_CATEGORIES = ctx.LIBRARY_CATEGORIES
  const React = ctx.React
  const h = ctx.h
  const cx = ctx.cx
  const EmptyState = ctx.EmptyState
  const LoadingState = ctx.LoadingState
  const DetectionView = ctx.DetectionView
  const ToneLine = ctx.ToneLine
  const describeDataError = ctx.describeDataError
  const Z_INDEX = ctx.Z_INDEX
  const WIDGET_ID = ctx.WIDGET_ID
  const MASCOT_FILES = ctx.MASCOT_FILES
  const mascotUrl = ctx.mascotUrl
  const detectPoem = ctx.detectPoem
  const detectPoemText = ctx.detectPoemText
  const parsePoemInput = ctx.parsePoemInput
  const buildPingshuiIndex = ctx.buildPingshuiIndex

function LibraryTab(props) {
 const api = props.api || {}
 const anthologyRes = api.anthologyRes || {}
 const bankRes = api.bankRes || {}
 const pingshuiRes = api.pingshuiRes || {}
 const ciBankRes = api.ciBankRes || {}
 const ciRes = api.ciRes || {}
 const [category, setCategory] = React.useState('all')
 const [ciRhythmic, setCiRhythmic] = React.useState('')
 const [searchScope, setSearchScope] = React.useState('category')
 const [ciSearchScope, setCiSearchScope] = React.useState('selected')
 const [query, setQuery] = React.useState('')
 const [debounced, setDebounced] = React.useState('')
 const [visible, setVisible] = React.useState(LIBRARY_PAGE)
 const [detail, setDetail] = React.useState(null)
 const [detector, setDetector] = React.useState('')
 const [inputText, setInputText] = React.useState('')
 const [inputReport, setInputReport] = React.useState(null)
 const ciMode = category === 'ci-selected' || category === 'ci-bank'

 React.useEffect(() => {
  const timer = setTimeout(() => setDebounced(query), 300)
  return () => clearTimeout(timer)
 }, [query])
 React.useEffect(() => {
  setVisible(LIBRARY_PAGE)
 }, [category, debounced, ciRhythmic, ciSearchScope])
 React.useEffect(() => {
  if (category === 'ci-bank' || (ciMode && ciSearchScope === 'allCi')) {
   if (typeof api.requestCiBank === 'function') api.requestCiBank()
  }
 }, [category, ciMode, ciSearchScope, api.requestCiBank])
 React.useEffect(() => {
  const focus = api.libraryFocus
  if (!focus || !focus.token) return
  if (focus.type === 'ci') {
   setCategory('ci-bank')
   setCiRhythmic(String(focus.rhythmic || ''))
   setDetector('')
   if (typeof api.requestCiBank === 'function') api.requestCiBank()
   if (typeof api.consumeLibraryFocus === 'function') api.consumeLibraryFocus()
   return
  }
  if (focus.type === 'ci-selected') {
   setCategory('ci-selected')
   setCiRhythmic(String(focus.rhythmic || ''))
   setDetector('')
   if (typeof api.consumeLibraryFocus === 'function') api.consumeLibraryFocus()
   return
  }
  const items = buildLibraryItems(anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data)
  const target = items.find((item) => item.id === focus.id)
  if (target) {
   setCategory(target.categoryId === 'ci-bank' ? 'ci-bank' : target.categoryId === 'ci-selected' ? 'ci-selected' : 'all')
   setDetail(target)
   setDetector('')
  }
  if (typeof api.consumeLibraryFocus === 'function') api.consumeLibraryFocus()
 }, [api.libraryFocus, anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data])

 const pingshui = React.useMemo(() => (pingshuiRes.data ? buildPingshuiIndex(pingshuiRes.data) : null), [pingshuiRes.data])
 const items = React.useMemo(
  () => buildLibraryItems(anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data),
  [anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data],
 )
 const ciSelectedRhythmicsList = React.useMemo(() => ciSelectedRhythmics(ciRes.data), [ciRes.data])
 const ciFullRhythmics = React.useMemo(() => ciBankRhythmics(ciBankRes.data), [ciBankRes.data])
 const ciRhythmics = category === 'ci-bank' ? ciFullRhythmics : ciSelectedRhythmicsList
 const ciSelectedCount = items.filter((entry) => entry.categoryId === 'ci-selected').length
 let filterCategory = category
 let filterRhythmic = ''
 if (ciMode) {
  filterRhythmic = ciRhythmic
  filterCategory = !debounced ? category : ciSearchScope === 'allCi' ? 'all' : 'ci-selected'
 } else if (searchScope === 'all') {
  filterCategory = 'all'
 }
 const filtered = React.useMemo(
  () => filterLibraryItems(items, filterCategory, debounced, filterRhythmic),
  [items, filterCategory, filterRhythmic, debounced],
 )
 const shown = libraryPage(filtered, visible)
 const poemReport = React.useMemo(
  () => (detail && detector === 'poem' && pingshui ? detectPoem(detail, pingshui) : null),
  [detail, detector, pingshui],
 )
 const pingshuiError = pingshuiRes.status === 'error'
 const loading = !anthologyRes.data && !bankRes.data
 const ciSelectedLoading = category === 'ci-selected' && !ciRes.data
 const ciBankLoading = category === 'ci-bank' && !ciBankRes.data

 function runInputDetection() {
  if (!pingshui) {
   if (typeof api.showToast === 'function') api.showToast('平水韵数据加载中，请稍候')
   if (typeof api.reloadPingshui === 'function') api.reloadPingshui().catch(() => {})
   return
  }
  setInputReport(detectPoemText(inputText, pingshui))
 }

 if (loading) {
  if (anthologyRes.status === 'error' && bankRes.status === 'error') {
   return h(EmptyState, {
    title: '诗库数据暂时不可用',
    message: (anthologyRes.error && anthologyRes.error.status === 404) || (bankRes.error && bankRes.error.status === 404)
     ? '诗库数据尚未生成（assets/data），请稍后重试。'
     : describeDataError(anthologyRes.error || bankRes.error),
    onRetry: () => {
     if (typeof api.reloadAnthology === 'function') api.reloadAnthology().catch(() => {})
     if (typeof api.reloadBank === 'function') api.reloadBank().catch(() => {})
    },
   })
  }
  return h(LoadingState, { text: '正在载入诗库…' })
 }

 function renderDetector() {
  if (!pingshui) {
   return pingshuiError
    ? h(EmptyState, { title: '平水韵数据不可用', message: '格律检测需要平水韵数据。', onRetry: () => api.reloadPingshui && api.reloadPingshui().catch(() => {}) })
    : h(LoadingState, { text: '正在载入平水韵…' })
  }
  const headers = h(
   'div',
   { className: 'dshp-fh-actions' },
   h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setDetector('') }, '返回'),
   h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setDetector('input') }, '自测输入'),
  )
  if (detector === 'poem' && detail) {
   return h(
    'div',
    { className: 'dshp-detail' },
    headers,
    h('div', { className: 'dshp-lib-detail-title' }, libraryItemLabel(detail)),
    h('div', { className: 'dshp-lib-note' }, detail.tones ? '基于数据内平仄标注检测' : '已用平水韵逐字标注（多音字取候选）'),
    h(DetectionView, { report: poemReport, api }),
   )
  }
  return h(
   'div',
   { className: 'dshp-detail' },
   headers,
   h('div', { className: 'dshp-lib-note' }, '输入 4 句或 8 句（每句 5 或 7 字，可含标点），逐字标注平仄与韵部。'),
   h('textarea', {
    className: 'dshp-textarea',
    rows: 6,
    value: inputText,
    placeholder: '例如：\n空山不见人，\n但闻人语响。\n返景入深林，\n复照青苔上。',
    onChange: (event) => setInputText(event.target.value),
   }),
   h(
    'div',
    { className: 'dshp-fh-actions' },
    h('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', onClick: runInputDetection }, '开始检测'),
    h('button', { type: 'button', className: 'dshp-btn', onClick: () => { setInputText(''); setInputReport(null) } }, '清空'),
   ),
   inputReport ? h(DetectionView, { report: inputReport, api }) : null,
  )
 }

 if (detector) {
  return h(
   'div',
   null,
   h('div', { className: 'dshp-fh-chips' },
    h('button', { type: 'button', className: 'dshp-fh-chip', onClick: () => setDetector('input') }, '自测输入'),
    detail ? h('button', { type: 'button', className: 'dshp-fh-chip dshp-is-active', onClick: () => setDetector('poem') }, '检测《' + detail.title + '》') : null),
   renderDetector(),
  )
 }

 if (detail) {
  const rhymeIndexes = detail.tones && Array.isArray(detail.rhymeIdx) ? detail.rhymeIdx : []
  const rhymeSet = {}
  for (const index of rhymeIndexes) rhymeSet[index] = true
  const rows = []
  const lines = Array.isArray(detail.lines) ? detail.lines : []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
   rows.push(h(ToneLine, {
    key: lineIndex,
    line: lines[lineIndex],
    tones: detail.tones ? detail.tones[lineIndex] : '',
    rhyme: Boolean(rhymeSet[lineIndex]),
    showTones: Boolean(detail.tones),
   }))
  }
  return h(
   'div',
   { className: 'dshp-detail' },
   h('div', { className: 'dshp-fh-actions' },
    h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { setDetail(null); setDetector('') } }, '← 返回列表'),
    h('button', { type: 'button', className: 'dshp-btn dshp-btn-small dshp-btn-primary', onClick: () => { setDetector('poem'); if (typeof api.reloadPingshui === 'function' && !pingshui) api.reloadPingshui().catch(() => {}) } }, '格律检测'),
   ),
   h('div', { className: 'dshp-lib-detail-title' }, libraryItemLabel(detail)),
   h('div', { className: 'dshp-lib-note' },
    ((LIBRARY_CATEGORIES.find((item) => item.id === detail.categoryId) || {}).label || detail.categoryId)
    + (detail.rhythmic ? ' · 词牌 ' + detail.rhythmic : '')),
   detail.tones ? h('div', { className: 'dshp-lib-lines' }, rows) : h('div', { className: 'dshp-lib-plain' }, lines.map((line, index) => h('div', { key: index }, line))),
   detail.tones
    ? h('div', { className: 'dshp-lib-tags' },
     detail.form ? h('span', { className: 'dshp-tag' }, '体式 ' + detail.form) : null,
     detail.start ? h('span', { className: 'dshp-tag' }, '起式 ' + detail.start) : null,
     detail.meter ? h('span', { className: 'dshp-tag' }, detail.meter) : null)
    : h('div', { className: 'dshp-lib-note' }, '未标注平仄（可点「格律检测」用平水韵逐字标注）'),
  )
 }

 const ciModeActive = category === 'ci-selected' || category === 'ci-bank'
 return h(
  'div',
  { className: 'dshp-library' },
  h(
   'div',
   { className: 'dshp-fh-chips' },
   h('button', { type: 'button', className: 'dshp-fh-chip' + (category === 'all' ? ' dshp-is-active' : ''), onClick: () => setCategory('all') }, '全部 ' + items.length),
   LIBRARY_CATEGORIES.map((item) => {
    const count = item.id === 'ci-selected'
     ? (ciRes.data ? ciSelectedCount : '…')
     : items.filter((entry) => entry.categoryId === item.id).length
    return h('button', {
     key: item.id,
     type: 'button',
     className: 'dshp-fh-chip' + (category === item.id ? ' dshp-is-active' : ''),
     onClick: () => setCategory(item.id),
    }, item.label + ' ' + count)
   }),
  ),
  ciModeActive
   ? h('div', { className: 'dshp-search', style: { marginTop: 0 } },
    h(
     'div',
     { className: 'dshp-seg' },
     h('button', {
      type: 'button',
      className: 'dshp-seg-btn' + (category === 'ci-selected' ? ' dshp-is-active' : ''),
      onClick: () => setCategory('ci-selected'),
     }, '宋词精选 ' + (ciRes.data ? ciSelectedCount : '…')),
     h('button', {
      type: 'button',
      className: 'dshp-seg-btn' + (category === 'ci-bank' ? ' dshp-is-active' : ''),
      onClick: () => {
       setCategory('ci-bank')
      },
     }, '全部宋词' + (ciBankRes.data ? '（' + num(ciBankRes.data.count, items.filter((entry) => entry.categoryId === 'ci-bank').length) + '）' : '（点击加载）')),
    ),
    h('select', {
     className: 'dshp-select',
     value: ciRhythmic,
     'aria-label': category === 'ci-bank' ? '按词牌筛选全部宋词' : '按词牌筛选宋词精选',
     onChange: (event) => setCiRhythmic(event.target.value),
    },
    h('option', { value: '' }, '全部词牌'),
    (ciRhythmic && !ciRhythmics.some((entry) => entry.name === ciRhythmic)
     ? [{ name: ciRhythmic, count: 0 }].concat(ciRhythmics)
     : ciRhythmics).slice(0, 300).map((entry) => h('option', { key: entry.name, value: entry.name }, entry.name + '（' + entry.count + '）'))),
    h('span', { className: 'dshp-pager-label' }, category === 'ci-bank'
     ? (ciBankRes.data ? '已载入 ' + num(ciBankRes.data.count, items.filter((entry) => entry.categoryId === 'ci-bank').length) + ' 首' : '载入中…')
     : (ciRes.data ? '已载入 ' + ciSelectedCount + ' 首' : '载入中…')),
   )
   : null,
  h('div', { className: 'dshp-search' },
   h('input', {
    className: 'dshp-input',
    type: 'search',
    value: query,
    placeholder: '搜索标题 / 作者 / 词牌 / 诗句',
    'aria-label': '搜索诗库',
    onChange: (event) => setQuery(event.target.value),
   }),
   h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setDetector('input') }, '格律自测'),
  ),
  debounced
   ? h(
    'div',
    { className: 'dshp-search', style: { marginBottom: '4px' } },
    h('span', { className: 'dshp-pager-label' }, '搜索范围'),
    ciModeActive
     ? h(
      'div',
      { className: 'dshp-seg' },
      h('button', {
       type: 'button',
       className: 'dshp-seg-btn' + (ciSearchScope === 'selected' ? ' dshp-is-active' : ''),
       onClick: () => setCiSearchScope('selected'),
      }, '精选'),
      h('button', {
       type: 'button',
       className: 'dshp-seg-btn' + (ciSearchScope === 'allCi' ? ' dshp-is-active' : ''),
       onClick: () => {
        setCiSearchScope('allCi')
       },
      }, '全部宋词'),
     )
     : h(
      'div',
      { className: 'dshp-seg' },
      h('button', {
       type: 'button',
       className: 'dshp-seg-btn' + (searchScope === 'category' ? ' dshp-is-active' : ''),
       onClick: () => setSearchScope('category'),
      }, '当前分类'),
      h('button', {
       type: 'button',
       className: 'dshp-seg-btn' + (searchScope === 'all' ? ' dshp-is-active' : ''),
       onClick: () => setSearchScope('all'),
      }, '全部'),
     ),
    ciModeActive && ciSearchScope === 'allCi' && !ciBankRes.data
     ? h('span', { className: 'dshp-pager-label' }, ciBankRes.status === 'loading' ? '宋词全库加载中，暂只搜精选…' : '宋词全库未加载，暂只搜精选')
     : null,
   )
   : null,
  ciSelectedLoading
   ? (ciRes.status === 'error'
    ? h(EmptyState, {
     title: '宋词精选暂时不可用',
     message: describeDataError(ciRes.error),
     onRetry: () => api.reloadCi && api.reloadCi().catch(() => {}),
    })
    : h(LoadingState, { text: '正在载入宋词精选 283 首…' }))
   : ciBankLoading
    ? (ciBankRes.status === 'error'
     ? h(EmptyState, {
      title: '全部宋词暂时不可用',
      message: ciBankRes.error && ciBankRes.error.status === 404 ? '宋词全库数据尚未生成（assets/data），请稍后重试。' : describeDataError(ciBankRes.error),
      onRetry: () => api.reloadCiBank && api.reloadCiBank().catch(() => {}),
     })
     : h(LoadingState, { text: '正在载入全部宋词（约 2 万首，首次稍慢）…' }))
    : h(
     'div',
     null,
     h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '共 ' + filtered.length + ' 首' + (debounced !== query ? '（搜索中…）' : '')),
     shown.length
      ? h('div', { className: 'dshp-list' }, shown.map((item) => h('button', {
       key: item.id,
       type: 'button',
       className: 'dshp-row',
       onClick: () => setDetail(item),
      }, h('span', { className: 'dshp-row-main' },
       h('span', { className: 'dshp-row-title' }, libraryItemLabel(item)),
       h('span', { className: 'dshp-row-sub' }, (item.rhythmic ? '词牌 ' + item.rhythmic + ' · ' : '') + ((Array.isArray(item.lines) ? item.lines[0] : '') || '')),
      ))))
      : h(EmptyState, { title: '没有匹配的诗词', message: '换一个分类或关键词试试。', icon: '📚' }),
    ),
  filtered.length > shown.length
   ? h('div', { style: { textAlign: 'center', marginTop: '10px' } },
    h('button', { type: 'button', className: 'dshp-btn', onClick: () => setVisible(visible + LIBRARY_PAGE) }, '加载更多（剩余 ' + (filtered.length - shown.length) + ' 首）'))
   : null,
 )
}

class WidgetBoundary extends React.Component {
constructor(props) {
 super(props)
 this.state = { failed: false }
 this.handleRetry = this.handleRetry.bind(this)
}

static getDerivedStateFromError() {
 return { failed: true }
}

componentDidCatch(error) {
 try {
  console.warn('[dsh-little-whale] 渲染异常，已降级为最小形象：', error)
 } catch (ignored) {
 }
}

handleRetry() {
 this.setState({ failed: false })
}

render() {
 if (!this.state.failed) return this.props.children
 return h(
  'div',
  {
  'data-dsh-little-whale': 'root',
  className: 'dshp-root',
  style: {
   position: 'fixed',
   left: '16px',
   bottom: '24px',
   zIndex: Z_INDEX,
   pointerEvents: 'auto',
   display: 'flex',
   flexDirection: 'column',
   alignItems: 'center',
   gap: '6px',
   padding: '8px',
  },
  },
  h('style', null, CSS),
  h('img', {
  src: mascotUrl(MASCOT_FILES.celebrate),
  alt: '小鲸鱼挂件',
  width: 64,
  height: 64,
  draggable: false,
  style: { display: 'block' },
  }),
  h('button', {
  type: 'button',
  className: 'dshp-btn',
  onClick: this.handleRetry,
  }, '挂件显示异常，点此重试'),
 )
}
}

  return { LibraryTab, WidgetBoundary }
}
