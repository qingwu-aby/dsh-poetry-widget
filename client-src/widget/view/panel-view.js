// client-src/widget/view/panel-view.js —— 主面板：标题 / 顶层 tab / 诗词二级导航 / 页脚。
import { h } from '../runtime.js'
import { cx } from '../models/utils.js'
import { POETRY_TABS } from '../models/constants.js'
import { clamp } from '../../base.js'

  export function PanelView(props) {
  const { panelOpen, settings, viewport, pos, mascotSize, panelTab, poetryTab, boot, setPanelOpen, panelTabs, setPoetryTab, openPanelTab, startPoetryTour } = props
   if (!panelOpen || settings.hidden) return null
   const width = Math.min(420, viewport.w - 16)
   const height = Math.min(560, viewport.h - 16)
   let left = pos.x + mascotSize + 12
   if (left + width > viewport.w - 8) left = pos.x - width - 12
   if (left + width > viewport.w - 8) left = viewport.w - width - 8
   left = Math.max(8, left)
   let top = pos.y + mascotSize - height
   top = clamp(top, 8, Math.max(8, viewport.h - height - 8))
   return h(
    'div',
    {
    key: 'panel',
    className: 'dshp-panel',
    role: 'dialog',
    'aria-label': '鲸鱼娘的小角落成长面板',
    style: { left: Math.round(left) + 'px', top: Math.round(top) + 'px' },
    },
    h(
    'div',
    { className: 'dshp-panel-head' },
    h(
     'div',
     { className: 'dshp-panel-title' },
     '鲸鱼娘的小角落',
     h('small', null, panelTab === 'poetry'
      ? '诗词与格律 · 二级菜单'
      : '自驱成长中' + (boot.data && boot.data.dataVersion ? ' · 数据 ' + boot.data.dataVersion : '')),
    ),
    h('button', {
     type: 'button',
     className: 'dshp-icon-btn',
     title: '关闭面板（Esc）',
     'aria-label': '关闭面板',
     onClick: () => setPanelOpen(false),
    }, '×'),
    ),
    h(
    'div',
    { className: 'dshp-tabs', role: 'tablist' },
    (panelTab === 'poetry' ? POETRY_TABS : panelTabs.tabs).map((tab) => h('button', {
     key: tab.id,
     type: 'button',
     role: 'tab',
     'aria-selected': panelTab === 'poetry' ? poetryTab === tab.id : panelTab === tab.id,
     className: cx(
      panelTab === 'poetry' ? 'dshp-subtab' : 'dshp-tab',
      panelTab === 'poetry' ? null : 'dshp-primary-tab',
      (panelTab === 'poetry' ? poetryTab === tab.id : panelTab === tab.id) && 'dshp-is-active',
     ),
     onClick: () => (panelTab === 'poetry' ? setPoetryTab(tab.id) : openPanelTab(tab.id)),
    }, tab.label)),
    ),
    h('div', { className: 'dshp-panel-body' }, props.panelBody),
    h(
     'div',
     { className: 'dshp-panel-foot' },
     panelTab === 'poetry'
      ? [
       h('button', {
        key: 'back',
        type: 'button',
        className: 'dshp-foot-link',
        'aria-label': '返回成长',
        title: '返回成长',
        onClick: () => openPanelTab('growth'),
       }, '← 返回成长'),
       h('button', {
        key: 'tour',
        type: 'button',
        className: 'dshp-foot-link dshp-foot-link-accent',
        'aria-label': '逐页看诗笺',
        title: '以诗笺气泡逐页看今日诗',
        onClick: () => {
         if (typeof startPoetryTour === 'function') startPoetryTour()
        },
       }, '逐页看诗笺'),
      ]
      : [
       h('span', { key: 'hint', className: 'dshp-foot-hint' }, '更多'),
       h('button', {
        key: 'poetry',
        type: 'button',
        className: 'dshp-foot-link',
        'aria-label': '打开诗词二级菜单',
        title: '诗词与格律（二级菜单）',
        onClick: () => openPanelTab('poetry'),
       }, '诗词与格律 ›'),
      ],
    ),
   )
  }

