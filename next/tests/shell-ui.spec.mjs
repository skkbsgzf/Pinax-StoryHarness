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

    // 渲染层的外呼只有外壳合同里的这几条：view（读视图）与偏好（D2 主题迁移/持久化）。
    // 它拿不到内核实现，也就没有旁路写盘的可能。
    const allowedCalls = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet]
    expect(bridge.request.mock.calls.every((call) => allowedCalls.includes(call[0]))).toBe(true)
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

  it('统一弹窗内完成主载体选择：列出可用载体、走 set-primary 通道，选完弹窗才可关（工单C0）', async () => {
    const carrier = { id: 'fixture.script', title: '剧本（夹具）', primary: { projectKind: 'screenplay' }, isPrimary: false, isEnabled: false, capabilities: [], requires: [], scopes: [], dataDirs: ['分场'] }
    const view = { ...emptyFrameworkView(), needsPrimary: true, carriers: [carrier] }
    let picked = false
    const request = vi.fn(async (channel) => {
      if (channel === IPC_CHANNELS.view) {
        // 选完主载体后 refresh 拿到的新 view：needsPrimary 翻 false，硬闸放行。
        return { ok: true, value: picked ? { ...view, needsPrimary: false, project: { root: 'x', name: '新书', kind: 'screenplay', spec: 'pinax-project@2', revision: 1 } } : view }
      }
      if (channel === IPC_CHANNELS.carrierSetPrimary) { picked = true; return { ok: true, value: {} } }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const bridge = { request, channels: IPC_CHANNELS }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 工单C0：主载体选择是统一二级页里的一节，needsPrimary 自动摊开、dismissable=false。
    const gate = wrapper.find('[data-test="settings-panel-primary"]')
    expect(gate.exists()).toBe(true)
    expect(wrapper.text()).toContain('这个项目要创作什么？')
    expect(wrapper.find('.workbench-modal-close').exists()).toBe(false)

    await gate.find('.wizard-item').trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledWith(IPC_CHANNELS.carrierSetPrimary, { pluginId: 'fixture.script', expectedRevision: 0 })
    // 选完主载体：needsPrimary 翻 false，统一弹窗放行（自动收起）。
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)
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

describe('偏好与模型面板（批次8①）', () => {
  function prefsBridge({ handlers = new Map(), prefsValue = { modelPlaneEndpoint: null, uiZoom: 0.85 } } = {}) {
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: prefsValue }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent }
  }

  it('菜单「设置 → 偏好与模型…」打开面板：字段来自 prefsGet，死菜单的入口第一次有了落点', async () => {
    const handlers = new Map()
    const bridge = prefsBridge({
      handlers,
      prefsValue: { modelPlaneEndpoint: 'http://127.0.0.1:8461', uiZoom: 0.9 }
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(false)

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    const panel = wrapper.find('[aria-label="偏好与模型"]')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.prefs-input').element.value).toBe('http://127.0.0.1:8461')
    expect(Number(panel.find('.prefs-zoom').element.value)).toBe(0.9)
    wrapper.unmount()
  })

  it('检测与保存都走合同通道：三态如实渲染，保存的载荷端点空串归 null', async () => {
    const handlers = new Map()
    const probe = vi.fn(async () => ({ ok: true, value: { state: 'unreachable', endpoint: 'http://127.0.0.1:8451', detail: '拒绝连接' } }))
    const save = vi.fn(async (payload) => ({ ok: true, value: { modelPlaneEndpoint: payload.modelPlaneEndpoint, uiZoom: payload.uiZoom } }))
    handlers.set(IPC_CHANNELS.prefsProbeModelPlane, probe)
    handlers.set(IPC_CHANNELS.prefsSet, save)
    const bridge = prefsBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()

    await wrapper.find('[aria-label="偏好与模型"]').find('.control-secondary').trigger('click')
    await flushPromises()
    expect(probe).toHaveBeenCalledTimes(1)
    const state = wrapper.find('.prefs-state')
    expect(state.classes()).toContain('is-error')
    expect(state.text()).toContain('模型面不可达')

    const panel = wrapper.find('[aria-label="偏好与模型"]')
    await panel.find('.prefs-input').setValue('')
    await panel.find('.prefs-zoom').setValue('1.1')
    await panel.find('.control-primary').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith({ modelPlaneEndpoint: null, uiZoom: 1.1 })
    expect(wrapper.find('.prefs-state.is-ready').text()).toContain('已保存并生效')
    wrapper.unmount()
  })

  it('外观主题段（D2）：单选写偏好 JSON，并双写老 localStorage 键', async () => {
    globalThis.localStorage?.setItem('app_theme', 'light')
    const handlers = new Map()
    const save = vi.fn(async (patch) => ({ ok: true, value: { ...patch } }))
    handlers.set(IPC_CHANNELS.prefsSet, save)
    const bridge = prefsBridge({ handlers, prefsValue: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()

    const darkRadio = wrapper.find('input[name="prefs-theme"][value="dark"]')
    await darkRadio.setValue()
    await flushPromises()
    expect(save).toHaveBeenCalledWith({ theme: 'dark' })
    expect(globalThis.localStorage.getItem('app_theme')).toBe('dark')
    expect(document.documentElement.className).toContain('theme-dark')
    wrapper.unmount()
  })

  it('主题迁移（D2）：偏好里的 theme 是权威，挂载时覆盖老 localStorage 值并双写回去', async () => {
    globalThis.localStorage?.setItem('app_theme', 'light')
    const handlers = new Map()
    const save = vi.fn(async (patch) => ({ ok: true, value: { ...patch } }))
    handlers.set(IPC_CHANNELS.prefsSet, save)
    const bridge = prefsBridge({ handlers, prefsValue: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'dark' } })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(document.documentElement.className).toContain('theme-dark')
    expect(globalThis.localStorage.getItem('app_theme')).toBe('dark')
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('主题（D2 修正）：偏好没有 theme 时写入应用默认值，不从浏览器缓存迁移（缓存不是权威）', async () => {
    globalThis.localStorage?.setItem('app_theme', 'dark')
    const handlers = new Map()
    const save = vi.fn(async (patch) => ({ ok: true, value: { ...patch } }))
    handlers.set(IPC_CHANNELS.prefsSet, save)
    const bridge = prefsBridge({ handlers, prefsValue: { modelPlaneEndpoint: null, uiZoom: 0.85 } })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    // R3-1：浏览器缓存不是权威——旧 localStorage 里的 dark 不得被读回来，
    // 首帧与应用默认（light）一致，并把默认值写进偏好补全字段。
    expect(document.documentElement.className).toContain('theme-light')
    expect(save).toHaveBeenCalledWith({ theme: 'light' })
    wrapper.unmount()
  })

  it('新建项目走「选目录」：未选目录时新建钮禁用，选后载荷带 root 与名字', async () => {
    const view = { ...emptyFrameworkView(), needsPrimary: true, carriers: [{ id: 'fixture.script', title: '剧本（夹具）', primary: { projectKind: 'screenplay' }, isPrimary: false, isEnabled: false, capabilities: [], requires: [], scopes: [], dataDirs: ['分场'] }] }
    const handlers = new Map()
    const pick = vi.fn(async () => ({ ok: true, value: { picked: true, path: 'D:/books/new-book' } }))
    const create = vi.fn(async () => ({ ok: true, value: {} }))
    handlers.set(IPC_CHANNELS.projectPickDir, pick)
    handlers.set(IPC_CHANNELS.projectCreate, create)
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: view }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const bridge = { request, onEvent: (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) } }
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 工单B0 弹窗化：新建项目不再内嵌在核心区，入口是「文件 → 新建项目…」菜单事件。
    expect(wrapper.find('[aria-label="新建项目"]').exists()).toBe(false)
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.create' })
    await flushPromises()
    expect(wrapper.find('[aria-label="新建项目"]').exists()).toBe(true)

    const createBtn = wrapper.find('[aria-label="新建项目"] .control-primary')
    expect(createBtn.attributes('disabled')).toBeDefined()
    await wrapper.find('[aria-label="新建项目"] .control-secondary').trigger('click')
    await flushPromises()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(createBtn.attributes('disabled')).toBeUndefined()

    await wrapper.find('[aria-label="新建项目"] .prefs-input').setValue('我的新书')
    await createBtn.trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ name: '我的新书', primaryCarrier: 'fixture.script', extraEnabled: [], root: 'D:/books/new-book' })
    wrapper.unmount()
  })
})

describe('载体管理面板（工单A1）', () => {
  function carriersBridge({ handlers = new Map(), view = carrierView() } = {}) {
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: view }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent }
  }

  it('载体管理面板：菜单打开、停用按钮走 carrierSetEnabled（带 expectedRevision）', async () => {
    const handlers = new Map()
    const setEnabled = vi.fn(async () => ({ ok: true, value: {} }))
    handlers.set(IPC_CHANNELS.carrierSetEnabled, setEnabled)
    const view = carrierView()
    // scopes/tools 在真 shellView 里永远是清单原话（不缺省），夹具也照这个形状给。
    view.carriers = view.carriers.map((carrier) => ({
      ...carrier,
      scopes: carrier.id === 'fixture.novel' ? ['正文:rw'] : ['分场:r'],
      tools: [{ name: `${carrier.id}.t1` }, { name: `${carrier.id}.t2` }]
    }))
    view.carriers[1] = { ...view.carriers[1], isEnabled: true }
    const bridge = carriersBridge({ handlers, view })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(wrapper.find('[aria-label="载体管理"]').exists()).toBe(false)

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
    await flushPromises()
    const panel = wrapper.find('[aria-label="载体管理"]')
    expect(panel.exists()).toBe(true)

    const rows = panel.findAll('.carriers-row')
    expect(rows).toHaveLength(2)
    // 主载体徽标 + 清单摊开：dataDirs／scopes／工具数都是 view 里的原话。
    expect(rows[0].text()).toContain('小说（夹具）')
    expect(rows[0].text()).toContain('主载体')
    expect(rows[0].text()).toContain('正文')
    expect(rows[0].text()).toContain('正文:rw')
    expect(rows[0].find('.carriers-tools').text()).toBe('工具 2')
    // 主载体行不可停用自己：按钮禁用并说明原因。
    expect(rows[0].find('.carriers-toggle').attributes('disabled')).toBeDefined()
    expect(rows[0].find('.carriers-hint').text()).toBe('主载体不可停用')
    expect(rows[0].find('.carriers-set-primary').exists()).toBe(false)

    // 非主载体且声明了 primary：既有「停用」也有「设为主载体」。
    expect(rows[1].find('.carriers-toggle').text()).toBe('停用')
    expect(rows[1].find('.carriers-set-primary').exists()).toBe(true)

    await rows[1].find('.carriers-toggle').trigger('click')
    await flushPromises()
    // expectedRevision 用 view.project.revision（夹具里是 1）。
    expect(setEnabled).toHaveBeenCalledTimes(1)
    expect(setEnabled).toHaveBeenCalledWith({ pluginId: 'fixture.script', enabled: false, expectedRevision: 1 })
    wrapper.unmount()
  })

  it('主载体行的「启用/停用」钮不会发出请求；切换主载体复用 set-primary 通道', async () => {
    const handlers = new Map()
    const setEnabled = vi.fn(async () => ({ ok: true, value: {} }))
    const setPrimary = vi.fn(async () => ({ ok: true, value: {} }))
    handlers.set(IPC_CHANNELS.carrierSetEnabled, setEnabled)
    handlers.set(IPC_CHANNELS.carrierSetPrimary, setPrimary)
    const bridge = carriersBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
    await flushPromises()

    const rows = wrapper.find('[aria-label="载体管理"]').findAll('.carriers-row')
    // 主载体行的钮是禁用的：点了也不发通道。
    await rows[0].find('.carriers-toggle').trigger('click')
    await flushPromises()
    expect(setEnabled).not.toHaveBeenCalled()

    await rows[1].find('.carriers-set-primary').trigger('click')
    await flushPromises()
    expect(setPrimary).toHaveBeenCalledWith({ pluginId: 'fixture.script', expectedRevision: 1 })
    wrapper.unmount()
  })

  it('没有项目时菜单事件不渲染面板：启停是对项目合同的写入', async () => {
    const handlers = new Map()
    const bridge = carriersBridge({ handlers, view: emptyFrameworkView() })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
    await flushPromises()
    // 没有 project 就没有面板：carrierSetEnabled/carrierSetPrimary 在通道层同样要求先有项目。
    expect(wrapper.find('[aria-label="载体管理"]').exists()).toBe(false)
    const allowedCalls = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet]
    expect(bridge.request.mock.calls.every((call) => allowedCalls.includes(call[0]))).toBe(true)
    wrapper.unmount()
  })
})

describe('文档历史面板（D2 · R3-3）', () => {
  const OLD_OID = 'a'.repeat(40)
  const NEW_OID = 'b'.repeat(40)
  const SNAPSHOTS = [
    { oid: NEW_OID, message: 'snapshot 2026-10-28 15:00 · 1 文件\n\n正文/雨夜.md', when: '2026-10-28T07:00:00.000Z', author: 'pinax' },
    { oid: OLD_OID, message: 'snapshot 2026-10-28 14:00 · 1 文件', when: '2026-10-28T06:00:00.000Z', author: 'pinax' }
  ]
  const AFTER_RESTORE = [
    { oid: 'c'.repeat(40), message: '恢复 · 雨夜 → aaaaaaa', when: '2026-10-28T08:00:00.000Z', author: 'pinax' },
    ...SNAPSHOTS
  ]
  const DIFF = [
    { type: 'ctx', line: 1, text: '雨夜。' },
    { type: 'del', line: 2, text: '旧句' },
    { type: 'add', line: 2, text: '新句' }
  ]

  /**
   * 历史面板的桥：view／章节工具／历史五通道全部按真实合同形状回。
   * prefsGet 带 theme，避免挂载时的主题迁移写把 save 调用计数搅乱。
   */
  function historyBridge({ handlers = new Map(), probe = { available: true, reason: null }, listHandler = null } = {}) {
    const calls = { list: [], diff: [], show: [], save: [], commit: [] }
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.historyProbe) return { ok: true, value: probe }
      if (channel === IPC_CHANNELS.historyList) {
        calls.list.push(payload)
        return listHandler ? listHandler(payload, calls.list.length) : { ok: true, value: SNAPSHOTS }
      }
      if (channel === IPC_CHANNELS.historyDiff) {
        calls.diff.push(payload)
        return { ok: true, value: { hunks: DIFF } }
      }
      if (channel === IPC_CHANNELS.historyShow) {
        calls.show.push(payload)
        return { ok: true, value: '雨夜旧版。\n' }
      }
      if (channel === IPC_CHANNELS.historyCommitNow) {
        calls.commit.push(payload)
        return { ok: true, value: { committed: true } }
      }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapters: [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }] } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '雨夜', file: payload.args.file }, text: '雨夜。', totalChars: 3, truncated: false, revision: 1 } } }
        }
        if (payload.tool === 'pinax_chapter_save') {
          calls.save.push(payload)
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, file: payload.args.file, revision: 2 } } }
        }
      }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent, calls }
  }

  async function openHistoryFromMenu(bridge, handlers) {
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.history' })
    await flushPromises()
    return wrapper
  }

  it('索引窗「历史…」：列表→选中→diff→恢复走载体 save（带 expectedRevision），二次确认不另开弹窗', async () => {
    const handlers = new Map()
    const bridge = historyBridge({
      handlers,
      listHandler: (_payload, call) => ({ ok: true, value: call === 1 ? SNAPSHOTS : AFTER_RESTORE })
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const historyAction = wrapper.find('.nx-index-window .nx-index-history')
    expect(historyAction.exists()).toBe(true)
    await historyAction.trigger('click')
    await flushPromises()

    const panel = wrapper.find('[aria-label="文档历史"]')
    expect(panel.exists()).toBe(true)
    // 「文档」组出现在统一目录里，历史节是它唯一的一节。
    expect(panel.attributes('role')).toBe('tabpanel')
    expect(wrapper.find('[data-test="settings-tab-history"]').exists()).toBe(true)
    expect(wrapper.findAll('.settings-group-label').map((node) => node.text())).toContain('文档')

    const rows = panel.findAll('.history-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('snapshot 2026-10-28 15:00')
    expect(rows[0].text()).toContain('2026-10-28 15:00')
    expect(rows[0].classes()).toContain('is-active')
    // 最新一版自动选中：diff 相对上一版（旧→新）。
    expect(bridge.calls.diff.at(-1)).toEqual({ a: OLD_OID, b: NEW_OID, path: '正文/雨夜.md' })
    expect(panel.find('.history-diff-line.is-del').text()).toContain('旧句')
    expect(panel.find('.history-diff-line.is-add').text()).toContain('新句')
    expect(panel.find('.history-diff-line.is-ctx').text()).toContain('雨夜。')

    // 第一次点「恢复到这一版」只进二次确认态：同一枚弹窗里，不另开。
    await panel.find('.history-restore').trigger('click')
    await flushPromises()
    expect(panel.find('.history-confirm').exists()).toBe(true)
    expect(wrapper.findAll('.workbench-modal')).toHaveLength(1)

    await panel.find('.history-confirm .control-primary').trigger('click')
    await flushPromises()

    expect(bridge.calls.show).toContainEqual({ oid: NEW_OID, path: '正文/雨夜.md' })
    expect(bridge.calls.save).toHaveLength(1)
    expect(bridge.calls.save[0].tool).toBe('pinax_chapter_save')
    expect(bridge.calls.save[0].args).toEqual({ file: '正文/雨夜.md', text: '雨夜旧版。\n', expectedRevision: 1 })
    expect(bridge.calls.commit.length).toBeGreaterThanOrEqual(2)
    expect(panel.find('.history-feedback.is-ok').text()).toContain('已恢复')
    expect(bridge.calls.list.length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })

  it('不可用态：历史仓库缺失时如实显示，不拉假列表', async () => {
    const handlers = new Map()
    const bridge = historyBridge({ handlers, probe: { available: false, reason: 'history-repo-missing' } })
    const wrapper = await openHistoryFromMenu(bridge, handlers)

    const panel = wrapper.find('[aria-label="文档历史"]')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.history-unavailable').text()).toContain('历史不可用')
    expect(panel.find('.history-retry').exists()).toBe(true)
    expect(panel.findAll('.history-row')).toHaveLength(0)
    expect(bridge.calls.list).toHaveLength(0)
    wrapper.unmount()
  })

  it('空态：文档还没有快照时给说明，不摆空列表', async () => {
    const handlers = new Map()
    const bridge = historyBridge({ handlers, listHandler: () => ({ ok: true, value: [] }) })
    const wrapper = await openHistoryFromMenu(bridge, handlers)

    const panel = wrapper.find('[aria-label="文档历史"]')
    expect(panel.find('.history-empty').text()).toContain('还没有历史快照')
    expect(panel.findAll('.history-row')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('统一设置二级页（工单B0/C0 · U13）', () => {
  /**
   * 作者裁定 U13：配置项／设置页／顶栏延伸的功能配置一律走统一弹窗；工单C0 把四块内容
   * 归一成二级页面（左栏设置分区目录＋右栏设置项，SettingsModal）。这一组只判弹窗行为本身：
   * 开关（遮罩／Esc／关闭钮）、D1 硬闸的不可关闭、菜单落点与左栏目录切换。
   */
  function modalBridge({ handlers = new Map(), view = carrierView() } = {}) {
    const request = vi.fn(async (channel) => ({ ok: true, value: channel === IPC_CHANNELS.view ? view : {} }))
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent }
  }

  it('统一弹窗打开后默认落在菜单指定的节，左栏点目录项即切换右栏面板', async () => {
    const handlers = new Map()
    const bridge = modalBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
    await flushPromises()
    // settings.carriers → activeSection='carriers'；别的节不渲染。
    expect(wrapper.find('[aria-label="载体管理"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(false)

    // 左栏目录：点「偏好与模型」即切到偏好节，载体管理面板卸下。
    await wrapper.find('[data-test="settings-tab-prefs"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="载体管理"]').exists()).toBe(false)
    // 选中的目录项标出当前节（老版 settings-tab.active）。
    expect(wrapper.find('[data-test="settings-tab-prefs"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="settings-tab-carriers"]').classes()).not.toContain('active')
    wrapper.unmount()
  })

  it('统一弹窗打开后点遮罩即关，Esc 也能关（dismissable 缺省开）', async () => {
    const handlers = new Map()
    const bridge = modalBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(true)
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(true)

    // 点遮罩自己（click.self）＝关闭；面板内部点击不受影响。
    await wrapper.find('.workbench-modal').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)

    // 再开一次，Esc 也要能关。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('主载体选择是 D1 硬闸：needsPrimary 自动打开、不可关闭；其它节可看但弹窗关不掉', async () => {
    const bridge = modalBridge({ view: emptyFrameworkView() })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 自动落在主载体节；对话框本体是「设置」这个二级页面。
    expect(wrapper.find('[data-test="settings-panel-primary"]').exists()).toBe(true)
    const dialog = wrapper.find('[aria-label="设置"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('role')).toBe('dialog')
    // 主载体选择在目录里可见。
    expect(wrapper.find('[data-test="settings-tab-primary"]').exists()).toBe(true)
    // 不可关闭：头部没有关闭钮。
    expect(wrapper.find('.workbench-modal-close').exists()).toBe(false)

    // 其它节可看：切到偏好节，面板照常渲染……
    await wrapper.find('[data-test="settings-tab-prefs"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(true)

    // ……但点遮罩不关。
    await wrapper.find('.workbench-modal').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(true)

    // Esc 也不关。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(true)
    wrapper.unmount()
  })

  it('新建项目走「文件 → 新建项目…」菜单事件（project.create）打开，点遮罩可关', async () => {
    const handlers = new Map()
    // 还没开项目、也没被 D1 拦住（首启未尝试打开）：菜单是新建项目的唯一入口。
    const view = {
      ...emptyFrameworkView(),
      needsPrimary: false,
      openError: null,
      rejected: [],
      carriers: [{ id: 'fixture.script', title: '剧本（夹具）', primary: { projectKind: 'screenplay' }, isPrimary: false, isEnabled: false, capabilities: [], requires: [], scopes: [], dataDirs: ['分场'] }]
    }
    const bridge = modalBridge({ handlers, view })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(wrapper.find('[aria-label="新建项目"]').exists()).toBe(false)

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.create' })
    await flushPromises()
    expect(wrapper.find('[aria-label="新建项目"]').exists()).toBe(true)
    // 对话框本体 role=dialog，右栏面板 role=tabpanel（老版设置弹窗的角色语义）。
    expect(wrapper.find('[aria-label="设置"]').attributes('role')).toBe('dialog')
    expect(wrapper.find('[aria-label="新建项目"]').attributes('role')).toBe('tabpanel')

    await wrapper.find('.workbench-modal').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="新建项目"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
