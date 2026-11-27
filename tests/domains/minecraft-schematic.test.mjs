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

test('litematic：解包 long 数组并按区域还原成蓝图', async () => {
  const { litematicToBlueprint } = await import('../../lib/domain/play/minecraft-schematic.mjs')
  // 2×1×2 区域，palette [stone, air]，bit 宽 2：值序列 [0,1,0,1]
  const packed = BigInt(0 | (1 << 2) | (0 << 4) | (1 << 6))
  const litematic = {
    Regions: {
      main: {
        Position: { x: 100, y: 64, z: 100 },
        Size: { x: 2, y: 1, z: 2 },
        BlockStatePalette: [{ Name: 'minecraft:stone' }, { Name: 'minecraft:air' }],
        BlockStates: [packed],
      },
    },
  }
  const blueprint = litematicToBlueprint(litematic, '测试机器')
  assert.equal(blueprint.format, 'litematic')
  assert.equal(blueprint.blocks.length, 2, '两块石头，两块空气跳过')
  assert.deepEqual(blueprint.size, { x: 1, y: 1, z: 2 }, '石头落在 x=0 的那一列，归一化后宽 1')
  assert.deepEqual(blueprint.materials[0], { name: 'stone', count: 2 })
  const coords = blueprint.blocks.map((b) => `${b.x},${b.y},${b.z}`).sort()
  assert.deepEqual(coords, ['0,0,0', '0,0,1'], '坐标以最小角归一化到原点')
})

test('litematic：多区域合并 + 负 Size 方向', async () => {
  const { litematicToBlueprint } = await import('../../lib/domain/play/minecraft-schematic.mjs')
  const one = BigInt(0 | (0 << 2) | (1 << 4) | (1 << 6))
  const litematic = {
    Regions: {
      a: { Position: { x: 0, y: 0, z: 0 }, Size: { x: 2, y: 1, z: 2 }, BlockStatePalette: [{ Name: 'minecraft:stone' }, { Name: 'minecraft:air' }], BlockStates: [one] },
      b: { Position: { x: 0, y: 0, z: 4 }, Size: { x: 2, y: 1, z: -2 }, BlockStatePalette: [{ Name: 'minecraft:oak_planks' }], BlockStates: [BigInt(0)] },
    },
  }
  const blueprint = litematicToBlueprint(litematic, '多区域')
  assert.ok(blueprint.blocks.length > 0)
  assert.ok(blueprint.size.z >= 5)
  assert.ok(blueprint.materials.some((m) => m.name === 'oak_planks'))
})
