// lib/domain/being/self-drive.mjs —— 服务装配（纯函数在 self-drive-core.mjs）
import {
  SELF_DRIVE_CHECK_MIN_MS,
  SELF_DRIVE_CHECK_MAX_MS,
  SELF_DRIVE_RETRY_MIN_MS,
  SELF_DRIVE_RETRY_MAX_MS,
  SELF_DRIVE_FIRST_MIN_MS,
  SELF_DRIVE_FIRST_MAX_MS,
  SELF_DRIVE_TICK_MS,
  parseSelfDriveResult,
  buildSelfDrivePrompt,
  shortMessage,
  ACTION_EVENTS,
} from './self-drive-core.mjs'

import { callCandidate } from '../../kernel/llm-call.mjs'
import { recordModelFailure } from '../../kernel/model-errors.mjs'
import { formatExpectationSurprise } from '../learning/predict-check.mjs'
import { readFileSync } from 'node:fs'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { SELF_ACTIONS_MAX_ENTRIES, SELF_ACTIONS_MIN_GAP_MS, normalizeSelfActionsFile, resolveSelfActionsPath } from './self-actions.mjs'

export * from './self-drive-core.mjs'
import path from 'node:path'

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
  const projects = options.projects ?? null
  const events = options.events ?? null
  const metabolism = options.metabolism ?? null
  const agent = options.agent === 'twin' ? 'twin' : 'primary'
  const worldFeedback = options.worldFeedback ?? null
  const onEventClosed = typeof options.onEventClosed === 'function' ? options.onEventClosed : null
  const onProjectExpired = typeof options.onProjectExpired === 'function' ? options.onProjectExpired : null
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
  // v2.67：读过的材料（自学/书架/读记）进入自处 prompt，行为才可能被读的东西带出来。
  const getRecallDigest = typeof options.getRecallDigest === 'function' ? options.getRecallDigest : null
  // v2.71：她自己想查网页/搜东西时，由宿主替她打开并把看到的内容写进记忆与世界反馈。
  const onBrowse = typeof options.onBrowse === 'function' ? options.onBrowse : null
  const onShare = typeof options.onShare === 'function' ? options.onShare : null
  const getEmotionalDigest = typeof options.getEmotionalDigest === 'function' ? options.getEmotionalDigest : null
  const getHabitHint = typeof options.getHabitHint === 'function' ? options.getHabitHint : null
  const getThoughtDigest = typeof options.getThoughtDigest === 'function' ? options.getThoughtDigest : null
  const getRulesDigest = typeof options.getRulesDigest === 'function' ? options.getRulesDigest : null
  const getDailyLifeDigest = typeof options.getDailyLifeDigest === 'function' ? options.getDailyLifeDigest : null
  const getCommitmentDigest = typeof options.getCommitmentDigest === 'function' ? options.getCommitmentDigest : null
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  // v1.52：她可以选择“现在想学”——触发自学（学什么由自学 prompt 里她自己决定）。
  const onLearn = typeof options.onLearn === 'function' ? options.onLearn : null
  const onProbe = typeof options.onProbe === 'function' ? options.onProbe : null
  const onMake = typeof options.onMake === 'function' ? options.onMake : null

  /** @type {Array<object>} 旧→新 */
  const actions = []
  let counter = 0
  let timer = null
  let heartbeatMode = false
  let disposed = false
  let inFlight = false
  let nextCheckAt = 0

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function info(message) {
    try {
      logger?.info?.(`[dsh-little-whale] ${message}`)
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
    let recallDigest = null
    if (getRecallDigest !== null) {
      try {
        recallDigest = getRecallDigest()
      } catch {
        recallDigest = null
      }
    }
    if (projects !== null && typeof projects.checkStale === 'function') {
      try {
        const stale = projects.checkStale(atNow)
        if (stale !== null) info(`项目搁置：${stale.title}`)
      } catch {
        /* ignore */
      }
    }
    // v2.74：上次动作的 expect 与之后的第一条真实观测对齐，惊讶高的这一轮优先处理。
    let surpriseText = ''
    try {
      if (worldFeedback !== null && typeof worldFeedback.recent === 'function') {
        const previous = latestAction()
        if (
          previous !== null &&
          typeof previous.expect === 'string' &&
          previous.expect.length >= 4 &&
          typeof previous.at === 'number'
        ) {
          const observations = worldFeedback
            .recent(10)
            .filter((entry) => entry && typeof entry.ts === 'number' && entry.ts > previous.at && entry.source !== 'self')
          if (observations.length > 0) {
            surpriseText = formatExpectationSurprise(previous.expect, observations[observations.length - 1])
          }
        }
      }
    } catch {
      surpriseText = ''
    }
    let emotionalText = ''
    try {
      if (getEmotionalDigest !== null) {
        const lines = getEmotionalDigest(3)
        if (Array.isArray(lines)) emotionalText = lines.filter((line) => typeof line === 'string' && line.trim().length > 0).slice(0, 3).join('；')
      }
    } catch {
      emotionalText = ''
    }
    let habitText = ''
    try {
      if (getHabitHint !== null) {
        const snap = state.snapshot()
        const situation = String(snap.experiencing || snap.felt || '')
        if (situation.length >= 2) {
          const lines = getHabitHint(situation, 2)
          if (Array.isArray(lines)) habitText = lines.filter((line) => typeof line === 'string' && line.trim().length > 0).slice(0, 2).join('；')
        }
      }
    } catch {
      habitText = ''
    }
    let rulesText = ''
    try {
      if (getRulesDigest !== null) {
        const snap = state.snapshot()
        const context = String(snap.experiencing || snap.felt || '')
        const lines = getRulesDigest(context)
        if (Array.isArray(lines)) rulesText = lines.filter((line) => typeof line === 'string' && line.trim().length > 0).slice(0, 3).join('；')
      }
    } catch (error) {
      rulesText = ''
    }
    let thoughtText = ''
    try {
      if (getThoughtDigest !== null) {
        const lines = getThoughtDigest(5)
        if (Array.isArray(lines)) thoughtText = lines.filter((line) => typeof line === 'string' && line.trim().length > 0).slice(0, 4).join('；')
      }
    } catch (error) {
      thoughtText = ''
    }
    let dailyLifeText = ''
    try {
      if (getDailyLifeDigest !== null) dailyLifeText = (getDailyLifeDigest(3) || []).filter((line) => typeof line === 'string').slice(0, 3).join('；')
    } catch {
      dailyLifeText = ''
    }
    let commitmentText = ''
    try {
      if (getCommitmentDigest !== null) commitmentText = (getCommitmentDigest(3) || []).filter((line) => typeof line === 'string').slice(0, 3).join('；')
    } catch {
      commitmentText = ''
    }
    let expiredProject = null
    if (projects !== null && typeof projects.expire === 'function') {
      try {
        expiredProject = projects.expire(atNow)
      } catch {
        expiredProject = null
      }
      if (expiredProject !== null && onProjectExpired !== null) {
        Promise.resolve(onProjectExpired(expiredProject)).catch(() => {})
      }
    }
    const prompt = buildSelfDrivePrompt({
      now: atNow,
      state: snapshot,
      recentMoodLabels: getRecentMoodLabels(),
      latestAction: latestAction(),
      project:
        projects !== null && typeof projects.snapshot === 'function'
          ? (() => {
              const snap = projects.snapshot()
              const current = snap && snap.current ? { ...snap.current } : null
              if (current !== null && snap && snap.due && snap.due.dueAt !== null) {
                current.dueAt = snap.due.dueAt
                current.overdue = snap.due.overdue === true
              }
              return current
            })()
          : null,
      recentActions: actions
        .filter((item) => typeof item.at === 'number' && atNow - item.at <= 6 * 60 * 60 * 1000)
        .slice(-3),
      hoursSinceLastAction:
        actions.length > 0 && typeof actions[actions.length - 1].at === 'number'
          ? Math.max(0, (atNow - actions[actions.length - 1].at) / (60 * 60 * 1000))
          : null,
      recallDigest,
      event: events !== null && typeof events.describe === 'function' ? events.describe(atNow) : null,
      metabolismText: metabolism !== null && typeof metabolism.describe === 'function' ? metabolism.describe() : '',
      lifecycleText:
        options.lifecycle !== undefined && options.lifecycle !== null && typeof options.lifecycle.describe === 'function'
          ? options.lifecycle.describe(atNow)
          : '',
      surpriseText,
      emotionalText,
      habitText,
      rulesText,
      thoughtText,
      dailyLifeText,
      commitmentText,
      worldFeedbackText:
        worldFeedback !== null && typeof worldFeedback.formatForPrompt === 'function'
          ? worldFeedback.formatForPrompt(5)
          : '',
      experiencingAgeMs:
        snapshot !== null && typeof snapshot.experiencingAt === 'number' && snapshot.experiencingAt > 0
          ? atNow - snapshot.experiencingAt
          : null,
    })
    inFlight = true
    let lastMessage = ''
    try {
      for (const candidate of candidates) {
        // v2.68：推理 token 计入预算的模型会把 JSON 挤到截断（finishKind=max-tokens）；
        // 先给足 1200，若仍被截断就翻倍重试一次——否则她会连续几十分钟“没有动作”。
        let budget = 1200
        let parsed = null
        let requestMeta = null
        let failed = false
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await callCandidate({
            candidate,
            resolveLlm,
            system: '你是住在 DSH Web 角落的鲸鱼娘，正在过自己的时间；只输出严格 JSON。',
            prompt,
            maxTokens: budget,
            temperature: 0.9,
            timeoutMs,
            timeoutCode: 'SELF_DRIVE_TIMEOUT',
            timeoutMessage: `自处检查超时（${timeoutMs}ms）`,
            role: 'drive',
            agent,
            prefix: '自处候选失败',
            modelErrorsPath,
            warn,
            honorFinishFailure: true,
          })
          if (result.ok !== true) {
            lastMessage = result.message
            failed = true
            break
          }
          requestMeta = result.request
          parsed = parseSelfDriveResult(result.text)
          if (parsed.ok === true) break
          const truncated = requestMeta !== null && requestMeta.finishKind === 'max-tokens'
          if (truncated && budget < 4800) {
            budget *= 2
            info(`自处输出被截断（max-tokens），用 ${budget} tokens 重试`)
            continue
          }
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
          failed = true
          break
        }
        if (failed || parsed === null || parsed.ok !== true) continue
          // 成功：先写下她自己的状态（只存文字）。
          state.setFelt(parsed.felt, atNow)
          if (onBrowse !== null && (parsed.browse !== undefined || parsed.search !== undefined)) {
            try {
              const note = await onBrowse({ browse: parsed.browse, search: parsed.search, atNow })
              if (typeof note === 'string' && note.length > 0) info(`出去看了一眼：${note.slice(0, 80)}`)
            } catch (error) {
              warn(`浏览失败：${shortMessage(error)}`)
            }
          }
          if (onShare !== null && typeof parsed.share === 'string' && parsed.share.length >= 4) {
            try {
              await onShare(parsed.share, { atNow })
            } catch (error) {
              warn(`分享失败：${shortMessage(error)}`)
            }
          }
          if (parsed.loop === true) {
            // v2.26：承认打转只作为信号，不再强制暂停——否则没有新动作，下一轮仍会
            // 看到同一批旧动作并再次承认打转，形成永久停机。
            info(`自处：${parsed.felt}（她承认在打转：${parsed.loopTheme || '同一件事'}，先记下，不强制停下）`)
            if (events !== null && typeof events.closeCurrent === 'function') {
              try {
                const closed = events.closeCurrent(parsed.loopTheme || '', atNow, 'loop')
                if (closed !== null && onEventClosed !== null) Promise.resolve(onEventClosed(closed)).catch(() => {})
                if (projects !== null && typeof projects.markStale === 'function') {
                  projects.markStale(`事件搁置：${parsed.loopTheme || closed.topic || ''}`, atNow)
                }
              } catch {
                /* ignore */
              }
            }
          }
          if (parsed.experiencing !== undefined && typeof state.setExperiencing === 'function') {
            state.setExperiencing(parsed.experiencing, atNow)
          }
          state.markChecked(atNow)
          if (parsed.outcome !== undefined) {
            const previous = latestAction()
            if (
              previous !== null &&
              worldFeedback !== null &&
              typeof worldFeedback.hasSince === 'function' &&
              !worldFeedback.hasSince(previous.at)
            ) {
              info(`世界没有给出真实结果，不把猜测写成 outcome：${parsed.outcome}`)
              delete parsed.outcome
            }
            if (previous !== null && typeof previous.id === 'string' && parsed.outcome !== undefined) {
              const target = actions.find((item) => item.id === previous.id)
              if (target !== undefined) {
                target.outcome = parsed.outcome
                target.outcomeAt = atNow
                persist(atNow)
                info(`经验修正：${previous.text} → ${parsed.outcome}`)
              }
            }
          }
          if (parsed.project !== undefined && projects !== null && typeof projects.apply === 'function') {
            try {
              const change = projects.apply(parsed.project, atNow)
              if (change !== null) info(`项目：${change.action}「${change.project ? change.project.title : ''}」`)
            } catch (error) {
              warn(`项目更新失败：${shortMessage(error)}`)
            }
          }
          // v1.62：注意力集中时，给一个“可以去看看”的介入；她去不去/喜不喜欢由她自己判断。
          // v1.66：如果这轮没写 focus、但刚写下新的 experiencing，也算“心正落在某件事上”，
          // 一并作为介入的入口（挑什么、喜不喜欢仍由 probe 和她自己决定）。
          const attention =
            parsed.focus !== undefined
              ? parsed.focus
              : parsed.experiencing !== undefined
                ? parsed.experiencing
                : null
          if (onProbe !== null && attention !== null) {
            Promise.resolve()
              .then(() => onProbe(attention))
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
              if (metabolism !== null && typeof metabolism.canAfford === 'function' && !metabolism.canAfford(kind || 'doing')) {
                info(`自处：${parsed.felt}（力气不够，先不安排：${parsed.doing}）`)
                state.markChecked(atNow)
                nextCheckAt = atNow + delay(checkMin, checkMax)
                return { ok: true, felt: parsed.felt, action: null, paused: true, tired: true }
              }
              const currentEvent = events !== null && typeof events.current === 'function' ? events.current() : null
              const topic =
                parsed.eventRelation === 'same' && currentEvent !== null
                  ? currentEvent.topic
                  : parsed.topic !== undefined
                    ? parsed.topic
                    : parsed.doing
              const eventStatus = events !== null && typeof events.observe === 'function' ? events.observe(topic, atNow) : null
              if (eventStatus !== null && eventStatus.allowed === false) {
                info(`自处：${parsed.felt}（这件事已经没感觉了，先放下：${parsed.doing}）`)
                if (events !== null && typeof events.closeCurrent === 'function') {
                  try {
                    const closed = events.closeCurrent(parsed.loopTheme || parsed.doing, atNow, 'satiated')
                    if (closed !== null && onEventClosed !== null) Promise.resolve(onEventClosed(closed)).catch(() => {})
                    if (projects !== null && typeof projects.markStale === 'function') {
                      projects.markStale(`事件饱和：${closed.topic || parsed.doing}`, atNow)
                    }
                  } catch {
                    /* ignore */
                  }
                }
                state.markChecked(atNow)
                nextCheckAt = atNow + delay(checkMin, checkMax)
                return { ok: true, felt: parsed.felt, action: null, paused: true, satiated: true }
              }
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
                ...(parsed.expect !== undefined ? { expect: parsed.expect } : {}),
                ...(parsed.tradeoff !== undefined ? { tradeoff: parsed.tradeoff } : {}),
                ...(eventStatus !== null && eventStatus.event !== null ? { topic: eventStatus.event.topic } : {}),
              }
              actions.push(action)
              while (actions.length > maxEntries) actions.shift()
              if (kind === 'make' && onMake !== null) {
                const idea = parsed.experiencing !== undefined ? parsed.experiencing : parsed.doing
                Promise.resolve()
                  .then(() => onMake({ idea }))
                  .catch((error) => warn(`作品生成失败：${shortMessage(error)}`))
              } else if (kind === 'learn') {
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
              info(
                `自处：${parsed.felt} → ${action.label}（${action.text}）${
                  parsed.focus !== undefined ? `（专注：${parsed.focus}）` : parsed.experiencing !== undefined ? `（在体会：${parsed.experiencing}）` : ''
                }`,
              )
            } else {
              info(`自处：${parsed.felt}（行为「${parsed.doing}」被跳过：${tooSoon ? '太频繁' : '状态不符'}）`)
            }
          } else {
            info(`自处：${parsed.felt}（什么也不做）`)
          }
          return { ok: true, felt: parsed.felt, action }
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

  function start(options = {}) {
    if (disposed || timer !== null || heartbeatMode) return
    heartbeatMode = options && options.heartbeat === true
    load()
    nextCheckAt = now() + delay(firstMin, firstMax)
    if (heartbeatMode) return
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
    heartbeatMode = false
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

