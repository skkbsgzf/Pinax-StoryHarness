import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FACT_SCHEMA, stableEntryId, validateFactEntry } from '../fact/domain/pediaSchema.js'
import {
  DEFAULT_WRITE_HOOK,
  DRAFT_EXTRACTOR,
  WRITE_HOOK_REGISTRY,
  buildDraftEntriesProposal,
  buildSuggestionProposal,
  createWriteHookRegistry,
  draftEntryForEntity,
  filterMissingEntities
} from '../fact/usecases/hookWiring.js'
import {
  ENTITY_EXTRACTOR,
  extractNamedEntityCandidates,
  mineNamedEntities,
  stripBlueLinkSignals
} from '../fact/usecases/pipeline/mine.js'
import {
  HOOKED_WRITING_ACTIONS,
  FACT_HOOKS_SWITCH_FILE,
  createFactHookService,
  normalizeFactHookSwitch
} from '../shell/factHookService.mjs'
import { WRITING_ACTIONS } from '../shell/writingActions.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'

/**
 * F2（tool-bound 实体补全）：注册表／内容管线／去重／服务／通道五个层次各证一段。
 *   1) 触发面由写工具清单决定，与正文里有没有 @《…》 无关；
 *   2) 实体识别走内容管线（保存文字 → 切段 → 候选），符号先被剥掉；
 *   3) 同一实体重复保存不重复造草案（hub 已有／既有 proposed 草案都跳过并计数）；
 *   4) 保存钩子只在成功后跑，自己失败不许影响已经保存的数据；
 *   5) 通道层：runtimeToolCall 包写工具、runtimeComplete 挂旁注，未注入钩子时行为不变。
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

/** 内存提案目录：写／列／读三个口都与 fileService 同形（去重读的就是后两个）。 */
function fakeFileService(writes) {
  return {
    async writeProposal({ name, text }) {
      writes.push({ name, proposal: JSON.parse(text) })
      return { ok: true, value: { path: `.pinax/proposals/${name}` } }
    },
    async listProposals() {
      return {
        ok: true,
        value: { proposals: writes.map((item) => ({ name: item.name, status: item.proposal.status ?? null })) }
      }
    },
    async readProposal({ name }) {
      const found = writes.find((item) => item.name === name)
      if (!found) return { ok: false, error: { code: 'INVALID_INPUT', message: `提案不存在：${name}` } }
      return { ok: true, value: { name, path: `.pinax/proposals/${name}`, proposal: found.proposal } }
    }
  }
}

function switches(text) {
  return async () => {
    if (text === null) throw enoent()
    return text
  }
}

test('〔F2〕写工具注册表：表内三条有专属配置，表外写口自动落默认钩子', () => {
  assert.equal(WRITE_HOOK_REGISTRY.pinax_chapter_save.kind, 'chapter')
  assert.equal(WRITE_HOOK_REGISTRY.pinax_outline_save.kind, 'outline')
  assert.equal(WRITE_HOOK_REGISTRY.pinax_worldbook_save.kind, 'worldbook')
  assert.equal(WRITE_HOOK_REGISTRY.pinax_worldbook_save.refreshHub, true, '世界书保存要重量 hub 快照')
  assert.equal(WRITE_HOOK_REGISTRY.pinax_chapter_save.refreshHub, false)
  assert.equal(DEFAULT_WRITE_HOOK.kind, 'write')

  const registry = createWriteHookRegistry({ writeTools: ['pinax_chapter_save', 'pinax_material_save'] })
  assert.deepEqual(registry.tools, ['pinax_chapter_save', 'pinax_outline_save', 'pinax_worldbook_save', 'pinax_material_save'])
  assert.equal(registry.isWriteTool('pinax_material_save'), true, '写工具清单里加一行就接上')
  assert.equal(registry.kindOf('pinax_material_save'), 'write')
  assert.equal(registry.isWriteTool('pinax_chapter_read'), false)
  assert.equal(registry.kindOf('pinax_chapter_read'), null)
  assert.equal(registry.textOf('pinax_material_save', { name: '素材1', text: '沈青禾走进旧楼。' }), '沈青禾走进旧楼。', '默认钩子按常见文字字段取样')
})

test('〔F2〕取文字策略：章节取正文、世界书取内容、大纲按节点/边拼字', () => {
  const registry = createWriteHookRegistry({ writeTools: [] })
  assert.equal(registry.textOf('pinax_chapter_save', { text: '他推开门。沈青禾走进旧楼。' }), '他推开门。沈青禾走进旧楼。')
  assert.equal(registry.textOf('pinax_worldbook_save', { content: '规则正文' }), '规则正文')
  assert.equal(
    registry.textOf('pinax_outline_save', {
      nodes: [{ title: '第一章', summary: '遇见沈青禾' }, { title: '第二章', note: '收束' }],
      edges: [{ label: '因果' }]
    }),
    '第一章\n遇见沈青禾\n第二章\n收束\n因果'
  )
  assert.equal(registry.textOf('pinax_chapter_read', { text: '正文' }), '', '非写工具不认')
})

test('〔F2〕内容管线：散文里认出具名实体，@《…》 符号不产生候选', () => {
  const prose = '沈青禾走进旧楼，四下打量。萧寒说道：「有人来过。」'
  const candidates = extractNamedEntityCandidates({ text: prose })
  assert.deepEqual(candidates.map((item) => item.name), ['沈青禾', '萧寒'])
  assert.ok(candidates.every((item) => item.evidence.length >= 1), '候选要带原文证据片段')

  const symbolOnly = '他抬头看 @《旧楼》，又想起 @《无名者》。'
  assert.deepEqual(extractNamedEntityCandidates({ text: symbolOnly }), [], '蓝链符号不驱动实体识别')
  assert.equal(stripBlueLinkSignals(symbolOnly).includes('@'), false)
})

test('〔F2〕内容管线：mineNamedEntities 切段汇总候选，同名按提及次数合并', async () => {
  const result = await mineNamedEntities({ text: '沈青禾走进旧楼。沈青禾说道：「谁在？」' })
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'mineNamedEntities')
  assert.equal(result.extractor, ENTITY_EXTRACTOR)
  const byName = Object.fromEntries(result.candidates.map((item) => [item.name, item]))
  assert.equal(byName['沈青禾'].mentions, 2)
  assert.deepEqual(result.candidates.map((item) => item.name), ['沈青禾'])
})

test('〔F2〕去重：hub 已有（含别名）与既有 proposed 草案都跳过并计数', () => {
  const entries = [worldEntry({ name: '旧楼', aliases: ['钟楼'] })]
  const filtered = filterMissingEntities({
    candidates: ['旧楼', '钟楼', '沈青禾', '沈青禾', '萧寒'],
    entries,
    proposed: ['萧寒']
  })
  assert.deepEqual(filtered.missing, ['沈青禾'])
  assert.deepEqual(filtered.skipped.hub, ['旧楼', '钟楼'])
  assert.deepEqual(filtered.skipped.proposed, ['萧寒'])

  const empty = filterMissingEntities({ candidates: ['旧楼'], entries })
  assert.deepEqual(empty.missing, [])
  assert.deepEqual(empty.skipped, { hub: ['旧楼'], proposed: [] })
})

test('〔F2〕实体草案：worldview/other/proposed/pipelinePending，且过 fact.data/v2 校验', () => {
  const draft = draftEntryForEntity('沈青禾', { domain: DOMAIN, book: DOMAIN, source: 'pinax_chapter_save' })
  assert.equal(draft.layer, 'worldview')
  assert.equal(draft.slot, 'other')
  assert.equal(draft.status, 'proposed')
  assert.equal(draft.pipelinePending, true)
  assert.equal(draft.provenance.mode, 'author')
  assert.equal(draft.provenance.extractor, DRAFT_EXTRACTOR)
  assert.equal(draft.provenance.source, 'pinax_chapter_save')
  assert.equal(draft.id, stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: 'other', name: '沈青禾' }))
  const validation = validateFactEntry(draft)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  assert.equal(draftEntryForEntity('   '), null)
})

test('〔F2〕提案外形：建议提案不带 content，草案提案带 missing／skipped', () => {
  const suggestion = buildSuggestionProposal({ action: 'continue', suggestions: [{ type: 'rhythm-gap' }], id: 'p1' })
  assert.equal(suggestion.schema, 'pinax-proposal@1')
  assert.equal(suggestion.kind, 'fact-suggestions')
  assert.equal(suggestion.status, 'pending')
  assert.equal('content' in suggestion, false)
  assert.match(suggestion.note, /只给建议/)

  const draft = draftEntryForEntity('沈青禾', { domain: DOMAIN })
  const entriesProposal = buildDraftEntriesProposal({
    tool: 'pinax_chapter_save',
    entries: [draft],
    missing: ['沈青禾'],
    skipped: { hub: ['旧楼'], proposed: ['萧寒'] },
    id: 'p2'
  })
  assert.equal(entriesProposal.kind, 'fact-draft-entries')
  assert.deepEqual(entriesProposal.missing, ['沈青禾'])
  assert.deepEqual(entriesProposal.skipped, { hub: ['旧楼'], proposed: ['萧寒'] })
  assert.match(entriesProposal.note, /pipelinePending/)
  assert.match(entriesProposal.note, /已跳过/)
})

test('〔F2〕开关裁决：缺省全开，只认显式 false', () => {
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

test('〔F2〕保存钩子：散文里的具名实体出草案；只有 @《…》 的内容不出草案', async () => {
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
    args: { file: '正文/第001章.md', text: '他推开门。沈青禾走进旧楼，四下打量。' },
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
  assert.deepEqual(proposal.entries.map((entry) => entry.name), ['沈青禾'], '旧楼 hub 已有，不出草案')
  assert.equal(proposal.entries[0].provenance.source, 'pinax_chapter_save')
  assert.equal(validateFactEntry(proposal.entries[0]).ok, true)
  const warn = logs.find((entry) => entry.level === 'warn')
  assert.ok(warn, '缺条目要进通知池')
  assert.equal(warn.source.id, 'fact-hooks')
  assert.match(warn.message, /fact 校验/)

  const symbolOnly = await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '他抬头看 @《旧楼》，又想起 @《新人》。' },
    call: async () => ({ ok: true, value: { revision: 3 } })
  })
  assert.equal(symbolOnly.ok, true)
  assert.equal(writes.length, 1, '@《…》 只是蓝链信号，不再触发 fact 写入')
})

test('〔F2〕去重：同一实体重复保存不重复生成草案，第二次计数跳过', async () => {
  const writes = []
  const logs = []
  const service = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(null),
    snapshotHub: async () => ({ entries: [], book: DOMAIN, note: null }),
    log: (entry) => logs.push(entry)
  })
  const args = { text: '沈青禾走进旧楼，四下打量。' }
  await service.runToolCall({ tool: 'pinax_chapter_save', args, call: async () => ({ ok: true, value: {} }) })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].proposal.entries.map((entry) => entry.name), ['沈青禾'])

  await service.runToolCall({ tool: 'pinax_chapter_save', args, call: async () => ({ ok: true, value: {} }) })
  assert.equal(writes.length, 1, '已有同名 proposed 草案就不再写新提案')
  assert.ok(
    logs.some((entry) => entry.level === 'warn' && /既有草案 1/.test(entry.message)),
    '跳过要计数进通知池'
  )

  const fresh = await service.runToolCall({
    tool: 'pinax_chapter_save',
    args: { text: '萧寒说道：「有人来过。」' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(fresh.ok, true)
  assert.equal(writes.length, 2, '新实体照常出草案')
  assert.deepEqual(writes[1].proposal.entries.map((entry) => entry.name), ['萧寒'])
})

test('〔F2〕新增写口自动覆盖：清单里加一行，material_save 也走同一条内容管线', async () => {
  const writes = []
  const service = createFactHookService({
    getRoot: () => 'D:/书',
    getFileService: () => fakeFileService(writes),
    readSwitchFile: switches(null),
    snapshotHub: async () => ({ entries: [], book: DOMAIN, note: null }),
    writeTools: ['pinax_chapter_save', 'pinax_outline_save', 'pinax_worldbook_save', 'pinax_material_save']
  })
  await service.runToolCall({
    tool: 'pinax_material_save',
    args: { name: '素材1', text: '沈青禾走进旧楼。' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].proposal.entries.map((entry) => entry.name), ['沈青禾'])

  await service.runToolCall({
    tool: 'pinax_material_remove',
    args: { name: '素材1' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(writes.length, 1, '不在清单里的工具原样透传')
})

test('〔F2〕保存钩子不在失败时跑，钩子自身出错也不影响保存回执', async () => {
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
    args: { text: '沈青禾走进旧楼。' },
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

test('〔F2〕世界书保存重新取快照；章节保存不为未变的派生源多读一遍', async () => {
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
    args: { text: '沈青禾走进旧楼。' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(snapshots, 1, '章节不动世界书：保存前那一份就是保存后的快照')

  await service.runToolCall({
    tool: 'pinax_worldbook_save',
    args: { content: '规则正文' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(snapshots, 3, '世界书保存必须 before／after 各取一次')
})

test('〔F2〕开关：整体关闭与单钩子关闭都真的不跑', async () => {
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
    args: { text: '沈青禾走进旧楼。' },
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
    args: { text: '沈青禾走进旧楼。' },
    call: async () => ({ ok: true, value: {} })
  })
  assert.equal(writes.length, 0, '单个钩子关了也不跑')
})

test('〔F2〕续写写建议提案、润色零写入，其他动作不接', async () => {
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

test('〔F2〕钩子动作 id 仍在写作闭集里（防止动作改名后接线悄悄失效）', () => {
  const ids = new Set(WRITING_ACTIONS.map((action) => action.id))
  for (const id of HOOKED_WRITING_ACTIONS) assert.equal(ids.has(id), true, `${id} 不在 WRITING_ACTIONS 里`)
})

test('〔F2〕通道层：runtimeToolCall 包写工具、runtimeComplete 挂旁注；未注入时行为不变', async () => {
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
    args: { text: '沈青禾走进旧楼，四下打量。' }
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

test('〔F2〕通道层：钩子抛错只挂旁注，写作结果照常返回', async () => {
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

test('〔F2〕真链路快照：世界书目录现读成 hub 条目（不落 .pinax/wikihub）', async () => {
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
      args: { text: '沈青禾走进旧楼，四下打量。' },
      call: async () => ({ ok: true, value: { revision: 1 } })
    })
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].proposal.entries.map((entry) => entry.name), ['沈青禾'], '已有条目不许出草案')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('〔F2〕开关文件路径固定在项目 .pinax 下（对作者可见、随项目走）', () => {
  assert.equal(FACT_HOOKS_SWITCH_FILE, '.pinax/fact-hooks.json')
})
