// client-src/widget/view/steps/poem-step.js —— 气泡第 1 张：今日一诗（含加载/空态回退）。
import { h } from '../../runtime.js'
import { EmptyState, LoadingState, PoemBody } from '../primitives.js'
import { describeDataError } from '../../models/utils.js'

  export function PoemFallback(props) {
  const { boot, retryBootstrap, poemsRes, reloadPoems } = props
   if (boot.status === 'error') {
    return h(EmptyState, {
    title: '诗词数据尚未就绪',
    message: describeDataError(boot.error),
    onRetry: retryBootstrap,
    })
   }
   if (poemsRes.status === 'error') {
    return h(EmptyState, {
    title: '今日一诗暂时不可用',
    message: describeDataError(poemsRes.error),
    onRetry: () => reloadPoems().catch(() => {}),
    })
   }
   return h(LoadingState, { text: '正在载入今日一诗…' })
  }

  export function PoemStep(props) {
  const { poem, weatherChip, moodChip, moodChipTitle, weatherNote, dateLabel, settings } = props
   if (poem) {
    return h(
    'div',
    null,
    weatherChip || moodChip
     ? h(
      'div',
      { className: 'dshp-weather' },
      h(
      'div',
      { className: 'dshp-chip-row' },
      weatherChip ? h('span', { className: 'dshp-weather-chip' }, weatherChip) : null,
      moodChip ? h('span', { className: 'dshp-weather-chip dshp-mood-chip', title: moodChipTitle }, moodChip) : null,
      ),
      weatherNote ? h('div', { className: 'dshp-weather-note' }, weatherNote) : null,
     )
     : null,
    h('div', { className: 'dshp-muted', style: { fontSize: '11.5px', textAlign: 'center', marginBottom: '2px' } }, '今日一诗 · ' + dateLabel),
    h(PoemBody, { poem, script: settings.script, showTones: settings.showTones }),
    )
   }
   return PoemFallback(props)
  }

