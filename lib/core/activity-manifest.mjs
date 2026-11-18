// lib/core/activity-manifest.mjs —— Activity manifest 契约与校验（Gate A3，纯函数、无宿主依赖）。
//
// 目的：在 Hub/Activity SDK 之前先把“不可信边界”写成可校验的契约。
//   · manifest 描述一个 Activity 的 id/version/事件/任务/工具/权限/资源；
//   · 权限枚举固定为 fs.read / fs.write / net / model / tool，默认拒绝（未声明 = 无权限）；
//   · 权限可带 scope（如 `fs.read:~/Books`、`net:api.example.com`、`tool:book.open`）；
//   · 本模块只做“契约与校验”，不执行真实权限系统（执行在 Gate D 的 Activity Registry）。
//
// 设计约定：
//   · 未知顶层字段允许（向前兼容），但必填字段缺失/类型错误/越权权限一律拒绝；
//   · 校验尽量收集全部错误（errors[]），便于 Activity 作者一次改完；
//   · scope 匹配：未带 scope 的授权覆盖整个权限；带 scope 的授权只覆盖
//     fs.* 的路径前缀（`~/Books` 覆盖 `~/Books/a.md`），其余权限要求精确匹配；
//   · 纯函数：不读盘、不联网、无宿主依赖，事件/写盘由调用方负责。

/** manifest schema 版本。 */
export const ACTIVITY_MANIFEST_SCHEMA_VERSION = 1

/** 权限枚举（默认拒绝：未声明的权限一律不可用）。 */
export const ACTIVITY_PERMISSIONS = Object.freeze(['fs.read', 'fs.write', 'net', 'model', 'tool'])

/** 权限中文说明（供 docs/UI 复用，保持单一来源）。 */
export const ACTIVITY_PERMISSION_LABELS = Object.freeze({
  'fs.read': '读取本机文件',
  'fs.write': '写入本机文件',
  net: '访问网络',
  model: '调用模型',
  tool: '调用工具',
})

/** world 隔离方式。 */
export const ACTIVITY_WORLD_ISOLATIONS = Object.freeze(['process', 'thread', 'inproc'])

/** 数量/长度上限（防 manifest 膨胀成攻击面）。 */
export const ACTIVITY_MANIFEST_LIMITS = Object.freeze({
  idMax: 40,
  versionMax: 32,
  nameMax: 40,
  eventsMax: 64,
  eventNameMax: 80,
  tasksMax: 32,
  toolsMax: 64,
  toolNameMax: 80,
  permissionsMax: 32,
  permissionScopeMax: 200,
  goalMax: 200,
  successMax: 200,
  maxMinutesMax: 24 * 60,
})

/** 可识别错误码。 */
export const ACTIVITY_MANIFEST_ERROR_CODES = Object.freeze({
  invalidType: 'MANIFEST_INVALID_TYPE',
  missingField: 'MANIFEST_MISSING_FIELD',
  invalidValue: 'MANIFEST_INVALID_VALUE',
  unknownPermission: 'MANIFEST_UNKNOWN_PERMISSION',
  invalidPermission: 'MANIFEST_INVALID_PERMISSION',
  duplicateEntry: 'MANIFEST_DUPLICATE_ENTRY',
  tooManyEntries: 'MANIFEST_TOO_MANY_ENTRIES',
})

/** 权限判定结果原因。 */
export const PERMISSION_REASONS = Object.freeze({
  granted: 'granted',
  noManifest: 'no-manifest',
  notGranted: 'not-granted',
  invalidPermission: 'invalid-permission',
  scopeRequired: 'scope-required',
})

const ID_PATTERN = /^[a-z][a-z0-9-]{2,39}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const EVENT_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9_-]+)+$/
const TOOL_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorEntry(path, code, message) {
  return { path, code, message }
}

function isBoundedString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !CONTROL_CHARS.test(value)
}

/** 权限字符串是否合法（含 scope 语法）。 */
export function isActivityPermission(value) {
  return parseActivityPermission(value).ok === true
}

/**
 * 解析权限字符串：`fs.read` 或 `fs.read:~/Books`。
 * @returns {{ok: true, permission: {permission: string, scope: string|null, raw: string}} | {ok: false, code: string, message: string}}
 */
export function parseActivityPermission(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, code: ACTIVITY_MANIFEST_ERROR_CODES.invalidType, message: '权限必须是字符串' }
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, code: ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, message: '权限不能为空' }
  }
  if (trimmed.length > ACTIVITY_MANIFEST_LIMITS.permissionScopeMax + 20) {
    return { ok: false, code: ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, message: `权限字符串过长：${trimmed.length}` }
  }
  const colon = trimmed.indexOf(':')
  const permission = colon < 0 ? trimmed : trimmed.slice(0, colon).trim()
  if (ACTIVITY_PERMISSIONS.indexOf(permission) < 0) {
    return {
      ok: false,
      code: ACTIVITY_MANIFEST_ERROR_CODES.unknownPermission,
      message: `未知权限「${permission}」，只允许：${ACTIVITY_PERMISSIONS.join(' / ')}`,
    }
  }
  const scope = colon < 0 ? '' : trimmed.slice(colon + 1).trim()
  if (colon >= 0 && scope.length === 0) {
    return {
      ok: false,
      code: ACTIVITY_MANIFEST_ERROR_CODES.invalidPermission,
      message: `权限「${permission}」的 scope 为空（写成「${permission}:<scope>」或省略冒号）`,
    }
  }
  if (scope.length > ACTIVITY_MANIFEST_LIMITS.permissionScopeMax) {
    return {
      ok: false,
      code: ACTIVITY_MANIFEST_ERROR_CODES.invalidValue,
      message: `权限 scope 过长（>${ACTIVITY_MANIFEST_LIMITS.permissionScopeMax}）`,
    }
  }
  if (CONTROL_CHARS.test(scope)) {
    return { ok: false, code: ACTIVITY_MANIFEST_ERROR_CODES.invalidPermission, message: '权限 scope 含控制字符' }
  }
  return { ok: true, permission: { permission, scope: scope.length > 0 ? scope : null, raw: trimmed } }
}

function normalizeStringList(raw, path, errors, options) {
  const list = []
  if (!Array.isArray(raw)) {
    errors.push(errorEntry(path, ACTIVITY_MANIFEST_ERROR_CODES.invalidType, `${path} 必须是数组`))
    return list
  }
  if (raw.length > options.max) {
    errors.push(
      errorEntry(path, ACTIVITY_MANIFEST_ERROR_CODES.tooManyEntries, `${path} 最多 ${options.max} 项（当前 ${raw.length}）`),
    )
  }
  const seen = new Set()
  raw.slice(0, options.max).forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (typeof item !== 'string') {
      errors.push(errorEntry(itemPath, ACTIVITY_MANIFEST_ERROR_CODES.invalidType, `${itemPath} 必须是字符串`))
      return
    }
    const value = item.trim()
    if (!isBoundedString(value, options.maxLength) || !options.pattern.test(value)) {
      errors.push(errorEntry(itemPath, ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, `${itemPath} 命名不合法：${value}`))
      return
    }
    if (seen.has(value)) {
      errors.push(errorEntry(itemPath, ACTIVITY_MANIFEST_ERROR_CODES.duplicateEntry, `${itemPath} 重复：${value}`))
      return
    }
    seen.add(value)
    list.push(value)
  })
  return list
}

function normalizeTasks(raw, errors) {
  const tasks = []
  if (!Array.isArray(raw)) {
    errors.push(errorEntry('tasks', ACTIVITY_MANIFEST_ERROR_CODES.invalidType, 'tasks 必须是数组'))
    return tasks
  }
  if (raw.length > ACTIVITY_MANIFEST_LIMITS.tasksMax) {
    errors.push(
      errorEntry(
        'tasks',
        ACTIVITY_MANIFEST_ERROR_CODES.tooManyEntries,
        `tasks 最多 ${ACTIVITY_MANIFEST_LIMITS.tasksMax} 项（当前 ${raw.length}）`,
      ),
    )
  }
  const seenKinds = new Set()
  raw.slice(0, ACTIVITY_MANIFEST_LIMITS.tasksMax).forEach((item, index) => {
    const path = `tasks[${index}]`
    if (!isPlainObject(item)) {
      errors.push(errorEntry(path, ACTIVITY_MANIFEST_ERROR_CODES.invalidType, `${path} 必须是对象`))
      return
    }
    if (!isBoundedString(item.kind, ACTIVITY_MANIFEST_LIMITS.toolNameMax) || !TOOL_PATTERN.test(item.kind.trim())) {
      errors.push(errorEntry(`${path}.kind`, ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, `${path}.kind 命名不合法`))
      return
    }
    const kind = item.kind.trim()
    if (seenKinds.has(kind)) {
      errors.push(errorEntry(`${path}.kind`, ACTIVITY_MANIFEST_ERROR_CODES.duplicateEntry, `tasks 的 kind 重复：${kind}`))
      return
    }
    seenKinds.add(kind)
    if (!isBoundedString(item.goal, ACTIVITY_MANIFEST_LIMITS.goalMax)) {
      errors.push(errorEntry(`${path}.goal`, ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, `${path}.goal 必须是 1–200 字字符串`))
      return
    }
    let priority = 0
    if (item.priority !== undefined) {
      const n = Number(item.priority)
      if (!Number.isFinite(n) || n < -100 || n > 100) {
        errors.push(errorEntry(`${path}.priority`, ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, `${path}.priority 必须是 -100..100`))
        return
      }
      priority = Math.trunc(n)
    }
    let success = ''
    if (item.success !== undefined) {
      if (!isBoundedString(item.success, ACTIVITY_MANIFEST_LIMITS.successMax)) {
        errors.push(errorEntry(`${path}.success`, ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, `${path}.success 必须是 1–200 字字符串`))
        return
      }
      success = item.success.trim()
    }
    tasks.push({ kind, goal: item.goal.trim(), priority, success })
  })
  return tasks
}

function normalizePermissions(raw, errors) {
  const permissions = []
  if (!Array.isArray(raw)) {
    errors.push(errorEntry('permissions', ACTIVITY_MANIFEST_ERROR_CODES.invalidType, 'permissions 必须是数组（无权限请写 []）'))
    return permissions
  }
  if (raw.length > ACTIVITY_MANIFEST_LIMITS.permissionsMax) {
    errors.push(
      errorEntry(
        'permissions',
        ACTIVITY_MANIFEST_ERROR_CODES.tooManyEntries,
        `permissions 最多 ${ACTIVITY_MANIFEST_LIMITS.permissionsMax} 项（当前 ${raw.length}）`,
      ),
    )
  }
  const seen = new Set()
  raw.slice(0, ACTIVITY_MANIFEST_LIMITS.permissionsMax).forEach((item, index) => {
    const path = `permissions[${index}]`
    const parsed = parseActivityPermission(item)
    if (!parsed.ok) {
      errors.push(errorEntry(path, parsed.code, `${path}：${parsed.message}`))
      return
    }
    if (seen.has(parsed.permission.raw)) {
      errors.push(errorEntry(path, ACTIVITY_MANIFEST_ERROR_CODES.duplicateEntry, `${path} 重复：${parsed.permission.raw}`))
      return
    }
    seen.add(parsed.permission.raw)
    permissions.push(parsed.permission)
  })
  return permissions
}

function normalizeResources(raw, errors) {
  const resources = { model: false, foreground: false, maxMinutes: 60 }
  if (!isPlainObject(raw)) {
    errors.push(errorEntry('resources', ACTIVITY_MANIFEST_ERROR_CODES.invalidType, 'resources 必须是对象'))
    return resources
  }
  for (const key of ['model', 'foreground']) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') {
        errors.push(errorEntry(`resources.${key}`, ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, `resources.${key} 必须是布尔`))
      } else {
        resources[key] = raw[key]
      }
    }
  }
  if (raw.maxMinutes !== undefined) {
    const n = Number(raw.maxMinutes)
    if (!Number.isFinite(n) || n <= 0 || n > ACTIVITY_MANIFEST_LIMITS.maxMinutesMax) {
      errors.push(
        errorEntry(
          'resources.maxMinutes',
          ACTIVITY_MANIFEST_ERROR_CODES.invalidValue,
          `resources.maxMinutes 必须是 1..${ACTIVITY_MANIFEST_LIMITS.maxMinutesMax}`,
        ),
      )
    } else {
      resources.maxMinutes = Math.floor(n)
    }
  }
  return resources
}

function normalizeWorld(raw, errors) {
  if (raw === undefined) return null
  if (!isPlainObject(raw)) {
    errors.push(errorEntry('world', ACTIVITY_MANIFEST_ERROR_CODES.invalidType, 'world 必须是对象'))
    return null
  }
  let entry = null
  if (raw.entry !== undefined) {
    if (!isBoundedString(raw.entry, 200)) {
      errors.push(errorEntry('world.entry', ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, 'world.entry 必须是 1–200 字字符串'))
    } else {
      entry = raw.entry.trim()
    }
  }
  let isolate = 'process'
  if (raw.isolate !== undefined) {
    if (ACTIVITY_WORLD_ISOLATIONS.indexOf(raw.isolate) < 0) {
      errors.push(
        errorEntry(
          'world.isolate',
          ACTIVITY_MANIFEST_ERROR_CODES.invalidValue,
          `world.isolate 只允许：${ACTIVITY_WORLD_ISOLATIONS.join(' / ')}`,
        ),
      )
    } else {
      isolate = raw.isolate
    }
  }
  let health = null
  if (raw.health !== undefined) {
    if (!isBoundedString(raw.health, 120)) {
      errors.push(errorEntry('world.health', ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, 'world.health 必须是 1–120 字字符串'))
    } else {
      health = raw.health.trim()
    }
  }
  return { entry, isolate, health }
}

/**
 * 校验 Activity manifest。
 * @param {unknown} raw
 * @returns {{ok: true, manifest: object, errors: []} | {ok: false, manifest: null, errors: Array<{path: string, code: string, message: string}>}}
 */
export function validateActivityManifest(raw) {
  const errors = []
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      manifest: null,
      errors: [errorEntry('$', ACTIVITY_MANIFEST_ERROR_CODES.invalidType, 'manifest 必须是对象')],
    }
  }
  for (const field of ['id', 'version', 'events', 'tasks', 'tools', 'permissions', 'resources']) {
    if (!Object.hasOwn(raw, field)) {
      errors.push(errorEntry(field, ACTIVITY_MANIFEST_ERROR_CODES.missingField, `缺少必填字段：${field}`))
    }
  }

  let id = ''
  if (raw.id !== undefined) {
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id.trim())) {
      errors.push(
        errorEntry('id', ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, 'id 必须是小写字母开头的 3–40 位小写字母/数字/连字符'),
      )
    } else {
      id = raw.id.trim()
    }
  }

  let version = ''
  if (raw.version !== undefined) {
    if (
      typeof raw.version !== 'string' ||
      raw.version.length > ACTIVITY_MANIFEST_LIMITS.versionMax ||
      !VERSION_PATTERN.test(raw.version.trim())
    ) {
      errors.push(errorEntry('version', ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, 'version 必须是语义化版本，如 1.0.0'))
    } else {
      version = raw.version.trim()
    }
  }

  let name = id
  if (raw.name !== undefined) {
    if (!isBoundedString(raw.name, ACTIVITY_MANIFEST_LIMITS.nameMax)) {
      errors.push(errorEntry('name', ACTIVITY_MANIFEST_ERROR_CODES.invalidValue, 'name 必须是 1–40 字字符串'))
    } else {
      name = raw.name.trim()
    }
  }

  const events = normalizeStringList(raw.events, 'events', errors, {
    max: ACTIVITY_MANIFEST_LIMITS.eventsMax,
    maxLength: ACTIVITY_MANIFEST_LIMITS.eventNameMax,
    pattern: EVENT_PATTERN,
  })
  const tools = normalizeStringList(raw.tools, 'tools', errors, {
    max: ACTIVITY_MANIFEST_LIMITS.toolsMax,
    maxLength: ACTIVITY_MANIFEST_LIMITS.toolNameMax,
    pattern: TOOL_PATTERN,
  })
  const tasks = normalizeTasks(raw.tasks, errors)
  const permissions = normalizePermissions(raw.permissions, errors)
  const resources = normalizeResources(raw.resources, errors)
  const world = normalizeWorld(raw.world, errors)

  if (errors.length > 0) return { ok: false, manifest: null, errors }

  return {
    ok: true,
    errors: [],
    manifest: {
      schemaVersion: ACTIVITY_MANIFEST_SCHEMA_VERSION,
      id,
      version,
      name,
      world,
      events,
      tasks,
      tools,
      permissions,
      resources,
    },
  }
}

function permissionEntriesOf(source) {
  if (source === null || source === undefined || typeof source !== 'object') return []
  const list = Array.isArray(source.permissions) ? source.permissions : []
  const entries = []
  for (const item of list) {
    if (isPlainObject(item) && typeof item.permission === 'string') {
      entries.push({ permission: item.permission, scope: typeof item.scope === 'string' ? item.scope : null, raw: item.raw ?? '' })
      continue
    }
    const parsed = parseActivityPermission(item)
    if (parsed.ok) entries.push(parsed.permission)
  }
  return entries
}

function scopeMatches(permission, grantedScope, requestedScope) {
  if (grantedScope === null) return true
  if (requestedScope === null) return false
  if (permission.startsWith('fs.')) {
    if (grantedScope === requestedScope) return true
    const prefix = grantedScope.endsWith('/') ? grantedScope : grantedScope + '/'
    return requestedScope.startsWith(prefix)
  }
  return grantedScope === requestedScope
}

/**
 * 权限判定（默认拒绝）：未声明的权限、未声明 scope 的受控权限、非法请求一律拒绝。
 * @param {unknown} manifest 已校验 manifest（也接受原始含 permissions 数组的对象；非法条目按未授权处理）
 * @param {string} request 形如 `fs.read` 或 `fs.read:~/Books/a.md`
 * @returns {{allowed: boolean, reason: string, permission: string, scope: string|null}}
 */
export function checkActivityPermission(manifest, request) {
  const parsed = parseActivityPermission(request)
  if (!parsed.ok) {
    return { allowed: false, reason: PERMISSION_REASONS.invalidPermission, permission: '', scope: null }
  }
  const requested = parsed.permission
  if (manifest === null || manifest === undefined) {
    return { allowed: false, reason: PERMISSION_REASONS.noManifest, permission: requested.permission, scope: requested.scope }
  }
  const entries = permissionEntriesOf(manifest)
  if (entries.length === 0) {
    return { allowed: false, reason: PERMISSION_REASONS.notGranted, permission: requested.permission, scope: requested.scope }
  }
  for (const granted of entries) {
    if (granted.permission !== requested.permission) continue
    if (scopeMatches(granted.permission, granted.scope, requested.scope)) {
      return { allowed: true, reason: PERMISSION_REASONS.granted, permission: requested.permission, scope: requested.scope }
    }
  }
  const hasScopedGrant = entries.some(
    (granted) => granted.permission === requested.permission && granted.scope !== null,
  )
  return {
    allowed: false,
    reason: hasScopedGrant && requested.scope === null ? PERMISSION_REASONS.scopeRequired : PERMISSION_REASONS.notGranted,
    permission: requested.permission,
    scope: requested.scope,
  }
}

/** 列出 manifest 声明过的权限（归一化，便于 UI/日志展示）。 */
export function listActivityPermissions(manifest) {
  return permissionEntriesOf(manifest).map((item) => ({ ...item }))
}

/** 便于 UI/文档展示的权限摘要。 */
export function describeActivityPermissions(manifest) {
  return listActivityPermissions(manifest).map((item) => ({
    ...item,
    label: ACTIVITY_PERMISSION_LABELS[item.permission] ?? item.permission,
  }))
}
