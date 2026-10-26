// client-src/tabs-settings.js —— 设置面板（v2.4 从 client.js 抽出）。
//
// 只保留视图：React/h 和共享 helper 由 client 在运行时注入，避免复制闭包状态。
export function createSettingsTab(ctx = {}) {
  const React = ctx.React
  const h = ctx.h
  const cx = ctx.cx
  const normalizeSettings = ctx.normalizeSettings
  const num = ctx.num
  const switchNode = ctx.switchNode
  const growthMetricsTree = ctx.growthMetricsTree
  const weatherChipText = ctx.weatherChipText
  const weatherUpdatedLabel = ctx.weatherUpdatedLabel
  const moodBasisText = ctx.moodBasisText
  const moodAiFailureLabel = ctx.moodAiFailureLabel

function SettingsTab(props) {
const api = props.api || {}
const settings = (api.settings && typeof api.settings === 'object') ? api.settings : normalizeSettings()
const [confirmReset, setConfirmReset] = React.useState(false)
const [cityDraft, setCityDraft] = React.useState(settings.weatherCity || '北京')
React.useEffect(() => {
 setCityDraft(settings.weatherCity || '北京')
}, [settings.weatherCity])
const update = api.updateSettings || (() => {})

function commitCity() {
 const raw = String(cityDraft == null ? '' : cityDraft).trim()
 const nextCity = raw.length >= 1 && raw.length <= 20 ? raw : '北京'
 setCityDraft(nextCity)
 if (nextCity !== settings.weatherCity) update({ weatherCity: nextCity })
}

const weatherRes = api.weatherRes || {}
const weatherInfo = api.weatherData && api.weatherData.weather ? api.weatherData.weather : null
const weatherAt = weatherRes.at || (weatherInfo && weatherInfo.updatedAt) || 0
const weatherStatusText = weatherInfo
 ? weatherChipText(api.weatherData.city, weatherInfo)
  + (weatherAt ? ' · 更新于 ' + weatherUpdatedLabel(weatherAt) : '')
 : (weatherRes.status === 'loading' ? '正在获取天气…' : '天气暂不可用（不影响其他功能）')
const currentMood = api.moodView || null
const moodAt = (api.moodRes && (api.moodRes.at || (api.moodRes.data && api.moodRes.data.updatedAt))) || 0
const moodSourceLabel = api.moodSource === 'model' ? '模型' : api.moodSource === 'heuristic' ? '启发式' : ''
const moodReasonText = currentMood ? String(currentMood.reason || '').replace(/[「」]/g, '').trim() : ''
const moodQuotedReason = moodReasonText ? '「' + moodReasonText + '」' : ''
const moodDetailText = currentMood ? '当前：' + currentMood.label + moodQuotedReason : ''
const moodMetaText = [api.moodBasis || moodBasisText(api.weather), moodSourceLabel ? '来源：' + moodSourceLabel : '', moodAt ? '更新于 ' + weatherUpdatedLabel(moodAt) : '']
 .filter(Boolean)
 .join(' · ')
const moodStatusText = [moodDetailText, moodMetaText].filter(Boolean).join(' · ') || '心情数据加载中'
const moodStatusFull = [moodDetailText, moodMetaText].filter(Boolean).join(' · ')
const moodLine = (text, className, key) => h('div', { key, className: cx('dshp-card-summary', 'dshp-ellipsis', className), title: text }, text)

function seg(options, current, onPick) {
 return h(
  'div',
  { className: 'dshp-seg' },
  options.map((option) => h('button', {
  key: String(option.value),
  type: 'button',
  className: cx('dshp-seg-btn', current === option.value && 'dshp-is-active'),
  onClick: () => onPick(option.value),
  }, option.label)),
 )
}

const boot = api.boot || {}
const data = boot.data || {}
const version = data.version || '0.1.0'
const dataVersion = data.dataVersion || '—'
const source = data.source || {}
function renderSelfStatus() {
 const status = api.selfStatus
 if (!status) return null
 // v1.80：成长状态改成上下结构（标签在上、内容占满整行），不再左右挤在一起。
 return h(
  'div',
  { className: 'dshp-field dshp-field-stacked' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '成长状态'), h('small', null, '自驱成长 · 最近进度')),
  h('div', { className: 'dshp-field-stack-body' }, growthMetricsTree(status)),
 )
}

/** v1.83：运行状态（只读）——预算/心跳/模型失败；数据来自 health.json，每分钟刷新。 */
function renderHealthStatus() {
 const health = api.healthStatus
 if (!health) return null
 const budgetLine = health.totalLimit > 0 ? `今日模型调用 ${health.total}/${health.totalLimit}` : `今日模型调用 ${health.total}（未设上限）`
 const roles = health.roleCounts.map((item) => `${item.role} ${item.count}`).join(' · ')
 const jobs = health.jobs.slice(0, 8)
 const jobLine = jobs.length > 0 ? jobs.map((job) => `${job.name}${job.errors > 0 ? `(${job.errors}错)` : ''}`).join(' · ') : '心跳未注册'
 const errorLine = health.modelErrorTotal > 0
  ? `最近 24h 模型失败 ${health.modelErrorTotal} 次` + (health.modelErrorsByRole.length ? '：' + health.modelErrorsByRole.map((item) => `${item.role}×${item.count}`).join('、') : '')
  : '最近 24h 模型失败 0'
 return h(
  'div',
  { className: 'dshp-field dshp-field-stacked' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '运行状态（只读）'), h('small', null, '预算 · 心跳 · 模型失败；每分钟刷新')),
  h(
   'div',
   { className: 'dshp-field-stack-body' },
   h('div', { className: 'dshp-health-line' }, budgetLine + (health.day ? ' · ' + health.day : '')),
   roles ? h('div', { className: 'dshp-health-line' }, '调用：' + roles) : null,
   h('div', { className: 'dshp-health-line' }, '心跳：' + jobLine),
   health.memoryBacklog !== null
    ? h('div', { className: 'dshp-health-line' }, health.memoryBacklog === 0
     ? '记忆整合：已追平'
     : '记忆整合 backlog：' + health.memoryBacklog + ' 条' + (health.memoryBacklogOldestAt ? '（最早 ' + new Date(health.memoryBacklogOldestAt).toLocaleTimeString('zh-CN', { hour12: false }) + '）' : ''))
    : null,
   health.growthMetrics
    ? h('div', { className: 'dshp-health-line' }, '成长：第 ' + health.growthMetrics.daysAlive + ' 天 · journal ' + health.growthMetrics.journalTotal + ' 条 · 回忆 ' + health.growthMetrics.episodes + ' 段（覆盖 ' + Math.round(health.growthMetrics.coverage * 100) + '%）· 学习 ' + health.growthMetrics.learning + ' 条 · 重复 ' + health.growthMetrics.repetition.toFixed(2) + (health.growthMetrics.project ? ' · 在做：' + health.growthMetrics.project : ''))
    : null,
   h('div', { className: 'dshp-health-line' }, errorLine),
  ),
 )
}

return h(
 'div',
 { className: 'dshp-settings' },
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '大小'), h('small', null, '形象缩放 60%–160%')),
  h(
  'div',
  { className: 'dshp-field-control' },
  h('input', {
   type: 'range',
   className: 'dshp-range',
   min: 60,
   max: 160,
   step: 5,
   value: Math.round(settings.scale * 100),
   'aria-label': '挂件大小',
   onChange: (event) => update({ scale: num(event.target.value, 100) / 100 }),
  }),
  h('span', { className: 'dshp-muted', style: { fontSize: '11.5px', width: '38px', textAlign: 'right' } }, Math.round(settings.scale * 100) + '%'),
  ),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '诗词设置'), h('small', null, '已降权到「成长 → 诗词（二级菜单）→ 设置」')),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '吸附'), h('small', null, '拖动后贴边或自由摆放')),
  seg([
  { value: 'left', label: '贴左' },
  { value: 'right', label: '贴右' },
  { value: 'free', label: '自由' },
  ], settings.snap, (value) => update({ snap: value })),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '天气城市'), h('small', null, '1–20 字，保存后自动重拉天气')),
  h(
  'div',
  { className: 'dshp-field-control' },
  h('input', {
   type: 'text',
   className: 'dshp-input',
   style: { width: '118px' },
   value: cityDraft,
   maxLength: 20,
   placeholder: '北京',
   'aria-label': '天气城市',
   onChange: (event) => setCityDraft(event.target.value),
   onBlur: commitCity,
   onKeyDown: (event) => {
    if (event.key === 'Enter') {
    event.preventDefault()
    commitCity()
    }
   },
  }),
  ),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '天气'), h('small', null, weatherStatusText)),
  h(
  'div',
  { className: 'dshp-field-control' },
  h('button', {
   type: 'button',
   className: 'dshp-btn',
   onClick: () => {
    if (api.refreshWeather) api.refreshWeather(true)
   },
  }, '刷新天气'),
  ),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '自言自语（偶尔说说话）'), h('small', null, '每隔 1–2 分钟可能说一句（事件后会更早）；不设每日次数')),
  switchNode(settings.spontaneousPoem, () => update({ spontaneousPoem: !settings.spontaneousPoem }), '自言自语开关'),
 ),
 renderSelfStatus(),
 renderHealthStatus(),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '想读的诗'), h('small', null, '预览一次彩蛋（不计入每日次数）')),
  h(
  'div',
  { className: 'dshp-field-control' },
  h('button', {
   type: 'button',
   className: 'dshp-btn',
   onClick: () => {
    if (api.previewSpontaneousPoem) api.previewSpontaneousPoem()
   },
  }, '预览一句'),
  ),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '隐藏挂件'), h('small', null, '双击空白处或长按角落小圆点恢复')),
  h(
  'div',
  { className: 'dshp-field-control' },
  h('button', {
   type: 'button',
   className: 'dshp-btn dshp-btn-danger',
   onClick: () => {
    setConfirmReset(false)
    if (api.hideWidget) api.hideWidget()
   },
  }, '隐藏'),
  ),
 ),
 h(
  'div',
  { className: 'dshp-field' },
  h('div', { className: 'dshp-field-label' }, h('b', null, '恢复默认'), h('small', null, '大小 / 平仄 / 模式 / 吸附 / 字体')),
  h(
  'div',
  { className: 'dshp-field-control' },
  confirmReset
   ? [
    h('button', {
    key: 'confirm',
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: () => {
     setConfirmReset(false)
     if (api.resetSettings) api.resetSettings()
    },
    }, '确认恢复'),
    h('button', {
    key: 'cancel',
    type: 'button',
    className: 'dshp-btn',
    onClick: () => setConfirmReset(false),
    }, '取消'),
   ]
   : h('button', {
    type: 'button',
    className: 'dshp-btn',
    onClick: () => setConfirmReset(true),
   }, '恢复默认'),
  ),
 ),
 h('div', { className: 'dshp-subtitle' }, '关于'),
 h(
  'div',
  { className: 'dshp-about' },
  h('div', null, '小鲸鱼 v' + String(version)),
  h('div', null, '数据版本：' + String(dataVersion)),
  h('div', null, '数据源：chinese-poetry（MIT）· 诗词为公版文本'),
  source.commit ? h('div', null, '源提交：' + String(source.commit).slice(0, 12)) : null,
  h('div', null, '设置保存在本机 $DSH_HOME/.dsh-poetry/settings.json；隐藏后双击页面空白处或长按角落小圆点恢复。'),
 ),
)
}

  return SettingsTab
}
