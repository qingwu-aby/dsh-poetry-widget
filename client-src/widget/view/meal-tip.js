// client-src/widget/view/meal-tip.js —— 饭点提醒气泡。
import { h } from '../runtime.js'
import { clamp } from '../../base.js'

  export function MealTipView(props) {
  const { mealActive, viewport, pos, mascotSize } = props
   if (!mealActive) return null
   const width = Math.min(288, viewport.w - 16)
   let left = pos.x + mascotSize / 2 - width / 2
   left = clamp(left, 8, Math.max(8, viewport.w - width - 8))
   const style = { left: Math.round(left) + 'px', width: Math.round(width) + 'px' }
   const placeAbove = pos.y > Math.min(280, viewport.h * 0.45)
   if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + 'px'
   else style.top = Math.round(pos.y + mascotSize + 10) + 'px'
   return h(
    'div',
    { key: 'meal', className: 'dshp-spont dshp-meal-tip', style, role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'dshp-spont-title' }, '到饭点啦'),
    h('div', { className: 'dshp-spont-sentence' }, String(mealActive.text || '')),
   )
  }

