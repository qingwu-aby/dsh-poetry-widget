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
 const growthData = api.growthRes && api.growthRes.status === 'ready' && api.growthRes.data ? api.growthRes.data : null
 const growthArc = growthData && growthData.growth ? growthData.growth : null
 const growthStage = growthArc && growthArc.stage ? growthArc.stage : null
 const growthMilestones = growthArc && Array.isArray(growthArc.milestones) ? growthArc.milestones : []
 const growthDays = growthArc && growthArc.stats && Number.isFinite(growthArc.stats.days) ? growthArc.stats.days : null
 const growthNext = growthArc && growthArc.nextStage ? growthArc.nextStage : null
 const growthPhilosophy = growthData && growthData.philosophy && growthData.philosophy.current ? growthData.philosophy.current : null
 const growthEmotions = growthData && Array.isArray(growthData.emotions) ? growthData.emotions : []
 const growthAutobiography = growthData && typeof growthData.autobiography === 'string' ? growthData.autobiography : ''
 const growthReport = growthData && typeof growthData.report === 'string' ? growthData.report : ''
 const attention = api.attentionRes && api.attentionRes.data ? api.attentionRes.data : { mode: 'observe', items: [], pending: 0 }
 const pendingAttention = Array.isArray(attention.items) ? attention.items : []
 const attentionMode = attention.mode === 'auto' ? 'auto' : 'observe'
 const attentionButtons = (item) => h(
  'div',
  { style: { display: 'flex', gap: 6, marginTop: 6 } },
  item.kind === 'question'
   ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => {
      if (!api.attentionAction) return
      const answer = typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt('回答她：', '') : ''
      if (answer && answer.trim().length > 0) api.attentionAction(item.id, 'answer', answer.trim())
     } }, '回答')
   : item.kind === 'result'
    ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.attentionAction) api.attentionAction(item.id, 'dismiss') } }, '知道了')
    : h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.attentionAction) api.attentionAction(item.id, 'send') } }, item.draft ? '发出去' : '回复'),
  h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.attentionAction) api.attentionAction(item.id, 'dismiss') } }, '先不用'),
 )
 return h(
  'div',
  { className: 'dshp-growth' },
  h('div', { className: 'dshp-growth-title' }, '我的成长'),
  pendingAttention.length
   ? h(
    'div',
    { className: 'dshp-growth-section', style: { borderColor: '#b58a4a', background: 'rgba(181,138,74,.08)' } },
    h('div', { className: 'dshp-growth-section-head' }, '需要你 · ' + pendingAttention.length),
    h('div', { className: 'dshp-growth-mood-note', style: { marginBottom: 6 } }, attentionMode === 'observe' ? '观察模式：她准备好了，等你决定要不要发。' : '自动模式：她已有具体的事，发送前先在这里留一份。'),
    ...pendingAttention.map((item) => h(
     'div',
     { className: 'dshp-growth-action', key: 'attention-' + item.id, style: { display: 'block', marginBottom: 10 } },
     h('div', { className: 'dshp-growth-action-text', style: { whiteSpace: 'normal' } }, String(item.text || '')),
     item.reason ? h('div', { className: 'dshp-growth-empty' }, String(item.reason)) : null,
     attentionButtons(item),
    )),
    h(
     'div',
     { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 } },
     h('span', { className: 'dshp-growth-empty' }, '主动消息：'),
     h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.setAttentionMode) api.setAttentionMode(attentionMode === 'auto' ? 'observe' : 'auto') } }, attentionMode === 'auto' ? '自动' : '观察中'),
    ),
   )
   : null,
  h(
   'div',
   { className: 'dshp-growth-section' },
   h('div', { className: 'dshp-growth-section-head' }, '主动消息'),
   h(
    'div',
    { style: { display: 'flex', gap: 8, alignItems: 'center' } },
    h('span', { className: 'dshp-growth-empty' }, attentionMode === 'auto' ? '自动：有具体的事就直接发' : '观察中：她先准备，等你放行'),
    h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.setAttentionMode) api.setAttentionMode(attentionMode === 'auto' ? 'observe' : 'auto') } }, attentionMode === 'auto' ? '切回观察' : '改为自动'),
   ),
  ),
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
    status.project.stage ? h('div', { className: 'dshp-growth-empty' }, '阶段：' + ({ working: '正在做', waiting_user: '等你回答', waiting_mirror: '等镜像回信', blocked: '卡住了', idle: '暂时不动' }[status.project.stage] || status.project.stage)) : null,
    status.project.latestReport ? h('div', { className: 'dshp-growth-empty' }, '最近一次：' + status.project.latestReport.state + (status.project.latestReport.summary ? ' · ' + status.project.latestReport.summary : '')) : null,
    status.project.latestRepeat > 1
     ? h('div', { className: 'dshp-growth-empty', style: { color: '#b58a4a' } }, '最近这步重复了 ' + status.project.latestRepeat + ' 次' + (status.project.progressAt ? '，上次真正推进在 ' + (weatherUpdatedLabel(status.project.progressAt) || '--:--') : '') + '，还没有新进展')
     : null,
    status.project.attention && status.project.attention.question ? h('div', { className: 'dshp-growth-quote', style: { color: '#b58a4a' } }, '等你决定：' + status.project.attention.question) : null,
    ...status.project.steps.map((step, index) => h('div', { className: 'dshp-growth-empty', key: 'project-step-' + index }, (weatherUpdatedLabel(step.at) || '--:--') + ' · ' + step.text + (step.repeatCount > 1 ? ' ×' + step.repeatCount : ''))),
    h(
     'div',
     { style: { display: 'flex', gap: 6, marginTop: 6 } },
     h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.loadProjectDetail) api.loadProjectDetail() } }, '详情'),
     status.project.stage === 'working'
      ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.projectAction) api.projectAction('pause') } }, '暂停')
      : status.project.stage === 'waiting_user'
       ? null
       : h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { if (api.projectAction) api.projectAction('retry') } }, '继续'),
     h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => {
      if (api.projectAction && (typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm('确定放下这个项目吗？'))) api.projectAction('drop')
     } }, '放弃'),
    ),
   )
   : null,
  api.projectDetail && api.projectDetail.ok
   ? h(
    'div',
    { className: 'dshp-growth-section' },
    h('div', { className: 'dshp-growth-section-head' }, '项目详情'),
    (Array.isArray(api.projectDetail.steps) ? api.projectDetail.steps : []).slice(-8).map((step, index) => h(
     'div',
     { className: 'dshp-growth-empty', key: 'detail-step-' + index },
     (weatherUpdatedLabel(step.at) || '--:--') + ' · ' + String(step.text || '') + (step.repeatCount > 1 ? ' ×' + step.repeatCount : '') + (step.report ? '（' + step.report + '）' : ''),
    )),
    api.projectDetail.completed && api.projectDetail.completed.length
     ? h('div', { className: 'dshp-growth-empty' }, '以前做过的：' + api.projectDetail.completed.map((item) => String(item.title || '')).join('、'))
     : null,
   )
   : null,
  api.twinRes && api.twinRes.data && api.twinRes.data.project
   ? h(
    'div',
    { className: 'dshp-growth-section' },
    h('div', { className: 'dshp-growth-section-head' }, '镜像在做什么'),
    h('div', { className: 'dshp-growth-quote' }, api.twinRes.data.project.title + ' · ' + ({ working: '正在做', waiting_user: '等主人回答', waiting_mirror: '等原体回信', blocked: '卡住了', idle: '暂时不动' }[api.twinRes.data.project.stage] || api.twinRes.data.project.stage)),
    api.twinRes.data.project.question ? h('div', { className: 'dshp-growth-empty' }, '她在等：' + api.twinRes.data.project.question) : null,
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
     (work.kind === 'svg' || work.kind === 'image') && work.src
      ? h('img', { className: 'dshp-work-art', src: work.src, alt: work.title, loading: 'lazy' })
      : work.kind === 'video' && work.src
       ? h('video', { className: 'dshp-work-art', src: work.src, controls: true, playsInline: true, preload: 'metadata' })
       : h('div', { className: 'dshp-growth-quote' }, work.body),
     h('div', { className: 'dshp-work-time' }, weatherUpdatedLabel(work.createdAt) || '--:--'),
    )),
   )
   : null,
  (() => {
   const health = api.healthStatus
   if (!health) return null
   const jobs = Array.isArray(health.jobs) ? health.jobs.slice(0, 12) : []
   const fmtNext = (ts) => {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
    const diff = ts - Date.now()
    if (diff <= 0) return '马上'
    if (diff < 60000) return Math.round(diff / 1000) + ' 秒后'
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟后'
    return Math.round(diff / 3600000) + ' 小时后'
   }
   const fmtDuration = (ms) => (typeof ms === 'number' && ms >= 0 ? (ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's') : '—')
   return h(
    'div',
    { className: 'dshp-growth-section' },
    h('div', { className: 'dshp-growth-section-head' }, '运行时'),
    h('div', { className: 'dshp-growth-empty' }, '模型调用 ' + health.total + (health.totalLimit > 0 ? '/' + health.totalLimit : '') + ' · 心跳 ' + (health.activeJobs || 0) + ' 拍 · 24h 模型失败 ' + health.modelErrorTotal),
    jobs.length > 0
     ? h(
       'div',
       { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 } },
       ...jobs.map((job, index) => h(
        'div',
        { key: 'runtime-job-' + index, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, opacity: job.errors > 0 ? 1 : 0.8 } },
        h('span', { style: { minWidth: 70 } }, job.name),
        h('span', { style: { opacity: 0.55, flex: 1 } }, '下次 ' + fmtNext(job.nextAt) + ' · 上次 ' + fmtDuration(job.lastDurationMs)),
        job.errors > 0 ? h('span', { style: { color: '#d97373' } }, '错 ' + job.errors) : null,
       )),
      )
     : h('div', { className: 'dshp-growth-empty' }, '心跳未注册'),
   )
  })(),
  h(
   'div',
   { className: 'dshp-growth-section dshp-growth-journey' },
   h('div', { className: 'dshp-growth-section-head' }, '成长史'),
   growthStage
    ? h(
     'div',
     { style: { marginBottom: 6 } },
     h('div', { style: { fontWeight: 600, fontSize: 15, marginBottom: 2 } }, '「' + String(growthStage.title || '') + '」' + (growthDays === null ? '' : ' · 有记忆以来 ' + growthDays + ' 天')),
     growthStage.desc ? h('div', { className: 'dshp-growth-mood-note', style: { marginBottom: 8 } }, String(growthStage.desc)) : null,
     growthNext ? h('div', { className: 'dshp-growth-empty', style: { marginBottom: 8 } }, '下一步：「' + String(growthNext.title || '') + '」' + (growthNext.desc ? '——' + String(growthNext.desc) : '')) : null,
     ...growthMilestones.map((item, index) => h(
      'div',
      { key: 'growth-milestone-' + index, style: { marginBottom: 6 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 } },
       h('span', null, String(item.label || '')),
       h('span', { className: 'dshp-growth-empty' }, String(item.have ?? 0) + ' / ' + String(item.need ?? 0))),
      h('div', { style: { height: 4, borderRadius: 2, background: 'rgba(127,127,127,.18)', overflow: 'hidden' } },
       h('div', { style: { height: '100%', width: Math.round((Number(item.progress) || 0) * 100) + '%', background: '#b58a4a', borderRadius: 2 } })),
     )),
     growthPhilosophy
      ? h('div', { className: 'dshp-growth-empty', style: { marginTop: 6 } }, '正在读《' + String(growthPhilosophy.title || '') + '》 · 已读 ' + String(growthPhilosophy.cursor ?? 0) + '/' + String(growthPhilosophy.chunkCount ?? 0) + ' 段')
      : null,
     growthEmotions.length > 0
      ? h(
       'div',
       { style: { marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 } },
       ...growthEmotions.slice(0, 4).map((emotion, index) => h(
        'span',
        { key: 'growth-emotion-' + index, style: { fontSize: 12, padding: '2px 7px', borderRadius: 10, background: 'rgba(181,138,74,.14)', border: '1px solid rgba(181,138,74,.35)' } },
        String(emotion.family || '') + '·' + String(emotion.label || ''),
       )),
      )
      : null,
    )
    : h('div', { className: 'dshp-growth-empty' }, api.growthRes && api.growthRes.status === 'error' ? '成长快照暂时读不到' : '正在整理她的成长…'),
   growthAutobiography.length > 0
    ? h(
     'details',
     { style: { marginTop: 10 } },
     h('summary', { style: { cursor: 'pointer', fontSize: 13, color: 'inherit', opacity: .8 } }, '她写下的成长史'),
     h('div', { style: { maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, marginTop: 6, padding: 8, borderRadius: 8, background: 'rgba(127,127,127,.08)' } }, growthAutobiography.slice(0, 4000)),
    )
    : null,
   growthReport.length > 0
    ? h(
     'details',
     { style: { marginTop: 8 } },
     h('summary', { style: { cursor: 'pointer', fontSize: 13, color: 'inherit', opacity: .8 } }, '这周的成长报告'),
     h('div', { style: { maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, marginTop: 6, padding: 8, borderRadius: 8, background: 'rgba(127,127,127,.08)' } }, growthReport.slice(0, 3600)),
    )
    : null,
  ),
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
