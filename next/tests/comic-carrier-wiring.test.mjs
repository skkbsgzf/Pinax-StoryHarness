import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import {
  BUILT_IN_CARRIER_PLUGINS,
  COMIC_CARRIER,
  COMIC_CARRIER_ID,
  MATERIAL_CARRIER_ID
} from '../carriers/index.mjs'
import { createComicBlocks } from '../carriers/comic/context.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'
import { AGENT_CONTEXT_PROFILES } from '../../shared/agentContextProfiles.js'
import { getCanonicalAgentTask } from '../../shared/agentCapabilityContract.js'

/**
 * 批次48 · 任务③2／③3：漫画载体的四张牌在**真运行时**里的接线。
 *
 * 桥本身的协议往返在 comic-bridge.test.mjs 里（那是桥对 mock 的一侧）；
 * 这里证的是宿主这一侧：
 *   1) 聚合面：漫画启用时只读两把 comfy 工具以 comfy. 前缀进 ListTools，CallTool 按前缀路由到桥；
 *      comfy_submit 不在面上（批次58：提交通路纪律归底座，底座提交闸未建前不开第二个口）；
 *   2) services：监督器真起漫画预览服务，/health 探活，/ 渲染出含页名的 HTML，崩一次重启一次；
 *   3) 信封：漫画启用时 references 块真的来自漫画页清单（页名＋格数＋首句台词）。
 *
 * 端口一律用临时口：绝不假设 8188（本机可能真有 ComfyUI），也绝不跟别的用例抢。
 */
const MOCK = fileURLToPath(new URL('../testing/fixtures/comfyMock.mjs', import.meta.url))

function startMock() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [MOCK], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectPromise(new Error('mock ComfyUI 没在 10s 内报出端口'))
    }, 10_000)
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const match = buffer.match(/LISTENING:(\d+)/u)
      if (!match) return
      clearTimeout(timer)
      resolvePromise({ child, url: `http://127.0.0.1:${Number(match[1])}` })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
  })
}

function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer()
    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

function get(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolvePromise({ status: res.statusCode, body }))
    })
    req.on('error', rejectPromise)
  })
}

async function installAll() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  return registry
}

/** 漫画当伴生栏启用：素材是主载体（记录族的主载体），漫画跟着进面。 */
async function comicRuntime(label, { mockUrl = null } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '漫画靶子')
  const registry = await installAll()
  const created = await createProject({
    root, name: '漫画靶子', primaryCarrier: MATERIAL_CARRIER_ID, extraEnabled: [COMIC_CARRIER_ID], registry
  })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))

  const previewPort = await freePort()
  const view = {
    ...opened.value.view,
    // 预览服务：端口用临时口（清单里写死 8191，真起会跟作者本机的服务抢）。
    services: opened.value.view.services.map((service) => (
      service.id === 'comic-preview' ? { ...service, port: previewPort } : service
    )),
    // 外部 MCP：把桥的下游指到 mock（清单默认 127.0.0.1:8188，不许真连作者的 ComfyUI）。
    mcp: opened.value.view.mcp.map((spec) => (
      spec.id === 'comfy'
        ? { ...spec, env: { ...(spec.env ?? {}), ...(mockUrl ? { PINAX_COMFY_URL: mockUrl } : {}) } }
        : spec
    ))
  }
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view })
  const started = await runtime.start()
  assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
  return { workspace, root, registry, runtime, opened, previewPort }
}

async function waitFor(read, accept, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (accept(value)) return value
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
  }
  return read()
}

test('聚合面：漫画启用时只读两把 comfy 工具进面，comfy_submit 被 allow 挡在外面', async () => {
  const mock = await startMock()
  const { workspace, runtime } = await comicRuntime('comic-prefix', { mockUrl: mock.url })
  try {
    const names = runtime.listTools().map((tool) => tool.name)
    for (const suffix of ['comfy_status', 'comfy_result']) {
      assert.ok(names.includes(`comfy.${suffix}`), `面上要有 comfy.${suffix}，实际：${names.filter((n) => n.includes('comfy')).join(',')}`)
    }
    assert.equal(names.includes('comfy.comfy_submit'), false,
      `comfy_submit 不许回到工具面（提交通路纪律归底座）：${names.filter((n) => n.includes('comfy')).join(',')}`)
    assert.equal(runtime.ownerOf('comfy.comfy_status'), COMIC_CARRIER_ID, '外部工具的归属是声明它的插件')

    // 按前缀路由到桥：调用 comfy.comfy_status 应打到桥再打到 mock。
    const status = await runtime.callTool('comfy.comfy_status', {})
    assert.equal(status.value.ok, true, JSON.stringify(status.value))
    assert.equal(status.value.owner, COMIC_CARRIER_ID)
    assert.equal(status.value.payload.ok, true, JSON.stringify(status.value.payload))
    assert.equal(status.value.payload.stats.system.comfyui_version, 'mock-0.0.1', '这一刀必须真打到 mock，而不是回一句编的')

    // result 同样按前缀路由：回读拿图片元数据（提交只在桥内部保留，不走宿主工具面）。
    const result = await runtime.callTool('comfy.comfy_result', { prompt_id: 'mock-prompt-1' })
    assert.deepEqual(result.value.payload.images, [{ filename: 'mock.png', subfolder: '', type: 'output' }])
  } finally {
    await runtime.stop()
    await workspace.cleanup()
    mock.child.kill()
  }
})

test('清单守卫（批次58）：comfy allow 恰为只读两把，画布是 app 档 pane', () => {
  const comfy = COMIC_CARRIER.mcp.find((spec) => spec.id === 'comfy')
  assert.ok(comfy, '漫画清单要声明 comfy 桥')
  assert.deepEqual(comfy.allow, ['comfy_status', 'comfy_result'], '恢复提交的条件是底座提交闸落地，不是谁顺手把 allow 加回来')

  const panes = COMIC_CARRIER.contributes.panes
  const canvas = panes.find((pane) => pane.id === 'comic.canvas')
  assert.ok(canvas, '画布 pane 必须在清单里')
  assert.equal(canvas.view, 'pinax.view.app')
  assert.equal(canvas.kind, 'external-app')
  assert.equal(canvas.app?.url, 'http://127.0.0.1:3010')
  assert.deepEqual(canvas.forms, ['dock', 'split', 'fullscreen', 'immersive'])

  // 全仓工具面零命中：内置载体的 tools 与 mcp.allow 里都不许再出现 comfy_submit。
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const manifest = plugin.manifest
    assert.equal((manifest.tools ?? []).includes('comfy_submit'), false, `${manifest.id}：tools 里不许有 comfy_submit`)
    for (const spec of manifest.mcp ?? []) {
      assert.equal((spec.allow ?? []).includes('comfy_submit'), false, `${manifest.id}/${spec.id}：allow 里不许有 comfy_submit`)
    }
  }
})

test('services 牌：监督器起漫画预览服务 → /health 探活 → / 渲染含页名的 HTML；崩一次重启一次', async () => {
  const { workspace, root, runtime, previewPort } = await comicRuntime('comic-services')
  try {
    const service = runtime.serviceStatus().find((item) => item.id === 'comic-preview')
    assert.ok(service, '漫画预览服务应被监督器真起起来')
    assert.equal(service.status, 'ready', JSON.stringify(service.error ?? ''))
    assert.equal(service.port, previewPort)

    const health = await get(`http://127.0.0.1:${previewPort}/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(JSON.parse(health.body), { ok: true }, '健康口要回 {ok:true}')

    const saved = await runtime.callTool('pinax_comic_save', {
      title: '雨夜开场', type: 'comic-page', expectedRevision: 0,
      meta: { panels: [{ composition: '全景·雨巷', dialogue: '你终于来了。' }, { composition: '特写·眼睛' }] }
    })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))

    const page = await get(`http://127.0.0.1:${previewPort}/?root=${encodeURIComponent(root)}`)
    assert.equal(page.status, 200)
    assert.match(page.body, /雨夜开场/, '预览页里要出现漫画页名')
    assert.match(page.body, /你终于来了。/, '预览页里要出现台词')
    assert.match(page.body, /2 格/, '预览页里要出现格数')
    assert.doesNotMatch(page.body, /<script/i, '预览页不许有脚本')

    // 宿主把项目根摆进环境（PINAX_PROJECT_ROOT）：真机上不开查询串也读得到同一个项目。
    const viaEnv = await get(`http://127.0.0.1:${previewPort}/`)
    assert.equal(viaEnv.status, 200)
    assert.match(viaEnv.body, /雨夜开场/, '宿主给的项目根要够用：不带查询串也要渲染出漫画页')

    // 崩一次：杀掉子进程，监督器按 on-failure 拉起来，重启计数应是 1。
    const before = runtime.serviceStatus().find((item) => item.id === 'comic-preview')
    assert.ok(before.pid > 0, '要拿到子进程 pid 才能制造崩溃')
    process.kill(before.pid)
    const after = await waitFor(
      () => runtime.serviceStatus().find((item) => item.id === 'comic-preview'),
      (item) => item?.restarts >= 1 && item?.status === 'ready'
    )
    assert.equal(after.restarts, 1, `崩一次应只重启一次，实际 restarts=${after.restarts}`)
    assert.equal(after.status, 'ready', JSON.stringify(after.error ?? ''))

    // 重启之后服务照样能读真数据（不是只会起不会干活）。
    const again = await get(`http://127.0.0.1:${previewPort}/?root=${encodeURIComponent(root)}`)
    assert.match(again.body, /雨夜开场/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('信封块：漫画启用时 references 块来自漫画页清单（页名＋格数＋首句台词）', async () => {
  const { workspace, runtime, opened } = await comicRuntime('comic-context')
  try {
    const saved = await runtime.callTool('pinax_comic_save', {
      title: '巷口', type: 'comic-page', expectedRevision: 0,
      meta: { panels: [{ composition: '远景', dialogue: '雨停了。' }, { composition: '近景' }] }
    })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))

    const blocks = await createComicBlocks({ pluginId: COMIC_CARRIER_ID, fileService: opened.value.fileService }).references()
    assert.equal(blocks.blocks.length, 1, '漫画只交一种块')
    assert.equal(blocks.blocks[0].kind, 'references', '块种类必须是档案认识的复数 references')
    assert.match(blocks.blocks[0].content, /巷口/, '块里要出现页名')
    assert.match(blocks.blocks[0].content, /2 格/, '块里要出现格数')
    assert.match(blocks.blocks[0].content, /雨停了。/, '块里要出现首句台词')
    assert.equal(blocks.blocks[0].sourceRefs.length, 1)

    // 清单与实现同源：声明的 providers 只有 references，不谎报别的种类。
    assert.deepEqual(COMIC_CARRIER.context.providers, ['references'])
    assert.deepEqual(Object.keys(await createComicBlocks({ pluginId: COMIC_CARRIER_ID, fileService: opened.value.fileService })).sort(), ['references'])

    // 档案这一档必须真的认 references 块，否则信封组装只会给一条「已忽略」。
    const profile = COMIC_CARRIER.primary.contextProfile
    assert.ok(AGENT_CONTEXT_PROFILES[profile]?.blocks.includes('references'), `${profile} 的块表里要有 references`)
    const task = getCanonicalAgentTask('authoring.knowledge.query')
    assert.ok(task, '档案映射的只读任务要真在任务表里')
    assert.equal(task.contextProfile, profile, '任务的档案要与载体声明一致')
    assert.equal(task.effectPolicy, 'review-only', '只读任务不许有写副作用')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
