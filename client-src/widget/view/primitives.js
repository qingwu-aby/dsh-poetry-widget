// client-src/widget/view/primitives.js —— 无 hooks 的基础展示组件（诗体/平仄/图例/空态/加载态）
import { h } from '../runtime.js'
import { buildToneCells, poemRhymeLines, selectCiText, selectPoemText } from '../../poetry-engine.js'
import { cx } from '../models/utils.js'
import { selfStatusSummary } from '../models/self-model.js'

export function LoadingState(props) {
  return h(
    'div',
    { className: 'dshp-loading' },
    h('span', { className: 'dshp-spinner', 'aria-hidden': 'true' }),
    h('span', null, (props && props.text) || '正在载入…'),
  )
}

export function EmptyState(props) {
  const options = props || {}
  return h(
    'div',
    { className: 'dshp-empty' },
    h('div', { className: 'dshp-empty-icon', 'aria-hidden': 'true' }, options.icon || '📜'),
    h('div', { className: 'dshp-empty-title' }, options.title || '暂时没有内容'),
    h('div', { className: 'dshp-empty-msg' }, options.message || '请稍后重试'),
    options.onRetry
      ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', onClick: options.onRetry }, options.retryLabel || '重试')
      : null,
  )
}

export function Legend() {
  return h(
    'div',
    { className: 'dshp-legend', 'aria-label': '平仄图例' },
    h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-dot', style: { background: 'var(--dshp-ping)' } }), '平'),
    h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-dot', style: { background: 'var(--dshp-ze)' } }), '仄'),
    h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-dot', style: { background: 'var(--dshp-any)' } }), '多音'),
    h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-line' }), '韵脚'),
  )
}

export function ToneLine(props) {
  const cells = buildToneCells(props.line, props.tones, {
    showTones: props.showTones !== false,
    rhymeLine: props.rhyme === true,
  })
  return h(
    'div',
    { className: 'dshp-line' },
    cells.map((cell, index) => h(
      'span',
      {
        key: index,
        className: cell.className,
        title: cell.punctuation ? undefined : (cell.tone || ''),
      },
      cell.tone ? h('span', { className: 'dshp-tone', 'aria-hidden': 'true' }, cell.tone) : null,
      h('span', { className: 'dshp-chr' }, cell.ch),
    )),
  )
}

export function PoemBody(props) {
  if (!props.poem) return null
  const text = selectPoemText(props.poem, props.script)
  const rhymeLines = poemRhymeLines(props.poem)
  return h(
    'div',
    { className: 'dshp-poem' },
    h('div', { className: 'dshp-poem-title' }, text.title || '无题'),
    text.author ? h('div', { className: 'dshp-poem-author' }, text.author) : null,
    h(
      'div',
      { className: 'dshp-poem-lines' },
      text.lines.map((line, index) => h(ToneLine, {
        key: index,
        line,
        tones: Array.isArray(props.poem.tones) ? props.poem.tones[index] : '',
        rhyme: rhymeLines.indexOf(index) >= 0,
        showTones: props.showTones !== false,
      })),
    ),
    props.showTones !== false ? h(Legend) : null,
  )
}

export function AnalysisBody(props) {
  const poem = props.poem || {}
  const rhymeLines = poemRhymeLines(poem).map((index) => '第 ' + (index + 1) + ' 句')
  const firstRhyme = poem.firstRhyme === true ? '是' : (poem.firstRhyme === false ? '否' : '—')
  return h(
    'div',
    { className: 'dshp-analysis' },
    h(
      'div',
      { className: 'dshp-tags' },
      h('span', { className: 'dshp-tag' }, '体式：' + (poem.form || '—')),
      h('span', { className: 'dshp-tag' }, '起式：' + (poem.start || '—')),
      h('span', { className: 'dshp-tag' }, '首句入韵：' + firstRhyme),
    ),
    h(
      'div',
      { className: 'dshp-kv' },
      h('span', { className: 'dshp-kv-key' }, '标准格式'),
      h('span', { className: 'dshp-kv-val' }, poem.meter || '—'),
    ),
    h(
      'div',
      { className: 'dshp-analysis-text dshp-block' },
      poem.analysis ? String(poem.analysis) : '暂无解析文本。',
    ),
    rhymeLines.length
      ? h(
        'div',
        { className: 'dshp-kv' },
        h('span', { className: 'dshp-kv-key' }, '入韵句'),
        h('span', { className: 'dshp-kv-val' }, rhymeLines.join('、')),
      )
      : null,
  )
}

export function CiBody(props) {
  const ci = props.ci
  if (!ci) return null
  const text = selectCiText(ci)
  return h(
    'div',
    { className: 'dshp-poem' },
    h('div', { className: 'dshp-poem-title' }, text.title || '无题'),
    text.author ? h('div', { className: 'dshp-poem-author' }, text.author) : null,
    h('div', { className: 'dshp-ci-lines' }, text.lines.map((line, index) => h('div', { key: index }, line))),
  )
}

export function KnowledgeCardView(props) {
  const card = props.card || {}
  const paragraphs = Array.isArray(card.paragraphs) ? card.paragraphs : []
  const examples = Array.isArray(card.examples) ? card.examples : []
  return h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-title' }, String(card.title || '格律知识')),
    card.summary ? h('div', { className: 'dshp-card-summary' }, String(card.summary)) : null,
    paragraphs.map((paragraph, index) => h('p', { key: index, className: 'dshp-p' }, String(paragraph == null ? '' : paragraph))),
    examples.map((example, index) => h(
      'div',
      { key: 'example-' + index, className: 'dshp-example' },
      h('div', { className: 'dshp-example-text' }, String((example && example.text) || '')),
      example && example.note ? h('div', { className: 'dshp-example-note' }, String(example.note)) : null,
    )),
  )
}

/** 开关按钮（设置/成长页共用）。 */
export function switchNode(checked, onChange, label) {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked === true,
    'aria-label': label,
    className: cx('dshp-switch', checked === true && 'dshp-is-on'),
    onClick: onChange,
  })
}

/** 她此刻的状态（SettingsTab 与 GrowthTab 共用）：一句话 + 事实时间线，没有分数。 */
export function growthMetricsTree(status) {
  const felt = status && typeof status.felt === 'string' ? status.felt : ''
  const context = status && Array.isArray(status.context) ? status.context : []
  return h(
    'div',
    { className: 'dshp-self-being' },
    h('div', { className: 'dshp-self-felt' }, felt || '还没想好自己此刻是什么感觉。'),
    context.length > 0
      ? h(
        'div',
        { className: 'dshp-self-context' },
        context.map((line, index) => h('div', { className: 'dshp-self-context-line', key: 'ctx-' + index }, line)),
      )
      : null,
    h('div', { className: 'dshp-self-summary' }, selfStatusSummary(status) || '尚未开始'),
  )
}
