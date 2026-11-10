import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  createKnowledgeService,
  getSharedKnowledgeService,
  setSharedKnowledgeService,
  KNOWLEDGE_READ_VERBS
} from '../runtime/knowledgeService.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import { useBoardData } from '../shell/useBoardData.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * H2 知识服务 all-in-one：进程内 knowledgeService 的合同测试。
 * 全部用 mock runtime / mock knowledgeService，不启动 worker、不碰 Python、不起 HTTP：
 *   - search 只负责组 entry（projectId 从 <root>/.pinax/project.json 读，rootPath=root）并透传 verb/args；
 *   - exportProjectKnowledge 是 collectKnowledgeSources 的盘点形状（revision／files／bytes／byDir）；
 *   - KNOWLEDGE_* 上游码原样透传，不吞错、不改写；
 *   - IPC 两条通道只认 session.projectRoot，未注入服务时如实报缺。
 */

function projectDocument(projectId) {
  const now = new Date().toISOString()
  return {
    spec: 'pinax-project@2',
    schemaVersion: 2,
    projectId,
    name: 'H2 靶子',
    kind: 'novel',
    createdAt: now,
    updatedAt: now,
    carriers: { primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'], revision: 1 }
  }
}

async function projectRoot(workspace, label, projectId = 'proj_h2_fixture') {
  const root = await workspace.projectPath(label)
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(join(root, '.pinax', 'project.json'), JSON.stringify(projectDocument(projectId)), 'utf-8')
  return root
}

test('exportProjectKnowledge：collectKnowledgeSources 的 revision／files／bytes／byDir 盘点形状', async () => {
  const workspace = await createTempWorkspace('knowledge-status')
  try {
    const root = await projectRoot(workspace, '盘点靶子', 'proj_status')
    await mkdir(join(root, '资料'), { recursive: true })
    await mkdir(join(root, '世界书'), { recursive: true })
    await mkdir(join(root, '正文'), { recursive: true })
    await writeFile(join(root, '资料', '设定.md'), '雪埋了半条街。', 'utf-8')
    await writeFile(join(root, '世界书', '人物.md'), '柯秒。', 'utf-8')
    await writeFile(join(root, '正文', '001.md'), '正文不进 RAG 输入集', 'utf-8')

    // runtime 永远不该被盘点碰到：盘点只读盘。
    const service = createKnowledgeService({
      runtime: { run: async () => { throw new Error('exportProjectKnowledge 不该调用 runtime.run') } }
    })
    const status = await service.exportProjectKnowledge({ root })
    assert.equal(status.ok, true, JSON.stringify(status.error ?? {}))
    assert.match(status.value.revision, /^[a-f0-9]{64}$/)
    assert.equal(status.value.files, 2, '只收 资料/ 与 世界书/ 的文本；正文/ 不在 RAG 输入集')
    assert.equal(status.value.bytes, Buffer.byteLength('雪埋了半条街。', 'utf-8') + Buffer.byteLength('柯秒。', 'utf-8'))
    assert.deepEqual(status.value.byDir, { 资料: 1, 世界书: 1 })
    assert.deepEqual(status.value.coverage, { files: 2, bytes: status.value.bytes, byDir: { 资料: 1, 世界书: 1 } })
    assert.equal(JSON.stringify(status.value).includes('正文不进 RAG 输入集'), false, '盘点不把正文搬进结果')

    const missing = await service.exportProjectKnowledge({})
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'PINAX_INVALID_INPUT')
    assert.match(missing.error.message, /项目根/)
  } finally {
    await workspace.cleanup()
  }
})

test('search：projectId 从 project.json 读，entry＝{projectId,rootPath}，kb_search 透传 q/k/dir', async () => {
  const workspace = await createTempWorkspace('knowledge-search')
  try {
    const root = await projectRoot(workspace, '检索靶子', 'proj_search')
    const calls = []
    const service = createKnowledgeService({
      runtime: {
        run: async (verb, args, entry) => {
          calls.push({ verb, args, entry })
          return { total: 0, hits: [], coverage: { projectCards: 0 } }
        }
      }
    })

    const found = await service.search({ root, q: ' 雪 ', k: 3, dir: '资料' })
    assert.equal(found.ok, true, JSON.stringify(found.error ?? {}))
    assert.deepEqual(found.value, { total: 0, hits: [], coverage: { projectCards: 0 } })
    assert.deepEqual(calls, [{
      verb: 'kb_search',
      args: { project: 'proj_search', q: '雪', k: 3, dir: '资料' },
      entry: { projectId: 'proj_search', rootPath: resolve(root) }
    }])

    const read = await service.search({ root, verb: 'kb_read', ref: '资料/设定.md', maxChars: 1200 })
    assert.equal(read.ok, true, JSON.stringify(read.error ?? {}))
    assert.equal(calls[1].verb, 'kb_read')
    assert.deepEqual(calls[1].args, { project: 'proj_search', ref: '资料/设定.md', max_chars: 1200 })
    assert.deepEqual(calls[1].entry, { projectId: 'proj_search', rootPath: resolve(root) })

    const badVerb = await service.search({ root, verb: 'kb_write', q: '雪' })
    assert.equal(badVerb.ok, false)
    assert.equal(badVerb.error.code, 'KNOWLEDGE_VERB_INVALID')
    assert.deepEqual(KNOWLEDGE_READ_VERBS, ['kb_search', 'kb_read', 'worldbook_search'], '只放行只读动词')

    const noQuery = await service.search({ root })
    assert.equal(noQuery.ok, false)
    assert.equal(noQuery.error.code, 'PINAX_INVALID_INPUT')
    assert.match(noQuery.error.message, /检索词 q/)

    const noRef = await service.search({ root, verb: 'kb_read' })
    assert.equal(noRef.ok, false)
    assert.match(noRef.error.message, /需要 ref/)

    const traversal = await service.search({ root, verb: 'kb_read', ref: '../secret.md' })
    assert.equal(traversal.ok, false)
    assert.equal(traversal.error.code, 'KNOWLEDGE_REF_INVALID')
  } finally {
    await workspace.cleanup()
  }
})

test('search：KNOWLEDGE_* 上游码原样透传（MISSING／BUSY／TIMEOUT／CHANGED）', async () => {
  const workspace = await createTempWorkspace('knowledge-codes')
  try {
    const root = await projectRoot(workspace, '错误码靶子', 'proj_codes')
    for (const code of ['KNOWLEDGE_RUNTIME_MISSING', 'KNOWLEDGE_BUSY', 'KNOWLEDGE_TIMEOUT', 'KNOWLEDGE_CHANGED']) {
      const service = createKnowledgeService({
        runtime: { run: async () => { throw Object.assign(new Error(`${code} 的原话`), { code }) } }
      })
      const result = await service.search({ root, q: '雪' })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, code, `${code} 必须原样透传`)
      assert.equal(result.error.message, `${code} 的原话`)
    }

    const bare = createKnowledgeService({ runtime: { run: async () => { throw new Error('没有 code 的失败') } } })
    const fallback = await bare.search({ root, q: '雪' })
    assert.equal(fallback.ok, false)
    assert.equal(fallback.error.code, 'KNOWLEDGE_SEARCH_FAILED')
  } finally {
    await workspace.cleanup()
  }
})

test('search：project.json 缺失／projectId 形状非法都如实拒，不拿别的目录顶替', async () => {
  const workspace = await createTempWorkspace('knowledge-project')
  try {
    const runtime = { run: async () => ({ total: 0, hits: [] }) }
    const service = createKnowledgeService({ runtime })

    const noManifest = await service.search({ root: await workspace.projectPath('没有合同'), q: '雪' })
    assert.equal(noManifest.ok, false)
    assert.equal(noManifest.error.code, 'PINAX_INVALID_INPUT')
    assert.match(noManifest.error.message, /project\.json/)

    const badId = await projectRoot(workspace, '坏 id', '../逃出缓存根')
    const rejected = await service.search({ root: badId, q: '雪' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, 'KNOWLEDGE_PROJECT_INVALID')
    assert.match(rejected.error.message, /projectId/)
  } finally {
    await workspace.cleanup()
  }
})

test('IPC knowledge:search／index-status：只认 session.projectRoot，未注入服务如实报缺', async () => {
  const workspace = await createTempWorkspace('knowledge-ipc')
  try {
    const root = await projectRoot(workspace, 'IPC 靶子', 'proj_ipc')
    const calls = []
    const knowledgeService = {
      async search(args) {
        calls.push(['search', args])
        return { ok: true, value: { total: 0, hits: [], coverage: null } }
      },
      async exportProjectKnowledge(args) {
        calls.push(['status', args])
        return { ok: true, value: { revision: 'r1', files: 0, bytes: 0, byDir: {} } }
      }
    }
    const dispatcher = createIpcDispatcher({ session: { projectRoot: root }, knowledgeService })

    assert.equal(IPC_CHANNELS.knowledgeSearch, 'pinax:agent:knowledge:search')
    assert.equal(IPC_CHANNELS.knowledgeIndexStatus, 'pinax:agent:knowledge:index-status')

    const searched = await dispatcher.dispatch(IPC_CHANNELS.knowledgeSearch, { q: '雪', k: 2, root: 'D:/别的项目' })
    assert.equal(searched.ok, true)
    assert.deepEqual(calls[0], ['search', { q: '雪', k: 2, root }], '渲染层传的 root 不采信，只认当前项目根')

    const status = await dispatcher.dispatch(IPC_CHANNELS.knowledgeIndexStatus, { root: 'D:/别的项目' })
    assert.equal(status.ok, true)
    assert.deepEqual(calls[1], ['status', { root }], '盘点同样只认当前项目根')

    const withoutProject = createIpcDispatcher({ session: { projectRoot: null }, knowledgeService })
    const denied = await withoutProject.dispatch(IPC_CHANNELS.knowledgeSearch, { q: '雪' })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'PINAX_INVALID_INPUT')
    assert.match(denied.error.message, /先打开一个项目/)

    const withoutService = createIpcDispatcher({ session: { projectRoot: root } })
    const missing = await withoutService.dispatch(IPC_CHANNELS.knowledgeIndexStatus, {})
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'PINAX_INVALID_INPUT')
    assert.match(missing.error.message, /知识服务未接入/)
  } finally {
    await workspace.cleanup()
  }
})

test('useBoardData.searchKnowledge：走 knowledge:search 通道、默认 dir=资料、错误码落 knowledgeError', async () => {
  const calls = []
  const data = useBoardData({
    request: async (channel, payload) => {
      calls.push({ channel, payload })
      return {
        ok: true,
        value: {
          total: 1,
          hits: [{ id: 'kb/资料/设定集.md', readRef: '资料/设定集.md', excerpt: '雪埋了半条街。' }],
          coverage: { projectCards: 1 }
        }
      }
    }
  })
  const result = await data.searchKnowledge(' 雪 ')
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ channel: IPC_CHANNELS.knowledgeSearch, payload: { q: '雪', dir: '资料' } }])
  assert.equal(data.knowledgeSearching, false)
  assert.equal(data.knowledgeSearched, true)
  assert.equal(data.knowledgeResults.length, 1)
  assert.equal(data.knowledgeResults[0].readRef, '资料/设定集.md')
  assert.deepEqual(data.knowledgeCoverage, { projectCards: 1 })

  const failing = useBoardData({
    request: async () => ({ ok: false, error: { code: 'KNOWLEDGE_BUSY', message: '知识检索正在处理其他请求' } })
  })
  await failing.searchKnowledge('雪')
  assert.equal(failing.knowledgeSearching, false)
  assert.equal(failing.knowledgeError.code, 'KNOWLEDGE_BUSY')
  assert.equal(failing.knowledgeResults.length, 0)
  failing.clearKnowledgeSearch()
  assert.equal(failing.knowledgeSearched, false)
  assert.equal(failing.knowledgeError, null)

  const empty = await data.searchKnowledge('   ')
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, 'PINAX_INVALID_INPUT')
  assert.equal(calls.length, 1, '空检索词不请求通道')
})

test('单例挂载点：setSharedKnowledgeService／getSharedKnowledgeService 成对可用', () => {
  const fake = { search: async () => ({ ok: true, value: {} }) }
  setSharedKnowledgeService(fake)
  assert.equal(getSharedKnowledgeService(), fake)
  setSharedKnowledgeService(null)
  assert.equal(getSharedKnowledgeService(), null)
})
