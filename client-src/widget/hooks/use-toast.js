// client-src/widget/hooks/use-toast.js —— 轻提示 Toast（2.6s 自动消失）。
import { getReact } from '../runtime.js'

export function useToast(deps) {
  const React = getReact()
  const { } = deps
  const { refs } = deps
  const { } = refs
  const [toast, setToast] = React.useState(null)
  const toastTimer = React.useRef(null)
  const showToast = React.useCallback((text, kind) => {
   setToast({ text: String(text == null ? '' : text), kind: kind === 'error' ? 'error' : 'info' })
   if (toastTimer.current) clearTimeout(toastTimer.current)
   toastTimer.current = setTimeout(() => {
    toastTimer.current = null
    setToast(null)
   }, 2600)
  }, [])
  return { toast, showToast, toastTimer }
}
