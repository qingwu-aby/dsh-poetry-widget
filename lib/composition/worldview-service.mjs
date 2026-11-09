// @ts-check
// lib/composition/worldview-service.mjs —— 世界观档案与周更（W2）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { callRole } from '../kernel/model-call.mjs'
import { buildWorldviewSynthesisPrompt, createWorldview, parseWorldviewSynthesis } from '../worldview.mjs'

export function createWorldviewService(deps) {
  const worldview = createWorldview({ file: path.join(deps.settingsDir, 'worldview.json') })

  // 让记忆摘要里也带世界观（不改变原 digest 签名）。
  const rawDigest = deps.memoryRecall.digest.bind(deps.memoryRecall)
  deps.memoryRecall.digest = (context = {}) => {
    try {
      return { ...rawDigest(context), worldview: worldview.digest() }
    } catch {
      return rawDigest(context)
    }
  }

  const synthesizeWorldview = async ({ reason = 'weekly' } = {}) => {
    try {
      const state = worldview.snapshot()
      let digest = {}
      try {
        digest = deps.memoryRecall.digest({})
      } catch {
        digest = {}
      }
      let rules = []
      try {
        const raw = JSON.parse(readFileSync(path.join(deps.settingsDir, 'methodology.json'), 'utf8'))
        rules = (Array.isArray(raw.rules) ? raw.rules : [])
          .map((item) => String(item?.statement ? item.statement : ''))
          .filter((item) => item.length > 0)
          .slice(-5)
      } catch {
        rules = []
      }
      const prompt = buildWorldviewSynthesisPrompt({
        state,
        learning: Array.isArray(digest.learned) ? digest.learned : [],
        methodology: rules,
        bookshelf: Array.isArray(digest.shelf) ? digest.shelf : [],
        selfFacts: Array.isArray(digest.selfFacts) ? digest.selfFacts : [],
        graphLines:
          typeof deps.knowledgeGraph.worldviewLines === 'function' ? deps.knowledgeGraph.worldviewLines(8) : [],
      })
      const result = await callRole('worldview', {
        attempts: [
          { maxTokens: 5000, prompt },
          { maxTokens: 8000, prompt },
        ],
        parse: parseWorldviewSynthesis,
        debugFile: path.join(deps.settingsDir, 'worldview-debug.json'),
        policy: deps.modelPolicy,
        resolveLlm: deps.getLlm,
        modelErrorsPath: deps.modelErrorsPath,
        warn: (message) => deps.logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
      const parsed = /** @type {any} */ (result.ok === true ? result.parsed : null)
      if (parsed === null) {
        deps.logger?.warn?.('[dsh-little-whale] 世界观整理没有产出可用 JSON')
        return { ok: false, reason: 'no-output', reasonTag: reason }
      }
      const applied = worldview.apply(parsed)
      const version = worldview.snapshot().essay.version
      try {
        await deps.journal.append({
          kind: 'thought',
          text: `世界观第 ${version} 版整理好了${typeof parsed.changed === 'string' && parsed.changed ? `：${parsed.changed}` : ''}`,
        })
      } catch {
        /* ignore */
      }
      deps.logger?.info?.(`[dsh-little-whale] 世界观整理：第 ${version} 版，改动 ${applied.changed} 处`)
      return { ok: true, version, changed: applied.changed }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  if (String(deps.env.DSH_POETRY_WORLDVIEW || '').toLowerCase() !== 'off') {
    let timer = setTimeout(
      async () => {
        await synthesizeWorldview({ reason: 'first' })
        timer = setInterval(() => synthesizeWorldview({ reason: 'weekly' }), 7 * 24 * 60 * 60 * 1000)
        timer.unref?.()
      },
      5 * 60 * 1000,
    )
    timer.unref?.()
    deps.disposers.push(() => {
      try {
        clearTimeout(timer)
        clearInterval(timer)
      } catch {
        /* ignore */
      }
    })
  }

  return { worldview, synthesizeWorldview }
}
