// @ts-check
// lib/composition/being-services.mjs —— 自驱成长/状态服务组装（W2）
import path from 'node:path'
import { MODEL_POLICY_ROLE_LABELS } from '../kernel/model-policy.mjs'
import { createSelfGrowth } from '../domain/learning/self-growth.mjs'

const ROLE_LOG_ORDER = [
  'mood',
  'selfTalk',
  'growth',
  'voice',
  'drive',
  'probe',
  'wander',
  'read',
  'netlang',
  'consolidate',
]

export function logModelCandidates({ modelPolicy, logger }) {
  const text = ROLE_LOG_ORDER.map((role) => {
    let candidates = []
    try {
      candidates = modelPolicy.resolveCandidates(role)
    } catch {
      candidates = []
    }
    const list = candidates
      .map(
        (candidate) =>
          `${candidate.provider}/${candidate.model}${candidate.reasoningEffort ? `(${candidate.reasoningEffort})` : ''}`,
      )
      .join(' → ')
    return `${MODEL_POLICY_ROLE_LABELS[role] ?? role}=[${list || 'none'}]`
  }).join('; ')
  logger?.info?.(`[dsh-little-whale] 模型候选：${text}`)
}

export function createGrowthService(deps) {
  const growth = createSelfGrowth({
    state: deps.selfState,
    getLlm: deps.getLlm,
    getSelection: deps.getSelection,
    journal: deps.journal,
    learningLogPath: path.join(deps.memoryDir, 'learning-log.md'),
    probeStatePath: path.join(deps.settingsDir, 'probe-state.json'),
    candidatesPath: path.join(path.dirname(deps.topicsPath), 'topics-candidates.json'),
    topicsBankPath: deps.topicsPath,
    topicsArchivePath: deps.topicsArchivePath,
    topics: deps.topicBank,
    recall: deps.memoryRecall,
    feelingsPath: deps.feelingsPath,
    feelings: deps.feelingBank,
    reflectIntervalMs: deps.autonomy.reflectIntervalMs,
    learnIntervalMs: deps.autonomy.learnIntervalMs,
    probeGapMs: deps.autonomy.probeGapMs,
    logger: deps.logger,
    policy: deps.modelPolicy,
    modelErrorsPath: deps.modelErrorsPath,
    getGraphGaps: deps.getGraphGaps,
    getBroadenHint: deps.getBroadenHint,
  })
  growth.start({ heartbeat: true })
  deps.heartbeat.add('自驱成长', () => growth.tick())
  deps.logger?.info?.(`[dsh-little-whale] 自驱成长已启动（状态：${deps.selfState.file}；自省 60min / 自学 90min）`)
  logModelCandidates({ modelPolicy: deps.modelPolicy, logger: deps.logger })
  deps.serviceRuntime.register('自驱成长', {
    dispose: () => {
      try {
        growth.dispose()
      } catch (error) {
        deps.logger?.warn?.(
          `[dsh-little-whale] 自驱成长清理失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      try {
        deps.selfState.dispose()
      } catch (error) {
        deps.logger?.warn?.(
          `[dsh-little-whale] 状态清理失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  })
  return growth
}
