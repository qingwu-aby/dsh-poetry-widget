// @ts-check
// lib/core/memory-write-registry.mjs —— 长期记忆写入登记表（Gate K2）。
//
// 目的：为 Memory Gateway 迁移建立可核对清单。纯数据 + 校验，不执行任何写入、不改变现有行为：
//   · 登记 lib/domain 中所有长期记忆写入点（id/owner/module/storage/writeFn/callers）；
//   · 标注阶段：E0=已接 Gateway、E1=双写桥（旧路径 + Gateway）、E2=未接（直写，待迁移）；
//   · list/get/assertCoverage/validate：保证关键写入点（journal/game-memory/methods）已被覆盖，
//     并校验阶段与字段一致性（E1 必须 dualWrite+gateway，E2 必须非双写）。
//
// 迁移顺序建议见 docs/memory-write-audit.md；本文件只读，不触碰文件/网络。

/** 实现版本。 */
export const MEMORY_WRITE_REGISTRY_VERSION = 1

/** 写入阶段。 */
export const MEMORY_WRITE_PHASES = Object.freeze({
  E0: 'gateway',
  E1: 'dual-write',
  E2: 'direct',
})

/** 阶段中文标签。 */
export const MEMORY_WRITE_PHASE_LABELS = Object.freeze({
  E0: '已接 Gateway',
  E1: '双写桥',
  E2: '未接（直写）',
})

/** 风险等级。 */
export const MEMORY_WRITE_RISKS = Object.freeze(['low', 'medium', 'high'])

/** 关键写入点（assertCoverage 默认要求）。 */
export const REQUIRED_MEMORY_WRITE_IDS = Object.freeze(['journal', 'game-memory', 'methods'])

const ENTRIES = [
  {
    id: 'journal',
    owner: 'memory',
    module: 'lib/domain/memory/memory-journal.mjs',
    storage: 'journal.md + journal.jsonl（append）',
    writeFn: 'append',
    callers: ['mood/murmur/thought 写入服务', 'memory-consolidator（读）'],
    phase: 'E1',
    gateway: true,
    dualWrite: true,
    priority: 1,
    risk: 'low',
    notes: 'onRecord 回调（plugin-runtime wrapJournalBridge）→ hub-runtime.recordJournal；memoryWrite 关闭时 no-op',
  },
  {
    id: 'game-memory',
    owner: 'play',
    module: 'lib/domain/play/game-memory-workspace.mjs',
    storage: 'game-memory/*.md + PARTNER_GAME.md（git commit）',
    writeFn: 'record',
    callers: ['minecraft/game 服务', 'world-feedback 链路'],
    phase: 'E1',
    gateway: true,
    dualWrite: true,
    priority: 1,
    risk: 'low',
    notes: 'onRecord 回调（H5）→ hub-runtime.recordMemory；旧文件/Git 写入不变',
  },
  {
    id: 'methods',
    owner: 'learning',
    module: 'lib/domain/learning/method-memory.mjs',
    storage: 'methods.json（writeJsonAtomic）',
    writeFn: 'record',
    callers: ['学习/后果回访服务', 'methodMemory.digest 读取方'],
    phase: 'E1',
    gateway: true,
    dualWrite: true,
    priority: 1,
    risk: 'low',
    notes: 'onRecord 回调（I4）→ hub-runtime.recordMethod；旧 JSON 写入不变',
  },
  {
    id: 'memory-layers',
    owner: 'memory',
    module: 'lib/domain/memory/memory-layers.mjs',
    storage: 'memory-layers.json（writeJsonAtomic）',
    writeFn: 'layers.write',
    callers: ['memory-consolidator 整合服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '整合结果直写 JSON；迁移时可加 onRecord → Gateway semantic/reflection',
  },
  {
    id: 'memory-baseline',
    owner: 'memory',
    module: 'lib/domain/memory/memory-baseline.mjs',
    storage: 'memory-baseline.md（writeFileSync）',
    writeFn: 'writeBaseline',
    callers: ['启动/基线重建'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 3,
    risk: 'low',
    notes: '人读基线快照；迁移价值低（可保持直写）',
  },
  {
    id: 'relationship',
    owner: 'relationship',
    module: 'lib/domain/relationship/relationship-memory.mjs',
    storage: 'relationship.json（writeJsonAtomic）',
    writeFn: 'ingest',
    callers: ['chat-service 回复后 ingest', 'twin/关系链路'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 1,
    risk: 'high',
    notes: '关系记忆核心；建议下一个接 Gateway（category=relationship）',
  },
  {
    id: 'commitments',
    owner: 'relationship',
    module: 'lib/domain/relationship/commitments.mjs',
    storage: 'commitments.json（writeJsonAtomic）',
    writeFn: 'addAgreement / digest',
    callers: ['chat-service ingest 后 addAgreement', '承诺服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '承诺属关系记忆子集；可随 relationship 一起迁移',
  },
  {
    id: 'emotional-episodes',
    owner: 'emotion',
    module: 'lib/domain/emotion/emotional-episodes.mjs',
    storage: 'emotional-episodes.json（writeJsonAtomic）',
    writeFn: 'record',
    callers: ['chat 情绪线程', '成长/自省链路'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '建议接 Gateway（category=reflection）',
  },
  {
    id: 'emotional-continuity',
    owner: 'emotion',
    module: 'lib/domain/emotion/emotional-continuity.mjs',
    storage: 'emotional-continuity.json（writeJsonAtomic）',
    writeFn: 'recordFromChat / save',
    callers: ['chat-service recordFromChat', '情绪连续性服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '可与 emotional-episodes 合并迁移',
  },
  {
    id: 'knowledge-graph',
    owner: 'knowledge',
    module: 'lib/domain/knowledge/knowledge-graph.mjs',
    storage: 'knowledge-graph.json（writeJsonAtomic）',
    writeFn: 'ingest / add',
    callers: ['knowledge-extract', 'chat 提示（读）'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 1,
    risk: 'high',
    notes: '图谱是长期记忆主库之一；建议优先接 Gateway（category=semantic）',
  },
  {
    id: 'self-events',
    owner: 'being',
    module: 'lib/domain/being/self-events.mjs',
    storage: 'self-events.json（writeJsonAtomic）',
    writeFn: 'record / close',
    callers: ['心跳/事件循环', 'health 读'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 3,
    risk: 'low',
    notes: '运行事件日志；迁移价值低',
  },
  {
    id: 'self-state',
    owner: 'being',
    module: 'lib/domain/being/self-state.mjs',
    storage: 'self-state.json（writeJsonAtomic）',
    writeFn: 'save',
    callers: ['心跳/状态服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 3,
    risk: 'medium',
    notes: '状态快照非记忆语义；保持直写，必要时只读镜像',
  },
  {
    id: 'habit-memory',
    owner: 'being',
    module: 'lib/domain/being/habit-memory.mjs',
    storage: 'habits.json（writeJsonAtomic）',
    writeFn: 'record',
    callers: ['日常/习惯服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '可接 Gateway（category=preference）',
  },
  {
    id: 'internal-rules',
    owner: 'being',
    module: 'lib/domain/being/internal-rules.mjs',
    storage: 'internal-rules.json（writeJsonAtomic）',
    writeFn: 'record / add',
    callers: ['规则合成/chat 提示'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '规则库；可接 Gateway（category=preference）',
  },
  {
    id: 'thought-chain',
    owner: 'learning',
    module: 'lib/domain/learning/thought-chain.mjs',
    storage: 'thought-chain/*.md + positions.json（append/writeJsonAtomic）',
    writeFn: 'append / savePositions',
    callers: ['碎碎念/思考链服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '与 journal 同属表达记忆；可复用 journal 桥',
  },
  {
    id: 'worldview',
    owner: 'learning',
    module: 'lib/domain/learning/worldview.mjs',
    storage: 'worldview.json（writeJsonAtomic）',
    writeFn: 'save',
    callers: ['世界观/自省服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '可接 Gateway（category=reflection）',
  },
  {
    id: 'self-philosophy',
    owner: 'learning',
    module: 'lib/domain/learning/self-philosophy.mjs',
    storage: 'self-philosophy.md（appendFileSync）',
    writeFn: 'append',
    callers: ['哲学/自省链路'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: '可复用 journal 桥',
  },
  {
    id: 'daily-life',
    owner: 'life',
    module: 'lib/domain/life/daily-life.mjs',
    storage: 'daily-life.jsonl（appendFileSync）',
    writeFn: 'record',
    callers: ['日常/心情链路'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 2,
    risk: 'medium',
    notes: 'JSONL append；迁移可复用 file provider 思路',
  },
  {
    id: 'voice-memory',
    owner: 'voice',
    module: 'lib/domain/voice/voice-memory.mjs',
    storage: 'voice-memory.json（writeJsonAtomic）',
    writeFn: 'save',
    callers: ['语音/声音记忆服务'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 3,
    risk: 'low',
    notes: '语音资产索引；迁移价值低',
  },
  {
    id: 'game-memory-legacy',
    owner: 'play',
    module: 'lib/domain/play/game-memory.mjs',
    storage: 'game-memory.json（writeFileSync + rename）',
    writeFn: 'save',
    callers: ['旧版游戏记忆（legacy 迁移路径）'],
    phase: 'E2',
    gateway: false,
    dualWrite: false,
    priority: 3,
    risk: 'low',
    notes: 'legacy JSON；已被 game-memory-workspace 取代，保持只读/兼容',
  },
]

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 登记表（冻结只读）。 */
export const MEMORY_WRITE_REGISTRY = Object.freeze(ENTRIES.map((entry) => Object.freeze({ ...entry })))

/** 按条件列出写入点。 */
export function listMemoryWrites(filter = {}) {
  const spec = isPlainObject(filter) ? filter : {}
  return MEMORY_WRITE_REGISTRY.filter((entry) => {
    if (typeof spec.phase === 'string' && entry.phase !== spec.phase) return false
    if (typeof spec.owner === 'string' && entry.owner !== spec.owner) return false
    if (spec.gateway === true && entry.gateway !== true) return false
    if (spec.gateway === false && entry.gateway !== false) return false
    if (spec.dualWrite === true && entry.dualWrite !== true) return false
    if (spec.dualWrite === false && entry.dualWrite !== false) return false
    return true
  }).map((entry) => ({ ...entry }))
}

/** 取单个写入点。 */
export function getMemoryWrite(id) {
  const entry = MEMORY_WRITE_REGISTRY.find((item) => item.id === id)
  return entry === undefined ? null : { ...entry }
}

/** 校验登记表字段/阶段一致性；返回 {ok, errors, total, byPhase}。 */
export function validateMemoryWriteRegistry(registry = MEMORY_WRITE_REGISTRY) {
  const errors = []
  const list = Array.isArray(registry) ? registry : []
  if (list.length === 0) errors.push({ id: '$', message: '登记表不能为空' })
  const seen = new Set()
  for (const entry of list) {
    if (!isPlainObject(entry)) {
      errors.push({ id: '$', message: 'entry 必须是对象' })
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id : ''
    if (id.length === 0) errors.push({ id: '$', message: 'entry 缺少 id' })
    else if (seen.has(id)) errors.push({ id, message: 'id 重复' })
    else seen.add(id)
    for (const field of ['owner', 'module', 'storage', 'writeFn']) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        errors.push({ id: id || '$', message: `缺少 ${field}` })
      }
    }
    if (!Array.isArray(entry.callers) || entry.callers.length === 0) errors.push({ id: id || '$', message: '缺少 callers' })
    if (!Object.prototype.hasOwnProperty.call(MEMORY_WRITE_PHASES, entry.phase)) {
      errors.push({ id: id || '$', message: 'phase 必须是 E0/E1/E2' })
      continue
    }
    if (entry.phase === 'E1' && (entry.dualWrite !== true || entry.gateway !== true)) {
      errors.push({ id, message: 'E1（双写）必须 dualWrite=true 且 gateway=true' })
    }
    if (entry.phase === 'E2' && entry.dualWrite !== false) {
      errors.push({ id, message: 'E2（未接）必须 dualWrite=false' })
    }
    if (entry.phase === 'E0' && entry.gateway !== true) {
      errors.push({ id, message: 'E0（已接）必须 gateway=true' })
    }
    if (!Number.isFinite(entry.priority) || entry.priority < 1 || entry.priority > 3) {
      errors.push({ id: id || '$', message: 'priority 必须是 1..3' })
    }
    if (MEMORY_WRITE_RISKS.indexOf(entry.risk) < 0) errors.push({ id: id || '$', message: 'risk 必须是 low/medium/high' })
  }
  const byPhase = { E0: 0, E1: 0, E2: 0 }
  for (const entry of list) if (isPlainObject(entry) && byPhase[entry.phase] !== undefined) byPhase[entry.phase] += 1
  return { ok: errors.length === 0, errors, total: list.length, byPhase }
}

/** 覆盖校验：关键写入点必须存在且登记表整体合法。 */
export function assertMemoryWriteCoverage(requiredIds = REQUIRED_MEMORY_WRITE_IDS, registry = MEMORY_WRITE_REGISTRY) {
  const required = Array.isArray(requiredIds) ? requiredIds.filter((id) => typeof id === 'string' && id.length > 0) : []
  const validated = validateMemoryWriteRegistry(registry)
  const ids = new Set((Array.isArray(registry) ? registry : []).map((entry) => (isPlainObject(entry) ? entry.id : '')))
  const missing = required.filter((id) => !ids.has(id))
  return {
    ok: validated.ok === true && missing.length === 0,
    missing,
    errors: validated.errors,
    total: validated.total,
    byPhase: validated.byPhase,
    required: required.slice(),
  }
}

/** 审计快照（health/UI 可读；不写盘）。 */
export function memoryWriteAuditSnapshot() {
  const validated = validateMemoryWriteRegistry()
  const dual = listMemoryWrites({ dualWrite: true }).map((entry) => entry.id)
  const direct = listMemoryWrites({ dualWrite: false }).map((entry) => entry.id)
  return {
    ok: validated.ok,
    version: MEMORY_WRITE_REGISTRY_VERSION,
    total: validated.total,
    byPhase: validated.byPhase,
    dualWrite: dual,
    directWrite: direct,
    required: REQUIRED_MEMORY_WRITE_IDS.slice(),
    coverage: assertMemoryWriteCoverage().ok,
    errors: validated.errors,
  }
}
