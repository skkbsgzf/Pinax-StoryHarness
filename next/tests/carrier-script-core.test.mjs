import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileScriptToolsModule } from '@pinax/core/usecases/fileScriptTools'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { SCRIPT_CARRIER_ID } from '../carriers/script/manifest.mjs'
import { SCRIPT_DIR, SCRIPT_TOOL_NAMES, createScriptTools } from '../carriers/script/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T21 的单一真源对照：剧本载体的记录文献语义来自 `@pinax/core/usecases/fileScriptTools`。
 * 本文件钉三件事：工具面与 core 同一份；篇目清单／20000 字截断／只认 .md／修订号闸这些
 * 载体语义在真文件链路上仍成立（它们随 core 原样搬走，宿主只注入端口）；文件服务缺席时如实报缺。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_SCRIPT = createFileScriptToolsModule({ fail, ok, SCRIPT_CARRIER_ID })

async function scriptProject(label, scripts = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '剧本核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '剧本核心靶子', primaryCarrier: SCRIPT_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const dir = join(root, SCRIPT_DIR)
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(scripts)) await writeFile(join(dir, name), text, 'utf-8')
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const tools = createScriptTools({ pluginId: SCRIPT_CARRIER_ID, fileService: opened.value.fileService })
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

test('剧本工具面由 core 的 fileScriptTools 生成：三把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/script/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileScriptTools'/u)
  assert.doesNotMatch(source, /SCRIPT_LIST_TEXT_CHARS|new Intl\.Collator/u, '清单截断与排序实现已整份搬进 core，宿主不再留第二份')

  assert.deepEqual(SCRIPT_DIR, CORE_SCRIPT.SCRIPT_DIR, '剧本目录取 core 同一份常量')
  assert.deepEqual(SCRIPT_TOOL_NAMES, CORE_SCRIPT.SCRIPT_TOOL_NAMES, '三把工具名取 core 同一份')
  const tools = createScriptTools({ pluginId: SCRIPT_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), ['pinax_script_list', 'pinax_script_read', 'pinax_script_save'])
  const reference = CORE_SCRIPT.createScriptTools({ pluginId: SCRIPT_CARRIER_ID })
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')
})

test('真文件链路：只列 .md、按数字序排列、前 20000 字随列表截断并标注', async () => {
  const long = '雪'.repeat(20_050)
  const { workspace, call } = await scriptProject('script-core-list', {
    '第2集-雪夜.md': '# 第2集\n\n柯秒：雪停了。\n',
    '第10集-长夜.md': long,
    '分镜.txt': '不是剧本正文',
    '封面.png': 'not-really-a-png'
  })
  try {
    const listed = await call('pinax_script_list')
    assert.equal(listed.ok, true, JSON.stringify(listed))
    assert.equal(listed.value.total, 2, '.txt／.png 不进清单（core 仍只认 .md）')
    assert.deepEqual(listed.value.scripts.map((item) => item.title), ['第2集-雪夜', '第10集-长夜'], '数字序：第2集在第10集之前')
    const longItem = listed.value.scripts[1]
    assert.equal(longItem.truncated, true, '单篇超 20000 字按上限截断并标注')
    assert.equal(longItem.text.length, 20_000)
    assert.equal(longItem.totalChars, long.length)
    assert.equal(longItem.file, `${SCRIPT_DIR}/第10集-长夜.md`)
    assert.equal(longItem.revision, 1, '未记账的既有文件按第 1 版采纳')
  } finally {
    await workspace.cleanup()
  }
})

test('真文件链路：read 的 maxChars 硬闸、save 的修订号闸与 .md 文件名清洗仍由 core 给', async () => {
  const long = '雪'.repeat(2500)
  const { workspace, call } = await scriptProject('script-core-save', { '第2集-雪夜.md': long })
  try {
    const listed = await call('pinax_script_list')
    const script = listed.value.scripts[0]

    const read = await call('pinax_script_read', { file: script.file, maxChars: 1000 })
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.equal(read.value.text.length, 1000, 'maxChars 是硬闸')
    assert.equal(read.value.truncated, true)

    const saved = await call('pinax_script_save', { file: script.file, text: `${long}\n柯秒推门。\n`, expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.value.revision, 2)

    const stale = await call('pinax_script_save', { file: script.file, text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.error.code, /^PINAX_/u, '回执只出宿主码')

    const nonMd = await call('pinax_script_save', { file: '剧本/第3集.pdf', text: 'x', expectedRevision: 0 })
    assert.equal(nonMd.ok, false)
    assert.equal(nonMd.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const sanitized = await call('pinax_script_save', { title: '第3集/雨夜*', text: '# 第3集\n', expectedRevision: 0 })
    assert.equal(sanitized.ok, true, JSON.stringify(sanitized))
    assert.equal(sanitized.value.file, '剧本/第3集 雨夜.md', '标题里的非法字符换空格，缺省扩展名 .md')
  } finally {
    await workspace.cleanup()
  }
})

test('文件服务缺席时如实报缺（core 通过注入的 fail 出 PINAX_*，宿主不留第二层翻译）', async () => {
  const tools = createScriptTools({ pluginId: SCRIPT_CARRIER_ID })
  const listed = await tools.find((tool) => tool.name === 'pinax_script_list').run({})
  assert.equal(listed.ok, false)
  assert.equal(listed.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.match(listed.error.message, /需要已打开项目的文件服务/)
})
