// client-src/widget/view/steps/knowledge-step.js —— 气泡第 3 张：今日知识卡。
import { h } from '../../runtime.js'
import { EmptyState, KnowledgeCardView, LoadingState } from '../primitives.js'
import { describeDataError } from '../../models/utils.js'
import { hashString } from '../../models/utils.js'

  export function KnowledgeStep(props) {
  const { knowledgeRes, reloadKnowledge, dateSeed } = props
   const resource = knowledgeRes
   if (resource.status === 'error') {
    return h(EmptyState, {
    title: '格律知识卡暂时不可用',
    message: describeDataError(resource.error),
    onRetry: () => reloadKnowledge().catch(() => {}),
    })
   }
   const cards = resource.data && Array.isArray(resource.data.cards) ? resource.data.cards : []
   if (!cards.length) {
    if (resource.status === 'ready') {
    return h(EmptyState, {
     title: '知识卡尚未就绪',
     message: '数据文件中还没有课堂内容，稍后再来看看。',
     onRetry: () => reloadKnowledge().catch(() => {}),
    })
    }
    return h(LoadingState, { text: '正在载入格律知识卡…' })
   }
   const index = Math.abs(hashString(dateSeed + '|knowledge')) % cards.length
   return h(
    'div',
    null,
    h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '今日知识卡 · 第 ' + (index + 1) + ' / ' + cards.length + ' 张'),
    h(KnowledgeCardView, { card: cards[index] }),
   )
  }

