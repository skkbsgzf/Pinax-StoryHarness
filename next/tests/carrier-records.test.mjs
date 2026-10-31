import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { kernelToolNames } from '../runtime/mcpSurface.mjs'
import {
  BUILT_IN_CARRIER_PLUGINS,
  COMIC_CARRIER,
  COMIC_CARRIER_ID,
  COMIC_TOOL_NAMES,
  EXPERIENCE_CARRIER,
  EXPERIENCE_CARRIER_ID,
  EXPERIENCE_TOOL_NAMES,
  MATERIAL_CARRIER,
  MATERIAL_CARRIER_ID,
  MATERIAL_TOOL_NAMES,
  ONLINE_CARRIER,
  ONLINE_CARRIER_ID,
  ONLINE_TOOL_NAMES,
  SCRIPT_CARRIER_ID,
  SCRIPT_TOOL_NAMES,
  VIDEO_CARRIER,
  VIDEO_CARRIER_ID,
  VIDEO_TOOL_NAMES
} from '../carriers/index.mjs'
import { RECORD_CARRIERS, RECORD_CARRIER_KEYS, recordCarrierOfPaneId, recordTreeKey } from '../shell/recordCarriers.mjs'
import { MATERIAL_RECORD_CONFIG } from '../carriers/material/tools.mjs'
import { COMIC_RECORD_CONFIG } from '../carriers/comic/tools.mjs'
import { VIDEO_RECORD_CONFIG } from '../carriers/video/tools.mjs'
import { EXPERIENCE_RECORD_CONFIG } from '../carriers/experience/tools.mjs'
import { ONLINE_RECORD_CONFIG } from '../carriers/online/tools.mjs'
import { legacyBindingForPane } from '../shell/viewRegistry.mjs'
import { HISTORY_ALLOWED_DIRS } from '../history/gitHistory.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 批次40（M4／M5）：素材／漫画／视频／体验／联机五块记录型载体。
 * 证四件事：
 *   1) 五份清单都过内核校验，四把工具全是载体自有名字（内核 19 不虚增认领面）；
 *   2) 外壳对照表（recordCarriers）与清单不漂：目录／记录文件名／工具前缀／pane 前缀逐项对齐；
 *   3) 记录底座在真运行时空上跑通 list／read／save／remove，并发修订号与「未传字段保留」都成立；
 *   4) 体验的 requires（script.scenes）是真闸：闭包会自动装剧本，装不齐就拒绝建项目。
 */

const MANIFESTS = Object.freeze({
  material: MATERIAL_CARRIER,
  comic: COMIC_CARRIER,
  video: VIDEO_CARRIER,
  experience: EXPERIENCE_CARRIER,
  online: ONLINE_CARRIER
})
const TOOL_NAMES = Object.freeze({
  material: MATERIAL_TOOL_NAMES,
  comic: COMIC_TOOL_NAMES,
  video: VIDEO_TOOL_NAMES,
  experience: EXPERIENCE_TOOL_NAMES,
  online: ONLINE_TOOL_NAMES
})
/** 各栏记录底座的配置（工具自己用的那一份：目录／文件名／工具前缀）。 */
const RECORD_CONFIGS = Object.freeze({
  material: MATERIAL_RECORD_CONFIG,
  comic: COMIC_RECORD_CONFIG,
  video: VIDEO_RECORD_CONFIG,
  experience: EXPERIENCE_RECORD_CONFIG,
  online: ONLINE_RECORD_CONFIG
})

async function installAll({ without = [] } = {}) {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    if (without.includes(plugin.manifest.id)) continue
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  return registry
}

async function recordsProject(label, { primary = MATERIAL_CARRIER_ID, extras = [] } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '记录载体靶子')
  const registry = await installAll()
  const created = await createProject({ root, name: '记录载体靶子', primaryCarrier: primary, registry, extraEnabled: extras })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  const started = await runtime.start()
  assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
  return { workspace, root, registry, created, opened, runtime }
}

test('五份记录清单：各自一块目录、四把自有工具，外壳对照表逐项对齐', () => {
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(RECORD_CARRIER_KEYS, ['material', 'comic', 'video', 'experience', 'online'], '五栏顺序固定，界面用它排树')

  for (const key of RECORD_CARRIER_KEYS) {
    const manifest = MANIFESTS[key]
    const meta = RECORD_CARRIERS[key]
    const validated = validateCarrierManifest(manifest, { kinds: Object.keys(PROJECT_KINDS) })
    assert.equal(validated.ok, true, `${key}：${JSON.stringify(validated.error ?? {})}`)

    const dirs = Object.values(manifest.dataDirs)
    assert.equal(dirs.length, 1, `${key}：一块载体只认一棵内容树`)
    assert.ok(dirs.includes(meta.dir), `${key}：界面目录「${meta.dir}」必须在清单 dataDirs 里`)
    assert.deepEqual(manifest.tools, [...TOOL_NAMES[key]], `${key}：清单工具表必须与常量同源`)
    assert.equal(manifest.tools.length, 4, `${key}：列／读／写／删四把`)
    assert.equal(manifest.tools.every((name) => !kernel.has(name)), true, `${key}：四把都是载体自有名字，不认领内核工具`)
    assert.deepEqual(manifest.tools.map((name) => name.replace(/_list$|_read$|_save$|_remove$/u, '')), Array(4).fill(meta.toolPrefix), `${key}：工具前缀与界面表一致`)
    assert.equal(manifest.permissions[0].type, 'file')
    assert.equal(manifest.permissions[0].dir, meta.dir)
    assert.equal(manifest.permissions[0].mode, 'rw', `${key}：记录写入走 file:<目录>:rw`)
    assert.equal(manifest.permissions.includes('agent:ask'), true, `${key}：模型调用载体工具要前置授权`)
    assert.deepEqual(manifest.context.providers, [], `${key}：本批不提供上下文块，清单不谎报`)
    assert.equal(manifest.subscriptions.includes('project.changed'), true)

    const panes = manifest.contributes.panes.map((pane) => pane.id)
    // 素材这一栏多一块 overlay pane：它是协议 v3 的**自带面板样板**（内容面是插件自己的页面）。
    const expectedPanes = key === 'material'
      ? ['material.board', 'material.editor', 'material.panel']
      : [`${key}.board`, `${key}.editor`]
    assert.deepEqual(panes, expectedPanes, `${key}：左树＋中栏两块 pane（素材另有一块自带面板）`)
    assert.equal(recordCarrierOfPaneId(`${key}.editor`).key, key)
    assert.equal(recordCarrierOfPaneId(`${key}.board`).key, key)
    assert.equal(recordTreeKey(key), `records:${key}`)
    // 记录文件名：界面那份与工具那份必须同一个（漂了就是界面指的文件与工具写的文件不是一份）。
    assert.equal(meta.file, RECORD_CONFIGS[key].file, `${key}：界面与工具说的记录文件名不是同一个`)
    assert.equal(meta.dir, RECORD_CONFIGS[key].dir, `${key}：界面与工具说的目录不是同一个`)
    assert.equal(meta.toolPrefix, RECORD_CONFIGS[key].prefix, `${key}：界面与工具说的工具前缀不是同一个`)
    assert.equal(legacyBindingForPane(`${key}.editor`).kind, 'records-editor', `${key}：中栏走宿主 editor 视图的 records-editor 分支，不在外壳里写死 pane 前缀`)
    assert.equal(manifest.contributes.panes[0].view, 'pinax.view.list', `${key}：左栏声明的是清单视图，树由索引窗按 pane 前缀渲染`)
    assert.equal(HISTORY_ALLOWED_DIRS.includes(meta.dir), true, `${key}：「${meta.dir}」必须进变更历史的允许前缀，作者才回溯得到`)
  }
  assert.equal(recordCarrierOfPaneId('novel.editor'), null, '非记录载体的 pane id 不落进记录表')

  // 素材那一块是随框架发布的 v3 样板：自带面板必须三件套齐全（entry／custom 视图／custom-panel 内容面）。
  const materialPanels = MATERIAL_CARRIER.contributes.panes.filter((pane) => pane.slot === 'overlay')
  assert.equal(materialPanels.length, 1, '素材至多一块悬浮窗')
  assert.equal(materialPanels[0].view, 'pinax.view.custom')
  assert.equal(materialPanels[0].kind, 'custom-panel')
  assert.deepEqual(MATERIAL_CARRIER.entry, { kind: 'iframe', path: 'ui/index.html' })

  assert.deepEqual(EXPERIENCE_CARRIER.requires.map((item) => item.capability), ['script.scenes'], '体验的本子是剧本：依赖是真闸，不是提示语')
  assert.equal(EXPERIENCE_CARRIER.primary.projectKind, 'screenplay')
  assert.deepEqual({ ...ONLINE_CARRIER.dataDirs }, { online: '联机' })
  assert.equal(ONLINE_CARRIER.permissions.some((item) => item?.type === 'net'), false, '本批不申请网络作用域：联机只做记录，不偷偷联网')
})

test('体验的依赖闭包：装齐时自动带剧本；缺剧本时拒绝建项目并给出修复路径', async () => {
  const workspace = await createTempWorkspace('records-closure')
  try {
    const okRegistry = await installAll()
    const okRoot = join(workspace.projects, '体验闭包')
    const created = await createProject({ root: okRoot, name: '体验闭包', primaryCarrier: EXPERIENCE_CARRIER_ID, registry: okRegistry })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    assert.ok(created.value.enabled.includes(EXPERIENCE_CARRIER_ID))
    assert.ok(created.value.enabled.includes(SCRIPT_CARRIER_ID), '闭包必须自动装齐剧本载体')
    const top = await readFile(join(okRoot, '.pinax', 'project.json'), 'utf-8')
    assert.match(top, /pinax\.carrier\.script/, 'project.json 的启用清单里要如实记下剧本')

    const brokenRegistry = await installAll({ without: [SCRIPT_CARRIER_ID] })
    const brokenRoot = join(workspace.projects, '缺剧本')
    const refused = await createProject({ root: brokenRoot, name: '缺剧本', primaryCarrier: EXPERIENCE_CARRIER_ID, registry: brokenRegistry })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)
    assert.match(String(refused.error.message), /体验/)
    const repairs = (refused.error.details?.repairs ?? []).join('\n')
    assert.match(repairs, /pinax\.carrier\.script/, '拒绝文案必须点名去哪里补剧本')
    const hasProjectDocument = await readFile(join(brokenRoot, '.pinax', 'project.json'), 'utf-8').then(() => true, () => false)
    assert.equal(hasProjectDocument, false, '依赖装不齐时连项目文档都不许落，不能留半截空壳')
  } finally {
    await workspaceCleanup(workspace)
  }
})

test('记录底座真链路：空文档起步、带修订号写入、未传字段保留、list 过滤与 remove 后文件仍在', async () => {
  const { workspace, root, runtime } = await recordsProject('records-crud', {
    extras: [COMIC_CARRIER_ID, VIDEO_CARRIER_ID, ONLINE_CARRIER_ID, EXPERIENCE_CARRIER_ID]
  })
  try {
    const surface = runtime.surfaceInfo()
    const expectedNames = [...MATERIAL_TOOL_NAMES, ...COMIC_TOOL_NAMES, ...VIDEO_TOOL_NAMES, ...EXPERIENCE_TOOL_NAMES, ...ONLINE_TOOL_NAMES, ...SCRIPT_TOOL_NAMES].sort()
    assert.deepEqual([...surface.carrierToolNames].sort(), expectedNames, '五块记录载体各四把＋依赖闭包带进来的剧本三把')
    assert.equal(runtime.listTools().length, 19 + 1 + 23, '19 内核 ＋ 技能读取 1 ＋ 载体自有 23')
    assert.equal(runtime.ownerOf('pinax_material_list'), MATERIAL_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_online_remove'), ONLINE_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_script_list'), SCRIPT_CARRIER_ID, '闭包装进来的剧本工具确实在面上')

    const empty = await runtime.callTool('pinax_material_list', {})
    assert.equal(empty.value.payload.ok, true, JSON.stringify(empty.value.payload))
    assert.equal(empty.value.payload.file, '素材/素材.json')
    assert.equal(empty.value.payload.revision, 0, '还没有文件：修订号 0，不是坏文件')
    assert.equal(empty.value.payload.total, 0)

    const created = await runtime.callTool('pinax_material_save', {
      title: '雨夜参考图',
      type: 'reference-image',
      status: 'inbox',
      body: '巷口一盏灯，雨线斜着落。',
      tags: ['雨夜', '巷口'],
      refs: ['资料/参考/雨夜.png'],
      meta: { width: 1200, height: 800 },
      expectedRevision: 0
    })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.created, true)
    assert.equal(created.value.payload.revision, 1)
    const id = created.value.payload.record.id
    assert.match(id, /^material-[a-z0-9]+-[a-z0-9]{8}$/u, '记录 id 带载体前缀，老数据搬家时可换成旧 id')

    const blind = await runtime.callTool('pinax_material_save', { id, status: 'accepted', expectedRevision: 0 })
    assert.equal(blind.value.payload.ok, false)
    assert.equal(blind.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION, '修订号不符必须拒，不覆盖不合并')

    const read = await runtime.callTool('pinax_material_read', { id })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.record.title, '雨夜参考图')
    assert.deepEqual(read.value.payload.record.meta, { width: 1200, height: 800 })

    const updated = await runtime.callTool('pinax_material_save', { id, status: 'accepted', expectedRevision: 1 })
    assert.equal(updated.value.payload.ok, true, JSON.stringify(updated.value.payload))
    assert.equal(updated.value.payload.revision, 2)
    assert.equal(updated.value.payload.record.status, 'accepted')
    assert.equal(updated.value.payload.record.title, '雨夜参考图', '未传的字段保留')
    assert.deepEqual(updated.value.payload.record.tags, ['雨夜', '巷口'], '未传的 tags 保留')
    assert.deepEqual(updated.value.payload.record.meta, { width: 1200, height: 800 }, 'meta 不许因为界面没显示就被洗掉')
    assert.equal(updated.value.payload.record.createdAt, created.value.payload.record.createdAt, 'createdAt 不被改写')

    const accepted = await runtime.callTool('pinax_material_list', { status: 'accepted' })
    assert.equal(accepted.value.payload.total, 1)
    const byQuery = await runtime.callTool('pinax_material_list', { query: '雨线' })
    assert.equal(byQuery.value.payload.total, 1)
    const byMiss = await runtime.callTool('pinax_material_list', { query: '不存在的东西' })
    assert.equal(byMiss.value.payload.total, 0)
    const byType = await runtime.callTool('pinax_material_list', { type: 'inspiration' })
    assert.equal(byType.value.payload.total, 0)

    const staleRemove = await runtime.callTool('pinax_material_remove', { id, expectedRevision: 1 })
    assert.equal(staleRemove.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    const removed = await runtime.callTool('pinax_material_remove', { id, expectedRevision: 2 })
    assert.equal(removed.value.payload.ok, true, JSON.stringify(removed.value.payload))
    assert.equal(removed.value.payload.revision, 3)
    assert.equal((await runtime.callTool('pinax_material_list', {})).value.payload.total, 0)
    const goneRead = await runtime.callTool('pinax_material_read', { id })
    assert.equal(goneRead.value.payload.ok, false, '删了就如实说没有，不拼一条相近的')

    const disk = JSON.parse(await readFile(join(root, '素材', '素材.json'), 'utf-8'))
    assert.deepEqual(disk, { schemaVersion: 1, records: [] }, '只删记录不删文件：作者还能回看与恢复')

    // 同一套工具在另一块载体上读写的是另一份文档，互不串味。
    const comicEmpty = await runtime.callTool('pinax_comic_list', {})
    assert.equal(comicEmpty.value.payload.file, '漫画/漫画.json')
    assert.equal(comicEmpty.value.payload.revision, 0)
    const comicSaved = await runtime.callTool('pinax_comic_save', { title: '第1页', type: 'comic-page', expectedRevision: 0 })
    assert.equal(comicSaved.value.payload.revision, 1)
    const materialStill = await runtime.callTool('pinax_material_list', {})
    assert.equal(materialStill.value.payload.revision, 3, '漫画写入不许动素材文档的修订号')
  } finally {
    await runtime.stop()
    await workspaceCleanup(workspace)
  }
})

test('坏文档与版本漂移：拒绝按记录集读取，也不自作主张升级', async () => {
  const workspace = await createTempWorkspace('records-badjson')
  try {
    const registry = await installAll()
    const root = join(workspace.projects, '坏文档靶子')
    await createProject({ root, name: '坏文档靶子', primaryCarrier: VIDEO_CARRIER_ID, registry })
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(root, '视频'), { recursive: true })
    await writeFile(join(root, '视频', '视频.json'), '{ 这不是 JSON', 'utf-8')
    const opened = await openProject({ root, registry })
    const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    await runtime.start()
    try {
      const bad = await runtime.callTool('pinax_video_list', {})
      assert.equal(bad.value.payload.ok, false)
      assert.equal(bad.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
      assert.match(String(bad.value.payload.message), /不是合法 JSON/)

      await writeFile(join(root, '视频', '视频.json'), JSON.stringify({ schemaVersion: 2, records: [] }), 'utf-8')
      const drifted = await runtime.callTool('pinax_video_list', {})
      assert.equal(drifted.value.payload.ok, false)
      assert.match(String(drifted.value.payload.message), /schemaVersion=2/)

      const ensured = await runtime.callTool('pinax_video_save', { title: '新镜头', expectedRevision: 1 })
      assert.equal(ensured.value.payload.ok, false, '读不出文档就不能覆盖它')
    } finally {
      await runtime.stop()
    }
  } finally {
    await workspaceCleanup(workspace)
  }
})

async function workspaceCleanup(workspace) {
  const { rm } = await import('node:fs/promises')
  await rm(workspace.base, { recursive: true, force: true, maxRetries: 3 })
}
