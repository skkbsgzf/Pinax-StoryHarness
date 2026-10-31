import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm as rmFile, writeFile } from 'node:fs/promises'
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

test('陈账自愈（批次30 补）：账上有记录而磁盘上文件已被删 → 按未建档处理，expectedRevision 0 能重建同名文件', async () => {
  const { service, root, workspace } = await setup()
  try {
    const made = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '被删章.md', text: '一版', expectedRevision: 0 })
    assert.equal(made.ok, true, JSON.stringify(made.error ?? {}))

    // 作者在盘外删掉文件（账本不知情——整目录拷贝/外部删除都会造成这种账实分离）。
    await rmFile(join(root, '正文', '被删章.md'))

    // 重建同名：不该被「账上的第 1 版」挡住；读也不再虚报修订号。
    const again = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '被删章.md', text: '重写', expectedRevision: 0 })
    assert.equal(again.ok, true, String(again.error?.message || ''))
    assert.equal(again.value.revision, 1)

    const reread = await service.read({ pluginId: 'fixture.novel', dir: '正文', file: '被删章.md' })
    assert.equal(reread.ok, true)
    assert.equal(reread.value.text, '重写')
    assert.equal(reread.value.revision, 1)
  } finally {
    await workspace.cleanup()
  }
})

test('目录递归归认领者（工单B）：list/read/write 接受「dataDir 名＋子路径」，归属与作用域仍按一级目录判', async () => {
  const { service, root, workspace } = await setup()
  try {
    await mkdir(join(root, '正文', '第一卷'), { recursive: true })
    await writeFile(join(root, '正文', '第一卷', '第001章-雨夜.md'), '雨夜。', 'utf-8')

    // list：dir 用子路径形态也列得到（此前精确匹配 dataDir 名，直接 DIR_CONFLICT）。
    const listed = await service.list({ pluginId: 'fixture.novel', dir: '正文/第一卷' })
    assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
    assert.deepEqual(listed.value.entries.map((entry) => entry.name), ['第001章-雨夜.md'])

    // read：两种写法等价——（一级 dir＋file 子路径）与（子路径 dir＋文件名）。
    const byFlat = await service.read({ pluginId: 'fixture.novel', dir: '正文', file: '第一卷/第001章-雨夜.md' })
    const bySubdir = await service.read({ pluginId: 'fixture.novel', dir: '正文/第一卷', file: '第001章-雨夜.md' })
    assert.equal(byFlat.ok, true, JSON.stringify(byFlat.error ?? {}))
    assert.equal(bySubdir.ok, true, JSON.stringify(bySubdir.error ?? {}))
    assert.equal(bySubdir.value.relativePath, '正文/第一卷/第001章-雨夜.md')
    assert.equal(bySubdir.value.text, '雨夜。')

    // write：dir 用子路径形态同样落进 正文/第一卷/…（作用域按 正文 的 rw 判）。
    const written = await service.write({ pluginId: 'fixture.novel', dir: '正文/第一卷', file: '第002章-雪夜.md', text: '雪夜。', expectedRevision: 0 })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
    assert.equal(written.value.relativePath, '正文/第一卷/第002章-雪夜.md')
    assert.equal(await readFile(join(root, '正文', '第一卷', '第002章-雪夜.md'), 'utf-8'), '雪夜。')

    // 前缀只认带 `/` 的完整一段：「正文2」不是 正文 的子路径。
    const trap = await service.list({ pluginId: 'fixture.novel', dir: '正文2' })
    assert.equal(trap.ok, false)
    assert.equal(trap.error.code, 'PINAX_DIR_CONFLICT')

    // 子路径仍过 C2：.. 不能借子路径形态绕出板块。
    const escape = await service.list({ pluginId: 'fixture.novel', dir: '正文/../世界书' })
    assert.equal(escape.ok, false)
    assert.equal(escape.error.code, 'PINAX_PATH_OUTSIDE_PROJECT')

    // 归属不因子路径放宽：别人的板块写不进 正文/第一卷。
    const foreign = await service.write({ pluginId: 'fixture.worldbook', dir: '正文/第一卷', file: '偷写.md', text: 'x', expectedRevision: 0 })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, 'PINAX_DIR_CONFLICT')
  } finally {
    await workspace.cleanup()
  }
})

async function setupDestructive(snapshot) {
  const workspace = await createTempWorkspace('fs-destructive')
  const root = await workspace.projectPath('删改靶子')
  for (const dir of PROJECT_KINDS.novel) await mkdir(join(root, dir), { recursive: true })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(FIXTURE_NOVEL)
  registry.install(FIXTURE_WORLDBOOK)
  const service = createFileService({ root, registry, snapshot })
  await service.init()
  return { workspace, root, registry, service }
}

test('受控删除（批次46A）：先强制快照再删盘；账本清条目；不存在如实报错', async () => {
  const calls = []
  const { service, root, workspace } = await setupDestructive(async ({ root: passedRoot, paths }) => {
    calls.push({ root: passedRoot, paths })
    return { ok: true, value: { committed: true, oid: 'f'.repeat(40) } }
  })
  try {
    const created = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md', text: '雨从檐口滴下来。', expectedRevision: 0 })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))

    const deleted = await service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md' })
    assert.equal(deleted.ok, true, JSON.stringify(deleted.error ?? {}))
    assert.equal(deleted.value.relativePath, '正文/第001章-入场.md')
    assert.equal(deleted.value.deleted, true)
    assert.deepEqual(calls, [{ root, paths: ['正文/第001章-入场.md'] }], '删之前对着这个路径强制快照一次')
    assert.equal(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8').then(() => true, () => false), false)
    const state = JSON.parse(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8'))
    assert.equal(state.revisions['正文/第001章-入场.md'], undefined, '账本里不留删掉的文件')

    const again = await service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md' })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'PINAX_INVALID_INPUT')
    assert.equal(calls.length, 1, '文件不存在时不会白跑一次快照')
  } finally {
    await workspace.cleanup()
  }
})

test('受控删除／改名：快照失败即中止，磁盘与账本一个字节不动', async () => {
  const failSnapshot = async () => ({ ok: false, error: { code: 'HISTORY_UNAVAILABLE', message: '历史仓库尚未建立' } })
  const { service, root, workspace } = await setupDestructive(failSnapshot)
  try {
    await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', text: '雪夜。', expectedRevision: 0 })
    const stateBefore = await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8')

    const blocked = await service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md' })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error.code, 'PINAX_IO_FAILED')
    assert.match(blocked.error.message, /快照失败，已中止/)
    assert.equal(await readFile(join(root, '正文', '第002章-雪夜.md'), 'utf-8'), '雪夜。', '快照失败时文件必须还在')
    assert.equal(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8'), stateBefore)

    const renamed = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', nextFile: '第002章-雪夜（改）.md' })
    assert.equal(renamed.ok, false)
    assert.equal(renamed.error.code, 'PINAX_IO_FAILED')
    assert.equal(await readFile(join(root, '正文', '第002章-雪夜.md'), 'utf-8'), '雪夜。', '快照失败时旧名字必须还在')
    assert.equal(await readFile(join(root, '正文', '第002章-雪夜（改）.md'), 'utf-8').then(() => true, () => false), false)
    assert.equal(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8'), stateBefore)
  } finally {
    await workspace.cleanup()
  }
})

test('未审提案保护（批次46A）：指向本章的 proposed 拦下删／改并点名；采纳后即放行', async () => {
  const { service, root, workspace } = await setupDestructive(async () => ({ ok: true, value: { committed: true, oid: 'a'.repeat(40) } }))
  try {
    await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第003章-雨.md', text: '雨。', expectedRevision: 0 })
    const proposal = {
      schema: 'pinax-proposal@1',
      id: 'p-1',
      status: 'proposed',
      target: { index: 0, title: '第003章', file: '正文/第003章-雨.md' },
      content: '雨，停了。',
      contentChars: 4,
      createdAt: '2026-10-31T00:00:00.000Z'
    }
    await service.writeProposal({ name: '待审-雨.json', text: JSON.stringify(proposal, null, 2) })

    for (const attempt of [
      () => service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第003章-雨.md' }),
      () => service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第003章-雨.md', nextFile: '第003章-雨（改）.md' })
    ]) {
      const refused = await attempt()
      assert.equal(refused.ok, false)
      assert.equal(refused.error.code, 'PINAX_INVALID_INPUT')
      assert.deepEqual(refused.error.details.proposals, ['待审-雨.json'])
      assert.match(refused.error.message, /待审-雨\.json/)
    }
    assert.equal(await readFile(join(root, '正文', '第003章-雨.md'), 'utf-8'), '雨。', '拒删／拒改后正文不动')

    // 采纳后提案不再是「待审」：同一个删除放行。
    await service.markProposalStatus({ name: '待审-雨.json', status: 'adopted' })
    const deleted = await service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第003章-雨.md' })
    assert.equal(deleted.ok, true, JSON.stringify(deleted.error ?? {}))
  } finally {
    await workspace.cleanup()
  }
})

test('未审提案保护（批次46A 补刀）：agent 轨 pending 工具调用提案（args.file）同样拦下删／改', async () => {
  const { service, workspace } = await setupDestructive(async () => ({ ok: true, value: { committed: true, oid: 'c'.repeat(40) } }))
  try {
    await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第004章-灯.md', text: '灯。', expectedRevision: 0 })
    const toolCall = {
      schema: 'pinax-proposal@1',
      kind: 'tool-call',
      id: 'tc-1',
      tool: 'pinax_chapter_delete',
      args: { file: '正文/第004章-灯.md' },
      status: 'pending',
      createdAt: '2026-10-31T00:00:00.000Z'
    }
    await service.writeProposal({ name: '待审-删除章.json', text: JSON.stringify(toolCall, null, 2) })

    const refusedDelete = await service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第004章-灯.md' })
    assert.equal(refusedDelete.ok, false)
    assert.deepEqual(refusedDelete.error.details.proposals, ['待审-删除章.json'])
    const refusedRename = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第004章-灯.md', nextFile: '第004章-灯（改）.md' })
    assert.equal(refusedRename.ok, false)
    assert.deepEqual(refusedRename.error.details.proposals, ['待审-删除章.json'])

    // 弃用后即放行：留痕不是待办。
    await service.markProposalStatus({ name: '待审-删除章.json', status: 'discarded' })
    const deleted = await service.deleteFile({ pluginId: 'fixture.novel', dir: '正文', file: '第004章-灯.md' })
    assert.equal(deleted.ok, true, JSON.stringify(deleted.error ?? {}))
  } finally {
    await workspace.cleanup()
  }
})

test('受控改名（批次46A）：只换同目录文件名，账本迁到新名字；跨目录／占名／非法名一律拒', async () => {
  const { service, root, workspace } = await setupDestructive(async () => ({ ok: true, value: { committed: true, oid: 'b'.repeat(40) } }))
  try {
    await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md', text: '入场。', expectedRevision: 0 })
    await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', text: '雪夜。', expectedRevision: 0 })

    const renamed = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场.md', nextFile: '第001章-入场（改）.md' })
    assert.equal(renamed.ok, true, JSON.stringify(renamed.error ?? {}))
    assert.equal(renamed.value.relativePath, '正文/第001章-入场（改）.md')
    assert.equal(renamed.value.previousPath, '正文/第001章-入场.md')
    assert.equal(renamed.value.revision, 1, '旧路径的修订号迁到新路径')
    assert.equal(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8').then(() => true, () => false), false)
    assert.equal(await readFile(join(root, '正文', '第001章-入场（改）.md'), 'utf-8'), '入场。')
    const state = JSON.parse(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8'))
    assert.equal(state.revisions['正文/第001章-入场.md'], undefined)
    assert.equal(state.revisions['正文/第001章-入场（改）.md'], 1)

    // 第二条写作仍按新路径接着记账。
    const second = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-入场（改）.md', text: '入场，改。', expectedRevision: 1 })
    assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
    assert.equal(second.value.revision, 2)

    const crossDir = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', nextFile: '第一卷/第002章-雪夜.md' })
    assert.equal(crossDir.ok, false)
    assert.equal(crossDir.error.code, 'PINAX_INVALID_INPUT')
    assert.match(crossDir.error.message, /同目录/)

    const occupied = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', nextFile: '第001章-入场（改）.md' })
    assert.equal(occupied.ok, false)
    assert.equal(occupied.error.code, 'PINAX_INVALID_INPUT')
    assert.match(occupied.error.message, /已存在/)

    for (const bad of ['', '.', '..', '.隐藏.md']) {
      const rejected = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', nextFile: bad })
      assert.equal(rejected.ok, false, bad)
      assert.equal(rejected.error.code, 'PINAX_INVALID_INPUT', bad)
    }
    const same = await service.renameFile({ pluginId: 'fixture.novel', dir: '正文', file: '第002章-雪夜.md', nextFile: '第002章-雪夜.md' })
    assert.equal(same.ok, false)
    assert.equal(same.error.code, 'PINAX_INVALID_INPUT')

    // 归属闸照旧：别的载体改不了 正文/。
    const foreign = await service.renameFile({ pluginId: 'fixture.worldbook', dir: '正文', file: '第002章-雪夜.md', nextFile: '偷改.md' })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, 'PINAX_DIR_CONFLICT')
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

test('提案列表（工单A）：只解析 .json 提案，坏 JSON 跳过并记账，纯文本散件只给名字与大小', async () => {
  const { service, root, workspace } = await setup()
  try {
    const dir = join(root, '.pinax', 'proposals')
    const older = {
      schema: 'pinax-proposal@1',
      id: '20261027T060000-ch0-aaaaaaaa',
      origin: 'mcp',
      mode: 'review',
      status: 'proposed',
      target: { index: 0, title: '第001章', file: '正文/第001章.md', chars: 6 },
      content: '旧稿新文',
      contentChars: 4,
      note: '先改开场',
      createdAt: '2026-10-27T06:00:00.000Z'
    }
    const newer = {
      ...older,
      id: '20261028T093000-ch1-bbbbbbbb',
      target: { index: 1, title: '第002章', file: '正文/第002章.md', chars: 6 },
      contentChars: 5,
      note: null,
      createdAt: '2026-10-28T09:30:00.000Z'
    }
    await writeFile(join(dir, '20261027T060000-ch0-aaaaaaaa.json'), JSON.stringify(older), 'utf-8')
    await writeFile(join(dir, '20261028T093000-ch1-bbbbbbbb.json'), JSON.stringify(newer), 'utf-8')
    await writeFile(join(dir, '坏掉.json'), '{ 不是 JSON', 'utf-8')
    await writeFile(join(dir, '运行时-建议.md'), '把雨提前一段。', 'utf-8')

    const listed = await service.listProposals()
    assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
    assert.equal(listed.value.total, 2)
    assert.deepEqual(
      listed.value.proposals.map((item) => item.name),
      ['20261028T093000-ch1-bbbbbbbb.json', '20261027T060000-ch0-aaaaaaaa.json'],
      '按 createdAt 降序：新建的提案排在最上面'
    )
    const [first, second] = listed.value.proposals
    assert.equal(first.kind, 'proposal')
    assert.equal(first.id, '20261028T093000-ch1-bbbbbbbb')
    assert.equal(first.status, 'proposed')
    assert.equal(first.target.title, '第002章')
    assert.equal(first.target.file, '正文/第002章.md')
    assert.equal(first.contentChars, 5, 'contentChars 取 JSON 里的原值')
    assert.equal(first.createdAt, '2026-10-28T09:30:00.000Z')
    assert.equal(first.note, null)
    assert.equal(second.note, '先改开场')
    assert.equal(listed.value.warnings.length, 1)
    assert.match(listed.value.warnings[0], /坏掉\.json/)
    assert.deepEqual(
      listed.value.raw.map((item) => [item.name, item.kind, item.bytes]),
      [['运行时-建议.md', 'raw', Buffer.byteLength('把雨提前一段。', 'utf-8')]],
      '非 JSON 的散件只有名字与大小，不冒充可审阅的提案'
    )

    // 目录不存在时如实给空表（不因为少一个目录就把索引窗弄红）。
    const bare = createFileService({ root: join(root, '空项目'), registry: createRegistry({ kinds: Object.keys(PROJECT_KINDS) }) })
    const empty = await bare.listProposals()
    assert.equal(empty.ok, true, JSON.stringify(empty.error ?? {}))
    assert.deepEqual(empty.value.proposals, [])
  } finally {
    await workspace.cleanup()
  }
})

test('提案读／弃／记状态（工单A）：名字只认目录内一层，非法名与坏 JSON 一律拒', async () => {
  const { service, root, workspace } = await setup()
  try {
    const dir = join(root, '.pinax', 'proposals')
    const payload = {
      schema: 'pinax-proposal@1',
      id: 't1',
      status: 'proposed',
      target: { index: 0, title: '第001章', file: '正文/第001章.md' },
      content: '新稿全文',
      contentChars: 4,
      createdAt: '2026-10-28T09:30:00.000Z'
    }
    await writeFile(join(dir, '提案.json'), JSON.stringify(payload, null, 2), 'utf-8')
    await writeFile(join(dir, '坏的.json'), '不是 JSON', 'utf-8')

    const read = await service.readProposal({ name: '提案.json' })
    assert.equal(read.ok, true, JSON.stringify(read.error ?? {}))
    assert.equal(read.value.proposal.content, '新稿全文')
    assert.equal(read.value.path, '.pinax/proposals/提案.json')

    // 路径安全：带分隔符、「..」、空名都拒——提案接口不是「按名字读任意文件」的第二条路。
    for (const bad of ['../提案.json', '子目录/提案.json', '子目录\\提案.json', '..', '', '   ']) {
      const rejected = await service.readProposal({ name: bad })
      assert.equal(rejected.ok, false, bad)
      assert.equal(rejected.error.code, 'PINAX_INVALID_INPUT', bad)
    }
    const missing = await service.readProposal({ name: '没有这份.json' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'PINAX_INVALID_INPUT')

    const badJson = await service.readProposal({ name: '坏的.json' })
    assert.equal(badJson.ok, false)
    assert.equal(badJson.error.code, 'PINAX_INVALID_INPUT')
    assert.match(badJson.error.message, /不是 JSON 提案/)

    // markStatus：只认三档状态；写回 status 字段，正文与目标章原样保留。
    const invalid = await service.markProposalStatus({ name: '提案.json', status: 'merged' })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.error.code, 'PINAX_INVALID_INPUT')
    const marked = await service.markProposalStatus({ name: '提案.json', status: 'adopted' })
    assert.equal(marked.ok, true, JSON.stringify(marked.error ?? {}))
    assert.equal(marked.value.status, 'adopted')
    const disk = JSON.parse(await readFile(join(dir, '提案.json'), 'utf-8'))
    assert.equal(disk.status, 'adopted')
    assert.equal(disk.content, '新稿全文', '状态写回不洗掉提案正文')
    assert.equal(disk.target.title, '第001章')
    assert.equal(typeof disk.statusUpdatedAt, 'string')
    assert.equal((await service.listProposals()).value.proposals[0].status, 'adopted')

    // discard：删提案文件；再删一次如实报不存在；正文目录与修订账一个字节不动。
    const manuscriptBefore = await readdir(join(root, '正文'))
    const stateBefore = await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8').catch(() => '')
    const discarded = await service.discardProposal({ name: '提案.json' })
    assert.equal(discarded.ok, true, JSON.stringify(discarded.error ?? {}))
    assert.deepEqual(discarded.value, { discarded: true, name: '提案.json' })
    assert.equal(await readFile(join(dir, '提案.json'), 'utf-8').then(() => true, () => false), false)
    assert.deepEqual(await readdir(join(root, '正文')), manuscriptBefore)
    assert.equal(await readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8').catch(() => ''), stateBefore)

    const twice = await service.discardProposal({ name: '提案.json' })
    assert.equal(twice.ok, false)
    assert.equal(twice.error.code, 'PINAX_INVALID_INPUT')
    for (const bad of ['../正文/第001章.md', '..', '子目录/提案.json']) {
      const rejected = await service.discardProposal({ name: bad })
      assert.equal(rejected.ok, false, bad)
      assert.equal(rejected.error.code, 'PINAX_INVALID_INPUT', bad)
    }
  } finally {
    await workspace.cleanup()
  }
})

test('只读分页口 readRange（批次55）：字节区间、UTF-8 边界对齐、revision 与整读一致且不写修订账', async () => {
  const { service, root, workspace } = await setup()
  try {
    const body = '甲A乙。沈青梧推开门。'
    await writeFile(join(root, '正文', '第005章-分页.md'), body, 'utf-8')
    const readState = () => readFile(join(root, '.pinax', 'state', 'revisions.json'), 'utf-8').catch(() => '')
    const stateBefore = await readState()
    const bytes = Buffer.from(body, 'utf-8')

    // 未记账的既有文件：分页读按第 1 版报，但不把它写进账本。
    const first = await service.readRange({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md', from: 0, to: 3 })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.equal(first.value.text, '甲')
    assert.equal(first.value.revision, 1)
    assert.equal(first.value.totalBytes, bytes.length)
    assert.equal(await readState(), stateBefore, '分页读不写 revisions 账')

    // 端点切在多字节字符中间：向外扩到完整字符，文本里不出现半个字符。
    const inside = await service.readRange({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md', from: 1, to: 2 })
    assert.equal(inside.ok, true, JSON.stringify(inside.error ?? {}))
    assert.equal(inside.value.text, '甲')
    assert.equal(inside.value.from, 0, '起点前移到字符首字节')
    assert.equal(inside.value.to, 3, '终点后移到字符结束')
    assert.equal(inside.value.startExpandedBy, 1)
    assert.equal(inside.value.endExpandedBy, 1)
    assert.equal(inside.value.text.includes('\uFFFD'), false, 'UTF-8 边界不截断字符')

    // 整读与分页读同一口径：未记账文件都报第 1 版（整读会建档，这是既有读语义）。
    const whole = await service.read({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md' })
    assert.equal(whole.value.revision, first.value.revision)

    // 记账后接着写一版：分页读与整读都报第 2 版。
    const saved = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md', text: body, expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    const after = await service.readRange({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md', from: 0, to: 3 })
    const reread = await service.read({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md' })
    assert.equal(after.value.revision, 2)
    assert.equal(after.value.revision, reread.value.revision, '分页读的 revision 与整读一致')

    // 越界请求钳到文件尾：空区间不报错，eof 如实。
    const eof = await service.readRange({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md', from: bytes.length, to: bytes.length + 10 })
    assert.equal(eof.ok, true, JSON.stringify(eof.error ?? {}))
    assert.equal(eof.value.text, '')
    assert.equal(eof.value.eof, true)
    assert.equal(eof.value.from, bytes.length)

    // 非法区间与缺文件如实拒；归属闸照走。
    for (const bad of [
      { from: -1, to: 3 },
      { from: 3, to: 3 },
      { from: 0, to: 1.5 }
    ]) {
      const rejected = await service.readRange({ pluginId: 'fixture.novel', dir: '正文', file: '第005章-分页.md', ...bad })
      assert.equal(rejected.ok, false, JSON.stringify(bad))
      assert.equal(rejected.error.code, 'PINAX_INVALID_INPUT', JSON.stringify(bad))
    }
    const missing = await service.readRange({ pluginId: 'fixture.novel', dir: '正文', file: '没有.md', from: 0, to: 1 })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'PINAX_INVALID_INPUT')
    const foreign = await service.readRange({ pluginId: 'fixture.worldbook', dir: '正文', file: '第005章-分页.md', from: 0, to: 1 })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, 'PINAX_DIR_CONFLICT')

    // 只读授权（file:世界书:r）也能分页读：作用域闸按 read 判。
    const readOnlyArchive = withMutation(FIXTURE_WORLDBOOK, (m) => {
      m.id = 'fixture.archive'
      m.title = '归档（只读夹具）'
      m.tools = ['archive.list']
      m.capabilities = []
      m.scopes = ['file:世界书:r']
    })
    await writeFile(join(root, '世界书', '角色.md'), '李二', 'utf-8')
    const withArchive = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    withArchive.install(FIXTURE_NOVEL)
    withArchive.install(FIXTURE_WORLDBOOK)
    withArchive.install(readOnlyArchive)
    const scoped = createFileService({ root, registry: withArchive })
    await scoped.init()
    const granted = await scoped.readRange({ pluginId: 'fixture.archive', dir: '世界书', file: '角色.md', from: 0, to: 3 })
    assert.equal(granted.ok, true, JSON.stringify(granted.error ?? {}))
    assert.equal(granted.value.text, '李')
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
