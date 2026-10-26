// lib/memory-baseline.mjs —— 记忆/状态的“空白容器”初始化（v2.6）。
//
// 归档或首次安装后，很多记忆文件不存在。memory-hub 会把「必选文件缺失」当 error、
// 「可选文件缺失」当 warn；空白容器不是编造记忆，只是让 hub 有一个健康的起点。
// 只创建缺失文件，绝不覆盖已有内容。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MEMORY_FILE_REGISTRY } from './memory-registry.mjs'
import { resolveMemoryDir } from './memory-journal.mjs'
import { resolveSettingsPath } from './settings-store.mjs'

function nowIso() {
  return new Date().toISOString()
}

const JSON_BASELINES = {
  'topics.json': () => ({ ok: true, v: 1, updatedAt: nowIso(), topics: [] }),
  'voice.json': () => ({ ok: true, v: 1, updatedAt: 0, profile: '', exemplars: [] }),
  'topics-candidates.json': () => ({ ok: true, v: 1, candidates: [] }),
  'feelings.json': () => ({ ok: true, v: 1, feelings: [] }),
  'memory-layers.json': () => ({ ok: true, v: 1, consolidatedThrough: 0, episodes: [], selfFacts: [] }),
  'self-state.json': () => ({
    v: 2,
    sleeping: false,
    sleepSince: null,
    lastWakeAt: null,
    lastMealAt: null,
    lastDrinkAt: null,
    lastPlayAt: null,
    lastSocialAt: null,
    lastLearnAt: null,
    lastReflectAt: null,
    lastActionAt: null,
    lastCheckAt: null,
    felt: '',
    feltAt: null,
    experiencing: '',
    experiencingAt: null,
    updatedAt: 0,
    learnings: 0,
    reflections: 0,
  }),
  'self-actions.json': () => ({ ok: true, v: 1, actions: [] }),
}

/** 为缺失的记忆文件创建空容器（不覆盖已有文件）。返回创建了哪些。 */
export function seedMemoryBaseline(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? null
  const logger = options.logger ?? null
  const memoryDir = resolveMemoryDir(env, home)
  const stateDir = resolveSettingsPath(env, home).dir
  const created = []
  for (const entry of MEMORY_FILE_REGISTRY) {
    let target = ''
    try {
      target = entry.path(memoryDir, stateDir)
    } catch {
      continue
    }
    if (!target || existsSync(target)) continue
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      let body = ''
      if (entry.kind === 'json' || entry.kind === 'jsonl') {
        const factory = JSON_BASELINES[entry.id]
        body = factory ? JSON.stringify(factory()) + '\n' : entry.kind === 'jsonl' ? '' : '{}\n'
      } else if (entry.id === 'README.md') {
        body = '# 小鲸鱼记忆\n\n这是她自己的记忆目录；原始记录只追加，派生物可重建。\n'
      }
      writeFileSync(target, body, 'utf8')
      created.push(entry.id)
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 记忆空白容器创建失败（${entry.id}）：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    }
  }
  return created
}
