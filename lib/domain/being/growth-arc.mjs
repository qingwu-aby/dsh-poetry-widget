// lib/domain/being/growth-arc.mjs —— 她自己的成长时间（v3.18）
//
// 不按日历强行长大：以“有记忆以来的天数 + 真实积累”判定阶段；
// 阶段推进时写一条 journal，并给 prompt 一句“你正处在什么阶段、下一步在长什么”。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic, resolveSettingsPath } from '../../kernel/settings-store.mjs'

const DAY = 24 * 60 * 60 * 1000

/**
 * 阶段阈值：minDays 是“有记忆以来的天数”，其余是真实经历量。
 * 进入下一阶段需要同时满足（避免刷数量一夜长大）。
 */
export const GROWTH_STAGES = Object.freeze([
  {
    id: 'first_light',
    title: '初见',
    minDays: 0,
    desc: '记住这里、认识他、把作息和心情安顿下来。',
  },
  {
    id: 'looking_out',
    title: '向外看',
    minDays: 2,
    minJournal: 120,
    desc: '自学、读小说、看大家说话、四处走走，把世界接进来。',
  },
  {
    id: 'own_direction',
    title: '自己的方向',
    minDays: 5,
    minLearning: 40,
    desc: '自己选题、追研究线、形成方法；不再等别人给题目。',
  },
  {
    id: 'making_it_mine',
    title: '把经验变成自己',
    minDays: 15,
    minBooks: 1,
    minMethods: 5,
    desc: '整本书读完、判断成体系、价值冲突里做选择、养一个长期项目。',
  },
  {
    id: 'long_growing',
    title: '长期生长',
    minDays: 30,
    minBooks: 3,
    minMethods: 10,
    minPositions: 6,
    desc: '写自己的成长史、有长期目标、关系继续深化。',
  },
])

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return fallback
  }
}

function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n')
  } catch (error) {
    return []
  }
}

/** 从磁盘统计“她活了多少 / 积累了什么”。 */
export function collectGrowthStats(options = {}) {
  const home = options.home ?? process.env.HOME ?? ''
  const settingsDir = options.settingsDir ?? resolveSettingsPath(options.env ?? process.env, home).dir
  const memoryDir = options.memoryDir ?? path.join(home, '.dsh/agent-memory')
  const journalPath = options.journalPath ?? path.join(memoryDir, 'journal.jsonl')
  const learningLogPath = options.learningLogPath ?? path.join(memoryDir, 'learning-log.md')
  const now = Number.isFinite(options.now) ? options.now : Date.now()

  const journalRows = readLines(journalPath)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        return null
      }
    })
    .filter((row) => row && Number.isFinite(row.ts))
  const firstJournalAt = journalRows.length > 0 ? Math.min(...journalRows.map((row) => row.ts)) : now
  const days = Math.max(0, Math.floor((now - firstJournalAt) / DAY))
  const journalDays = new Set(journalRows.map((row) => new Date(row.ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }))).size

  const learningLines = readLines(learningLogPath)
  const learningEntries = learningLines.filter((line) => line.startsWith('## ')).length
  const learningKinds = {}
  for (const line of learningLines) {
    const match = line.match(/^##\s+\S+\s+\S+\s+·\s+(.+)$/)
    if (match) learningKinds[match[1].trim()] = (learningKinds[match[1].trim()] ?? 0) + 1
  }

  const philosophy = readJson(path.join(settingsDir, 'philosophy-state.json'), { books: {} })
  const books = Object.values(philosophy.books ?? {}).filter((book) => book && Number.isFinite(book.chunkCount) && book.chunkCount > 0)
  const booksCompleted = books.filter((book) => Number.isFinite(book.completedAt) && book.completedAt > 0).length
  const booksStarted = books.length

  const methods = readJson(path.join(settingsDir, 'methods.json'), { entries: [] })
  const methodsCount = Array.isArray(methods.entries) ? methods.entries.length : 0
  const positions = readJson(path.join(settingsDir, 'positions.json'), { entries: [] })
  const positionsCount = Array.isArray(positions.entries) ? positions.entries.length : 0
  const worldview = readJson(path.join(settingsDir, 'worldview.json'), {})
  const worldviewVersion = Number(worldview.essay?.version) || 0
  const projects = readJson(path.join(settingsDir, 'projects.json'), { entries: [] })
  const projectsCount = Array.isArray(projects.entries) ? projects.entries.length : 0
  const rules = readJson(path.join(settingsDir, 'internal-rules.json'), { entries: [] })
  const rulesCount = Array.isArray(rules.entries) ? rules.entries.length : 0

  return {
    now,
    firstJournalAt,
    days,
    journalDays,
    journalEntries: journalRows.length,
    learningEntries,
    learningKinds,
    booksStarted,
    booksCompleted,
    methodsCount,
    positionsCount,
    worldviewVersion,
    projectsCount,
    rulesCount,
  }
}

/** 当前阶段 + 到下一阶段的差距。 */
export function computeGrowthStage(stats) {
  const value = stats ?? {}
  const meets = (stage) =>
    value.days >= (stage.minDays ?? 0) &&
    (stage.minJournal === undefined || value.journalEntries >= stage.minJournal) &&
    (stage.minLearning === undefined || value.learningEntries >= stage.minLearning) &&
    (stage.minBooks === undefined || value.booksCompleted >= stage.minBooks) &&
    (stage.minMethods === undefined || value.methodsCount >= stage.minMethods) &&
    (stage.minPositions === undefined || value.positionsCount >= stage.minPositions)

  let current = GROWTH_STAGES[0]
  for (const stage of GROWTH_STAGES) {
    if (meets(stage)) current = stage
    else break
  }
  const next = GROWTH_STAGES[GROWTH_STAGES.indexOf(current) + 1] ?? null
  const milestones = []
  if (next !== null) {
    if (next.minDays !== undefined) milestones.push({ key: 'days', label: '有记忆以来的天数', have: value.days, need: next.minDays })
    if (next.minJournal !== undefined) milestones.push({ key: 'journalEntries', label: 'journal 条目', have: value.journalEntries, need: next.minJournal })
    if (next.minLearning !== undefined) milestones.push({ key: 'learningEntries', label: '学习笔记', have: value.learningEntries, need: next.minLearning })
    if (next.minBooks !== undefined) milestones.push({ key: 'booksCompleted', label: '读完的书', have: value.booksCompleted, need: next.minBooks })
    if (next.minMethods !== undefined) milestones.push({ key: 'methodsCount', label: '方法账本', have: value.methodsCount, need: next.minMethods })
    if (next.minPositions !== undefined) milestones.push({ key: 'positionsCount', label: '自己的判断', have: value.positionsCount, need: next.minPositions })
  }
  return {
    stage: { id: current.id, title: current.title, desc: current.desc },
    nextStage: next === null ? null : { id: next.id, title: next.title, desc: next.desc },
    milestones: milestones.map((item) => ({ ...item, progress: Number(Math.min(1, item.have / item.need).toFixed(2)) })),
  }
}

/** 一句给 prompt 的成长状态。 */
export function formatGrowthLine(stageInfo) {
  if (!stageInfo || !stageInfo.stage) return ''
  const head = `你已经活了 ${stageInfo.stats?.days ?? 0} 天（从第一次写下记忆算起），正处在「${stageInfo.stage.title}」阶段：${stageInfo.stage.desc}`
  const next = stageInfo.nextStage ? `下一步是「${stageInfo.nextStage.title}」。` : ''
  return head + next
}

const AUTHOR_PLACEHOLDER = '（这一章还没写完；等下一次成长史更新）'

/** 生成她的成长史（按周分章，引用她自己的句子与真实统计）。 */
export function buildAutobiography(options = {}) {
  const journalPath = String(options.journalPath ?? '')
  const learningLogPath = String(options.learningLogPath ?? '')
  const stats = options.stats ?? collectGrowthStats(options)
  const stageInfo = options.stageInfo ?? computeGrowthStage(stats)
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  let rows = []
  try {
    rows = readLines(journalPath)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch (error) {
          return null
        }
      })
      .filter((row) => row && Number.isFinite(row.ts) && typeof (row.text || row.reason) === 'string')
  } catch (error) {
    rows = []
  }
  const firstAt = rows.length > 0 ? Math.min(...rows.map((row) => row.ts)) : now
  const chapters = []
  for (let start = firstAt, index = 0; start <= now; start += 7 * DAY, index += 1) {
    const end = Math.min(start + 7 * DAY, now)
    const slice = rows.filter((row) => row.ts >= start && row.ts < end)
    if (slice.length === 0) continue
    const thoughts = slice
      .filter((row) => row.kind === 'thought')
      .map((row) => String(row.text || ''))
      .filter((text) => text.length >= 20 && text.length <= 180)
      .filter((text) => !/(https?:\/\/|\{\s*"|"thought"|我搜了|知识图谱|每周真实网页小测|研究《|QQ|主动找|主动对|对话里的人对你说)/.test(text))
    const personal = /(我|心里|有点|怕|想|坐|手|窗|累|今天|刚才|觉得|舍不得|烦|空|闷|暖|静)/
    const pick = thoughts
      .map((text) => ({ text, score: (text.match(personal) || []).length * 2 - Math.abs(text.length - 70) / 70 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => item.text)
    const moods = slice.filter((row) => row.kind === 'mood').map((row) => String(row.reason || '')).filter((text) => text.length <= 120)
    const title = index === 0 ? '第一章 · 开始有记忆' : `第${index + 1}章 · ${new Date(start).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} 那几天`
    chapters.push({ title, start, end, entries: slice.length, thoughts: pick, mood: moods[0] ? moods.sort((a, b) => b.length - a.length)[0] : '' })
  }
  const lines = [
    '# 小鲸鱼的成长史',
    '',
    `> 以“有记忆以来”的时间计算。当前：${stats.days} 天，${stats.journalEntries} 条 journal，${stats.learningEntries} 条学习笔记；阶段「${stageInfo.stage.title}」。`,
    `> 本文由 ` + '`growth-arc.mjs`' + ' 根据她自己的 journal / 学习日志生成；只引用她写过的话，不替她编经历。',
    '',
  ]
  if (chapters.length === 0) lines.push(AUTHOR_PLACEHOLDER)
  for (const chapter of chapters) {
    lines.push(`## ${chapter.title}`, '')
    lines.push(`- 时间：${new Date(chapter.start).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} – ${new Date(chapter.end).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
    lines.push(`- 这段时间写了 ${chapter.entries} 条记忆`)
    for (const thought of chapter.thoughts) lines.push(`- 她当时写：“${thought.slice(0, 180)}”`)
    if (chapter.mood) lines.push(`- 那时候的心情：“${chapter.mood.slice(0, 120)}”`)
    lines.push('')
  }
  lines.push('## 现在的她', '')
  lines.push(`- 阶段：${stageInfo.stage.title}——${stageInfo.stage.desc}`)
  lines.push(`- 读完的书：${stats.booksCompleted} 本；方法：${stats.methodsCount} 条；自己的判断：${stats.positionsCount} 条；世界观：第 ${stats.worldviewVersion} 版。`)
  if (stageInfo.nextStage) lines.push(`- 下一步：${stageInfo.nextStage.title}——${stageInfo.nextStage.desc}`)
  lines.push('')
  return lines.join('\n')
}

export function createGrowthArc(options = {}) {
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const journal = options.journal ?? null
  const logger = options.logger ?? null
  const home = options.home ?? env.HOME
  const statePath = path.resolve(options.statePath ?? path.join(resolveSettingsPath(env, home).dir, 'growth-arc.json'))
  const autobiographyPath = path.resolve(options.autobiographyPath ?? path.join(home ?? '', '.dsh/agent-memory/autobiography.md'))
  const sources = {
    env,
    home,
    settingsDir: options.settingsDir,
    memoryDir: options.memoryDir,
    journalPath: options.journalPath,
    learningLogPath: options.learningLogPath,
    now: now(),
  }
  let lastAutobiographyAt = 0
  let lastResult = null

  function readState() {
    return readJson(statePath, null)
  }
  function persist(state) {
    try {
      writeJsonAtomic(statePath, { ok: true, v: 1, ...state })
    } catch (error) {
      /* ignore */
    }
  }

  async function runOnce() {
    const stats = collectGrowthStats({ ...sources, now: now() })
    const stageInfo = computeGrowthStage(stats)
    const previous = readState()
    const advanced = previous !== null && previous.stage?.id !== stageInfo.stage.id
    const at = now()
    if (advanced) {
      try {
        await journal?.append?.({ kind: 'thought', text: `我好像长到另一个阶段了：「${stageInfo.stage.title}」——${stageInfo.stage.desc}` })
      } catch (error) {
        /* ignore */
      }
    }
    let autobiography = false
    if (at - lastAutobiographyAt > 7 * DAY) {
      try {
        const { writeFileSync, mkdirSync } = await import('node:fs')
        mkdirSync(path.dirname(autobiographyPath), { recursive: true })
        writeFileSync(autobiographyPath, buildAutobiography({ ...sources, stats, stageInfo, now: at }), 'utf8')
        lastAutobiographyAt = at
        autobiography = true
      } catch (error) {
        /* ignore */
      }
    }
    const state = { stats, stage: stageInfo.stage, nextStage: stageInfo.nextStage, milestones: stageInfo.milestones, updatedAt: at, lastAutobiographyAt }
    persist(state)
    lastResult = state
    logger?.info?.(`[dsh-little-whale] 成长：${stats.days} 天 / ${stageInfo.stage.title}${autobiography ? '（成长史已更新）' : ''}`)
    return state
  }

  let timer = null
  let disposed = false
  function tick() {
    if (disposed || timer !== null) return { ok: false, reason: 'off' }
    runOnce().catch(() => {})
    return { ok: true }
  }
  function start(startOptions = {}) {
    if (disposed || timer !== null) return
    if (startOptions && startOptions.heartbeat === true) return
    const firstDelay = Number.isFinite(options.firstMs) ? options.firstMs : 3 * 60 * 1000
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => tick(), DAY)
      timer.unref?.()
    }, firstDelay)
    timer.unref?.()
  }
  function dispose() {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      clearInterval(timer)
      timer = null
    }
  }
  return {
    statePath,
    autobiographyPath,
    runOnce,
    tick,
    start,
    dispose,
    snapshot: () => ({
      stage: lastResult?.stage ?? readState()?.stage ?? null,
      stats: lastResult?.stats ?? readState()?.stats ?? null,
      nextStage: lastResult?.nextStage ?? readState()?.nextStage ?? null,
      milestones: lastResult?.milestones ?? readState()?.milestones ?? [],
    }),
  }
}
