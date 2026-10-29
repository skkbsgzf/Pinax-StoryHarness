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
    carriers: [{ id: 'fixture.novel', title: '小说（夹具）', primary: { projectKind: 'novel' }, isPrimary: true, isEnabled: true, capabilities: [], requires: [], scopes: [], dataDirs: ['正文'], settings: [{ id: 'novel.writing', title: '写作偏好' }] },
      { id: 'fixture.script', title: '剧本（夹具）', primary: { projectKind: 'screenplay' }, isPrimary: false, isEnabled: false, capabilities: [], requires: [], scopes: [], dataDirs: ['分场'], settings: [] }],
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
    // 右栏对齐老版参考区的 320–680（差异表 #6；src/composables/useWorkspaceHost.js:286）；
    // 精确公式由 next/tests/focus-trap.test.mjs 的源码断言钉住。
    expect(dockWidth).toBeGreaterThanOrEqual(320)
    expect(dockWidth).toBeLessThanOrEqual(680)
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

  it('卷→章两级（工单B）：正文/ 下的一级子目录＝卷，卷标题不可点；平铺数据渲染与旧版一致', async () => {
    const chapters = [
      { index: 0, title: '第001章-雨夜', file: '正文/第一卷/第001章-雨夜.md', name: '第001章-雨夜.md', revision: 1 },
      { index: 1, title: '第002章-停摆', file: '正文/第一卷/第002章-停摆.md', name: '第002章-停摆.md', revision: 1 },
      { index: 2, title: '第003章-雪夜', file: '正文/第二卷/第003章-雪夜.md', name: '第003章-雪夜.md', revision: 1 },
      { index: 3, title: '第004章-尾声', file: '正文/第004章-尾声.md', name: '第004章-尾声.md', revision: 1 }
    ]
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: chapters.length, truncated: false, chapters } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '第001章-雨夜', file: payload.args.file }, text: '雨夜。', totalChars: 3, truncated: false, revision: 1 } } }
        }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '未预期的通道' } }
    })
    const wrapper = mount(AppNext, { props: { bridge: { request } } })
    await flushPromises()

    // 卷标题按目录名出，是静态 <p>（不可点、不出现在 .nx-tree-item 里）。
    const volumes = wrapper.findAll('[data-test="chapter-volume"]')
    expect(volumes.map((node) => node.text())).toEqual(['第一卷', '第二卷'])
    expect(volumes[0].element.tagName).toBe('P')
    const rows = wrapper.findAll('.nx-index-window .nx-tree-item')
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining('1. 第001章-雨夜'),
      expect.stringContaining('2. 第002章-停摆'),
      expect.stringContaining('3. 第003章-雪夜'),
      expect.stringContaining('4. 第004章-尾声')
    ])
    // 顺序：卷内的章在卷标题之后——第一卷的两行夹在第一卷与第二卷之间。
    const html = wrapper.find('.nx-index-window .nx-index-body').element.innerHTML
    expect(html.indexOf('第一卷')).toBeLessThan(html.indexOf('第001章-雨夜'))
    expect(html.indexOf('第002章-停摆')).toBeLessThan(html.indexOf('第二卷'))
    expect(html.indexOf('第二卷')).toBeLessThan(html.indexOf('第003章-雪夜'))

    // 卷下的章仍能点开（核心区载入正文）。
    await rows[2].trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('正文/第二卷/第003章-雪夜.md')
    wrapper.unmount()

    // 平铺数据（没有卷子目录）：不画卷标题，行文与拆分前一样。
    const flat = [
      { index: 0, title: '开场', file: '正文/第001章-开场.md', name: '第001章-开场.md', revision: 1 },
      { index: 1, title: '雨夜', file: '正文/第002章-雨夜.md', name: '第002章-雨夜.md', revision: 1 }
    ]
    const flatRequest = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: flat.length, truncated: false, chapters: flat } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '开场', file: payload.args.file }, text: '开场。', totalChars: 3, truncated: false, revision: 1 } } }
        }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '未预期的通道' } }
    })
    const flatWrapper = mount(AppNext, { props: { bridge: { request: flatRequest } } })
    await flushPromises()
    expect(flatWrapper.findAll('[data-test="chapter-volume"]')).toHaveLength(0)
    expect(flatWrapper.findAll('.nx-index-window .nx-tree-item').map((row) => row.text())).toEqual([
      expect.stringContaining('1. 开场'),
      expect.stringContaining('2. 雨夜')
    ])
    flatWrapper.unmount()
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

  it('写作偏好节（工单B · P14 第一个真内容）：改字号／行高保存时偏好载荷带 writingFontSize／writingLineHeight，根节点变量跟着变', async () => {
    const handlers = new Map()
    const save = vi.fn(async (patch) => ({
      ok: true,
      value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light', ...patch }
    }))
    handlers.set(IPC_CHANNELS.prefsSet, save)
    const bridge = prefsBridge({
      handlers,
      prefsValue: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light', writingFontSize: 18, writingLineHeight: 2 }
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 挂载即读偏好在根节点写 CSS 变量（.editor-area 的 font-size／line-height 只读这两个变量）。
    expect(document.documentElement.style.getPropertyValue('--writing-font-size')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--writing-line-height')).toBe('2')

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    const writingTab = wrapper.findAll('.settings-navigation .settings-tab')
      .find((node) => node.text() === '写作偏好')
    await writingTab.trigger('click')
    await flushPromises()

    const panel = wrapper.find('[data-test="settings-panel-carrier:fixture.novel:novel.writing"]')
    expect(panel.exists()).toBe(true)
    const fontInput = panel.find('.writing-font-size')
    const lineInput = panel.find('.writing-line-height')
    expect(Number(fontInput.element.value)).toBe(18)
    expect(Number(lineInput.element.value)).toBe(2)

    await fontInput.setValue('20')
    await lineInput.setValue('2.1')
    await panel.find('.control-primary').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({ writingFontSize: 20, writingLineHeight: 2.1 })
    expect(panel.find('.prefs-state.is-ready').text()).toContain('已保存并生效')
    // 保存后的生效路径：偏好回写 → 外壳写根节点变量（不重开窗口、不重读偏好）。
    expect(document.documentElement.style.getPropertyValue('--writing-font-size')).toBe('20px')
    expect(document.documentElement.style.getPropertyValue('--writing-line-height')).toBe('2.1')
    wrapper.unmount()
    document.documentElement.style.removeProperty('--writing-font-size')
    document.documentElement.style.removeProperty('--writing-line-height')
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

describe('导入既有稿向导（工单E1）', () => {
  function importBridge({ handlers = new Map(), view = carrierView() } = {}) {
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: view }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent }
  }

  const PLAN = {
    mode: 'plan',
    sourceRoot: 'D:/稿子/大梦',
    targetRoot: 'D:/books/大梦',
    importable: 3,
    skippedCount: 1,
    collapsedCount: 0,
    decisions: { chapter: 2, worldbook: 1 },
    skipped: [{ file: '杂件/笔记.md', reason: 'unmapped', detail: '顶层目录与文件名都没有固定类别' }],
    warnings: ['当前是计划模式（dryRun）：未写入任何文件', '源目录只读：本次导入不写、不改、不删源目录下的任何文件。']
  }
  const APPLIED = { ...PLAN, mode: 'apply', createdCount: 3, reusedCount: 0, failedCount: 0, written: [], warnings: [] }

  it('菜单打开→选目录→生成计划走导入通道（dryRun:true）→执行（dryRun:false）→projectOpen 打开新项目', async () => {
    const handlers = new Map()
    const picks = [
      { ok: true, value: { picked: true, path: 'D:/稿子/大梦' } },
      { ok: true, value: { picked: true, path: 'D:/books/大梦' } }
    ]
    const pick = vi.fn(async () => picks.shift())
    const create = vi.fn(async () => ({ ok: true, value: { root: 'D:/books/大梦' } }))
    const importRun = vi.fn(async (payload) => ({ ok: true, value: payload.dryRun ? PLAN : APPLIED }))
    const open = vi.fn(async () => ({ ok: true, value: {} }))
    handlers.set(IPC_CHANNELS.projectPickDir, pick)
    handlers.set(IPC_CHANNELS.projectCreate, create)
    handlers.set(IPC_CHANNELS.projectImportRun, importRun)
    handlers.set(IPC_CHANNELS.projectOpen, open)

    // 还没开项目：主载体仍由板块清单给出（导入要先能建项目骨架）。
    const view = { ...carrierView(), project: null, needsPrimary: false, openError: null }
    const bridge = importBridge({ handlers, view })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(wrapper.find('[aria-label="导入既有稿"]').exists()).toBe(false)

    // 文件 → 导入既有稿…：统一二级页落在 import 节。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.import' })
    await flushPromises()
    const panel = wrapper.find('[aria-label="导入既有稿"]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('tabpanel')
    expect(wrapper.find('[data-test="settings-tab-import"]').exists()).toBe(true)

    // ① 选稿子目录 → ② 选空目录当项目位置（两次都走同一枚系统对话框通道）。
    await panel.find('[data-test="import-pick-source"]').trigger('click')
    await flushPromises()
    expect(panel.find('[data-test="import-source"]').text()).toBe('D:/稿子/大梦')
    expect(panel.find('.prefs-input').element.value).toBe('大梦')
    await panel.find('[data-test="import-pick-target"]').trigger('click')
    await flushPromises()
    expect(panel.find('[data-test="import-target"]').text()).toBe('D:/books/大梦')

    // ③ 生成计划：先建 @2 骨架（session.create），再走导入通道的 dryRun。
    await panel.find('[data-test="import-plan"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ name: '大梦', primaryCarrier: 'fixture.novel', extraEnabled: [], root: 'D:/books/大梦' })
    expect(importRun.mock.calls.at(-1)[0]).toEqual({ sourcePath: 'D:/稿子/大梦', targetPath: 'D:/books/大梦', dryRun: true })

    const planView = panel.find('[data-test="import-plan-view"]')
    expect(planView.exists()).toBe(true)
    const categories = planView.findAll('[data-test="import-category"]').map((node) => node.text())
    expect(categories).toEqual(['正文：2', '世界书：1'])
    expect(planView.text()).toContain('跳过 1 个')
    expect(planView.find('[data-test="import-skipped"]').text()).toContain('杂件/笔记.md')

    // 执行导入：dryRun:false 落盘 → 再经 projectOpen 打开新项目 → refresh。
    const viewCallsBefore = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length
    await panel.find('[data-test="import-apply"]').trigger('click')
    await flushPromises()
    expect(importRun.mock.calls.at(-1)[0]).toEqual({ sourcePath: 'D:/稿子/大梦', targetPath: 'D:/books/大梦', dryRun: false })
    expect(open).toHaveBeenCalledWith({ root: 'D:/books/大梦' })
    expect(wrapper.find('[data-test="import-done"]').text()).toContain('已导入 3 个文件')
    expect(bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length).toBeGreaterThan(viewCallsBefore)

    // 结构动作走 shell 通道，不经内核写族那条 runtimeToolCall——那条路上 kernelWriteGuard 把
    // pinax_project_import 定性为 structural 整组拒（next/tests/kernel-write-guard.test.mjs:111-117）。
    const toolCalls = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeToolCall)
    expect(toolCalls.some(([, payload]) => payload?.tool === 'pinax_project_import')).toBe(false)
    wrapper.unmount()
  })

  it('导入失败原样摊开 typed error：code 与 message 都显示，不假装成功', async () => {
    const handlers = new Map()
    const picks = [
      { ok: true, value: { picked: true, path: 'D:/稿子/旧项目' } },
      { ok: true, value: { picked: true, path: 'D:/books/旧项目' } }
    ]
    handlers.set(IPC_CHANNELS.projectPickDir, vi.fn(async () => picks.shift()))
    handlers.set(IPC_CHANNELS.projectCreate, vi.fn(async () => ({ ok: true, value: {} })))
    handlers.set(IPC_CHANNELS.projectImportRun, vi.fn(async () => ({
      ok: false,
      error: { code: 'PINAX_INVALID_INPUT', message: '该目录已是或曾是 Pinax 项目（含 .pinax/project.json）：D:/稿子/旧项目' }
    })))
    const view = { ...carrierView(), project: null, needsPrimary: false, openError: null }
    const bridge = importBridge({ handlers, view })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.import' })
    await flushPromises()

    const panel = wrapper.find('[aria-label="导入既有稿"]')
    await panel.find('[data-test="import-pick-source"]').trigger('click')
    await flushPromises()
    await panel.find('[data-test="import-pick-target"]').trigger('click')
    await flushPromises()
    await panel.find('[data-test="import-plan"]').trigger('click')
    await flushPromises()

    const failure = panel.find('[data-test="import-error"]')
    expect(failure.exists()).toBe(true)
    expect(failure.text()).toContain('PINAX_INVALID_INPUT')
    expect(failure.text()).toContain('已是或曾是 Pinax 项目')
    expect(panel.find('[data-test="import-plan-view"]').exists()).toBe(false)
    expect(handlers.get(IPC_CHANNELS.projectOpen)).toBeUndefined()
    wrapper.unmount()
  })
})

describe('备份与恢复（工单G2）', () => {
  function backupBridge({ handlers = new Map(), view = carrierView() } = {}) {
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: view }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent }
  }

  const MANIFEST = {
    schema: 'pinax-backup@1',
    projectName: '大梦',
    projectId: 'proj_fixture',
    exportedAt: '2026-10-28T15:04:05.000Z',
    sourceRoot: 'D:/books/大梦',
    includesHistory: false,
    fileCount: 7
  }

  it('备份节：导出走 backup:export；恢复先预检 manifest，再恢复到新目录并经 projectOpen 打开', async () => {
    const handlers = new Map()
    const picks = [
      { ok: true, value: { picked: true, path: 'D:/备份' } },
      { ok: true, value: { picked: true, path: 'D:/备份/大梦-backup-20261028-150405' } },
      { ok: true, value: { picked: true, path: 'D:/books/恢复出来的大梦' } }
    ]
    const pick = vi.fn(async () => picks.shift())
    const exportFn = vi.fn(async () => ({ ok: true, value: { path: 'D:/备份/大梦-backup-20261028-150405', fileCount: 7, bytes: 2048 } }))
    const restoreFn = vi.fn(async (payload) => (payload.targetRoot
      ? { ok: true, value: { root: payload.targetRoot, manifest: MANIFEST } }
      : { ok: true, value: { manifest: MANIFEST } }))
    const open = vi.fn(async () => ({ ok: true, value: {} }))
    handlers.set(IPC_CHANNELS.projectPickDir, pick)
    handlers.set(IPC_CHANNELS.backupExport, exportFn)
    handlers.set(IPC_CHANNELS.backupRestore, restoreFn)
    handlers.set(IPC_CHANNELS.projectOpen, open)

    const bridge = backupBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(wrapper.find('[aria-label="备份与恢复"]').exists()).toBe(false)

    // 文件 → 备份与恢复…：统一二级页落在 backup 节。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.backup' })
    await flushPromises()
    const panel = wrapper.find('[aria-label="备份与恢复"]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('tabpanel')
    expect(wrapper.find('[data-test="settings-tab-backup"]').exists()).toBe(true)

    // ① 导出：pick(backup-target) → backup:export（includeHistory 默认 false）。
    const toolCallsBefore = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeToolCall).length
    await panel.find('[data-test="backup-pick-target"]').trigger('click')
    await flushPromises()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(exportFn).toHaveBeenCalledWith({ targetParent: 'D:/备份', includeHistory: false })
    expect(panel.find('[data-test="backup-target"]').text()).toBe('D:/备份')
    const done = panel.find('[data-test="backup-done"]')
    expect(done.text()).toContain('D:/备份/大梦-backup-20261028-150405')
    expect(done.text()).toContain('7 个文件')
    expect(done.text()).toContain('2.0 KB')

    // ② 选备份目录：pick(backup-source) → backup:restore 只带 backupDir（预检），摘要先摊开。
    await panel.find('[data-test="backup-pick-source"]').trigger('click')
    await flushPromises()
    expect(pick).toHaveBeenCalledTimes(2)
    expect(restoreFn).toHaveBeenLastCalledWith({ backupDir: 'D:/备份/大梦-backup-20261028-150405' })
    const summary = panel.find('[data-test="backup-manifest"]')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('项目 大梦')
    expect(summary.text()).toContain('7 个文件')
    expect(summary.text()).toContain('不含历史仓')

    // ③ 选恢复位置 → 恢复：backup:restore 带 targetRoot → projectOpen 打开 → refresh。
    await panel.find('[data-test="backup-pick-restore-target"]').trigger('click')
    await flushPromises()
    expect(pick).toHaveBeenCalledTimes(3)
    expect(panel.find('[data-test="backup-restore-target"]').text()).toBe('D:/books/恢复出来的大梦')

    const viewCallsBefore = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length
    await panel.find('[data-test="backup-restore"]').trigger('click')
    await flushPromises()
    expect(restoreFn).toHaveBeenLastCalledWith({ backupDir: 'D:/备份/大梦-backup-20261028-150405', targetRoot: 'D:/books/恢复出来的大梦' })
    expect(open).toHaveBeenCalledWith({ root: 'D:/books/恢复出来的大梦' })
    expect(panel.find('[data-test="backup-restored"]').text()).toContain('项目已打开')
    expect(bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length).toBeGreaterThan(viewCallsBefore)

    // 备份/恢复走 shell 通道，不经内核写族那条 runtimeToolCall（挂载时的章节列表不算数，按前后计数比）。
    expect(bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeToolCall)).toHaveLength(toolCallsBefore)
    wrapper.unmount()
  })

  it('失败原样摊开 typed error：BACKUP_TARGET_NOT_EMPTY 显示 code 与 message，不假装成功', async () => {
    const handlers = new Map()
    const picks = [
      { ok: true, value: { picked: true, path: 'D:/备份/大梦-backup-20261028-150405' } },
      { ok: true, value: { picked: true, path: 'D:/books/非空目录' } }
    ]
    handlers.set(IPC_CHANNELS.projectPickDir, vi.fn(async () => picks.shift()))
    handlers.set(IPC_CHANNELS.backupRestore, vi.fn(async (payload) => (payload.targetRoot
      ? { ok: false, error: { code: 'BACKUP_TARGET_NOT_EMPTY', message: '目标目录非空：D:/books/非空目录。恢复只支持空目录（防止覆盖现稿），请另选一个位置' } }
      : { ok: true, value: { manifest: MANIFEST } })))
    const bridge = backupBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.backup' })
    await flushPromises()

    const panel = wrapper.find('[aria-label="备份与恢复"]')
    await panel.find('[data-test="backup-pick-source"]').trigger('click')
    await flushPromises()
    await panel.find('[data-test="backup-pick-restore-target"]').trigger('click')
    await flushPromises()
    await panel.find('[data-test="backup-restore"]').trigger('click')
    await flushPromises()

    const failure = panel.find('[data-test="backup-restore-error"]')
    expect(failure.exists()).toBe(true)
    expect(failure.text()).toContain('BACKUP_TARGET_NOT_EMPTY')
    expect(failure.text()).toContain('恢复只支持空目录')
    expect(panel.find('[data-test="backup-restored"]').exists()).toBe(false)
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

    // 工单H1：行尾是一枚 14px 图标钮（不再用「历史…」文字占一行），aria-label 仍点名是哪一篇。
    const historyAction = wrapper.find('.nx-index-window .nx-index-history')
    expect(historyAction.exists()).toBe(true)
    expect(historyAction.text()).toBe('')
    expect(historyAction.find('svg').exists()).toBe(true)
    expect(historyAction.attributes('aria-label')).toBe('「雨夜」的历史')
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

describe('提案审阅（工单B1 · 协议 v1.1-B：列表在二级页，审阅面在中栏）', () => {
  const PROPOSAL = {
    name: '20261028T140000-ch1-abcdef12.json',
    kind: 'proposal',
    schema: 'pinax-proposal@1',
    id: '20261028T140000-ch1-abcdef12',
    status: 'proposed',
    target: { index: 0, title: '第001章-雨夜', file: '正文/雨夜.md', chars: 3 },
    contentChars: 9,
    createdAt: '2026-10-28T14:00:00',
    note: '把雨提前一段'
  }

  /**
   * 提案审阅节的桥：view／章节工具／提案三把按真合同形状回。
   * prefsGet 带 theme，避免挂载时的主题迁移写搅乱调用计数。
   */
  function proposalsBridge({ handlers = new Map(), proposals = [PROPOSAL] } = {}) {
    const calls = { list: [], read: [], save: [] }
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }] } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '雨夜', file: payload.args.file }, text: '雨夜。', totalChars: 3, truncated: false, revision: 1 } } }
        }
        if (payload.tool === 'pinax_chapter_save') {
          calls.save.push(payload)
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, file: payload.args.file, revision: 2, created: false, bytes: payload.args.text.length } } }
        }
        if (payload.tool === 'pinax_proposal_list') {
          calls.list.push(payload)
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: proposals.length, raw: [], rawTotal: 0, warnings: [], proposals } } }
        }
        if (payload.tool === 'pinax_proposal_read') {
          calls.read.push(payload)
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, name: PROPOSAL.name, path: `.pinax/proposals/${PROPOSAL.name}`, proposal: { schema: 'pinax-proposal@1', id: PROPOSAL.id, status: 'proposed', target: PROPOSAL.target, content: '雨夜，巷子里没人。', contentChars: 9, note: PROPOSAL.note, createdAt: PROPOSAL.createdAt } } } }
        }
      }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent, calls }
  }

  it('菜单「项目 → 提案审阅…」打开「文档」组新节：列表→点开→关闭弹窗→中栏对照→采纳带提案名', async () => {
    const handlers = new Map()
    const bridge = proposalsBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 索引窗不再摆提案区（v1.1-A：小说栏只有正文一棵树）。
    expect(wrapper.find('.nx-index-window').text()).not.toContain('提案')
    expect(bridge.calls.list).toHaveLength(0)

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.reviewProposals' })
    await flushPromises()

    const panel = wrapper.find('[aria-label="提案审阅"]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('tabpanel')
    expect(wrapper.find('[data-test="settings-tab-proposals"]').exists()).toBe(true)
    // 它和「文档历史」同属「文档」组。
    expect(wrapper.findAll('.settings-group-label').map((node) => node.text())).toContain('文档')
    const tabsInDoc = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabsInDoc).toContain('文档历史')
    expect(tabsInDoc).toContain('提案审阅')

    // 列表走 pinax_proposal_list 一条通道；行文＝目标章＋创建时刻。
    expect(bridge.calls.list.length).toBeGreaterThanOrEqual(1)
    const row = panel.find(`[data-test="proposal-row-${PROPOSAL.name}"]`)
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('第001章-雨夜')
    expect(row.text()).toContain('10-28 14:00')

    // 点一条：弹窗关掉，正文栏打开既有审阅面（当前正文 vs 提案新文）。
    await row.trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="提案审阅"]').exists()).toBe(false)
    expect(bridge.calls.read).toHaveLength(1)
    const pane = wrapper.find('[data-pane-id="novel.editor"]')
    expect(pane.exists()).toBe(true)
    expect(pane.text()).toContain('提案 · 第001章-雨夜')
    expect(pane.text()).toContain('提案说明：把雨提前一段')
    expect(pane.find('.editor-text, .entry-text').text()).toBe('雨夜。')
    expect(pane.find('[aria-label="提案新文"]').text()).toBe('雨夜，巷子里没人。')

    // 采纳仍走既有那条：chapter_save 带当前修订号与提案名。
    await pane.find('.editor-foot .pane-btn.is-primary').trigger('click')
    await flushPromises()
    expect(bridge.calls.save).toHaveLength(1)
    expect(bridge.calls.save[0].args).toEqual({ file: '正文/雨夜.md', text: '雨夜，巷子里没人。', expectedRevision: 1, proposal: PROPOSAL.name })
    expect(wrapper.text()).toContain('已采纳提案')
    wrapper.unmount()
  })

  it('空态：没有提案时如实说明，不摆空列表；运行时散件报数但不进审阅面', async () => {
    const handlers = new Map()
    const bridge = proposalsBridge({ handlers, proposals: [] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.reviewProposals' })
    await flushPromises()
    const panel = wrapper.find('[aria-label="提案审阅"]')
    expect(panel.find('[data-test="proposals-section"]').text()).toContain('还没有提案')
    expect(panel.findAll('[data-test^="proposal-row-"]')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('标题栏与页内菜单行（工单F · 作者反馈①②）', () => {
  it('标题栏渲染项目信息 chip：有项目＝名称·类型·版本，无项目＝未打开项目', async () => {
    const withProject = mount(AppNext, { props: { bridge: stubBridge(carrierView()) } })
    await flushPromises()
    expect(withProject.find('.nx-titlebar').exists()).toBe(true)
    expect(withProject.find('.nx-titlebar-brand').text()).toBe('Pinax · Next')
    expect(withProject.find('[data-test="titlebar-project-chip"]').text()).toBe('大梦 · novel · 第 1 版')
    // 右侧给原生窗控留位（主进程 titleBarOverlay 盖在这块上）。
    expect(withProject.find('.nx-titlebar-window-controls').exists()).toBe(true)
    withProject.unmount()

    const withoutProject = mount(AppNext, { props: { bridge: stubBridge(emptyFrameworkView()) } })
    await flushPromises()
    expect(withoutProject.find('[data-test="titlebar-project-chip"]').text()).toBe('未打开项目')
    withoutProject.unmount()
  })

  it('页内菜单行：顶层与 MENU_TEMPLATE 一致，菜单项走 menuInvoke；打开项目＝选目录→projectOpen→refresh；Esc/点外部收起', async () => {
    const view = { ...carrierView(), project: null, needsPrimary: false, openError: null, left: [], center: [], primary: null }
    const pick = vi.fn(async () => ({ ok: true, value: { picked: true, path: 'D:/books/大梦' } }))
    const open = vi.fn(async () => ({ ok: true, value: {} }))
    const bridge = stubBridge(view, {
      [IPC_CHANNELS.projectPickDir]: pick,
      [IPC_CHANNELS.projectOpen]: open
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 页内菜单行不是第二份清单：顶层标签就是 MENU_TEMPLATE 的那四个（工单A 精简后）。
    expect(wrapper.findAll('.nx-menu-trigger').map((node) => node.text()))
      .toEqual(['项目', '编辑', '设置', '帮助'])

    await wrapper.find('[data-menu="项目"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(true)
    expect(wrapper.find('[data-menu="项目"]').attributes('aria-expanded')).toBe('true')

    // 打开项目文件夹…：走 menuInvoke 分发，同时选目录→projectOpen→refresh 一条链落完。
    const viewCallsBefore = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length
    await wrapper.find('[data-menu-id="project.open"]').trigger('click')
    await flushPromises()
    expect(bridge.request).toHaveBeenCalledWith(IPC_CHANNELS.menuInvoke, { id: 'project.open' })
    expect(pick).toHaveBeenCalledWith({})
    expect(open).toHaveBeenCalledWith({ root: 'D:/books/大梦' })
    expect(bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length).toBeGreaterThan(viewCallsBefore)
    // 点完一项就收起下拉。
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(false)

    // Esc 收起下拉。
    await wrapper.find('[data-menu="设置"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(false)

    // 点击菜单外部收起下拉。
    await wrapper.find('[data-menu="设置"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(true)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(false)
    wrapper.unmount()
  })

  it('编辑组的项都有 id、页内点得动；帮助组里从视图迁来的 role 项仍是禁用行', async () => {
    const bridge = stubBridge(carrierView())
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 工单A：编辑组补 id 后，页内菜单行不再把撤销/剪贴板画成禁用行——点了走 menuInvoke
    // （主进程落到当前窗口 webContents 的编辑命令）。
    await wrapper.find('[data-menu="编辑"]').trigger('click')
    await flushPromises()
    const editRows = wrapper.findAll('.nx-menu-popup .nx-menu-item')
    expect(editRows).toHaveLength(6)
    expect(editRows.every((row) => row.attributes('disabled') === undefined)).toBe(true)
    expect(editRows.map((row) => row.attributes('data-menu-id'))).toEqual([
      'edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.selectAll'
    ])
    await wrapper.find('[data-menu-id="edit.undo"]').trigger('click')
    await flushPromises()
    expect(bridge.request).toHaveBeenCalledWith(IPC_CHANNELS.menuInvoke, { id: 'edit.undo' })
    expect(wrapper.find('.nx-menu-popup').exists()).toBe(false)

    // 帮助组里从视图组迁来的「开发者工具/重载」是 role 项（没有 id）：原生菜单与快捷键提供，
    // 页内仍渲染成禁用行，不假装点了有用。
    await wrapper.find('[data-menu="帮助"]').trigger('click')
    await flushPromises()
    const helpRows = wrapper.findAll('.nx-menu-popup .nx-menu-item')
    expect(helpRows).toHaveLength(4)
    const roleRows = helpRows.filter((row) => row.attributes('data-menu-id') === undefined)
    expect(roleRows).toHaveLength(2)
    expect(roleRows.every((row) => row.attributes('disabled') !== undefined)).toBe(true)
    expect(roleRows.map((row) => row.text())).toEqual(['开发者工具', '重载'])
    wrapper.unmount()
  })
})

describe('无项目时的竖条（工单F · 作者反馈③）', () => {
  it('竖条常驻：载体格禁用＋「打开项目后可用」，打开/新建动作可用，主题钮仍在底部', async () => {
    const view = { ...carrierView(), project: null, needsPrimary: false, openError: null, left: [], center: [], primary: null }
    const pick = vi.fn(async () => ({ ok: true, value: { picked: false, path: null } }))
    const open = vi.fn(async () => ({ ok: true, value: {} }))
    const bridge = stubBridge(view, {
      [IPC_CHANNELS.projectPickDir]: pick,
      [IPC_CHANNELS.projectOpen]: open
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const rail = wrapper.findComponent(ActivityRail)
    expect(rail.find('[aria-label="打开项目…"]').exists()).toBe(true)
    expect(rail.find('[aria-label="新建项目…"]').exists()).toBe(true)

    // registry.list() 的两块载体照常出现，但是禁用态，并说明打开项目后可用。
    const cells = rail.findAll('.nx-ribbon-item[aria-disabled="true"]')
    expect(cells).toHaveLength(2)
    expect(cells.map((node) => node.attributes('aria-label'))).toEqual(['小说（夹具）', '剧本（夹具）'])
    expect(cells[0].attributes('data-tooltip')).toBe('打开项目后可用')
    expect(rail.find('.nx-ribbon-item.is-bottom').exists()).toBe(true)

    // 打开项目…：走系统目录对话框；取消就什么都不做（不调 projectOpen）。
    await rail.find('[aria-label="打开项目…"]').trigger('click')
    await flushPromises()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()

    // 新建项目…：落在统一二级页的 newProject 节。
    await rail.find('[aria-label="新建项目…"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="新建项目"]').exists()).toBe(true)
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

  it('焦点陷阱（差异表 #10）：弹窗打开时 Tab 焦点不出面板，关闭后不留驻', async () => {
    const handlers = new Map()
    const bridge = modalBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge }, attachTo: document.body })
    await flushPromises()

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()

    const panel = wrapper.find('.workbench-modal-panel').element
    // 打开即把焦点收进面板：不在弹窗背后的页面上。
    expect(panel.contains(document.activeElement)).toBe(true)

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = [...panel.querySelectorAll(FOCUSABLE)]
    expect(focusables.length).toBeGreaterThan(1)
    const first = focusables[0]
    const last = focusables.at(-1)

    // 末尾 Tab 回第一个，第一个 Shift+Tab 回末尾（jsdom 不实现默认 Tab 顺序，所以回绕一定出自陷阱）。
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.activeElement).toBe(first)

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.activeElement).toBe(last)

    // 连按 Tab 轮询：每一步焦点都还在面板里。
    for (let step = 0; step < 10; step += 1) {
      expect(panel.contains(document.activeElement)).toBe(true)
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      await flushPromises()
    }
    expect(panel.contains(document.activeElement)).toBe(true)

    // 关掉弹窗：面板卸下，焦点不再留在面板里（归还给打开前的持有者，这里本来就是 body）。
    await wrapper.find('.workbench-modal').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)
    expect(panel.contains(document.activeElement)).toBe(false)
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

  it('设置目录按组渲染（工单B）：应用／项目／文档三组标题存在，节序按归组走', async () => {
    const handlers = new Map()
    const bridge = modalBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
    await flushPromises()

    // 组标题来自各节的 group 字段（AppNext.settingsSections），不是写死在弹窗里的第二份清单。
    const labels = wrapper.findAll('.settings-group-label').map((node) => node.text())
    expect(labels.slice(0, 3)).toEqual(['应用', '项目', '文档'])

    // 静态七节按组序排列：应用（偏好与模型/备份与恢复）→ 项目（载体管理/导入既有稿/新建项目/主载体选择）→ 文档（文档历史）。
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs.slice(0, 7)).toEqual(['偏好与模型', '备份与恢复', '载体管理', '导入既有稿', '新建项目', '主载体选择', '文档历史'])
    wrapper.unmount()
  })

  it('目录搜索（工单B）：标题与已知描述浅匹配，输入后只剩匹配项；无命中显示「无匹配设置」', async () => {
    const handlers = new Map()
    const bridge = modalBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()

    const search = wrapper.find('[data-test="settings-search"]')
    expect(search.exists()).toBe(true)

    // 标题命中「备份」：目录只剩备份与恢复，分组标题也只剩「应用」。
    await search.setValue('备份')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())).toEqual(['备份与恢复'])
    expect(wrapper.findAll('.settings-group-label').map((node) => node.text())).toEqual(['应用'])
    // 搜索只过滤目录，不把右栏当前节换掉。
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(true)

    // 说明字段的浅匹配（keywords 来自各节的标题/描述）：搜「历史仓」也命中备份与恢复。
    await search.setValue('历史仓')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())).toEqual(['备份与恢复'])

    await search.setValue('不存在的设置项')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab')).toHaveLength(0)
    expect(wrapper.find('[data-test="settings-empty"]').text()).toBe('无匹配设置')

    // 清空：目录恢复（静态七节在前，载体占位节在后）。
    await search.setValue('')
    await flushPromises()
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs.slice(0, 7)).toEqual(['偏好与模型', '备份与恢复', '载体管理', '导入既有稿', '新建项目', '主载体选择', '文档历史'])
    wrapper.unmount()
  })

  it('载体设置节读真声明（P14 第二／三步）：有声明的载体出目录项，novel.writing 渲染真内容，未映射声明仍空态', async () => {
    const handlers = new Map()
    const bridge = modalBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()

    // 有声明的载体进「载体」组，目录项文案就是声明里的 title——不再是按载体标题伪造的「<载体> 设置」。
    expect(wrapper.findAll('.settings-group-label').map((node) => node.text())).toContain('载体')
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs).toContain('写作偏好')
    expect(tabs).not.toContain('小说（夹具） 设置')
    // settings: [] 的载体不出目录项（fixture.script 声明为空）。
    expect(tabs).not.toContain('剧本（夹具） 设置')

    const carrierTab = wrapper.findAll('.settings-navigation .settings-tab')
      .find((node) => node.text() === '写作偏好')
    await carrierTab.trigger('click')
    await flushPromises()
    // 节 id 拼了载体前缀（声明 id 只在载体命名空间里唯一）；
    // 工单B：novel.writing 在组件表里，右栏是真内容（字号/行高），不再是空态。
    const panel = wrapper.find('[data-test="settings-panel-carrier:fixture.novel:novel.writing"]')
    expect(panel.exists()).toBe(true)
    expect(wrapper.find('[data-test="carrier-settings-empty"]').exists()).toBe(false)
    // prefsGet 没带写作字段（modalBridge 返回 {}）→ 组件按默认 17／1.9 起。
    expect(Number(panel.find('.writing-font-size').element.value)).toBe(17)
    expect(Number(panel.find('.writing-line-height').element.value)).toBe(1.9)
    wrapper.unmount()

    // 没有组件映射的声明（novel.unknown）仍出空态——注册制不伪造设置项。
    const unknownHandlers = new Map()
    const novel = carrierView().carriers[0]
    const unknownView = {
      ...carrierView(),
      carriers: [{ ...novel, settings: [{ id: 'novel.unknown', title: '未实现节' }] }]
    }
    const unknown = mount(AppNext, { props: { bridge: modalBridge({ handlers: unknownHandlers, view: unknownView }) } })
    await flushPromises()
    unknownHandlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    const unknownTab = unknown.findAll('.settings-navigation .settings-tab')
      .find((node) => node.text() === '未实现节')
    await unknownTab.trigger('click')
    await flushPromises()
    expect(unknown.find('[data-test="settings-panel-carrier:fixture.novel:novel.unknown"]').exists()).toBe(true)
    expect(unknown.find('[data-test="carrier-settings-empty"]').text()).toBe('该载体的设置项还没有内容')
    unknown.unmount()
  })
})

describe('大纲悬浮窗（协议 v1.1-C · 工单C）', () => {
  const OUTLINE_NODES = [
    { id: 'n1', title: '开场：雨夜进城', summary: '雪夜，柯秒进了城。' },
    { id: 'n2', title: '第一折：停摆的表' }
  ]

  /** 在 carrierView 上补一块大纲载体（含 overlay pane 声明）与它的左树/中栏。 */
  function overlayView() {
    const base = carrierView()
    const outlineCarrier = {
      id: 'pinax.carrier.outline',
      title: '大纲',
      primary: { projectKind: 'generic' },
      isPrimary: false,
      isEnabled: true,
      capabilities: ['outline.tree'],
      requires: [],
      scopes: ['file:大纲:rw', 'agent:ask'],
      dataDirs: ['大纲'],
      settings: [],
      tools: ['pinax_outline_read', 'pinax_outline_save'],
      context: { providers: ['outline'], budgetChars: 20000 },
      panes: [
        { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline' },
        { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list' },
        { slot: 'overlay', id: 'outline.widget', title: '大纲', width: 300 }
      ]
    }
    return {
      ...base,
      carriers: [...base.carriers, outlineCarrier],
      left: [...base.left, { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }],
      center: [...base.center, { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }]
    }
  }

  function overlayBridge({ handlers = new Map(), nodes = OUTLINE_NODES } = {}) {
    const calls = []
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: overlayView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        calls.push(payload.tool)
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }] } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '雨夜', file: payload.args.file }, text: '雨夜。', totalChars: 3, truncated: false, revision: 1 } } }
        }
        if (payload.tool === 'pinax_outline_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.outline', payload: { ok: true, source: '大纲/outline.json', nodes, edges: [], nodeTotal: nodes.length, truncated: false, revision: 1, warning: null } } }
        }
        if (payload.tool === 'pinax_outline_save') {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.outline', payload: { ok: true, file: '大纲/outline.json', revision: 2, nodeTotal: payload.args.nodes?.length ?? 0 } } }
        }
      }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent, calls }
  }

  async function openOutlineBoard(wrapper) {
    const rail = wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === '大纲')
    expect(rail, '竖条应有大纲栏').toBeTruthy()
    await rail.trigger('click')
    await flushPromises()
  }

  async function openWidget(wrapper) {
    const toggle = wrapper.find('[aria-label="悬浮大纲"]')
    expect(toggle.exists(), '大纲区标题行右侧应有「悬浮」钮').toBe(true)
    await toggle.trigger('click')
    await flushPromises()
  }

  it('开/收/展开：索引窗「悬浮」钮打开右上卡片，收起成侧缘小标签，点标签再展开；Esc 收起', async () => {
    globalThis.localStorage?.clear()
    const bridge = overlayBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openOutlineBoard(wrapper)

    // 打开前没有悬浮窗；开关就是大纲区标题行右侧那枚 .control-quiet。
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(false)
    await openWidget(wrapper)

    const widget = wrapper.find('.nx-overlay-widget')
    expect(widget.exists()).toBe(true)
    expect(widget.attributes('aria-label')).toBe('大纲悬浮窗')
    expect(widget.attributes('data-overlay-id')).toBe('outline.widget')
    expect(widget.find('.nx-overlay-title').text()).toBe('大纲')
    // 内容＝迷你大纲（只读清单），打开时现取一次大纲。
    expect(bridge.calls).toContain('pinax_outline_read')
    const rows = widget.findAll('.nx-overlay-tree .workspace-nav-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('开场：雨夜进城')
    expect(rows[1].text()).toContain('第一折：停摆的表')

    // 收起：卡片退场，右侧缘留一枚小标签。
    await widget.find('[aria-label="收起悬浮窗"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(false)
    const tab = wrapper.find('.nx-overlay-tab')
    expect(tab.exists()).toBe(true)
    expect(tab.attributes('aria-label')).toBe('展开大纲悬浮窗')
    expect(tab.text()).toBe('大纲')

    // 点标签展开。
    await tab.trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(true)

    // Esc 收起（统一二级页没开时）。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(false)
    expect(wrapper.find('.nx-overlay-tab').exists()).toBe(true)
    wrapper.unmount()
  })

  it('正文写作时也可用：切回小说栏悬浮窗仍在；点迷你大纲一行跳到大纲编辑面', async () => {
    globalThis.localStorage?.clear()
    const bridge = overlayBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    // 切回小说板：悬浮窗不随板走（这正是它的价值）。
    const novelRail = wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === '小说（夹具）')
    expect(novelRail).toBeTruthy()
    await novelRail.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(true)

    // 点迷你大纲：切回大纲栏并把该节点送进中栏编辑面；悬浮窗保持开着。
    const first = wrapper.find('.nx-overlay-tree .workspace-nav-item')
    await first.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-pane-id="outline.editor"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="大纲节点标题"]').element.value).toBe('开场：雨夜进城')
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(true)
    wrapper.unmount()
  })

  it('Esc 优先关统一二级页：设置开着时 Esc 收起的是弹窗，悬浮窗不动', async () => {
    globalThis.localStorage?.clear()
    const handlers = new Map()
    const bridge = overlayBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(true)

    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    // 弹窗被 Esc 关掉（WorkbenchModal 的语义），悬浮窗还在。
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(true)
    wrapper.unmount()
  })

  it('位置记忆：拖动写入 localStorage 的 overlay.outline.widget，重新挂载读回同一坐标', async () => {
    globalThis.localStorage?.clear()
    const bridge = overlayBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    const head = wrapper.find('.nx-overlay-head').element
    head.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 130, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 130, bubbles: true }))
    await flushPromises()

    const stored = JSON.parse(globalThis.localStorage.getItem('overlay.outline.widget'))
    expect(stored).toEqual({ left: 40, top: 30 })
    expect(wrapper.find('.nx-overlay-widget').attributes('style')).toContain('left: 40px')
    wrapper.unmount()

    // 重新挂载＝重新读位置：坐标仍在（键 overlay.<paneId>）。
    const second = mount(AppNext, { props: { bridge: overlayBridge() } })
    await flushPromises()
    await openOutlineBoard(second)
    await openWidget(second)
    const style = second.find('.nx-overlay-widget').attributes('style')
    expect(style).toContain('left: 40px')
    expect(style).toContain('top: 30px')
    second.unmount()
    globalThis.localStorage?.clear()
  })
})
