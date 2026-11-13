// client-src/widget/hooks/use-panel.js —— 主面板/诗词二级菜单路由 + 显隐。
import { getReact } from '../runtime.js'
import { POETRY_ENTRY_ENABLED, POETRY_TABS } from '../models/constants.js'

export function usePanel(deps) {
  const React = getReact()
  const { setStep, updateSettings, panelTabs } = deps
  const { refs } = deps
  const { lastInteractionRef, panelOpensRef } = refs
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelTab, setPanelTab] = React.useState('growth')
  const [poetryTab, setPoetryTab] = React.useState('today')
  function hideWidget() {
   setPanelOpen(false)
   setStep(-1)
   updateSettings({ hidden: true })
  }

  function restoreWidget() {
   updateSettings({ hidden: false })
  }

  function noteInteraction() {
   lastInteractionRef.current = Date.now()
  }

  function openPanelTab(tabId) {
   if (POETRY_TABS.some((item) => item.id === tabId)) {
    setPanelTab('poetry')
    setPoetryTab(tabId)
    return
   }
   if (tabId === 'poetry') {
    setPanelTab('poetry')
    return
   }
   if (panelTabs.isPanelTab(tabId)) {
    setPanelTab(tabId)
    return
   }
   setPanelTab('growth')
  }

  function openPoetryModule() {
   if (!POETRY_ENTRY_ENABLED) return
   openPanelTab('poetry')
   setPanelOpen(true)
  }

  function openSettingsPanel() {
   openPanelTab('settings')
   setPanelOpen(true)
  }

  function openPanel(tab) {
   noteInteraction()
   panelOpensRef.current += 1
   if (tab === 'settings' || tab === 'growth' || tab === 'poetry' || POETRY_TABS.some((item) => item.id === tab)) {
    openPanelTab(tab)
   } else {
    openPanelTab('growth')
   }
   setPanelOpen(true)
  }

  return { panelOpen, setPanelOpen, panelTab, setPanelTab, poetryTab, setPoetryTab, hideWidget, restoreWidget, noteInteraction, openPanelTab, openPoetryModule, openSettingsPanel, openPanel }
}
