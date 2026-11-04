import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import {
  MAX_SESSION_PROPOSALS,
  SESSIONS_DIR,
  foldSessionLines,
  isSessionId,
  sessionFilePath,
  createFileSessionStore
} from '../sessionStore.mjs'
import { migrateLegacySessions } from '../shell/sessionMigration.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import { MAX_SESSION_MESSAGES } from '../shell/agentSessions.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 会话落盘（M2.5-B · 任务三）。
 * 证五件事：JSONL 往返一致；坏行跳过并记账；墓碑删父不删子（子会话 re-parent 回根）；
 * 老 localStorage 迁移成功才删键、失败保留；会话 id 不进路径逃逸。
 */

const clock = () => 1_760_000_000_000

async function freshStore(label) {
  const workspace = await createTempWorkspace(label)
  const root = await workspace.projectPath('会话靶子')
  const store = createFileSessionStore({ root, now: clock })
  return { workspace, root, store }
}

async function seed(store, { id = 's-main', title = '', parent = null } = {}) {
  const created = await store.ensureSession({ id, title, createdAt: clock(), updatedAt: clock(), parent })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  return created
}

test('JSONL 往返：消息、模式事件、提案都能读回，摘要按最近更新排序', async () => {
  const { workspace, root, store } = await freshStore('session-roundtrip')
  try {
    assert.equal(store.dir, join(root, SESSIONS_DIR))
    await seed(store)

    const first = await store.appendMessage('s-main', { role: 'user', text: '把第三卷的开头重写一遍' })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.ok(first.value.id, '没给 id 的消息由存储补一个')
    await store.appendMessage('s-main', { role: 'agent', text: '好，我先读三章。', trail: [{ stage: 'answer', chars: 8 }] })

    const mode = await store.setWriteMode('s-main', 'auto')
    assert.equal(mode.ok, true, JSON.stringify(mode.error ?? {}))
    assert.equal(mode.value.changed, true)
    await store.recordProposal('s-main', { id: 'p-1', kind: 'chapter-rewrite', at: '10:00' })

    // 自动标题：第一条 user 消息的前 24 字。
    const read = await store.read('s-main')
    assert.equal(read.ok, true, JSON.stringify(read.error ?? {}))
    assert.equal(read.value.title, '把第三卷的开头重写一遍')
    assert.equal(read.value.writeMode, 'auto')
    assert.deepEqual(read.value.messages.map((item) => [item.role, item.text]), [
      ['user', '把第三卷的开头重写一遍'],
      ['agent', '好，我先读三章。']
    ])
    assert.equal(read.value.messages[1].trail[0].stage, 'answer')
    assert.deepEqual(read.value.events.map((event) => [event.kind, event.from, event.to]), [['mode', 'review', 'auto']])
    assert.deepEqual(read.value.proposals, [{ id: 'p-1', kind: 'chapter-rewrite', at: '10:00' }])

    // 文件形状：一行一条 JSON，type 只认五种。
    const text = await readFile(sessionFilePath(root, 's-main'), 'utf-8')
    const lines = text.trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual([...new Set(lines.map((line) => line.type))].sort(), ['event', 'message', 'proposal', 'session'])
    assert.equal(lines.filter((line) => line.type === 'message').length, 2)

    // 第二个会话更新更晚 → 列表里排前面。
    await seed(store, { id: 's-later', title: '另一件事' })
    const listed = await store.loadAll()
    assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
    assert.deepEqual(listed.value.sessions.map((session) => session.id), ['s-later', 's-main'])
    assert.equal(listed.value.badLines, 0)
    assert.deepEqual(listed.value.warnings, [])

    // 未知模式回落 review（与运行时同一条口径）。
    const fallback = await store.setWriteMode('s-main', 'yolo')
    assert.equal(fallback.value.writeMode, 'review')
    assert.equal((await store.read('s-main')).value.writeMode, 'review')
  } finally {
    await workspace.cleanup()
  }
})

test('上限：消息只留最近 200 条，提案只留最近 100 条', async () => {
  const { workspace, store } = await freshStore('session-caps')
  try {
    await seed(store, { id: 's-cap' })
    for (let index = 0; index < MAX_SESSION_MESSAGES + 5; index += 1) {
      const saved = await store.appendMessage('s-cap', { id: `m-${index}`, role: 'user', text: `第 ${index} 条` })
      assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    }
    for (let index = 0; index < MAX_SESSION_PROPOSALS + 3; index += 1) {
      await store.recordProposal('s-cap', { id: `p-${index}`, kind: 'restructure' })
    }
    const read = await store.read('s-cap')
    assert.equal(read.value.messages.length, MAX_SESSION_MESSAGES)
    assert.equal(read.value.messages[0].id, 'm-5', '丢的是最早的，不是正在看的')
    assert.equal(read.value.messages.at(-1).id, `m-${MAX_SESSION_MESSAGES + 4}`)
    assert.equal(read.value.proposals.length, MAX_SESSION_PROPOSALS)
    assert.equal(read.value.proposals.at(-1).id, `p-${MAX_SESSION_PROPOSALS + 2}`)
  } finally {
    await workspace.cleanup()
  }
})

test('坏行跳过并记账：一行坏字不让整份会话打不开，元数据行丢了也能按文件名兜底', async () => {
  const { workspace, root, store } = await freshStore('session-badlines')
  try {
    const dir = join(root, SESSIONS_DIR)
    await mkdir(dir, { recursive: true })
    const goodSession = JSON.stringify({ type: 'session', id: 's-broken', title: '半坏会话', createdAt: clock(), updatedAt: clock() })
    await writeFile(join(dir, 's-broken.jsonl'), [
      goodSession,
      '{这不是 JSON',
      JSON.stringify({ type: 'message', role: 'user', text: '这条能读' }),
      JSON.stringify({ type: 'message' }),
      JSON.stringify({ type: 'unknown-type', spot: 1 }),
      JSON.stringify({ type: 'event', kind: 'tool', from: 'review', to: 'auto' }),
      ''
    ].join('\n'), 'utf-8')

    // 元数据行整个没了：文件名兜底，消息照读，并且如实记一条 META_SYNTHESIZED。
    await writeFile(join(dir, 's-headless.jsonl'), [
      JSON.stringify({ type: 'message', role: 'agent', text: '元数据行被删了' })
    ].join('\n'), 'utf-8')

    const listed = await store.loadAll()
    assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
    assert.equal(listed.value.badLines, 4, '坏 JSON／缺 role／未知类型／非法事件各一条')
    const reasons = listed.value.warnings.map((item) => item.reason)
    assert.ok(reasons.includes('BAD_JSON'))
    assert.ok(reasons.includes('BAD_MESSAGE'))
    assert.ok(reasons.includes('UNKNOWN_TYPE'))
    assert.ok(reasons.includes('BAD_EVENT'))
    assert.ok(reasons.includes('META_SYNTHESIZED'))

    const broken = listed.value.sessions.find((session) => session.id === 's-broken')
    assert.equal(broken.messages.length, 1)
    assert.equal(broken.messages[0].text, '这条能读')
    const headless = listed.value.sessions.find((session) => session.id === 's-headless')
    assert.equal(headless.messages.length, 1)
    assert.equal(headless.title, '新会话')

    // fold 是纯函数：同一份行喂两次结果一致（不依赖磁盘状态）。
    const once = foldSessionLines([goodSession, '{坏'], { file: 'x.jsonl', fallbackId: 'x' })
    assert.equal(once.badLines, 1)
    assert.equal(once.session.id, 's-broken')
  } finally {
    await workspace.cleanup()
  }
})

test('墓碑：删父会话不删子会话——父从列表消失，子 re-parent 回根，文件留着墓碑行', async () => {
  const { workspace, root, store } = await freshStore('session-tombstone')
  try {
    await seed(store, { id: 's-parent', title: '父会话' })
    await seed(store, { id: 's-child', title: '子会话', parent: 's-parent' })
    await seed(store, { id: 's-grandchild', title: '孙会话', parent: 's-child' })

    const removed = await store.tombstone('s-parent')
    assert.equal(removed.ok, true, JSON.stringify(removed.error ?? {}))
    assert.deepEqual(removed.value, { deleted: true, alreadyDeleted: false, reparented: ['s-child'] })

    const listed = await store.loadAll()
    assert.deepEqual(listed.value.sessions.map((session) => session.id).sort(), ['s-child', 's-grandchild'])
    const child = listed.value.sessions.find((session) => session.id === 's-child')
    assert.equal(child.parent, null, '父删了，子会话成根会话')
    const grandchild = listed.value.sessions.find((session) => session.id === 's-grandchild')
    assert.equal(grandchild.parent, 's-child', '隔代关系不动')

    // 墓碑留在文件里：删过这件事本身是事实，诊断包与恢复都要看得到。
    const text = await readFile(sessionFilePath(root, 's-parent'), 'utf-8')
    assert.ok(text.trim().split('\n').map((line) => JSON.parse(line)).some((line) => line.type === 'tombstone'))
    const withDeleted = await store.loadAll({ includeDeleted: true })
    assert.equal(withDeleted.value.sessions.find((session) => session.id === 's-parent').deletedAt !== null, true)

    const again = await store.tombstone('s-parent')
    assert.equal(again.ok, true)
    assert.equal(again.value.alreadyDeleted, true)
    assert.deepEqual(again.value.reparented, [])
  } finally {
    await workspace.cleanup()
  }
})

test('迁移：老 localStorage 写进 JSONL 成功后才删键；写盘被拒时保留老键并如实报', async () => {
  const { workspace, store } = await freshStore('session-migration')
  try {
    const legacy = {
      activeId: 's-old-a',
      sessions: [
        {
          id: 's-old-a',
          title: '老会话甲',
          createdAt: clock(),
          updatedAt: clock(),
          renamed: true,
          writeMode: 'auto',
          messages: [{ id: 'm-1', role: 'user', text: '老消息', at: '09:00' }]
        },
        { id: 's-old-b', title: '老会话乙', createdAt: clock() - 10_000, updatedAt: clock() - 10_000, messages: [] }
      ]
    }
    const makeStorage = () => {
      const map = new Map([['agentSessions.D:/old', JSON.stringify(legacy)]])
      return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)) },
        removeItem: (key) => { map.delete(key) },
        map
      }
    }

    const storage = makeStorage()
    const migrated = await migrateLegacySessions({
      storage,
      key: 'agentSessions.D:/old',
      importVia: (payload) => store.importLegacy(payload)
    })
    assert.equal(migrated.ok, true, JSON.stringify(migrated))
    assert.equal(migrated.migrated, 2)
    assert.equal(migrated.removed, true)
    assert.equal(storage.getItem('agentSessions.D:/old'), null, '迁移成功后老键必须消失')

    const read = await store.read('s-old-a')
    assert.equal(read.value.title, '老会话甲')
    assert.equal(read.value.writeMode, 'auto')
    assert.equal(read.value.messages[0].text, '老消息')

    // 幂等：文件已在，再导一次只记 skipped，不覆盖磁盘上的新消息。
    await store.appendMessage('s-old-a', { role: 'user', text: '迁移后新说的' })
    const again = await store.importLegacy(legacy)
    assert.equal(again.value.imported, 0)
    assert.equal(again.value.skipped, 2)
    assert.equal((await store.read('s-old-a')).value.messages.length, 2)

    // 写盘被拒：老键保留，不静默丢历史。
    const failing = makeStorage()
    const kept = await migrateLegacySessions({
      storage: failing,
      key: 'agentSessions.D:/old',
      importVia: async () => ({ ok: false, error: { message: '磁盘不可写' } })
    })
    assert.equal(kept.ok, false)
    assert.equal(kept.kept, true)
    assert.equal(kept.removed, false)
    assert.notEqual(failing.getItem('agentSessions.D:/old'), null, '迁移失败绝不能先删键')

    // 老键坏成非 JSON：同样保留。
    const corrupt = makeStorage()
    corrupt.setItem('agentSessions.D:/old', '{不是 JSON')
    const bad = await migrateLegacySessions({ storage: corrupt, key: 'agentSessions.D:/old', importVia: () => ({ ok: true }) })
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'BAD_LEGACY_JSON')
    assert.notEqual(corrupt.getItem('agentSessions.D:/old'), null)
  } finally {
    await workspace.cleanup()
  }
})

test('整份快照回写：新增/改名/删消息落盘；快照里消失的会话写墓碑，子会话不陪葬', async () => {
  const { workspace, store } = await freshStore('session-snapshot')
  try {
    const base = {
      sessions: [
        {
          id: 's-a',
          title: '父会话',
          createdAt: clock(),
          updatedAt: clock(),
          renamed: true,
          writeMode: 'auto',
          messages: [{ id: 'm-1', role: 'user', text: '第一句', at: '09:00' }],
          events: [{ kind: 'mode', from: 'review', to: 'auto', by: 'author', at: '09:01' }],
          proposals: [{ id: 'p-1', kind: 'chapter-rewrite', at: '09:02' }]
        },
        { id: 's-b', title: '子会话', parent: 's-a', createdAt: clock(), updatedAt: clock(), messages: [] }
      ],
      activeId: 's-a'
    }
    const saved = await store.saveSnapshot(base)
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    assert.equal(saved.value.saved, 2)

    const read = await store.read('s-a')
    assert.equal(read.value.writeMode, 'auto')
    assert.equal(read.value.messages[0].text, '第一句')
    assert.deepEqual(read.value.proposals.map((item) => item.id), ['p-1'])

    // 再存一次同样的内容：不追加、不重写（读回仍是一份）。
    const again = await store.saveSnapshot(base)
    assert.equal(again.value.saved, 2)
    const lines = (await readFile(sessionFilePath(store.root, 's-a'), 'utf-8')).trim().split('\n')
    assert.equal(lines.length, 4, 'session + message + event + proposal，各一份')

    // 快照里删掉父会话：磁盘上的父写墓碑，子会话 re-parent 回根。
    const pruned = await store.saveSnapshot({ sessions: [base.sessions[1]], activeId: 's-b' })
    assert.equal(pruned.value.tombstoned, 1)
    assert.deepEqual(pruned.value.reparented, ['s-b'])
    const listed = await store.loadAll()
    assert.deepEqual(listed.value.sessions.map((session) => session.id), ['s-b'])
    assert.equal(listed.value.sessions[0].parent, null)

    // 非法的会话 id 不写盘（快照是外部输入，不能靠它决定路径）。
    const hostile = await store.saveSnapshot({ sessions: [{ id: '../evil', title: '越界', messages: [] }] })
    assert.equal(hostile.ok, true)
    assert.equal(hostile.value.saved, 0)
  } finally {
    await workspace.cleanup()
  }
})

/**
 * 〔批次77-R2 任务6〕追加式落盘 ＋ 守卫⑩「分支非破坏」（本批主验收）。
 *
 * 口径：渲染层每次仍交整份内存快照，主进程这份存储**先问一句「新状态是不是磁盘那份的严格增长」**——
 *   · 是（追写、分叉存出去的那一整段拷贝、拨支的指针）→ 只往文件尾补新行，既有行逐字节不变；
 *   · 不是（编辑重发的截断、上限截旧、文件里有坏行）→ 落回原来的 tmp＋rename 原子重写。
 * 增长判据比的是**折回来的内容**（id ＋ 净化后的字段），不比原始字节：消息行的 ts 由每次写覆盖，
 * 逐字节比会把这种正常变化误判成「改写」。
 */
const branchMessages = () => ([
  { id: 'm-q1', role: 'user', text: '第一问', at: '09:00' },
  { id: 'm-a1', role: 'agent', text: '第一答', at: '09:01' },
  { id: 'm-q2', role: 'user', text: '第二问', at: '09:02' },
  { id: 'm-a2', role: 'agent', text: '第二答', at: '09:03' }
])

const branchSession = (messages, extra = {}) => ({
  id: 's-branch',
  title: '分叉的会话',
  createdAt: clock(),
  updatedAt: clock(),
  renamed: true,
  messages,
  ...extra
})

async function linesOf(root, id) {
  const text = await readFile(sessionFilePath(root, id), 'utf-8')
  return text.trim().split('\n')
}

test('〔批次77-R2 任务6·守卫⑩〕分叉那次写入只往文件尾补行：既有行逐字节不变、首行还是那一条', async () => {
  const { workspace, root, store } = await freshStore('branch-append')
  try {
    const base = branchMessages()
    const seeded = await store.saveSnapshot({ sessions: [branchSession(base)], activeId: 's-branch' })
    assert.equal(seeded.ok, true, JSON.stringify(seeded.error ?? {}))
    const before = await linesOf(root, 's-branch')
    assert.equal(before.length, 5, 'session ＋ 四条消息')

    // 分叉＝把「第二问／第二答」原样拷贝成新支（头一条认分叉点，段内第二条认拷贝里前一条的新 id）。
    // 这是严格增长：一条既有的都没动。
    const copies = [
      { id: 'm-q2-copy', role: 'user', text: '第二问', at: '09:02', branch: { parentId: 'm-a1', index: 2, count: 2 } },
      { id: 'm-a2-copy', role: 'agent', text: '第二答', at: '09:03', branch: { parentId: 'm-q2-copy', index: 1, count: 1 } }
    ]
    const forked = await store.saveSnapshot({ sessions: [branchSession([...base, ...copies])], activeId: 's-branch' })
    assert.equal(forked.ok, true, JSON.stringify(forked.error ?? {}))
    const after = await linesOf(root, 's-branch')

    assert.equal(after.length, before.length + 2, '行数只增不减：多出的就是那两条拷贝')
    assert.deepEqual(after.slice(0, before.length), before, '既有行逐字节不变（守卫⑩的主断言）')
    assert.equal(after[0], before[0], '首行还是那一条元数据：没被重打')

    // 两叉都在盘上、互不覆盖：读回来原始支与拷贝支一条不缺。
    const read = await store.read('s-branch')
    assert.deepEqual(read.value.messages.map((message) => message.text),
      ['第一问', '第一答', '第二问', '第二答', '第二问', '第二答'])
    assert.equal(read.value.messages.filter((message) => message.branch === null).length, 4, '原始支就是不带标签的那一串')
    assert.deepEqual(read.value.messages[4].branch, { parentId: 'm-a1', index: 2, count: 2 })
  } finally {
    await workspace.cleanup()
  }
})

test('〔批次77-R2 任务6〕切支＝只多一行元数据：两支的内容一个字都没被重打', async () => {
  const { workspace, root, store } = await freshStore('branch-switch')
  try {
    const base = branchMessages()
    const copies = [
      { id: 'm-q2-copy', role: 'user', text: '第二问', at: '09:02', branch: { parentId: 'm-a1', index: 2, count: 2 } },
      { id: 'm-a2-copy', role: 'agent', text: '第二答', at: '09:03', branch: { parentId: 'm-q2-copy', index: 1, count: 1 } }
    ]
    const forked = [...base, ...copies]
    await store.saveSnapshot({ sessions: [branchSession(forked)], activeId: 's-branch' })
    const before = await linesOf(root, 's-branch')

    const switched = await store.saveSnapshot({
      sessions: [branchSession(forked, { branchChoice: { 'm-a1': 2 } })],
      activeId: 's-branch'
    })
    assert.equal(switched.ok, true, JSON.stringify(switched.error ?? {}))
    const after = await linesOf(root, 's-branch')
    assert.equal(after.length, before.length + 1, '指针换了＝只追加一条元数据行')
    assert.deepEqual(after.slice(0, before.length), before, '两支的内容一行都没被重打')
    const read = await store.read('s-branch')
    assert.deepEqual(read.value.branchChoice, { 'm-a1': 2 }, '指针随会话落盘：重开外壳还在这一支上')

    // 同一份状态再存一次：一个字节都不加（老口径「一致就不重写」原样保住）。
    const again = await store.saveSnapshot({
      sessions: [branchSession(forked, { branchChoice: { 'm-a1': 2 } })],
      activeId: 's-branch'
    })
    assert.equal(again.ok, true)
    assert.equal((await linesOf(root, 's-branch')).length, after.length, '没变化就不写')
  } finally {
    await workspace.cleanup()
  }
})

test('〔批次77-R2 任务6〕截断不是增长：落回原子重写，盘上只留内存里那一份', async () => {
  const { workspace, root, store } = await freshStore('branch-truncate')
  try {
    const base = branchMessages()
    await store.saveSnapshot({ sessions: [branchSession(base)], activeId: 's-branch' })
    const copies = [
      { id: 'm-q2-copy', role: 'user', text: '第二问', at: '09:02', branch: { parentId: 'm-a1', index: 2, count: 2 } },
      { id: 'm-a2-copy', role: 'agent', text: '第二答', at: '09:03', branch: { parentId: 'm-q2-copy', index: 1, count: 1 } }
    ]
    await store.saveSnapshot({ sessions: [branchSession([...base, ...copies])], activeId: 's-branch' })
    const before = await linesOf(root, 's-branch')
    assert.equal(before.length, 7)

    // 编辑重发那一步：把可见支上从第二问起的那两条截掉（分支先把它们存成了另一支，所以它们还在）。
    const kept = [base[0], base[1], copies[0], copies[1]]
    await store.saveSnapshot({ sessions: [branchSession(kept)], activeId: 's-branch' })
    const read = await store.read('s-branch')
    assert.deepEqual(read.value.messages.map((message) => message.id), ['m-q1', 'm-a1', 'm-q2-copy', 'm-a2-copy'])
    assert.equal((await linesOf(root, 's-branch')).length, 5, '少了几行就真少几行：追加式表达不了「删」，这条走原子重写')

    // 截完之后接着问：新那一条占回 1 号位（明写父链接），又回到严格增长。
    const appended = [...kept, { id: 'm-q3', role: 'user', text: '第二问（改过的）', at: '09:04', branch: { parentId: 'm-a1', index: 1, count: 1 } }]
    const grown = await store.saveSnapshot({ sessions: [branchSession(appended)], activeId: 's-branch' })
    assert.equal(grown.ok, true)
    const after = await linesOf(root, 's-branch')
    assert.equal(after.length, 6, '追写只补一行')
    const folded = await store.read('s-branch')
    assert.deepEqual(folded.value.messages.map((message) => message.text),
      ['第一问', '第一答', '第二问', '第二答', '第二问（改过的）'], '两支并存：退路那条还在')
  } finally {
    await workspace.cleanup()
  }
})

test('〔批次77-R2 任务6〕快照没交某个数组＝不是「清空」：分叉写入不许顺手抹了主进程记的提案', async () => {
  const { workspace, store } = await freshStore('branch-keep-proposals')
  try {
    const base = branchMessages()
    await store.saveSnapshot({ sessions: [branchSession(base)], activeId: 's-branch' })
    await store.recordProposal('s-branch', { id: 'p-1', kind: 'chapter-rewrite', at: '09:05' })

    // 渲染层的会话对象从不携带 proposals（提案归主进程记）：交上来的快照里没这一格。
    const copies = [{ id: 'm-q2-copy', role: 'user', text: '第二问', at: '09:02', branch: { parentId: 'm-a1', index: 2, count: 2 } }]
    const saved = await store.saveSnapshot({ sessions: [branchSession([...base, ...copies])], activeId: 's-branch' })
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    const read = await store.read('s-branch')
    assert.deepEqual(read.value.proposals.map((item) => item.id), ['p-1'], '没交＝保住，不是清空')
    assert.equal(read.value.messages.length, 5)
  } finally {
    await workspace.cleanup()
  }
})

test('IPC 三条会话通道：读写与迁移都只认当前项目；没有项目时如实报缺', async () => {
  const { workspace, store } = await freshStore('session-ipc')
  try {
    const session = {
      projectRoot: store.root,
      loadSessions: () => store.loadAll(),
      saveSessions: (snapshot) => store.saveSnapshot(snapshot),
      importSessions: (legacy) => store.importLegacy(legacy)
    }
    const { dispatch } = createIpcDispatcher({ session })

    const saved = await dispatch(IPC_CHANNELS.sessionsSave, {
      snapshot: { sessions: [{ id: 's-ipc', title: '走通道', updatedAt: clock(), messages: [{ role: 'user', text: '通道里的话' }] }], activeId: 's-ipc' }
    })
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    const loaded = await dispatch(IPC_CHANNELS.sessionsLoad, {})
    assert.equal(loaded.ok, true)
    assert.equal(loaded.value.sessions[0].messages[0].text, '通道里的话')

    const imported = await dispatch(IPC_CHANNELS.sessionsImport, { legacy: { sessions: [] } })
    assert.equal(imported.ok, true)
    assert.equal(imported.value.imported, 0)

    // 没打开项目：三条一律拒绝，不写任何文件。
    const bare = createIpcDispatcher({ session: { projectRoot: null } })
    for (const channel of [IPC_CHANNELS.sessionsLoad, IPC_CHANNELS.sessionsSave, IPC_CHANNELS.sessionsImport]) {
      const rejected = await bare.dispatch(channel, {})
      assert.equal(rejected.ok, false, `${channel} 没有项目时应拒绝`)
    }
  } finally {
    await workspace.cleanup()
  }
})

test('会话 id 直接进文件名：路径逃逸与非安全字符一律拒', async () => {
  const { workspace, root, store } = await freshStore('session-ids')
  try {
    assert.equal(isSessionId('s-main'), true)
    assert.equal(isSessionId('../evil'), false)
    assert.equal(isSessionId('a/b'), false)
    assert.equal(isSessionId(''), false)
    assert.equal(sessionFilePath(root, '../evil'), null)

    const rejected = await store.appendMessage('../evil', { role: 'user', text: '越界' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, 'PINAX_INVALID_INPUT')
    const ensure = await store.ensureSession({ id: '../../etc/passwd', title: '搞事' })
    assert.equal(ensure.ok, false)
    assert.equal(ensure.error.code, 'PINAX_INVALID_INPUT')
  } finally {
    await workspace.cleanup()
  }
})
