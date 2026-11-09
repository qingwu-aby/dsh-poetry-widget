// client-src/local-state.js —— 客户端本地存储状态（位置/立绘彩蛋限频）（W3）
import { num } from './base.js'
import { getStorage } from './data.js'
import { shanghaiParts } from './mood-engine.js'

export const POS_KEY = 'dshp.position.v1'
export const MASCOT_EGG_KEY = 'dshp-mascot-egg-v1'

export function normalizeMascotEggState(raw, now) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const dateKey = shanghaiParts(now).dateKey
  const sameDay = source.date === dateKey
  return {
    date: dateKey,
    greeted: sameDay ? source.greeted === true : false,
    greetAt: sameDay ? num(source.greetAt, 0) : 0,
    idleAt: num(source.idleAt, 0),
  }
}

export function readMascotEggState(now) {
  const storage = getStorage()
  if (!storage) return normalizeMascotEggState(null, now)
  try {
    const raw = storage.getItem(MASCOT_EGG_KEY)
    return normalizeMascotEggState(raw ? JSON.parse(raw) : null, now)
  } catch {
    return normalizeMascotEggState(null, now)
  }
}

export function writeMascotEggState(state) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(MASCOT_EGG_KEY, JSON.stringify(state))
  } catch {
    /* 配额/隐私模式：忽略 */
  }
}

export function recordMascotEgg(state, patch, now) {
  const base = normalizeMascotEggState(state, now)
  const time = num(now, Date.now())
  return {
    date: base.date,
    greeted: base.greeted || Boolean(patch && patch.greet),
    greetAt: patch && patch.greet ? time : base.greetAt,
    idleAt: patch && patch.idle ? time : base.idleAt,
  }
}

export function readStoredPosition() {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(POS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Number.isFinite(Number(parsed.x)) || !Number.isFinite(Number(parsed.y))) return null
    return {
      x: Number(parsed.x),
      y: Number(parsed.y),
      snap: parsed.snap === 'right' || parsed.snap === 'free' ? parsed.snap : 'left',
    }
  } catch {
    return null
  }
}

export function writeStoredPosition(position) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      POS_KEY,
      JSON.stringify({
        x: Math.round(position.x),
        y: Math.round(position.y),
        snap: position.snap,
      }),
    )
  } catch {
    /* ignore */
  }
}
