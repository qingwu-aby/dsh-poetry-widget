// lib/composition/memory-knowledge-services.mjs —— 记忆/知识/情绪底座装配（v0.2.3 从 domain-services 拆出）
import path from 'node:path'
import { createAffectState } from '../domain/emotion/affect-homeostasis.mjs'
import { createEmotionalEpisodes } from '../domain/emotion/emotional-episodes.mjs'
import { createKnowledgeServices } from './knowledge-services.mjs'
import { createMemoryConsolidatorService, createMemoryStack } from './memory-services.mjs'
import { createWorldviewService } from './worldview-service.mjs'

/**
 * @param {{
 *   env: object, home: string, settingsDir: string, memoryDir: string,
 *   topicsPath: string, topicsArchivePath: string, topicBank: object, feelingsPath: string,
 *   modelPolicy: object, getLlm: Function, modelErrorsPath: string,
 *   journal: object, logger: object|null, disposers: Function[],
 *   heartbeat: object|null, serviceRuntime: object,
 * }} deps
 */
export function createMemoryKnowledgeServices(deps) {
  const {
    env,
    home,
    settingsDir,
    memoryDir,
    topicsPath,
    topicsArchivePath,
    topicBank,
    feelingsPath,
    modelPolicy,
    getLlm,
    modelErrorsPath,
    journal,
    logger,
    disposers,
    heartbeat,
    serviceRuntime,
  } = deps

  const { layersPath, memoryLayers, memoryRecall } = createMemoryStack({
    env,
    home,
    memoryDir,
    topicsPath,
    topicBank,
    topicsArchivePath,
    feelingsPath,
    logger,
  })

  const { knowledgeGraph, selfTrainer, relationship, emotional, commitments, nightlyConsolidator } =
    createKnowledgeServices({
      settingsDir,
      learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
      modelPolicy,
      getLlm,
      modelErrorsPath,
      journal,
      logger,
      env,
      home,
      heartbeat,
    })

  const affectState = createAffectState({ file: path.join(settingsDir, 'affect-state.json') })
  const emotionalEpisodes = createEmotionalEpisodes({
    file: path.join(settingsDir, 'emotional-episodes.json'),
    emotional,
    affect: affectState,
    journal,
  })
  disposers.push(() => knowledgeGraph.stop())
  disposers.push(() => selfTrainer.stop())

  const { worldview, synthesizeWorldview } = createWorldviewService({
    settingsDir,
    memoryRecall,
    knowledgeGraph,
    modelPolicy,
    getLlm,
    modelErrorsPath,
    journal,
    logger,
    env,
    disposers,
  })

  const latestReadText = () => {
    try {
      const entries = typeof memoryRecall.recentEntries === 'function' ? memoryRecall.recentEntries() : []
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const text = entries[index] && typeof entries[index].text === 'string' ? entries[index].text : ''
        if (text.startsWith('读《')) return text
      }
      return ''
    } catch (_error) {
      return ''
    }
  }
  const readingHint = () => {
    try {
      const digest = memoryRecall.digest({})
      const out = []
      if (Array.isArray(digest.learned) && digest.learned.length > 0) {
        out.push(`自学：${String(digest.learned[digest.learned.length - 1]).slice(0, 100)}`)
      }
      if (Array.isArray(digest.shelf) && digest.shelf.length > 0) {
        out.push(`书架：${String(digest.shelf[0]).slice(0, 100)}`)
      }
      const readThought = latestReadText()
      if (readThought.length > 0) out.push(`读记：${readThought.slice(0, 110)}`)
      return out
    } catch (_error) {
      return []
    }
  }
  const readingDigest = () => {
    try {
      const digest = memoryRecall.digest({})
      const readThought = latestReadText()
      if (readThought.length > 0 && Array.isArray(digest.thoughts)) {
        digest.thoughts = [readThought, ...digest.thoughts.filter((item) => item !== readThought)].slice(0, 4)
      }
      return digest
    } catch (_error) {
      return null
    }
  }

  const memoryConsolidator = createMemoryConsolidatorService({
    layers: memoryLayers,
    memoryDir,
    getLlm,
    modelPolicy,
    modelErrorsPath,
    logger,
    env,
    heartbeat,
    serviceRuntime,
  })
  logger?.info?.(`[dsh-little-whale] 分层记忆：${layersPath}（每日整合）`)

  return {
    layersPath,
    memoryLayers,
    memoryRecall,
    knowledgeGraph,
    selfTrainer,
    relationship,
    emotional,
    commitments,
    nightlyConsolidator,
    affectState,
    emotionalEpisodes,
    worldview,
    synthesizeWorldview,
    readingHint,
    readingDigest,
    memoryConsolidator,
  }
}
