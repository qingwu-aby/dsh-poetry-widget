// client-src/widget/view/steps/ci-step.js —— 气泡第 5 张：词牌名篇。
import { h } from '../../runtime.js'
import { CiBody, EmptyState, LoadingState } from '../primitives.js'
import { describeDataError, hashString } from '../../models/utils.js'

  export function CiStep(props) {
  const { reloadKnowledge, ciRes, reloadCi, dateSeed, knowledgeRes } = props
   const knowledge = knowledgeRes
   if (knowledge.status === 'error') {
    return h(EmptyState, {
    title: '词牌数据暂时不可用',
    message: describeDataError(knowledge.error),
    onRetry: () => reloadKnowledge().catch(() => {}),
    })
   }
   if (ciRes.status === 'error') {
    return h(EmptyState, {
    title: '名篇词暂时不可用',
    message: describeDataError(ciRes.error),
    onRetry: () => reloadCi().catch(() => {}),
    })
   }
   const ciCards = knowledge.data && Array.isArray(knowledge.data.ciCards) ? knowledge.data.ciCards : []
   if (!ciCards.length) {
    if (knowledge.status === 'ready') {
    return h(EmptyState, {
     title: '词牌卡尚未就绪',
     message: '数据文件中还没有词牌内容，稍后再试。',
     onRetry: () => reloadKnowledge().catch(() => {}),
    })
    }
    return h(LoadingState, { text: '正在载入词牌…' })
   }
   const index = Math.abs(hashString(dateSeed + '|ci')) % ciCards.length
   const card = ciCards[index] || {}
   const ciItems = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : []
   const matched = ciItems.filter((item) => item && item.rhythmic && item.rhythmic === card.name)
   const ci = matched.length
    ? matched[Math.abs(hashString(dateSeed + '|ciname')) % matched.length]
    : (ciItems.length ? ciItems[Math.abs(hashString(dateSeed + '|ciany')) % ciItems.length] : null)
   const meta = h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-summary' }, '词牌名篇 · 第 ' + (index + 1) + ' / ' + ciCards.length + ' 个词牌'),
    h(
    'div',
    { className: 'dshp-card-title' },
    String(card.name || '词牌'),
    Array.isArray(card.aliases) && card.aliases.length
     ? h('span', { className: 'dshp-muted', style: { fontSize: '11.5px', fontWeight: 400 } }, '（' + card.aliases.join('、') + '）')
     : null,
    ),
    card.form
    ? h('div', { className: 'dshp-p dshp-muted' }, String(card.form) + (card.rhyme ? ' · ' + String(card.rhyme) : ''))
    : null,
    card.example
    ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-note' }, '代表名句'), h('div', { className: 'dshp-example-text' }, String(card.example)))
    : null,
   )
   if (!ci) {
    return h(
    'div',
    null,
    meta,
    ciRes.status === 'ready'
     ? h('div', { className: 'dshp-empty-msg', style: { marginTop: '8px' } }, '名篇词暂时没有匹配到这一词牌。')
     : h(LoadingState, { text: '正在载入名篇词…' }),
    )
   }
   return h('div', null, meta, h('div', { className: 'dshp-subtitle' }, '名篇词'), h(CiBody, { ci }))
  }

