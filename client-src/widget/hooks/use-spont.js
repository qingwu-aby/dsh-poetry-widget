// client-src/widget/hooks/use-spont.js —— 自言自语（轮询/一卡制/事件唤醒/模型请求）。
import { getReact } from '../runtime.js'
import { num } from '../../base.js'
import { SELF_TALK_RECENT_MAX, SPONT_AUTO_CLOSE_MS, SPONT_CLOSE_RECHECK_MS, SPONT_QUIET_MS, SPONT_RETRY_MS, canShowSpontaneous, nextSpontEventDelay, nextSpontPollDelay, recordSpontShown, selfTalkNoveltySignature } from '../../self-talk-client.js'
import { readSpontState, writeSpontState, requestSelfTalk } from '../models/spont-model.js'

export function useSpont(deps) {
  const React = getReact()
  const { setPanelOpen, setSelectedPoemId, openPanelTab, setLibraryFocus, settings, panelOpen, step, weather, noteInteraction } = deps
  const { refs } = deps
  const { recentSpokenRef, uiRef, selfStatusRef, moodViewRef, weatherRef, lastInteractionRef, userPickedPoemRef } = refs
  const [spontPoem, setSpontPoem] = React.useState(null)
  const [spontPreview, setSpontPreview] = React.useState(false)
  const [spontWake, setSpontWake] = React.useState(0)
  const selfTalkNoveltyRef = React.useRef({ signature: '', at: 0 })
  const spontWakeDelayRef = React.useRef(0)
  const prevPanelOpenRef = React.useRef(false)
  const prevStepRef = React.useRef(-1)
  const prevCardRef = React.useRef(null)
  const moodWakeSigRef = React.useRef('')
  const weatherWakeSigRef = React.useRef('')
  const spontPoemRef = React.useRef(null)
  const spontReqRef = React.useRef(0)
  const selfTalkCacheRef = React.useRef({ murmur: [], intro: [] })
  const wakeSpontaneous = React.useCallback((delay) => {
   spontWakeDelayRef.current = Math.max(1000, num(delay, nextSpontEventDelay()))
   setSpontWake((tick) => tick + 1)
  }, [])
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
  function closeSpont(event) {
   if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
   spontReqRef.current += 1
   selfTalkNoveltyRef.current = { signature: '', at: 0 }
   setSpontPreview(false)
   setSpontPoem(null)
  }

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
  spontPoemRef.current = spontPoem
  refs.bridge.current.wakeSpontaneous = wakeSpontaneous
  return { spontPoem, setSpontPoem, spontPreview, setSpontPreview, wakeSpontaneous, startSpontaneousCard, showSpontCard, previewSpontaneousPoem, readAnotherSpontaneous, openSpontPoem, closeSpont, moodWakeSigRef }
}
