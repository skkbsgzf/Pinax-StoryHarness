/**
 * OpenStory OS-4 Agent 通道用例（node:test，零依赖）。
 *
 * 跑法：
 *   node --test openstory/test/agent.test.mjs
 *
 * 端到端用的上游是本机夹具 http 服务（发标准 SSE），不碰任何真实模型端点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API_ERROR_CODES, validateRequest, validateResponse } from '../contracts.mjs'
import {
  buildUpstreamMessages,
  configPublic,
  createSseDeltaParser,
  createSession,
  defaultAgentConfigPath,
  deleteSession,
  fileSnapshot,
  isValidSessionId,
  listSessions,
  loadAgentConfig,
  maskApiKey,
  newCardId,
  readSession,
  renameSession,
  saveAgentConfig,
  sessionDirFor,
  snapshotsMatch,
  updateCard,
  appendSession
} from '../agentStore.mjs'
import { startDaemon } from '../daemon.mjs'

const FACT_ENTRIES = [
  { schema: 'fact.data/v3', id: 'e1', layer: 'plot', name: '第一段', status: 'draft', sources: [{ sourceId: '正文/ch1.md' }] }
]

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os4-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  await mkdir(join(root, '拆解'), { recursive: true })
  await writeFile(join(root, '拆解', 'book-1.json'), JSON.stringify({
    book: { id: 'book-1', title: '夹具书' },
    entries: FACT_ENTRIES,
    revision: 1
  }), 'utf-8')
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-14T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath, configPath: join(base, 'agent-config.json'), sessionsDir: join(base, 'sessions') }
}

/** 夹具上游：标准 SSE，回声最后一条用户消息；记录收到的 authorization 供凭据断言。 */
async function startFakeUpstream() {
  const server = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      server.lastAuth = req.headers.authorization || ''
      let parsed = {}
      try { parsed = JSON.parse(body || '{}') } catch { parsed = {} }
      server.lastBody = parsed
      const history = Array.isArray(parsed.messages) ? parsed.messages : []
      const system = history.find((message) => message.role === 'system')
      const lastUser = [...history].reverse().find((message) => message.role === 'user')
      const reply = `收到：${(lastUser?.content || '').slice(0, 60)}（夹具上游${system ? '·带system' : ''}）`
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      const pieces = [reply.slice(0, 4), reply.slice(4, 14), reply.slice(14)].filter(Boolean)
      let index = 0
      const timer = setInterval(() => {
        if (index < pieces.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[index] } }] })}\n\n`)
          index += 1
          return
        }
        clearInterval(timer)
        res.write('data: [DONE]\n\n')
        res.end()
      }, 5)
    })
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  return { server, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` }
}

async function readChatStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    raw += decoder.decode(value, { stream: true })
  }
  const frames = raw.split('\n\n').filter((block) => block.trim()).map((block) => {
    const line = block.split('\n').find((row) => row.startsWith('data:'))
    return line ? JSON.parse(line.slice(5).trim()) : null
  }).filter(Boolean)
  return { raw, frames }
}

/* ---------- 配置 ---------- */

test('掩码：只露尾号，任何长度都不回显完整 key', () => {
  assert.equal(maskApiKey(''), '')
  assert.equal(maskApiKey('  '), '')
  assert.equal(maskApiKey('sk-123'), '••••')
  const masked = maskApiKey('sk-abcdef1234567890')
  assert.equal(masked, '••••7890')
  assert.ok(!masked.includes('abcdef'))
})

test('配置：缺档＝未配置；保存往返；apiKey 缺省保留、空串清除', async () => {
  const { base, configPath } = await makeFixture()
  try {
    const missing = await loadAgentConfig(configPath)
    assert.equal(missing.config.endpoint, '')
    assert.equal(missing.warnings.length, 0)

    await saveAgentConfig(configPath, { endpoint: 'http://127.0.0.1:9/v1/chat/completions', model: '夹具模型', apiKey: 'sk-secret-9999' })
    const loaded = await loadAgentConfig(configPath)
    assert.equal(loaded.config.endpoint, 'http://127.0.0.1:9/v1/chat/completions')
    assert.equal(loaded.config.model, '夹具模型')
    assert.equal(loaded.config.apiKey, 'sk-secret-9999')

    await saveAgentConfig(configPath, { endpoint: 'http://127.0.0.1:9/v1/chat/completions', model: '换模型' })
    assert.equal((await loadAgentConfig(configPath)).config.apiKey, 'sk-secret-9999', 'apiKey 缺省＝保留')

    await saveAgentConfig(configPath, { endpoint: 'http://127.0.0.1:9/v1/chat/completions', apiKey: '' })
    assert.equal((await loadAgentConfig(configPath)).config.apiKey, '', '空串＝清除')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('配置：坏档按未配置＋warning，不拦启动', async () => {
  const { base, configPath } = await makeFixture()
  try {
    await writeFile(configPath, '{ broken', 'utf-8')
    const loaded = await loadAgentConfig(configPath)
    assert.equal(loaded.config.endpoint, '')
    assert.equal(loaded.warnings[0].code, 'AGENT_CONFIG_CORRUPT')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('配置：configPublic 永不含完整 key', () => {
  const payload = configPublic({ endpoint: 'http://x', model: 'm', apiKey: 'sk-abcdef1234567890' }, 'C:/cfg.json')
  assert.equal(payload.configured, true)
  assert.equal(payload.apiKeyMasked, '••••7890')
  assert.ok(!JSON.stringify(payload).includes('abcdef1234567890'))
  const off = configPublic({ endpoint: '', model: '', apiKey: '' }, 'C:/cfg.json')
  assert.equal(off.configured, false)
  assert.equal(off.apiKeyMasked, undefined)
})

/* ---------- 会话 ---------- */

test('会话 id：只允许 [\\w-]，挡路径逃逸', () => {
  assert.equal(isValidSessionId('s-abc_123'), true)
  assert.equal(isValidSessionId('../evil'), false)
  assert.equal(isValidSessionId('a\\b'), false)
  assert.equal(isValidSessionId(''), false)
  assert.equal(isValidSessionId('x'.repeat(81)), false)
})

test('会话：建→列→读→追加→改名→删，全程一个目录一个文件', async () => {
  const { base, root, sessionsDir } = await makeFixture()
  try {
    const created = await createSession(sessionsDir, root, '第一段怎么改')
    assert.match(created.id, /^s-[\w-]+$/u)
    assert.equal(created.title, '第一段怎么改')

    await appendSession(sessionsDir, root, created.id, [
      { t: 'msg', id: 'm1', role: 'user', content: '第一段写什么？', at: '2026-11-14T10:00:00.000Z' },
      { t: 'msg', id: 'm2', role: 'assistant', content: '先写雾。', at: '2026-11-14T10:00:05.000Z' }
    ])

    const listed = await listSessions(sessionsDir, root)
    assert.equal(listed.length, 1)
    assert.equal(listed[0].messageCount, 2)
    assert.equal(listed[0].updatedAt, '2026-11-14T10:00:05.000Z')

    const loaded = await readSession(sessionsDir, root, created.id)
    assert.equal(loaded.items.length, 2)
    assert.equal(loaded.items[0].kind, 'msg')
    assert.equal(loaded.items[0].role, 'user')

    const renamed = await renameSession(sessionsDir, root, created.id, '雾的开场')
    assert.equal(renamed.title, '雾的开场')
    assert.equal(renamed.messageCount, 2, '改名不丢消息')

    // 卡状态更新不丢其他行
    await appendSession(sessionsDir, root, created.id, [
      { t: 'card', id: 'c1', state: 'open', file: '正文/ch1.md', text: '先写雾。', chars: 4, snapshot: { exists: true, chars: 6, sha256: 'x' }, createdAt: '2026-11-14T10:01:00.000Z' }
    ])
    const card = await updateCard(sessionsDir, root, created.id, 'c1', { state: 'adopted', resolvedAt: '2026-11-14T10:02:00.000Z' })
    assert.equal(card.state, 'adopted')
    const after = await readSession(sessionsDir, root, created.id)
    assert.equal(after.items.filter((item) => item.kind === 'msg').length, 2)
    assert.equal(after.items.find((item) => item.kind === 'card').state, 'adopted')

    assert.equal(await deleteSession(sessionsDir, root, created.id), true)
    assert.equal(await listSessions(sessionsDir, root).then((list) => list.length), 0)
    assert.equal(await readSession(sessionsDir, root, created.id), null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话目录：同库（大小写不同）落同一目录，异库分开', { skip: process.platform !== 'win32' }, () => {
  const left = sessionDirFor('C:/s', 'D:\\写作\\长夜')
  const right = sessionDirFor('C:/s', 'd:/写作/长夜')
  assert.equal(left, right)
  assert.notEqual(left, sessionDirFor('C:/s', 'D:\\写作\\别的'))
})

/* ---------- 快照闸 ---------- */

test('快照闸：存在/不存在/内容变化都能分辨', async () => {
  const { base, root } = await makeFixture()
  try {
    const file = join(root, '正文', 'ch1.md')
    const snap = fileSnapshot(file)
    assert.equal(snap.exists, true)
    assert.equal(snap.chars, 6)
    assert.match(snap.sha256, /^[0-9a-f]{64}$/u)

    const missing = fileSnapshot(join(root, '正文', '不存在.md'))
    assert.equal(missing.exists, false)

    assert.equal(snapshotsMatch(fileSnapshot(file), snap), true)
    await writeFile(file, '改过的第一章。', 'utf-8')
    assert.equal(snapshotsMatch(fileSnapshot(file), snap), false, '内容变了必须拦')
    assert.equal(snapshotsMatch(missing, { exists: false, chars: 0, sha256: '' }), true, '仍是新文件＝一致')
    assert.equal(snapshotsMatch(fileSnapshot(file), missing), false, '文件出现了＝不一致')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 上游解析与消息组装 ---------- */

test('SSE 解析：跨 chunk 半行、[DONE]、坏行都不伪造内容', () => {
  const pieces = []
  const parser = createSseDeltaParser((piece) => pieces.push(piece))
  parser.feed('data: {"choices":[{"de')
  parser.feed('lta":{"content":"雾从"}}]}\n\ndata: {"choices":[{"delta":{"content":"水面漫上来"}}]}\n\n')
  parser.feed('data: [DONE]\n\ndata: 不是json\n\n')
  parser.end()
  assert.equal(pieces.join(''), '雾从水面漫上来')
})

test('SSE 解析：上游不理会 stream:true 时整段 JSON 兜底', () => {
  const pieces = []
  const parser = createSseDeltaParser((piece) => pieces.push(piece))
  parser.feed('{"choices":[{"message":{"content":"整段回答"}}]}')
  parser.end()
  assert.equal(pieces.join(''), '整段回答')
})

test('消息组装：system 在首，历史从尾部截且字数封顶', () => {
  const items = [
    { kind: 'msg', role: 'user', content: '一'.repeat(30) },
    { kind: 'msg', role: 'assistant', content: '答一' },
    { kind: 'card', id: 'c1' }, // 卡不进上游
    { kind: 'msg', role: 'user', content: '二' }
  ]
  const messages = buildUpstreamMessages('你是写作助手。', items, { maxMessages: 2, maxChars: 100 })
  assert.equal(messages[0].role, 'system')
  assert.equal(messages.length, 3, 'system＋2 条（maxMessages 封顶）')
  assert.equal(messages[1].content, '答一')
  assert.equal(messages[2].content, '二')
  const tiny = buildUpstreamMessages('s', items, { maxMessages: 10, maxChars: 5 })
  assert.equal(tiny.length, 3, 'system＋保底两条，30 字的老消息被截掉')
  assert.ok(tiny.every((message) => message.content.length <= 30), '没有整段超限消息混进来')
})

/* ---------- 契约形状 ---------- */

test('契约：agent 端点请求/响应形状', () => {
  assert.equal(validateRequest('agentConfigPut', { endpoint: 'http://x', model: 'm', apiKey: 'k' }).ok, true)
  assert.equal(validateRequest('agentConfigPut', {}).ok, true, '全可选＝清空也要能过')
  assert.equal(validateRequest('agentSessions', {}).ok, false)
  assert.equal(validateRequest('agentCardCreate', { root: 'r', sessionId: 's', file: '正文/a.md', text: 'x' }).ok, true)
  assert.equal(validateRequest('agentCardCreate', { root: 'r', sessionId: 's', file: '正文/a.md' }).ok, false)
  assert.equal(validateRequest('agentCardAdopt', { root: 'r', sessionId: 's', id: 'c1' }).ok, true)
  assert.equal(validateResponse('agentSessions', { ok: true, sessions: [] }).ok, true)
  assert.equal(validateResponse('agentSessionGet', { ok: true, session: { id: 's' }, items: [] }).ok, true)
  assert.equal(validateResponse('agentCardAdopt', { ok: true, card: {}, chars: 3, savedAt: 't' }).ok, true)
  assert.equal(API_ERROR_CODES.AGENT_NOT_CONFIGURED, 'AGENT_NOT_CONFIGURED')
})

/* ---------- daemon 端到端（夹具上游）---------- */

test('daemon 端到端：没配置＝AGENT_NOT_CONFIGURED；配置后对话流式＋落档；key 不回显', async () => {
  const fixture = await makeFixture()
  const upstream = await startFakeUpstream()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const root = encodeURIComponent(fixture.root)
  try {
    // ① 未配置就发对话
    const early = await fetch(`${origin}/api/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fixture.root, content: '你好' })
    })
    assert.equal(early.status, 400)
    assert.equal((await early.json()).error.code, 'AGENT_NOT_CONFIGURED')

    // ② 配置（带 key）
    const saved = await (await fetch(`${origin}/api/agent/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: upstream.url, model: '夹具模型', apiKey: 'sk-secret-4321' })
    })).json()
    assert.equal(saved.ok, true)
    assert.equal(saved.configured, true)
    assert.equal(saved.apiKeyMasked, '••••4321')
    assert.ok(!JSON.stringify(saved).includes('sk-secret-4321'), '响应绝不回显完整 key')

    const got = await (await fetch(`${origin}/api/agent/config`)).json()
    assert.ok(!JSON.stringify(got).includes('sk-secret-4321'))
    assert.equal(got.configPath, fixture.configPath)

    // ③ 对话：新建会话 → start/delta/done
    const chat = await fetch(`${origin}/api/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fixture.root, content: '第一章怎么开头？' })
    })
    assert.equal(chat.status, 200)
    assert.match(chat.headers.get('content-type'), /text\/event-stream/u)
    const { frames } = await readChatStream(chat)
    assert.equal(frames[0].type, 'start')
    const sessionId = frames[0].sessionId
    assert.match(sessionId, /^s-[\w-]+$/u)
    const deltas = frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('')
    assert.ok(deltas.includes('收到：第一章怎么开头'), `夹具上游回声，实际：${deltas}`)
    const done = frames.find((frame) => frame.type === 'done')
    assert.equal(done.sessionId, sessionId)
    assert.equal(done.chars, deltas.length)

    // 上游收到了 Bearer key，且消息里带 system＋当前用户消息
    assert.equal(upstream.server.lastAuth, 'Bearer sk-secret-4321')
    assert.equal(upstream.server.lastBody.messages[0].role, 'system')
    assert.ok(upstream.server.lastBody.messages.at(-1).content.includes('第一章怎么开头'))

    // ④ 会话落档：user＋assistant 各一条；清单里 title 取首句
    const sessions = await (await fetch(`${origin}/api/agent/sessions?root=${root}`)).json()
    assert.equal(sessions.ok, true)
    assert.equal(sessions.sessions.length, 1)
    assert.equal(sessions.sessions[0].id, sessionId)
    assert.equal(sessions.sessions[0].title, '第一章怎么开头？')
    assert.equal(sessions.sessions[0].messageCount, 2)

    const thread = await (await fetch(`${origin}/api/agent/session?root=${root}&id=${sessionId}`)).json()
    assert.equal(thread.ok, true)
    assert.equal(thread.items.filter((item) => item.kind === 'msg').length, 2)
    assert.equal(thread.items.find((item) => item.role === 'assistant').content, deltas)

    // ⑤ 同会话续聊
    const again = await fetch(`${origin}/api/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fixture.root, sessionId, content: '第二句呢？' })
    })
    const second = await readChatStream(again)
    assert.equal(second.frames[0].sessionId, sessionId)
    const thread2 = await (await fetch(`${origin}/api/agent/session?root=${root}&id=${sessionId}`)).json()
    assert.equal(thread2.items.filter((item) => item.kind === 'msg').length, 4)

    // ⑥ 假会话 404
    const missing = await fetch(`${origin}/api/agent/session?root=${root}&id=s-nope`)
    assert.equal(missing.status, 404)
  } finally {
    await daemon.close()
    await new Promise((resolvePromise) => upstream.server.close(resolvePromise))
    await rm(fixture.base, { recursive: true, force: true })
  }
})

test('daemon 端到端：待确认卡——采纳写正文＋备份；改文件后拒绝；重采拒绝；路径逃逸拒收', async () => {
  const fixture = await makeFixture()
  const upstream = await startFakeUpstream()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const root = encodeURIComponent(fixture.root)
  const post = (path, body) => fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  try {
    await fetch(`${origin}/api/agent/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: upstream.url, model: '夹具模型' })
    })
    const chat = await post('/api/agent/chat', { root: fixture.root, content: '给我一段开头' })
    const { frames } = await readChatStream(chat)
    const sessionId = frames[0].sessionId

    // ① 建卡（目标是已存在的 ch1.md）
    const cardRes = await post('/api/agent/cards', {
      root: fixture.root, sessionId, file: '正文/ch1.md', text: '雾到傍晚才散。', note: '开头重写'
    })
    assert.equal(cardRes.status, 200)
    const card = (await cardRes.json()).card
    assert.equal(card.state, 'open')
    assert.equal(card.snapshot.exists, true)
    assert.equal(card.snapshot.chars, 6)
    assert.match(newCardId(), /^c-[\w-]+$/u)

    // 卡进线程
    const thread = await (await fetch(`${origin}/api/agent/session?root=${root}&id=${sessionId}`)).json()
    assert.equal(thread.items.some((item) => item.kind === 'card' && item.id === card.id), true)

    // ② 文件在卡创建后被改 → REVISION_MISMATCH，正文不动
    await writeFile(join(fixture.root, '正文', 'ch1.md'), '作者刚在 Pinax 里改过。', 'utf-8')
    const clash = await post('/api/agent/cards/adopt', { root: fixture.root, sessionId, id: card.id })
    assert.equal(clash.status, 409)
    assert.equal((await clash.json()).error.code, 'REVISION_MISMATCH')
    assert.equal(await readFile(join(fixture.root, '正文', 'ch1.md'), 'utf-8'), '作者刚在 Pinax 里改过。')

    // ③ 复原快照内容后采纳成功：正文真变＋.history 备份
    await writeFile(join(fixture.root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
    const adopt = await post('/api/agent/cards/adopt', { root: fixture.root, sessionId, id: card.id })
    assert.equal(adopt.status, 200)
    const adopted = await adopt.json()
    assert.equal(adopted.ok, true)
    assert.equal(adopted.card.state, 'adopted')
    assert.equal(adopted.chars, 7)
    assert.ok(adopted.backup.includes('.history/'))
    assert.equal(await readFile(join(fixture.root, '正文', 'ch1.md'), 'utf-8'), '雾到傍晚才散。')
    const historyDir = await readdir(join(fixture.root, '正文', '.history'))
    assert.equal(historyDir.length, 1)
    assert.equal(await readFile(join(fixture.root, '正文', '.history', historyDir[0]), 'utf-8'), '第一章正文。')

    // ④ 已采纳的卡不能再采
    const again = await post('/api/agent/cards/adopt', { root: fixture.root, sessionId, id: card.id })
    assert.equal(again.status, 400)
    assert.equal((await again.json()).error.code, 'INVALID_ENTRY')

    // ⑤ 拒绝另一张卡
    const card2 = (await (await post('/api/agent/cards', {
      root: fixture.root, sessionId, file: '正文/新章.md', text: '新章内容。'
    })).json()).card
    assert.equal(card2.snapshot.exists, false, '新文件快照')
    const rejected = await post('/api/agent/cards/reject', { root: fixture.root, sessionId, id: card2.id })
    assert.equal((await rejected.json()).card.state, 'rejected')
    assert.equal(await readFile(join(fixture.root, '正文', '新章.md'), 'utf-8').catch(() => 'ABSENT'), 'ABSENT', '拒绝＝不落盘')

    // ⑥ 路径逃逸的卡拒收
    const escape = await post('/api/agent/cards', { root: fixture.root, sessionId, file: '../secret.md', text: 'x' })
    assert.equal(escape.status, 403)
    assert.equal((await escape.json()).error.code, 'PATH_ESCAPE')

    // ⑦ 会话改名/删除走 API 也通
    const renamed = await post('/api/agent/session/rename', { root: fixture.root, id: sessionId, title: '开头重写' })
    assert.equal((await renamed.json()).session.title, '开头重写')
    const removed = await fetch(`${origin}/api/agent/session?root=${root}&id=${sessionId}`, { method: 'DELETE' })
    assert.equal(removed.status, 200)
    assert.equal((await (await fetch(`${origin}/api/agent/sessions?root=${root}`)).json()).sessions.length, 0)
  } finally {
    await daemon.close()
    await new Promise((resolvePromise) => upstream.server.close(resolvePromise))
    await rm(fixture.base, { recursive: true, force: true })
  }
})

test('默认路径：跟随 LOCALAPPDATA/PinaxNext/openstory', () => {
  assert.equal(
    defaultAgentConfigPath({ LOCALAPPDATA: 'C:/Users/x/AppData/Local' }).replaceAll('\\', '/'),
    'C:/Users/x/AppData/Local/PinaxNext/openstory/agent-config.json'
  )
  assert.equal(defaultAgentConfigPath({}), '')
})
