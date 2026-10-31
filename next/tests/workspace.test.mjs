import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PLACEMENT,
  GEOMETRY_MAX_W,
  GEOMETRY_MIN_W,
  MINIMIZED_MODES,
  PLACEMENTS,
  WORKSPACE_VERSION,
  createWorkspaceStore,
  instanceIdFor,
  normalizeEntry,
  normalizeGeometry,
  normalizeWorkspace,
  parseInstanceId
} from '../shell/workspace.mjs'
import { migrateLegacyWorkspace, readLegacyWorkspace } from '../shell/workspaceMigration.mjs'
import { createFileWorkspaceStore, workspacePath } from '../workspaceStore.mjs'

/**
 * 工作区四轴单测（M2.5-C 任务一）。
 * 纯 node:test：workspace.mjs 不 import Vue、不碰 localStorage，状态机与迁移都能直接测；
 * 磁盘层（workspaceStore.mjs）用临时目录，测坏文件回落与「内容没变不写」。
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

test('四轴往返：placement/minimized/geometry/restore/z（＋pinned 加法轴）落盘再读回不变形', () => {
  const store = createWorkspaceStore()
  store.place('outline.tree#1', 'overlay')
  store.setGeometry('outline.tree#1', { x: 1180, y: 96, w: 320, h: 520, snap: 'right' })
  store.minimize('outline.tree#1', 'bubble')

  const saved = store.serialize()
  assert.equal(saved.version, WORKSPACE_VERSION)
  const revived = createWorkspaceStore({ initial: saved })
  assert.deepEqual(revived.get('outline.tree#1'), {
    instance: 'outline.tree#1',
    pane: 'outline.tree',
    placement: 'overlay',
    minimized: 'bubble',
    geometry: { x: 1180, y: 96, w: 320, h: 520, snap: 'right' },
    restore: 'overlay',
    z: 1,
    pinned: false
  })
})

test('钉住（批次35）：setPinned 往返落盘；只动 pinned 轴，placement/minimized/geometry 不陪葬', () => {
  const store = createWorkspaceStore()
  store.place('outline.widget#1', 'overlay')
  store.setGeometry('outline.widget#1', { x: 120, y: 64, w: 300, h: 480, snap: null })
  store.minimize('outline.widget#1', 'none')

  const pinned = store.setPinned('outline.widget#1', true)
  assert.equal(pinned.ok, true)
  assert.equal(pinned.changed, true)
  const entry = store.get('outline.widget#1')
  assert.equal(entry.pinned, true)
  assert.equal(entry.placement, 'overlay', '钉的是「现在这个样子」，位置轴不动')
  assert.equal(entry.minimized, 'none')
  assert.deepEqual(entry.geometry, { x: 120, y: 64, w: 300, h: 480, snap: null })

  // true 之外的入参一律按「解除」处理；再点一次（false）解除。
  assert.equal(store.setPinned('outline.widget#1', 'yes').pinned, false)
  assert.equal(store.setPinned('outline.widget#1', true).pinned, true)
  const unpinned = store.setPinned('outline.widget#1', false)
  assert.equal(unpinned.changed, true)
  assert.equal(store.get('outline.widget#1').pinned, false)

  // 往返：存档读回，pinned 还是 true。
  store.setPinned('outline.widget#1', true)
  const revived = createWorkspaceStore({ initial: store.serialize() })
  assert.equal(revived.get('outline.widget#1').pinned, true)

  // 非法实例照常拒绝（空串解析不出实例 id）。
  assert.equal(store.setPinned('', true).error.code, 'INVALID_INSTANCE')
})

test('钉住存档兼容：老存档没有 pinned 当 false；脏值（\'yes\'/1）不进门；未知字段丢弃', () => {
  const normalized = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    entries: {
      // 老存档：没有 pinned 字段。
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', placement: 'overlay', minimized: 'none' },
      // 新存档：pinned 是脏值；顺带带一个宿主不认识的字段。
      'outline.tree#2': { instance: 'outline.tree#2', pane: 'outline.tree', placement: 'overlay', minimized: 'none', pinned: 'yes', mystery: 1 },
      'outline.tree#3': { instance: 'outline.tree#3', pane: 'outline.tree', placement: 'overlay', minimized: 'none', pinned: 1 }
    }
  })
  assert.equal(normalized.warnings.length, 0, '加法字段不许记账（schema version 不动）')
  assert.equal(normalized.entries['outline.tree#1'].pinned, false, '老存档当没钉')
  assert.equal(normalized.entries['outline.tree#2'].pinned, false, "'yes' 不是钉")
  assert.equal(normalized.entries['outline.tree#3'].pinned, false, '1 不是钉')
  assert.equal('mystery' in normalized.entries['outline.tree#2'], false, '未知字段丢弃')
})

test('磁盘层透传加法字段：pinned 写进 .pinax/workspace.json 再读回原样', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-workspace-pin-'))
  const disk = createFileWorkspaceStore({ root })
  const snapshot = {
    version: WORKSPACE_VERSION,
    entries: {
      'outline.widget#1': { instance: 'outline.widget#1', pane: 'outline.widget', placement: 'overlay', minimized: 'none', geometry: null, restore: 'overlay', z: 1, pinned: true }
    }
  }
  const written = await disk.write(snapshot)
  assert.equal(written.ok, true)
  const read = await disk.read()
  assert.equal(read.ok, true)
  assert.equal(read.value.entries['outline.widget#1'].pinned, true, '主进程层不洗 pinned——逐条净化只在 workspace.mjs')
})

test('全屏记来源：从 dock 进全屏、还原回 dock；从 overlay 进则还原回 overlay', () => {
  const store = createWorkspaceStore()
  store.place('novel.editor#1', 'overlay')
  store.place('novel.editor#1', 'fullscreen')
  assert.equal(store.get('novel.editor#1').restore, 'overlay', '全屏要把「从哪来」记下来')
  store.restorePlacement('novel.editor#1')
  assert.equal(store.get('novel.editor#1').placement, 'overlay')

  store.place('notes.editor#1', 'fullscreen')
  assert.equal(store.get('notes.editor#1').restore, 'dock')
  store.restorePlacement('notes.editor#1')
  assert.equal(store.get('notes.editor#1').placement, 'dock', '没有来源记忆时回 dock')
})

test('气泡不丢还原目标与几何：收起→展开回到原位置与原 placement', () => {
  const store = createWorkspaceStore()
  store.place('outline.widget#1', 'overlay')
  store.setGeometry('outline.widget#1', { x: 640, y: 120, w: 300, h: 480, snap: 'left' })
  store.minimize('outline.widget#1', 'bubble')

  const bubble = store.get('outline.widget#1')
  assert.equal(bubble.minimized, 'bubble')
  assert.equal(bubble.placement, 'overlay')
  assert.deepEqual(bubble.geometry, { x: 640, y: 120, w: 300, h: 480, snap: 'left' }, '气泡态只是 minimized，几何留着')

  store.expand('outline.widget#1')
  const expanded = store.get('outline.widget#1')
  assert.equal(expanded.minimized, 'none')
  assert.equal(expanded.placement, 'overlay')
  assert.deepEqual(expanded.geometry, bubble.geometry)
})

test('多实例：同一 pane 开两份，状态互不串；dockPane 收回全部实例', () => {
  const store = createWorkspaceStore()
  store.place('outline.tree#1', 'overlay')
  const second = store.openInstance('outline.tree', { placement: 'overlay' })
  assert.equal(second, 'outline.tree#2')
  assert.deepEqual(store.instancesOf('outline.tree'), ['outline.tree#1', 'outline.tree#2'])

  store.setGeometry('outline.tree#2', { x: 40, y: 80, w: 300, h: 400, snap: null })
  store.minimize('outline.tree#2', 'bubble')
  assert.deepEqual(store.get('outline.tree#1').geometry, null, '#1 不该借到 #2 的位置')
  assert.equal(store.get('outline.tree#1').minimized, 'none')
  assert.equal(store.get('outline.tree#2').minimized, 'bubble')

  const docked = store.dockPane('outline.tree')
  assert.deepEqual(docked.instances.sort(), ['outline.tree#1', 'outline.tree#2'])
  assert.equal(store.get('outline.tree#2').placement, 'dock')
  assert.equal(store.get('outline.tree#2').minimized, 'none')
})

test('解注册清理（批次45）：removePanes 删除该 pane 的全部实例（含 #n），别的 pane 原样', () => {
  const store = createWorkspaceStore()
  store.place('outline.tree#1', 'overlay')
  store.openInstance('outline.tree', { placement: 'overlay' })
  store.setPinned('outline.tree#1', true)
  store.place('outline.widget#1', 'overlay')
  store.setGeometry('outline.widget#1', { x: 40, y: 80, w: 300, h: 400, snap: null })
  store.place('novel.editor#1', 'immersive')

  const removed = store.removePanes(['outline.tree', 'outline.widget'])
  assert.equal(removed.changed, true)
  assert.deepEqual(removed.instances.sort(), ['outline.tree#1', 'outline.tree#2', 'outline.widget#1'])
  assert.equal(store.list().some((entry) => entry.pane.startsWith('outline.')), false, '整族实例记录都应清掉')
  // 缺省实例回到 dock／无几何／未钉住：重启用从干净状态开始。
  const clean = store.get('outline.widget#1')
  assert.equal(clean.placement, DEFAULT_PLACEMENT)
  assert.equal(clean.geometry, null)
  assert.equal(clean.pinned, false)
  assert.equal(store.get('novel.editor#1').placement, 'immersive', '别的载体一个字节都不动')

  const again = store.removePanes(['outline.tree'])
  assert.equal(again.changed, false, '重复清理不改任何东西')
})

test('几何净化：越界钳回值域，形状不对返回 null', () => {
  assert.deepEqual(normalizeGeometry({ x: -20, y: 12, w: 5, h: 99999, snap: 'middle' }), {
    x: 0, y: 12, w: GEOMETRY_MIN_W, h: 2000, snap: null
  })
  assert.equal(normalizeGeometry({ x: 10, y: 20, w: GEOMETRY_MAX_W + 500 }).w, GEOMETRY_MAX_W)
  assert.equal(normalizeGeometry({ x: 'nope', y: 1 }), null)
  assert.equal(normalizeGeometry(null), null)
})

test('坏档回落：不是对象／版本不对／脏条目逐条丢弃并记账', () => {
  assert.deepEqual(normalizeWorkspace('not-a-workspace').warnings, ['WORKSPACE_NOT_OBJECT'])
  const mixed = normalizeWorkspace({
    version: 9,
    entries: {
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', placement: 'overlay', minimized: 'bubble' },
      'broken': { pane: 'nope' },
      'outline.tree#2': 'garbage'
    }
  })
  assert.equal(mixed.version, WORKSPACE_VERSION)
  assert.ok(mixed.warnings.includes('WORKSPACE_VERSION_9'))
  assert.ok(mixed.warnings.includes('WORKSPACE_DROPPED_2'))
  assert.deepEqual(Object.keys(mixed.entries), ['outline.tree#1'], '脏条目只丢自己，不连坐好数据')
  assert.equal(mixed.entries['outline.tree#1'].placement, 'overlay')
  assert.equal(mixed.entries['outline.tree#1'].restore, DEFAULT_PLACEMENT)
})

test('词表：placement 五档（批次45 加沉浸）、minimized 三档；非法值不进门', () => {
  // 批次45：沉浸态是第五档位置（整窗几何同 fullscreen，外壳额外收起活动栏与右栏）。
  assert.deepEqual([...PLACEMENTS], ['dock', 'split', 'overlay', 'fullscreen', 'immersive'])
  assert.deepEqual([...MINIMIZED_MODES], ['none', 'bubble', 'collapsed'])
  const store = createWorkspaceStore()
  assert.equal(store.place('a.b#1', 'window').error.code, 'UNKNOWN_PLACEMENT')
  assert.equal(store.minimize('a.b#1', 'hidden').error.code, 'UNKNOWN_MINIMIZED')
  assert.equal(store.place('NotAPane', 'overlay').error.code, 'INVALID_INSTANCE')
})

test('沉浸态：整窗几何复用全屏的 restore 记忆，退出回到进来之前那一轴', () => {
  const store = createWorkspaceStore()
  store.place('novel.editor#1', 'split')
  const entered = store.place('novel.editor#1', 'immersive')
  assert.equal(entered.ok, true)
  assert.equal(entered.placement, 'immersive')
  assert.equal(store.get('novel.editor#1').restore, 'split', '进入沉浸前记住来源')

  // 整窗→整窗不冲掉来源（与 fullscreen 同一套记忆逻辑）。
  store.place('novel.editor#1', 'fullscreen')
  assert.equal(store.get('novel.editor#1').restore, 'split')
  store.place('novel.editor#1', 'immersive')
  assert.equal(store.get('novel.editor#1').restore, 'split')

  const restored = store.restorePlacement('novel.editor#1')
  assert.equal(restored.ok, true)
  assert.equal(store.get('novel.editor#1').placement, 'split', '退出沉浸回到进入前的位置')

  // 坏存档里 restore=immersive 不采信（整窗不能当还原目标），回落 dock。
  const normalized = normalizeEntry({ instance: 'novel.editor#1', pane: 'novel.editor', placement: 'immersive', restore: 'immersive' })
  assert.equal(normalized.placement, 'immersive')
  assert.equal(normalized.restore, 'dock')
  const store2 = createWorkspaceStore({ initial: { version: 1, entries: { 'novel.editor#1': { pane: 'novel.editor', placement: 'immersive', restore: 'immersive' } } } })
  assert.equal(store2.restorePlacement('novel.editor#1').ok, true)
  assert.equal(store2.get('novel.editor#1').placement, 'dock')
})

test('未声明的 immersive 老存档：老 workspace.json 没有它，读侧照常', () => {
  // 批次45 兼容：老存档只有四档，没有 immersive 字段；normalizeWorkspace 不因此记警告。
  const old = normalizeWorkspace({ version: 1, entries: { 'outline.tree#1': { pane: 'outline.tree', placement: 'dock', minimized: 'none', restore: 'dock' } } })
  assert.deepEqual(old.warnings, [])
  assert.equal(old.entries['outline.tree#1'].placement, 'dock')
})

test('持久化：attachPersistence 收到整份快照；save 抛错只记 degraded，不拦状态机', () => {
  const store = createWorkspaceStore()
  const seen = []
  store.attachPersistence((snapshot) => {
    seen.push(snapshot)
    return { ok: true }
  })
  store.place('outline.tree#1', 'overlay')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].entries['outline.tree#1'].placement, 'overlay')
  assert.equal(store.snapshot().persistent, true)

  store.attachPersistence(() => {
    throw new Error('disk full')
  })
  const result = store.place('outline.tree#1', 'split')
  assert.equal(result.ok, true, '落盘失败不拦本次会话')
  assert.equal(store.get('outline.tree#1').placement, 'split')
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
  assert.equal(widget.placement, 'overlay')
  assert.deepEqual(widget.geometry, { x: 120, y: 64, w: 300, h: 420, snap: 'right' })
  assert.equal(store.get('novel.editor#1').placement, 'fullscreen')
  assert.equal(store.get('novel.editor#1').restore, 'dock', '全屏只有来源未知时才回 dock')

  // 第二遍：老键已没了，什么都不做也不报错。
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

  store.place('outline.widget#1', 'split')
  const result = migrateLegacyWorkspace({ store, storage, paneIds: ['outline.widget'] })
  assert.equal(result.migrated, 0, '新真相优先：已有记录不被老键覆盖')
  assert.equal(store.get('outline.widget#1').placement, 'split')
  assert.equal(storage.getItem('paneForm.outline.widget'), null, '搬过（或已有记录）的形态键可以退场')
})

test('磁盘层：读坏 JSON 回落并记账；写盘原子替换；同内容不重复写', async () => {
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
    version: 1,
    entries: {
      'outline.tree#1': { instance: 'outline.tree#1', pane: 'outline.tree', placement: 'overlay', minimized: 'none', geometry: null, restore: 'overlay', z: 1 }
    }
  }
  const first = await disk.write(snapshot)
  assert.equal(first.ok, true)
  assert.equal(first.value.skipped, false)
  const onDisk = JSON.parse(await readFile(workspacePath(root), 'utf-8'))
  assert.deepEqual(onDisk, snapshot)

  const second = await disk.write(snapshot)
  assert.equal(second.value.skipped, true, '内容没变不该再写一次盘')
  assert.equal((await disk.write({ version: 2, entries: {} })).ok, false, '版本不对直接拒写')
})

test('磁盘层：没有项目根时报错，不造孤儿文件', () => {
  assert.throws(() => createFileWorkspaceStore({ root: '' }), /需要项目根/u)
})
