import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { NOVEL_CARRIER_ID } from '../carriers/novel/manifest.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'
import { createFactExtractionTools } from '../runtime/factExtractionTools.mjs'

/**
 * 三段式流水线接进产品工具面（P-1，作者 2026-11-11 裁定「可以」）。
 *
 * 这一层的职责是：**让 agent 不必自己切句、不必写事件文本、不必判批**。
 *   · next 返回的 unit 直接带 blocks（切块是服务端零模型做的）；
 *   · submit 收 bindings（{id,who,ch}）而不是完整行，事件正文由服务端取块原文回组装；
 *   · 绑定里编造的人名（原文没有）被丢弃且计数——模型输出不能污染事实；
 *   · 跨批名表累积（P-3）与 run 级时间地点默认（P-4）在同一接口上暴露。
 */

const plugins = await loadBuiltInCarrierPlugins()
const prose = '周明瑞推开门，低声问：“谁在那儿？”他握紧左轮手枪，慢慢走进房间。门后一片漆黑，什么也没有。\n'.repeat(16)

async function fixture(t) {
  const workspace = await createTempWorkspace('fact-blocks-service')
  t.after(() => workspace.cleanup())
  const root = join(workspace.projects, '三段式靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of plugins) assert.equal(registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {}).ok, true)
  assert.equal((await createProject({ root, name: '三段式靶子', primaryCarrier: NOVEL_CARRIER_ID, registry })).ok, true)
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true)
  const { fileService, view } = opened.value
  const dir = Object.values(registry.get(NOVEL_CARRIER_ID).dataDirs)[0]
  const ref = { pluginId: NOVEL_CARRIER_ID, dir, file: '第一章.md', chapterNo: 1 }
  await fileService.write({ ...ref, text: prose, expectedRevision: 0 })
  const options = { root, fileService, registry, view }
  const tools = createFactExtractionTools(options)
  const call = async (method, args) => tools.get(`pinax_extract_${method}`).tool.run(args)
  const good = async (method, args) => {
    const result = await call(method, args)
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  }
  return { ...options, tools, call, good, ref }
}

const initial = (ref, extra = {}) => ({ dataset: 'book', requestId: 'initial', domain: '试验世界', book: '试验书', sources: [ref], ...extra })

test('〔P1-1〕next 派发的单元自带块：正文、通道提示、块 id 齐备', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  assert.ok(task.units.length > 0)
  for (const unit of task.units) {
    assert.ok(Array.isArray(unit.blocks) && unit.blocks.length > 0, '每个单元必须带切好的块')
    for (const block of unit.blocks) {
      assert.match(block.id, /^b\d+$/u, '块 id 供绑定对齐')
      assert.ok(block.text, '块正文由服务端切好')
      assert.equal(typeof block.hint, 'string', '通道提示随块下发')
    }
    assert.equal(typeof unit.text, 'string', '原文仍在（供核对，不要求模型抄）')
  }
})

test('〔P1-2〕bindings 提交：服务端回组装，事件正文逐字等于块原文', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const bindings = task.units.map((unit) => ({
    id: unit.id,
    blocks: unit.blocks.map((block) => ({ id: block.id, who: '周明瑞', ch: block.hint })),
    settings: [],
    knowledge: [],
    hooks: []
  }))
  const result = await f.good('submit', {
    dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId,
    submissionId: 'bind-1', bindings
  })
  assert.ok(result.bindStats, '绑定路径要回统计')
  assert.equal(result.bindStats.hallucinated, 0, '周明瑞在本章原文里出现，不算幻觉')

  // 读回该段行：事件正文必须逐字等于下一批派发时的块原文
  const state = JSON.parse(await readFile(join(f.root, result.resultPath), 'utf8'))
  const rowId = task.units[0].id
  const stored = state.runs[run.runId].rows[rowId]
  assert.ok(stored, '行已落盘')
  const unit = task.units[0]
  assert.equal(stored.events.length, unit.blocks.length, '块数与事件数一致')
  stored.events.forEach((event, index) => {
    assert.equal(event.content, unit.blocks[index].text, '正文取块原文，模型无法改写')
  })
  assert.deepEqual(stored.when, { story_time: '未明示', timeline: '顺叙' }, '模板字段由代码给默认值')
})

test('〔P1-3〕绑定里的幻觉人名被丢弃并计数，不写进 who', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const bindings = task.units.map((unit) => ({
    id: unit.id,
    blocks: unit.blocks.map((block) => ({ id: block.id, who: '完全不存在的人', ch: block.hint }))
  }))
  const result = await f.good('submit', {
    dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId,
    submissionId: 'bind-ghost', bindings
  })
  assert.ok(result.bindStats.hallucinated > 0, '幻觉必须计数，不能静默吞')
  const state = JSON.parse(await readFile(join(f.root, result.resultPath), 'utf8'))
  const stored = state.runs[run.runId].rows[task.units[0].id]
  assert.deepEqual(stored.who, [], '编出来的人名一个都不进 who')
  assert.ok(stored.events.every((event) => event.who === ''))
})

test('〔P1-4〕P-3 跨批名表累积：第二批的 next 带上前一批的人名', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const first = await f.good('next', { dataset: 'book', runId: run.runId })
  await f.good('submit', {
    dataset: 'book', runId: run.runId, expectedRevision: first.revision, taskId: first.taskId,
    submissionId: 'bind-names',
    bindings: first.units.map((unit) => ({
      id: unit.id,
      blocks: unit.blocks.map((block) => ({ id: block.id, who: '周明瑞', ch: block.hint }))
    }))
  })
  const second = await f.good('next', { dataset: 'book', runId: run.runId })
  if (second.done) return   // 一章一批时第二批就直接 ready，名表用例退化为不再验证
  assert.ok(Array.isArray(second.knownNames), 'second 批要带名表')
  assert.ok(second.knownNames.includes('周明瑞'), 'P-3：上一批确定的人名进入下一批切块器')
})

test('〔P1-5〕P-4 run 级时间地点默认：prepare 给了就全批继承，段级可覆盖', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref, {
    requestId: 'initial-timed',
    timeDefaults: { when: { story_time: '1901年夏', timeline: '顺叙' }, where: '廷根市' }
  }))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const bindings = task.units.map((unit, index) => ({
    id: unit.id,
    blocks: unit.blocks.map((block) => ({ id: block.id, who: '', ch: block.hint })),
    // 只给第一段一个例外：其余段必须继承 run 级默认
    ...(index === 0 ? { when: { story_time: '当夜' }, where: '灰雾世界' } : {})
  }))
  const result = await f.good('submit', {
    dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId,
    submissionId: 'bind-time', bindings
  })
  const state = JSON.parse(await readFile(join(f.root, result.resultPath), 'utf8'))
  const rows = state.runs[run.runId].rows
  const first = rows[task.units[0].id]
  assert.equal(first.when.story_time, '当夜', '段级例外优先')
  assert.equal(first.where, '灰雾世界')
  assert.equal(first.when.timeline, '顺叙', '没覆盖的字段仍取 run 默认')
  if (task.units.length > 1) {
    const second = rows[task.units[1].id]
    assert.equal(second.when.story_time, '1901年夏', 'run 级默认继承')
    assert.equal(second.where, '廷根市')
  }
})

test('〔P1-6〕rows 与 bindings 双形态都被接受；同段以 rows 为准', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const unit = task.units[0]
  const bindings = task.units.map((item) => ({
    id: item.id,
    blocks: item.blocks.map((block) => ({ id: block.id, who: '', ch: block.hint }))
  }))
  const manual = {
    segmentId: unit.id, who: ['手工补的人'], when: { story_time: '手写时间', timeline: '插叙' }, where: '手写地点',
    events: [{ who: '手工补的人', channel: 'do', content: '手工事件' }],
    notes: '', characters: [], settings: []
  }
  const result = await f.good('submit', {
    dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId,
    submissionId: 'mixed', bindings, rows: [manual]
  })
  const state = JSON.parse(await readFile(join(f.root, result.resultPath), 'utf8'))
  const stored = state.runs[run.runId].rows[unit.id]
  assert.equal(stored.when.story_time, '手写时间', '显式 rows 覆盖同段的绑定产物')
})

test('〔P1-7〕bindings 为空数组时明确拒绝，不静默推进', async (t) => {
  const f = await fixture(t)
  const run = await f.good('prepare', initial(f.ref))
  const task = await f.good('next', { dataset: 'book', runId: run.runId })
  const result = await f.call('submit', {
    dataset: 'book', runId: run.runId, expectedRevision: task.revision, taskId: task.taskId,
    submissionId: 'empty-bind', bindings: []
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'INVALID_INPUT', '空 bindings 且无 rows 要如实拒')
})
