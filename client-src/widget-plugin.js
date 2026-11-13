import { clamp, isVideoMoodFile, num, readWindowHeight, readWindowWidth } from './base.js'
import { createHooks } from './hooks.js'
import { createPanelTabRouter } from './panel-tabs.js'
import { createTwinOverlay } from './twin-overlay.js'
import { normalizeHealthStatus } from './health-model.js'
import {
  DEFAULT_SETTINGS,
  WRITE_KEYS,
  normalizeSettings,
  settingsPatch,
  buildSettingsRequest,
  createSettingsSaver,
  selectNextPoemId,
} from './settings-model.js'
import {
  TONE_QUATRAINS,
  isPunctuation,
  toneKindOf,
  buildToneCells,
  selectPoemText,
  selectCiText,
  poemRhymeLines,
  buildPingshuiIndex,
  annotatePoemLines,
  patternForShape,
  allowedRelation,
  rhymeSetOf,
  detectMetre,
  detectPoem,
  parsePoemInput,
  detectPoemText,
  formatDetectionReport,
  detectionRhymeIndexes,
} from './poetry-engine.js'
import {
  SELF_TALK_PATH,
  SELF_TALK_RECENT_MAX,
  SELF_TALK_TIMEOUT_MS,
  SPONT_AUTO_CLOSE_MS,
  SPONT_CLOSE_RECHECK_MS,
  SPONT_EVENT_MAX_MS,
  SPONT_EVENT_MIN_MS,
  SPONT_KEY,
  SPONT_MAX_SEEN,
  SPONT_POLL_MAX_MS,
  SPONT_POLL_MIN_MS,
  SPONT_QUIET_MS,
  SPONT_REPEAT_MS,
  SPONT_RETRY_MS,
  SPONT_SEEN_DAYS,
  canShowSpontaneous,
  countSpontHits,
  nextSpontEventDelay,
  nextSpontPollDelay,
  normalizeSpontState,
  parseSelfTalkResponse,
  pickSentenceFromLines,
  recordSpontShown,
  selfTalkKindFor,
  selfTalkNoveltySignature,
  selfTalkQuery,
  splitCompleteSentences,
} from './self-talk-client.js'
import {
  MOOD_AI_DEBOUNCE_MAX_MS,
  MOOD_AI_DEBOUNCE_MIN_MS,
  MOOD_AI_KEEP_MS,
  MOOD_AI_MAX_RETRIES,
  MOOD_AI_MIN_GAP_MS,
  MOOD_AI_PATH,
  MOOD_AI_RECENT_IMAGES_MAX,
  MOOD_AI_RECENT_MAX,
  MOOD_AI_RETRY_MAX_MS,
  MOOD_AI_RETRY_MIN_MS,
  MOOD_AI_TIMEOUT_MS,
  MOOD_IMAGES,
  MOOD_LABELS,
  MOOD_PANEL_PEEK_FILES,
  MOOD_REFRESH_MS,
  MOOD_STRONG,
  MOOD_SWITCH_MIN_MS,
  MOOD_TICK_MS,
  SHANGHAI_OFFSET_MS,
  computeMood,
  emptyMoodStats,
  isMoodAiSignificant,
  moodAiEventDelay,
  moodAiFailureLabel,
  moodAiKeepDecision,
  moodAiQuery,
  moodAiSnapshot,
  moodBasisText,
  moodCatalogAllows,
  moodTimeBucket,
  nextMoodAiDebounceDelay,
  nextMoodAiRetryDelay,
  normalizeMoodAiFailure,
  normalizeMoodCatalog,
  normalizeMoodStats,
  panelPeekFile,
  parseMoodAiResponse,
  shanghaiParts,
  throttleMoodSwitch,
} from './mood-engine.js'
import { createPoetryTabs } from './tabs-poetry.js'
import { createSettingsTab } from './tabs-settings.js'
import { createGrowthTab } from './tabs-growth.js'
import { createGraphTab } from './tabs-graph.js'
import { createFeihuaTab } from './tabs-feihua.js'
import { createLibraryTab } from './tabs-library.js'
import {
  FEIHUA_ATLAS_LIMIT,
  FEIHUA_CANDIDATE_CHARS,
  FEIHUA_CANDIDATE_LIMIT,
  FEIHUA_MIN_ENTRIES,
  buildFeihuaIndex,
  completeSentencesFromLines,
  feihuaBestUpdate,
  feihuaLookup,
  feihuaPickSystem,
  feihuaPlainOf,
  feihuaRandomIndex,
  feihuaSampleUnique,
  feihuaShuffle,
  feihuaSourceOf,
  feihuaStart,
  feihuaSubmit,
  finishFeihuaIndex,
  mergeFeihuaFullEntries,
  mergeFeihuaItems,
  normalizeFeihuaBest,
  registerFeihuaLookup,
} from './feihua.js'
import {
  LIBRARY_CATEGORY_ALIASES,
  LIBRARY_PAGE,
  buildLibraryItems,
  ciBankRhythmics,
  ciSelectedLibraryItems,
  ciSelectedRhythmics,
  filterLibraryItems,
  libraryCategoryOf,
  libraryItemLabel,
  libraryPage,
} from './library.js'
import { CSS } from './styles.js'
import {
  WANDER_FIRST_MAX_MS,
  WANDER_FIRST_MIN_MS,
  WANDER_INTERACTION_PAUSE_MS,
  WANDER_MAX_INTERVAL_MS,
  WANDER_MIN_DISTANCE,
  WANDER_MIN_INTERVAL_MS,
  WANDER_STATIC_FILE,
  WANDER_TICK_MS,
  WANDER_WALK_MS,
  WINDOW_WANDER_ENABLED,
  nextWanderTarget,
  pickWanderMedia,
} from './wander.js'
import { clearFirstScreenCache, createFetchJson, fetchJsonUrl, getStorage, readFirstScreenCache, writeFirstScreenCache } from './data.js'
import {
  MASCOT_EGG_KEY,
  POS_KEY,
  normalizeMascotEggState,
  readMascotEggState,
  readStoredPosition,
  recordMascotEgg,
  writeMascotEggState,
  writeStoredPosition,
} from './local-state.js'
import { RESOURCE_CACHE_KEYS, createResourceStore } from './resources.js'

import {
 ROUTE,
 SELF_PATH,
 SELF_POLL_MS,
 ACTION_SEEN_KEY,
 MEMORY_PATH,
 HEALTH_PATH,
 WORKS_PATH,
 ATTENTION_PATH,
 PROJECT_ACTION_PATH,
 PROJECT_PATH,
 TWIN_PATH,
 PRESENCE_PATH,
 PRESENCE_THROTTLE_MS,
 WORKS_POLL_MS,
 GROWTH_PATH,
 GROWTH_POLL_MS,
 ATTENTION_POLL_MS,
 TWIN_POLL_MS,
 HEALTH_POLL_MS,
 MEMORY_BACKUP_PATH,
 MEMORY_POLL_MS,
 ASSET_BASE,
 WIDGET_ID,
 BASE_SIZE,
 Z_INDEX,
 SAVE_DEBOUNCE_MS,
 STEPS,
 POETRY_ENTRY_ENABLED,
 POETRY_TABS,
 FEIHUA_BEST_KEY,
 FEIHUA_ATLAS_PAGE,
 FEIHUA_FULL_PATH,
 FEIHUA_FULL_TIMEOUT_MS,
 FEIHUA_FULL_RETRY_MS,
 MASCOT_FILES,
 MASCOT_TRANSIENT_MS,
 WEATHER_REFRESH_MS,
 WEATHER_STALE_MS,
 WEATHER_POOL_LIMIT,
 PET_MEDIA_PATH,
 PET_MEDIA_CATALOG_FILE,
 PET_MEDIA_TIMEOUT_MS,
 MOTION_ROTATION_KEY,
 MOTION_MIN_DELAY_MS,
 MOTION_MAX_DELAY_MS,
 MOTION_PLAY_MIN_MS,
 MOTION_PLAY_MAX_MS,
 MOTION_FIRST_MIN_DELAY_MS,
 MOTION_FIRST_MAX_DELAY_MS,
 DIZZY_MIN_MS,
 DIZZY_MAX_MS,
 DIZZY_FAST_PX_PER_SEC,
 DIZZY_FAST_DISTANCE_PX,
 DIZZY_FAST_WINDOW_MS,
 MEAL_KEY,
 MEAL_PLAY_MIN_MS,
 MEAL_PLAY_MAX_MS,
 ASSET_DATA_FILES,
 LIBRARY_CATEGORIES,
 MASCOT_EXPRESSION_MS,
 MASCOT_IDLE_MIN_MS,
 MASCOT_IDLE_USER_MS,
 MASCOT_IDLE_POLL_MS,
 MASCOT_EXPRESSION_FILES,
 RESOURCE_PATHS,
} from "./widget/models/constants.js"
import {
 cx,
 hasOwn,
 hashString,
 formatDateLabel,
 clampPosition,
 anchorPosition,
 describeDataError,
} from "./widget/models/utils.js"
import {
 clearFeihuaFullCache,
 readFeihuaFullCache,
 abortFeihuaFull,
 requestFeihuaFull,
 getFeihuaIndex,
 clearFeihuaIndexCache,
 pickDefaultFeihuaChar,
 readFeihuaBest,
 writeFeihuaBest,
} from "./widget/models/feihua-model.js"
import {
 weatherCache,
 weatherPoemTags,
 countWeatherTagHits,
 buildWeatherPoemPool,
 selectWeatherPoemEntry,
 weatherChipText,
 weatherExplainText,
 weatherUpdatedLabel,
 requestWeather,
} from "./widget/models/weather-model.js"
import {
 mascotStateFor,
 mascotFileFor,
 mascotUrl,
 mascotImageFor,
 mascotVideoShouldPause,
 detectFastDrag,
 nextDizzyDuration,
 nextMealDuration,
 mealMomentFor,
 normalizeMealState,
 readMealState,
 writeMealState,
 markMealDone,
 mealTriggerFor,
 pickDizzyMedia,
 pickMealMedia,
 mascotFilePriority,
 petMediaUrl,
 normalizePetMediaCatalog,
 mergePetMediaIntoCatalog,
 clearPetMediaCache,
 requestPetMediaCatalog,
 readMotionRotation,
 writeMotionRotation,
 nextMotionEntry,
 nextMotionDelay,
 nextMotionFirstDelay,
 nextMotionScheduleDelay,
 nextMotionDuration,
 shouldShowDailyGreet,
 canShowIdlePose,
 pickMascotExpression,
} from "./widget/models/mascot-model.js"
import {
 moodCache,
 requestMoodAi,
} from "./widget/models/mood-model.js"
import {
 normalizeSelfStatus,
 normalizeSelfAction,
 readSeenActionId,
 writeSeenActionId,
 selfStatusSummary,
 normalizeMemoryStatus,
 normalizeWorks,
 normalizeAttention,
 normalizeTwinState,
} from "./widget/models/self-model.js"
import {
 readSpontState,
 writeSpontState,
 requestSelfTalk,
} from "./widget/models/spont-model.js"
import {
 assetUrlFor,
 fetchJson,
 putSettings,
} from "./widget/models/api.js"
import { setRuntime } from './widget/runtime.js'
import {
  AnalysisBody,
  CiBody,
  EmptyState,
  KnowledgeCardView,
  LoadingState,
  PoemBody,
  ToneLine,
  growthMetricsTree,
  switchNode,
} from './widget/view/primitives.js'
import { BubbleView } from './widget/view/bubble-view.js'
import { MascotView } from './widget/view/mascot-view.js'
import { MealTipView } from './widget/view/meal-tip.js'
import { PanelView } from './widget/view/panel-view.js'
import { RestoreHotspotView } from './widget/view/restore-hotspot.js'
import { SpontView } from './widget/view/spont-view.js'
import { ToastView } from './widget/view/toast-view.js'
import { WidgetRoot } from './widget/view/widget-root.js'
import { StepContent } from './widget/view/steps/index.js'

/**
 * dsh-little-whale —— 浏览器半边（M9：诗词挂件 / 天气选诗 / 飞花令 / 心情彩蛋 / 诗库 / 格律检测）。
 *
 * 形态：官方 Client 插件（`dsh.client`）→ `window.__ModuleLoader__.load({ id, factory })`

window.__ModuleLoader__.load({ id, factory })`
 *       → `ctx.slots.inject('shell.overlay')` 注册 order=80 的浮层挂件。
 *       纯 React.createElement，无 JSX、无构建步骤；样式通过组件内 <style> 注入。
 *
 * 数据：只读宿主路由 `/api/dsh-poetry/*`（契约见 docs/contract.md），模块级缓存 +
 *       localStorage 仅用于「首屏缓存」（按 dataVersion 失效）。任何请求失败都渲染
 *       友好空态 + 重试按钮，不抛出到 React 树之外（另有 ErrorBoundary 兜底）。
 *
 * 交互：形象悬浮/拖拽/吸附/缩放（按天气与对局状态切换 92 张立绘）；点击推进 6 步气泡
 *       （诗 → 解析 → 知识 → 韵部 → 词牌 → 飞花令 → 收起）；主面板 2 tab（成长/设置），
 *       诗词模块与它的配置降权到「成长 → 诗词」二级菜单；设置 PUT 防抖持久化；隐藏后长按角落热区或
 *       双击空白处恢复；心情换装（按当日会话统计/天气/时段，≥20min 限频）与 8–15min「自言自语」模型随想
 *       （每日 ≤3 次、7 天不重句，localStorage 记录）。全部圆点/文案中文，主题只用宿主 `--dsw-alias-*` 变量（含 fallback）。
 */

window.__ModuleLoader__.load({
 id: 'dsh-little-whale',
 factory: (require) => {
  'use strict'

  const React = require('react')
  if (!React || typeof React.createElement !== 'function') {
  throw new Error('dsh-little-whale: React 运行时不可用')
  }
  const h = React.createElement
  setRuntime({ React, h })

  const resourceStore = createResourceStore({
    fetchJsonUrl,
    route: ROUTE,
    assetDataFiles: ASSET_DATA_FILES,
    resourcePaths: RESOURCE_PATHS,
    assetUrlFor,
    clearFeihuaIndexCache,
    clearFeihuaFullCache,
    clearPetMediaCache,
  })
  const { useViewportSize, useResource } = createHooks({ React, resourceStore })
  const panelTabs = createPanelTabRouter({ GrowthTab, GraphTab, SettingsTab })
  const DEBUG = {
  ROUTE,
  ASSET_BASE,
  WIDGET_ID,
  STEPS,
  PANEL_TABS: panelTabs.tabs, POETRY_TABS,
  DEFAULT_SETTINGS,
  buildToneCells,
  selectPoemText,
  selectCiText,
  poemRhymeLines,
  normalizeSettings,
  settingsPatch,
  buildSettingsRequest,
  createSettingsSaver,
  selectNextPoemId,
  clampPosition,
  anchorPosition,
  describeDataError,
  formatDateLabel,
  hashString,
  fetchJson,
  loadResource: resourceStore.load,
  clearResourceCache: resourceStore.clear,
  readFirstScreenCache,
  writeFirstScreenCache,
  clearFirstScreenCache,
  putSettings,
  FEIHUA_BEST_KEY,
  FEIHUA_CANDIDATE_CHARS,
  FEIHUA_MIN_ENTRIES,

  FEIHUA_ATLAS_LIMIT,
  FEIHUA_ATLAS_PAGE,
  buildFeihuaIndex,
  getFeihuaIndex,
  clearFeihuaIndexCache,
  pickDefaultFeihuaChar,
  feihuaStart,
  feihuaSubmit, feihuaLookup, feihuaPlainOf, mergeFeihuaFullEntries, requestFeihuaFull, abortFeihuaFull, clearFeihuaFullCache, readFeihuaFullCache, FEIHUA_FULL_PATH, FEIHUA_FULL_TIMEOUT_MS, FEIHUA_FULL_RETRY_MS,
  PET_MEDIA_PATH, PET_MEDIA_CATALOG_FILE, PET_MEDIA_TIMEOUT_MS, isVideoMoodFile, petMediaUrl, mascotVideoShouldPause, mascotFilePriority,
  DIZZY_MIN_MS, DIZZY_MAX_MS, mealTriggerFor, DIZZY_FAST_PX_PER_SEC, DIZZY_FAST_DISTANCE_PX, DIZZY_FAST_WINDOW_MS, MEAL_KEY, MEAL_PLAY_MIN_MS, MEAL_PLAY_MAX_MS, detectFastDrag, nextDizzyDuration, nextMealDuration, mealMomentFor, normalizeMealState, readMealState, writeMealState, markMealDone, pickDizzyMedia, pickMealMedia, normalizePetMediaCatalog, mergePetMediaIntoCatalog, requestPetMediaCatalog, clearPetMediaCache,
  MOTION_ROTATION_KEY, MOTION_MIN_DELAY_MS, MOTION_MAX_DELAY_MS, MOTION_PLAY_MIN_MS, MOTION_PLAY_MAX_MS, MOTION_FIRST_MIN_DELAY_MS, MOTION_FIRST_MAX_DELAY_MS, nextMotionFirstDelay, nextMotionScheduleDelay, readMotionRotation, writeMotionRotation, nextMotionEntry, nextMotionDelay, nextMotionDuration,
  normalizeFeihuaBest,
  feihuaBestUpdate,
  readFeihuaBest,
  writeFeihuaBest,
  MASCOT_FILES,
  mascotStateFor,
  mascotFileFor,
  mascotUrl,
  weatherPoemTags,
  countWeatherTagHits,
  buildWeatherPoemPool,
  selectWeatherPoemEntry,
  weatherChipText,
  weatherExplainText,
  weatherUpdatedLabel,
  requestWeather,
  SELF_PATH, SELF_POLL_MS, ACTION_SEEN_KEY, readSeenActionId, writeSeenActionId, normalizeSelfAction, MEMORY_PATH, MEMORY_BACKUP_PATH, MEMORY_POLL_MS, normalizeMemoryStatus, normalizeSelfStatus, selfStatusSummary,
  MOOD_LABELS, MOOD_IMAGES, MOOD_SWITCH_MIN_MS, MOOD_STRONG, MOOD_AI_PATH, MOOD_AI_TIMEOUT_MS, MOOD_AI_DEBOUNCE_MIN_MS, MOOD_AI_DEBOUNCE_MAX_MS, MOOD_AI_MIN_GAP_MS, MOOD_AI_RETRY_MIN_MS, MOOD_AI_RETRY_MAX_MS, MOOD_AI_KEEP_MS, MOOD_AI_MAX_RETRIES, nextMoodAiRetryDelay, moodAiKeepDecision, normalizeMoodAiFailure, moodAiFailureLabel, moodAiEventDelay, MOOD_AI_RECENT_MAX, MOOD_AI_RECENT_IMAGES_MAX, MOOD_PANEL_PEEK_FILES,
  SPONT_KEY, SPONT_POLL_MIN_MS, SPONT_POLL_MAX_MS, SPONT_RETRY_MS, SPONT_EVENT_MIN_MS, SPONT_EVENT_MAX_MS, SPONT_CLOSE_RECHECK_MS, SPONT_QUIET_MS, SPONT_REPEAT_MS, SPONT_AUTO_CLOSE_MS, SPONT_SEEN_DAYS, SPONT_MAX_SEEN,
  selfTalkQuery, parseSelfTalkResponse, requestSelfTalk, selfTalkKindFor, selfTalkNoveltySignature, SELF_TALK_PATH, SELF_TALK_TIMEOUT_MS, SELF_TALK_RECENT_MAX,
  WINDOW_WANDER_ENABLED, WANDER_TICK_MS, WANDER_WALK_MS, WANDER_MIN_DISTANCE, nextWanderTarget, pickWanderMedia, WANDER_STATIC_FILE,
  shanghaiParts, normalizeMoodStats, computeMood, throttleMoodSwitch, mascotImageFor, moodBasisText, normalizeMoodCatalog, panelPeekFile, moodCatalogAllows, moodAiQuery, parseMoodAiResponse, requestMoodAi, nextMoodAiDebounceDelay, moodAiSnapshot, moodTimeBucket, isMoodAiSignificant, moodImageFor: (key) => (MOOD_IMAGES[key] || MOOD_IMAGES.calm)[0],
  normalizeSpontState, readSpontState, writeSpontState, recordSpontShown, canShowSpontaneous, nextSpontPollDelay, nextSpontEventDelay, countSpontHits, splitCompleteSentences, pickSentenceFromLines,
  LIBRARY_CATEGORIES, LIBRARY_CATEGORY_ALIASES, LIBRARY_PAGE, ASSET_DATA_FILES,
  TONE_QUATRAINS, MASCOT_EGG_KEY, MASCOT_EXPRESSION_FILES, MASCOT_EXPRESSION_MS, MASCOT_IDLE_MIN_MS, MASCOT_IDLE_USER_MS,
  assetUrlFor, buildLibraryItems, filterLibraryItems, libraryPage, libraryItemLabel, ciBankRhythmics, ciSelectedLibraryItems, ciSelectedRhythmics, mergeFeihuaItems, finishFeihuaIndex, feihuaSourceOf, completeSentencesFromLines,
  buildPingshuiIndex, annotatePoemLines, detectMetre, detectPoem, detectPoemText, parsePoemInput, formatDetectionReport, detectionRhymeIndexes, patternForShape,
  setAssetDataVersion: resourceStore.setAssetDataVersion, normalizeMascotEggState, readMascotEggState, writeMascotEggState, recordMascotEgg, shouldShowDailyGreet, canShowIdlePose, pickMascotExpression,
  LibraryTab,
  GrowthTab,
  PoetryWidget,
  TodayTab,
  ClassTab,
  YunTab,
  CiTab,
  FeihuaTab,
  SettingsTab,
  PoetrySettingsTab,
  normalizeHealthStatus,
  }
  try {
  if (typeof globalThis !== 'undefined') globalThis.__dshPoetryDebug = DEBUG
  } catch (error) {
  }
  /**

  */
  function PoetryWidget(props) {
  const ctx = props && props.ctx
  const cacheRef = React.useRef(null)
  const cacheLoadedRef = React.useRef(false)
  if (!cacheLoadedRef.current) {
   cacheLoadedRef.current = true
   cacheRef.current = readFirstScreenCache()
  }

  const [boot, setBoot] = React.useState(() => {
   const cached = cacheRef.current
   if (cached && cached.bootstrap) {
    return { status: 'ready', data: cached.bootstrap, fromCache: true, stale: true, error: null }
   }
   return { status: 'loading', data: null, fromCache: false, stale: false, error: null }
  })
  const [reloadTick, setReloadTick] = React.useState(0)
  const [settings, setSettings] = React.useState(() => normalizeSettings(cacheRef.current && cacheRef.current.settings))
  const settingsRef = React.useRef(settings)
  settingsRef.current = settings

  const [step, setStep] = React.useState(-1)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelTab, setPanelTab] = React.useState('growth')
  const [poetryTab, setPoetryTab] = React.useState('today')
  const [selectedPoemId, setSelectedPoemId] = React.useState(null)
  const [toast, setToast] = React.useState(null)
  const [feihuaLaunch, setFeihuaLaunch] = React.useState(0)
  const [weatherRes, setWeatherRes] = React.useState(() => {
   const cached = weatherCache
   if (cached && cached.data && cached.data.ok) {
    return { status: 'ready', data: cached.data, error: null, at: cached.at }
   }
   return { status: 'idle', data: null, error: null, at: 0 }
  })
  const [mascotPulse, setMascotPulse] = React.useState(null)
  const [failedMascot, setFailedMascot] = React.useState('')
  const [moodRes, setMoodRes] = React.useState(() => {
   const cached = moodCache
   return cached && cached.data ? { status: 'ready', data: cached.data, at: cached.at } : { status: 'idle', data: null, at: 0 }
  })
  const [moodView, setMoodView] = React.useState(null)
  const [spontPoem, setSpontPoem] = React.useState(null)
  const [spontPreview, setSpontPreview] = React.useState(false)
  const [mascotExpression, setMascotExpression] = React.useState('')
  const [moodSource, setMoodSource] = React.useState('')
  const [moodAiFallback, setMoodAiFallback] = React.useState(false)
  const [moodAiStale, setMoodAiStale] = React.useState(false)
  const [moodAiFailure, setMoodAiFailure] = React.useState('')
  const [moodAiFailureCode, setMoodAiFailureCode] = React.useState('')
  const [petMediaRes, setPetMediaRes] = React.useState({ status: 'idle', entries: [] })
  const [selfStatus, setSelfStatus] = React.useState(null)
  const [memoryStatus, setMemoryStatus] = React.useState(null)
  const [healthStatus, setHealthStatus] = React.useState(null)
  const [worksRes, setWorksRes] = React.useState({ status: 'idle', data: null })
  const [growthRes, setGrowthRes] = React.useState({ status: 'idle', data: null })
  const [attentionRes, setAttentionRes] = React.useState({ status: 'idle', data: null })
  const [projectDetail, setProjectDetail] = React.useState(null)
  const [twinRes, setTwinRes] = React.useState({ status: 'idle', data: null })
  const [memoryTick, setMemoryTick] = React.useState(0)
  const [motionFile, setMotionFile] = React.useState('')
  const [dizzy, setDizzy] = React.useState(null)
  const [mealActive, setMealActive] = React.useState(null)
  const [libraryFocus, setLibraryFocus] = React.useState(null)
  const [ciBankWanted, setCiBankWanted] = React.useState(false)
  const [feihuaIndex, setFeihuaIndex] = React.useState(null)
  const [feihuaBuilding, setFeihuaBuilding] = React.useState(false)
  const [moodTick, setMoodTick] = React.useState(0)
  const [spontWake, setSpontWake] = React.useState(0)

  const [pos, setPos] = React.useState(() => {
   const stored = readStoredPosition()
   const viewport = { w: readWindowWidth(), h: readWindowHeight() }
   if (stored) return clampPosition(stored, BASE_SIZE, viewport)
   return { x: 16, y: Math.max(8, viewport.h - BASE_SIZE - 24) }
  })
  const posRef = React.useRef(pos)
  posRef.current = pos
  const dragRef = React.useRef(null)
  const pressTimer = React.useRef(null)
  const toastTimer = React.useRef(null)
  const mascotTimerRef = React.useRef(null)
  const weatherInFlightRef = React.useRef(null)
  const userPickedPoemRef = React.useRef(false)
  const moodViewRef = React.useRef(null)
  const selfStatusRef = React.useRef(null)
  const selfTalkNoveltyRef = React.useRef({ signature: '', at: 0 })
  const clicksRef = React.useRef(0)
  const panelOpensRef = React.useRef(0)
  const lastInteractionRef = React.useRef(0)
  // v1.64：窗口溜达（目标时间 + 走路计时器）。
  const wanderRef = React.useRef({ nextAt: 0, timer: null, walking: false })
  const [walking, setWalking] = React.useState(false)
  const [wanderFile, setWanderFile] = React.useState('')
  const wanderFileRef = React.useRef('')
  wanderFileRef.current = wanderFile
  const feihuaWinsRef = React.useRef(0)
  const feihuaLossesRef = React.useRef(0)
  const moodStatsRef = React.useRef(emptyMoodStats())
  const moodForceRef = React.useRef(false)
  const moodSourceRef = React.useRef('')
  const moodAiRef = React.useRef({ at: 0, lastRequestAt: 0, image: '' })
  const moodAiSnapshotRef = React.useRef(null)
  const moodAiTokenRef = React.useRef(0)
  const moodAiInFlightRef = React.useRef(false)
  const moodAiPendingRef = React.useRef(false)
  const moodAiDebounceTimerRef = React.useRef(null)
  const moodAiRetryTimerRef = React.useRef(null)
  const moodAiRetryCountRef = React.useRef(0)
  const moodStatsSnapshotRef = React.useRef(null)
  const moodTimeBucketRef = React.useRef('')
  const moodIdleRef = React.useRef(false)
  const moodWeatherSigRef = React.useRef('')
  const moodPrevPanelOpenRef = React.useRef(false)
  const moodPrevPanelTabRef = React.useRef('today')
  const moodPrevSpontRef = React.useRef(null)
  const recentImagesRef = React.useRef([])
  const moodCatalogRef = React.useRef(null)
  const spontWakeDelayRef = React.useRef(0)
  const prevPanelOpenRef = React.useRef(false)
  const prevStepRef = React.useRef(-1)
  const prevCardRef = React.useRef(null)
  const moodWakeSigRef = React.useRef('')
  const weatherWakeSigRef = React.useRef('')
  const weatherRef = React.useRef(null)
  const spontPoemRef = React.useRef(null)
  const uiRef = React.useRef({})
  const mascotExprTimerRef = React.useRef(null)
  const mascotTapRef = React.useRef(0)
  const mascotVideoRef = React.useRef(null)
  const mascotPulseRef = React.useRef(null)
  const mascotExpressionRef = React.useRef('')
  const petMediaEntriesRef = React.useRef([])
  const motionFileRef = React.useRef('')
  const motionIndexRef = React.useRef(readMotionRotation())
  const motionDelayTimerRef = React.useRef(null)
  const motionStopTimerRef = React.useRef(null)
  const motionFirstScheduledRef = React.useRef(false)
  const motionFirstPendingRef = React.useRef(false)
  const dizzyRef = React.useRef(null)
  const dizzyTimerRef = React.useRef(null)
  const mealActiveRef = React.useRef(null)
  const mealTimerRef = React.useRef(null)
  const mealPrevPanelRef = React.useRef(false)
  const spontReqRef = React.useRef(0)
  const selfTalkCacheRef = React.useRef({ murmur: [], intro: [] })
  const recentSpokenRef = React.useRef([])
  const pendingActionRef = React.useRef(null)
  const lastSeenActionIdRef = React.useRef(readSeenActionId())
  spontPoemRef.current = spontPoem
  mascotPulseRef.current = mascotPulse
  mascotExpressionRef.current = mascotExpression
  petMediaEntriesRef.current = petMediaRes.entries
  motionFileRef.current = motionFile
  dizzyRef.current = dizzy
  mealActiveRef.current = mealActive

  const wakeSpontaneous = React.useCallback((delay) => {
   spontWakeDelayRef.current = Math.max(1000, num(delay, nextSpontEventDelay()))
   setSpontWake((tick) => tick + 1)
  }, [])

  const showToast = React.useCallback((text, kind) => {
   setToast({ text: String(text == null ? '' : text), kind: kind === 'error' ? 'error' : 'info' })
   if (toastTimer.current) clearTimeout(toastTimer.current)
   toastTimer.current = setTimeout(() => {
    toastTimer.current = null
    setToast(null)
   }, 2600)
  }, [])
  const showToastRef = React.useRef(null)
  showToastRef.current = showToast
  React.useEffect(() => () => {
   if (toastTimer.current) {
    clearTimeout(toastTimer.current)
    toastTimer.current = null
   }
  }, [])

  const saverRef = React.useRef(null)
  if (!saverRef.current) {
   saverRef.current = createSettingsSaver({
    delay: SAVE_DEBOUNCE_MS,
    put: (patch) => putSettings(patch),
    onError: () => {
    if (showToastRef.current) showToastRef.current('保存失败，已保留本地设置', 'error')
    },
   })
  }
  React.useEffect(() => () => {
   if (saverRef.current) saverRef.current.flush().catch(() => {})
   if (pressTimer.current) {
    clearTimeout(pressTimer.current)
    pressTimer.current = null
   }
   if (mascotTimerRef.current) {
    clearTimeout(mascotTimerRef.current)
    mascotTimerRef.current = null
   }
   if (mascotExprTimerRef.current) {
    clearTimeout(mascotExprTimerRef.current)
    mascotExprTimerRef.current = null
   }
  }, [])

  const updateSettings = React.useCallback((patch, options) => {
   if (!patch || typeof patch !== 'object') return settingsRef.current
   const previous = settingsRef.current
   const next = normalizeSettings(Object.assign({}, previous, patch))
   settingsRef.current = next
   setSettings(next)
   if (!(options && options.localOnly) && saverRef.current) {
    const changed = {}
    for (let i = 0; i < WRITE_KEYS.length; i++) {
    const key = WRITE_KEYS[i]
    if (hasOwn(patch, key) && next[key] !== previous[key]) changed[key] = next[key]
    }
    if (Object.keys(changed).length) saverRef.current.save(changed)
   }
   wakeSpontaneous(nextSpontEventDelay())
   if (settingsRef.current.mood) scheduleMoodAiRefresh()
   return next
  }, [])

  /** 飞花令/交互反馈：临时切换立绘 2.5s 后回落到天气/默认状态。 */
  const pulseMascot = React.useCallback((key) => {
   if (!MASCOT_FILES[key]) return
   if (key === 'gameWin') feihuaWinsRef.current += 1
   if (key === 'gameLose') feihuaLossesRef.current += 1
   if (key === 'gameWin' || key === 'gameLose') {
    wakeSpontaneous(nextSpontEventDelay())
    scheduleMoodAiRefresh()
   }
   lastInteractionRef.current = Date.now()
   setMascotPulse(key)
   if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
   mascotTimerRef.current = setTimeout(() => {
    mascotTimerRef.current = null
    setMascotPulse(null)
   }, MASCOT_TRANSIENT_MS)
  }, [])

  /** 拉取天气（失败静默：仅更新状态，不弹 toast；保留上次结果）。 */
  const refreshWeather = React.useCallback((force) => {
   const current = settingsRef.current
   if (!(current.weatherPoem || current.mood)) return Promise.resolve(null)
   const cached = weatherCache
   if (!force && cached && cached.data && cached.data.ok
    && cached.data.city === current.weatherCity
    && Date.now() - cached.at < WEATHER_STALE_MS) {
    setWeatherRes({ status: 'ready', data: cached.data, error: null, at: cached.at })
    return Promise.resolve(cached.data)
   }
   if (weatherInFlightRef.current) return weatherInFlightRef.current
   setWeatherRes((previous) => ({ status: 'loading', data: previous.data, error: null, at: previous.at }))
   const request = requestWeather().then(
    (data) => {
    weatherInFlightRef.current = null
    setWeatherRes({ status: 'ready', data, error: null, at: Date.now() })
    return data
    },
    (error) => {
    weatherInFlightRef.current = null
    setWeatherRes((previous) => ({ status: 'error', data: previous.data, error, at: previous.at }))
    return null
    },
   )
   weatherInFlightRef.current = request
   return request
  }, [])

  const applyMood = React.useCallback((force) => {
   const current = settingsRef.current
   if (!current.mood && !current.spontaneousPoem) {
    moodViewRef.current = null
    setMoodView(null)
    return null
   }
   const next = computeMood({
    weather: weatherRef.current,
    signals: {
    now: Date.now(),
    clicks: clicksRef.current,
    feihuaWins: feihuaWinsRef.current,
    feihuaLosses: 0,
    panelOpens: panelOpensRef.current,
    },
   })
   const selected = throttleMoodSwitch(moodViewRef.current, next, Date.now(), force === true)
   moodViewRef.current = selected
   setMoodView(selected)
   return selected
  }, [])

  const applyModelMood = React.useCallback((mood) => {
   if (!mood || !mood.image) return null
   const view = Object.assign({}, mood, { changed: true, switchedAt: Date.now() })
   moodSourceRef.current = 'model'
   moodViewRef.current = view
   setMoodSource('model')
   setMoodAiFallback(false)
   setMoodAiStale(false)
   setMoodAiFailure('')
   setMoodAiFailureCode('')
   clearMoodAiRetry()
   setMoodView(view)
   moodAiRef.current = Object.assign({}, moodAiRef.current, { at: Date.now(), image: mood.image })
   const images = recentImagesRef.current.filter((file) => file !== mood.image)
   images.push(mood.image)
   recentImagesRef.current = images.slice(-MOOD_AI_RECENT_IMAGES_MAX)
   return view
  }, [])

  const fallbackHeuristicMood = React.useCallback((force) => {
   moodSourceRef.current = 'heuristic'
   setMoodSource('heuristic')
   setMoodAiFallback(true)
   return applyMood(force === true)
  }, [applyMood])

  function clearMoodAiRetry() {
   if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
   moodAiRetryCountRef.current = 0
  }

  function scheduleMoodAiRetry() {
   if (!settingsRef.current.mood || settingsRef.current.hidden) return
   if (moodAiRetryCountRef.current >= MOOD_AI_MAX_RETRIES) return
   if (moodAiRetryTimerRef.current) clearTimeout(moodAiRetryTimerRef.current)
   moodAiRetryTimerRef.current = setTimeout(() => {
    moodAiRetryTimerRef.current = null
    if (!settingsRef.current.mood || settingsRef.current.hidden) return
    if (moodAiInFlightRef.current) {
     moodAiPendingRef.current = true
     return
    }
    requestModelMood()
   }, nextMoodAiRetryDelay())
  }

  function handleMoodAiFailure(result) {
   const reason = normalizeMoodAiFailure(result)
   const code = result && typeof result.code === 'string' ? result.code : (reason.indexOf('host:') === 0 ? reason.slice(5) : '')
   setMoodAiFailure(reason)
   setMoodAiFailureCode(code)
   moodAiRetryCountRef.current += 1
   const keep = moodAiKeepDecision({ source: moodSourceRef.current, lastSuccessAt: moodAiRef.current.at, now: Date.now() })
   if (keep) {
    setMoodAiStale(true)
    setMoodAiFallback(false)
   } else {
    setMoodAiStale(false)
    fallbackHeuristicMood(true)
   }
   if (moodAiRetryCountRef.current < MOOD_AI_MAX_RETRIES) {
    scheduleMoodAiRetry()
   } else if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
  }

  const requestModelMood = React.useCallback((options = {}) => {
   const manual = options && options.manual === true
   const current = settingsRef.current
   if (!current.mood) return Promise.resolve({ ok: false, reason: 'disabled' })
   const catalog = moodCatalogRef.current
   if (!catalog) {
    setMoodAiFallback(true)
    return Promise.resolve({ ok: false, reason: 'catalog' })
   }
   if (moodAiInFlightRef.current) {
    moodAiPendingRef.current = true
    return Promise.resolve({ ok: false, reason: 'inflight' })
   }
   const now = Date.now()
   moodAiRef.current = Object.assign({}, moodAiRef.current, { lastRequestAt: now })
   const token = moodAiTokenRef.current + 1
   moodAiTokenRef.current = token
   moodAiInFlightRef.current = true
   const weather = weatherRef.current || null
   const currentMoodKey = moodViewRef.current && moodViewRef.current.key && moodViewRef.current.key !== 'ai'
    ? moodViewRef.current.key
    : 'calm'
   const recent = recentSpokenRef.current.slice(-MOOD_AI_RECENT_MAX)
   const recentImages = recentImagesRef.current.slice(-MOOD_AI_RECENT_IMAGES_MAX)
   moodAiSnapshotRef.current = moodAiSnapshot(weather, feihuaWinsRef.current, feihuaLossesRef.current)
   const finish = () => {
    if (token !== moodAiTokenRef.current) return
    moodAiInFlightRef.current = false
    if (moodAiPendingRef.current && settingsRef.current.mood) {
     moodAiPendingRef.current = false
     scheduleMoodAiRefresh()
    }
   }
   return requestMoodAi({
    force: true,
    manual,
    moodKey: currentMoodKey,
    weather: weather ? String(weather.category || weather.label || '') : '',
    recent,
    recentImages,
    catalog,
   }).then((result) => {
    finish()
    if (token !== moodAiTokenRef.current) return result
    if (!settingsRef.current.mood) return result
    if (result && result.ok && result.mood) {
     applyModelMood(result.mood)
     return result
    }
    handleMoodAiFailure(result)
    return result
   }).catch(() => {
    finish()
    if (token === moodAiTokenRef.current && settingsRef.current.mood) handleMoodAiFailure({ reason: 'network' })
    return { ok: false }
   })
  }, [applyModelMood, fallbackHeuristicMood])

  const moodManualRef = React.useRef(false)

  function scheduleMoodAiRefresh(options) {
   const opts = options && typeof options === 'object' ? options : {}
   if (!settingsRef.current.mood || settingsRef.current.hidden) return
   // 有事件触发的正常请求时，取消待执行的自动重试，避免双发
   if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
   if (moodAiDebounceTimerRef.current) clearTimeout(moodAiDebounceTimerRef.current)
   const delay = opts.immediate === true
    ? 0
    : moodAiEventDelay({ lastRequestAt: moodAiRef.current.lastRequestAt, now: Date.now() })
   moodAiDebounceTimerRef.current = setTimeout(() => {
    moodAiDebounceTimerRef.current = null
    if (!settingsRef.current.mood || settingsRef.current.hidden) return
    if (moodAiInFlightRef.current) {
     moodAiPendingRef.current = true
     return
    }
    const manual = moodManualRef.current
    moodManualRef.current = false
    requestModelMood({ manual })
   }, Math.max(0, delay))
  }
  const refreshMoodNow = React.useCallback(() => {
   moodForceRef.current = true
   moodManualRef.current = true
   scheduleMoodAiRefresh({ immediate: true })
   setMoodTick((tick) => tick + 1)
   return Promise.resolve({ ok: true })
  }, [scheduleMoodAiRefresh])

  function showMascotExpression(file) {
   if (!file) return
   setMascotExpression(file)
   if (mascotExprTimerRef.current) clearTimeout(mascotExprTimerRef.current)
   mascotExprTimerRef.current = setTimeout(() => {
    mascotExprTimerRef.current = null
    setMascotExpression('')
   }, MASCOT_EXPRESSION_MS)
  }

  React.useEffect(() => {
   const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const ui = uiRef.current
    if (ui.panelOpen || ui.step >= 0 || ui.settings.hidden) return
    if (mascotExprTimerRef.current) return
    const now = Date.now()
    const state = readMascotEggState(now)
    if (!canShowIdlePose(state, now, lastInteractionRef.current)) return
    writeMascotEggState(recordMascotEgg(state, { idle: true }, now))
    showMascotExpression(pickMascotExpression())
   }, MASCOT_IDLE_POLL_MS)
   return () => clearInterval(timer)
  }, [])

  // v1.64：窗口溜达——每 2–5 分钟贴着边缘换一个位置，互相不挡输入框；
  // 面板打开、用户刚碰过她、页面不可见时不走。
  React.useEffect(() => {
   if (!WINDOW_WANDER_ENABLED) return undefined
   if (settings.hidden) return undefined
   if (!wanderRef.current.nextAt) {
    wanderRef.current.nextAt = Date.now() + WANDER_FIRST_MIN_MS + Math.random() * (WANDER_FIRST_MAX_MS - WANDER_FIRST_MIN_MS)
   }
   const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const ui = uiRef.current
    if (ui.panelOpen || settingsRef.current.hidden) return
    if (dragRef.current) return
    const now = Date.now()
    if (now - lastInteractionRef.current < WANDER_INTERACTION_PAUSE_MS) return
    if (now < wanderRef.current.nextAt) return
    const size = Math.max(40, Math.round(BASE_SIZE * settingsRef.current.scale))
    const target = nextWanderTarget({
     viewport: { w: readWindowWidth(), h: readWindowHeight() },
     size,
     current: posRef.current,
    })
    wanderRef.current.nextAt = now + WANDER_MIN_INTERVAL_MS + Math.random() * (WANDER_MAX_INTERVAL_MS - WANDER_MIN_INTERVAL_MS)
    const picked = pickWanderMedia(petMediaEntriesRef.current || [], Math.random)
    setWanderFile(picked.file)
    setWalking(true)
    wanderRef.current.walking = true
    setPos(target)
    if (wanderRef.current.timer) clearTimeout(wanderRef.current.timer)
    wanderRef.current.timer = setTimeout(() => {
     wanderRef.current.timer = null
     wanderRef.current.walking = false
     setWalking(false)
     setWanderFile('')
    }, WANDER_WALK_MS)
   }, WANDER_TICK_MS)
   return () => {
    clearInterval(timer)
    if (wanderRef.current.timer) clearTimeout(wanderRef.current.timer)
    wanderRef.current.timer = null
   }
  }, [settings.hidden])

  const viewport = useViewportSize()
  const mascotSize = Math.max(40, Math.round(BASE_SIZE * settings.scale))
  React.useEffect(() => {
   let alive = true
   fetchJson('bootstrap.json').then(
    (data) => {
    if (!alive) return
    const cached = cacheRef.current
    if (cached && cached.dataVersion && data.dataVersion && cached.dataVersion !== data.dataVersion) {
     clearFirstScreenCache()
     resourceStore.clear()
     cacheRef.current = null
    }
    const normalized = normalizeSettings(data.settings)
    settingsRef.current = normalized
    setSettings(normalized)
    resourceStore.setAssetDataVersion(data.dataVersion)
    setBoot({ status: 'ready', data, fromCache: false, stale: false, error: null })
    },
    (error) => {
    if (!alive) return
    const cached = cacheRef.current
    if (cached && cached.bootstrap) {
     setBoot({ status: 'ready', data: cached.bootstrap, fromCache: true, stale: true, error })
    } else {
     setBoot({ status: 'error', data: null, fromCache: false, stale: false, error })
    }
    },
   )
   return () => {
    alive = false
   }
  }, [reloadTick])

  React.useEffect(() => {
   if (!boot.data) return
   setSelectedPoemId((previous) => {
    if (previous) return previous
    const initial = normalizeSettings(boot.data.settings)
    if (initial.mode === 'random' && initial.lastPoemId) return initial.lastPoemId
    return boot.data.today && boot.data.today.poemId ? boot.data.today.poemId : null
   })
  }, [boot.data])
  React.useEffect(() => {
   if (!(settings.weatherPoem || settings.mood)) return undefined
   refreshWeather(false)
   const timer = setInterval(() => refreshWeather(true), WEATHER_REFRESH_MS)
   return () => clearInterval(timer)
  }, [settings.weatherPoem, settings.mood, settings.weatherCity, refreshWeather])


  React.useEffect(() => {
   if (!(settings.mood || settings.spontaneousPoem)) return undefined
   const timer = setInterval(() => setMoodTick((tick) => tick + 1), MOOD_TICK_MS)
   return () => clearInterval(timer)
  }, [settings.mood, settings.spontaneousPoem])
  const [poemsRes, reloadPoems] = useResource('poems', Boolean(boot.data))
  const poetryOn = panelOpen && panelTab === 'poetry'
  const classActive = step === 2 || step === 4 || (poetryOn && (poetryTab === 'class' || poetryTab === 'ci'))
  const yunActive = step === 3 || (poetryOn && poetryTab === 'yun')
  const weatherNeedsCi = settings.weatherPoem && !resourceStore.get('ci')
   && weatherRes.data && weatherRes.data.ok && weatherRes.data.weather
   && buildWeatherPoemPool(poemsRes.data, null, weatherPoemTags(weatherRes.data.weather), WEATHER_POOL_LIMIT).length < WEATHER_POOL_LIMIT
  const ciActive = step === 4 || step === 5 || weatherNeedsCi
   || (poetryOn && (poetryTab === 'ci' || poetryTab === 'feihua' || poetryTab === 'library'))
  const [knowledgeRes, reloadKnowledge] = useResource('knowledge', classActive)
  const [yunRes, reloadYun] = useResource('yun', yunActive)
  const [ciRes, reloadCi] = useResource('ci', ciActive)
  const libraryActive = poetryOn && poetryTab === 'library'
  const feihuaOpen = (poetryOn && poetryTab === 'feihua') || step === 5
  const ciTabActive = poetryOn && poetryTab === 'ci'
  const extraPoolActive = libraryActive || feihuaOpen
  const [anthologyRes, reloadAnthology] = useResource('anthology', extraPoolActive)
  const [bankRes, reloadBank] = useResource('bank', extraPoolActive)
  const [pingshuiRes, reloadPingshui] = useResource('pingshui', libraryActive)
  const [moodCatalogRes, reloadMoodCatalog] = useResource('moodCatalog', settings.mood)
  const [ciBankRes, reloadCiBank] = useResource('ciBank', ciBankWanted || feihuaOpen)

  const poemItems = poemsRes.data && Array.isArray(poemsRes.data.items) ? poemsRes.data.items : []
  const bootstrapTodayPoemId = boot.data && boot.data.today ? boot.data.today.poemId : null
  const cache = cacheRef.current
  const cachedPoem = cache && cache.todayPoem ? cache.todayPoem : null
  const weatherData = weatherRes.data && weatherRes.data.ok ? weatherRes.data : null
  const weather = weatherData && weatherData.weather ? weatherData.weather : null
  const weatherTags = React.useMemo(() => weatherPoemTags(weather), [weather])
  const weatherPool = React.useMemo(
   () => buildWeatherPoemPool(poemsRes.data, ciRes.data, weatherTags, WEATHER_POOL_LIMIT, { anthology: anthologyRes.data, bank: bankRes.data, ciBank: ciBankRes.data }),
   [poemsRes.data, ciRes.data, weatherTags, anthologyRes.data, bankRes.data, ciBankRes.data],
  )
  const weatherEntry = React.useMemo(() => {
   if (!settings.weatherPoem || !weather) return null
   return selectWeatherPoemEntry(weatherPool, {
    date: boot.data && boot.data.today ? boot.data.today.date : '',
    category: weather.category,
    dataVersion: boot.data ? boot.data.dataVersion : '',
   })
  }, [settings.weatherPoem, weather, weatherPool, boot.data])
  const weatherActive = Boolean(weatherEntry)
  const activeTodayPoemId = weatherActive ? weatherEntry.id : bootstrapTodayPoemId
  const weatherChip = weatherActive && weatherData ? weatherChipText(weatherData.city, weather) : ''
  const weatherNote = weatherActive ? weatherExplainText(weather) : ''
  weatherRef.current = weather
  selfStatusRef.current = selfStatus
  const moodCatalogBase = React.useMemo(() => normalizeMoodCatalog(moodCatalogRes.data), [moodCatalogRes.data])
  const moodCatalog = React.useMemo(() => mergePetMediaIntoCatalog(moodCatalogBase, petMediaRes.entries), [moodCatalogBase, petMediaRes.entries])
  moodCatalogRef.current = moodCatalog
  const moodChip = settings.mood && moodView ? '心情：' + moodView.label : ''
  const moodChipTitle = settings.mood && moodView ? String(moodView.reason || '') : ''
  const moodBasis = moodBasisText(weather)
  uiRef.current = {
   settings: settingsRef.current,
   panelOpen,
   step,
   moodView,
   poemItems,
   ciItems: ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : [],
   anthologyItems: anthologyRes.data && Array.isArray(anthologyRes.data.items) ? anthologyRes.data.items : [],
   bankItems: bankRes.data && Array.isArray(bankRes.data.items) ? bankRes.data.items : [],
   ciBankItems: ciBankRes.data && Array.isArray(ciBankRes.data.items) ? ciBankRes.data.items : [],
   moodRes,
  }

  const poem = React.useMemo(() => {
   if (weatherActive && weatherEntry && (!selectedPoemId || selectedPoemId === weatherEntry.id)) return weatherEntry.item || null
   const weatherPick = weatherActive && selectedPoemId ? weatherPool.find((entry) => entry.id === selectedPoemId) : null
   if (weatherPick) return weatherPick.item || null
   const findById = (id) => poemItems.find((item) => item && item.id === id)
   if (!boot.data) return null
   if (poemItems.length) return findById(selectedPoemId) || findById(activeTodayPoemId) || poemItems[0] || null
   if (cachedPoem && (!selectedPoemId || cachedPoem.id === selectedPoemId || cachedPoem.id === activeTodayPoemId)) return cachedPoem
   return null
  }, [poemItems, selectedPoemId, activeTodayPoemId, cachedPoem, boot.data, weatherActive, weatherEntry, weatherPool])

  const todayPoem = React.useMemo(() => {
   if (weatherActive && weatherEntry && weatherEntry.id === activeTodayPoemId) return weatherEntry.item || null
   if (poem && poem.id === activeTodayPoemId) return poem
   if (cachedPoem && cachedPoem.id === activeTodayPoemId) return cachedPoem
   return poemItems.find((item) => item && item.id === activeTodayPoemId) || null
  }, [poem, cachedPoem, activeTodayPoemId, poemItems])
  React.useEffect(() => {
   if (!boot.data) return
   const record = {
    dataVersion: boot.data.dataVersion || '',
    bootstrap: boot.data,
    settings: settingsRef.current,
    todayPoem: todayPoem || null,
   }
   cacheRef.current = record
   writeFirstScreenCache(record)
  }, [boot.data, settings, todayPoem])
  React.useEffect(() => {
   userPickedPoemRef.current = false
  }, [weatherChip])

  React.useEffect(() => {
   if (!weatherActive || userPickedPoemRef.current) return
   setSelectedPoemId(activeTodayPoemId)
  }, [weatherActive, activeTodayPoemId])
  React.useEffect(() => {
   try {
    if (typeof window === 'undefined' || typeof window.Image !== 'function') return
    for (const file of [MASCOT_FILES.celebrate, MASCOT_FILES.idle, MASCOT_FILES.night]) {
    const image = new window.Image()
    image.src = mascotUrl(file)
    }
   } catch (error) {
   }
  }, [])
  React.useEffect(() => {
   if (!settingsRef.current.mood && !settingsRef.current.spontaneousPoem) {
    moodAiTokenRef.current += 1
    moodAiInFlightRef.current = false
    moodAiPendingRef.current = false
    if (moodAiDebounceTimerRef.current) {
     clearTimeout(moodAiDebounceTimerRef.current)
     moodAiDebounceTimerRef.current = null
    }
    moodSourceRef.current = ''
    moodViewRef.current = null
    clearMoodAiRetry()
    setMoodSource('')
    setMoodAiFallback(false)
    setMoodAiStale(false)
    setMoodAiFailure('')
    setMoodAiFailureCode('')
    setMoodView(null)
    return
   }
   if (moodSourceRef.current === 'model') return
   moodSourceRef.current = 'heuristic'
   setMoodSource('heuristic')
   const force = moodForceRef.current
   moodForceRef.current = false
   applyMood(force)
  }, [moodRes, weather, settings.mood, settings.spontaneousPoem, moodTick, applyMood])

  React.useEffect(() => () => {
   if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
  }, [])

  // 心情动画素材（dsh-pet webm）：设置 mood 开启时懒加载，失败只用 92 张静态图
  React.useEffect(() => {
   if (!settings.mood) {
    setPetMediaRes({ status: 'idle', entries: [] })
    return undefined
   }
   let alive = true
   setPetMediaRes({ status: 'loading', entries: [] })
   requestPetMediaCatalog().then((result) => {
    if (!alive) return
    setPetMediaRes({ status: result && result.ok ? 'ready' : 'error', entries: result && result.ok ? result.entries : [] })
   })
   return () => {
    alive = false
   }
  }, [settings.mood, boot.data && boot.data.dataVersion])

  // 模型心情：初次加载（图鉴/动画图鉴都就绪或失败后）→ 2–4s 防抖后实时请求
  React.useEffect(() => {
   if (!settings.mood || !moodCatalog) return
   if (petMediaRes.status === 'loading' || petMediaRes.status === 'idle') return
   if (moodAiRef.current.at > 0) return
   scheduleMoodAiRefresh()
  }, [settings.mood, moodCatalog, petMediaRes.status])

  // v1.58：模型心情按她自己的节奏刷新（不随会话事件）；页面可见时每 5 分钟一次。
  React.useEffect(() => {
   if (!settings.mood) return undefined
   const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    scheduleMoodAiRefresh()
   }, MOOD_REFRESH_MS)
   return () => clearInterval(timer)
  }, [settings.mood, scheduleMoodAiRefresh])

  // 实时事件 2：面板打开/关闭/切 tab
  React.useEffect(() => {
   if (!settings.mood) return
   const currentTab = panelTab === 'poetry' ? 'poetry:' + poetryTab : panelTab
   const changed = moodPrevPanelOpenRef.current !== panelOpen
    || (panelOpen && moodPrevPanelTabRef.current !== currentTab)
   moodPrevPanelOpenRef.current = panelOpen
   moodPrevPanelTabRef.current = currentTab
   if (changed) scheduleMoodAiRefresh()
  }, [panelOpen, panelTab, poetryTab, settings.mood])

  // 实时事件 3：self-talk 卡片出现/关闭
  React.useEffect(() => {
   if (!settings.mood) return
   const visible = Boolean(spontPoem)
   const previous = Boolean(moodPrevSpontRef.current)
   moodPrevSpontRef.current = visible
   if (visible !== previous) scheduleMoodAiRefresh()
  }, [spontPoem, settings.mood])

  // 实时事件 4：天气刷新/类别变化
  React.useEffect(() => {
   if (!settings.mood) return
   const signature = weather ? [weather.category, weather.label, weather.tempC, weather.isDay].join('|') : ''
   const previous = moodWeatherSigRef.current
   moodWeatherSigRef.current = signature
   if (previous && signature && previous !== signature) scheduleMoodAiRefresh()
  }, [weather, settings.mood])

  // 实时事件 5：页面回前台 / 窗口重新可见
  React.useEffect(() => {
   if (!settings.mood) return undefined
   const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    scheduleMoodAiRefresh()
   }
   const onFocus = () => scheduleMoodAiRefresh()
   if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
   if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus)
   return () => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus)
   }
  }, [settings.mood])

  // 实时事件 6：时段/饭点切换、idle 进入/恢复（用分钟 tick 检查，无定时请求）
  React.useEffect(() => {
   if (!settings.mood) return
   const now = Date.now()
   const last = lastInteractionRef.current
   const idle = last > 0 && now - last >= 30 * 60 * 1000
   if (idle !== moodIdleRef.current) {
    moodIdleRef.current = idle
    scheduleMoodAiRefresh()
   }
   const bucket = moodTimeBucket(now)
   if (moodTimeBucketRef.current && bucket !== moodTimeBucketRef.current) scheduleMoodAiRefresh()
   moodTimeBucketRef.current = bucket
  }, [moodTick, settings.mood])

  // 图鉴加载失败：直接使用启发式并提示本地表情
  React.useEffect(() => {
   if (settings.mood && moodCatalogRes.status === 'error') setMoodAiFallback(true)
  }, [settings.mood, moodCatalogRes.status])

  // 图鉴就绪后预加载 3 张探头图 + 少量心情图
  React.useEffect(() => {
   if (!moodCatalog) return
   if (typeof window === 'undefined' || typeof window.Image !== 'function') return
   const files = [
    panelPeekFile(moodCatalog, 'today'),
    panelPeekFile(moodCatalog, 'settings'),
    panelPeekFile(moodCatalog, 'other'),
   ].concat(moodCatalog.moodFiles.slice(0, 4))
   for (const file of files) {
    if (!file) continue
    try {
     const image = new window.Image()
     image.src = mascotUrl(file)
    } catch (error) {
    }
   }
  }, [moodCatalog])
  React.useEffect(() => {
   if (settings.hidden) {
    spontReqRef.current += 1
    setSpontPoem(null)
    return undefined
   }
   if (!settings.spontaneousPoem) {
    spontReqRef.current += 1
    setSpontPoem((current) => (current && current.tag === 'action' ? current : null))
    return undefined
   }
   let cancelled = false
   let timer = null
   const schedule = (delay) => {
    if (timer) clearTimeout(timer)
    if (!cancelled) timer = setTimeout(run, Math.max(1000, delay))
   }
   const run = () => {
    if (cancelled) return
    const ui = uiRef.current
    // 一卡制：有卡时等它关闭，3 秒后再检查
    if (spontPoemRef.current) {
     schedule(SPONT_CLOSE_RECHECK_MS)
     return
    }
    const ok = canShowSpontaneous({
     enabled: ui.settings.spontaneousPoem === true,
     hidden: ui.settings.hidden === true,
     panelOpen: ui.panelOpen === true,
     bubbleOpen: ui.step >= 0,
     visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
     now: Date.now(),
     lastInteractionAt: lastInteractionRef.current,
     quietMs: SPONT_QUIET_MS,
    })
    if (ok) {
     startSpontaneousCard({ record: true })
     schedule(nextSpontPollDelay())
    } else {
     schedule(SPONT_RETRY_MS)
    }
   }
   const onWake = () => wakeSpontaneous(nextSpontEventDelay())
   const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') onWake()
   }
   const onFocus = () => onWake()
   if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
   if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus)
   const initialDelay = spontWake > 0 ? num(spontWakeDelayRef.current, nextSpontEventDelay()) : nextSpontPollDelay()
   schedule(initialDelay)
   return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus)
   }
  }, [settings.spontaneousPoem, settings.hidden, spontWake, wakeSpontaneous])

  // 事件唤醒：关闭面板 / 气泡结束 / 卡片关闭 / 心情或天气更新
  React.useEffect(() => {
   if (panelOpen) {
    prevPanelOpenRef.current = true
    return
   }
   if (prevPanelOpenRef.current) {
    prevPanelOpenRef.current = false
    wakeSpontaneous(nextSpontEventDelay())
   }
  }, [panelOpen, wakeSpontaneous])

  React.useEffect(() => {
   if (step >= 0) {
    prevStepRef.current = true
    return
   }
   if (prevStepRef.current) {
    prevStepRef.current = false
    wakeSpontaneous(nextSpontEventDelay())
   }
  }, [step, wakeSpontaneous])

  React.useEffect(() => {
   if (!settings.spontaneousPoem) return
   if (spontPoem) {
    prevCardRef.current = true
    return
   }
   if (prevCardRef.current) {
    prevCardRef.current = false
    wakeSpontaneous(SPONT_CLOSE_RECHECK_MS)
   }
  }, [spontPoem, settings.spontaneousPoem, wakeSpontaneous])

  React.useEffect(() => {
   if (!settings.spontaneousPoem || !moodView) return
   const signature = [moodView.key, moodView.label, moodView.reason, moodView.source].join('|')
   if (moodWakeSigRef.current && moodWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay())
   moodWakeSigRef.current = signature
  }, [moodView, settings.spontaneousPoem, wakeSpontaneous])

  React.useEffect(() => {
   if (!settings.spontaneousPoem || !weather) return
   const signature = [weather.category, weather.label, weather.tempC].join('|')
   if (weatherWakeSigRef.current && weatherWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay())
   weatherWakeSigRef.current = signature
  }, [weather, settings.spontaneousPoem, wakeSpontaneous])

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   const markActivity = () => noteInteraction()
   document.addEventListener('pointerdown', markActivity, true)
   document.addEventListener('keydown', markActivity, true)
   document.addEventListener('input', markActivity, true)
   return () => {
    document.removeEventListener('pointerdown', markActivity, true)
    document.removeEventListener('keydown', markActivity, true)
    document.removeEventListener('input', markActivity, true)
   }
  }, [])

  React.useEffect(() => {
   if (!spontPoem) return undefined
   const timer = setTimeout(() => {
    spontReqRef.current += 1
    setSpontPoem(null)
   }, SPONT_AUTO_CLOSE_MS)
   return () => clearTimeout(timer)
  }, [spontPoem])
  React.useEffect(() => {
   if (spontPoem && !spontPreview && (panelOpen || step >= 0 || settings.hidden)) {
    spontReqRef.current += 1
    setSpontPoem(null)
   }
  }, [panelOpen, step, settings.hidden, spontPoem, spontPreview])
  React.useEffect(() => {
   if (!feihuaOpen) {
    setFeihuaBuilding(false)
    setFeihuaIndex(null)
    return undefined
   }
   const base = getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data)
   setFeihuaIndex(base)
   const ciBankItemsData = ciBankRes.data && Array.isArray(ciBankRes.data.items) ? ciBankRes.data.items : []
   if (!ciBankItemsData.length) {
    setFeihuaBuilding(ciBankRes.status === 'loading')
    return undefined
   }
   let cancelled = false
   let timer = null
   const working = buildFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data)
   let offset = 0
   const CHUNK = 500
   setFeihuaBuilding(true)
   const run = () => {
    if (cancelled) return
    mergeFeihuaItems(working, ciBankItemsData.slice(offset, offset + CHUNK))
    offset += CHUNK
    if (offset < ciBankItemsData.length) {
     timer = setTimeout(run, 0)
    } else {
     finishFeihuaIndex(working)
     setFeihuaIndex(working)
     setFeihuaBuilding(false)
    }
   }
   timer = setTimeout(run, 0)
   return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
   }
  }, [feihuaOpen, poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data, ciBankRes.data, ciBankRes.status])

  React.useEffect(() => {
   setPos((previous) => {
    const next = anchorPosition(settings.snap, mascotSize, viewport, previous)
    return next.x === previous.x && next.y === previous.y ? previous : next
   })
  }, [settings.snap, mascotSize, viewport.w, viewport.h])

  React.useEffect(() => {
   const timer = setTimeout(() => {
    writeStoredPosition({ x: pos.x, y: pos.y, snap: settingsRef.current.snap })
   }, 250)
   return () => clearTimeout(timer)
  }, [pos, settings.snap])
  React.useEffect(() => {
   const seconds = num(settings.autoplay, 0)
   if (!seconds || step < 0 || panelOpen || settings.hidden) return undefined
   const timer = setTimeout(() => {
    setStep((current) => (current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1))
   }, seconds * 1000)
   return () => clearTimeout(timer)
  }, [settings.autoplay, step, panelOpen, settings.hidden])
  React.useEffect(() => {
   if (!panelOpen && step < 0) return undefined
   const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    if (panelOpen) setPanelOpen(false)
    else setStep(-1)
   }
   document.addEventListener('keydown', onKeyDown)
   return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelOpen, step])
  React.useEffect(() => {
   if (!settings.hidden) return undefined
   const onDoubleClick = (event) => {
    const target = event.target
    if (target && typeof target.closest === 'function'
    && target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"],[data-composer-input],[data-composer-seat],[data-composer-card]')) {
    return
    }
    restoreWidget()
   }
   document.addEventListener('dblclick', onDoubleClick, true)
   return () => document.removeEventListener('dblclick', onDoubleClick, true)
  }, [settings.hidden])
  function hideWidget() {
   setPanelOpen(false)
   setStep(-1)
   updateSettings({ hidden: true })
  }

  function restoreWidget() {
   updateSettings({ hidden: false })
  }

  function noteInteraction() {
   lastInteractionRef.current = Date.now()
  }

  function openPanelTab(tabId) {
   if (POETRY_TABS.some((item) => item.id === tabId)) {
    setPanelTab('poetry')
    setPoetryTab(tabId)
    return
   }
   if (tabId === 'poetry') {
    setPanelTab('poetry')
    return
   }
   if (panelTabs.isPanelTab(tabId)) {
    setPanelTab(tabId)
    return
   }
   setPanelTab('growth')
  }

  function openPoetryModule() {
   if (!POETRY_ENTRY_ENABLED) return
   openPanelTab('poetry')
   setPanelOpen(true)
  }

  function openSettingsPanel() {
   openPanelTab('settings')
   setPanelOpen(true)
  }

  function openPanel(tab) {
   noteInteraction()
   panelOpensRef.current += 1
   if (tab === 'settings' || tab === 'growth' || tab === 'poetry' || POETRY_TABS.some((item) => item.id === tab)) {
    openPanelTab(tab)
   } else {
    openPanelTab('growth')
   }
   setPanelOpen(true)
  }

  function advanceStep() {
   setStep((current) => (current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1))
   wakeSpontaneous(nextSpontEventDelay())
  }

  function handleMascotTap() {
   if (settingsRef.current.hidden) return
   const now = Date.now()
   clicksRef.current += 1
   noteInteraction()
   const eggState = readMascotEggState(now)
   if (shouldShowDailyGreet(eggState, now)) {
    writeMascotEggState(recordMascotEgg(eggState, { greet: true }, now))
    showMascotExpression(MASCOT_EXPRESSION_FILES[0])
   }
   if (!settingsRef.current.tutorialSeen) updateSettings({ tutorialSeen: true })
   if (panelOpen) {
    setPanelOpen(false)
    return
   }
   // v1.77：诗笺气泡已收进诗词二级菜单；主点击只打开成长面板。
   if (step >= 0) {
    advanceStep()
    return
   }
   openPanel('growth')
  }

  /** 从诗词二级菜单启动 6 步诗笺气泡（v1.77）。 */
  function startPoetryTour() {
   noteInteraction()
   setPanelOpen(false)
   setStep(0)
   if (typeof document !== 'undefined' && document.documentElement) {
    try {
     document.documentElement.scrollTop = document.documentElement.scrollTop
    } catch {
     /* ignore */
    }
   }
  }

  function handleMascotKeyDown(event) {
   if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    handleMascotTap()
   }
  }

  function triggerDizzy() {
   if (settingsRef.current.hidden) return
   const entries = petMediaEntriesRef.current || []
   const entry = pickDizzyMedia(entries)
   const file = entry && isVideoMoodFile(entry.file) ? entry.file : ''
   if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current)
   setDizzy({ file, label: entry ? String(entry.label || '') : '' })
   clearMotionTimers()
   if (motionFileRef.current) setMotionFile('')
   dizzyTimerRef.current = setTimeout(() => {
    dizzyTimerRef.current = null
    setDizzy(null)
    if (settingsRef.current.mood && petMediaEntriesRef.current.length && !uiRef.current.panelOpen) {
     scheduleMotion(nextMotionDelay())
    }
   }, nextDizzyDuration())
   noteInteraction()
  }

  function maybeTriggerMeal() {
   if (!settingsRef.current || settingsRef.current.hidden) return
   if (mealActiveRef.current) return
   const now = Date.now()
   const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
   const state = readMealState(now)
   const moment = mealTriggerFor({ now, hidden: settingsRef.current.hidden, panelOpen: uiRef.current.panelOpen, visible, state })
   if (!moment) return
   writeMealState(markMealDone(state, moment.meal, now))
   const entry = pickMealMedia(petMediaEntriesRef.current || [], moment.meal)
   const file = entry && entry.file ? entry.file : 'dsh-whale-state-daily-eat.webp'
   const text = moment.meal === 'lunch'
    ? '到饭点啦，我去吃午饭，你也记得吃。这顿用 token 换的白饭。'
    : '到饭点啦，我去吃' + moment.label + '，你也记得吃。'
   const active = { meal: moment.meal, label: moment.label, file, text }
   mealActiveRef.current = active
   setMealActive(active)
   clearMotionTimers()
   if (motionFileRef.current) setMotionFile('')
   if (mealTimerRef.current) clearTimeout(mealTimerRef.current)
   mealTimerRef.current = setTimeout(() => {
    mealTimerRef.current = null
    mealActiveRef.current = null
    setMealActive(null)
    if (settingsRef.current.mood && petMediaEntriesRef.current.length && !uiRef.current.panelOpen) {
     scheduleMotion(nextMotionDelay())
    }
   }, nextMealDuration())
  }

  function handlePointerDown(event) {
   if (event.button !== undefined && event.button !== 0) return
   // 用户一碰她，就停下溜达、安静一会儿。
   setWalking(false)
   wanderRef.current.walking = false
   setWanderFile('')
   if (wanderRef.current.timer) clearTimeout(wanderRef.current.timer)
   wanderRef.current.timer = null
   wanderRef.current.nextAt = Date.now() + 10 * 60 * 1000
   const pointerTime = typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now()
   dragRef.current = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: posRef.current.x,
    baseY: posRef.current.y,
    lastX: event.clientX,
    lastY: event.clientY,
    lastT: pointerTime,
    fast: false,
    moved: false,
   }
   try {
    event.currentTarget.setPointerCapture(event.pointerId)
   } catch (error) {
   }
   if (event.cancelable) event.preventDefault()
  }

  function handlePointerMove(event) {
   const drag = dragRef.current
   if (!drag || drag.id !== event.pointerId) return
   const dx = event.clientX - drag.startX
   const dy = event.clientY - drag.startY
   if (!drag.moved && Math.max(Math.abs(dx), Math.abs(dy)) > 3) drag.moved = true
   if (!drag.moved) return
   const pointerTime = typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now()
   if (detectFastDrag({ x: drag.lastX, y: drag.lastY, t: drag.lastT }, { x: event.clientX, y: event.clientY, t: pointerTime })) drag.fast = true
   drag.lastX = event.clientX
   drag.lastY = event.clientY
   drag.lastT = pointerTime
   setPos(clampPosition({ x: drag.baseX + dx, y: drag.baseY + dy }, mascotSize, viewport))
  }

  function finishPointer(event, cancelled) {
   const drag = dragRef.current
   if (!drag || (event && drag.id !== event.pointerId)) return
   dragRef.current = null
   try {
    if (event && event.currentTarget && event.currentTarget.releasePointerCapture) {
    event.currentTarget.releasePointerCapture(event.pointerId)
    }
   } catch (error) {
   }
   if (cancelled) return
   if (!drag.moved) {
    handleMascotTap()
    return
   }
   if (drag.fast) triggerDizzy()
   const current = posRef.current
   let snap = 'free'
   if (current.x <= 40) snap = 'left'
   else if (current.x + mascotSize >= viewport.w - 40) snap = 'right'
   const snapped = anchorPosition(snap, mascotSize, viewport, current)
   if (snapped.x !== current.x || snapped.y !== current.y) setPos(snapped)
   if (snap !== settingsRef.current.snap) updateSettings({ snap })
  }

  function handlePointerUp(event) {
   finishPointer(event, false)
  }

  function handlePointerCancel(event) {
   finishPointer(event, true)
  }

  function handleRestorePointerDown(event) {
   if (event.button !== undefined && event.button !== 0) return
   if (event.cancelable) event.preventDefault()
   if (pressTimer.current) clearTimeout(pressTimer.current)
   pressTimer.current = setTimeout(() => {
    pressTimer.current = null
    restoreWidget()
   }, 1200)
  }

  function handleRestorePointerUp() {
   if (pressTimer.current) {
    clearTimeout(pressTimer.current)
    pressTimer.current = null
   }
  }

  function changePoem() {
   noteInteraction()
   if (weatherActive && weatherPool.length) {
    const currentIndex = weatherPool.findIndex((entry) => entry.id === (poem && poem.id))
    const nextEntry = weatherPool[(currentIndex + 1 + weatherPool.length) % weatherPool.length]
    userPickedPoemRef.current = true
    setSelectedPoemId(nextEntry.id)
    return
   }
   const items = poemItems
   if (!items.length) {
    if (poemsRes.status === 'error') reloadPoems().catch(() => {})
    else showToast(poemsRes.status === 'loading' ? '诗库加载中，请稍候' : '诗库暂时不可用')
    return
   }
   const nextId = selectNextPoemId({
    items,
    currentId: poem && poem.id,
    todayId: activeTodayPoemId,
    mode: settingsRef.current.mode,
   })
   if (!nextId) {
    showToast('暂无可用的诗篇')
    return
   }
   userPickedPoemRef.current = true
   setSelectedPoemId(nextId)
   if (settingsRef.current.mode === 'random' && nextId !== activeTodayPoemId) {
    saverRef.current.save({ lastPoemId: nextId })
   }
  }

  function backToToday() {
   noteInteraction()
   if (!activeTodayPoemId) {
    showToast('今日诗尚未就绪')
    return
   }
   if (poem && poem.id === activeTodayPoemId) return
   userPickedPoemRef.current = true
   setSelectedPoemId(activeTodayPoemId)
   if (settingsRef.current.mode === 'random') saverRef.current.save({ lastPoemId: activeTodayPoemId })
  }

  function resetSettings() {
   updateSettings({
    scale: DEFAULT_SETTINGS.scale,
    showTones: DEFAULT_SETTINGS.showTones,
    mode: DEFAULT_SETTINGS.mode,
    autoplay: DEFAULT_SETTINGS.autoplay,
    snap: DEFAULT_SETTINGS.snap,
    script: DEFAULT_SETTINGS.script,
    hidden: DEFAULT_SETTINGS.hidden,
    theme: DEFAULT_SETTINGS.theme,
    lastPoemId: DEFAULT_SETTINGS.lastPoemId,
    tutorialSeen: DEFAULT_SETTINGS.tutorialSeen,
   })
   showToast('已恢复默认设置')
  }

  function retryBootstrap() {
   setReloadTick((tick) => tick + 1)
  }

  /** 气泡「来一局」：打开面板飞花 tab 并自增启动令牌（FeihuaTab 见令牌自动开局）。 */
  function openFeihuaGame() {
   openPanelTab('feihua')
   setPanelOpen(true)
   setFeihuaLaunch((token) => token + 1)
   pulseMascot('gameThink')
  }

  function takeCachedSelfTalk(kind) {
   const list = selfTalkCacheRef.current[kind]
   if (Array.isArray(list) && list.length) return list.shift()
   return ''
  }

  function rememberSpoken(card) {
   if (!card || card.type !== 'murmur' || !card.text) return
   const clean = String(card.text).trim()
   if (!clean) return
   const list = recentSpokenRef.current.filter((value) => value !== clean)
   list.push(clean)
   recentSpokenRef.current = list.slice(-SELF_TALK_RECENT_MAX)
  }

  function spontPools() {
   const ui = uiRef.current
   return {
    poemsData: { items: ui.poemItems },
    ciData: { items: ui.ciItems },
    anthologyData: { items: ui.anthologyItems },
    bankData: { items: ui.bankItems },
    ciBankData: { items: ui.ciBankItems },
   }
  }

  function murmurCardFromText(text) {
   const value = String(text == null ? '' : text).trim()
   return {
    type: 'murmur',
    id: 'model-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    text: value,
    line: value,
    tags: [],
    tag: 'model',
    title: '它说：',
   }
  }

  function showSpontCard(card, options) {
   if (!card) return null
   const opts = options || {}
   if (opts.record === true && opts.state) {
    writeSpontState(recordSpontShown(opts.state, card.id, Date.now(), card.type, card.tag || card.kind || ''))
   }
   if (opts.remember !== false) rememberSpoken(card)
   setSpontPreview(opts.preview === true)
   setSpontPoem(card)
   return card
  }

  /**
   * 触发一次自言自语：poem 走本地诗句；murmur/hybrid 先请求 host self-talk，
   * 生成中显示「它正在想…」占位，失败静默回退本地静态池。
   */
  function startSpontaneousCard(options) {
   const opts = options && typeof options === 'object' ? options : {}
   const ui = uiRef.current
   const now = Date.now()
   const state = readSpontState(now)
   const moodKey = ui.moodView && ui.moodView.key && ui.moodView.key !== 'ai' ? ui.moodView.key : 'calm'
   const preview = opts.preview === true
   const record = opts.record === true
   // v2.9：自动轮询只在“有新东西”或过了 20 分钟时才说；手动预览/再说一句不受限。
   if (record && !preview) {
    const signature = selfTalkNoveltySignature({
     selfStatus: selfStatusRef.current,
     mood: moodViewRef.current,
     weather: weatherRef.current,
     now,
    })
    const last = selfTalkNoveltyRef.current
    if (last.signature === signature && now - last.at < 20 * 60 * 1000) return null
    if (last.signature === '' && last.at > 0 && now - last.at < 60 * 1000) return null
    selfTalkNoveltyRef.current = { signature, at: now }
   }
   const recent = recentSpokenRef.current.slice(-SELF_TALK_RECENT_MAX)
   const showMurmur = (line) => showSpontCard(murmurCardFromText(line), { preview, record, state })
   const cached = takeCachedSelfTalk('murmur')
   if (cached) {
    return showMurmur(cached)
   }
   const token = spontReqRef.current + 1
   spontReqRef.current = token
   setSpontPreview(preview)
   setSpontPoem({ type: 'thinking', title: '它正在想…', line: '', placeholder: true })
   const idleMinutes = lastInteractionRef.current > 0 ? Math.max(0, Math.floor((now - lastInteractionRef.current) / 60000)) : 0
   const weatherValue = weatherRef.current ? String(weatherRef.current.category || weatherRef.current.label || '') : ''
   const view = ui.moodView || null
   const moodLabel = view && typeof view.label === 'string' ? view.label.trim() : ''
   const moodReason = view && typeof view.reason === 'string' ? view.reason.trim() : ''
   const image = view && typeof view.image === 'string' ? view.image.trim() : ''
   const imageLabel = moodLabel
   requestSelfTalk({ kind: 'murmur', moodKey, moodLabel, moodReason, image, imageLabel, weather: weatherValue, idleMinutes, recent }).then((result) => {
    if (token !== spontReqRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
     setSpontPoem((current) => (current && current.type === 'thinking' ? null : current))
     return
    }
    if (!result || !result.ok || !result.line) {
     selfTalkNoveltyRef.current = { signature: '', at: Date.now() }
     setSpontPoem(null)
     return
    }
    if (recent.indexOf(result.line) >= 0) {
     if (result.next && recent.indexOf(result.next) < 0) {
      showMurmur(result.next)
     } else {
      setSpontPoem(null)
     }
     return
    }
    if (result.next && recent.indexOf(result.next) < 0) {
     const list = selfTalkCacheRef.current.murmur.concat([result.next])
     selfTalkCacheRef.current.murmur = list.slice(-2)
    }
    showMurmur(result.line)
   }).catch(() => {
    if (token !== spontReqRef.current) return
    selfTalkNoveltyRef.current = { signature: '', at: Date.now() }
    setSpontPoem(null)
   })
   return null
  }

  function previewSpontaneousPoem() {
   return startSpontaneousCard({ preview: true, record: false })
  }

  function readAnotherSpontaneous() {
   return startSpontaneousCard({ preview: false, record: false })
  }
  function previewSpontaneousPoem(forceType) {
   return startSpontaneousCard({ forceType, preview: true, record: false })
  }

  function readAnotherSpontaneous() {
   const current = spontPoemRef.current
   const avoidType = current && current.type !== 'thinking' ? current.type : ''
   return startSpontaneousCard({ avoidType, preview: false, record: false })
  }
  function requestCiBank() {
   setCiBankWanted(true)
  }

  function consumeLibraryFocus() {
   setLibraryFocus(null)
  }

  function openCiSelectedForRhythmic(rhythmic) {
   setLibraryFocus({ type: 'ci-selected', rhythmic: String(rhythmic || ''), token: Date.now() })
   openPanelTab('library')
   setPanelOpen(true)
   noteInteraction()
  }

  function openCiBankForRhythmic(rhythmic) {
   setCiBankWanted(true)
   setLibraryFocus({ type: 'ci', rhythmic: String(rhythmic || ''), token: Date.now() })
   openPanelTab('library')
   setPanelOpen(true)
   noteInteraction()
  }

  function openSpontPoem() {
   const picked = spontPoemRef.current
   if (!picked) return
   if (picked.type === 'murmur') {
    setSpontPoem(null)
    return
   }
   setSpontPreview(false)
   setSpontPoem(null)
   setPanelOpen(true)
   if (picked.kind === 'poem') {
    userPickedPoemRef.current = true
    setSelectedPoemId(picked.id)
    openPanelTab('today')
   } else if (picked.kind === 'ci') {
    openPanelTab('ci')
   } else {
    setLibraryFocus({ id: picked.id, source: picked.kind, token: Date.now() })
    openPanelTab('library')
   }
  }

  /** FeihuaTab 消费启动令牌后归零，避免后续从 tab 栏进入时重复自动开局。 */
  function consumeFeihuaLaunch() {
   setFeihuaLaunch(0)
  }
  const dateSeed = (boot.data && boot.data.today && boot.data.today.date) || ''
  const dateLabel = formatDateLabel(dateSeed)

  /** 气泡第 6 张卡：飞花令入口（今日令字 + 句数 + 历史最佳 + 来一局）。 */
  function clearMotionTimers() {
   if (motionDelayTimerRef.current) {
    clearTimeout(motionDelayTimerRef.current)
    motionDelayTimerRef.current = null
   }
   if (motionStopTimerRef.current) {
    clearTimeout(motionStopTimerRef.current)
    motionStopTimerRef.current = null
   }
  }

  function currentMoodImageFile() {
   const view = moodViewRef.current
   return view && view.image ? String(view.image) : ''
  }

  function scheduleMotion(delay) {
   if (motionDelayTimerRef.current) clearTimeout(motionDelayTimerRef.current)
   motionDelayTimerRef.current = setTimeout(() => {
    motionDelayTimerRef.current = null
    tryStartMotion()
   }, Math.max(1000, num(delay, nextMotionDelay())))
  }

  function scheduleInitialMotion() {
   const first = !motionFirstScheduledRef.current
   const delay = nextMotionScheduleDelay({ first, moodImage: currentMoodImageFile() })
   motionFirstScheduledRef.current = true
   motionFirstPendingRef.current = first && !isVideoMoodFile(currentMoodImageFile())
   scheduleMotion(delay)
  }

  function tryStartMotion() {
   const entries = petMediaEntriesRef.current
   const ui = uiRef.current
   if (!entries || !entries.length) return
   if (!ui.settings.mood || ui.settings.hidden) return
   if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
   if (ui.panelOpen) return
   if (dizzyRef.current || mealActiveRef.current) {
    scheduleMotion(nextMotionDelay())
    return
   }
   if (mascotPulseRef.current || mascotExpressionRef.current) {
    scheduleMotion(nextMotionDelay())
    return
   }
   if (wanderRef.current.walking) {
    scheduleMotion(nextMotionDelay())
    return
   }
   if (motionFileRef.current) return
   const picked = nextMotionEntry(entries, motionIndexRef.current)
   if (!picked.entry) return
   motionIndexRef.current = picked.index
   motionFirstPendingRef.current = false
   writeMotionRotation(picked.index)
   setMotionFile(picked.entry.file)
   motionStopTimerRef.current = setTimeout(() => {
    motionStopTimerRef.current = null
    setMotionFile('')
    scheduleMotion(nextMotionDelay())
   }, nextMotionDuration())
  }

  function handleMascotMediaError(file) {
   if (dizzyRef.current && dizzyRef.current.file && file === dizzyRef.current.file) {
    setDizzy((current) => (current ? Object.assign({}, current, { file: '' }) : current))
    return
   }
   if (mealActiveRef.current && file === mealActiveRef.current.file) {
    setMealActive((current) => (current ? Object.assign({}, current, { file: 'dsh-whale-state-daily-eat.webp' }) : current))
    return
   }
   if (wanderFileRef.current && file === wanderFileRef.current) {
    if (file === WANDER_STATIC_FILE) {
     setWanderFile('')
    } else {
     setWanderFile(WANDER_STATIC_FILE)
    }
    return
   }
   if (motionFileRef.current && file === motionFileRef.current) {
    if (motionStopTimerRef.current) {
     clearTimeout(motionStopTimerRef.current)
     motionStopTimerRef.current = null
    }
    setMotionFile('')
    scheduleMotion(nextMotionDelay())
    return
   }
   setFailedMascot(file)
  }

  React.useEffect(() => {
   if (!settings.mood || settings.hidden || panelOpen || petMediaRes.status !== 'ready' || !petMediaRes.entries.length) {
    clearMotionTimers()
    if (motionFileRef.current) setMotionFile('')
    return undefined
   }
   scheduleInitialMotion()
   return () => {
    clearMotionTimers()
   }
  }, [settings.mood, settings.hidden, panelOpen, petMediaRes.status, petMediaRes.entries.length])

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
     clearMotionTimers()
     if (motionFileRef.current) setMotionFile('')
     return
    }
    if (settingsRef.current.mood && !uiRef.current.panelOpen && petMediaEntriesRef.current.length) {
     scheduleMotion(nextMotionDelay())
    }
   }
   document.addEventListener('visibilitychange', onVisibility)
   return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  React.useEffect(() => {
   if (!motionFirstPendingRef.current) return
   const image = currentMoodImageFile()
   if (!isVideoMoodFile(image)) return
   motionFirstPendingRef.current = false
   clearMotionTimers()
   scheduleMotion(nextMotionDelay())
  }, [moodView])

  React.useEffect(() => {
   if (!settings.hidden) {
    maybeTriggerMeal()
   }
   const timer = setInterval(() => {
    maybeTriggerMeal()
   }, 60 * 1000)
   const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    maybeTriggerMeal()
   }
   const onFocus = () => maybeTriggerMeal()
   if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
   if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus)
   return () => {
    clearInterval(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus)
   }
  }, [settings.hidden])

  React.useEffect(() => {
   if (panelOpen) {
    mealPrevPanelRef.current = true
    return
   }
   if (mealPrevPanelRef.current) {
    mealPrevPanelRef.current = false
    maybeTriggerMeal()
   }
  }, [panelOpen])

  React.useEffect(() => {
   if (!(panelOpen || settings.hidden)) return
   if (dizzyTimerRef.current) {
    clearTimeout(dizzyTimerRef.current)
    dizzyTimerRef.current = null
   }
   if (dizzyRef.current) setDizzy(null)
   if (mealTimerRef.current) {
    clearTimeout(mealTimerRef.current)
    mealTimerRef.current = null
   }
   if (mealActiveRef.current) {
    setMealActive(null)
    mealActiveRef.current = null
   }
  }, [panelOpen, settings.hidden])

  React.useEffect(() => () => {
   if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current)
   if (mealTimerRef.current) clearTimeout(mealTimerRef.current)
  }, [])

  // 成长状态 + 自主行为：App 级 60s 轮询 self.json（页面隐藏跳过、失败静默）
  React.useEffect(() => {
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(SELF_PATH).then((data) => {
     if (alive) setSelfStatus(normalizeSelfStatus(data))
    }).catch(() => {
     if (alive) setSelfStatus(null)
    })
   }
   load()
   const timer = setInterval(load, SELF_POLL_MS)
   const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    load()
   }
   if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVisibility)
   return () => {
    alive = false
    clearInterval(timer)
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVisibility)
   }
  }, [])

  function showSelfAction(action) {
   if (!action || !action.id) return
   lastSeenActionIdRef.current = action.id
   writeSeenActionId(action.id)
   showSpontCard(
    { id: 'action:' + action.id, type: 'murmur', title: '自己', line: String(action.text || action.label || ''), tag: 'action' },
    { preview: true, record: false, remember: false },
   )
  }

  React.useEffect(() => {
   const latest = selfStatus && selfStatus.actions ? selfStatus.actions.latest : null
   if (!latest || !latest.id) return
   if (lastSeenActionIdRef.current === latest.id) return
   if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    pendingActionRef.current = latest
    return
   }
   showSelfAction(latest)
  }, [selfStatus])

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   const onVisibility = () => {
    if (document.visibilityState === 'hidden') return
    const pending = pendingActionRef.current
    if (!pending) return
    pendingActionRef.current = null
    showSelfAction(pending)
   }
   document.addEventListener('visibilitychange', onVisibility)
   return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 记忆中枢：仅面板打开且停在成长 tab 时轮询 memory.json（隐藏跳过、失败静默）
  React.useEffect(() => {
   if (!panelOpen || panelTab !== 'growth' || settings.hidden) {
    setMemoryStatus(null)
    return undefined
   }
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(MEMORY_PATH).then((data) => {
     if (alive) setMemoryStatus(normalizeMemoryStatus(data))
    }).catch(() => {
     if (alive) setMemoryStatus(null)
    })
   }
   load()
   const timer = setInterval(load, MEMORY_POLL_MS)
   const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    load()
   }
   if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVisibility)
   return () => {
    alive = false
    clearInterval(timer)
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVisibility)
   }
  }, [panelOpen, panelTab, settings.hidden, memoryTick])

  // 用户在场（v2.25）：只上报“我在”，不发送点击内容；60s 节流。
  React.useEffect(() => {
   let lastAt = 0
   const send = (kind) => {
    const now = Date.now()
    if (now - lastAt < PRESENCE_THROTTLE_MS) return
    lastAt = now
    fetchJson(PRESENCE_PATH, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ kind }),
    }).catch(() => {})
   }
   const onPointer = () => send('tap')
   const onKey = () => send('tap')
   const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') send('tap')
   }
   if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onPointer, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
   }
   if (typeof window !== 'undefined') window.addEventListener('keydown', onKey)
   return () => {
    if (typeof document !== 'undefined') {
     document.removeEventListener('pointerdown', onPointer)
     document.removeEventListener('visibilitychange', onVisibility)
    }
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey)
   }
  }, [])

  // 作品（v2.11）：面板停在成长 tab 时轮询 works.json，只读展示最近的作品。
  React.useEffect(() => {
   if (!panelOpen || panelTab !== 'growth' || settings.hidden) {
    setWorksRes({ status: 'idle', data: null })
    return undefined
   }
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(WORKS_PATH).then((data) => {
     if (alive) setWorksRes({ status: 'ready', data: normalizeWorks(data) })
    }).catch(() => {
     if (alive) setWorksRes({ status: 'error', data: null })
    })
   }
   load()
   const timer = setInterval(load, WORKS_POLL_MS)
   return () => {
    alive = false
    clearInterval(timer)
   }
  }, [panelOpen, panelTab, settings.hidden])

  // 成长史（v3.18）：面板停在成长 tab 时轮询 growth.json，展示阶段/里程碑/自传。
  React.useEffect(() => {
   if (!panelOpen || panelTab !== 'growth' || settings.hidden) {
    setGrowthRes({ status: 'idle', data: null })
    return undefined
   }
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(GROWTH_PATH).then((data) => {
     if (alive) setGrowthRes({ status: 'ready', data })
    }).catch(() => {
     if (alive) setGrowthRes({ status: 'error', data: null })
    })
   }
   load()
   const timer = setInterval(load, GROWTH_POLL_MS)
   return () => {
    alive = false
    clearInterval(timer)
   }
  }, [panelOpen, panelTab, settings.hidden])

  // 注意力：面板打开时轮询 attention.json；只在有 pending 时展示，健康时安静。
  React.useEffect(() => {
   if (!panelOpen || settings.hidden) {
    setAttentionRes({ status: 'idle', data: null })
    return undefined
   }
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(ATTENTION_PATH).then((data) => {
     if (alive) setAttentionRes({ status: 'ready', data: normalizeAttention(data) })
    }).catch(() => {
     if (alive) setAttentionRes({ status: 'error', data: null })
    })
   }
   load()
   const timer = setInterval(load, ATTENTION_POLL_MS)
   return () => {
    alive = false
    clearInterval(timer)
   }
  }, [panelOpen, settings.hidden])

  // 镜像在做什么：面板打开时轮询 twin.json；没有项目就安静。
  React.useEffect(() => {
   if (!panelOpen || panelTab !== 'growth' || settings.hidden) {
    setTwinRes({ status: 'idle', data: null })
    return undefined
   }
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(TWIN_PATH).then((data) => {
     if (alive) setTwinRes({ status: 'ready', data: normalizeTwinState(data) })
    }).catch(() => {
     if (alive) setTwinRes({ status: 'error', data: null })
    })
   }
   load()
   const timer = setInterval(load, TWIN_POLL_MS)
   return () => {
    alive = false
    clearInterval(timer)
   }
  }, [panelOpen, panelTab, settings.hidden])

  // 运行状态（v1.83）：面板停在设置 tab 时轮询 health.json，只读展示预算/心跳/模型失败。
  React.useEffect(() => {
   if (!panelOpen || (panelTab !== 'settings' && panelTab !== 'growth') || settings.hidden) {
    setHealthStatus(null)
    return undefined
   }
   let alive = true
   const load = () => {
    if (!alive) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    fetchJson(HEALTH_PATH).then((data) => {
     if (alive) setHealthStatus(normalizeHealthStatus(data))
    }).catch(() => {
     if (alive) setHealthStatus(null)
    })
   }
   load()
   const timer = setInterval(load, HEALTH_POLL_MS)
   return () => {
    alive = false
    clearInterval(timer)
   }
  }, [panelOpen, panelTab, settings.hidden])

  function loadProjectDetail() {
   return fetchJson(PROJECT_PATH).then((data) => {
    if (data && data.ok === true) setProjectDetail(data)
    return data
   }).catch(() => null)
  }

  function projectAction(action) {
   const current = selfStatus && selfStatus.project
   if (!current || !current.id) return Promise.resolve({ ok: false })
   return fetchJsonUrl(ROUTE + PROJECT_ACTION_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: current.id }) }).then((data) => {
    if (data && data.ok === true) {
     showToastRef.current(action === 'drop' ? '项目已放下' : action === 'pause' ? '先暂停' : '继续做')
     return fetchJson(SELF_PATH).then((next) => {
      setSelfStatus(normalizeSelfStatus(next))
      return data
     }).catch(() => data)
    }
    showToastRef.current('项目状态没变', 'error')
    return data
   }).catch(() => {
    showToastRef.current('项目状态没变', 'error')
    return { ok: false }
   })
  }

  function attentionAction(id, action, text) {
   const payload = { action, id }
   if (typeof text === 'string' && text.length > 0) payload.text = text
   return fetchJsonUrl(ROUTE + ATTENTION_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((data) => {
    if (data && data.ok === true) {
     showToastRef.current(action === 'send' ? '已发出去' : '先压下了')
    } else {
     showToastRef.current('没发出去', 'error')
    }
    setAttentionRes((current) => ({ ...current, data: null }))
    return data
   }).catch(() => {
    showToastRef.current('没发出去', 'error')
    return { ok: false }
   })
  }

  function setAttentionMode(mode) {
   return fetchJsonUrl(ROUTE + ATTENTION_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mode', mode }) }).then((data) => {
    if (data && data.ok === true) {
     showToastRef.current(data.mode === 'auto' ? '主动消息：自动' : '主动消息：观察中')
    }
    return data
   }).catch(() => ({ ok: false }))
  }

  function backupMemory() {
   return fetchJsonUrl(ROUTE + MEMORY_BACKUP_PATH, { method: 'POST' }).then((data) => {
    showToastRef.current('已备份')
    setMemoryTick((tick) => tick + 1)
    return data
   }).catch(() => {
    showToastRef.current('备份失败', 'error')
    return { ok: false }
   })
  }

  const syncMascotVideoPlayback = React.useCallback(() => {
   const video = mascotVideoRef.current
   if (!video) return
   const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
   const shouldPause = mascotVideoShouldPause({ hidden, panelOpen })
   try {
    if (shouldPause) {
     if (typeof video.pause === 'function') video.pause()
    } else if (typeof video.play === 'function') {
     const played = video.play()
     if (played && typeof played.catch === 'function') played.catch(() => {})
    }
   } catch (error) {
   }
  }, [panelOpen])

  React.useEffect(() => {
   syncMascotVideoPlayback()
  })

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   document.addEventListener('visibilitychange', syncMascotVideoPlayback)
   return () => document.removeEventListener('visibilitychange', syncMascotVideoPlayback)
  }, [syncMascotVideoPlayback])

  React.useEffect(() => () => {
   const video = mascotVideoRef.current
   if (video && typeof video.pause === 'function') {
    try {
     video.pause()
    } catch (error) {
    }
   }
  }, [])

  function renderPanelTab() {
   const api = {
    settings: settingsRef.current,
    updateSettings,
    showToast,
    hideWidget,
    resetSettings,
    poem,
    todayPoemId: activeTodayPoemId,
    poemItems,
    poemsRes,
    knowledgeRes,
    yunRes,
    ciRes,
    reloadPoems,
    reloadKnowledge,
    reloadYun,
    reloadCi,
    retryBootstrap,
    boot,
    dateLabel,
    dateSeed,
    changePoem,
    backToToday,
    feihuaLaunch,
    consumeFeihuaLaunch,
    openFeihuaGame,
    weatherRes,
    weatherData,
    weather,
    weatherActive,
    weatherChip,
    weatherNote,
    refreshWeather,
    pulseMascot,
    moodView,
    moodRes,
    moodChip,
    moodChipTitle,
    moodBasis,
    moodSource,
    moodAiFallback,
    moodAiStale,
    moodAiFailure,
    moodAiFailureCode,
    petVideoCount: petMediaRes.entries.length,
    selfStatus,
    memoryStatus,
    healthStatus,
    worksRes,
    growthRes,
    attentionRes,
    attentionAction,
    projectAction,
    projectDetail,
    twinRes,
    loadProjectDetail,
    setAttentionMode,
    backupMemory,
    refreshMoodNow,
    previewSpontaneousPoem,
    readAnotherSpontaneous,
    recentSpoken: recentSpokenRef.current.slice(-5),
    openPoetryModule,
    poetryEntryEnabled: POETRY_ENTRY_ENABLED,
    startPoetryTour,
    openSettings: openSettingsPanel,
    openPanel,
    openPanelTab,
    anthologyRes,
    bankRes,
    pingshuiRes,
    reloadAnthology,
    reloadBank,
    reloadPingshui,
    libraryFocus,
   }
   if (panelTab !== 'poetry') return h(panelTabs.componentFor(panelTab), { api })
   if (panelTab === 'poetry') {
    if (poetryTab === 'poetry-settings') return h(PoetrySettingsTab, { api })
    if (poetryTab === 'class') return h(ClassTab, { api })
    if (poetryTab === 'yun') return h(YunTab, { api })
    if (poetryTab === 'ci') return h(CiTab, { api })
    if (poetryTab === 'library') return h(LibraryTab, { api })
    if (poetryTab === 'feihua') return h(FeihuaTab, { api })
    return h(TodayTab, { api })
   }
   return h(GrowthTab, { api })
  }


  /** 容器组合：把状态/回调装进 props，交给无 hooks 的视图函数。 */
  function closeSpont(event) {
   if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
   spontReqRef.current += 1
   selfTalkNoveltyRef.current = { signature: '', at: 0 }
   setSpontPreview(false)
   setSpontPoem(null)
  }

  const stepContent = StepContent({
   step,
   poem,
   weatherChip,
   moodChip,
   moodChipTitle,
   weatherNote,
   dateLabel,
   settings,
   boot,
   poemsRes,
   reloadPoems,
   retryBootstrap,
   knowledgeRes,
   reloadKnowledge,
   yunRes,
   reloadYun,
   ciRes,
   reloadCi,
   dateSeed,
   feihuaIndex,
   anthologyRes,
   bankRes,
   feihuaBuilding,
   ciBankRes,
   openFeihuaGame,
  })
  const nodes = [h('style', { key: 'dshp-style' }, CSS)]
  if (settings.hidden) {
   nodes.push(RestoreHotspotView({
    handleRestorePointerDown,
    handleRestorePointerUp,
    restoreWidget,
   }))
  } else {
   nodes.push(MascotView({
    settings,
    step,
    panelOpen,
    weather,
    moodView,
    moodCatalog,
    panelTab,
    poetryTab,
    mascotPulse,
    mascotExpression,
    dizzy,
    mealActive,
    motionFile,
    wanderFile,
    failedMascot,
    mascotVideoRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleMascotKeyDown,
    noteInteraction,
    showMascotExpression,
    pickMascotExpression,
    setStep,
    openPanel,
    handleMascotMediaError,
   }))
   const bubbleNode = BubbleView({
    step,
    panelOpen,
    settings,
    viewport,
    pos,
    mascotSize,
    stepContent,
    poem,
    activeTodayPoemId,
    changePoem,
    backToToday,
    advanceStep,
    openPanel,
    setStep,
   })
   if (bubbleNode) nodes.push(bubbleNode)
   const panelNode = PanelView({
    panelOpen,
    settings,
    viewport,
    pos,
    mascotSize,
    panelTab,
    poetryTab,
    boot,
    panelTabs,
    panelBody: renderPanelTab(),
    setPanelOpen,
    setPoetryTab,
    openPanelTab,
    startPoetryTour,
   })
   if (panelNode) nodes.push(panelNode)
   const toastNode = ToastView({ toast, pos, viewport })
   if (toastNode) nodes.push(toastNode)
   const spontNode = SpontView({
    spontPoem,
    settings,
    panelOpen,
    step,
    spontPreview,
    viewport,
    pos,
    mascotSize,
    openSpontPoem,
    readAnotherSpontaneous,
    closeSpont,
   })
   if (spontNode) nodes.push(spontNode)
   const mealNode = MealTipView({ mealActive, viewport, pos, mascotSize })
   if (mealNode) nodes.push(mealNode)
  }
  return WidgetRoot({ settings, pos, walking, mascotSize, nodes })
  }

  // v1.85：诗词基础 tab 已移到 tabs-poetry.js；这里用惰性包装保持 DEBUG/渲染引用不变。
  let poetryTabs = null
  function ensurePoetryTabs() {
   if (poetryTabs === null) {
    poetryTabs = createPoetryTabs({
     React,
     h,
     EmptyState,
     LoadingState,
     PoemBody,
     AnalysisBody,
     KnowledgeCardView,
     describeDataError,
     normalizeSettings,
     cx,
     switchNode,
     num,
    })
   }
   return poetryTabs
  }
  function TodayTab(props) { return ensurePoetryTabs().TodayTab(props) }
  function ClassTab(props) { return ensurePoetryTabs().ClassTab(props) }
  function YunTab(props) { return ensurePoetryTabs().YunTab(props) }
  function CiTab(props) { return ensurePoetryTabs().CiTab(props) }
  function PoetrySettingsTab(props) { return ensurePoetryTabs().PoetrySettingsTab(props) }

  // v2.4：设置面板已移到 tabs-settings.js；惰性包装保持 DEBUG/渲染引用不变。
  let settingsTabFactory = null
  function ensureSettingsTab() {
   if (settingsTabFactory === null) {
    settingsTabFactory = createSettingsTab({
     React,
     h,
     cx,
     normalizeSettings,
     num,
     switchNode,
     growthMetricsTree,
     weatherChipText,
     weatherUpdatedLabel,
     moodBasisText,
     moodAiFailureLabel,
    })
   }
   return settingsTabFactory
  }
  function SettingsTab(props) { return ensureSettingsTab()(props) }

  // v2.4：成长主页已移到 tabs-growth.js。
  let growthTabFactory = null
  function ensureGrowthTab() {
   if (growthTabFactory === null) {
    growthTabFactory = createGrowthTab({
     h,
     cx,
     switchNode,
     growthMetricsTree,
     moodAiFailureLabel,
     selfStatusSummary,
     weatherUpdatedLabel,
    })
   }
   return growthTabFactory
  }
  function GrowthTab(props) { return ensureGrowthTab()(props) }

  // v2.94：认知图谱面板（面板内直接画图，不依赖单独路由）。
  let graphTabFactory = null
  function ensureGraphTab() {
   if (graphTabFactory === null) {
    graphTabFactory = createGraphTab({ React, h })
   }
   return graphTabFactory
  }
  function GraphTab(props) { return ensureGraphTab()(props) }

  // v2.4：飞花令面板已移到 tabs-feihua.js。
  let feihuaTabFactory = null
  function ensureFeihuaTab() {
   if (feihuaTabFactory === null) {
    feihuaTabFactory = createFeihuaTab({
     React,
     h,
     cx,
     EmptyState,
     LoadingState,
     ToneLine,
     detectionRhymeIndexes,
     formatDetectionReport,
     describeDataError,
     getFeihuaIndex,
     pickDefaultFeihuaChar,
     feihuaSourceOf,
     mergeFeihuaItems,
     finishFeihuaIndex,
     mergeFeihuaFullEntries,
     requestFeihuaFull,
     abortFeihuaFull,
     readFeihuaFullCache,
     readFeihuaBest,
     writeFeihuaBest,
     FEIHUA_ATLAS_PAGE,
     FEIHUA_FULL_RETRY_MS,
    })
   }
   return feihuaTabFactory
  }
  function FeihuaTab(props) { return ensureFeihuaTab().FeihuaTab(props) }
  function DetectionView(props) { return ensureFeihuaTab().DetectionView(props) }

  // v2.4：诗库面板已移到 tabs-library.js。
  let libraryTabFactory = null
  function ensureLibraryTab() {
   if (libraryTabFactory === null) {
    libraryTabFactory = createLibraryTab({
     React,
     LIBRARY_CATEGORIES,
     h,
     cx,
     EmptyState,
     LoadingState,
     DetectionView,
     ToneLine,
     describeDataError,
     Z_INDEX,
     WIDGET_ID,
     MASCOT_FILES,
     mascotUrl,
     detectPoem,
     detectPoemText,
     parsePoemInput,
     buildPingshuiIndex,
    })
   }
   return libraryTabFactory
  }
  function LibraryTab(props) { return ensureLibraryTab().LibraryTab(props) }
  // WidgetBoundary 是 class 组件，不能直接当函数调用；用函数包装成正常 React 组件。
  function WidgetBoundary(props) {
   const Boundary = ensureLibraryTab().WidgetBoundary
   return h(Boundary, null, props && props.children)
  }

  function apply(ctx) {
  const host = (props) => h(WidgetBoundary, null, h(PoetryWidget, Object.assign({}, props || {}, { ctx })))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
   { name: 'shell.overlay', id: WIDGET_ID, order: 80 },
   host,
  ))
  // v0.2.0：镜像副浮层从独立子插件并入（只读，twin 关闭时自动隐藏）。
  try {
   const TwinOverlay = createTwinOverlay({ h, React })
   ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-little-whale-twin', order: 81 },
    TwinOverlay,
   ))
  } catch (error) {
   try { ctx.logger && ctx.logger.warn && ctx.logger.warn('dsh-little-whale: 镜像浮层注册失败：' + String((error && error.message) || error)) } catch (_error) {}
  }
  try {
   if (ctx.logger && typeof ctx.logger.info === 'function') {
    ctx.logger.info('dsh-little-whale: 已注册 shell.overlay 挂件')
   }
  } catch (error) {
  }
  }

  return {
  inject: ['slots'],
  apply,
  }
 },
})

