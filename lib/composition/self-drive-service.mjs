// lib/composition/self-drive-service.mjs —— 自处循环组装（W2）
import { createSelfDrive } from '../domain/being/self-drive.mjs'

export function createSelfDriveService(deps) {
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
    onLearn: () => deps.growth.learnNow(),
    onProbe: (focus) => deps.growth.probeNow({ focus }),
    onMake: async (input) => {
      const result = await deps.selfWorks.makeNow(input)
      deps.worldFeedback.record({
        source: 'works',
        kind: 'make',
        ok: result.ok === true,
        summary: result.ok && result.work ? result.work.title : result.reason || '作品没有写成',
      })
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
      } catch {
        return []
      }
    },
    getRecallDigest: () => deps.readingDigest(),
    getEmotionalDigest: () => deps.emotional.digest(3),
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
      } catch {
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
        deps.logger?.warn?.(`[dsh-little-whale] 自处循环清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
  return selfDrive
}
