import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData } from '../shell/useBoardData.mjs'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 批次46A 任务③：五动作结果卡上的参考清单与「查看提示词」折叠层。
 * 只钉界面契约：折叠层按需拉一次只读预览、展示 system＋user、收起后不再请求；
 * 参考缺席时把原因原话摊开，不假装用上了本书参考。
 */

const ORIGINAL = '他推开门，屋里没有点灯。'
const PREVIEW = Object.freeze({
  action: 'continue',
  at: '2026-10-31T10:00:00.000Z',
  systemPrompt: '你是中文小说写作助手。',
  userPrompt: '【上文】\n他推开门，屋里没有点灯。\n\n【本书参考】\n【大纲】\n第一幕：雨夜有人敲门\n\n【任务】顺着上文往下写。',
  references: [{ kind: 'outline', chars: 9 }],
  referenceNote: null
})

function fakeBridge({ preview = PREVIEW, previewFails = false, referenceNote = null } = {}) {
  const state = { text: ORIGINAL, revision: 1, completeCalls: [], previewCalls: 0 }
  async function request(channel, payload = {}) {
    if (channel === IPC_CHANNELS.runtimeToolCall) {
      const owner = 'pinax.carrier.novel'
      if (payload.tool === 'pinax_chapter_list') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '第001章', file: '正文/第001章.md', revision: state.revision }] } } }
      }
      if (payload.tool === 'pinax_chapter_read') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, chapter: { index: 0, title: '第001章', file: '正文/第001章.md' }, text: state.text, totalChars: state.text.length, truncated: false, revision: state.revision } } }
      }
      return { ok: true, value: { tool: payload.tool, owner, payload: { ok: false, message: '未知工具' } } }
    }
    if (channel === IPC_CHANNELS.runtimeComplete) {
      state.completeCalls.push(payload)
      return {
        ok: true,
        value: {
          action: payload.action,
          target: 'insert',
          text: '门外有人叫他。',
          model: 'fake-model',
          references: referenceNote ? [] : PREVIEW.references,
          degraded: Boolean(referenceNote),
          referenceNote
        }
      }
    }
    if (channel === IPC_CHANNELS.writingPreview) {
      state.previewCalls += 1
      if (previewFails) return { ok: false, error: { message: '提示词预览未接入' } }
      return { ok: true, value: { ...preview } }
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
  await wrapper.find('[data-test="chapter-edit"]').trigger('click')
  await flushPromises()
  await wrapper.find('.editor-area').trigger('focus')
  await wrapper.find('[data-test="writing-continue"]').trigger('click')
  await flushPromises()
  return { wrapper, data, bridge }
}

describe('五动作参考与提示词预览（批次46A）', () => {
  it('结果卡列出参考块；折叠层按需拉一次预览，系统／用户提示词都摊开', async () => {
    const { wrapper, bridge } = await mountedPane()
    expect(wrapper.find('[data-test="writing-references"]').text()).toContain('大纲 9 字')
    expect(wrapper.find('[data-test="writing-preview"]').exists()).toBe(false)
    expect(bridge.state.previewCalls).toBe(0)

    await wrapper.find('[data-test="writing-preview-toggle"]').trigger('click')
    await flushPromises()
    expect(bridge.state.previewCalls).toBe(1)
    const preview = wrapper.find('[data-test="writing-preview"]')
    expect(preview.exists()).toBe(true)
    expect(wrapper.find('[data-test="writing-preview-system"]').text()).toContain('中文小说写作助手')
    expect(wrapper.find('[data-test="writing-preview-user"]').text()).toContain('【本书参考】')

    await wrapper.find('[data-test="writing-preview-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="writing-preview"]').exists()).toBe(false)
    expect(bridge.state.previewCalls).toBe(1, '收起不重新请求')
    wrapper.unmount()
  })

  it('参考块缺席：结果卡照原话标注原因，预览仍可看（裸补全也留提示词）', async () => {
    const { wrapper } = await mountedPane({ referenceNote: '参考块缺席：运行时当前没有打开可组装上下文的项目，这次是裸补全。' })
    const refs = wrapper.find('[data-test="writing-references"]')
    expect(refs.exists()).toBe(true)
    expect(refs.text()).toContain('参考块缺席')
    await wrapper.find('[data-test="writing-preview-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="writing-preview-user"]').text()).toContain('【上文】')
    wrapper.unmount()
  })

  it('预览读取失败：折叠层如实显示原因，不白屏', async () => {
    const { wrapper } = await mountedPane({ previewFails: true })
    await wrapper.find('[data-test="writing-preview-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="writing-preview-error"]').text()).toContain('提示词预览未接入')
    wrapper.unmount()
  })
})
