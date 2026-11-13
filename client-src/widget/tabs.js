// client-src/widget/tabs.js —— 面板 tab 的惰性工厂包装（诗词/设置/成长/图谱/飞花/诗库）。
import { getRuntime } from './runtime.js'

/** createElement 包装：工厂在渲染期才拿到 React 运行时。 */
function h(type, props) {
  const args = [type, props]
  for (let i = 2; i < arguments.length; i += 1) args.push(arguments[i])
  return getRuntime().h.apply(null, args)
}

import { num } from '../base.js'
import { normalizeSettings } from '../settings-model.js'
import { buildPingshuiIndex, detectPoem, parsePoemInput, detectPoemText, formatDetectionReport, detectionRhymeIndexes } from '../poetry-engine.js'
import { moodAiFailureLabel, moodBasisText } from '../mood-engine.js'
import { createPoetryTabs } from '../tabs-poetry.js'
import { createSettingsTab } from '../tabs-settings.js'
import { createGrowthTab } from '../tabs-growth.js'
import { createGraphTab } from '../tabs-graph.js'
import { createFeihuaTab } from '../tabs-feihua.js'
import { createLibraryTab } from '../tabs-library.js'
import { feihuaSourceOf, finishFeihuaIndex, mergeFeihuaFullEntries, mergeFeihuaItems } from '../feihua.js'
import { WIDGET_ID, Z_INDEX, FEIHUA_ATLAS_PAGE, FEIHUA_FULL_RETRY_MS, MASCOT_FILES, LIBRARY_CATEGORIES } from './models/constants.js'
import { cx, describeDataError } from './models/utils.js'
import { readFeihuaFullCache, abortFeihuaFull, requestFeihuaFull, getFeihuaIndex, pickDefaultFeihuaChar, readFeihuaBest, writeFeihuaBest } from './models/feihua-model.js'
import { weatherChipText, weatherUpdatedLabel } from './models/weather-model.js'
import { mascotUrl } from './models/mascot-model.js'
import { selfStatusSummary } from './models/self-model.js'
import { AnalysisBody, EmptyState, KnowledgeCardView, LoadingState, PoemBody, ToneLine, growthMetricsTree, switchNode } from './view/primitives.js'

  // v1.85：诗词基础 tab 已移到 tabs-poetry.js；这里用惰性包装保持 DEBUG/渲染引用不变。
  let poetryTabs = null
  function ensurePoetryTabs() {
   if (poetryTabs === null) {
    poetryTabs = createPoetryTabs({
     React: getRuntime().React,
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
  export function TodayTab(props) { return ensurePoetryTabs().TodayTab(props) }
  export function ClassTab(props) { return ensurePoetryTabs().ClassTab(props) }
  export function YunTab(props) { return ensurePoetryTabs().YunTab(props) }
  export function CiTab(props) { return ensurePoetryTabs().CiTab(props) }
  export function PoetrySettingsTab(props) { return ensurePoetryTabs().PoetrySettingsTab(props) }

  // v2.4：设置面板已移到 tabs-settings.js；惰性包装保持 DEBUG/渲染引用不变。
  let settingsTabFactory = null
  function ensureSettingsTab() {
   if (settingsTabFactory === null) {
    settingsTabFactory = createSettingsTab({
     React: getRuntime().React,
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
  export function SettingsTab(props) { return ensureSettingsTab()(props) }

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
  export function GrowthTab(props) { return ensureGrowthTab()(props) }

  // v2.94：认知图谱面板（面板内直接画图，不依赖单独路由）。
  let graphTabFactory = null
  function ensureGraphTab() {
   if (graphTabFactory === null) {
    graphTabFactory = createGraphTab({ React, h })
   }
   return graphTabFactory
  }
  export function GraphTab(props) { return ensureGraphTab()(props) }

  // v2.4：飞花令面板已移到 tabs-feihua.js。
  let feihuaTabFactory = null
  function ensureFeihuaTab() {
   if (feihuaTabFactory === null) {
    feihuaTabFactory = createFeihuaTab({
     React: getRuntime().React,
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
  export function FeihuaTab(props) { return ensureFeihuaTab().FeihuaTab(props) }
  export function DetectionView(props) { return ensureFeihuaTab().DetectionView(props) }

  // v2.4：诗库面板已移到 tabs-library.js。
  let libraryTabFactory = null
  function ensureLibraryTab() {
   if (libraryTabFactory === null) {
    libraryTabFactory = createLibraryTab({
     React: getRuntime().React,
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
  export function LibraryTab(props) { return ensureLibraryTab().LibraryTab(props) }
  // WidgetBoundary 是 class 组件，不能直接当函数调用；用函数包装成正常 React 组件。
  export function WidgetBoundary(props) {
   const Boundary = ensureLibraryTab().WidgetBoundary
   return h(Boundary, null, props && props.children)
  }
