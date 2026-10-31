import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS, PROJECT_SPEC } from '../kernel/projectSkeleton.mjs'
import { createProject, initBareProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { buildArchiveView, setCarrierEnabled, setPrimaryCarrier } from '../project/carriers.mjs'
import { readProjectDocument, validateProjectDocument } from '../project/projectManifest.mjs'
import { FIXTURE_EXPERIENCE, FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_WORLDBOOK } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

function registryWith(...manifests) {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const manifest of manifests) registry.install(manifest)
  return registry
}

test('建项目：固化中文骨架 ＋ 每个板块自己的文件夹，一次落齐', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '大梦·新建')
  try {
    const registry = registryWith(FIXTURE_NOVEL, FIXTURE_WORLDBOOK, FIXTURE_SCRIPT)
    const created = await createProject({ root, name: '大梦·新建', primaryCarrier: 'fixture.novel', registry, extraEnabled: ['fixture.worldbook'] })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    const dirs = await readdir(root)
    for (const dir of PROJECT_KINDS.novel) assert.ok(dirs.includes(dir), `骨架目录「${dir}」必须落盘`)
    assert.deepEqual(created.value.document.carriers.enabled.sort(), ['fixture.novel', 'fixture.worldbook'].sort())
    const doc = JSON.parse(await readFile(join(root, '.pinax', 'project.json'), 'utf-8'))
    assert.equal(doc.spec, PROJECT_SPEC)
    assert.equal(doc.schemaVersion, 3)
    assert.equal(doc.kind, 'novel')
    assert.equal(doc.carriers.primary, 'fixture.novel')
  } finally {
    await workspace.cleanup()
  }
})

test('R4：主载体的依赖闭包装不齐就拒绝建项目', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '只有体验没有剧本')
  try {
    const registry = registryWith(FIXTURE_NOVEL, FIXTURE_EXPERIENCE)
    const created = await createProject({ root, name: '半成品', primaryCarrier: 'fixture.experience', registry })
    assert.equal(created.ok, false)
    assert.equal(created.error.code, 'PINAX_DEPENDENCY_UNMET')
    assert.match(created.error.message, /想玩游戏却没有剧本/)
    assert.equal(created.error.details.repairs.length >= 1, true)
    const dirs = await readdir(root).catch(() => [])
    assert.deepEqual(dirs, [], '被拒绝的建项目不能留下半个骨架')
  } finally {
    await workspace.cleanup()
  }
})

test('闭包能装齐时，剧本随体验一起进来', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '补齐依赖')
  try {
    const registry = registryWith(FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_EXPERIENCE)
    const created = await createProject({ root, name: '补齐依赖', primaryCarrier: 'fixture.experience', registry })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    assert.deepEqual(created.value.enabled.sort(), ['fixture.experience', 'fixture.script'])
    const dirs = await readdir(root)
    assert.ok(dirs.includes('剧本'), '剧本板块的文件夹随注册一起建出来')
  } finally {
    await workspace.cleanup()
  }
})

test('建项目拒绝非空目录（作者原稿永远只读）', async () => {
  const workspace = await createTempWorkspace('project')
  const dirty = await workspace.dirtyDir('已有稿子')
  try {
    const registry = registryWith(FIXTURE_NOVEL)
    const created = await createProject({ root: dirty, name: '覆盖测试', primaryCarrier: 'fixture.novel', registry })
    assert.equal(created.ok, false)
    assert.equal(created.error.code, 'PINAX_INVALID_INPUT')
    assert.match(created.error.message, /非空/)
    const entries = await readdir(join(dirty, '已存在'))
    assert.deepEqual(entries, ['notes.md'], '原稿目录一个文件都不能少')
  } finally {
    await workspace.cleanup()
  }
})

test('D1：不指定主载体就不许建项目', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '没主载体')
  try {
    const registry = registryWith(FIXTURE_NOVEL)
    const created = await createProject({ root, name: '没主载体', primaryCarrier: null, registry })
    assert.equal(created.ok, false)
    assert.equal(created.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')
  } finally {
    await workspace.cleanup()
  }
})

test('M1 空框架：只有 .pinax 的裸项目能建、能开、不报错，只停在选主载体', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '裸项目')
  try {
    const created = await initBareProject({ root, name: '裸项目' })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    assert.deepEqual((await readdir(root)).sort(), ['.pinax'], '空框架不建任何内容目录')

    const registry = registryWith()
    const opened = await openProject({ root, registry })
    assert.equal(opened.ok, false)
    assert.equal(opened.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')
    assert.match(opened.error.message, /主载体/)

    const doc = await readProjectDocument(root)
    assert.equal(doc.ok, true)
    assert.equal(doc.value.needsPrimary, true)
    assert.equal(doc.value.kind, null)
  } finally {
    await workspace.cleanup()
  }
})

test('读侧兼容：服务端老合同 pinax-project@1 能被 Next 读成 @2 形态', () => {
  const legacy = {
    schemaVersion: 1,
    spec: 'pinax-project@1',
    projectId: 'proj_legacy',
    name: '老轨项目',
    kind: 'novel',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z'
  }
  const result = validateProjectDocument(legacy)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.equal(result.value.spec, PROJECT_SPEC)
  assert.equal(result.value.legacySpec, 'pinax-project@1')
  assert.equal(result.value.needsPrimary, true, '老项目没有 carriers，必须让人点一次主载体而不是替他猜')
  assert.equal(result.value.carriers.revision, 0)
})

test('启停落盘：revision 乐观并发，冲突即拒', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '启停')
  try {
    const registry = registryWith(FIXTURE_NOVEL, FIXTURE_WORLDBOOK)
    await createProject({ root, name: '启停', primaryCarrier: 'fixture.novel', registry })

    const stale = await setCarrierEnabled({ root, registry, pluginId: 'fixture.worldbook', enabled: true, expectedRevision: 99 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'PINAX_STALE_REVISION')

    const toggled = await setCarrierEnabled({ root, registry, pluginId: 'fixture.worldbook', enabled: true, expectedRevision: 1 })
    assert.equal(toggled.ok, true, JSON.stringify(toggled.error ?? {}))
    assert.equal(toggled.value.carriers.revision, 2)
    assert.deepEqual(toggled.value.carriers.enabled.sort(), ['fixture.novel', 'fixture.worldbook'].sort())
  } finally {
    await workspace.cleanup()
  }
})

test('C7＋D5：切主载体改的是 carriers，目录留在磁盘上并进归档视图', async () => {
  const workspace = await createTempWorkspace('project')
  const root = join(workspace.projects, '切主载体')
  try {
    const registry = registryWith(FIXTURE_NOVEL, FIXTURE_WORLDBOOK, FIXTURE_SCRIPT)
    await createProject({ root, name: '切主载体', primaryCarrier: 'fixture.novel', registry, extraEnabled: ['fixture.worldbook'] })

    const switched = await setPrimaryCarrier({ root, registry, pluginId: 'fixture.script', expectedRevision: 1 })
    assert.equal(switched.ok, true, JSON.stringify(switched.error ?? {}))
    assert.equal(switched.value.document.carriers.primary, 'fixture.script')
    assert.equal(switched.value.document.kind, 'screenplay', '主载体决定项目类型（D1）')

    const disabled = await setCarrierEnabled({ root, registry, pluginId: 'fixture.novel', enabled: false, expectedRevision: 2 })
    assert.equal(disabled.ok, true, JSON.stringify(disabled.error ?? {}))

    const dirs = await readdir(root)
    for (const dir of ['正文', '世界书']) assert.ok(dirs.includes(dir), `停用后「${dir}」仍需在磁盘上（C4：卸载≠删数据）`)

    const opened = await openProject({ root, registry })
    assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
    const archived = opened.value.archive.archived.map((item) => item.dir)
    assert.ok(archived.includes('正文'), '无人认领的既有目录必须出现在归档视图')
    assert.equal(opened.value.archive.archived.find((item) => item.dir === '正文').readOnly, true)
  } finally {
    await workspace.cleanup()
  }
})

test('D2：kind 缺失又带主载体的坏合同直接拒，不回落 novel', async () => {
  const workspace = await createTempWorkspace('project')
  const root = await workspace.projectPath('坏合同')
  try {
    await mkdir(join(root, '.pinax'), { recursive: true })
    await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify({
      spec: PROJECT_SPEC,
      schemaVersion: 2,
      projectId: 'proj_broken',
      name: '坏合同',
      kind: null,
      createdAt: '2026-10-27T00:00:00.000Z',
      updatedAt: '2026-10-27T00:00:00.000Z',
      carriers: { primary: 'fixture.novel', enabled: ['fixture.novel'], revision: 1 }
    }), 'utf-8')
    const registry = registryWith(FIXTURE_NOVEL)
    const opened = await openProject({ root, registry })
    assert.equal(opened.ok, false)
    assert.equal(opened.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')
    const view = await buildArchiveView({ root, view: null })
    assert.equal(view.ok, true)
  } finally {
    await workspace.cleanup()
  }
})

test('legacy @1 文档（MCP 时代，无 carriers）：打开时按 kind 确定性推导主载体并升到当前合同（批次16 验收修）', async () => {
  const ws = await createTempWorkspace('legacy')
  const root = join(ws.projects, '大梦')
  await mkdir(join(root, '.pinax'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  // MCP 时代的形态：spec @1、kind 明确、没有任何 carriers 字段
  await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify({
    schemaVersion: 1,
    spec: 'pinax-project@1',
    projectId: 'proj_legacy_dameng',
    name: '大梦',
    kind: 'novel',
    createdAt: '2026-10-26T16:54:39.645Z',
    updatedAt: '2026-10-26T16:54:39.645Z'
  }, null, 2), 'utf-8')

  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_WORLDBOOK)
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  assert.equal(opened.value.document.carriers.primary, FIXTURE_NOVEL.id, '按 kind=novel 推导出小说主载体')
  assert.equal(opened.value.document.spec, PROJECT_SPEC, '打开即升到当前合同')
  assert.equal(opened.value.document.needsPrimary, false)

  // 升级落盘：重读磁盘文档，carriers 已持久化
  const reread = JSON.parse(await readFile(join(root, '.pinax', 'project.json'), 'utf-8'))
  assert.equal(reread.spec, PROJECT_SPEC)
  assert.equal(reread.carriers.primary, FIXTURE_NOVEL.id)

  // kind 无匹配载体时：仍停在主载体闸，不猜
  await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify({
    schemaVersion: 1, spec: 'pinax-project@1', projectId: 'proj_x', name: '未知类型稿', kind: 'poetry',
    createdAt: '2026-10-26T16:54:39.645Z', updatedAt: '2026-10-26T16:54:39.645Z'
  }, null, 2), 'utf-8')
  const stopped = await openProject({ root, registry })
  assert.equal(stopped.ok, false)
  assert.equal(stopped.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')
})

test('@2 文档读兼容：打开不擅改盘，落盘时机到了才写回 @3', async () => {
  const ws = await createTempWorkspace('legacy2')
  const root = join(ws.projects, '大梦-旧合同')
  await mkdir(join(root, '.pinax'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  const legacyDoc = {
    schemaVersion: 2,
    spec: 'pinax-project@2',
    projectId: 'proj_legacy2',
    name: '大梦-旧合同',
    kind: 'novel',
    createdAt: '2026-10-26T16:54:39.645Z',
    updatedAt: '2026-10-26T16:54:39.645Z',
    carriers: { primary: 'fixture.novel', enabled: ['fixture.novel'], revision: 4 }
  }
  await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify(legacyDoc, null, 2), 'utf-8')

  const registry = registryWith(FIXTURE_NOVEL)
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  assert.equal(opened.value.document.spec, PROJECT_SPEC, '内存里按当前合同呈现')
  assert.equal(opened.value.document.carriers.revision, 4, 'revision 原样保留')

  const untouched = JSON.parse(await readFile(join(root, '.pinax', 'project.json'), 'utf-8'))
  assert.equal(untouched.spec, 'pinax-project@2', '只打开不写盘：不擅自改作者的项目文件')

  // 真正落盘的时机（切主载体／启停）：此时才把 @2 写回 @3。
  const switched = await setPrimaryCarrier({ root, registry, pluginId: 'fixture.novel', expectedRevision: 4 })
  assert.equal(switched.ok, true, JSON.stringify(switched.error ?? {}))
  const upgraded = JSON.parse(await readFile(join(root, '.pinax', 'project.json'), 'utf-8'))
  assert.equal(upgraded.spec, PROJECT_SPEC)
  assert.equal(upgraded.schemaVersion, 3)
  assert.equal(upgraded.carriers.revision, 5)
})
