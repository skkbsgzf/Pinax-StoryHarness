import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FLOATING_GEOMETRY,
  DEFAULT_FORM,
  DEFAULT_GROUP,
  FLOATING_CASCADE_STEP,
  GEOMETRY_MAX_W,
  GEOMETRY_MIN_W,
  PAGE_FORMS,
  PAGE_GROUPS,
  WORKSPACE_VERSION,
  createWorkspaceStore,
  defaultEntry,
  instanceIdFor,
  isPageForm,
  isPageGroup,
  migrateV1Entry,
  migrateV2Entry,
  normalizeEntry,
  normalizeGeometry,
  normalizeResource,
  normalizeViewState,
  normalizeLastOpenFiles,
  normalizeWorkspace,
  LAST_OPEN_FILES_LIMIT,
  parseInstanceId,
  pushRecentFile,
  repairActive
} from '../shell/workspace.mjs'
import { migrateLegacyWorkspace, readLegacyWorkspace } from '../shell/workspaceMigration.mjs'
import { createFileWorkspaceStore, workspacePath } from '../workspaceStore.mjs'

/**
 * 工作区页状态单测（批次61 · v3）。
 * 纯 node:test：workspace.mjs 不 import Vue、不碰 localStorage，状态机与 v1／v2→v3 迁移都能直接测；
 * 磁盘层（workspaceStore.mjs）用临时目录，测坏文件回落、「内容没变不写」与旧档放行。
 *
 * 断言写的就是这一批的规格本身：缺省落点＝切页（不是弹窗）、分屏＝页组的存在、
 * 浮窗只有显式到达、每页一份文档（resource）。
 */

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    dump() {
      return Object.fromEntries(map)
    }
  }
}

test('实例 id：<paneId>#<n>；不带 # 的旧写法当 #1，越界与非法名拒绝', () => {
  assert.equal(instanceIdFor('outline.tree'), 'outline.tree#1')
  assert.equal(instanceIdFor('outline.tree', 2), 'outline.tree#2')
  assert.equal(instanceIdFor('', 1), '')
  assert.deepEqual(parseInstanceId('outline.tree#3'), { pane: 'outline.tree', index: 3, id: 'outline.tree#3' })
  assert.deepEqual(parseInstanceId('outline.tree'), { pane: 'outline.tree', index: 1, id: 'outline.tree#1' })
  assert.equal(parseInstanceId('outline.tree#0'), null)
  assert.equal(parseInstanceId('outline.tree#100'), null)
  assert.equal(parseInstanceId('正文#1'), null)
})

test('v3 词表：页组两档 main／side，形态三档 page／floating／tab，缺省是页', () => {
  assert.deepEqual([...PAGE_GROUPS], ['main', 'side'])
  assert.deepEqual([...PAGE_FORMS], ['page', 'floating', 'tab'])
  assert.equal(DEFAULT_GROUP, 'main')
  assert.equal(DEFAULT_FORM, 'page')
  for (const group of PAGE_GROUPS) assert.equal(isPageGroup(group), true)
  for (const form of PAGE_FORMS) assert.equal(isPageForm(form), true)
  assert.equal(isPageGroup('center'), false)
  assert.equal(isPageForm('dock'), false, '旧位置词表不等于 v3 形态词表')
  assert.equal(isPageForm('bubble'), false, '气泡不是第五种形态（批次45 已裁）')
})

test('开页＝记录存在，且缺省落主组当前页：页态天然没有矩形', () => {
  const store = createWorkspaceStore()
  assert.equal(store.get('outline.tree#1'), null, '没开过就没有记录')

  const opened = store.open('outline.tree#1')
  assert.equal(opened.ok, true)
  assert.equal(opened.created, true)
  assert.equal(opened.form, 'page')
  assert.equal(opened.group, 'main')
  assert.deepEqual(store.get('outline.tree#1'), {
    instance: 'outline.tree#1',
    pane: 'outline.tree',
    resource: null,
    group: 'main',
    order: 0,
    form: 'page',
    geometry: null,
    z: 1,
    maximized: false,
    viewState: null
  })
  assert.equal(store.snapshot().active.main, 'outline.tree#1', '新开的一页就是该组当前页')
  assert.equal(store.snapshot().focus, 'main')
  assert.deepEqual(store.pagesOf('main').map((page) => page.instance), ['outline.tree#1'])
  assert.deepEqual(store.pagesOf('side'), [], '没搬页就没有侧组——分屏是页组的存在，不是第二套几何')
  assert.deepEqual(store.floatingList(), [], '点载体不弹浮窗（作者裁定①）')

  const template = defaultEntry('outline.tree')
  assert.equal(template.geometry, null)
  assert.equal(template.form, 'page')
  assert.equal(template.z, 0)

  assert.equal(store.close('outline.tree#1').removed, true)
  assert.equal(store.get('outline.tree#1'), null)
  assert.equal(store.list().length, 0)
  assert.equal(store.snapshot().active.main, null, '关掉当前页后高亮不能悬在空处')
  assert.equal(store.close('outline.tree#1').changed, false, '重复关页是 no-op')
})

test('〔裁定①〕重复点同一张页只回到前台：不新建、不改文档、不动几何', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '章节/第一章.md' })
  store.open('outline.tree#1')
  const again = store.open('novel.editor#1')
  assert.equal(again.created, false)
  assert.equal(store.pagesOf('main').length, 2, '同一张页点两次不该多出第三页')
  assert.equal(store.get('novel.editor#1').resource, '章节/第一章.md', '开页不顺手换文档（换文档走 setResource）')
  assert.equal(store.snapshot().active.main, 'novel.editor#1')

  let writes = 0
  store.attachPersistence(() => {
    writes += 1
    return { ok: true }
  })
  assert.equal(store.open('novel.editor#1').changed, false, '再点一次已经是当前页的那一页＝空点击')
  assert.equal(writes, 0, '空点击不该写盘（竖条连点同一载体是最常见的动作）')
})

test('〔D〕每页一份文档：resource 只在这一格改，null＝回落该 pane 缺省文档', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  store.openInstance('novel.editor')
  assert.equal(store.setResource('novel.editor#1', ' 章节/第一章.md ').resource, '章节/第一章.md', '入库前收掉首尾空白')
  assert.equal(store.setResource('novel.editor#2', '章节/第二章.md').changed, true)
  assert.equal(store.get('novel.editor#1').resource, '章节/第一章.md')
  assert.equal(store.get('novel.editor#2').resource, '章节/第二章.md', '两页各装各的，不共享一份正文')
  assert.equal(store.setResource('novel.editor#2', '章节/第二章.md').changed, false, '同一份文档重复设是 no-op')
  assert.equal(store.setResource('novel.editor#2', '   ').resource, null)
  assert.equal(store.setResource('novel.editor#1', null).resource, null)
  assert.equal(store.setResource('novel.editor#9', 'x').error.code, 'UNKNOWN_INSTANCE')

  assert.equal(normalizeResource(42), null)
  assert.equal(normalizeResource('x'.repeat(500)).length, 240, '超长截断，不让脏数据把存档撑爆')
})

test('页签栏数据源：pagesOf 按组内 order 升序，浮窗与侧缘标签不占页位', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  store.open('outline.tree#1')
  store.open('notes.editor#1')
  assert.deepEqual(store.pagesOf('main').map((page) => page.instance), ['novel.editor#1', 'outline.tree#1', 'notes.editor#1'])
  assert.deepEqual(store.pagesOf('main').map((page) => page.order), [0, 1, 2])

  store.setForm('outline.tree#1', 'floating')
  assert.deepEqual(store.pagesOf('main').map((page) => page.instance), ['novel.editor#1', 'notes.editor#1'], '浮窗不进页签栏')
  assert.deepEqual(store.pagesOf('main').map((page) => page.order), [0, 1], '离开页组的序号要重排，不留空洞')
  assert.equal(store.snapshot().active.main, 'notes.editor#1', '当前页浮出去后高亮必须落到还在页组里的一页')
  assert.deepEqual(store.floatingList().map((page) => page.instance), ['outline.tree#1'])

  store.setForm('notes.editor#1', 'tab')
  assert.deepEqual(store.pagesOf('main').map((page) => page.instance), ['novel.editor#1'])
  assert.deepEqual(store.tabList().map((page) => page.instance), ['notes.editor#1'])
  assert.equal(store.snapshot().active.main, 'novel.editor#1')
})

test('pagesOf 认不出的页组一律按主组回，不让页签栏拿到 undefined', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  assert.deepEqual(store.pagesOf('center').map((page) => page.instance), ['novel.editor#1'])
  assert.deepEqual(store.pagesOf(null).map((page) => page.instance), ['novel.editor#1'])
})

test('list() 的序是可断言的：页态在前、浮窗居中、标签在后（比较器必须自洽）', () => {
  const store = createWorkspaceStore()
  store.open('a.one#1')
  store.open('b.two#1')
  store.open('c.three#1')
  store.setForm('a.one#1', 'floating')
  store.setForm('b.two#1', 'tab')
  assert.deepEqual(store.list().map((entry) => [entry.instance, entry.form]), [
    ['c.three#1', 'page'],
    ['a.one#1', 'floating'],
    ['b.two#1', 'tab']
  ])
})

test('分屏＝把一页搬进对面页组；两侧各有一张页与一个当前页', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  store.open('outline.tree#1')

  const moved = store.moveToGroup('outline.tree#1', 'side')
  assert.equal(moved.ok, true)
  assert.equal(moved.from, 'main')
  assert.deepEqual(store.pagesOf('main').map((page) => page.instance), ['novel.editor#1'])
  assert.deepEqual(store.pagesOf('side').map((page) => page.instance), ['outline.tree#1'])
  assert.equal(store.snapshot().active.main, 'novel.editor#1', '主组当前页不能跟着搬去侧组')
  assert.equal(store.snapshot().active.side, 'outline.tree#1')
  assert.equal(store.snapshot().focus, 'side', '作者刚搬的这组成为焦点组，下一页落在这')
  assert.equal(store.get('outline.tree#1').order, 0, '进新组排到组尾')
  assert.equal(store.moveToGroup('outline.tree#1', 'side').changed, false, '已经在对面了就是 no-op')

  store.close('outline.tree#1')
  assert.equal(store.snapshot().active.side, null, '侧组清空后没有当前页')
  assert.equal(store.snapshot().focus, 'main', '焦点组回落到还有页的那一侧')
})

test('切当前页：只接受「这个组里的页」，跨组与非页态都拒', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  store.open('outline.tree#1')
  store.open('notes.editor#1', { group: 'side' })
  store.open('a.one#1', { form: 'floating' })

  assert.equal(store.setActive('main', 'novel.editor#1').changed, true)
  assert.equal(store.snapshot().active.main, 'novel.editor#1')
  assert.equal(store.setActive('main', 'novel.editor#1').changed, false, '重复切同一页是 no-op，不该再刷一次盘')
  assert.equal(store.setActive('main', 'notes.editor#1').error.code, 'NOT_A_PAGE_IN_GROUP', '侧组的页不能抢主组的高亮')
  assert.equal(store.setActive('side', 'notes.editor#1').changed, true, '焦点组跟着移动，即便当前页本来就是它')
  assert.equal(store.snapshot().focus, 'side', 'focus 变了也要落盘，不然重启后新页落错组')
  assert.equal(store.setActive('main', 'a.one#1').error.code, 'NOT_A_PAGE_IN_GROUP', '浮窗不是当前页')
  assert.equal(store.setActive('main', 'novel.editor#9').error.code, 'UNKNOWN_INSTANCE')
  assert.equal(store.setActive('middle', 'outline.tree#1').error.code, 'UNKNOWN_GROUP')
  assert.equal(store.setActive('main', '正文#1').error.code, 'INVALID_INSTANCE')
})

test('形态迁移的唯一入口：进浮窗才给几何，出浮窗收成 null，侧缘标签留着 home 组', () => {
  const store = createWorkspaceStore()
  store.open('outline.widget#1', { group: 'side' })

  const floated = store.setForm('outline.widget#1', 'floating')
  assert.equal(floated.previous, 'page')
  const floating = store.get('outline.widget#1')
  assert.equal(floating.form, 'floating')
  assert.deepEqual(floating.geometry, { ...DEFAULT_FLOATING_GEOMETRY }, '没有原矩形就级联一个')
  assert.equal(floating.group, 'side', '浮窗不占页组，但组籍留着，占为页时回到原来那一侧')
  assert.equal(store.snapshot().active.side, null, '页浮出去了，侧组的当前页要重指')

  store.setGeometry('outline.widget#1', { x: 300, y: 200, w: 420, h: 520 })
  const back = store.setForm('outline.widget#1', 'page')
  assert.equal(back.group, 'side')
  assert.equal(store.get('outline.widget#1').geometry, null, '页态不藏矩形')
  assert.equal(store.snapshot().active.side, 'outline.widget#1')

  store.setForm('outline.widget#1', 'tab')
  assert.equal(store.get('outline.widget#1').geometry, null)
  assert.deepEqual(store.pagesOf('side'), [])
  assert.equal(store.setForm('outline.widget#1', 'bubble').error.code, 'UNKNOWN_FORM')
  assert.equal(store.setForm('outline.widget#9', 'page').error.code, 'UNKNOWN_INSTANCE')
  assert.equal(store.setForm('正文#1', 'page').error.code, 'INVALID_INSTANCE')
})

test('浮窗子态：最大化只属于浮窗，页态与侧缘标签一律拒；几何留着供还原', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  store.open('notes.editor#1', { form: 'floating', geometry: { x: 40, y: 80, w: 700, h: 500 } })

  assert.equal(store.setMaximized('novel.editor#1', true).error.code, 'NOT_FLOATING')
  const maximized = store.setMaximized('notes.editor#1', true)
  assert.equal(maximized.ok, true)
  assert.equal(store.get('notes.editor#1').maximized, true)
  assert.deepEqual(store.get('notes.editor#1').geometry, { x: 40, y: 80, w: 700, h: 500 }, '最大化不抹矩形，还原要用')

  assert.equal(store.toggleMaximized('notes.editor#1').maximized, false)
  assert.equal(store.toggleMaximized('notes.editor#9').error.code, 'UNKNOWN_INSTANCE')

  store.setMaximized('notes.editor#1', true)
  assert.equal(store.setGeometry('notes.editor#1', { x: 10, y: 20, w: 500, h: 400 }).changed, true)
  assert.equal(store.get('notes.editor#1').maximized, false, '作者拖了就是想要自由窗，最大化自动让位')
})

test('浮窗几何只有 floating 可写；重复写同一矩形是 no-op', () => {
  const store = createWorkspaceStore()
  store.open('outline.tree#1')
  assert.equal(store.setGeometry('outline.tree#1', { x: 10, y: 10, w: 400, h: 400 }).error.code, 'NOT_FLOATING')
  assert.equal(store.setGeometry('a.b#1', { x: 1 }).error.code, 'INVALID_GEOMETRY')
  assert.equal(store.setGeometry('a.b#1', { x: 1, y: 2 }).error.code, 'UNKNOWN_INSTANCE')

  store.open('notes.editor#1', { form: 'floating', geometry: { x: 100, y: 100, w: 400, h: 400 } })
  assert.equal(store.setGeometry('notes.editor#1', { x: 100, y: 100, w: 400, h: 400 }).changed, false)
})

test('多实例：同一 pane 开两页，页组序号各算各的；openInstance 取最小空位且号可复用', () => {
  const store = createWorkspaceStore()
  store.open('outline.tree#1')
  const second = store.openInstance('outline.tree')
  assert.equal(second, 'outline.tree#2')
  assert.deepEqual(store.instancesOf('outline.tree'), ['outline.tree#1', 'outline.tree#2'])
  assert.deepEqual(store.pagesOf('main').map((page) => page.order), [0, 1])

  store.setForm('outline.tree#2', 'tab')
  assert.equal(store.get('outline.tree#1').form, 'page', '#1 不跟着 #2 换形态')

  store.close('outline.tree#1')
  assert.equal(store.openInstance('outline.tree'), 'outline.tree#1', '空出来的号可以复用')
  assert.equal(store.openInstance('NotAPane'), null)
})

test('解注册清理（批次45／61）：removePanes 删掉该 pane 的全部实例并修好当前页与焦点组', () => {
  const store = createWorkspaceStore()
  store.open('outline.tree#1')
  store.openInstance('outline.tree')
  store.open('outline.widget#1', { form: 'floating' })
  store.open('novel.editor#1', { group: 'side' })

  const removed = store.removePanes(['outline.tree', 'outline.widget'])
  assert.equal(removed.changed, true)
  assert.deepEqual(removed.instances.sort(), ['outline.tree#1', 'outline.tree#2', 'outline.widget#1'])
  assert.equal(store.list().some((entry) => entry.pane.startsWith('outline.')), false, '整族实例记录都应清掉')
  assert.equal(store.snapshot().active.main, null, '主组被清空后不该还指着删掉的页')
  assert.equal(store.snapshot().active.side, 'novel.editor#1')
  assert.equal(store.snapshot().focus, 'side', '焦点组跟着回落到还有页的一侧')

  const again = store.removePanes(['outline.tree'])
  assert.equal(again.changed, false, '重复清理不改任何东西')
})

test('bringToFront：页态＝置为该组当前页，浮窗＝提叠序；重复置顶是 no-op', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  store.open('outline.tree#1')
  assert.equal(store.bringToFront('novel.editor#1').changed, true)
  assert.equal(store.snapshot().active.main, 'novel.editor#1')
  assert.equal(store.bringToFront('novel.editor#1').changed, false, '已经是当前页且叠序最大')

  store.open('a.one#1', { form: 'floating' })
  store.open('b.two#1', { form: 'floating' })
  store.bringToFront('a.one#1')
  assert.deepEqual(store.floatingList().map((entry) => entry.instance), ['b.two#1', 'a.one#1'], '末尾＝最靠前')
  assert.equal(store.bringToFront('nope#1').error.code, 'UNKNOWN_INSTANCE')
})

test('几何净化：越界钳回值域，形状不对返回 null；吸附随位置枚举一起退役', () => {
  const normalized = normalizeGeometry({ x: -20, y: 12, w: 5, h: 99999, snap: 'middle' })
  assert.deepEqual(normalized, { x: 0, y: 12, w: GEOMETRY_MIN_W, h: 2000 })
  assert.equal('snap' in normalized, false)
  assert.equal(normalizeGeometry({ x: 10, y: 20, w: GEOMETRY_MAX_W + 500 }).w, GEOMETRY_MAX_W)
  assert.equal(normalizeGeometry({ x: 'nope', y: 1 }), null)
  assert.equal(normalizeGeometry(null), null)
})

test('级联矩形：第 n 扇浮窗相对缺省矩形错开 n×步长', () => {
  const store = createWorkspaceStore()
  const first = store.open('a.one#1', { form: 'floating' })
  assert.equal(first.ok, true)
  assert.deepEqual(store.get('a.one#1').geometry, { ...DEFAULT_FLOATING_GEOMETRY })
  store.open('b.two#1', { form: 'floating' })
  const third = store.open('c.three#1', { form: 'floating' })
  assert.equal(third.ok, true)
  assert.deepEqual(store.get('c.three#1').geometry, {
    x: DEFAULT_FLOATING_GEOMETRY.x + 2 * FLOATING_CASCADE_STEP,
    y: DEFAULT_FLOATING_GEOMETRY.y + 2 * FLOATING_CASCADE_STEP,
    w: DEFAULT_FLOATING_GEOMETRY.w,
    h: DEFAULT_FLOATING_GEOMETRY.h
  })
})

test('坏档回落：不是对象／版本不对／脏条目逐条丢弃并记账，不连坐好数据', () => {
  assert.deepEqual(normalizeWorkspace('not-a-workspace').warnings, ['WORKSPACE_NOT_OBJECT'])
  const mixed = normalizeWorkspace({
    version: 9,
    entries: {
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', form: 'page', group: 'main', order: 0 },
      broken: { pane: 'nope' },
      'outline.tree#2': 'garbage'
    }
  })
  assert.equal(mixed.version, WORKSPACE_VERSION)
  assert.ok(mixed.warnings.includes('WORKSPACE_VERSION_9'))
  assert.ok(mixed.warnings.includes('WORKSPACE_DROPPED_2'))
  assert.deepEqual(Object.keys(mixed.entries), ['outline.tree#1'])
  assert.equal(mixed.entries['outline.tree#1'].form, 'page')
  assert.deepEqual(mixed.active, { main: 'outline.tree#1', side: null }, '当前页指针没写也照样补齐')
})

test('normalizeEntry：未知字段与退役轴丢弃，非浮窗的矩形收成 null，形态未知回落到页', () => {
  const entry = normalizeEntry({
    instance: 'outline.tree#1',
    pane: 'outline.tree',
    form: 'page',
    group: 'main',
    geometry: { x: 1, y: 2, w: 300, h: 300 },
    minimized: 'tab',
    tiledWith: 'novel.editor#1',
    tileSide: 'left',
    placement: 'overlay',
    pinned: true,
    mystery: 1
  })
  assert.equal(entry.form, 'page')
  assert.equal(entry.geometry, null, '页态藏矩形＝重启后位置玄学')
  assert.equal('minimized' in entry, false, 'v2 的收起轴已退役进 form')
  assert.equal('tiledWith' in entry, false)
  assert.equal('tileSide' in entry, false)
  assert.equal('placement' in entry, false)
  assert.equal('pinned' in entry, false)
  assert.equal('mystery' in entry, false)

  const unknownForm = normalizeEntry({ instance: 'a.b#1', pane: 'a.b', form: 'bubble' })
  assert.equal(unknownForm.form, 'page', '陌生形态回落缺省，不进状态机')
  const unknownGroup = normalizeEntry({ instance: 'a.b#1', pane: 'a.b', group: 'center' })
  assert.equal(unknownGroup.group, 'main')
  assert.equal(normalizeEntry({ instance: 'a.b#1', pane: 'wrong.pane' }).pane, 'a.b', 'pane 以实例 id 为准')
  assert.equal(normalizeEntry('garbage'), null)
})

test('repairActive：指针悬空／指错组／指向非页态，三种坏味道一次修好', () => {
  const page = { instance: 'a.one#1', pane: 'a.one', resource: null, group: 'main', order: 0, form: 'page', geometry: null, z: 0, maximized: false }
  const floated = { instance: 'b.two#1', pane: 'b.two', resource: null, group: 'side', order: 0, form: 'floating', geometry: { ...DEFAULT_FLOATING_GEOMETRY }, z: 1, maximized: false }
  const entries = { 'a.one#1': page, 'b.two#1': floated }
  assert.deepEqual(repairActive(entries, { main: 'ghost#1', side: 'a.one#1' }), { main: 'a.one#1', side: null })
  assert.deepEqual(repairActive(entries, { main: 'b.two#1', side: null }), { main: 'a.one#1', side: null })
  assert.deepEqual(repairActive({}, { main: 'a.one#1', side: 'b.two#1' }), { main: null, side: null })
})

test('v2→v3 迁移：tab→侧缘标签、maximized→页、贴靠→页组、其余→浮窗，resource 一律待重开', () => {
  const legacy = normalizeWorkspace({
    version: 2,
    entries: {
      'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', geometry: { x: 60, y: 70, w: 800, h: 600 }, z: 3, minimized: 'none', maximized: false, tiledWith: null, tileSide: null },
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', geometry: { x: 1, y: 1, w: 300, h: 300 }, z: 2, minimized: 'tab', maximized: false, tiledWith: null, tileSide: null },
      'outline.widget#1': { instance: 'outline.widget#1', pane: 'outline.widget', geometry: null, z: 1, minimized: 'none', maximized: true, tiledWith: null, tileSide: null },
      'notes.editor#1': { instance: 'notes.editor#1', pane: 'notes.editor', geometry: { x: 0, y: 0, w: 1200, h: 700 }, z: 0, minimized: 'none', maximized: false, tiledWith: 'script.editor#1', tileSide: 'right' }
    }
  })
  assert.ok(legacy.warnings.includes('WORKSPACE_MIGRATED_V2'))
  assert.ok(legacy.warnings.includes('WORKSPACE_RESOURCE_UNKNOWN'), 'v2 没有「哪份文档」这一格，如实记账不猜')

  assert.equal(legacy.entries['novel.editor#1'].form, 'floating', 'v2 的常态就是一扇浮窗')
  assert.deepEqual(legacy.entries['novel.editor#1'].geometry, { x: 60, y: 70, w: 800, h: 600 }, '矩形是 v2 唯一能原样带走的位置信息')
  assert.equal(legacy.entries['novel.editor#1'].z, 3)

  assert.equal(legacy.entries['outline.tree#1'].form, 'tab')
  assert.equal(legacy.entries['outline.tree#1'].geometry, null, '侧缘标签不需要矩形')

  assert.equal(legacy.entries['outline.widget#1'].form, 'page', '最大化在 v3 就是页态（天然铺满）')
  assert.equal(legacy.entries['outline.widget#1'].geometry, null)

  assert.equal(legacy.entries['notes.editor#1'].form, 'page')
  assert.equal(legacy.entries['notes.editor#1'].group, 'side', '右半进侧组——那对 tiledWith 只能装两个窗，是页组的退化形态')

  const moved = migrateV2Entry({ instance: 'a.b#1', pane: 'a.b', tiledWith: 'c.d#1', tileSide: 'left' }, 'a.b#1')
  assert.equal(moved.group, 'main', '左半留在主组')
  assert.equal(migrateV2Entry(null), null)
})

test('v1→v3 迁移：dock 丢弃不算脏，overlay→浮窗，全屏／沉浸→页，气泡折成侧缘标签', () => {
  const legacy = normalizeWorkspace({
    version: 1,
    entries: {
      'novel.editor#1': { pane: 'novel.editor', placement: 'overlay', geometry: { x: 10, y: 20, w: 500, h: 400, snap: 'right' }, minimized: 'none', z: 2 },
      'outline.tree#1': { pane: 'outline.tree', placement: 'dock' },
      'outline.widget#1': { pane: 'outline.widget', placement: 'fullscreen', minimized: 'bubble' },
      'notes.editor#1': { pane: 'notes.editor', placement: 'immersive' }
    }
  })
  assert.ok(legacy.warnings.includes('WORKSPACE_MIGRATED_V1'))
  assert.equal(legacy.warnings.some((warning) => warning.startsWith('WORKSPACE_DROPPED_')), false, 'dock 不是页，不算脏数据')
  assert.deepEqual(Object.keys(legacy.entries).sort(), ['notes.editor#1', 'novel.editor#1', 'outline.widget#1'])

  const overlay = legacy.entries['novel.editor#1']
  assert.equal(overlay.form, 'floating')
  assert.deepEqual(overlay.geometry, { x: 10, y: 20, w: 500, h: 400 }, 'snap 退场，矩形保留')

  const widget = legacy.entries['outline.widget#1']
  assert.equal(widget.form, 'tab', '收起优先于全屏：v2 里两者互斥，标签是更近的状态')

  assert.equal(legacy.entries['notes.editor#1'].form, 'page', '沉浸＝整窗铺开＝页态')
  assert.equal(legacy.entries['notes.editor#1'].geometry, null)

  const split = migrateV1Entry({ pane: 'x.y', placement: 'split' }, 'x.y#1')
  assert.equal(split.form, 'floating', 'v1 没留下搭档指针，分屏只能回浮窗')
  assert.equal(migrateV1Entry({ pane: 'x.y', placement: 'dock' }, 'x.y#1'), null)
})

test('持久化：attachPersistence 收到整份快照（含 active／focus）；save 抛错只记 degraded，不拦状态机', () => {
  const store = createWorkspaceStore()
  const seen = []
  store.attachPersistence((snapshot) => {
    seen.push(snapshot)
    return { ok: true }
  })
  store.open('novel.editor#1')
  store.open('outline.tree#1', { group: 'side' })
  assert.equal(seen.length, 2)
  assert.equal(seen[1].version, WORKSPACE_VERSION)
  assert.deepEqual(seen[1].active, { main: 'novel.editor#1', side: 'outline.tree#1' })
  assert.equal(seen[1].focus, 'side')
  assert.deepEqual(Object.keys(seen[1].entries).sort(), ['novel.editor#1', 'outline.tree#1'])
  assert.equal(store.snapshot().persistent, true)

  store.attachPersistence(() => {
    throw new Error('disk full')
  })
  const result = store.setForm('novel.editor#1', 'floating')
  assert.equal(result.ok, true, '落盘失败不拦本次会话')
  assert.equal(store.get('novel.editor#1').form, 'floating')
  assert.equal(store.snapshot().persistent, false, 'degraded 要如实报给界面')
})

test('落盘只认 { version, entries, active, focus, lastOpenFiles }；snapshot 的 persistent／warnings 不写进档', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '章节/第一章.md' })
  const saved = store.serialize()
  // 批次66 任务二：lastOpenFiles 是工作区级的那一份列表，跟着落盘（重启后「最近打开」还在）。
  assert.deepEqual(Object.keys(saved).sort(), ['active', 'entries', 'focus', 'lastOpenFiles', 'version'])
  assert.deepEqual(saved.lastOpenFiles, [{ pane: 'novel.editor', resource: '章节/第一章.md' }])
  assert.equal(saved.entries['novel.editor#1'].resource, '章节/第一章.md')
  assert.equal('persistent' in saved, false)
  assert.equal('warnings' in saved, false)
})

test('订阅：每次变更收到快照，退订后不再收', () => {
  const store = createWorkspaceStore()
  const seen = []
  const unsubscribe = store.subscribe((snapshot) => seen.push(snapshot.active.main))
  store.open('novel.editor#1')
  store.close('novel.editor#1')
  unsubscribe()
  store.open('outline.tree#1')
  assert.deepEqual(seen, ['novel.editor#1', null])
  assert.equal(typeof store.subscribe(null), 'function', '非函数订阅者不炸')
})

test('往返：v3 落盘再读回不变形（含每页文档、页组、形态与当前页）', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '章节/第一章.md' })
  store.open('outline.tree#1', { group: 'side', resource: 'outline:node:3' })
  store.open('outline.widget#1', { form: 'floating', geometry: { x: 640, y: 120, w: 300, h: 480 } })
  store.open('notes.editor#1')
  store.setForm('notes.editor#1', 'tab')

  const saved = store.serialize()
  assert.equal(saved.version, WORKSPACE_VERSION)
  const revived = createWorkspaceStore({ initial: saved })
  assert.deepEqual(revived.serialize(), saved, '读回来再写出去必须一字不差')
  assert.equal(revived.get('novel.editor#1').resource, '章节/第一章.md')
  assert.deepEqual(revived.pagesOf('side').map((page) => page.instance), ['outline.tree#1'])
  assert.deepEqual(revived.get('outline.widget#1').geometry, { x: 640, y: 120, w: 300, h: 480 })
  assert.deepEqual(revived.tabList().map((page) => page.instance), ['notes.editor#1'])
  assert.deepEqual(revived.snapshot().active, { main: 'novel.editor#1', side: 'outline.tree#1' })
})

test('存档里的当前页指针是脏的（跨组／指向浮窗／悬空）→ 读入即修，界面不各说各话', () => {
  const store = createWorkspaceStore({
    initial: {
      version: WORKSPACE_VERSION,
      entries: {
        'a.one#1': { instance: 'a.one#1', pane: 'a.one', form: 'page', group: 'main', order: 0 },
        'b.two#1': { instance: 'b.two#1', pane: 'b.two', form: 'floating', group: 'side', order: 0 }
      },
      active: { main: 'b.two#1', side: 'ghost#1' },
      focus: 'side'
    }
  })
  assert.deepEqual(store.snapshot().active, { main: 'a.one#1', side: null })
})

test('老键迁移：paneForm./overlay. 搬进 #1 的浮窗，成功后删键；已有记录不覆盖', () => {
  const storage = memoryStorage({
    'paneForm.outline.widget': 'overlay',
    'overlay.outline.widget': JSON.stringify({ left: 120, top: 64, snap: 'right' }),
    'paneForm.novel.editor': 'fullscreen'
  })
  const store = createWorkspaceStore()
  const result = migrateLegacyWorkspace({ store, storage, paneIds: ['outline.widget', 'novel.editor'] })
  assert.equal(result.ok, true)
  assert.equal(result.migrated, 2)
  assert.equal(result.removed, 3)
  assert.deepEqual(storage.dump(), {}, '搬成功的老键必须删掉')

  const widget = store.get('outline.widget#1')
  assert.equal(widget.form, 'floating', '老键只证明「它曾浮着」，不凭空占一页')
  assert.deepEqual(widget.geometry, { x: 120, y: 64, w: DEFAULT_FLOATING_GEOMETRY.w, h: DEFAULT_FLOATING_GEOMETRY.h }, 'snap 退场，w/h 用缺省')
  assert.equal(store.get('novel.editor#1').form, 'floating', 'v3 的「铺满」是页态；老全屏没有文档身份，先落成可拖的浮窗')

  const again = migrateLegacyWorkspace({ store, storage, paneIds: ['outline.widget'] })
  assert.equal(again.migrated, 0)
  assert.equal(again.removed, 0)
})

test('老键迁移：坏位置只记账不删键；store 已有记录时老键照样退场', () => {
  const storage = memoryStorage({
    'paneForm.outline.widget': 'overlay',
    'overlay.outline.widget': '{not json'
  })
  const store = createWorkspaceStore()
  const read = readLegacyWorkspace({ storage, paneIds: ['outline.widget'] })
  assert.deepEqual(read.panes[0].keys, ['paneForm.outline.widget'], '解析不了的位置键不参与迁移')
  assert.deepEqual(read.warnings, ['BAD_LEGACY_OVERLAY:outline.widget'])
  assert.ok(storage.getItem('overlay.outline.widget'), '解析失败的老键要留着')

  store.open('outline.widget#1', { form: 'floating', geometry: { x: 10, y: 10, w: 500, h: 400 } })
  const result = migrateLegacyWorkspace({ store, storage, paneIds: ['outline.widget'] })
  assert.equal(result.migrated, 0, '新真相优先：已有记录不被老键覆盖')
  assert.deepEqual(store.get('outline.widget#1').geometry, { x: 10, y: 10, w: 500, h: 400 })
  assert.equal(storage.getItem('paneForm.outline.widget'), null, '搬过（或已有记录）的形态键可以退场')
})

test('老键迁移：只有位置没有形态也算「它曾浮着」；老 dock 不凭空开页', () => {
  const storage = memoryStorage({
    'overlay.notes.editor': JSON.stringify({ left: 20, top: 40 }),
    'paneForm.outline.tree': 'dock'
  })
  const store = createWorkspaceStore()
  const result = migrateLegacyWorkspace({ store, storage, paneIds: ['notes.editor', 'outline.tree'] })
  assert.equal(result.migrated, 1)
  assert.deepEqual(store.get('notes.editor#1').geometry, { x: 20, y: 40, w: DEFAULT_FLOATING_GEOMETRY.w, h: DEFAULT_FLOATING_GEOMETRY.h })
  assert.equal(store.get('outline.tree#1'), null, '停靠栏不是页')
  assert.deepEqual(store.snapshot().active, { main: null, side: null })
})

test('磁盘层：读坏 JSON 回落并记账；写盘原子替换；同内容不重复写；拒写旧版本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-workspace-'))
  const dir = join(root, '.pinax')
  await mkdir(dir, { recursive: true })
  await writeFile(workspacePath(root), '{ broken', 'utf-8')

  const disk = createFileWorkspaceStore({ root })
  const read = await disk.read()
  assert.equal(read.ok, true)
  assert.deepEqual(read.value.warnings, ['WORKSPACE_BAD_JSON'])
  assert.deepEqual(read.value.entries, {})

  const snapshot = {
    version: WORKSPACE_VERSION,
    entries: {
      'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', resource: '章节/第一章.md', group: 'main', order: 0, form: 'page', geometry: null, z: 1, maximized: false }
    },
    active: { main: 'novel.editor#1', side: null },
    focus: 'main'
  }
  const first = await disk.write(snapshot)
  assert.equal(first.ok, true)
  assert.equal(first.value.skipped, false)
  const onDisk = JSON.parse(await readFile(workspacePath(root), 'utf-8'))
  assert.deepEqual(onDisk, snapshot, '每页文档与当前页指针都要落盘，不然重启后页签高亮丢了')

  const second = await disk.write(snapshot)
  assert.equal(second.value.skipped, true, '内容没变不该再写一次盘')
  assert.equal((await disk.write({ version: 1, entries: {} })).ok, false, '旧版本直接拒写')
  assert.equal((await disk.write({ version: WORKSPACE_VERSION, entries: [] })).ok, false)
})

test('磁盘层：version:2 旧档照常读出（version 原样），迁移归渲染层', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-workspace-v2-'))
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(workspacePath(root), JSON.stringify({
    version: 2,
    entries: {
      'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', geometry: { x: 40, y: 40, w: 900, h: 600 }, z: 1, minimized: 'none', maximized: true, tiledWith: null, tileSide: null }
    }
  }), 'utf-8')

  const disk = createFileWorkspaceStore({ root })
  const read = await disk.read()
  assert.equal(read.value.version, 2, '磁盘层不把 v2 改写成 v3——旧条目还得按窗口轴读')
  assert.deepEqual(read.value.warnings, [])

  const store = createWorkspaceStore({ initial: read.value })
  const entry = store.get('novel.editor#1')
  assert.equal(entry.form, 'page', '最大化＝铺满＝页态')
  assert.equal(entry.geometry, null)
  assert.deepEqual(store.snapshot().active, { main: 'novel.editor#1', side: null })
})

test('磁盘层：active／focus 形状不对时不写进档，不让脏指针落盘', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-workspace-active-'))
  const disk = createFileWorkspaceStore({ root })
  const written = await disk.write({
    version: WORKSPACE_VERSION,
    entries: {},
    active: { main: 42, side: null },
    focus: 'center'
  })
  assert.equal(written.ok, true)
  const onDisk = JSON.parse(await readFile(written.value.file, 'utf-8'))
  assert.equal('active' in onDisk, false, 'main 必须是字符串或 null')
  assert.equal('focus' in onDisk, false)
})

test('磁盘层：没有项目根时报错，不造孤儿文件', () => {
  assert.throws(() => createFileWorkspaceStore({ root: '' }), /需要项目根/u)
})

// ── 批次66 任务二：lastOpenFiles（滚动封顶、去重置顶、关闭不删、预填不自动开）──────

test('最近打开：带着文档开一页记一条，换文档（single 硬闸的 replace-page）再记一条', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '正文/第一章.md' })
  assert.deepEqual(store.recentFiles(), [{ pane: 'novel.editor', resource: '正文/第一章.md' }])

  store.setResource('novel.editor#1', '正文/第二章.md')
  assert.deepEqual(store.recentFiles(), [
    { pane: 'novel.editor', resource: '正文/第二章.md' },
    { pane: 'novel.editor', resource: '正文/第一章.md' }
  ], '最近优先＝新的排在最前')

  // 没带 resource 的开页（竖条点载体＝该 pane 缺省那份）没得记，不编一条空路径出来。
  store.open('outline.tree#1')
  assert.equal(store.recentFiles().length, 2, 'resource 为 null 不记')
  store.setResource('novel.editor#1', null)
  assert.equal(store.recentFiles().length, 2, '回落到缺省文档也不算"打开过某份文档"')
})

test('最近打开：同一条重复打开＝置顶，不追加第二份（去重按 pane＋resource 这一对）', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '正文/a.md' })
  store.open('notes.editor#1', { resource: '构思/b.md' })
  store.open('novel.editor#2', { resource: '正文/a.md' })
  assert.deepEqual(store.recentFiles(), [
    { pane: 'novel.editor', resource: '正文/a.md' },
    { pane: 'notes.editor', resource: '构思/b.md' }
  ], '同一 pane 的第二个实例装同一份文档＝同一条，不去那儿记第二份')

  store.setResource('novel.editor#2', '正文/c.md')
  store.open('novel.editor#1', { resource: '正文/a.md' })
  store.setResource('novel.editor#1', '正文/a.md')
  assert.deepEqual(store.recentFiles().map((item) => item.resource), ['正文/a.md', '正文/c.md', '构思/b.md'])
  assert.equal(store.recentFiles().length, 3)
})

test('最近打开：滚动封顶 20 条（守卫用例）——第 21 条把最旧那条挤出去', () => {
  const store = createWorkspaceStore()
  // single 那块 pane 换文档走 replace-page（setResource），这才是"连着开很多份文档"的真实路径。
  store.open('novel.editor#1', { resource: '正文/第1章.md' })
  for (let index = 2; index <= LAST_OPEN_FILES_LIMIT + 3; index += 1) {
    store.setResource('novel.editor#1', `正文/第${index}章.md`)
  }
  const files = store.recentFiles()
  assert.equal(files.length, LAST_OPEN_FILES_LIMIT)
  assert.equal(files[0].resource, `正文/第${LAST_OPEN_FILES_LIMIT + 3}章.md`)
  assert.equal(files.some((item) => item.resource === '正文/第1章.md'), false, '最旧的该被挤出去')

  // 封顶后把列表里已有的一条再打开一次：长度不涨，位置回到最前。
  const before = store.recentFiles().map((item) => item.resource)
  store.setResource('novel.editor#1', before[before.length - 1])
  const after = store.recentFiles().map((item) => item.resource)
  assert.equal(after.length, LAST_OPEN_FILES_LIMIT)
  assert.equal(after[0], before[before.length - 1])
})

test('最近打开：空点击不记（连着点同一张当前页不该把列表刷成噪音）', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '正文/第一章.md' })
  const before = JSON.stringify(store.recentFiles())
  store.open('novel.editor#1')
  store.open('novel.editor#1', { resource: '正文/第一章.md' })
  store.setResource('novel.editor#1', '正文/第一章.md')
  assert.equal(JSON.stringify(store.recentFiles()), before)
  assert.equal(store.serialize().lastOpenFiles.length, 1)
})

test('最近打开：关掉的文档留在列表里（它是"打开过什么"，不是"现在开着什么"）', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { resource: '正文/第一章.md' })
  store.open('novel.editor#2', { resource: '正文/第二章.md' })
  store.close('novel.editor#1')
  assert.deepEqual(store.list().map((page) => page.resource), ['正文/第二章.md'])
  assert.deepEqual(store.recentFiles().map((item) => item.resource), ['正文/第二章.md', '正文/第一章.md'])
})

test('最近打开：读盘净化——坏条目逐条丢、非数组回空、超额截断', () => {
  assert.deepEqual(normalizeLastOpenFiles(null), [])
  assert.deepEqual(normalizeLastOpenFiles('正文/a.md'), [])
  assert.deepEqual(normalizeLastOpenFiles([null, 42, {}, { pane: 'novel.editor' }, { resource: '正文/a.md' }]), [])
  assert.deepEqual(normalizeLastOpenFiles([{ pane: 'Bad Pane', resource: 'a.md' }]), [], 'pane 名不合法就不算一条')
  const many = Array.from({ length: LAST_OPEN_FILES_LIMIT + 5 }, (_, index) => ({ pane: 'novel.editor', resource: `正文/${index}.md` }))
  assert.equal(normalizeLastOpenFiles(many).length, LAST_OPEN_FILES_LIMIT)
  const dup = [
    { pane: 'novel.editor', resource: 'a.md' },
    { pane: 'notes.editor', resource: 'a.md' },
    { pane: 'novel.editor', resource: 'a.md' }
  ]
  assert.deepEqual(normalizeLastOpenFiles(dup), [
    { pane: 'novel.editor', resource: 'a.md' },
    { pane: 'notes.editor', resource: 'a.md' }
  ], '同 pane 同文档重复出现＝保首个（首＝最新）')
  assert.deepEqual(pushRecentFile([], { pane: 'novel.editor', resource: '  ' }), [], '空 resource 记不出条目')
})

test('最近打开：落盘再读回不变形；老档没这一格就回空表（预填不自动开任何一页）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-workspace-recent-'))
  const disk = createFileWorkspaceStore({ root })
  const store = createWorkspaceStore({ initial: { version: 3, entries: {} } })
  store.open('novel.editor#1', { resource: '正文/第一章.md' })
  store.open('notes.editor#1', { resource: '构思/卡片.md' })
  const written = await disk.write(store.serialize())
  assert.equal(written.ok, true)
  const onDisk = JSON.parse(await readFile(written.value.file, 'utf-8'))
  assert.deepEqual(onDisk.lastOpenFiles, [
    { pane: 'notes.editor', resource: '构思/卡片.md' },
    { pane: 'novel.editor', resource: '正文/第一章.md' }
  ], '磁盘层整串透传，不在这洗第二遍')

  const readBack = await disk.read()
  // 页本身照旧恢复（批次61 的语义不变）：最近打开不额外开任何一页。
  const revived = createWorkspaceStore({ initial: readBack.value })
  assert.deepEqual(revived.recentFiles(), onDisk.lastOpenFiles)
  assert.deepEqual(revived.list().map((page) => page.instance), ['novel.editor#1', 'notes.editor#1'])
  const prefilled = createWorkspaceStore({ initial: { ...readBack.value, entries: {}, active: { main: null, side: null } } })
  assert.deepEqual(prefilled.recentFiles(), onDisk.lastOpenFiles, '列表读回来了')
  assert.deepEqual(prefilled.list(), [], '但恢复语义＝预填：不自动开任何一页')

  // 这一格出现之前的老档：磁盘层回 null，渲染层收成空表，不报错也不记账。
  await writeFile(workspacePath(root), JSON.stringify({ version: 3, entries: {}, active: { main: null, side: null }, focus: 'main' }), 'utf-8')
  const legacy = await disk.read()
  assert.equal(legacy.value.lastOpenFiles, null)
  assert.deepEqual(createWorkspaceStore({ initial: legacy.value }).recentFiles(), [])
})

// ── 批次66 任务三：逐视图状态（folder 模板的树折叠态＋选中项，按页记）────────────

test('逐视图状态：每页自己一份，树的折叠集落盘读回；同值不重复写', () => {
  const store = createWorkspaceStore()
  store.open('novel.shelf#1', { resource: null })
  store.open('novel.shelf#2', { resource: null })
  assert.equal(store.get('novel.shelf#1').viewState, null, '没动过视图就没有状态，不凭空造一份')

  const first = store.setViewState('novel.shelf#1', { collapsed: ['第二卷'] })
  assert.equal(first.ok, true)
  assert.equal(first.changed, true)
  assert.deepEqual(store.get('novel.shelf#1').viewState, { collapsed: ['第二卷'] })
  assert.equal(store.get('novel.shelf#2').viewState, null, '状态归这一页自己，别的页不受影响')

  // 快照给出去的是副本：界面改了副本不该串改状态机（和几何同一纪律）。
  const copy = store.get('novel.shelf#1')
  copy.viewState.collapsed.push('第三卷')
  assert.deepEqual(store.get('novel.shelf#1').viewState.collapsed, ['第二卷'])

  const saved = store.serialize()
  assert.deepEqual(saved.entries['novel.shelf#1'].viewState, { collapsed: ['第二卷'] })
  const revived = createWorkspaceStore({ initial: saved })
  assert.deepEqual(revived.get('novel.shelf#1').viewState, { collapsed: ['第二卷'] })

  const again = revived.setViewState('novel.shelf#1', { collapsed: ['第二卷'] })
  assert.equal(again.changed, false, '同值不该写盘')

  // 「选中哪份文档」不在 viewState 里：那一格就是 entry.resource（批次61〔D〕），不另存第二份真相。
  assert.deepEqual(Object.keys(revived.get('novel.shelf#1')), ['instance', 'pane', 'resource', 'group', 'order', 'form', 'geometry', 'z', 'maximized', 'viewState'])
})

test('逐视图状态净化：全展开＝收成 null（没有值得落盘的东西）；重复卷名去掉；坏形状不脏状态机', () => {
  assert.deepEqual(normalizeViewState({ collapsed: [] }), null)
  assert.deepEqual(normalizeViewState({}), null)
  assert.deepEqual(normalizeViewState(null), null)
  assert.deepEqual(normalizeViewState('collapsed'), null)
  assert.deepEqual(normalizeViewState({ collapsed: ['甲', ' 甲 ', '', null, '乙'] }), { collapsed: ['甲', '乙'] })
  // 旧形状里多出来的键（比如曾经想过要记 selected）一概不收——不留第二份真相的入口。
  assert.deepEqual(normalizeViewState({ collapsed: ['甲'], selected: '正文/a.md' }), { collapsed: ['甲'] })

  const store = createWorkspaceStore()
  store.open('novel.shelf#1')
  assert.equal(store.setViewState('novel.shelf#1', { collapsed: ['第一卷'] }).changed, true)
  assert.equal(store.setViewState('novel.shelf#1', {}).changed, true, '收干净了也是一次变更（回 null）')
  assert.equal(store.get('novel.shelf#1').viewState, null)
  assert.equal(store.setViewState('ghost.pane#1', {}).ok, false, '没开的页不记')
})
