import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import ActivityRail from '../shell/ActivityRail.vue'
import RuntimeDock from '../shell/RuntimeDock.vue'
import CenterSlotHost from '../shell/CenterSlotHost.vue'
import { IPC_CHANNELS, IPC_EVENT } from '../shell/ipcContract.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'

/**
 * 外壳界面测试（WP4 · M2 批次 4 重排后）。
 * 这里的 view 对象形状与 next/tests/shell-contract.test.mjs 里由真会话产出的那份一致；
 * 通道名一律从 ipcContract 取，外壳改通道名或渲染层绕过桥去碰内核，这里就会红。
 *
 * 布局口径（作者口径：Obsidian 三栏）：图标竖条 → 索引窗 → 核心区（正文）→ 右栏运行时。
 */

function runtimeView({ started = true } = {}) {
  return {
    title: RUNTIME_CONTRACT.title,
    builtIn: RUNTIME_CONTRACT.builtIn,
    disableable: RUNTIME_CONTRACT.disableable,
    ownsSlot: RUNTIME_CONTRACT.ownsSlot,
    budgetPriority: RUNTIME_CONTRACT.budgetPriority,
    writeSurface: RUNTIME_CONTRACT.writeSurface,
    reservedSlotReason: '右栏归 Pi-Agent 运行时（唯一一级公民），插件只能贡献左竖条与中栏',
    started,
    tools: Array.from({ length: 19 }, (_item, index) => ({ name: `pinax_tool_${index}`, title: `pinax_tool_${index}`, owner: 'kernel' }))
  }
}

function emptyFrameworkView() {
  return {
    kernel: { contractVersion: '1', kinds: ['novel', 'screenplay', 'generic'] },
    project: null,
    needsPrimary: true,
    openError: { code: 'PINAX_PRIMARY_CARRIER_MISSING', message: '《空框架项目》还没有主载体——请先选择「创作小说还是剧本」' },
    left: [],
    center: [],
    primary: null,
    carriers: [],
    archive: [],
    skeletonDirs: [],
    ownedDirs: [],
    rejected: [{ pluginId: 'bad.carrier', error: { message: '槽位 "right" 是保留字' } }],
    runtime: runtimeView()
  }
}

function carrierView() {
  const base = emptyFrameworkView()
  return {
    ...base,
    needsPrimary: false,
    openError: null,
    rejected: [],
    project: { root: 'x', name: '大梦', kind: 'novel', spec: 'pinax-project@2', revision: 1 },
    primary: { id: 'fixture.novel', title: '小说（夹具）', primary: { projectKind: 'novel' } },
    carriers: [{ id: 'fixture.novel', title: '小说（夹具）', primary: { projectKind: 'novel' }, isPrimary: true, isEnabled: true, capabilities: [], requires: [], scopes: [], dataDirs: ['正文'] },
      { id: 'fixture.script', title: '剧本（夹具）', primary: { projectKind: 'screenplay' }, isPrimary: false, isEnabled: false, capabilities: [], requires: [], scopes: [], dataDirs: ['分场'] }],
    left: [{ slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'book', pluginId: 'fixture.novel', pluginTitle: '小说（夹具）', primary: true }],
    center: [{ slot: 'center', id: 'novel.editor', title: '正文', icon: 'writing', pluginId: 'fixture.novel', pluginTitle: '小说（夹具）', primary: true }],
    skeletonDirs: ['正文', '大纲', '世界书', '构思', '资料', '日志', '约束'],
    archive: [{ dir: '旧稿', files: 3, readOnly: true, reason: '外来内容' }]
  }
}

function stubBridge(view, extra = {}) {
  const request = vi.fn(async (channel, payload) => {
    if (channel === IPC_CHANNELS.view) return { ok: true, value: view }
    const handler = extra[channel]
    if (handler) return handler(payload)
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
  })
  return { request, channels: IPC_CHANNELS }
}

describe('空框架外壳', () => {
  it('不装任何插件也能进入：三栏都在，右栏归运行时，装载失败只横幅不白屏', async () => {
    const bridge = stubBridge(emptyFrameworkView())
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    expect(wrapper.find('.nx-ribbon').exists()).toBe(true)
    expect(wrapper.find('.nx-index-window').exists()).toBe(true)
    expect(wrapper.find('.col-center').exists()).toBe(true)
    expect(wrapper.find('.col-dock').exists()).toBe(true)
    expect(wrapper.findAll('.resizer')).toHaveLength(2)

    expect(wrapper.text()).toContain('当前没有已启用的载体板块')
    expect(wrapper.text()).toContain(RUNTIME_CONTRACT.title)
    expect(wrapper.find('.authoring-knowledge').exists()).toBe(true)
    expect(wrapper.find('.authoring-knowledge__input-row textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('PINAX_PRIMARY_CARRIER_MISSING')
    expect(wrapper.text()).toContain('bad.carrier')
    expect(wrapper.text()).toContain('这个项目要创作什么？')

    // 渲染层唯一的外呼就是 view 通道：它拿不到内核实现，也就没有旁路写盘的可能。
    expect(bridge.request.mock.calls.every((call) => call[0] === IPC_CHANNELS.view)).toBe(true)
    wrapper.unmount()
  })

  it('两个分隔条可拖拽，索引窗宽度受 200–360 约束，右栏受 260–640 约束', async () => {
    const bridge = stubBridge(emptyFrameworkView())
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // jsdom 的 MouseEvent.clientX 只有 getter，所以拖拽用构造参数注入坐标，而不是 trigger 传选项。
    const resizer = wrapper.findAll('.resizer')[0].element
    resizer.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.next-shell').attributes('data-dragging')).toBe('index')
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 900, bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.next-shell').attributes('data-dragging')).toBeUndefined()
    const style = wrapper.find('.nx-index-window').attributes('style')
    const width = Number(style.match(/width: (\d+(?:\.\d+)?)px/)[1])
    expect(width).toBeLessThanOrEqual(360)
    expect(width).toBeGreaterThanOrEqual(200)

    const dock = wrapper.findAll('.resizer')[1].element
    dock.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 900, bubbles: true }))
    await flushPromises()
    const dockStyle = wrapper.find('.col-dock').attributes('style')
    const dockWidth = Number(dockStyle.match(/width: (\d+(?:\.\d+)?)px/)[1])
    expect(dockWidth).toBeGreaterThanOrEqual(260)
    expect(dockWidth).toBeLessThanOrEqual(640)
    wrapper.unmount()
  })
})

describe('运行时栏', () => {
  it('提问走 runtime:ask 通道；没有运行器时如实显示内核拒绝，不编回答', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({
        ok: false,
        error: { code: 'PINAX_DEPENDENCY_UNMET', message: 'Next M1 骨架未接模型运行器（runner）', details: { toolCount: 19 } }
      })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('这本书现在什么状态？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    expect(bridge.request).toHaveBeenCalledWith(IPC_CHANNELS.runtimeAsk, { question: '这本书现在什么状态？' })
    expect(wrapper.find('.authoring-knowledge__error').text()).toContain('未接模型运行器')
    expect(wrapper.text()).not.toContain('编造')
    // 工具面折在底部一个折叠层里，默认不摊开。
    expect(wrapper.find('.authoring-knowledge__agent-detail').attributes('open')).toBeUndefined()
    expect(wrapper.findAll('.authoring-knowledge__agent-list li')).toHaveLength(19)
    wrapper.unmount()
  })

  it('接了 runner 就把回答排成会话；问句在右、回答在左', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '目前 3 章，平均 2100 字' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('现在几章？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__question-row').text()).toContain('现在几章？')
    expect(wrapper.find('.authoring-knowledge__answer-text').text()).toContain('平均 2100 字')
    wrapper.unmount()
  })

  it('没有桥时输入框禁用并说明原因', async () => {
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView() } })
    expect(wrapper.find('.authoring-knowledge__input-row textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('渲染层未接主进程桥')
    wrapper.unmount()
  })
})

describe('Obsidian 三栏', () => {
  it('竖条是纯图标的一格一板，点它开索引窗，再点同一格收起', async () => {
    const bridge = stubBridge(carrierView())
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const rail = wrapper.findComponent(ActivityRail)
    expect(rail.findAll('.nx-ribbon-item')).toHaveLength(2) // 一格是小说板，一格是主题开关
    expect(rail.find('.nx-ribbon-item').attributes('aria-label')).toBe('小说（夹具）')
    expect(rail.find('.nx-ribbon-item').classes()).toContain('is-active')
    expect(wrapper.find('.nx-index-window').exists()).toBe(true)

    // 再点同一格＝收起索引窗（Obsidian 的行为）。
    await rail.find('.nx-ribbon-item').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-index-window').exists()).toBe(false)
    expect(wrapper.findAll('.resizer')).toHaveLength(1)

    await rail.find('.nx-ribbon-item').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-index-window').exists()).toBe(true)
    wrapper.unmount()
  })

  it('核心区只挂 center 槽的面板：正文在中间，目录树归索引窗', async () => {
    const bridge = stubBridge(carrierView())
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    expect(wrapper.find('[data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-pane-id="novel.shelf"]').exists()).toBe(false)
    // 目录树与只读归档在索引窗那一栏，不在核心区。
    expect(wrapper.find('.nx-index-window').text()).toContain('正文')
    expect(wrapper.find('.nx-index-window').text()).toContain('旧稿')
    expect(wrapper.find('.center').text()).not.toContain('旧稿')
    wrapper.unmount()
  })

  it('索引窗的行用老版的 .workspace-nav-item 词汇，选中行标出当前项', async () => {
    const tools = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapters: [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }] } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '雨夜', file: payload.args.file }, text: '雨夜。', totalChars: 3, truncated: false, revision: 1 } } }
        }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '未预期的通道' } }
    })
    const wrapper = mount(AppNext, { props: { bridge: { request: tools } } })
    await flushPromises()

    const row = wrapper.find('.nx-index-window .nx-tree-item')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('雨夜')
    expect(row.classes()).toContain('is-active')
    wrapper.unmount()
  })

  it('中栏在某块板的内容里时，竖条上那块板标成当前', async () => {
    const view = {
      ...carrierView(),
      left: [
        { slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'book', pluginId: 'fixture.novel', primary: true },
        { slot: 'left-dock', id: 'setting.board', title: '设定板', icon: 'library', pluginId: 'fixture.script' }
      ]
    }
    const bridge = stubBridge(view)
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 默认落在主载体那块板——竖条上的「书稿」得标成当前。
    const railItems = wrapper.findAll('.nx-ribbon-item')
    expect(railItems[0].classes()).toContain('is-active')
    expect(railItems[1].classes()).not.toContain('is-active')
    wrapper.unmount()
  })

  it('中栏在零面板时给出解释而不是空白', () => {
    const wrapper = mount(CenterSlotHost, { props: { data: { error: null, notice: '' }, project: null } })
    expect(wrapper.text()).toContain('没有已启用的中栏面板')
    expect(wrapper.text()).toContain('尚未打开项目')
    wrapper.unmount()
  })

  it('主载体向导列出可用载体并走 set-primary 通道', async () => {
    const setPrimary = vi.fn(async () => ({ ok: true, value: {} }))
    const view = { ...emptyFrameworkView(), needsPrimary: true, carriers: [{ id: 'fixture.script', title: '剧本（夹具）', primary: { projectKind: 'screenplay' }, isPrimary: false, isEnabled: false, capabilities: [], requires: [], scopes: [], dataDirs: ['分场'] }] }
    const bridge = stubBridge(view, { [IPC_CHANNELS.carrierSetPrimary]: setPrimary })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    await wrapper.find('.wizard-item').trigger('click')
    await flushPromises()
    expect(setPrimary).toHaveBeenCalledWith({ pluginId: 'fixture.script', expectedRevision: 0 })
    wrapper.unmount()
  })

  it('顶部「设置」菜单切明暗主题：主进程那条菜单事件到了外壳就换主题', async () => {
    globalThis.localStorage?.removeItem('app_theme')
    const handlers = new Map()
    const bridge = {
      request: vi.fn(async (channel) => ({ ok: true, value: channel === IPC_CHANNELS.view ? carrierView() : {} })),
      onEvent: (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    expect(document.documentElement.className).toContain('theme-light')
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.theme' })
    await flushPromises()
    expect(document.documentElement.className).toContain('theme-dark')
    expect(globalThis.localStorage.getItem('app_theme')).toBe('dark')
    wrapper.unmount()
  })
})
