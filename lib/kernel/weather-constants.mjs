// lib/kernel/weather-constants.mjs —— 天气默认值/归一化（settings 与 weather 服务共用）
export const DEFAULT_CITY = '北京'

export function normalizeCity(value) {
  if (typeof value !== 'string') return DEFAULT_CITY
  const trimmed = value.trim()
  if (trimmed.length === 0) return DEFAULT_CITY
  if ([...trimmed].length > 20) return DEFAULT_CITY
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return DEFAULT_CITY
  return trimmed
}
