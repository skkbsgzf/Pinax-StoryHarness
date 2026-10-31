import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData } from '../shell/useBoardData.mjs'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 批次41：正文写作动作的界面流。
 * 口径（对齐老前端写作面）：正文聚焦才浮出动作带；结果先摆出来、不自动落进正文；
 * 只有作者按「插入光标处／替换选中段」才动稿子；生成期间改过稿就拒，不塞错位置。
 */

const ORIGINAL = '他推开门，屋里没有点灯。'

function fakeBridge({ text = ORIGINAL, answer = '门外有人叫他。' } = {}) {
  const state = { text, revision: 1, answer, completeCalls: [], saved: null }
  async function request(channel, payload = {}) {
    if (channel === IPC_CHANNELS.runtimeToolCall) {
      const owner = 'pinax.carrier.novel'
      if (payload.tool === 'pinax_chapter_list') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '第001章', file: '正文/第001章.md', revision: state.revision }] } } }
      }
      if (payload.tool === 'pinax_chapter_read') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, chapter: { index: 0, title: '第001章', file: '正文/第001章.md' }, text: state.text, totalChars: state.text.length, truncated: false, revision: state.revision } } }
      }
      if (payload.tool === 'pinax_chapter_save') {
        state.revision += 1
        state.saved = { text: payload.args.text, revision: state.revision }
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, file: payload.args.file, revision: state.revision, created: false, bytes: payload.args.text.length } } }
      }
      return { ok: true, value: { tool: payload.tool, owner, payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '未知工具' } } }
    }
    if (channel === IPC_CHANNELS.runtimeComplete) {
      state.completeCalls.push(payload)
      return {
        ok: true,
        value: { action: payload.action, target: payload.action === 'continue' ? 'insert' : 'replace', text: state.answer, model: 'fake-model' }
      }
    }
    return { ok: false, error: { message: `未接通道：${channel}` } }
  }
  return { request, state }
}

async function mountedPane(options) {
  const bridge = fakeBridge(options)
  const data = useBoardData(bridge)
  await data.loadChapters()
  const wrapper = mount(CarrierPaneHost, { props: { pane: { id: 'novel.editor', title: '正文' }, data } })
  await flushPromises()
  // 批次43：正文面默认是阅读态——写作动作带挂在编辑器上，先按「编辑」进编辑区。
  await wrapper.find('[data-test="chapter-edit"]').trigger('click')
  await flushPromises()
  return { wrapper, data, bridge }
}

describe('正文写作动作（批次41）', () => {
  it('正文聚焦才浮出动作带；没选区时只有续写', async () => {
    const { wrapper } = await mountedPane()
    expect(wrapper.find('[data-test="writing-bar"]').exists()).toBe(false)
    await wrapper.find('.editor-area').trigger('focus')
    expect(wrapper.find('[data-test="writing-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="writing-continue"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="writing-rewrite"]').exists()).toBe(false)
  })

  it('续写：结果先摆出来，按「插入光标处」才进正文', async () => {
    const { wrapper, data, bridge } = await mountedPane()
    const area = wrapper.find('.editor-area')
    await area.trigger('focus')
    expect(data.draft).toBe(ORIGINAL)
    await wrapper.find('[data-test="writing-continue"]').trigger('click')
    await flushPromises()
    expect(bridge.state.completeCalls).toHaveLength(1)
    expect(bridge.state.completeCalls[0].selection).toEqual({ start: ORIGINAL.length, end: ORIGINAL.length })
    // 没点「插入」之前，正文一个字不动。
    expect(data.draft).toBe(ORIGINAL)
    const result = wrapper.find('[data-test="writing-result"]')
    expect(result.exists()).toBe(true)
    expect(result.text()).toContain('门外有人叫他。')
    await wrapper.find('[data-test="writing-apply"]').trigger('click')
    await flushPromises()
    expect(data.draft).toBe(`${ORIGINAL}\n\n门外有人叫他。`)
    expect(wrapper.find('[data-test="writing-result"]').exists()).toBe(false)
  })

  it('选中一段后出现改写；替换只顶掉选中段', async () => {
    const { wrapper, data, bridge } = await mountedPane({ answer: '她合上门' })
    const area = wrapper.find('.editor-area')
    await area.trigger('focus')
    const el = area.element
    el.setSelectionRange(0, 3)
    await area.trigger('select')
    expect(wrapper.find('[data-test="writing-rewrite"]').exists()).toBe(true)
    await wrapper.find('[data-test="writing-rewrite"]').trigger('click')
    await flushPromises()
    expect(bridge.state.completeCalls[0].selection).toEqual({ start: 0, end: 3 })
    const apply = wrapper.find('[data-test="writing-apply"]')
    expect(apply.text()).toContain('替换选中段')
    await apply.trigger('click')
    await flushPromises()
    expect(data.draft).toBe(`她合上门${ORIGINAL.slice(3)}`)
  })

  it('生成期间改过正文就拒落位：宁可提示，也不把结果塞到错的位置', async () => {
    const { data, bridge } = await mountedPane()
    const pending = data.requestWriting('continue')
    data.setDraft(`${ORIGINAL}（临时加的）`)
    await pending
    expect(data.writingResult).not.toBeNull()
    data.applyWriting()
    expect(data.draft).toBe(`${ORIGINAL}（临时加的）`)
    expect(data.writingError).toMatch(/位置对不上/u)
    expect(bridge.state.saved).toBeNull()
  })

  it('模型面失败如实摊在正文下方，不假装写过', async () => {
    const bridge = fakeBridge()
    const failing = {
      request: async (channel, payload) => (channel === IPC_CHANNELS.runtimeComplete
        ? { ok: false, error: { code: 'PINAX_IO_FAILED', message: '任务面不可达' } }
        : bridge.request(channel, payload))
    }
    const data = useBoardData(failing)
    await data.loadChapters()
    const wrapper = mount(CarrierPaneHost, { props: { pane: { id: 'novel.editor', title: '正文' }, data } })
    await flushPromises()
    // 批次43：正文面默认是阅读态，写作动作带挂在编辑器上——先按「编辑」。
    await wrapper.find('[data-test="chapter-edit"]').trigger('click')
    await flushPromises()
    await wrapper.find('.editor-area').trigger('focus')
    await wrapper.find('[data-test="writing-continue"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="writing-error"]').text()).toContain('任务面不可达')
    expect(data.draft).toBe(ORIGINAL)
  })
})
