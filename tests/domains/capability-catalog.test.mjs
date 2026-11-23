import assert from 'node:assert/strict'
import test from 'node:test'
import { approvedCatalogNames, isCatalogTool } from '../../lib/domain/play/capability-catalog.mjs'
import { MINECRAFT_TOOLS } from '../../lib/domain/play/minecraft-world.mjs'

test('capability-catalog：预置原语目录与审批开放', () => {
  assert.equal(isCatalogTool('mc_water'), true)
  assert.equal(isCatalogTool('mc_shear'), true)
  assert.equal(isCatalogTool('mc_milk'), true)
  assert.equal(isCatalogTool('mc_find'), false)
  assert.equal(MINECRAFT_TOOLS.some((tool) => tool.name === 'mc_water'), true)
  const proposals = { list: () => ({ items: [{ capability: 'mc_water', status: 'approved' }, { capability: 'mc_feed_animal', status: 'pending' }] }) }
  const approved = approvedCatalogNames(proposals)
  assert.equal(approved.has('mc_water'), true)
  assert.equal(approved.has('mc_feed_animal'), false)
})
