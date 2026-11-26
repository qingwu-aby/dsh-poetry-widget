// @ts-check
// 工具契约：每个工具“什么算成功”的唯一判定。回执撒谎时由这里兜底。
// 约定：receipt.ok 必须与 contract 判定一致；不一致时以契约为准，并标注未达成。

const PARTIAL_WORDS = /没成功|失败|残的|没有装|开挖 0|没走到|不需要重复|不好往下挖/

/** 各工具的 ok 判定（返回 true/false；拿不准返回 null 表示不裁决）。 */
export const TOOL_CONTRACTS = {
  mc_shelter: (facts) => {
    if (!facts || typeof facts !== 'object') return null
    if (facts.skipped === 'shelter_exists') return true          // 已有验收过的屋子也是有效结果
    const walls = Number(facts.walls)
    const roof = Number(facts.roof)
    if (!Number.isFinite(walls) || !Number.isFinite(roof)) return null
    // 必须四面墙（或至少 4/4 记录）+ 有顶 才算建成；3 面墙不算
    return walls >= 4 && roof >= 1
  },
  mc_find: (facts) => (facts && Number.isFinite(Number(facts.distance ?? NaN)) || facts && typeof facts.at === 'string' ? true : null),
  mc_craft: (facts) => (facts && (facts.item || facts.already === true) ? true : null),
  mc_hide: (facts) => {
    if (!facts || !Number.isFinite(Number(facts.dug))) return null
    return Number(facts.dug) > 0
  },
  mc_mine: (facts) => (facts && (facts.collected === true || facts.mined === true) ? true : null),
  mc_project: (facts) => (facts && typeof facts.action === 'string' ? !/unknown_action/.test(String(facts.error || '')) : null),
  mc_assess: (facts) => (facts && Number.isFinite(Number(facts.score)) ? true : null),
  mc_move_to: (facts) => (facts && Number.isFinite(Number(facts.distance ?? NaN)) ? Number(facts.distance) <= 4 : null),
}

/**
 * 诚实守卫：确保 ok 与契约一致。
 * 返回 { ok, corrected, note }。corrected=true 表示原来撒谎了，被纠正。
 */
export function enforceReceiptHonesty(tool, receipt) {
  const payload = receipt && typeof receipt === 'object' ? receipt : {}
  const facts = payload.facts && typeof payload.facts === 'object' ? payload.facts : {}
  const detail = String(payload.detail || '')
  const claimed = payload.ok === true
  const rule = TOOL_CONTRACTS[tool]
  let verdict = rule ? rule(facts) : null
  // 契约无法裁决时，退化为“描述里出现失败词就算失败”
  if (verdict === null && claimed && PARTIAL_WORDS.test(detail)) verdict = false
  if (verdict === null) return { ok: claimed, corrected: false, note: '' }
  if (claimed === verdict) return { ok: claimed, corrected: false, note: '' }
  const note = verdict ? '（按契约补正为成功）' : '（未达成，按契约记为失败）'
  return { ok: verdict, corrected: true, note }
}
