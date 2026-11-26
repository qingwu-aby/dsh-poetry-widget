import assert from 'node:assert/strict'
import test from 'node:test'
import { enforceReceiptHonesty, TOOL_CONTRACTS } from '../../lib/domain/play/minecraft-tool-contract.mjs'

test('contract：3 面墙的小屋不再算成功（今天最大的假回执）', () => {
  const liar = enforceReceiptHonesty('mc_shelter', {
    ok: true,
    detail: '小屋搭好了（四面有墙 3/4、头顶有盖、能站人、门 没有）',
    facts: { walls: 3, roof: 1 },
  })
  assert.equal(liar.ok, false)
  assert.equal(liar.corrected, true)
  assert.match(liar.note, /未达成/)

  const real = enforceReceiptHonesty('mc_shelter', { ok: true, detail: '四面有墙 4/4', facts: { walls: 4, roof: 1 } })
  assert.equal(real.ok, true)
  assert.equal(real.corrected, false)
})

test('contract：有验收过的小屋（skipped）仍然算成功', () => {
  const result = enforceReceiptHonesty('mc_shelter', { ok: true, detail: '已经有验收过的小屋', facts: { skipped: 'shelter_exists' } })
  assert.equal(result.ok, true)
})

test('contract：mc_hide 没挖动就是失败，挖到了才是成功', () => {
  assert.equal(enforceReceiptHonesty('mc_hide', { ok: true, detail: '没挖成', facts: { dug: 0 } }).ok, false)
  assert.equal(enforceReceiptHonesty('mc_hide', { ok: true, detail: '挖了 2 格', facts: { dug: 2 } }).ok, true)
})

test('contract：拿不准时不瞎改，只有描述里出现失败词才纠正', () => {
  const unknown = enforceReceiptHonesty('mc_unknown_tool', { ok: true, detail: '完成' })
  assert.equal(unknown.ok, true)
  assert.equal(unknown.corrected, false)

  const suspicious = enforceReceiptHonesty('mc_unknown_tool', { ok: true, detail: '没成功，下次再来' })
  assert.equal(suspicious.ok, false)
  assert.equal(suspicious.corrected, true)
})

test('contract：契约表覆盖造成过假回执的工具', () => {
  for (const tool of ['mc_shelter', 'mc_find', 'mc_craft', 'mc_hide', 'mc_mine', 'mc_assess', 'mc_move_to', 'mc_project']) {
    assert.equal(typeof TOOL_CONTRACTS[tool], 'function', `缺契约：${tool}`)
  }
})
