import test from 'node:test'
import assert from 'node:assert/strict'
import { applyProposal, buildToolCallProposal, createProposalStore, proposalFileName } from '../runtime/proposalStore.mjs'

/**
 * 提案的调用重放（M2.5-A · 任务三）。
 * 四件事：形状、章节兼容 content、STALE 时不调工具、一致时换 expectedRevision。
 */

function fakeFileService() {
  const written = []
  return {
    written,
    async writeProposal({ name, text }) {
      written.push({ name, text })
      return { ok: true, value: { path: `/proj/.pinax/proposals/${name}` } }
    }
  }
}

const fixedClock = () => new Date(2026, 9, 29, 12, 1, 0)

test('文件名由时间、工具短名与后缀组成', () => {
  assert.equal(
    proposalFileName({ tool: 'pinax_outline_save', at: fixedClock(), suffix: 'ab12' }),
    '20261029-120100-outline_save-ab12.json'
  )
})

test('提案 JSON 带 tool/args/baseRevision/status，写盘只走 writeProposal', async () => {
  const fileService = fakeFileService()
  const store = createProposalStore({ fileService, now: fixedClock, suffix: () => 'abcd' })
  const created = await store.create({
    tool: 'pinax_outline_save',
    args: { nodes: [], edges: [], expectedRevision: 12 },
    baseRevision: 12,
    summary: '合并第二卷三个重复支线',
    runId: 'ask-1'
  })
  assert.equal(created.ok, true)
  assert.equal(fileService.written.length, 1)
  const parsed = JSON.parse(fileService.written[0].text)
  assert.equal(parsed.schema, 'pinax-proposal@1')
  assert.equal(parsed.kind, 'tool-call')
  assert.equal(parsed.tool, 'pinax_outline_save')
  assert.equal(parsed.baseRevision, 12)
  assert.equal(parsed.status, 'pending')
  assert.equal(parsed.summary, '合并第二卷三个重复支线')
  assert.equal(parsed.id, '20261029-120100-outline_save-abcd')
})

test('章节类提案同时写 content 与 target，老 UI 还能采纳', () => {
  const proposal = buildToolCallProposal({
    tool: 'pinax_chapter_save',
    args: { file: '正文/第一卷/第一章.md', text: '新的一版', expectedRevision: 3 },
    baseRevision: 3,
    id: 'p-2',
    createdAt: '2026-10-29T12:00:00.000Z'
  })
  assert.equal(proposal.content, '新的一版')
  assert.equal(proposal.contentChars, 4)
  assert.deepEqual(proposal.target, { file: '正文/第一卷/第一章.md', chars: 4 })
})

test('重放：revision 不一致如实 STALE，且一次工具都不调', async () => {
  let called = 0
  const result = await applyProposal(
    { id: 'p-3', tool: 'pinax_outline_save', args: { nodes: [] }, baseRevision: 12 },
    {
      callTool: async () => { called += 1; return { ok: true, value: {} } },
      readRevision: async () => ({ ok: true, value: 13 })
    }
  )
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PINAX_STALE_REVISION')
  assert.equal(called, 0)
})

test('重放：revision 一致时把 expectedRevision 换成当前值再调工具', async () => {
  const seen = []
  const result = await applyProposal(
    { id: 'p-4', tool: 'pinax_outline_save', args: { nodes: [], expectedRevision: 12 }, baseRevision: 12 },
    {
      callTool: async (name, args) => { seen.push({ name, args }); return { ok: true, value: { revision: 13 } } },
      readRevision: async () => ({ ok: true, value: 12 })
    }
  )
  assert.equal(result.ok, true)
  assert.equal(seen[0].name, 'pinax_outline_save')
  assert.equal(seen[0].args.expectedRevision, 12)
})

test('没有 tool 的提案（老正文提案）走自己的采纳口，不在这里重放', async () => {
  const result = await applyProposal({ id: 'p-5', content: '正文' }, { callTool: async () => ({ ok: true }) })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PINAX_INVALID_INPUT')
})
