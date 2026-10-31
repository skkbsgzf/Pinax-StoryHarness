import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData, CHAPTER_REVIEW_QUESTION } from '../shell/useBoardData.mjs'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 批次46A · 审查本章。
 * 钉三件事：
 *   1) 动作带上的「审查本章」发的是固定问句，走 runtimeAsk（任务号由主载体档案映射到 authoring.review.chapter）；
 *   2) 结果卡按 summary／issues／actions 三层渲染；
 *   3) 每条问题的「转改写」把问题描述预填进五动作改写，结果不写会话存储。
 */

const TEXT = '他醒来时，雪已经埋了半条街。\n\n柯秒披衣起身，推门出去。'

const REVIEW = Object.freeze({
  source: 'in-process-advisor',
  text: '开场稳。',
  result: {
    task: 'authoring.review.chapter',
    mode: 'review',
    summary: '开场稳，雪夜的压迫感够；两处衔接可以再收紧。',
    issues: [
      { type: 'review', severity: 'medium', message: '第二段到第三段之间缺一个过场，读者会以为跳了时间。' },
      { type: 'review', severity: 'high', message: '柯秒醒来时的寒冷描写与后文「不觉冷」冲突。' }
    ],
    typedActions: [{ label: '补一句过场' }],
    action: ['把冷感改到后文']
  }
})

function fakeBridge({ review = REVIEW } = {}) {
  const state = { channels: [], asks: [], completes: [] }
  async function request(channel, payload = {}) {
    state.channels.push(channel)
    if (channel === IPC_CHANNELS.runtimeToolCall) {
      const owner = 'pinax.carrier.novel'
      if (payload.tool === 'pinax_chapter_list') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '第001章-入场', file: '正文/第001章-入场.md', revision: 1 }] } } }
      }
      if (payload.tool === 'pinax_chapter_read') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, chapter: { index: 0, title: '第001章-入场', file: '正文/第001章-入场.md' }, text: TEXT, totalChars: TEXT.length, truncated: false, revision: 1 } } }
      }
      if (payload.tool === 'pinax_chapter_save') {
        return { ok: true, value: { tool: payload.tool, owner, payload: { ok: true, file: payload.args.file, revision: 2, created: false, bytes: payload.args.text.length } } }
      }
      return { ok: true, value: { tool: payload.tool, owner, payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '未知工具' } } }
    }
    if (channel === IPC_CHANNELS.runtimeAsk) {
      state.asks.push(payload)
      return { ok: true, value: { ...review, askId: 'ask-1' } }
    }
    if (channel === IPC_CHANNELS.runtimeComplete) {
      state.completes.push(payload)
      return { ok: true, value: { action: payload.action, target: 'replace', text: '改过的一段。', model: 'fake-model' } }
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
  return { wrapper, data, bridge }
}

describe('审查本章（批次46A）', () => {
  it('动作带上的「审查本章」发固定问句走 runtimeAsk，不新建会话存储', async () => {
    const { wrapper, bridge } = await mountedPane()
    const button = wrapper.find('[data-test="writing-review"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    await flushPromises()
    expect(bridge.state.asks).toHaveLength(1)
    expect(bridge.state.asks[0]).toEqual({ question: CHAPTER_REVIEW_QUESTION })
    expect(bridge.state.channels.some((channel) => /sessions/i.test(channel))).toBe(false)
    wrapper.unmount()
  })

  it('结果卡：摘要／问题／动作三层都摆出来，问题带轻重', async () => {
    const { wrapper } = await mountedPane()
    await wrapper.find('[data-test="writing-review"]').trigger('click')
    await flushPromises()
    const panel = wrapper.find('[data-test="review-panel"]')
    expect(panel.exists()).toBe(true)
    expect(wrapper.find('[data-test="review-summary"]').text()).toContain('雪夜的压迫感够')
    const issues = wrapper.findAll('[data-test="review-issue"]')
    expect(issues).toHaveLength(2)
    expect(issues[0].text()).toContain('缺一个过场')
    expect(issues[0].text()).toContain('中')
    expect(issues[1].text()).toContain('不觉冷')
    expect(issues[1].text()).toContain('高')
    expect(wrapper.findAll('[data-test="review-action"]').map((node) => node.text())).toEqual(['补一句过场', '把冷感改到后文'])
    wrapper.unmount()
  })

  it('「转改写」：问题描述预填进五动作改写，发的是带有该描述的 rewrite 请求', async () => {
    const { wrapper, data, bridge } = await mountedPane()
    await wrapper.find('[data-test="writing-review"]').trigger('click')
    await flushPromises()

    await wrapper.find('.editor-area').trigger('focus')
    await wrapper.find('.editor-area').element.setSelectionRange(0, 10)
    await wrapper.find('.editor-area').trigger('select')

    await wrapper.findAll('[data-test="review-issue-rewrite"]')[0].trigger('click')
    await flushPromises()
    const issue = REVIEW.result.issues[0].message
    expect(bridge.state.completes).toHaveLength(1)
    expect(bridge.state.completes[0].action).toBe('rewrite')
    expect(bridge.state.completes[0].instruction).toBe(issue)
    expect(wrapper.find('[data-test="writing-instruction"]').element.value).toBe(issue)
    expect(data.writingResult?.action).toBe('rewrite')
    wrapper.unmount()
  })

  it('收起只清这一栏：结果不写会话存储，也不动正文', async () => {
    const { wrapper, data, bridge } = await mountedPane()
    const before = data.draft
    await wrapper.find('[data-test="writing-review"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="review-discard"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="review-panel"]').exists()).toBe(false)
    expect(data.draft).toBe(before)
    expect(bridge.state.channels.some((channel) => /sessions/i.test(channel))).toBe(false)
    wrapper.unmount()
  })
})
