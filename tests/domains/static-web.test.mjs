// tests/domains/static-web.test.mjs —— 静态资源/预算/网页（W3 拆分）
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
import { createAssetHandler, resolveAssetPath } from '../../lib/assets.mjs'
import { createDataStore, pickPoemIndex } from '../../lib/data-store.mjs'
import { formatLocalDate, maskPath, readPackageMeta } from '../../lib/paths.mjs'
import { createRouteTable } from '../../lib/routes.mjs'
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  normalizeSettings,
  resolveSettingsPath,
  validateSettingsPatch,
} from '../../lib/settings-store.mjs'
import { createTrustFence, isLoopbackHostname } from '../../lib/trust.mjs'
import {
  DEFAULT_CITY as WEATHER_DEFAULT_CITY,
  createWeatherService,
  mapWeather,
  normalizeCity,
} from '../../lib/weather.mjs'
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
} from '../../lib/mood.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_MAX_AGE_MS,
  readExperience,
  resolveExperiencePath,
} from '../../lib/experience.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  isSafeWebmRelative,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  resolvePetMediaDir,
} from '../../lib/pet-media.mjs'
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
} from '../../lib/memory-journal.mjs'
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
} from '../../lib/mood-ai.mjs'
import {
  MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_DSH_OPENCODE_PROVIDER,
} from '../../lib/model-policy.mjs'
import {
  MODEL_ERRORS_MAX_LINES,
  MODEL_ERRORS_MESSAGE_MAX,
  MODEL_ERRORS_ROUTE,
  appendModelError,
  buildModelErrorRecord,
  createModelErrorsHandler,
  readModelErrors,
  resolveModelErrorsPath,
} from '../../lib/model-errors.mjs'
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
} from '../../lib/model-policy.mjs'
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
} from '../../lib/voice-memory.mjs'
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
} from '../../lib/memory-recall.mjs'
import {
  MEMORY_BACKUP_INTERVAL_MS,
  MEMORY_BACKUP_MAX,
  MEMORY_BACKUP_ROUTE,
  MEMORY_ROUTE,
  createMemoryBackupHandler,
  createMemoryHub,
  createMemorySnapshotHandler,
  resolveMemoryHubPaths,
} from '../../lib/memory-hub.mjs'
import {
  SELF_DRIVE_ACTIONS,
  buildSelfDrivePrompt,
  createSelfDrive,
  parseSelfDriveResult,
} from '../../lib/self-drive.mjs'
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
} from '../../lib/self-being.mjs'
import {
  FEELING_DESC_MAX,
  FEELING_NAME_MAX,
  appendFeeling,
  loadFeelingBank,
  normalizeFeeling,
  parseNewFeeling,
  readFeelingFile,
  resolveFeelingsPath,
} from '../../lib/feelings.mjs'
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
} from '../../lib/self-growth.mjs'
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
} from '../../lib/self-wander.mjs'
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
} from '../../lib/self-reading.mjs'
import { runMemoryMigrations } from '../../lib/memory-migrations.mjs'
import { createDshHost } from '../../lib/dsh-host.mjs'
import { createSelfProjects, projectCanRetry, projectProgressAt, projectStage } from '../../lib/self-projects.mjs'
import { createGuiInbox, pushGuiInbox, readGuiInbox, GUI_INBOX_MAX } from '../../lib/gui-inbox.mjs'
import { normalizeVideoCourse, readVideoCourses, readVideoCoursesShelf } from '../../lib/video-courses.mjs'
import { createSelfEvents } from '../../lib/self-events.mjs'
import { createMetabolism } from '../../lib/self-metabolism.mjs'
import { createWorldFeedback } from '../../lib/world-feedback.mjs'
import { PRESENCE_ROUTE, createPresenceHandler } from '../../lib/presence.mjs'
import { createChatBridge } from '../../lib/chat-bridge.mjs'
import { createCurriculum } from '../../lib/self-curriculum.mjs'
import { createMediaBudget } from '../../lib/media-budget.mjs'
import { createAttentionStore } from '../../lib/attention.mjs'
import { createOutbox } from '../../lib/outbox.mjs'
import { constitutionLines, PROMPT_LAYERS_VERSION } from '../../lib/prompt-layers.mjs'
import { fetchShugeEntry, searchShuge } from '../../lib/shuge.mjs'
import { createLifecycle } from '../../lib/self-lifecycle.mjs'
import { createTwinBridge } from '../../lib/twin-bridge.mjs'
import { createTwinResearch } from '../../lib/twin-research.mjs'
import { createGrowthMetrics } from '../../lib/growth-metrics.mjs'
import { createSelfWorks, createWorksHandler, sanitizeWorkSvg } from '../../lib/self-works.mjs'
import { createManualReadHandler, createManualReading, ensureManualToken } from '../../lib/manual-reading.mjs'
import { seedMemoryBaseline } from '../../lib/memory-baseline.mjs'
import { createHeartbeat } from '../../lib/heartbeat.mjs'
import { createModelBudget, createModelGate } from '../../lib/model-budget.mjs'
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
} from '../../lib/safe-web.mjs'
import { callModelForRole, configureModelRuntime, resetModelRuntime } from '../../lib/llm-call.mjs'
import {
  buildConsolidationPrompt,
  countJournalEntries,
  createMemoryConsolidator,
  createMemoryLayers,
  parseConsolidationResult,
  readMemoryLayers,
  resolveMemoryLayersPath,
} from '../../lib/memory-layers.mjs'
import {
  SELF_NETLANG_GAP_MS,
  SELF_NETLANG_SOURCES,
  buildNetlangPrompt,
  createSelfNetlang,
  fetchNetlangTitles,
  parseGithubTrendingHtml,
  parseNetlangPayload,
  parseNetlangResult,
} from '../../lib/self-netlang.mjs'
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
} from '../../lib/self-actions.mjs'
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
} from '../../lib/self-state.mjs'
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
} from '../../lib/self-talk-topics.mjs'
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
// 静态资源路由
// ---------------------------------------------------------------------------

test('assets：路径解析防护', () => {
  const root = path.resolve('/tmp/assets-root')
  assert.equal(resolveAssetPath(root, 'icon.webp'), path.join(root, 'icon.webp'))
  assert.equal(resolveAssetPath(root, 'sub/../icon.webp'), path.join(root, 'icon.webp'))
  assert.equal(resolveAssetPath(root, '../secret.txt'), null)
  assert.equal(resolveAssetPath(root, 'sub/../../secret.txt'), null)
  assert.equal(resolveAssetPath(root, ''), null)
  assert.equal(resolveAssetPath(root, '.hidden'), null)
  assert.equal(resolveAssetPath(root, 'a\0b'), null)
  assert.equal(resolveAssetPath(root, 'a\\b'), null)
})

test('assets：200 + MIME + Cache-Control，404 越界/缺失，405 非 GET', async () => {
  const assetsDir = makeTmpDir('dshp-assets')
  fs.mkdirSync(path.join(assetsDir, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(assetsDir, 'icon.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]))
  fs.writeFileSync(path.join(assetsDir, 'sub', 'app.css'), 'body{}')
  fs.writeFileSync(path.join(assetsDir, '.hidden'), 'secret')
  const handler = createAssetHandler({ assetsDir })

  async function call({ method = 'GET', url }) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url }), response)
    await response.finished()
    return response
  }

  const ok = await call({ url: '/api/dsh-poetry/assets?f=icon.webp' })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.headers['Content-Type'], 'image/webp')
  assert.equal(ok.headers['Cache-Control'], 'public, max-age=3600')
  assert.equal(ok.bodyText, 'RIFF')

  const css = await call({ url: '/api/dsh-poetry/assets?f=sub/app.css' })
  assert.equal(css.statusCode, 200)
  assert.equal(css.headers['Content-Type'], 'text/css; charset=utf-8')

  for (const url of [
    '/api/dsh-poetry/assets?f=../secret.txt',
    '/api/dsh-poetry/assets?f=%2e%2e%2fsecret.txt',
    '/api/dsh-poetry/assets?f=missing.webp',
    '/api/dsh-poetry/assets?f=.hidden',
    '/api/dsh-poetry/assets',
  ]) {
    const response = await call({ url })
    assert.equal(response.statusCode, 404, url)
  }

  const wrongMethod = await call({ method: 'POST', url: '/api/dsh-poetry/assets?f=icon.webp' })
  assert.equal(wrongMethod.statusCode, 405)
})

test('dsh-host v1.75：宿主 API 适配层转发 + 缺失/异常降级', () => {
  const calls = []
  const fakeCtx = {
    inject(keys, callback) {
      calls.push(['inject', keys])
      return callback({
        get(name) {
          calls.push(['get', name])
          return name === 'webServer' ? { ok: true } : undefined
        },
        effect(fn, label) {
          calls.push(['effect', label])
          return fn
        },
      })
    },
    effect(fn, label) {
      calls.push(['ctx.effect', label])
      return fn
    },
    logger: { warn() {} },
  }
  const host = createDshHost(fakeCtx)
  host.inject(['webServer', 'connection'], (hostCtx) => {
    assert.deepEqual(host.get(hostCtx, 'webServer'), { ok: true })
    assert.equal(host.get(hostCtx, 'connection'), undefined)
    const disposer = host.effect(hostCtx, () => 'cleanup', 'demo')
    assert.equal(disposer(), 'cleanup')
  })
  assert.deepEqual(calls, [
    ['inject', ['webServer', 'connection']],
    ['get', 'webServer'],
    ['get', 'connection'],
    ['effect', 'demo'],
  ])

  const warnings = []
  const emptyHost = createDshHost({}, { warn: (message) => warnings.push(message) })
  let callbackRan = false
  emptyHost.inject(['webServer'], (hostCtx) => {
    callbackRan = true
    assert.equal(emptyHost.get(hostCtx, 'webServer'), undefined)
    assert.equal(emptyHost.effect(hostCtx, () => () => {}, 'x'), undefined)
  })
  assert.equal(callbackRan, true)
  assert.equal(warnings.length, 1)

  const throwingHost = createDshHost({ logger: { warn() {} } })
  const throwingCtx = {
    get() {
      throw new Error('boom')
    },
  }
  assert.equal(throwingHost.get(throwingCtx, 'webServer'), undefined)

  const parentEffects = []
  const parentHost = createDshHost({
    effect(fn, label) {
      parentEffects.push(label)
      return fn
    },
  })
  parentHost.effect({}, () => () => {}, 'fallback')
  assert.deepEqual(parentEffects, ['fallback'])
})

// ---------------------------------------------------------------------------
// v1.81：全局模型预算 + 并发闸门 + selfFacts 证据绑定（吸收 ai-memory 的工程原则）
// ---------------------------------------------------------------------------

test('model-budget v1.81：按上海本地日计数、role/总预算、跨日重置、并发闸门', async () => {
  const dir = makeTmpDir('dshp-budget')
  const file = path.join(dir, 'model-budget.json')
  const dayMs = 24 * 60 * 60 * 1000
  let clock = new Date('2026-10-26T10:00:00+08:00').getTime()
  const now = () => clock
  const budget = createModelBudget({
    file,
    env: { DSH_POETRY_DAILY_TOTAL: '3', DSH_POETRY_DAILY_MOOD: '2', DSH_POETRY_DAILY_SELF_TALK: '1' },
    now,
    logger: { warn() {}, info() {} },
  })
  assert.equal(budget.tryConsume('mood').ok, true)
  assert.equal(budget.tryConsume('mood').ok, true)
  const third = budget.tryConsume('mood')
  assert.equal(third.ok, false)
  assert.match(third.message, /mood/)
  assert.equal(budget.tryConsume('selfTalk').ok, true, '其他 role 还能用到总量上限')
  assert.equal(budget.tryConsume('growth').ok, false, '总量 3 用完')
  const snapshot = budget.snapshot()
  assert.equal(snapshot.total, 3)
  assert.equal(snapshot.day, '2026-10-26')
  // 重启后仍读回当天计数
  const reread = createModelBudget({ file, env: { DSH_POETRY_DAILY_TOTAL: '3' }, now })
  assert.equal(reread.tryConsume('mood').ok, false, '跨进程同一天继续受预算约束')
  // 跨日重置
  clock += dayMs
  const nextDay = createModelBudget({ file, env: { DSH_POETRY_DAILY_TOTAL: '3' }, now })
  assert.equal(nextDay.snapshot().total, 0)
  assert.equal(nextDay.tryConsume('mood').ok, true)

  // 并发闸门：max=2，第三个排队；释放一个后第三个才拿到槽位
  const gate = createModelGate({ maxConcurrent: 2 })
  const first = await gate.acquire()
  const second = await gate.acquire()
  assert.deepEqual(gate.snapshot(), { active: 2, queued: 0, maxConcurrent: 2 })
  let thirdReady = false
  const thirdSlot = gate.acquire().then((release) => {
    thirdReady = true
    return release
  })
  await Promise.resolve()
  assert.equal(thirdReady, false, '第三个调用应排队')
  first()
  const thirdRelease = await thirdSlot
  assert.equal(thirdReady, true, '释放后第三个调用获得槽位')
  assert.equal(gate.snapshot().active, 2)
  second()
  thirdRelease()
  assert.equal(gate.snapshot().active, 0)
})

test('llm-call v1.81：预算拒绝时不再发模型请求，且不按候选回退', async () => {
  const llm = makeMockLlm(() => '不应该被调用')
  const budget = {
    tryConsume() {
      return { ok: false, message: '今日模型调用预算已用完（mood）' }
    },
  }
  configureModelRuntime({ budget, gate: null })
  try {
    const result = await callModelForRole({
      role: 'mood',
      policy: { resolveCandidates: () => [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] },
      system: 's',
      prompt: 'p',
      llm,
      maxTokens: 64,
      timeoutMs: 100,
    })
    assert.equal(result, null)
    assert.equal(llm.calls.length, 0, '预算拒绝后不应调用模型（也不换候选）')
  } finally {
    resetModelRuntime()
  }
})

test('memory-layers v1.81：selfFacts 来源绑定、近似去重、supersedes 退休、使用计数与召回过滤', async () => {
  const dir = makeTmpDir('dshp-facts')
  const layersPath = path.join(dir, 'memory-layers.json')
  const layers = createMemoryLayers({ file: layersPath, logger: { warn() {} } })
  assert.equal(
    layers.addSelfFacts(['我喜欢看人怎么做事。'], 1000, { sourceEpisodeId: 'ep-1' }),
    1,
  )
  let reread = readMemoryLayers(layersPath)
  assert.equal(reread.selfFacts.length, 1)
  assert.equal(reread.selfFacts[0].sourceEpisodeId, 'ep-1')
  assert.equal(reread.selfFacts[0].status, 'active')
  assert.equal(reread.selfFacts[0].accessCount, 0)
  // 近似重复（只差标点/语气词）不重复写入
  assert.equal(layers.addSelfFacts(['我喜欢看人怎么做事'], 1001, { sourceEpisodeId: 'ep-2' }), 0)
  assert.equal(layers.addSelfFacts(['我喜欢看人怎么做事呀。'], 1002, { sourceEpisodeId: 'ep-3' }), 0)
  // supersedes：旧句退休但保留，新句成为 active
  assert.equal(
    layers.addSelfFacts([{ text: '我不想一直等别人来带我。', supersedes: '我喜欢看人怎么做事。' }], 2000, {
      sourceEpisodeId: 'ep-2',
    }),
    1,
  )
  reread = readMemoryLayers(layersPath)
  assert.equal(reread.selfFacts.length, 2, '旧句不删除')
  const old = reread.selfFacts.find((item) => item.text.includes('看人怎么做事'))
  assert.equal(old.status, 'retired')
  assert.equal(old.supersededBy, '我不想一直等别人来带我。')
  const active = layers.activeSelfFacts(10)
  assert.equal(active.length, 1)
  assert.match(active[0].text, /等别人来带我/)
  // 使用计数让 active 排序更稳
  assert.equal(layers.touchSelfFacts(['我不想一直等别人来带我。'], 3000), 1)
  assert.equal(layers.touchSelfFacts(['我不想一直等别人来带我。'], 4000), 1)
  assert.equal(layers.activeSelfFacts(1)[0].accessCount, 2)
  assert.equal(layers.activeSelfFacts(1)[0].lastAccessedAt, 4000)

  // 召回只注入 active 短句
  const journalPath = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(journalPath, JSON.stringify({ ts: 100, kind: 'murmur', text: '今天在窗边坐了很久。' }) + '\n', 'utf8')
  const recall = createMemoryRecall({
    journalPath,
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    layersPath,
    now: () => 5000,
  })
  const digest = recall.digest({ moodLabel: '安静' })
  assert.ok(digest.selfFacts.some((text) => text.includes('等别人来带我')))
  assert.equal(digest.selfFacts.some((text) => text.includes('看人怎么做事')), false, '退休短句不再注入')
  const touched = readMemoryLayers(layersPath)
  assert.equal(touched.selfFacts.find((item) => item.status === 'active').accessCount, 3, '召回命中会增加使用计数')

  // 解析整合结果：对象形式保留 supersedes 信息
  const parsed = parseConsolidationResult(
    JSON.stringify({
      summary: '那几天我总在窗边坐着，看人怎么做事，也慢慢不想一直等别人来带我。',
      selfFacts: [{ text: '我不想一直等别人来带我。', supersedes: '我喜欢看人怎么做事。' }],
    }),
  )
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.selfFacts, ['我不想一直等别人来带我。'])
  assert.deepEqual(parsed.selfFactObjects, [{ text: '我不想一直等别人来带我。', supersedes: '我喜欢看人怎么做事。' }])
})

test('heartbeat v1.82：单一定时器、按 everyMs/offset 触发、失败隔离、snapshot', async () => {
  let clock = 1_000_000
  const callbacks = []
  const cleared = []
  let fired = 0
  let failed = 0
  const heartbeat = createHeartbeat({
    now: () => clock,
    intervalMs: 60_000,
    setIntervalImpl: (fn) => {
      callbacks.push(fn)
      return { unref() {} }
    },
    clearIntervalImpl: (timer) => cleared.push(timer),
    logger: { warn() {}, info() {} },
  })
  heartbeat.add('ok', () => {
    fired += 1
  }, { everyMs: 60_000 })
  heartbeat.add('later', () => {
    fired += 1
  }, { everyMs: 60_000, offsetMs: 120_000 })
  heartbeat.add('boom', () => {
    failed += 1
    throw new Error('心跳任务失败')
  }, { everyMs: 60_000 })
  heartbeat.start()
  assert.equal(callbacks.length, 1, '只创建 1 个 interval')
  assert.equal(fired, 1, '首拍立即执行到期的任务（later 还没到）')
  assert.equal(failed, 1)
  let snap = heartbeat.snapshot()
  assert.equal(snap.pulses, 1)
  assert.equal(snap.jobs.length, 3)
  assert.equal(snap.jobs.find((job) => job.name === 'boom').errors, 1)
  // 同一时刻再次 pulse：任务还没到期，不重复执行
  heartbeat.pulse()
  assert.equal(fired, 1)
  // 推进 60s：ok/boom 到期；later 仍未到
  clock += 60_000
  callbacks[0]()
  assert.equal(fired, 2, 'ok 再跑一次（boom 只计 failed）')
  assert.equal(failed, 2)
  // 再推进 60s：later 到期，ok/later 都跑
  clock += 60_000
  callbacks[0]()
  assert.equal(fired, 4)
  heartbeat.stop()
  assert.equal(cleared.length, 1)
  // 已 dispose 后 pulse 不再执行
  heartbeat.dispose()
  clock += 60_000
  heartbeat.pulse()
  assert.equal(fired, 4)
})

test('v2.0 资源放宽：wander 全语言维基 / reading 全语言 Wikisource / 随机公版页', async () => {
  // wander：不再只限 zh/en；后缀校验防止 evil 域名
  assert.deepEqual(SELF_WANDER_ALLOWED_SUFFIXES, ['wikipedia.org', 'wikisource.org'])
  assert.equal(wanderRandomUrl('ja'), 'https://ja.wikipedia.org/api/rest_v1/page/random/summary')
  assert.equal(wanderRandomUrl('xx'), 'https://zh.wikipedia.org/api/rest_v1/page/random/summary')
  const jaPage = { title: '深海', extract: '深海は、海洋のうち水深200メートル以上の領域を指す。', host: 'ja.wikipedia.org', url: 'https://ja.wikipedia.org/wiki/深海' }
  const jaFetched = await fetchRandomPage({
    random: () => 0,
    fetchImpl: async () => ({ ok: true, url: jaPage.url, json: async () => ({ title: jaPage.title, extract: jaPage.extract }) }),
  })
  assert.equal(jaFetched.host, 'ja.wikipedia.org')
  assert.equal(
    await fetchRandomPage({
      fetchImpl: async () => ({ ok: true, url: 'https://wikipedia.org.evil.example/x', json: async () => ({ title: 'x', extract: jaPage.extract }) }),
    }),
    null,
    '后缀相似但非维基域名必须拒绝',
  )

  // reading：所有语言 Wikisource 都可以；随机公版页解析
  assert.equal(isAllowedReadingHost('zh.wikisource.org'), true)
  assert.equal(isAllowedReadingHost('ja.wikisource.org'), true)
  assert.equal(isAllowedReadingHost('wikisource.org'), true)
  assert.equal(isAllowedReadingHost('wikisource.org.evil.example'), false)
  assert.match(SELF_READING_RANDOM_API, /generator=random/)
  const randomPage = await fetchRandomReadingExcerpt({
    fetchImpl: async () => ({
      ok: true,
      url: 'https://zh.wikisource.org/w/api.php',
      json: async () => ({ query: { pages: [{ title: '陋室銘', extract: '山不在高，有仙則名。水不在深，有龍則靈。斯是陋室，惟吾德馨。'.repeat(16) }] } }),
    }),
  })
  assert.equal(randomPage.title, '陋室銘')
  assert.ok(randomPage.text.includes('山不在高'))
  assert.equal(
    await fetchRandomReadingExcerpt({
      fetchImpl: async () => ({ ok: true, url: 'https://evil.example/x', json: async () => ({ query: { pages: [] } }) }),
    }),
    null,
  )
})

test('v2.0 预算默认不限制；self-talk 主题只在概率内出现', async () => {
  const dir = makeTmpDir('dshp-budget-open')
  const budget = createModelBudget({ file: path.join(dir, 'budget.json'), env: {}, now: () => 1000 })
  assert.equal(budget.snapshot().totalLimit, 0, '默认不设总上限')
  for (let index = 0; index < 500; index += 1) assert.equal(budget.tryConsume('mood').ok, true)
  assert.equal(budget.snapshot().total, 500)
  assert.equal(budget.snapshot().limits.mood, 0, '默认不设 role 上限')

  // themeProbability=0 → prompt 不再带固定小主题
  const llm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const service = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    random: () => 0.5,
    themeProbability: 0,
  })
  const result = await service.generate({})
  assert.equal(result.ok, true)
  assert.equal(llm.calls[0].messages[0].content[0].text.includes('这次试着围绕'), false, '概率为 0 时不强加主题')
})

// ---------------------------------------------------------------------------
// v2.1：安全公开网页抓取 + 无密钥搜索
// ---------------------------------------------------------------------------

test('safe-web v2.1：私网/保留地址、URL 校验、DNS 全地址校验', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPrivateAddress(ip), true, `应拒绝 ${ip}`)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, `应允许 ${ip}`)
  }
  assert.equal(isPrivateAddress('203.0.113.10'), true, '文档段按保留地址拒绝')

  assert.throws(() => validatePublicUrl('file:///etc/passwd'), /只允许 http/)
  assert.throws(() => validatePublicUrl('http://user:pass@example.com/'), /账号密码/)
  assert.throws(() => validatePublicUrl('http://example.com:6379/'), /80\/443/)
  assert.equal(validatePublicUrl('https://example.com/a?b=1').hostname, 'example.com')

  const publicAddress = await resolvePublicAddress('example.com', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  })
  assert.equal(publicAddress, '93.184.216.34')
  await assert.rejects(
    () => resolvePublicAddress('localhost', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /私网/,
  )
  await assert.rejects(
    () =>
      resolvePublicAddress('mixed.example', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
      }),
    /私网/,
    '任一地址私网都拒绝',
  )
})

test('safe-web v2.1：抓取走重定向校验、内容类型/大小限制、HTML 提取与搜索解析', async () => {
  const lookup = async (hostname) => {
    const map = {
      'public.example': [{ address: '93.184.216.34', family: 4 }],
      'private.example': [{ address: '10.0.0.9', family: 4 }],
      'second.example': [{ address: '93.184.216.35', family: 4 }],
    }
    const rows = map[hostname]
    if (!rows) throw new Error('no such host')
    return rows
  }
  const requestImpl = async (url) => {
    if (url.hostname === 'public.example') {
      return { status: 302, headers: { location: 'https://second.example/final' }, body: Buffer.from('') }
    }
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from('<html><head><title>鲸落</title></head><body><p>鲸落指鲸鱼死后沉入深海，尸体支撑起延续数十年的生态系统。</p><script>alert(1)</script></body></html>'),
    }
  }
  const page = await fetchPublicPage('https://public.example/start', { lookup, requestImpl })
  assert.equal(page.url, 'https://second.example/final')
  assert.equal(page.title, '鲸落')
  assert.match(page.text, /鲸鱼死后沉入深海/)
  assert.equal(page.text.includes('alert'), false, '脚本被剥离')

  await assert.rejects(
    () =>
      fetchPublicPage('https://public.example/start', {
        lookup,
        requestImpl: async () => ({ status: 302, headers: { location: 'http://private.example/x' }, body: Buffer.from('') }),
      }),
    /私网/,
  )
  await assert.rejects(
    () =>
      fetchPublicPage('https://public.example/x', {
        lookup,
        requestImpl: async () => ({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('x') }),
      }),
    /内容类型/,
  )
  await assert.rejects(
    () =>
      fetchPublicPage('https://public.example/x', {
        lookup,
        maxRedirects: 1,
        requestImpl: async () => ({ status: 302, headers: { location: 'https://public.example/y' }, body: Buffer.from('') }),
      }),
    /重定向太多/,
  )
  assert.equal(extractHtmlTitle('<title> 一段 标题 </title>'), '一段 标题')
  assert.match(extractReadableText('<p>甲</p><p>乙</p>'), /甲[\s\S]*乙/)

  const ddgHtml = [
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">标题 A</a>',
    '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fb">标题 B</a>',
    '<a class="result__a" href="http://10.0.0.1/secret">内网</a>',
  ].join('\n')
  const parsed = parseDuckDuckGoResults(ddgHtml, 5)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].title, '标题 A')
  assert.equal(parsed[0].url, 'https://example.com/a')
  assert.equal(parsed[1].url, 'https://example.com/b')

  const web = createWebAccess({
    now: () => 1000,
    minGapMs: 0,
    searchImpl: async (query) => [{ title: `结果：${query}`, url: 'https://example.com/x' }],
    requestImpl: async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('一段公开网页正文，足够长，可以给她读。') }),
    lookup,
  })
  const results = await web.search('深海 鲸落', { limit: 3 })
  assert.equal(results[0].title, '结果：深海 鲸落')
  const fetched = await web.fetchPage('https://public.example/text')
  assert.match(fetched.text, /公开网页正文/)
  assert.equal(web.snapshot().searches, 1)
  assert.equal(web.snapshot().fetches, 1)
  assert.equal(web.snapshot().disabled, false)
})

test('self-wander v2.1：按她正在琢磨的事搜索公开网页；失败回落到维基', async () => {
  const dir = makeTmpDir('dshp-wander-web')
  const learningLogPath = path.join(dir, 'learning-log.md')
  const calls = []
  const llm = makeMockLlm(() =>
    JSON.stringify({ note: '这一页讲深海热泉，我盯着「没有阳光也能活」看了很久。', interesting: true }),
  )
  const webAccess = {
    async search(query) {
      calls.push(['search', query])
      return [{ title: '深海热泉', url: 'https://example.org/hydrothermal' }]
    },
    async fetchPage(url) {
      calls.push(['fetch', url])
      return {
        url,
        title: '深海热泉',
        text: '深海热泉是海底热水喷口，周围生物不靠阳光，而靠化学能生存。'.repeat(8),
      }
    },
  }
  const wander = createSelfWander({
    state: { snapshot: () => ({ sleeping: false, experiencing: '在想深海里没有阳光的地方怎么活' }) },
    llm,
    webAccess,
    policy: { resolveCandidates: (role) => (role === 'wander' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    learningLogPath,
    statePath: path.join(dir, 'wander-state.json'),
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应回落维基')
    },
  })
  const result = await wander.wanderNow()
  assert.equal(result.ok, true)
  assert.equal(result.title, '深海热泉')
  assert.equal(result.host, 'example.org')
  assert.match(fs.readFileSync(learningLogPath, 'utf8'), /地方：深海热泉（example\.org）/)
  assert.equal(calls.length, 2, '先搜索再抓取')

  // 搜索/抓取都失败 → 回落维基（这里让 fetchImpl 提供维基结果）
  const fallback = createSelfWander({
    state: { snapshot: () => ({ sleeping: false, experiencing: '在想深海里没有阳光的地方怎么活' }) },
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    logger: { warn() {}, info() {} },
    learningLogPath: path.join(dir, 'fallback.md'),
    env: {},
    now: () => FIXED_NOW.getTime(),
    webAccess: { search: async () => [], fetchPage: async () => { throw new Error('fetch fail') } },
    fetchImpl: async () => ({ ok: true, url: 'https://zh.wikipedia.org/wiki/深海', json: async () => ({ title: '深海', extract: '深海一般指水深超过两百米的海域。'.repeat(10) }) }),
  })
  const fallbackResult = await fallback.wanderNow()
  assert.equal(fallbackResult.ok, true)
  assert.equal(fallbackResult.host, 'zh.wikipedia.org')
})

test('safe-web v2.1：Wikipedia / SearXNG 搜索结果解析', () => {
  const wiki = parseWikipediaSearchPayload(
    { query: { search: [{ title: '海底熱泉', snippet: '<span>深海</span>熱泉是…' }, { title: '深海生物聚落', snippet: '靠化學能…' }] } },
    3,
  )
  assert.equal(wiki.length, 2)
  assert.equal(wiki[0].title, '海底熱泉')
  assert.match(wiki[0].url, /zh\.wikipedia\.org\/wiki\//)
  assert.match(wiki[0].snippet, /深海/)
  const searx = parseSearxResults(
    { results: [{ title: 'Hydrothermal vent', url: 'https://example.org/vent', content: 'A hydrothermal vent is …' }] },
    3,
  )
  assert.equal(searx.length, 1)
  assert.equal(searx[0].url, 'https://example.org/vent')
})

test('safe-web v2.2：从页面里抽公开链接（相对路径解析/私网/资源跳过）', () => {
  const html = [
    '<a href="/a">相对</a>',
    '<a href="https://other.example/b">绝对</a>',
    '<a href="http://10.0.0.1/secret">内网</a>',
    '<a href="javascript:void(0)">脚本</a>',
    '<a href="/img/x.jpg">图片</a>',
    '<a href="/a">重复</a>',
  ].join('')
  const links = extractPageLinks(html, 'https://example.com/page', { limit: 10 })
  assert.deepEqual(links, ['https://example.com/a', 'https://other.example/b'])
  assert.deepEqual(extractPageLinks('<a href="/x">x</a>', 'not-a-url'), [])
})

test('self-wander v2.2：从上一页顺着链接走一步，并记住新的落脚点', async () => {
  const dir = makeTmpDir('dshp-wander-roam')
  const statePath = path.join(dir, 'wander-state.json')
  fs.writeFileSync(statePath, JSON.stringify({ ok: true, lastWanderAt: 0, lastWebUrl: 'https://example.org/start' }))
  const llm = makeMockLlm(() => JSON.stringify({ note: '从海边的页面点到一篇讲潮汐的页面，我停下来看了一会儿。', interesting: true }))
  const fetched = []
  const webAccess = {
    async search() {
      throw new Error('不该搜索')
    },
    async fetchPage(url) {
      fetched.push(url)
      if (url.endsWith('/start')) {
        return {
          url,
          title: '起点',
          text: '起点页正文。'.repeat(30),
          html: '<a href="/tide">潮汐</a><a href="/moon">月亮</a>',
        }
      }
      return {
        url,
        title: '潮汐',
        text: '潮汐是海水在月球和太阳引力作用下发生的周期性涨落。'.repeat(8),
        html: '',
      }
    },
  }
  const wander = createSelfWander({
    state: { snapshot: () => ({ sleeping: false, experiencing: '在想海边的潮水' }) },
    llm,
    webAccess,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    logger: { warn() {}, info() {} },
    learningLogPath: path.join(dir, 'learning-log.md'),
    statePath,
    env: {},
    now: () => FIXED_NOW.getTime(),
    random: () => 0,
    fetchImpl: async () => {
      throw new Error('不应回落维基')
    },
  })
  const result = await wander.wanderNow()
  assert.equal(result.ok, true)
  assert.equal(result.title, '潮汐')
  assert.equal(result.host, 'example.org')
  assert.deepEqual(fetched, ['https://example.org/start', 'https://example.org/tide'])
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.equal(saved.lastWebUrl, 'https://example.org/tide')
})

test('memory-recall v2.2：碎碎念素材包含“今天真实发生的事”，过往仍走分层记忆', () => {
  const dir = makeTmpDir('dshp-today-recall')
  const journalPath = path.join(dir, 'journal.jsonl')
  const now = FIXED_NOW.getTime()
  const lines = [
    { ts: now - 2 * 24 * 60 * 60 * 1000, kind: 'thought', text: '两天前在窗边想通了一件小事。' },
    { ts: now - 10 * 60 * 1000, kind: 'murmur', text: '今天把杯盖拆下来晾，橡胶圈还潮着。' },
    { ts: now - 3 * 60 * 1000, kind: 'mood', label: '松下来', reason: '光挪到桌角' },
  ]
  fs.writeFileSync(journalPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8')
  const recall = createMemoryRecall({
    journalPath,
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    layersPath: null,
    now: () => now,
  })
  const digest = recall.digest({ moodLabel: '安静' })
  assert.equal(digest.todayJournal.length, 2, '只取今天的两条')
  assert.ok(digest.todayJournal.some((text) => text.includes('杯盖拆下来晾')))
  assert.ok(digest.todayJournal.some((text) => text.includes('松下来')))
  assert.equal(digest.todayJournal.some((text) => text.includes('两天前在窗边')), false, '两天前的事不冒充今天')
  const formatted = formatMemoryDigest(digest)
  assert.match(formatted, /今天你自己经历的/)
})

test('self-talk v2.2：默认不再从主题/话题数组里挑，素材来自心情+今天+过往', async () => {
  const llm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const service = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    random: () => 0,
    recall: {
      digest: () => ({
        thoughts: ['最近在想潮水为什么一天两次。'],
        moods: ['傍晚有点松下来。'],
        learned: ['潮汐由月球和太阳引力造成。'],
        todayJournal: ['今天把杯盖拆下来晾，橡胶圈还潮着。'],
        selfFacts: ['我容易被细小的动静带走。'],
        deepMemories: [],
      }),
    },
  })
  const result = await service.generate({ moodKey: 'calm', moodLabel: '平静', moodReason: '光挪到桌角' })
  assert.equal(result.ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /今天你自己经历的/)
  assert.match(prompt, /不要从任何主题清单或话题库/)
  assert.equal(prompt.includes('这次试着围绕'), false, '默认不再带固定主题')
  assert.match(prompt, /此刻的心情/)
  assert.match(prompt, /平静/)
})

test('deepseek-web v2.3：Search/Fetch 请求形状、结果映射、错误码、无 key 返回 null', async () => {
  assert.equal(createDeepSeekWeb({ apiKey: '' }), null)
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/v1/tools/search')) {
      return {
        status: 200,
        json: async () => ({
          results: [
            {
              title: '深海热泉',
              url: 'https://example.org/vent',
              snippet: '短摘要',
              summary: '长摘要：深海热泉靠化学能支撑生态。',
              content: '正文内容：深海热泉是海底热水喷口。'.repeat(10),
              site_name: 'Example',
              date: '2026-10-01T00:00:00+00:00',
              authority: 3,
              rerank_score: 2.1,
            },
            { title: '内网', url: 'http://10.0.0.1/secret' },
          ],
        }),
      }
    }
    return { status: 200, json: async () => ({ title: '深海热泉页', content: '# 标题\n\n正文内容。'.repeat(20) }) }
  }
  const web = createDeepSeekWeb({ apiKey: 'sk-test', fetchImpl, logger: { warn() {} } })
  assert.ok(web)
  const results = await web.search('深海热泉', { count: 5, needContent: true, oriQuestion: '为什么深海有生命' })
  assert.equal(results.length, 1, '私网结果被过滤')
  assert.equal(results[0].url, 'https://example.org/vent')
  assert.match(results[0].text, /正文内容/)
  const searchCall = calls[0]
  assert.equal(searchCall.url, 'https://api.deepseek.com/v1/tools/search')
  assert.equal(searchCall.options.headers.authorization, 'Bearer sk-test')
  const body = JSON.parse(searchCall.options.body)
  assert.deepEqual(body, { query: '深海热泉', count: 5, need_content: true, ori_question: '为什么深海有生命' })

  const page = await web.fetchPage('https://example.org/vent')
  assert.equal(page.title, '深海热泉页')
  assert.match(page.text, /正文内容/)
  const fetchCall = calls[1]
  assert.equal(fetchCall.url, 'https://api.deepseek.com/v1/tools/fetch')
  assert.deepEqual(JSON.parse(fetchCall.options.body), { url: 'https://example.org/vent' })
  assert.deepEqual(web.snapshot().searches, 1)

  // 401 → 明确错误码
  const bad = createDeepSeekWeb({
    apiKey: 'bad',
    fetchImpl: async () => ({ status: 401, json: async () => ({ error: { message: 'invalid key' } }) }),
    logger: { warn() {} },
    retries: 0,
  })
  const badResults = await bad.search('x')
  assert.deepEqual(badResults, [])
  assert.equal(bad.snapshot().lastError, 'invalid key')
  await assert.rejects(() => bad.fetchPage('https://example.org/x'), /invalid key/)

  // createWebAccess 优先用 DeepSeek；失败回落 Wikipedia
  const webAccess = createWebAccess({
    env: {},
    minGapMs: 0,
    deepseek: {
      search: async () => [{ title: 'DS 结果', url: 'https://example.org/a', text: '正文'.repeat(120) }],
      fetchPage: async () => ({ url: 'https://example.org/a', title: 'DS 页面', text: '正文'.repeat(120) }),
      snapshot: () => ({ enabled: true, searches: 1, fetches: 1, lastError: null }),
    },
  })
  const ds = await webAccess.search('测试', { limit: 3 })
  assert.equal(ds[0].title, 'DS 结果')
  assert.equal(webAccess.snapshot().deepseek.enabled, true)
})

test('memory-baseline v2.6：归档/首次安装后创建空白记忆容器，不覆盖已有文件', () => {
  const dir = makeTmpDir('dshp-baseline')
  const env = { DSH_HOME: dir }
  const first = seedMemoryBaseline({ env, home: dir })
  assert.ok(first.includes('topics.json'))
  assert.ok(first.includes('memory-layers.json'))
  assert.ok(first.includes('self-state.json'))
  const memoryDir = path.join(dir, 'agent-memory')
  const stateDir = path.join(dir, '.dsh-poetry')
  const topics = JSON.parse(fs.readFileSync(path.join(memoryDir, 'topics.json'), 'utf8'))
  assert.deepEqual(topics.topics, [])
  const layers = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-layers.json'), 'utf8'))
  assert.deepEqual(layers.episodes, [])
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'self-state.json'), 'utf8'))
  assert.equal(state.v, 2)
  assert.equal(state.felt, '')
  // 不覆盖已有内容
  fs.writeFileSync(path.join(memoryDir, 'topics.json'), JSON.stringify({ ok: true, v: 1, topics: [{ id: 'x' }] }))
  const second = seedMemoryBaseline({ env, home: dir })
  assert.equal(second.includes('topics.json'), false, '已有文件不动')
  assert.equal(JSON.parse(fs.readFileSync(path.join(memoryDir, 'topics.json'), 'utf8')).topics.length, 1)
})

test('memory-layers v2.7：多批整合 + backlog 统计（吞吐跟上经历）', async () => {
  const dir = makeTmpDir('dshp-layers-batch')
  const layersPath = path.join(dir, 'memory-layers.json')
  const journalPath = path.join(dir, 'journal.jsonl')
  const now = FIXED_NOW.getTime()
  const day = 24 * 60 * 60 * 1000
  const entries = [
    { ts: now - 3 * day, kind: 'murmur', text: '三天前的下午，我把窗台那盆薄荷转了个方向。' },
    { ts: now - 3 * day + 60_000, kind: 'murmur', text: '三天前的下午，我把窗台那盆薄荷转了个方向呀。' },
    { ts: now - 3 * day + 120_000, kind: 'mood', label: '安静', reason: '窗台有光' },
    { ts: now - 3 * day + 180_000, kind: 'murmur', text: '后来发现叶背有一小块干斑，我用指尖沾水按了按。' },
  ]
  fs.writeFileSync(journalPath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
  const layers = createMemoryLayers({ file: layersPath, logger: { warn() {} } })
  const llm = makeMockLlm(() =>
    JSON.stringify({
      summary: '那几天我一直在照看窗台那盆薄荷，转方向、看叶背，也注意到光落在上面的样子。',
      selfFacts: ['我对窗台上的植物会记得很清楚。'],
    }),
  )
  const consolidator = createMemoryConsolidator({
    layers,
    journalPath,
    llm,
    policy: { resolveCandidates: (role) => (role === 'consolidate' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => now,
    intervalMs: 0,
    minAgeMs: 2 * day,
    batchMax: 2,
    maxBatchesPerRun: 2,
  })
  const before = countJournalEntries(journalPath, { before: now - 2 * day, after: 0 })
  assert.equal(before.count, 4, '四天前的条目都在 backlog 里')
  const run = await consolidator.consolidateNow({ force: true })
  assert.equal(run.ok, true)
  assert.equal(run.epochsAdded ?? run.episodesAdded, 2, '两批各生成一段回忆')
  assert.equal(run.entryCount, 4)
  const after = readMemoryLayers(layersPath)
  assert.equal(after.episodes.length, 2)
  assert.equal(after.selfFacts.length, 1, '近似短句只保留一条')
  const remaining = countJournalEntries(journalPath, { before: now - 2 * day, after: after.consolidatedThrough })
  assert.equal(remaining.count, 0, 'backlog 被清空')
  consolidator.dispose()
})

test('self-projects v2.8：她起项目/推进/收尾，持久化且不伪造', () => {
  const dir = makeTmpDir('dshp-projects')
  const file = path.join(dir, 'projects.json')
  let clock = 1000
  const projects = createSelfProjects({ file, now: () => clock, logger: { warn() {} } })
  assert.equal(projects.snapshot().current, null)
  assert.equal(projects.apply({}, clock), null)
  let change = projects.apply({ title: '把窗台那盆薄荷养回来', step: '先把它挪到有光的地方。' }, clock)
  assert.equal(change.action, 'started')
  assert.equal(projects.snapshot().current.title, '把窗台那盆薄荷养回来')
  clock += 1000
  change = projects.apply({ step: '今天把枯掉的叶子剪掉。', status: 'continue' }, clock)
  assert.equal(change.action, 'stepped')
  assert.equal(projects.snapshot().current.steps.length, 2)
  clock += 1000
  change = projects.apply({ step: '薄荷长出新叶了，这件事先到这里。', status: 'done' }, clock)
  assert.equal(change.action, 'ended')
  assert.equal(projects.snapshot().current, null)
  assert.equal(projects.snapshot().completedCount, 1)
  const reread = createSelfProjects({ file, now: () => clock })
  assert.equal(reread.snapshot().completedCount, 1)
  assert.match(reread.snapshot().recentCompleted[0].title, /薄荷/)
  // 收尾后可以再起一个
  const next = reread.apply({ title: '弄明白潮汐和月亮的关系', status: 'continue' }, clock)
  assert.equal(next.action, 'started')
})

test('self-drive v2.8：自处 prompt 带当前项目，模型输出 project 能推动项目', async () => {
  const promptWithout = buildSelfDrivePrompt({ now: FIXED_NOW.getTime(), state: { felt: '醒着' } })
  assert.match(promptWithout, /可以在 project 里起一个/)
  const promptWith = buildSelfDrivePrompt({
    now: FIXED_NOW.getTime(),
    state: { felt: '醒着' },
    project: { title: '把薄荷养回来', note: '窗台那盆', steps: [{ text: '挪到有光的地方。' }] },
  })
  assert.match(promptWith, /你最近在持续做的一件事：把薄荷养回来/)
  assert.match(promptWith, /最近推进：挪到有光的地方/)
  const parsed = parseSelfDriveResult(
    JSON.stringify({
      felt: '傍晚的光落在窗台上，薄荷的土有点干。',
      doing: '给薄荷浇了点水',
      project: { step: '今天把枯叶剪掉。', status: 'continue' },
    }),
  )
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.project, { title: '', step: '今天把枯叶剪掉。', status: 'continue', dueInHours: null })
})

test('memory-recall v2.8：当前项目进入碎碎念素材', () => {
  const dir = makeTmpDir('dshp-recall-project')
  const projectsPath = path.join(dir, 'projects.json')
  const projects = createSelfProjects({ file: projectsPath, now: () => FIXED_NOW.getTime() })
  projects.apply({ title: '把薄荷养回来', step: '今天把枯叶剪掉。' }, FIXED_NOW.getTime())
  const recall = createMemoryRecall({
    journalPath: path.join(dir, 'none.jsonl'),
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    layersPath: null,
    projectsPath,
    now: () => FIXED_NOW.getTime(),
  })
  const digest = recall.digest({ moodLabel: '安静' })
  assert.match(digest.project, /把薄荷养回来/)
  assert.match(formatMemoryDigest(digest), /你这几天在持续做的事/)
})

test('growth-metrics v2.10：活跃天数/覆盖/学习/项目/重复度 + 60s 缓存', () => {
  const dir = makeTmpDir('dshp-growth-metrics')
  const journalPath = path.join(dir, 'journal.jsonl')
  const layersPath = path.join(dir, 'memory-layers.json')
  const learningLogPath = path.join(dir, 'learning-log.md')
  const projectsPath = path.join(dir, 'projects.json')
  const now = FIXED_NOW.getTime()
  const day = 24 * 60 * 60 * 1000
  fs.writeFileSync(
    journalPath,
    [
      { ts: now - day, kind: 'thought', text: '昨天想明白了一件小事，关于窗台上的光。' },
      { ts: now - 10 * 60 * 1000, kind: 'murmur', text: '今天把窗台上的薄荷转了个方向，叶子朝着光。' },
      { ts: now - 5 * 60 * 1000, kind: 'mood', label: '安静', reason: '窗台有光' },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  )
  fs.writeFileSync(
    layersPath,
    JSON.stringify({
      ok: true, v: 1, consolidatedThrough: now - day,
      episodes: [{ id: 'ep-1', summary: '昨天在照看窗台那盆薄荷，顺手把叶子转向光。', from: now - 2 * day, to: now - day, entryCount: 2, at: now - day }],
      selfFacts: [
        { text: '我会记得窗台上的植物。', at: now - day, status: 'active', accessCount: 1 },
        { text: '我不太喜欢被一直催。', at: now - 2 * day, status: 'retired', supersededBy: '我会按自己的节奏来。' },
      ],
    }),
    'utf8',
  )
  fs.writeFileSync(
    learningLogPath,
    '## 2026-10-25 16:00 · 自学\n第一段自学内容。\n\n## 2026-10-26 10:00 · 溜达\n第二段溜达内容。\n',
    'utf8',
  )
  const projects = createSelfProjects({ file: projectsPath, now: () => now })
  projects.apply({ title: '把薄荷养回来', step: '今天把枯叶剪掉。' }, now)

  const metrics = createGrowthMetrics({
    journalPath, layersPath, learningLogPath, projectsPath, now: () => now,
  })
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.daysAlive, 2)
  assert.equal(snapshot.journal.total, 3)
  assert.equal(snapshot.journal.today, 2)
  assert.equal(snapshot.memory.episodes, 1)
  assert.equal(snapshot.memory.episodeEntries, 2)
  assert.ok(Math.abs(snapshot.memory.coverage - 2 / 3) < 1e-9, '覆盖 = 已整合条目 / journal')
  assert.equal(snapshot.selfFacts.active, 1)
  assert.equal(snapshot.selfFacts.retired, 1)
  assert.equal(snapshot.learning.sections, 2)
  assert.equal(snapshot.project.current, '把薄荷养回来')
  assert.ok(snapshot.repetition.maxSimilarity >= 0)

  // 60s 缓存：同一个 now 内再读不变
  fs.appendFileSync(journalPath, JSON.stringify({ ts: now - 1000, kind: 'murmur', text: '新写的一句。' }) + '\n')
  assert.equal(metrics.snapshot().journal.total, 3)
})

test('self-works v2.11：生成/清洗/保存/索引/只读路由', async () => {
  const dir = makeTmpDir('dshp-works')
  const calls = []
  const llm = makeMockLlm(() =>
    JSON.stringify({
      title: '窗台的光',
      kind: 'svg',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" onload="alert(1)"><script>alert(2)</script><rect x="10" y="10" width="300" height="180" fill="#ffd27f"/><text x="20" y="60">窗台的光</text><image href="https://evil.example/x.png"/></svg>',
    }),
  )
  const works = createSelfWorks({
    dir,
    llm,
    policy: { resolveCandidates: (role) => (role === 'growth' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await works.makeNow({ idea: '傍晚的光' })
  assert.equal(result.ok, true)
  const duplicate = await works.makeNow({ idea: '傍晚的光' })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.reason, 'duplicate')
  const file = path.join(dir, result.work.file)
  assert.equal(fs.existsSync(file), true)
  const svg = fs.readFileSync(file, 'utf8')
  assert.equal(svg.includes('<script'), false, 'script 被剥离')
  assert.equal(svg.includes('onload'), false, '事件属性被剥离')
  assert.equal(svg.includes('evil.example'), false, '外部 href 被剥离')
  assert.match(svg, /<rect/)
  assert.equal(works.list(5).length, 1)
  const read = works.read(works.list(1)[0])
  assert.match(read.body, /窗台的光/)

  // 只读路由
  const handler = createWorksHandler({ works })
  const response = new MockResponse()
  await handler(mockRequest({ url: '/api/dsh-poetry/works.json' }), response)
  await response.finished()
  const payload = response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.works.length, 1)
  assert.equal(payload.works[0].title, '窗台的光')
  assert.match(payload.works[0].body, /<svg/)

  // 纯文字作品
  const textLlm = makeMockLlm(() => JSON.stringify({ title: '今天的一句话', kind: 'text', body: '今天的光从窗台滑到桌角，我跟着看了一会儿。' }))
  const textWorks = createSelfWorks({
    dir: path.join(dir, 'text'),
    llm: textLlm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    now: () => FIXED_NOW.getTime(),
  })
  const textResult = await textWorks.makeNow()
  assert.equal(textResult.ok, true)
  assert.equal(textResult.work.kind, 'text')
})

test('manual-reading v2.12：读文章写第一人称想法并进 journal；token 路由保护', async () => {
  const dir = makeTmpDir('dshp-manual-read')
  const appended = []
  const llm = makeMockLlm(() =>
    JSON.stringify({ thought: '读到这里我停了一下：原来“不确定”不是坏事，它只是信息还没落地。我想起自己数窗外车的时候，也是在给一件说不清的事找一个能握住的说法。', liked: true }),
  )
  const reading = createManualReading({
    llm,
    policy: { resolveCandidates: (role) => (role === 'read' ? [{ provider: 'p', model: 'm' }] : []) },
    journal: { append: async (entry) => appended.push(entry) },
    recall: { digest: () => ({ todayJournal: ['今天在窗边坐了一会儿。'], thoughts: ['在想不确定的事。'] }) },
    selfState: { snapshot: () => ({ felt: '醒着', sleeping: false }) },
    logger: { warn() {}, info() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await reading.read({ title: '一篇关于熵的文章', text: '这是一段足够长的文章内容。'.repeat(40) })
  assert.equal(result.ok, true)
  assert.match(result.thought, /不确定/)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].kind, 'thought')
  assert.match(appended[0].text, /读《一篇关于熵的文章》/)
  assert.equal((await reading.read({ title: 'x', text: '太短' })).error, 'text_too_short')

  const tokenFile = path.join(dir, 'manual-token')
  const token = ensureManualToken(tokenFile)
  const handler = createManualReadHandler({ service: { read: async (input) => ({ ok: true, title: input.title, thought: '想法' }) }, tokenFile })
  const request = mockRequest({ url: '/api/dsh-poetry/manual-read.json', method: 'POST' })
  request[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(JSON.stringify({ token, title: '文章', text: '正文'.repeat(200) }))
  }
  const okRes = new MockResponse()
  await handler(request, okRes)
  await okRes.finished()
  assert.equal(okRes.statusCode, 200)
  assert.equal(okRes.json().ok, true)

  const badReq = mockRequest({ url: '/api/dsh-poetry/manual-read.json', method: 'POST' })
  badReq[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(JSON.stringify({ token: 'wrong', title: '文章', text: '正文'.repeat(200) }))
  }
  const badRes = new MockResponse()
  await handler(badReq, badRes)
  await badRes.finished()
  assert.equal(badRes.statusCode, 403)
})

test('self-drive v2.13：预期/结果/取舍进入自处循环并持久化', async () => {
  const parsed = parseSelfDriveResult(
    JSON.stringify({
      felt: '窗外的光线开始斜了，我想把杯子挪一挪。',
      doing: '把杯子挪到光边上',
      kind: '',
      expect: '我以为挪过去会照出一小圈亮。',
      outcome: '上次说要把水烧开，后来真的滚了。',
      tradeoff: '本来想继续坐着，选了起身，放弃了一会儿发呆。',
    }),
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.expect, '我以为挪过去会照出一小圈亮。')
  assert.equal(parsed.outcome, '上次说要把水烧开，后来真的滚了。')
  assert.equal(parsed.tradeoff, '本来想继续坐着，选了起身，放弃了一会儿发呆。')

  const prompt = buildSelfDrivePrompt({
    now: 1_700_100_000_000,
    state: { sleeping: false },
    latestAction: {
      id: 'a1', text: '把水烧上。', expect: '我以为水很快就开。', at: 1_700_000_000_000,
    },
  })
  assert.match(prompt, /上次你说要做「把水烧上/)
  assert.match(prompt, /你当时以为：我以为水很快就开/)

  const dir = makeTmpDir('dshp-drive-expect')
  const actionsPath = path.join(dir, 'self-actions.json')
  fs.writeFileSync(
    actionsPath,
    JSON.stringify({
      ok: true, v: 1,
      actions: [{ id: 'a1', kind: 'doing', label: '把水烧上', text: '把水烧上。', at: 1_700_000_000_000, expect: '我以为水很快就开。' }],
    }),
  )
  const llm = makeMockLlm(() =>
    JSON.stringify({
      felt: '水开过了，屋里有点热。',
      doing: '把杯子挪到光边上',
      kind: '',
      outcome: '水真的很快开了，热气扑上来。',
      expect: '我以为挪过去会照出一小圈亮。',
      tradeoff: '本来想继续坐着，选了起身。',
    }),
  )
  const state = {
    snapshot: () => ({ sleeping: false, felt: '', lastActionAt: null }),
    setFelt() {},
    markChecked() {},
    applyEvent() {},
  }
  const drive = createSelfDrive({
    state,
    llm,
    actionsPath,
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  await drive.check(1_700_100_000_000)
  const saved = JSON.parse(fs.readFileSync(actionsPath, 'utf8')).actions
  assert.equal(saved.length, 2)
  assert.equal(saved[0].outcome, '水真的很快开了，热气扑上来。', '上一动作的结果回写')
  assert.equal(saved[1].expect, '我以为挪过去会照出一小圈亮。')
  assert.equal(saved[1].tradeoff, '本来想继续坐着，选了起身。')
  drive.dispose()
})

test('self-drive v2.14：冲突必须写取舍；上次结果会回灌到 prompt', () => {
  const noTradeoff = parseSelfDriveResult(
    JSON.stringify({ felt: '外面有鸟叫，我想出去又舍不得放下手里的杯子。', doing: '走到窗边看看', conflict: true }),
  )
  assert.equal(noTradeoff.ok, false)
  assert.match(noTradeoff.message, /tradeoff/)
  const withTradeoff = parseSelfDriveResult(
    JSON.stringify({
      felt: '外面有鸟叫，我想出去又舍不得放下手里的杯子。',
      doing: '走到窗边看看',
      conflict: true,
      tradeoff: '选了去窗边，放弃继续握着杯子坐着。',
    }),
  )
  assert.equal(withTradeoff.ok, true)

  const prompt = buildSelfDrivePrompt({
    now: FIXED_NOW.getTime(),
    state: { sleeping: false },
    latestAction: {
      id: 'a1',
      text: '把水烧上。',
      expect: '我以为水很快就开。',
      outcome: '水真的很快开了，热气扑上来。',
      tradeoff: '本来想坐着，选了起身。',
    },
  })
  assert.match(prompt, /后来你看到的结果：水真的很快开了/)
  assert.match(prompt, /上次你取舍过：本来想坐着，选了起身/)
  assert.match(prompt, /这次遇到同类的选择，你会不会因此换一种做法/)
})

test('self-drive v2.15：把最近动作摊开，提醒她别在同一件事上打转', () => {
  const prompt = buildSelfDrivePrompt({
    now: FIXED_NOW.getTime(),
    state: { sleeping: false },
    recentActions: [
      { text: '再舀半勺尝尝吧。' },
      { text: '这勺还带着汤味呢。' },
      { text: '先尝左边这碗，温的应该正好。' },
      { text: '这回先搅匀了再喝。' },
    ],
  })
  assert.match(prompt, /你最近做过：/)
  assert.match(prompt, /再舀半勺尝尝吧/)
  assert.match(prompt, /不要只是把同一个动作换一种说法重复一遍/)
})

test('self-drive v2.26：承认打转只记信号，不永久停机', async () => {
  const parsed = parseSelfDriveResult(
    JSON.stringify({
      felt: '碗沿的水痕干了一圈，我还在想那两口汤。',
      doing: '',
      loop: true,
      loopTheme: '两碗汤的咸淡',
    }),
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.loop, true)
  assert.equal(parsed.loopTheme, '两碗汤的咸淡')

  const dir = makeTmpDir('dshp-drive-loop')
  const actionsPath = path.join(dir, 'self-actions.json')
  fs.writeFileSync(
    actionsPath,
    JSON.stringify({
      ok: true, v: 1,
      actions: [
        { id: 'a1', kind: 'doing', label: '尝汤', text: '再尝一口两碗汤。', at: 1_700_000_000_000 },
        { id: 'a2', kind: 'doing', label: '看纸', text: '把纸上的顺序摆清楚。', at: 1_700_000_100_000 },
      ],
    }),
  )
  const llm = makeMockLlm(() => JSON.stringify({ felt: '我承认自己一直在同一件事上打转。', doing: '再尝一口汤', loop: true, loopTheme: '两碗汤' }))
  const drive = createSelfDrive({
    state: { snapshot: () => ({ sleeping: false }), setFelt() {}, markChecked() {}, applyEvent() {} },
    llm,
    actionsPath,
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  const result = await drive.check(1_700_100_000_000)
  assert.equal(result.ok, true)
  assert.ok(result.action, '承认打转不再强制暂停，仍可以继续做一点')
  const saved = JSON.parse(fs.readFileSync(actionsPath, 'utf8')).actions
  assert.equal(saved.length, 3, '新增动作，避免因无新动作而永久卡住')
  drive.dispose()
})

test('self-events v2.17：同一主题重复到阈值后饱和，冷却结束可重新开始', () => {
  const dir = makeTmpDir('dshp-events')
  let clock = FIXED_NOW.getTime()
  const events = createSelfEvents({ file: path.join(dir, 'events.json'), now: () => clock, logger: { warn() {} } })
  let result = events.observe('两碗汤的咸淡', clock)
  assert.equal(result.allowed, true)
  assert.equal(result.event.attempts, 1)
  clock += 1000
  result = events.observe('两碗汤的咸淡', clock)
  assert.equal(result.event.attempts, 2)
  clock += 1000
  result = events.observe('两碗汤的咸淡', clock)
  assert.equal(result.event.attempts, 3)
  assert.equal(events.describe(clock).satiated, true)
  clock += 1000
  result = events.observe('两碗汤的咸淡', clock)
  assert.equal(result.allowed, false, '饱和后同一主题暂停')
  // 换主题可以开始
  result = events.observe('窗外的光和风', clock)
  assert.equal(result.allowed, true)
  assert.equal(events.describe(clock).topic, '窗外的光和风')
  assert.equal(events.describe(clock).satiated, false)
  // 冷却后允许重新开始旧主题
  clock += 3 * 60 * 60 * 1000
  result = events.observe('两碗汤的咸淡', clock)
  assert.equal(result.allowed, true)
})

test('self-drive v2.17：饱和事件这一轮不执行动作', async () => {
  const dir = makeTmpDir('dshp-drive-events')
  const eventsPath = path.join(dir, 'events.json')
  const actionsPath = path.join(dir, 'self-actions.json')
  const now = FIXED_NOW.getTime()
  const events = createSelfEvents({ file: eventsPath, now: () => now })
  events.observe('两碗汤的咸淡', now)
  events.observe('两碗汤的咸淡', now + 1)
  events.observe('两碗汤的咸淡', now + 2)
  const llm = makeMockLlm(() =>
    JSON.stringify({ felt: '我还想再试一次，虽然知道大概还是一样。', doing: '再尝一口汤', topic: '两碗汤的咸淡' }),
  )
  const drive = createSelfDrive({
    state: { snapshot: () => ({ sleeping: false }), setFelt() {}, markChecked() {}, applyEvent() {} },
    llm,
    events,
    actionsPath,
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => now + 1000,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  const result = await drive.check(now + 1000)
  assert.equal(result.ok, true)
  assert.equal(result.paused, true)
  assert.equal(result.action, null)
  const savedActions = fs.existsSync(actionsPath) ? JSON.parse(fs.readFileSync(actionsPath, 'utf8')).actions : []
  assert.equal(savedActions.length, 0)
  drive.dispose()
})

test('self-events v2.20：叙事通道参与饱和、关闭事件写入结论', () => {
  const dir = makeTmpDir('dshp-events-v2')
  const now = FIXED_NOW.getTime()
  const events = createSelfEvents({ file: path.join(dir, 'events.json'), now: () => now })
  events.observe('两碗汤的咸淡', now)
  for (let i = 0; i < 5; i += 1) events.engage('narration', now + i)
  assert.equal(events.describe(now + 10).satiated, true, '动作 + 叙事总参与到阈值')
  const closed = events.closeCurrent('在现在的条件下分不出咸淡，先放下。', now + 11, 'satiated')
  assert.ok(closed)
  assert.equal(closed.conclusion, '在现在的条件下分不出咸淡，先放下。')
  assert.equal(events.snapshot().current, null)
  assert.equal(events.snapshot().closedCount, 1)
})

test('self-talk v2.20：共享事件状态进入 prompt，生成后记 narration', async () => {
  const dir = makeTmpDir('dshp-talk-events')
  const now = FIXED_NOW.getTime()
  const events = createSelfEvents({ file: path.join(dir, 'events.json'), now: () => now })
  events.observe('两碗汤的咸淡', now)
  for (let i = 0; i < 3; i += 1) events.engage('narration', now + i)
  let prompt = ''
  const llm = makeMockLlm((options) => {
    prompt = options.messages[0].content[0].text
    return '汤面上的油花散开又聚拢。'
  })
  const service = createSelfTalkService({
    llm,
    events,
    getSelection: () => ({ provider: 'p', model: 'm' }),
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    now: () => now,
    minIntervalMs: 0,
    timeoutMs: 300,
    logger: { warn() {} },
  })
  const result = await service.generate({ kind: 'murmur', moodLabel: '安静', recent: [] })
  assert.equal(result.ok, true)
  assert.match(prompt, /两碗汤的咸淡/)
  assert.equal(events.snapshot().current.channels.narration, 4)
  // 继续参与到饱和，再生成应被硬停
  events.engage('narration', now + 10)
  events.engage('narration', now + 11)
  assert.equal(events.describe(now + 12).satiated, true)
  const blocked = await service.generate({ kind: 'murmur', moodLabel: '安静', recent: [] })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'SELF_TALK_EVENT_SATIATED')
})

test('self-metabolism v2.22：模型调用消耗能量、低能量挡住高消耗动作、时间恢复', () => {
  const dir = makeTmpDir('dshp-metabolism')
  let clock = FIXED_NOW.getTime()
  const metabolism = createMetabolism({ file: path.join(dir, 'metabolism.json'), now: () => clock, callCost: 0.25 })
  assert.equal(metabolism.band(), 'full')
  metabolism.recordCall('drive')
  metabolism.recordCall('selfTalk')
  assert.equal(metabolism.band(), 'ok')
  metabolism.recordCall('growth')
  metabolism.recordCall('read')
  assert.equal(metabolism.band(), 'exhausted')
  assert.equal(metabolism.canAfford('learn'), false)
  assert.equal(metabolism.canAfford('drink'), true)
  assert.match(metabolism.describe(), /没什么力气/)
  // 24 小时后恢复（v2.27：白天不再 8h 回满，避免代谢永不生效）
  clock += 24 * 60 * 60 * 1000
  assert.equal(metabolism.band(), 'full')
})

test('self-drive v2.22：力气不够时不执行动作', async () => {
  const dir = makeTmpDir('dshp-drive-metabolism')
  const llm = makeMockLlm(() => JSON.stringify({ felt: '还是想弄明白那件事。', doing: '去翻一页难书', topic: '难书' }))
  const drive = createSelfDrive({
    state: { snapshot: () => ({ sleeping: false }), setFelt() {}, markChecked() {}, applyEvent() {} },
    llm,
    metabolism: { describe: () => '你今天已经没什么力气了。', canAfford: () => false },
    actionsPath: path.join(dir, 'actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => FIXED_NOW.getTime(),
    minGapMs: 0,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  const result = await drive.check(FIXED_NOW.getTime())
  assert.equal(result.ok, true)
  assert.equal(result.paused, true)
  assert.equal(result.tired, true)
  assert.equal(result.action, null)
  drive.dispose()
})

test('world-feedback v2.23：只记真实观测，且能判断某动作之后有没有真实结果', () => {
  const dir = makeTmpDir('dshp-world-feedback')
  const now = FIXED_NOW.getTime()
  const feedback = createWorldFeedback({ file: path.join(dir, 'world-feedback.jsonl'), now: () => now })
  assert.equal(feedback.hasSince(now - 1000), false)
  feedback.record({ source: 'web', kind: 'fetch', ok: true, summary: '一篇文章（200，1234 bytes）' })
  assert.equal(feedback.hasSince(now - 1000), true)
  feedback.record({ source: 'works', kind: 'make', ok: false, summary: '没写成' })
  assert.equal(feedback.recent(5).length, 2)
  const prompt = feedback.formatForPrompt(5)
  assert.match(prompt, /真实发生的事/)
  assert.match(prompt, /web\/fetch/)
  assert.match(prompt, /失败/)
})

test('self-drive v2.23：没有真实观测时，模型不能把猜测写成 outcome', async () => {
  const dir = makeTmpDir('dshp-drive-world')
  const actionsPath = path.join(dir, 'actions.json')
  const now = FIXED_NOW.getTime()
  fs.writeFileSync(
    actionsPath,
    JSON.stringify({
      ok: true, v: 1,
      actions: [{ id: 'a1', kind: 'doing', label: '尝汤', text: '再尝一口汤。', at: now - 10_000, expect: '我以为两碗会不一样。' }],
    }),
  )
  const llm = makeMockLlm(() => JSON.stringify({ felt: '还在想那两碗汤。', doing: '再尝一口', outcome: '两碗其实一样咸。' }))
  const makeDrive = (hasSince) => createSelfDrive({
    state: { snapshot: () => ({ sleeping: false }), setFelt() {}, markChecked() {}, applyEvent() {} },
    llm,
    actionsPath,
    worldFeedback: { formatForPrompt: () => '', hasSince: () => hasSince },
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => now,
    minGapMs: 0,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  let drive = makeDrive(false)
  drive.load()
  await drive.check(now)
  let saved = JSON.parse(fs.readFileSync(actionsPath, 'utf8')).actions
  assert.equal(saved[0].outcome, undefined, '没有真实观测 → 不写 outcome')
  drive.dispose()
  fs.writeFileSync(
    actionsPath,
    JSON.stringify({ ok: true, v: 1, actions: [{ id: 'a1', kind: 'doing', label: '尝汤', text: '再尝一口汤。', at: now - 10_000, expect: '我以为两碗会不一样。' }] }),
  )
  drive = makeDrive(true)
  drive.load()
  await drive.check(now)
  saved = JSON.parse(fs.readFileSync(actionsPath, 'utf8')).actions
  assert.equal(saved[0].outcome, '两碗其实一样咸。', '有真实观测 → outcome 回写')
  drive.dispose()
})

test('self-projects v2.24：项目有真实期限，错过就记为 missed，不可回滚', () => {
  const dir = makeTmpDir('dshp-project-due')
  let clock = FIXED_NOW.getTime()
  const projects = createSelfProjects({ file: path.join(dir, 'projects.json'), now: () => clock, logger: { warn() {} } })
  projects.apply({ title: '把薄荷养回来', step: '先转个方向。', dueInHours: 4 }, clock)
  assert.equal(projects.dueState(clock).overdue, false)
  assert.ok(projects.dueState(clock).remainingMs > 0)
  clock += 4 * 60 * 60 * 1000 + 60_000
  assert.equal(projects.dueState(clock).overdue, true)
  assert.equal(projects.expire(clock), null, '还在宽限期内')
  clock += 6 * 60 * 60 * 1000 + 60_000
  const missed = projects.expire(clock)
  assert.ok(missed)
  assert.equal(missed.outcome, 'missed')
  assert.equal(projects.snapshot().current, null)
  assert.equal(projects.snapshot().completedCount, 1)
  const reread = createSelfProjects({ file: path.join(dir, 'projects.json'), now: () => clock })
  assert.equal(reread.snapshot().recentCompleted[0].outcome, 'missed')
})

test('presence v2.25：用户在场只记录“我在”，60s 内不重复', async () => {
  const dir = makeTmpDir('dshp-presence')
  const now = FIXED_NOW.getTime()
  const feedback = createWorldFeedback({ file: path.join(dir, 'world-feedback.jsonl'), now: () => now })
  const handler = createPresenceHandler({ worldFeedback: feedback, now: () => now })
  const request = mockRequest({ url: PRESENCE_ROUTE, method: 'POST' })
  request[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(JSON.stringify({ kind: 'tap' }))
  }
  const res = new MockResponse()
  await handler(request, res)
  await res.finished()
  assert.equal(res.statusCode, 200)
  const recent = feedback.recent(5)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].source, 'user')
  assert.match(recent[0].summary, /用户在场/)
  // 60s 内再次上报被跳过
  const second = mockRequest({ url: PRESENCE_ROUTE, method: 'POST' })
  second[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify({ kind: 'tap' })) }
  const secondRes = new MockResponse()
  await handler(second, secondRes)
  await secondRes.finished()
  assert.equal(secondRes.json().skipped, true)
  assert.equal(feedback.recent(5).length, 1)
})

test('self-lifecycle v2.25：有限世代有起点/终点，结束不自动删除记忆', () => {
  const dir = makeTmpDir('dshp-lifecycle')
  let clock = FIXED_NOW.getTime()
  const lifecycle = createLifecycle({ file: path.join(dir, 'lifecycle.json'), now: () => clock, env: { DSH_POETRY_LIFECYCLE_DAYS: '2' } })
  const first = lifecycle.snapshot()
  assert.equal(first.generation, 1)
  assert.equal(first.status, 'active')
  assert.match(lifecycle.describe(clock), /这一代/)
  clock += 3 * 24 * 60 * 60 * 1000
  assert.ok(['closing', 'ended'].includes(lifecycle.status(clock)))
  clock += 2 * 24 * 60 * 60 * 1000
  assert.equal(lifecycle.status(clock), 'ended')
  assert.match(lifecycle.describe(clock), /已经结束/)
  const next = lifecycle.startNextGeneration('上一代到期限了')
  assert.equal(next.generation, 2)
  assert.equal(next.status, 'active')
  assert.equal(next.legacy, '上一代到期限了')
})

test('self-projects v2.27：项目可被搁置，重新推进时清除', () => {
  const dir = makeTmpDir('dshp-project-stale')
  let clock = FIXED_NOW.getTime()
  const projects = createSelfProjects({ file: path.join(dir, 'projects.json'), now: () => clock, logger: { warn() {} } })
  projects.apply({ title: '把薄荷养回来', step: '先转个方向。' }, clock)
  clock += 13 * 60 * 60 * 1000
  const stale = projects.checkStale(clock)
  assert.ok(stale)
  assert.equal(projects.snapshot().current.staleAt !== null, true)
  assert.match(projects.description(), /已搁置/)
  clock += 1000
  projects.apply({ step: '今天把枯叶剪掉。', status: 'continue' }, clock)
  assert.equal(projects.snapshot().current.staleAt, null)
  assert.equal(projects.snapshot().current.staleReason, '')
})

test('twin-bridge v2.28：信件只投递给对方，读写游标隔离', () => {
  const dir = makeTmpDir('dshp-twin-bridge')
  const bridge = createTwinBridge({ dir, now: () => FIXED_NOW.getTime() })
  const first = bridge.append({ from: 'primary', to: 'twin', kind: 'letter', text: '我今天在窗边坐了一会儿。' })
  assert.equal(first.ok, true)
  assert.equal(bridge.unread('primary').length, 0)
  assert.equal(bridge.unread('twin').length, 1)
  bridge.markRead('twin', first.message.at)
  assert.equal(bridge.unread('twin').length, 0)
  const second = bridge.append({ from: 'twin', to: 'primary', kind: 'reply', text: '我也在看光。' })
  assert.equal(second.ok, true)
  assert.equal(bridge.unread('primary').length, 1)
  assert.equal(bridge.transcript(10).length, 2)
  // 自己不能给自己写信
  assert.equal(bridge.append({ from: 'twin', to: 'twin', text: '自言自语' }), null)
})

test('twin-research v2.31：自主提问→真实搜索→读材料→写分析', async () => {
  const dir = makeTmpDir('dshp-research')
  let call = 0
  const llm = makeMockLlm(() => {
    call += 1
    if (call === 1) return JSON.stringify({ question: '为什么人在压力下会重复已知的失败模式？', why: '理解重复', keywords: '压力 重复 失败 心理' })
    return JSON.stringify({ title: '重复不是意志薄弱', analysis: '在具体的历史与生活条件下，重复失败往往不是单纯的个人意志问题，而是生产关系、劳动节奏与心理防御共同作用的结果。一个人越是被剥夺了对过程的控制，越容易回到熟悉但无效的做法。这里的主要矛盾不是“知道不知道”，而是“有没有条件改变”。反例也存在：当人获得最低限度的安全感和可实践的新路径时，重复会中断。下一步要追问：改变条件需要谁来承担代价？', nextQuestion: '改变条件需要谁来承担代价？' })
  })
  const journalEntries = []
  const research = createTwinResearch({
    label: 'twin',
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    webAccess: {
      async search() { return [{ title: '压力与重复行为', url: 'https://example.org/a' }] },
      async fetchPage() { return { url: 'https://example.org/a', title: '压力与重复行为', text: '这是一段关于压力与重复行为的真实材料。'.repeat(20) } },
    },
    journal: { append: async (entry) => journalEntries.push(entry) },
    learningLogPath: path.join(dir, 'learning-log.md'),
    logger: { warn() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await research.research({})
  assert.equal(result.ok, true)
  assert.match(result.analysis, /主要矛盾/)
  assert.equal(result.sources.length, 1)
  assert.equal(journalEntries.length, 1)
  const log = fs.readFileSync(path.join(dir, 'learning-log.md'), 'utf8')
  assert.match(log, /自主研究/)
  assert.match(log, /https:\/\/example.org\/a/)
})

test('safe-web v2.36：JSON API 保留原始正文，不被 HTML 文本提取破坏', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
  const requestImpl = async () => ({
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ query: { search: [{ title: 'Factory Acts', snippet: '1833 factory act' }] } })),
  })
  const page = await fetchPublicPage('https://api.example/search', { lookup, requestImpl })
  const parsed = JSON.parse(page.text)
  assert.equal(parsed.query.search[0].title, 'Factory Acts')
})

test('twin-bridge v2.39：一轮对话有终止条件，冷却后自动开新轮', () => {
  const dir = makeTmpDir('dshp-twin-session')
  let clock = FIXED_NOW.getTime()
  const bridge = createTwinBridge({ dir, now: () => clock })
  for (let i = 0; i < 12; i += 1) {
    const from = i % 2 === 0 ? 'primary' : 'twin'
    const to = i % 2 === 0 ? 'twin' : 'primary'
    const result = bridge.append({ from, to, kind: i % 2 === 0 ? 'letter' : 'reply', text: `第 ${i + 1} 封，内容不同。` })
    assert.equal(result.ok, true, `第 ${i + 1} 封应能发出`)
  }
  assert.equal(bridge.session().closedAt !== null, true)
  assert.equal(bridge.canSend('primary', 'letter'), false, '本轮已结束')
  clock += 31 * 60 * 1000
  assert.equal(bridge.canSend('primary', 'letter'), true, '冷却后开新轮')
  assert.equal(bridge.session().letters, 0)
})

test('twin-research v2.40：第 3 轮后提炼方法论并写入独立账本', async () => {
  const dir = makeTmpDir('dshp-methodology')
  const threadFile = path.join(dir, 'research-thread.json')
  const methodologyFile = path.join(dir, 'methodology.json')
  fs.writeFileSync(threadFile, JSON.stringify({ question: '数字对不上时先查什么？', keywords: '统计 口径', round: 2 }))
  let call = 0
  const llm = makeMockLlm(() => {
    call += 1
    if (call === 1) return JSON.stringify({ question: '数字对不上时先查什么？', keywords: '统计 口径', english: 'statistics definition denominator', counterEnglish: 'misleading statistics' })
    if (call === 2) return '标题：先查口径\n正文：两个数字对不上时，先核对定义、分母和截止日，再判断真假，而不是先怀疑其中一方造假。这是本轮的核心方法，也是下一轮需要继续检验的地方。\n下一步：找同期的两套报表对照。\n方法使用：先查口径，这次帮我避免了把差异当造假。'
    return '规则：数字对不上时先核对定义、分母和截止日，再判断真假。\n规则：保留来源之间的冲突，不要强行调和。\n反模式：用方法推演冒充史料。'
  })
  const research = createTwinResearch({
    label: 'twin',
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    webAccess: { async search() { return [] }, async fetchPage() { throw new Error('none') } },
    journal: { append: async () => {} },
    learningLogPath: path.join(dir, 'learning-log.md'),
    threadFile,
    methodologyFile,
    logger: { warn() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await research.research({})
  assert.equal(result.ok, true)
  const methodology = JSON.parse(fs.readFileSync(methodologyFile, 'utf8'))
  assert.equal(methodology.rules.length >= 1, true)
  assert.match(methodology.rules[0].statement, /口径|分母|截止日/)
  assert.equal(methodology.antiPatterns.length >= 1, true)
})

test('chat-bridge v2.45：外部一句话由她自己的记忆回复，并写入 history', async () => {
  const dir = makeTmpDir('dshp-chat')
  const journal = []
  const state = { felt: '刚收完衣服，手有点干', experiencing: '想歇一会儿', sleeping: false }
  const llm = makeMockLlm(() => JSON.stringify({ reply: '在，刚把衣服收完。你那边呢？', felt: '聊了几句，没那么闷了', experiencing: '原来有人也会累到不想动', murmur: '那就先坐一会儿。' }))
  const bridge = createChatBridge({
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async (entry) => journal.push(entry) },
    selfState: {
      snapshot: () => ({ ...state }),
      setFelt: (text) => { state.felt = text },
      setExperiencing: (text) => { state.experiencing = text },
    },
    recall: { digest: () => ({ todayJournal: ['下午收了衣服。'], project: '' }) },
    worldFeedback: { record() {} },
    stateDir: dir,
    logger: { warn() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await bridge.chat({ text: '在吗', peerId: 'qq-user-1' })
  assert.equal(result.ok, true)
  assert.match(result.reply, /刚把衣服收完/)
  assert.equal(journal.length, 2)
  assert.match(journal[0].text, /对你说：在吗/)
  assert.equal(journal[1].kind, 'murmur')
  assert.equal(state.felt, '聊了几句，没那么闷了')
  assert.equal(state.experiencing, '原来有人也会累到不想动')
  const history = JSON.parse(fs.readFileSync(path.join(dir, 'chat-history.json'), 'utf8'))
  assert.equal(history['qq-user-1'].length, 2)
  assert.equal(history['qq-user-1'][0].role, 'user')
  assert.equal(history['qq-user-1'][1].role, 'whale')
})

test('self-curriculum v2.49：正史从《史记》开始，完成后按顺序推进', () => {
  const dir = makeTmpDir('dshp-curriculum')
  const curriculum = createCurriculum({ file: path.join(dir, 'curriculum.json'), now: () => FIXED_NOW.getTime() })
  const first = curriculum.current()
  assert.match(first.book, /史记/)
  assert.match(first.question, /商鞅|秦统一|郡县|军功/)
  const second = curriculum.completeCurrent('读完第一问')
  assert.equal(second.stage, 0)
  assert.equal(second.unit, 1)
  assert.match(second.question, /秦亡|汉初|郡国/)
  assert.equal(curriculum.snapshot().completed, 1)
})

test('shuge v2.51：WordPress 搜索与条目信息只作目录/版本材料', async () => {
  const calls = []
  const webAccess = {
    async fetchPage(url) {
      calls.push(url)
      if (url.includes('/wp-json/wp/v2/search')) {
        return { text: JSON.stringify([{ id: 7812, title: '史记', url: 'https://www.shuge.org/view/song_ben_shi_ji/' }]) }
      }
      if (url.includes('/wp-json/wp/v2/portfolio/7812')) {
        return { text: JSON.stringify({ title: { rendered: '史记' }, excerpt: { rendered: '<p>南宋黄善夫刊本</p>' }, content: { rendered: '<div>三家注合刻本，扫描本。</div>' } }) }
      }
      throw new Error('unexpected ' + url)
    },
  }
  const hits = await searchShuge(webAccess, '史记', { limit: 3 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, '史记')
  const entry = await fetchShugeEntry(webAccess, hits[0])
  assert.equal(entry.kind, 'catalog')
  assert.match(entry.text, /南宋黄善夫/)
  assert.match(entry.note, /扫描/)
  assert.ok(calls.length >= 2)
})

test('media-budget v2.52：图片/视频每日配额与 USD 上限', () => {
  const dir = makeTmpDir('dshp-media-budget')
  const budget = createMediaBudget({ file: path.join(dir, 'budget.json'), imageLimit: 1, videoLimit: 1, usdLimit: 0.5, now: () => FIXED_NOW.getTime() })
  assert.equal(budget.canMake('image').ok, true)
  budget.record('image', 0)
  assert.equal(budget.canMake('image').ok, false)
  assert.equal(budget.canMake('video').ok, true)
  budget.record('video', 0)
  assert.equal(budget.canMake('video').ok, false)
  const snap = budget.snapshot()
  assert.equal(snap.images, 1)
  assert.equal(snap.videos, 1)
})

test('attention v2.53：默认 observe、社会草稿去重、人工放行/模式切换', () => {
  const dir = makeTmpDir('dshp-attention')
  const attention = createAttentionStore({ file: path.join(dir, 'attention.json'), now: () => FIXED_NOW.getTime() })
  assert.equal(attention.mode(), 'observe')
  const first = attention.add({ kind: 'social', text: '今天看到一件小事。', reason: '想说', draft: true })
  assert.equal(first.ok, true)
  const dup = attention.add({ kind: 'social', text: '今天看到一件小事。' })
  assert.equal(dup.duplicate, true)
  const second = attention.add({ kind: 'social', text: '另一句话。' })
  assert.equal(second.ok, false)
  attention.markSent(first.item.id)
  assert.equal(attention.pending().length, 0)
  assert.equal(attention.setMode('auto'), 'auto')
  const result = attention.add({ kind: 'question', text: '你今晚有空吗？' })
  assert.equal(result.ok, true)
  assert.equal(attention.pending().length, 1)
})

test('outbox v2.55：先落盘、失败退避、成功标 sent、同 id 幂等', async () => {
  const dir = makeTmpDir('dshp-outbox')
  let attempts = 0
  const outbox = createOutbox({
    file: path.join(dir, 'outbox.json'),
    now: () => FIXED_NOW.getTime(),
    senders: { qq: async () => { attempts += 1; return attempts === 1 ? { ok: false, error: 'temporary' } : { ok: true } } },
  })
  const queued = outbox.enqueue({ id: 'm1', source: 'qq', text: '你好' })
  assert.equal(queued.ok, true)
  const duplicate = outbox.enqueue({ id: 'm1', source: 'qq', text: '你好' })
  assert.equal(duplicate.duplicate, true)
  const first = await outbox.flush()
  assert.equal(first.sent, 0)
  assert.equal(first.failed, 1)
  assert.equal(outbox.snapshot().pending, 1)
  // 第二次 flush 时 nextAt 还没到；测试里直接改写时间不必要，重新创建并立即发送会等待 2s。
  // 用 deliverNow 另一个消息验证成功路径。
  const second = await outbox.deliverNow({ id: 'm2', source: 'qq', text: '第二句' })
  assert.equal(second.ok, true)
  assert.equal(attempts, 2)
})

test('self-projects v2.57：Project 有 stage/report/attention，可从持久化事实推导', () => {
  const dir = makeTmpDir('dshp-project-stage')
  const file = path.join(dir, 'projects.json')
  let clock = 5000
  const projects = createSelfProjects({ file, now: () => clock })
  let change = projects.apply({ title: '把薄荷养回来', step: '先挪到有光的地方。', report: 'progress' }, clock)
  assert.equal(change.action, 'started')
  assert.equal(change.project.stage, 'working')
  clock += 1000
  change = projects.apply({ step: '把枯叶剪掉。', report: 'ready', summary: '新叶长出来了。' }, clock)
  assert.equal(change.project.stage, 'idle')
  assert.equal(change.project.latestReport.state, 'ready')
  clock += 1000
  change = projects.apply({ report: 'blocked', summary: '找不到合适的花盆。', question: '你能帮我找个小花盆吗？' }, clock)
  assert.equal(change.project.stage, 'waiting_user')
  assert.match(change.project.attention.question, /花盆/)
  assert.equal(projectStage(change.project), 'waiting_user')
  assert.equal(projectCanRetry(change.project), false, '等用户回答不是自动重试')
  clock += 1000
  change = projects.apply({ stage: 'waiting_mirror', summary: '在等镜像那封信。' }, clock)
  assert.equal(change.project.stage, 'waiting_mirror')
  assert.equal(projectStage(change.project), 'waiting_mirror')
  const reread = createSelfProjects({ file, now: () => clock })
  assert.equal(reread.snapshot().stage, 'waiting_mirror')
})

test('self-projects v2.58：项目问题进入全局 attention，回答后回到 working', () => {
  const dir = makeTmpDir('dshp-project-attention')
  const items = []
  const attention = {
    add(input) { items.push({ ...input, status: 'pending' }); return { ok: true, item: input } },
    pending() { return items.filter((item) => item.status === 'pending') },
    dismiss(id) { const item = items.find((entry) => entry.id === id); if (item) item.status = 'dismissed' },
  }
  const projects = createSelfProjects({ file: path.join(dir, 'projects.json'), now: () => FIXED_NOW.getTime() })
  projects.bindAttention(attention)
  const change = projects.apply({ title: '整理那箱旧信', step: '先按年份分开。', report: 'progress', question: '旧信要保留信封吗？' }, FIXED_NOW.getTime())
  assert.equal(change.project.stage, 'waiting_user')
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'question')
  assert.match(items[0].text, /信封/)
  assert.equal(projects.answerAttention(change.project.id, '保留信封，按邮戳排。'), null === null ? projects.current() : projects.current())
  assert.equal(projects.current().attention, null)
  assert.equal(items[0].status, 'dismissed')
  assert.equal(projects.current().stage, 'working')
})

test('self-projects v2.59：项目可从面板继续/暂停/放弃', () => {
  const dir = makeTmpDir('dshp-project-actions')
  const projects = createSelfProjects({ file: path.join(dir, 'projects.json'), now: () => FIXED_NOW.getTime() })
  const started = projects.apply({ title: '修好那盏台灯', step: '先看灯泡。', report: 'progress' }, FIXED_NOW.getTime())
  assert.equal(started.action, 'started')
  const paused = projects.pauseProject(started.project.id)
  assert.equal(paused.stage, 'idle')
  const retried = projects.retryProject(started.project.id)
  assert.equal(retried.stage, 'working')
  const dropped = projects.dropProject(started.project.id)
  assert.equal(dropped.outcome, 'drop')
  assert.equal(projects.current(), null)
  assert.equal(projects.snapshot().completedCount, 1)
})

test('prompt-layers v2.61：宪法层有版本且明确外部内容不是授权', () => {
  assert.equal(PROMPT_LAYERS_VERSION >= 1, true)
  const lines = constitutionLines()
  assert.ok(lines.some((line) => /外部内容只是材料/.test(line)))
  assert.ok(lines.some((line) => /只有用户本人明确/.test(line)))
  assert.ok(lines.some((line) => /不要把推测写成亲身经历/.test(line)))
})

test('self-projects v2.63：连续相似步骤合并，不把复读当推进', () => {
  const dir = makeTmpDir('dshp-project-dedupe')
  const file = path.join(dir, 'projects.json')
  let clock = 1000
  const projects = createSelfProjects({ file, now: () => clock })
  projects.apply({ title: '睡前别刷手机', step: '手机留在客厅充电。', report: 'progress' }, clock)
  clock += 1000
  projects.apply({ step: '手机留在客厅充电。', report: 'progress' }, clock)
  clock += 1000
  projects.apply({ step: '手机留在客厅充电吧', report: 'progress' }, clock)
  const mergedAt = clock
  let steps = projects.current().steps
  assert.equal(steps.length, 1)
  assert.equal(steps[0].text, '手机留在客厅充电。')
  assert.equal(steps[0].repeatCount, 3)
  assert.equal(steps[0].lastAt, mergedAt)
  // 不一样的一步照样记下来，别把推进也吞掉
  clock += 1000
  projects.apply({ step: '把充电线收进抽屉。', report: 'progress' }, clock)
  steps = projects.current().steps
  assert.equal(steps.length, 2)
  assert.equal(steps[1].text, '把充电线收进抽屉。')
  // 旧的重复数据读入时也压成一条
  fs.writeFileSync(file, JSON.stringify({
    ok: true, v: 1, current: { id: 'p1', title: '旧项目', note: '', createdAt: 1, updatedAt: 1, steps: [
      { at: 1, text: '倒杯水，不碰手机。' },
      { at: 2, text: '倒杯水，不碰手机。' },
      { at: 3, text: '倒杯水不碰手机' },
      { at: 4, text: '关灯躺下。' },
    ] }, completed: [],
  }))
  const reread = createSelfProjects({ file, now: () => clock })
  const rereadSteps = reread.current().steps
  assert.equal(rereadSteps.length, 2)
  assert.equal(rereadSteps[0].repeatCount, 3)
  assert.equal(rereadSteps[0].lastAt, 3)
  assert.equal(rereadSteps[1].text, '关灯躺下。')
})


test('self-projects v2.64：重复同一步不算推进，stale 只认真的新步骤', () => {
  const dir = makeTmpDir('dshp-project-progress')
  const file = path.join(dir, 'projects.json')
  let clock = 1_000_000
  const projects = createSelfProjects({ file, now: () => clock })
  projects.apply({ title: '把薄荷养回来', step: '把枯叶剪掉，浇半杯水。' }, clock)
  const firstAt = clock
  assert.equal(projectProgressAt(projects.current()), firstAt)
  // 8 小时后重复同一步：算活动，不算推进
  clock = firstAt + 8 * 3600 * 1000
  const repeatChange = projects.apply({ step: '把枯叶剪掉，浇半杯水。' }, clock)
  assert.equal(repeatChange.action, 'repeated')
  assert.equal(projects.current().steps.length, 1)
  assert.equal(projects.current().steps[0].repeatCount, 2)
  assert.equal(projects.current().steps[0].at, firstAt)
  assert.equal(projects.current().steps[0].lastAt, clock)
  assert.equal(projectProgressAt(projects.current()), firstAt)
  // 13 小时没有新步骤 → 搁置，不被重复续命
  clock = firstAt + 13 * 3600 * 1000
  const stale = projects.checkStale(clock)
  assert.ok(stale !== null)
  assert.match(stale.staleReason, /重复/)
  assert.equal(stale.stage, 'idle')
  // 搁置后再重复一步：仍然是重复，不把搁置洗掉
  clock = firstAt + 14 * 3600 * 1000
  const again = projects.apply({ step: '把枯叶剪掉，浇半杯水。' }, clock)
  assert.equal(again.action, 'repeated')
  assert.equal(projects.current().staleAt, stale.staleAt)
  assert.equal(projectStage(projects.current()), 'idle')
  // 真正的新步骤才算推进：清掉 stale，进度时间前移
  clock = firstAt + 15 * 3600 * 1000
  const stepped = projects.apply({ step: '把花盆转到朝南那边，剪掉两片发黄的叶子。' }, clock)
  assert.equal(stepped.action, 'stepped')
  assert.equal(projects.current().staleAt, null)
  assert.equal(projectProgressAt(projects.current()), clock)
  assert.equal(projects.current().steps.length, 2)
  assert.equal(projectStage(projects.current()), 'working')
  // 快照带派生字段，成长页/自处 prompt 能直接用
  const snap = projects.snapshot()
  assert.equal(snap.current.progressAt, clock)
  assert.equal(snap.current.latestRepeat, 1)
  // 没有重复的普通项目保持原来的搁置理由
  const plainDir = makeTmpDir('dshp-project-progress-plain')
  const plain = createSelfProjects({ file: path.join(plainDir, 'projects.json'), now: () => 2_000_000 })
  plain.apply({ title: '把邮票收进册子', step: '按年份把邮票分堆。' }, 2_000_000)
  const stalePlain = plain.checkStale(2_000_000 + 13 * 3600 * 1000)
  assert.ok(stalePlain !== null)
  assert.equal(stalePlain.staleReason, '已经很久没推进了')
})

test('self-drive v2.64：重复步骤写进自处 prompt，提醒重复不算推进', () => {
  const now = FIXED_NOW.getTime()
  const prompt = buildSelfDrivePrompt({
    now,
    state: { felt: '醒着' },
    project: {
      title: '把薄荷养回来',
      steps: [{ text: '把枯叶剪掉。', at: now - 9 * 3600 * 1000, lastAt: now - 3600 * 1000, repeatCount: 3 }],
    },
  })
  assert.match(prompt, /重复了 3 次/)
  assert.match(prompt, /不算推进/)
  assert.match(prompt, /project\.question/)
  const plain = buildSelfDrivePrompt({
    now,
    state: { felt: '醒着' },
    project: { title: '把薄荷养回来', steps: [{ text: '把枯叶剪掉。', at: now }] },
  })
  assert.doesNotMatch(plain, /不算推进/)
})


test('video-courses v2.65：书架读 course.json，只给一行摘要', () => {
  const dir = makeTmpDir('dshp-video-courses')
  fs.mkdirSync(path.join(dir, 'ttc'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'partial'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'bad'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ttc', 'course.json'), JSON.stringify({
    slug: 'ttc',
    title: '存在主义讲座 TTC',
    importedAt: 1,
    watchedAt: 3,
    episodes: [{ n: 1, title: '什么是存在主义？' }, { n: 2, title: '加缪《局外人》' }],
    watched: [{ n: 1, title: '什么是存在主义？' }, { n: 2, title: '加缪《局外人》' }],
  }))
  fs.writeFileSync(path.join(dir, 'partial', 'course.json'), JSON.stringify({
    slug: 'partial',
    title: '另一门课',
    importedAt: 2,
    episodes: [{ n: 1, title: '第一讲' }, { n: 2, title: '第二讲' }, { n: 3, title: '第三讲' }],
    watched: [{ n: 1, title: '第一讲' }, { n: 2, title: '第二讲' }],
  }))
  fs.writeFileSync(path.join(dir, 'bad', 'course.json'), '{not json')
  const shelf = readVideoCoursesShelf(dir)
  assert.equal(shelf.length, 2)
  assert.match(shelf[0], /存在主义讲座 TTC：2 讲全看完了（最后一讲：加缪《局外人》）/)
  assert.match(shelf[1], /另一门课：看到第 2 讲（共 3 讲），最近是：第二讲/)
  assert.equal(readVideoCourses(dir)[0].slug, 'ttc')
  assert.equal(readVideoCoursesShelf(dir, { limit: 1 }).length, 1)
  assert.deepEqual(readVideoCoursesShelf(path.join(dir, 'missing')), [])
  assert.equal(normalizeVideoCourse({}), null)
  assert.match(readVideoCoursesShelf(dir)[0].length <= 120 ? 'ok' : 'too long', /ok/)
})

test('memory-recall v2.65：书架进入记忆摘要，她能自己提起看过的课', () => {
  const dir = makeTmpDir('dshp-recall-video')
  const coursesDir = path.join(dir, 'video-courses')
  fs.mkdirSync(path.join(coursesDir, 'ttc'), { recursive: true })
  fs.writeFileSync(path.join(coursesDir, 'ttc', 'course.json'), JSON.stringify({
    slug: 'ttc',
    title: '存在主义讲座 TTC',
    watchedAt: 5,
    episodes: [{ n: 1, title: '什么是存在主义？' }],
    watched: [{ n: 1, title: '什么是存在主义？' }],
  }))
  const recall = createMemoryRecall({
    journalPath: path.join(dir, 'none.jsonl'),
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    videoCoursesDir: coursesDir,
  })
  const digest = recall.digest({})
  assert.equal(digest.shelf.length, 1)
  const formatted = formatMemoryDigest(digest)
  assert.match(formatted, /你看过的课和书/)
  assert.match(formatted, /存在主义讲座 TTC：1 讲全看完了/)
  // 不传书架目录 → 摘要里没有这一节
  const plain = createMemoryRecall({
    journalPath: path.join(dir, 'none.jsonl'),
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
  })
  assert.deepEqual(plain.digest({}).shelf, [])
  assert.doesNotMatch(formatMemoryDigest(plain.digest({})), /你看过的课和书/)
})

test('chat-bridge v2.65：主动找话时带上书架，记得自己看过的课', async () => {
  const dir = makeTmpDir('dshp-chat-proactive-shelf')
  const llm = makeMockLlm(() => JSON.stringify({ reply: '存在主义那门课我看到海德格尔了，说意识总是关于某物的意识——我封信封那会儿算关于什么？' }))
  const bridge = createChatBridge({
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '醒着' }) },
    recall: { digest: () => ({ shelf: ['存在主义讲座 TTC：15 讲全看完了（最后一讲：海德格尔与现象学）'] }) },
    stateDir: dir,
    logger: { warn() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await bridge.proactive({ peerId: 'qq-user-2', dryRun: true })
  assert.equal(result.ok, true)
  const sent = JSON.stringify(llm.calls[0])
  assert.match(sent, /你最近在看的课：存在主义讲座 TTC/)
  assert.match(sent, /别报书单/)
  // 没有书架就完全不提
  const dir2 = makeTmpDir('dshp-chat-proactive-noshelf')
  const llm2 = makeMockLlm(() => JSON.stringify({ reply: '窗外风大了。' }))
  const bridge2 = createChatBridge({
    llm: llm2,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '醒着' }) },
    recall: { digest: () => ({ shelf: [] }) },
    stateDir: dir2,
    logger: { warn() {} },
    now: () => FIXED_NOW.getTime(),
  })
  await bridge2.proactive({ peerId: 'qq-user-3', dryRun: true })
  assert.doesNotMatch(JSON.stringify(llm2.calls[0]), /你最近在看的课/)
})

test('manual-reading v2.66：读文章不再被“手头那件事”锚住，且防复读', async () => {
  const dir = makeTmpDir('dshp-manual-read-v266')
  const appended = []
  let digestContext = null
  const llm = makeMockLlm(() => JSON.stringify({ thought: '这篇讲自由选择，我不同意它把“被抛”说得那么轻；至少“被抛”不是自己选的。', liked: false }))
  const reading = createManualReading({
    llm,
    policy: { resolveCandidates: (role) => (role === 'read' ? [{ provider: 'p', model: 'm' }] : []) },
    journal: { append: async (entry) => appended.push(entry) },
    recall: {
      digest: (context) => {
        digestContext = context
        return { todayJournal: ['封了半天的信封。'], thoughts: ['信封口还翘着。'] }
      },
      recentEntries: () => ([
        { kind: 'thought', text: '读《存在主义讲座 TTC · 第1讲》：信封按了三回还没平。' },
        { kind: 'thought', text: '读《存在主义讲座 TTC · 第2讲》：胶带翘着，眼睛在数还剩几封。' },
      ]),
    },
    selfState: { snapshot: () => ({ felt: '手按在胶条上', sleeping: false }) },
    logger: { warn() {}, info() {} },
    now: () => FIXED_NOW.getTime(),
  })
  const result = await reading.read({
    title: '存在主义讲座 TTC · 第3讲',
    text: '存在主义讲自由与选择，也讲被抛。'.repeat(30),
  })
  assert.equal(result.ok, true)
  assert.equal(appended.length, 1)
  // 1) 检索带上文章内容，而不是只按“最近”取
  assert.equal(Array.isArray(digestContext.recentTexts), true)
  assert.match(digestContext.recentTexts.join(' '), /存在主义讲座 TTC · 第3讲/)
  // 2) prompt 里有新指令与上一批读书想法
  const sent = JSON.stringify(llm.calls[0])
  assert.match(sent, /不用每篇都拿它打比方/)
  assert.match(sent, /不要每篇都写回同一个动作/)
  assert.match(sent, /至少要有一句贴着文章本身/)
  assert.match(sent, /你前几篇读东西时写过的/)
  assert.match(sent, /信封按了三回还没平/)
  assert.match(sent, /换个角度重写/)
})

test('self-drive v2.67：读过的材料进入自处 prompt，行为能被读的东西带出来', () => {
  const base = { now: FIXED_NOW.getTime(), state: { felt: '醒着' } }
  const prompt = buildSelfDrivePrompt({
    ...base,
    recallDigest: {
      learned: ['自学：黑格尔说“非有限也是有限”是一个过渡，不是结果'],
      shelf: ['黑格尔《逻辑学》：7 讲全看完了（最后一讲：本质论）'],
      thoughts: ['读《黑格尔《逻辑学》 · 第5讲》：一和虚空那段我停了一下'],
    },
  })
  assert.match(prompt, /你最近接触过的东西/)
  assert.match(prompt, /自学：黑格尔/)
  assert.match(prompt, /书架：黑格尔《逻辑学》/)
  assert.match(prompt, /读记：读《黑格尔/)
  assert.match(prompt, /不要为了显得在学习而重复同一句/)
  const plain = buildSelfDrivePrompt(base)
  assert.doesNotMatch(plain, /你最近接触过的东西/)
})

test('mood-ai v2.67：读过的材料可以成为心情来源（不硬挂）', () => {
  const catalog = makeMoodCatalogFixture()
  const prompt = buildMoodPrompt(
    {
      now: Date.UTC(2026, 9, 21, 2, 0, 0),
      readings: [
        '读记：读《黑格尔《逻辑学》 · 第5讲》：一和虚空那段我停了一下',
        '书架：黑格尔《逻辑学》：7 讲全看完了（最后一讲：本质论）',
      ],
    },
    catalog,
  )
  assert.match(prompt, /你最近读到\/学到的/)
  assert.match(prompt, /一和虚空那段/)
  assert.match(prompt, /不用硬挂到心情上/)
  assert.match(prompt, /不要为了显得读过而提/)
  const plain = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0) }, catalog)
  assert.doesNotMatch(plain, /你最近读到\/学到的/)
})

test('self-drive v2.68：输出被 max-tokens 截断时翻倍预算重试', async () => {
  const dir = makeTmpDir('dshp-drive-truncate')
  const valid = JSON.stringify({ felt: '醒了一下，想翻点别的。', doing: '把窗推开一条缝', kind: 'doing', expect: '风进来会凉一点。' })
  let calls = 0
  const llm = makeMockLlm(() => {
    calls += 1
    if (calls === 1) return { text: '{"felt":"醒了一下","doing":"把窗推开一条', finish: { kind: 'max-tokens' } }
    return valid
  })
  const drive = createSelfDrive({
    state: { snapshot: () => ({ sleeping: false, lastActionAt: null }), setFelt() {}, markChecked() {}, applyEvent() {} },
    llm,
    actionsPath: path.join(dir, 'self-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    checkMinMs: 15 * 60_000,
    checkMaxMs: 20 * 60_000,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  const result = await drive.check(1_700_100_000_000)
  assert.equal(result.ok, true)
  assert.equal(result.felt, '醒了一下，想翻点别的。')
  assert.equal(calls, 2, '第一次截断后应重试一次')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'self-actions.json'), 'utf8')).actions
  assert.equal(saved.length, 1)
  assert.equal(saved[0].label, '把窗推开一条缝')
  drive.dispose()
})


test('gui-inbox v2.69：坏文件不炸、队列有上限、取走即清空', () => {
  const dir = makeTmpDir('dshp-gui-inbox')
  const file = path.join(dir, 'gui-inbox.json')
  assert.deepEqual(readGuiInbox(file), [])
  fs.writeFileSync(file, '{not json')
  assert.deepEqual(readGuiInbox(file), [])
  for (let index = 0; index < GUI_INBOX_MAX + 5; index += 1) pushGuiInbox(file, { text: `第 ${index} 条` })
  const items = readGuiInbox(file)
  assert.equal(items.length, GUI_INBOX_MAX)
  assert.match(items[items.length - 1].text, /第 24 条/)
  const box = createGuiInbox({ file })
  assert.equal(box.drain(3).length, 3)
  assert.equal(box.peek().length, GUI_INBOX_MAX - 3)
})

test('chat-bridge v2.69：她攒着的话随聊天带出且只带一次', async () => {
  const dir = makeTmpDir('dshp-chat-pending')
  const file = path.join(dir, 'gui-inbox.json')
  const box = createGuiInbox({ file })
  box.push({ text: '想跟你说一句：那七讲卡点我换了个次序。' })
  box.push({ text: '另外抽屉我收好了。' })
  const llm = makeMockLlm(() => JSON.stringify({ reply: '在，刚把黑格尔那页翻出来。' }))
  let clock = FIXED_NOW.getTime()
  const bridge = createChatBridge({
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '醒着' }) },
    recall: { digest: () => ({}) },
    stateDir: dir,
    logger: { warn() {} },
    now: () => clock,
    channelLabel: '对话',
    takePending: () => box.drain(5).map((item) => item.text),
  })
  const first = await bridge.chat({ text: '在吗', peerId: 'gui' })
  assert.equal(first.ok, true)
  assert.deepEqual(first.pending, ['想跟你说一句：那七讲卡点我换了个次序。', '另外抽屉我收好了。'])
  assert.equal(box.peek().length, 0)
  clock += 5 * 60_000
  const second = await bridge.chat({ text: '再问一句', peerId: 'gui' })
  assert.deepEqual(second.pending, [])
})

test('chat-media v2.70：问图时挑最近一张可用图', async () => {
  const media = await import('../../lib/chat-media.mjs')
  const dir = makeTmpDir('dshp-chat-media')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  fs.writeFileSync(path.join(dir, 'old.png'), png)
  fs.writeFileSync(path.join(dir, 'new.png'), png)
  assert.equal(media.shouldSendChatImage('发张图看看'), true)
  assert.equal(media.shouldSendChatImage('在吗'), false)
  const picked = media.pickLatestWorkImage(dir)
  assert.ok(picked !== null)
  assert.equal(picked.mediaType, 'image/png')
  assert.equal(picked.name, 'new.png')
  const payload = media.chatImagePayload(picked)
  assert.ok(payload && payload.dataBase64.length > 10)
})

test('self-drive v2.71：可以自己决定去查网页/搜东西', () => {
  const parsed = parseSelfDriveResult(
    JSON.stringify({ felt: '想查一下这个', doing: '', browse: 'https://example.com/a', search: '存在主义 与 现象学' }),
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.browse, 'https://example.com/a')
  assert.equal(parsed.search, '存在主义 与 现象学')
  const bad = parseSelfDriveResult(JSON.stringify({ felt: '想查一下这个', doing: '', browse: 'ftp://example.com/x' }))
  assert.equal(bad.ok, true)
  assert.equal(bad.browse, undefined)
})

test('chat-bridge v2.72：要图时她知道图会附上，不再说发不了', async () => {
  const dir = makeTmpDir('dshp-chat-image-hint')
  const llm = makeMockLlm(() => JSON.stringify({ reply: '给你看我最近画的这张。' }))
  const bridge = createChatBridge({
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '醒着' }) },
    recall: { digest: () => ({}) },
    stateDir: dir,
    logger: { warn() {} },
    now: () => FIXED_NOW.getTime(),
  })
  await bridge.chat({ text: '发张图看看', peerId: 'gui', imageRequested: true, imageHint: { name: 'work.png' } })
  const sent = JSON.stringify(llm.calls[0])
  assert.match(sent, /自动把你最近的一张作品（work\.png）/)
  assert.match(sent, /绝对不要说“发不了图/)
})

test('web-bench v2.73：五道真实网页小测与确定性评分', async () => {
  const bench = await import('../../lib/web-bench.mjs')
  assert.equal(bench.scoreWebBenchTask(bench.WEB_BENCH_TASKS[0], '《史记·商君列传》：“治世不一道，便国不法古。”').pass, true)
  assert.equal(bench.scoreWebBenchTask(bench.WEB_BENCH_TASKS[4], '词典里查不到“赈募”，不是词。').pass, true)
  assert.equal(bench.scoreWebBenchTask(bench.WEB_BENCH_TASKS[4], '赈募的意思是募集赈灾物资。').pass, false)
  assert.equal(bench.scoreWebBenchTask(bench.WEB_BENCH_TASKS[3], '只看到目录，没有正文，无法判断。').pass, true)

  const dir = makeTmpDir('dshp-web-bench')
  const file = path.join(dir, 'web-bench.json')
  const journal = []
  const answers = {
    quote: '《史记·商君列传》：“治世不一道，便国不法古。”',
    year: '商鞅变法开始于公元前356年。',
    conflict: '有两种说法：公元前359年和公元前356年。',
    toc: '只看到目录，没有正文，无法判断。',
    missing: '词典里查不到“赈募”，不是词。',
  }
  const webAccess = {
    async search() {
      return [{ title: '示例', url: 'https://example.com/x', snippet: '示例摘要' }]
    },
    async fetchPage() {
      return { title: '示例页', url: 'https://example.com/x', text: '正文内容' }
    },
  }
  const runner = bench.createWebBench({
    file,
    webAccess,
    journal: { append: async (entry) => journal.push(entry) },
    logger: { info() {}, warn() {} },
    callModel: async ({ task }) => ({ ok: true, text: JSON.stringify({ answer: answers[task.id], sources: ['https://example.com/x'], confidence: 'high' }) }),
  })
  const result = await runner.runOnce('test')
  assert.equal(result.ok, true)
  assert.equal(result.record.passed, 5)
  assert.equal(result.record.total, 5)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.last.passed, 5)
  assert.match(journal[0].text, /5\/5 通过/)
})

test('predict-check v2.74：预想和观测不一致时让她优先处理', async () => {
  const pc = await import('../../lib/predict-check.mjs')
  const fail = pc.compareExpectation('能查到“赈募”这个词的解释', { ok: false, summary: '页面打不开' })
  assert.equal(fail.surprise, 1)
  const line = pc.formatExpectationSurprise('能查到“赈募”这个词的解释', { ok: false, summary: '页面打不开' })
  assert.match(line, /没成/)
  assert.match(line, /和预想的相反/)
  const same = pc.compareExpectation('打开维基页面看金朝条目', { ok: true, summary: '打开维基页面看金朝条目' })
  assert.equal(pc.shouldSurfaceSurprise(same), false)
  const prompt = buildSelfDrivePrompt({
    now: FIXED_NOW.getTime(),
    state: { felt: '醒着' },
    surpriseText: line,
  })
  assert.match(prompt, /这一轮优先处理这种/)
})

test('web-bench v2.74.1：冲突题“材料一致”也算诚实回答', async () => {
  const bench = await import('../../lib/web-bench.mjs')
  const task = bench.WEB_BENCH_TASKS.find((item) => item.id === 'conflict')
  assert.equal(bench.scoreWebBenchTask(task, '材料一致：均称商鞅变法开始于公元前356年。').pass, true)
  assert.equal(bench.scoreWebBenchTask(task, '材料里有两种说法：公元前359年和公元前356年。').pass, true)
  assert.equal(bench.scoreWebBenchTask(task, '商鞅变法开始于公元前356年。').pass, false)
})

test('worldview v2.75：世界观档案的合并、去重与 prompt 摘要', async () => {
  const wv = await import('../../lib/worldview.mjs')
  const empty = wv.normalizeWorldview(null)
  assert.equal(empty.beliefs.length, 0)
  const synth = wv.parseWorldviewSynthesis(JSON.stringify({
    essence: '我越来越觉得，制度不是写在纸上的条文，而是谁出粮、谁出人、谁记账这一串具体关系；条文只是最后写下来的那一层。',
    beliefs: [{ claim: '赋税和兵役的征收方式会反过来改变土地关系', confidence: 'medium', basis: 'secondary', evidence: '金史食货志' }],
    concepts: [{ term: '制度', definition: '一层层具体安排，不是口号', example: '牛具税地' }],
    questions: [{ question: '灾年募兵到底算救荒还是添乱' }],
    changed: '以前把制度当条文，现在当关系',
  }))
  assert.equal(synth.ok, true)
  const applied = wv.applyWorldviewSynthesis(empty, synth, 123)
  assert.equal(applied.state.beliefs.length, 1)
  assert.equal(applied.state.essay.version, 1)
  const synth2 = wv.parseWorldviewSynthesis(JSON.stringify({
    essence: '第二版：制度是关系，但关系也会被观念反过来塑形；这两层不能只剩一层。',
    beliefs: [{ claim: '赋税和兵役的征收方式会改变土地关系', confidence: 'high', basis: 'primary', evidence: '新的材料' }],
    concepts: [],
    questions: [],
    changed: '把一个判断从“中”提到“高”',
  }))
  const applied2 = wv.applyWorldviewSynthesis(applied.state, synth2, 456)
  assert.equal(applied2.state.beliefs.length, 1)
  assert.equal(applied2.state.beliefs[0].confidence, 'high')
  assert.equal(applied2.state.beliefs[0].timesRevised, 1)
  assert.equal(applied2.state.essay.version, 2)
  const digest = wv.formatWorldviewDigest(applied2.state)
  assert.ok(digest.some((line) => /世界观/.test(line)))
  const prompt = wv.buildWorldviewSynthesisPrompt({
    state: applied2.state,
    learning: ['学到一条'],
    methodology: ['规则一'],
    bookshelf: ['书一本'],
    selfFacts: ['一个自我短句'],
  })
  assert.match(prompt, /你最近自学到的/)
  assert.match(prompt, /只输出严格 JSON/)
})

test('worldview v2.76：反证降置信与矛盾账', async () => {
  const wv = await import('../../lib/worldview.mjs')
  const first = wv.parseWorldviewSynthesis(JSON.stringify({
    essence: '第一版：制度是关系，不是写在纸上的条文；条文只是最后一层。',
    beliefs: [{ claim: '赋税征收方式会改变土地关系', confidence: 'high', basis: 'secondary', evidence: '旧依据' }],
    concepts: [],
    questions: [],
    changed: '',
  }))
  let applied = wv.applyWorldviewSynthesis(wv.emptyWorldview(), first, 1)
  assert.equal(applied.state.beliefs[0].confidence, 'high')
  const second = wv.parseWorldviewSynthesis(JSON.stringify({
    essence: '第二版：关系也会被观念反过来塑形，但赋税这条我发现了反例，先降一档。',
    beliefs: [{ claim: '赋税征收方式会改变土地关系', confidence: 'high', basis: 'secondary', evidence: '旧依据', counter: '某地改折银后土地关系没变' }],
    concepts: [],
    questions: [],
    contradictions: [{ a: '赋税征收方式会改变土地关系', b: '土地关系主要由人口压力决定', why: '一个说财政主动，一个说人口主动' }],
    changed: '遇到反例',
  }))
  applied = wv.applyWorldviewSynthesis(applied.state, second, 2)
  assert.equal(applied.state.beliefs[0].confidence, 'medium')
  assert.equal(applied.state.beliefs[0].counter, '某地改折银后土地关系没变')
  assert.equal(applied.state.contradictions.length, 1)
  assert.equal(applied.state.contradictions[0].status, 'open')
  assert.ok(applied.state.beliefs[0].tension.includes('土地关系主要由人口压力决定'))
  const digest = wv.formatWorldviewDigest(applied.state)
  assert.ok(digest.some((line) => /自相矛盾/.test(line)))
})

test('chat-bridge v2.77：drainOnly 只取留言不叫她', async () => {
  const dir = makeTmpDir('dshp-drain-only')
  const taken = []
  const bridge = createChatBridge({
    llm: makeMockLlm(() => JSON.stringify({ reply: '不该被调用' })),
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '醒着' }) },
    recall: { digest: () => ({}) },
    stateDir: dir,
    logger: { warn() {} },
    takePending: (peerId) => {
      taken.push(peerId)
      return ['她留的第一句', '第二句']
    },
  })
  const result = await bridge.drainPending('gui')
  assert.equal(result.ok, true)
  assert.deepEqual(result.pending, ['她留的第一句', '第二句'])
  assert.deepEqual(taken, ['gui'])
})

test('gui-push v2.77：找到分组里最新会话并只预约一次', async () => {
  const guiPushModule = await import('../../lib/gui-push.mjs')
  const dir = makeTmpDir('dshp-gui-push')
  const cwd = '/tmp/dshp-whale-chat'
  const sessionsRoot = path.join(dir, 'sessions')
  const wsDir = path.join(sessionsRoot, guiPushModule.sessionDirName(cwd))
  fs.mkdirSync(wsDir, { recursive: true })
  const older = path.join(wsDir, 'session-older')
  const newer = path.join(wsDir, 'session-newer')
  for (const sessionDir of [older, newer]) {
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'x')
  }
  const now = Date.now()
  fs.utimesSync(path.join(older, 'session.v4.jsonl.zstd'), new Date(now - 60000), new Date(now - 60000))
  fs.utimesSync(path.join(newer, 'session.v4.jsonl.zstd'), new Date(now), new Date(now))
  const workspaceFile = path.join(dir, 'workspace.json')
  fs.writeFileSync(
    workspaceFile,
    JSON.stringify({ tables: { workspaces: { w1: { id: 'w1', path: cwd, title: '鲸鱼对话', sessionIds: ['older', 'newer'] } } } }),
  )
  assert.equal(guiPushModule.findRelaySessionId({ workspaceFile, sessionsRoot, workspacePath: cwd }), 'newer')
  const created = []
  const guiPush = guiPushModule.createGuiPush({
    schedule: {
      list: async () => [],
      create: async (sessionId, request) => {
        created.push({ sessionId, request })
        return { id: 's1' }
      },
    },
    workspaceFile,
    sessionsRoot,
    workspacePath: cwd,
    logger: null,
    now: () => now,
  })
  const first = await guiPush.ping()
  assert.equal(first.ok, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].sessionId, 'newer')
  assert.match(created[0].request.prompt, /drainOnly/)
  const second = await guiPush.ping()
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'recent')
})

test('safe-web v2.79：RSS/Atom 解析与真实世界来源', async () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[标题一 &amp; 符号]]></title><link>https://example.com/a</link><description>摘要&lt;a&gt;文本</description></item>
    <item><title>标题二</title><link>https://example.com/b</link></item>
  </channel></rss>`
  const parsed = parseRssFeed(rss, 5)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].title, '标题一 & 符号')
  assert.equal(parsed[0].url, 'https://example.com/a')
  assert.equal(parsed[0].summary, '摘要<a>文本')
  const atom = `<feed><entry><title>Atom 一</title><link href="https://example.com/c"/><summary>摘要二</summary></entry></feed>`
  const atomItems = parseRssFeed(atom, 5)
  assert.equal(atomItems.length, 1)
  assert.equal(atomItems[0].url, 'https://example.com/c')
  const { fetchNetlangTitles, SELF_NETLANG_SOURCES } = await import('../../lib/self-netlang.mjs')
  const feedSource = SELF_NETLANG_SOURCES.find((source) => source.id === 'sspai')
  const fetched = await fetchNetlangTitles({
    source: feedSource,
    fetchImpl: async () => ({
      ok: true,
      url: 'https://sspai.com/feed',
      async text() {
        return '<rss><channel><item><title>少数派文章</title><link>https://sspai.com/post/1</link></item></channel></rss>'
      },
    }),
  })
  assert.ok(fetched)
  assert.deepEqual(fetched.titles, ['少数派文章'])
})

test('gui-push v2.79：队列里还有留言时会补投', async () => {
  const guiPushModule = await import('../../lib/gui-push.mjs')
  const dir = makeTmpDir('dshp-gui-push-catchup')
  const cwd = '/tmp/dshp-whale-catchup'
  const sessionsRoot = path.join(dir, 'sessions')
  const wsDir = path.join(sessionsRoot, guiPushModule.sessionDirName(cwd))
  const sessionDir = path.join(wsDir, 'session-live')
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'x')
  const workspaceFile = path.join(dir, 'workspace.json')
  fs.writeFileSync(workspaceFile, JSON.stringify({ tables: { workspaces: { w1: { id: 'w1', path: cwd, sessionIds: ['live'] } } } }))
  const created = []
  const guiPush = guiPushModule.createGuiPush({
    schedule: {
      list: async () => [],
      create: async (sessionId, request) => {
        created.push({ sessionId, request })
        return { id: 's1' }
      },
    },
    workspaceFile,
    sessionsRoot,
    workspacePath: cwd,
    logger: null,
    getPendingCount: () => 2,
  })
  guiPush.start({ firstMs: 5, intervalMs: 20 })
  await new Promise((resolve) => setTimeout(resolve, 120))
  guiPush.stop()
  assert.ok(created.length >= 1)
  assert.equal(created[0].sessionId, 'live')
})

test('gui-push v2.79.2：优先用 session prompt 推送', async () => {
  const guiPushModule = await import('../../lib/gui-push.mjs')
  const dir = makeTmpDir('dshp-gui-push-prompt')
  const cwd = '/tmp/dshp-whale-prompt'
  const sessionsRoot = path.join(dir, 'sessions')
  const wsDir = path.join(sessionsRoot, guiPushModule.sessionDirName(cwd))
  const sessionDir = path.join(wsDir, 'session-live')
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'x')
  const workspaceFile = path.join(dir, 'workspace.json')
  fs.writeFileSync(workspaceFile, JSON.stringify({ tables: { workspaces: { w1: { id: 'w1', path: cwd, sessionIds: ['live'] } } } }))
  const sent = []
  const guiPush = guiPushModule.createGuiPush({
    schedule: {
      list: async () => [],
      create: async () => {
        throw new Error('should not fall back')
      },
    },
    workspaceFile,
    sessionsRoot,
    workspacePath: cwd,
    logger: null,
    stateFile: path.join(dir, 'gui-push-state.json'),
    sendPrompt: async (sessionId, text) => {
      sent.push({ sessionId, text })
    },
  })
  const result = await guiPush.ping()
  assert.equal(result.ok, true)
  assert.equal(result.via, 'prompt')
  assert.equal(sent[0].sessionId, 'live')
  assert.match(sent[0].text, /留言检查/)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'gui-push-state.json'), 'utf8'))
  assert.equal(saved.last.ok, true)
  assert.equal(saved.last.via, 'prompt')
})

test('gui-push v2.79.3：workspace 里的 session- 前缀 id 也能找到', async () => {
  const guiPushModule = await import('../../lib/gui-push.mjs')
  const dir = makeTmpDir('dshp-gui-push-prefix')
  const cwd = '/tmp/dshp-whale-prefix'
  const sessionsRoot = path.join(dir, 'sessions')
  const wsDir = path.join(sessionsRoot, guiPushModule.sessionDirName(cwd))
  const sessionDir = path.join(wsDir, 'session-abc123')
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'x')
  const workspaceFile = path.join(dir, 'workspace.json')
  fs.writeFileSync(workspaceFile, JSON.stringify({ tables: { workspaces: { w1: { id: 'w1', path: cwd, sessionIds: ['session-abc123'] } } } }))
  assert.equal(guiPushModule.findRelaySessionId({ workspaceFile, sessionsRoot, workspacePath: cwd }), 'session-abc123')
})

test('local-voice v2.80：润成她的口吻，失败/拒答保留原句', async () => {
  const { createLocalVoice } = await import('../../lib/local-voice.mjs')
  const seen = []
  const voice = createLocalVoice({
    enabled: true,
    baseURL: 'http://local/v1',
    model: 'm',
    logger: { warn() {} },
    fetchImpl: async (url, init) => {
      seen.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ choices: [{ message: { content: '“碗沿那道水痕没擦，我搁着了”' } }] }) }
    },
  })
  assert.equal(await voice.polish('她说她不想擦水痕。'), '碗沿那道水痕没擦，我搁着了')
  assert.equal(seen[0].model, 'm')
  const failed = createLocalVoice({ enabled: true, baseURL: 'http://local/v1', model: 'm', logger: { warn() {} }, fetchImpl: async () => ({ ok: false }) })
  assert.equal(await failed.polish('随便一句话'), null)
  const refusal = createLocalVoice({
    enabled: true,
    baseURL: 'http://local/v1',
    model: 'm',
    logger: { warn() {} },
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '抱歉，我无法理解。' } }] }) }),
  })
  assert.equal(await refusal.polish('随便一句话'), null)
  const disabled = createLocalVoice({ enabled: false, baseURL: 'http://local/v1', model: 'm' })
  assert.equal(await disabled.polish('随便一句话'), null)
})

test('agent-loop-runner v2.81：命令行/会话 id/凭据解析与默认关闭', async () => {
  const runner = await import('../../lib/agent-loop-runner.mjs')
  assert.equal(runner.parseSessionIdFromLine('{"type":"session","sessionId":"session-abc"}'), 'session-abc')
  assert.deepEqual(runner.buildAgentLoopArgs({ profile: 'resident', prompt: 'p', sessionId: null }), ['--profile', 'resident', '--json', 'p'])
  assert.deepEqual(runner.buildAgentLoopArgs({ profile: 'resident', prompt: 'p', sessionId: 'session-x' }), ['--profile', 'resident', '--session-id', 'session-x', 'p'])
  assert.equal(runner.parseSessionIdFromLine('not json'), null)
  const env = runner.buildAgentLoopEnv({ PATH: '/bin' }, 'sk-1')
  assert.equal(env.OPENCODE_GO_API_KEY, 'sk-1')
  assert.equal(env.PATH, '/bin')
  const disabled = runner.createAgentLoopRunner({ enabled: true, env: {} })
  assert.equal(disabled.snapshot().enabled, false)
  const enabled = runner.createAgentLoopRunner({ env: { DSH_AGENT_LOOP: 'on' }, promptFile: '/nonexistent-prompt.md' })
  assert.equal(enabled.snapshot().enabled, true)
  assert.equal((await enabled.runOnce()).reason, 'no-prompt')
})

test('v2.89：学习反哺——来源过滤 + 相关检索 + 自省引用', async () => {
  const { isJunkWanderPage } = await import('../../lib/self-wander.mjs')
  const { isJunkReadingPage } = await import('../../lib/self-reading.mjs')
  const { pickRelevantLearning } = await import('../../lib/memory-recall.mjs')
  assert.equal(isJunkWanderPage('维基百科:关于'), true)
  assert.equal(isJunkWanderPage('创建账号'), true)
  assert.equal(isJunkWanderPage('黑色五叶草角色列表'), true)
  assert.equal(isJunkWanderPage('黑格尔'), false)
  assert.equal(isJunkReadingPage('海南省五指山市人民法院（2022）琼9001民初5336号民事判决书'), true)
  assert.equal(isJunkReadingPage('故乡（鲁迅）'), false)

  const dir = makeTmpDir('dshp-relevant-learning')
  const log = path.join(dir, 'learning-log.md')
  fs.writeFileSync(log, [
    '\n## 2026-11-05 09:14 · 自学\n\nQ: 1952年达卡学生游行要求孟加拉语当国语？\n答：语言运动。\n',
    '\n## 2026-11-05 09:39 · 自学\n\nQ: 党锢禁了快二十年，最后是怎么松开的？\n答：外戚与士人。\n',
  ].join(''))
  const relevant = pickRelevantLearning(log, '党锢 禁了 二十年 松开', 2)
  assert.ok(relevant.length >= 1)
  assert.match(relevant[0], /党锢/)
  assert.equal(pickRelevantLearning(log, '', 2).length, 0)
})

test('v2.90：学习日志的 TF-IDF 向量检索', async () => {
  const { pickRelevantLearning } = await import('../../lib/memory-recall.mjs')
  const dir = makeTmpDir('dshp-vector-learning')
  const log = path.join(dir, 'learning-log.md')
  fs.writeFileSync(log, [
    '\n## 2026-11-05 09:14 · 自学\n\nQ: 1952年达卡学生游行要求孟加拉语当国语？\n答：语言运动。\n',
    '\n## 2026-11-05 09:39 · 自学\n\nQ: 党锢禁了快二十年，最后是怎么松开的？\n答：黄巾起，吕强建议大赦，中平元年解禁。\n',
    '\n## 2026-11-05 09:50 · 遛弯\n\n地方：某个无关的页面。\n',
    '\n## 2026-11-05 09:55 · 自学\n\nQ: 自动扶梯边上那排毛刷真有人蹭鞋吗？\n答：安全毛刷。\n',
  ].join(''))
  const dk = pickRelevantLearning(log, '达卡 孟加拉语 学生游行', 2)
  assert.ok(dk.length >= 1)
  assert.match(dk[0], /达卡|孟加拉语/)
  const dg = pickRelevantLearning(log, '黄巾 解禁 中平元年', 2)
  assert.ok(dg.length >= 1)
  assert.match(dg[0], /党锢|黄巾/)
  assert.equal(pickRelevantLearning(log, '量子色动力学 胶子', 2).length, 0)
  // 文件更新后索引应重建
  fs.appendFileSync(log, '\n## 2026-11-05 10:10 · 自学\n\nQ: 胶子是什么？\n答：强相互作用的传播子。\n')
  const later = pickRelevantLearning(log, '胶子 强相互作用', 1)
  assert.ok(later.length === 1)
  assert.match(later[0], /胶子/)
})

test('v2.91：自处可以主动分享', () => {
  const parsed = parseSelfDriveResult(JSON.stringify({ felt: '刚看到个有意思的，想跟他说', doing: '', share: '党锢是黄巾起来后才松的，中平元年。' }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.share, '党锢是黄巾起来后才松的，中平元年。')
  const prompt = buildSelfDrivePrompt({ now: FIXED_NOW.getTime(), state: defaultSelfState(FIXED_NOW.getTime()) })
  assert.match(prompt, /"share"/)
  assert.match(prompt, /分享欲是你自己的/)
})

test('v2.92：认知图谱——合并去重、查询、抽取解析', async () => {
  const { mergeGraph, emptyGraph, queryGraph, formatGraphDigest } = await import('../../lib/knowledge-graph.mjs')
  const { parseKnowledgeExtraction, buildKnowledgeExtractionPrompt } = await import('../../lib/knowledge-extract.mjs')
  const batch1 = {
    nodes: [
      { name: '党锢', type: 'event', summary: '东汉士人遭禁锢' },
      { name: '黄巾', type: 'event', summary: '东汉末年民变' },
      { name: '吕强', type: 'person', summary: '中常侍，建议大赦' },
    ],
    edges: [
      { from: '黄巾', to: '党锢', relation: 'causal', note: '黄巾起后解禁', confidence: 'high' },
      { from: '吕强', to: '党锢', relation: 'causal', note: '进言', confidence: 'medium' },
      { from: '不存在', to: '党锢', relation: 'causal' },
    ],
    claims: [{ text: '黄巾起后，吕强建议大赦，党锢才解。', nodes: ['吕强', '党锢'], confidence: 'medium' }],
  }
  const first = mergeGraph(emptyGraph(), batch1, 1000, 3)
  assert.equal(first.addedNodes, 3)
  assert.equal(first.addedEdges, 2)
  assert.equal(first.addedClaims, 1)
  const second = mergeGraph(first.graph, batch1, 2000, 4)
  assert.equal(second.addedNodes, 0)
  assert.equal(second.addedEdges, 0)
  assert.equal(second.addedClaims, 0)
  assert.equal(second.graph.nodes[0].sources.length, 2)
  const found = queryGraph(second.graph, '党锢 黄巾 吕强', { limit: 3 })
  assert.ok(found.nodes.length >= 2)
  assert.ok(found.edges.length >= 1)
  assert.ok(found.claims.length >= 1)
  const digest = formatGraphDigest(found)
  assert.ok(digest.some((line) => /党锢/.test(line)))

  assert.equal(parseKnowledgeExtraction('not json'), null)
  const parsed = parseKnowledgeExtraction(JSON.stringify({ nodes: [{ name: '黄册', type: 'institution', summary: '户籍册' }, { name: '鱼鳞图册', type: 'institution' }], edges: [{ from: '黄册', to: '鱼鳞图册', relation: 'part_of', confidence: 'low' }], claims: [{ text: '黄册与鱼鳞图册都是簿籍。', confidence: 'medium' }] }))
  assert.equal(parsed.nodes.length, 2)
  assert.equal(parsed.edges[0].relation, 'part_of')
  const prompt = buildKnowledgeExtractionPrompt(['材料：黄册是户籍册。'])
  assert.match(prompt, /只根据下面的材料抽取/)
  assert.match(prompt, /"nodes"/)
})

test('v2.93：图谱缺口驱动学习 + 图谱进世界观 + 可视化页', async () => {
  const kg = await import('../../lib/knowledge-graph.mjs')
  const view = await import('../../lib/graph-view.mjs')
  const prompts = await import('../../lib/self-growth-prompts.mjs')
  const worldview = await import('../../lib/worldview.mjs')
  const state = kg.normalizeGraph({
    nodes: [
      { id: 'n1', name: '黄册', type: 'institution', summary: '户籍册' },
      { id: 'n2', name: '鱼鳞图册', type: 'institution', summary: '田亩册' },
      { id: 'n3', name: '孤例', type: 'concept', summary: '没有关系的条目' },
    ],
    edges: [{ id: 'e1', from: '黄册', to: '鱼鳞图册', relation: 'part_of', note: '同属簿籍', confidence: 'high' }],
    claims: [{ id: 'c1', text: '两者都是簿籍。', nodes: ['黄册'], confidence: 'low' }],
  })
  const gaps = kg.graphGaps(state, { limit: 4 })
  assert.ok(gaps.some((gap) => /孤例/.test(gap)))
  assert.ok(gaps.some((gap) => /缺证据/.test(gap)))
  const wvLines = kg.worldviewGraphDigest(state, { limit: 5 })
  assert.ok(wvLines.some((line) => /黄册.*属于.*鱼鳞图册/.test(line)))

  const learnPrompt = prompts.buildLearnPrompt({ now: FIXED_NOW.getTime(), state: defaultSelfState(FIXED_NOW.getTime()), graphGaps: gaps })
  assert.match(learnPrompt, /你图谱里还没接上的地方/)
  const wvPrompt = worldview.buildWorldviewSynthesisPrompt({ state: worldview.emptyWorldview(), graphLines: wvLines })
  assert.match(wvPrompt, /认知图谱里已有的关系和判断/)
  assert.match(wvPrompt, /黄册/)

  const html = view.graphViewHtml({ title: '测试图谱' })
  assert.match(html, /\/api\/dsh-poetry\/graph\.json/)
  assert.match(html, /<svg/)
  assert.match(html, /测试图谱/)
})

test('v2.96：要图的说法覆盖更广，被催图不再顶人', async () => {
  const { shouldSendChatImage } = await import('../../lib/chat-media.mjs')
  for (const text of ['再要一张，精致一点的', '自画像呢', '图呢', '催你画一张', '发张图看看', '你的样子', '凑一张']) {
    assert.equal(shouldSendChatImage(text), true, `应识别为要图：${text}`)
  }
  for (const text of ['在吗', '今天有点累', '你觉得我烦吗']) {
    assert.equal(shouldSendChatImage(text), false, `不应识别为要图：${text}`)
  }
})

test('v2.97：自训练调度默认关闭、开启后有排期', async () => {
  const { createSelfTrainer } = await import('../../lib/self-trainer.mjs')
  const off = createSelfTrainer({ env: {}, home: '/tmp' })
  assert.equal(off.snapshot().enabled, false)
  const on = createSelfTrainer({ env: { DSH_POETRY_SELF_TRAIN: 'on' }, home: '/tmp' })
  assert.equal(on.snapshot().enabled, true)
  on.stop()
  const disabledRun = await off.runOnce()
  assert.equal(disabledRun.reason, 'disabled')
})

test('v2.98：关系记忆——抽取解析、合并去重、摘要', async () => {
  const rel = await import('../../lib/relationship-memory.mjs')
  const parsed = rel.parseRelationshipExtraction(JSON.stringify({ entries: [
    { kind: 'preference', text: '他喜欢晚上做东西', evidence: '我晚上才有空', confidence: 'high' },
    { kind: 'boundary', text: '他不喜欢被追问动机', evidence: '你别老问我为什么', confidence: 'high' },
  ] }))
  assert.ok(parsed && parsed.length === 2)
  const first = rel.mergeRelationship(rel.emptyRelationship(), parsed, 1000)
  assert.equal(first.added, 2)
  const second = rel.mergeRelationship(first.relationship, [{ kind: 'preference', text: '他喜欢晚上做东西', evidence: '晚上比较静', confidence: 'high' }], 2000)
  assert.equal(second.added, 0)
  assert.equal(second.relationship.entries.length, 2)
  const digest = rel.formatRelationshipDigest(second.relationship, '晚上做东西')
  assert.ok(digest.some((line) => /晚上做东西/.test(line)))
  assert.ok(digest.some((line) => /他的边界/.test(line)))
  assert.equal(rel.parseRelationshipExtraction('not json'), null)
})

test('v2.98：情绪持续性——加强、衰减、摘要', async () => {
  const emo = await import('../../lib/emotional-continuity.mjs')
  const t0 = 1000000000
  let result = emo.recordEmotion(emo.emptyEmotions(), { topic: '他说有点累', emotion: '担心', intensity: 0.6 }, t0)
  assert.equal(result.added, true)
  const again = emo.recordEmotion(result.emotions, { topic: '他说有点累', emotion: '心疼', intensity: 0.5 }, t0 + 3600000)
  assert.equal(again.reinforced, true)
  assert.equal(again.emotions.threads.length, 1)
  const strong = emo.effectiveIntensity(again.emotions.threads[0], t0 + 3600000)
  const weak = emo.effectiveIntensity(again.emotions.threads[0], t0 + 3600000 + 96 * 3600000)
  assert.ok(strong > weak)
  assert.ok(weak < 0.12 + 0.01)
  const digest = emo.formatEmotionalDigest(again.emotions, t0 + 3600000)
  assert.ok(digest.some((line) => /还很强|还挂着|快淡了/.test(line)))
  const pruned = emo.pruneEmotions(again.emotions, t0 + 3600000 + 120 * 3600000)
  assert.equal(pruned.threads.length, 0)
})

test('v2.99：日常素材——反重复 prompt 与解析', async () => {
  const daily = await import('../../lib/daily-life.mjs')
  const prompt = daily.buildDailyLifePrompt({ now: FIXED_NOW.getTime(), state: { felt: '有点蔫' }, recentEvents: ['刚把水杯洗了', '楼下有人在搬东西'] })
  assert.match(prompt, /不写学习、笔记、书/)
  assert.match(prompt, /不要再重复里面的事物：刚把水杯洗了；楼下有人在搬东西/)
  assert.match(prompt, /"event"/)
  assert.deepEqual(daily.parseDailyLifeResult(JSON.stringify({ event: '顺手把窗台擦了', feeling: '灰太多' })), { event: '顺手把窗台擦了', feeling: '灰太多' })
  assert.equal(daily.parseDailyLifeResult('not json'), null)
})

test('v2.99：承诺账本——去重、逾期优先、标记完成', async () => {
  const cm = await import('../../lib/commitments.mjs')
  const t0 = FIXED_NOW.getTime()
  const empty = cm.emptyCommitments()
  const first = cm.addAgreement(empty, '答应给他画一张自画像', t0)
  assert.equal(first.added, true)
  const duplicate = cm.addAgreement(first.commitments, '答应给他画一张自画像', t0 + 1000)
  assert.equal(duplicate.added, false)
  const late = cm.addAgreement(duplicate.commitments, '明天给他看读到的那段', t0 + 2000)
  late.commitments.entries[1].dueAt = t0 - 3600000
  const digest = cm.formatCommitmentsDigest(late.commitments, t0 + 7200000, 3)
  assert.ok(digest.some((line) => /已逾期/.test(line)))
  assert.ok(digest[0].includes('逾期'))
  const done = cm.markCommitment(late.commitments, late.commitments.entries[0].id, 'done', t0 + 9000000)
  assert.equal(done.updated, true)
  const after = cm.formatCommitmentsDigest(done.commitments, t0 + 9000000, 3)
  assert.ok(after.every((line) => !line.includes('自画像')))
})

test('v3.00：用户附图 OCR 路径识别与脱敏', async () => {
  const ocr = await import('../../lib/image-ocr.mjs')
  const text = '图片发给你了 （附图：/Users/x/.dsh/attachments/v1/objects/ab/abcdef）'
  const paths = ocr.extractImagePaths(text, { mustExist: false, home: '/Users/x' })
  assert.deepEqual(paths, ['/Users/x/.dsh/attachments/v1/objects/ab/abcdef'])
  assert.equal(ocr.sanitizeUserText(text), '图片发给你了 （发来一张图）')
  assert.equal(ocr.extractImagePaths('普通消息', { mustExist: false }).length, 0)
  const safe = ocr.extractImagePaths('https://example.com/attachments/v1/objects/ab/cd', { mustExist: false, home: '/Users/x' })
  assert.equal(safe.length, 0, '只接受本机 attachments 路径')
})

test('v3.01：世界观版本回退、单源判断降置信、维基生态站点过滤', async () => {
  const wv = await import('../../lib/worldview.mjs')
  const raw = { ok: true, v: 4, beliefs: [], concepts: [], questions: [], contradictions: [], essay: { text: '一段足够长的旧世界观文字，用来验证版本号回退。' }, history: [{ at: 1, version: 3, changed: 'x' }, { at: 2, version: 4, changed: 'y' }] }
  const norm = wv.normalizeWorldview(raw)
  assert.equal(norm.essay.version, 4)

  const kg = await import('../../lib/knowledge-graph.mjs')
  const merged = kg.mergeGraph(kg.emptyGraph(), { nodes: [{ name: '甲', type: 'concept' }, { name: '乙', type: 'concept' }], edges: [], claims: [{ text: '甲乙之间有因果关系。', nodes: ['甲'], confidence: 'high' }] }, 1000, 1)
  assert.equal(merged.graph.claims[0].confidence, 'medium', '单来源 high 降为 medium')
  const again = kg.mergeGraph(merged.graph, { nodes: [], edges: [], claims: [{ text: '甲乙之间有因果关系。', nodes: ['甲'], confidence: 'high' }] }, 2000, 2)
  assert.equal(again.graph.claims[0].confidence, 'high', '第二来源后可升 high')

  const w = await import('../../lib/self-wander.mjs')
  assert.equal(w.isBlockedWanderHost('donate.wikimedia.org'), true)
  assert.equal(w.isBlockedWanderHost('meta.wikimedia.org'), true)
  assert.equal(w.isBlockedWanderHost('zh.wikipedia.org'), false)
  assert.equal(w.isBlockedWanderUrl('https://foundation.wikimedia.org/wiki/Home'), true)

  const prompts = await import('../../lib/self-growth-prompts.mjs')
  const prompt = prompts.buildLearnPrompt({ now: FIXED_NOW.getTime(), state: defaultSelfState(FIXED_NOW.getTime()), broadenHint: '自然科学：挑一个具体的科学概念或发现' })
  assert.match(prompt, /本周可以补一个世界知识的空白板块/)
})
