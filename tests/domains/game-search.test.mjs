// tests/domains/game-search.test.mjs —— 互联网搜索结果解析（v0.11.1）
import assert from 'node:assert/strict'
import test from 'node:test'
import { searchWeb } from '../../lib/domain/play/game-learning.mjs'

test('搜索：百度结果解析出标题与摘要，过滤广告词', async () => {
  const html = '<h3><a href="http://www.baidu.com/link?url=x">我的世界 放置方块 教程</a></h3><div class="c-abstract">先站到方块旁边，对准参考面再放置。</div>'
    + '<h3><a href="http://www.baidu.com/link?url=y">文档下载</a></h3><div>广告</div>'
  const fetchImpl = async () => ({ ok: true, text: async () => html })
  const results = await searchWeb('我的世界 放置方块', { fetchImpl })
  assert.equal(results.length, 1)
  assert.match(results[0].title, /放置方块/)
  assert.match(results[0].snippet, /参考面/)
})
