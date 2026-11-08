import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { EXPERIENCE_CARRIER_ID } from '../carriers/experience/manifest.mjs'
import { EXPERIENCE_RECORD_CONFIG, EXPERIENCE_TOOL_NAMES, createExperienceTools } from '../carriers/experience/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T9 的单一真源对照：体验载体的记录文献语义来自 `@pinax/core/usecases/fileRecordTools`。
 * 本文件钉两件事：
 *   1) 工具面（名字／描述／schema／回执）与 core 同一份，作者可见的文档形状与修订号闸不变；
 *   2) core 的跑团运行时（回合事务、骰点、会话／分支恢复、场景／资源／同伴／主持）**没有**被
 *      偷偷套到记录上——meta 里的运行时快照原样进、原样出，不被会话记录形状或状态归一器改写。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_MODULE = createFileRecordToolsModule({ randomUUID: () => 'abcdef0123456789', fail, ok })

async function experienceProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '体验核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  // 体验依赖 script.scenes：闭包应自动装齐剧本载体，这里不做额外 extras。
  const created = await createProject({ root, name: '体验核心靶子', primaryCarrier: EXPERIENCE_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  await mkdir(join(root, '体验'), { recursive: true })
  const tools = createExperienceTools({ pluginId: EXPERIENCE_CARRIER_ID, fileService: opened.value.fileService })
  const call = (name, args = {}) => tools.find((tool) => tool.name === name).run(args)
  return { workspace, root, call }
}

function stripRun(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  }
}

test('体验工具面由 core 的 fileRecordTools 生成：四把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/experience/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileRecordTools'/u)
  assert.doesNotMatch(source, /jsonRecords\.mjs/u, '体验已切到 core 单一真源，不再走宿主记录底座')
  assert.doesNotMatch(source, /experience\/roleplayRuns|roleplayScenario|sessionRecords/u, '跑团运行时没有硬塞进记录工具面')

  const tools = createExperienceTools({ pluginId: EXPERIENCE_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), [...EXPERIENCE_TOOL_NAMES], '工具面仍是列／读／写／删四把')
  const reference = CORE_MODULE.createRecordTools({ pluginId: EXPERIENCE_CARRIER_ID }, EXPERIENCE_RECORD_CONFIG)
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')

  const save = tools.find((tool) => tool.name === 'pinax_experience_save')
  assert.equal(save.inputSchema.properties.body.maxLength, CORE_MODULE.RECORD_MAX_BODY_CHARS, '正文上限取 core 常量')
  assert.equal(save.inputSchema.required.includes('expectedRevision'), true, '修订号必填的契约仍由 core 给')
})

test('真文件链路：记录形状、修订号闸与 PINAX_* 回执不变，运行时快照只当 meta 原样搬运', async () => {
  const { workspace, root, call } = await experienceProject('experience-core-records')
  try {
    const empty = await call('pinax_experience_list')
    assert.equal(empty.ok, true, JSON.stringify(empty))
    assert.deepEqual([empty.value.file, empty.value.revision, empty.value.total], ['体验/体验.json', 0, 0])

    const runtimeState = {
      turn: 3,
      activeBranchId: 'branch-main',
      dicePool: [{ id: 'dice-1', sides: 20, result: 17 }],
      unknownRuntimeKey: { keep: true }
    }
    const created = await call('pinax_experience_save', {
      title: '雨夜跑团',
      type: 'run',
      status: 'running',
      order: 0,
      body: '第一回合记录',
      tags: ['跑团'],
      refs: ['剧本/雨夜/场景.json'],
      meta: { runtimeState, note: '老数据里本来就有混用。' },
      expectedRevision: 0
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.value.revision, 1)
    assert.equal(created.value.created, true)
    assert.equal(created.value.record.type, 'run', '记录文献不按 core 跑团类型洗值')
    assert.equal(created.value.record.status, 'running', 'status 原样收进来，不硬套 core 的 active／paused／ended')
    assert.deepEqual(created.value.record.meta, { runtimeState, note: '老数据里本来就有混用。' }, '运行时快照原样进，不被会话记录形状或状态归一器改写')

    const record = created.value.record
    const stale = await call('pinax_experience_save', { id: record.id, title: '抢先改', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION, '修订号不符必须拒，不覆盖不合并')
    assert.match(stale.error.code, /^PINAX_/u, '回执只出宿主码')

    const updated = await call('pinax_experience_save', { id: record.id, status: 'ended', expectedRevision: 1 })
    assert.equal(updated.ok, true, JSON.stringify(updated))
    assert.equal(updated.value.revision, 2)
    assert.equal(updated.value.record.body, '第一回合记录', '未传字段保留')
    assert.deepEqual(updated.value.record.meta, { runtimeState, note: '老数据里本来就有混用。' }, 'meta 不被界面没显示洗掉')
    assert.equal(updated.value.record.type, 'run')

    const read = await call('pinax_experience_read', { id: record.id })
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.deepEqual(read.value.record.meta.runtimeState.dicePool, [{ id: 'dice-1', sides: 20, result: 17 }])

    const disk = JSON.parse(await readFile(join(root, '体验', '体验.json'), 'utf-8'))
    assert.equal(disk.schemaVersion, CORE_MODULE.RECORD_SCHEMA_VERSION, '盘上 schema 版本取 core 常量')
    assert.deepEqual(disk.records[0].meta.runtimeState.unknownRuntimeKey, { keep: true })

    const removed = await call('pinax_experience_remove', { id: record.id, expectedRevision: 2 })
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.deepEqual(
      JSON.parse(await readFile(join(root, '体验', '体验.json'), 'utf-8')),
      { schemaVersion: CORE_MODULE.RECORD_SCHEMA_VERSION, records: [] },
      '只删记录不删文件：作者还能回看与恢复'
    )
  } finally {
    await workspace.cleanup()
  }
})

test('旧文档宽容、写严格：未知顶层字段原样保留；坏 JSON 与版本漂移拒绝按记录集读取', async () => {
  const { workspace, root, call } = await experienceProject('experience-core-legacy')
  const docPath = join(root, '体验', '体验.json')
  try {
    const legacy = {
      schemaVersion: 1,
      records: [{
        id: 'experience-legacy-00000001',
        title: '迁移旧会话',
        type: 'session',
        status: 'paused',
        order: 0,
        body: '旧数据里混进来的字段要原样留着。',
        tags: ['旧'],
        refs: [],
        meta: { roleplay: { scenarioId: 'scenario-old' } },
        origin: { host: 'web', version: 'experience_session_v1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }]
    }
    await writeFile(docPath, JSON.stringify(legacy, null, 2), 'utf-8')

    const listed = await call('pinax_experience_list')
    assert.equal(listed.ok, true, JSON.stringify(listed))
    assert.equal(listed.value.revision, 1, '盘上既有文件按第 1 版处理，expectedRevision 0 只留给真正的新建')

    const saved = await call('pinax_experience_save', { id: legacy.records[0].id, title: '迁移旧会话（校）', expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(saved.value.record.origin, { host: 'web', version: 'experience_session_v1' }, '未知顶层字段不因界面不显示就被洗掉')
    assert.deepEqual(saved.value.record.meta, { roleplay: { scenarioId: 'scenario-old' } }, '旧角色扮演快照不被 core 场景归一器改写')
    assert.equal(saved.value.record.createdAt, legacy.records[0].createdAt)

    await writeFile(docPath, '{ 这不是 JSON', 'utf-8')
    const bad = await call('pinax_experience_list')
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(String(bad.error.message), /不是合法 JSON/u)
    const refusedSave = await call('pinax_experience_save', { title: '不许盲写', expectedRevision: 2 })
    assert.equal(refusedSave.ok, false, '读不出文档就不能覆盖它')

    await writeFile(docPath, JSON.stringify({ schemaVersion: 2, records: [] }), 'utf-8')
    const drifted = await call('pinax_experience_list')
    assert.equal(drifted.ok, false)
    assert.match(String(drifted.error.message), /schemaVersion=2/u, '不自作主张升级／降级')
  } finally {
    await workspace.cleanup()
  }
})
