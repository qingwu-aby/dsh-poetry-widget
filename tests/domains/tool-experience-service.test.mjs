import assert from 'node:assert/strict'
import test from 'node:test'
import { skillContextForActivity, skillHintLines } from '../../lib/core/tool-experience-service.mjs'

test('tool-experience-service：不同 Activity 的情境特征', () => {
  assert.deepEqual(skillContextForActivity('reading', { arguments: { path: 'a.md', page: 2 } }), { hasPath: true, hasPage: true, hasNote: false })
  assert.equal(skillContextForActivity('study', { arguments: { question: 'why' } }).hasQuestion, true)
  assert.equal(skillContextForActivity('video', { arguments: { url: 'https://x' } }).hasUrl, true)
  assert.equal(skillContextForActivity('chat', { peerId: 'u1' }).hasPeer, true)
})

test('tool-experience-service：经验提示只读指定 scope', () => {
  const fake = { summary: ({ scope }) => scope === 'activity:study' ? [{ tool: 'study.search', success: 4, attempts: 5, rate: 0.8 }] : [] }
  assert.match(skillHintLines(fake, { activity: 'study', context: { hasQuestion: true } })[0], /study.search/)
  assert.deepEqual(skillHintLines(fake, { activity: 'video', context: {} }), [])
})
