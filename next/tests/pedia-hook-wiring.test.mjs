import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FACT_SCHEMA, stableEntryId, validateFactEntry } from '../fact/domain/pediaSchema.js'
import {
  DRAFT_EXTRACTOR,
  buildDraftEntriesProposal,
  buildSuggestionProposal,
  detectMissingEntities,
  draftEntryForEntity,
  isSaveHookTool,
  textOfSaveArgs
} from '../fact/usecases/hookWiring.js'
import {
  HOOKED_WRITING_ACTIONS,
  FACT_HOOKS_SWITCH_FILE,
  createFactHookService,
  normalizeFactHookSwitch
} from '../shell/factHookService.mjs'
import { WRITING_ACTIONS } from '../shell/writingActions.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'

/**
 * P4（S3 接线）用例：纯接线函数 + 主进程服务 + 通道三个层次各证一段。
 *   1) 保存正文里抽出来的引用，hub 有就放过、没有才出草案；草案必须过 fact.data/v2 校验；
 *   2) 保存钩子只在保存成功后跑，且自己失败不许影响已经保存的数据；
 *   3) 续写写建议提案、润色零写入；开关（整体／单钩子）能真的关掉；
 *   4) 通道层：runtimeToolCall 包保存、runtimeComplete 挂旁注，未注入钩子时行为不变。
 */

const DOMAIN = '停摆之城'

function worldEntry({ name, slot = 'rules', ...rest }) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot, name }),
    layer: 'worldview',
    name,
    domain: DOMAIN,
    slot,
    status: 'adopted',
    definition: `${name} 的设定`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'b1', chapters: [], scenes: [], extractor: 'test/1' },
    ...rest
  }
}

function enoent() {
  const error = new Error('missing')
  error.code = 'ENOENT'
  return error
}

function fakeFileService(writes) {
  return {
    async writeProposal({ name, text }) {
      writes.push({ name, proposal: JSON.parse(text) })
      return { ok: true, value: { path: `.pinax/proposals/${name}` } }
    }
  }
}

function switches(text) {
  return async () => {
    if (text === null) throw enoent()
    return text
  }
}

test('〔P4〕保存文本抽取：章节取正文、世界书取内容、大纲按节点/边拼字', () => {
  assert.equal(textOfSaveArgs('pinax_chapter_save', { text: '他走进 @《旧楼》。' }), '他走进 @《旧楼》。')
  assert.equal(textOfSaveArgs('pinax_worldbook_save', { content: '规则正文' }), '规则正文')
  assert.equal(
    textOfSaveArgs('pinax_outline_save', {
      nodes: [{ title: '第一章', summary: '遇见 @《影子》' }, { title: '第二章', note: '收束' }],
      edges: [{ label: '因果' }]
    }),
    '第一章\n遇见 @《影子》\n第二章\n收束\n因果'
  )
  assert.equal(textOfSaveArgs('pinax_outline_read', { nodes: [] }), '', '非保存工具不认')
  assert.equal(isSaveHookTool('pinax_chapter_save'), true)
  assert.equal(isSaveHookTool('pinax_chapter_read'), false)
})

test('〔P4〕缺失实体：name／aliases 命中的不算缺，未知引用按出现顺序去重', () => {
  const entries = [
    worldEntry({ name: '旧楼', aliases: ['钟楼'] }),
    worldEntry({ name: '影子', slot: 'concepts' })
  ]
  assert.deepEqual(
    detectMissingEntities({ text: '@《旧楼》@《钟楼》@《影子》@《无名者》@《无名者》@《第二个》', entries }),
    ['无名者', '第二个']
  )
  assert.deepEqual(detectMissingEntities({ text: '没有引用', entries }), [])
})

test('〔P4〕实体草案：worldview/other/proposed/pipelinePending，且过 fact.data/v2 校验', () => {
  const draft = draftEntryForEntity('无名者', { domain: DOMAIN, book: DOMAIN })
  assert.equal(draft.layer, 'worldview')
  assert.equal(draft.slot, 'other')
  assert.equal(draft.status, 'proposed')
  assert.equal(draft.pipelinePending, true)
  assert.equal(draft.provenance.mode, 'author')
  assert.equal(draft.provenance.extractor, DRAFT_EXTRACTOR)
  assert.equal(draft.id, stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: 'other', name: '无名者' }))
  const validation = validateFactEntry(draft)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(draftEntryForEntity('   '), null)
})

test('〔P4〕提案外形：建议提案不带 content（不会被当成整章替换），草案提案带 missing', () => {
  const suggestion = buildSuggestionProposal({ action: 'continue', suggestions: [{ type: 'rhythm-gap' }], id: 'p1' })
  assert.equal(suggestion.schema, 'pinax-proposal@1')
  assert.equal(suggestion.kind, 'fact-suggestions')
  assert.equal(suggestion.status, 'pending')
  assert.equal('content' in suggestion, false)
  assert.match(suggestion.note, /只给建议/)

  const draft = draftEntryForEntity('无名者', { domain: DOMAIN })
  const entriesProposal = buildDraftEntriesProposal({ tool: 'pinax_chapter_save', entries: [draft], missing: ['无名者'], id: 'p2' })
  assert.equal(entriesProposal.kind, 'fact-draft-entries')
  assert.deepEqual(entriesProposal.missing, ['无名者'])
  assert.match(entriesProposal.note, /pipelinePending/)
})

test('〔P4〕开关裁决：缺省全开，只认显式 false', () => {
  assert.deepEqual(normalizeFactHookSwitch(null), {
    enabled: true,
    hooks: { onSave: true, onContinue: true, onPolish: true }
  })
  assert.equal(normalizeFactHookSwitch({ enabled: 'no' }).enabled, true, '坏类型不关能力')
  assert.deepEqual(normalizeFactHookSwitch({ enabled: false, hooks: { onSave: false } }), {
    enabled: false,
    hooks: { onSave: false, onContinue: true, onPolish: true }
  })
})

test('〔P4〕保存钩子：成功后跑 diff＋草案提案；引用都有条目不写提案', async () => {
  const entries = [worldEntry({ name: '旧楼' })]
  const writes = []
  const logs = []
  const service = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(null),
    snapshotHub: async () => ({ entries, book: DOMAIN, note: null }),
    log: (entry) => logs.push(entry)
  })

  let called = 0
  const result = await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { file: '正文/第001章.md', text: '他走进 @《旧楼》，提到 @《无名者》。' },
    call: async () => {
      called += 1
      return { ok: true, value: { file: '正文/第001章.md', revision: 2 } }
    }
  })
  assert.equal(called, 1)
  assert.deepEqual(result, { ok: true, value: { file: '正文/第001章.md', revision: 2 } }, '钩子不改保存回执')
  assert.equal(writes.length, 1)
  const proposal = writes[0].proposal
  assert.equal(proposal.kind, 'fact-draft-entries')
  assert.equal(proposal.entries.length, 1)
  assert.equal(proposal.entries[0].name, '无名者')
  assert.equal(validateFactEntry(proposal.entries[0]).ok, true)
  const warn = logs.find((entry) => entry.level === 'warn')
  assert.ok(warn, '预检的 REFERENCE_UNRESOLVED／缺条目要进通知池')
  assert.equal(warn.source.id, 'fact-hooks')
  assert.match(warn.message, /fact 校验/)

  const knownOnly = await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '@《旧楼》' },
    call: async () => ({ ok: true, value: { revision: 3 } })
  })
  assert.equal(knownOnly.ok, true)
  assert.equal(writes.length, 1, '没有缺失实体就不写草案')
})

test('〔P4〕保存钩子不在失败时跑，钩子自身出错也不影响保存回执', async () => {
  const writes = []
  const logs = []
  let snapshots = 0
  const service = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(null),
    snapshotHub: async () => {
      snapshots += 1
      throw new Error('世界书读炸了')
    },
    log: (entry) => logs.push(entry)
  })

  const failed = await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '@《无名者》' },
    call: async () => ({ ok: false, error: { message: '修订号不符' } })
  })
  assert.equal(failed.ok, false)
  assert.equal(writes.length, 0, '保存失败就不该出草案')
  assert.equal(logs.length, 0, '保存失败连钩子日志都不出')

  const succeeded = await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '普通正文' },
    call: async () => ({ ok: true, value: { revision: 1 } })
  })
  assert.equal(succeeded.ok, true, '快照取不到也要把保存回执原样返回')
  assert.equal(snapshots >= 1, true)
  assert.ok(logs.some((entry) => entry.level === 'warn' && /hub 快照没取到/.test(entry.message)))
})

test('〔P4〕世界书保存重新取快照；章节保存不为未变的派生源多读一遍', async () => {
  let snapshots = 0
  const service = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService([]),
    readSwitchFile: switches(null),
    snapshotHub: async () => {
      snapshots += 1
      return { entries: [worldEntry({ name: '旧楼' })], book: DOMAIN, note: null }
    }
  })

  await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '@《旧楼》' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(snapshots, 1, '章节不动世界书：保存前那一份就是保存后的快照')

  await service.runToolCall({
    tool: 'pinax_worldbook_save',
    args: { content: '规则正文 @《旧楼》' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(snapshots, 3, '世界书保存必须 before／after 各取一次')
})

test('〔P4〕开关：整体关闭与单钩子关闭都真的不跑', async () => {
  const writes = []
  const off = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(JSON.stringify({ enabled: false, hooks: { onSave: false } })),
    snapshotHub: async () => ({ entries: [], book: DOMAIN, note: null })
  })
  let called = 0
  const result = await off.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '@《无名者》' },
    call: async () => {
      called += 1
      return { ok: true, value: {} }
    }
  })
  assert.equal(result.ok, true)
  assert.equal(called, 1)
  assert.equal(writes.length, 0, '整体关了就不许写提案')
  assert.equal(await off.afterComplete({ action: 'continue' }), null)

  const onlySaveOff = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(JSON.stringify({ hooks: { onSave: false } })),
    snapshotHub: async () => ({ entries: [], book: DOMAIN, note: null })
  })
  await onlySaveOff.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '@《无名者》' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(writes.length, 0, '单个钩子关了也不跑')
})

test('〔P4〕续写写建议提案、润色零写入，其他动作不接', async () => {
  const writes = []
  const entries = [worldEntry({ name: '旧楼' })]
  const service = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(null),
    snapshotHub: async () => ({ entries, book: DOMAIN, note: null })
  })

  const continued = await service.afterComplete({ action: 'continue', result: { ok: true, value: { text: '正文' } } })
  assert.equal(continued.kind, 'suggestCompletion')
  assert.equal(continued.wroteProposal, true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].proposal.kind, 'fact-suggestions')
  assert.equal('content' in writes[0].proposal, false)

  const polished = await service.afterComplete({ action: 'polish', result: { ok: true, value: { text: '润色后' } } })
  assert.equal(polished.kind, 'readOnlyQuery')
  assert.equal(polished.wroteProposal, false)
  assert.equal(writes.length, 1, '润色不许写任何提案／数据')

  assert.equal(await service.afterComplete({ action: 'rewrite' }), null)
  assert.equal(await service.afterComplete({ action: '' }), null)
})

test('〔P4〕钩子动作 id 仍在写作闭集里（防止动作改名后接线悄悄失效）', () => {
  const ids = new Set(WRITING_ACTIONS.map((action) => action.id))
  for (const id of HOOKED_WRITING_ACTIONS) assert.equal(ids.has(id), true, `${id} 不在 WRITING_ACTIONS 里`)
})

test('〔P4〕通道层：runtimeToolCall 包保存、runtimeComplete 挂旁注；未注入时行为不变', async () => {
  const writes = []
  const session = {
    kernel: {},
    registry: null,
    projectRoot: 'D:/书',
    runtime: {
      async callTool(tool, args) {
        return { ok: true, value: { tool, args } }
      }
    }
  }
  const factHooks = createFactHookService({
    getRoot: () => session.projectRoot,
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(null),
    snapshotHub: async () => ({ entries: [], book: DOMAIN, note: null })
  })
  const dispatcher = createIpcDispatcher({
    session,
    factHooks,
    writingComplete: {
      async run({ action }) {
        return { ok: true, value: { action, text: '续写结果' } }
      }
    }
  })

  const saved = await dispatcher.dispatch(IPC_CHANNELS.runtimeToolCall, {
    tool: 'pinax_chapter_save',
    args: { text: '@《新面孔》' }
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.tool, 'pinax_chapter_save', '保存回执原样')
  assert.equal(writes.length, 1, '通道侧真的把保存送进了钩子')

  const completed = await dispatcher.dispatch(IPC_CHANNELS.runtimeComplete, { action: 'continue', text: '上文' })
  assert.equal(completed.ok, true)
  assert.equal(completed.value.text, '续写结果')
  assert.equal(completed.value.factHook.kind, 'suggestCompletion')

  const unwired = createIpcDispatcher({
    session,
    writingComplete: { async run() { return { ok: true, value: { text: '原样' } } } }
  })
  const plain = await unwired.dispatch(IPC_CHANNELS.runtimeComplete, { action: 'continue', text: '上文' })
  assert.deepEqual(plain, { ok: true, value: { text: '原样' } }, '未注入钩子时回执逐字不变')
  const plainTool = await unwired.dispatch(IPC_CHANNELS.runtimeToolCall, { tool: 'pinax_chapter_read', args: {} })
  assert.deepEqual(plainTool, { ok: true, value: { tool: 'pinax_chapter_read', args: {} } })
})

test('〔P4〕通道层：钩子抛错只挂旁注，写作结果照常返回', async () => {
  const session = { kernel: {}, registry: null, projectRoot: 'D:/书', runtime: null }
  const dispatcher = createIpcDispatcher({
    session,
    writingComplete: { async run() { return { ok: true, value: { text: '照常写' } } } },
    factHooks: {
      async afterComplete() {
        throw new Error('钩子炸了')
      }
    }
  })
  const result = await dispatcher.dispatch(IPC_CHANNELS.runtimeComplete, { action: 'continue', text: '上文' })
  assert.equal(result.ok, true)
  assert.equal(result.value.text, '照常写')
  assert.equal(result.value.factHook.error, '钩子炸了')
})

test('〔P4〕真链路快照：世界书目录现读成 hub 条目（不落 .pinax/wikihub）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fact-hook-'))
  try {
    await mkdir(join(root, '世界书', '设定'), { recursive: true })
    await writeFile(join(root, '世界书', '设定', '旧楼.md'), '旧楼是钟楼。', 'utf8')
    const writes = []
    const service = createFactHookService({
      getRoot: () => root,
      getFileService: () => fakeFileService(writes)
      // snapshotHub／readSwitchFile 都不注入：走默认「读世界书 → 转 hub」，开关文件缺失按全开。
    })
    const snapshot = await service.snapshot(root)
    assert.deepEqual(snapshot.entries.map((entry) => entry.name), ['旧楼'])
    assert.equal(snapshot.note, null)

    await service.runToolCall({
      tool: 'pinax_chapter_save',
      args: { text: '他抬头看 @《旧楼》，又想起 @《新人》。' },
      call: async () => ({ ok: true, value: { revision: 1 } })
    })
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].proposal.entries.map((entry) => entry.name), ['新人'], '已有条目不许出草案')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('〔P4〕开关文件路径固定在项目 .pinax 下（对作者可见、随项目走）', () => {
  assert.equal(FACT_HOOKS_SWITCH_FILE, '.pinax/fact-hooks.json')
})
