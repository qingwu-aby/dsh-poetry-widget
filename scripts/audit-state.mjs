#!/usr/bin/env node
// 状态审计：对比 state-specs 与 $DSH_HOME/.dsh-poetry 下实际 JSON 文件，列出未注册项。
// 只读；不迁移、不写盘。用法：node scripts/audit-state.mjs
import { readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateSpecs } from '../lib/composition/state-specs.mjs'

const home = os.homedir()
const dir = path.join(home, '.dsh', '.dsh-poetry')
const specs = createStateSpecs(dir, { env: process.env, home })
const known = new Set(specs.map((spec) => path.basename(spec.file)))
const actual = readdirSync(dir).filter((name) => name.endsWith('.json'))
const unregistered = actual.filter((name) => !known.has(name))
console.log(`状态审计：${specs.length} 个已注册 / ${actual.length} 个实际 JSON`)
console.log(unregistered.length === 0 ? '全部已注册' : `未注册：${unregistered.join('、')}`)
process.exitCode = unregistered.filter((name) => name !== 'settings.json').length > 0 ? 1 : 0
