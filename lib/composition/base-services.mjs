// lib/composition/base-services.mjs —— 基础状态/记忆服务组装（W1）
import path from 'node:path'
import { createGrowthMetrics } from '../growth-metrics.mjs'
import { createGuiInbox } from '../gui-inbox.mjs'
import { createMemoryJournal } from '../memory-journal.mjs'
import { resolveMemoryLayersPath } from '../memory-layers.mjs'
import { createSelfEvents, resolveEventsPath } from '../self-events.mjs'
import { createLifecycle, resolveLifecyclePath } from '../self-lifecycle.mjs'
import { createSelfProjects, resolveProjectsPath } from '../self-projects.mjs'
import { createWorldFeedback } from '../world-feedback.mjs'

/**
 * 创建不依赖宿主/模型的基础服务。
 * @param {{ env: object, home: string, settingsDir: string, memoryDir: string, logger: object|null }} deps
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
