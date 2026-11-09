// lib/composition/model-services.mjs —— 声音/飞花等模型相关服务组装（W2）
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createFeihuaFullService } from '../feihua-full.mjs'
import { createLocalVoice } from '../domain/voice/local-voice.mjs'
import { createVoiceService, resolveVoicePath } from '../domain/voice/voice-memory.mjs'

export function createLocalVoiceService({ env, localVoiceMode, logger }) {
  return createLocalVoice({
    enabled: localVoiceMode === 'on' || localVoiceMode === 'chat' || localVoiceMode === 'mood',
    baseURL: String(env.DSH_POETRY_LOCAL_VOICE_URL || 'http://127.0.0.1:8080/v1'),
    model: String(env.DSH_POETRY_LOCAL_VOICE_MODEL || 'default_model'),
    logger,
  })
}

export function createFeihuaService({ dir, logger }) {
  const service = createFeihuaFullService({ dir, logger })
  if (existsSync(dir)) logger?.info?.(`[dsh-little-whale] 飞花令全量校验目录：${dir}`)
  return service
}

export function createVoice({ env, home, memoryDir, getLlm, getSelection, modelPolicy, modelErrorsPath, logger, serviceRuntime }) {
  const voiceService = createVoiceService({
    getLlm,
    getSelection,
    policy: modelPolicy,
    modelErrorsPath,
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    voicePath: resolveVoicePath(env, home),
    minSampleTs: Math.max(1, Math.floor(Date.now() / 1000) * 1000),
    logger,
  })
  voiceService.start()
  logger?.info?.(`[dsh-little-whale] 声音档案：${voiceService.voicePath}`)
  serviceRuntime.register('声音档案', {
    dispose: () => {
      try {
        voiceService.dispose()
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] 声音档案清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
  return voiceService
}
