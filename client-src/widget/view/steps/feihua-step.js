// client-src/widget/view/steps/feihua-step.js —— 气泡第 6 张：飞花令入口。
import { h } from '../../runtime.js'
import { EmptyState, LoadingState } from '../primitives.js'
import { describeDataError } from '../../models/utils.js'
import { getFeihuaIndex, pickDefaultFeihuaChar, readFeihuaBest } from '../../models/feihua-model.js'

  export function FeihuaStep(props) {
  const { poemsRes, ciRes, reloadPoems, reloadCi, anthologyRes, bankRes, poem, feihuaBuilding, ciBankRes, openFeihuaGame, feihuaIndex } = props
   if (poemsRes.status === 'error' || ciRes.status === 'error') {
    const failed = poemsRes.status === 'error' ? poemsRes : ciRes
    const retry = poemsRes.status === 'error' ? reloadPoems : reloadCi
    return h(EmptyState, {
    title: '飞花令句库暂时不可用',
    message: describeDataError(failed.error),
    onRetry: () => retry().catch(() => {}),
    })
   }
   const index = feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data)
   if (!index || !ciRes.data) return h(LoadingState, { text: '正在载入飞花令句库…' })
   const char = pickDefaultFeihuaChar(index, poem)
   const count = (index.byChar[char] || []).length
   const best = readFeihuaBest()
   const charBest = best.chars[char] || 0
   return h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-summary' }, '飞花令 · 对句'),
    h(
    'div',
    { className: 'dshp-fh-meta' },
    h('span', null, '今日令字 ', h('b', null, '「' + char + '」')),
    h('span', null, '句库 ', h('b', null, String(count)), ' 句'),
    h('span', null, '历史最佳 ', h('b', null, String(best.overall)), ' 分'),
    ),
    h('div', { className: 'dshp-block' }, '系统先出含令字的诗句，你输入一句：有出处、含令字、本局不重复就算接上。'),
    feihuaBuilding || (ciBankRes.status === 'loading') ? h('div', { className: 'dshp-lib-note' }, '正在并入宋词全库…') : null,
    ciBankRes.status === 'error' ? h('div', { className: 'dshp-lib-note' }, '宋词全库加载失败，已回退原句库') : null,
    count
    ? h(
     'div',
     { className: 'dshp-fh-actions' },
     h('button', {
      type: 'button',
      className: 'dshp-btn dshp-btn-primary',
      onClick: (event) => {
      event.stopPropagation()
      openFeihuaGame()
      },
     }, '来一局'),
     h('span', { className: 'dshp-pager-label' }, '本字最佳 ' + charBest + ' 分'),
    )
    : h('div', { className: 'dshp-empty-msg', style: { marginTop: '8px' } }, '这一字暂时没有句子，换一个令字试试。'),
   )
  }

