"use strict";
(() => {
  // client-src/base.js
  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(value, min, max) {
    const n = num(value, min);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  function isVideoMoodFile(file) {
    return /\.webm$/i.test(String(file == null ? "" : file));
  }

  // client-src/mood-engine.js
  var SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1e3;
  var MOOD_SWITCH_MIN_MS = 20 * 60 * 1e3;
  var MOOD_REFRESH_MS = 5 * 60 * 1e3;
  var MOOD_TICK_MS = 60 * 1e3;
  var MOOD_AI_PATH = "mood-ai.json";
  var MOOD_AI_TIMEOUT_MS = 35e3;
  var MOOD_AI_DEBOUNCE_MIN_MS = 2e3;
  var MOOD_AI_DEBOUNCE_MAX_MS = 4e3;
  var MOOD_AI_MIN_GAP_MS = 2e4;
  var MOOD_AI_RETRY_MIN_MS = 12e3;
  var MOOD_AI_RETRY_MAX_MS = 25e3;
  var MOOD_AI_KEEP_MS = 30 * 60 * 1e3;
  var MOOD_AI_MAX_RETRIES = 5;
  var MOOD_AI_RECENT_MAX = 3;
  var MOOD_AI_RECENT_IMAGES_MAX = 20;
  var MOOD_PANEL_PEEK_FILES = Object.freeze({
    today: "dsh-whale-home-peek.webp",
    settings: "dsh-whale-settings-peek.webp",
    other: "dsh-whale-workbench-peek.webp"
  });
  var MOOD_STRONG = Object.freeze(["tired", "sleepy", "proud"]);
  var MOOD_LABELS = Object.freeze({
    happy: "\u5F00\u5FC3",
    proud: "\u5F97\u610F",
    tired: "\u6709\u70B9\u7D2F",
    sleepy: "\u56F0\u4E86",
    hungry: "\u6709\u70B9\u997F",
    lonely: "\u6709\u70B9\u5B64\u5355",
    curious: "\u597D\u5947",
    cozy: "\u60EC\u610F",
    calm: "\u5E73\u9759"
  });
  var MOOD_IMAGES = Object.freeze({
    happy: ["dsh-whale-state-game-happy.webp", "dsh-whale-state-celebrate.webp"],
    proud: ["dsh-whale-state-achievement.webp", "dsh-whale-state-levelup.webp"],
    tired: ["dsh-whale-state-work-sleep.webp", "dsh-whale-state-daily-melt.webp"],
    sleepy: ["dsh-whale-state-sleep.webp", "dsh-whale-state-night.webp"],
    hungry: ["dsh-whale-state-daily-eat.webp", "dsh-whale-state-daily-cooking.webp"],
    lonely: ["dsh-whale-state-waiting.webp", "dsh-whale-state-idle-cute.webp"],
    curious: ["dsh-whale-state-curious.webp", "dsh-whale-state-thinking.webp"],
    cozy: ["dsh-whale-state-daily-coffee.webp", "dsh-whale-state-weather-rain-happy.webp", "dsh-whale-state-weather-snow.webp"],
    calm: ["dsh-whale-state-idle-cute.webp"]
  });
  function shanghaiParts(now2) {
    const date = new Date(num(now2, Date.now()) + SHANGHAI_OFFSET_MS);
    const hour = date.getUTCHours();
    return {
      hour,
      minutes: hour * 60 + date.getUTCMinutes(),
      dateKey: date.toISOString().slice(0, 10)
    };
  }
  function emptyMoodStats() {
    return {
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolErrors: 0,
      turns: 0,
      turnsCompleted: 0,
      turnsErrored: 0,
      activeMs: 0,
      sessions: 0,
      firstActivityAt: 0,
      lastActivityAt: 0
    };
  }
  function normalizeMoodStats(raw) {
    const stats = emptyMoodStats();
    const src = raw && typeof raw === "object" ? raw : {};
    for (const key of ["userMessages", "assistantMessages", "toolCalls", "toolErrors", "turns", "turnsCompleted", "turnsErrored", "activeMs", "sessions", "firstActivityAt", "lastActivityAt"]) {
      stats[key] = Math.max(0, Math.floor(num(src[key], 0)));
    }
    return stats;
  }
  function computeMood(input) {
    const opts = input && typeof input === "object" ? input : {};
    const weather = opts.weather && typeof opts.weather === "object" ? opts.weather : null;
    const signals = opts.signals && typeof opts.signals === "object" ? opts.signals : {};
    const now2 = num(signals.now, Date.now());
    const local2 = shanghaiParts(now2);
    const clicks = Math.max(0, Math.floor(num(signals.clicks, 0)));
    const wins = Math.max(0, Math.floor(num(signals.feihuaWins, 0)));
    const minutes = local2.minutes;
    const meal = minutes >= 7 * 60 && minutes < 9 * 60 || minutes >= 11 * 60 + 30 && minutes < 13 * 60 || minutes >= 17 * 60 + 30 && minutes < 19 * 60 + 30;
    const night = local2.hour >= 23 || local2.hour < 6;
    const category = weather && typeof weather.category === "string" ? weather.category : "";
    const rainy = category === "rain" || category === "snow" || category === "thunder";
    const tempC = weather ? Number(weather.tempC) : NaN;
    const coolNight = Boolean(weather) && weather.isDay === false && Number.isFinite(tempC) && tempC <= 22;
    let key = "calm";
    let reason = "\u5E73\u5E73\u5E38\u5E38\u7684\u4E00\u9635";
    if (night) {
      key = "sleepy";
      reason = "\u591C\u6DF1\u4E86 \xB7 \u6709\u70B9\u56F0";
    } else if (wins >= 3) {
      key = "proud";
      reason = "\u98DE\u82B1\u4EE4\u8D62\u4E86 " + wins + " \u6B21 \xB7 \u597D\u5F97\u610F";
    } else if (wins >= 1) {
      key = "happy";
      reason = "\u98DE\u82B1\u4EE4\u8D62\u4E86 \xB7 \u5FC3\u60C5\u4E0D\u9519";
    } else if (meal) {
      key = "hungry";
      reason = "\u5230\u996D\u70B9\u5566 \xB7 \u6709\u70B9\u997F";
    } else if (rainy || coolNight) {
      key = "cozy";
      reason = category === "snow" ? "\u4E0B\u96EA\u4E86 \xB7 \u9002\u5408\u8BFB\u8BD7" : category === "rain" || category === "thunder" ? "\u5916\u9762\u6709\u96E8 \xB7 \u9002\u5408\u8BFB\u8BD7" : "\u591C\u8272\u51C9\u51C9 \xB7 \u5F88\u60EC\u610F";
    } else if (clicks === 0) {
      key = "curious";
      reason = "\u5B89\u9759\u7740 \xB7 \u56DB\u5904\u770B\u770B";
    }
    return {
      key,
      label: MOOD_LABELS[key] || key,
      image: (MOOD_IMAGES[key] || MOOD_IMAGES.calm)[0],
      reason,
      strong: MOOD_STRONG.indexOf(key) >= 0
    };
  }
  function throttleMoodSwitch(previous, next, now2, force) {
    const time = num(now2, Date.now());
    if (!next) return previous || null;
    if (!previous) return Object.assign({}, next, { changed: true, switchedAt: time });
    if (next.key === previous.key) {
      return Object.assign({}, next, { changed: false, switchedAt: num(previous.switchedAt, time) });
    }
    const elapsed = Math.max(0, time - num(previous.switchedAt, 0));
    if (next.strong === true || force === true || elapsed >= MOOD_SWITCH_MIN_MS) {
      return Object.assign({}, next, { changed: true, switchedAt: time });
    }
    return Object.assign({}, previous, { changed: false, pendingKey: next.key });
  }
  function moodBasisText(weather) {
    const label = weather && weather.label ? weather.label : "\u672A\u77E5";
    return "\u5929\u6C14\uFF1A" + label;
  }
  function normalizeMoodCatalog(data) {
    if (!data || !Array.isArray(data.moodImages) || !data.moodImages.length) return null;
    const moodImages = [];
    const seen = {};
    for (const item of data.moodImages) {
      const file = item && typeof item.file === "string" ? item.file.trim() : "";
      if (!file || seen[file]) continue;
      seen[file] = true;
      moodImages.push({ file, label: String(item.label || ""), tags: Array.isArray(item.tags) ? item.tags : [], media: item.media || "image" });
    }
    if (!moodImages.length) return null;
    const panel = Object.assign({}, MOOD_PANEL_PEEK_FILES);
    const applyPanel = (item) => {
      const file = item && typeof item.file === "string" ? item.file.trim() : "";
      if (!file) return;
      const tags = Array.isArray(item.tags) ? item.tags.join("|") : "";
      if (tags.indexOf("home") >= 0) panel.today = file;
      else if (tags.indexOf("settings") >= 0) panel.settings = file;
      else if (tags.indexOf("workbench") >= 0 || tags.indexOf("poetry") >= 0) panel.other = file;
    };
    for (const item of Array.isArray(data.panelImages) ? data.panelImages : []) applyPanel(item);
    for (const item of Array.isArray(data.images) ? data.images : []) {
      if (item && item.scope === "panel") applyPanel(item);
    }
    const byFile = {};
    for (const item of moodImages) byFile[item.file] = item;
    return {
      version: String(data.version || data.dataVersion || ""),
      moodImages,
      moodFiles: moodImages.map((item) => item.file),
      byFile,
      panel
    };
  }
  function panelPeekFile(catalog, tabId) {
    const panel = catalog && catalog.panel ? catalog.panel : MOOD_PANEL_PEEK_FILES;
    if (tabId === "today") return panel.today || MOOD_PANEL_PEEK_FILES.today;
    if (tabId === "settings") return panel.settings || MOOD_PANEL_PEEK_FILES.settings;
    return panel.other || MOOD_PANEL_PEEK_FILES.other;
  }
  function moodCatalogAllows(catalog, image) {
    if (!catalog || !Array.isArray(catalog.moodFiles) || typeof image !== "string" || !image) return false;
    return catalog.moodFiles.indexOf(image) >= 0;
  }
  function moodAiQuery(options) {
    const opts = options && typeof options === "object" ? options : {};
    const params = [];
    const add2 = (key, value) => {
      if (value == null || value === "") return;
      params.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    };
    if (opts.force === true) add2("force", "1");
    if (opts.manual === true) add2("manual", "1");
    add2("mood", opts.moodKey);
    add2("weather", opts.weather);
    const recent = (Array.isArray(opts.recent) ? opts.recent : []).map((text) => String(text == null ? "" : text).trim()).filter(Boolean).slice(-MOOD_AI_RECENT_MAX);
    if (recent.length) add2("recent", recent.join("|"));
    const imageSeen = {};
    const recentImages = [];
    for (const file of Array.isArray(opts.recentImages) ? opts.recentImages : []) {
      const clean = String(file == null ? "" : file).trim();
      if (!clean || imageSeen[clean]) continue;
      imageSeen[clean] = true;
      recentImages.push(clean);
    }
    if (recentImages.length) add2("recentImages", recentImages.slice(-MOOD_AI_RECENT_IMAGES_MAX).join("|"));
    return MOOD_AI_PATH + (params.length ? "?" + params.join("&") : "");
  }
  function parseMoodAiResponse(data, catalog) {
    const errorCode = data && data.error && typeof data.error.code === "string" ? data.error.code : "";
    if (!data || data.ok === false || !data.mood || typeof data.mood !== "object") return { ok: false, reason: "invalid", code: errorCode };
    const raw = data.mood;
    const label = String(raw.label == null ? "" : raw.label).trim();
    const reason = String(raw.reason == null ? "" : raw.reason).trim();
    const image = String(raw.image == null ? "" : raw.image).trim();
    const videoImage = /^webm\/[^/]+\.webm$/.test(image);
    if (!label || !videoImage && !moodCatalogAllows(catalog, image)) return { ok: false, reason: "image", code: errorCode };
    return {
      ok: true,
      mood: {
        key: "ai",
        label: label.slice(0, 24),
        image,
        reason: reason.slice(0, 80),
        energy: num(raw.energy, 0),
        source: "model",
        ai: true
      }
    };
  }
  function nextMoodAiDebounceDelay(options) {
    const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
    const random = typeof opts.random === "function" ? opts.random : Math.random;
    const value = Number(random());
    const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
    return Math.round(MOOD_AI_DEBOUNCE_MIN_MS + ratio * (MOOD_AI_DEBOUNCE_MAX_MS - MOOD_AI_DEBOUNCE_MIN_MS));
  }
  function nextMoodAiRetryDelay(options) {
    const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
    const random = typeof opts.random === "function" ? opts.random : Math.random;
    const value = Number(random());
    const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
    return Math.round(MOOD_AI_RETRY_MIN_MS + ratio * (MOOD_AI_RETRY_MAX_MS - MOOD_AI_RETRY_MIN_MS));
  }
  function moodAiKeepDecision(options) {
    const opts = options && typeof options === "object" ? options : {};
    if (opts.source !== "model") return false;
    const last = num(opts.lastSuccessAt, 0);
    if (last <= 0) return false;
    return num(opts.now, Date.now()) - last < MOOD_AI_KEEP_MS;
  }
  function normalizeMoodAiFailure(result) {
    const reason = result && typeof result.reason === "string" ? result.reason : "";
    const code = result && typeof result.code === "string" ? result.code : "";
    if (result && result.status === 429) return "rate";
    if (reason === "timeout" || reason === "http" || reason === "json" || reason === "image" || reason === "network" || reason === "rate") return reason;
    if (reason === "no-fetch") return "network";
    if (reason === "catalog") return "catalog";
    if (code) {
      if (/RATE|LIMIT/i.test(code)) return "rate";
      if (/TIMEOUT/i.test(code)) return "timeout";
      if (/JSON|PARSE/i.test(code)) return "json";
      if (/IMAGE/i.test(code)) return "image";
      if (/CATALOG/i.test(code)) return "catalog";
      if (/NETWORK|OFFLINE/i.test(code)) return "network";
    }
    if (reason === "host" || reason === "invalid") return "model";
    return "unknown";
  }
  function moodAiFailureLabel(reason) {
    const labels = { timeout: "\u8D85\u65F6", http: "HTTP \u9519\u8BEF", json: "\u54CD\u5E94\u683C\u5F0F\u9519\u8BEF", image: "\u56FE\u7247\u65E0\u6548", network: "\u7F51\u7EDC\u9519\u8BEF", rate: "\u8BF7\u6C42\u8FC7\u9891", model: "\u6A21\u578B\u8FD4\u56DE\u9519\u8BEF", catalog: "\u56FE\u9274\u672A\u52A0\u8F7D", unknown: "\u672A\u77E5\u539F\u56E0" };
    return labels[reason] || labels.unknown;
  }
  function moodAiEventDelay(options) {
    const opts = options && typeof options === "object" ? options : {};
    const last = num(opts.lastRequestAt, 0);
    const now2 = num(opts.now, Date.now());
    if (last > 0) {
      const remaining = MOOD_AI_MIN_GAP_MS - (now2 - last);
      if (remaining > 0) return remaining;
    }
    return nextMoodAiDebounceDelay(opts);
  }
  function moodTimeBucket(now2) {
    const parts = shanghaiParts(num(now2, Date.now()));
    const hour = parts.hour;
    let period2 = "night";
    if (hour >= 6 && hour < 11) period2 = "morning";
    else if (hour >= 11 && hour < 14) period2 = "noon";
    else if (hour >= 14 && hour < 18) period2 = "afternoon";
    else if (hour >= 18 && hour < 22) period2 = "evening";
    const meal = hour === 7 || hour === 8 || hour === 11 || hour === 12 || hour === 17 || hour === 18;
    return period2 + "|" + (meal ? "meal" : "offmeal");
  }
  function moodAiSnapshot(weather, feihuaWins, feihuaLosses) {
    return {
      weatherCategory: weather && typeof weather.category === "string" ? weather.category : "",
      feihuaWins: Math.max(0, Math.floor(num(feihuaWins, 0))),
      feihuaLosses: Math.max(0, Math.floor(num(feihuaLosses, 0)))
    };
  }
  function isMoodAiSignificant(previous, current) {
    if (!previous || !current) return false;
    if (current.weatherCategory !== previous.weatherCategory) return true;
    if (current.feihuaWins > previous.feihuaWins || current.feihuaLosses > previous.feihuaLosses) return true;
    return false;
  }

  // client-src/self-talk-client.js
  var SPONT_KEY = "dshp-mood-spont-v1";
  var SPONT_POLL_MIN_MS = 60 * 1e3;
  var SPONT_POLL_MAX_MS = 120 * 1e3;
  var SPONT_RETRY_MS = 10 * 1e3;
  var SPONT_EVENT_MIN_MS = 2 * 1e3;
  var SPONT_EVENT_MAX_MS = 5 * 1e3;
  var SPONT_CLOSE_RECHECK_MS = 3 * 1e3;
  var SPONT_QUIET_MS = 3 * 1e3;
  var SPONT_REPEAT_MS = 3 * 24 * 60 * 60 * 1e3;
  var SPONT_SEEN_DAYS = 7 * 24 * 60 * 60 * 1e3;
  var SPONT_MAX_SEEN = 300;
  var SPONT_AUTO_CLOSE_MS = 25e3;
  var SELF_TALK_PATH = "self-talk.json";
  var SELF_TALK_TIMEOUT_MS = 35 * 1e3;
  var SELF_TALK_RECENT_MAX = 12;
  function normalizeSpontState(raw, now2) {
    const src = raw && typeof raw === "object" ? raw : {};
    const dateKey = shanghaiParts(now2).dateKey;
    const seen = [];
    if (Array.isArray(src.seenIds)) {
      for (const entry of src.seenIds.slice(-SPONT_MAX_SEEN)) {
        let id2 = "";
        let at = 0;
        if (typeof entry === "string") id2 = entry;
        else if (entry && typeof entry === "object" && typeof entry.id === "string") {
          id2 = entry.id;
          at = num(entry.at, 0);
        }
        if (!id2) continue;
        if (at > 0 && now2 - at > SPONT_SEEN_DAYS) continue;
        seen.push({ id: id2, at });
      }
    }
    const sameDay = src.date === dateKey;
    return {
      date: dateKey,
      lastShownAt: sameDay ? num(src.lastShownAt, 0) : 0,
      todayCount: sameDay ? Math.max(0, Math.floor(num(src.todayCount, 0))) : 0,
      seenIds: seen,
      lastType: typeof src.lastType === "string" ? src.lastType : "",
      lastTag: typeof src.lastTag === "string" ? src.lastTag : ""
    };
  }
  function recordSpontShown(state, id2, now2, type, tag) {
    const base = normalizeSpontState(state, now2);
    const seen = base.seenIds.filter((entry) => entry.id !== id2).concat([{ id: String(id2), at: now2 }]).slice(-SPONT_MAX_SEEN);
    return {
      date: base.date,
      lastShownAt: num(now2, Date.now()),
      todayCount: base.todayCount + 1,
      seenIds: seen,
      lastType: typeof type === "string" ? type : base.lastType,
      lastTag: typeof tag === "string" ? tag : base.lastTag
    };
  }
  function countSpontHits(text, tags) {
    let hits = 0;
    for (const tag of Array.isArray(tags) ? tags : []) {
      if (!tag) continue;
      hits += String(text || "").split(tag).length - 1;
    }
    return hits;
  }
  function splitCompleteSentences(text) {
    const value = String(text == null ? "" : text);
    const out = [];
    let start2 = 0;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value.charAt(i);
      if (ch === "\u3002" || ch === "\uFF01" || ch === "\uFF1F") {
        const sentence = value.slice(start2, i + 1).trim();
        if (sentence) out.push(sentence);
        start2 = i + 1;
      }
    }
    return out;
  }
  function pickSentenceFromLines(lines, tags, random) {
    const list = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? "" : value)).filter((value) => value.length > 0);
    const sentences = splitCompleteSentences(list.join(""));
    if (!sentences.length) {
      if (!list.length) return "";
      let fallback = list[list.length - 1];
      if (/[，,]$/.test(fallback)) {
        fallback = list.length > 1 ? list[list.length - 2] : fallback.replace(/[，,]$/, "\u3002");
      }
      return fallback;
    }
    const scored = sentences.map((sentence) => ({ sentence, length: sentence.length, hits: countSpontHits(sentence, tags) }));
    const preferred = scored.filter((item) => item.length >= 8 && item.length <= 40 && item.hits > 0);
    const medium = scored.filter((item) => item.length >= 8 && item.length <= 40);
    const withTag = scored.filter((item) => item.hits > 0);
    const pool = preferred.length ? preferred : medium.length ? medium : withTag.length ? withTag : scored;
    if (!pool.length) return "";
    const index2 = Math.min(pool.length - 1, Math.max(0, Math.floor(num(typeof random === "function" ? random() : Math.random(), 0) * pool.length)));
    return pool[index2].sentence;
  }
  function selfTalkNoveltySignature(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const status = opts.selfStatus && typeof opts.selfStatus === "object" ? opts.selfStatus : null;
    const project = status && status.project && typeof status.project === "object" ? status.project : null;
    const latest = status && status.actions && status.actions.latest ? status.actions.latest : null;
    const mood = opts.mood && typeof opts.mood === "object" ? opts.mood : null;
    const weather = opts.weather && typeof opts.weather === "object" ? opts.weather : null;
    const now2 = typeof opts.now === "number" ? opts.now : Date.now();
    const bucket = Math.floor(now2 / (20 * 60 * 1e3));
    return [
      "felt:" + (status && typeof status.felt === "string" ? status.felt : ""),
      "exp:" + (status && typeof status.experiencing === "string" ? status.experiencing : ""),
      "act:" + (latest && typeof latest.id === "string" ? latest.id : ""),
      "proj:" + (project ? String(project.id || "") + ":" + String(project.title || "") + ":" + String(project.steps && project.steps.length || 0) : ""),
      "mood:" + (mood ? String(mood.key || "") + ":" + String(mood.label || "") + ":" + String(mood.reason || "") : ""),
      "weather:" + (weather ? String(weather.category || weather.label || "") + ":" + String(weather.tempC ?? "") : ""),
      "t:" + bucket
    ].join("|");
  }
  function canShowSpontaneous(options) {
    const opts = options && typeof options === "object" ? options : {};
    if (opts.enabled !== true) return false;
    if (opts.hidden === true || opts.panelOpen === true || opts.bubbleOpen === true || opts.visible === false) return false;
    const now2 = num(opts.now, Date.now());
    const lastInteraction = num(opts.lastInteractionAt, 0);
    const quietMs = num(opts.quietMs, SPONT_QUIET_MS);
    const idleMs = lastInteraction > 0 ? Math.max(0, now2 - lastInteraction) : Number.POSITIVE_INFINITY;
    if (idleMs < quietMs) return false;
    return true;
  }
  function nextSpontPollDelay(options) {
    const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
    const random = typeof opts.random === "function" ? opts.random : Math.random;
    const value = Number(random());
    const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
    return Math.round(SPONT_POLL_MIN_MS + ratio * (SPONT_POLL_MAX_MS - SPONT_POLL_MIN_MS));
  }
  function nextSpontEventDelay(options) {
    const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
    const random = typeof opts.random === "function" ? opts.random : Math.random;
    const value = Number(random());
    const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
    return Math.round(SPONT_EVENT_MIN_MS + ratio * (SPONT_EVENT_MAX_MS - SPONT_EVENT_MIN_MS));
  }
  function selfTalkKindFor() {
    return "murmur";
  }
  function selfTalkQuery(options) {
    const opts = options && typeof options === "object" ? options : {};
    const params = [];
    const add2 = (key, value) => {
      if (value == null || value === "") return;
      params.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    };
    add2("kind", "murmur");
    add2("mood", opts.moodKey);
    add2("moodLabel", opts.moodLabel);
    add2("moodReason", opts.moodReason);
    add2("image", opts.image);
    add2("imageLabel", opts.imageLabel);
    add2("weather", opts.weather);
    add2("idleMinutes", Math.max(0, Math.floor(num(opts.idleMinutes, 0))));
    const seen = {};
    const recent = [];
    for (const text of Array.isArray(opts.recent) ? opts.recent : []) {
      const clean = String(text == null ? "" : text).trim();
      if (!clean || seen[clean]) continue;
      seen[clean] = true;
      recent.push(clean);
    }
    const recentSlice = recent.slice(-SELF_TALK_RECENT_MAX);
    if (recentSlice.length) add2("recent", recentSlice.join("|"));
    return SELF_TALK_PATH + (params.length ? "?" + params.join("&") : "");
  }
  function parseSelfTalkResponse(data) {
    if (!data || data.ok === false || !Array.isArray(data.lines)) return { ok: false, reason: "invalid" };
    const texts = [];
    for (const line of data.lines) {
      const text = typeof line === "string" ? line : line && typeof line.text === "string" ? line.text : "";
      const clean = text.trim();
      if (clean && texts.indexOf(clean) < 0) texts.push(clean);
    }
    if (!texts.length) return { ok: false, reason: "empty" };
    return { ok: true, line: texts[0], next: texts[1] || "" };
  }

  // client-src/tabs-poetry.js
  function createPoetryTabs(ctx = {}) {
    const React = ctx.React;
    const h = ctx.h;
    const EmptyState = ctx.EmptyState;
    const LoadingState = ctx.LoadingState;
    const PoemBody = ctx.PoemBody;
    const AnalysisBody = ctx.AnalysisBody;
    const KnowledgeCardView = ctx.KnowledgeCardView;
    const describeDataError = ctx.describeDataError;
    const normalizeSettings = ctx.normalizeSettings;
    const cx = ctx.cx;
    const switchNode = ctx.switchNode;
    const num2 = ctx.num;
    function TodayTab(props) {
      const api = props.api || {};
      const poem = api.poem;
      if (!poem) {
        if (api.boot && api.boot.status === "error") {
          return h(EmptyState, {
            title: "\u8BD7\u8BCD\u6570\u636E\u5C1A\u672A\u5C31\u7EEA",
            message: describeDataError(api.boot.error),
            onRetry: api.retryBootstrap
          });
        }
        if (api.poemsRes && api.poemsRes.status === "error") {
          return h(EmptyState, {
            title: "\u4ECA\u65E5\u4E00\u8BD7\u6682\u65F6\u4E0D\u53EF\u7528",
            message: describeDataError(api.poemsRes.error),
            onRetry: () => api.reloadPoems && api.reloadPoems().catch(() => {
            })
          });
        }
        return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u4ECA\u65E5\u4E00\u8BD7\u2026" });
      }
      const items = Array.isArray(api.poemItems) ? api.poemItems : [];
      const index2 = items.findIndex((item) => item && item.id === poem.id);
      const total = items.length;
      return h(
        "div",
        null,
        api.weatherChip || api.moodChip ? h(
          "div",
          { className: "dshp-weather", style: { marginTop: 0 } },
          h(
            "div",
            { className: "dshp-chip-row" },
            api.weatherChip ? h("span", { className: "dshp-weather-chip" }, String(api.weatherChip)) : null,
            api.moodChip ? h("span", { className: "dshp-weather-chip dshp-mood-chip", title: api.moodChipTitle || "" }, String(api.moodChip)) : null
          ),
          api.weatherNote ? h("div", { className: "dshp-weather-note" }, String(api.weatherNote)) : null
        ) : null,
        h(
          "div",
          { className: "dshp-pager", style: { marginTop: 0 } },
          h("span", { className: "dshp-pager-label" }, (api.weatherActive ? "\u5929\u6C14\u63A8\u8350" : api.settings.mode === "random" ? "\u968F\u673A" : "\u6BCF\u65E5") + " \xB7 \u7B2C " + Math.max(1, index2 + 1) + (total ? " / " + total : "") + " \u9996"),
          h(
            "span",
            { className: "dshp-field-control" },
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: api.changePoem }, "\u6362\u4E00\u9996"),
            poem.id !== api.todayPoemId ? h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: api.backToToday }, "\u56DE\u5230\u4ECA\u65E5") : null
          )
        ),
        h(PoemBody, { poem, script: api.settings.script, showTones: api.settings.showTones }),
        h("div", { className: "dshp-subtitle" }, "\u683C\u5F8B\u89E3\u6790"),
        h(AnalysisBody, { poem })
      );
    }
    function ClassTab(props) {
      const api = props.api || {};
      const [index2, setIndex] = React.useState(0);
      const resource = api.knowledgeRes || {};
      if (resource.status === "error") {
        return h(EmptyState, {
          title: "\u683C\u5F8B\u8BFE\u5802\u6682\u65F6\u4E0D\u53EF\u7528",
          message: describeDataError(resource.error),
          onRetry: () => api.reloadKnowledge && api.reloadKnowledge().catch(() => {
          })
        });
      }
      const cards = resource.data && Array.isArray(resource.data.cards) ? resource.data.cards : [];
      if (!cards.length) {
        if (resource.status === "ready") {
          return h(EmptyState, { title: "\u6682\u65E0\u77E5\u8BC6\u5361", message: "\u8BFE\u5802\u5185\u5BB9\u8FD8\u5728\u51C6\u5907\u4E2D\uFF0C\u8BF7\u7A0D\u540E\u518D\u6765\u3002" });
        }
        return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u683C\u5F8B\u8BFE\u5802\u2026" });
      }
      const safeIndex = Math.min(Math.max(0, index2), cards.length - 1);
      const card = cards[safeIndex];
      return h(
        "div",
        null,
        h("div", { className: "dshp-card-summary", style: { marginBottom: "6px" } }, "\u683C\u5F8B\u5C0F\u8BFE\u5802 \xB7 \u5171 " + cards.length + " \u5F20\u5361"),
        h(KnowledgeCardView, { card }),
        h(
          "div",
          { className: "dshp-pager" },
          h("button", {
            type: "button",
            className: "dshp-btn dshp-btn-small",
            disabled: safeIndex <= 0,
            onClick: () => setIndex(safeIndex - 1)
          }, "\u4E0A\u4E00\u5F20"),
          h("span", { className: "dshp-pager-label" }, "\u7B2C " + (safeIndex + 1) + " / " + cards.length + " \u5F20"),
          h("button", {
            type: "button",
            className: "dshp-btn dshp-btn-small",
            disabled: safeIndex >= cards.length - 1,
            onClick: () => setIndex(safeIndex + 1)
          }, "\u4E0B\u4E00\u5F20")
        ),
        h(
          "div",
          { className: "dshp-tags", style: { marginTop: "10px" } },
          cards.map((item, cardIndex) => h("button", {
            key: item && item.id || cardIndex,
            type: "button",
            className: "dshp-tag",
            style: {
              cursor: "pointer",
              borderColor: cardIndex === safeIndex ? "var(--dshp-accent)" : void 0,
              color: cardIndex === safeIndex ? "var(--dshp-accent)" : void 0
            },
            onClick: () => setIndex(cardIndex)
          }, cardIndex + 1 + ". " + String(item && item.title || "\u5361\u7247")))
        )
      );
    }
    function YunTab(props) {
      const api = props.api || {};
      const [expanded, setExpanded] = React.useState(null);
      const resource = api.yunRes || {};
      if (resource.status === "error") {
        return h(EmptyState, {
          title: "\u97F5\u90E8\u6570\u636E\u6682\u65F6\u4E0D\u53EF\u7528",
          message: describeDataError(resource.error),
          onRetry: () => api.reloadYun && api.reloadYun().catch(() => {
          })
        });
      }
      const volumes = resource.data && Array.isArray(resource.data.volumes) ? resource.data.volumes : [];
      if (!volumes.length) {
        if (resource.status === "ready") {
          return h(EmptyState, { title: "\u6682\u65E0\u97F5\u90E8\u6570\u636E", message: "\u58F0\u5F8B\u542F\u8499\u6570\u636E\u8FD8\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u7A0D\u540E\u518D\u6765\u3002" });
        }
        return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u58F0\u5F8B\u542F\u8499\u2026" });
      }
      return h(
        "div",
        null,
        h("div", { className: "dshp-card-summary", style: { marginBottom: "6px" } }, "\u58F0\u5F8B\u542F\u8499 \xB7 \u5E73\u58F0\u4E09\u5341\u97F5\u90E8\uFF08\u4E0A\u5377 15 / \u4E0B\u5377 15\uFF09"),
        volumes.map((volume, volumeIndex) => {
          const chapters = volume && Array.isArray(volume.chapters) ? volume.chapters : [];
          return h(
            "div",
            { key: "volume-" + volumeIndex },
            h("div", { className: "dshp-subtitle" }, String(volume.title || "")),
            chapters.map((chapter, chapterIndex) => {
              const key = volumeIndex + "-" + chapterIndex;
              const open = expanded === key;
              const chars = Array.isArray(chapter.exampleChars) ? chapter.exampleChars : [];
              return h(
                "div",
                { key },
                h(
                  "button",
                  {
                    type: "button",
                    className: cx("dshp-row", open && "dshp-is-open"),
                    onClick: () => setExpanded(open ? null : key),
                    "aria-expanded": open
                  },
                  h(
                    "span",
                    { className: "dshp-row-main" },
                    h("span", { className: "dshp-row-title" }, String(chapter.name || "")),
                    chars.length ? h("span", { className: "dshp-row-sub" }, " \u4F8B\u5B57\uFF1A" + chars.join("\u3001")) : null
                  ),
                  h("span", { className: "dshp-muted", style: { flex: "none" } }, open ? "\u25BE" : "\u25B8")
                ),
                open ? h(
                  "div",
                  { className: "dshp-row-body" },
                  (Array.isArray(chapter.paragraphs) ? chapter.paragraphs : []).map((paragraph, index2) => h("p", { key: index2, className: "dshp-p" }, String(paragraph == null ? "" : paragraph))),
                  chapter.exampleLine ? h("div", { className: "dshp-example", style: { marginTop: "6px" } }, h("div", { className: "dshp-example-text" }, String(chapter.exampleLine))) : null
                ) : null
              );
            })
          );
        })
      );
    }
    function CiTab(props) {
      const api = props.api || {};
      const [subTab, setSubTab] = React.useState("poems");
      const [query, setQuery] = React.useState("");
      const [rhythmic, setRhythmic] = React.useState("");
      const [visible, setVisible] = React.useState(40);
      const [openId, setOpenId] = React.useState(null);
      const knowledge = api.knowledgeRes || {};
      const ciRes = api.ciRes || {};
      const ciCards = knowledge.data && Array.isArray(knowledge.data.ciCards) ? knowledge.data.ciCards : [];
      const items = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : [];
      const ciBankCounts = React.useMemo(() => {
        const map = {};
        const bankItems = api.ciBankRes && api.ciBankRes.data && Array.isArray(api.ciBankRes.data.items) ? api.ciBankRes.data.items : [];
        for (const item of bankItems) {
          if (item && item.rhythmic) map[item.rhythmic] = (map[item.rhythmic] || 0) + 1;
        }
        return map;
      }, [api.ciBankRes]);
      const ciSelectedCounts = React.useMemo(() => {
        const map = {};
        for (const item of items) {
          if (item && item.rhythmic) map[item.rhythmic] = (map[item.rhythmic] || 0) + 1;
        }
        return map;
      }, [items]);
      const rhythms = React.useMemo(() => {
        const seen = {};
        items.forEach((item) => {
          if (item && item.rhythmic) seen[item.rhythmic] = true;
        });
        return Object.keys(seen).sort((a2, b) => a2.localeCompare(b, "zh"));
      }, [items]);
      const filtered = React.useMemo(() => {
        const keyword = query.trim();
        return items.filter((item) => {
          if (!item) return false;
          if (rhythmic && item.rhythmic !== rhythmic) return false;
          if (!keyword) return true;
          const haystack = [item.title, item.author, item.rhythmic, item.quote].concat(Array.isArray(item.lines) ? item.lines : []).join(" ");
          return haystack.indexOf(keyword) >= 0;
        });
      }, [items, query, rhythmic]);
      React.useEffect(() => {
        setVisible(40);
      }, [query, rhythmic]);
      if (knowledge.status === "error") {
        return h(EmptyState, {
          title: "\u8BCD\u724C\u6570\u636E\u6682\u65F6\u4E0D\u53EF\u7528",
          message: describeDataError(knowledge.error),
          onRetry: () => api.reloadKnowledge && api.reloadKnowledge().catch(() => {
          })
        });
      }
      function renderCards() {
        if (!ciCards.length) {
          if (knowledge.status === "ready") return h(EmptyState, { title: "\u6682\u65E0\u8BCD\u724C\u5361", message: "\u8BCD\u724C\u5185\u5BB9\u8FD8\u5728\u51C6\u5907\u4E2D\uFF0C\u8BF7\u7A0D\u540E\u518D\u6765\u3002" });
          return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u8BCD\u724C\u5361\u2026" });
        }
        return h(
          "div",
          { className: "dshp-list" },
          ciCards.map((card, index2) => h(
            "div",
            { key: card && card.id || index2, className: "dshp-card", style: { padding: "8px 2px", borderBottom: "1px solid var(--dshp-border)" } },
            h(
              "div",
              { className: "dshp-card-title", style: { fontSize: "14px" } },
              String(card && card.name || "\u8BCD\u724C"),
              card && Array.isArray(card.aliases) && card.aliases.length ? h("span", { className: "dshp-muted", style: { fontSize: "11.5px", fontWeight: 400 } }, "\uFF08" + card.aliases.join("\u3001") + "\uFF09") : null
            ),
            card && card.form ? h("div", { className: "dshp-card-summary" }, String(card.form) + (card.rhyme ? " \xB7 " + String(card.rhyme) : "")) : null,
            card && card.note ? h("p", { className: "dshp-p" }, String(card.note)) : null,
            card && card.example ? h("div", { className: "dshp-example" }, h("div", { className: "dshp-example-text" }, String(card.example))) : null,
            card && card.name ? h(
              "div",
              { className: "dshp-fh-actions" },
              h("button", {
                type: "button",
                className: "dshp-link",
                onClick: () => {
                  if (api.openCiSelectedForRhythmic) api.openCiSelectedForRhythmic(card.name);
                }
              }, "\u540C\u8BCD\u724C\u7CBE\u9009" + (ciSelectedCounts[card.name] ? "\uFF08" + ciSelectedCounts[card.name] + " \u9996\uFF09" : "")),
              h("button", {
                type: "button",
                className: "dshp-link dshp-muted",
                onClick: () => {
                  if (api.openCiBankForRhythmic) api.openCiBankForRhythmic(card.name);
                }
              }, "\u5168\u5E93" + (ciBankCounts[card.name] ? "\uFF08" + ciBankCounts[card.name] + " \u9996\uFF09" : "\u540C\u8BCD\u724C"))
            ) : null
          ))
        );
      }
      function renderPoems() {
        if (ciRes.status === "error") {
          return h(EmptyState, {
            title: "\u540D\u7BC7\u8BCD\u6682\u65F6\u4E0D\u53EF\u7528",
            message: describeDataError(ciRes.error),
            onRetry: () => api.reloadCi && api.reloadCi().catch(() => {
            })
          });
        }
        if (!items.length) {
          if (ciRes.status === "ready") return h(EmptyState, { title: "\u6682\u65E0\u8BCD\u4F5C", message: "\u540D\u7BC7\u8BCD\u6570\u636E\u6B63\u5728\u51C6\u5907\u4E2D\u3002" });
          return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u540D\u7BC7\u8BCD\u2026" });
        }
        const shown = filtered.slice(0, visible);
        return h(
          "div",
          null,
          h(
            "div",
            { className: "dshp-search" },
            h("input", {
              className: "dshp-input",
              type: "search",
              value: query,
              placeholder: "\u641C\u7D22\u8BCD\u724C / \u4F5C\u8005 / \u8BCD\u53E5",
              "aria-label": "\u641C\u7D22\u540D\u7BC7\u8BCD",
              onChange: (event) => setQuery(event.target.value)
            }),
            h(
              "select",
              {
                className: "dshp-select",
                value: rhythmic,
                "aria-label": "\u6309\u8BCD\u724C\u7B5B\u9009",
                onChange: (event) => setRhythmic(event.target.value)
              },
              h("option", { value: "" }, "\u5168\u90E8\u8BCD\u724C"),
              rhythms.map((name) => h("option", { key: name, value: name }, name))
            )
          ),
          h("div", { className: "dshp-card-summary", style: { marginBottom: "6px" } }, "\u5171 " + filtered.length + " \u9996\uFF08\u603B\u8BA1 " + items.length + " \u9996\uFF09"),
          h(
            "div",
            { className: "dshp-list" },
            shown.map((ci, index2) => {
              const ciId = ci.id || "ci-" + index2;
              const open = openId === ciId;
              return h(
                "div",
                { key: ciId },
                h(
                  "button",
                  {
                    type: "button",
                    className: cx("dshp-row", open && "dshp-is-open"),
                    onClick: () => setOpenId(open ? null : ciId),
                    "aria-expanded": open
                  },
                  h(
                    "span",
                    { className: "dshp-row-main" },
                    h("span", { className: "dshp-row-title" }, String(ci.title || ci.rhythmic || "\u65E0\u9898")),
                    h("span", { className: "dshp-row-sub" }, String(ci.author || "") + (ci.rhythmic ? " \xB7 " + String(ci.rhythmic) : ""))
                  ),
                  h("span", { className: "dshp-muted", style: { flex: "none" } }, open ? "\u25BE" : "\u25B8")
                ),
                open ? h(
                  "div",
                  { className: "dshp-row-body" },
                  h("div", { className: "dshp-ci-lines" }, (Array.isArray(ci.lines) ? ci.lines : []).map((line, lineIndex) => h("div", { key: lineIndex }, String(line)))),
                  ci.quote ? h("div", { className: "dshp-example" }, h("div", { className: "dshp-example-text" }, String(ci.quote))) : null,
                  ci.rhythmic ? h(
                    "div",
                    { className: "dshp-fh-actions" },
                    h("button", {
                      type: "button",
                      className: "dshp-link",
                      onClick: () => {
                        if (api.openCiSelectedForRhythmic) api.openCiSelectedForRhythmic(ci.rhythmic);
                      }
                    }, "\u540C\u8BCD\u724C\u7CBE\u9009" + (ciSelectedCounts[ci.rhythmic] ? "\uFF08" + ciSelectedCounts[ci.rhythmic] + " \u9996\uFF09" : "")),
                    h("button", {
                      type: "button",
                      className: "dshp-link dshp-muted",
                      onClick: () => {
                        if (api.openCiBankForRhythmic) api.openCiBankForRhythmic(ci.rhythmic);
                      }
                    }, "\u5168\u5E93" + (ciBankCounts[ci.rhythmic] ? "\uFF08" + ciBankCounts[ci.rhythmic] + " \u9996\uFF09" : "\u540C\u8BCD\u724C"))
                  ) : null
                ) : null
              );
            })
          ),
          filtered.length > visible ? h(
            "div",
            { style: { textAlign: "center", marginTop: "10px" } },
            h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: () => setVisible(visible + 60)
            }, "\u52A0\u8F7D\u66F4\u591A\uFF08\u5269\u4F59 " + (filtered.length - visible) + " \u9996\uFF09")
          ) : null
        );
      }
      return h(
        "div",
        null,
        h(
          "div",
          { className: "dshp-seg", style: { marginBottom: "10px" } },
          h("button", {
            type: "button",
            className: cx("dshp-seg-btn", subTab === "poems" && "dshp-is-active"),
            onClick: () => setSubTab("poems")
          }, "\u540D\u7BC7\u8BCD"),
          h("button", {
            type: "button",
            className: cx("dshp-seg-btn", subTab === "cards" && "dshp-is-active"),
            onClick: () => setSubTab("cards")
          }, "\u8BCD\u724C\u5361")
        ),
        subTab === "cards" ? renderCards() : renderPoems()
      );
    }
    function PoetrySettingsTab(props) {
      const api = props.api || {};
      const settings = api.settings && typeof api.settings === "object" ? api.settings : normalizeSettings();
      const update = api.updateSettings || (() => {
      });
      const seg = (options, current, onPick) => h(
        "div",
        { className: "dshp-seg" },
        options.map((option) => h("button", {
          key: String(option.value),
          type: "button",
          className: cx("dshp-seg-btn", current === option.value && "dshp-is-active"),
          onClick: () => onPick(option.value)
        }, option.label))
      );
      return h(
        "div",
        { className: "dshp-settings" },
        h("div", { className: "dshp-field" }, h("div", { className: "dshp-field-label" }, h("b", null, "\u8BD7\u8BCD\u8BBE\u7F6E"), h("small", null, "\u4E8C\u7EA7\u83DC\u5355\u91CC\u7684\u914D\u7F6E\uFF1B\u4E3B\u8BBE\u7F6E\u53EA\u7559\u6210\u957F/\u5916\u89C2"))),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u5E73\u4EC4\u6807\u6CE8"), h("small", null, "\u5E73\u84DD / \u4EC4\u7EA2 / \u591A\u97F3\u7070")),
          switchNode(settings.showTones, () => update({ showTones: !settings.showTones }), "\u5E73\u4EC4\u6807\u6CE8\u5F00\u5173")
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u70B9\u8BD7\u6A21\u5F0F"), h("small", null, "\u300C\u6362\u4E00\u9996\u300D\u7684\u7B56\u7565")),
          seg([
            { value: "daily", label: "\u6BCF\u65E5" },
            { value: "random", label: "\u968F\u673A" }
          ], settings.mode, (value) => update({ mode: value }))
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u81EA\u52A8\u8F6E\u64AD"), h("small", null, "\u6C14\u6CE1\u81EA\u52A8\u63A8\u8FDB\u95F4\u9694")),
          h(
            "select",
            {
              className: "dshp-select",
              value: String(settings.autoplay),
              "aria-label": "\u81EA\u52A8\u8F6E\u64AD\u95F4\u9694",
              onChange: (event) => update({ autoplay: num2(event.target.value, 0) })
            },
            h("option", { value: "0" }, "\u5173\u95ED"),
            h("option", { value: "30" }, "30 \u79D2"),
            h("option", { value: "60" }, "1 \u5206\u949F"),
            h("option", { value: "300" }, "5 \u5206\u949F")
          )
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u663E\u793A\u6587\u5B57"), h("small", null, "\u7B80\u4F53\u6216\u8BD7\u8BCD\u539F\u6587")),
          seg([
            { value: "simplified", label: "\u7B80\u4F53" },
            { value: "original", label: "\u539F\u6587" }
          ], settings.script, (value) => update({ script: value }))
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u6309\u5929\u6C14\u9009\u8BD7"), h("small", null, "\u4ECA\u65E5\u8BD7\u4E0E\u5F62\u8C61\u8DDF\u968F\u5929\u6C14")),
          switchNode(settings.weatherPoem, () => update({ weatherPoem: !settings.weatherPoem }), "\u6309\u5929\u6C14\u9009\u8BD7\u5F00\u5173")
        ),
        h("div", { className: "dshp-muted", style: { fontSize: "11.5px", lineHeight: 1.6 } }, "\u8BD7\u8BCD\u662F\u4E8C\u7EA7\u83DC\u5355\uFF1A\u4ECE\u300C\u6210\u957F\u300D\u9875\u5E95\u90E8\u7684\u5165\u53E3\u8FDB\u5165\uFF1B\u5927\u5C0F/\u5438\u9644/\u81EA\u8A00\u81EA\u8BED/\u9690\u85CF\u4ECD\u5728\u4E3B\u8BBE\u7F6E\u3002")
      );
    }
    return { TodayTab, ClassTab, YunTab, CiTab, PoetrySettingsTab };
  }

  // client-src/tabs-settings.js
  function createSettingsTab(ctx = {}) {
    const React = ctx.React;
    const h = ctx.h;
    const cx = ctx.cx;
    const normalizeSettings = ctx.normalizeSettings;
    const num2 = ctx.num;
    const switchNode = ctx.switchNode;
    const growthMetricsTree = ctx.growthMetricsTree;
    const weatherChipText = ctx.weatherChipText;
    const weatherUpdatedLabel = ctx.weatherUpdatedLabel;
    const moodBasisText2 = ctx.moodBasisText;
    const moodAiFailureLabel2 = ctx.moodAiFailureLabel;
    function SettingsTab(props) {
      const api = props.api || {};
      const settings = api.settings && typeof api.settings === "object" ? api.settings : normalizeSettings();
      const [confirmReset, setConfirmReset] = React.useState(false);
      const [cityDraft, setCityDraft] = React.useState(settings.weatherCity || "\u5317\u4EAC");
      React.useEffect(() => {
        setCityDraft(settings.weatherCity || "\u5317\u4EAC");
      }, [settings.weatherCity]);
      const update = api.updateSettings || (() => {
      });
      function commitCity() {
        const raw = String(cityDraft == null ? "" : cityDraft).trim();
        const nextCity = raw.length >= 1 && raw.length <= 20 ? raw : "\u5317\u4EAC";
        setCityDraft(nextCity);
        if (nextCity !== settings.weatherCity) update({ weatherCity: nextCity });
      }
      const weatherRes = api.weatherRes || {};
      const weatherInfo = api.weatherData && api.weatherData.weather ? api.weatherData.weather : null;
      const weatherAt = weatherRes.at || weatherInfo && weatherInfo.updatedAt || 0;
      const weatherStatusText = weatherInfo ? weatherChipText(api.weatherData.city, weatherInfo) + (weatherAt ? " \xB7 \u66F4\u65B0\u4E8E " + weatherUpdatedLabel(weatherAt) : "") : weatherRes.status === "loading" ? "\u6B63\u5728\u83B7\u53D6\u5929\u6C14\u2026" : "\u5929\u6C14\u6682\u4E0D\u53EF\u7528\uFF08\u4E0D\u5F71\u54CD\u5176\u4ED6\u529F\u80FD\uFF09";
      const currentMood = api.moodView || null;
      const moodAt = api.moodRes && (api.moodRes.at || api.moodRes.data && api.moodRes.data.updatedAt) || 0;
      const moodSourceLabel = api.moodSource === "model" ? "\u6A21\u578B" : api.moodSource === "heuristic" ? "\u542F\u53D1\u5F0F" : "";
      const moodReasonText = currentMood ? String(currentMood.reason || "").replace(/[「」]/g, "").trim() : "";
      const moodQuotedReason = moodReasonText ? "\u300C" + moodReasonText + "\u300D" : "";
      const moodDetailText = currentMood ? "\u5F53\u524D\uFF1A" + currentMood.label + moodQuotedReason : "";
      const moodMetaText = [api.moodBasis || moodBasisText2(api.weather), moodSourceLabel ? "\u6765\u6E90\uFF1A" + moodSourceLabel : "", moodAt ? "\u66F4\u65B0\u4E8E " + weatherUpdatedLabel(moodAt) : ""].filter(Boolean).join(" \xB7 ");
      const moodStatusText = [moodDetailText, moodMetaText].filter(Boolean).join(" \xB7 ") || "\u5FC3\u60C5\u6570\u636E\u52A0\u8F7D\u4E2D";
      const moodStatusFull = [moodDetailText, moodMetaText].filter(Boolean).join(" \xB7 ");
      const moodLine = (text, className, key) => h("div", { key, className: cx("dshp-card-summary", "dshp-ellipsis", className), title: text }, text);
      function seg(options, current, onPick) {
        return h(
          "div",
          { className: "dshp-seg" },
          options.map((option) => h("button", {
            key: String(option.value),
            type: "button",
            className: cx("dshp-seg-btn", current === option.value && "dshp-is-active"),
            onClick: () => onPick(option.value)
          }, option.label))
        );
      }
      const boot = api.boot || {};
      const data = boot.data || {};
      const version = data.version || "0.1.0";
      const dataVersion = data.dataVersion || "\u2014";
      const source = data.source || {};
      function renderSelfStatus() {
        const status = api.selfStatus;
        if (!status) return null;
        return h(
          "div",
          { className: "dshp-field dshp-field-stacked" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u6210\u957F\u72B6\u6001"), h("small", null, "\u81EA\u9A71\u6210\u957F \xB7 \u6700\u8FD1\u8FDB\u5EA6")),
          h("div", { className: "dshp-field-stack-body" }, growthMetricsTree(status))
        );
      }
      function renderHealthStatus() {
        const health = api.healthStatus;
        if (!health) return null;
        const budgetLine = health.totalLimit > 0 ? `\u4ECA\u65E5\u6A21\u578B\u8C03\u7528 ${health.total}/${health.totalLimit}` : `\u4ECA\u65E5\u6A21\u578B\u8C03\u7528 ${health.total}\uFF08\u672A\u8BBE\u4E0A\u9650\uFF09`;
        const roles = health.roleCounts.map((item) => `${item.role} ${item.count}`).join(" \xB7 ");
        const jobs = health.jobs.slice(0, 8);
        const jobLine = jobs.length > 0 ? jobs.map((job) => `${job.name}${job.errors > 0 ? `(${job.errors}\u9519)` : ""}`).join(" \xB7 ") : "\u5FC3\u8DF3\u672A\u6CE8\u518C";
        const errorLine = health.modelErrorTotal > 0 ? `\u6700\u8FD1 24h \u6A21\u578B\u5931\u8D25 ${health.modelErrorTotal} \u6B21` + (health.modelErrorsByRole.length ? "\uFF1A" + health.modelErrorsByRole.map((item) => `${item.role}\xD7${item.count}`).join("\u3001") : "") : "\u6700\u8FD1 24h \u6A21\u578B\u5931\u8D25 0";
        return h(
          "div",
          { className: "dshp-field dshp-field-stacked" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u8FD0\u884C\u72B6\u6001\uFF08\u53EA\u8BFB\uFF09"), h("small", null, "\u9884\u7B97 \xB7 \u5FC3\u8DF3 \xB7 \u6A21\u578B\u5931\u8D25\uFF1B\u6BCF\u5206\u949F\u5237\u65B0")),
          h(
            "div",
            { className: "dshp-field-stack-body" },
            h("div", { className: "dshp-health-line" }, budgetLine + (health.day ? " \xB7 " + health.day : "")),
            roles ? h("div", { className: "dshp-health-line" }, "\u8C03\u7528\uFF1A" + roles) : null,
            h("div", { className: "dshp-health-line" }, "\u5FC3\u8DF3\uFF1A" + jobLine),
            health.memoryBacklog !== null ? h("div", { className: "dshp-health-line" }, health.memoryBacklog === 0 ? "\u8BB0\u5FC6\u6574\u5408\uFF1A\u5DF2\u8FFD\u5E73" : "\u8BB0\u5FC6\u6574\u5408 backlog\uFF1A" + health.memoryBacklog + " \u6761" + (health.memoryBacklogOldestAt ? "\uFF08\u6700\u65E9 " + new Date(health.memoryBacklogOldestAt).toLocaleTimeString("zh-CN", { hour12: false }) + "\uFF09" : "")) : null,
            health.growthMetrics ? h("div", { className: "dshp-health-line" }, "\u6210\u957F\uFF1A\u7B2C " + health.growthMetrics.daysAlive + " \u5929 \xB7 journal " + health.growthMetrics.journalTotal + " \u6761 \xB7 \u56DE\u5FC6 " + health.growthMetrics.episodes + " \u6BB5\uFF08\u8986\u76D6 " + Math.round(health.growthMetrics.coverage * 100) + "%\uFF09\xB7 \u5B66\u4E60 " + health.growthMetrics.learning + " \u6761 \xB7 \u91CD\u590D " + health.growthMetrics.repetition.toFixed(2) + (health.growthMetrics.project ? " \xB7 \u5728\u505A\uFF1A" + health.growthMetrics.project : "")) : null,
            h("div", { className: "dshp-health-line" }, errorLine)
          )
        );
      }
      return h(
        "div",
        { className: "dshp-settings" },
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u5927\u5C0F"), h("small", null, "\u5F62\u8C61\u7F29\u653E 60%\u2013160%")),
          h(
            "div",
            { className: "dshp-field-control" },
            h("input", {
              type: "range",
              className: "dshp-range",
              min: 60,
              max: 160,
              step: 5,
              value: Math.round(settings.scale * 100),
              "aria-label": "\u6302\u4EF6\u5927\u5C0F",
              onChange: (event) => update({ scale: num2(event.target.value, 100) / 100 })
            }),
            h("span", { className: "dshp-muted", style: { fontSize: "11.5px", width: "38px", textAlign: "right" } }, Math.round(settings.scale * 100) + "%")
          )
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u8BD7\u8BCD\u8BBE\u7F6E"), h("small", null, "\u5DF2\u964D\u6743\u5230\u300C\u6210\u957F \u2192 \u8BD7\u8BCD\uFF08\u4E8C\u7EA7\u83DC\u5355\uFF09\u2192 \u8BBE\u7F6E\u300D"))
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u5438\u9644"), h("small", null, "\u62D6\u52A8\u540E\u8D34\u8FB9\u6216\u81EA\u7531\u6446\u653E")),
          seg([
            { value: "left", label: "\u8D34\u5DE6" },
            { value: "right", label: "\u8D34\u53F3" },
            { value: "free", label: "\u81EA\u7531" }
          ], settings.snap, (value) => update({ snap: value }))
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u5929\u6C14\u57CE\u5E02"), h("small", null, "1\u201320 \u5B57\uFF0C\u4FDD\u5B58\u540E\u81EA\u52A8\u91CD\u62C9\u5929\u6C14")),
          h(
            "div",
            { className: "dshp-field-control" },
            h("input", {
              type: "text",
              className: "dshp-input",
              style: { width: "118px" },
              value: cityDraft,
              maxLength: 20,
              placeholder: "\u5317\u4EAC",
              "aria-label": "\u5929\u6C14\u57CE\u5E02",
              onChange: (event) => setCityDraft(event.target.value),
              onBlur: commitCity,
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCity();
                }
              }
            })
          )
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u5929\u6C14"), h("small", null, weatherStatusText)),
          h(
            "div",
            { className: "dshp-field-control" },
            h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: () => {
                if (api.refreshWeather) api.refreshWeather(true);
              }
            }, "\u5237\u65B0\u5929\u6C14")
          )
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u81EA\u8A00\u81EA\u8BED\uFF08\u5076\u5C14\u8BF4\u8BF4\u8BDD\uFF09"), h("small", null, "\u6BCF\u9694 1\u20132 \u5206\u949F\u53EF\u80FD\u8BF4\u4E00\u53E5\uFF08\u4E8B\u4EF6\u540E\u4F1A\u66F4\u65E9\uFF09\uFF1B\u4E0D\u8BBE\u6BCF\u65E5\u6B21\u6570")),
          switchNode(settings.spontaneousPoem, () => update({ spontaneousPoem: !settings.spontaneousPoem }), "\u81EA\u8A00\u81EA\u8BED\u5F00\u5173")
        ),
        renderSelfStatus(),
        renderHealthStatus(),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u60F3\u8BFB\u7684\u8BD7"), h("small", null, "\u9884\u89C8\u4E00\u6B21\u5F69\u86CB\uFF08\u4E0D\u8BA1\u5165\u6BCF\u65E5\u6B21\u6570\uFF09")),
          h(
            "div",
            { className: "dshp-field-control" },
            h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: () => {
                if (api.previewSpontaneousPoem) api.previewSpontaneousPoem();
              }
            }, "\u9884\u89C8\u4E00\u53E5")
          )
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u9690\u85CF\u6302\u4EF6"), h("small", null, "\u53CC\u51FB\u7A7A\u767D\u5904\u6216\u957F\u6309\u89D2\u843D\u5C0F\u5706\u70B9\u6062\u590D")),
          h(
            "div",
            { className: "dshp-field-control" },
            h("button", {
              type: "button",
              className: "dshp-btn dshp-btn-danger",
              onClick: () => {
                setConfirmReset(false);
                if (api.hideWidget) api.hideWidget();
              }
            }, "\u9690\u85CF")
          )
        ),
        h(
          "div",
          { className: "dshp-field" },
          h("div", { className: "dshp-field-label" }, h("b", null, "\u6062\u590D\u9ED8\u8BA4"), h("small", null, "\u5927\u5C0F / \u5E73\u4EC4 / \u6A21\u5F0F / \u5438\u9644 / \u5B57\u4F53")),
          h(
            "div",
            { className: "dshp-field-control" },
            confirmReset ? [
              h("button", {
                key: "confirm",
                type: "button",
                className: "dshp-btn dshp-btn-primary",
                onClick: () => {
                  setConfirmReset(false);
                  if (api.resetSettings) api.resetSettings();
                }
              }, "\u786E\u8BA4\u6062\u590D"),
              h("button", {
                key: "cancel",
                type: "button",
                className: "dshp-btn",
                onClick: () => setConfirmReset(false)
              }, "\u53D6\u6D88")
            ] : h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: () => setConfirmReset(true)
            }, "\u6062\u590D\u9ED8\u8BA4")
          )
        ),
        h("div", { className: "dshp-subtitle" }, "\u5173\u4E8E"),
        h(
          "div",
          { className: "dshp-about" },
          h("div", null, "\u5C0F\u9CB8\u9C7C v" + String(version)),
          h("div", null, "\u6570\u636E\u7248\u672C\uFF1A" + String(dataVersion)),
          h("div", null, "\u6570\u636E\u6E90\uFF1Achinese-poetry\uFF08MIT\uFF09\xB7 \u8BD7\u8BCD\u4E3A\u516C\u7248\u6587\u672C"),
          source.commit ? h("div", null, "\u6E90\u63D0\u4EA4\uFF1A" + String(source.commit).slice(0, 12)) : null,
          h("div", null, "\u8BBE\u7F6E\u4FDD\u5B58\u5728\u672C\u673A $DSH_HOME/.dsh-poetry/settings.json\uFF1B\u9690\u85CF\u540E\u53CC\u51FB\u9875\u9762\u7A7A\u767D\u5904\u6216\u957F\u6309\u89D2\u843D\u5C0F\u5706\u70B9\u6062\u590D\u3002")
        )
      );
    }
    return SettingsTab;
  }

  // client-src/tabs-growth.js
  function createGrowthTab(ctx = {}) {
    const h = ctx.h;
    const cx = ctx.cx;
    const switchNode = ctx.switchNode;
    const growthMetricsTree = ctx.growthMetricsTree;
    const moodAiFailureLabel2 = ctx.moodAiFailureLabel;
    const selfStatusSummary = ctx.selfStatusSummary;
    const weatherUpdatedLabel = ctx.weatherUpdatedLabel;
    function GrowthTab(props) {
      const api = props.api || {};
      const settings = api.settings && typeof api.settings === "object" ? api.settings : {};
      const mood = api.moodView || null;
      const status = api.selfStatus || null;
      const memory = api.memoryStatus || null;
      const recent = (Array.isArray(api.recentSpoken) ? api.recentSpoken : []).slice(-5);
      const moodSource = mood && mood.source || api.moodSource || "";
      const moodSourceLabel = moodSource === "model" ? "\u6A21\u578B\u751F\u6210" : moodSource === "heuristic" ? "\u542F\u53D1\u5F0F" : "";
      const sayButton = api.previewSpontaneousPoem || api.readAnotherSpontaneous || function() {
      };
      const moodFailureText = api.moodAiFailure ? moodAiFailureLabel2(api.moodAiFailure) + (api.moodAiFailureCode ? "\uFF08" + String(api.moodAiFailureCode).slice(0, 48) + "\uFF09" : "") : "";
      const memoryLabels = { ok: "\u5065\u5EB7", warn: "\u6CE8\u610F", error: "\u5F02\u5E38" };
      const recentActions = status && status.actions && Array.isArray(status.actions.recent) ? status.actions.recent.slice(0, 5) : [];
      const works = api.worksRes && api.worksRes.data && Array.isArray(api.worksRes.data.works) ? api.worksRes.data.works.slice(0, 3) : [];
      const attention = api.attentionRes && api.attentionRes.data ? api.attentionRes.data : { mode: "observe", items: [], pending: 0 };
      const pendingAttention = Array.isArray(attention.items) ? attention.items : [];
      const attentionMode = attention.mode === "auto" ? "auto" : "observe";
      const attentionButtons = (item) => h(
        "div",
        { style: { display: "flex", gap: 6, marginTop: 6 } },
        item.kind === "question" ? h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
          if (!api.attentionAction) return;
          const answer = typeof window !== "undefined" && typeof window.prompt === "function" ? window.prompt("\u56DE\u7B54\u5979\uFF1A", "") : "";
          if (answer && answer.trim().length > 0) api.attentionAction(item.id, "answer", answer.trim());
        } }, "\u56DE\u7B54") : item.kind === "result" ? h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
          if (api.attentionAction) api.attentionAction(item.id, "dismiss");
        } }, "\u77E5\u9053\u4E86") : h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
          if (api.attentionAction) api.attentionAction(item.id, "send");
        } }, item.draft ? "\u53D1\u51FA\u53BB" : "\u56DE\u590D"),
        h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
          if (api.attentionAction) api.attentionAction(item.id, "dismiss");
        } }, "\u5148\u4E0D\u7528")
      );
      return h(
        "div",
        { className: "dshp-growth" },
        h("div", { className: "dshp-growth-title" }, "\u6211\u7684\u6210\u957F"),
        pendingAttention.length ? h(
          "div",
          { className: "dshp-growth-section", style: { borderColor: "#b58a4a", background: "rgba(181,138,74,.08)" } },
          h("div", { className: "dshp-growth-section-head" }, "\u9700\u8981\u4F60 \xB7 " + pendingAttention.length),
          h("div", { className: "dshp-growth-mood-note", style: { marginBottom: 6 } }, attentionMode === "observe" ? "\u89C2\u5BDF\u6A21\u5F0F\uFF1A\u5979\u51C6\u5907\u597D\u4E86\uFF0C\u7B49\u4F60\u51B3\u5B9A\u8981\u4E0D\u8981\u53D1\u3002" : "\u81EA\u52A8\u6A21\u5F0F\uFF1A\u5979\u5DF2\u6709\u5177\u4F53\u7684\u4E8B\uFF0C\u53D1\u9001\u524D\u5148\u5728\u8FD9\u91CC\u7559\u4E00\u4EFD\u3002"),
          ...pendingAttention.map((item) => h(
            "div",
            { className: "dshp-growth-action", key: "attention-" + item.id, style: { display: "block", marginBottom: 10 } },
            h("div", { className: "dshp-growth-action-text", style: { whiteSpace: "normal" } }, String(item.text || "")),
            item.reason ? h("div", { className: "dshp-growth-empty" }, String(item.reason)) : null,
            attentionButtons(item)
          )),
          h(
            "div",
            { style: { display: "flex", gap: 6, alignItems: "center", marginTop: 4 } },
            h("span", { className: "dshp-growth-empty" }, "\u4E3B\u52A8\u6D88\u606F\uFF1A"),
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.setAttentionMode) api.setAttentionMode(attentionMode === "auto" ? "observe" : "auto");
            } }, attentionMode === "auto" ? "\u81EA\u52A8" : "\u89C2\u5BDF\u4E2D")
          )
        ) : null,
        h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u4E3B\u52A8\u6D88\u606F"),
          h(
            "div",
            { style: { display: "flex", gap: 8, alignItems: "center" } },
            h("span", { className: "dshp-growth-empty" }, attentionMode === "auto" ? "\u81EA\u52A8\uFF1A\u6709\u5177\u4F53\u7684\u4E8B\u5C31\u76F4\u63A5\u53D1" : "\u89C2\u5BDF\u4E2D\uFF1A\u5979\u5148\u51C6\u5907\uFF0C\u7B49\u4F60\u653E\u884C"),
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.setAttentionMode) api.setAttentionMode(attentionMode === "auto" ? "observe" : "auto");
            } }, attentionMode === "auto" ? "\u5207\u56DE\u89C2\u5BDF" : "\u6539\u4E3A\u81EA\u52A8")
          )
        ),
        h(
          "div",
          { className: "dshp-growth-mood" },
          h("div", { className: "dshp-growth-mood-label" }, mood && mood.label ? mood.label : "\u8FD8\u6CA1\u5F62\u6210\u5FC3\u60C5"),
          mood && mood.reason ? h("div", { className: "dshp-growth-mood-reason" }, String(mood.reason)) : null,
          moodSourceLabel ? h("div", { className: "dshp-growth-mood-source" }, "\u6765\u6E90\uFF1A" + moodSourceLabel) : null,
          api.moodAiFallback ? h("div", { className: "dshp-growth-mood-note" }, "\u5F53\u524D\u4F7F\u7528\u672C\u5730\u9762\u90E8\u8868\u60C5\uFF08\u6A21\u578B\u5FC3\u60C5\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000\u542F\u53D1\u5F0F\uFF09") : null,
          api.moodAiStale ? h("div", { className: "dshp-growth-mood-note" }, "\u6A21\u578B\u5FC3\u60C5\u6682\u65F6\u4E0D\u53EF\u7528\uFF08" + moodAiFailureLabel2(api.moodAiFailure) + (api.moodAiFailureCode ? "\uFF0C" + String(api.moodAiFailureCode).slice(0, 48) : "") + "\uFF09\uFF0C\u4FDD\u7559\u4E0A\u4E00\u6B21\uFF0C\u7A0D\u540E\u91CD\u8BD5") : null,
          api.moodAiFailure ? h("div", { className: "dshp-growth-mood-note" }, "\u4E0A\u6B21\u6A21\u578B\u5FC3\u60C5\u5931\u8D25\uFF1A" + moodFailureText) : null,
          h(
            "div",
            { className: "dshp-growth-mood-controls" },
            h("span", { className: "dshp-growth-mood-control-label" }, "\u5FC3\u60C5\u6362\u88C5"),
            switchNode(settings.mood === true, () => {
              if (api.updateSettings) api.updateSettings({ mood: !settings.mood });
            }, "\u5FC3\u60C5\u6362\u88C5\u5F00\u5173"),
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.refreshMoodNow) api.refreshMoodNow();
            } }, "\u5237\u65B0\u5FC3\u60C5")
          )
        ),
        h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u5185\u5728\u72B6\u6001"),
          status && status.sleeping ? h("div", { className: "dshp-growth-sleep" }, "\u7761\u7720\u4E2D" + (status.sleepSince ? " \xB7 \u81EA " + weatherUpdatedLabel(status.sleepSince) : "")) : null,
          growthMetricsTree(status)
        ),
        status && status.project ? h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u6B63\u5728\u505A\u7684\u4E8B"),
          h("div", { className: "dshp-growth-quote" }, status.project.title + (status.project.note ? " \xB7 " + status.project.note : "")),
          status.project.stage ? h("div", { className: "dshp-growth-empty" }, "\u9636\u6BB5\uFF1A" + ({ working: "\u6B63\u5728\u505A", waiting_user: "\u7B49\u4F60\u56DE\u7B54", waiting_mirror: "\u7B49\u955C\u50CF\u56DE\u4FE1", blocked: "\u5361\u4F4F\u4E86", idle: "\u6682\u65F6\u4E0D\u52A8" }[status.project.stage] || status.project.stage)) : null,
          status.project.latestReport ? h("div", { className: "dshp-growth-empty" }, "\u6700\u8FD1\u4E00\u6B21\uFF1A" + status.project.latestReport.state + (status.project.latestReport.summary ? " \xB7 " + status.project.latestReport.summary : "")) : null,
          status.project.latestRepeat > 1 ? h("div", { className: "dshp-growth-empty", style: { color: "#b58a4a" } }, "\u6700\u8FD1\u8FD9\u6B65\u91CD\u590D\u4E86 " + status.project.latestRepeat + " \u6B21" + (status.project.progressAt ? "\uFF0C\u4E0A\u6B21\u771F\u6B63\u63A8\u8FDB\u5728 " + (weatherUpdatedLabel(status.project.progressAt) || "--:--") : "") + "\uFF0C\u8FD8\u6CA1\u6709\u65B0\u8FDB\u5C55") : null,
          status.project.attention && status.project.attention.question ? h("div", { className: "dshp-growth-quote", style: { color: "#b58a4a" } }, "\u7B49\u4F60\u51B3\u5B9A\uFF1A" + status.project.attention.question) : null,
          ...status.project.steps.map((step, index2) => h("div", { className: "dshp-growth-empty", key: "project-step-" + index2 }, (weatherUpdatedLabel(step.at) || "--:--") + " \xB7 " + step.text + (step.repeatCount > 1 ? " \xD7" + step.repeatCount : ""))),
          h(
            "div",
            { style: { display: "flex", gap: 6, marginTop: 6 } },
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.loadProjectDetail) api.loadProjectDetail();
            } }, "\u8BE6\u60C5"),
            status.project.stage === "working" ? h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.projectAction) api.projectAction("pause");
            } }, "\u6682\u505C") : status.project.stage === "waiting_user" ? null : h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.projectAction) api.projectAction("retry");
            } }, "\u7EE7\u7EED"),
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              if (api.projectAction && (typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm("\u786E\u5B9A\u653E\u4E0B\u8FD9\u4E2A\u9879\u76EE\u5417\uFF1F"))) api.projectAction("drop");
            } }, "\u653E\u5F03")
          )
        ) : null,
        api.projectDetail && api.projectDetail.ok ? h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u9879\u76EE\u8BE6\u60C5"),
          (Array.isArray(api.projectDetail.steps) ? api.projectDetail.steps : []).slice(-8).map((step, index2) => h(
            "div",
            { className: "dshp-growth-empty", key: "detail-step-" + index2 },
            (weatherUpdatedLabel(step.at) || "--:--") + " \xB7 " + String(step.text || "") + (step.repeatCount > 1 ? " \xD7" + step.repeatCount : "") + (step.report ? "\uFF08" + step.report + "\uFF09" : "")
          )),
          api.projectDetail.completed && api.projectDetail.completed.length ? h("div", { className: "dshp-growth-empty" }, "\u4EE5\u524D\u505A\u8FC7\u7684\uFF1A" + api.projectDetail.completed.map((item) => String(item.title || "")).join("\u3001")) : null
        ) : null,
        api.twinRes && api.twinRes.data && api.twinRes.data.project ? h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u955C\u50CF\u5728\u505A\u4EC0\u4E48"),
          h("div", { className: "dshp-growth-quote" }, api.twinRes.data.project.title + " \xB7 " + ({ working: "\u6B63\u5728\u505A", waiting_user: "\u7B49\u4E3B\u4EBA\u56DE\u7B54", waiting_mirror: "\u7B49\u539F\u4F53\u56DE\u4FE1", blocked: "\u5361\u4F4F\u4E86", idle: "\u6682\u65F6\u4E0D\u52A8" }[api.twinRes.data.project.stage] || api.twinRes.data.project.stage)),
          api.twinRes.data.project.question ? h("div", { className: "dshp-growth-empty" }, "\u5979\u5728\u7B49\uFF1A" + api.twinRes.data.project.question) : null
        ) : null,
        h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u81EA\u4E3B\u884C\u4E3A"),
          recentActions.length ? recentActions.map((item, index2) => h(
            "div",
            { className: "dshp-growth-action", key: "action-" + (item.id || index2) },
            h("span", { className: "dshp-growth-action-time" }, weatherUpdatedLabel(item.at) || "--:--"),
            h("span", { className: "dshp-growth-action-text" }, (item.label ? item.label + " \xB7 " : "") + String(item.text || ""))
          )) : h("div", { className: "dshp-growth-empty" }, "\u8FD8\u6CA1\u6709\u81EA\u5DF1\u884C\u52A8")
        ),
        memory ? h(
          "div",
          { className: "dshp-growth-section dshp-memory-card" },
          h(
            "div",
            { className: "dshp-memory-head" },
            h("div", { className: "dshp-growth-section-head" }, "\u8BB0\u5FC6\u4E2D\u67A2"),
            h("span", { className: cx("dshp-memory-health", "dshp-memory-" + memory.health) }, memoryLabels[memory.health] || "\u6CE8\u610F")
          ),
          h("div", { className: "dshp-memory-line" }, "journal " + memory.journal + " \u6761 \xB7 \u8BDD\u9898 " + memory.topics + " \u6761 \xB7 \u5B66\u4E60 " + memory.learnings + " \u6761"),
          h("div", { className: "dshp-memory-line" }, "\u4E0A\u6B21\u5907\u4EFD " + (weatherUpdatedLabel(memory.backups.lastAt) || "\u2014")),
          memory.recovered ? h("div", { className: "dshp-memory-line dshp-memory-recovered" }, "\u5DF2\u4ECE\u5907\u4EFD\u6062\u590D " + memory.recovered + " \u4E2A\u6587\u4EF6") : null,
          h(
            "div",
            { className: "dshp-growth-actions" },
            h("button", {
              type: "button",
              className: "dshp-btn dshp-btn-small",
              onClick: () => {
                if (api.backupMemory) api.backupMemory();
              }
            }, "\u7ACB\u5373\u5907\u4EFD")
          )
        ) : null,
        works.length ? h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u6211\u7684\u4F5C\u54C1"),
          works.map((work, index2) => h(
            "div",
            { className: "dshp-work", key: "work-" + (work.id || index2) },
            h("div", { className: "dshp-work-title" }, work.title),
            (work.kind === "svg" || work.kind === "image") && work.src ? h("img", { className: "dshp-work-art", src: work.src, alt: work.title, loading: "lazy" }) : work.kind === "video" && work.src ? h("video", { className: "dshp-work-art", src: work.src, controls: true, playsInline: true, preload: "metadata" }) : h("div", { className: "dshp-growth-quote" }, work.body),
            h("div", { className: "dshp-work-time" }, weatherUpdatedLabel(work.createdAt) || "--:--")
          ))
        ) : null,
        h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u6700\u8FD1\u8BF4\u8FC7\u7684\u8BDD"),
          recent.length ? recent.map((text, index2) => h("div", { className: "dshp-growth-quote", key: "recent-" + index2 }, "\u300C" + String(text) + "\u300D")) : h("div", { className: "dshp-growth-empty" }, "\u8FD8\u6CA1\u5F00\u53E3")
        ),
        h(
          "div",
          { className: "dshp-growth-section" },
          h("div", { className: "dshp-growth-section-head" }, "\u6210\u957F\u6458\u8981"),
          h("div", { className: "dshp-self-summary" }, selfStatusSummary(status) || "\u5C1A\u672A\u5F00\u59CB")
        ),
        h(
          "div",
          { className: "dshp-growth-actions" },
          h("button", { type: "button", className: "dshp-btn dshp-btn-primary", onClick: () => sayButton() }, "\u8BF4\u4E00\u53E5"),
          api.poetryEntryEnabled === true ? h("button", { type: "button", className: "dshp-btn", onClick: () => {
            if (api.openPoetryModule) api.openPoetryModule();
          } }, "\u8BD7\u8BCD\u6A21\u5757") : null,
          h("button", { type: "button", className: "dshp-btn", onClick: () => {
            if (api.openSettings) api.openSettings();
          } }, "\u8BBE\u7F6E")
        )
      );
    }
    return GrowthTab;
  }

  // node_modules/d3-quadtree/dist/d3-quadtree.mjs
  function tree_add(d) {
    const x = +this._x.call(null, d), y = +this._y.call(null, d);
    return add(this.cover(x, y), x, y, d);
  }
  function add(tree, x, y, d) {
    if (isNaN(x) || isNaN(y)) return tree;
    var parent, node = tree._root, leaf = { data: d }, x0 = tree._x0, y0 = tree._y0, x1 = tree._x1, y1 = tree._y1, xm, ym, xp, yp, right, bottom, i, j;
    if (!node) return tree._root = leaf, tree;
    while (node.length) {
      if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm;
      else x1 = xm;
      if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym;
      else y1 = ym;
      if (parent = node, !(node = node[i = bottom << 1 | right])) return parent[i] = leaf, tree;
    }
    xp = +tree._x.call(null, node.data);
    yp = +tree._y.call(null, node.data);
    if (x === xp && y === yp) return leaf.next = node, parent ? parent[i] = leaf : tree._root = leaf, tree;
    do {
      parent = parent ? parent[i] = new Array(4) : tree._root = new Array(4);
      if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm;
      else x1 = xm;
      if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym;
      else y1 = ym;
    } while ((i = bottom << 1 | right) === (j = (yp >= ym) << 1 | xp >= xm));
    return parent[j] = node, parent[i] = leaf, tree;
  }
  function addAll(data) {
    if (!Array.isArray(data)) data = Array.from(data);
    const n = data.length;
    const xz = new Float64Array(n);
    const yz = new Float64Array(n);
    let x0 = Infinity, y0 = x0, x1 = -x0, y1 = x1;
    for (let i = 0, d, x, y; i < n; ++i) {
      if (isNaN(x = +this._x.call(null, d = data[i])) || isNaN(y = +this._y.call(null, d))) {
        xz[i] = NaN;
        continue;
      }
      xz[i] = x;
      yz[i] = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x0 > x1 || y0 > y1) return this;
    this.cover(x0, y0).cover(x1, y1);
    for (let i = 0; i < n; ++i) {
      add(this, xz[i], yz[i], data[i]);
    }
    return this;
  }
  function tree_cover(x, y) {
    if (isNaN(x = +x) || isNaN(y = +y)) return this;
    var x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1;
    if (isNaN(x0)) {
      x1 = (x0 = Math.floor(x)) + 1;
      y1 = (y0 = Math.floor(y)) + 1;
    } else {
      var z = x1 - x0 || 1, node = this._root, parent, i;
      while (x0 > x || x >= x1 || y0 > y || y >= y1) {
        i = (y < y0) << 1 | x < x0;
        parent = new Array(4), parent[i] = node, node = parent, z *= 2;
        switch (i) {
          case 0:
            x1 = x0 + z, y1 = y0 + z;
            break;
          case 1:
            x0 = x1 - z, y1 = y0 + z;
            break;
          case 2:
            x1 = x0 + z, y0 = y1 - z;
            break;
          case 3:
            x0 = x1 - z, y0 = y1 - z;
            break;
        }
      }
      if (this._root && this._root.length) this._root = node;
    }
    this._x0 = x0;
    this._y0 = y0;
    this._x1 = x1;
    this._y1 = y1;
    return this;
  }
  function tree_data() {
    var data = [];
    this.visit(function(node) {
      if (!node.length) do
        data.push(node.data);
      while (node = node.next);
    });
    return data;
  }
  function tree_extent(_) {
    return arguments.length ? this.cover(+_[0][0], +_[0][1]).cover(+_[1][0], +_[1][1]) : isNaN(this._x0) ? void 0 : [[this._x0, this._y0], [this._x1, this._y1]];
  }
  function Quad(node, x0, y0, x1, y1) {
    this.node = node;
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }
  function tree_find(x, y, radius) {
    var data, x0 = this._x0, y0 = this._y0, x1, y1, x2, y2, x3 = this._x1, y3 = this._y1, quads = [], node = this._root, q, i;
    if (node) quads.push(new Quad(node, x0, y0, x3, y3));
    if (radius == null) radius = Infinity;
    else {
      x0 = x - radius, y0 = y - radius;
      x3 = x + radius, y3 = y + radius;
      radius *= radius;
    }
    while (q = quads.pop()) {
      if (!(node = q.node) || (x1 = q.x0) > x3 || (y1 = q.y0) > y3 || (x2 = q.x1) < x0 || (y2 = q.y1) < y0) continue;
      if (node.length) {
        var xm = (x1 + x2) / 2, ym = (y1 + y2) / 2;
        quads.push(
          new Quad(node[3], xm, ym, x2, y2),
          new Quad(node[2], x1, ym, xm, y2),
          new Quad(node[1], xm, y1, x2, ym),
          new Quad(node[0], x1, y1, xm, ym)
        );
        if (i = (y >= ym) << 1 | x >= xm) {
          q = quads[quads.length - 1];
          quads[quads.length - 1] = quads[quads.length - 1 - i];
          quads[quads.length - 1 - i] = q;
        }
      } else {
        var dx = x - +this._x.call(null, node.data), dy = y - +this._y.call(null, node.data), d2 = dx * dx + dy * dy;
        if (d2 < radius) {
          var d = Math.sqrt(radius = d2);
          x0 = x - d, y0 = y - d;
          x3 = x + d, y3 = y + d;
          data = node.data;
        }
      }
    }
    return data;
  }
  function tree_remove(d) {
    if (isNaN(x = +this._x.call(null, d)) || isNaN(y = +this._y.call(null, d))) return this;
    var parent, node = this._root, retainer, previous, next, x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1, x, y, xm, ym, right, bottom, i, j;
    if (!node) return this;
    if (node.length) while (true) {
      if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm;
      else x1 = xm;
      if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym;
      else y1 = ym;
      if (!(parent = node, node = node[i = bottom << 1 | right])) return this;
      if (!node.length) break;
      if (parent[i + 1 & 3] || parent[i + 2 & 3] || parent[i + 3 & 3]) retainer = parent, j = i;
    }
    while (node.data !== d) if (!(previous = node, node = node.next)) return this;
    if (next = node.next) delete node.next;
    if (previous) return next ? previous.next = next : delete previous.next, this;
    if (!parent) return this._root = next, this;
    next ? parent[i] = next : delete parent[i];
    if ((node = parent[0] || parent[1] || parent[2] || parent[3]) && node === (parent[3] || parent[2] || parent[1] || parent[0]) && !node.length) {
      if (retainer) retainer[j] = node;
      else this._root = node;
    }
    return this;
  }
  function removeAll(data) {
    for (var i = 0, n = data.length; i < n; ++i) this.remove(data[i]);
    return this;
  }
  function tree_root() {
    return this._root;
  }
  function tree_size() {
    var size = 0;
    this.visit(function(node) {
      if (!node.length) do
        ++size;
      while (node = node.next);
    });
    return size;
  }
  function tree_visit(callback) {
    var quads = [], q, node = this._root, child, x0, y0, x1, y1;
    if (node) quads.push(new Quad(node, this._x0, this._y0, this._x1, this._y1));
    while (q = quads.pop()) {
      if (!callback(node = q.node, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1) && node.length) {
        var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
        if (child = node[3]) quads.push(new Quad(child, xm, ym, x1, y1));
        if (child = node[2]) quads.push(new Quad(child, x0, ym, xm, y1));
        if (child = node[1]) quads.push(new Quad(child, xm, y0, x1, ym));
        if (child = node[0]) quads.push(new Quad(child, x0, y0, xm, ym));
      }
    }
    return this;
  }
  function tree_visitAfter(callback) {
    var quads = [], next = [], q;
    if (this._root) quads.push(new Quad(this._root, this._x0, this._y0, this._x1, this._y1));
    while (q = quads.pop()) {
      var node = q.node;
      if (node.length) {
        var child, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
        if (child = node[0]) quads.push(new Quad(child, x0, y0, xm, ym));
        if (child = node[1]) quads.push(new Quad(child, xm, y0, x1, ym));
        if (child = node[2]) quads.push(new Quad(child, x0, ym, xm, y1));
        if (child = node[3]) quads.push(new Quad(child, xm, ym, x1, y1));
      }
      next.push(q);
    }
    while (q = next.pop()) {
      callback(q.node, q.x0, q.y0, q.x1, q.y1);
    }
    return this;
  }
  function defaultX(d) {
    return d[0];
  }
  function tree_x(_) {
    return arguments.length ? (this._x = _, this) : this._x;
  }
  function defaultY(d) {
    return d[1];
  }
  function tree_y(_) {
    return arguments.length ? (this._y = _, this) : this._y;
  }
  function quadtree(nodes, x, y) {
    var tree = new Quadtree(x == null ? defaultX : x, y == null ? defaultY : y, NaN, NaN, NaN, NaN);
    return nodes == null ? tree : tree.addAll(nodes);
  }
  function Quadtree(x, y, x0, y0, x1, y1) {
    this._x = x;
    this._y = y;
    this._x0 = x0;
    this._y0 = y0;
    this._x1 = x1;
    this._y1 = y1;
    this._root = void 0;
  }
  function leaf_copy(leaf) {
    var copy = { data: leaf.data }, next = copy;
    while (leaf = leaf.next) next = next.next = { data: leaf.data };
    return copy;
  }
  var treeProto = quadtree.prototype = Quadtree.prototype;
  treeProto.copy = function() {
    var copy = new Quadtree(this._x, this._y, this._x0, this._y0, this._x1, this._y1), node = this._root, nodes, child;
    if (!node) return copy;
    if (!node.length) return copy._root = leaf_copy(node), copy;
    nodes = [{ source: node, target: copy._root = new Array(4) }];
    while (node = nodes.pop()) {
      for (var i = 0; i < 4; ++i) {
        if (child = node.source[i]) {
          if (child.length) nodes.push({ source: child, target: node.target[i] = new Array(4) });
          else node.target[i] = leaf_copy(child);
        }
      }
    }
    return copy;
  };
  treeProto.add = tree_add;
  treeProto.addAll = addAll;
  treeProto.cover = tree_cover;
  treeProto.data = tree_data;
  treeProto.extent = tree_extent;
  treeProto.find = tree_find;
  treeProto.remove = tree_remove;
  treeProto.removeAll = removeAll;
  treeProto.root = tree_root;
  treeProto.size = tree_size;
  treeProto.visit = tree_visit;
  treeProto.visitAfter = tree_visitAfter;
  treeProto.x = tree_x;
  treeProto.y = tree_y;

  // node_modules/d3-dispatch/dist/d3-dispatch.mjs
  var noop = { value: () => {
  } };
  function dispatch() {
    for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
      if (!(t = arguments[i] + "") || t in _ || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
      _[t] = [];
    }
    return new Dispatch(_);
  }
  function Dispatch(_) {
    this._ = _;
  }
  function parseTypenames(typenames, types) {
    return typenames.trim().split(/^|\s+/).map(function(t) {
      var name = "", i = t.indexOf(".");
      if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
      if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
      return { type: t, name };
    });
  }
  Dispatch.prototype = dispatch.prototype = {
    constructor: Dispatch,
    on: function(typename, callback) {
      var _ = this._, T = parseTypenames(typename + "", _), t, i = -1, n = T.length;
      if (arguments.length < 2) {
        while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
        return;
      }
      if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
      while (++i < n) {
        if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
        else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
      }
      return this;
    },
    copy: function() {
      var copy = {}, _ = this._;
      for (var t in _) copy[t] = _[t].slice();
      return new Dispatch(copy);
    },
    call: function(type, that) {
      if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
      if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
      for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
    },
    apply: function(type, that, args) {
      if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
      for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
    }
  };
  function get(type, name) {
    for (var i = 0, n = type.length, c2; i < n; ++i) {
      if ((c2 = type[i]).name === name) {
        return c2.value;
      }
    }
  }
  function set(type, name, callback) {
    for (var i = 0, n = type.length; i < n; ++i) {
      if (type[i].name === name) {
        type[i] = noop, type = type.slice(0, i).concat(type.slice(i + 1));
        break;
      }
    }
    if (callback != null) type.push({ name, value: callback });
    return type;
  }

  // node_modules/d3-timer/dist/d3-timer.mjs
  var frame = 0;
  var timeout$1 = 0;
  var interval$1 = 0;
  var pokeDelay = 1e3;
  var taskHead;
  var taskTail;
  var clockLast = 0;
  var clockNow = 0;
  var clockSkew = 0;
  var clock = typeof performance === "object" && performance.now ? performance : Date;
  var setFrame = typeof window === "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(f) {
    setTimeout(f, 17);
  };
  function now() {
    return clockNow || (setFrame(clearNow), clockNow = clock.now() + clockSkew);
  }
  function clearNow() {
    clockNow = 0;
  }
  function Timer() {
    this._call = this._time = this._next = null;
  }
  Timer.prototype = timer.prototype = {
    constructor: Timer,
    restart: function(callback, delay, time) {
      if (typeof callback !== "function") throw new TypeError("callback is not a function");
      time = (time == null ? now() : +time) + (delay == null ? 0 : +delay);
      if (!this._next && taskTail !== this) {
        if (taskTail) taskTail._next = this;
        else taskHead = this;
        taskTail = this;
      }
      this._call = callback;
      this._time = time;
      sleep();
    },
    stop: function() {
      if (this._call) {
        this._call = null;
        this._time = Infinity;
        sleep();
      }
    }
  };
  function timer(callback, delay, time) {
    var t = new Timer();
    t.restart(callback, delay, time);
    return t;
  }
  function timerFlush() {
    now();
    ++frame;
    var t = taskHead, e;
    while (t) {
      if ((e = clockNow - t._time) >= 0) t._call.call(void 0, e);
      t = t._next;
    }
    --frame;
  }
  function wake() {
    clockNow = (clockLast = clock.now()) + clockSkew;
    frame = timeout$1 = 0;
    try {
      timerFlush();
    } finally {
      frame = 0;
      nap();
      clockNow = 0;
    }
  }
  function poke() {
    var now2 = clock.now(), delay = now2 - clockLast;
    if (delay > pokeDelay) clockSkew -= delay, clockLast = now2;
  }
  function nap() {
    var t02, t12 = taskHead, t22, time = Infinity;
    while (t12) {
      if (t12._call) {
        if (time > t12._time) time = t12._time;
        t02 = t12, t12 = t12._next;
      } else {
        t22 = t12._next, t12._next = null;
        t12 = t02 ? t02._next = t22 : taskHead = t22;
      }
    }
    taskTail = t02;
    sleep(time);
  }
  function sleep(time) {
    if (frame) return;
    if (timeout$1) timeout$1 = clearTimeout(timeout$1);
    var delay = time - clockNow;
    if (delay > 24) {
      if (time < Infinity) timeout$1 = setTimeout(wake, Math.ceil(time - clock.now() - clockSkew) + 1);
      if (interval$1) interval$1 = clearInterval(interval$1);
    } else {
      if (!interval$1) clockLast = clock.now(), interval$1 = setInterval(poke, pokeDelay);
      frame = 1, setFrame(wake);
    }
  }
  function timeout(callback, delay, time) {
    var t = new Timer();
    delay = delay == null ? 0 : +delay;
    t.restart((elapsed) => {
      t.stop();
      callback(elapsed + delay);
    }, delay, time);
    return t;
  }

  // node_modules/d3-force/dist/d3-force.mjs
  function center(x, y) {
    var nodes, strength = 1;
    if (x == null) x = 0;
    if (y == null) y = 0;
    function force() {
      var i, n = nodes.length, node, sx = 0, sy = 0;
      for (i = 0; i < n; ++i) {
        node = nodes[i], sx += node.x, sy += node.y;
      }
      for (sx = (sx / n - x) * strength, sy = (sy / n - y) * strength, i = 0; i < n; ++i) {
        node = nodes[i], node.x -= sx, node.y -= sy;
      }
    }
    force.initialize = function(_) {
      nodes = _;
    };
    force.x = function(_) {
      return arguments.length ? (x = +_, force) : x;
    };
    force.y = function(_) {
      return arguments.length ? (y = +_, force) : y;
    };
    force.strength = function(_) {
      return arguments.length ? (strength = +_, force) : strength;
    };
    return force;
  }
  function constant(x) {
    return function() {
      return x;
    };
  }
  function jiggle(random) {
    return (random() - 0.5) * 1e-6;
  }
  function x$2(d) {
    return d.x + d.vx;
  }
  function y$2(d) {
    return d.y + d.vy;
  }
  function collide(radius) {
    var nodes, radii, random, strength = 1, iterations = 1;
    if (typeof radius !== "function") radius = constant(radius == null ? 1 : +radius);
    function force() {
      var i, n = nodes.length, tree, node, xi, yi, ri, ri2;
      for (var k = 0; k < iterations; ++k) {
        tree = quadtree(nodes, x$2, y$2).visitAfter(prepare);
        for (i = 0; i < n; ++i) {
          node = nodes[i];
          ri = radii[node.index], ri2 = ri * ri;
          xi = node.x + node.vx;
          yi = node.y + node.vy;
          tree.visit(apply);
        }
      }
      function apply(quad, x0, y0, x1, y1) {
        var data = quad.data, rj = quad.r, r = ri + rj;
        if (data) {
          if (data.index > node.index) {
            var x = xi - data.x - data.vx, y = yi - data.y - data.vy, l = x * x + y * y;
            if (l < r * r) {
              if (x === 0) x = jiggle(random), l += x * x;
              if (y === 0) y = jiggle(random), l += y * y;
              l = (r - (l = Math.sqrt(l))) / l * strength;
              node.vx += (x *= l) * (r = (rj *= rj) / (ri2 + rj));
              node.vy += (y *= l) * r;
              data.vx -= x * (r = 1 - r);
              data.vy -= y * r;
            }
          }
          return;
        }
        return x0 > xi + r || x1 < xi - r || y0 > yi + r || y1 < yi - r;
      }
    }
    function prepare(quad) {
      if (quad.data) return quad.r = radii[quad.data.index];
      for (var i = quad.r = 0; i < 4; ++i) {
        if (quad[i] && quad[i].r > quad.r) {
          quad.r = quad[i].r;
        }
      }
    }
    function initialize() {
      if (!nodes) return;
      var i, n = nodes.length, node;
      radii = new Array(n);
      for (i = 0; i < n; ++i) node = nodes[i], radii[node.index] = +radius(node, i, nodes);
    }
    force.initialize = function(_nodes, _random) {
      nodes = _nodes;
      random = _random;
      initialize();
    };
    force.iterations = function(_) {
      return arguments.length ? (iterations = +_, force) : iterations;
    };
    force.strength = function(_) {
      return arguments.length ? (strength = +_, force) : strength;
    };
    force.radius = function(_) {
      return arguments.length ? (radius = typeof _ === "function" ? _ : constant(+_), initialize(), force) : radius;
    };
    return force;
  }
  function index(d) {
    return d.index;
  }
  function find(nodeById, nodeId) {
    var node = nodeById.get(nodeId);
    if (!node) throw new Error("node not found: " + nodeId);
    return node;
  }
  function link(links) {
    var id2 = index, strength = defaultStrength, strengths, distance = constant(30), distances, nodes, count, bias, random, iterations = 1;
    if (links == null) links = [];
    function defaultStrength(link2) {
      return 1 / Math.min(count[link2.source.index], count[link2.target.index]);
    }
    function force(alpha) {
      for (var k = 0, n = links.length; k < iterations; ++k) {
        for (var i = 0, link2, source, target, x, y, l, b; i < n; ++i) {
          link2 = links[i], source = link2.source, target = link2.target;
          x = target.x + target.vx - source.x - source.vx || jiggle(random);
          y = target.y + target.vy - source.y - source.vy || jiggle(random);
          l = Math.sqrt(x * x + y * y);
          l = (l - distances[i]) / l * alpha * strengths[i];
          x *= l, y *= l;
          target.vx -= x * (b = bias[i]);
          target.vy -= y * b;
          source.vx += x * (b = 1 - b);
          source.vy += y * b;
        }
      }
    }
    function initialize() {
      if (!nodes) return;
      var i, n = nodes.length, m2 = links.length, nodeById = new Map(nodes.map((d, i2) => [id2(d, i2, nodes), d])), link2;
      for (i = 0, count = new Array(n); i < m2; ++i) {
        link2 = links[i], link2.index = i;
        if (typeof link2.source !== "object") link2.source = find(nodeById, link2.source);
        if (typeof link2.target !== "object") link2.target = find(nodeById, link2.target);
        count[link2.source.index] = (count[link2.source.index] || 0) + 1;
        count[link2.target.index] = (count[link2.target.index] || 0) + 1;
      }
      for (i = 0, bias = new Array(m2); i < m2; ++i) {
        link2 = links[i], bias[i] = count[link2.source.index] / (count[link2.source.index] + count[link2.target.index]);
      }
      strengths = new Array(m2), initializeStrength();
      distances = new Array(m2), initializeDistance();
    }
    function initializeStrength() {
      if (!nodes) return;
      for (var i = 0, n = links.length; i < n; ++i) {
        strengths[i] = +strength(links[i], i, links);
      }
    }
    function initializeDistance() {
      if (!nodes) return;
      for (var i = 0, n = links.length; i < n; ++i) {
        distances[i] = +distance(links[i], i, links);
      }
    }
    force.initialize = function(_nodes, _random) {
      nodes = _nodes;
      random = _random;
      initialize();
    };
    force.links = function(_) {
      return arguments.length ? (links = _, initialize(), force) : links;
    };
    force.id = function(_) {
      return arguments.length ? (id2 = _, force) : id2;
    };
    force.iterations = function(_) {
      return arguments.length ? (iterations = +_, force) : iterations;
    };
    force.strength = function(_) {
      return arguments.length ? (strength = typeof _ === "function" ? _ : constant(+_), initializeStrength(), force) : strength;
    };
    force.distance = function(_) {
      return arguments.length ? (distance = typeof _ === "function" ? _ : constant(+_), initializeDistance(), force) : distance;
    };
    return force;
  }
  var a = 1664525;
  var c = 1013904223;
  var m = 4294967296;
  function lcg() {
    let s = 1;
    return () => (s = (a * s + c) % m) / m;
  }
  function x$1(d) {
    return d.x;
  }
  function y$1(d) {
    return d.y;
  }
  var initialRadius = 10;
  var initialAngle = Math.PI * (3 - Math.sqrt(5));
  function simulation(nodes) {
    var simulation2, alpha = 1, alphaMin = 1e-3, alphaDecay = 1 - Math.pow(alphaMin, 1 / 300), alphaTarget = 0, velocityDecay = 0.6, forces = /* @__PURE__ */ new Map(), stepper = timer(step), event = dispatch("tick", "end"), random = lcg();
    if (nodes == null) nodes = [];
    function step() {
      tick();
      event.call("tick", simulation2);
      if (alpha < alphaMin) {
        stepper.stop();
        event.call("end", simulation2);
      }
    }
    function tick(iterations) {
      var i, n = nodes.length, node;
      if (iterations === void 0) iterations = 1;
      for (var k = 0; k < iterations; ++k) {
        alpha += (alphaTarget - alpha) * alphaDecay;
        forces.forEach(function(force) {
          force(alpha);
        });
        for (i = 0; i < n; ++i) {
          node = nodes[i];
          if (node.fx == null) node.x += node.vx *= velocityDecay;
          else node.x = node.fx, node.vx = 0;
          if (node.fy == null) node.y += node.vy *= velocityDecay;
          else node.y = node.fy, node.vy = 0;
        }
      }
      return simulation2;
    }
    function initializeNodes() {
      for (var i = 0, n = nodes.length, node; i < n; ++i) {
        node = nodes[i], node.index = i;
        if (node.fx != null) node.x = node.fx;
        if (node.fy != null) node.y = node.fy;
        if (isNaN(node.x) || isNaN(node.y)) {
          var radius = initialRadius * Math.sqrt(0.5 + i), angle = i * initialAngle;
          node.x = radius * Math.cos(angle);
          node.y = radius * Math.sin(angle);
        }
        if (isNaN(node.vx) || isNaN(node.vy)) {
          node.vx = node.vy = 0;
        }
      }
    }
    function initializeForce(force) {
      if (force.initialize) force.initialize(nodes, random);
      return force;
    }
    initializeNodes();
    return simulation2 = {
      tick,
      restart: function() {
        return stepper.restart(step), simulation2;
      },
      stop: function() {
        return stepper.stop(), simulation2;
      },
      nodes: function(_) {
        return arguments.length ? (nodes = _, initializeNodes(), forces.forEach(initializeForce), simulation2) : nodes;
      },
      alpha: function(_) {
        return arguments.length ? (alpha = +_, simulation2) : alpha;
      },
      alphaMin: function(_) {
        return arguments.length ? (alphaMin = +_, simulation2) : alphaMin;
      },
      alphaDecay: function(_) {
        return arguments.length ? (alphaDecay = +_, simulation2) : +alphaDecay;
      },
      alphaTarget: function(_) {
        return arguments.length ? (alphaTarget = +_, simulation2) : alphaTarget;
      },
      velocityDecay: function(_) {
        return arguments.length ? (velocityDecay = 1 - _, simulation2) : 1 - velocityDecay;
      },
      randomSource: function(_) {
        return arguments.length ? (random = _, forces.forEach(initializeForce), simulation2) : random;
      },
      force: function(name, _) {
        return arguments.length > 1 ? (_ == null ? forces.delete(name) : forces.set(name, initializeForce(_)), simulation2) : forces.get(name);
      },
      find: function(x, y, radius) {
        var i = 0, n = nodes.length, dx, dy, d2, node, closest;
        if (radius == null) radius = Infinity;
        else radius *= radius;
        for (i = 0; i < n; ++i) {
          node = nodes[i];
          dx = x - node.x;
          dy = y - node.y;
          d2 = dx * dx + dy * dy;
          if (d2 < radius) closest = node, radius = d2;
        }
        return closest;
      },
      on: function(name, _) {
        return arguments.length > 1 ? (event.on(name, _), simulation2) : event.on(name);
      }
    };
  }
  function manyBody() {
    var nodes, node, random, alpha, strength = constant(-30), strengths, distanceMin2 = 1, distanceMax2 = Infinity, theta2 = 0.81;
    function force(_) {
      var i, n = nodes.length, tree = quadtree(nodes, x$1, y$1).visitAfter(accumulate);
      for (alpha = _, i = 0; i < n; ++i) node = nodes[i], tree.visit(apply);
    }
    function initialize() {
      if (!nodes) return;
      var i, n = nodes.length, node2;
      strengths = new Array(n);
      for (i = 0; i < n; ++i) node2 = nodes[i], strengths[node2.index] = +strength(node2, i, nodes);
    }
    function accumulate(quad) {
      var strength2 = 0, q, c2, weight = 0, x, y, i;
      if (quad.length) {
        for (x = y = i = 0; i < 4; ++i) {
          if ((q = quad[i]) && (c2 = Math.abs(q.value))) {
            strength2 += q.value, weight += c2, x += c2 * q.x, y += c2 * q.y;
          }
        }
        quad.x = x / weight;
        quad.y = y / weight;
      } else {
        q = quad;
        q.x = q.data.x;
        q.y = q.data.y;
        do
          strength2 += strengths[q.data.index];
        while (q = q.next);
      }
      quad.value = strength2;
    }
    function apply(quad, x1, _, x2) {
      if (!quad.value) return true;
      var x = quad.x - node.x, y = quad.y - node.y, w = x2 - x1, l = x * x + y * y;
      if (w * w / theta2 < l) {
        if (l < distanceMax2) {
          if (x === 0) x = jiggle(random), l += x * x;
          if (y === 0) y = jiggle(random), l += y * y;
          if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
          node.vx += x * quad.value * alpha / l;
          node.vy += y * quad.value * alpha / l;
        }
        return true;
      } else if (quad.length || l >= distanceMax2) return;
      if (quad.data !== node || quad.next) {
        if (x === 0) x = jiggle(random), l += x * x;
        if (y === 0) y = jiggle(random), l += y * y;
        if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
      }
      do
        if (quad.data !== node) {
          w = strengths[quad.data.index] * alpha / l;
          node.vx += x * w;
          node.vy += y * w;
        }
      while (quad = quad.next);
    }
    force.initialize = function(_nodes, _random) {
      nodes = _nodes;
      random = _random;
      initialize();
    };
    force.strength = function(_) {
      return arguments.length ? (strength = typeof _ === "function" ? _ : constant(+_), initialize(), force) : strength;
    };
    force.distanceMin = function(_) {
      return arguments.length ? (distanceMin2 = _ * _, force) : Math.sqrt(distanceMin2);
    };
    force.distanceMax = function(_) {
      return arguments.length ? (distanceMax2 = _ * _, force) : Math.sqrt(distanceMax2);
    };
    force.theta = function(_) {
      return arguments.length ? (theta2 = _ * _, force) : Math.sqrt(theta2);
    };
    return force;
  }

  // node_modules/d3-selection/dist/d3-selection.mjs
  var xhtml = "http://www.w3.org/1999/xhtml";
  var namespaces = {
    svg: "http://www.w3.org/2000/svg",
    xhtml,
    xlink: "http://www.w3.org/1999/xlink",
    xml: "http://www.w3.org/XML/1998/namespace",
    xmlns: "http://www.w3.org/2000/xmlns/"
  };
  function namespace(name) {
    var prefix = name += "", i = prefix.indexOf(":");
    if (i >= 0 && (prefix = name.slice(0, i)) !== "xmlns") name = name.slice(i + 1);
    return namespaces.hasOwnProperty(prefix) ? { space: namespaces[prefix], local: name } : name;
  }
  function creatorInherit(name) {
    return function() {
      var document2 = this.ownerDocument, uri = this.namespaceURI;
      return uri === xhtml && document2.documentElement.namespaceURI === xhtml ? document2.createElement(name) : document2.createElementNS(uri, name);
    };
  }
  function creatorFixed(fullname) {
    return function() {
      return this.ownerDocument.createElementNS(fullname.space, fullname.local);
    };
  }
  function creator(name) {
    var fullname = namespace(name);
    return (fullname.local ? creatorFixed : creatorInherit)(fullname);
  }
  function none() {
  }
  function selector(selector2) {
    return selector2 == null ? none : function() {
      return this.querySelector(selector2);
    };
  }
  function selection_select(select2) {
    if (typeof select2 !== "function") select2 = selector(select2);
    for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
        if ((node = group[i]) && (subnode = select2.call(node, node.__data__, i, group))) {
          if ("__data__" in node) subnode.__data__ = node.__data__;
          subgroup[i] = subnode;
        }
      }
    }
    return new Selection(subgroups, this._parents);
  }
  function array(x) {
    return x == null ? [] : Array.isArray(x) ? x : Array.from(x);
  }
  function empty() {
    return [];
  }
  function selectorAll(selector2) {
    return selector2 == null ? empty : function() {
      return this.querySelectorAll(selector2);
    };
  }
  function arrayAll(select2) {
    return function() {
      return array(select2.apply(this, arguments));
    };
  }
  function selection_selectAll(select2) {
    if (typeof select2 === "function") select2 = arrayAll(select2);
    else select2 = selectorAll(select2);
    for (var groups = this._groups, m2 = groups.length, subgroups = [], parents = [], j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
        if (node = group[i]) {
          subgroups.push(select2.call(node, node.__data__, i, group));
          parents.push(node);
        }
      }
    }
    return new Selection(subgroups, parents);
  }
  function matcher(selector2) {
    return function() {
      return this.matches(selector2);
    };
  }
  function childMatcher(selector2) {
    return function(node) {
      return node.matches(selector2);
    };
  }
  var find2 = Array.prototype.find;
  function childFind(match) {
    return function() {
      return find2.call(this.children, match);
    };
  }
  function childFirst() {
    return this.firstElementChild;
  }
  function selection_selectChild(match) {
    return this.select(match == null ? childFirst : childFind(typeof match === "function" ? match : childMatcher(match)));
  }
  var filter = Array.prototype.filter;
  function children() {
    return Array.from(this.children);
  }
  function childrenFilter(match) {
    return function() {
      return filter.call(this.children, match);
    };
  }
  function selection_selectChildren(match) {
    return this.selectAll(match == null ? children : childrenFilter(typeof match === "function" ? match : childMatcher(match)));
  }
  function selection_filter(match) {
    if (typeof match !== "function") match = matcher(match);
    for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
        if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
          subgroup.push(node);
        }
      }
    }
    return new Selection(subgroups, this._parents);
  }
  function sparse(update) {
    return new Array(update.length);
  }
  function selection_enter() {
    return new Selection(this._enter || this._groups.map(sparse), this._parents);
  }
  function EnterNode(parent, datum2) {
    this.ownerDocument = parent.ownerDocument;
    this.namespaceURI = parent.namespaceURI;
    this._next = null;
    this._parent = parent;
    this.__data__ = datum2;
  }
  EnterNode.prototype = {
    constructor: EnterNode,
    appendChild: function(child) {
      return this._parent.insertBefore(child, this._next);
    },
    insertBefore: function(child, next) {
      return this._parent.insertBefore(child, next);
    },
    querySelector: function(selector2) {
      return this._parent.querySelector(selector2);
    },
    querySelectorAll: function(selector2) {
      return this._parent.querySelectorAll(selector2);
    }
  };
  function constant2(x) {
    return function() {
      return x;
    };
  }
  function bindIndex(parent, group, enter, update, exit, data) {
    var i = 0, node, groupLength = group.length, dataLength = data.length;
    for (; i < dataLength; ++i) {
      if (node = group[i]) {
        node.__data__ = data[i];
        update[i] = node;
      } else {
        enter[i] = new EnterNode(parent, data[i]);
      }
    }
    for (; i < groupLength; ++i) {
      if (node = group[i]) {
        exit[i] = node;
      }
    }
  }
  function bindKey(parent, group, enter, update, exit, data, key) {
    var i, node, nodeByKeyValue = /* @__PURE__ */ new Map(), groupLength = group.length, dataLength = data.length, keyValues = new Array(groupLength), keyValue;
    for (i = 0; i < groupLength; ++i) {
      if (node = group[i]) {
        keyValues[i] = keyValue = key.call(node, node.__data__, i, group) + "";
        if (nodeByKeyValue.has(keyValue)) {
          exit[i] = node;
        } else {
          nodeByKeyValue.set(keyValue, node);
        }
      }
    }
    for (i = 0; i < dataLength; ++i) {
      keyValue = key.call(parent, data[i], i, data) + "";
      if (node = nodeByKeyValue.get(keyValue)) {
        update[i] = node;
        node.__data__ = data[i];
        nodeByKeyValue.delete(keyValue);
      } else {
        enter[i] = new EnterNode(parent, data[i]);
      }
    }
    for (i = 0; i < groupLength; ++i) {
      if ((node = group[i]) && nodeByKeyValue.get(keyValues[i]) === node) {
        exit[i] = node;
      }
    }
  }
  function datum(node) {
    return node.__data__;
  }
  function selection_data(value, key) {
    if (!arguments.length) return Array.from(this, datum);
    var bind = key ? bindKey : bindIndex, parents = this._parents, groups = this._groups;
    if (typeof value !== "function") value = constant2(value);
    for (var m2 = groups.length, update = new Array(m2), enter = new Array(m2), exit = new Array(m2), j = 0; j < m2; ++j) {
      var parent = parents[j], group = groups[j], groupLength = group.length, data = arraylike(value.call(parent, parent && parent.__data__, j, parents)), dataLength = data.length, enterGroup = enter[j] = new Array(dataLength), updateGroup = update[j] = new Array(dataLength), exitGroup = exit[j] = new Array(groupLength);
      bind(parent, group, enterGroup, updateGroup, exitGroup, data, key);
      for (var i0 = 0, i1 = 0, previous, next; i0 < dataLength; ++i0) {
        if (previous = enterGroup[i0]) {
          if (i0 >= i1) i1 = i0 + 1;
          while (!(next = updateGroup[i1]) && ++i1 < dataLength) ;
          previous._next = next || null;
        }
      }
    }
    update = new Selection(update, parents);
    update._enter = enter;
    update._exit = exit;
    return update;
  }
  function arraylike(data) {
    return typeof data === "object" && "length" in data ? data : Array.from(data);
  }
  function selection_exit() {
    return new Selection(this._exit || this._groups.map(sparse), this._parents);
  }
  function selection_join(onenter, onupdate, onexit) {
    var enter = this.enter(), update = this, exit = this.exit();
    if (typeof onenter === "function") {
      enter = onenter(enter);
      if (enter) enter = enter.selection();
    } else {
      enter = enter.append(onenter + "");
    }
    if (onupdate != null) {
      update = onupdate(update);
      if (update) update = update.selection();
    }
    if (onexit == null) exit.remove();
    else onexit(exit);
    return enter && update ? enter.merge(update).order() : update;
  }
  function selection_merge(context) {
    var selection2 = context.selection ? context.selection() : context;
    for (var groups0 = this._groups, groups1 = selection2._groups, m0 = groups0.length, m1 = groups1.length, m2 = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m2; ++j) {
      for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
        if (node = group0[i] || group1[i]) {
          merge[i] = node;
        }
      }
    }
    for (; j < m0; ++j) {
      merges[j] = groups0[j];
    }
    return new Selection(merges, this._parents);
  }
  function selection_order() {
    for (var groups = this._groups, j = -1, m2 = groups.length; ++j < m2; ) {
      for (var group = groups[j], i = group.length - 1, next = group[i], node; --i >= 0; ) {
        if (node = group[i]) {
          if (next && node.compareDocumentPosition(next) ^ 4) next.parentNode.insertBefore(node, next);
          next = node;
        }
      }
    }
    return this;
  }
  function selection_sort(compare) {
    if (!compare) compare = ascending;
    function compareNode(a2, b) {
      return a2 && b ? compare(a2.__data__, b.__data__) : !a2 - !b;
    }
    for (var groups = this._groups, m2 = groups.length, sortgroups = new Array(m2), j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, sortgroup = sortgroups[j] = new Array(n), node, i = 0; i < n; ++i) {
        if (node = group[i]) {
          sortgroup[i] = node;
        }
      }
      sortgroup.sort(compareNode);
    }
    return new Selection(sortgroups, this._parents).order();
  }
  function ascending(a2, b) {
    return a2 < b ? -1 : a2 > b ? 1 : a2 >= b ? 0 : NaN;
  }
  function selection_call() {
    var callback = arguments[0];
    arguments[0] = this;
    callback.apply(null, arguments);
    return this;
  }
  function selection_nodes() {
    return Array.from(this);
  }
  function selection_node() {
    for (var groups = this._groups, j = 0, m2 = groups.length; j < m2; ++j) {
      for (var group = groups[j], i = 0, n = group.length; i < n; ++i) {
        var node = group[i];
        if (node) return node;
      }
    }
    return null;
  }
  function selection_size() {
    let size = 0;
    for (const node of this) ++size;
    return size;
  }
  function selection_empty() {
    return !this.node();
  }
  function selection_each(callback) {
    for (var groups = this._groups, j = 0, m2 = groups.length; j < m2; ++j) {
      for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
        if (node = group[i]) callback.call(node, node.__data__, i, group);
      }
    }
    return this;
  }
  function attrRemove(name) {
    return function() {
      this.removeAttribute(name);
    };
  }
  function attrRemoveNS(fullname) {
    return function() {
      this.removeAttributeNS(fullname.space, fullname.local);
    };
  }
  function attrConstant(name, value) {
    return function() {
      this.setAttribute(name, value);
    };
  }
  function attrConstantNS(fullname, value) {
    return function() {
      this.setAttributeNS(fullname.space, fullname.local, value);
    };
  }
  function attrFunction(name, value) {
    return function() {
      var v = value.apply(this, arguments);
      if (v == null) this.removeAttribute(name);
      else this.setAttribute(name, v);
    };
  }
  function attrFunctionNS(fullname, value) {
    return function() {
      var v = value.apply(this, arguments);
      if (v == null) this.removeAttributeNS(fullname.space, fullname.local);
      else this.setAttributeNS(fullname.space, fullname.local, v);
    };
  }
  function selection_attr(name, value) {
    var fullname = namespace(name);
    if (arguments.length < 2) {
      var node = this.node();
      return fullname.local ? node.getAttributeNS(fullname.space, fullname.local) : node.getAttribute(fullname);
    }
    return this.each((value == null ? fullname.local ? attrRemoveNS : attrRemove : typeof value === "function" ? fullname.local ? attrFunctionNS : attrFunction : fullname.local ? attrConstantNS : attrConstant)(fullname, value));
  }
  function defaultView(node) {
    return node.ownerDocument && node.ownerDocument.defaultView || node.document && node || node.defaultView;
  }
  function styleRemove(name) {
    return function() {
      this.style.removeProperty(name);
    };
  }
  function styleConstant(name, value, priority) {
    return function() {
      this.style.setProperty(name, value, priority);
    };
  }
  function styleFunction(name, value, priority) {
    return function() {
      var v = value.apply(this, arguments);
      if (v == null) this.style.removeProperty(name);
      else this.style.setProperty(name, v, priority);
    };
  }
  function selection_style(name, value, priority) {
    return arguments.length > 1 ? this.each((value == null ? styleRemove : typeof value === "function" ? styleFunction : styleConstant)(name, value, priority == null ? "" : priority)) : styleValue(this.node(), name);
  }
  function styleValue(node, name) {
    return node.style.getPropertyValue(name) || defaultView(node).getComputedStyle(node, null).getPropertyValue(name);
  }
  function propertyRemove(name) {
    return function() {
      delete this[name];
    };
  }
  function propertyConstant(name, value) {
    return function() {
      this[name] = value;
    };
  }
  function propertyFunction(name, value) {
    return function() {
      var v = value.apply(this, arguments);
      if (v == null) delete this[name];
      else this[name] = v;
    };
  }
  function selection_property(name, value) {
    return arguments.length > 1 ? this.each((value == null ? propertyRemove : typeof value === "function" ? propertyFunction : propertyConstant)(name, value)) : this.node()[name];
  }
  function classArray(string2) {
    return string2.trim().split(/^|\s+/);
  }
  function classList(node) {
    return node.classList || new ClassList(node);
  }
  function ClassList(node) {
    this._node = node;
    this._names = classArray(node.getAttribute("class") || "");
  }
  ClassList.prototype = {
    add: function(name) {
      var i = this._names.indexOf(name);
      if (i < 0) {
        this._names.push(name);
        this._node.setAttribute("class", this._names.join(" "));
      }
    },
    remove: function(name) {
      var i = this._names.indexOf(name);
      if (i >= 0) {
        this._names.splice(i, 1);
        this._node.setAttribute("class", this._names.join(" "));
      }
    },
    contains: function(name) {
      return this._names.indexOf(name) >= 0;
    }
  };
  function classedAdd(node, names) {
    var list = classList(node), i = -1, n = names.length;
    while (++i < n) list.add(names[i]);
  }
  function classedRemove(node, names) {
    var list = classList(node), i = -1, n = names.length;
    while (++i < n) list.remove(names[i]);
  }
  function classedTrue(names) {
    return function() {
      classedAdd(this, names);
    };
  }
  function classedFalse(names) {
    return function() {
      classedRemove(this, names);
    };
  }
  function classedFunction(names, value) {
    return function() {
      (value.apply(this, arguments) ? classedAdd : classedRemove)(this, names);
    };
  }
  function selection_classed(name, value) {
    var names = classArray(name + "");
    if (arguments.length < 2) {
      var list = classList(this.node()), i = -1, n = names.length;
      while (++i < n) if (!list.contains(names[i])) return false;
      return true;
    }
    return this.each((typeof value === "function" ? classedFunction : value ? classedTrue : classedFalse)(names, value));
  }
  function textRemove() {
    this.textContent = "";
  }
  function textConstant(value) {
    return function() {
      this.textContent = value;
    };
  }
  function textFunction(value) {
    return function() {
      var v = value.apply(this, arguments);
      this.textContent = v == null ? "" : v;
    };
  }
  function selection_text(value) {
    return arguments.length ? this.each(value == null ? textRemove : (typeof value === "function" ? textFunction : textConstant)(value)) : this.node().textContent;
  }
  function htmlRemove() {
    this.innerHTML = "";
  }
  function htmlConstant(value) {
    return function() {
      this.innerHTML = value;
    };
  }
  function htmlFunction(value) {
    return function() {
      var v = value.apply(this, arguments);
      this.innerHTML = v == null ? "" : v;
    };
  }
  function selection_html(value) {
    return arguments.length ? this.each(value == null ? htmlRemove : (typeof value === "function" ? htmlFunction : htmlConstant)(value)) : this.node().innerHTML;
  }
  function raise() {
    if (this.nextSibling) this.parentNode.appendChild(this);
  }
  function selection_raise() {
    return this.each(raise);
  }
  function lower() {
    if (this.previousSibling) this.parentNode.insertBefore(this, this.parentNode.firstChild);
  }
  function selection_lower() {
    return this.each(lower);
  }
  function selection_append(name) {
    var create2 = typeof name === "function" ? name : creator(name);
    return this.select(function() {
      return this.appendChild(create2.apply(this, arguments));
    });
  }
  function constantNull() {
    return null;
  }
  function selection_insert(name, before) {
    var create2 = typeof name === "function" ? name : creator(name), select2 = before == null ? constantNull : typeof before === "function" ? before : selector(before);
    return this.select(function() {
      return this.insertBefore(create2.apply(this, arguments), select2.apply(this, arguments) || null);
    });
  }
  function remove() {
    var parent = this.parentNode;
    if (parent) parent.removeChild(this);
  }
  function selection_remove() {
    return this.each(remove);
  }
  function selection_cloneShallow() {
    var clone = this.cloneNode(false), parent = this.parentNode;
    return parent ? parent.insertBefore(clone, this.nextSibling) : clone;
  }
  function selection_cloneDeep() {
    var clone = this.cloneNode(true), parent = this.parentNode;
    return parent ? parent.insertBefore(clone, this.nextSibling) : clone;
  }
  function selection_clone(deep) {
    return this.select(deep ? selection_cloneDeep : selection_cloneShallow);
  }
  function selection_datum(value) {
    return arguments.length ? this.property("__data__", value) : this.node().__data__;
  }
  function contextListener(listener) {
    return function(event) {
      listener.call(this, event, this.__data__);
    };
  }
  function parseTypenames2(typenames) {
    return typenames.trim().split(/^|\s+/).map(function(t) {
      var name = "", i = t.indexOf(".");
      if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
      return { type: t, name };
    });
  }
  function onRemove(typename) {
    return function() {
      var on = this.__on;
      if (!on) return;
      for (var j = 0, i = -1, m2 = on.length, o; j < m2; ++j) {
        if (o = on[j], (!typename.type || o.type === typename.type) && o.name === typename.name) {
          this.removeEventListener(o.type, o.listener, o.options);
        } else {
          on[++i] = o;
        }
      }
      if (++i) on.length = i;
      else delete this.__on;
    };
  }
  function onAdd(typename, value, options) {
    return function() {
      var on = this.__on, o, listener = contextListener(value);
      if (on) for (var j = 0, m2 = on.length; j < m2; ++j) {
        if ((o = on[j]).type === typename.type && o.name === typename.name) {
          this.removeEventListener(o.type, o.listener, o.options);
          this.addEventListener(o.type, o.listener = listener, o.options = options);
          o.value = value;
          return;
        }
      }
      this.addEventListener(typename.type, listener, options);
      o = { type: typename.type, name: typename.name, value, listener, options };
      if (!on) this.__on = [o];
      else on.push(o);
    };
  }
  function selection_on(typename, value, options) {
    var typenames = parseTypenames2(typename + ""), i, n = typenames.length, t;
    if (arguments.length < 2) {
      var on = this.node().__on;
      if (on) for (var j = 0, m2 = on.length, o; j < m2; ++j) {
        for (i = 0, o = on[j]; i < n; ++i) {
          if ((t = typenames[i]).type === o.type && t.name === o.name) {
            return o.value;
          }
        }
      }
      return;
    }
    on = value ? onAdd : onRemove;
    for (i = 0; i < n; ++i) this.each(on(typenames[i], value, options));
    return this;
  }
  function dispatchEvent(node, type, params) {
    var window2 = defaultView(node), event = window2.CustomEvent;
    if (typeof event === "function") {
      event = new event(type, params);
    } else {
      event = window2.document.createEvent("Event");
      if (params) event.initEvent(type, params.bubbles, params.cancelable), event.detail = params.detail;
      else event.initEvent(type, false, false);
    }
    node.dispatchEvent(event);
  }
  function dispatchConstant(type, params) {
    return function() {
      return dispatchEvent(this, type, params);
    };
  }
  function dispatchFunction(type, params) {
    return function() {
      return dispatchEvent(this, type, params.apply(this, arguments));
    };
  }
  function selection_dispatch(type, params) {
    return this.each((typeof params === "function" ? dispatchFunction : dispatchConstant)(type, params));
  }
  function* selection_iterator() {
    for (var groups = this._groups, j = 0, m2 = groups.length; j < m2; ++j) {
      for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
        if (node = group[i]) yield node;
      }
    }
  }
  var root = [null];
  function Selection(groups, parents) {
    this._groups = groups;
    this._parents = parents;
  }
  function selection() {
    return new Selection([[document.documentElement]], root);
  }
  function selection_selection() {
    return this;
  }
  Selection.prototype = selection.prototype = {
    constructor: Selection,
    select: selection_select,
    selectAll: selection_selectAll,
    selectChild: selection_selectChild,
    selectChildren: selection_selectChildren,
    filter: selection_filter,
    data: selection_data,
    enter: selection_enter,
    exit: selection_exit,
    join: selection_join,
    merge: selection_merge,
    selection: selection_selection,
    order: selection_order,
    sort: selection_sort,
    call: selection_call,
    nodes: selection_nodes,
    node: selection_node,
    size: selection_size,
    empty: selection_empty,
    each: selection_each,
    attr: selection_attr,
    style: selection_style,
    property: selection_property,
    classed: selection_classed,
    text: selection_text,
    html: selection_html,
    raise: selection_raise,
    lower: selection_lower,
    append: selection_append,
    insert: selection_insert,
    remove: selection_remove,
    clone: selection_clone,
    datum: selection_datum,
    on: selection_on,
    dispatch: selection_dispatch,
    [Symbol.iterator]: selection_iterator
  };
  function select(selector2) {
    return typeof selector2 === "string" ? new Selection([[document.querySelector(selector2)]], [document.documentElement]) : new Selection([[selector2]], root);
  }
  var nextId = 0;
  function local() {
    return new Local();
  }
  function Local() {
    this._ = "@" + (++nextId).toString(36);
  }
  Local.prototype = local.prototype = {
    constructor: Local,
    get: function(node) {
      var id2 = this._;
      while (!(id2 in node)) if (!(node = node.parentNode)) return;
      return node[id2];
    },
    set: function(node, value) {
      return node[this._] = value;
    },
    remove: function(node) {
      return this._ in node && delete node[this._];
    },
    toString: function() {
      return this._;
    }
  };
  function sourceEvent(event) {
    let sourceEvent2;
    while (sourceEvent2 = event.sourceEvent) event = sourceEvent2;
    return event;
  }
  function pointer(event, node) {
    event = sourceEvent(event);
    if (node === void 0) node = event.currentTarget;
    if (node) {
      var svg = node.ownerSVGElement || node;
      if (svg.createSVGPoint) {
        var point = svg.createSVGPoint();
        point.x = event.clientX, point.y = event.clientY;
        point = point.matrixTransform(node.getScreenCTM().inverse());
        return [point.x, point.y];
      }
      if (node.getBoundingClientRect) {
        var rect = node.getBoundingClientRect();
        return [event.clientX - rect.left - node.clientLeft, event.clientY - rect.top - node.clientTop];
      }
    }
    return [event.pageX, event.pageY];
  }

  // node_modules/d3-drag/dist/d3-drag.mjs
  var nonpassivecapture = { capture: true, passive: false };
  function noevent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function nodrag(view) {
    var root2 = view.document.documentElement, selection2 = select(view).on("dragstart.drag", noevent, nonpassivecapture);
    if ("onselectstart" in root2) {
      selection2.on("selectstart.drag", noevent, nonpassivecapture);
    } else {
      root2.__noselect = root2.style.MozUserSelect;
      root2.style.MozUserSelect = "none";
    }
  }
  function yesdrag(view, noclick) {
    var root2 = view.document.documentElement, selection2 = select(view).on("dragstart.drag", null);
    if (noclick) {
      selection2.on("click.drag", noevent, nonpassivecapture);
      setTimeout(function() {
        selection2.on("click.drag", null);
      }, 0);
    }
    if ("onselectstart" in root2) {
      selection2.on("selectstart.drag", null);
    } else {
      root2.style.MozUserSelect = root2.__noselect;
      delete root2.__noselect;
    }
  }
  function DragEvent(type, {
    sourceEvent: sourceEvent2,
    subject,
    target,
    identifier,
    active,
    x,
    y,
    dx,
    dy,
    dispatch: dispatch2
  }) {
    Object.defineProperties(this, {
      type: { value: type, enumerable: true, configurable: true },
      sourceEvent: { value: sourceEvent2, enumerable: true, configurable: true },
      subject: { value: subject, enumerable: true, configurable: true },
      target: { value: target, enumerable: true, configurable: true },
      identifier: { value: identifier, enumerable: true, configurable: true },
      active: { value: active, enumerable: true, configurable: true },
      x: { value: x, enumerable: true, configurable: true },
      y: { value: y, enumerable: true, configurable: true },
      dx: { value: dx, enumerable: true, configurable: true },
      dy: { value: dy, enumerable: true, configurable: true },
      _: { value: dispatch2 }
    });
  }
  DragEvent.prototype.on = function() {
    var value = this._.on.apply(this._, arguments);
    return value === this._ ? this : value;
  };

  // node_modules/d3-color/dist/d3-color.mjs
  function define(constructor, factory, prototype) {
    constructor.prototype = factory.prototype = prototype;
    prototype.constructor = constructor;
  }
  function extend(parent, definition) {
    var prototype = Object.create(parent.prototype);
    for (var key in definition) prototype[key] = definition[key];
    return prototype;
  }
  function Color() {
  }
  var darker = 0.7;
  var brighter = 1 / darker;
  var reI = "\\s*([+-]?\\d+)\\s*";
  var reN = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*";
  var reP = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*";
  var reHex = /^#([0-9a-f]{3,8})$/;
  var reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`);
  var reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`);
  var reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`);
  var reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`);
  var reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`);
  var reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);
  var named = {
    aliceblue: 15792383,
    antiquewhite: 16444375,
    aqua: 65535,
    aquamarine: 8388564,
    azure: 15794175,
    beige: 16119260,
    bisque: 16770244,
    black: 0,
    blanchedalmond: 16772045,
    blue: 255,
    blueviolet: 9055202,
    brown: 10824234,
    burlywood: 14596231,
    cadetblue: 6266528,
    chartreuse: 8388352,
    chocolate: 13789470,
    coral: 16744272,
    cornflowerblue: 6591981,
    cornsilk: 16775388,
    crimson: 14423100,
    cyan: 65535,
    darkblue: 139,
    darkcyan: 35723,
    darkgoldenrod: 12092939,
    darkgray: 11119017,
    darkgreen: 25600,
    darkgrey: 11119017,
    darkkhaki: 12433259,
    darkmagenta: 9109643,
    darkolivegreen: 5597999,
    darkorange: 16747520,
    darkorchid: 10040012,
    darkred: 9109504,
    darksalmon: 15308410,
    darkseagreen: 9419919,
    darkslateblue: 4734347,
    darkslategray: 3100495,
    darkslategrey: 3100495,
    darkturquoise: 52945,
    darkviolet: 9699539,
    deeppink: 16716947,
    deepskyblue: 49151,
    dimgray: 6908265,
    dimgrey: 6908265,
    dodgerblue: 2003199,
    firebrick: 11674146,
    floralwhite: 16775920,
    forestgreen: 2263842,
    fuchsia: 16711935,
    gainsboro: 14474460,
    ghostwhite: 16316671,
    gold: 16766720,
    goldenrod: 14329120,
    gray: 8421504,
    green: 32768,
    greenyellow: 11403055,
    grey: 8421504,
    honeydew: 15794160,
    hotpink: 16738740,
    indianred: 13458524,
    indigo: 4915330,
    ivory: 16777200,
    khaki: 15787660,
    lavender: 15132410,
    lavenderblush: 16773365,
    lawngreen: 8190976,
    lemonchiffon: 16775885,
    lightblue: 11393254,
    lightcoral: 15761536,
    lightcyan: 14745599,
    lightgoldenrodyellow: 16448210,
    lightgray: 13882323,
    lightgreen: 9498256,
    lightgrey: 13882323,
    lightpink: 16758465,
    lightsalmon: 16752762,
    lightseagreen: 2142890,
    lightskyblue: 8900346,
    lightslategray: 7833753,
    lightslategrey: 7833753,
    lightsteelblue: 11584734,
    lightyellow: 16777184,
    lime: 65280,
    limegreen: 3329330,
    linen: 16445670,
    magenta: 16711935,
    maroon: 8388608,
    mediumaquamarine: 6737322,
    mediumblue: 205,
    mediumorchid: 12211667,
    mediumpurple: 9662683,
    mediumseagreen: 3978097,
    mediumslateblue: 8087790,
    mediumspringgreen: 64154,
    mediumturquoise: 4772300,
    mediumvioletred: 13047173,
    midnightblue: 1644912,
    mintcream: 16121850,
    mistyrose: 16770273,
    moccasin: 16770229,
    navajowhite: 16768685,
    navy: 128,
    oldlace: 16643558,
    olive: 8421376,
    olivedrab: 7048739,
    orange: 16753920,
    orangered: 16729344,
    orchid: 14315734,
    palegoldenrod: 15657130,
    palegreen: 10025880,
    paleturquoise: 11529966,
    palevioletred: 14381203,
    papayawhip: 16773077,
    peachpuff: 16767673,
    peru: 13468991,
    pink: 16761035,
    plum: 14524637,
    powderblue: 11591910,
    purple: 8388736,
    rebeccapurple: 6697881,
    red: 16711680,
    rosybrown: 12357519,
    royalblue: 4286945,
    saddlebrown: 9127187,
    salmon: 16416882,
    sandybrown: 16032864,
    seagreen: 3050327,
    seashell: 16774638,
    sienna: 10506797,
    silver: 12632256,
    skyblue: 8900331,
    slateblue: 6970061,
    slategray: 7372944,
    slategrey: 7372944,
    snow: 16775930,
    springgreen: 65407,
    steelblue: 4620980,
    tan: 13808780,
    teal: 32896,
    thistle: 14204888,
    tomato: 16737095,
    turquoise: 4251856,
    violet: 15631086,
    wheat: 16113331,
    white: 16777215,
    whitesmoke: 16119285,
    yellow: 16776960,
    yellowgreen: 10145074
  };
  define(Color, color, {
    copy(channels) {
      return Object.assign(new this.constructor(), this, channels);
    },
    displayable() {
      return this.rgb().displayable();
    },
    hex: color_formatHex,
    // Deprecated! Use color.formatHex.
    formatHex: color_formatHex,
    formatHex8: color_formatHex8,
    formatHsl: color_formatHsl,
    formatRgb: color_formatRgb,
    toString: color_formatRgb
  });
  function color_formatHex() {
    return this.rgb().formatHex();
  }
  function color_formatHex8() {
    return this.rgb().formatHex8();
  }
  function color_formatHsl() {
    return hslConvert(this).formatHsl();
  }
  function color_formatRgb() {
    return this.rgb().formatRgb();
  }
  function color(format) {
    var m2, l;
    format = (format + "").trim().toLowerCase();
    return (m2 = reHex.exec(format)) ? (l = m2[1].length, m2 = parseInt(m2[1], 16), l === 6 ? rgbn(m2) : l === 3 ? new Rgb(m2 >> 8 & 15 | m2 >> 4 & 240, m2 >> 4 & 15 | m2 & 240, (m2 & 15) << 4 | m2 & 15, 1) : l === 8 ? rgba(m2 >> 24 & 255, m2 >> 16 & 255, m2 >> 8 & 255, (m2 & 255) / 255) : l === 4 ? rgba(m2 >> 12 & 15 | m2 >> 8 & 240, m2 >> 8 & 15 | m2 >> 4 & 240, m2 >> 4 & 15 | m2 & 240, ((m2 & 15) << 4 | m2 & 15) / 255) : null) : (m2 = reRgbInteger.exec(format)) ? new Rgb(m2[1], m2[2], m2[3], 1) : (m2 = reRgbPercent.exec(format)) ? new Rgb(m2[1] * 255 / 100, m2[2] * 255 / 100, m2[3] * 255 / 100, 1) : (m2 = reRgbaInteger.exec(format)) ? rgba(m2[1], m2[2], m2[3], m2[4]) : (m2 = reRgbaPercent.exec(format)) ? rgba(m2[1] * 255 / 100, m2[2] * 255 / 100, m2[3] * 255 / 100, m2[4]) : (m2 = reHslPercent.exec(format)) ? hsla(m2[1], m2[2] / 100, m2[3] / 100, 1) : (m2 = reHslaPercent.exec(format)) ? hsla(m2[1], m2[2] / 100, m2[3] / 100, m2[4]) : named.hasOwnProperty(format) ? rgbn(named[format]) : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0) : null;
  }
  function rgbn(n) {
    return new Rgb(n >> 16 & 255, n >> 8 & 255, n & 255, 1);
  }
  function rgba(r, g, b, a2) {
    if (a2 <= 0) r = g = b = NaN;
    return new Rgb(r, g, b, a2);
  }
  function rgbConvert(o) {
    if (!(o instanceof Color)) o = color(o);
    if (!o) return new Rgb();
    o = o.rgb();
    return new Rgb(o.r, o.g, o.b, o.opacity);
  }
  function rgb(r, g, b, opacity) {
    return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
  }
  function Rgb(r, g, b, opacity) {
    this.r = +r;
    this.g = +g;
    this.b = +b;
    this.opacity = +opacity;
  }
  define(Rgb, rgb, extend(Color, {
    brighter(k) {
      k = k == null ? brighter : Math.pow(brighter, k);
      return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
    },
    darker(k) {
      k = k == null ? darker : Math.pow(darker, k);
      return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
    },
    rgb() {
      return this;
    },
    clamp() {
      return new Rgb(clampi(this.r), clampi(this.g), clampi(this.b), clampa(this.opacity));
    },
    displayable() {
      return -0.5 <= this.r && this.r < 255.5 && (-0.5 <= this.g && this.g < 255.5) && (-0.5 <= this.b && this.b < 255.5) && (0 <= this.opacity && this.opacity <= 1);
    },
    hex: rgb_formatHex,
    // Deprecated! Use color.formatHex.
    formatHex: rgb_formatHex,
    formatHex8: rgb_formatHex8,
    formatRgb: rgb_formatRgb,
    toString: rgb_formatRgb
  }));
  function rgb_formatHex() {
    return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
  }
  function rgb_formatHex8() {
    return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${hex((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
  }
  function rgb_formatRgb() {
    const a2 = clampa(this.opacity);
    return `${a2 === 1 ? "rgb(" : "rgba("}${clampi(this.r)}, ${clampi(this.g)}, ${clampi(this.b)}${a2 === 1 ? ")" : `, ${a2})`}`;
  }
  function clampa(opacity) {
    return isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity));
  }
  function clampi(value) {
    return Math.max(0, Math.min(255, Math.round(value) || 0));
  }
  function hex(value) {
    value = clampi(value);
    return (value < 16 ? "0" : "") + value.toString(16);
  }
  function hsla(h, s, l, a2) {
    if (a2 <= 0) h = s = l = NaN;
    else if (l <= 0 || l >= 1) h = s = NaN;
    else if (s <= 0) h = NaN;
    return new Hsl(h, s, l, a2);
  }
  function hslConvert(o) {
    if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
    if (!(o instanceof Color)) o = color(o);
    if (!o) return new Hsl();
    if (o instanceof Hsl) return o;
    o = o.rgb();
    var r = o.r / 255, g = o.g / 255, b = o.b / 255, min = Math.min(r, g, b), max = Math.max(r, g, b), h = NaN, s = max - min, l = (max + min) / 2;
    if (s) {
      if (r === max) h = (g - b) / s + (g < b) * 6;
      else if (g === max) h = (b - r) / s + 2;
      else h = (r - g) / s + 4;
      s /= l < 0.5 ? max + min : 2 - max - min;
      h *= 60;
    } else {
      s = l > 0 && l < 1 ? 0 : h;
    }
    return new Hsl(h, s, l, o.opacity);
  }
  function hsl(h, s, l, opacity) {
    return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
  }
  function Hsl(h, s, l, opacity) {
    this.h = +h;
    this.s = +s;
    this.l = +l;
    this.opacity = +opacity;
  }
  define(Hsl, hsl, extend(Color, {
    brighter(k) {
      k = k == null ? brighter : Math.pow(brighter, k);
      return new Hsl(this.h, this.s, this.l * k, this.opacity);
    },
    darker(k) {
      k = k == null ? darker : Math.pow(darker, k);
      return new Hsl(this.h, this.s, this.l * k, this.opacity);
    },
    rgb() {
      var h = this.h % 360 + (this.h < 0) * 360, s = isNaN(h) || isNaN(this.s) ? 0 : this.s, l = this.l, m2 = l + (l < 0.5 ? l : 1 - l) * s, m1 = 2 * l - m2;
      return new Rgb(
        hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
        hsl2rgb(h, m1, m2),
        hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
        this.opacity
      );
    },
    clamp() {
      return new Hsl(clamph(this.h), clampt(this.s), clampt(this.l), clampa(this.opacity));
    },
    displayable() {
      return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && (0 <= this.l && this.l <= 1) && (0 <= this.opacity && this.opacity <= 1);
    },
    formatHsl() {
      const a2 = clampa(this.opacity);
      return `${a2 === 1 ? "hsl(" : "hsla("}${clamph(this.h)}, ${clampt(this.s) * 100}%, ${clampt(this.l) * 100}%${a2 === 1 ? ")" : `, ${a2})`}`;
    }
  }));
  function clamph(value) {
    value = (value || 0) % 360;
    return value < 0 ? value + 360 : value;
  }
  function clampt(value) {
    return Math.max(0, Math.min(1, value || 0));
  }
  function hsl2rgb(h, m1, m2) {
    return (h < 60 ? m1 + (m2 - m1) * h / 60 : h < 180 ? m2 : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60 : m1) * 255;
  }
  var radians = Math.PI / 180;
  var degrees = 180 / Math.PI;
  var K = 18;
  var Xn = 0.96422;
  var Yn = 1;
  var Zn = 0.82521;
  var t0 = 4 / 29;
  var t1 = 6 / 29;
  var t2 = 3 * t1 * t1;
  var t3 = t1 * t1 * t1;
  function labConvert(o) {
    if (o instanceof Lab) return new Lab(o.l, o.a, o.b, o.opacity);
    if (o instanceof Hcl) return hcl2lab(o);
    if (!(o instanceof Rgb)) o = rgbConvert(o);
    var r = rgb2lrgb(o.r), g = rgb2lrgb(o.g), b = rgb2lrgb(o.b), y = xyz2lab((0.2225045 * r + 0.7168786 * g + 0.0606169 * b) / Yn), x, z;
    if (r === g && g === b) x = z = y;
    else {
      x = xyz2lab((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / Xn);
      z = xyz2lab((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / Zn);
    }
    return new Lab(116 * y - 16, 500 * (x - y), 200 * (y - z), o.opacity);
  }
  function lab(l, a2, b, opacity) {
    return arguments.length === 1 ? labConvert(l) : new Lab(l, a2, b, opacity == null ? 1 : opacity);
  }
  function Lab(l, a2, b, opacity) {
    this.l = +l;
    this.a = +a2;
    this.b = +b;
    this.opacity = +opacity;
  }
  define(Lab, lab, extend(Color, {
    brighter(k) {
      return new Lab(this.l + K * (k == null ? 1 : k), this.a, this.b, this.opacity);
    },
    darker(k) {
      return new Lab(this.l - K * (k == null ? 1 : k), this.a, this.b, this.opacity);
    },
    rgb() {
      var y = (this.l + 16) / 116, x = isNaN(this.a) ? y : y + this.a / 500, z = isNaN(this.b) ? y : y - this.b / 200;
      x = Xn * lab2xyz(x);
      y = Yn * lab2xyz(y);
      z = Zn * lab2xyz(z);
      return new Rgb(
        lrgb2rgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
        lrgb2rgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
        lrgb2rgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
        this.opacity
      );
    }
  }));
  function xyz2lab(t) {
    return t > t3 ? Math.pow(t, 1 / 3) : t / t2 + t0;
  }
  function lab2xyz(t) {
    return t > t1 ? t * t * t : t2 * (t - t0);
  }
  function lrgb2rgb(x) {
    return 255 * (x <= 31308e-7 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  }
  function rgb2lrgb(x) {
    return (x /= 255) <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  function hclConvert(o) {
    if (o instanceof Hcl) return new Hcl(o.h, o.c, o.l, o.opacity);
    if (!(o instanceof Lab)) o = labConvert(o);
    if (o.a === 0 && o.b === 0) return new Hcl(NaN, 0 < o.l && o.l < 100 ? 0 : NaN, o.l, o.opacity);
    var h = Math.atan2(o.b, o.a) * degrees;
    return new Hcl(h < 0 ? h + 360 : h, Math.sqrt(o.a * o.a + o.b * o.b), o.l, o.opacity);
  }
  function hcl(h, c2, l, opacity) {
    return arguments.length === 1 ? hclConvert(h) : new Hcl(h, c2, l, opacity == null ? 1 : opacity);
  }
  function Hcl(h, c2, l, opacity) {
    this.h = +h;
    this.c = +c2;
    this.l = +l;
    this.opacity = +opacity;
  }
  function hcl2lab(o) {
    if (isNaN(o.h)) return new Lab(o.l, 0, 0, o.opacity);
    var h = o.h * radians;
    return new Lab(o.l, Math.cos(h) * o.c, Math.sin(h) * o.c, o.opacity);
  }
  define(Hcl, hcl, extend(Color, {
    brighter(k) {
      return new Hcl(this.h, this.c, this.l + K * (k == null ? 1 : k), this.opacity);
    },
    darker(k) {
      return new Hcl(this.h, this.c, this.l - K * (k == null ? 1 : k), this.opacity);
    },
    rgb() {
      return hcl2lab(this).rgb();
    }
  }));
  var A = -0.14861;
  var B = 1.78277;
  var C = -0.29227;
  var D = -0.90649;
  var E = 1.97294;
  var ED = E * D;
  var EB = E * B;
  var BC_DA = B * C - D * A;
  function cubehelixConvert(o) {
    if (o instanceof Cubehelix) return new Cubehelix(o.h, o.s, o.l, o.opacity);
    if (!(o instanceof Rgb)) o = rgbConvert(o);
    var r = o.r / 255, g = o.g / 255, b = o.b / 255, l = (BC_DA * b + ED * r - EB * g) / (BC_DA + ED - EB), bl = b - l, k = (E * (g - l) - C * bl) / D, s = Math.sqrt(k * k + bl * bl) / (E * l * (1 - l)), h = s ? Math.atan2(k, bl) * degrees - 120 : NaN;
    return new Cubehelix(h < 0 ? h + 360 : h, s, l, o.opacity);
  }
  function cubehelix(h, s, l, opacity) {
    return arguments.length === 1 ? cubehelixConvert(h) : new Cubehelix(h, s, l, opacity == null ? 1 : opacity);
  }
  function Cubehelix(h, s, l, opacity) {
    this.h = +h;
    this.s = +s;
    this.l = +l;
    this.opacity = +opacity;
  }
  define(Cubehelix, cubehelix, extend(Color, {
    brighter(k) {
      k = k == null ? brighter : Math.pow(brighter, k);
      return new Cubehelix(this.h, this.s, this.l * k, this.opacity);
    },
    darker(k) {
      k = k == null ? darker : Math.pow(darker, k);
      return new Cubehelix(this.h, this.s, this.l * k, this.opacity);
    },
    rgb() {
      var h = isNaN(this.h) ? 0 : (this.h + 120) * radians, l = +this.l, a2 = isNaN(this.s) ? 0 : this.s * l * (1 - l), cosh2 = Math.cos(h), sinh2 = Math.sin(h);
      return new Rgb(
        255 * (l + a2 * (A * cosh2 + B * sinh2)),
        255 * (l + a2 * (C * cosh2 + D * sinh2)),
        255 * (l + a2 * (E * cosh2)),
        this.opacity
      );
    }
  }));

  // node_modules/d3-interpolate/dist/d3-interpolate.mjs
  function basis(t12, v0, v1, v2, v3) {
    var t22 = t12 * t12, t32 = t22 * t12;
    return ((1 - 3 * t12 + 3 * t22 - t32) * v0 + (4 - 6 * t22 + 3 * t32) * v1 + (1 + 3 * t12 + 3 * t22 - 3 * t32) * v2 + t32 * v3) / 6;
  }
  function basis$1(values) {
    var n = values.length - 1;
    return function(t) {
      var i = t <= 0 ? t = 0 : t >= 1 ? (t = 1, n - 1) : Math.floor(t * n), v1 = values[i], v2 = values[i + 1], v0 = i > 0 ? values[i - 1] : 2 * v1 - v2, v3 = i < n - 1 ? values[i + 2] : 2 * v2 - v1;
      return basis((t - i / n) * n, v0, v1, v2, v3);
    };
  }
  function basisClosed(values) {
    var n = values.length;
    return function(t) {
      var i = Math.floor(((t %= 1) < 0 ? ++t : t) * n), v0 = values[(i + n - 1) % n], v1 = values[i % n], v2 = values[(i + 1) % n], v3 = values[(i + 2) % n];
      return basis((t - i / n) * n, v0, v1, v2, v3);
    };
  }
  var constant3 = (x) => () => x;
  function linear(a2, d) {
    return function(t) {
      return a2 + t * d;
    };
  }
  function exponential(a2, b, y) {
    return a2 = Math.pow(a2, y), b = Math.pow(b, y) - a2, y = 1 / y, function(t) {
      return Math.pow(a2 + t * b, y);
    };
  }
  function hue$1(a2, b) {
    var d = b - a2;
    return d ? linear(a2, d > 180 || d < -180 ? d - 360 * Math.round(d / 360) : d) : constant3(isNaN(a2) ? b : a2);
  }
  function gamma(y) {
    return (y = +y) === 1 ? nogamma : function(a2, b) {
      return b - a2 ? exponential(a2, b, y) : constant3(isNaN(a2) ? b : a2);
    };
  }
  function nogamma(a2, b) {
    var d = b - a2;
    return d ? linear(a2, d) : constant3(isNaN(a2) ? b : a2);
  }
  var rgb2 = (function rgbGamma(y) {
    var color2 = gamma(y);
    function rgb3(start2, end) {
      var r = color2((start2 = rgb(start2)).r, (end = rgb(end)).r), g = color2(start2.g, end.g), b = color2(start2.b, end.b), opacity = nogamma(start2.opacity, end.opacity);
      return function(t) {
        start2.r = r(t);
        start2.g = g(t);
        start2.b = b(t);
        start2.opacity = opacity(t);
        return start2 + "";
      };
    }
    rgb3.gamma = rgbGamma;
    return rgb3;
  })(1);
  function rgbSpline(spline) {
    return function(colors) {
      var n = colors.length, r = new Array(n), g = new Array(n), b = new Array(n), i, color2;
      for (i = 0; i < n; ++i) {
        color2 = rgb(colors[i]);
        r[i] = color2.r || 0;
        g[i] = color2.g || 0;
        b[i] = color2.b || 0;
      }
      r = spline(r);
      g = spline(g);
      b = spline(b);
      color2.opacity = 1;
      return function(t) {
        color2.r = r(t);
        color2.g = g(t);
        color2.b = b(t);
        return color2 + "";
      };
    };
  }
  var rgbBasis = rgbSpline(basis$1);
  var rgbBasisClosed = rgbSpline(basisClosed);
  function number(a2, b) {
    return a2 = +a2, b = +b, function(t) {
      return a2 * (1 - t) + b * t;
    };
  }
  var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g;
  var reB = new RegExp(reA.source, "g");
  function zero(b) {
    return function() {
      return b;
    };
  }
  function one(b) {
    return function(t) {
      return b(t) + "";
    };
  }
  function string(a2, b) {
    var bi = reA.lastIndex = reB.lastIndex = 0, am, bm, bs, i = -1, s = [], q = [];
    a2 = a2 + "", b = b + "";
    while ((am = reA.exec(a2)) && (bm = reB.exec(b))) {
      if ((bs = bm.index) > bi) {
        bs = b.slice(bi, bs);
        if (s[i]) s[i] += bs;
        else s[++i] = bs;
      }
      if ((am = am[0]) === (bm = bm[0])) {
        if (s[i]) s[i] += bm;
        else s[++i] = bm;
      } else {
        s[++i] = null;
        q.push({ i, x: number(am, bm) });
      }
      bi = reB.lastIndex;
    }
    if (bi < b.length) {
      bs = b.slice(bi);
      if (s[i]) s[i] += bs;
      else s[++i] = bs;
    }
    return s.length < 2 ? q[0] ? one(q[0].x) : zero(b) : (b = q.length, function(t) {
      for (var i2 = 0, o; i2 < b; ++i2) s[(o = q[i2]).i] = o.x(t);
      return s.join("");
    });
  }
  var degrees2 = 180 / Math.PI;
  var identity = {
    translateX: 0,
    translateY: 0,
    rotate: 0,
    skewX: 0,
    scaleX: 1,
    scaleY: 1
  };
  function decompose(a2, b, c2, d, e, f) {
    var scaleX, scaleY, skewX;
    if (scaleX = Math.sqrt(a2 * a2 + b * b)) a2 /= scaleX, b /= scaleX;
    if (skewX = a2 * c2 + b * d) c2 -= a2 * skewX, d -= b * skewX;
    if (scaleY = Math.sqrt(c2 * c2 + d * d)) c2 /= scaleY, d /= scaleY, skewX /= scaleY;
    if (a2 * d < b * c2) a2 = -a2, b = -b, skewX = -skewX, scaleX = -scaleX;
    return {
      translateX: e,
      translateY: f,
      rotate: Math.atan2(b, a2) * degrees2,
      skewX: Math.atan(skewX) * degrees2,
      scaleX,
      scaleY
    };
  }
  var svgNode;
  function parseCss(value) {
    const m2 = new (typeof DOMMatrix === "function" ? DOMMatrix : WebKitCSSMatrix)(value + "");
    return m2.isIdentity ? identity : decompose(m2.a, m2.b, m2.c, m2.d, m2.e, m2.f);
  }
  function parseSvg(value) {
    if (value == null) return identity;
    if (!svgNode) svgNode = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svgNode.setAttribute("transform", value);
    if (!(value = svgNode.transform.baseVal.consolidate())) return identity;
    value = value.matrix;
    return decompose(value.a, value.b, value.c, value.d, value.e, value.f);
  }
  function interpolateTransform(parse, pxComma, pxParen, degParen) {
    function pop(s) {
      return s.length ? s.pop() + " " : "";
    }
    function translate(xa, ya, xb, yb, s, q) {
      if (xa !== xb || ya !== yb) {
        var i = s.push("translate(", null, pxComma, null, pxParen);
        q.push({ i: i - 4, x: number(xa, xb) }, { i: i - 2, x: number(ya, yb) });
      } else if (xb || yb) {
        s.push("translate(" + xb + pxComma + yb + pxParen);
      }
    }
    function rotate(a2, b, s, q) {
      if (a2 !== b) {
        if (a2 - b > 180) b += 360;
        else if (b - a2 > 180) a2 += 360;
        q.push({ i: s.push(pop(s) + "rotate(", null, degParen) - 2, x: number(a2, b) });
      } else if (b) {
        s.push(pop(s) + "rotate(" + b + degParen);
      }
    }
    function skewX(a2, b, s, q) {
      if (a2 !== b) {
        q.push({ i: s.push(pop(s) + "skewX(", null, degParen) - 2, x: number(a2, b) });
      } else if (b) {
        s.push(pop(s) + "skewX(" + b + degParen);
      }
    }
    function scale(xa, ya, xb, yb, s, q) {
      if (xa !== xb || ya !== yb) {
        var i = s.push(pop(s) + "scale(", null, ",", null, ")");
        q.push({ i: i - 4, x: number(xa, xb) }, { i: i - 2, x: number(ya, yb) });
      } else if (xb !== 1 || yb !== 1) {
        s.push(pop(s) + "scale(" + xb + "," + yb + ")");
      }
    }
    return function(a2, b) {
      var s = [], q = [];
      a2 = parse(a2), b = parse(b);
      translate(a2.translateX, a2.translateY, b.translateX, b.translateY, s, q);
      rotate(a2.rotate, b.rotate, s, q);
      skewX(a2.skewX, b.skewX, s, q);
      scale(a2.scaleX, a2.scaleY, b.scaleX, b.scaleY, s, q);
      a2 = b = null;
      return function(t) {
        var i = -1, n = q.length, o;
        while (++i < n) s[(o = q[i]).i] = o.x(t);
        return s.join("");
      };
    };
  }
  var interpolateTransformCss = interpolateTransform(parseCss, "px, ", "px)", "deg)");
  var interpolateTransformSvg = interpolateTransform(parseSvg, ", ", ")", ")");
  var epsilon2 = 1e-12;
  function cosh(x) {
    return ((x = Math.exp(x)) + 1 / x) / 2;
  }
  function sinh(x) {
    return ((x = Math.exp(x)) - 1 / x) / 2;
  }
  function tanh(x) {
    return ((x = Math.exp(2 * x)) - 1) / (x + 1);
  }
  var zoom = (function zoomRho(rho, rho2, rho4) {
    function zoom3(p0, p1) {
      var ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2], dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, i, S;
      if (d2 < epsilon2) {
        S = Math.log(w1 / w0) / rho;
        i = function(t) {
          return [
            ux0 + t * dx,
            uy0 + t * dy,
            w0 * Math.exp(rho * t * S)
          ];
        };
      } else {
        var d1 = Math.sqrt(d2), b02 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b12 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1), r0 = Math.log(Math.sqrt(b02 * b02 + 1) - b02), r1 = Math.log(Math.sqrt(b12 * b12 + 1) - b12);
        S = (r1 - r0) / rho;
        i = function(t) {
          var s = t * S, coshr0 = cosh(r0), u = w0 / (rho2 * d1) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
          return [
            ux0 + u * dx,
            uy0 + u * dy,
            w0 * coshr0 / cosh(rho * s + r0)
          ];
        };
      }
      i.duration = Math.abs(S) * 1e3 * rho / Math.SQRT2;
      return i;
    }
    zoom3.rho = function(_) {
      var _1 = Math.max(1e-3, +_), _2 = _1 * _1, _4 = _2 * _2;
      return zoomRho(_1, _2, _4);
    };
    return zoom3;
  })(Math.SQRT2, 2, 4);
  function hsl2(hue) {
    return function(start2, end) {
      var h = hue((start2 = hsl(start2)).h, (end = hsl(end)).h), s = nogamma(start2.s, end.s), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
      return function(t) {
        start2.h = h(t);
        start2.s = s(t);
        start2.l = l(t);
        start2.opacity = opacity(t);
        return start2 + "";
      };
    };
  }
  var hsl_default = hsl2(hue$1);
  var hslLong = hsl2(nogamma);
  function hcl2(hue) {
    return function(start2, end) {
      var h = hue((start2 = hcl(start2)).h, (end = hcl(end)).h), c2 = nogamma(start2.c, end.c), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
      return function(t) {
        start2.h = h(t);
        start2.c = c2(t);
        start2.l = l(t);
        start2.opacity = opacity(t);
        return start2 + "";
      };
    };
  }
  var hcl_default = hcl2(hue$1);
  var hclLong = hcl2(nogamma);
  function cubehelix2(hue) {
    return (function cubehelixGamma(y) {
      y = +y;
      function cubehelix3(start2, end) {
        var h = hue((start2 = cubehelix(start2)).h, (end = cubehelix(end)).h), s = nogamma(start2.s, end.s), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
        return function(t) {
          start2.h = h(t);
          start2.s = s(t);
          start2.l = l(Math.pow(t, y));
          start2.opacity = opacity(t);
          return start2 + "";
        };
      }
      cubehelix3.gamma = cubehelixGamma;
      return cubehelix3;
    })(1);
  }
  var cubehelix_default = cubehelix2(hue$1);
  var cubehelixLong = cubehelix2(nogamma);

  // node_modules/d3-ease/dist/d3-ease.mjs
  function cubicInOut(t) {
    return ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
  }
  var exponent = 3;
  var polyIn = (function custom(e) {
    e = +e;
    function polyIn2(t) {
      return Math.pow(t, e);
    }
    polyIn2.exponent = custom;
    return polyIn2;
  })(exponent);
  var polyOut = (function custom2(e) {
    e = +e;
    function polyOut2(t) {
      return 1 - Math.pow(1 - t, e);
    }
    polyOut2.exponent = custom2;
    return polyOut2;
  })(exponent);
  var polyInOut = (function custom3(e) {
    e = +e;
    function polyInOut2(t) {
      return ((t *= 2) <= 1 ? Math.pow(t, e) : 2 - Math.pow(2 - t, e)) / 2;
    }
    polyInOut2.exponent = custom3;
    return polyInOut2;
  })(exponent);
  var pi = Math.PI;
  var halfPi = pi / 2;
  function tpmt(x) {
    return (Math.pow(2, -10 * x) - 9765625e-10) * 1.0009775171065494;
  }
  var b1 = 4 / 11;
  var b2 = 6 / 11;
  var b3 = 8 / 11;
  var b4 = 3 / 4;
  var b5 = 9 / 11;
  var b6 = 10 / 11;
  var b7 = 15 / 16;
  var b8 = 21 / 22;
  var b9 = 63 / 64;
  var b0 = 1 / b1 / b1;
  var overshoot = 1.70158;
  var backIn = (function custom4(s) {
    s = +s;
    function backIn2(t) {
      return (t = +t) * t * (s * (t - 1) + t);
    }
    backIn2.overshoot = custom4;
    return backIn2;
  })(overshoot);
  var backOut = (function custom5(s) {
    s = +s;
    function backOut2(t) {
      return --t * t * ((t + 1) * s + t) + 1;
    }
    backOut2.overshoot = custom5;
    return backOut2;
  })(overshoot);
  var backInOut = (function custom6(s) {
    s = +s;
    function backInOut2(t) {
      return ((t *= 2) < 1 ? t * t * ((s + 1) * t - s) : (t -= 2) * t * ((s + 1) * t + s) + 2) / 2;
    }
    backInOut2.overshoot = custom6;
    return backInOut2;
  })(overshoot);
  var tau = 2 * Math.PI;
  var amplitude = 1;
  var period = 0.3;
  var elasticIn = (function custom7(a2, p) {
    var s = Math.asin(1 / (a2 = Math.max(1, a2))) * (p /= tau);
    function elasticIn2(t) {
      return a2 * tpmt(- --t) * Math.sin((s - t) / p);
    }
    elasticIn2.amplitude = function(a3) {
      return custom7(a3, p * tau);
    };
    elasticIn2.period = function(p2) {
      return custom7(a2, p2);
    };
    return elasticIn2;
  })(amplitude, period);
  var elasticOut = (function custom8(a2, p) {
    var s = Math.asin(1 / (a2 = Math.max(1, a2))) * (p /= tau);
    function elasticOut2(t) {
      return 1 - a2 * tpmt(t = +t) * Math.sin((t + s) / p);
    }
    elasticOut2.amplitude = function(a3) {
      return custom8(a3, p * tau);
    };
    elasticOut2.period = function(p2) {
      return custom8(a2, p2);
    };
    return elasticOut2;
  })(amplitude, period);
  var elasticInOut = (function custom9(a2, p) {
    var s = Math.asin(1 / (a2 = Math.max(1, a2))) * (p /= tau);
    function elasticInOut2(t) {
      return ((t = t * 2 - 1) < 0 ? a2 * tpmt(-t) * Math.sin((s - t) / p) : 2 - a2 * tpmt(t) * Math.sin((s + t) / p)) / 2;
    }
    elasticInOut2.amplitude = function(a3) {
      return custom9(a3, p * tau);
    };
    elasticInOut2.period = function(p2) {
      return custom9(a2, p2);
    };
    return elasticInOut2;
  })(amplitude, period);

  // node_modules/d3-transition/dist/d3-transition.mjs
  var emptyOn = dispatch("start", "end", "cancel", "interrupt");
  var emptyTween = [];
  var CREATED = 0;
  var SCHEDULED = 1;
  var STARTING = 2;
  var STARTED = 3;
  var RUNNING = 4;
  var ENDING = 5;
  var ENDED = 6;
  function schedule(node, name, id2, index2, group, timing) {
    var schedules = node.__transition;
    if (!schedules) node.__transition = {};
    else if (id2 in schedules) return;
    create(node, id2, {
      name,
      index: index2,
      // For context during callback.
      group,
      // For context during callback.
      on: emptyOn,
      tween: emptyTween,
      time: timing.time,
      delay: timing.delay,
      duration: timing.duration,
      ease: timing.ease,
      timer: null,
      state: CREATED
    });
  }
  function init(node, id2) {
    var schedule2 = get2(node, id2);
    if (schedule2.state > CREATED) throw new Error("too late; already scheduled");
    return schedule2;
  }
  function set2(node, id2) {
    var schedule2 = get2(node, id2);
    if (schedule2.state > STARTED) throw new Error("too late; already running");
    return schedule2;
  }
  function get2(node, id2) {
    var schedule2 = node.__transition;
    if (!schedule2 || !(schedule2 = schedule2[id2])) throw new Error("transition not found");
    return schedule2;
  }
  function create(node, id2, self) {
    var schedules = node.__transition, tween;
    schedules[id2] = self;
    self.timer = timer(schedule2, 0, self.time);
    function schedule2(elapsed) {
      self.state = SCHEDULED;
      self.timer.restart(start2, self.delay, self.time);
      if (self.delay <= elapsed) start2(elapsed - self.delay);
    }
    function start2(elapsed) {
      var i, j, n, o;
      if (self.state !== SCHEDULED) return stop();
      for (i in schedules) {
        o = schedules[i];
        if (o.name !== self.name) continue;
        if (o.state === STARTED) return timeout(start2);
        if (o.state === RUNNING) {
          o.state = ENDED;
          o.timer.stop();
          o.on.call("interrupt", node, node.__data__, o.index, o.group);
          delete schedules[i];
        } else if (+i < id2) {
          o.state = ENDED;
          o.timer.stop();
          o.on.call("cancel", node, node.__data__, o.index, o.group);
          delete schedules[i];
        }
      }
      timeout(function() {
        if (self.state === STARTED) {
          self.state = RUNNING;
          self.timer.restart(tick, self.delay, self.time);
          tick(elapsed);
        }
      });
      self.state = STARTING;
      self.on.call("start", node, node.__data__, self.index, self.group);
      if (self.state !== STARTING) return;
      self.state = STARTED;
      tween = new Array(n = self.tween.length);
      for (i = 0, j = -1; i < n; ++i) {
        if (o = self.tween[i].value.call(node, node.__data__, self.index, self.group)) {
          tween[++j] = o;
        }
      }
      tween.length = j + 1;
    }
    function tick(elapsed) {
      var t = elapsed < self.duration ? self.ease.call(null, elapsed / self.duration) : (self.timer.restart(stop), self.state = ENDING, 1), i = -1, n = tween.length;
      while (++i < n) {
        tween[i].call(node, t);
      }
      if (self.state === ENDING) {
        self.on.call("end", node, node.__data__, self.index, self.group);
        stop();
      }
    }
    function stop() {
      self.state = ENDED;
      self.timer.stop();
      delete schedules[id2];
      for (var i in schedules) return;
      delete node.__transition;
    }
  }
  function interrupt(node, name) {
    var schedules = node.__transition, schedule2, active, empty2 = true, i;
    if (!schedules) return;
    name = name == null ? null : name + "";
    for (i in schedules) {
      if ((schedule2 = schedules[i]).name !== name) {
        empty2 = false;
        continue;
      }
      active = schedule2.state > STARTING && schedule2.state < ENDING;
      schedule2.state = ENDED;
      schedule2.timer.stop();
      schedule2.on.call(active ? "interrupt" : "cancel", node, node.__data__, schedule2.index, schedule2.group);
      delete schedules[i];
    }
    if (empty2) delete node.__transition;
  }
  function selection_interrupt(name) {
    return this.each(function() {
      interrupt(this, name);
    });
  }
  function tweenRemove(id2, name) {
    var tween0, tween1;
    return function() {
      var schedule2 = set2(this, id2), tween = schedule2.tween;
      if (tween !== tween0) {
        tween1 = tween0 = tween;
        for (var i = 0, n = tween1.length; i < n; ++i) {
          if (tween1[i].name === name) {
            tween1 = tween1.slice();
            tween1.splice(i, 1);
            break;
          }
        }
      }
      schedule2.tween = tween1;
    };
  }
  function tweenFunction(id2, name, value) {
    var tween0, tween1;
    if (typeof value !== "function") throw new Error();
    return function() {
      var schedule2 = set2(this, id2), tween = schedule2.tween;
      if (tween !== tween0) {
        tween1 = (tween0 = tween).slice();
        for (var t = { name, value }, i = 0, n = tween1.length; i < n; ++i) {
          if (tween1[i].name === name) {
            tween1[i] = t;
            break;
          }
        }
        if (i === n) tween1.push(t);
      }
      schedule2.tween = tween1;
    };
  }
  function transition_tween(name, value) {
    var id2 = this._id;
    name += "";
    if (arguments.length < 2) {
      var tween = get2(this.node(), id2).tween;
      for (var i = 0, n = tween.length, t; i < n; ++i) {
        if ((t = tween[i]).name === name) {
          return t.value;
        }
      }
      return null;
    }
    return this.each((value == null ? tweenRemove : tweenFunction)(id2, name, value));
  }
  function tweenValue(transition2, name, value) {
    var id2 = transition2._id;
    transition2.each(function() {
      var schedule2 = set2(this, id2);
      (schedule2.value || (schedule2.value = {}))[name] = value.apply(this, arguments);
    });
    return function(node) {
      return get2(node, id2).value[name];
    };
  }
  function interpolate(a2, b) {
    var c2;
    return (typeof b === "number" ? number : b instanceof color ? rgb2 : (c2 = color(b)) ? (b = c2, rgb2) : string)(a2, b);
  }
  function attrRemove2(name) {
    return function() {
      this.removeAttribute(name);
    };
  }
  function attrRemoveNS2(fullname) {
    return function() {
      this.removeAttributeNS(fullname.space, fullname.local);
    };
  }
  function attrConstant2(name, interpolate2, value1) {
    var string00, string1 = value1 + "", interpolate0;
    return function() {
      var string0 = this.getAttribute(name);
      return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, value1);
    };
  }
  function attrConstantNS2(fullname, interpolate2, value1) {
    var string00, string1 = value1 + "", interpolate0;
    return function() {
      var string0 = this.getAttributeNS(fullname.space, fullname.local);
      return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, value1);
    };
  }
  function attrFunction2(name, interpolate2, value) {
    var string00, string10, interpolate0;
    return function() {
      var string0, value1 = value(this), string1;
      if (value1 == null) return void this.removeAttribute(name);
      string0 = this.getAttribute(name);
      string1 = value1 + "";
      return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate2(string00 = string0, value1));
    };
  }
  function attrFunctionNS2(fullname, interpolate2, value) {
    var string00, string10, interpolate0;
    return function() {
      var string0, value1 = value(this), string1;
      if (value1 == null) return void this.removeAttributeNS(fullname.space, fullname.local);
      string0 = this.getAttributeNS(fullname.space, fullname.local);
      string1 = value1 + "";
      return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate2(string00 = string0, value1));
    };
  }
  function transition_attr(name, value) {
    var fullname = namespace(name), i = fullname === "transform" ? interpolateTransformSvg : interpolate;
    return this.attrTween(name, typeof value === "function" ? (fullname.local ? attrFunctionNS2 : attrFunction2)(fullname, i, tweenValue(this, "attr." + name, value)) : value == null ? (fullname.local ? attrRemoveNS2 : attrRemove2)(fullname) : (fullname.local ? attrConstantNS2 : attrConstant2)(fullname, i, value));
  }
  function attrInterpolate(name, i) {
    return function(t) {
      this.setAttribute(name, i.call(this, t));
    };
  }
  function attrInterpolateNS(fullname, i) {
    return function(t) {
      this.setAttributeNS(fullname.space, fullname.local, i.call(this, t));
    };
  }
  function attrTweenNS(fullname, value) {
    var t02, i0;
    function tween() {
      var i = value.apply(this, arguments);
      if (i !== i0) t02 = (i0 = i) && attrInterpolateNS(fullname, i);
      return t02;
    }
    tween._value = value;
    return tween;
  }
  function attrTween(name, value) {
    var t02, i0;
    function tween() {
      var i = value.apply(this, arguments);
      if (i !== i0) t02 = (i0 = i) && attrInterpolate(name, i);
      return t02;
    }
    tween._value = value;
    return tween;
  }
  function transition_attrTween(name, value) {
    var key = "attr." + name;
    if (arguments.length < 2) return (key = this.tween(key)) && key._value;
    if (value == null) return this.tween(key, null);
    if (typeof value !== "function") throw new Error();
    var fullname = namespace(name);
    return this.tween(key, (fullname.local ? attrTweenNS : attrTween)(fullname, value));
  }
  function delayFunction(id2, value) {
    return function() {
      init(this, id2).delay = +value.apply(this, arguments);
    };
  }
  function delayConstant(id2, value) {
    return value = +value, function() {
      init(this, id2).delay = value;
    };
  }
  function transition_delay(value) {
    var id2 = this._id;
    return arguments.length ? this.each((typeof value === "function" ? delayFunction : delayConstant)(id2, value)) : get2(this.node(), id2).delay;
  }
  function durationFunction(id2, value) {
    return function() {
      set2(this, id2).duration = +value.apply(this, arguments);
    };
  }
  function durationConstant(id2, value) {
    return value = +value, function() {
      set2(this, id2).duration = value;
    };
  }
  function transition_duration(value) {
    var id2 = this._id;
    return arguments.length ? this.each((typeof value === "function" ? durationFunction : durationConstant)(id2, value)) : get2(this.node(), id2).duration;
  }
  function easeConstant(id2, value) {
    if (typeof value !== "function") throw new Error();
    return function() {
      set2(this, id2).ease = value;
    };
  }
  function transition_ease(value) {
    var id2 = this._id;
    return arguments.length ? this.each(easeConstant(id2, value)) : get2(this.node(), id2).ease;
  }
  function easeVarying(id2, value) {
    return function() {
      var v = value.apply(this, arguments);
      if (typeof v !== "function") throw new Error();
      set2(this, id2).ease = v;
    };
  }
  function transition_easeVarying(value) {
    if (typeof value !== "function") throw new Error();
    return this.each(easeVarying(this._id, value));
  }
  function transition_filter(match) {
    if (typeof match !== "function") match = matcher(match);
    for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
        if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
          subgroup.push(node);
        }
      }
    }
    return new Transition(subgroups, this._parents, this._name, this._id);
  }
  function transition_merge(transition2) {
    if (transition2._id !== this._id) throw new Error();
    for (var groups0 = this._groups, groups1 = transition2._groups, m0 = groups0.length, m1 = groups1.length, m2 = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m2; ++j) {
      for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
        if (node = group0[i] || group1[i]) {
          merge[i] = node;
        }
      }
    }
    for (; j < m0; ++j) {
      merges[j] = groups0[j];
    }
    return new Transition(merges, this._parents, this._name, this._id);
  }
  function start(name) {
    return (name + "").trim().split(/^|\s+/).every(function(t) {
      var i = t.indexOf(".");
      if (i >= 0) t = t.slice(0, i);
      return !t || t === "start";
    });
  }
  function onFunction(id2, name, listener) {
    var on0, on1, sit = start(name) ? init : set2;
    return function() {
      var schedule2 = sit(this, id2), on = schedule2.on;
      if (on !== on0) (on1 = (on0 = on).copy()).on(name, listener);
      schedule2.on = on1;
    };
  }
  function transition_on(name, listener) {
    var id2 = this._id;
    return arguments.length < 2 ? get2(this.node(), id2).on.on(name) : this.each(onFunction(id2, name, listener));
  }
  function removeFunction(id2) {
    return function() {
      var parent = this.parentNode;
      for (var i in this.__transition) if (+i !== id2) return;
      if (parent) parent.removeChild(this);
    };
  }
  function transition_remove() {
    return this.on("end.remove", removeFunction(this._id));
  }
  function transition_select(select2) {
    var name = this._name, id2 = this._id;
    if (typeof select2 !== "function") select2 = selector(select2);
    for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
        if ((node = group[i]) && (subnode = select2.call(node, node.__data__, i, group))) {
          if ("__data__" in node) subnode.__data__ = node.__data__;
          subgroup[i] = subnode;
          schedule(subgroup[i], name, id2, i, subgroup, get2(node, id2));
        }
      }
    }
    return new Transition(subgroups, this._parents, name, id2);
  }
  function transition_selectAll(select2) {
    var name = this._name, id2 = this._id;
    if (typeof select2 !== "function") select2 = selectorAll(select2);
    for (var groups = this._groups, m2 = groups.length, subgroups = [], parents = [], j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
        if (node = group[i]) {
          for (var children2 = select2.call(node, node.__data__, i, group), child, inherit2 = get2(node, id2), k = 0, l = children2.length; k < l; ++k) {
            if (child = children2[k]) {
              schedule(child, name, id2, k, children2, inherit2);
            }
          }
          subgroups.push(children2);
          parents.push(node);
        }
      }
    }
    return new Transition(subgroups, parents, name, id2);
  }
  var Selection2 = selection.prototype.constructor;
  function transition_selection() {
    return new Selection2(this._groups, this._parents);
  }
  function styleNull(name, interpolate2) {
    var string00, string10, interpolate0;
    return function() {
      var string0 = styleValue(this, name), string1 = (this.style.removeProperty(name), styleValue(this, name));
      return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, string10 = string1);
    };
  }
  function styleRemove2(name) {
    return function() {
      this.style.removeProperty(name);
    };
  }
  function styleConstant2(name, interpolate2, value1) {
    var string00, string1 = value1 + "", interpolate0;
    return function() {
      var string0 = styleValue(this, name);
      return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, value1);
    };
  }
  function styleFunction2(name, interpolate2, value) {
    var string00, string10, interpolate0;
    return function() {
      var string0 = styleValue(this, name), value1 = value(this), string1 = value1 + "";
      if (value1 == null) string1 = value1 = (this.style.removeProperty(name), styleValue(this, name));
      return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate2(string00 = string0, value1));
    };
  }
  function styleMaybeRemove(id2, name) {
    var on0, on1, listener0, key = "style." + name, event = "end." + key, remove2;
    return function() {
      var schedule2 = set2(this, id2), on = schedule2.on, listener = schedule2.value[key] == null ? remove2 || (remove2 = styleRemove2(name)) : void 0;
      if (on !== on0 || listener0 !== listener) (on1 = (on0 = on).copy()).on(event, listener0 = listener);
      schedule2.on = on1;
    };
  }
  function transition_style(name, value, priority) {
    var i = (name += "") === "transform" ? interpolateTransformCss : interpolate;
    return value == null ? this.styleTween(name, styleNull(name, i)).on("end.style." + name, styleRemove2(name)) : typeof value === "function" ? this.styleTween(name, styleFunction2(name, i, tweenValue(this, "style." + name, value))).each(styleMaybeRemove(this._id, name)) : this.styleTween(name, styleConstant2(name, i, value), priority).on("end.style." + name, null);
  }
  function styleInterpolate(name, i, priority) {
    return function(t) {
      this.style.setProperty(name, i.call(this, t), priority);
    };
  }
  function styleTween(name, value, priority) {
    var t, i0;
    function tween() {
      var i = value.apply(this, arguments);
      if (i !== i0) t = (i0 = i) && styleInterpolate(name, i, priority);
      return t;
    }
    tween._value = value;
    return tween;
  }
  function transition_styleTween(name, value, priority) {
    var key = "style." + (name += "");
    if (arguments.length < 2) return (key = this.tween(key)) && key._value;
    if (value == null) return this.tween(key, null);
    if (typeof value !== "function") throw new Error();
    return this.tween(key, styleTween(name, value, priority == null ? "" : priority));
  }
  function textConstant2(value) {
    return function() {
      this.textContent = value;
    };
  }
  function textFunction2(value) {
    return function() {
      var value1 = value(this);
      this.textContent = value1 == null ? "" : value1;
    };
  }
  function transition_text(value) {
    return this.tween("text", typeof value === "function" ? textFunction2(tweenValue(this, "text", value)) : textConstant2(value == null ? "" : value + ""));
  }
  function textInterpolate(i) {
    return function(t) {
      this.textContent = i.call(this, t);
    };
  }
  function textTween(value) {
    var t02, i0;
    function tween() {
      var i = value.apply(this, arguments);
      if (i !== i0) t02 = (i0 = i) && textInterpolate(i);
      return t02;
    }
    tween._value = value;
    return tween;
  }
  function transition_textTween(value) {
    var key = "text";
    if (arguments.length < 1) return (key = this.tween(key)) && key._value;
    if (value == null) return this.tween(key, null);
    if (typeof value !== "function") throw new Error();
    return this.tween(key, textTween(value));
  }
  function transition_transition() {
    var name = this._name, id0 = this._id, id1 = newId();
    for (var groups = this._groups, m2 = groups.length, j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
        if (node = group[i]) {
          var inherit2 = get2(node, id0);
          schedule(node, name, id1, i, group, {
            time: inherit2.time + inherit2.delay + inherit2.duration,
            delay: 0,
            duration: inherit2.duration,
            ease: inherit2.ease
          });
        }
      }
    }
    return new Transition(groups, this._parents, name, id1);
  }
  function transition_end() {
    var on0, on1, that = this, id2 = that._id, size = that.size();
    return new Promise(function(resolve, reject) {
      var cancel = { value: reject }, end = { value: function() {
        if (--size === 0) resolve();
      } };
      that.each(function() {
        var schedule2 = set2(this, id2), on = schedule2.on;
        if (on !== on0) {
          on1 = (on0 = on).copy();
          on1._.cancel.push(cancel);
          on1._.interrupt.push(cancel);
          on1._.end.push(end);
        }
        schedule2.on = on1;
      });
      if (size === 0) resolve();
    });
  }
  var id = 0;
  function Transition(groups, parents, name, id2) {
    this._groups = groups;
    this._parents = parents;
    this._name = name;
    this._id = id2;
  }
  function transition(name) {
    return selection().transition(name);
  }
  function newId() {
    return ++id;
  }
  var selection_prototype = selection.prototype;
  Transition.prototype = transition.prototype = {
    constructor: Transition,
    select: transition_select,
    selectAll: transition_selectAll,
    selectChild: selection_prototype.selectChild,
    selectChildren: selection_prototype.selectChildren,
    filter: transition_filter,
    merge: transition_merge,
    selection: transition_selection,
    transition: transition_transition,
    call: selection_prototype.call,
    nodes: selection_prototype.nodes,
    node: selection_prototype.node,
    size: selection_prototype.size,
    empty: selection_prototype.empty,
    each: selection_prototype.each,
    on: transition_on,
    attr: transition_attr,
    attrTween: transition_attrTween,
    style: transition_style,
    styleTween: transition_styleTween,
    text: transition_text,
    textTween: transition_textTween,
    remove: transition_remove,
    tween: transition_tween,
    delay: transition_delay,
    duration: transition_duration,
    ease: transition_ease,
    easeVarying: transition_easeVarying,
    end: transition_end,
    [Symbol.iterator]: selection_prototype[Symbol.iterator]
  };
  var defaultTiming = {
    time: null,
    // Set on use.
    delay: 0,
    duration: 250,
    ease: cubicInOut
  };
  function inherit(node, id2) {
    var timing;
    while (!(timing = node.__transition) || !(timing = timing[id2])) {
      if (!(node = node.parentNode)) {
        throw new Error(`transition ${id2} not found`);
      }
    }
    return timing;
  }
  function selection_transition(name) {
    var id2, timing;
    if (name instanceof Transition) {
      id2 = name._id, name = name._name;
    } else {
      id2 = newId(), (timing = defaultTiming).time = now(), name = name == null ? null : name + "";
    }
    for (var groups = this._groups, m2 = groups.length, j = 0; j < m2; ++j) {
      for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
        if (node = group[i]) {
          schedule(node, name, id2, i, group, timing || inherit(node, id2));
        }
      }
    }
    return new Transition(groups, this._parents, name, id2);
  }
  selection.prototype.interrupt = selection_interrupt;
  selection.prototype.transition = selection_transition;

  // node_modules/d3-zoom/dist/d3-zoom.mjs
  var constant4 = (x) => () => x;
  function ZoomEvent(type, {
    sourceEvent: sourceEvent2,
    target,
    transform: transform2,
    dispatch: dispatch2
  }) {
    Object.defineProperties(this, {
      type: { value: type, enumerable: true, configurable: true },
      sourceEvent: { value: sourceEvent2, enumerable: true, configurable: true },
      target: { value: target, enumerable: true, configurable: true },
      transform: { value: transform2, enumerable: true, configurable: true },
      _: { value: dispatch2 }
    });
  }
  function Transform(k, x, y) {
    this.k = k;
    this.x = x;
    this.y = y;
  }
  Transform.prototype = {
    constructor: Transform,
    scale: function(k) {
      return k === 1 ? this : new Transform(this.k * k, this.x, this.y);
    },
    translate: function(x, y) {
      return x === 0 & y === 0 ? this : new Transform(this.k, this.x + this.k * x, this.y + this.k * y);
    },
    apply: function(point) {
      return [point[0] * this.k + this.x, point[1] * this.k + this.y];
    },
    applyX: function(x) {
      return x * this.k + this.x;
    },
    applyY: function(y) {
      return y * this.k + this.y;
    },
    invert: function(location) {
      return [(location[0] - this.x) / this.k, (location[1] - this.y) / this.k];
    },
    invertX: function(x) {
      return (x - this.x) / this.k;
    },
    invertY: function(y) {
      return (y - this.y) / this.k;
    },
    rescaleX: function(x) {
      return x.copy().domain(x.range().map(this.invertX, this).map(x.invert, x));
    },
    rescaleY: function(y) {
      return y.copy().domain(y.range().map(this.invertY, this).map(y.invert, y));
    },
    toString: function() {
      return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
    }
  };
  var identity2 = new Transform(1, 0, 0);
  transform.prototype = Transform.prototype;
  function transform(node) {
    while (!node.__zoom) if (!(node = node.parentNode)) return identity2;
    return node.__zoom;
  }
  function nopropagation(event) {
    event.stopImmediatePropagation();
  }
  function noevent2(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function defaultFilter(event) {
    return (!event.ctrlKey || event.type === "wheel") && !event.button;
  }
  function defaultExtent() {
    var e = this;
    if (e instanceof SVGElement) {
      e = e.ownerSVGElement || e;
      if (e.hasAttribute("viewBox")) {
        e = e.viewBox.baseVal;
        return [[e.x, e.y], [e.x + e.width, e.y + e.height]];
      }
      return [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]];
    }
    return [[0, 0], [e.clientWidth, e.clientHeight]];
  }
  function defaultTransform() {
    return this.__zoom || identity2;
  }
  function defaultWheelDelta(event) {
    return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 2e-3) * (event.ctrlKey ? 10 : 1);
  }
  function defaultTouchable() {
    return navigator.maxTouchPoints || "ontouchstart" in this;
  }
  function defaultConstrain(transform2, extent, translateExtent) {
    var dx0 = transform2.invertX(extent[0][0]) - translateExtent[0][0], dx1 = transform2.invertX(extent[1][0]) - translateExtent[1][0], dy0 = transform2.invertY(extent[0][1]) - translateExtent[0][1], dy1 = transform2.invertY(extent[1][1]) - translateExtent[1][1];
    return transform2.translate(
      dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1),
      dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1)
    );
  }
  function zoom2() {
    var filter2 = defaultFilter, extent = defaultExtent, constrain = defaultConstrain, wheelDelta = defaultWheelDelta, touchable = defaultTouchable, scaleExtent = [0, Infinity], translateExtent = [[-Infinity, -Infinity], [Infinity, Infinity]], duration = 250, interpolate2 = zoom, listeners = dispatch("start", "zoom", "end"), touchstarting, touchfirst, touchending, touchDelay = 500, wheelDelay = 150, clickDistance2 = 0, tapDistance = 10;
    function zoom3(selection2) {
      selection2.property("__zoom", defaultTransform).on("wheel.zoom", wheeled, { passive: false }).on("mousedown.zoom", mousedowned).on("dblclick.zoom", dblclicked).filter(touchable).on("touchstart.zoom", touchstarted).on("touchmove.zoom", touchmoved).on("touchend.zoom touchcancel.zoom", touchended).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
    }
    zoom3.transform = function(collection, transform2, point, event) {
      var selection2 = collection.selection ? collection.selection() : collection;
      selection2.property("__zoom", defaultTransform);
      if (collection !== selection2) {
        schedule2(collection, transform2, point, event);
      } else {
        selection2.interrupt().each(function() {
          gesture(this, arguments).event(event).start().zoom(null, typeof transform2 === "function" ? transform2.apply(this, arguments) : transform2).end();
        });
      }
    };
    zoom3.scaleBy = function(selection2, k, p, event) {
      zoom3.scaleTo(selection2, function() {
        var k0 = this.__zoom.k, k1 = typeof k === "function" ? k.apply(this, arguments) : k;
        return k0 * k1;
      }, p, event);
    };
    zoom3.scaleTo = function(selection2, k, p, event) {
      zoom3.transform(selection2, function() {
        var e = extent.apply(this, arguments), t02 = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p, p1 = t02.invert(p0), k1 = typeof k === "function" ? k.apply(this, arguments) : k;
        return constrain(translate(scale(t02, k1), p0, p1), e, translateExtent);
      }, p, event);
    };
    zoom3.translateBy = function(selection2, x, y, event) {
      zoom3.transform(selection2, function() {
        return constrain(this.__zoom.translate(
          typeof x === "function" ? x.apply(this, arguments) : x,
          typeof y === "function" ? y.apply(this, arguments) : y
        ), extent.apply(this, arguments), translateExtent);
      }, null, event);
    };
    zoom3.translateTo = function(selection2, x, y, p, event) {
      zoom3.transform(selection2, function() {
        var e = extent.apply(this, arguments), t = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p;
        return constrain(identity2.translate(p0[0], p0[1]).scale(t.k).translate(
          typeof x === "function" ? -x.apply(this, arguments) : -x,
          typeof y === "function" ? -y.apply(this, arguments) : -y
        ), e, translateExtent);
      }, p, event);
    };
    function scale(transform2, k) {
      k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], k));
      return k === transform2.k ? transform2 : new Transform(k, transform2.x, transform2.y);
    }
    function translate(transform2, p0, p1) {
      var x = p0[0] - p1[0] * transform2.k, y = p0[1] - p1[1] * transform2.k;
      return x === transform2.x && y === transform2.y ? transform2 : new Transform(transform2.k, x, y);
    }
    function centroid(extent2) {
      return [(+extent2[0][0] + +extent2[1][0]) / 2, (+extent2[0][1] + +extent2[1][1]) / 2];
    }
    function schedule2(transition2, transform2, point, event) {
      transition2.on("start.zoom", function() {
        gesture(this, arguments).event(event).start();
      }).on("interrupt.zoom end.zoom", function() {
        gesture(this, arguments).event(event).end();
      }).tween("zoom", function() {
        var that = this, args = arguments, g = gesture(that, args).event(event), e = extent.apply(that, args), p = point == null ? centroid(e) : typeof point === "function" ? point.apply(that, args) : point, w = Math.max(e[1][0] - e[0][0], e[1][1] - e[0][1]), a2 = that.__zoom, b = typeof transform2 === "function" ? transform2.apply(that, args) : transform2, i = interpolate2(a2.invert(p).concat(w / a2.k), b.invert(p).concat(w / b.k));
        return function(t) {
          if (t === 1) t = b;
          else {
            var l = i(t), k = w / l[2];
            t = new Transform(k, p[0] - l[0] * k, p[1] - l[1] * k);
          }
          g.zoom(null, t);
        };
      });
    }
    function gesture(that, args, clean) {
      return !clean && that.__zooming || new Gesture(that, args);
    }
    function Gesture(that, args) {
      this.that = that;
      this.args = args;
      this.active = 0;
      this.sourceEvent = null;
      this.extent = extent.apply(that, args);
      this.taps = 0;
    }
    Gesture.prototype = {
      event: function(event) {
        if (event) this.sourceEvent = event;
        return this;
      },
      start: function() {
        if (++this.active === 1) {
          this.that.__zooming = this;
          this.emit("start");
        }
        return this;
      },
      zoom: function(key, transform2) {
        if (this.mouse && key !== "mouse") this.mouse[1] = transform2.invert(this.mouse[0]);
        if (this.touch0 && key !== "touch") this.touch0[1] = transform2.invert(this.touch0[0]);
        if (this.touch1 && key !== "touch") this.touch1[1] = transform2.invert(this.touch1[0]);
        this.that.__zoom = transform2;
        this.emit("zoom");
        return this;
      },
      end: function() {
        if (--this.active === 0) {
          delete this.that.__zooming;
          this.emit("end");
        }
        return this;
      },
      emit: function(type) {
        var d = select(this.that).datum();
        listeners.call(
          type,
          this.that,
          new ZoomEvent(type, {
            sourceEvent: this.sourceEvent,
            target: zoom3,
            transform: this.that.__zoom,
            dispatch: listeners
          }),
          d
        );
      }
    };
    function wheeled(event, ...args) {
      if (!filter2.apply(this, arguments)) return;
      var g = gesture(this, args).event(event), t = this.__zoom, k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], t.k * Math.pow(2, wheelDelta.apply(this, arguments)))), p = pointer(event);
      if (g.wheel) {
        if (g.mouse[0][0] !== p[0] || g.mouse[0][1] !== p[1]) {
          g.mouse[1] = t.invert(g.mouse[0] = p);
        }
        clearTimeout(g.wheel);
      } else if (t.k === k) return;
      else {
        g.mouse = [p, t.invert(p)];
        interrupt(this);
        g.start();
      }
      noevent2(event);
      g.wheel = setTimeout(wheelidled, wheelDelay);
      g.zoom("mouse", constrain(translate(scale(t, k), g.mouse[0], g.mouse[1]), g.extent, translateExtent));
      function wheelidled() {
        g.wheel = null;
        g.end();
      }
    }
    function mousedowned(event, ...args) {
      if (touchending || !filter2.apply(this, arguments)) return;
      var currentTarget = event.currentTarget, g = gesture(this, args, true).event(event), v = select(event.view).on("mousemove.zoom", mousemoved, true).on("mouseup.zoom", mouseupped, true), p = pointer(event, currentTarget), x0 = event.clientX, y0 = event.clientY;
      nodrag(event.view);
      nopropagation(event);
      g.mouse = [p, this.__zoom.invert(p)];
      interrupt(this);
      g.start();
      function mousemoved(event2) {
        noevent2(event2);
        if (!g.moved) {
          var dx = event2.clientX - x0, dy = event2.clientY - y0;
          g.moved = dx * dx + dy * dy > clickDistance2;
        }
        g.event(event2).zoom("mouse", constrain(translate(g.that.__zoom, g.mouse[0] = pointer(event2, currentTarget), g.mouse[1]), g.extent, translateExtent));
      }
      function mouseupped(event2) {
        v.on("mousemove.zoom mouseup.zoom", null);
        yesdrag(event2.view, g.moved);
        noevent2(event2);
        g.event(event2).end();
      }
    }
    function dblclicked(event, ...args) {
      if (!filter2.apply(this, arguments)) return;
      var t02 = this.__zoom, p0 = pointer(event.changedTouches ? event.changedTouches[0] : event, this), p1 = t02.invert(p0), k1 = t02.k * (event.shiftKey ? 0.5 : 2), t12 = constrain(translate(scale(t02, k1), p0, p1), extent.apply(this, args), translateExtent);
      noevent2(event);
      if (duration > 0) select(this).transition().duration(duration).call(schedule2, t12, p0, event);
      else select(this).call(zoom3.transform, t12, p0, event);
    }
    function touchstarted(event, ...args) {
      if (!filter2.apply(this, arguments)) return;
      var touches = event.touches, n = touches.length, g = gesture(this, args, event.changedTouches.length === n).event(event), started, i, t, p;
      nopropagation(event);
      for (i = 0; i < n; ++i) {
        t = touches[i], p = pointer(t, this);
        p = [p, this.__zoom.invert(p), t.identifier];
        if (!g.touch0) g.touch0 = p, started = true, g.taps = 1 + !!touchstarting;
        else if (!g.touch1 && g.touch0[2] !== p[2]) g.touch1 = p, g.taps = 0;
      }
      if (touchstarting) touchstarting = clearTimeout(touchstarting);
      if (started) {
        if (g.taps < 2) touchfirst = p[0], touchstarting = setTimeout(function() {
          touchstarting = null;
        }, touchDelay);
        interrupt(this);
        g.start();
      }
    }
    function touchmoved(event, ...args) {
      if (!this.__zooming) return;
      var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t, p, l;
      noevent2(event);
      for (i = 0; i < n; ++i) {
        t = touches[i], p = pointer(t, this);
        if (g.touch0 && g.touch0[2] === t.identifier) g.touch0[0] = p;
        else if (g.touch1 && g.touch1[2] === t.identifier) g.touch1[0] = p;
      }
      t = g.that.__zoom;
      if (g.touch1) {
        var p0 = g.touch0[0], l0 = g.touch0[1], p1 = g.touch1[0], l1 = g.touch1[1], dp = (dp = p1[0] - p0[0]) * dp + (dp = p1[1] - p0[1]) * dp, dl = (dl = l1[0] - l0[0]) * dl + (dl = l1[1] - l0[1]) * dl;
        t = scale(t, Math.sqrt(dp / dl));
        p = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        l = [(l0[0] + l1[0]) / 2, (l0[1] + l1[1]) / 2];
      } else if (g.touch0) p = g.touch0[0], l = g.touch0[1];
      else return;
      g.zoom("touch", constrain(translate(t, p, l), g.extent, translateExtent));
    }
    function touchended(event, ...args) {
      if (!this.__zooming) return;
      var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t;
      nopropagation(event);
      if (touchending) clearTimeout(touchending);
      touchending = setTimeout(function() {
        touchending = null;
      }, touchDelay);
      for (i = 0; i < n; ++i) {
        t = touches[i];
        if (g.touch0 && g.touch0[2] === t.identifier) delete g.touch0;
        else if (g.touch1 && g.touch1[2] === t.identifier) delete g.touch1;
      }
      if (g.touch1 && !g.touch0) g.touch0 = g.touch1, delete g.touch1;
      if (g.touch0) g.touch0[1] = this.__zoom.invert(g.touch0[0]);
      else {
        g.end();
        if (g.taps === 2) {
          t = pointer(t, this);
          if (Math.hypot(touchfirst[0] - t[0], touchfirst[1] - t[1]) < tapDistance) {
            var p = select(this).on("dblclick.zoom");
            if (p) p.apply(this, arguments);
          }
        }
      }
    }
    zoom3.wheelDelta = function(_) {
      return arguments.length ? (wheelDelta = typeof _ === "function" ? _ : constant4(+_), zoom3) : wheelDelta;
    };
    zoom3.filter = function(_) {
      return arguments.length ? (filter2 = typeof _ === "function" ? _ : constant4(!!_), zoom3) : filter2;
    };
    zoom3.touchable = function(_) {
      return arguments.length ? (touchable = typeof _ === "function" ? _ : constant4(!!_), zoom3) : touchable;
    };
    zoom3.extent = function(_) {
      return arguments.length ? (extent = typeof _ === "function" ? _ : constant4([[+_[0][0], +_[0][1]], [+_[1][0], +_[1][1]]]), zoom3) : extent;
    };
    zoom3.scaleExtent = function(_) {
      return arguments.length ? (scaleExtent[0] = +_[0], scaleExtent[1] = +_[1], zoom3) : [scaleExtent[0], scaleExtent[1]];
    };
    zoom3.translateExtent = function(_) {
      return arguments.length ? (translateExtent[0][0] = +_[0][0], translateExtent[1][0] = +_[1][0], translateExtent[0][1] = +_[0][1], translateExtent[1][1] = +_[1][1], zoom3) : [[translateExtent[0][0], translateExtent[0][1]], [translateExtent[1][0], translateExtent[1][1]]];
    };
    zoom3.constrain = function(_) {
      return arguments.length ? (constrain = _, zoom3) : constrain;
    };
    zoom3.duration = function(_) {
      return arguments.length ? (duration = +_, zoom3) : duration;
    };
    zoom3.interpolate = function(_) {
      return arguments.length ? (interpolate2 = _, zoom3) : interpolate2;
    };
    zoom3.on = function() {
      var value = listeners.on.apply(listeners, arguments);
      return value === listeners ? zoom3 : value;
    };
    zoom3.clickDistance = function(_) {
      return arguments.length ? (clickDistance2 = (_ = +_) * _, zoom3) : Math.sqrt(clickDistance2);
    };
    zoom3.tapDistance = function(_) {
      return arguments.length ? (tapDistance = +_, zoom3) : tapDistance;
    };
    return zoom3;
  }

  // client-src/tabs-graph.js
  var TYPE_COLOR = { person: "#e0a458", institution: "#5fb3d4", event: "#d46a6a", place: "#7fcb8f", concept: "#a78bfa", work: "#d4a5e0" };
  var REL_LABEL = { causal: "\u5BFC\u81F4", temporal: "\u5148\u540E\u4E8E", contrast: "\u5BF9\u7167", part_of: "\u5C5E\u4E8E", example_of: "\u4F8B\u5982" };
  var TYPE_LABEL = { person: "\u4EBA", institution: "\u5236\u5EA6", event: "\u4E8B\u4EF6", place: "\u5730\u65B9", concept: "\u6982\u5FF5", work: "\u4F5C\u54C1" };
  var GRAPH_VIEW_HEIGHT = 340;
  function sizeOf(node) {
    return node.type === "person" || node.type === "institution" ? 6.5 : 5.2;
  }
  function createGraphTab(ctx = {}) {
    const h = ctx.h;
    const React = ctx.React;
    function GraphTab() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState("");
      const [selected, setSelected] = React.useState(null);
      const [reloadKey, setReloadKey] = React.useState(0);
      const [zoomLevel, setZoomLevel] = React.useState(1);
      const wrapRef = React.useRef(null);
      const canvasRef = React.useRef(null);
      const graphRef = React.useRef(null);
      const transformRef = React.useRef(identity2);
      const selectedRef = React.useRef(null);
      React.useEffect(() => {
        selectedRef.current = selected;
      }, [selected]);
      React.useEffect(() => {
        let alive = true;
        const load = () => {
          fetch("/api/dsh-poetry/graph.json", { cache: "no-store" }).then((res) => {
            if (!res || res.ok !== true) throw new Error("HTTP " + (res ? res.status : "error"));
            return res.json();
          }).then((json) => {
            if (!alive) return;
            setData(json);
            setError("");
          }).catch((err) => {
            if (!alive) return;
            setError(String(err && err.message || err));
          });
        };
        load();
        const timer2 = setInterval(load, 3e4);
        return () => {
          alive = false;
          clearInterval(timer2);
        };
      }, [reloadKey]);
      React.useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas || !data) return void 0;
        const nodes2 = (Array.isArray(data.nodes) ? data.nodes : []).filter((node) => node && typeof node.name === "string").slice(0, 3e3).map((node) => ({ ...node }));
        const byName = new Map(nodes2.map((node) => [node.name, node]));
        const links = (Array.isArray(data.edges) ? data.edges : []).filter((edge) => byName.has(edge.from) && byName.has(edge.to)).slice(0, 6e3).map((edge) => ({ source: edge.from, target: edge.to, relation: edge.relation, note: edge.note, confidence: edge.confidence }));
        if (nodes2.length === 0) {
          graphRef.current = null;
          return void 0;
        }
        const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
        const width = Math.max(260, wrap.clientWidth || 360);
        const height = GRAPH_VIEW_HEIGHT;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        const context = canvas.getContext("2d");
        if (!context) return void 0;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const draw = () => {
          const transform2 = transformRef.current;
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          context.clearRect(0, 0, width, height);
          context.save();
          context.translate(transform2.x, transform2.y);
          context.scale(transform2.k, transform2.k);
          context.lineWidth = 0.6 / transform2.k;
          context.strokeStyle = "rgba(140,170,190,0.30)";
          context.beginPath();
          for (const link2 of links) {
            if (!link2.source || typeof link2.source.x !== "number" || !link2.target || typeof link2.target.x !== "number") continue;
            context.moveTo(link2.source.x, link2.source.y);
            context.lineTo(link2.target.x, link2.target.y);
          }
          context.stroke();
          const selectedName = selectedRef.current;
          const showLabels = transform2.k >= 0.55;
          for (const node of nodes2) {
            if (typeof node.x !== "number" || typeof node.y !== "number") continue;
            const radius = sizeOf(node) + (node.name === selectedName ? 3 : 0);
            context.beginPath();
            context.fillStyle = TYPE_COLOR[node.type] || "#8aa2b4";
            context.arc(node.x, node.y, radius, 0, Math.PI * 2);
            context.fill();
            if (node.name === selectedName) {
              context.strokeStyle = "#ffffff";
              context.lineWidth = 2 / transform2.k;
              context.stroke();
            }
          }
          if (showLabels) {
            context.fillStyle = "rgba(210,225,235,0.92)";
            const fontSize = 10 / transform2.k;
            context.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
            context.textBaseline = "middle";
            for (const node of nodes2) {
              if (typeof node.x !== "number") continue;
              context.fillText(node.name, node.x + (sizeOf(node) + 3) / transform2.k, node.y);
            }
          }
          context.restore();
        };
        const simulation2 = simulation(nodes2).force("link", link(links).id((node) => node.name).distance(70).strength(0.18)).force("charge", manyBody().strength(-30).theta(0.9)).force("center", center(width / 2, height / 2)).force("collide", collide().radius((node) => sizeOf(node) + 2)).alphaDecay(0.035).stop();
        simulation2.tick(160);
        draw();
        simulation2.on("tick", draw);
        simulation2.alpha(0.25).restart();
        const zoomBehavior = zoom2().scaleExtent([0.08, 8]).on("zoom", (event) => {
          transformRef.current = event.transform;
          setZoomLevel(Number(event.transform.k.toFixed(2)));
          draw();
        });
        const selection2 = select(canvas);
        selection2.call(zoomBehavior);
        selection2.on("dblclick.zoom", null);
        const pickNode = (event) => {
          const rect = canvas.getBoundingClientRect();
          const transform2 = transformRef.current;
          const gx = (event.clientX - rect.left - transform2.x) / transform2.k;
          const gy = (event.clientY - rect.top - transform2.y) / transform2.k;
          let best = null;
          let bestDistance = 14;
          for (const node of nodes2) {
            if (typeof node.x !== "number") continue;
            const distance = Math.hypot(node.x - gx, node.y - gy);
            if (distance < bestDistance) {
              best = node;
              bestDistance = distance;
            }
          }
          if (best !== null) setSelected(best.name);
        };
        canvas.addEventListener("click", pickNode);
        graphRef.current = { nodes: nodes2, links, simulation: simulation2, width, height };
        return () => {
          simulation2.stop();
          selection2.on(".zoom", null);
          canvas.removeEventListener("click", pickNode);
          graphRef.current = null;
        };
      }, [data, reloadKey]);
      const resetView = () => {
        const graph = graphRef.current;
        if (!graph || !canvasRef.current) return;
        const reset = identity2.translate(0, 0).scale(1);
        select(canvasRef.current).call(zoom2().transform, reset);
        transformRef.current = reset;
        setZoomLevel(1);
      };
      const nudgeZoom = (factor) => {
        const graph = graphRef.current;
        if (!graph || !canvasRef.current) return;
        const behavior = zoom2().scaleExtent([0.08, 8]);
        select(canvasRef.current).call(behavior.scaleBy, factor);
      };
      const nodes = Array.isArray(data && data.nodes) ? data.nodes : [];
      const edges = Array.isArray(data && data.edges) ? data.edges : [];
      const selectedNode = selected ? nodes.find((node) => node.name === selected) : null;
      const selectedRels = selectedNode ? edges.filter((edge) => edge.from === selectedNode.name || edge.to === selectedNode.name) : [];
      const selectedClaims = selectedNode && Array.isArray(data && data.claims) ? data.claims.filter((claim) => Array.isArray(claim.nodes) && claim.nodes.includes(selectedNode.name)) : [];
      const last = data && data.last ? data.last : null;
      const lastText = last ? last.ok === true ? `\u62BD\u53D6 +${last.addedNodes || 0} \u8282\u70B9` : `\u62BD\u53D6\u5931\u8D25\uFF1A${last.reason || "unknown"}` : "\u5C1A\u672A\u62BD\u53D6";
      const detail = selectedNode ? h(
        "div",
        { style: { marginTop: 8, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, fontSize: 12, lineHeight: 1.65 } },
        h(
          "div",
          { style: { display: "flex", gap: 6, alignItems: "baseline" } },
          h("strong", null, selectedNode.name),
          h("span", { style: { color: TYPE_COLOR[selectedNode.type] || "#8aa2b4" } }, TYPE_LABEL[selectedNode.type] || selectedNode.type || "\u6761\u76EE")
        ),
        selectedNode.summary ? h("div", { style: { opacity: 0.8, marginTop: 3 } }, selectedNode.summary) : null,
        selectedRels.length > 0 ? h(
          "div",
          { style: { marginTop: 5, opacity: 0.85 } },
          selectedRels.slice(0, 8).map((edge) => h(
            "div",
            { key: edge.id || edge.from + edge.to + edge.relation },
            edge.from === selectedNode.name ? `${REL_LABEL[edge.relation] || "\u5173\u8054"} ${edge.to}` : `${edge.from} ${REL_LABEL[edge.relation] || "\u5173\u8054"} \u5B83`,
            edge.note ? `\uFF08${edge.note}\uFF09` : ""
          ))
        ) : null,
        selectedClaims.length > 0 ? h(
          "div",
          { style: { marginTop: 5, opacity: 0.85 } },
          selectedClaims.slice(0, 4).map((claim) => h("div", { key: claim.id || claim.text }, "\u5224\u65AD\uFF1A" + claim.text + " [" + (claim.confidence || "low") + "]"))
        ) : null
      ) : null;
      const body = error ? h("div", { style: { fontSize: 12, color: "#e0a458" } }, "\u8BFB\u53D6\u56FE\u8C31\u5931\u8D25\uFF1A" + error, h("button", { type: "button", className: "dshp-btn dshp-btn-small", style: { marginLeft: 8 }, onClick: () => setReloadKey((n) => n + 1) }, "\u91CD\u8BD5")) : nodes.length === 0 ? h("div", { style: { fontSize: 12, lineHeight: 1.7, opacity: 0.85 } }, "\u56FE\u8C31\u8FD8\u5728\u957F\uFF1A\u540E\u53F0\u6BCF 2 \u5C0F\u65F6\u4ECE\u5B66\u4E60\u65E5\u5FD7\u91CC\u62BD\u4E00\u8F6E\u3002", h("br"), "\u5F53\u524D\u72B6\u6001\uFF1A" + lastText + "\u3002") : h(
        "div",
        { ref: wrapRef, style: { position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", background: "rgba(10,16,22,0.55)", border: "1px solid rgba(255,255,255,0.08)" } },
        h("canvas", { ref: canvasRef, style: { display: "block", cursor: "grab" } }),
        h(
          "div",
          { style: { position: "absolute", right: 8, bottom: 8, display: "flex", gap: 4 } },
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", title: "\u653E\u5927", onClick: () => nudgeZoom(1.3) }, "+"),
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", title: "\u7F29\u5C0F", onClick: () => nudgeZoom(0.77) }, "\u2212"),
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", title: "\u590D\u4F4D", onClick: resetView }, "\u590D\u4F4D")
        ),
        h("div", { style: { position: "absolute", left: 8, bottom: 8, fontSize: 11, opacity: 0.55 } }, "\u6EDA\u8F6E\u7F29\u653E \xB7 \u62D6\u52A8\u5E73\u79FB \xB7 \u70B9\u8282\u70B9\u770B\u8BE6\u60C5 \xB7 " + zoomLevel + "\xD7"),
        detail
      );
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12 } },
          h("strong", null, "\u8BA4\u77E5\u56FE\u8C31"),
          h("span", { style: { opacity: 0.7 } }, nodes.length + " \u8282\u70B9 / " + edges.length + " \u5173\u7CFB / " + (data && data.claims ? data.claims.length : 0) + " \u5224\u65AD"),
          h("span", { style: { opacity: 0.55 } }, lastText)
        ),
        body,
        h(
          "div",
          { style: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, opacity: 0.6 } },
          h("span", null, data && data.updatedAt ? "\u66F4\u65B0\uFF1A" + new Date(data.updatedAt).toLocaleString("zh-CN", { hour12: false }) : ""),
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => setReloadKey((n) => n + 1) }, "\u91CD\u65B0\u8F7D\u5165")
        )
      );
    }
    return GraphTab;
  }

  // client-src/feihua.js
  var FEIHUA_CANDIDATE_CHARS = Array.from("\u82B1\u6708\u98CE\u6625\u5C71\u6C34\u4EBA\u5929\u4E91\u96E8\u591C\u79CB\u6C5F\u9152\u767D\u7EA2\u821F\u6101\u68A6\u5FC3\u67F3\u96EA\u971C\u65E5\u661F\u6D77\u7389\u91D1\u957F\u4F55\u4E0D\u65E0");
  var FEIHUA_MIN_ENTRIES = 8;
  var FEIHUA_CANDIDATE_LIMIT = 12;
  var FEIHUA_ATLAS_LIMIT = 200;
  function completeSentencesFromLines(lines) {
    const text = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? "" : value)).join("").trim();
    if (!text) return [];
    const out = [];
    let start2 = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text.charAt(i);
      if (ch !== "\u3002" && ch !== "\uFF01" && ch !== "\uFF1F") continue;
      const sentence = text.slice(start2, i + 1).trim();
      start2 = i + 1;
      if (!sentence) continue;
      const plain = sentence.replace(/[，。！？；、：,.!?;:\s]/g, "");
      if (plain.length < 5) continue;
      out.push(sentence);
    }
    return out;
  }
  function feihuaPlainOf(text) {
    return String(text == null ? "" : text).replace(/[，。！？；、：,.!?;:\s"'“”‘’「」『』《》〈〉（）()\[\]【】·—…～~]/g, "");
  }
  function registerFeihuaLookup(index2, entry) {
    if (!index2 || !entry) return;
    const plain = feihuaPlainOf(entry.text);
    if (!plain) return;
    entry.plain = plain;
    if (!index2.byPlain[plain]) index2.byPlain[plain] = entry;
    const clauses = String(entry.text).split(/[，、；：,;:]/);
    for (const clause of clauses) {
      const clausePlain = feihuaPlainOf(clause);
      if (clausePlain.length < 2 || index2.clauseMap[clausePlain]) continue;
      index2.clauseMap[clausePlain] = entry;
    }
  }
  function feihuaLookup(index2, input) {
    if (!index2 || !index2.entries) return null;
    const plain = feihuaPlainOf(input);
    if (!plain) return null;
    if (index2.clauseMap && index2.clauseMap[plain]) return { entry: index2.clauseMap[plain], match: "clause" };
    if (index2.byPlain && index2.byPlain[plain]) return { entry: index2.byPlain[plain], match: "sentence" };
    if (plain.length < 5) return null;
    for (const entry of index2.entries) {
      const entryPlain = entry.plain || feihuaPlainOf(entry.text);
      if (entryPlain.indexOf(plain) >= 0) return { entry, match: "contains" };
    }
    return null;
  }
  function buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
    const entries = [];
    const seen = /* @__PURE__ */ new Set();
    const byChar = {};
    const counts = {};
    for (const char of FEIHUA_CANDIDATE_CHARS) {
      byChar[char] = [];
      counts[char] = 0;
    }
    function addSentence(text, source) {
      if (!text || seen.has(text)) return;
      if (!/[。！？]$/.test(text)) return;
      seen.add(text);
      const entry = { text, source: source || "" };
      entries.push(entry);
      for (const char of FEIHUA_CANDIDATE_CHARS) {
        if (text.indexOf(char) >= 0) {
          byChar[char].push(entry);
          counts[char] += 1;
        }
      }
    }
    function addItem(item, source) {
      for (const sentence of completeSentencesFromLines(item && item.lines)) addSentence(sentence, source);
    }
    const poemItems = poemsData && Array.isArray(poemsData.items) ? poemsData.items : [];
    for (const poem of poemItems) {
      if (!poem) continue;
      const author = typeof poem.author === "string" ? poem.author : "";
      const title = typeof poem.title === "string" ? poem.title : "";
      const source = author && title ? author + "\u300A" + title + "\u300B" : author || title;
      addItem(poem, source);
    }
    const ciItems = ciData && Array.isArray(ciData.items) ? ciData.items : [];
    for (const ci of ciItems) {
      if (!ci) continue;
      const author = typeof ci.author === "string" ? ci.author : "";
      const label = typeof ci.rhythmic === "string" && ci.rhythmic ? ci.rhythmic : typeof ci.title === "string" ? ci.title : "";
      const source = author && label ? author + "\u300A" + label + "\u300B" : author || label;
      addItem(ci, source);
    }
    const addExtraSource = (data) => {
      for (const item of data && Array.isArray(data.items) ? data.items : []) {
        if (!item) continue;
        const author = typeof item.author === "string" ? item.author : "";
        const title = typeof item.title === "string" ? item.title : "";
        const source = author && title ? author + "\u300A" + title + "\u300B" : author || title;
        addItem(item, source);
      }
    };
    addExtraSource(anthologyData);
    addExtraSource(bankData);
    const candidates = [];
    for (const char of FEIHUA_CANDIDATE_CHARS) {
      if (counts[char] >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count: counts[char] });
    }
    const index2 = { entries, byChar, counts, clauseMap: {}, byPlain: {} };
    for (const entry of entries) registerFeihuaLookup(index2, entry);
    if (ciBankData) mergeFeihuaItems(index2, ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : Array.isArray(ciBankData) ? ciBankData : []);
    return finishFeihuaIndex(index2);
  }
  function mergeFeihuaFullEntries(index2, char, entries) {
    if (!index2 || !index2.entries || !Array.isArray(entries)) return 0;
    const key = String(char == null ? "" : char);
    if (!key) return 0;
    if (!index2.__seen) index2.__seen = new Set(index2.entries.map((entry) => entry.text));
    if (!index2.__plainSeen) {
      index2.__plainSeen = /* @__PURE__ */ new Set();
      for (const entry of index2.entries) {
        const plain = entry.plain || feihuaPlainOf(entry.text);
        if (plain) index2.__plainSeen.add(plain);
      }
    }
    if (!index2.__fullMerged) index2.__fullMerged = {};
    if (index2.__fullMerged[key]) return 0;
    if (!Array.isArray(index2.byChar[key])) index2.byChar[key] = [];
    index2.counts[key] = index2.counts[key] || 0;
    let added = 0;
    for (const item of entries) {
      let text = "";
      let source = "";
      if (Array.isArray(item)) {
        text = String(item[0] == null ? "" : item[0]).trim();
        source = String(item[1] == null ? "" : item[1]).trim();
      } else if (item && typeof item === "object" && typeof item.text === "string") {
        text = item.text.trim();
        source = String(item.source || "").trim();
      } else {
        continue;
      }
      if (!text || !/[。！？]$/.test(text) || text.indexOf(key) < 0) continue;
      const plain = feihuaPlainOf(text);
      if (!plain || index2.__seen.has(text) || index2.__plainSeen.has(plain)) continue;
      index2.__seen.add(text);
      index2.__plainSeen.add(plain);
      const entry = { text, source, plain };
      index2.entries.push(entry);
      registerFeihuaLookup(index2, entry);
      index2.byChar[key].push(entry);
      index2.counts[key] += 1;
      added += 1;
    }
    index2.__fullMerged[key] = true;
    finishFeihuaIndex(index2);
    return added;
  }
  function feihuaSourceOf(item) {
    const author = typeof item.author === "string" ? item.author : "";
    const label = item.title || item.rhythmic || item.rhythm || "";
    const title = typeof label === "string" ? label : "";
    return author && title ? author + "\u300A" + title + "\u300B" : author || title;
  }
  function mergeFeihuaItems(index2, items) {
    if (!index2 || !index2.entries) return index2;
    if (!index2.__seen) index2.__seen = new Set(index2.entries.map((entry) => entry.text));
    for (const item of Array.isArray(items) ? items : []) {
      if (!item) continue;
      const source = feihuaSourceOf(item);
      for (const text of completeSentencesFromLines(item.lines)) {
        if (!text || !/[。！？]$/.test(text) || index2.__seen.has(text)) continue;
        index2.__seen.add(text);
        const entry = { text, source };
        index2.entries.push(entry);
        registerFeihuaLookup(index2, entry);
        for (const char of FEIHUA_CANDIDATE_CHARS) {
          if (text.indexOf(char) >= 0) {
            index2.byChar[char].push(entry);
            index2.counts[char] = (index2.counts[char] || 0) + 1;
          }
        }
      }
    }
    return index2;
  }
  function finishFeihuaIndex(index2) {
    if (!index2 || !index2.counts) return index2;
    const candidates = [];
    for (const char of FEIHUA_CANDIDATE_CHARS) {
      const count = index2.counts[char] || 0;
      if (count >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count });
    }
    candidates.sort((a2, b) => b.count - a2.count || a2.char.localeCompare(b.char, "zh"));
    index2.candidates = candidates.slice(0, FEIHUA_CANDIDATE_LIMIT);
    return index2;
  }
  function feihuaRandomIndex(length, random) {
    if (!length || length <= 0) return 0;
    const value = typeof random === "function" ? Number(random()) : Math.random();
    let index2 = Math.floor((Number.isFinite(value) ? value : 0) * length);
    if (index2 < 0) index2 = 0;
    if (index2 >= length) index2 = length - 1;
    return index2;
  }
  function feihuaPickSystem(index2, char, usedPlains, random) {
    if (!index2 || !index2.byChar) return null;
    const used = usedPlains instanceof Set ? usedPlains : new Set(Array.isArray(usedPlains) ? usedPlains : []);
    const pool = (index2.byChar[char] || []).filter((entry) => !used.has(entry.plain || feihuaPlainOf(entry.text)));
    if (!pool.length) return null;
    return pool[feihuaRandomIndex(pool.length, random)];
  }
  function feihuaStart(index2, char, random) {
    const charValue = String(char || "\u82B1");
    const system = feihuaPickSystem(index2, charValue, /* @__PURE__ */ new Set(), random);
    if (!system) {
      return {
        char: charValue,
        phase: "cleared",
        score: 0,
        used: [],
        system: null,
        feedback: null,
        message: "\u8FD9\u4E00\u5B57\u6682\u65F6\u6CA1\u6709\u53E5\u5B50\uFF0C\u6362\u4E00\u4E2A\u4EE4\u5B57\u5427"
      };
    }
    return {
      char: charValue,
      phase: "playing",
      score: 0,
      used: [system],
      system,
      feedback: null,
      message: "\u8BF7\u63A5\u4E00\u53E5\u542B\u300C" + charValue + "\u300D\u7684\u8BD7\u53E5"
    };
  }
  function feihuaSubmit(state, index2, input, random) {
    if (!state || state.phase !== "playing") return state;
    const raw = String(input == null ? "" : input).trim();
    const plain = feihuaPlainOf(raw);
    if (plain.length < 2) {
      return Object.assign({}, state, { feedback: { kind: "bad", text: "\u8BF7\u8F93\u5165\u4E00\u53E5\u5B8C\u6574\u7684\u8BD7/\u8BCD" } });
    }
    if (plain.indexOf(state.char) < 0) {
      return Object.assign({}, state, { feedback: { kind: "bad", text: "\u8FD9\u53E5\u91CC\u6CA1\u6709\u300C" + state.char + "\u300D\u54E6" } });
    }
    const used = Array.isArray(state.used) ? state.used : [];
    const usedPlains = new Set(used.map((entry2) => entry2.plain || feihuaPlainOf(entry2.text)));
    if (usedPlains.has(plain)) {
      return Object.assign({}, state, { feedback: { kind: "bad", text: "\u8FD9\u53E5\u672C\u5C40\u5DF2\u7ECF\u7528\u8FC7\u4E86" } });
    }
    const lookup = feihuaLookup(index2, raw);
    if (lookup && usedPlains.has(lookup.entry.plain || feihuaPlainOf(lookup.entry.text))) {
      return Object.assign({}, state, { feedback: { kind: "bad", text: "\u8FD9\u53E5\u672C\u5C40\u5DF2\u7ECF\u7528\u8FC7\u4E86" } });
    }
    if (!lookup) {
      return Object.assign({}, state, {
        feedback: { kind: "bad", text: "\u672C\u5730\u8BD7\u5E93\u6CA1\u67E5\u5230\u8FD9\u53E5\u7684\u51FA\u5904\uFF0C\u53EF\u80FD\u662F\u8BB0\u9519\u4E86\uFF0C\u6216\u8FD8\u6CA1\u6536\u5F55" }
      });
    }
    const entry = lookup.entry;
    const nextUsed = used.concat([entry]);
    const nextPlains = new Set(nextUsed.map((item) => item.plain || feihuaPlainOf(item.text)));
    const system = feihuaPickSystem(index2, state.char, nextPlains, random);
    const score = state.score + 1;
    const feedback = {
      kind: "good",
      text: "\u63A5\u4E0A\u4E86\uFF1A" + entry.text + (entry.source ? " \u2014\u2014 " + entry.source : "")
    };
    if (!system) {
      return Object.assign({}, state, {
        phase: "cleared",
        score,
        used: nextUsed,
        system: null,
        feedback,
        message: "\u8FD9\u4E00\u5B57\u7684\u53E5\u5B50\u88AB\u63A5\u5B8C\u4E86\uFF0C\u6362\u4E00\u4E2A\u4EE4\u5B57\u5427"
      });
    }
    return Object.assign({}, state, {
      phase: "playing",
      score,
      used: nextUsed,
      system,
      feedback,
      message: "\u8BF7\u63A5\u4E00\u53E5\u542B\u300C" + state.char + "\u300D\u7684\u8BD7\u53E5"
    });
  }
  function normalizeFeihuaBest(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const chars = {};
    if (source.chars && typeof source.chars === "object") {
      for (const key of Object.keys(source.chars)) {
        const value = Number(source.chars[key]);
        if (Number.isFinite(value) && value > 0) chars[key] = Math.floor(value);
      }
    }
    const overallRaw = Number(source.overall);
    return { overall: Number.isFinite(overallRaw) && overallRaw > 0 ? Math.floor(overallRaw) : 0, chars };
  }
  function feihuaBestUpdate(best, char, score) {
    const base = normalizeFeihuaBest(best);
    const safeScore = Math.max(0, Math.floor(num(score, 0)));
    const chars = Object.assign({}, base.chars);
    chars[char] = Math.max(chars[char] || 0, safeScore);
    return { overall: Math.max(base.overall, safeScore), chars };
  }

  // client-src/tabs-feihua.js
  function createFeihuaTab(ctx = {}) {
    const React = ctx.React;
    const h = ctx.h;
    const cx = ctx.cx;
    const EmptyState = ctx.EmptyState;
    const LoadingState = ctx.LoadingState;
    const ToneLine = ctx.ToneLine;
    const detectionRhymeIndexes = ctx.detectionRhymeIndexes;
    const formatDetectionReport = ctx.formatDetectionReport;
    const describeDataError = ctx.describeDataError;
    const getFeihuaIndex = ctx.getFeihuaIndex;
    const pickDefaultFeihuaChar = ctx.pickDefaultFeihuaChar;
    const feihuaSourceOf2 = ctx.feihuaSourceOf;
    const mergeFeihuaItems2 = ctx.mergeFeihuaItems;
    const finishFeihuaIndex2 = ctx.finishFeihuaIndex;
    const mergeFeihuaFullEntries2 = ctx.mergeFeihuaFullEntries;
    const requestFeihuaFull = ctx.requestFeihuaFull;
    const abortFeihuaFull = ctx.abortFeihuaFull;
    const readFeihuaFullCache = ctx.readFeihuaFullCache;
    const readFeihuaBest = ctx.readFeihuaBest;
    const writeFeihuaBest = ctx.writeFeihuaBest;
    const FEIHUA_ATLAS_PAGE = ctx.FEIHUA_ATLAS_PAGE;
    const FEIHUA_FULL_RETRY_MS = ctx.FEIHUA_FULL_RETRY_MS;
    function FeihuaTab(props) {
      const api = props.api || {};
      const poemsRes = api.poemsRes || {};
      const ciRes = api.ciRes || {};
      const index2 = api.feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, api.anthologyRes && api.anthologyRes.data, api.bankRes && api.bankRes.data);
      const feihuaBuilding = api.feihuaBuilding === true || Boolean(api.ciBankRes && api.ciBankRes.status === "loading");
      const ciBankFailed = Boolean(api.ciBankRes && api.ciBankRes.status === "error");
      const [char, setChar] = React.useState(null);
      const [mode, setMode] = React.useState("chain");
      const [game, setGame] = React.useState(null);
      const [inputText, setInputText] = React.useState("");
      const [atlasLimit, setAtlasLimit] = React.useState(FEIHUA_ATLAS_PAGE);
      const [best, setBest] = React.useState(() => readFeihuaBest());
      const bestRef = React.useRef(best);
      bestRef.current = best;
      const launch = num(api.feihuaLaunch, 0);
      const launchRef = React.useRef(0);
      const activeChar = index2 ? char || pickDefaultFeihuaChar(index2, api.poem) : null;
      React.useEffect(() => {
        if (!index2 || !activeChar) return;
        if (launch > 0 && launch !== launchRef.current) {
          launchRef.current = launch;
          setGame(feihuaStart(index2, activeChar));
          setMode("chain");
          if (typeof api.consumeFeihuaLaunch === "function") api.consumeFeihuaLaunch();
        }
      }, [launch, index2, activeChar]);
      const [fullInfo, setFullInfo] = React.useState({ char: "", status: "idle", count: 0 });
      const fullTokenRef = React.useRef(0);
      React.useEffect(() => {
        if (!index2 || !activeChar) return void 0;
        const target = activeChar;
        const cached = readFeihuaFullCache(target);
        if (cached && cached.status === "ready") {
          mergeFeihuaFullEntries2(index2, target, cached.entries);
          setFullInfo({ char: target, status: "ready", count: cached.count });
          return void 0;
        }
        if (cached && cached.status === "error" && Date.now() - cached.at < FEIHUA_FULL_RETRY_MS) {
          setFullInfo({ char: target, status: "error", count: 0 });
          return void 0;
        }
        const token = fullTokenRef.current + 1;
        fullTokenRef.current = token;
        setFullInfo({ char: target, status: "loading", count: 0 });
        requestFeihuaFull(target).then((result) => {
          if (token !== fullTokenRef.current) return;
          if (result && result.ok && Array.isArray(result.entries)) {
            mergeFeihuaFullEntries2(index2, target, result.entries);
            setFullInfo({ char: target, status: "ready", count: result.count || result.entries.length });
          } else {
            setFullInfo({ char: target, status: "error", count: 0 });
          }
        });
        return () => {
          fullTokenRef.current += 1;
          abortFeihuaFull(target);
        };
      }, [activeChar, index2]);
      if (poemsRes.status === "error") {
        return h(EmptyState, {
          title: "\u98DE\u82B1\u4EE4\u53E5\u5E93\u6682\u65F6\u4E0D\u53EF\u7528",
          message: describeDataError(poemsRes.error),
          onRetry: () => api.reloadPoems && api.reloadPoems().catch(() => {
          })
        });
      }
      if (ciRes.status === "error") {
        return h(EmptyState, {
          title: "\u8BCD\u5E93\u6682\u65F6\u4E0D\u53EF\u7528",
          message: describeDataError(ciRes.error),
          onRetry: () => api.reloadCi && api.reloadCi().catch(() => {
          })
        });
      }
      if (!poemsRes.data || !ciRes.data) return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u98DE\u82B1\u4EE4\u53E5\u5E93\u2026" });
      if (!index2 || !index2.entries.length) {
        return h(EmptyState, { title: "\u98DE\u82B1\u4EE4\u53E5\u5E93\u4E3A\u7A7A", message: "\u8BD7/\u8BCD\u6570\u636E\u91CC\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u53E5\u5B50\u3002", icon: "\u{1FAB6}" });
      }
      const candidateChips = index2.candidates.slice();
      if (!candidateChips.some((item) => item.char === activeChar)) {
        candidateChips.unshift({ char: activeChar, count: index2.counts[activeChar] || 0 });
      }
      const charEntries = index2.byChar[activeChar] || [];
      const bestForChar = best.chars[activeChar] || 0;
      function startGame(target) {
        const use = target || activeChar;
        if (!index2 || !use) return;
        setChar(use);
        setInputText("");
        setGame(feihuaStart(index2, use));
        setMode("chain");
        setAtlasLimit(FEIHUA_ATLAS_PAGE);
        const cachedFull = readFeihuaFullCache(use);
        if (!cachedFull || cachedFull.status !== "ready") {
          const token = fullTokenRef.current + 1;
          fullTokenRef.current = token;
          requestFeihuaFull(use).then((result) => {
            if (token !== fullTokenRef.current) return;
            if (result && result.ok && Array.isArray(result.entries)) {
              mergeFeihuaFullEntries2(index2, use, result.entries);
              setFullInfo({ char: use, status: "ready", count: result.count || result.entries.length });
            }
          }).catch(() => {
          });
        }
        if (typeof api.pulseMascot === "function") api.pulseMascot("gameThink");
      }
      function chooseChar(next) {
        if (!next) return;
        if (next === activeChar) {
          setGame(null);
          setInputText("");
          return;
        }
        setChar(next);
        setInputText("");
        setGame(null);
        setAtlasLimit(FEIHUA_ATLAS_PAGE);
      }
      function randomChar() {
        if (!index2 || !index2.candidates.length) return;
        const pool = index2.candidates.filter((item) => item.char !== activeChar);
        const picked = pool.length ? pool[feihuaRandomIndex(pool.length)] : index2.candidates[0];
        chooseChar(picked.char);
      }
      function submitAnswer() {
        if (!game || game.phase !== "playing") return;
        const next = feihuaSubmit(game, index2, inputText);
        if (!next || next === game) return;
        setGame(next);
        if (next.feedback && next.feedback.kind === "good") setInputText("");
        if (next.feedback && typeof api.pulseMascot === "function") {
          api.pulseMascot(next.feedback.kind === "good" ? "gameWin" : "gameLose");
        }
        const updated = feihuaBestUpdate(bestRef.current, next.char, next.score);
        if (updated.overall !== bestRef.current.overall || (updated.chars[next.char] || 0) !== (bestRef.current.chars[next.char] || 0)) {
          setBest(updated);
          writeFeihuaBest(updated);
        }
      }
      function handleInputKey(event) {
        if (event && event.key === "Enter") {
          event.preventDefault();
          submitAnswer();
        }
      }
      function renderChain() {
        const playing = game && game.phase === "playing";
        if (!game) {
          return h(
            "div",
            { className: "dshp-card" },
            h("div", { className: "dshp-card-title" }, "\u98DE\u82B1\u4EE4 \xB7 \u5BF9\u53E5"),
            h("div", { className: "dshp-card-summary" }, "\u4EE4\u5B57\u300C" + activeChar + "\u300D\xB7 " + charEntries.length + " \u53E5\u53EF\u67E5"),
            h("div", { className: "dshp-block" }, "\u5BF9\u65B9\u5148\u51FA\u4E00\u53E5\u542B\u4EE4\u5B57\u7684\u8BD7\uFF0C\u4F60\u8F93\u5165\u4E00\u53E5\uFF1A\u6709\u51FA\u5904\u3001\u542B\u4EE4\u5B57\u3001\u672C\u5C40\u4E0D\u91CD\u590D\u5C31\u7B97\u63A5\u4E0A\u3002\u4E0D\u6263\u547D\uFF0C\u4E0D\u8BA1\u9519\u3002"),
            charEntries.length ? h(
              "div",
              { className: "dshp-fh-actions" },
              h("button", {
                type: "button",
                className: "dshp-btn dshp-btn-primary",
                onClick: (event) => {
                  event.stopPropagation();
                  startGame(activeChar);
                }
              }, "\u6765\u4E00\u5C40"),
              h("span", { className: "dshp-pager-label" }, "\u672C\u5B57\u6700\u4F73 " + bestForChar + " \u5C40")
            ) : h("div", { className: "dshp-empty-msg" }, "\u8FD9\u4E00\u5B57\u6682\u65F6\u6CA1\u6709\u53E5\u5B50\uFF0C\u6362\u4E00\u4E2A\u4EE4\u5B57\u8BD5\u8BD5\u3002")
          );
        }
        return h(
          "div",
          { className: "dshp-card" },
          h("div", { className: "dshp-card-title" }, "\u98DE\u82B1\u4EE4 \xB7 \u5BF9\u53E5"),
          h("div", { className: "dshp-card-summary" }, "\u4EE4\u5B57\u300C" + game.char + "\u300D\xB7 \u672C\u5C40\u5DF2\u63A5 " + game.score + " \u53E5 \xB7 \u672C\u5B57\u6700\u4F73 " + Math.max(bestForChar, game.score) + " \u5C40"),
          game.system ? h(
            "div",
            { className: "dshp-fh-system" },
            "\u5BF9\u65B9\uFF1A" + game.system.text,
            game.system.source ? h("small", null, game.system.source) : null
          ) : null,
          h("div", { className: "dshp-fh-prompt" }, game.message || "\u8BF7\u63A5\u4E00\u53E5\u542B\u300C" + game.char + "\u300D\u7684\u8BD7\u53E5"),
          h(
            "div",
            { className: "dshp-fh-actions" },
            h("input", {
              className: "dshp-input",
              type: "text",
              value: inputText,
              maxLength: 60,
              placeholder: "\u8F93\u5165\u4E00\u53E5\u542B\u300C" + game.char + "\u300D\u7684\u8BD7/\u8BCD\uFF0C\u56DE\u8F66\u63D0\u4EA4",
              "aria-label": "\u8F93\u5165\u98DE\u82B1\u4EE4\u5BF9\u53E5",
              onChange: (event) => setInputText(event.target.value),
              onKeyDown: handleInputKey,
              disabled: !playing
            }),
            h("button", {
              type: "button",
              className: "dshp-btn dshp-btn-primary",
              onClick: (event) => {
                event.stopPropagation();
                submitAnswer();
              },
              disabled: !playing
            }, "\u63A5\u4E00\u53E5")
          ),
          h("div", {
            className: cx(
              "dshp-fh-feedback",
              game.feedback && game.feedback.kind === "good" && "dshp-is-good",
              game.feedback && game.feedback.kind === "bad" && "dshp-is-bad"
            ),
            role: "status",
            "aria-live": "polite"
          }, game.feedback ? game.feedback.text : ""),
          game.phase === "cleared" ? h(
            "div",
            { className: "dshp-fh-result" },
            h("b", null, "\u8FD9\u4E00\u5B57\u63A5\u5B8C\u4E86"),
            h("span", null, "\u672C\u5C40\u63A5\u4E0A " + game.score + " \u53E5 \xB7 \u672C\u5B57\u6700\u4F73 " + Math.max(bestForChar, game.score) + " \u5C40 \xB7 \u5386\u53F2\u6700\u4F73 " + Math.max(best.overall, game.score) + " \u5C40"),
            h("span", null, "\u8FD9\u4E00\u5B57\u7684\u53E5\u5B50\u90FD\u88AB\u63A5\u8FC7\u4E86\uFF0C\u6362\u4E2A\u4EE4\u5B57\u7EE7\u7EED\u3002")
          ) : null,
          h(
            "div",
            { className: "dshp-fh-actions" },
            h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: (event) => {
                event.stopPropagation();
                randomChar();
              }
            }, "\u6362\u4E2A\u4EE4\u5B57"),
            h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: (event) => {
                event.stopPropagation();
                startGame(activeChar);
              }
            }, "\u91CD\u65B0\u5F00\u5C40")
          )
        );
      }
      function renderAtlas() {
        const total = charEntries.length;
        const limit = Math.min(FEIHUA_ATLAS_LIMIT, atlasLimit);
        const shown = charEntries.slice(0, limit);
        return h(
          "div",
          null,
          h(
            "div",
            { className: "dshp-card-summary", style: { marginBottom: "6px" } },
            "\u4EE4\u5B57\u300C" + activeChar + "\u300D\xB7 \u5171 " + total + " \u53E5\uFF08\u53BB\u91CD\u540E\u6700\u591A\u5C55\u793A " + FEIHUA_ATLAS_LIMIT + " \u6761\uFF09"
          ),
          shown.length ? h(
            "div",
            { className: "dshp-fh-atlas" },
            shown.map((entry, entryIndex) => h(
              "div",
              { key: entryIndex, className: "dshp-fh-line" },
              h("div", { className: "dshp-fh-line-text" }, entry.text),
              h("div", { className: "dshp-fh-line-source" }, "\u2014\u2014 " + entry.source)
            ))
          ) : h(EmptyState, { title: "\u8FD9\u4E00\u5B57\u6682\u65F6\u6CA1\u6709\u53E5\u5B50", message: "\u6362\u4E00\u4E2A\u4EE4\u5B57\u8BD5\u8BD5\u3002", icon: "\u{1FAB6}" }),
          total > shown.length ? h(
            "div",
            { style: { textAlign: "center", marginTop: "10px" } },
            h("button", {
              type: "button",
              className: "dshp-btn",
              onClick: () => setAtlasLimit(Math.min(FEIHUA_ATLAS_LIMIT, atlasLimit + FEIHUA_ATLAS_PAGE))
            }, "\u52A0\u8F7D\u66F4\u591A\uFF08\u5269\u4F59 " + (total - shown.length) + " \u6761\uFF09")
          ) : null
        );
      }
      return h(
        "div",
        null,
        h(
          "div",
          { className: "dshp-fh-chips" },
          candidateChips.map((item) => h("button", {
            key: item.char,
            type: "button",
            className: cx("dshp-fh-chip", item.char === activeChar && "dshp-is-active"),
            title: "\u4EE4\u5B57\u300C" + item.char + "\u300D\xB7 " + item.count + " \u53E5",
            "aria-pressed": item.char === activeChar,
            onClick: (event) => {
              event.stopPropagation();
              chooseChar(item.char);
            }
          }, item.char, h("small", null, String(item.count)))),
          h("button", {
            key: "random",
            type: "button",
            className: "dshp-fh-chip",
            title: "\u968F\u673A\u6362\u4E00\u4E2A\u4EE4\u5B57",
            onClick: (event) => {
              event.stopPropagation();
              randomChar();
            }
          }, "\u968F\u673A")
        ),
        h(
          "div",
          { className: "dshp-fh-meta" },
          h("span", null, fullInfo.char === activeChar ? fullInfo.status === "ready" ? "\u5168\u91CF\u6821\u9A8C\u5DF2\u542F\u7528\uFF08" + fullInfo.count + " \u53E5\uFF09" : fullInfo.status === "loading" || fullInfo.status === "idle" ? "\u6B63\u5728\u52A0\u8F7D\u5168\u91CF\u6821\u9A8C\u53E5\u5E93\u2026" : "\u5168\u91CF\u6821\u9A8C\u672A\u542F\u7528\uFF08\u4F7F\u7528\u672C\u5730\u53E5\u5E93\uFF09" : "\u6B63\u5728\u52A0\u8F7D\u5168\u91CF\u6821\u9A8C\u53E5\u5E93\u2026")
        ),
        feihuaBuilding ? h("div", { className: "dshp-card-summary" }, "\u6B63\u5728\u5E76\u5165\u5B8B\u8BCD\u5168\u5E93\u2026") : null,
        ciBankFailed ? h("div", { className: "dshp-card-summary" }, "\u5B8B\u8BCD\u5168\u5E93\u52A0\u8F7D\u5931\u8D25\uFF0C\u5DF2\u56DE\u9000\u539F\u53E5\u5E93") : null,
        h(
          "div",
          { className: "dshp-fh-meta" },
          h("span", null, "\u4EE4\u5B57 ", h("b", null, "\u300C" + activeChar + "\u300D")),
          h("span", null, "\u53E5\u5E93 ", h("b", null, String(charEntries.length)), " \u53E5"),
          h("span", null, "\u5386\u53F2\u6700\u4F73 ", h("b", null, String(best.overall)), " \u5206"),
          game ? h("span", null, "\u672C\u5C40\u63A5\u4E0A ", h("b", null, String(game.score)), " \u53E5") : null
        ),
        h(
          "div",
          { className: "dshp-seg", style: { marginBottom: "10px" } },
          h("button", {
            type: "button",
            className: cx("dshp-seg-btn", mode === "chain" && "dshp-is-active"),
            onClick: () => setMode("chain")
          }, "\u5BF9\u53E5"),
          h("button", {
            type: "button",
            className: cx("dshp-seg-btn", mode === "atlas" && "dshp-is-active"),
            onClick: () => setMode("atlas")
          }, "\u56FE\u9274")
        ),
        mode === "atlas" ? renderAtlas() : renderChain()
      );
    }
    function DetectionView(props) {
      const report = props.report;
      const api = props.api || {};
      if (!report) return null;
      const annotation = Array.isArray(report.annotation) ? report.annotation : [];
      const rhymeIndexes = detectionRhymeIndexes(report);
      const lines = [];
      for (let lineIndex = 0; lineIndex < annotation.length; lineIndex += 1) {
        const cells = annotation[lineIndex];
        const lineText = cells.map((cell) => cell.ch).join("");
        const toneText = cells.map((cell) => cell.tone === "\u25CB" ? "\u25CB" : cell.tone === "\uFF1F" ? "\uFF1F" : cell.tone).join("");
        lines.push(h(ToneLine, { key: lineIndex, line: lineText, tones: toneText, rhyme: Boolean(rhymeIndexes[lineIndex]), showTones: true }));
      }
      const multiTones = [];
      for (const line of annotation) {
        for (const cell of line) {
          if (cell.candidates.length > 1) multiTones.push(cell);
        }
      }
      return h(
        "div",
        { className: "dshp-detail" },
        h("div", { className: "dshp-lib-report" }, report.summary || ""),
        (report.errors || []).length ? h("div", { className: "dshp-lib-errors" }, report.errors.join("\uFF1B")) : null,
        h("div", { className: "dshp-lib-detect-lines" }, lines),
        report.rhymeLines && report.rhymeLines.length ? h("div", { className: "dshp-lib-tags" }, report.rhymeLines.map((item) => h(
          "span",
          { key: item.line, className: "dshp-tag" },
          "\u7B2C" + item.line + "\u53E5 " + item.ch + (item.names.length ? "\uFF08" + item.names.join("/") + "\uFF09" : "") + (item.borrowed ? " \u501F\u97F5" : "")
        ))) : null,
        report.violations && report.violations.length ? h("div", { className: "dshp-lib-errors" }, report.violations.map((item) => "\u7B2C" + item.line + "\u53E5\u7B2C" + item.position + "\u5B57\u300C" + item.ch + "\u300D\u5B9C" + item.expected + "\uFF08\u5B9E\u9645" + item.actual + "\uFF09").join("\uFF1B")) : null,
        report.sticky && report.sticky.length ? h("div", { className: "dshp-lib-errors" }, report.sticky.map((item) => "\u7B2C" + item.pair + "\u53E5\u5931" + item.type).join("\uFF1B")) : null,
        report.sanPing && report.sanPing.length ? h("div", { className: "dshp-lib-errors" }, "\u4E09\u5E73\u8C03\uFF1A\u7B2C " + report.sanPing.join("\u3001") + " \u53E5") : null,
        report.guPing && report.guPing.length ? h("div", { className: "dshp-lib-errors" }, "\u5B64\u5E73\uFF1A\u7B2C " + report.guPing.join("\u3001") + " \u53E5") : null,
        multiTones.length ? h("div", { className: "dshp-lib-multi" }, "\u591A\u97F3\u5B57\uFF1A" + multiTones.map((cell) => "\u300C" + cell.ch + "\u300D" + cell.candidates.map((item) => item.tone + "\xB7" + item.name).join("/")).join("\uFF1B")) : null,
        h(
          "div",
          { className: "dshp-fh-actions" },
          h("button", {
            type: "button",
            className: "dshp-btn dshp-btn-small",
            onClick: () => {
              const text = formatDetectionReport(report);
              try {
                if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).catch(() => {
                  });
                }
              } catch (error) {
              }
              if (typeof api.showToast === "function") api.showToast("\u68C0\u6D4B\u7ED3\u679C\u5DF2\u590D\u5236");
            }
          }, "\u590D\u5236\u7ED3\u679C")
        )
      );
    }
    return { FeihuaTab, DetectionView };
  }

  // client-src/library.js
  var LIBRARY_CATEGORY_ALIASES = { \u8BD7\u7ECF: "shijing", \u695A\u8F9E: "chuci", \u5343\u5BB6\u8BD7: "qianjiashi", \u5510\u8BD7\u4E09\u767E\u9996: "tang300", \u5168\u5510\u8BD7\u7CBE\u9009: "bank", \u5B8B\u8BCD\u7CBE\u9009: "ci-selected", \u5B8B\u8BCD\u5168\u5E93: "ci-bank" };
  var LIBRARY_PAGE = 30;
  function libraryCategoryOf(item, kind) {
    if (kind === "bank") return "bank";
    const raw = String(item && item.category != null ? item.category : "").trim();
    if (LIBRARY_CATEGORY_ALIASES[raw]) return LIBRARY_CATEGORY_ALIASES[raw];
    for (const label of Object.keys(LIBRARY_CATEGORY_ALIASES)) {
      if (raw.indexOf(label) >= 0) return LIBRARY_CATEGORY_ALIASES[label];
    }
    return "";
  }
  function buildLibraryItems(anthologyData, bankData, ciBankData, ciSelectedData) {
    const out = [];
    for (const item of anthologyData && Array.isArray(anthologyData.items) ? anthologyData.items : []) {
      if (!item) continue;
      const categoryId = libraryCategoryOf(item, "anthology");
      if (!categoryId) continue;
      out.push(Object.assign({}, item, { categoryId, source: "anthology" }));
    }
    for (const item of bankData && Array.isArray(bankData.items) ? bankData.items : []) {
      if (!item) continue;
      out.push(Object.assign({}, item, { categoryId: "bank", source: "bank" }));
    }
    for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
      if (!item) continue;
      out.push(Object.assign({}, item, { categoryId: "ci-bank", source: "ci-bank" }));
    }
    for (const item of ciSelectedLibraryItems(ciSelectedData)) out.push(item);
    return out;
  }
  function ciSelectedLibraryItems(ciData) {
    const out = [];
    for (const item of ciData && Array.isArray(ciData.items) ? ciData.items : []) {
      if (!item || !item.id) continue;
      const rhythmic = String(item.rhythmic || "");
      const firstLine = String(Array.isArray(item.lines) && item.lines[0] || "");
      const first = firstLine.replace(/[，。！？；、：,.!?;:·\s]/g, "").slice(0, 24);
      const title = rhythmic ? rhythmic + "\xB7" + (first || "\u65E0\u9898") : String(item.title || first || "\u65E0\u9898");
      out.push({
        id: String(item.id),
        author: String(item.author || ""),
        rhythmic,
        title,
        lines: Array.isArray(item.lines) ? item.lines : [],
        categoryId: "ci-selected",
        source: "ci-selected"
      });
    }
    return out;
  }
  function ciSelectedRhythmics(ciData) {
    const map = {};
    for (const item of ciData && Array.isArray(ciData.items) ? ciData.items : []) {
      const name = item && item.rhythmic ? String(item.rhythmic) : "";
      if (!name) continue;
      map[name] = (map[name] || 0) + 1;
    }
    return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a2, b) => b.count - a2.count || a2.name.localeCompare(b.name, "zh"));
  }
  function ciBankRhythmics(ciBankData) {
    const map = {};
    for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
      const name = item && item.rhythmic ? String(item.rhythmic) : "";
      if (!name) continue;
      map[name] = (map[name] || 0) + 1;
    }
    return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a2, b) => b.count - a2.count || a2.name.localeCompare(b.name, "zh"));
  }
  function filterLibraryItems(items, category, query, rhythmic) {
    const cat = category && category !== "all" ? category : "all";
    const keyword = String(query == null ? "" : query).trim().toLowerCase();
    const rhythm = rhythmic ? String(rhythmic) : "";
    return (Array.isArray(items) ? items : []).filter((item) => {
      if (!item) return false;
      if (cat !== "all" && item.categoryId !== cat) return false;
      if (rhythm && String(item.rhythmic || "") !== rhythm) return false;
      if (!keyword) return true;
      const hay = String(item.title || "") + " " + String(item.author || "") + " " + (Array.isArray(item.lines) ? item.lines.join("") : "");
      return hay.toLowerCase().indexOf(keyword) >= 0;
    });
  }
  function libraryPage(items, visible) {
    return (Array.isArray(items) ? items : []).slice(0, Math.max(0, Math.floor(num(visible, LIBRARY_PAGE))));
  }
  function libraryItemLabel(item) {
    const title = item && item.title ? String(item.title) : "\u65E0\u9898";
    const author = item && item.author ? String(item.author) : "";
    return author ? author + "\u300A" + title + "\u300B" : "\u300A" + title + "\u300B";
  }

  // client-src/tabs-library.js
  function createLibraryTab(ctx = {}) {
    const LIBRARY_CATEGORIES = ctx.LIBRARY_CATEGORIES;
    const React = ctx.React;
    const h = ctx.h;
    const cx = ctx.cx;
    const EmptyState = ctx.EmptyState;
    const LoadingState = ctx.LoadingState;
    const DetectionView = ctx.DetectionView;
    const ToneLine = ctx.ToneLine;
    const describeDataError = ctx.describeDataError;
    const Z_INDEX = ctx.Z_INDEX;
    const WIDGET_ID = ctx.WIDGET_ID;
    const MASCOT_FILES = ctx.MASCOT_FILES;
    const mascotUrl = ctx.mascotUrl;
    const detectPoem = ctx.detectPoem;
    const detectPoemText = ctx.detectPoemText;
    const parsePoemInput = ctx.parsePoemInput;
    const buildPingshuiIndex = ctx.buildPingshuiIndex;
    function LibraryTab(props) {
      const api = props.api || {};
      const anthologyRes = api.anthologyRes || {};
      const bankRes = api.bankRes || {};
      const pingshuiRes = api.pingshuiRes || {};
      const ciBankRes = api.ciBankRes || {};
      const ciRes = api.ciRes || {};
      const [category, setCategory] = React.useState("all");
      const [ciRhythmic, setCiRhythmic] = React.useState("");
      const [searchScope, setSearchScope] = React.useState("category");
      const [ciSearchScope, setCiSearchScope] = React.useState("selected");
      const [query, setQuery] = React.useState("");
      const [debounced, setDebounced] = React.useState("");
      const [visible, setVisible] = React.useState(LIBRARY_PAGE);
      const [detail, setDetail] = React.useState(null);
      const [detector, setDetector] = React.useState("");
      const [inputText, setInputText] = React.useState("");
      const [inputReport, setInputReport] = React.useState(null);
      const ciMode = category === "ci-selected" || category === "ci-bank";
      React.useEffect(() => {
        const timer2 = setTimeout(() => setDebounced(query), 300);
        return () => clearTimeout(timer2);
      }, [query]);
      React.useEffect(() => {
        setVisible(LIBRARY_PAGE);
      }, [category, debounced, ciRhythmic, ciSearchScope]);
      React.useEffect(() => {
        if (category === "ci-bank" || ciMode && ciSearchScope === "allCi") {
          if (typeof api.requestCiBank === "function") api.requestCiBank();
        }
      }, [category, ciMode, ciSearchScope, api.requestCiBank]);
      React.useEffect(() => {
        const focus = api.libraryFocus;
        if (!focus || !focus.token) return;
        if (focus.type === "ci") {
          setCategory("ci-bank");
          setCiRhythmic(String(focus.rhythmic || ""));
          setDetector("");
          if (typeof api.requestCiBank === "function") api.requestCiBank();
          if (typeof api.consumeLibraryFocus === "function") api.consumeLibraryFocus();
          return;
        }
        if (focus.type === "ci-selected") {
          setCategory("ci-selected");
          setCiRhythmic(String(focus.rhythmic || ""));
          setDetector("");
          if (typeof api.consumeLibraryFocus === "function") api.consumeLibraryFocus();
          return;
        }
        const items2 = buildLibraryItems(anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data);
        const target = items2.find((item) => item.id === focus.id);
        if (target) {
          setCategory(target.categoryId === "ci-bank" ? "ci-bank" : target.categoryId === "ci-selected" ? "ci-selected" : "all");
          setDetail(target);
          setDetector("");
        }
        if (typeof api.consumeLibraryFocus === "function") api.consumeLibraryFocus();
      }, [api.libraryFocus, anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data]);
      const pingshui = React.useMemo(() => pingshuiRes.data ? buildPingshuiIndex(pingshuiRes.data) : null, [pingshuiRes.data]);
      const items = React.useMemo(
        () => buildLibraryItems(anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data),
        [anthologyRes.data, bankRes.data, ciBankRes.data, ciRes.data]
      );
      const ciSelectedRhythmicsList = React.useMemo(() => ciSelectedRhythmics(ciRes.data), [ciRes.data]);
      const ciFullRhythmics = React.useMemo(() => ciBankRhythmics(ciBankRes.data), [ciBankRes.data]);
      const ciRhythmics = category === "ci-bank" ? ciFullRhythmics : ciSelectedRhythmicsList;
      const ciSelectedCount = items.filter((entry) => entry.categoryId === "ci-selected").length;
      let filterCategory = category;
      let filterRhythmic = "";
      if (ciMode) {
        filterRhythmic = ciRhythmic;
        filterCategory = !debounced ? category : ciSearchScope === "allCi" ? "all" : "ci-selected";
      } else if (searchScope === "all") {
        filterCategory = "all";
      }
      const filtered = React.useMemo(
        () => filterLibraryItems(items, filterCategory, debounced, filterRhythmic),
        [items, filterCategory, filterRhythmic, debounced]
      );
      const shown = libraryPage(filtered, visible);
      const poemReport = React.useMemo(
        () => detail && detector === "poem" && pingshui ? detectPoem(detail, pingshui) : null,
        [detail, detector, pingshui]
      );
      const pingshuiError = pingshuiRes.status === "error";
      const loading = !anthologyRes.data && !bankRes.data;
      const ciSelectedLoading = category === "ci-selected" && !ciRes.data;
      const ciBankLoading = category === "ci-bank" && !ciBankRes.data;
      function runInputDetection() {
        if (!pingshui) {
          if (typeof api.showToast === "function") api.showToast("\u5E73\u6C34\u97F5\u6570\u636E\u52A0\u8F7D\u4E2D\uFF0C\u8BF7\u7A0D\u5019");
          if (typeof api.reloadPingshui === "function") api.reloadPingshui().catch(() => {
          });
          return;
        }
        setInputReport(detectPoemText(inputText, pingshui));
      }
      if (loading) {
        if (anthologyRes.status === "error" && bankRes.status === "error") {
          return h(EmptyState, {
            title: "\u8BD7\u5E93\u6570\u636E\u6682\u65F6\u4E0D\u53EF\u7528",
            message: anthologyRes.error && anthologyRes.error.status === 404 || bankRes.error && bankRes.error.status === 404 ? "\u8BD7\u5E93\u6570\u636E\u5C1A\u672A\u751F\u6210\uFF08assets/data\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : describeDataError(anthologyRes.error || bankRes.error),
            onRetry: () => {
              if (typeof api.reloadAnthology === "function") api.reloadAnthology().catch(() => {
              });
              if (typeof api.reloadBank === "function") api.reloadBank().catch(() => {
              });
            }
          });
        }
        return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u8BD7\u5E93\u2026" });
      }
      function renderDetector() {
        if (!pingshui) {
          return pingshuiError ? h(EmptyState, { title: "\u5E73\u6C34\u97F5\u6570\u636E\u4E0D\u53EF\u7528", message: "\u683C\u5F8B\u68C0\u6D4B\u9700\u8981\u5E73\u6C34\u97F5\u6570\u636E\u3002", onRetry: () => api.reloadPingshui && api.reloadPingshui().catch(() => {
          }) }) : h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u5E73\u6C34\u97F5\u2026" });
        }
        const headers = h(
          "div",
          { className: "dshp-fh-actions" },
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => setDetector("") }, "\u8FD4\u56DE"),
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => setDetector("input") }, "\u81EA\u6D4B\u8F93\u5165")
        );
        if (detector === "poem" && detail) {
          return h(
            "div",
            { className: "dshp-detail" },
            headers,
            h("div", { className: "dshp-lib-detail-title" }, libraryItemLabel(detail)),
            h("div", { className: "dshp-lib-note" }, detail.tones ? "\u57FA\u4E8E\u6570\u636E\u5185\u5E73\u4EC4\u6807\u6CE8\u68C0\u6D4B" : "\u5DF2\u7528\u5E73\u6C34\u97F5\u9010\u5B57\u6807\u6CE8\uFF08\u591A\u97F3\u5B57\u53D6\u5019\u9009\uFF09"),
            h(DetectionView, { report: poemReport, api })
          );
        }
        return h(
          "div",
          { className: "dshp-detail" },
          headers,
          h("div", { className: "dshp-lib-note" }, "\u8F93\u5165 4 \u53E5\u6216 8 \u53E5\uFF08\u6BCF\u53E5 5 \u6216 7 \u5B57\uFF0C\u53EF\u542B\u6807\u70B9\uFF09\uFF0C\u9010\u5B57\u6807\u6CE8\u5E73\u4EC4\u4E0E\u97F5\u90E8\u3002"),
          h("textarea", {
            className: "dshp-textarea",
            rows: 6,
            value: inputText,
            placeholder: "\u4F8B\u5982\uFF1A\n\u7A7A\u5C71\u4E0D\u89C1\u4EBA\uFF0C\n\u4F46\u95FB\u4EBA\u8BED\u54CD\u3002\n\u8FD4\u666F\u5165\u6DF1\u6797\uFF0C\n\u590D\u7167\u9752\u82D4\u4E0A\u3002",
            onChange: (event) => setInputText(event.target.value)
          }),
          h(
            "div",
            { className: "dshp-fh-actions" },
            h("button", { type: "button", className: "dshp-btn dshp-btn-primary", onClick: runInputDetection }, "\u5F00\u59CB\u68C0\u6D4B"),
            h("button", { type: "button", className: "dshp-btn", onClick: () => {
              setInputText("");
              setInputReport(null);
            } }, "\u6E05\u7A7A")
          ),
          inputReport ? h(DetectionView, { report: inputReport, api }) : null
        );
      }
      if (detector) {
        return h(
          "div",
          null,
          h(
            "div",
            { className: "dshp-fh-chips" },
            h("button", { type: "button", className: "dshp-fh-chip", onClick: () => setDetector("input") }, "\u81EA\u6D4B\u8F93\u5165"),
            detail ? h("button", { type: "button", className: "dshp-fh-chip dshp-is-active", onClick: () => setDetector("poem") }, "\u68C0\u6D4B\u300A" + detail.title + "\u300B") : null
          ),
          renderDetector()
        );
      }
      if (detail) {
        const rhymeIndexes = detail.tones && Array.isArray(detail.rhymeIdx) ? detail.rhymeIdx : [];
        const rhymeSet = {};
        for (const index2 of rhymeIndexes) rhymeSet[index2] = true;
        const rows = [];
        const lines = Array.isArray(detail.lines) ? detail.lines : [];
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          rows.push(h(ToneLine, {
            key: lineIndex,
            line: lines[lineIndex],
            tones: detail.tones ? detail.tones[lineIndex] : "",
            rhyme: Boolean(rhymeSet[lineIndex]),
            showTones: Boolean(detail.tones)
          }));
        }
        return h(
          "div",
          { className: "dshp-detail" },
          h(
            "div",
            { className: "dshp-fh-actions" },
            h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => {
              setDetail(null);
              setDetector("");
            } }, "\u2190 \u8FD4\u56DE\u5217\u8868"),
            h("button", { type: "button", className: "dshp-btn dshp-btn-small dshp-btn-primary", onClick: () => {
              setDetector("poem");
              if (typeof api.reloadPingshui === "function" && !pingshui) api.reloadPingshui().catch(() => {
              });
            } }, "\u683C\u5F8B\u68C0\u6D4B")
          ),
          h("div", { className: "dshp-lib-detail-title" }, libraryItemLabel(detail)),
          h(
            "div",
            { className: "dshp-lib-note" },
            ((LIBRARY_CATEGORIES.find((item) => item.id === detail.categoryId) || {}).label || detail.categoryId) + (detail.rhythmic ? " \xB7 \u8BCD\u724C " + detail.rhythmic : "")
          ),
          detail.tones ? h("div", { className: "dshp-lib-lines" }, rows) : h("div", { className: "dshp-lib-plain" }, lines.map((line, index2) => h("div", { key: index2 }, line))),
          detail.tones ? h(
            "div",
            { className: "dshp-lib-tags" },
            detail.form ? h("span", { className: "dshp-tag" }, "\u4F53\u5F0F " + detail.form) : null,
            detail.start ? h("span", { className: "dshp-tag" }, "\u8D77\u5F0F " + detail.start) : null,
            detail.meter ? h("span", { className: "dshp-tag" }, detail.meter) : null
          ) : h("div", { className: "dshp-lib-note" }, "\u672A\u6807\u6CE8\u5E73\u4EC4\uFF08\u53EF\u70B9\u300C\u683C\u5F8B\u68C0\u6D4B\u300D\u7528\u5E73\u6C34\u97F5\u9010\u5B57\u6807\u6CE8\uFF09")
        );
      }
      const ciModeActive = category === "ci-selected" || category === "ci-bank";
      return h(
        "div",
        { className: "dshp-library" },
        h(
          "div",
          { className: "dshp-fh-chips" },
          h("button", { type: "button", className: "dshp-fh-chip" + (category === "all" ? " dshp-is-active" : ""), onClick: () => setCategory("all") }, "\u5168\u90E8 " + items.length),
          LIBRARY_CATEGORIES.map((item) => {
            const count = item.id === "ci-selected" ? ciRes.data ? ciSelectedCount : "\u2026" : items.filter((entry) => entry.categoryId === item.id).length;
            return h("button", {
              key: item.id,
              type: "button",
              className: "dshp-fh-chip" + (category === item.id ? " dshp-is-active" : ""),
              onClick: () => setCategory(item.id)
            }, item.label + " " + count);
          })
        ),
        ciModeActive ? h(
          "div",
          { className: "dshp-search", style: { marginTop: 0 } },
          h(
            "div",
            { className: "dshp-seg" },
            h("button", {
              type: "button",
              className: "dshp-seg-btn" + (category === "ci-selected" ? " dshp-is-active" : ""),
              onClick: () => setCategory("ci-selected")
            }, "\u5B8B\u8BCD\u7CBE\u9009 " + (ciRes.data ? ciSelectedCount : "\u2026")),
            h("button", {
              type: "button",
              className: "dshp-seg-btn" + (category === "ci-bank" ? " dshp-is-active" : ""),
              onClick: () => {
                setCategory("ci-bank");
              }
            }, "\u5168\u90E8\u5B8B\u8BCD" + (ciBankRes.data ? "\uFF08" + num(ciBankRes.data.count, items.filter((entry) => entry.categoryId === "ci-bank").length) + "\uFF09" : "\uFF08\u70B9\u51FB\u52A0\u8F7D\uFF09"))
          ),
          h(
            "select",
            {
              className: "dshp-select",
              value: ciRhythmic,
              "aria-label": category === "ci-bank" ? "\u6309\u8BCD\u724C\u7B5B\u9009\u5168\u90E8\u5B8B\u8BCD" : "\u6309\u8BCD\u724C\u7B5B\u9009\u5B8B\u8BCD\u7CBE\u9009",
              onChange: (event) => setCiRhythmic(event.target.value)
            },
            h("option", { value: "" }, "\u5168\u90E8\u8BCD\u724C"),
            (ciRhythmic && !ciRhythmics.some((entry) => entry.name === ciRhythmic) ? [{ name: ciRhythmic, count: 0 }].concat(ciRhythmics) : ciRhythmics).slice(0, 300).map((entry) => h("option", { key: entry.name, value: entry.name }, entry.name + "\uFF08" + entry.count + "\uFF09"))
          ),
          h("span", { className: "dshp-pager-label" }, category === "ci-bank" ? ciBankRes.data ? "\u5DF2\u8F7D\u5165 " + num(ciBankRes.data.count, items.filter((entry) => entry.categoryId === "ci-bank").length) + " \u9996" : "\u8F7D\u5165\u4E2D\u2026" : ciRes.data ? "\u5DF2\u8F7D\u5165 " + ciSelectedCount + " \u9996" : "\u8F7D\u5165\u4E2D\u2026")
        ) : null,
        h(
          "div",
          { className: "dshp-search" },
          h("input", {
            className: "dshp-input",
            type: "search",
            value: query,
            placeholder: "\u641C\u7D22\u6807\u9898 / \u4F5C\u8005 / \u8BCD\u724C / \u8BD7\u53E5",
            "aria-label": "\u641C\u7D22\u8BD7\u5E93",
            onChange: (event) => setQuery(event.target.value)
          }),
          h("button", { type: "button", className: "dshp-btn dshp-btn-small", onClick: () => setDetector("input") }, "\u683C\u5F8B\u81EA\u6D4B")
        ),
        debounced ? h(
          "div",
          { className: "dshp-search", style: { marginBottom: "4px" } },
          h("span", { className: "dshp-pager-label" }, "\u641C\u7D22\u8303\u56F4"),
          ciModeActive ? h(
            "div",
            { className: "dshp-seg" },
            h("button", {
              type: "button",
              className: "dshp-seg-btn" + (ciSearchScope === "selected" ? " dshp-is-active" : ""),
              onClick: () => setCiSearchScope("selected")
            }, "\u7CBE\u9009"),
            h("button", {
              type: "button",
              className: "dshp-seg-btn" + (ciSearchScope === "allCi" ? " dshp-is-active" : ""),
              onClick: () => {
                setCiSearchScope("allCi");
              }
            }, "\u5168\u90E8\u5B8B\u8BCD")
          ) : h(
            "div",
            { className: "dshp-seg" },
            h("button", {
              type: "button",
              className: "dshp-seg-btn" + (searchScope === "category" ? " dshp-is-active" : ""),
              onClick: () => setSearchScope("category")
            }, "\u5F53\u524D\u5206\u7C7B"),
            h("button", {
              type: "button",
              className: "dshp-seg-btn" + (searchScope === "all" ? " dshp-is-active" : ""),
              onClick: () => setSearchScope("all")
            }, "\u5168\u90E8")
          ),
          ciModeActive && ciSearchScope === "allCi" && !ciBankRes.data ? h("span", { className: "dshp-pager-label" }, ciBankRes.status === "loading" ? "\u5B8B\u8BCD\u5168\u5E93\u52A0\u8F7D\u4E2D\uFF0C\u6682\u53EA\u641C\u7CBE\u9009\u2026" : "\u5B8B\u8BCD\u5168\u5E93\u672A\u52A0\u8F7D\uFF0C\u6682\u53EA\u641C\u7CBE\u9009") : null
        ) : null,
        ciSelectedLoading ? ciRes.status === "error" ? h(EmptyState, {
          title: "\u5B8B\u8BCD\u7CBE\u9009\u6682\u65F6\u4E0D\u53EF\u7528",
          message: describeDataError(ciRes.error),
          onRetry: () => api.reloadCi && api.reloadCi().catch(() => {
          })
        }) : h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u5B8B\u8BCD\u7CBE\u9009 283 \u9996\u2026" }) : ciBankLoading ? ciBankRes.status === "error" ? h(EmptyState, {
          title: "\u5168\u90E8\u5B8B\u8BCD\u6682\u65F6\u4E0D\u53EF\u7528",
          message: ciBankRes.error && ciBankRes.error.status === 404 ? "\u5B8B\u8BCD\u5168\u5E93\u6570\u636E\u5C1A\u672A\u751F\u6210\uFF08assets/data\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : describeDataError(ciBankRes.error),
          onRetry: () => api.reloadCiBank && api.reloadCiBank().catch(() => {
          })
        }) : h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u5168\u90E8\u5B8B\u8BCD\uFF08\u7EA6 2 \u4E07\u9996\uFF0C\u9996\u6B21\u7A0D\u6162\uFF09\u2026" }) : h(
          "div",
          null,
          h("div", { className: "dshp-card-summary", style: { marginBottom: "6px" } }, "\u5171 " + filtered.length + " \u9996" + (debounced !== query ? "\uFF08\u641C\u7D22\u4E2D\u2026\uFF09" : "")),
          shown.length ? h("div", { className: "dshp-list" }, shown.map((item) => h("button", {
            key: item.id,
            type: "button",
            className: "dshp-row",
            onClick: () => setDetail(item)
          }, h(
            "span",
            { className: "dshp-row-main" },
            h("span", { className: "dshp-row-title" }, libraryItemLabel(item)),
            h("span", { className: "dshp-row-sub" }, (item.rhythmic ? "\u8BCD\u724C " + item.rhythmic + " \xB7 " : "") + ((Array.isArray(item.lines) ? item.lines[0] : "") || ""))
          )))) : h(EmptyState, { title: "\u6CA1\u6709\u5339\u914D\u7684\u8BD7\u8BCD", message: "\u6362\u4E00\u4E2A\u5206\u7C7B\u6216\u5173\u952E\u8BCD\u8BD5\u8BD5\u3002", icon: "\u{1F4DA}" })
        ),
        filtered.length > shown.length ? h(
          "div",
          { style: { textAlign: "center", marginTop: "10px" } },
          h("button", { type: "button", className: "dshp-btn", onClick: () => setVisible(visible + LIBRARY_PAGE) }, "\u52A0\u8F7D\u66F4\u591A\uFF08\u5269\u4F59 " + (filtered.length - shown.length) + " \u9996\uFF09")
        ) : null
      );
    }
    class WidgetBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
        this.handleRetry = this.handleRetry.bind(this);
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        try {
          console.warn("[dsh-little-whale] \u6E32\u67D3\u5F02\u5E38\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u6700\u5C0F\u5F62\u8C61\uFF1A", error);
        } catch (ignored) {
        }
      }
      handleRetry() {
        this.setState({ failed: false });
      }
      render() {
        if (!this.state.failed) return this.props.children;
        return h(
          "div",
          {
            "data-dsh-little-whale": "root",
            className: "dshp-root",
            style: {
              position: "fixed",
              left: "16px",
              bottom: "24px",
              zIndex: Z_INDEX,
              pointerEvents: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "6px",
              padding: "8px"
            }
          },
          h("style", null, CSS),
          h("img", {
            src: mascotUrl(MASCOT_FILES.celebrate),
            alt: "\u5C0F\u9CB8\u9C7C\u6302\u4EF6",
            width: 64,
            height: 64,
            draggable: false,
            style: { display: "block" }
          }),
          h("button", {
            type: "button",
            className: "dshp-btn",
            onClick: this.handleRetry
          }, "\u6302\u4EF6\u663E\u793A\u5F02\u5E38\uFF0C\u70B9\u6B64\u91CD\u8BD5")
        );
      }
    }
    return { LibraryTab, WidgetBoundary };
  }

  // client-src/styles.js
  var CSS2 = [
    ".dshp-root{--dshp-bg:var(--dsw-alias-bg-module-platform,#fff);",
    "--dshp-bg-soft:var(--dsw-alias-bg-base-platform,#f6f7f9);",
    "--dshp-label:var(--dsw-alias-label-primary,#1f2329);",
    "--dshp-label-2:var(--dsw-alias-label-secondary,#646a73);",
    "--dshp-border:var(--dsw-alias-border-l2,#e3e5e8);",
    "--dshp-border-3:var(--dsw-alias-border-l3,#c9cdd6);",
    "--dshp-hover:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.06));",
    "--dshp-accent:var(--dsw-static-accent,#4d6bfe);",
    "--dshp-ping:#2563eb;--dshp-ze:#dc2626;--dshp-any:#6b7280;",
    "--dshp-danger:#dc2626;",
    "--dshp-shadow:0 12px 40px rgba(0,0,0,.18);",
    "position:fixed;pointer-events:auto;color:var(--dshp-label);font-size:13px;line-height:1.45;",
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
    "text-align:left;-webkit-font-smoothing:antialiased}",
    ".dshp-root *,.dshp-root *::before,.dshp-root *::after{box-sizing:border-box}",
    ".dshp-stage{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;",
    "cursor:grab;touch-action:none;border-radius:24px}",
    ".dshp-stage:active{cursor:grabbing}",
    ".dshp-stage:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:4px}",
    ".dshp-mascot{width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;",
    "filter:drop-shadow(0 10px 22px rgba(0,0,0,.22));animation:dshp-float 4.2s ease-in-out infinite}",
    ".dshp-stage.dshp-dizzy{animation:dshp-dizzy-wobble 500ms ease-in-out 3}",
    "@keyframes dshp-dizzy-wobble{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-3px) rotate(-2deg)}75%{transform:translateX(3px) rotate(2deg)}}",
    ".dshp-dizzy-stars{position:absolute;top:-4px;left:50%;transform:translateX(-50%);font-size:20px;line-height:1;animation:dshp-dizzy-float 900ms ease-in-out infinite;pointer-events:none;z-index:3}",
    "@keyframes dshp-dizzy-float{0%,100%{transform:translate(-50%,0);opacity:.75}50%{transform:translate(-50%,-6px);opacity:1}}",
    ".dshp-dizzy-tip{position:absolute;bottom:-26px;left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--dshp-bg);border:1px solid var(--dshp-border);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--dshp-label);box-shadow:var(--dshp-shadow);pointer-events:none;z-index:3}",
    ".dshp-self-being{display:flex;flex-direction:column;gap:6px;margin-top:2px}",
    ".dshp-self-felt{font-size:13px;line-height:1.65;color:var(--dshp-label-1)}",
    ".dshp-self-context{display:flex;flex-direction:column;gap:3px;font-size:11.5px;line-height:1.5;color:var(--dshp-label-2)}",
    ".dshp-self-summary{margin-top:6px;font-size:11.5px;line-height:1.5;color:var(--dshp-label-2)}",
    ".dshp-mascot-img,.dshp-mascot-video{width:100%;height:100%;pointer-events:none;user-select:none;-webkit-user-drag:none}",
    ".dshp-mascot-img{object-fit:contain}",
    /* 640x360 的 webm 人物只占画面高约 83%，方形挂件里 contain 会显得小；cover 裁掉两侧透明边并轻微放大，视觉高度与 512x512 静态图对齐 */
    ".dshp-mascot-video{object-fit:cover;object-position:center;background:transparent;transform:scale(1.12)}",
    ".dshp-mascot-img.dshp-mascot-swap,.dshp-mascot-video.dshp-mascot-swap{animation:dshp-mascot-fade 220ms ease-out}",
    "@keyframes dshp-mascot-fade{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}",
    "@keyframes dshp-float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.012)}}",
    ".dshp-weather{display:flex;flex-direction:column;gap:3px;align-items:center;margin:2px 0 6px}",
    ".dshp-weather-chip{display:inline-flex;align-items:center;gap:4px;background:var(--dshp-bg-soft);",
    "border:1px solid var(--dshp-border);border-radius:999px;padding:2px 9px;font-size:11.5px;color:var(--dshp-label-2)}",
    ".dshp-weather-note{font-size:11px;color:var(--dshp-label-2);opacity:.85;text-align:center}",
    ".dshp-chip-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}",
    ".dshp-mood-chip{border-color:var(--dshp-accent);color:var(--dshp-accent)}",
    ".dshp-spont{position:fixed;z-index:63;display:flex;flex-direction:column;gap:6px;background:var(--dshp-bg);",
    "border:1px solid var(--dshp-border);border-radius:14px;padding:10px 12px;box-shadow:var(--dshp-shadow);",
    "animation:dshp-pop 160ms ease-out}",
    ".dshp-spont-title{font-size:11.5px;color:var(--dshp-label-2)}",
    '.dshp-spont-sentence{font-family:"Noto Serif SC","Songti SC",serif;font-size:14px;line-height:1.7;',
    "white-space:normal;word-break:break-word;color:var(--dshp-label);cursor:pointer;max-height:72px;",
    "overflow-y:auto;overscroll-behavior:contain;border-radius:6px}",
    ".dshp-spont-sentence:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:2px}",
    ".dshp-spont-sentence:hover{color:var(--dshp-accent)}",
    ".dshp-spont-source{font-size:11.5px;color:var(--dshp-label-2)}",
    ".dshp-spont-prefix{font-size:12px;color:var(--dshp-label-2);line-height:1.55}",
    ".dshp-spont-thinking{font-size:13px;color:var(--dshp-label-2);line-height:1.6}",
    ".dshp-spont-actions{display:flex;gap:8px;justify-content:flex-end}",
    ".dshp-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);",
    "white-space:nowrap;background:var(--dshp-bg);color:var(--dshp-label);border:1px solid var(--dshp-border);",
    "border-radius:999px;padding:4px 10px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,.12);",
    "animation:dshp-pulse 2.4s ease-in-out infinite;pointer-events:none}",
    "@keyframes dshp-pulse{0%,100%{opacity:.82}50%{opacity:1}}",
    ".dshp-restore{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;",
    "background:var(--dshp-bg);border:1px dashed var(--dshp-border-3);color:var(--dshp-label-2);font-size:12px;",
    "cursor:pointer;opacity:.35;transition:opacity 160ms ease;box-shadow:0 2px 8px rgba(0,0,0,.12)}",
    ".dshp-restore:hover{opacity:1}",
    ".dshp-bubble{position:fixed;z-index:61;display:flex;flex-direction:column;background:var(--dshp-bg);",
    "border:1px solid var(--dshp-border);border-radius:16px;box-shadow:var(--dshp-shadow);overflow:hidden;",
    "animation:dshp-pop 160ms ease-out}",
    "@keyframes dshp-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}",
    ".dshp-bubble-head{display:flex;align-items:center;gap:8px;padding:10px 8px 6px 14px}",
    ".dshp-bubble-title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dshp-label-2);",
    "letter-spacing:.02em;display:flex;align-items:center;gap:8px}",
    ".dshp-bubble-body{padding:2px 14px 4px;overflow-y:auto;overscroll-behavior:contain}",
    ".dshp-bubble-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px 10px;",
    "border-top:1px solid var(--dshp-border);background:var(--dshp-bg-soft)}",
    ".dshp-bubble,.dshp-panel{user-select:text}",
    ".dshp-bubble-step-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dshp-progress{flex:none;font-weight:400;font-size:11px;color:var(--dshp-label-2);letter-spacing:0}",
    ".dshp-dots{display:inline-flex;gap:6px;flex:none;align-items:center}",
    ".dshp-dot{appearance:none;width:7px;height:7px;padding:0;border:0;border-radius:50%;",
    "background:var(--dshp-border-3);cursor:pointer;transition:background 120ms ease,transform 120ms ease}",
    ".dshp-dot:hover{background:var(--dshp-label-2);transform:scale(1.2)}",
    ".dshp-dot:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:2px}",
    ".dshp-dot.dshp-is-active{background:var(--dshp-accent);transform:scale(1.1)}",
    ".dshp-dot-collapse{background:transparent;border:1px solid var(--dshp-border-3)}",
    ".dshp-dot-collapse:hover{background:var(--dshp-hover);border-color:var(--dshp-label-2);transform:none}",
    ".dshp-btn{appearance:none;border:1px solid var(--dshp-border-3);background:transparent;color:inherit;",
    "border-radius:9px;padding:5px 12px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;",
    "transition:background 120ms ease,border-color 120ms ease}",
    ".dshp-btn:hover{background:var(--dshp-hover)}",
    ".dshp-btn:disabled{opacity:.45;cursor:default}",
    ".dshp-btn-primary{background:var(--dshp-accent);border-color:transparent;color:#fff}",
    ".dshp-btn-primary:hover{background:var(--dshp-accent);filter:brightness(1.06)}",
    ".dshp-btn-danger{color:var(--dshp-danger);border-color:rgba(220,38,38,.42)}",
    ".dshp-btn-small{padding:3px 9px;font-size:11.5px}",
    ".dshp-icon-btn{appearance:none;border:0;background:transparent;color:var(--dshp-label-2);width:24px;height:24px;",
    "border-radius:6px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex:none}",
    ".dshp-icon-btn:hover{background:var(--dshp-hover);color:var(--dshp-label)}",
    ".dshp-link{appearance:none;border:0;background:transparent;color:var(--dshp-accent);font:inherit;",
    "font-size:11.5px;cursor:pointer;padding:0}",
    ".dshp-link:hover{text-decoration:underline}",
    ".dshp-spacer{flex:1}",
    ".dshp-poem{padding:4px 0 6px}",
    ".dshp-poem-title{font-size:17px;font-weight:700;text-align:center;letter-spacing:.04em;",
    'font-family:"Noto Serif SC","Songti SC","STSong",serif}',
    ".dshp-poem-author{text-align:center;color:var(--dshp-label-2);font-size:12px;margin-top:2px}",
    ".dshp-poem-lines{margin-top:8px;display:flex;flex-direction:column;gap:2px;align-items:center}",
    ".dshp-line{display:flex;justify-content:center;flex-wrap:nowrap}",
    ".dshp-ch{display:inline-flex;flex-direction:column;align-items:center;min-width:1.15em;padding:0 .04em}",
    ".dshp-tone{font-size:9px;line-height:11px;height:11px;font-family:ui-monospace,Menlo,monospace;",
    "color:var(--dshp-label-2);opacity:.85}",
    '.dshp-chr{font-family:"Noto Serif SC","Songti SC","STSong",serif;font-size:18px;line-height:24px;',
    "color:var(--dshp-label)}",
    ".dshp-ch-ping .dshp-tone{color:var(--dshp-ping)}",
    ".dshp-ch-ping .dshp-chr{color:var(--dshp-ping)}",
    ".dshp-ch-ze .dshp-tone{color:var(--dshp-ze)}",
    ".dshp-ch-ze .dshp-chr{color:var(--dshp-ze)}",
    ".dshp-ch-any .dshp-tone{color:var(--dshp-any)}",
    ".dshp-ch-any .dshp-chr{color:var(--dshp-any)}",
    ".dshp-ch-punct .dshp-chr{color:var(--dshp-label-2);opacity:.8}",
    ".dshp-ch-rhyme .dshp-chr{border-bottom:2px solid var(--dshp-accent);padding-bottom:1px}",
    ".dshp-legend{display:flex;gap:12px;justify-content:center;margin-top:10px;color:var(--dshp-label-2);",
    "font-size:11px;flex-wrap:wrap}",
    ".dshp-legend-item{display:inline-flex;align-items:center;gap:4px}",
    ".dshp-legend-dot{width:7px;height:7px;border-radius:50%;display:inline-block}",
    ".dshp-legend-line{width:12px;height:2px;background:var(--dshp-accent);display:inline-block;border-radius:2px}",
    ".dshp-analysis{display:flex;flex-direction:column;gap:8px;padding:2px 0 4px}",
    ".dshp-kv{display:flex;gap:10px;font-size:12.5px}",
    ".dshp-kv-key{color:var(--dshp-label-2);min-width:64px;flex:none}",
    ".dshp-kv-val{color:var(--dshp-label);min-width:0;word-break:break-word}",
    ".dshp-block{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:10px;",
    "padding:8px 10px;font-size:12.5px;line-height:1.65}",
    ".dshp-tags{display:flex;flex-wrap:wrap;gap:6px}",
    ".dshp-tag{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:999px;",
    "padding:2px 9px;font-size:11.5px;color:var(--dshp-label-2)}",
    ".dshp-card{display:flex;flex-direction:column;gap:6px}",
    ".dshp-card-title{font-size:15px;font-weight:700}",
    ".dshp-card-summary{color:var(--dshp-label-2);font-size:12.5px}",
    ".dshp-ellipsis{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dshp-p{margin:0;font-size:12.5px;line-height:1.65}",
    ".dshp-example{border-left:3px solid var(--dshp-accent);background:var(--dshp-bg-soft);",
    "border-radius:0 8px 8px 0;padding:6px 10px;margin:0}",
    '.dshp-example-text{font-family:"Noto Serif SC","Songti SC",serif;font-size:13px}',
    ".dshp-example-note{color:var(--dshp-label-2);font-size:11.5px;margin-top:2px}",
    ".dshp-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 2px}",
    ".dshp-pager-label{color:var(--dshp-label-2);font-size:12px}",
    '.dshp-ci-lines{display:flex;flex-direction:column;gap:2px;font-family:"Noto Serif SC","Songti SC",serif;',
    "font-size:13px;line-height:1.7;padding:6px 2px}",
    ".dshp-muted{color:var(--dshp-label-2)}",
    ".dshp-panel{position:fixed;z-index:62;width:min(420px,calc(100vw - 16px));height:min(560px,calc(100vh - 16px));",
    "display:flex;flex-direction:column;background:var(--dshp-bg);border:1px solid var(--dshp-border);",
    "border-radius:18px;box-shadow:var(--dshp-shadow);overflow:hidden;animation:dshp-pop 160ms ease-out}",
    ".dshp-panel-head{display:flex;align-items:center;gap:10px;padding:12px 12px 8px 16px}",
    ".dshp-panel-title{flex:1;min-width:0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}",
    ".dshp-panel-title small{color:var(--dshp-label-2);font-weight:400;font-size:11.5px;white-space:nowrap;",
    "overflow:hidden;text-overflow:ellipsis}",
    ".dshp-tabs{display:flex;gap:4px;padding:0 12px 8px;border-bottom:1px solid var(--dshp-border)}",
    ".dshp-tab{flex:1;appearance:none;border:0;background:transparent;color:var(--dshp-label-2);border-radius:9px;",
    "padding:6px 0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 120ms ease}",
    ".dshp-tab:hover{background:var(--dshp-hover)}",
    ".dshp-tab.dshp-is-active{background:var(--dshp-accent);color:#fff;font-weight:600}",
    ".dshp-subtabs{display:flex;gap:2px;padding:6px 12px 8px;border-bottom:1px solid var(--dshp-border);overflow-x:auto}",
    ".dshp-subtab{flex:none;appearance:none;border:0;background:transparent;color:var(--dshp-label-2);border-radius:7px;",
    "padding:4px 9px;font:inherit;font-size:11.5px;cursor:pointer;transition:background 120ms ease;white-space:nowrap}",
    ".dshp-subtab:hover{background:var(--dshp-hover)}",
    ".dshp-subtab.dshp-is-active{background:var(--dshp-bg-soft);color:var(--dshp-label);font-weight:600}",
    ".dshp-growth{display:flex;flex-direction:column;gap:12px;padding-bottom:4px}",
    '.dshp-growth-title{font-family:"Noto Serif SC","Songti SC",serif;font-size:20px;font-weight:700;letter-spacing:.04em}',
    ".dshp-growth-mood{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:12px;padding:10px 12px}",
    ".dshp-growth-mood-label{font-size:15px;font-weight:600}",
    ".dshp-growth-mood-reason{margin-top:3px;font-size:12.5px;color:var(--dshp-label-2);line-height:1.5}",
    ".dshp-growth-mood-source{margin-top:4px;font-size:11px;color:var(--dshp-label-2);opacity:.85}",
    ".dshp-growth-section{display:flex;flex-direction:column;gap:6px}",
    ".dshp-growth-section-head{font-size:11.5px;font-weight:600;color:var(--dshp-label-2);letter-spacing:.04em}",
    '.dshp-growth-quote{font-family:"Noto Serif SC","Songti SC",serif;font-size:13px;line-height:1.6;color:var(--dshp-label);padding:4px 0;border-bottom:1px dashed var(--dshp-border)}',
    ".dshp-growth-quote:last-child{border-bottom:0}",
    ".dshp-growth-empty{font-size:12px;color:var(--dshp-label-2)}",
    ".dshp-growth-sleep{font-size:12px;color:var(--dshp-accent);margin-bottom:2px}",
    ".dshp-growth-action{display:flex;gap:8px;font-size:12px;line-height:1.55;padding:3px 0;border-bottom:1px dashed var(--dshp-border)}",
    ".dshp-growth-action:last-child{border-bottom:0}",
    ".dshp-growth-action-time{flex:none;color:var(--dshp-label-2);font-variant-numeric:tabular-nums}",
    ".dshp-growth-action-text{color:var(--dshp-label);min-width:0;word-break:break-word}",
    ".dshp-growth-actions{display:flex;gap:6px;flex-wrap:wrap;padding-top:2px}",
    ".dshp-growth-mood-controls{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:7px;border-top:1px solid var(--dshp-border)}",
    ".dshp-growth-mood-control-label{font-size:12px;color:var(--dshp-label-2)}",
    ".dshp-growth-mood-note{margin-top:5px;font-size:11.5px;line-height:1.5;color:var(--dshp-label-2)}",
    ".dshp-memory-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    ".dshp-memory-health{font-size:10.5px;border-radius:999px;padding:1px 8px;border:1px solid var(--dshp-border)}",
    ".dshp-memory-ok{color:#16803c;border-color:rgba(22,128,60,.45);background:rgba(22,128,60,.08)}",
    ".dshp-memory-warn{color:#9a6700;border-color:rgba(154,103,0,.45);background:rgba(154,103,0,.08)}",
    ".dshp-memory-error{color:#c62828;border-color:rgba(198,40,40,.45);background:rgba(198,40,40,.08)}",
    ".dshp-memory-line{font-size:12px;line-height:1.55;color:var(--dshp-label-2)}",
    ".dshp-memory-recovered{color:var(--dshp-label)}",
    ".dshp-panel-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 18px}",
    ".dshp-list{display:flex;flex-direction:column;gap:2px}",
    ".dshp-row{display:flex;align-items:flex-start;gap:8px;padding:8px 6px;border-radius:9px;border:0;",
    "background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}",
    ".dshp-row:hover{background:var(--dshp-hover)}",
    ".dshp-row.dshp-is-open{background:var(--dshp-bg-soft)}",
    ".dshp-row-main{flex:1;min-width:0}",
    ".dshp-row-title{font-size:13px;line-height:1.4;word-break:break-word}",
    ".dshp-row-sub{color:var(--dshp-label-2);font-size:11.5px}",
    ".dshp-row-body{padding:2px 8px 8px}",
    ".dshp-search{display:flex;gap:8px;margin-bottom:10px}",
    ".dshp-input,.dshp-select{appearance:none;border:1px solid var(--dshp-border-3);background:var(--dshp-bg);",
    "color:var(--dshp-label);border-radius:9px;padding:6px 10px;font:inherit;font-size:12.5px;min-width:0}",
    ".dshp-input{flex:1}",
    ".dshp-input:focus,.dshp-select:focus{border-color:var(--dshp-accent);outline:none}",
    ".dshp-select{max-width:136px}",
    ".dshp-settings{display:flex;flex-direction:column;gap:2px}",
    ".dshp-field{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 2px;",
    "border-bottom:1px solid var(--dshp-border)}",
    ".dshp-field:last-child{border-bottom:0}",
    ".dshp-field-stacked{flex-direction:column;align-items:stretch;gap:6px}",
    ".dshp-field-stacked .dshp-field-label{flex-direction:row;align-items:baseline;gap:8px;flex-wrap:wrap}",
    ".dshp-field-stack-body{width:100%;min-width:0}",
    ".dshp-work{display:flex;flex-direction:column;gap:5px;padding:6px 0;border-bottom:1px dashed var(--dshp-border)}",
    ".dshp-work:last-child{border-bottom:0}",
    ".dshp-work-title{font-size:12.5px;font-weight:600}",
    ".dshp-work-art{width:100%;max-height:170px;object-fit:contain;border-radius:10px;border:1px solid var(--dshp-border);background:#fff}",
    ".dshp-work-time{font-size:10.5px;color:var(--dshp-label-2);font-variant-numeric:tabular-nums}",
    ".dshp-health-line{font-size:11.5px;line-height:1.6;color:var(--dshp-label-2);word-break:break-word}",
    ".dshp-field-label{display:flex;flex-direction:column;gap:1px;min-width:0}",
    ".dshp-field-label b{font-size:13px;font-weight:500}",
    ".dshp-field-label small{color:var(--dshp-label-2);font-size:11.5px}",
    ".dshp-field-control{display:flex;align-items:center;gap:6px;flex:none}",
    ".dshp-seg{display:inline-flex;background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);",
    "border-radius:9px;padding:2px;gap:2px}",
    ".dshp-seg-btn{appearance:none;border:0;background:transparent;color:var(--dshp-label-2);border-radius:7px;",
    "padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}",
    ".dshp-seg-btn.dshp-is-active{background:var(--dshp-accent);color:#fff}",
    ".dshp-range{width:150px;accent-color:var(--dshp-accent)}",
    ".dshp-switch{appearance:none;border:0;width:42px;height:24px;border-radius:999px;background:var(--dshp-border-3);",
    "position:relative;cursor:pointer;transition:background 140ms ease;flex:none}",
    '.dshp-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;',
    "background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform 140ms ease}",
    ".dshp-switch.dshp-is-on{background:var(--dshp-accent)}",
    ".dshp-switch.dshp-is-on::after{transform:translateX(18px)}",
    ".dshp-subtitle{font-size:12px;font-weight:600;color:var(--dshp-label-2);margin:14px 0 2px}",
    ".dshp-about{color:var(--dshp-label-2);font-size:11.5px;line-height:1.7;background:var(--dshp-bg-soft);",
    "border:1px solid var(--dshp-border);border-radius:12px;padding:10px 12px;display:flex;",
    "flex-direction:column;gap:2px;word-break:break-all}",
    ".dshp-fh-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}",
    ".dshp-fh-chip{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dshp-border);",
    "background:var(--dshp-bg-soft);color:var(--dshp-label);border-radius:999px;padding:3px 10px;",
    "font:inherit;font-size:12px;cursor:pointer;transition:background 120ms ease,border-color 120ms ease}",
    ".dshp-fh-chip:hover{border-color:var(--dshp-accent)}",
    ".dshp-fh-chip.dshp-is-active{background:var(--dshp-accent);border-color:transparent;color:#fff}",
    ".dshp-fh-chip small{font-size:10.5px;color:var(--dshp-label-2)}",
    ".dshp-fh-chip.dshp-is-active small{color:rgba(255,255,255,.8)}",
    ".dshp-fh-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;",
    "color:var(--dshp-label-2);margin:2px 0 8px}",
    ".dshp-fh-meta b{color:var(--dshp-label);font-weight:600;font-size:13px}",
    ".dshp-fh-system{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:12px;",
    'padding:8px 10px;margin:6px 0;font-family:"Noto Serif SC","Songti SC",serif;font-size:13px;line-height:1.6}',
    ".dshp-fh-system small{display:block;color:var(--dshp-label-2);font-family:inherit;font-size:11px;margin-top:2px}",
    ".dshp-fh-prompt{font-size:12.5px;color:var(--dshp-label-2);margin:4px 0 6px}",
    ".dshp-fh-feedback{min-height:18px;font-size:12px;line-height:1.5;margin-top:8px;color:var(--dshp-label-2)}",
    ".dshp-fh-feedback.dshp-is-good{color:#16a34a}",
    ".dshp-fh-feedback.dshp-is-bad{color:var(--dshp-danger)}",
    ".dshp-fh-result{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:12px;",
    "padding:10px 12px;margin:8px 0;display:flex;flex-direction:column;gap:4px;font-size:12.5px}",
    ".dshp-fh-result b{font-size:14px}",
    ".dshp-fh-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}",
    ".dshp-fh-atlas{display:flex;flex-direction:column;gap:2px}",
    ".dshp-fh-line{display:flex;flex-direction:column;gap:1px;padding:7px 4px;",
    "border-bottom:1px solid var(--dshp-border)}",
    ".dshp-fh-line:last-child{border-bottom:0}",
    '.dshp-fh-line-text{font-family:"Noto Serif SC","Songti SC",serif;font-size:13px;line-height:1.6}',
    ".dshp-fh-line-source{color:var(--dshp-label-2);font-size:11px}",
    ".dshp-detail{display:flex;flex-direction:column;gap:8px}",
    '.dshp-lib-detail-title{font-size:15px;font-weight:700;text-align:center;font-family:"Noto Serif SC","Songti SC",serif}',
    ".dshp-lib-note{font-size:11.5px;color:var(--dshp-label-2);line-height:1.6}",
    ".dshp-lib-lines{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0}",
    '.dshp-lib-plain{display:flex;flex-direction:column;gap:2px;font-family:"Noto Serif SC","Songti SC",serif;font-size:14px;line-height:1.8;padding:6px 2px}',
    ".dshp-lib-tags{display:flex;flex-wrap:wrap;gap:6px}",
    ".dshp-lib-report{background:var(--dshp-bg-soft);border:1px solid var(--dshp-border);border-radius:10px;padding:8px 10px;font-size:12.5px;line-height:1.6}",
    ".dshp-lib-errors{font-size:11.5px;color:var(--dshp-danger);line-height:1.6}",
    ".dshp-lib-detect-lines{display:flex;flex-direction:column;align-items:center;gap:2px}",
    ".dshp-lib-multi{font-size:11.5px;color:var(--dshp-label-2);line-height:1.6;word-break:break-word}",
    ".dshp-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dshp-border-3);border-radius:10px;background:var(--dshp-bg);color:var(--dshp-label);padding:8px 10px;font:inherit;font-size:12.5px;line-height:1.6;resize:vertical}",
    ".dshp-textarea:focus{border-color:var(--dshp-accent);outline:none}",
    ".dshp-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:26px 14px}",
    ".dshp-empty-icon{font-size:26px;line-height:1}",
    ".dshp-empty-title{font-weight:600;font-size:13.5px}",
    ".dshp-empty-msg{color:var(--dshp-label-2);font-size:12px;line-height:1.6}",
    ".dshp-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px 10px;",
    "color:var(--dshp-label-2);font-size:12.5px}",
    ".dshp-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dshp-border-3);",
    "border-top-color:var(--dshp-accent);animation:dshp-spin .8s linear infinite}",
    "@keyframes dshp-spin{to{transform:rotate(360deg)}}",
    ".dshp-toast{position:fixed;z-index:70;background:var(--dshp-bg);color:var(--dshp-label);",
    "border:1px solid var(--dshp-border);border-radius:10px;padding:7px 12px;font-size:12px;",
    "box-shadow:var(--dshp-shadow);animation:dshp-pop 140ms ease-out;pointer-events:none}",
    ".dshp-toast.dshp-is-error{color:var(--dshp-danger);border-color:rgba(220,38,38,.42)}",
    "@media (prefers-color-scheme: dark){",
    ".dshp-root{--dshp-bg:var(--dsw-alias-bg-module-platform,#1f2124);",
    "--dshp-bg-soft:var(--dsw-alias-bg-base-platform,#17181a);",
    "--dshp-label:var(--dsw-alias-label-primary,#e8eaed);",
    "--dshp-label-2:var(--dsw-alias-label-secondary,#9aa0a6);",
    "--dshp-border:var(--dsw-alias-border-l2,#33363a);",
    "--dshp-border-3:var(--dsw-alias-border-l3,#4a4e54);",
    "--dshp-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));",
    "--dshp-accent:var(--dsw-static-accent,#6b8cff);",
    "--dshp-ping:#7fb0ff;--dshp-ze:#ff8a8a;--dshp-any:#a3a9b3;",
    "--dshp-danger:#ff8a8a;--dshp-shadow:0 12px 40px rgba(0,0,0,.5)}}",
    "@media (prefers-reduced-motion: reduce){",
    ".dshp-root *,.dshp-root *::before{animation-duration:.01ms!important;",
    "animation-iteration-count:1!important;transition-duration:.01ms!important}}",
    ".dshp-panel-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;border-top:1px solid var(--dshp-border);border-radius:0 0 14px 14px}",
    ".dshp-foot-hint{font-size:11.5px;color:var(--dshp-label-2);opacity:.8}",
    ".dshp-foot-link{border:none;background:transparent;color:var(--dshp-label-2);font:inherit;font-size:12px;cursor:pointer;padding:3px 6px;border-radius:8px}",
    ".dshp-foot-link:hover{background:var(--dshp-hover);color:var(--dshp-label)}",
    ".dshp-foot-link:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:1px}",
    ".dshp-foot-link-accent{color:var(--dshp-accent)}"
  ].join("");

  // client-src/wander.js
  var WINDOW_WANDER_ENABLED = false;
  var WANDER_TICK_MS = 60 * 1e3;
  var WANDER_FIRST_MIN_MS = 45 * 1e3;
  var WANDER_FIRST_MAX_MS = 2 * 60 * 1e3;
  var WANDER_MIN_INTERVAL_MS = 2 * 60 * 1e3;
  var WANDER_MAX_INTERVAL_MS = 5 * 60 * 1e3;
  var WANDER_WALK_MS = 8 * 1e3;
  var WANDER_MIN_DISTANCE = 120;
  var WANDER_INTERACTION_PAUSE_MS = 45 * 1e3;
  var WANDER_MEDIA_PATTERN = /跑|奔|踏步|踱步|走路|跳跃|踢|抛接|伸懒腰|运动|锻炼|健身/;
  var WANDER_STATIC_FILE = "dsh-whale-state-running.webp";
  function pickWanderMedia(entries, random) {
    const list = Array.isArray(entries) ? entries.filter(
      (entry) => entry && typeof entry.file === "string" && isVideoMoodFile(entry.file) && WANDER_MEDIA_PATTERN.test(entry.file)
    ) : [];
    if (list.length === 0) return { file: WANDER_STATIC_FILE, video: false };
    const roll = Number(typeof random === "function" ? random() : Math.random());
    const index2 = Number.isFinite(roll) ? Math.min(list.length - 1, Math.max(0, Math.floor(roll * list.length))) : 0;
    return { file: list[index2].file, video: true };
  }
  function nextWanderTarget(input) {
    const opts = input && typeof input === "object" ? input : {};
    const viewport = opts.viewport && typeof opts.viewport === "object" ? opts.viewport : {};
    const size = Math.max(40, Math.round(num(opts.size, 120)));
    const w = Math.max(size + 40, Math.round(num(viewport.w, 1024)));
    const h = Math.max(size + 80, Math.round(num(viewport.h, 768)));
    const margin = 8;
    const minX = margin;
    const maxX = Math.max(minX, w - size - margin);
    const minY = 56;
    const maxY = Math.max(minY, h - size - margin);
    const random = typeof opts.random === "function" ? opts.random : Math.random;
    const rand = () => {
      const value = Number(random());
      return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
    };
    const pick = (lo, hi) => Math.round(lo + (Math.max(lo, hi) - lo) * rand());
    const current = opts.current && typeof opts.current === "object" ? opts.current : null;
    const farEnough = (point) => current === null || Math.hypot(point.x - num(current.x, 0), point.y - num(current.y, 0)) >= WANDER_MIN_DISTANCE;
    const candidates = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const roll = rand();
      if (roll < 0.3) {
        candidates.push({ x: minX, y: pick(minY, maxY), edge: "left" });
      } else if (roll < 0.6) {
        candidates.push({ x: maxX, y: pick(minY, maxY), edge: "right" });
      } else if (roll < 0.85) {
        const leftBand = rand() < 0.5;
        const xLo = leftBand ? minX : Math.round(w * 0.7);
        const xHi = leftBand ? Math.round(w * 0.3) : maxX;
        candidates.push({ x: pick(xLo, xHi), y: maxY, edge: "bottom" });
      } else {
        const leftBand = rand() < 0.5;
        const xLo = leftBand ? minX : Math.round(w * 0.7);
        const xHi = leftBand ? Math.round(w * 0.3) : maxX;
        candidates.push({ x: pick(xLo, xHi), y: minY, edge: "top" });
      }
    }
    const chosen = candidates.find(farEnough) || candidates[candidates.length - 1];
    return { x: Math.round(clamp(chosen.x, minX, maxX)), y: Math.round(clamp(chosen.y, minY, maxY)), edge: chosen.edge };
  }

  // client-src/client.js
  window.__ModuleLoader__.load({
    id: "dsh-little-whale",
    factory: (require2) => {
      "use strict";
      const React = require2("react");
      if (!React || typeof React.createElement !== "function") {
        throw new Error("dsh-little-whale: React \u8FD0\u884C\u65F6\u4E0D\u53EF\u7528");
      }
      const h = React.createElement;
      const ROUTE = "/api/dsh-poetry/";
      const SELF_PATH = "self.json";
      const SELF_POLL_MS = 60 * 1e3;
      const ACTION_SEEN_KEY = "dshp-action-seen-v1";
      const MEMORY_PATH = "memory.json";
      const HEALTH_PATH = "health.json";
      const WORKS_PATH = "works.json";
      const ATTENTION_PATH = "attention.json";
      const PROJECT_ACTION_PATH = "project-action.json";
      const PROJECT_PATH = "project.json";
      const TWIN_PATH = "twin.json";
      const PRESENCE_PATH = "presence.json";
      const PRESENCE_THROTTLE_MS = 60 * 1e3;
      const WORKS_POLL_MS = 60 * 1e3;
      const ATTENTION_POLL_MS = 30 * 1e3;
      const TWIN_POLL_MS = 60 * 1e3;
      const HEALTH_POLL_MS = 60 * 1e3;
      const MEMORY_BACKUP_PATH = "memory/backup.json";
      const MEMORY_POLL_MS = 60 * 1e3;
      const ASSET_BASE = ROUTE + "assets?f=";
      const SETTINGS_URL = ROUTE + "settings.json";
      const WIDGET_ID = "dsh-little-whale";
      const CACHE_KEY = "dshp.firstscreen.v1";
      const POS_KEY = "dshp.position.v1";
      const BASE_SIZE = 96;
      const MIN_SCALE = 0.6;
      const MAX_SCALE = 1.6;
      const Z_INDEX = 60;
      const FETCH_TIMEOUT_MS = 15e3;
      const SAVE_DEBOUNCE_MS = 450;
      const STEPS = ["\u4ECA\u65E5\u4E00\u8BD7", "\u683C\u5F8B\u89E3\u6790", "\u4ECA\u65E5\u77E5\u8BC6\u5361", "\u58F0\u5F8B\u542F\u8499", "\u8BCD\u724C\u540D\u7BC7", "\u98DE\u82B1\u4EE4"];
      const POETRY_ENTRY_ENABLED = false;
      const PANEL_TABS = [
        { id: "growth", label: "\u6210\u957F" },
        { id: "graph", label: "\u56FE\u8C31" },
        { id: "settings", label: "\u8BBE\u7F6E" }
      ];
      const POETRY_TABS = [
        { id: "today", label: "\u4ECA\u65E5" },
        { id: "class", label: "\u8BFE\u5802" },
        { id: "yun", label: "\u97F5\u90E8" },
        { id: "ci", label: "\u8BCD\u724C" },
        { id: "library", label: "\u8BD7\u5E93" },
        { id: "feihua", label: "\u98DE\u82B1" },
        { id: "poetry-settings", label: "\u8BBE\u7F6E" }
      ];
      const FEIHUA_BEST_KEY = "dshp-feihua-best-v1";
      const FEIHUA_ATLAS_PAGE = 60;
      const FEIHUA_FULL_PATH = "feihua-full.json";
      const FEIHUA_FULL_TIMEOUT_MS = 2e4;
      const FEIHUA_FULL_RETRY_MS = 6e4;
      const MASCOT_DIR = "generated/";
      const MASCOT_FILES = Object.freeze({
        celebrate: "dsh-whale-state-celebrate.webp",
        idle: "dsh-whale-state-idle-cute.webp",
        night: "dsh-whale-state-night.webp",
        rain: "dsh-whale-state-weather-umbrella.webp",
        snow: "dsh-whale-state-weather-snow.webp",
        thunder: "dsh-whale-state-weather-thunder.webp",
        cold: "dsh-whale-state-weather-cold.webp",
        gameWin: "dsh-whale-state-game-win.webp",
        gameLose: "dsh-whale-state-game-lose.webp",
        gameThink: "dsh-whale-state-game-think.webp"
      });
      const MASCOT_TRANSIENT_MS = 2500;
      const WEATHER_REFRESH_MS = 30 * 60 * 1e3;
      const WEATHER_STALE_MS = 20 * 60 * 1e3;
      const WEATHER_CATEGORY_TAGS = Object.freeze({
        rain: ["\u96E8"],
        snow: ["\u96EA"],
        thunder: ["\u96E8", "\u96F7"],
        cloud: ["\u4E91"],
        fog: ["\u4E91", "\u96FE"],
        clear: ["\u6674", "\u65E5"],
        wind: ["\u98CE"],
        cold: ["\u971C", "\u9732", "\u5BD2"],
        unknown: []
      });
      const WEATHER_NIGHT_TAGS = ["\u6708", "\u591C"];
      const WEATHER_POOL_LIMIT = 20;
      const WEATHER_EXPLAIN = Object.freeze({
        rain: "\u4ECA\u65E5\u6709\u96E8\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u96E8\u7684\u8FD9\u9996",
        snow: "\u4ECA\u65E5\u6709\u96EA\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u96EA\u7684\u8FD9\u9996",
        thunder: "\u4ECA\u65E5\u6709\u96F7\u96E8\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u96E8\u96F7\u7684\u8FD9\u9996",
        cloud: "\u4ECA\u65E5\u591A\u4E91\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u4E91\u7684\u8FD9\u9996",
        fog: "\u4ECA\u65E5\u6709\u96FE\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u4E91\u96FE\u7684\u8FD9\u9996",
        clear: "\u4ECA\u65E5\u6674\u597D\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u6674\u65E5\u7684\u8FD9\u9996",
        wind: "\u4ECA\u65E5\u591A\u98CE\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u98CE\u7684\u8FD9\u9996",
        cold: "\u4ECA\u65E5\u5BD2\u51B7\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u971C\u5BD2\u7684\u8FD9\u9996",
        unknown: "\u4ECA\u65E5\u5929\u6C14\u5E94\u666F\uFF0C\u4E3A\u4F60\u9009\u4E86\u5E94\u666F\u7684\u8FD9\u9996"
      });
      const PET_MEDIA_PATH = "pet-media";
      const PET_MEDIA_CATALOG_FILE = "catalog.json";
      const PET_MEDIA_TIMEOUT_MS = 9e3;
      const MOTION_ROTATION_KEY = "dshp-motion-rotation-v1";
      const MOTION_MIN_DELAY_MS = 90 * 1e3;
      const MOTION_MAX_DELAY_MS = 210 * 1e3;
      const MOTION_PLAY_MIN_MS = 20 * 1e3;
      const MOTION_PLAY_MAX_MS = 30 * 1e3;
      const MOTION_FIRST_MIN_DELAY_MS = 10 * 1e3;
      const MOTION_FIRST_MAX_DELAY_MS = 20 * 1e3;
      const DIZZY_MIN_MS = 1500;
      const DIZZY_MAX_MS = 2500;
      const DIZZY_FAST_PX_PER_SEC = 1800;
      const DIZZY_FAST_DISTANCE_PX = 120;
      const DIZZY_FAST_WINDOW_MS = 120;
      const MEAL_KEY = "dshp-meal-v1";
      const MEAL_PLAY_MIN_MS = 25 * 1e3;
      const MEAL_PLAY_MAX_MS = 40 * 1e3;
      const WEATHER_OVERLAY_STATES = ["rain", "snow", "thunder", "cold", "night"];
      const ASSET_DATA_FILES = { anthology: "data/anthology.json", bank: "data/poems-bank.json", pingshui: "data/pingshui.json", ciBank: "data/ci-bank.json", moodCatalog: "data/mood-catalog.json" };
      const LIBRARY_CATEGORIES = [
        { id: "shijing", label: "\u8BD7\u7ECF" },
        { id: "chuci", label: "\u695A\u8F9E" },
        { id: "qianjiashi", label: "\u5343\u5BB6\u8BD7" },
        { id: "tang300", label: "\u5510\u8BD7\u4E09\u767E\u9996" },
        { id: "bank", label: "\u5168\u5510\u8BD7\u7CBE\u9009" },
        { id: "ci-selected", label: "\u5B8B\u8BCD\u7CBE\u9009" }
      ];
      const MASCOT_EGG_KEY = "dshp-mascot-egg-v1";
      const MASCOT_EXPRESSION_MS = 2500;
      const MASCOT_IDLE_MIN_MS = 45 * 60 * 1e3;
      const MASCOT_IDLE_USER_MS = 5 * 60 * 1e3;
      const MASCOT_IDLE_POLL_MS = 5 * 60 * 1e3;
      const MASCOT_EXPRESSION_FILES = [
        "dsh-whale-state-greet.webp",
        "dsh-whale-state-wink.webp",
        "dsh-whale-state-blush.webp",
        "dsh-whale-state-teasing.webp",
        "dsh-whale-state-cool-shades.webp",
        "dsh-whale-state-star.webp",
        "dsh-whale-state-meme-heart.webp",
        "dsh-whale-state-meme-kyun.webp",
        "dsh-whale-state-meme-smile-pain.webp",
        "dsh-whale-state-meme-yes.webp",
        "dsh-whale-state-meme-no.webp",
        "dsh-whale-state-meme-omg.webp",
        "dsh-whale-state-meme-shock.webp",
        "dsh-whale-state-meme-wakuwaku.webp",
        "dsh-whale-state-meme-music.webp",
        "dsh-whale-state-meme-peace.webp",
        "dsh-whale-state-daily-coffee.webp",
        "dsh-whale-state-daily-picnic.webp",
        "dsh-whale-state-valentine.webp",
        "dsh-whale-state-festival-spring.webp",
        "dsh-whale-state-festival-mid-autumn.webp",
        "dsh-whale-state-festival-christmas.webp"
      ];
      const TONE_QUATRAINS = {
        "\u4EC4\u8D77\u4E0D\u5165\u97F5": ["\u4EC4\u4EC4\u5E73\u5E73\u4EC4", "\u5E73\u5E73\u4EC4\u4EC4\u5E73", "\u5E73\u5E73\u5E73\u4EC4\u4EC4", "\u4EC4\u4EC4\u4EC4\u5E73\u5E73"],
        "\u4EC4\u8D77\u5165\u97F5": ["\u4EC4\u4EC4\u4EC4\u5E73\u5E73", "\u5E73\u5E73\u4EC4\u4EC4\u5E73", "\u5E73\u5E73\u5E73\u4EC4\u4EC4", "\u4EC4\u4EC4\u4EC4\u5E73\u5E73"],
        "\u5E73\u8D77\u4E0D\u5165\u97F5": ["\u5E73\u5E73\u5E73\u4EC4\u4EC4", "\u4EC4\u4EC4\u4EC4\u5E73\u5E73", "\u4EC4\u4EC4\u5E73\u5E73\u4EC4", "\u5E73\u5E73\u4EC4\u4EC4\u5E73"],
        "\u5E73\u8D77\u5165\u97F5": ["\u5E73\u5E73\u4EC4\u4EC4\u5E73", "\u4EC4\u4EC4\u4EC4\u5E73\u5E73", "\u4EC4\u4EC4\u5E73\u5E73\u4EC4", "\u5E73\u5E73\u4EC4\u4EC4\u5E73"]
      };
      const WRITE_KEYS = [
        "scale",
        "showTones",
        "mode",
        "autoplay",
        "snap",
        "script",
        "hidden",
        "theme",
        "weatherCity",
        "weatherPoem",
        "mood",
        "spontaneousPoem",
        "lastPoemId",
        "tutorialSeen"
      ];
      const DEFAULT_SETTINGS = Object.freeze({
        schemaVersion: 1,
        scale: 1,
        showTones: true,
        mode: "daily",
        autoplay: 0,
        snap: "left",
        script: "simplified",
        hidden: false,
        theme: "auto",
        weatherCity: "\u5317\u4EAC",
        weatherPoem: true,
        mood: true,
        spontaneousPoem: true,
        lastPoemId: null,
        tutorialSeen: false,
        updatedAt: 0
      });
      const RESOURCE_PATHS = {
        poems: "poems.json",
        ci: "ci.json",
        yun: "yun.json",
        knowledge: "knowledge.json"
      };
      function cx() {
        let out = "";
        for (let i = 0; i < arguments.length; i++) {
          const part = arguments[i];
          if (!part) continue;
          out = out ? out + " " + part : String(part);
        }
        return out;
      }
      function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
      }
      function hashString(input) {
        const text = String(input == null ? "" : input);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      }
      function formatDateLabel(dateStr) {
        const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
        if (matched) return Number(matched[2]) + " \u6708 " + Number(matched[3]) + " \u65E5";
        const now2 = /* @__PURE__ */ new Date();
        return now2.getMonth() + 1 + " \u6708 " + now2.getDate() + " \u65E5";
      }
      const PUNCTUATION = "\uFF0C\u3002\uFF01\uFF1F\uFF1B\u3001\uFF1A,.!?;:\u300C\u300D\u300E\u300F\uFF08\uFF09()\u300A\u300B\u3008\u3009\u201C\u201D\u2018\u2019\u2014\u2026\xB7";
      const TONE_ANY_CHARS = "\u25CB\u3007";
      const TONE_QUESTION_CHARS = "\uFF1F?";
      function isPunctuation(ch) {
        if (!ch) return true;
        if (ch === " " || ch === "	" || ch === "\n" || ch === "\u3000") return true;
        return PUNCTUATION.indexOf(ch) >= 0;
      }
      function toneKindOf(tone) {
        if (tone === "\u5E73") return "ping";
        if (tone === "\u4EC4") return "ze";
        if (tone && TONE_ANY_CHARS.indexOf(tone) >= 0) return "any";
        if (tone && TONE_QUESTION_CHARS.indexOf(tone) >= 0) return "unknown";
        return "unknown";
      }
      function buildToneCells(line, toneLine, options) {
        const opts = options || {};
        const showTones = opts.showTones !== false;
        const rhymeLine = opts.rhymeLine === true;
        const chars = Array.from(String(line == null ? "" : line));
        const tones = Array.from(String(toneLine == null ? "" : toneLine));
        let lastCharIndex = -1;
        for (let i = 0; i < chars.length; i++) {
          if (!isPunctuation(chars[i])) lastCharIndex = i;
        }
        const cells = [];
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i];
          const punctuation = isPunctuation(ch);
          const kind = punctuation ? "punct" : toneKindOf(tones[i] || "");
          const annotated = showTones && !punctuation && (kind === "ping" || kind === "ze" || kind === "any");
          const rhyme = rhymeLine && i === lastCharIndex;
          const classes = ["dshp-ch"];
          if (punctuation) classes.push("dshp-ch-punct");
          if (annotated) classes.push("dshp-ch-" + kind);
          if (rhyme) classes.push("dshp-ch-rhyme");
          cells.push({
            ch,
            tone: annotated ? tones[i] || "" : "",
            kind,
            punctuation,
            rhyme,
            index: i,
            className: classes.join(" ")
          });
        }
        return cells;
      }
      function selectPoemText(poem, script) {
        const src = poem && typeof poem === "object" ? poem : {};
        const original = script === "original";
        const lines = original && Array.isArray(src.linesOriginal) && src.linesOriginal.length ? src.linesOriginal : Array.isArray(src.lines) ? src.lines : [];
        const title = original && src.titleOriginal ? src.titleOriginal : src.title || "";
        const author = original && src.authorOriginal ? src.authorOriginal : src.author || "";
        return {
          title: String(title || ""),
          author: String(author || ""),
          lines: lines.map((line) => typeof line === "string" ? line : "")
        };
      }
      function selectCiText(ci) {
        const src = ci && typeof ci === "object" ? ci : {};
        return {
          title: String(src.title || src.rhythmic || ""),
          author: String(src.author || ""),
          lines: (Array.isArray(src.lines) ? src.lines : []).map((line) => typeof line === "string" ? line : "")
        };
      }
      function poemRhymeLines(poem) {
        const src = poem && typeof poem === "object" ? poem : {};
        if (Array.isArray(src.rhymeIdx) && src.rhymeIdx.length) {
          return src.rhymeIdx.filter((i) => Number.isInteger(i) && i >= 0);
        }
        const count = Array.isArray(src.lines) ? src.lines.length : 0;
        const fallback = [];
        for (let i = 1; i < count; i += 2) fallback.push(i);
        return fallback;
      }
      function normalizeSettings(raw) {
        const src = raw && typeof raw === "object" ? raw : {};
        const pickEnum = (value, allowed, fallback) => allowed.indexOf(value) >= 0 ? value : fallback;
        const scale = Math.round(clamp(num(src.scale, DEFAULT_SETTINGS.scale), MIN_SCALE, MAX_SCALE) * 100) / 100;
        const autoplayValue = num(src.autoplay, 0);
        const autoplay = [0, 30, 60, 300].indexOf(autoplayValue) >= 0 ? autoplayValue : 0;
        const lastPoemId = typeof src.lastPoemId === "string" && src.lastPoemId.length ? src.lastPoemId : null;
        const weatherCityRaw = typeof src.weatherCity === "string" ? src.weatherCity.trim() : "";
        const weatherCity = weatherCityRaw.length >= 1 && weatherCityRaw.length <= 20 ? weatherCityRaw : DEFAULT_SETTINGS.weatherCity;
        return {
          schemaVersion: 1,
          scale,
          showTones: typeof src.showTones === "boolean" ? src.showTones : DEFAULT_SETTINGS.showTones,
          mode: pickEnum(src.mode, ["daily", "random"], DEFAULT_SETTINGS.mode),
          autoplay,
          snap: pickEnum(src.snap, ["left", "right", "free"], DEFAULT_SETTINGS.snap),
          script: pickEnum(src.script, ["simplified", "original"], DEFAULT_SETTINGS.script),
          hidden: typeof src.hidden === "boolean" ? src.hidden : DEFAULT_SETTINGS.hidden,
          theme: pickEnum(src.theme, ["auto", "light", "dark"], DEFAULT_SETTINGS.theme),
          weatherCity,
          weatherPoem: typeof src.weatherPoem === "boolean" ? src.weatherPoem : DEFAULT_SETTINGS.weatherPoem,
          mood: typeof src.mood === "boolean" ? src.mood : DEFAULT_SETTINGS.mood,
          spontaneousPoem: typeof src.spontaneousPoem === "boolean" ? src.spontaneousPoem : DEFAULT_SETTINGS.spontaneousPoem,
          lastPoemId,
          tutorialSeen: typeof src.tutorialSeen === "boolean" ? src.tutorialSeen : DEFAULT_SETTINGS.tutorialSeen,
          updatedAt: num(src.updatedAt, 0)
        };
      }
      function settingsPatch(input) {
        const src = input && typeof input === "object" ? input : {};
        const normalized = normalizeSettings(src);
        const out = {};
        for (let i = 0; i < WRITE_KEYS.length; i++) {
          const key = WRITE_KEYS[i];
          if (hasOwn(src, key)) out[key] = normalized[key];
        }
        return out;
      }
      function buildSettingsRequest(patch) {
        return {
          url: SETTINGS_URL,
          init: {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settingsPatch(patch)),
            keepalive: true
          }
        };
      }
      function createSettingsSaver(options) {
        const opts = options && typeof options === "object" ? options : {};
        const put = typeof opts.put === "function" ? opts.put : () => Promise.resolve();
        const delay = Math.max(0, num(opts.delay, SAVE_DEBOUNCE_MS));
        const onError = typeof opts.onError === "function" ? opts.onError : null;
        const onSaved = typeof opts.onSaved === "function" ? opts.onSaved : null;
        let timer2 = null;
        let pending = null;
        let disposed = false;
        function flush() {
          if (timer2) {
            clearTimeout(timer2);
            timer2 = null;
          }
          if (!pending) return Promise.resolve();
          const body = pending;
          pending = null;
          let request;
          try {
            request = Promise.resolve(put(body));
          } catch (error) {
            request = Promise.reject(error);
          }
          return request.then(
            (result) => {
              if (onSaved) {
                try {
                  onSaved(result);
                } catch (error) {
                }
              }
              return result;
            },
            (error) => {
              if (onError) {
                try {
                  onError(error);
                } catch (ignored) {
                }
              }
              throw error;
            }
          );
        }
        function save(patch) {
          if (disposed) return;
          if (patch && typeof patch === "object") {
            pending = Object.assign({}, pending || {}, patch);
          }
          if (timer2) clearTimeout(timer2);
          timer2 = setTimeout(() => {
            timer2 = null;
            flush().catch(() => {
            });
          }, delay);
        }
        function dispose() {
          disposed = true;
          if (timer2) {
            clearTimeout(timer2);
            timer2 = null;
          }
          pending = null;
        }
        return { save, flush, dispose };
      }
      function selectNextPoemId(options) {
        const opts = options && typeof options === "object" ? options : {};
        const items = (Array.isArray(opts.items) ? opts.items : []).filter((item) => item && item.id);
        if (!items.length) return null;
        const mode = opts.mode === "random" ? "random" : "daily";
        const currentId = opts.currentId || null;
        const todayId = opts.todayId || null;
        if (mode === "random") {
          const random = typeof opts.random === "function" ? opts.random : Math.random;
          let index2 = Math.floor(num(random(), 0) * items.length);
          if (!Number.isFinite(index2) || index2 < 0) index2 = 0;
          if (index2 >= items.length) index2 = items.length - 1;
          if (items.length > 1 && items[index2].id === currentId) index2 = (index2 + 1) % items.length;
          return items[index2].id;
        }
        if (todayId && currentId !== todayId && items.some((item) => item.id === todayId)) {
          return todayId;
        }
        const currentIndex = items.findIndex((item) => item.id === currentId);
        return items[(currentIndex + 1) % items.length].id;
      }
      function clampPosition(position, size, viewport) {
        const maxX = Math.max(8, viewport.w - size - 8);
        const maxY = Math.max(8, viewport.h - size - 8);
        return {
          x: Math.round(clamp(position && position.x, 8, maxX)),
          y: Math.round(clamp(position && position.y, 8, maxY))
        };
      }
      function anchorPosition(snap, size, viewport, previous) {
        const base = clampPosition(previous || { x: 16, y: viewport.h - size - 24 }, size, viewport);
        if (snap === "left") base.x = 16;
        else if (snap === "right") base.x = Math.max(8, viewport.w - size - 16);
        return base;
      }
      function describeDataError(error) {
        if (!error) return "\u8BD7\u8BCD\u6570\u636E\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        const status = Number(error.status);
        if (status === 404) return "\u6570\u636E\u63A5\u53E3\u5C1A\u672A\u5C31\u7EEA\uFF08\u5BBF\u4E3B\u534A\u533A\u53EF\u80FD\u672A\u66F4\u65B0\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        if (status === 403) return "\u6570\u636E\u8BBF\u95EE\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5";
        if (status === 401) return "\u4F1A\u8BDD\u672A\u6388\u6743\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5";
        const message = String(error.message || "");
        if (/abort|timeout|超时/i.test(message)) return "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5";
        if (error.code === "DATA_UNAVAILABLE") return "\u8BD7\u8BCD\u6570\u636E\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        return "\u8BD7\u8BCD\u6570\u636E\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
      }
      let feihuaIndexCache = { poems: null, ci: null, index: null };
      let feihuaFullCache = {};
      let feihuaFullInflight = {};
      function clearFeihuaFullCache() {
        feihuaFullCache = {};
        for (const key of Object.keys(feihuaFullInflight)) {
          try {
            if (feihuaFullInflight[key] && typeof feihuaFullInflight[key].abort === "function") feihuaFullInflight[key].abort();
          } catch (error) {
          }
        }
        feihuaFullInflight = {};
      }
      function readFeihuaFullCache(char) {
        const key = String(char == null ? "" : char);
        return key ? feihuaFullCache[key] || null : null;
      }
      function abortFeihuaFull(char) {
        const key = String(char == null ? "" : char);
        const item = feihuaFullInflight[key];
        if (item && typeof item.abort === "function") item.abort();
        delete feihuaFullInflight[key];
      }
      function requestFeihuaFull(char) {
        const key = String(char == null ? "" : char);
        if (!key) return Promise.resolve({ ok: false, reason: "invalid" });
        const cached = feihuaFullCache[key];
        if (cached && cached.status === "ready") {
          return Promise.resolve({ ok: true, char: key, entries: cached.entries, count: cached.count, cached: true });
        }
        if (cached && cached.status === "error" && Date.now() - cached.at < FEIHUA_FULL_RETRY_MS) {
          return Promise.resolve({ ok: false, char: key, cached: true, reason: "retry-wait" });
        }
        if (feihuaFullInflight[key]) return feihuaFullInflight[key].promise;
        if (typeof fetch !== "function") return Promise.resolve({ ok: false, reason: "no-fetch" });
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let aborted = false;
        let settled = false;
        let timer2 = null;
        let abortResolve = null;
        const abortPromise = new Promise((resolve) => {
          abortResolve = () => resolve({ ok: false, reason: "aborted" });
        });
        const item = { promise: null, abort: () => {
          aborted = true;
          try {
            if (controller) controller.abort();
          } catch (error) {
          }
          if (abortResolve) abortResolve();
        } };
        const finish = (result) => {
          if (settled) return result;
          settled = true;
          if (timer2) clearTimeout(timer2);
          delete feihuaFullInflight[key];
          if (!result.ok && !aborted) feihuaFullCache[key] = { status: "error", at: Date.now() };
          return result;
        };
        const url = ROUTE + FEIHUA_FULL_PATH + "?char=" + encodeURIComponent(key);
        const task = Promise.resolve().then(() => fetch(url, controller ? { signal: controller.signal } : void 0)).then((response) => {
          if (!response || typeof response.ok !== "boolean" || !response.ok) {
            return { ok: false, reason: "http", status: response ? response.status : 0 };
          }
          return Promise.resolve(response.json()).then((data) => {
            if (!data || data.ok === false || !Array.isArray(data.entries)) return { ok: false, reason: "invalid" };
            const entries = [];
            for (const entry of data.entries) {
              if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "string" && entry[0].trim()) {
                entries.push([entry[0].trim(), String(entry[1] == null ? "" : entry[1])]);
              } else if (entry && typeof entry === "object" && typeof entry.text === "string" && entry.text.trim()) {
                entries.push([entry.text.trim(), String(entry.source || "")]);
              }
            }
            if (!entries.length) return { ok: false, reason: "empty" };
            const count = Number.isFinite(Number(data.count)) && Number(data.count) > 0 ? Math.floor(Number(data.count)) : entries.length;
            feihuaFullCache[key] = { status: "ready", entries, count, at: Date.now() };
            return { ok: true, char: key, entries, count };
          }).catch(() => ({ ok: false, reason: "json" }));
        }).catch(() => ({ ok: false, reason: aborted ? "aborted" : "network" }));
        const timeout2 = new Promise((resolve) => {
          timer2 = setTimeout(() => {
            try {
              if (controller) controller.abort();
            } catch (error) {
            }
            resolve({ ok: false, reason: "timeout" });
          }, FEIHUA_FULL_TIMEOUT_MS);
        });
        item.promise = Promise.race([task, timeout2, abortPromise]).then(finish);
        feihuaFullInflight[key] = item;
        return item.promise;
      }
      function getFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
        if (!poemsData || !Array.isArray(poemsData.items)) return null;
        const cached = feihuaIndexCache;
        if (cached.index && cached.poems === poemsData && cached.ci === ciData && cached.anthology === anthologyData && cached.bank === bankData && cached.ciBank === ciBankData) return cached.index;
        const index2 = buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData);
        feihuaIndexCache = { poems: poemsData, ci: ciData, anthology: anthologyData, bank: bankData, ciBank: ciBankData, index: index2 };
        return index2;
      }
      function clearFeihuaIndexCache() {
        feihuaIndexCache = { poems: null, ci: null, index: null };
      }
      function pickDefaultFeihuaChar(index2, poem) {
        const fallback = "\u82B1";
        if (!index2 || !Array.isArray(index2.candidates) || !index2.candidates.length) return fallback;
        const lines = poem && Array.isArray(poem.lines) ? poem.lines : [];
        const text = lines.join("");
        let best = null;
        for (const item of index2.candidates) {
          if (!item || item.count <= 0) continue;
          if (text.indexOf(item.char) < 0) continue;
          if (!best || item.count > best.count) best = item;
        }
        return best ? best.char : fallback;
      }
      function readFeihuaBest() {
        const storage = getStorage();
        if (!storage) return normalizeFeihuaBest(null);
        try {
          const raw = storage.getItem(FEIHUA_BEST_KEY);
          if (!raw) return normalizeFeihuaBest(null);
          return normalizeFeihuaBest(JSON.parse(raw));
        } catch (error) {
          return normalizeFeihuaBest(null);
        }
      }
      function writeFeihuaBest(best) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(FEIHUA_BEST_KEY, JSON.stringify(normalizeFeihuaBest(best)));
        } catch (error) {
        }
      }
      let weatherCache = null;
      function mascotStateFor(weather, enabled) {
        if (!enabled || !weather || typeof weather !== "object") return "celebrate";
        if (weather.isDay === false || weather.isDay === 0) return "night";
        const category = typeof weather.category === "string" ? weather.category : "";
        if (category === "rain") return "rain";
        if (category === "snow") return "snow";
        if (category === "thunder") return "thunder";
        if (category === "cold") return "cold";
        if (category === "clear" || category === "cloud" || category === "fog" || category === "wind") return "idle";
        return "celebrate";
      }
      function mascotFileFor(stateKey) {
        return MASCOT_FILES[stateKey] || MASCOT_FILES.celebrate;
      }
      function mascotUrl(file) {
        return ASSET_BASE + MASCOT_DIR + file;
      }
      function weatherPoemTags(weather) {
        if (!weather || typeof weather !== "object") return [];
        const tags = [];
        const push = (list) => {
          for (const tag of list) if (tags.indexOf(tag) < 0) tags.push(tag);
        };
        push(WEATHER_CATEGORY_TAGS[weather.category] || []);
        if (weather.isDay === false || weather.isDay === 0) push(WEATHER_NIGHT_TAGS);
        return tags;
      }
      function countWeatherTagHits(lines, tags) {
        const text = (Array.isArray(lines) ? lines : []).join("");
        if (!text) return 0;
        let hits = 0;
        for (const tag of Array.isArray(tags) ? tags : []) {
          if (!tag) continue;
          let from = 0;
          while (from <= text.length) {
            const at = text.indexOf(tag, from);
            if (at < 0) break;
            hits += 1;
            from = at + tag.length;
          }
        }
        return hits;
      }
      function buildWeatherPoemPool(poemsData, ciData, tags, limit, extraSources) {
        const poolLimit = Math.max(0, num(limit, WEATHER_POOL_LIMIT));
        const safeTags = (Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === "string" && tag.length > 0);
        if (!safeTags.length || !poolLimit) return [];
        const build = (items, kind) => {
          const out = [];
          for (const item of Array.isArray(items) ? items : []) {
            if (!item || !item.id) continue;
            const hits = countWeatherTagHits(item.lines, safeTags);
            if (hits > 0) out.push({ kind, id: item.id, hits, item });
          }
          out.sort((a2, b) => b.hits - a2.hits || String(a2.id).localeCompare(String(b.id)));
          return out;
        };
        const extras = extraSources && typeof extraSources === "object" ? extraSources : {};
        const sources = [
          [poemsData && poemsData.items, "poem"],
          [ciData && ciData.items, "ci"],
          [extras.anthology && extras.anthology.items, "anthology"],
          [extras.bank && extras.bank.items, "bank"],
          [extras.ciBank && extras.ciBank.items, "ci-bank"]
        ];
        const pool = [];
        for (const source of sources) {
          if (pool.length >= poolLimit) break;
          const entries = build(source[0], source[1]).slice(0, poolLimit - pool.length);
          for (const entry of entries) pool.push(entry);
        }
        return pool;
      }
      function selectWeatherPoemEntry(pool, meta) {
        if (!Array.isArray(pool) || !pool.length) return null;
        const date = meta && meta.date ? String(meta.date) : "";
        const category = meta && meta.category ? String(meta.category) : "";
        const dataVersion = meta && meta.dataVersion ? String(meta.dataVersion) : "";
        const index2 = Math.abs(hashString(date + "|" + category + "|" + dataVersion)) % pool.length;
        return pool[index2];
      }
      function weatherChipText(city, weather) {
        if (!weather || typeof weather !== "object") return "";
        const place = typeof city === "string" && city ? city : "";
        const label = typeof weather.label === "string" && weather.label ? weather.label : "\u5929\u6C14";
        const tempC = Number(weather.tempC);
        const temp = Number.isFinite(tempC) ? Math.round(tempC) + "\u2103" : "";
        return (place ? place + " \xB7 " : "") + label + (temp ? " " + temp : "");
      }
      function weatherExplainText(weather) {
        if (!weather || typeof weather !== "object") return "";
        const category = typeof weather.category === "string" ? weather.category : "unknown";
        const night = weather.isDay === false || weather.isDay === 0;
        if (night && (category === "clear" || category === "cloud" || category === "unknown")) {
          return "\u4ECA\u591C\u6708\u8272\u6B63\u597D\uFF0C\u4E3A\u4F60\u9009\u4E86\u5199\u6708\u591C\u7684\u8FD9\u9996";
        }
        return WEATHER_EXPLAIN[category] || WEATHER_EXPLAIN.unknown;
      }
      function weatherUpdatedLabel(at) {
        const time = Number(at);
        if (!Number.isFinite(time) || time <= 0) return "";
        const date = new Date(time);
        const pad = (value) => value < 10 ? "0" + value : String(value);
        return pad(date.getHours()) + ":" + pad(date.getMinutes());
      }
      function requestWeather() {
        return fetchJson("weather.json").then((data) => {
          if (!data || data.ok !== true || !data.weather) throw new Error("\u5929\u6C14\u6570\u636E\u4E0D\u53EF\u7528");
          weatherCache = { data, at: Date.now() };
          return data;
        });
      }
      function clearWeatherCache() {
        weatherCache = null;
      }
      let moodCache = null;
      function mascotImageFor(options) {
        const opts = options && typeof options === "object" ? options : {};
        const weatherKey = typeof opts.weatherStateKey === "string" ? opts.weatherStateKey : "celebrate";
        const weatherOn = opts.weatherEnabled === true;
        const moodOn = opts.moodEnabled === true;
        const mood = opts.mood && typeof opts.mood === "object" ? opts.mood : null;
        if (moodOn && mood && mood.image && (mood.source === "model" || mood.ai === true)) {
          return { stateKey: "mood:ai", file: mood.image, source: "mood" };
        }
        if (weatherOn && WEATHER_OVERLAY_STATES.indexOf(weatherKey) >= 0) {
          return { stateKey: weatherKey, file: mascotFileFor(weatherKey), source: "weather" };
        }
        if (moodOn && mood && mood.image) return { stateKey: "mood:" + mood.key, file: mood.image, source: "mood" };
        if (weatherOn) return { stateKey: weatherKey, file: mascotFileFor(weatherKey), source: "weather" };
        return { stateKey: "celebrate", file: mascotFileFor("celebrate"), source: "default" };
      }
      function mascotVideoShouldPause(options) {
        const opts = options && typeof options === "object" ? options : {};
        return opts.hidden === true || opts.panelOpen === true;
      }
      function detectFastDrag(previous, next) {
        const prev = previous && typeof previous === "object" ? previous : {};
        const cur = next && typeof next === "object" ? next : {};
        const px = num(prev.x, 0);
        const py = num(prev.y, 0);
        const cx2 = num(cur.x, 0);
        const cy = num(cur.y, 0);
        const pt = num(prev.t, 0);
        const ct = num(cur.t, 0);
        const dt = ct - pt;
        if (!(dt > 0)) return false;
        const distance = Math.hypot(cx2 - px, cy - py);
        const speed = distance / dt * 1e3;
        if (speed >= DIZZY_FAST_PX_PER_SEC) return true;
        return distance > DIZZY_FAST_DISTANCE_PX && dt < DIZZY_FAST_WINDOW_MS;
      }
      function nextDizzyDuration(options) {
        const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
        const random = typeof opts.random === "function" ? opts.random : Math.random;
        const value = Number(random());
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        return Math.round(DIZZY_MIN_MS + ratio * (DIZZY_MAX_MS - DIZZY_MIN_MS));
      }
      function nextMealDuration(options) {
        const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
        const random = typeof opts.random === "function" ? opts.random : Math.random;
        const value = Number(random());
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        return Math.round(MEAL_PLAY_MIN_MS + ratio * (MEAL_PLAY_MAX_MS - MEAL_PLAY_MIN_MS));
      }
      function mealMomentFor(now2) {
        const parts = shanghaiParts(num(now2, Date.now()));
        const minutes = parts.minutes;
        const windows = [
          { meal: "breakfast", label: "\u65E9\u996D", start: 7 * 60, end: 9 * 60, window: "07:00\u201309:00" },
          { meal: "lunch", label: "\u5348\u996D", start: 11 * 60 + 30, end: 13 * 60 + 30, window: "11:30\u201313:30" },
          { meal: "dinner", label: "\u665A\u996D", start: 17 * 60 + 30, end: 19 * 60 + 30, window: "17:30\u201319:30" }
        ];
        for (const item of windows) {
          if (minutes >= item.start && minutes < item.end) return { meal: item.meal, label: item.label, window: item.window, dateKey: parts.dateKey };
        }
        return null;
      }
      function normalizeMealState(raw, now2) {
        const source = raw && typeof raw === "object" ? raw : {};
        const dateKey = shanghaiParts(num(now2, Date.now())).dateKey;
        const sameDay = source.date === dateKey;
        const meals = {};
        const previous = sameDay && source.meals && typeof source.meals === "object" ? source.meals : {};
        for (const meal of ["breakfast", "lunch", "dinner"]) if (previous[meal] === true) meals[meal] = true;
        return { date: dateKey, meals };
      }
      function readMealState(now2) {
        const storage = getStorage();
        if (!storage) return normalizeMealState(null, now2);
        try {
          const raw = storage.getItem(MEAL_KEY);
          return normalizeMealState(raw ? JSON.parse(raw) : null, now2);
        } catch (error) {
          return normalizeMealState(null, now2);
        }
      }
      function writeMealState(state) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(MEAL_KEY, JSON.stringify(state));
        } catch (error) {
        }
      }
      function markMealDone(state, meal, now2) {
        const base = normalizeMealState(state, now2);
        const meals = Object.assign({}, base.meals);
        meals[meal] = true;
        return { date: base.date, meals };
      }
      function mealTriggerFor(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (opts.hidden === true || opts.panelOpen === true || opts.visible === false) return null;
        const moment = mealMomentFor(opts.now);
        if (!moment) return null;
        const state = normalizeMealState(opts.state, opts.now);
        if (state.meals[moment.meal]) return null;
        return moment;
      }
      function pickDizzyMedia(entries) {
        if (!Array.isArray(entries) || !entries.length) return null;
        const exact = entries.find((entry) => entry && String(entry.label || "").indexOf("\u5C0F\u5E45\u5EA6\u539F\u5730360\u5EA6\u65CB\u8F6C\u5C55\u793A") >= 0);
        if (exact) return exact;
        return entries.find((entry) => entry && /转|旋转|转圈|晕/.test(String(entry.label || ""))) || null;
      }
      function pickMealMedia(entries, meal) {
        if (!Array.isArray(entries) || !entries.length) return null;
        const preferred = { breakfast: "\u5403\u65E9\u9910", lunch: "\u5403\u5348\u9910", dinner: "\u5403\u665A\u9910" };
        const exact = entries.find((entry) => entry && String(entry.label || "") === preferred[meal]);
        if (exact) return exact;
        for (const label of ["\u5403\u767D\u996D", "\u5E72\u996D"]) {
          const match = entries.find((entry) => entry && String(entry.label || "").indexOf(label) >= 0);
          if (match) return match;
        }
        return entries.find((entry) => entry && String(entry.label || "").indexOf("\u5403") >= 0) || null;
      }
      function mascotFilePriority(options) {
        const opts = options && typeof options === "object" ? options : {};
        return opts.pulseFile || opts.panelFile || opts.dizzyFile || opts.mealFile || opts.expressionFile || opts.wanderFile || opts.motionFile || opts.moodFile || "";
      }
      function petMediaUrl(file) {
        return ROUTE + PET_MEDIA_PATH + "?f=" + encodeURIComponent(String(file == null ? "" : file));
      }
      function normalizePetMediaCatalog(data) {
        if (!data || data.ok === false || !Array.isArray(data.entries)) return null;
        const entries = [];
        const seen = {};
        for (const item of data.entries) {
          if (!item || typeof item.file !== "string") continue;
          const file = item.file.trim();
          if (!/^webm\/[^/]+\.webm$/.test(file)) continue;
          if (seen[file]) continue;
          seen[file] = true;
          entries.push({
            file,
            label: String(item.label || ""),
            media: "video",
            tags: Array.isArray(item.tags) ? item.tags.slice() : []
          });
        }
        return entries;
      }
      function mergePetMediaIntoCatalog(catalog, petEntries) {
        if (!catalog || !Array.isArray(petEntries) || !petEntries.length) return catalog;
        const moodImages = catalog.moodImages.slice();
        const moodFiles = catalog.moodFiles.slice();
        const byFile = Object.assign({}, catalog.byFile);
        for (const entry of petEntries) {
          if (!entry || !entry.file || byFile[entry.file]) continue;
          const normalized = { file: entry.file, label: String(entry.label || ""), tags: Array.isArray(entry.tags) ? entry.tags : [], media: "video" };
          moodImages.push(normalized);
          moodFiles.push(entry.file);
          byFile[entry.file] = normalized;
        }
        return Object.assign({}, catalog, { moodImages, moodFiles, byFile });
      }
      let petMediaCache = null;
      let petMediaInflight = null;
      function clearPetMediaCache() {
        petMediaCache = null;
        if (petMediaInflight && typeof petMediaInflight.abort === "function") {
          try {
            petMediaInflight.abort();
          } catch (error) {
          }
        }
        petMediaInflight = null;
      }
      function requestPetMediaCatalog() {
        if (petMediaCache) return Promise.resolve({ ok: true, entries: petMediaCache });
        if (petMediaInflight) return petMediaInflight.promise;
        if (typeof fetch !== "function") return Promise.resolve({ ok: false, entries: [] });
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let settled = false;
        let timer2 = null;
        let abortResolve = null;
        const abortPromise = new Promise((resolve) => {
          abortResolve = () => resolve({ ok: false, entries: [], reason: "aborted" });
        });
        const finish = (result) => {
          if (settled) return result;
          settled = true;
          if (timer2) clearTimeout(timer2);
          petMediaInflight = null;
          if (result && result.ok && Array.isArray(result.entries)) petMediaCache = result.entries;
          return result;
        };
        const task = Promise.resolve().then(() => fetch(ROUTE + PET_MEDIA_PATH + "?f=" + encodeURIComponent(PET_MEDIA_CATALOG_FILE), controller ? { signal: controller.signal } : void 0)).then((response) => {
          if (!response || typeof response.ok !== "boolean" || !response.ok) return { ok: false, entries: [], reason: "http" };
          return Promise.resolve(response.json()).then((data) => {
            const entries = normalizePetMediaCatalog(data);
            if (!entries) return { ok: false, entries: [], reason: "invalid" };
            return { ok: true, entries };
          }).catch(() => ({ ok: false, entries: [], reason: "json" }));
        }).catch(() => ({ ok: false, entries: [], reason: "network" }));
        const timeout2 = new Promise((resolve) => {
          timer2 = setTimeout(() => {
            try {
              if (controller) controller.abort();
            } catch (error) {
            }
            resolve({ ok: false, entries: [], reason: "timeout" });
          }, PET_MEDIA_TIMEOUT_MS);
        });
        const inflight = { promise: null, abort: () => {
          try {
            if (controller) controller.abort();
          } catch (error) {
          }
          if (abortResolve) abortResolve();
        } };
        inflight.promise = Promise.race([task, timeout2, abortPromise]).then(finish);
        petMediaInflight = inflight;
        return inflight.promise;
      }
      function readMotionRotation() {
        const storage = getStorage();
        if (!storage) return 0;
        try {
          const value = Number(storage.getItem(MOTION_ROTATION_KEY));
          return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
        } catch (error) {
          return 0;
        }
      }
      function writeMotionRotation(index2) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(MOTION_ROTATION_KEY, String(Math.max(0, Math.floor(num(index2, 0)))));
        } catch (error) {
        }
      }
      function nextMotionEntry(entries, index2) {
        if (!Array.isArray(entries) || !entries.length) return { entry: null, index: 0, size: 0 };
        const size = entries.length;
        const start2 = Math.max(0, Math.floor(num(index2, 0))) % size;
        return { entry: entries[start2], index: (start2 + 1) % size, size, position: start2 };
      }
      function nextMotionDelay(options) {
        const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
        const random = typeof opts.random === "function" ? opts.random : Math.random;
        const value = Number(random());
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        return Math.round(MOTION_MIN_DELAY_MS + ratio * (MOTION_MAX_DELAY_MS - MOTION_MIN_DELAY_MS));
      }
      function nextMotionFirstDelay(options) {
        const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
        const random = typeof opts.random === "function" ? opts.random : Math.random;
        const value = Number(random());
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        return Math.round(MOTION_FIRST_MIN_DELAY_MS + ratio * (MOTION_FIRST_MAX_DELAY_MS - MOTION_FIRST_MIN_DELAY_MS));
      }
      function nextMotionScheduleDelay(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (opts.first !== false && !isVideoMoodFile(opts.moodImage)) return nextMotionFirstDelay(opts);
        return nextMotionDelay(opts);
      }
      function nextMotionDuration(options) {
        const opts = typeof options === "function" ? { random: options } : options && typeof options === "object" ? options : {};
        const random = typeof opts.random === "function" ? opts.random : Math.random;
        const value = Number(random());
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        return Math.round(MOTION_PLAY_MIN_MS + ratio * (MOTION_PLAY_MAX_MS - MOTION_PLAY_MIN_MS));
      }
      function requestMoodAi(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (typeof fetch !== "function") return Promise.resolve({ ok: false, reason: "no-fetch" });
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let timer2 = null;
        const timeout2 = new Promise((resolve) => {
          timer2 = setTimeout(() => {
            try {
              if (controller) controller.abort();
            } catch (error) {
            }
            resolve({ ok: false, reason: "timeout" });
          }, MOOD_AI_TIMEOUT_MS);
        });
        const request = Promise.resolve().then(() => fetch(ROUTE + moodAiQuery(opts), controller ? { signal: controller.signal } : void 0)).then((response) => {
          if (!response || typeof response.ok !== "boolean" || !response.ok) {
            const status = response ? num(response.status, 0) : 0;
            return { ok: false, reason: status === 429 ? "rate" : "http", status };
          }
          return Promise.resolve(response.json()).then((data) => {
            const parsed = parseMoodAiResponse(data, opts.catalog);
            const code = parsed && parsed.code ? String(parsed.code) : data && data.error && typeof data.error.code === "string" ? data.error.code : "";
            if (!parsed.ok && code) {
              return {
                ok: false,
                reason: /RATE_LIMITED|RATE/i.test(code) ? "rate" : "host",
                code,
                status: num(response.status, 200),
                message: data && data.error && typeof data.error.message === "string" ? data.error.message : ""
              };
            }
            return parsed;
          }).catch(() => ({ ok: false, reason: "json" }));
        }).catch(() => ({ ok: false, reason: "network" }));
        return Promise.race([request, timeout2]).then((result) => {
          if (timer2) clearTimeout(timer2);
          return result;
        });
      }
      function normalizeSelfStatus(data) {
        if (!data || data.ok === false || !data.state || typeof data.state !== "object") return null;
        const state = data.state;
        const text = (value, max) => {
          const raw = String(value == null ? "" : value).trim();
          return raw.length > max ? raw.slice(0, max) : raw;
        };
        const growth = data.growth && typeof data.growth === "object" ? data.growth : {};
        const count = (key) => Math.max(0, Math.floor(num(growth[key], 0)));
        const at = (key) => {
          const value = num(growth[key], 0);
          return value > 0 ? value : 0;
        };
        const rawActions = data.actions && typeof data.actions === "object" ? data.actions : {};
        const rawProject = data.project && typeof data.project === "object" ? data.project : null;
        const context = Array.isArray(data.context) ? data.context.filter((line) => typeof line === "string" && line.trim().length > 0).slice(0, 6).map((line) => line.trim()) : [];
        return {
          // v1.51：不再有 0–100 的指标；只有她自己写的一句话 + 事实时间线。
          felt: text(data.felt || state.felt, 80),
          experiencing: text(data.experiencing || state.experiencing, 120),
          context,
          feltAt: num(state.feltAt, 0),
          sleeping: state.sleeping === true,
          sleepSince: num(state.sleepSince, 0),
          updatedAt: num(state.updatedAt, 0),
          growth: {
            learnings: count("learnings"),
            reflections: count("reflections"),
            lastLearnAt: at("lastLearnAt"),
            lastReflectAt: at("lastReflectAt")
          },
          actions: {
            latest: normalizeSelfAction(rawActions.latest),
            recent: (Array.isArray(rawActions.recent) ? rawActions.recent : []).map(normalizeSelfAction).filter(Boolean).slice(0, 5)
          },
          project: rawProject && typeof rawProject.title === "string" ? {
            id: String(rawProject.id || ""),
            title: text(rawProject.title, 60),
            note: text(rawProject.note, 160),
            steps: (Array.isArray(rawProject.steps) ? rawProject.steps : []).filter((step) => step && typeof step.text === "string").slice(-3).map((step) => ({
              at: num(step.at, 0),
              text: text(step.text, 160),
              repeatCount: num(step.repeatCount, 1) > 1 ? Math.floor(num(step.repeatCount, 1)) : 1,
              lastAt: num(step.lastAt, 0)
            })),
            stage: ["working", "waiting_user", "waiting_mirror", "blocked", "idle"].includes(rawProject.stage) ? rawProject.stage : "working",
            progressAt: num(rawProject.progressAt, 0),
            latestRepeat: num(rawProject.latestRepeat, 1) > 1 ? Math.floor(num(rawProject.latestRepeat, 1)) : 1,
            staleAt: num(rawProject.staleAt, 0),
            staleReason: text(rawProject.staleReason, 120),
            attention: rawProject.attention && typeof rawProject.attention.question === "string" ? { question: text(rawProject.attention.question, 200), at: num(rawProject.attention.at, 0) } : null,
            latestReport: rawProject.latestReport && typeof rawProject.latestReport.state === "string" ? { state: text(rawProject.latestReport.state, 20), summary: text(rawProject.latestReport.summary, 240), at: num(rawProject.latestReport.at, 0) } : null
          } : null
        };
      }
      function normalizeSelfAction(item) {
        if (!item || typeof item !== "object" || item.id == null || item.id === "") return null;
        return {
          id: String(item.id),
          label: String(item.label == null ? "" : item.label).slice(0, 40),
          text: String(item.text == null ? "" : item.text).slice(0, 200),
          at: num(item.at, 0)
        };
      }
      function readSeenActionId() {
        const storage = getStorage();
        if (!storage) return "";
        try {
          return String(storage.getItem(ACTION_SEEN_KEY) || "");
        } catch (error) {
          return "";
        }
      }
      function writeSeenActionId(id2) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(ACTION_SEEN_KEY, String(id2 == null ? "" : id2));
        } catch (error) {
        }
      }
      function selfStatusSummary(status) {
        if (!status) return "";
        const growth = status.growth || {};
        const learnings = Math.max(0, Math.floor(num(growth.learnings, 0)));
        const reflections = Math.max(0, Math.floor(num(growth.reflections, 0)));
        const lastLearn = weatherUpdatedLabel(growth.lastLearnAt);
        const lastReflect = weatherUpdatedLabel(growth.lastReflectAt);
        if (!learnings && !reflections && !lastLearn && !lastReflect) return "\u5C1A\u672A\u5F00\u59CB";
        const parts = ["\u81EA\u5B66 " + learnings + " \u6761", "\u81EA\u7701 " + reflections + " \u6B21"];
        if (lastLearn) parts.push("\u4E0A\u6B21\u81EA\u5B66 " + lastLearn);
        if (lastReflect) parts.push("\u4E0A\u6B21\u81EA\u7701 " + lastReflect);
        return parts.join(" \xB7 ");
      }
      function normalizeMemoryStatus(data) {
        if (!data || data.ok === false || !Array.isArray(data.files)) return null;
        const files = data.files.filter((file) => file && typeof file === "object");
        const countBy = (patterns) => {
          let sum = 0;
          for (const file of files) {
            const id2 = String(file.id || "") + " " + String(file.path || "");
            if (!patterns.some((pattern) => id2.toLowerCase().indexOf(pattern) >= 0)) continue;
            sum += Math.max(0, Math.floor(num(file.entries, 0)));
          }
          return sum;
        };
        const health = data.health === "warn" || data.health === "error" ? data.health : data.health === "ok" ? "ok" : "warn";
        const backups = data.backups && typeof data.backups === "object" ? data.backups : {};
        const recovered = typeof data.recovered === "number" ? Math.max(0, Math.floor(data.recovered)) : data.recovered && typeof data.recovered === "object" && typeof data.recovered.count === "number" ? Math.max(0, Math.floor(data.recovered.count)) : data.recovered === true ? 1 : 0;
        return {
          health,
          journal: countBy(["journal"]),
          topics: countBy(["topic"]),
          learnings: countBy(["learn", "growth", "self"]),
          backups: {
            count: Math.max(0, Math.floor(num(backups.count, 0))),
            lastAt: num(backups.lastAt, 0),
            latestId: String(backups.latestId || "")
          },
          recovered,
          updatedAt: num(data.updatedAt, 0)
        };
      }
      function normalizeWorks(raw) {
        if (!raw || raw.ok === false || !Array.isArray(raw.works)) return { works: [] };
        const works = [];
        for (const item of raw.works) {
          if (!item || typeof item.title !== "string") continue;
          const kind = item.kind === "svg" || item.kind === "image" || item.kind === "video" ? item.kind : "text";
          const body = typeof item.body === "string" ? String(item.body) : "";
          if (kind === "text" && body.length < 4) continue;
          const mediaUrl = typeof item.mediaUrl === "string" && item.mediaUrl.length > 0 ? item.mediaUrl : "";
          if ((kind === "image" || kind === "video") && mediaUrl.length === 0) continue;
          works.push({
            id: String(item.id || ""),
            title: item.title.slice(0, 60),
            kind,
            createdAt: num(item.createdAt, 0),
            body: kind === "text" ? body.slice(0, 2e3) : "",
            src: kind === "svg" ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(body) : kind === "image" || kind === "video" ? mediaUrl : ""
          });
          if (works.length >= 6) break;
        }
        return { works };
      }
      function normalizeAttention(raw) {
        if (!raw || raw.ok === false) return { mode: "observe", items: [], pending: 0 };
        const mode = raw.mode === "auto" ? "auto" : "observe";
        const items = (Array.isArray(raw.items) ? raw.items : []).filter((item) => item && typeof item.text === "string" && item.status === "pending").slice(0, 10).map((item) => ({
          id: String(item.id || ""),
          kind: item.kind === "question" || item.kind === "result" ? item.kind : "social",
          text: String(item.text).slice(0, 500),
          reason: String(item.reason || "").slice(0, 160),
          draft: item.draft === true,
          createdAt: num(item.createdAt, 0)
        }));
        return { mode, items, pending: items.length };
      }
      function normalizeTwinState(raw) {
        if (!raw || raw.ok === false || raw.enabled === false) return null;
        const twin = raw.twin && typeof raw.twin === "object" ? raw.twin : {};
        const projects = twin.projects && typeof twin.projects === "object" ? twin.projects : {};
        const project = projects.current && typeof projects.current === "object" ? {
          title: String(projects.current.title || "").slice(0, 60),
          stage: ["working", "waiting_user", "waiting_mirror", "blocked", "idle"].includes(projects.current.stage) ? projects.current.stage : "working",
          question: projects.current.attention && typeof projects.current.attention.question === "string" ? projects.current.attention.question.slice(0, 200) : ""
        } : null;
        return { enabled: true, project };
      }
      function normalizeHealthStatus(raw) {
        const data = raw && typeof raw === "object" ? raw : {};
        const runtime = data.runtime && typeof data.runtime === "object" ? data.runtime : null;
        if (!runtime) return null;
        const budget = runtime.budget && typeof runtime.budget === "object" ? runtime.budget : null;
        const heartbeat = runtime.heartbeat && typeof runtime.heartbeat === "object" ? runtime.heartbeat : null;
        const modelErrors = runtime.modelErrors && typeof runtime.modelErrors === "object" ? runtime.modelErrors : null;
        const consolidate = runtime.consolidate && typeof runtime.consolidate === "object" ? runtime.consolidate : null;
        const growth = runtime.growthMetrics && typeof runtime.growthMetrics === "object" ? runtime.growthMetrics : null;
        const memoryBacklog = consolidate && consolidate.backlog && typeof consolidate.backlog === "object" ? consolidate.backlog : null;
        const jobs = Array.isArray(heartbeat && heartbeat.jobs) ? heartbeat.jobs : [];
        const counts = budget && budget.counts && typeof budget.counts === "object" ? budget.counts : {};
        const roleCounts = Object.keys(counts).map((role) => ({ role, count: num(counts[role], 0) })).filter((item) => item.count > 0).sort((left, right) => right.count - left.count).slice(0, 6);
        return {
          version: data.version || "",
          day: budget && typeof budget.day === "string" ? budget.day : "",
          total: budget ? num(budget.total, 0) : 0,
          totalLimit: budget ? num(budget.totalLimit, 0) : 0,
          roleCounts,
          jobs: jobs.map((job) => ({
            name: String(job.name || ""),
            runs: num(job.runs, 0),
            errors: num(job.errors, 0),
            running: job.running === true,
            lastError: typeof job.lastError === "string" ? job.lastError : ""
          })),
          activeJobs: num(heartbeat && heartbeat.pulses, 0),
          modelErrorTotal: modelErrors ? num(modelErrors.total, 0) : 0,
          memoryBacklog: memoryBacklog ? num(memoryBacklog.entries, 0) : null,
          memoryBacklogOldestAt: memoryBacklog && typeof memoryBacklog.oldestAt === "number" ? memoryBacklog.oldestAt : null,
          growthMetrics: growth ? {
            daysAlive: num(growth.daysAlive, 0),
            journalTotal: growth.journal ? num(growth.journal.total, 0) : 0,
            episodes: growth.memory ? num(growth.memory.episodes, 0) : 0,
            coverage: growth.memory ? num(growth.memory.coverage, 0) : 0,
            learning: growth.learning ? num(growth.learning.sections, 0) : 0,
            repetition: growth.repetition ? num(growth.repetition.maxSimilarity, 0) : 0,
            project: growth.project && typeof growth.project.current === "string" ? growth.project.current : ""
          } : null,
          modelErrorsByRole: modelErrors && modelErrors.byRole && typeof modelErrors.byRole === "object" ? Object.keys(modelErrors.byRole).map((role) => ({ role, count: num(modelErrors.byRole[role], 0) })).sort((a2, b) => b.count - a2.count).slice(0, 4) : []
        };
      }
      function switchNode(checked, onChange, label) {
        return h("button", {
          type: "button",
          role: "switch",
          "aria-checked": checked === true,
          "aria-label": label,
          className: cx("dshp-switch", checked === true && "dshp-is-on"),
          onClick: onChange
        });
      }
      function growthMetricsTree(status) {
        const felt = status && typeof status.felt === "string" ? status.felt : "";
        const context = status && Array.isArray(status.context) ? status.context : [];
        return h(
          "div",
          { className: "dshp-self-being" },
          h("div", { className: "dshp-self-felt" }, felt || "\u8FD8\u6CA1\u60F3\u597D\u81EA\u5DF1\u6B64\u523B\u662F\u4EC0\u4E48\u611F\u89C9\u3002"),
          context.length > 0 ? h(
            "div",
            { className: "dshp-self-context" },
            context.map((line, index2) => h("div", { className: "dshp-self-context-line", key: "ctx-" + index2 }, line))
          ) : null,
          h("div", { className: "dshp-self-summary" }, selfStatusSummary(status) || "\u5C1A\u672A\u5F00\u59CB")
        );
      }
      function readSpontState(now2) {
        const storage = getStorage();
        if (!storage) return normalizeSpontState(null, now2);
        try {
          const raw = storage.getItem(SPONT_KEY);
          return normalizeSpontState(raw ? JSON.parse(raw) : null, now2);
        } catch (error) {
          return normalizeSpontState(null, now2);
        }
      }
      function writeSpontState(state) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(SPONT_KEY, JSON.stringify(state));
        } catch (error) {
        }
      }
      function murmurPeriod(hour) {
        if (hour >= 5 && hour < 9) return "\u65E9\u4E0A";
        if (hour >= 9 && hour < 11) return "\u4E0A\u5348";
        if (hour >= 11 && hour < 14) return "\u4E2D\u5348";
        if (hour >= 14 && hour < 18) return "\u4E0B\u5348";
        if (hour >= 18 && hour < 23) return "\u665A\u4E0A";
        return "\u6DF1\u591C";
      }
      function requestSelfTalk(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (typeof fetch !== "function") return Promise.resolve({ ok: false, reason: "no-fetch" });
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let timer2 = null;
        const timeout2 = new Promise((resolve) => {
          timer2 = setTimeout(() => {
            try {
              if (controller) controller.abort();
            } catch (error) {
            }
            resolve({ ok: false, reason: "timeout" });
          }, SELF_TALK_TIMEOUT_MS);
        });
        const request = Promise.resolve().then(() => fetch(ROUTE + selfTalkQuery(opts), controller ? { signal: controller.signal } : void 0)).then((response) => {
          if (!response || typeof response.ok !== "boolean" || !response.ok) {
            return { ok: false, reason: "http", status: response ? response.status : 0 };
          }
          return Promise.resolve(response.json()).then((data) => parseSelfTalkResponse(data)).catch(() => ({ ok: false, reason: "json" }));
        }).catch(() => ({ ok: false, reason: "network" }));
        return Promise.race([request, timeout2]).then((result) => {
          if (timer2) clearTimeout(timer2);
          return result;
        });
      }
      function assetUrlFor(kind, version) {
        const file = ASSET_DATA_FILES[kind];
        if (!file) return "";
        return "/api/dsh-poetry/assets?f=" + file + "&v=" + encodeURIComponent(String(version == null ? "" : version));
      }
      function buildPingshuiIndex(raw) {
        const sourceCategories = raw && Array.isArray(raw.categories) ? raw.categories : [];
        const categories = sourceCategories.map((cat, index2) => {
          const value = cat && typeof cat === "object" ? cat : {};
          return {
            index: index2,
            name: String(value.name || value.short || "\u97F5\u90E8" + (index2 + 1)),
            short: String(value.short || value.name || "\u97F5\u90E8" + (index2 + 1)),
            tone: String(value.tone || "").toLowerCase() === "ping" || value.tone === "\u5E73" ? "\u5E73" : "\u4EC4",
            chars: String(value.chars == null ? "" : value.chars)
          };
        });
        const charMap = {};
        const addChar = (ch, index2) => {
          if (!ch) return;
          const list = charMap[ch] || (charMap[ch] = []);
          if (list.indexOf(index2) < 0) list.push(index2);
        };
        const rawIndex = raw && raw.charIndex && typeof raw.charIndex === "object" ? raw.charIndex : null;
        if (rawIndex) {
          for (const ch of Object.keys(rawIndex)) {
            const arr = Array.isArray(rawIndex[ch]) ? rawIndex[ch] : [];
            for (const index2 of arr) if (Number.isInteger(index2) && categories[index2]) addChar(ch, index2);
          }
        }
        for (const cat of categories) for (const ch of Array.from(cat.chars)) addChar(ch, cat.index);
        function charInfo(ch) {
          const indices = charMap[ch] || [];
          const cats = indices.map((index2) => categories[index2]).filter(Boolean);
          const tones = [];
          for (const cat of cats) if (tones.indexOf(cat.tone) < 0) tones.push(cat.tone);
          const rhymes = [];
          for (const cat of cats) if (cat.tone === "\u5E73" && rhymes.indexOf(cat.short) < 0) rhymes.push(cat.short);
          const candidates = [];
          for (const cat of cats) candidates.push({ tone: cat.tone, name: cat.short });
          return { ch, tones, rhymes, candidates };
        }
        return { categories, charMap, charInfo, ready: categories.length > 0 };
      }
      function tonesFromToneChar(toneChar) {
        if (toneChar === "\u5E73") return ["\u5E73"];
        if (toneChar === "\u4EC4") return ["\u4EC4"];
        if (toneChar === "\u25CB" || toneChar === "\u3007") return ["\u5E73", "\u4EC4"];
        return [];
      }
      function annotatePoemLines(lines, tones, pingshui) {
        const out = [];
        const toneLines = Array.isArray(tones) ? tones : [];
        for (let lineIndex = 0; lineIndex < (Array.isArray(lines) ? lines.length : 0); lineIndex += 1) {
          const lineChars = Array.from(String(lines[lineIndex] == null ? "" : lines[lineIndex]));
          const toneChars = Array.from(String(toneLines[lineIndex] == null ? "" : toneLines[lineIndex]));
          const cells = [];
          for (let index2 = 0; index2 < lineChars.length; index2 += 1) {
            const ch = lineChars[index2];
            if (isPunctuation(ch)) continue;
            const rawTone = toneChars[index2] || "";
            const info = pingshui && typeof pingshui.charInfo === "function" ? pingshui.charInfo(ch) : { tones: [], rhymes: [], candidates: [] };
            const allowed = rawTone ? tonesFromToneChar(rawTone) : info.tones || [];
            cells.push({
              ch,
              allowed,
              tone: allowed.length === 0 ? "\uFF1F" : allowed.length > 1 ? "\u25CB" : allowed[0],
              rhymes: info.rhymes || [],
              candidates: info.candidates || []
            });
          }
          out.push(cells);
        }
        return out;
      }
      function patternForShape(form, start2, firstRhyme) {
        const key = start2 + (firstRhyme ? "\u5165\u97F5" : "\u4E0D\u5165\u97F5");
        const five = TONE_QUATRAINS[key] || TONE_QUATRAINS["\u5E73\u8D77\u4E0D\u5165\u97F5"];
        const size = form && form.charAt(0) === "\u4E03" ? 7 : 5;
        const base = size === 7 ? five.map((line) => (line.charAt(0) === "\u5E73" ? "\u4EC4\u4EC4" : "\u5E73\u5E73") + line) : five.slice();
        const lines = form && form.charAt(1) === "\u5F8B" ? base.concat(base) : base;
        return lines;
      }
      function allowedRelation(cellA, cellB, relation) {
        const listA = cellA && Array.isArray(cellA.allowed) ? cellA.allowed : [];
        const listB = cellB && Array.isArray(cellB.allowed) ? cellB.allowed : [];
        if (!listA.length || !listB.length) return null;
        for (const a2 of listA) {
          for (const b of listB) {
            if (relation === "dui" ? a2 !== b : a2 === b) return true;
          }
        }
        return false;
      }
      function rhymeSetOf(cell) {
        const names = cell && Array.isArray(cell.rhymes) ? cell.rhymes : [];
        return names;
      }
      function detectMetre(annotation, pingshui) {
        const report = {
          ok: true,
          errors: [],
          form: "",
          start: "",
          firstRhyme: false,
          meter: "",
          weakTones: !pingshui || !pingshui.ready,
          rhymeError: "",
          rhymeLines: [],
          rhymeGroup: [],
          violations: [],
          sticky: [],
          sanPing: [],
          guPing: [],
          summary: ""
        };
        const lineCount = Array.isArray(annotation) ? annotation.length : 0;
        const size = lineCount ? annotation[0].length : 0;
        if (![4, 8].includes(lineCount) || ![5, 7].includes(size) || annotation.some((line) => line.length !== size)) {
          report.ok = false;
          report.errors.push("\u9700\u8981 4 \u53E5\u6216 8 \u53E5\u3001\u6BCF\u53E5 5 \u6216 7 \u4E2A\u5B57\uFF08\u5F53\u524D " + lineCount + " \u53E5 / \u9996\u53E5 " + size + " \u5B57\uFF09");
          return report;
        }
        report.form = (size === 5 ? "\u4E94" : "\u4E03") + (lineCount === 4 ? "\u7EDD" : "\u5F8B");
        const firstLine = annotation[0];
        const startOptions = [];
        const secondTones = firstLine[1] ? firstLine[1].allowed : [];
        if (secondTones.indexOf("\u5E73") >= 0) startOptions.push("\u5E73\u8D77");
        if (secondTones.indexOf("\u4EC4") >= 0) startOptions.push("\u4EC4\u8D77");
        if (!startOptions.length) startOptions.push("\u5E73\u8D77", "\u4EC4\u8D77");
        const lastTones = firstLine[firstLine.length - 1] ? firstLine[firstLine.length - 1].allowed : [];
        const rhymeOptions = lastTones.indexOf("\u5E73") >= 0 ? [true] : lastTones.length ? [false] : [true, false];
        if (lastTones.indexOf("\u5E73") >= 0 && lastTones.indexOf("\u4EC4") >= 0) rhymeOptions.length = 0;
        if (rhymeOptions.length === 0) rhymeOptions.push(true, false);
        const mandatory = size === 5 ? [1, 3] : [1, 3, 5];
        let best = null;
        for (const start2 of startOptions) {
          for (const firstRhyme of rhymeOptions) {
            const pattern2 = patternForShape(report.form, start2, firstRhyme);
            let violations = 0;
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
              for (const position of mandatory) {
                const cell = annotation[lineIndex][position];
                const expected = pattern2[lineIndex] ? pattern2[lineIndex].charAt(position) : "";
                if (!cell || !cell.allowed.length || !expected) continue;
                if (cell.allowed.indexOf(expected) < 0) violations += 1;
              }
            }
            if (!best || violations < best.violations) best = { start: start2, firstRhyme, pattern: pattern2, violations };
          }
        }
        report.start = best.start;
        report.firstRhyme = best.firstRhyme;
        report.meter = best.start + "\u9996\u53E5" + (best.firstRhyme ? "\u5165\u97F5" : "\u4E0D\u5165\u97F5");
        const pattern = best.pattern;
        const rhymeIndexes = [];
        for (let lineIndex = 1; lineIndex < lineCount; lineIndex += 2) rhymeIndexes.push(lineIndex);
        if (best.firstRhyme) rhymeIndexes.unshift(0);
        rhymeIndexes.sort((a2, b) => a2 - b);
        for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
          for (const position of mandatory) {
            const cell = annotation[lineIndex][position];
            const expected = pattern[lineIndex] ? pattern[lineIndex].charAt(position) : "";
            if (!cell || !cell.allowed.length || !expected) continue;
            if (cell.allowed.indexOf(expected) < 0) {
              report.violations.push({ line: lineIndex + 1, position: position + 1, ch: cell.ch, expected, actual: cell.tone });
            }
          }
        }
        const rhymeSets = [];
        for (const lineIndex of rhymeIndexes) {
          const cell = annotation[lineIndex][annotation[lineIndex].length - 1];
          const isPing = cell && cell.allowed.indexOf("\u5E73") >= 0;
          if (!isPing) report.violations.push({ line: lineIndex + 1, position: annotation[lineIndex].length, ch: cell ? cell.ch : "", expected: "\u5E73", actual: cell ? cell.tone : "\uFF1F", rhyme: true });
          rhymeSets.push({ line: lineIndex, cell, names: rhymeSetOf(cell) });
        }
        if (report.weakTones) {
          report.rhymeError = "\u7F3A\u5C11\u5E73\u6C34\u97F5\u6570\u636E\uFF0C\u97F5\u90E8\u5224\u5B9A\u5DF2\u8DF3\u8FC7";
        } else {
          const mainSets = rhymeSets.filter((entry) => entry.line !== 0);
          const anchor = mainSets.length ? mainSets[0].names : rhymeSets[0] ? rhymeSets[0].names : [];
          const group = [];
          for (const name of anchor) {
            if (mainSets.every((entry) => entry.names.indexOf(name) >= 0)) group.push(name);
          }
          report.rhymeGroup = group;
          for (const entry of rhymeSets) {
            const borrowed = entry.line === 0 && !entry.names.some((name) => group.indexOf(name) >= 0);
            report.rhymeLines.push({
              line: entry.line + 1,
              ch: entry.cell ? entry.cell.ch : "",
              names: entry.names,
              borrowed: Boolean(borrowed && best.firstRhyme)
            });
            if (!group.length) continue;
            if (borrowed) continue;
            if (!entry.names.some((name) => group.indexOf(name) >= 0)) report.rhymeError = "\u7B2C " + (entry.line + 1) + " \u53E5\u97F5\u811A\u51FA\u97F5\uFF08" + (entry.names.join("/") || "\u672A\u77E5") + "\uFF09";
          }
          if (!group.length) report.rhymeError = report.rhymeError || "\u97F5\u811A\u6CA1\u6709\u5171\u540C\u97F5\u90E8\uFF08\u53EF\u80FD\u51FA\u97F5\u6216\u5E73\u6C34\u97F5\u6570\u636E\u7F3A\u5931\uFF09";
        }
        for (let lineIndex = 0; lineIndex + 1 < lineCount; lineIndex += 1) {
          const relation = lineIndex % 2 === 0 ? "dui" : "nian";
          for (const position of mandatory) {
            const ok = allowedRelation(annotation[lineIndex][position], annotation[lineIndex + 1][position], relation);
            if (ok === false) {
              report.sticky.push({ pair: lineIndex + 1 + "-" + (lineIndex + 2), type: relation === "dui" ? "\u5BF9" : "\u7C98", position: position + 1 });
            }
          }
        }
        for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
          const cells = annotation[lineIndex];
          if (cells.length >= 3) {
            const tail = cells.slice(-3);
            if (tail.every((cell) => cell.allowed.indexOf("\u5E73") >= 0)) report.sanPing.push(lineIndex + 1);
          }
          const expectedLine = pattern[lineIndex] || "";
          const lonelyPattern = size === 5 ? "\u5E73\u5E73\u4EC4\u4EC4\u5E73" : "\u4EC4\u4EC4\u5E73\u5E73\u4EC4\u4EC4\u5E73";
          if (expectedLine === lonelyPattern) {
            const position = size === 5 ? 0 : 2;
            const cell = cells[position];
            if (cell && cell.allowed.length === 1 && cell.allowed[0] === "\u4EC4") report.guPing.push(lineIndex + 1);
          }
        }
        report.annotation = annotation;
        const rhymeText = report.rhymeLines.map((entry) => entry.ch + (entry.names.length ? "\uFF08" + entry.names.join("/") + "\uFF09" : "") + (entry.borrowed ? "[\u501F\u97F5]" : "")).join("\u3001");
        report.summary = report.form + "\uFF0C" + report.meter + "\uFF1B\u97F5\u811A\uFF1A" + (rhymeText || "\u2014") + (report.rhymeGroup.length ? "\uFF0C\u97F5\u90E8 " + report.rhymeGroup.join("/") : "") + (report.rhymeError ? "\uFF1B" + report.rhymeError : "") + "\uFF1B\u7C98\u5BF9" + (report.sticky.length ? "\u6709 " + report.sticky.length + " \u5904\u5931\u7C98/\u5931\u5BF9" : "\u6210\u7ACB") + "\uFF1B\u62D7\u5B57 " + report.violations.filter((item) => !item.rhyme).length + " \u5904" + (report.sanPing.length ? "\uFF1B\u4E09\u5E73\u8C03\uFF1A\u7B2C " + report.sanPing.join("\u3001") + " \u53E5" : "") + (report.guPing.length ? "\uFF1B\u5B64\u5E73\uFF1A\u7B2C " + report.guPing.join("\u3001") + " \u53E5" : "");
        return report;
      }
      function detectPoem(poem, pingshui) {
        const lines = poem && Array.isArray(poem.lines) ? poem.lines : [];
        const tones = poem && Array.isArray(poem.tones) ? poem.tones : null;
        return detectMetre(annotatePoemLines(lines, tones, pingshui), pingshui);
      }
      function parsePoemInput(text) {
        const source = String(text == null ? "" : text).trim();
        if (!source) return { error: "\u8BF7\u8F93\u5165\u8BD7\u53E5" };
        const clauses = [];
        for (const row of source.split(/[\n\r]+/)) {
          for (const part of String(row).split(/[，,。.！!？?；;：:、\s]+/)) {
            const chars = Array.from(part.replace(/[^\u4e00-\u9fff]/g, ""));
            if (chars.length) clauses.push({ raw: part.trim(), chars });
          }
        }
        if (![4, 8].includes(clauses.length)) return { error: "\u9700\u8981 4 \u53E5\u6216 8 \u53E5\uFF08\u5F53\u524D " + clauses.length + " \u53E5\uFF09\uFF0C\u8BF7\u7528\u6362\u884C\u6216\u6807\u70B9\u5206\u9694" };
        const size = clauses[0].chars.length;
        if (![5, 7].includes(size)) return { error: "\u6BCF\u53E5\u9700\u8981 5 \u6216 7 \u4E2A\u5B57\uFF08\u9996\u53E5\u4E3A " + size + " \u5B57\uFF09" };
        for (let index2 = 0; index2 < clauses.length; index2 += 1) {
          if (clauses[index2].chars.length !== size) return { error: "\u7B2C " + (index2 + 1) + " \u53E5\u4E3A " + clauses[index2].chars.length + " \u5B57\uFF0C\u4E0E\u524D\u53E5 " + size + " \u5B57\u4E0D\u4E00\u81F4" };
        }
        return { lines: clauses };
      }
      function detectPoemText(text, pingshui) {
        const parsed = parsePoemInput(text);
        if (parsed.error) return { ok: false, errors: [parsed.error], summary: parsed.error };
        const annotation = parsed.lines.map((clause) => annotatePoemLines([clause.raw], null, pingshui)[0]);
        return detectMetre(annotation, pingshui);
      }
      function formatDetectionReport(report) {
        if (!report) return "";
        const lines = ["\u3010\u683C\u5F8B\u68C0\u6D4B\u3011" + (report.summary || "")];
        for (const error of report.errors || []) lines.push("\u26A0 " + error);
        for (const item of report.violations || []) lines.push("\xB7 \u7B2C " + item.line + " \u53E5\u7B2C " + item.position + " \u5B57\u300C" + item.ch + "\u300D\u5B9C" + item.expected + "\uFF08\u5B9E\u9645 " + item.actual + "\uFF09");
        for (const item of report.sticky || []) lines.push("\xB7 \u7B2C " + item.pair + " \u53E5\u5931" + item.type + "\uFF08\u7B2C " + item.position + " \u5B57\uFF09");
        for (const line of report.sanPing || []) lines.push("\xB7 \u7B2C " + line + " \u53E5\u7591\u4F3C\u4E09\u5E73\u8C03");
        for (const line of report.guPing || []) lines.push("\xB7 \u7B2C " + line + " \u53E5\u7591\u4F3C\u5B64\u5E73");
        return lines.join("\n");
      }
      function detectionRhymeIndexes(report) {
        const set3 = {};
        for (const item of report && report.rhymeLines || []) set3[item.line - 1] = true;
        return set3;
      }
      function normalizeMascotEggState(raw, now2) {
        const source = raw && typeof raw === "object" ? raw : {};
        const dateKey = shanghaiParts(now2).dateKey;
        const sameDay = source.date === dateKey;
        return {
          date: dateKey,
          greeted: sameDay ? source.greeted === true : false,
          greetAt: sameDay ? num(source.greetAt, 0) : 0,
          idleAt: num(source.idleAt, 0)
        };
      }
      function readMascotEggState(now2) {
        const storage = getStorage();
        if (!storage) return normalizeMascotEggState(null, now2);
        try {
          const raw = storage.getItem(MASCOT_EGG_KEY);
          return normalizeMascotEggState(raw ? JSON.parse(raw) : null, now2);
        } catch (error) {
          return normalizeMascotEggState(null, now2);
        }
      }
      function writeMascotEggState(state) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(MASCOT_EGG_KEY, JSON.stringify(state));
        } catch (error) {
        }
      }
      function recordMascotEgg(state, patch, now2) {
        const base = normalizeMascotEggState(state, now2);
        const time = num(now2, Date.now());
        return {
          date: base.date,
          greeted: base.greeted || Boolean(patch && patch.greet),
          greetAt: patch && patch.greet ? time : base.greetAt,
          idleAt: patch && patch.idle ? time : base.idleAt
        };
      }
      function shouldShowDailyGreet(state, now2) {
        return !normalizeMascotEggState(state, now2).greeted;
      }
      function canShowIdlePose(state, now2, lastInteractionAt) {
        const normalized = normalizeMascotEggState(state, now2);
        const time = num(now2, Date.now());
        if (normalized.idleAt > 0 && time - normalized.idleAt < MASCOT_IDLE_MIN_MS) return false;
        const lastInteraction = num(lastInteractionAt, 0);
        if (lastInteraction > 0 && time - lastInteraction < MASCOT_IDLE_USER_MS) return false;
        return true;
      }
      function pickMascotExpression(random) {
        const value = typeof random === "function" ? Number(random()) : Math.random();
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        const index2 = Math.floor(ratio * MASCOT_EXPRESSION_FILES.length);
        return MASCOT_EXPRESSION_FILES[index2] || MASCOT_EXPRESSION_FILES[0];
      }
      let bootstrapCache = null;
      const RESOURCE_CACHE_KEYS = ["poems", "ci", "yun", "knowledge", "anthology", "bank", "pingshui", "ciBank", "moodCatalog"];
      const resourceCache = { poems: null, ci: null, yun: null, knowledge: null, anthology: null, bank: null, pingshui: null, ciBank: null, moodCatalog: null };
      const resourceInflight = { poems: null, ci: null, yun: null, knowledge: null, anthology: null, bank: null, pingshui: null, ciBank: null, moodCatalog: null };
      let assetDataVersion = "";
      function setAssetDataVersion(version) {
        const next = version == null ? "" : String(version);
        if (next === assetDataVersion) return;
        assetDataVersion = next;
        clearFeihuaFullCache();
        clearPetMediaCache();
        for (const kind of ["anthology", "bank", "pingshui", "ciBank", "moodCatalog"]) {
          resourceCache[kind] = null;
          resourceInflight[kind] = null;
        }
      }
      function getStorage() {
        try {
          if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
        } catch (error) {
        }
        return null;
      }
      function fetchJson(path, init2) {
        return fetchJsonUrl(ROUTE + path, init2);
      }
      function fetchJsonUrl(url, init2) {
        if (typeof fetch !== "function") return Promise.reject(new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u7F51\u7EDC\u8BF7\u6C42"));
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer2 = controller ? setTimeout(() => {
          try {
            controller.abort();
          } catch (error) {
          }
        }, FETCH_TIMEOUT_MS) : null;
        const options = Object.assign({}, init2 || {});
        if (controller) options.signal = controller.signal;
        return Promise.resolve().then(() => fetch(url, options)).then((response) => {
          if (!response || typeof response.ok !== "boolean") throw new Error("\u54CD\u5E94\u5F02\u5E38");
          if (!response.ok) {
            const error = new Error("HTTP " + response.status);
            error.status = response.status;
            throw error;
          }
          return response.json();
        }).then((data) => {
          if (!data || data.ok === false) {
            const detail = data && data.error ? data.error : null;
            const error = new Error(detail && detail.message || "\u6570\u636E\u4E0D\u53EF\u7528");
            if (detail && detail.code) error.code = detail.code;
            throw error;
          }
          return data;
        }).finally(() => {
          if (timer2) clearTimeout(timer2);
        });
      }
      function clearResourceCache(kind) {
        clearFeihuaIndexCache();
        clearFeihuaFullCache();
        clearPetMediaCache();
        if (kind) {
          resourceCache[kind] = null;
          resourceInflight[kind] = null;
          return;
        }
        for (const key of RESOURCE_CACHE_KEYS) {
          resourceCache[key] = null;
          resourceInflight[key] = null;
        }
      }
      function loadResource(kind) {
        const assetFile = ASSET_DATA_FILES[kind];
        if (!assetFile && !RESOURCE_PATHS[kind]) return Promise.reject(new Error("\u672A\u77E5\u6570\u636E\u7C7B\u578B\uFF1A" + kind));
        if (resourceCache[kind]) return Promise.resolve(resourceCache[kind]);
        if (!resourceInflight[kind]) {
          const url = assetFile ? assetUrlFor(kind, assetDataVersion) : ROUTE + RESOURCE_PATHS[kind];
          resourceInflight[kind] = fetchJsonUrl(url).then(
            (data) => {
              resourceCache[kind] = data;
              resourceInflight[kind] = null;
              return data;
            },
            (error) => {
              resourceInflight[kind] = null;
              throw error;
            }
          );
        }
        return resourceInflight[kind];
      }
      function readFirstScreenCache() {
        const storage = getStorage();
        if (!storage) return null;
        try {
          const raw = storage.getItem(CACHE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || !parsed.bootstrap) return null;
          if (!parsed.bootstrap.today || typeof parsed.bootstrap.today !== "object") return null;
          return parsed;
        } catch (error) {
          return null;
        }
      }
      function writeFirstScreenCache(payload) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(CACHE_KEY, JSON.stringify(payload));
        } catch (error) {
        }
      }
      function clearFirstScreenCache() {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.removeItem(CACHE_KEY);
        } catch (error) {
        }
      }
      function readStoredPosition() {
        const storage = getStorage();
        if (!storage) return null;
        try {
          const raw = storage.getItem(POS_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || !Number.isFinite(Number(parsed.x)) || !Number.isFinite(Number(parsed.y))) return null;
          return {
            x: Number(parsed.x),
            y: Number(parsed.y),
            snap: parsed.snap === "right" || parsed.snap === "free" ? parsed.snap : "left"
          };
        } catch (error) {
          return null;
        }
      }
      function writeStoredPosition(position) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(POS_KEY, JSON.stringify({
            x: Math.round(position.x),
            y: Math.round(position.y),
            snap: position.snap
          }));
        } catch (error) {
        }
      }
      function putSettings(patch) {
        const request = buildSettingsRequest(patch);
        return fetchJson("settings.json", request.init).then((data) => {
          if (bootstrapCache && data && data.settings) {
            bootstrapCache = Object.assign({}, bootstrapCache, { settings: data.settings });
          }
          return data;
        });
      }
      const DEBUG = {
        ROUTE,
        ASSET_BASE,
        WIDGET_ID,
        STEPS,
        PANEL_TABS,
        POETRY_TABS,
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
        feihuaSubmit,
        feihuaLookup,
        feihuaPlainOf,
        mergeFeihuaFullEntries,
        requestFeihuaFull,
        abortFeihuaFull,
        clearFeihuaFullCache,
        readFeihuaFullCache,
        FEIHUA_FULL_PATH,
        FEIHUA_FULL_TIMEOUT_MS,
        FEIHUA_FULL_RETRY_MS,
        PET_MEDIA_PATH,
        PET_MEDIA_CATALOG_FILE,
        PET_MEDIA_TIMEOUT_MS,
        isVideoMoodFile,
        petMediaUrl,
        mascotVideoShouldPause,
        mascotFilePriority,
        DIZZY_MIN_MS,
        DIZZY_MAX_MS,
        mealTriggerFor,
        DIZZY_FAST_PX_PER_SEC,
        DIZZY_FAST_DISTANCE_PX,
        DIZZY_FAST_WINDOW_MS,
        MEAL_KEY,
        MEAL_PLAY_MIN_MS,
        MEAL_PLAY_MAX_MS,
        detectFastDrag,
        nextDizzyDuration,
        nextMealDuration,
        mealMomentFor,
        normalizeMealState,
        readMealState,
        writeMealState,
        markMealDone,
        pickDizzyMedia,
        pickMealMedia,
        normalizePetMediaCatalog,
        mergePetMediaIntoCatalog,
        requestPetMediaCatalog,
        clearPetMediaCache,
        MOTION_ROTATION_KEY,
        MOTION_MIN_DELAY_MS,
        MOTION_MAX_DELAY_MS,
        MOTION_PLAY_MIN_MS,
        MOTION_PLAY_MAX_MS,
        MOTION_FIRST_MIN_DELAY_MS,
        MOTION_FIRST_MAX_DELAY_MS,
        nextMotionFirstDelay,
        nextMotionScheduleDelay,
        readMotionRotation,
        writeMotionRotation,
        nextMotionEntry,
        nextMotionDelay,
        nextMotionDuration,
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
        SELF_PATH,
        SELF_POLL_MS,
        ACTION_SEEN_KEY,
        readSeenActionId,
        writeSeenActionId,
        normalizeSelfAction,
        MEMORY_PATH,
        MEMORY_BACKUP_PATH,
        MEMORY_POLL_MS,
        normalizeMemoryStatus,
        normalizeSelfStatus,
        selfStatusSummary,
        MOOD_LABELS,
        MOOD_IMAGES,
        MOOD_SWITCH_MIN_MS,
        MOOD_STRONG,
        MOOD_AI_PATH,
        MOOD_AI_TIMEOUT_MS,
        MOOD_AI_DEBOUNCE_MIN_MS,
        MOOD_AI_DEBOUNCE_MAX_MS,
        MOOD_AI_MIN_GAP_MS,
        MOOD_AI_RETRY_MIN_MS,
        MOOD_AI_RETRY_MAX_MS,
        MOOD_AI_KEEP_MS,
        MOOD_AI_MAX_RETRIES,
        nextMoodAiRetryDelay,
        moodAiKeepDecision,
        normalizeMoodAiFailure,
        moodAiFailureLabel,
        moodAiEventDelay,
        MOOD_AI_RECENT_MAX,
        MOOD_AI_RECENT_IMAGES_MAX,
        MOOD_PANEL_PEEK_FILES,
        SPONT_KEY,
        SPONT_POLL_MIN_MS,
        SPONT_POLL_MAX_MS,
        SPONT_RETRY_MS,
        SPONT_EVENT_MIN_MS,
        SPONT_EVENT_MAX_MS,
        SPONT_CLOSE_RECHECK_MS,
        SPONT_QUIET_MS,
        SPONT_REPEAT_MS,
        SPONT_AUTO_CLOSE_MS,
        SPONT_SEEN_DAYS,
        SPONT_MAX_SEEN,
        selfTalkQuery,
        parseSelfTalkResponse,
        requestSelfTalk,
        selfTalkKindFor,
        selfTalkNoveltySignature,
        SELF_TALK_PATH,
        SELF_TALK_TIMEOUT_MS,
        SELF_TALK_RECENT_MAX,
        WINDOW_WANDER_ENABLED,
        WANDER_TICK_MS,
        WANDER_WALK_MS,
        WANDER_MIN_DISTANCE,
        nextWanderTarget,
        pickWanderMedia,
        WANDER_STATIC_FILE,
        shanghaiParts,
        normalizeMoodStats,
        computeMood,
        throttleMoodSwitch,
        mascotImageFor,
        moodBasisText,
        normalizeMoodCatalog,
        panelPeekFile,
        moodCatalogAllows,
        moodAiQuery,
        parseMoodAiResponse,
        requestMoodAi,
        nextMoodAiDebounceDelay,
        moodAiSnapshot,
        moodTimeBucket,
        isMoodAiSignificant,
        moodImageFor: (key) => (MOOD_IMAGES[key] || MOOD_IMAGES.calm)[0],
        normalizeSpontState,
        readSpontState,
        writeSpontState,
        recordSpontShown,
        canShowSpontaneous,
        nextSpontPollDelay,
        nextSpontEventDelay,
        countSpontHits,
        splitCompleteSentences,
        pickSentenceFromLines,
        LIBRARY_CATEGORIES,
        LIBRARY_CATEGORY_ALIASES,
        LIBRARY_PAGE,
        ASSET_DATA_FILES,
        TONE_QUATRAINS,
        MASCOT_EGG_KEY,
        MASCOT_EXPRESSION_FILES,
        MASCOT_EXPRESSION_MS,
        MASCOT_IDLE_MIN_MS,
        MASCOT_IDLE_USER_MS,
        assetUrlFor,
        buildLibraryItems,
        filterLibraryItems,
        libraryPage,
        libraryItemLabel,
        ciBankRhythmics,
        ciSelectedLibraryItems,
        ciSelectedRhythmics,
        mergeFeihuaItems,
        finishFeihuaIndex,
        feihuaSourceOf,
        completeSentencesFromLines,
        buildPingshuiIndex,
        annotatePoemLines,
        detectMetre,
        detectPoem,
        detectPoemText,
        parsePoemInput,
        formatDetectionReport,
        detectionRhymeIndexes,
        patternForShape,
        setAssetDataVersion,
        normalizeMascotEggState,
        readMascotEggState,
        writeMascotEggState,
        recordMascotEgg,
        shouldShowDailyGreet,
        canShowIdlePose,
        pickMascotExpression,
        LibraryTab,
        GrowthTab,
        PoetryWidget,
        TodayTab,
        ClassTab,
        YunTab,
        CiTab,
        FeihuaTab,
        SettingsTab,
        PoetrySettingsTab,
        normalizeHealthStatus
      };
      try {
        if (typeof globalThis !== "undefined") globalThis.__dshPoetryDebug = DEBUG;
      } catch (error) {
      }
      function readWindowWidth() {
        try {
          return window.innerWidth || 1280;
        } catch (error) {
          return 1280;
        }
      }
      function readWindowHeight() {
        try {
          return window.innerHeight || 800;
        } catch (error) {
          return 800;
        }
      }
      function useViewportSize() {
        const [size, setSize] = React.useState(() => ({ w: readWindowWidth(), h: readWindowHeight() }));
        React.useEffect(() => {
          const onResize = () => setSize({ w: readWindowWidth(), h: readWindowHeight() });
          window.addEventListener("resize", onResize);
          return () => window.removeEventListener("resize", onResize);
        }, []);
        return size;
      }
      function useResource(kind, active) {
        const [state, setState] = React.useState(() => ({
          status: resourceCache[kind] ? "ready" : "idle",
          data: resourceCache[kind] || null,
          error: null
        }));
        const alive = React.useRef(true);
        const statusRef = React.useRef(state.status);
        statusRef.current = state.status;
        React.useEffect(() => () => {
          alive.current = false;
        }, []);
        const reload = React.useCallback(() => {
          if (statusRef.current === "loading") return Promise.resolve();
          statusRef.current = "loading";
          setState((previous) => ({ status: "loading", data: previous.data, error: null }));
          return loadResource(kind).then(
            (data) => {
              statusRef.current = "ready";
              if (alive.current) setState({ status: "ready", data, error: null });
              return data;
            },
            (error) => {
              statusRef.current = "error";
              if (alive.current) setState({ status: "error", data: null, error });
              throw error;
            }
          );
        }, [kind]);
        React.useEffect(() => {
          if (active && statusRef.current === "idle") reload().catch(() => {
          });
        }, [active, reload]);
        return [state, reload];
      }
      function LoadingState(props) {
        return h(
          "div",
          { className: "dshp-loading" },
          h("span", { className: "dshp-spinner", "aria-hidden": "true" }),
          h("span", null, props && props.text || "\u6B63\u5728\u8F7D\u5165\u2026")
        );
      }
      function EmptyState(props) {
        const options = props || {};
        return h(
          "div",
          { className: "dshp-empty" },
          h("div", { className: "dshp-empty-icon", "aria-hidden": "true" }, options.icon || "\u{1F4DC}"),
          h("div", { className: "dshp-empty-title" }, options.title || "\u6682\u65F6\u6CA1\u6709\u5185\u5BB9"),
          h("div", { className: "dshp-empty-msg" }, options.message || "\u8BF7\u7A0D\u540E\u91CD\u8BD5"),
          options.onRetry ? h("button", { type: "button", className: "dshp-btn dshp-btn-primary", onClick: options.onRetry }, options.retryLabel || "\u91CD\u8BD5") : null
        );
      }
      function Legend() {
        return h(
          "div",
          { className: "dshp-legend", "aria-label": "\u5E73\u4EC4\u56FE\u4F8B" },
          h("span", { className: "dshp-legend-item" }, h("span", { className: "dshp-legend-dot", style: { background: "var(--dshp-ping)" } }), "\u5E73"),
          h("span", { className: "dshp-legend-item" }, h("span", { className: "dshp-legend-dot", style: { background: "var(--dshp-ze)" } }), "\u4EC4"),
          h("span", { className: "dshp-legend-item" }, h("span", { className: "dshp-legend-dot", style: { background: "var(--dshp-any)" } }), "\u591A\u97F3"),
          h("span", { className: "dshp-legend-item" }, h("span", { className: "dshp-legend-line" }), "\u97F5\u811A")
        );
      }
      function ToneLine(props) {
        const cells = buildToneCells(props.line, props.tones, {
          showTones: props.showTones !== false,
          rhymeLine: props.rhyme === true
        });
        return h(
          "div",
          { className: "dshp-line" },
          cells.map((cell, index2) => h(
            "span",
            {
              key: index2,
              className: cell.className,
              title: cell.punctuation ? void 0 : cell.tone || ""
            },
            cell.tone ? h("span", { className: "dshp-tone", "aria-hidden": "true" }, cell.tone) : null,
            h("span", { className: "dshp-chr" }, cell.ch)
          ))
        );
      }
      function PoemBody(props) {
        if (!props.poem) return null;
        const text = selectPoemText(props.poem, props.script);
        const rhymeLines = poemRhymeLines(props.poem);
        return h(
          "div",
          { className: "dshp-poem" },
          h("div", { className: "dshp-poem-title" }, text.title || "\u65E0\u9898"),
          text.author ? h("div", { className: "dshp-poem-author" }, text.author) : null,
          h(
            "div",
            { className: "dshp-poem-lines" },
            text.lines.map((line, index2) => h(ToneLine, {
              key: index2,
              line,
              tones: Array.isArray(props.poem.tones) ? props.poem.tones[index2] : "",
              rhyme: rhymeLines.indexOf(index2) >= 0,
              showTones: props.showTones !== false
            }))
          ),
          props.showTones !== false ? h(Legend) : null
        );
      }
      function AnalysisBody(props) {
        const poem = props.poem || {};
        const rhymeLines = poemRhymeLines(poem).map((index2) => "\u7B2C " + (index2 + 1) + " \u53E5");
        const firstRhyme = poem.firstRhyme === true ? "\u662F" : poem.firstRhyme === false ? "\u5426" : "\u2014";
        return h(
          "div",
          { className: "dshp-analysis" },
          h(
            "div",
            { className: "dshp-tags" },
            h("span", { className: "dshp-tag" }, "\u4F53\u5F0F\uFF1A" + (poem.form || "\u2014")),
            h("span", { className: "dshp-tag" }, "\u8D77\u5F0F\uFF1A" + (poem.start || "\u2014")),
            h("span", { className: "dshp-tag" }, "\u9996\u53E5\u5165\u97F5\uFF1A" + firstRhyme)
          ),
          h(
            "div",
            { className: "dshp-kv" },
            h("span", { className: "dshp-kv-key" }, "\u6807\u51C6\u683C\u5F0F"),
            h("span", { className: "dshp-kv-val" }, poem.meter || "\u2014")
          ),
          h(
            "div",
            { className: "dshp-analysis-text dshp-block" },
            poem.analysis ? String(poem.analysis) : "\u6682\u65E0\u89E3\u6790\u6587\u672C\u3002"
          ),
          rhymeLines.length ? h(
            "div",
            { className: "dshp-kv" },
            h("span", { className: "dshp-kv-key" }, "\u5165\u97F5\u53E5"),
            h("span", { className: "dshp-kv-val" }, rhymeLines.join("\u3001"))
          ) : null
        );
      }
      function CiBody(props) {
        const ci = props.ci;
        if (!ci) return null;
        const text = selectCiText(ci);
        return h(
          "div",
          { className: "dshp-poem" },
          h("div", { className: "dshp-poem-title" }, text.title || "\u65E0\u9898"),
          text.author ? h("div", { className: "dshp-poem-author" }, text.author) : null,
          h("div", { className: "dshp-ci-lines" }, text.lines.map((line, index2) => h("div", { key: index2 }, line)))
        );
      }
      function PoetryWidget(props) {
        const ctx = props && props.ctx;
        const cacheRef = React.useRef(null);
        const cacheLoadedRef = React.useRef(false);
        if (!cacheLoadedRef.current) {
          cacheLoadedRef.current = true;
          cacheRef.current = readFirstScreenCache();
        }
        const [boot, setBoot] = React.useState(() => {
          const cached = cacheRef.current;
          if (cached && cached.bootstrap) {
            return { status: "ready", data: cached.bootstrap, fromCache: true, stale: true, error: null };
          }
          return { status: "loading", data: null, fromCache: false, stale: false, error: null };
        });
        const [reloadTick, setReloadTick] = React.useState(0);
        const [settings, setSettings] = React.useState(() => normalizeSettings(cacheRef.current && cacheRef.current.settings));
        const settingsRef = React.useRef(settings);
        settingsRef.current = settings;
        const [step, setStep] = React.useState(-1);
        const [panelOpen, setPanelOpen] = React.useState(false);
        const [panelTab, setPanelTab] = React.useState("growth");
        const [poetryTab, setPoetryTab] = React.useState("today");
        const [selectedPoemId, setSelectedPoemId] = React.useState(null);
        const [toast, setToast] = React.useState(null);
        const [feihuaLaunch, setFeihuaLaunch] = React.useState(0);
        const [weatherRes, setWeatherRes] = React.useState(() => {
          const cached = weatherCache;
          if (cached && cached.data && cached.data.ok) {
            return { status: "ready", data: cached.data, error: null, at: cached.at };
          }
          return { status: "idle", data: null, error: null, at: 0 };
        });
        const [mascotPulse, setMascotPulse] = React.useState(null);
        const [failedMascot, setFailedMascot] = React.useState("");
        const [moodRes, setMoodRes] = React.useState(() => {
          const cached = moodCache;
          return cached && cached.data ? { status: "ready", data: cached.data, at: cached.at } : { status: "idle", data: null, at: 0 };
        });
        const [moodView, setMoodView] = React.useState(null);
        const [spontPoem, setSpontPoem] = React.useState(null);
        const [spontPreview, setSpontPreview] = React.useState(false);
        const [mascotExpression, setMascotExpression] = React.useState("");
        const [moodSource, setMoodSource] = React.useState("");
        const [moodAiFallback, setMoodAiFallback] = React.useState(false);
        const [moodAiStale, setMoodAiStale] = React.useState(false);
        const [moodAiFailure, setMoodAiFailure] = React.useState("");
        const [moodAiFailureCode, setMoodAiFailureCode] = React.useState("");
        const [petMediaRes, setPetMediaRes] = React.useState({ status: "idle", entries: [] });
        const [selfStatus, setSelfStatus] = React.useState(null);
        const [memoryStatus, setMemoryStatus] = React.useState(null);
        const [healthStatus, setHealthStatus] = React.useState(null);
        const [worksRes, setWorksRes] = React.useState({ status: "idle", data: null });
        const [attentionRes, setAttentionRes] = React.useState({ status: "idle", data: null });
        const [projectDetail, setProjectDetail] = React.useState(null);
        const [twinRes, setTwinRes] = React.useState({ status: "idle", data: null });
        const [memoryTick, setMemoryTick] = React.useState(0);
        const [motionFile, setMotionFile] = React.useState("");
        const [dizzy, setDizzy] = React.useState(null);
        const [mealActive, setMealActive] = React.useState(null);
        const [libraryFocus, setLibraryFocus] = React.useState(null);
        const [ciBankWanted, setCiBankWanted] = React.useState(false);
        const [feihuaIndex, setFeihuaIndex] = React.useState(null);
        const [feihuaBuilding, setFeihuaBuilding] = React.useState(false);
        const [moodTick, setMoodTick] = React.useState(0);
        const [spontWake, setSpontWake] = React.useState(0);
        const [pos, setPos] = React.useState(() => {
          const stored = readStoredPosition();
          const viewport2 = { w: readWindowWidth(), h: readWindowHeight() };
          if (stored) return clampPosition(stored, BASE_SIZE, viewport2);
          return { x: 16, y: Math.max(8, viewport2.h - BASE_SIZE - 24) };
        });
        const posRef = React.useRef(pos);
        posRef.current = pos;
        const dragRef = React.useRef(null);
        const pressTimer = React.useRef(null);
        const toastTimer = React.useRef(null);
        const mascotTimerRef = React.useRef(null);
        const weatherInFlightRef = React.useRef(null);
        const userPickedPoemRef = React.useRef(false);
        const moodViewRef = React.useRef(null);
        const selfStatusRef = React.useRef(null);
        const selfTalkNoveltyRef = React.useRef({ signature: "", at: 0 });
        const clicksRef = React.useRef(0);
        const panelOpensRef = React.useRef(0);
        const lastInteractionRef = React.useRef(0);
        const wanderRef = React.useRef({ nextAt: 0, timer: null, walking: false });
        const [walking, setWalking] = React.useState(false);
        const [wanderFile, setWanderFile] = React.useState("");
        const wanderFileRef = React.useRef("");
        wanderFileRef.current = wanderFile;
        const feihuaWinsRef = React.useRef(0);
        const feihuaLossesRef = React.useRef(0);
        const moodStatsRef = React.useRef(emptyMoodStats());
        const moodForceRef = React.useRef(false);
        const moodSourceRef = React.useRef("");
        const moodAiRef = React.useRef({ at: 0, lastRequestAt: 0, image: "" });
        const moodAiSnapshotRef = React.useRef(null);
        const moodAiTokenRef = React.useRef(0);
        const moodAiInFlightRef = React.useRef(false);
        const moodAiPendingRef = React.useRef(false);
        const moodAiDebounceTimerRef = React.useRef(null);
        const moodAiRetryTimerRef = React.useRef(null);
        const moodAiRetryCountRef = React.useRef(0);
        const moodStatsSnapshotRef = React.useRef(null);
        const moodTimeBucketRef = React.useRef("");
        const moodIdleRef = React.useRef(false);
        const moodWeatherSigRef = React.useRef("");
        const moodPrevPanelOpenRef = React.useRef(false);
        const moodPrevPanelTabRef = React.useRef("today");
        const moodPrevSpontRef = React.useRef(null);
        const recentImagesRef = React.useRef([]);
        const moodCatalogRef = React.useRef(null);
        const spontWakeDelayRef = React.useRef(0);
        const prevPanelOpenRef = React.useRef(false);
        const prevStepRef = React.useRef(-1);
        const prevCardRef = React.useRef(null);
        const moodWakeSigRef = React.useRef("");
        const weatherWakeSigRef = React.useRef("");
        const weatherRef = React.useRef(null);
        const spontPoemRef = React.useRef(null);
        const uiRef = React.useRef({});
        const mascotExprTimerRef = React.useRef(null);
        const mascotTapRef = React.useRef(0);
        const mascotVideoRef = React.useRef(null);
        const mascotPulseRef = React.useRef(null);
        const mascotExpressionRef = React.useRef("");
        const petMediaEntriesRef = React.useRef([]);
        const motionFileRef = React.useRef("");
        const motionIndexRef = React.useRef(readMotionRotation());
        const motionDelayTimerRef = React.useRef(null);
        const motionStopTimerRef = React.useRef(null);
        const motionFirstScheduledRef = React.useRef(false);
        const motionFirstPendingRef = React.useRef(false);
        const dizzyRef = React.useRef(null);
        const dizzyTimerRef = React.useRef(null);
        const mealActiveRef = React.useRef(null);
        const mealTimerRef = React.useRef(null);
        const mealPrevPanelRef = React.useRef(false);
        const spontReqRef = React.useRef(0);
        const selfTalkCacheRef = React.useRef({ murmur: [], intro: [] });
        const recentSpokenRef = React.useRef([]);
        const pendingActionRef = React.useRef(null);
        const lastSeenActionIdRef = React.useRef(readSeenActionId());
        spontPoemRef.current = spontPoem;
        mascotPulseRef.current = mascotPulse;
        mascotExpressionRef.current = mascotExpression;
        petMediaEntriesRef.current = petMediaRes.entries;
        motionFileRef.current = motionFile;
        dizzyRef.current = dizzy;
        mealActiveRef.current = mealActive;
        const wakeSpontaneous = React.useCallback((delay) => {
          spontWakeDelayRef.current = Math.max(1e3, num(delay, nextSpontEventDelay()));
          setSpontWake((tick) => tick + 1);
        }, []);
        const showToast = React.useCallback((text, kind) => {
          setToast({ text: String(text == null ? "" : text), kind: kind === "error" ? "error" : "info" });
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => {
            toastTimer.current = null;
            setToast(null);
          }, 2600);
        }, []);
        const showToastRef = React.useRef(null);
        showToastRef.current = showToast;
        React.useEffect(() => () => {
          if (toastTimer.current) {
            clearTimeout(toastTimer.current);
            toastTimer.current = null;
          }
        }, []);
        const saverRef = React.useRef(null);
        if (!saverRef.current) {
          saverRef.current = createSettingsSaver({
            delay: SAVE_DEBOUNCE_MS,
            put: (patch) => putSettings(patch),
            onError: () => {
              if (showToastRef.current) showToastRef.current("\u4FDD\u5B58\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u672C\u5730\u8BBE\u7F6E", "error");
            }
          });
        }
        React.useEffect(() => () => {
          if (saverRef.current) saverRef.current.flush().catch(() => {
          });
          if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
          }
          if (mascotTimerRef.current) {
            clearTimeout(mascotTimerRef.current);
            mascotTimerRef.current = null;
          }
          if (mascotExprTimerRef.current) {
            clearTimeout(mascotExprTimerRef.current);
            mascotExprTimerRef.current = null;
          }
        }, []);
        const updateSettings = React.useCallback((patch, options) => {
          if (!patch || typeof patch !== "object") return settingsRef.current;
          const previous = settingsRef.current;
          const next = normalizeSettings(Object.assign({}, previous, patch));
          settingsRef.current = next;
          setSettings(next);
          if (!(options && options.localOnly) && saverRef.current) {
            const changed = {};
            for (let i = 0; i < WRITE_KEYS.length; i++) {
              const key = WRITE_KEYS[i];
              if (hasOwn(patch, key) && next[key] !== previous[key]) changed[key] = next[key];
            }
            if (Object.keys(changed).length) saverRef.current.save(changed);
          }
          wakeSpontaneous(nextSpontEventDelay());
          if (settingsRef.current.mood) scheduleMoodAiRefresh();
          return next;
        }, []);
        const pulseMascot = React.useCallback((key) => {
          if (!MASCOT_FILES[key]) return;
          if (key === "gameWin") feihuaWinsRef.current += 1;
          if (key === "gameLose") feihuaLossesRef.current += 1;
          if (key === "gameWin" || key === "gameLose") {
            wakeSpontaneous(nextSpontEventDelay());
            scheduleMoodAiRefresh();
          }
          lastInteractionRef.current = Date.now();
          setMascotPulse(key);
          if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current);
          mascotTimerRef.current = setTimeout(() => {
            mascotTimerRef.current = null;
            setMascotPulse(null);
          }, MASCOT_TRANSIENT_MS);
        }, []);
        const refreshWeather = React.useCallback((force) => {
          const current = settingsRef.current;
          if (!(current.weatherPoem || current.mood)) return Promise.resolve(null);
          const cached = weatherCache;
          if (!force && cached && cached.data && cached.data.ok && cached.data.city === current.weatherCity && Date.now() - cached.at < WEATHER_STALE_MS) {
            setWeatherRes({ status: "ready", data: cached.data, error: null, at: cached.at });
            return Promise.resolve(cached.data);
          }
          if (weatherInFlightRef.current) return weatherInFlightRef.current;
          setWeatherRes((previous) => ({ status: "loading", data: previous.data, error: null, at: previous.at }));
          const request = requestWeather().then(
            (data) => {
              weatherInFlightRef.current = null;
              setWeatherRes({ status: "ready", data, error: null, at: Date.now() });
              return data;
            },
            (error) => {
              weatherInFlightRef.current = null;
              setWeatherRes((previous) => ({ status: "error", data: previous.data, error, at: previous.at }));
              return null;
            }
          );
          weatherInFlightRef.current = request;
          return request;
        }, []);
        const applyMood = React.useCallback((force) => {
          const current = settingsRef.current;
          if (!current.mood && !current.spontaneousPoem) {
            moodViewRef.current = null;
            setMoodView(null);
            return null;
          }
          const next = computeMood({
            weather: weatherRef.current,
            signals: {
              now: Date.now(),
              clicks: clicksRef.current,
              feihuaWins: feihuaWinsRef.current,
              feihuaLosses: 0,
              panelOpens: panelOpensRef.current
            }
          });
          const selected = throttleMoodSwitch(moodViewRef.current, next, Date.now(), force === true);
          moodViewRef.current = selected;
          setMoodView(selected);
          return selected;
        }, []);
        const applyModelMood = React.useCallback((mood) => {
          if (!mood || !mood.image) return null;
          const view = Object.assign({}, mood, { changed: true, switchedAt: Date.now() });
          moodSourceRef.current = "model";
          moodViewRef.current = view;
          setMoodSource("model");
          setMoodAiFallback(false);
          setMoodAiStale(false);
          setMoodAiFailure("");
          setMoodAiFailureCode("");
          clearMoodAiRetry();
          setMoodView(view);
          moodAiRef.current = Object.assign({}, moodAiRef.current, { at: Date.now(), image: mood.image });
          const images = recentImagesRef.current.filter((file) => file !== mood.image);
          images.push(mood.image);
          recentImagesRef.current = images.slice(-MOOD_AI_RECENT_IMAGES_MAX);
          return view;
        }, []);
        const fallbackHeuristicMood = React.useCallback((force) => {
          moodSourceRef.current = "heuristic";
          setMoodSource("heuristic");
          setMoodAiFallback(true);
          return applyMood(force === true);
        }, [applyMood]);
        function clearMoodAiRetry() {
          if (moodAiRetryTimerRef.current) {
            clearTimeout(moodAiRetryTimerRef.current);
            moodAiRetryTimerRef.current = null;
          }
          moodAiRetryCountRef.current = 0;
        }
        function scheduleMoodAiRetry() {
          if (!settingsRef.current.mood || settingsRef.current.hidden) return;
          if (moodAiRetryCountRef.current >= MOOD_AI_MAX_RETRIES) return;
          if (moodAiRetryTimerRef.current) clearTimeout(moodAiRetryTimerRef.current);
          moodAiRetryTimerRef.current = setTimeout(() => {
            moodAiRetryTimerRef.current = null;
            if (!settingsRef.current.mood || settingsRef.current.hidden) return;
            if (moodAiInFlightRef.current) {
              moodAiPendingRef.current = true;
              return;
            }
            requestModelMood();
          }, nextMoodAiRetryDelay());
        }
        function handleMoodAiFailure(result) {
          const reason = normalizeMoodAiFailure(result);
          const code = result && typeof result.code === "string" ? result.code : reason.indexOf("host:") === 0 ? reason.slice(5) : "";
          setMoodAiFailure(reason);
          setMoodAiFailureCode(code);
          moodAiRetryCountRef.current += 1;
          const keep = moodAiKeepDecision({ source: moodSourceRef.current, lastSuccessAt: moodAiRef.current.at, now: Date.now() });
          if (keep) {
            setMoodAiStale(true);
            setMoodAiFallback(false);
          } else {
            setMoodAiStale(false);
            fallbackHeuristicMood(true);
          }
          if (moodAiRetryCountRef.current < MOOD_AI_MAX_RETRIES) {
            scheduleMoodAiRetry();
          } else if (moodAiRetryTimerRef.current) {
            clearTimeout(moodAiRetryTimerRef.current);
            moodAiRetryTimerRef.current = null;
          }
        }
        const requestModelMood = React.useCallback((options = {}) => {
          const manual = options && options.manual === true;
          const current = settingsRef.current;
          if (!current.mood) return Promise.resolve({ ok: false, reason: "disabled" });
          const catalog = moodCatalogRef.current;
          if (!catalog) {
            setMoodAiFallback(true);
            return Promise.resolve({ ok: false, reason: "catalog" });
          }
          if (moodAiInFlightRef.current) {
            moodAiPendingRef.current = true;
            return Promise.resolve({ ok: false, reason: "inflight" });
          }
          const now2 = Date.now();
          moodAiRef.current = Object.assign({}, moodAiRef.current, { lastRequestAt: now2 });
          const token = moodAiTokenRef.current + 1;
          moodAiTokenRef.current = token;
          moodAiInFlightRef.current = true;
          const weather2 = weatherRef.current || null;
          const currentMoodKey = moodViewRef.current && moodViewRef.current.key && moodViewRef.current.key !== "ai" ? moodViewRef.current.key : "calm";
          const recent = recentSpokenRef.current.slice(-MOOD_AI_RECENT_MAX);
          const recentImages = recentImagesRef.current.slice(-MOOD_AI_RECENT_IMAGES_MAX);
          moodAiSnapshotRef.current = moodAiSnapshot(weather2, feihuaWinsRef.current, feihuaLossesRef.current);
          const finish = () => {
            if (token !== moodAiTokenRef.current) return;
            moodAiInFlightRef.current = false;
            if (moodAiPendingRef.current && settingsRef.current.mood) {
              moodAiPendingRef.current = false;
              scheduleMoodAiRefresh();
            }
          };
          return requestMoodAi({
            force: true,
            manual,
            moodKey: currentMoodKey,
            weather: weather2 ? String(weather2.category || weather2.label || "") : "",
            recent,
            recentImages,
            catalog
          }).then((result) => {
            finish();
            if (token !== moodAiTokenRef.current) return result;
            if (!settingsRef.current.mood) return result;
            if (result && result.ok && result.mood) {
              applyModelMood(result.mood);
              return result;
            }
            handleMoodAiFailure(result);
            return result;
          }).catch(() => {
            finish();
            if (token === moodAiTokenRef.current && settingsRef.current.mood) handleMoodAiFailure({ reason: "network" });
            return { ok: false };
          });
        }, [applyModelMood, fallbackHeuristicMood]);
        const moodManualRef = React.useRef(false);
        function scheduleMoodAiRefresh(options) {
          const opts = options && typeof options === "object" ? options : {};
          if (!settingsRef.current.mood || settingsRef.current.hidden) return;
          if (moodAiRetryTimerRef.current) {
            clearTimeout(moodAiRetryTimerRef.current);
            moodAiRetryTimerRef.current = null;
          }
          if (moodAiDebounceTimerRef.current) clearTimeout(moodAiDebounceTimerRef.current);
          const delay = opts.immediate === true ? 0 : moodAiEventDelay({ lastRequestAt: moodAiRef.current.lastRequestAt, now: Date.now() });
          moodAiDebounceTimerRef.current = setTimeout(() => {
            moodAiDebounceTimerRef.current = null;
            if (!settingsRef.current.mood || settingsRef.current.hidden) return;
            if (moodAiInFlightRef.current) {
              moodAiPendingRef.current = true;
              return;
            }
            const manual = moodManualRef.current;
            moodManualRef.current = false;
            requestModelMood({ manual });
          }, Math.max(0, delay));
        }
        const refreshMoodNow = React.useCallback(() => {
          moodForceRef.current = true;
          moodManualRef.current = true;
          scheduleMoodAiRefresh({ immediate: true });
          setMoodTick((tick) => tick + 1);
          return Promise.resolve({ ok: true });
        }, [scheduleMoodAiRefresh]);
        function showMascotExpression(file) {
          if (!file) return;
          setMascotExpression(file);
          if (mascotExprTimerRef.current) clearTimeout(mascotExprTimerRef.current);
          mascotExprTimerRef.current = setTimeout(() => {
            mascotExprTimerRef.current = null;
            setMascotExpression("");
          }, MASCOT_EXPRESSION_MS);
        }
        React.useEffect(() => {
          const timer2 = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            const ui = uiRef.current;
            if (ui.panelOpen || ui.step >= 0 || ui.settings.hidden) return;
            if (mascotExprTimerRef.current) return;
            const now2 = Date.now();
            const state = readMascotEggState(now2);
            if (!canShowIdlePose(state, now2, lastInteractionRef.current)) return;
            writeMascotEggState(recordMascotEgg(state, { idle: true }, now2));
            showMascotExpression(pickMascotExpression());
          }, MASCOT_IDLE_POLL_MS);
          return () => clearInterval(timer2);
        }, []);
        React.useEffect(() => {
          if (!WINDOW_WANDER_ENABLED) return void 0;
          if (settings.hidden) return void 0;
          if (!wanderRef.current.nextAt) {
            wanderRef.current.nextAt = Date.now() + WANDER_FIRST_MIN_MS + Math.random() * (WANDER_FIRST_MAX_MS - WANDER_FIRST_MIN_MS);
          }
          const timer2 = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            const ui = uiRef.current;
            if (ui.panelOpen || settingsRef.current.hidden) return;
            if (dragRef.current) return;
            const now2 = Date.now();
            if (now2 - lastInteractionRef.current < WANDER_INTERACTION_PAUSE_MS) return;
            if (now2 < wanderRef.current.nextAt) return;
            const size = Math.max(40, Math.round(BASE_SIZE * settingsRef.current.scale));
            const target = nextWanderTarget({
              viewport: { w: readWindowWidth(), h: readWindowHeight() },
              size,
              current: posRef.current
            });
            wanderRef.current.nextAt = now2 + WANDER_MIN_INTERVAL_MS + Math.random() * (WANDER_MAX_INTERVAL_MS - WANDER_MIN_INTERVAL_MS);
            const picked = pickWanderMedia(petMediaEntriesRef.current || [], Math.random);
            setWanderFile(picked.file);
            setWalking(true);
            wanderRef.current.walking = true;
            setPos(target);
            if (wanderRef.current.timer) clearTimeout(wanderRef.current.timer);
            wanderRef.current.timer = setTimeout(() => {
              wanderRef.current.timer = null;
              wanderRef.current.walking = false;
              setWalking(false);
              setWanderFile("");
            }, WANDER_WALK_MS);
          }, WANDER_TICK_MS);
          return () => {
            clearInterval(timer2);
            if (wanderRef.current.timer) clearTimeout(wanderRef.current.timer);
            wanderRef.current.timer = null;
          };
        }, [settings.hidden]);
        const viewport = useViewportSize();
        const mascotSize = Math.max(40, Math.round(BASE_SIZE * settings.scale));
        React.useEffect(() => {
          let alive = true;
          fetchJson("bootstrap.json").then(
            (data) => {
              if (!alive) return;
              const cached = cacheRef.current;
              if (cached && cached.dataVersion && data.dataVersion && cached.dataVersion !== data.dataVersion) {
                clearFirstScreenCache();
                clearResourceCache();
                cacheRef.current = null;
              }
              const normalized = normalizeSettings(data.settings);
              settingsRef.current = normalized;
              setSettings(normalized);
              setAssetDataVersion(data.dataVersion);
              setBoot({ status: "ready", data, fromCache: false, stale: false, error: null });
            },
            (error) => {
              if (!alive) return;
              const cached = cacheRef.current;
              if (cached && cached.bootstrap) {
                setBoot({ status: "ready", data: cached.bootstrap, fromCache: true, stale: true, error });
              } else {
                setBoot({ status: "error", data: null, fromCache: false, stale: false, error });
              }
            }
          );
          return () => {
            alive = false;
          };
        }, [reloadTick]);
        React.useEffect(() => {
          if (!boot.data) return;
          setSelectedPoemId((previous) => {
            if (previous) return previous;
            const initial = normalizeSettings(boot.data.settings);
            if (initial.mode === "random" && initial.lastPoemId) return initial.lastPoemId;
            return boot.data.today && boot.data.today.poemId ? boot.data.today.poemId : null;
          });
        }, [boot.data]);
        React.useEffect(() => {
          if (!(settings.weatherPoem || settings.mood)) return void 0;
          refreshWeather(false);
          const timer2 = setInterval(() => refreshWeather(true), WEATHER_REFRESH_MS);
          return () => clearInterval(timer2);
        }, [settings.weatherPoem, settings.mood, settings.weatherCity, refreshWeather]);
        React.useEffect(() => {
          if (!(settings.mood || settings.spontaneousPoem)) return void 0;
          const timer2 = setInterval(() => setMoodTick((tick) => tick + 1), MOOD_TICK_MS);
          return () => clearInterval(timer2);
        }, [settings.mood, settings.spontaneousPoem]);
        const [poemsRes, reloadPoems] = useResource("poems", Boolean(boot.data));
        const poetryOn = panelOpen && panelTab === "poetry";
        const classActive = step === 2 || step === 4 || poetryOn && (poetryTab === "class" || poetryTab === "ci");
        const yunActive = step === 3 || poetryOn && poetryTab === "yun";
        const weatherNeedsCi = settings.weatherPoem && !resourceCache.ci && weatherRes.data && weatherRes.data.ok && weatherRes.data.weather && buildWeatherPoemPool(poemsRes.data, null, weatherPoemTags(weatherRes.data.weather), WEATHER_POOL_LIMIT).length < WEATHER_POOL_LIMIT;
        const ciActive = step === 4 || step === 5 || weatherNeedsCi || poetryOn && (poetryTab === "ci" || poetryTab === "feihua" || poetryTab === "library");
        const [knowledgeRes, reloadKnowledge] = useResource("knowledge", classActive);
        const [yunRes, reloadYun] = useResource("yun", yunActive);
        const [ciRes, reloadCi] = useResource("ci", ciActive);
        const libraryActive = poetryOn && poetryTab === "library";
        const feihuaOpen = poetryOn && poetryTab === "feihua" || step === 5;
        const ciTabActive = poetryOn && poetryTab === "ci";
        const extraPoolActive = libraryActive || feihuaOpen;
        const [anthologyRes, reloadAnthology] = useResource("anthology", extraPoolActive);
        const [bankRes, reloadBank] = useResource("bank", extraPoolActive);
        const [pingshuiRes, reloadPingshui] = useResource("pingshui", libraryActive);
        const [moodCatalogRes, reloadMoodCatalog] = useResource("moodCatalog", settings.mood);
        const [ciBankRes, reloadCiBank] = useResource("ciBank", ciBankWanted || feihuaOpen);
        const poemItems = poemsRes.data && Array.isArray(poemsRes.data.items) ? poemsRes.data.items : [];
        const bootstrapTodayPoemId = boot.data && boot.data.today ? boot.data.today.poemId : null;
        const cache = cacheRef.current;
        const cachedPoem = cache && cache.todayPoem ? cache.todayPoem : null;
        const weatherData = weatherRes.data && weatherRes.data.ok ? weatherRes.data : null;
        const weather = weatherData && weatherData.weather ? weatherData.weather : null;
        const weatherTags = React.useMemo(() => weatherPoemTags(weather), [weather]);
        const weatherPool = React.useMemo(
          () => buildWeatherPoemPool(poemsRes.data, ciRes.data, weatherTags, WEATHER_POOL_LIMIT, { anthology: anthologyRes.data, bank: bankRes.data, ciBank: ciBankRes.data }),
          [poemsRes.data, ciRes.data, weatherTags, anthologyRes.data, bankRes.data, ciBankRes.data]
        );
        const weatherEntry = React.useMemo(() => {
          if (!settings.weatherPoem || !weather) return null;
          return selectWeatherPoemEntry(weatherPool, {
            date: boot.data && boot.data.today ? boot.data.today.date : "",
            category: weather.category,
            dataVersion: boot.data ? boot.data.dataVersion : ""
          });
        }, [settings.weatherPoem, weather, weatherPool, boot.data]);
        const weatherActive = Boolean(weatherEntry);
        const activeTodayPoemId = weatherActive ? weatherEntry.id : bootstrapTodayPoemId;
        const weatherChip = weatherActive && weatherData ? weatherChipText(weatherData.city, weather) : "";
        const weatherNote = weatherActive ? weatherExplainText(weather) : "";
        weatherRef.current = weather;
        selfStatusRef.current = selfStatus;
        const moodCatalogBase = React.useMemo(() => normalizeMoodCatalog(moodCatalogRes.data), [moodCatalogRes.data]);
        const moodCatalog = React.useMemo(() => mergePetMediaIntoCatalog(moodCatalogBase, petMediaRes.entries), [moodCatalogBase, petMediaRes.entries]);
        moodCatalogRef.current = moodCatalog;
        const moodChip = settings.mood && moodView ? "\u5FC3\u60C5\uFF1A" + moodView.label : "";
        const moodChipTitle = settings.mood && moodView ? String(moodView.reason || "") : "";
        const moodBasis = moodBasisText(weather);
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
          moodRes
        };
        const poem = React.useMemo(() => {
          if (weatherActive && weatherEntry && (!selectedPoemId || selectedPoemId === weatherEntry.id)) return weatherEntry.item || null;
          const weatherPick = weatherActive && selectedPoemId ? weatherPool.find((entry) => entry.id === selectedPoemId) : null;
          if (weatherPick) return weatherPick.item || null;
          const findById = (id2) => poemItems.find((item) => item && item.id === id2);
          if (!boot.data) return null;
          if (poemItems.length) return findById(selectedPoemId) || findById(activeTodayPoemId) || poemItems[0] || null;
          if (cachedPoem && (!selectedPoemId || cachedPoem.id === selectedPoemId || cachedPoem.id === activeTodayPoemId)) return cachedPoem;
          return null;
        }, [poemItems, selectedPoemId, activeTodayPoemId, cachedPoem, boot.data, weatherActive, weatherEntry, weatherPool]);
        const todayPoem = React.useMemo(() => {
          if (weatherActive && weatherEntry && weatherEntry.id === activeTodayPoemId) return weatherEntry.item || null;
          if (poem && poem.id === activeTodayPoemId) return poem;
          if (cachedPoem && cachedPoem.id === activeTodayPoemId) return cachedPoem;
          return poemItems.find((item) => item && item.id === activeTodayPoemId) || null;
        }, [poem, cachedPoem, activeTodayPoemId, poemItems]);
        React.useEffect(() => {
          if (!boot.data) return;
          const record = {
            dataVersion: boot.data.dataVersion || "",
            bootstrap: boot.data,
            settings: settingsRef.current,
            todayPoem: todayPoem || null
          };
          cacheRef.current = record;
          writeFirstScreenCache(record);
        }, [boot.data, settings, todayPoem]);
        React.useEffect(() => {
          userPickedPoemRef.current = false;
        }, [weatherChip]);
        React.useEffect(() => {
          if (!weatherActive || userPickedPoemRef.current) return;
          setSelectedPoemId(activeTodayPoemId);
        }, [weatherActive, activeTodayPoemId]);
        React.useEffect(() => {
          try {
            if (typeof window === "undefined" || typeof window.Image !== "function") return;
            for (const file of [MASCOT_FILES.celebrate, MASCOT_FILES.idle, MASCOT_FILES.night]) {
              const image = new window.Image();
              image.src = mascotUrl(file);
            }
          } catch (error) {
          }
        }, []);
        React.useEffect(() => {
          if (!settingsRef.current.mood && !settingsRef.current.spontaneousPoem) {
            moodAiTokenRef.current += 1;
            moodAiInFlightRef.current = false;
            moodAiPendingRef.current = false;
            if (moodAiDebounceTimerRef.current) {
              clearTimeout(moodAiDebounceTimerRef.current);
              moodAiDebounceTimerRef.current = null;
            }
            moodSourceRef.current = "";
            moodViewRef.current = null;
            clearMoodAiRetry();
            setMoodSource("");
            setMoodAiFallback(false);
            setMoodAiStale(false);
            setMoodAiFailure("");
            setMoodAiFailureCode("");
            setMoodView(null);
            return;
          }
          if (moodSourceRef.current === "model") return;
          moodSourceRef.current = "heuristic";
          setMoodSource("heuristic");
          const force = moodForceRef.current;
          moodForceRef.current = false;
          applyMood(force);
        }, [moodRes, weather, settings.mood, settings.spontaneousPoem, moodTick, applyMood]);
        React.useEffect(() => () => {
          if (moodAiRetryTimerRef.current) {
            clearTimeout(moodAiRetryTimerRef.current);
            moodAiRetryTimerRef.current = null;
          }
        }, []);
        React.useEffect(() => {
          if (!settings.mood) {
            setPetMediaRes({ status: "idle", entries: [] });
            return void 0;
          }
          let alive = true;
          setPetMediaRes({ status: "loading", entries: [] });
          requestPetMediaCatalog().then((result) => {
            if (!alive) return;
            setPetMediaRes({ status: result && result.ok ? "ready" : "error", entries: result && result.ok ? result.entries : [] });
          });
          return () => {
            alive = false;
          };
        }, [settings.mood, boot.data && boot.data.dataVersion]);
        React.useEffect(() => {
          if (!settings.mood || !moodCatalog) return;
          if (petMediaRes.status === "loading" || petMediaRes.status === "idle") return;
          if (moodAiRef.current.at > 0) return;
          scheduleMoodAiRefresh();
        }, [settings.mood, moodCatalog, petMediaRes.status]);
        React.useEffect(() => {
          if (!settings.mood) return void 0;
          const timer2 = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            scheduleMoodAiRefresh();
          }, MOOD_REFRESH_MS);
          return () => clearInterval(timer2);
        }, [settings.mood, scheduleMoodAiRefresh]);
        React.useEffect(() => {
          if (!settings.mood) return;
          const currentTab = panelTab === "poetry" ? "poetry:" + poetryTab : panelTab;
          const changed = moodPrevPanelOpenRef.current !== panelOpen || panelOpen && moodPrevPanelTabRef.current !== currentTab;
          moodPrevPanelOpenRef.current = panelOpen;
          moodPrevPanelTabRef.current = currentTab;
          if (changed) scheduleMoodAiRefresh();
        }, [panelOpen, panelTab, poetryTab, settings.mood]);
        React.useEffect(() => {
          if (!settings.mood) return;
          const visible = Boolean(spontPoem);
          const previous = Boolean(moodPrevSpontRef.current);
          moodPrevSpontRef.current = visible;
          if (visible !== previous) scheduleMoodAiRefresh();
        }, [spontPoem, settings.mood]);
        React.useEffect(() => {
          if (!settings.mood) return;
          const signature = weather ? [weather.category, weather.label, weather.tempC, weather.isDay].join("|") : "";
          const previous = moodWeatherSigRef.current;
          moodWeatherSigRef.current = signature;
          if (previous && signature && previous !== signature) scheduleMoodAiRefresh();
        }, [weather, settings.mood]);
        React.useEffect(() => {
          if (!settings.mood) return void 0;
          const onVisible = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            scheduleMoodAiRefresh();
          };
          const onFocus = () => scheduleMoodAiRefresh();
          if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
          if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("focus", onFocus);
          return () => {
            if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
            if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("focus", onFocus);
          };
        }, [settings.mood]);
        React.useEffect(() => {
          if (!settings.mood) return;
          const now2 = Date.now();
          const last = lastInteractionRef.current;
          const idle = last > 0 && now2 - last >= 30 * 60 * 1e3;
          if (idle !== moodIdleRef.current) {
            moodIdleRef.current = idle;
            scheduleMoodAiRefresh();
          }
          const bucket = moodTimeBucket(now2);
          if (moodTimeBucketRef.current && bucket !== moodTimeBucketRef.current) scheduleMoodAiRefresh();
          moodTimeBucketRef.current = bucket;
        }, [moodTick, settings.mood]);
        React.useEffect(() => {
          if (settings.mood && moodCatalogRes.status === "error") setMoodAiFallback(true);
        }, [settings.mood, moodCatalogRes.status]);
        React.useEffect(() => {
          if (!moodCatalog) return;
          if (typeof window === "undefined" || typeof window.Image !== "function") return;
          const files = [
            panelPeekFile(moodCatalog, "today"),
            panelPeekFile(moodCatalog, "settings"),
            panelPeekFile(moodCatalog, "other")
          ].concat(moodCatalog.moodFiles.slice(0, 4));
          for (const file of files) {
            if (!file) continue;
            try {
              const image = new window.Image();
              image.src = mascotUrl(file);
            } catch (error) {
            }
          }
        }, [moodCatalog]);
        React.useEffect(() => {
          if (settings.hidden) {
            spontReqRef.current += 1;
            setSpontPoem(null);
            return void 0;
          }
          if (!settings.spontaneousPoem) {
            spontReqRef.current += 1;
            setSpontPoem((current) => current && current.tag === "action" ? current : null);
            return void 0;
          }
          let cancelled = false;
          let timer2 = null;
          const schedule2 = (delay) => {
            if (timer2) clearTimeout(timer2);
            if (!cancelled) timer2 = setTimeout(run, Math.max(1e3, delay));
          };
          const run = () => {
            if (cancelled) return;
            const ui = uiRef.current;
            if (spontPoemRef.current) {
              schedule2(SPONT_CLOSE_RECHECK_MS);
              return;
            }
            const ok = canShowSpontaneous({
              enabled: ui.settings.spontaneousPoem === true,
              hidden: ui.settings.hidden === true,
              panelOpen: ui.panelOpen === true,
              bubbleOpen: ui.step >= 0,
              visible: typeof document === "undefined" ? true : document.visibilityState !== "hidden",
              now: Date.now(),
              lastInteractionAt: lastInteractionRef.current,
              quietMs: SPONT_QUIET_MS
            });
            if (ok) {
              startSpontaneousCard({ record: true });
              schedule2(nextSpontPollDelay());
            } else {
              schedule2(SPONT_RETRY_MS);
            }
          };
          const onWake = () => wakeSpontaneous(nextSpontEventDelay());
          const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "visible") onWake();
          };
          const onFocus = () => onWake();
          if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
          if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("focus", onFocus);
          const initialDelay = spontWake > 0 ? num(spontWakeDelayRef.current, nextSpontEventDelay()) : nextSpontPollDelay();
          schedule2(initialDelay);
          return () => {
            cancelled = true;
            if (timer2) clearTimeout(timer2);
            if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
            if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("focus", onFocus);
          };
        }, [settings.spontaneousPoem, settings.hidden, spontWake, wakeSpontaneous]);
        React.useEffect(() => {
          if (panelOpen) {
            prevPanelOpenRef.current = true;
            return;
          }
          if (prevPanelOpenRef.current) {
            prevPanelOpenRef.current = false;
            wakeSpontaneous(nextSpontEventDelay());
          }
        }, [panelOpen, wakeSpontaneous]);
        React.useEffect(() => {
          if (step >= 0) {
            prevStepRef.current = true;
            return;
          }
          if (prevStepRef.current) {
            prevStepRef.current = false;
            wakeSpontaneous(nextSpontEventDelay());
          }
        }, [step, wakeSpontaneous]);
        React.useEffect(() => {
          if (!settings.spontaneousPoem) return;
          if (spontPoem) {
            prevCardRef.current = true;
            return;
          }
          if (prevCardRef.current) {
            prevCardRef.current = false;
            wakeSpontaneous(SPONT_CLOSE_RECHECK_MS);
          }
        }, [spontPoem, settings.spontaneousPoem, wakeSpontaneous]);
        React.useEffect(() => {
          if (!settings.spontaneousPoem || !moodView) return;
          const signature = [moodView.key, moodView.label, moodView.reason, moodView.source].join("|");
          if (moodWakeSigRef.current && moodWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay());
          moodWakeSigRef.current = signature;
        }, [moodView, settings.spontaneousPoem, wakeSpontaneous]);
        React.useEffect(() => {
          if (!settings.spontaneousPoem || !weather) return;
          const signature = [weather.category, weather.label, weather.tempC].join("|");
          if (weatherWakeSigRef.current && weatherWakeSigRef.current !== signature) wakeSpontaneous(nextSpontEventDelay());
          weatherWakeSigRef.current = signature;
        }, [weather, settings.spontaneousPoem, wakeSpontaneous]);
        React.useEffect(() => {
          if (typeof document === "undefined" || typeof document.addEventListener !== "function") return void 0;
          const markActivity = () => noteInteraction();
          document.addEventListener("pointerdown", markActivity, true);
          document.addEventListener("keydown", markActivity, true);
          document.addEventListener("input", markActivity, true);
          return () => {
            document.removeEventListener("pointerdown", markActivity, true);
            document.removeEventListener("keydown", markActivity, true);
            document.removeEventListener("input", markActivity, true);
          };
        }, []);
        React.useEffect(() => {
          if (!spontPoem) return void 0;
          const timer2 = setTimeout(() => {
            spontReqRef.current += 1;
            setSpontPoem(null);
          }, SPONT_AUTO_CLOSE_MS);
          return () => clearTimeout(timer2);
        }, [spontPoem]);
        React.useEffect(() => {
          if (spontPoem && !spontPreview && (panelOpen || step >= 0 || settings.hidden)) {
            spontReqRef.current += 1;
            setSpontPoem(null);
          }
        }, [panelOpen, step, settings.hidden, spontPoem, spontPreview]);
        React.useEffect(() => {
          if (!feihuaOpen) {
            setFeihuaBuilding(false);
            setFeihuaIndex(null);
            return void 0;
          }
          const base = getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data);
          setFeihuaIndex(base);
          const ciBankItemsData = ciBankRes.data && Array.isArray(ciBankRes.data.items) ? ciBankRes.data.items : [];
          if (!ciBankItemsData.length) {
            setFeihuaBuilding(ciBankRes.status === "loading");
            return void 0;
          }
          let cancelled = false;
          let timer2 = null;
          const working = buildFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data);
          let offset = 0;
          const CHUNK = 500;
          setFeihuaBuilding(true);
          const run = () => {
            if (cancelled) return;
            mergeFeihuaItems(working, ciBankItemsData.slice(offset, offset + CHUNK));
            offset += CHUNK;
            if (offset < ciBankItemsData.length) {
              timer2 = setTimeout(run, 0);
            } else {
              finishFeihuaIndex(working);
              setFeihuaIndex(working);
              setFeihuaBuilding(false);
            }
          };
          timer2 = setTimeout(run, 0);
          return () => {
            cancelled = true;
            if (timer2) clearTimeout(timer2);
          };
        }, [feihuaOpen, poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data, ciBankRes.data, ciBankRes.status]);
        React.useEffect(() => {
          setPos((previous) => {
            const next = anchorPosition(settings.snap, mascotSize, viewport, previous);
            return next.x === previous.x && next.y === previous.y ? previous : next;
          });
        }, [settings.snap, mascotSize, viewport.w, viewport.h]);
        React.useEffect(() => {
          const timer2 = setTimeout(() => {
            writeStoredPosition({ x: pos.x, y: pos.y, snap: settingsRef.current.snap });
          }, 250);
          return () => clearTimeout(timer2);
        }, [pos, settings.snap]);
        React.useEffect(() => {
          const seconds = num(settings.autoplay, 0);
          if (!seconds || step < 0 || panelOpen || settings.hidden) return void 0;
          const timer2 = setTimeout(() => {
            setStep((current) => current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1);
          }, seconds * 1e3);
          return () => clearTimeout(timer2);
        }, [settings.autoplay, step, panelOpen, settings.hidden]);
        React.useEffect(() => {
          if (!panelOpen && step < 0) return void 0;
          const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            if (panelOpen) setPanelOpen(false);
            else setStep(-1);
          };
          document.addEventListener("keydown", onKeyDown);
          return () => document.removeEventListener("keydown", onKeyDown);
        }, [panelOpen, step]);
        React.useEffect(() => {
          if (!settings.hidden) return void 0;
          const onDoubleClick = (event) => {
            const target = event.target;
            if (target && typeof target.closest === "function" && target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"],[data-composer-input],[data-composer-seat],[data-composer-card]')) {
              return;
            }
            restoreWidget();
          };
          document.addEventListener("dblclick", onDoubleClick, true);
          return () => document.removeEventListener("dblclick", onDoubleClick, true);
        }, [settings.hidden]);
        function hideWidget() {
          setPanelOpen(false);
          setStep(-1);
          updateSettings({ hidden: true });
        }
        function restoreWidget() {
          updateSettings({ hidden: false });
        }
        function noteInteraction() {
          lastInteractionRef.current = Date.now();
        }
        function openPanelTab(tabId) {
          if (POETRY_TABS.some((item) => item.id === tabId)) {
            setPanelTab("poetry");
            setPoetryTab(tabId);
            return;
          }
          if (tabId === "poetry") {
            setPanelTab("poetry");
            return;
          }
          if (tabId === "settings") {
            setPanelTab("settings");
            return;
          }
          if (tabId === "graph") {
            setPanelTab("graph");
            return;
          }
          setPanelTab("growth");
        }
        function openPoetryModule() {
          if (!POETRY_ENTRY_ENABLED) return;
          openPanelTab("poetry");
          setPanelOpen(true);
        }
        function openSettingsPanel() {
          openPanelTab("settings");
          setPanelOpen(true);
        }
        function openPanel(tab) {
          noteInteraction();
          panelOpensRef.current += 1;
          if (tab === "settings" || tab === "growth" || tab === "poetry" || POETRY_TABS.some((item) => item.id === tab)) {
            openPanelTab(tab);
          } else {
            openPanelTab("growth");
          }
          setPanelOpen(true);
        }
        function advanceStep() {
          setStep((current) => current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1);
          wakeSpontaneous(nextSpontEventDelay());
        }
        function handleMascotTap() {
          if (settingsRef.current.hidden) return;
          const now2 = Date.now();
          clicksRef.current += 1;
          noteInteraction();
          const eggState = readMascotEggState(now2);
          if (shouldShowDailyGreet(eggState, now2)) {
            writeMascotEggState(recordMascotEgg(eggState, { greet: true }, now2));
            showMascotExpression(MASCOT_EXPRESSION_FILES[0]);
          }
          if (!settingsRef.current.tutorialSeen) updateSettings({ tutorialSeen: true });
          if (panelOpen) {
            setPanelOpen(false);
            return;
          }
          if (step >= 0) {
            advanceStep();
            return;
          }
          openPanel("growth");
        }
        function startPoetryTour() {
          noteInteraction();
          setPanelOpen(false);
          setStep(0);
          if (typeof document !== "undefined" && document.documentElement) {
            try {
              document.documentElement.scrollTop = document.documentElement.scrollTop;
            } catch {
            }
          }
        }
        function handleMascotKeyDown(event) {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            handleMascotTap();
          }
        }
        function triggerDizzy() {
          if (settingsRef.current.hidden) return;
          const entries = petMediaEntriesRef.current || [];
          const entry = pickDizzyMedia(entries);
          const file = entry && isVideoMoodFile(entry.file) ? entry.file : "";
          if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current);
          setDizzy({ file, label: entry ? String(entry.label || "") : "" });
          clearMotionTimers();
          if (motionFileRef.current) setMotionFile("");
          dizzyTimerRef.current = setTimeout(() => {
            dizzyTimerRef.current = null;
            setDizzy(null);
            if (settingsRef.current.mood && petMediaEntriesRef.current.length && !uiRef.current.panelOpen) {
              scheduleMotion(nextMotionDelay());
            }
          }, nextDizzyDuration());
          noteInteraction();
        }
        function maybeTriggerMeal() {
          if (!settingsRef.current || settingsRef.current.hidden) return;
          if (mealActiveRef.current) return;
          const now2 = Date.now();
          const visible = typeof document === "undefined" ? true : document.visibilityState !== "hidden";
          const state = readMealState(now2);
          const moment = mealTriggerFor({ now: now2, hidden: settingsRef.current.hidden, panelOpen: uiRef.current.panelOpen, visible, state });
          if (!moment) return;
          writeMealState(markMealDone(state, moment.meal, now2));
          const entry = pickMealMedia(petMediaEntriesRef.current || [], moment.meal);
          const file = entry && entry.file ? entry.file : "dsh-whale-state-daily-eat.webp";
          const text = moment.meal === "lunch" ? "\u5230\u996D\u70B9\u5566\uFF0C\u6211\u53BB\u5403\u5348\u996D\uFF0C\u4F60\u4E5F\u8BB0\u5F97\u5403\u3002\u8FD9\u987F\u7528 token \u6362\u7684\u767D\u996D\u3002" : "\u5230\u996D\u70B9\u5566\uFF0C\u6211\u53BB\u5403" + moment.label + "\uFF0C\u4F60\u4E5F\u8BB0\u5F97\u5403\u3002";
          const active = { meal: moment.meal, label: moment.label, file, text };
          mealActiveRef.current = active;
          setMealActive(active);
          clearMotionTimers();
          if (motionFileRef.current) setMotionFile("");
          if (mealTimerRef.current) clearTimeout(mealTimerRef.current);
          mealTimerRef.current = setTimeout(() => {
            mealTimerRef.current = null;
            mealActiveRef.current = null;
            setMealActive(null);
            if (settingsRef.current.mood && petMediaEntriesRef.current.length && !uiRef.current.panelOpen) {
              scheduleMotion(nextMotionDelay());
            }
          }, nextMealDuration());
        }
        function handlePointerDown(event) {
          if (event.button !== void 0 && event.button !== 0) return;
          setWalking(false);
          wanderRef.current.walking = false;
          setWanderFile("");
          if (wanderRef.current.timer) clearTimeout(wanderRef.current.timer);
          wanderRef.current.timer = null;
          wanderRef.current.nextAt = Date.now() + 10 * 60 * 1e3;
          const pointerTime = typeof event.timeStamp === "number" && event.timeStamp > 0 ? event.timeStamp : Date.now();
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
            moved: false
          };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch (error) {
          }
          if (event.cancelable) event.preventDefault();
        }
        function handlePointerMove(event) {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          if (!drag.moved && Math.max(Math.abs(dx), Math.abs(dy)) > 3) drag.moved = true;
          if (!drag.moved) return;
          const pointerTime = typeof event.timeStamp === "number" && event.timeStamp > 0 ? event.timeStamp : Date.now();
          if (detectFastDrag({ x: drag.lastX, y: drag.lastY, t: drag.lastT }, { x: event.clientX, y: event.clientY, t: pointerTime })) drag.fast = true;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          drag.lastT = pointerTime;
          setPos(clampPosition({ x: drag.baseX + dx, y: drag.baseY + dy }, mascotSize, viewport));
        }
        function finishPointer(event, cancelled) {
          const drag = dragRef.current;
          if (!drag || event && drag.id !== event.pointerId) return;
          dragRef.current = null;
          try {
            if (event && event.currentTarget && event.currentTarget.releasePointerCapture) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          } catch (error) {
          }
          if (cancelled) return;
          if (!drag.moved) {
            handleMascotTap();
            return;
          }
          if (drag.fast) triggerDizzy();
          const current = posRef.current;
          let snap = "free";
          if (current.x <= 40) snap = "left";
          else if (current.x + mascotSize >= viewport.w - 40) snap = "right";
          const snapped = anchorPosition(snap, mascotSize, viewport, current);
          if (snapped.x !== current.x || snapped.y !== current.y) setPos(snapped);
          if (snap !== settingsRef.current.snap) updateSettings({ snap });
        }
        function handlePointerUp(event) {
          finishPointer(event, false);
        }
        function handlePointerCancel(event) {
          finishPointer(event, true);
        }
        function handleRestorePointerDown(event) {
          if (event.button !== void 0 && event.button !== 0) return;
          if (event.cancelable) event.preventDefault();
          if (pressTimer.current) clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => {
            pressTimer.current = null;
            restoreWidget();
          }, 1200);
        }
        function handleRestorePointerUp() {
          if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
          }
        }
        function changePoem() {
          noteInteraction();
          if (weatherActive && weatherPool.length) {
            const currentIndex = weatherPool.findIndex((entry) => entry.id === (poem && poem.id));
            const nextEntry = weatherPool[(currentIndex + 1 + weatherPool.length) % weatherPool.length];
            userPickedPoemRef.current = true;
            setSelectedPoemId(nextEntry.id);
            return;
          }
          const items = poemItems;
          if (!items.length) {
            if (poemsRes.status === "error") reloadPoems().catch(() => {
            });
            else showToast(poemsRes.status === "loading" ? "\u8BD7\u5E93\u52A0\u8F7D\u4E2D\uFF0C\u8BF7\u7A0D\u5019" : "\u8BD7\u5E93\u6682\u65F6\u4E0D\u53EF\u7528");
            return;
          }
          const nextId2 = selectNextPoemId({
            items,
            currentId: poem && poem.id,
            todayId: activeTodayPoemId,
            mode: settingsRef.current.mode
          });
          if (!nextId2) {
            showToast("\u6682\u65E0\u53EF\u7528\u7684\u8BD7\u7BC7");
            return;
          }
          userPickedPoemRef.current = true;
          setSelectedPoemId(nextId2);
          if (settingsRef.current.mode === "random" && nextId2 !== activeTodayPoemId) {
            saverRef.current.save({ lastPoemId: nextId2 });
          }
        }
        function backToToday() {
          noteInteraction();
          if (!activeTodayPoemId) {
            showToast("\u4ECA\u65E5\u8BD7\u5C1A\u672A\u5C31\u7EEA");
            return;
          }
          if (poem && poem.id === activeTodayPoemId) return;
          userPickedPoemRef.current = true;
          setSelectedPoemId(activeTodayPoemId);
          if (settingsRef.current.mode === "random") saverRef.current.save({ lastPoemId: activeTodayPoemId });
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
            tutorialSeen: DEFAULT_SETTINGS.tutorialSeen
          });
          showToast("\u5DF2\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E");
        }
        function retryBootstrap() {
          setReloadTick((tick) => tick + 1);
        }
        function openFeihuaGame() {
          openPanelTab("feihua");
          setPanelOpen(true);
          setFeihuaLaunch((token) => token + 1);
          pulseMascot("gameThink");
        }
        function takeCachedSelfTalk(kind) {
          const list = selfTalkCacheRef.current[kind];
          if (Array.isArray(list) && list.length) return list.shift();
          return "";
        }
        function rememberSpoken(card) {
          if (!card || card.type !== "murmur" || !card.text) return;
          const clean = String(card.text).trim();
          if (!clean) return;
          const list = recentSpokenRef.current.filter((value) => value !== clean);
          list.push(clean);
          recentSpokenRef.current = list.slice(-SELF_TALK_RECENT_MAX);
        }
        function spontPools() {
          const ui = uiRef.current;
          return {
            poemsData: { items: ui.poemItems },
            ciData: { items: ui.ciItems },
            anthologyData: { items: ui.anthologyItems },
            bankData: { items: ui.bankItems },
            ciBankData: { items: ui.ciBankItems }
          };
        }
        function murmurCardFromText(text) {
          const value = String(text == null ? "" : text).trim();
          return {
            type: "murmur",
            id: "model-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
            text: value,
            line: value,
            tags: [],
            tag: "model",
            title: "\u5B83\u8BF4\uFF1A"
          };
        }
        function showSpontCard(card, options) {
          if (!card) return null;
          const opts = options || {};
          if (opts.record === true && opts.state) {
            writeSpontState(recordSpontShown(opts.state, card.id, Date.now(), card.type, card.tag || card.kind || ""));
          }
          if (opts.remember !== false) rememberSpoken(card);
          setSpontPreview(opts.preview === true);
          setSpontPoem(card);
          return card;
        }
        function startSpontaneousCard(options) {
          const opts = options && typeof options === "object" ? options : {};
          const ui = uiRef.current;
          const now2 = Date.now();
          const state = readSpontState(now2);
          const moodKey = ui.moodView && ui.moodView.key && ui.moodView.key !== "ai" ? ui.moodView.key : "calm";
          const preview = opts.preview === true;
          const record = opts.record === true;
          if (record && !preview) {
            const signature = selfTalkNoveltySignature({
              selfStatus: selfStatusRef.current,
              mood: moodViewRef.current,
              weather: weatherRef.current,
              now: now2
            });
            const last = selfTalkNoveltyRef.current;
            if (last.signature === signature && now2 - last.at < 20 * 60 * 1e3) return null;
            if (last.signature === "" && last.at > 0 && now2 - last.at < 60 * 1e3) return null;
            selfTalkNoveltyRef.current = { signature, at: now2 };
          }
          const recent = recentSpokenRef.current.slice(-SELF_TALK_RECENT_MAX);
          const showMurmur = (line) => showSpontCard(murmurCardFromText(line), { preview, record, state });
          const cached = takeCachedSelfTalk("murmur");
          if (cached) {
            return showMurmur(cached);
          }
          const token = spontReqRef.current + 1;
          spontReqRef.current = token;
          setSpontPreview(preview);
          setSpontPoem({ type: "thinking", title: "\u5B83\u6B63\u5728\u60F3\u2026", line: "", placeholder: true });
          const idleMinutes = lastInteractionRef.current > 0 ? Math.max(0, Math.floor((now2 - lastInteractionRef.current) / 6e4)) : 0;
          const weatherValue = weatherRef.current ? String(weatherRef.current.category || weatherRef.current.label || "") : "";
          const view = ui.moodView || null;
          const moodLabel = view && typeof view.label === "string" ? view.label.trim() : "";
          const moodReason = view && typeof view.reason === "string" ? view.reason.trim() : "";
          const image = view && typeof view.image === "string" ? view.image.trim() : "";
          const imageLabel = moodLabel;
          requestSelfTalk({ kind: "murmur", moodKey, moodLabel, moodReason, image, imageLabel, weather: weatherValue, idleMinutes, recent }).then((result) => {
            if (token !== spontReqRef.current) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") {
              setSpontPoem((current) => current && current.type === "thinking" ? null : current);
              return;
            }
            if (!result || !result.ok || !result.line) {
              selfTalkNoveltyRef.current = { signature: "", at: Date.now() };
              setSpontPoem(null);
              return;
            }
            if (recent.indexOf(result.line) >= 0) {
              if (result.next && recent.indexOf(result.next) < 0) {
                showMurmur(result.next);
              } else {
                setSpontPoem(null);
              }
              return;
            }
            if (result.next && recent.indexOf(result.next) < 0) {
              const list = selfTalkCacheRef.current.murmur.concat([result.next]);
              selfTalkCacheRef.current.murmur = list.slice(-2);
            }
            showMurmur(result.line);
          }).catch(() => {
            if (token !== spontReqRef.current) return;
            selfTalkNoveltyRef.current = { signature: "", at: Date.now() };
            setSpontPoem(null);
          });
          return null;
        }
        function previewSpontaneousPoem() {
          return startSpontaneousCard({ preview: true, record: false });
        }
        function readAnotherSpontaneous() {
          return startSpontaneousCard({ preview: false, record: false });
        }
        function previewSpontaneousPoem(forceType) {
          return startSpontaneousCard({ forceType, preview: true, record: false });
        }
        function readAnotherSpontaneous() {
          const current = spontPoemRef.current;
          const avoidType = current && current.type !== "thinking" ? current.type : "";
          return startSpontaneousCard({ avoidType, preview: false, record: false });
        }
        function requestCiBank() {
          setCiBankWanted(true);
        }
        function consumeLibraryFocus() {
          setLibraryFocus(null);
        }
        function openCiSelectedForRhythmic(rhythmic) {
          setLibraryFocus({ type: "ci-selected", rhythmic: String(rhythmic || ""), token: Date.now() });
          openPanelTab("library");
          setPanelOpen(true);
          noteInteraction();
        }
        function openCiBankForRhythmic(rhythmic) {
          setCiBankWanted(true);
          setLibraryFocus({ type: "ci", rhythmic: String(rhythmic || ""), token: Date.now() });
          openPanelTab("library");
          setPanelOpen(true);
          noteInteraction();
        }
        function openSpontPoem() {
          const picked = spontPoemRef.current;
          if (!picked) return;
          if (picked.type === "murmur") {
            setSpontPoem(null);
            return;
          }
          setSpontPreview(false);
          setSpontPoem(null);
          setPanelOpen(true);
          if (picked.kind === "poem") {
            userPickedPoemRef.current = true;
            setSelectedPoemId(picked.id);
            openPanelTab("today");
          } else if (picked.kind === "ci") {
            openPanelTab("ci");
          } else {
            setLibraryFocus({ id: picked.id, source: picked.kind, token: Date.now() });
            openPanelTab("library");
          }
        }
        function consumeFeihuaLaunch() {
          setFeihuaLaunch(0);
        }
        const dateSeed = boot.data && boot.data.today && boot.data.today.date || "";
        const dateLabel = formatDateLabel(dateSeed);
        function renderPoemFallback() {
          if (boot.status === "error") {
            return h(EmptyState, {
              title: "\u8BD7\u8BCD\u6570\u636E\u5C1A\u672A\u5C31\u7EEA",
              message: describeDataError(boot.error),
              onRetry: retryBootstrap
            });
          }
          if (poemsRes.status === "error") {
            return h(EmptyState, {
              title: "\u4ECA\u65E5\u4E00\u8BD7\u6682\u65F6\u4E0D\u53EF\u7528",
              message: describeDataError(poemsRes.error),
              onRetry: () => reloadPoems().catch(() => {
              })
            });
          }
          return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u4ECA\u65E5\u4E00\u8BD7\u2026" });
        }
        function renderPoemStep() {
          if (poem) {
            return h(
              "div",
              null,
              weatherChip || moodChip ? h(
                "div",
                { className: "dshp-weather" },
                h(
                  "div",
                  { className: "dshp-chip-row" },
                  weatherChip ? h("span", { className: "dshp-weather-chip" }, weatherChip) : null,
                  moodChip ? h("span", { className: "dshp-weather-chip dshp-mood-chip", title: moodChipTitle }, moodChip) : null
                ),
                weatherNote ? h("div", { className: "dshp-weather-note" }, weatherNote) : null
              ) : null,
              h("div", { className: "dshp-muted", style: { fontSize: "11.5px", textAlign: "center", marginBottom: "2px" } }, "\u4ECA\u65E5\u4E00\u8BD7 \xB7 " + dateLabel),
              h(PoemBody, { poem, script: settings.script, showTones: settings.showTones })
            );
          }
          return renderPoemFallback();
        }
        function renderAnalysisStep() {
          if (!poem) return renderPoemFallback();
          return h(
            "div",
            null,
            h("div", { className: "dshp-muted", style: { fontSize: "11.5px", textAlign: "center", marginBottom: "4px" } }, (poem.title || "\u8FD9\u9996\u8BD7") + " \xB7 \u683C\u5F8B\u89E3\u6790"),
            h(AnalysisBody, { poem })
          );
        }
        function renderKnowledgeStep() {
          const resource = knowledgeRes;
          if (resource.status === "error") {
            return h(EmptyState, {
              title: "\u683C\u5F8B\u77E5\u8BC6\u5361\u6682\u65F6\u4E0D\u53EF\u7528",
              message: describeDataError(resource.error),
              onRetry: () => reloadKnowledge().catch(() => {
              })
            });
          }
          const cards = resource.data && Array.isArray(resource.data.cards) ? resource.data.cards : [];
          if (!cards.length) {
            if (resource.status === "ready") {
              return h(EmptyState, {
                title: "\u77E5\u8BC6\u5361\u5C1A\u672A\u5C31\u7EEA",
                message: "\u6570\u636E\u6587\u4EF6\u4E2D\u8FD8\u6CA1\u6709\u8BFE\u5802\u5185\u5BB9\uFF0C\u7A0D\u540E\u518D\u6765\u770B\u770B\u3002",
                onRetry: () => reloadKnowledge().catch(() => {
                })
              });
            }
            return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u683C\u5F8B\u77E5\u8BC6\u5361\u2026" });
          }
          const index2 = Math.abs(hashString(dateSeed + "|knowledge")) % cards.length;
          return h(
            "div",
            null,
            h("div", { className: "dshp-card-summary", style: { marginBottom: "6px" } }, "\u4ECA\u65E5\u77E5\u8BC6\u5361 \xB7 \u7B2C " + (index2 + 1) + " / " + cards.length + " \u5F20"),
            h(KnowledgeCardView, { card: cards[index2] })
          );
        }
        function renderYunStep() {
          const resource = yunRes;
          if (resource.status === "error") {
            return h(EmptyState, {
              title: "\u97F5\u90E8\u6570\u636E\u6682\u65F6\u4E0D\u53EF\u7528",
              message: describeDataError(resource.error),
              onRetry: () => reloadYun().catch(() => {
              })
            });
          }
          const volumes = resource.data && Array.isArray(resource.data.volumes) ? resource.data.volumes : [];
          const chapters = [];
          volumes.forEach((volume) => {
            const list = volume && Array.isArray(volume.chapters) ? volume.chapters : [];
            list.forEach((chapter2) => chapters.push({ volume: volume.title, chapter: chapter2 }));
          });
          if (!chapters.length) {
            if (resource.status === "ready") {
              return h(EmptyState, {
                title: "\u97F5\u90E8\u5C1A\u672A\u5C31\u7EEA",
                message: "\u58F0\u5F8B\u542F\u8499\u6570\u636E\u8FD8\u4E0D\u5B8C\u6574\uFF0C\u7A0D\u540E\u518D\u8BD5\u3002",
                onRetry: () => reloadYun().catch(() => {
                })
              });
            }
            return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u58F0\u5F8B\u542F\u8499\u2026" });
          }
          const index2 = Math.abs(hashString(dateSeed + "|yun")) % chapters.length;
          const picked = chapters[index2];
          const chapter = picked.chapter || {};
          return h(
            "div",
            { className: "dshp-card" },
            h("div", { className: "dshp-card-summary" }, "\u58F0\u5F8B\u542F\u8499 \xB7 " + (picked.volume || "") + " \xB7 \u7B2C " + (index2 + 1) + " / " + chapters.length + " \u97F5\u90E8"),
            h("div", { className: "dshp-card-title" }, String(chapter.name || "\u97F5\u90E8")),
            chapter.exampleLine ? h("div", { className: "dshp-example" }, h("div", { className: "dshp-example-text" }, String(chapter.exampleLine))) : Array.isArray(chapter.paragraphs) && chapter.paragraphs.length ? h("div", { className: "dshp-example" }, h("div", { className: "dshp-example-text" }, String(chapter.paragraphs[0]))) : null,
            Array.isArray(chapter.exampleChars) && chapter.exampleChars.length ? h("div", { className: "dshp-tags" }, chapter.exampleChars.map((ch, i) => h("span", { key: i, className: "dshp-tag" }, String(ch)))) : null,
            h("div", { className: "dshp-muted", style: { fontSize: "11.5px" } }, "\u97F5\u90E8\u4F8B\u5B57\u4EC5\u4F5C\u6559\u5B66\u793A\u4F8B\uFF0C\u4E0D\u6784\u6210\u5B8C\u6574\u97F5\u8868\u3002")
          );
        }
        function renderCiStep() {
          const knowledge = knowledgeRes;
          if (knowledge.status === "error") {
            return h(EmptyState, {
              title: "\u8BCD\u724C\u6570\u636E\u6682\u65F6\u4E0D\u53EF\u7528",
              message: describeDataError(knowledge.error),
              onRetry: () => reloadKnowledge().catch(() => {
              })
            });
          }
          if (ciRes.status === "error") {
            return h(EmptyState, {
              title: "\u540D\u7BC7\u8BCD\u6682\u65F6\u4E0D\u53EF\u7528",
              message: describeDataError(ciRes.error),
              onRetry: () => reloadCi().catch(() => {
              })
            });
          }
          const ciCards = knowledge.data && Array.isArray(knowledge.data.ciCards) ? knowledge.data.ciCards : [];
          if (!ciCards.length) {
            if (knowledge.status === "ready") {
              return h(EmptyState, {
                title: "\u8BCD\u724C\u5361\u5C1A\u672A\u5C31\u7EEA",
                message: "\u6570\u636E\u6587\u4EF6\u4E2D\u8FD8\u6CA1\u6709\u8BCD\u724C\u5185\u5BB9\uFF0C\u7A0D\u540E\u518D\u8BD5\u3002",
                onRetry: () => reloadKnowledge().catch(() => {
                })
              });
            }
            return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u8BCD\u724C\u2026" });
          }
          const index2 = Math.abs(hashString(dateSeed + "|ci")) % ciCards.length;
          const card = ciCards[index2] || {};
          const ciItems = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : [];
          const matched = ciItems.filter((item) => item && item.rhythmic && item.rhythmic === card.name);
          const ci = matched.length ? matched[Math.abs(hashString(dateSeed + "|ciname")) % matched.length] : ciItems.length ? ciItems[Math.abs(hashString(dateSeed + "|ciany")) % ciItems.length] : null;
          const meta = h(
            "div",
            { className: "dshp-card" },
            h("div", { className: "dshp-card-summary" }, "\u8BCD\u724C\u540D\u7BC7 \xB7 \u7B2C " + (index2 + 1) + " / " + ciCards.length + " \u4E2A\u8BCD\u724C"),
            h(
              "div",
              { className: "dshp-card-title" },
              String(card.name || "\u8BCD\u724C"),
              Array.isArray(card.aliases) && card.aliases.length ? h("span", { className: "dshp-muted", style: { fontSize: "11.5px", fontWeight: 400 } }, "\uFF08" + card.aliases.join("\u3001") + "\uFF09") : null
            ),
            card.form ? h("div", { className: "dshp-p dshp-muted" }, String(card.form) + (card.rhyme ? " \xB7 " + String(card.rhyme) : "")) : null,
            card.example ? h("div", { className: "dshp-example" }, h("div", { className: "dshp-example-note" }, "\u4EE3\u8868\u540D\u53E5"), h("div", { className: "dshp-example-text" }, String(card.example))) : null
          );
          if (!ci) {
            return h(
              "div",
              null,
              meta,
              ciRes.status === "ready" ? h("div", { className: "dshp-empty-msg", style: { marginTop: "8px" } }, "\u540D\u7BC7\u8BCD\u6682\u65F6\u6CA1\u6709\u5339\u914D\u5230\u8FD9\u4E00\u8BCD\u724C\u3002") : h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u540D\u7BC7\u8BCD\u2026" })
            );
          }
          return h("div", null, meta, h("div", { className: "dshp-subtitle" }, "\u540D\u7BC7\u8BCD"), h(CiBody, { ci }));
        }
        function renderStepContent() {
          if (step === 0) return renderPoemStep();
          if (step === 1) return renderAnalysisStep();
          if (step === 2) return renderKnowledgeStep();
          if (step === 3) return renderYunStep();
          if (step === 4) return renderCiStep();
          return renderFeihuaStep();
        }
        function renderFeihuaStep() {
          if (poemsRes.status === "error" || ciRes.status === "error") {
            const failed = poemsRes.status === "error" ? poemsRes : ciRes;
            const retry = poemsRes.status === "error" ? reloadPoems : reloadCi;
            return h(EmptyState, {
              title: "\u98DE\u82B1\u4EE4\u53E5\u5E93\u6682\u65F6\u4E0D\u53EF\u7528",
              message: describeDataError(failed.error),
              onRetry: () => retry().catch(() => {
              })
            });
          }
          const index2 = feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data);
          if (!index2 || !ciRes.data) return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u98DE\u82B1\u4EE4\u53E5\u5E93\u2026" });
          const char = pickDefaultFeihuaChar(index2, poem);
          const count = (index2.byChar[char] || []).length;
          const best = readFeihuaBest();
          const charBest = best.chars[char] || 0;
          return h(
            "div",
            { className: "dshp-card" },
            h("div", { className: "dshp-card-summary" }, "\u98DE\u82B1\u4EE4 \xB7 \u5BF9\u53E5"),
            h(
              "div",
              { className: "dshp-fh-meta" },
              h("span", null, "\u4ECA\u65E5\u4EE4\u5B57 ", h("b", null, "\u300C" + char + "\u300D")),
              h("span", null, "\u53E5\u5E93 ", h("b", null, String(count)), " \u53E5"),
              h("span", null, "\u5386\u53F2\u6700\u4F73 ", h("b", null, String(best.overall)), " \u5206")
            ),
            h("div", { className: "dshp-block" }, "\u7CFB\u7EDF\u5148\u51FA\u542B\u4EE4\u5B57\u7684\u8BD7\u53E5\uFF0C\u4F60\u8F93\u5165\u4E00\u53E5\uFF1A\u6709\u51FA\u5904\u3001\u542B\u4EE4\u5B57\u3001\u672C\u5C40\u4E0D\u91CD\u590D\u5C31\u7B97\u63A5\u4E0A\u3002"),
            feihuaBuilding || ciBankRes.status === "loading" ? h("div", { className: "dshp-lib-note" }, "\u6B63\u5728\u5E76\u5165\u5B8B\u8BCD\u5168\u5E93\u2026") : null,
            ciBankRes.status === "error" ? h("div", { className: "dshp-lib-note" }, "\u5B8B\u8BCD\u5168\u5E93\u52A0\u8F7D\u5931\u8D25\uFF0C\u5DF2\u56DE\u9000\u539F\u53E5\u5E93") : null,
            count ? h(
              "div",
              { className: "dshp-fh-actions" },
              h("button", {
                type: "button",
                className: "dshp-btn dshp-btn-primary",
                onClick: (event) => {
                  event.stopPropagation();
                  openFeihuaGame();
                }
              }, "\u6765\u4E00\u5C40"),
              h("span", { className: "dshp-pager-label" }, "\u672C\u5B57\u6700\u4F73 " + charBest + " \u5206")
            ) : h("div", { className: "dshp-empty-msg", style: { marginTop: "8px" } }, "\u8FD9\u4E00\u5B57\u6682\u65F6\u6CA1\u6709\u53E5\u5B50\uFF0C\u6362\u4E00\u4E2A\u4EE4\u5B57\u8BD5\u8BD5\u3002")
          );
        }
        function renderBubbleFooter() {
          if (step < 0) return null;
          const buttons = [];
          if (step === 0) {
            buttons.push(h("button", {
              key: "next",
              type: "button",
              className: "dshp-btn dshp-btn-primary",
              onClick: changePoem,
              title: settings.mode === "random" ? "\u968F\u673A\u6362\u4E00\u9996" : "\u6BCF\u65E5\u6A21\u5F0F\uFF1A\u56DE\u5230\u4ECA\u65E5\uFF0C\u518D\u70B9\u7FFB\u4E0B\u4E00\u9996"
            }, "\u6362\u4E00\u9996"));
            if (poem && activeTodayPoemId && poem.id !== activeTodayPoemId) {
              buttons.push(h("button", { key: "today", type: "button", className: "dshp-link", onClick: backToToday }, "\u56DE\u5230\u4ECA\u65E5"));
            }
          } else {
            buttons.push(h("button", {
              key: "next",
              type: "button",
              className: "dshp-btn dshp-btn-primary",
              onClick: advanceStep
            }, step >= STEPS.length - 1 ? "\u6536\u8D77" : "\u4E0B\u4E00\u6761"));
          }
          buttons.push(h("span", { key: "spacer", className: "dshp-spacer" }));
          buttons.push(h("button", {
            key: "panel",
            type: "button",
            className: "dshp-btn",
            onClick: () => openPanel(["today", "today", "class", "yun", "ci", "feihua"][step] || "today")
          }, "\u5C55\u5F00\u9762\u677F"));
          return h("div", { className: "dshp-bubble-foot" }, buttons);
        }
        function renderBubble() {
          if (step < 0 || panelOpen || settings.hidden) return null;
          const width = Math.min(304, viewport.w - 16);
          const placeAbove = pos.y > Math.min(300, viewport.h * 0.45);
          const available = placeAbove ? Math.max(140, pos.y - 20) : Math.max(140, viewport.h - pos.y - mascotSize - 20);
          const bodyMax = Math.max(120, Math.min(380, available - 96));
          let left = pos.x + mascotSize / 2 - width / 2;
          left = clamp(left, 8, Math.max(8, viewport.w - width - 8));
          const style = { left: Math.round(left) + "px", width: Math.round(width) + "px" };
          if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + "px";
          else style.top = Math.round(pos.y + mascotSize + 10) + "px";
          return h(
            "div",
            { key: "bubble", className: "dshp-bubble", style, role: "dialog", "aria-label": STEPS[step] || "\u8BD7\u8BCD\u6C14\u6CE1" },
            h(
              "div",
              { className: "dshp-bubble-head" },
              h(
                "span",
                { className: "dshp-bubble-title" },
                h("span", { className: "dshp-bubble-step-name" }, STEPS[step] || "\u8BD7\u8BCD"),
                h("span", { className: "dshp-progress", "aria-hidden": "true" }, step + 1 + " / " + STEPS.length),
                h(
                  "span",
                  { className: "dshp-dots", role: "group", "aria-label": "\u5207\u6362\u5230\u6307\u5B9A\u5361\u7247" },
                  STEPS.map((label, index2) => h("button", {
                    key: label,
                    type: "button",
                    className: cx("dshp-dot", index2 === step && "dshp-is-active"),
                    title: label,
                    "aria-label": "\u5207\u6362\u5230\u7B2C " + (index2 + 1) + " \u5F20\uFF1A" + label,
                    "aria-current": index2 === step ? "step" : void 0,
                    onClick: (event) => {
                      event.stopPropagation();
                      setStep(index2);
                    }
                  })),
                  h("button", {
                    key: "collapse",
                    type: "button",
                    className: "dshp-dot dshp-dot-collapse",
                    title: "\u6536\u8D77\u6C14\u6CE1",
                    "aria-label": "\u6536\u8D77\u6C14\u6CE1",
                    onClick: (event) => {
                      event.stopPropagation();
                      setStep(-1);
                    }
                  })
                )
              ),
              h("button", {
                type: "button",
                className: "dshp-icon-btn",
                title: "\u6536\u8D77\u6C14\u6CE1",
                "aria-label": "\u6536\u8D77\u6C14\u6CE1",
                onClick: () => setStep(-1)
              }, "\xD7")
            ),
            h("div", { className: "dshp-bubble-body", style: { maxHeight: Math.round(bodyMax) + "px" } }, renderStepContent()),
            renderBubbleFooter()
          );
        }
        function renderSpontPoem() {
          if (!spontPoem || settings.hidden || panelOpen && !spontPreview || !spontPreview && step >= 0) return null;
          const width = Math.min(288, viewport.w - 16);
          let left = pos.x + mascotSize / 2 - width / 2;
          left = clamp(left, 8, Math.max(8, viewport.w - width - 8));
          const placeAbove = pos.y > Math.min(280, viewport.h * 0.45);
          const style = { left: Math.round(left) + "px", width: Math.round(width) + "px" };
          if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + "px";
          else style.top = Math.round(pos.y + mascotSize + 10) + "px";
          if (spontPoem.type === "thinking") {
            return h(
              "div",
              { key: "spont", className: "dshp-spont", style, role: "status", "aria-live": "polite" },
              h("div", { className: "dshp-spont-title" }, "\u5B83\u6B63\u5728\u60F3\u2026"),
              h("div", { className: "dshp-spont-thinking" }, "\u7A0D\u7B49\u4E00\u4E0B\u4E0B\u2026"),
              h(
                "div",
                { className: "dshp-spont-actions" },
                h("button", {
                  type: "button",
                  className: "dshp-btn dshp-btn-small",
                  onClick: (event) => {
                    event.stopPropagation();
                    spontReqRef.current += 1;
                    selfTalkNoveltyRef.current = { signature: "", at: 0 };
                    setSpontPreview(false);
                    setSpontPoem(null);
                  }
                }, "\u5173\u95ED")
              )
            );
          }
          const isPoemCard = spontPoem.type !== "murmur";
          const sentenceProps = { className: "dshp-spont-sentence" };
          if (isPoemCard) {
            sentenceProps.role = "button";
            sentenceProps.tabIndex = 0;
            sentenceProps.title = "\u5728\u9762\u677F\u91CC\u67E5\u770B\u6574\u9996";
            sentenceProps.onClick = (event) => {
              event.stopPropagation();
              openSpontPoem();
            };
            sentenceProps.onKeyDown = (event) => {
              if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                event.preventDefault();
                openSpontPoem();
              }
            };
          }
          return h(
            "div",
            { key: "spont", className: "dshp-spont", style, role: "status", "aria-live": "polite" },
            h("div", { className: "dshp-spont-title" }, spontPoem.tag === "action" ? "\u81EA\u5DF1" : "\u5B83\u8BF4\uFF1A"),
            spontPoem.type === "hybrid" && spontPoem.prefix ? h("div", { className: "dshp-spont-prefix" }, String(spontPoem.prefix)) : null,
            h("div", sentenceProps, String(spontPoem.line || "")),
            isPoemCard && spontPoem.label ? h("div", { className: "dshp-spont-source" }, "\u2014\u2014 " + spontPoem.label) : null,
            h(
              "div",
              { className: "dshp-spont-actions" },
              h("button", {
                type: "button",
                className: "dshp-btn dshp-btn-small",
                onClick: (event) => {
                  event.stopPropagation();
                  readAnotherSpontaneous();
                }
              }, "\u518D\u8BF4\u4E00\u53E5"),
              h("button", {
                type: "button",
                className: "dshp-btn dshp-btn-small",
                onClick: (event) => {
                  event.stopPropagation();
                  spontReqRef.current += 1;
                  selfTalkNoveltyRef.current = { signature: "", at: 0 };
                  setSpontPreview(false);
                  setSpontPoem(null);
                }
              }, "\u5173\u95ED")
            )
          );
        }
        function renderToast() {
          if (!toast) return null;
          const left = clamp(pos.x, 8, Math.max(8, viewport.w - 280));
          const top = clamp(pos.y - 44, 8, Math.max(8, viewport.h - 72));
          return h("div", {
            key: "toast",
            className: cx("dshp-toast", toast.kind === "error" && "dshp-is-error"),
            role: "status",
            "aria-live": "polite",
            style: { left: Math.round(left) + "px", top: Math.round(top) + "px" }
          }, toast.text);
        }
        function clearMotionTimers() {
          if (motionDelayTimerRef.current) {
            clearTimeout(motionDelayTimerRef.current);
            motionDelayTimerRef.current = null;
          }
          if (motionStopTimerRef.current) {
            clearTimeout(motionStopTimerRef.current);
            motionStopTimerRef.current = null;
          }
        }
        function currentMoodImageFile() {
          const view = moodViewRef.current;
          return view && view.image ? String(view.image) : "";
        }
        function scheduleMotion(delay) {
          if (motionDelayTimerRef.current) clearTimeout(motionDelayTimerRef.current);
          motionDelayTimerRef.current = setTimeout(() => {
            motionDelayTimerRef.current = null;
            tryStartMotion();
          }, Math.max(1e3, num(delay, nextMotionDelay())));
        }
        function scheduleInitialMotion() {
          const first = !motionFirstScheduledRef.current;
          const delay = nextMotionScheduleDelay({ first, moodImage: currentMoodImageFile() });
          motionFirstScheduledRef.current = true;
          motionFirstPendingRef.current = first && !isVideoMoodFile(currentMoodImageFile());
          scheduleMotion(delay);
        }
        function tryStartMotion() {
          const entries = petMediaEntriesRef.current;
          const ui = uiRef.current;
          if (!entries || !entries.length) return;
          if (!ui.settings.mood || ui.settings.hidden) return;
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          if (ui.panelOpen) return;
          if (dizzyRef.current || mealActiveRef.current) {
            scheduleMotion(nextMotionDelay());
            return;
          }
          if (mascotPulseRef.current || mascotExpressionRef.current) {
            scheduleMotion(nextMotionDelay());
            return;
          }
          if (wanderRef.current.walking) {
            scheduleMotion(nextMotionDelay());
            return;
          }
          if (motionFileRef.current) return;
          const picked = nextMotionEntry(entries, motionIndexRef.current);
          if (!picked.entry) return;
          motionIndexRef.current = picked.index;
          motionFirstPendingRef.current = false;
          writeMotionRotation(picked.index);
          setMotionFile(picked.entry.file);
          motionStopTimerRef.current = setTimeout(() => {
            motionStopTimerRef.current = null;
            setMotionFile("");
            scheduleMotion(nextMotionDelay());
          }, nextMotionDuration());
        }
        function handleMascotMediaError(file) {
          if (dizzyRef.current && dizzyRef.current.file && file === dizzyRef.current.file) {
            setDizzy((current) => current ? Object.assign({}, current, { file: "" }) : current);
            return;
          }
          if (mealActiveRef.current && file === mealActiveRef.current.file) {
            setMealActive((current) => current ? Object.assign({}, current, { file: "dsh-whale-state-daily-eat.webp" }) : current);
            return;
          }
          if (wanderFileRef.current && file === wanderFileRef.current) {
            if (file === WANDER_STATIC_FILE) {
              setWanderFile("");
            } else {
              setWanderFile(WANDER_STATIC_FILE);
            }
            return;
          }
          if (motionFileRef.current && file === motionFileRef.current) {
            if (motionStopTimerRef.current) {
              clearTimeout(motionStopTimerRef.current);
              motionStopTimerRef.current = null;
            }
            setMotionFile("");
            scheduleMotion(nextMotionDelay());
            return;
          }
          setFailedMascot(file);
        }
        React.useEffect(() => {
          if (!settings.mood || settings.hidden || panelOpen || petMediaRes.status !== "ready" || !petMediaRes.entries.length) {
            clearMotionTimers();
            if (motionFileRef.current) setMotionFile("");
            return void 0;
          }
          scheduleInitialMotion();
          return () => {
            clearMotionTimers();
          };
        }, [settings.mood, settings.hidden, panelOpen, petMediaRes.status, petMediaRes.entries.length]);
        React.useEffect(() => {
          if (typeof document === "undefined" || typeof document.addEventListener !== "function") return void 0;
          const onVisibility = () => {
            if (document.visibilityState === "hidden") {
              clearMotionTimers();
              if (motionFileRef.current) setMotionFile("");
              return;
            }
            if (settingsRef.current.mood && !uiRef.current.panelOpen && petMediaEntriesRef.current.length) {
              scheduleMotion(nextMotionDelay());
            }
          };
          document.addEventListener("visibilitychange", onVisibility);
          return () => document.removeEventListener("visibilitychange", onVisibility);
        }, []);
        React.useEffect(() => {
          if (!motionFirstPendingRef.current) return;
          const image = currentMoodImageFile();
          if (!isVideoMoodFile(image)) return;
          motionFirstPendingRef.current = false;
          clearMotionTimers();
          scheduleMotion(nextMotionDelay());
        }, [moodView]);
        React.useEffect(() => {
          if (!settings.hidden) {
            maybeTriggerMeal();
          }
          const timer2 = setInterval(() => {
            maybeTriggerMeal();
          }, 60 * 1e3);
          const onVisible = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            maybeTriggerMeal();
          };
          const onFocus = () => maybeTriggerMeal();
          if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
          if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("focus", onFocus);
          return () => {
            clearInterval(timer2);
            if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
            if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("focus", onFocus);
          };
        }, [settings.hidden]);
        React.useEffect(() => {
          if (panelOpen) {
            mealPrevPanelRef.current = true;
            return;
          }
          if (mealPrevPanelRef.current) {
            mealPrevPanelRef.current = false;
            maybeTriggerMeal();
          }
        }, [panelOpen]);
        React.useEffect(() => {
          if (!(panelOpen || settings.hidden)) return;
          if (dizzyTimerRef.current) {
            clearTimeout(dizzyTimerRef.current);
            dizzyTimerRef.current = null;
          }
          if (dizzyRef.current) setDizzy(null);
          if (mealTimerRef.current) {
            clearTimeout(mealTimerRef.current);
            mealTimerRef.current = null;
          }
          if (mealActiveRef.current) {
            setMealActive(null);
            mealActiveRef.current = null;
          }
        }, [panelOpen, settings.hidden]);
        React.useEffect(() => () => {
          if (dizzyTimerRef.current) clearTimeout(dizzyTimerRef.current);
          if (mealTimerRef.current) clearTimeout(mealTimerRef.current);
        }, []);
        React.useEffect(() => {
          let alive = true;
          const load = () => {
            if (!alive) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            fetchJson(SELF_PATH).then((data) => {
              if (alive) setSelfStatus(normalizeSelfStatus(data));
            }).catch(() => {
              if (alive) setSelfStatus(null);
            });
          };
          load();
          const timer2 = setInterval(load, SELF_POLL_MS);
          const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            load();
          };
          if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", onVisibility);
          return () => {
            alive = false;
            clearInterval(timer2);
            if (typeof document !== "undefined" && typeof document.removeEventListener === "function") document.removeEventListener("visibilitychange", onVisibility);
          };
        }, []);
        function showSelfAction(action) {
          if (!action || !action.id) return;
          lastSeenActionIdRef.current = action.id;
          writeSeenActionId(action.id);
          showSpontCard(
            { id: "action:" + action.id, type: "murmur", title: "\u81EA\u5DF1", line: String(action.text || action.label || ""), tag: "action" },
            { preview: true, record: false, remember: false }
          );
        }
        React.useEffect(() => {
          const latest = selfStatus && selfStatus.actions ? selfStatus.actions.latest : null;
          if (!latest || !latest.id) return;
          if (lastSeenActionIdRef.current === latest.id) return;
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            pendingActionRef.current = latest;
            return;
          }
          showSelfAction(latest);
        }, [selfStatus]);
        React.useEffect(() => {
          if (typeof document === "undefined" || typeof document.addEventListener !== "function") return void 0;
          const onVisibility = () => {
            if (document.visibilityState === "hidden") return;
            const pending = pendingActionRef.current;
            if (!pending) return;
            pendingActionRef.current = null;
            showSelfAction(pending);
          };
          document.addEventListener("visibilitychange", onVisibility);
          return () => document.removeEventListener("visibilitychange", onVisibility);
        }, []);
        React.useEffect(() => {
          if (!panelOpen || panelTab !== "growth" || settings.hidden) {
            setMemoryStatus(null);
            return void 0;
          }
          let alive = true;
          const load = () => {
            if (!alive) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            fetchJson(MEMORY_PATH).then((data) => {
              if (alive) setMemoryStatus(normalizeMemoryStatus(data));
            }).catch(() => {
              if (alive) setMemoryStatus(null);
            });
          };
          load();
          const timer2 = setInterval(load, MEMORY_POLL_MS);
          const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            load();
          };
          if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", onVisibility);
          return () => {
            alive = false;
            clearInterval(timer2);
            if (typeof document !== "undefined" && typeof document.removeEventListener === "function") document.removeEventListener("visibilitychange", onVisibility);
          };
        }, [panelOpen, panelTab, settings.hidden, memoryTick]);
        React.useEffect(() => {
          let lastAt = 0;
          const send = (kind) => {
            const now2 = Date.now();
            if (now2 - lastAt < PRESENCE_THROTTLE_MS) return;
            lastAt = now2;
            fetchJson(PRESENCE_PATH, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind })
            }).catch(() => {
            });
          };
          const onPointer = () => send("tap");
          const onKey = () => send("tap");
          const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "visible") send("tap");
          };
          if (typeof document !== "undefined") {
            document.addEventListener("pointerdown", onPointer, { passive: true });
            document.addEventListener("visibilitychange", onVisibility);
          }
          if (typeof window !== "undefined") window.addEventListener("keydown", onKey);
          return () => {
            if (typeof document !== "undefined") {
              document.removeEventListener("pointerdown", onPointer);
              document.removeEventListener("visibilitychange", onVisibility);
            }
            if (typeof window !== "undefined") window.removeEventListener("keydown", onKey);
          };
        }, []);
        React.useEffect(() => {
          if (!panelOpen || panelTab !== "growth" || settings.hidden) {
            setWorksRes({ status: "idle", data: null });
            return void 0;
          }
          let alive = true;
          const load = () => {
            if (!alive) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            fetchJson(WORKS_PATH).then((data) => {
              if (alive) setWorksRes({ status: "ready", data: normalizeWorks(data) });
            }).catch(() => {
              if (alive) setWorksRes({ status: "error", data: null });
            });
          };
          load();
          const timer2 = setInterval(load, WORKS_POLL_MS);
          return () => {
            alive = false;
            clearInterval(timer2);
          };
        }, [panelOpen, panelTab, settings.hidden]);
        React.useEffect(() => {
          if (!panelOpen || settings.hidden) {
            setAttentionRes({ status: "idle", data: null });
            return void 0;
          }
          let alive = true;
          const load = () => {
            if (!alive) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            fetchJson(ATTENTION_PATH).then((data) => {
              if (alive) setAttentionRes({ status: "ready", data: normalizeAttention(data) });
            }).catch(() => {
              if (alive) setAttentionRes({ status: "error", data: null });
            });
          };
          load();
          const timer2 = setInterval(load, ATTENTION_POLL_MS);
          return () => {
            alive = false;
            clearInterval(timer2);
          };
        }, [panelOpen, settings.hidden]);
        React.useEffect(() => {
          if (!panelOpen || panelTab !== "growth" || settings.hidden) {
            setTwinRes({ status: "idle", data: null });
            return void 0;
          }
          let alive = true;
          const load = () => {
            if (!alive) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            fetchJson(TWIN_PATH).then((data) => {
              if (alive) setTwinRes({ status: "ready", data: normalizeTwinState(data) });
            }).catch(() => {
              if (alive) setTwinRes({ status: "error", data: null });
            });
          };
          load();
          const timer2 = setInterval(load, TWIN_POLL_MS);
          return () => {
            alive = false;
            clearInterval(timer2);
          };
        }, [panelOpen, panelTab, settings.hidden]);
        React.useEffect(() => {
          if (!panelOpen || panelTab !== "settings" || settings.hidden) {
            setHealthStatus(null);
            return void 0;
          }
          let alive = true;
          const load = () => {
            if (!alive) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            fetchJson(HEALTH_PATH).then((data) => {
              if (alive) setHealthStatus(normalizeHealthStatus(data));
            }).catch(() => {
              if (alive) setHealthStatus(null);
            });
          };
          load();
          const timer2 = setInterval(load, HEALTH_POLL_MS);
          return () => {
            alive = false;
            clearInterval(timer2);
          };
        }, [panelOpen, panelTab, settings.hidden]);
        function loadProjectDetail() {
          return fetchJson(PROJECT_PATH).then((data) => {
            if (data && data.ok === true) setProjectDetail(data);
            return data;
          }).catch(() => null);
        }
        function projectAction(action) {
          const current = selfStatus && selfStatus.project;
          if (!current || !current.id) return Promise.resolve({ ok: false });
          return fetchJsonUrl(ROUTE + PROJECT_ACTION_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: current.id }) }).then((data) => {
            if (data && data.ok === true) {
              showToastRef.current(action === "drop" ? "\u9879\u76EE\u5DF2\u653E\u4E0B" : action === "pause" ? "\u5148\u6682\u505C" : "\u7EE7\u7EED\u505A");
              return fetchJson(SELF_PATH).then((next) => {
                setSelfStatus(normalizeSelfStatus(next));
                return data;
              }).catch(() => data);
            }
            showToastRef.current("\u9879\u76EE\u72B6\u6001\u6CA1\u53D8", "error");
            return data;
          }).catch(() => {
            showToastRef.current("\u9879\u76EE\u72B6\u6001\u6CA1\u53D8", "error");
            return { ok: false };
          });
        }
        function attentionAction(id2, action, text) {
          const payload = { action, id: id2 };
          if (typeof text === "string" && text.length > 0) payload.text = text;
          return fetchJsonUrl(ROUTE + ATTENTION_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((data) => {
            if (data && data.ok === true) {
              showToastRef.current(action === "send" ? "\u5DF2\u53D1\u51FA\u53BB" : "\u5148\u538B\u4E0B\u4E86");
            } else {
              showToastRef.current("\u6CA1\u53D1\u51FA\u53BB", "error");
            }
            setAttentionRes((current) => ({ ...current, data: null }));
            return data;
          }).catch(() => {
            showToastRef.current("\u6CA1\u53D1\u51FA\u53BB", "error");
            return { ok: false };
          });
        }
        function setAttentionMode(mode) {
          return fetchJsonUrl(ROUTE + ATTENTION_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mode", mode }) }).then((data) => {
            if (data && data.ok === true) {
              showToastRef.current(data.mode === "auto" ? "\u4E3B\u52A8\u6D88\u606F\uFF1A\u81EA\u52A8" : "\u4E3B\u52A8\u6D88\u606F\uFF1A\u89C2\u5BDF\u4E2D");
            }
            return data;
          }).catch(() => ({ ok: false }));
        }
        function backupMemory() {
          return fetchJsonUrl(ROUTE + MEMORY_BACKUP_PATH, { method: "POST" }).then((data) => {
            showToastRef.current("\u5DF2\u5907\u4EFD");
            setMemoryTick((tick) => tick + 1);
            return data;
          }).catch(() => {
            showToastRef.current("\u5907\u4EFD\u5931\u8D25", "error");
            return { ok: false };
          });
        }
        const syncMascotVideoPlayback = React.useCallback(() => {
          const video = mascotVideoRef.current;
          if (!video) return;
          const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
          const shouldPause = mascotVideoShouldPause({ hidden, panelOpen });
          try {
            if (shouldPause) {
              if (typeof video.pause === "function") video.pause();
            } else if (typeof video.play === "function") {
              const played = video.play();
              if (played && typeof played.catch === "function") played.catch(() => {
              });
            }
          } catch (error) {
          }
        }, [panelOpen]);
        React.useEffect(() => {
          syncMascotVideoPlayback();
        });
        React.useEffect(() => {
          if (typeof document === "undefined" || typeof document.addEventListener !== "function") return void 0;
          document.addEventListener("visibilitychange", syncMascotVideoPlayback);
          return () => document.removeEventListener("visibilitychange", syncMascotVideoPlayback);
        }, [syncMascotVideoPlayback]);
        React.useEffect(() => () => {
          const video = mascotVideoRef.current;
          if (video && typeof video.pause === "function") {
            try {
              video.pause();
            } catch (error) {
            }
          }
        }, []);
        function renderMascot() {
          const showHint = !settings.tutorialSeen && step < 0 && !panelOpen;
          const weatherOn = settings.weatherPoem || settings.mood;
          const imageInfo = mascotImageFor({
            weatherStateKey: mascotStateFor(weather, weatherOn),
            weatherEnabled: weatherOn,
            moodEnabled: settings.mood,
            mood: moodView
          });
          const pulseFile = mascotPulse && MASCOT_FILES[mascotPulse] ? MASCOT_FILES[mascotPulse] : "";
          const expressionFile = mascotExpression && MASCOT_EXPRESSION_FILES.indexOf(mascotExpression) >= 0 ? mascotExpression : "";
          const panelFile = panelOpen ? panelPeekFile(moodCatalog, panelTab === "poetry" ? poetryTab : panelTab) : "";
          const dizzyFile = dizzy && dizzy.file ? dizzy.file : "";
          const mealFile = mealActive && mealActive.file ? mealActive.file : "";
          const motionVideoFile = motionFile && isVideoMoodFile(motionFile) ? motionFile : "";
          const wanderMediaFile = wanderFile && (isVideoMoodFile(wanderFile) || wanderFile === WANDER_STATIC_FILE) ? wanderFile : "";
          const stateKey = pulseFile ? mascotPulse : panelFile ? "peek:" + panelTab : dizzyFile ? "dizzy:" + dizzyFile : mealFile ? "meal:" + mealFile : expressionFile ? "egg:" + expressionFile : wanderMediaFile ? "wander:" + wanderMediaFile : motionVideoFile ? "motion:" + motionVideoFile : imageInfo.stateKey;
          const desiredFile = mascotFilePriority({ pulseFile, panelFile, dizzyFile, mealFile, expressionFile, wanderFile: wanderMediaFile, motionFile: motionVideoFile, moodFile: imageInfo.file });
          const mascotFile = failedMascot && failedMascot === desiredFile ? MASCOT_FILES.celebrate : desiredFile;
          return h(
            "div",
            {
              key: "mascot",
              className: cx("dshp-stage", dizzy && "dshp-dizzy"),
              role: "button",
              tabIndex: 0,
              "aria-label": "\u5C0F\u9CB8\u9C7C\uFF1A\u70B9\u51FB\u770B\u770B\u5979\uFF0C\u53EF\u62D6\u52A8",
              title: "\u70B9\u51FB\uFF1A\u4ECA\u65E5\u4E00\u8BD7 \xB7 \u62D6\u52A8\uFF1A\u79FB\u52A8 \xB7 \u53F3\u952E\uFF1A\u8BBE\u7F6E",
              onPointerDown: handlePointerDown,
              onPointerMove: handlePointerMove,
              onPointerUp: handlePointerUp,
              onPointerCancel: handlePointerCancel,
              onDoubleClick: (event) => {
                if (event && typeof event.preventDefault === "function") event.preventDefault();
                noteInteraction();
                showMascotExpression(pickMascotExpression());
                setStep((current) => current > 0 ? current - 2 : -1);
              },
              onKeyDown: handleMascotKeyDown,
              onContextMenu: (event) => {
                event.preventDefault();
                openPanel("settings");
              }
            },
            h(
              "div",
              { className: "dshp-mascot", "aria-hidden": "true" },
              isVideoMoodFile(mascotFile) ? h("video", {
                key: stateKey + "|" + mascotFile,
                ref: mascotVideoRef,
                className: "dshp-mascot-video dshp-mascot-swap",
                src: petMediaUrl(mascotFile),
                autoPlay: true,
                muted: true,
                loop: true,
                playsInline: true,
                preload: "auto",
                "aria-hidden": "true",
                onError: () => handleMascotMediaError(desiredFile)
              }) : h("img", {
                key: stateKey,
                className: "dshp-mascot-img dshp-mascot-swap",
                src: mascotUrl(mascotFile),
                alt: "",
                draggable: false,
                loading: "lazy",
                decoding: "async",
                onError: () => handleMascotMediaError(desiredFile)
              })
            ),
            dizzy ? h("div", { className: "dshp-dizzy-stars", "aria-hidden": "true" }, "\u{1F4AB}") : null,
            dizzy ? h("div", { className: "dshp-dizzy-tip" }, "\u522B\u7529\u5566\uFF0C\u5934\u597D\u6655\u2026") : null,
            showHint ? h("div", { className: "dshp-tip" }, "\u70B9\u6211\u770B\u4ECA\u65E5\u4E00\u8BD7") : null
          );
        }
        function renderMealTip() {
          if (!mealActive) return null;
          const width = Math.min(288, viewport.w - 16);
          let left = pos.x + mascotSize / 2 - width / 2;
          left = clamp(left, 8, Math.max(8, viewport.w - width - 8));
          const style = { left: Math.round(left) + "px", width: Math.round(width) + "px" };
          const placeAbove = pos.y > Math.min(280, viewport.h * 0.45);
          if (placeAbove) style.bottom = Math.round(viewport.h - pos.y + 10) + "px";
          else style.top = Math.round(pos.y + mascotSize + 10) + "px";
          return h(
            "div",
            { key: "meal", className: "dshp-spont dshp-meal-tip", style, role: "status", "aria-live": "polite" },
            h("div", { className: "dshp-spont-title" }, "\u5230\u996D\u70B9\u5566"),
            h("div", { className: "dshp-spont-sentence" }, String(mealActive.text || ""))
          );
        }
        function renderRestoreHotspot() {
          return h(
            "div",
            {
              key: "restore",
              className: "dshp-restore",
              role: "button",
              tabIndex: 0,
              title: "\u53CC\u51FB\u7A7A\u767D\u5904\u6216\u957F\u6309\u8FD9\u91CC\u6062\u590D\u5C0F\u9CB8\u9C7C",
              "aria-label": "\u6062\u590D\u5C0F\u9CB8\u9C7C",
              onPointerDown: handleRestorePointerDown,
              onPointerUp: handleRestorePointerUp,
              onPointerCancel: handleRestorePointerUp,
              onDoubleClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                restoreWidget();
              },
              onKeyDown: (event) => {
                if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                  event.preventDefault();
                  restoreWidget();
                }
              }
            },
            "\u8BD7"
          );
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
            moodChip,
            moodChipTitle,
            moodBasis,
            moodSource,
            moodAiFallback,
            moodAiStale,
            moodAiFailure,
            moodAiFailureCode,
            petVideoCount: petMediaRes.entries.length,
            selfStatus,
            memoryStatus,
            healthStatus,
            worksRes,
            attentionRes,
            attentionAction,
            projectAction,
            projectDetail,
            twinRes,
            loadProjectDetail,
            setAttentionMode,
            backupMemory,
            refreshMoodNow,
            previewSpontaneousPoem,
            readAnotherSpontaneous,
            recentSpoken: recentSpokenRef.current.slice(-5),
            openPoetryModule,
            poetryEntryEnabled: POETRY_ENTRY_ENABLED,
            startPoetryTour,
            openSettings: openSettingsPanel,
            openPanel,
            openPanelTab,
            anthologyRes,
            bankRes,
            pingshuiRes,
            reloadAnthology,
            reloadBank,
            reloadPingshui,
            libraryFocus
          };
          if (panelTab === "growth") return h(GrowthTab, { api });
          if (panelTab === "graph") return h(GraphTab, { api });
          if (panelTab === "settings") return h(SettingsTab, { api });
          if (panelTab === "poetry") {
            if (poetryTab === "poetry-settings") return h(PoetrySettingsTab, { api });
            if (poetryTab === "class") return h(ClassTab, { api });
            if (poetryTab === "yun") return h(YunTab, { api });
            if (poetryTab === "ci") return h(CiTab, { api });
            if (poetryTab === "library") return h(LibraryTab, { api });
            if (poetryTab === "feihua") return h(FeihuaTab, { api });
            return h(TodayTab, { api });
          }
          return h(GrowthTab, { api });
        }
        function renderPanel() {
          if (!panelOpen || settings.hidden) return null;
          const width = Math.min(420, viewport.w - 16);
          const height = Math.min(560, viewport.h - 16);
          let left = pos.x + mascotSize + 12;
          if (left + width > viewport.w - 8) left = pos.x - width - 12;
          if (left + width > viewport.w - 8) left = viewport.w - width - 8;
          left = Math.max(8, left);
          let top = pos.y + mascotSize - height;
          top = clamp(top, 8, Math.max(8, viewport.h - height - 8));
          return h(
            "div",
            {
              key: "panel",
              className: "dshp-panel",
              role: "dialog",
              "aria-label": "\u9CB8\u9C7C\u5A18\u7684\u5C0F\u89D2\u843D\u6210\u957F\u9762\u677F",
              style: { left: Math.round(left) + "px", top: Math.round(top) + "px" }
            },
            h(
              "div",
              { className: "dshp-panel-head" },
              h(
                "div",
                { className: "dshp-panel-title" },
                "\u9CB8\u9C7C\u5A18\u7684\u5C0F\u89D2\u843D",
                h("small", null, panelTab === "poetry" ? "\u8BD7\u8BCD\u4E0E\u683C\u5F8B \xB7 \u4E8C\u7EA7\u83DC\u5355" : "\u81EA\u9A71\u6210\u957F\u4E2D" + (boot.data && boot.data.dataVersion ? " \xB7 \u6570\u636E " + boot.data.dataVersion : ""))
              ),
              h("button", {
                type: "button",
                className: "dshp-icon-btn",
                title: "\u5173\u95ED\u9762\u677F\uFF08Esc\uFF09",
                "aria-label": "\u5173\u95ED\u9762\u677F",
                onClick: () => setPanelOpen(false)
              }, "\xD7")
            ),
            h(
              "div",
              { className: "dshp-tabs", role: "tablist" },
              (panelTab === "poetry" ? POETRY_TABS : PANEL_TABS).map((tab) => h("button", {
                key: tab.id,
                type: "button",
                role: "tab",
                "aria-selected": panelTab === "poetry" ? poetryTab === tab.id : panelTab === tab.id,
                className: cx(
                  panelTab === "poetry" ? "dshp-subtab" : "dshp-tab",
                  panelTab === "poetry" ? null : "dshp-primary-tab",
                  (panelTab === "poetry" ? poetryTab === tab.id : panelTab === tab.id) && "dshp-is-active"
                ),
                onClick: () => panelTab === "poetry" ? setPoetryTab(tab.id) : openPanelTab(tab.id)
              }, tab.label))
            ),
            h("div", { className: "dshp-panel-body" }, renderPanelTab()),
            h(
              "div",
              { className: "dshp-panel-foot" },
              panelTab === "poetry" ? [
                h("button", {
                  key: "back",
                  type: "button",
                  className: "dshp-foot-link",
                  "aria-label": "\u8FD4\u56DE\u6210\u957F",
                  title: "\u8FD4\u56DE\u6210\u957F",
                  onClick: () => openPanelTab("growth")
                }, "\u2190 \u8FD4\u56DE\u6210\u957F"),
                h("button", {
                  key: "tour",
                  type: "button",
                  className: "dshp-foot-link dshp-foot-link-accent",
                  "aria-label": "\u9010\u9875\u770B\u8BD7\u7B3A",
                  title: "\u4EE5\u8BD7\u7B3A\u6C14\u6CE1\u9010\u9875\u770B\u4ECA\u65E5\u8BD7",
                  onClick: () => {
                    if (typeof startPoetryTour === "function") startPoetryTour();
                  }
                }, "\u9010\u9875\u770B\u8BD7\u7B3A")
              ] : [
                h("span", { key: "hint", className: "dshp-foot-hint" }, "\u66F4\u591A"),
                h("button", {
                  key: "poetry",
                  type: "button",
                  className: "dshp-foot-link",
                  "aria-label": "\u6253\u5F00\u8BD7\u8BCD\u4E8C\u7EA7\u83DC\u5355",
                  title: "\u8BD7\u8BCD\u4E0E\u683C\u5F8B\uFF08\u4E8C\u7EA7\u83DC\u5355\uFF09",
                  onClick: () => openPanelTab("poetry")
                }, "\u8BD7\u8BCD\u4E0E\u683C\u5F8B \u203A")
              ]
            )
          );
        }
        const rootSize = settings.hidden ? 28 : mascotSize;
        const rootStyle = {
          position: "fixed",
          left: Math.round(pos.x) + "px",
          top: Math.round(pos.y) + "px",
          transition: walking ? `left ${WANDER_WALK_MS}ms ease-in-out, top ${WANDER_WALK_MS}ms ease-in-out` : "none",
          width: rootSize + "px",
          height: rootSize + "px",
          zIndex: Z_INDEX,
          pointerEvents: "auto",
          userSelect: "none"
        };
        const nodes = [h("style", { key: "dshp-style" }, CSS2)];
        if (settings.hidden) {
          nodes.push(renderRestoreHotspot());
        } else {
          nodes.push(renderMascot());
          const bubbleNode = renderBubble();
          if (bubbleNode) nodes.push(bubbleNode);
          const panelNode = renderPanel();
          if (panelNode) nodes.push(panelNode);
          const toastNode = renderToast();
          if (toastNode) nodes.push(toastNode);
          const spontNode = renderSpontPoem();
          if (spontNode) nodes.push(spontNode);
          const mealNode = renderMealTip();
          if (mealNode) nodes.push(mealNode);
        }
        return h(
          "div",
          {
            "data-dsh-little-whale": "root",
            "data-dshp-hidden": settings.hidden ? "true" : "false",
            className: "dshp-root",
            style: rootStyle
          },
          nodes
        );
      }
      function KnowledgeCardView(props) {
        const card = props.card || {};
        const paragraphs = Array.isArray(card.paragraphs) ? card.paragraphs : [];
        const examples = Array.isArray(card.examples) ? card.examples : [];
        return h(
          "div",
          { className: "dshp-card" },
          h("div", { className: "dshp-card-title" }, String(card.title || "\u683C\u5F8B\u77E5\u8BC6")),
          card.summary ? h("div", { className: "dshp-card-summary" }, String(card.summary)) : null,
          paragraphs.map((paragraph, index2) => h("p", { key: index2, className: "dshp-p" }, String(paragraph == null ? "" : paragraph))),
          examples.map((example, index2) => h(
            "div",
            { key: "example-" + index2, className: "dshp-example" },
            h("div", { className: "dshp-example-text" }, String(example && example.text || "")),
            example && example.note ? h("div", { className: "dshp-example-note" }, String(example.note)) : null
          ))
        );
      }
      let poetryTabs = null;
      function ensurePoetryTabs() {
        if (poetryTabs === null) {
          poetryTabs = createPoetryTabs({
            React,
            h,
            EmptyState,
            LoadingState,
            PoemBody,
            AnalysisBody,
            KnowledgeCardView,
            describeDataError,
            normalizeSettings,
            cx,
            switchNode,
            num
          });
        }
        return poetryTabs;
      }
      function TodayTab(props) {
        return ensurePoetryTabs().TodayTab(props);
      }
      function ClassTab(props) {
        return ensurePoetryTabs().ClassTab(props);
      }
      function YunTab(props) {
        return ensurePoetryTabs().YunTab(props);
      }
      function CiTab(props) {
        return ensurePoetryTabs().CiTab(props);
      }
      function PoetrySettingsTab(props) {
        return ensurePoetryTabs().PoetrySettingsTab(props);
      }
      let settingsTabFactory = null;
      function ensureSettingsTab() {
        if (settingsTabFactory === null) {
          settingsTabFactory = createSettingsTab({
            React,
            h,
            cx,
            normalizeSettings,
            num,
            switchNode,
            growthMetricsTree,
            weatherChipText,
            weatherUpdatedLabel,
            moodBasisText,
            moodAiFailureLabel
          });
        }
        return settingsTabFactory;
      }
      function SettingsTab(props) {
        return ensureSettingsTab()(props);
      }
      let growthTabFactory = null;
      function ensureGrowthTab() {
        if (growthTabFactory === null) {
          growthTabFactory = createGrowthTab({
            h,
            cx,
            switchNode,
            growthMetricsTree,
            moodAiFailureLabel,
            selfStatusSummary,
            weatherUpdatedLabel
          });
        }
        return growthTabFactory;
      }
      function GrowthTab(props) {
        return ensureGrowthTab()(props);
      }
      let graphTabFactory = null;
      function ensureGraphTab() {
        if (graphTabFactory === null) {
          graphTabFactory = createGraphTab({ React, h });
        }
        return graphTabFactory;
      }
      function GraphTab(props) {
        return ensureGraphTab()(props);
      }
      let feihuaTabFactory = null;
      function ensureFeihuaTab() {
        if (feihuaTabFactory === null) {
          feihuaTabFactory = createFeihuaTab({
            React,
            h,
            cx,
            EmptyState,
            LoadingState,
            ToneLine,
            detectionRhymeIndexes,
            formatDetectionReport,
            describeDataError,
            getFeihuaIndex,
            pickDefaultFeihuaChar,
            feihuaSourceOf,
            mergeFeihuaItems,
            finishFeihuaIndex,
            mergeFeihuaFullEntries,
            requestFeihuaFull,
            abortFeihuaFull,
            readFeihuaFullCache,
            readFeihuaBest,
            writeFeihuaBest,
            FEIHUA_ATLAS_PAGE,
            FEIHUA_FULL_RETRY_MS
          });
        }
        return feihuaTabFactory;
      }
      function FeihuaTab(props) {
        return ensureFeihuaTab().FeihuaTab(props);
      }
      function DetectionView(props) {
        return ensureFeihuaTab().DetectionView(props);
      }
      let libraryTabFactory = null;
      function ensureLibraryTab() {
        if (libraryTabFactory === null) {
          libraryTabFactory = createLibraryTab({
            React,
            LIBRARY_CATEGORIES,
            h,
            cx,
            EmptyState,
            LoadingState,
            DetectionView,
            ToneLine,
            describeDataError,
            Z_INDEX,
            WIDGET_ID,
            MASCOT_FILES,
            mascotUrl,
            detectPoem,
            detectPoemText,
            parsePoemInput,
            buildPingshuiIndex
          });
        }
        return libraryTabFactory;
      }
      function LibraryTab(props) {
        return ensureLibraryTab().LibraryTab(props);
      }
      function WidgetBoundary(props) {
        const Boundary = ensureLibraryTab().WidgetBoundary;
        return h(Boundary, null, props && props.children);
      }
      function apply(ctx) {
        const host = (props) => h(WidgetBoundary, null, h(PoetryWidget, Object.assign({}, props || {}, { ctx })));
        ctx.slots.inject("shell.overlay", () => ctx.slots.register(
          { name: "shell.overlay", id: WIDGET_ID, order: 80 },
          host
        ));
        try {
          if (ctx.logger && typeof ctx.logger.info === "function") {
            ctx.logger.info("dsh-little-whale: \u5DF2\u6CE8\u518C shell.overlay \u6302\u4EF6");
          }
        } catch (error) {
        }
      }
      return {
        inject: ["slots"],
        apply
      };
    }
  });
})();
