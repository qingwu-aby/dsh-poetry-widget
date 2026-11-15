// client-src/widget/models/utils.js —— 通用小工具（布局/哈希/错误文案）。
import { clamp } from '../../base.js'

  export function cx() {
  let out = ''
  for (let i = 0; i < arguments.length; i++) {
   const part = arguments[i]
   if (!part) continue
   out = out ? out + ' ' + part : String(part)
  }
  return out
  }

  export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
  }

  /** FNV-1a：用于「按日期确定性挑卡片」，不用于安全场景。 */
  export function hashString(input) {
  const text = String(input == null ? '' : input)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
   hash ^= text.charCodeAt(i)
   hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
  }

  /** 把 "2026-10-21" 显示成 "10 月 21 日"；解析失败时退回本机日期。 */
  export function formatDateLabel(dateStr) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (matched) return Number(matched[2]) + ' 月 ' + Number(matched[3]) + ' 日'
  const now = new Date()
  return now.getMonth() + 1 + ' 月 ' + now.getDate() + ' 日'
  }

  /** 视口内 clamp 的位置（左上角坐标）。 */
  export function clampPosition(position, size, viewport) {
  const maxX = Math.max(8, viewport.w - size - 8)
  const maxY = Math.max(8, viewport.h - size - 8)
  return {
   x: Math.round(clamp(position && position.x, 8, maxX)),
   y: Math.round(clamp(position && position.y, 8, maxY)),
  }
  }

  /** 按吸附模式计算位置：left/right 贴边，free 保留原坐标并 clamp。 */
  export function anchorPosition(snap, size, viewport, previous) {
  const base = clampPosition(previous || { x: 16, y: viewport.h - size - 24 }, size, viewport)
  if (snap === 'left') base.x = 16
  else if (snap === 'right') base.x = Math.max(8, viewport.w - size - 16)
  return base
  }


  /** 把 fetch/数据错误翻译成面向用户的中文提示。 */
  export function describeDataError(error) {
  if (!error) return '诗词数据加载失败，请稍后重试'
  const status = Number(error.status)
  if (status === 404) return '数据接口尚未就绪（宿主半区可能未更新），请稍后重试'
  if (status === 403) return '数据访问被拒绝，请刷新页面后重试'
  if (status === 401) return '会话未授权，请刷新页面后重试'
  const message = String(error.message || '')
  if (/abort|timeout|超时/i.test(message)) return '请求超时，请检查网络后重试'
  if (error.code === 'DATA_UNAVAILABLE') return '诗词数据暂不可用，请稍后重试'
  return '诗词数据加载失败，请稍后重试'
  }
