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

/** 从失败响应里提取可读错误（兼容 {error:{message}} / {error:'x'} / {errors:[...]} / {message} / {code}）。 */
function describeApiError(data, status) {
  if (data && typeof data === 'object') {
    if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string' && data.error.message) return data.error.message
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0]
      if (first && typeof first.message === 'string' && first.message) return first.message
    }
    if (typeof data.error === 'string' && data.error) return data.error
    if (typeof data.message === 'string' && data.message) return data.message
    if (typeof data.code === 'string' && data.code) return data.code
  }
  return 'HTTP ' + status
}

/** 新版 API client：same-origin、统一错误文案；供模型策略/Hub 区使用（不改动旧 request）。 */
function apiRequest(path, init) {
  const options = Object.assign({ credentials: 'same-origin' }, init || {})
  return fetch(API + path, options).then(async (response) => {
    const data = await response.json().catch(() => null)
    if (!response.ok || !data || data.ok === false) {
      throw new Error(describeApiError(data, response.status))
    }
    return data
  })
}

const POLICY_ROLES = ['drive', 'thinking', 'selfTalk']
const POLICY_ROLE_LABELS = { drive: '自处', thinking: '思考', selfTalk: '碎碎念' }
const POLICY_EFFORTS = ['off', 'low', 'high', 'max']

function draftFromPolicy(policy) {
  const source = policy && typeof policy === 'object' ? policy : {}
  const roles = {}
  for (const role of POLICY_ROLES) {
    const entry = source.roles && typeof source.roles === 'object' ? source.roles[role] : null
    roles[role] = {
      provider: entry && typeof entry.provider === 'string' ? entry.provider : '',
      model: entry && typeof entry.model === 'string' ? entry.model : '',
      reasoningEffort: entry && typeof entry.reasoningEffort === 'string' ? entry.reasoningEffort : '',
    }
  }
  return {
    provider: typeof source.provider === 'string' ? source.provider : '',
    model: typeof source.model === 'string' ? source.model : '',
    tokenLimit: Number.isFinite(Number(source.tokenLimit)) ? Number(source.tokenLimit) : 0,
    roles,
  }
}

function policyPayload(draft) {
  const payload = { tokenLimit: Math.max(0, Math.floor(Number(draft.tokenLimit) || 0)) }
  if (typeof draft.provider === 'string' && draft.provider.trim()) payload.provider = draft.provider.trim()
  if (typeof draft.model === 'string' && draft.model.trim()) payload.model = draft.model.trim()
  const roles = {}
  for (const role of POLICY_ROLES) {
    const entry = draft.roles && draft.roles[role] ? draft.roles[role] : {}
    const out = {}
    if (typeof entry.provider === 'string' && entry.provider.trim()) out.provider = entry.provider.trim()
    if (typeof entry.model === 'string' && entry.model.trim()) out.model = entry.model.trim()
    if (typeof entry.reasoningEffort === 'string' && entry.reasoningEffort) out.reasoningEffort = entry.reasoningEffort
    if (Object.keys(out).length > 0) roles[role] = out
  }
  if (Object.keys(roles).length > 0) payload.roles = roles
  return payload
}

function hubSummary(hub) {
  const data = hub && typeof hub === 'object' ? hub : {}
  const layers = data.hub && typeof data.hub === 'object' && data.hub.layers && typeof data.hub.layers === 'object' ? data.hub.layers : {}
  const scheduler = layers.scheduler && typeof layers.scheduler === 'object' ? layers.scheduler : {}
  const activities = data.activities && Array.isArray(data.activities.activities) ? data.activities.activities : []
  const memory = data.memory && typeof data.memory === 'object' ? data.memory : {}
  return {
    available: data.available === true,
    mode: typeof data.mode === 'string' ? data.mode : 'off',
    assembled: data.assembled === true,
    foreground: scheduler.foreground && typeof scheduler.foreground === 'object' ? scheduler.foreground : null,
    queue: Array.isArray(scheduler.queue) ? scheduler.queue.length : 0,
    activities,
    memoryProviders: Array.isArray(memory.providers) ? memory.providers : [],
  }
}

function hubTaskList(hub) {
  const data = hub && typeof hub === 'object' ? hub : {}
  const board = data.tasks && typeof data.tasks === 'object' ? data.tasks : {}
  // Gate I3：优先用 GET /hub.json 的完整 tasks.list（≤100）；旧后端没有时回退 recentEvents。
  if (Array.isArray(board.list) && board.list.length > 0) {
    return board.list
      .filter((task) => task && typeof task.id === 'string')
      .slice(0, 100)
      .map((task) => ({
        id: task.id,
        kind: typeof task.kind === 'string' ? task.kind : '',
        activity: typeof task.activity === 'string' ? task.activity : '',
        status: typeof task.status === 'string' ? task.status : '',
        updatedAt: Number(task.updatedAt) || 0,
      }))
  }
  const events = Array.isArray(board.recentEvents) ? board.recentEvents : []
  const byId = new Map()
  for (const event of events) {
    const task = event && event.task && typeof event.task === 'object' ? event.task : null
    if (!task || typeof task.id !== 'string') continue
    const previous = byId.get(task.id)
    if (previous === undefined || Number(task.updatedAt || 0) >= Number(previous.updatedAt || 0)) {
      byId.set(task.id, {
        id: task.id,
        kind: typeof task.kind === 'string' ? task.kind : '',
        activity: typeof task.activity === 'string' ? task.activity : '',
        status: typeof task.status === 'string' ? task.status : '',
        updatedAt: Number(task.updatedAt) || 0,
      })
    }
  }
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 8)
}

function safeDisplayText(value, max = 120) {
  const text = String(value == null ? '' : value)
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('')
}

const TERMINAL_TASK_STATUSES = ['done', 'failed', 'cancelled']

function costDraftFrom(data) {
  const config = data && data.config && typeof data.config === 'object' ? data.config : {}
  const int = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback)
  return {
    disabled: config.disabled === true,
    minuteTotal: int(config.minuteTotal, 0),
    dayTotal: int(config.dayTotal, 0),
    softMinuteTotal: int(config.softMinuteTotal, 20),
    softDayTotal: int(config.softDayTotal, 600),
  }
}

function costPayload(draft) {
  const int = (value, fallback) => Math.max(0, Math.floor(Number(value) || fallback))
  return {
    disabled: draft.disabled === true,
    minuteTotal: int(draft.minuteTotal, 0),
    dayTotal: int(draft.dayTotal, 0),
    softMinuteTotal: int(draft.softMinuteTotal, 20),
    softDayTotal: int(draft.softDayTotal, 600),
  }
}

const TRAINING_ACTION_LABELS = { run: '运行', cancel: '取消', promote: '上线', rollback: '回滚' }

function trainingDraftFrom(data) {
  const config = data && data.config && data.config.config ? data.config.config : {}
  const dataset = config.dataset && typeof config.dataset === 'object' ? config.dataset : {}
  const hyper = config.hyperparams && typeof config.hyperparams === 'object' ? config.hyperparams : {}
  const evaluation = config.eval && typeof config.eval === 'object' ? config.eval : {}
  return {
    enabled: config.enabled === true,
    intervalDays: Number.isFinite(Number(config.intervalDays)) ? Number(config.intervalDays) : 7,
    minEntries: Number.isFinite(Number(dataset.minEntries)) ? Number(dataset.minEntries) : 200,
    rank: Number.isFinite(Number(hyper.rank)) ? Number(hyper.rank) : 8,
    steps: Number.isFinite(Number(hyper.steps)) ? Number(hyper.steps) : 300,
    lr: Number.isFinite(Number(hyper.lr)) ? Number(hyper.lr) : 0.0001,
    minScore: Number.isFinite(Number(evaluation.minScore)) ? Number(evaluation.minScore) : 0.6,
  }
}

function trainingPayload(draft) {
  const int = (value, fallback, min) => Math.max(min, Math.floor(Number(value) || fallback))
  return {
    enabled: draft.enabled === true,
    intervalDays: int(draft.intervalDays, 7, 1),
    dataset: { minEntries: int(draft.minEntries, 200, 1) },
    hyperparams: {
      rank: int(draft.rank, 8, 1),
      steps: int(draft.steps, 300, 1),
      lr: Math.min(1, Math.max(0.000001, Number(draft.lr) || 0.0001)),
    },
    eval: { minScore: Math.min(1, Math.max(0, Number(draft.minScore) || 0)) },
  }
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
  error: { fontSize: 12, color: '#d92d20', margin: '6px 0' },
  input: { borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d0d3d9)', padding: '5px 8px', fontSize: 12, background: 'var(--dsw-alias-bg-base-platform, #fff)', color: 'inherit', width: 150 },
}

export function createWhaleSettingsPage(React, h) {
  return function WhaleSettingsPage() {
  const [settings, setSettings] = React.useState(null)
  const [mc, setMc] = React.useState(null)
  const [busy, setBusy] = React.useState('')
  const [message, setMessage] = React.useState('')
  // Gate H1：模型策略与 Hub 控制面（后端 API 已存在；失败只提示，不影响现有设置）。
  const [policy, setPolicy] = React.useState(null)
  const [policyDraft, setPolicyDraft] = React.useState(() => draftFromPolicy(null))
  const [policyError, setPolicyError] = React.useState('')
  const [hub, setHub] = React.useState(null)
  const [hubError, setHubError] = React.useState('')
  const [hubBusy, setHubBusy] = React.useState('')
  // Gate H4：训练旁路（默认关闭；runner 未注入时明确提示，不显示假成功）。
  const [training, setTraining] = React.useState(null)
  const [trainingDraft, setTrainingDraft] = React.useState(() => trainingDraftFrom(null))
  const [trainingError, setTrainingError] = React.useState('')
  const [trainingBusy, setTrainingBusy] = React.useState('')
  const [pendingTrainingAction, setPendingTrainingAction] = React.useState('')
  // Gate N3：成本策略（限额/软告警；保存后实时生效）。
  const [costPolicy, setCostPolicy] = React.useState(null)
  const [costDraft, setCostDraft] = React.useState(() => costDraftFrom(null))
  const [costError, setCostError] = React.useState('')
  const [costBusy, setCostBusy] = React.useState('')
  // Gate I2：Hub 任务/活动控制 + 记忆查询。
  const [memoryQuery, setMemoryQuery] = React.useState('')
  const [memoryResults, setMemoryResults] = React.useState(null)
  const [memoryError, setMemoryError] = React.useState('')
  const [memoryBusy, setMemoryBusy] = React.useState(false)

  const refresh = React.useCallback(() => {
    request('/settings.json').then((data) => setSettings(normalizeSettings(data.settings))).catch(() => {})
    request('/minecraft-control.json').then((data) => setMc(data)).catch(() => {})
  }, [])
  const refreshPolicy = React.useCallback(() => {
    apiRequest('/model-policy.json')
      .then((data) => { setPolicy(data); setPolicyDraft(draftFromPolicy(data && data.policy)); setPolicyError('') })
      .catch((error) => setPolicyError('读取模型策略失败：' + error.message))
  }, [])
  const refreshHub = React.useCallback(() => {
    apiRequest('/hub.json')
      .then((data) => { setHub(data); setHubError('') })
      .catch((error) => setHubError('读取 Hub 状态失败：' + error.message))
  }, [])
  const refreshCostPolicy = React.useCallback(() => {
    apiRequest('/cost-policy.json')
      .then((data) => {
        setCostPolicy(data)
        setCostDraft(costDraftFrom(data))
        setCostError('')
      })
      .catch((error) => setCostError('读取成本策略失败：' + error.message))
  }, [])
  const refreshTraining = React.useCallback(() => {
    apiRequest('/training.json')
      .then((data) => { setTraining(data); setTrainingDraft(trainingDraftFrom(data)); setTrainingError('') })
      .catch((error) => setTrainingError('读取训练状态失败：' + error.message))
  }, [])
  React.useEffect(() => { refresh(); refreshPolicy(); refreshHub(); refreshTraining(); refreshCostPolicy() }, [refresh, refreshPolicy, refreshHub, refreshTraining, refreshCostPolicy])

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

  function setPolicyField(field, value) {
    setPolicyDraft((draft) => Object.assign({}, draft, { [field]: value }))
  }
  function setRoleField(role, field, value) {
    setPolicyDraft((draft) => {
      const roles = Object.assign({}, draft.roles)
      roles[role] = Object.assign({}, roles[role] || {}, { [field]: value })
      return Object.assign({}, draft, { roles })
    })
  }
  function savePolicy() {
    setBusy('policy-save')
    setPolicyError('')
    apiRequest('/model-policy.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policyPayload(policyDraft)),
    })
      .then((data) => {
        setPolicy(data)
        setPolicyDraft(draftFromPolicy(data && data.policy))
        setMessage('模型策略已保存')
        setTimeout(() => setMessage(''), 1800)
      })
      .catch((error) => setPolicyError('保存失败：' + error.message))
      .finally(() => setBusy(''))
  }
  function resetPolicy() {
    setBusy('policy-reset')
    setPolicyError('')
    apiRequest('/model-policy.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
      .then((data) => {
        setPolicy(data)
        setPolicyDraft(draftFromPolicy(data && data.policy))
        setMessage('模型策略已重置')
        setTimeout(() => setMessage(''), 1800)
      })
      .catch((error) => setPolicyError('重置失败：' + error.message))
      .finally(() => setBusy(''))
  }
  function setTrainingField(field, value) {
    setTrainingDraft((draft) => Object.assign({}, draft, { [field]: value }))
  }
  function setCostField(field, value) {
    setCostDraft((draft) => Object.assign({}, draft, { [field]: value }))
  }
  function saveCostPolicy() {
    setCostBusy('save')
    setCostError('')
    apiRequest('/cost-policy.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: costPayload(costDraft) }),
    })
      .then((data) => {
        if (data && data.ok === false) {
          setCostError('保存成本策略失败：' + (data.message || data.error || '被拒绝'))
          return
        }
        setCostPolicy(data)
        setCostDraft(costDraftFrom(data))
        setMessage('成本策略已保存并生效')
        setTimeout(() => setMessage(''), 1800)
      })
      .catch((error) => setCostError('保存成本策略失败：' + error.message))
      .finally(() => setCostBusy(''))
  }
  function resetCostPolicy() {
    setCostBusy('reset')
    setCostError('')
    apiRequest('/cost-policy.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
      .then((data) => {
        if (data && data.ok === false) {
          setCostError('重置成本策略失败：' + (data.message || data.error || '被拒绝'))
          return
        }
        refreshCostPolicy()
        setMessage('成本策略已重置为默认')
        setTimeout(() => setMessage(''), 1800)
      })
      .catch((error) => setCostError('重置成本策略失败：' + error.message))
      .finally(() => setCostBusy(''))
  }
  function saveTraining() {
    setTrainingBusy('training-save')
    setTrainingError('')
    apiRequest('/training.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'config', config: trainingPayload(trainingDraft) }),
    })
      .then((data) => {
        setTraining(data)
        setTrainingDraft(trainingDraftFrom(data))
        setMessage('训练配置已保存')
        setTimeout(() => setMessage(''), 1800)
      })
      .catch((error) => setTrainingError('保存训练配置失败：' + error.message))
      .finally(() => setTrainingBusy(''))
  }
  function requestTrainingAction(action) {
    setPendingTrainingAction(action)
    setTrainingError('')
  }
  function confirmTrainingAction() {
    const action = pendingTrainingAction
    if (!action) return
    setTrainingBusy(action)
    setPendingTrainingAction('')
    apiRequest('/training.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, confirm: true }),
    })
      .then((data) => {
        if (data && data.ok === false) {
          setTrainingError((TRAINING_ACTION_LABELS[action] || action) + '失败：' + (data.message || data.code || '被拒绝'))
          return
        }
        setMessage((TRAINING_ACTION_LABELS[action] || action) + '已提交')
        setTimeout(() => setMessage(''), 1800)
        refreshTraining()
      })
      .catch((error) => setTrainingError((TRAINING_ACTION_LABELS[action] || action) + '失败：' + error.message))
      .finally(() => setTrainingBusy(''))
  }
  function hubAction(action, extra) {
    setHubBusy(action)
    setHubError('')
    apiRequest('/hub.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action }, extra || {})),
    })
      .then(() => refreshHub())
      .catch((error) => setHubError('Hub 操作失败：' + error.message))
      .finally(() => setHubBusy(''))
  }
  function queryMemory() {
    const text = String(memoryQuery || '').trim()
    if (text.length === 0) {
      setMemoryError('请输入要查询的记忆关键词')
      return
    }
    setMemoryBusy(true)
    setMemoryError('')
    apiRequest('/hub.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'memory.query', filter: { text, limit: 5 } }),
    })
      .then((data) => {
        if (data && data.ok === false) {
          setMemoryResults(null)
          setMemoryError('记忆查询失败：' + (data.message || data.code || '被拒绝'))
          return
        }
        setMemoryResults(data)
      })
      .catch((error) => {
        setMemoryResults(null)
        setMemoryError('记忆查询失败：' + error.message)
      })
      .finally(() => setMemoryBusy(false))
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
  const hubInfo = hubSummary(hub)
  const hubTaskRows = hubTaskList(hub)
  const allowedProviders = policy && policy.allowed && Array.isArray(policy.allowed.providers) ? policy.allowed.providers.slice() : []
  if (policyDraft.provider && allowedProviders.indexOf(policyDraft.provider) < 0) allowedProviders.push(policyDraft.provider)
  const providerSelect = (ariaLabel, value, onChange) => h('select', {
    style: styles.select,
    'aria-label': ariaLabel,
    value: value || '',
    onChange,
  },
    h('option', { value: '' }, '跟随默认'),
    allowedProviders.map((provider) => h('option', { key: provider, value: provider }, provider)),
  )
  const effortSelect = (ariaLabel, value, onChange) => h('select', {
    style: styles.select,
    'aria-label': ariaLabel,
    value: value || '',
    onChange,
  },
    h('option', { value: '' }, '默认'),
    POLICY_EFFORTS.map((effort) => h('option', { key: effort, value: effort }, effort)),
  )
  const effectiveLine = (role) => {
    const entry = policy && policy.effective && policy.effective.roles ? policy.effective.roles[role] : null
    if (!entry || !entry.provider) return '生效：未配置'
    const effort = entry.reasoningEffort ? '(' + entry.reasoningEffort + ')' : ''
    return '生效：' + entry.provider + '/' + entry.model + effort + ' ← ' + (entry.source || 'default-chain')
  }
  const trainingStatus = training && training.status ? training.status : null
  const trainingPlan = training && training.plan ? training.plan : null
  const trainingConfig = training && training.config && training.config.config ? training.config.config : null
  const trainingEnabled = Boolean(trainingConfig && trainingConfig.enabled)
  const runnerAvailable = Boolean(trainingStatus && trainingStatus.runnerAvailable)
  const trainingPhase = trainingStatus && typeof trainingStatus.phase === 'string' ? trainingStatus.phase : 'idle'
  const trainingBlocked = trainingPlan && typeof trainingPlan.blockedReason === 'string' ? trainingPlan.blockedReason : ''
  const trainingNumber = (ariaLabel, value, onChange, extra) => h('input', Object.assign({
    type: 'number',
    style: styles.input,
    'aria-label': ariaLabel,
    value,
    onChange: (event) => onChange(Number(event.target.value)),
  }, extra || {}))
  const policyField = (ariaLabel, value, onChange, extra) => h('input', Object.assign({
    type: 'text',
    style: styles.input,
    'aria-label': ariaLabel,
    value: value || '',
    onChange,
  }, extra || {}))

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
      h('div', { style: styles.title }, '模型与推理'),
      h('div', { style: styles.hint }, '手动覆盖模型/推理强度；留空 = 跟随默认（保存后立即生效）。'),
      policyError ? h('div', { style: styles.error }, policyError) : null,
      policy
        ? h('div', { style: styles.hint }, '配置：' + (policy.file || 'model-policy.json') + ' · 已保存覆盖：' + (policy.policy && policy.policy.provider ? policy.policy.provider + '/' + (policy.policy.model || '') : '无（默认）'))
        : h('div', { style: styles.hint }, '正在读取模型策略…'),
      row('Provider', '覆盖宿主默认 provider（白名单内）',
        providerSelect('模型 provider', policyDraft.provider, (event) => setPolicyField('provider', event.target.value))),
      row('Model', '覆盖宿主默认 model',
        policyField('模型 model', policyDraft.model, (event) => setPolicyField('model', event.target.value))),
      row('tokenLimit', '0 = 不封顶；>0 限制单次输出',
        h('input', {
          type: 'number',
          min: 0,
          step: 100,
          style: styles.input,
          'aria-label': '模型 tokenLimit',
          value: Number(policyDraft.tokenLimit) || 0,
          onChange: (event) => setPolicyField('tokenLimit', Math.max(0, Math.floor(Number(event.target.value) || 0))),
        })),
      POLICY_ROLES.map((role) => h('div', { style: styles.row, key: role },
        h('div', { style: styles.label },
          h('b', null, (POLICY_ROLE_LABELS[role] || role) + '（' + role + '）'),
          h('span', { style: styles.hint }, effectiveLine(role))),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          providerSelect('角色 ' + role + ' provider', policyDraft.roles[role] && policyDraft.roles[role].provider, (event) => setRoleField(role, 'provider', event.target.value)),
          policyField('角色 ' + role + ' model', policyDraft.roles[role] && policyDraft.roles[role].model, (event) => setRoleField(role, 'model', event.target.value)),
          effortSelect('角色 ' + role + ' reasoningEffort', policyDraft.roles[role] && policyDraft.roles[role].reasoningEffort, (event) => setRoleField(role, 'reasoningEffort', event.target.value)),
        ))),
      row('操作', '保存/重置只影响模型策略，不动其它设置',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { type: 'button', style: Object.assign({}, styles.button, styles.primary), disabled: busy !== '', onClick: savePolicy }, busy === 'policy-save' ? '保存中…' : '保存模型策略'),
          h('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: resetPolicy }, busy === 'policy-reset' ? '重置中…' : '重置模型策略'),
        )),
    ),
    h('div', { style: styles.card },
      h('div', { style: styles.title }, 'Hub'),
      hubError ? h('div', { style: styles.error }, hubError) : null,
      hubInfo.available
        ? h('div', { style: styles.hint }, '模式：' + hubInfo.mode + (hubInfo.assembled ? ' · 已装配' : ' · 未装配'))
        : h('div', { style: styles.hint }, hub ? 'Hub 未接入（默认 off；可用环境变量/设置开启 shadow）' : '正在读取 Hub 状态…'),
      row('模式', 'off / shadow / full', h('b', null, hubInfo.available ? hubInfo.mode : '—')),
      row('前台任务', '当前唯一前台', h('b', null, hubInfo.available ? (hubInfo.foreground ? (hubInfo.foreground.id + ' · ' + (hubInfo.foreground.status || '')) : '空闲') : '—')),
      row('排队', 'queued 任务数', h('b', null, hubInfo.available ? String(hubInfo.queue) : '—')),
      row('活动', '已注册 Activity', h('span', { style: styles.hint }, hubInfo.available
        ? (hubInfo.activities.length > 0 ? hubInfo.activities.map((item) => item.id + (item.enabled ? '（开）' : '（关）')).join('、') : '无')
        : '—')),
      row('记忆 provider', '只读记忆来源', h('span', { style: styles.hint }, hubInfo.available
        ? (hubInfo.memoryProviders.length > 0 ? hubInfo.memoryProviders.join('、') : '未接入')
        : '—')),
      hubInfo.available && hubTaskRows.length > 0
        ? hubTaskRows.map((task) => h('div', { style: styles.row, key: task.id },
          h('div', { style: styles.label },
            h('b', null, task.id + ' · ' + (task.kind || 'task')),
            h('span', { style: styles.hint }, (task.activity || '—') + ' · ' + (task.status || '') + (task.updatedAt > 0 ? ' · ' + new Date(task.updatedAt).toLocaleTimeString() : ''))),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', {
              type: 'button',
              style: styles.button,
              'aria-label': '任务 ' + task.id + ' 暂停',
              disabled: hubBusy !== '' || task.status !== 'running',
              onClick: () => hubAction('task.pause', { taskId: task.id }),
            }, '暂停'),
            h('button', {
              type: 'button',
              style: styles.button,
              'aria-label': '任务 ' + task.id + ' 恢复',
              disabled: hubBusy !== '' || task.status !== 'waiting',
              onClick: () => hubAction('task.resume', { taskId: task.id }),
            }, '恢复'),
            h('button', {
              type: 'button',
              style: styles.button,
              'aria-label': '任务 ' + task.id + ' 取消',
              disabled: hubBusy !== '' || TERMINAL_TASK_STATUSES.indexOf(task.status) >= 0,
              onClick: () => hubAction('task.cancel', { taskId: task.id }),
            }, '取消'),
          )))
        : row('任务', '最近任务（来自 Hub 快照）', h('span', { style: styles.hint }, hubInfo.available ? '暂无任务' : '—')),
      hubInfo.available && hubInfo.activities.length > 0
        ? hubInfo.activities.map((activity) => h('div', { style: styles.row, key: 'activity-' + activity.id },
          h('div', { style: styles.label },
            h('b', null, activity.id),
            h('span', { style: styles.hint }, (activity.enabled ? '已启用' : '未启用') + ' · 健康：' + (activity.health || 'unknown'))),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', {
              type: 'button',
              style: styles.button,
              'aria-label': '活动 ' + activity.id + ' 启用',
              disabled: hubBusy !== '' || activity.enabled === true,
              onClick: () => hubAction('activity.enable', { activityId: activity.id }),
            }, '启用'),
            h('button', {
              type: 'button',
              style: styles.button,
              'aria-label': '活动 ' + activity.id + ' 停用',
              disabled: hubBusy !== '' || activity.enabled !== true,
              onClick: () => hubAction('activity.disable', { activityId: activity.id }),
            }, '停用'),
          )))
        : row('活动', '已注册 Activity', h('span', { style: styles.hint }, hubInfo.available ? '无' : '—')),
      row('记忆查询', '只读查询（limit 5；脱敏/截断展示）',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('input', {
            type: 'text',
            style: styles.input,
            'aria-label': '记忆查询关键词',
            value: memoryQuery,
            onChange: (event) => setMemoryQuery(event.target.value),
          }),
          h('button', { type: 'button', style: styles.button, disabled: memoryBusy || !hubInfo.available, onClick: queryMemory }, memoryBusy ? '查询中…' : '查询记忆'),
        )),
      memoryError ? h('div', { style: styles.error }, memoryError) : null,
      memoryResults !== null
        ? h('div', { style: { margin: '6px 0' } },
          h('div', { style: styles.hint }, '结果：' + String(memoryResults.total ?? 0) + ' 条' + (memoryResults.errors && memoryResults.errors.length > 0 ? '（部分 provider 出错）' : '')),
          (memoryResults.entries || []).slice(0, 5).map((entry, index) => h('div', { style: { fontSize: 12, padding: '4px 0' }, key: 'memory-' + index },
            h('div', null, safeDisplayText(entry.text, 120)),
            h('span', { style: styles.hint }, (entry.category || '') + ' · ' + ((entry.source && entry.source.kind) || '') + (entry.at ? ' · ' + new Date(entry.at).toLocaleDateString() : '')))))
        : null,
      row('操作', '全局暂停只影响 Hub 调度，不改变现有聊天/游戏',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { type: 'button', style: styles.button, disabled: hubBusy !== '', onClick: refreshHub }, '刷新 Hub'),
          h('button', { type: 'button', style: styles.button, disabled: hubBusy !== '' || !hubInfo.available, onClick: () => hubAction('hub.pauseAll') }, hubBusy === 'hub.pauseAll' ? '暂停中…' : '暂停全部'),
          h('button', { type: 'button', style: styles.button, disabled: hubBusy !== '' || !hubInfo.available, onClick: () => hubAction('hub.resumeAll') }, hubBusy === 'hub.resumeAll' ? '恢复中…' : '恢复全部'),
        )),
    ),
    h('div', { style: styles.card },
      h('div', { style: styles.title }, '成本（模型调用闸门）'),
      costError ? h('div', { style: styles.error }, costError) : null,
      h('div', { style: styles.hint },
        costPolicy && costPolicy.available === false
          ? '成本策略存储未接入（不可用）'
          : '限额 0 = 不限制；保存后立即生效（无需重启）。软告警只提示不拦截。'),
      row('关闭成本闸门', '勾选后不拦截模型调用（仍记录用量）',
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            'aria-label': '成本 disabled',
            checked: costDraft.disabled === true,
            disabled: costBusy !== '',
            onChange: (event) => setCostField('disabled', event.target.checked),
          }),
          costDraft.disabled ? '已关闭' : '启用中')),
      row('每分钟总限额', 'minuteTotal（0 = 不限制）',
        trainingNumber('成本 minuteTotal', costDraft.minuteTotal, (value) => setCostField('minuteTotal', value), { min: 0 })),
      row('每日总限额', 'dayTotal（0 = 不限制）',
        trainingNumber('成本 dayTotal', costDraft.dayTotal, (value) => setCostField('dayTotal', value), { min: 0 })),
      row('每分钟软告警', 'softMinuteTotal（达到只告警不拦截）',
        trainingNumber('成本 softMinuteTotal', costDraft.softMinuteTotal, (value) => setCostField('softMinuteTotal', value), { min: 0 })),
      row('每日软告警', 'softDayTotal（达到只告警不拦截）',
        trainingNumber('成本 softDayTotal', costDraft.softDayTotal, (value) => setCostField('softDayTotal', value), { min: 0 })),
      row('操作', '保存会实时重建 cost guard；重置恢复默认空策略',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { type: 'button', style: Object.assign({}, styles.button, styles.primary), disabled: costBusy !== '', onClick: saveCostPolicy }, costBusy === 'save' ? '保存中…' : '保存成本策略'),
          h('button', { type: 'button', style: styles.button, disabled: costBusy !== '', onClick: resetCostPolicy }, costBusy === 'reset' ? '重置中…' : '重置成本策略'),
        )),
      costPolicy && costPolicy.updatedAt
        ? h('div', { style: styles.hint }, '上次更新：' + new Date(costPolicy.updatedAt).toLocaleString())
        : null,
    ),
    h('div', { style: styles.card },
      h('div', { style: styles.title }, '训练（旁路）'),
      trainingError ? h('div', { style: styles.error }, trainingError) : null,
      h('div', { style: styles.hint },
        !training
          ? '正在读取训练状态…'
          : trainingEnabled
            ? '已开启（enabled=true）；运行仍需二次确认' + (runnerAvailable ? '' : ' · runner 未注入：运行会被拒绝，不会启动真实训练')
            : '默认关闭（enabled=false）：不会自动训练；先保存开启再手动运行'),
      trainingStatus && !runnerAvailable
        ? h('div', { style: styles.error }, 'runner 未注入：运行会被拒绝（不会启动真实训练）')
        : null,
      trainingStatus
        ? h('div', { style: styles.hint },
          '阶段：' + trainingPhase + ' · runner：' + (runnerAvailable ? '已注入' : '未注入') +
          (trainingBlocked ? ' · 阻塞原因：' + trainingBlocked : '') +
          (trainingStatus.current ? ' · 当前 adapter：' + trainingStatus.current : ''))
        : null,
      row('开启训练', '默认关闭；开启后仍需手动运行 + 二次确认',
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
          h('input', {
            type: 'checkbox',
            'aria-label': '训练 enabled',
            checked: trainingDraft.enabled === true,
            disabled: trainingBusy !== '',
            onChange: (event) => setTrainingField('enabled', event.target.checked),
          }),
          trainingDraft.enabled ? '已开启' : '关闭')),
      row('间隔天数', '两次训练之间的最小间隔（1–90 天）',
        trainingNumber('训练 intervalDays', trainingDraft.intervalDays, (value) => setTrainingField('intervalDays', value), { min: 1, max: 90 })),
      row('数据集最少条数', '不足时 plan 会标记 insufficient-data',
        trainingNumber('训练 dataset.minEntries', trainingDraft.minEntries, (value) => setTrainingField('minEntries', value), { min: 1 })),
      row('LoRA rank', '超参 rank（1–128）',
        trainingNumber('训练 hyperparams.rank', trainingDraft.rank, (value) => setTrainingField('rank', value), { min: 1, max: 128 })),
      row('训练步数', 'steps（1–100000）',
        trainingNumber('训练 hyperparams.steps', trainingDraft.steps, (value) => setTrainingField('steps', value), { min: 1 })),
      row('学习率 lr', 'lr（0–1）',
        trainingNumber('训练 hyperparams.lr', trainingDraft.lr, (value) => setTrainingField('lr', value), { min: 0, max: 1, step: 0.00001 })),
      row('评估最低分', 'eval.minScore（0–1）；candidate 必须 ≥ 该分才能上线',
        trainingNumber('训练 eval.minScore', trainingDraft.minScore, (value) => setTrainingField('minScore', value), { min: 0, max: 1, step: 0.01 })),
      row('配置', '保存只写训练配置，不启动训练',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { type: 'button', style: Object.assign({}, styles.button, styles.primary), disabled: trainingBusy !== '', onClick: saveTraining }, trainingBusy === 'training-save' ? '保存中…' : '保存训练配置'),
          h('button', { type: 'button', style: styles.button, disabled: trainingBusy !== '', onClick: refreshTraining }, '刷新训练状态'),
        )),
      row('操作', '全部需要二次确认；默认关闭/无 runner 时运行会被拒绝',
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            style: styles.button,
            disabled: trainingBusy !== '' || !trainingEnabled || !runnerAvailable,
            onClick: () => requestTrainingAction('run'),
          }, trainingBusy === 'run' ? '运行中…' : '运行'),
          h('button', { type: 'button', style: styles.button, disabled: trainingBusy !== '' || trainingPhase !== 'running', onClick: () => requestTrainingAction('cancel') }, '取消'),
          h('button', { type: 'button', style: styles.button, disabled: trainingBusy !== '', onClick: () => requestTrainingAction('promote') }, '上线'),
          h('button', { type: 'button', style: styles.button, disabled: trainingBusy !== '', onClick: () => requestTrainingAction('rollback') }, '回滚'),
        )),
      pendingTrainingAction
        ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
          h('span', { style: { fontSize: 12, color: '#d92d20' } }, '确认执行「' + (TRAINING_ACTION_LABELS[pendingTrainingAction] || pendingTrainingAction) + '」？'),
          h('button', { type: 'button', style: Object.assign({}, styles.button, styles.primary), 'aria-label': '确认训练操作', onClick: confirmTrainingAction }, '确认执行'),
          h('button', { type: 'button', style: styles.button, onClick: () => setPendingTrainingAction('') }, '放弃'),
        )
        : null,
      trainingStatus && trainingStatus.candidate
        ? h('div', { style: styles.hint },
          '候选：' + trainingStatus.candidate.id + ' · score=' + String(trainingStatus.candidate.score ?? 'n/a') +
          ' · ' + (trainingStatus.candidate.passed ? '评估通过' : '评估未通过（不可上线）'))
        : null,
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
