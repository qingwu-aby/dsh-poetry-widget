// client-src/widget/hooks/use-mood.js —— 心情引擎 + 模型心情（mood-ai）实时刷新/重试/图鉴。
import { getReact } from '../runtime.js'
import { nextSpontEventDelay } from '../../self-talk-client.js'
import { MOOD_AI_MAX_RETRIES, MOOD_AI_RECENT_IMAGES_MAX, MOOD_AI_RECENT_MAX, MOOD_REFRESH_MS, MOOD_TICK_MS, computeMood, emptyMoodStats, moodAiEventDelay, moodAiKeepDecision, moodAiSnapshot, moodBasisText, moodTimeBucket, nextMoodAiRetryDelay, normalizeMoodAiFailure, normalizeMoodCatalog, panelPeekFile, throttleMoodSwitch } from '../../mood-engine.js'
import { mascotUrl, mergePetMediaIntoCatalog, requestPetMediaCatalog } from '../models/mascot-model.js'
import { moodCache, requestMoodAi } from '../models/mood-model.js'

export function useMood(deps) {
  const React = getReact()
  const { settingsRef, moodCatalogRes, settings, weather, boot, panelTab, poetryTab, panelOpen, spontPoem, moodWakeSigRef, wakeSpontaneous } = deps
  const { refs } = deps
  const { moodViewRef, weatherRef, clicksRef, feihuaWinsRef, panelOpensRef, recentSpokenRef, feihuaLossesRef, lastInteractionRef, petMediaEntriesRef } = refs
  const [moodRes, setMoodRes] = React.useState(() => {
   const cached = moodCache
   return cached && cached.data ? { status: 'ready', data: cached.data, at: cached.at } : { status: 'idle', data: null, at: 0 }
  })
  const [moodView, setMoodView] = React.useState(null)
  const [moodSource, setMoodSource] = React.useState('')
  const [moodAiFallback, setMoodAiFallback] = React.useState(false)
  const [moodAiStale, setMoodAiStale] = React.useState(false)
  const [moodAiFailure, setMoodAiFailure] = React.useState('')
  const [moodAiFailureCode, setMoodAiFailureCode] = React.useState('')
  const [petMediaRes, setPetMediaRes] = React.useState({ status: 'idle', entries: [] })
  const [moodTick, setMoodTick] = React.useState(0)
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

  const moodCatalogBase = React.useMemo(() => normalizeMoodCatalog(moodCatalogRes.data), [moodCatalogRes.data])
  const moodCatalog = React.useMemo(() => mergePetMediaIntoCatalog(moodCatalogBase, petMediaRes.entries), [moodCatalogBase, petMediaRes.entries])
  moodCatalogRef.current = moodCatalog
  const moodChip = settings.mood && moodView ? '心情：' + moodView.label : ''
  const moodChipTitle = settings.mood && moodView ? String(moodView.reason || '') : ''
  const moodBasis = moodBasisText(weather)
  React.useEffect(() => {
   if (!(settings.mood || settings.spontaneousPoem)) return undefined
   const timer = setInterval(() => setMoodTick((tick) => tick + 1), MOOD_TICK_MS)
   return () => clearInterval(timer)
  }, [settings.mood, settings.spontaneousPoem])
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
  React.useEffect(() => {
   if (!settings.mood || !moodCatalog) return
   if (petMediaRes.status === 'loading' || petMediaRes.status === 'idle') return
   if (moodAiRef.current.at > 0) return
   scheduleMoodAiRefresh()
  }, [settings.mood, moodCatalog, petMediaRes.status])
  React.useEffect(() => {
   if (!settings.mood) return undefined
   const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    scheduleMoodAiRefresh()
   }, MOOD_REFRESH_MS)
   return () => clearInterval(timer)
  }, [settings.mood, scheduleMoodAiRefresh])
  React.useEffect(() => {
   if (!settings.mood) return
   const currentTab = panelTab === 'poetry' ? 'poetry:' + poetryTab : panelTab
   const changed = moodPrevPanelOpenRef.current !== panelOpen
    || (panelOpen && moodPrevPanelTabRef.current !== currentTab)
   moodPrevPanelOpenRef.current = panelOpen
   moodPrevPanelTabRef.current = currentTab
   if (changed) scheduleMoodAiRefresh()
  }, [panelOpen, panelTab, poetryTab, settings.mood])
  React.useEffect(() => {
   if (!settings.mood) return
   const visible = Boolean(spontPoem)
   const previous = Boolean(moodPrevSpontRef.current)
   moodPrevSpontRef.current = visible
   if (visible !== previous) scheduleMoodAiRefresh()
  }, [spontPoem, settings.mood])
  React.useEffect(() => {
   if (!settings.mood) return
   const signature = weather ? [weather.category, weather.label, weather.tempC, weather.isDay].join('|') : ''
   const previous = moodWeatherSigRef.current
   moodWeatherSigRef.current = signature
   if (previous && signature && previous !== signature) scheduleMoodAiRefresh()
  }, [weather, settings.mood])
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
  React.useEffect(() => {
   if (settings.mood && moodCatalogRes.status === 'error') setMoodAiFallback(true)
  }, [settings.mood, moodCatalogRes.status])
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
   if (!settings.spontaneousPoem || !moodView) return
   const signature = [moodView.key, moodView.label, moodView.reason, moodView.source].join('|')
   if (moodWakeSigRef.current && moodWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay())
   moodWakeSigRef.current = signature
  }, [moodView, settings.spontaneousPoem, wakeSpontaneous])
  petMediaEntriesRef.current = petMediaRes.entries
  refs.bridge.current.scheduleMoodAiRefresh = scheduleMoodAiRefresh
  return { moodRes, moodView, moodSource, moodAiFallback, moodAiStale, moodAiFailure, moodAiFailureCode, petMediaRes, moodCatalog, moodChip, moodChipTitle, moodBasis, refreshMoodNow, scheduleMoodAiRefresh }
}
