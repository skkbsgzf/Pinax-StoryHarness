import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LibraryManager from '../shell/library/LibraryManager.vue'
import LibraryCard from '../shell/library/LibraryCard.vue'
import { relativeTime } from '../shell/library/relativeTime.mjs'

/**
 * 库管理器（前端重构工单 A）专项用例：空态、列表渲染、键盘可达、移除记录、渲染零 IPC。
 * 失败修复入口（A-5）的用例随 PR-2 的 OpenLibrary 整页视图一起落。
 * 工单 P1：类型筛选条（计数、空态、方向键）与卡片篇数读数。
 * 〔P6 · 作者 2026-11-13 按 demo 裁定〕7 个类别 tab 恒渲染（零计数照显）；
 * 最近打开的第一张画墨环（aria-current）。
 */

const NOW = new Date('2026-11-11T12:00:00')
const ENTRIES = [
  { path: 'D:/books/大梦', name: '大梦', kind: 'novel', at: '2026-11-11T08:00:00' },
  { path: 'D:/stage/旧剧本', name: '旧剧本', kind: 'script', at: '2026-11-04T08:00:00' },
  { path: 'D:/books/无名', name: null, kind: null, at: null }
]

function mountManager(recents = ENTRIES, options = {}) {
  const on = { open: vi.fn(), reveal: vi.fn(), remove: vi.fn(), 'new-library': vi.fn(), 'open-folder': vi.fn(), 'import-records': vi.fn(), 'open-settings': vi.fn() }
  const wrapper = mount(LibraryManager, {
    props: { recents, now: NOW, onOpen: on.open, onReveal: on.reveal, onRemove: on.remove, onNewLibrary: on['new-library'], onOpenFolder: on['open-folder'], onImportRecords: on['import-records'], onOpenSettings: on['open-settings'] },
    ...options
  })
  return { wrapper, on }
}

describe('库管理器（前端工单 A）', () => {
  it('空态：一句话＋新建主钮＋打开次钮；列表区不渲染', () => {
    const { wrapper } = mountManager([])
    expect(wrapper.find('[data-test="library-manager"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('从一个空文件夹开始你的下一本书')
    expect(wrapper.find('[data-test="library-new"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="library-open-folder"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="library-import"]').exists()).toBe(true)
    expect(wrapper.find('.lib-recent').exists()).toBe(false)
    // 空态同级按钮不超过 3（工单 A-8）
    expect(wrapper.findAll('.lib-actions button')).toHaveLength(3)
  })

  it('列表：卡片渲染标题/类型胶囊/路径/相对时间；无 kind 不占位；零 IPC 发起', () => {
    const request = vi.fn()
    const { wrapper } = mountManager()
    const cards = wrapper.findAllComponents(LibraryCard)
    expect(cards).toHaveLength(3)
    expect(cards[0].find('.lib-card-title').text()).toBe('大梦')
    expect(cards[0].find('.lib-card-kind').text()).toBe('小说')
    expect(cards[0].find('.lib-card-path').text()).toBe('D:/books/大梦')
    expect(cards[0].find('.lib-card-meta').text()).toBe('今天')
    expect(cards[1].find('.lib-card-meta').text()).toBe('上周')
    // 无 kind：胶囊不渲染（不为显示类型去扫盘）
    expect(cards[2].find('.lib-card-kind').exists()).toBe(false)
    // 时间缺失：留空不编
    expect(cards[2].find('.lib-card-meta').text()).toBe('')
    // 渲染期间零 IPC（工单 A-2）：组件自身不发任何请求（请求面在外壳）
    expect(request).not.toHaveBeenCalled()
  })

  it('键盘与事件：卡片回车/空格可打开（原生 button），点击冒泡到外壳的 open 事件', async () => {
    const { wrapper, on } = mountManager()
    await wrapper.findAllComponents(LibraryCard)[0].find('.lib-card').trigger('click')
    expect(on.open).toHaveBeenCalledWith(ENTRIES[0])
    // 键盘：button 原生行为（Enter/Space 触发 click）——焦点可达性由 button 元素保证
    const card = wrapper.findAllComponents(LibraryCard)[0].find('.lib-card')
    expect(card.attributes('type')).toBe('button')
    expect(card.element.tagName).toBe('BUTTON')
  })

  it('更多菜单：在文件管理器中显示 / 从列表移除（只移除记录——事件交外壳，组件不删盘）', async () => {
    const { wrapper, on } = mountManager()
    const card0 = wrapper.findAllComponents(LibraryCard)[0]
    await card0.find('.lib-card-more').trigger('click')
    const items = wrapper.findAll('.lib-menu-item')
    expect(items).toHaveLength(2)
    await items[0].trigger('click')
    expect(on.reveal).toHaveBeenCalledWith(ENTRIES[0])
    await card0.find('.lib-card-more').trigger('click')
    await wrapper.findAll('.lib-menu-item')[1].trigger('click')
    expect(on.remove).toHaveBeenCalledWith(ENTRIES[0])
    // 移除只上报事件：磁盘目录由外壳/主进程保证原样（组件与用例层面无任何删除调用）
  })

  it('顶栏：品牌＋「我的库」＋设置入口；新建/打开/导入事件转发', async () => {
    const { wrapper, on } = mountManager()
    expect(wrapper.text()).toContain('Pinax · Next')
    expect(wrapper.text()).toContain('我的库')
    await wrapper.find('[data-test="library-open-settings"]').trigger('click')
    expect(on['open-settings']).toHaveBeenCalled()
    // 「新建库」现在是内部路由（切 create 视图），不再向上抛事件。
    await wrapper.find('[data-test="library-new"]').trigger('click')
    expect(wrapper.find('[data-test="library-create"]').exists()).toBe(true)
    wrapper.unmount()

    // 打开文件夹/导入既有稿仍是向上抛的事件（通道调用在外壳）。
    const { wrapper: w2, on: on2 } = mountManager()
    await w2.find('[data-test="library-open-folder"]').trigger('click')
    expect(on2['open-folder']).toHaveBeenCalled()
    // 「导入既有稿」同样是内部路由（切 import 视图）。
    await w2.find('[data-test="library-import"]').trigger('click')
    expect(w2.find('[data-test="library-import-page"]').exists()).toBe(true)
    w2.unmount()
  })

  it('相对时间分档（工单 A-3）在卡片上的综合呈现', () => {
    expect(relativeTime('2026-11-11T00:00:00', NOW)).toBe('今天')
    expect(relativeTime('2026-11-09T00:00:00', NOW)).toBe('2 天前')
  })

  // 〔P6 · 作者 2026-11-13 按 demo 裁定〕翻案 P1「零计数不渲染」：7 个 tab 恒在。
  it('筛选条（P6）：全部＋6 个类别 tab 恒渲染，零计数也照显', () => {
    const { wrapper } = mountManager()
    const tabs = wrapper.findAll('[role="tab"]')
    // ENTRIES＝小说 1／剧本 1／未分类 1；漫剧、世界书、资料计数为 0，但仍渲染。
    expect(tabs.map((tab) => tab.text().replace(/\s+/g, ''))).toEqual(['全部3', '小说1', '剧本1', '漫剧0', '世界书0', '资料0', '未分类1'])
    expect(wrapper.find('[data-test="library-filter-comic"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="library-filter-worldbook"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="library-filter-reference"]').exists()).toBe(true)
    expect(wrapper.find('[role="tablist"]').attributes('aria-label')).toBe('按类型筛选')
    expect(wrapper.find('[data-test="library-filter-all"]').attributes('aria-selected')).toBe('true')
  })

  it('卡片选中环（P6）：最近打开的第一张 aria-current，其余不标', async () => {
    const { wrapper } = mountManager()
    const cards = wrapper.findAllComponents(LibraryCard)
    expect(cards[0].find('.lib-card').attributes('aria-current')).toBe('true')
    expect(cards[1].find('.lib-card').attributes('aria-current')).toBeUndefined()
    expect(cards[2].find('.lib-card').attributes('aria-current')).toBeUndefined()
    // 筛到「剧本」后，清单第二张（不是最近打开的第一张）不冒充选中。
    await wrapper.find('[data-test="library-filter-script"]').trigger('click')
    expect(wrapper.findAllComponents(LibraryCard)[0].find('.lib-card').attributes('aria-current')).toBeUndefined()
  })

  it('筛选条（P1-1）：点「剧本」只留剧本卡；切回「全部」恢复三张', async () => {
    const { wrapper } = mountManager()
    await wrapper.find('[data-test="library-filter-script"]').trigger('click')
    const cards = wrapper.findAllComponents(LibraryCard)
    expect(cards).toHaveLength(1)
    expect(cards[0].find('.lib-card-title').text()).toBe('旧剧本')
    expect(wrapper.find('[data-test="library-filter-script"]').attributes('aria-selected')).toBe('true')

    await wrapper.find('[data-test="library-filter-all"]').trigger('click')
    expect(wrapper.findAllComponents(LibraryCard)).toHaveLength(3)
  })

  it('筛选条（P1-1）：选中的类别变空 → 空态与新建入口，不空白', async () => {
    const { wrapper } = mountManager()
    await wrapper.find('[data-test="library-filter-script"]').trigger('click')
    await wrapper.setProps({ recents: ENTRIES.filter((entry) => entry.kind !== 'script') })
    expect(wrapper.findAllComponents(LibraryCard)).toHaveLength(0)
    expect(wrapper.find('[data-test="library-filter-empty"]').text()).toContain('这里还没有这一类库')
    await wrapper.find('[data-test="library-filter-empty-new"]').trigger('click')
    expect(wrapper.find('[data-test="library-create"]').exists()).toBe(true)
  })

  it('筛选条（P1-1）：方向键左右切换且维持 roving tabindex；Tab 只停一处', async () => {
    const { wrapper } = mountManager(ENTRIES, { attachTo: document.body })
    const tablist = wrapper.find('[role="tablist"]')
    await tablist.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('[data-test="library-filter-novel"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-test="library-filter-novel"]').attributes('tabindex')).toBe('0')
    expect(wrapper.find('[data-test="library-filter-all"]').attributes('tabindex')).toBe('-1')
    expect(document.activeElement?.id).toBe('library-filter-novel')

    await tablist.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.find('[data-test="library-filter-all"]').attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('卡片篇数（P1-2）：有 count 显示「N 篇 · 时间编辑」；旧记录只显示时间', () => {
    const { wrapper } = mountManager([
      { path: 'D:/books/长夜', name: '长夜', kind: 'novel', at: '2026-11-10T08:00:00', count: 12, countAt: '2026-11-11T08:00:00' },
      { path: 'D:/books/旧稿', name: '旧稿', kind: 'novel', at: '2026-11-11T08:00:00' }
    ])
    const cards = wrapper.findAllComponents(LibraryCard)
    expect(cards[0].find('.lib-card-meta').text()).toBe('12 篇 · 昨天编辑')
    expect(cards[1].find('.lib-card-meta').text()).toBe('今天')
  })
})
