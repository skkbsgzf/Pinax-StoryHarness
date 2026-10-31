import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FLOATING_GEOMETRY,
  DEFAULT_MINIMIZED,
  GEOMETRY_MAX_W,
  GEOMETRY_MIN_W,
  MINIMIZED_MODES,
  WORKSPACE_VERSION,
  createWorkspaceStore,
  defaultEntry,
  instanceIdFor,
  migrateV1Entry,
  normalizeEntry,
  normalizeGeometry,
  normalizeWorkspace,
  parseInstanceId,
  reconcileTiles
} from '../shell/workspace.mjs'
import { migrateLegacyWorkspace, readLegacyWorkspace } from '../shell/workspaceMigration.mjs'
import { createFileWorkspaceStore, workspacePath } from '../workspaceStore.mjs'

/**
 * 工作区窗口状态单测（批次59 · v2）。
 * 纯 node:test：workspace.mjs 不 import Vue、不碰 localStorage，状态机与 v1→v2 迁移都能直接测；
 * 磁盘层（workspaceStore.mjs）用临时目录，测坏文件回落、「内容没变不写」与旧档放行。
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

test('开窗＝记录存在：缺省几何／叠序，关窗＝删记录（get 返回 null）', () => {
  const store = createWorkspaceStore()
  assert.equal(store.get('outline.tree#1'), null, '没开过就没有记录')

  const opened = store.open('outline.tree#1')
  assert.equal(opened.ok, true)
  assert.equal(opened.created, true)
  const entry = store.get('outline.tree#1')
  assert.deepEqual(entry, {
    instance: 'outline.tree#1',
    pane: 'outline.tree',
    geometry: { ...DEFAULT_FLOATING_GEOMETRY },
    z: 1,
    minimized: DEFAULT_MINIMIZED,
    maximized: false,
    tiledWith: null,
    tileSide: null
  })
  const template = defaultEntry('outline.tree')
  assert.equal(template.geometry, null, '缺省记录没有矩形；开窗时再铺缺省矩形')
  assert.equal(template.z, 0)
  assert.equal(template.minimized, 'none')
  assert.equal(template.maximized, false)

  assert.equal(store.close('outline.tree#1').removed, true)
  assert.equal(store.get('outline.tree#1'), null)
  assert.equal(store.list().length, 0)
  assert.equal(store.close('outline.tree#1').changed, false, '重复关窗是 no-op')
})

test('v2 往返：geometry／z／minimized／maximized／贴靠落盘再读回不变形', () => {
  const store = createWorkspaceStore()
  store.open('outline.tree#1', { geometry: { x: 1180, y: 96, w: 320, h: 520 } })
  store.minimize('outline.tree#1', 'tab')
  store.open('novel.editor#1', { geometry: { x: 40, y: 80, w: 900, h: 700 } })
  store.setMaximized('novel.editor#1', true)

  const saved = store.serialize()
  assert.equal(saved.version, WORKSPACE_VERSION)
  const revived = createWorkspaceStore({ initial: saved })
  assert.deepEqual(revived.get('outline.tree#1'), {
    instance: 'outline.tree#1',
    pane: 'outline.tree',
    geometry: { x: 1180, y: 96, w: 320, h: 520 },
    z: 1,
    minimized: 'tab',
    maximized: false,
    tiledWith: null,
    tileSide: null
  })
  const editor = revived.get('novel.editor#1')
  assert.equal(editor.maximized, true, '最大化是窗口自己的轴')
  assert.equal(editor.minimized, 'none')
  assert.deepEqual(editor.geometry, { x: 40, y: 80, w: 900, h: 700 }, '最大化也把矩形留着，还原用')
})

test('收起标签不丢几何：收起→展开回到原矩形（同一扇窗的状态变化）', () => {
  const store = createWorkspaceStore()
  store.open('outline.widget#1', { geometry: { x: 640, y: 120, w: 300, h: 480 } })
  store.minimize('outline.widget#1', 'tab')

  const tab = store.get('outline.widget#1')
  assert.equal(tab.minimized, 'tab')
  assert.deepEqual(tab.geometry, { x: 640, y: 120, w: 300, h: 480 }, '收起只是 minimized')

  store.expand('outline.widget#1')
  const expanded = store.get('outline.widget#1')
  assert.equal(expanded.minimized, 'none')
  assert.deepEqual(expanded.geometry, tab.geometry)
})

test('最大化：占满中栏、解除贴靠、提叠序；toggle 往返', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { geometry: { x: 40, y: 80, w: 700, h: 500 } })
  store.open('notes.editor#1', { geometry: { x: 100, y: 100, w: 600, h: 500 } })
  store.tile('novel.editor#1', 'notes.editor#1')

  const maximized = store.setMaximized('novel.editor#1', true)
  assert.equal(maximized.ok, true)
  const editor = store.get('novel.editor#1')
  assert.equal(editor.maximized, true)
  assert.equal(editor.tiledWith, null, '最大化先解除分屏')
  const notes = store.get('notes.editor#1')
  assert.equal(notes.tiledWith, null, '搭档不留半对')
  assert.equal(notes.tileSide, null)
  assert.deepEqual(editor.geometry, { x: 40, y: 80, w: 700, h: 500 }, '矩形保留给还原')

  assert.equal(store.toggleMaximized('novel.editor#1').maximized, false)
  assert.equal(store.get('novel.editor#1').maximized, false)
})

test('分屏：两窗共用同一矩形、左／右互指；拖动任一扇即解除；关窗不留半对', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1', { geometry: { x: 100, y: 100, w: 800, h: 600 } })
  store.open('notes.editor#1', { geometry: { x: 30, y: 30, w: 300, h: 300 } })

  const tiled = store.tile('novel.editor#1', 'notes.editor#1')
  assert.equal(tiled.ok, true)
  const left = store.get('novel.editor#1')
  const right = store.get('notes.editor#1')
  assert.equal(left.tiledWith, 'notes.editor#1')
  assert.equal(left.tileSide, 'left')
  assert.equal(right.tiledWith, 'novel.editor#1')
  assert.equal(right.tileSide, 'right')
  assert.deepEqual(left.geometry, { x: 100, y: 100, w: 800, h: 600 }, '共用当前窗的矩形对半贴')
  assert.deepEqual(right.geometry, left.geometry)
  assert.equal(left.z, right.z, '一对同叠序')

  store.setGeometry('notes.editor#1', { x: 10, y: 20, w: 500, h: 400 })
  assert.equal(store.get('notes.editor#1').tiledWith, null)
  assert.equal(store.get('novel.editor#1').tiledWith, null, '拖走一扇，另一扇也该解除')

  store.tile('novel.editor#1', 'notes.editor#1')
  store.close('novel.editor#1')
  assert.equal(store.get('notes.editor#1').tiledWith, null, '关掉一扇，搭档回到浮窗')
  assert.equal(store.get('notes.editor#1').tileSide, null)
})

test('分屏拒绝：同一扇窗／关着的窗／非法实例都返回错误，不静默改状态', () => {
  const store = createWorkspaceStore()
  store.open('novel.editor#1')
  assert.equal(store.tile('novel.editor#1', 'novel.editor#1').error.code, 'INVALID_INSTANCE')
  assert.equal(store.tile('novel.editor#1', 'notes.editor#1').error.code, 'UNKNOWN_INSTANCE')
  assert.equal(store.tile('NotAPane', 'novel.editor#1').error.code, 'INVALID_INSTANCE')
})

test('多实例：同一 pane 开两份，几何／窗态互不串；openInstance 取最小空位', () => {
  const store = createWorkspaceStore()
  store.open('outline.tree#1')
  const second = store.openInstance('outline.tree', { geometry: { x: 40, y: 80, w: 300, h: 400 } })
  assert.equal(second, 'outline.tree#2')
  assert.deepEqual(store.instancesOf('outline.tree'), ['outline.tree#1', 'outline.tree#2'])

  store.minimize('outline.tree#2', 'tab')
  assert.deepEqual(store.get('outline.tree#1').geometry, { ...DEFAULT_FLOATING_GEOMETRY }, '#1 不借 #2 的位置')
  assert.equal(store.get('outline.tree#1').minimized, 'none')
  assert.equal(store.get('outline.tree#2').minimized, 'tab')

  store.close('outline.tree#1')
  assert.equal(store.openInstance('outline.tree'), 'outline.tree#1', '空出来的号可以复用')
})

test('解注册清理（批次45／59）：removePanes 删除该 pane 的全部实例（含 #n）并解开贴靠', () => {
  const store = createWorkspaceStore()
  store.open('outline.tree#1')
  store.openInstance('outline.tree')
  store.open('outline.widget#1', { geometry: { x: 40, y: 80, w: 300, h: 400 } })
  store.open('novel.editor#1')
  store.tile('novel.editor#1', 'outline.widget#1')

  const removed = store.removePanes(['outline.tree', 'outline.widget'])
  assert.equal(removed.changed, true)
  assert.deepEqual(removed.instances.sort(), ['outline.tree#1', 'outline.tree#2', 'outline.widget#1'])
  assert.equal(store.list().some((entry) => entry.pane.startsWith('outline.')), false, '整族实例记录都应清掉')
  assert.equal(store.get('novel.editor#1').tiledWith, null, '被删的搭档解开贴靠')
  assert.equal(store.get('novel.editor#1').tileSide, null)

  const again = store.removePanes(['outline.tree'])
  assert.equal(again.changed, false, '重复清理不改任何东西')
})

test('几何净化：越界钳回值域，形状不对返回 null；v2 不再记 snap', () => {
  const normalized = normalizeGeometry({ x: -20, y: 12, w: 5, h: 99999, snap: 'middle' })
  assert.deepEqual(normalized, { x: 0, y: 12, w: GEOMETRY_MIN_W, h: 2000 })
  assert.equal('snap' in normalized, false, '吸附随位置枚举一起退役')
  assert.equal(normalizeGeometry({ x: 10, y: 20, w: GEOMETRY_MAX_W + 500 }).w, GEOMETRY_MAX_W)
  assert.equal(normalizeGeometry({ x: 'nope', y: 1 }), null)
  assert.equal(normalizeGeometry(null), null)
})

test('坏档回落：不是对象／版本不对／脏条目逐条丢弃并记账', () => {
  assert.deepEqual(normalizeWorkspace('not-a-workspace').warnings, ['WORKSPACE_NOT_OBJECT'])
  const mixed = normalizeWorkspace({
    version: 9,
    entries: {
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', geometry: { x: 40, y: 50, w: 500, h: 400 }, minimized: 'tab' },
      broken: { pane: 'nope' },
      'outline.tree#2': 'garbage'
    }
  })
  assert.equal(mixed.version, WORKSPACE_VERSION)
  assert.ok(mixed.warnings.includes('WORKSPACE_VERSION_9'))
  assert.ok(mixed.warnings.includes('WORKSPACE_DROPPED_2'))
  assert.deepEqual(Object.keys(mixed.entries), ['outline.tree#1'], '脏条目只丢自己，不连坐好数据')
  assert.equal(mixed.entries['outline.tree#1'].minimized, 'tab')
})

test('窗态词表：minimized 两档（none／tab）；未知值与非法实例不进门', () => {
  assert.deepEqual([...MINIMIZED_MODES], ['none', 'tab'])
  const store = createWorkspaceStore()
  assert.equal(store.minimize('a.b#1', 'bubble').error.code, 'UNKNOWN_MINIMIZED')
  assert.equal(store.open('NotAPane').error.code, 'INVALID_INSTANCE')
  assert.equal(store.minimize('a.b#1', 'tab').error.code, 'UNKNOWN_INSTANCE')
  assert.equal(store.setGeometry('a.b#1', { x: 1, y: 2 }).error.code, 'UNKNOWN_INSTANCE')
})

test('v1→v2 迁移：dock 丢弃不算脏、overlay/split 浮窗、fullscreen/immersive 最大化、气泡/收起折成 tab', () => {
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
  assert.equal(legacy.warnings.some((warning) => warning.startsWith('WORKSPACE_DROPPED_')), false, 'dock 不是窗口，不算脏数据')
  assert.deepEqual(Object.keys(legacy.entries).sort(), ['notes.editor#1', 'novel.editor#1', 'outline.widget#1'])

  const overlay = legacy.entries['novel.editor#1']
  assert.equal(overlay.maximized, false)
  assert.deepEqual(overlay.geometry, { x: 10, y: 20, w: 500, h: 400 }, 'snap 退场，矩形保留')

  const widget = legacy.entries['outline.widget#1']
  assert.equal(widget.maximized, true, '全屏就是最大化')
  assert.equal(widget.minimized, 'tab', '气泡折成侧缘标签')
  assert.deepEqual(widget.geometry, { ...DEFAULT_FLOATING_GEOMETRY }, 'v1 全屏没留矩形，给一份可拖的')

  assert.equal(legacy.entries['notes.editor#1'].maximized, true, '沉浸也是最大化')
  assert.equal(migrateV1Entry({ pane: 'x.y', placement: 'split' }, 'x.y#1').tiledWith, null, 'v1 分屏没有搭档可复原，回浮窗')
})

test('贴靠净化：单边指向作废；两边同侧按实例 id 补成左／右', () => {
  const entries = {
    'a.one#1': { ...defaultEntry('a.one'), instance: 'a.one#1', tiledWith: 'b.two#1', tileSide: 'left' },
    'b.two#1': { ...defaultEntry('b.two'), instance: 'b.two#1', tiledWith: null, tileSide: null },
    'c.three#1': { ...defaultEntry('c.three'), instance: 'c.three#1', tiledWith: 'd.four#1', tileSide: 'left' },
    'd.four#1': { ...defaultEntry('d.four'), instance: 'd.four#1', tiledWith: 'c.three#1', tileSide: 'left' }
  }
  reconcileTiles(entries)
  assert.equal(entries['a.one#1'].tiledWith, null, '搭档没指回来就作废')
  assert.equal(entries['a.one#1'].tileSide, null)
  assert.equal(entries['c.three#1'].tileSide, 'left')
  assert.equal(entries['d.four#1'].tileSide, 'right', '同侧脏档补成一对')
})

test('normalizeEntry：搭档指向自己算脏；未知字段丢弃', () => {
  const entry = normalizeEntry({
    instance: 'outline.tree#1',
    pane: 'outline.tree',
    tiledWith: 'outline.tree#1',
    tileSide: 'left',
    placement: 'overlay',
    pinned: true,
    mystery: 1,
    geometry: { x: 1, y: 2, w: 300, h: 300 }
  })
  assert.equal(entry.tiledWith, null, '分屏没有「自己跟自己」')
  assert.equal(entry.tileSide, null)
  assert.equal('placement' in entry, false)
  assert.equal('pinned' in entry, false)
  assert.equal('mystery' in entry, false)
})

test('持久化：attachPersistence 收到整份快照；save 抛错只记 degraded，不拦状态机', () => {
  const store = createWorkspaceStore()
  const seen = []
  store.attachPersistence((snapshot) => {
    seen.push(snapshot)
    return { ok: true }
  })
  store.open('outline.tree#1', { geometry: { x: 20, y: 30, w: 500, h: 400 } })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].entries['outline.tree#1'].geometry, { x: 20, y: 30, w: 500, h: 400 })
  assert.equal(seen[0].version, WORKSPACE_VERSION)
  assert.equal(store.snapshot().persistent, true)

  store.attachPersistence(() => {
    throw new Error('disk full')
  })
  const result = store.minimize('outline.tree#1', 'tab')
  assert.equal(result.ok, true, '落盘失败不拦本次会话')
  assert.equal(store.get('outline.tree#1').minimized, 'tab')
  assert.equal(store.snapshot().persistent, false, 'degraded 要如实报给界面')
})

test('老键迁移：paneForm./overlay. 搬进 #1，成功后删键；已有记录不覆盖', () => {
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
  assert.deepEqual(widget.geometry, { x: 120, y: 64, w: DEFAULT_FLOATING_GEOMETRY.w, h: DEFAULT_FLOATING_GEOMETRY.h }, 'snap 退场，w/h 用缺省')
  assert.equal(store.get('novel.editor#1').maximized, true, '老全屏＝最大化')

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

  store.open('outline.widget#1', { geometry: { x: 10, y: 10, w: 500, h: 400 } })
  const result = migrateLegacyWorkspace({ store, storage, paneIds: ['outline.widget'] })
  assert.equal(result.migrated, 0, '新真相优先：已有记录不被老键覆盖')
  assert.deepEqual(store.get('outline.widget#1').geometry, { x: 10, y: 10, w: 500, h: 400 })
  assert.equal(storage.getItem('paneForm.outline.widget'), null, '搬过（或已有记录）的形态键可以退场')
})

test('老键迁移：只有位置没有形态也算「它曾浮着」；老 dock 不凭空开窗', () => {
  const storage = memoryStorage({
    'overlay.notes.editor': JSON.stringify({ left: 20, top: 40 }),
    'paneForm.outline.tree': 'dock'
  })
  const store = createWorkspaceStore()
  const result = migrateLegacyWorkspace({ store, storage, paneIds: ['notes.editor', 'outline.tree'] })
  assert.equal(result.migrated, 1)
  assert.deepEqual(store.get('notes.editor#1').geometry, { x: 20, y: 40, w: DEFAULT_FLOATING_GEOMETRY.w, h: DEFAULT_FLOATING_GEOMETRY.h })
  assert.equal(store.get('outline.tree#1'), null, '停靠栏不是窗口')
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
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', geometry: { x: 10, y: 20, w: 500, h: 400 }, z: 1, minimized: 'none', maximized: false, tiledWith: null, tileSide: null }
    }
  }
  const first = await disk.write(snapshot)
  assert.equal(first.ok, true)
  assert.equal(first.value.skipped, false)
  const onDisk = JSON.parse(await readFile(workspacePath(root), 'utf-8'))
  assert.deepEqual(onDisk, snapshot)

  const second = await disk.write(snapshot)
  assert.equal(second.value.skipped, true, '内容没变不该再写一次盘')
  assert.equal((await disk.write({ version: 1, entries: {} })).ok, false, '旧版本直接拒写')
})

test('磁盘层：version:1 旧档照常读出（version 原样），交给渲染层迁移', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-workspace-v1-'))
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(workspacePath(root), JSON.stringify({
    version: 1,
    entries: {
      'novel.editor#1': { pane: 'novel.editor', placement: 'fullscreen', minimized: 'none', geometry: null }
    }
  }), 'utf-8')

  const disk = createFileWorkspaceStore({ root })
  const read = await disk.read()
  assert.equal(read.value.version, 1, '磁盘层不把 v1 改写成 v2——迁移归渲染层')
  assert.deepEqual(read.value.warnings, [])

  const store = createWorkspaceStore({ initial: read.value })
  const entry = store.get('novel.editor#1')
  assert.equal(entry.maximized, true)
  assert.deepEqual(entry.geometry, { ...DEFAULT_FLOATING_GEOMETRY })
})

test('磁盘层：没有项目根时报错，不造孤儿文件', () => {
  assert.throws(() => createFileWorkspaceStore({ root: '' }), /需要项目根/u)
})
