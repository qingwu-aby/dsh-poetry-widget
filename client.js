"use strict";
(() => {
  // client-src/styles.js
  var CSS = [
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
    "animation-iteration-count:1!important;transition-duration:.01ms!important}}"
  ].join("");

  // client-src/client.js
  window.__ModuleLoader__.load({
    id: "dsh-poetry-widget",
    factory: (require2) => {
      "use strict";
      const React = require2("react");
      if (!React || typeof React.createElement !== "function") {
        throw new Error("dsh-poetry-widget: React \u8FD0\u884C\u65F6\u4E0D\u53EF\u7528");
      }
      const h = React.createElement;
      const ROUTE = "/api/dsh-poetry/";
      const SELF_PATH = "self.json";
      const SELF_POLL_MS = 60 * 1e3;
      const ACTION_SEEN_KEY = "dshp-action-seen-v1";
      const MEMORY_PATH = "memory.json";
      const MEMORY_BACKUP_PATH = "memory/backup.json";
      const MEMORY_POLL_MS = 60 * 1e3;
      const ASSET_BASE = ROUTE + "assets?f=";
      const SETTINGS_URL = ROUTE + "settings.json";
      const WIDGET_ID = "dsh-poetry-widget";
      const CACHE_KEY = "dshp.firstscreen.v1";
      const POS_KEY = "dshp.position.v1";
      const BASE_SIZE = 96;
      const MIN_SCALE = 0.6;
      const MAX_SCALE = 1.6;
      const Z_INDEX = 60;
      const FETCH_TIMEOUT_MS = 15e3;
      const SAVE_DEBOUNCE_MS = 450;
      const STEPS = ["\u4ECA\u65E5\u4E00\u8BD7", "\u683C\u5F8B\u89E3\u6790", "\u4ECA\u65E5\u77E5\u8BC6\u5361", "\u58F0\u5F8B\u542F\u8499", "\u8BCD\u724C\u540D\u7BC7", "\u98DE\u82B1\u4EE4"];
      const PANEL_TABS = [
        { id: "growth", label: "\u6210\u957F" },
        { id: "poetry", label: "\u8BD7\u8BCD" },
        { id: "settings", label: "\u8BBE\u7F6E" }
      ];
      const POETRY_TABS = [
        { id: "today", label: "\u4ECA\u65E5" },
        { id: "class", label: "\u8BFE\u5802" },
        { id: "yun", label: "\u97F5\u90E8" },
        { id: "ci", label: "\u8BCD\u724C" },
        { id: "library", label: "\u8BD7\u5E93" },
        { id: "feihua", label: "\u98DE\u82B1" }
      ];
      const FEIHUA_BEST_KEY = "dshp-feihua-best-v1";
      const FEIHUA_CANDIDATE_CHARS = Array.from("\u82B1\u6708\u98CE\u6625\u5C71\u6C34\u4EBA\u5929\u4E91\u96E8\u591C\u79CB\u6C5F\u9152\u767D\u7EA2\u821F\u6101\u68A6\u5FC3\u67F3\u96EA\u971C\u65E5\u661F\u6D77\u7389\u91D1\u957F\u4F55\u4E0D\u65E0");
      const FEIHUA_MIN_ENTRIES = 8;
      const FEIHUA_CANDIDATE_LIMIT = 12;
      const FEIHUA_ATLAS_LIMIT = 200;
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
      const MOOD_SWITCH_MIN_MS = 20 * 60 * 1e3;
      const MOOD_REFRESH_MS = 5 * 60 * 1e3;
      const WINDOW_WANDER_ENABLED = false;
      const WANDER_TICK_MS = 60 * 1e3;
      const WANDER_FIRST_MIN_MS = 45 * 1e3;
      const WANDER_FIRST_MAX_MS = 2 * 60 * 1e3;
      const WANDER_MIN_INTERVAL_MS = 2 * 60 * 1e3;
      const WANDER_MAX_INTERVAL_MS = 5 * 60 * 1e3;
      const WANDER_WALK_MS = 8 * 1e3;
      const WANDER_MIN_DISTANCE = 120;
      const WANDER_INTERACTION_PAUSE_MS = 45 * 1e3;
      const WANDER_MEDIA_PATTERN = /跑|奔|踏步|踱步|走路|跳跃|踢|抛接|伸懒腰|运动|锻炼|健身/;
      const WANDER_STATIC_FILE = "dsh-whale-state-running.webp";
      function pickWanderMedia(entries, random) {
        const list = Array.isArray(entries) ? entries.filter(
          (entry) => entry && typeof entry.file === "string" && isVideoMoodFile(entry.file) && WANDER_MEDIA_PATTERN.test(entry.file)
        ) : [];
        if (list.length === 0) return { file: WANDER_STATIC_FILE, video: false };
        const roll = Number(typeof random === "function" ? random() : Math.random());
        const index = Number.isFinite(roll) ? Math.min(list.length - 1, Math.max(0, Math.floor(roll * list.length))) : 0;
        return { file: list[index].file, video: true };
      }
      const MOOD_TICK_MS = 60 * 1e3;
      const MOOD_AI_PATH = "mood-ai.json";
      const MOOD_AI_TIMEOUT_MS = 35e3;
      const MOOD_AI_DEBOUNCE_MIN_MS = 2e3;
      const MOOD_AI_DEBOUNCE_MAX_MS = 4e3;
      const MOOD_AI_MIN_GAP_MS = 2e4;
      const MOOD_AI_RETRY_MIN_MS = 12e3;
      const MOOD_AI_RETRY_MAX_MS = 25e3;
      const MOOD_AI_KEEP_MS = 30 * 60 * 1e3;
      const MOOD_AI_MAX_RETRIES = 5;
      const MOOD_AI_RECENT_MAX = 3;
      const MOOD_AI_RECENT_IMAGES_MAX = 20;
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
      const MOOD_PANEL_PEEK_FILES = {
        today: "dsh-whale-home-peek.webp",
        settings: "dsh-whale-settings-peek.webp",
        other: "dsh-whale-workbench-peek.webp"
      };
      const MOOD_STRONG = ["tired", "sleepy", "proud"];
      const MOOD_LABELS = Object.freeze({
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
      const MOOD_IMAGES = Object.freeze({
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
      const WEATHER_OVERLAY_STATES = ["rain", "snow", "thunder", "cold", "night"];
      const SPONT_KEY = "dshp-mood-spont-v1";
      const SPONT_POLL_MIN_MS = 60 * 1e3;
      const SPONT_POLL_MAX_MS = 120 * 1e3;
      const SPONT_RETRY_MS = 10 * 1e3;
      const SPONT_EVENT_MIN_MS = 2 * 1e3;
      const SPONT_EVENT_MAX_MS = 5 * 1e3;
      const SPONT_CLOSE_RECHECK_MS = 3 * 1e3;
      const SPONT_QUIET_MS = 3 * 1e3;
      const SPONT_REPEAT_MS = 3 * 24 * 60 * 60 * 1e3;
      const SPONT_SEEN_DAYS = 7 * 24 * 60 * 60 * 1e3;
      const SPONT_MAX_SEEN = 300;
      const SPONT_AUTO_CLOSE_MS = 25e3;
      const SELF_TALK_PATH = "self-talk.json";
      const SELF_TALK_TIMEOUT_MS = 35 * 1e3;
      const SELF_TALK_RECENT_MAX = 12;
      const ASSET_DATA_FILES = { anthology: "data/anthology.json", bank: "data/poems-bank.json", pingshui: "data/pingshui.json", ciBank: "data/ci-bank.json", moodCatalog: "data/mood-catalog.json" };
      const LIBRARY_CATEGORIES = [
        { id: "shijing", label: "\u8BD7\u7ECF" },
        { id: "chuci", label: "\u695A\u8F9E" },
        { id: "qianjiashi", label: "\u5343\u5BB6\u8BD7" },
        { id: "tang300", label: "\u5510\u8BD7\u4E09\u767E\u9996" },
        { id: "bank", label: "\u5168\u5510\u8BD7\u7CBE\u9009" },
        { id: "ci-selected", label: "\u5B8B\u8BCD\u7CBE\u9009" }
      ];
      const LIBRARY_CATEGORY_ALIASES = { \u8BD7\u7ECF: "shijing", \u695A\u8F9E: "chuci", \u5343\u5BB6\u8BD7: "qianjiashi", \u5510\u8BD7\u4E09\u767E\u9996: "tang300", \u5168\u5510\u8BD7\u7CBE\u9009: "bank", \u5B8B\u8BCD\u7CBE\u9009: "ci-selected", \u5B8B\u8BCD\u5168\u5E93: "ci-bank" };
      const LIBRARY_PAGE = 30;
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
        const now = /* @__PURE__ */ new Date();
        return now.getMonth() + 1 + " \u6708 " + now.getDate() + " \u65E5";
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
        let timer = null;
        let pending = null;
        let disposed = false;
        function flush() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
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
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            flush().catch(() => {
            });
          }, delay);
        }
        function dispose() {
          disposed = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
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
          let index = Math.floor(num(random(), 0) * items.length);
          if (!Number.isFinite(index) || index < 0) index = 0;
          if (index >= items.length) index = items.length - 1;
          if (items.length > 1 && items[index].id === currentId) index = (index + 1) % items.length;
          return items[index].id;
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
      function nextWanderTarget(input) {
        const opts = input && typeof input === "object" ? input : {};
        const viewport = opts.viewport && typeof opts.viewport === "object" ? opts.viewport : {};
        const size = Math.max(40, Math.round(num(opts.size, 120)));
        const w = Math.max(size + 40, Math.round(num(viewport.w, 1024)));
        const h2 = Math.max(size + 80, Math.round(num(viewport.h, 768)));
        const margin = 8;
        const minX = margin;
        const maxX = Math.max(minX, w - size - margin);
        const minY = 56;
        const maxY = Math.max(minY, h2 - size - margin);
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
      function completeSentencesFromLines(lines) {
        const text = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? "" : value)).join("").trim();
        if (!text) return [];
        const out = [];
        let start = 0;
        for (let i = 0; i < text.length; i += 1) {
          const ch = text.charAt(i);
          if (ch !== "\u3002" && ch !== "\uFF01" && ch !== "\uFF1F") continue;
          const sentence = text.slice(start, i + 1).trim();
          start = i + 1;
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
      function registerFeihuaLookup(index, entry) {
        if (!index || !entry) return;
        const plain = feihuaPlainOf(entry.text);
        if (!plain) return;
        entry.plain = plain;
        if (!index.byPlain[plain]) index.byPlain[plain] = entry;
        const clauses = String(entry.text).split(/[，、；：,;:]/);
        for (const clause of clauses) {
          const clausePlain = feihuaPlainOf(clause);
          if (clausePlain.length < 2 || index.clauseMap[clausePlain]) continue;
          index.clauseMap[clausePlain] = entry;
        }
      }
      function feihuaLookup(index, input) {
        if (!index || !index.entries) return null;
        const plain = feihuaPlainOf(input);
        if (!plain) return null;
        if (index.clauseMap && index.clauseMap[plain]) return { entry: index.clauseMap[plain], match: "clause" };
        if (index.byPlain && index.byPlain[plain]) return { entry: index.byPlain[plain], match: "sentence" };
        if (plain.length < 5) return null;
        for (const entry of index.entries) {
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
        const index = { entries, byChar, counts, clauseMap: {}, byPlain: {} };
        for (const entry of entries) registerFeihuaLookup(index, entry);
        if (ciBankData) mergeFeihuaItems(index, ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : Array.isArray(ciBankData) ? ciBankData : []);
        return finishFeihuaIndex(index);
      }
      function mergeFeihuaFullEntries(index, char, entries) {
        if (!index || !index.entries || !Array.isArray(entries)) return 0;
        const key = String(char == null ? "" : char);
        if (!key) return 0;
        if (!index.__seen) index.__seen = new Set(index.entries.map((entry) => entry.text));
        if (!index.__plainSeen) {
          index.__plainSeen = /* @__PURE__ */ new Set();
          for (const entry of index.entries) {
            const plain = entry.plain || feihuaPlainOf(entry.text);
            if (plain) index.__plainSeen.add(plain);
          }
        }
        if (!index.__fullMerged) index.__fullMerged = {};
        if (index.__fullMerged[key]) return 0;
        if (!Array.isArray(index.byChar[key])) index.byChar[key] = [];
        index.counts[key] = index.counts[key] || 0;
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
          if (!plain || index.__seen.has(text) || index.__plainSeen.has(plain)) continue;
          index.__seen.add(text);
          index.__plainSeen.add(plain);
          const entry = { text, source, plain };
          index.entries.push(entry);
          registerFeihuaLookup(index, entry);
          index.byChar[key].push(entry);
          index.counts[key] += 1;
          added += 1;
        }
        index.__fullMerged[key] = true;
        finishFeihuaIndex(index);
        return added;
      }
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
        let timer = null;
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
          if (timer) clearTimeout(timer);
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
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            try {
              if (controller) controller.abort();
            } catch (error) {
            }
            resolve({ ok: false, reason: "timeout" });
          }, FEIHUA_FULL_TIMEOUT_MS);
        });
        item.promise = Promise.race([task, timeout, abortPromise]).then(finish);
        feihuaFullInflight[key] = item;
        return item.promise;
      }
      function feihuaSourceOf(item) {
        const author = typeof item.author === "string" ? item.author : "";
        const label = item.title || item.rhythmic || item.rhythm || "";
        const title = typeof label === "string" ? label : "";
        return author && title ? author + "\u300A" + title + "\u300B" : author || title;
      }
      function mergeFeihuaItems(index, items) {
        if (!index || !index.entries) return index;
        if (!index.__seen) index.__seen = new Set(index.entries.map((entry) => entry.text));
        for (const item of Array.isArray(items) ? items : []) {
          if (!item) continue;
          const source = feihuaSourceOf(item);
          for (const text of completeSentencesFromLines(item.lines)) {
            if (!text || !/[。！？]$/.test(text) || index.__seen.has(text)) continue;
            index.__seen.add(text);
            const entry = { text, source };
            index.entries.push(entry);
            registerFeihuaLookup(index, entry);
            for (const char of FEIHUA_CANDIDATE_CHARS) {
              if (text.indexOf(char) >= 0) {
                index.byChar[char].push(entry);
                index.counts[char] = (index.counts[char] || 0) + 1;
              }
            }
          }
        }
        return index;
      }
      function finishFeihuaIndex(index) {
        if (!index || !index.counts) return index;
        const candidates = [];
        for (const char of FEIHUA_CANDIDATE_CHARS) {
          const count = index.counts[char] || 0;
          if (count >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count });
        }
        candidates.sort((a, b) => b.count - a.count || a.char.localeCompare(b.char, "zh"));
        index.candidates = candidates.slice(0, FEIHUA_CANDIDATE_LIMIT);
        return index;
      }
      function getFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
        if (!poemsData || !Array.isArray(poemsData.items)) return null;
        const cached = feihuaIndexCache;
        if (cached.index && cached.poems === poemsData && cached.ci === ciData && cached.anthology === anthologyData && cached.bank === bankData && cached.ciBank === ciBankData) return cached.index;
        const index = buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData);
        feihuaIndexCache = { poems: poemsData, ci: ciData, anthology: anthologyData, bank: bankData, ciBank: ciBankData, index };
        return index;
      }
      function clearFeihuaIndexCache() {
        feihuaIndexCache = { poems: null, ci: null, index: null };
      }
      function pickDefaultFeihuaChar(index, poem) {
        const fallback = "\u82B1";
        if (!index || !Array.isArray(index.candidates) || !index.candidates.length) return fallback;
        const lines = poem && Array.isArray(poem.lines) ? poem.lines : [];
        const text = lines.join("");
        let best = null;
        for (const item of index.candidates) {
          if (!item || item.count <= 0) continue;
          if (text.indexOf(item.char) < 0) continue;
          if (!best || item.count > best.count) best = item;
        }
        return best ? best.char : fallback;
      }
      function feihuaRandomIndex(length, random) {
        if (!length || length <= 0) return 0;
        const value = typeof random === "function" ? Number(random()) : Math.random();
        let index = Math.floor((Number.isFinite(value) ? value : 0) * length);
        if (index < 0) index = 0;
        if (index >= length) index = length - 1;
        return index;
      }
      function feihuaSampleUnique(pool, count, random) {
        const rest = Array.isArray(pool) ? pool.slice() : [];
        const picked = [];
        while (picked.length < count && rest.length) {
          picked.push(rest.splice(feihuaRandomIndex(rest.length, random), 1)[0]);
        }
        return picked;
      }
      function feihuaShuffle(list, random) {
        const out = Array.isArray(list) ? list.slice() : [];
        for (let i = out.length - 1; i > 0; i -= 1) {
          const j = feihuaRandomIndex(i + 1, random);
          const temp = out[i];
          out[i] = out[j];
          out[j] = temp;
        }
        return out;
      }
      function feihuaPickSystem(index, char, usedPlains, random) {
        if (!index || !index.byChar) return null;
        const used = usedPlains instanceof Set ? usedPlains : new Set(Array.isArray(usedPlains) ? usedPlains : []);
        const pool = (index.byChar[char] || []).filter((entry) => !used.has(entry.plain || feihuaPlainOf(entry.text)));
        if (!pool.length) return null;
        return pool[feihuaRandomIndex(pool.length, random)];
      }
      function feihuaStart(index, char, random) {
        const charValue = String(char || "\u82B1");
        const system = feihuaPickSystem(index, charValue, /* @__PURE__ */ new Set(), random);
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
      function feihuaSubmit(state, index, input, random) {
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
        const lookup = feihuaLookup(index, raw);
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
        const system = feihuaPickSystem(index, state.char, nextPlains, random);
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
          out.sort((a, b) => b.hits - a.hits || String(a.id).localeCompare(String(b.id)));
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
        const index = Math.abs(hashString(date + "|" + category + "|" + dataVersion)) % pool.length;
        return pool[index];
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
      const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1e3;
      function shanghaiParts(now) {
        const date = new Date(num(now, Date.now()) + SHANGHAI_OFFSET_MS);
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
        const now = num(signals.now, Date.now());
        const local = shanghaiParts(now);
        const clicks = Math.max(0, Math.floor(num(signals.clicks, 0)));
        const wins = Math.max(0, Math.floor(num(signals.feihuaWins, 0)));
        const minutes = local.minutes;
        const meal = minutes >= 7 * 60 && minutes < 9 * 60 || minutes >= 11 * 60 + 30 && minutes < 13 * 60 || minutes >= 17 * 60 + 30 && minutes < 19 * 60 + 30;
        const night = local.hour >= 23 || local.hour < 6;
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
      function throttleMoodSwitch(previous, next, now, force) {
        const time = num(now, Date.now());
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
      function mealMomentFor(now) {
        const parts = shanghaiParts(num(now, Date.now()));
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
      function normalizeMealState(raw, now) {
        const source = raw && typeof raw === "object" ? raw : {};
        const dateKey = shanghaiParts(num(now, Date.now())).dateKey;
        const sameDay = source.date === dateKey;
        const meals = {};
        const previous = sameDay && source.meals && typeof source.meals === "object" ? source.meals : {};
        for (const meal of ["breakfast", "lunch", "dinner"]) if (previous[meal] === true) meals[meal] = true;
        return { date: dateKey, meals };
      }
      function readMealState(now) {
        const storage = getStorage();
        if (!storage) return normalizeMealState(null, now);
        try {
          const raw = storage.getItem(MEAL_KEY);
          return normalizeMealState(raw ? JSON.parse(raw) : null, now);
        } catch (error) {
          return normalizeMealState(null, now);
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
      function markMealDone(state, meal, now) {
        const base = normalizeMealState(state, now);
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
      function moodBasisText(weather) {
        const label = weather && weather.label ? weather.label : "\u672A\u77E5";
        return "\u5929\u6C14\uFF1A" + label;
      }
      function isVideoMoodFile(file) {
        return /\.webm$/i.test(String(file == null ? "" : file));
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
        let timer = null;
        let abortResolve = null;
        const abortPromise = new Promise((resolve) => {
          abortResolve = () => resolve({ ok: false, entries: [], reason: "aborted" });
        });
        const finish = (result) => {
          if (settled) return result;
          settled = true;
          if (timer) clearTimeout(timer);
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
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
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
        inflight.promise = Promise.race([task, timeout, abortPromise]).then(finish);
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
      function writeMotionRotation(index) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(MOTION_ROTATION_KEY, String(Math.max(0, Math.floor(num(index, 0)))));
        } catch (error) {
        }
      }
      function nextMotionEntry(entries, index) {
        if (!Array.isArray(entries) || !entries.length) return { entry: null, index: 0, size: 0 };
        const size = entries.length;
        const start = Math.max(0, Math.floor(num(index, 0))) % size;
        return { entry: entries[start], index: (start + 1) % size, size, position: start };
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
        const add = (key, value) => {
          if (value == null || value === "") return;
          params.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
        };
        if (opts.force === true) add("force", "1");
        add("mood", opts.moodKey);
        add("weather", opts.weather);
        const recent = (Array.isArray(opts.recent) ? opts.recent : []).map((text) => String(text == null ? "" : text).trim()).filter(Boolean).slice(-MOOD_AI_RECENT_MAX);
        if (recent.length) add("recent", recent.join("|"));
        const imageSeen = {};
        const recentImages = [];
        for (const file of Array.isArray(opts.recentImages) ? opts.recentImages : []) {
          const clean = String(file == null ? "" : file).trim();
          if (!clean || imageSeen[clean]) continue;
          imageSeen[clean] = true;
          recentImages.push(clean);
        }
        if (recentImages.length) add("recentImages", recentImages.slice(-MOOD_AI_RECENT_IMAGES_MAX).join("|"));
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
      function requestMoodAi(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (typeof fetch !== "function") return Promise.resolve({ ok: false, reason: "no-fetch" });
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let timer = null;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
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
        return Promise.race([request, timeout]).then((result) => {
          if (timer) clearTimeout(timer);
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
        const context = Array.isArray(data.context) ? data.context.filter((line) => typeof line === "string" && line.trim().length > 0).slice(0, 6).map((line) => line.trim()) : [];
        return {
          // v1.51：不再有 0–100 的指标；只有她自己写的一句话 + 事实时间线。
          felt: text(data.felt || state.felt, 80),
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
          }
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
      function writeSeenActionId(id) {
        const storage = getStorage();
        if (!storage) return;
        try {
          storage.setItem(ACTION_SEEN_KEY, String(id == null ? "" : id));
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
            const id = String(file.id || "") + " " + String(file.path || "");
            if (!patterns.some((pattern) => id.toLowerCase().indexOf(pattern) >= 0)) continue;
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
            context.map((line, index) => h("div", { className: "dshp-self-context-line", key: "ctx-" + index }, line))
          ) : null,
          h("div", { className: "dshp-self-summary" }, selfStatusSummary(status) || "\u5C1A\u672A\u5F00\u59CB")
        );
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
        const now = num(opts.now, Date.now());
        if (last > 0) {
          const remaining = MOOD_AI_MIN_GAP_MS - (now - last);
          if (remaining > 0) return remaining;
        }
        return nextMoodAiDebounceDelay(opts);
      }
      function moodTimeBucket(now) {
        const parts = shanghaiParts(num(now, Date.now()));
        const hour = parts.hour;
        let period = "night";
        if (hour >= 6 && hour < 11) period = "morning";
        else if (hour >= 11 && hour < 14) period = "noon";
        else if (hour >= 14 && hour < 18) period = "afternoon";
        else if (hour >= 18 && hour < 22) period = "evening";
        const meal = hour === 7 || hour === 8 || hour === 11 || hour === 12 || hour === 17 || hour === 18;
        return period + "|" + (meal ? "meal" : "offmeal");
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
      function normalizeSpontState(raw, now) {
        const src = raw && typeof raw === "object" ? raw : {};
        const dateKey = shanghaiParts(now).dateKey;
        const seen = [];
        if (Array.isArray(src.seenIds)) {
          for (const entry of src.seenIds.slice(-SPONT_MAX_SEEN)) {
            let id = "";
            let at = 0;
            if (typeof entry === "string") id = entry;
            else if (entry && typeof entry === "object" && typeof entry.id === "string") {
              id = entry.id;
              at = num(entry.at, 0);
            }
            if (!id) continue;
            if (at > 0 && now - at > SPONT_SEEN_DAYS) continue;
            seen.push({ id, at });
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
      function readSpontState(now) {
        const storage = getStorage();
        if (!storage) return normalizeSpontState(null, now);
        try {
          const raw = storage.getItem(SPONT_KEY);
          return normalizeSpontState(raw ? JSON.parse(raw) : null, now);
        } catch (error) {
          return normalizeSpontState(null, now);
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
      function recordSpontShown(state, id, now, type, tag) {
        const base = normalizeSpontState(state, now);
        const seen = base.seenIds.filter((entry) => entry.id !== id).concat([{ id: String(id), at: now }]).slice(-SPONT_MAX_SEEN);
        return {
          date: base.date,
          lastShownAt: num(now, Date.now()),
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
        let start = 0;
        for (let i = 0; i < value.length; i += 1) {
          const ch = value.charAt(i);
          if (ch === "\u3002" || ch === "\uFF01" || ch === "\uFF1F") {
            const sentence = value.slice(start, i + 1).trim();
            if (sentence) out.push(sentence);
            start = i + 1;
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
        const index = Math.min(pool.length - 1, Math.max(0, Math.floor(num(typeof random === "function" ? random() : Math.random(), 0) * pool.length)));
        return pool[index].sentence;
      }
      function canShowSpontaneous(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (opts.enabled !== true) return false;
        if (opts.hidden === true || opts.panelOpen === true || opts.bubbleOpen === true || opts.visible === false) return false;
        const now = num(opts.now, Date.now());
        const lastInteraction = num(opts.lastInteractionAt, 0);
        const quietMs = num(opts.quietMs, SPONT_QUIET_MS);
        const idleMs = lastInteraction > 0 ? Math.max(0, now - lastInteraction) : Number.POSITIVE_INFINITY;
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
      function murmurPeriod(hour) {
        if (hour >= 5 && hour < 9) return "\u65E9\u4E0A";
        if (hour >= 9 && hour < 11) return "\u4E0A\u5348";
        if (hour >= 11 && hour < 14) return "\u4E2D\u5348";
        if (hour >= 14 && hour < 18) return "\u4E0B\u5348";
        if (hour >= 18 && hour < 23) return "\u665A\u4E0A";
        return "\u6DF1\u591C";
      }
      function selfTalkKindFor() {
        return "murmur";
      }
      function selfTalkQuery(options) {
        const opts = options && typeof options === "object" ? options : {};
        const params = [];
        const add = (key, value) => {
          if (value == null || value === "") return;
          params.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
        };
        add("kind", "murmur");
        add("mood", opts.moodKey);
        add("moodLabel", opts.moodLabel);
        add("moodReason", opts.moodReason);
        add("image", opts.image);
        add("imageLabel", opts.imageLabel);
        add("weather", opts.weather);
        add("idleMinutes", Math.max(0, Math.floor(num(opts.idleMinutes, 0))));
        const seen = {};
        const recent = [];
        for (const text of Array.isArray(opts.recent) ? opts.recent : []) {
          const clean = String(text == null ? "" : text).trim();
          if (!clean || seen[clean]) continue;
          seen[clean] = true;
          recent.push(clean);
        }
        const recentSlice = recent.slice(-SELF_TALK_RECENT_MAX);
        if (recentSlice.length) add("recent", recentSlice.join("|"));
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
      function requestSelfTalk(options) {
        const opts = options && typeof options === "object" ? options : {};
        if (typeof fetch !== "function") return Promise.resolve({ ok: false, reason: "no-fetch" });
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let timer = null;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
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
        return Promise.race([request, timeout]).then((result) => {
          if (timer) clearTimeout(timer);
          return result;
        });
      }
      function assetUrlFor(kind, version) {
        const file = ASSET_DATA_FILES[kind];
        if (!file) return "";
        return "/api/dsh-poetry/assets?f=" + file + "&v=" + encodeURIComponent(String(version == null ? "" : version));
      }
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
        return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
      }
      function ciBankRhythmics(ciBankData) {
        const map = {};
        for (const item of ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : []) {
          const name = item && item.rhythmic ? String(item.rhythmic) : "";
          if (!name) continue;
          map[name] = (map[name] || 0) + 1;
        }
        return Object.keys(map).map((name) => ({ name, count: map[name] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
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
      function buildPingshuiIndex(raw) {
        const sourceCategories = raw && Array.isArray(raw.categories) ? raw.categories : [];
        const categories = sourceCategories.map((cat, index) => {
          const value = cat && typeof cat === "object" ? cat : {};
          return {
            index,
            name: String(value.name || value.short || "\u97F5\u90E8" + (index + 1)),
            short: String(value.short || value.name || "\u97F5\u90E8" + (index + 1)),
            tone: String(value.tone || "").toLowerCase() === "ping" || value.tone === "\u5E73" ? "\u5E73" : "\u4EC4",
            chars: String(value.chars == null ? "" : value.chars)
          };
        });
        const charMap = {};
        const addChar = (ch, index) => {
          if (!ch) return;
          const list = charMap[ch] || (charMap[ch] = []);
          if (list.indexOf(index) < 0) list.push(index);
        };
        const rawIndex = raw && raw.charIndex && typeof raw.charIndex === "object" ? raw.charIndex : null;
        if (rawIndex) {
          for (const ch of Object.keys(rawIndex)) {
            const arr = Array.isArray(rawIndex[ch]) ? rawIndex[ch] : [];
            for (const index of arr) if (Number.isInteger(index) && categories[index]) addChar(ch, index);
          }
        }
        for (const cat of categories) for (const ch of Array.from(cat.chars)) addChar(ch, cat.index);
        function charInfo(ch) {
          const indices = charMap[ch] || [];
          const cats = indices.map((index) => categories[index]).filter(Boolean);
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
          for (let index = 0; index < lineChars.length; index += 1) {
            const ch = lineChars[index];
            if (isPunctuation(ch)) continue;
            const rawTone = toneChars[index] || "";
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
      function patternForShape(form, start, firstRhyme) {
        const key = start + (firstRhyme ? "\u5165\u97F5" : "\u4E0D\u5165\u97F5");
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
        for (const a of listA) {
          for (const b of listB) {
            if (relation === "dui" ? a !== b : a === b) return true;
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
        for (const start of startOptions) {
          for (const firstRhyme of rhymeOptions) {
            const pattern2 = patternForShape(report.form, start, firstRhyme);
            let violations = 0;
            for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
              for (const position of mandatory) {
                const cell = annotation[lineIndex][position];
                const expected = pattern2[lineIndex] ? pattern2[lineIndex].charAt(position) : "";
                if (!cell || !cell.allowed.length || !expected) continue;
                if (cell.allowed.indexOf(expected) < 0) violations += 1;
              }
            }
            if (!best || violations < best.violations) best = { start, firstRhyme, pattern: pattern2, violations };
          }
        }
        report.start = best.start;
        report.firstRhyme = best.firstRhyme;
        report.meter = best.start + "\u9996\u53E5" + (best.firstRhyme ? "\u5165\u97F5" : "\u4E0D\u5165\u97F5");
        const pattern = best.pattern;
        const rhymeIndexes = [];
        for (let lineIndex = 1; lineIndex < lineCount; lineIndex += 2) rhymeIndexes.push(lineIndex);
        if (best.firstRhyme) rhymeIndexes.unshift(0);
        rhymeIndexes.sort((a, b) => a - b);
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
        for (let index = 0; index < clauses.length; index += 1) {
          if (clauses[index].chars.length !== size) return { error: "\u7B2C " + (index + 1) + " \u53E5\u4E3A " + clauses[index].chars.length + " \u5B57\uFF0C\u4E0E\u524D\u53E5 " + size + " \u5B57\u4E0D\u4E00\u81F4" };
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
        const set = {};
        for (const item of report && report.rhymeLines || []) set[item.line - 1] = true;
        return set;
      }
      function normalizeMascotEggState(raw, now) {
        const source = raw && typeof raw === "object" ? raw : {};
        const dateKey = shanghaiParts(now).dateKey;
        const sameDay = source.date === dateKey;
        return {
          date: dateKey,
          greeted: sameDay ? source.greeted === true : false,
          greetAt: sameDay ? num(source.greetAt, 0) : 0,
          idleAt: num(source.idleAt, 0)
        };
      }
      function readMascotEggState(now) {
        const storage = getStorage();
        if (!storage) return normalizeMascotEggState(null, now);
        try {
          const raw = storage.getItem(MASCOT_EGG_KEY);
          return normalizeMascotEggState(raw ? JSON.parse(raw) : null, now);
        } catch (error) {
          return normalizeMascotEggState(null, now);
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
      function recordMascotEgg(state, patch, now) {
        const base = normalizeMascotEggState(state, now);
        const time = num(now, Date.now());
        return {
          date: base.date,
          greeted: base.greeted || Boolean(patch && patch.greet),
          greetAt: patch && patch.greet ? time : base.greetAt,
          idleAt: patch && patch.idle ? time : base.idleAt
        };
      }
      function shouldShowDailyGreet(state, now) {
        return !normalizeMascotEggState(state, now).greeted;
      }
      function canShowIdlePose(state, now, lastInteractionAt) {
        const normalized = normalizeMascotEggState(state, now);
        const time = num(now, Date.now());
        if (normalized.idleAt > 0 && time - normalized.idleAt < MASCOT_IDLE_MIN_MS) return false;
        const lastInteraction = num(lastInteractionAt, 0);
        if (lastInteraction > 0 && time - lastInteraction < MASCOT_IDLE_USER_MS) return false;
        return true;
      }
      function pickMascotExpression(random) {
        const value = typeof random === "function" ? Number(random()) : Math.random();
        const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0;
        const index = Math.floor(ratio * MASCOT_EXPRESSION_FILES.length);
        return MASCOT_EXPRESSION_FILES[index] || MASCOT_EXPRESSION_FILES[0];
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
      function fetchJson(path, init) {
        return fetchJsonUrl(ROUTE + path, init);
      }
      function fetchJsonUrl(url, init) {
        if (typeof fetch !== "function") return Promise.reject(new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u7F51\u7EDC\u8BF7\u6C42"));
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => {
          try {
            controller.abort();
          } catch (error) {
          }
        }, FETCH_TIMEOUT_MS) : null;
        const options = Object.assign({}, init || {});
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
          if (timer) clearTimeout(timer);
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
        SettingsTab
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
          cells.map((cell, index) => h(
            "span",
            {
              key: index,
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
            text.lines.map((line, index) => h(ToneLine, {
              key: index,
              line,
              tones: Array.isArray(props.poem.tones) ? props.poem.tones[index] : "",
              rhyme: rhymeLines.indexOf(index) >= 0,
              showTones: props.showTones !== false
            }))
          ),
          props.showTones !== false ? h(Legend) : null
        );
      }
      function AnalysisBody(props) {
        const poem = props.poem || {};
        const rhymeLines = poemRhymeLines(poem).map((index) => "\u7B2C " + (index + 1) + " \u53E5");
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
          h("div", { className: "dshp-ci-lines" }, text.lines.map((line, index) => h("div", { key: index }, line)))
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
        const requestModelMood = React.useCallback(() => {
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
          const now = Date.now();
          moodAiRef.current = Object.assign({}, moodAiRef.current, { lastRequestAt: now });
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
            requestModelMood();
          }, Math.max(0, delay));
        }
        const refreshMoodNow = React.useCallback(() => {
          moodForceRef.current = true;
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
          const timer = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            const ui = uiRef.current;
            if (ui.panelOpen || ui.step >= 0 || ui.settings.hidden) return;
            if (mascotExprTimerRef.current) return;
            const now = Date.now();
            const state = readMascotEggState(now);
            if (!canShowIdlePose(state, now, lastInteractionRef.current)) return;
            writeMascotEggState(recordMascotEgg(state, { idle: true }, now));
            showMascotExpression(pickMascotExpression());
          }, MASCOT_IDLE_POLL_MS);
          return () => clearInterval(timer);
        }, []);
        React.useEffect(() => {
          if (!WINDOW_WANDER_ENABLED) return void 0;
          if (settings.hidden) return void 0;
          if (!wanderRef.current.nextAt) {
            wanderRef.current.nextAt = Date.now() + WANDER_FIRST_MIN_MS + Math.random() * (WANDER_FIRST_MAX_MS - WANDER_FIRST_MIN_MS);
          }
          const timer = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            const ui = uiRef.current;
            if (ui.panelOpen || settingsRef.current.hidden) return;
            if (dragRef.current) return;
            const now = Date.now();
            if (now - lastInteractionRef.current < WANDER_INTERACTION_PAUSE_MS) return;
            if (now < wanderRef.current.nextAt) return;
            const size = Math.max(40, Math.round(BASE_SIZE * settingsRef.current.scale));
            const target = nextWanderTarget({
              viewport: { w: readWindowWidth(), h: readWindowHeight() },
              size,
              current: posRef.current
            });
            wanderRef.current.nextAt = now + WANDER_MIN_INTERVAL_MS + Math.random() * (WANDER_MAX_INTERVAL_MS - WANDER_MIN_INTERVAL_MS);
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
            clearInterval(timer);
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
          const timer = setInterval(() => refreshWeather(true), WEATHER_REFRESH_MS);
          return () => clearInterval(timer);
        }, [settings.weatherPoem, settings.mood, settings.weatherCity, refreshWeather]);
        React.useEffect(() => {
          if (!(settings.mood || settings.spontaneousPoem)) return void 0;
          const timer = setInterval(() => setMoodTick((tick) => tick + 1), MOOD_TICK_MS);
          return () => clearInterval(timer);
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
          const findById = (id) => poemItems.find((item) => item && item.id === id);
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
          const timer = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            scheduleMoodAiRefresh();
          }, MOOD_REFRESH_MS);
          return () => clearInterval(timer);
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
          const now = Date.now();
          const last = lastInteractionRef.current;
          const idle = last > 0 && now - last >= 30 * 60 * 1e3;
          if (idle !== moodIdleRef.current) {
            moodIdleRef.current = idle;
            scheduleMoodAiRefresh();
          }
          const bucket = moodTimeBucket(now);
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
          let timer = null;
          const schedule = (delay) => {
            if (timer) clearTimeout(timer);
            if (!cancelled) timer = setTimeout(run, Math.max(1e3, delay));
          };
          const run = () => {
            if (cancelled) return;
            const ui = uiRef.current;
            if (spontPoemRef.current) {
              schedule(SPONT_CLOSE_RECHECK_MS);
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
              schedule(nextSpontPollDelay());
            } else {
              schedule(SPONT_RETRY_MS);
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
          schedule(initialDelay);
          return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
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
          const timer = setTimeout(() => {
            spontReqRef.current += 1;
            setSpontPoem(null);
          }, SPONT_AUTO_CLOSE_MS);
          return () => clearTimeout(timer);
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
          let timer = null;
          const working = buildFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data);
          let offset = 0;
          const CHUNK = 500;
          setFeihuaBuilding(true);
          const run = () => {
            if (cancelled) return;
            mergeFeihuaItems(working, ciBankItemsData.slice(offset, offset + CHUNK));
            offset += CHUNK;
            if (offset < ciBankItemsData.length) {
              timer = setTimeout(run, 0);
            } else {
              finishFeihuaIndex(working);
              setFeihuaIndex(working);
              setFeihuaBuilding(false);
            }
          };
          timer = setTimeout(run, 0);
          return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
          };
        }, [feihuaOpen, poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data, ciBankRes.data, ciBankRes.status]);
        React.useEffect(() => {
          setPos((previous) => {
            const next = anchorPosition(settings.snap, mascotSize, viewport, previous);
            return next.x === previous.x && next.y === previous.y ? previous : next;
          });
        }, [settings.snap, mascotSize, viewport.w, viewport.h]);
        React.useEffect(() => {
          const timer = setTimeout(() => {
            writeStoredPosition({ x: pos.x, y: pos.y, snap: settingsRef.current.snap });
          }, 250);
          return () => clearTimeout(timer);
        }, [pos, settings.snap]);
        React.useEffect(() => {
          const seconds = num(settings.autoplay, 0);
          if (!seconds || step < 0 || panelOpen || settings.hidden) return void 0;
          const timer = setTimeout(() => {
            setStep((current) => current < 0 ? 0 : current >= STEPS.length - 1 ? -1 : current + 1);
          }, seconds * 1e3);
          return () => clearTimeout(timer);
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
          setPanelTab("growth");
        }
        function openPoetryModule() {
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
          const now = Date.now();
          clicksRef.current += 1;
          noteInteraction();
          const eggState = readMascotEggState(now);
          if (shouldShowDailyGreet(eggState, now)) {
            writeMascotEggState(recordMascotEgg(eggState, { greet: true }, now));
            showMascotExpression(MASCOT_EXPRESSION_FILES[0]);
          }
          if (!settingsRef.current.tutorialSeen) updateSettings({ tutorialSeen: true });
          if (panelOpen) {
            setPanelOpen(false);
            return;
          }
          advanceStep();
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
          const now = Date.now();
          const visible = typeof document === "undefined" ? true : document.visibilityState !== "hidden";
          const state = readMealState(now);
          const moment = mealTriggerFor({ now, hidden: settingsRef.current.hidden, panelOpen: uiRef.current.panelOpen, visible, state });
          if (!moment) return;
          writeMealState(markMealDone(state, moment.meal, now));
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
          const nextId = selectNextPoemId({
            items,
            currentId: poem && poem.id,
            todayId: activeTodayPoemId,
            mode: settingsRef.current.mode
          });
          if (!nextId) {
            showToast("\u6682\u65E0\u53EF\u7528\u7684\u8BD7\u7BC7");
            return;
          }
          userPickedPoemRef.current = true;
          setSelectedPoemId(nextId);
          if (settingsRef.current.mode === "random" && nextId !== activeTodayPoemId) {
            saverRef.current.save({ lastPoemId: nextId });
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
          const now = Date.now();
          const state = readSpontState(now);
          const moodKey = ui.moodView && ui.moodView.key && ui.moodView.key !== "ai" ? ui.moodView.key : "calm";
          const preview = opts.preview === true;
          const record = opts.record === true;
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
          const idleMinutes = lastInteractionRef.current > 0 ? Math.max(0, Math.floor((now - lastInteractionRef.current) / 6e4)) : 0;
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
          const index = Math.abs(hashString(dateSeed + "|knowledge")) % cards.length;
          return h(
            "div",
            null,
            h("div", { className: "dshp-card-summary", style: { marginBottom: "6px" } }, "\u4ECA\u65E5\u77E5\u8BC6\u5361 \xB7 \u7B2C " + (index + 1) + " / " + cards.length + " \u5F20"),
            h(KnowledgeCardView, { card: cards[index] })
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
          const index = Math.abs(hashString(dateSeed + "|yun")) % chapters.length;
          const picked = chapters[index];
          const chapter = picked.chapter || {};
          return h(
            "div",
            { className: "dshp-card" },
            h("div", { className: "dshp-card-summary" }, "\u58F0\u5F8B\u542F\u8499 \xB7 " + (picked.volume || "") + " \xB7 \u7B2C " + (index + 1) + " / " + chapters.length + " \u97F5\u90E8"),
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
          const index = Math.abs(hashString(dateSeed + "|ci")) % ciCards.length;
          const card = ciCards[index] || {};
          const ciItems = ciRes.data && Array.isArray(ciRes.data.items) ? ciRes.data.items : [];
          const matched = ciItems.filter((item) => item && item.rhythmic && item.rhythmic === card.name);
          const ci = matched.length ? matched[Math.abs(hashString(dateSeed + "|ciname")) % matched.length] : ciItems.length ? ciItems[Math.abs(hashString(dateSeed + "|ciany")) % ciItems.length] : null;
          const meta = h(
            "div",
            { className: "dshp-card" },
            h("div", { className: "dshp-card-summary" }, "\u8BCD\u724C\u540D\u7BC7 \xB7 \u7B2C " + (index + 1) + " / " + ciCards.length + " \u4E2A\u8BCD\u724C"),
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
          const index = feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, anthologyRes.data, bankRes.data);
          if (!index || !ciRes.data) return h(LoadingState, { text: "\u6B63\u5728\u8F7D\u5165\u98DE\u82B1\u4EE4\u53E5\u5E93\u2026" });
          const char = pickDefaultFeihuaChar(index, poem);
          const count = (index.byChar[char] || []).length;
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
                  STEPS.map((label, index) => h("button", {
                    key: label,
                    type: "button",
                    className: cx("dshp-dot", index === step && "dshp-is-active"),
                    title: label,
                    "aria-label": "\u5207\u6362\u5230\u7B2C " + (index + 1) + " \u5F20\uFF1A" + label,
                    "aria-current": index === step ? "step" : void 0,
                    onClick: (event) => {
                      event.stopPropagation();
                      setStep(index);
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
          const timer = setInterval(() => {
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
            clearInterval(timer);
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
          const timer = setInterval(load, SELF_POLL_MS);
          const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            load();
          };
          if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", onVisibility);
          return () => {
            alive = false;
            clearInterval(timer);
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
          const timer = setInterval(load, MEMORY_POLL_MS);
          const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            load();
          };
          if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", onVisibility);
          return () => {
            alive = false;
            clearInterval(timer);
            if (typeof document !== "undefined" && typeof document.removeEventListener === "function") document.removeEventListener("visibilitychange", onVisibility);
          };
        }, [panelOpen, panelTab, settings.hidden, memoryTick]);
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
              "aria-label": "\u8BD7\u8BCD\u683C\u5F8B\u6302\u4EF6\uFF1A\u70B9\u51FB\u67E5\u770B\u4ECA\u65E5\u4E00\u8BD7\uFF0C\u53EF\u62D6\u52A8",
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
              title: "\u53CC\u51FB\u7A7A\u767D\u5904\u6216\u957F\u6309\u8FD9\u91CC\u6062\u590D\u8BD7\u8BCD\u6302\u4EF6",
              "aria-label": "\u6062\u590D\u8BD7\u8BCD\u6302\u4EF6",
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
            backupMemory,
            refreshMoodNow,
            previewSpontaneousPoem,
            readAnotherSpontaneous,
            recentSpoken: recentSpokenRef.current.slice(-5),
            openPoetryModule,
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
          if (panelTab === "settings") return h(SettingsTab, { api });
          if (panelTab === "poetry") {
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
                h("small", null, "\u81EA\u9A71\u6210\u957F\u4E2D" + (boot.data && boot.data.dataVersion ? " \xB7 \u6570\u636E " + boot.data.dataVersion : ""))
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
              PANEL_TABS.map((tab) => h("button", {
                key: tab.id,
                type: "button",
                role: "tab",
                "aria-selected": panelTab === tab.id,
                className: cx("dshp-tab", panelTab === tab.id && "dshp-is-active"),
                onClick: () => openPanelTab(tab.id)
              }, tab.label))
            ),
            panelTab === "poetry" ? h(
              "div",
              { className: "dshp-subtabs", role: "tablist", "aria-label": "\u8BD7\u8BCD\u6A21\u5757" },
              POETRY_TABS.map((tab) => h("button", {
                key: tab.id,
                type: "button",
                role: "tab",
                "aria-selected": poetryTab === tab.id,
                className: cx("dshp-subtab", poetryTab === tab.id && "dshp-is-active"),
                onClick: () => setPoetryTab(tab.id)
              }, tab.label))
            ) : null,
            h("div", { className: "dshp-panel-body" }, renderPanelTab())
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
        const nodes = [h("style", { key: "dshp-style" }, CSS)];
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
            "data-dsh-poetry-widget": "root",
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
          paragraphs.map((paragraph, index) => h("p", { key: index, className: "dshp-p" }, String(paragraph == null ? "" : paragraph))),
          examples.map((example, index) => h(
            "div",
            { key: "example-" + index, className: "dshp-example" },
            h("div", { className: "dshp-example-text" }, String(example && example.text || "")),
            example && example.note ? h("div", { className: "dshp-example-note" }, String(example.note)) : null
          ))
        );
      }
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
        const index = items.findIndex((item) => item && item.id === poem.id);
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
            h("span", { className: "dshp-pager-label" }, (api.weatherActive ? "\u5929\u6C14\u63A8\u8350" : api.settings.mode === "random" ? "\u968F\u673A" : "\u6BCF\u65E5") + " \xB7 \u7B2C " + Math.max(1, index + 1) + (total ? " / " + total : "") + " \u9996"),
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
        const [index, setIndex] = React.useState(0);
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
        const safeIndex = Math.min(Math.max(0, index), cards.length - 1);
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
                    (Array.isArray(chapter.paragraphs) ? chapter.paragraphs : []).map((paragraph, index) => h("p", { key: index, className: "dshp-p" }, String(paragraph == null ? "" : paragraph))),
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
          return Object.keys(seen).sort((a, b) => a.localeCompare(b, "zh"));
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
            ciCards.map((card, index) => h(
              "div",
              { key: card && card.id || index, className: "dshp-card", style: { padding: "8px 2px", borderBottom: "1px solid var(--dshp-border)" } },
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
              shown.map((ci, index) => {
                const ciId = ci.id || "ci-" + index;
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
        const moodMetaText = [api.moodBasis || moodBasisText(api.weather), moodSourceLabel ? "\u6765\u6E90\uFF1A" + moodSourceLabel : "", moodAt ? "\u66F4\u65B0\u4E8E " + weatherUpdatedLabel(moodAt) : ""].filter(Boolean).join(" \xB7 ");
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
            { className: "dshp-field" },
            h("div", { className: "dshp-field-label" }, h("b", null, "\u6210\u957F\u72B6\u6001"), h("small", null, "\u81EA\u9A71\u6210\u957F \xB7 \u6700\u8FD1\u8FDB\u5EA6")),
            growthMetricsTree(status)
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
                onChange: (event) => update({ scale: num(event.target.value, 100) / 100 })
              }),
              h("span", { className: "dshp-muted", style: { fontSize: "11.5px", width: "38px", textAlign: "right" } }, Math.round(settings.scale * 100) + "%")
            )
          ),
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
                onChange: (event) => update({ autoplay: num(event.target.value, 0) })
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
            h("div", { className: "dshp-field-label" }, h("b", null, "\u663E\u793A\u6587\u5B57"), h("small", null, "\u7B80\u4F53\u6216\u8BD7\u8BCD\u539F\u6587")),
            seg([
              { value: "simplified", label: "\u7B80\u4F53" },
              { value: "original", label: "\u539F\u6587" }
            ], settings.script, (value) => update({ script: value }))
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
            h("div", { className: "dshp-field-label" }, h("b", null, "\u6309\u5929\u6C14\u9009\u8BD7"), h("small", null, "\u4ECA\u65E5\u8BD7\u4E0E\u5F62\u8C61\u8DDF\u968F\u5929\u6C14")),
            switchNode(settings.weatherPoem, () => update({ weatherPoem: !settings.weatherPoem }), "\u6309\u5929\u6C14\u9009\u8BD7\u5F00\u5173")
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
            h("div", null, "\u8BD7\u8BCD\u683C\u5F8B\u6302\u4EF6 v" + String(version)),
            h("div", null, "\u6570\u636E\u7248\u672C\uFF1A" + String(dataVersion)),
            h("div", null, "\u6570\u636E\u6E90\uFF1Achinese-poetry\uFF08MIT\uFF09\xB7 \u8BD7\u8BCD\u4E3A\u516C\u7248\u6587\u672C"),
            source.commit ? h("div", null, "\u6E90\u63D0\u4EA4\uFF1A" + String(source.commit).slice(0, 12)) : null,
            h("div", null, "\u8BBE\u7F6E\u4FDD\u5B58\u5728\u672C\u673A $DSH_HOME/.dsh-poetry/settings.json\uFF1B\u9690\u85CF\u540E\u53CC\u51FB\u9875\u9762\u7A7A\u767D\u5904\u6216\u957F\u6309\u89D2\u843D\u5C0F\u5706\u70B9\u6062\u590D\u3002")
          )
        );
      }
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
        const moodFailureText = api.moodAiFailure ? moodAiFailureLabel(api.moodAiFailure) + (api.moodAiFailureCode ? "\uFF08" + String(api.moodAiFailureCode).slice(0, 48) + "\uFF09" : "") : "";
        const memoryLabels = { ok: "\u5065\u5EB7", warn: "\u6CE8\u610F", error: "\u5F02\u5E38" };
        const recentActions = status && status.actions && Array.isArray(status.actions.recent) ? status.actions.recent.slice(0, 5) : [];
        return h(
          "div",
          { className: "dshp-growth" },
          h("div", { className: "dshp-growth-title" }, "\u6211\u7684\u6210\u957F"),
          h(
            "div",
            { className: "dshp-growth-mood" },
            h("div", { className: "dshp-growth-mood-label" }, mood && mood.label ? mood.label : "\u8FD8\u6CA1\u5F62\u6210\u5FC3\u60C5"),
            mood && mood.reason ? h("div", { className: "dshp-growth-mood-reason" }, String(mood.reason)) : null,
            moodSourceLabel ? h("div", { className: "dshp-growth-mood-source" }, "\u6765\u6E90\uFF1A" + moodSourceLabel) : null,
            api.moodAiFallback ? h("div", { className: "dshp-growth-mood-note" }, "\u5F53\u524D\u4F7F\u7528\u672C\u5730\u9762\u90E8\u8868\u60C5\uFF08\u6A21\u578B\u5FC3\u60C5\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000\u542F\u53D1\u5F0F\uFF09") : null,
            api.moodAiStale ? h("div", { className: "dshp-growth-mood-note" }, "\u6A21\u578B\u5FC3\u60C5\u6682\u65F6\u4E0D\u53EF\u7528\uFF08" + moodAiFailureLabel(api.moodAiFailure) + (api.moodAiFailureCode ? "\uFF0C" + String(api.moodAiFailureCode).slice(0, 48) : "") + "\uFF09\uFF0C\u4FDD\u7559\u4E0A\u4E00\u6B21\uFF0C\u7A0D\u540E\u91CD\u8BD5") : null,
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
          h(
            "div",
            { className: "dshp-growth-section" },
            h("div", { className: "dshp-growth-section-head" }, "\u81EA\u4E3B\u884C\u4E3A"),
            recentActions.length ? recentActions.map((item, index) => h(
              "div",
              { className: "dshp-growth-action", key: "action-" + (item.id || index) },
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
          h(
            "div",
            { className: "dshp-growth-section" },
            h("div", { className: "dshp-growth-section-head" }, "\u6700\u8FD1\u8BF4\u8FC7\u7684\u8BDD"),
            recent.length ? recent.map((text, index) => h("div", { className: "dshp-growth-quote", key: "recent-" + index }, "\u300C" + String(text) + "\u300D")) : h("div", { className: "dshp-growth-empty" }, "\u8FD8\u6CA1\u5F00\u53E3")
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
            h("button", { type: "button", className: "dshp-btn", onClick: () => {
              if (api.openPoetryModule) api.openPoetryModule();
            } }, "\u8BD7\u8BCD\u6A21\u5757"),
            h("button", { type: "button", className: "dshp-btn", onClick: () => {
              if (api.openSettings) api.openSettings();
            } }, "\u8BBE\u7F6E")
          )
        );
      }
      function FeihuaTab(props) {
        const api = props.api || {};
        const poemsRes = api.poemsRes || {};
        const ciRes = api.ciRes || {};
        const index = api.feihuaIndex || getFeihuaIndex(poemsRes.data, ciRes.data, api.anthologyRes && api.anthologyRes.data, api.bankRes && api.bankRes.data);
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
        const activeChar = index ? char || pickDefaultFeihuaChar(index, api.poem) : null;
        React.useEffect(() => {
          if (!index || !activeChar) return;
          if (launch > 0 && launch !== launchRef.current) {
            launchRef.current = launch;
            setGame(feihuaStart(index, activeChar));
            setMode("chain");
            if (typeof api.consumeFeihuaLaunch === "function") api.consumeFeihuaLaunch();
          }
        }, [launch, index, activeChar]);
        const [fullInfo, setFullInfo] = React.useState({ char: "", status: "idle", count: 0 });
        const fullTokenRef = React.useRef(0);
        React.useEffect(() => {
          if (!index || !activeChar) return void 0;
          const target = activeChar;
          const cached = readFeihuaFullCache(target);
          if (cached && cached.status === "ready") {
            mergeFeihuaFullEntries(index, target, cached.entries);
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
              mergeFeihuaFullEntries(index, target, result.entries);
              setFullInfo({ char: target, status: "ready", count: result.count || result.entries.length });
            } else {
              setFullInfo({ char: target, status: "error", count: 0 });
            }
          });
          return () => {
            fullTokenRef.current += 1;
            abortFeihuaFull(target);
          };
        }, [activeChar, index]);
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
        if (!index || !index.entries.length) {
          return h(EmptyState, { title: "\u98DE\u82B1\u4EE4\u53E5\u5E93\u4E3A\u7A7A", message: "\u8BD7/\u8BCD\u6570\u636E\u91CC\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u53E5\u5B50\u3002", icon: "\u{1FAB6}" });
        }
        const candidateChips = index.candidates.slice();
        if (!candidateChips.some((item) => item.char === activeChar)) {
          candidateChips.unshift({ char: activeChar, count: index.counts[activeChar] || 0 });
        }
        const charEntries = index.byChar[activeChar] || [];
        const bestForChar = best.chars[activeChar] || 0;
        function startGame(target) {
          const use = target || activeChar;
          if (!index || !use) return;
          setChar(use);
          setInputText("");
          setGame(feihuaStart(index, use));
          setMode("chain");
          setAtlasLimit(FEIHUA_ATLAS_PAGE);
          const cachedFull = readFeihuaFullCache(use);
          if (!cachedFull || cachedFull.status !== "ready") {
            const token = fullTokenRef.current + 1;
            fullTokenRef.current = token;
            requestFeihuaFull(use).then((result) => {
              if (token !== fullTokenRef.current) return;
              if (result && result.ok && Array.isArray(result.entries)) {
                mergeFeihuaFullEntries(index, use, result.entries);
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
          if (!index || !index.candidates.length) return;
          const pool = index.candidates.filter((item) => item.char !== activeChar);
          const picked = pool.length ? pool[feihuaRandomIndex(pool.length)] : index.candidates[0];
          chooseChar(picked.char);
        }
        function submitAnswer() {
          if (!game || game.phase !== "playing") return;
          const next = feihuaSubmit(game, index, inputText);
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
          const timer = setTimeout(() => setDebounced(query), 300);
          return () => clearTimeout(timer);
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
          for (const index of rhymeIndexes) rhymeSet[index] = true;
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
            detail.tones ? h("div", { className: "dshp-lib-lines" }, rows) : h("div", { className: "dshp-lib-plain" }, lines.map((line, index) => h("div", { key: index }, line))),
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
            console.warn("[dsh-poetry-widget] \u6E32\u67D3\u5F02\u5E38\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u6700\u5C0F\u5F62\u8C61\uFF1A", error);
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
              "data-dsh-poetry-widget": "root",
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
              alt: "\u8BD7\u8BCD\u683C\u5F8B\u6302\u4EF6",
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
      function apply(ctx) {
        const host = (props) => h(WidgetBoundary, null, h(PoetryWidget, Object.assign({}, props || {}, { ctx })));
        ctx.slots.inject("shell.overlay", () => ctx.slots.register(
          { name: "shell.overlay", id: WIDGET_ID, order: 80 },
          host
        ));
        try {
          if (ctx.logger && typeof ctx.logger.info === "function") {
            ctx.logger.info("dsh-poetry-widget: \u5DF2\u6CE8\u518C shell.overlay \u6302\u4EF6");
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
