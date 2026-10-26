// client-src/base.js —— 浏览器端通用小工具（v1.75 从 client.js 抽出）。
export function num(value, fallback) {
const n = Number(value)
return Number.isFinite(n) ? n : fallback
}

export function clamp(value, min, max) {
const n = num(value, min)
if (n < min) return min
if (n > max) return max
return n
}

export function isVideoMoodFile(file) {
return /\.webm$/i.test(String(file == null ? '' : file))
}
