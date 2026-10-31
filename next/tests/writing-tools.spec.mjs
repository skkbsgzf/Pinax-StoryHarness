import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { useBoardData } from '../shell/useBoardData.mjs'
import CarrierPaneHost from '../shell/CarrierPaneHost.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'
import { generateNames } from '../shell/nameGenerator.mjs'

/**
 * 批次46B · 任务②④：写作工具弹层（快捷词／取名）与编辑器偏好行为。
 * 这里只钉界面契约：弹层按需浮现、快捷词从世界书与正文派生并可插入光标处、
 * 取名一批 8 个且世界书重名摆灰、复制给提示；段落聚焦出上下遮罩、打字机把正文滚到光标处。
 * 纯逻辑（词表派生、名字池去重）在 quick-words.test.mjs 里，偏好校验在 app-preferences.test.mjs 里。
 */

const ORIGINAL = '他推开门，屋里没有点灯。'

const ENTRIES = Object.freeze([
  { id: 'e1', type: 'character', name: '沈砚', keys: ['小砚'], keysSecondary: [], summary: '主角' },
  { id: 'e2', type: 'setting', name: '雨夜城', keys: [], keysSecondary: [], summary: '城名' }
])

function fakeBridge({ text = ORIGINAL } = {}) {
  const state = { text, revision: 1, saved: null }
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
    return { ok: false, error: { message: `未接通道：${channel}` } }
  }
  return { request, state }
}

async function mountedPane({ editing = false } = {}) {
  const bridge = fakeBridge()
  const data = useBoardData(bridge)
  await data.loadChapters()
  data.entries = ENTRIES.map((entry) => ({ ...entry }))
  const wrapper = mount(CarrierPaneHost, { props: { pane: { id: 'novel.editor', title: '正文' }, data } })
  await flushPromises()
  if (editing) {
    await wrapper.find('[data-test="chapter-edit"]').trigger('click')
    await flushPromises()
  }
  return { wrapper, data, bridge }
}

/** 下一微任务即算一帧：编辑器行为在下一帧算，测试里让它当场算完（保留「先排帧、后归零」的次序）。 */
function withSyncRaf(run) {
  const original = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => {
    queueMicrotask(() => fn(0))
    return 1
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.requestAnimationFrame = original
    })
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('写作工具弹层（批次46B）', () => {
  it('快捷词：按需开合，世界书条目分角色／设定，搜索可过滤', async () => {
    const { wrapper } = await mountedPane()
    expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(false)

    await wrapper.find('[data-test="writing-tools-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="quick-group-character"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="quick-group-setting"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="quick-word"]').map((node) => node.text())).toEqual(['沈砚', '小砚', '雨夜城'])

    await wrapper.find('[data-test="quick-word-search"]').setValue('小砚')
    await flushPromises()
    expect(wrapper.findAll('[data-test="quick-word"]').map((node) => node.text())).toEqual(['小砚'])

    await wrapper.find('[data-test="quick-word-search"]').setValue('')
    await flushPromises()
    expect(wrapper.findAll('[data-test="quick-word"]')).toHaveLength(3)

    // Esc 收起（焦点在弹层范围内）。
    await wrapper.find('.nx-tools-anchor').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(false)

    // 再点开关打开，再点一次收起。
    await wrapper.find('[data-test="writing-tools-toggle"]').trigger('click')
    expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(true)
    await wrapper.find('[data-test="writing-tools-toggle"]').trigger('click')
    expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点快捷词插到光标处，插完收起弹层', async () => {
    const { wrapper, data } = await mountedPane({ editing: true })
    const area = wrapper.find('.editor-area')
    area.element.setSelectionRange(1, 1)

    await wrapper.find('[data-test="writing-tools-toggle"]').trigger('click')
    await flushPromises()
    const chip = wrapper.findAll('[data-test="quick-word"]').find((node) => node.text() === '沈砚')
    await chip.trigger('click')
    await flushPromises()

    expect(data.draft).toBe(`${ORIGINAL.slice(0, 1)}沈砚${ORIGINAL.slice(1)}`)
    expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('取名：一批 8 个；世界书已有同名摆灰并禁用插入；复制给提示', async () => {
    const savedRandom = Math.random
    const copied = []
    const originalClipboard = globalThis.navigator?.clipboard
    Math.random = seededRandom(2026)
    try {
      globalThis.navigator.clipboard = { writeText: async (text) => { copied.push(text) } }
      const { wrapper, data } = await mountedPane({ editing: true })
      await wrapper.find('[data-test="writing-tools-toggle"]').trigger('click')
      await wrapper.find('[data-test="tools-tab-names"]').trigger('click')
      await flushPromises()

      const expected = generateNames({
        category: 'person', language: 'chinese', length: 'three', gender: 'neutral', count: 8, random: seededRandom(2026)
      })
      let rows = wrapper.findAll('[data-test="name-suggestion"]')
      expect(rows).toHaveLength(8)
      expect(rows.map((row) => row.find('.nx-tools-name-text').text())).toEqual(expected)

      // 世界书里已经有第一批的第一个名字：重名的同样摆出来，但不许直接插入。
      data.entries = [...ENTRIES.map((entry) => ({ ...entry })), { id: 'e9', type: 'character', name: expected[0], keys: [], summary: '已在世界书' }]
      await flushPromises()
      Math.random = seededRandom(2026)
      await wrapper.find('[data-test="names-generate"]').trigger('click')
      await flushPromises()

      rows = wrapper.findAll('[data-test="name-suggestion"]')
      expect(rows[0].classes()).toContain('is-duplicate')
      expect(rows[0].find('[data-test="name-insert"]').attributes('disabled')).toBeDefined()
      expect(rows[1].find('[data-test="name-insert"]').attributes('disabled')).toBeUndefined()

      await rows[1].find('[data-test="name-copy"]').trigger('click')
      await flushPromises()
      expect(copied).toEqual([expected[1]])
      expect(wrapper.find('[data-test="name-copied"]').text()).toBe(`已复制「${expected[1]}」`)

      wrapper.find('.editor-area').element.setSelectionRange(1, 1)
      await rows[1].find('[data-test="name-insert"]').trigger('click')
      await flushPromises()
      expect(data.draft).toBe(`${ORIGINAL.slice(0, 1)}${expected[1]}${ORIGINAL.slice(1)}`)
      expect(wrapper.find('[data-test="writing-tools"]').exists()).toBe(false)
      wrapper.unmount()
    } finally {
      Math.random = savedRandom
      if (originalClipboard === undefined) delete globalThis.navigator.clipboard
      else globalThis.navigator.clipboard = originalClipboard
    }
  })
})

describe('编辑器偏好行为（批次46B）', () => {
  it('段落聚焦：根节点开关打开后，聚焦正文出现上下遮罩；失焦收起', async () => {
    const root = globalThis.document.documentElement
    root.dataset.writingFocus = 'on'
    try {
      await withSyncRaf(async () => {
        const { wrapper } = await mountedPane({ editing: true })
        const area = wrapper.find('.editor-area')
        await area.trigger('focus')
        await flushPromises()
        expect(wrapper.find('.nx-focus-mask.is-top').exists()).toBe(true)
        expect(wrapper.find('.nx-focus-mask.is-bottom').exists()).toBe(true)

        await area.trigger('blur')
        await flushPromises()
        expect(wrapper.find('.nx-focus-mask').exists()).toBe(false)
        wrapper.unmount()
      })
    } finally {
      delete root.dataset.writingFocus
    }
  })

  it('打字机：开关打开时按光标位置把正文滚到视口上方约四成处', async () => {
    const root = globalThis.document.documentElement
    root.dataset.writingTypewriter = 'on'
    const originalRect = globalThis.Element.prototype.getBoundingClientRect
    try {
      await withSyncRaf(async () => {
        const { wrapper } = await mountedPane({ editing: true })
        const area = wrapper.find('.editor-area')
        const el = area.element
        let scroll = 0
        Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => scroll, set: (value) => { scroll = value } })
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 })
        // 镜像元素量到的高度：光标前每字 100px（jsdom 没有排版，只能这样喂 caret 纵坐标）。
        globalThis.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
          if (this.style?.visibility === 'hidden' && this.style?.position === 'absolute') {
            const caretText = String(this.textContent ?? '').replace(/\u200b/gu, '')
            return { height: caretText.length * 100, width: 100, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON() {} }
          }
          return originalRect.call(this)
        }

        await area.trigger('focus')
        el.setSelectionRange(2, 2)
        await area.trigger('select')
        await flushPromises()
        // 光标在 200px 处，视口 300px → 目标滚动 200 - 300 × 0.4 = 80。
        expect(scroll).toBe(80)
        wrapper.unmount()
      })
    } finally {
      globalThis.Element.prototype.getBoundingClientRect = originalRect
      delete root.dataset.writingTypewriter
    }
  })
})
