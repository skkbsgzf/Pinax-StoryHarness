import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { readProjectDocument } from '../project/projectManifest.mjs'
import { createMcpSurface } from '../runtime/mcpSurface.mjs'
import { connectInProcess } from '../runtime/transportInProcess.mjs'
import { FIXTURE_NOVEL } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

const LEGACY_SPEC = 'pinax-project@1'

async function openWithServerTool(root) {
  const link = await connectInProcess(createMcpSurface())
  try {
    return await link.callTool('pinax_project_open', { projectPath: root })
  } finally {
    await link.close()
  }
}

test('方向一：服务端轨（MCP 工具）读 Next 建的 pinax-project@2 —— 今天仍被拒，已记账', async () => {
  const workspace = await createTempWorkspace('interop')
  const root = join(workspace.projects, 'Next建的项目')
  try {
    const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    registry.install(FIXTURE_NOVEL)
    const created = await createProject({ root, name: 'Next建的项目', primaryCarrier: 'fixture.novel', registry })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))

    const result = await openWithServerTool(root)
    assert.equal(result.payload.ok, false, '服务端还没接受 @2，这条断言在 M2 修好服务端后会翻红提醒改口径')
    assert.equal(result.payload.code, 'ERR_SPEC_MISMATCH')
    assert.match(result.payload.message, /pinax-project@1/)
  } finally {
    await workspace.cleanup()
  }
})

test('方向二：Next 读服务端老合同建的 @1 项目 —— 兼容通过，但要求点一次主载体', async () => {
  const workspace = await createTempWorkspace('interop')
  const root = join(workspace.projects, '服务端建的项目')
  try {
    await mkdir(join(root, '.pinax'), { recursive: true })
    for (const dir of PROJECT_KINDS.novel) await mkdir(join(root, dir), { recursive: true })
    const stamp = '2026-10-20T00:00:00.000Z'
    await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify({
      schemaVersion: 1,
      spec: LEGACY_SPEC,
      projectId: 'proj_from_server',
      name: '服务端建的项目',
      kind: 'novel',
      createdAt: stamp,
      updatedAt: stamp
    }, null, 2), 'utf-8')

    const document = await readProjectDocument(root)
    assert.equal(document.ok, true, JSON.stringify(document.error ?? {}))
    assert.equal(document.value.kind, 'novel')
    assert.equal(document.value.legacySpec, LEGACY_SPEC)
    assert.equal(document.value.needsPrimary, true)

    const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    registry.install(FIXTURE_NOVEL)
    const activation = registry.activate(document.value.carriers)
    assert.equal(activation.ok, false, '老项目没有 carriers，Next 停在选主载体而不是替他猜')
    assert.equal(activation.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')

    const result = await openWithServerTool(root)
    assert.equal(result.payload.ok, true, '服务端读自己的 @1 项目本来就该通')
    assert.equal(result.payload.project?.kind, 'novel')
    assert.deepEqual(result.payload.counts, { chapters: 0, outlineNodes: 0, worldbookEntries: 0 })
  } finally {
    await workspace.cleanup()
  }
})
