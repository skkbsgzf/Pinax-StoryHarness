import test from 'node:test'
import assert from 'node:assert/strict'
import * as fsp from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import {
  MAX_SESSION_PROPOSALS,
  SESSIONS_DIR,
  SESSION_FILE_SUFFIX,
  SESSION_LINE_TYPES,
  createFileSessionStore,
  foldSessionLines,
  isSessionId,
  sessionFilePath,
  sessionLine
} from '../sessionStore.mjs'
import {
  DEFAULT_SESSION_TITLE,
  MAX_SESSION_MESSAGES,
  MAX_SESSIONS,
  WRITE_MODES
} from '../shell/agentSessions.mjs'
import {
  DEFAULT_SESSION_TITLE as CORE_DEFAULT_SESSION_TITLE,
  MAX_SESSION_MESSAGES as CORE_MAX_SESSION_MESSAGES,
  MAX_SESSIONS as CORE_MAX_SESSIONS,
  WRITE_MODES as CORE_WRITE_MODES
} from '@pinax/core/agent/fileSessionState'
import { clearProjectEvents, subscribeProjectEvents } from '../runtime/eventBus.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T11b：`next/sessionStore.mjs` 对表 @pinax/core 会话规则的单一真源对照。
 *
 * 三件事：
 *   1) 宿主侧只做适配，不再自带一份会话落盘实现（源码级守卫，防第三次分叉）；
 *   2) 落盘形状（目录／后缀／行类型／上限）与渲染层上限仍与 core 同一份事实——
 *      任一侧先动，这条对照先红；
 *   3) core 要的平台能力（fs／回执信封／事件总线）走宿主注入，三根线都真接上。
 */

const clock = () => 1_760_000_000_000

test('宿主适配层不再自带实现：会话规则经 @pinax/core/adapters/fileSessionStore 工厂取用', async () => {
  const source = await readFile(new URL('../sessionStore.mjs', import.meta.url), 'utf-8')
  assert.match(source, /@pinax\/core\/adapters\/fileSessionStore/u, '必须从 core 取会话落盘模块')
  assert.match(source, /createFileSessionStoreModule\s*\(/u, '必须以宿主能力调用 core 的模块工厂')
  for (const marker of [
    'function foldSessionLines',
    'function createFileSessionStore',
    'function normalizeMeta',
    'function sessionLine',
    'SESSION_ID_RE'
  ]) {
    assert.equal(source.includes(marker), false, `宿主侧不应再出现 ${marker}（规则归 core）`)
  }
})

test('落盘形状与上限仍是同一份事实：宿主导出的常量和 core／渲染层一致', () => {
  assert.equal(SESSIONS_DIR, '.pinax/sessions')
  assert.equal(SESSION_FILE_SUFFIX, '.jsonl')
  assert.deepEqual([...SESSION_LINE_TYPES], ['session', 'message', 'event', 'proposal', 'tombstone'])
  assert.equal(MAX_SESSION_PROPOSALS, 100)

  // 渲染层（shell/agentSessions）与 core 会话状态若有一侧先改上限／标题／模式词表，这里先红。
  assert.equal(MAX_SESSIONS, CORE_MAX_SESSIONS)
  assert.equal(MAX_SESSION_MESSAGES, CORE_MAX_SESSION_MESSAGES)
  assert.equal(DEFAULT_SESSION_TITLE, CORE_DEFAULT_SESSION_TITLE)
  assert.deepEqual([...WRITE_MODES], [...CORE_WRITE_MODES])

  assert.equal(isSessionId('s-main'), true)
  assert.equal(sessionFilePath('/根', '../evil'), null)
  const line = sessionLine({ id: 's-1', title: '标题', createdAt: 1, updatedAt: 2, writeMode: 'auto' }, 3)
  assert.deepEqual(Object.keys(line), [
    'type', 'v', 'id', 'title', 'createdAt', 'updatedAt', 'renamed', 'autoTitled',
    'writeMode', 'parent', 'branchChoice', 'ts'
  ])
  const folded = foldSessionLines([
    JSON.stringify(line),
    JSON.stringify({ type: 'message', role: 'user', text: '一句话', ts: 4 })
  ], { file: 's-1.jsonl', fallbackId: 's-1' })
  assert.equal(folded.badLines, 0)
  assert.equal(folded.session.messages.length, 1)
})

test('core 的三根宿主注入线都真接上：注入 fs 被调用、回执用宿主错误码、落盘发项目事件', async () => {
  const workspace = await createTempWorkspace('session-core-wiring')
  const root = await workspace.projectPath('核心接线')
  const calls = []
  const spy = (name, fn) => (...args) => {
    calls.push(name)
    return fn(...args)
  }
  const store = createFileSessionStore({
    root,
    now: clock,
    fs: {
      readdir: spy('readdir', fsp.readdir),
      readFile: spy('readFile', fsp.readFile),
      appendFile: spy('appendFile', fsp.appendFile),
      mkdir: spy('mkdir', fsp.mkdir),
      writeFile: spy('writeFile', fsp.writeFile),
      rename: spy('rename', fsp.rename)
    }
  })
  const events = []
  const unsubscribe = subscribeProjectEvents(root, (event) => events.push(event))

  try {
    const saved = await store.saveSnapshot({
      sessions: [{
        id: 's-core',
        title: '核心接线',
        createdAt: clock(),
        updatedAt: clock(),
        messages: [{ id: 'm-1', role: 'user', text: '注入线要通' }]
      }],
      activeId: 's-core'
    })
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))

    for (const name of ['readdir', 'mkdir', 'readFile', 'writeFile', 'rename']) {
      assert.ok(calls.includes(name), `core 走的 ${name} 必须经宿主注入的 fs`)
    }
    assert.deepEqual(events.map((event) => [event.kind, event.topic]), [['sessions-changed', 'project.changed']])

    // 回执信封也用宿主的：路径逃逸的会话 id 报宿主错误码，而不是 core 的内部形状。
    const rejected = await store.appendMessage('../evil', { role: 'user', text: '越界' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, 'PINAX_INVALID_INPUT')

    const text = await fsp.readFile(sessionFilePath(root, 's-core'), 'utf-8')
    assert.deepEqual(
      text.trim().split('\n').map((item) => JSON.parse(item).type),
      ['session', 'message']
    )
  } finally {
    unsubscribe()
    clearProjectEvents(root)
    await workspace.cleanup()
  }
})
