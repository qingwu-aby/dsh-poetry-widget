// tests/domains/model-policy.test.mjs —— 模型策略/候选/opencode（W3 拆分）
// tests/host.test.mjs —— 宿主半区单测（其余部分；共享脚手架在 tests/helpers/harness.mjs）
import * as harness from '../helpers/harness.mjs'
// tests/host.test.mjs —— 宿主半区单测（node:test，不依赖真实 DSH 宿主）。
//
// 覆盖：设置校验/clamp/损坏回退/原子写、bootstrap 形状与今日诗确定性、
//       data 缺失/损坏降级、about 脱敏、信任栅栏 403/401、路由 200/400/403/405、静态资源越界防护。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'

import { name as pluginName, apply as pluginApply } from '../../index.js'
import { createAssetHandler, resolveAssetPath } from '../../lib/legacy/assets.mjs'
import { createDataStore, pickPoemIndex } from '../../lib/legacy/data-store.mjs'
import { formatLocalDate, maskPath, readPackageMeta } from '../../lib/paths.mjs'
import { createRouteTable } from '../../lib/legacy/routes.mjs'
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  normalizeSettings,
  resolveSettingsPath,
  validateSettingsPatch,
} from '../../lib/settings-store.mjs'
import { createTrustFence, isLoopbackHostname } from '../../lib/legacy/trust.mjs'
import {
  DEFAULT_CITY as WEATHER_DEFAULT_CITY,
  createWeatherService,
  mapWeather,
  normalizeCity,
} from '../../lib/legacy/weather.mjs'
import {
  MAX_ACTIVE_GAP_MS,
  MOOD_ACTIVITY_IDLE_MS,
  MOOD_ACTIVITY_LABELS,
  MOOD_EVENT_TYPES,
  MOOD_RECENT_TOOL_LIMIT,
  MOOD_STAT_KEYS,
  applySessionEvent,
  classifyToolName,
  createEmptyMoodState,
  createMoodTracker,
  describeRecentActivity,
  localDateKey,
  toMoodResponse,
  zeroMoodResponse,
} from '../../lib/legacy/mood.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_MAX_AGE_MS,
  readExperience,
  resolveExperiencePath,
} from '../../lib/legacy/experience.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  isSafeWebmRelative,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  resolvePetMediaDir,
} from '../../lib/legacy/pet-media.mjs'
import {
  createFeihuaFullService,
  isValidFeihuaChar,
  resolveFeihuaFullDir,
} from '../../lib/feihua-full.mjs'
import {
  JOURNAL_MURMUR_MIN_INTERVAL_MS,
  MEMORY_JOURNAL_HEADER,
  createMemoryJournal,
  formatJournalTime,
  resolveMemoryDir,
} from '../../lib/legacy/memory-journal.mjs'
import {
  MOOD_AI_CACHE_TTL_MS,
  MOOD_AI_EMOTION_VOCAB,
  MOOD_AI_TIMEOUT_MS,
  MOOD_AI_SYSTEM_PROMPT,
  MOOD_AI_TEMPERATURE,
  MOOD_MIN_CANDIDATES,
  MOOD_RECENT_IMAGES_MAX,
  buildMoodPrompt,
  createMoodAiService,
  isWhenActive,
  loadMoodCatalog,
  normalizeMoodCatalog,
  normalizeRecentImageList,
  parseMoodResult,
  resolveFestivalAvailability,
  resolveMoodCandidates,
  shuffleCopy,
} from '../../lib/legacy/mood-ai.mjs'
import {
  MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_DSH_OPENCODE_PROVIDER,
} from '../../lib/legacy/model-policy.mjs'
import {
  MODEL_ERRORS_MAX_LINES,
  MODEL_ERRORS_MESSAGE_MAX,
  MODEL_ERRORS_ROUTE,
  appendModelError,
  buildModelErrorRecord,
  createModelErrorsHandler,
  readModelErrors,
  resolveModelErrorsPath,
} from '../../lib/legacy/model-errors.mjs'
import {
  MODEL_POLICY_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_OPENCODE_PROVIDER,
  MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS,
  MODEL_POLICY_SAFE_FALLBACK,
  MODEL_POLICY_DEFAULTS,
  MODEL_POLICY_DEFAULT_EFFORTS,
  MODEL_POLICY_EFFORTS,
  MODEL_POLICY_ROLES,
  createModelPolicy,
  describeModelPolicy,
  normalizeEffort,
  resolveCandidateMaxTokens,
} from '../../lib/legacy/model-policy.mjs'
import {
  VOICE_EXEMPLAR_MAX_CHARS,
  VOICE_REFRESH_INTERVAL_MS,
  VOICE_TIMEOUT_MS,
  buildVoiceRefreshPrompt,
  collectVoiceSamples,
  createVoiceService,
  normalizeVoiceFile,
  parseVoiceResult,
  resolveVoicePath,
} from '../../lib/legacy/voice-memory.mjs'
import {
  MEMORY_RECALL_JOURNAL_LINES,
  bigramJaccard,
  chineseBigrams,
  createMemoryRecall,
  extractRecallKeywords,
  formatMemoryDigest,
  pickRelevantLearning,
  readLearningSections,
  readRecentJournalEntries,
  resolveMemoryRecallPaths,
} from '../../lib/legacy/memory-recall.mjs'
import {
  MEMORY_BACKUP_INTERVAL_MS,
  MEMORY_BACKUP_MAX,
  MEMORY_BACKUP_ROUTE,
  MEMORY_ROUTE,
  createMemoryBackupHandler,
  createMemoryHub,
  createMemorySnapshotHandler,
  resolveMemoryHubPaths,
} from '../../lib/legacy/memory-hub.mjs'
import {
  SELF_DRIVE_ACTIONS,
  buildSelfDrivePrompt,
  createSelfDrive,
  parseSelfDriveResult,
} from '../../lib/legacy/self-drive.mjs'
import {
  SELF_BEING_VERSION,
  applyBeingEvent,
  composeElapsed,
  createSelfBeing,
  defaultSelfBeing,
  describeTimeline,
  formatBeingLine,
  normalizeSelfBeing,
  resolveSelfBeingPath,
} from '../../lib/legacy/self-being.mjs'
import {
  FEELING_DESC_MAX,
  FEELING_NAME_MAX,
  appendFeeling,
  loadFeelingBank,
  normalizeFeeling,
  parseNewFeeling,
  readFeelingFile,
  resolveFeelingsPath,
} from '../../lib/legacy/feelings.mjs'
import {
  SELF_GROWTH_REFLECT_INTERVAL_MS,
  SELF_GROWTH_TICK_MS,
  SELF_GROWTH_TIMEOUT_MS,
  SELF_PROBE_GAP_MS,
  buildLearnPrompt,
  buildProbeProposalPrompt,
  buildProbeVerdictPrompt,
  buildReflectPrompt,
  createSelfGrowth,
  normalizeTopicCandidate,
  parseLearnResult,
  parseProbeProposal,
  parseProbeVerdict,
  parseReflectResult,
} from '../../lib/legacy/self-growth.mjs'
import {
  SELF_WANDER_ALLOWED_HOSTS,
  SELF_WANDER_ALLOWED_SUFFIXES,
  SELF_WANDER_GAP_MS,
  buildWanderPrompt,
  createSelfWander,
  fetchRandomPage,
  isJunkWanderPage,
  parseWanderResult,
  wanderRandomUrl,
} from '../../lib/legacy/self-wander.mjs'
import {
  SELF_READING_GAP_MS,
  SELF_READING_RANDOM_API,
  SELF_READING_WORKS,
  buildReadingPrompt,
  cleanReadingHtml,
  createSelfReading,
  fetchRandomReadingExcerpt,
  fetchReadingText,
  isAllowedReadingHost,
  isJunkReadingPage,
  parseReadingResult,
  pickReadingExcerpt,
  readingApiUrl,
} from '../../lib/legacy/self-reading.mjs'
import { runMemoryMigrations } from '../../lib/legacy/memory-migrations.mjs'
import { createDshHost } from '../../lib/legacy/dsh-host.mjs'
import { createSelfProjects, projectCanRetry, projectProgressAt, projectStage } from '../../lib/legacy/self-projects.mjs'
import { createGuiInbox, pushGuiInbox, readGuiInbox, GUI_INBOX_MAX } from '../../lib/legacy/gui-inbox.mjs'
import { normalizeVideoCourse, readVideoCourses, readVideoCoursesShelf } from '../../lib/video-courses.mjs'
import { createSelfEvents } from '../../lib/legacy/self-events.mjs'
import { createMetabolism } from '../../lib/self-metabolism.mjs'
import { createWorldFeedback } from '../../lib/legacy/world-feedback.mjs'
import { PRESENCE_ROUTE, createPresenceHandler } from '../../lib/legacy/presence.mjs'
import { createChatBridge } from '../../lib/legacy/chat-bridge.mjs'
import { createCurriculum } from '../../lib/legacy/self-curriculum.mjs'
import { createMediaBudget } from '../../lib/legacy/media-budget.mjs'
import { createAttentionStore } from '../../lib/legacy/attention.mjs'
import { createOutbox } from '../../lib/legacy/outbox.mjs'
import { constitutionLines, PROMPT_LAYERS_VERSION } from '../../lib/legacy/prompt-layers.mjs'
import { fetchShugeEntry, searchShuge } from '../../lib/shuge.mjs'
import { createLifecycle } from '../../lib/legacy/self-lifecycle.mjs'
import { createTwinBridge } from '../../lib/legacy/twin-bridge.mjs'
import { createTwinResearch } from '../../lib/legacy/twin-research.mjs'
import { createGrowthMetrics } from '../../lib/growth-metrics.mjs'
import { createSelfWorks, createWorksHandler, sanitizeWorkSvg } from '../../lib/legacy/self-works.mjs'
import { createManualReadHandler, createManualReading, ensureManualToken } from '../../lib/manual-reading.mjs'
import { seedMemoryBaseline } from '../../lib/legacy/memory-baseline.mjs'
import { createHeartbeat } from '../../lib/legacy/heartbeat.mjs'
import { createModelBudget, createModelGate } from '../../lib/legacy/model-budget.mjs'
import { createDeepSeekWeb } from '../../lib/deepseek-web.mjs'
import {
  createWebAccess,
  extractHtmlTitle,
  extractPageLinks,
  extractReadableText,
  fetchPublicPage,
  isPrivateAddress,
  parseDuckDuckGoResults,
  parseRssFeed,
  parseSearxResults,
  parseWikipediaSearchPayload,
  resolvePublicAddress,
  validatePublicUrl,
} from '../../lib/legacy/safe-web.mjs'
import { callModelForRole, configureModelRuntime, resetModelRuntime } from '../../lib/legacy/llm-call.mjs'
import {
  buildConsolidationPrompt,
  countJournalEntries,
  createMemoryConsolidator,
  createMemoryLayers,
  parseConsolidationResult,
  readMemoryLayers,
  resolveMemoryLayersPath,
} from '../../lib/legacy/memory-layers.mjs'
import {
  SELF_NETLANG_GAP_MS,
  SELF_NETLANG_SOURCES,
  buildNetlangPrompt,
  createSelfNetlang,
  fetchNetlangTitles,
  parseGithubTrendingHtml,
  parseNetlangPayload,
  parseNetlangResult,
} from '../../lib/legacy/self-netlang.mjs'
import {
  SELF_ACTION_LABELS,
  SELF_ACTION_TEXTS,
  SELF_ACTIONS_MAX_ENTRIES,
  SELF_ACTIONS_MIN_GAP_MS,
  chooseSelfAction,
  createSelfActions,
  normalizeSelfAction,
  normalizeSelfActionsFile,
  resolveSelfActionsPath,
} from '../../lib/legacy/self-actions.mjs'
import {
  SELF_STATE_DEFAULTS,
  SELF_STATE_MAX_TICK_MINUTES,
  SELF_STATE_ROUTE,
  advanceSelfState,
  applySelfEvent,
  clampSelfValue,
  createSelfState,
  createSelfStateHandler,
  defaultSelfState,
  describeSelfState,
  formatSelfStateLine,
  normalizeSelfState,
  resolveSelfStatePath,
} from '../../lib/legacy/self-state.mjs'
import {
  LEARNED_TOPIC_RECENCY_BONUS,
  SELF_TALK_TOPIC_RECENT_MAX,
  SELF_TALK_TOPIC_TOP_N,
  buildTopicPromptLine,
  loadTopicBank,
  compactTopicBankForArchive,
  mergeLearnedTopicIntoBank,
  parseTopicBank,
  pickSelfTalkTopic,
  resolveTopicsArchivePath,
  resolveTopicsPath,
  scoreSelfTalkTopic,
  searchArchivedTopics,
  topicRecencyWeight,
} from '../../lib/legacy/self-talk-topics.mjs'
import {
  SELF_TALK_RECENT_MAX,
  SELF_TALK_TIMEOUT_MS,
  selectDiverseSelfTalkLines,
  selfTalkSimilarity,
  SELF_TALK_TEMPERATURE,
  SELF_TALK_THEMES,
  SELF_TALK_SYSTEM_PROMPT,
  buildSelfTalkPrompt,
  createSelfTalkService,
  parseRecentQuery,
  parseSelfTalkLines,
  pickSelfTalkTheme,
} from '../../lib/self-talk.mjs'

// ---------------------------------------------------------------------------
// 测试基础设施
// ---------------------------------------------------------------------------

const {
  POEM_IDS,
  DATA_VERSION,
  FIXED_NOW,
  makeTmpDir,
  writeJson,
  writeFixtureData,
  MockResponse,
  mockRequest,
  createHarness,
  makeWeatherFetch,
  makeMockLlm,
  SELF_TALK_SELECTION,
  SELF_TALK_LINES_A,
  SELF_TALK_LINES_B,
  makeSelfTalkHarness,
  cachedRealMoodCatalog,
  realMoodCatalog,
  makeMoodCatalogFixture,
  makeMoodAiHarness,
  expectedPoemId,
  MOOD_T0,
  moodEvent,
  emptyStatsForTest,
  readJournalJsonl,
  makeMoodCatalogWithVideos,
  writeExperienceFile,
  makeGrowthHarness,
  makeGrowthLlm,
  promptCatalogRowFiles,
  writeRecallJournal,
  makeLongVoiceProfile,
  VOICE_PROFILE_SAMPLE,
  writeVoiceFile,
} = harness


// ---------------------------------------------------------------------------
// M49：模型策略（按 role 选 provider/model/reasoningEffort）
// ---------------------------------------------------------------------------

test('model-policy M49：默认 effort/selection/env 覆盖/非法回退/缺失', () => {
  assert.deepEqual(MODEL_POLICY_ROLES, ['mood', 'selfTalk', 'growth', 'voice', 'drive', 'probe', 'wander', 'read', 'netlang', 'consolidate'])
  assert.deepEqual(MODEL_POLICY_EFFORTS, ['off', 'low', 'high', 'max'])
  assert.deepEqual(MODEL_POLICY_DEFAULT_EFFORTS, {
    mood: 'low',
    selfTalk: 'high',
    growth: 'high',
    voice: 'high',
    drive: 'low',
    probe: 'low',
    wander: 'low',
    read: 'low',
    netlang: 'low',
    consolidate: 'low',
  })
  assert.equal(MODEL_POLICY_DEFAULTS.roles.mood.reasoningEffort, 'low')
  assert.equal(MODEL_POLICY_DEFAULTS.roles.selfTalk.reasoningEffort, 'high')

  const selection = () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' })
  const policy = createModelPolicy({ env: {}, getSelection: selection, getProviders: () => [] })
  assert.deepEqual(policy.resolve('mood'), { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' })
  assert.deepEqual(policy.resolve('selfTalk'), { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' })
  assert.deepEqual(policy.resolve('growth').reasoningEffort, 'high')
  assert.deepEqual(policy.resolve('voice').reasoningEffort, 'high')
  assert.equal(policy.resolve('unknown'), null)
  const described = describeModelPolicy(policy)
  assert.match(described, /心情=deepseek-account\/deepseek-flash\(low\)/)
  assert.match(described, /碎碎念=deepseek-account\/deepseek-flash\(high\)/)
  assert.match(described, /成长=/)
  assert.match(described, /声音=/)

  // env 全局模型 + 各 role effort 覆盖；非法 effort 回退默认
  const env = {
    DSH_POETRY_MODEL_PROVIDER: 'openrouter',
    DSH_POETRY_MODEL: 'gpt-x',
    DSH_POETRY_REASONING_MOOD: 'max',
    DSH_POETRY_REASONING_SELF_TALK: 'low',
    DSH_POETRY_REASONING_GROWTH: 'banana',
    DSH_POETRY_REASONING_VOICE: 'off',
  }
  const envPolicy = createModelPolicy({ env, getSelection: selection, getProviders: () => [] })
  assert.deepEqual(envPolicy.resolve('mood'), { provider: 'openrouter', model: 'gpt-x', reasoningEffort: 'max' })
  assert.equal(envPolicy.resolve('selfTalk').reasoningEffort, 'low')
  assert.equal(envPolicy.resolve('growth').reasoningEffort, 'high', '非法 env effort 回退默认')
  assert.equal(envPolicy.resolve('voice').reasoningEffort, 'off')
  assert.equal(envPolicy.resolve('drive').reasoningEffort, 'low', '自处默认 low')
  assert.equal(envPolicy.resolve('probe').reasoningEffort, 'low', '试探默认 low')
  assert.equal(envPolicy.resolve('wander').reasoningEffort, 'low', '溜达默认 low')
  assert.equal(envPolicy.resolve('read').reasoningEffort, 'low', '读小说默认 low')
  assert.equal(envPolicy.resolve('netlang').reasoningEffort, 'low', '看大家说话默认 low')
  assert.equal(envPolicy.resolve('consolidate').reasoningEffort, 'low', '记忆整合默认 low')

  // 仅 env 提供 provider/model（selection 缺失）也可用
  const envOnly = createModelPolicy({
    env: { DSH_POETRY_MODEL_PROVIDER: 'p', DSH_POETRY_MODEL: 'm' },
    getSelection: () => null,
    getProviders: () => [],
  })
  assert.deepEqual(envOnly.resolve('mood'), { provider: 'p', model: 'm', reasoningEffort: 'low' })

  // 全部缺失 → null；describe 中角色 none
  const empty = createModelPolicy({ env: {}, getSelection: () => null, getProviders: () => [] })
  assert.equal(empty.resolve('mood'), null)
  assert.match(describeModelPolicy(empty), /心情=none/)
  assert.equal(normalizeEffort('HIGH'), 'high')
  assert.equal(normalizeEffort('banana', 'low'), 'low')
  assert.equal(normalizeEffort(undefined, 'low'), 'low')
  assert.equal(normalizeEffort(123, 'low'), 'low')
})

test('model-policy M49：四服务按 role 把 provider/model/reasoningEffort 传给 mock llm', async () => {
  const selection = () => ({ provider: 'deepseek-account', model: 'deepseek-flash' })
  const policy = createModelPolicy({ env: {}, getSelection: selection, getProviders: () => [] })

  // mood → low
  const mood = makeMoodAiHarness({ policy })
  await mood.service.generate({}, { force: true })
  assert.equal(mood.llm.calls[0].provider, 'deepseek-account')
  assert.equal(mood.llm.calls[0].model, 'deepseek-flash')
  assert.equal(mood.llm.calls[0].reasoningEffort, 'low')

  // selfTalk → high
  const talk = makeSelfTalkHarness({ policy })
  await talk.service.generate({})
  assert.equal(talk.llm.calls[0].reasoningEffort, 'high')
  assert.equal(talk.llm.calls[0].provider, 'deepseek-account')

  // growth → high
  const growthLlm = makeGrowthLlm([JSON.stringify({ thought: '接着自己的声音想一想，今天过得很安静。' })])
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm })
  const reflected = await growthHarness.growth.reflectNow()
  assert.equal(reflected.ok, true)
  assert.equal(growthLlm.calls[0].reasoningEffort, 'high')
  assert.equal(growthLlm.calls[0].model, 'deepseek-flash')

  // voice → high
  const voiceDir = makeTmpDir('dshp-policy-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceService = createVoiceService({
    llm: voiceLlm,
    getSelection: selection,
    policy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  const refreshed = await voiceService.refreshNow()
  assert.equal(refreshed.ok, true)
  assert.equal(voiceLlm.calls[0].reasoningEffort, 'high')
  assert.equal(voiceLlm.calls[0].provider, 'deepseek-account')

  // env 覆盖 provider/model/effort 同样生效
  const envPolicy = createModelPolicy({
    env: {
      DSH_POETRY_MODEL_PROVIDER: 'alt',
      DSH_POETRY_MODEL: 'alt-model',
      DSH_POETRY_REASONING_MOOD: 'max',
    },
    getSelection: selection,
    getProviders: () => [],
  })
  const moodEnv = makeMoodAiHarness({ policy: envPolicy })
  await moodEnv.service.generate({}, { force: true })
  assert.equal(moodEnv.llm.calls[0].provider, 'alt')
  assert.equal(moodEnv.llm.calls[0].model, 'alt-model')
  assert.equal(moodEnv.llm.calls[0].reasoningEffort, 'max')
})

test('model-policy M49：非法 effort 不透传；policy 缺失/异常回退旧行为；超时常量', async () => {
  const weirdPolicy = () => ({ provider: 'p', model: 'm', reasoningEffort: 'banana' })
  const mood = makeMoodAiHarness({ policy: weirdPolicy })
  await mood.service.generate({}, { force: true })
  assert.equal(mood.llm.calls[0].reasoningEffort, undefined, '非法 effort 不传')

  const throwingPolicy = () => {
    throw new Error('policy boom')
  }
  const talk = makeSelfTalkHarness({ policy: throwingPolicy })
  await talk.service.generate({})
  assert.equal(talk.llm.calls[0].provider, 'deepseek-account', 'policy 异常回退 selection')
  assert.equal(talk.llm.calls[0].reasoningEffort, undefined, '无 policy 行为不回归（不继承 reasoning）')

  assert.equal(SELF_TALK_TIMEOUT_MS, 35000)
  assert.equal(SELF_GROWTH_TIMEOUT_MS, 40000)
  assert.equal(VOICE_TIMEOUT_MS, 40000)
  assert.equal(MOOD_AI_TIMEOUT_MS, 20000, 'mood 超时保持不变')
})

// ---------------------------------------------------------------------------
// M51：插件模型候选（opencode-go 优先 → deepseek-account 回落）
// ---------------------------------------------------------------------------

function makeCandidatePolicy(options = {}) {
  return createModelPolicy({
    env: options.env ?? {},
    getSelection: options.getSelection ?? (() => ({ provider: 'deepseek-account', model: 'deepseek-flash' })),
    getProviders: options.getProviders,
  })
}

function makeFailoverLlm({ failProvider = 'opencode-go', partialProvider = null, timeoutProvider = null, successText }) {
  const calls = []
  const llm = {
    calls,
    stream(options) {
      calls.push(options)
      if (timeoutProvider !== null && options.provider === timeoutProvider) {
        return (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: 'text-delta', index: 0, text: successText }
        })()
      }
      if (partialProvider !== null && options.provider === partialProvider) {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"label"' }
          throw new Error('stream broke after partial text')
        })()
      }
      if (options.provider === failProvider) {
        return (async function* () {
          throw new Error('provider unavailable before any text')
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: successText }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  return llm
}

test('model-policy M51：候选顺序/关闭开关/显式覆盖/去重/探测', () => {
  const effortHigh = 'high'
  // 无法探测 → 假定 dsh-opencode-go 存在；原生 opencode-go 不再叠加（避免必然 400）
  const unknown = makeCandidatePolicy()
  const moodCandidates = unknown.resolveCandidates('mood')
  assert.equal(moodCandidates.length, 2)
  assert.deepEqual(moodCandidates[0], {
    provider: MODEL_POLICY_DSH_OPENCODE_PROVIDER,
    model: MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
    reasoningEffort: 'low',
    omitTemperature: true,
    maxTokensFloor: MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood,
  })
  assert.deepEqual(moodCandidates[1], { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' })
  assert.equal(unknown.resolve('selfTalk').reasoningEffort, effortHigh)
  assert.equal(MODEL_POLICY_OPENCODE_DEFAULT_MODEL, 'deepseek-v4.1-flash')
  assert.equal(MODEL_POLICY_OPENCODE_PROVIDER, 'opencode-go')

  // 已知 provider 列表不含 opencode-go 或含它
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => [] }).resolveCandidates('mood').map((c) => c.provider),
    ['deepseek-account'],
  )
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account'] })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['dsh-opencode-go', 'deepseek-account'],
    'dsh 可用时不再回退必然 400 的原生 opencode-go',
  )
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => ['opencode-go', 'deepseek-account'] }).resolveCandidates('mood').map((c) => c.provider),
    ['opencode-go', 'deepseek-account'],
  )
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => [{ id: 'opencode-go' }] }).resolveCandidates('mood')[0].provider,
    'opencode-go',
  )
  // Promise 视为未知（不阻塞）→ 仍包含 dsh-opencode-go / opencode-go
  assert.equal(
    makeCandidatePolicy({ getProviders: () => Promise.resolve(['whatever']) }).resolveCandidates('mood')[0].provider,
    'dsh-opencode-go',
  )

  // 显式覆盖 → 单候选
  const explicit = makeCandidatePolicy({
    env: { DSH_POETRY_MODEL_PROVIDER: 'custom-p', DSH_POETRY_MODEL: 'custom-m', DSH_POETRY_REASONING_MOOD: 'max' },
  })
  assert.deepEqual(explicit.resolveCandidates('mood'), [
    { provider: 'custom-p', model: 'custom-m', reasoningEffort: 'max' },
  ])
  assert.equal(explicit.resolveCandidates('selfTalk').length, 1, '显式覆盖所有 role 都是单候选')

  // 关闭开关 → 直接回落 selection
  assert.deepEqual(
    makeCandidatePolicy({ env: { DSH_POETRY_OPENCODE_GO: '0' } }).resolveCandidates('mood').map((c) => c.provider),
    ['deepseek-account'],
  )
  assert.deepEqual(
    makeCandidatePolicy({ env: { DSH_POETRY_MODEL_PRIORITY: 'deepseek-account' } })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['deepseek-account'],
  )
  // 原生 opencode 模型 env 覆盖（仅 dsh 不可用、走原生回退时生效）
  assert.equal(
    makeCandidatePolicy({
      env: { DSH_POETRY_OPENCODE_MODEL: 'custom-opencode' },
      getProviders: () => ['opencode-go'],
    }).resolveCandidates('mood')[0].model,
    'custom-opencode',
    'DSH_POETRY_OPENCODE_MODEL 覆盖原生 opencode 候选',
  )
  // 去重：selection 与 opencode 候选相同
  const deduped = makeCandidatePolicy({
    getProviders: () => ['opencode-go'],
    getSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }),
  }).resolveCandidates('mood')
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].provider, 'opencode-go')
  // v1.43：dsh 候选带 token 下限（四角色），deepseek 候选不带；helper 只抬上限
  for (const role of MODEL_POLICY_ROLES) {
    const first = unknown.resolveCandidates(role)[0]
    assert.equal(first.provider, MODEL_POLICY_DSH_OPENCODE_PROVIDER)
    assert.equal(first.maxTokensFloor, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS[role])
    assert.equal('maxTokensFloor' in unknown.resolveCandidates(role)[1], false)
  }
  assert.equal(resolveCandidateMaxTokens(220, { maxTokensFloor: 1600 }), 1600)
  assert.equal(resolveCandidateMaxTokens(220, { maxTokensFloor: 100 }), 220)
  assert.equal(resolveCandidateMaxTokens(220, null), 220)
  assert.equal(resolveCandidateMaxTokens(220, undefined), 220)

  // 非法 role / 全缺失
  assert.deepEqual(unknown.resolveCandidates('unknown'), [])
  const none = createModelPolicy({ env: {}, getSelection: () => null, getProviders: () => [] })
  assert.deepEqual(none.resolveCandidates('mood'), [])
})

test('model-policy M51：四服务首候选失败（未产出文本）→ 回落第二候选并记录实际 model', async () => {
  const policy = makeCandidatePolicy({ getProviders: () => ['opencode-go'] })

  // mood
  const moodLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '一切顺利', energy: 80 }),
  })
  const mood = makeMoodAiHarness({ policy, llm: moodLlm })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, true)
  assert.deepEqual(moodResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' }, '实际回落的 provider/model')
  assert.deepEqual(moodLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(moodLlm.calls[0].reasoningEffort, undefined, 'opencode 不传显式 effort')
  assert.equal(moodLlm.calls[1].reasoningEffort, 'low')

  // selfTalk
  const talkLlm = makeFailoverLlm({ successText: SELF_TALK_LINES_A.join('\n') })
  const talk = makeSelfTalkHarness({ policy, llm: talkLlm })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, true)
  assert.deepEqual(talkResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.deepEqual(talkLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(talkLlm.calls[0].reasoningEffort, undefined)
  assert.equal(talkLlm.calls[1].reasoningEffort, 'high')

  // growth（reflect）
  const growthLlm = makeFailoverLlm({ successText: JSON.stringify({ thought: '安静地接着自己上一次的念头想一想。' }) })
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm })
  const growthResult = await growthHarness.growth.reflectNow()
  assert.equal(growthResult.ok, true)
  assert.deepEqual(growthLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(growthLlm.calls[0].reasoningEffort, undefined)
  assert.equal(growthLlm.calls[1].reasoningEffort, 'high')

  // voice（refresh）
  const voiceDir = makeTmpDir('dshp-candidates-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeFailoverLlm({
    successText: JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }),
  })
  const voice = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  const voiceResult = await voice.refreshNow()
  assert.equal(voiceResult.ok, true)
  assert.deepEqual(voiceLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(voiceLlm.calls[0].reasoningEffort, undefined)
  assert.equal(voiceLlm.calls[1].reasoningEffort, 'high')
})

test('model-policy M51：候选已产出部分文本后失败 → 不重试（避免串话）；空输出/首候选超时仍可回落', async () => {
  const policy = makeCandidatePolicy({ getProviders: () => ['opencode-go'] })

  // mood：首个候选已输出部分文本后抛错 → 不尝试第二候选
  const partialLlm = makeFailoverLlm({ partialProvider: 'opencode-go', successText: 'ignored' })
  const mood = makeMoodAiHarness({ policy, llm: partialLlm })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, false)
  assert.equal(partialLlm.calls.length, 1, '部分输出失败不重试')

  // selfTalk：同样不重试
  const talkPartial = makeFailoverLlm({ partialProvider: 'opencode-go', successText: 'ignored' })
  const talk = makeSelfTalkHarness({ policy, llm: talkPartial })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, false)
  assert.equal(talkPartial.calls.length, 1)

  // mood：首候选超时（未产出文本）→ 回落第二候选成功
  const timeoutLlm = makeFailoverLlm({
    timeoutProvider: 'opencode-go',
    successText: JSON.stringify({ label: '放松', image: 'dsh-whale-state-happy.webp', reason: '慢下来了', energy: 50 }),
  })
  const timeoutPolicy = makeCandidatePolicy({ getProviders: () => ['opencode-go'] })
  const timeoutHarness = makeMoodAiHarness({ policy: timeoutPolicy, llm: timeoutLlm, timeoutMs: 40 })
  const timeoutResult = await timeoutHarness.service.generate({}, { force: true })
  assert.equal(timeoutResult.ok, true)
  assert.equal(timeoutLlm.calls.length, 2, '首候选超时后尝试第二候选')
  assert.deepEqual(timeoutResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
})

// ---------------------------------------------------------------------------
// M52：opencode-go 400 修复（opencode 候选请求不带 temperature）
// ---------------------------------------------------------------------------

test('model-policy M52：opencode 候选 omitTemperature，deepseek 候选保持温度', () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const candidates = policy.resolveCandidates('mood')
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].provider, 'opencode-go')
  assert.equal(candidates[0].omitTemperature, true)
  assert.equal(candidates[1].provider, 'deepseek-account')
  assert.equal('omitTemperature' in candidates[1], false, 'deepseek 候选不 omit')
  // 显式覆盖 opencode provider 也会带 omitTemperature 语义（provider 判断兜底）
  const explicit = createModelPolicy({
    env: { DSH_POETRY_MODEL_PROVIDER: 'opencode-go', DSH_POETRY_MODEL: 'deepseek-v4.1-flash' },
    getSelection: () => null,
    getProviders: () => [],
  })
  assert.equal(explicit.resolveCandidates('mood')[0].provider, 'opencode-go')
})

test('model-policy M52：四服务 opencode 候选不带 temperature，deepseek 候选带温度', async () => {
  const opencodePolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const deepseekPolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => [],
  })

  // mood
  const moodOpencode = makeMoodAiHarness({ policy: opencodePolicy })
  await moodOpencode.service.generate({}, { force: true })
  assert.equal('temperature' in moodOpencode.llm.calls[0], false, 'opencode 不带 temperature')
  assert.equal(moodOpencode.llm.calls[0].provider, 'opencode-go')
  const moodDeepseek = makeMoodAiHarness({ policy: deepseekPolicy })
  await moodDeepseek.service.generate({}, { force: true })
  assert.equal(moodDeepseek.llm.calls[0].temperature, 1.05)

  // selfTalk
  const talkOpencode = makeSelfTalkHarness({ policy: opencodePolicy })
  await talkOpencode.service.generate({})
  assert.equal('temperature' in talkOpencode.llm.calls[0], false)
  const talkDeepseek = makeSelfTalkHarness({ policy: deepseekPolicy })
  await talkDeepseek.service.generate({})
  assert.equal(talkDeepseek.llm.calls[0].temperature, 1.0)

  // growth（reflect）
  const growthOpencodeLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthOpencode = makeGrowthHarness({ policy: opencodePolicy, llm: growthOpencodeLlm })
  assert.equal((await growthOpencode.growth.reflectNow()).ok, true)
  assert.equal('temperature' in growthOpencodeLlm.calls[0], false)
  const growthDeepseekLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthDeepseek = makeGrowthHarness({ policy: deepseekPolicy, llm: growthDeepseekLlm })
  assert.equal((await growthDeepseek.growth.reflectNow()).ok, true)
  assert.equal(growthDeepseekLlm.calls[0].temperature, 0.9)

  // voice
  const voiceDir = makeTmpDir('dshp-m52-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceOpencode = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: opencodePolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-open.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceOpencode.refreshNow()).ok, true)
  assert.equal('temperature' in voiceLlm.calls[0], false)

  const voiceLlm2 = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceDeepseek = createVoiceService({
    llm: voiceLlm2,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: deepseekPolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-deep.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceDeepseek.refreshNow()).ok, true)
  assert.equal(voiceLlm2.calls[0].temperature, 0.8)
})

test('model-policy M52：回退第二候选时带 temperature；错误日志含 provider/model/status 不含提示词', async () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const failoverLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落成功', energy: 60 }),
  })
  const mood = makeMoodAiHarness({ policy, llm: failoverLlm })
  const result = await mood.service.generate({}, { force: true })
  assert.equal(result.ok, true)
  assert.equal('temperature' in failoverLlm.calls[0], false, '首候选 opencode 不带温度')
  assert.equal(failoverLlm.calls[1].temperature, 1.05, '回退 deepseek 候选带温度')

  // selfTalk 回退同样
  const talkLlm = makeFailoverLlm({ successText: SELF_TALK_LINES_A.join('\n') })
  const talk = makeSelfTalkHarness({ policy, llm: talkLlm })
  assert.equal((await talk.service.generate({})).ok, true)
  assert.equal('temperature' in talkLlm.calls[0], false)
  assert.equal(talkLlm.calls[1].temperature, 1.0)

  // 错误日志：provider/model/status 可见，且不含 prompt 内容
  const warnings = []
  const errorLlm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      if (options.provider === 'opencode-go') {
        return (async function* () {
          const error = new Error('Request failed with status code 400')
          error.status = 400
          throw error
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落', energy: 50 }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const catalog = makeMoodCatalogFixture()
  const service = createMoodAiService({
    llm: errorLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    catalog,
    now: () => FIXED_NOW.getTime(),
    timeoutMs: 300,
    cacheTtlMs: 0,
    minIntervalMs: 0,
    policy,
    logger: { warn: (message) => warnings.push(String(message)) },
  })
  const logged = await service.generate({}, { force: true })
  assert.equal(logged.ok, true, '400 后回退成功')
  const statusWarning = warnings.find((message) => message.includes('opencode-go') && message.includes('400'))
  assert.ok(statusWarning, `应有 provider/model/status 日志，实际：${warnings.join(' | ')}`)
  assert.match(statusWarning, /opencode-go\/deepseek-v4\.1-flash/)
  assert.equal(statusWarning.includes('心情图鉴'), false, '日志不含提示词内容')
})

// ---------------------------------------------------------------------------
// M53：OpenCode 400 继续修复（不发显式 reasoningEffort + 模型错误诊断落盘）
// ---------------------------------------------------------------------------

function makeErrorPath(dir, name = 'model-errors.jsonl') {
  return path.join(dir, name)
}

test('model-policy M53：opencode 候选既无 temperature 也无 reasoningEffort；deepseek 两者都有（四服务）', async () => {
  const opencodePolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const deepseekPolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => [],
  })

  // mood
  const moodOpen = makeMoodAiHarness({ policy: opencodePolicy })
  await moodOpen.service.generate({}, { force: true })
  assert.equal('temperature' in moodOpen.llm.calls[0], false)
  assert.equal('reasoningEffort' in moodOpen.llm.calls[0], false)
  const moodDeep = makeMoodAiHarness({ policy: deepseekPolicy })
  await moodDeep.service.generate({}, { force: true })
  assert.equal(moodDeep.llm.calls[0].temperature, 1.05)
  assert.equal(moodDeep.llm.calls[0].reasoningEffort, 'low')

  // selfTalk
  const talkOpen = makeSelfTalkHarness({ policy: opencodePolicy })
  await talkOpen.service.generate({})
  assert.equal('temperature' in talkOpen.llm.calls[0], false)
  assert.equal('reasoningEffort' in talkOpen.llm.calls[0], false)
  const talkDeep = makeSelfTalkHarness({ policy: deepseekPolicy })
  await talkDeep.service.generate({})
  assert.equal(talkDeep.llm.calls[0].temperature, 1.0)
  assert.equal(talkDeep.llm.calls[0].reasoningEffort, 'high')

  // growth
  const growthOpenLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthOpen = makeGrowthHarness({ policy: opencodePolicy, llm: growthOpenLlm })
  assert.equal((await growthOpen.growth.reflectNow()).ok, true)
  assert.equal('temperature' in growthOpenLlm.calls[0], false)
  assert.equal('reasoningEffort' in growthOpenLlm.calls[0], false)
  const growthDeepLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthDeep = makeGrowthHarness({ policy: deepseekPolicy, llm: growthDeepLlm })
  assert.equal((await growthDeep.growth.reflectNow()).ok, true)
  assert.equal(growthDeepLlm.calls[0].temperature, 0.9)
  assert.equal(growthDeepLlm.calls[0].reasoningEffort, 'high')

  // voice
  const voiceDir = makeTmpDir('dshp-m53-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const openLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceOpen = createVoiceService({
    llm: openLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: opencodePolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-open.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceOpen.refreshNow()).ok, true)
  assert.equal('temperature' in openLlm.calls[0], false)
  assert.equal('reasoningEffort' in openLlm.calls[0], false)
  const deepLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceDeep = createVoiceService({
    llm: deepLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: deepseekPolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-deep.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceDeep.refreshNow()).ok, true)
  assert.equal(deepLlm.calls[0].temperature, 0.8)
  assert.equal(deepLlm.calls[0].reasoningEffort, 'high')

  // 回退第二候选时 deepseek 两者都有
  const failoverLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落', energy: 60 }),
  })
  const moodFallback = makeMoodAiHarness({ policy: opencodePolicy, llm: failoverLlm })
  assert.equal((await moodFallback.service.generate({}, { force: true })).ok, true)
  assert.equal('temperature' in failoverLlm.calls[0], false)
  assert.equal('reasoningEffort' in failoverLlm.calls[0], false)
  assert.equal(failoverLlm.calls[1].temperature, 1.05)
  assert.equal(failoverLlm.calls[1].reasoningEffort, 'low')
})

test('model-errors M53：落盘字段/截断/200 行/不含 prompt；四服务各写一条', async () => {
  assert.equal(
    resolveModelErrorsPath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/.dsh-poetry/model-errors.jsonl',
  )
  const dir = makeTmpDir('dshp-model-errors')
  const file = makeErrorPath(dir)

  // 字段与截断（message >500）
  const longMessage = 'x'.repeat(800)
  const record = buildModelErrorRecord({
    role: 'mood',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    error: { status: 400, code: 'INVALID_REQUEST', message: longMessage },
    request: { hasTemperature: false, reasoningEffort: null, maxTokens: 400, systemChars: 123, promptChars: 456, messagesCount: 1 },
    now: 1700000000000,
  })
  assert.equal(record.at, 1700000000000)
  assert.equal(record.status, 400)
  assert.equal(record.code, 'INVALID_REQUEST')
  assert.ok(Array.from(record.message).length <= MODEL_ERRORS_MESSAGE_MAX)
  assert.equal(Array.from(record.message).length, MODEL_ERRORS_MESSAGE_MAX)
  assert.equal(JSON.stringify(record).includes('content'), false)
  appendModelError(file, record)

  // 超 200 行 → 只保留最近 200
  for (let index = 0; index < MODEL_ERRORS_MAX_LINES + 5; index += 1) {
    appendModelError(file, { ...record, at: 1700000000001 + index })
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, MODEL_ERRORS_MAX_LINES)
  assert.equal(JSON.parse(lines.at(-1)).at, 1700000000001 + MODEL_ERRORS_MAX_LINES + 4)
  assert.equal(readModelErrors(file, 20).length, 20)

  // 四服务覆盖：opencode 首候选 400 失败 → 各写一条（然后回退成功）
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const serviceDir = makeTmpDir('dshp-model-errors-services')
  const moodPath = makeErrorPath(serviceDir, 'mood.jsonl')
  const moodLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落', energy: 60 }),
  })
  // makeFailoverLlm 抛普通 Error；包一层带 status=400 便于断言
  const moodLlm400 = {
    calls: moodLlm.calls,
    stream(options) {
      if (options.provider === 'opencode-go') {
        moodLlm.calls.push(options)
        return (async function* () {
          const error = new Error('Request failed with status code 400')
          error.status = 400
          throw error
        })()
      }
      return moodLlm.stream(options)
    },
  }
  const moodHarness = makeMoodAiHarness({ policy, llm: moodLlm400, modelErrorsPath: moodPath })
  assert.equal((await moodHarness.service.generate({}, { force: true })).ok, true)

  const talkPath = makeErrorPath(serviceDir, 'talk.jsonl')
  const talkLlm = makeFailoverLlm({ successText: SELF_TALK_LINES_A.join('\n') })
  const talkHarness = makeSelfTalkHarness({ policy, llm: talkLlm, modelErrorsPath: talkPath })
  assert.equal((await talkHarness.service.generate({})).ok, true)

  const growthPath = makeErrorPath(serviceDir, 'growth.jsonl')
  const growthLlm = makeFailoverLlm({ successText: JSON.stringify({ thought: '安静地接着自己的想法。' }) })
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm, modelErrorsPath: growthPath })
  assert.equal((await growthHarness.growth.reflectNow()).ok, true)

  const voicePath = path.join(serviceDir, 'voice.jsonl')
  const voiceJournal = writeRecallJournal(path.join(serviceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeFailoverLlm({ successText: JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }) })
  const voiceService = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy,
    journalPath: voiceJournal,
    voicePath: path.join(serviceDir, 'voice-profile.json'),
    modelErrorsPath: voicePath,
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceService.refreshNow()).ok, true)

  for (const [role, rolePath] of [
    ['mood', moodPath],
    ['selfTalk', talkPath],
    ['growth', growthPath],
    ['voice', voicePath],
  ]) {
    const records = readModelErrors(rolePath, 5)
    assert.equal(records.length, 1, `${role} 应写一条候选失败`)
    const item = records[0]
    assert.equal(item.role, role)
    assert.equal(item.provider, 'opencode-go')
    assert.equal(item.model, 'deepseek-v4.1-flash')
    if (role === 'mood') {
      assert.equal(item.status, 400)
      assert.match(item.message, /400/)
    } else {
      assert.equal(item.status, undefined, '其它服务 mock 错误无 status（status 可选）')
      assert.match(item.message, /unavailable|failed/)
    }
    assert.equal(item.request.hasTemperature, false)
    assert.equal(item.request.reasoningEffort, null)
    assert.ok(item.request.maxTokens > 0)
    assert.ok(item.request.systemChars > 0)
    assert.ok(item.request.promptChars > 0)
    assert.equal(item.request.messagesCount, 1)
    const raw = fs.readFileSync(rolePath, 'utf8')
    assert.equal(raw.includes('心情图鉴'), false, '不含提示词')
    assert.equal(raw.includes('"content"'), false, '不含 messages 正文')
  }
})

test('model-errors M53：只读路由 GET/HEAD/405（最近 20 条，无敏感内容）', async () => {
  const dir = makeTmpDir('dshp-model-errors-route')
  const file = makeErrorPath(dir)
  for (let index = 0; index < 25; index += 1) {
    appendModelError(file, {
      at: 1700000000000 + index,
      role: 'mood',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      status: 400,
      message: `失败 ${index}`,
      request: { hasTemperature: false, reasoningEffort: null, maxTokens: 400, systemChars: 10, promptChars: 20, messagesCount: 1 },
    })
  }
  assert.equal(MODEL_ERRORS_ROUTE, '/api/dsh-poetry/model-errors.json')
  const handler = createModelErrorsHandler({ file, limit: 20 })
  const response = new MockResponse()
  await handler(mockRequest({ url: MODEL_ERRORS_ROUTE }), response)
  await response.finished()
  const body = response.json()
  assert.equal(response.statusCode, 200)
  assert.equal(body.ok, true)
  assert.equal(body.errors.length, 20)
  assert.equal(body.errors[0].message, '失败 5')
  assert.equal(body.errors.at(-1).message, '失败 24')
  assert.equal(JSON.stringify(body).includes('"content"'), false)

  const head = new MockResponse()
  await handler(mockRequest({ method: 'HEAD', url: MODEL_ERRORS_ROUTE }), head)
  await head.finished()
  assert.equal(head.bodyText, '')

  const post = new MockResponse()
  await handler(mockRequest({ method: 'POST', url: MODEL_ERRORS_ROUTE }), post)
  await post.finished()
  assert.equal(post.statusCode, 405)
})

// ---------------------------------------------------------------------------
// M54：模型候选切到 dsh-opencode-go（新适配器优先）
// ---------------------------------------------------------------------------

function makeChainLlm({ failProviders = [], successText }) {
  const calls = []
  const llm = {
    calls,
    stream(options) {
      calls.push(options)
      if (failProviders.includes(options.provider)) {
        return (async function* () {
          throw new Error(`provider ${options.provider} unavailable before any text`)
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: successText }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  return llm
}

test('model-policy M54：候选顺序 dsh-opencode-go → deepseek-account（原生 opencode 仅在 dsh 缺失时回退；探测/关闭/覆盖/去重）', () => {
  const allProviders = () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account']
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: allProviders,
  })
  const candidates = policy.resolveCandidates('mood')
  assert.equal(candidates.length, 2)
  assert.deepEqual(candidates[0], {
    provider: MODEL_POLICY_DSH_OPENCODE_PROVIDER,
    model: MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
    reasoningEffort: 'low',
    omitTemperature: true,
    maxTokensFloor: MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood,
  })
  assert.equal('omitReasoningEffort' in candidates[0], false, 'dsh 适配器保留 reasoningEffort')
  assert.deepEqual(candidates[1], { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' })
  assert.equal(candidates[0].reasoningEffort, 'low')
  assert.equal(candidates[1].reasoningEffort, 'low')
  assert.equal(policy.resolve('selfTalk').reasoningEffort, 'high')
  assert.equal(policy.resolve('growth').reasoningEffort, 'high')
  assert.equal(policy.resolve('voice').reasoningEffort, 'high')

  // env 覆盖 dsh 模型
  const customDsh = createModelPolicy({
    env: { DSH_POETRY_DSH_OPENCODE_MODEL: 'custom-dsh-model' },
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: allProviders,
  })
  assert.equal(customDsh.resolveCandidates('mood')[0].model, 'custom-dsh-model')

  // 探测：只有 dsh / 只有原生 / 都没有
  assert.deepEqual(
    createModelPolicy({
      env: {},
      getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
      getProviders: () => ['dsh-opencode-go'],
    })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['dsh-opencode-go', 'deepseek-account'],
  )
  assert.deepEqual(
    createModelPolicy({
      env: {},
      getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
      getProviders: () => ['opencode-go'],
    })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['opencode-go', 'deepseek-account'],
  )
  assert.deepEqual(
    createModelPolicy({
      env: {},
      getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
      getProviders: () => [],
    })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['deepseek-account'],
  )
  // 无法探测 → dsh + selection（不再叠加原生 opencode）
  assert.deepEqual(
    createModelPolicy({ env: {}, getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['dsh-opencode-go', 'deepseek-account'],
  )

  // 关闭开关 → 只 selection
  for (const env of [{ DSH_POETRY_OPENCODE_GO: '0' }, { DSH_POETRY_MODEL_PRIORITY: 'deepseek-account' }]) {
    assert.deepEqual(
      createModelPolicy({
        env,
        getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
        getProviders: allProviders,
      })
        .resolveCandidates('mood')
        .map((c) => c.provider),
      ['deepseek-account'],
    )
  }
  // 显式覆盖 → 单候选
  assert.deepEqual(
    createModelPolicy({
      env: { DSH_POETRY_MODEL_PROVIDER: 'custom-p', DSH_POETRY_MODEL: 'custom-m' },
      getSelection: allProviders,
      getProviders: allProviders,
    }).resolveCandidates('mood'),
    [{ provider: 'custom-p', model: 'custom-m', reasoningEffort: 'low' }],
  )
  // 去重：selection 与 dsh 相同
  const deduped = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' }),
    getProviders: () => ['dsh-opencode-go'],
  }).resolveCandidates('mood')
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].provider, 'dsh-opencode-go')

  // describe 显示候选顺序
  const described = describeModelPolicy(policy)
  assert.match(described, /心情=dsh-opencode-go\/deepseek-v4\.1-flash\(low\) → deepseek-account\/deepseek-flash\(low\)/)
})

test('model-policy M55：宿主默认指向原生 opencode-go（缺会话头必然 400）→ 换 deepseek 账号兜底', () => {
  const brokenSelection = () => ({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
  assert.deepEqual(MODEL_POLICY_SAFE_FALLBACK, { provider: 'deepseek-account', model: 'deepseek-flash' })

  // dsh 可用：候选 = dsh → deepseek-account/deepseek-flash（原生 400 不进链）
  const withDsh = createModelPolicy({
    env: {},
    getSelection: brokenSelection,
    getProviders: () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account'],
  }).resolveCandidates('growth')
  assert.deepEqual(
    withDsh.map((c) => `${c.provider}/${c.model}`),
    ['dsh-opencode-go/deepseek-v4.1-flash', 'deepseek-account/deepseek-flash'],
  )
  assert.equal(withDsh[1].reasoningEffort, 'high')
  assert.equal('maxTokensFloor' in withDsh[1], false)

  // dsh 不可用（仅原生）：保留宿主选择（用户显式配置），不强行替换
  const nativeOnly = createModelPolicy({
    env: {},
    getSelection: brokenSelection,
    getProviders: () => ['opencode-go'],
  }).resolveCandidates('mood')
  assert.deepEqual(nativeOnly.map((c) => c.provider), ['opencode-go'])
  assert.equal(nativeOnly[0].model, 'deepseek-v4.1-flash')

  // 显式关闭 opencode 订阅：同样保留宿主选择
  const disabled = createModelPolicy({
    env: { DSH_POETRY_OPENCODE_GO: '0' },
    getSelection: brokenSelection,
    getProviders: () => ['dsh-opencode-go', 'opencode-go'],
  }).resolveCandidates('mood')
  assert.deepEqual(disabled.map((c) => c.provider), ['opencode-go'])
})

test('model-policy M54：四服务 dsh 候选不发 temperature、发 reasoningEffort；响应 model 为 dsh', async () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['dsh-opencode-go', 'opencode-go'],
  })

  // mood
  const mood = makeMoodAiHarness({ policy })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, true)
  assert.deepEqual(moodResult.model, { provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' })
  assert.equal('temperature' in mood.llm.calls[0], false)
  assert.equal(mood.llm.calls[0].reasoningEffort, 'low')
  assert.equal(mood.llm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood)

  // selfTalk
  const talk = makeSelfTalkHarness({ policy })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, true)
  assert.deepEqual(talkResult.model, { provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' })
  assert.equal('temperature' in talk.llm.calls[0], false)
  assert.equal(talk.llm.calls[0].reasoningEffort, 'high')
  assert.equal(talk.llm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.selfTalk)

  // growth
  const growthLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm })
  assert.equal((await growthHarness.growth.reflectNow()).ok, true)
  assert.equal('temperature' in growthLlm.calls[0], false)
  assert.equal(growthLlm.calls[0].reasoningEffort, 'high')
  assert.equal(growthLlm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.growth)

  // voice
  const voiceDir = makeTmpDir('dshp-m54-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voice = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voice.refreshNow()).ok, true)
  assert.equal('temperature' in voiceLlm.calls[0], false)
  assert.equal(voiceLlm.calls[0].reasoningEffort, 'high')
  assert.equal(voiceLlm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.voice)
})

test('model-policy M54：dsh 失败（未产出文本）→ deepseek；原生 opencode 不参与，token 下限正确', async () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account'],
  })
  // 原生 opencode-go 在 dsh 可用时已不进候选链；即便它“失败”也不会被调用。
  const failProviders = ['dsh-opencode-go', 'opencode-go']

  // mood：dsh → deepseek
  const moodLlm = makeChainLlm({
    failProviders,
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: 'deepseek 回落', energy: 60 }),
  })
  const mood = makeMoodAiHarness({ policy, llm: moodLlm })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, true)
  assert.deepEqual(moodLlm.calls.map((call) => call.provider), ['dsh-opencode-go', 'deepseek-account'])
  assert.equal('temperature' in moodLlm.calls[0], false)
  assert.equal(moodLlm.calls[0].reasoningEffort, 'low', 'dsh 候选保留 effort')
  assert.equal(
    moodLlm.calls[0].maxTokens,
    MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood,
    'dsh 候选抬 token 下限（thinking 常开，防 EMPTY_RESPONSE）',
  )
  assert.equal(moodLlm.calls[1].temperature, 1.05)
  assert.equal(moodLlm.calls[1].reasoningEffort, 'low')
  assert.equal(moodLlm.calls[1].maxTokens, 220, 'deepseek 候选保持角色预算')
  assert.deepEqual(moodResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })

  // selfTalk：dsh → deepseek
  const talkLlm = makeChainLlm({ failProviders, successText: SELF_TALK_LINES_A.join('\n') })
  const talk = makeSelfTalkHarness({ policy, llm: talkLlm })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, true)
  assert.deepEqual(talkLlm.calls.map((call) => call.provider), ['dsh-opencode-go', 'deepseek-account'])
  assert.equal(talkLlm.calls[0].reasoningEffort, 'high')
  assert.equal('temperature' in talkLlm.calls[0], false)
  assert.equal(talkLlm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.selfTalk)
  assert.equal(talkLlm.calls[1].temperature, 1.0)
  assert.equal(talkLlm.calls[1].reasoningEffort, 'high')
  assert.equal(talkLlm.calls[1].maxTokens, 320)
  assert.deepEqual(talkResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
})
