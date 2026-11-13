// client-src/widget/hooks/use-settings.js —— 设置状态 + 防抖 PUT 持久化 + 恢复默认。
import { getReact } from '../runtime.js'
import { DEFAULT_SETTINGS, WRITE_KEYS, normalizeSettings, createSettingsSaver } from '../../settings-model.js'
import { nextSpontEventDelay } from '../../self-talk-client.js'
import { SAVE_DEBOUNCE_MS } from '../models/constants.js'
import { hasOwn } from '../models/utils.js'
import { putSettings } from '../models/api.js'

export function useSettings(deps) {
  const React = getReact()
  const { cacheRef, showToast } = deps
  const { refs } = deps
  const { pressTimer, mascotTimerRef, mascotExprTimerRef } = refs
  const [settings, setSettings] = React.useState(() => normalizeSettings(cacheRef.current && cacheRef.current.settings))
  const settingsRef = React.useRef(settings)
  settingsRef.current = settings
  const saverRef = React.useRef(null)
  if (!saverRef.current) {
   saverRef.current = createSettingsSaver({
    delay: SAVE_DEBOUNCE_MS,
    put: (patch) => putSettings(patch),
    onError: () => {
    showToast('保存失败，已保留本地设置', 'error')
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
   refs.bridge.current.wakeSpontaneous(nextSpontEventDelay())
   if (settingsRef.current.mood) refs.bridge.current.scheduleMoodAiRefresh()
   return next
  }, [])
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
  return { settings, settingsRef, saverRef, updateSettings, resetSettings, setSettings }
}
