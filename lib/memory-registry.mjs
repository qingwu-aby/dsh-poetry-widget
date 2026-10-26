// lib/memory-registry.mjs —— 记忆文件的唯一登记表（v1.72，P0-2 重构）。
//
// 之前 memory-hub 和各模块各自拼记忆文件路径：加一个记忆文件要同步 hub / 各模块 /
// README / contract / 测试。这里改成一张表：id → kind / 路径公式 / 是否可选；
// memory-hub 直接遍历它，模块的 resolveXPath() 也委托到它。
// 说明：probe/wander/read/netlang 的运行状态不是“她的记忆”，留在 .dsh-poetry，不登记。
import os from 'node:os'
import path from 'node:path'
import { resolveMemoryDir } from './memory-journal.mjs'

/** 解析 $DSH_HOME（与 memory-journal 一致：DSH_HOME 优先，否则 home/.dsh）。 */
export function resolveDshHome(env = process.env, home = null) {
  const raw = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw.length > 0) return path.resolve(raw)
  const base = home ?? (typeof env?.HOME === 'string' && env.HOME.length > 0 ? env.HOME : os.homedir())
  return path.join(base, '.dsh')
}

/**
 * 记忆文件登记表。
 * path: (memoryDir, stateDir) => 绝对路径；optional: 缺失时健康检查只 warn。
 */
export const MEMORY_FILE_REGISTRY = Object.freeze([
  { id: 'journal.md', kind: 'md', optional: false, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'journal.md') },
  { id: 'journal.jsonl', kind: 'jsonl', optional: false, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'journal.jsonl') },
  { id: 'topics.json', kind: 'json', optional: false, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'topics.json') },
  { id: 'voice.json', kind: 'json', optional: true, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'voice.json') },
  { id: 'README.md', kind: 'md', optional: true, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'README.md') },
  { id: 'learning-log.md', kind: 'md', optional: true, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'learning-log.md') },
  {
    id: 'topics-candidates.json',
    kind: 'json',
    schemaVersion: 1,
    optional: true,
    path: (memoryDir) => path.join(memoryDir, 'topics-candidates.json'),
  },
  {
    id: 'topics-archive.jsonl',
    kind: 'jsonl',
    schemaVersion: 1,
    optional: true,
    path: (memoryDir) => path.join(memoryDir, 'topics-archive.jsonl'),
  },
  { id: 'feelings.json', kind: 'json', optional: true, schemaVersion: 1, path: (memoryDir) => path.join(memoryDir, 'feelings.json') },
  {
    id: 'memory-layers.json',
    kind: 'json',
    schemaVersion: 1,
    optional: true,
    path: (memoryDir) => path.join(memoryDir, 'memory-layers.json'),
  },
  {
    id: 'self-state.json',
    kind: 'json',
    schemaVersion: 2,
    optional: true,
    path: (_memoryDir, stateDir) => path.join(stateDir, 'self-state.json'),
  },
  {
    id: 'self-actions.json',
    kind: 'json',
    schemaVersion: 1,
    optional: true,
    path: (_memoryDir, stateDir) => path.join(stateDir, 'self-actions.json'),
  },
])

/** 解析整张登记表（memory-hub 使用）。 */
export function resolveMemoryRegistry(env = process.env, home = null) {
  const memoryDir = resolveMemoryDir(env, home)
  const stateDir = path.join(resolveDshHome(env, home), '.dsh-poetry')
  return {
    memoryDir,
    stateDir,
    files: MEMORY_FILE_REGISTRY.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      schemaVersion: entry.schemaVersion,
      path: entry.path(memoryDir, stateDir),
      ...(entry.optional ? { optional: true } : {}),
    })),
  }
}

/** 取单个记忆文件路径（模块 resolveXPath 使用）。 */
export function resolveMemoryFile(id, env = process.env, home = null) {
  const entry = MEMORY_FILE_REGISTRY.find((item) => item.id === id)
  if (entry === undefined) return null
  const memoryDir = resolveMemoryDir(env, home)
  const stateDir = path.join(resolveDshHome(env, home), '.dsh-poetry')
  return entry.path(memoryDir, stateDir)
}
