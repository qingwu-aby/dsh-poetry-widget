// lib/local-media.mjs —— 本地静态素材合成（v2.52）。
//
// opencode-go / OpenCode 的模型都是 text-output，不能生成像素。
// 这里先用她现有的 100 张鲸鱼静态图做“非 AI”合成：
//   · image：海报 PNG（渐变 + 鲸鱼图 + 标题/句子）
//   · video：把海报做成 6 秒缓慢推近的 MP4
// 零媒体 API 费用；未来接真实 media provider 时替换 renderer 即可。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const IMAGE_W = 1080
const IMAGE_H = 1440
const VIDEO_W = 720
const VIDEO_H = 1280

function esc(text, max = 120) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max)
}

export function resolveLocalAsset(assetsDir, name) {
  const raw = String(name ?? '').trim()
  if (!/^[a-zA-Z0-9._-]+\.(webp|png|jpe?g)$/i.test(raw)) return ''
  const file = path.join(assetsDir, 'generated', raw)
  return existsSync(file) ? file : ''
}

export function defaultLocalAssets(assetsDir) {
  try {
    return readdirSync(path.join(assetsDir, 'generated'))
      .filter((name) => /\.(webp|png|jpe?g)$/i.test(name))
      .sort()
      .slice(0, 100)
  } catch {
    return []
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'pipe', timeout: 45000, ...options })
}

function webpToPng(source, target) {
  try {
    run('sips', ['-s', 'format', 'png', source, '--out', target])
    if (existsSync(target)) return true
  } catch {
    /* fall through */
  }
  try {
    run('ffmpeg', ['-y', '-i', source, '-frames:v', '1', target])
    return existsSync(target)
  } catch {
    return false
  }
}

function buildPosterSvg({ dataUrl, title, caption }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_W}" height="${IMAGE_H}" viewBox="0 0 ${IMAGE_W} ${IMAGE_H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="#1d242b"/>
    <stop offset="0.55" stop-color="#2b3338"/>
    <stop offset="1" stop-color="#14191e"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.32" cy="0.34" r="0.7">
    <stop offset="0" stop-color="#7d95a8" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#7d95a8" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${IMAGE_W}" height="${IMAGE_H}" fill="url(#bg)"/>
<rect width="${IMAGE_W}" height="${IMAGE_H}" fill="url(#glow)"/>
<image x="90" y="250" width="900" height="900" preserveAspectRatio="xMidYMid meet" href="${dataUrl}"/>
<text x="90" y="150" fill="#e7edf2" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="58" font-weight="600">${esc(title, 30)}</text>
<text x="90" y="1170" fill="#aebbc6" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="34">${esc(caption, 80)}</text>
<text x="90" y="1350" fill="#5f707d" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="24">小鲸鱼 · 本地素材合成</text>
</svg>`
}

export function renderLocalImage({ dir, assetsDir, asset, title, caption, now }) {
  const source = resolveLocalAsset(assetsDir, asset)
  if (!source) return { ok: false, reason: 'asset' }
  mkdirSync(dir, { recursive: true })
  const tempPng = path.join(dir, `.tmp-${now}.png`)
  if (!webpToPng(source, tempPng)) return { ok: false, reason: 'convert' }
  try {
    const dataUrl = 'data:image/png;base64,' + readFileSync(tempPng).toString('base64')
    const svg = buildPosterSvg({ dataUrl, title, caption })
    const svgFile = `media-${now}.svg`
    const pngFile = `media-${now}.png`
    writeFileSync(path.join(dir, svgFile), svg, 'utf8')
    try {
      run('rsvg-convert', ['-w', String(IMAGE_W), '-o', path.join(dir, pngFile), path.join(dir, svgFile)])
    } catch {
      /* 没有 rsvg-convert 时保留 SVG */
    }
    return {
      ok: true,
      file: existsSync(path.join(dir, pngFile)) ? pngFile : svgFile,
      kind: 'image',
      mime: existsSync(path.join(dir, pngFile)) ? 'image/png' : 'image/svg+xml',
    }
  } finally {
  }
}

export function renderLocalVideo({ dir, assetsDir, asset, title, caption, now }) {
  const image = renderLocalImage({ dir, assetsDir, asset, title, caption, now })
  if (image.ok !== true) return image
  if (!/\.png$/i.test(image.file)) return { ok: false, reason: 'need_png' }
  const out = `video-${now}.mp4`
  const input = path.join(dir, image.file)
  try {
    run('ffmpeg', [
      '-y',
      '-loop', '1',
      '-i', input,
      '-vf', `scale=${VIDEO_W}:-1,zoompan=z='min(zoom+0.0007,1.10)':d=180:s=${VIDEO_W}x${VIDEO_H}:fps=30,fade=t=in:st=0:d=0.6,fade=t=out:st=5.4:d=0.6,format=yuv420p`,
      '-t', '6',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-movflags', '+faststart',
      path.join(dir, out),
    ])
    return { ok: true, file: out, kind: 'video', mime: 'video/mp4' }
  } catch {
    return { ok: false, reason: 'ffmpeg' }
  }
}
