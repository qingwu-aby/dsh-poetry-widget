// tests/domains/minecraft-inquiry.test.mjs —— P0 科学实践循环（v0.10.0）
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInquiryPrompt, parseInquiry } from '../../lib/domain/play/minecraft-inquiry.mjs'
import { parseWorldCommand } from '../../lib/domain/play/minecraft-world.mjs'

test('调研解析：问题/原因/假设/实验/验证标准', () => {
  const parsed = parseInquiry('{"problem":"放不上方块","cause":"身体挡住了目标","hypothesis":"先站开再放","experiment":{"tool":"mc_place","arguments":{"block":"dirt"}},"success":"读回方块成功","next":"继续盖"}')
  assert.equal(parsed.problem, '放不上方块')
  assert.equal(parsed.cause, '身体挡住了目标')
  assert.equal(parsed.experiment.tool, 'mc_place')
  assert.equal(parsed.success, '读回方块成功')
  assert.equal(parseInquiry('我先想想'), null)
  assert.equal(parseInquiry('{"problem":"   "}'), null)
})

test('调研 prompt：带问题、回执、记忆与资料，并要求可验证实验', () => {
  const prompt = buildInquiryPrompt(
    { problem: '房子只放上一半', observations: ['位置 1,2,3'], receipts: [{ tool: 'mc_build', ok: false, detail: '20/30' }], memoryLines: ['方法：先清场'] },
    [{ title: '攻略', snippet: '先清出空地' }],
  )
  assert.match(prompt, /房子只放上一半/)
  assert.match(prompt, /20\/30/)
  assert.match(prompt, /先清出空地/)
  assert.match(prompt, /hypothesis/)
  assert.match(prompt, /可验证/)
})

test('World 工具：mc_inquire 是合法工具', () => {
  const cmd = parseWorldCommand('{"tool":"mc_inquire","arguments":{"problem":"放不上方块"}}')
  assert.equal(cmd.tool, 'mc_inquire')
  assert.equal(cmd.arguments.problem, '放不上方块')
  assert.equal(parseWorldCommand('{"tool":"mc_inquire","arguments":{}}'), null)
})
