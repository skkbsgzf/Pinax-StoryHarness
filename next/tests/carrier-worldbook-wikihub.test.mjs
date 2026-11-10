import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorldbookEntryFile } from '@pinax/core/domain/worldbookFileContract'
import { buildWikihub, readWorldbookEntries } from '../wikihub/build.mjs'
import { worldbookToHub } from '../wikihub/convert.mjs'
import { prepareHubModel, renderHubHtml } from '../wikihub/render.mjs'

/**
 * W2：世界书离线 wiki 的合同测试（不含外壳、不起 Electron）。
 *
 * 它钉的是「生成出来的那一页 HTML 本身」：
 *   1) 自闭环：单文件、零外链、零外部字体、零 fetch——断网双击就能读；
 *   2) 站内闭环：条目名／别名／relations／@《…》 都是 #/e/<id> 蓝链，且每个目标都在快照里；
 *   3) 视觉：只用 Pinax Next 的字号五档／圆角刻度／老前端调色板，暗色可切；
 *   4) 往返：页面上的条目与世界书载体转出来的 hub 逐条对得上（不另造一份数据）；
 *   5) 生成管线：世界书/ → hub.json + index.html，裸 md 与第二层目录如实记账。
 */

const KEMIAO_MD = [
  '---',
  'schemaVersion: 1',
  'id: k-001',
  'title: 柯秒',
  'name: 柯秒',
  'kind: character',
  'type: character',
  'status: active',
  'tags: [主角, 停摆的表]',
  'cat: [角色]',
  'keys: [秒子, 小柯]',
  'summary: 修表匠，袖口的表停在十二点差三分。',
  'relations:',
  '  - to: l-001',
  '    type: ally',
  '    stance: 信任',
  '    weight: 3',
  '---',
  '柯秒是城南的修表匠，别人叫他秒子，常去 @《旧钟楼》。',
  '',
  '**袖口停表**，话少。',
  '',
  '| 项 | 值 |',
  '| --- | --- |',
  '| 年龄 | 27 |',
  '',
  '外部资料：[参考](https://example.com/kemiao) 不随快照走。',
  '',
  '<script>alert("raw-html")</script>'
].join('\n')

const TOWER_MD = [
  '---',
  'schemaVersion: 1',
  'id: l-001',
  'title: 旧钟楼',
  'name: 旧钟楼',
  'kind: location',
  'type: location',
  'tags: [地标]',
  'cat: [地点]',
  'keys: [钟楼, 旧塔]',
  'summary: 城北的钟楼。',
  '---',
  '旧钟楼在城北。钟楼见 @《柯秒》，也见秒子。'
].join('\n')

const STRAY_MD = [
  '---',
  'schemaVersion: 1',
  'id: s-001',
  'title: 流浪者',
  'name: 流浪者',
  'kind: general',
  'type: general',
  'summary: 身份不明的过客。',
  'relations:',
  '  - to: 失踪的人',
  '    type: mystery',
  '---',
  '没人知道流浪者从哪里来。'
].join('\n')

function contractEntry(md, path) {
  const parsed = parseWorldbookEntryFile(md)
  assert.equal(parsed.ok, true, JSON.stringify(parsed.error ?? {}))
  return { ...parsed.entry, contract: true, ...(path ? { path } : {}) }
}

const ENTRIES = [
  contractEntry(KEMIAO_MD, '世界书/人物/人物·柯秒.md'),
  contractEntry(TOWER_MD, '世界书/设定/设定·旧钟楼.md'),
  contractEntry(STRAY_MD, '世界书/设定/设定·流浪者.md')
]
const HUB = worldbookToHub(ENTRIES, { book: '表匠', domain: '表匠' })
const GENERATED_AT = '2026-11-09T00:00:00.000Z'

function htmlOf(hub = HUB, options = {}) {
  return renderHubHtml(hub, { book: '表匠', generatedAt: GENERATED_AT, ...options })
}

function embeddedData(html) {
  const match = /<script type="application\/json" id="wikihub-data">([\s\S]*?)<\/script>/u.exec(html)
  assert.ok(match, '页面里应有 wikihub-data 的 JSON 快照')
  return JSON.parse(match[1])
}

function articleOf(html, id) {
  const marker = html.indexOf(`data-entry="${id}"`)
  assert.ok(marker >= 0, `找不到条目 ${id} 的 article`)
  const start = html.lastIndexOf('<article', marker)
  const end = html.indexOf('</article>', marker)
  assert.ok(start >= 0 && end > start)
  return html.slice(start, end + '</article>'.length)
}

function tokenBlock(html, selector) {
  const start = html.indexOf(selector)
  assert.ok(start >= 0, `样式里缺少 ${selector}`)
  const open = html.indexOf('{', start)
  const close = html.indexOf('}', open)
  return html.slice(open, close)
}

test('自闭环：单文件、零外链、零外部字体、零 fetch', () => {
  const html = htmlOf()
  assert.match(html, /^<!doctype html>/u)
  assert.equal((html.match(/<style>/gu) ?? []).length, 1, '样式只应有一份内联 <style>')
  assert.ok(html.includes('<script type="application/json" id="wikihub-data">'))
  assert.ok(html.includes("addEventListener('hashchange', route)"), '跳转靠哈希路由，不依赖服务')

  const forbidden = [
    [/<link\b/iu, '外链样式'],
    [/@import/iu, 'CSS @import'],
    [/<script[^>]+\bsrc\s*=/iu, '外部脚本'],
    [/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu, '外站 URL 属性'],
    [/url\(\s*['"]?(?:https?:)?\/\//iu, '外站 URL 资源'],
    [/\bfetch\s*\(/u, 'fetch'],
    [/XMLHttpRequest/u, 'XMLHttpRequest'],
    [/<img\b/iu, '图片（快照不引外部图）']
  ]
  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(html, pattern, `离线快照不许出现${label}`)
  }
})

test('站内闭环：名称／别名／relations／@《…》 全部是蓝链，且目标都在快照里', () => {
  const html = htmlOf()
  const data = embeddedData(html)
  const ids = new Set(data.entries.map((entry) => entry.id))
  const keMiao = data.entries.find((entry) => entry.name === '柯秒')
  const tower = data.entries.find((entry) => entry.name === '旧钟楼')
  assert.ok(keMiao && tower)

  const targetIds = [...html.matchAll(/data-entry-link="([^"]+)"/gu)].map((match) => match[1])
  assert.ok(targetIds.length >= data.entries.length, '每个条目至少有一条索引蓝链')
  for (const id of targetIds) assert.ok(ids.has(id), `蓝链指向了快照外的 id：${id}`)

  const hrefIds = [...html.matchAll(/href="#\/e\/([^"]+)"/gu)].map((match) => match[1])
  for (const id of hrefIds) assert.ok(ids.has(id), `href 指向了快照外的 id：${id}`)

  const keMiaoArticle = articleOf(html, keMiao.id)
  assert.ok(
    keMiaoArticle.includes(`data-relation-to="${tower.id}"`),
    'relations 的目标应收敛成站内蓝链'
  )
  assert.match(keMiaoArticle, /data-ref-token="1">@《旧钟楼》<\/a>/u, '正文里的 @《…》 应变成蓝链')
  assert.ok(
    new RegExp(`<a class="wl" href="#/e/${keMiao.id}"[^>]*>秒子</a>`, 'u').test(keMiaoArticle),
    '别名「秒子」应作为蓝链出现'
  )

  const stray = data.entries.find((entry) => entry.name === '流浪者')
  const strayArticle = articleOf(html, stray.id)
  assert.match(strayArticle, /class="wl wl-missing"[^>]*>失踪的人</u, '未收录的关系目标如实标灰，不造死链')
  assert.doesNotMatch(strayArticle, /href="#\/e\/"[^>]*>失踪的人/u)
})

test('Infobox：右上信息卡逐字段来自 hub 数据', () => {
  const html = htmlOf()
  const keMiao = embeddedData(html).entries.find((entry) => entry.name === '柯秒')
  const article = articleOf(html, keMiao.id)

  assert.match(article, /<aside class="infobox" data-infobox="[^"]+">/u)
  const fields = ['name', 'alias', 'slot', 'domain', 'type', 'status', 'tags', 'source', 'chars', 'relations']
  for (const field of fields) {
    assert.match(article, new RegExp(`data-ib="${field}"`, 'u'), `Infobox 缺字段 ${field}`)
  }
  assert.match(article, /data-ib="alias"><th scope="row">别名<\/th><td>秒子、小柯<\/td>/u)
  assert.match(article, /data-ib="type"><th scope="row">类型<\/th><td>character<\/td>/u)
  assert.match(article, /data-ib="source"><th scope="row">来源<\/th><td>/u)
  assert.match(article, /data-ib="relations"><th scope="row">关系<\/th><td>1 条<\/td>/u)
  assert.match(article, /data-ib="slot"><th scope="row">分类<\/th><td>身份与角色<\/td>/u)
})

test('视觉：字号五档／圆角刻度／老前端主题色与暗色都在', () => {
  const html = htmlOf()
  for (const token of ['--nx-fs-2xs: 11px', '--nx-fs-md: 13px', '--nx-fs-lg: 15px', '--nx-fs-xl: 17px', '--nx-fs-2xl: 19px']) {
    assert.ok(html.includes(token), `字号刻度缺 ${token}`)
  }
  for (const token of ['--nx-radius-xs: 6px', '--nx-radius-pill: 999px', '--radius-control: 10px', '--radius-popover: 16px']) {
    assert.ok(html.includes(token), `圆角刻度缺 ${token}`)
  }
  assert.ok(html.includes('--font-interface:'), '字体须走老前端的 --font-interface')
  assert.match(tokenBlock(html, ':root {'), /--archive-olive: #0078d4;/u, '亮色主题色应来自老前端调色板')
  assert.match(tokenBlock(html, 'html[data-theme="dark"] {'), /--archive-olive: #96b1c6;/u, '暗色主题色应来自老前端调色板')
  assert.match(tokenBlock(html, 'html[data-theme="dark"] {'), /--archive-paper: #131314;/u)
  assert.ok(html.includes('@media (prefers-color-scheme: dark)'), '跟随系统暗色')

  const style = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1] ?? ''
  assert.doesNotMatch(style, /font-size:\s*\d/iu, '字号不许写裸 px，只走 --nx-fs-* 五档')
  assert.doesNotMatch(style, /border-radius:\s*\d+px/iu, '圆角不许写裸 px，只走刻度')
})

test('往返一致：页面条目与世界书 hub 逐条对得上（id／名称／槽位）', () => {
  const html = htmlOf()
  const data = embeddedData(html)
  assert.equal(HUB.ok, true)
  const signature = (entries) => entries
    .map((entry) => [entry.id, entry.name, entry.layer, entry.slot])
    .sort((a, b) => a[0].localeCompare(b[0]))
  assert.deepEqual(signature(data.entries), signature(HUB.entries))
  const articleIds = [...html.matchAll(/<article class="wiki-entry"[^>]*data-entry="([^"]+)"/gu)].map((match) => match[1])
  assert.equal(articleIds.length, HUB.entries.length, '每条 hub 条目都应有一块 article')
  assert.deepEqual(new Set(articleIds), new Set(HUB.entries.map((entry) => entry.id)))
})

test('原始 HTML 不生效：正文与名称只按文本渲染', () => {
  const html = htmlOf()
  assert.ok(html.includes('&lt;script&gt;alert(&quot;raw-html&quot;)&lt;/script&gt;'))
  assert.doesNotMatch(html, /<script>alert\("raw-html"\)<\/script>/u)

  const nastyHub = {
    entries: [{
      id: 'bad000000001',
      layer: 'worldview',
      name: '<b>坏名字</b>',
      slot: 'other',
      definition: '<img src=x onerror=alert(1)>',
      next: { worldbook: { content: '<iframe src="https://evil.example"></iframe>' } }
    }]
  }
  const nasty = renderHubHtml(nastyHub, { book: '<书名>', generatedAt: GENERATED_AT })
  assert.ok(nasty.includes('&lt;b&gt;坏名字&lt;/b&gt;'))
  assert.doesNotMatch(nasty, /<b>坏名字<\/b>/u)
  assert.doesNotMatch(nasty, /<img src=x/iu)
  assert.doesNotMatch(nasty, /<iframe/iu)
  assert.ok(nasty.includes('&lt;书名&gt;'))
})

test('视图侧记账：缺 id／未知槽位／重 id／歧义别名不静默', () => {
  const model = prepareHubModel({ entries: [
    { layer: 'worldview', name: '无号条目', slot: '不存在的槽位', definition: 'x' },
    { id: 'dup000000001', layer: 'worldview', name: '甲', slot: 'roles', aliases: ['同名'], definition: 'x' },
    { id: 'dup000000002', layer: 'worldview', name: '乙', slot: 'roles', aliases: ['同名'], definition: 'x' },
    { id: 'uniq00000001', layer: 'worldview', name: '丙', slot: 'roles', aliases: ['唯一'], definition: 'x' },
    { id: 'uniq00000001', layer: 'worldview', name: '丁', slot: 'roles', definition: 'x' }
  ] })
  const codes = model.warnings.map((warning) => warning.code)
  assert.ok(codes.includes('MISSING_ID'))
  assert.ok(codes.includes('UNKNOWN_SLOT'))
  assert.ok(codes.includes('DUPLICATE_ID'))
  assert.equal(model.entries.length, 4, '重 id 的条目只画第一条')
  assert.ok(model.linkIndex.has('唯一'), '唯一别名可以建蓝链')
  assert.ok(!model.linkIndex.has('同名'), '有歧义的别名宁可不链')
})

test('生成管线：世界书/ → hub.json + index.html，裸 md 与第二层目录如实记账', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wikihub-build-'))
  await mkdir(join(root, '.pinax'), { recursive: true })
  await mkdir(join(root, '世界书', '人物'), { recursive: true })
  await mkdir(join(root, '世界书', '设定', '第二层'), { recursive: true })
  await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify({ name: '表匠' }), 'utf8')
  await writeFile(join(root, '世界书', '人物', '人物·柯秒.md'), KEMIAO_MD, 'utf8')
  await writeFile(join(root, '世界书', '设定', '设定·旧钟楼.md'), TOWER_MD, 'utf8')
  await writeFile(join(root, '世界书', '设定', '裸文.md'), '没有 frontmatter 的整篇正文。', 'utf8')
  await writeFile(join(root, '世界书', '设定', '第二层', '不收录.md'), '更深一层不猜', 'utf8')

  const result = await buildWikihub({ projectRoot: root, generatedAt: GENERATED_AT })
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.equal(result.book, '表匠', '书名取 .pinax/project.json 的 name')
  assert.equal(result.entries, 3, '顶层与一级类别目录的 md 都收，裸 md 也收')
  assert.deepEqual(result.skippedDirs, ['世界书/设定/第二层'])
  assert.ok(result.losses.some((loss) => loss.code === 'worldbook-frontmatter-unavailable'), '裸 md 的丢失要记账')
  assert.equal((await stat(result.indexFile)).isFile(), true)
  assert.equal((await stat(result.hubFile)).isFile(), true)

  const html = await readFile(result.indexFile, 'utf8')
  assert.ok(html.includes('柯秒') && html.includes('旧钟楼') && html.includes('裸文'))
  assert.ok(html.includes('第二层目录'))

  const hub = JSON.parse(await readFile(result.hubFile, 'utf8'))
  assert.equal(hub.entries.length, result.entries)
  assert.equal(hub.generatedAt, GENERATED_AT)
  assert.ok(hub.index.nameToId['柯秒'])

  const read = await readWorldbookEntries(root)
  assert.equal(read.ok, true)
  assert.deepEqual(read.files.sort(), ['人物/人物·柯秒.md', '设定/设定·旧钟楼.md', '设定/裸文.md'].sort())
})

test('生成管线：没有世界书/ 时如实报缺（不写空页）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wikihub-empty-'))
  const result = await buildWikihub({ projectRoot: root })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'WORLDBOOK_DIR_MISSING')
  await assert.rejects(stat(join(root, '.pinax', 'wikihub', 'index.html')))
})
