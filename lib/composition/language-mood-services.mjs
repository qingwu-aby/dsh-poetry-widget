// lib/composition/language-mood-services.mjs —— 语言/心情/动作策略装配（v0.2.3 从 domain-services 拆出）
import path from 'node:path'
import { createActionPolicy } from '../domain/being/action-policy.mjs'
import { createInternalRules } from '../domain/being/internal-rules.mjs'
import { createStyleExemplars } from '../domain/voice/style-exemplars.mjs'
import { resolveFeihuaFullDir } from '../domain/works/feihua-full.mjs'
import { createFeihuaService, createVoice } from './model-services.mjs'
import { createMoodService, createSelfTalk } from './mood-talk-services.mjs'

/**
 * @param {{
 *   env: object, home: string, settingsDir: string, memoryDir: string, packageRoot: string,
 *   getLlm: Function, getSelection: Function, modelPolicy: object, modelErrorsPath: string,
 *   logger: object|null, serviceRuntime: object, autonomy: object, topicBank: object,
 *   memoryRecall: object, selfEvents: object, selfProjects: object, journal: object,
 *   affect: object, feelingBank: object,
 * }} deps
 */
export function createLanguageMoodServices(deps) {
  const {
    env,
    home,
    settingsDir,
    memoryDir,
    packageRoot,
    getLlm,
    getSelection,
    modelPolicy,
    modelErrorsPath,
    logger,
    serviceRuntime,
    autonomy,
    topicBank,
    memoryRecall,
    selfEvents,
    selfProjects,
    journal,
    affect,
    feelingBank,
  } = deps

  const voiceService = createVoice({
    env,
    home,
    memoryDir,
    getLlm,
    getSelection,
    modelPolicy,
    modelErrorsPath,
    logger,
    serviceRuntime,
  })
  const actionPolicy = createActionPolicy({ file: path.join(settingsDir, 'action-policy.json') })
  const styleExemplars = createStyleExemplars({
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    chatHistoryPath: path.join(settingsDir, 'chat-history.json'),
  })
  const selfTalkService = createSelfTalk({
    getLlm,
    getSelection,
    logger,
    autonomy,
    env,
    topicBank,
    memoryRecall,
    getStyleExemplars: (opts) => styleExemplars.pick(opts),
    selfEvents,
    selfProjects,
    journal,
    voiceService,
    modelPolicy,
    modelErrorsPath,
  })
  const internalRules = createInternalRules({ file: path.join(settingsDir, 'internal-rules.json') })
  const { petMediaDir, petCatalog, moodAiService } = createMoodService({
    env,
    packageRoot,
    logger,
    getLlm,
    getSelection,
    modelPolicy,
    modelErrorsPath,
    feelingBank,
    affect,
  })
  const feihuaFullDir = resolveFeihuaFullDir(env, packageRoot)
  const feihuaFullService = createFeihuaService({ dir: feihuaFullDir, logger })
  return {
    voiceService,
    actionPolicy,
    styleExemplars,
    selfTalkService,
    internalRules,
    petMediaDir,
    petCatalog,
    moodAiService,
    feihuaFullDir,
    feihuaFullService,
  }
}
