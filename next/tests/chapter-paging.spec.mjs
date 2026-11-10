import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData } from '../shell/useBoardData.mjs'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 批次55：正文阅读面分页读（preview.loading 两档）＋ 每页各自的 Wiki 双链。
 *
 * 验收口径：
 *   - text-pages：首屏只渲染当前页，翻页才补下一页（大稿走 pinax_chapter_read 的 offset／maxChars）；
 *   - bytes-complete：整读照旧（小文件、写前校验用）；
 *   - 跨页不残留旧蓝链：词表按当前页文本现算，换页时 :key 重渲染整块阅读面。
 */

const PAGE = 2400
const FILE = '正文/第001章.md'

function wrap(payload, body) {
  return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: body } }
}

function fakeBridge(text) {
  const calls = []
  async function request(channel, payload = {}) {
    if (channel !== IPC_CHANNELS.runtimeToolCall) {
      return { ok: false, error: { message: `未接通道：${channel}` } }
    }
    if (payload.tool === 'pinax_chapter_list') {
      return wrap(payload, {
        ok: true,
        total: 1,
        truncated: false,
        chapters: [{ index: 0, title: '第001章', file: FILE, revision: 1 }]
      })
    }
    if (payload.tool === 'pinax_chapter_read') {
      const args = { ...payload.args }
      calls.push({ tool: payload.tool, args })
      const offset = Number.isSafeInteger(args.offset) ? args.offset : 0
      const maxChars = Number.isSafeInteger(args.maxChars) ? args.maxChars : 20000
      const slice = text.slice(offset, offset + maxChars)
      return wrap(payload, {
        ok: true,
        chapter: { index: 0, title: '第001章', file: FILE },
        text: slice,
        totalChars: text.length,
        truncated: offset + slice.length < text.length,
        revision: 1,
        offset
      })
    }
    if (payload.tool === 'pinax_chapter_save') {
      return wrap(payload, { ok: true, file: payload.args.file, revision: 2, created: false, bytes: payload.args.text.length })
    }
    return wrap(payload, { ok: false, code: 'PINAX_INVALID_INPUT', message: '未知工具' })
  }
  return { request, calls }
}

async function mountPane({ text, pane = {} } = {}) {
  const bridge = fakeBridge(text)
  const data = useBoardData(bridge)
  await data.loadChapters()
  const wrapper = mount(CarrierPaneHost, {
    props: {
      pane: { id: 'novel.editor', title: '正文', ...pane },
      data
    }
  })
  await flushPromises()
  await nextTick()
  return { wrapper, data, bridge }
}

describe('正文分页读（批次55 · text-pages / bytes-complete）', () => {
  it('text-pages：首屏只渲染第一页，翻页才看下一页', async () => {
    const page1 = `沈青梧${'甲'.repeat(PAGE - 3)}`
    const page2 = '乙'.repeat(PAGE)
    const { wrapper } = await mountPane({ text: page1 + page2 })

    const reading = wrapper.find('[data-test="chapter-rendered"]')
    expect(reading.attributes('data-page-mode')).toBe('text-pages')
    expect(reading.attributes('data-page-chars')).toBe(String(PAGE))
    expect(reading.text()).toContain('沈青梧')
    expect(reading.text()).not.toContain('乙')
    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).toBe('1 / 2')

    await wrapper.find('[data-test="chapter-page-next"]').trigger('click')
    await flushPromises()
    const second = wrapper.find('[data-test="chapter-rendered"]')
    expect(second.text()).toContain('乙')
    expect(second.text()).not.toContain('沈青梧')
    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).toBe('2 / 2')
    expect(wrapper.find('[data-test="chapter-page-next"]').attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('text-pages：只载入前段的大稿，草稿之外的分页经 offset／maxChars 懒补', async () => {
    const full = 'A'.repeat(PAGE * 10)
    const { wrapper, bridge } = await mountPane({ text: full })

    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).toBe('1 / 10')
    expect(wrapper.find('[data-test="chapter-rendered"]').text().length).toBe(PAGE)
    expect(bridge.calls.filter((call) => call.tool === 'pinax_chapter_read')).toHaveLength(1)

    // 0 → 8：第 8 页跨过已载入的 20000 字，后半页必须现补。
    for (let step = 0; step < 8; step += 1) {
      await wrapper.find('[data-test="chapter-page-next"]').trigger('click')
      await flushPromises()
    }
    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).toBe('9 / 10')
    expect(wrapper.find('[data-test="chapter-rendered"]').text().length).toBe(PAGE)
    const lazyCalls = bridge.calls.filter((call) => call.tool === 'pinax_chapter_read' && call.args.offset === 20000)
    expect(lazyCalls).toHaveLength(1)
    expect(lazyCalls[0].args.maxChars).toBe(PAGE - 800)

    wrapper.unmount()
  })

  it('bytes-complete：整读照旧，不出分页条', async () => {
    const page1 = `沈青梧${'甲'.repeat(PAGE - 3)}`
    const page2 = '乙'.repeat(PAGE)
    const { wrapper } = await mountPane({
      text: page1 + page2,
      pane: { preview: { loading: 'bytes-complete' } }
    })

    const reading = wrapper.find('[data-test="chapter-rendered"]')
    expect(reading.attributes('data-page-mode')).toBe('bytes-complete')
    expect(reading.text()).toContain('沈青梧')
    expect(reading.text()).toContain('乙')
    expect(wrapper.find('[data-test="chapter-pager"]').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('分页后的 Wiki 双链（批次55 · 跨页不残留旧蓝链）', () => {
  it('词表按当前页现算；换页后旧页的蓝链不跟着留下，翻回来才重新链上', async () => {
    const page1 = `沈青梧${'甲'.repeat(PAGE - 3)}`
    const page2 = '乙'.repeat(PAGE)
    const { wrapper, data } = await mountPane({ text: page1 + page2 })
    data.entries.push({ name: '沈青梧', path: '世界书/沈青梧.md' })
    await flushPromises()
    await nextTick()

    const opened = []
    data.openEntry = vi.fn(async (item) => { opened.push(item) })
    await flushPromises()
    await nextTick()

    expect(wrapper.findAll('.nx-wikilink')).toHaveLength(1)
    expect(wrapper.find('.nx-wikilink').attributes('data-entry')).toBe('沈青梧')
    await wrapper.find('.nx-wikilink').trigger('click')
    expect(opened.map((item) => item.path)).toEqual(['世界书/沈青梧.md'])

    // 第二页没有「沈青梧」：上一页的锚点一个都不许留在 DOM 上。
    await wrapper.find('[data-test="chapter-page-next"]').trigger('click')
    await flushPromises()
    await nextTick()
    expect(wrapper.find('[data-test="chapter-rendered"]').text()).not.toContain('沈青梧')
    expect(wrapper.findAll('.nx-wikilink')).toHaveLength(0)

    // 翻回第一页：重新按这一页的词表现链，仍只有一个、仍点得动。
    await wrapper.find('[data-test="chapter-page-prev"]').trigger('click')
    await flushPromises()
    await nextTick()
    expect(wrapper.findAll('.nx-wikilink')).toHaveLength(1)
    expect(wrapper.find('.nx-wikilink').attributes('data-entry')).toBe('沈青梧')

    wrapper.unmount()
  })

  it('唯一归属纪律照旧：两条条目共用的词不进词表，不染蓝', async () => {
    const page1 = `记忆${'甲'.repeat(PAGE - 2)}`
    const page2 = '乙'.repeat(PAGE)
    const { wrapper, data } = await mountPane({ text: page1 + page2 })
    data.entries.push(
      { name: '甲条目', path: '世界书/甲.md', tags: ['记忆'] },
      { name: '乙条目', path: '世界书/乙.md', tags: ['记忆'] }
    )
    await flushPromises()
    await nextTick()

    expect(wrapper.find('[data-test="chapter-rendered"]').text()).toContain('记忆')
    expect(wrapper.findAll('.nx-wikilink')).toHaveLength(0)

    wrapper.unmount()
  })
})
