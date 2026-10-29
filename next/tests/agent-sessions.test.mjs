import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SESSION_STORAGE_PREFIX,
  DEFAULT_SESSION_TITLE,
  MAX_SESSIONS,
  MAX_SESSION_MESSAGES,
  SESSION_TITLE_CHARS,
  agentSessionStorageKey,
  createSessionStore,
  sanitizeSessionMessage
} from '../shell/agentSessions.mjs'

/**
 * 会话存储单测（批次27 · 任务一）。
 * 纯 node:test：agentSessions.mjs 不 import Vue，状态机、上限截断与降级路径都能脱离浏览器直接测。
 */

/** 最小的 localStorage 替身：只实现 getItem/setItem，另给 dump() 方便断言键值。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    dump() {
      return Object.fromEntries(map)
    }
  }
}

/** 单调递增的时钟：会话排序与「最旧」判定都靠时间，测试里不能靠真实毫秒。 */
function stepClock(start = 1_700_000_000_000, step = 1000) {
  let value = start
  return () => {
    value += step
    return value
  }
}

test('会话管理：首启建空会话，可新建／切换／改名／删除', () => {
  const storage = memoryStorage()
  const store = createSessionStore('D:/proj', { storage, now: stepClock() })

  assert.equal(agentSessionStorageKey('D:/proj'), `${AGENT_SESSION_STORAGE_PREFIX}D:/proj`)
  assert.equal(store.storageKey, 'agentSessions.D:/proj')
  assert.equal(store.list().length, 1, '无会话时首启自动建一个空会话')
  const first = store.list()[0]
  assert.equal(first.title, DEFAULT_SESSION_TITLE)
  assert.equal(first.messageCount, 0)
  assert.equal(store.active().id, first.id)
  assert.deepEqual(store.active().messages, [])

  store.append({ role: 'user', text: '开场能不能再狠一点？' })
  assert.equal(store.list()[0].title, '开场能不能再狠一点？', '标题自动取第一条 user 消息')
  assert.equal(store.list()[0].messageCount, 1)

  const created = store.create()
  assert.equal(store.list().length, 2, '新建会话进列表')
  assert.equal(store.snapshot().activeId, created.id, '新建的会话立刻成为当前会话')
  assert.deepEqual(store.active().messages, [], '新会话是空的')

  assert.equal(store.switchTo(first.id), true)
  assert.equal(store.active().messages.length, 1)
  assert.equal(store.switchTo('s-不存在'), false, '切到不存在的会话如实拒绝')
  assert.equal(store.active().id, first.id, '拒绝的切换不改当前会话')

  assert.equal(store.rename(first.id, '  雨夜那一场  '), true)
  assert.equal(store.active().title, '雨夜那一场')
  store.append({ role: 'user', text: '第二问不该改标题' })
  assert.equal(store.active().title, '雨夜那一场', '手动 rename 之后不再自动改')
  assert.equal(store.rename(first.id, '   '), false, '空标题拒绝')

  assert.equal(store.remove(created.id), true)
  assert.equal(store.list().length, 1)

  // 删掉当前会话：先切到最近更新的一条；删空则自动补一个空会话。
  assert.equal(store.remove(first.id), true)
  assert.equal(store.list().length, 1, '删空也要留一个能打字的地方')
  assert.deepEqual(store.active().messages, [])
  assert.equal(store.remove('s-不存在'), false)
})

test('上限：30 个会话、每会话 200 条消息，超限丢最旧', () => {
  const store = createSessionStore('D:/cap', { storage: memoryStorage(), now: stepClock() })

  for (let index = 1; index <= MAX_SESSIONS + 5; index += 1) store.create(`标题${index}`)
  const titles = store.list().map((item) => item.title)
  assert.equal(titles.length, MAX_SESSIONS, `会话上限 ${MAX_SESSIONS}`)
  assert.ok(!titles.includes('标题1'), '最旧的会话被丢掉')
  assert.ok(titles.includes(`标题${MAX_SESSIONS + 5}`), '最新的会话还在')

  const session = store.create('消息上限')
  assert.ok(session.id)
  for (let index = 1; index <= MAX_SESSION_MESSAGES + 5; index += 1) {
    store.append({ role: 'user', text: `第${index}条` })
  }
  const messages = store.active().messages
  assert.equal(messages.length, MAX_SESSION_MESSAGES, `每会话上限 ${MAX_SESSION_MESSAGES} 条`)
  assert.equal(messages[0].text, '第6条', '丢的是最旧的那批')
  assert.equal(messages.at(-1).text, `第${MAX_SESSION_MESSAGES + 5}条`)
})

test('标题自动生成：只认第一条 user 消息，前 24 字，换行收成空格', () => {
  const store = createSessionStore('D:/title', { storage: memoryStorage(), now: stepClock() })

  store.append({ role: 'user', text: `${'雨'.repeat(SESSION_TITLE_CHARS + 10)}后面还有很长` })
  assert.equal(store.active().title, '雨'.repeat(SESSION_TITLE_CHARS))
  assert.equal(store.active().title.length, SESSION_TITLE_CHARS)

  store.append({ role: 'agent', text: '回答' })
  store.append({ role: 'user', text: '第二问' })
  assert.equal(store.active().title, '雨'.repeat(SESSION_TITLE_CHARS), '标题不跟第二条 user 消息改')

  const multi = store.create()
  store.append({ role: 'user', text: '第一行\n第二行' })
  assert.equal(store.active().title, '第一行 第二行', `换行收成一个空格（会话 ${multi.id}）`)
})

test('存储写失败不崩：降级为内存会话，界面照常（persistent=false）', () => {
  const hostile = {
    getItem() {
      throw new Error('SecurityError: denied')
    },
    setItem() {
      throw new Error('SecurityError: denied')
    }
  }
  const store = createSessionStore('D:/private', { storage: hostile })
  assert.doesNotThrow(() => store.append({ role: 'user', text: '隐私模式下也能问' }))
  assert.equal(store.snapshot().persistent, false, '落盘失败要如实说')
  assert.equal(store.active().messages.length, 1, '本次会话里照样生效')

  const created = store.create()
  assert.equal(store.snapshot().activeId, created.id, '内存里照样能新建与切换')
  assert.doesNotThrow(() => store.remove(created.id))

  // 只有写失败（配额）时也一样：读得到旧值、写不进去，不拦继续用。
  const quota = {
    getItem: () => null,
    setItem() {
      throw new Error('QuotaExceededError')
    }
  }
  const tight = createSessionStore('D:/quota', { storage: quota })
  assert.equal(tight.snapshot().persistent, false)
  assert.doesNotThrow(() => tight.append({ role: 'agent', text: '答' }))
  assert.equal(tight.active().messages.length, 1)

  // 完全没有存储（node 环境／沙箱）：不持久化，但 store 的 API 与状态照常。
  const memoryOnly = createSessionStore('D:/none', { storage: null })
  assert.equal(memoryOnly.storageKey, 'agentSessions.D:/none')
  assert.equal(memoryOnly.snapshot().persistent, false)
  memoryOnly.append({ role: 'user', text: '只活在内存' })
  assert.equal(memoryOnly.active().messages.length, 1)
})

test('projectRoot 隔离：每个项目一份键，互不串；没有项目根时不落盘', () => {
  const storage = memoryStorage()
  const a = createSessionStore('D:/a', { storage, now: stepClock() })
  a.append({ role: 'user', text: 'A 的问题' })
  const b = createSessionStore('D:/b', { storage, now: stepClock() })
  assert.equal(b.active().messages.length, 0, '另一个项目读不到 A 的会话')
  b.append({ role: 'user', text: 'B 的问题' })

  assert.deepEqual(Object.keys(storage.dump()).sort(), ['agentSessions.D:/a', 'agentSessions.D:/b'])

  // 重新打开 A：消息、标题与当前会话都按磁盘上的那份回来。
  const again = createSessionStore('D:/a', { storage, now: stepClock() })
  assert.equal(again.active().messages.length, 1)
  assert.equal(again.active().messages[0].text, 'A 的问题')
  assert.equal(again.active().title, 'A 的问题')

  // 还没打开项目（空根）：没有身份可归属，只活在内存里。
  const none = createSessionStore('', { storage })
  none.append({ role: 'user', text: '无项目' })
  assert.equal(none.storageKey, null)
  assert.equal(none.snapshot().persistent, false)
  assert.equal(Object.keys(storage.dump()).length, 2, '没有项目根不新写键')
})

test('持久化往返：多会话与 activeId 落盘，消息形状是 JSON 安全的固定字段', () => {
  const storage = memoryStorage()
  const store = createSessionStore('D:/round', { storage, now: stepClock() })
  store.append({
    role: 'user',
    text: '只依据本书资料回答：柯秒是谁？',
    command: '/资料',
    notes: ['（引用取不到：章节《第009章》 项目清单里没有这一条）'],
    // 不该进存储的字段（上游塞进来的临时对象）—— sanitize 会挡掉。
    raw: { big: 'x'.repeat(1000) }
  })
  store.append({
    role: 'agent',
    text: '柯秒是主角。',
    findings: [{ severity: 'low', message: '停摆表没推动动作。', extra: 'drop' }],
    actions: ['补一笔场景细节。']
  })
  const second = store.create()
  store.append({ role: 'user', text: '第二条会话的开头' })

  const saved = JSON.parse(storage.dump()['agentSessions.D:/round'])
  assert.deepEqual(Object.keys(saved).sort(), ['activeId', 'sessions'])
  assert.equal(saved.activeId, second.id, 'activeId 一起落盘')
  assert.equal(saved.sessions.length, 2)

  const firstMessage = saved.sessions[0].messages[0]
  assert.deepEqual(Object.keys(firstMessage).sort(),
    ['actions', 'at', 'command', 'failed', 'findings', 'id', 'notes', 'role', 'text'],
    '消息只落 schema 里那几个字段（未知字段不进存储）')
  assert.equal(firstMessage.command, '/资料')
  assert.equal(firstMessage.notes.length, 1)
  assert.deepEqual(Object.keys(saved.sessions[0].messages[1].findings[0]).sort(), ['message', 'severity'])

  // 读回来还能接着用：updateLast 只改最后一条、dropLast 去掉它。
  const reopened = createSessionStore('D:/round', { storage, now: stepClock() })
  assert.equal(reopened.snapshot().activeId, second.id)
  reopened.switchTo(saved.sessions[0].id)
  assert.equal(reopened.active().messages.length, 2)
  reopened.updateLast({ text: '改过的回答' })
  assert.equal(reopened.active().messages.at(-1).text, '改过的回答')
  assert.equal(reopened.active().messages.at(-1).role, 'agent', 'updateLast 不许换掉角色')
  assert.equal(reopened.dropLast(), true)
  assert.equal(reopened.active().messages.length, 1)
  assert.equal(reopened.dropLast(), true)
  assert.equal(reopened.dropLast(), false, '空了就没什么可丢的')

  // 坏数据（不是 JSON／形状不对）当作没存过：不崩、起一个空会话。
  const broken = memoryStorage({ 'agentSessions.D:/broken': '{不是 json' })
  assert.doesNotThrow(() => createSessionStore('D:/broken', { storage: broken }))
  const emptyShape = memoryStorage({ 'agentSessions.D:/shape': JSON.stringify({ sessions: [{ title: '' }, null, 42] }) })
  const shaped = createSessionStore('D:/shape', { storage: emptyShape })
  assert.equal(shaped.list().length, 1)
  assert.equal(shaped.active().title, DEFAULT_SESSION_TITLE)
})

test('晚到的回答落回出发的那个会话：切走之后 append(id) 不写进新会话', () => {
  const store = createSessionStore('D:/late', { storage: memoryStorage(), now: stepClock() })
  const first = store.list()[0]
  store.append({ role: 'user', text: 'A 会话的问题' }, first.id)
  const second = store.create('B 会话')
  assert.equal(store.snapshot().activeId, second.id)

  // 回答晚到：带上出发时的会话 id，就落回 A，不落在作者此刻看着的 B。
  store.append({ role: 'agent', text: 'A 会话的回答' }, first.id)
  assert.deepEqual(store.active().messages, [], '当前会话（B）不该收下别处的回答')
  store.switchTo(first.id)
  assert.deepEqual(store.active().messages.map((message) => message.text), ['A 会话的问题', 'A 会话的回答'])

  // 会话被删掉之后晚到的回答无处可去：如实返回 null，不抛、也不落到别人家。
  store.remove(first.id)
  assert.equal(store.append({ role: 'agent', text: '孤儿回答' }, first.id), null)
})

test('消息清洗：角色必须是 user/agent，非字符串字段不进存储', () => {
  assert.equal(sanitizeSessionMessage(null), null)
  assert.equal(sanitizeSessionMessage({ role: 'system', text: 'x' }), null)
  assert.deepEqual(sanitizeSessionMessage({ role: 'agent', text: 42, findings: 'nope', actions: [1, 'ok'] }), {
    id: '',
    role: 'agent',
    text: '',
    findings: [],
    actions: ['ok'],
    notes: [],
    command: '',
    failed: false,
    at: ''
  })
  assert.equal(sanitizeSessionMessage({ role: 'user', failed: 'yes' }).failed, false, 'failed 只认布尔真值')
})
