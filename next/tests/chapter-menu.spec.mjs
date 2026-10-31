import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import IndexWindow from '../shell/IndexWindow.vue'

/**
 * 批次46A：章节行右键菜单（删除／重命名／上移／下移）。
 * 这里只钉界面契约：四项都出、删除两步确认才真的调、重命名是行内输入（Enter 提交）、
 * 边界项置灰。真正的删／改名安全网（快照、账本、提案保护）在 file-service / carrier-novel 那两套测试里。
 */

const BOARD = Object.freeze({ id: 'novel.shelf', treePaneId: 'novel.shelf', dataDirs: ['正文'], treePaneTitle: '正文' })

function chapters() {
  return [
    { index: 0, title: '第001章-雨夜', file: '正文/第001章-雨夜.md', revision: 1 },
    { index: 1, title: '第002章-雪夜', file: '正文/第002章-雪夜.md', revision: 1 }
  ]
}

function fakeData() {
  const calls = { open: [], remove: [], rename: [], move: [] }
  const data = {
    chapters: chapters(),
    chapterGroups: [{ name: '', chapters: chapters() }],
    selection: null,
    treeError: null,
    listWarnings: [],
    openChapter: (item) => calls.open.push(item.file),
    loadChapters: async () => {},
    createChapter: () => {},
    deleteChapter: (item) => calls.remove.push(item.file),
    renameChapter: (item, title) => calls.rename.push([item.file, title]),
    moveChapter: (item, delta) => calls.move.push([item.file, delta])
  }
  return { data, calls }
}

async function mountIndex(data) {
  const wrapper = mount(IndexWindow, { props: { board: BOARD, data } })
  await flushPromises()
  return wrapper
}

function rightClick(element, x = 120, y = 90) {
  element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
}

describe('章节右键菜单（批次46A）', () => {
  it('右键章节行开四项菜单，不再弹打开方式；Esc 收起', async () => {
    const { data } = fakeData()
    const wrapper = await mountIndex(data)
    rightClick(wrapper.findAll('.nx-tree-row')[0].element)
    await flushPromises()
    const menu = wrapper.find('.nx-chapter-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.findAll('[data-test^="chapter-menu-"]').map((node) => node.text())).toEqual(['删除', '重命名', '上移', '下移'])
    expect(menu.findAll('[data-form]')).toHaveLength(0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.nx-chapter-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('删除两步：第一下只换文案，第二下才调 deleteChapter', async () => {
    const { data, calls } = fakeData()
    const wrapper = await mountIndex(data)
    rightClick(wrapper.findAll('.nx-tree-row')[0].element)
    await flushPromises()
    const remove = () => wrapper.find('[data-test="chapter-menu-delete"]')
    expect(remove().text()).toBe('删除')
    await remove().trigger('click')
    expect(calls.remove).toHaveLength(0)
    expect(remove().text()).toBe('确认删除')
    expect(wrapper.find('.nx-context-hint').text()).toContain('历史')
    await remove().trigger('click')
    await flushPromises()
    expect(calls.remove).toEqual(['正文/第001章-雨夜.md'])
    expect(wrapper.find('.nx-chapter-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('重命名：行内输入，Enter 提交新标题', async () => {
    const { data, calls } = fakeData()
    const wrapper = await mountIndex(data)
    rightClick(wrapper.findAll('.nx-tree-row')[0].element)
    await flushPromises()
    await wrapper.find('[data-test="chapter-menu-rename"]').trigger('click')
    await flushPromises()
    const input = wrapper.find('[data-test="chapter-rename-input"]')
    expect(input.exists()).toBe(true)
    expect(input.element.value).toBe('第001章-雨夜')
    await input.setValue('第001章-雨夜（改）')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(calls.rename).toEqual([['正文/第001章-雨夜.md', '第001章-雨夜（改）']])
    expect(wrapper.find('[data-test="chapter-rename-input"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('上移／下移：边界项置灰；卷内首项只能下移、次项只能上移', async () => {
    const { data, calls } = fakeData()
    const wrapper = await mountIndex(data)
    const rows = wrapper.findAll('.nx-tree-row')

    rightClick(rows[0].element)
    await flushPromises()
    expect(wrapper.find('[data-test="chapter-menu-move-up"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="chapter-menu-move-down"]').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-test="chapter-menu-move-down"]').trigger('click')
    await flushPromises()

    rightClick(rows[1].element)
    await flushPromises()
    expect(wrapper.find('[data-test="chapter-menu-move-up"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="chapter-menu-move-down"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="chapter-menu-move-up"]').trigger('click')
    await flushPromises()

    expect(calls.move).toEqual([
      ['正文/第001章-雨夜.md', 1],
      ['正文/第002章-雪夜.md', -1]
    ])
    wrapper.unmount()
  })
})
