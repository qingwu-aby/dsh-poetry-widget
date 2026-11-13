// client-src/widget/hooks/use-weather.js —— 天气状态与刷新（失败静默保留上次）。
import { getReact } from '../runtime.js'
import { WEATHER_REFRESH_MS, WEATHER_STALE_MS } from '../models/constants.js'
import { weatherCache, requestWeather } from '../models/weather-model.js'

export function useWeather(deps) {
  const React = getReact()
  const { settingsRef, settings } = deps
  const { refs } = deps
  const [weatherRes, setWeatherRes] = React.useState(() => {
   const cached = weatherCache
   if (cached && cached.data && cached.data.ok) {
    return { status: 'ready', data: cached.data, error: null, at: cached.at }
   }
   return { status: 'idle', data: null, error: null, at: 0 }
  })
  const weatherInFlightRef = React.useRef(null)
  const weatherData = weatherRes.data && weatherRes.data.ok ? weatherRes.data : null
  const weather = weatherData && weatherData.weather ? weatherData.weather : null
  const refreshWeather = React.useCallback((force) => {
   const current = settingsRef.current
   if (!(current.weatherPoem || current.mood)) return Promise.resolve(null)
   const cached = weatherCache
   if (!force && cached && cached.data && cached.data.ok
    && cached.data.city === current.weatherCity
    && Date.now() - cached.at < WEATHER_STALE_MS) {
    setWeatherRes({ status: 'ready', data: cached.data, error: null, at: cached.at })
    return Promise.resolve(cached.data)
   }
   if (weatherInFlightRef.current) return weatherInFlightRef.current
   setWeatherRes((previous) => ({ status: 'loading', data: previous.data, error: null, at: previous.at }))
   const request = requestWeather().then(
    (data) => {
    weatherInFlightRef.current = null
    setWeatherRes({ status: 'ready', data, error: null, at: Date.now() })
    return data
    },
    (error) => {
    weatherInFlightRef.current = null
    setWeatherRes((previous) => ({ status: 'error', data: previous.data, error, at: previous.at }))
    return null
    },
   )
   weatherInFlightRef.current = request
   return request
  }, [])
  React.useEffect(() => {
   if (!(settings.weatherPoem || settings.mood)) return undefined
   refreshWeather(false)
   const timer = setInterval(() => refreshWeather(true), WEATHER_REFRESH_MS)
   return () => clearInterval(timer)
  }, [settings.weatherPoem, settings.mood, settings.weatherCity, refreshWeather])
  return { weatherRes, refreshWeather, weatherData, weather }
}
