// client-src/widget/hooks/use-data.js —— 视口尺寸 + 数据资源（诗/词/知识/韵部/诗库/平水韵/图鉴）加载与激活。
import { getReact } from '../runtime.js'
import { BASE_SIZE, WEATHER_POOL_LIMIT } from '../models/constants.js'
import { weatherPoemTags, buildWeatherPoemPool } from '../models/weather-model.js'

export function useData(deps) {
  const React = getReact()
  const { useViewportSize, settings, useResource, boot, panelOpen, panelTab, step, poetryTab, resourceStore, weatherRes } = deps
  const { refs } = deps
  const { } = refs
  const [ciBankWanted, setCiBankWanted] = React.useState(false)
  const viewport = useViewportSize()
  const mascotSize = Math.max(40, Math.round(BASE_SIZE * settings.scale))
  const [poemsRes, reloadPoems] = useResource('poems', Boolean(boot.data))
  const poetryOn = panelOpen && panelTab === 'poetry'
  const classActive = step === 2 || step === 4 || (poetryOn && (poetryTab === 'class' || poetryTab === 'ci'))
  const yunActive = step === 3 || (poetryOn && poetryTab === 'yun')
  const weatherNeedsCi = settings.weatherPoem && !resourceStore.get('ci')
   && weatherRes.data && weatherRes.data.ok && weatherRes.data.weather
   && buildWeatherPoemPool(poemsRes.data, null, weatherPoemTags(weatherRes.data.weather), WEATHER_POOL_LIMIT).length < WEATHER_POOL_LIMIT
  const ciActive = step === 4 || step === 5 || weatherNeedsCi
   || (poetryOn && (poetryTab === 'ci' || poetryTab === 'feihua' || poetryTab === 'library'))
  const [knowledgeRes, reloadKnowledge] = useResource('knowledge', classActive)
  const [yunRes, reloadYun] = useResource('yun', yunActive)
  const [ciRes, reloadCi] = useResource('ci', ciActive)
  const libraryActive = poetryOn && poetryTab === 'library'
  const feihuaOpen = (poetryOn && poetryTab === 'feihua') || step === 5
  const ciTabActive = poetryOn && poetryTab === 'ci'
  const extraPoolActive = libraryActive || feihuaOpen
  const [anthologyRes, reloadAnthology] = useResource('anthology', extraPoolActive)
  const [bankRes, reloadBank] = useResource('bank', extraPoolActive)
  const [pingshuiRes, reloadPingshui] = useResource('pingshui', libraryActive)
  const [moodCatalogRes, reloadMoodCatalog] = useResource('moodCatalog', settings.mood)
  const [ciBankRes, reloadCiBank] = useResource('ciBank', ciBankWanted || feihuaOpen)
  return { viewport, mascotSize, ciBankWanted, setCiBankWanted, poemsRes, reloadPoems, knowledgeRes, reloadKnowledge, yunRes, reloadYun, ciRes, reloadCi, anthologyRes, reloadAnthology, bankRes, reloadBank, pingshuiRes, reloadPingshui, moodCatalogRes, reloadMoodCatalog, ciBankRes, reloadCiBank, libraryActive, feihuaOpen, ciTabActive, extraPoolActive }
}
