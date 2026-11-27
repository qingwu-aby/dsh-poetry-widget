import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { parseSchematicBytes, schematicToBlueprint } from '../../lib/domain/play/minecraft-schematic.mjs'

/** 造一个最小的 Sponge v2 .schem：3×2×3，底层石头、上层空气。 */
function buildV2Schem() {
  const width = 3, height = 2, length = 3
  const parts = []
  const big = (value) => { const buf = Buffer.alloc(4); buf.writeInt32BE(value); return buf }
  const str = (value) => { const body = Buffer.from(value, 'utf8'); const len = Buffer.alloc(2); len.writeUInt16BE(body.length); return Buffer.concat([len, body]) }
  const named = (type, name) => Buffer.concat([Buffer.from([type]), str(name)])
  const intTag = (name, value) => Buffer.concat([named(3, name), big(value)])
  const intArray = (name, values) => Buffer.concat([named(11, name), big(values.length), ...values.map((v) => big(v))])
  const palette = Buffer.concat([
    named(3, 'minecraft:stone'), big(0),
    named(3, 'minecraft:air'), big(1),
  ])
  const blockData = []
  for (let y = 0; y < height; y += 1) for (let z = 0; z < length; z += 1) for (let x = 0; x < width; x += 1) blockData.push(y === 0 ? 0 : 1)
  const compound = Buffer.concat([
    intTag('Version', 2),
    intTag('Width', width),
    intTag('Height', height),
    intTag('Length', length),
    Buffer.concat([named(10, 'Palette'), palette, Buffer.from([0])]),
    intArray('BlockData', blockData),
    Buffer.from([0]),
  ])
  parts.push(Buffer.from([10]), str('Schematic'), compound)
  return gzipSync(Buffer.concat(parts))
}

test('schematic：解析 Sponge v2 并转成蓝图', () => {
  const schem = parseSchematicBytes(buildV2Schem())
  assert.equal(schem.Width, 3)
  assert.equal(schem.Height, 2)
  const blueprint = schematicToBlueprint(schem, '测试小屋')
  assert.deepEqual(blueprint.size, { x: 3, y: 2, z: 3 })
  assert.equal(blueprint.blocks.length, 9, '只有底层 9 块石头，上层空气被跳过')
  assert.ok(blueprint.blocks.every((b) => b.name === 'stone' && b.y === 0))
  assert.deepEqual(blueprint.materials[0], { name: 'stone', count: 9 })
})

test('schematic：方块名里的属性后缀会被去掉', () => {
  const schem = parseSchematicBytes(buildV2Schem())
  schem.Palette = { 'minecraft:oak_stairs[facing=north,half=bottom]': 0, 'minecraft:air': 1 }
  const blueprint = schematicToBlueprint(schem, '带属性')
  assert.equal(blueprint.blocks[0].name, 'oak_stairs')
})

test('schematic：缺尺寸信息会明确报错', () => {
  assert.throws(() => schematicToBlueprint({ Version: 2 }, '坏图'), /Width\/Height\/Length/)
})
