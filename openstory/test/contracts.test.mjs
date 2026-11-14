/**
 * OpenStory OS-1/2 纯函数与端点用例（node:test，零依赖）。
 *
 * 跑法：
 *   node --test openstory/test/contracts.test.mjs
 *   PINAX_OS_FIXTURE=D:/Pinax-e2e/s4-shots/夹具库 node --test openstory/test/contracts.test.mjs
 *   （设置 PINAX_OS_FIXTURE 时额外验真实夹具库 291 条；不设就跳过，不写死绝对路径）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  API_ERROR_CODES,
  ENDPOINTS,
  endpointFor,
  normalizeLibraries,
  normalizeLibraryRecord,
  validateRequest,
  validateResponse
} from '../contracts.mjs'
import {
  createRootAllowlist,
  defaultPreferencesPath,
  historyBackupPath,
  loadLibraries,
  mapWriteErrorCode,
  parseArgs,
  resolveInsideRoot,
  startDaemon
} from '../daemon.mjs'

const FACT_ENTRIES = [
  {
    schema: 'fact.data/v3',
    id: 'e1',
    layer: 'plot',
    name: '第一段',
    status: 'draft',
    notes: '开场',
    sources: [{ sourceId: '正文/ch1.md' }]
  },
  {
    schema: 'fact.data/v3',
    id: 'e2',
    layer: 'character',
    name: '林砚',
    status: 'draft',
    definition: '雾港的摆渡人。',
    aliases: ['小砚']
  }
]

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '拆解'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '.pinax'), { recursive: true })
  const fact = {
    book: { id: 'book-1', title: '夹具书' },
    source: { file: 'ch1.md', chars: 8 },
    entries: FACT_ENTRIES,
    revision: 1
  }
  await writeFile(join(root, '拆解', 'book-1.json'), JSON.stringify(fact), 'utf-8')
  // 坏档与旁路档：坏档记 warning、整份跳过；没有 entries 的旁路档静默跳过。
  await writeFile(join(root, '拆解', '坏档.json'), '{ not json', 'utf-8')
  await writeFile(join(root, '拆解', '旁路.json'), JSON.stringify({ note: '聚合产物' }), 'utf-8')
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-14T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

test('契约：端点都带 method/path/request/response/errors，路径可反查', () => {
  assert.equal(Object.keys(ENDPOINTS).length, 18)
  for (const [id, endpoint] of Object.entries(ENDPOINTS)) {
    assert.ok(endpoint.method, `${id} 缺 method`)
    assert.ok(endpoint.path.startsWith('/api/'), `${id} 路径不是 /api/`)
    assert.ok(endpoint.request, `${id} 缺 request`)
    assert.ok(endpoint.response, `${id} 缺 response`)
    assert.ok(Array.isArray(endpoint.errors), `${id} 缺 errors`)
  }
  assert.equal(endpointFor('GET', '/api/libraries/'), 'libraries')
  assert.equal(endpointFor('PUT', '/api/chapter'), 'chapterPut')
  assert.equal(endpointFor('POST', '/api/agent/chat'), 'agentChat')
  assert.equal(endpointFor('GET', '/api/agent/sessions'), 'agentSessions')
  assert.equal(endpointFor('DELETE', '/api/agent/session'), 'agentSessionDelete')
  assert.equal(endpointFor('POST', '/api/nope'), null)
})

test('契约：错误码词表齐全且冻结（含 WRITE_PROTOCOL_*）', () => {
  for (const code of ['NO_LIBRARY', 'PATH_ESCAPE', 'NOT_FOUND', 'INVALID_ENTRY', 'REVISION_MISMATCH']) {
    assert.equal(API_ERROR_CODES[code], code)
  }
  assert.ok(Object.keys(API_ERROR_CODES).filter((code) => code.startsWith('WRITE_PROTOCOL_')).length >= 4)
  assert.ok(Object.isFrozen(API_ERROR_CODES))
})

test('契约校验：entries 缺 root 被拒', () => {
  const result = validateRequest('entries', { layer: 'plot' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.field === 'root'))
})

test('契约校验：query 里的 offset/limit 从字符串规整为整数', () => {
  const result = validateRequest('entries', { root: '/tmp/x', offset: '10', limit: '25', layer: '' })
  assert.equal(result.ok, true)
  assert.equal(result.value.offset, 10)
  assert.equal(result.value.limit, 25)
  const bad = validateRequest('entries', { root: '/tmp/x', offset: 'abc' })
  assert.equal(bad.ok, false)
})

test('契约校验：entry 缺 id 被拒', () => {
  const result = validateRequest('entry', { root: '/tmp/x' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.field === 'id'))
})

test('契约校验：chapterPut 的 text 必须是字符串', () => {
  const result = validateRequest('chapterPut', { root: '/tmp/x', file: '正文/a.md', text: 42 })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.field === 'text'))
})

test('契约校验：agentChat 必须带 root＋content，sessionId/model 可选', () => {
  assert.equal(validateRequest('agentChat', { content: '你好' }).ok, false)
  assert.equal(validateRequest('agentChat', { root: '/tmp/x' }).ok, false)
  const ok = validateRequest('agentChat', { root: '/tmp/x', content: '你好' })
  assert.equal(ok.ok, true)
  assert.equal(validateRequest('agentChat', { root: '/tmp/x', sessionId: 's-1', content: '你好', model: 'm1' }).ok, true)
  // OS-4 起 key 不再走请求：endpoint/apiKey 字段退役
  assert.equal(validateRequest('agentChat', { root: '/tmp/x', content: '你好', apiKey: 'sk-x' }).ok, true) // 多余字段不拦（形状校验只查契约列出的字段）
})

test('契约校验：libraries 响应形状通过；缺 libraries 被拒', () => {
  assert.equal(validateResponse('libraries', { ok: true, libraries: [], warnings: [] }).ok, true)
  assert.equal(validateResponse('libraries', { ok: true, warnings: [] }).ok, false)
})

test('库记录规整：缺 name/kind/count 时补默认值', () => {
  const record = normalizeLibraryRecord({ path: 'D:\\写作\\长夜' })
  assert.deepEqual(record, { path: 'D:\\写作\\长夜', name: '长夜', kind: '未分类', count: 0, at: '' })
  assert.equal(normalizeLibraryRecord({ name: '没有路径' }), null)
})

test('库清单规整：坏条跳过、重复路径去重并记 warning', () => {
  const { libraries, warnings } = normalizeLibraries([
    { path: 'D:\\写作\\长夜', name: '长夜' },
    { name: '没有路径' },
    { path: 'd:/写作/长夜' , name: '重复' }
  ])
  assert.equal(libraries.length, 1)
  assert.equal(libraries[0].name, '长夜')
  assert.ok(warnings.some((warning) => warning.code === 'LIBRARY_ENTRY_SKIPPED'))
  assert.ok(warnings.some((warning) => warning.code === 'LIBRARY_ENTRY_DUPLICATE'))
})

test('库清单读取：文件不存在按空清单＋warning，不抛错', () => {
  const result = loadLibraries({ preferencesPath: join(tmpdir(), 'definitely-missing-openstory.json') })
  assert.deepEqual(result.libraries, [])
  assert.equal(result.warnings[0].code, 'PREFERENCES_MISSING')
})

test('库清单读取：坏 JSON 按空清单＋warning', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-prefs-'))
  try {
    const preferencesPath = join(base, 'next-preferences.json')
    await writeFile(preferencesPath, '{ broken', 'utf-8')
    const result = loadLibraries({ preferencesPath })
    assert.deepEqual(result.libraries, [])
    assert.equal(result.warnings[0].code, 'PREFERENCES_CORRUPT')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('库清单读取：真实形状（只有 path/name/at）也能上屏', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  try {
    const result = loadLibraries({ preferencesPath })
    assert.equal(result.libraries.length, 1)
    assert.equal(result.libraries[0].name, '夹具库')
    assert.equal(result.libraries[0].kind, '未分类')
    assert.equal(result.libraries[0].path, root)
    assert.ok(base)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('路径安全：库内相对路径放行，正文目录可读', async () => {
  const { base, root } = await makeFixture()
  try {
    const result = resolveInsideRoot(root, '正文/ch1.md')
    assert.equal(result.ok, true)
    assert.ok(result.path.endsWith('ch1.md'))
    assert.equal((await readFile(result.path, 'utf-8')), '第一章正文。')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('路径安全：../ 逃逸、绝对路径、.pinax 全部拒收', () => {
  const root = 'D:\\Projects\\大梦'
  assert.equal(resolveInsideRoot(root, '../secret.txt').code, API_ERROR_CODES.PATH_ESCAPE)
  assert.equal(resolveInsideRoot(root, '正文/../../secret.txt').code, API_ERROR_CODES.PATH_ESCAPE)
  assert.equal(resolveInsideRoot(root, 'C:\\Windows\\win.ini').code, API_ERROR_CODES.PATH_ESCAPE)
  assert.equal(resolveInsideRoot(root, '/etc/passwd').code, API_ERROR_CODES.PATH_ESCAPE)
  assert.equal(resolveInsideRoot(root, '.pinax/state/x.json').code, API_ERROR_CODES.PATH_ESCAPE)
  assert.equal(resolveInsideRoot(root, '正文\\ch1.md').ok, true)
})

test('备份路径：写在同目录 .history/<file>.bak-<时间戳>', () => {
  const backup = historyBackupPath('D:\\Projects\\大梦', '正文/001-第001章.md', new Date('2026-11-14T12:34:56.000Z'))
  assert.equal(backup.ok, true)
  assert.match(backup.path.replaceAll('\\', '/'), /正文\/\.history\/001-第001章\.md\.bak-2026-11-14T12-34-56-000Z$/u)
})

test('root 白名单：库清单与 --root 显式授权都认，未登记 root 拒收', async () => {
  const { base, root } = await makeFixture()
  try {
    const allowlist = createRootAllowlist([{ path: root }], ['D:\\Pinax-e2e\\s4-shots\\夹具库'])
    assert.equal(allowlist.isAllowed(root), true)
    assert.equal(allowlist.isAllowed('D:\\Pinax-e2e\\s4-shots\\夹具库'), true)
    assert.equal(allowlist.isAllowed('D:\\不存在\\的库'), false)
    assert.ok(base)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('写协议错误码：S2 端口码透传成 WRITE_PROTOCOL_*', () => {
  assert.equal(mapWriteErrorCode('OPERATION_ID_REQUIRED'), 'WRITE_PROTOCOL_OPERATION_ID_REQUIRED')
  assert.equal(mapWriteErrorCode('PINAX_INVALID_INPUT'), 'WRITE_PROTOCOL_INVALID_INPUT')
  assert.equal(mapWriteErrorCode('REVISION_MISMATCH'), 'REVISION_MISMATCH')
  assert.equal(mapWriteErrorCode('NOT_FOUND'), 'WRITE_PROTOCOL_NOT_FOUND')
  assert.equal(mapWriteErrorCode('SOMETHING_ELSE'), 'WRITE_PROTOCOL_IO_FAILED')
})

test('CLI：端口/root 解析与非法端口回落', () => {
  assert.deepEqual(parseArgs(['--port=9000', '--root=D:\\写作\\长夜']), {
    port: 9000, root: 'D:\\写作\\长夜', preferencesPath: '', help: false
  })
  assert.equal(parseArgs(['--port=abc']).port, 8807)
  assert.equal(parseArgs(['--port', '9100']).port, 9100)
  assert.equal(parseArgs(['--help']).help, true)
})

test('默认库清单路径：跟随 LOCALAPPDATA，找不到给空串', () => {
  assert.equal(
    defaultPreferencesPath({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }).replaceAll('\\', '/'),
    'C:/Users/x/AppData/Local/PinaxNext/next-preferences.json'
  )
  assert.equal(defaultPreferencesPath({}), '')
})

test('daemon 端点：库清单/条目/单条/正文读写/路径拒收/root 白名单', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const libraries = await (await fetch(`${origin}/api/libraries`)).json()
    assert.equal(libraries.ok, true)
    assert.equal(libraries.libraries.length, 1)
    assert.equal(libraries.libraries[0].path, root)

    const entries = await (await fetch(`${origin}/api/entries?root=${encodeURIComponent(root)}&limit=500`)).json()
    assert.equal(entries.ok, true)
    assert.equal(entries.total, 2)
    assert.equal(entries.entries.length, 2)
    assert.ok(entries.warnings.some((warning) => warning.code === 'FACT_FILE_UNREADABLE'))

    const entry = await (await fetch(`${origin}/api/entry?root=${encodeURIComponent(root)}&id=e1`)).json()
    assert.equal(entry.ok, true)
    assert.equal(entry.entry.name, '第一段')
    assert.equal(entry.revision, 1)

    const chapter = await (await fetch(`${origin}/api/chapter?root=${encodeURIComponent(root)}&file=${encodeURIComponent('正文/ch1.md')}`)).json()
    assert.equal(chapter.ok, true)
    assert.equal(chapter.text, '第一章正文。')
    assert.equal(chapter.name, 'ch1.md')

    const saved = await (await fetch(`${origin}/api/chapter`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, file: '正文/ch1.md', text: '改过的正文。' })
    })).json()
    assert.equal(saved.ok, true)
    assert.equal(saved.chars, 6)
    assert.ok(saved.backup.includes('.history/'))

    const reread = await (await fetch(`${origin}/api/chapter?root=${encodeURIComponent(root)}&file=${encodeURIComponent('正文/ch1.md')}`)).json()
    assert.equal(reread.text, '改过的正文。')
    const history = await readdir(join(root, '正文', '.history'))
    assert.equal(history.length, 1)
    assert.equal((await readFile(join(root, '正文', '.history', history[0]), 'utf-8')), '第一章正文。')

    const escape = await fetch(`${origin}/api/chapter?root=${encodeURIComponent(root)}&file=${encodeURIComponent('../secret.txt')}`)
    assert.equal(escape.status, 403)
    assert.equal((await escape.json()).error.code, 'PATH_ESCAPE')

    const unregistered = await fetch(`${origin}/api/entries?root=${encodeURIComponent(join(base, '别的库'))}`)
    assert.equal(unregistered.status, 403)
    assert.equal((await unregistered.json()).error.code, 'NO_LIBRARY')

    const wiki = await (await fetch(`${origin}/api/wiki?root=${encodeURIComponent(root)}&bookId=book-1`)).json()
    assert.equal(wiki.ok, true)
    assert.equal(wiki.wiki, null)

    const index = await fetch(`${origin}/`)
    assert.equal(index.status, 200)
    assert.match(index.headers.get('content-type'), /text\/html/u)
    assert.match(await index.text(), /OpenStory · 工作台/u)

    const appJs = await fetch(`${origin}/app.js`)
    assert.equal(appJs.status, 200)
    assert.match(appJs.headers.get('content-type'), /javascript/u)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('真实夹具库（PINAX_OS_FIXTURE）：/api/entries 返回 291 条', { skip: !process.env.PINAX_OS_FIXTURE }, async () => {
  const root = process.env.PINAX_OS_FIXTURE
  const daemon = await startDaemon({
    port: 0,
    root,
    preferencesPath: join(tmpdir(), 'openstory-no-prefs.json'),
    logger: { log() {} }
  })
  try {
    const response = await fetch(`http://127.0.0.1:${daemon.port}/api/entries?root=${encodeURIComponent(root)}&limit=500`)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.total, 291)
    assert.equal(payload.entries.length, 291)
  } finally {
    await daemon.close()
  }
})
