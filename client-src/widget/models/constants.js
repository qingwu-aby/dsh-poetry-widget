// client-src/widget/models/constants.js —— 挂件常量（v3.0 从 widget-plugin.js 抽出）。

  export const ROUTE = '/api/dsh-poetry/'
  export const SELF_PATH = 'self.json'
  export const SELF_POLL_MS = 60 * 1000
  export const ACTION_SEEN_KEY = 'dshp-action-seen-v1'
  export const MEMORY_PATH = 'memory.json'
  export const HEALTH_PATH = 'health.json'
  export const WORKS_PATH = 'works.json'
  export const ATTENTION_PATH = 'attention.json'
  export const PROJECT_ACTION_PATH = 'project-action.json'
  export const PROJECT_PATH = 'project.json'
  export const TWIN_PATH = 'twin.json'
  export const PRESENCE_PATH = 'presence.json'
  export const PRESENCE_THROTTLE_MS = 60 * 1000
  export const WORKS_POLL_MS = 60 * 1000
  export const GROWTH_PATH = 'growth.json'
  export const GROWTH_POLL_MS = 5 * 60 * 1000
  export const ATTENTION_POLL_MS = 30 * 1000
  export const TWIN_POLL_MS = 60 * 1000
  export const HEALTH_POLL_MS = 60 * 1000
  export const MEMORY_BACKUP_PATH = 'memory/backup.json'
  export const MEMORY_POLL_MS = 60 * 1000
  export const ASSET_BASE = ROUTE + 'assets?f='
  export const SETTINGS_URL = ROUTE + 'settings.json'
  export const WIDGET_ID = 'dsh-little-whale'
  export const CACHE_KEY = 'dshp.firstscreen.v1'
  export const BASE_SIZE = 96
  export const MIN_SCALE = 0.6
  export const MAX_SCALE = 1.6
  export const Z_INDEX = 60
  export const SAVE_DEBOUNCE_MS = 450
  export const STEPS = ['今日一诗', '格律解析', '今日知识卡', '声律启蒙', '词牌名篇', '飞花令']
  // v1.76：诗词模块与它的配置降权到二级菜单（从成长页进入）。
  // v2.29：诗词/格律入口暂时关闭，但代码与数据都保留，后续可随时打开。
  export const POETRY_ENTRY_ENABLED = false
  export const POETRY_TABS = [
  { id: 'today', label: '今日' },
  { id: 'class', label: '课堂' },
  { id: 'yun', label: '韵部' },
  { id: 'ci', label: '词牌' },
  { id: 'library', label: '诗库' },
  { id: 'feihua', label: '飞花' },
  { id: 'poetry-settings', label: '设置' },
  ]
  export const FEIHUA_BEST_KEY = 'dshp-feihua-best-v1'
  export const FEIHUA_ATLAS_PAGE = 60
  export const FEIHUA_FULL_PATH = 'feihua-full.json'
  export const FEIHUA_FULL_TIMEOUT_MS = 20000
  export const FEIHUA_FULL_RETRY_MS = 60000
  export const MASCOT_DIR = 'generated/'
  export const MASCOT_FILES = Object.freeze({
  celebrate: 'dsh-whale-state-celebrate.webp',
  idle: 'dsh-whale-state-idle-cute.webp',
  night: 'dsh-whale-state-night.webp',
  rain: 'dsh-whale-state-weather-umbrella.webp',
  snow: 'dsh-whale-state-weather-snow.webp',
  thunder: 'dsh-whale-state-weather-thunder.webp',
  cold: 'dsh-whale-state-weather-cold.webp',
  gameWin: 'dsh-whale-state-game-win.webp',
  gameLose: 'dsh-whale-state-game-lose.webp',
  gameThink: 'dsh-whale-state-game-think.webp',
  })
  export const MASCOT_TRANSIENT_MS = 2500
  export const WEATHER_REFRESH_MS = 30 * 60 * 1000
  export const WEATHER_STALE_MS = 20 * 60 * 1000
  export const WEATHER_CATEGORY_TAGS = Object.freeze({
  rain: ['雨'],
  snow: ['雪'],
  thunder: ['雨', '雷'],
  cloud: ['云'],
  fog: ['云', '雾'],
  clear: ['晴', '日'],
  wind: ['风'],
  cold: ['霜', '露', '寒'],
  unknown: [],
  })
  export const WEATHER_NIGHT_TAGS = ['月', '夜']
  export const WEATHER_POOL_LIMIT = 20
  export const WEATHER_EXPLAIN = Object.freeze({
  rain: '今日有雨，为你选了写雨的这首',
  snow: '今日有雪，为你选了写雪的这首',
  thunder: '今日有雷雨，为你选了写雨雷的这首',
  cloud: '今日多云，为你选了写云的这首',
  fog: '今日有雾，为你选了写云雾的这首',
  clear: '今日晴好，为你选了写晴日的这首',
  wind: '今日多风，为你选了写风的这首',
  cold: '今日寒冷，为你选了写霜寒的这首',
  unknown: '今日天气应景，为你选了应景的这首',
  })
  export const PET_MEDIA_PATH = 'pet-media'
  export const PET_MEDIA_CATALOG_FILE = 'catalog.json'
  export const PET_MEDIA_TIMEOUT_MS = 9000
  export const MOTION_ROTATION_KEY = 'dshp-motion-rotation-v1'
  export const MOTION_MIN_DELAY_MS = 90 * 1000
  export const MOTION_MAX_DELAY_MS = 210 * 1000
  export const MOTION_PLAY_MIN_MS = 20 * 1000
  export const MOTION_PLAY_MAX_MS = 30 * 1000
  export const MOTION_FIRST_MIN_DELAY_MS = 10 * 1000
  export const MOTION_FIRST_MAX_DELAY_MS = 20 * 1000
  export const DIZZY_MIN_MS = 1500
  export const DIZZY_MAX_MS = 2500
  export const DIZZY_FAST_PX_PER_SEC = 1800
  export const DIZZY_FAST_DISTANCE_PX = 120
  export const DIZZY_FAST_WINDOW_MS = 120
  export const MEAL_KEY = 'dshp-meal-v1'
  export const MEAL_PLAY_MIN_MS = 25 * 1000
  export const MEAL_PLAY_MAX_MS = 40 * 1000
  export const WEATHER_OVERLAY_STATES = ['rain', 'snow', 'thunder', 'cold', 'night']
  /* M9：扩展静态数据资产 + 诗库 + 格律检测 + 剩余立绘彩蛋 */
  export const ASSET_DATA_FILES = { anthology: 'data/anthology.json', bank: 'data/poems-bank.json', pingshui: 'data/pingshui.json', ciBank: 'data/ci-bank.json', moodCatalog: 'data/mood-catalog.json' }
  export const LIBRARY_CATEGORIES = [
   { id: 'shijing', label: '诗经' },
   { id: 'chuci', label: '楚辞' },
   { id: 'qianjiashi', label: '千家诗' },
   { id: 'tang300', label: '唐诗三百首' },
   { id: 'bank', label: '全唐诗精选' },
   { id: 'ci-selected', label: '宋词精选' },
  ]
  export const MASCOT_EXPRESSION_MS = 2500
  export const MASCOT_IDLE_MIN_MS = 45 * 60 * 1000
  export const MASCOT_IDLE_USER_MS = 5 * 60 * 1000
  export const MASCOT_IDLE_POLL_MS = 5 * 60 * 1000
  export const MASCOT_EXPRESSION_FILES = [
   'dsh-whale-state-greet.webp', 'dsh-whale-state-wink.webp', 'dsh-whale-state-blush.webp',
   'dsh-whale-state-teasing.webp', 'dsh-whale-state-cool-shades.webp', 'dsh-whale-state-star.webp',
   'dsh-whale-state-meme-heart.webp', 'dsh-whale-state-meme-kyun.webp', 'dsh-whale-state-meme-smile-pain.webp',
   'dsh-whale-state-meme-yes.webp', 'dsh-whale-state-meme-no.webp', 'dsh-whale-state-meme-omg.webp',
   'dsh-whale-state-meme-shock.webp', 'dsh-whale-state-meme-wakuwaku.webp', 'dsh-whale-state-meme-music.webp',
   'dsh-whale-state-meme-peace.webp', 'dsh-whale-state-daily-coffee.webp', 'dsh-whale-state-daily-picnic.webp',
   'dsh-whale-state-valentine.webp', 'dsh-whale-state-festival-spring.webp', 'dsh-whale-state-festival-mid-autumn.webp',
   'dsh-whale-state-festival-christmas.webp',
  ]
  export const RESOURCE_PATHS = {
  poems: 'poems.json',
  ci: 'ci.json',
  yun: 'yun.json',
  knowledge: 'knowledge.json',
  }


