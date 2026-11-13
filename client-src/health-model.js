// client-src/health-model.js —— health.json 快照归一化（v0.4.0 从 widget-plugin 拆出）
import { num } from './base.js'

export function normalizeHealthStatus(raw) {
   const data = raw && typeof raw === 'object' ? raw : {}
   const runtime = data.runtime && typeof data.runtime === 'object' ? data.runtime : null
   if (!runtime) return null
   const budget = runtime.budget && typeof runtime.budget === 'object' ? runtime.budget : null
   const heartbeat = runtime.heartbeat && typeof runtime.heartbeat === 'object' ? runtime.heartbeat : null
   const modelErrors = runtime.modelErrors && typeof runtime.modelErrors === 'object' ? runtime.modelErrors : null
   const consolidate = runtime.consolidate && typeof runtime.consolidate === 'object' ? runtime.consolidate : null
   const growth = runtime.growthMetrics && typeof runtime.growthMetrics === 'object' ? runtime.growthMetrics : null
   const memoryBacklog = consolidate && consolidate.backlog && typeof consolidate.backlog === 'object' ? consolidate.backlog : null
   const jobs = Array.isArray(heartbeat && heartbeat.jobs) ? heartbeat.jobs : []
   const counts = budget && budget.counts && typeof budget.counts === 'object' ? budget.counts : {}
   const roleCounts = Object.keys(counts)
    .map((role) => ({ role, count: num(counts[role], 0) }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
   return {
    version: data.version || '',
    day: budget && typeof budget.day === 'string' ? budget.day : '',
    total: budget ? num(budget.total, 0) : 0,
    totalLimit: budget ? num(budget.totalLimit, 0) : 0,
    roleCounts,
    jobs: jobs.map((job) => ({
     name: String(job.name || ''),
     runs: num(job.runs, 0),
     errors: num(job.errors, 0),
     consecutiveErrors: num(job.consecutiveErrors, 0),
     skippedRuns: num(job.skippedRuns, 0),
     running: job.running === true,
     nextAt: typeof job.nextAt === 'number' ? job.nextAt : null,
     lastStartedAt: typeof job.lastStartedAt === 'number' ? job.lastStartedAt : null,
     lastDurationMs: typeof job.lastDurationMs === 'number' ? job.lastDurationMs : null,
     lastError: typeof job.lastError === 'string' ? job.lastError : '',
    })),
    activeJobs: num(heartbeat && heartbeat.pulses, 0),
    modelErrorTotal: modelErrors ? num(modelErrors.total, 0) : 0,
    memoryBacklog: memoryBacklog ? num(memoryBacklog.entries, 0) : null,
    memoryBacklogOldestAt: memoryBacklog && typeof memoryBacklog.oldestAt === 'number' ? memoryBacklog.oldestAt : null,
    growthMetrics: growth ? {
     daysAlive: num(growth.daysAlive, 0),
     journalTotal: growth.journal ? num(growth.journal.total, 0) : 0,
     episodes: growth.memory ? num(growth.memory.episodes, 0) : 0,
     coverage: growth.memory ? num(growth.memory.coverage, 0) : 0,
     learning: growth.learning ? num(growth.learning.sections, 0) : 0,
     repetition: growth.repetition ? num(growth.repetition.maxSimilarity, 0) : 0,
     project: growth.project && typeof growth.project.current === 'string' ? growth.project.current : '',
    } : null,
    modelErrorsByRole: modelErrors && modelErrors.byRole && typeof modelErrors.byRole === 'object'
     ? Object.keys(modelErrors.byRole).map((role) => ({ role, count: num(modelErrors.byRole[role], 0) })).sort((a, b) => b.count - a.count).slice(0, 4)
     : [],
   }
  }

