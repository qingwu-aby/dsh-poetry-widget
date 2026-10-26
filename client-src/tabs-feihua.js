// client-src/tabs-feihua.js —— 飞花令面板（v2.4 从 client.js 抽出）。
//
// 纯逻辑在 feihua.js；这里只保留 UI/本地状态。React/h/cx/共享组件与缓存函数由 client 注入。
import {
  FEIHUA_ATLAS_LIMIT,
  FEIHUA_CANDIDATE_LIMIT,
  FEIHUA_MIN_ENTRIES,
  feihuaBestUpdate,
  feihuaRandomIndex,
  feihuaStart,
  feihuaSubmit,
  normalizeFeihuaBest,
} from './feihua.js'
import { num } from './base.js'

export function createFeihuaTab(ctx = {}) {
  const React = ctx.React
  const h = ctx.h
  const cx = ctx.cx
  const EmptyState = ctx.EmptyState
  const LoadingState = ctx.LoadingState
  const ToneLine = ctx.ToneLine
  const detectionRhymeIndexes = ctx.detectionRhymeIndexes
  const formatDetectionReport = ctx.formatDetectionReport
  const describeDataError = ctx.describeDataError
  const getFeihuaIndex = ctx.getFeihuaIndex
  const pickDefaultFeihuaChar = ctx.pickDefaultFeihuaChar
  const feihuaSourceOf = ctx.feihuaSourceOf
  const mergeFeihuaItems = ctx.mergeFeihuaItems
  const finishFeihuaIndex = ctx.finishFeihuaIndex
  const mergeFeihuaFullEntries = ctx.mergeFeihuaFullEntries
  const requestFeihuaFull = ctx.requestFeihuaFull
  const abortFeihuaFull = ctx.abortFeihuaFull
  const readFeihuaFullCache = ctx.readFeihuaFullCache
  const readFeihuaBest = ctx.readFeihuaBest
  const writeFeihuaBest = ctx.writeFeihuaBest
  const FEIHUA_ATLAS_PAGE = ctx.FEIHUA_ATLAS_PAGE
  const FEIHUA_FULL_RETRY_MS = ctx.FEIHUA_FULL_RETRY_MS

function FeihuaTab(props) {
const api = props.api || {}
const poemsRes = api.poemsRes || {}
const ciRes = api.ciRes || {}
const index = api.feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, api.anthologyRes && api.anthologyRes.data, api.bankRes && api.bankRes.data)
const feihuaBuilding = api.feihuaBuilding === true || Boolean(api.ciBankRes && api.ciBankRes.status === 'loading')
const ciBankFailed = Boolean(api.ciBankRes && api.ciBankRes.status === 'error')
const [char, setChar] = React.useState(null)
const [mode, setMode] = React.useState('chain')
const [game, setGame] = React.useState(null)
const [inputText, setInputText] = React.useState('')
const [atlasLimit, setAtlasLimit] = React.useState(FEIHUA_ATLAS_PAGE)
const [best, setBest] = React.useState(() => readFeihuaBest())
const bestRef = React.useRef(best)
bestRef.current = best
const launch = num(api.feihuaLaunch, 0)
const launchRef = React.useRef(0)
const activeChar = index
 ? (char || pickDefaultFeihuaChar(index, api.poem))
 : null
React.useEffect(() => {
 if (!index || !activeChar) return
 if (launch > 0 && launch !== launchRef.current) {
  launchRef.current = launch
  setGame(feihuaStart(index, activeChar))
  setMode('chain')
  if (typeof api.consumeFeihuaLaunch === 'function') api.consumeFeihuaLaunch()
 }
}, [launch, index, activeChar])

const [fullInfo, setFullInfo] = React.useState({ char: '', status: 'idle', count: 0 })
const fullTokenRef = React.useRef(0)
React.useEffect(() => {
 if (!index || !activeChar) return undefined
 const target = activeChar
 const cached = readFeihuaFullCache(target)
 if (cached && cached.status === 'ready') {
  mergeFeihuaFullEntries(index, target, cached.entries)
  setFullInfo({ char: target, status: 'ready', count: cached.count })
  return undefined
 }
 if (cached && cached.status === 'error' && Date.now() - cached.at < FEIHUA_FULL_RETRY_MS) {
  setFullInfo({ char: target, status: 'error', count: 0 })
  return undefined
 }
 const token = fullTokenRef.current + 1
 fullTokenRef.current = token
 setFullInfo({ char: target, status: 'loading', count: 0 })
 requestFeihuaFull(target).then((result) => {
  if (token !== fullTokenRef.current) return
  if (result && result.ok && Array.isArray(result.entries)) {
   mergeFeihuaFullEntries(index, target, result.entries)
   setFullInfo({ char: target, status: 'ready', count: result.count || result.entries.length })
  } else {
   setFullInfo({ char: target, status: 'error', count: 0 })
  }
 })
 return () => {
  fullTokenRef.current += 1
  abortFeihuaFull(target)
 }
}, [activeChar, index])

if (poemsRes.status === 'error') {
 return h(EmptyState, {
  title: '飞花令句库暂时不可用',
  message: describeDataError(poemsRes.error),
  onRetry: () => api.reloadPoems && api.reloadPoems().catch(() => {}),
 })
}
if (ciRes.status === 'error') {
 return h(EmptyState, {
  title: '词库暂时不可用',
  message: describeDataError(ciRes.error),
  onRetry: () => api.reloadCi && api.reloadCi().catch(() => {}),
 })
}
if (!poemsRes.data || !ciRes.data) return h(LoadingState, { text: '正在载入飞花令句库…' })
if (!index || !index.entries.length) {
 return h(EmptyState, { title: '飞花令句库为空', message: '诗/词数据里还没有可用的句子。', icon: '🪶' })
}
const candidateChips = index.candidates.slice()
if (!candidateChips.some((item) => item.char === activeChar)) {
 candidateChips.unshift({ char: activeChar, count: index.counts[activeChar] || 0 })
}
const charEntries = index.byChar[activeChar] || []
const bestForChar = best.chars[activeChar] || 0

function startGame(target) {
 const use = target || activeChar
 if (!index || !use) return
 setChar(use)
 setInputText('')
 setGame(feihuaStart(index, use))
 setMode('chain')
 setAtlasLimit(FEIHUA_ATLAS_PAGE)
 // 来一局时若当前令字还没有全量数据，也兜底发起一次懒加载
 const cachedFull = readFeihuaFullCache(use)
 if (!cachedFull || cachedFull.status !== 'ready') {
  const token = fullTokenRef.current + 1
  fullTokenRef.current = token
  requestFeihuaFull(use).then((result) => {
   if (token !== fullTokenRef.current) return
   if (result && result.ok && Array.isArray(result.entries)) {
    mergeFeihuaFullEntries(index, use, result.entries)
    setFullInfo({ char: use, status: 'ready', count: result.count || result.entries.length })
   }
  }).catch(() => {})
 }
 if (typeof api.pulseMascot === 'function') api.pulseMascot('gameThink')
}

function chooseChar(next) {
 if (!next) return
 if (next === activeChar) {
  setGame(null)
  setInputText('')
  return
 }
 setChar(next)
 setInputText('')
 setGame(null)
 setAtlasLimit(FEIHUA_ATLAS_PAGE)
}

function randomChar() {
 if (!index || !index.candidates.length) return
 const pool = index.candidates.filter((item) => item.char !== activeChar)
 const picked = pool.length ? pool[feihuaRandomIndex(pool.length)] : index.candidates[0]
 chooseChar(picked.char)
}

function submitAnswer() {
 if (!game || game.phase !== 'playing') return
 const next = feihuaSubmit(game, index, inputText)
 if (!next || next === game) return
 setGame(next)
 if (next.feedback && next.feedback.kind === 'good') setInputText('')
 if (next.feedback && typeof api.pulseMascot === 'function') {
  api.pulseMascot(next.feedback.kind === 'good' ? 'gameWin' : 'gameLose')
 }
 const updated = feihuaBestUpdate(bestRef.current, next.char, next.score)
 if (updated.overall !== bestRef.current.overall
  || (updated.chars[next.char] || 0) !== (bestRef.current.chars[next.char] || 0)) {
  setBest(updated)
  writeFeihuaBest(updated)
 }
}

function handleInputKey(event) {
 if (event && event.key === 'Enter') {
  event.preventDefault()
  submitAnswer()
 }
}

function renderChain() {
 const playing = game && game.phase === 'playing'
 if (!game) {
  return h(
  'div',
  { className: 'dshp-card' },
  h('div', { className: 'dshp-card-title' }, '飞花令 · 对句'),
  h('div', { className: 'dshp-card-summary' }, '令字「' + activeChar + '」· ' + charEntries.length + ' 句可查'),
  h('div', { className: 'dshp-block' }, '对方先出一句含令字的诗，你输入一句：有出处、含令字、本局不重复就算接上。不扣命，不计错。'),
  charEntries.length
   ? h(
    'div',
    { className: 'dshp-fh-actions' },
    h('button', {
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: (event) => {
     event.stopPropagation()
     startGame(activeChar)
    },
    }, '来一局'),
    h('span', { className: 'dshp-pager-label' }, '本字最佳 ' + bestForChar + ' 局'),
   )
   : h('div', { className: 'dshp-empty-msg' }, '这一字暂时没有句子，换一个令字试试。'),
  )
 }
 return h(
  'div',
  { className: 'dshp-card' },
  h('div', { className: 'dshp-card-title' }, '飞花令 · 对句'),
  h('div', { className: 'dshp-card-summary' }, '令字「' + game.char + '」· 本局已接 ' + game.score + ' 句 · 本字最佳 ' + Math.max(bestForChar, game.score) + ' 局'),
  game.system
  ? h(
   'div',
   { className: 'dshp-fh-system' },
   '对方：' + game.system.text,
   game.system.source ? h('small', null, game.system.source) : null,
  )
  : null,
  h('div', { className: 'dshp-fh-prompt' }, game.message || '请接一句含「' + game.char + '」的诗句'),
  h(
   'div',
   { className: 'dshp-fh-actions' },
   h('input', {
    className: 'dshp-input',
    type: 'text',
    value: inputText,
    maxLength: 60,
    placeholder: '输入一句含「' + game.char + '」的诗/词，回车提交',
    'aria-label': '输入飞花令对句',
    onChange: (event) => setInputText(event.target.value),
    onKeyDown: handleInputKey,
    disabled: !playing,
   }),
   h('button', {
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: (event) => {
     event.stopPropagation()
     submitAnswer()
    },
    disabled: !playing,
   }, '接一句'),
  ),
  h('div', {
  className: cx(
   'dshp-fh-feedback',
   game.feedback && game.feedback.kind === 'good' && 'dshp-is-good',
   game.feedback && game.feedback.kind === 'bad' && 'dshp-is-bad',
  ),
  role: 'status',
  'aria-live': 'polite',
  }, game.feedback ? game.feedback.text : ''),
  game.phase === 'cleared'
  ? h(
   'div',
   { className: 'dshp-fh-result' },
   h('b', null, '这一字接完了'),
   h('span', null, '本局接上 ' + game.score + ' 句 · 本字最佳 ' + Math.max(bestForChar, game.score) + ' 局 · 历史最佳 ' + Math.max(best.overall, game.score) + ' 局'),
   h('span', null, '这一字的句子都被接过了，换个令字继续。'),
  )
  : null,
  h(
   'div',
   { className: 'dshp-fh-actions' },
   h('button', {
    type: 'button',
    className: 'dshp-btn',
    onClick: (event) => {
     event.stopPropagation()
     randomChar()
    },
   }, '换个令字'),
   h('button', {
    type: 'button',
    className: 'dshp-btn',
    onClick: (event) => {
     event.stopPropagation()
     startGame(activeChar)
    },
   }, '重新开局'),
  ),
 )
}
function renderAtlas() {
 const total = charEntries.length
 const limit = Math.min(FEIHUA_ATLAS_LIMIT, atlasLimit)
 const shown = charEntries.slice(0, limit)
 return h(
  'div',
  null,
  h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } },
  '令字「' + activeChar + '」· 共 ' + total + ' 句（去重后最多展示 ' + FEIHUA_ATLAS_LIMIT + ' 条）'),
  shown.length
  ? h(
   'div',
   { className: 'dshp-fh-atlas' },
   shown.map((entry, entryIndex) => h(
    'div',
    { key: entryIndex, className: 'dshp-fh-line' },
    h('div', { className: 'dshp-fh-line-text' }, entry.text),
    h('div', { className: 'dshp-fh-line-source' }, '—— ' + entry.source),
   )),
  )
  : h(EmptyState, { title: '这一字暂时没有句子', message: '换一个令字试试。', icon: '🪶' }),
  total > shown.length
  ? h(
   'div',
   { style: { textAlign: 'center', marginTop: '10px' } },
   h('button', {
    type: 'button',
    className: 'dshp-btn',
    onClick: () => setAtlasLimit(Math.min(FEIHUA_ATLAS_LIMIT, atlasLimit + FEIHUA_ATLAS_PAGE)),
   }, '加载更多（剩余 ' + (total - shown.length) + ' 条）'),
  )
  : null,
 )
}

return h(
 'div',
 null,
 h(
  'div',
  { className: 'dshp-fh-chips' },
  candidateChips.map((item) => h('button', {
  key: item.char,
  type: 'button',
  className: cx('dshp-fh-chip', item.char === activeChar && 'dshp-is-active'),
  title: '令字「' + item.char + '」· ' + item.count + ' 句',
  'aria-pressed': item.char === activeChar,
  onClick: (event) => {
   event.stopPropagation()
   chooseChar(item.char)
  },
  }, item.char, h('small', null, String(item.count)))),
  h('button', {
  key: 'random',
  type: 'button',
  className: 'dshp-fh-chip',
  title: '随机换一个令字',
  onClick: (event) => {
   event.stopPropagation()
   randomChar()
  },
  }, '随机'),
 ),
 h(
  'div',
  { className: 'dshp-fh-meta' },
  h('span', null, fullInfo.char === activeChar
   ? (fullInfo.status === 'ready'
    ? '全量校验已启用（' + fullInfo.count + ' 句）'
    : fullInfo.status === 'loading' || fullInfo.status === 'idle' ? '正在加载全量校验句库…' : '全量校验未启用（使用本地句库）')
   : '正在加载全量校验句库…'),
 ),
 feihuaBuilding ? h('div', { className: 'dshp-card-summary' }, '正在并入宋词全库…') : null,
 ciBankFailed ? h('div', { className: 'dshp-card-summary' }, '宋词全库加载失败，已回退原句库') : null,
 h(
  'div',
  { className: 'dshp-fh-meta' },
  h('span', null, '令字 ', h('b', null, '「' + activeChar + '」')),
  h('span', null, '句库 ', h('b', null, String(charEntries.length)), ' 句'),
  h('span', null, '历史最佳 ', h('b', null, String(best.overall)), ' 分'),
  game ? h('span', null, '本局接上 ', h('b', null, String(game.score)), ' 句') : null,
 ),
 h(
  'div',
  { className: 'dshp-seg', style: { marginBottom: '10px' } },
  h('button', {
  type: 'button',
  className: cx('dshp-seg-btn', mode === 'chain' && 'dshp-is-active'),
  onClick: () => setMode('chain'),
  }, '对句'),
  h('button', {
  type: 'button',
  className: cx('dshp-seg-btn', mode === 'atlas' && 'dshp-is-active'),
  onClick: () => setMode('atlas'),
  }, '图鉴'),
 ),
 mode === 'atlas' ? renderAtlas() : renderChain(),
)
}
/* ================================================================
 * 8.9 诗库（anthology + bank）与格律检测器（pingshui）
 * ================================================================ */

function DetectionView(props) {
 const report = props.report
 const api = props.api || {}
 if (!report) return null
 const annotation = Array.isArray(report.annotation) ? report.annotation : []
 const rhymeIndexes = detectionRhymeIndexes(report)
 const lines = []
 for (let lineIndex = 0; lineIndex < annotation.length; lineIndex += 1) {
  const cells = annotation[lineIndex]
  const lineText = cells.map((cell) => cell.ch).join('')
  const toneText = cells.map((cell) => (cell.tone === '○' ? '○' : cell.tone === '？' ? '？' : cell.tone)).join('')
  lines.push(h(ToneLine, { key: lineIndex, line: lineText, tones: toneText, rhyme: Boolean(rhymeIndexes[lineIndex]), showTones: true }))
 }
 const multiTones = []
 for (const line of annotation) {
  for (const cell of line) {
   if (cell.candidates.length > 1) multiTones.push(cell)
  }
 }
 return h(
  'div',
  { className: 'dshp-detail' },
  h('div', { className: 'dshp-lib-report' }, report.summary || ''),
  (report.errors || []).length ? h('div', { className: 'dshp-lib-errors' }, report.errors.join('；')) : null,
  h('div', { className: 'dshp-lib-detect-lines' }, lines),
  report.rhymeLines && report.rhymeLines.length
   ? h('div', { className: 'dshp-lib-tags' }, report.rhymeLines.map((item) => h('span', { key: item.line, className: 'dshp-tag' },
    '第' + item.line + '句 ' + item.ch + (item.names.length ? '（' + item.names.join('/') + '）' : '') + (item.borrowed ? ' 借韵' : ''))))
   : null,
  report.violations && report.violations.length
   ? h('div', { className: 'dshp-lib-errors' }, report.violations.map((item) => '第' + item.line + '句第' + item.position + '字「' + item.ch + '」宜' + item.expected + '（实际' + item.actual + '）').join('；'))
   : null,
  report.sticky && report.sticky.length
   ? h('div', { className: 'dshp-lib-errors' }, report.sticky.map((item) => '第' + item.pair + '句失' + item.type).join('；'))
   : null,
  report.sanPing && report.sanPing.length ? h('div', { className: 'dshp-lib-errors' }, '三平调：第 ' + report.sanPing.join('、') + ' 句') : null,
  report.guPing && report.guPing.length ? h('div', { className: 'dshp-lib-errors' }, '孤平：第 ' + report.guPing.join('、') + ' 句') : null,
  multiTones.length
   ? h('div', { className: 'dshp-lib-multi' }, '多音字：' + multiTones.map((cell) => '「' + cell.ch + '」' + cell.candidates.map((item) => item.tone + '·' + item.name).join('/')).join('；'))
   : null,
  h(
   'div',
   { className: 'dshp-fh-actions' },
   h('button', {
    type: 'button',
    className: 'dshp-btn dshp-btn-small',
    onClick: () => {
     const text = formatDetectionReport(report)
     try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
       navigator.clipboard.writeText(text).catch(() => {})
      }
     } catch (error) {
      /* 剪贴板不可用时忽略，报告本身可选中复制 */
     }
     if (typeof api.showToast === 'function') api.showToast('检测结果已复制')
    },
   }, '复制结果'),
  ),
 )
}

  return { FeihuaTab, DetectionView }
}
