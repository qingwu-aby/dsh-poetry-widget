// @ts-check
// .schem（Sponge Schematic v1/v2/v3）解析：把别人的建筑读成「蓝图」。
// 只用 node:zlib，不引入依赖。
import { gunzipSync } from 'node:zlib'

class Reader {
  constructor(data) {
    this.data = data
    this.pos = 0
  }
  take(n) {
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  u1() { const v = this.data[this.pos]; this.pos += 1; return v }
  i2() { const v = this.data.readInt16BE(this.pos); this.pos += 2; return v }
  i4() { const v = this.data.readInt32BE(this.pos); this.pos += 4; return v }
  i8() { const v = Number(this.data.readBigInt64BE(this.pos)); this.pos += 8; return v }
  f4() { const v = this.data.readFloatBE(this.pos); this.pos += 4; return v }
  f8() { const v = this.data.readDoubleBE(this.pos); this.pos += 8; return v }
  rstr() {
    const n = this.data.readUInt16BE(this.pos)
    this.pos += 2
    const s = this.data.subarray(this.pos, this.pos + n).toString('utf8')
    this.pos += n
    return s
  }
  payload(type) {
    switch (type) {
      case 1: return this.u1()
      case 2: return this.i2()
      case 3: return this.i4()
      case 4: return this.i8()
      case 5: return this.f4()
      case 6: return this.f8()
      case 7: { const n = this.i4(); return Buffer.from(this.take(n)) }
      case 8: return this.rstr()
      case 9: {
        const elementType = this.u1()
        const n = this.i4()
        const list = []
        for (let i = 0; i < n; i += 1) list.push(this.payload(elementType))
        return list
      }
      case 10: {
        const out = {}
        for (;;) {
          const tag = this.u1()
          if (tag === 0) break
          const name = this.rstr()
          out[name] = this.payload(tag)
        }
        return out
      }
      case 11: { const n = this.i4(); const list = []; for (let i = 0; i < n; i += 1) list.push(this.i4()); return list }
      case 12: { const n = this.i4(); const list = []; for (let i = 0; i < n; i += 1) list.push(this.i8()); return list }
      default: throw new Error(`未知 NBT 标签 ${type}`)
    }
  }
}

/** 解析 .schem 的原始字节（gzip 或未压缩均可）。 */
export function parseSchematicBytes(bytes) {
  let data = Buffer.from(bytes)
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data)
  const reader = new Reader(data)
  const rootType = reader.u1()
  if (rootType !== 10) throw new Error('不是 NBT 根复合标签')
  reader.rstr()
  const root = reader.payload(10)
  // 有些文件（MCEdit/WorldEdit 风格）把内容包在 root.Schematic 里
  return root && typeof root.Schematic === 'object' ? root.Schematic : root
}

/** 读 varint（v2/v3 的 BlockData 是 varint 序列）。 */
function readVarints(buffer, count) {
  const out = new Array(count)
  let pos = 0
  for (let i = 0; i < count; i += 1) {
    let value = 0
    let shift = 0
    for (;;) {
      const byte = buffer[pos]
      pos += 1
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) break
      shift += 7
      if (shift > 35) throw new Error('varint 过长')
    }
    out[i] = value
  }
  return out
}

const NORMALIZE = (name) => String(name || '').replace(/^minecraft:/, '').split('[')[0].trim()

/**
 * 把 .schem 变成蓝图：{ name, size:{x,y,z}, palette:[...], blocks:[{x,y,z,name}] }
 * 坐标以左下前角为原点（0,0,0），与 bot 的 buildPlan 对齐。
 */
export function schematicToBlueprint(schem, name = '未命名蓝图') {
  const width = Number(schem.Width) || 0
  const height = Number(schem.Height) || 0
  const length = Number(schem.Length) || 0
  if (width <= 0 || height <= 0 || length <= 0) throw new Error('缺少 Width/Height/Length')
  const version = Number(schem.Version) || 1
  const nested = schem.Blocks && typeof schem.Blocks === 'object' ? schem.Blocks : null
  const paletteSource = schem.Palette || (nested && nested.Palette) || {}
  const dataSource = schem.BlockData || (nested && nested.Data) || null
  const paletteRaw = paletteSource && typeof paletteSource === 'object' ? paletteSource : {}
  const palette = []
  if (Array.isArray(paletteRaw)) {
    for (const entry of paletteRaw) palette.push(NORMALIZE(entry))
  } else {
    const entries = Object.entries(paletteRaw)
    const indexed = entries.every(([, value]) => Number.isFinite(Number(value)))
    if (indexed) {
      for (const [blockName, index] of entries) palette[Number(index)] = NORMALIZE(blockName)
    }
  }
  const blockData = dataSource ? Buffer.from(dataSource) : Buffer.alloc(0)
  const volume = width * height * length
  let indices
  if (version >= 2) {
    indices = readVarints(blockData, volume)
  } else {
    if (blockData.length < volume * 2) throw new Error('v1 BlockData 长度不足')
    indices = []
    for (let i = 0; i < volume; i += 1) indices.push(blockData.readUInt16BE(i * 2))
  }
  const blocks = []
  const counts = new Map()
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < length; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = indices[(y * length + z) * width + x] || 0
        const blockName = palette[index] || 'air'
        if (blockName === 'air' || blockName === 'cave_air' || blockName === 'void_air') continue
        blocks.push({ x, y, z, name: blockName })
        counts.set(blockName, (counts.get(blockName) || 0) + 1)
      }
    }
  }
  const materials = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([blockName, count]) => ({ name: blockName, count }))
  return { name, size: { x: width, y: height, z: length }, version, palette, blocks, materials }
}
