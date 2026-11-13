// client-src/widget/container.js —— 挂件容器组件：组合 hooks / 状态 / effects / 事件，渲染视图。
import { getReact, getRuntime } from './runtime.js'
import {
  ClassTab,
  CiTab,
  FeihuaTab,
  GrowthTab,
  LibraryTab,
  PoetrySettingsTab,
  TodayTab,
  YunTab,
} from './tabs.js'
import { num } from '../base.js'
import { normalizeHealthStatus } from '../health-model.js'
import { normalizeSettings, selectNextPoemId } from '../settings-model.js'
import { nextSpontEventDelay } from '../self-talk-client.js'
import { buildFeihuaIndex, finishFeihuaIndex, mergeFeihuaItems } from '../feihua.js'
import { CSS } from '../styles.js'
import { clearFirstScreenCache, fetchJsonUrl, readFirstScreenCache, writeFirstScreenCache } from '../data.js'
import { ROUTE, SELF_PATH, MEMORY_PATH, HEALTH_PATH, WORKS_PATH, ATTENTION_PATH, PROJECT_ACTION_PATH, PROJECT_PATH, TWIN_PATH, PRESENCE_PATH, PRESENCE_THROTTLE_MS, WORKS_POLL_MS, GROWTH_PATH, GROWTH_POLL_MS, ATTENTION_POLL_MS, TWIN_POLL_MS, HEALTH_POLL_MS, MEMORY_BACKUP_PATH, MEMORY_POLL_MS, STEPS, POETRY_ENTRY_ENABLED, MASCOT_FILES, WEATHER_POOL_LIMIT } from './models/constants.js'
import { formatDateLabel } from './models/utils.js'
import { getFeihuaIndex } from './models/feihua-model.js'
import { weatherPoemTags, buildWeatherPoemPool, selectWeatherPoemEntry, weatherChipText, weatherExplainText } from './models/weather-model.js'
import { mascotUrl, pickMascotExpression } from './models/mascot-model.js'
import { normalizeSelfStatus, normalizeMemoryStatus, normalizeWorks, normalizeAttention, normalizeTwinState } from './models/self-model.js'
import { fetchJson } from './models/api.js'
import { BubbleView } from './view/bubble-view.js'
import { MascotView } from './view/mascot-view.js'
import { MealTipView } from './view/meal-tip.js'
import { PanelView } from './view/panel-view.js'
import { RestoreHotspotView } from './view/restore-hotspot.js'
import { SpontView } from './view/spont-view.js'
import { ToastView } from './view/toast-view.js'
import { WidgetRoot } from './view/widget-root.js'
import { StepContent } from './view/steps/index.js'
import { useToast } from './hooks/use-toast.js'
import { useSettings } from './hooks/use-settings.js'
import { usePanel } from './hooks/use-panel.js'
import { useWeather } from './hooks/use-weather.js'
import { useData } from './hooks/use-data.js'
import { useSpont } from './hooks/use-spont.js'
import { useSelfStatus } from './hooks/use-self-status.js'
import { useMood } from './hooks/use-mood.js'
import { useMascot } from './hooks/use-mascot.js'

export function PoetryWidget(props) {
  const React = getReact()
  const h = getRuntime().h
  const { resourceStore, useViewportSize, useResource, panelTabs } = getRuntime()
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

  const [step, setStep] = React.useState(-1)
  const [selectedPoemId, setSelectedPoemId] = React.useState(null)
  const [feihuaLaunch, setFeihuaLaunch] = React.useState(0)
  const [memoryStatus, setMemoryStatus] = React.useState(null)
  const [healthStatus, setHealthStatus] = React.useState(null)
  const [worksRes, setWorksRes] = React.useState({ status: 'idle', data: null })
  const [growthRes, setGrowthRes] = React.useState({ status: 'idle', data: null })
  const [attentionRes, setAttentionRes] = React.useState({ status: 'idle', data: null })
  const [projectDetail, setProjectDetail] = React.useState(null)
  const [twinRes, setTwinRes] = React.useState({ status: 'idle', data: null })
  const [memoryTick, setMemoryTick] = React.useState(0)
  const [libraryFocus, setLibraryFocus] = React.useState(null)
  const [feihuaIndex, setFeihuaIndex] = React.useState(null)
  const [feihuaBuilding, setFeihuaBuilding] = React.useState(false)

  // v3.0：组件实例级 refs（hooks 与容器共用；React.useRef 语义等价）。
  const refsRef = React.useRef(null)
  if (!refsRef.current) {
   refsRef.current = {
    userPickedPoemRef: { current: false },
    petMediaEntriesRef: { current: [] },
    pressTimer: { current: null },
    mascotTimerRef: { current: null },
    mascotExprTimerRef: { current: null },
    posRef: { current: null },
    moodViewRef: { current: null },
    selfStatusRef: { current: null },
    clicksRef: { current: 0 },
    panelOpensRef: { current: 0 },
    lastInteractionRef: { current: 0 },
    feihuaWinsRef: { current: 0 },
    feihuaLossesRef: { current: 0 },
    weatherRef: { current: null },
    uiRef: { current: {} },
    recentSpokenRef: { current: [] },
    bridge: { current: {} },
   }
  }
  const refs = refsRef.current
  const { userPickedPoemRef, petMediaEntriesRef, pressTimer, mascotTimerRef, mascotExprTimerRef, posRef, moodViewRef, selfStatusRef, clicksRef, panelOpensRef, lastInteractionRef, feihuaWinsRef, feihuaLossesRef, weatherRef, uiRef, recentSpokenRef, bridge } = refs

  // 事件/定时器里互相调用（hook 之间解耦）：后声明的 hook 把函数挂到 bridge。
  // 顺序：toast → settings → panel → weather → data → spont → selfStatus → mood → mascot。
  const { toast, showToast, toastTimer } = useToast({ refs })
  const { settings, settingsRef, saverRef, updateSettings, resetSettings, setSettings } = useSettings({ cacheRef, showToast, refs })
  const { panelOpen, setPanelOpen, panelTab, poetryTab, setPoetryTab, hideWidget, restoreWidget, noteInteraction, openPanelTab, openPoetryModule, openSettingsPanel, openPanel } = usePanel({ updateSettings, setStep, panelTabs, refs })
  const { weatherRes, refreshWeather, weatherData, weather } = useWeather({ settingsRef, refs, settings })
  const { viewport, mascotSize, setCiBankWanted, poemsRes, reloadPoems, knowledgeRes, reloadKnowledge, yunRes, reloadYun, ciRes, reloadCi, anthologyRes, reloadAnthology, bankRes, reloadBank, pingshuiRes, reloadPingshui, moodCatalogRes, ciBankRes, feihuaOpen } = useData({ boot, settings, panelOpen, panelTab, poetryTab, step, weatherRes, resourceStore, useViewportSize, useResource, refs })
  const { spontPoem, spontPreview, wakeSpontaneous, showSpontCard, previewSpontaneousPoem, readAnotherSpontaneous, openSpontPoem, closeSpont, moodWakeSigRef } = useSpont({ settings, settingsRef, setSelectedPoemId, setLibraryFocus, setPanelOpen, openPanelTab, refs, panelOpen, step, weather, noteInteraction })
  const { selfStatus, setSelfStatus } = useSelfStatus({ showSpontCard, refs })
  const { moodRes, moodView, moodSource, moodAiFallback, moodAiStale, moodAiFailure, moodAiFailureCode, petMediaRes, moodCatalog, moodChip, moodChipTitle, moodBasis, refreshMoodNow, scheduleMoodAiRefresh } = useMood({ settings, settingsRef, weather, moodCatalogRes, panelOpen, panelTab, poetryTab, spontPoem, refs, boot, moodWakeSigRef, wakeSpontaneous })
  const { mascotPulse, failedMascot, mascotExpression, motionFile, dizzy, mealActive, walking, wanderFile, pos, mascotVideoRef, showMascotExpression, pulseMascot, handleMascotKeyDown, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handleRestorePointerDown, handleRestorePointerUp, handleMascotMediaError, wanderFileRef, dizzyTimerRef, mealTimerRef } = useMascot({ settings, settingsRef, weather, moodView, moodCatalog, petMediaRes, panelOpen, step, advanceStep, updateSettings, noteInteraction, openPanel, openPanelTab, setPanelOpen, viewport, mascotSize, refs, wakeSpontaneous, scheduleMoodAiRefresh, restoreWidget })


  posRef.current = pos
  // v1.64：窗口溜达（目标时间 + 走路计时器）。
  wanderFileRef.current = wanderFile


  const showToastRef = React.useRef(null)
  showToastRef.current = showToast
  React.useEffect(() => () => {
   if (toastTimer.current) {
    clearTimeout(toastTimer.current)
    toastTimer.current = null
   }
  }, [])






  // v1.64：窗口溜达——每 2–5 分钟贴着边缘换一个位置，互相不挡输入框；
  // 面板打开、用户刚碰过她、页面不可见时不走。

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



  const poemItems = poemsRes.data && Array.isArray(poemsRes.data.items) ? poemsRes.data.items : []
  const bootstrapTodayPoemId = boot.data && boot.data.today ? boot.data.today.poemId : null
  const cache = cacheRef.current
  const cachedPoem = cache && cache.todayPoem ? cache.todayPoem : null
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


  // 心情动画素材（dsh-pet webm）：设置 mood 开启时懒加载，失败只用 92 张静态图

  // 模型心情：初次加载（图鉴/动画图鉴都就绪或失败后）→ 2–4s 防抖后实时请求

  // v1.58：模型心情按她自己的节奏刷新（不随会话事件）；页面可见时每 5 分钟一次。

  // 实时事件 2：面板打开/关闭/切 tab

  // 实时事件 3：self-talk 卡片出现/关闭

  // 实时事件 4：天气刷新/类别变化

  // 实时事件 5：页面回前台 / 窗口重新可见

  // 实时事件 6：时段/饭点切换、idle 进入/恢复（用分钟 tick 检查，无定时请求）

  // 图鉴加载失败：直接使用启发式并提示本地表情

  // 图鉴就绪后预加载 3 张探头图 + 少量心情图

  // 事件唤醒：关闭面板 / 气泡结束 / 卡片关闭 / 心情或天气更新






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
  function advanceStep() {
   setStep((current) => (current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1))
   wakeSpontaneous(nextSpontEventDelay())
  }

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

  function consumeFeihuaLaunch() {
   setFeihuaLaunch(0)
  }
  const dateSeed = (boot.data && boot.data.today && boot.data.today.date) || ''
  const dateLabel = formatDateLabel(dateSeed)







  React.useEffect(() => () => {
   if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current)
   if (mealTimerRef.current) clearTimeout(mealTimerRef.current)
  }, [])

  // 成长状态 + 自主行为：App 级 60s 轮询 self.json（页面隐藏跳过、失败静默）




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
