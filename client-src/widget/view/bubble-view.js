// client-src/widget/view/bubble-view.js —— 诗笺气泡：外壳 / 圆点直切 / 底部按钮 / 第 1–6 张内容。
import { h } from '../runtime.js'
import { clamp } from '../../base.js'
import { cx } from '../models/utils.js'
import { STEPS } from '../models/constants.js'

  export function BubbleFooter(props) {
  const { changePoem, settings, poem, activeTodayPoemId, backToToday, advanceStep, openPanel, step } = props
   if (step < 0) return null
   const buttons = []
   if (step === 0) {
    buttons.push(h('button', {
    key: 'next',
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: changePoem,
    title: settings.mode === 'random' ? '随机换一首' : '每日模式：回到今日，再点翻下一首',
    }, '换一首'))
    if (poem && activeTodayPoemId && poem.id !== activeTodayPoemId) {
    buttons.push(h('button', { key: 'today', type: 'button', className: 'dshp-link', onClick: backToToday }, '回到今日'))
    }
   } else {
    buttons.push(h('button', {
    key: 'next',
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: advanceStep,
    }, step >= STEPS.length - 1 ? '收起' : '下一条'))
   }
   buttons.push(h('span', { key: 'spacer', className: 'dshp-spacer' }))
   buttons.push(h('button', {
    key: 'panel',
    type: 'button',
    className: 'dshp-btn',
    onClick: () => openPanel(['today', 'today', 'class', 'yun', 'ci', 'feihua'][step] || 'today'),
   }, '展开面板'))
   return h('div', { className: 'dshp-bubble-foot' }, buttons)
  }

  export function BubbleView(props) {
  const { panelOpen, settings, viewport, pos, mascotSize, setStep, stepContent, step } = props
   if (step < 0 || panelOpen || settings.hidden) return null
   const width = Math.min(304, viewport.w - 16)
   const placeAbove = pos.y > Math.min(300, viewport.h * 0.45)
   const available = placeAbove
    ? Math.max(140, pos.y - 20)
    : Math.max(140, viewport.h - pos.y - mascotSize - 20)
   const bodyMax = Math.max(120, Math.min(380, available - 96))
   let left = pos.x + mascotSize / 2 - width / 2
   left = clamp(left, 8, Math.max(8, viewport.w - width - 8))
   const style = { left: Math.round(left) + 'px', width: Math.round(width) + 'px' }
   if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + 'px'
   else style.top = Math.round(pos.y + mascotSize + 10) + 'px'
   return h(
    'div',
    { key: 'bubble', className: 'dshp-bubble', style, role: 'dialog', 'aria-label': STEPS[step] || '诗词气泡' },
    h(
    'div',
    { className: 'dshp-bubble-head' },
    h(
     'span',
     { className: 'dshp-bubble-title' },
     h('span', { className: 'dshp-bubble-step-name' }, STEPS[step] || '诗词'),
     h('span', { className: 'dshp-progress', 'aria-hidden': 'true' }, (step + 1) + ' / ' + STEPS.length),
     h(
      'span',
      { className: 'dshp-dots', role: 'group', 'aria-label': '切换到指定卡片' },
      STEPS.map((label, index) => h('button', {
      key: label,
      type: 'button',
      className: cx('dshp-dot', index === step && 'dshp-is-active'),
      title: label,
      'aria-label': '切换到第 ' + (index + 1) + ' 张：' + label,
      'aria-current': index === step ? 'step' : undefined,
      onClick: (event) => {
       event.stopPropagation()
       setStep(index)
      },
      })),
      h('button', {
      key: 'collapse',
      type: 'button',
      className: 'dshp-dot dshp-dot-collapse',
      title: '收起气泡',
      'aria-label': '收起气泡',
      onClick: (event) => {
       event.stopPropagation()
       setStep(-1)
      },
      }),
     ),
    ),
    h('button', {
     type: 'button',
     className: 'dshp-icon-btn',
     title: '收起气泡',
     'aria-label': '收起气泡',
     onClick: () => setStep(-1),
    }, '×'),
    ),
    h('div', { className: 'dshp-bubble-body', style: { maxHeight: Math.round(bodyMax) + 'px' } }, stepContent),
    BubbleFooter(props),
   )
  }

