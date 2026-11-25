import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonObjects } from '../../lib/domain/play/minecraft-parse.mjs'
import { parseWorldCommand } from '../../lib/domain/play/minecraft-world.mjs'

test('parse：多个 JSON 对象、带前后废话都能取出', () => {
  const list = jsonObjects('好的 {"tool":"mc_wait","arguments":{"seconds":2}} 再 {"tool":"mc_find","arguments":{"target":"oak_log"}}')
  assert.equal(list.length, 2)
  assert.equal(list[1].tool, 'mc_find')
})

test('parse：字符串里的括号不会打断扫描', () => {
  const list = jsonObjects('{"tool":"mc_say","arguments":{"text":"看到 } 这个括号"}}')
  assert.equal(list.length, 1)
  assert.equal(list[0].arguments.text, '看到 } 这个括号')
})

test('parse：前面有坏 JSON 时仍能解析后面的合法命令', () => {
  const text = '我先想想 {oops 这不是 json} 然后 {"tool":"mc_wait","arguments":{"seconds":3}}'
  const command = parseWorldCommand(text)
  assert.ok(command)
  assert.equal(command.tool, 'mc_wait')
  assert.equal(command.arguments.seconds, 3)
})

test('parse：完全不是 JSON 时返回 null', () => {
  assert.equal(parseWorldCommand('我觉得应该先找木头'), null)
})
