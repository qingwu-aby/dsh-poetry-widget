// lib/composition/memory-services.mjs —— 分层记忆/检索/整合/中枢组装（W2）
import path from 'node:path'
import { resolveProjectsPath } from '../domain/being/self-projects.mjs'
import { createMemoryHub } from '../domain/memory/memory-hub.mjs'
import {
  createMemoryConsolidator,
  createMemoryLayers,
  resolveMemoryLayersPath,
} from '../domain/memory/memory-layers.mjs'
import { createMemoryRecall } from '../domain/memory/memory-recall.mjs'
import { resolveVideoCoursesDir } from '../video-courses.mjs'

export function createMemoryStack({
  env,
  home,
  memoryDir,
  topicsPath,
  topicBank,
  topicsArchivePath,
  feelingsPath,
  logger,
}) {
  const layersPath = resolveMemoryLayersPath(env, home)
  const memoryLayers = createMemoryLayers({ file: layersPath, logger })
  const memoryRecall = createMemoryRecall({
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
    topics: topicBank,
    topicsArchivePath,
    feelingsPath,
    layersPath,
    projectsPath: resolveProjectsPath(env, home),
    videoCoursesDir: resolveVideoCoursesDir(env, home),
  })
  return { layersPath, memoryLayers, memoryRecall }
}

export function createMemoryConsolidatorService({
  layers,
  memoryDir,
  getLlm,
  modelPolicy,
  modelErrorsPath,
  logger,
  env,
  heartbeat,
  serviceRuntime,
}) {
  const consolidator = createMemoryConsolidator({
    layers,
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    env,
  })
  consolidator.start({ heartbeat: true })
  heartbeat.add('记忆整合', () => consolidator.tick())
  serviceRuntime.register('记忆整合', {
    dispose: () => {
      try {
        consolidator.dispose()
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] 记忆整合清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
  return consolidator
}

export function createMemoryHubService({ env, home, logger, heartbeat, serviceRuntime }) {
  const memoryHub = createMemoryHub({ env, home, logger })
  const memoryRecovery = memoryHub.recover()
  memoryHub.start({ heartbeat: true })
  heartbeat.add('记忆中枢', () => memoryHub.maybeBackup())
  serviceRuntime.register('记忆中枢', {
    dispose: () => {
      try {
        memoryHub.dispose()
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] 记忆中枢清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
  return { memoryHub, memoryRecovery, memorySnapshot: memoryHub.snapshot() }
}
