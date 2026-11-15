// client-src/widget/hooks/use-mascot.js —— 形象舞台状态机（立绘/动画/晕眩/饭点/溜达/拖拽）。
import { getReact } from '../runtime.js'
import { isVideoMoodFile, num, readWindowHeight, readWindowWidth } from '../../base.js'
import { nextSpontEventDelay } from '../../self-talk-client.js'
import { WANDER_FIRST_MAX_MS, WANDER_FIRST_MIN_MS, WANDER_INTERACTION_PAUSE_MS, WANDER_MAX_INTERVAL_MS, WANDER_MIN_INTERVAL_MS, WANDER_STATIC_FILE, WANDER_TICK_MS, WANDER_WALK_MS, WINDOW_WANDER_ENABLED, nextWanderTarget, pickWanderMedia } from '../../wander.js'
import { readMascotEggState, readStoredPosition, recordMascotEgg, writeMascotEggState, writeStoredPosition } from '../../local-state.js'
import { BASE_SIZE, MASCOT_FILES, MASCOT_TRANSIENT_MS, MASCOT_EXPRESSION_MS, MASCOT_IDLE_POLL_MS, MASCOT_EXPRESSION_FILES } from '../models/constants.js'
import { clampPosition, anchorPosition } from '../models/utils.js'
import { mascotVideoShouldPause, detectFastDrag, nextDizzyDuration, nextMealDuration, readMealState, writeMealState, markMealDone, mealTriggerFor, pickDizzyMedia, pickMealMedia, readMotionRotation, writeMotionRotation, nextMotionEntry, nextMotionDelay, nextMotionScheduleDelay, nextMotionDuration, shouldShowDailyGreet, canShowIdlePose, pickMascotExpression } from '../models/mascot-model.js'

export function useMascot(deps) {
  const React = getReact()
  const { wakeSpontaneous, scheduleMoodAiRefresh, settingsRef, noteInteraction, updateSettings, panelOpen, setPanelOpen, step, advanceStep, openPanel, mascotSize, viewport, restoreWidget, settings, petMediaRes, moodView } = deps
  const { refs } = deps
  const { feihuaWinsRef, feihuaLossesRef, lastInteractionRef, mascotTimerRef, mascotExprTimerRef, clicksRef, petMediaEntriesRef, uiRef, posRef, pressTimer, moodViewRef } = refs
  const [mascotPulse, setMascotPulse] = React.useState(null)
  const [failedMascot, setFailedMascot] = React.useState('')
  const [mascotExpression, setMascotExpression] = React.useState('')
  const [motionFile, setMotionFile] = React.useState('')
  const [dizzy, setDizzy] = React.useState(null)
  const [mealActive, setMealActive] = React.useState(null)
  const [pos, setPos] = React.useState(() => {
   const stored = readStoredPosition()
   const viewport = { w: readWindowWidth(), h: readWindowHeight() }
   if (stored) return clampPosition(stored, BASE_SIZE, viewport)
   return { x: 16, y: Math.max(8, viewport.h - BASE_SIZE - 24) }
  })
  const dragRef = React.useRef(null)
  const wanderRef = React.useRef({ nextAt: 0, timer: null, walking: false })
  const [walking, setWalking] = React.useState(false)
  const [wanderFile, setWanderFile] = React.useState('')
  const wanderFileRef = React.useRef('')
  const mascotTapRef = React.useRef(0)
  const mascotVideoRef = React.useRef(null)
  const mascotPulseRef = React.useRef(null)
  const mascotExpressionRef = React.useRef('')
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
  function showMascotExpression(file) {
   if (!file) return
   setMascotExpression(file)
   if (mascotExprTimerRef.current) clearTimeout(mascotExprTimerRef.current)
   mascotExprTimerRef.current = setTimeout(() => {
    mascotExprTimerRef.current = null
    setMascotExpression('')
   }, MASCOT_EXPRESSION_MS)
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
  React.useEffect(() => {
   syncMascotVideoPlayback()
  })

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   document.addEventListener('visibilitychange', syncMascotVideoPlayback)
   return () => document.removeEventListener('visibilitychange', syncMascotVideoPlayback)
  }, [syncMascotVideoPlayback])
  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   document.addEventListener('visibilitychange', syncMascotVideoPlayback)
   return () => document.removeEventListener('visibilitychange', syncMascotVideoPlayback)
  }, [syncMascotVideoPlayback])
  mascotPulseRef.current = mascotPulse
  mascotExpressionRef.current = mascotExpression
  motionFileRef.current = motionFile
  dizzyRef.current = dizzy
  mealActiveRef.current = mealActive
  return { mascotPulse, failedMascot, mascotExpression, motionFile, dizzy, mealActive, walking, wanderFile, pos, mascotVideoRef, showMascotExpression, pulseMascot, handleMascotTap, handleMascotKeyDown, triggerDizzy, maybeTriggerMeal, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handleRestorePointerDown, handleRestorePointerUp, handleMascotMediaError, wanderFileRef, dizzyTimerRef, mealTimerRef }
}
