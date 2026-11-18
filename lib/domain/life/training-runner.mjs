// @ts-check
// lib/domain/life/training-runner.mjs —— 训练 runner（Gate H6，包装现有 self-train.sh）。
//
// 目标：把“训练旁路”接到真实脚本，但**默认不执行**（training-config.enabled=false；API run 还需 confirm）：
//   · 包装 ~/dsh-workspace/agent-loop/self-train.sh（路径/命令/参数/env 均可注入）；
//   · spawn 只读本地：不注入任何上传/网络相关环境变量；输出写入本地日志文件；
//   · 返回 {ok, exitCode, logFile, candidate?, artifact?}；支持 cancel(runId) kill 子进程；
//   · 失败/取消只返回结果，不修改 adapter（current 由 training-service 管理，只有 promote 才写配置）。
//
// 纯 domain：只 spawn 本地脚本 + 写日志；不联网/无宿主依赖；spawn/时钟/日志目录均可注入。

import { spawn as nodeSpawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 实现版本。 */
export const TRAINING_RUNNER_VERSION = 1

/** 默认训练脚本（与既有 self-trainer 一致）。 */
export const DEFAULT_TRAINING_SCRIPT = path.join(os.homedir(), 'dsh-workspace', 'agent-loop', 'self-train.sh')

/** 错误码。 */
export const TRAINING_RUNNER_CODES = Object.freeze({
  scriptMissing: 'TRAINING_RUNNER_SCRIPT_MISSING',
  spawnFailed: 'TRAINING_RUNNER_SPAWN_FAILED',
  alreadyRunning: 'TRAINING_RUNNER_ALREADY_RUNNING',
  notRunning: 'TRAINING_RUNNER_NOT_RUNNING',
  invalidInput: 'TRAINING_RUNNER_INVALID_INPUT',
})

const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 0

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

/**
 * 创建训练 runner（默认包装 self-train.sh；spawn 可注入便于测试）。
 * @param {{
 *   home?: string,
 *   script?: string,
 *   command?: string,
 *   args?: string[],
 *   cwd?: string,
 *   env?: Record<string, string|undefined>,
 *   logDir?: string,
 *   maxLogBytes?: number,
 *   timeoutMs?: number,
 *   spawn?: Function,
 *   now?: () => number,
 *   logger?: object|null,
 *   buildEnv?: ((input: {base: Record<string, any>, input: object}) => Record<string, any>)|null,
 *   artifactFor?: ((input: object) => string|null)|null,
 * }} [options]
 */
export function createTrainingRunner(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const home = typeof spec.home === 'string' && spec.home.length > 0 ? spec.home : os.homedir()
  const script =
    typeof spec.script === 'string' && spec.script.length > 0
      ? spec.script
      : path.join(home, 'dsh-workspace', 'agent-loop', 'self-train.sh')
  const command = typeof spec.command === 'string' && spec.command.length > 0 ? spec.command : '/bin/bash'
  const args = Array.isArray(spec.args) ? spec.args.filter((item) => typeof item === 'string') : []
  const cwd = typeof spec.cwd === 'string' && spec.cwd.length > 0 ? spec.cwd : path.dirname(path.dirname(script))
  const baseEnv = isPlainObject(spec.env) ? spec.env : process.env
  const logDir =
    typeof spec.logDir === 'string' && spec.logDir.length > 0
      ? spec.logDir
      : path.join(home, '.dsh-poetry', 'training-logs')
  const maxLogBytes = readPositiveInt(spec.maxLogBytes, DEFAULT_MAX_LOG_BYTES)
  const timeoutMs = Number.isFinite(Number(spec.timeoutMs)) && Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : DEFAULT_TIMEOUT_MS
  const spawnFn = typeof spec.spawn === 'function' ? spec.spawn : nodeSpawn
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const logger = /** @type {any} */ (spec.logger ?? null)
  const buildEnv = typeof spec.buildEnv === 'function' ? spec.buildEnv : null
  const artifactFor = typeof spec.artifactFor === 'function' ? spec.artifactFor : null
  const active = new Map()

  function log(message) {
    try {
      logger?.info?.(`[dsh-little-whale] ${message}`)
    } catch (error) {
      void error
    }
  }

  function envFor(input) {
    const runId = typeof input.runId === 'string' ? input.runId : ''
    const config = isPlainObject(input.config) ? input.config : {}
    const hyper = isPlainObject(config.hyperparams) ? config.hyperparams : {}
    const base = {
      ...baseEnv,
      DSH_TRAINING_RUN_ID: runId,
      DSH_TRAINING_SCRIPT: script,
      DSH_TRAINING_RANK: String(hyper.rank ?? ''),
      DSH_TRAINING_STEPS: String(hyper.steps ?? ''),
      DSH_TRAINING_LR: String(hyper.lr ?? ''),
    }
    if (buildEnv !== null) {
      const built = buildEnv({ base, input })
      return isPlainObject(built) ? built : base
    }
    return base
  }

  /**
   * 启动一次训练（spawn 本地脚本；不联网/不上传）。
   * @param {{runId: string, config?: object, plan?: object}} input
   */
  function run(input) {
    const specInput = isPlainObject(input) ? input : {}
    const runId = typeof specInput.runId === 'string' && specInput.runId.length > 0 ? specInput.runId : 'training-' + now()
    if (active.has(runId)) {
      return Promise.resolve(errorResult(TRAINING_RUNNER_CODES.alreadyRunning, '该 runId 已在运行', { runId, logFile: '' }))
    }
    if (!existsSync(script)) {
      return Promise.resolve(
        errorResult(TRAINING_RUNNER_CODES.scriptMissing, `训练脚本不存在：${script}`, { runId, logFile: '', exitCode: null }),
      )
    }
    try {
      mkdirSync(logDir, { recursive: true })
    } catch (error) {
      return Promise.resolve(errorResult(TRAINING_RUNNER_CODES.spawnFailed, error instanceof Error ? error.message : String(error), { runId, logFile: '' }))
    }
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    const logFile = path.join(logDir, `training-${runId}-${stamp}.log`)
    try {
      writeFileSync(logFile, '')
    } catch (error) {
      void error
    }
    let writtenBytes = 0
    const writeLog = (chunk) => {
      if (writtenBytes >= maxLogBytes) return
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        const remain = maxLogBytes - writtenBytes
        appendFileSync(logFile, buffer.length <= remain ? buffer : buffer.subarray(0, remain))
        writtenBytes += Math.min(buffer.length, remain)
      } catch (error) {
        void error
      }
    }
    return new Promise((resolve) => {
      let child = null
      let settled = false
      let cancelled = false
      let timer = null
      const finish = (payload) => {
        if (settled) return
        settled = true
        if (timer !== null) {
          try {
            clearTimeout(timer)
          } catch (error) {
            void error
          }
          timer = null
        }
        active.delete(runId)
        resolve({ ...payload, runId, logFile })
      }
      try {
        child = spawnFn(command, [script, ...args], { cwd, env: envFor(specInput), stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        finish(errorResult(TRAINING_RUNNER_CODES.spawnFailed, error instanceof Error ? error.message : String(error), { exitCode: null }))
        return
      }
      if (child === null || child === undefined) {
        finish(errorResult(TRAINING_RUNNER_CODES.spawnFailed, 'spawn 返回空 child', { exitCode: null }))
        return
      }
      active.set(runId, {
        cancel: () => {
          cancelled = true
          try {
            child.kill('SIGTERM')
          } catch (error) {
            void error
          }
        },
      })
      try {
        if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', writeLog)
        if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', writeLog)
      } catch (error) {
        void error
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cancelled = true
          try {
            child.kill('SIGKILL')
          } catch (error) {
            void error
          }
        }, timeoutMs)
        timer?.unref?.()
      }
      if (typeof child.on !== 'function') {
        finish(errorResult(TRAINING_RUNNER_CODES.spawnFailed, 'child 缺少 on 事件接口', { exitCode: null }))
        return
      }
      child.on('close', (code, signal) => {
        const exitCode = Number.isInteger(code) ? code : null
        if (cancelled || signal !== null && signal !== undefined) {
          finish({ ok: false, cancelled: true, exitCode, signal: signal ?? null, message: '训练已取消', candidate: null, artifact: null })
          return
        }
        if (exitCode !== 0) {
          finish({ ok: false, exitCode, message: `训练进程退出码 ${exitCode}`, candidate: null, artifact: null })
          return
        }
        const candidateId =
          specInput.plan && typeof specInput.plan.candidateId === 'string' && specInput.plan.candidateId.length > 0
            ? specInput.plan.candidateId
            : 'adapters-candidate-' + runId
        const artifact = artifactFor !== null ? artifactFor(specInput) : logFile
        log(`训练完成：${runId}（log=${logFile}）`)
        finish({ ok: true, exitCode: 0, candidate: { id: candidateId, path: artifact }, artifact, message: '' })
      })
      child.on('error', (error) => {
        finish(errorResult(TRAINING_RUNNER_CODES.spawnFailed, error instanceof Error ? error.message : String(error), { exitCode: null, candidate: null }))
      })
    })
  }

  /** 取消运行中的训练（kill 子进程；不修改 adapter）。 */
  function cancel(runId) {
    const entry = active.get(String(runId ?? ''))
    if (entry === undefined) return errorResult(TRAINING_RUNNER_CODES.notRunning, '没有运行中的训练进程', { runId: runId ?? null })
    entry.cancel()
    return { ok: true, cancelled: true, runId }
  }

  function snapshot() {
    return {
      ok: true,
      version: TRAINING_RUNNER_VERSION,
      script,
      command,
      logDir,
      running: [...active.keys()],
      maxLogBytes,
    }
  }

  return { run, cancel, snapshot, script, logDir }
}
