// 通用攻略回路装配：B站工具桥 + 主题中枢 + guide loop。
import path from 'node:path'
import { createGuideLoop } from '../core/guide-loop.mjs'
import { createTopicHub } from '../core/topic-hub.mjs'
import { createBiliGuideSource } from './bili-bridge.mjs'

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
  const biliSource = createBiliGuideSource({
    getHostTool,
    getLlm: options.getLlm,
    policy: options.policy ?? null,
    modelErrorsPath: options.modelErrorsPath ?? null,
    logger: options.logger ?? null,
  })
  const guideLoop = createGuideLoop({ ...biliSource, topicHub, logger: options.logger ?? null })
  return { topicHub, guideLoop, getHostTool }
}
