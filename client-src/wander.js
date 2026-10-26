// client-src/wander.js —— 窗口溜达（位置选择 + 跑步/运动素材），v1.75 从 client.js 抽出。
import { clamp, isVideoMoodFile, num } from './base.js'

// v1.64：她可以在窗口里自己溜达（贴边走走，不挡聊天输入框）。
// v1.70：用户要求“先别让她在窗口到处跑” → 窗口溜达暂时关掉；改成 true 即可恢复。
// （互联网上的溜达不受影响，仍按 3h/8h 的节奏。）
export const WINDOW_WANDER_ENABLED = false
export const WANDER_TICK_MS = 60 * 1000
export const WANDER_FIRST_MIN_MS = 45 * 1000
export const WANDER_FIRST_MAX_MS = 2 * 60 * 1000
export const WANDER_MIN_INTERVAL_MS = 2 * 60 * 1000
export const WANDER_MAX_INTERVAL_MS = 5 * 60 * 1000
export const WANDER_WALK_MS = 8 * 1000
export const WANDER_MIN_DISTANCE = 120
export const WANDER_INTERACTION_PAUSE_MS = 45 * 1000
// v1.65：走动时只能调用「跑步/运动」相关素材（找不到就退回跑步静态图）。
export const WANDER_MEDIA_PATTERN = /跑|奔|踏步|踱步|走路|跳跃|踢|抛接|伸懒腰|运动|锻炼|健身/
export const WANDER_STATIC_FILE = 'dsh-whale-state-running.webp'

/** 从 dsh-pet 动画里挑一个跑步/运动类素材；没有就退回跑步静态立绘。 */
export function pickWanderMedia(entries, random) {
const list = Array.isArray(entries)
 ? entries.filter(
   (entry) =>
    entry && typeof entry.file === 'string' && isVideoMoodFile(entry.file) && WANDER_MEDIA_PATTERN.test(entry.file),
 )
 : []
if (list.length === 0) return { file: WANDER_STATIC_FILE, video: false }
const roll = Number(typeof random === 'function' ? random() : Math.random())
const index = Number.isFinite(roll) ? Math.min(list.length - 1, Math.max(0, Math.floor(roll * list.length))) : 0
return { file: list[index].file, video: true }
}

/** 她「在窗口里溜达」时的目标点：贴着边缘走，避开底部中间的聊天输入框。 */
export function nextWanderTarget(input) {
const opts = input && typeof input === 'object' ? input : {}
const viewport = opts.viewport && typeof opts.viewport === 'object' ? opts.viewport : {}
const size = Math.max(40, Math.round(num(opts.size, 120)))
const w = Math.max(size + 40, Math.round(num(viewport.w, 1024)))
const h = Math.max(size + 80, Math.round(num(viewport.h, 768)))
const margin = 8
const minX = margin
const maxX = Math.max(minX, w - size - margin)
const minY = 56
const maxY = Math.max(minY, h - size - margin)
const random = typeof opts.random === 'function' ? opts.random : Math.random
const rand = () => {
 const value = Number(random())
 return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0
}
const pick = (lo, hi) => Math.round(lo + (Math.max(lo, hi) - lo) * rand())
const current = opts.current && typeof opts.current === 'object' ? opts.current : null
const farEnough = (point) =>
 current === null || Math.hypot(point.x - num(current.x, 0), point.y - num(current.y, 0)) >= WANDER_MIN_DISTANCE
const candidates = []
for (let attempt = 0; attempt < 10; attempt += 1) {
 const roll = rand()
 if (roll < 0.3) {
  candidates.push({ x: minX, y: pick(minY, maxY), edge: 'left' })
 } else if (roll < 0.6) {
  candidates.push({ x: maxX, y: pick(minY, maxY), edge: 'right' })
 } else if (roll < 0.85) {
  const leftBand = rand() < 0.5
  const xLo = leftBand ? minX : Math.round(w * 0.7)
  const xHi = leftBand ? Math.round(w * 0.3) : maxX
  candidates.push({ x: pick(xLo, xHi), y: maxY, edge: 'bottom' })
 } else {
  const leftBand = rand() < 0.5
  const xLo = leftBand ? minX : Math.round(w * 0.7)
  const xHi = leftBand ? Math.round(w * 0.3) : maxX
  candidates.push({ x: pick(xLo, xHi), y: minY, edge: 'top' })
 }
}
const chosen = candidates.find(farEnough) || candidates[candidates.length - 1]
return { x: Math.round(clamp(chosen.x, minX, maxX)), y: Math.round(clamp(chosen.y, minY, maxY)), edge: chosen.edge }
}
