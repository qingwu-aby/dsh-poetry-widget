// client-src/widget/view/steps/yun-step.js —— 气泡第 4 张：声律启蒙韵部。
import { h } from '../../runtime.js'
import { EmptyState, LoadingState } from '../primitives.js'
import { describeDataError, hashString } from '../../models/utils.js'

  export function YunStep(props) {
  const { yunRes, reloadYun, dateSeed } = props
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

