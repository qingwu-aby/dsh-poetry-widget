// client-src/resources.js —— 数据资源缓存（bootstrap/诗歌/词/知识/韵部等）（W3）
export const RESOURCE_CACHE_KEYS = ['poems', 'ci', 'yun', 'knowledge', 'anthology', 'bank', 'pingshui', 'ciBank', 'moodCatalog']

export function createResourceStore(deps) {
  const cache = Object.fromEntries(RESOURCE_CACHE_KEYS.map((key) => [key, null]))
  const inflight = Object.fromEntries(RESOURCE_CACHE_KEYS.map((key) => [key, null]))
  let assetDataVersion = ''

  function setAssetDataVersion(version) {
    const next = version == null ? '' : String(version)
    if (next === assetDataVersion) return
    assetDataVersion = next
    deps.clearFeihuaFullCache()
    deps.clearPetMediaCache()
    for (const kind of ['anthology', 'bank', 'pingshui', 'ciBank', 'moodCatalog']) {
      cache[kind] = null
      inflight[kind] = null
    }
  }

  function clear(kind) {
    deps.clearFeihuaIndexCache()
    deps.clearFeihuaFullCache()
    deps.clearPetMediaCache()
    if (kind) {
      cache[kind] = null
      inflight[kind] = null
      return
    }
    for (const key of RESOURCE_CACHE_KEYS) {
      cache[key] = null
      inflight[key] = null
    }
  }

  function load(kind) {
    const assetFile = deps.assetDataFiles[kind]
    if (!assetFile && !deps.resourcePaths[kind]) return Promise.reject(new Error('未知数据类型：' + kind))
    if (cache[kind]) return Promise.resolve(cache[kind])
    if (!inflight[kind]) {
      const url = assetFile ? deps.assetUrlFor(kind, assetDataVersion) : deps.route + deps.resourcePaths[kind]
      inflight[kind] = deps.fetchJsonUrl(url).then(
        (data) => {
          cache[kind] = data
          inflight[kind] = null
          return data
        },
        (error) => {
          inflight[kind] = null
          throw error
        },
      )
    }
    return inflight[kind]
  }

  return {
    setAssetDataVersion,
    clear,
    load,
    get: (kind) => cache[kind] || null,
  }
}
