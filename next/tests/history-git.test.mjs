import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HISTORY_DIRTY_FILE,
  HISTORY_ERROR_CODES,
  commitSnapshot,
  diffVersions,
  ensureHistoryRepo,
  listFileHistory,
  markDirty,
  readVersion
} from '../history/gitHistory.mjs'
import { createFileService } from '../fs/fileService.mjs'

/**
 * D0 历史引擎（R3 裁定）：独立 git-dir `.pinax/history.git` + 内置 isomorphic-git。
 * 覆盖工单点名的六条：两版历史、readVersion 内容、diff 增删行、assets 不入历史、
 * 空脏不提交、非法路径拒绝；另钉住仓库本地身份与「项目根不放 .git」。
 * 全部路径在本进程内拼接，不经过 shell（中文路径坑，见 next/testing/harness.mjs 注释）。
 */

const CHAPTER = '正文/001-第一章 延迟.md'

async function makeProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'pinax-history-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  for (const dir of ['正文', '大纲', '世界书', '构思', '约束', '资料', 'assets']) {
    await mkdir(join(root, dir), { recursive: true })
  }
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(join(root, '.pinax', 'project.json'), '{"spec":"pinax-project@2","name":"历史测试"}\n', 'utf-8')
  const ensured = await ensureHistoryRepo({ root })
  assert.equal(ensured.ok, true, JSON.stringify(ensured.error ?? {}))
  return root
}

test('建仓：独立 git-dir、仓库本地身份 pinax <pinax@local>、项目根没有 .git', async (t) => {
  const root = await makeProject(t)
  const gitdir = join(root, '.pinax', 'history.git')
  const config = await readFile(join(gitdir, 'config'), 'utf-8')
  assert.match(config, /name = pinax/)
  assert.match(config, /email = pinax@local/)
  assert.match(config, /autocrlf = false/, 'Windows 换行必须锁死，否则同一份稿子会反复“变更”')
  assert.match(config, /bare = false/)

  const exclude = await readFile(join(gitdir, 'info', 'exclude'), 'utf-8')
  assert.match(exclude, /\/\.pinax\//)
  assert.match(exclude, /\/assets\//)

  const rootDotGit = await readFile(join(root, '.git'), 'utf-8').then(() => true, () => false)
  assert.equal(rootDotGit, false, '绝不往项目根放 .git（作者的稿子目录可能本身就是别的仓库）')

  const again = await ensureHistoryRepo({ root })
  assert.equal(again.ok, true)
  assert.equal(again.value.created, false, '重复 ensure 是幂等的，不许重建仓库')
})

test('写文件→标脏→提交→改→再提交：listFileHistory 出两版，readVersion 内容正确，diff 有增删行', async (t) => {
  const root = await makeProject(t)
  const firstText = '第一行\n第二行\n第三行\n'
  await writeFile(join(root, CHAPTER), firstText, 'utf-8')

  const dirty = await markDirty({ root, paths: [CHAPTER, CHAPTER] })
  assert.equal(dirty.ok, true, JSON.stringify(dirty.error ?? {}))
  assert.deepEqual(dirty.value.paths, [CHAPTER], '脏清单合并去重')
  const onDisk = JSON.parse(await readFile(join(root, HISTORY_DIRTY_FILE), 'utf-8'))
  assert.deepEqual(onDisk.paths, [CHAPTER])

  const first = await commitSnapshot({ root, message: 'snapshot 一' })
  assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
  assert.equal(first.value.committed, true)
  assert.match(first.value.oid, /^[0-9a-f]{40}$/)
  assert.deepEqual(first.value.files, ['.pinax/project.json', CHAPTER], '允许前缀整树快照（含 project.json）')

  const secondText = '第一行\n第二行改过\n第三行\n新增第四行\n'
  await writeFile(join(root, CHAPTER), secondText, 'utf-8')
  assert.equal((await markDirty({ root, paths: [CHAPTER] })).ok, true)
  const second = await commitSnapshot({ root, message: 'snapshot 二' })
  assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
  assert.equal(second.value.committed, true)
  assert.notEqual(second.value.oid, first.value.oid)

  const history = await listFileHistory({ root, path: CHAPTER, limit: 10 })
  assert.equal(history.ok, true, JSON.stringify(history.error ?? {}))
  assert.equal(history.value.length, 2)
  assert.deepEqual(history.value.map((entry) => entry.message), ['snapshot 二', 'snapshot 一'])
  assert.equal(history.value[0].oid, second.value.oid)
  assert.equal(history.value[1].oid, first.value.oid)
  assert.match(history.value[0].when, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  assert.equal(history.value[0].author, 'pinax')

  const oldVersion = await readVersion({ root, oid: first.value.oid, path: CHAPTER })
  assert.equal(oldVersion.ok, true, JSON.stringify(oldVersion.error ?? {}))
  assert.equal(oldVersion.value, firstText)
  const newVersion = await readVersion({ root, oid: second.value.oid, path: CHAPTER })
  assert.equal(newVersion.ok, true)
  assert.equal(newVersion.value, secondText)

  const diff = await diffVersions({ root, a: first.value.oid, b: second.value.oid, path: CHAPTER })
  assert.equal(diff.ok, true, JSON.stringify(diff.error ?? {}))
  const types = new Set(diff.value.hunks.map((hunk) => hunk.type))
  assert.ok(types.has('del'), 'diff 必须有删除行')
  assert.ok(types.has('add'), 'diff 必须有新增行')
  assert.ok(types.has('ctx'), '未变行要作为上下文返回')
  assert.ok(diff.value.hunks.some((hunk) => hunk.type === 'del' && hunk.text === '第二行'))
  assert.ok(diff.value.hunks.some((hunk) => hunk.type === 'add' && hunk.text === '第二行改过'))
  assert.ok(diff.value.hunks.some((hunk) => hunk.type === 'add' && hunk.text === '新增第四行'))
  // line 口径：ctx/add 是新文件行号，del 是旧文件行号（1 起）。
  assert.equal(diff.value.hunks.find((hunk) => hunk.type === 'del' && hunk.text === '第二行').line, 2)
  assert.equal(diff.value.hunks.find((hunk) => hunk.type === 'add' && hunk.text === '新增第四行').line, 4)

  // 反向 diff 同样成立（自写 Myers 不是单向特判）。
  const reverse = await diffVersions({ root, a: second.value.oid, b: first.value.oid, path: CHAPTER })
  assert.equal(reverse.ok, true)
  assert.ok(reverse.value.hunks.some((hunk) => hunk.type === 'del' && hunk.text === '新增第四行'))
  assert.ok(reverse.value.hunks.some((hunk) => hunk.type === 'add' && hunk.text === '第二行'))

  // `.pinax/project.json` 在 exclude 里（`/.pinax/`），必须靠 add 的 force 才进得去：
  // 光看 files 清单不算数，历史里查得到才算真的版本化了。
  const markerHistory = await listFileHistory({ root, path: '.pinax/project.json' })
  assert.equal(markerHistory.ok, true, JSON.stringify(markerHistory.error ?? {}))
  assert.equal(markerHistory.value.length, 1, 'project.json 两版之间没变，只应有一条落库记录')
  assert.equal(markerHistory.value[0].oid, first.value.oid)
  const markerVersion = await readVersion({ root, oid: first.value.oid, path: '.pinax/project.json' })
  assert.equal(markerVersion.ok, true)
  assert.match(markerVersion.value, /"spec":"pinax-project@2"/)
})

test('提案进历史（工单E3）：.pinax/proposals/ 的提案随快照落库，改版有两条历史，提案目录本身不是对象', async (t) => {
  const root = await makeProject(t)
  await mkdir(join(root, '.pinax', 'proposals'), { recursive: true })
  const proposal = '.pinax/proposals/20261028T140000-ch1-abcdef12.json'
  const firstProposal = `${JSON.stringify({
    schema: 'pinax-proposal@1',
    id: '20261028T140000-ch1-abcdef12',
    target: { file: '正文/001-第一章 延迟.md' },
    content: '雨从檐口滴下来。'
  }, null, 2)}\n`
  await writeFile(join(root, proposal), firstProposal, 'utf-8')
  await writeFile(join(root, CHAPTER), '第一章正文\n', 'utf-8')

  assert.equal((await markDirty({ root, paths: [CHAPTER, proposal] })).ok, true)
  const first = await commitSnapshot({ root, message: '提案入库' })
  assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
  assert.equal(first.value.committed, true)
  assert.ok(first.value.files.includes(proposal), '.pinax/proposals/ 的提案必须进快照（info/exclude 里的 /.pinax/ 靠 force add 绕过，与 project.json 同法）')

  const listed = await listFileHistory({ root, path: proposal, limit: 10 })
  assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
  assert.equal(listed.value.length, 1)
  assert.equal(listed.value[0].oid, first.value.oid)
  const version = await readVersion({ root, oid: first.value.oid, path: proposal })
  assert.equal(version.ok, true, JSON.stringify(version.error ?? {}))
  assert.equal(version.value, firstProposal)

  // 模型改写一版提案：同一路径两条历史，diff 看得到新句子。
  const secondProposal = firstProposal.replace('雨从檐口滴下来。', '雨从檐口滴下来，巷子里没人。')
  await writeFile(join(root, proposal), secondProposal, 'utf-8')
  assert.equal((await markDirty({ root, paths: [proposal] })).ok, true)
  const second = await commitSnapshot({ root, message: '提案改版' })
  assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
  assert.equal(second.value.committed, true)
  const afterEdit = await listFileHistory({ root, path: proposal, limit: 10 })
  assert.equal(afterEdit.ok, true)
  assert.deepEqual(afterEdit.value.map((entry) => entry.message), ['提案改版', '提案入库'])
  const diff = await diffVersions({ root, a: first.value.oid, b: second.value.oid, path: proposal })
  assert.equal(diff.ok, true, JSON.stringify(diff.error ?? {}))
  assert.ok(diff.value.hunks.some((hunk) => hunk.type === 'add' && hunk.text.includes('巷子里没人')))

  // 目录本身不是快照对象；也不因此被当成「不在范围内」的错误。
  const dirOnly = await listFileHistory({ root, path: '.pinax/proposals' })
  assert.equal(dirOnly.ok, true)
  assert.deepEqual(dirOnly.value, [])
})

test('提案写入真链路（批次16 E3／收口包③）：fileService.writeProposal → 标脏 → 提交 → 提案在历史里查得到', async (t) => {
  const root = await makeProject(t)
  // 与 main.mjs 的接线同一形状：fileService 的写入钩子把 relativePath 交给 markDirty。
  // 这里刻意不用 writeFile 造文件——提案必须从唯一的写入出口走一遍，才能钉住「writeProposal 会标脏」。
  const fileService = createFileService({ root })
  const hooked = []
  fileService.setOnWrite(async ({ relativePath }) => {
    hooked.push(relativePath)
    const dirty = await markDirty({ root, paths: [relativePath] })
    assert.equal(dirty.ok, true, JSON.stringify(dirty.error ?? {}))
  })

  const proposalName = '20261029T093000-ch1-abcdef12.json'
  const proposalPath = `.pinax/proposals/${proposalName}`
  const proposalText = `${JSON.stringify({
    schema: 'pinax-proposal@1',
    id: proposalName.replace(/\.json$/u, ''),
    status: 'proposed',
    target: { file: CHAPTER },
    content: '雨从檐口滴下来，巷子里没人。',
    contentChars: 14
  }, null, 2)}\n`

  const written = await fileService.writeProposal({ name: proposalName, text: proposalText })
  assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
  assert.deepEqual(hooked, [proposalPath], 'writeProposal 必须触发写入钩子（批次16 修的就是「只写提案不标脏」）')

  const dirty = JSON.parse(await readFile(join(root, HISTORY_DIRTY_FILE), 'utf-8'))
  assert.deepEqual(dirty.paths, [proposalPath], '提案路径要真的进脏清单，下一次快照才收得到')

  const committed = await commitSnapshot({ root, message: '提案写入' })
  assert.equal(committed.ok, true, JSON.stringify(committed.error ?? {}))
  assert.equal(committed.value.committed, true)
  assert.ok(committed.value.files.includes(proposalPath), `.pinax/proposals/ 的提案必须进快照（实际：${committed.value.files.join(', ')}）`)

  // 历史里查得到：列表给这一次提交，readVersion 读回与写入时一字不差的提案 JSON。
  const listed = await listFileHistory({ root, path: proposalPath, limit: 10 })
  assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
  assert.equal(listed.value.length, 1)
  assert.equal(listed.value[0].oid, committed.value.oid)
  assert.equal(listed.value[0].message, '提案写入')
  const version = await readVersion({ root, oid: committed.value.oid, path: proposalPath })
  assert.equal(version.ok, true, JSON.stringify(version.error ?? {}))
  assert.equal(version.value, proposalText)
})

test('assets/x.png 不入历史：只脏资产时没有可提交差异，文件历史为空', async (t) => {
  const root = await makeProject(t)
  await writeFile(join(root, CHAPTER), '第一章正文\n', 'utf-8')
  await markDirty({ root, paths: [CHAPTER] })
  const baseline = await commitSnapshot({ root })
  assert.equal(baseline.value.committed, true)

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(join(root, 'assets', 'x.png'), png)
  const dirty = await markDirty({ root, paths: ['assets/x.png'] })
  assert.equal(dirty.ok, true, '脏清单可以记资产（写入路径统一标脏），提交时再按允许前缀过滤')

  const result = await commitSnapshot({ root, message: '只有资产变化' })
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.equal(result.value.committed, false, '资产不产生提交')
  assert.equal(result.value.reason, 'no-changes')
  assert.deepEqual(result.value.files, [])

  const history = await listFileHistory({ root, path: 'assets/x.png' })
  assert.equal(history.ok, true)
  assert.deepEqual(history.value, [], 'assets 路径永远没有历史')

  const read = await readVersion({ root, oid: baseline.value.oid, path: 'assets/x.png' })
  assert.equal(read.ok, false)
  assert.equal(read.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)
})

test('空脏提交 committed:false；内容没变的重复标脏也不制造空提交', async (t) => {
  const root = await makeProject(t)
  const clean = await commitSnapshot({ root })
  assert.equal(clean.ok, true, JSON.stringify(clean.error ?? {}))
  assert.equal(clean.value.committed, false)
  assert.equal(clean.value.reason, 'clean')

  await writeFile(join(root, CHAPTER), '只有这一段\n', 'utf-8')
  await markDirty({ root, paths: [CHAPTER] })
  const first = await commitSnapshot({ root })
  assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
  assert.equal(first.value.committed, true)
  assert.deepEqual(JSON.parse(await readFile(join(root, HISTORY_DIRTY_FILE), 'utf-8')).paths, [], '提交成功必须清脏')

  await markDirty({ root, paths: [CHAPTER] })
  const again = await commitSnapshot({ root })
  assert.equal(again.ok, true, JSON.stringify(again.error ?? {}))
  assert.equal(again.value.committed, false)
  assert.equal(again.value.reason, 'no-changes')

  const history = await listFileHistory({ root, path: CHAPTER })
  assert.equal(history.ok, true)
  assert.equal(history.value.length, 1, '空提交不得进历史')
})

test('删除也进历史：删文件后提交会从索引移除，旧版仍可读、diff 全是删除行', async (t) => {
  const root = await makeProject(t)
  await writeFile(join(root, CHAPTER), '第一行\n第二行\n', 'utf-8')
  await markDirty({ root, paths: [CHAPTER] })
  const first = await commitSnapshot({ root })
  assert.equal(first.value.committed, true)
  assert.ok(first.value.files.includes(CHAPTER))

  await rm(join(root, CHAPTER))
  await markDirty({ root, paths: [CHAPTER] })
  const second = await commitSnapshot({ root, message: '删掉第一章' })
  assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
  assert.equal(second.value.committed, true)
  assert.deepEqual(second.value.removed, [CHAPTER], '已跟踪的删除必须从索引移除')
  assert.equal(second.value.files.includes(CHAPTER), false)

  const oldVersion = await readVersion({ root, oid: first.value.oid, path: CHAPTER })
  assert.equal(oldVersion.ok, true)
  assert.equal(oldVersion.value, '第一行\n第二行\n')
  const goneVersion = await readVersion({ root, oid: second.value.oid, path: CHAPTER })
  assert.equal(goneVersion.ok, false)
  assert.equal(goneVersion.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)

  const diff = await diffVersions({ root, a: first.value.oid, b: second.value.oid, path: CHAPTER })
  assert.equal(diff.ok, true, JSON.stringify(diff.error ?? {}))
  assert.deepEqual(diff.value.hunks.map((hunk) => hunk.type), ['del', 'del'])
})

test('非法路径与非法参数一律 typed HISTORY_INVALID_INPUT，不抛裸异常', async (t) => {
  const root = await makeProject(t)
  const invalidPaths = ['../outside.md', 'D:/absolute.md', '/etc/passwd', '正文/../../x.md', '.pinax/history.git/config', '']
  for (const path of invalidPaths) {
    const dirty = await markDirty({ root, paths: [path] })
    assert.equal(dirty.ok, false, `markDirty 应拒绝：${path}`)
    assert.equal(dirty.error.code, HISTORY_ERROR_CODES.INVALID_INPUT, `markDirty 错误码不对：${path}`)

    const listed = await listFileHistory({ root, path })
    assert.equal(listed.ok, false, `listFileHistory 应拒绝：${path}`)
    assert.equal(listed.error.code, HISTORY_ERROR_CODES.INVALID_INPUT, `listFileHistory 错误码不对：${path}`)
  }

  const badOid = await readVersion({ root, oid: 'HEAD', path: CHAPTER })
  assert.equal(badOid.ok, false)
  assert.equal(badOid.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)

  const badLimit = await listFileHistory({ root, path: CHAPTER, limit: 0 })
  assert.equal(badLimit.ok, false)
  assert.equal(badLimit.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)

  const badRoot = await commitSnapshot({ root: '', message: 'x' })
  assert.equal(badRoot.ok, false)
  assert.equal(badRoot.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)

  const badMessage = await commitSnapshot({ root, message: 42 })
  assert.equal(badMessage.ok, false)
  assert.equal(badMessage.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)

  // 合法 oid 但对象不存在 → 历史引擎侧失败，也不是裸异常
  const missingVersion = await readVersion({ root, oid: 'ffffffffffffffffffffffffffffffffffffffff', path: CHAPTER })
  assert.equal(missingVersion.ok, false)
  assert.equal(missingVersion.error.code, HISTORY_ERROR_CODES.UNAVAILABLE)
})

test('没有历史仓库时如实报 HISTORY_UNAVAILABLE（不静默假装可提交）', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-history-bare-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', '001.md'), '没有建仓\n', 'utf-8')
  assert.equal((await markDirty({ root, paths: ['正文/001.md'] })).ok, true)

  const result = await commitSnapshot({ root })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, HISTORY_ERROR_CODES.UNAVAILABLE)
  assert.match(result.error.message, /历史仓库尚未建立/)

  const listed = await listFileHistory({ root, path: '正文/001.md' })
  assert.equal(listed.ok, false)
  assert.equal(listed.error.code, HISTORY_ERROR_CODES.UNAVAILABLE)
})
