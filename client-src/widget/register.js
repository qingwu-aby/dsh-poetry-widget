// client-src/widget/register.js —— 插件注册入口：组装运行时 / 数据资源 / DEBUG 契约 / shell.overlay 注册。
import { setRuntime } from './runtime.js'
import { PoetryWidget } from './container.js'
import {
  ClassTab,
  CiTab,
  DetectionView,
  FeihuaTab,
  GraphTab,
  GrowthTab,
  LibraryTab,
  PoetrySettingsTab,
  SettingsTab,
  TodayTab,
  WidgetBoundary,
  YunTab,
} from './tabs.js'
import { isVideoMoodFile } from '../base.js'
import { createHooks } from '../hooks.js'
import { createPanelTabRouter } from '../panel-tabs.js'
import { createTwinOverlay } from '../twin-overlay.js'
import { normalizeHealthStatus } from '../health-model.js'
import { DEFAULT_SETTINGS, normalizeSettings, settingsPatch, buildSettingsRequest, createSettingsSaver, selectNextPoemId } from '../settings-model.js'
import { TONE_QUATRAINS, buildToneCells, selectPoemText, selectCiText, poemRhymeLines, buildPingshuiIndex, annotatePoemLines, patternForShape, detectMetre, detectPoem, parsePoemInput, detectPoemText, formatDetectionReport, detectionRhymeIndexes } from '../poetry-engine.js'
import { SELF_TALK_PATH, SELF_TALK_RECENT_MAX, SELF_TALK_TIMEOUT_MS, SPONT_AUTO_CLOSE_MS, SPONT_CLOSE_RECHECK_MS, SPONT_EVENT_MAX_MS, SPONT_EVENT_MIN_MS, SPONT_KEY, SPONT_MAX_SEEN, SPONT_POLL_MAX_MS, SPONT_POLL_MIN_MS, SPONT_QUIET_MS, SPONT_REPEAT_MS, SPONT_RETRY_MS, SPONT_SEEN_DAYS, canShowSpontaneous, countSpontHits, nextSpontEventDelay, nextSpontPollDelay, normalizeSpontState, parseSelfTalkResponse, pickSentenceFromLines, recordSpontShown, selfTalkKindFor, selfTalkNoveltySignature, selfTalkQuery, splitCompleteSentences } from '../self-talk-client.js'
import { MOOD_AI_DEBOUNCE_MAX_MS, MOOD_AI_DEBOUNCE_MIN_MS, MOOD_AI_KEEP_MS, MOOD_AI_MAX_RETRIES, MOOD_AI_MIN_GAP_MS, MOOD_AI_PATH, MOOD_AI_RECENT_IMAGES_MAX, MOOD_AI_RECENT_MAX, MOOD_AI_RETRY_MAX_MS, MOOD_AI_RETRY_MIN_MS, MOOD_AI_TIMEOUT_MS, MOOD_IMAGES, MOOD_LABELS, MOOD_PANEL_PEEK_FILES, MOOD_STRONG, MOOD_SWITCH_MIN_MS, computeMood, isMoodAiSignificant, moodAiEventDelay, moodAiFailureLabel, moodAiKeepDecision, moodAiQuery, moodAiSnapshot, moodBasisText, moodCatalogAllows, moodTimeBucket, nextMoodAiDebounceDelay, nextMoodAiRetryDelay, normalizeMoodAiFailure, normalizeMoodCatalog, normalizeMoodStats, panelPeekFile, parseMoodAiResponse, shanghaiParts, throttleMoodSwitch } from '../mood-engine.js'
import { FEIHUA_ATLAS_LIMIT, FEIHUA_CANDIDATE_CHARS, FEIHUA_MIN_ENTRIES, buildFeihuaIndex, completeSentencesFromLines, feihuaBestUpdate, feihuaLookup, feihuaPlainOf, feihuaSourceOf, feihuaStart, feihuaSubmit, finishFeihuaIndex, mergeFeihuaFullEntries, mergeFeihuaItems, normalizeFeihuaBest } from '../feihua.js'
import { LIBRARY_CATEGORY_ALIASES, LIBRARY_PAGE, buildLibraryItems, ciBankRhythmics, ciSelectedLibraryItems, ciSelectedRhythmics, filterLibraryItems, libraryItemLabel, libraryPage } from '../library.js'
import { WANDER_MIN_DISTANCE, WANDER_STATIC_FILE, WANDER_TICK_MS, WANDER_WALK_MS, WINDOW_WANDER_ENABLED, nextWanderTarget, pickWanderMedia } from '../wander.js'
import { clearFirstScreenCache, fetchJsonUrl, readFirstScreenCache, writeFirstScreenCache } from '../data.js'
import { MASCOT_EGG_KEY, normalizeMascotEggState, readMascotEggState, recordMascotEgg, writeMascotEggState } from '../local-state.js'
import { createResourceStore } from '../resources.js'
import { ROUTE, SELF_PATH, SELF_POLL_MS, ACTION_SEEN_KEY, MEMORY_PATH, MEMORY_BACKUP_PATH, MEMORY_POLL_MS, ASSET_BASE, WIDGET_ID, STEPS, POETRY_TABS, FEIHUA_BEST_KEY, FEIHUA_ATLAS_PAGE, FEIHUA_FULL_PATH, FEIHUA_FULL_TIMEOUT_MS, FEIHUA_FULL_RETRY_MS, MASCOT_FILES, PET_MEDIA_PATH, PET_MEDIA_CATALOG_FILE, PET_MEDIA_TIMEOUT_MS, MOTION_ROTATION_KEY, MOTION_MIN_DELAY_MS, MOTION_MAX_DELAY_MS, MOTION_PLAY_MIN_MS, MOTION_PLAY_MAX_MS, MOTION_FIRST_MIN_DELAY_MS, MOTION_FIRST_MAX_DELAY_MS, DIZZY_MIN_MS, DIZZY_MAX_MS, DIZZY_FAST_PX_PER_SEC, DIZZY_FAST_DISTANCE_PX, DIZZY_FAST_WINDOW_MS, MEAL_KEY, MEAL_PLAY_MIN_MS, MEAL_PLAY_MAX_MS, ASSET_DATA_FILES, LIBRARY_CATEGORIES, MASCOT_EXPRESSION_MS, MASCOT_IDLE_MIN_MS, MASCOT_IDLE_USER_MS, MASCOT_EXPRESSION_FILES, RESOURCE_PATHS } from './models/constants.js'
import { hashString, formatDateLabel, clampPosition, anchorPosition, describeDataError } from './models/utils.js'
import { clearFeihuaFullCache, readFeihuaFullCache, abortFeihuaFull, requestFeihuaFull, getFeihuaIndex, clearFeihuaIndexCache, pickDefaultFeihuaChar, readFeihuaBest, writeFeihuaBest } from './models/feihua-model.js'
import { weatherPoemTags, countWeatherTagHits, buildWeatherPoemPool, selectWeatherPoemEntry, weatherChipText, weatherExplainText, weatherUpdatedLabel, requestWeather } from './models/weather-model.js'
import { mascotStateFor, mascotFileFor, mascotUrl, mascotImageFor, mascotVideoShouldPause, detectFastDrag, nextDizzyDuration, nextMealDuration, mealMomentFor, normalizeMealState, readMealState, writeMealState, markMealDone, mealTriggerFor, pickDizzyMedia, pickMealMedia, mascotFilePriority, petMediaUrl, normalizePetMediaCatalog, mergePetMediaIntoCatalog, clearPetMediaCache, requestPetMediaCatalog, readMotionRotation, writeMotionRotation, nextMotionEntry, nextMotionDelay, nextMotionFirstDelay, nextMotionScheduleDelay, nextMotionDuration, shouldShowDailyGreet, canShowIdlePose, pickMascotExpression } from './models/mascot-model.js'
import { requestMoodAi } from './models/mood-model.js'
import { normalizeSelfStatus, normalizeSelfAction, readSeenActionId, writeSeenActionId, selfStatusSummary, normalizeMemoryStatus } from './models/self-model.js'
import { readSpontState, writeSpontState, requestSelfTalk } from './models/spont-model.js'
import { assetUrlFor, fetchJson, putSettings } from './models/api.js'

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
  setRuntime({ React, h, resourceStore, useViewportSize, useResource, panelTabs })
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


