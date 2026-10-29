import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SESSION_STORAGE_PREFIX,
  DEFAULT_SESSION_TITLE,
  MAX_SESSIONS,
  MAX_SESSION_MESSAGES,
  MAX_TRAIL_EVENTS,
  SESSION_TITLE_CHARS,
  agentSessionStorageKey,
  createSessionStore,
  describeRuntimeProgress,
  describeTrailEvent,
  sanitizeSessionMessage,
  sanitizeTrail,
  sanitizeTrailEvent
} from '../shell/agentSessions.mjs'

/**
 * 会话存储单测（批次27 · 任务一）。
 * 纯 node:test：agentSessions.mjs 不 import Vue，状态机、上限截断与降级路径都能脱离浏览器直接测。
 */

/**
 * 落盘适配器替身：save 收整份快照（与主进程 sessions:save 同一形状），深拷一份留作断言。
 * M2.5-B 起状态机不再碰 localStorage，持久化只经这一条 save 口。
 */
function recorder() {
  let latest = null
  let calls = 0
  return {
    save(payload) {
      calls += 1
      latest = JSON.parse(JSON.stringify(payload))
    },
    latest: () => latest,
    calls: () => calls
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
  const store = createSessionStore('D:/proj', { save: recorder().save, now: stepClock() })

  // 老键名只留给迁移认：新的落盘在 .pinax/sessions/，不再由本模块拼 localStorage 键。
  assert.equal(agentSessionStorageKey('D:/proj'), `${AGENT_SESSION_STORAGE_PREFIX}D:/proj`)
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
  const store = createSessionStore('D:/cap', { save: recorder().save, now: stepClock() })

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
  const store = createSessionStore('D:/title', { save: recorder().save, now: stepClock() })

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

test('落盘失败不崩：降级为内存会话，界面照常（persistent=false）', async () => {
  // 同步抛（IPC 桥没接好）：不拦提问，但如实说没持久化。
  const store = createSessionStore('D:/private', { save: () => { throw new Error('ipc 断了') } })
  assert.doesNotThrow(() => store.append({ role: 'user', text: '隐私模式下也能问' }))
  assert.equal(store.snapshot().persistent, false, '落盘失败要如实说')
  assert.equal(store.active().messages.length, 1, '本次会话里照样生效')

  const created = store.create()
  assert.equal(store.snapshot().activeId, created.id, '内存里照样能新建与切换')
  assert.doesNotThrow(() => store.remove(created.id))

  // 异步写盘失败（磁盘满／主进程拒绝）同样只降级：状态机不等它，也不回滚。
  const tight = createSessionStore('D:/quota', { save: () => Promise.reject(new Error('磁盘满')) })
  assert.doesNotThrow(() => tight.append({ role: 'agent', text: '答' }))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(tight.snapshot().persistent, false)
  assert.equal(tight.active().messages.length, 1)

  // 没有 save（没打开项目／没桥）：不持久化，但 store 的 API 与状态照常。
  const memoryOnly = createSessionStore('D:/none')
  assert.equal(memoryOnly.snapshot().persistent, false)
  memoryOnly.append({ role: 'user', text: '只活在内存' })
  assert.equal(memoryOnly.active().messages.length, 1)
})

test('projectRoot 隔离：每个项目只收到自己那份快照，互不串；没有 save 时不落盘', () => {
  const saved = new Map()
  const saver = (root) => (payload) => { saved.set(root, JSON.parse(JSON.stringify(payload))) }
  const a = createSessionStore('D:/a', { save: saver('D:/a'), now: stepClock() })
  a.append({ role: 'user', text: 'A 的问题' })
  const b = createSessionStore('D:/b', { save: saver('D:/b'), now: stepClock() })
  assert.equal(b.active().messages.length, 0, '另一个项目读不到 A 的会话')
  b.append({ role: 'user', text: 'B 的问题' })

  assert.deepEqual([...saved.keys()].sort(), ['D:/a', 'D:/b'])
  assert.equal(saved.get('D:/a').sessions[0].messages[0].text, 'A 的问题')
  assert.equal(saved.get('D:/b').sessions[0].messages[0].text, 'B 的问题')

  // 重新打开 A：消息、标题与当前会话都按主进程读回的那份（initial）回来。
  const again = createSessionStore('D:/a', { initial: saved.get('D:/a'), save: saver('D:/a'), now: stepClock() })
  assert.equal(again.active().messages.length, 1)
  assert.equal(again.active().messages[0].text, 'A 的问题')
  assert.equal(again.active().title, 'A 的问题')

  // 还没打开项目（空根、没有 save）：只活在内存里，不新写任何快照。
  const before = saved.size
  const none = createSessionStore('')
  none.append({ role: 'user', text: '无项目' })
  assert.equal(none.snapshot().persistent, false)
  assert.equal(saved.size, before, '没有 save 不新写快照')
})

test('持久化往返：多会话与 activeId 落盘，消息形状是 JSON 安全的固定字段', () => {
  const saver = recorder()
  const store = createSessionStore('D:/round', { save: saver.save, now: stepClock() })
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

  const saved = saver.latest()
  assert.deepEqual(Object.keys(saved).sort(), ['activeId', 'sessions'])
  assert.equal(saved.activeId, second.id, 'activeId 一起落盘')
  assert.equal(saved.sessions.length, 2)

  const firstMessage = saved.sessions[0].messages[0]
  assert.deepEqual(Object.keys(firstMessage).sort(),
    ['actions', 'at', 'command', 'failed', 'findings', 'id', 'notes', 'role', 'text', 'trail'],
    '消息只落 schema 里那几个字段（未知字段不进存储）')
  assert.equal(firstMessage.command, '/资料')
  assert.equal(firstMessage.notes.length, 1)
  assert.deepEqual(Object.keys(saved.sessions[0].messages[1].findings[0]).sort(), ['message', 'severity'])

  // 读回来还能接着用：updateLast 只改最后一条、dropLast 去掉它。
  const reopened = createSessionStore('D:/round', { initial: saved, save: saver.save, now: stepClock() })
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
  // 旧 localStorage 的解析失败已在迁移那层挡掉；这里兜的是主进程读回结果的形状漂移。
  assert.doesNotThrow(() => createSessionStore('D:/broken', { initial: '{不是 json' }))
  const shaped = createSessionStore('D:/shape', { initial: { sessions: [{ title: '' }, null, 42] } })
  assert.equal(shaped.list().length, 1)
  assert.equal(shaped.active().title, DEFAULT_SESSION_TITLE)
})

test('晚到的回答落回出发的那个会话：切走之后 append(id) 不写进新会话', () => {
  const store = createSessionStore('D:/late', { save: recorder().save, now: stepClock() })
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
    trail: [],
    failed: false,
    at: ''
  })
  assert.equal(sanitizeSessionMessage({ role: 'user', failed: 'yes' }).failed, false, 'failed 只认布尔真值')
})

test('运行过程轨迹（批次29）：事件按白名单清洗、封顶 32 条、随消息持久化', () => {
  // 白名单：只认五种阶段。链上不存在的子代理／hook 不许在这里长出假事件。
  assert.equal(sanitizeTrailEvent({ stage: 'subagent', name: '研究员' }), null)
  assert.equal(sanitizeTrailEvent(null), null)
  assert.deepEqual(
    sanitizeTrailEvent({
      stage: 'envelope',
      taskType: 'authoring.review.chapter',
      profile: 'writing-chapter',
      blocks: '6',
      chars: 18_240,
      missingKinds: ['outline', 42],
      extra: 'drop'
    }),
    {
      stage: 'envelope',
      taskType: 'authoring.review.chapter',
      profile: 'writing-chapter',
      blocks: 6,
      chars: 18_240,
      missingKinds: ['outline']
    },
    '计数收成整数、未知字段不进存储'
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'failed', code: 'AGENT_PROVIDER_CONFIG_INVALID', atStage: 'model-round' }),
    { stage: 'failed', code: 'AGENT_PROVIDER_CONFIG_INVALID', atStage: 'model-round' }
  )
  assert.equal(sanitizeTrailEvent({ stage: 'failed', atStage: 'failed' }).atStage, 'start', '断点只认前四步，failed 不能自己当断点')

  const long = Array.from({ length: MAX_TRAIL_EVENTS + 8 }, (_item, index) => ({ stage: 'model-round', round: index + 1 }))
  const capped = sanitizeTrail(long)
  assert.equal(capped.length, MAX_TRAIL_EVENTS, `轨迹封顶 ${MAX_TRAIL_EVENTS} 条`)
  assert.equal(capped[0].round, 9, '丢的是最旧的')
  assert.equal(capped.at(-1).round, MAX_TRAIL_EVENTS + 8)

  // 随消息落盘再读回来：轨迹还在、形状仍是固定字段（刷新后折叠层不会消失）。
  const saver = recorder()
  const store = createSessionStore('D:/trail', { save: saver.save, now: stepClock() })
  store.append({ role: 'user', text: '这一章怎么样？' })
  store.append({
    role: 'agent',
    text: '节奏偏慢。',
    trail: [
      { stage: 'start', questionChars: 7 },
      { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 6, chars: 18_240, missingKinds: [] },
      { stage: 'model-round', round: 1 },
      { stage: 'answer', chars: 5, structured: true, roundsUsed: 1 }
    ]
  })
  const reopened = createSessionStore('D:/trail', { initial: saver.latest(), now: stepClock() })
  const trail = reopened.active().messages.at(-1).trail
  assert.equal(trail.length, 4)
  assert.deepEqual(trail.map((event) => event.stage), ['start', 'envelope', 'model-round', 'answer'])
  assert.equal(trail[1].blocks, 6)
  assert.equal(trail.at(-1).structured, true)

  // 界面那两句：busy 期阶段语与折叠层一行，数字都来自事件本身。
  assert.equal(describeRuntimeProgress({ stage: 'envelope', blocks: 6, chars: 18_240 }), '正在组装上下文（6 块 · 18240 字）')
  assert.equal(describeRuntimeProgress({ stage: 'model-round', round: 2 }), '模型第 2 轮')
  assert.equal(describeRuntimeProgress({ stage: 'answer' }), '正在整理回答')
  assert.equal(describeRuntimeProgress({ stage: 'start', questionChars: 3 }), '', 'start 没有更好的话就回空串，让界面保留固定语')
  assert.equal(describeRuntimeProgress(null), '')
  assert.deepEqual(describeTrailEvent({ stage: 'failed', code: 'PINAX_DEPENDENCY_UNMET', atStage: 'model-round' }), {
    stage: 'failed',
    label: '中断',
    detail: 'PINAX_DEPENDENCY_UNMET · 断在模型轮次'
  })
  assert.equal(describeTrailEvent({ stage: 'subagent' }), null)
})
