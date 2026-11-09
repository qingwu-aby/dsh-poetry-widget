// lib/chat-media.mjs -- 对话里给她发图（v2.70）
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const RASTER = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])
export const CHAT_IMAGE_MAX_BYTES = 4 * 1024 * 1024

// v2.96：把“再要一张/精致一点/自画像/图呢/催你画”这类也识别成要图。
export const CHAT_IMAGE_ASK_PATTERN = /(发|来|给我|看看|瞅瞅|催|再|要).{0,6}(图|画|照片|作品|表情|自画像|画像|图片)|(图|画|照片|作品|表情|自画像|画像|图片).{0,6}(发|来|看看|瞅瞅|呢|吗|给|要|一张)|你的(样子|画|作品|长相)|长什么样|拍一张|凑一张|新(的)?图|(再|又|还|多).{0,4}(一张|两?张)/

export function shouldSendChatImage(text) {
  return typeof text === 'string' && CHAT_IMAGE_ASK_PATTERN.test(text)
}

function convertSvg(hostPath) {
  const out = path.join(os.tmpdir(), 'whale-chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png')
  try {
    execFileSync('rsvg-convert', ['-o', out, hostPath], { timeout: 8000, stdio: 'ignore' })
    const data = readFileSync(out)
    try { unlinkSync(out) } catch {}
    return { mediaType: 'image/png', data, name: path.basename(hostPath).replace(/\.svg$/i, '.png') }
  } catch {
    return null
  }
}

export function pickLatestWorkImage(worksDir, options = {}) {
  if (typeof worksDir !== 'string' || worksDir.length === 0) return null
  let names = []
  try {
    names = readdirSync(worksDir)
  } catch {
    return null
  }
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : CHAT_IMAGE_MAX_BYTES
  const candidates = names
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const file = path.join(worksDir, name)
      try {
        const stat = statSync(file)
        return stat.isFile() ? { name, file, at: stat.mtimeMs, size: stat.size } : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.at - left.at)
  for (const item of candidates.slice(0, 12)) {
    const ext = path.extname(item.name).toLowerCase()
    const mediaType = RASTER.get(ext)
    if (mediaType) {
      if (item.size <= maxBytes) return { mediaType, data: readFileSync(item.file), name: item.name, file: item.file }
      continue
    }
    if (ext === '.svg') {
      const converted = convertSvg(item.file)
      if (converted !== null && converted.data.length <= maxBytes) return converted
    }
  }
  return null
}

export function chatImagePayload(image) {
  if (!image || !Buffer.isBuffer(image.data) || image.data.length === 0) return null
  return {
    mediaType: typeof image.mediaType === 'string' ? image.mediaType : 'image/png',
    name: typeof image.name === 'string' ? image.name : 'image.png',
    dataBase64: image.data.toString('base64'),
  }
}
