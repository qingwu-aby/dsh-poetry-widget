// lib/self-curriculum.mjs —— 正史学习大纲（v2.49）。
//
// 不是随机搜“边角料”，而是按二十四史的次序，一本一本读：
// 每本书给 2–3 个问题，围绕制度、土地/人口、财政、阶级关系、国家能力与观念，
// 用历史唯物主义的方法问“谁在生产、谁在承担代价、制度怎样维持”。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

export const CURRICULUM_VERSION = 1
export const CURRICULUM_TRACK = 'official-histories'

/**
 * 正史顺序。每个 stage 是一本书（或一组同类史书），每本给 2–3 个问题。
 * 问题不是“知识点”，而是有矛盾、有材料缺口、可以用原文/注疏/研究检验的题目。
 */
export const CURRICULUM_STAGES = Object.freeze([
  { id: 'shiji', book: '《史记》', period: '上古—西汉', questions: [
    '《史记》里从商鞅变法到秦统一：军功爵、县制、编户齐民怎样改变土地与人身关系？',
    '秦亡与汉初郡国并行：徭役、粮运和诸侯王财政，哪一边先把制度撑裂？',
    '《史记·货殖列传》《平准书》里的市场、商人和国家财政，谁在承担积累的成本？',
  ] },
  { id: 'hanshu', book: '《汉书》', period: '西汉', questions: [
    '《汉书·食货志》里的轻田租、算赋、盐铁官营：国家、地主、小农之间的负担怎样分配？',
    '昭宣中兴到王莽改制：同一套“抑兼并”话语，为什么反复变成新的财政抽取？',
  ] },
  { id: 'houhanshu', book: '《后汉书》', period: '东汉', questions: [
    '豪强、度田、察举：东汉国家为什么难以真正清点土地和人口？',
    '党锢与宦官：士人政治和皇权内廷的冲突，背后是谁在争夺地方控制？',
  ] },
  { id: 'sanguozhi', book: '《三国志》', period: '三国', questions: [
    '屯田、世兵、复客：三国政权怎样用“恢复生产”重建人身依附？',
    '蜀汉与曹魏的财政地理：山地转运、盐铁和人口规模怎样限制国家能力？',
  ] },
  { id: 'jinshu', book: '《晋书》', period: '两晋', questions: [
    '占田荫客、九品中正：西晋怎样把土地、劳动力和选官一起世家化？',
    '八王之乱与永嘉之乱：宗王、方镇和流民，哪条矛盾先失控？',
  ] },
  { id: 'nanbeichao', book: '《宋书》《南齐书》《梁书》《陈书》《魏书》《北齐书》《周书》', period: '南北朝', questions: [
    '南朝土断、白籍和侨置：国家怎样在流民与士族之间重新编制人口？',
    '北朝均田、三长制与宗主督护：拓跋国家怎样把部落、豪强和编户重新组织？',
    '南北朝的寺院经济与僧祇户：宗教组织为什么能成为土地和劳动力的竞争者？',
  ] },
  { id: 'suishu', book: '《隋书》', period: '隋', questions: [
    '大索貌阅、输籍定样和运河：隋怎样在短时间内抽取巨量人口与粮食，又怎样被反噬？',
    '隋末民变与府兵、徭役：国家能力很强时，为什么基层社会的承受线反而更脆？',
  ] },
  { id: 'tang', book: '《旧唐书》《新唐书》', period: '唐', questions: [
    '均田、租庸调到两税法：税基从人丁转向资产，谁被纳入、谁被甩出？',
    '安史之乱后的藩镇与盐铁转运：中央—地方财政关系怎样重新谈判？',
    '唐代科举、门荫与士族：选官制度的变化有没有真正改变权力结构？',
  ] },
  { id: 'wudai', book: '《旧五代史》《新五代史》', period: '五代十国', questions: [
    '五代军阀政权为什么反复“先军后政”？粮饷、牙兵和文官谁先被牺牲？',
    '五代到宋初的禁军、枢密院和财权集中：武人政治怎样被制度性收束？',
  ] },
  { id: 'song', book: '《宋史》', period: '宋', questions: [
    '宋代不抑兼并、募兵和厢军：国家为什么要用财政养一支庞大的失业/半失业人口？',
    '王安石变法与元祐更化：青苗、免役、市易的财政目标，为什么在基层执行中变形？',
    '宋代的榷场、海贸和纸币：商业繁荣与国家财政汲取之间的关系是什么？',
  ] },
  { id: 'liaojin', book: '《辽史》《金史》', period: '辽金', questions: [
    '辽的斡鲁朵、头下军州和南北面官：征服政权怎样同时管理畜牧、农耕和汉地？',
    '金代猛安谋克与汉地租佃：女真军事组织怎样被土地关系改变？',
  ] },
  { id: 'yuan', book: '《元史》', period: '元', questions: [
    '元代的军户、匠户、站户和包银：征服帝国怎样用身份分类来组织生产与运输？',
    '行省、达鲁花赤和江南税粮：蒙古统治怎样与地方精英共治？',
  ] },
  { id: 'ming', book: '《明史》', period: '明', questions: [
    '黄册、鱼鳞图册和一条鞭法：明代国家怎样从人丁、土地到白银重新组织税基？',
    '明代的卫所、军屯与募兵：军事制度为什么从自给走向财政化？',
    '晚明白银、灾荒与民变：财政危机、气候和阶级矛盾怎样叠加？',
  ] },
])

export function resolveCurriculumPath(env = process.env, home = null, stateDir = null) {
  if (typeof stateDir === 'string' && stateDir.length > 0) return path.join(stateDir, 'curriculum.json')
  const base = env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home ?? '', '.dsh')
  return path.join(base, '.dsh-poetry', 'curriculum.json')
}

function shanghaiDay(ts) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

export function createCurriculum(options = {}) {
  const file = path.resolve(options.file ?? resolveCurriculumPath(options.env ?? process.env, options.home ?? null, options.stateDir ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  let cache = null

  function fresh() {
    return { ok: true, v: CURRICULUM_VERSION, track: CURRICULUM_TRACK, stage: 0, unit: 0, startedAt: now(), updatedAt: now(), completed: [] }
  }

  function load() {
    try {
      if (!existsSync(file)) return fresh()
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!parsed || parsed.track !== CURRICULUM_TRACK) return fresh()
      return {
        ok: true,
        v: CURRICULUM_VERSION,
        track: CURRICULUM_TRACK,
        stage: Number.isInteger(parsed.stage) ? Math.max(0, Math.min(CURRICULUM_STAGES.length - 1, parsed.stage)) : 0,
        unit: Number.isInteger(parsed.unit) ? Math.max(0, parsed.unit) : 0,
        startedAt: Number.isFinite(parsed.startedAt) ? parsed.startedAt : now(),
        updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : now(),
        completed: Array.isArray(parsed.completed) ? parsed.completed.filter((item) => item && typeof item.question === 'string').slice(-100) : [],
      }
    } catch {
      return fresh()
    }
  }

  function persist(state) {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, state)
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 正史大纲写入失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    }
  }

  function ensure() {
    if (cache === null) {
      const existed = existsSync(file)
      cache = load()
      if (!existed) persist(cache)
    }
    return cache
  }

  function currentQuestion() {
    const state = ensure()
    const stage = CURRICULUM_STAGES[state.stage] ?? CURRICULUM_STAGES[0]
    const question = stage.questions[state.unit] ?? stage.questions[stage.questions.length - 1]
    return { ...stage, stage: state.stage, unit: state.unit, question, total: CURRICULUM_STAGES.length }
  }

  function nextQuestion() {
    return currentQuestion().question
  }

  function completeCurrent(summary = '') {
    const state = ensure()
    const stage = CURRICULUM_STAGES[state.stage] ?? CURRICULUM_STAGES[0]
    state.completed.push({
      stage: state.stage,
      unit: state.unit,
      book: stage.book,
      question: stage.questions[state.unit] ?? stage.questions[stage.questions.length - 1],
      summary: String(summary ?? '').slice(0, 1200),
      at: now(),
    })
    state.completed = state.completed.slice(-100)
    state.unit += 1
    if (state.unit >= stage.questions.length) {
      state.unit = 0
      state.stage = Math.min(CURRICULUM_STAGES.length - 1, state.stage + 1)
    }
    state.updatedAt = now()
    persist(state)
    return currentQuestion()
  }

  return {
    file,
    current: currentQuestion,
    nextQuestion,
    completeCurrent,
    snapshot: () => ({ ...currentQuestion(), completed: ensure().completed.length }),
  }
}
