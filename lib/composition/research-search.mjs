// 统一“求证”搜索：优先 DeepSeek/SearXNG/Bing/Wikipedia 的 webAccess，失败再走旧 searchWeb。
export function createResearchSearch(options = {}) {
  const webAccess = options.webAccess ?? null
  const fallbackSearch = typeof options.fallbackSearch === 'function' ? options.fallbackSearch : async () => []
  return async function researchSearch(query, searchOptions = {}) {
    if (webAccess && typeof webAccess.search === 'function') {
      try {
        const results = await webAccess.search(query, {
          limit: 4,
          needContent: true,
          ...(searchOptions && typeof searchOptions === 'object' ? searchOptions : {}),
        })
        if (Array.isArray(results) && results.length > 0) return results
      } catch (error) {
        void error
      }
    }
    return fallbackSearch(query)
  }
}
