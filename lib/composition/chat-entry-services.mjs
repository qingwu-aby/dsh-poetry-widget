// lib/composition/chat-entry-services.mjs —— 聊天入口/推送/手动阅读装配（v0.2.3 从 domain-services 拆出）
import { ensureChatToken, resolveChatTokenPath } from '../domain/chat/chat-bridge.mjs'
import { createChatRuntime } from './chat-runtime.mjs'
import { createManualReadingService } from './life-services.mjs'

/**
 * @param {{
 *   env: object, home: string, settingsDir: string, memoryDir: string,
 *   getLlm: Function, modelPolicy: object, journal: object, selfState: object,
 *   memoryRecall: object, voiceService: object, emotionalEpisodes: object,
 *   selfEvents: object, worldFeedback: object, modelErrorsPath: string, logger: object|null,
 *   guiInbox: object, selfProjects: object, moodAiService: object, readingHint: Function,
 *   getHostService: Function, selfWorks: object, selfMetabolism: object, disposers: Function[],
 * }} deps
 */
export function createChatEntryServices(deps) {
  const {
    env,
    home,
    settingsDir,
    memoryDir,
    getLlm,
    modelPolicy,
    journal,
    selfState,
    memoryRecall,
    voiceService,
    emotionalEpisodes,
    selfEvents,
    worldFeedback,
    modelErrorsPath,
    logger,
    guiInbox,
    selfProjects,
    moodAiService,
    readingHint,
    getHostService,
    selfWorks,
    selfMetabolism,
    disposers,
  } = deps

  const chatTokenFile = resolveChatTokenPath(env, home)
  ensureChatToken(chatTokenFile)
  const chatRuntime = createChatRuntime({
    getLlm,
    modelPolicy,
    journal,
    selfState,
    memoryRecall,
    voiceService,
    emotionalEpisodes,
    selfEvents,
    worldFeedback,
    modelErrorsPath,
    logger,
    settingsDir,
    home,
    env,
    guiInbox,
    selfProjects,
    moodAiService,
    readingHint,
    getHostService,
    selfWorks,
    selfMetabolism,
  })
  disposers.push(() => chatRuntime.dispose())
  const { chatBridge, attention, guiPush, outbox, proactiveChat, workLoop, queueGuiMessage } = chatRuntime

  const { manualTokenFile, manualReading } = createManualReadingService({
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
  })

  return {
    chatTokenFile,
    chatRuntime,
    chatBridge,
    attention,
    guiPush,
    outbox,
    proactiveChat,
    workLoop,
    queueGuiMessage,
    manualTokenFile,
    manualReading,
  }
}
