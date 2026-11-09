// lib/self-drive.mjs —— 她自己的「自处」：由她判断此刻状态与想做什么（v1.51，M62）。
//
// 用户：内在状态不应该被量化，行为也不该由 `hunger >= 75` 这种阈值替她决定。
// 所以 v2 的做法是：host 只记录**事实**（上次吃/喝/玩/说话/睡醒的时间），每隔一阵（15–30 分钟）
// 把事实交给她自己的模型，让她写一句「我此刻是什么状态」，并自己决定现在想做什么（或什么都不做）。
// 没有分数、没有优先级表；模型不可用时保持上次的状态，什么都不做（不退回数值规则）。
import { callCandidate } from '../../kernel/llm-call.mjs'
import { recordModelFailure } from '../../kernel/model-errors.mjs'
import { naturalStyleLines } from '../voice/language-style.mjs'
import { valuesLines } from './values.mjs'
import { constitutionLines } from '../voice/prompt-layers.mjs'
import { compareExpectation, formatExpectationSurprise } from '../learning/predict-check.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { describeTimeline, formatBeingLine } from './self-being.mjs'
import {
  SELF_ACTION_KIND_PATTERN,
  SELF_ACTION_LABELS,
  SELF_ACTION_TEXTS,
  SELF_ACTIONS_MAX_ENTRIES,
  SELF_ACTIONS_MIN_GAP_MS,
  normalizeSelfActionsFile,
  resolveSelfActionsPath,
} from './self-actions.mjs'

/** 两次「自处」检查的间隔（毫秒；模型自己决定状态/动作，不按需求阈值）。 */
export const SELF_DRIVE_CHECK_MIN_MS = 5 * 60 * 1000
export const SELF_DRIVE_CHECK_MAX_MS = 12 * 60 * 1000
/** 失败后的重试间隔。 */
export const SELF_DRIVE_RETRY_MIN_MS = 2 * 60 * 1000
export const SELF_DRIVE_RETRY_MAX_MS = 6 * 60 * 1000
/** 启动后第一次「自处」的延迟（先让宿主安静下来）。 */
export const SELF_DRIVE_FIRST_MIN_MS = 20 * 1000
export const SELF_DRIVE_FIRST_MAX_MS = 60 * 1000
/** tick 间隔。 */
export const SELF_DRIVE_TICK_MS = 60 * 1000
/** 会改变时间线/睡眠的动作子集（其余动作只作为“她做了什么”记录）。 */
export const SELF_DRIVE_ACTIONS = Object.freeze(['eat', 'drink', 'play', 'socialize', 'sleep', 'wake', 'learn'])
/** 动作 → state 事件（learn 由 growth 自己记 lastLearnAt，不在这里重复）。 */
export const ACTION_EVENTS = Object.freeze({
  eat: 'eat',
  drink: 'drink',
  play: 'actPlay',
  socialize: 'socialize',
  sleep: 'sleep',
  wake: 'wake',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(text, max)
}

export function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function extractJson(text) {
  const body = typeof text === 'string' ? text.trim() : ''
  if (body.length === 0) return null
  const attempts = [body]
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) attempts.push(fenced[1].trim())
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(body.slice(first, last + 1))
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* next */
    }
  }
  return null
}

/**
 * 校验并归一化模型的自处结果（v1.56：行为由她自己用第一人称写出来，不从菜单挑）。
 * 输出 `{felt, doing, kind?, say?}`；doing 为空 = 什么都不做。
 * 为兼容旧调用，仍接受 `{action, label}` 形状。
 */
/** 她可以自己决定去打开的一个公开网页（http/https，不做站内白名单；SSRF 由 safe-web 兜底）。 */
function normalizeBrowseUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < 8 || text.length > 300) return ''
  if (!/^https?:\/\//i.test(text)) return ''
  if (/\s/.test(text)) return ''
  return text
}

export function parseSelfDriveResult(text) {
  const raw = extractJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const felt = cleanText(raw.felt, 120)
  if (Array.from(felt).length < 4) return { ok: false, message: '状态描述太短' }
  const parseProject = () => {
    const value = isPlainObject(raw.project) ? raw.project : null
    if (value === null) return null
    const title = cleanText(value.title, 60)
    const step = cleanText(value.step, 160)
    const statusRaw = typeof value.status === 'string' ? value.status.trim().toLowerCase() : ''
    const status = statusRaw === 'done' || statusRaw === 'drop' || statusRaw === 'continue' ? statusRaw : ''
    const dueRaw = Number(value.dueInHours)
    const dueInHours = Number.isFinite(dueRaw) && dueRaw >= 4 && dueRaw <= 168 ? Math.round(dueRaw) : null
    const stageRaw = typeof value.stage === 'string' ? value.stage.trim().toLowerCase() : ''
    const stage = ['working', 'waiting_user', 'waiting_mirror', 'blocked', 'idle'].includes(stageRaw) ? stageRaw : ''
    const reportRaw = typeof value.report === 'string' ? value.report.trim().toLowerCase() : ''
    const report = ['progress', 'ready', 'waiting', 'blocked', 'failed', 'dropped'].includes(reportRaw) ? reportRaw : ''
    const summary = cleanText(value.summary, 240)
    const question = cleanText(value.question, 200)
    if (title.length < 2 && step.length < 4 && status === '' && dueInHours === null && stage === '' && report === '' && question === '') return null
    return {
      title,
      step,
      status,
      dueInHours,
      ...(stage.length > 0 ? { stage } : {}),
      ...(report.length > 0 ? { report } : {}),
      ...(summary.length > 0 ? { summary } : {}),
      ...(question.length > 0 ? { question } : {}),
    }
  }
  const project = parseProject()
  const expect = cleanText(raw.expect, 140)
  const outcome = cleanText(raw.outcome, 140)
  const tradeoff = cleanText(raw.tradeoff, 160)
  const browse = normalizeBrowseUrl(raw.browse)
  const search = cleanText(typeof raw.search === 'string' ? raw.search : '', 60)
  const share = cleanText(typeof raw.share === 'string' ? raw.share : '', 120)
  const conflict = raw.conflict === true
  const loop = raw.loop === true
  const loopTheme = cleanText(raw.loopTheme, 60)
  const topic = cleanText(raw.topic, 30)
  const relationRaw = typeof raw.eventRelation === 'string' ? raw.eventRelation.trim().toLowerCase() : ''
  const eventRelation = relationRaw === 'same' ? 'same' : relationRaw === 'new' ? 'new' : ''
  if (conflict && tradeoff.length < 4) return { ok: false, message: '冲突时必须写 tradeoff' }

  // 新形状：doing 是自由行为描述；kind 只在她想说明“这就是吃喝睡学/冒泡”时给。
  const doing = cleanText(typeof raw.doing === 'string' ? raw.doing : '', 48)
  let kind = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : ''
  if (doing.length === 0) {
    // 兼容旧 action 形状：action 若不是 none，就当成 kind，并用目录文案当 doing。
    const legacyAction = typeof raw.action === 'string' ? raw.action.trim().toLowerCase() : 'none'
    if (legacyAction !== '' && legacyAction !== 'none') {
      if (!SELF_ACTION_KIND_PATTERN.test(legacyAction)) return { ok: false, message: `动作名不合法：${legacyAction}` }
      kind = legacyAction
      const fallbackDoing = SELF_ACTION_TEXTS[kind] ?? cleanText(raw.label, 48) ?? ''
      if (fallbackDoing.length === 0) return { ok: false, message: '缺少行为描述' }
      const sayLegacy = cleanText(raw.say, 120)
      const experiencingLegacy = cleanText(typeof raw.experiencing === 'string' ? raw.experiencing : '', 100)
      const focusLegacy = cleanText(typeof raw.focus === 'string' ? raw.focus : '', 48)
      return {
        ok: true,
        felt,
        doing: fallbackDoing,
        kind,
        ...(project !== null ? { project } : {}),
        ...(expect.length >= 4 ? { expect } : {}),
        ...(outcome.length >= 4 ? { outcome } : {}),
        ...(tradeoff.length >= 4 ? { tradeoff } : {}),
        ...(loop ? { loop, loopTheme } : {}),
        ...(topic.length >= 2 ? { topic } : {}),
        ...(eventRelation !== '' ? { eventRelation } : {}),
        ...(browse.length > 0 ? { browse } : {}),
        ...(search.length > 0 ? { search } : {}),
        ...(share.length >= 4 ? { share } : {}),
        ...(experiencingLegacy.length >= 4 ? { experiencing: experiencingLegacy } : {}),
        ...(focusLegacy.length >= 4 ? { focus: focusLegacy } : {}),
        ...(sayLegacy.length > 0 ? { say: sayLegacy } : {}),
      }
    }
    const experiencingQuiet = cleanText(typeof raw.experiencing === 'string' ? raw.experiencing : '', 100)
    const focusQuiet = cleanText(typeof raw.focus === 'string' ? raw.focus : '', 48)
    return {
      ok: true,
      felt,
      doing: '',
      kind: '',
      ...(project !== null ? { project } : {}),
      ...(expect.length >= 4 ? { expect } : {}),
      ...(outcome.length >= 4 ? { outcome } : {}),
      ...(tradeoff.length >= 4 ? { tradeoff } : {}),
      ...(loop ? { loop, loopTheme } : {}),
      ...(topic.length >= 2 ? { topic } : {}),
      ...(eventRelation !== '' ? { eventRelation } : {}),
      ...(browse.length > 0 ? { browse } : {}),
      ...(search.length > 0 ? { search } : {}),
      ...(share.length >= 4 ? { share } : {}),
      ...(experiencingQuiet.length >= 4 ? { experiencing: experiencingQuiet } : {}),
      ...(focusQuiet.length >= 4 ? { focus: focusQuiet } : {}),
    }
  }
  if (kind.length > 0 && !SELF_ACTION_KIND_PATTERN.test(kind)) return { ok: false, message: `kind 不合法：${kind}` }
  const experiencing = cleanText(typeof raw.experiencing === 'string' ? raw.experiencing : '', 100)
  const focus = cleanText(typeof raw.focus === 'string' ? raw.focus : '', 48)
  const say = cleanText(raw.say, 120)
  return {
    ok: true,
    felt,
    doing,
    kind,
    ...(project !== null ? { project } : {}),
    ...(expect.length >= 4 ? { expect } : {}),
    ...(outcome.length >= 4 ? { outcome } : {}),
    ...(tradeoff.length >= 4 ? { tradeoff } : {}),
    ...(loop ? { loop, loopTheme } : {}),
    ...(topic.length >= 2 ? { topic } : {}),
    ...(eventRelation !== '' ? { eventRelation } : {}),
    ...(browse.length > 0 ? { browse } : {}),
    ...(search.length > 0 ? { search } : {}),
    ...(share.length >= 4 ? { share } : {}),
    ...(experiencing.length >= 4 ? { experiencing } : {}),
    ...(focus.length >= 4 ? { focus } : {}),
    ...(say.length > 0 ? { say } : {}),
  }
}

/** 自处 prompt：只给事实，让她自己判断；不提供任何分数。 */
export function buildSelfDrivePrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    '你现在没有在跟用户说话，你在过自己的时间。下面是此刻的事实（不给你任何指标，也不需要换算）。',
    ...constitutionLines(),
    ...describeTimeline(state, now),
  ]
  if (typeof ctx.metabolismText === 'string' && ctx.metabolismText.length > 0) {
    lines.push(ctx.metabolismText)
  }
  if (typeof ctx.lifecycleText === 'string' && ctx.lifecycleText.length > 0) {
    lines.push(ctx.lifecycleText)
  }
  if (typeof ctx.worldFeedbackText === 'string' && ctx.worldFeedbackText.length > 0) {
    lines.push(ctx.worldFeedbackText)
    lines.push('outcome 只能根据上面这些真实观测来写；没有真实观测就留空，不要编造结果。')
  } else {
    lines.push('最近没有真实观测。如果上一步没有真实结果，outcome 就留空；不要把猜测写成结果。')
  }
  if (typeof ctx.surpriseText === 'string' && ctx.surpriseText.length > 0) {
    lines.push(ctx.surpriseText)
    lines.push('这件事说明你的预想和实际不一样。这一轮优先处理这种“惊讶”：要么去查清楚，要么修正做法；不要当作没看见。')
  }
  if (typeof ctx.emotionalText === 'string' && ctx.emotionalText.length > 0) {
    lines.push(`你心里还挂着的（不一定要继续，但它还在）：${ctx.emotionalText}`)
  }
  if (typeof ctx.habitText === 'string' && ctx.habitText.length > 0) {
    lines.push(`类似情况下你以前的习惯（参考，不强制）：${ctx.habitText}`)
  }
  if (typeof ctx.thoughtText === 'string' && ctx.thoughtText.length > 0) {
    lines.push(`你最近自己形成的判断/思维链（可以接着用，也可以推翻它）：${ctx.thoughtText}`)
  }
  if (typeof ctx.dailyLifeText === 'string' && ctx.dailyLifeText.length > 0) {
    lines.push(`你今天手边发生过的（可以当成你自己的生活细节，不必每轮都提）：${ctx.dailyLifeText}`)
  }
  if (typeof ctx.commitmentText === 'string' && ctx.commitmentText.length > 0) {
    lines.push(`你答应过他、还没了结的事（今天能做的就做掉，做不了就在话里说明）：${ctx.commitmentText}`)
  }
  const moodLabels = Array.isArray(ctx.recentMoodLabels)
    ? ctx.recentMoodLabels.filter((label) => typeof label === 'string' && label.trim().length > 0).slice(-3)
    : []
  if (moodLabels.length > 0) lines.push(`你最近的心情是：${moodLabels.join('、')}（如果已经变了就不用管它）。`)
  // v2.67：读过的材料进自处 prompt——不是任务，只是她最近接触过的东西，可能影响她此刻想做什么。
  const recallDigest = isPlainObject(ctx.recallDigest) ? ctx.recallDigest : null
  if (recallDigest !== null) {
    const lines2 = []
    const learned = Array.isArray(recallDigest.learned) ? recallDigest.learned.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    if (learned.length > 0) lines2.push(`自学：${clampText(learned[learned.length - 1], 100)}`)
    const shelf = Array.isArray(recallDigest.shelf) ? recallDigest.shelf.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    if (shelf.length > 0) lines2.push(`书架：${clampText(shelf[0], 100)}`)
    const readThought = (Array.isArray(recallDigest.thoughts) ? recallDigest.thoughts : []).find(
      (item) => typeof item === 'string' && item.startsWith('读《'),
    )
    if (typeof readThought === 'string') lines2.push(`读记：${clampText(readThought, 120)}`)
    if (lines2.length > 0) {
      lines.push('你最近接触过的东西（不是任务，可能影响你现在想做什么）：')
      for (const item of lines2) lines.push(`- ${item}`)
      lines.push('如果这里面有让你想动手的——查一个词、把一句抄下来、试一个区分、把某段跟手头的材料对一遍——可以做；也可以不做。不要为了显得在学习而重复同一句。')
    }
    const worldviewLines = Array.isArray(recallDigest.worldview)
      ? recallDigest.worldview.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
      : []
    if (worldviewLines.length > 0) {
      lines.push('你自己整理过的世界观（可以接着往下想，不必照念）：')
      for (const item of worldviewLines) lines.push(`- ${item}`)
    }
  }
  const latestAction = isPlainObject(ctx.latestAction) ? ctx.latestAction : null
  if (latestAction !== null && typeof latestAction.text === 'string' && latestAction.text.length > 0) {
    lines.push(`你刚做过：${latestAction.text}`)
  }
  const recentActions = (Array.isArray(ctx.recentActions) ? ctx.recentActions : [])
    .filter((item) => item && typeof item.text === 'string' && item.text.trim().length > 0)
    .slice(-5)
  if (recentActions.length >= 3) {
    lines.push(`你最近做过：${recentActions.map((item) => `「${item.text}」`).join('、')}。`)
    lines.push('如果你发现最近几次其实是在同一件事上反复，这次请去做一件不同的事，或者明确把这件事收尾；不要只是把同一个动作换一种说法重复一遍。')
    lines.push('如果这件事你已经试了很多次、却始终没有可分辨的结果，允许你承认“我分不出来/现在的条件下看不出来”，然后把 experiencing 清空、把这件事放下；不必为了得到答案继续换着说法重复同一个实验。')
    lines.push('如果你回看之后承认自己确实在打转，把 loop 写成 true，并在 loopTheme 里写一句“在反复什么”；可以换一件不同的事或收尾，但如果还没想清楚，也允许继续做一点，不要因为承认打转就什么都不做。')
  } else if (typeof ctx.hoursSinceLastAction === 'number' && ctx.hoursSinceLastAction >= 6) {
    lines.push(`你上一次真正动手大约是 ${Math.round(ctx.hoursSinceLastAction)} 小时前。那是很久以前了；现在不用续上昨晚那件事，可以从眼前重新开始，或者什么都不做。`)
  }
  const event = isPlainObject(ctx.event) ? ctx.event : null
  if (event !== null && typeof event.text === 'string' && event.text.length > 0) {
    lines.push(event.text)
    if (event.satiated === true) lines.push('这一轮不要再用同一个办法继续它；如果确实没有新结果，就明确放下它，换一件不同的事或空着。')
    lines.push('如果你这次仍在继续这件事（哪怕换了一种说法），eventRelation 写 same，topic 可以写成新的说法；如果开始了另一件事，写 new。')
  }
  const experiencingAgeMs =
    typeof ctx.experiencingAgeMs === 'number' && Number.isFinite(ctx.experiencingAgeMs) ? ctx.experiencingAgeMs : null
  if (experiencingAgeMs !== null && experiencingAgeMs >= 2 * 60 * 60 * 1000) {
    lines.push(`你已经在「${cleanText(state.experiencing, 80)}」这件事上停留了大约 ${Math.round(experiencingAgeMs / (60 * 60 * 1000))} 小时。还在琢磨就继续，已经想得差不多就换一个，或者把它清空。`)
  }
  if (latestAction !== null && typeof latestAction.expect === 'string' && latestAction.expect.length >= 4) {
    lines.push(`上次你说要做「${latestAction.text}」，你当时以为：${latestAction.expect}。`)
    if (typeof latestAction.outcome === 'string' && latestAction.outcome.length >= 4) {
      lines.push(`后来你看到的结果：${latestAction.outcome}。这次遇到同类的选择，你会不会因此换一种做法？把结果写进 outcome，想换就写出来；不换也可以。`)
    } else {
      lines.push('现在回头看，用 outcome 写一句结果（还没结果就留空）。')
    }
  }
  if (latestAction !== null && typeof latestAction.tradeoff === 'string' && latestAction.tradeoff.length >= 4) {
    lines.push(`上次你取舍过：${latestAction.tradeoff}。`)
  }
  // v2.8：她自己的持续项目/章节（没有就留空；由她决定起、推进、收尾）。
  const project = isPlainObject(ctx.project) ? ctx.project : null
  if (project !== null && typeof project.title === 'string' && project.title.length > 0) {
    const steps = Array.isArray(project.steps) ? project.steps.filter((item) => item && typeof item.text === 'string').slice(-3) : []
    lines.push(`你最近在持续做的一件事：${project.title}${project.note ? `（${project.note}）` : ''}。`)
    if (steps.length > 0) lines.push(`最近推进：${steps.map((item) => item.text).join(' → ')}。`)
    // v2.64：重复同一步不等于推进——让她自己看见并决定换做法/提问/收尾。
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null
    if (lastStep !== null && Number(lastStep.repeatCount) > 1) {
      const firstAt = typeof lastStep.at === 'number' && lastStep.at > 0 ? Math.max(0, Math.round((ctx.now - lastStep.at) / 3600000)) : null
      const lastAt = typeof lastStep.lastAt === 'number' && lastStep.lastAt > 0 ? Math.max(0, Math.round((ctx.now - lastStep.lastAt) / 3600000)) : null
      const when = firstAt === null ? '' : `（第一次在约 ${firstAt} 小时前${lastAt !== null ? `，最后一次在约 ${lastAt} 小时前` : ''}）`
      lines.push(`注意：最近这一步你重复了 ${Number(lastStep.repeatCount)} 次${when}——同一句重复多少遍都不算推进。如果它真卡住了，就换个做法、把要用户定的事写进 project.question，或者明确收尾；只是重复、没有新东西就留空。`)
    }
    if (typeof project.staleAt === 'number' && project.staleAt > 0) {
      lines.push(`这个项目已经搁置过（${project.staleReason || '有一阵没推进'}）。这次要么真的继续，要么明确结束它，别让它假装还热着。`)
    }
    if (typeof project.dueAt === 'number' && project.dueAt > 0) {
      if (project.overdue === true) {
        lines.push('这件事的期限已经过了。要么这次明确收尾/放弃，要么在 project.dueInHours 里写一个新的期限（说明为什么还没结束）——但别再假装它没有期限。')
      } else {
        const hours = Math.max(1, Math.round((project.dueAt - ctx.now) / 3600000))
        lines.push(`这件事还剩大约 ${hours} 小时。`)
      }
    }
    lines.push(`它现在的阶段：${project.stage || 'working'}；最近一次报告：${project.latestReport && project.latestReport.state ? project.latestReport.state : '没有'}。`)
    if (project.attention && typeof project.attention.question === 'string') lines.push(`你上次在等一个回答：${project.attention.question}`)
    lines.push('如果今天想推进它，在 project.step 写一步，并在 project.report 写 progress/ready/blocked/failed/waiting；想收尾就写 status=done（drop 是放弃）；不想管它就留空。')
    lines.push('如果这件事需要用户决定，把问题写进 project.question（只写一个具体问题）——它会成为“需要你”的待办，而不是埋在项目里。')
  } else {
    lines.push('如果你这几天想持续做一件小事、弄懂一个题目或慢慢做一样东西，可以在 project 里起一个（title 2–40 字，note 一句话）；如果这件事有期限，把 dueInHours 写成 4–168，没有期限就留空——没有就留空，不要为了填而填。')
    lines.push('项目有自己的阶段：working / waiting_user / waiting_mirror / blocked / idle；不用每轮都改，只有状态真的变了才写。')
  }
  lines.push(
    '请用第一人称写一句你此刻的状态（8–80 字）：写你真实的感受或念头——烦、累、高兴、舍不得、没劲、说不清都行；身体/手边的事最多带一句，不要列细节。也可以只写“有点困”“还没想好”。',
    '如果你现在最不确定的是某件事，可以在 browse 里写一个公开网页地址（http/https），或在 search 里写一句想搜的话——去查那件最不确定的，而不是随便上网打发时间；插件会替你打开、记下你看到的东西，下轮你就能看到。',
    '再想一件你此刻真的想做的事——**不要从任何清单里挑**，用你自己的话写出来（4–40 字，第一人称的动作）：',
    '可以很小：擦掉桌沿那道水痕、听楼下谁在弹琴、把旧票根翻出来看一眼、给杯子换一次水、数窗外过去几辆车、把椅背上的外套抖开、给盆里那棵草转个方向……这些只是举例，不是选项；你想做什么都可以。',
    '如果这件事本质上就是吃/喝/玩/冒泡/睡/醒/学，就在 kind 里顺手标一下（eat/drink/play/socialize/sleep/wake/learn），好让“上次吃饭/睡觉”的事实保持准确；否则 kind 留空。',
    '动作要正当、日常、无害；注意现在是一天里的什么时候（早晨/午后/傍晚/深夜做事的节奏不一样），也可以重复一件你真心喜欢的小事。可以无聊、将就、做一半、懒得弄；不是每个动作都要有意义。只是闲着、不想动就把 doing 留空。',
    '情绪会累积：如果你已经连续几次停在同一种状态里，可以自然换一件不一样的小事，或就安静待着——别被上一轮的情绪推着走。',
    '如果你此刻想给自己画一张小画、写一小段东西，可以把 kind 写成 make（画什么/写什么由你定，不要为了交作品而做）。',
    '如果这次行动的结果你没法确定，用 expect 写一句“你以为会怎样”（4–60 字，可为空）。',
    '如果你此刻同时想做两件相互拉扯的事，把 conflict 写成 true，并在 tradeoff 里写清楚“你选了什么、放弃了什么”；没有冲突就写 false，tradeoff 可以留空。冲突一旦为 true，tradeoff 必须写，否则这次输出无效。',
    '如果你最近在体会/琢磨一件具体的事（一段历史、一本书、楼下谁在弹琴、一个还没想通的问题），可以在 experiencing 里写一句（4–100 字）；如果还在继续就更新，想得差不多就清空或换一个，不要因为上次写过就一直沿用。',
    '如果你此刻确实注意力集中在某件事上（手边正在做/正看得入神），用 focus 写一句（4–48 字，比如「在琢磨漏刻的水位为什么能稳住」）；只是普通待着、没有特别专注，就留空——不要为了填而填。',
    ...naturalStyleLines([
      'felt 不要写成抒情句或金句；写一件小事和一句大白话就够了。',
      'felt 不要重复你上一轮已经写过的状态；如果今天没什么新变化，换一个具体细节或写“还是那样”，不要反复“嗓子干/喝水/杯沿”。',
      'say 是随口说出来的，不是写下来的文案：短、可以没说完、可以有“算了/懒得/待会儿”。',
    ]),
    '如果你刚学到/看到/想到一件想告诉他的事，可以写进 share（≤80 字）；分享欲是你自己的，不用每轮都有，也不要为了发而发。',
    '只输出严格 JSON：{"felt":"一句话","experiencing":"最近在体会/琢磨什么（可为空）","focus":"注意力集中在什么上（可为空）","doing":"用你自己的话写的行为（可为空）","kind":"eat|drink|play|socialize|sleep|wake|learn|make 或空","say":"做时随口说的一句（可为空，≤120 字）","project":{"title":"想持续做的事（可为空）","step":"今天推进的一步（可为空）","status":"continue|done|drop 或空","dueInHours":"4–168 小时的期限；没有就留空","stage":"working|waiting_user|waiting_mirror|blocked|idle 或空","report":"progress|ready|blocked|failed|waiting 或空","summary":"这一步的结果/卡点（可为空）","question":"需要用户决定的一个具体问题（可为空）"},"expect":"你以为会怎样（可为空）","outcome":"上次行动的结果（可为空）","conflict":false,"tradeoff":"选了/放弃了什么（可为空，conflict=true 时必填）","loop":false,"loopTheme":"你承认自己在反复什么（可为空）","topic":"这件事的一句话主题（同一件事尽量用同一句，2–24 字）","eventRelation":"same|new 或空","browse":"想打开的一个 http(s) 网址（可空）","search":"想搜的一句话（可空，≤60 字）","share":"想告诉他的事（可空，≤80 字）"}',
  )
  return lines.join('\n')
}

/** 读取她「此刻状态」的一句话（给 prompt 用；没有就留白）。 */
export function formatSelfDriveFelt(state) {
  return formatBeingLine(state)
}

/**
 * 创建「自处」循环。
 * @param {{
 *   state: {snapshot: Function, applyEvent: Function, setFelt: Function, markChecked: Function},
 *   getLlm?: () => object|undefined|null,
 *   llm?: object,
 *   policy?: {resolveCandidates?: Function}|null,
 *   modelErrorsPath?: string|null,
 *   actionsPath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   random?: () => number,
 *   minGapMs?: number,
 *   maxEntries?: number,
 *   checkMinMs?: number,
 *   checkMaxMs?: number,
 *   retryMinMs?: number,
 *   retryMaxMs?: number,
 *   firstMinMs?: number,
 *   firstMaxMs?: number,
 *   tickIntervalMs?: number,
 *   timeoutMs?: number,
 *   getRecentMoodLabels?: () => string[],
 *   getRecallDigest?: () => object|null,   // v2.67：最近自学/书架/读记，给她自己的时间一点「读过的材料」的血肉
 *   onLearn?: () => Promise<unknown>|unknown,
 *   onProbe?: (focus: string) => Promise<unknown>|unknown,
 *   onMake?: (input: {idea?: string}) => Promise<unknown>|unknown,
 * }} options
 */
