// tests/domains/mood-experience.test.mjs —— mood/activity/experience（W3 拆分）
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
// mood-ai 选择多样性（契约 v1.13，M19a：打乱/视频优先/排除最近 20 张）
// ---------------------------------------------------------------------------

/** 生成 count 个静态图条目的小图鉴（file=img-<n>.webp）。 */
function makeMoodCatalogBig(count = 30) {
  return normalizeMoodCatalog({
    ok: true,
    version: 'big.1',
    images: Array.from({ length: count }, (_, index) => ({
      file: `img-${index}.webp`,
      label: `标签${index}`,
      tags: [`tag${index % 5}`],
    })),
    panelImages: [],
  })
}

/** 25 张静态图 + 3 个视频的图鉴（用于验证 recentImages 对视频的排除）。 */
/** 可复现的 LCG random（用于断言打乱顺序）。 */
function seededRandom(seed = 12345) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

test('mood-ai：每次构建图鉴用 Fisher–Yates 打乱（注入 random 可断言顺序变化/可复现）', () => {
  const catalog = makeMoodCatalogBig(30)
  const originalOrder = catalog.moodImages.map((image) => image.file)
  const plan = resolveMoodCandidates(catalog, [], { random: seededRandom(20261023) })
  const files = plan.candidates.map((image) => image.file)
  assert.equal(files.length, 30, '不丢条目')
  assert.deepEqual(new Set(files), new Set(originalOrder), '是原列表的排列')
  assert.notDeepEqual(files, originalOrder, '顺序确实被打乱')

  const planAgain = resolveMoodCandidates(catalog, [], { random: seededRandom(20261023) })
  assert.deepEqual(planAgain.candidates.map((image) => image.file), files, '同一 random 可复现')

  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0) }, catalog, { plan })
  assert.deepEqual(promptCatalogRowFiles(prompt), files, 'prompt 图鉴行顺序 = 打乱后的候选顺序')
  assert.match(prompt, /已打乱顺序/)

  // shuffleCopy 本身：排列且不修改入参
  const input = [1, 2, 3, 4, 5]
  const shuffled = shuffleCopy(input, seededRandom(7))
  assert.deepEqual(new Set(shuffled), new Set(input))
  assert.deepEqual(input, [1, 2, 3, 4, 5], '不修改入参')
})

test('mood-ai：prompt 明确「优先 video 动画 / 不连续重复 / 不同情境换不同 tag」', () => {
  const catalog = makeMoodCatalogFixture()
  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0) }, catalog, {
    random: seededRandom(3),
  })
  assert.match(prompt, /优先从 media=video 的动画里选/)
  assert.match(prompt, /不要连续选同一张图或同一个动作/)
  assert.match(prompt, /不同 tag 的动作/)
  assert.match(prompt, /waiting\/idle\/melt/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /优先从 media=video 的动画里选/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要连续选同一张图或同一个动作/)
  assert.ok(MOOD_AI_TEMPERATURE >= 1.0 && MOOD_AI_TEMPERATURE <= 1.1, `temperature=${MOOD_AI_TEMPERATURE}`)
})

test('mood-ai：recentImages 上限 20 并从图鉴行剔除；候选不足 20 时退回全量', () => {
  assert.equal(MOOD_RECENT_IMAGES_MAX, 20)
  assert.equal(MOOD_MIN_CANDIDATES, 20)
  const big = makeMoodCatalogBig(50) // 50 - 20 = 30 ≥ MOOD_MIN_CANDIDATES，走排除模式
  const recent25 = Array.from({ length: 25 }, (_, index) => `img-${index}.webp`)
  const plan = resolveMoodCandidates(big, recent25, { random: seededRandom(11) })
  assert.equal(plan.recentList.length, 20, 'recentImages 上限 20（路径/长度同步）')
  assert.equal(plan.usedFallback, false)
  assert.equal(plan.excludedFiles.size, 20)
  assert.equal(plan.candidates.length, 30, '50 - 20 被排除')

  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0), recentImages: recent25 }, big, { plan })
  assert.match(prompt, /已从下面的图鉴列表中移除/)
  const rowFiles = promptCatalogRowFiles(prompt)
  for (const file of recent25.slice(0, 20)) {
    assert.equal(rowFiles.includes(file), false, `被排除条目不应出现在图鉴行：${file}`)
  }
  const recentSection = prompt.slice(prompt.indexOf('最近用过的图片'))
  for (const file of recent25.slice(0, 20)) {
    assert.equal(recentSection.includes(file), true, '最近图仍在文字里列出')
  }

  // 图鉴太小：退回完整列表（仍文字列出最近图），parse 不强制排除
  const small = makeMoodCatalogFixture()
  const allRecent = small.moodImages.map((image) => image.file)
  const fallbackPlan = resolveMoodCandidates(small, allRecent, { random: seededRandom(5) })
  assert.equal(fallbackPlan.usedFallback, true)
  assert.equal(fallbackPlan.candidates.length, small.moodImages.length, '退回完整列表')
  assert.equal(fallbackPlan.excludedFiles.size, 0)
  const fallbackPrompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0), recentImages: allRecent }, small, {
    plan: fallbackPlan,
  })
  assert.match(fallbackPrompt, /图鉴条目不足/)
})

test('mood-ai v1.21：被排除的最近图若被模型返回仍成功（排除只是软建议）；图鉴外才失败', () => {
  const big = makeMoodCatalogBig(30)
  const plan = resolveMoodCandidates(big, ['img-0.webp', 'img-1.webp'], { random: seededRandom(9) })
  // 被排除的图仍被接受（否则体验/情绪要求某张图时会误判失败、客户端回退本地心情）
  const accepted = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(accepted.ok, true)
  assert.equal(accepted.mood.image, 'img-0.webp')

  // 图鉴外的图仍然失败
  const unknown = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'nope.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(unknown.ok, false)
  assert.match(unknown.message, /不在图鉴/)

  // 未排除图正常
  const allowed = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-2.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(allowed.ok, true)
})

test('mood-ai 服务 v1.21：模型返回被排除/最近用过的图 → 仍成功（排除只做 prompt 引导）', async () => {
  const big = makeMoodCatalogBig(30)
  const { service, llm } = makeMoodAiHarness({
    catalog: big,
    responder: () => JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
  })
  const first = await service.generate({ recentImages: ['img-0.webp'] }, { force: true })
  assert.equal(first.ok, true)
  assert.equal(first.mood.image, 'img-0.webp')

  // 第二次同一张：prompt 图鉴仍把它排除（软引导多样性），但模型返回它也不再失败
  const second = await service.generate({ recentImages: ['img-0.webp'] }, { force: true })
  assert.equal(second.ok, true)
  assert.equal(second.mood.image, 'img-0.webp')
  const prompt = llm.calls[1].messages[0].content[0].text
  assert.equal(promptCatalogRowFiles(prompt).includes('img-0.webp'), false, 'prompt 仍排除最近图（仅引导）')
})

test('mood-ai 路由：recentImages query 最多 20 条（解析同步上限）', async () => {
  const seen = []
  const stub = {
    async generate(context) {
      seen.push(context)
      return { ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: 'x' } }
    },
  }
  const harness = createHarness({ moodAiService: stub })
  const many = encodeURIComponent(Array.from({ length: 25 }, (_, index) => `img-${index}.webp`).join('|'))
  const response = await harness.call('mood-ai.json', mockRequest({ url: `/api/dsh-poetry/mood-ai.json?recentImages=${many}` }))
  assert.equal(response.statusCode, 200)
  assert.equal(seen[0].recentImages.length, 20, 'recentImages 最多 20 条')
})

// ---------------------------------------------------------------------------
// 最近活动感知（契约 v1.16，M22：工具名 → 看视频/学习/写代码/聊天/发呆）
// ---------------------------------------------------------------------------

test('mood 活动：classifyToolName 按工具名分类（不读参数）', () => {
  const cases = [
    ['bsk_click', 'watch'],
    ['bsk_navigate', 'watch'],
    ['browser_navigate', 'watch'],
    ['chrome_open', 'watch'],
    ['web_fetch', 'read'],
    ['web_search', 'read'],
    ['fetch_url', 'read'],
    ['search', 'read'],
    ['bash', 'code'],
    ['shell_exec', 'code'],
    ['exec', 'code'],
    ['apply_patch', 'code'],
    ['edit_file', 'code'],
    ['write_file', 'code'],
    ['git_diff', 'code'],
    ['subagent', 'social'],
    ['team_task_create', 'social'],
    ['message_send', 'social'],
    ['chat', 'social'],
  ]
  const now = 1_700_000_000_000
  for (const [name, kind] of cases) {
    assert.equal(classifyToolName(name), kind, name)
    const activity = describeRecentActivity([{ name, at: now - 1000 }], now)
    assert.equal(activity.kind, kind, name)
    assert.equal(activity.label, MOOD_ACTIVITY_LABELS[kind], name)
    assert.equal(activity.at, now - 1000)
  }
  for (const name of ['glob', 'grep', 'present', '', null, undefined, 42]) {
    assert.equal(classifyToolName(name), null, String(name))
  }
  assert.equal(classifyToolName('WEB_SEARCH'), 'read', '大小写不敏感')
})

test('mood 活动：describeRecentActivity 的 idle/最近优先/最近 1–2 条规则', () => {
  const now = 1_700_000_000_000
  assert.deepEqual(describeRecentActivity([], now), { kind: 'idle', label: '发呆', at: null })
  assert.deepEqual(describeRecentActivity(null, now), { kind: 'idle', label: '发呆', at: null })

  // 60s 内仍算活跃；超过 60s → 发呆
  assert.equal(describeRecentActivity([{ name: 'bash', at: now - 59_000 }], now).kind, 'code')
  assert.equal(describeRecentActivity([{ name: 'bash', at: now - MOOD_ACTIVITY_IDLE_MS - 1_000 }], now).kind, 'idle')
  assert.equal(describeRecentActivity([{ name: 'bash', at: now - MOOD_ACTIVITY_IDLE_MS - 1_000 }], now).at, now - MOOD_ACTIVITY_IDLE_MS - 1_000)

  // 最近一条优先：老 bash + 新 web_fetch → read
  const recentFirst = describeRecentActivity(
    [
      { name: 'bash', at: now - 10_000 },
      { name: 'web_fetch', at: now - 2_000 },
    ],
    now,
  )
  assert.equal(recentFirst.kind, 'read')
  assert.equal(recentFirst.at, now - 2_000)

  // 最近一条无法分类时，看第二条（最近 1–2 条）
  const secondFallback = describeRecentActivity(
    [
      { name: 'bash', at: now - 10_000 },
      { name: 'glob', at: now - 2_000 },
    ],
    now,
  )
  assert.equal(secondFallback.kind, 'code')
  assert.equal(secondFallback.at, now - 10_000)

  // 两条都无法分类 → 发呆
  const unknown = describeRecentActivity(
    [
      { name: 'glob', at: now - 10_000 },
      { name: 'grep', at: now - 2_000 },
    ],
    now,
  )
  assert.equal(unknown.kind, 'idle')
  assert.equal(unknown.at, now - 2_000)
})

test('mood 活动：ring buffer ≤12、只存名称+时间、绝不泄漏 arguments；stats 不受影响', () => {
  const dir = makeTmpDir('dshp-mood-activity')
  const base = new Date(2026, 9, 23, 12, 0, 0).getTime()
  let clock = base
  const tracker = createMoodTracker({
    file: path.join(dir, 'mood.json'),
    now: () => clock,
    persistDebounceMs: 0,
  })
  const sensitive = 'SECRET_TOOL_ARGUMENT_abc123'
  for (let index = 0; index < 15; index += 1) {
    clock = base + index * 1000
    tracker.record(
      { id: 's1' },
      {
        type: 'tool/call',
        time: clock,
        data: {
          name: index < 6 ? 'bash' : 'web_fetch',
          callId: `call-${index}`,
          arguments: { command: sensitive, url: `https://example.com/${sensitive}` },
        },
      },
    )
  }
  const tools = tracker.recentTools()
  assert.equal(tools.length, MOOD_RECENT_TOOL_LIMIT, 'ring buffer 最多 12 条')
  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).sort(), ['at', 'name'], '只保存名称+时间')
  }
  assert.equal(JSON.stringify(tools).includes(sensitive), false, '不保存/不泄漏工具参数')
  assert.equal(tools[0].name, 'bash', '最早的 3 条已被挤出')

  const activity = tracker.getRecentActivity(clock)
  assert.equal(activity.kind, 'read', '最近工具是 web_fetch')
  assert.equal(activity.label, '查资料/学习')
  assert.equal(JSON.stringify(activity).includes(sensitive), false)

  // 60s 无新调用 → 发呆
  assert.equal(tracker.getRecentActivity(clock + MOOD_ACTIVITY_IDLE_MS + 1_000).kind, 'idle')

  // 记忆日志/统计不受影响：toolCalls 仍按事件计数；mood.json 不含参数
  assert.equal(tracker.getToday().stats.toolCalls, 15)
  const persisted = fs.readFileSync(path.join(dir, 'mood.json'), 'utf8')
  assert.equal(persisted.includes(sensitive), false, 'mood.json 不落盘工具参数')
  assert.equal(persisted.includes('web_fetch'), false, '活动信号不落盘')
  tracker.dispose()
})

test('mood-ai v1.58：不再从工具活动推断情境，误传 activity 也不进入 prompt', () => {
  const catalog = makeMoodCatalogFixture()
  const now = FIXED_NOW.getTime()
  const prompt = buildMoodPrompt(
    {
      now,
      activity: { kind: 'read', label: '查资料' },
      stats: { userMessages: 12, toolCalls: 34 },
      idleMinutes: 8,
      recent: ['刚刚在发呆'],
    },
    catalog,
  )
  assert.equal(prompt.includes('你最近在做'), false, 'activity 忽略')
  assert.equal(prompt.includes('用户消息'), false, 'stats 忽略')
  assert.match(prompt, /刚刚在发呆/)
})

test('mood-ai 路由 v1.58：即使宿主记录了工具事件，prompt 也不包含活动/参数', async () => {
  const { llm, service } = makeMoodAiHarness({
    responder: () =>
      JSON.stringify({ label: '在查资料', image: 'dsh-whale-state-happy.webp', reason: '看到有用的东西', energy: 60 }),
  })
  const harness = createHarness({ moodAiService: service })
  const sensitive = 'SECRET_URL_VALUE_xyz'
  harness.moodTracker.record(
    { id: 's1' },
    {
      type: 'tool/call',
      time: FIXED_NOW.getTime(),
      data: { name: 'web_fetch', callId: 'c1', arguments: { url: `https://secret.example/${sensitive}` } },
    },
  )
  const response = await harness.call('mood-ai.json', mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.equal(prompt.includes('你最近在做'), false, '不注入工具活动')
  assert.equal(prompt.includes('查资料/学习'), false)
  assert.equal(prompt.includes(sensitive), false)
  assert.equal(JSON.stringify(llm.calls[0]).includes(sensitive), false, '工具参数不出现在模型请求里')
})

// ---------------------------------------------------------------------------
// 体验/情绪状态通道（契约 v1.17，M23：体验内容 → 情绪 → 心情图像）
// ---------------------------------------------------------------------------

test('experience：resolveExperiencePath（env 覆盖 / DSH_HOME / home 回退）', () => {
  assert.equal(resolveExperiencePath({ DSH_POETRY_EXPERIENCE: '/tmp/exp.json' }, '/Users/alice'), '/tmp/exp.json')
  assert.equal(
    resolveExperiencePath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/.dsh-poetry/experience.json',
  )
  assert.equal(resolveExperiencePath({}, '/Users/alice'), '/Users/alice/.dsh/.dsh-poetry/experience.json')
  assert.equal(
    resolveExperiencePath({ DSH_POETRY_EXPERIENCE: '   ' }, '/Users/alice'),
    '/Users/alice/.dsh/.dsh-poetry/experience.json',
    '空白覆盖值忽略',
  )
  assert.equal(EXPERIENCE_KIND_LABELS.video, '视频')
  assert.equal(EXPERIENCE_KIND_LABELS.novel, '小说')
  assert.equal(EXPERIENCE_KIND_LABELS.article, '文章')
  assert.equal(EXPERIENCE_KIND_LABELS.music, '音乐')
  assert.equal(EXPERIENCE_KIND_LABELS.other, '其他')
  assert.equal(EXPERIENCE_EMOTION_LABELS.touched, '感动鼻酸')
  assert.equal(EXPERIENCE_EMOTION_LABELS.sad, '难过')
  assert.equal(EXPERIENCE_EMOTION_LABELS.happy, '开心')
  assert.equal(EXPERIENCE_EMOTION_LABELS.tense, '紧张')
  assert.equal(EXPERIENCE_EMOTION_LABELS.curious, '好奇')
  assert.equal(EXPERIENCE_EMOTION_LABELS.calm, '平静')
  assert.equal(EXPERIENCE_EMOTION_LABELS.angry, '生气')
  assert.equal(EXPERIENCE_EMOTION_LABELS.inspired, '振奋')
})

test('experience：readExperience 合法（含/不含 note、ISO 时间、默认路径）', () => {
  const now = new Date(2026, 9, 23, 16, 0, 0).getTime()
  const dir = makeTmpDir('dshp-exp')
  const file = path.join(dir, 'experience.json')
  writeExperienceFile(file, {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: now - 10 * 60 * 1000,
  })
  const result = readExperience({ env: { DSH_POETRY_EXPERIENCE: file }, now })
  assert.equal(result.ok, true)
  assert.deepEqual(result.experience, {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: now - 10 * 60 * 1000,
  })

  // 无 note
  writeExperienceFile(file, { title: '活着', kind: 'novel', emotion: 'sad', at: new Date(now - 60 * 1000).toISOString() })
  const noNote = readExperience({ env: { DSH_POETRY_EXPERIENCE: file }, now })
  assert.equal(noNote.ok, true)
  assert.equal(noNote.experience.title, '活着')
  assert.equal('note' in noNote.experience, false)
  assert.equal(noNote.experience.at, now - 60 * 1000, 'ISO 字符串时间戳也可接受')

  // DSH_HOME 默认路径
  const dshHome = makeTmpDir('dshp-exp-home')
  writeExperienceFile(path.join(dshHome, '.dsh-poetry', 'experience.json'), {
    title: '宇宙探索编辑部',
    kind: 'other',
    emotion: 'inspired',
    at: now - 5 * 60 * 1000,
  })
  const viaHome = readExperience({ env: { DSH_HOME: dshHome }, home: '/Users/alice', now })
  assert.equal(viaHome.ok, true)
  assert.equal(viaHome.experience.title, '宇宙探索编辑部')
})

test('experience：readExperience 缺失/坏 JSON/过期/越界/未知枚举 → ok:false 不抛', () => {
  const now = new Date(2026, 9, 23, 16, 0, 0).getTime()
  const dir = makeTmpDir('dshp-exp')
  const file = path.join(dir, 'experience.json')
  const read = (data, extra = {}) => {
    writeExperienceFile(file, data)
    return readExperience({ env: { DSH_POETRY_EXPERIENCE: file }, now, ...extra })
  }

  assert.deepEqual(readExperience({ env: { DSH_POETRY_EXPERIENCE: path.join(dir, 'nope.json') }, now }), {
    ok: false,
    reason: 'missing',
  })
  assert.equal(read('not json at all').reason, 'bad-json')
  assert.equal(read({}).reason, 'bad-title')
  const base = { title: '测试作品', kind: 'novel', emotion: 'calm', at: now - 1000 }

  assert.equal(read({ ...base, title: '' }).reason, 'bad-title')
  assert.equal(read({ ...base, title: '字'.repeat(81) }).reason, 'bad-title')
  assert.equal(read({ ...base, kind: 'game' }).reason, 'bad-kind')
  assert.equal(read({ ...base, emotion: 'excited' }).reason, 'bad-emotion')
  assert.equal(read({ ...base, note: '感'.repeat(201) }).reason, 'bad-note')
  assert.equal(read({ ...base, note: 123 }).reason, 'bad-note')
  assert.equal(read({ ...base, at: undefined }).reason, 'bad-at')
  assert.equal(read({ ...base, at: 'not-a-date' }).reason, 'bad-at')
  assert.equal(read({ ...base, at: now - EXPERIENCE_MAX_AGE_MS - 1000 }).reason, 'expired')

  // 恰好 2h 不过期；超过 2h 过期
  assert.equal(read({ ...base, at: now - EXPERIENCE_MAX_AGE_MS }).ok, true, '恰好 2h 仍有效')
  assert.equal(read({ ...base, at: now - EXPERIENCE_MAX_AGE_MS - 1 }).reason, 'expired')

  // 字段边界：80 字标题、200 字 note 合法
  const boundary = read({ ...base, title: '字'.repeat(80), note: '注'.repeat(200) })
  assert.equal(boundary.ok, true)
  assert.equal(Array.from(boundary.experience.title).length, 80)
  assert.equal(Array.from(boundary.experience.note).length, 200)
})

test('mood-ai v1.59：她自己写的「在体会」进入 prompt；外部 experience 不再读取', () => {
  const catalog = makeMoodCatalogFixture()
  const now = Date.UTC(2026, 9, 23, 8, 0, 0)
  const selfState = { felt: '有点说不上来的沉。', experiencing: '在听楼下谁弹琴，想到一段旧事。' }
  const prompt = buildMoodPrompt({ now, selfState }, catalog, { random: seededRandom(3) })
  assert.match(prompt, /你此刻的状态：有点说不上来的沉。/)
  assert.match(prompt, /你最近在体会\/琢磨：在听楼下谁弹琴，想到一段旧事。/)
  // 外部 experience 字段即使误传也不进入 prompt
  const ignored = buildMoodPrompt(
    { now, experience: { title: '海上钢琴师', kind: 'video', emotion: 'touched', note: '结尾那段琴声' } },
    catalog,
  )
  assert.equal(ignored.includes('海上钢琴师'), false, 'v1.59：外部体验文件不再进 prompt')
  assert.equal(ignored.includes('你最近在体验'), false)
  const plain = buildMoodPrompt({ now }, catalog)
  assert.equal(plain.includes('你最近在体会'), false)
})

test('mood-ai 路由 v1.59：不读取外部 experience 文件；selfState 的 felt/体验进入 prompt', async () => {
  const now = FIXED_NOW.getTime()
  const expDir = makeTmpDir('dshp-exp-route')
  const expFile = writeExperienceFile(path.join(expDir, 'experience.json'), {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: now - 5 * 60 * 1000,
  })
  const { llm, service } = makeMoodAiHarness({
    responder: () =>
      JSON.stringify({ label: '有点鼻酸', image: 'dsh-whale-state-happy.webp', reason: '看完那段琴声很感动', energy: 55 }),
  })
  const harness = createHarness({ env: { DSH_POETRY_EXPERIENCE: expFile }, moodAiService: service })
  const response = await harness.call(
    'mood-ai.json',
    mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }),
  )
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.equal(prompt.includes('海上钢琴师'), false, 'v1.59：不再读取外部体验文件')
  assert.equal(prompt.includes('结尾那段琴声'), false)

  // journal 仍只记模型自己的心情
  const journalRaw = fs.readFileSync(path.join(harness.journalDir, 'journal.jsonl'), 'utf8')
  assert.match(journalRaw, /dsh-whale-state-happy\.webp/)
})

test('mood-ai M24：normalizeRecentImageList 把视频 recent 归一成完整 webm/ 路径', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  // 完整路径
  const full = normalizeRecentImageList(['webm/哈欠连天.webm'], catalog)
  assert.deepEqual(full, [{ raw: 'webm/哈欠连天.webm', file: 'webm/哈欠连天.webm' }])
  // 客户端传 basename（无 webm/ 前缀）
  const base = normalizeRecentImageList(['哈欠连天.webm'], catalog)
  assert.deepEqual(base, [{ raw: '哈欠连天.webm', file: 'webm/哈欠连天.webm' }])
  // 静态图 basename 仍是自身
  assert.deepEqual(normalizeRecentImageList(['img-3.webp'], catalog), [{ raw: 'img-3.webp', file: 'img-3.webp' }])
  // 完整路径与 basename 视为同一条，去重
  const deduped = normalizeRecentImageList(['webm/哈欠连天.webm', '哈欠连天.webm'], catalog)
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].file, 'webm/哈欠连天.webm')
  // 图鉴外的文件保留 raw、file=null
  assert.deepEqual(normalizeRecentImageList(['unknown.webp'], catalog), [{ raw: 'unknown.webp', file: null }])
})

test('mood-ai M24：被排除视频不在候选/prompt 图鉴行，静态图排除不受影响', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const total = catalog.moodImages.length
  const recent = ['webm/哈欠连天.webm', 'img-0.webp']
  const plan = resolveMoodCandidates(catalog, recent, { random: seededRandom(21) })
  assert.equal(plan.usedFallback, false)
  assert.equal(plan.excludedFiles.size, 2)
  assert.equal(plan.excludedFiles.has('webm/哈欠连天.webm'), true, 'excludedFiles 存完整 file')
  assert.equal(plan.candidates.length, total - 2)
  assert.equal(plan.candidates.some((image) => image.file === 'webm/哈欠连天.webm'), false, '被排除视频不在候选')
  assert.equal(plan.candidates.some((image) => image.file === 'img-0.webp'), false, '被排除静态图不在候选')

  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 23, 8, 0, 0), recentImages: recent }, catalog, { plan })
  const rows = promptCatalogRowFiles(prompt)
  assert.equal(rows.includes('webm/哈欠连天.webm'), false, 'prompt 图鉴行不含被排除视频')
  assert.equal(rows.includes('img-0.webp'), false)
  assert.equal(rows.includes('webm/吃午餐.webm'), true, '未用过的视频仍在候选')
  assert.match(prompt, /- webm\/哈欠连天\.webm/, '最近图仍文字列出')

  // 客户端只传 basename 也排除
  const planBase = resolveMoodCandidates(catalog, ['哈欠连天.webm'], { random: seededRandom(21) })
  assert.equal(planBase.excludedFiles.has('webm/哈欠连天.webm'), true)
  assert.equal(planBase.candidates.some((image) => image.file === 'webm/哈欠连天.webm'), false)
})

test('mood-ai M24/v1.21：被排除视频若被模型返回仍成功；图鉴外视频失败；basename 正常解析', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const excludedVideo = 'webm/哈欠连天.webm'
  const make = (image) => JSON.stringify({ label: '好困', image, reason: '理由足够长', energy: 40 })
  const options = { dateKey: '2026-10-21' }

  // 被排除的视频（完整 file / basename）仍被接受——排除只是 prompt 软建议
  const acceptedFull = parseMoodResult(make(excludedVideo), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(acceptedFull.ok, true)
  assert.equal(acceptedFull.mood.image, excludedVideo)

  const acceptedBase = parseMoodResult(make(excludedVideo), catalog, {
    ...options,
    excludedImages: ['哈欠连天.webm'],
  })
  assert.equal(acceptedBase.ok, true)

  // 图鉴外的视频仍然失败
  const unknown = parseMoodResult(make('webm/不存在.webm'), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(unknown.ok, false)
  assert.match(unknown.message, /不在图鉴/)

  // 未排除的视频（完整路径 / 模型漏写 webm/ 前缀的 basename）解析成完整 file
  const other = parseMoodResult(make('webm/吃午餐.webm'), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(other.ok, true)
  assert.equal(other.mood.image, 'webm/吃午餐.webm')

  const otherBase = parseMoodResult(make('吃午餐.webm'), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(otherBase.ok, true, '模型只写 basename 时解析回完整 file')
  assert.equal(otherBase.mood.image, 'webm/吃午餐.webm')
})

test('mood-ai M24 服务 v1.21：模型返回近期用过的视频 → 成功（排除只做 prompt 引导）', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const responder = () => JSON.stringify({ label: '好困', image: 'webm/哈欠连天.webm', reason: '理由足够长', energy: 40 })
  const full = makeMoodAiHarness({ catalog, responder })
  const fullResult = await full.service.generate({ recentImages: ['webm/哈欠连天.webm'] }, { force: true })
  assert.equal(fullResult.ok, true, '被排除的最近视频也应成功，不再 MOOD_AI_UNAVAILABLE')
  assert.equal(fullResult.mood.image, 'webm/哈欠连天.webm')

  const base = makeMoodAiHarness({ catalog, responder })
  const baseResult = await base.service.generate({ recentImages: ['哈欠连天.webm'] }, { force: true })
  assert.equal(baseResult.ok, true, 'basename recent 同样不再造成失败')
  assert.equal(baseResult.mood.image, 'webm/哈欠连天.webm')

  // prompt 仍然把最近用过的视频从候选里排除（软引导）
  const prompt = full.llm.calls[0].messages[0].content[0].text
  assert.equal(promptCatalogRowFiles(prompt).includes('webm/哈欠连天.webm'), false, 'prompt 候选仍排除最近图')

  const accepted = makeMoodAiHarness({
    catalog,
    responder: () => JSON.stringify({ label: '饿了', image: 'webm/吃午餐.webm', reason: '理由足够长', energy: 50 }),
  })
  const okResult = await accepted.service.generate({ recentImages: ['webm/哈欠连天.webm'] }, { force: true })
  assert.equal(okResult.ok, true)
  assert.equal(okResult.mood.image, 'webm/吃午餐.webm')
})
