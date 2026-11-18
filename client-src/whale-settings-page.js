// client-src/whale-settings-page.js —— 小鲸鱼在 DSH「设置 → 插件」里的独立设置页
// 参考 dsh-bili-scroll 的 settings.section 注册方式；设置不再只能挤在挂件气泡里。
import { DEFAULT_SETTINGS, normalizeSettings, settingsPatch } from './settings-model.js'

const API = '/api/dsh-poetry'

function request(path, init) {
  const options = Object.assign({ credentials: 'same-origin' }, init || {})
  return fetch(API + path, options).then(async (response) => {
    const data = await response.json().catch(() => null)
    if (!response.ok || !data || data.ok === false) {
      const detail = data && data.error ? data.error.message || data.error.code : 'HTTP ' + response.status
      throw new Error(detail || '请求失败')
    }
    return data
  })
}

const styles = {
  page: { padding: '18px 22px', maxWidth: 760, color: 'var(--dsw-alias-label-primary, #1f2329)', fontSize: 13 },
  card: { border: '1px solid var(--dsw-alias-border-l2, #e5e6eb)', borderRadius: 10, padding: '14px 16px', marginBottom: 12, background: 'var(--dsw-alias-bg-base-platform, #fff)' },
  title: { fontSize: 15, fontWeight: 600, marginBottom: 10 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px dashed var(--dsw-alias-border-l2, #eef0f2)' },
  label: { display: 'flex', flexDirection: 'column', gap: 2 },
  hint: { fontSize: 11, opacity: 0.62 },
  button: { border: '1px solid var(--dsw-alias-border-l2, #d0d3d9)', background: 'var(--dsw-alias-bg-base-platform, #fff)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 },
  primary: { background: '#1f6feb', borderColor: '#1f6feb', color: '#fff' },
  select: { borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d0d3d9)', padding: '5px 8px', fontSize: 12, background: 'var(--dsw-alias-bg-base-platform, #fff)', color: 'inherit' },
  status: { fontSize: 12, opacity: 0.72, marginLeft: 8 },
}

export function createWhaleSettingsPage(React, h) {
  return function WhaleSettingsPage() {
  const [settings, setSettings] = React.useState(null)
  const [mc, setMc] = React.useState(null)
  const [busy, setBusy] = React.useState('')
  const [message, setMessage] = React.useState('')

  const refresh = React.useCallback(() => {
    request('/settings.json').then((data) => setSettings(normalizeSettings(data.settings))).catch(() => {})
    request('/minecraft-control.json').then((data) => setMc(data)).catch(() => {})
  }, [])
  React.useEffect(() => { refresh() }, [refresh])

  function save(patch, key) {
    setBusy(key)
    request('/settings.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsPatch(patch)) })
      .then((data) => { setSettings(normalizeSettings(data.settings)); setMessage('已保存'); setTimeout(() => setMessage(''), 1800) })
      .catch((error) => setMessage('保存失败：' + error.message))
      .finally(() => setBusy(''))
  }
  function toggle(key) {
    if (!settings) return
    save({ [key]: !settings[key] }, key)
  }
  function minecraft(action, extra) {
    setBusy(action)
    request('/minecraft-control.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action }, extra || {})) })
      .then((data) => { setMc(data); setMessage(action === 'start' ? '正在启动 Minecraft' : action === 'stop' ? '正在停止 Minecraft' : '已更新') })
      .catch((error) => setMessage('失败：' + error.message))
      .finally(() => setBusy(''))
  }

  if (!settings) return h ? h('div', { style: styles.page }, '正在读取小鲸鱼的设置…') : null

  const row = (title, hint, control) => h('div', { style: styles.row, key: title },
    h('div', { style: styles.label }, h('b', null, title), hint ? h('span', { style: styles.hint }, hint) : null),
    control,
  )
  const checkbox = (key, label) => h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked: Boolean(settings[key]), disabled: busy !== '', onChange: () => toggle(key) }),
    label,
  )
  const world = mc && mc.world ? mc.world : null
  const running = Boolean(mc && mc.ports && mc.ports.server)

  return h('div', { style: styles.page },
    h('div', { style: styles.card },
      h('div', { style: styles.title }, '小鲸鱼'),
      row('大小', '挂件缩放 60%–160%', h('input', { type: 'range', min: 60, max: 160, step: 5, value: Math.round(settings.scale * 100), onChange: (event) => save({ scale: Number(event.target.value) / 100 }, 'scale') })),
      row('隐藏挂件', '隐藏后仍可通过双击空白处恢复', checkbox('hidden')),
      row('模型 token 上限', '0 或留空 = 不封顶；填数字才限制单次输出', h('input', { type: 'number', min: 0, max: 200000, step: 1000, value: Number(settings.modelTokenLimit) || 0, style: { width: 110 }, onChange: (event) => save({ modelTokenLimit: Math.max(0, Math.floor(Number(event.target.value) || 0)) }, 'modelTokenLimit') })),
      row('心情', '让她对天气/时间有自己的心情', checkbox('mood')),
      row('自言自语', '每隔一两分钟可能说一句', checkbox('spontaneousPoem')),
      row('镜像浮层', '左下角第二只鲸鱼', checkbox('twinOverlay')),
      row('镜像主体', '独立状态与信件；改动后重启 DSH 生效', checkbox('twinSystem')),
    ),
    h('div', { style: styles.card },
      h('div', { style: styles.title }, 'Minecraft'),
      row('服务', running ? '服务器运行中 · 她在里面自己玩' : world ? '服务器未运行' : '状态未知',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { type: 'button', style: Object.assign({}, styles.button, running ? null : styles.primary), disabled: busy !== '', onClick: () => minecraft('start', { background: true }) }, busy === 'start' ? '启动中…' : '一键启动'),
          h('button', { type: 'button', style: styles.button, disabled: busy !== '' || !running, onClick: () => minecraft('stop', { background: true }) }, busy === 'stop' ? '停止中…' : '停止'),
        )),
      row('她', world ? `${(world.lastReceipt && world.lastReceipt.facts && world.lastReceipt.facts.position) || '位置未知'} · 最近 ${(world.lastCommand && world.lastCommand.tool) || '无动作'}` : '尚未进入游戏', null),
      row('游戏操作权限', '控制 = 允许动手；只观察 = 只看', h('select', {
        style: styles.select,
        value: (world && world.permission) || 'control',
        onChange: (event) => minecraft('permission', { level: event.target.value }),
      },
        h('option', { value: 'control' }, '控制'),
        h('option', { value: 'observe' }, '只观察'),
        h('option', { value: 'ask-once' }, '先问一次（30 分钟）'),
        h('option', { value: 'never' }, '从不控制'),
      )),
      world && world.permission === 'ask-once' && !world.granted
        ? row('授权', '允许她操作 30 分钟', h('button', { type: 'button', style: styles.primary, onClick: () => minecraft('grant', { minutes: 30 }) }, '允许 30 分钟'))
        : null,
    ),
    message ? h('div', { style: { fontSize: 12, opacity: 0.8 } }, message) : null,
  )
}

}
