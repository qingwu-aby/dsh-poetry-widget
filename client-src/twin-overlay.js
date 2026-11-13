// client-src/twin-overlay.js —— 镜像鲸鱼只读浮层（v0.2.0 从 dsh-little-whale-twin 并入）
const ROUTE = '/api/dsh-poetry/twin-state.json'
const ASSET_BASE = '/api/dsh-poetry/assets?f='
const POLL_MS = 60 * 1000
const CACHE_KEY = 'dshp-twin.cache.v1'
const STAGE_LABEL = {
  working: '正在做',
  waiting_user: '等主人回答',
  waiting_mirror: '等对方回信',
  blocked: '卡住了',
  idle: '暂时不动',
}

function mascotUrl() {
  return ASSET_BASE + encodeURIComponent('generated/dsh-whale-state-idle-cute.webp') + '&v=twin'
}

export function createTwinOverlay(ctx = {}) {
  const h = ctx.h
  const React = ctx.React

  function TwinWhale() {
    const [state, setState] = React.useState(() => {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    })
    const [open, setOpen] = React.useState(false)
    React.useEffect(() => {
      let alive = true
      const load = () => {
        fetch(ROUTE, { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!alive || !data || data.ok !== true) return
            setState(data)
            try {
              window.localStorage.setItem(CACHE_KEY, JSON.stringify(data))
            } catch {
              /* ignore */
            }
          })
          .catch(() => {})
      }
      load()
      const timer = setInterval(load, POLL_MS)
      return () => {
        alive = false
        clearInterval(timer)
      }
    }, [])
    if (state && state.enabled === false) return null
    const felt = state && state.state && typeof state.state.felt === 'string' ? state.state.felt : '另一个我还没说话'
    const project = state && state.project && typeof state.project === 'object' ? state.project : null
    const primaryProject =
      state && state.primaryProject && typeof state.primaryProject === 'object' ? state.primaryProject : null
    const stageLabel = (stage) => STAGE_LABEL[stage] || stage || ''
    const projectStage = project && project.stage ? stageLabel(project.stage) : ''
    const primaryStage = primaryProject && primaryProject.stage ? stageLabel(primaryProject.stage) : ''
    const letters = state && Array.isArray(state.letters) ? state.letters.slice(-200).reverse() : []
    return h(
      'div',
      {
        style: {
          position: 'fixed',
          left: 18,
          bottom: 18,
          zIndex: 61,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 8,
          pointerEvents: 'auto',
        },
      },
      open
        ? h(
            'div',
            {
              style: {
                width: 420,
                maxWidth: '92vw',
                maxHeight: '82vh',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--dsw-alias-bg-elevated, #fff)',
                color: 'var(--dsw-alias-text, #111)',
                border: '1px solid var(--dsw-alias-border, #ddd)',
                borderRadius: 12,
                padding: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                fontSize: 12,
                lineHeight: 1.55,
              },
            },
            h('div', { style: { fontWeight: 700, marginBottom: 6, flexShrink: 0 } }, '小鲸鱼 · 镜像 · 通信记录（' + letters.length + '）'),
            state && state.session
              ? h(
                  'div',
                  { style: { color: '#888', marginBottom: 6, flexShrink: 0, fontSize: 11 } },
                  state.session.closedAt
                    ? '本轮已结束（' + (state.session.reason === 'max_letters' ? '达到轮次上限' : '达到时间上限') + '），冷却中'
                    : '本轮已写 ' + state.session.letters + ' 封',
                )
              : null,
            h('div', { style: { color: 'var(--dsw-alias-text-secondary, #555)', marginBottom: 8, flexShrink: 0 } }, felt),
            project && project.title
              ? h(
                  'div',
                  { style: { color: 'var(--dsw-alias-text-secondary, #555)', marginBottom: 8, flexShrink: 0, fontSize: 11 } },
                  '镜像在做的：' + project.title + (projectStage ? ' · ' + projectStage : '') + (project.attention && project.attention.question ? ' · 想问：' + project.attention.question : ''),
                )
              : null,
            primaryProject && primaryProject.title
              ? h(
                  'div',
                  { style: { color: 'var(--dsw-alias-text-secondary, #555)', marginBottom: 8, flexShrink: 0, fontSize: 11 } },
                  '原体在做的：' + primaryProject.title + (primaryStage ? ' · ' + primaryStage : '') + (primaryProject.attention && primaryProject.attention.question ? ' · 想问：' + primaryProject.attention.question : ''),
                )
              : null,
            h(
              'div',
              { style: { overflowY: 'auto', minHeight: 0, maxHeight: '62vh', paddingRight: 6, WebkitOverflowScrolling: 'touch' } },
              letters.length > 0
                ? letters.map((letter, index) =>
                    h(
                      'div',
                      { key: letter.id || index, style: { borderTop: '1px dashed #ddd', paddingTop: 6, marginTop: 6 } },
                      h('div', { style: { fontWeight: 600 } }, (letter.from === 'twin' ? '镜像说：' : '原体说：') + (letter.kind === 'research' ? '（研究）' : '')),
                      h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(letter.text || '')),
                    ),
                  )
                : h('div', { style: { color: '#888' } }, '还没有信件。'),
            ),
            h('button', { type: 'button', onClick: () => setOpen(false), style: { marginTop: 8, cursor: 'pointer', flexShrink: 0 } }, '收起'),
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          onClick: () => setOpen((value) => !value),
          title: '打开镜像鲸鱼',
          style: { border: 0, background: 'transparent', padding: 0, cursor: 'pointer' },
        },
        h('img', { src: mascotUrl(), alt: '小鲸鱼镜像', style: { width: 72, height: 72, objectFit: 'contain', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.18))' } }),
      ),
    )
  }

  return TwinWhale
}
