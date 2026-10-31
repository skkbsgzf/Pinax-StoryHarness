import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import ExternalAppHost from '../shell/ExternalAppHost.vue'
import CenterSlotHost from '../shell/CenterSlotHost.vue'
import RuntimeDock from '../shell/RuntimeDock.vue'
import { useBoardData } from '../shell/useBoardData.mjs'
import { IPC_CHANNELS, IPC_EVENT } from '../shell/ipcContract.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'

/**
 * M2 批次 4 之后的载体面板测试：目录树在索引窗，正文在核心区，两者共用同一份板块数据。
 * 这里的 fake 是「载体工具的信封」形状（{ok, value:{tool, owner, payload}}），
 * 与 next/tests/carrier-*.test.mjs 里真载体的返回一致——面板改读法而不改通道，这里就会红。
 */

function carrierCarriers() {
  // 协议 v1.1-A：一个载体＝竖条一格＝一棵纯粹的本域内容树（六栏）。
  return [
    { id: 'pinax.carrier.novel', title: '小说', isPrimary: true, isEnabled: true, dataDirs: ['正文'], scopes: ['file:正文:rw', 'agent:ask'], tools: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard'], context: { providers: ['selection'], budgetChars: 24000 }, capabilities: ['text.chapters'], panes: [{ slot: 'left-dock', id: 'novel.shelf', title: '书稿' }, { slot: 'center', id: 'novel.editor', title: '正文' }] },
    { id: 'pinax.carrier.outline', title: '大纲', isPrimary: false, isEnabled: true, dataDirs: ['大纲'], scopes: ['file:大纲:rw', 'agent:ask'], tools: ['pinax_outline_read', 'pinax_outline_save'], context: { providers: ['outline'], budgetChars: 20000 }, capabilities: ['outline.tree'], panes: [{ slot: 'left-dock', id: 'outline.tree', title: '大纲树' }, { slot: 'center', id: 'outline.editor', title: '大纲编辑' }] },
    { id: 'pinax.carrier.notes', title: '构思', isPrimary: false, isEnabled: true, dataDirs: ['构思'], scopes: ['file:构思:rw', 'agent:ask'], tools: ['pinax_notes_list', 'pinax_notes_save'], context: { providers: [], budgetChars: 20000 }, capabilities: ['notes.ideas'], panes: [{ slot: 'left-dock', id: 'notes.list', title: '构思清单' }, { slot: 'center', id: 'notes.editor', title: '构思编辑' }] },
    { id: 'pinax.carrier.worldbook', title: '世界书', isPrimary: false, isEnabled: true, dataDirs: ['世界书'], scopes: ['file:世界书:rw', 'agent:ask'], tools: ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'], context: { providers: ['worldbook'], budgetChars: 20000 }, capabilities: ['setting.entries'], panes: [{ slot: 'left-dock', id: 'worldbook.board', title: '世界书板', view: 'pinax.view.tree', kind: 'entries-categories' }, { slot: 'center', id: 'worldbook.entries', title: '条目', view: 'pinax.view.board', kind: 'entries-workspace' }] },
    { id: 'pinax.carrier.script', title: '剧本', isPrimary: false, isEnabled: true, dataDirs: ['剧本'], scopes: ['file:剧本:rw', 'agent:ask'], tools: ['pinax_script_list', 'pinax_script_read', 'pinax_script_save'], context: { providers: ['script', 'references'], budgetChars: 12000 }, capabilities: ['script.scenes'], panes: [{ slot: 'left-dock', id: 'script.board', title: '剧本板' }, { slot: 'center', id: 'script.editor', title: '剧本' }] },
    { id: 'pinax.carrier.setting', title: '设定', isPrimary: false, isEnabled: true, dataDirs: ['约束'], scopes: ['file:约束:rw', 'agent:ask'], tools: ['pinax_rule_list', 'pinax_rule_save'], context: { providers: ['rules', 'style'], budgetChars: 20000 }, capabilities: ['constraint.rules'], panes: [{ slot: 'left-dock', id: 'setting.board', title: '设定板' }, { slot: 'center', id: 'setting.rules', title: '约束' }] },
    { id: 'pinax.carrier.reference', title: '资料', isPrimary: false, isEnabled: true, dataDirs: ['资料'], scopes: ['file:资料:rw', 'agent:ask'], tools: ['pinax_document_list', 'pinax_document_read', 'pinax_document_save'], context: { providers: ['references'], budgetChars: 12000 }, capabilities: ['reference.documents'], panes: [{ slot: 'left-dock', id: 'reference.board', title: '资料板' }, { slot: 'center', id: 'reference.documents', title: '资料' }] }
  ]
}

/**
 * 提案夹具（工单A）：形状照 server/mcp/chapterProposals.js 的 pinax-proposal@1。
 * createdAt 用本地时刻（不带 Z），索引窗的短格式在哪种时区下都该显示 10-28 14:00。
 */
const PROPOSAL = {
  name: '20261028T140000-ch1-abcdef12.json',
  id: '20261028T140000-ch1-abcdef12',
  status: 'proposed',
  target: { index: 1, title: '第002章-雨夜', file: '正文/第002章.md', chars: 8 },
  content: '雨从檐口滴下来，巷子里没人。',
  contentChars: 14,
  note: '把雨提前一段',
  createdAt: '2026-10-28T14:00:00'
}

function fakeTools({ stale = false, chapterCount = 2, chapterText = '雨从檐口滴下来。', chapterTruncated = false, outlineMissing = false, outlineEdges = null, outlineNodes = null, notes = [], proposals = [], rules = [], documents = [], scripts = [], entries = null } = {}) {
  const state = {
    revision: 1,
    text: chapterText,
    saved: null,
    proposals: proposals.map((item) => ({ ...item })),
    chapters: Array.from({ length: chapterCount }, (_item, index) => ({ index, title: `第00${index + 1}章`, file: `正文/第00${index + 1}章.md`, name: `第00${index + 1}章.md`, revision: 1 })),
    outlineNodes: outlineNodes ?? [
      // 节点备注也是 md（大纲面的阅读态渲染的就是它）。
      { id: 'n1', title: '开场：雨夜进城', note: '## 这一节要写什么\n\n雨落进巷子，**灯**灭了。\n\n- 一条路\n- 两条路\n' },
      { id: 'n2', title: '第一折：停摆的表' }
    ],
    outlineEdges: outlineEdges ?? [{ from: 'n1', to: 'n2' }],
    outlineRevision: 1,
    notes,
    rules: rules.map((item) => ({ ...item })),
    documents: documents.map((item) => ({ ...item })),
    scripts: scripts.map((item) => ({ ...item })),
    entries: entries ?? [
      { id: 'wb-1', name: '人物·柯秒', type: 'character', tags: ['主角'], aliases: ['柯秒'], chars: 18, path: '世界书/人物·柯秒.md', revision: 1, contract: true, summary: '雪夜醒来的主角，袖中有一枚停摆的表。' },
      { id: null, name: '随手记', type: 'general', tags: [], aliases: [], chars: 9, path: '世界书/随手记.md', revision: 1, contract: false }
    ]
  }
  const calls = []
  async function request(channel, payload) {
    if (channel === IPC_CHANNELS.runtimeToolCall) {
      calls.push({ tool: payload.tool, args: payload.args })
      if (payload.tool === 'pinax_chapter_list') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, total: state.chapters.length, truncated: false, chapters: state.chapters } } }
      if (payload.tool === 'pinax_chapter_read') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, chapter: { index: 1, title: '第002章', file: payload.args.file ?? '正文/第002章.md' }, text: state.text, totalChars: state.text.length, truncated: chapterTruncated, revision: state.revision } } }
      if (payload.tool === 'pinax_chapter_save') {
        if (stale || payload.args.expectedRevision !== state.revision) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${payload.args.file}」已被改动（第 ${state.revision} 版）`, details: { actual: state.revision } } } }
        }
        state.revision += 1
        state.saved = { file: payload.args.file ?? `正文/${payload.args.title}.md`, text: payload.args.text, revision: state.revision }
        state.text = payload.args.text
        // 与真工具同一口径：带 proposal 的保存成功后，把那份提案标成 adopted（元数据写回，不删文件）。
        const adopted = payload.args.proposal ? state.proposals.find((item) => item.name === payload.args.proposal) : null
        if (adopted) adopted.status = 'adopted'
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, file: state.saved.file, revision: state.revision, created: payload.args.expectedRevision === 0, bytes: state.saved.text.length, ...(adopted ? { proposal: { name: adopted.name, status: adopted.status } } : {}) } } }
      }
      if (payload.tool === 'pinax_proposal_list') {
        // 列表只给摘要（不含 content）：审阅面的正文必须真的走一次 read。
        const summaries = state.proposals.map((item) => ({
          name: item.name,
          kind: 'proposal',
          schema: 'pinax-proposal@1',
          id: item.id ?? item.name.replace(/\.json$/iu, ''),
          status: item.status ?? 'proposed',
          target: item.target ?? { index: null, title: null, file: null },
          contentChars: item.contentChars ?? item.content?.length ?? 0,
          createdAt: item.createdAt ?? null,
          note: item.note ?? null
        }))
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, total: summaries.length, rawTotal: 0, raw: [], warnings: [], proposals: summaries } } }
      }
      if (payload.tool === 'pinax_proposal_read') {
        const hit = state.proposals.find((item) => item.name === payload.args.name)
        if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: `提案不存在：${payload.args.name}` } } }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, name: hit.name, path: `.pinax/proposals/${hit.name}`, proposal: { schema: 'pinax-proposal@1', id: hit.id, status: hit.status ?? 'proposed', target: hit.target, content: hit.content, contentChars: hit.contentChars ?? hit.content.length, note: hit.note ?? null, createdAt: hit.createdAt ?? null } } } }
      }
      if (payload.tool === 'pinax_proposal_discard') {
        const index = state.proposals.findIndex((item) => item.name === payload.args.name)
        if (index < 0) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: `提案不存在：${payload.args.name}` } } }
        state.proposals.splice(index, 1)
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, discarded: true, name: payload.args.name } } }
      }
      if (payload.tool === 'pinax_notes_list') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, total: state.notes.length, truncated: false, notes: state.notes } } }
      if (payload.tool === 'pinax_notes_save') {
        // 与真工具同一套并发闸：盘上第几版就带第几版来写，新建传 0。
        const file = payload.args.file ?? `构思/${payload.args.title}.md`
        const hit = state.notes.find((item) => item.file === file)
        const actual = hit?.revision ?? 0
        if (stale || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${file}」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        const revision = actual + 1
        if (hit) {
          hit.revision = revision
          hit.text = payload.args.text
          hit.totalChars = payload.args.text.length
          hit.truncated = false
        } else {
          state.notes.push({ index: state.notes.length, title: String(payload.args.title ?? '').replace(/\.md$/iu, ''), file, name: `${payload.args.title}.md`, revision, text: payload.args.text, totalChars: payload.args.text.length, truncated: false })
        }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, file, revision, created: payload.args.expectedRevision === 0, bytes: payload.args.text.length } } }
      }
      if (payload.tool === 'pinax_worldbook_list') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: true, total: state.entries.length, truncated: false, warnings: ['1 个世界书文件不符合文件契约（无 frontmatter 或缺 id），按整篇正文收录。'], skippedDirs: ['世界书/伏笔'], entries: state.entries } } }
      if (payload.tool === 'pinax_worldbook_read') {
        // 批次34：索引窗按 path 打开条目（同一名字可住在两个类别目录里）。
        const hit = state.entries.find((item) => (payload.args.path && item.path === payload.args.path) || (item.id && item.id === payload.args.id) || (payload.args.name && (item.name === payload.args.name || item.name.includes(payload.args.name))))
        if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '「世界书/」里没有 查无此人' } } }
        const content = hit.savedText ?? hit.content ?? (hit.name === '随手记' ? '一些还没整理的设定碎句。' : '冷穿越剧版主角，醒来在雪夜。')
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: true, entry: { ...hit, relations: Array.isArray(hit.relations) ? hit.relations : [], keys: hit.aliases ?? hit.keys ?? [], content, contentChars: content.length, contentTruncated: false }, warnings: hit.contract ? [] : ['条目「随手记」未按世界书文件契约建档（未找到 frontmatter），返回的是整篇正文。'] } } }
      }
      if (payload.tool === 'pinax_worldbook_save') {
        const hit = state.entries.find((item) => item.path === payload.args.path)
        const actual = hit?.revision ?? 0
        if (!hit || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${payload.args.path}」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        hit.revision += 1
        hit.savedText = payload.args.text
        // 与真工具同一套 meta 语义（收口包②）：keys／tags 覆盖 aliases／tags，summary 原样覆盖（空串＝清空）。
        if (payload.args.meta) {
          if (Array.isArray(payload.args.meta.keys)) hit.aliases = payload.args.meta.keys
          if (Array.isArray(payload.args.meta.tags)) hit.tags = payload.args.meta.tags
          if (typeof payload.args.meta.summary === 'string') hit.summary = payload.args.meta.summary
        }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: true, file: hit.path, revision: hit.revision, created: payload.args.expectedRevision === 0, bytes: payload.args.text.length } } }
      }
      if (payload.tool === 'pinax_rule_list') {
        // 工单E2：与真工具同一形状——列表把全文随手带回（判据：点开不再发第二次读）。
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: true, total: state.rules.length, truncated: false, projectRoot: 'D:/tmp/大梦', rules: state.rules } } }
      }
      if (payload.tool === 'pinax_rule_save') {
        const file = payload.args.file ?? `约束/${payload.args.title}.md`
        const hit = state.rules.find((item) => item.file === file)
        const actual = hit?.revision ?? 0
        if (stale || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${file}」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        const revision = actual + 1
        if (hit) {
          hit.revision = revision
          hit.text = payload.args.text
          hit.totalChars = payload.args.text.length
          hit.truncated = false
        } else {
          state.rules.push({ index: state.rules.length, title: String(payload.args.title ?? '').replace(/\.md$/iu, ''), file, name: `${payload.args.title}.md`, revision, text: payload.args.text, totalChars: payload.args.text.length, truncated: false })
        }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: true, file, revision, created: payload.args.expectedRevision === 0, bytes: payload.args.text.length } } }
      }
      if (payload.tool === 'pinax_document_list') {
        // 工单G1：与真工具同一形状——列表把正文随手带回（判据：点开只再发一次 read 取全文）。
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.reference', payload: { ok: true, total: state.documents.length, truncated: false, documents: state.documents } } }
      }
      if (payload.tool === 'pinax_document_read') {
        const hit = state.documents.find((item) => item.file === payload.args.file || (payload.args.index !== undefined && item.index === payload.args.index))
        if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.reference', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: `找不到资料：${payload.args.file ?? payload.args.index}` } } }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.reference', payload: { ok: true, document: { index: hit.index, title: hit.title, file: hit.file, name: hit.name, revision: hit.revision }, text: hit.text, maxChars: payload.args.maxChars ?? 50_000, totalChars: hit.totalChars, truncated: false, revision: hit.revision } } }
      }
      if (payload.tool === 'pinax_document_save') {
        const file = payload.args.file ?? `资料/${payload.args.title}.md`
        const hit = state.documents.find((item) => item.file === file)
        const actual = hit?.revision ?? 0
        if (stale || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.reference', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${file}」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        const revision = actual + 1
        if (hit) {
          hit.revision = revision
          hit.text = payload.args.text
          hit.totalChars = payload.args.text.length
          hit.truncated = false
        } else {
          state.documents.push({ index: state.documents.length, title: String(payload.args.title ?? '').replace(/\.(?:md|txt)$/iu, ''), file, name: file.split('/').pop(), revision, text: payload.args.text, totalChars: payload.args.text.length, truncated: false })
        }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.reference', payload: { ok: true, file, revision, created: payload.args.expectedRevision === 0, bytes: payload.args.text.length } } }
      }
      if (payload.tool === 'pinax_script_list') {
        // 批次26：与真工具同一形状（剧本篇目＋正文随手带回）。
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.script', payload: { ok: true, total: state.scripts.length, truncated: false, scripts: state.scripts } } }
      }
      if (payload.tool === 'pinax_script_read') {
        const hit = state.scripts.find((item) => item.file === payload.args.file || (payload.args.index !== undefined && item.index === payload.args.index))
        if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.script', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: `找不到剧本：${payload.args.file ?? payload.args.index}` } } }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.script', payload: { ok: true, script: { index: hit.index, title: hit.title, file: hit.file, name: hit.name, revision: hit.revision }, text: hit.text, maxChars: payload.args.maxChars ?? 50_000, totalChars: hit.totalChars, truncated: false, revision: hit.revision } } }
      }
      if (payload.tool === 'pinax_script_save') {
        const file = payload.args.file ?? `剧本/${payload.args.title}.md`
        const hit = state.scripts.find((item) => item.file === file)
        const actual = hit?.revision ?? 0
        if (stale || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.script', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${file}」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        const revision = actual + 1
        if (hit) {
          hit.revision = revision
          hit.text = payload.args.text
          hit.totalChars = payload.args.text.length
          hit.truncated = false
        } else {
          state.scripts.push({ index: state.scripts.length, title: String(payload.args.title ?? '').replace(/\.md$/iu, ''), file, name: file.split('/').pop(), revision, text: payload.args.text, totalChars: payload.args.text.length, truncated: false })
        }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.script', payload: { ok: true, file, revision, created: payload.args.expectedRevision === 0, bytes: payload.args.text.length } } }
      }
      if (payload.tool === 'pinax_outline_read') {
        // 与真工具同一条口径：大纲目录空着（既没有 outline.json 也没有 大纲.md）就按 INVALID_INPUT 拒。
        if (outlineMissing) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '「大纲/」下既没有 outline.json 也没有 大纲.md' } } }
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, source: '大纲/outline.json', nodes: state.outlineNodes, edges: state.outlineEdges, nodeTotal: state.outlineNodes.length, truncated: false, revision: state.outlineRevision, warning: null } } }
      }
      if (payload.tool === 'pinax_outline_save') {
        // 与真工具同一套并发闸：盘上第几版就带第几版来写，整份覆盖不合并。
        const actual = state.outlineRevision
        if (!Array.isArray(payload.args?.nodes) || !payload.args.nodes.length) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: 'nodes 必须是非空数组（整份覆盖，不收增量）' } } }
        }
        if (stale || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「大纲/outline.json」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        state.outlineRevision += 1
        state.outlineNodes = JSON.parse(JSON.stringify(payload.args.nodes))
        state.outlineEdges = JSON.parse(JSON.stringify(payload.args.edges ?? []))
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, file: '大纲/outline.json', revision: state.outlineRevision, nodeTotal: state.outlineNodes.length, bytes: JSON.stringify(payload.args.nodes).length } } }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的工具：${payload.tool}` } }
    }
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
  }
  return { request, calls, state }
}

function paneOf(id) {
  // 协议 v1.1-A：pane id 前缀＝载体（一载体一棵本域内容树）。
  const prefix = String(id).split('.')[0]
  const carrierId = `pinax.carrier.${prefix}`
  const carrier = carrierCarriers().find((item) => item.id === carrierId)
  const declared = carrier.panes.find((pane) => pane.id === id) ?? { slot: 'center', id, title: id }
  return { ...declared, pluginId: carrierId, pluginTitle: carrier.title, primary: carrierId === 'pinax.carrier.novel' }
}

function shellView(extra = {}) {
  return {
    kernel: { contractVersion: '1', kinds: ['novel', 'screenplay', 'generic'] },
    project: { root: 'D:/tmp/大梦', name: '大梦', kind: 'novel', spec: 'pinax-project@2', revision: 1 },
    needsPrimary: false,
    openError: null,
    rejected: [],
    primary: { id: 'pinax.carrier.novel', title: '小说', primary: { projectKind: 'novel' } },
    carriers: carrierCarriers(),
    left: [paneOf('novel.shelf'), paneOf('outline.tree'), paneOf('notes.list'), paneOf('worldbook.board'), paneOf('script.board'), paneOf('setting.board'), paneOf('reference.board')],
    center: [paneOf('novel.editor'), paneOf('outline.editor'), paneOf('notes.editor'), paneOf('worldbook.entries'), paneOf('script.editor'), paneOf('setting.rules'), paneOf('reference.documents')],
    skeletonDirs: ['正文', '大纲', '世界书', '构思', '资料', '日志', '约束'],
    archive: [],
    runtime: {
      title: RUNTIME_CONTRACT.title, builtIn: true, disableable: false, ownsSlot: 'right', budgetPriority: 100,
      writeSurface: RUNTIME_CONTRACT.writeSurface, reservedSlotReason: '右栏归运行时',
      started: true,
      surface: { carrierTools: 19, carrierToolNames: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_outline_read', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save', 'pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search'], aggregated: true, missingImplementations: [] },
      tools: [
        { name: 'pinax_chapter_read', title: 'pinax_chapter_read', owner: 'pinax.carrier.novel' },
        { name: 'pinax_worldbook_list', title: 'pinax_worldbook_list', owner: 'pinax.carrier.worldbook' },
        { name: 'pinax_project_list', title: 'pinax_project_list', owner: 'kernel' }
      ]
    },
    ...extra
  }
}

function bridgeStub(view, extra = {}) {
  const request = vi.fn(async (channel, payload) => {
    if (channel === IPC_CHANNELS.view) return { ok: true, value: view }
    const handler = extra[channel]
    if (handler) return handler(payload)
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
  })
  return { request, channels: IPC_CHANNELS }
}

/**
 * 换板（协议 v1.1-A）：点竖条那一格，索引窗与核心区一起换成本载体的树/面。
 * 板标题就是 manifest.title；同一块板再点一次是收起索引窗，所以这里只点一次。
 */
async function openBoard(wrapper, title) {
  const item = wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === title)
  expect(item, `图标竖条应有「${title}」这一格`).toBeTruthy()
  await item.trigger('click')
  await flushPromises()
}

/**
 * 打开统一二级页的「文档 → 提案审阅」节（工单B1）：走页内菜单的同一份 MENU_TEMPLATE，
 * 点「项目 → 提案审阅…」——与用户真点的那条路一致，不直接调外壳内部函数。
 */
async function openProposalsSection(wrapper) {
  const trigger = wrapper.findAll('.nx-menu-trigger').find((node) => node.text() === '项目')
  expect(trigger, '页内菜单有「项目」组').toBeTruthy()
  await trigger.trigger('click')
  await flushPromises()
  const item = wrapper.find('[data-menu-id="project.reviewProposals"]')
  expect(item.exists(), '菜单里有「提案审阅…」').toBe(true)
  await item.trigger('click')
  await flushPromises()
}

/**
 * 批次43：正文／构思／大纲／约束四个面默认落在阅读态（md 渲染过的一篇文），
 * 要动编辑区先按头部那枚「编辑」。这里把这一步收成一行，测试里不重复写。
 */
async function enterEditing(wrapper, testId = 'chapter-edit') {
  const button = wrapper.find(`[data-test="${testId}"]`)
  if (button.exists()) await button.trigger('click')
  await flushPromises()
}

describe('小说载体', () => {
  it('索引窗列章节、核心区是正文编辑器；所有取数只走 runtimeToolCall 一条通道', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    expect(tools.calls[0].tool).toBe('pinax_chapter_list')
    expect(tools.calls.some((call) => call.tool === 'pinax_chapter_read')).toBe(true)
    // 目录树在索引窗，正文在核心区——两者不再挤在同一块。
    // 协议 v1.1-A：小说板只有正文一棵内容树（2 章节行）；大纲/构思是别的栏，不在这里列。
    expect(wrapper.findAll('.nx-index-window .nx-tree-item')).toHaveLength(2)
    expect(tools.calls.some((call) => call.tool === 'pinax_outline_read')).toBe(false)
    expect(tools.calls.some((call) => call.tool === 'pinax_notes_list')).toBe(false)
    expect(wrapper.find('.nx-index-window').findAll('.workspace-nav-section').map((node) => node.text())).not.toContain('大纲')
    expect(wrapper.find('[data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-pane-id="novel.shelf"]').exists()).toBe(false)
    // 批次43：正文面默认是阅读态——正文是 md 稿子，渲染出来，不再是裸源码。
    expect(wrapper.find('.editor-area').exists()).toBe(false)
    expect(wrapper.find('[data-test="chapter-rendered"]').text()).toBe('雨从檐口滴下来。')
    // 批次43：路径 · 版本这些开发者信息不再摆在文档面上（作者 2026-10-31）。
    const pane = wrapper.find('[data-pane-id="novel.editor"]')
    expect(pane.text()).not.toContain('第 1 版')
    expect(pane.text()).not.toContain('正文/第002章.md')
    wrapper.unmount()
  })

  it('文档头归一（批次33 → 批次43）：头部只有一行 .doc-title；底部那行只在有话可说时才出现', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const pane = wrapper.find('[data-pane-id="novel.editor"]')
    // 头部＝一行标题：没有「正文」那一层，也没有常驻 meta。
    expect(pane.find('.doc-head .doc-title').text()).toBe('第002章')
    expect(pane.find('.pane-sub').exists()).toBe(false)
    expect(pane.find('.editor-meta').exists()).toBe(false)
    // 批次43：底部那行不再摆路径 · 第 N 版 · N 字；没有未落盘的改动时整行都不出现。
    expect(pane.find('.doc-meta-hint').exists()).toBe(false)
    // 位置：标题在正文之上。
    const html = pane.element.innerHTML
    expect(html.indexOf('doc-title')).toBeLessThan(html.indexOf('chapter-rendered'))
    wrapper.unmount()
  })

  it('Ctrl+S 保存带读到的修订号；服务端拒（版本不符）时保存 chip 常驻并给「重新载入」', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadChapters()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()

    // 工单H1：四个编辑面不再有常驻保存按钮，保存由编辑器聚焦时的 Ctrl+S 触发。
    expect(wrapper.find('.editor-foot .pane-btn.is-primary').exists()).toBe(false)
    // 工单C（P2）：编辑面头部统一进 .doc-head 容器；批次33 起头部只有一行 .doc-title。
    expect(wrapper.find('.doc-head .doc-title').exists()).toBe(true)
    // 批次43：正文面默认是阅读态（md 渲染过的一篇文），要动它先按头部那枚「编辑」。
    expect(wrapper.find('.editor-area').exists()).toBe(false)
    await enterEditing(wrapper)
    await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。')
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_chapter_save')
    expect(saved.args).toEqual({ file: '正文/第002章.md', text: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1 })
    // 保存结果只在 chip 上：不再铺一条「已保存到…」的常驻 notice。
    expect(wrapper.find('.pane-notice').exists()).toBe(false)
    const chip = wrapper.find('.nx-save-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('is-saved')
    expect(chip.text()).toContain('已保存 · 第 2 版')
    // 工单C（P2）：保存 chip 落在头部右侧动作位（.doc-head .nx-pane-actions）。
    expect(wrapper.find('.doc-head .nx-pane-actions .nx-save-chip').exists()).toBe(true)

    const conflict = fakeTools({ stale: true })
    const conflictData = useBoardData(conflict)
    await conflictData.loadChapters()
    const second = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data: conflictData } })
    await flushPromises()
    await enterEditing(second)
    await second.find('.editor-area').setValue('另一份改稿')
    await second.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    expect(second.find('.pane-error').text()).toContain('已被改动（第 1 版）')
    expect(second.find('.pane-error').text()).toContain('外壳不做静默合并')
    const errorChip = second.find('.nx-save-chip')
    expect(errorChip.classes()).toContain('is-error')
    expect(errorChip.text()).toContain('版本冲突')
    expect(errorChip.text()).toContain('会丢弃未保存修改')
    expect(second.find('.editor-area').element.value).toBe('另一份改稿', '拒写后草稿仍在作者手里')

    // 重新载入＝丢弃本稿、按磁盘重读：草稿回到盘上那一版，chip 随打开动作收掉。
    await errorChip.find('.nx-save-chip-action').trigger('click')
    await flushPromises()
    expect(second.find('.editor-area').element.value).toBe('雨从檐口滴下来。')
    expect(second.find('.nx-save-chip').exists()).toBe(false)
    wrapper.unmount()
    second.unmount()
  })

  it('保存成功的 chip 2.5 秒后自动收起（fake timers）；失败时没有计时器', async () => {
    // 只接管 setTimeout／clearTimeout：flushPromises 走 setImmediate，不能被一起冻住。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tools = fakeTools()
      const data = useBoardData(tools)
      await data.loadChapters()
      const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
      await flushPromises()

      await enterEditing(wrapper)
      await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。')
      await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      const chip = () => wrapper.find('.nx-save-chip')
      expect(chip().exists()).toBe(true)
      expect(chip().text()).toContain('已保存 · 第 2 版')

      vi.advanceTimersByTime(2400)
      await flushPromises()
      expect(chip().exists(), '2.4 秒时仍在').toBe(true)
      vi.advanceTimersByTime(100)
      await flushPromises()
      expect(chip().exists(), '2.5 秒后收起').toBe(false)
      wrapper.unmount()

      // 失败不安排自动收起：同样的时间推进后 chip 还在。
      const staleTools = fakeTools({ stale: true })
      const staleData = useBoardData(staleTools)
      await staleData.loadChapters()
      const failed = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data: staleData } })
      await flushPromises()
      await enterEditing(failed)
      await failed.find('.editor-area').setValue('另一份改稿')
      await failed.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(failed.find('.nx-save-chip').exists()).toBe(true)
      expect(failed.find('.nx-save-chip').classes()).toContain('is-error')
      failed.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('非 STALE 的保存失败：chip 常驻并给「重试」，重试成功后翻回「已保存」', async () => {
    const tools = fakeTools()
    const original = tools.request
    let attempts = 0
    tools.request = async (channel, payload) => {
      if (payload?.tool === 'pinax_chapter_save') {
        attempts += 1
        if (attempts === 1) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: false, code: 'PINAX_WRITE_FAILED', message: '磁盘写入失败' } } }
        }
      }
      return original(channel, payload)
    }
    const data = useBoardData(tools)
    await data.loadChapters()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()

    await enterEditing(wrapper)
    await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。')
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    const chip = () => wrapper.find('.nx-save-chip')
    expect(chip().classes()).toContain('is-error')
    expect(chip().text()).toContain('保存失败')
    expect(chip().find('.nx-save-chip-action').text()).toBe('重试')

    await chip().find('.nx-save-chip-action').trigger('click')
    await flushPromises()
    expect(attempts).toBe(2)
    expect(chip().classes()).toContain('is-saved')
    expect(chip().text()).toContain('已保存 · 第 2 版')
    wrapper.unmount()
  })

  it('存完之后索引窗里的版本号跟着走（索引窗与核心区共用同一份数据）', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await enterEditing(wrapper)
    await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。')
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    const rows = wrapper.findAll('.nx-index-window .nx-tree-item')
    // （工单B2 起大纲行也在 .nx-tree-item 里：按章节标题定位那一行。）
    // 批次33：版本号从可见 meta 退到行的 title（悬停才出现，IDE 的 hover 同一口径）。
    expect(rows.find((row) => row.text().includes('第002章')).attributes('title')).toContain('第 2 版')
    wrapper.unmount()
  })

  it('大纲栏（协议 v1.1-A：独立一栏）：空大纲给说明与「新建大纲」，不报错', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '大纲')

    // 换到大纲这一栏才取大纲：小说栏不替别人取树。
    expect(tools.calls.some((call) => call.tool === 'pinax_outline_read')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    const sections = indexWindow.findAll('.workspace-nav-section').map((node) => node.text())
    expect(sections).toContain('大纲')
    // 工单B2 起大纲行可点选（button 词汇，不再是静态 span）：批次33 起行文只有名字（数字前缀已拆）。
    const outlineRows = indexWindow.findAll('.nx-tree-item').filter((row) => row.text().includes('开场：雨夜进城') || row.text().includes('第一折'))
    expect(outlineRows).toHaveLength(2)
    expect(outlineRows[0].text()).toBe('开场：雨夜进城')
    expect(outlineRows[0].element.tagName).toBe('BUTTON')
    wrapper.unmount()

    // 空大纲（工具对「两样都没有」回 INVALID_INPUT）：给一行说明＋「新建大纲」，不当成错误摊在索引窗。
    const missing = fakeTools({ outlineMissing: true })
    const missingBridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : missing.request(channel, payload)) }
    const second = mount(AppNext, { props: { bridge: missingBridge } })
    await flushPromises()
    await openBoard(second, '大纲')
    expect(second.find('.nx-index-window').text()).toContain('大纲还没有内容（大纲/outline.json）')
    expect(second.find('.nx-index-error').exists()).toBe(false)
    second.unmount()
  })

  it('大纲节点改名（工单B2 → 批次43）：点行进中栏编辑面，改名落草稿并当场同步树；保存走 pinax_outline_save', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '大纲')

    const outlineRow = wrapper.findAll('.nx-tree-item').find((row) => row.text().includes('开场：雨夜进城'))
    await outlineRow.trigger('click')
    await flushPromises()
    // 批次43：大纲面默认是阅读态——头部一行标题（节点名本身），正文是渲染出来的备注。
    expect(wrapper.find('[data-test="outline-reading-title"]').text()).toBe('开场：雨夜进城')
    expect(wrapper.find('[aria-label="大纲节点标题"]').exists()).toBe(false)
    expect(wrapper.find('.control-primary').exists()).toBe(false)
    // 批次43：底部那行不再摆路径 · 版本 · 节点数（没有未落盘的改动时整行都不在）。
    expect(wrapper.find('.doc-meta-hint').exists()).toBe(false)

    // 按「编辑」才换成那枚可改的输入框（它就是文档头那一行标题）。
    await enterEditing(wrapper, 'outline-edit')
    expect(wrapper.find('.doc-head input.doc-title').exists()).toBe(true, '标题输入框就是文档头那一行标题')
    expect(wrapper.find('[aria-label="大纲节点标题"]').exists()).toBe(true)

    await wrapper.find('[aria-label="大纲节点标题"]').setValue('开场：雪夜进城')
    // 批次43：改名当场同步索引窗那棵树（作者 2026-10-31：改了却看见树上还停在「未命名节点」）。
    expect(wrapper.findAll('.nx-tree-item').find((row) => row.text().includes('开场：雪夜进城')), '改名后树行跟着改').toBeTruthy()

    await wrapper.find('[aria-label="大纲节点标题"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_outline_save')
    expect(saved.args.expectedRevision).toBe(1)
    expect(saved.args.nodes.map((node) => node.title)).toEqual(['开场：雪夜进城', '第一折：停摆的表'])
    // 批次19 H1 收尾：保存结果只进头部 chip，不再铺「已保存大纲 · …」常驻 notice（断言同步）。
    const chip = wrapper.find('.doc-head .nx-pane-actions .nx-save-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('is-saved')
    expect(chip.text()).toContain('已保存 · 第 2 版')
    expect(wrapper.find('.pane-notice').exists()).toBe(false)
    expect(wrapper.findAll('.nx-tree-item').find((row) => row.text().includes('开场：雪夜进城'))).toBeTruthy()
    // 批次43：版本号不再摆在正文底下（它在 chip 与索引窗行的 title 里），落盘后那行也整行收掉。
    expect(wrapper.find('.doc-meta-hint').exists()).toBe(false)
    wrapper.unmount()
  })

  it('大纲加节点（工单B2 → 批次43）：同级紧随所选、子级多记一条连线；入口在树行右键菜单，改完停手即落盘', async () => {
    // 自动保存有 1.5 秒的停手窗口：把计时器接管住，这一例才不会被真时钟抢跑。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tools = fakeTools()
      const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
      const wrapper = mount(AppNext, { props: { bridge } })
      await flushPromises()
      await openBoard(wrapper, '大纲')

      const rows = () => wrapper.findAll('.nx-index-window .nx-tree-item')
      expect(rows()).toHaveLength(2)

      // 右键「第一折」：菜单当场开出，五项节点操作都在（批次31 起这排操作不再占中栏正文的位置）。
      rows()[1].element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 180 }))
      await flushPromises()
      const menu = wrapper.find('.nx-context-menu')
      expect(menu.exists()).toBe(true)
      for (const key of ['outline-node-move-up', 'outline-node-move-down', 'outline-node-remove', 'outline-node-add-sibling', 'outline-node-add-child']) {
        expect(menu.find(`[data-test="${key}"]`).exists(), `菜单缺 ${key}`).toBe(true)
      }
      // 右键先把这一行选中：所有节点操作都作用在所选节点上。
      expect(rows()[1].classes()).toContain('is-active')

      // 加同级：插在所选之后，树当场长一行（草稿的回执要在树上看得见，不然下一手没有行可点）。
      await menu.find('[data-test="outline-node-add-sibling"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.nx-context-menu').exists()).toBe(false)
      expect(rows()).toHaveLength(3)
      expect(rows()[2].text()).toBe('未命名节点')

      // 再右键新行「加子节点」：多记一条 from→to 连线（层级语义住在 edges 里）。
      rows()[2].element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 240 }))
      await flushPromises()
      await wrapper.find('[data-test="outline-node-add-child"]').trigger('click')
      await flushPromises()
      expect(rows()).toHaveLength(4)
      // 停手窗口内还没落盘：草稿里的改动先在树上看得见。
      expect(tools.calls.filter((call) => call.tool === 'pinax_outline_save')).toHaveLength(0)

      // 批次43（作者 2026-10-31：文件添加了、修改了，也没发保存）：停手 1.5 秒后自动落盘。
      vi.advanceTimersByTime(1600)
      await flushPromises()
      const autoSaved = tools.calls.filter((call) => call.tool === 'pinax_outline_save')
      expect(autoSaved).toHaveLength(1)
      expect(autoSaved[0].args.nodes).toHaveLength(4)
      expect(autoSaved[0].args.nodes[1].title).toBe('第一折：停摆的表')
      expect(autoSaved[0].args.nodes[2].title).toBe('未命名节点')
      expect(autoSaved[0].args.nodes[3].title).toBe('未命名节点')
      expect(autoSaved[0].args.nodes[2].id).not.toBe(autoSaved[0].args.nodes[3].id)
      expect(autoSaved[0].args.edges).toContainEqual({ from: autoSaved[0].args.nodes[2].id, to: autoSaved[0].args.nodes[3].id })
      expect(autoSaved[0].args.edges).toContainEqual({ from: 'n1', to: 'n2' })
      expect(autoSaved[0].args.expectedRevision).toBe(1)
      // 自动保存那一下的 chip 只说「已保存」：版本号是开发者信息，不摆给作者看。
      expect(wrapper.find('.doc-head .nx-save-chip').text()).toContain('已保存')

      // Ctrl+S 也能立刻存：同一份草稿、同一套修订号闸（这一下才报版本号）。
      await enterEditing(wrapper, 'outline-edit')
      await wrapper.find('[aria-label="大纲节点标题"]').trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      const saved = tools.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
      expect(saved.args.nodes).toHaveLength(4)
      expect(saved.args.expectedRevision).toBe(2)
      expect(wrapper.find('.doc-head .nx-save-chip').text()).toContain('已保存 · 第 3 版')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('大纲／条目保存单通道（批次31 · P18）：常驻保存按钮拆净，Ctrl+S 落盘，结果只进 .nx-save-chip', async () => {
    // ① 大纲：编辑面里没有任何常驻主按钮，也没有底部按钮行；Ctrl+S 是唯一保存入口。
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadOutline()
    data.selectOutlineNode(0)
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('outline.editor'), data } })
    await flushPromises()

    expect(wrapper.find('.editor-foot').exists()).toBe(false)
    expect(wrapper.find('.control-primary').exists()).toBe(false)
    // 批次43：大纲面默认是阅读态，要改标题先按「编辑」（标题输入框就是文档头那一行）。
    expect(wrapper.find('[aria-label="大纲节点标题"]').exists()).toBe(false)
    await enterEditing(wrapper, 'outline-edit')
    await wrapper.find('[aria-label="大纲节点标题"]').setValue('开场：雪夜进城')
    await wrapper.find('[aria-label="大纲节点标题"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    expect(tools.calls.filter((call) => call.tool === 'pinax_outline_save')).toHaveLength(1)
    const outlineChip = wrapper.find('.doc-head .nx-pane-actions .nx-save-chip')
    expect(outlineChip.exists()).toBe(true)
    expect(outlineChip.text()).toContain('已保存 · 第 2 版')
    expect(wrapper.find('.pane-notice').exists()).toBe(false)
    wrapper.unmount()

    // 大纲的 STALE：chip 常驻并给「重新载入」；重载后草稿回到盘上那一版，chip 随重读收掉。
    const staleTools = fakeTools({ stale: true })
    const staleData = useBoardData(staleTools)
    await staleData.loadOutline()
    staleData.selectOutlineNode(0)
    const stale = mount(CarrierPaneHost, { props: { pane: paneOf('outline.editor'), data: staleData } })
    await flushPromises()
    await enterEditing(stale, 'outline-edit')
    await stale.find('[aria-label="大纲节点标题"]').setValue('冲突里的改名')
    await stale.find('[aria-label="大纲节点标题"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const staleChip = stale.find('.doc-head .nx-save-chip')
    expect(staleChip.classes()).toContain('is-error')
    expect(staleChip.text()).toContain('版本冲突')
    await staleChip.find('.nx-save-chip-action').trigger('click')
    await flushPromises()
    expect(stale.find('.nx-save-chip').exists()).toBe(false)
    // 批次43：重新载入＝按磁盘重读，回到阅读态（编辑态不跨文档），标题回到盘上那一个。
    expect(stale.find('[aria-label="大纲节点标题"]').exists()).toBe(false)
    expect(stale.find('[data-test="outline-reading-title"]').text()).toBe('开场：雨夜进城')
    stale.unmount()

    // ② 条目：编辑态 Ctrl+S 落盘；保存后回到阅读态，chip 在动作位与「编辑」并排。
    //    再进编辑态（底部没有保存／取消按钮行），第二个通道仍是 Ctrl+S。
    const entryTools = fakeTools()
    const entryData = useBoardData(entryTools)
    await entryData.loadEntries()
    const entry = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data: entryData } })
    await flushPromises()

    await entry.find('.entry-edit').trigger('click')
    await flushPromises()
    expect(entry.find('.editor-foot').exists()).toBe(false)
    await entry.find('.editor-area').setValue('冷穿越剧版主角，醒来在雪夜，袖中多了一枚停摆的表。')
    await entry.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    expect(entryTools.calls.filter((call) => call.tool === 'pinax_worldbook_save')).toHaveLength(1)
    let entryChip = entry.find('.doc-head .nx-pane-actions .nx-save-chip')
    expect(entryChip.exists()).toBe(true)
    expect(entryChip.text()).toContain('已保存 · 第 2 版')
    // 保存成功退出编辑态；chip 仍挂在动作位（阅读态也看得见刚才那一下的结果）。
    expect(entry.find('.entry-text').exists()).toBe(true)
    expect(entry.find('.doc-head .nx-pane-actions .entry-edit').exists()).toBe(true)

    await entry.find('.entry-edit').trigger('click')
    await flushPromises()
    // 取消退到头部右端（与「编辑」同一个位置），正文里不再有按钮行。
    expect(entry.find('.doc-head .nx-pane-actions .entry-cancel').exists()).toBe(true)
    await entry.find('.editor-area').setValue('冷穿越剧版主角，醒来在雪夜，袖中多了一枚停摆的表。雨声未停。')
    await entry.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    expect(entryTools.calls.filter((call) => call.tool === 'pinax_worldbook_save')).toHaveLength(2)
    entryChip = entry.find('.doc-head .nx-pane-actions .nx-save-chip')
    expect(entryChip.text()).toContain('已保存 · 第 3 版')
    entry.unmount()
  })

  it('大纲层级（工单G3／批次28）：edges 决定缩进深度；断链／无 edges 时全部一级', async () => {
    // ① 一条 n1→n2 的连线：n1 一级（10px），n2 缩进一级（24px）。
    //    批次28 起层级只由缩进阶梯表达，「·」点标记已下线（缩进本身就说明了父子）。
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '大纲')

    const outlineRows = (root = wrapper) => root.findAll('.nx-index-window .nx-tree-item')
      .filter((row) => row.text().includes('开场：雨夜进城') || row.text().includes('第一折'))
    const rows = outlineRows()
    expect(rows).toHaveLength(2)
    expect(rows[0].element.style.paddingInlineStart).toBe('10px')
    expect(rows[1].element.style.paddingInlineStart).toBe('24px')
    expect(wrapper.find('.nx-outline-mark').exists()).toBe(false)
    wrapper.unmount()

    // depth 是界面字段，不是文档字段：点开节点后草稿里不能带着它（否则保存会把 depth 写进 outline.json）。
    const data = useBoardData(tools)
    await data.loadOutline()
    expect(data.outline.map((node) => node.depth)).toEqual([0, 1])
    data.selectOutlineNode(0)
    expect(data.outlineDraft.nodes.every((node) => !('depth' in node))).toBe(true)

    // 兼容 { source, target } 字段名（outline.json 由载体原样落盘，两种形状都要认）。
    const altTools = fakeTools({ outlineEdges: [{ source: 'n1', target: 'n2' }] })
    const altData = useBoardData(altTools)
    await altData.loadOutline()
    expect(altData.outline.map((node) => node.depth)).toEqual([0, 1])

    // ② 断链（连线指向不存在的节点）：不造层级，全部一级。
    const brokenTools = fakeTools({ outlineEdges: [{ from: 'n1', to: '查无此节点' }] })
    const brokenBridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : brokenTools.request(channel, payload)) }
    const broken = mount(AppNext, { props: { bridge: brokenBridge } })
    await flushPromises()
    await openBoard(broken, '大纲')
    const brokenRows = outlineRows(broken)
    expect(brokenRows).toHaveLength(2)
    expect(brokenRows.map((row) => row.element.style.paddingInlineStart)).toEqual(['10px', '10px'])
    broken.unmount()

    // ③ 完全没有 edges（还没连线的草稿是常态）：同样全部一级。
    const flatTools = fakeTools({ outlineEdges: [] })
    const flatBridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : flatTools.request(channel, payload)) }
    const flat = mount(AppNext, { props: { bridge: flatBridge } })
    await flushPromises()
    await openBoard(flat, '大纲')
    const flatRows = outlineRows(flat)
    expect(flatRows).toHaveLength(2)
    expect(flatRows.map((row) => row.element.style.paddingInlineStart)).toEqual(['10px', '10px'])
    flat.unmount()
  })

  it('提案审阅（工单B1）：索引窗不再摆提案区；二级页「文档 → 提案审阅」列表→点开→中栏对照→采纳', async () => {
    const tools = fakeTools({ proposals: [{ ...PROPOSAL }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 协议 v1.1-A / 工单B1：小说栏只有章节树——提案区连标题都不该出现，也不再替二级页列提案。
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.findAll('.workspace-nav-section').map((node) => node.text())).not.toContain('提案')
    expect(indexWindow.text()).not.toContain('提案')
    expect(tools.calls.some((call) => call.tool === 'pinax_proposal_list')).toBe(false)

    // 菜单「项目 → 提案审阅…」打开统一二级页的「文档 → 提案审阅」节。
    await openProposalsSection(wrapper)
    const panel = wrapper.find('[data-test="settings-panel-proposals"]')
    expect(panel.exists(), '提案审阅节打开了').toBe(true)
    expect(wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())).toContain('提案审阅')
    expect(wrapper.findAll('.settings-group-label').map((node) => node.text())).toContain('文档')
    // 列表数据走 pinax_proposal_list 一条通道；行文＝目标章标题＋createdAt 短格式。
    expect(tools.calls.some((call) => call.tool === 'pinax_proposal_list')).toBe(true)
    const proposalRow = panel.find('[data-test="proposal-row-20261028T140000-ch1-abcdef12.json"]')
    expect(proposalRow.exists(), '提案行在二级页里').toBe(true)
    expect(proposalRow.text()).toContain('第002章-雨夜')
    expect(proposalRow.text()).toContain('10-28 14:00')

    // 点一条：关闭弹窗，核心区（正文那一栏）打开既有审阅面。
    await proposalRow.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="settings-panel-proposals"]').exists()).toBe(false)
    expect(tools.calls.some((call) => call.tool === 'pinax_proposal_read')).toBe(true)
    const pane = wrapper.find('[data-pane-id="novel.editor"]')
    // 批次33：文档头只有一行标题「提案审阅 · 文件名」，目标章沉到底部 hint。
    expect(pane.text()).toContain(`提案审阅 · ${PROPOSAL.name}`)
    expect(pane.find('.doc-meta-hint').text()).toContain('正文/第002章.md')
    expect(pane.text()).toContain('提案说明：把雨提前一段')
    expect(pane.text()).toContain('当前正文')
    expect(pane.text()).toContain('提案新文')
    expect(pane.find('.entry-text').text()).toBe('雨从檐口滴下来。')
    expect(pane.find('[aria-label="提案新文"]').text()).toBe('雨从檐口滴下来，巷子里没人。')
    expect(pane.text()).toContain('14 字')

    await pane.find('.proposal-adopt').trigger('click')
    await flushPromises()
    const saved = tools.calls.filter((call) => call.tool === 'pinax_chapter_save').at(-1)
    expect(saved.args).toEqual({ file: '正文/第002章.md', text: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1, proposal: PROPOSAL.name })
    expect(wrapper.text()).toContain('已采纳提案，写入「正文/第002章.md」· 第 2 版')
    expect(tools.state.proposals[0].status).toBe('adopted')
    expect(tools.state.text).toBe('雨从檐口滴下来，巷子里没人。')

    // 状态以重列回来的磁盘 JSON 为准：再开二级页，行上标出「已采纳」，提案仍在（采纳不是删除）。
    await openProposalsSection(wrapper)
    const adoptedRow = wrapper.find('[data-test="proposal-row-20261028T140000-ch1-abcdef12.json"]')
    expect(adoptedRow.exists()).toBe(true)
    expect(adoptedRow.text()).toContain('已采纳')
    wrapper.unmount()
  })

  it('提案弃用走 pinax_proposal_discard；STALE 时错误条摊开、按钮仍可重试', async () => {
    // 弃用：删提案文件，正文不动；二级页列表随「没有提案」收掉。
    const tools = fakeTools({ proposals: [{ ...PROPOSAL }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openProposalsSection(wrapper)
    await wrapper.find('[data-test="proposal-row-20261028T140000-ch1-abcdef12.json"]').trigger('click')
    await flushPromises()

    const discardButton = wrapper.find('[data-pane-id="novel.editor"] .proposal-discard')
    expect(discardButton.text()).toBe('弃用')
    await discardButton.trigger('click')
    await flushPromises()
    const discarded = tools.calls.filter((call) => call.tool === 'pinax_proposal_discard').at(-1)
    expect(discarded.args).toEqual({ name: PROPOSAL.name })
    expect(tools.state.proposals).toHaveLength(0)
    expect(tools.state.text, '弃用不动正文').toBe('雨从檐口滴下来。')

    // 重开二级页：列表空了，如实说「还没有提案」。
    await openProposalsSection(wrapper)
    expect(wrapper.find('[data-test="proposal-row-20261028T140000-ch1-abcdef12.json"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="settings-panel-proposals"]').text()).toContain('还没有提案')
    wrapper.unmount()

    // STALE：修订号对不上时原话摊开，按钮不被禁用（重开章节后可以再试）。
    const staleTools = fakeTools({ stale: true, proposals: [{ ...PROPOSAL }] })
    const staleBridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : staleTools.request(channel, payload)) }
    const second = mount(AppNext, { props: { bridge: staleBridge } })
    await flushPromises()
    await openProposalsSection(second)
    await second.find('[data-test="proposal-row-20261028T140000-ch1-abcdef12.json"]').trigger('click')
    await flushPromises()
    await second.find('[data-pane-id="novel.editor"] .proposal-adopt').trigger('click')
    await flushPromises()

    const error = second.find('.pane-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('已被改动（第 1 版）')
    expect(error.text()).toContain('提案已过期')
    expect(staleTools.state.proposals[0].status, '拒写不推进提案状态').toBe('proposed')
    const retry = second.find('[data-pane-id="novel.editor"] .proposal-adopt')
    expect(retry.attributes('disabled')).toBeUndefined()
    second.unmount()
  })

  it('新建章节走 expectedRevision 0（批次33：区头 ＋ → 临时输入 → Enter 建档）', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 常驻输入排已拆：区标题右侧只有一枚 ＋，点开才是临时输入行。
    expect(wrapper.find('.nx-index-new').exists()).toBe(false)
    await wrapper.find('[aria-label="新建章节"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="index-new-input"]').setValue('第003章-雪夜')
    await wrapper.find('[data-test="index-new-input"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_chapter_save' && call.args.title)
    expect(created.args).toEqual({ title: '第003章-雪夜', text: '第003章-雪夜\n', expectedRevision: 0 })
    expect(wrapper.find('[data-test="index-new-input"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('区头 ＋ 的取消路径（批次33）：Esc 与失焦都不建档', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const created = () => tools.calls.some((call) => call.tool === 'pinax_chapter_save' && call.args.title)
    // Esc：输入行退场，一个新建请求都不发。
    await wrapper.find('[aria-label="新建章节"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="index-new-input"]').setValue('不要落盘的标题')
    await wrapper.find('[data-test="index-new-input"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-test="index-new-input"]').exists()).toBe(false)
    expect(created()).toBe(false)

    // 失焦：同样只是取消（批次33 的口径：Enter 才建档）。
    await wrapper.find('[aria-label="新建章节"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="index-new-input"]').setValue('也不落盘')
    await wrapper.find('[data-test="index-new-input"]').trigger('blur')
    await flushPromises()
    expect(wrapper.find('[data-test="index-new-input"]').exists()).toBe(false)
    expect(created()).toBe(false)
    wrapper.unmount()
  })

  it('构思栏（协议 v1.1-A：独立一栏）：行可点开，正文来自 pinax_notes_list 的随手带回', async () => {
    const tools = fakeTools({ notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '构思')

    // 换到构思这一栏才列构思。
    expect(tools.calls.some((call) => call.tool === 'pinax_notes_list')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.text()).toContain('构思')
    const noteRow = indexWindow.findAll('.nx-tree-item').find((row) => row.text().includes('雨夜的表'))
    expect(noteRow, '构思区在章节树之后').toBeTruthy()

    // 点行开篇：不再发第二次读（正文随列表回来），核心区换构思面。
    const callsBeforeOpen = tools.calls.length
    await noteRow.trigger('click')
    await flushPromises()
    expect(tools.calls.length).toBe(callsBeforeOpen)
    expect(noteRow.classes()).toContain('is-active')
    // 批次43：构思面默认是阅读态——md 渲染出来的一篇速记，不是裸源码。
    const pane = wrapper.find('[data-pane-id="notes.editor"]')
    expect(pane.find('[data-test="note-rendered"]').text()).toBe('袖口的表停在十二点差三分。')
    expect(pane.find('[aria-label="构思编辑器"]').exists()).toBe(false)
    // 工单H1：打开不再铺「已载入 N 字 · 第 N 版」的 notice。
    expect(pane.find('.pane-notice').exists()).toBe(false)
    // 批次43：字数与版本不再摆在正文底下（开发者信息不进作者的眼）。
    expect(pane.find('.doc-meta-hint').exists()).toBe(false)
    expect(pane.text()).not.toContain('第 1 版')
    wrapper.unmount()
  })

  it('构思保存走 pinax_notes_save 带修订号；索引窗「构思」区的 ＋ 新建走 expectedRevision 0', async () => {
    const tools = fakeTools({ notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '构思')
    const noteRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('雨夜的表'))
    expect(noteRow, '构思区里的行').toBeTruthy()
    await noteRow.trigger('click')
    await flushPromises()

    // 批次43：构思面默认是阅读态，按「编辑」才换成源文编辑区。
    await enterEditing(wrapper, 'note-edit')
    await wrapper.find('[aria-label="构思编辑器"]').setValue('表针在雨夜重新走了起来。')
    await wrapper.find('[aria-label="构思编辑器"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_notes_save' && call.args.file)
    expect(saved.args).toEqual({ file: '构思/雨夜的表.md', text: '表针在雨夜重新走了起来。', expectedRevision: 1 })
    expect(wrapper.find('.nx-save-chip').text()).toContain('已保存 · 第 2 版')

    // 新建（工单H1）：入口收进索引窗「构思」区标题行右侧的 ＋；点开才出现输入行，Enter 提交。
    // 工具拒空 text，所以以标题作首行落盘，修订号 0；随后列一次并打开新篇。
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(false)
    await wrapper.find('[aria-label="新建构思"]').trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="新构思标题"]').setValue('巷尾的钟楼')
    await wrapper.find('[aria-label="新构思标题"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_notes_save' && call.args.title)
    expect(created.args).toEqual({ title: '巷尾的钟楼', text: '巷尾的钟楼\n', expectedRevision: 0 })
    // 批次43：换了一份稿子就回到阅读态（编辑态不跨文档）。
    expect(wrapper.find('[aria-label="构思编辑器"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="note-rendered"]').text()).toContain('巷尾的钟楼')
    // 新构思进了索引窗；路径与版本在那一行的 title 上（悬停才出现，批次33）。
    const createdRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('巷尾的钟楼'))
    expect(createdRow, '新构思进了索引窗').toBeTruthy()
    expect(createdRow.attributes('title')).toContain('构思/巷尾的钟楼.md')
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('索引窗「构思」区的 ＋（批次33）：输入行不常驻；Esc 与失焦都只取消，Enter 才建档', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '构思')

    // 常驻输入行已移除：区标题右侧只有一枚「＋」，点了才出现输入框。
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(false)
    const addButton = wrapper.find('[aria-label="新建构思"]')
    expect(addButton.exists()).toBe(true)
    await addButton.trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(true)

    // Esc 收起：输入行退场，一个新建请求都不发。
    await wrapper.find('[aria-label="新构思标题"]').setValue('不要落盘的标题')
    await wrapper.find('[aria-label="新构思标题"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(false)
    expect(tools.calls.some((call) => call.tool === 'pinax_notes_save' && call.args.title)).toBe(false)

    // 失焦同样只是取消（批次33 把「失焦提交」改成「失焦取消」：Enter 才建档）。
    await addButton.trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="新构思标题"]').setValue('巷口的灯')
    await wrapper.find('[aria-label="新构思标题"]').trigger('blur')
    await flushPromises()
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(false)
    expect(tools.calls.some((call) => call.tool === 'pinax_notes_save' && call.args.title)).toBe(false)

    // Enter 才建档：以标题作首行落盘（expectedRevision 0）。
    await addButton.trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="新构思标题"]').setValue('巷口的灯')
    await wrapper.find('[aria-label="新构思标题"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_notes_save' && call.args.title)
    expect(created.args).toEqual({ title: '巷口的灯', text: '巷口的灯\n', expectedRevision: 0 })
    expect(wrapper.find('[aria-label="新构思标题"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('板块声明不再摆在正文面板上：清单仍从 view 通道拿得到，只是不占界面', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()

    // 正文是作者读稿的地方，权限表与工具表不该站在稿子旁边。
    expect(wrapper.find('.pane-meta').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('认领目录')
    expect(wrapper.text()).not.toContain('file:正文:rw')

    // 但清单没被删：view 通道里原话还在（作用域／工具／上下文块与预算）。
    const carrier = shellView().carriers.find((item) => item.id === 'pinax.carrier.novel')
    expect(carrier.scopes).toContain('file:正文:rw')
    expect(carrier.tools).toContain('pinax_chapter_save')
    expect(carrier.context.providers).toEqual(['selection'])
    wrapper.unmount()
  })
})

describe('世界书与设定两栏（协议 v1.1-A：世界书独立成栏，设定只剩约束）', () => {
  it('世界书条目在索引窗里列，核心区读得到；未建档的条目在两头都标出来', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 切到「世界书」那块板：索引窗换成条目树，核心区换成条目详情（协议 v1.1-A：世界书独立一栏）。
    await openBoard(wrapper, '世界书')

    expect(tools.calls.some((call) => call.tool === 'pinax_worldbook_list')).toBe(true)
    // 批次44：条目行搬进了核心区的看板区（上＝图表列，下＝详情），窄栏退成类别导航树。
    const rows = wrapper.findAll('[data-test="entries-board"] .nx-tree-item')
    expect(rows).toHaveLength(2)
    // 批次33：行上只剩名字，「N 字 · 未建档」退到行的 title。
    expect(rows[1].text()).toBe('随手记')
    expect(rows[1].attributes('title')).toContain('未建档')
    // 契约警告是「列举」层的事，仍由索引窗底部的警告行摊开（那一段对所有板通用）。
    expect(wrapper.find('.nx-index-window').text()).toContain('不符合文件契约')

    expect(wrapper.find('.entry-text').text()).toContain('醒来在雪夜')
    await rows[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.entry-text').text()).toContain('设定碎句')
    expect(wrapper.find('.center').text()).toContain('未建档')
    wrapper.unmount()
  })

  it('条目读不到时如实显示拒绝，不渲染一条编造的条目', async () => {
    const tools = fakeTools()
    const original = tools.request
    tools.request = async (channel, payload) => {
      if (payload?.tool === 'pinax_worldbook_read') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '「世界书/」里没有 查无此人' } } }
      return original(channel, payload)
    }
    const data = useBoardData(tools)
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data } })
    await flushPromises()
    await data.openEntry({ id: null, name: '查无此人', path: '世界书/查无此人.md' })
    await flushPromises()
    expect(wrapper.find('.pane-error').text()).toContain('没有 查无此人')
    expect(wrapper.find('.entry-text').exists()).toBe(false)
    wrapper.unmount()
  })

  it('条目编辑切换与保存走工具通道（工单A2）：textarea 换下阅读态，保存带修订号并刷新版本', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadEntries()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data } })
    await flushPromises()

    // 阅读态：entry-text 摊开正文，文档头右端有「编辑」；还没有 textarea。
    expect(wrapper.find('.entry-text').exists()).toBe(true)
    expect(wrapper.find('.entry-edit').text()).toBe('编辑')
    expect(wrapper.find('.editor-area').exists()).toBe(false)
    // 工单C（P2）：条目头部也是 .doc-head，编辑钮在右侧动作位（批次33：头部只有一行标题）。
    expect(wrapper.find('.doc-head').exists()).toBe(true)
    expect(wrapper.find('.doc-head .nx-pane-actions .entry-edit').exists()).toBe(true)

    await wrapper.find('.entry-edit').trigger('click')
    await flushPromises()
    // 编辑态：entry-text 换成 textarea，草稿从读到的正文起。
    expect(wrapper.find('.entry-text').exists()).toBe(false)
    // 批次31（P18）：底部按钮行拆净——保存只剩 Ctrl+S，取消退到头部右端；正文里没有主按钮。
    expect(wrapper.find('.editor-foot').exists()).toBe(false)
    expect(wrapper.find('.control-primary').exists()).toBe(false)
    expect(wrapper.find('.doc-head .nx-pane-actions .entry-cancel').exists()).toBe(true)
    const area = wrapper.find('.editor-area')
    expect(area.element.value).toBe('冷穿越剧版主角，醒来在雪夜。')

    await area.setValue('冷穿越剧版主角，醒来在雪夜，袖中多了一枚停摆的表。')
    await area.trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_worldbook_save')
    // 工单C：契约条目保存时把元数据一起带上（作者没改就按读到的值回写，不会把 keys/tags/summary 洗掉）。
    // 收口包②：摘要与关键词／标签同一个口，没改也原样回写。
    // 批次28：relations 也随 meta 整份回写（夹具里读回来是空数组，保存就带回空数组＝不强塞关系）。
    expect(saved.args).toEqual({
      path: '世界书/人物·柯秒.md',
      text: '冷穿越剧版主角，醒来在雪夜，袖中多了一枚停摆的表。',
      expectedRevision: 1,
      meta: { keys: ['柯秒'], tags: ['主角'], summary: '雪夜醒来的主角，袖中有一枚停摆的表。', relations: [] }
    })
    // 保存成功：退出编辑态，重读把正文一起刷新。
    expect(wrapper.find('.entry-text').exists()).toBe(true)
    // 批次43：版本号不再摆在正文底下（它在 chip 与索引窗行的 title 里）。
    expect(wrapper.find('.doc-meta-hint').text()).not.toContain('第 2 版')
    expect(wrapper.find('.entry-text').text()).toContain('停摆的表')

    // 取消：原样退回阅读态，一个工具都不调。
    const callsBefore = tools.calls.length
    await wrapper.find('.entry-edit').trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor-area').exists()).toBe(true)
    await wrapper.find('.entry-cancel').trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor-area').exists()).toBe(false)
    expect(wrapper.find('.entry-text').exists()).toBe(true)
    expect(tools.calls.length, '取消不落盘').toBe(callsBefore)
    wrapper.unmount()
  })

  it('条目元数据（工单C／收口包② → 批次31 P18）：默认折叠在「条目信息」一行，展开后才改关键词／标签／摘要', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadEntries()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data } })
    await flushPromises()

    // 阅读态：既有 meta 行末尾多一格关键词（数组用顿号连）与一格摘要（原文），不另起一行。
    expect(wrapper.find('.doc-meta-hint').text()).toContain('关键词：柯秒')
    expect(wrapper.find('.doc-meta-hint').text()).toContain('摘要：雪夜醒来的主角，袖中有一枚停摆的表。')

    await wrapper.find('.entry-edit').trigger('click')
    await flushPromises()
    // 批次31（P18 第 4 条）：默认折叠——信息行在场，字段不在 DOM（不是隐藏，是没渲染）。
    const toggle = wrapper.find('[data-test="entry-meta-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('条目信息')
    expect(toggle.text()).toContain('关键词 1 · 关系 0')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="entry-meta-fields"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="条目关键词（逗号分隔）"]').exists()).toBe(false)

    // 点开才摊出字段。
    await toggle.trigger('click')
    await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-test="entry-meta-fields"]').exists()).toBe(true)

    const keysInput = wrapper.find('[aria-label="条目关键词（逗号分隔）"]')
    const tagsInput = wrapper.find('[aria-label="条目标签（逗号分隔）"]')
    const summaryInput = wrapper.find('[aria-label="条目摘要（最多 500 字）"]')
    expect(keysInput.exists()).toBe(true)
    expect(tagsInput.exists()).toBe(true)
    expect(summaryInput.exists()).toBe(true)
    // 草稿从读到的 frontmatter 起（数组 → 逗号分隔字符串；摘要原样）。
    expect(keysInput.element.value).toBe('柯秒')
    expect(tagsInput.element.value).toBe('主角')
    expect(summaryInput.element.value).toBe('雪夜醒来的主角，袖中有一枚停摆的表。')
    // 摘要上限写在控件上（maxlength），旁边有一枚字数说明（不另铺常驻提示）。
    expect(summaryInput.attributes('maxlength')).toBe('500')
    expect(wrapper.find('.entry-meta-count').text()).toBe('18/500')
    // 折叠层在正文 textarea 之上（展开时也不抢正文的第一眼）。
    const row = wrapper.find('[data-test="entry-meta-fields"]').element
    const area = wrapper.find('.editor-area').element
    expect(row.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 中英文逗号都认；保存时拆成数组随 meta 传；摘要原样随 meta.summary 传。
    await keysInput.setValue('柯秒，秒子')
    await tagsInput.setValue('主角, 停摆的表')
    await summaryInput.setValue('雨夜醒来的主角，袖中的表停了。')
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_worldbook_save')
    expect(saved.args.meta).toEqual({ keys: ['柯秒', '秒子'], tags: ['主角', '停摆的表'], summary: '雨夜醒来的主角，袖中的表停了。', relations: [] })
    // 保存后回到阅读态：摘要以磁盘（工具重读）为准，不拿草稿自说自话。
    expect(wrapper.find('.entry-text').exists()).toBe(true)
    expect(wrapper.find('.doc-meta-hint').text()).toContain('摘要：雨夜醒来的主角，袖中的表停了。')

    // 摘要留空＝清空（空串随 meta 传，与工具 schema 同一口径）；阅读态不再显示这一格。
    // 再进编辑态：折叠层回到收起（下一次进来仍是先看正文），展开才改摘要。
    await wrapper.find('.entry-edit').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="entry-meta-fields"]').exists()).toBe(false)
    await wrapper.find('[data-test="entry-meta-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="条目摘要（最多 500 字）"]').setValue('')
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const cleared = tools.calls.filter((call) => call.tool === 'pinax_worldbook_save').at(-1)
    expect(cleared.args.meta.summary).toBe('')
    expect(wrapper.find('.doc-meta-hint').text()).not.toContain('摘要：')
    wrapper.unmount()

    // 裸 md（没有 frontmatter）：编辑态不出折叠层与这三栏，只给一句话说明；保存也不带 meta。
    const bareTools = fakeTools()
    const bareData = useBoardData(bareTools)
    await bareData.loadEntries()
    await bareData.openEntry(bareData.entries.find((item) => item.name === '随手记'))
    bareData.editEntry()
    const bare = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data: bareData } })
    await flushPromises()
    expect(bare.find('[data-test="entry-meta-toggle"]').exists()).toBe(false)
    expect(bare.find('[aria-label="条目关键词（逗号分隔）"]').exists()).toBe(false)
    expect(bare.find('[aria-label="条目摘要（最多 500 字）"]').exists()).toBe(false)
    expect(bare.find('[data-test="entry-meta-bare"]').text()).toContain('没有 frontmatter')
    await bare.find('.editor-area').setValue('裸 md 的新正文。')
    await bare.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const bareSave = bareTools.calls.find((call) => call.tool === 'pinax_worldbook_save')
    expect(bareSave.args.meta).toBeUndefined()
    bare.unmount()
  })

  it('约束（工单E2）：索引窗「约束」区列篇目，点开进约束编辑面；保存与新建都走 pinax_rule_save', async () => {
    const tools = fakeTools({
      rules: [{ index: 0, title: '纪律', file: '约束/纪律.md', name: '纪律.md', revision: 1, text: '- 不许出现现代词\n', totalChars: 10, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 切到「设定」那块板：协议 v1.1-A 起这一栏只有约束一棵树（世界书已独立成栏）。
    await openBoard(wrapper, '设定')
    expect(tools.calls.some((call) => call.tool === 'pinax_rule_list')).toBe(true)
    expect(wrapper.find('.nx-index-window').findAll('.workspace-nav-section').map((node) => node.text())).not.toContain('世界书')
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.text()).toContain('约束')
    const ruleRow = indexWindow.findAll('.nx-tree-item').find((row) => row.text().includes('纪律'))
    expect(ruleRow, '约束区里的行').toBeTruthy()

    // 点行开篇：正文随列表回来，不再发第二次读；核心区换约束面。
    const callsBeforeOpen = tools.calls.length
    await ruleRow.trigger('click')
    await flushPromises()
    expect(tools.calls.length).toBe(callsBeforeOpen)
    expect(ruleRow.classes()).toContain('is-active')
    // 批次43：约束面默认是阅读态——md 渲染出来的约束条目，不是裸源码。
    expect(wrapper.find('[data-test="rule-rendered"]').text()).toContain('不许出现现代词')
    expect(wrapper.find('[aria-label="约束编辑器"]').exists()).toBe(false)
    // 工单H1：打开不再铺「已载入 N 字 · 第 N 版」的 notice。
    expect(wrapper.find('.pane-notice').exists()).toBe(false)
    // 批次43：底部那行不摆版本与字数（没有未落盘的改动时整行都不在）。
    expect(wrapper.find('.doc-meta-hint').exists()).toBe(false)

    // 保存：Ctrl+S，带读到的修订号走 pinax_rule_save，版本号就地推进。
    await enterEditing(wrapper, 'rule-edit')
    await wrapper.find('[aria-label="约束编辑器"]').setValue('- 不许出现现代词\n- 每章 2000 字\n')
    await wrapper.find('[aria-label="约束编辑器"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_rule_save' && call.args.file)
    expect(saved.args).toEqual({ file: '约束/纪律.md', text: '- 不许出现现代词\n- 每章 2000 字\n', expectedRevision: 1 })
    expect(wrapper.find('.nx-save-chip').text()).toContain('已保存 · 第 2 版')

    // 新建（工单H1）：索引窗「约束」区标题行的 ＋ 点开输入行，Enter 提交，expectedRevision 0。
    await wrapper.find('[aria-label="新建约束"]').trigger('click')
    await flushPromises()
    await wrapper.find('[aria-label="新约束标题"]').setValue('文风')
    await wrapper.find('[aria-label="新约束标题"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_rule_save' && call.args.title)
    expect(created.args).toEqual({ title: '文风', text: '文风\n', expectedRevision: 0 })
    // 批次43：换了一份稿子就回到阅读态（编辑态不跨文档）。
    expect(wrapper.find('[aria-label="约束编辑器"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rule-rendered"]').text()).toContain('文风')
    wrapper.unmount()
  })
})

/**
 * 批次43：作者 2026-10-31 的三条意见各自落成机器门口的判据。
 *   ① 「正文区域没有适配 md 格式原生渲染么」→ 四个文档面默认就是渲染过的 md（断言真标签，不看纯文本）；
 *   ② 「你加了很多无效的提示」→ 路径 · 第 N 版 · N 字这些开发者信息不进作者的眼；
 *   ③ 「文件添加了，修改了，也没发保存」→ 停手 1.5 秒自动落盘（只载入了前段的文档除外：存回去会吃掉后半段）。
 */
describe('批次43：md 原生渲染 · 改了就落盘 · 去掉无效提示', () => {
  const MD = '# 雨夜\n\n他抬头，**灯**灭了。\n\n- 一条路\n- 两条路\n'

  it('① md 原生渲染：正文／构思／大纲／约束四个面默认渲染成 md，编辑态才是源文', async () => {
    const tools = fakeTools({
      chapterText: MD,
      notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: MD, totalChars: MD.length, truncated: false }],
      rules: [{ index: 0, title: '纪律', file: '约束/纪律.md', name: '纪律.md', revision: 1, text: MD, totalChars: MD.length, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 正文：源文里的 # / ** / 列表都成了真标签（看 HTML，纯文本看不出渲染有没有发生）。
    const chapterHtml = wrapper.find('[data-test="chapter-rendered"]').html()
    expect(chapterHtml).toContain('<h1>雨夜</h1>')
    expect(chapterHtml).toContain('<strong>灯</strong>')
    expect(chapterHtml).toContain('<li>一条路</li>')
    // 编辑态才是源文：作者改的是源文，不是渲染结果。
    await enterEditing(wrapper)
    expect(wrapper.find('.editor-area').element.value).toBe(MD)
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(false)

    // 构思：同一套渲染。
    await openBoard(wrapper, '构思')
    const noteRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('雨夜的表'))
    await noteRow.trigger('click')
    await flushPromises()
    const noteHtml = wrapper.find('[data-test="note-rendered"]').html()
    expect(noteHtml).toContain('<h1>雨夜</h1>')
    expect(noteHtml).toContain('<strong>灯</strong>')

    // 大纲：渲染的是节点备注（标题在文档头那一行）。
    await openBoard(wrapper, '大纲')
    const outlineRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('开场：雨夜进城'))
    await outlineRow.trigger('click')
    await flushPromises()
    const outlineHtml = wrapper.find('[data-test="outline-rendered"]').html()
    expect(outlineHtml).toContain('<h2>这一节要写什么</h2>')
    expect(outlineHtml).toContain('<strong>灯</strong>')
    expect(outlineHtml).toContain('<li>一条路</li>')

    // 约束：同一套渲染。
    await openBoard(wrapper, '设定')
    const ruleRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('纪律'))
    await ruleRow.trigger('click')
    await flushPromises()
    const ruleHtml = wrapper.find('[data-test="rule-rendered"]').html()
    expect(ruleHtml).toContain('<h1>雨夜</h1>')
    expect(ruleHtml).toContain('<strong>灯</strong>')
    wrapper.unmount()
  })

  it('② 改了就落盘：停手 1.5 秒自动保存（正文），Ctrl+S 仍能立刻存；chip 只说「已保存」', async () => {
    // 自动保存有 1.5 秒的停手窗口：把计时器接管住，这一例才不会被真时钟抢跑。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tools = fakeTools()
      const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
      const wrapper = mount(AppNext, { props: { bridge } })
      await flushPromises()

      await enterEditing(wrapper)
      await wrapper.find('.editor-area').setValue('雨从檐口滴下来。有人。')
      // 停手窗口内还没落盘：改动先在作者手里，底部只说一句「未保存的改动」。
      expect(tools.calls.filter((call) => call.tool === 'pinax_chapter_save')).toHaveLength(0)
      expect(wrapper.find('[data-pane-id="novel.editor"] .doc-meta-hint').text()).toContain('未保存的改动')

      // 停手 1.5 秒后自动落盘（作者 2026-10-31：改了却没发保存）。
      vi.advanceTimersByTime(1600)
      await flushPromises()
      const autoSaved = tools.calls.filter((call) => call.tool === 'pinax_chapter_save')
      expect(autoSaved).toHaveLength(1)
      expect(autoSaved[0].args).toEqual({ file: '正文/第002章.md', text: '雨从檐口滴下来。有人。', expectedRevision: 1 })
      // 自动保存那一下的 chip 只说「已保存」：版本号是开发者信息，不摆给作者看。
      const chip = wrapper.find('.doc-head .nx-save-chip')
      expect(chip.text()).toContain('已保存')
      expect(chip.text()).not.toContain('第 2 版')
      // 落盘后底部那行收掉（没有未落盘的改动，就没那句话可说）。
      expect(wrapper.find('[data-pane-id="novel.editor"] .doc-meta-hint').exists()).toBe(false)
      // 盘上版本推进了：索引窗那一行的 title 里是「第 2 版」（悬停才看见）。
      const row = wrapper.findAll('.nx-index-window .nx-tree-item').find((item) => item.text().includes('第002章'))
      expect(row.attributes('title')).toContain('第 2 版')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('③ 只载入了前段的文档不自动保存：那不是全文，存回去会吃掉没载入的后半段', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tools = fakeTools({ chapterTruncated: true })
      const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
      const wrapper = mount(AppNext, { props: { bridge } })
      await flushPromises()

      await enterEditing(wrapper)
      await wrapper.find('.editor-area').setValue('雨从檐口滴下来。有人。')
      vi.advanceTimersByTime(1600)
      await flushPromises()
      // 没自动存（否则盘上的后半段就没了）。
      expect(tools.calls.filter((call) => call.tool === 'pinax_chapter_save')).toHaveLength(0)
      // 作者看得见这件事：底部那一行说明为什么没自动存。
      const hint = wrapper.find('[data-pane-id="novel.editor"] .doc-meta-hint').text()
      expect(hint).toContain('只载入了前段')
      expect(hint).toContain('自动保存不会动它')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('④ 开发者信息不进作者的眼：路径 · 第 N 版 · N 字 不摆在四个文档面底下', async () => {
    const tools = fakeTools({
      notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }],
      rules: [{ index: 0, title: '纪律', file: '约束/纪律.md', name: '纪律.md', revision: 1, text: '- 不许出现现代词\n', totalChars: 10, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 正文面：没有那行 meta，面上也不出现路径／版本／字数。
    const chapterPane = wrapper.find('[data-pane-id="novel.editor"]')
    expect(chapterPane.find('.doc-meta-hint').exists()).toBe(false)
    expect(chapterPane.text()).not.toContain('正文/第002章.md')
    expect(chapterPane.text()).not.toContain('第 1 版')
    expect(chapterPane.text()).not.toContain('9 字')

    // 构思面。
    await openBoard(wrapper, '构思')
    const noteRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('雨夜的表'))
    await noteRow.trigger('click')
    await flushPromises()
    const notePane = wrapper.find('[data-pane-id="notes.editor"]')
    expect(notePane.find('.doc-meta-hint').exists()).toBe(false)
    expect(notePane.text()).not.toContain('构思/雨夜的表.md')
    expect(notePane.text()).not.toContain('第 1 版')
    expect(notePane.text()).not.toContain('14 字')

    // 大纲面：老那一行是「大纲/outline.json · 第 0 版，共 1 个节点」。
    await openBoard(wrapper, '大纲')
    const outlineRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('开场：雨夜进城'))
    await outlineRow.trigger('click')
    await flushPromises()
    const outlinePane = wrapper.find('[data-pane-id="outline.editor"]')
    expect(outlinePane.find('.doc-meta-hint').exists()).toBe(false)
    expect(outlinePane.text()).not.toContain('大纲/outline.json')
    expect(outlinePane.text()).not.toContain('第 0 版')
    expect(outlinePane.text()).not.toContain('共 1 个节点')

    // 约束面。
    await openBoard(wrapper, '设定')
    const ruleRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('纪律'))
    await ruleRow.trigger('click')
    await flushPromises()
    const rulePane = wrapper.find('[data-pane-id="setting.rules"]')
    expect(rulePane.find('.doc-meta-hint').exists()).toBe(false)
    expect(rulePane.text()).not.toContain('约束/纪律.md')
    expect(rulePane.text()).not.toContain('第 1 版')
    expect(rulePane.text()).not.toContain('10 字')
    wrapper.unmount()
  })
})

describe('资料载体', () => {
  /** 资料板（工单G1）默认不在 shellView 的板列里（那份夹具只摆小说＋设定）：
   *  这个用例自己把 reference.* 两枚 pane 加进去，验证的正是「paneId 以 reference. 开头时列资料树」。 */
  function referenceShellView() {
    // 协议 v1.1-A 起六栏都在 shellView 的板列里，资料就是其中一格。
    return shellView()
  }

  it('资料板：索引窗资料树→点开→编辑保存走工具通道（pinax_document_save 带修订号）', async () => {
    const tools = fakeTools({
      documents: [{ index: 0, title: '设定集', file: '资料/设定集.md', name: '设定集.md', revision: 1, text: '旧世界的年表。\n', totalChars: 8, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: referenceShellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const board = wrapper.findAll('.nx-ribbon-item').find((item) => item.attributes('aria-label') === '资料')
    expect(board, '图标竖条应有资料板块的入口').toBeTruthy()
    await board.trigger('click')
    await flushPromises()

    // 换板这一拍把资料目录列出来（与章节／条目同一套：目录窗只认自己的树）。
    expect(tools.calls.some((call) => call.tool === 'pinax_document_list')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.text()).toContain('资料')
    const row = indexWindow.findAll('.nx-tree-item').find((item) => item.text().includes('设定集'))
    expect(row, '资料区里的行').toBeTruthy()

    // 点行开篇：中栏走一次 pinax_document_read 取全文（列表那份最多 20000 字，不能当编辑底稿）。
    await row.trigger('click')
    await flushPromises()
    expect(tools.calls.some((call) => call.tool === 'pinax_document_read')).toBe(true)
    const pane = () => wrapper.find('[data-pane-id="reference.documents"]')
    expect(pane().find('[aria-label="资料正文"]').text()).toBe('旧世界的年表。')
    // 批次43：路径 · 版本这些开发者信息不再摆在界面上。
    expect(pane().text()).not.toContain('资料/设定集.md')
    expect(pane().find('textarea.editor-area').exists()).toBe(false)

    // 阅读态 → 编辑态：草稿从读到的正文起。
    await pane().find('.document-edit').trigger('click')
    await flushPromises()
    const area = pane().find('textarea.editor-area')
    expect(area.element.value).toBe('旧世界的年表。\n')
    await area.setValue('旧世界的年表，以及三条被划掉的注释。')
    await area.trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_document_save')
    expect(saved.args).toEqual({ file: '资料/设定集.md', text: '旧世界的年表，以及三条被划掉的注释。', expectedRevision: 1 })
    // 保存结果只在编辑面头部的 chip 上（阅读态也留着，2.5 秒后自行收起）。
    expect(pane().find('.nx-save-chip').text()).toContain('已保存 · 第 2 版')
    expect(pane().find('.pane-notice').exists()).toBe(false)
    // 保存成功后回到阅读态：正文以保存结果为准。
    expect(pane().find('textarea.editor-area').exists()).toBe(false)
    expect(pane().find('[aria-label="资料正文"]').text()).toContain('三条被划掉的注释')
    // 批次43：版本号不再摆在正文底下（它在 chip 与索引窗行的 title 里）。
    expect(pane().find('.doc-meta-hint').exists()).toBe(false)

    // 取消：原样退回阅读态（草稿不落盘，也不改写阅读态的正文），一个工具都不调。
    const callsBefore = tools.calls.length
    await pane().find('.document-edit').trigger('click')
    await flushPromises()
    expect(pane().find('.editor-area').exists()).toBe(true)
    await pane().find('.editor-area').setValue('取消掉的一笔')
    await pane().find('.document-cancel').trigger('click')
    await flushPromises()
    expect(pane().find('.editor-area').exists()).toBe(false)
    expect(pane().find('[aria-label="资料正文"]').text()).toContain('三条被划掉的注释')
    expect(pane().find('[aria-label="资料正文"]').text()).not.toContain('取消掉的一笔')
    expect(tools.calls.length, '取消不落盘').toBe(callsBefore)
    wrapper.unmount()
  })

  it('资料板新建：索引窗区头 ＋ → 临时输入 → Enter 走 pinax_document_save 的 expectedRevision 0', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: referenceShellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await wrapper.findAll('.nx-ribbon-item').find((item) => item.attributes('aria-label') === '资料').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-index-window').text()).toContain('资料还没有内容（资料/）')

    await wrapper.find('[aria-label="新建资料"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="index-new-input"]').setValue('年表补遗')
    await wrapper.find('[data-test="index-new-input"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    const created = tools.calls.find((call) => call.tool === 'pinax_document_save' && call.args.title)
    expect(created.args).toEqual({ title: '年表补遗', text: '年表补遗\n', expectedRevision: 0 })
    expect(wrapper.find('[data-pane-id="reference.documents"]').find('[aria-label="资料正文"]').text()).toBe('年表补遗')
    wrapper.unmount()
  })
})

describe('载体分栏（协议 v1.1-A：一个载体＝竖条一格＝一棵纯粹的本域内容树）', () => {
  it('竖条七格；每栏索引窗只列本载体的树，中栏按 paneId 前缀换面', async () => {
    const tools = fakeTools({
      notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }],
      rules: [{ index: 0, title: '纪律', file: '约束/纪律.md', name: '纪律.md', revision: 1, text: '- 不许出现现代词\n', totalChars: 10, truncated: false }],
      documents: [{ index: 0, title: '设定集', file: '资料/设定集.md', name: '设定集.md', revision: 1, text: '旧世界的年表。\n', totalChars: 8, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 竖条＝七格（注册顺序：小说/大纲/构思/世界书/剧本/设定/资料）＋主题钮等动作位。
    const labels = wrapper.findAll('.nx-ribbon-item').map((node) => node.attributes('aria-label'))
    for (const title of ['小说', '大纲', '构思', '世界书', '剧本', '设定', '资料']) {
      expect(labels).toContain(title)
    }

    const sections = () => wrapper.find('.nx-index-window .nx-index-body').findAll('.workspace-nav-section').map((node) => node.text())
    const activePane = () => wrapper.find('.pane[data-pane-id]').attributes('data-pane-id')

    // ① 小说：只有正文这一棵树；大纲/构思/世界书/约束/资料一棵都不在旁边，也一个都不取数。
    expect(sections()).toEqual(['正文'])
    expect(activePane()).toBe('novel.editor')
    for (const tool of ['pinax_outline_read', 'pinax_notes_list', 'pinax_worldbook_list', 'pinax_rule_list', 'pinax_document_list']) {
      expect(tools.calls.some((call) => call.tool === tool), `小说栏不该取 ${tool}`).toBe(false)
    }

    // ② 大纲：索引窗只有大纲树；中栏换大纲编辑面，正文编辑器不在。
    await openBoard(wrapper, '大纲')
    expect(sections()).toEqual(['大纲'])
    expect(activePane()).toBe('outline.editor')
    expect(wrapper.find('[aria-label="正文编辑器"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="大纲节点标题"]').exists()).toBe(false, '没选节点前只是提示，不空造编辑面')
    expect(wrapper.text()).toContain('从左边索引窗里选一个大纲节点')

    // ③ 构思：只有构思清单；中栏是构思编辑面。
    await openBoard(wrapper, '构思')
    expect(sections()).toEqual(['构思'])
    expect(activePane()).toBe('notes.editor')
    expect(wrapper.find('[aria-label="正文编辑器"]').exists()).toBe(false)

    // ④ 世界书：只有条目树；中栏是条目阅读面。
    await openBoard(wrapper, '世界书')
    expect(sections()).toEqual(['世界书'])
    expect(activePane()).toBe('worldbook.entries')
    expect(wrapper.find('.entry-text').exists()).toBe(true)

    // ⑤ 设定：只有约束清单；中栏是约束编辑面（选中行后）。
    await openBoard(wrapper, '设定')
    expect(sections()).toEqual(['约束'])
    expect(activePane()).toBe('setting.rules')
    expect(wrapper.find('.entry-text').exists()).toBe(false)
    const ruleRow = wrapper.findAll('.nx-index-window .nx-tree-item').find((row) => row.text().includes('纪律'))
    await ruleRow.trigger('click')
    await flushPromises()
    // 批次43：约束面默认是阅读态（md 渲染出来的约束条目），要改先按「编辑」。
    expect(wrapper.find('[data-test="rule-rendered"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="约束编辑器"]').exists()).toBe(false)

    // ⑥ 资料：只有资料清单；中栏是资料阅读面。
    await openBoard(wrapper, '资料')
    expect(sections()).toEqual(['资料'])
    expect(activePane()).toBe('reference.documents')
    expect(wrapper.find('[aria-label="资料检索"]').exists()).toBe(true, '资料阅读面的检索入口在')
    expect(wrapper.text()).toContain('从左边索引窗里选一篇资料')
    wrapper.unmount()
  })

  it('换板不把上一栏的树级错误／警告带过来（一载体一棵本域内容树）', async () => {
    const tools = fakeTools()
    const original = tools.request
    tools.request = async (channel, payload) => {
      if (payload?.tool === 'pinax_worldbook_list') {
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: false, code: 'PINAX_IO_FAILED', message: '「世界书/」读失败：权限不足' } } }
      }
      return original(channel, payload)
    }
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await openBoard(wrapper, '世界书')
    expect(wrapper.find('.nx-index-window .nx-index-error').text()).toContain('「世界书/」读失败')

    // 换回小说：世界书那一栏的错误不挂在正文树上。
    await openBoard(wrapper, '小说')
    expect(wrapper.find('.nx-index-window .nx-index-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('「世界书/」读失败')
    wrapper.unmount()
  })

  it('pane 前缀就是路由：同一个 selection 换到别的栏不会串面', async () => {
    const tools = fakeTools({ notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }] })
    const data = useBoardData(tools)
    await data.loadNotes()
    data.openNote(data.notes[0])
    // 选中了一篇构思，但把小说栏的中栏挂上来：仍然只有正文面（不被 selection 拽去构思编辑器）。
    const chapterPane = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()
    expect(chapterPane.find('[aria-label="构思编辑器"]').exists()).toBe(false)
    expect(chapterPane.text()).toContain('从左边索引窗里选一章')
    chapterPane.unmount()

    // 反过来：没选中任何东西时，构思栏的中栏也是构思编辑面的空态，不落回正文。
    const fresh = useBoardData(fakeTools())
    const notePane = mount(CarrierPaneHost, { props: { pane: paneOf('notes.editor'), data: fresh } })
    await flushPromises()
    expect(notePane.find('[aria-label="正文编辑器"]').exists()).toBe(false)
    expect(notePane.text()).toContain('从左边索引窗里选一篇构思')
    notePane.unmount()
  })
})

describe('MD 原生渲染与剧本面（批次26）', () => {
  it('阅读态渲染 md：**粗体** 出 <strong>，标题出 <h1>；源文里的 HTML 当文字；编辑态仍是 textarea 源文', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadEntries()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data } })
    await flushPromises()

    // 阅读态：v-html 渲染层（.nx-rendered-md）替下纯文本 pre，md 语法变成真标签。
    data.entry = { ...data.entry, content: '# 柯秒\n\n这是**粗体**与*斜体*。\n\n- 一\n- 二\n' }
    await flushPromises()
    const rendered = wrapper.find('.entry-text.nx-rendered-md')
    expect(rendered.exists()).toBe(true)
    expect(rendered.html()).toContain('<strong>粗体</strong>')
    expect(rendered.html()).toContain('<em>斜体</em>')
    // 批次38：标题里的名字若命中其它条目的词表，会被包成 wikilink——两种形态都算对。
    expect(rendered.html()).toMatch(/<h1>(<a class="nx-wikilink" data-entry="[^"]*">)?柯秒<\/h1>/)
    expect(rendered.html()).toContain('<li>一</li>')

    // 作者在正文里手写 HTML：转义后当文字显示，不会被浏览器当标签执行。
    data.entry = { ...data.entry, content: '<script>alert(1)</script>普通文字' }
    await flushPromises()
    const escaped = wrapper.find('.entry-text.nx-rendered-md').html()
    expect(escaped).not.toContain('<script')
    expect(escaped).toContain('普通文字')

    // 编辑态：textarea 拿的是 md 源文，不经过渲染器。
    await wrapper.find('.entry-edit').trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor-area').element.value).toBe('<script>alert(1)</script>普通文字')
    wrapper.unmount()
  })

  it('剧本栏（批次26）：索引窗列剧本/，点开阅读态渲染 md，编辑保存走 pinax_script_save', async () => {
    const source = '# 第1集《牛肉汤》\n\n## 场1｜创世讲古\n\n白灼 旁白：**话说**，原初之年。\n'
    const tools = fakeTools({
      scripts: [{ index: 0, title: '第001集-牛肉汤', file: '剧本/第001集-牛肉汤.md', name: '第001集-牛肉汤.md', revision: 1, text: source, totalChars: source.length, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await openBoard(wrapper, '剧本')
    expect(tools.calls.some((call) => call.tool === 'pinax_script_list'), '换到剧本栏就列 剧本/').toBe(true)
    const row = wrapper.find('.nx-index-window').findAll('.nx-tree-item').find((item) => item.text().includes('第001集-牛肉汤'))
    expect(row, '剧本树里的行').toBeTruthy()

    await row.trigger('click')
    await flushPromises()
    const pane = () => wrapper.find('[data-pane-id="script.editor"]')
    expect(pane().find('[aria-label="剧本正文"]').html()).toContain('<strong>话说</strong>')
    expect(pane().find('textarea.editor-area').exists()).toBe(false)

    await pane().find('.script-edit').trigger('click')
    await flushPromises()
    const area = pane().find('textarea.editor-area')
    expect(area.element.value).toBe(source)
    await area.setValue(`${source}\n陆漫 画外音：好。\n`)
    await area.trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_script_save')
    expect(saved.args).toEqual({ file: '剧本/第001集-牛肉汤.md', text: `${source}\n陆漫 画外音：好。\n`, expectedRevision: 1 })
    expect(pane().find('.nx-save-chip').text()).toContain('已保存 · 第 2 版')
    // 保存成功后回到阅读态，正文以新一版为准。
    expect(pane().find('textarea.editor-area').exists()).toBe(false)
    expect(pane().find('[aria-label="剧本正文"]').html()).toContain('<strong>话说</strong>')
    wrapper.unmount()
  })
})

describe('Wiki 双链与反向链接（批次38）', () => {
  /**
   * 词表＝全名＋「·」后短名＋keys＋tags（CarrierPaneHost 的 entryLinkTokens）；
   * 反向链接＝其它条目 relations[].to 提到我，或正文包含我的全名（computeBacklinks）。
   * 这里用真 useBoardData 走 openEntry（pinax_worldbook_read 按 path），
   * 证明「点链接真的换了条目」而不是只画了个下划线。
   */
  const wikiEntries = [
    { id: 'wb-1', name: '人物·柯秒', keys: ['柯秒'], tags: ['主角'], path: '世界书/人物·柯秒.md', revision: 1, contract: true, content: '# 柯秒\n\n袖中有一枚停摆的表，与 物品·怀表 一同进城。', relations: [] },
    { id: 'wb-2', name: '物品·怀表', keys: [], tags: [], path: '世界书/物品·怀表.md', revision: 1, contract: true, content: '柯秒 袖口的表。', relations: [{ to: '人物·柯秒' }] },
    { id: null, name: '随手记', keys: [], tags: [], path: '世界书/随手记.md', revision: 1, contract: false, content: '一些还没整理的设定碎句。', relations: [] }
  ]

  it('条目名与短名包成可点 wikilink；点一下按 path 打开那条', async () => {
    const tools = fakeTools({ entries: wikiEntries })
    const data = useBoardData(tools)
    await data.loadEntries()
    // 先停在「随手记」，再切到柯秒：内容变了才触发阅读态的「渲染后链接化」看门狗
    // （与作者点开另一条同一条路径；名字与正文都没变的赋值不会重渲染）。
    await data.openEntry(data.entries[2])
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data } })
    await flushPromises()
    data.entry = { ...data.entries[0] }
    await flushPromises()

    const rendered = wrapper.find('.entry-text.nx-rendered-md')
    const full = rendered.find('a.nx-wikilink[data-entry="物品·怀表"]')
    expect(full.exists(), '全名进了词表').toBe(true)
    // 自己的名字与自己的 keys 不链自己；「柯秒」是别人的 key 时才有链接（这里没有别人叫柯秒）。
    expect(rendered.find('a.nx-wikilink[data-entry="人物·柯秒"]').exists()).toBe(false)

    await full.trigger('click')
    await flushPromises()
    const opened = tools.calls.filter((call) => call.tool === 'pinax_worldbook_read')
    expect(opened.at(-1).args).toEqual({ path: '世界书/物品·怀表.md' })
    expect(data.entry.name).toBe('物品·怀表')
    wrapper.unmount()
  })

  it('反向链接只认「relations 提到」或「正文含全名」，排除自己；chip 点开跳过去', async () => {
    const tools = fakeTools({ entries: wikiEntries })
    const data = useBoardData(tools)
    await data.loadEntries()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('worldbook.entries'), data } })
    await flushPromises()
    data.entry = { ...data.entries[0] }
    await flushPromises()

    const backlinks = wrapper.find('[data-test="entry-backlinks"]')
    expect(backlinks.exists(), '有反向链接才出现这一行').toBe(true)
    expect(backlinks.text()).toContain('物品·怀表')
    // 随手记正文只有「设定碎句」，没提「人物·柯秒」全名——不进反向链接。
    expect(backlinks.text()).not.toContain('随手记')

    await backlinks.find('button.entry-backlink').trigger('click')
    await flushPromises()
    expect(data.entry.name).toBe('物品·怀表')
    wrapper.unmount()
  })
})

describe('项目事件消费端（批次39）', () => {
  it('事件只刷已载入的树；编辑中／草稿开着时只重建树、不碰草稿', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    // 一棵树都没取过数：事件不能替作者打开任何东西。
    expect(await data.refreshFromProjectEvent('entries-changed')).toEqual([])
    expect(tools.calls.filter((call) => call.tool === 'pinax_worldbook_list')).toHaveLength(0)

    // 载入世界书 → 自动打开第一条；再进编辑态写一笔草稿。
    await data.loadEntries()
    const openedEntry = data.entry
    data.editingEntry = true
    data.entryDraft = '作者正在改，别覆盖'
    await data.refreshFromProjectEvent('entries-changed')
    expect(tools.calls.filter((call) => call.tool === 'pinax_worldbook_list')).toHaveLength(2)
    expect(data.entry).toBe(openedEntry)
    expect(data.entryDraft).toBe('作者正在改，别覆盖')

    // 大纲草稿开着＝作者在改：outline-changed 不重读（树也不重建，免得冲掉整份草稿）。
    await data.loadOutline()
    data.outlineDraft = { nodes: [{ id: 'n1', title: '作者在改' }], edges: [] }
    const outlineReads = tools.calls.filter((call) => call.tool === 'pinax_outline_read').length
    await data.refreshFromProjectEvent('outline-changed')
    expect(tools.calls.filter((call) => call.tool === 'pinax_outline_read')).toHaveLength(outlineReads)

    // 正文只重建索引：作者正在写的正文草稿一个字不动（章节没有编辑态开关，不能重读当前章）。
    await data.loadChapters()
    data.draft = '正在写的这一章，别重读'
    await data.refreshFromProjectEvent('manuscript-changed')
    expect(tools.calls.filter((call) => call.tool === 'pinax_chapter_list').length).toBeGreaterThanOrEqual(2)
    expect(data.draft).toBe('正在写的这一章，别重读')
  })

  it('AppNext 订阅 projectEvent：一拍内合并、只刷已载入的树、卸载退订', async () => {
    const tools = fakeTools()
    const handlers = new Map()
    const bridge = {
      request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      }
    }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(handlers.has(IPC_EVENT.projectEvent), '外壳订阅了项目事件').toBe(true)

    await openBoard(wrapper, '世界书')
    tools.calls.length = 0
    const emit = handlers.get(IPC_EVENT.projectEvent)
    emit({ kind: 'entries-changed' })
    emit({ kind: 'entries-changed' })
    await new Promise((resolve) => setTimeout(resolve, 220))
    await flushPromises()
    // 两条同类事件合并成一次 list；正文树没载入过，manuscript 的事件在这里根本不存在。
    expect(tools.calls.filter((call) => call.tool === 'pinax_worldbook_list')).toHaveLength(1)
    expect(tools.calls.filter((call) => call.tool === 'pinax_chapter_list')).toHaveLength(0)

    wrapper.unmount()
    expect(handlers.has(IPC_EVENT.projectEvent), '卸载后退订').toBe(false)
  })
})

describe('面板与运行时的边界', () => {
  it('认不出的 pane id 不空白也不假装可编辑：明说视图未实现，且一个工具都不调', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    // 批次26 起 script.* 有真视图了（剧本阅读/编辑面），这条用例改用还没有视图的板块（分镜）当靶子。
    const wrapper = mount(CarrierPaneHost, { props: { pane: { slot: 'center', id: 'storyboard.shots', title: '分镜', pluginId: 'pinax.carrier.storyboard', pluginTitle: '分镜' }, data } })
    await flushPromises()
    expect(wrapper.text()).toContain('这块板块的面板视图还没做出来')
    expect(wrapper.text()).toContain('「分镜」')
    expect(tools.calls).toHaveLength(0)
    wrapper.unmount()
  })

  it('中栏无面板时仍是解释而不是空白；核心区面板头 DOM 已整块删除（批次34）', () => {
    const wrapper = mount(CenterSlotHost, { props: { data: { error: null, notice: '' } } })
    expect(wrapper.text()).toContain('没有已启用的中栏面板')
    // 批次34：「正文／项目名」那一层不是隐藏，是不存在——载体身份在竖条、项目名在标题栏。
    expect(wrapper.find('.center-head').exists()).toBe(false)
    expect(wrapper.find('.center-title').exists()).toBe(false)
    expect(wrapper.find('.center-sub').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('尚未打开项目')
    wrapper.unmount()
  })

  it('右栏是一个对话框：问与答各占一行，开发者向的事实不出现在面上', async () => {
    const bridge = bridgeStub(shellView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({
        ok: true,
        value: {
          source: 'in-process-advisor',
          text: '开场那枚停摆的表可以提前到第一段。',
          result: {
            task: 'writing.chapter.health',
            mode: 'review',
            summary: '开场那枚停摆的表可以提前到第一段。',
            issues: [
              { type: 'review', severity: 'medium', message: '停摆表只被「摸了一下」，没推动动作。' },
              { type: 'review', severity: 'low', message: '槐巷的布幌、滴水没落地。' }
            ],
            action: ['把停摆表提到第一段之前。', '补两笔槐巷场景细节。']
          },
          meta: { provider: 'text-model', taskType: 'authoring.review.chapter', targetRevision: 'novel-chapter:正文/第002章.md:1', sourceRefs: ['setting-rules:约束/纪律.md', 'novel-chapter:正文/第002章.md'], budget: { usedChars: 18000, maxChars: 24000, truncated: true }, roundsUsed: 1, contextWarnings: ['世界书共 12 条可读条目，按提问命中取了 8 条进上下文。'] },
          context: { profile: 'writing-chapter', providerKinds: ['selection', 'rules', 'style', 'worldbook', 'outline'], missingKinds: [] }
        }
      })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: shellView().runtime, bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('开场能不能再狠一点？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    // 会话面：问句在右（老版的问句气泡靠右），回答在左。
    expect(wrapper.find('.authoring-knowledge__question-row').text()).toContain('开场能不能再狠一点？')
    expect(wrapper.find('.authoring-knowledge__answer-text').text()).toContain('开场那枚停摆的表可以提前到第一段。')

    // 模型答的审稿意见与动作是内容，摊在回答里。
    expect(wrapper.find('.authoring-knowledge__findings').text()).toContain('停摆表只被「摸了一下」，没推动动作。')
    expect(wrapper.find('.authoring-knowledge__actions').text()).toContain('把停摆表提到第一段之前。')

    // 开发者向的事实（出处、预算、任务类型、裁剪、接管数）不许出现在面上。
    const surface = wrapper.text()
    expect(surface).not.toContain('authoring.review.chapter')
    expect(surface).not.toContain('已裁剪')
    expect(surface).not.toContain('novel-chapter:正文/第002章.md')
    expect(surface).not.toContain('载体接管')
    expect(surface).not.toContain('写族闸')
    wrapper.unmount()
  })

  it('模型答的是结构化审稿：意见与动作都要摊开，不能只剩 summary 一行', async () => {
    const bridge = bridgeStub(shellView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({
        ok: true,
        value: {
          source: 'in-process-advisor',
          text: '章节约127字，远低于2000字目标。',
          result: {
            task: 'writing.chapter.health',
            mode: 'review',
            summary: '章节约127字，远低于2000字目标。',
            issues: [
              { type: 'review', severity: 'medium', message: '篇幅严重不足，只有127字。' },
              { type: 'review', severity: 'low', message: '缺少槐巷场景细节。' }
            ],
            action: ['补写第二节点：女人用时间差逼柯秒开口。', '补入场段落：雨夜槐巷、布幌、滴水。']
          },
          meta: { taskType: 'authoring.review.chapter' }
        }
      })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: shellView().runtime, bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('审一遍')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const findings = wrapper.find('.authoring-knowledge__findings')
    expect(findings.exists()).toBe(true)
    expect(findings.text()).toContain('审稿意见')
    expect(findings.text()).toContain('篇幅严重不足，只有127字。')
    expect(findings.text()).toContain('medium')
    expect(wrapper.find('.authoring-knowledge__actions').text()).toContain('可执行动作')
    expect(wrapper.find('.authoring-knowledge__actions').text()).toContain('补写第二节点：女人用时间差逼柯秒开口。')
    wrapper.unmount()
  })

  it('没有结构化结果时不留空壳：只显示模型原话', async () => {
    const bridge = bridgeStub(shellView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-advisor', text: '就一句话。' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: shellView().runtime, bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('问一句')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    expect(wrapper.find('.authoring-knowledge__findings').exists()).toBe(false)
    expect(wrapper.find('.authoring-knowledge__answer-text').text()).toContain('就一句话。')
    wrapper.unmount()
  })
})

/**
 * 应用面（批次44 · 作者 2026-10-31）：
 * 「后续假如我们真的要把 ComfyUI 挪进来，那一定是要通过浏览器去把这个端口承载起来，
 *   而不可能说我们自己手搓一个组件」
 *
 * 这一块就是那个「系统内嵌的浏览器」：宿主给一块 iframe，端口那个页面自己长什么样就是什么样。
 * 宿主不替插件画 ComfyUI 的工作流编辑器——那正是「手搓组件」的做法。
 */
describe('应用面（批次44）：外部端口上的网页由内嵌浏览器承载', () => {
  it('pane 声明 app.url 时给一块 iframe，地址摆出来给作者看', async () => {
    const data = useBoardData(fakeTools())
    const pane = {
      slot: 'center',
      id: 'comfy.canvas',
      title: 'ComfyUI',
      view: 'pinax.view.app',
      kind: 'external-app',
      app: { url: 'http://127.0.0.1:8188/' }
    }
    const wrapper = mount(CarrierPaneHost, { props: { pane, data } })
    await flushPromises()

    expect(wrapper.find('[data-test="external-app"]').exists()).toBe(true)
    const frame = wrapper.find('[data-test="external-app-frame"]')
    expect(frame.exists(), '应用面要给一块内嵌浏览器').toBe(true)
    expect(frame.attributes('src')).toBe('http://127.0.0.1:8188/')
    expect(frame.attributes('sandbox')).toContain('allow-scripts')
    // 地址摆出来：作者要能一眼看见自己开的是哪个端口（也能复制出去单开）。
    expect(wrapper.find('.nx-external-app-url').text()).toBe('http://127.0.0.1:8188/')
    expect(wrapper.find('[data-test="app-copy-url"]').exists(), '要另给「复制地址单开」').toBe(true)
    expect(wrapper.find('.doc-title').text()).toBe('ComfyUI')
    wrapper.unmount()
  })

  it('批次58：地址复制出去自己开（剪贴板拿到的是清单里声明的那个回环地址）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const data = useBoardData(fakeTools())
    const pane = {
      slot: 'center',
      id: 'comic.canvas',
      title: 'Toonflow 画布',
      view: 'pinax.view.app',
      kind: 'external-app',
      app: { url: 'http://127.0.0.1:3010' }
    }
    const wrapper = mount(CarrierPaneHost, { props: { pane, data } })
    await flushPromises()
    try {
      await wrapper.find('[data-test="app-copy-url"]').trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:3010')
      expect(wrapper.find('[data-test="app-copy-note"]').text()).toContain('已复制')
    } finally {
      vi.unstubAllGlobals()
      wrapper.unmount()
    }
  })

  it('批次54：工程覆盖可改应用面地址，来源标「工程覆盖」', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { overrides: { 'pinax.carrier.comic': { 'comic.canvas': 'http://127.0.0.1:8199/' } } }
    })
    vi.stubGlobal('pinaxNext', { request, channels: IPC_CHANNELS })
    try {
      const pane = {
        slot: 'center',
        id: 'comic.canvas',
        pluginId: 'pinax.carrier.comic',
        title: '画布',
        view: 'pinax.view.app',
        kind: 'external-app',
        app: { url: 'http://127.0.0.1:3010' }
      }
      const wrapper = mount(ExternalAppHost, { props: { pane } })
      await flushPromises()
      expect(request).toHaveBeenCalledWith(IPC_CHANNELS.carrierOverrides, {})
      expect(wrapper.find('[data-test="external-app-frame"]').attributes('src')).toBe('http://127.0.0.1:8199/')
      expect(wrapper.find('.nx-external-app-url').text()).toBe('http://127.0.0.1:8199/')
      expect(wrapper.find('[data-test="external-app-source"]').text()).toBe('工程覆盖')
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('批次54：覆盖值不是本机回环地址时按清单声明走，不猜 url', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { overrides: { 'pinax.carrier.comic': { 'comic.canvas': 'https://example.com/' } } }
    })
    vi.stubGlobal('pinaxNext', { request, channels: IPC_CHANNELS })
    try {
      const pane = {
        slot: 'center',
        id: 'comic.canvas',
        pluginId: 'pinax.carrier.comic',
        title: '画布',
        view: 'pinax.view.app',
        kind: 'external-app',
        app: { url: 'http://127.0.0.1:3010' }
      }
      const wrapper = mount(ExternalAppHost, { props: { pane } })
      await flushPromises()
      expect(wrapper.find('[data-test="external-app-frame"]').attributes('src')).toBe('http://127.0.0.1:3010')
      expect(wrapper.find('[data-test="external-app-source"]').exists()).toBe(false)
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('没声明地址时不摆空 iframe，如实说明', async () => {
    const data = useBoardData(fakeTools())
    const wrapper = mount(CarrierPaneHost, {
      props: { pane: { slot: 'center', id: 'comfy.canvas', title: 'ComfyUI', view: 'pinax.view.app', kind: 'external-app' }, data }
    })
    await flushPromises()

    expect(wrapper.find('[data-test="external-app-frame"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有声明地址')
    wrapper.unmount()
  })
})
