// @ts-check
// lib/core/activity-permission-guard.mjs —— Activity 权限执行守卫（Gate N1，纯判定，不执行真实 fs/net）。
//
// grants 文件：$DSH_HOME/.dsh-poetry/activity-grants.json（activityId → [{permission, scope}]），默认空。
// 默认策略：
//   · manifest 声明的 tool / model → 基线可用（不需要 grant）；
//   · fs.read / fs.write / net → 必须在 grants 中显式授权（scope 匹配）；
//   · manifest 未声明的权限 → 一律拒绝；其余权限（非 tool/model）同样需要授权。
// check(request) → {allowed, reason, permission, scope}；grant/revoke/list/save 原子写；坏文件降级为空。
// 只做判定：不读用户文件、不联网、不执行任何动作。

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 实现版本。 */
export const ACTIVITY_PERMISSION_GUARD_VERSION = 1

/** 无需 grant 的基线权限。 */
export const ACTIVITY_BASELINE_PERMISSIONS = Object.freeze(['tool', 'model'])

/** 需要显式 grant 的敏感权限（默认拒绝）。 */
export const ACTIVITY_SENSITIVE_PERMISSIONS = Object.freeze(['fs.read', 'fs.write', 'net'])

/** 错误码。 */
export const ACTIVITY_PERMISSION_GUARD_CODES = Object.freeze({
  invalidInput: 'ACTIVITY_GRANT_INVALID_INPUT',
  denied: 'ACTIVITY_PERMISSION_DENIED',
  writeFailed: 'ACTIVITY_GRANT_WRITE_FAILED',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clean(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeScope(value) {
  const scope = clean(value, 500)
  return scope.length > 0 ? scope : null
}

/** 从 manifest.permissions（字符串或 {permission,scope}）提取声明。 */
export function declaredActivityPermissions(manifest) {
  const out = []
  if (!isPlainObject(manifest) || !Array.isArray(manifest.permissions)) return out
  for (const item of manifest.permissions) {
    if (typeof item === 'string' && item.length > 0) out.push({ permission: clean(item, 80), scope: null })
    else if (isPlainObject(item) && typeof item.permission === 'string' && item.permission.length > 0) {
      out.push({ permission: clean(item.permission, 80), scope: normalizeScope(item.scope) })
    }
  }
  return out
}

function scopeMatches(grantScope, requestScope, declaredScope) {
  const request = normalizeScope(requestScope)
  if (declaredScope !== null && declaredScope !== '*') {
    if (request === null || !(request === declaredScope || request.startsWith(declaredScope))) return false
  }
  const grant = normalizeScope(grantScope)
  if (grant === null || grant === '*') return true
  if (request === null) return false
  return request === grant || request.startsWith(grant)
}

/** 原子写 grants 文件（临时文件 + rename，0600）。 */
function writeAtomic(file, content) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
    return { ok: true }
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch (cleanupError) {
      void cleanupError
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 创建 Activity 权限守卫。
 * @param {{file: string, now?: () => number, logger?: object|null, readFile?: ((file: string) => string)|null}} options
 */
export function createActivityPermissionGuard(options) {
  const spec = isPlainObject(options) ? options : {}
  const file = typeof spec.file === 'string' && spec.file.length > 0 ? spec.file : ''
  if (file.length === 0) throw new TypeError('createActivityPermissionGuard 需要 file')
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const logger = /** @type {any} */ (spec.logger ?? null)
  const readFile = typeof spec.readFile === 'function' ? spec.readFile : (target) => readFileSync(target, 'utf8')
  const errors = []
  /** activityId → [{permission, scope}] */
  const grants = new Map()

  function load() {
    errors.length = 0
    grants.clear()
    if (!existsSync(file)) return { ok: true, loaded: 0 }
    let parsed = null
    try {
      parsed = JSON.parse(readFile(file))
    } catch (error) {
      errors.push({ path: '$', message: error instanceof Error ? error.message : String(error) })
      return { ok: false, loaded: 0 }
    }
    if (!isPlainObject(parsed)) {
      errors.push({ path: '$', message: 'grants 文件必须是对象' })
      return { ok: false, loaded: 0 }
    }
    const source = isPlainObject(parsed.grants) ? parsed.grants : parsed
    let loaded = 0
    for (const [activityId, list] of Object.entries(source)) {
      if (!Array.isArray(list)) continue
      const entries = []
      for (const item of list) {
        if (!isPlainObject(item) || typeof item.permission !== 'string' || item.permission.length === 0) continue
        entries.push({ permission: clean(item.permission, 80), scope: normalizeScope(item.scope) })
        loaded += 1
      }
      if (entries.length > 0) grants.set(clean(activityId, 80), entries)
    }
    return { ok: true, loaded }
  }

  function snapshotGrants() {
    const out = {}
    for (const [activityId, list] of grants.entries()) out[activityId] = list.map((entry) => ({ ...entry }))
    return out
  }

  function save() {
    const payload = { version: ACTIVITY_PERMISSION_GUARD_VERSION, savedAt: now(), grants: snapshotGrants() }
    const written = writeAtomic(file, JSON.stringify(payload, null, 2) + '\n')
    if (written.ok !== true) {
      try {
        logger?.warn?.(`[dsh-little-whale] activity grants 写入失败：${written.message ?? ''}`)
      } catch (error) {
        void error
      }
    }
    return written
  }

  /** 判定权限请求（不执行动作）。 */
  function check(request) {
    const specRequest = isPlainObject(request) ? request : {}
    const activityId = clean(specRequest.activityId, 80)
    const permission = clean(specRequest.permission, 80)
    const scope = normalizeScope(specRequest.scope)
    if (activityId.length === 0 || permission.length === 0) {
      return { allowed: false, reason: 'invalid-request', permission, scope }
    }
    const declared = declaredActivityPermissions(specRequest.manifest)
    if (declared.length === 0) return { allowed: false, reason: 'no-manifest-permissions', permission, scope }
    const declaration = declared.find((item) => item.permission === permission)
    if (declaration === undefined) return { allowed: false, reason: 'not-declared', permission, scope }
    if (declaration.scope !== null && !scopeMatches(null, scope, declaration.scope)) {
      return { allowed: false, reason: 'outside-declared-scope', permission, scope }
    }
    if (ACTIVITY_BASELINE_PERMISSIONS.indexOf(permission) >= 0) {
      return { allowed: true, reason: 'baseline', permission, scope }
    }
    const list = grants.get(activityId) ?? []
    const granted = list.find((entry) => entry.permission === permission && scopeMatches(entry.scope, scope, declaration.scope))
    if (granted === undefined) return { allowed: false, reason: 'not-granted', permission, scope }
    return { allowed: true, reason: 'granted', permission, scope }
  }

  /** 授权（activityId + permission[+scope]）；返回 {ok}。 */
  function grant(activityId, permission, scope) {
    const id = clean(activityId, 80)
    const perm = clean(permission, 80)
    if (id.length === 0 || perm.length === 0) return { ok: false, code: ACTIVITY_PERMISSION_GUARD_CODES.invalidInput, message: '需要 activityId/permission' }
    const list = grants.get(id) ?? []
    const normalizedScope = normalizeScope(scope)
    const existing = list.find((entry) => entry.permission === perm && entry.scope === normalizedScope)
    if (existing === undefined) list.push({ permission: perm, scope: normalizedScope })
    grants.set(id, list)
    const written = save()
    return written.ok === true ? { ok: true, activityId: id, permission: perm, scope: normalizedScope, savedAt: now() } : { ok: false, code: ACTIVITY_PERMISSION_GUARD_CODES.writeFailed, message: written.message }
  }

  /** 撤销授权（不传 permission 则撤销该 activity 全部授权）。 */
  function revoke(activityId, permission, scope) {
    const id = clean(activityId, 80)
    const perm = clean(permission, 80)
    const list = grants.get(id)
    if (id.length === 0 || list === undefined) return { ok: true, removed: 0 }
    let removed = 0
    const keep = []
    for (const entry of list) {
      const matchPermission = perm.length === 0 || entry.permission === perm
      const matchScope = scope === undefined || entry.scope === normalizeScope(scope)
      if (matchPermission && matchScope) {
        removed += 1
        continue
      }
      keep.push(entry)
    }
    if (keep.length === 0) grants.delete(id)
    else grants.set(id, keep)
    if (removed > 0) save()
    return { ok: true, removed }
  }

  function list(filter = {}) {
    const specFilter = isPlainObject(filter) ? filter : {}
    const out = []
    for (const [activityId, entries] of grants.entries()) {
      if (typeof specFilter.activityId === 'string' && specFilter.activityId.length > 0 && specFilter.activityId !== activityId) continue
      for (const entry of entries) out.push({ activityId, permission: entry.permission, scope: entry.scope })
    }
    return out
  }

  function snapshot() {
    return {
      ok: true,
      version: ACTIVITY_PERMISSION_GUARD_VERSION,
      file,
      exists: existsSync(file),
      activities: grants.size,
      entries: list({}).length,
      grants: snapshotGrants(),
      errors: errors.slice(),
      now: now(),
    }
  }

  const loaded = load()
  if (loaded.ok !== true) {
    try {
      logger?.warn?.('[dsh-little-whale] activity grants 文件损坏，已按空授权处理')
    } catch (error) {
      void error
    }
  }

  return { version: ACTIVITY_PERMISSION_GUARD_VERSION, file, check, grant, revoke, list, save, snapshot, reload: load }
}

/**
 * Hub 执行前检查：对有 manifest 的 activity，逐个检查声明的非基线权限（fs / net 等）。
 * 返回 null 表示放行；否则返回 HUB_PERMISSION_DENIED 结构。
 * @param {object|null} hubRuntime
 * @param {string} activityId
 * @param {object} payload
 */
export function checkHubActivityPermission(hubRuntime, activityId, payload) {
  const runtime = /** @type {any} */ (hubRuntime)
  if (runtime === null || runtime === undefined || typeof runtime.checkPermission !== 'function') return null
  const adapter = typeof runtime.getAdapter === 'function' ? runtime.getAdapter(activityId) : null
  const manifest = isPlainObject(adapter) && isPlainObject(adapter.manifest) ? adapter.manifest : null
  if (manifest === null) return null
  const request = /** @type {Record<string, any>} */ (isPlainObject(payload) ? payload : {})
  for (const declared of declaredActivityPermissions(manifest)) {
    if (ACTIVITY_BASELINE_PERMISSIONS.indexOf(declared.permission) >= 0) continue
    let scope = null
    if (declared.permission === 'fs.read' || declared.permission === 'fs.write') scope = request.path ?? request.file ?? request.dir ?? null
    else if (declared.permission === 'net') scope = request.url ?? request.host ?? null
    else scope = request.scope ?? null
    const result = runtime.checkPermission({ activityId, manifest, permission: declared.permission, scope })
    if (result === null || result === undefined || result.allowed !== true) {
      const reason = result !== null && result !== undefined && typeof result.reason === 'string' ? result.reason : 'denied'
      return {
        ok: false,
        code: 'HUB_PERMISSION_DENIED',
        message: `Activity ${activityId} 缺少权限 ${declared.permission}${scope === null ? '' : '（' + scope + '）'}：${reason}`,
        activityId,
        permission: declared.permission,
        scope,
        reason,
      }
    }
  }
  return null
}
