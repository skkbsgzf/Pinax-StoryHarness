import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileDossierToolsModule } from '@pinax/core/usecases/fileDossierTools'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../fs/projectPath.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { DOSSIER_CARRIER, DOSSIER_CARRIER_ID } from '../carriers/dossier/manifest.mjs'
import { DOSSIER_TOOL_NAMES, createDossierTools } from '../carriers/dossier/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T21 的单一真源对照：设定与资料载体的六把工具来自 `@pinax/core/usecases/fileDossierTools`。
 * 本文件钉三件事：工具面与 core 同一份；两扇目录的列表语义（文件名序、20000 字截断、.md／.txt）
 * 仍在；宿主注入的端口（projectPath 归一比较、knowledgeService 单例／显式注入）按原口径生效。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_DOSSIER = createFileDossierToolsModule({
  fail,
  ok,
  isSameProjectRoot,
  normalizeProjectRoot,
  getSharedKnowledgeService: () => null,
  DOSSIER_CARRIER,
  DOSSIER_CARRIER_ID
})

async function dossierProject(label, { rules = {}, documents = {} } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '设定资料核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '设定资料核心靶子', primaryCarrier: DOSSIER_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const rulesDir = join(root, '约束')
  await mkdir(rulesDir, { recursive: true })
  for (const [name, text] of Object.entries(rules)) await writeFile(join(rulesDir, name), text, 'utf-8')
  const docsDir = join(root, '资料')
  await mkdir(docsDir, { recursive: true })
  for (const [name, text] of Object.entries(documents)) await writeFile(join(docsDir, name), text, 'utf-8')
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  return { workspace, root, opened }
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

test('设定与资料工具面由 core 的 fileDossierTools 生成：六把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/dossier/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileDossierTools'/u)
  assert.doesNotMatch(source, /function (?:listRules|listDocuments|resolveDocument)|RULE_LIST_TEXT_CHARS/u, '列表／定位实现已整份搬进 core，宿主不再留第二份')

  const tools = createDossierTools({ pluginId: DOSSIER_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), [...DOSSIER_TOOL_NAMES], '六把工具名不变')
  const reference = CORE_DOSSIER.createDossierTools({ pluginId: DOSSIER_CARRIER_ID })
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')
})

test('两扇目录的列表语义不变：文件名序、前 20000 字截断、资料只认 .md／.txt', async () => {
  const long = '雪'.repeat(20_050)
  const { workspace, root, opened } = await dossierProject('dossier-core-list', {
    rules: { '纪律.md': '- 不许出现现代词\n', '文风.md': '短句为主。\n' },
    documents: { '设定集.md': '旧世界年表。\n', '访谈.txt': '受访者：柯秒。\n', '长资料.md': long, '封面.png': 'not-really-a-png' }
  })
  try {
    const tools = createDossierTools({ pluginId: DOSSIER_CARRIER_ID, fileService: opened.value.fileService, root })
    const call = (name, args = {}) => tools.find((tool) => tool.name === name).run(args)

    const rules = await call('pinax_rule_list')
    assert.equal(rules.ok, true, JSON.stringify(rules))
    assert.deepEqual(rules.value.rules.map((item) => item.title), ['纪律', '文风'], '文件名序（core 的 zh-Hans collator 仍在）')

    const documents = await call('pinax_document_list')
    assert.equal(documents.ok, true, JSON.stringify(documents))
    assert.equal(documents.value.total, 3, '.png 不进资料清单')
    const longDoc = documents.value.documents.find((item) => item.title === '长资料')
    assert.equal(longDoc.truncated, true)
    assert.equal(longDoc.text.length, 20_000)
    assert.equal(longDoc.totalChars, long.length)

    const read = await call('pinax_document_read', { title: '访谈' })
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.equal(read.value.text, '受访者：柯秒。\n')

    const nonText = await call('pinax_document_save', { file: '资料/设定集.pdf', text: 'x', expectedRevision: 0 })
    assert.equal(nonText.ok, false)
    assert.equal(nonText.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(nonText.error.message, /\.md 或 \.txt/)
  } finally {
    await workspace.cleanup()
  }
})

test('宿主端口：projectPath 仍只认当前项目；knowledgeService 显式注入优先且 dir 恒限定 资料', async () => {
  const { workspace, root, opened } = await dossierProject('dossier-core-ports', {
    documents: { '设定集.md': '雪埋了半条街。\n' }
  })
  try {
    const calls = []
    const knowledgeService = {
      async search(args) {
        calls.push(args)
        return { ok: true, value: { total: 1, hits: [{ readRef: '资料/设定集.md' }] } }
      }
    }
    const tools = createDossierTools({
      pluginId: DOSSIER_CARRIER_ID,
      fileService: opened.value.fileService,
      root,
      knowledgeService
    })
    const call = (name, args = {}) => tools.find((tool) => tool.name === name).run(args)

    const own = await call('pinax_rule_list', { projectPath: root })
    assert.equal(own.ok, true, JSON.stringify(own))
    const foreign = await call('pinax_rule_list', { projectPath: join(root, '..', '别的项目') })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(foreign.error.message, /只服务当前打开的 Next 项目/)

    const found = await call('pinax_reference_search', { q: ' 雪 ', k: 2 })
    assert.equal(found.ok, true, JSON.stringify(found.error ?? {}))
    assert.deepEqual(calls, [{ root, verb: 'kb_search', q: '雪', k: 2, dir: '资料' }], '知识服务经宿主端口注入，verb 与 dir 仍由 core 固定')

    const badDir = await call('pinax_reference_search', { q: '雪', dir: '世界书' })
    assert.equal(badDir.ok, false)
    assert.equal(badDir.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(badDir.error.message, /只覆盖「资料\/」/)
  } finally {
    await workspace.cleanup()
  }
})

test('知识服务缺席时如实报缺，不冒充空结果', async () => {
  const tool = createDossierTools({ pluginId: DOSSIER_CARRIER_ID, root: 'D:/某个项目' })
    .find((item) => item.name === 'pinax_reference_search')
  const missing = await tool.run({ q: '雪' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.match(missing.error.message, /知识服务未接入/)
})
