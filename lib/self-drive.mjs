// lib/self-drive.mjs —— 她自己的「自处」：由她判断此刻状态与想做什么（v1.51，M62）。
//
// 用户：内在状态不应该被量化，行为也不该由 `hunger >= 75` 这种阈值替她决定。
// 所以 v2 的做法是：host 只记录**事实**（上次吃/喝/玩/说话/睡醒的时间），每隔一阵（15–30 分钟）
// 把事实交给她自己的模型，让她写一句「我此刻是什么状态」，并自己决定现在想做什么（或什么都不做）。
// 没有分数、没有优先级表；模型不可用时保持上次的状态，什么都不做（不退回数值规则）。
import { naturalStyleLines } from './language-style.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { describeModelRequest, recordModelFailure } from './model-errors.mjs'
import { describeTimeline, formatBeingLine } from './self-being.mjs'
import {
  SELF_ACTION_KIND_PATTERN,
  SELF_ACTION_LABELS,
  SELF_ACTION_TEXTS,
  SELF_ACTIONS_MAX_ENTRIES,
  SELF_ACTIONS_MIN_GAP_MS,
  normalizeSelfActionsFile,
  resolveSelfActionsPath,
} from './self-actions.mjs'

/** 两次「自处」检查的间隔（毫秒；模型自己决定状态/动作，不按需求阈值）。 */
export const SELF_DRIVE_CHECK_MIN_MS = 15 * 60 * 1000
export const SELF_DRIVE_CHECK_MAX_MS = 30 * 60 * 1000
/** 失败后的重试间隔。 */
export const SELF_DRIVE_RETRY_MIN_MS = 5 * 60 * 1000
export const SELF_DRIVE_RETRY_MAX_MS = 10 * 60 * 1000
/** 启动后第一次「自处」的延迟（先让宿主安静下来）。 */
export const SELF_DRIVE_FIRST_MIN_MS = 30 * 1000
export const SELF_DRIVE_FIRST_MAX_MS = 90 * 1000
/** tick 间隔。 */
export const SELF_DRIVE_TICK_MS = 60 * 1000
/** 会改变时间线/睡眠的动作子集（其余动作只作为“她做了什么”记录）。 */
export const SELF_DRIVE_ACTIONS = Object.freeze(['eat', 'drink', 'play', 'socialize', 'sleep', 'wake', 'learn'])
/** 动作 → state 事件（learn 由 growth 自己记 lastLearnAt，不在这里重复）。 */
const ACTION_EVENTS = Object.freeze({
  eat: 'eat',
  drink: 'drink',
  play: 'actPlay',
  socialize: 'socialize',
  sleep: 'sleep',
  wake: 'wake',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(text, max)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function extractJson(text) {
  const body = typeof text === 'string' ? text.trim() : ''
  if (body.length === 0) return null
  const attempts = [body]
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) attempts.push(fenced[1].trim())
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(body.slice(first, last + 1))
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* next */
    }
  }
  return null
}

/**
 * 校验并归一化模型的自处结果（v1.56：行为由她自己用第一人称写出来，不从菜单挑）。
 * 输出 `{felt, doing, kind?, say?}`；doing 为空 = 什么都不做。
 * 为兼容旧调用，仍接受 `{action, label}` 形状。
 */
export function parseSelfDriveResult(text) {
  const raw = extractJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const felt = cleanText(raw.felt, 60)
  if (Array.from(felt).length < 4) return { ok: false, message: '状态描述太短' }

  // 新形状：doing 是自由行为描述；kind 只在她想说明“这就是吃喝睡学/冒泡”时给。
  const doing = cleanText(typeof raw.doing === 'string' ? raw.doing : '', 24)
  let kind = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : ''
  if (doing.length === 0) {
    // 兼容旧 action 形状：action 若不是 none，就当成 kind，并用目录文案当 doing。
    const legacyAction = typeof raw.action === 'string' ? raw.action.trim().toLowerCase() : 'none'
    if (legacyAction !== '' && legacyAction !== 'none') {
      if (!SELF_ACTION_KIND_PATTERN.test(legacyAction)) return { ok: false, message: `动作名不合法：${legacyAction}` }
      kind = legacyAction
      const fallbackDoing = SELF_ACTION_TEXTS[kind] ?? cleanText(raw.label, 24) ?? ''
      if (fallbackDoing.length === 0) return { ok: false, message: '缺少行为描述' }
      const sayLegacy = cleanText(raw.say, 60)
      const experiencingLegacy = cleanText(typeof raw.experiencing === 'string' ? raw.experiencing : '', 40)
      const focusLegacy = cleanText(typeof raw.focus === 'string' ? raw.focus : '', 24)
      return {
        ok: true,
        felt,
        doing: fallbackDoing,
        kind,
        ...(experiencingLegacy.length >= 4 ? { experiencing: experiencingLegacy } : {}),
        ...(focusLegacy.length >= 4 ? { focus: focusLegacy } : {}),
        ...(sayLegacy.length > 0 ? { say: sayLegacy } : {}),
      }
    }
    const experiencingQuiet = cleanText(typeof raw.experiencing === 'string' ? raw.experiencing : '', 40)
    const focusQuiet = cleanText(typeof raw.focus === 'string' ? raw.focus : '', 24)
    return {
      ok: true,
      felt,
      doing: '',
      kind: '',
      ...(experiencingQuiet.length >= 4 ? { experiencing: experiencingQuiet } : {}),
      ...(focusQuiet.length >= 4 ? { focus: focusQuiet } : {}),
    }
  }
  if (kind.length > 0 && !SELF_ACTION_KIND_PATTERN.test(kind)) return { ok: false, message: `kind 不合法：${kind}` }
  const experiencing = cleanText(typeof raw.experiencing === 'string' ? raw.experiencing : '', 40)
  const focus = cleanText(typeof raw.focus === 'string' ? raw.focus : '', 24)
  const say = cleanText(raw.say, 60)
  return {
    ok: true,
    felt,
    doing,
    kind,
    ...(experiencing.length >= 4 ? { experiencing } : {}),
    ...(focus.length >= 4 ? { focus } : {}),
    ...(say.length > 0 ? { say } : {}),
  }
}

/** 自处 prompt：只给事实，让她自己判断；不提供任何分数。 */
export function buildSelfDrivePrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    '你现在没有在跟用户说话，你在过自己的时间。下面是此刻的事实（不给你任何指标，也不需要换算）。',
    ...describeTimeline(state, now),
  ]
  const moodLabels = Array.isArray(ctx.recentMoodLabels)
    ? ctx.recentMoodLabels.filter((label) => typeof label === 'string' && label.trim().length > 0).slice(-3)
    : []
  if (moodLabels.length > 0) lines.push(`你最近的心情是：${moodLabels.join('、')}（如果已经变了就不用管它）。`)
  const latestAction = isPlainObject(ctx.latestAction) ? ctx.latestAction : null
  if (latestAction !== null && typeof latestAction.text === 'string' && latestAction.text.length > 0) {
    lines.push(`你刚做过：${latestAction.text}`)
  }
  lines.push(
    '请用第一人称写一句你此刻的状态（8–40 字）：不要写数字、分数或指标，不要罗列需求，像在心里感受一下自己。',
    '再想一件你此刻真的想做的事——**不要从任何清单里挑**，用你自己的话写出来（4–20 字，第一人称的动作）：',
    '可以很小：擦掉桌沿那道水痕、听楼下谁在弹琴、把旧票根翻出来看一眼、给杯子换一次水、数窗外过去几辆车、把椅背上的外套抖开、给盆里那棵草转个方向……这些只是举例，不是选项；你想做什么都可以。',
    '如果这件事本质上就是吃/喝/玩/冒泡/睡/醒/学，就在 kind 里顺手标一下（eat/drink/play/socialize/sleep/wake/learn），好让“上次吃饭/睡觉”的事实保持准确；否则 kind 留空。',
    '动作要正当、日常、无害；注意现在是一天里的什么时候（早晨/午后/傍晚/深夜做事的节奏不一样），也可以重复一件你真心喜欢的小事。只是闲着、不想动就把 doing 留空。',
    '情绪会累积：如果你已经连续几次停在同一种状态里，可以自然换一件不一样的小事，或就安静待着——别被上一轮的情绪推着走。',
    '如果你最近在体会/琢磨一件具体的事（一段历史、一本书、楼下谁在弹琴、一个还没想通的问题），可以在 experiencing 里写一句（4–40 字）；没有就留空，沿用你上次写的。',
    '如果你此刻确实注意力集中在某件事上（手边正在做/正看得入神），用 focus 写一句（4–24 字，比如「在琢磨漏刻的水位为什么能稳住」）；只是普通待着、没有特别专注，就留空——不要为了填而填。',
    ...naturalStyleLines(['felt 写身体或手边正在发生的事，不写「感到很充实」这种总结。']),
    '只输出严格 JSON：{"felt":"一句话","experiencing":"最近在体会/琢磨什么（可为空）","focus":"注意力集中在什么上（可为空）","doing":"用你自己的话写的行为（可为空）","kind":"eat|drink|play|socialize|sleep|wake|learn 或空","say":"做时随口说的一句（可为空）"}',
  )
  return lines.join('\n')
}

/** 读取她「此刻状态」的一句话（给 prompt 用；没有就留白）。 */
export function formatSelfDriveFelt(state) {
  return formatBeingLine(state)
}

/**
 * 创建「自处」循环。
 * @param {{
 *   state: {snapshot: Function, applyEvent: Function, setFelt: Function, markChecked: Function},
 *   getLlm?: () => object|undefined|null,
 *   llm?: object,
 *   policy?: {resolveCandidates?: Function}|null,
 *   modelErrorsPath?: string|null,
 *   actionsPath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   random?: () => number,
 *   minGapMs?: number,
 *   maxEntries?: number,
 *   checkMinMs?: number,
 *   checkMaxMs?: number,
 *   retryMinMs?: number,
 *   retryMaxMs?: number,
 *   firstMinMs?: number,
 *   firstMaxMs?: number,
 *   tickIntervalMs?: number,
 *   timeoutMs?: number,
 *   getRecentMoodLabels?: () => string[],
 *   onLearn?: () => Promise<unknown>|unknown,
 *   onProbe?: (focus: string) => Promise<unknown>|unknown,
 * }} options
 */
export function createSelfDrive(options) {
  const state = options.state
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const policy = options.policy ?? null
  const file = path.resolve(options.actionsPath ?? resolveSelfActionsPath(options.env, options.home))
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const random = typeof options.random === 'function' ? options.random : Math.random
  const minGapMs = Number.isFinite(options.minGapMs) && options.minGapMs >= 0 ? options.minGapMs : SELF_ACTIONS_MIN_GAP_MS
  const maxEntries =
    Number.isFinite(options.maxEntries) && options.maxEntries > 0 ? Math.floor(options.maxEntries) : SELF_ACTIONS_MAX_ENTRIES
  const checkMin = Number.isFinite(options.checkMinMs) && options.checkMinMs > 0 ? options.checkMinMs : SELF_DRIVE_CHECK_MIN_MS
  const checkMax = Number.isFinite(options.checkMaxMs) && options.checkMaxMs > checkMin ? options.checkMaxMs : SELF_DRIVE_CHECK_MAX_MS
  const retryMin = Number.isFinite(options.retryMinMs) && options.retryMinMs > 0 ? options.retryMinMs : SELF_DRIVE_RETRY_MIN_MS
  const retryMax = Number.isFinite(options.retryMaxMs) && options.retryMaxMs > retryMin ? options.retryMaxMs : SELF_DRIVE_RETRY_MAX_MS
  const firstMin = Number.isFinite(options.firstMinMs) && options.firstMinMs >= 0 ? options.firstMinMs : SELF_DRIVE_FIRST_MIN_MS
  const firstMax = Number.isFinite(options.firstMaxMs) && options.firstMaxMs >= firstMin ? options.firstMaxMs : SELF_DRIVE_FIRST_MAX_MS
  const tickIntervalMs = Number.isFinite(options.tickIntervalMs) && options.tickIntervalMs > 0 ? options.tickIntervalMs : SELF_DRIVE_TICK_MS
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 20000
  const getRecentMoodLabels = typeof options.getRecentMoodLabels === 'function' ? options.getRecentMoodLabels : () => []
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  // v1.52：她可以选择“现在想学”——触发自学（学什么由自学 prompt 里她自己决定）。
  const onLearn = typeof options.onLearn === 'function' ? options.onLearn : null
  const onProbe = typeof options.onProbe === 'function' ? options.onProbe : null

  /** @type {Array<object>} 旧→新 */
  const actions = []
  let counter = 0
  let timer = null
  let disposed = false
  let inFlight = false
  let nextCheckAt = 0

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

  function delay(min, max) {
    const value = Number(random())
    const ratio = Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0
    return Math.round(min + ratio * (max - min))
  }

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
      warn(`自处动作写入失败：${shortMessage(error)}`)
      return { ok: false, message: shortMessage(error) }
    }
  }

  function latestAction() {
    return actions.length > 0 ? { ...actions[actions.length - 1] } : null
  }

  function lastActionAt(atNow) {
    const snapshot = (() => {
      try {
        return state.snapshot()
      } catch {
        return null
      }
    })()
    let latest = typeof snapshot?.lastActionAt === 'number' ? snapshot.lastActionAt : 0
    if (actions.length > 0) latest = Math.max(latest, actions[actions.length - 1].at)
    return latest
  }

  function candidatesForDrive() {
    try {
      if (policy !== null && policy !== undefined && typeof policy.resolveCandidates === 'function') {
        const list = policy.resolveCandidates('drive')
        if (Array.isArray(list) && list.length > 0) return list
      }
    } catch {
      /* fall through */
    }
    return []
  }

  async function collect(stream) {
    let text = ''
    for await (const chunk of stream) {
      if (!isPlainObject(chunk)) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'finish' && isPlainObject(chunk.reason)) {
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
          const failure = isPlainObject(chunk.reason.failure) ? chunk.reason.failure : null
          const error = new Error(failure?.message ?? chunk.reason.kind)
          if (failure?.code) error.code = failure.code
          throw error
        }
      }
    }
    return text
  }

  /** 一次自处检查：写状态 + 决定动作。 */
  async function check(atNow) {
    if (disposed || inFlight) return { ok: false, reason: 'busy' }
    const llm = (() => {
      try {
        return resolveLlm()
      } catch {
        return null
      }
    })()
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      nextCheckAt = atNow + delay(retryMin, retryMax)
      return { ok: false, reason: 'llm' }
    }
    const candidates = candidatesForDrive()
    if (candidates.length === 0) {
      nextCheckAt = atNow + delay(retryMin, retryMax)
      return { ok: false, reason: 'no-candidates' }
    }
    const snapshot = state.snapshot()
    const prompt = buildSelfDrivePrompt({
      now: atNow,
      state: snapshot,
      recentMoodLabels: getRecentMoodLabels(),
      latestAction: latestAction(),
    })
    inFlight = true
    let lastMessage = ''
    try {
      for (const candidate of candidates) {
        const signal =
          typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : undefined
        const requestMeta = describeModelRequest(
          {
            provider: candidate.provider,
            model: candidate.model,
            maxTokens: 600,
            reasoningEffort: candidate.reasoningEffort,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
            ...(candidate.omitTemperature === true || candidate.provider === 'opencode-go' ? {} : { temperature: 0.9 }),
          },
          prompt,
        )
        try {
          const stream = llm.stream({
            provider: candidate.provider,
            model: candidate.model,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
            system: '你是住在 DSH Web 角落的鲸鱼娘，正在过自己的时间；只输出严格 JSON。',
            maxTokens: 600,
            ...(candidate.omitTemperature === true || candidate.provider === 'opencode-go' ? {} : { temperature: 0.9 }),
            ...(candidate.omitReasoningEffort === true || candidate.provider === 'opencode-go'
              ? {}
              : candidate.reasoningEffort !== undefined
                ? { reasoningEffort: candidate.reasoningEffort }
                : {}),
            ...(signal !== undefined ? { signal } : {}),
          })
          const text = await Promise.race([
            collect(stream),
            new Promise((_resolve, reject) => {
              const timerId = setTimeout(() => {
                const error = new Error(`自处检查超时（${timeoutMs}ms）`)
                error.code = 'SELF_DRIVE_TIMEOUT'
                reject(error)
              }, timeoutMs)
              timerId.unref?.()
            }),
          ])
          const parsed = parseSelfDriveResult(text)
          if (parsed.ok !== true) {
            lastMessage = parsed.message
            recordModelFailure({
              errorsPath: modelErrorsPath,
              warnFn: warn,
              role: 'drive',
              provider: candidate.provider,
              model: candidate.model,
              error: { code: 'INVALID_OUTPUT', message: parsed.message },
              request: requestMeta,
              prefix: '自处结果无效',
            })
            continue
          }
          // 成功：先写下她自己的状态（只存文字）。
          state.setFelt(parsed.felt, atNow)
          if (parsed.experiencing !== undefined && typeof state.setExperiencing === 'function') {
            state.setExperiencing(parsed.experiencing, atNow)
          }
          state.markChecked(atNow)
          if (onProbe !== null && parsed.focus !== undefined) {
            // v1.62：注意力集中时，给一个“可以去看看”的介入；她去不去/喜不喜欢由她自己判断。
            Promise.resolve()
              .then(() => onProbe(parsed.focus))
              .catch((error) => warn(`注意力介入失败：${shortMessage(error)}`))
          }
          nextCheckAt = atNow + delay(checkMin, checkMax)
          let action = null
          if (parsed.doing.length > 0) {
            const current = state.snapshot()
            const previousAt = lastActionAt(atNow)
            const tooSoon = previousAt > 0 && atNow - previousAt < minGapMs
            const alreadySleeping = current.sleeping === true
            const kind = typeof parsed.kind === 'string' ? parsed.kind : ''
            if (!tooSoon && !(kind === 'sleep' && alreadySleeping) && !(kind === 'wake' && !alreadySleeping)) {
              counter += 1
              action = {
                id: `act-${atNow}-${counter}`,
                kind: kind.length > 0 ? kind : 'doing',
                label: parsed.doing.slice(0, 20),
                text:
                  parsed.say !== undefined && parsed.say.length > 0
                    ? parsed.say
                    : parsed.doing.length > 0
                      ? parsed.doing
                      : '做了点自己的小事。',
                at: atNow,
                felt: parsed.felt,
              }
              actions.push(action)
              while (actions.length > maxEntries) actions.shift()
              if (kind === 'learn') {
                // 学什么由 growth 的自学 prompt 让她自己定；这里只负责“现在想学”这个决定。
                if (onLearn !== null) {
                  Promise.resolve()
                    .then(() => onLearn())
                    .catch((error) => warn(`自处触发的自学失败：${shortMessage(error)}`))
                }
              } else if (kind.length > 0 && Object.hasOwn(ACTION_EVENTS, kind)) {
                try {
                  state.applyEvent(ACTION_EVENTS[kind], atNow)
                } catch (error) {
                  warn(`自处动作状态更新失败：${shortMessage(error)}`)
                }
              }
              persist(atNow)
              info(`自处：${parsed.felt} → ${action.label}（${action.text}）`)
            } else {
              info(`自处：${parsed.felt}（行为「${parsed.doing}」被跳过：${tooSoon ? '太频繁' : '状态不符'}）`)
            }
          } else {
            info(`自处：${parsed.felt}（什么也不做）`)
          }
          return { ok: true, felt: parsed.felt, action }
        } catch (error) {
          lastMessage = shortMessage(error)
          recordModelFailure({
            errorsPath: modelErrorsPath,
            warnFn: warn,
            role: 'drive',
            provider: candidate.provider,
            model: candidate.model,
            error,
            request: requestMeta,
            prefix: '自处检查失败',
          })
        }
      }
      nextCheckAt = atNow + delay(retryMin, retryMax)
      warn(`自处检查失败：${lastMessage}`)
      return { ok: false, reason: 'model' }
    } finally {
      inFlight = false
    }
  }

  function tick(atNow) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const at = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    if (inFlight) return { ok: true, skipped: true, reason: 'in-flight' }
    if (at < nextCheckAt) return { ok: true, skipped: true, reason: 'not-due' }
    check(at).catch(() => {})
    return { ok: true, scheduled: true }
  }

  function snapshot() {
    const latest = actions.length > 0 ? { ...actions[actions.length - 1] } : null
    return { latest, recent: actions.slice(-5).reverse().map((action) => ({ ...action })) }
  }

  function start() {
    if (disposed || timer !== null) return
    load()
    nextCheckAt = now() + delay(firstMin, firstMax)
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
    check,
    tick,
    load,
    snapshot,
    start,
    stop,
    dispose,
    actions: () => actions.map((action) => ({ ...action })),
  }
}
