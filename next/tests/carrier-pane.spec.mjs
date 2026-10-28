import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import CenterSlotHost from '../shell/CenterSlotHost.vue'
import RuntimeDock from '../shell/RuntimeDock.vue'
import { useBoardData } from '../shell/useBoardData.mjs'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'

/**
 * M2 批次 4 之后的载体面板测试：目录树在索引窗，正文在核心区，两者共用同一份板块数据。
 * 这里的 fake 是「载体工具的信封」形状（{ok, value:{tool, owner, payload}}），
 * 与 next/tests/carrier-*.test.mjs 里真载体的返回一致——面板改读法而不改通道，这里就会红。
 */

function carrierCarriers() {
  return [
    { id: 'pinax.carrier.novel', title: '小说', isPrimary: true, isEnabled: true, dataDirs: ['正文', '大纲', '构思'], scopes: ['file:正文:rw', 'file:大纲:rw', 'file:构思:rw', 'agent:ask'], tools: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_outline_read', 'pinax_chapter_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard'], context: { providers: ['selection', 'outline'], budgetChars: 24000 }, capabilities: ['text.chapters', 'outline.tree', 'notes.ideas'], panes: [{ slot: 'left-dock', id: 'novel.shelf' }, { slot: 'center', id: 'novel.editor' }] },
    { id: 'pinax.carrier.setting', title: '设定', isPrimary: false, isEnabled: true, dataDirs: ['世界书', '约束'], scopes: ['file:世界书:rw', 'file:约束:rw', 'agent:ask'], tools: ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save'], context: { providers: ['rules', 'style', 'worldbook'], budgetChars: 20000 }, capabilities: ['setting.entries', 'constraint.rules'], panes: [{ slot: 'left-dock', id: 'setting.board' }, { slot: 'center', id: 'setting.entries' }] }
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

function fakeTools({ stale = false, chapterCount = 2, outlineMissing = false, notes = [], proposals = [], rules = [] } = {}) {
  const state = {
    revision: 1,
    text: '雨从檐口滴下来。',
    saved: null,
    proposals: proposals.map((item) => ({ ...item })),
    chapters: Array.from({ length: chapterCount }, (_item, index) => ({ index, title: `第00${index + 1}章`, file: `正文/第00${index + 1}章.md`, name: `第00${index + 1}章.md`, revision: 1 })),
    outlineNodes: [
      { id: 'n1', title: '开场：雨夜进城' },
      { id: 'n2', title: '第一折：停摆的表' }
    ],
    outlineEdges: [{ from: 'n1', to: 'n2' }],
    outlineRevision: 1,
    notes,
    rules: rules.map((item) => ({ ...item })),
    entries: [
      { id: 'wb-1', name: '人物·柯秒', type: 'character', tags: ['主角'], aliases: ['柯秒'], chars: 18, path: '世界书/人物·柯秒.md', revision: 1, contract: true },
      { id: null, name: '随手记', type: 'general', tags: [], aliases: [], chars: 9, path: '世界书/随手记.md', revision: 1, contract: false }
    ]
  }
  const calls = []
  async function request(channel, payload) {
    if (channel === IPC_CHANNELS.runtimeToolCall) {
      calls.push({ tool: payload.tool, args: payload.args })
      if (payload.tool === 'pinax_chapter_list') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, total: state.chapters.length, truncated: false, chapters: state.chapters } } }
      if (payload.tool === 'pinax_chapter_read') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: { ok: true, chapter: { index: 1, title: '第002章', file: payload.args.file ?? '正文/第002章.md' }, text: state.text, totalChars: state.text.length, truncated: false, revision: state.revision } } }
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
        const hit = state.entries.find((item) => (item.id && item.id === payload.args.id) || item.name === payload.args.name || item.name.includes(payload.args.name ?? ''))
        if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '「世界书/」里没有 查无此人' } } }
        const content = hit.savedText ?? (hit.name === '随手记' ? '一些还没整理的设定碎句。' : '冷穿越剧版主角，醒来在雪夜。')
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: true, entry: { ...hit, relations: [], keys: hit.aliases, content, contentChars: content.length, contentTruncated: false }, warnings: hit.contract ? [] : ['条目「随手记」未按世界书文件契约建档（未找到 frontmatter），返回的是整篇正文。'] } } }
      }
      if (payload.tool === 'pinax_worldbook_save') {
        const hit = state.entries.find((item) => item.path === payload.args.path)
        const actual = hit?.revision ?? 0
        if (!hit || payload.args.expectedRevision !== actual) {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: `「${payload.args.path}」已被改动（第 ${actual} 版）`, details: { actual } } } }
        }
        hit.revision += 1
        hit.savedText = payload.args.text
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
  const carrierId = id.startsWith('novel.') ? 'pinax.carrier.novel' : 'pinax.carrier.setting'
  const carrier = carrierCarriers().find((item) => item.id === carrierId)
  const declared = carrier.panes.find((pane) => pane.id === id) ?? { slot: 'center', id, title: id }
  return { ...declared, title: id === 'novel.editor' ? '正文' : id === 'novel.shelf' ? '书稿' : '条目', pluginId: carrierId, pluginTitle: carrier.title, primary: carrierId === 'pinax.carrier.novel' }
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
    left: [paneOf('novel.shelf'), paneOf('setting.board')],
    center: [paneOf('novel.editor'), paneOf('setting.entries')],
    skeletonDirs: ['正文', '大纲', '世界书', '构思', '资料', '日志', '约束'],
    archive: [],
    runtime: {
      title: RUNTIME_CONTRACT.title, builtIn: true, disableable: false, ownsSlot: 'right', budgetPriority: 100,
      writeSurface: RUNTIME_CONTRACT.writeSurface, reservedSlotReason: '右栏归运行时',
      started: true,
      surface: { carrierTools: 14, carrierToolNames: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_outline_read', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save'], aggregated: true, missingImplementations: [] },
      tools: [
        { name: 'pinax_chapter_read', title: 'pinax_chapter_read', owner: 'pinax.carrier.novel' },
        { name: 'pinax_worldbook_list', title: 'pinax_worldbook_list', owner: 'pinax.carrier.setting' },
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

describe('小说载体', () => {
  it('索引窗列章节、核心区是正文编辑器；所有取数只走 runtimeToolCall 一条通道', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    expect(tools.calls[0].tool).toBe('pinax_chapter_list')
    expect(tools.calls.some((call) => call.tool === 'pinax_chapter_read')).toBe(true)
    // 目录树在索引窗，正文在核心区——两者不再挤在同一块。
    // （工单B2 起大纲行也可点选：2 章节行 ＋ 2 大纲行＝4；构思夹具默认为空。）
    expect(wrapper.findAll('.nx-index-window .nx-tree-item')).toHaveLength(4)
    expect(wrapper.find('[data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-pane-id="novel.shelf"]').exists()).toBe(false)
    expect(wrapper.find('.editor-area').element.value).toBe('雨从檐口滴下来。')
    expect(wrapper.text()).toContain('第 1 版')
    expect(wrapper.text()).toContain('正文/第002章.md')
    wrapper.unmount()
  })

  it('保存带读到的修订号；服务端拒（版本不符）时把原话摊开，不静默覆盖', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadChapters()
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()

    await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。')
    await wrapper.find('.editor-foot .pane-btn.is-primary').trigger('click')
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_chapter_save')
    expect(saved.args).toEqual({ file: '正文/第002章.md', text: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1 })
    expect(wrapper.text()).toContain('已保存到「正文/第002章.md」· 第 2 版')

    const conflict = fakeTools({ stale: true })
    const conflictData = useBoardData(conflict)
    await conflictData.loadChapters()
    const second = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data: conflictData } })
    await flushPromises()
    await second.find('.editor-area').setValue('另一份改稿')
    await second.find('.editor-foot .pane-btn.is-primary').trigger('click')
    await flushPromises()
    expect(second.find('.pane-error').text()).toContain('已被改动（第 1 版）')
    expect(second.find('.pane-error').text()).toContain('外壳不做静默合并')
    expect(second.find('.editor-area').element.value).toBe('另一份改稿', '拒写后草稿仍在作者手里')
    wrapper.unmount()
    second.unmount()
  })

  it('存完之后索引窗里的版本号跟着走（索引窗与核心区共用同一份数据）', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await wrapper.find('.editor-area').setValue('雨从檐口滴下来，巷子里没人。')
    await wrapper.find('.editor-foot .pane-btn.is-primary').trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('.nx-index-window .nx-tree-item')
    // （工单B2 起大纲行也在 .nx-tree-item 里：按章节标题定位那一行。）
    expect(rows.find((row) => row.text().includes('第002章')).text()).toContain('第 2 版')
    wrapper.unmount()
  })

  it('索引窗第三棵树（工单A3 只读 → 工单B2 可点选）：空大纲给说明与「新建大纲」，不报错', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 换板 watch 随 loadChapters 一起取了大纲。
    expect(tools.calls.some((call) => call.tool === 'pinax_outline_read')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    const sections = indexWindow.findAll('.workspace-nav-section').map((node) => node.text())
    expect(sections).toContain('大纲')
    // 工单B2 起大纲行可点选（button 词汇，不再是静态 span）：行文仍是「序号＋标题」。
    const outlineRows = indexWindow.findAll('.nx-tree-item').filter((row) => row.text().includes('开场：雨夜进城') || row.text().includes('第一折'))
    expect(outlineRows).toHaveLength(2)
    expect(outlineRows[0].text()).toContain('1. 开场：雨夜进城')
    expect(outlineRows[0].element.tagName).toBe('BUTTON')
    wrapper.unmount()

    // 空大纲（工具对「两样都没有」回 INVALID_INPUT）：给一行说明＋「新建大纲」，不当成错误摊在索引窗。
    const missing = fakeTools({ outlineMissing: true })
    const missingBridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : missing.request(channel, payload)) }
    const second = mount(AppNext, { props: { bridge: missingBridge } })
    await flushPromises()
    expect(second.find('.nx-index-window').text()).toContain('大纲还没有内容（大纲/outline.json）')
    expect(second.find('.nx-index-error').exists()).toBe(false)
    second.unmount()
  })

  it('大纲节点改名（工单B2）：点行进中栏编辑面，标题改在草稿上，保存走 pinax_outline_save 并刷新版本', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const outlineRow = wrapper.findAll('.nx-tree-item').find((row) => row.text().includes('开场：雨夜进城'))
    await outlineRow.trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="大纲节点标题"]').exists()).toBe(true)

    await wrapper.find('[aria-label="大纲节点标题"]').setValue('开场：雪夜进城')
    await wrapper.find('.editor-foot .control-primary').trigger('click')
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_outline_save')
    expect(saved.args.expectedRevision).toBe(1)
    expect(saved.args.nodes.map((node) => node.title)).toEqual(['开场：雪夜进城', '第一折：停摆的表'])
    expect(wrapper.text()).toContain('已保存大纲 · 第 2 版 · 2 个节点')
    // 成功后就地刷新树：索引窗那行跟着改，修订号进第 2 版。
    expect(wrapper.findAll('.nx-tree-item').find((row) => row.text().includes('开场：雪夜进城'))).toBeTruthy()
    expect(wrapper.find('.editor-meta').text()).toContain('第 2 版')
    wrapper.unmount()
  })

  it('大纲加节点（工单B2）：同级紧随所选、子级多记一条连线；拒绝空 nodes 不发保存', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    await data.loadOutline()
    data.selectOutlineNode(1)
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()

    // 同级：插在「第一折」后面并选中它；子级：再往其后插一个，并记所选→新节点的连线（层级语义在 edges 里）。
    const addButtons = () => wrapper.findAll('.editor-foot .control-secondary')
    await addButtons()[0].trigger('click')
    await addButtons()[1].trigger('click')
    await wrapper.find('.editor-foot .control-primary').trigger('click')
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_outline_save')
    expect(saved.args.nodes).toHaveLength(4)
    expect(saved.args.nodes[1].title).toBe('第一折：停摆的表')
    expect(saved.args.nodes[2].title).toBe('未命名节点')
    expect(saved.args.nodes[3].title).toBe('未命名节点')
    expect(saved.args.nodes[2].id).not.toBe(saved.args.nodes[3].id)
    expect(saved.args.edges).toContainEqual({ from: saved.args.nodes[2].id, to: saved.args.nodes[3].id })
    expect(saved.args.edges).toContainEqual({ from: 'n1', to: 'n2' })
    expect(saved.args.expectedRevision).toBe(1)
    expect(wrapper.text()).toContain('已保存大纲 · 第 2 版 · 4 个节点')
    wrapper.unmount()
  })

  it('提案区（工单A）：行文＝目标章＋创建时刻；点开进中栏，采纳走 chapter_save 带当前修订号', async () => {
    const tools = fakeTools({ proposals: [{ ...PROPOSAL }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 提案区在章节树之后；行文是目标章标题＋createdAt 短格式。
    expect(tools.calls.some((call) => call.tool === 'pinax_proposal_list')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.findAll('.workspace-nav-section').map((node) => node.text())).toContain('提案')
    const proposalRow = indexWindow.findAll('.nx-tree-item').find((row) => row.text().includes('第002章-雨夜'))
    expect(proposalRow, '提案行在索引窗里').toBeTruthy()
    expect(proposalRow.text()).toContain('10-28 14:00')

    await proposalRow.trigger('click')
    await flushPromises()
    expect(proposalRow.classes()).toContain('is-active')
    expect(tools.calls.some((call) => call.tool === 'pinax_proposal_read')).toBe(true)

    // 中栏：头部给目标章／字数／createdAt／note，正文两段上下堆叠（当前正文＋提案新文）。
    const pane = wrapper.find('[data-pane-id="novel.editor"]')
    expect(pane.text()).toContain('提案 · 第002章-雨夜')
    expect(pane.text()).toContain('提案说明：把雨提前一段')
    expect(pane.text()).toContain('当前正文')
    expect(pane.text()).toContain('提案新文')
    expect(pane.find('.entry-text').text()).toBe('雨从檐口滴下来。')
    expect(pane.find('[aria-label="提案新文"]').text()).toBe('雨从檐口滴下来，巷子里没人。')
    expect(pane.text()).toContain('14 字')

    await pane.find('.editor-foot .pane-btn.is-primary').trigger('click')
    await flushPromises()
    const saved = tools.calls.filter((call) => call.tool === 'pinax_chapter_save').at(-1)
    expect(saved.args).toEqual({ file: '正文/第002章.md', text: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1, proposal: PROPOSAL.name })
    expect(wrapper.text()).toContain('已采纳提案，写入「正文/第002章.md」· 第 2 版')
    expect(tools.state.proposals[0].status).toBe('adopted')
    // 状态以重列回来的磁盘 JSON 为准：行上标出「已采纳」，提案仍在（采纳不是删除）。
    const adoptedRow = wrapper.findAll('.nx-tree-item').find((row) => row.text().includes('第002章-雨夜'))
    expect(adoptedRow.text()).toContain('已采纳')
    expect(tools.state.text).toBe('雨从檐口滴下来，巷子里没人。')
    wrapper.unmount()
  })

  it('提案弃用走 pinax_proposal_discard；STALE 时错误条摊开、按钮仍可重试', async () => {
    // 弃用：删提案文件，正文不动；索引窗那一区随「没有提案」收掉。
    const tools = fakeTools({ proposals: [{ ...PROPOSAL }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    const row = wrapper.findAll('.nx-tree-item').find((item) => item.text().includes('第002章-雨夜'))
    await row.trigger('click')
    await flushPromises()

    const discardButton = wrapper.find('[data-pane-id="novel.editor"] .editor-foot .control-quiet')
    expect(discardButton.text()).toBe('弃用')
    await discardButton.trigger('click')
    await flushPromises()
    const discarded = tools.calls.filter((call) => call.tool === 'pinax_proposal_discard').at(-1)
    expect(discarded.args).toEqual({ name: PROPOSAL.name })
    expect(tools.state.proposals).toHaveLength(0)
    expect(tools.state.text, '弃用不动正文').toBe('雨从檐口滴下来。')
    expect(wrapper.find('.nx-index-window').text()).not.toContain('提案')
    wrapper.unmount()

    // STALE：修订号对不上时原话摊开，按钮不被禁用（重开章节后可以再试）。
    const staleTools = fakeTools({ stale: true, proposals: [{ ...PROPOSAL }] })
    const staleBridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : staleTools.request(channel, payload)) }
    const second = mount(AppNext, { props: { bridge: staleBridge } })
    await flushPromises()
    const staleRow = second.findAll('.nx-tree-item').find((item) => item.text().includes('第002章-雨夜'))
    await staleRow.trigger('click')
    await flushPromises()
    await second.find('[data-pane-id="novel.editor"] .editor-foot .control-primary').trigger('click')
    await flushPromises()

    const error = second.find('.pane-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('已被改动（第 1 版）')
    expect(error.text()).toContain('提案已过期')
    expect(staleTools.state.proposals[0].status, '拒写不推进提案状态').toBe('proposed')
    const retry = second.find('[data-pane-id="novel.editor"] .editor-foot .control-primary')
    expect(retry.attributes('disabled')).toBeUndefined()
    second.unmount()
  })

  it('新建章节走 expectedRevision 0', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await wrapper.find('.nx-index-new .nx-field').setValue('第003章-雪夜')
    await wrapper.find('.nx-index-new .nx-index-add').trigger('click')
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_chapter_save' && call.args.title)
    expect(created.args).toEqual({ title: '第003章-雪夜', text: '第003章-雪夜\n', expectedRevision: 0 })
    wrapper.unmount()
  })

  it('构思速记（工单B1）：索引窗第四棵树行可点开，正文来自 pinax_notes_list 的随手带回', async () => {
    const tools = fakeTools({ notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }] })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 换板 watch 随章节一起列了构思。
    expect(tools.calls.some((call) => call.tool === 'pinax_notes_list')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.text()).toContain('构思')
    const noteRow = indexWindow.findAll('.nx-tree-item').find((row) => row.text().includes('雨夜的表'))
    expect(noteRow, '构思区在章节树之后').toBeTruthy()

    // 点行开篇：不再发第二次读（正文随列表回来），核心区换构思编辑面。
    const callsBeforeOpen = tools.calls.length
    await noteRow.trigger('click')
    await flushPromises()
    expect(tools.calls.length).toBe(callsBeforeOpen)
    expect(noteRow.classes()).toContain('is-active')
    expect(wrapper.find('[aria-label="构思编辑器"]').exists()).toBe(true)
    expect(wrapper.find('.editor-area').element.value).toBe('袖口的表停在十二点差三分。')
    expect(wrapper.text()).toContain('已载入 14 字 · 第 1 版')
    wrapper.unmount()
  })

  it('构思保存走 pinax_notes_save 带修订号；面板尾部「新构思标题」新建走 expectedRevision 0', async () => {
    const tools = fakeTools({ notes: [{ index: 0, title: '雨夜的表', file: '构思/雨夜的表.md', name: '雨夜的表.md', revision: 1, text: '袖口的表停在十二点差三分。', totalChars: 14, truncated: false }] })
    const data = useBoardData(tools)
    await data.loadNotes()
    data.openNote(data.notes[0])
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('novel.editor'), data } })
    await flushPromises()

    await wrapper.find('[aria-label="构思编辑器"]').setValue('表针在雨夜重新走了起来。')
    await wrapper.find('.editor-foot .control-primary').trigger('click')
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_notes_save' && call.args.file)
    expect(saved.args).toEqual({ file: '构思/雨夜的表.md', text: '表针在雨夜重新走了起来。', expectedRevision: 1 })
    expect(wrapper.text()).toContain('已保存到「构思/雨夜的表.md」· 第 2 版')

    // 新建：工具拒空 text，所以以标题作首行落盘，修订号 0；随后列一次并打开新篇。
    await wrapper.find('.notes-new .nx-field').setValue('巷尾的钟楼')
    await wrapper.find('.notes-new .nx-index-add').trigger('click')
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_notes_save' && call.args.title)
    expect(created.args).toEqual({ title: '巷尾的钟楼', text: '巷尾的钟楼\n', expectedRevision: 0 })
    expect(wrapper.find('[aria-label="构思编辑器"]').element.value).toBe('巷尾的钟楼\n')
    expect(wrapper.text()).toContain('构思/巷尾的钟楼.md')
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
    expect(carrier.context.providers).toEqual(['selection', 'outline'])
    wrapper.unmount()
  })
})

describe('设定载体', () => {
  it('世界书条目在索引窗里列，核心区读得到；未建档的条目在两头都标出来', async () => {
    const tools = fakeTools()
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 切到「设定」那块板：索引窗换成世界书条目树，核心区换成条目详情。
    await wrapper.findAll('.nx-ribbon-item')[1].trigger('click')
    await flushPromises()

    expect(tools.calls.some((call) => call.tool === 'pinax_worldbook_list')).toBe(true)
    const rows = wrapper.findAll('.nx-index-window .nx-tree-item')
    expect(rows).toHaveLength(2)
    expect(rows[1].text()).toContain('未建档')
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
      if (payload?.tool === 'pinax_worldbook_read') return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.setting', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '「世界书/」里没有 查无此人' } } }
      return original(channel, payload)
    }
    const data = useBoardData(tools)
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('setting.entries'), data } })
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
    const wrapper = mount(CarrierPaneHost, { props: { pane: paneOf('setting.entries'), data } })
    await flushPromises()

    // 阅读态：entry-text 摊开正文，entry-head 里有「编辑」；还没有 textarea。
    expect(wrapper.find('.entry-text').exists()).toBe(true)
    expect(wrapper.find('.entry-edit').text()).toBe('编辑')
    expect(wrapper.find('.editor-area').exists()).toBe(false)

    await wrapper.find('.entry-edit').trigger('click')
    await flushPromises()
    // 编辑态：entry-text 换成 textarea，草稿从读到的正文起。
    expect(wrapper.find('.entry-text').exists()).toBe(false)
    const area = wrapper.find('.editor-area')
    expect(area.element.value).toBe('冷穿越剧版主角，醒来在雪夜。')

    await area.setValue('冷穿越剧版主角，醒来在雪夜，袖中多了一枚停摆的表。')
    await wrapper.find('.editor-foot .control-primary').trigger('click')
    await flushPromises()

    const saved = tools.calls.find((call) => call.tool === 'pinax_worldbook_save')
    expect(saved.args).toEqual({ path: '世界书/人物·柯秒.md', text: '冷穿越剧版主角，醒来在雪夜，袖中多了一枚停摆的表。', expectedRevision: 1 })
    // 保存成功：退出编辑态，重读把版本号与正文一起刷新。
    expect(wrapper.find('.entry-text').exists()).toBe(true)
    expect(wrapper.find('.entry-meta').text()).toContain('第 2 版')
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

  it('约束（工单E2）：索引窗「约束」区列篇目，点开进约束编辑面；保存与新建都走 pinax_rule_save', async () => {
    const tools = fakeTools({
      rules: [{ index: 0, title: '纪律', file: '约束/纪律.md', name: '纪律.md', revision: 1, text: '- 不许出现现代词\n', totalChars: 10, truncated: false }]
    })
    const bridge = { request: async (channel, payload) => (channel === IPC_CHANNELS.view ? { ok: true, value: shellView() } : tools.request(channel, payload)) }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 切到「设定」那块板：条目树之后是约束区，换板一次列两棵树。
    await wrapper.findAll('.nx-ribbon-item')[1].trigger('click')
    await flushPromises()
    expect(tools.calls.some((call) => call.tool === 'pinax_rule_list')).toBe(true)
    const indexWindow = wrapper.find('.nx-index-window')
    expect(indexWindow.text()).toContain('约束')
    const ruleRow = indexWindow.findAll('.nx-tree-item').find((row) => row.text().includes('纪律'))
    expect(ruleRow, '约束区里的行').toBeTruthy()

    // 点行开篇：正文随列表回来，不再发第二次读；核心区换约束编辑面。
    const callsBeforeOpen = tools.calls.length
    await ruleRow.trigger('click')
    await flushPromises()
    expect(tools.calls.length).toBe(callsBeforeOpen)
    expect(ruleRow.classes()).toContain('is-active')
    expect(wrapper.find('[aria-label="约束编辑器"]').exists()).toBe(true)
    expect(wrapper.find('.editor-area').element.value).toBe('- 不许出现现代词\n')
    expect(wrapper.text()).toContain('已载入 10 字 · 第 1 版')

    // 保存：带读到的修订号走 pinax_rule_save，版本号就地推进。
    await wrapper.find('[aria-label="约束编辑器"]').setValue('- 不许出现现代词\n- 每章 2000 字\n')
    await wrapper.find('.editor-foot .control-primary').trigger('click')
    await flushPromises()
    const saved = tools.calls.find((call) => call.tool === 'pinax_rule_save' && call.args.file)
    expect(saved.args).toEqual({ file: '约束/纪律.md', text: '- 不许出现现代词\n- 每章 2000 字\n', expectedRevision: 1 })
    expect(wrapper.text()).toContain('已保存到「约束/纪律.md」· 第 2 版')

    // 新建：面板尾部「新约束标题」走 expectedRevision 0，标题作首行落盘。
    await wrapper.find('[aria-label="新约束标题"]').setValue('文风')
    await wrapper.find('.notes-new .nx-index-add').trigger('click')
    await flushPromises()
    const created = tools.calls.find((call) => call.tool === 'pinax_rule_save' && call.args.title)
    expect(created.args).toEqual({ title: '文风', text: '文风\n', expectedRevision: 0 })
    expect(wrapper.find('[aria-label="约束编辑器"]').element.value).toBe('文风\n')
    wrapper.unmount()
  })
})

describe('面板与运行时的边界', () => {
  it('认不出的 pane id 不空白也不假装可编辑：明说视图未实现，且一个工具都不调', async () => {
    const tools = fakeTools()
    const data = useBoardData(tools)
    const wrapper = mount(CarrierPaneHost, { props: { pane: { slot: 'center', id: 'script.scenes', title: '场次', pluginId: 'pinax.carrier.script', pluginTitle: '剧本' }, data } })
    await flushPromises()
    expect(wrapper.text()).toContain('这块板块的面板视图还没做出来')
    expect(wrapper.text()).toContain('「剧本」')
    expect(tools.calls).toHaveLength(0)
    wrapper.unmount()
  })

  it('中栏无面板时仍是解释而不是空白', () => {
    const wrapper = mount(CenterSlotHost, { props: { data: { error: null, notice: '' }, project: null } })
    expect(wrapper.text()).toContain('没有已启用的中栏面板')
    expect(wrapper.text()).toContain('尚未打开项目')
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
