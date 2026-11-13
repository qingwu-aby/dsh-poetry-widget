// client-src/widget/view/spont-view.js —— 自言自语卡片（思考占位 / 模型 murmur / 诗句彩蛋）。
import { h } from '../runtime.js'
import { clamp } from '../../base.js'

  export function SpontView(props) {
  const { spontPoem, settings, panelOpen, step, spontPreview, viewport, pos, mascotSize, openSpontPoem, readAnotherSpontaneous, closeSpont } = props
   if (!spontPoem || settings.hidden || (panelOpen && !spontPreview) || (!spontPreview && step >= 0)) return null
   const width = Math.min(288, viewport.w - 16)
   let left = pos.x + mascotSize / 2 - width / 2
   left = clamp(left, 8, Math.max(8, viewport.w - width - 8))
   const placeAbove = pos.y > Math.min(280, viewport.h * 0.45)
   const style = { left: Math.round(left) + 'px', width: Math.round(width) + 'px' }
   if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + 'px'
   else style.top = Math.round(pos.y + mascotSize + 10) + 'px'
   if (spontPoem.type === 'thinking') {
    return h(
     'div',
     { key: 'spont', className: 'dshp-spont', style, role: 'status', 'aria-live': 'polite' },
     h('div', { className: 'dshp-spont-title' }, '它正在想…'),
     h('div', { className: 'dshp-spont-thinking' }, '稍等一下下…'),
     h(
      'div',
      { className: 'dshp-spont-actions' },
      h('button', {
       type: 'button',
       className: 'dshp-btn dshp-btn-small',
       onClick: (event) => closeSpont(event),
      }, '关闭'),
     ),
    )
   }
   const isPoemCard = spontPoem.type !== 'murmur'
   const sentenceProps = { className: 'dshp-spont-sentence' }
   if (isPoemCard) {
    sentenceProps.role = 'button'
    sentenceProps.tabIndex = 0
    sentenceProps.title = '在面板里查看整首'
    sentenceProps.onClick = (event) => {
     event.stopPropagation()
     openSpontPoem()
    }
    sentenceProps.onKeyDown = (event) => {
     if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      openSpontPoem()
     }
    }
   }
   return h(
    'div',
    { key: 'spont', className: 'dshp-spont', style, role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'dshp-spont-title' }, spontPoem.tag === 'action' ? '自己' : '它说：'),
    spontPoem.type === 'hybrid' && spontPoem.prefix
     ? h('div', { className: 'dshp-spont-prefix' }, String(spontPoem.prefix))
     : null,
    h('div', sentenceProps, String(spontPoem.line || '')),
    isPoemCard && spontPoem.label
     ? h('div', { className: 'dshp-spont-source' }, '—— ' + spontPoem.label)
     : null,
    h(
    'div',
    { className: 'dshp-spont-actions' },
    h('button', {
     type: 'button',
     className: 'dshp-btn dshp-btn-small',
     onClick: (event) => {
      event.stopPropagation()
      readAnotherSpontaneous()
     },
    }, '再说一句'),
    h('button', {
     type: 'button',
     className: 'dshp-btn dshp-btn-small',
     onClick: (event) => closeSpont(event),
    }, '关闭'),
    ),
   )
  }
