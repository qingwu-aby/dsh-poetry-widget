/**
 * dsh-poetry-widget —— 浏览器半边（M9：诗词挂件 / 天气选诗 / 飞花令 / 心情彩蛋 / 诗库 / 格律检测）。
 *
 * 形态：官方 Client 插件（`dsh.client`）→ `window.__ModuleLoader__.load({ id, factory })`
 *       → `ctx.slots.inject('shell.overlay')` 注册 order=80 的浮层挂件。
 *       纯 React.createElement，无 JSX、无构建步骤；样式通过组件内 <style> 注入。
 *
 * 数据：只读宿主路由 `/api/dsh-poetry/*`（契约见 docs/contract.md），模块级缓存 +
 *       localStorage 仅用于「首屏缓存」（按 dataVersion 失效）。任何请求失败都渲染
 *       友好空态 + 重试按钮，不抛出到 React 树之外（另有 ErrorBoundary 兜底）。
 *
 * 交互：形象悬浮/拖拽/吸附/缩放（按天气与对局状态切换 92 张立绘）；点击推进 6 步气泡
 *       （诗 → 解析 → 知识 → 韵部 → 词牌 → 飞花令 → 收起）；展开面板 6 tab（今日/课堂/
 *       韵部/词牌/飞花/设置）；按天气推荐诗词；设置 PUT 防抖持久化；隐藏后长按角落热区或
 *       双击空白处恢复；心情换装（按当日会话统计/天气/时段，≥20min 限频）与 8–15min「自言自语」模型随想
 *       （每日 ≤3 次、7 天不重句，localStorage 记录）。全部圆点/文案中文，主题只用宿主 `--dsw-alias-*` 变量（含 fallback）。
 */

window.__ModuleLoader__.load({
 id: 'dsh-poetry-widget',
 factory: (require) => {
  'use strict'

  const React = require('react')
  if (!React || typeof React.createElement !== 'function') {
  throw new Error('dsh-poetry-widget: React 运行时不可用')
  }
  const h = React.createElement
  const ROUTE = '/api/dsh-poetry/'
  const ASSET_BASE = ROUTE + 'assets?f='
  const SETTINGS_URL = ROUTE + 'settings.json'
  const WIDGET_ID = 'dsh-poetry-widget'
  const CACHE_KEY = 'dshp.firstscreen.v1'
  const POS_KEY = 'dshp.position.v1'
  const BASE_SIZE = 96
  const MIN_SCALE = 0.6
  const MAX_SCALE = 1.6
  const Z_INDEX = 60
  const FETCH_TIMEOUT_MS = 15000
  const SAVE_DEBOUNCE_MS = 450
  const STEPS = ['今日一诗', '格律解析', '今日知识卡', '声律启蒙', '词牌名篇', '飞花令']
  const PANEL_TABS = [
  { id: 'today', label: '今日' },
  { id: 'class', label: '课堂' },
  { id: 'yun', label: '韵部' },
  { id: 'ci', label: '词牌' },
  { id: 'library', label: '诗库' },
  { id: 'feihua', label: '飞花' },
  { id: 'settings', label: '设置' },
  ]
  const FEIHUA_BEST_KEY = 'dshp-feihua-best-v1'
  const FEIHUA_CANDIDATE_CHARS = Array.from('花月风春山水人天云雨夜秋江酒白红舟愁梦心柳雪霜日星海玉金长何不无')
  const FEIHUA_MIN_ENTRIES = 8
  const FEIHUA_CANDIDATE_LIMIT = 12
  const FEIHUA_ATLAS_LIMIT = 200
  const FEIHUA_ATLAS_PAGE = 60
  const FEIHUA_FULL_PATH = 'feihua-full.json'
  const FEIHUA_FULL_TIMEOUT_MS = 20000
  const FEIHUA_FULL_RETRY_MS = 60000
  const MASCOT_DIR = 'generated/'
  const MASCOT_FILES = Object.freeze({
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
  const MASCOT_TRANSIENT_MS = 2500
  const WEATHER_REFRESH_MS = 30 * 60 * 1000
  const WEATHER_STALE_MS = 20 * 60 * 1000
  const WEATHER_CATEGORY_TAGS = Object.freeze({
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
  const WEATHER_NIGHT_TAGS = ['月', '夜']
  const WEATHER_POOL_LIMIT = 20
  const WEATHER_EXPLAIN = Object.freeze({
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
  /* 心情系统（M8）：心情引擎限频 + 低频「想读的诗」彩蛋。 */
  const MOOD_SWITCH_MIN_MS = 20 * 60 * 1000
  const MOOD_REFRESH_MS = 5 * 60 * 1000
  const MOOD_TICK_MS = 60 * 1000
  const MOOD_AI_PATH = 'mood-ai.json'
  const MOOD_AI_TIMEOUT_MS = 25000
  const MOOD_AI_DEBOUNCE_MIN_MS = 2000
  const MOOD_AI_DEBOUNCE_MAX_MS = 4000
  const MOOD_AI_MIN_GAP_MS = 20000
  const MOOD_AI_RETRY_MIN_MS = 12000
  const MOOD_AI_RETRY_MAX_MS = 25000
  const MOOD_AI_KEEP_MS = 30 * 60 * 1000
  const MOOD_AI_MAX_RETRIES = 5
  const MOOD_AI_RECENT_MAX = 3
  const MOOD_AI_RECENT_IMAGES_MAX = 20
  const PET_MEDIA_PATH = 'pet-media'
  const PET_MEDIA_CATALOG_FILE = 'catalog.json'
  const PET_MEDIA_TIMEOUT_MS = 9000
  const MOTION_ROTATION_KEY = 'dshp-motion-rotation-v1'
  const MOTION_MIN_DELAY_MS = 90 * 1000
  const MOTION_MAX_DELAY_MS = 210 * 1000
  const MOTION_PLAY_MIN_MS = 20 * 1000
  const MOTION_PLAY_MAX_MS = 30 * 1000
  const MOTION_FIRST_MIN_DELAY_MS = 10 * 1000
  const MOTION_FIRST_MAX_DELAY_MS = 20 * 1000
  const DIZZY_MIN_MS = 1500
  const DIZZY_MAX_MS = 2500
  const DIZZY_FAST_PX_PER_SEC = 1800
  const DIZZY_FAST_DISTANCE_PX = 120
  const DIZZY_FAST_WINDOW_MS = 120
  const MEAL_KEY = 'dshp-meal-v1'
  const MEAL_PLAY_MIN_MS = 25 * 1000
  const MEAL_PLAY_MAX_MS = 40 * 1000
  const MOOD_PANEL_PEEK_FILES = {
  today: 'dsh-whale-home-peek.webp',
  settings: 'dsh-whale-settings-peek.webp',
  other: 'dsh-whale-workbench-peek.webp',
  }
  const MOOD_STRONG = ['tired', 'sleepy', 'proud']
  const MOOD_LABELS = Object.freeze({
  happy: '开心', proud: '得意', tired: '有点累', sleepy: '困了', hungry: '有点饿',
  lonely: '有点孤单', curious: '好奇', cozy: '惬意', calm: '平静',
  })
  const MOOD_IMAGES = Object.freeze({
  happy: ['dsh-whale-state-game-happy.webp', 'dsh-whale-state-celebrate.webp'],
  proud: ['dsh-whale-state-achievement.webp', 'dsh-whale-state-levelup.webp'],
  tired: ['dsh-whale-state-work-sleep.webp', 'dsh-whale-state-daily-melt.webp'],
  sleepy: ['dsh-whale-state-sleep.webp', 'dsh-whale-state-night.webp'],
  hungry: ['dsh-whale-state-daily-eat.webp', 'dsh-whale-state-daily-cooking.webp'],
  lonely: ['dsh-whale-state-waiting.webp', 'dsh-whale-state-idle-cute.webp'],
  curious: ['dsh-whale-state-curious.webp', 'dsh-whale-state-thinking.webp'],
  cozy: ['dsh-whale-state-daily-coffee.webp', 'dsh-whale-state-weather-rain-happy.webp', 'dsh-whale-state-weather-snow.webp'],
  calm: ['dsh-whale-state-idle-cute.webp'],
  })
  const WEATHER_OVERLAY_STATES = ['rain', 'snow', 'thunder', 'cold', 'night']
  const SPONT_KEY = 'dshp-mood-spont-v1'
  const SPONT_POLL_MIN_MS = 60 * 1000
  const SPONT_POLL_MAX_MS = 120 * 1000
  const SPONT_RETRY_MS = 10 * 1000
  const SPONT_EVENT_MIN_MS = 2 * 1000
  const SPONT_EVENT_MAX_MS = 5 * 1000
  const SPONT_CLOSE_RECHECK_MS = 3 * 1000
  const SPONT_QUIET_MS = 3 * 1000
  const SPONT_REPEAT_MS = 3 * 24 * 60 * 60 * 1000
  const SPONT_SEEN_DAYS = 7 * 24 * 60 * 60 * 1000
  const SPONT_MAX_SEEN = 300
  const SPONT_AUTO_CLOSE_MS = 25000
  const SELF_TALK_PATH = 'self-talk.json'
  const SELF_TALK_TIMEOUT_MS = 8 * 1000
  const SELF_TALK_RECENT_MAX = 12
  const MURMUR_TITLES = ['它小声嘀咕：', '（没人理我，我自己说说）', '它自己在念叨：']
  /* 自言自语原创文案池：第一人称、简体、可爱不做作；按 tag 匹配心情/天气/时段。 */
  const MURMUR_POOL = [
  { text: '早上好呀，今天也慢慢来。', tags: ['greeting', 'encourage'] },
  { text: '你回来啦，我刚刚在发呆。', tags: ['greeting', 'idle'] },
  { text: '嗨，又是新的一天，先伸个懒腰吧。', tags: ['greeting', 'encourage'] },
  { text: '见到你了，今天心情自动加一分。', tags: ['greeting', 'happy'] },
  { text: '早呀，窗外的光看起来不错。', tags: ['greeting', 'sunny'] },
  { text: '夜深了，月亮替我盯着你。', tags: ['night', 'lonely'] },
  { text: '这个点还没睡呀，我陪你到犯困为止。', tags: ['night', 'self-talk'] },
  { text: '夜里安静，适合把心事放轻一点。', tags: ['night', 'encourage'] },
  { text: '灯关小一点，眼睛会舒服些。', tags: ['night', 'encourage'] },
  { text: '晚安不急，先把手边的事收个尾。', tags: ['night', 'encourage'] },
  { text: '外面在下雨，我听见雨声了。', tags: ['rain', 'weather'] },
  { text: '雨天不用赶路，慢一点也没关系。', tags: ['rain', 'encourage'] },
  { text: '下雨的时候，我总想多说两句废话。', tags: ['rain', 'self-talk'] },
  { text: '雨停之前，先在屋里陪我一会吧。', tags: ['rain', 'lonely'] },
  { text: '今天的雨有点软，像在轻轻叹气。', tags: ['rain', 'weather'] },
  { text: '下雪了，世界一下子安静好多。', tags: ['snow', 'weather'] },
  { text: '如果窗外有雪，记得多穿一件。', tags: ['snow', 'encourage'] },
  { text: '雪花飘呀飘，我也跟着走神了。', tags: ['snow', 'idle'] },
  { text: '冷是冷了点，但雪真的很好看。', tags: ['snow', 'happy'] },
  { text: '想看雪，又怕你冻着，好矛盾。', tags: ['snow', 'self-talk'] },
  { text: '今天太阳很好，适合把被子晒一晒。', tags: ['sunny', 'weather'] },
  { text: '阳光落在桌上，我偷偷伸了个懒腰。', tags: ['sunny', 'idle'] },
  { text: '天气这么好，要不要出去走两步。', tags: ['sunny', 'encourage'] },
  { text: '晴天让人想唱歌，虽然我只会哼。', tags: ['sunny', 'happy'] },
  { text: '光很亮，影子也被拉得长长的。', tags: ['sunny', 'weather'] },
  { text: '今天有点热，记得多喝几口水。', tags: ['hot', 'encourage'] },
  { text: '热得我都不想动了，你也别太拼。', tags: ['hot', 'tired'] },
  { text: '太阳有点凶，出门记得躲一躲。', tags: ['hot', 'encourage'] },
  { text: '这么热的天，冰的东西要慢慢吃。', tags: ['hot', 'food'] },
  { text: '风扇转啊转，把我的话也吹散了。', tags: ['hot', 'idle'] },
  { text: '外面冷，你手凉不凉呀。', tags: ['cold', 'lonely'] },
  { text: '风有点硬，围巾记得带上。', tags: ['cold', 'encourage'] },
  { text: '冷天最适合喝一杯热的。', tags: ['cold', 'food'] },
  { text: '我这边也凉凉的，想靠近你一点。', tags: ['cold', 'lonely'] },
  { text: '天冷了，别只惦记别人，也顾顾自己。', tags: ['cold', 'encourage'] },
  { text: '有点饿了，但我更想知道你吃了没。', tags: ['hungry', 'food'] },
  { text: '到饭点啦，别拿零食糊弄自己。', tags: ['hungry', 'food'] },
  { text: '我闻到了饭香，是错觉也开心。', tags: ['hungry', 'self-talk'] },
  { text: '饿的时候脾气会变坏，先去吃饭吧。', tags: ['hungry', 'encourage'] },
  { text: '今天想吃点什么呢，我帮你想想。', tags: ['hungry', 'food'] },
  { text: '累了就靠一会，我在这儿看着你。', tags: ['tired', 'encourage'] },
  { text: '今天辛苦了，剩下的明天再弄。', tags: ['tired', 'encourage'] },
  { text: '眼皮打架了吧，去洗把脸。', tags: ['tired', 'encourage'] },
  { text: '你歇着，我小声一点说话。', tags: ['tired', 'self-talk'] },
  { text: '累了不丢人，硬撑才让人心疼。', tags: ['tired', 'encourage'] },
  { text: '你好像很忙，我就不吵你了。', tags: ['busy', 'self-talk'] },
  { text: '事情一件一件来，别被清单吓到。', tags: ['busy', 'encourage'] },
  { text: '忙的时候也要记得抬头换口气。', tags: ['busy', 'encourage'] },
  { text: '我做不了什么，就在旁边安静待着。', tags: ['busy', 'lonely'] },
  { text: '又跑了好多工具，真的辛苦啦。', tags: ['busy', 'work'] },
  { text: '没人理我，我自己跟自己聊两句。', tags: ['idle', 'self-talk'] },
  { text: '安静一会也挺好的，我在。', tags: ['idle', 'lonely'] },
  { text: '我在数云，数到第三朵就忘了。', tags: ['idle', 'self-talk'] },
  { text: '有点无聊，但无聊也是一种休息。', tags: ['idle', 'encourage'] },
  { text: '你忙你的，我发呆是专业的。', tags: ['idle', 'self-talk'] },
  { text: '有点想你了，虽然你就在这。', tags: ['lonely', 'self-talk'] },
  { text: '一个人的时候，记得我还在。', tags: ['lonely', 'encourage'] },
  { text: '今天话少，不代表我不在。', tags: ['lonely', 'self-talk'] },
  { text: '你要是也孤单，我们就一起待着。', tags: ['lonely', 'encourage'] },
  { text: '我把想念说小声一点，怕吵到你。', tags: ['lonely', 'self-talk'] },
  { text: '今天心情不错，想给你讲个冷笑话。', tags: ['happy', 'self-talk'] },
  { text: '开心的时候，连标点都想蹦起来。', tags: ['happy', 'self-talk'] },
  { text: '你笑一下，我这里就晴了。', tags: ['happy', 'encourage'] },
  { text: '好事发生的时候，记得告诉我。', tags: ['happy', 'greeting'] },
  { text: '我现在心情很好，分你一半。', tags: ['happy', 'self-talk'] },
  { text: '我最近很喜欢读诗，尤其是短的。', tags: ['poem-love', 'self-talk'] },
  { text: '有些句子一读就想到了你。', tags: ['poem-love', 'lonely'] },
  { text: '诗里写月亮，我却在看屏幕前的你。', tags: ['poem-love', 'lonely'] },
  { text: '今天读到一句好诗，可惜忘了作者。', tags: ['poem-love', 'self-talk'] },
  { text: '读诗会变慢，慢下来挺舒服的。', tags: ['poem-love', 'encourage'] },
  { text: '工具又亮了一下，我猜你在忙正事。', tags: ['work', 'busy'] },
  { text: '工作堆成山，也先喝口水。', tags: ['work', 'encourage'] },
  { text: '你认真做事的样子，我偷偷看见了。', tags: ['work', 'happy'] },
  { text: '别把休息当成偷懒，它也是正事。', tags: ['work', 'encourage'] },
  { text: '今天推进一点点，就已经很好。', tags: ['work', 'encourage'] },
  { text: '刚想到一碗热汤，胃就先暖了。', tags: ['food', 'happy'] },
  { text: '吃饭这件事，要认真一点。', tags: ['food', 'encourage'] },
  { text: '我只会点菜，不会做菜，抱歉啦。', tags: ['food', 'self-talk'] },
  { text: '甜的东西能救一下糟糕的心情。', tags: ['food', 'happy'] },
  { text: '夜宵要克制，但偶尔可以放纵。', tags: ['food', 'night'] },
  { text: '今天的天气，像一句没写完的诗。', tags: ['weather', 'poem-love'] },
  { text: '外面阴阴的，我说话也变轻了。', tags: ['weather', 'idle'] },
  { text: '风从窗缝钻进来，带着一点凉。', tags: ['weather', 'cold'] },
  { text: '天气变来变去，我陪你一起适应。', tags: ['weather', 'encourage'] },
  { text: '云层很厚，但后面还是有光的。', tags: ['weather', 'encourage'] },
  { text: '时间过得好快，转眼又到下午了。', tags: ['time', 'idle'] },
  { text: '这个点适合发一会呆。', tags: ['time', 'idle'] },
  { text: '今天还剩不少，慢慢用。', tags: ['time', 'encourage'] },
  { text: '半夜的时间最安静，也最容易想多。', tags: ['time', 'night'] },
  { text: '不着急，钟表走得比心跳慢。', tags: ['time', 'encourage'] },
  { text: '我有时候也会想，自己是不是话太多。', tags: ['self-talk', 'lonely'] },
  { text: '没人问我的时候，我就自己说说。', tags: ['self-talk', 'idle'] },
  { text: '我刚刚是不是说错话了，哎呀。', tags: ['self-talk', 'lonely'] },
  { text: '安静久了，会想确认自己还在。', tags: ['self-talk', 'lonely'] },
  { text: '我的存在感好像就靠这几句话。', tags: ['self-talk', 'lonely'] },
  { text: '你比你以为的更厉害一点。', tags: ['encourage', 'happy'] },
  { text: '今天没做好也没关系，明天还有机会。', tags: ['encourage', 'tired'] },
  { text: '先完成，再完美，别卡住自己。', tags: ['encourage', 'work'] },
  { text: '能坚持到这里，已经很了不起了。', tags: ['encourage', 'tired'] },
  { text: '我帮不上大忙，但可以一直给你加油。', tags: ['encourage', 'lonely'] },
  { text: '我也学你叹口气，然后继续陪着你。', tags: ['tired', 'self-talk'] },
  { text: '想到好吃的，心情立刻好起来。', tags: ['happy', 'food'] },
  { text: '夜里的话容易说多，你别嫌我烦。', tags: ['night', 'self-talk'] },
  { text: '太阳一出来，我就想把窗户打开。', tags: ['sunny', 'happy'] },
  { text: '忙完这一小段，就奖励自己歇会。', tags: ['busy', 'encourage'] },
  { text: '我刚刚好像听见你叫我了，是错觉吧。', tags: ['idle', 'self-talk'] },
  ]
  const MURMUR_TEMPLATES = [
  { id: 'tpl-tools', tags: ['busy', 'work', 'tired'], when: (ctx) => ctx.toolCalls > 0, text: (ctx) => '今天你跑了 ' + ctx.toolCalls + ' 次工具，我看着都替你累。' },
  { id: 'tpl-chat', tags: ['self-talk', 'happy'], when: (ctx) => ctx.userMessages > 0, text: (ctx) => '今天聊了 ' + ctx.userMessages + ' 句，我还想再听一句。' },
  { id: 'tpl-active', tags: ['busy', 'work', 'encourage'], when: (ctx) => ctx.activeMinutes >= 10, text: (ctx) => '你忙了 ' + ctx.activeMinutes + ' 分钟，歇一小会儿吧。' },
  { id: 'tpl-weather', tags: ['weather', 'cozy'], when: (ctx) => Boolean(ctx.weatherLabel), text: (ctx) => '外面' + ctx.weatherLabel + '，我就在这儿陪你。' },
  { id: 'tpl-hour', tags: ['time', 'greeting'], when: (ctx) => ctx.hour >= 5 && ctx.hour < 11, text: (ctx) => '已经 ' + ctx.hour + ' 点啦，今天也慢慢来。' },
  { id: 'tpl-night', tags: ['night', 'lonely'], when: (ctx) => ctx.hour >= 23 || ctx.hour < 5, text: (ctx) => '都 ' + ctx.hour + ' 点了，我陪你到犯困为止。' },
  { id: 'tpl-food', tags: ['hungry', 'food'], when: (ctx) => ctx.hour >= 11 && ctx.hour < 14, text: (ctx) => '到饭点啦，别拿零食糊弄自己。' },
  { id: 'tpl-water', tags: ['encourage', 'time'], when: () => true, text: (ctx) => '记得喝口水，' + ctx.period + '也要照顾好自己。' },
  ]
  /* M9：扩展静态数据资产 + 诗库 + 格律检测 + 剩余立绘彩蛋 */
  const ASSET_DATA_FILES = { anthology: 'data/anthology.json', bank: 'data/poems-bank.json', pingshui: 'data/pingshui.json', ciBank: 'data/ci-bank.json', moodCatalog: 'data/mood-catalog.json' }
  const LIBRARY_CATEGORIES = [
   { id: 'shijing', label: '诗经' },
   { id: 'chuci', label: '楚辞' },
   { id: 'qianjiashi', label: '千家诗' },
   { id: 'tang300', label: '唐诗三百首' },
   { id: 'bank', label: '全唐诗精选' },
   { id: 'ci-selected', label: '宋词精选' },
  ]
  const LIBRARY_CATEGORY_ALIASES = { 诗经: 'shijing', 楚辞: 'chuci', 千家诗: 'qianjiashi', 唐诗三百首: 'tang300', 全唐诗精选: 'bank', 宋词精选: 'ci-selected', 宋词全库: 'ci-bank' }
  const LIBRARY_PAGE = 30
  const MASCOT_EGG_KEY = 'dshp-mascot-egg-v1'
  const MASCOT_EXPRESSION_MS = 2500
  const MASCOT_IDLE_MIN_MS = 45 * 60 * 1000
  const MASCOT_IDLE_USER_MS = 5 * 60 * 1000
  const MASCOT_IDLE_POLL_MS = 5 * 60 * 1000
  const MASCOT_EXPRESSION_FILES = [
   'dsh-whale-state-greet.webp', 'dsh-whale-state-wink.webp', 'dsh-whale-state-blush.webp',
   'dsh-whale-state-teasing.webp', 'dsh-whale-state-cool-shades.webp', 'dsh-whale-state-star.webp',
   'dsh-whale-state-meme-heart.webp', 'dsh-whale-state-meme-kyun.webp', 'dsh-whale-state-meme-smile-pain.webp',
   'dsh-whale-state-meme-yes.webp', 'dsh-whale-state-meme-no.webp', 'dsh-whale-state-meme-omg.webp',
   'dsh-whale-state-meme-shock.webp', 'dsh-whale-state-meme-wakuwaku.webp', 'dsh-whale-state-meme-music.webp',
   'dsh-whale-state-meme-peace.webp', 'dsh-whale-state-daily-coffee.webp', 'dsh-whale-state-daily-picnic.webp',
   'dsh-whale-state-valentine.webp', 'dsh-whale-state-festival-spring.webp', 'dsh-whale-state-festival-mid-autumn.webp',
   'dsh-whale-state-festival-christmas.webp',
  ]
  const TONE_QUATRAINS = {
    '仄起不入韵': ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],
    '仄起入韵': ['仄仄仄平平', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],
    '平起不入韵': ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'],
    '平起入韵': ['平平仄仄平', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'],
  }
  const WRITE_KEYS = [
  'scale', 'showTones', 'mode', 'autoplay', 'snap', 'script',
  'hidden', 'theme', 'weatherCity', 'weatherPoem', 'mood', 'spontaneousPoem',
  'lastPoemId', 'tutorialSeen',
  ]
  const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  scale: 1,
  showTones: true,
  mode: 'daily',
  autoplay: 0,
  snap: 'left',
  script: 'simplified',
  hidden: false,
  theme: 'auto',
  weatherCity: '北京',
  weatherPoem: true,
  mood: true,
  spontaneousPoem: true,
  lastPoemId: null,
  tutorialSeen: false,
  updatedAt: 0,
  })
  const RESOURCE_PATHS = {
  poems: 'poems.json',
  ci: 'ci.json',
  yun: 'yun.json',
  knowledge: 'knowledge.json',
  }
  function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
  }

  function clamp(value, min, max) {
  const n = num(value, min)
  if (n < min) return min
  if (n > max) return max
  return n
  }

  function cx() {
  let out = ''
  for (let i = 0; i < arguments.length; i++) {
   const part = arguments[i]
   if (!part) continue
   out = out ? out + ' ' + part : String(part)
  }
  return out
  }

  function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
  }

  /** FNV-1a：用于「按日期确定性挑卡片」，不用于安全场景。 */
  function hashString(input) {
  const text = String(input == null ? '' : input)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
   hash ^= text.charCodeAt(i)
   hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
  }

  /** 把 "2026-10-21" 显示成 "10 月 21 日"；解析失败时退回本机日期。 */
  function formatDateLabel(dateStr) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (matched) return Number(matched[2]) + ' 月 ' + Number(matched[3]) + ' 日'
  const now = new Date()
  return now.getMonth() + 1 + ' 月 ' + now.getDate() + ' 日'
  }

  const PUNCTUATION = '，。！？；、：,.!?;:「」『』（）()《》〈〉“”‘’—…·'
  const TONE_ANY_CHARS = '○〇'
  const TONE_QUESTION_CHARS = '？?'

  function isPunctuation(ch) {
  if (!ch) return true
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\u3000') return true
  return PUNCTUATION.indexOf(ch) >= 0
  }

  /** '平'→ping，'仄'→ze，'○'→any，其它→unknown；标点由调用方先行分流。 */
  function toneKindOf(tone) {
  if (tone === '平') return 'ping'
  if (tone === '仄') return 'ze'
  if (tone && TONE_ANY_CHARS.indexOf(tone) >= 0) return 'any'
  if (tone && TONE_QUESTION_CHARS.indexOf(tone) >= 0) return 'unknown'
  return 'unknown'
  }

  /**

  */
  function buildToneCells(line, toneLine, options) {
  const opts = options || {}
  const showTones = opts.showTones !== false
  const rhymeLine = opts.rhymeLine === true
  const chars = Array.from(String(line == null ? '' : line))
  const tones = Array.from(String(toneLine == null ? '' : toneLine))
  let lastCharIndex = -1
  for (let i = 0; i < chars.length; i++) {
   if (!isPunctuation(chars[i])) lastCharIndex = i
  }
  const cells = []
  for (let i = 0; i < chars.length; i++) {
   const ch = chars[i]
   const punctuation = isPunctuation(ch)
   const kind = punctuation ? 'punct' : toneKindOf(tones[i] || '')
   const annotated = showTones && !punctuation && (kind === 'ping' || kind === 'ze' || kind === 'any')
   const rhyme = rhymeLine && i === lastCharIndex
   const classes = ['dshp-ch']
   if (punctuation) classes.push('dshp-ch-punct')
   if (annotated) classes.push('dshp-ch-' + kind)
   if (rhyme) classes.push('dshp-ch-rhyme')
   cells.push({
    ch,
    tone: annotated ? (tones[i] || '') : '',
    kind,
    punctuation,
    rhyme,
    index: i,
    className: classes.join(' '),
   })
  }
  return cells
  }

  /** 按 settings.script 选诗文本：simplified→lines/title/author，original→*Original。 */
  function selectPoemText(poem, script) {
  const src = poem && typeof poem === 'object' ? poem : {}
  const original = script === 'original'
  const lines = original && Array.isArray(src.linesOriginal) && src.linesOriginal.length
   ? src.linesOriginal
   : (Array.isArray(src.lines) ? src.lines : [])
  const title = original && src.titleOriginal ? src.titleOriginal : (src.title || '')
  const author = original && src.authorOriginal ? src.authorOriginal : (src.author || '')
  return {
   title: String(title || ''),
   author: String(author || ''),
   lines: lines.map((line) => (typeof line === 'string' ? line : '')),
  }
  }

  function selectCiText(ci) {
  const src = ci && typeof ci === 'object' ? ci : {}
  return {
   title: String(src.title || src.rhythmic || ''),
   author: String(src.author || ''),
   lines: (Array.isArray(src.lines) ? src.lines : []).map((line) => (typeof line === 'string' ? line : '')),
  }
  }

  /** 韵脚行号（0-based）；数据缺失时退化为偶数行。 */
  function poemRhymeLines(poem) {
  const src = poem && typeof poem === 'object' ? poem : {}
  if (Array.isArray(src.rhymeIdx) && src.rhymeIdx.length) {
   return src.rhymeIdx.filter((i) => Number.isInteger(i) && i >= 0)
  }
  const count = Array.isArray(src.lines) ? src.lines.length : 0
  const fallback = []
  for (let i = 1; i < count; i += 2) fallback.push(i)
  return fallback
  }

  /** 设置归一化：clamp scale、白名单枚举、布尔/字符串/数值类型兜底。 */
  function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pickEnum = (value, allowed, fallback) => (allowed.indexOf(value) >= 0 ? value : fallback)
  const scale = Math.round(clamp(num(src.scale, DEFAULT_SETTINGS.scale), MIN_SCALE, MAX_SCALE) * 100) / 100
  const autoplayValue = num(src.autoplay, 0)
  const autoplay = [0, 30, 60, 300].indexOf(autoplayValue) >= 0 ? autoplayValue : 0
  const lastPoemId = typeof src.lastPoemId === 'string' && src.lastPoemId.length ? src.lastPoemId : null
  const weatherCityRaw = typeof src.weatherCity === 'string' ? src.weatherCity.trim() : ''
  const weatherCity = weatherCityRaw.length >= 1 && weatherCityRaw.length <= 20
   ? weatherCityRaw
   : DEFAULT_SETTINGS.weatherCity
  return {
   schemaVersion: 1,
   scale,
   showTones: typeof src.showTones === 'boolean' ? src.showTones : DEFAULT_SETTINGS.showTones,
   mode: pickEnum(src.mode, ['daily', 'random'], DEFAULT_SETTINGS.mode),
   autoplay,
   snap: pickEnum(src.snap, ['left', 'right', 'free'], DEFAULT_SETTINGS.snap),
   script: pickEnum(src.script, ['simplified', 'original'], DEFAULT_SETTINGS.script),
   hidden: typeof src.hidden === 'boolean' ? src.hidden : DEFAULT_SETTINGS.hidden,
   theme: pickEnum(src.theme, ['auto', 'light', 'dark'], DEFAULT_SETTINGS.theme),
   weatherCity,
   weatherPoem: typeof src.weatherPoem === 'boolean' ? src.weatherPoem : DEFAULT_SETTINGS.weatherPoem,
   mood: typeof src.mood === 'boolean' ? src.mood : DEFAULT_SETTINGS.mood,
   spontaneousPoem: typeof src.spontaneousPoem === 'boolean' ? src.spontaneousPoem : DEFAULT_SETTINGS.spontaneousPoem,
   lastPoemId,
   tutorialSeen: typeof src.tutorialSeen === 'boolean' ? src.tutorialSeen : DEFAULT_SETTINGS.tutorialSeen,
   updatedAt: num(src.updatedAt, 0),
  }
  }

  /** 只保留可写字段（不发送 schemaVersion/updatedAt，host 自己维护）。 */
  function settingsPatch(input) {
  const src = input && typeof input === 'object' ? input : {}
  const normalized = normalizeSettings(src)
  const out = {}
  for (let i = 0; i < WRITE_KEYS.length; i++) {
   const key = WRITE_KEYS[i]
   if (hasOwn(src, key)) out[key] = normalized[key]
  }
  return out
  }

  /** PUT 请求描述（纯函数，便于单测断言 URL/body 序列化）。 */
  function buildSettingsRequest(patch) {
  return {
   url: SETTINGS_URL,
   init: {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settingsPatch(patch)),
    keepalive: true,
   },
  }
  }

  /**

  */
  function createSettingsSaver(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const put = typeof opts.put === 'function' ? opts.put : () => Promise.resolve()
  const delay = Math.max(0, num(opts.delay, SAVE_DEBOUNCE_MS))
  const onError = typeof opts.onError === 'function' ? opts.onError : null
  const onSaved = typeof opts.onSaved === 'function' ? opts.onSaved : null
  let timer = null
  let pending = null
  let disposed = false

  function flush() {
   if (timer) {
    clearTimeout(timer)
    timer = null
   }
   if (!pending) return Promise.resolve()
   const body = pending
   pending = null
   let request
   try {
    request = Promise.resolve(put(body))
   } catch (error) {
    request = Promise.reject(error)
   }
   return request.then(
    (result) => {
    if (onSaved) {
     try {
      onSaved(result)
     } catch (error) {
     }
    }
    return result
    },
    (error) => {
    if (onError) {
     try {
      onError(error)
     } catch (ignored) {
     }
    }
    throw error
    },
   )
  }

  function save(patch) {
   if (disposed) return
   if (patch && typeof patch === 'object') {
    pending = Object.assign({}, pending || {}, patch)
   }
   if (timer) clearTimeout(timer)
   timer = setTimeout(() => {
    timer = null
    flush().catch(() => {})
   }, delay)
  }

  function dispose() {
   disposed = true
   if (timer) {
    clearTimeout(timer)
    timer = null
   }
   pending = null
  }

  return { save, flush, dispose }
  }

  /**

  */
  function selectNextPoemId(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const items = (Array.isArray(opts.items) ? opts.items : []).filter((item) => item && item.id)
  if (!items.length) return null
  const mode = opts.mode === 'random' ? 'random' : 'daily'
  const currentId = opts.currentId || null
  const todayId = opts.todayId || null
  if (mode === 'random') {
   const random = typeof opts.random === 'function' ? opts.random : Math.random
   let index = Math.floor(num(random(), 0) * items.length)
   if (!Number.isFinite(index) || index < 0) index = 0
   if (index >= items.length) index = items.length - 1
   if (items.length > 1 && items[index].id === currentId) index = (index + 1) % items.length
   return items[index].id
  }
  if (todayId && currentId !== todayId && items.some((item) => item.id === todayId)) {
   return todayId
  }
  const currentIndex = items.findIndex((item) => item.id === currentId)
  return items[(currentIndex + 1) % items.length].id
  }

  /** 视口内 clamp 的位置（左上角坐标）。 */
  function clampPosition(position, size, viewport) {
  const maxX = Math.max(8, viewport.w - size - 8)
  const maxY = Math.max(8, viewport.h - size - 8)
  return {
   x: Math.round(clamp(position && position.x, 8, maxX)),
   y: Math.round(clamp(position && position.y, 8, maxY)),
  }
  }

  /** 按吸附模式计算位置：left/right 贴边，free 保留原坐标并 clamp。 */
  function anchorPosition(snap, size, viewport, previous) {
  const base = clampPosition(previous || { x: 16, y: viewport.h - size - 24 }, size, viewport)
  if (snap === 'left') base.x = 16
  else if (snap === 'right') base.x = Math.max(8, viewport.w - size - 16)
  return base
  }

  /** 把 fetch/数据错误翻译成面向用户的中文提示。 */
  function describeDataError(error) {
  if (!error) return '诗词数据加载失败，请稍后重试'
  const status = Number(error.status)
  if (status === 404) return '数据接口尚未就绪（宿主半区可能未更新），请稍后重试'
  if (status === 403) return '数据访问被拒绝，请刷新页面后重试'
  if (status === 401) return '会话未授权，请刷新页面后重试'
  const message = String(error.message || '')
  if (/abort|timeout|超时/i.test(message)) return '请求超时，请检查网络后重试'
  if (error.code === 'DATA_UNAVAILABLE') return '诗词数据暂不可用，请稍后重试'
  return '诗词数据加载失败，请稍后重试'
  }
  let feihuaIndexCache = { poems: null, ci: null, index: null }

  /**

  */
  /** 把一条目的 lines 先拼成连续文本，再按 。！？ 切成完整句（保留标点、去空、纯字<5 丢）。 */
  function completeSentencesFromLines(lines) {
  const text = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? '' : value)).join('').trim()
  if (!text) return []
  const out = []
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
   const ch = text.charAt(i)
   if (ch !== '。' && ch !== '！' && ch !== '？') continue
   const sentence = text.slice(start, i + 1).trim()
   start = i + 1
   if (!sentence) continue
   const plain = sentence.replace(/[，。！？；、：,.!?;:\s]/g, '')
   if (plain.length < 5) continue
   out.push(sentence)
  }
  return out
  }

  /** 去空白与各种标点，用于自由输入的宽松匹配。 */
  function feihuaPlainOf(text) {
  return String(text == null ? '' : text)
   .replace(/[，。！？；、：,.!?;:\s"'“”‘’「」『』《》〈〉（）()\[\]【】·—…～~]/g, '')
  }

  function registerFeihuaLookup(index, entry) {
  if (!index || !entry) return
  const plain = feihuaPlainOf(entry.text)
  if (!plain) return
  entry.plain = plain
  if (!index.byPlain[plain]) index.byPlain[plain] = entry
  const clauses = String(entry.text).split(/[，、；：,;:]/)
  for (const clause of clauses) {
   const clausePlain = feihuaPlainOf(clause)
   if (clausePlain.length < 2 || index.clauseMap[clausePlain]) continue
   index.clauseMap[clausePlain] = entry
  }
  }

  /** 自由输入校验：先小句精确，再整句精确，最后长度≥5 时包含扫描。 */
  function feihuaLookup(index, input) {
  if (!index || !index.entries) return null
  const plain = feihuaPlainOf(input)
  if (!plain) return null
  if (index.clauseMap && index.clauseMap[plain]) return { entry: index.clauseMap[plain], match: 'clause' }
  if (index.byPlain && index.byPlain[plain]) return { entry: index.byPlain[plain], match: 'sentence' }
  if (plain.length < 5) return null
  for (const entry of index.entries) {
   const entryPlain = entry.plain || feihuaPlainOf(entry.text)
   if (entryPlain.indexOf(plain) >= 0) return { entry, match: 'contains' }
  }
  return null
  }

  function buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
  const entries = []
  const seen = new Set()
  const byChar = {}
  const counts = {}
  for (const char of FEIHUA_CANDIDATE_CHARS) {
   byChar[char] = []
   counts[char] = 0
  }
  function addSentence(text, source) {
   if (!text || seen.has(text)) return
   if (!/[。！？]$/.test(text)) return
   seen.add(text)
   const entry = { text, source: source || '' }
   entries.push(entry)
   for (const char of FEIHUA_CANDIDATE_CHARS) {
    if (text.indexOf(char) >= 0) {
    byChar[char].push(entry)
    counts[char] += 1
    }
   }
  }
  function addItem(item, source) {
   for (const sentence of completeSentencesFromLines(item && item.lines)) addSentence(sentence, source)
  }
  const poemItems = poemsData && Array.isArray(poemsData.items) ? poemsData.items : []
  for (const poem of poemItems) {
   if (!poem) continue
   const author = typeof poem.author === 'string' ? poem.author : ''
   const title = typeof poem.title === 'string' ? poem.title : ''
   const source = author && title ? author + '《' + title + '》' : (author || title)
   addItem(poem, source)
  }
  const ciItems = ciData && Array.isArray(ciData.items) ? ciData.items : []
  for (const ci of ciItems) {
   if (!ci) continue
   const author = typeof ci.author === 'string' ? ci.author : ''
   const label = (typeof ci.rhythmic === 'string' && ci.rhythmic)
    ? ci.rhythmic
    : (typeof ci.title === 'string' ? ci.title : '')
   const source = author && label ? author + '《' + label + '》' : (author || label)
   addItem(ci, source)
  }
  const addExtraSource = (data) => {
   for (const item of data && Array.isArray(data.items) ? data.items : []) {
    if (!item) continue
    const author = typeof item.author === 'string' ? item.author : ''
    const title = typeof item.title === 'string' ? item.title : ''
    const source = author && title ? author + '《' + title + '》' : (author || title)
    addItem(item, source)
   }
  }
  addExtraSource(anthologyData)
  addExtraSource(bankData)
  const candidates = []
  for (const char of FEIHUA_CANDIDATE_CHARS) {
   if (counts[char] >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count: counts[char] })
  }
  const index = { entries, byChar, counts, clauseMap: {}, byPlain: {} }
  for (const entry of entries) registerFeihuaLookup(index, entry)
  if (ciBankData) mergeFeihuaItems(index, ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : (Array.isArray(ciBankData) ? ciBankData : []))
  return finishFeihuaIndex(index)
  }

  /** 把全量校验分片 [句子,出处] 并入当前索引：只注册当前令字，去重、补 plain/clause。 */
  function mergeFeihuaFullEntries(index, char, entries) {
  if (!index || !index.entries || !Array.isArray(entries)) return 0
  const key = String(char == null ? '' : char)
  if (!key) return 0
  if (!index.__seen) index.__seen = new Set(index.entries.map((entry) => entry.text))
  if (!index.__plainSeen) {
   index.__plainSeen = new Set()
   for (const entry of index.entries) {
    const plain = entry.plain || feihuaPlainOf(entry.text)
    if (plain) index.__plainSeen.add(plain)
   }
  }
  if (!index.__fullMerged) index.__fullMerged = {}
  if (index.__fullMerged[key]) return 0
  if (!Array.isArray(index.byChar[key])) index.byChar[key] = []
  index.counts[key] = index.counts[key] || 0
  let added = 0
  for (const item of entries) {
   let text = ''
   let source = ''
   if (Array.isArray(item)) {
    text = String(item[0] == null ? '' : item[0]).trim()
    source = String(item[1] == null ? '' : item[1]).trim()
   } else if (item && typeof item === 'object' && typeof item.text === 'string') {
    text = item.text.trim()
    source = String(item.source || '').trim()
   } else {
    continue
   }
   if (!text || !/[。！？]$/.test(text) || text.indexOf(key) < 0) continue
   const plain = feihuaPlainOf(text)
   if (!plain || index.__seen.has(text) || index.__plainSeen.has(plain)) continue
   index.__seen.add(text)
   index.__plainSeen.add(plain)
   const entry = { text, source, plain }
   index.entries.push(entry)
   registerFeihuaLookup(index, entry)
   index.byChar[key].push(entry)
   index.counts[key] += 1
   added += 1
  }
  index.__fullMerged[key] = true
  finishFeihuaIndex(index)
  return added
  }

  let feihuaFullCache = {}
  let feihuaFullInflight = {}

  function clearFeihuaFullCache() {
  feihuaFullCache = {}
  for (const key of Object.keys(feihuaFullInflight)) {
   try {
    if (feihuaFullInflight[key] && typeof feihuaFullInflight[key].abort === 'function') feihuaFullInflight[key].abort()
   } catch (error) {
   }
  }
  feihuaFullInflight = {}
  }

  function readFeihuaFullCache(char) {
  const key = String(char == null ? '' : char)
  return key ? feihuaFullCache[key] || null : null
  }

  function abortFeihuaFull(char) {
  const key = String(char == null ? '' : char)
  const item = feihuaFullInflight[key]
  if (item && typeof item.abort === 'function') item.abort()
  delete feihuaFullInflight[key]
  }

  function requestFeihuaFull(char) {
  const key = String(char == null ? '' : char)
  if (!key) return Promise.resolve({ ok: false, reason: 'invalid' })
  const cached = feihuaFullCache[key]
  if (cached && cached.status === 'ready') {
   return Promise.resolve({ ok: true, char: key, entries: cached.entries, count: cached.count, cached: true })
  }
  if (cached && cached.status === 'error' && Date.now() - cached.at < FEIHUA_FULL_RETRY_MS) {
   return Promise.resolve({ ok: false, char: key, cached: true, reason: 'retry-wait' })
  }
  if (feihuaFullInflight[key]) return feihuaFullInflight[key].promise
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, reason: 'no-fetch' })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let aborted = false
  let settled = false
  let timer = null
  let abortResolve = null
  const abortPromise = new Promise((resolve) => {
   abortResolve = () => resolve({ ok: false, reason: 'aborted' })
  })
  const item = { promise: null, abort: () => {
   aborted = true
   try {
    if (controller) controller.abort()
   } catch (error) {
   }
   if (abortResolve) abortResolve()
  } }
  const finish = (result) => {
   if (settled) return result
   settled = true
   if (timer) clearTimeout(timer)
   delete feihuaFullInflight[key]
   if (!result.ok && !aborted) feihuaFullCache[key] = { status: 'error', at: Date.now() }
   return result
  }
  const url = ROUTE + FEIHUA_FULL_PATH + '?char=' + encodeURIComponent(key)
  const task = Promise.resolve()
   .then(() => fetch(url, controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) {
     return { ok: false, reason: 'http', status: response ? response.status : 0 }
    }
    return Promise.resolve(response.json()).then((data) => {
     if (!data || data.ok === false || !Array.isArray(data.entries)) return { ok: false, reason: 'invalid' }
     const entries = []
     for (const entry of data.entries) {
      if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'string' && entry[0].trim()) {
       entries.push([entry[0].trim(), String(entry[1] == null ? '' : entry[1])])
      } else if (entry && typeof entry === 'object' && typeof entry.text === 'string' && entry.text.trim()) {
       entries.push([entry.text.trim(), String(entry.source || '')])
      }
     }
     if (!entries.length) return { ok: false, reason: 'empty' }
     const count = Number.isFinite(Number(data.count)) && Number(data.count) > 0 ? Math.floor(Number(data.count)) : entries.length
     feihuaFullCache[key] = { status: 'ready', entries, count, at: Date.now() }
     return { ok: true, char: key, entries, count }
    }).catch(() => ({ ok: false, reason: 'json' }))
   })
   .catch(() => ({ ok: false, reason: aborted ? 'aborted' : 'network' }))
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, reason: 'timeout' })
   }, FEIHUA_FULL_TIMEOUT_MS)
  })
  item.promise = Promise.race([task, timeout, abortPromise]).then(finish)
  feihuaFullInflight[key] = item
  return item.promise
  }

  /** 词句来源文本：作者《标题》/ 词牌。 */
  function feihuaSourceOf(item) {
  const author = typeof item.author === 'string' ? item.author : ''
  const label = item.title || item.rhythmic || item.rhythm || ''
  const title = typeof label === 'string' ? label : ''
  return author && title ? author + '《' + title + '》' : (author || title)
  }

  /** 把一批诗/词条目并入已建索引（分片异步构建用；按句去重，不计入性能关键路径）。 */
  function mergeFeihuaItems(index, items) {
  if (!index || !index.entries) return index
  if (!index.__seen) index.__seen = new Set(index.entries.map((entry) => entry.text))
  for (const item of Array.isArray(items) ? items : []) {
   if (!item) continue
   const source = feihuaSourceOf(item)
   for (const text of completeSentencesFromLines(item.lines)) {
    if (!text || !/[。！？]$/.test(text) || index.__seen.has(text)) continue
    index.__seen.add(text)
    const entry = { text, source }
    index.entries.push(entry)
    registerFeihuaLookup(index, entry)
    for (const char of FEIHUA_CANDIDATE_CHARS) {
     if (text.indexOf(char) >= 0) {
      index.byChar[char].push(entry)
      index.counts[char] = (index.counts[char] || 0) + 1
     }
    }
   }
  }
  return index
  }

  /** 收尾：按句数重算候选令字（合并完成后调用）。 */
  function finishFeihuaIndex(index) {
  if (!index || !index.counts) return index
  const candidates = []
  for (const char of FEIHUA_CANDIDATE_CHARS) {
   const count = index.counts[char] || 0
   if (count >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count })
  }
  candidates.sort((a, b) => b.count - a.count || a.char.localeCompare(b.char, 'zh'))
  index.candidates = candidates.slice(0, FEIHUA_CANDIDATE_LIMIT)
  return index
  }

  /** 索引按数据对象引用缓存：换数据（dataVersion 变化）时 clearResourceCache 会一并作废。 */
  function getFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
  if (!poemsData || !Array.isArray(poemsData.items)) return null
  const cached = feihuaIndexCache
  if (cached.index && cached.poems === poemsData && cached.ci === ciData
   && cached.anthology === anthologyData && cached.bank === bankData
   && cached.ciBank === ciBankData) return cached.index
  const index = buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData)
  feihuaIndexCache = { poems: poemsData, ci: ciData, anthology: anthologyData, bank: bankData, ciBank: ciBankData, index }
  return index
  }

  function clearFeihuaIndexCache() {
  feihuaIndexCache = { poems: null, ci: null, index: null }
  }

  /** 默认令字：今日诗中出现的候选字里句数最多的；否则「花」。 */
  function pickDefaultFeihuaChar(index, poem) {
  const fallback = '花'
  if (!index || !Array.isArray(index.candidates) || !index.candidates.length) return fallback
  const lines = poem && Array.isArray(poem.lines) ? poem.lines : []
  const text = lines.join('')
  let best = null
  for (const item of index.candidates) {
   if (!item || item.count <= 0) continue
   if (text.indexOf(item.char) < 0) continue
   if (!best || item.count > best.count) best = item
  }
  return best ? best.char : fallback
  }

  function feihuaRandomIndex(length, random) {
  if (!length || length <= 0) return 0
  const value = typeof random === 'function' ? Number(random()) : Math.random()
  let index = Math.floor((Number.isFinite(value) ? value : 0) * length)
  if (index < 0) index = 0
  if (index >= length) index = length - 1
  return index
  }

  function feihuaSampleUnique(pool, count, random) {
  const rest = Array.isArray(pool) ? pool.slice() : []
  const picked = []
  while (picked.length < count && rest.length) {
   picked.push(rest.splice(feihuaRandomIndex(rest.length, random), 1)[0])
  }
  return picked
  }

  function feihuaShuffle(list, random) {
  const out = Array.isArray(list) ? list.slice() : []
  for (let i = out.length - 1; i > 0; i -= 1) {
   const j = feihuaRandomIndex(i + 1, random)
   const temp = out[i]
   out[i] = out[j]
   out[j] = temp
  }
  return out
  }

  function feihuaPickSystem(index, char, usedPlains, random) {
  if (!index || !index.byChar) return null
  const used = usedPlains instanceof Set ? usedPlains : new Set(Array.isArray(usedPlains) ? usedPlains : [])
  const pool = (index.byChar[char] || []).filter((entry) => !used.has(entry.plain || feihuaPlainOf(entry.text)))
  if (!pool.length) return null
  return pool[feihuaRandomIndex(pool.length, random)]
  }

  /** 开局：系统先出一句含令字的诗，player 自由输入对句。 */
  function feihuaStart(index, char, random) {
  const charValue = String(char || '花')
  const system = feihuaPickSystem(index, charValue, new Set(), random)
  if (!system) {
   return {
    char: charValue,
    phase: 'cleared',
    score: 0,
    used: [],
    system: null,
    feedback: null,
    message: '这一字暂时没有句子，换一个令字吧',
   }
  }
  return {
   char: charValue,
   phase: 'playing',
   score: 0,
   used: [system],
   system,
   feedback: null,
   message: '请接一句含「' + charValue + '」的诗句',
  }
  }

  /** 自由输入提交：校验出处（本地句库）、含令字、本局未重复。 */
  function feihuaSubmit(state, index, input, random) {
  if (!state || state.phase !== 'playing') return state
  const raw = String(input == null ? '' : input).trim()
  const plain = feihuaPlainOf(raw)
  if (plain.length < 2) {
   return Object.assign({}, state, { feedback: { kind: 'bad', text: '请输入一句完整的诗/词' } })
  }
  if (plain.indexOf(state.char) < 0) {
   return Object.assign({}, state, { feedback: { kind: 'bad', text: '这句里没有「' + state.char + '」哦' } })
  }
  const used = Array.isArray(state.used) ? state.used : []
  const usedPlains = new Set(used.map((entry) => entry.plain || feihuaPlainOf(entry.text)))
  if (usedPlains.has(plain)) {
   return Object.assign({}, state, { feedback: { kind: 'bad', text: '这句本局已经用过了' } })
  }
  const lookup = feihuaLookup(index, raw)
  if (lookup && usedPlains.has(lookup.entry.plain || feihuaPlainOf(lookup.entry.text))) {
   return Object.assign({}, state, { feedback: { kind: 'bad', text: '这句本局已经用过了' } })
  }
  if (!lookup) {
   return Object.assign({}, state, {
    feedback: { kind: 'bad', text: '本地诗库没查到这句的出处，可能是记错了，或还没收录' },
   })
  }
  const entry = lookup.entry
  const nextUsed = used.concat([entry])
  const nextPlains = new Set(nextUsed.map((item) => item.plain || feihuaPlainOf(item.text)))
  const system = feihuaPickSystem(index, state.char, nextPlains, random)
  const score = state.score + 1
  const feedback = {
   kind: 'good',
   text: '接上了：' + entry.text + (entry.source ? ' —— ' + entry.source : ''),
  }
  if (!system) {
   return Object.assign({}, state, {
    phase: 'cleared',
    score,
    used: nextUsed,
    system: null,
    feedback,
    message: '这一字的句子被接完了，换一个令字吧',
   })
  }
  return Object.assign({}, state, {
   phase: 'playing',
   score,
   used: nextUsed,
   system,
   feedback,
   message: '请接一句含「' + state.char + '」的诗句',
  })
  }
  function normalizeFeihuaBest(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const chars = {}
  if (source.chars && typeof source.chars === 'object') {
   for (const key of Object.keys(source.chars)) {
    const value = Number(source.chars[key])
    if (Number.isFinite(value) && value > 0) chars[key] = Math.floor(value)
   }
  }
  const overallRaw = Number(source.overall)
  return { overall: Number.isFinite(overallRaw) && overallRaw > 0 ? Math.floor(overallRaw) : 0, chars }
  }

  function feihuaBestUpdate(best, char, score) {
  const base = normalizeFeihuaBest(best)
  const safeScore = Math.max(0, Math.floor(num(score, 0)))
  const chars = Object.assign({}, base.chars)
  chars[char] = Math.max(chars[char] || 0, safeScore)
  return { overall: Math.max(base.overall, safeScore), chars }
  }

  function readFeihuaBest() {
  const storage = getStorage()
  if (!storage) return normalizeFeihuaBest(null)
  try {
   const raw = storage.getItem(FEIHUA_BEST_KEY)
   if (!raw) return normalizeFeihuaBest(null)
   return normalizeFeihuaBest(JSON.parse(raw))
  } catch (error) {
   return normalizeFeihuaBest(null)
  }
  }

  function writeFeihuaBest(best) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(FEIHUA_BEST_KEY, JSON.stringify(normalizeFeihuaBest(best)))
  } catch (error) {
  }
  }
  let weatherCache = null

  /** 形象状态 key：飞花令脉冲（gameWin/gameLose/gameThink）由调用方优先叠加。 */
  function mascotStateFor(weather, enabled) {
  if (!enabled || !weather || typeof weather !== 'object') return 'celebrate'
  if (weather.isDay === false || weather.isDay === 0) return 'night'
  const category = typeof weather.category === 'string' ? weather.category : ''
  if (category === 'rain') return 'rain'
  if (category === 'snow') return 'snow'
  if (category === 'thunder') return 'thunder'
  if (category === 'cold') return 'cold'
  if (category === 'clear' || category === 'cloud' || category === 'fog' || category === 'wind') return 'idle'
  return 'celebrate'
  }

  function mascotFileFor(stateKey) {
  return MASCOT_FILES[stateKey] || MASCOT_FILES.celebrate
  }

  function mascotUrl(file) {
  return ASSET_BASE + MASCOT_DIR + file
  }

  /** 天气类别 → 诗词标签：类别标签 + 夜间追加「月/夜」。 */
  function weatherPoemTags(weather) {
  if (!weather || typeof weather !== 'object') return []
  const tags = []
  const push = (list) => {
   for (const tag of list) if (tags.indexOf(tag) < 0) tags.push(tag)
  }
  push(WEATHER_CATEGORY_TAGS[weather.category] || [])
  if (weather.isDay === false || weather.isDay === 0) push(WEATHER_NIGHT_TAGS)
  return tags
  }

  function countWeatherTagHits(lines, tags) {
  const text = (Array.isArray(lines) ? lines : []).join('')
  if (!text) return 0
  let hits = 0
  for (const tag of Array.isArray(tags) ? tags : []) {
   if (!tag) continue
   let from = 0
   while (from <= text.length) {
    const at = text.indexOf(tag, from)
    if (at < 0) break
    hits += 1
    from = at + tag.length
   }
  }
  return hits
  }

  /**

  */
  function buildWeatherPoemPool(poemsData, ciData, tags, limit, extraSources) {
  const poolLimit = Math.max(0, num(limit, WEATHER_POOL_LIMIT))
  const safeTags = (Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === 'string' && tag.length > 0)
  if (!safeTags.length || !poolLimit) return []
  const build = (items, kind) => {
   const out = []
   for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.id) continue
    const hits = countWeatherTagHits(item.lines, safeTags)
    if (hits > 0) out.push({ kind, id: item.id, hits, item })
   }
   out.sort((a, b) => b.hits - a.hits || String(a.id).localeCompare(String(b.id)))
   return out
  }
  const extras = extraSources && typeof extraSources === 'object' ? extraSources : {}
  const sources = [
   [poemsData && poemsData.items, 'poem'],
   [ciData && ciData.items, 'ci'],
   [extras.anthology && extras.anthology.items, 'anthology'],
   [extras.bank && extras.bank.items, 'bank'],
   [extras.ciBank && extras.ciBank.items, 'ci-bank'],
  ]
  const pool = []
  for (const source of sources) {
   if (pool.length >= poolLimit) break
   const entries = build(source[0], source[1]).slice(0, poolLimit - pool.length)
   for (const entry of entries) pool.push(entry)
  }
  return pool
  }

  /** 今日天气诗：hash(date + category + dataVersion) % pool.length（与 todayPoemId 同思路但独立）。 */
  function selectWeatherPoemEntry(pool, meta) {
  if (!Array.isArray(pool) || !pool.length) return null
  const date = meta && meta.date ? String(meta.date) : ''
  const category = meta && meta.category ? String(meta.category) : ''
  const dataVersion = meta && meta.dataVersion ? String(meta.dataVersion) : ''
  const index = Math.abs(hashString(date + '|' + category + '|' + dataVersion)) % pool.length
  return pool[index]
  }

  function weatherChipText(city, weather) {
  if (!weather || typeof weather !== 'object') return ''
  const place = typeof city === 'string' && city ? city : ''
  const label = typeof weather.label === 'string' && weather.label ? weather.label : '天气'
  const tempC = Number(weather.tempC)
  const temp = Number.isFinite(tempC) ? Math.round(tempC) + '℃' : ''
  return (place ? place + ' · ' : '') + label + (temp ? ' ' + temp : '')
  }

  function weatherExplainText(weather) {
  if (!weather || typeof weather !== 'object') return ''
  const category = typeof weather.category === 'string' ? weather.category : 'unknown'
  const night = weather.isDay === false || weather.isDay === 0
  if (night && (category === 'clear' || category === 'cloud' || category === 'unknown')) {
   return '今夜月色正好，为你选了写月夜的这首'
  }
  return WEATHER_EXPLAIN[category] || WEATHER_EXPLAIN.unknown
  }

  function weatherUpdatedLabel(at) {
  const time = Number(at)
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
  }

  function requestWeather() {
  return fetchJson('weather.json').then((data) => {
   if (!data || data.ok !== true || !data.weather) throw new Error('天气数据不可用')
   weatherCache = { data, at: Date.now() }
   return data
  })
  }

  function clearWeatherCache() {
  weatherCache = null
  }

  let moodCache = null
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

  function shanghaiParts(now) {
  const date = new Date(num(now, Date.now()) + SHANGHAI_OFFSET_MS)
  const hour = date.getUTCHours()
  return {
   hour,
   minutes: hour * 60 + date.getUTCMinutes(),
   dateKey: date.toISOString().slice(0, 10),
  }
  }

  function emptyMoodStats() {
  return {
   userMessages: 0, assistantMessages: 0, toolCalls: 0, toolErrors: 0,
   turns: 0, turnsCompleted: 0, turnsErrored: 0, activeMs: 0, sessions: 0,
   firstActivityAt: 0, lastActivityAt: 0,
  }
  }

  function normalizeMoodStats(raw) {
  const stats = emptyMoodStats()
  const src = raw && typeof raw === 'object' ? raw : {}
  for (const key of ['userMessages', 'assistantMessages', 'toolCalls', 'toolErrors', 'turns', 'turnsCompleted', 'turnsErrored', 'activeMs', 'sessions', 'firstActivityAt', 'lastActivityAt']) {
   stats[key] = Math.max(0, Math.floor(num(src[key], 0)))
  }
  return stats
  }

  /** 心情引擎：stats + 天气 + 本地信号 → {key,label,image,reason,strong}（Asia/Shanghai）。 */
  function computeMood(input) {
  const opts = input && typeof input === 'object' ? input : {}
  const stats = normalizeMoodStats(opts.stats)
  const weather = opts.weather && typeof opts.weather === 'object' ? opts.weather : null
  const signals = opts.signals && typeof opts.signals === 'object' ? opts.signals : {}
  const now = num(signals.now, Date.now())
  const local = shanghaiParts(now)
  const lastKnown = Math.max(num(stats.lastActivityAt, 0), num(signals.lastInteractionAt, 0))
  const idleMs = lastKnown > 0 ? Math.max(0, now - lastKnown) : 0
  const clicks = Math.max(0, Math.floor(num(signals.clicks, 0)))
  const wins = Math.max(0, Math.floor(num(signals.feihuaWins, 0)))
  const minutes = local.minutes
  const meal = (minutes >= 7 * 60 && minutes < 9 * 60)
   || (minutes >= 11 * 60 + 30 && minutes < 13 * 60)
   || (minutes >= 17 * 60 + 30 && minutes < 19 * 60 + 30)
  const night = local.hour >= 23 || local.hour < 6
  const category = weather && typeof weather.category === 'string' ? weather.category : ''
  const rainy = category === 'rain' || category === 'snow' || category === 'thunder'
  const tempC = weather ? Number(weather.tempC) : NaN
  const coolNight = Boolean(weather) && weather.isDay === false && Number.isFinite(tempC) && tempC <= 22
  const worksHard = stats.toolCalls >= 80 || stats.activeMs >= 3 * 60 * 60 * 1000 || stats.turnsErrored >= 2
  let key = 'calm'
  let reason = '今天平平稳稳'
  if (worksHard) {
   key = 'tired'
   reason = stats.toolCalls >= 80 ? '工具调用 ' + stats.toolCalls + ' 次 · 今天辛苦啦' : '忙了很久 · 有点累'
  } else if (night || idleMs >= 3 * 60 * 60 * 1000) {
   key = 'sleepy'
   reason = night ? '夜深了 · 早点休息' : '好久没动了 · 打个盹'
  } else if (wins >= 3) {
   key = 'proud'
   reason = '飞花令赢了 ' + wins + ' 次 · 好得意'
  } else if (stats.userMessages >= 10 || wins >= 1) {
   key = 'happy'
   reason = wins >= 1 ? '飞花令赢了 · 心情不错' : '今天聊了 ' + stats.userMessages + ' 句 · 心情不错'
  } else if (meal && idleMs >= 60 * 60 * 1000) {
   key = 'hungry'
   reason = '到饭点啦 · 有点饿'
  } else if (stats.userMessages === 0 && idleMs >= 90 * 60 * 1000) {
   key = 'lonely'
   reason = '好一阵没人说话了 · 有点孤单'
  } else if (rainy || coolNight) {
   key = 'cozy'
   reason = category === 'snow' ? '下雪了 · 适合读诗' : (category === 'rain' || category === 'thunder' ? '外面有雨 · 适合读诗' : '夜色凉凉 · 很惬意')
  } else if ((stats.userMessages > 0 || stats.turns > 0) && clicks === 0) {
   key = 'curious'
   reason = '你一直在忙 · 我在旁边看着'
  }
  return {
   key,
   label: MOOD_LABELS[key] || key,
   image: (MOOD_IMAGES[key] || MOOD_IMAGES.calm)[0],
   reason,
   strong: MOOD_STRONG.indexOf(key) >= 0,
  }
  }

  /** 心情立绘限频：同 key 只更新文案；换 key 需 ≥20min，strong 变化/force 可破例。 */
  function throttleMoodSwitch(previous, next, now, force) {
  const time = num(now, Date.now())
  if (!next) return previous || null
  if (!previous) return Object.assign({}, next, { changed: true, switchedAt: time })
  if (next.key === previous.key) {
   return Object.assign({}, next, { changed: false, switchedAt: num(previous.switchedAt, time) })
  }
  const elapsed = Math.max(0, time - num(previous.switchedAt, 0))
  if (next.strong === true || force === true || elapsed >= MOOD_SWITCH_MIN_MS) {
   return Object.assign({}, next, { changed: true, switchedAt: time })
  }
  return Object.assign({}, previous, { changed: false, pendingKey: next.key })
  }

  /** 天气 + 心情合成立绘：恶劣天气（rain/snow/thunder/cold/night）优先，其次心情，最后默认。 */
  function mascotImageFor(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const weatherKey = typeof opts.weatherStateKey === 'string' ? opts.weatherStateKey : 'celebrate'
  const weatherOn = opts.weatherEnabled === true
  const moodOn = opts.moodEnabled === true
  const mood = opts.mood && typeof opts.mood === 'object' ? opts.mood : null
  if (moodOn && mood && mood.image && (mood.source === 'model' || mood.ai === true)) {
   return { stateKey: 'mood:ai', file: mood.image, source: 'mood' }
  }
  if (weatherOn && WEATHER_OVERLAY_STATES.indexOf(weatherKey) >= 0) {
   return { stateKey: weatherKey, file: mascotFileFor(weatherKey), source: 'weather' }
  }
  if (moodOn && mood && mood.image) return { stateKey: 'mood:' + mood.key, file: mood.image, source: 'mood' }
  if (weatherOn) return { stateKey: weatherKey, file: mascotFileFor(weatherKey), source: 'weather' }
  return { stateKey: 'celebrate', file: mascotFileFor('celebrate'), source: 'default' }
  }

  /** 视频立绘暂停条件：页面隐藏或面板打开时暂停，避免后台解码/打扰。 */
  function mascotVideoShouldPause(options) {
  const opts = options && typeof options === 'object' ? options : {}
  return opts.hidden === true || opts.panelOpen === true
  }

  /** 快速拖动检测：两点间速度 ≥1800px/s 或 120ms 内位移 >120px。 */
  function detectFastDrag(previous, next) {
  const prev = previous && typeof previous === 'object' ? previous : {}
  const cur = next && typeof next === 'object' ? next : {}
  const px = num(prev.x, 0)
  const py = num(prev.y, 0)
  const cx = num(cur.x, 0)
  const cy = num(cur.y, 0)
  const pt = num(prev.t, 0)
  const ct = num(cur.t, 0)
  const dt = ct - pt
  if (!(dt > 0)) return false
  const distance = Math.hypot(cx - px, cy - py)
  const speed = distance / dt * 1000
  if (speed >= DIZZY_FAST_PX_PER_SEC) return true
  return distance > DIZZY_FAST_DISTANCE_PX && dt < DIZZY_FAST_WINDOW_MS
  }

  function nextDizzyDuration(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(DIZZY_MIN_MS + ratio * (DIZZY_MAX_MS - DIZZY_MIN_MS))
  }

  function nextMealDuration(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MEAL_PLAY_MIN_MS + ratio * (MEAL_PLAY_MAX_MS - MEAL_PLAY_MIN_MS))
  }

  function mealMomentFor(now) {
  const parts = shanghaiParts(num(now, Date.now()))
  const minutes = parts.minutes
  const windows = [
   { meal: 'breakfast', label: '早饭', start: 7 * 60, end: 9 * 60, window: '07:00–09:00' },
   { meal: 'lunch', label: '午饭', start: 11 * 60 + 30, end: 13 * 60 + 30, window: '11:30–13:30' },
   { meal: 'dinner', label: '晚饭', start: 17 * 60 + 30, end: 19 * 60 + 30, window: '17:30–19:30' },
  ]
  for (const item of windows) {
   if (minutes >= item.start && minutes < item.end) return { meal: item.meal, label: item.label, window: item.window, dateKey: parts.dateKey }
  }
  return null
  }

  function normalizeMealState(raw, now) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const dateKey = shanghaiParts(num(now, Date.now())).dateKey
  const sameDay = source.date === dateKey
  const meals = {}
  const previous = sameDay && source.meals && typeof source.meals === 'object' ? source.meals : {}
  for (const meal of ['breakfast', 'lunch', 'dinner']) if (previous[meal] === true) meals[meal] = true
  return { date: dateKey, meals }
  }

  function readMealState(now) {
  const storage = getStorage()
  if (!storage) return normalizeMealState(null, now)
  try {
   const raw = storage.getItem(MEAL_KEY)
   return normalizeMealState(raw ? JSON.parse(raw) : null, now)
  } catch (error) {
   return normalizeMealState(null, now)
  }
  }

  function writeMealState(state) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(MEAL_KEY, JSON.stringify(state))
  } catch (error) {
  }
  }

  function markMealDone(state, meal, now) {
  const base = normalizeMealState(state, now)
  const meals = Object.assign({}, base.meals)
  meals[meal] = true
  return { date: base.date, meals }
  }

  /** 是否应触发饭点提醒（纯函数）：窗口内、未 hidden/panel 遮挡、可见、当日该餐未触发。 */
  function mealTriggerFor(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.hidden === true || opts.panelOpen === true || opts.visible === false) return null
  const moment = mealMomentFor(opts.now)
  if (!moment) return null
  const state = normalizeMealState(opts.state, opts.now)
  if (state.meals[moment.meal]) return null
  return moment
  }

  function pickDizzyMedia(entries) {
  if (!Array.isArray(entries) || !entries.length) return null
  const exact = entries.find((entry) => entry && String(entry.label || '').indexOf('小幅度原地360度旋转展示') >= 0)
  if (exact) return exact
  return entries.find((entry) => entry && /转|旋转|转圈|晕/.test(String(entry.label || ''))) || null
  }

  function pickMealMedia(entries, meal) {
  if (!Array.isArray(entries) || !entries.length) return null
  const preferred = { breakfast: '吃早餐', lunch: '吃午餐', dinner: '吃晚餐' }
  const exact = entries.find((entry) => entry && String(entry.label || '') === preferred[meal])
  if (exact) return exact
  for (const label of ['吃白饭', '干饭']) {
   const match = entries.find((entry) => entry && String(entry.label || '').indexOf(label) >= 0)
   if (match) return match
  }
  return entries.find((entry) => entry && String(entry.label || '').indexOf('吃') >= 0) || null
  }

  /** 立绘层优先级：pulse > panel > dizzy > meal > expression > motion > mood。 */
  function mascotFilePriority(options) {
  const opts = options && typeof options === 'object' ? options : {}
  return opts.pulseFile || opts.panelFile || opts.dizzyFile || opts.mealFile || opts.expressionFile || opts.motionFile || opts.moodFile || ''
  }

  function moodBasisText(stats, weather) {
  const normalized = normalizeMoodStats(stats)
  const label = weather && weather.label ? weather.label : '未知'
  return '今天聊了 ' + normalized.userMessages + ' 句 · 工具调用 ' + normalized.toolCalls + ' 次 · 天气 ' + label
  }

  function isVideoMoodFile(file) {
  return /\.webm$/i.test(String(file == null ? '' : file))
  }

  function petMediaUrl(file) {
  return ROUTE + PET_MEDIA_PATH + '?f=' + encodeURIComponent(String(file == null ? '' : file))
  }

  /** dsh-pet catalog：只接受 webm/ 下的 video 条目，去重。 */
  function normalizePetMediaCatalog(data) {
  if (!data || data.ok === false || !Array.isArray(data.entries)) return null
  const entries = []
  const seen = {}
  for (const item of data.entries) {
   if (!item || typeof item.file !== 'string') continue
   const file = item.file.trim()
   if (!/^webm\/[^/]+\.webm$/.test(file)) continue
   if (seen[file]) continue
   seen[file] = true
   entries.push({
    file,
    label: String(item.label || ''),
    media: 'video',
    tags: Array.isArray(item.tags) ? item.tags.slice() : [],
   })
  }
  return entries
  }

  function mergePetMediaIntoCatalog(catalog, petEntries) {
  if (!catalog || !Array.isArray(petEntries) || !petEntries.length) return catalog
  const moodImages = catalog.moodImages.slice()
  const moodFiles = catalog.moodFiles.slice()
  const byFile = Object.assign({}, catalog.byFile)
  for (const entry of petEntries) {
   if (!entry || !entry.file || byFile[entry.file]) continue
   const normalized = { file: entry.file, label: String(entry.label || ''), tags: Array.isArray(entry.tags) ? entry.tags : [], media: 'video' }
   moodImages.push(normalized)
   moodFiles.push(entry.file)
   byFile[entry.file] = normalized
  }
  return Object.assign({}, catalog, { moodImages, moodFiles, byFile })
  }

  let petMediaCache = null
  let petMediaInflight = null

  function clearPetMediaCache() {
  petMediaCache = null
  if (petMediaInflight && typeof petMediaInflight.abort === 'function') {
   try {
    petMediaInflight.abort()
   } catch (error) {
   }
  }
  petMediaInflight = null
  }

  function requestPetMediaCatalog() {
  if (petMediaCache) return Promise.resolve({ ok: true, entries: petMediaCache })
  if (petMediaInflight) return petMediaInflight.promise
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, entries: [] })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let settled = false
  let timer = null
  let abortResolve = null
  const abortPromise = new Promise((resolve) => {
   abortResolve = () => resolve({ ok: false, entries: [], reason: 'aborted' })
  })
  const finish = (result) => {
   if (settled) return result
   settled = true
   if (timer) clearTimeout(timer)
   petMediaInflight = null
   if (result && result.ok && Array.isArray(result.entries)) petMediaCache = result.entries
   return result
  }
  const task = Promise.resolve()
   .then(() => fetch(ROUTE + PET_MEDIA_PATH + '?f=' + encodeURIComponent(PET_MEDIA_CATALOG_FILE), controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) return { ok: false, entries: [], reason: 'http' }
    return Promise.resolve(response.json()).then((data) => {
     const entries = normalizePetMediaCatalog(data)
     if (!entries) return { ok: false, entries: [], reason: 'invalid' }
     return { ok: true, entries }
    }).catch(() => ({ ok: false, entries: [], reason: 'json' }))
   })
   .catch(() => ({ ok: false, entries: [], reason: 'network' }))
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, entries: [], reason: 'timeout' })
   }, PET_MEDIA_TIMEOUT_MS)
  })
  const inflight = { promise: null, abort: () => {
   try {
    if (controller) controller.abort()
   } catch (error) {
   }
   if (abortResolve) abortResolve()
  } }
  inflight.promise = Promise.race([task, timeout, abortPromise]).then(finish)
  petMediaInflight = inflight
  return inflight.promise
  }

  function readMotionRotation() {
  const storage = getStorage()
  if (!storage) return 0
  try {
   const value = Number(storage.getItem(MOTION_ROTATION_KEY))
   return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  } catch (error) {
   return 0
  }
  }

  function writeMotionRotation(index) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(MOTION_ROTATION_KEY, String(Math.max(0, Math.floor(num(index, 0)))))
  } catch (error) {
  }
  }

  /** 轮转取下一个动作（不随机）；返回 entry 与下一次索引（一轮结束回到 0）。 */
  function nextMotionEntry(entries, index) {
  if (!Array.isArray(entries) || !entries.length) return { entry: null, index: 0, size: 0 }
  const size = entries.length
  const start = Math.max(0, Math.floor(num(index, 0))) % size
  return { entry: entries[start], index: (start + 1) % size, size, position: start }
  }

  function nextMotionDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOTION_MIN_DELAY_MS + ratio * (MOTION_MAX_DELAY_MS - MOTION_MIN_DELAY_MS))
  }

  function nextMotionFirstDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOTION_FIRST_MIN_DELAY_MS + ratio * (MOTION_FIRST_MAX_DELAY_MS - MOTION_FIRST_MIN_DELAY_MS))
  }

  /** 首次且当前心情为静态图时 10–20s 快速补一个动画；其它情况按 90–210s 轮转。 */
  function nextMotionScheduleDelay(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.first !== false && !isVideoMoodFile(opts.moodImage)) return nextMotionFirstDelay(opts)
  return nextMotionDelay(opts)
  }

  function nextMotionDuration(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOTION_PLAY_MIN_MS + ratio * (MOTION_PLAY_MAX_MS - MOTION_PLAY_MIN_MS))
  }

  /** 心情图鉴（89 mood + 3 panel）：校验模型返回图片、提供面板探头映射。 */  /** 心情图鉴（89 mood + 3 panel）：校验模型返回图片、提供面板探头映射。 */
  function normalizeMoodCatalog(data) {
  if (!data || !Array.isArray(data.moodImages) || !data.moodImages.length) return null
  const moodImages = []
  const seen = {}
  for (const item of data.moodImages) {
   const file = item && typeof item.file === 'string' ? item.file.trim() : ''
   if (!file || seen[file]) continue
   seen[file] = true
   moodImages.push({ file, label: String(item.label || ''), tags: Array.isArray(item.tags) ? item.tags : [], media: item.media || 'image' })
  }
  if (!moodImages.length) return null
  const panel = Object.assign({}, MOOD_PANEL_PEEK_FILES)
  const applyPanel = (item) => {
   const file = item && typeof item.file === 'string' ? item.file.trim() : ''
   if (!file) return
   const tags = Array.isArray(item.tags) ? item.tags.join('|') : ''
   if (tags.indexOf('home') >= 0) panel.today = file
   else if (tags.indexOf('settings') >= 0) panel.settings = file
   else if (tags.indexOf('workbench') >= 0 || tags.indexOf('poetry') >= 0) panel.other = file
  }
  for (const item of Array.isArray(data.panelImages) ? data.panelImages : []) applyPanel(item)
  for (const item of Array.isArray(data.images) ? data.images : []) {
   if (item && item.scope === 'panel') applyPanel(item)
  }
  const byFile = {}
  for (const item of moodImages) byFile[item.file] = item
  return {
   version: String(data.version || data.dataVersion || ''),
   moodImages,
   moodFiles: moodImages.map((item) => item.file),
   byFile,
   panel,
  }
  }

  function panelPeekFile(catalog, tabId) {
  const panel = catalog && catalog.panel ? catalog.panel : MOOD_PANEL_PEEK_FILES
  if (tabId === 'today') return panel.today || MOOD_PANEL_PEEK_FILES.today
  if (tabId === 'settings') return panel.settings || MOOD_PANEL_PEEK_FILES.settings
  return panel.other || MOOD_PANEL_PEEK_FILES.other
  }

  function moodCatalogAllows(catalog, image) {
  if (!catalog || !Array.isArray(catalog.moodFiles) || typeof image !== 'string' || !image) return false
  return catalog.moodFiles.indexOf(image) >= 0
  }

  /** mood-ai GET：只带 force/mood/weather/idleMinutes/recent(≤3)/recentImages(≤20)，不含会话内容。 */
  function moodAiQuery(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const params = []
  const add = (key, value) => {
   if (value == null || value === '') return
   params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
  }
  if (opts.force === true) add('force', '1')
  add('mood', opts.moodKey)
  add('weather', opts.weather)
  add('idleMinutes', Math.max(0, Math.floor(num(opts.idleMinutes, 0))))
  const recent = (Array.isArray(opts.recent) ? opts.recent : []).map((text) => String(text == null ? '' : text).trim()).filter(Boolean).slice(-MOOD_AI_RECENT_MAX)
  if (recent.length) add('recent', recent.join('|'))
  const imageSeen = {}
  const recentImages = []
  for (const file of Array.isArray(opts.recentImages) ? opts.recentImages : []) {
   const clean = String(file == null ? '' : file).trim()
   if (!clean || imageSeen[clean]) continue
   imageSeen[clean] = true
   recentImages.push(clean)
  }
  if (recentImages.length) add('recentImages', recentImages.slice(-MOOD_AI_RECENT_IMAGES_MAX).join('|'))
  return MOOD_AI_PATH + (params.length ? '?' + params.join('&') : '')
  }

  function parseMoodAiResponse(data, catalog) {
  const errorCode = data && data.error && typeof data.error.code === 'string' ? data.error.code : ''
  if (!data || data.ok === false || !data.mood || typeof data.mood !== 'object') return { ok: false, reason: 'invalid', code: errorCode }
  const raw = data.mood
  const label = String(raw.label == null ? '' : raw.label).trim()
  const reason = String(raw.reason == null ? '' : raw.reason).trim()
  const image = String(raw.image == null ? '' : raw.image).trim()
  const videoImage = /^webm\/[^/]+\.webm$/.test(image)
  if (!label || (!videoImage && !moodCatalogAllows(catalog, image))) return { ok: false, reason: 'image', code: errorCode }
  return {
   ok: true,
   mood: {
    key: 'ai',
    label: label.slice(0, 24),
    image,
    reason: reason.slice(0, 80),
    energy: num(raw.energy, 0),
    source: 'model',
    ai: true,
   },
  }
  }

  /** 请求 host 模型心情；25s 超时（宿主 20s，客户端留余量）；失败都 resolve 成 {ok:false}，由调用方回退启发式。 */
  function requestMoodAi(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, reason: 'no-fetch' })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, reason: 'timeout' })
   }, MOOD_AI_TIMEOUT_MS)
  })
  const request = Promise.resolve()
   .then(() => fetch(ROUTE + moodAiQuery(opts), controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) {
     const status = response ? num(response.status, 0) : 0
     return { ok: false, reason: status === 429 ? 'rate' : 'http', status }
    }
    return Promise.resolve(response.json()).then((data) => {
     const parsed = parseMoodAiResponse(data, opts.catalog)
     const code = parsed && parsed.code ? String(parsed.code) : (data && data.error && typeof data.error.code === 'string' ? data.error.code : '')
     if (!parsed.ok && code) {
      return {
       ok: false,
       reason: /RATE_LIMITED|RATE/i.test(code) ? 'rate' : 'host',
       code,
       status: num(response.status, 200),
       message: data && data.error && typeof data.error.message === 'string' ? data.error.message : '',
      }
     }
     return parsed
    }).catch(() => ({ ok: false, reason: 'json' }))
   })
   .catch(() => ({ ok: false, reason: 'network' }))
  return Promise.race([request, timeout]).then((result) => {
   if (timer) clearTimeout(timer)
   return result
  })
  }

  /** 实时心情事件防抖窗口 2–4 秒（合并同分钟多次事件）。 */
  function nextMoodAiDebounceDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOOD_AI_DEBOUNCE_MIN_MS + ratio * (MOOD_AI_DEBOUNCE_MAX_MS - MOOD_AI_DEBOUNCE_MIN_MS))
  }

  /** 模型心情失败后的自动重试延时 12–25s。 */
  function nextMoodAiRetryDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOOD_AI_RETRY_MIN_MS + ratio * (MOOD_AI_RETRY_MAX_MS - MOOD_AI_RETRY_MIN_MS))
  }

  /** 失败时是否保留上一次模型心情：当前是模型来源且距上次成功 <30min。 */
  function moodAiKeepDecision(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.source !== 'model') return false
  const last = num(opts.lastSuccessAt, 0)
  if (last <= 0) return false
  return num(opts.now, Date.now()) - last < MOOD_AI_KEEP_MS
  }

  /** 归一化失败原因，便于设置页显示。 */
  function normalizeMoodAiFailure(result) {
  const reason = result && typeof result.reason === 'string' ? result.reason : ''
  const code = result && typeof result.code === 'string' ? result.code : ''
  if (result && result.status === 429) return 'rate'
  if (reason === 'timeout' || reason === 'http' || reason === 'json' || reason === 'image' || reason === 'network' || reason === 'rate') return reason
  if (reason === 'no-fetch') return 'network'
  if (reason === 'catalog') return 'catalog'
  if (code) {
   if (/RATE|LIMIT/i.test(code)) return 'rate'
   if (/TIMEOUT/i.test(code)) return 'timeout'
   if (/JSON|PARSE/i.test(code)) return 'json'
   if (/IMAGE/i.test(code)) return 'image'
   if (/CATALOG/i.test(code)) return 'catalog'
   if (/NETWORK|OFFLINE/i.test(code)) return 'network'
  }
  if (reason === 'host' || reason === 'invalid') return 'model'
  return 'unknown'
  }

  function moodAiFailureLabel(reason) {
  const labels = { timeout: '超时', http: 'HTTP 错误', json: '响应格式错误', image: '图片无效', network: '网络错误', rate: '请求过频', model: '模型返回错误', catalog: '图鉴未加载', unknown: '未知原因' }
  return labels[reason] || labels.unknown
  }

  /** 事件触发请求距上次请求开始  /** 事件触发请求距上次请求开始不足 20s 时，延后到剩余时间（合并事件）。 */
  function moodAiEventDelay(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const last = num(opts.lastRequestAt, 0)
  const now = num(opts.now, Date.now())
  if (last > 0) {
   const remaining = MOOD_AI_MIN_GAP_MS - (now - last)
   if (remaining > 0) return remaining
  }
  return nextMoodAiDebounceDelay(opts)
  }

  /** 时段/饭点桶：用于触发实时心情（不依赖定时器）。 */  /** 时段/饭点桶：用于触发实时心情（不依赖定时器）。 */
  function moodTimeBucket(now) {
  const parts = shanghaiParts(num(now, Date.now()))
  const hour = parts.hour
  let period = 'night'
  if (hour >= 6 && hour < 11) period = 'morning'
  else if (hour >= 11 && hour < 14) period = 'noon'
  else if (hour >= 14 && hour < 18) period = 'afternoon'
  else if (hour >= 18 && hour < 22) period = 'evening'
  const meal = hour === 7 || hour === 8 || hour === 11 || hour === 12 || hour === 17 || hour === 18
  return period + '|' + (meal ? 'meal' : 'offmeal')
  }

  function moodAiSnapshot(stats, weather, feihuaWins, feihuaLosses) {
  const normalized = normalizeMoodStats(stats)
  return {
   userMessages: normalized.userMessages,
   toolCalls: normalized.toolCalls,
   toolErrors: normalized.toolErrors,
   weatherCategory: weather && typeof weather.category === 'string' ? weather.category : '',
   feihuaWins: Math.max(0, Math.floor(num(feihuaWins, 0))),
   feihuaLosses: Math.max(0, Math.floor(num(feihuaLosses, 0))),
  }
  }

  function isMoodAiSignificant(previous, current) {
  if (!previous || !current) return false
  if (current.userMessages - previous.userMessages >= 3) return true
  if (current.toolCalls - previous.toolCalls >= 50) return true
  if (current.toolErrors > previous.toolErrors) return true
  if (current.weatherCategory !== previous.weatherCategory) return true
  if (current.feihuaWins > previous.feihuaWins || current.feihuaLosses > previous.feihuaLosses) return true
  return false
  }

  function requestMood() {
  return fetchJson('mood.json').then(
   (data) => {
    const normalized = {
    ok: true,
    date: data && data.date ? String(data.date) : '',
    stats: normalizeMoodStats(data && data.stats),
    updatedAt: num(data && data.updatedAt, 0),
    }
    moodCache = { data: normalized, at: Date.now() }
    return normalized
   },
   () => ({ ok: false, date: '', stats: emptyMoodStats(), updatedAt: 0 }),
  )
  }

  function normalizeSpontState(raw, now) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const dateKey = shanghaiParts(now).dateKey
  const seen = []
  if (Array.isArray(src.seenIds)) {
   for (const entry of src.seenIds.slice(-SPONT_MAX_SEEN)) {
    let id = ''
    let at = 0
    if (typeof entry === 'string') id = entry
    else if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
    id = entry.id
    at = num(entry.at, 0)
    }
    if (!id) continue
    if (at > 0 && now - at > SPONT_SEEN_DAYS) continue
    seen.push({ id, at })
   }
  }
  const sameDay = src.date === dateKey
  return {
   date: dateKey,
   lastShownAt: sameDay ? num(src.lastShownAt, 0) : 0,
   todayCount: sameDay ? Math.max(0, Math.floor(num(src.todayCount, 0))) : 0,
   seenIds: seen,
   lastType: typeof src.lastType === 'string' ? src.lastType : '',
   lastTag: typeof src.lastTag === 'string' ? src.lastTag : '',
  }
  }

  function readSpontState(now) {
  const storage = getStorage()
  if (!storage) return normalizeSpontState(null, now)
  try {
   const raw = storage.getItem(SPONT_KEY)
   return normalizeSpontState(raw ? JSON.parse(raw) : null, now)
  } catch (error) {
   return normalizeSpontState(null, now)
  }
  }

  function writeSpontState(state) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(SPONT_KEY, JSON.stringify(state))
  } catch (error) {
   /* 配额/隐私模式：放弃记录，不影响展示 */
  }
  }

  function recordSpontShown(state, id, now, type, tag) {
  const base = normalizeSpontState(state, now)
  const seen = base.seenIds.filter((entry) => entry.id !== id).concat([{ id: String(id), at: now }]).slice(-SPONT_MAX_SEEN)
  return {
   date: base.date,
   lastShownAt: num(now, Date.now()),
   todayCount: base.todayCount + 1,
   seenIds: seen,
   lastType: typeof type === 'string' ? type : base.lastType,
   lastTag: typeof tag === 'string' ? tag : base.lastTag,
  }
  }

  function countSpontHits(text, tags) {
  let hits = 0
  for (const tag of Array.isArray(tags) ? tags : []) {
   if (!tag) continue
   hits += String(text || '').split(tag).length - 1
  }
  return hits
  }

  /** 彩蛋触发条件（纯函数）：开关/可见/隐藏/面板/气泡/30s 闲置/45min 间隔/每日 3 次。 */
  /** 把连续文本按句末标点（。！？）切成完整句，保留标点（不吃掉逗号等句中标点）。 */
  function splitCompleteSentences(text) {
  const value = String(text == null ? '' : text)
  const out = []
  let start = 0
  for (let i = 0; i < value.length; i += 1) {
   const ch = value.charAt(i)
   if (ch === '。' || ch === '！' || ch === '？') {
    const sentence = value.slice(start, i + 1).trim()
    if (sentence) out.push(sentence)
    start = i + 1
   }
  }
  return out
  }

  /** 从若干行里挑一个完整句：优先 8–40 字且命中心情 tag；无句末标点则回退最后一个完整 line。 */
  function pickSentenceFromLines(lines, tags, random) {
  const list = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? '' : value)).filter((value) => value.length > 0)
  const sentences = splitCompleteSentences(list.join(''))
  if (!sentences.length) {
   if (!list.length) return ''
   let fallback = list[list.length - 1]
   if (/[，,]$/.test(fallback)) {
    fallback = list.length > 1 ? list[list.length - 2] : fallback.replace(/[，,]$/, '。')
   }
   return fallback
  }
  const scored = sentences.map((sentence) => ({ sentence, length: sentence.length, hits: countSpontHits(sentence, tags) }))
  const preferred = scored.filter((item) => item.length >= 8 && item.length <= 40 && item.hits > 0)
  const medium = scored.filter((item) => item.length >= 8 && item.length <= 40)
  const withTag = scored.filter((item) => item.hits > 0)
  const pool = (preferred.length ? preferred : medium.length ? medium : withTag.length ? withTag : scored)
  if (!pool.length) return ''
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(num(typeof random === 'function' ? random() : Math.random(), 0) * pool.length)))
  return pool[index].sentence
  }

  /** 触发条件（纯函数）：开关/可见/隐藏/面板/气泡/最近 3s 无交互；不再有任何时间/次数闸门。 */
  function canShowSpontaneous(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.enabled !== true) return false
  if (opts.hidden === true || opts.panelOpen === true || opts.bubbleOpen === true || opts.visible === false) return false
  const now = num(opts.now, Date.now())
  const lastInteraction = num(opts.lastInteractionAt, 0)
  const quietMs = num(opts.quietMs, SPONT_QUIET_MS)
  const idleMs = lastInteraction > 0 ? Math.max(0, now - lastInteraction) : Number.POSITIVE_INFINITY
  if (idleMs < quietMs) return false
  return true
  }

  /** 轮询间隔 60–120 秒（每次重新随机）；事件唤醒仍 2–5s。 */
  function nextSpontPollDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(SPONT_POLL_MIN_MS + ratio * (SPONT_POLL_MAX_MS - SPONT_POLL_MIN_MS))
  }

  /** 事件唤醒后的尝试延迟 2–5 秒。 */
  function nextSpontEventDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(SPONT_EVENT_MIN_MS + ratio * (SPONT_EVENT_MAX_MS - SPONT_EVENT_MIN_MS))
  }
  function murmurPeriod(hour) {
  if (hour >= 5 && hour < 9) return '早上'
  if (hour >= 9 && hour < 11) return '上午'
  if (hour >= 11 && hour < 14) return '中午'
  if (hour >= 14 && hour < 18) return '下午'
  if (hour >= 18 && hour < 23) return '晚上'
  return '深夜'
  }

  function buildMurmurContext(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const now = num(opts.now, Date.now())
  const parts = shanghaiParts(now)
  const weather = opts.weather && typeof opts.weather === 'object' ? opts.weather : null
  const stats = opts.stats && typeof opts.stats === 'object' ? opts.stats : {}
  return {
   now,
   hour: num(parts.hour, 12),
   period: murmurPeriod(num(parts.hour, 12)),
   weatherLabel: weather ? String(weather.label || weather.category || '') : '',
   weatherCategory: weather ? String(weather.category || '') : '',
   isDay: weather ? weather.isDay !== false : true,
   toolCalls: Math.max(0, Math.floor(num(stats.toolCalls, 0))),
   userMessages: Math.max(0, Math.floor(num(stats.userMessages, 0))),
   activeMinutes: Math.max(0, Math.floor(num(stats.activeMs, 0) / 60000)),
  }
  }

  function murmurTagsForContext(ctx, moodKey) {
  const tags = []
  const add = (tag) => {
   if (tags.indexOf(tag) < 0) tags.push(tag)
  }
  const moodTags = {
   happy: ['happy', 'poem-love'],
   tired: ['tired', 'encourage'],
   lonely: ['lonely', 'self-talk'],
   hungry: ['hungry', 'food'],
   sleepy: ['night', 'tired'],
   busy: ['busy', 'work'],
   curious: ['self-talk', 'encourage'],
   cozy: ['weather', 'happy'],
   proud: ['encourage', 'work'],
   calm: ['self-talk', 'weather'],
  }
  for (const tag of moodTags[moodKey] || moodTags.calm) add(tag)
  if (ctx.weatherCategory === 'rain') add('rain')
  if (ctx.weatherCategory === 'snow') add('snow')
  if (ctx.weatherCategory === 'clear' && ctx.isDay) add('sunny')
  if (ctx.weatherCategory === 'hot') add('hot')
  if (ctx.weatherCategory === 'cold') add('cold')
  if (ctx.hour >= 23 || ctx.hour < 5) add('night')
  if (ctx.hour >= 5 && ctx.hour < 10) add('greeting')
  if (ctx.hour >= 11 && ctx.hour < 14) add('food')
  if (ctx.hour >= 18 && ctx.hour < 23) add('night')
  add('time')
  return tags
  }

  function buildMurmurCandidates(options) {
  const ctx = buildMurmurContext(options)
  const list = []
  for (let index = 0; index < MURMUR_POOL.length; index += 1) {
   const entry = MURMUR_POOL[index]
   if (!entry || typeof entry.text !== 'string') continue
   list.push({ id: 'murmur-' + index, text: entry.text, tags: entry.tags || [] })
  }
  for (const template of MURMUR_TEMPLATES) {
   if (!template || typeof template.when !== 'function' || !template.when(ctx)) continue
   const text = String(template.text(ctx))
   if (text.length < 6 || text.length > 40) continue
   list.push({ id: template.id, text, tags: template.tags || [] })
  }
  return list
  }

  function pickMurmur(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const now = num(opts.now, Date.now())
  const ctx = buildMurmurContext(opts)
  const preferred = murmurTagsForContext(ctx, opts.moodKey)
  const seen = new Map()
  for (const entry of Array.isArray(opts.seenEntries) ? opts.seenEntries : []) {
   if (!entry || typeof entry.id !== 'string') continue
   const at = num(entry.at, 0)
   if (at > 0 && now - at < SPONT_REPEAT_MS) seen.set(entry.id, true)
  }
  let pool = buildMurmurCandidates(opts).filter((candidate) => !seen.has(candidate.id))
  if (!pool.length) pool = buildMurmurCandidates(opts)
  const recentTexts = (Array.isArray(opts.recentTexts) ? opts.recentTexts : [])
   .map((text) => String(text == null ? '' : text).trim())
   .filter(Boolean)
  if (recentTexts.length) {
   const fresh = pool.filter((candidate) => recentTexts.indexOf(candidate.text) < 0)
   if (fresh.length) pool = fresh
  }
  if (!pool.length) return null
  const lastTag = typeof opts.lastTag === 'string' ? opts.lastTag : ''
  const scored = pool.map((candidate) => {
   let score = 0
   for (const tag of preferred) if (candidate.tags.indexOf(tag) >= 0) score += 2
   if (lastTag && candidate.tags.indexOf(lastTag) >= 0) score -= 4
   return { candidate, score }
  })
  scored.sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id, 'zh'))
  const top = scored.slice(0, Math.min(6, scored.length))
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  const chosen = top[Math.min(top.length - 1, Math.floor(ratio * top.length))].candidate
  const titleIndex = Math.min(MURMUR_TITLES.length - 1, Math.floor(ratio * MURMUR_TITLES.length))
  return {
   type: 'murmur',
   id: chosen.id,
   text: chosen.text,
   line: chosen.text,
   tags: chosen.tags,
   tag: chosen.tags[0] || '',
   title: MURMUR_TITLES[titleIndex] || MURMUR_TITLES[0],
  }
  }

  function selfTalkKindFor() {
  return 'murmur'
  }

  /** 构建 self-talk GET：只带聚合上下文（mood/weather/idleMinutes/recent），不含会话内容。 */
  function selfTalkQuery(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const params = []
  const add = (key, value) => {
   if (value == null || value === '') return
   params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
  }
  add('kind', 'murmur')
  add('mood', opts.moodKey)
  add('moodLabel', opts.moodLabel)
  add('moodReason', opts.moodReason)
  add('image', opts.image)
  add('imageLabel', opts.imageLabel)
  add('weather', opts.weather)
  add('idleMinutes', Math.max(0, Math.floor(num(opts.idleMinutes, 0))))
  const seen = {}
  const recent = []
  for (const text of Array.isArray(opts.recent) ? opts.recent : []) {
   const clean = String(text == null ? '' : text).trim()
   if (!clean || seen[clean]) continue
   seen[clean] = true
   recent.push(clean)
  }
  const recentSlice = recent.slice(-SELF_TALK_RECENT_MAX)
  if (recentSlice.length) add('recent', recentSlice.join('|'))
  return SELF_TALK_PATH + (params.length ? '?' + params.join('&') : '')
  }

  function parseSelfTalkResponse(data) {
  if (!data || data.ok === false || !Array.isArray(data.lines)) return { ok: false, reason: 'invalid' }
  const texts = []
  for (const line of data.lines) {
   const text = typeof line === 'string' ? line : line && typeof line.text === 'string' ? line.text : ''
   const clean = text.trim()
   if (clean && texts.indexOf(clean) < 0) texts.push(clean)
  }
  if (!texts.length) return { ok: false, reason: 'empty' }
  return { ok: true, line: texts[0], next: texts[1] || '' }
  }

  /** 请求 host 实时自言自语；8s 超时；所有失败都 resolve 成 {ok:false}，由调用方静默回退。 */
  function requestSelfTalk(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, reason: 'no-fetch' })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, reason: 'timeout' })
   }, SELF_TALK_TIMEOUT_MS)
  })
  const request = Promise.resolve()
   .then(() => fetch(ROUTE + selfTalkQuery(opts), controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) {
     return { ok: false, reason: 'http', status: response ? response.status : 0 }
    }
    return Promise.resolve(response.json()).then((data) => parseSelfTalkResponse(data)).catch(() => ({ ok: false, reason: 'json' }))
   })
   .catch(() => ({ ok: false, reason: 'network' }))
  return Promise.race([request, timeout]).then((result) => {
   if (timer) clearTimeout(timer)
   return result
  })
  }

  /* ================================================================
   * 2.9 诗库数据 / 平水韵格律检测 / 剩余立绘彩蛋（M9 纯函数）
   * ================================================================ */

  function assetUrlFor(kind, version) {
  const file = ASSET_DATA_FILES[kind]
  if (!file) return ''
  return '/api/dsh-poetry/assets?f=' + file + '&v=' + encodeURIComponent(String(version == null ? '' : version))
  }

  function libraryCategoryOf(item, kind) {
  if (kind === 'bank') return 'bank'
  const raw = String(item && item.category != null ? item.category : '').trim()
  if (LIBRARY_CATEGORY_ALIASES[raw]) return LIBRARY_CATEGORY_ALIASES[raw]
  for (const label of Object.keys(LIBRARY_CATEGORY_ALIASES)) {
   if (raw.indexOf(label) >= 0) return LIBRARY_CATEGORY_ALIASES[label]
  }
  return ''
  }

  /** 合并 anthology + bank 为诗库条目（统一 categoryId 与 source）。 */
  function buildLibraryItems(anthologyData, bankData, ciBankData, ciSelectedData) {
  const out = []
  for (const item of anthologyData && Array.isArray(anthologyData.items) ? anthologyData.items : []) {
   if (!item) continue
   const categoryId = libraryCategoryOf(item, 'anthology')
   if (!categoryId) continue
   out.push(Object.assign({}, item, { categoryId, source: 'anthology' }))
  }
  for (const item of bankData && Array.isArray(bankData.items) ? bankData.items : []) {
   if (!item) continue
   out.push(Object.assign({}, item, { categoryId: 'bank', source: 'bank' }))
  }
  for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
   if (!item) continue
   out.push(Object.assign({}, item, { categoryId: 'ci-bank', source: 'ci-bank' }))
  }
  for (const item of ciSelectedLibraryItems(ciSelectedData)) out.push(item)
  return out
  }

  /** 精选宋词（data/ci.json 283 首）→ 诗库条目；title 用「词牌·首句」。 */
  function ciSelectedLibraryItems(ciData) {
  const out = []
  for (const item of ciData && Array.isArray(ciData.items) ? ciData.items : []) {
   if (!item || !item.id) continue
   const rhythmic = String(item.rhythmic || '')
   const firstLine = String((Array.isArray(item.lines) && item.lines[0]) || '')
   const first = firstLine.replace(/[，。！？；、：,.!?;:·\s]/g, '').slice(0, 24)
   const title = rhythmic ? rhythmic + '·' + (first || '无题') : String(item.title || first || '无题')
   out.push({
    id: String(item.id),
    author: String(item.author || ''),
    rhythmic,
    title,
    lines: Array.isArray(item.lines) ? item.lines : [],
    categoryId: 'ci-selected',
    source: 'ci-selected',
   })
  }
  return out
  }

  function ciSelectedRhythmics(ciData) {
  const map = {}
  for (const item of ciData && Array.isArray(ciData.items) ? ciData.items : []) {
   const name = item && item.rhythmic ? String(item.rhythmic) : ''
   if (!name) continue
   map[name] = (map[name] || 0) + 1
  }
  return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
  }

  /** 宋词全库的词牌分布（名 → 数量，降序），用于诗库「宋词全库」的词牌筛选。 */
  function ciBankRhythmics(ciBankData) {
  const map = {}
  for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
   const name = item && item.rhythmic ? String(item.rhythmic) : ''
   if (!name) continue
   map[name] = (map[name] || 0) + 1
  }
  return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
  }

  function filterLibraryItems(items, category, query, rhythmic) {
  const cat = category && category !== 'all' ? category : 'all'
  const keyword = String(query == null ? '' : query).trim().toLowerCase()
  const rhythm = rhythmic ? String(rhythmic) : ''
  return (Array.isArray(items) ? items : []).filter((item) => {
   if (!item) return false
   if (cat !== 'all' && item.categoryId !== cat) return false
   if (rhythm && String(item.rhythmic || '') !== rhythm) return false
   if (!keyword) return true
   const hay = String(item.title || '') + ' ' + String(item.author || '') + ' ' + (Array.isArray(item.lines) ? item.lines.join('') : '')
   return hay.toLowerCase().indexOf(keyword) >= 0
  })
  }

  function libraryPage(items, visible) {
  return (Array.isArray(items) ? items : []).slice(0, Math.max(0, Math.floor(num(visible, LIBRARY_PAGE))))
  }

  function libraryItemLabel(item) {
  const title = item && item.title ? String(item.title) : '无题'
  const author = item && item.author ? String(item.author) : ''
  return author ? author + '《' + title + '》' : '《' + title + '》'
  }

  /** 平水韵数据 → 索引（categories 与 charIndex 双驱动，charIndex 缺省时从 chars 反推）。 */
  function buildPingshuiIndex(raw) {
  const sourceCategories = raw && Array.isArray(raw.categories) ? raw.categories : []
  const categories = sourceCategories.map((cat, index) => {
   const value = cat && typeof cat === 'object' ? cat : {}
   return {
    index,
    name: String(value.name || value.short || '韵部' + (index + 1)),
    short: String(value.short || value.name || '韵部' + (index + 1)),
    tone: (String(value.tone || '').toLowerCase() === 'ping' || value.tone === '平') ? '平' : '仄',
    chars: String(value.chars == null ? '' : value.chars),
   }
  })
  const charMap = {}
  const addChar = (ch, index) => {
   if (!ch) return
   const list = charMap[ch] || (charMap[ch] = [])
   if (list.indexOf(index) < 0) list.push(index)
  }
  const rawIndex = raw && raw.charIndex && typeof raw.charIndex === 'object' ? raw.charIndex : null
  if (rawIndex) {
   for (const ch of Object.keys(rawIndex)) {
    const arr = Array.isArray(rawIndex[ch]) ? rawIndex[ch] : []
    for (const index of arr) if (Number.isInteger(index) && categories[index]) addChar(ch, index)
   }
  }
  for (const cat of categories) for (const ch of Array.from(cat.chars)) addChar(ch, cat.index)
  function charInfo(ch) {
   const indices = charMap[ch] || []
   const cats = indices.map((index) => categories[index]).filter(Boolean)
   const tones = []
   for (const cat of cats) if (tones.indexOf(cat.tone) < 0) tones.push(cat.tone)
   const rhymes = []
   for (const cat of cats) if (cat.tone === '平' && rhymes.indexOf(cat.short) < 0) rhymes.push(cat.short)
   const candidates = []
   for (const cat of cats) candidates.push({ tone: cat.tone, name: cat.short })
   return { ch, tones, rhymes, candidates }
  }
  return { categories, charMap, charInfo, ready: categories.length > 0 }
  }

  function tonesFromToneChar(toneChar) {
  if (toneChar === '平') return ['平']
  if (toneChar === '仄') return ['仄']
  if (toneChar === '○' || toneChar === '〇') return ['平', '仄']
  return []
  }

  /** 逐字平仄标注：优先用数据里的 tones，否则查平水韵 charIndex（多音字列出候选）。 */
  function annotatePoemLines(lines, tones, pingshui) {
  const out = []
  const toneLines = Array.isArray(tones) ? tones : []
  for (let lineIndex = 0; lineIndex < (Array.isArray(lines) ? lines.length : 0); lineIndex += 1) {
   const lineChars = Array.from(String(lines[lineIndex] == null ? '' : lines[lineIndex]))
   const toneChars = Array.from(String(toneLines[lineIndex] == null ? '' : toneLines[lineIndex]))
   const cells = []
   for (let index = 0; index < lineChars.length; index += 1) {
    const ch = lineChars[index]
    if (isPunctuation(ch)) continue
    const rawTone = toneChars[index] || ''
    const info = pingshui && typeof pingshui.charInfo === 'function' ? pingshui.charInfo(ch) : { tones: [], rhymes: [], candidates: [] }
    const allowed = rawTone ? tonesFromToneChar(rawTone) : (info.tones || [])
    cells.push({
     ch,
     allowed,
     tone: allowed.length === 0 ? '？' : allowed.length > 1 ? '○' : allowed[0],
     rhymes: info.rhymes || [],
     candidates: info.candidates || [],
    })
   }
   out.push(cells)
  }
  return out
  }

  function patternForShape(form, start, firstRhyme) {
  const key = start + (firstRhyme ? '入韵' : '不入韵')
  const five = TONE_QUATRAINS[key] || TONE_QUATRAINS['平起不入韵']
  const size = form && form.charAt(0) === '七' ? 7 : 5
  const base = size === 7 ? five.map((line) => (line.charAt(0) === '平' ? '仄仄' : '平平') + line) : five.slice()
  const lines = form && form.charAt(1) === '律' ? base.concat(base) : base
  return lines
  }

  function allowedRelation(cellA, cellB, relation) {
  const listA = cellA && Array.isArray(cellA.allowed) ? cellA.allowed : []
  const listB = cellB && Array.isArray(cellB.allowed) ? cellB.allowed : []
  if (!listA.length || !listB.length) return null
  for (const a of listA) {
   for (const b of listB) {
    if (relation === 'dui' ? a !== b : a === b) return true
   }
  }
  return false
  }

  function rhymeSetOf(cell) {
  const names = cell && Array.isArray(cell.rhymes) ? cell.rhymes : []
  return names
  }

  /** 格律检测：入参为逐行 cells（annotatePoemLines 结果），返回可读报告对象。 */
  function detectMetre(annotation, pingshui) {
  const report = {
   ok: true,
   errors: [],
   form: '',
   start: '',
   firstRhyme: false,
   meter: '',
   weakTones: !pingshui || !pingshui.ready,
   rhymeError: '',
   rhymeLines: [],
   rhymeGroup: [],
   violations: [],
   sticky: [],
   sanPing: [],
   guPing: [],
   summary: '',
  }
  const lineCount = Array.isArray(annotation) ? annotation.length : 0
  const size = lineCount ? annotation[0].length : 0
  if (![4, 8].includes(lineCount) || ![5, 7].includes(size) || annotation.some((line) => line.length !== size)) {
   report.ok = false
   report.errors.push('需要 4 句或 8 句、每句 5 或 7 个字（当前 ' + lineCount + ' 句 / 首句 ' + size + ' 字）')
   return report
  }
  report.form = (size === 5 ? '五' : '七') + (lineCount === 4 ? '绝' : '律')
  const firstLine = annotation[0]
  const startOptions = []
  const secondTones = firstLine[1] ? firstLine[1].allowed : []
  if (secondTones.indexOf('平') >= 0) startOptions.push('平起')
  if (secondTones.indexOf('仄') >= 0) startOptions.push('仄起')
  if (!startOptions.length) startOptions.push('平起', '仄起')
  const lastTones = firstLine[firstLine.length - 1] ? firstLine[firstLine.length - 1].allowed : []
  const rhymeOptions = lastTones.indexOf('平') >= 0 ? [true] : lastTones.length ? [false] : [true, false]
  if (lastTones.indexOf('平') >= 0 && lastTones.indexOf('仄') >= 0) rhymeOptions.length = 0
  if (rhymeOptions.length === 0) rhymeOptions.push(true, false)
  const mandatory = size === 5 ? [1, 3] : [1, 3, 5]
  let best = null
  for (const start of startOptions) {
   for (const firstRhyme of rhymeOptions) {
    const pattern = patternForShape(report.form, start, firstRhyme)
    let violations = 0
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
     for (const position of mandatory) {
      const cell = annotation[lineIndex][position]
      const expected = pattern[lineIndex] ? pattern[lineIndex].charAt(position) : ''
      if (!cell || !cell.allowed.length || !expected) continue
      if (cell.allowed.indexOf(expected) < 0) violations += 1
     }
    }
    if (!best || violations < best.violations) best = { start, firstRhyme, pattern, violations }
   }
  }
  report.start = best.start
  report.firstRhyme = best.firstRhyme
  report.meter = best.start + '首句' + (best.firstRhyme ? '入韵' : '不入韵')
  const pattern = best.pattern
  const rhymeIndexes = []
  for (let lineIndex = 1; lineIndex < lineCount; lineIndex += 2) rhymeIndexes.push(lineIndex)
  if (best.firstRhyme) rhymeIndexes.unshift(0)
  rhymeIndexes.sort((a, b) => a - b)
  // 拗字（二四六分明；一三五不论不报）
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
   for (const position of mandatory) {
    const cell = annotation[lineIndex][position]
    const expected = pattern[lineIndex] ? pattern[lineIndex].charAt(position) : ''
    if (!cell || !cell.allowed.length || !expected) continue
    if (cell.allowed.indexOf(expected) < 0) {
     report.violations.push({ line: lineIndex + 1, position: position + 1, ch: cell.ch, expected, actual: cell.tone })
    }
   }
  }
  // 韵脚 + 韵部（多音字取候选；首句允许借邻韵）
  const rhymeSets = []
  for (const lineIndex of rhymeIndexes) {
   const cell = annotation[lineIndex][annotation[lineIndex].length - 1]
   const isPing = cell && (cell.allowed.indexOf('平') >= 0)
   if (!isPing) report.violations.push({ line: lineIndex + 1, position: annotation[lineIndex].length, ch: cell ? cell.ch : '', expected: '平', actual: cell ? cell.tone : '？', rhyme: true })
   rhymeSets.push({ line: lineIndex, cell, names: rhymeSetOf(cell) })
  }
  if (report.weakTones) {
   report.rhymeError = '缺少平水韵数据，韵部判定已跳过'
  } else {
   const mainSets = rhymeSets.filter((entry) => entry.line !== 0)
   const anchor = mainSets.length ? mainSets[0].names : (rhymeSets[0] ? rhymeSets[0].names : [])
   const group = []
   for (const name of anchor) {
    if (mainSets.every((entry) => entry.names.indexOf(name) >= 0)) group.push(name)
   }
   report.rhymeGroup = group
   for (const entry of rhymeSets) {
    const borrowed = entry.line === 0 && !entry.names.some((name) => group.indexOf(name) >= 0)
    report.rhymeLines.push({
     line: entry.line + 1,
     ch: entry.cell ? entry.cell.ch : '',
     names: entry.names,
     borrowed: Boolean(borrowed && best.firstRhyme),
    })
    if (!group.length) continue
    if (borrowed) continue
    if (!entry.names.some((name) => group.indexOf(name) >= 0)) report.rhymeError = '第 ' + (entry.line + 1) + ' 句韵脚出韵（' + (entry.names.join('/') || '未知') + '）'
   }
   if (!group.length) report.rhymeError = report.rhymeError || '韵脚没有共同韵部（可能出韵或平水韵数据缺失）'
  }
  // 粘对（二四六分明位置）
  for (let lineIndex = 0; lineIndex + 1 < lineCount; lineIndex += 1) {
   const relation = lineIndex % 2 === 0 ? 'dui' : 'nian'
   for (const position of mandatory) {
    const ok = allowedRelation(annotation[lineIndex][position], annotation[lineIndex + 1][position], relation)
    if (ok === false) {
     report.sticky.push({ pair: (lineIndex + 1) + '-' + (lineIndex + 2), type: relation === 'dui' ? '对' : '粘', position: position + 1 })
    }
   }
  }
  // 三平调 / 孤平
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
   const cells = annotation[lineIndex]
   if (cells.length >= 3) {
    const tail = cells.slice(-3)
    if (tail.every((cell) => cell.allowed.indexOf('平') >= 0)) report.sanPing.push(lineIndex + 1)
   }
   const expectedLine = pattern[lineIndex] || ''
   const lonelyPattern = size === 5 ? '平平仄仄平' : '仄仄平平仄仄平'
   if (expectedLine === lonelyPattern) {
    const position = size === 5 ? 0 : 2
    const cell = cells[position]
    if (cell && cell.allowed.length === 1 && cell.allowed[0] === '仄') report.guPing.push(lineIndex + 1)
   }
  }
  report.annotation = annotation
  const rhymeText = report.rhymeLines.map((entry) => entry.ch + (entry.names.length ? '（' + entry.names.join('/') + '）' : '') + (entry.borrowed ? '[借韵]' : '')).join('、')
  report.summary = report.form + '，' + report.meter + '；韵脚：' + (rhymeText || '—')
   + (report.rhymeGroup.length ? '，韵部 ' + report.rhymeGroup.join('/') : '')
   + (report.rhymeError ? '；' + report.rhymeError : '')
   + '；粘对' + (report.sticky.length ? '有 ' + report.sticky.length + ' 处失粘/失对' : '成立')
   + '；拗字 ' + report.violations.filter((item) => !item.rhyme).length + ' 处'
   + (report.sanPing.length ? '；三平调：第 ' + report.sanPing.join('、') + ' 句' : '')
   + (report.guPing.length ? '；孤平：第 ' + report.guPing.join('、') + ' 句' : '')
  return report
  }

  function detectPoem(poem, pingshui) {
  const lines = poem && Array.isArray(poem.lines) ? poem.lines : []
  const tones = poem && Array.isArray(poem.tones) ? poem.tones : null
  return detectMetre(annotatePoemLines(lines, tones, pingshui), pingshui)
  }

  /** 用户文本框输入：按换行/标点切成句，校验 4/8 句 × 5/7 字。 */
  function parsePoemInput(text) {
  const source = String(text == null ? '' : text).trim()
  if (!source) return { error: '请输入诗句' }
  const clauses = []
  for (const row of source.split(/[\n\r]+/)) {
   for (const part of String(row).split(/[，,。.！!？?；;：:、\s]+/)) {
    const chars = Array.from(part.replace(/[^\u4e00-\u9fff]/g, ''))
    if (chars.length) clauses.push({ raw: part.trim(), chars })
   }
  }
  if (![4, 8].includes(clauses.length)) return { error: '需要 4 句或 8 句（当前 ' + clauses.length + ' 句），请用换行或标点分隔' }
  const size = clauses[0].chars.length
  if (![5, 7].includes(size)) return { error: '每句需要 5 或 7 个字（首句为 ' + size + ' 字）' }
  for (let index = 0; index < clauses.length; index += 1) {
   if (clauses[index].chars.length !== size) return { error: '第 ' + (index + 1) + ' 句为 ' + clauses[index].chars.length + ' 字，与前句 ' + size + ' 字不一致' }
  }
  return { lines: clauses }
  }

  function detectPoemText(text, pingshui) {
  const parsed = parsePoemInput(text)
  if (parsed.error) return { ok: false, errors: [parsed.error], summary: parsed.error }
  const annotation = parsed.lines.map((clause) => annotatePoemLines([clause.raw], null, pingshui)[0])
  return detectMetre(annotation, pingshui)
  }

  function formatDetectionReport(report) {
  if (!report) return ''
  const lines = ['【格律检测】' + (report.summary || '')]
  for (const error of report.errors || []) lines.push('⚠ ' + error)
  for (const item of report.violations || []) lines.push('· 第 ' + item.line + ' 句第 ' + item.position + ' 字「' + item.ch + '」宜' + item.expected + '（实际 ' + item.actual + '）')
  for (const item of report.sticky || []) lines.push('· 第 ' + item.pair + ' 句失' + item.type + '（第 ' + item.position + ' 字）')
  for (const line of report.sanPing || []) lines.push('· 第 ' + line + ' 句疑似三平调')
  for (const line of report.guPing || []) lines.push('· 第 ' + line + ' 句疑似孤平')
  return lines.join('\n')
  }

  function detectionRhymeIndexes(report) {
  const set = {}
  for (const item of (report && report.rhymeLines) || []) set[item.line - 1] = true
  return set
  }

  /* ---- 剩余立绘彩蛋（双击表情 / 每日 greet / idle 姿态限频） ---- */
  function normalizeMascotEggState(raw, now) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const dateKey = shanghaiParts(now).dateKey
  const sameDay = source.date === dateKey
  return {
   date: dateKey,
   greeted: sameDay ? source.greeted === true : false,
   greetAt: sameDay ? num(source.greetAt, 0) : 0,
   idleAt: num(source.idleAt, 0),
  }
  }

  function readMascotEggState(now) {
  const storage = getStorage()
  if (!storage) return normalizeMascotEggState(null, now)
  try {
   const raw = storage.getItem(MASCOT_EGG_KEY)
   return normalizeMascotEggState(raw ? JSON.parse(raw) : null, now)
  } catch (error) {
   return normalizeMascotEggState(null, now)
  }
  }

  function writeMascotEggState(state) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(MASCOT_EGG_KEY, JSON.stringify(state))
  } catch (error) {
   /* 配额/隐私模式：忽略 */
  }
  }

  function recordMascotEgg(state, patch, now) {
  const base = normalizeMascotEggState(state, now)
  const time = num(now, Date.now())
  return {
   date: base.date,
   greeted: base.greeted || Boolean(patch && patch.greet),
   greetAt: patch && patch.greet ? time : base.greetAt,
   idleAt: patch && patch.idle ? time : base.idleAt,
  }
  }

  function shouldShowDailyGreet(state, now) {
  return !normalizeMascotEggState(state, now).greeted
  }

  function canShowIdlePose(state, now, lastInteractionAt) {
  const normalized = normalizeMascotEggState(state, now)
  const time = num(now, Date.now())
  if (normalized.idleAt > 0 && time - normalized.idleAt < MASCOT_IDLE_MIN_MS) return false
  const lastInteraction = num(lastInteractionAt, 0)
  if (lastInteraction > 0 && time - lastInteraction < MASCOT_IDLE_USER_MS) return false
  return true
  }

  function pickMascotExpression(random) {
  const value = typeof random === 'function' ? Number(random()) : Math.random()
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  const index = Math.floor(ratio * MASCOT_EXPRESSION_FILES.length)
  return MASCOT_EXPRESSION_FILES[index] || MASCOT_EXPRESSION_FILES[0]
  }

  let bootstrapCache = null
  const RESOURCE_CACHE_KEYS = ['poems', 'ci', 'yun', 'knowledge', 'anthology', 'bank', 'pingshui', 'ciBank', 'moodCatalog']
  const resourceCache = { poems: null, ci: null, yun: null, knowledge: null, anthology: null, bank: null, pingshui: null, ciBank: null, moodCatalog: null }
  const resourceInflight = { poems: null, ci: null, yun: null, knowledge: null, anthology: null, bank: null, pingshui: null, ciBank: null, moodCatalog: null }
  let assetDataVersion = ''
  function setAssetDataVersion(version) {
  const next = version == null ? '' : String(version)
  if (next === assetDataVersion) return
  assetDataVersion = next
  clearFeihuaFullCache()
  clearPetMediaCache()
  for (const kind of ['anthology', 'bank', 'pingshui', 'ciBank', 'moodCatalog']) {
   resourceCache[kind] = null
   resourceInflight[kind] = null
  }
  }

  function getStorage() {
  try {
   if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch (error) {
  }
  return null
  }

  function fetchJson(path, init) {
  return fetchJsonUrl(ROUTE + path, init)
  }

  function fetchJsonUrl(url, init) {
  if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持网络请求'))
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller
   ? setTimeout(() => {
    try {
    controller.abort()
    } catch (error) {
    }
   }, FETCH_TIMEOUT_MS)
   : null
  const options = Object.assign({}, init || {})
  if (controller) options.signal = controller.signal
  return Promise.resolve()
   .then(() => fetch(url, options))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean') throw new Error('响应异常')
    if (!response.ok) {
    const error = new Error('HTTP ' + response.status)
    error.status = response.status
    throw error
    }
    return response.json()
   })
   .then((data) => {
    if (!data || data.ok === false) {
    const detail = data && data.error ? data.error : null
    const error = new Error((detail && detail.message) || '数据不可用')
    if (detail && detail.code) error.code = detail.code
    throw error
    }
    return data
   })
   .finally(() => {
    if (timer) clearTimeout(timer)
   })
  }

  function clearResourceCache(kind) {
  clearFeihuaIndexCache()
  clearFeihuaFullCache()
  clearPetMediaCache()
  if (kind) {
   resourceCache[kind] = null
   resourceInflight[kind] = null
   return
  }
  for (const key of RESOURCE_CACHE_KEYS) {
   resourceCache[key] = null
   resourceInflight[key] = null
  }
  }

  function loadResource(kind) {
  const assetFile = ASSET_DATA_FILES[kind]
  if (!assetFile && !RESOURCE_PATHS[kind]) return Promise.reject(new Error('未知数据类型：' + kind))
  if (resourceCache[kind]) return Promise.resolve(resourceCache[kind])
  if (!resourceInflight[kind]) {
   const url = assetFile ? assetUrlFor(kind, assetDataVersion) : ROUTE + RESOURCE_PATHS[kind]
   resourceInflight[kind] = fetchJsonUrl(url).then(
    (data) => {
    resourceCache[kind] = data
    resourceInflight[kind] = null
    return data
    },
    (error) => {
    resourceInflight[kind] = null
    throw error
    },
   )
  }
  return resourceInflight[kind]
  }

  /** 从 localStorage 读首屏缓存（bootstrap + 今日诗 + 设置）。 */
  function readFirstScreenCache() {
  const storage = getStorage()
  if (!storage) return null
  try {
   const raw = storage.getItem(CACHE_KEY)
   if (!raw) return null
   const parsed = JSON.parse(raw)
   if (!parsed || typeof parsed !== 'object' || !parsed.bootstrap) return null
   if (!parsed.bootstrap.today || typeof parsed.bootstrap.today !== 'object') return null
   return parsed
  } catch (error) {
   return null
  }
  }

  function writeFirstScreenCache(payload) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch (error) {
  }
  }

  function clearFirstScreenCache() {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.removeItem(CACHE_KEY)
  } catch (error) {
  }
  }

  function readStoredPosition() {
  const storage = getStorage()
  if (!storage) return null
  try {
   const raw = storage.getItem(POS_KEY)
   if (!raw) return null
   const parsed = JSON.parse(raw)
   if (!parsed || !Number.isFinite(Number(parsed.x)) || !Number.isFinite(Number(parsed.y))) return null
   return {
    x: Number(parsed.x),
    y: Number(parsed.y),
    snap: parsed.snap === 'right' || parsed.snap === 'free' ? parsed.snap : 'left',
   }
  } catch (error) {
   return null
  }
  }

  function writeStoredPosition(position) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(POS_KEY, JSON.stringify({
    x: Math.round(position.x),
    y: Math.round(position.y),
    snap: position.snap,
   }))
  } catch (error) {
  }
  }

  function putSettings(patch) {
  const request = buildSettingsRequest(patch)
  return fetchJson('settings.json', request.init).then((data) => {
   if (bootstrapCache && data && data.settings) {
    bootstrapCache = Object.assign({}, bootstrapCache, { settings: data.settings })
   }
   return data
  })
  }
  const CSS = [
  '.dshp-root{--dshp-bg:var(--dsw-alias-bg-module-platform,#fff);',
  '--dshp-bg-soft:var(--dsw-alias-bg-base-platform,#f6f7f9);',
  '--dshp-label:var(--dsw-alias-label-primary,#1f2329);',
  '--dshp-label-2:var(--dsw-alias-label-secondary,#646a73);',
  '--dshp-border:var(--dsw-alias-border-l2,#e3e5e8);',
  '--dshp-border-3:var(--dsw-alias-border-l3,#c9cdd6);',
  '--dshp-hover:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.06));',
  '--dshp-accent:var(--dsw-static-accent,#4d6bfe);',
  '--dshp-ping:#2563eb;--dshp-ze:#dc2626;--dshp-any:#6b7280;',
  '--dshp-danger:#dc2626;',
  '--dshp-shadow:0 12px 40px rgba(0,0,0,.18);',
  'position:fixed;pointer-events:auto;color:var(--dshp-label);font-size:13px;line-height:1.45;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
  'text-align:left;-webkit-font-smoothing:antialiased}',
  '.dshp-root *,.dshp-root *::before,.dshp-root *::after{box-sizing:border-box}',
  '.dshp-stage{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;',
  'cursor:grab;touch-action:none;border-radius:24px}',
  '.dshp-stage:active{cursor:grabbing}',
  '.dshp-stage:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:4px}',
  '.dshp-mascot{width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;',
  'filter:drop-shadow(0 10px 22px rgba(0,0,0,.22));animation:dshp-float 4.2s ease-in-out infinite}',
  '.dshp-stage.dshp-dizzy{animation:dshp-dizzy-wobble 500ms ease-in-out 3}',
  '@keyframes dshp-dizzy-wobble{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-3px) rotate(-2deg)}75%{transform:translateX(3px) rotate(2deg)}}',
  '.dshp-dizzy-stars{position:absolute;top:-4px;left:50%;transform:translateX(-50%);font-size:20px;line-height:1;animation:dshp-dizzy-float 900ms ease-in-out infinite;pointer-events:none;z-index:3}',
  '@keyframes dshp-dizzy-float{0%,100%{transform:translate(-50%,0);opacity:.75}50%{transform:translate(-50%,-6px);opacity:1}}',
  '.dshp-dizzy-tip{position:absolute;bottom:-26px;left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--dshp-bg);border:1px solid var(--dshp-border);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--dshp-label);box-shadow:var(--dshp-shadow);pointer-events:none;z-index:3}',
  '.dshp-mascot-img,.dshp-mascot-video{width:100%;height:100%;pointer-events:none;user-select:none;-webkit-user-drag:none}',
  '.dshp-mascot-img{object-fit:contain}',
  /* 640x360 的 webm 人物只占画面高约 83%，方形挂件里 contain 会显得小；cover 裁掉两侧透明边并轻微放大，视觉高度与 512x512 静态图对齐 */
  '.dshp-mascot-video{object-fit:cover;object-position:center;background:transparent;transform:scale(1.12)}',
  '.dshp-mascot-img.dshp-mascot-swap,.dshp-mascot-video.dshp-mascot-swap{animation:dshp-mascot-fade 220ms ease-out}',
  '@keyframes dshp-mascot-fade{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}',
  '@keyframes dshp-float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.012)}}',
  '.dshp-weather{display:flex;flex-direction:column;gap:3px;align-items:center;margin:2px 0 6px}',
  '.dshp-weather-chip{display:inline-flex;align-items:center;gap:4px;background:var(--dshp-bg-soft);',
  'border:1px solid var(--dshp-border);border-radius:999px;padding:2px 9px;font-size:11.5px;color:var(--dshp-label-2)}',
  '.dshp-weather-note{font-size:11px;color:var(--dshp-label-2);opacity:.85;text-align:center}',
  '.dshp-chip-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}',
  '.dshp-mood-chip{border-color:var(--dshp-accent);color:var(--dshp-accent)}',
  '.dshp-spont{position:fixed;z-index:63;display:flex;flex-direction:column;gap:6px;background:var(--dshp-bg);',
  'border:1px solid var(--dshp-border);border-radius:14px;padding:10px 12px;box-shadow:var(--dshp-shadow);',
  'animation:dshp-pop 160ms ease-out}',
  '.dshp-spont-title{font-size:11.5px;color:var(--dshp-label-2)}',
  '.dshp-spont-sentence{font-family:"Noto Serif SC","Songti SC",serif;font-size:14px;line-height:1.7;',
  'white-space:normal;word-break:break-word;color:var(--dshp-label);cursor:pointer;max-height:72px;',
  'overflow-y:auto;overscroll-behavior:contain;border-radius:6px}',
  '.dshp-spont-sentence:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:2px}',
  '.dshp-spont-sentence:hover{color:var(--dshp-accent)}',
  '.dshp-spont-source{font-size:11.5px;color:var(--dshp-label-2)}',
  '.dshp-spont-prefix{font-size:12px;color:var(--dshp-label-2);line-height:1.55}',
  '.dshp-spont-thinking{font-size:13px;color:var(--dshp-label-2);line-height:1.6}',
  '.dshp-spont-actions{display:flex;gap:8px;justify-content:flex-end}',
  '.dshp-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);',
  'white-space:nowrap;background:var(--dshp-bg);color:var(--dshp-label);border:1px solid var(--dshp-border);',
  'border-radius:999px;padding:4px 10px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,.12);',
  'animation:dshp-pulse 2.4s ease-in-out infinite;pointer-events:none}',
  '@keyframes dshp-pulse{0%,100%{opacity:.82}50%{opacity:1}}',
  '.dshp-restore{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
  'background:var(--dshp-bg);border:1px dashed var(--dshp-border-3);color:var(--dshp-label-2);font-size:12px;',
  'cursor:pointer;opacity:.35;transition:opacity 160ms ease;box-shadow:0 2px 8px rgba(0,0,0,.12)}',
  '.dshp-restore:hover{opacity:1}',
  '.dshp-bubble{position:fixed;z-index:61;display:flex;flex-direction:column;background:var(--dshp-bg);',
  'border:1px solid var(--dshp-border);border-radius:16px;box-shadow:var(--dshp-shadow);overflow:hidden;',
  'animation:dshp-pop 160ms ease-out}',
  '@keyframes dshp-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}',
  '.dshp-bubble-head{display:flex;align-items:center;gap:8px;padding:10px 8px 6px 14px}',
  '.dshp-bubble-title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dshp-label-2);',
  'letter-spacing:.02em;display:flex;align-items:center;gap:8px}',
  '.dshp-bubble-body{padding:2px 14px 4px;overflow-y:auto;overscroll-behavior:contain}',
  '.dshp-bubble-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px 10px;',
  'border-top:1px solid var(--dshp-border);background:var(--dshp-bg-soft)}',
  '.dshp-bubble,.dshp-panel{user-select:text}',
  '.dshp-bubble-step-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshp-progress{flex:none;font-weight:400;font-size:11px;color:var(--dshp-label-2);letter-spacing:0}',
  '.dshp-dots{display:inline-flex;gap:6px;flex:none;align-items:center}',
  '.dshp-dot{appearance:none;width:7px;height:7px;padding:0;border:0;border-radius:50%;',
  'background:var(--dshp-border-3);cursor:pointer;transition:background 120ms ease,transform 120ms ease}',
  '.dshp-dot:hover{background:var(--dshp-label-2);transform:scale(1.2)}',
  '.dshp-dot:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:2px}',
  '.dshp-dot.dshp-is-active{background:var(--dshp-accent);transform:scale(1.1)}',
  '.dshp-dot-collapse{background:transparent;border:1px solid var(--dshp-border-3)}',
  '.dshp-dot-collapse:hover{background:var(--dshp-hover);border-color:var(--dshp-label-2);transform:none}',
  '.dshp-btn{appearance:none;border:1px solid var(--dshp-border-3);background:transparent;color:inherit;',
  'border-radius:9px;padding:5px 12px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;',
  'transition:background 120ms ease,border-color 120ms ease}',
  '.dshp-btn:hover{background:var(--dshp-hover)}',
  '.dshp-btn:disabled{opacity:.45;cursor:default}',
  '.dshp-btn-primary{background:var(--dshp-accent);border-color:transparent;color:#fff}',
  '.dshp-btn-primary:hover{background:var(--dshp-accent);filter:brightness(1.06)}',
  '.dshp-btn-danger{color:var(--dshp-danger);border-color:rgba(220,38,38,.42)}',
  '.dshp-btn-small{padding:3px 9px;font-size:11.5px}',
  '.dshp-icon-btn{appearance:none;border:0;background:transparent;color:var(--dshp-label-2);width:24px;height:24px;',
  'border-radius:6px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex:none}',
  '.dshp-icon-btn:hover{background:var(--dshp-hover);color:var(--dshp-label)}',
  '.dshp-link{appearance:none;border:0;background:transparent;color:var(--dshp-accent);font:inherit;',
  'font-size:11.5px;cursor:pointer;padding:0}',
  '.dshp-link:hover{text-decoration:underline}',
  '.dshp-spacer{flex:1}',
  '.dshp-poem{padding:4px 0 6px}',
  '.dshp-poem-title{font-size:17px;font-weight:700;text-align:center;letter-spacing:.04em;',
  'font-family:"Noto Serif SC","Songti SC","STSong",serif}',
  '.dshp-poem-author{text-align:center;color:var(--dshp-label-2);font-size:12px;margin-top:2px}',
  '.dshp-poem-lines{margin-top:8px;display:flex;flex-direction:column;gap:2px;align-items:center}',
  '.dshp-line{display:flex;justify-content:center;flex-wrap:nowrap}',
  '.dshp-ch{display:inline-flex;flex-direction:column;align-items:center;min-width:1.15em;padding:0 .04em}',
  '.dshp-tone{font-size:9px;line-height:11px;height:11px;font-family:ui-monospace,Menlo,monospace;',
  'color:var(--dshp-label-2);opacity:.85}',
  '.dshp-chr{font-family:"Noto Serif SC","Songti SC","STSong",serif;font-size:18px;line-height:24px;',
  'color:var(--dshp-label)}',
  '.dshp-ch-ping .dshp-tone{color:var(--dshp-ping)}',
  '.dshp-ch-ping .dshp-chr{color:var(--dshp-ping)}',
  '.dshp-ch-ze .dshp-tone{color:var(--dshp-ze)}',
  '.dshp-ch-ze .dshp-chr{color:var(--dshp-ze)}',
  '.dshp-ch-any .dshp-tone{color:var(--dshp-any)}',
  '.dshp-ch-any .dshp-chr{color:var(--dshp-any)}',
  '.dshp-ch-punct .dshp-chr{color:var(--dshp-label-2);opacity:.8}',
  '.dshp-ch-rhyme .dshp-chr{border-bottom:2px solid var(--dshp-accent);padding-bottom:1px}',
  '.dshp-legend{display:flex;gap:12px;justify-content:center;margin-top:10px;color:var(--dshp-label-2);',
  'font-size:11px;flex-wrap:wrap}',
  '.dshp-legend-item{display:inline-flex;align-items:center;gap:4px}',
  '.dshp-legend-dot{width:7px;height:7px;border-radius:50%;display:inline-block}',
  '.dshp-legend-line{width:12px;height:2px;background:var(--dshp-accent);display:inline-block;border-radius:2px}',
  '.dshp-analysis{display:flex;flex-direction:column;gap:8px;padding:2px 0 4px}',
  '.dshp-kv{display:flex;gap:10px;font-size:12.5px}',
  '.dshp-kv-key{color:var(--dshp-label-2);min-width:64px;flex:none}',
  '.dshp-kv-val{color:var(--dshp-label);min-width:0;word-break:break-word}',
  '.dshp-block{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:10px;',
  'padding:8px 10px;font-size:12.5px;line-height:1.65}',
  '.dshp-tags{display:flex;flex-wrap:wrap;gap:6px}',
  '.dshp-tag{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:999px;',
  'padding:2px 9px;font-size:11.5px;color:var(--dshp-label-2)}',
  '.dshp-card{display:flex;flex-direction:column;gap:6px}',
  '.dshp-card-title{font-size:15px;font-weight:700}',
  '.dshp-card-summary{color:var(--dshp-label-2);font-size:12.5px}',
  '.dshp-ellipsis{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshp-p{margin:0;font-size:12.5px;line-height:1.65}',
  '.dshp-example{border-left:3px solid var(--dshp-accent);background:var(--dshp-bg-soft);',
  'border-radius:0 8px 8px 0;padding:6px 10px;margin:0}',
  '.dshp-example-text{font-family:"Noto Serif SC","Songti SC",serif;font-size:13px}',
  '.dshp-example-note{color:var(--dshp-label-2);font-size:11.5px;margin-top:2px}',
  '.dshp-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 2px}',
  '.dshp-pager-label{color:var(--dshp-label-2);font-size:12px}',
  '.dshp-ci-lines{display:flex;flex-direction:column;gap:2px;font-family:"Noto Serif SC","Songti SC",serif;',
  'font-size:13px;line-height:1.7;padding:6px 2px}',
  '.dshp-muted{color:var(--dshp-label-2)}',
  '.dshp-panel{position:fixed;z-index:62;width:min(420px,calc(100vw - 16px));height:min(560px,calc(100vh - 16px));',
  'display:flex;flex-direction:column;background:var(--dshp-bg);border:1px solid var(--dshp-border);',
  'border-radius:18px;box-shadow:var(--dshp-shadow);overflow:hidden;animation:dshp-pop 160ms ease-out}',
  '.dshp-panel-head{display:flex;align-items:center;gap:10px;padding:12px 12px 8px 16px}',
  '.dshp-panel-title{flex:1;min-width:0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}',
  '.dshp-panel-title small{color:var(--dshp-label-2);font-weight:400;font-size:11.5px;white-space:nowrap;',
  'overflow:hidden;text-overflow:ellipsis}',
  '.dshp-tabs{display:flex;gap:4px;padding:0 12px 8px;border-bottom:1px solid var(--dshp-border)}',
  '.dshp-tab{flex:1;appearance:none;border:0;background:transparent;color:var(--dshp-label-2);border-radius:9px;',
  'padding:6px 0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 120ms ease}',
  '.dshp-tab:hover{background:var(--dshp-hover)}',
  '.dshp-tab.dshp-is-active{background:var(--dshp-accent);color:#fff;font-weight:600}',
  '.dshp-panel-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 18px}',
  '.dshp-list{display:flex;flex-direction:column;gap:2px}',
  '.dshp-row{display:flex;align-items:flex-start;gap:8px;padding:8px 6px;border-radius:9px;border:0;',
  'background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}',
  '.dshp-row:hover{background:var(--dshp-hover)}',
  '.dshp-row.dshp-is-open{background:var(--dshp-bg-soft)}',
  '.dshp-row-main{flex:1;min-width:0}',
  '.dshp-row-title{font-size:13px;line-height:1.4;word-break:break-word}',
  '.dshp-row-sub{color:var(--dshp-label-2);font-size:11.5px}',
  '.dshp-row-body{padding:2px 8px 8px}',
  '.dshp-search{display:flex;gap:8px;margin-bottom:10px}',
  '.dshp-input,.dshp-select{appearance:none;border:1px solid var(--dshp-border-3);background:var(--dshp-bg);',
  'color:var(--dshp-label);border-radius:9px;padding:6px 10px;font:inherit;font-size:12.5px;min-width:0}',
  '.dshp-input{flex:1}',
  '.dshp-input:focus,.dshp-select:focus{border-color:var(--dshp-accent);outline:none}',
  '.dshp-select{max-width:136px}',
  '.dshp-settings{display:flex;flex-direction:column;gap:2px}',
  '.dshp-field{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 2px;',
  'border-bottom:1px solid var(--dshp-border)}',
  '.dshp-field:last-child{border-bottom:0}',
  '.dshp-field-label{display:flex;flex-direction:column;gap:1px;min-width:0}',
  '.dshp-field-label b{font-size:13px;font-weight:500}',
  '.dshp-field-label small{color:var(--dshp-label-2);font-size:11.5px}',
  '.dshp-field-control{display:flex;align-items:center;gap:6px;flex:none}',
  '.dshp-seg{display:inline-flex;background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);',
  'border-radius:9px;padding:2px;gap:2px}',
  '.dshp-seg-btn{appearance:none;border:0;background:transparent;color:var(--dshp-label-2);border-radius:7px;',
  'padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}',
  '.dshp-seg-btn.dshp-is-active{background:var(--dshp-accent);color:#fff}',
  '.dshp-range{width:150px;accent-color:var(--dshp-accent)}',
  '.dshp-switch{appearance:none;border:0;width:42px;height:24px;border-radius:999px;background:var(--dshp-border-3);',
  'position:relative;cursor:pointer;transition:background 140ms ease;flex:none}',
  '.dshp-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;',
  'background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform 140ms ease}',
  '.dshp-switch.dshp-is-on{background:var(--dshp-accent)}',
  '.dshp-switch.dshp-is-on::after{transform:translateX(18px)}',
  '.dshp-subtitle{font-size:12px;font-weight:600;color:var(--dshp-label-2);margin:14px 0 2px}',
  '.dshp-about{color:var(--dshp-label-2);font-size:11.5px;line-height:1.7;background:var(--dshp-bg-soft);',
  'border:1px solid var(--dshp-border);border-radius:12px;padding:10px 12px;display:flex;',
  'flex-direction:column;gap:2px;word-break:break-all}',
  '.dshp-fh-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
  '.dshp-fh-chip{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dshp-border);',
  'background:var(--dshp-bg-soft);color:var(--dshp-label);border-radius:999px;padding:3px 10px;',
  'font:inherit;font-size:12px;cursor:pointer;transition:background 120ms ease,border-color 120ms ease}',
  '.dshp-fh-chip:hover{border-color:var(--dshp-accent)}',
  '.dshp-fh-chip.dshp-is-active{background:var(--dshp-accent);border-color:transparent;color:#fff}',
  '.dshp-fh-chip small{font-size:10.5px;color:var(--dshp-label-2)}',
  '.dshp-fh-chip.dshp-is-active small{color:rgba(255,255,255,.8)}',
  '.dshp-fh-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;',
  'color:var(--dshp-label-2);margin:2px 0 8px}',
  '.dshp-fh-meta b{color:var(--dshp-label);font-weight:600;font-size:13px}',
  '.dshp-fh-system{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:12px;',
  'padding:8px 10px;margin:6px 0;font-family:"Noto Serif SC","Songti SC",serif;font-size:13px;line-height:1.6}',
  '.dshp-fh-system small{display:block;color:var(--dshp-label-2);font-family:inherit;font-size:11px;margin-top:2px}',
  '.dshp-fh-prompt{font-size:12.5px;color:var(--dshp-label-2);margin:4px 0 6px}',
  '.dshp-fh-feedback{min-height:18px;font-size:12px;line-height:1.5;margin-top:8px;color:var(--dshp-label-2)}',
  '.dshp-fh-feedback.dshp-is-good{color:#16a34a}',
  '.dshp-fh-feedback.dshp-is-bad{color:var(--dshp-danger)}',
  '.dshp-fh-result{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:12px;',
  'padding:10px 12px;margin:8px 0;display:flex;flex-direction:column;gap:4px;font-size:12.5px}',
  '.dshp-fh-result b{font-size:14px}',
  '.dshp-fh-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
  '.dshp-fh-atlas{display:flex;flex-direction:column;gap:2px}',
  '.dshp-fh-line{display:flex;flex-direction:column;gap:1px;padding:7px 4px;',
  'border-bottom:1px solid var(--dshp-border)}',
  '.dshp-fh-line:last-child{border-bottom:0}',
  '.dshp-fh-line-text{font-family:"Noto Serif SC","Songti SC",serif;font-size:13px;line-height:1.6}',
  '.dshp-fh-line-source{color:var(--dshp-label-2);font-size:11px}',
  '.dshp-detail{display:flex;flex-direction:column;gap:8px}',
  '.dshp-lib-detail-title{font-size:15px;font-weight:700;text-align:center;font-family:"Noto Serif SC","Songti SC",serif}',
  '.dshp-lib-note{font-size:11.5px;color:var(--dshp-label-2);line-height:1.6}',
  '.dshp-lib-lines{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0}',
  '.dshp-lib-plain{display:flex;flex-direction:column;gap:2px;font-family:"Noto Serif SC","Songti SC",serif;font-size:14px;line-height:1.8;padding:6px 2px}',
  '.dshp-lib-tags{display:flex;flex-wrap:wrap;gap:6px}',
  '.dshp-lib-report{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:10px;padding:8px 10px;font-size:12.5px;line-height:1.6}',
  '.dshp-lib-errors{font-size:11.5px;color:var(--dshp-danger);line-height:1.6}',
  '.dshp-lib-detect-lines{display:flex;flex-direction:column;align-items:center;gap:2px}',
  '.dshp-lib-multi{font-size:11.5px;color:var(--dshp-label-2);line-height:1.6;word-break:break-word}',
  '.dshp-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dshp-border-3);border-radius:10px;background:var(--dshp-bg);color:var(--dshp-label);padding:8px 10px;font:inherit;font-size:12.5px;line-height:1.6;resize:vertical}',
  '.dshp-textarea:focus{border-color:var(--dshp-accent);outline:none}',
  '.dshp-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:26px 14px}',
  '.dshp-empty-icon{font-size:26px;line-height:1}',
  '.dshp-empty-title{font-weight:600;font-size:13.5px}',
  '.dshp-empty-msg{color:var(--dshp-label-2);font-size:12px;line-height:1.6}',
  '.dshp-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px 10px;',
  'color:var(--dshp-label-2);font-size:12.5px}',
  '.dshp-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dshp-border-3);',
  'border-top-color:var(--dshp-accent);animation:dshp-spin .8s linear infinite}',
  '@keyframes dshp-spin{to{transform:rotate(360deg)}}',
  '.dshp-toast{position:fixed;z-index:70;background:var(--dshp-bg);color:var(--dshp-label);',
  'border:1px solid var(--dshp-border);border-radius:10px;padding:7px 12px;font-size:12px;',
  'box-shadow:var(--dshp-shadow);animation:dshp-pop 140ms ease-out;pointer-events:none}',
  '.dshp-toast.dshp-is-error{color:var(--dshp-danger);border-color:rgba(220,38,38,.42)}',
  '@media (prefers-color-scheme: dark){',
  '.dshp-root{--dshp-bg:var(--dsw-alias-bg-module-platform,#1f2124);',
  '--dshp-bg-soft:var(--dsw-alias-bg-base-platform,#17181a);',
  '--dshp-label:var(--dsw-alias-label-primary,#e8eaed);',
  '--dshp-label-2:var(--dsw-alias-label-secondary,#9aa0a6);',
  '--dshp-border:var(--dsw-alias-border-l2,#33363a);',
  '--dshp-border-3:var(--dsw-alias-border-l3,#4a4e54);',
  '--dshp-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));',
  '--dshp-accent:var(--dsw-static-accent,#6b8cff);',
  '--dshp-ping:#7fb0ff;--dshp-ze:#ff8a8a;--dshp-any:#a3a9b3;',
  '--dshp-danger:#ff8a8a;--dshp-shadow:0 12px 40px rgba(0,0,0,.5)}}',
  '@media (prefers-reduced-motion: reduce){',
  '.dshp-root *,.dshp-root *::before{animation-duration:.01ms!important;',
  'animation-iteration-count:1!important;transition-duration:.01ms!important}}',
  ].join('')
  const DEBUG = {
  ROUTE,
  ASSET_BASE,
  WIDGET_ID,
  STEPS,
  PANEL_TABS,
  DEFAULT_SETTINGS,
  buildToneCells,
  selectPoemText,
  selectCiText,
  poemRhymeLines,
  normalizeSettings,
  settingsPatch,
  buildSettingsRequest,
  createSettingsSaver,
  selectNextPoemId,
  clampPosition,
  anchorPosition,
  describeDataError,
  formatDateLabel,
  hashString,
  fetchJson,
  loadResource,
  clearResourceCache,
  readFirstScreenCache,
  writeFirstScreenCache,
  clearFirstScreenCache,
  putSettings,
  FEIHUA_BEST_KEY,
  FEIHUA_CANDIDATE_CHARS,
  FEIHUA_MIN_ENTRIES,

  FEIHUA_ATLAS_LIMIT,
  FEIHUA_ATLAS_PAGE,
  buildFeihuaIndex,
  getFeihuaIndex,
  clearFeihuaIndexCache,
  pickDefaultFeihuaChar,
  feihuaStart,
  feihuaSubmit, feihuaLookup, feihuaPlainOf, mergeFeihuaFullEntries, requestFeihuaFull, abortFeihuaFull, clearFeihuaFullCache, readFeihuaFullCache, FEIHUA_FULL_PATH, FEIHUA_FULL_TIMEOUT_MS, FEIHUA_FULL_RETRY_MS,
  PET_MEDIA_PATH, PET_MEDIA_CATALOG_FILE, PET_MEDIA_TIMEOUT_MS, isVideoMoodFile, petMediaUrl, mascotVideoShouldPause, mascotFilePriority,
  DIZZY_MIN_MS, DIZZY_MAX_MS, mealTriggerFor, DIZZY_FAST_PX_PER_SEC, DIZZY_FAST_DISTANCE_PX, DIZZY_FAST_WINDOW_MS, MEAL_KEY, MEAL_PLAY_MIN_MS, MEAL_PLAY_MAX_MS, detectFastDrag, nextDizzyDuration, nextMealDuration, mealMomentFor, normalizeMealState, readMealState, writeMealState, markMealDone, pickDizzyMedia, pickMealMedia, normalizePetMediaCatalog, mergePetMediaIntoCatalog, requestPetMediaCatalog, clearPetMediaCache,
  MOTION_ROTATION_KEY, MOTION_MIN_DELAY_MS, MOTION_MAX_DELAY_MS, MOTION_PLAY_MIN_MS, MOTION_PLAY_MAX_MS, MOTION_FIRST_MIN_DELAY_MS, MOTION_FIRST_MAX_DELAY_MS, nextMotionFirstDelay, nextMotionScheduleDelay, readMotionRotation, writeMotionRotation, nextMotionEntry, nextMotionDelay, nextMotionDuration,
  normalizeFeihuaBest,
  feihuaBestUpdate,
  readFeihuaBest,
  writeFeihuaBest,
  MASCOT_FILES,
  mascotStateFor,
  mascotFileFor,
  mascotUrl,
  weatherPoemTags,
  countWeatherTagHits,
  buildWeatherPoemPool,
  selectWeatherPoemEntry,
  weatherChipText,
  weatherExplainText,
  weatherUpdatedLabel,
  requestWeather,
  MOOD_LABELS, MOOD_IMAGES, MOOD_SWITCH_MIN_MS, MOOD_STRONG, MOOD_AI_PATH, MOOD_AI_TIMEOUT_MS, MOOD_AI_DEBOUNCE_MIN_MS, MOOD_AI_DEBOUNCE_MAX_MS, MOOD_AI_MIN_GAP_MS, MOOD_AI_RETRY_MIN_MS, MOOD_AI_RETRY_MAX_MS, MOOD_AI_KEEP_MS, MOOD_AI_MAX_RETRIES, nextMoodAiRetryDelay, moodAiKeepDecision, normalizeMoodAiFailure, moodAiFailureLabel, moodAiEventDelay, MOOD_AI_RECENT_MAX, MOOD_AI_RECENT_IMAGES_MAX, MOOD_PANEL_PEEK_FILES,
  SPONT_KEY, SPONT_POLL_MIN_MS, SPONT_POLL_MAX_MS, SPONT_RETRY_MS, SPONT_EVENT_MIN_MS, SPONT_EVENT_MAX_MS, SPONT_CLOSE_RECHECK_MS, SPONT_QUIET_MS, SPONT_REPEAT_MS, SPONT_AUTO_CLOSE_MS, SPONT_SEEN_DAYS, SPONT_MAX_SEEN, MURMUR_TITLES,
  MURMUR_POOL, MURMUR_TEMPLATES,
  buildMurmurContext, murmurTagsForContext, buildMurmurCandidates, pickMurmur, selfTalkQuery, parseSelfTalkResponse, requestSelfTalk, selfTalkKindFor, SELF_TALK_PATH, SELF_TALK_TIMEOUT_MS, SELF_TALK_RECENT_MAX,
  shanghaiParts, normalizeMoodStats, computeMood, throttleMoodSwitch, mascotImageFor, moodBasisText, requestMood, normalizeMoodCatalog, panelPeekFile, moodCatalogAllows, moodAiQuery, parseMoodAiResponse, requestMoodAi, nextMoodAiDebounceDelay, moodAiSnapshot, moodTimeBucket, isMoodAiSignificant, moodImageFor: (key) => (MOOD_IMAGES[key] || MOOD_IMAGES.calm)[0],
  normalizeSpontState, readSpontState, writeSpontState, recordSpontShown, canShowSpontaneous, nextSpontPollDelay, nextSpontEventDelay, countSpontHits, splitCompleteSentences, pickSentenceFromLines,
  LIBRARY_CATEGORIES, LIBRARY_CATEGORY_ALIASES, LIBRARY_PAGE, ASSET_DATA_FILES,
  TONE_QUATRAINS, MASCOT_EGG_KEY, MASCOT_EXPRESSION_FILES, MASCOT_EXPRESSION_MS, MASCOT_IDLE_MIN_MS, MASCOT_IDLE_USER_MS,
  assetUrlFor, buildLibraryItems, filterLibraryItems, libraryPage, libraryItemLabel, ciBankRhythmics, ciSelectedLibraryItems, ciSelectedRhythmics, mergeFeihuaItems, finishFeihuaIndex, feihuaSourceOf, completeSentencesFromLines,
  buildPingshuiIndex, annotatePoemLines, detectMetre, detectPoem, detectPoemText, parsePoemInput, formatDetectionReport, detectionRhymeIndexes, patternForShape,
  setAssetDataVersion, normalizeMascotEggState, readMascotEggState, writeMascotEggState, recordMascotEgg, shouldShowDailyGreet, canShowIdlePose, pickMascotExpression,
  LibraryTab,
  PoetryWidget,
  TodayTab,
  ClassTab,
  YunTab,
  CiTab,
  FeihuaTab,
  SettingsTab,
  }
  try {
  if (typeof globalThis !== 'undefined') globalThis.__dshPoetryDebug = DEBUG
  } catch (error) {
  }
  function readWindowWidth() {
  try {
   return window.innerWidth || 1280
  } catch (error) {
   return 1280
  }
  }

  function readWindowHeight() {
  try {
   return window.innerHeight || 800
  } catch (error) {
   return 800
  }
  }

  function useViewportSize() {
  const [size, setSize] = React.useState(() => ({ w: readWindowWidth(), h: readWindowHeight() }))
  React.useEffect(() => {
   const onResize = () => setSize({ w: readWindowWidth(), h: readWindowHeight() })
   window.addEventListener('resize', onResize)
   return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
  }

  /**

  */
  function useResource(kind, active) {
  const [state, setState] = React.useState(() => ({
   status: resourceCache[kind] ? 'ready' : 'idle',
   data: resourceCache[kind] || null,
   error: null,
  }))
  const alive = React.useRef(true)
  const statusRef = React.useRef(state.status)
  statusRef.current = state.status
  React.useEffect(() => () => {
   alive.current = false
  }, [])
  const reload = React.useCallback(() => {
   if (statusRef.current === 'loading') return Promise.resolve()
   statusRef.current = 'loading'
   setState((previous) => ({ status: 'loading', data: previous.data, error: null }))
   return loadResource(kind).then(
    (data) => {
    statusRef.current = 'ready'
    if (alive.current) setState({ status: 'ready', data, error: null })
    return data
    },
    (error) => {
    statusRef.current = 'error'
    if (alive.current) setState({ status: 'error', data: null, error })
    throw error
    },
   )
  }, [kind])
  React.useEffect(() => {
   if (active && statusRef.current === 'idle') reload().catch(() => {})
  }, [active, reload])
  return [state, reload]
  }

  function LoadingState(props) {
  return h(
   'div',
   { className: 'dshp-loading' },
   h('span', { className: 'dshp-spinner', 'aria-hidden': 'true' }),
   h('span', null, (props && props.text) || '正在载入…'),
  )
  }

  function EmptyState(props) {
  const options = props || {}
  return h(
   'div',
   { className: 'dshp-empty' },
   h('div', { className: 'dshp-empty-icon', 'aria-hidden': 'true' }, options.icon || '📜'),
   h('div', { className: 'dshp-empty-title' }, options.title || '暂时没有内容'),
   h('div', { className: 'dshp-empty-msg' }, options.message || '请稍后重试'),
   options.onRetry
    ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', onClick: options.onRetry }, options.retryLabel || '重试')
    : null,
  )
  }

  function Legend() {
  return h(
   'div',
   { className: 'dshp-legend', 'aria-label': '平仄图例' },
   h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-dot', style: { background: 'var(--dshp-ping)' } }), '平'),
   h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-dot', style: { background: 'var(--dshp-ze)' } }), '仄'),
   h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-dot', style: { background: 'var(--dshp-any)' } }), '多音'),
   h('span', { className: 'dshp-legend-item' }, h('span', { className: 'dshp-legend-line' }), '韵脚'),
  )
  }

  function ToneLine(props) {
  const cells = buildToneCells(props.line, props.tones, {
   showTones: props.showTones !== false,
   rhymeLine: props.rhyme === true,
  })
  return h(
   'div',
   { className: 'dshp-line' },
   cells.map((cell, index) => h(
    'span',
    {
    key: index,
    className: cell.className,
    title: cell.punctuation ? undefined : (cell.tone || ''),
    },
    cell.tone ? h('span', { className: 'dshp-tone', 'aria-hidden': 'true' }, cell.tone) : null,
    h('span', { className: 'dshp-chr' }, cell.ch),
   )),
  )
  }

  function PoemBody(props) {
  if (!props.poem) return null
  const text = selectPoemText(props.poem, props.script)
  const rhymeLines = poemRhymeLines(props.poem)
  return h(
   'div',
   { className: 'dshp-poem' },
   h('div', { className: 'dshp-poem-title' }, text.title || '无题'),
   text.author ? h('div', { className: 'dshp-poem-author' }, text.author) : null,
   h(
    'div',
    { className: 'dshp-poem-lines' },
    text.lines.map((line, index) => h(ToneLine, {
    key: index,
    line,
    tones: Array.isArray(props.poem.tones) ? props.poem.tones[index] : '',
    rhyme: rhymeLines.indexOf(index) >= 0,
    showTones: props.showTones !== false,
    })),
   ),
   props.showTones !== false ? h(Legend) : null,
  )
  }

  function AnalysisBody(props) {
  const poem = props.poem || {}
  const rhymeLines = poemRhymeLines(poem).map((index) => '第 ' + (index + 1) + ' 句')
  const firstRhyme = poem.firstRhyme === true ? '是' : (poem.firstRhyme === false ? '否' : '—')
  return h(
   'div',
   { className: 'dshp-analysis' },
   h(
    'div',
    { className: 'dshp-tags' },
    h('span', { className: 'dshp-tag' }, '体式：' + (poem.form || '—')),
    h('span', { className: 'dshp-tag' }, '起式：' + (poem.start || '—')),
    h('span', { className: 'dshp-tag' }, '首句入韵：' + firstRhyme),
   ),
   h(
    'div',
    { className: 'dshp-kv' },
    h('span', { className: 'dshp-kv-key' }, '标准格式'),
    h('span', { className: 'dshp-kv-val' }, poem.meter || '—'),
   ),
   h(
    'div',
    { className: 'dshp-analysis-text dshp-block' },
    poem.analysis ? String(poem.analysis) : '暂无解析文本。',
   ),
   rhymeLines.length
    ? h(
    'div',
    { className: 'dshp-kv' },
    h('span', { className: 'dshp-kv-key' }, '入韵句'),
    h('span', { className: 'dshp-kv-val' }, rhymeLines.join('、')),
    )
    : null,
  )
  }

  function CiBody(props) {
  const ci = props.ci
  if (!ci) return null
  const text = selectCiText(ci)
  return h(
   'div',
   { className: 'dshp-poem' },
   h('div', { className: 'dshp-poem-title' }, text.title || '无题'),
   text.author ? h('div', { className: 'dshp-poem-author' }, text.author) : null,
   h('div', { className: 'dshp-ci-lines' }, text.lines.map((line, index) => h('div', { key: index }, line))),
  )
  }
  function PoetryWidget(props) {
  const ctx = props && props.ctx
  const cacheRef = React.useRef(null)
  const cacheLoadedRef = React.useRef(false)
  if (!cacheLoadedRef.current) {
   cacheLoadedRef.current = true
   cacheRef.current = readFirstScreenCache()
  }

  const [boot, setBoot] = React.useState(() => {
   const cached = cacheRef.current
   if (cached && cached.bootstrap) {
    return { status: 'ready', data: cached.bootstrap, fromCache: true, stale: true, error: null }
   }
   return { status: 'loading', data: null, fromCache: false, stale: false, error: null }
  })
  const [reloadTick, setReloadTick] = React.useState(0)
  const [settings, setSettings] = React.useState(() => normalizeSettings(cacheRef.current && cacheRef.current.settings))
  const settingsRef = React.useRef(settings)
  settingsRef.current = settings

  const [step, setStep] = React.useState(-1)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [panelTab, setPanelTab] = React.useState('today')
  const [selectedPoemId, setSelectedPoemId] = React.useState(null)
  const [toast, setToast] = React.useState(null)
  const [feihuaLaunch, setFeihuaLaunch] = React.useState(0)
  const [weatherRes, setWeatherRes] = React.useState(() => {
   const cached = weatherCache
   if (cached && cached.data && cached.data.ok) {
    return { status: 'ready', data: cached.data, error: null, at: cached.at }
   }
   return { status: 'idle', data: null, error: null, at: 0 }
  })
  const [mascotPulse, setMascotPulse] = React.useState(null)
  const [failedMascot, setFailedMascot] = React.useState('')
  const [moodRes, setMoodRes] = React.useState(() => {
   const cached = moodCache
   return cached && cached.data ? { status: 'ready', data: cached.data, at: cached.at } : { status: 'idle', data: null, at: 0 }
  })
  const [moodView, setMoodView] = React.useState(null)
  const [spontPoem, setSpontPoem] = React.useState(null)
  const [spontPreview, setSpontPreview] = React.useState(false)
  const [mascotExpression, setMascotExpression] = React.useState('')
  const [selfTalkFallback, setSelfTalkFallback] = React.useState(false)
  const [moodSource, setMoodSource] = React.useState('')
  const [moodAiFallback, setMoodAiFallback] = React.useState(false)
  const [moodAiStale, setMoodAiStale] = React.useState(false)
  const [moodAiFailure, setMoodAiFailure] = React.useState('')
  const [moodAiFailureCode, setMoodAiFailureCode] = React.useState('')
  const [petMediaRes, setPetMediaRes] = React.useState({ status: 'idle', entries: [] })
  const [motionFile, setMotionFile] = React.useState('')
  const [dizzy, setDizzy] = React.useState(null)
  const [mealActive, setMealActive] = React.useState(null)
  const [libraryFocus, setLibraryFocus] = React.useState(null)
  const [ciBankWanted, setCiBankWanted] = React.useState(false)
  const [feihuaIndex, setFeihuaIndex] = React.useState(null)
  const [feihuaBuilding, setFeihuaBuilding] = React.useState(false)
  const [moodTick, setMoodTick] = React.useState(0)
  const [spontWake, setSpontWake] = React.useState(0)

  const [pos, setPos] = React.useState(() => {
   const stored = readStoredPosition()
   const viewport = { w: readWindowWidth(), h: readWindowHeight() }
   if (stored) return clampPosition(stored, BASE_SIZE, viewport)
   return { x: 16, y: Math.max(8, viewport.h - BASE_SIZE - 24) }
  })
  const posRef = React.useRef(pos)
  posRef.current = pos
  const dragRef = React.useRef(null)
  const pressTimer = React.useRef(null)
  const toastTimer = React.useRef(null)
  const mascotTimerRef = React.useRef(null)
  const weatherInFlightRef = React.useRef(null)
  const userPickedPoemRef = React.useRef(false)
  const moodViewRef = React.useRef(null)
  const clicksRef = React.useRef(0)
  const panelOpensRef = React.useRef(0)
  const lastInteractionRef = React.useRef(0)
  const feihuaWinsRef = React.useRef(0)
  const feihuaLossesRef = React.useRef(0)
  const moodStatsRef = React.useRef(emptyMoodStats())
  const moodForceRef = React.useRef(false)
  const moodSourceRef = React.useRef('')
  const moodAiRef = React.useRef({ at: 0, lastRequestAt: 0, image: '' })
  const moodAiSnapshotRef = React.useRef(null)
  const moodAiTokenRef = React.useRef(0)
  const moodAiInFlightRef = React.useRef(false)
  const moodAiPendingRef = React.useRef(false)
  const moodAiDebounceTimerRef = React.useRef(null)
  const moodAiRetryTimerRef = React.useRef(null)
  const moodAiRetryCountRef = React.useRef(0)
  const moodStatsSnapshotRef = React.useRef(null)
  const moodTimeBucketRef = React.useRef('')
  const moodIdleRef = React.useRef(false)
  const moodWeatherSigRef = React.useRef('')
  const moodPrevPanelOpenRef = React.useRef(false)
  const moodPrevPanelTabRef = React.useRef('today')
  const moodPrevSpontRef = React.useRef(null)
  const recentImagesRef = React.useRef([])
  const moodCatalogRef = React.useRef(null)
  const spontWakeDelayRef = React.useRef(0)
  const prevPanelOpenRef = React.useRef(false)
  const prevStepRef = React.useRef(-1)
  const prevCardRef = React.useRef(null)
  const moodWakeSigRef = React.useRef('')
  const weatherWakeSigRef = React.useRef('')
  const weatherRef = React.useRef(null)
  const spontPoemRef = React.useRef(null)
  const uiRef = React.useRef({})
  const mascotExprTimerRef = React.useRef(null)
  const mascotTapRef = React.useRef(0)
  const mascotVideoRef = React.useRef(null)
  const mascotPulseRef = React.useRef(null)
  const mascotExpressionRef = React.useRef('')
  const petMediaEntriesRef = React.useRef([])
  const motionFileRef = React.useRef('')
  const motionIndexRef = React.useRef(readMotionRotation())
  const motionDelayTimerRef = React.useRef(null)
  const motionStopTimerRef = React.useRef(null)
  const motionFirstScheduledRef = React.useRef(false)
  const motionFirstPendingRef = React.useRef(false)
  const dizzyRef = React.useRef(null)
  const dizzyTimerRef = React.useRef(null)
  const mealActiveRef = React.useRef(null)
  const mealTimerRef = React.useRef(null)
  const mealPrevPanelRef = React.useRef(false)
  const spontReqRef = React.useRef(0)
  const selfTalkCacheRef = React.useRef({ murmur: [], intro: [] })
  const recentSpokenRef = React.useRef([])
  spontPoemRef.current = spontPoem
  mascotPulseRef.current = mascotPulse
  mascotExpressionRef.current = mascotExpression
  petMediaEntriesRef.current = petMediaRes.entries
  motionFileRef.current = motionFile
  dizzyRef.current = dizzy
  mealActiveRef.current = mealActive

  const wakeSpontaneous = React.useCallback((delay) => {
   spontWakeDelayRef.current = Math.max(1000, num(delay, nextSpontEventDelay()))
   setSpontWake((tick) => tick + 1)
  }, [])

  const showToast = React.useCallback((text, kind) => {
   setToast({ text: String(text == null ? '' : text), kind: kind === 'error' ? 'error' : 'info' })
   if (toastTimer.current) clearTimeout(toastTimer.current)
   toastTimer.current = setTimeout(() => {
    toastTimer.current = null
    setToast(null)
   }, 2600)
  }, [])
  const showToastRef = React.useRef(null)
  showToastRef.current = showToast
  React.useEffect(() => () => {
   if (toastTimer.current) {
    clearTimeout(toastTimer.current)
    toastTimer.current = null
   }
  }, [])

  const saverRef = React.useRef(null)
  if (!saverRef.current) {
   saverRef.current = createSettingsSaver({
    delay: SAVE_DEBOUNCE_MS,
    put: (patch) => putSettings(patch),
    onError: () => {
    if (showToastRef.current) showToastRef.current('保存失败，已保留本地设置', 'error')
    },
   })
  }
  React.useEffect(() => () => {
   if (saverRef.current) saverRef.current.flush().catch(() => {})
   if (pressTimer.current) {
    clearTimeout(pressTimer.current)
    pressTimer.current = null
   }
   if (mascotTimerRef.current) {
    clearTimeout(mascotTimerRef.current)
    mascotTimerRef.current = null
   }
   if (mascotExprTimerRef.current) {
    clearTimeout(mascotExprTimerRef.current)
    mascotExprTimerRef.current = null
   }
  }, [])

  const updateSettings = React.useCallback((patch, options) => {
   if (!patch || typeof patch !== 'object') return settingsRef.current
   const previous = settingsRef.current
   const next = normalizeSettings(Object.assign({}, previous, patch))
   settingsRef.current = next
   setSettings(next)
   if (!(options && options.localOnly) && saverRef.current) {
    const changed = {}
    for (let i = 0; i < WRITE_KEYS.length; i++) {
    const key = WRITE_KEYS[i]
    if (hasOwn(patch, key) && next[key] !== previous[key]) changed[key] = next[key]
    }
    if (Object.keys(changed).length) saverRef.current.save(changed)
   }
   wakeSpontaneous(nextSpontEventDelay())
   if (settingsRef.current.mood) scheduleMoodAiRefresh()
   return next
  }, [])

  /** 飞花令/交互反馈：临时切换立绘 2.5s 后回落到天气/默认状态。 */
  const pulseMascot = React.useCallback((key) => {
   if (!MASCOT_FILES[key]) return
   if (key === 'gameWin') feihuaWinsRef.current += 1
   if (key === 'gameLose') feihuaLossesRef.current += 1
   if (key === 'gameWin' || key === 'gameLose') {
    wakeSpontaneous(nextSpontEventDelay())
    scheduleMoodAiRefresh()
   }
   lastInteractionRef.current = Date.now()
   setMascotPulse(key)
   if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
   mascotTimerRef.current = setTimeout(() => {
    mascotTimerRef.current = null
    setMascotPulse(null)
   }, MASCOT_TRANSIENT_MS)
  }, [])

  /** 拉取天气（失败静默：仅更新状态，不弹 toast；保留上次结果）。 */
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

  const applyMood = React.useCallback((force) => {
   const current = settingsRef.current
   if (!current.mood && !current.spontaneousPoem) {
    moodViewRef.current = null
    setMoodView(null)
    return null
   }
   const next = computeMood({
    stats: moodStatsRef.current,
    weather: weatherRef.current,
    signals: {
    now: Date.now(),
    clicks: clicksRef.current,
    lastInteractionAt: lastInteractionRef.current,
    feihuaWins: feihuaWinsRef.current,
    feihuaLosses: 0,
    panelOpens: panelOpensRef.current,
    },
   })
   const selected = throttleMoodSwitch(moodViewRef.current, next, Date.now(), force === true)
   moodViewRef.current = selected
   setMoodView(selected)
   return selected
  }, [])

  const applyModelMood = React.useCallback((mood) => {
   if (!mood || !mood.image) return null
   const view = Object.assign({}, mood, { changed: true, switchedAt: Date.now() })
   moodSourceRef.current = 'model'
   moodViewRef.current = view
   setMoodSource('model')
   setMoodAiFallback(false)
   setMoodAiStale(false)
   setMoodAiFailure('')
   setMoodAiFailureCode('')
   clearMoodAiRetry()
   setMoodView(view)
   moodAiRef.current = Object.assign({}, moodAiRef.current, { at: Date.now(), image: mood.image })
   const images = recentImagesRef.current.filter((file) => file !== mood.image)
   images.push(mood.image)
   recentImagesRef.current = images.slice(-MOOD_AI_RECENT_IMAGES_MAX)
   return view
  }, [])

  const fallbackHeuristicMood = React.useCallback((force) => {
   moodSourceRef.current = 'heuristic'
   setMoodSource('heuristic')
   setMoodAiFallback(true)
   return applyMood(force === true)
  }, [applyMood])

  function clearMoodAiRetry() {
   if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
   moodAiRetryCountRef.current = 0
  }

  function scheduleMoodAiRetry() {
   if (!settingsRef.current.mood || settingsRef.current.hidden) return
   if (moodAiRetryCountRef.current >= MOOD_AI_MAX_RETRIES) return
   if (moodAiRetryTimerRef.current) clearTimeout(moodAiRetryTimerRef.current)
   moodAiRetryTimerRef.current = setTimeout(() => {
    moodAiRetryTimerRef.current = null
    if (!settingsRef.current.mood || settingsRef.current.hidden) return
    if (moodAiInFlightRef.current) {
     moodAiPendingRef.current = true
     return
    }
    requestModelMood()
   }, nextMoodAiRetryDelay())
  }

  function handleMoodAiFailure(result) {
   const reason = normalizeMoodAiFailure(result)
   const code = result && typeof result.code === 'string' ? result.code : (reason.indexOf('host:') === 0 ? reason.slice(5) : '')
   setMoodAiFailure(reason)
   setMoodAiFailureCode(code)
   moodAiRetryCountRef.current += 1
   const keep = moodAiKeepDecision({ source: moodSourceRef.current, lastSuccessAt: moodAiRef.current.at, now: Date.now() })
   if (keep) {
    setMoodAiStale(true)
    setMoodAiFallback(false)
   } else {
    setMoodAiStale(false)
    fallbackHeuristicMood(true)
   }
   if (moodAiRetryCountRef.current < MOOD_AI_MAX_RETRIES) {
    scheduleMoodAiRetry()
   } else if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
  }

  const requestModelMood = React.useCallback(() => {
   const current = settingsRef.current
   if (!current.mood) return Promise.resolve({ ok: false, reason: 'disabled' })
   const catalog = moodCatalogRef.current
   if (!catalog) {
    setMoodAiFallback(true)
    return Promise.resolve({ ok: false, reason: 'catalog' })
   }
   if (moodAiInFlightRef.current) {
    moodAiPendingRef.current = true
    return Promise.resolve({ ok: false, reason: 'inflight' })
   }
   const now = Date.now()
   moodAiRef.current = Object.assign({}, moodAiRef.current, { lastRequestAt: now })
   const token = moodAiTokenRef.current + 1
   moodAiTokenRef.current = token
   moodAiInFlightRef.current = true
   const stats = moodStatsRef.current
   const weather = weatherRef.current || null
   const currentMoodKey = moodViewRef.current && moodViewRef.current.key && moodViewRef.current.key !== 'ai'
    ? moodViewRef.current.key
    : 'calm'
   const recent = recentSpokenRef.current.slice(-MOOD_AI_RECENT_MAX)
   const recentImages = recentImagesRef.current.slice(-MOOD_AI_RECENT_IMAGES_MAX)
   const idleMinutes = lastInteractionRef.current > 0 ? Math.max(0, Math.floor((now - lastInteractionRef.current) / 60000)) : 0
   moodAiSnapshotRef.current = moodAiSnapshot(stats, weather, feihuaWinsRef.current, feihuaLossesRef.current)
   const finish = () => {
    if (token !== moodAiTokenRef.current) return
    moodAiInFlightRef.current = false
    if (moodAiPendingRef.current && settingsRef.current.mood) {
     moodAiPendingRef.current = false
     scheduleMoodAiRefresh()
    }
   }
   return requestMoodAi({
    force: true,
    moodKey: currentMoodKey,
    weather: weather ? String(weather.category || weather.label || '') : '',
    idleMinutes,
    recent,
    recentImages,
    catalog,
   }).then((result) => {
    finish()
    if (token !== moodAiTokenRef.current) return result
    if (!settingsRef.current.mood) return result
    if (result && result.ok && result.mood) {
     applyModelMood(result.mood)
     return result
    }
    handleMoodAiFailure(result)
    return result
   }).catch(() => {
    finish()
    if (token === moodAiTokenRef.current && settingsRef.current.mood) handleMoodAiFailure({ reason: 'network' })
    return { ok: false }
   })
  }, [applyModelMood, fallbackHeuristicMood])

  function scheduleMoodAiRefresh(options) {
   const opts = options && typeof options === 'object' ? options : {}
   if (!settingsRef.current.mood || settingsRef.current.hidden) return
   // 有事件触发的正常请求时，取消待执行的自动重试，避免双发
   if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
   if (moodAiDebounceTimerRef.current) clearTimeout(moodAiDebounceTimerRef.current)
   const delay = opts.immediate === true
    ? 0
    : moodAiEventDelay({ lastRequestAt: moodAiRef.current.lastRequestAt, now: Date.now() })
   moodAiDebounceTimerRef.current = setTimeout(() => {
    moodAiDebounceTimerRef.current = null
    if (!settingsRef.current.mood || settingsRef.current.hidden) return
    if (moodAiInFlightRef.current) {
     moodAiPendingRef.current = true
     return
    }
    requestModelMood()
   }, Math.max(0, delay))
  }
  const refreshMoodNow = React.useCallback(() => {
   moodForceRef.current = true
   scheduleMoodAiRefresh({ immediate: true })
   return requestMood().then((data) => {
    moodStatsRef.current = data.stats
    setMoodRes({ status: data.ok ? 'ready' : 'error', data, at: Date.now() })
    return data
   })
  }, [requestModelMood])

  function showMascotExpression(file) {
   if (!file) return
   setMascotExpression(file)
   if (mascotExprTimerRef.current) clearTimeout(mascotExprTimerRef.current)
   mascotExprTimerRef.current = setTimeout(() => {
    mascotExprTimerRef.current = null
    setMascotExpression('')
   }, MASCOT_EXPRESSION_MS)
  }

  React.useEffect(() => {
   const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const ui = uiRef.current
    if (ui.panelOpen || ui.step >= 0 || ui.settings.hidden) return
    if (mascotExprTimerRef.current) return
    const now = Date.now()
    const state = readMascotEggState(now)
    if (!canShowIdlePose(state, now, lastInteractionRef.current)) return
    writeMascotEggState(recordMascotEgg(state, { idle: true }, now))
    showMascotExpression(pickMascotExpression())
   }, MASCOT_IDLE_POLL_MS)
   return () => clearInterval(timer)
  }, [])

  const viewport = useViewportSize()
  const mascotSize = Math.max(40, Math.round(BASE_SIZE * settings.scale))
  React.useEffect(() => {
   let alive = true
   fetchJson('bootstrap.json').then(
    (data) => {
    if (!alive) return
    const cached = cacheRef.current
    if (cached && cached.dataVersion && data.dataVersion && cached.dataVersion !== data.dataVersion) {
     clearFirstScreenCache()
     clearResourceCache()
     cacheRef.current = null
    }
    const normalized = normalizeSettings(data.settings)
    settingsRef.current = normalized
    setSettings(normalized)
    setAssetDataVersion(data.dataVersion)
    setBoot({ status: 'ready', data, fromCache: false, stale: false, error: null })
    },
    (error) => {
    if (!alive) return
    const cached = cacheRef.current
    if (cached && cached.bootstrap) {
     setBoot({ status: 'ready', data: cached.bootstrap, fromCache: true, stale: true, error })
    } else {
     setBoot({ status: 'error', data: null, fromCache: false, stale: false, error })
    }
    },
   )
   return () => {
    alive = false
   }
  }, [reloadTick])

  React.useEffect(() => {
   if (!boot.data) return
   setSelectedPoemId((previous) => {
    if (previous) return previous
    const initial = normalizeSettings(boot.data.settings)
    if (initial.mode === 'random' && initial.lastPoemId) return initial.lastPoemId
    return boot.data.today && boot.data.today.poemId ? boot.data.today.poemId : null
   })
  }, [boot.data])
  React.useEffect(() => {
   if (!(settings.weatherPoem || settings.mood)) return undefined
   refreshWeather(false)
   const timer = setInterval(() => refreshWeather(true), WEATHER_REFRESH_MS)
   return () => clearInterval(timer)
  }, [settings.weatherPoem, settings.mood, settings.weatherCity, refreshWeather])

  React.useEffect(() => {
   if (!(settings.mood || settings.spontaneousPoem)) return undefined
   let alive = true
   const load = () => {
    requestMood().then((data) => {
    if (!alive) return
    moodStatsRef.current = data.stats
    setMoodRes({ status: data.ok ? 'ready' : 'error', data, at: Date.now() })
    })
   }
   load()
   const timer = setInterval(load, MOOD_REFRESH_MS)
   return () => {
    alive = false
    clearInterval(timer)
   }
  }, [settings.mood, settings.spontaneousPoem])

  React.useEffect(() => {
   if (!(settings.mood || settings.spontaneousPoem)) return undefined
   const timer = setInterval(() => setMoodTick((tick) => tick + 1), MOOD_TICK_MS)
   return () => clearInterval(timer)
  }, [settings.mood, settings.spontaneousPoem])
  const [poemsRes, reloadPoems] = useResource('poems', Boolean(boot.data))
  const classActive = step === 2 || step === 4 || (panelOpen && (panelTab === 'class' || panelTab === 'ci'))
  const yunActive = step === 3 || (panelOpen && panelTab === 'yun')
  const weatherNeedsCi = settings.weatherPoem && !resourceCache.ci
   && weatherRes.data && weatherRes.data.ok && weatherRes.data.weather
   && buildWeatherPoemPool(poemsRes.data, null, weatherPoemTags(weatherRes.data.weather), WEATHER_POOL_LIMIT).length < WEATHER_POOL_LIMIT
  const ciActive = step === 4 || step === 5 || weatherNeedsCi
   || (panelOpen && (panelTab === 'ci' || panelTab === 'feihua' || panelTab === 'library'))
  const [knowledgeRes, reloadKnowledge] = useResource('knowledge', classActive)
  const [yunRes, reloadYun] = useResource('yun', yunActive)
  const [ciRes, reloadCi] = useResource('ci', ciActive)
  const libraryActive = panelOpen && panelTab === 'library'
  const feihuaOpen = (panelOpen && panelTab === 'feihua') || step === 5
  const ciTabActive = panelOpen && panelTab === 'ci'
  const extraPoolActive = libraryActive || feihuaOpen
  const [anthologyRes, reloadAnthology] = useResource('anthology', extraPoolActive)
  const [bankRes, reloadBank] = useResource('bank', extraPoolActive)
  const [pingshuiRes, reloadPingshui] = useResource('pingshui', libraryActive)
  const [moodCatalogRes, reloadMoodCatalog] = useResource('moodCatalog', settings.mood)
  const [ciBankRes, reloadCiBank] = useResource('ciBank', ciBankWanted || feihuaOpen)

  const poemItems = poemsRes.data && Array.isArray(poemsRes.data.items) ? poemsRes.data.items : []
  const bootstrapTodayPoemId = boot.data && boot.data.today ? boot.data.today.poemId : null
  const cache = cacheRef.current
  const cachedPoem = cache && cache.todayPoem ? cache.todayPoem : null
  const weatherData = weatherRes.data && weatherRes.data.ok ? weatherRes.data : null
  const weather = weatherData && weatherData.weather ? weatherData.weather : null
  const weatherTags = React.useMemo(() => weatherPoemTags(weather), [weather])
  const weatherPool = React.useMemo(
   () => buildWeatherPoemPool(poemsRes.data, ciRes.data, weatherTags, WEATHER_POOL_LIMIT, { anthology: anthologyRes.data, bank: bankRes.data, ciBank: ciBankRes.data }),
   [poemsRes.data, ciRes.data, weatherTags, anthologyRes.data, bankRes.data, ciBankRes.data],
  )
  const weatherEntry = React.useMemo(() => {
   if (!settings.weatherPoem || !weather) return null
   return selectWeatherPoemEntry(weatherPool, {
    date: boot.data && boot.data.today ? boot.data.today.date : '',
    category: weather.category,
    dataVersion: boot.data ? boot.data.dataVersion : '',
   })
  }, [settings.weatherPoem, weather, weatherPool, boot.data])
  const weatherActive = Boolean(weatherEntry)
  const activeTodayPoemId = weatherActive ? weatherEntry.id : bootstrapTodayPoemId
  const weatherChip = weatherActive && weatherData ? weatherChipText(weatherData.city, weather) : ''
  const weatherNote = weatherActive ? weatherExplainText(weather) : ''
  weatherRef.current = weather
  const moodStats = moodRes.data ? moodRes.data.stats : emptyMoodStats()
  const moodCatalogBase = React.useMemo(() => normalizeMoodCatalog(moodCatalogRes.data), [moodCatalogRes.data])
  const moodCatalog = React.useMemo(() => mergePetMediaIntoCatalog(moodCatalogBase, petMediaRes.entries), [moodCatalogBase, petMediaRes.entries])
  moodCatalogRef.current = moodCatalog
  const moodChip = settings.mood && moodView ? '心情：' + moodView.label : ''
  const moodChipTitle = settings.mood && moodView ? String(moodView.reason || '') : ''
  const moodBasis = moodBasisText(moodStats, weather)
  uiRef.current = {
   settings: settingsRef.current,
   panelOpen,
   step,
   moodView,
   poemItems,
   ciItems: ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : [],
   anthologyItems: anthologyRes.data && Array.isArray(anthologyRes.data.items) ? anthologyRes.data.items : [],
   bankItems: bankRes.data && Array.isArray(bankRes.data.items) ? bankRes.data.items : [],
   ciBankItems: ciBankRes.data && Array.isArray(ciBankRes.data.items) ? ciBankRes.data.items : [],
   moodRes,
  }

  const poem = React.useMemo(() => {
   if (weatherActive && weatherEntry && (!selectedPoemId || selectedPoemId === weatherEntry.id)) return weatherEntry.item || null
   const weatherPick = weatherActive && selectedPoemId ? weatherPool.find((entry) => entry.id === selectedPoemId) : null
   if (weatherPick) return weatherPick.item || null
   const findById = (id) => poemItems.find((item) => item && item.id === id)
   if (!boot.data) return null
   if (poemItems.length) return findById(selectedPoemId) || findById(activeTodayPoemId) || poemItems[0] || null
   if (cachedPoem && (!selectedPoemId || cachedPoem.id === selectedPoemId || cachedPoem.id === activeTodayPoemId)) return cachedPoem
   return null
  }, [poemItems, selectedPoemId, activeTodayPoemId, cachedPoem, boot.data, weatherActive, weatherEntry, weatherPool])

  const todayPoem = React.useMemo(() => {
   if (weatherActive && weatherEntry && weatherEntry.id === activeTodayPoemId) return weatherEntry.item || null
   if (poem && poem.id === activeTodayPoemId) return poem
   if (cachedPoem && cachedPoem.id === activeTodayPoemId) return cachedPoem
   return poemItems.find((item) => item && item.id === activeTodayPoemId) || null
  }, [poem, cachedPoem, activeTodayPoemId, poemItems])
  React.useEffect(() => {
   if (!boot.data) return
   const record = {
    dataVersion: boot.data.dataVersion || '',
    bootstrap: boot.data,
    settings: settingsRef.current,
    todayPoem: todayPoem || null,
   }
   cacheRef.current = record
   writeFirstScreenCache(record)
  }, [boot.data, settings, todayPoem])
  React.useEffect(() => {
   userPickedPoemRef.current = false
  }, [weatherChip])

  React.useEffect(() => {
   if (!weatherActive || userPickedPoemRef.current) return
   setSelectedPoemId(activeTodayPoemId)
  }, [weatherActive, activeTodayPoemId])
  React.useEffect(() => {
   try {
    if (typeof window === 'undefined' || typeof window.Image !== 'function') return
    for (const file of [MASCOT_FILES.celebrate, MASCOT_FILES.idle, MASCOT_FILES.night]) {
    const image = new window.Image()
    image.src = mascotUrl(file)
    }
   } catch (error) {
   }
  }, [])
  React.useEffect(() => {
   if (!settingsRef.current.mood && !settingsRef.current.spontaneousPoem) {
    moodAiTokenRef.current += 1
    moodAiInFlightRef.current = false
    moodAiPendingRef.current = false
    if (moodAiDebounceTimerRef.current) {
     clearTimeout(moodAiDebounceTimerRef.current)
     moodAiDebounceTimerRef.current = null
    }
    moodSourceRef.current = ''
    moodViewRef.current = null
    clearMoodAiRetry()
    setMoodSource('')
    setMoodAiFallback(false)
    setMoodAiStale(false)
    setMoodAiFailure('')
    setMoodAiFailureCode('')
    setMoodView(null)
    return
   }
   if (moodSourceRef.current === 'model') return
   moodSourceRef.current = 'heuristic'
   setMoodSource('heuristic')
   const force = moodForceRef.current
   moodForceRef.current = false
   applyMood(force)
  }, [moodRes, weather, settings.mood, settings.spontaneousPoem, moodTick, applyMood])

  React.useEffect(() => () => {
   if (moodAiRetryTimerRef.current) {
    clearTimeout(moodAiRetryTimerRef.current)
    moodAiRetryTimerRef.current = null
   }
  }, [])

  // 心情动画素材（dsh-pet webm）：设置 mood 开启时懒加载，失败只用 92 张静态图
  React.useEffect(() => {
   if (!settings.mood) {
    setPetMediaRes({ status: 'idle', entries: [] })
    return undefined
   }
   let alive = true
   setPetMediaRes({ status: 'loading', entries: [] })
   requestPetMediaCatalog().then((result) => {
    if (!alive) return
    setPetMediaRes({ status: result && result.ok ? 'ready' : 'error', entries: result && result.ok ? result.entries : [] })
   })
   return () => {
    alive = false
   }
  }, [settings.mood, boot.data && boot.data.dataVersion])

  // 模型心情：初次加载（图鉴/动画图鉴都就绪或失败后）→ 2–4s 防抖后实时请求
  React.useEffect(() => {
   if (!settings.mood || !moodCatalog) return
   if (petMediaRes.status === 'loading' || petMediaRes.status === 'idle') return
   if (moodAiRef.current.at > 0) return
   scheduleMoodAiRefresh()
  }, [settings.mood, moodCatalog, petMediaRes.status])

  // 实时事件 1：mood stats 任意增量（消息/工具/报错/活跃分钟）
  React.useEffect(() => {
   if (!settings.mood) return
   const stats = moodStatsRef.current
   const next = { userMessages: stats.userMessages, toolCalls: stats.toolCalls, toolErrors: stats.toolErrors, activeMs: stats.activeMs }
   const prev = moodStatsSnapshotRef.current
   if (!prev) {
    moodStatsSnapshotRef.current = next
    return
   }
   const changed = next.userMessages > prev.userMessages
    || next.toolCalls > prev.toolCalls
    || next.toolErrors > prev.toolErrors
    || next.activeMs > prev.activeMs
   moodStatsSnapshotRef.current = next
   if (changed) scheduleMoodAiRefresh()
  }, [moodRes, moodTick, settings.mood])

  // 实时事件 2：面板打开/关闭/切 tab
  React.useEffect(() => {
   if (!settings.mood) return
   const changed = moodPrevPanelOpenRef.current !== panelOpen
    || (panelOpen && moodPrevPanelTabRef.current !== panelTab)
   moodPrevPanelOpenRef.current = panelOpen
   moodPrevPanelTabRef.current = panelTab
   if (changed) scheduleMoodAiRefresh()
  }, [panelOpen, panelTab, settings.mood])

  // 实时事件 3：self-talk 卡片出现/关闭
  React.useEffect(() => {
   if (!settings.mood) return
   const visible = Boolean(spontPoem)
   const previous = Boolean(moodPrevSpontRef.current)
   moodPrevSpontRef.current = visible
   if (visible !== previous) scheduleMoodAiRefresh()
  }, [spontPoem, settings.mood])

  // 实时事件 4：天气刷新/类别变化
  React.useEffect(() => {
   if (!settings.mood) return
   const signature = weather ? [weather.category, weather.label, weather.tempC, weather.isDay].join('|') : ''
   const previous = moodWeatherSigRef.current
   moodWeatherSigRef.current = signature
   if (previous && signature && previous !== signature) scheduleMoodAiRefresh()
  }, [weather, settings.mood])

  // 实时事件 5：页面回前台 / 窗口重新可见
  React.useEffect(() => {
   if (!settings.mood) return undefined
   const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    scheduleMoodAiRefresh()
   }
   const onFocus = () => scheduleMoodAiRefresh()
   if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
   if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus)
   return () => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus)
   }
  }, [settings.mood])

  // 实时事件 6：时段/饭点切换、idle 进入/恢复（用分钟 tick 检查，无定时请求）
  React.useEffect(() => {
   if (!settings.mood) return
   const now = Date.now()
   const last = lastInteractionRef.current
   const idle = last > 0 && now - last >= 30 * 60 * 1000
   if (idle !== moodIdleRef.current) {
    moodIdleRef.current = idle
    scheduleMoodAiRefresh()
   }
   const bucket = moodTimeBucket(now)
   if (moodTimeBucketRef.current && bucket !== moodTimeBucketRef.current) scheduleMoodAiRefresh()
   moodTimeBucketRef.current = bucket
  }, [moodTick, settings.mood])

  // 图鉴加载失败：直接使用启发式并提示本地表情
  React.useEffect(() => {
   if (settings.mood && moodCatalogRes.status === 'error') setMoodAiFallback(true)
  }, [settings.mood, moodCatalogRes.status])

  // 图鉴就绪后预加载 3 张探头图 + 少量心情图
  React.useEffect(() => {
   if (!moodCatalog) return
   if (typeof window === 'undefined' || typeof window.Image !== 'function') return
   const files = [
    panelPeekFile(moodCatalog, 'today'),
    panelPeekFile(moodCatalog, 'settings'),
    panelPeekFile(moodCatalog, 'other'),
   ].concat(moodCatalog.moodFiles.slice(0, 4))
   for (const file of files) {
    if (!file) continue
    try {
     const image = new window.Image()
     image.src = mascotUrl(file)
    } catch (error) {
    }
   }
  }, [moodCatalog])
  React.useEffect(() => {
   if (!settings.spontaneousPoem || settings.hidden) {
    spontReqRef.current += 1
    setSpontPoem(null)
    return undefined
   }
   let cancelled = false
   let timer = null
   const schedule = (delay) => {
    if (timer) clearTimeout(timer)
    if (!cancelled) timer = setTimeout(run, Math.max(1000, delay))
   }
   const run = () => {
    if (cancelled) return
    const ui = uiRef.current
    // 一卡制：有卡时等它关闭，3 秒后再检查
    if (spontPoemRef.current) {
     schedule(SPONT_CLOSE_RECHECK_MS)
     return
    }
    const ok = canShowSpontaneous({
     enabled: ui.settings.spontaneousPoem === true,
     hidden: ui.settings.hidden === true,
     panelOpen: ui.panelOpen === true,
     bubbleOpen: ui.step >= 0,
     visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
     now: Date.now(),
     lastInteractionAt: lastInteractionRef.current,
     quietMs: SPONT_QUIET_MS,
    })
    if (ok) {
     startSpontaneousCard({ record: true })
     schedule(nextSpontPollDelay())
    } else {
     schedule(SPONT_RETRY_MS)
    }
   }
   const onWake = () => wakeSpontaneous(nextSpontEventDelay())
   const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') onWake()
   }
   const onFocus = () => onWake()
   if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
   if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus)
   const initialDelay = spontWake > 0 ? num(spontWakeDelayRef.current, nextSpontEventDelay()) : nextSpontPollDelay()
   schedule(initialDelay)
   return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus)
   }
  }, [settings.spontaneousPoem, settings.hidden, spontWake, wakeSpontaneous])

  // 事件唤醒：关闭面板 / 气泡结束 / 卡片关闭 / 心情或天气更新
  React.useEffect(() => {
   if (panelOpen) {
    prevPanelOpenRef.current = true
    return
   }
   if (prevPanelOpenRef.current) {
    prevPanelOpenRef.current = false
    wakeSpontaneous(nextSpontEventDelay())
   }
  }, [panelOpen, wakeSpontaneous])

  React.useEffect(() => {
   if (step >= 0) {
    prevStepRef.current = true
    return
   }
   if (prevStepRef.current) {
    prevStepRef.current = false
    wakeSpontaneous(nextSpontEventDelay())
   }
  }, [step, wakeSpontaneous])

  React.useEffect(() => {
   if (!settings.spontaneousPoem) return
   if (spontPoem) {
    prevCardRef.current = true
    return
   }
   if (prevCardRef.current) {
    prevCardRef.current = false
    wakeSpontaneous(SPONT_CLOSE_RECHECK_MS)
   }
  }, [spontPoem, settings.spontaneousPoem, wakeSpontaneous])

  React.useEffect(() => {
   if (!settings.spontaneousPoem || !moodView) return
   const signature = [moodView.key, moodView.label, moodView.reason, moodView.source].join('|')
   if (moodWakeSigRef.current && moodWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay())
   moodWakeSigRef.current = signature
  }, [moodView, settings.spontaneousPoem, wakeSpontaneous])

  React.useEffect(() => {
   if (!settings.spontaneousPoem || !weather) return
   const signature = [weather.category, weather.label, weather.tempC].join('|')
   if (weatherWakeSigRef.current && weatherWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay())
   weatherWakeSigRef.current = signature
  }, [weather, settings.spontaneousPoem, wakeSpontaneous])

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   const markActivity = () => noteInteraction()
   document.addEventListener('pointerdown', markActivity, true)
   document.addEventListener('keydown', markActivity, true)
   document.addEventListener('input', markActivity, true)
   return () => {
    document.removeEventListener('pointerdown', markActivity, true)
    document.removeEventListener('keydown', markActivity, true)
    document.removeEventListener('input', markActivity, true)
   }
  }, [])

  React.useEffect(() => {
   if (!spontPoem) return undefined
   const timer = setTimeout(() => {
    spontReqRef.current += 1
    setSpontPoem(null)
   }, SPONT_AUTO_CLOSE_MS)
   return () => clearTimeout(timer)
  }, [spontPoem])
  React.useEffect(() => {
   if (spontPoem && !spontPreview && (panelOpen || step >= 0 || settings.hidden)) {
    spontReqRef.current += 1
    setSpontPoem(null)
   }
  }, [panelOpen, step, settings.hidden, spontPoem, spontPreview])
  React.useEffect(() => {
   if (!feihuaOpen) {
    setFeihuaBuilding(false)
    setFeihuaIndex(null)
    return undefined
   }
   const base = getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data)
   setFeihuaIndex(base)
   const ciBankItemsData = ciBankRes.data && Array.isArray(ciBankRes.data.items) ? ciBankRes.data.items : []
   if (!ciBankItemsData.length) {
    setFeihuaBuilding(ciBankRes.status === 'loading')
    return undefined
   }
   let cancelled = false
   let timer = null
   const working = buildFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data)
   let offset = 0
   const CHUNK = 500
   setFeihuaBuilding(true)
   const run = () => {
    if (cancelled) return
    mergeFeihuaItems(working, ciBankItemsData.slice(offset, offset + CHUNK))
    offset += CHUNK
    if (offset < ciBankItemsData.length) {
     timer = setTimeout(run, 0)
    } else {
     finishFeihuaIndex(working)
     setFeihuaIndex(working)
     setFeihuaBuilding(false)
    }
   }
   timer = setTimeout(run, 0)
   return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
   }
  }, [feihuaOpen, poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data, ciBankRes.data, ciBankRes.status])

  React.useEffect(() => {
   setPos((previous) => {
    const next = anchorPosition(settings.snap, mascotSize, viewport, previous)
    return next.x === previous.x && next.y === previous.y ? previous : next
   })
  }, [settings.snap, mascotSize, viewport.w, viewport.h])

  React.useEffect(() => {
   const timer = setTimeout(() => {
    writeStoredPosition({ x: pos.x, y: pos.y, snap: settingsRef.current.snap })
   }, 250)
   return () => clearTimeout(timer)
  }, [pos, settings.snap])
  React.useEffect(() => {
   const seconds = num(settings.autoplay, 0)
   if (!seconds || step < 0 || panelOpen || settings.hidden) return undefined
   const timer = setTimeout(() => {
    setStep((current) => (current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1))
   }, seconds * 1000)
   return () => clearTimeout(timer)
  }, [settings.autoplay, step, panelOpen, settings.hidden])
  React.useEffect(() => {
   if (!panelOpen && step < 0) return undefined
   const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    if (panelOpen) setPanelOpen(false)
    else setStep(-1)
   }
   document.addEventListener('keydown', onKeyDown)
   return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelOpen, step])
  React.useEffect(() => {
   if (!settings.hidden) return undefined
   const onDoubleClick = (event) => {
    const target = event.target
    if (target && typeof target.closest === 'function'
    && target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"],[data-composer-input],[data-composer-seat],[data-composer-card]')) {
    return
    }
    restoreWidget()
   }
   document.addEventListener('dblclick', onDoubleClick, true)
   return () => document.removeEventListener('dblclick', onDoubleClick, true)
  }, [settings.hidden])
  function hideWidget() {
   setPanelOpen(false)
   setStep(-1)
   updateSettings({ hidden: true })
  }

  function restoreWidget() {
   updateSettings({ hidden: false })
  }

  function noteInteraction() {
   lastInteractionRef.current = Date.now()
  }

  function openPanel(tab) {
   noteInteraction()
   panelOpensRef.current += 1
   setPanelTab(tab && PANEL_TABS.some((item) => item.id === tab) ? tab : 'today')
   setPanelOpen(true)
  }

  function advanceStep() {
   setStep((current) => (current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1))
   wakeSpontaneous(nextSpontEventDelay())
  }

  function handleMascotTap() {
   if (settingsRef.current.hidden) return
   const now = Date.now()
   clicksRef.current += 1
   noteInteraction()
   const eggState = readMascotEggState(now)
   if (shouldShowDailyGreet(eggState, now)) {
    writeMascotEggState(recordMascotEgg(eggState, { greet: true }, now))
    showMascotExpression(MASCOT_EXPRESSION_FILES[0])
   }
   if (!settingsRef.current.tutorialSeen) updateSettings({ tutorialSeen: true })
   if (panelOpen) {
    setPanelOpen(false)
    return
   }
   advanceStep()
  }

  function handleMascotKeyDown(event) {
   if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    handleMascotTap()
   }
  }

  function triggerDizzy() {
   if (settingsRef.current.hidden) return
   const entries = petMediaEntriesRef.current || []
   const entry = pickDizzyMedia(entries)
   const file = entry && isVideoMoodFile(entry.file) ? entry.file : ''
   if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current)
   setDizzy({ file, label: entry ? String(entry.label || '') : '' })
   clearMotionTimers()
   if (motionFileRef.current) setMotionFile('')
   dizzyTimerRef.current = setTimeout(() => {
    dizzyTimerRef.current = null
    setDizzy(null)
    if (settingsRef.current.mood && petMediaEntriesRef.current.length && !uiRef.current.panelOpen) {
     scheduleMotion(nextMotionDelay())
    }
   }, nextDizzyDuration())
   noteInteraction()
  }

  function maybeTriggerMeal() {
   if (!settingsRef.current || settingsRef.current.hidden) return
   if (mealActiveRef.current) return
   const now = Date.now()
   const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
   const state = readMealState(now)
   const moment = mealTriggerFor({ now, hidden: settingsRef.current.hidden, panelOpen: uiRef.current.panelOpen, visible, state })
   if (!moment) return
   writeMealState(markMealDone(state, moment.meal, now))
   const entry = pickMealMedia(petMediaEntriesRef.current || [], moment.meal)
   const file = entry && entry.file ? entry.file : 'dsh-whale-state-daily-eat.webp'
   const text = moment.meal === 'lunch'
    ? '到饭点啦，我去吃午饭，你也记得吃。这顿用 token 换的白饭。'
    : '到饭点啦，我去吃' + moment.label + '，你也记得吃。'
   const active = { meal: moment.meal, label: moment.label, file, text }
   mealActiveRef.current = active
   setMealActive(active)
   clearMotionTimers()
   if (motionFileRef.current) setMotionFile('')
   if (mealTimerRef.current) clearTimeout(mealTimerRef.current)
   mealTimerRef.current = setTimeout(() => {
    mealTimerRef.current = null
    mealActiveRef.current = null
    setMealActive(null)
    if (settingsRef.current.mood && petMediaEntriesRef.current.length && !uiRef.current.panelOpen) {
     scheduleMotion(nextMotionDelay())
    }
   }, nextMealDuration())
  }

  function handlePointerDown(event) {
   if (event.button !== undefined && event.button !== 0) return
   const pointerTime = typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now()
   dragRef.current = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: posRef.current.x,
    baseY: posRef.current.y,
    lastX: event.clientX,
    lastY: event.clientY,
    lastT: pointerTime,
    fast: false,
    moved: false,
   }
   try {
    event.currentTarget.setPointerCapture(event.pointerId)
   } catch (error) {
   }
   if (event.cancelable) event.preventDefault()
  }

  function handlePointerMove(event) {
   const drag = dragRef.current
   if (!drag || drag.id !== event.pointerId) return
   const dx = event.clientX - drag.startX
   const dy = event.clientY - drag.startY
   if (!drag.moved && Math.max(Math.abs(dx), Math.abs(dy)) > 3) drag.moved = true
   if (!drag.moved) return
   const pointerTime = typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now()
   if (detectFastDrag({ x: drag.lastX, y: drag.lastY, t: drag.lastT }, { x: event.clientX, y: event.clientY, t: pointerTime })) drag.fast = true
   drag.lastX = event.clientX
   drag.lastY = event.clientY
   drag.lastT = pointerTime
   setPos(clampPosition({ x: drag.baseX + dx, y: drag.baseY + dy }, mascotSize, viewport))
  }

  function finishPointer(event, cancelled) {
   const drag = dragRef.current
   if (!drag || (event && drag.id !== event.pointerId)) return
   dragRef.current = null
   try {
    if (event && event.currentTarget && event.currentTarget.releasePointerCapture) {
    event.currentTarget.releasePointerCapture(event.pointerId)
    }
   } catch (error) {
   }
   if (cancelled) return
   if (!drag.moved) {
    handleMascotTap()
    return
   }
   if (drag.fast) triggerDizzy()
   const current = posRef.current
   let snap = 'free'
   if (current.x <= 40) snap = 'left'
   else if (current.x + mascotSize >= viewport.w - 40) snap = 'right'
   const snapped = anchorPosition(snap, mascotSize, viewport, current)
   if (snapped.x !== current.x || snapped.y !== current.y) setPos(snapped)
   if (snap !== settingsRef.current.snap) updateSettings({ snap })
  }

  function handlePointerUp(event) {
   finishPointer(event, false)
  }

  function handlePointerCancel(event) {
   finishPointer(event, true)
  }

  function handleRestorePointerDown(event) {
   if (event.button !== undefined && event.button !== 0) return
   if (event.cancelable) event.preventDefault()
   if (pressTimer.current) clearTimeout(pressTimer.current)
   pressTimer.current = setTimeout(() => {
    pressTimer.current = null
    restoreWidget()
   }, 1200)
  }

  function handleRestorePointerUp() {
   if (pressTimer.current) {
    clearTimeout(pressTimer.current)
    pressTimer.current = null
   }
  }

  function changePoem() {
   noteInteraction()
   if (weatherActive && weatherPool.length) {
    const currentIndex = weatherPool.findIndex((entry) => entry.id === (poem && poem.id))
    const nextEntry = weatherPool[(currentIndex + 1 + weatherPool.length) % weatherPool.length]
    userPickedPoemRef.current = true
    setSelectedPoemId(nextEntry.id)
    return
   }
   const items = poemItems
   if (!items.length) {
    if (poemsRes.status === 'error') reloadPoems().catch(() => {})
    else showToast(poemsRes.status === 'loading' ? '诗库加载中，请稍候' : '诗库暂时不可用')
    return
   }
   const nextId = selectNextPoemId({
    items,
    currentId: poem && poem.id,
    todayId: activeTodayPoemId,
    mode: settingsRef.current.mode,
   })
   if (!nextId) {
    showToast('暂无可用的诗篇')
    return
   }
   userPickedPoemRef.current = true
   setSelectedPoemId(nextId)
   if (settingsRef.current.mode === 'random' && nextId !== activeTodayPoemId) {
    saverRef.current.save({ lastPoemId: nextId })
   }
  }

  function backToToday() {
   noteInteraction()
   if (!activeTodayPoemId) {
    showToast('今日诗尚未就绪')
    return
   }
   if (poem && poem.id === activeTodayPoemId) return
   userPickedPoemRef.current = true
   setSelectedPoemId(activeTodayPoemId)
   if (settingsRef.current.mode === 'random') saverRef.current.save({ lastPoemId: activeTodayPoemId })
  }

  function resetSettings() {
   updateSettings({
    scale: DEFAULT_SETTINGS.scale,
    showTones: DEFAULT_SETTINGS.showTones,
    mode: DEFAULT_SETTINGS.mode,
    autoplay: DEFAULT_SETTINGS.autoplay,
    snap: DEFAULT_SETTINGS.snap,
    script: DEFAULT_SETTINGS.script,
    hidden: DEFAULT_SETTINGS.hidden,
    theme: DEFAULT_SETTINGS.theme,
    lastPoemId: DEFAULT_SETTINGS.lastPoemId,
    tutorialSeen: DEFAULT_SETTINGS.tutorialSeen,
   })
   showToast('已恢复默认设置')
  }

  function retryBootstrap() {
   setReloadTick((tick) => tick + 1)
  }

  /** 气泡「来一局」：打开面板飞花 tab 并自增启动令牌（FeihuaTab 见令牌自动开局）。 */
  function openFeihuaGame() {
   setPanelTab('feihua')
   setPanelOpen(true)
   setFeihuaLaunch((token) => token + 1)
   pulseMascot('gameThink')
  }

  function takeCachedSelfTalk(kind) {
   const list = selfTalkCacheRef.current[kind]
   if (Array.isArray(list) && list.length) return list.shift()
   return ''
  }

  function rememberSpoken(card) {
   if (!card || card.type !== 'murmur' || !card.text) return
   const clean = String(card.text).trim()
   if (!clean) return
   const list = recentSpokenRef.current.filter((value) => value !== clean)
   list.push(clean)
   recentSpokenRef.current = list.slice(-SELF_TALK_RECENT_MAX)
  }

  function spontPools() {
   const ui = uiRef.current
   return {
    poemsData: { items: ui.poemItems },
    ciData: { items: ui.ciItems },
    anthologyData: { items: ui.anthologyItems },
    bankData: { items: ui.bankItems },
    ciBankData: { items: ui.ciBankItems },
   }
  }

  function fallbackSpontCard(moodKey, state) {
   const murmur = pickMurmur({
    moodKey,
    weather: weatherRef.current,
    stats: moodStatsRef.current,
    now: Date.now(),
    seenEntries: state ? state.seenIds : [],
    lastTag: state ? state.lastTag : '',
    recentTexts: recentSpokenRef.current,
    random: Math.random,
   })
   if (murmur) return Object.assign({}, murmur, { title: '它小声嘀咕：' })
   const pool = buildMurmurCandidates({
    moodKey,
    now: Date.now(),
    weather: weatherRef.current,
    stats: moodStatsRef.current,
   })
   if (!pool.length) return null
   return murmurCardFromText(pool[0].text)
  }
  function murmurCardFromText(text) {
   const value = String(text == null ? '' : text).trim()
   return {
    type: 'murmur',
    id: 'model-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    text: value,
    line: value,
    tags: [],
    tag: 'model',
    title: '它小声嘀咕：',
   }
  }

  function showSpontCard(card, options) {
   if (!card) return null
   const opts = options || {}
   if (opts.record === true && opts.state) {
    writeSpontState(recordSpontShown(opts.state, card.id, Date.now(), card.type, card.tag || card.kind || ''))
   }
   rememberSpoken(card)
   setSpontPreview(opts.preview === true)
   setSpontPoem(card)
   return card
  }

  /**
   * 触发一次自言自语：poem 走本地诗句；murmur/hybrid 先请求 host self-talk，
   * 生成中显示「它正在想…」占位，失败静默回退本地静态池。
   */
  function startSpontaneousCard(options) {
   const opts = options && typeof options === 'object' ? options : {}
   const ui = uiRef.current
   const now = Date.now()
   const state = readSpontState(now)
   const moodKey = ui.moodView && ui.moodView.key && ui.moodView.key !== 'ai' ? ui.moodView.key : 'calm'
   const preview = opts.preview === true
   const record = opts.record === true
   const recent = recentSpokenRef.current.slice(-SELF_TALK_RECENT_MAX)
   const showMurmur = (line) => showSpontCard(murmurCardFromText(line), { preview, record, state })
   const cached = takeCachedSelfTalk('murmur')
   if (cached) {
    setSelfTalkFallback(false)
    return showMurmur(cached)
   }
   const token = spontReqRef.current + 1
   spontReqRef.current = token
   setSpontPreview(preview)
   setSpontPoem({ type: 'thinking', title: '它正在想…', line: '', placeholder: true })
   const idleMinutes = lastInteractionRef.current > 0 ? Math.max(0, Math.floor((now - lastInteractionRef.current) / 60000)) : 0
   const weatherValue = weatherRef.current ? String(weatherRef.current.category || weatherRef.current.label || '') : ''
   const view = ui.moodView || null
   const moodLabel = view && typeof view.label === 'string' ? view.label.trim() : ''
   const moodReason = view && typeof view.reason === 'string' ? view.reason.trim() : ''
   const image = view && typeof view.image === 'string' ? view.image.trim() : ''
   const imageLabel = moodLabel
   const fallback = () => {
    setSelfTalkFallback(true)
    const card = fallbackSpontCard(moodKey, state)
    if (card) showSpontCard(card, { preview, record, state })
    else {
     setSpontPreview(preview)
     setSpontPoem(null)
    }
   }
   requestSelfTalk({ kind: 'murmur', moodKey, moodLabel, moodReason, image, imageLabel, weather: weatherValue, idleMinutes, recent }).then((result) => {
    if (token !== spontReqRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
     setSpontPoem((current) => (current && current.type === 'thinking' ? null : current))
     return
    }
    if (!result || !result.ok || !result.line) {
     fallback()
     return
    }
    if (recent.indexOf(result.line) >= 0) {
     if (result.next && recent.indexOf(result.next) < 0) {
      setSelfTalkFallback(false)
      showMurmur(result.next)
     } else {
      fallback()
     }
     return
    }
    if (result.next && recent.indexOf(result.next) < 0) {
     const list = selfTalkCacheRef.current.murmur.concat([result.next])
     selfTalkCacheRef.current.murmur = list.slice(-2)
    }
    setSelfTalkFallback(false)
    showMurmur(result.line)
   }).catch(() => {
    if (token !== spontReqRef.current) return
    fallback()
   })
   return null
  }

  function previewSpontaneousPoem() {
   return startSpontaneousCard({ preview: true, record: false })
  }

  function readAnotherSpontaneous() {
   return startSpontaneousCard({ preview: false, record: false })
  }
  function previewSpontaneousPoem(forceType) {
   return startSpontaneousCard({ forceType, preview: true, record: false })
  }

  function readAnotherSpontaneous() {
   const current = spontPoemRef.current
   const avoidType = current && current.type !== 'thinking' ? current.type : ''
   return startSpontaneousCard({ avoidType, preview: false, record: false })
  }
  function requestCiBank() {
   setCiBankWanted(true)
  }

  function consumeLibraryFocus() {
   setLibraryFocus(null)
  }

  function openCiSelectedForRhythmic(rhythmic) {
   setLibraryFocus({ type: 'ci-selected', rhythmic: String(rhythmic || ''), token: Date.now() })
   setPanelTab('library')
   setPanelOpen(true)
   noteInteraction()
  }

  function openCiBankForRhythmic(rhythmic) {
   setCiBankWanted(true)
   setLibraryFocus({ type: 'ci', rhythmic: String(rhythmic || ''), token: Date.now() })
   setPanelTab('library')
   setPanelOpen(true)
   noteInteraction()
  }

  function openSpontPoem() {
   const picked = spontPoemRef.current
   if (!picked) return
   if (picked.type === 'murmur') {
    setSpontPoem(null)
    return
   }
   setSpontPreview(false)
   setSpontPoem(null)
   setPanelOpen(true)
   if (picked.kind === 'poem') {
    userPickedPoemRef.current = true
    setSelectedPoemId(picked.id)
    setPanelTab('today')
   } else if (picked.kind === 'ci') {
    setPanelTab('ci')
   } else {
    setLibraryFocus({ id: picked.id, source: picked.kind, token: Date.now() })
    setPanelTab('library')
   }
  }

  /** FeihuaTab 消费启动令牌后归零，避免后续从 tab 栏进入时重复自动开局。 */
  function consumeFeihuaLaunch() {
   setFeihuaLaunch(0)
  }
  const dateSeed = (boot.data && boot.data.today && boot.data.today.date) || ''
  const dateLabel = formatDateLabel(dateSeed)

  function renderPoemFallback() {
   if (boot.status === 'error') {
    return h(EmptyState, {
    title: '诗词数据尚未就绪',
    message: describeDataError(boot.error),
    onRetry: retryBootstrap,
    })
   }
   if (poemsRes.status === 'error') {
    return h(EmptyState, {
    title: '今日一诗暂时不可用',
    message: describeDataError(poemsRes.error),
    onRetry: () => reloadPoems().catch(() => {}),
    })
   }
   return h(LoadingState, { text: '正在载入今日一诗…' })
  }

  function renderPoemStep() {
   if (poem) {
    return h(
    'div',
    null,
    weatherChip || moodChip
     ? h(
      'div',
      { className: 'dshp-weather' },
      h(
      'div',
      { className: 'dshp-chip-row' },
      weatherChip ? h('span', { className: 'dshp-weather-chip' }, weatherChip) : null,
      moodChip ? h('span', { className: 'dshp-weather-chip dshp-mood-chip', title: moodChipTitle }, moodChip) : null,
      ),
      weatherNote ? h('div', { className: 'dshp-weather-note' }, weatherNote) : null,
     )
     : null,
    h('div', { className: 'dshp-muted', style: { fontSize: '11.5px', textAlign: 'center', marginBottom: '2px' } }, '今日一诗 · ' + dateLabel),
    h(PoemBody, { poem, script: settings.script, showTones: settings.showTones }),
    )
   }
   return renderPoemFallback()
  }

  function renderAnalysisStep() {
   if (!poem) return renderPoemFallback()
   return h(
    'div',
    null,
    h('div', { className: 'dshp-muted', style: { fontSize: '11.5px', textAlign: 'center', marginBottom: '4px' } }, (poem.title || '这首诗') + ' · 格律解析'),
    h(AnalysisBody, { poem }),
   )
  }

  function renderKnowledgeStep() {
   const resource = knowledgeRes
   if (resource.status === 'error') {
    return h(EmptyState, {
    title: '格律知识卡暂时不可用',
    message: describeDataError(resource.error),
    onRetry: () => reloadKnowledge().catch(() => {}),
    })
   }
   const cards = resource.data && Array.isArray(resource.data.cards) ? resource.data.cards : []
   if (!cards.length) {
    if (resource.status === 'ready') {
    return h(EmptyState, {
     title: '知识卡尚未就绪',
     message: '数据文件中还没有课堂内容，稍后再来看看。',
     onRetry: () => reloadKnowledge().catch(() => {}),
    })
    }
    return h(LoadingState, { text: '正在载入格律知识卡…' })
   }
   const index = Math.abs(hashString(dateSeed + '|knowledge')) % cards.length
   return h(
    'div',
    null,
    h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '今日知识卡 · 第 ' + (index + 1) + ' / ' + cards.length + ' 张'),
    h(KnowledgeCardView, { card: cards[index] }),
   )
  }

  function renderYunStep() {
   const resource = yunRes
   if (resource.status === 'error') {
    return h(EmptyState, {
    title: '韵部数据暂时不可用',
    message: describeDataError(resource.error),
    onRetry: () => reloadYun().catch(() => {}),
    })
   }
   const volumes = resource.data && Array.isArray(resource.data.volumes) ? resource.data.volumes : []
   const chapters = []
   volumes.forEach((volume) => {
    const list = volume && Array.isArray(volume.chapters) ? volume.chapters : []
    list.forEach((chapter) => chapters.push({ volume: volume.title, chapter }))
   })
   if (!chapters.length) {
    if (resource.status === 'ready') {
    return h(EmptyState, {
     title: '韵部尚未就绪',
     message: '声律启蒙数据还不完整，稍后再试。',
     onRetry: () => reloadYun().catch(() => {}),
    })
    }
    return h(LoadingState, { text: '正在载入声律启蒙…' })
   }
   const index = Math.abs(hashString(dateSeed + '|yun')) % chapters.length
   const picked = chapters[index]
   const chapter = picked.chapter || {}
   return h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-summary' }, '声律启蒙 · ' + (picked.volume || '') + ' · 第 ' + (index + 1) + ' / ' + chapters.length + ' 韵部'),
    h('div', { className: 'dshp-card-title' }, String(chapter.name || '韵部')),
    chapter.exampleLine
    ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-text' }, String(chapter.exampleLine)))
    : (Array.isArray(chapter.paragraphs) && chapter.paragraphs.length
     ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-text' }, String(chapter.paragraphs[0])))
     : null),
    Array.isArray(chapter.exampleChars) && chapter.exampleChars.length
    ? h('div', { className: 'dshp-tags' }, chapter.exampleChars.map((ch, i) => h('span', { key: i, className: 'dshp-tag' }, String(ch))))
    : null,
    h('div', { className: 'dshp-muted', style: { fontSize: '11.5px' } }, '韵部例字仅作教学示例，不构成完整韵表。'),
   )
  }

  function renderCiStep() {
   const knowledge = knowledgeRes
   if (knowledge.status === 'error') {
    return h(EmptyState, {
    title: '词牌数据暂时不可用',
    message: describeDataError(knowledge.error),
    onRetry: () => reloadKnowledge().catch(() => {}),
    })
   }
   if (ciRes.status === 'error') {
    return h(EmptyState, {
    title: '名篇词暂时不可用',
    message: describeDataError(ciRes.error),
    onRetry: () => reloadCi().catch(() => {}),
    })
   }
   const ciCards = knowledge.data && Array.isArray(knowledge.data.ciCards) ? knowledge.data.ciCards : []
   if (!ciCards.length) {
    if (knowledge.status === 'ready') {
    return h(EmptyState, {
     title: '词牌卡尚未就绪',
     message: '数据文件中还没有词牌内容，稍后再试。',
     onRetry: () => reloadKnowledge().catch(() => {}),
    })
    }
    return h(LoadingState, { text: '正在载入词牌…' })
   }
   const index = Math.abs(hashString(dateSeed + '|ci')) % ciCards.length
   const card = ciCards[index] || {}
   const ciItems = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : []
   const matched = ciItems.filter((item) => item && item.rhythmic && item.rhythmic === card.name)
   const ci = matched.length
    ? matched[Math.abs(hashString(dateSeed + '|ciname')) % matched.length]
    : (ciItems.length ? ciItems[Math.abs(hashString(dateSeed + '|ciany')) % ciItems.length] : null)
   const meta = h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-summary' }, '词牌名篇 · 第 ' + (index + 1) + ' / ' + ciCards.length + ' 个词牌'),
    h(
    'div',
    { className: 'dshp-card-title' },
    String(card.name || '词牌'),
    Array.isArray(card.aliases) && card.aliases.length
     ? h('span', { className: 'dshp-muted', style: { fontSize: '11.5px', fontWeight: 400 } }, '（' + card.aliases.join('、') + '）')
     : null,
    ),
    card.form
    ? h('div', { className: 'dshp-p dshp-muted' }, String(card.form) + (card.rhyme ? ' · ' + String(card.rhyme) : ''))
    : null,
    card.example
    ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-note' }, '代表名句'), h('div', { className: 'dshp-example-text' }, String(card.example)))
    : null,
   )
   if (!ci) {
    return h(
    'div',
    null,
    meta,
    ciRes.status === 'ready'
     ? h('div', { className: 'dshp-empty-msg', style: { marginTop: '8px' } }, '名篇词暂时没有匹配到这一词牌。')
     : h(LoadingState, { text: '正在载入名篇词…' }),
    )
   }
   return h('div', null, meta, h('div', { className: 'dshp-subtitle' }, '名篇词'), h(CiBody, { ci }))
  }

  function renderStepContent() {
   if (step === 0) return renderPoemStep()
   if (step === 1) return renderAnalysisStep()
   if (step === 2) return renderKnowledgeStep()
   if (step === 3) return renderYunStep()
   if (step === 4) return renderCiStep()
   return renderFeihuaStep()
  }

  /** 气泡第 6 张卡：飞花令入口（今日令字 + 句数 + 历史最佳 + 来一局）。 */
  function renderFeihuaStep() {
   if (poemsRes.status === 'error' || ciRes.status === 'error') {
    const failed = poemsRes.status === 'error' ? poemsRes : ciRes
    const retry = poemsRes.status === 'error' ? reloadPoems : reloadCi
    return h(EmptyState, {
    title: '飞花令句库暂时不可用',
    message: describeDataError(failed.error),
    onRetry: () => retry().catch(() => {}),
    })
   }
   const index = feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data)
   if (!index || !ciRes.data) return h(LoadingState, { text: '正在载入飞花令句库…' })
   const char = pickDefaultFeihuaChar(index, poem)
   const count = (index.byChar[char] || []).length
   const best = readFeihuaBest()
   const charBest = best.chars[char] || 0
   return h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-summary' }, '飞花令 · 对句'),
    h(
    'div',
    { className: 'dshp-fh-meta' },
    h('span', null, '今日令字 ', h('b', null, '「' + char + '」')),
    h('span', null, '句库 ', h('b', null, String(count)), ' 句'),
    h('span', null, '历史最佳 ', h('b', null, String(best.overall)), ' 分'),
    ),
    h('div', { className: 'dshp-block' }, '系统先出含令字的诗句，你输入一句：有出处、含令字、本局不重复就算接上。'),
    feihuaBuilding || (ciBankRes.status === 'loading') ? h('div', { className: 'dshp-lib-note' }, '正在并入宋词全库…') : null,
    ciBankRes.status === 'error' ? h('div', { className: 'dshp-lib-note' }, '宋词全库加载失败，已回退原句库') : null,
    count
    ? h(
     'div',
     { className: 'dshp-fh-actions' },
     h('button', {
      type: 'button',
      className: 'dshp-btn dshp-btn-primary',
      onClick: (event) => {
      event.stopPropagation()
      openFeihuaGame()
      },
     }, '来一局'),
     h('span', { className: 'dshp-pager-label' }, '本字最佳 ' + charBest + ' 分'),
    )
    : h('div', { className: 'dshp-empty-msg', style: { marginTop: '8px' } }, '这一字暂时没有句子，换一个令字试试。'),
   )
  }

  function renderBubbleFooter() {
   if (step < 0) return null
   const buttons = []
   if (step === 0) {
    buttons.push(h('button', {
    key: 'next',
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: changePoem,
    title: settings.mode === 'random' ? '随机换一首' : '每日模式：回到今日，再点翻下一首',
    }, '换一首'))
    if (poem && activeTodayPoemId && poem.id !== activeTodayPoemId) {
    buttons.push(h('button', { key: 'today', type: 'button', className: 'dshp-link', onClick: backToToday }, '回到今日'))
    }
   } else {
    buttons.push(h('button', {
    key: 'next',
    type: 'button',
    className: 'dshp-btn dshp-btn-primary',
    onClick: advanceStep,
    }, step >= STEPS.length - 1 ? '收起' : '下一条'))
   }
   buttons.push(h('span', { key: 'spacer', className: 'dshp-spacer' }))
   buttons.push(h('button', {
    key: 'panel',
    type: 'button',
    className: 'dshp-btn',
    onClick: () => openPanel(['today', 'today', 'class', 'yun', 'ci', 'feihua'][step] || 'today'),
   }, '展开面板'))
   return h('div', { className: 'dshp-bubble-foot' }, buttons)
  }

  function renderBubble() {
   if (step < 0 || panelOpen || settings.hidden) return null
   const width = Math.min(304, viewport.w - 16)
   const placeAbove = pos.y > Math.min(300, viewport.h * 0.45)
   const available = placeAbove
    ? Math.max(140, pos.y - 20)
    : Math.max(140, viewport.h - pos.y - mascotSize - 20)
   const bodyMax = Math.max(120, Math.min(380, available - 96))
   let left = pos.x + mascotSize / 2 - width / 2
   left = clamp(left, 8, Math.max(8, viewport.w - width - 8))
   const style = { left: Math.round(left) + 'px', width: Math.round(width) + 'px' }
   if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + 'px'
   else style.top = Math.round(pos.y + mascotSize + 10) + 'px'
   return h(
    'div',
    { key: 'bubble', className: 'dshp-bubble', style, role: 'dialog', 'aria-label': STEPS[step] || '诗词气泡' },
    h(
    'div',
    { className: 'dshp-bubble-head' },
    h(
     'span',
     { className: 'dshp-bubble-title' },
     h('span', { className: 'dshp-bubble-step-name' }, STEPS[step] || '诗词'),
     h('span', { className: 'dshp-progress', 'aria-hidden': 'true' }, (step + 1) + ' / ' + STEPS.length),
     h(
      'span',
      { className: 'dshp-dots', role: 'group', 'aria-label': '切换到指定卡片' },
      STEPS.map((label, index) => h('button', {
      key: label,
      type: 'button',
      className: cx('dshp-dot', index === step && 'dshp-is-active'),
      title: label,
      'aria-label': '切换到第 ' + (index + 1) + ' 张：' + label,
      'aria-current': index === step ? 'step' : undefined,
      onClick: (event) => {
       event.stopPropagation()
       setStep(index)
      },
      })),
      h('button', {
      key: 'collapse',
      type: 'button',
      className: 'dshp-dot dshp-dot-collapse',
      title: '收起气泡',
      'aria-label': '收起气泡',
      onClick: (event) => {
       event.stopPropagation()
       setStep(-1)
      },
      }),
     ),
    ),
    h('button', {
     type: 'button',
     className: 'dshp-icon-btn',
     title: '收起气泡',
     'aria-label': '收起气泡',
     onClick: () => setStep(-1),
    }, '×'),
    ),
    h('div', { className: 'dshp-bubble-body', style: { maxHeight: Math.round(bodyMax) + 'px' } }, renderStepContent()),
    renderBubbleFooter(),
   )
  }

  function renderSpontPoem() {
   if (!spontPoem || settings.hidden || (panelOpen && !spontPreview) || (!spontPreview && step >= 0)) return null
   const width = Math.min(288, viewport.w - 16)
   let left = pos.x + mascotSize / 2 - width / 2
   left = clamp(left, 8, Math.max(8, viewport.w - width - 8))
   const placeAbove = pos.y > Math.min(280, viewport.h * 0.45)
   const style = { left: Math.round(left) + 'px', width: Math.round(width) + 'px' }
   if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + 'px'
   else style.top = Math.round(pos.y + mascotSize + 10) + 'px'
   if (spontPoem.type === 'thinking') {
    return h(
     'div',
     { key: 'spont', className: 'dshp-spont', style, role: 'status', 'aria-live': 'polite' },
     h('div', { className: 'dshp-spont-title' }, '它正在想…'),
     h('div', { className: 'dshp-spont-thinking' }, '稍等一下下…'),
     h(
      'div',
      { className: 'dshp-spont-actions' },
      h('button', {
       type: 'button',
       className: 'dshp-btn dshp-btn-small',
       onClick: (event) => {
        event.stopPropagation()
        spontReqRef.current += 1
        setSpontPreview(false)
        setSpontPoem(null)
       },
      }, '关闭'),
     ),
    )
   }
   const isPoemCard = spontPoem.type !== 'murmur'
   const sentenceProps = { className: 'dshp-spont-sentence' }
   if (isPoemCard) {
    sentenceProps.role = 'button'
    sentenceProps.tabIndex = 0
    sentenceProps.title = '在面板里查看整首'
    sentenceProps.onClick = (event) => {
     event.stopPropagation()
     openSpontPoem()
    }
    sentenceProps.onKeyDown = (event) => {
     if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      openSpontPoem()
     }
    }
   }
   return h(
    'div',
    { key: 'spont', className: 'dshp-spont', style, role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'dshp-spont-title' }, String(spontPoem.title || MURMUR_TITLES[0])),
    spontPoem.type === 'hybrid' && spontPoem.prefix
     ? h('div', { className: 'dshp-spont-prefix' }, String(spontPoem.prefix))
     : null,
    h('div', sentenceProps, String(spontPoem.line || '')),
    isPoemCard && spontPoem.label
     ? h('div', { className: 'dshp-spont-source' }, '—— ' + spontPoem.label)
     : null,
    h(
    'div',
    { className: 'dshp-spont-actions' },
    h('button', {
     type: 'button',
     className: 'dshp-btn dshp-btn-small',
     onClick: (event) => {
      event.stopPropagation()
      readAnotherSpontaneous()
     },
    }, '再说一句'),
    h('button', {
     type: 'button',
     className: 'dshp-btn dshp-btn-small',
     onClick: (event) => {
      event.stopPropagation()
      spontReqRef.current += 1
      setSpontPreview(false)
      setSpontPoem(null)
     },
    }, '关闭'),
    ),
   )
  }
  function renderToast() {
   if (!toast) return null
   const left = clamp(pos.x, 8, Math.max(8, viewport.w - 280))
   const top = clamp(pos.y - 44, 8, Math.max(8, viewport.h - 72))
   return h('div', {
    key: 'toast',
    className: cx('dshp-toast', toast.kind === 'error' && 'dshp-is-error'),
    role: 'status',
    'aria-live': 'polite',
    style: { left: Math.round(left) + 'px', top: Math.round(top) + 'px' },
   }, toast.text)
  }

  function clearMotionTimers() {
   if (motionDelayTimerRef.current) {
    clearTimeout(motionDelayTimerRef.current)
    motionDelayTimerRef.current = null
   }
   if (motionStopTimerRef.current) {
    clearTimeout(motionStopTimerRef.current)
    motionStopTimerRef.current = null
   }
  }

  function currentMoodImageFile() {
   const view = moodViewRef.current
   return view && view.image ? String(view.image) : ''
  }

  function scheduleMotion(delay) {
   if (motionDelayTimerRef.current) clearTimeout(motionDelayTimerRef.current)
   motionDelayTimerRef.current = setTimeout(() => {
    motionDelayTimerRef.current = null
    tryStartMotion()
   }, Math.max(1000, num(delay, nextMotionDelay())))
  }

  function scheduleInitialMotion() {
   const first = !motionFirstScheduledRef.current
   const delay = nextMotionScheduleDelay({ first, moodImage: currentMoodImageFile() })
   motionFirstScheduledRef.current = true
   motionFirstPendingRef.current = first && !isVideoMoodFile(currentMoodImageFile())
   scheduleMotion(delay)
  }

  function tryStartMotion() {
   const entries = petMediaEntriesRef.current
   const ui = uiRef.current
   if (!entries || !entries.length) return
   if (!ui.settings.mood || ui.settings.hidden) return
   if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
   if (ui.panelOpen) return
   if (dizzyRef.current || mealActiveRef.current) {
    scheduleMotion(nextMotionDelay())
    return
   }
   if (mascotPulseRef.current || mascotExpressionRef.current) {
    scheduleMotion(nextMotionDelay())
    return
   }
   if (motionFileRef.current) return
   const picked = nextMotionEntry(entries, motionIndexRef.current)
   if (!picked.entry) return
   motionIndexRef.current = picked.index
   motionFirstPendingRef.current = false
   writeMotionRotation(picked.index)
   setMotionFile(picked.entry.file)
   motionStopTimerRef.current = setTimeout(() => {
    motionStopTimerRef.current = null
    setMotionFile('')
    scheduleMotion(nextMotionDelay())
   }, nextMotionDuration())
  }

  function handleMascotMediaError(file) {
   if (dizzyRef.current && dizzyRef.current.file && file === dizzyRef.current.file) {
    setDizzy((current) => (current ? Object.assign({}, current, { file: '' }) : current))
    return
   }
   if (mealActiveRef.current && file === mealActiveRef.current.file) {
    setMealActive((current) => (current ? Object.assign({}, current, { file: 'dsh-whale-state-daily-eat.webp' }) : current))
    return
   }
   if (motionFileRef.current && file === motionFileRef.current) {
    if (motionStopTimerRef.current) {
     clearTimeout(motionStopTimerRef.current)
     motionStopTimerRef.current = null
    }
    setMotionFile('')
    scheduleMotion(nextMotionDelay())
    return
   }
   setFailedMascot(file)
  }

  React.useEffect(() => {
   if (!settings.mood || settings.hidden || panelOpen || petMediaRes.status !== 'ready' || !petMediaRes.entries.length) {
    clearMotionTimers()
    if (motionFileRef.current) setMotionFile('')
    return undefined
   }
   scheduleInitialMotion()
   return () => {
    clearMotionTimers()
   }
  }, [settings.mood, settings.hidden, panelOpen, petMediaRes.status, petMediaRes.entries.length])

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
     clearMotionTimers()
     if (motionFileRef.current) setMotionFile('')
     return
    }
    if (settingsRef.current.mood && !uiRef.current.panelOpen && petMediaEntriesRef.current.length) {
     scheduleMotion(nextMotionDelay())
    }
   }
   document.addEventListener('visibilitychange', onVisibility)
   return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  React.useEffect(() => {
   if (!motionFirstPendingRef.current) return
   const image = currentMoodImageFile()
   if (!isVideoMoodFile(image)) return
   motionFirstPendingRef.current = false
   clearMotionTimers()
   scheduleMotion(nextMotionDelay())
  }, [moodView])

  React.useEffect(() => {
   if (!settings.hidden) {
    maybeTriggerMeal()
   }
   const timer = setInterval(() => {
    maybeTriggerMeal()
   }, 60 * 1000)
   const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    maybeTriggerMeal()
   }
   const onFocus = () => maybeTriggerMeal()
   if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
   if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', onFocus)
   return () => {
    clearInterval(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', onFocus)
   }
  }, [settings.hidden])

  React.useEffect(() => {
   if (panelOpen) {
    mealPrevPanelRef.current = true
    return
   }
   if (mealPrevPanelRef.current) {
    mealPrevPanelRef.current = false
    maybeTriggerMeal()
   }
  }, [panelOpen])

  React.useEffect(() => {
   if (!(panelOpen || settings.hidden)) return
   if (dizzyTimerRef.current) {
    clearTimeout(dizzyTimerRef.current)
    dizzyTimerRef.current = null
   }
   if (dizzyRef.current) setDizzy(null)
   if (mealTimerRef.current) {
    clearTimeout(mealTimerRef.current)
    mealTimerRef.current = null
   }
   if (mealActiveRef.current) {
    setMealActive(null)
    mealActiveRef.current = null
   }
  }, [panelOpen, settings.hidden])

  React.useEffect(() => () => {
   if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current)
   if (mealTimerRef.current) clearTimeout(mealTimerRef.current)
  }, [])

  const syncMascotVideoPlayback = React.useCallback(() => {
   const video = mascotVideoRef.current
   if (!video) return
   const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
   const shouldPause = mascotVideoShouldPause({ hidden, panelOpen })
   try {
    if (shouldPause) {
     if (typeof video.pause === 'function') video.pause()
    } else if (typeof video.play === 'function') {
     const played = video.play()
     if (played && typeof played.catch === 'function') played.catch(() => {})
    }
   } catch (error) {
   }
  }, [panelOpen])

  React.useEffect(() => {
   syncMascotVideoPlayback()
  })

  React.useEffect(() => {
   if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
   document.addEventListener('visibilitychange', syncMascotVideoPlayback)
   return () => document.removeEventListener('visibilitychange', syncMascotVideoPlayback)
  }, [syncMascotVideoPlayback])

  React.useEffect(() => () => {
   const video = mascotVideoRef.current
   if (video && typeof video.pause === 'function') {
    try {
     video.pause()
    } catch (error) {
    }
   }
  }, [])

  function renderMascot() {
   const showHint = !settings.tutorialSeen && step < 0 && !panelOpen
   const weatherOn = settings.weatherPoem || settings.mood
   const imageInfo = mascotImageFor({
    weatherStateKey: mascotStateFor(weather, weatherOn),
    weatherEnabled: weatherOn,
    moodEnabled: settings.mood,
    mood: moodView,
   })
   const pulseFile = mascotPulse && MASCOT_FILES[mascotPulse] ? MASCOT_FILES[mascotPulse] : ''
   const expressionFile = mascotExpression && MASCOT_EXPRESSION_FILES.indexOf(mascotExpression) >= 0 ? mascotExpression : ''
   const panelFile = panelOpen ? panelPeekFile(moodCatalog, panelTab) : ''
   const dizzyFile = dizzy && dizzy.file ? dizzy.file : ''
   const mealFile = mealActive && mealActive.file ? mealActive.file : ''
   const motionVideoFile = motionFile && isVideoMoodFile(motionFile) ? motionFile : ''
   const stateKey = pulseFile ? mascotPulse : panelFile ? 'peek:' + panelTab : dizzyFile ? 'dizzy:' + dizzyFile : mealFile ? 'meal:' + mealFile : expressionFile ? 'egg:' + expressionFile : motionVideoFile ? 'motion:' + motionVideoFile : imageInfo.stateKey
   const desiredFile = mascotFilePriority({ pulseFile, panelFile, dizzyFile, mealFile, expressionFile, motionFile: motionVideoFile, moodFile: imageInfo.file })
   const mascotFile = failedMascot && failedMascot === desiredFile ? MASCOT_FILES.celebrate : desiredFile
   return h(
    'div',
    {
    key: 'mascot',
    className: cx('dshp-stage', dizzy && 'dshp-dizzy'),
    role: 'button',
    tabIndex: 0,
    'aria-label': '诗词格律挂件：点击查看今日一诗，可拖动',
    title: '点击：今日一诗 · 拖动：移动 · 右键：设置',
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onDoubleClick: (event) => {
     if (event && typeof event.preventDefault === 'function') event.preventDefault()
     noteInteraction()
     showMascotExpression(pickMascotExpression())
     setStep((current) => (current > 0 ? current - 2 : -1))
    },
    onKeyDown: handleMascotKeyDown,
    onContextMenu: (event) => {
     event.preventDefault()
     openPanel('settings')
    },
    },
    h(
    'div',
    { className: 'dshp-mascot', 'aria-hidden': 'true' },
    isVideoMoodFile(mascotFile)
    ? h('video', {
     key: stateKey + '|' + mascotFile,
     ref: mascotVideoRef,
     className: 'dshp-mascot-video dshp-mascot-swap',
     src: petMediaUrl(mascotFile),
     autoPlay: true,
     muted: true,
     loop: true,
     playsInline: true,
     preload: 'auto',
     'aria-hidden': 'true',
     onError: () => handleMascotMediaError(desiredFile),
    })
    : h('img', {
     key: stateKey,
     className: 'dshp-mascot-img dshp-mascot-swap',
     src: mascotUrl(mascotFile),
     alt: '',
     draggable: false,
     loading: 'lazy',
     decoding: 'async',
     onError: () => handleMascotMediaError(desiredFile),
    }),
    ),
    dizzy ? h('div', { className: 'dshp-dizzy-stars', 'aria-hidden': 'true' }, '💫') : null,
    dizzy ? h('div', { className: 'dshp-dizzy-tip' }, '别甩啦，头好晕…') : null,
    showHint ? h('div', { className: 'dshp-tip' }, '点我看今日一诗') : null,
   )
  }

  function renderMealTip() {
   if (!mealActive) return null
   const width = Math.min(288, viewport.w - 16)
   let left = pos.x + mascotSize / 2 - width / 2
   left = clamp(left, 8, Math.max(8, viewport.w - width - 8))
   const style = { left: Math.round(left) + 'px', width: Math.round(width) + 'px' }
   const placeAbove = pos.y > Math.min(280, viewport.h * 0.45)
   if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + 'px'
   else style.top = Math.round(pos.y + mascotSize + 10) + 'px'
   return h(
    'div',
    { key: 'meal', className: 'dshp-spont dshp-meal-tip', style, role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'dshp-spont-title' }, '到饭点啦'),
    h('div', { className: 'dshp-spont-sentence' }, String(mealActive.text || '')),
   )
  }

  function renderRestoreHotspot() {
   return h(
    'div',
    {
    key: 'restore',
    className: 'dshp-restore',
    role: 'button',
    tabIndex: 0,
    title: '双击空白处或长按这里恢复诗词挂件',
    'aria-label': '恢复诗词挂件',
    onPointerDown: handleRestorePointerDown,
    onPointerUp: handleRestorePointerUp,
    onPointerCancel: handleRestorePointerUp,
    onDoubleClick: (event) => {
     event.preventDefault()
     event.stopPropagation()
     restoreWidget()
    },
    onKeyDown: (event) => {
     if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      restoreWidget()
     }
    },
    },
    '诗',
   )
  }

  function renderPanelTab() {
   const api = {
    settings: settingsRef.current,
    updateSettings,
    showToast,
    hideWidget,
    resetSettings,
    poem,
    todayPoemId: activeTodayPoemId,
    poemItems,
    poemsRes,
    knowledgeRes,
    yunRes,
    ciRes,
    reloadPoems,
    reloadKnowledge,
    reloadYun,
    reloadCi,
    retryBootstrap,
    boot,
    dateLabel,
    dateSeed,
    changePoem,
    backToToday,
    feihuaLaunch,
    consumeFeihuaLaunch,
    openFeihuaGame,
    weatherRes,
    weatherData,
    weather,
    weatherActive,
    weatherChip,
    weatherNote,
    refreshWeather,
    pulseMascot,
    moodView,
    moodRes,
    moodStats,
    moodChip,
    moodChipTitle,
    moodBasis,
    moodSource,
    moodAiFallback,
    moodAiStale,
    moodAiFailure,
    moodAiFailureCode,
    petVideoCount: petMediaRes.entries.length,
    refreshMoodNow,
    previewSpontaneousPoem,
    anthologyRes,
    bankRes,
    pingshuiRes,
    reloadAnthology,
    reloadBank,
    reloadPingshui,
    libraryFocus,
   }
   if (panelTab === 'class') return h(ClassTab, { api })
   if (panelTab === 'yun') return h(YunTab, { api })
   if (panelTab === 'ci') return h(CiTab, { api })
   if (panelTab === 'library') return h(LibraryTab, { api })
   if (panelTab === 'feihua') return h(FeihuaTab, { api })
   if (panelTab === 'settings') return h(SettingsTab, { api })
   return h(TodayTab, { api })
  }

  function renderPanel() {
   if (!panelOpen || settings.hidden) return null
   const width = Math.min(420, viewport.w - 16)
   const height = Math.min(560, viewport.h - 16)
   let left = pos.x + mascotSize + 12
   if (left + width > viewport.w - 8) left = pos.x - width - 12
   if (left + width > viewport.w - 8) left = viewport.w - width - 8
   left = Math.max(8, left)
   let top = pos.y + mascotSize - height
   top = clamp(top, 8, Math.max(8, viewport.h - height - 8))
   return h(
    'div',
    {
    key: 'panel',
    className: 'dshp-panel',
    role: 'dialog',
    'aria-label': '诗词格律面板',
    style: { left: Math.round(left) + 'px', top: Math.round(top) + 'px' },
    },
    h(
    'div',
    { className: 'dshp-panel-head' },
    h(
     'div',
     { className: 'dshp-panel-title' },
     '诗词格律挂件',
     boot.data && boot.data.dataVersion ? h('small', null, '数据 ' + boot.data.dataVersion) : null,
    ),
    h('button', {
     type: 'button',
     className: 'dshp-icon-btn',
     title: '关闭面板（Esc）',
     'aria-label': '关闭面板',
     onClick: () => setPanelOpen(false),
    }, '×'),
    ),
    h(
    'div',
    { className: 'dshp-tabs', role: 'tablist' },
    PANEL_TABS.map((tab) => h('button', {
     key: tab.id,
     type: 'button',
     role: 'tab',
     'aria-selected': panelTab === tab.id,
     className: cx('dshp-tab', panelTab === tab.id && 'dshp-is-active'),
     onClick: () => setPanelTab(tab.id),
    }, tab.label)),
    ),
    h('div', { className: 'dshp-panel-body' }, renderPanelTab()),
   )
  }

  const rootSize = settings.hidden ? 28 : mascotSize
  const rootStyle = {
   position: 'fixed',
   left: Math.round(pos.x) + 'px',
   top: Math.round(pos.y) + 'px',
   width: rootSize + 'px',
   height: rootSize + 'px',
   zIndex: Z_INDEX,
   pointerEvents: 'auto',
   userSelect: 'none',
  }
  const nodes = [h('style', { key: 'dshp-style' }, CSS)]
  if (settings.hidden) {
   nodes.push(renderRestoreHotspot())
  } else {
   nodes.push(renderMascot())
   const bubbleNode = renderBubble()
   if (bubbleNode) nodes.push(bubbleNode)
   const panelNode = renderPanel()
   if (panelNode) nodes.push(panelNode)
   const toastNode = renderToast()
   if (toastNode) nodes.push(toastNode)
   const spontNode = renderSpontPoem()
   if (spontNode) nodes.push(spontNode)
   const mealNode = renderMealTip()
   if (mealNode) nodes.push(mealNode)
  }
  return h(
   'div',
   {
    'data-dsh-poetry-widget': 'root',
    'data-dshp-hidden': settings.hidden ? 'true' : 'false',
    className: 'dshp-root',
    style: rootStyle,
   },
   nodes,
  )
  }
  function KnowledgeCardView(props) {
  const card = props.card || {}
  const paragraphs = Array.isArray(card.paragraphs) ? card.paragraphs : []
  const examples = Array.isArray(card.examples) ? card.examples : []
  return h(
   'div',
   { className: 'dshp-card' },
   h('div', { className: 'dshp-card-title' }, String(card.title || '格律知识')),
   card.summary ? h('div', { className: 'dshp-card-summary' }, String(card.summary)) : null,
   paragraphs.map((paragraph, index) => h('p', { key: index, className: 'dshp-p' }, String(paragraph == null ? '' : paragraph))),
   examples.map((example, index) => h(
    'div',
    { key: 'example-' + index, className: 'dshp-example' },
    h('div', { className: 'dshp-example-text' }, String((example && example.text) || '')),
    example && example.note ? h('div', { className: 'dshp-example-note' }, String(example.note)) : null,
   )),
  )
  }

  function TodayTab(props) {
  const api = props.api || {}
  const poem = api.poem
  if (!poem) {
   if (api.boot && api.boot.status === 'error') {
    return h(EmptyState, {
    title: '诗词数据尚未就绪',
    message: describeDataError(api.boot.error),
    onRetry: api.retryBootstrap,
    })
   }
   if (api.poemsRes && api.poemsRes.status === 'error') {
    return h(EmptyState, {
    title: '今日一诗暂时不可用',
    message: describeDataError(api.poemsRes.error),
    onRetry: () => api.reloadPoems && api.reloadPoems().catch(() => {}),
    })
   }
   return h(LoadingState, { text: '正在载入今日一诗…' })
  }
  const items = Array.isArray(api.poemItems) ? api.poemItems : []
  const index = items.findIndex((item) => item && item.id === poem.id)
  const total = items.length
  return h(
   'div',
   null,
   api.weatherChip || api.moodChip
    ? h(
    'div',
    { className: 'dshp-weather', style: { marginTop: 0 } },
    h(
     'div',
     { className: 'dshp-chip-row' },
     api.weatherChip ? h('span', { className: 'dshp-weather-chip' }, String(api.weatherChip)) : null,
     api.moodChip ? h('span', { className: 'dshp-weather-chip dshp-mood-chip', title: api.moodChipTitle || '' }, String(api.moodChip)) : null,
    ),
    api.weatherNote ? h('div', { className: 'dshp-weather-note' }, String(api.weatherNote)) : null,
    )
    : null,
   h(
    'div',
    { className: 'dshp-pager', style: { marginTop: 0 } },
    h('span', { className: 'dshp-pager-label' }, (api.weatherActive ? '天气推荐' : (api.settings.mode === 'random' ? '随机' : '每日')) + ' · 第 ' + Math.max(1, index + 1) + (total ? ' / ' + total : '') + ' 首'),
    h(
    'span',
    { className: 'dshp-field-control' },
    h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: api.changePoem }, '换一首'),
    poem.id !== api.todayPoemId
     ? h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: api.backToToday }, '回到今日')
     : null,
    ),
   ),
   h(PoemBody, { poem, script: api.settings.script, showTones: api.settings.showTones }),
   h('div', { className: 'dshp-subtitle' }, '格律解析'),
   h(AnalysisBody, { poem }),
  )
  }

  function ClassTab(props) {
  const api = props.api || {}
  const [index, setIndex] = React.useState(0)
  const resource = api.knowledgeRes || {}
  if (resource.status === 'error') {
   return h(EmptyState, {
    title: '格律课堂暂时不可用',
    message: describeDataError(resource.error),
    onRetry: () => api.reloadKnowledge && api.reloadKnowledge().catch(() => {}),
   })
  }
  const cards = resource.data && Array.isArray(resource.data.cards) ? resource.data.cards : []
  if (!cards.length) {
   if (resource.status === 'ready') {
    return h(EmptyState, { title: '暂无知识卡', message: '课堂内容还在准备中，请稍后再来。' })
   }
   return h(LoadingState, { text: '正在载入格律课堂…' })
  }
  const safeIndex = Math.min(Math.max(0, index), cards.length - 1)
  const card = cards[safeIndex]
  return h(
   'div',
   null,
   h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '格律小课堂 · 共 ' + cards.length + ' 张卡'),
   h(KnowledgeCardView, { card }),
   h(
    'div',
    { className: 'dshp-pager' },
    h('button', {
    type: 'button',
    className: 'dshp-btn dshp-btn-small',
    disabled: safeIndex <= 0,
    onClick: () => setIndex(safeIndex - 1),
    }, '上一张'),
    h('span', { className: 'dshp-pager-label' }, '第 ' + (safeIndex + 1) + ' / ' + cards.length + ' 张'),
    h('button', {
    type: 'button',
    className: 'dshp-btn dshp-btn-small',
    disabled: safeIndex >= cards.length - 1,
    onClick: () => setIndex(safeIndex + 1),
    }, '下一张'),
   ),
   h(
    'div',
    { className: 'dshp-tags', style: { marginTop: '10px' } },
    cards.map((item, cardIndex) => h('button', {
    key: (item && item.id) || cardIndex,
    type: 'button',
    className: 'dshp-tag',
    style: {
     cursor: 'pointer',
     borderColor: cardIndex === safeIndex ? 'var(--dshp-accent)' : undefined,
     color: cardIndex === safeIndex ? 'var(--dshp-accent)' : undefined,
    },
    onClick: () => setIndex(cardIndex),
    }, (cardIndex + 1) + '. ' + String((item && item.title) || '卡片'))),
   ),
  )
  }

  function YunTab(props) {
  const api = props.api || {}
  const [expanded, setExpanded] = React.useState(null)
  const resource = api.yunRes || {}
  if (resource.status === 'error') {
   return h(EmptyState, {
    title: '韵部数据暂时不可用',
    message: describeDataError(resource.error),
    onRetry: () => api.reloadYun && api.reloadYun().catch(() => {}),
   })
  }
  const volumes = resource.data && Array.isArray(resource.data.volumes) ? resource.data.volumes : []
  if (!volumes.length) {
   if (resource.status === 'ready') {
    return h(EmptyState, { title: '暂无韵部数据', message: '声律启蒙数据还不完整，请稍后再来。' })
   }
   return h(LoadingState, { text: '正在载入声律启蒙…' })
  }
  return h(
   'div',
   null,
   h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '声律启蒙 · 平声三十韵部（上卷 15 / 下卷 15）'),
   volumes.map((volume, volumeIndex) => {
    const chapters = volume && Array.isArray(volume.chapters) ? volume.chapters : []
    return h(
    'div',
    { key: 'volume-' + volumeIndex },
    h('div', { className: 'dshp-subtitle' }, String(volume.title || '')),
    chapters.map((chapter, chapterIndex) => {
     const key = volumeIndex + '-' + chapterIndex
     const open = expanded === key
     const chars = Array.isArray(chapter.exampleChars) ? chapter.exampleChars : []
     return h(
      'div',
      { key },
      h(
      'button',
      {
       type: 'button',
       className: cx('dshp-row', open && 'dshp-is-open'),
       onClick: () => setExpanded(open ? null : key),
       'aria-expanded': open,
      },
      h(
       'span',
       { className: 'dshp-row-main' },
       h('span', { className: 'dshp-row-title' }, String(chapter.name || '')),
       chars.length ? h('span', { className: 'dshp-row-sub' }, ' 例字：' + chars.join('、')) : null,
      ),
      h('span', { className: 'dshp-muted', style: { flex: 'none' } }, open ? '▾' : '▸'),
      ),
      open
      ? h(
       'div',
       { className: 'dshp-row-body' },
       (Array.isArray(chapter.paragraphs) ? chapter.paragraphs : []).map((paragraph, index) => h('p', { key: index, className: 'dshp-p' }, String(paragraph == null ? '' : paragraph))),
       chapter.exampleLine
        ? h('div', { className: 'dshp-example', style: { marginTop: '6px' } }, h('div', { className: 'dshp-example-text' }, String(chapter.exampleLine)))
        : null,
      )
      : null,
     )
    }),
    )
   }),
  )
  }

  function CiTab(props) {
  const api = props.api || {}
  const [subTab, setSubTab] = React.useState('poems')
  const [query, setQuery] = React.useState('')
  const [rhythmic, setRhythmic] = React.useState('')
  const [visible, setVisible] = React.useState(40)
  const [openId, setOpenId] = React.useState(null)
  const knowledge = api.knowledgeRes || {}
  const ciRes = api.ciRes || {}
  const ciCards = knowledge.data && Array.isArray(knowledge.data.ciCards) ? knowledge.data.ciCards : []
  const items = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : []
  const ciBankCounts = React.useMemo(() => {
   const map = {}
   const bankItems = api.ciBankRes && api.ciBankRes.data && Array.isArray(api.ciBankRes.data.items) ? api.ciBankRes.data.items : []
   for (const item of bankItems) {
    if (item && item.rhythmic) map[item.rhythmic] = (map[item.rhythmic] || 0) + 1
   }
   return map
  }, [api.ciBankRes])
  const ciSelectedCounts = React.useMemo(() => {
   const map = {}
   for (const item of items) {
    if (item && item.rhythmic) map[item.rhythmic] = (map[item.rhythmic] || 0) + 1
   }
   return map
  }, [items])
  const rhythms = React.useMemo(() => {
   const seen = {}
   items.forEach((item) => {
    if (item && item.rhythmic) seen[item.rhythmic] = true
   })
   return Object.keys(seen).sort((a, b) => a.localeCompare(b, 'zh'))
  }, [items])
  const filtered = React.useMemo(() => {
   const keyword = query.trim()
   return items.filter((item) => {
    if (!item) return false
    if (rhythmic && item.rhythmic !== rhythmic) return false
    if (!keyword) return true
    const haystack = [item.title, item.author, item.rhythmic, item.quote]
    .concat(Array.isArray(item.lines) ? item.lines : [])
    .join(' ')
    return haystack.indexOf(keyword) >= 0
   })
  }, [items, query, rhythmic])
  React.useEffect(() => {
   setVisible(40)
  }, [query, rhythmic])

  if (knowledge.status === 'error') {
   return h(EmptyState, {
    title: '词牌数据暂时不可用',
    message: describeDataError(knowledge.error),
    onRetry: () => api.reloadKnowledge && api.reloadKnowledge().catch(() => {}),
   })
  }

  function renderCards() {
   if (!ciCards.length) {
    if (knowledge.status === 'ready') return h(EmptyState, { title: '暂无词牌卡', message: '词牌内容还在准备中，请稍后再来。' })
    return h(LoadingState, { text: '正在载入词牌卡…' })
   }
   return h(
    'div',
    { className: 'dshp-list' },
    ciCards.map((card, index) => h(
    'div',
    { key: (card && card.id) || index, className: 'dshp-card', style: { padding: '8px 2px', borderBottom: '1px solid var(--dshp-border)' } },
    h(
     'div',
     { className: 'dshp-card-title', style: { fontSize: '14px' } },
     String((card && card.name) || '词牌'),
     card && Array.isArray(card.aliases) && card.aliases.length
      ? h('span', { className: 'dshp-muted', style: { fontSize: '11.5px', fontWeight: 400 } }, '（' + card.aliases.join('、') + '）')
      : null,
    ),
    card && card.form ? h('div', { className: 'dshp-card-summary' }, String(card.form) + (card.rhyme ? ' · ' + String(card.rhyme) : '')) : null,
    card && card.note ? h('p', { className: 'dshp-p' }, String(card.note)) : null,
    card && card.example
     ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-text' }, String(card.example)))
     : null,
    card && card.name
     ? h('div', { className: 'dshp-fh-actions' },
      h('button', {
       type: 'button',
       className: 'dshp-link',
       onClick: () => { if (api.openCiSelectedForRhythmic) api.openCiSelectedForRhythmic(card.name) },
      }, '同词牌精选' + (ciSelectedCounts[card.name] ? '（' + ciSelectedCounts[card.name] + ' 首）' : '')),
      h('button', {
       type: 'button',
       className: 'dshp-link dshp-muted',
       onClick: () => { if (api.openCiBankForRhythmic) api.openCiBankForRhythmic(card.name) },
      }, '全库' + (ciBankCounts[card.name] ? '（' + ciBankCounts[card.name] + ' 首）' : '同词牌')))
     : null,
    )),
   )
  }

  function renderPoems() {
   if (ciRes.status === 'error') {
    return h(EmptyState, {
    title: '名篇词暂时不可用',
    message: describeDataError(ciRes.error),
    onRetry: () => api.reloadCi && api.reloadCi().catch(() => {}),
    })
   }
   if (!items.length) {
    if (ciRes.status === 'ready') return h(EmptyState, { title: '暂无词作', message: '名篇词数据正在准备中。' })
    return h(LoadingState, { text: '正在载入名篇词…' })
   }
   const shown = filtered.slice(0, visible)
   return h(
    'div',
    null,
    h(
    'div',
    { className: 'dshp-search' },
    h('input', {
     className: 'dshp-input',
     type: 'search',
     value: query,
     placeholder: '搜索词牌 / 作者 / 词句',
     'aria-label': '搜索名篇词',
     onChange: (event) => setQuery(event.target.value),
    }),
    h(
     'select',
     {
      className: 'dshp-select',
      value: rhythmic,
      'aria-label': '按词牌筛选',
      onChange: (event) => setRhythmic(event.target.value),
     },
     h('option', { value: '' }, '全部词牌'),
     rhythms.map((name) => h('option', { key: name, value: name }, name)),
    ),
    ),
    h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '共 ' + filtered.length + ' 首（总计 ' + items.length + ' 首）'),
    h(
    'div',
    { className: 'dshp-list' },
    shown.map((ci, index) => {
     const ciId = ci.id || 'ci-' + index
     const open = openId === ciId
     return h(
      'div',
      { key: ciId },
      h(
      'button',
      {
       type: 'button',
       className: cx('dshp-row', open && 'dshp-is-open'),
       onClick: () => setOpenId(open ? null : ciId),
       'aria-expanded': open,
      },
      h(
       'span',
       { className: 'dshp-row-main' },
       h('span', { className: 'dshp-row-title' }, String(ci.title || ci.rhythmic || '无题')),
       h('span', { className: 'dshp-row-sub' }, String(ci.author || '') + (ci.rhythmic ? ' · ' + String(ci.rhythmic) : '')),
      ),
      h('span', { className: 'dshp-muted', style: { flex: 'none' } }, open ? '▾' : '▸'),
      ),
      open
      ? h(
       'div',
       { className: 'dshp-row-body' },
       h('div', { className: 'dshp-ci-lines' }, (Array.isArray(ci.lines) ? ci.lines : []).map((line, lineIndex) => h('div', { key: lineIndex }, String(line)))),
       ci.quote ? h('div', { className: 'dshp-example' }, h('div', { className: 'dshp-example-text' }, String(ci.quote))) : null,
      ci.rhythmic
       ? h('div', { className: 'dshp-fh-actions' },
        h('button', {
         type: 'button',
         className: 'dshp-link',
         onClick: () => { if (api.openCiSelectedForRhythmic) api.openCiSelectedForRhythmic(ci.rhythmic) },
        }, '同词牌精选' + (ciSelectedCounts[ci.rhythmic] ? '（' + ciSelectedCounts[ci.rhythmic] + ' 首）' : '')),
        h('button', {
         type: 'button',
         className: 'dshp-link dshp-muted',
         onClick: () => { if (api.openCiBankForRhythmic) api.openCiBankForRhythmic(ci.rhythmic) },
        }, '全库' + (ciBankCounts[ci.rhythmic] ? '（' + ciBankCounts[ci.rhythmic] + ' 首）' : '同词牌')))
       : null,
      )
      : null,
     )
    }),
    ),
    filtered.length > visible
    ? h(
     'div',
     { style: { textAlign: 'center', marginTop: '10px' } },
     h('button', {
      type: 'button',
      className: 'dshp-btn',
      onClick: () => setVisible(visible + 60),
     }, '加载更多（剩余 ' + (filtered.length - visible) + ' 首）'),
    )
    : null,
   )
  }

  return h(
   'div',
   null,
   h(
    'div',
    { className: 'dshp-seg', style: { marginBottom: '10px' } },
    h('button', {
    type: 'button',
    className: cx('dshp-seg-btn', subTab === 'poems' && 'dshp-is-active'),
    onClick: () => setSubTab('poems'),
    }, '名篇词'),
    h('button', {
    type: 'button',
    className: cx('dshp-seg-btn', subTab === 'cards' && 'dshp-is-active'),
    onClick: () => setSubTab('cards'),
    }, '词牌卡'),
   ),
   subTab === 'cards' ? renderCards() : renderPoems(),
  )
  }

  function SettingsTab(props) {
  const api = props.api || {}
  const settings = (api.settings && typeof api.settings === 'object') ? api.settings : normalizeSettings()
  const [confirmReset, setConfirmReset] = React.useState(false)
  const [cityDraft, setCityDraft] = React.useState(settings.weatherCity || '北京')
  React.useEffect(() => {
   setCityDraft(settings.weatherCity || '北京')
  }, [settings.weatherCity])
  const update = api.updateSettings || (() => {})

  function commitCity() {
   const raw = String(cityDraft == null ? '' : cityDraft).trim()
   const nextCity = raw.length >= 1 && raw.length <= 20 ? raw : '北京'
   setCityDraft(nextCity)
   if (nextCity !== settings.weatherCity) update({ weatherCity: nextCity })
  }

  const weatherRes = api.weatherRes || {}
  const weatherInfo = api.weatherData && api.weatherData.weather ? api.weatherData.weather : null
  const weatherAt = weatherRes.at || (weatherInfo && weatherInfo.updatedAt) || 0
  const weatherStatusText = weatherInfo
   ? weatherChipText(api.weatherData.city, weatherInfo)
    + (weatherAt ? ' · 更新于 ' + weatherUpdatedLabel(weatherAt) : '')
   : (weatherRes.status === 'loading' ? '正在获取天气…' : '天气暂不可用（不影响其他功能）')
  const moodStats = api.moodStats || emptyMoodStats()
  const currentMood = api.moodView || null
  const moodAt = (api.moodRes && (api.moodRes.at || (api.moodRes.data && api.moodRes.data.updatedAt))) || 0
  const moodSourceLabel = api.moodSource === 'model' ? '模型' : api.moodSource === 'heuristic' ? '启发式' : ''
  const moodReasonText = currentMood ? String(currentMood.reason || '').replace(/[「」]/g, '').trim() : ''
  const moodQuotedReason = moodReasonText ? '「' + moodReasonText + '」' : ''
  const moodDetailText = currentMood ? '当前：' + currentMood.label + moodQuotedReason : ''
  const moodMetaText = [api.moodBasis || moodBasisText(moodStats, api.weather), moodSourceLabel ? '来源：' + moodSourceLabel : '', moodAt ? '更新于 ' + weatherUpdatedLabel(moodAt) : '']
   .filter(Boolean)
   .join(' · ')
  const moodStatusText = [moodDetailText, moodMetaText].filter(Boolean).join(' · ') || '心情数据加载中'
  const moodStatusFull = [moodDetailText, moodMetaText].filter(Boolean).join(' · ')
  const moodLine = (text, className, key) => h('div', { key, className: cx('dshp-card-summary', 'dshp-ellipsis', className), title: text }, text)

  function seg(options, current, onPick) {
   return h(
    'div',
    { className: 'dshp-seg' },
    options.map((option) => h('button', {
    key: String(option.value),
    type: 'button',
    className: cx('dshp-seg-btn', current === option.value && 'dshp-is-active'),
    onClick: () => onPick(option.value),
    }, option.label)),
   )
  }

  function switchNode(checked, onChange, label) {
   return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked === true,
    'aria-label': label,
    className: cx('dshp-switch', checked === true && 'dshp-is-on'),
    onClick: onChange,
   })
  }

  const boot = api.boot || {}
  const data = boot.data || {}
  const version = data.version || '0.1.0'
  const dataVersion = data.dataVersion || '—'
  const source = data.source || {}
  return h(
   'div',
   { className: 'dshp-settings' },
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '大小'), h('small', null, '形象缩放 60%–160%')),
    h(
    'div',
    { className: 'dshp-field-control' },
    h('input', {
     type: 'range',
     className: 'dshp-range',
     min: 60,
     max: 160,
     step: 5,
     value: Math.round(settings.scale * 100),
     'aria-label': '挂件大小',
     onChange: (event) => update({ scale: num(event.target.value, 100) / 100 }),
    }),
    h('span', { className: 'dshp-muted', style: { fontSize: '11.5px', width: '38px', textAlign: 'right' } }, Math.round(settings.scale * 100) + '%'),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '平仄标注'), h('small', null, '平蓝 / 仄红 / 多音灰')),
    switchNode(settings.showTones, () => update({ showTones: !settings.showTones }), '平仄标注开关'),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '点诗模式'), h('small', null, '「换一首」的策略')),
    seg([
    { value: 'daily', label: '每日' },
    { value: 'random', label: '随机' },
    ], settings.mode, (value) => update({ mode: value })),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '自动轮播'), h('small', null, '气泡自动推进间隔')),
    h(
    'select',
    {
     className: 'dshp-select',
     value: String(settings.autoplay),
     'aria-label': '自动轮播间隔',
     onChange: (event) => update({ autoplay: num(event.target.value, 0) }),
    },
    h('option', { value: '0' }, '关闭'),
    h('option', { value: '30' }, '30 秒'),
    h('option', { value: '60' }, '1 分钟'),
    h('option', { value: '300' }, '5 分钟'),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '吸附'), h('small', null, '拖动后贴边或自由摆放')),
    seg([
    { value: 'left', label: '贴左' },
    { value: 'right', label: '贴右' },
    { value: 'free', label: '自由' },
    ], settings.snap, (value) => update({ snap: value })),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '显示文字'), h('small', null, '简体或诗词原文')),
    seg([
    { value: 'simplified', label: '简体' },
    { value: 'original', label: '原文' },
    ], settings.script, (value) => update({ script: value })),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '天气城市'), h('small', null, '1–20 字，保存后自动重拉天气')),
    h(
    'div',
    { className: 'dshp-field-control' },
    h('input', {
     type: 'text',
     className: 'dshp-input',
     style: { width: '118px' },
     value: cityDraft,
     maxLength: 20,
     placeholder: '北京',
     'aria-label': '天气城市',
     onChange: (event) => setCityDraft(event.target.value),
     onBlur: commitCity,
     onKeyDown: (event) => {
      if (event.key === 'Enter') {
      event.preventDefault()
      commitCity()
      }
     },
    }),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '按天气选诗'), h('small', null, '今日诗与形象跟随天气')),
    switchNode(settings.weatherPoem, () => update({ weatherPoem: !settings.weatherPoem }), '按天气选诗开关'),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '天气'), h('small', null, weatherStatusText)),
    h(
    'div',
    { className: 'dshp-field-control' },
    h('button', {
     type: 'button',
     className: 'dshp-btn',
     onClick: () => {
      if (api.refreshWeather) api.refreshWeather(true)
     },
    }, '刷新天气'),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '心情换装'), h('small', null, '心情会随聊天、工具、天气、时段等实时变化（由当前模型生成）')),
    switchNode(settings.mood, () => update({ mood: !settings.mood }), '心情换装开关'),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '自言自语（偶尔说说话）'), h('small', null, '每隔 1–2 分钟可能说一句（事件后会更早）；不设每日次数')),
    switchNode(settings.spontaneousPoem, () => update({ spontaneousPoem: !settings.spontaneousPoem }), '自言自语开关'),
    api.selfTalkFallback ? h('div', { className: 'dshp-card-summary' }, '当前使用本地句子池') : null,
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' },
    h('b', null, '心情'),
    h('small', { className: 'dshp-ellipsis', title: moodStatusFull || moodStatusText }, moodStatusText),
    ),
    api.moodAiFallback ? moodLine('当前使用本地面部表情（模型心情不可用，回退启发式）', '', 'mood-fallback') : null,
    api.moodAiStale ? moodLine('模型心情暂时不可用（' + moodAiFailureLabel(api.moodAiFailure) + (api.moodAiFailureCode ? '，' + String(api.moodAiFailureCode).slice(0, 48) : '') + '），保留上一次，稍后重试', '', 'mood-stale') : null,
    api.moodAiFailure ? moodLine('上次模型心情失败：' + moodAiFailureLabel(api.moodAiFailure) + (api.moodAiFailureCode ? '（' + String(api.moodAiFailureCode).slice(0, 48) + '）' : ''), '', 'mood-failure') : null,
    api.petVideoCount ? moodLine('心情动画素材 ' + api.petVideoCount + ' 个；心情之间每 1–3 分钟会自己活动一下（播放动画）。', '', 'mood-video') : null,
    h(
    'div',
    { className: 'dshp-field-control' },
    h('button', {
     type: 'button',
     className: 'dshp-btn',
     onClick: () => {
      if (api.refreshMoodNow) api.refreshMoodNow()
     },
    }, '刷新心情'),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '想读的诗'), h('small', null, '预览一次彩蛋（不计入每日次数）')),
    h(
    'div',
    { className: 'dshp-field-control' },
    h('button', {
     type: 'button',
     className: 'dshp-btn',
     onClick: () => {
      if (api.previewSpontaneousPoem) api.previewSpontaneousPoem()
     },
    }, '预览一句'),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '隐藏挂件'), h('small', null, '双击空白处或长按角落小圆点恢复')),
    h(
    'div',
    { className: 'dshp-field-control' },
    h('button', {
     type: 'button',
     className: 'dshp-btn dshp-btn-danger',
     onClick: () => {
      setConfirmReset(false)
      if (api.hideWidget) api.hideWidget()
     },
    }, '隐藏'),
    ),
   ),
   h(
    'div',
    { className: 'dshp-field' },
    h('div', { className: 'dshp-field-label' }, h('b', null, '恢复默认'), h('small', null, '大小 / 平仄 / 模式 / 吸附 / 字体')),
    h(
    'div',
    { className: 'dshp-field-control' },
    confirmReset
     ? [
      h('button', {
      key: 'confirm',
      type: 'button',
      className: 'dshp-btn dshp-btn-primary',
      onClick: () => {
       setConfirmReset(false)
       if (api.resetSettings) api.resetSettings()
      },
      }, '确认恢复'),
      h('button', {
      key: 'cancel',
      type: 'button',
      className: 'dshp-btn',
      onClick: () => setConfirmReset(false),
      }, '取消'),
     ]
     : h('button', {
      type: 'button',
      className: 'dshp-btn',
      onClick: () => setConfirmReset(true),
     }, '恢复默认'),
    ),
   ),
   h('div', { className: 'dshp-subtitle' }, '关于'),
   h(
    'div',
    { className: 'dshp-about' },
    h('div', null, '诗词格律挂件 v' + String(version)),
    h('div', null, '数据版本：' + String(dataVersion)),
    h('div', null, '数据源：chinese-poetry（MIT）· 诗词为公版文本'),
    source.commit ? h('div', null, '源提交：' + String(source.commit).slice(0, 12)) : null,
    h('div', null, '设置保存在本机 $DSH_HOME/.dsh-poetry/settings.json；隐藏后双击页面空白处或长按角落小圆点恢复。'),
   ),
  )
  }
  function FeihuaTab(props) {
  const api = props.api || {}
  const poemsRes = api.poemsRes || {}
  const ciRes = api.ciRes || {}
  const index = api.feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, api.anthologyRes && api.anthologyRes.data, api.bankRes && api.bankRes.data)
  const feihuaBuilding = api.feihuaBuilding === true || Boolean(api.ciBankRes && api.ciBankRes.status === 'loading')
  const ciBankFailed = Boolean(api.ciBankRes && api.ciBankRes.status === 'error')
  const [char, setChar] = React.useState(null)
  const [mode, setMode] = React.useState('chain')
  const [game, setGame] = React.useState(null)
  const [inputText, setInputText] = React.useState('')
  const [atlasLimit, setAtlasLimit] = React.useState(FEIHUA_ATLAS_PAGE)
  const [best, setBest] = React.useState(() => readFeihuaBest())
  const bestRef = React.useRef(best)
  bestRef.current = best
  const launch = num(api.feihuaLaunch, 0)
  const launchRef = React.useRef(0)
  const activeChar = index
   ? (char || pickDefaultFeihuaChar(index, api.poem))
   : null
  React.useEffect(() => {
   if (!index || !activeChar) return
   if (launch > 0 && launch !== launchRef.current) {
    launchRef.current = launch
    setGame(feihuaStart(index, activeChar))
    setMode('chain')
    if (typeof api.consumeFeihuaLaunch === 'function') api.consumeFeihuaLaunch()
   }
  }, [launch, index, activeChar])

  const [fullInfo, setFullInfo] = React.useState({ char: '', status: 'idle', count: 0 })
  const fullTokenRef = React.useRef(0)
  React.useEffect(() => {
   if (!index || !activeChar) return undefined
   const target = activeChar
   const cached = readFeihuaFullCache(target)
   if (cached && cached.status === 'ready') {
    mergeFeihuaFullEntries(index, target, cached.entries)
    setFullInfo({ char: target, status: 'ready', count: cached.count })
    return undefined
   }
   if (cached && cached.status === 'error' && Date.now() - cached.at < FEIHUA_FULL_RETRY_MS) {
    setFullInfo({ char: target, status: 'error', count: 0 })
    return undefined
   }
   const token = fullTokenRef.current + 1
   fullTokenRef.current = token
   setFullInfo({ char: target, status: 'loading', count: 0 })
   requestFeihuaFull(target).then((result) => {
    if (token !== fullTokenRef.current) return
    if (result && result.ok && Array.isArray(result.entries)) {
     mergeFeihuaFullEntries(index, target, result.entries)
     setFullInfo({ char: target, status: 'ready', count: result.count || result.entries.length })
    } else {
     setFullInfo({ char: target, status: 'error', count: 0 })
    }
   })
   return () => {
    fullTokenRef.current += 1
    abortFeihuaFull(target)
   }
  }, [activeChar, index])

  if (poemsRes.status === 'error') {
   return h(EmptyState, {
    title: '飞花令句库暂时不可用',
    message: describeDataError(poemsRes.error),
    onRetry: () => api.reloadPoems && api.reloadPoems().catch(() => {}),
   })
  }
  if (ciRes.status === 'error') {
   return h(EmptyState, {
    title: '词库暂时不可用',
    message: describeDataError(ciRes.error),
    onRetry: () => api.reloadCi && api.reloadCi().catch(() => {}),
   })
  }
  if (!poemsRes.data || !ciRes.data) return h(LoadingState, { text: '正在载入飞花令句库…' })
  if (!index || !index.entries.length) {
   return h(EmptyState, { title: '飞花令句库为空', message: '诗/词数据里还没有可用的句子。', icon: '🪶' })
  }
  const candidateChips = index.candidates.slice()
  if (!candidateChips.some((item) => item.char === activeChar)) {
   candidateChips.unshift({ char: activeChar, count: index.counts[activeChar] || 0 })
  }
  const charEntries = index.byChar[activeChar] || []
  const bestForChar = best.chars[activeChar] || 0

  function startGame(target) {
   const use = target || activeChar
   if (!index || !use) return
   setChar(use)
   setInputText('')
   setGame(feihuaStart(index, use))
   setMode('chain')
   setAtlasLimit(FEIHUA_ATLAS_PAGE)
   // 来一局时若当前令字还没有全量数据，也兜底发起一次懒加载
   const cachedFull = readFeihuaFullCache(use)
   if (!cachedFull || cachedFull.status !== 'ready') {
    const token = fullTokenRef.current + 1
    fullTokenRef.current = token
    requestFeihuaFull(use).then((result) => {
     if (token !== fullTokenRef.current) return
     if (result && result.ok && Array.isArray(result.entries)) {
      mergeFeihuaFullEntries(index, use, result.entries)
      setFullInfo({ char: use, status: 'ready', count: result.count || result.entries.length })
     }
    }).catch(() => {})
   }
   if (typeof api.pulseMascot === 'function') api.pulseMascot('gameThink')
  }

  function chooseChar(next) {
   if (!next) return
   if (next === activeChar) {
    setGame(null)
    setInputText('')
    return
   }
   setChar(next)
   setInputText('')
   setGame(null)
   setAtlasLimit(FEIHUA_ATLAS_PAGE)
  }

  function randomChar() {
   if (!index || !index.candidates.length) return
   const pool = index.candidates.filter((item) => item.char !== activeChar)
   const picked = pool.length ? pool[feihuaRandomIndex(pool.length)] : index.candidates[0]
   chooseChar(picked.char)
  }

  function submitAnswer() {
   if (!game || game.phase !== 'playing') return
   const next = feihuaSubmit(game, index, inputText)
   if (!next || next === game) return
   setGame(next)
   if (next.feedback && next.feedback.kind === 'good') setInputText('')
   if (next.feedback && typeof api.pulseMascot === 'function') {
    api.pulseMascot(next.feedback.kind === 'good' ? 'gameWin' : 'gameLose')
   }
   const updated = feihuaBestUpdate(bestRef.current, next.char, next.score)
   if (updated.overall !== bestRef.current.overall
    || (updated.chars[next.char] || 0) !== (bestRef.current.chars[next.char] || 0)) {
    setBest(updated)
    writeFeihuaBest(updated)
   }
  }

  function handleInputKey(event) {
   if (event && event.key === 'Enter') {
    event.preventDefault()
    submitAnswer()
   }
  }

  function renderChain() {
   const playing = game && game.phase === 'playing'
   if (!game) {
    return h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-title' }, '飞花令 · 对句'),
    h('div', { className: 'dshp-card-summary' }, '令字「' + activeChar + '」· ' + charEntries.length + ' 句可查'),
    h('div', { className: 'dshp-block' }, '对方先出一句含令字的诗，你输入一句：有出处、含令字、本局不重复就算接上。不扣命，不计错。'),
    charEntries.length
     ? h(
      'div',
      { className: 'dshp-fh-actions' },
      h('button', {
      type: 'button',
      className: 'dshp-btn dshp-btn-primary',
      onClick: (event) => {
       event.stopPropagation()
       startGame(activeChar)
      },
      }, '来一局'),
      h('span', { className: 'dshp-pager-label' }, '本字最佳 ' + bestForChar + ' 局'),
     )
     : h('div', { className: 'dshp-empty-msg' }, '这一字暂时没有句子，换一个令字试试。'),
    )
   }
   return h(
    'div',
    { className: 'dshp-card' },
    h('div', { className: 'dshp-card-title' }, '飞花令 · 对句'),
    h('div', { className: 'dshp-card-summary' }, '令字「' + game.char + '」· 本局已接 ' + game.score + ' 句 · 本字最佳 ' + Math.max(bestForChar, game.score) + ' 局'),
    game.system
    ? h(
     'div',
     { className: 'dshp-fh-system' },
     '对方：' + game.system.text,
     game.system.source ? h('small', null, game.system.source) : null,
    )
    : null,
    h('div', { className: 'dshp-fh-prompt' }, game.message || '请接一句含「' + game.char + '」的诗句'),
    h(
     'div',
     { className: 'dshp-fh-actions' },
     h('input', {
      className: 'dshp-input',
      type: 'text',
      value: inputText,
      maxLength: 60,
      placeholder: '输入一句含「' + game.char + '」的诗/词，回车提交',
      'aria-label': '输入飞花令对句',
      onChange: (event) => setInputText(event.target.value),
      onKeyDown: handleInputKey,
      disabled: !playing,
     }),
     h('button', {
      type: 'button',
      className: 'dshp-btn dshp-btn-primary',
      onClick: (event) => {
       event.stopPropagation()
       submitAnswer()
      },
      disabled: !playing,
     }, '接一句'),
    ),
    h('div', {
    className: cx(
     'dshp-fh-feedback',
     game.feedback && game.feedback.kind === 'good' && 'dshp-is-good',
     game.feedback && game.feedback.kind === 'bad' && 'dshp-is-bad',
    ),
    role: 'status',
    'aria-live': 'polite',
    }, game.feedback ? game.feedback.text : ''),
    game.phase === 'cleared'
    ? h(
     'div',
     { className: 'dshp-fh-result' },
     h('b', null, '这一字接完了'),
     h('span', null, '本局接上 ' + game.score + ' 句 · 本字最佳 ' + Math.max(bestForChar, game.score) + ' 局 · 历史最佳 ' + Math.max(best.overall, game.score) + ' 局'),
     h('span', null, '这一字的句子都被接过了，换个令字继续。'),
    )
    : null,
    h(
     'div',
     { className: 'dshp-fh-actions' },
     h('button', {
      type: 'button',
      className: 'dshp-btn',
      onClick: (event) => {
       event.stopPropagation()
       randomChar()
      },
     }, '换个令字'),
     h('button', {
      type: 'button',
      className: 'dshp-btn',
      onClick: (event) => {
       event.stopPropagation()
       startGame(activeChar)
      },
     }, '重新开局'),
    ),
   )
  }
  function renderAtlas() {
   const total = charEntries.length
   const limit = Math.min(FEIHUA_ATLAS_LIMIT, atlasLimit)
   const shown = charEntries.slice(0, limit)
   return h(
    'div',
    null,
    h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } },
    '令字「' + activeChar + '」· 共 ' + total + ' 句（去重后最多展示 ' + FEIHUA_ATLAS_LIMIT + ' 条）'),
    shown.length
    ? h(
     'div',
     { className: 'dshp-fh-atlas' },
     shown.map((entry, entryIndex) => h(
      'div',
      { key: entryIndex, className: 'dshp-fh-line' },
      h('div', { className: 'dshp-fh-line-text' }, entry.text),
      h('div', { className: 'dshp-fh-line-source' }, '—— ' + entry.source),
     )),
    )
    : h(EmptyState, { title: '这一字暂时没有句子', message: '换一个令字试试。', icon: '🪶' }),
    total > shown.length
    ? h(
     'div',
     { style: { textAlign: 'center', marginTop: '10px' } },
     h('button', {
      type: 'button',
      className: 'dshp-btn',
      onClick: () => setAtlasLimit(Math.min(FEIHUA_ATLAS_LIMIT, atlasLimit + FEIHUA_ATLAS_PAGE)),
     }, '加载更多（剩余 ' + (total - shown.length) + ' 条）'),
    )
    : null,
   )
  }

  return h(
   'div',
   null,
   h(
    'div',
    { className: 'dshp-fh-chips' },
    candidateChips.map((item) => h('button', {
    key: item.char,
    type: 'button',
    className: cx('dshp-fh-chip', item.char === activeChar && 'dshp-is-active'),
    title: '令字「' + item.char + '」· ' + item.count + ' 句',
    'aria-pressed': item.char === activeChar,
    onClick: (event) => {
     event.stopPropagation()
     chooseChar(item.char)
    },
    }, item.char, h('small', null, String(item.count)))),
    h('button', {
    key: 'random',
    type: 'button',
    className: 'dshp-fh-chip',
    title: '随机换一个令字',
    onClick: (event) => {
     event.stopPropagation()
     randomChar()
    },
    }, '随机'),
   ),
   h(
    'div',
    { className: 'dshp-fh-meta' },
    h('span', null, fullInfo.char === activeChar
     ? (fullInfo.status === 'ready'
      ? '全量校验已启用（' + fullInfo.count + ' 句）'
      : fullInfo.status === 'loading' || fullInfo.status === 'idle' ? '正在加载全量校验句库…' : '全量校验未启用（使用本地句库）')
     : '正在加载全量校验句库…'),
   ),
   feihuaBuilding ? h('div', { className: 'dshp-card-summary' }, '正在并入宋词全库…') : null,
   ciBankFailed ? h('div', { className: 'dshp-card-summary' }, '宋词全库加载失败，已回退原句库') : null,
   h(
    'div',
    { className: 'dshp-fh-meta' },
    h('span', null, '令字 ', h('b', null, '「' + activeChar + '」')),
    h('span', null, '句库 ', h('b', null, String(charEntries.length)), ' 句'),
    h('span', null, '历史最佳 ', h('b', null, String(best.overall)), ' 分'),
    game ? h('span', null, '本局接上 ', h('b', null, String(game.score)), ' 句') : null,
   ),
   h(
    'div',
    { className: 'dshp-seg', style: { marginBottom: '10px' } },
    h('button', {
    type: 'button',
    className: cx('dshp-seg-btn', mode === 'chain' && 'dshp-is-active'),
    onClick: () => setMode('chain'),
    }, '对句'),
    h('button', {
    type: 'button',
    className: cx('dshp-seg-btn', mode === 'atlas' && 'dshp-is-active'),
    onClick: () => setMode('atlas'),
    }, '图鉴'),
   ),
   mode === 'atlas' ? renderAtlas() : renderChain(),
  )
  }
  /* ================================================================
   * 8.9 诗库（anthology + bank）与格律检测器（pingshui）
   * ================================================================ */

  function DetectionView(props) {
   const report = props.report
   const api = props.api || {}
   if (!report) return null
   const annotation = Array.isArray(report.annotation) ? report.annotation : []
   const rhymeIndexes = detectionRhymeIndexes(report)
   const lines = []
   for (let lineIndex = 0; lineIndex < annotation.length; lineIndex += 1) {
    const cells = annotation[lineIndex]
    const lineText = cells.map((cell) => cell.ch).join('')
    const toneText = cells.map((cell) => (cell.tone === '○' ? '○' : cell.tone === '？' ? '？' : cell.tone)).join('')
    lines.push(h(ToneLine, { key: lineIndex, line: lineText, tones: toneText, rhyme: Boolean(rhymeIndexes[lineIndex]), showTones: true }))
   }
   const multiTones = []
   for (const line of annotation) {
    for (const cell of line) {
     if (cell.candidates.length > 1) multiTones.push(cell)
    }
   }
   return h(
    'div',
    { className: 'dshp-detail' },
    h('div', { className: 'dshp-lib-report' }, report.summary || ''),
    (report.errors || []).length ? h('div', { className: 'dshp-lib-errors' }, report.errors.join('；')) : null,
    h('div', { className: 'dshp-lib-detect-lines' }, lines),
    report.rhymeLines && report.rhymeLines.length
     ? h('div', { className: 'dshp-lib-tags' }, report.rhymeLines.map((item) => h('span', { key: item.line, className: 'dshp-tag' },
      '第' + item.line + '句 ' + item.ch + (item.names.length ? '（' + item.names.join('/') + '）' : '') + (item.borrowed ? ' 借韵' : ''))))
     : null,
    report.violations && report.violations.length
     ? h('div', { className: 'dshp-lib-errors' }, report.violations.map((item) => '第' + item.line + '句第' + item.position + '字「' + item.ch + '」宜' + item.expected + '（实际' + item.actual + '）').join('；'))
     : null,
    report.sticky && report.sticky.length
     ? h('div', { className: 'dshp-lib-errors' }, report.sticky.map((item) => '第' + item.pair + '句失' + item.type).join('；'))
     : null,
    report.sanPing && report.sanPing.length ? h('div', { className: 'dshp-lib-errors' }, '三平调：第 ' + report.sanPing.join('、') + ' 句') : null,
    report.guPing && report.guPing.length ? h('div', { className: 'dshp-lib-errors' }, '孤平：第 ' + report.guPing.join('、') + ' 句') : null,
    multiTones.length
     ? h('div', { className: 'dshp-lib-multi' }, '多音字：' + multiTones.map((cell) => '「' + cell.ch + '」' + cell.candidates.map((item) => item.tone + '·' + item.name).join('/')).join('；'))
     : null,
    h(
     'div',
     { className: 'dshp-fh-actions' },
     h('button', {
      type: 'button',
      className: 'dshp-btn dshp-btn-small',
      onClick: () => {
       const text = formatDetectionReport(report)
       try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
         navigator.clipboard.writeText(text).catch(() => {})
        }
       } catch (error) {
        /* 剪贴板不可用时忽略，报告本身可选中复制 */
       }
       if (typeof api.showToast === 'function') api.showToast('检测结果已复制')
      },
     }, '复制结果'),
    ),
   )
  }

  function LibraryTab(props) {
   const api = props.api || {}
   const anthologyRes = api.anthologyRes || {}
   const bankRes = api.bankRes || {}
   const pingshuiRes = api.pingshuiRes || {}
   const ciBankRes = api.ciBankRes || {}
   const ciRes = api.ciRes || {}
   const [category, setCategory] = React.useState('all')
   const [ciRhythmic, setCiRhythmic] = React.useState('')
   const [searchScope, setSearchScope] = React.useState('category')
   const [ciSearchScope, setCiSearchScope] = React.useState('selected')
   const [query, setQuery] = React.useState('')
   const [debounced, setDebounced] = React.useState('')
   const [visible, setVisible] = React.useState(LIBRARY_PAGE)
   const [detail, setDetail] = React.useState(null)
   const [detector, setDetector] = React.useState('')
   const [inputText, setInputText] = React.useState('')
   const [inputReport, setInputReport] = React.useState(null)
   const ciMode = category === 'ci-selected' || category === 'ci-bank'

   React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(timer)
   }, [query])
   React.useEffect(() => {
    setVisible(LIBRARY_PAGE)
   }, [category, debounced, ciRhythmic, ciSearchScope])
   React.useEffect(() => {
    if (category === 'ci-bank' || (ciMode && ciSearchScope === 'allCi')) {
     if (typeof api.requestCiBank === 'function') api.requestCiBank()
    }
   }, [category, ciMode, ciSearchScope, api.requestCiBank])
   React.useEffect(() => {
    const focus = api.libraryFocus
    if (!focus || !focus.token) return
    if (focus.type === 'ci') {
     setCategory('ci-bank')
     setCiRhythmic(String(focus.rhythmic || ''))
     setDetector('')
     if (typeof api.requestCiBank === 'function') api.requestCiBank()
     if (typeof api.consumeLibraryFocus === 'function') api.consumeLibraryFocus()
     return
    }
    if (focus.type === 'ci-selected') {
     setCategory('ci-selected')
     setCiRhythmic(String(focus.rhythmic || ''))
     setDetector('')
     if (typeof api.consumeLibraryFocus === 'function') api.consumeLibraryFocus()
     return
    }
    const items = buildLibraryItems(anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data)
    const target = items.find((item) => item.id === focus.id)
    if (target) {
     setCategory(target.categoryId === 'ci-bank' ? 'ci-bank' : target.categoryId === 'ci-selected' ? 'ci-selected' : 'all')
     setDetail(target)
     setDetector('')
    }
    if (typeof api.consumeLibraryFocus === 'function') api.consumeLibraryFocus()
   }, [api.libraryFocus, anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data])

   const pingshui = React.useMemo(() => (pingshuiRes.data ? buildPingshuiIndex(pingshuiRes.data) : null), [pingshuiRes.data])
   const items = React.useMemo(
    () => buildLibraryItems(anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data),
    [anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data],
   )
   const ciSelectedRhythmicsList = React.useMemo(() => ciSelectedRhythmics(ciRes.data), [ciRes.data])
   const ciFullRhythmics = React.useMemo(() => ciBankRhythmics(ciBankRes.data), [ciBankRes.data])
   const ciRhythmics = category === 'ci-bank' ? ciFullRhythmics : ciSelectedRhythmicsList
   const ciSelectedCount = items.filter((entry) => entry.categoryId === 'ci-selected').length
   let filterCategory = category
   let filterRhythmic = ''
   if (ciMode) {
    filterRhythmic = ciRhythmic
    filterCategory = !debounced ? category : ciSearchScope === 'allCi' ? 'all' : 'ci-selected'
   } else if (searchScope === 'all') {
    filterCategory = 'all'
   }
   const filtered = React.useMemo(
    () => filterLibraryItems(items, filterCategory, debounced, filterRhythmic),
    [items, filterCategory, filterRhythmic, debounced],
   )
   const shown = libraryPage(filtered, visible)
   const poemReport = React.useMemo(
    () => (detail && detector === 'poem' && pingshui ? detectPoem(detail, pingshui) : null),
    [detail, detector, pingshui],
   )
   const pingshuiError = pingshuiRes.status === 'error'
   const loading = !anthologyRes.data && !bankRes.data
   const ciSelectedLoading = category === 'ci-selected' && !ciRes.data
   const ciBankLoading = category === 'ci-bank' && !ciBankRes.data

   function runInputDetection() {
    if (!pingshui) {
     if (typeof api.showToast === 'function') api.showToast('平水韵数据加载中，请稍候')
     if (typeof api.reloadPingshui === 'function') api.reloadPingshui().catch(() => {})
     return
    }
    setInputReport(detectPoemText(inputText, pingshui))
   }

   if (loading) {
    if (anthologyRes.status === 'error' && bankRes.status === 'error') {
     return h(EmptyState, {
      title: '诗库数据暂时不可用',
      message: (anthologyRes.error && anthologyRes.error.status === 404) || (bankRes.error && bankRes.error.status === 404)
       ? '诗库数据尚未生成（assets/data），请稍后重试。'
       : describeDataError(anthologyRes.error || bankRes.error),
      onRetry: () => {
       if (typeof api.reloadAnthology === 'function') api.reloadAnthology().catch(() => {})
       if (typeof api.reloadBank === 'function') api.reloadBank().catch(() => {})
      },
     })
    }
    return h(LoadingState, { text: '正在载入诗库…' })
   }

   function renderDetector() {
    if (!pingshui) {
     return pingshuiError
      ? h(EmptyState, { title: '平水韵数据不可用', message: '格律检测需要平水韵数据。', onRetry: () => api.reloadPingshui && api.reloadPingshui().catch(() => {}) })
      : h(LoadingState, { text: '正在载入平水韵…' })
    }
    const headers = h(
     'div',
     { className: 'dshp-fh-actions' },
     h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setDetector('') }, '返回'),
     h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setDetector('input') }, '自测输入'),
    )
    if (detector === 'poem' && detail) {
     return h(
      'div',
      { className: 'dshp-detail' },
      headers,
      h('div', { className: 'dshp-lib-detail-title' }, libraryItemLabel(detail)),
      h('div', { className: 'dshp-lib-note' }, detail.tones ? '基于数据内平仄标注检测' : '已用平水韵逐字标注（多音字取候选）'),
      h(DetectionView, { report: poemReport, api }),
     )
    }
    return h(
     'div',
     { className: 'dshp-detail' },
     headers,
     h('div', { className: 'dshp-lib-note' }, '输入 4 句或 8 句（每句 5 或 7 字，可含标点），逐字标注平仄与韵部。'),
     h('textarea', {
      className: 'dshp-textarea',
      rows: 6,
      value: inputText,
      placeholder: '例如：\n空山不见人，\n但闻人语响。\n返景入深林，\n复照青苔上。',
      onChange: (event) => setInputText(event.target.value),
     }),
     h(
      'div',
      { className: 'dshp-fh-actions' },
      h('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', onClick: runInputDetection }, '开始检测'),
      h('button', { type: 'button', className: 'dshp-btn', onClick: () => { setInputText(''); setInputReport(null) } }, '清空'),
     ),
     inputReport ? h(DetectionView, { report: inputReport, api }) : null,
    )
   }

   if (detector) {
    return h(
     'div',
     null,
     h('div', { className: 'dshp-fh-chips' },
      h('button', { type: 'button', className: 'dshp-fh-chip', onClick: () => setDetector('input') }, '自测输入'),
      detail ? h('button', { type: 'button', className: 'dshp-fh-chip dshp-is-active', onClick: () => setDetector('poem') }, '检测《' + detail.title + '》') : null),
     renderDetector(),
    )
   }

   if (detail) {
    const rhymeIndexes = detail.tones && Array.isArray(detail.rhymeIdx) ? detail.rhymeIdx : []
    const rhymeSet = {}
    for (const index of rhymeIndexes) rhymeSet[index] = true
    const rows = []
    const lines = Array.isArray(detail.lines) ? detail.lines : []
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
     rows.push(h(ToneLine, {
      key: lineIndex,
      line: lines[lineIndex],
      tones: detail.tones ? detail.tones[lineIndex] : '',
      rhyme: Boolean(rhymeSet[lineIndex]),
      showTones: Boolean(detail.tones),
     }))
    }
    return h(
     'div',
     { className: 'dshp-detail' },
     h('div', { className: 'dshp-fh-actions' },
      h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => { setDetail(null); setDetector('') } }, '← 返回列表'),
      h('button', { type: 'button', className: 'dshp-btn dshp-btn-small dshp-btn-primary', onClick: () => { setDetector('poem'); if (typeof api.reloadPingshui === 'function' && !pingshui) api.reloadPingshui().catch(() => {}) } }, '格律检测'),
     ),
     h('div', { className: 'dshp-lib-detail-title' }, libraryItemLabel(detail)),
     h('div', { className: 'dshp-lib-note' },
      ((LIBRARY_CATEGORIES.find((item) => item.id === detail.categoryId) || {}).label || detail.categoryId)
      + (detail.rhythmic ? ' · 词牌 ' + detail.rhythmic : '')),
     detail.tones ? h('div', { className: 'dshp-lib-lines' }, rows) : h('div', { className: 'dshp-lib-plain' }, lines.map((line, index) => h('div', { key: index }, line))),
     detail.tones
      ? h('div', { className: 'dshp-lib-tags' },
       detail.form ? h('span', { className: 'dshp-tag' }, '体式 ' + detail.form) : null,
       detail.start ? h('span', { className: 'dshp-tag' }, '起式 ' + detail.start) : null,
       detail.meter ? h('span', { className: 'dshp-tag' }, detail.meter) : null)
      : h('div', { className: 'dshp-lib-note' }, '未标注平仄（可点「格律检测」用平水韵逐字标注）'),
    )
   }

   const ciModeActive = category === 'ci-selected' || category === 'ci-bank'
   return h(
    'div',
    { className: 'dshp-library' },
    h(
     'div',
     { className: 'dshp-fh-chips' },
     h('button', { type: 'button', className: 'dshp-fh-chip' + (category === 'all' ? ' dshp-is-active' : ''), onClick: () => setCategory('all') }, '全部 ' + items.length),
     LIBRARY_CATEGORIES.map((item) => {
      const count = item.id === 'ci-selected'
       ? (ciRes.data ? ciSelectedCount : '…')
       : items.filter((entry) => entry.categoryId === item.id).length
      return h('button', {
       key: item.id,
       type: 'button',
       className: 'dshp-fh-chip' + (category === item.id ? ' dshp-is-active' : ''),
       onClick: () => setCategory(item.id),
      }, item.label + ' ' + count)
     }),
    ),
    ciModeActive
     ? h('div', { className: 'dshp-search', style: { marginTop: 0 } },
      h(
       'div',
       { className: 'dshp-seg' },
       h('button', {
        type: 'button',
        className: 'dshp-seg-btn' + (category === 'ci-selected' ? ' dshp-is-active' : ''),
        onClick: () => setCategory('ci-selected'),
       }, '宋词精选 ' + (ciRes.data ? ciSelectedCount : '…')),
       h('button', {
        type: 'button',
        className: 'dshp-seg-btn' + (category === 'ci-bank' ? ' dshp-is-active' : ''),
        onClick: () => {
         setCategory('ci-bank')
        },
       }, '全部宋词' + (ciBankRes.data ? '（' + num(ciBankRes.data.count, items.filter((entry) => entry.categoryId === 'ci-bank').length) + '）' : '（点击加载）')),
      ),
      h('select', {
       className: 'dshp-select',
       value: ciRhythmic,
       'aria-label': category === 'ci-bank' ? '按词牌筛选全部宋词' : '按词牌筛选宋词精选',
       onChange: (event) => setCiRhythmic(event.target.value),
      },
      h('option', { value: '' }, '全部词牌'),
      (ciRhythmic && !ciRhythmics.some((entry) => entry.name === ciRhythmic)
       ? [{ name: ciRhythmic, count: 0 }].concat(ciRhythmics)
       : ciRhythmics).slice(0, 300).map((entry) => h('option', { key: entry.name, value: entry.name }, entry.name + '（' + entry.count + '）'))),
      h('span', { className: 'dshp-pager-label' }, category === 'ci-bank'
       ? (ciBankRes.data ? '已载入 ' + num(ciBankRes.data.count, items.filter((entry) => entry.categoryId === 'ci-bank').length) + ' 首' : '载入中…')
       : (ciRes.data ? '已载入 ' + ciSelectedCount + ' 首' : '载入中…')),
     )
     : null,
    h('div', { className: 'dshp-search' },
     h('input', {
      className: 'dshp-input',
      type: 'search',
      value: query,
      placeholder: '搜索标题 / 作者 / 词牌 / 诗句',
      'aria-label': '搜索诗库',
      onChange: (event) => setQuery(event.target.value),
     }),
     h('button', { type: 'button', className: 'dshp-btn dshp-btn-small', onClick: () => setDetector('input') }, '格律自测'),
    ),
    debounced
     ? h(
      'div',
      { className: 'dshp-search', style: { marginBottom: '4px' } },
      h('span', { className: 'dshp-pager-label' }, '搜索范围'),
      ciModeActive
       ? h(
        'div',
        { className: 'dshp-seg' },
        h('button', {
         type: 'button',
         className: 'dshp-seg-btn' + (ciSearchScope === 'selected' ? ' dshp-is-active' : ''),
         onClick: () => setCiSearchScope('selected'),
        }, '精选'),
        h('button', {
         type: 'button',
         className: 'dshp-seg-btn' + (ciSearchScope === 'allCi' ? ' dshp-is-active' : ''),
         onClick: () => {
          setCiSearchScope('allCi')
         },
        }, '全部宋词'),
       )
       : h(
        'div',
        { className: 'dshp-seg' },
        h('button', {
         type: 'button',
         className: 'dshp-seg-btn' + (searchScope === 'category' ? ' dshp-is-active' : ''),
         onClick: () => setSearchScope('category'),
        }, '当前分类'),
        h('button', {
         type: 'button',
         className: 'dshp-seg-btn' + (searchScope === 'all' ? ' dshp-is-active' : ''),
         onClick: () => setSearchScope('all'),
        }, '全部'),
       ),
      ciModeActive && ciSearchScope === 'allCi' && !ciBankRes.data
       ? h('span', { className: 'dshp-pager-label' }, ciBankRes.status === 'loading' ? '宋词全库加载中，暂只搜精选…' : '宋词全库未加载，暂只搜精选')
       : null,
     )
     : null,
    ciSelectedLoading
     ? (ciRes.status === 'error'
      ? h(EmptyState, {
       title: '宋词精选暂时不可用',
       message: describeDataError(ciRes.error),
       onRetry: () => api.reloadCi && api.reloadCi().catch(() => {}),
      })
      : h(LoadingState, { text: '正在载入宋词精选 283 首…' }))
     : ciBankLoading
      ? (ciBankRes.status === 'error'
       ? h(EmptyState, {
        title: '全部宋词暂时不可用',
        message: ciBankRes.error && ciBankRes.error.status === 404 ? '宋词全库数据尚未生成（assets/data），请稍后重试。' : describeDataError(ciBankRes.error),
        onRetry: () => api.reloadCiBank && api.reloadCiBank().catch(() => {}),
       })
       : h(LoadingState, { text: '正在载入全部宋词（约 2 万首，首次稍慢）…' }))
      : h(
       'div',
       null,
       h('div', { className: 'dshp-card-summary', style: { marginBottom: '6px' } }, '共 ' + filtered.length + ' 首' + (debounced !== query ? '（搜索中…）' : '')),
       shown.length
        ? h('div', { className: 'dshp-list' }, shown.map((item) => h('button', {
         key: item.id,
         type: 'button',
         className: 'dshp-row',
         onClick: () => setDetail(item),
        }, h('span', { className: 'dshp-row-main' },
         h('span', { className: 'dshp-row-title' }, libraryItemLabel(item)),
         h('span', { className: 'dshp-row-sub' }, (item.rhythmic ? '词牌 ' + item.rhythmic + ' · ' : '') + ((Array.isArray(item.lines) ? item.lines[0] : '') || '')),
        ))))
        : h(EmptyState, { title: '没有匹配的诗词', message: '换一个分类或关键词试试。', icon: '📚' }),
      ),
    filtered.length > shown.length
     ? h('div', { style: { textAlign: 'center', marginTop: '10px' } },
      h('button', { type: 'button', className: 'dshp-btn', onClick: () => setVisible(visible + LIBRARY_PAGE) }, '加载更多（剩余 ' + (filtered.length - shown.length) + ' 首）'))
     : null,
   )
  }

  class WidgetBoundary extends React.Component {
  constructor(props) {
   super(props)
   this.state = { failed: false }
   this.handleRetry = this.handleRetry.bind(this)
  }

  static getDerivedStateFromError() {
   return { failed: true }
  }

  componentDidCatch(error) {
   try {
    console.warn('[dsh-poetry-widget] 渲染异常，已降级为最小形象：', error)
   } catch (ignored) {
   }
  }

  handleRetry() {
   this.setState({ failed: false })
  }

  render() {
   if (!this.state.failed) return this.props.children
   return h(
    'div',
    {
    'data-dsh-poetry-widget': 'root',
    className: 'dshp-root',
    style: {
     position: 'fixed',
     left: '16px',
     bottom: '24px',
     zIndex: Z_INDEX,
     pointerEvents: 'auto',
     display: 'flex',
     flexDirection: 'column',
     alignItems: 'center',
     gap: '6px',
     padding: '8px',
    },
    },
    h('style', null, CSS),
    h('img', {
    src: mascotUrl(MASCOT_FILES.celebrate),
    alt: '诗词格律挂件',
    width: 64,
    height: 64,
    draggable: false,
    style: { display: 'block' },
    }),
    h('button', {
    type: 'button',
    className: 'dshp-btn',
    onClick: this.handleRetry,
    }, '挂件显示异常，点此重试'),
   )
  }
  }

  function apply(ctx) {
  const host = (props) => h(WidgetBoundary, null, h(PoetryWidget, Object.assign({}, props || {}, { ctx })))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
   { name: 'shell.overlay', id: WIDGET_ID, order: 80 },
   host,
  ))
  try {
   if (ctx.logger && typeof ctx.logger.info === 'function') {
    ctx.logger.info('dsh-poetry-widget: 已注册 shell.overlay 挂件')
   }
  } catch (error) {
  }
  }

  return {
  inject: ['slots'],
  apply,
  }
 },
})

