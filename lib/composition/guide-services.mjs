// 通用攻略回路装配：B站工具桥 + 主题中枢 + guide loop。
import path from 'node:path'
import { createCapabilityProposals } from '../core/capability-proposals.mjs'
import { createGuideLoop } from '../core/guide-loop.mjs'
import { createTopicHub } from '../core/topic-hub.mjs'
import { createVideoSummary } from '../domain/learning/video-summary.mjs'
import { createMinecraftToolRegistry } from '../domain/play/minecraft-tool-registry.mjs'
import { MINECRAFT_TOOLS } from '../domain/play/minecraft-world.mjs'
import { createToolSkills } from '../domain/play/tool-skills.mjs'
import { createBiliGuideSource } from './bili-bridge.mjs'
import { createBiliMcpSource } from './bili-mcp.mjs'
import { createWikiSummarize } from './wiki-summarize.mjs'

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createGuideServices(options = {}) {
  const settingsDir = typeof options.settingsDir === 'string' ? options.settingsDir : ''
  const getHostService = typeof options.getHostService === 'function' ? options.getHostService : () => null
  const getHostTool = (name) => {
    try {
      const tools = getHostService('tools')
      if (!tools || typeof tools.get !== 'function') return null
      return tools.get(name) ?? null
    } catch {
      return null
    }
  }
  const topicHub = createTopicHub({ file: settingsDir ? path.join(settingsDir, 'guides.json') : '' })
  const home = path.resolve(settingsDir, '..', '..')
  const mcpSource = createBiliMcpSource({ home, logger: options.logger ?? null })
  const hostSource = createBiliGuideSource({
    getHostTool,
    getLlm: options.getLlm,
    policy: options.policy ?? null,
    modelErrorsPath: options.modelErrorsPath ?? null,
    logger: options.logger ?? null,
  })
  const biliSource = mcpSource.available ? { ...mcpSource, summarize: hostSource.summarize } : hostSource
  const guideLoop = createGuideLoop({ ...biliSource, topicHub, logger: options.logger ?? null })
  const toolRegistry = createMinecraftToolRegistry({
    file: settingsDir ? path.join(settingsDir, 'minecraft-tools.json') : '',
    allowedTools: new Set(MINECRAFT_TOOLS.map((tool) => tool.name)),
    logger: options.logger ?? null,
  })
  const capabilityProposals = createCapabilityProposals({
    file: settingsDir ? path.join(settingsDir, 'capability-proposals.json') : '',
  })
  const toolSkills = createToolSkills({
    file: settingsDir ? path.join(settingsDir, 'tool-skills.json') : '',
    logger: options.logger ?? null,
  })
  const wikiSummarize = createWikiSummarize({
    getLlm: options.getLlm,
    policy: options.policy ?? null,
    modelErrorsPath: options.modelErrorsPath ?? null,
  })
  const videoSummary = createVideoSummary({
    getLlm: options.getLlm,
    policy: options.policy ?? null,
    modelErrorsPath: options.modelErrorsPath ?? null,
    logger: options.logger ?? null,
  })
  guideLoop.capabilityProposals = capabilityProposals
  guideLoop.toolRegistry = toolRegistry
  return {
    topicHub,
    guideLoop,
    toolRegistry,
    capabilityProposals,
    toolSkills,
    toolExperience: toolSkills.experience,
    videoSummary,
    wikiSummarize,
    getHostTool,
  }
}
