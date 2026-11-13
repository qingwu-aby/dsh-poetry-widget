// client-src/widget/view/mascot-view.js —— 形象舞台：立绘/动画切换、晕眩星星、饭点气泡入口。
import { h } from '../runtime.js'
import { isVideoMoodFile } from '../../base.js'
import { WANDER_STATIC_FILE } from '../../wander.js'
import { panelPeekFile } from '../../mood-engine.js'
import { cx } from '../models/utils.js'
import { MASCOT_EXPRESSION_FILES, MASCOT_FILES } from '../models/constants.js'
import { mascotFileFor, mascotFilePriority, mascotImageFor, mascotStateFor, mascotUrl, petMediaUrl } from '../models/mascot-model.js'

  export function MascotView(props) {
  const { settings, step, panelOpen, moodView, mascotExpression, moodCatalog, panelTab, poetryTab, dizzy, mealActive, motionFile, wanderFile, failedMascot, noteInteraction, showMascotExpression, pickMascotExpression, setStep, handleMascotKeyDown, openPanel, mascotVideoRef, handleMascotMediaError, weather, mascotPulse, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = props
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
   const panelFile = panelOpen ? panelPeekFile(moodCatalog, panelTab === 'poetry' ? poetryTab : panelTab) : ''
   const dizzyFile = dizzy && dizzy.file ? dizzy.file : ''
   const mealFile = mealActive && mealActive.file ? mealActive.file : ''
   const motionVideoFile = motionFile && isVideoMoodFile(motionFile) ? motionFile : ''
   const wanderMediaFile = wanderFile && (isVideoMoodFile(wanderFile) || wanderFile === WANDER_STATIC_FILE) ? wanderFile : ''
   const stateKey = pulseFile ? mascotPulse : panelFile ? 'peek:' + panelTab : dizzyFile ? 'dizzy:' + dizzyFile : mealFile ? 'meal:' + mealFile : expressionFile ? 'egg:' + expressionFile : wanderMediaFile ? 'wander:' + wanderMediaFile : motionVideoFile ? 'motion:' + motionVideoFile : imageInfo.stateKey
   const desiredFile = mascotFilePriority({ pulseFile, panelFile, dizzyFile, mealFile, expressionFile, wanderFile: wanderMediaFile, motionFile: motionVideoFile, moodFile: imageInfo.file })
   const mascotFile = failedMascot && failedMascot === desiredFile ? MASCOT_FILES.celebrate : desiredFile
   return h(
    'div',
    {
    key: 'mascot',
    className: cx('dshp-stage', dizzy && 'dshp-dizzy'),
    role: 'button',
    tabIndex: 0,
    'aria-label': '小鲸鱼：点击看看她，可拖动',
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

