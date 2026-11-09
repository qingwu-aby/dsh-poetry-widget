// @ts-check
// lib/composition/life-services.mjs —— 日常素材/手动读文章/成长计数校正（W2）
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createManualReading, ensureManualToken, resolveManualTokenPath } from '../domain/learning/manual-reading.mjs'
import { createDailyLife } from '../domain/life/daily-life.mjs'

export function createDailyLifeService({ settingsDir, selfState, modelPolicy, getLlm, modelErrorsPath, logger, env }) {
  const dailyLife = createDailyLife({
    file: path.join(settingsDir, 'daily-life.jsonl'),
    state: selfState,
    policy: modelPolicy,
    getLlm,
    modelErrorsPath,
    logger,
    env,
  })
  dailyLife.start()
  return dailyLife
}

export function createManualReadingService({
  env,
  home,
  getLlm,
  modelPolicy,
  journal,
  selfState,
  memoryRecall,
  voiceService,
  modelErrorsPath,
  logger,
}) {
  const manualTokenFile = resolveManualTokenPath(env, home)
  ensureManualToken(manualTokenFile)
  const manualReading = createManualReading({
    getLlm,
    policy: modelPolicy,
    journal,
    selfState,
    recall: memoryRecall,
    voice: () => voiceService.get(),
    modelErrorsPath,
    logger,
  })
  return { manualTokenFile, manualReading }
}

/** 用她自己的历史日志校正事实计数（旧版计数器冻结时，成长页看起来像停止）。 */
export function correctGrowthCounts({ memoryDir, selfState, logger }) {
  try {
    let learnings = 0
    let reflections = 0
    const journalPath = path.join(memoryDir, 'journal.jsonl')
    if (existsSync(journalPath)) {
      for (const line of readFileSync(journalPath, 'utf8').split('\n')) {
        if (line.trim().length === 0) continue
        try {
          const entry = JSON.parse(line)
          if (entry && entry.kind === 'thought') reflections += 1
        } catch {
          /* 单行坏 JSON 跳过 */
        }
      }
    }
    const learningLogPath = path.join(memoryDir, 'learning-log.md')
    if (existsSync(learningLogPath)) {
      learnings = (readFileSync(learningLogPath, 'utf8').match(/· 自学/g) || []).length
    }
    selfState.setGrowthCounts({ learnings, reflections })
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 成长计数校正失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
