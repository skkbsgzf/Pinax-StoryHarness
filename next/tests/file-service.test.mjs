import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { createFileService } from '../fs/fileService.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { FIXTURE_NOVEL, FIXTURE_WORLDBOOK, withMutation } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

async function setup(extraManifests = []) {
  const workspace = await createTempWorkspace('fs')
  const root = await workspace.projectPath('大梦-测试')
  for (const dir of PROJECT_KINDS.novel) await mkdir(join(root, dir), { recursive: true })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(FIXTURE_NOVEL)
  registry.install(FIXTURE_WORLDBOOK)
  for (const manifest of extraManifests) registry.install(manifest)
  const service = createFileService({ root, registry })
  await service.init()
  return { workspace, root, registry, service }
}

test('C3 归属闸：写别人的板块目录即拒', async () => {
  const { service, workspace } = await setup()
  try {
    const foreign = await service.write({ pluginId: 'fixture.worldbook', dir: '正文', file: '偷改.md', text: 'x', expectedRevision: 0 })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, 'PINAX_DIR_CONFLICT')
    assert.match(foreign.error.message, /未认领目录/)
  } finally {
    await workspace.cleanup()
  }
})

test('第 7 节作用域闸：只申请 r 的板块不能写', async () => {
  const readOnlyArchive = withMutation(FIXTURE_WORLDBOOK, (m) => {
    m.id = 'fixture.archive'
    m.title = '归档（只读夹具）'
    m.tools = ['archive.list']
    m.capabilities = []
    m.scopes = ['file:世界书:r']
  })
  const { service, workspace } = await setup([readOnlyArchive])
  try {
    const denied = await service.write({ pluginId: 'fixture.archive', dir: '世界书', file: '角色.md', text: '李二', expectedRevision: 0 })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'PINAX_SCOPE_NOT_GRANTED')
    assert.match(denied.error.message, /写入需要 file:世界书:rw/)

    const read = await service.read({ pluginId: 'fixture.archive', dir: '世界书', file: '角色.md' })
    assert.equal(read.ok, false)
    assert.equal(read.error.code, 'PINAX_INVALID_INPUT', '只读授权允许读，文件不存在才报不存在')
  } finally {
    await workspace.cleanup()
  }
})

test('写入→读回→修订并发：STALE_REVISION 不覆盖', async () => {
  const { service, root, workspace } = await setup()
  try {
    const first = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md', text: '雨从檐口滴下来。', expectedRevision: 0 })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.equal(first.value.revision, 1)

    const stale = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md', text: '被推翻的写法', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'PINAX_STALE_REVISION')
    assert.equal(stale.error.details.actual, 1)

    const disk = await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8')
    assert.equal(disk, '雨从檐口滴下来。', '并发拒绝后磁盘上必须还是原内容')

    const second = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md', text: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1 })
    assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
    assert.equal(second.value.revision, 2)

    const read = await service.read({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md' })
    assert.equal(read.value.revision, 2)
    assert.equal(read.value.text, '雨从檐口滴下来，巷子里没人。')

    const state = JSON.parse(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8'))
    assert.equal(state.revisions['正文/第001章-入场.md'], 2)
  } finally {
    await workspace.cleanup()
  }
})

test('C2 越界路径与 .pinax 直写一律拒绝', async () => {
  const { service, workspace } = await setup()
  try {
    const escape = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '../../逃逸.md', text: 'x', expectedRevision: 0 })
    assert.equal(escape.ok, false)
    assert.equal(escape.error.code, 'PINAX_PATH_OUTSIDE_PROJECT')

    const metadata = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '../.pinax/project.json', text: '{}', expectedRevision: 0 })
    assert.equal(metadata.ok, false)
    assert.equal(metadata.error.code, 'PINAX_PATH_OUTSIDE_PROJECT')

    const missing = await service.read({ pluginId: 'fixture.novel', dir: '大纲', file: '不存在.md' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'PINAX_INVALID_INPUT')
  } finally {
    await workspace.cleanup()
  }
})

test('运行时的写回只进 .pinax/proposals/，正文一个字节都不动', async () => {
  const { service, root, workspace } = await setup()
  try {
    await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第003章.md', text: '原本的开场。', expectedRevision: 0 })
    const listing = async () => (await readdir(join(root, '正文'))).sort()
    const revisions = async () => JSON.parse(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8'))
    const before = await listing()
    const beforeState = await revisions()

    const proposal = await service.writeProposal({ name: '改稿提案-开场.md', text: '建议：把雨提前一段。' })
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error ?? {}))
    assert.match(await readFile(proposal.value.path, 'utf-8'), /把雨提前一段/)

    assert.deepEqual(await listing(), before, '提案不得触碰正文目录')
    assert.deepEqual(await revisions(), beforeState, '提案不得推进正文修订号')
  } finally {
    await workspace.cleanup()
  }
})

test('崩溃恢复只清 .pinax-tmp-*，不动正文', async () => {
  const { service, root, workspace } = await setup()
  try {
    await writeFile(join(root, '正文', '第002章.md'), '正文内容', 'utf-8')
    await writeFile(join(root, '正文', '.pinax-tmp-deadbeef'), '半成品', 'utf-8')
    const init = await service.init()
    assert.equal(init.ok, true, JSON.stringify(init.error ?? {}))
    assert.deepEqual((await readdir(join(root, '正文'))).sort(), ['第002章.md'])
  } finally {
    await workspace.cleanup()
  }
})

test('onWrite 钩子（D1）：落盘成功后才调用；钩子抛错不影响写入；可摘除', async () => {
  const workspace = await createTempWorkspace('fs-onwrite')
  const root = await workspace.projectPath('历史标脏')
  try {
    for (const dir of PROJECT_KINDS.novel) await mkdir(join(root, dir), { recursive: true })
    const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    registry.install(FIXTURE_NOVEL)
    const calls = []
    const service = createFileService({ root, registry, onWrite: async (info) => { calls.push(info) } })
    await service.init()

    const first = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章.md', text: '开场。', expectedRevision: 0 })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.deepEqual(calls, [{ root, relativePath: '正文/第001章.md', revision: 1 }], '写盘成功后钩子拿到项目根＋相对路径＋新修订号')

    let throwingCalls = 0
    service.setOnWrite(async () => {
      throwingCalls += 1
      throw new Error('历史标脏失败')
    })
    const second = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章.md', text: '改过的开场。', expectedRevision: 1 })
    assert.equal(second.ok, true, '旁路钩子抛错绝不能把已经落盘的写作翻成失败')
    assert.equal(throwingCalls, 1)

    service.setOnWrite(null)
    const third = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章.md', text: '再改一次。', expectedRevision: 2 })
    assert.equal(third.ok, true)
    assert.equal(throwingCalls, 1, '摘掉钩子后不再调用')
  } finally {
    await workspace.cleanup()
  }
})

test('板块注册即建目录：只补缺，绝不删除', async () => {
  const workspace = await createTempWorkspace('fs-dirs')
  const root = workspace.projects
  try {
    const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    registry.install(FIXTURE_NOVEL)
    const service = createFileService({ root, registry })
    await mkdir(join(root, '正文'), { recursive: true })
    const ensured = await service.ensurePluginDirs('fixture.novel')
    assert.equal(ensured.ok, true, JSON.stringify(ensured.error ?? {}))
    assert.deepEqual(ensured.value.created.sort(), ['大纲', '构思'].sort(), '已存在的目录不重复创建也不报错')
    assert.deepEqual((await readdir(root)).sort(), ['正文', '大纲', '构思'].sort())
  } finally {
    await workspace.cleanup()
  }
})
