// @ts-check
// lib/composition/self-drive-service.mjs —— 自处循环组装（W2）

import { bucketOf } from '../domain/being/action-policy.mjs'
import { createSelfDrive } from '../domain/being/self-drive.mjs'

export function createSelfDriveService(deps) {
  const situationOf = () => {
    try {
      const snap = deps.selfState && typeof deps.selfState.snapshot === 'function' ? deps.selfState.snapshot() : null
      return String((snap && (snap.experiencing || snap.felt)) || '自处')
    } catch (_error) {
      return '自处'
    }
  }
  const recordPolicy = (kind, ok) => {
    try {
      if (deps.actionPolicy && typeof deps.actionPolicy.record === 'function')
        deps.actionPolicy.record({ kind, bucket: bucketOf(situationOf(), Date.now()), ok })
    } catch {
      /* ignore */
    }
  }
  const recordHabit = (action, ok) => {
    try {
      if (deps.habits && typeof deps.habits.record === 'function')
        deps.habits.record({ situation: situationOf(), action, ok: ok === true })
    } catch (_error) {
      /* ignore */
    }
  }
  const selfDrive = createSelfDrive({
    state: deps.selfState,
    projects: deps.selfProjects,
    events: deps.selfEvents,
    metabolism: deps.selfMetabolism,
    worldFeedback: deps.worldFeedback,
    lifecycle: deps.selfLifecycle,
    onProjectExpired: (project) => {
      const title = project && typeof project.title === 'string' ? project.title : ''
      if (title.length === 0) return undefined
      return deps.journal.append({ kind: 'thought', text: `这件事到期限了，我没做完：${title}` }).catch(() => undefined)
    },
    onEventClosed: (event) => {
      const text = event && typeof event.topic === 'string' ? `这件事先放下了：${event.topic}` : ''
      if (text.length === 0) return undefined
      return deps.journal.append({ kind: 'thought', text }).catch(() => undefined)
    },
    getLlm: deps.getLlm,
    policy: deps.modelPolicy,
    modelErrorsPath: deps.modelErrorsPath,
    logger: deps.logger,
    onLearn: async () => {
      const result = await deps.growth.learnNow()
      recordHabit('自学', result && result.ok === true)
      return result
    },
    onProbe: async (focus) => {
      const result = await deps.growth.probeNow({ focus })
      recordHabit('试探', result && result.ok === true)
      return result
    },
    onMake: async (input) => {
      const result = await deps.selfWorks.makeNow(input)
      deps.worldFeedback.record({
        source: 'works',
        kind: 'make',
        ok: result.ok === true,
        summary: result.ok && result.work ? result.work.title : result.reason || '作品没有写成',
      })
      recordHabit('做作品', result && result.ok === true)
      recordPolicy('make', result && result.ok === true)
      return result
    },
    checkMinMs: deps.autonomy.driveCheckMinMs,
    checkMaxMs: deps.autonomy.driveCheckMaxMs,
    retryMinMs: deps.autonomy.driveRetryMinMs,
    retryMaxMs: deps.autonomy.driveRetryMaxMs,
    firstMinMs: deps.autonomy.driveFirstMinMs,
    firstMaxMs: deps.autonomy.driveFirstMaxMs,
    getRecentMoodLabels: () => {
      try {
        return typeof deps.moodAiService.peekRecentLabels === 'function' ? deps.moodAiService.peekRecentLabels() : []
      } catch (_error) {
        return []
      }
    },
    getRecallDigest: () => deps.readingDigest(),
    getEmotionalDigest: () => deps.emotional.digest(3),
    getPhilosophyProgress: () => {
      try {
        const philosophy = deps.getPhilosophy && typeof deps.getPhilosophy === 'function' ? deps.getPhilosophy() : null
        return philosophy && typeof philosophy.snapshot === 'function' ? philosophy.snapshot() : null
      } catch (error) {
        return null
      }
    },
    getHabitHint: typeof deps.getHabitHint === 'function' ? deps.getHabitHint : null,
    getPolicyHint: (context) => {
      try {
        return deps.actionPolicy && typeof deps.actionPolicy.digest === 'function'
          ? deps.actionPolicy.digest(context, { limit: 3 })
          : []
      } catch {
        return []
      }
    },
    getRulesDigest: (context) => {
      try {
        return deps.internalRules && typeof deps.internalRules.digest === 'function'
          ? deps.internalRules.digest(context, { limit: 3 })
          : []
      } catch (_error) {
        return []
      }
    },
    getThoughtDigest: () => {
      try {
        if (!deps.thoughtChain) return []
        const positions =
          typeof deps.thoughtChain.positionsDigest === 'function' ? deps.thoughtChain.positionsDigest(3) : []
        const chains = typeof deps.thoughtChain.chainDigest === 'function' ? deps.thoughtChain.chainDigest(2) : []
        return [...positions, ...chains]
      } catch (_error) {
        return []
      }
    },
    getDailyLifeDigest: () => deps.dailyLife.digest(3),
    getCommitmentDigest: () => deps.commitments.digest(3),
    onBrowse: deps.browseForWhale,
    onShare: (text) => {
      try {
        const value = typeof text === 'string' ? text.trim() : ''
        if (value.length < 4) return
        // 只在用户聊过、且离上次分享够久时才发，避免刷屏。
        if (typeof deps.chatBridge.lastUserAt === 'function' && deps.chatBridge.lastUserAt() <= 0) return
        const nowMs = Date.now()
        if (nowMs - deps.shareGate.get() < 45 * 60 * 1000) return
        deps.shareGate.set(nowMs)
        deps.queueGuiMessage(value, { kind: 'share' })
      } catch (_error) {
        /* 分享失败不影响自处 */
      }
    },
  })
  selfDrive.start({ heartbeat: true })
  deps.heartbeat.add('自处', () => selfDrive.tick())
  const actionSnapshot = selfDrive.snapshot()
  deps.logger?.info?.(
    `[dsh-little-whale] 自处循环已启动（${selfDrive.actionsPath}${
      actionSnapshot.latest !== null ? `；上次：${actionSnapshot.latest.text}` : ''
    }）`,
  )
  deps.serviceRuntime.register('自处', {
    dispose: () => {
      try {
        selfDrive.dispose()
      } catch (error) {
        deps.logger?.warn?.(
          `[dsh-little-whale] 自处循环清理失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  })
  return selfDrive
}
