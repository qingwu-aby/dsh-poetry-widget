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


/**
 * 解析 Litematica（.litematic）：
 * root.Regions[name] = { Position, Size, BlockStatePalette:[{Name,Properties}], BlockStates:[long...] }
 * BlockStates 是按 bit 宽打包的长整型数组（跨 long 连续打包）。
 */
export function litematicToBlueprint(litematic, name = '未命名蓝图') {
  const regions = litematic && litematic.Regions && typeof litematic.Regions === 'object' ? litematic.Regions : null
  if (!regions) throw new Error('不是 litematic（缺少 Regions）')
  const keys = Object.keys(regions)
  if (keys.length === 0) throw new Error('litematic 没有区域')
  const blocks = []
  const counts = new Map()
  let minX = 0, minY = 0, minZ = 0
  let maxX = 0, maxY = 0, maxZ = 0
  let first = true
  for (const key of keys) {
    const region = regions[key] || {}
    const pos = region.Position || {}
    const size = region.Size || {}
    const paletteRaw = Array.isArray(region.BlockStatePalette) ? region.BlockStatePalette : []
    const palette = paletteRaw.map((entry) => {
      const raw = typeof entry === 'string' ? entry : entry && entry.Name ? entry.Name : 'air'
      return String(raw).replace(/^minecraft:/, '').split('[')[0].trim()
    })
    const states = Array.isArray(region.BlockStates) ? region.BlockStates : []
    if (states.length === 0 || palette.length === 0) continue
    let sx = Number(size.x) || 0, sy = Number(size.y) || 0, sz = Number(size.z) || 0
    const ox = Number(pos.x) || 0, oy = Number(pos.y) || 0, oz = Number(pos.z) || 0
    // litematica 的 Size 允许为负（表示该轴反向）
    const stepX = sx < 0 ? -1 : 1, stepY = sy < 0 ? -1 : 1, stepZ = sz < 0 ? -1 : 1
    sx = Math.abs(sx); sy = Math.abs(sy); sz = Math.abs(sz)
    const volume = sx * sy * sz
    if (volume <= 0) continue
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))))
    const values = unpackBits(states, bits, volume)
    let index = 0
    for (let y = 0; y < sy; y += 1) {
      for (let z = 0; z < sz; z += 1) {
        for (let x = 0; x < sx; x += 1) {
          const blockName = palette[values[index] || 0] || 'air'
          index += 1
          if (blockName === 'air' || blockName === 'cave_air' || blockName === 'structure_void') continue
          const bx = ox + x * stepX
          const by = oy + y * stepY
          const bz = oz + z * stepZ
          if (first) { minX = maxX = bx; minY = maxY = by; minZ = maxZ = bz; first = false }
          minX = Math.min(minX, bx); maxX = Math.max(maxX, bx)
          minY = Math.min(minY, by); maxY = Math.max(maxY, by)
          minZ = Math.min(minZ, bz); maxZ = Math.max(maxZ, bz)
          blocks.push({ x: bx, y: by, z: bz, name: blockName })
          counts.set(blockName, (counts.get(blockName) || 0) + 1)
        }
      }
    }
  }
  if (blocks.length === 0) throw new Error('litematic 里没有方块')
  // 归一化到原点
  const shifted = blocks.map((b) => ({ x: b.x - minX, y: b.y - minY, z: b.z - minZ, name: b.name }))
  const materials = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([blockName, count]) => ({ name: blockName, count }))
  return {
    name,
    size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
    blocks: shifted,
    materials,
    format: 'litematic',
  }
}

/** 把打包的长整型数组解成索引序列（连续位流，LSB 优先，可跨 long）。 */
function unpackBits(longs, bits, count) {
  const out = new Array(count)
  const mask64 = (1n << 64n) - 1n
  const words = longs.map((value) => {
    const big = typeof value === 'bigint' ? value : BigInt(value)
    return (big < 0n ? big + (1n << 64n) : big) & mask64
  })
  for (let i = 0; i < count; i += 1) {
    const bitPos = i * bits
    let value = 0n
    for (let b = 0; b < bits; b += 1) {
      const pos = bitPos + b
      const wordIndex = Math.floor(pos / 64)
      const bitIndex = BigInt(pos % 64)
      const word = words[wordIndex] ?? 0n
      value |= ((word >> bitIndex) & 1n) << BigInt(b)
    }
    out[i] = Number(value)
  }
  return out
}
