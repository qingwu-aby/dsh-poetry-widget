// client-src/widget/view/restore-hotspot.js —— 隐藏后的恢复热区（长按/双击）。
import { h } from '../runtime.js'

  export function RestoreHotspotView(props) {
  const { handleRestorePointerDown, handleRestorePointerUp, restoreWidget } = props
   return h(
    'div',
    {
    key: 'restore',
    className: 'dshp-restore',
    role: 'button',
    tabIndex: 0,
    title: '双击空白处或长按这里恢复小鲸鱼',
    'aria-label': '恢复小鲸鱼',
    onPointerDown: handleRestorePointerDown,
    onPointerUp: handleRestorePointerUp,
    onPointerCancel: handleRestorePointerUp,
    onDoubleClick: (event) => {
     event.preventDefault()
     event.stopPropagation()
     restoreWidget()
    },
    onKeyDown: (event) => {
     if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      restoreWidget()
     }
    },
    },
    '诗',
   )
  }

