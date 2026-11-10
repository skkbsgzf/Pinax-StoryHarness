import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createMemoryOutlineNodeStore } from '@pinax/core/adapters/memoryOutlineNodeStore'
import { createMemoryOutlineEdgeStore } from '@pinax/core/adapters/memoryOutlineEdgeStore'
import { createSyncOutlineNodeService } from '@pinax/core/usecases/syncOutlineNodeService'
import { createSyncOutlineEdgeService } from '@pinax/core/usecases/syncOutlineEdgeService'
import { planOutlineMove } from '@pinax/core/domain/outlineTree'
import { CORE_ERROR_CODES } from '@pinax/core/contracts/errors'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { OUTLINE_CARRIER_ID } from '../carriers/outline/manifest.mjs'
import { createOutlineTools } from '../carriers/outline/tools.mjs'
import { toHostResult, validateOutlineDocument } from '../carriers/outline/outlineStore.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T5 的行为对照：大纲载体的 fileService→Core 适配器与 Core 自己的参照实现
 * （syncOutlineNodeService／syncOutlineEdgeService／planOutlineMove）跑同一段剧本。
 * 节点 id/重复、parentId 父存在与环检测、边的自环/端点/去重都以 Core 判词为准；
 * 适配器只负责把裸码翻译成宿主 PINAX_*，落盘仍是作者原文。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const BOOK = 'outline'
const NODES = [{ id: 'n1', title: '开场' }, { id: 'n2', title: '第一折' }]

async function outlineProject(label, fill = null) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '大纲核心对照')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '大纲核心对照', primaryCarrier: OUTLINE_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  if (fill) {
    await mkdir(join(root, '大纲'), { recursive: true })
    for (const [name, text] of Object.entries(fill)) await writeFile(join(root, '大纲', name), text, 'utf-8')
  }
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const tools = createOutlineTools({ pluginId: OUTLINE_CARRIER_ID, fileService: opened.value.fileService })
  return { workspace, root, tools }
}

test('错误码只在适配器边界翻译：Core 裸码不外泄，PINAX_* 原样放行', () => {
  const table = {
    [CORE_ERROR_CODES.STALE_REVISION]: NEXT_ERROR_CODES.STALE_REVISION,
    [CORE_ERROR_CODES.IO_FAILED]: NEXT_ERROR_CODES.IO_FAILED,
    [CORE_ERROR_CODES.INVALID_INPUT]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.OUTLINE_NODE_NOT_FOUND]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.DUPLICATE_OUTLINE_NODE]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.OUTLINE_CYCLE]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.OUTLINE_EDGE_NOT_FOUND]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.DUPLICATE_OUTLINE_EDGE]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.OUTLINE_ENDPOINT_NOT_FOUND]: NEXT_ERROR_CODES.INVALID_INPUT,
    [CORE_ERROR_CODES.BOOK_NOT_FOUND]: NEXT_ERROR_CODES.INVALID_INPUT
  }
  for (const [coreCode, hostCode] of Object.entries(table)) {
    const translated = toHostResult({ ok: false, error: { code: coreCode, message: '判词', details: { probe: 1 } } })
    assert.equal(translated.error.code, hostCode, coreCode)
    assert.equal(translated.error.message, '判词')
    assert.deepEqual(translated.error.details, { probe: 1 })
  }
  const unknown = toHostResult({ ok: false, error: { code: 'SOMETHING_NEW', message: '没登记' } })
  assert.equal(unknown.error.code, NEXT_ERROR_CODES.INVALID_INPUT, '没登记的 Core 码也绝不外泄')
  const pinax = { ok: false, error: { code: NEXT_ERROR_CODES.DIR_CONFLICT, message: '归属闸' } }
  assert.equal(toHostResult(pinax), pinax, '宿主信封原样放行')
  const success = { ok: true, value: 1 }
  assert.equal(toHostResult(success), success)
})

test('节点语义对齐 Core：重复 id 判词同源，适配器只把码翻成 PINAX_INVALID_INPUT', () => {
  const memory = createSyncOutlineNodeService({ store: createMemoryOutlineNodeStore() })
  assert.equal(memory.create(BOOK, NODES[0]).ok, true)
  const coreDuplicate = memory.create(BOOK, { id: 'n1', title: '重名' })
  assert.equal(coreDuplicate.ok, false)
  assert.equal(coreDuplicate.error.code, CORE_ERROR_CODES.DUPLICATE_OUTLINE_NODE)

  const hostDuplicate = validateOutlineDocument({ nodes: [{ id: 'n1', title: '甲' }, { id: 'n1', title: '乙' }], edges: [] })
  assert.equal(hostDuplicate.ok, false)
  assert.equal(hostDuplicate.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.equal(hostDuplicate.error.details.nodeId, 'n1')

  assert.equal(validateOutlineDocument({ nodes: NODES, edges: [] }).ok, true)
})

test('parentId 树对齐 Core：父不存在、自环、后代环都以 planOutlineMove 的判词为准', () => {
  const coreMissing = planOutlineMove([{ id: 'a', title: 'A' }], { nodeId: 'a', parentId: 'ghost', expectedRevision: 0 })
  assert.equal(coreMissing.ok, false)
  assert.equal(coreMissing.error.code, CORE_ERROR_CODES.OUTLINE_NODE_NOT_FOUND)
  const hostMissing = validateOutlineDocument({ nodes: [{ id: 'a', title: 'A', parentId: 'ghost' }], edges: [] })
  assert.equal(hostMissing.ok, false)
  assert.equal(hostMissing.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

  const coreSelf = planOutlineMove([{ id: 'a', title: 'A' }], { nodeId: 'a', parentId: 'a', expectedRevision: 0 })
  assert.equal(coreSelf.ok, false)
  assert.equal(coreSelf.error.code, CORE_ERROR_CODES.OUTLINE_CYCLE)
  const hostSelf = validateOutlineDocument({ nodes: [{ id: 'a', title: 'A', parentId: 'a' }], edges: [] })
  assert.equal(hostSelf.ok, false)
  assert.equal(hostSelf.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

  const ring = [{ id: 'a', title: 'A', parentId: 'b' }, { id: 'b', title: 'B', parentId: 'a' }]
  const coreRing = planOutlineMove(ring, { nodeId: 'a', parentId: 'b', expectedRevision: 0 })
  assert.equal(coreRing.ok, false)
  assert.equal(coreRing.error.code, CORE_ERROR_CODES.OUTLINE_CYCLE)
  const hostRing = validateOutlineDocument({ nodes: ring, edges: [] })
  assert.equal(hostRing.ok, false)
  assert.equal(hostRing.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

  assert.equal(validateOutlineDocument({ nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', parentId: 'a' }], edges: [] }).ok, true)
})

test('边语义对齐 Core：legacy from/to、source/target 都能用；自环、端点缺失、重复按 Core 判', () => {
  const nodeStore = createMemoryOutlineNodeStore()
  for (const node of NODES) assert.equal(nodeStore.create(BOOK, node).ok, true)
  const coreEdges = createSyncOutlineEdgeService({ store: createMemoryOutlineEdgeStore(), nodeStore })
  const document = (edges) => ({ nodes: NODES, edges })
  const before = JSON.stringify(document([{ from: 'n1', to: 'n2' }]))

  assert.equal(coreEdges.add(BOOK, { id: 'e1', from: 'n1', to: 'n2' }).ok, true)
  assert.equal(validateOutlineDocument(document([{ from: 'n1', to: 'n2' }])).ok, true)
  assert.equal(validateOutlineDocument(document([{ source: 'n1', target: 'n2' }])).ok, true, 'legacy source/target 也认')

  const coreSelf = coreEdges.add(BOOK, { id: 'e2', from: 'n1', to: 'n1' })
  assert.equal(coreSelf.ok, false)
  assert.equal(coreSelf.error.code, CORE_ERROR_CODES.INVALID_INPUT)
  const hostSelf = validateOutlineDocument(document([{ from: 'n1', to: 'n1' }]))
  assert.equal(hostSelf.ok, false)
  assert.equal(hostSelf.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

  const coreMissing = coreEdges.add(BOOK, { id: 'e3', from: 'n1', to: 'ghost' })
  assert.equal(coreMissing.ok, false)
  assert.equal(coreMissing.error.code, CORE_ERROR_CODES.OUTLINE_ENDPOINT_NOT_FOUND)
  const hostMissing = validateOutlineDocument(document([{ from: 'n1', to: 'ghost' }]))
  assert.equal(hostMissing.ok, false)
  assert.equal(hostMissing.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.deepEqual(hostMissing.error.details.missingNodeIds, ['ghost'], 'Core 的 details 原样带出')

  const coreDuplicate = coreEdges.add(BOOK, { id: 'e4', from: 'n1', to: 'n2' })
  assert.equal(coreDuplicate.ok, false)
  assert.equal(coreDuplicate.error.code, CORE_ERROR_CODES.DUPLICATE_OUTLINE_EDGE)
  const hostDuplicate = validateOutlineDocument(document([{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n2' }]))
  assert.equal(hostDuplicate.ok, false)
  assert.equal(hostDuplicate.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

  assert.equal(coreEdges.add(BOOK, { id: 'e5', kind: 'leads', from: 'n1', to: 'n2' }).ok, true, '不同 kind 不算重复')
  assert.equal(validateOutlineDocument(document([
    { from: 'n1', to: 'n2', kind: 'leads' },
    { from: 'n1', to: 'n2', kind: 'causes' }
  ])).ok, true, 'legacy 边按 kind+端点合成定位键，不互相误伤')

  const idA = { id: 'same', fromNodeId: 'n1', toNodeId: 'n2' }
  const idB = { id: 'same', fromNodeId: 'n2', toNodeId: 'n1' }
  assert.equal(validateOutlineDocument(document([idA, idB])).ok, false, '显式 id 重复按 Core 拒')
  assert.equal(JSON.stringify(document([{ from: 'n1', to: 'n2' }])), before, '校验只读，不改作者文档')
})

test('落盘口径：合法文档原样写回（不补 Core 默认字段）；环与悬空边拒写且磁盘不动', async () => {
  const seed = {
    nodes: [{ id: 'n1', title: '开场', summary: '作者写的摘要' }, { id: 'n2', title: '第一折' }],
    edges: [{ from: 'n1', to: 'n2' }]
  }
  const { workspace, root, tools } = await outlineProject('outline-core-write', {
    'outline.json': JSON.stringify(seed, null, 2)
  })
  const read = tools.find((tool) => tool.name === 'pinax_outline_read')
  const save = tools.find((tool) => tool.name === 'pinax_outline_save')
  try {
    const opened = await read.run({})
    assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
    assert.equal(opened.value.revision, 1)

    const saved = await save.run({ nodes: seed.nodes, edges: seed.edges, expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    assert.deepEqual(JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8')), seed, '节点/边形状一个不改')

    const tree = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', parentId: 'a' }]
    const treeSaved = await save.run({ nodes: tree, edges: [], expectedRevision: saved.value.revision })
    assert.equal(treeSaved.ok, true, JSON.stringify(treeSaved.error ?? {}))
    const treeDisk = JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8'))
    assert.deepEqual(treeDisk.nodes[1], { id: 'b', title: 'B', parentId: 'a' }, '不往作者节点上补 intent/order/status/revision')

    const cycle = [{ id: 'a', title: 'A', parentId: 'b' }, { id: 'b', title: 'B', parentId: 'a' }]
    const rejected = await save.run({ nodes: cycle, edges: [], expectedRevision: treeSaved.value.revision })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.deepEqual(JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8')), treeDisk, '拒写后磁盘不动')
  } finally {
    await workspace.cleanup()
  }
})

test('读宽容 / 写严格：悬空边的大纲仍读得出来，保存时才按 Core 端点规则拒', async () => {
  const seed = { nodes: [{ id: 'n1', title: '开场' }], edges: [{ from: 'n1', to: '已删除的节点' }] }
  const { workspace, root, tools } = await outlineProject('outline-core-dangling', {
    'outline.json': JSON.stringify(seed, null, 2)
  })
  const read = tools.find((tool) => tool.name === 'pinax_outline_read')
  const save = tools.find((tool) => tool.name === 'pinax_outline_save')
  try {
    const opened = await read.run({})
    assert.equal(opened.ok, true, '读是投影，不拿 Core 写入规则卡住已有文档')
    assert.deepEqual(opened.value.edges, seed.edges)

    const rejected = await save.run({ nodes: seed.nodes, edges: seed.edges, expectedRevision: opened.value.revision })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.deepEqual(rejected.error.details.missingNodeIds, ['已删除的节点'])
    assert.deepEqual(JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8')), seed, '拒写后磁盘不动')
  } finally {
    await workspace.cleanup()
  }
})
