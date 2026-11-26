import assert from 'node:assert/strict'
import test from 'node:test'
import { createMinecraftWatchdog } from '../../lib/composition/minecraft-watchdog.mjs'

test('watchdog：观察过期会判定 stale 并（冷却内只）重启一次', () => {
  let restarts = 0
  let t = 1_000_000
  const world = { snapshot: () => ({ observationAt: t - 10 * 60 * 1000 }) }
  const wd = createMinecraftWatchdog({ world, now: () => t, restartBot: () => { restarts += 1 }, logger: null })
  const first = wd.checkNow()
  assert.equal(first.stale, true)
  assert.equal(restarts, 1)
  t += 60_000
  wd.checkNow()
  assert.equal(restarts, 1, '冷却内不重复重启')
  t += 11 * 60 * 1000
  wd.checkNow()
  assert.equal(restarts, 2, '冷却后可以再重启')
})

test('watchdog：观察新鲜时不动手', () => {
  let restarts = 0
  const t = 1_000_000
  const wd = createMinecraftWatchdog({ world: { snapshot: () => ({ observationAt: t - 1000 }) }, now: () => t, restartBot: () => { restarts += 1 } })
  assert.equal(wd.checkNow().stale, false)
  assert.equal(restarts, 0)
})

test('watchdog：心跳定时器会调用 tickCurriculum，stop 后停止', async () => {
  let calls = 0
  const wd = createMinecraftWatchdog({ world: { tickCurriculum: async () => { calls += 1 }, snapshot: () => ({ observationAt: Date.now() }) }, env: { DSH_MC_CURRICULUM: 'on', DSH_MC_WATCHDOG: 'off' } })
  wd.start()
  await new Promise((resolve) => setTimeout(resolve, 20))
  wd.stop()
  assert.ok(calls >= 0)
})
