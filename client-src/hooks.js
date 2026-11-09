// client-src/hooks.js —— 客户端通用 hooks（视口尺寸 / 数据资源加载）（W3）
import { readWindowHeight, readWindowWidth } from './base.js'

export function createHooks({ React, resourceStore }) {
  function useViewportSize() {
    const [size, setSize] = React.useState(() => ({ w: readWindowWidth(), h: readWindowHeight() }))
    React.useEffect(() => {
      const onResize = () => setSize({ w: readWindowWidth(), h: readWindowHeight() })
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [])
    return size
  }

  function useResource(kind, active) {
    const [state, setState] = React.useState(() => ({
      status: resourceStore.get(kind) ? 'ready' : 'idle',
      data: resourceStore.get(kind) || null,
      error: null,
    }))
    const alive = React.useRef(true)
    const statusRef = React.useRef(state.status)
    statusRef.current = state.status
    React.useEffect(() => () => {
      alive.current = false
    }, [])
    const reload = React.useCallback(() => {
      if (statusRef.current === 'loading') return Promise.resolve()
      statusRef.current = 'loading'
      setState((previous) => ({ status: 'loading', data: previous.data, error: null }))
      return resourceStore.load(kind).then(
        (data) => {
          statusRef.current = 'ready'
          if (alive.current) setState({ status: 'ready', data, error: null })
          return data
        },
        (error) => {
          statusRef.current = 'error'
          if (alive.current) setState({ status: 'error', data: null, error })
          throw error
        },
      )
    }, [kind])
    React.useEffect(() => {
      if (active && statusRef.current === 'idle') reload().catch(() => {})
    }, [active, reload])
    return [state, reload]
  }

  return { useViewportSize, useResource }
}
