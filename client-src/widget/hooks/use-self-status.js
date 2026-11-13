// client-src/widget/hooks/use-self-status.js —— 成长状态轮询 + 自主行为气泡展示。
import { getReact } from '../runtime.js'
import { SELF_PATH, SELF_POLL_MS } from '../models/constants.js'
import { normalizeSelfStatus, readSeenActionId, writeSeenActionId } from '../models/self-model.js'
import { fetchJson } from '../models/api.js'

export function useSelfStatus(deps) {
  const React = getReact()
  const { showSpontCard } = deps
  const { refs } = deps
  const { selfStatusRef } = refs
  const [selfStatus, setSelfStatus] = React.useState(null)
  const pendingActionRef = React.useRef(null)
  const lastSeenActionIdRef = React.useRef(readSeenActionId())
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
  selfStatusRef.current = selfStatus
  return { selfStatus, setSelfStatus }
}
