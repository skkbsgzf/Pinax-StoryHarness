import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData } from '../shell/useBoardData.mjs'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 批次68-R6 任务二：正文「点入即改」＋失焦／Ctrl+S 保存回渲染态＋大稿整章展开。
 *
 * 验收口径（工单）：
 *   - click-to-edit：阅读面点一段就地接稿——「编辑」钮已退役（判据㉑的另一半在
 *     visual-contract 声明级，这里跑的是运行时行为）；蓝链先吸掉点击，不进编辑态；
 *   - blur-commit / ctrlS-commit：两条收口同一条 commit——有改动才落盘，
 *     只点开看一眼不推修订号；落盘被拒（版本冲突）留在编辑态，稿子在作者手里；
 *   - expand-whole：只载入前段的大稿，进编辑（或插入落字）前先把后半段补载完整，
 *     「保存回渲染态」写回的是整章，不抹后段；展开不置脏（「只载入前段」的提示随之退场）。
 */

const FILE = '正文/第001章.md'

function wrap(payload, body) {
  return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.novel', payload: body } }
}

function fakeBridge(text, { stale = false } = {}) {
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
      calls.push({ tool: payload.tool, args: { ...payload.args } })
      if (stale) {
        return wrap(payload, { ok: false, code: 'PINAX_STALE_REVISION', message: '这一版已被改动（第 1 版）' })
      }
      return wrap(payload, { ok: true, file: FILE, revision: 2, created: false, bytes: payload.args.text.length })
    }
    return wrap(payload, { ok: false, code: 'PINAX_INVALID_INPUT', message: '未知工具' })
  }
  return { request, calls }
}

async function mountPane({ text, stale = false } = {}) {
  const bridge = fakeBridge(text, { stale })
  const data = useBoardData(bridge)
  await data.loadChapters()
  const wrapper = mount(CarrierPaneHost, {
    props: { pane: { id: 'novel.editor', title: '正文' }, data }
  })
  await flushPromises()
  await nextTick()
  return { wrapper, data, bridge }
}

const SHORT = `沈青梧把信折成三折。${'甲'.repeat(40)}\n\n巷口的灯灭了一瞬。${'乙'.repeat(40)}`

describe('点入即改（批次68-R6 任务二 · click-to-edit）', () => {
  it('阅读面点一段＝就地接稿：textarea 拿整稿，分页条让位；「编辑」钮不在版面', async () => {
    const { wrapper } = await mountPane({ text: SHORT })
    expect(wrapper.find('[data-test="chapter-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="chapter-rendered"]').attributes('data-click-to-edit')).toBe('chapter')
    expect(wrapper.find('.editor-area').exists()).toBe(false)

    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    const area = wrapper.find('.editor-area')
    expect(area.exists()).toBe(true)
    expect(area.element.value).toBe(SHORT)
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('蓝链先吸掉点击：点词不开编辑态，条目照旧走词表', async () => {
    const { wrapper, data } = await mountPane({ text: SHORT })
    data.entries.push({ name: '沈青梧', path: '世界书/沈青梧.md' })
    await flushPromises()
    await nextTick()
    data.openEntry = async () => {}
    await flushPromises()

    expect(wrapper.findAll('.nx-wikilink')).toHaveLength(1)
    await wrapper.find('.nx-wikilink').trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor-area').exists()).toBe(false)

    wrapper.unmount()
  })

  it('失焦＝保存回渲染态；没改过的一下不推修订号（只多了一次看）', async () => {
    const { wrapper, bridge } = await mountPane({ text: SHORT })

    // 没改字：点进编辑 → 焦点离开面板 → 回阅读态，一次 save 都没有。
    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    await wrapper.find('.editor-area').trigger('blur')
    await flushPromises()
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(true)
    expect(bridge.calls.filter((call) => call.tool === 'pinax_chapter_save')).toHaveLength(0)

    // 改了字：同一条收口变成「保存并回渲染态」，payload 带读到的修订号。
    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    await wrapper.find('.editor-area').setValue(`${SHORT}\n柯秒没有回头。`)
    await wrapper.find('.editor-area').trigger('blur')
    await flushPromises()
    const saved = bridge.calls.filter((call) => call.tool === 'pinax_chapter_save')
    expect(saved).toHaveLength(1)
    expect(saved[0].args.expectedRevision).toBe(1)
    expect(saved[0].args.text).toBe(`${SHORT}\n柯秒没有回头。`)
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(true)
    expect(wrapper.find('.nx-save-chip').text()).toContain('已保存 · 第 2 版')

    wrapper.unmount()
  })

  it('Ctrl+S＝与失焦同一条收口；落盘被拒留在编辑态，稿子在作者手里', async () => {
    const { wrapper, bridge } = await mountPane({ text: SHORT })
    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    await wrapper.find('.editor-area').setValue(`${SHORT}\n雨停在半空。`)
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    expect(bridge.calls.some((call) => call.tool === 'pinax_chapter_save')).toBe(true)
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(true)
    wrapper.unmount()

    // 版本冲突：不退出编辑态——退路是 chip 上的「重新载入」，不是把稿子藏回渲染面。
    const failed = await mountPane({ text: SHORT, stale: true })
    await failed.wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    await failed.wrapper.find('.editor-area').setValue('另一份改稿')
    await failed.wrapper.find('.editor-area').trigger('blur')
    await flushPromises()
    expect(failed.wrapper.find('.editor-area').exists()).toBe(true)
    expect(failed.wrapper.find('.editor-area').element.value).toBe('另一份改稿')
    expect(failed.wrapper.find('.nx-save-chip').classes()).toContain('is-error')
    failed.wrapper.unmount()
  })

  it('取消仍是编辑态的退路：焦点走进面板内的钮，blur 不替它保存', async () => {
    const { wrapper, bridge } = await mountPane({ text: SHORT })
    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    await wrapper.find('.editor-area').setValue('不该落盘的一笔')
    const cancel = wrapper.find('[data-test="chapter-cancel"]')
    await wrapper.find('.editor-area').trigger('blur', { relatedTarget: cancel.element })
    await flushPromises()
    expect(bridge.calls.filter((call) => call.tool === 'pinax_chapter_save')).toHaveLength(0)
    await cancel.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('大稿整章展开（批次68-R6 任务二 · expand-whole）', () => {
  const head = `沈青梧${'甲'.repeat(19997)}`
  const tail = `\n\n巷口那盏灯又灭了，这回照见了第二个人。${'乙'.repeat(1600)}`
  const FULL = head + tail

  it('翻到草稿之外的一页点入编辑：先补载后半段，textarea 拿的是整章', async () => {
    const { wrapper, bridge } = await mountPane({ text: FULL })
    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).toBe('1 / 10')
    for (let step = 0; step < 9; step += 1) {
      await wrapper.find('[data-test="chapter-page-next"]').trigger('click')
      await flushPromises()
    }
    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).toBe('10 / 10')

    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    const lazy = bridge.calls.filter((call) => call.tool === 'pinax_chapter_read' && call.args.offset === head.length && call.args.maxChars === 200000)
    expect(lazy).toHaveLength(1)
    const area = wrapper.find('.editor-area')
    expect(area.exists()).toBe(true)
    expect(area.element.value.length).toBe(FULL.length)
    // 展开是「多载入」不是「改动」：不该亮起「未保存的改动」，「只载入前段」的提示随之退场。
    expect(wrapper.find('.doc-meta-hint').exists()).toBe(false)

    wrapper.unmount()
  })

  it('整章展开后落盘写回的是整章：后段一个字都不抹', async () => {
    const { wrapper, bridge } = await mountPane({ text: FULL })
    for (let step = 0; step < 9; step += 1) {
      await wrapper.find('[data-test="chapter-page-next"]').trigger('click')
      await flushPromises()
    }
    await wrapper.find('[data-test="chapter-rendered"]').trigger('click')
    await flushPromises()
    await wrapper.find('.editor-area').setValue(`${FULL}\n第三个人站在灯影里。`)
    await wrapper.find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const saved = bridge.calls.filter((call) => call.tool === 'pinax_chapter_save')
    expect(saved).toHaveLength(1)
    expect(saved[0].args.text).toBe(`${FULL}\n第三个人站在灯影里。`)
    expect(wrapper.find('[data-test="chapter-rendered"]').exists()).toBe(true)
    // 保存回分页：页码不回到页 1（落点在改稿末尾附近）。
    expect(wrapper.find('[data-test="chapter-page-indicator"]').text()).not.toBe('1 / 10')
    wrapper.unmount()
  })
})
