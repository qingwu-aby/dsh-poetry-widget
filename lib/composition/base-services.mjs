// @ts-check
// lib/composition/base-services.mjs —— 基础状态/记忆服务组装（W1）
import path from 'node:path'
import { createGrowthMetrics } from '../domain/being/growth-metrics.mjs'
import { createGuiInbox } from '../domain/chat/gui-inbox.mjs'
import { createMemoryJournal } from '../domain/memory/memory-journal.mjs'
import { resolveMemoryLayersPath } from '../domain/memory/memory-layers.mjs'
import { createSelfEvents, resolveEventsPath } from '../domain/being/self-events.mjs'
import { createLifecycle, resolveLifecyclePath } from '../domain/being/self-lifecycle.mjs'
import { createSelfProjects, resolveProjectsPath } from '../domain/being/self-projects.mjs'
import { createWorldFeedback } from '../domain/learning/world-feedback.mjs'

/**
 * 创建不依赖宿主/模型的基础服务。
 * @param {{ env: NodeJS.ProcessEnv, home: string, settingsDir: string, memoryDir: string, logger: object|null }} deps
 */
export function createBaseServices({ env, home, settingsDir, memoryDir, logger }) {
  const guiInbox = createGuiInbox({ file: path.join(settingsDir, 'gui-inbox.json') })
  const selfProjects = createSelfProjects({ file: resolveProjectsPath(env, home), logger })
  const selfEvents = createSelfEvents({ file: resolveEventsPath(env, home), logger })
  const growthMetrics = createGrowthMetrics({
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    layersPath: resolveMemoryLayersPath(env, home),
    learningLogPath: path.join(memoryDir, 'learning-log.md'),
    projectsPath: resolveProjectsPath(env, home),
  })
  const journal = createMemoryJournal({ dir: memoryDir, logger })
  const worldFeedback = createWorldFeedback({ logger })
  const selfLifecycle = createLifecycle({ file: resolveLifecyclePath(env, home), logger, env })
  return { guiInbox, selfProjects, selfEvents, growthMetrics, journal, worldFeedback, selfLifecycle }
}
