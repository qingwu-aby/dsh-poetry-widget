// client-src/widget/view/steps/analysis-step.js —— 气泡第 2 张：格律解析。
import { h } from '../../runtime.js'
import { AnalysisBody } from '../primitives.js'
import { PoemFallback } from './poem-step.js'

  export function AnalysisStep(props) {
  const { poem } = props
   if (!poem) return PoemFallback(props)
   return h(
    'div',
    null,
    h('div', { className: 'dshp-muted', style: { fontSize: '11.5px', textAlign: 'center', marginBottom: '4px' } }, (poem.title || '这首诗') + ' · 格律解析'),
    h(AnalysisBody, { poem }),
   )
  }

