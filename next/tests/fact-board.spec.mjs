import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'
import { useBoardData } from '../shell/useBoardData.mjs'
import { stableEntryId } from '../fact/domain/pediaSchema.js'

/**
 * 看板数据源切换（S1 · WO-S1-04）· jsdom 双分支：
 *   有 `拆解/*.json` → 条目走 fact:list（entriesSource='fact'，不再发 pinax_worldbook_list）；
 *   没有 → 原样走既有 世界书/*.md（entriesSource='worldbook'，零回归）。
 * 版式与 EntriesBoard 不在本用例里：这里钉的是数据面（useBoardData 的 entries 加载处）。
 */

const ROOT = 'D:/books/停摆之城'
const FACT_ROOT = 'D:/books/拆解书'

function factEntry(name = '停摆的表') {
  const layer = 'worldview'
  const domain = '停摆之城'
  const slot = 'items'
  return {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer, domain, slot, name }),
    layer,
    name,
    domain,
    slot,
    status: 'draft',
    definition: `${name}的说明。`,
    aliases: [],
    relations: [],
    fingerprint: { vec: null, metrics: { chars: 8 } },
    provenance: { mode: 'analyze', book: '停摆之城', book_id: 'book-tower', chapters: [2], scenes: [], extractor: 'test' }
  }
}

function worldbookEntry(name = '手写条目') {
  return {
    id: 'wb-1',
    name,
    type: 'general',
    tags: [],
    aliases: [],
    chars: 4,
    path: `世界书/${name}.md`,
    revision: 1,
    contract: true,
    summary: '手写世界书条目。'
  }
}

function makeBridge({ root = ROOT, factResult, worldbookEntries = [worldbookEntry()] } = {}) {
  const calls = []
  const bridge = {
    calls,
    async request(channel, payload = {}) {
      calls.push({ channel, payload })
      if (channel === IPC_CHANNELS.view) {
        return root
          ? { ok: true, value: { project: { root } } }
          : { ok: true, value: { project: null } }
      }
      if (channel === IPC_CHANNELS.factList) {
        if (typeof factResult === 'function') return factResult(payload)
        return factResult ?? { ok: true, entries: [], total: 0, warnings: [] }
      }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_worldbook_list') {
          return { ok: true, value: { payload: { ok: true, entries: worldbookEntries, categories: [], warnings: [] } } }
        }
        if (payload.tool === 'pinax_worldbook_read') {
          const entry = worldbookEntries.find((item) => item.path === payload.args?.path) ?? worldbookEntries[0]
          return { ok: true, value: { payload: { ok: true, entry: { ...entry, relations: [] } } } }
        }
        return { ok: true, value: { payload: { ok: true } } }
      }
      return { ok: true, value: {} }
    }
  }
  return bridge
}

describe('世界书板数据源（S1 · fact / 世界书双分支）', () => {
  it('库根有拆解数据：条目走 fact:list，带上 root，不再发世界书列举', async () => {
    const bridge = makeBridge({
      root: FACT_ROOT,
      factResult: { ok: true, entries: [factEntry('停摆的表'), factEntry('雨夜的巷子')], total: 2, warnings: [] }
    })
    const data = useBoardData(bridge)
    await data.loadEntries()

    expect(data.entriesSource).toBe('fact')
    expect(data.entries).toHaveLength(2)
    expect(data.entries.map((entry) => entry.name)).toEqual(['停摆的表', '雨夜的巷子'])
    // fact:list 显式带 root（不依赖 session 当前项目）
    const factCall = bridge.calls.find((call) => call.channel === IPC_CHANNELS.factList)
    expect(factCall.payload).toMatchObject({ root: FACT_ROOT })
    // 世界书那条老路一次都没走
    expect(bridge.calls.some((call) => call.channel === IPC_CHANNELS.runtimeToolCall && call.payload.tool === 'pinax_worldbook_list')).toBe(false)
    // 首条自动落选中（与既有口径一致），详情面有内容可读
    expect(data.entry?.name).toBe('停摆的表')
    expect(data.selection?.type).toBe('entry')
    // v3 真值随投影保留（S3 换版式用）
    expect(data.entries[0].layer).toBe('worldview')
    expect(data.entries[0].status).toBe('draft')
    expect(data.entries[0].extra.fact.chapters).toEqual([2])
  })

  it('普通项目没有拆解数据：原样走 世界书/*.md（零回归）', async () => {
    const bridge = makeBridge({
      factResult: { ok: true, entries: [], total: 0, warnings: [{ code: 'FACT_DIR_MISSING', message: '' }] }
    })
    const data = useBoardData(bridge)
    await data.loadEntries()

    expect(data.entriesSource).toBe('worldbook')
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].name).toBe('手写条目')
    expect(bridge.calls.some((call) => call.channel === IPC_CHANNELS.runtimeToolCall && call.payload.tool === 'pinax_worldbook_list')).toBe(true)
  })

  it('fact 通道失败／未接入：如实回落世界书，不把错误摊到树上', async () => {
    const bridge = makeBridge({
      factResult: { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '事实存储未接入' } }
    })
    const data = useBoardData(bridge)
    await data.loadEntries()

    expect(data.entriesSource).toBe('worldbook')
    expect(data.entries).toHaveLength(1)
    expect(data.treeError).toBe(null)
  })

  it('取不到项目根（未打开项目）：不发 fact 请求，直接走既有世界书路径', async () => {
    const bridge = makeBridge({ root: null })
    const data = useBoardData(bridge)
    await data.loadEntries()

    expect(data.entriesSource).toBe('worldbook')
    expect(bridge.calls.some((call) => call.channel === IPC_CHANNELS.factList)).toBe(false)
  })

  it('切到拆解数据后点条目不再发 pinax_worldbook_read（条目已在数据面）', async () => {
    const bridge = makeBridge({
      root: FACT_ROOT,
      factResult: { ok: true, entries: [factEntry('停摆的表')], total: 1, warnings: [] }
    })
    const data = useBoardData(bridge)
    await data.loadEntries()
    const before = bridge.calls.length
    await data.openEntry(data.entries[0])
    const after = bridge.calls.slice(before)
    expect(after.some((call) => call.channel === IPC_CHANNELS.runtimeToolCall && call.payload.tool === 'pinax_worldbook_read')).toBe(false)
    expect(data.entry?.name).toBe('停摆的表')
  })
})
