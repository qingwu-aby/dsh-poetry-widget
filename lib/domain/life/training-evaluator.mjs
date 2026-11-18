// @ts-check
// lib/domain/life/training-evaluator.mjs —— 训练评估器（Gate M2，读取 self-train 报告）。
//
// 数据来源（只读，不修改 self-train 脚本/报告）：
//   · report.md：解析「评估：通过/未通过」「期望相似度均值 X」「nonEmpty/total 有输出」
//     以及「复评 … 平均期望相似度约 X … 通过闸门」（后出现的评估结果优先）；
//   · history.log：report 不可用时回退最后一条 JSON {eval:{ok,avg}}（或 eval=true/false 行）。
// 返回 {ok, available, score, passed, nonEmpty, total, reasons, source, threshold}；
// 无报告/坏报告 → ok:false + available:false（不伪造通过）。
// 纯本地读取：不联网、不写盘。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 实现版本。 */
export const TRAINING_EVALUATOR_VERSION = 1

/** 默认通过阈值（与 self-train 报告口径一致；service 仍会用 config.eval.minScore 二次判定）。 */
export const TRAINING_EVALUATOR_DEFAULT_THRESHOLD = 0.3

/** 错误码。 */
export const TRAINING_EVALUATOR_CODES = Object.freeze({
  unavailable: 'TRAINING_EVALUATOR_UNAVAILABLE',
  invalidReport: 'TRAINING_EVALUATOR_INVALID_REPORT',
  readFailed: 'TRAINING_EVALUATOR_READ_FAILED',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** 解析 report.md 文本（返回 null 表示没有可用的评估信息）。 */
export function parseTrainingReport(text) {
  const raw = String(text ?? '')
  if (raw.trim().length === 0) return null
  let status = null
  let score = null
  let nonEmpty = null
  let total = null
  const reasons = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const statusMatch = /评估[：:]\s*(通过|未通过)/.exec(trimmed)
    if (statusMatch) status = statusMatch[1] === '通过' ? 'passed' : 'failed'
    if (/通过闸门/.test(trimmed)) status = 'passed'
    if (/未过闸|未通过闸门/.test(trimmed)) status = 'failed'
    const scoreMatch = /(?:期望相似度均值|平均期望相似度)\s*约?\s*([\d.]+)/.exec(trimmed)
    if (scoreMatch) score = Number(scoreMatch[1])
    const pairMatch = /(\d+)\s*\/\s*(\d+)\s*有输出/.exec(trimmed)
    if (pairMatch) {
      nonEmpty = Number(pairMatch[1])
      total = Number(pairMatch[2])
    }
  }
  if (status === null && score === null) return null
  if (status === null) reasons.push('报告未显式标注评估通过/未通过，按相似度阈值判定')
  if (score === null) reasons.push('报告未给出期望相似度均值')
  if (nonEmpty !== null && total !== null) reasons.push(`有输出 ${nonEmpty}/${total}`)
  return { status, score, nonEmpty, total, reasons }
}

/** 解析 history.log（返回 null 表示没有可用评估行）。 */
export function parseTrainingHistory(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const start = line.indexOf('{')
    if (start >= 0) {
      try {
        const parsed = JSON.parse(line.slice(start))
        if (isPlainObject(parsed) && isPlainObject(parsed.eval)) {
          const evalRecord = parsed.eval
          const avg = Number(evalRecord.avg)
          const ok = evalRecord.ok === true
          if (Number.isFinite(avg)) {
            return { status: ok ? 'passed' : 'failed', score: avg, nonEmpty: null, total: null, reasons: ['history.log 回退（report 不可用）'] }
          }
        }
      } catch (error) {
        void error
      }
    }
    const flag = /\beval=(true|false)\b/.exec(line)
    if (flag) {
      return { status: flag[1] === 'true' ? 'passed' : 'failed', score: null, nonEmpty: null, total: null, reasons: ['history.log 回退（report 不可用）'] }
    }
  }
  return null
}

/**
 * 创建训练评估器（report.md 优先，history.log 回退）。
 * @param {{
 *   reportFile?: string,
 *   historyFile?: string,
 *   threshold?: number,
 *   now?: () => number,
 *   readFile?: ((file: string) => string)|null,
 * }} [options]
 */
export function createTrainingEvaluator(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const reportFile = typeof spec.reportFile === 'string' && spec.reportFile.length > 0 ? path.resolve(spec.reportFile) : ''
  const historyFile = typeof spec.historyFile === 'string' && spec.historyFile.length > 0 ? path.resolve(spec.historyFile) : ''
  const threshold = readPositiveNumber(spec.threshold, TRAINING_EVALUATOR_DEFAULT_THRESHOLD)
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const readFile = typeof spec.readFile === 'function' ? spec.readFile : (file) => readFileSync(file, 'utf8')

  function readText(file) {
    try {
      if (file.length === 0 || !existsSync(file)) return { ok: false, text: '' }
      return { ok: true, text: readFile(file) }
    } catch (error) {
      return { ok: false, text: '', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 读取并解析当前评估结果（每次调用重新读文件；训练刚结束也能拿到最新报告）。 */
  function evaluate(input = {}) {
    const specInput = isPlainObject(input) ? input : {}
    const effectiveThreshold = readPositiveNumber(specInput.threshold, threshold)
    const report = readText(reportFile)
    let parsed = null
    let source = ''
    if (report.ok === true) {
      parsed = parseTrainingReport(report.text)
      if (parsed !== null) source = 'report'
    }
    if (parsed === null) {
      const history = readText(historyFile)
      if (history.ok === true) {
        parsed = parseTrainingHistory(history.text)
        if (parsed !== null) source = 'history'
      }
    }
    if (parsed === null) {
      return {
        ok: false,
        available: false,
        code: TRAINING_EVALUATOR_CODES.unavailable,
        message: reportFile.length === 0 && historyFile.length === 0 ? '未配置评估报告路径' : '没有可用的评估报告（不伪造通过）',
        score: null,
        passed: false,
        nonEmpty: null,
        total: null,
        reasons: [],
        source: null,
        threshold: effectiveThreshold,
        at: now(),
      }
    }
    const score = parsed.score === null ? null : Number(parsed.score)
    const passed = score !== null ? score >= effectiveThreshold : parsed.status === 'passed'
    return {
      ok: true,
      available: true,
      score,
      passed,
      nonEmpty: parsed.nonEmpty,
      total: parsed.total,
      status: parsed.status,
      reasons: parsed.reasons.slice(),
      source,
      threshold: effectiveThreshold,
      at: now(),
    }
  }

  function snapshot() {
    const current = evaluate()
    return { ok: true, version: TRAINING_EVALUATOR_VERSION, reportFile, historyFile, threshold, current }
  }

  return { version: TRAINING_EVALUATOR_VERSION, reportFile, historyFile, threshold, evaluate, snapshot }
}
