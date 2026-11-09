// lib/composition/mood-talk-services.mjs —— 碎碎念与模型心情组装（W2）
import { createMoodAiService, loadMoodCatalog } from '../domain/emotion/mood-ai.mjs'
import {
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  petMediaDirExists,
  resolvePetMediaDir,
} from '../domain/works/pet-media.mjs'
import { createSelfTalkService } from '../self-talk.mjs'

export function createSelfTalk(deps) {
  return createSelfTalkService({
    getLlm: deps.getLlm,
    getSelection: deps.getSelection,
    logger: deps.logger,
    themeProbability: deps.autonomy.selfTalkThemeProbability,
    topicsEnabled: String(deps.env.DSH_POETRY_TALK_TOPICS ?? '').toLowerCase() === 'on',
    topics: deps.topicBank,
    recall: deps.memoryRecall,
    events: deps.selfEvents,
    onEventSatiated: (event) => {
      const topic = event && typeof event.topic === 'string' ? event.topic : ''
      if (topic.length === 0) return undefined
      try {
        if (typeof deps.selfProjects.markStale === 'function') deps.selfProjects.markStale(`叙事饱和：${topic}`)
      } catch {
        /* ignore */
      }
      return deps.journal.append({ kind: 'thought', text: `这件事我先放下了：${topic}` }).catch(() => undefined)
    },
    voice: () => deps.voiceService.get(),
    refreshVoice: () => deps.voiceService.refreshNow(),
    policy: deps.modelPolicy,
    modelErrorsPath: deps.modelErrorsPath,
  })
}

export function createMoodService(deps) {
  const petMediaDir = resolvePetMediaDir(deps.env, deps.packageRoot)
  const petCatalog = loadPetMediaCatalog({ dir: petMediaDir, logger: deps.logger })
  if (petCatalog.ok === true) {
    deps.logger?.info?.(`[dsh-little-whale] 心情动画素材：${petMediaDir}（${petCatalog.entries.length} 个视频）`)
  } else if (petMediaDirExists(petMediaDir)) {
    deps.logger?.warn?.(`[dsh-little-whale] 心情动画素材不可用：${petCatalog.message}（mood-ai 仅用静态图）`)
  } else {
    deps.logger?.warn?.(`[dsh-little-whale] 心情动画素材目录不存在（mood-ai 仅用静态图）：${petMediaDir}`)
  }

  const moodCatalog = loadMoodCatalog()
  if (moodCatalog.ok !== true) deps.logger?.warn?.(`[dsh-little-whale] 心情图鉴不可用：${moodCatalog.message}`)
  const moodCatalogForAi =
    petCatalog.ok === true && petCatalog.entries.length > 0
      ? mergePetMediaIntoMoodCatalog(moodCatalog.ok === true ? moodCatalog.catalog : null, petCatalog.entries)
      : moodCatalog.ok === true
        ? moodCatalog.catalog
        : null

  const moodAiService = createMoodAiService({
    getLlm: deps.getLlm,
    getSelection: deps.getSelection,
    catalog: moodCatalogForAi,
    logger: deps.logger,
    policy: deps.modelPolicy,
    modelErrorsPath: deps.modelErrorsPath,
    feelings: deps.feelingBank,
  })
  return { petMediaDir, petCatalog, moodCatalogForAi, moodAiService }
}
