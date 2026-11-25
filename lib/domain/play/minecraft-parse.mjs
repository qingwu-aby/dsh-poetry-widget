// @ts-check
// 从模型回复里挑出候选 JSON 对象：模型常把一句话/代码块/多个对象混在一起，
// 只取“第一个 { 到最后一个 }”会整体解析失败，所以逐个平衡括号尝试。

/** 返回从 text 中扫描出的、能被 JSON.parse 的对象数组（按出现顺序）。 */
export function jsonObjects(text, limit = 6) {
  const source = String(text ?? '')
  const out = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < source.length && out.length < limit; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const slice = source.slice(start, i + 1)
        try {
          const parsed = JSON.parse(slice)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.push(parsed)
        } catch (_error) { void _error }
        start = -1
      }
    }
  }
  return out
}
