// client-src/widget/view/widget-root.js —— 挂件根节点：固定定位 / 隐藏尺寸 / 子节点装配
import { h } from '../runtime.js'
import { Z_INDEX } from '../models/constants.js'
import { WANDER_WALK_MS } from '../../wander.js'

/**
 * 挂件最外层（position: fixed，只有它 pointer-events:auto）。
 * props: { settings, pos, walking, mascotSize, nodes }
 */
export function WidgetRoot(props) {
  const { settings, pos, walking, mascotSize, nodes } = props
  const rootSize = settings.hidden ? 28 : mascotSize
  const rootStyle = {
    position: 'fixed',
    left: Math.round(pos.x) + 'px',
    top: Math.round(pos.y) + 'px',
    transition: walking ? `left ${WANDER_WALK_MS}ms ease-in-out, top ${WANDER_WALK_MS}ms ease-in-out` : 'none',
    width: rootSize + 'px',
    height: rootSize + 'px',
    zIndex: Z_INDEX,
    pointerEvents: 'auto',
    userSelect: 'none',
  }
  return h(
    'div',
    {
      'data-dsh-little-whale': 'root',
      'data-dshp-hidden': settings.hidden ? 'true' : 'false',
      className: 'dshp-root',
      style: rootStyle,
    },
    nodes,
  )
}
