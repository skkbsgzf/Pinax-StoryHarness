import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { collectAgentMdBlocks } from '../runtime/contextProfiles.mjs'
import {
  BUILT_IN_CARRIER_PLUGINS,
  COMIC_CARRIER_ID,
  MATERIAL_CARRIER,
  MATERIAL_CARRIER_ID
} from '../carriers/index.mjs'
import {
  PLUGIN_PROTOCOL,
  contentTypeFor,
  normalizeRelativePath,
  parsePluginUrl,
  pluginEntryUrl
} from '../shell/pluginProtocol.mjs'
import {
  PANEL_MESSAGE,
  panelError,
  panelResult,
  parsePanelRequest
} from '../shell/pluginBridge.mjs'
import {
  PLUGIN_FILE_STATUS,
  createPluginFileHandler,
  resolvePluginFile
} from '../shell/pluginFileServer.mjs'
import { CUSTOM_VIEW_TYPE, resolvePaneView } from '../shell/viewRegistry.mjs'
import { createIpcDispatcher, IPC_CHANNELS } from '../shell/ipcContract.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 协议 v3 的 `entry` 面（插件自带面板）整链单测。
 *
 * 这一面有五段，缺一段面板就只是「清单里写了个字段」：
 *   1) 协议层  pinax-plugin://<pluginId>/<相对路径>：拼 URL、解析 URL、拒越界与盘符；
 *   2) 文件供给  面板页只能读自己那个插件目录（200／404／越界拒）；
 *   3) 桥合同  面板 ↔ 宿主只有四个动作，载荷形状在这一层校验；
 *   4) 视图注册  custom 视图解析出的内容面是 custom-panel（不是占位）；
 *   5) 主进程闸  plugin:tool-call 只放只读工具、放本板工具与内核只读工具。
 * 另加两段：载体自己的资产目录（面板页与 AGENT.md 真的在盘上）、AGENT.md 真的进上下文。
 */

function materialPlugin() {
  return BUILT_IN_CARRIER_PLUGINS.find((plugin) => plugin.manifest.id === MATERIAL_CARRIER_ID)
}

/** 装全部内置载体，返回注册表（每块都带自己的插件目录）。 */
function installAll() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  return registry
}

async function materialProject(label, { extras = [] } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '面板靶子')
  const registry = installAll()
  const created = await createProject({ root, name: '面板靶子', primaryCarrier: MATERIAL_CARRIER_ID, registry, extraEnabled: extras })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  await runtime.start()
  return { workspace, root, registry, opened, runtime, view: opened.value.view }
}

test('协议层：入口 URL 拼得出、解析得回；越界路径与盘符一律不认', () => {
  const url = pluginEntryUrl(MATERIAL_CARRIER_ID, 'ui/index.html')
  assert.equal(url, `${PLUGIN_PROTOCOL}://${MATERIAL_CARRIER_ID}/ui/index.html`)
  assert.deepEqual(parsePluginUrl(url), { pluginId: MATERIAL_CARRIER_ID, relativePath: 'ui/index.html' })

  assert.equal(pluginEntryUrl('Material', 'ui/index.html'), null, '插件 id 不合词表就不给 URL')
  assert.equal(pluginEntryUrl(MATERIAL_CARRIER_ID, '../secret.txt'), null, '越界路径不给 URL')
  assert.equal(pluginEntryUrl(MATERIAL_CARRIER_ID, 'ui/../../secret.txt'), null, '夹带越界的路径不给 URL')
  assert.equal(pluginEntryUrl(MATERIAL_CARRIER_ID, 'C:/Windows/system.ini'), null, '盘符绝对路径不给 URL')
  assert.equal(pluginEntryUrl(MATERIAL_CARRIER_ID, ''), null)

  assert.equal(normalizeRelativePath('/ui/index.html'), 'ui/index.html', '前导斜杠归一')
  assert.equal(normalizeRelativePath('ui\\index.html'), 'ui/index.html', '反斜杠归一成正斜杠')
  assert.equal(normalizeRelativePath('a/../b'), null, '任何一段 .. 都拒')
  assert.equal(normalizeRelativePath('a:b'), null, '冒号（盘符）拒')

  assert.equal(parsePluginUrl('file:///C:/secret.txt'), null, '别的协议不认')
  assert.equal(parsePluginUrl(`${PLUGIN_PROTOCOL}://material`), null, '没有相对路径不认')
  assert.equal(contentTypeFor('ui/index.html'), 'text/html; charset=utf-8')
  assert.equal(contentTypeFor('ui/panel.js'), 'text/javascript; charset=utf-8')
  assert.equal(contentTypeFor('ui/whatever'), 'application/octet-stream', '认不出的类型不猜 html')
})

test('文件供给：面板页只从自己那个插件目录出，越界与不存在都拒', async () => {
  const plugin = materialPlugin()
  const dir = plugin.meta.dir
  const handler = createPluginFileHandler({ resolvePluginDir: (id) => (id === MATERIAL_CARRIER_ID ? dir : null) })

  const page = await handler(`${PLUGIN_PROTOCOL}://${MATERIAL_CARRIER_ID}/ui/index.html`)
  assert.equal(page.status, PLUGIN_FILE_STATUS.ok)
  assert.equal(page.contentType, 'text/html; charset=utf-8')
  assert.match(String(page.body), /素材面板/)

  const script = await handler(`${PLUGIN_PROTOCOL}://${MATERIAL_CARRIER_ID}/ui/panel.js`)
  assert.equal(script.status, PLUGIN_FILE_STATUS.ok)
  assert.equal(script.contentType, 'text/javascript; charset=utf-8')

  const unknownPlugin = await handler(`${PLUGIN_PROTOCOL}://${COMIC_CARRIER_ID}/ui/index.html`)
  assert.equal(unknownPlugin.status, PLUGIN_FILE_STATUS.notFound, '没登记目录的插件拿不到文件')

  const missing = await handler(`${PLUGIN_PROTOCOL}://${MATERIAL_CARRIER_ID}/ui/nope.html`)
  assert.equal(missing.status, PLUGIN_FILE_STATUS.notFound)

  const escaped = await handler(`${PLUGIN_PROTOCOL}://${MATERIAL_CARRIER_ID}/../../secret.txt`)
  assert.equal(escaped.status, PLUGIN_FILE_STATUS.notFound, '越界路径在解析那一层就被拒，不给第二次机会')

  // 文件落地的解析口径单独核：解析层放行的路径，落盘时还要再查一次越界。
  assert.equal(resolvePluginFile(dir, 'ui/index.html'), resolve(dir, 'ui/index.html'))
  assert.equal(resolvePluginFile(dir, '../outside.txt'), null, '落盘前的越界检查是第二道闸')
  assert.equal(resolvePluginFile('', 'ui/index.html'), null)
})

test('桥合同：四个动作、两向；载荷形状不对就不往下走', () => {
  assert.equal(PANEL_MESSAGE.ready, 'pinax.panel.ready')
  assert.equal(PANEL_MESSAGE.callTool, 'pinax.panel.callTool')
  assert.equal(PANEL_MESSAGE.toolResult, 'pinax.panel.toolResult')
  assert.equal(PANEL_MESSAGE.error, 'pinax.panel.error')

  assert.deepEqual(parsePanelRequest({ type: PANEL_MESSAGE.ready, id: 'boot' }), { type: PANEL_MESSAGE.ready, id: 'boot' })
  assert.deepEqual(
    parsePanelRequest({ type: PANEL_MESSAGE.callTool, id: 'call-1', name: 'pinax_material_list', arguments: { query: '雨' } }),
    { type: PANEL_MESSAGE.callTool, id: 'call-1', name: 'pinax_material_list', args: { query: '雨' } }
  )
  assert.deepEqual(
    parsePanelRequest({ type: PANEL_MESSAGE.callTool, id: 'call-1', name: 'pinax_material_list' }).args,
    {},
    '没有 arguments 也能调：参数默认空对象'
  )
  assert.deepEqual(
    parsePanelRequest({ type: PANEL_MESSAGE.callTool, id: 'call-1', name: 'pinax_material_list', arguments: [1, 2] }).args,
    {},
    'arguments 不是对象就按空处理，不把数组当参数表'
  )

  assert.equal(parsePanelRequest(null), null)
  assert.equal(parsePanelRequest('ready'), null)
  assert.equal(parsePanelRequest({ type: 'pinax.panel.unknown' }), null, '不认识的动作不往下走')
  assert.equal(parsePanelRequest({ type: PANEL_MESSAGE.callTool, name: 'pinax_material_list' }), null, '没有 id 的调用不认')
  assert.equal(parsePanelRequest({ type: PANEL_MESSAGE.callTool, id: 'x', name: 'Material_List' }), null, '工具名不合词表不认')
  assert.equal(parsePanelRequest({ type: PANEL_MESSAGE.callTool, id: 'x', name: 'a' }), null, '太短的工具名不认')

  const success = panelResult('call-1', { ok: true, value: { payload: { total: 3 } } })
  assert.deepEqual(success, { type: PANEL_MESSAGE.toolResult, id: 'call-1', ok: true, payload: { total: 3 }, error: null })
  const failure = panelResult('call-1', { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '不给你' } })
  assert.equal(failure.ok, false)
  assert.equal(failure.payload, null)
  assert.equal(failure.error.code, 'PINAX_INVALID_INPUT')
  assert.deepEqual(panelError('形状不对', 'call-1'), { type: PANEL_MESSAGE.error, id: 'call-1', message: '形状不对' })
})

test('视图注册：custom 视图解析出的内容面是 custom-panel，不是占位', () => {
  const pane = {
    id: 'material.panel',
    view: CUSTOM_VIEW_TYPE,
    kind: 'custom-panel',
    entry: { kind: 'iframe', path: 'ui/index.html' }
  }
  const bound = resolvePaneView(pane, {})
  assert.equal(bound.type, CUSTOM_VIEW_TYPE)
  assert.equal(bound.result?.kind, 'custom-panel', '这块 pane 的内容面就是插件自己的页面')
  assert.deepEqual(bound.result?.entry, { kind: 'iframe', path: 'ui/index.html' }, '入口随 pane 一起出来，宿主据此拼协议 URL')
})

test('载体资产：面板页与 AGENT.md 真在插件目录里，面板页不许有行内脚本', async () => {
  const plugin = materialPlugin()
  const dir = plugin.meta.dir
  assert.ok(dir, '清单插件必须带自己的目录，宿主才知道面板页在哪')
  assert.equal((await stat(join(dir, 'ui', 'index.html'))).isFile(), true)
  assert.equal((await stat(join(dir, 'ui', 'panel.js'))).isFile(), true)
  assert.equal((await stat(join(dir, 'AGENT.md'))).isFile(), true)

  const page = await readFile(join(dir, 'ui', 'index.html'), 'utf-8')
  assert.match(page, /<script src="\.\/panel\.js"><\/script>/, '脚本走外部文件')
  assert.doesNotMatch(page, /<script>(?!\s*src=)/u, '面板页的 CSP 是 script-src \'self\'，行内脚本会被浏览器当场拒')

  // 注册表把目录登记下来：宿主解析面板 URL 时按插件 id 找目录，靠的就是这张表。
  const registry = installAll()
  assert.equal(registry.dirOf(MATERIAL_CARRIER_ID), dir)
  assert.equal(registry.dirOf('不存在的插件'), null)
})

test('AGENT.md 面：作者须知真的被读到并进上下文块；读不到只记一条账', async () => {
  const { workspace, registry, view } = await materialProject('panel-agentmd')
  try {
    const collected = await collectAgentMdBlocks({ registry, view })
    const blocks = collected.blocks.filter((block) => block.sourceRefs?.some((ref) => ref.startsWith(`agentmd:${MATERIAL_CARRIER_ID}/`)))
    assert.equal(blocks.length, 1, '素材这一栏的 AGENT.md 进来了')
    assert.equal(blocks[0].kind, 'agent-md')
    assert.equal(blocks[0].priority, 1100, '须知排在内容块前面（它是「怎么读这块内容」）')
    assert.match(blocks[0].content, /素材/, '须知的内容就是那份文件的内容')
    assert.deepEqual(collected.warnings, [], '这一栏不该有记账')

    // 宿主没登记目录 → 只记一条账，不把整条信封拖垮。
    const bare = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    assert.equal(bare.install(MATERIAL_CARRIER, {}, {}).ok, true)
    const missing = await collectAgentMdBlocks({
      registry: bare,
      view: { enabled: [MATERIAL_CARRIER_ID], primary: MATERIAL_CARRIER_ID }
    })
    assert.equal(missing.blocks.length, 0)
    assert.equal(missing.warnings.length, 1)
    assert.match(missing.warnings[0], /没进上下文/u)
  } finally {
    await workspace.cleanup()
  }
})

test('主进程闸：面板只调得动只读工具、只调得动本板工具与内核只读工具', async () => {
  const { workspace, runtime } = await materialProject('panel-gates', { extras: [COMIC_CARRIER_ID] })
  try {
    const { dispatch } = createIpcDispatcher({ session: { runtime } })

    // ① 本板只读工具：放行。
    const listed = await dispatch(IPC_CHANNELS.pluginToolCall, {
      pluginId: MATERIAL_CARRIER_ID,
      name: 'pinax_material_list',
      args: {}
    })
    assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 0)
    assert.deepEqual(listed.value.payload.records, [])

    // ② 本板写盘工具：拒。面板没有写盘的口子。
    const wrote = await dispatch(IPC_CHANNELS.pluginToolCall, {
      pluginId: MATERIAL_CARRIER_ID,
      name: 'pinax_material_save',
      args: { title: 'x', expectedRevision: 0 }
    })
    assert.equal(wrote.ok, false)
    assert.match(wrote.error.message, /会写盘，面板不得调用/u)

    // ③ 别板的工具：拒（归属不是本板，也不是内核）。
    const foreign = await dispatch(IPC_CHANNELS.pluginToolCall, {
      pluginId: MATERIAL_CARRIER_ID,
      name: 'pinax_comic_list',
      args: {}
    })
    assert.equal(foreign.ok, false)
    assert.match(foreign.error.message, /不能调/u)

    // ④ 工具面里没有的名字：拒。
    const unknown = await dispatch(IPC_CHANNELS.pluginToolCall, {
      pluginId: MATERIAL_CARRIER_ID,
      name: 'pinax_material_nope',
      args: {}
    })
    assert.equal(unknown.ok, false)
    assert.match(unknown.error.message, /工具面里没有/u)

    // ⑤ 没给工具名：拒。
    const nameless = await dispatch(IPC_CHANNELS.pluginToolCall, { pluginId: MATERIAL_CARRIER_ID })
    assert.equal(nameless.ok, false)

    // ⑥ 内核只读工具：放行（面板看得见项目基本盘，这不算越权）。
    const project = await dispatch(IPC_CHANNELS.pluginToolCall, {
      pluginId: MATERIAL_CARRIER_ID,
      name: 'pinax_project_list',
      args: {}
    })
    assert.equal(project.ok, true, JSON.stringify(project.error ?? {}))
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
