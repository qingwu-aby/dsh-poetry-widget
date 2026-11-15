// client-src/widget/view/toast-view.js —— 轻提示 Toast。
import { h } from '../runtime.js'
import { clamp } from '../../base.js'
import { cx } from '../models/utils.js'

  export function ToastView(props) {
  const { toast, pos, viewport } = props
   if (!toast) return null
   const left = clamp(pos.x, 8, Math.max(8, viewport.w - 280))
   const top = clamp(pos.y - 44, 8, Math.max(8, viewport.h - 72))
   return h('div', {
    key: 'toast',
    className: cx('dshp-toast', toast.kind === 'error' && 'dshp-is-error'),
    role: 'status',
    'aria-live': 'polite',
    style: { left: Math.round(left) + 'px', top: Math.round(top) + 'px' },
   }, toast.text)
  }

