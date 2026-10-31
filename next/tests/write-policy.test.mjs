import test from 'node:test'
import assert from 'node:assert/strict'
import { createWritePolicy, normalizeWriteMode, writersForDir } from '../runtime/writePolicy.mjs'
import { isExternalWriteToolName, EXTERNAL_WRITE_HINT } from '../runtime/kernelWriteGuard.mjs'

/**
 * 写策略（M2.5-A · 任务二；批次45 补外部 MCP 写族第三支）。
 * 只证五件事：review 转提案、auto 放行、blocked 点名目录写工具、表外名字不误伤、外部写口按后缀进策略。
 */

const LANDING = {
  pinax_chapter_save: { dir: '正文' },
  pinax_outline_save: { dir: '大纲' },
  pinax_project_init: { structural: true },
  pinax_project_index: { derived: true, writeAction: 'sync' }
}

const call = (name, args = {}) => ({ id: 'c1', name, arguments: args })

test('未知模式回落 review', () => {
  assert.equal(normalizeWriteMode('auto'), 'auto')
  assert.equal(normalizeWriteMode('whatever'), 'review')
  assert.equal(normalizeWriteMode(undefined), 'review')
})

test('review：写工具不执行，转成提案', async () => {
  const created = []
  const policy = createWritePolicy({
    mode: 'review',
    landing: LANDING,
    createProposal: async (request) => {
      created.push(request)
      return { ok: true, value: { id: 'p-1', name: 'p-1.json' } }
    }
  })
  const decided = await policy.beforeTool(call('pinax_outline_save', { nodes: [] }))
  assert.equal(decided.kind, 'proposal')
  assert.equal(decided.proposal.id, 'p-1')
  assert.deepEqual(created[0], { tool: 'pinax_outline_save', args: { nodes: [] }, dir: '大纲' })
})

test('review：提案落盘失败按拒绝回，并带上原始错误码', async () => {
  const policy = createWritePolicy({
    mode: 'review',
    landing: LANDING,
    createProposal: async () => ({ ok: false, error: { code: 'PINAX_IO_FAILED', message: '磁盘满了' } })
  })
  const decided = await policy.beforeTool(call('pinax_chapter_save', {}))
  assert.equal(decided.kind, 'deny')
  assert.equal(decided.code, 'PINAX_IO_FAILED')
  assert.match(decided.message, /磁盘满了/u)
})

test('auto：直接放行，参数原样', async () => {
  const policy = createWritePolicy({ mode: 'auto', landing: LANDING })
  const decided = await policy.beforeTool(call('pinax_chapter_save', { file: 'a.md' }))
  assert.deepEqual(decided, { kind: 'allow', args: { file: 'a.md' } })
})

test('blocked：拒绝并点名写「正文/」的工具', async () => {
  const policy = createWritePolicy({ mode: 'blocked', landing: LANDING })
  const decided = await policy.beforeTool(call('pinax_chapter_save', {}))
  assert.equal(decided.kind, 'deny')
  assert.equal(decided.code, 'WRITE_BLOCKED')
  assert.match(decided.message, /正文\//u)
  assert.match(decided.message, /pinax_chapter_save/u)
})

test('读工具与结构动作不拦', async () => {
  const policy = createWritePolicy({ mode: 'blocked', landing: LANDING })
  assert.equal((await policy.beforeTool(call('pinax_outline_read'))).kind, 'allow')
  assert.equal((await policy.beforeTool(call('pinax_project_init'))).kind, 'allow')
  assert.equal((await policy.beforeTool(call('pinax_project_index'))).kind, 'allow')
})

test('writersForDir 按落点表反查，不手写名单', () => {
  assert.deepEqual(writersForDir('正文', LANDING), ['pinax_chapter_save'])
  assert.deepEqual(writersForDir('大纲', LANDING), ['pinax_outline_save'])
  assert.deepEqual(writersForDir('资料', LANDING), [])
})

/**
 * 批次45：外部 MCP 工具名不在静态落点表里，靠后缀启发式进同一条策略。
 * 这里只验判定与三档行为；真实远端执行与审计缓冲见 write-family-external.test.mjs。
 */
test('外部写口启发式：六种后缀命中，读口与无关名字不命中', () => {
  for (const name of ['db_save', 'asset_write', 'file_import', 'entry_delete', 'note_create', 'row_update']) {
    assert.equal(isExternalWriteToolName(name), true, `${name} 应命中写族`)
  }
  for (const name of ['db_read', 'asset_list', 'echo', 'search', 'fixture.echo_save_extra']) {
    assert.equal(isExternalWriteToolName(name), false, `${name} 不该命中写族`)
  }
  assert.equal(isExternalWriteToolName(undefined), false)
  assert.ok(EXTERNAL_WRITE_HINT.test('echo_save'), '导出的正则是同一份判定依据')
})

test('外部写口：review 转 tool-call 提案（dir 为 null），远端未执行由调用方保证', async () => {
  const created = []
  const policy = createWritePolicy({
    mode: 'review',
    landing: LANDING,
    createProposal: async (request) => {
      created.push(request)
      return { ok: true, value: { id: 'p-ext', name: 'p-ext.json' } }
    }
  })
  const decided = await policy.beforeTool(call('fixture.echo_save', { text: '提案' }))
  assert.equal(decided.kind, 'proposal')
  assert.equal(decided.proposal.id, 'p-ext')
  assert.deepEqual(created[0], { tool: 'fixture.echo_save', args: { text: '提案' }, dir: null })
})

test('外部写口：auto 放行、blocked 拒绝并说明是外部写工具', async () => {
  const auto = createWritePolicy({ mode: 'auto', landing: LANDING })
  assert.deepEqual(await auto.beforeTool(call('fixture.echo_save', { text: '落盘' })), {
    kind: 'allow',
    args: { text: '落盘' }
  })

  const blocked = createWritePolicy({ mode: 'blocked', landing: LANDING })
  const decided = await blocked.beforeTool(call('fixture.echo_save', {}))
  assert.equal(decided.kind, 'deny')
  assert.equal(decided.code, 'WRITE_BLOCKED')
  assert.match(decided.message, /fixture\.echo_save/u)
  assert.match(decided.message, /外部 MCP 写工具/u)
})

test('外部读口不进策略：没有 _save 一类后缀的远端工具照常 allow', async () => {
  const policy = createWritePolicy({ mode: 'blocked', landing: LANDING })
  assert.equal((await policy.beforeTool(call('fixture.echo', { text: 'x' }))).kind, 'allow')
  assert.equal((await policy.beforeTool(call('fixture.add', { a: 1, b: 2 }))).kind, 'allow')
})
