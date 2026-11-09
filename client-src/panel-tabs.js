// client-src/panel-tabs.js —— 面板顶层 tab 注册表（W3）
export const PANEL_TAB_DEFS = Object.freeze([
  { id: 'growth', label: '成长' },
  { id: 'graph', label: '图谱' },
  { id: 'settings', label: '设置' },
])

/**
 * @param {{ GrowthTab: Function, GraphTab: Function, SettingsTab: Function }} components
 */
export function createPanelTabRouter(components) {
  const byId = new Map([
    ['growth', components.GrowthTab],
    ['graph', components.GraphTab],
    ['settings', components.SettingsTab],
  ])
  return {
    tabs: PANEL_TAB_DEFS,
    isPanelTab: (id) => byId.has(id),
    componentFor: (id) => byId.get(id) ?? components.GrowthTab,
  }
}
