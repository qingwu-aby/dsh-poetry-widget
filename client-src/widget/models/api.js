// client-src/widget/models/api.js —— 数据 URL / 设置写回（PUT settings.json）。
import { createFetchJson } from '../../data.js'
import { buildSettingsRequest } from '../../settings-model.js'
import { ASSET_DATA_FILES, ROUTE } from './constants.js'

let bootstrapCache = null

  export function assetUrlFor(kind, version) {
  const file = ASSET_DATA_FILES[kind]
  if (!file) return ''
  return '/api/dsh-poetry/assets?f=' + file + '&v=' + encodeURIComponent(String(version == null ? '' : version))
  }

  
  
  
  
  
  
  
  
  /** 平水韵数据 → 索引（categories 与 charIndex 双驱动，charIndex 缺省时从 chars 反推）。 */
  export const fetchJson = createFetchJson(ROUTE)

  export function putSettings(patch) {
  const request = buildSettingsRequest(patch)
  return fetchJson('settings.json', request.init).then((data) => {
   if (bootstrapCache && data && data.settings) {
    bootstrapCache = Object.assign({}, bootstrapCache, { settings: data.settings })
   }
   return data
  })
  }
