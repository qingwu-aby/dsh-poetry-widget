// lib/core/feedback-ledger.mjs —— 反馈账本（Gate C2，纯逻辑 + 注入时钟）。
//
// 目标：把每个 Task 的“假设 → 实验 → 回执 → 结论 → 方法候选”沉淀下来，避免失败白跑、成功不可复用。
//   · record({taskId, hypothesis, experiment, receipt, outcome, evidence})：
//     校验可验证 receipt（kind/at/ref/ok），outcome ∈ success|failure|inconclusive；
//   · 同 hypothesis 可多次实验（不同 experiment），可统计成功率；
//   · 重复实验合并（证据并集、回执合并、outcome 历史保留）；冲突不丢失（记录 conflict 计数）；
//   · promoteToMethod：仅当 outcome=success 且证据/成功率达标时生成 method 候选；
//     **只返回候选，不直接写 Memory Gateway**（memoryEntry 字段可直接交给 C1 网关，由调用方决定）；
//   · 失败记录不丢失：容量超限时优先淘汰非失败记录；
//   · snapshot/metrics：records/byOutcome/byHypothesis/conflicts/methods 候选统计。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟可注入。

/** 实现版本。 */
export const FEEDBACK_LEDGER_VERSION = 1

/** 结论枚举。 */
export const FEEDBACK_OUTCOMES = Object.freeze(['success', 'failure', 'inconclusive'])

/** 回执类型白名单（可验证来源）。 */
export const FEEDBACK_RECEIPT_KINDS = Object.freeze(['tool', 'test', 'event', 'manual', 'model', 'external'])

/** 错误码。 */
export const FEEDBACK_LEDGER_CODES = Object.freeze({
  invalidRecord: 'FEEDBACK_INVALID_RECORD',
  invalidReceipt: 'FEEDBACK_INVALID_RECEIPT',
  invalidOutcome: 'FEEDBACK_INVALID_OUTCOME',
  invalidArgument: 'FEEDBACK_INVALID_ARGUMENT',
  notFound: 'FEEDBACK_NOT_FOUND',
  insufficientEvidence: 'FEEDBACK_INSUFFICIENT_EVIDENCE',
})

/** 默认阈值/上限。 */
export const FEEDBACK_LEDGER_DEFAULTS = Object.freeze({
  maxRecords: 5000,
  minEvidenceForMethod: 2,
  minExperimentsForMethod: 2,
  minSuccessRateForMethod: 0.6,
  maxHypothesisLength: 300,
  maxExperimentLength: 500,
  maxTaskIdLength: 120,
  maxReceiptRefLength: 200,
  maxEvidenceItems: 10,
  maxEvidenceTextLength: 500,
  maxTitleLength: 120,
  defaultLimit: 50,
  maxLimit: 200,
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function normalizeText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function cloneRecord(record) {
  if (!isPlainObject(record)) return null
  return {
    ...record,
    receipts: Array.isArray(record.receipts) ? record.receipts.map((item) => ({ ...item })) : [],
    evidence: Array.isArray(record.evidence) ? record.evidence.map((item) => ({ ...item })) : [],
    outcomeHistory: Array.isArray(record.outcomeHistory) ? record.outcomeHistory.map((item) => ({ ...item })) : [],
    meta: isPlainObject(record.meta) ? { ...record.meta } : null,
  }
}

/**
 * 校验“可验证回执”：必须能追溯来源（kind + at + ref/id + ok 布尔）。
 * @param {unknown} receipt
 */
export function validateReceipt(receipt) {
  if (!isPlainObject(receipt)) {
    return errorResult(FEEDBACK_LEDGER_CODES.invalidReceipt, 'receipt 必须是对象（kind/at/ref/ok）')
  }
  const kind = typeof receipt.kind === 'string' ? receipt.kind.trim().toLowerCase() : ''
  if (FEEDBACK_RECEIPT_KINDS.indexOf(kind) < 0) {
    return errorResult(FEEDBACK_LEDGER_CODES.invalidReceipt, `receipt.kind 必须是：${FEEDBACK_RECEIPT_KINDS.join(' / ')}`, {
      allowed: FEEDBACK_RECEIPT_KINDS,
    })
  }
  const at = Number(receipt.at)
  if (!Number.isFinite(at) || at <= 0) {
    return errorResult(FEEDBACK_LEDGER_CODES.invalidReceipt, 'receipt.at 必须是毫秒时间戳（>0）')
  }
  const ref = typeof receipt.ref === 'string' && receipt.ref.trim().length > 0
    ? receipt.ref.trim()
    : typeof receipt.id === 'string' && receipt.id.trim().length > 0
      ? receipt.id.trim()
      : ''
  if (ref.length === 0 || ref.length > FEEDBACK_LEDGER_DEFAULTS.maxReceiptRefLength) {
    return errorResult(FEEDBACK_LEDGER_CODES.invalidReceipt, `receipt 需要 ref 或 id（1–${FEEDBACK_LEDGER_DEFAULTS.maxReceiptRefLength} 字）`)
  }
  if (typeof receipt.ok !== 'boolean') {
    return errorResult(FEEDBACK_LEDGER_CODES.invalidReceipt, 'receipt.ok 必须是布尔（回执是否验证通过）')
  }
  return {
    ok: true,
    receipt: {
      kind,
      at: Math.floor(at),
      ref,
      ok: receipt.ok,
      ...(typeof receipt.detail === 'string' && receipt.detail.length > 0 ? { detail: receipt.detail.slice(0, 300) } : {}),
    },
  }
}

function normalizeEvidence(raw) {
  if (raw === undefined || raw === null) return { ok: true, evidence: [] }
  if (!Array.isArray(raw)) return errorResult(FEEDBACK_LEDGER_CODES.invalidRecord, 'evidence 必须是数组')
  const evidence = []
  for (const item of raw.slice(0, FEEDBACK_LEDGER_DEFAULTS.maxEvidenceItems)) {
    if (typeof item === 'string') {
      const text = normalizeText(item, FEEDBACK_LEDGER_DEFAULTS.maxEvidenceTextLength)
      if (text.length > 0) evidence.push({ text, source: '', at: 0 })
      continue
    }
    if (!isPlainObject(item)) continue
    const text = normalizeText(item.text, FEEDBACK_LEDGER_DEFAULTS.maxEvidenceTextLength)
    if (text.length === 0) continue
    evidence.push({
      text,
      source: typeof item.source === 'string' ? item.source.slice(0, 80) : '',
      at: Number.isFinite(Number(item.at)) ? Number(item.at) : 0,
    })
  }
  return { ok: true, evidence }
}

/**
 * 创建反馈账本。
 * @param {{
 *   now?: () => number,
 *   maxRecords?: number,
 *   minEvidenceForMethod?: number,
 *   minExperimentsForMethod?: number,
 *   minSuccessRateForMethod?: number,
 *   defaultLimit?: number,
 *   maxLimit?: number,
 * }} [options]
 */
export function createFeedbackLedger(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxRecords = readPositiveInt(options.maxRecords, FEEDBACK_LEDGER_DEFAULTS.maxRecords)
  const minEvidenceForMethod = readPositiveInt(
    options.minEvidenceForMethod,
    FEEDBACK_LEDGER_DEFAULTS.minEvidenceForMethod,
  )
  const minExperimentsForMethod = readPositiveInt(
    options.minExperimentsForMethod,
    FEEDBACK_LEDGER_DEFAULTS.minExperimentsForMethod,
  )
  const minSuccessRateForMethod = Math.min(
    1,
    Math.max(0, readNumber(options.minSuccessRateForMethod, FEEDBACK_LEDGER_DEFAULTS.minSuccessRateForMethod)),
  )
  const defaultLimit = readPositiveInt(options.defaultLimit, FEEDBACK_LEDGER_DEFAULTS.defaultLimit)
  const maxLimit = readPositiveInt(options.maxLimit, FEEDBACK_LEDGER_DEFAULTS.maxLimit)

  /** id → record。 */
  const records = new Map()
  let nextId = 0
  const metrics = {
    records: 0,
    merges: 0,
    duplicates: 0,
    conflicts: 0,
    successes: 0,
    failures: 0,
    inconclusive: 0,
    promoted: 0,
    invalid: 0,
    pruned: 0,
  }

  function hypothesisKey(hypothesis) {
    return normalizeText(hypothesis, FEEDBACK_LEDGER_DEFAULTS.maxHypothesisLength).toLowerCase()
  }

  function experimentKey(experiment) {
    return normalizeText(experiment, FEEDBACK_LEDGER_DEFAULTS.maxExperimentLength).toLowerCase()
  }

  function recordKey(hypothesis, experiment) {
    return hypothesisKey(hypothesis) + '|' + experimentKey(experiment)
  }

  function pruneRecords() {
    while (records.size > maxRecords) {
      // 失败记录优先保留：先淘汰最旧的非 failure 记录，其次最旧记录。
      let candidateId = null
      let candidateAt = Infinity
      for (const [id, record] of records) {
        if (record.outcome === 'failure') continue
        if (record.updatedAt < candidateAt) {
          candidateAt = record.updatedAt
          candidateId = id
        }
      }
      if (candidateId === null) {
        for (const [id, record] of records) {
          if (record.updatedAt < candidateAt) {
            candidateAt = record.updatedAt
            candidateId = id
          }
        }
      }
      if (candidateId === null) return
      records.delete(candidateId)
      metrics.pruned += 1
    }
  }

  function normalizeRecordInput(raw) {
    if (!isPlainObject(raw)) return errorResult(FEEDBACK_LEDGER_CODES.invalidRecord, 'feedback 必须是对象')
    const taskId = normalizeText(raw.taskId, FEEDBACK_LEDGER_DEFAULTS.maxTaskIdLength)
    if (taskId.length === 0) return errorResult(FEEDBACK_LEDGER_CODES.invalidRecord, 'taskId 必须是非空字符串')
    const hypothesis = normalizeText(raw.hypothesis, FEEDBACK_LEDGER_DEFAULTS.maxHypothesisLength)
    if (hypothesis.length === 0) return errorResult(FEEDBACK_LEDGER_CODES.invalidRecord, 'hypothesis 必须是非空字符串')
    const experiment = normalizeText(raw.experiment, FEEDBACK_LEDGER_DEFAULTS.maxExperimentLength)
    if (experiment.length === 0) return errorResult(FEEDBACK_LEDGER_CODES.invalidRecord, 'experiment 必须是非空字符串')
    const receipt = validateReceipt(raw.receipt)
    if (receipt.ok !== true) return receipt
    const outcome = typeof raw.outcome === 'string' ? raw.outcome.trim().toLowerCase() : ''
    if (FEEDBACK_OUTCOMES.indexOf(outcome) < 0) {
      return errorResult(FEEDBACK_LEDGER_CODES.invalidOutcome, `outcome 必须是：${FEEDBACK_OUTCOMES.join(' / ')}`, {
        allowed: FEEDBACK_OUTCOMES,
      })
    }
    const evidence = normalizeEvidence(raw.evidence)
    if (evidence.ok !== true) return evidence
    const provenance = isPlainObject(raw.provenance) ? raw.provenance : {}
    return {
      ok: true,
      entry: {
        taskId,
        hypothesis,
        experiment,
        outcome,
        receipt: receipt.receipt,
        evidence: evidence.evidence,
        provenance: {
          ...(typeof provenance.activity === 'string' && provenance.activity.length > 0
            ? { activity: provenance.activity.slice(0, 40) }
            : {}),
          ...(typeof provenance.correlationId === 'string' && provenance.correlationId.length > 0
            ? { correlationId: provenance.correlationId.slice(0, 128) }
            : {}),
        },
        meta: isPlainObject(raw.meta) ? raw.meta : null,
      },
    }
  }

  /**
   * 记录一次反馈（唯一入口）。同 hypothesis+experiment 重复 → 合并（证据并集/回执合并/outcome 历史）。
   * @param {object} raw
   * @returns {{ok:true, record: object, duplicate?: boolean, merged?: boolean, conflict?: boolean} | {ok:false, code: string, message: string}}
   */
  function record(raw) {
    const normalized = normalizeRecordInput(raw)
    if (normalized.ok !== true) {
      metrics.invalid += 1
      return normalized
    }
    const input = normalized.entry
    const key = recordKey(input.hypothesis, input.experiment)
    const existing = [...records.values()].find((item) => recordKey(item.hypothesis, item.experiment) === key) ?? null
    const ts = now()
    if (existing !== null) {
      const mergedEvidence = [...existing.evidence]
      const seenEvidence = new Set(mergedEvidence.map((item) => item.text))
      for (const item of input.evidence) {
        if (seenEvidence.has(item.text)) continue
        seenEvidence.add(item.text)
        mergedEvidence.push(item)
      }
      const merged = {
        ...existing,
        outcome: input.outcome,
        receipt: input.receipt,
        receipts: [...existing.receipts, input.receipt].slice(-10),
        evidence: mergedEvidence.slice(-FEEDBACK_LEDGER_DEFAULTS.maxEvidenceItems * 2),
        outcomeHistory: [...existing.outcomeHistory, { outcome: input.outcome, at: ts }].slice(-20),
        updatedAt: ts,
        taskId: input.taskId,
      }
      const conflict = existing.outcome !== input.outcome
      if (conflict) metrics.conflicts += 1
      else metrics.duplicates += 1
      metrics.merges += 1
      records.set(existing.id, merged)
      return { ok: true, record: cloneRecord(merged), duplicate: true, merged: true, conflict }
    }
    nextId += 1
    const recordValue = {
      id: 'fb-' + nextId,
      taskId: input.taskId,
      hypothesis: input.hypothesis,
      experiment: input.experiment,
      outcome: input.outcome,
      receipt: input.receipt,
      receipts: [input.receipt],
      evidence: input.evidence,
      outcomeHistory: [{ outcome: input.outcome, at: ts }],
      provenance: input.provenance,
      meta: input.meta,
      createdAt: ts,
      updatedAt: ts,
      promoted: false,
      promotedAt: 0,
    }
    records.set(recordValue.id, recordValue)
    metrics.records += 1
    if (input.outcome === 'success') metrics.successes += 1
    else if (input.outcome === 'failure') metrics.failures += 1
    else metrics.inconclusive += 1
    pruneRecords()
    return { ok: true, record: cloneRecord(recordValue), duplicate: false, merged: false, conflict: false }
  }

  /** 某个 hypothesis 的统计（多次实验的成功率）。 */
  function statsForHypothesis(hypothesis) {
    const key = hypothesisKey(hypothesis)
    const list = [...records.values()].filter((item) => hypothesisKey(item.hypothesis) === key)
    const success = list.filter((item) => item.outcome === 'success').length
    const failure = list.filter((item) => item.outcome === 'failure').length
    const inconclusive = list.filter((item) => item.outcome === 'inconclusive').length
    const evidenceCount = list.reduce((total, item) => total + item.evidence.length, 0)
    return {
      hypothesis: key,
      experiments: list.length,
      success,
      failure,
      inconclusive,
      successRate: list.length > 0 ? success / list.length : 0,
      evidenceCount,
      lastAt: list.reduce((latest, item) => Math.max(latest, item.updatedAt), 0),
    }
  }

  function list(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const limit = Math.min(readPositiveInt(spec.limit, defaultLimit), maxLimit)
    const out = []
    for (const recordValue of records.values()) {
      if (typeof spec.outcome === 'string' && recordValue.outcome !== spec.outcome) continue
      if (typeof spec.taskId === 'string' && spec.taskId.length > 0 && recordValue.taskId !== spec.taskId) continue
      if (typeof spec.hypothesis === 'string' && spec.hypothesis.length > 0 && hypothesisKey(recordValue.hypothesis) !== hypothesisKey(spec.hypothesis)) {
        continue
      }
      out.push(recordValue)
    }
    out.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    return out.slice(0, limit).map((item) => cloneRecord(item))
  }

  function get(id) {
    const recordValue = records.get(String(id ?? ''))
    return recordValue === undefined ? null : cloneRecord(recordValue)
  }

  /**
   * 生成 method 候选（不写 Memory Gateway）：仅 outcome=success 且证据/实验次数/成功率达标。
   * @param {{recordId?: string, hypothesis?: string}} input
   * @returns {{ok:true, candidate: object} | {ok:false, code: string, message: string, details?: object}}
   */
  function promoteToMethod(input) {
    const spec = isPlainObject(input) ? input : {}
    let recordValue = null
    if (typeof spec.recordId === 'string' && spec.recordId.length > 0) {
      recordValue = records.get(spec.recordId) ?? null
      if (recordValue === null) return errorResult(FEEDBACK_LEDGER_CODES.notFound, `反馈不存在：${spec.recordId}`)
    } else if (typeof spec.hypothesis === 'string' && spec.hypothesis.length > 0) {
      const key = hypothesisKey(spec.hypothesis)
      const candidates = [...records.values()]
        .filter((item) => hypothesisKey(item.hypothesis) === key && item.outcome === 'success')
        .sort((left, right) => right.updatedAt - left.updatedAt)
      recordValue = candidates[0] ?? null
      if (recordValue === null) {
        return errorResult(FEEDBACK_LEDGER_CODES.insufficientEvidence, '该 hypothesis 没有成功的实验记录', { hypothesis: key })
      }
    } else {
      return errorResult(FEEDBACK_LEDGER_CODES.invalidArgument, '需要 recordId 或 hypothesis')
    }
    if (recordValue.outcome !== 'success') {
      return errorResult(FEEDBACK_LEDGER_CODES.insufficientEvidence, `只有 success 才能升级为方法（当前 ${recordValue.outcome}）`, {
        recordId: recordValue.id,
        outcome: recordValue.outcome,
      })
    }
    const stats = statsForHypothesis(recordValue.hypothesis)
    const details = {
      recordId: recordValue.id,
      evidenceCount: recordValue.evidence.length,
      minEvidenceForMethod,
      experiments: stats.experiments,
      minExperimentsForMethod,
      successRate: stats.successRate,
      minSuccessRateForMethod,
    }
    if (recordValue.evidence.length < minEvidenceForMethod) {
      return errorResult(FEEDBACK_LEDGER_CODES.insufficientEvidence, `证据不足（${recordValue.evidence.length}/${minEvidenceForMethod}）`, details)
    }
    if (stats.experiments < minExperimentsForMethod) {
      return errorResult(FEEDBACK_LEDGER_CODES.insufficientEvidence, `实验次数不足（${stats.experiments}/${minExperimentsForMethod}）`, details)
    }
    if (stats.successRate < minSuccessRateForMethod) {
      return errorResult(
        FEEDBACK_LEDGER_CODES.insufficientEvidence,
        `成功率不足（${stats.successRate.toFixed(2)}/${minSuccessRateForMethod}）`,
        details,
      )
    }
    const title = normalizeText(
      typeof spec.title === 'string' && spec.title.length > 0 ? spec.title : recordValue.hypothesis,
      FEEDBACK_LEDGER_DEFAULTS.maxTitleLength,
    )
    const candidate = {
      kind: 'method',
      title,
      hypothesis: recordValue.hypothesis,
      experiment: recordValue.experiment,
      steps: [
        `假设：${recordValue.hypothesis}`,
        `实验：${recordValue.experiment}`,
        `结论：${recordValue.outcome}（成功率 ${stats.successRate.toFixed(2)}）`,
      ],
      evidence: recordValue.evidence.map((item) => ({ ...item })),
      receipts: recordValue.receipts.map((item) => ({ ...item })),
      successRate: stats.successRate,
      experiments: stats.experiments,
      sourceRecordId: recordValue.id,
      createdAt: now(),
      // 可直接交给 Memory Gateway 的 entry 形状（category=method；调用方决定是否写入）。
      memoryEntry: {
        category: 'method',
        topic: 'method:' + hypothesisKey(recordValue.hypothesis),
        text: `方法：${title}。${recordValue.experiment}`.slice(0, 500),
        source: { kind: 'feedback', id: recordValue.id, activity: recordValue.provenance.activity ?? '' },
        confidence: Math.min(1, Math.max(0, stats.successRate)),
        provenance: {
          ...recordValue.provenance,
          taskId: recordValue.taskId,
          at: now(),
        },
        tags: ['feedback', 'method'],
      },
    }
    recordValue.promoted = true
    recordValue.promotedAt = candidate.createdAt
    records.set(recordValue.id, recordValue)
    metrics.promoted += 1
    return { ok: true, candidate }
  }

  function snapshot() {
    const byOutcome = { success: 0, failure: 0, inconclusive: 0 }
    const byHypothesis = new Map()
    for (const recordValue of records.values()) {
      byOutcome[recordValue.outcome] = (byOutcome[recordValue.outcome] ?? 0) + 1
      const key = hypothesisKey(recordValue.hypothesis)
      byHypothesis.set(key, (byHypothesis.get(key) ?? 0) + 1)
    }
    const thresholds = {
      minEvidenceForMethod,
      minExperimentsForMethod,
      minSuccessRateForMethod,
    }
    return {
      ok: true,
      version: FEEDBACK_LEDGER_VERSION,
      now: now(),
      records: records.size,
      byOutcome,
      hypotheses: byHypothesis.size,
      conflicts: metrics.conflicts,
      promoted: metrics.promoted,
      thresholds,
      metrics: { ...metrics },
      recent: list({ limit: 10 }),
    }
  }

  return {
    record,
    statsForHypothesis,
    list,
    get,
    promoteToMethod,
    snapshot,
  }
}
