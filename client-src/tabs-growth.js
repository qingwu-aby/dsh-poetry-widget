// client-src/tabs-growth.js —— 成长主页（v2.4 从 client.js 抽出）。
export function createGrowthTab(ctx = {}) {
  const h = ctx.h
  const cx = ctx.cx
  const switchNode = ctx.switchNode
  const growthMetricsTree = ctx.growthMetricsTree
  const moodAiFailureLabel = ctx.moodAiFailureLabel
  const selfStatusSummary = ctx.selfStatusSummary
  const weatherUpdatedLabel = ctx.weatherUpdatedLabel

function GrowthTab(props) {
 const api = props.api || {}
 const settings = api.settings && typeof api.settings === 'object' ? api.settings : {}
 const mood = api.moodView || null
 const status = api.selfStatus || null
 const memory = api.memoryStatus || null
 const recent = (Array.isArray(api.recentSpoken) ? api.recentSpoken : []).slice(-5)
 const moodSource = (mood && mood.source) || api.moodSource || ''
 const moodSourceLabel = moodSource === 'model' ? '模型生成' : moodSource === 'heuristic' ? '启发式' : ''
 const sayButton = api.previewSpontaneousPoem || api.readAnotherSpontaneous || function () {}
 const moodFailureText = api.moodAiFailure
  ? moodAiFailureLabel(api.moodAiFailure) + (api.moodAiFailureCode ? '（' + String(api.moodAiFailureCode).slice(0, 48) + '）' : '')
  : ''
 const memoryLabels = { ok: '健康', warn: '注意', error: '异常' }
 const recentActions = status && status.actions && Array.isArray(status.actions.recent) ? status.actions.recent.slice(0, 5) : []
 const works = api.worksRes && api.worksRes.data && Array.isArray(api.worksRes.data.works) ? api.worksRes.data.works.slice(0, 3) : []
 return h(
  'div',
  { className: 'dshp-growth' },
  h('div', { className: 'dshp-growth-title' }, '我的成长'),
  h(
   'div',
   { className: 'dshp-growth-mood' },
   h('div', { className: 'dshp-growth-mood-label' }, mood && mood.label ? mood.label : '还没形成心情'),
   mood && mood.reason ? h('div', { className: 'dshp-growth-mood-reason' }, String(mood.reason)) : null,
   moodSourceLabel ? h('div', { className: 'dshp-growth-mood-source' }, '来源：' + moodSourceLabel) : null,
   api.moodAiFallback ? h('div', { className: 'dshp-growth-mood-note' }, '当前使用本地面部表情（模型心情不可用，回退启发式）') : null,
   api.moodAiStale ? h('div', { className: 'dshp-growth-mood-note' }, '模型心情暂时不可用（' + moodAiFailureLabel(api.moodAiFailure) + (api.moodAiFailureCode ? '，' + String(api.moodAiFailureCode).slice(0, 48) : '') + '），保留上一次，稍后重试') : null,
   api.moodAiFailure ? h('div', { className: 'dshp-growth-mood-note' }, '上次模型心情失败：' + moodFailureText) : null,
   h(
    'div',
    { className: 'dshp-growth-mood-controls' },
    h('span', { className: 'dshp-growth-mood-control-label' }, '心情换装'),
    switchNode(settings.mood === true, () => { if (api.updateSettings) api.updateSettings({ mood: !settings.mood }) }, '心情换装开关'),
    h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.refreshMoodNow) api.refreshMoodNow() } }, '刷新心情'),
   ),
  ),
  h(
   'div',
   { className: 'dshp-growth-section' },
   h('div', { className: 'dshp-growth-section-head' }, '内在状态'),
   status && status.sleeping
    ? h('div', { className: 'dshp-growth-sleep' }, '睡眠中' + (status.sleepSince ? ' · 自 ' + weatherUpdatedLabel(status.sleepSince) : ''))
    : null,
   growthMetricsTree(status),
  ),
  status && status.project
   ? h(
    'div',
    { className: 'dshp-growth-section' },
    h('div', { className: 'dshp-growth-section-head' }, '正在做的事'),
    h('div', { className: 'dshp-growth-quote' }, status.project.title + (status.project.note ? ' · ' + status.project.note : '')),
    ...status.project.steps.map((step, index) => h('div', { className: 'dshp-growth-empty', key: 'project-step-' + index }, (weatherUpdatedLabel(step.at) || '--:--') + ' · ' + step.text)),
   )
   : null,
  h(
   'div',
   { className: 'dshp-growth-section' },
   h('div', { className: 'dshp-growth-section-head' }, '自主行为'),
   recentActions.length
    ? recentActions.map((item, index) => h(
     'div',
     { className: 'dshp-growth-action', key: 'action-' + (item.id || index) },
     h('span', { className: 'dshp-growth-action-time' }, weatherUpdatedLabel(item.at) || '--:--'),
     h('span', { className: 'dshp-growth-action-text' }, (item.label ? item.label + ' · ' : '') + String(item.text || '')),
    ))
    : h('div', { className: 'dshp-growth-empty' }, '还没有自己行动'),
  ),
  memory
   ? h(
    'div',
    { className: 'dshp-growth-section dshp-memory-card' },
    h(
     'div',
     { className: 'dshp-memory-head' },
     h('div', { className: 'dshp-growth-section-head' }, '记忆中枢'),
     h('span', { className: cx('dshp-memory-health', 'dshp-memory-' + memory.health) }, memoryLabels[memory.health] || '注意'),
    ),
    h('div', { className: 'dshp-memory-line' }, 'journal ' + memory.journal + ' 条 · 话题 ' + memory.topics + ' 条 · 学习 ' + memory.learnings + ' 条'),
    h('div', { className: 'dshp-memory-line' }, '上次备份 ' + (weatherUpdatedLabel(memory.backups.lastAt) || '—')),
    memory.recovered ? h('div', { className: 'dshp-memory-line dshp-memory-recovered' }, '已从备份恢复 ' + memory.recovered + ' 个文件') : null,
    h(
     'div',
     { className: 'dshp-growth-actions' },
     h('button', {
      type: 'button',
      className: 'dshp-btn dshp-btn-small',
      onClick: () => { if (api.backupMemory) api.backupMemory() },
     }, '立即备份'),
    ),
   )
   : null,
  works.length
   ? h(
    'div',
    { className: 'dshp-growth-section' },
    h('div', { className: 'dshp-growth-section-head' }, '我的作品'),
    works.map((work, index) => h(
     'div',
     { className: 'dshp-work', key: 'work-' + (work.id || index) },
     h('div', { className: 'dshp-work-title' }, work.title),
     work.kind === 'svg' && work.src
      ? h('img', { className: 'dshp-work-art', src: work.src, alt: work.title, loading: 'lazy' })
      : h('div', { className: 'dshp-growth-quote' }, work.body),
     h('div', { className: 'dshp-work-time' }, weatherUpdatedLabel(work.createdAt) || '--:--'),
    )),
   )
   : null,
  h(
   'div',
   { className: 'dshp-growth-section' },
   h('div', { className: 'dshp-growth-section-head' }, '最近说过的话'),
   recent.length
    ? recent.map((text, index) => h('div', { className: 'dshp-growth-quote', key: 'recent-' + index }, '「' + String(text) + '」'))
    : h('div', { className: 'dshp-growth-empty' }, '还没开口'),
  ),
  h(
   'div',
   { className: 'dshp-growth-section' },
   h('div', { className: 'dshp-growth-section-head' }, '成长摘要'),
   h('div', { className: 'dshp-self-summary' }, selfStatusSummary(status) || '尚未开始'),
  ),
  h(
   'div',
   { className: 'dshp-growth-actions' },
   h('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', onClick: () => sayButton() }, '说一句'),
   api.poetryEntryEnabled === true
    ? h('button', { type: 'button', className: 'dshp-btn', onClick: () => { if (api.openPoetryModule) api.openPoetryModule() } }, '诗词模块')
    : null,
   h('button', { type: 'button', className: 'dshp-btn', onClick: () => { if (api.openSettings) api.openSettings() } }, '设置'),
  ),
 )
}

  return GrowthTab
}
