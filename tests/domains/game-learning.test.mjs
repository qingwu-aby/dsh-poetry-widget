// tests/domains/game-learning.test.mjs —— Minecraft 自学结果解析（v0.8.0）
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLearningPrompt, parseLearning } from '../../lib/domain/play/game-learning.mjs'

test('自学结果解析：lesson/steps/happy 截断与去空', () => {
  const parsed = parseLearning('{"lesson":"先砍树","steps":["砍3块木头","做工作台","做木镐","",""],"happy":"有工具就不慌"}')
  assert.deepEqual(parsed, { lesson: '先砍树', steps: ['砍3块木头', '做工作台', '做木镐'], happy: '有工具就不慌' })
  assert.equal(parseLearning('我先想想'), null)
  assert.equal(parseLearning('{"steps":[]}'), null)
  assert.equal(parseLearning('{"lesson":"   "}'), null)
})

test('自学 prompt：带主题、观察与资料，并要求只输出 JSON', () => {
  const prompt = buildLearningPrompt('建造自己的小屋', '在丛林里，有木头', [{ title: '攻略', snippet: '先搭地基' }])
  assert.match(prompt, /建造自己的小屋/)
  assert.match(prompt, /在丛林里/)
  assert.match(prompt, /先搭地基/)
  assert.match(prompt, /只输出一个 JSON/)
  assert.match(prompt, /不要建议作弊/)
})
