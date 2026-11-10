import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createFileWorldbookToolsModule } from '@pinax/core/usecases/fileWorldbookTools'
import * as coreContract from '@pinax/core/domain/worldbookFileContract'
import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '../../shared/worldbookFileContract.js'
import { fail, ok } from '../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../fs/projectPath.mjs'
import { WORLDBOOK_CARRIER, WORLDBOOK_CARRIER_ID } from '../carriers/worldbook/manifest.mjs'
import { createWorldbookTools, WORLDBOOK_TOOL_NAMES } from '../carriers/worldbook/tools.mjs'

/**
 * T10 的单一真源对照：世界书载体的库／条目语义来自 `@pinax/core/usecases/fileWorldbookTools`，
 * 文件契约来自 `@pinax/core/domain/worldbookFileContract`（经 shared 单行再导出）。
 * 本文件钉三件事：工具面与 core 同源；契约解析／序列化只有 core 一份；依赖注入仍走宿主信封，
 * core 的裸错误码不外泄。作者可见的输出形状由 carrier-worldbook.test.mjs 全程守着。
 */
const CORE_MODULE = createFileWorldbookToolsModule({
  fail,
  ok,
  isSameProjectRoot,
  normalizeProjectRoot,
  WORLDBOOK_CARRIER,
  WORLDBOOK_CARRIER_ID
})

function stripRun(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  }
}

test('世界书工具面由 core 的 fileWorldbookTools 生成：三把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/worldbook/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileWorldbookTools'/u)
  assert.doesNotMatch(source, /parseWorldbookEntryFile|serializeWorldbookEntryFile/u, '载体不再自持 frontmatter 读写，契约只留 core 一份')

  const tools = createWorldbookTools({ pluginId: WORLDBOOK_CARRIER_ID })
  const reference = CORE_MODULE.createWorldbookTools({ pluginId: WORLDBOOK_CARRIER_ID })
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一依赖注入下列出的工具面必须与 core 产物逐字一致')
  assert.deepEqual(tools.map((tool) => tool.name), [...WORLDBOOK_TOOL_NAMES])
  assert.deepEqual(WORLDBOOK_TOOL_NAMES, CORE_MODULE.WORLDBOOK_TOOL_NAMES, '工具名清单取 core 那一份')
  assert.equal(Object.isFrozen(WORLDBOOK_TOOL_NAMES), true)
})

test('世界书文件契约与 core 是同一份导出：shared 只做再导出，不另起一套 YAML 子集', () => {
  assert.equal(parseWorldbookEntryFile, coreContract.parseWorldbookEntryFile)
  assert.equal(serializeWorldbookEntryFile, coreContract.serializeWorldbookEntryFile)

  const text = serializeWorldbookEntryFile({
    id: 'wb-core-1',
    name: '人物·柯秒',
    type: 'character',
    keys: ['柯秒'],
    tags: ['主角'],
    content: '冷穿越剧版的主角。'
  })
  const parsed = parseWorldbookEntryFile(text)
  assert.equal(parsed.ok, true, JSON.stringify(parsed.error ?? {}))
  assert.equal(parsed.entry.id, 'wb-core-1')
  assert.deepEqual(parsed.entry.keys, ['柯秒'])
  assert.equal(parsed.entry.content, '冷穿越剧版的主角。')
})

test('依赖注入走宿主信封：没有文件服务与跨项目路径都回 PINAX_*，不泄 core 裸码', async () => {
  const bare = createWorldbookTools({ pluginId: WORLDBOOK_CARRIER_ID })
  const missing = await bare.find((tool) => tool.name === 'pinax_worldbook_list').run({})
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'PINAX_INVALID_INPUT')
  assert.match(missing.error.message, /文件服务/u)

  const root = 'D:/Pinax-next'
  const tools = createWorldbookTools({ pluginId: WORLDBOOK_CARRIER_ID, fileService: { root }, root })
  const foreign = await tools.find((tool) => tool.name === 'pinax_worldbook_list').run({ projectPath: 'E:/别的小说/别的书' })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.error.code, 'PINAX_INVALID_INPUT')
  assert.match(foreign.error.message, /只服务当前打开的 Next 项目/u)

  const read = await tools.find((tool) => tool.name === 'pinax_worldbook_read').run({})
  assert.equal(read.ok, false)
  assert.equal(read.error.code, 'PINAX_INVALID_INPUT')
  assert.match(read.error.message, /要给 path \/ id \/ name/u)
})
