// client-src/library.js —— 诗库数据合并/筛选/分页（v1.77 从 client.js 抽出）。
import { num } from './base.js'

export const LIBRARY_CATEGORY_ALIASES = { 诗经: 'shijing', 楚辞: 'chuci', 千家诗: 'qianjiashi', 唐诗三百首: 'tang300', 全唐诗精选: 'bank', 宋词精选: 'ci-selected', 宋词全库: 'ci-bank' }
export const LIBRARY_PAGE = 30

export function libraryCategoryOf(item, kind) {
if (kind === 'bank') return 'bank'
const raw = String(item && item.category != null ? item.category : '').trim()
if (LIBRARY_CATEGORY_ALIASES[raw]) return LIBRARY_CATEGORY_ALIASES[raw]
for (const label of Object.keys(LIBRARY_CATEGORY_ALIASES)) {
 if (raw.indexOf(label) >= 0) return LIBRARY_CATEGORY_ALIASES[label]
}
return ''
}

export function buildLibraryItems(anthologyData, bankData, ciBankData, ciSelectedData) {
const out = []
for (const item of anthologyData && Array.isArray(anthologyData.items) ? anthologyData.items : []) {
 if (!item) continue
 const categoryId = libraryCategoryOf(item, 'anthology')
 if (!categoryId) continue
 out.push(Object.assign({}, item, { categoryId, source: 'anthology' }))
}
for (const item of bankData && Array.isArray(bankData.items) ? bankData.items : []) {
 if (!item) continue
 out.push(Object.assign({}, item, { categoryId: 'bank', source: 'bank' }))
}
for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
 if (!item) continue
 out.push(Object.assign({}, item, { categoryId: 'ci-bank', source: 'ci-bank' }))
}
for (const item of ciSelectedLibraryItems(ciSelectedData)) out.push(item)
return out
}

export function ciSelectedLibraryItems(ciData) {
const out = []
for (const item of ciData && Array.isArray(ciData.items) ? ciData.items : []) {
 if (!item || !item.id) continue
 const rhythmic = String(item.rhythmic || '')
 const firstLine = String((Array.isArray(item.lines) && item.lines[0]) || '')
 const first = firstLine.replace(/[，。！？；、：,.!?;:·\s]/g, '').slice(0, 24)
 const title = rhythmic ? rhythmic + '·' + (first || '无题') : String(item.title || first || '无题')
 out.push({
  id: String(item.id),
  author: String(item.author || ''),
  rhythmic,
  title,
  lines: Array.isArray(item.lines) ? item.lines : [],
  categoryId: 'ci-selected',
  source: 'ci-selected',
 })
}
return out
}

export function ciSelectedRhythmics(ciData) {
const map = {}
for (const item of ciData && Array.isArray(ciData.items) ? ciData.items : []) {
 const name = item && item.rhythmic ? String(item.rhythmic) : ''
 if (!name) continue
 map[name] = (map[name] || 0) + 1
}
return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
}

export function ciBankRhythmics(ciBankData) {
const map = {}
for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
 const name = item && item.rhythmic ? String(item.rhythmic) : ''
 if (!name) continue
 map[name] = (map[name] || 0) + 1
}
return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
}

export function filterLibraryItems(items, category, query, rhythmic) {
const cat = category && category !== 'all' ? category : 'all'
const keyword = String(query == null ? '' : query).trim().toLowerCase()
const rhythm = rhythmic ? String(rhythmic) : ''
return (Array.isArray(items) ? items : []).filter((item) => {
 if (!item) return false
 if (cat !== 'all' && item.categoryId !== cat) return false
 if (rhythm && String(item.rhythmic || '') !== rhythm) return false
 if (!keyword) return true
 const hay = String(item.title || '') + ' ' + String(item.author || '') + ' ' + (Array.isArray(item.lines) ? item.lines.join('') : '')
 return hay.toLowerCase().indexOf(keyword) >= 0
})
}

export function libraryPage(items, visible) {
return (Array.isArray(items) ? items : []).slice(0, Math.max(0, Math.floor(num(visible, LIBRARY_PAGE))))
}

export function libraryItemLabel(item) {
const title = item && item.title ? String(item.title) : '无题'
const author = item && item.author ? String(item.author) : ''
return author ? author + '《' + title + '》' : '《' + title + '》'
}
