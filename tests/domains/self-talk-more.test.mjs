// tests/domains/self-talk-more.test.mjs —— self-talk 降重/话题/词汇（W3 拆分）
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
// M27：journal 刷屏修复（服务端生成 ring 兜底 + journal 写入限频）
// ---------------------------------------------------------------------------

test('mood-ai 服务：宿主生成 image ring 引导下一轮候选（不再硬失败）', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  let calls = 0
  const responder = () => {
    calls += 1
    if (calls <= 2) {
      return JSON.stringify({ label: '好困', image: 'webm/哈欠连天.webm', reason: '理由足够长', energy: 40 })
    }
    return JSON.stringify({ label: '饿了', image: 'webm/吃午餐.webm', reason: '理由足够长', energy: 50 })
  }
  const { service, llm } = makeMoodAiHarness({ catalog, responder })

  const first = await service.generate({}, { force: true })
  assert.equal(first.ok, true)
  assert.equal(first.mood.image, 'webm/哈欠连天.webm')
  assert.deepEqual(service.peekRecentGenerated(), ['webm/哈欠连天.webm'], '成功后 image 入宿主 ring')

  // 第二次：客户端 recent 为空，但宿主 ring 会把它从 prompt 候选里排除（软引导）；
  // 若模型仍返回同图，v1.21 起接受（不再 MOOD_AI_UNAVAILABLE）。
  const second = await service.generate({}, { force: true })
  assert.equal(second.ok, true, 'ring 只做 prompt 引导，不硬拒绝')
  assert.equal(second.mood.image, 'webm/哈欠连天.webm')
  const secondPrompt = llm.calls[1].messages[0].content[0].text
  assert.equal(promptCatalogRowFiles(secondPrompt).includes('webm/哈欠连天.webm'), false, 'prompt 已排除 ring 内图片')
  assert.deepEqual(service.peekRecentGenerated(), ['webm/哈欠连天.webm'], '同图去重后仍是一条')

  // 换一张没生成过的图 → 正常成功并继续累积 ring
  const third = await service.generate({}, { force: true })
  assert.equal(third.ok, true)
  assert.equal(third.mood.image, 'webm/吃午餐.webm')
  assert.deepEqual(service.peekRecentGenerated(), ['webm/哈欠连天.webm', 'webm/吃午餐.webm'])

  // 缓存命中不入 ring
  const cached = await service.generate({})
  assert.equal(cached.cached, true)
  assert.equal(service.peekRecentGenerated().length, 2, '缓存命中不重复入 ring')
})

test('mood-ai 服务：宿主生成 ring 最多保留最近 20 张', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const files = catalog.moodImages.map((image) => image.file)
  let calls = 0
  const responder = () => {
    const image = files[calls % files.length]
    calls += 1
    return JSON.stringify({ label: '测试', image, reason: '理由足够长', energy: 50 })
  }
  const { service } = makeMoodAiHarness({ catalog, responder })
  for (let index = 0; index < 25; index += 1) {
    const result = await service.generate({}, { force: true })
    assert.equal(result.ok, true, `第 ${index + 1} 次生成应成功`)
  }
  const ring = service.peekRecentGenerated()
  assert.equal(ring.length, 20, 'ring 上限 20')
  assert.deepEqual(ring, files.slice(5, 25), '只保留最近 20 张')
})

test('memory-journal v1.21：mood 不再限频/去重，每条都写（回忆完整保留）', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const t0 = new Date(2026, 9, 23, 16, 0, 0).getTime()
  let clock = t0
  const journal = createMemoryJournal({ dir, now: () => clock, logger: { warn() {} } })
  const jsonlFile = path.join(dir, 'journal.jsonl')
  const mdFile = path.join(dir, 'journal.md')

  const moodA = { kind: 'mood', label: '开心', image: 'a.webp', reason: 'r1' }
  assert.equal((await journal.append(moodA)).ok, true)
  // 同一时刻、同 image+label 连写 → 都写（不再 same-mood 跳过）
  const second = await journal.append(moodA)
  assert.equal(second.ok, true)
  assert.equal(second.skipped, undefined)
  assert.equal(readJournalJsonl(dir).length, 2)

  // <10min 内不同心情 → 照常写
  clock = t0 + 60 * 1000
  assert.equal((await journal.append({ kind: 'mood', label: '难过', image: 'b.webp', reason: 'r2' })).skipped, undefined)
  clock = t0 + 90 * 1000
  assert.equal((await journal.append({ kind: 'mood', label: '难过', image: 'b.webp', reason: 'r2' })).skipped, undefined)
  const entries = readJournalJsonl(dir)
  assert.equal(entries.length, 4, '每条 mood 都写')
  assert.deepEqual(entries.map((entry) => entry.kind), ['mood', 'mood', 'mood', 'mood'])

  // 仍只追加：已有行逐字保留、md 同步增长
  const lines = fs.readFileSync(jsonlFile, 'utf8').trim().split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], JSON.stringify(entries[0]))
  const md = fs.readFileSync(mdFile, 'utf8')
  assert.equal((md.match(/· 心情/g) ?? []).length, 4, 'md 同步写入 4 条心情')
})

test('memory-journal v1.20：murmur 同文本跳过、3min 限频、thought 永远写', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const t0 = new Date(2026, 9, 23, 16, 0, 0).getTime()
  let clock = t0
  const journal = createMemoryJournal({ dir, now: () => clock, logger: { warn() {} } })
  const sizes = () => ({
    jsonl: fs.statSync(path.join(dir, 'journal.jsonl')).size,
    md: fs.statSync(path.join(dir, 'journal.md')).size,
  })

  assert.equal((await journal.append({ kind: 'murmur', text: '第一句碎碎念' })).ok, true)
  assert.equal(readJournalJsonl(dir).length, 1)

  // 1min 内不同文本 → 跳过
  clock = t0 + 60 * 1000
  const before = sizes()
  const skip = await journal.append({ kind: 'murmur', text: '第二句碎碎念' })
  assert.equal(skip.skipped, true)
  assert.equal(skip.reason, 'murmur-throttled')
  assert.deepEqual(sizes(), before, '跳过时 md/jsonl 都不增长')

  // 满 3min → 写入
  clock = t0 + JOURNAL_MURMUR_MIN_INTERVAL_MS
  assert.equal((await journal.append({ kind: 'murmur', text: '第二句碎碎念' })).skipped, undefined)
  assert.equal(readJournalJsonl(dir).length, 2)

  // 同文本（即使超过 3min）→ 跳过
  clock = t0 + 10 * 60 * 1000
  const sameText = await journal.append({ kind: 'murmur', text: '第二句碎碎念' })
  assert.equal(sameText.skipped, true)
  assert.equal(sameText.reason, 'same-murmur')
  assert.equal(readJournalJsonl(dir).length, 2)

  // thought 永远写（同一文本连写两次也写）
  clock = t0 + 10 * 60 * 1000
  assert.equal((await journal.append({ kind: 'thought', text: '我在想一件事' })).ok, true)
  assert.equal((await journal.append({ kind: 'thought', text: '我在想一件事' })).ok, true)
  assert.equal(readJournalJsonl(dir).length, 4)
  const thoughtEntries = readJournalJsonl(dir).filter((entry) => entry.kind === 'thought')
  assert.equal(thoughtEntries.length, 2, 'thought 不受限频')
})

// ---------------------------------------------------------------------------
// M32：碎碎念降重（recent 12 / 主题轮换 / 反重复 prompt / 表达类型 / 温度 1.0）
// ---------------------------------------------------------------------------

test('self-talk M32：主题列表与随机挑选（注入 random 可确定）', () => {
  assert.ok(SELF_TALK_THEMES.length >= 20, '主题列表足够丰富')
  for (const theme of ['窗外的声音', '杯子', '键盘声', '小时候', '路过的猫', '一首没念出口的诗', '今天没做成的事']) {
    assert.ok(SELF_TALK_THEMES.includes(theme), `主题列表应包含：${theme}`)
  }
  assert.equal(pickSelfTalkTheme(() => 0), SELF_TALK_THEMES[0], 'random=0 → 第一个主题')
  assert.equal(pickSelfTalkTheme(() => 0.999999), SELF_TALK_THEMES.at(-1), 'random≈1 → 最后一个主题')
  assert.ok(SELF_TALK_THEMES.includes(pickSelfTalkTheme()), '默认 random 也返回合法主题')
})

test('self-talk M32：prompt 列出最近 12 条 + 反重复/表达类型指令 + theme 行', () => {
  const recent12 = Array.from({ length: 12 }, (_, index) => `最近第${index}句随想`)
  const prompt = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), recent: recent12, theme: '杯子' })
  const recentLines = prompt.split('\n').filter((line) => line.startsWith('- '))
  assert.equal(recentLines.length, 12, '列出最近 12 条')
  assert.equal(recentLines.at(-1), '- 最近第11句随想')
  assert.match(prompt, /你最近说过的话（不要重复主题\/意象\/开头，也不要改写）：/)
  assert.ok(prompt.includes('这次试着围绕「杯子」说一句'), '包含本轮 theme 提示')
  assert.match(prompt, /不要写成命题作文/)

  // 第 13 条不进入 prompt
  const more = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    recent: [...recent12, '最近第12句多出来的'],
  })
  assert.equal(more.includes('最近第12句多出来的'), false, 'recent 最多 12 条')
  assert.equal(more.includes('这次试着围绕'), false, '未传 theme 时不输出 theme 行')

  // 反重复/话题轮换/表达类型指令（system prompt）
  assert.match(SELF_TALK_SYSTEM_PROMPT, /每一次都要换一个具体的、新的小主题/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /忙碌、疲惫、等待、尾巴、角落、光、云、数字、周五、一整天/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /不要重复你最近说过的句子的主题、意象或开头/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /避免「今天……」「忙了……」「一整天……」「周五……」这类模板化开头/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /表达类型要轮换/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /一句观察、一句吐槽、一个很小的问题、一两句的小故事、一个具体的细节、一个愿望或念头/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /不要每句都是感慨或疲惫/)
})

test('self-talk M32 服务：temperature=1.0，theme 可注入/随机挑，均进入 prompt', async () => {
  // 固定 theme
  const fixedLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const fixedService = createSelfTalkService({
    llm: fixedLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    theme: '台灯',
  })
  const fixedResult = await fixedService.generate({})
  assert.equal(fixedResult.ok, true)
  assert.equal(fixedLlm.calls[0].temperature, 1.0, 'temperature 0.95→1.0')
  assert.ok(fixedLlm.calls[0].messages[0].content[0].text.includes('这次试着围绕「台灯」说一句'))

  // 注入 random：确定地挑到第一个/最后一个主题
  const firstLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const firstService = createSelfTalkService({
    llm: firstLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    random: () => 0,
    themeProbability: 1,
  })
  await firstService.generate({})
  assert.ok(
    firstLlm.calls[0].messages[0].content[0].text.includes(`这次试着围绕「${SELF_TALK_THEMES[0]}」说一句`),
    'random=0 挑第一个主题',
  )

  const lastLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const lastService = createSelfTalkService({
    llm: lastLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    random: () => 0.999999,
    themeProbability: 1,
  })
  await lastService.generate({})
  assert.ok(
    lastLlm.calls[0].messages[0].content[0].text.includes(`这次试着围绕「${SELF_TALK_THEMES.at(-1)}」说一句`),
    'random≈1 挑最后一个主题',
  )
})

// ---------------------------------------------------------------------------
// M34：碎碎念话题库（心情/天气/活动/体验 + 小知识话题轮换）
// ---------------------------------------------------------------------------

function writeTopicsFile(file, topics, extra = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ ok: true, v: 1, updatedAt: new Date().toISOString(), topics, ...extra }),
    'utf8',
  )
  return file
}

function makeTopic(id, title, fact, tags) {
  return { id, title, fact, tags }
}

test('self-talk-topics：resolveTopicsPath（env 覆盖/DSH_HOME/home 回退）', () => {
  assert.equal(resolveTopicsPath({ DSH_SELF_TALK_TOPICS: '/tmp/topics.json' }, '/Users/alice'), '/tmp/topics.json')
  assert.equal(
    resolveTopicsPath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/agent-memory/topics.json',
  )
  assert.equal(resolveTopicsPath({}, '/Users/alice'), '/Users/alice/.dsh/agent-memory/topics.json')
  assert.equal(
    resolveTopicsPath({ DSH_SELF_TALK_TOPICS: '   ' }, '/Users/alice'),
    '/Users/alice/.dsh/agent-memory/topics.json',
    '空白覆盖值忽略',
  )
})

test('self-talk-topics：loadTopicBank mtime 缓存自动重读、坏文件降级保留上次可用', () => {
  const dir = makeTmpDir('dshp-topics')
  const file = writeTopicsFile(path.join(dir, 'topics.json'), [
    makeTopic('t1', '章鱼的三颗心脏', '章鱼有三颗心脏。', ['海洋', '好奇']),
    makeTopic('t2', '抹香鲸的方言', '抹香鲸有方言。', ['海洋', 'social']),
  ])
  const warned = []
  const bank = loadTopicBank({ path: file, logger: { warn: (message) => warned.push(String(message)) } })

  const first = bank.read()
  assert.equal(first.ok, true)
  assert.equal(first.entries.length, 2)
  assert.equal(first.reloaded, true)
  assert.equal(bank.read().reloaded, false, 'mtime 未变直接用缓存')

  // 文件更新（新内容）+ 显式改 mtime → 自动重读
  writeTopicsFile(file, [
    makeTopic('t1', '章鱼的三颗心脏', '章鱼有三颗心脏。', ['海洋', '好奇']),
    makeTopic('t2', '抹香鲸的方言', '抹香鲸有方言。', ['海洋', 'social']),
    makeTopic('t3', '鲸落', '鲸落后形成生态系统。', ['海洋', '平静']),
  ])
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(file, later, later)
  const updated = bank.read()
  assert.equal(updated.ok, true)
  assert.equal(updated.reloaded, true, '文件变化自动重读（无需重载插件）')
  assert.equal(updated.entries.length, 3)

  // 坏 JSON：ok:false 但保留上次可用话题（服务降级不抛）
  fs.writeFileSync(file, 'not json at all', 'utf8')
  const brokenAt = new Date(Date.now() + 10000)
  fs.utimesSync(file, brokenAt, brokenAt)
  const broken = bank.read()
  assert.equal(broken.ok, false)
  assert.equal(broken.entries.length, 3, '坏文件保留上次可用数据')
  assert.ok(warned.length > 0)

  // 修复后恢复
  writeTopicsFile(file, [makeTopic('t9', '新话题', '新事实。', ['天气'])])
  const fixedAt = new Date(Date.now() + 15000)
  fs.utimesSync(file, fixedAt, fixedAt)
  const fixed = bank.read()
  assert.equal(fixed.ok, true)
  assert.deepEqual(fixed.entries.map((entry) => entry.id), ['t9'])

  // 文件缺失 → ok:false、空条目、不抛
  const missing = loadTopicBank({ path: path.join(dir, 'nope.json'), logger: { warn() {} } })
  const missingResult = missing.read()
  assert.equal(missingResult.ok, false)
  assert.deepEqual(missingResult.entries, [])
})

test('self-talk-topics：parseTopicBank 校验/过滤非法条目/去重/空库', () => {
  const parsed = parseTopicBank(
    JSON.stringify({
      ok: true,
      v: 1,
      topics: [
        makeTopic('a', '标题A', '事实A', ['好奇', '海洋']),
        makeTopic('b', '标题B', '事实B', 'not-array'),
        makeTopic('', '无 id', '事实', ['x']),
        makeTopic('c', '', '无标题', ['x']),
        makeTopic('d', '无事实', '', ['x']),
        makeTopic('a', '重复 id', '重复', ['x']),
      ],
    }),
  )
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.entries.map((entry) => entry.id), ['a'])
  assert.equal(parsed.dropped >= 3, true, '记录被过滤条数')

  assert.equal(parseTopicBank('not json').ok, false)
  assert.equal(parseTopicBank(JSON.stringify({ ok: true, v: 2, topics: [] })).ok, false)
  assert.equal(parseTopicBank(JSON.stringify({ ok: true, v: 1, topics: [] })).ok, false, '空话题库视为失败')
  assert.equal(parseTopicBank(JSON.stringify({ ok: true, v: 1 })).ok, false)
})

test('self-talk-topics：pickSelfTalkTopic 按心情/天气/活动/体验/时段打分并排除最近', () => {
  const topics = [
    makeTopic('mood', '心情话题', '事实', ['平静']),
    makeTopic('weather', '天气话题', '事实', ['rain']),
    makeTopic('activity', '活动话题', '事实', ['watch']),
    makeTopic('exp', '体验话题', '事实', ['touched']),
    makeTopic('period', '时段话题', '事实', ['夜里']),
    makeTopic('other', '不相关话题', '事实', ['海洋']),
  ]
  const pick = (context, recentIds = []) => pickSelfTalkTopic(topics, context, recentIds, { random: () => 0 })

  assert.equal(pick({ moodKey: 'calm', moodLabel: '平静' }).id, 'mood', '心情 +3')
  assert.equal(pick({ weather: 'rain' }).id, 'weather', '天气 +3')
  assert.equal(pick({ activity: { kind: 'watch', label: '看视频' } }).id, 'activity', '活动 +3')
  assert.equal(pick({ experience: { kind: 'video', emotion: 'touched' } }).id, 'exp', '体验 +2')
  assert.equal(pick({ period: '夜里' }).id, 'period', '时段 +1')
  assert.equal(scoreSelfTalkTopic(topics[0], { moodKey: 'calm', moodLabel: '平静' }), 3)
  assert.equal(scoreSelfTalkTopic(topics[0], { moodKey: 'curious', moodLabel: '好奇' }), 0)

  // 排除最近 topic：不会选到 mood；其余同分里按稳定序随机
  const afterExclude = pick({ moodKey: 'calm', moodLabel: '平静' }, ['mood'])
  assert.notEqual(afterExclude.id, 'mood')
  assert.ok(['weather', 'activity', 'exp', 'period', 'other'].includes(afterExclude.id))
  // 全部被排除 → 允许全量兜底（仍返回合法 topic）
  const fallback = pick({ moodKey: 'calm', moodLabel: '平静' }, topics.map((topic) => topic.id))
  assert.ok(fallback !== null && topics.some((topic) => topic.id === fallback.id), '全排除时兜底')
  // 空库 → null
  assert.equal(pickSelfTalkTopic([], {}, []), null)
  assert.equal(pickSelfTalkTopic(null, {}, []), null)
  // 接受 loadTopicBank 读取器
  const dir = makeTmpDir('dshp-topics')
  const bank = loadTopicBank({ path: writeTopicsFile(path.join(dir, 'topics.json'), topics), logger: { warn() {} } })
  assert.equal(pickSelfTalkTopic(bank, { weather: 'rain' }, [], { random: () => 0 }).id, 'weather')

  // v1.47：新学话题加权、旧话题不删除仍可选中
  const now = FIXED_NOW.getTime()
  const newLearned = { ...makeTopic('new-learned', '新学的', '新事实', ['海洋']), learned: true, addedAt: now }
  const oldLearned = { ...makeTopic('old-learned', '旧学的', '旧事实', ['海洋']), learned: true, addedAt: now - 90 * 24 * 60 * 60 * 1000 }
  const plain = makeTopic('plain-topic', '普通话题', '普通事实', ['海洋'])
  assert.equal(topicRecencyWeight(newLearned, now), 1 + LEARNED_TOPIC_RECENCY_BONUS)
  assert.equal(topicRecencyWeight(oldLearned, now), 1, '过期后回落到基础权重')
  assert.equal(topicRecencyWeight(plain, now), 1)
  const weighted = [newLearned, oldLearned, plain]
  // 权重：新=3、旧=1、普通=1（总分 5）→ roll=0.1 落在新学；roll=0.9 落在普通/旧但绝不会有消失的
  assert.equal(pickSelfTalkTopic(weighted, {}, [], { random: () => 0.1, now }).id, 'new-learned')
  const late = pickSelfTalkTopic(weighted, {}, [], { random: () => 0.9, now })
  assert.ok(['old-learned', 'plain-topic'].includes(late.id), '旧话题仍在候选池里')
  // 只有旧话题时仍可选（不因“旧”被停用）
  assert.equal(pickSelfTalkTopic([oldLearned], {}, [], { random: () => 0.5, now }).id, 'old-learned')
})

test('self-talk-topics v1.49：L1 冷存储——最旧 learned 归档、不删除、关键词可检索', () => {
  const dir = makeTmpDir('dshp-topics-archive')
  const bankPath = path.join(dir, 'topics.json')
  const archivePath = path.join(dir, 'topics-archive.jsonl')
  assert.equal(resolveTopicsArchivePath({ DSH_HOME: dir }, dir), path.join(dir, 'agent-memory', 'topics-archive.jsonl'))

  fs.writeFileSync(
    bankPath,
    JSON.stringify({
      ok: true,
      v: 1,
      topics: [
        { id: 'curated', title: '外部话题', fact: '外部维护。', tags: ['基础'] },
        { id: 'learned-old', title: '最旧自学', fact: '最旧的事实。', tags: ['海洋'], learned: true, addedAt: 1 },
        { id: 'learned-mid', title: '中间自学', fact: '中间的事实。', tags: ['动物'], learned: true, addedAt: 2 },
        { id: 'learned-new', title: '最新自学', fact: '最新的事实。', tags: ['科技'], learned: true, addedAt: 3 },
      ],
    }),
    'utf8',
  )
  const compacted = compactTopicBankForArchive({ path: bankPath, archivePath, maxLearned: 2, now: 1_800_000_000_000 })
  assert.equal(compacted.ok, true)
  assert.equal(compacted.archived, 1, '只溢出 1 条')
  assert.equal(compacted.active, 3)
  const activeIds = JSON.parse(fs.readFileSync(bankPath, 'utf8')).topics.map((topic) => topic.id)
  assert.deepEqual(activeIds, ['curated', 'learned-mid', 'learned-new'], '外部条目与较新自学保留')
  const archived = JSON.parse(fs.readFileSync(archivePath, 'utf8').trim().split('\n')[0])
  assert.equal(archived.id, 'learned-old')
  assert.equal(archived.archivedAt, 1_800_000_000_000)
  assert.equal('learned-old' in Object.fromEntries(activeIds.map((id) => [id, true])), false)

  // 归档仍可被关键词检索（旧知识没有消失）
  const found = searchArchivedTopics({ path: archivePath, keywords: ['海洋'], limit: 2 })
  assert.equal(found.length, 1)
  assert.equal(found[0].id, 'learned-old')
  assert.deepEqual(searchArchivedTopics({ path: archivePath, keywords: ['编程'], limit: 2 }), [])
  assert.deepEqual(searchArchivedTopics({ path: archivePath, keywords: [], limit: 2 }), [])

  // 再次压缩：learned 未超限 → 不重复归档
  const again = compactTopicBankForArchive({ path: bankPath, archivePath, maxLearned: 2 })
  assert.equal(again.ok, true)
  assert.equal(again.archived, 0)
})

test('self-talk-topics：top8 随机窗口 + buildTopicPromptLine 内容', () => {
  const topics = Array.from({ length: 10 }, (_, index) => makeTopic(`t${index}`, `标题${index}`, `事实${index}`, ['海洋']))
  // 同分时稳定序 → top8 是前 8 个；random≈0/≈1 分别取 top 内首/尾
  assert.equal(pickSelfTalkTopic(topics, {}, [], { random: () => 0 }).id, 't0')
  assert.equal(pickSelfTalkTopic(topics, {}, [], { random: () => 0.999999 }).id, `t${SELF_TALK_TOPIC_TOP_N - 1}`)
  assert.equal(SELF_TALK_TOPIC_TOP_N, 8)

  const line = buildTopicPromptLine({ title: '章鱼的三颗心脏', fact: '章鱼有三颗心脏。' })
  assert.match(line, /你最近学到的一个小知识：〈章鱼的三颗心脏〉——章鱼有三颗心脏。/)
  assert.match(line, /不要科普腔/)
  assert.match(line, /不要照本宣科/)
  assert.match(line, /不要编造事实/)
  assert.equal(buildTopicPromptLine(null), '')
})

test('self-talk-topics：自学话题免审核并入话题库（learned 标记/去重/cap/外部条目保留）', () => {
  const dir = makeTmpDir('dshp-topics-promote')
  const bankPath = path.join(dir, 'topics.json')
  const writeBank = (topics) =>
    fs.writeFileSync(bankPath, JSON.stringify({ ok: true, v: 1, updatedAt: 'x', topics }), 'utf8')
  writeBank([
    { id: 'curated', title: '外部话题', fact: '外部维护。', tags: ['基础'] },
    { id: 'old-learned', title: '旧自学', fact: '旧的。', tags: ['自学'], learned: true, addedAt: 1 },
  ])

  const first = mergeLearnedTopicIntoBank({
    path: bankPath,
    topic: { id: 'octopus-hearts', title: '章鱼三颗心', fact: '章鱼有三颗心脏。', tags: ['海洋'] },
    now: 1_700_000_000_000,
  })
  assert.equal(first.ok, true)
  assert.equal(first.added, true)
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'))
  assert.deepEqual(bank.topics.map((topic) => topic.id), ['curated', 'old-learned', 'octopus-hearts'])
  assert.equal(bank.topics[2].learned, true)
  assert.equal(bank.topics[2].addedAt, 1_700_000_000_000)
  assert.equal(bank.topics[0].learned, undefined, '外部条目不带 learned 标记')

  // 重复 id → 不重复添加
  assert.deepEqual(
    mergeLearnedTopicIntoBank({
      path: bankPath,
      topic: { id: 'octopus-hearts', title: '章鱼三颗心', fact: '章鱼有三颗心脏。', tags: ['海洋'] },
    }),
    { ok: true, added: false, reason: 'duplicate', bankSize: 3 },
  )

  // v1.47：学过的所有话题都存储，只增不删（新学旧学都保留在话题库）
  const many = Array.from({ length: 320 }, (_, index) => ({
    id: `learned-${index}`,
    title: `旧知识${index}`,
    fact: `旧事实${index}`,
    tags: ['自学'],
    learned: true,
    addedAt: 1_600_000_000_000 + index,
  }))
  writeBank([{ id: 'curated', title: '外部话题', fact: '外部维护。', tags: ['基础'] }, ...many])
  const newest = mergeLearnedTopicIntoBank({
    path: bankPath,
    topic: { id: 'newest-topic', title: '新话题', fact: '新的事实。', tags: ['自学'] },
    now: 1_800_000_000_000,
  })
  assert.equal(newest.ok, true)
  assert.equal(newest.added, true)
  const allIds = JSON.parse(fs.readFileSync(bankPath, 'utf8')).topics.map((topic) => topic.id)
  assert.equal(allIds.length, 322, '外部条目 + 320 条旧知识 + 新知识全部保留')
  assert.ok(allIds.includes('curated') && allIds.includes('learned-0') && allIds.includes('newest-topic'))

  // 非法 topic / 缺路径
  assert.equal(mergeLearnedTopicIntoBank({ path: bankPath, topic: { id: 'broken' } }).ok, false)
  assert.equal(mergeLearnedTopicIntoBank({ path: '', topic: { id: 'x', title: 'x', fact: 'x', tags: ['x'] } }).ok, false)
})

test('self-talk：prompt 综合心情/天气/体验 + 话题 fact（对话数据不进入）', () => {
  const topic = { id: 't1', title: '章鱼的三颗心脏', fact: '章鱼有三颗心脏。' }
  const prompt = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    weather: 'rain',
    moodKey: 'curious',
    moodLabel: '好奇',
    activity: { kind: 'read', label: '查资料/学习' },
    stats: { userMessages: 12, toolCalls: 34 },
    idleMinutes: 8,
    selfState: { felt: '有点犯困，但心里松下来了。', experiencing: '在听雨声，想一段旧事。' },
    topic,
    theme: '杯子',
    recent: ['最近说过的一句话'],
  })
  assert.equal(prompt.includes('你最近在做'), false, 'v1.58：activity 不进入 prompt')
  assert.equal(prompt.includes('用户消息'), false, 'v1.58：stats 不进入 prompt')
  assert.equal(prompt.includes('距上次和用户互动'), false, 'v1.58：idle 不进入 prompt')
  assert.match(prompt, /你此刻的状态：有点犯困，但心里松下来了。/)
  assert.match(prompt, /你最近在体会\/琢磨：在听雨声，想一段旧事。/)
  assert.match(prompt, /章鱼的三颗心脏/)
  assert.match(prompt, /章鱼有三颗心脏。/)
  assert.match(prompt, /综合你此刻的心情、天气、最近在体验的内容（如有）以及上面的小知识/)
  assert.match(prompt, /不要变成科普/)
  assert.equal(prompt.includes('这次试着围绕'), false, '有 topic 时 theme 仅作 fallback 不输出')

  const noTopic = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), theme: '杯子' })
  assert.match(noTopic, /这次试着围绕「杯子」说一句/)
  assert.equal(noTopic.includes('你最近在做'), false)
  assert.equal(noTopic.includes('你最近在体验'), false)
})

test('self-talk 服务：每次挑一个 topic、成功后记 recent、下次排除（失败不记）', async () => {
  const topics = [
    makeTopic('t1', '话题一', '事实一。', ['好奇']),
    makeTopic('t2', '话题二', '事实二。', ['平静']),
  ]
  let reply = SELF_TALK_LINES_A.join('\n')
  const llm = makeMockLlm(() => reply)
  const service = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    topics,
    topicsEnabled: true,
    random: () => 0,
  })

  const first = await service.generate({ moodKey: 'curious', moodLabel: '好奇' })
  assert.equal(first.ok, true)
  assert.match(llm.calls[0].messages[0].content[0].text, /事实一。/)
  assert.deepEqual(service.recentTopics(), ['t1'])

  // 换一批不重复的句子，避免被 recent 去重过滤
  reply = SELF_TALK_LINES_B.join('\n')
  const second = await service.generate({ moodKey: 'curious', moodLabel: '好奇' })
  assert.equal(second.ok, true)
  assert.match(llm.calls[1].messages[0].content[0].text, /事实二。/)
  assert.match(llm.calls[1].messages[0].content[0].text, /你最近学到的一个小知识/)
  assert.deepEqual(service.recentTopics(), ['t1', 't2'])
  assert.equal(service.recentTopics().length <= SELF_TALK_TOPIC_RECENT_MAX, true)

  // 失败不记录 topic
  reply = ''
  const failed = await service.generate({})
  assert.equal(failed.ok, false)
  assert.deepEqual(service.recentTopics(), ['t1', 't2'], '失败不记 topic')
})

test('self-talk 路由 v1.59：不读外部文件，只传她自己的状态/记忆上下文', async () => {
  const captured = []
  const stub = {
    async generate(context) {
      captured.push(context)
      return { ok: true, lines: [{ text: '测试句子，长度足够吧。', ts: 1 }], model: { provider: 'p', model: 'm' }, generatedAt: 1, cached: false }
    },
  }
  const expDir = makeTmpDir('dshp-exp-self-talk')
  const expFile = path.join(expDir, 'experience.json')
  writeExperienceFile(expFile, {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    at: FIXED_NOW.getTime() - 5 * 60 * 1000,
  })
  const harness = createHarness({ selfTalkService: stub, env: { DSH_POETRY_EXPERIENCE: expFile } })
  const sensitive = 'SECRET_TOOL_ARG_NEVER_LEAK'
  harness.moodTracker.record(
    { id: 's1' },
    {
      type: 'tool/call',
      time: FIXED_NOW.getTime(),
      data: { name: 'web_fetch', callId: 'c1', arguments: { url: `https://secret.example/${sensitive}` } },
    },
  )
  const response = await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  assert.equal('activity' in captured[0], false, 'v1.58：不传工具活动')
  assert.equal('stats' in captured[0], false, 'v1.58：不传会话统计')
  assert.equal('experience' in captured[0], false, 'v1.59：不传外部体验文件')
  assert.equal(JSON.stringify(captured[0]).includes(sensitive), false, '工具参数不进入 service 上下文')
})

test('index.js：加载话题库并注入 self-talk（mtime 文件、无新路由）', async () => {
  const dshHome = makeTmpDir('dshp-dshhome-topics')
  const topicsFile = writeTopicsFile(path.join(dshHome, 'agent-memory', 'topics.json'), [
    makeTopic('t1', '章鱼的三颗心脏', '章鱼有三颗心脏。', ['好奇']),
  ])
  const previousDshHome = process.env.DSH_HOME
  const previousTopics = process.env.DSH_SELF_TALK_TOPICS
  const previousTalkTopics = process.env.DSH_POETRY_TALK_TOPICS
  process.env.DSH_HOME = dshHome
  process.env.DSH_POETRY_TALK_TOPICS = 'on'
  delete process.env.DSH_SELF_TALK_TOPICS
  try {
    const routes = []
    const cleanups = []
    const logs = []
    const llm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
    const fakeCtx = {
      logger: {
        info: (message) => logs.push(String(message)),
        warn: (message) => logs.push(String(message)),
        error() {},
      },
      on() {
        return () => {}
      },
      effect(execute) {
        const disposer = execute()
        cleanups.push(disposer)
        return disposer
      },
      inject(_keys, callback) {
        callback({
          get(name) {
            if (name === 'webServer') {
              return {
                register(route) {
                  routes.push(route)
                  return () => {}
                },
              }
            }
            if (name === 'connection') return { requestRejection: () => undefined }
            if (name === 'llm') return llm
            if (name === 'agentDefaultModel') {
              return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
            }
            return undefined
          },
          effect(execute) {
            const disposer = execute()
            cleanups.push(disposer)
            return disposer
          },
        })
      },
    }
    await pluginApply(fakeCtx)
    assert.equal(routes.length, 29, 'assets + pet-media + self + project-action + project-detail + works + works-media + manual-read + presence + twin + chat + attention + memory + model-errors + 13 JSON')
    assert.ok(logs.some((line) => line.includes('碎碎念话题库')), '启动日志打印话题库')
    assert.ok(logs.some((line) => line.includes('1 个话题')), '日志包含话题数量')

    const route = routes.find((item) => item.path === '/api/dsh-poetry/self-talk.json')
    const response = new MockResponse()
    await route.handler(mockRequest({ url: '/api/dsh-poetry/self-talk.json' }), response)
    await response.finished()
    assert.equal(response.json().ok, true)
    const prompt = llm.calls[0].messages[0].content[0].text
    assert.match(prompt, /章鱼的三颗心脏/)
    assert.match(prompt, /章鱼有三颗心脏。/)
    assert.match(prompt, /综合你此刻的心情/)
    assert.equal(fs.existsSync(topicsFile), true)

    for (const cleanup of cleanups.reverse()) {
      if (typeof cleanup === 'function') cleanup()
    }
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    if (previousTopics === undefined) delete process.env.DSH_SELF_TALK_TOPICS
    else process.env.DSH_SELF_TALK_TOPICS = previousTopics
    if (previousTalkTopics === undefined) delete process.env.DSH_POETRY_TALK_TOPICS
    else process.env.DSH_POETRY_TALK_TOPICS = previousTalkTopics
  }
})

// ---------------------------------------------------------------------------
// M35：碎碎念感知心情理由与立绘/动画（双向联动）
// ---------------------------------------------------------------------------

test('self-talk M35：prompt 含心情 label/理由/立绘（label 或 basename）与联动指令', () => {
  const prompt = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    weather: 'rain',
    moodKey: 'happy',
    moodLabel: '开心',
    moodReason: '看到蓝鲸出现，心里一下子软了',
    image: 'webm/蓝鲸现世.webm',
    imageLabel: '蓝鲸现世',
    recent: ['最近说过的一句话'],
  })
  assert.match(prompt, /你此刻的心情：happy（开心）。/)
  assert.match(prompt, /此刻心情的理由：看到蓝鲸出现，心里一下子软了。/)
  assert.match(prompt, /你现在展示的立绘\/动画：蓝鲸现世（webm\/蓝鲸现世\.webm）。/)
  assert.match(prompt, /让这句自言自语和你此刻的心情、表情\/动作、展示的画面自然对得上/)
  assert.match(prompt, /可以轻轻提到画面里的动作\/表情\/光线/)
  assert.match(prompt, /不要提文件名、路径或技术细节，也不要生硬描述画面/)
  // 原有上下文仍在
  assert.match(prompt, /你最近说过的话/)

  // 没有 imageLabel 时用 basename
  const noLabel = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    image: 'webm/哈欠连天.webm',
  })
  assert.match(noLabel, /你现在展示的立绘\/动画：哈欠连天\.webm（webm\/哈欠连天\.webm）。/)

  // 无 image → 不输出立绘行/联动指令
  const noImage = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    moodKey: 'calm',
    moodLabel: '平静',
    moodReason: '只是觉得安静很好',
  })
  assert.match(noImage, /你此刻的心情：calm（平静）。/)
  assert.match(noImage, /此刻心情的理由：只是觉得安静很好。/)
  assert.equal(noImage.includes('你现在展示的立绘/动画'), false)
  assert.equal(noImage.includes('让这句自言自语和你此刻的心情'), false)
})

test('self-talk M35 路由：解析并传递 moodLabel/moodReason/image/imageLabel（截断/缺失/webm 路径）', async () => {
  const captured = []
  const stub = {
    async generate(context) {
      captured.push(context)
      return { ok: true, lines: [{ text: '这是一句长度足够的测试句子。', ts: 1 }], model: { provider: 'p', model: 'm' }, generatedAt: 1, cached: false }
    },
  }
  const harness = createHarness({ selfTalkService: stub })

  const image = 'webm/蓝鲸现世.webm'
  const fullUrl =
    '/api/dsh-poetry/self-talk.json?mood=happy&moodLabel=' +
    encodeURIComponent('开心') +
    '&moodReason=' +
    encodeURIComponent('看到蓝鲸出现，心里一下子软了') +
    '&image=' +
    encodeURIComponent(image) +
    '&imageLabel=' +
    encodeURIComponent('蓝鲸现世')
  await harness.call('self-talk.json', mockRequest({ url: fullUrl }))
  assert.equal(captured[0].moodKey, 'happy')
  assert.equal(captured[0].moodLabel, '开心')
  assert.equal(captured[0].moodReason, '看到蓝鲸出现，心里一下子软了')
  assert.equal(captured[0].image, image, 'webm/ 完整相对路径保留')
  assert.equal(captured[0].imageLabel, '蓝鲸现世')

  // 缺失字段 → null
  await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.equal(captured[1].moodLabel, null)
  assert.equal(captured[1].moodReason, null)
  assert.equal(captured[1].image, null)
  assert.equal(captured[1].imageLabel, null)

  // 超长截断 + 白名单外字段不传递
  const longLabel = '标'.repeat(30)
  const longReason = '理'.repeat(90)
  const longImage = `webm/${'图'.repeat(130)}.webm`
  const longImageLabel = '画'.repeat(30)
  const truncatedUrl =
    '/api/dsh-poetry/self-talk.json?moodLabel=' +
    encodeURIComponent(longLabel) +
    '&moodReason=' +
    encodeURIComponent(longReason) +
    '&image=' +
    encodeURIComponent(longImage) +
    '&imageLabel=' +
    encodeURIComponent(longImageLabel) +
    '&sessionMessages=' +
    encodeURIComponent('SECRET_SESSION_TEXT')
  await harness.call('self-talk.json', mockRequest({ url: truncatedUrl }))
  assert.equal(Array.from(captured[2].moodLabel).length, 24)
  assert.equal(Array.from(captured[2].moodReason).length, 80)
  assert.equal(Array.from(captured[2].image).length, 120)
  assert.equal(Array.from(captured[2].imageLabel).length, 24)
  assert.equal(JSON.stringify(captured[2]).includes('SECRET_SESSION_TEXT'), false, '白名单外字段不传递')
})

test('self-talk M35 服务：生成请求的 prompt 含心情理由/立绘与联动指令', async () => {
  const { llm, service } = makeSelfTalkHarness()
  const result = await service.generate({
    moodKey: 'touched',
    moodLabel: '感动',
    moodReason: '看完蓝鲸那段，眼睛有点热',
    image: 'webm/蓝鲸现世.webm',
    imageLabel: '蓝鲸现世',
  })
  assert.equal(result.ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /你此刻的心情：touched（感动）。/)
  assert.match(prompt, /此刻心情的理由：看完蓝鲸那段，眼睛有点热。/)
  assert.match(prompt, /你现在展示的立绘\/动画：蓝鲸现世（webm\/蓝鲸现世\.webm）。/)
  assert.match(prompt, /不要提文件名、路径或技术细节/)
})

// ---------------------------------------------------------------------------
// M37：心情词汇扩展（细腻人类情绪词 + prompt 引导）
// ---------------------------------------------------------------------------

test('mood-ai M37：细腻情绪词库导出 ≥20 且 prompt 引导细情绪词/≤12/不硬造', () => {
  assert.ok(Array.isArray(MOOD_AI_EMOTION_VOCAB), 'MOOD_AI_EMOTION_VOCAB 是数组')
  assert.ok(MOOD_AI_EMOTION_VOCAB.length >= 20, `词库长度 ${MOOD_AI_EMOTION_VOCAB.length} ≥ 20`)
  const expected = [
    '怅然', '眷恋', '释然', '雀跃', '忐忑', '倦怠', '惊奇', '羞赧', '怀念', '笃定',
    '心软', '空落', '满足', '惶惑', '温柔', '烦躁', '期待', '失落', '松弛', '鼻酸',
    '被戳中', '想撒娇', '想安静', '想被看见', '有点委屈', '暗自得意', '淡淡的遗憾',
  ]
  for (const word of expected) assert.ok(MOOD_AI_EMOTION_VOCAB.includes(word), `词库包含：${word}`)
  for (const word of MOOD_AI_EMOTION_VOCAB) {
    assert.equal(typeof word, 'string')
    assert.ok(Array.from(word).length >= 1 && Array.from(word).length <= 12, `词条 ${word} 长度 ≤12`)
  }

  // system prompt 引导
  assert.match(MOOD_AI_SYSTEM_PROMPT, /心情标签可以比图鉴标签更细：优先用人类会用的细情绪词/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /如：怅然、眷恋、释然/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要每轮都只用「开心\/难过\/累\/烦」这种粗词/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /label 仍须 ≤12 个汉字/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /必须和 reason、所选 image 的气氛一致/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要为新颖而硬造生僻词/)
  // 既有规则未回归
  assert.match(MOOD_AI_SYSTEM_PROMPT, /优先从 media=video 的动画里选/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要连续选同一张图或同一个动作/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /情绪匹配优先于活动匹配/)

  // parse：细情绪词/粗词都可（≤12 字），超长仍拒绝
  const catalog = makeMoodCatalogFixture()
  const image = catalog.moodImages[0].file
  const options = { dateKey: '2026-10-21' }
  for (const label of ['怅然', '想被看见', '开心', '有点委屈']) {
    const parsed = parseMoodResult(
      JSON.stringify({ label, image, reason: '理由足够长', energy: 50 }),
      catalog,
      options,
    )
    assert.equal(parsed.ok, true, `label「${label}」应通过`)
    assert.equal(parsed.mood.label, label)
  }
  const tooLong = parseMoodResult(
    JSON.stringify({ label: '特别特别特别长的情绪标签呀', image, reason: '理由足够长', energy: 50 }),
    catalog,
    options,
  )
  assert.equal(tooLong.ok, false, '超过 12 字仍拒绝')
})
