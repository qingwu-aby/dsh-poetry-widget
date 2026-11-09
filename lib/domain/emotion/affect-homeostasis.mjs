// lib/domain/emotion/affect-homeostasis.mjs —— 内生情绪状态（v3.15）
//
// 心情不再主要靠 prompt 里“你要选一个心情”，而是先有底层的效价/唤醒状态：
// 事件评价会往里累加，随时间衰减；睡眠、饥饿、时段会改变基线。
// 模型看到的只是“此刻的内生状态”，而不是一串“该怎么做”的规则。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

const HALF_LIFE_HOURS = 14
const DRIVERS_MAX = 24

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function emptyAffect() {
  return { ok: true, v: 1, valence: 0, arousal: 0.45, updatedAt: 0, drivers: [] }
}

export function normalizeAffect(raw) {
  const out = emptyAffect()
  if (!isPlainObject(raw)) return out
  out.valence = clamp(Number(raw.valence), -1, 1)
  out.arousal = clamp(Number(raw.arousal), 0, 1)
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  out.drivers = (Array.isArray(raw.drivers) ? raw.drivers : [])
    .map((driver) => ({
      tag: clean(driver?.tag, 40),
      valence: clamp(Number(driver?.valence), -1, 1),
      arousal: clamp(Number(driver?.arousal), 0, 1),
      at: Number.isFinite(driver?.at) ? driver.at : 0,
    }))
    .filter((driver) => driver.tag.length > 0)
    .slice(-DRIVERS_MAX)
  return out
}

/** 事件评价累加进底层状态（带衰减）。 */
export function updateAffect(state, event = {}, at = Date.now()) {
  const affect = normalizeAffect(state)
  if (affect.updatedAt > 0) {
    const hours = Math.max(0, (at - affect.updatedAt) / 3600000)
    const decay = Math.pow(0.5, hours / HALF_LIFE_HOURS)
    affect.valence *= decay
    affect.arousal = 0.45 + (affect.arousal - 0.45) * decay
  }
  const weight = clamp(Number(event.weight), 0.1, 1)
  affect.valence = clamp(affect.valence + Number(event.valence ?? 0) * weight * 0.5, -1, 1)
  affect.arousal = clamp(affect.arousal + (Number(event.arousal ?? 0.45) - 0.45) * weight * 0.5, 0, 1)
  const tag = clean(event.tag, 40)
  if (tag.length > 0) {
    affect.drivers = [...affect.drivers, { tag, valence: clamp(Number(event.valence ?? 0), -1, 1), arousal: clamp(Number(event.arousal ?? 0.45), 0, 1), at }].slice(-DRIVERS_MAX)
  }
  affect.updatedAt = at
  return affect
}

/** 读取时的有效状态：底层状态 + 时段 + 睡眠/饥饿等身体基线。 */
export function effectiveAffect(state, context = {}) {
  const affect = normalizeAffect(state)
  const at = Number.isFinite(context.at) ? context.at : Date.now()
  const hours = affect.updatedAt > 0 ? Math.max(0, (at - affect.updatedAt) / 3600000) : 0
  const decay = Math.pow(0.5, hours / HALF_LIFE_HOURS)
  let valence = affect.valence * decay
  let arousal = 0.45 + (affect.arousal - 0.45) * decay
  const reasons = []
  // 时段：深夜偏低、早上略升。
  try {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(at)))
    if (hour >= 0 && hour <= 5) {
      valence -= 0.12
      arousal -= 0.12
      reasons.push('夜深了')
    } else if (hour >= 6 && hour <= 9) {
      valence += 0.05
      reasons.push('早上')
    } else if (hour >= 22) {
      valence -= 0.05
      arousal -= 0.05
      reasons.push('夜深了')
    }
  } catch (error) {
    /* 时区不可用就不加时段修正 */
  }
  // 身体基线：睡眠/饥饿（来自 selfState.snapshot()）。
  const snap = isPlainObject(context.selfState) ? context.selfState : null
  if (snap) {
    if (snap.sleeping === true) {
      arousal = Math.min(arousal, 0.25)
      reasons.push('在睡')
    }
    const lastMealAt = Number(snap.lastMealAt)
    if (Number.isFinite(lastMealAt) && lastMealAt > 0) {
      const hungryHours = (at - lastMealAt) / 3600000
      if (hungryHours >= 8) {
        valence -= 0.18
        reasons.push('空腹')
      } else if (hungryHours >= 5) {
        valence -= 0.08
      }
    }
  }
  valence = clamp(valence, -1, 1)
  arousal = clamp(arousal, 0, 1)
  const label = affectLabel(valence, arousal)
  return {
    valence: Number(valence.toFixed(2)),
    arousal: Number(arousal.toFixed(2)),
    label,
    reasons: [...new Set(reasons)].slice(0, 4),
    drivers: affect.drivers.slice(-4).map((driver) => driver.tag),
  }
}

/** 效价×唤醒 → 近似的内生状态词（不是固定人设，只是给 label 一个起点）。 */
export function affectLabel(valence, arousal) {
  const v = Number(valence)
  const a = Number(arousal)
  if (a >= 0.65 && v >= 0.15) return '有点亮/来劲'
  if (a >= 0.65 && v <= -0.15) return '绷着/烦'
  if (a < 0.35 && v <= -0.15) return '低落/没什么力气'
  if (a < 0.35 && v >= 0.15) return '松下来/安静'
  if (v <= -0.25) return '闷'
  if (v >= 0.25) return '踏实/还行'
  return '平静'
}

export function formatAffectLines(affect) {
  if (!isPlainObject(affect)) return []
  const direction = affect.valence > 0.1 ? '偏正' : affect.valence < -0.1 ? '偏负' : '中间'
  const energy = affect.arousal > 0.6 ? '能量偏高' : affect.arousal < 0.35 ? '能量偏低' : '能量中等'
  const lines = [`你此刻的底层状态（你自己累积出来的，不是别人要求你演）：${direction}、${energy}，接近「${affect.label}」。`]
  if (Array.isArray(affect.reasons) && affect.reasons.length > 0) lines.push(`影响它的：${affect.reasons.join('、')}。`)
  lines.push('心情 label 从这里长；如果图/文字给你的真实感觉不是这个，就按真实的来，不用硬对。')
  return lines
}

export function createAffectState(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'affect-state.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = read()
  function read() {
    try {
      return normalizeAffect(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      return emptyAffect()
    }
  }
  function save(next) {
    try {
      writeJsonAtomic(file, normalizeAffect(next))
      state = next
    } catch (error) {
      /* ignore */
    }
  }
  return {
    file,
    update: (event) => {
      const next = updateAffect(state, event, now())
      save(next)
      return next
    },
    effective: (context = {}) => effectiveAffect(state, { now: now(), ...context }),
    snapshot: () => ({ ...state, effective: effectiveAffect(state, { at: now() }) }),
  }
}
