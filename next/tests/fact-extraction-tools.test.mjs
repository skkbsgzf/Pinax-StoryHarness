import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { NOVEL_CARRIER_ID } from '../carriers/novel/manifest.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'
import { createFactExtractionTools, EXTRACTION_TOOL_NAMES } from '../runtime/factExtractionTools.mjs'
import { createWritePolicy } from '../runtime/writePolicy.mjs'
import { selectTools } from '../runtime/toolSelect.mjs'
import { createToolLoop, serializeToolOutput } from '../runtime/toolLoop.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { validateFactEntry } from '../fact/domain/schema.js'

const plugins = await loadBuiltInCarrierPlugins()
const prose = '阿明推开门，发现桌上有一封信。他收起信，向守门人询问钟楼的方向。守门人告诉他，午夜以后钟楼禁止进入。\n'.repeat(14)
async function fixture(t) {
  const workspace = await createTempWorkspace('fact-extract')
  t.after(() => workspace.cleanup())
  const root = join(workspace.projects, '抽取靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of plugins) assert.equal(registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {}).ok, true)
  assert.equal((await createProject({ root, name: '抽取靶子', primaryCarrier: NOVEL_CARRIER_ID, registry })).ok, true)
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true)
  const { fileService, view } = opened.value
  const dir = Object.values(registry.get(NOVEL_CARRIER_ID).dataDirs)[0]
  const ref = { pluginId: NOVEL_CARRIER_ID, dir, file: '第一章.md', chapterNo: 1 }
  await fileService.write({ ...ref, text: prose, expectedRevision: 0 })
  const options = { root, fileService, registry, view }
  let tools = createFactExtractionTools(options)
  const call = async (method, args) => tools.get(`pinax_extract_${method}`).tool.run(args)
  const good = async (method, args) => { const result = await call(method, args); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }
  return { ...options, tools, call, good, ref, reset: () => { tools = createFactExtractionTools(options) } }
}
const initial = (ref, extra = {}) => ({ dataset: 'book', requestId: 'initial', domain: '试验世界', book: '试验书', sources: [ref], ...extra })
function row(unit, note = '阿明收信并得知钟楼的进入限制。') {
  return { segmentId: unit.id, who: ['阿明', '守门人'], when: { story_time: '未明示', timeline: '顺叙' }, where: '门口',
    events: [{ who: '阿明', channel: 'do', content: '收起信件' }], notes: note,
    characters: [{ name: '阿明', aliases: [], identity: '访客', traits: [], speech: [], behavior: ['收起信件'] }],
    settings: [{ name: '钟楼', slot: 'locations', definition: '午夜后禁止进入的建筑。', aliases: [] }] }
}
async function complete(f, run) {
  for (let safety = 0; safety < 100; safety += 1) {
    const task = await f.good('next', { dataset: 'book', runId: run.runId })
    assert.ok(serializeToolOutput({ ok: true, value: { payload: { ok: true, ...task } } }).length < 7200)
    if (task.done) return f.good('finish', { dataset: 'book', runId: run.runId, expectedRevision: task.revision })
    const args = { dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: `step-${task.revision}` }
    if (task.phase === 'extract') args.rows = task.units.map((unit) => row(unit))
    else args.confirmed = task.units.map((unit) => unit.id)
    await f.good('submit', args)
  }
  assert.fail('测试链未终止')
}

test('首次建库：联合抽取、复核、三层快照与完整读取，原稿不变', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  assert.ok(task.units.length > 1, '一次派多个原100–300字单元，不再一段一次调用')
  const early = await f.call('finish', { dataset: 'book', runId: run.runId, expectedRevision: run.revision })
  assert.equal(early.error.code, 'INCOMPLETE_COVERAGE')
  const done = await complete(f, run)
  assert.equal(done.adopted, 0)
  assert.equal(done.usage, null)
  const state = JSON.parse(await readFile(join(f.root, done.resultPath), 'utf8'))
  assert.equal(state.current.entries.length, run.segments + 2)
  assert.deepEqual(new Set(state.current.entries.map((entry) => entry.layer)), new Set(['plot', 'character', 'worldview']))
  for (const entry of state.current.entries) assert.equal(validateFactEntry(entry).ok, true)
  assert.equal(state.current.sources[0].text, undefined, '原稿不进checkpoint')
  assert.equal(await readFile(join(f.root, f.ref.dir, f.ref.file), 'utf8'), prose)
  const entries = await f.good('status', { dataset: 'book', view: 'entries' })
  const id = entries.items[0].id
  let offset = 0; let json = ''
  do { const part = await f.good('status', { dataset: 'book', view: 'entry', id, offset }); json += part.text; offset = part.nextOffset } while (offset !== null)
  assert.equal(JSON.parse(json).id, id)
  assert.equal((await f.good('finish', { dataset: 'book', runId: run.runId, expectedRevision: 0 })).duplicate, true)
})

test('部分提交/重启续跑/幂等与旧revision：不重新派已完成段', async (t) => {
  const f = await fixture(t)
  const args = initial(f.ref)
  const run = await f.good('prepare', args)
  assert.equal((await f.good('prepare', args)).duplicate, true)
  assert.equal((await f.call('prepare', { ...args, book: '改名' })).error.code, 'IDEMPOTENCY_CONFLICT')
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const submission = { dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: 'one', rows: [row(task.units[0])] }
  await f.good('submit', submission)
  f.reset()
  assert.equal((await f.good('submit', submission)).duplicate, true)
  assert.equal((await f.call('submit', { ...submission, rows: [row(task.units[0], '不同内容')] })).error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await f.call('submit', { ...submission, submissionId: 'other' })).error.code, 'STALE_REVISION')
  const next = await f.good('next', { dataset: 'book', runId: run.runId })
  assert.ok(!next.units.some((unit) => unit.id === task.units[0].id))
  await complete(f, run)
})

test('更新只重抽变化/新增源，删除只列影响，补抽只针对指定源', async (t) => {
  const f = await fixture(t)
  const first = await f.good('prepare', initial(f.ref))
  await complete(f, first)
  const same = await f.good('prepare', { dataset: 'book', requestId: 'same', mode: 'update' })
  assert.equal(same.reusedSources, 1)
  assert.equal((await f.good('next', { dataset: 'book', runId: same.runId })).done, true)
  await complete(f, same)
  const ref2 = { ...f.ref, file: '第二章.md', chapterNo: 2 }
  await f.fileService.write({ ...ref2, text: prose, expectedRevision: 0 })
  const add = await f.good('prepare', { dataset: 'book', requestId: 'add', mode: 'update', sources: [f.ref, ref2] })
  assert.equal(add.reusedSources, 1)
  assert.equal((await f.good('next', { dataset: 'book', runId: add.runId })).source.chapterNo, 2)
  await complete(f, add)
  const repair = await f.good('prepare', { dataset: 'book', requestId: 'repair', mode: 'repair', sourceIds: [`${f.ref.dir}/${f.ref.file}`] })
  assert.equal(repair.reusedSources, 1)
  assert.equal((await f.good('next', { dataset: 'book', runId: repair.runId })).source.chapterNo, 1)
  await complete(f, repair)
  const remove = await f.good('prepare', { dataset: 'book', requestId: 'remove', mode: 'update', sources: [ref2] })
  assert.equal(remove.removedSources, 1)
  await complete(f, remove)
  const changes = await f.good('status', { dataset: 'book', view: 'changes' })
  assert.ok(changes.items.some((change) => change.kind === 'source-removed' && change.action === 'review-only'))
  assert.equal(await readFile(join(f.root, f.ref.dir, f.ref.file), 'utf8'), prose, '移出范围不删除原文件')
})

test('源变化拒旧任务；从未完成run更新保留成功行而不伪造复核完成', async (t) => {
  const f = await fixture(t)
  const ref2 = { ...f.ref, file: '第二章.md', chapterNo: 2 }
  await f.fileService.write({ ...ref2, text: prose, expectedRevision: 0 })
  const run = await f.good('prepare', initial(f.ref, { sources: [f.ref, ref2] }))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  await f.good('submit', { dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: 'part', rows: [row(task.units[0])] })
  await writeFile(join(f.root, ref2.dir, ref2.file), prose + '钟声响了。', 'utf8')
  const updated = await f.good('prepare', { dataset: 'book', requestId: 'from-run', mode: 'update', fromRunId: run.runId })
  assert.equal(updated.extracted, 1)
  assert.equal(updated.reviewed, 0)
  const latest = await f.good('next', { dataset: 'book', runId: updated.runId })
  await writeFile(join(f.root, f.ref.dir, f.ref.file), prose + '阿明离开。', 'utf8')
  assert.equal((await f.call('submit', { dataset: 'book', runId: updated.runId, expectedRevision: latest.revision, taskId: latest.taskId, submissionId: 'stale', rows: [row(latest.units[0])] })).error.code, 'SOURCE_STALE')
})

test('冲突、漏段、假ID和未知字段不会推进断点', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const args = { dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: 'bad' }
  assert.equal((await f.call('submit', { ...args, rows: [{ ...row(task.units[0]), segmentId: 'invented' }] })).ok, false)
  assert.equal((await f.call('submit', { ...args, rows: [{ ...row(task.units[0]), confidence: 1 }] })).error.code, 'INVALID_INPUT')
  assert.equal((await f.call('submit', { ...args, rows: [], confirmed: [task.units[0].id] })).ok, false)
  assert.equal((await f.good('status', { dataset: 'book', runId: run.runId })).revision, task.revision)
  await complete(f, run)
  const a = await f.good('prepare', { dataset: 'book', requestId: 'a', mode: 'update' })
  const b = await f.good('prepare', { dataset: 'book', requestId: 'b', mode: 'update' })
  await complete(f, a)
  assert.equal((await f.call('finish', { dataset: 'book', runId: b.runId, expectedRevision: b.revision })).error.code, 'DATASET_CONFLICT')
})

test('项目与路径边界、锁及损坏断点显式失败，不清空重跑', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.call('prepare', initial(f.ref, { dataset: '../escape' }))).ok, false)
  assert.equal((await f.call('prepare', initial({ ...f.ref, file: '../outside.txt' }))).ok, false)
  const missing = createFactExtractionTools()
  assert.equal((await missing.get('pinax_extract_status').tool.run({ view: 'sources' })).error.code, 'PROJECT_UNAVAILABLE')
  await f.good('prepare', initial(f.ref))
  const target = join(f.root, '.pinax', 'extractions', 'book.json')
  const before = await readFile(target, 'utf8')
  await writeFile(`${target}.lock`, 'locked')
  assert.equal((await f.call('prepare', initial(f.ref, { requestId: 'locked' }))).error.code, 'EXTRACTION_BUSY')
  assert.equal(await readFile(target, 'utf8'), before)
  await writeFile(target, '{broken')
  assert.equal((await f.call('status', { dataset: 'book' })).error.code, 'CHECKPOINT_CORRUPT')
  assert.equal(await readFile(target, 'utf8'), '{broken')
})

test('元数据软链逃逸被拒绝', async (t) => {
  const f = await fixture(t)
  const outside = join(f.root, '..', 'outside')
  await mkdir(outside)
  await symlink(outside, join(f.root, '.pinax', 'extractions'), 'junction')
  const result = await f.call('prepare', initial(f.ref))
  assert.equal(result.ok, false)
  assert.match(result.error.code, /PATH_OUTSIDE_PROJECT/u)
})

test('review/auto只准非破坏性派生提交；blocked拒写但保留读口；六工具披露完整', async (t) => {
  const f = await fixture(t)
  for (const [name, { tool }] of f.tools) {
    const read = name.endsWith('_next') || name.endsWith('_status')
    for (const mode of ['review', 'auto', 'blocked']) {
      const policy = createWritePolicy({ mode })
      const decision = await policy.beforeTool({ name, annotations: tool.annotations, arguments: {} })
      assert.equal(decision.kind, !read && mode === 'blocked' ? 'deny' : 'allow')
    }
  }
  const tools = [...f.tools.values()].map(({ tool }) => tool).concat({ name: 'pinax_skill_read' }, { name: 'pinax_project_context' })
  const selected = selectTools({ tools, intent: '从零开抽并更新存量事实' })
  assert.equal(selected.names.length, 6)
  for (const name of [...EXTRACTION_TOOL_NAMES, 'pinax_skill_read']) assert.ok(selected.names.includes(name))
})

test('真实MCP聚合面装载技能与五工具，错误schema在执行前拒绝', async (t) => {
  const f = await fixture(t)
  const runtime = createAgentRuntime({ registry: f.registry, fileService: f.fileService, view: f.view })
  await runtime.start()
  t.after(() => runtime.stop())
  assert.ok(runtime.skills().names.includes('fact-extract'))
  for (const name of EXTRACTION_TOOL_NAMES) assert.ok(runtime.listTools().some((tool) => tool.name === name))
  const read = await runtime.callTool('pinax_skill_read', { name: 'fact-extract' })
  assert.equal(read.value.payload.tools.length, 6)
  const bad = await runtime.callTool('pinax_extract_prepare', { arbitrary: true })
  assert.equal(bad.value.payload.code, 'INVALID_INPUT')
  const prepared = await runtime.callTool('pinax_extract_prepare', initial(f.ref))
  assert.ok(prepared.value.payload.runId)
  const next = await runtime.callTool('pinax_extract_next', { dataset: 'book', runId: prepared.value.payload.runId })
  assert.ok(next.value.payload.units.length > 1)
})

test('真实工具循环使用离线turn完成两轮链，usage未知不编造', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  let step = 0
  const loop = createToolLoop({
    maxSteps: 20, selectTools,
    callTool: (name, args) => f.tools.get(name).tool.run(args),
    turn: async ({ messages }) => {
      const output = messages.filter((message) => message.role === 'tool').at(-1)
      const task = output ? JSON.parse(output.content) : null
      if (task?.publication || task?.state === 'finished') return { text: '已完成离线链路' }
      let name = 'pinax_extract_next'; let args = { dataset: 'book', runId: run.runId }
      if (task?.taskId) {
        name = 'pinax_extract_submit'
        args = { ...args, taskId: task.taskId, expectedRevision: task.revision, submissionId: `loop-${step}`,
          ...(task.phase === 'extract' ? { rows: task.units.map((unit) => row(unit)) } : { confirmed: task.units.map((unit) => unit.id) }) }
      } else if (task?.phase === 'ready') { name = 'pinax_extract_finish'; args.expectedRevision = task.revision }
      step += 1
      return { calls: [{ id: `call-${step}`, name, arguments: args }] }
    }
  })
  const result = await loop.run({ question: '批量抽取事实', tools: [...f.tools.values()].map(({ tool }) => tool) })
  assert.equal(result.kind, 'final')
  assert.equal(result.text, '已完成离线链路')
  assert.equal(result.usage, null)
  assert.equal((await f.good('status', { dataset: 'book', runId: run.runId })).state, 'finished')
})
