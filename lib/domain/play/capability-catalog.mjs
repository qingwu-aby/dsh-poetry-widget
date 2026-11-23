// @ts-check
// 宿主预置原语目录：审批通过后开放给 World；不自动生成代码。
export const PRIMITIVE_CATALOG = Object.freeze([
  {
    name: 'mc_water',
    capability: 'mc_water',
    description: '给附近耕地浇水：没有水桶时先找水源装水，再把水放到干燥耕地旁。',
    parameters: { type: 'object', properties: {} },
    implemented: true,
  },
  {
    name: 'mc_shear',
    capability: 'mc_shear',
    description: '给附近的羊剪羊毛：需要剪刀。',
    parameters: { type: 'object', properties: {} },
    implemented: true,
  },
  {
    name: 'mc_milk',
    capability: 'mc_milk',
    description: '给附近的牛挤奶：需要桶。',
    parameters: { type: 'object', properties: {} },
    implemented: true,
  },
  {
    name: 'mc_feed_animal',
    capability: 'mc_feed_animal',
    description: '用背包里的食物喂附近的牛/猪/羊/鸡，促成繁殖。',
    parameters: { type: 'object', properties: {} },
    implemented: true,
  },
])
const CATALOG_BY_NAME = new Map(PRIMITIVE_CATALOG.map((entry) => [entry.name, entry]))
export const CATALOG_TOOL_NAMES = Object.freeze(PRIMITIVE_CATALOG.map((entry) => entry.name))
export function isCatalogTool(name) { return CATALOG_BY_NAME.has(String(name || '')) }
export function catalogEntry(name) { return CATALOG_BY_NAME.get(String(name || '')) ?? null }
export function approvedCatalogNames(proposals) {
  const approved = new Set()
  if (!proposals || typeof proposals.list !== 'function') return approved
  try {
    for (const item of proposals.list().items || []) {
      if (item && (item.status === 'approved' || item.status === 'implemented') && isCatalogTool(item.capability)) approved.add(item.capability)
    }
  } catch (error) { void error }
  return approved
}
