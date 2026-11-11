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
import { buildSegmentIndex, normalizeDatasetEntries, leanDatasetEntries } from '../fact/usecases/pipeline/leanEntries.js'

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
/** 读落盘 dataset 并归一回全形状（落盘是瘦条目，直接读会拿到瘦 provenance）。 */
async function readNormalized(f, resultPath) {
  const raw = JSON.parse(await readFile(join(f.root, resultPath), 'utf8'))
  const envelope = {
    domain: raw.current.spec.domain, book: raw.current.spec.book, bookId: raw.current.spec.bookId,
    mode: raw.current.mode, extractor: raw.current.extractor, statusByLayer: raw.current.statusByLayer
  }
  const entries = normalizeDatasetEntries(raw.current.entries, envelope, buildSegmentIndex(raw.current.sources))
  return { raw, entries }
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
    args.rows = task.units.map((unit) => row(unit))
    await f.good('submit', args)
  }
  assert.fail('测试链未终止')
}

test('首次建库：单轮联合抽取、三层快照＋基础索引与完整读取，原稿不变', async (t) => {
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
  // P-TRIM Track 1：落盘是 v2 信封＋瘦条目（无 schema/domain/status/fingerprint/sources，events 无 title/segments）
  assert.equal(state.schema, 'pinax-extraction-dataset/v2')
  assert.equal(state.current.entriesFormat, 'lean@1')
  assert.equal(state.current.entries.length, run.segments + 2)
  assert.deepEqual(new Set(state.current.entries.map((entry) => entry.layer)), new Set(['plot', 'character', 'worldview']))
  const leanPlot = state.current.entries.find((entry) => entry.layer === 'plot')
  assert.equal(leanPlot.schema, undefined, 'schema 由信封承载，瘦条目不带')
  assert.equal(leanPlot.fingerprint, undefined, 'fingerprint 落库侧确定性重建，不落盘')
  assert.equal(leanPlot.events[0].title, undefined, 'events.title 是 content 的复制，不落盘')
  assert.ok(Array.isArray(leanPlot.srcs) && leanPlot.srcs.length >= 1, 'sources 瘦成段引用')
  assert.equal(state.current.sources[0].text, undefined, '原稿不进checkpoint')
  assert.equal(await readFile(join(f.root, f.ref.dir, f.ref.file), 'utf8'), prose)
  // 读时归一：瘦条目经 load 归一后是合法全形状——status view 通道拿到的就是归一产物
  const entries = await f.good('status', { dataset: 'book', view: 'entries' })
  for (const item of entries.items) assert.ok(item.status, '归一后 status 回填（statusByLayer）')
  const id = entries.items[0].id
  let offset = 0; let json = ''
  do { const part = await f.good('status', { dataset: 'book', view: 'entry', id, offset }); json += part.text; offset = part.nextOffset } while (offset !== null)
  const entryView = JSON.parse(json)
  assert.equal(validateFactEntry(entryView).ok, true, 'view:entry 读到的是归一全形状')
  assert.equal(entryView.id, id)
  assert.equal((await f.good('finish', { dataset: 'book', runId: run.runId, expectedRevision: 0 })).duplicate, true)
})

test('P-TRIM Track 1：瘦条目读时归一＝compile 全形状（roundtrip deepEqual，id 零漂移）', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  await complete(f, run)
  const done = await f.good('finish', { dataset: 'book', runId: run.runId, expectedRevision: 0 })
  assert.equal(done.state, 'finished')
  const raw = JSON.parse(await readFile(join(f.root, done.resultPath), 'utf8'))
  const envelope = {
    domain: raw.current.spec.domain, book: raw.current.spec.book, bookId: raw.current.spec.bookId,
    mode: raw.current.mode, extractor: raw.current.extractor, statusByLayer: raw.current.statusByLayer
  }
  const segIndex = buildSegmentIndex(raw.current.sources)
  // 归一后逐条合法，且与 compile 口径对齐（id 零漂移）
  const normalized = normalizeDatasetEntries(raw.current.entries, envelope, segIndex)
  for (const entry of normalized) assert.equal(validateFactEntry(entry).ok, true, JSON.stringify(entry.name))
  assert.deepEqual(new Set(normalized.map((entry) => entry.id)), new Set(raw.current.entries.map((entry) => entry.id)))
  assert.equal(normalized.length, run.segments + 2)
  // 落盘→读取→再落盘：二次 lean 与首次逐字节同形（幂等）
  const again = leanDatasetEntries(normalized, { ...envelope, statusByLayer: raw.current.statusByLayer })
  assert.deepEqual(again, raw.current.entries, 'lean 幂等：归一再瘦与首次落盘一致')
  // 字节缩减读数（对同一份数据：瘦 vs 全形状）
  const leanBytes = JSON.stringify(raw.current.entries).length
  const fullBytes = JSON.stringify(normalized).length
  const saved = Math.round((1 - leanBytes / fullBytes) * 100)
  assert.ok(saved >= 20, `瘦化至少省 20%（实测 ${saved}%）`)
})

test('P-TRIM Track 1：v1 旧格式文件照常可读（读时归一兼容存量）', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  await complete(f, run)
  const done = await f.good('finish', { dataset: 'book', runId: run.runId, expectedRevision: 0 })
  const path = join(f.root, done.resultPath)
  const v2 = JSON.parse(await readFile(path, 'utf8'))
  // 手工降级成 v1 形状：条目写回全形状、schema 改回 v1——模拟存量数据集
  const envelope = {
    domain: v2.current.spec.domain, book: v2.current.spec.book, bookId: v2.current.spec.bookId,
    mode: v2.current.mode, extractor: v2.current.extractor, statusByLayer: v2.current.statusByLayer
  }
  const full = normalizeDatasetEntries(v2.current.entries, envelope, buildSegmentIndex(v2.current.sources))
  const v1 = { ...v2, schema: 'pinax-extraction-dataset/v1' }
  v1.current = { ...v2.current, entries: full }
  delete v1.current.entriesFormat
  delete v1.current.statusByLayer
  delete v1.current.mode
  delete v1.current.extractor
  const { writeFileAtomic } = await import('../fs/atomicWrite.mjs')
  await writeFileAtomic(path, JSON.stringify(v1))
  // v1 读回：服务照常工作（check 走通、status view:entries 有 status）
  const check = await f.tools.get('pinax_fact_check').tool.run({ dataset: 'book' })
  assert.equal(check.ok, true, JSON.stringify(check.error))
  const entries = await f.good('status', { dataset: 'book', view: 'entries' })
  assert.ok(entries.items.every((item) => item.status))
  // 下一次真实写入升级回 v2（写时统一升级，不迁移存量）；重复 finish 是早退分支，不落盘
  await f.good('prepare', { dataset: 'book', requestId: 'upgrade-v2', mode: 'update' })
  const upgraded = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(upgraded.schema, 'pinax-extraction-dataset/v2')
  assert.equal(upgraded.current.entriesFormat, 'lean@1')
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

test('源变化拒旧任务；从未完成run更新保留成功行', async (t) => {
  const f = await fixture(t)
  const ref2 = { ...f.ref, file: '第二章.md', chapterNo: 2 }
  await f.fileService.write({ ...ref2, text: prose, expectedRevision: 0 })
  const run = await f.good('prepare', initial(f.ref, { sources: [f.ref, ref2] }))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  await f.good('submit', { dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: 'part', rows: [row(task.units[0])] })
  await writeFile(join(f.root, ref2.dir, ref2.file), prose + '钟声响了。', 'utf8')
  const updated = await f.good('prepare', { dataset: 'book', requestId: 'from-run', mode: 'update', fromRunId: run.runId })
  assert.equal(updated.extracted, 1)
  assert.equal(updated.phase, 'extract', '单轮模式下未抽段仍待办')
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
  assert.equal((await f.call('submit', { ...args, rows: [] })).error.code, 'EMPTY_SUBMISSION')
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

test('review/auto只准非破坏性派生提交；blocked拒写但保留读口；六工具＋一致性检测披露完整', async (t) => {
  const f = await fixture(t)
  for (const [name, { tool }] of f.tools) {
    const read = name.endsWith('_next') || name.endsWith('_status') || name === 'pinax_fact_check'
    for (const mode of ['review', 'auto', 'blocked']) {
      const policy = createWritePolicy({ mode })
      const decision = await policy.beforeTool({ name, annotations: tool.annotations, arguments: {} })
      assert.equal(decision.kind, !read && mode === 'blocked' ? 'deny' : 'allow')
    }
  }
  const tools = [...f.tools.values()].map(({ tool }) => tool).concat({ name: 'pinax_skill_read' }, { name: 'pinax_project_context' })
  const selected = selectTools({ tools, intent: '从零开抽并更新存量事实' })
  assert.equal(selected.names.length, 6)
  // fact_check 属 fact-consistency 技能，不随「开抽」意图被选中
  for (const name of [...EXTRACTION_TOOL_NAMES.filter((item) => item !== 'pinax_fact_check'), 'pinax_skill_read']) assert.ok(selected.names.includes(name))
})

test('真实MCP聚合面装载技能与六工具，错误schema在执行前拒绝', async (t) => {
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
          rows: task.units.map((unit) => row(unit)) }
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

test('P-TRIM T-1.5：跨 run 折叠——同人物命中即合并（chapters 并集），新拍照常新增', async (t) => {
  const f = await fixture(t)
  const ref2 = { pluginId: f.ref.pluginId, dir: f.ref.dir, file: '第二章.md', chapterNo: 2 }
  await f.fileService.write({ ...ref2, text: prose.replace('收起信', '攥紧信'), expectedRevision: 0 })
  // 第一跑：第一章
  const run1 = await f.good('prepare', initial(f.ref))
  await complete(f, run1)
  const done1 = await f.good('finish', { dataset: 'book', runId: run1.runId, expectedRevision: 0 })
  const after1 = await readNormalized(f, done1.resultPath)
  const aming1 = after1.entries.find((entry) => entry.name === '阿明')
  assert.equal(aming1.provenance.chapters.join(','), '1')
  // 第二跑：新增第二章（同人物）
  const run2 = await f.good('prepare', { dataset: 'book', requestId: 'run2', mode: 'update', sources: [f.ref, ref2] })
  const row2 = (unit) => ({ segmentId: unit.id, who: ['阿明', '守门人'], when: { story_time: '未明示', timeline: '顺叙' }, where: '门口',
    events: [{ who: '阿明', channel: 'do', content: '攥紧信件' }], notes: '阿明攥紧信件，钟楼的限制仍未解除。',
    characters: [{ name: '阿明', aliases: [], identity: '访客', traits: ['警觉'], speech: [], behavior: ['攥紧信件'] }],
    settings: [{ name: '钟楼', slot: 'locations', definition: '午夜后禁止进入的建筑。', aliases: [] }],
    knowledge: [{ character: '阿明', source: '守门人', learned: '从守门人处确认钟楼午夜后禁止进入' }] })
  let latest = null
  for (let safety = 0; safety < 100; safety += 1) {
    const task = await f.good('next', { dataset: 'book', runId: run2.runId })
    latest = task
    if (task.done) break
    const args = { dataset: 'book', runId: run2.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: `r2-${task.revision}` }
    args.rows = task.units.map((unit) => row2(unit))
    await f.good('submit', args)
    latest = task
  }
  const done2 = await f.good('finish', { dataset: 'book', runId: run2.runId, expectedRevision: latest.revision })
  assert.equal(done2.state, 'finished')
  const after2 = await readNormalized(f, done2.resultPath)
  const aming2 = after2.entries.find((entry) => entry.name === '阿明')
  assert.ok(aming2, '人物条目仍在')
  assert.equal(aming2.id, aming1.id, 'id 零漂移')
  assert.deepEqual(aming2.provenance.chapters, [1, 2], 'chapters 并集排序＝跨 run 折叠的直接证据')
  // sources 并集：第一章的旧引用全保留，并新增第二章的引用
  const ids1 = new Set(aming1.sources.map((ref) => ref.segmentId))
  const ids2 = new Set(aming2.sources.map((ref) => ref.segmentId))
  assert.ok(aming2.sources.length > aming1.sources.length)
  for (const segmentId of ids1) assert.ok(ids2.has(segmentId), '旧段引用不丢')
  assert.ok(aming2.sources.some((ref) => ref.sourceId.includes('第二章')), '新增第二章引用')
  assert.ok(aming2.anchors.behavior.some((item) => item.includes('攥紧信')), '第二跑的行为锚点并进同一条目')
  assert.ok(aming2.traits.includes('警觉'), 'traits 并集')
  const gateKnowledge = (aming2.knowledge ?? []).find((item) => item.fromEntry === '守门人')
  assert.ok(gateKnowledge, 'knowledge source（守门人）落进 fromEntry')
  assert.ok(gateKnowledge.note && gateKnowledge.note.includes('午夜后'), 'learned 保留在 note')
  assert.equal(gateKnowledge.atSpan.from, 2, 'atSpan 锚到第二章')
  assert.ok(done2.consolidation, '回执带 consolidation 读数')
  // 新拍的 plot 条目照常新增
  const plots2 = after2.entries.filter((entry) => entry.layer === 'plot' && entry.provenance.chapters.includes(2))
  assert.ok(plots2.length > 0)
  // changes 里有 added（新拍）且无误报的 removed（人物条目仍在）
  const removed = after2.raw.current.changes.filter((item) => item.kind === 'source-removed')
  assert.ok(!removed.some((item) => item.id === aming1.id), '人物条目不该被当 removed')
})

test('P-TRIM Track 4：缓存池 flush——达水位时折进 archive，working 只留接续章，archive 可读', async (t) => {
  const f = await fixture(t)
  const ref2 = { pluginId: f.ref.pluginId, dir: f.ref.dir, file: '第二章.md', chapterNo: 2 }
  await f.fileService.write({ ...ref2, text: prose.replace('收起信', '攥紧信'), expectedRevision: 0 })
  const run1 = await f.good('prepare', initial(f.ref))
  // 注意：complete() 内部会调 finish（不带 flushPolicy）——这里自己走一遍以便带 policy
  let latest1 = null
  for (let safety = 0; safety < 100; safety += 1) {
    const task = await f.good('next', { dataset: 'book', runId: run1.runId })
    latest1 = task
    if (task.done) break
    const args = { dataset: 'book', runId: run1.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: `r1-${task.revision}` }
    args.rows = task.units.map((unit) => row(unit))
    await f.good('submit', args)
  }
  // flushChapters:1 → 第一章就触发（验证机制，不是验证默认水位）
  const done1 = await f.good('finish', {
    dataset: 'book', runId: run1.runId, expectedRevision: latest1.revision,
    flushPolicy: { flushChapters: 1, keepReferenced: true }
  })
  assert.ok(done1.cacheTier, '回执带缓存池读数')
  assert.ok(done1.cacheTier.flush, '达到章跨度水位 → 触发 flush')
  // 数据只在第 1 章 → 默认谓词「保留最新一章」把全部留在 working（这是设计意图：接续上下文的章不下沉）。
  // 要验证真下沉用 keepReferenced:false（下一步单独跑）。
  assert.equal(done1.cacheTier.flush.moved, 0, '单章数据的全部条目都属最新章 → 全部留热窗')
  assert.equal(done1.cacheTier.flush.stayed, done1.cacheTier.level.entries)
  assert.equal(done1.cacheTier.archive, 0, '没下沉就没有 archive 内容')

  // 缓存池水位从 archive 视图读（summary 不带它——summary 是 run 级读数，缓存池是 dataset 级）

  // archive 读口（此时为空：全留 working）
  const archive = await f.good('status', { dataset: 'book', view: 'archive' })
  assert.equal(archive.total, 0)
  assert.equal(archive.flushes, 1, 'flush 规划已记账（即使 moved=0）')

  // 第二跑：再 flush 一次，archive 累加（不覆盖）
  const run2 = await f.good('prepare', { dataset: 'book', requestId: 'run2', mode: 'update', sources: [f.ref, ref2] })
  let latest = null
  for (let safety = 0; safety < 100; safety += 1) {
    const task = await f.good('next', { dataset: 'book', runId: run2.runId })
    latest = task
    if (task.done) break
    const args = { dataset: 'book', runId: run2.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: `r2-${task.revision}` }
    args.rows = task.units.map((unit) => row(unit))
    await f.good('submit', args)
  }
  // 第二轮：keepReferenced:false → 全量下沉，archive 真的有了内容
  const done2 = await f.good('finish', {
    dataset: 'book', runId: run2.runId, expectedRevision: latest.revision,
    flushPolicy: { flushChapters: 1, keepReferenced: false }
  })
  assert.ok(done2.cacheTier.flush.moved > 0, 'keepReferenced:false 时全量下沉')
  assert.equal(done2.cacheTier.level.entries, 0, 'working 彻底换新（清空）')
  assert.ok(done2.cacheTier.archive > 0, 'archive 有内容了')
  assert.ok(done2.cacheTier.flush.knowledgeMap > 0, '产出知识映射')
  const archive2 = await f.good('status', { dataset: 'book', view: 'archive' })
  assert.ok(archive2.total > 0, 'archive 分页可读')
  assert.ok(archive2.knowledgeMap > 0)
  assert.equal(archive2.flushes, 2, '两次 flush 都记账')
})

test('P-TRIM Track 4：默认水位不触发（单章数据量远低于 120 条 / 4 章）', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  let latest = null
  for (let safety = 0; safety < 100; safety += 1) {
    const task = await f.good('next', { dataset: 'book', runId: run.runId })
    latest = task
    if (task.done) break
    const args = { dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId, submissionId: `d-${task.revision}` }
    args.rows = task.units.map((unit) => row(unit))
    await f.good('submit', args)
  }
  const done = await f.good('finish', { dataset: 'book', runId: run.runId, expectedRevision: latest.revision })
  assert.equal(done.cacheTier.flush, null, '默认水位下不 flush（全留 working）')
  assert.equal(done.cacheTier.archive, 0)
  assert.ok(done.cacheTier.level.entries > 0, 'working 有内容')
})
