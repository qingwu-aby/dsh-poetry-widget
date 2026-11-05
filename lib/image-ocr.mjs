// lib/image-ocr.mjs —— 她“看”用户发来的图（v3.00）
//
// 模型没有视觉，这里用 macOS Vision 的 OCR 把图上的字读出来，再把文字给她。
// 只读 attachments 目录下的文件；OCR 失败或没字就如实说“看不清”。
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

export const IMAGE_OCR_TIMEOUT_MS = 15000
export const IMAGE_OCR_MAX_FILES = 3
export const IMAGE_OCR_TEXT_MAX = 400

function resolveHome(home) {
  return home || process.env.HOME || os.homedir()
}

export function resolveOcrBin(home = null) {
  const base = resolveHome(home)
  const candidates = [
    process.env.DSH_POETRY_OCR_BIN || '',
    path.join(base, 'Library/Application Support/dsh-whale-mlx/bin/ocrbin'),
    '/tmp/courses/ocrbin',
  ].filter((item) => item.length > 0)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return ''
}

/** 从对话文本里找附件路径（只接受 attachments 目录下真实存在的文件）。 */
export function extractImagePaths(text, options = {}) {
  const source = String(text ?? '')
  const matches = new Set()
  for (const match of source.matchAll(/（附图：([^）]+)）/g)) matches.add(match[1].trim())
  for (const match of source.matchAll(/\/[^\s）"']*attachments\/v1\/objects\/[0-9a-f/]+/g)) matches.add(match[0].trim())
  const attachmentsRoot = path.join(resolveHome(options.home), '.dsh/attachments/')
  const mustExist = options.mustExist !== false
  return [...matches].filter((file) => {
    const resolved = path.resolve(file)
    if (!resolved.startsWith(path.resolve(attachmentsRoot))) return false
    if (mustExist && !existsSync(resolved)) return false
    return true
  }).slice(0, IMAGE_OCR_MAX_FILES)
}

/** 把原始路径替换成一句人话，别让她读到文件路径。 */
export function sanitizeUserText(text) {
  return String(text ?? '')
    .replace(/（附图：[^）]+）/g, '（发来一张图）')
    .replace(/\/[^\s）"']*attachments\/v1\/objects\/[0-9a-f/]+/g, '（附件）')
    .trim()
}

/** OCR 一组图：返回 {ok, text, files, unsupported}。 */
export function ocrImages(paths, options = {}) {
  const bin = resolveOcrBin(options.home)
  const list = Array.isArray(paths) ? paths.filter((file) => typeof file === 'string' && file.length > 0).slice(0, IMAGE_OCR_MAX_FILES) : []
  if (bin.length === 0 || list.length === 0) return { ok: false, reason: bin.length === 0 ? 'no-ocr-bin' : 'no-image', text: '', files: [] }
  const tmp = path.join(os.tmpdir(), `whale-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const lines = []
  try {
    mkdirSync(tmp, { recursive: true })
    list.forEach((file, index) => {
      const ext = path.extname(file) || '.jpg'
      copyFileSync(file, path.join(tmp, `frame-${String(index + 1).padStart(4, '0')}${ext}`))
    })
    const result = spawnSync(bin, [tmp], { encoding: 'utf8', timeout: options.timeoutMs || IMAGE_OCR_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
    for (const line of String(result.stdout || '').split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed.lines)) for (const text of parsed.lines) if (typeof text === 'string' && text.trim().length > 0) lines.push(text.trim())
      } catch { /* ignore */ }
    }
    return { ok: true, text: lines.join(' ').slice(0, IMAGE_OCR_TEXT_MAX), files: list }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), text: '', files: list }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/** 给 prompt 用的一句话描述。 */
export function describeImages(paths) {
  const result = ocrImages(paths)
  if (result.ok !== true) return { ok: false, text: '他发来一张图，但这边读不出图上的字（可能不是文字图）。', files: result.files || [] }
  if (result.text.trim().length === 0) return { ok: true, text: '他发来一张图，但图上没有可读的文字（可能是一张照片/画）。', files: result.files }
  return { ok: true, text: `他发来一张图，你能从图上读到的字是：${result.text}`, files: result.files }
}
