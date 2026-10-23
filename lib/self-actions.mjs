// lib/self-actions.mjs —— 自主行为循环（契约 v1.36 §2.20，task-62）。
//
// 用户要求「行为自驱、不被定义」：即使没有用户请求/工具事件，挂件也按自己的内在状态
// 自己决定吃喝玩乐睡觉/醒来，并把做过的动作记在 self-actions.json（环形 50 条）。
//
// 规则（每 60s tick，每次最多一个动作，距上次动作 ≥3min）：
//   · 睡着且 energy≥75 → 醒来；
//   · 醒着且 energy≤20 → 去睡；
//   · 醒着按需求优先级：hunger≥75 吃 → thirst≥70 喝 → curiosity≥80 玩 → social≥80 冒泡。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { resolveSelfStatePath } from './self-state.mjs'

/** 动作最小间隔。 */
export const SELF_ACTIONS_MIN_GAP_MS = 3 * 60 * 1000
/** 动作环形保留条数。 */
export const SELF_ACTIONS_MAX_ENTRIES = 50
/** 动作循环 tick 间隔。 */
export const SELF_ACTIONS_TICK_MS = 60 * 1000

/** 行为文案（第一人称短句）。 */
export const SELF_ACTION_TEXTS = Object.freeze({
  eat: '有点饿了，我去吃两口。',
  drink: '渴了，去喝口水。',
  sleep: '困了，先眯一会儿。',
  wake: '睡醒了，伸个懒腰。',
  play: '想玩一下，活动活动。',
  socialize: '有点想被看见，冒个泡。',
})

/** 行为标签。 */
export const SELF_ACTION_LABELS = Object.freeze({
  eat: '吃',
  drink: '喝',
  sleep: '睡',
  wake: '醒',
  play: '玩',
  socialize: '冒泡',
})

/** 行为 → state 事件名。 */
const ACTION_STATE_EVENTS = Object.freeze({
  eat: 'eat',
  drink: 'drink',
  sleep: 'sleep',
  wake: 'wake',
  play: 'actPlay',
  socialize: 'socialize',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** 动作文件路径：与 self-state.json 同目录（`.dsh-poetry/self-actions.json`）。 */
export function resolveSelfActionsPath(env = process.env, home = null) {
  return path.join(path.dirname(resolveSelfStatePath(env, home)), 'self-actions.json')
}

/** 校验单条动作；非法返回 null。 */
export function normalizeSelfAction(raw) {
  if (!isPlainObject(raw)) return null
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : ''
  if (!Object.hasOwn(SELF_ACTION_TEXTS, kind)) return null
  const id = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim().slice(0, 80) : ''
  if (id.length === 0) return null
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim().slice(0, 8) : SELF_ACTION_LABELS[kind]
  const text = clampText(typeof raw.text === 'string' && raw.text.trim().length > 0 ? raw.text.trim() : SELF_ACTION_TEXTS[kind], 120)
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0 ? raw.at : null
  if (at === null) return null
  return { id, kind, label, text, at }
}

/** 校验动作文件；坏内容返回空数组。 */
export function normalizeSelfActionsFile(raw, maxEntries = SELF_ACTIONS_MAX_ENTRIES) {
  if (!isPlainObject(raw) || raw.ok !== true || raw.v !== 1 || !Array.isArray(raw.actions)) return []
  const out = []
  for (const item of raw.actions) {
    const action = normalizeSelfAction(item)
    if (action === null) continue
    out.push(action)
  }
  return out.slice(-Math.max(1, maxEntries))
}

/**
 * 根据内在状态决定下一个动作 kind（纯函数；优先级见模块注释）。
 * @param {object} snapshot self-state snapshot
 * @returns {'wake'|'sleep'|'eat'|'drink'|'play'|'socialize'|null}
 */
export function chooseSelfAction(snapshot) {
  const state = isPlainObject(snapshot) ? snapshot : {}
  const energy = typeof state.energy === 'number' ? state.energy : 0
  const hunger = typeof state.hunger === 'number' ? state.hunger : 0
  const thirst = typeof state.thirst === 'number' ? state.thirst : 0
  const curiosity = typeof state.curiosity === 'number' ? state.curiosity : 0
  const social = typeof state.social === 'number' ? state.social : 0
  if (state.sleeping === true) {
    return energy >= 75 ? 'wake' : null
  }
  if (energy <= 20) return 'sleep'
  if (hunger >= 75) return 'eat'
  if (thirst >= 70) return 'drink'
  if (curiosity >= 80) return 'play'
  if (social >= 80) return 'socialize'
  return null
}

/**
 * 创建自主行为循环。
 * @param {{
 *   state: {snapshot: Function, applyEvent: Function},
 *   actionsPath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   minGapMs?: number,
 *   maxEntries?: number,
 *   tickIntervalMs?: number,
 * }} options
 */
export function createSelfActions(options) {
  const state = options.state
  const file = path.resolve(options.actionsPath ?? resolveSelfActionsPath(options.env, options.home))
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const minGapMs =
    Number.isFinite(options.minGapMs) && options.minGapMs >= 0 ? options.minGapMs : SELF_ACTIONS_MIN_GAP_MS
  const maxEntries =
    Number.isFinite(options.maxEntries) && options.maxEntries > 0
      ? Math.floor(options.maxEntries)
      : SELF_ACTIONS_MAX_ENTRIES
  const tickIntervalMs =
    Number.isFinite(options.tickIntervalMs) && options.tickIntervalMs > 0 ? options.tickIntervalMs : SELF_ACTIONS_TICK_MS

  /** @type {Array<{id:string,kind:string,label:string,text:string,at:number}>} 旧→新 */
  const actions = []
  let counter = 0
  let timer = null
  let disposed = false

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function info(message) {
    try {
      logger?.info?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  /** 启动时读取已有动作（环形 50；坏文件→空）。 */
  function load() {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      const loaded = normalizeSelfActionsFile(raw, maxEntries)
      actions.length = 0
      for (const action of loaded) actions.push(action)
      counter = actions.length
      return { ok: true, count: actions.length }
    } catch {
      actions.length = 0
      return { ok: false, count: 0 }
    }
  }

  function persist(atNow) {
    try {
      writeJsonAtomic(file, { ok: true, v: 1, updatedAt: atNow, actions: [...actions] })
      return { ok: true }
    } catch (error) {
      warn(`自主行为写入失败：${shortMessage(error)}`)
      return { ok: false, message: shortMessage(error) }
    }
  }

  function lastActionAt(snapshot) {
    let latest = typeof snapshot?.lastActionAt === 'number' ? snapshot.lastActionAt : 0
    if (actions.length > 0) latest = Math.max(latest, actions[actions.length - 1].at)
    return latest
  }

  /**
   * 执行一次自主行为判断（每次 tick 最多一个动作）。
   * @param {number} [atNow]
   * @returns {{ok:boolean, skipped?:boolean, reason?:string, action?:object}}
   */
  function tick(atNow) {
    if (disposed) return { ok: false, reason: 'disposed' }
    try {
      const at = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
      const snapshot = state.snapshot()
      const previousAt = lastActionAt(snapshot)
      if (previousAt > 0 && at - previousAt < minGapMs) {
        return { ok: true, skipped: true, reason: 'min-gap' }
      }
      const kind = chooseSelfAction(snapshot)
      if (kind === null) return { ok: true, skipped: true, reason: 'no-need' }

      counter += 1
      const action = {
        id: `act-${at}-${counter}`,
        kind,
        label: SELF_ACTION_LABELS[kind],
        text: SELF_ACTION_TEXTS[kind],
        at,
      }
      actions.push(action)
      while (actions.length > maxEntries) actions.shift()
      try {
        state.applyEvent(ACTION_STATE_EVENTS[kind], at)
      } catch (error) {
        warn(`自主行为状态更新失败：${shortMessage(error)}`)
      }
      persist(at)
      info(`自主行为：${action.text}`)
      return { ok: true, action }
    } catch (error) {
      warn(`自主行为 tick 失败：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    }
  }

  function snapshot() {
    const recent = actions.slice(-5).reverse()
    return { latest: actions.length > 0 ? { ...actions[actions.length - 1] } : null, recent: recent.map((action) => ({ ...action })) }
  }

  /** 启动 60s 循环（首次动作在第一个 tick 后产生）。 */
  function start() {
    if (disposed || timer !== null) return
    load()
    timer = setInterval(() => {
      try {
        tick()
      } catch {
        /* ignore */
      }
    }, tickIntervalMs)
    timer.unref?.()
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    actionsPath: file,
    tick,
    load,
    snapshot,
    start,
    stop,
    dispose,
    actions: () => actions.map((action) => ({ ...action })),
  }
}
