import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import IndexWindow from '../shell/IndexWindow.vue'

/**
 * 批次46B · 任务①③：索引窗的全书查找／当前章替换与导入导出入口。
 * 这里只钉界面契约：查找条的开合与快捷键、命中计数与按章分组、上／下一处会开对应章、
 * 替换两步确认才调、导入按钮直调、导出菜单给两种格式。真正的扫描与修订号闸在
 * book-search.test.mjs（fileService）里，落盘在主进程的 exportService 那一组测试里。
 */

const BOARD = Object.freeze({ id: 'novel.shelf', treePaneId: 'novel.shelf', dataDirs: ['正文'], treePaneTitle: '正文' })

const CHAPTERS = Object.freeze([
  { index: 0, title: '第001章-雨夜', file: '正文/第001章-雨夜.md', revision: 1 },
  { index: 1, title: '第002章-雪夜', file: '正文/第002章-雪夜.md', revision: 1 }
])

const HITS = Object.freeze([
  { file: '正文/第001章-雨夜.md', chapterTitle: '第001章-雨夜', line: 2, snippet: '雨从檐口滴下来', matchIndex: 0 },
  { file: '正文/第002章-雪夜.md', chapterTitle: '第002章-雪夜', line: 4, snippet: '雪后还有雨', matchIndex: 0 }
])

function emptySearch() {
  return { query: '', hits: [], total: 0, truncated: false, busy: false, error: null, caseSensitive: false, warnings: [] }
}

function makeData() {
  const calls = { search: [], clear: 0, open: [], replace: [], import: 0, export: [] }
  const data = reactive({
    chapters: CHAPTERS,
    chapterGroups: [{ name: '', chapters: CHAPTERS }],
    selection: null,
    treeError: null,
    listWarnings: [],
    busy: false,
    chapter: CHAPTERS[0],
    bookSearch: emptySearch(),
    loadChapters: async () => {},
    openChapter: async (item) => { calls.open.push(item.file) },
    createChapter: () => {},
    deleteChapter: () => {},
    renameChapter: () => {},
    moveChapter: () => {},
    clearBookSearch: () => {
      calls.clear += 1
      data.bookSearch = emptySearch()
    },
    searchBook: async (query) => {
      calls.search.push(query)
      data.bookSearch = { ...emptySearch(), query, hits: [...HITS], total: HITS.length }
    },
    replaceInCurrentChapter: async (find, replace) => {
      calls.replace.push([find, replace])
      return { ok: true, replaced: 1 }
    },
    importBookDocument: async () => { calls.import += 1 },
    exportBookFile: async (format) => { calls.export.push(format) }
  })
  return { data, calls }
}

async function mountIndex() {
  const { data, calls } = makeData()
  const wrapper = mount(IndexWindow, { props: { board: BOARD, data }, attachTo: document.body })
  await flushPromises()
  return { wrapper, data, calls }
}

async function openAndSearch(wrapper) {
  await wrapper.find('[data-test="index-find-toggle"]').trigger('click')
  await wrapper.find('[data-test="find-input"]').setValue('雨')
  await wrapper.find('[data-test="find-submit"]').trigger('click')
  await flushPromises()
}

describe('全书查找（批次46B）', () => {
  it('Ctrl+F 打开查找条并聚焦输入；Esc／收起钮关掉并清结果', async () => {
    const { wrapper, calls } = await mountIndex()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-test="find-panel"]').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.find('[data-test="find-input"]').element)

    await wrapper.find('[data-test="find-input"]').setValue('雨')
    await wrapper.find('[data-test="find-input"]').trigger('keydown.enter')
    await flushPromises()
    expect(calls.search).toEqual(['雨'])

    // 挂载时换板 watch 会顺手复位一次查找状态；这里只钉 Esc 这一下确实又清了一次。
    const clearedAtMount = calls.clear
    await wrapper.find('[data-test="find-input"]').trigger('keydown.esc')
    await flushPromises()
    expect(wrapper.find('[data-test="find-panel"]').exists()).toBe(false)
    expect(calls.clear).toBe(clearedAtMount + 1)

    await wrapper.find('[data-test="index-find-toggle"]').trigger('click')
    expect(wrapper.find('[data-test="find-panel"]').exists()).toBe(true)
    await wrapper.find('[data-test="find-close"]').trigger('click')
    expect(wrapper.find('[data-test="find-panel"]').exists()).toBe(false)
    expect(calls.clear).toBe(clearedAtMount + 2)
    wrapper.unmount()
  })

  it('命中计数、按章分组与上／下一处：点结果或翻页都会打开对应的章', async () => {
    const { wrapper, calls } = await mountIndex()
    await openAndSearch(wrapper)

    expect(wrapper.find('[data-test="find-count"]').text()).toBe('2 处 · 第 1 处')
    expect(wrapper.findAll('[data-test="find-group"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-test="find-hit"]')).toHaveLength(2)

    await wrapper.findAll('[data-test="find-hit"]')[1].trigger('click')
    await flushPromises()
    expect(calls.open).toEqual(['正文/第002章-雪夜.md'])
    expect(wrapper.find('[data-test="find-count"]').text()).toBe('2 处 · 第 2 处')

    // 第 2 处的下一处绕回第 1 处。
    await wrapper.find('[data-test="find-next"]').trigger('click')
    await flushPromises()
    expect(calls.open).toEqual(['正文/第002章-雪夜.md', '正文/第001章-雨夜.md'])

    await wrapper.find('[data-test="find-prev"]').trigger('click')
    await flushPromises()
    expect(calls.open.at(-1)).toBe('正文/第002章-雪夜.md')
    wrapper.unmount()
  })

  it('没有命中也如实报：计数 0 处，翻页钮置灰', async () => {
    const { wrapper, data, calls } = await mountIndex()
    await wrapper.find('[data-test="index-find-toggle"]').trigger('click')
    await wrapper.find('[data-test="find-input"]').setValue('没有')
    data.searchBook = async (query) => {
      calls.search.push(query)
      data.bookSearch = { ...emptySearch(), query }
    }
    await wrapper.find('[data-test="find-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="find-count"]').text()).toBe('0 处')
    expect(wrapper.find('[data-test="find-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="find-next"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

describe('当前章替换（批次46B）', () => {
  it('两步确认：第一下只换文案，第二下才提交；范围只有当前章', async () => {
    const { wrapper, calls } = await mountIndex()
    await openAndSearch(wrapper)
    await wrapper.find('[data-test="replace-input"]').setValue('雪')

    const button = () => wrapper.find('[data-test="replace-current"]')
    expect(button().text()).toBe('替换本章')
    await button().trigger('click')
    await flushPromises()
    expect(calls.replace).toEqual([])
    expect(button().text()).toBe('确认替换本章')
    expect(wrapper.find('[data-test="replace-hint"]').text()).toContain('当前打开的这一章')

    await button().trigger('click')
    await flushPromises()
    expect(calls.replace).toEqual([['雨', '雪']])
    expect(button().text()).toBe('替换本章')
    expect(wrapper.find('[data-test="replace-hint"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('没打开章时替换钮置灰：不带 expectedRevision 的替换不可能发出去', async () => {
    const { wrapper, data, calls } = await mountIndex()
    data.chapter = null
    await openAndSearch(wrapper)
    expect(wrapper.find('[data-test="replace-current"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="replace-current"]').trigger('click')
    await flushPromises()
    expect(calls.replace).toEqual([])
    wrapper.unmount()
  })
})

describe('导入与整本导出入口（批次46B）', () => {
  it('导入按钮直调 useBoardData；导出菜单给 txt／doc 两种格式', async () => {
    const { wrapper, calls } = await mountIndex()
    await wrapper.find('[data-test="index-import"]').trigger('click')
    await flushPromises()
    expect(calls.import).toBe(1)

    expect(wrapper.find('[data-test="export-menu"]').exists()).toBe(false)
    await wrapper.find('[data-test="index-export"]').trigger('click')
    expect(wrapper.find('[data-test="export-menu"]').exists()).toBe(true)
    await wrapper.find('[data-test="export-txt"]').trigger('click')
    await flushPromises()
    expect(calls.export).toEqual(['txt'])
    expect(wrapper.find('[data-test="export-menu"]').exists()).toBe(false)

    await wrapper.find('[data-test="index-export"]').trigger('click')
    await wrapper.find('[data-test="export-doc"]').trigger('click')
    await flushPromises()
    expect(calls.export).toEqual(['txt', 'doc'])
    wrapper.unmount()
  })
})
