import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount as vueMount } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import ActivityRail from '../shell/ActivityRail.vue'
import RuntimeDock from '../shell/RuntimeDock.vue'
import AssistantDialog from '../shell/AssistantDialog.vue'
import CenterSlotHost from '../shell/CenterSlotHost.vue'
import { IPC_CHANNELS, IPC_EVENT, IPC_PUSH } from '../shell/ipcContract.mjs'
import { hostWorkspace, resetWorkspace } from '../shell/workspace.mjs'
import { CUSTOM_VIEW_TYPE, hostViewRegistry } from '../shell/viewRegistry.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'

/**
 * 工作区四轴（M2.5-C）是模块级单例：每个用例从空工作区起步，避免上一个用例的形态／位置泄漏。
 * 状态现在落在 `.pinax/workspace.json`（经 bridge 的 workspaceLoad／workspaceSave），
 * 持久化用例自己在同一用例内跨挂载喂回同一份存档。
 */
beforeEach(() => {
  resetWorkspace()
})

/**
 * 〔批次76-R3 补刀·A1〕挂载台账：129 处挂载大多自觉 unmount，但中途抛错的用例来不及——
 * 残壳留在 document 上的 keydown 会替后续每个用例跑 collapseTopWindow（悬浮球计数虚高）。
 * 本地 mount 包一层进台账，文件级 afterEach 统一回卷；正常用例自己的 unmount 再跑一次是幂等丢弃。
 */
const mountedWrappers = []
function mount(...args) {
  const wrapper = vueMount(...args)
  mountedWrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  while (mountedWrappers.length) {
    try {
      mountedWrappers.pop().unmount()
    } catch {
      // 已经死掉（或用例内异常导致根节点没了）的壳就地丢弃，不让清理本身再炸出第二个红。
    }
  }
})

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
    // 守卫夹具（批次32 拆除、33/34 曾回潮）：带归档数据，「不出现」断言才防得住再犯。
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

    // 渲染层的外呼只有这几条：view（读视图）、偏好（D2 主题迁移/持久化）、
    // 以及 M2.5-C 的工作区四轴（workspaceLoad／workspaceSave 是唯一落盘点，坐标与形态都走它）。
    // 批次49 起挂载时多一次服务日志池快照读（只读，竖条状态点与设置页共用）。
    // 批次62 起再多一次快捷键表读取（hotkeysLoad，只读：Ctrl+P 那把键得先知道作者改过没有）。
    // 它拿不到内核实现，也就没有旁路写盘的可能。
    const allowedCalls = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet, IPC_CHANNELS.workspaceLoad, IPC_CHANNELS.workspaceSave, IPC_CHANNELS.runtimeServiceLog, IPC_CHANNELS.hotkeysLoad]
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

    expect(bridge.request).toHaveBeenCalledWith(IPC_CHANNELS.runtimeAsk, {
      question: '这本书现在什么状态？',
      askId: expect.any(String),
      writeMode: 'review'
    })
    expect(wrapper.find('.authoring-knowledge__error').text()).toContain('未接模型运行器')
    expect(wrapper.text()).not.toContain('编造')
    // 工具面折在底部一个折叠层里，默认不摊开。
    expect(wrapper.find('.authoring-knowledge__agent-detail').attributes('open')).toBeUndefined()
    expect(wrapper.findAll('.authoring-knowledge__agent-list li')).toHaveLength(19)
    wrapper.unmount()
  })

  it('写模式徽章：切自动要二次确认，确认后提问载荷带 auto；再点一次直接回审阅（M2.5-B）', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '好' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    const badge = () => wrapper.find('.authoring-knowledge__mode-badge')
    expect(badge().text()).toBe('审阅')
    expect(badge().attributes('aria-pressed')).toBe('false')

    // 第一次点只问不切：确认条出现，徽章仍是审阅。
    await badge().trigger('click')
    expect(wrapper.find('.authoring-knowledge__mode-confirm').exists()).toBe(true)
    expect(wrapper.find('.authoring-knowledge__mode-confirm-text').text()).toContain('直接写入正文')
    expect(badge().text()).toBe('审阅')
    expect(badge().attributes('aria-pressed')).toBe('true')

    // 取消：确认条收起，模式一点没动。
    await wrapper.find('.authoring-knowledge__mode-confirm-cancel').trigger('click')
    expect(wrapper.find('.authoring-knowledge__mode-confirm').exists()).toBe(false)
    expect(badge().text()).toBe('审阅')

    // 再点一次并确认：徽章才是自动，确认条收起。
    await badge().trigger('click')
    await wrapper.find('.authoring-knowledge__mode-confirm-ok').trigger('click')
    expect(wrapper.find('.authoring-knowledge__mode-confirm').exists()).toBe(false)
    expect(badge().text()).toBe('自动')
    expect(badge().classes()).toContain('is-auto')

    // 自动模式下的提问把会话真值带上载荷——界面显示什么，发出去的就是什么。
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('改这一章')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    expect(bridge.request).toHaveBeenLastCalledWith(
      IPC_CHANNELS.runtimeAsk,
      expect.objectContaining({ question: '改这一章', writeMode: 'auto' })
    )

    // 从自动降回审阅不设闸：点一下就回去，也不留确认条。
    await badge().trigger('click')
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__mode-confirm').exists()).toBe(false)
    expect(badge().text()).toBe('审阅')
    expect(badge().classes()).toContain('is-review')
    wrapper.unmount()
  })

  it('会话走主进程：读回上次的 JSONL，改一次就整份快照写回（M2.5-B）', async () => {
    const saves = []
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        if (channel === IPC_CHANNELS.sessionsLoad) {
          return {
            ok: true,
            value: {
              sessions: [{
                id: 's-wake',
                title: '上次的会话',
                createdAt: 1_760_000_000_000,
                updatedAt: 1_760_000_000_000,
                messages: [{ id: 'm-old', role: 'agent', text: '上次答过的话', at: '09:00' }],
                events: [],
                writeMode: 'review'
              }],
              activeId: 's-wake'
            }
          }
        }
        if (channel === IPC_CHANNELS.sessionsSave) {
          saves.push(payload.snapshot)
          return { ok: true, value: { saved: payload.snapshot.sessions.length } }
        }
        if (channel === IPC_CHANNELS.runtimeAsk) return { ok: true, value: { source: 'in-process-runner', text: '新答案' } }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      })
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge, projectRoot: 'D:/sessions' } })
    await flushPromises()

    // 读回：上次那条回答就在面上，不是空会话。
    expect(wrapper.text()).toContain('上次答过的话')
    expect(bridge.request).toHaveBeenCalledWith(IPC_CHANNELS.sessionsLoad, {})

    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('接着问')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    // 状态机每变一次交整份快照；最后一份带着两问一答与当前会话 id。
    expect(saves.length).toBeGreaterThan(0)
    const latest = saves.at(-1)
    expect(latest.activeId).toBe('s-wake')
    expect(latest.sessions[0].messages.map((message) => message.text)).toEqual(['上次答过的话', '接着问', '新答案'])
    wrapper.unmount()
  })

  it('老 localStorage 会话迁移：写盘成功才删键；写盘失败保留旧键并在右栏说实话（M2.5-B）', async () => {
    const key = 'agentSessions.D:/legacy'
    globalThis.localStorage.setItem(key, JSON.stringify({ sessions: [{ id: 's-old', title: '老会话', messages: [] }], activeId: 's-old' }))

    const imported = []
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        if (channel === IPC_CHANNELS.sessionsImport) {
          imported.push(payload.legacy)
          return { ok: true, value: { imported: 1, skipped: 0, warnings: [] } }
        }
        if (channel === IPC_CHANNELS.sessionsLoad) return { ok: true, value: { sessions: [], warnings: [], badLines: 0 } }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      })
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge, projectRoot: 'D:/legacy' } })
    await flushPromises()
    expect(imported).toHaveLength(1)
    expect(imported[0].sessions[0].title).toBe('老会话')
    expect(globalThis.localStorage.getItem(key)).toBe(null, '迁移成功后老键必须消失')
    expect(wrapper.text()).not.toContain('迁移失败')
    wrapper.unmount()

    // 主进程拒绝：旧键不许删，右栏把原因写出来。
    globalThis.localStorage.setItem(key, JSON.stringify({ sessions: [{ id: 's-old' }], activeId: 's-old' }))
    const refusing = {
      request: vi.fn(async (channel) => {
        if (channel === IPC_CHANNELS.sessionsImport) return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '磁盘不可写' } }
        if (channel === IPC_CHANNELS.sessionsLoad) return { ok: true, value: { sessions: [], warnings: [], badLines: 0 } }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '未预期的通道' } }
      })
    }
    const second = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge: refusing, projectRoot: 'D:/legacy' } })
    await flushPromises()
    expect(globalThis.localStorage.getItem(key)).not.toBe(null, '迁移失败绝不能先删键')
    expect(second.text()).toContain('旧数据还留在浏览器缓存里')
    second.unmount()
    globalThis.localStorage.removeItem(key)
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

  /**
   * 〔批次77 任务1〕助手正文是 Markdown，用户消息不是。
   * 这条同时钉三件：① md 真的渲染成了元素（不是把 ** 显示出来）；
   * ② 作者自己打的那几个字原样回显（复制回去不能变味）；
   * ③ v-html 的安全边界由 mdRender 那把钥匙守着——脚本与事件属性不许进 DOM。
   */
  it('助手正文走 Markdown：粗体／列表／代码块出真元素，用户消息原样是文本，脚本被剥（批次77 任务1）', async () => {
    const answer = ['总结三件事：', '', '**节奏**拖了', '', '- 第一章：开门', '- 第二章：关门', '', '代码：`pinax_chapter_read`'].join('\n')
      + '\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">'
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: answer } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('帮我梳理 **三件事**')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const body = wrapper.find('.authoring-knowledge__answer-text')
    expect(body.classes()).toContain('authoring-knowledge__markdown')
    expect(body.find('strong').text()).toBe('节奏')
    expect(body.findAll('li')).toHaveLength(2)
    expect(body.find('code').text()).toBe('pinax_chapter_read')
    // 转义断言：源码里的 `**` 不该以字面形式出现在渲染后的正文里。
    expect(body.text()).not.toContain('**')

    const question = wrapper.find('.authoring-knowledge__question')
    expect(question.text()).toContain('帮我梳理 **三件事**')
    expect(question.find('strong').exists()).toBe(false)

    // 清洗：marked 宽松到不剥 script／on*，穿透与否由 mdRender 的 sanitize 决定。
    const container = body.element
    expect(container.querySelector('script')).toBe(null)
    expect(container.innerHTML).not.toMatch(/onerror/iu)
    expect([...container.querySelectorAll('img')].every((img) => !img.hasAttribute('onerror'))).toBe(true)
    wrapper.unmount()
  })

  /**
   * 〔批次77 任务1 附带〕正文里的外链不能把外壳导航掉。
   * 主进程只装了 setWindowOpenHandler（main.mjs:358，新窗口→系统浏览器），没有 will-navigate；
   * 同标签点 <a> 默认行为就是整窗导航，一轮会话没了。所以这里必须：拦默认＋走 window.open。
   */
  it('正文里的外链：拦下默认行为并走 window.open，页内锚点不开窗（批次77 任务1）', async () => {
    const open = vi.spyOn(globalThis.window, 'open').mockReturnValue(null)
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({
        ok: true,
        value: { source: 'in-process-runner', text: '详见[官方文档](https://example.com/guide)，或看[锚点](#top)' }
      })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('链接怎么走')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    // 用真事件（cancelable）而不是 VTU 的 trigger：要判的就是 defaultPrevented。
    const links = [...wrapper.find('.authoring-knowledge__markdown').element.querySelectorAll('a[href]')]
    expect(links).toHaveLength(2)
    const external = new globalThis.window.MouseEvent('click', { bubbles: true, cancelable: true })
    links[0].dispatchEvent(external)
    expect(external.defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/guide', '_blank', 'noopener,noreferrer')

    open.mockClear()
    const anchor = new globalThis.window.MouseEvent('click', { bubbles: true, cancelable: true })
    links[1].dispatchEvent(anchor)
    expect(anchor.defaultPrevented).toBe(true)
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
    wrapper.unmount()
  })

  /**
   * 〔批次77 任务2〕用量从主进程流到屏上这一条链，全程只认「回报的数」。
   * 链路：toolTurn 把网关归一过的 usage 交出来 → toolLoop 累计（只累真回报的轮）→
   * runnerAdvisor 挂到返回值 → agentRuntime 摊进 value → RuntimeDock 存进会话 → 界面读 message.usage。
   * 这里钉的是最后两环：chip 显的是那一轮的原数，会话级那一格取的是最近一条真带 usage 的回答。
   */
  it('批次77 任务2：上游回报的用量走到屏上——回答带 chip，会话格取最近一轮，存的那条带 runId／usage／status', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({
        ok: true,
        value: {
          source: 'in-process-runner',
          text: '第二章的节奏拖了。',
          askId: 'ask-42',
          usage: { input: 1200, output: 380, total: 1580, rounds: 2 }
        }
      })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('现在几章？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="usage-chip"]').text()).toBe('1200 in／380 out')
    expect(wrapper.find('[data-test="usage-chip"]').attributes('title')).toBe('这一轮模型给出的用量')
    expect(wrapper.find('[data-test="session-usage"]').text()).toContain('最近一轮 1200 in／380 out（计 1580）')

    // 状态那一格走的是 messageStatus 唯一读判口；老数据没有 status 字段也读得出「已完成」。
    const status = wrapper.find('.authoring-knowledge__answer-status')
    expect(status.text()).toBe('已完成')
    expect(status.attributes('data-status')).toBe('completed')

    // 落到会话里的那一条必须带上同一些事实（刷新后还能说得出这一轮是谁跑的、报了多少）。
    const stored = wrapper.findComponent(AssistantDialog).props('messages').at(-1)
    expect(stored.role).toBe('agent')
    expect(stored.runId).toBe('ask-42')
    expect(stored.usage).toEqual({ input: 1200, output: 380, total: 1580 })
    expect(stored.status).toBe('completed')
    wrapper.unmount()
  })

  /**
   * 〔批次77 守卫⑦〕缺 usage 时不许显示 0。
   * 这一条是负断言，也是本任务最容易作弊的地方：一个 `?? 0` 就能让 chip 看起来「有数」，
   * 但那是在告诉作者这一轮花了 0 token。字数更不是 token，不许换算。
   * 顺手把「出错」那一格钉了：失败的回答状态读作 error，不是 completed。
   */
  it('〔批次77 守卫⑦〕上游没回报用量就说「这一轮没有用量」，DOM 里不许出现 0 tokens；失败那条读作出错', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '第三章更好。' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('再看一下')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const chip = wrapper.find('[data-test="usage-chip"]')
    expect(chip.text()).toBe('这一轮没有用量')
    expect(chip.attributes('title')).toBe('这一轮没有给出用量')
    // 负断言：屏上任何地方都不许出现「0 tokens」，也不许出现「0 in／0 out」这种假数。
    expect(wrapper.text()).not.toContain('0 tokens')
    expect(wrapper.text()).not.toContain('0 in')
    // 会话级那一格没有数就不画——留一格 0 比不画更坏。
    expect(wrapper.find('[data-test="session-usage"]').exists()).toBe(false)
    expect(wrapper.findComponent(AssistantDialog).props('messages').at(-1).usage).toBe(null)
    wrapper.unmount()

    // 被内核拒绝的那一问：状态读作「出错」（老的 failed 布尔还在，靠 messageStatus 归一到闭集）。
    const refusing = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: false, error: { code: 'PINAX_DEPENDENCY_UNMET', message: '未接模型运行器（runner）' } })
    })
    const second = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge: refusing } })
    await second.find('.authoring-knowledge__input-row textarea').setValue('随便问')
    await second.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    expect(second.find('.authoring-knowledge__answer-status').text()).toBe('出错')
    expect(second.find('.authoring-knowledge__answer-status').attributes('data-status')).toBe('error')
    // 出错那条不许长出「重新生成」：它没有可重跑的回答体，重试钮在错误行里（既有口径）。
    expect(second.find('[data-test="answer-regenerate"]').exists()).toBe(false)
    second.unmount()
  })

  /**
   * 〔批次77 任务2〕复制：写进剪贴板的是**原文**（Markdown 源码），不是渲染后的 HTML；
   * 成功后 aria-label 与 title 同步转「已复制」，失败（没有剪贴板）什么都不假装。
   * 中文口径进用例：屏上的动作件靠这两个属性被读屏念出来，字改了就是界面改了。
   */
  it('批次77 任务2：复制问句与回答走原文，成功后标签转「已复制」，没有剪贴板时不变形', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '**节奏**拖了' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('帮我梳理 **三件事**')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const answerCopy = wrapper.find('[data-test="answer-copy"]')
    expect(answerCopy.attributes('aria-label')).toBe('复制这条回答')
    expect(answerCopy.attributes('title')).toBe('复制这条回答')
    await answerCopy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('**节奏**拖了')
    expect(wrapper.find('[data-test="answer-copy"]').attributes('aria-label')).toBe('已复制')
    expect(wrapper.find('[data-test="answer-copy"]').attributes('title')).toBe('已复制')

    const questionCopy = wrapper.find('[data-test="question-copy"]')
    expect(questionCopy.attributes('aria-label')).toBe('复制这句提问')
    await questionCopy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('帮我梳理 **三件事**')
    wrapper.unmount()

    // 没有剪贴板（主进程未授权／环境不支持）：点下去不报错、标签不动、不弹「已复制」的谎。
    delete globalThis.navigator.clipboard
    const blind = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '再答一次' } })
    })
    const second = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge: blind } })
    await second.find('.authoring-knowledge__input-row textarea').setValue('第二问')
    await second.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    await second.find('[data-test="answer-copy"]').trigger('click')
    await flushPromises()
    expect(second.find('[data-test="answer-copy"]').attributes('aria-label')).toBe('复制这条回答')
    second.unmount()
  })

  /**
   * 〔批次77 任务2〕编辑重发：回填输入框＋截掉这一条之后的历史（截断走 store.dropFrom 唯一入口）。
   * 负断言钉的是乐观失效保护：动作条是 hover 才显形的，点下去那一下会话可能已经变了，
   * 原文／时间戳对不上就必须一个字节都不动——否则一次过期点击会把作者的历史截没。
   */
  it('批次77 任务2：编辑重发回填原文并截掉之后的历史，对不上原文的过期点击不动一个字节', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '答完就走' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    const ask = async (text) => {
      await wrapper.find('.authoring-knowledge__input-row textarea').setValue(text)
      await wrapper.find('.authoring-knowledge__send').trigger('click')
      await flushPromises()
    }
    await ask('第一问')
    await ask('第二问')

    const dialog = wrapper.findComponent(AssistantDialog)
    const before = dialog.props('messages')
    expect(before.map((message) => message.role)).toEqual(['user', 'agent', 'user', 'agent'])

    const editButtons = wrapper.findAll('[data-test="question-edit"]')
    expect(editButtons).toHaveLength(2)
    expect(editButtons[0].attributes('title')).toBe('编辑重发（这条之后的历史会截断）')
    expect(editButtons[0].attributes('aria-label')).toBe('编辑重发')

    const firstQuestion = before[0]
    await editButtons[0].trigger('click')
    await flushPromises()
    // 这一条之后的全没了（包括它自己——重发会重新长出这条问句）。
    expect(dialog.props('messages')).toEqual([])
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe(firstQuestion.text)

    // 过期点击：id 还在会话里，但 text 与 at 已经不是当时那一份 → 一条都不许动。
    await ask('第三问')
    await ask('第四问')
    const current = dialog.props('messages')
    expect(current).toHaveLength(4)
    dialog.vm.$emit('edit', { id: current[0].id, text: '被改过的', at: current[0].at })
    await flushPromises()
    expect(dialog.props('messages').map((message) => message.text)).toEqual(current.map((message) => message.text))
    // 角色不对（拿回答的 id 来「编辑重发」）同样不动。
    dialog.vm.$emit('edit', { id: current[1].id, text: current[1].text, at: current[1].at })
    await flushPromises()
    expect(dialog.props('messages')).toHaveLength(4)
    // 查无此 id（会话已被别的问推进）——也不动，不抛。
    dialog.vm.$emit('edit', { id: '不存在的 id', text: '第四问', at: current[3].at })
    await flushPromises()
    expect(dialog.props('messages')).toHaveLength(4)
    wrapper.unmount()
  })

  /**
   * 〔批次77-R2 任务6〕分一支＋‹ i/n › 切换器。
   * 工单的分工在这儿落成可断言的三件事：
   *   1) 分支＝截断前先存一支：点完这一问之后的历史**从当前视野消失但没被删**（拷成了另一支），
   *      输入框同时回填原文——所以「分一支」是「编辑重发」的带退路版本，两者共用 dropFrom 这一个入口。
   *   2) 切换只换「此刻看哪一支」：切过去再切回来，两支的消息逐字段不变（拿整份 JSON 对拍）。
   *   3) 计数与指针都来自可见路径，不是组件自己猜的。
   */
  it('批次77-R2 任务6：分一支把尾段存成另一支并回填原文，‹ › 只挪当前支指针、两支内容一字不动', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '答完就走' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    const ask = async (text) => {
      await wrapper.find('.authoring-knowledge__input-row textarea').setValue(text)
      await wrapper.find('.authoring-knowledge__send').trigger('click')
      await flushPromises()
    }
    await ask('第一问')
    await ask('第二问')

    const dialog = wrapper.findComponent(AssistantDialog)
    // 对拍口径：一支的「内容」＝除 id／branch／branchNav 之外的每个字段。
    // 前三个是分叉机制自己的记账（拷贝必然换新 id、明写父链接），后一个是界面派生格、从不落盘。
    const contentOf = (list) => JSON.parse(JSON.stringify(list)).map((message) => {
      delete message.id
      delete message.branch
      delete message.branchNav
      return message
    })
    const beforeFork = contentOf(dialog.props('messages'))
    const trunk = dialog.props('messages').map((message) => ({ role: message.role, text: message.text }))
    expect(trunk).toEqual([
      { role: 'user', text: '第一问' },
      { role: 'agent', text: '答完就走' },
      { role: 'user', text: '第二问' },
      { role: 'agent', text: '答完就走' }
    ])

    const branchButtons = wrapper.findAll('[data-test="question-branch"]')
    expect(branchButtons).toHaveLength(2)
    expect(branchButtons[0].attributes('aria-label')).toBe('分一支')
    expect(branchButtons[0].attributes('title')).toContain('把这条之后的历史存成另一支')
    // 还没分叉：这一层只有一支，切换器不许凭空长出来。
    expect(wrapper.find('[data-test="branch-nav"]').exists()).toBe(false)

    await branchButtons[0].trigger('click')
    await flushPromises()
    // 当前支被截到这条之前（这条本身也没了——重发会重新长出它），输入框拿到原文。
    expect(dialog.props('messages')).toEqual([])
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe('第一问')

    await ask('第一问 换个写法')
    const afterAsk = dialog.props('messages')
    expect(afterAsk.map((message) => message.text)).toEqual(['第一问 换个写法', '答完就走'])
    // 这一层现在有两支，正看着的是重新长出来的第 1 支。
    const nav = wrapper.find('[data-test="branch-nav"]')
    expect(nav.exists()).toBe(true)
    expect(nav.attributes('title')).toBe('这一层共 2 支，正在看第 1 支')
    expect(wrapper.find('[data-test="branch-count"]').text()).toBe('1/2')

    // ‹ › 是循环的：两支之间来回切，内容一个字节都不改（工单第 3 条的硬判据）。
    await wrapper.find('[data-test="branch-next"]').trigger('click')
    await flushPromises()
    const other = dialog.props('messages')
    expect(other.map((message) => ({ role: message.role, text: message.text }))).toEqual(trunk)
    expect(wrapper.find('[data-test="branch-count"]').text()).toBe('2/2')
    expect(wrapper.find('[data-test="branch-nav"]').attributes('title')).toBe('这一层共 2 支，正在看第 2 支')

    // 逐字段对拍：切过去看到的这一支，和分叉前那一份完全一致（时间戳／trail／usage 都原样）。
    expect(contentOf(other)).toEqual(beforeFork)

    await wrapper.find('[data-test="branch-prev"]').trigger('click')
    await flushPromises()
    expect(dialog.props('messages').map((message) => message.text)).toEqual(['第一问 换个写法', '答完就走'])
    expect(wrapper.find('[data-test="branch-count"]').text()).toBe('1/2')
    // 切回来也一个字节没写：两支都在，谁也没被覆盖。
    await wrapper.find('[data-test="branch-next"]').trigger('click')
    await flushPromises()
    expect(dialog.props('messages').map((message) => message.text)).toEqual(['第一问', '答完就走', '第二问', '答完就走'])
    wrapper.unmount()
  })

  /**
   * 〔批次77-R2 任务6〕分一支与编辑重发同一条乐观失效保护：
   * 原文／时间戳对不上，或那条根本不是问句，就一个字节都不动——
   * 分叉要拷尾段、要截当前支，一次过期点击的破坏力比编辑重发更大。
   */
  it('批次77-R2 任务6：分一支的过期点击与错角色点击不动任何一支，也不回填输入框', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '照答' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('唯一一问')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const dialog = wrapper.findComponent(AssistantDialog)
    const before = dialog.props('messages')
    expect(before).toHaveLength(2)

    dialog.vm.$emit('branch', { id: before[0].id, text: '被改过的', at: before[0].at })
    await flushPromises()
    expect(dialog.props('messages').map((message) => message.text)).toEqual(['唯一一问', '照答'])
    dialog.vm.$emit('branch', { id: before[1].id, text: before[1].text, at: before[1].at })
    await flushPromises()
    expect(dialog.props('messages')).toHaveLength(2)
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe('')
    // 没分叉就没有可切的层：切支请求返回 null，界面不演「切了」。
    dialog.vm.$emit('switch-branch', { id: before[0].id, step: 1 })
    await flushPromises()
    expect(dialog.props('messages')).toHaveLength(2)
    expect(wrapper.find('[data-test="branch-nav"]').exists()).toBe(false)
    wrapper.unmount()
  })

  /**
   * 〔批次77-R2 任务6〕分叉与切支在**落盘载荷**上的样子（工单验收：两叉都在盘上且互不覆盖；切换只改当前支指针）。
   * 这里量的是外壳交给主进程的那份快照——真正「既有行逐字节不变」由 next/tests/session-store.test.mjs 的守卫⑩钉；
   * 两条合起来才说完整：快照里两支同存，写盘时只追加不重写。
   */
  it('批次77-R2 任务6：分叉后两支同时在快照里，切支只改 branchChoice，消息一个字节不动', async () => {
    const saves = []
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        if (channel === IPC_CHANNELS.sessionsLoad) return { ok: true, value: { sessions: [], warnings: [], badLines: 0 } }
        if (channel === IPC_CHANNELS.sessionsSave) {
          saves.push(JSON.parse(JSON.stringify(payload.snapshot)))
          return { ok: true, value: { saved: payload.snapshot.sessions.length } }
        }
        if (channel === IPC_CHANNELS.runtimeAsk) return { ok: true, value: { source: 'in-process-runner', text: '那一答' } }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      })
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge, projectRoot: 'D:/branch' } })
    await flushPromises()
    const ask = async (text) => {
      await wrapper.find('.authoring-knowledge__input-row textarea').setValue(text)
      await wrapper.find('.authoring-knowledge__send').trigger('click')
      await flushPromises()
    }
    await ask('原问')

    await wrapper.find('[data-test="question-branch"]').trigger('click')
    await flushPromises()
    await ask('改后的问')

    const forked = saves.at(-1).sessions[0]
    // 两支同存：退路那一条（原问／那一答）和重新长出来的这一条，谁也没把谁挤掉。
    expect(forked.messages.map((message) => message.text)).toEqual(['原问', '那一答', '改后的问', '那一答'])
    const head = forked.messages.find((message) => message.text === '原问')
    expect(head.branch).toEqual({ parentId: '', index: 2, count: 2 })
    expect(forked.messages.find((message) => message.text === '改后的问').branch).toEqual({ parentId: '', index: 1, count: 2 })
    // 没拨指针就还是在看第 1 支（分支不自动切支，这是工单第 4 条的「留退路」而不是「换门面」）。
    expect(forked.branchChoice).toEqual({})

    const messagesBefore = JSON.stringify(forked.messages)
    await wrapper.find('[data-test="branch-next"]').trigger('click')
    await flushPromises()
    const switched = saves.at(-1).sessions[0]
    expect(switched.branchChoice).toEqual({ '': 2 })
    expect(JSON.stringify(switched.messages)).toBe(messagesBefore)
    expect(switched.messages.map((message) => message.text)).toEqual(forked.messages.map((message) => message.text))
    wrapper.unmount()
  })

  /**
   * 〔批次77 任务2〕重新生成：只对**最后一条**回答开（中间那条重跑＝把后面的历史丢掉；
   * 〔批次77-R2 任务6〕分支长出来之后这条口子也不开——想保历史走「分一支」，再生成是就地替换）。
   * 禁用的那一枚必须把理由写在 title 里——禁用而不解释，作者只能猜。
   * 问题原文优先用本轮记住的那一问（omit／skill 一起带走）；这里钉的是「丢掉旧答案＋用同一问再跑」。
   */
  it('批次77 任务2：重新生成只对最后一条回答开，点它丢掉那条并用同一个问题再跑一轮', async () => {
    let round = 0
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => {
        round += 1
        return { ok: true, value: { source: 'in-process-runner', text: `第 ${round} 次的答案` } }
      }
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    const ask = async (text) => {
      await wrapper.find('.authoring-knowledge__input-row textarea').setValue(text)
      await wrapper.find('.authoring-knowledge__send').trigger('click')
      await flushPromises()
    }
    await ask('第一问')
    await ask('第二问')

    const dialog = wrapper.findComponent(AssistantDialog)
    const regen = wrapper.findAll('[data-test="answer-regenerate"]')
    expect(regen).toHaveLength(2)
    // 前一条：禁用＋把理由摊在 title 上。
    expect(regen[0].attributes('disabled')).toBeDefined()
    expect(regen[0].attributes('title')).toContain('只有最后一条回答能重新生成')
    // 最后一条：可用，中文口径。
    expect(regen[1].attributes('disabled')).toBeUndefined()
    expect(regen[1].attributes('aria-label')).toBe('重新生成')
    expect(regen[1].attributes('title')).toBe('用同一个问题再生成一次')

    await regen[1].trigger('click')
    await flushPromises()
    const calls = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeAsk)
    expect(calls).toHaveLength(3)
    // 重跑用的是会话里那句原文（第二问），载荷形状与首发一致。
    expect(calls[2][1]).toEqual(expect.objectContaining({ question: '第二问', writeMode: 'review' }))
    const after = dialog.props('messages')
    expect(after).toHaveLength(4)
    expect(after.map((message) => message.role)).toEqual(['user', 'agent', 'user', 'agent'])
    expect(after.at(-1).text).toBe('第 3 次的答案')
    expect(after.at(-1).usage).toBe(null)
    wrapper.unmount()
  })

  /**
   * 〔批次77 任务2 附带〕Enter 发送必须让位给输入法组字。
   * 老前端 8 处同一口径是 `isComposing || keyCode === 229`（AuthoringBlockComposer.vue:202、
   * AuthoringManuscriptImport.vue:451、AuthoringRehearsalPanel.vue:93 等）：后者是老 Chromium
   * 在组字期把 isComposing 留 false、只把 keyCode 打成 229 的那条兜底。
   * 这里两种都要判住，同时钉「普通 Enter 照样发得出去」——不然这条守卫只是在把发送键打死。
   */
  it('批次77 任务2：Enter 发送尊重 isComposing，并对老 Chromium 的 keyCode 229 兜底，普通 Enter 照发', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '收到' } })
    })
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    const textarea = wrapper.find('.authoring-knowledge__input-row textarea')
    await textarea.setValue('正在组字的句子')
    const target = textarea.element

    const sendCalls = () => bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeAsk).length
    const press = (init = {}) => {
      const event = new globalThis.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
      if (typeof init.keyCode === 'number') Object.defineProperty(event, 'keyCode', { value: init.keyCode })
      target.dispatchEvent(event)
      return event
    }

    press({ isComposing: true })
    await flushPromises()
    expect(sendCalls()).toBe(0)

    // isComposing 是 false、keyCode 仍是 229 的那一档（老内核）：一样不许发。
    const legacy = press({ keyCode: 229 })
    expect(legacy.isComposing).toBe(false)
    await flushPromises()
    expect(sendCalls()).toBe(0)

    // Shift+Enter 是换行，不是发送。
    press({ shiftKey: true })
    await flushPromises()
    expect(sendCalls()).toBe(0)

    // 组字结束后的普通 Enter：发得出去（这一档要是也判住，输入框就废了）。
    press()
    await flushPromises()
    expect(sendCalls()).toBe(1)
    expect(bridge.request).toHaveBeenCalledWith(
      IPC_CHANNELS.runtimeAsk,
      expect.objectContaining({ question: '正在组字的句子' })
    )
    wrapper.unmount()
  })

  it('没有桥时输入框禁用并说明原因', async () => {
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView() } })
    expect(wrapper.find('.authoring-knowledge__input-row textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('渲染层未接主进程桥')
    wrapper.unmount()
  })

  it('busy 期按真实事件换阶段语，答后轨迹折进「过程」折叠层（批次29）', async () => {
    const handlers = new Map()
    let settle = null
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel) => {
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        // runtimeAsk 先挂着：用例要在 busy 期一条条喂事件，最后才让回答落地。
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      }),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      },
      channels: IPC_CHANNELS
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('开场怎么改？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const askCall = bridge.request.mock.calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)
    expect(askCall).toBeTruthy()
    const askId = askCall[1].askId
    expect(typeof askId).toBe('string')
    const emit = handlers.get(IPC_PUSH.runtimeAskEvent)
    expect(typeof emit).toBe('function')

    // 没有事件时保持老版的固定语。
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('正在核对项目资料')

    // 上一轮晚到的事件（askId 对不上）不许串进这一问。
    emit({ askId: 'ask-上一轮', event: { stage: 'model-round', round: 9 } })
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('正在核对项目资料')
    expect(wrapper.find('.authoring-knowledge__thinking').text()).not.toContain('模型第 9 轮')

    emit({ askId, event: { stage: 'start', questionChars: 5 } })
    emit({ askId, event: { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 6, chars: 18_240, missingKinds: [] } })
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('正在组装上下文（6 块 · 18240 字）')

    emit({ askId, event: { stage: 'model-round', round: 1 } })
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('模型第 1 轮')

    emit({ askId, event: { stage: 'answer', chars: 9, structured: true, roundsUsed: 1 } })
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('正在整理回答')

    settle({ ok: true, value: { source: 'in-process-advisor', text: '建议把停摆的表提前。', askId } })
    await flushPromises()

    expect(wrapper.find('.authoring-knowledge__thinking').exists()).toBe(false)
    const trail = wrapper.find('details.authoring-knowledge__trail')
    expect(trail.exists()).toBe(true)
    expect(trail.attributes('open')).toBeUndefined() // 默认收起：屏上只留问—答主线
    expect(trail.find('summary').text()).toContain('过程')
    expect(trail.text()).toContain('组装上下文')
    expect(trail.text()).toContain('模型第 1 轮')
    expect(trail.text()).toContain('6 块')
    expect(trail.text()).toContain('回答')
    wrapper.unmount()
  })

  it('工具循环接上真链后过程可见：tool-start 换阶段语，tool-end 与 proposal-created 落进过程层（批次37）', async () => {
    const handlers = new Map()
    let settle = null
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel) => {
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      }),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      },
      channels: IPC_CHANNELS
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('顺手把雨提前一段')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const askId = bridge.request.mock.calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId
    const emit = handlers.get(IPC_PUSH.runtimeAskEvent)
    expect(typeof emit).toBe('function')

    emit({ askId, event: { stage: 'step', step: 1, tools: ['pinax_chapter_read', 'pinax_chapter_write'] } })
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('工具第 1 步')

    emit({ askId, event: { stage: 'tool-start', name: 'pinax_chapter_read', callId: 'c1' } })
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__thinking').text()).toContain('正在调用 pinax_chapter_read')

    emit({ askId, event: { stage: 'tool-end', name: 'pinax_chapter_read', callId: 'c1', ok: true, ms: 12 } })
    emit({ askId, event: { stage: 'tool-denied', name: 'pinax_chapter_write', callId: 'c2', code: 'WRITE_BLOCKED' } })
    emit({ askId, event: { stage: 'proposal-created', name: 'pinax_chapter_write', callId: 'c3', proposalId: '20261030-120000-chapter_save-ab12' } })
    settle({ ok: true, value: { source: 'in-process-advisor', text: '我把雨提前了，提案放你案头。', askId } })
    await flushPromises()

    const trail = wrapper.find('details.authoring-knowledge__trail')
    expect(trail.exists()).toBe(true)
    // 工具三步都要在过程层里看得见：调了哪把、返回多久、被拒原因、生成了哪份提案。
    expect(trail.text()).toContain('工具第 1 步')
    expect(trail.text()).toContain('调用工具')
    expect(trail.text()).toContain('pinax_chapter_read')
    expect(trail.text()).toContain('工具返回')
    expect(trail.text()).toContain('12ms')
    expect(trail.text()).toContain('写入被拒')
    expect(trail.text()).toContain('WRITE_BLOCKED')
    expect(trail.text()).toContain('生成提案')
    expect(trail.text()).toContain('20261030-120000-chapter_save-ab12')
    wrapper.unmount()
  })

  it('〔批次77 任务4〕过程折叠层升级成运行时间线：五类块、四态文案、图标按名字归类、写入类不显图标', async () => {
    const wrapper = mount(AssistantDialog, {
      props: {
        messages: [
          { id: 'q1', role: 'user', text: '这章节奏怎么样？', at: '10:00' },
          {
            id: 'a1',
            role: 'agent',
            text: '中段拖了。',
            at: '10:01',
            trail: [
              { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 6, chars: 1800, missingKinds: [], at: 1000 },
              { stage: 'model-round', round: 1, at: 1200 },
              { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read', at: 1300 },
              { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 12, at: 1312 },
              { stage: 'tool-start', callId: 'c2', name: 'pinax_chapter_search', at: 1320 },
              { stage: 'tool-end', callId: 'c2', name: 'pinax_chapter_search', ok: true, ms: 8, at: 1328 },
              { stage: 'tool-start', callId: 'c3', name: 'pinax_chapter_save', at: 1340 },
              { stage: 'tool-denied', callId: 'c3', name: 'pinax_chapter_save', code: 'WRITE_BLOCKED', at: 1350 },
              { stage: 'subagent', name: '研究员', callId: 's1', task: '查伏笔', ok: false, at: 1360 },
              { stage: 'answer', chars: 24, structured: false, roundsUsed: 2, at: 1900 }
            ]
          }
        ]
      }
    })
    const timeline = wrapper.find('[data-test="conversation-timeline"]')
    expect(timeline.exists()).toBe(true)
    // 顶部那一条：时间差与工具自报两条都在（口径写在 conversationTimeline 那份注释里）。
    const summary = timeline.find('[data-test="timeline-summary"]').text()
    expect(summary).toContain('已处理 0.9 秒')
    expect(summary).toContain('工具累计 20ms')
    const rows = timeline.findAll('.nx-timeline__block')
    expect(rows.map((row) => row.attributes('data-kind'))).toEqual(['thinking', 'tool-group', 'tool', 'subagent', 'response'])
    expect(rows.map((row) => row.attributes('data-state'))).toEqual(['completed', 'completed', 'error', 'completed', 'completed'])
    // 块头那五句中文全来自判定层（组件里不许再写一套状态词，改词只改 conversationTimeline 一处）。
    expect(timeline.findAll('.nx-timeline__title').map((node) => node.text())).toEqual([
      '已梳理上下文',
      '已读取 2 项项目内容',
      '写入被拒 · WRITE_BLOCKED',
      '已交给子代理 研究员',
      '已给出回答'
    ])
    // 只读并组：连续两把读压成一行，明细折在组里，原文一条不丢。
    expect(rows[1].find('.nx-timeline__count').text()).toBe('2 项')
    expect(rows[1].findAll('.nx-timeline__group-item').length).toBe(2)
    // 图标按工具名字归类：读的那两把有图标，写入那一块一枚都不画（工单第 1 条）。
    expect(rows[1].find('.nx-timeline__group-item svg').exists()).toBe(true)
    expect(rows[2].find('svg').exists()).toBe(false)
    // 数字仍是事件里那几个，不是界面现编。
    expect(timeline.text()).toContain('pinax_chapter_read · 12ms')
    expect(timeline.text()).toContain('6 块 · 1800 字 · writing-chapter')
    wrapper.unmount()
  })

  it('〔批次77 任务4〕时间线缺省收起；展开态活在内存（切会话再回来还在），落盘快照里一个字段都没有（守卫⑨）', async () => {
    const handlers = new Map()
    const savePayloads = []
    let settle = null
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.sessionsLoad) return { ok: true, value: { sessions: [], warnings: [], badLines: 0 } }
        if (channel === IPC_CHANNELS.sessionsSave) {
          // 拷一份：状态机后面还会继续改，断言要看的是那一刻交出去的那份快照。
          savePayloads.push(JSON.parse(JSON.stringify(payload.snapshot)))
          return { ok: true, value: { saved: payload.snapshot.sessions.length } }
        }
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      }),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      },
      channels: IPC_CHANNELS
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge, projectRoot: 'D:/trail-fold' } })
    await flushPromises()

    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('这章行不行？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    const askId = bridge.request.mock.calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId
    const emit = handlers.get(IPC_PUSH.runtimeAskEvent)
    emit({ askId, event: { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' } })
    emit({ askId, event: { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 9 } })
    emit({ askId, event: { stage: 'tool-start', callId: 'c2', name: 'pinax_outline_read' } })
    emit({ askId, event: { stage: 'tool-end', callId: 'c2', name: 'pinax_outline_read', ok: true, ms: 4 } })
    settle({ ok: true, value: { source: 'in-process-advisor', text: '节奏还行，中段可收紧。', askId } })
    await flushPromises()

    // 缺省收起：屏上只留问—答主线。
    expect(wrapper.find('details.authoring-knowledge__trail').attributes('open')).toBeUndefined()
    // 动作条那个钮与原生 summary 走同一个 details.open：点它展开，aria-label 跟着翻。
    const toggle = wrapper.find('[data-test="answer-trail-toggle"]')
    await toggle.trigger('click')
    expect(wrapper.find('details.authoring-knowledge__trail').attributes('open')).toBeDefined()
    expect(toggle.attributes('aria-label')).toBe('收起过程')

    // 换会话再换回来：展开态还在——那份 Map 的生命周期就是这块面板，它不落盘。
    // 口径抄上面那条真点过的路径：新建不收弹层，所以要「开→新建→关」，再开一次才看得见列表。
    await wrapper.find('.authoring-knowledge__session-btn').trigger('click')
    await wrapper.find('.authoring-knowledge__session-new').trigger('click')
    await wrapper.find('.authoring-knowledge__session-btn').trigger('click')
    await flushPromises()
    await wrapper.find('.authoring-knowledge__session-btn').trigger('click')
    const firstRow = wrapper.findAll('.authoring-knowledge__session-item').find((row) => row.text().includes('这章行不行？'))
    expect(firstRow, '会话列表里要能找到那一句问题当标题的行').toBeDefined()
    await firstRow.trigger('click')
    await flushPromises()
    expect(wrapper.find('details.authoring-knowledge__trail').attributes('open')).toBeDefined()

    // 守卫⑨：落盘的那一份里没有任何展开态字段（展开态不进 store，也就不进 JSONL）。
    expect(savePayloads.length).toBeGreaterThan(0)
    const json = JSON.stringify(savePayloads.at(-1))
    expect(json).not.toContain('expanded')
    expect(json).not.toContain('trailOpen')
    expect(json).not.toContain('"open"')
    wrapper.unmount()
  })

  it('〔批次77 任务4〕在途那一问的时间线是平铺的（不套折叠层），落地后才收进那条回答', async () => {
    const handlers = new Map()
    let settle = null
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel) => {
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      }),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      },
      channels: IPC_CHANNELS
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('开场怎么改？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    const askId = bridge.request.mock.calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId
    const emit = handlers.get(IPC_PUSH.runtimeAskEvent)

    emit({ askId, event: { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 6, chars: 1800, missingKinds: [] } })
    emit({ askId, event: { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' } })
    await flushPromises()

    // 作者正看着它跑：过程平铺在状态行下面，不套「点开才看得见」那一层。
    const live = wrapper.find('[data-test="live-timeline"]')
    expect(live.exists()).toBe(true)
    expect(live.find('details.authoring-knowledge__trail').exists()).toBe(false)
    expect(live.text()).toContain('正在处理')
    expect(live.text()).toContain('正在调用 pinax_chapter_read')
    expect(live.text()).toContain('6 块 · 1800 字 · writing-chapter')
    // 顶部那句固定语／阶段语仍在（时间线不取代它）。
    expect(wrapper.find('.authoring-knowledge__thinking').exists()).toBe(true)

    emit({ askId, event: { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 9 } })
    await flushPromises()
    expect(wrapper.find('[data-test="live-timeline"]').text()).toContain('已调用 pinax_chapter_read')

    settle({ ok: true, value: { source: 'in-process-advisor', text: '把停摆的表提前。', askId } })
    await flushPromises()
    // 回答落地：平铺那一条撤掉，同一叠事件定格进这条回答的折叠层（缺省收起）。
    expect(wrapper.find('[data-test="live-timeline"]').exists()).toBe(false)
    const trail = wrapper.find('details.authoring-knowledge__trail')
    expect(trail.exists()).toBe(true)
    expect(trail.attributes('open')).toBeUndefined()
    // 块头那句是「已调用 pinax_chapter_read」；9ms 不在块头里，在它下面那行原始事件的 detail span。
    // jsdom 的 text() 把相邻 span 直接粘起来（不带分隔空格），所以后半句按拼接后的字面断言——
    // 这不是文案口径，是断言层的事实；写成「已调用 pinax_chapter_read · 9ms」会假失败。
    expect(trail.text()).toContain('已调用 pinax_chapter_read')
    expect(trail.text()).toContain('pinax_chapter_read · 9ms')
    wrapper.unmount()
  })

  it('两问同时在途：事件按 askId 分桶，各自只落回自己的回答（批次29）', async () => {
    const handlers = new Map()
    const deferred = []
    const bridge = {
      request: vi.fn(async (channel) => {
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.runtimeAsk) {
          return new Promise((resolve) => { deferred.push(resolve) })
        }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      }),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      },
      channels: IPC_CHANNELS
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    const input = () => wrapper.find('.authoring-knowledge__input-row textarea')

    // A 会话问一句（先挂着），再新开一个会话问第二句：两问同时在途。
    await input().setValue('A 的问题')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    const askIdA = bridge.request.mock.calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId

    await wrapper.find('.authoring-knowledge__session-btn').trigger('click')
    await wrapper.find('.authoring-knowledge__session-new').trigger('click')
    // 弹层保持开着会盖住后面的点击路径：建完会话就收起（这里只关心事件分桶）。
    await wrapper.find('.authoring-knowledge__session-btn').trigger('click')
    await flushPromises()
    await input().setValue('B 的问题')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    const askIdB = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1][1].askId

    const emit = handlers.get(IPC_PUSH.runtimeAskEvent)
    emit({ askId: askIdA, event: { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 3, chars: 100, missingKinds: [] } })
    emit({ askId: askIdA, event: { stage: 'model-round', round: 1 } })
    emit({ askId: askIdB, event: { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 7, chars: 900, missingKinds: [] } })
    emit({ askId: askIdB, event: { stage: 'model-round', round: 2 } })

    // A 先答（此刻作者看着 B）：轨迹必须回到 A 那条会话。
    deferred[0]({ ok: true, value: { source: 'in-process-advisor', text: 'A 的回答', askId: askIdA } })
    await flushPromises()
    deferred[1]({ ok: true, value: { source: 'in-process-advisor', text: 'B 的回答', askId: askIdB } })
    await flushPromises()

    const bTrail = wrapper.find('details.authoring-knowledge__trail')
    expect(bTrail.text()).toContain('7 块')
    expect(bTrail.text()).toContain('模型第 2 轮')
    expect(bTrail.text()).not.toContain('3 块')

    // 切回 A 会话：它的折叠层只有自己那两笔，没有 B 的事件串进来。
    await wrapper.find('.authoring-knowledge__session-btn').trigger('click')
    const aRow = wrapper.findAll('.authoring-knowledge__session-item').find((row) => row.text().includes('A 的问题'))
    await aRow.trigger('click')
    await flushPromises()
    const aTrail = wrapper.find('details.authoring-knowledge__trail')
    expect(aTrail.text()).toContain('3 块')
    expect(aTrail.text()).toContain('模型第 1 轮')
    expect(aTrail.text()).not.toContain('7 块')
    expect(aTrail.text()).not.toContain('模型第 2 轮')
    wrapper.unmount()
  })

  it('失败：failed 事件让错误行带上「断在哪一步」，轨迹照样折在答下方（批次29）', async () => {
    const handlers = new Map()
    let settle = null
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel) => {
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      }),
      onEvent: (channel, handler) => {
        handlers.set(channel, handler)
        return () => handlers.delete(channel)
      },
      channels: IPC_CHANNELS
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    await wrapper.find('.authoring-knowledge__input-row textarea').setValue('这章行不行？')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    const askId = bridge.request.mock.calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId
    const emit = handlers.get(IPC_PUSH.runtimeAskEvent)
    emit({ askId, event: { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 6, chars: 0, missingKinds: [] } })
    emit({ askId, event: { stage: 'model-round', round: 1 } })
    emit({ askId, event: { stage: 'failed', code: 'AGENT_PROVIDER_CONFIG_INVALID', atStage: 'model-round' } })
    settle({ ok: false, error: { code: 'PINAX_DEPENDENCY_UNMET', message: '未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax）。' } })
    await flushPromises()

    const error = wrapper.find('.authoring-knowledge__error').text()
    expect(error).toContain('未检测到可用模型')
    expect(error).toContain('断在：模型第 1 轮')
    const trail = wrapper.find('details.authoring-knowledge__trail')
    expect(trail.exists()).toBe(true)
    expect(trail.text()).toContain('AGENT_PROVIDER_CONFIG_INVALID')
    wrapper.unmount()
  })

  /* —— 〔批次77 任务3〕输入区：一个 typeahead 吃三类 ＋ 技能 token ＋ 停止钮 ＋ 模式三档 ————
   * 判定与组菜单的**规则**在 next/tests/composer-typeahead.test.mjs（纯函数，9 条）钉着；
   * 这几条只问屏上那三件事：菜单真出得来吗、键真按得动吗、发出去的载荷对不对。
   */

  /** 带技能清单的运行时视图：形状照主进程那份 view（runtime.surface.skills.catalog，真装载的那几条）。 */
  function runtimeViewWithSkills(catalog, { rejected = [] } = {}) {
    return {
      ...runtimeView(),
      surface: { skills: { names: catalog.map((item) => item.name), rejected, catalog } }
    }
  }

  /** 打字并把光标放到末尾（jsdom 的 selectionStart 不随 setValue 走，这里以现场为准喂判定函数）。 */
  async function type(wrapper, text) {
    const input = wrapper.find('.authoring-knowledge__input-row textarea')
    await input.setValue(text)
    input.element.setSelectionRange(text.length, text.length)
    await input.trigger('click')
    return input
  }

  const menuItems = (wrapper) => wrapper.findAll('[data-test="composer-menu"] [data-item-kind]')
  const menuKinds = (wrapper) => menuItems(wrapper).map((item) => item.attributes('data-item-kind'))

  it('〔批次77 任务3〕一个 typeahead 吃三类：/ 出命令与技能、@ 出素材、# 出那一句「暂无」（菜单头还教着键位）', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { source: 'in-process-runner', text: '收到' } })
    })
    const runtime = runtimeViewWithSkills([
      { name: 'chapter-rewrite', description: '重写这一章的场次节奏', output: 'proposal' },
      { name: 'jiangnan-style', description: '江南那种吐槽流的口吻', output: 'proposal', kind: 'style' }
    ])
    const wrapper = mount(RuntimeDock, {
      props: {
        runtime,
        bridge,
        references: [
          { kind: 'chapter', title: '第一章 雪', path: '正文/第一章.md' },
          { kind: 'entry', title: '雪落无声', path: '世界书/雪落无声.md' }
        ]
      }
    })

    // `/`：命令在前、技能在后，风格包单列一组（任务5 的 kind:style）。
    await type(wrapper, '/')
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="composer-menu"]').text()).toContain('↑↓')
    expect(menuKinds(wrapper)).toEqual(expect.arrayContaining(['command', 'skill']))
    expect(wrapper.findAll('[data-item-kind="skill"]').map((item) => item.text())).toEqual([
      expect.stringContaining('/chapter-rewrite'),
      expect.stringContaining('/jiangnan-style')
    ])

    // `@`：按既有词表出素材，插的是 @《标题》。
    await type(wrapper, '看看 @')
    expect(menuKinds(wrapper)).toEqual(['reference', 'reference'])
    expect(menuItems(wrapper)[0].text()).toContain('@《第一章 雪》')

    // `#`：这一类只有那一句实话，而且它**不是一枚点不动的钮**（工单：不留死钮）。
    // 〔批次68-R1 任务3〕那一句是作者语言，屏上不许出现批次号。
    await type(wrapper, '#')
    expect(wrapper.findAll('[data-item-kind]').length).toBe(0)
    expect(wrapper.find('[data-test="composer-empty"]').text()).toContain('还没有可引用的角色')
    expect(wrapper.find('[data-test="composer-empty"]').text()).not.toMatch(/批次\s*\d/u)

    wrapper.unmount()
  })

  it('〔批次77 守卫⑧〕前导边界：中文正文中段的 / @ # 不误唤菜单（工单点名的「第3/章」）', async () => {
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async () => ({ ok: true, value: { text: '收到' } })
    })
    const runtime = runtimeViewWithSkills([{ name: 'chapter-rewrite', description: '重写这一章', output: 'proposal' }])
    const wrapper = mount(RuntimeDock, { props: { runtime, bridge, references: [{ kind: 'chapter', title: '第一章 雪', path: '正文/第一章.md' }] } })

    // 键盘序列也在这条里钉死：↑↓ 移动、Enter 选中、Tab 补全、Esc 关闭——老版是两套各写一遍，Tab 只有一边有。
    await type(wrapper, '第3/章')
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(false, '数字后面的 / 不算 token')
    await type(wrapper, '我去看了/然后')
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(false, '汉字后面的 / 不算 token')
    await type(wrapper, 'mail a@b.com')
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(false, '行中的 @ 是邮箱')

    // 换成行首那一段（空白之后）就出得来——负断言不许把正路一起打死。
    await type(wrapper, '第3章 /ch')
    expect(menuKinds(wrapper)).toEqual(['skill'])

    // ↓ 走到第二条 would 越界（这一档只有一条），Enter 选中的还是它；Tab 补同一条。
    await wrapper.find('.authoring-knowledge__input-row textarea').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.authoring-knowledge__input-row textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe('第3章 /chapter-rewrite ')

    // Esc 关掉后不挡着作者继续打字；再打一个字菜单回来。
    await wrapper.find('.authoring-knowledge__input-row textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(false)
    await type(wrapper, '第3章 /chapter-rewrite 把这场')
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(false, 'token 后面有空格＝这一段敲完了，不再弹')
    wrapper.unmount()
  })

  it('〔批次77 任务3〕技能选中＝草稿里那个 /技能名 文本；发送时抽出来当 payload.skill，没打 token 就一个都不塞', async () => {
    const asks = []
    const bridge = stubBridge(emptyFrameworkView(), {
      [IPC_CHANNELS.runtimeAsk]: async (payload) => {
        asks.push(payload)
        return { ok: true, value: { source: 'in-process-runner', text: '改好了' } }
      }
    })
    const runtime = runtimeViewWithSkills([
      { name: 'chapter-rewrite', description: '重写这一章的场次节奏', output: 'proposal' },
      { name: 'scene-expand', description: '把这段戏展开', output: 'proposal' }
    ])
    const wrapper = mount(RuntimeDock, { props: { runtime, bridge } })

    await type(wrapper, '/scene')
    await wrapper.find('.authoring-knowledge__input-row textarea').trigger('keydown', { key: 'Tab' })
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe('/scene-expand ')
    await type(wrapper, '/scene-expand 把这段戏展开')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()

    expect(asks).toHaveLength(1)
    // 正文里**不留字面量**：喂给模型的 question 是作者那句话，不带 /scene-expand。
    expect(asks[0].question).toBe('把这段戏展开')
    expect(asks[0].question).not.toContain('scene-expand')
    // 技能走的是既有那格（agentRuntime.ask 的 options.skill → 循环里 pinax_skill_read 取正文）。
    expect(asks[0].skill).toBe('scene-expand')
    // 会话里那条问句也是剥掉 token 后的正文——屏上留着一串斜杠是给模型看的，不是给作者看的。
    expect(wrapper.find('.authoring-knowledge__question-row').text()).toContain('把这段戏展开')

    // 反向（工单：payload.skill 未被前端硬塞）：普通一句没有 token，载荷里就不该出现 skill 这一格。
    await type(wrapper, '这一章的节奏怎么样')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    expect(asks).toHaveLength(2)
    expect(asks[1]).not.toHaveProperty('skill')
    expect(asks[1].question).toBe('这一章的节奏怎么样')

    // 没装载的那个名字不当技能（整包拒装的不该被前端认）：原样留在正文里。
    await type(wrapper, '/not-loaded 这句话')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    expect(asks).toHaveLength(3)
    expect(asks[2]).not.toHaveProperty('skill')
    expect(asks[2].question).toBe('/not-loaded 这句话')
    wrapper.unmount()
  })

  it('〔批次77 任务3〕停止钮：点了发的是 runtimeAskAbort（带 askId），status 由运行回执落成 stopped', async () => {
    let settle = null
    const calls = []
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        calls.push([channel, payload])
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        if (channel === IPC_CHANNELS.runtimeAskAbort) return { ok: true, value: { askId: payload.askId, cancelled: true } }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      })
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge } })
    expect(wrapper.find('[data-test="composer-stop"]').exists()).toBe(false, '没在跑的时候不许摆一枚点不动的停止钮')

    await type(wrapper, '把这一章跑一遍')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    const askId = calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId
    expect(wrapper.find('[data-test="composer-stop"]').exists()).toBe(true)

    await wrapper.find('[data-test="composer-stop"]').trigger('click')
    expect(calls).toContainEqual([IPC_CHANNELS.runtimeAskAbort, { askId }])

    // 点下去那一刻界面**不许**先把这条改成「已停」：停没停要等运行那条链在轮次边界上收的手。
    expect(wrapper.find('.authoring-knowledge__answer-status').exists()).toBe(false)

    settle({ ok: true, value: { source: 'in-process-advisor', text: '已按作者要求停止（第 2 轮后不再续轮）。', askId, stopped: true } })
    await flushPromises()

    const status = wrapper.find('.authoring-knowledge__answer-status')
    expect(status.text()).toBe('已停')
    expect(status.attributes('data-status')).toBe('stopped')
    // 落进会话的不只是屏上那一格：store 里那条的 status 真值是 stopped（重开窗口还在）。
    const stored = wrapper.find('.authoring-knowledge__answer').attributes()
    expect(stored).toBeTruthy()
    wrapper.unmount()
  })

  it('〔批次77 任务3〕模式三档：blocked 上有点得到的路，切过去被会话事件记下、提问载荷也带着它', async () => {
    const saves = []
    const asks = []
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        if (channel === IPC_CHANNELS.sessionsLoad) return { ok: true, value: { sessions: [], warnings: [], badLines: 0 } }
        if (channel === IPC_CHANNELS.sessionsSave) {
          saves.push(payload.snapshot)
          return { ok: true, value: { saved: 1 } }
        }
        if (channel === IPC_CHANNELS.runtimeAsk) {
          asks.push(payload)
          return { ok: true, value: { source: 'in-process-runner', text: '只读着答' } }
        }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      })
    }
    const wrapper = mount(RuntimeDock, { props: { runtime: runtimeView(), bridge, projectRoot: 'D:/mode' } })
    await flushPromises()

    const badge = () => wrapper.find('.authoring-knowledge__mode-badge')
    expect(badge().text()).toBe('审阅')
    // 老代码这里只判 review／auto：锁定时徽标会错着 auto 的色。词表（WRITE_MODES）早就有三档，补上第三档的皮与路。
    await badge().trigger('click')
    await wrapper.find('[data-test="mode-blocked"]').trigger('click')
    await flushPromises()
    expect(badge().text()).toBe('锁定')
    expect(badge().classes()).toContain('is-blocked')

    await type(wrapper, '这块目录只读时问一句')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    expect(asks.at(-1)).toEqual(expect.objectContaining({ question: '这块目录只读时问一句', writeMode: 'blocked' }))

    // 「被会话事件记下」：切换写模式这一条进的是会话事件流水，不是只改了一个显示值。
    const latest = saves.at(-1)
    const modeEvents = latest.sessions[0].events.filter((event) => event.kind === 'mode')
    expect(modeEvents.map((event) => `${event.from}→${event.to}`)).toEqual(['review→blocked'])

    // 从锁定回审阅不设闸（回到更保守的档位永远允许），也不留确认条。
    await badge().trigger('click')
    await flushPromises()
    expect(badge().text()).toBe('审阅')
    expect(wrapper.find('.authoring-knowledge__mode-confirm').exists()).toBe(false)
    wrapper.unmount()
  })

  it('〔批次77 任务3〕对话面那几条键位走 hotkeys 那张表，不在组件里硬编码按键', async () => {
    const calls = []
    let settle = null
    const response = new Promise((resolve) => { settle = resolve })
    const bridge = {
      request: vi.fn(async (channel, payload) => {
        calls.push([channel, payload])
        if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
        if (channel === IPC_CHANNELS.hotkeysLoad) return { ok: true, value: { version: 1, bindings: { 'skill.menu': 'CmdOrCtrl+Shift+K' } } }
        if (channel === IPC_CHANNELS.runtimeAsk) return response
        if (channel === IPC_CHANNELS.runtimeAskAbort) return { ok: true, value: { askId: payload.askId, cancelled: true } }
        return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
      })
    }
    const runtime = runtimeViewWithSkills([{ name: 'chapter-rewrite', description: '重写这一章', output: 'proposal' }])
    const wrapper = mount(RuntimeDock, { props: { runtime, bridge } })
    await flushPromises()

    // 作者把「唤起技能菜单」改成 Ctrl+Shift+K：表里改了键位，屏上就得按新键位响（读的是 hotkeys:load 那一份）。
    const press = (init) => document.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    press({ key: 'k', ctrlKey: true, shiftKey: true })
    await flushPromises()
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(true, 'Ctrl+Shift+K 该唤出技能菜单')
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe('/')

    // 默认表里的 Ctrl+/ 这一档**不该**再响（那张表才是唯一来源）。
    await type(wrapper, '')
    press({ key: '/', ctrlKey: true })
    await flushPromises()
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(false)

    // 停止那条：在途时按键＝把 abort 发出去。
    await type(wrapper, '跑一轮')
    await wrapper.find('.authoring-knowledge__send').trigger('click')
    await flushPromises()
    const askId = calls.find(([channel]) => channel === IPC_CHANNELS.runtimeAsk)[1].askId
    press({ key: 'Enter', ctrlKey: true, shiftKey: true })
    await flushPromises()
    expect(calls).toContainEqual([IPC_CHANNELS.runtimeAskAbort, { askId }])
    settle({ ok: true, value: { text: '已按作者要求停止（第 1 轮后不再续轮）。', askId, stopped: true } })
    await flushPromises()
    wrapper.unmount()
  })

  it('〔批次68-R2 任务三〕composer 卡片三层：＋ 菜单插触发符走同一条 typeahead、状态排全真数据、模型 chip 无清单不可点、不摆麦克风死钮', async () => {
    const wrapper = mount(AssistantDialog, {
      props: {
        inflight: 2,
        tools: ['pinax_project_list'],
        messages: [
          { id: 'q1', role: 'user', text: '这章节奏怎么样？', at: '10:00' },
          {
            id: 'a1', role: 'agent', text: '中段拖了。', at: '10:01',
            usage: { input: 1200, output: 380, total: 1580 },
            trail: [{ stage: 'envelope', blocks: 6, chars: 1800, missingKinds: [], at: 1000 }]
          }
        ]
      }
    })
    // 三层结构：卡片（输入行＋控件排）→ 状态排 → 折叠区。
    const card = wrapper.find('[data-test="composer-card"]')
    expect(card.exists()).toBe(true)
    expect(card.find('.authoring-knowledge__input-row textarea').exists()).toBe(true)
    expect(card.find('[data-test="composer-controls"]').exists()).toBe(true)
    // 控件排逐项：左「＋」与写模式 chip，右模型 chip；麦克风压根不出现（语音后端本批不做，不摆死钮）。
    expect(card.find('[data-test="composer-plus"]').exists()).toBe(true)
    expect(card.find('.authoring-knowledge__mode-badge').exists()).toBe(true)
    expect(card.find('[data-test="composer-model-chip"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('麦克风')
    // 模型 chip：无清单时只显示不可点——不编造。
    expect(wrapper.find('[data-test="composer-model-chip"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="composer-model-chip"]').text()).toBe('模型未回报')

    // 状态排三项全真数据：在途＝宿主 ask 计数；上下文＝最近一条真 envelope；本轮 tokens＝既有 usage 链。
    const status = wrapper.find('[data-test="composer-status"]')
    expect(status.find('[data-test="status-inflight"]').text()).toBe('在途 2')
    expect(status.find('[data-test="status-envelope"]').text()).toBe('上下文 6 块／1800 字')
    expect(status.find('[data-test="status-tokens"]').text()).toBe('本轮 1580 tokens')
    // 工具面与 session-usage 收进状态排下方同一折叠区（内容只挪位）。
    const more = wrapper.find('[data-test="composer-more"]')
    expect(more.exists()).toBe(true)
    expect(more.find('[data-test="session-usage"]').text()).toContain('最近一轮 1200 in／380 out（计 1580）')
    expect(more.find('.authoring-knowledge__agent-detail').exists()).toBe(true)

    // ＋ 菜单：三项都指向既有触发符；点「技能与命令」＝往草稿插 `/` 并唤起**同一条** typeahead 弹层。
    await wrapper.find('[data-test="composer-plus"]').trigger('click')
    const plusMenu = wrapper.find('[data-test="composer-plus-menu"]')
    expect(plusMenu.exists()).toBe(true)
    expect(plusMenu.findAll('.nx-composer-plus-item')).toHaveLength(3)
    await plusMenu.findAll('.nx-composer-plus-item')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.authoring-knowledge__input-row textarea').element.value).toBe('/')
    expect(wrapper.find('[data-test="composer-menu"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="composer-plus-menu"]').exists()).toBe(false)
    wrapper.unmount()

    // 没数据的状态排如实「未回报」：不换算冒充、不落 0；连明细折叠区都不画。
    const bare = mount(AssistantDialog, { props: { messages: [] } })
    expect(bare.find('[data-test="status-inflight"]').text()).toBe('在途 0')
    expect(bare.find('[data-test="status-envelope"]').text()).toBe('上下文 未回报')
    expect(bare.find('[data-test="status-tokens"]').text()).toBe('本轮 tokens 未回报')
    expect(bare.find('[data-test="composer-more"]').exists()).toBe(false)
    bare.unmount()
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
    // 目录树在索引窗那一栏，不在核心区（P18 后索引窗不再有「只读归档」死区）。
    expect(wrapper.find('.nx-index-window').text()).toContain('正文')
    expect(wrapper.find('.nx-index-window').text()).not.toContain('只读归档')
    wrapper.unmount()
  })

  it('同载体双中栏 pane（批次58 实拍缺口 → 批次76-R2 任务3 并进页签条）：一块板一行，点待开签换核心区', async () => {
    const view = {
      ...carrierView(),
      carriers: [{ id: 'fixture.comic', title: '漫画（夹具）', primary: { projectKind: 'generic' }, isPrimary: false, isEnabled: true, capabilities: [], requires: [], scopes: [], dataDirs: ['漫画'], settings: [] }],
      left: [{ slot: 'left-dock', id: 'comic.board', title: '漫画板', icon: 'board', pluginId: 'fixture.comic', pluginTitle: '漫画（夹具）', view: 'pinax.view.tree', kind: 'records-editor' }],
      center: [
        { slot: 'center', id: 'comic.editor', title: '编辑器', icon: 'writing', pluginId: 'fixture.comic', pluginTitle: '漫画（夹具）', view: 'pinax.view.editor', kind: 'records-editor' },
        { slot: 'center', id: 'comic.canvas', title: '画布', icon: 'board', pluginId: 'fixture.comic', pluginTitle: '漫画（夹具）', view: 'pinax.view.app', kind: 'external-app', app: { url: 'http://127.0.0.1:3010' } }
      ]
    }
    const wrapper = mount(AppNext, { props: { bridge: stubBridge(view) } })
    await flushPromises()

    // 〔批次76-R2 任务3〕判据是「同一屏幕不许出现两行都在列同一批 pane」：
    // 顶部那行 nx-center-tabs 整条退役，切换职责落在同一行页签条上——没开出来的面出「待开签」。
    expect(wrapper.find('[data-test="center-pane-tabs"]').exists(), 'nx-center-tabs 那行已退役').toBe(false)
    // 〔批次76-R3 任务4〕按组模型改写：待开签挂在**缺省开出的那一组**（主组）那条的条尾——
    // 全局那一条已经撤了，所以这里要指名读主组那一行，不再用「屏上第一条」含糊带过。
    expect(wrapper.findAll('.nx-page-tabstrip').map((node) => node.attributes('data-tabstrip-group'))).toEqual(['main'],
      '只有主组摊着页：侧组那一列连同它的条都不该出现')
    const strip = wrapper.find('.nx-page-tabstrip[data-tabstrip-group="main"]')
    expect(strip.exists()).toBe(true)
    const pending = strip.find('[data-pending-pane="comic.canvas"]')
    expect(pending.exists(), '另一面中栏 pane 挂成待开页签').toBe(true)
    expect(pending.text()).toBe('画布')
    expect(strip.find('.nx-page-tab.is-pending-pane').classes()).toContain('is-pending-pane')
    // 开着的那一面本来就是页签（不再另有一行说自己被选中）。
    expect(strip.find('[data-page-instance="comic.editor#1"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-pane-id="comic.editor"]').exists()).toBe(true)

    await pending.trigger('click')
    await flushPromises()
    // 旧语义一条没少：切换＝旧窗收进悬浮球、新窗接着占位，二者仍是同一套 PaneWindow。
    expect(wrapper.find('[data-pane-id="comic.canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-pane-id="comic.editor"]').exists()).toBe(false)
    const canvasTab = strip.find('[data-page-instance="comic.canvas#1"]')
    expect(canvasTab.exists(), '开出来的那面自己有签，待开签随之消失').toBe(true)
    expect(strip.find('[data-pending-pane="comic.canvas"]').exists()).toBe(false)
    expect(canvasTab.attributes('aria-selected')).toBe('true')
    expect(strip.find('[data-page-instance="comic.editor#1"]').attributes('data-page-form')).toBe('tab')
    wrapper.unmount()
  })

  it('批次76-R2 任务4：地址不画在应用面上，作读数进页签 tooltip／状态栏／右键菜单这三处', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // 宿主侧才碰剪贴板（内容组件不许自己抄）；platform 一并给上，别让别处读 navigator.platform 落空。
    vi.stubGlobal('navigator', { clipboard: { writeText }, platform: 'Win32' })
    const view = {
      ...carrierView(),
      carriers: [{ id: 'fixture.comic', title: '漫画（夹具）', primary: { projectKind: 'generic' }, isPrimary: false, isEnabled: true, capabilities: [], requires: [], scopes: [], dataDirs: ['漫画'], settings: [] }],
      left: [{ slot: 'left-dock', id: 'comic.board', title: '漫画板', icon: 'board', pluginId: 'fixture.comic', pluginTitle: '漫画（夹具）', view: 'pinax.view.tree', kind: 'records-editor' }],
      center: [
        { slot: 'center', id: 'comic.canvas', title: '画布', icon: 'board', pluginId: 'fixture.comic', pluginTitle: '漫画（夹具）', view: 'pinax.view.app', kind: 'external-app', app: { url: 'http://127.0.0.1:3010' } }
      ]
    }
    const wrapper = mount(AppNext, { props: { bridge: stubBridge(view) } })
    await flushPromises()
    try {
      const url = 'http://127.0.0.1:3010'
      // ① 面上不画地址：网址行与常驻复制脚行都不该在（iframe 自己是这一面的全部）。
      expect(wrapper.find('[data-test="external-app-frame"]').exists(), '应用面开着').toBe(true)
      expect(wrapper.find('.nx-external-app-url').exists(), '地址不许再当一行 chrome 画在面上').toBe(false)
      expect(wrapper.find('[data-test="app-copy-url"]').exists(), '常驻复制钮已退役').toBe(false)

      // ② 页签 tooltip 带得上这份读数（data-page-address 与 title 同源，鼠标悬停即可看见端口）。
      const tab = wrapper.find('[data-page-instance="comic.canvas#1"]')
      expect(tab.exists()).toBe(true)
      expect(tab.attributes('data-page-address')).toBe(url)
      expect(tab.attributes('title')).toContain(url)

      // ③ 状态栏那条「载体」读数末尾多的是内嵌浏览器地址，不是新辟一格。
      const status = wrapper.find('[data-test="status-address"]')
      expect(status.exists(), '状态栏要能看见这一页开的是哪个端口').toBe(true)
      expect(status.text()).toBe(url)

      // ④ 复制动作落在右键菜单那一项；反馈用的是这一页数据面上既有的 notice 行，不新开 chrome。
      tab.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }))
      await flushPromises()
      const menu = wrapper.find('[data-test="pane-form-menu"]')
      expect(menu.exists()).toBe(true)
      const copyItem = menu.find('[data-test="form-menu-copy-url"]')
      expect(copyItem.exists(), '「复制地址单开」搬进了右键菜单').toBe(true)
      expect(copyItem.text()).toContain('复制地址单开')
      await copyItem.trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith(url)
      expect(wrapper.find('.pane-notice').text()).toContain('已复制地址')
      expect(wrapper.find('.pane-notice').text()).toContain(url)
      wrapper.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('批次76-R2 任务4：不是应用面的页就没有地址读数，状态栏与菜单都不凭空多出一段', async () => {
    const wrapper = mount(AppNext, { props: { bridge: stubBridge(carrierView()) } })
    await flushPromises()

    const tab = wrapper.find('[data-page-instance="novel.editor#1"]')
    expect(tab.exists()).toBe(true)
    expect(tab.attributes('data-page-address') ?? '', '正文页没有内嵌浏览器地址').toBe('')
    expect(wrapper.find('[data-test="status-address"]').exists(), '没有地址就别在状态栏编一条').toBe(false)

    tab.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }))
    await flushPromises()
    expect(wrapper.find('[data-test="pane-form-menu"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="form-menu-copy-url"]').exists(), '不是应用面就不给「复制地址单开」').toBe(false)
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

  it('中栏在零面板时给出解释而不是空白；核心区面板头 DOM 已整块删除（批次34）', () => {
    const wrapper = mount(CenterSlotHost, { props: { data: { error: null, notice: '' } } })
    expect(wrapper.text()).toContain('没有已启用的中栏面板')
    expect(wrapper.find('.center-head').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('尚未打开项目')
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
    // 〔批次76 任务4-1〕这一节原来在按钮里附带渲染 `carrier.primary.projectKind`（内部词表值），
    // 实测作者看到的是「剧本（夹具） screenplay」。判据反过来钉：面上只有中文标题，内核 token 不外露。
    expect(gate.find('.wizard-item').text()).toBe('剧本（夹具）')
    expect(gate.text()).not.toContain('screenplay')

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

    // 卷标题按目录名出，是折叠钮（批次66 任务三：它不再是静态 <p>，但也仍然不打开文档，
    // 所以章行照旧只出在 .nx-tree-item 里）。名字与条数分两个 span，取名字那一段。
    const volumes = wrapper.findAll('[data-test="chapter-volume"]')
    expect(volumes.map((node) => node.find('.nx-volume-name').text())).toEqual(['第一卷', '第二卷'])
    expect(volumes.map((node) => node.find('.nx-volume-count').text())).toEqual(['2', '1'])
    expect(volumes[0].element.tagName).toBe('BUTTON')
    expect(volumes[0].attributes('aria-expanded')).toBe('true')
    const rows = wrapper.findAll('.nx-index-window .nx-tree-item')
    expect(rows).toHaveLength(4)
    // 批次33（索引窗 IDE 化）：行＝名字，数字前缀已拆（顺序由文件名与排序自明）。
    expect(rows.map((row) => row.text())).toEqual([
      '第001章-雨夜',
      '第002章-停摆',
      '第003章-雪夜',
      '第004章-尾声'
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
    // 批次43：文档面不再摆路径 · 版本这些开发者信息（作者 2026-10-31）——路径在索引窗那一行的 title 上。
    expect(wrapper.find('[data-pane-id="novel.editor"]').text()).not.toContain('正文/第二卷/第003章-雪夜.md')
    expect(rows[2].attributes('title')).toContain('正文/第二卷/第003章-雪夜.md')

    // 批次66 任务三：卷头那一钮收的是本卷那几行；折叠态按页记进 workspace 条目（重启恢复的就是这一份）。
    // 每点一次都重新查一遍：树的整段会随视图状态重渲染，上头的旧句柄指向的是已经换下的节点。
    // 收放认的是 v-show 落在 ul 上的那条内联声明——jsdom 的 getComputedStyle 对「挂上 display:none 再摘掉」
    // 有缓存（摘掉后仍报 none），isVisible 在这种「收起→再展开」的路径上不可信，真浏览器没这问题。
    const volumeTrees = () => wrapper.findAll('.nx-index-body ul.nx-tree')
    const volumeButtons = () => wrapper.findAll('[data-test="chapter-volume"]')
    const hidden = (ul) => String(ul.attributes('style') ?? '').includes('display: none')
    expect(volumeTrees().map(hidden)).toEqual([false, false, false])
    await volumeButtons()[0].trigger('click')
    await flushPromises()
    expect(volumeButtons()[0].attributes('aria-expanded')).toBe('false')
    expect(volumeTrees().map(hidden)).toEqual([true, false, false])
    expect(hostWorkspace.get('novel.editor#1')?.viewState).toEqual({ collapsed: ['第一卷'] })
    // 再点一次＝展开回去，状态随之落回 null（全展开没有值得落盘的东西，不写空壳）。
    await volumeButtons()[0].trigger('click')
    await flushPromises()
    expect(volumeButtons()[0].attributes('aria-expanded')).toBe('true')
    expect(volumeTrees().map(hidden)).toEqual([false, false, false])
    expect(hostWorkspace.get('novel.editor#1')?.viewState).toBe(null)
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
      '开场',
      '雨夜'
    ])
    flatWrapper.unmount()
  })

  it('最近打开（批次66 任务二）：整份列表只预填不自动开，点一条才落回那一页，关掉页仍留在列表', async () => {
    const chapters = [
      { index: 0, title: '第001章-雨夜', file: '正文/第001章-雨夜.md', name: '第001章-雨夜.md', revision: 1 },
      { index: 1, title: '第002章-雪夜', file: '正文/第002章-雪夜.md', name: '第002章-雪夜.md', revision: 1 }
    ]
    // 上次关掉壳时留在 .pinax/workspace.json 里的那份账：两条最近打开，一页都没开着。
    const archive = {
      version: 3,
      entries: {},
      lastOpenFiles: [
        { pane: 'novel.editor', resource: 'chapter:正文/第002章-雪夜.md' },
        { pane: 'novel.editor', resource: 'chapter:正文/第001章-雨夜.md' }
      ]
    }
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: carrierView() }
      if (channel === IPC_CHANNELS.workspaceLoad) return { ok: true, value: archive }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: chapters.length, truncated: false, chapters } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          const hit = chapters.find((chapter) => chapter.file === payload.args.file) ?? chapters[0]
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: hit.index, title: hit.title, file: hit.file }, text: `${hit.title}正文。`, totalChars: 7, truncated: false, revision: 1 } } }
        }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '未预期的通道' } }
    })
    const wrapper = mount(AppNext, { props: { bridge: { request } } })
    await flushPromises()

    const recentRows = () => wrapper.findAll('[data-test="recent-file"]')
    // 预填：列表一上来就摆在那里（带标题，不是路径尾巴），但没有为这两条开出两页——
    // 页只有一张，是启动补的那一张缺省页。
    expect(recentRows().map((row) => row.text())).toEqual(['章 · 第002章-雪夜', '章 · 第001章-雨夜'])
    expect(hostWorkspace.list()).toHaveLength(1)
    expect(hostWorkspace.list()[0].pane).toBe('novel.editor')

    // 区头那一钮是 disclosure：收起＝列表不占栏高，列表项仍在 DOM 里（v-show，不是删掉）。
    const recentList = () => wrapper.find('.nx-recent-list')
    await wrapper.find('[data-test="recent-toggle"]').trigger('click')
    await flushPromises()
    expect(recentList().element.style.display).toBe('none')
    expect(recentRows()).toHaveLength(2)
    await wrapper.find('[data-test="recent-toggle"]').trigger('click')
    await flushPromises()
    expect(recentList().element.style.display).toBe('')

    // 点第 2 条＝经宿主的唯一开窗通路开那一份文档：同一块 pane 换装（不另起一页），列表把它置顶且不重复。
    await recentRows()[1].trigger('click')
    await flushPromises()
    expect(hostWorkspace.list()).toHaveLength(1)
    expect(hostWorkspace.get('novel.editor#1')?.resource).toBe('chapter:正文/第001章-雨夜.md')
    expect(recentRows().map((row) => row.text())).toEqual(['章 · 第001章-雨夜', '章 · 第002章-雪夜'])

    // 关掉那一页：列表不动——「打开过」是一段历史，不是「现在开着什么」的镜像。
    hostWorkspace.close('novel.editor#1')
    await flushPromises()
    expect(recentRows().map((row) => row.text())).toEqual(['章 · 第001章-雨夜', '章 · 第002章-雪夜'])
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

  it('写作偏好节（工单B＋批次46B）：六项保存时偏好载荷带全部 writing* 字段，根节点变量与开关数据集跟着变', async () => {
    const handlers = new Map()
    const save = vi.fn(async (patch) => ({
      ok: true,
      value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light', ...patch }
    }))
    handlers.set(IPC_CHANNELS.prefsSet, save)
    const bridge = prefsBridge({
      handlers,
      prefsValue: {
        modelPlaneEndpoint: null,
        uiZoom: 0.85,
        theme: 'light',
        writingFontSize: 18,
        writingLineHeight: 2,
        writingParagraphSpacing: 1,
        writingTextIndent: 1.5,
        writingTypewriter: true,
        writingFocusMode: true
      }
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 挂载即读偏好：排版量写根节点 CSS 变量，两个行为开关写 dataset（不是 CSS 变量）。
    expect(document.documentElement.style.getPropertyValue('--writing-font-size')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--writing-line-height')).toBe('2')
    expect(document.documentElement.style.getPropertyValue('--writing-paragraph-spacing')).toBe('1em')
    expect(document.documentElement.style.getPropertyValue('--writing-text-indent')).toBe('1.5em')
    expect(document.documentElement.dataset.writingTypewriter).toBe('on')
    expect(document.documentElement.dataset.writingFocus).toBe('on')

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
    const spacingInput = panel.find('.writing-paragraph-spacing')
    expect(Number(fontInput.element.value)).toBe(18)
    expect(Number(lineInput.element.value)).toBe(2)
    expect(Number(spacingInput.element.value)).toBe(1)
    expect(Number(panel.find('.writing-text-indent').element.value)).toBe(1.5)
    expect(panel.find('.writing-typewriter').element.checked).toBe(true)
    expect(panel.find('.writing-focus-mode').element.checked).toBe(true)

    await fontInput.setValue('20')
    await lineInput.setValue('2.1')
    await spacingInput.setValue('1.2')
    await panel.find('.writing-text-indent').setValue('1')
    await panel.find('.writing-typewriter').setValue(false)
    await panel.find('.control-primary').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      writingFontSize: 20,
      writingLineHeight: 2.1,
      writingParagraphSpacing: 1.2,
      writingTextIndent: 1,
      writingTypewriter: false,
      writingFocusMode: true
    })
    expect(panel.find('.prefs-state.is-ready').text()).toContain('已保存并生效')
    // 保存后的生效路径：偏好回写 → 外壳写根节点变量／dataset（不重开窗口、不重读偏好）。
    expect(document.documentElement.style.getPropertyValue('--writing-font-size')).toBe('20px')
    expect(document.documentElement.style.getPropertyValue('--writing-line-height')).toBe('2.1')
    expect(document.documentElement.style.getPropertyValue('--writing-paragraph-spacing')).toBe('1.2em')
    expect(document.documentElement.style.getPropertyValue('--writing-text-indent')).toBe('1em')
    expect(document.documentElement.dataset.writingTypewriter).toBe('off')
    expect(document.documentElement.dataset.writingFocus).toBe('on')
    wrapper.unmount()
    document.documentElement.style.removeProperty('--writing-font-size')
    document.documentElement.style.removeProperty('--writing-line-height')
    document.documentElement.style.removeProperty('--writing-paragraph-spacing')
    document.documentElement.style.removeProperty('--writing-text-indent')
    delete document.documentElement.dataset.writingTypewriter
    delete document.documentElement.dataset.writingFocus
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
    // 〔批次68-R3〕悬浮球沉默层会在挂载/换项目后各发一枚只读 pinax_proposal_list 计数——
    // 读数多一枚合法，钉的是「写族零穿越」：整个流程里 runtimeToolCall 不得出现写族工具。
    const toolCallsAll = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.runtimeToolCall)
    expect(toolCallsAll.filter(([, payload]) => /_(save|write|delete|rename)$/u.test(String(payload?.tool ?? '')))).toHaveLength(0)
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
    // 修订号取自当前项目账（〔批次76 任务4-1〕口径）：@3 读 carriers.revision、@1／@2 读顶层 revision，
    // 夹具这份是 @2 的 revision 1 → 仍是 1（原来写死 0 的错在这一档被 revision 恰好为 0 的夹具掩盖过）。
    expect(setEnabled).toHaveBeenCalledTimes(1)
    expect(setEnabled).toHaveBeenCalledWith({ pluginId: 'fixture.script', enabled: false, expectedRevision: 1 })
    wrapper.unmount()
  })

  it('〔批次76 任务4-1〕@3 项目的载体写入带的是 carriers.revision，不是硬编码 0', async () => {
    // 遍历没直接抓到这条，是任务4-1 追 chip 时顺着同一个 revision 读出来的真 bug：
    // projectManifest.mjs:46-58 把 @3 归一成 carriers:{primary,enabled,revision}（顶层 revision 不再带账），
    // 而 projectSession 的 nextCarriers（:108-115）拿 expectedRevision 与 carriers.revision 一比就 STALE 拒。
    // 外壳原先一律传 0 → @3 项目里「停用载体／换主载体」必被拒，作者点了像没反应。
    const handlers = new Map()
    const setPrimary = vi.fn(async () => ({ ok: true, value: {} }))
    const setEnabled = vi.fn(async () => ({ ok: true, value: {} }))
    handlers.set(IPC_CHANNELS.carrierSetPrimary, setPrimary)
    handlers.set(IPC_CHANNELS.carrierSetEnabled, setEnabled)
    const base = carrierView()
    const view = {
      ...base,
      // 第二块载体设成「已启用」，这一行才给停用的按钮（夹具缺省是没启用的）。
      carriers: base.carriers.map((carrier, index) => (index === 1 ? { ...carrier, isEnabled: true } : carrier)),
      project: {
        root: 'x', name: '大梦', kind: 'novel', spec: 'pinax-project@3',
        carriers: { primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.script'], revision: 6 }
      }
    }
    const bridge = carriersBridge({ handlers, view })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
    await flushPromises()

    let rows = wrapper.find('[aria-label="载体管理"]').findAll('.carriers-row')
    await rows[1].find('.carriers-set-primary').trigger('click')
    await flushPromises()
    expect(setPrimary).toHaveBeenCalledWith({ pluginId: 'fixture.script', expectedRevision: 6 })

    // 停用走同一条闸：refresh 后重新取行，修订号仍是账上那份 6（夹具的 view 不换版）。
    rows = wrapper.find('[aria-label="载体管理"]').findAll('.carriers-row')
    await rows[1].find('.carriers-toggle').trigger('click')
    await flushPromises()
    expect(setEnabled).toHaveBeenCalledWith({ pluginId: 'fixture.script', enabled: false, expectedRevision: 6 })
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
    // 工作区通道（M2.5-C）随挂载就会走一次读：那是宿主状态，不是项目写入；
    // 服务日志池快照（批次49）同理，只读不写。
    // 快捷键表（批次62）也是只读那一条：hotkeysLoad 不要求项目，hotkeysSave 才要求——这里只可能出现前者。
    const allowedCalls = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet, IPC_CHANNELS.workspaceLoad, IPC_CHANNELS.workspaceSave, IPC_CHANNELS.runtimeServiceLog, IPC_CHANNELS.hotkeysLoad]
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
    // 〔批次68-R3〕悬浮球沉默层要提案计数：挂载期那枚只读 pinax_proposal_list 合法（calls.list 记它），
    // 打开提案审阅节之前不允许有别的提案取数路径。
    expect(wrapper.find('.nx-index-window').text()).not.toContain('提案')
    expect(bridge.calls.list.length).toBeLessThanOrEqual(1)

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
    // 〔批次76 裁定A〕原判据「审阅面头部一行『提案审阅 · 文件名』」改判：这一行撤了，提案名归窗头
    // 那一行「小说 · 提案名」（.json 尾巴不上屏，批次43 同口径）。
    expect(pane.text()).not.toContain('提案审阅 ·')
    expect(wrapper.text()).toContain(`小说（夹具） · ${PROPOSAL.name.replace(/\.json$/u, '')}`)
    expect(pane.find('.doc-meta-hint').text()).toContain('正文/雨夜.md')
    expect(pane.text()).toContain('提案说明：把雨提前一段')
    expect(pane.find('.editor-text, .entry-text').text()).toBe('雨夜。')
    expect(pane.find('[aria-label="提案新文"]').text()).toBe('雨夜，巷子里没人。')

    // 采纳仍走既有那条：chapter_save 带当前修订号与提案名。
    await pane.find('.proposal-adopt').trigger('click')
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

  it('批次37：主进程推 proposals-changed 时自动重列（防抖），别的类别不动；离开设置后不再重列', async () => {
    const handlers = new Map()
    const bridge = proposalsBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'project.reviewProposals' })
    await flushPromises()

    const emit = handlers.get(IPC_EVENT.projectEvent)
    expect(typeof emit).toBe('function')
    const before = bridge.calls.list.length
    // 同一次提问可能连发两三条：防抖后只重列一次。
    emit({ kind: 'proposals-changed', at: '2026-10-30T00:00:00.000Z' })
    emit({ kind: 'proposals-changed', at: '2026-10-30T00:00:01.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 220))
    await flushPromises()
    expect(bridge.calls.list.length).toBe(before + 1)

    // 别的类别（正文变了）不该让提案列表重列。
    const quiet = bridge.calls.list.length
    emit({ kind: 'manuscript-changed', at: '2026-10-30T00:00:02.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 220))
    await flushPromises()
    expect(bridge.calls.list.length).toBe(quiet)

    wrapper.unmount()
    // 卸载后退订：事件表里已没有监听者，再来事件也不会多列一次。
    expect(handlers.has(IPC_EVENT.projectEvent)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 220))
    expect(bridge.calls.list.length).toBe(quiet)
  })
})

describe('标题栏与页内菜单行（工单F · 作者反馈①②）', () => {
  it('标题栏渲染项目信息 chip：有项目＝名称·类型·版本，无项目＝未打开项目', async () => {
    const withProject = mount(AppNext, { props: { bridge: stubBridge(carrierView()) } })
    await flushPromises()
    expect(withProject.find('.nx-titlebar').exists()).toBe(true)
    expect(withProject.find('.nx-titlebar-brand').text()).toBe('Pinax · Next')
    expect(withProject.find('[data-test="titlebar-project-chip"]').text()).toBe('大梦 · 小说（夹具） · 第 1 版')
    // 右侧给原生窗控留位（主进程 titleBarOverlay 盖在这块上）。
    expect(withProject.find('.nx-titlebar-window-controls').exists()).toBe(true)
    withProject.unmount()

    const withoutProject = mount(AppNext, { props: { bridge: stubBridge(emptyFrameworkView()) } })
    await flushPromises()
    expect(withoutProject.find('[data-test="titlebar-project-chip"]').text()).toBe('未打开项目')
    withoutProject.unmount()

    // 〔批次76 任务4-1 改判〕上面那句原判据是「大梦 · novel · 第 1 版」：中间那格端的是内核词表里的
    // 内部 id（project.kind），作者实测念成英文生词。判据换成人话＝主载体的中文标题（清单的 title）。
    // 顺带把修订号那一格也钉住：@3 的账记在 carriers.revision，顶层 revision 是 @1／@2 老档那一格。
    const atV3 = {
      ...carrierView(),
      project: { root: 'x', name: '大梦', kind: 'novel', spec: 'pinax-project@3', carriers: { primary: 'fixture.novel', enabled: ['fixture.novel'], revision: 6 } }
    }
    const v3 = mount(AppNext, { props: { bridge: stubBridge(atV3) } })
    await flushPromises()
    expect(v3.find('[data-test="titlebar-project-chip"]').text()).toBe('大梦 · 小说（夹具） · 第 6 版')
    v3.unmount()

    // 项目声明的主载体不在清单里（插件没装／外部插件被摘）：宁可说「未定主载体」，也不回落内部 token。
    const dangling = {
      ...carrierView(),
      project: { root: 'x', name: '大梦', kind: 'novel', spec: 'pinax-project@3', carriers: { primary: 'fixture.gone', enabled: [], revision: 2 } }
    }
    const orphan = mount(AppNext, { props: { bridge: stubBridge(dangling) } })
    await flushPromises()
    expect(orphan.find('[data-test="titlebar-project-chip"]').text()).toBe('大梦 · 未定主载体 · 第 2 版')
    orphan.unmount()
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

    // 静态八节按组序排列：应用（偏好与模型/备份与恢复/服务与通知）→ 项目（载体管理/导入既有稿/新建项目/主载体选择）→ 文档（文档历史）。
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs.slice(0, 8)).toEqual(['偏好与模型', '备份与恢复', '服务与通知', '载体管理', '导入既有稿', '新建项目', '主载体选择', '文档历史'])
    wrapper.unmount()
  })

  it('目录搜索（工单B＋批次76 任务4-2）：标题与字段标签都算命中，右栏与目录同进同退', async () => {
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

    // 〔任务4-2 改判〕原判据是「搜索只过滤目录，不把右栏当前节换掉」（shell-ui.spec 旧 line 2122-2123）——
    // 那句正是作者点出来的自相矛盾：目录说「这里没有」，右栏还挂着「偏好与模型」。
    // 现在的判据是两栏同进同退：当前节被查询滤掉，右栏同步收成一句人话＋一条退路。
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(false)
    const blank = wrapper.find('[data-test="settings-search-blank"]')
    expect(blank.exists()).toBe(true)
    expect(blank.text()).toContain('没有与「备份」匹配的设置项')
    expect(blank.text()).toContain('左侧目录里是剩下的那些')
    await blank.find('[data-test="settings-search-clear"]').trigger('click')
    await flushPromises()
    // 「清除搜索」就是把词擦掉：目录与右栏一起回来，当前节没被换走。
    expect(search.element.value).toBe('')
    expect(wrapper.find('[data-test="settings-search-blank"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="偏好与模型"]').exists()).toBe(true)

    // 说明字段的浅匹配（keywords 来自各节的标题/描述）：搜「历史仓」也命中备份与恢复。
    await search.setValue('历史仓')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())).toEqual(['备份与恢复'])

    // 〔任务4-2 的另一半〕字段标签进词表：作者搜「字号」是要改写作偏好，
    // 原来目录空了、右栏却自说自话；现在「正文字号／行高／段落间距」这些控件名直接命中，
    // 点这一格右栏就是那一节的真内容（组件仍由 AppNext 的映射表注入，不在弹窗里写死节名）。
    await search.setValue('字号')
    await flushPromises()
    const fontTabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(fontTabs).toEqual(['写作偏好'])
    expect(wrapper.find('[data-test="settings-search-blank"]').exists()).toBe(true)
    await wrapper.find('.settings-navigation .settings-tab').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="settings-panel-carrier:fixture.novel:novel.writing"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="settings-search-blank"]').exists()).toBe(false)

    await search.setValue('不存在的设置项')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab')).toHaveLength(0)
    expect(wrapper.find('[data-test="settings-empty"]').text()).toBe('无匹配设置')
    // 全空时那句空态不再提「左侧目录里是剩下的那些」（没有剩下的可指）。
    const allBlank = wrapper.find('[data-test="settings-search-blank"]').text()
    expect(allBlank).toContain('没有与「不存在的设置项」匹配的设置项')
    expect(allBlank).not.toContain('左侧目录')

    // 清空：目录恢复（静态八节在前，载体占位节在后），右栏跟着回来。
    await search.setValue('')
    await flushPromises()
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs.slice(0, 8)).toEqual(['偏好与模型', '备份与恢复', '服务与通知', '载体管理', '导入既有稿', '新建项目', '主载体选择', '文档历史'])
    expect(wrapper.find('[data-test="settings-panel-carrier:fixture.novel:novel.writing"]').exists()).toBe(true)
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

/**
 * 页底座（批次61 · 作者裁定①「打开载体缺省＝切页」／③「形态切换走右键，不做死按钮」／④「底座＋D 一轮」）。
 *
 * 这一节替代批次59 那两节「统一窗口」用例。改名与翻案都有理由，不是把断言调松：
 *   · 旧断言「点竖条开一扇浮窗／第一扇最大化＋后续浮窗」——被裁定①推翻：缺省是切页，
 *     浮窗只能由显式动作（索引窗「悬浮」钮、右键「浮出为窗」）到达；
 *   · 旧断言 `data-window-state: 'tiled'`＋`tiledWith`／`tileSide`——v3 里分屏不是窗态，
 *     是「一页搬进对面页组」（form 仍 page，group 换 side）；
 *   · 旧断言 `minimized: 'none'｜'tab'`＋「收起不啃 geometry」——v3 只有浮窗持有矩形，
 *     收成标签与占为页都把 geometry 写成 null（位置归宿主排版），所以这条改成「只有浮窗有矩形」；
 *   · 旧断言「窗头常驻形态钮／页签上放形态钮」——被裁定③推翻：形态一律走右键菜单。
 * 状态机本体（迁移、非法值、级联）在 next/tests/workspace-v3.test.mjs 里逐条钉住；
 * 这里只钉界面这一层：DOM 上看到的形态／页组／几何／标题，与工作区记录必须一致。
 */
describe('页底座：开窗缺省＝切页（批次61）', () => {
  afterEach(() => {
    resetWorkspace()
    globalThis.localStorage?.clear()
  })

  const OUTLINE_NODES = [
    { id: 'n1', title: '开场：雨夜进城', summary: '雪夜，柯秒进了城。' },
    { id: 'n2', title: '第一折：停摆的表' }
  ]
  // 夹具里**故意**留着批次66 已从词表删除的两个旧词：真实世界里存在「清单没改就送到外壳」的旧档，
  // 渲染层 sanitizePaneForms 必须把它们滤干净——菜单因此永远只有 dock／side／float 三项（下面有用例钉住）。
  const NOVEL_PANES = [
    { slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'outline', multiplicity: 'single', scope: 'project', forms: ['dock'] },
    { slot: 'center', id: 'novel.editor', title: '正文', icon: 'writing', multiplicity: 'single', scope: 'entry', split: 'main', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] }
  ]
  /** 大纲那块板：`editorMultiplicity` 换掉中栏 pane 的多开声明——single 走 replace-page，keyed 按文档各开一页。 */
  function outlinePanes(editorMultiplicity) {
    return [
      { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', multiplicity: 'single', scope: 'project', forms: ['dock'] },
      { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', multiplicity: editorMultiplicity, scope: 'entry', split: 'side', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      // overlay 槽是协议里的覆层物种（〔§7 待裁②〕本批不收口）：仍缺省浮，但 forms 声明照旧进右键菜单。
      { slot: 'overlay', id: 'outline.widget', title: '大纲', width: 300, multiplicity: 'list', scope: 'session', forms: ['dock', 'split', 'overlay'] }
    ]
  }

  function pageView({ editorMultiplicity = 'single' } = {}) {
    const base = carrierView()
    const panes = outlinePanes(editorMultiplicity)
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
      panes,
      // 协议 @4 的命令面（批次63 收编b 的夹具）：载体自己声明的那条命令，与真清单里那条同名同落点。
      commands: [{ id: 'outline.open-editor', title: '打开大纲编辑', run: 'pane:outline.editor' }]
    }
    return {
      ...base,
      carriers: [{ ...base.carriers[0], panes: NOVEL_PANES }, ...base.carriers.slice(1), outlineCarrier],
      left: [
        { ...NOVEL_PANES[0], pluginId: 'fixture.novel', pluginTitle: '小说（夹具）', primary: true },
        { ...panes[0], pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ],
      center: [
        { ...NOVEL_PANES[1], pluginId: 'fixture.novel', pluginTitle: '小说（夹具）', primary: true },
        { ...panes[1], pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ]
    }
  }

  /**
   * 存档替身：`workspace` 由调用方传入并在用例内共享（就是主进程那份 `.pinax/workspace.json`），
   * save 写在同一对象上，所以「跨挂载读回」在同一用例里就能断言。
   * v3 落盘的是 { version, entries, active, focus }——四格都记下，恢复才谈得上完整。
   */
  function pageBridge({ workspace = { version: 3, entries: {} }, editorMultiplicity = 'single', handlers = new Map(), nodes = OUTLINE_NODES } = {}) {
    const calls = []
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: pageView({ editorMultiplicity }) }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.workspaceLoad) {
        return { ok: true, value: { version: workspace.version ?? 3, entries: workspace.entries ?? {}, active: workspace.active ?? null, focus: workspace.focus ?? null } }
      }
      if (channel === IPC_CHANNELS.workspaceSave) {
        workspace.version = payload?.snapshot?.version ?? 3
        workspace.entries = payload?.snapshot?.entries ?? {}
        workspace.active = payload?.snapshot?.active ?? null
        workspace.focus = payload?.snapshot?.focus ?? null
        return { ok: true, value: { ...workspace } }
      }
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
    return { request, onEvent: (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }, calls, channels: IPC_CHANNELS }
  }

  function railByName(wrapper, name) {
    return wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === name)
  }

  async function openOutlineBoard(wrapper) {
    const rail = railByName(wrapper, '大纲')
    expect(rail, '竖条应有大纲栏').toBeTruthy()
    await rail.trigger('click')
    await flushPromises()
  }

  /** 索引窗标题行的「悬浮」钮＝显式浮窗入口（裁定①：浮窗只在用户明确要的时候才出现）。 */
  async function openWidget(wrapper) {
    const toggle = wrapper.find('.nx-index-overlay-btn')
    expect(toggle.exists(), '索引窗标题行右侧应有「悬浮」钮').toBe(true)
    await toggle.trigger('click')
    await flushPromises()
  }

  function rightClick(node, x = 300, y = 200) {
    node.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }

  /**
   * 指针序列驱动一次拖拽（批次76 裁定A 的验法）：标题栏按下 → 移到目标点 → 停住（先看预览）→ 松手。
   * jsdom 里 offsetParent 恒为 null，PaneWindow 的 parentRect() 回落 `innerWidth/innerHeight`
   * （缺省 1024×768），于是吸附的「窗口层」就是这块虚拟画布：左右缘各 12%＝x≤122／x≥901，
   * 顶缘 14%＝y≤107，右下角球命中圈＝x≥928 且 y≥672。
   */
  async function dragTo(head, to) {
    head.element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 300, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: to.x, clientY: to.y, bubbles: true }))
    await flushPromises()
  }

  async function release(to) {
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: to.x, clientY: to.y, bubbles: true }))
    await flushPromises()
  }

  const formOf = (instance) => hostWorkspace.get(instance)?.form
  const groupOf = (instance) => hostWorkspace.get(instance)?.group

  it('点竖条＝切出一页：form 落 page、进主组、不带几何，一条浮窗都不开（裁定①）', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()

    // 启动补的那一页：主载体正文窗——页态、主组、无矩形。
    expect(hostWorkspace.get('novel.editor#1')).toMatchObject({ pane: 'novel.editor', form: 'page', group: 'main', resource: null, maximized: false })
    expect(hostWorkspace.get('novel.editor#1').geometry).toBe(null)

    await openOutlineBoard(wrapper)
    const outline = hostWorkspace.get('outline.editor#1')
    expect(outline).toMatchObject({ form: 'page', group: 'main' })
    expect(outline.geometry).toBe(null)

    const editor = wrapper.find('.nx-pane-window[data-window-pane="outline.editor"]')
    expect(editor.attributes('data-window-state')).toBe('page')
    expect(editor.attributes('data-window-group')).toBe('main')
    expect(editor.classes()).toContain('is-page')
    // 开窗决策的五种结果里没有「新建浮窗」这一档：整张工作区此刻一条非页态记录都没有。
    expect(hostWorkspace.list().filter((entry) => entry.form !== 'page')).toEqual([])

    // 页签栏＝本组全部页（按叠序），高亮跟着此刻这一页；中心区只画当前那一张。
    // 〔批次76-R3 任务4〕归组后这条读的是**主组那一行**（这两页都在主组，侧组此刻没有页、也就没有侧组条）。
    const stripOfMain = () => wrapper.find('.nx-page-tabstrip[data-tabstrip-group="main"]')
    expect(wrapper.findAll('.nx-page-tabstrip').map((node) => node.attributes('data-tabstrip-group'))).toEqual(['main'])
    const tabs = stripOfMain().findAll('.nx-page-tab')
    expect(tabs.map((tab) => tab.attributes('data-page-instance'))).toEqual(['novel.editor#1', 'outline.editor#1'])
    expect(tabs[1].classes()).toContain('is-active')
    expect(tabs[1].attributes('data-page-form')).toBe('page')
    expect(wrapper.findAll('.nx-pane-window.is-page')).toHaveLength(1)

    // 连点同一格不新增页：第二次只是收起索引窗，第三次回到「已开着 → 回到那一页」。
    await railByName(wrapper, '大纲').trigger('click')
    await flushPromises()
    await railByName(wrapper, '大纲').trigger('click')
    await flushPromises()
    expect(hostWorkspace.list().filter((entry) => entry.pane === 'outline.editor')).toHaveLength(1)
    expect(workspace.entries['outline.editor#1'].form).toBe('page')
    wrapper.unmount()
  })

  it('切板不碰别的页；点页签＝揭示那一页（不新建、不升档）', async () => {
    const wrapper = mount(AppNext, { props: { bridge: pageBridge() } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    // 浮窗那条记录有矩形、页态两条没有：排版与浮动各归各的轴。
    expect(hostWorkspace.get('outline.widget#1')).toMatchObject({ form: 'floating' })
    expect(hostWorkspace.get('outline.widget#1').geometry).toBeTruthy()
    // 〔批次76-R3 任务4〕这三条都没有页组归宿之外的去处：两条页在主组、浮窗挂主组条尾，
    // 所以「点页签＝揭示」那套原判据整条读**主组那一行**即可（侧组此刻没有页）。
    const tabs = () => wrapper.find('.nx-page-tabstrip[data-tabstrip-group="main"]').findAll('.nx-page-tab')
    expect(tabs().map((tab) => tab.attributes('data-page-instance'))).toEqual(['novel.editor#1', 'outline.editor#1', 'outline.widget#1'])
    // 浮窗也上签：否则「看得见」只覆盖了一半。〔批次76 裁定A〕后缀从「浮窗」两个字换成一枚 12px 图标点，
    // 屏幕上不再念文字状态（原判据在此改判，理由：文字角标与窗头/页签的标题抢层级；形态读数改走属性与 aria）。
    expect(tabs()[2].attributes('data-page-form')).toBe('floating')
    expect(tabs()[2].find('.nx-page-tab-flag').attributes('data-page-form-flag')).toBe('floating')
    expect(tabs()[2].find('.nx-page-tab-flag').text()).toBe('')
    expect(tabs()[2].find('.nx-page-tab-flag svg').exists(), '浮窗态要有一枚图标点').toBe(true)

    // 换回小说板：大纲那两条原地不动（页还是页、浮还是浮），只是主组的当前页换成小说。
    await railByName(wrapper, '小说（夹具）').trigger('click')
    await flushPromises()
    expect(hostWorkspace.snapshot().active).toEqual({ main: 'novel.editor#1', side: null })
    expect(formOf('outline.editor#1')).toBe('page')
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(wrapper.find('.nx-pane-window[data-window-pane="novel.editor"]').classes()).toContain('is-page')
    expect(wrapper.findAll('.nx-pane-window.is-page')).toHaveLength(1)

    // 点大纲那条签＝揭示（同一实例，不新建第二页；页态不动它的矩形）。
    await tabs()[1].trigger('click')
    await flushPromises()
    expect(hostWorkspace.snapshot().active.main).toBe('outline.editor#1')
    expect(hostWorkspace.list().filter((entry) => entry.pane === 'outline.editor')).toHaveLength(1)
    expect(wrapper.find('.nx-pane-window[data-window-pane="outline.editor"]').classes()).toContain('is-page')
    wrapper.unmount()
  })

  it('形态只从右键菜单改：项＝声明的 forms ∩ 能落点，fullscreen／immersive 不进菜单（裁定③）', async () => {
    const wrapper = mount(AppNext, { props: { bridge: pageBridge() } })
    await flushPromises()
    await openOutlineBoard(wrapper)

    // 页签上只有「关闭这一页」一枚钮：形态钮不做成常驻死按钮。
    const tab = wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]')
    expect(tab.findAll('button').map((node) => node.attributes('data-page-action'))).toEqual(['close'])

    rightClick(tab)
    await flushPromises()
    const menu = wrapper.find('[data-test="pane-form-menu"]')
    expect(menu.exists()).toBe(true)
    // 批次66 收敛后大纲编辑只声明三值；菜单项恒＝声明 ∩ 词表落点，旧词即使被喂进来也出不来（见 pane-forms 的负向断言）。
    expect(menu.findAll('.nx-form-menu-item').map((item) => item.attributes('data-test')))
      .toEqual(['form-menu-dock', 'form-menu-side', 'form-menu-float', 'form-menu-tab', 'form-menu-close'])
    expect(menu.text()).not.toContain('全屏')
    expect(menu.text()).not.toContain('沉浸')
    // 已经是页态 → 「占为页」置灰：点了没变化的项不给假动作。
    expect(menu.find('[data-test="form-menu-dock"]').element.disabled).toBe(true)

    await menu.find('[data-test="form-menu-float"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.editor#1')).toBe('floating')
    expect(hostWorkspace.get('outline.editor#1').geometry).toBeTruthy()
    const floating = wrapper.find('.nx-pane-window[data-window-pane="outline.editor"]')
    expect(floating.attributes('data-window-state')).toBe('floating')
    // 〔守卫⑪ 的正向那一半〕浮窗必须有窗头：页态压平不等于全壳撤掉 chrome——
    // 拖动、双击最大化、右键改形态这三件事都挂在这一行上，撤了它这扇窗就没法搬。
    expect(floating.find('.nx-pane-window-head').exists(), '浮窗那一档必须渲染窗头').toBe(true)
    // 只有浮窗给四角手柄（页态／标签态由宿主排版，没有可拖的矩形）。
    expect(floating.findAll('.nx-pane-window-resize')).toHaveLength(4)
    // 菜单是一次性浮层：动作完就收，不留第二份。
    expect(wrapper.find('[data-test="pane-form-menu"]').exists()).toBe(false)

    // 窗头右键＝同一条通路的第二个入口：从那儿把它压回页态（矩形随之清掉）。
    rightClick(wrapper.find('.nx-pane-window[data-window-pane="outline.editor"] .nx-pane-window-head'))
    await flushPromises()
    expect(wrapper.findAll('[data-test="pane-form-menu"]')).toHaveLength(1)
    const dockItem = wrapper.find('[data-test="form-menu-dock"]')
    expect(dockItem.element.disabled).toBe(false)
    await dockItem.trigger('click')
    await flushPromises()
    expect(formOf('outline.editor#1')).toBe('page')
    expect(hostWorkspace.get('outline.editor#1').geometry).toBe(null)
    wrapper.unmount()
  })

  it('拖到右缘吸附＝搬进对面页组，拖到左缘＝回主组（批次76 裁定A：形态钮改手势；〔铁律一〕side 仍是页组不是形态）', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)

    const win = () => wrapper.find('.nx-pane-window[data-window-pane="outline.editor"]')
    // 〔批次76-R2 任务2〕页态没有窗头了（〔守卫⑪〕），拖拽起点落在这一页自己的页签上：
    // 宿主把那一下 pointerdown 转进这一页的 PaneWindow.startDrag，吸附判定／预览仍是同一份实现。
    const tab = () => wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]')
    expect(win().find('.nx-pane-window-head').exists(), '〔守卫⑪〕页态窗不许渲染窗头').toBe(false)
    // 拖动中先亮预览（〔工单守卫④〕无预览不落位——预览是落位的前置条件，不是装饰）。
    await dragTo(tab(), { x: 950, y: 400 })
    expect(win().attributes('data-window-snap')).toBe('right')
    const preview = wrapper.find('.nx-pane-snap-preview')
    expect(preview.exists(), '右缘命中圈亮时要有半屏预览').toBe(true)
    expect(preview.attributes('data-snap-target')).toBe('right')
    await release({ x: 950, y: 400 })
    // 形态没变，变的是页组：v3 的「分屏」就是 main／side 两组各摆自己那张页。
    expect(hostWorkspace.get('outline.editor#1')).toMatchObject({ form: 'page', group: 'side' })
    expect(hostWorkspace.get('outline.editor#1').geometry).toBe(null)
    expect(win().attributes('data-window-state')).toBe('page')
    expect(win().attributes('data-window-group')).toBe('side')
    expect(win().classes()).toContain('is-in-side')
    expect(wrapper.findAll('.nx-pane-window.is-page')).toHaveLength(2)
    expect(hostWorkspace.snapshot().active).toEqual({ main: 'novel.editor#1', side: 'outline.editor#1' })
    expect(workspace.entries['outline.editor#1'].group).toBe('side')
    // 松手后预览撤掉：吸附提示不留残影。
    expect(wrapper.find('.nx-pane-snap-preview').exists()).toBe(false)

    // 拖回左缘＝解除：搬回对面那一组，side 组空了，屏幕上只剩一张页。
    await dragTo(tab(), { x: 40, y: 400 })
    expect(win().attributes('data-window-snap')).toBe('left')
    await release({ x: 40, y: 400 })
    expect(groupOf('outline.editor#1')).toBe('main')
    expect(hostWorkspace.snapshot().active).toEqual({ main: 'outline.editor#1', side: null })
    expect(wrapper.findAll('.nx-pane-window.is-in-side')).toHaveLength(0)
    expect(wrapper.findAll('.nx-pane-window.is-page')).toHaveLength(1)

    // 〔作者批次61 裁定③〕键盘／无障碍的兜底还在：右键菜单那一项落的是同一个地方。
    // 〔批次76-R2 任务2〕页态的右键入口跟着窗头一起搬到页签行上（形态菜单本来就是页签／窗头两处同一条通路）。
    rightClick(tab())
    await flushPromises()
    await wrapper.find('[data-test="form-menu-side"]').trigger('click')
    await flushPromises()
    expect(groupOf('outline.editor#1')).toBe('side')
    wrapper.unmount()
  })

  it('阈值外松手＝只改矩形不改形态（〔工单守卫④〕无预览不落位）', async () => {
    const wrapper = mount(AppNext, { props: { bridge: pageBridge() } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    const widget = () => wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]')
    // 浮窗从 (400,300) 拖到 (500,350)：两点都不在命中圈里（x 落在 122～901、y 落在 107～672 之间）。
    await dragTo(widget().find('.nx-pane-window-head'), { x: 500, y: 350 })
    expect(widget().attributes('data-window-snap')).toBe('')
    expect(wrapper.find('.nx-pane-snap-preview').exists()).toBe(false)
    await release({ x: 500, y: 350 })
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(groupOf('outline.widget#1')).toBe('main')
    // 只改了矩形：jsdom 里窗体 rect 全 0，所以位移＝指针位移（100／50）。
    expect(hostWorkspace.get('outline.widget#1').geometry).toMatchObject({ x: 100, y: 50 })

    // 顶缘那一圈＝浮窗的子态「最大化」（〔裁定A〕四条落点里唯一不是换页组的一条）：
    // 拖到 y=60（≤ 层高的 14%＝107）→ 预览亮满层 → 松手落 maximized，形态仍是浮窗、页组不动。
    await dragTo(widget().find('.nx-pane-window-head'), { x: 500, y: 60 })
    expect(widget().attributes('data-window-snap')).toBe('top')
    expect(wrapper.find('.nx-pane-snap-preview').attributes('data-snap-target')).toBe('top')
    await release({ x: 500, y: 60 })
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(groupOf('outline.widget#1')).toBe('main')
    expect(hostWorkspace.get('outline.widget#1').maximized).toBe(true)
    // 页态拖到同一个位置不该有任何反应（v3 没有「页再最大化」那一档）——判据在 paneSnap 的纯函数里，
    // 这里补一条界面层的对照：把上面那扇收回页态，再拖顶缘，预览与 maximized 都不该动。
    // 〔批次76-R2 任务2〕页态的拖拽起点在页签上（窗头已撤）。
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]').trigger('click')
    await flushPromises()
    await dragTo(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]'), { x: 500, y: 60 })
    expect(wrapper.find('.nx-pane-window[data-window-instance="outline.editor#1"]').attributes('data-window-snap')).toBe('')
    await release({ x: 500, y: 60 })
    expect(hostWorkspace.get('outline.editor#1').maximized).toBe(false)
    expect(formOf('outline.editor#1')).toBe('page')
    wrapper.unmount()
  })

  it('只有浮窗持有矩形：拖动／缩放写回工作区，重新挂载读回同一坐标（收起与占为页都清成 null）', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    expect(formOf('outline.widget#1')).toBe('floating')

    const widget = () => wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]')
    // jsdom 里 getBoundingClientRect 全是 0，所以位移＝指针位移；松手写的是整数矩形。
    widget().find('.nx-pane-window-head').element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 130, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 130, bubbles: true }))
    await flushPromises()
    expect(workspace.entries['outline.widget#1'].geometry).toMatchObject({ x: 40, y: 30 })
    expect(widget().attributes('style')).toContain('left: 40px')
    // 坐标不再进 localStorage：v3 唯一的落盘点是工作区记录。
    expect(globalThis.localStorage.getItem('overlay.outline.widget')).toBe(null)

    // 拖右下角：宽高变化，仍写回同一条记录。
    const before = hostWorkspace.get('outline.widget#1').geometry
    widget().find('.nx-pane-window-resize.is-se').element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 40, clientY: 30, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 130, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 130, bubbles: true }))
    await flushPromises()
    const after = hostWorkspace.get('outline.widget#1').geometry
    expect(after.w).toBeGreaterThanOrEqual(before.w)
    expect(after.h).toBeGreaterThanOrEqual(before.h)

    // 双击标题栏＝浮窗的子态：几何留着供还原，页态没有这一档。
    await widget().find('.nx-pane-window-head').trigger('dblclick')
    await flushPromises()
    expect(widget().attributes('data-window-state')).toBe('maximized')
    expect(workspace.entries['outline.widget#1'].maximized).toBe(true)
    expect(hostWorkspace.get('outline.widget#1').geometry).toMatchObject({ x: after.x, y: after.y })
    await widget().find('.nx-pane-window-head').trigger('dblclick')
    await flushPromises()
    expect(widget().attributes('data-window-state')).toBe('floating')
    expect(workspace.entries['outline.widget#1'].maximized).toBe(false)

    // 页态与标签态一律没有矩形（旧断言「收起不啃 geometry」随 v3 作废：位置归宿主排版）。
    expect(hostWorkspace.list().filter((entry) => entry.form !== 'floating').every((entry) => entry.geometry === null)).toBe(true)
    // 拖到右下角那颗球＝收起（〔裁定A〕形态钮换成动线；工单验收点名的「拖进球命中圈→进悬浮球列表」）。
    // 记下的矩形此刻仍是 (40,30) 那一份——收进球里不等于丢掉位置，restore 格带着它。
    const rectWhenCollapsed = { ...hostWorkspace.get('outline.widget#1').geometry }
    await dragTo(widget().find('.nx-pane-window-head'), { x: 960, y: 700 })
    expect(widget().attributes('data-window-snap')).toBe('orb')
    await release({ x: 960, y: 700 })
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(hostWorkspace.get('outline.widget#1').geometry).toBe(null)
    expect(workspace.entries['outline.widget#1'].restore).toMatchObject({ form: 'floating', geometry: rectWhenCollapsed })
    wrapper.unmount()

    // 重新挂载＝从同一份存档读回「收进球里的那一条」（不是二次打开；存档里那条收起态也读得回来）。
    const second = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(second.findAll('.nx-pane-window-tab')).toHaveLength(0)
    expect(second.find('[data-test="collapse-orb"]').attributes('data-orb-count')).toBe('1')
    // 〔批次76 裁定B〕页签上点它＝按 restore 放回**收起前**那一档：原来是浮窗就还是浮窗，矩形原样。
    // 原判据「点签 → form 落 page」是那时候只会硬写页态的产物，随本批改判并留这条理由。
    await second.find('.nx-page-tab[data-page-instance="outline.widget#1"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(hostWorkspace.get('outline.widget#1').geometry).toEqual(rectWhenCollapsed)
    second.unmount()
  })

  it('统一 chrome：窗头只剩一枚 ×（批次76 裁定A）＋没有第二套窗口壳；竖条右键不弹形态菜单', async () => {
    const wrapper = mount(AppNext, { props: { bridge: pageBridge() } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    const widget = wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]')
    // 原判据是 ['collapse','split','close'] 三枚常驻钮。〔裁定A〕「相关的页面形态转换按钮，用拖拽的形式去做」
    // ＋〔裁定B〕收起的呈现归悬浮球 → 收起／分屏两枚钮从窗头撤掉，换形态只剩「拖拽吸附」与「右键菜单」两条活路；
    // × 是唯一保留的常驻动作（它删记录，不是形态）。这条改判据是有理由的，不是静默放宽。
    expect(widget.findAll('[data-window-action]').map((node) => node.attributes('data-window-action'))).toEqual(['close'])
    expect(widget.find('[data-window-action="collapse"]').exists()).toBe(false)
    expect(widget.find('[data-window-action="split"]').exists()).toBe(false)
    expect(widget.attributes('aria-label')).toBe('大纲窗口')
    // 〔批次68-R3 沉默层〕原判据「球本体常驻」翻案：零收起＋零通知＝整球不渲染（判据 ⑰）。
    // 拖拽落点不受影响——paneSnap 的吸附目标是视口角落的纯几何，不看 DOM。
    expect(wrapper.find('[data-test="collapse-orb"]').exists()).toBe(false)
    for (const gone of ['[data-action]', '.nx-overlay-widget', '.nx-overlay-head', '.nx-form-bar', '.nx-split', '.nx-overlay-tab', '.nx-overlay-bubble']) {
      expect(wrapper.find(gone).exists(), `${gone} 不该再存在`).toBe(false)
    }

    // 竖条右键不开形态菜单：菜单的入口是「某一页」（页签或窗头），载体格不是页。
    rightClick(railByName(wrapper, '大纲'))
    await flushPromises()
    expect(wrapper.find('.nx-context-menu').exists()).toBe(false)
    wrapper.unmount()

    // 没声明 forms 的载体同样不伪造菜单：点竖条只是切出那一页。
    const plain = mount(AppNext, { props: { bridge: stubBridge(carrierView()) } })
    await flushPromises()
    rightClick(railByName(plain, '小说（夹具）'))
    await flushPromises()
    expect(plain.find('.nx-context-menu').exists()).toBe(false)
    await railByName(plain, '小说（夹具）').trigger('click')
    await flushPromises()
    expect(plain.find('.nx-pane-window[data-window-pane="novel.editor"]').attributes('data-window-state')).toBe('page')
    plain.unmount()
  })

  it('收起态收进右下角悬浮球：徽标计数、点开列出、点一条回「收起前那一档」（〔裁定B〕· 守卫①②）', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    expect(formOf('outline.widget#1')).toBe('floating')
    const rectBefore = { ...hostWorkspace.get('outline.widget#1').geometry }

    // 收起的入口只剩「右键菜单／Esc／拖进球」三条——窗头那颗「—」钮随〔裁定A〕撤了，这里走菜单。
    rightClick(wrapper.find('.nx-pane-window[data-window-pane="outline.widget"] .nx-pane-window-head'))
    await flushPromises()
    expect(wrapper.find('[data-test="form-menu-tab"]').text()).toContain('收进悬浮球')
    await wrapper.find('[data-test="form-menu-tab"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    // 「上次记忆的位置」真的落在页记录里：进 tab 时把收起前的形态＋矩形＋页组记进 restore 格。
    expect(workspace.entries['outline.widget#1'].restore).toMatchObject({ form: 'floating', group: 'main' })
    // 守卫①：缘签零渲染——右缘那一竖列文字标签整条退役，收起的窗也不画窗体。
    expect(wrapper.findAll('.nx-pane-window-tab')).toHaveLength(0)
    expect(wrapper.find('.nx-pane-window[data-window-instance="outline.widget#1"]').exists()).toBe(false)
    // 有收起＝球在场（沉默层的反面：此刻它有内容）；徽标＝收起数；浮层此刻没开。
    const orb = wrapper.find('[data-test="collapse-orb"]')
    expect(orb.exists()).toBe(true)
    expect(orb.attributes('data-orb-count')).toBe('1')
    expect(wrapper.find('[data-test="orb-badge"]').text()).toBe('1')
    expect(wrapper.find('[data-test="orb-panel"]').exists()).toBe(false)

    await orb.find('[data-test="orb-button"]').trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('[data-test="orb-item"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('大纲')
    // 守卫②：点一条＝回收起前那一档（浮窗回浮窗、矩形原样带回来），不是硬写页态；顺手把浮层收掉。
    await rows[0].trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(hostWorkspace.get('outline.widget#1').geometry).toEqual(rectBefore)
    expect(wrapper.find('[data-test="orb-panel"]').exists()).toBe(false)
    expect(hostWorkspace.get('outline.widget#1').restore).toBe(null)

    // 〔批次68-R3 沉默层〕回收唯一一条后 count=0，球整颗退场（判据⑰）——
    // 所以「浮层开着时 Esc 先归这一层」要赶在回收前演：再收一次，球回来（新挂载，重找），点开浮层。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    const orbReborn = wrapper.find('[data-test="collapse-orb"]')
    expect(orbReborn.exists()).toBe(true)
    await orbReborn.find('[data-test="orb-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="orb-panel"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-test="orb-panel"]').exists()).toBe(false)
    expect(formOf('outline.widget#1')).toBe('tab')

    // 再从球里关：删记录。归零后整球不渲染（〔68-R3 沉默层〕判据 ⑰）。
    await orbReborn.find('[data-test="orb-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="orb-close"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.get('outline.widget#1')).toBe(null)
    expect(workspace.entries['outline.widget#1']).toBeUndefined()
    expect(wrapper.find('[data-test="collapse-orb"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="orb-badge"]').exists()).toBe(false)

    // 页签栏那条 × 仍是删记录（原判据在这里成立，与球共用同一个 close）。
    // 〔批次76-R3 任务4〕按组模型指名：这两页同属主组，所以它们出现在**主组那一行**里（不是「屏上随便哪一条」）。
    expect(wrapper.findAll('.nx-page-tabstrip').map((node) => node.attributes('data-tabstrip-group'))).toEqual(['main'])
    expect(wrapper.find('.nx-page-tabstrip[data-tabstrip-group="main"]').findAll('.nx-page-tab')
      .map((node) => node.attributes('data-page-instance'))).toEqual(['novel.editor#1', 'outline.editor#1'])
    // 中心区只画「所在组的当前页」：main 的当前页是最后切出来的那一页（大纲编辑），
    // 正文那条仍在册、签上有名，但同组的第二页不占屏——〔铁律一〕不给同一组画两次窗。
    // 刚关掉的那条是浮窗：它不占页组，退场时当前页指针根本不用重指（原判据「指针回指 novel」是猜的，实测不成立）。
    expect(hostWorkspace.get('outline.editor#1')).toMatchObject({ form: 'page', group: 'main' })
    expect(hostWorkspace.snapshot().active.main).toBe('outline.editor#1')
    expect(wrapper.findAll('.nx-pane-window.is-page').map((node) => node.attributes('data-window-instance'))).toEqual(['outline.editor#1'])
    wrapper.unmount()
  })

  it('5 扇同时收起＝徽标 5、列表 5 条、每条都点得动（缘签时代的堆叠问题从源头消失）', async () => {
    // 遍历实测：右缘竖排标签用 `top: 120 + i*36` 硬排，5 扇收起＝6 对重叠、后面那扇点不到。
    // 现在收起态只剩球里的一列，每条一行、整行命中区 ≥44——这里验的是「都在、都可点」，不是像素。
    // 清单只用夹具里 center／overlay 槽的那几块 pane：左树（novel.shelf／outline.tree）不是可开窗的
    // 内容，descriptorFor 认不出它，硬塞进夹具只会测到「记录在册但不呈现」的另一条口径。
    // 三块 pane 凑不够 5 扇，就按 v3 的多实例口径开同一块的第二页——正好也是作者会走的那条路。
    const entries = {}
    const instances = ['novel.editor#1', 'novel.editor#2', 'outline.editor#1', 'outline.editor#2', 'outline.widget#1']
    instances.forEach((instance, index) => {
      const group = index % 2 === 0 ? 'main' : 'side'
      entries[instance] = {
        pane: instance.split('#')[0],
        instance,
        form: 'tab',
        group,
        order: index + 1,
        z: index + 1,
        resource: null,
        viewState: null,
        restore: { form: 'page', group, geometry: null, maximized: false }
      }
    })
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace: { version: 3, entries } }) } })
    await flushPromises()

    const orb = wrapper.find('[data-test="collapse-orb"]')
    expect(orb.attributes('data-orb-count')).toBe('5')
    expect(wrapper.find('[data-test="orb-badge"]').text()).toBe('5')
    await orb.find('[data-test="orb-button"]').trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('[data-test="orb-item"]')
    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.attributes('data-orb-instance'))).toEqual(instances)
    // 每条点得动：点第一条就把它放出来，球里少一条。
    await rows[0].trigger('click')
    await flushPromises()
    expect(formOf('novel.editor#1')).toBe('page')
    expect(wrapper.find('[data-test="orb-badge"]').text()).toBe('4')
    // 缘签零渲染（守卫①）在这一档也一样：屏上没有第二套收起态呈现。
    expect(wrapper.findAll('.nx-pane-window-tab')).toHaveLength(0)
    wrapper.unmount()
  })

  it('Esc＝把最上面那一页收进悬浮球；统一二级页开着时 Esc 先归弹窗', async () => {
    const handlers = new Map()
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ handlers }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    expect(formOf('outline.widget#1')).toBe('floating')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    // 叠序最高的是刚开的浮窗 → 它收进球里；页态那条不动。
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(wrapper.find('[data-test="collapse-orb"]').attributes('data-orb-count')).toBe('1')
    // 守卫①：球是收起态的唯一呈现，右缘那一竖列文字标签不再回来。
    expect(wrapper.findAll('.nx-pane-window-tab')).toHaveLength(0)
    expect(formOf('outline.editor#1')).toBe('page')

    // 再按一次：非标签记录里最靠后的那张页（大纲编辑）也让位。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(formOf('outline.editor#1')).toBe('tab')
    expect(hostWorkspace.snapshot().active.main).toBe('novel.editor#1')

    // 设置开着：Esc 关弹窗，窗口一条都不动（让位给那一层）。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(true)
    const before = hostWorkspace.list().map((entry) => `${entry.instance}:${entry.form}`)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)
    expect(hostWorkspace.list().map((entry) => `${entry.instance}:${entry.form}`)).toEqual(before)
    wrapper.unmount()
  })

  it('multiplicity=single 硬闸：换文档＝换这一页装哪份稿子，不另起一页', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    // 迷你大纲点第二行：资源是 outline:node:1，但这块 pane 声明 single → 只换那一页的 resource。
    await wrapper.findAll('.nx-overlay-tree .workspace-nav-item')[1].trigger('click')
    await flushPromises()
    const pages = hostWorkspace.list().filter((entry) => entry.pane === 'outline.editor')
    expect(pages).toHaveLength(1)
    expect(pages[0].instance).toBe('outline.editor#1')
    expect(pages[0].resource).toBe('outline:node:1')
    expect(workspace.entries['outline.editor#1'].resource).toBe('outline:node:1')
    // 窗头与页签的标题跟着文档走。〔批次76 裁定A〕原判据「大纲编辑 · 1」改判：
    // 那一行不再念 resource 的数字尾巴（内部 id 不上屏），也不念 pane 名——读作「载体名 · 文档名」，
    // 文档名从这一页自己的数据面回读（大纲节点＝节点标题）。
    expect(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]').text()).toContain('大纲 · 第一折：停摆的表')
    // 那一页的文档面确实换了（读态标题那一行已由批次76 撤到窗头，内容层不再自绘）。
    expect(wrapper.find('[data-test="outline-reading-title"]').exists()).toBe(false)

    // 同一份文档重复点＝回到这一页，既不新建也不改 resource。
    await wrapper.findAll('.nx-overlay-tree .workspace-nav-item')[1].trigger('click')
    await flushPromises()
    expect(hostWorkspace.list().filter((entry) => entry.pane === 'outline.editor')).toHaveLength(1)
    expect(hostWorkspace.get('outline.editor#1').resource).toBe('outline:node:1')
    wrapper.unmount()
  })

  it('multiplicity=keyed：一份文档一页，两页各看各的稿子（〔裁定④〕D 的证据）', async () => {
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ editorMultiplicity: 'keyed' }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    // 竖条开的那一页 resource=null（该 pane 的缺省那份），两次点击各开一页。
    await wrapper.findAll('.nx-overlay-tree .workspace-nav-item')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('.nx-overlay-tree .workspace-nav-item')[1].trigger('click')
    await flushPromises()
    const pages = hostWorkspace.list().filter((entry) => entry.pane === 'outline.editor')
    expect(pages.map((page) => page.instance)).toEqual(['outline.editor#1', 'outline.editor#2', 'outline.editor#3'])
    expect(pages.map((page) => page.resource)).toEqual([null, 'outline:node:0', 'outline:node:1'])
    // 页签栏三条都上签，标题按各自那份文档区分。
    // 〔批次76 裁定A〕原判据「大纲编辑／大纲编辑 · 0／大纲编辑 · 1」改判：窗头与页签统一读「载体名 · 文档名」，
    // 大纲节点的数字序号是内部 id，不再当标题端给作者（原判据保留在此行的替换里，不静默删）。
    const tabText = (instance) => wrapper.find(`.nx-page-tab[data-page-instance="${instance}"]`).text()
    expect(tabText('outline.editor#1')).toContain('大纲 · 大纲编辑')
    expect(tabText('outline.editor#2')).toContain('大纲 · 开场：雨夜进城')
    expect(tabText('outline.editor#3')).toContain('大纲 · 第一折：停摆的表')

    // 一页一份文档面（D-2）：揭示 #2 看到的是第一个节点，揭示 #3 看到的是第二个——两份草稿互不覆盖。
    // 判据从「内容层那一行读态标题」→「这一页自己的窗头」→（〔批次76-R2 任务2〕）「这一页自己的页签」：
    // 页态没有窗头了，标题面跟着那一行签走，指向（哪一页装哪份文档）一个字没改。
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#2"]').trigger('click')
    await flushPromises()
    expect(tabText('outline.editor#2')).toBe('大纲 · 开场：雨夜进城')
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#3"]').trigger('click')
    await flushPromises()
    expect(tabText('outline.editor#3')).toBe('大纲 · 第一折：停摆的表')

    // 关掉其中一页：另一页的记录与文档都不动。
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#3"] [data-page-action="close"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.get('outline.editor#3')).toBe(null)
    expect(hostWorkspace.get('outline.editor#2').resource).toBe('outline:node:0')
    wrapper.unmount()
  })

  it('批次76 裁定A ＋ 批次76-R2 任务2：标题面只剩一行「载体 · 文档」，页态那一行就是页签本身', async () => {
    globalThis.localStorage?.clear()
    const wrapper = mount(AppNext, { props: { bridge: pageBridge() } })
    await flushPromises()

    // ① 〔批次76-R2 任务2〕页态连窗头都不渲染：活动页签就是这一页的标题行
    //    （作者那句「画布页签条 → 页签条 → 窗头标题 → 网址 → 内容」五层里，中间那两层压平成一层）。
    const tab = wrapper.find('.nx-page-tab[data-page-instance="novel.editor#1"]')
    expect(tab.exists(), '页态的标题面＝这一页自己的页签').toBe(true)
    expect(tab.text()).toBe('小说（夹具） · 雨夜')
    // 〔守卫⑪〕页态窗的 DOM 里不许出现 nx-pane-window-head（正向那一半——浮窗必须出现——在「形态只从右键菜单改」那条用例里对照）。
    expect(wrapper.find('.nx-pane-window[data-window-instance="novel.editor#1"] .nx-pane-window-head').exists())
      .toBe(false)
    expect(wrapper.findAll('.nx-pane-window-head')).toHaveLength(0)

    // ② 内容层不再自绘任何一行标题：h2.doc-title 在整个壳里必须是 0（守卫⑤的运行时那半，源码侧在 visual-contract）。
    expect(wrapper.findAll('h2.doc-title').length, '内容层还自绘标题行，同一份文档名会同屏出现两遍').toBe(0)

    // ③ 内部 id 不上屏：resource 里的数字尾巴（record:material:7 → 7）不许当标题；
    //    标题只能来自这一页数据面回读到的真名字，回读不到就只显示载体名。
    expect(tab.text()).not.toMatch(/\b(novel|chapter|record|editor)\b/u)
    wrapper.unmount()
  })

  /**
   * 〔批次76-R3 守卫⑬「有窗必有签」〕运行时那一半。
   *
   * jsdom 没有排版，量不出「签行画在窗上方」这件事，所以判据落在 **DOM 归属**：屏上每摊开一页，
   * 它必须就在**本组那一列**（`.nx-pane-group[data-pane-group=<组>]`）里，而那一列的**首行**必须是
   * 本组自己的签行（`.nx-page-tabstrip[data-tabstrip-group=<组>]`），且那一行里就有这一页的签。
   * 反过来不许留「有条无内容」：侧组没有页就没有侧组那一列，也就没有侧组条
   * （主组条要收留浮窗／收起态那些没有页组归宿的页，本来就可能没有本组的窗，那一侧不适用）。
   */
  function expectEveryPageHasItsGroupTab(wrapper) {
    for (const win of wrapper.findAll('.nx-pane-window[data-window-state="page"]')) {
      const instance = win.attributes('data-window-instance')
      const group = win.attributes('data-window-group')
      const column = win.element.closest('[data-pane-group]')
      expect(column, `${instance} 这一页不在任何页组列里（守卫⑬）`).toBeTruthy()
      expect(column.getAttribute('data-pane-group'), `${instance} 落错了页组那一列`).toBe(group)
      const strip = column.querySelector(`.nx-page-tabstrip[data-tabstrip-group="${group}"]`)
      expect(strip, `${group} 组摊着窗却没有自己的签行（守卫⑬：有窗必有签）`).toBeTruthy()
      expect(strip.querySelector(`.nx-page-tab[data-page-instance="${instance}"]`), `${instance} 的签不在本组那一行里`).toBeTruthy()
      expect(column.firstElementChild, '签行是组内首行（〔任务2〕不浮不叠）').toBe(strip)
    }
    const sideStrip = wrapper.find('.nx-page-tabstrip[data-tabstrip-group="side"]')
    const sidePages = wrapper.findAll('.nx-pane-window[data-window-state="page"][data-window-group="side"]')
    expect(sideStrip.exists(), sidePages.length ? '侧组摊着页却没有侧组那一行条' : '侧组没有页却留着侧组条（有条无内容）')
      .toBe(sidePages.length > 0)
    return sidePages.length
  }

  it('〔批次76-R3 守卫⑬〕有窗必有签：每组一列、条是列内首行；两组各亮自己那组的当前页（互不抢）', async () => {
    const workspace = {
      version: 3,
      entries: {
        'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', resource: null, group: 'main', order: 0, form: 'page', geometry: null, z: 1, maximized: false },
        'outline.editor#1': { instance: 'outline.editor#1', pane: 'outline.editor', resource: null, group: 'side', order: 0, form: 'page', geometry: null, z: 2, maximized: false },
        'outline.widget#1': { instance: 'outline.widget#1', pane: 'outline.widget', resource: null, group: 'main', order: 1, form: 'floating', geometry: { x: 40, y: 60, w: 320, h: 300 }, z: 3, maximized: false },
        'outline.widget#2': { instance: 'outline.widget#2', pane: 'outline.widget', resource: null, group: 'main', order: 2, form: 'tab', geometry: null, z: 4, maximized: false, restore: { form: 'page', group: 'main', geometry: null, maximized: false } }
      },
      active: { main: 'novel.editor#1', side: 'outline.editor#1' },
      focus: 'side'
    }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()

    // ① 两组各一列、各一条；两条都通过守卫⑬那条归属判据。
    expect(expectEveryPageHasItsGroupTab(wrapper), '侧组那页应在侧组那一列里').toBe(1)
    const columns = wrapper.findAll('[data-test="pane-group"]')
    expect(columns.map((node) => node.attributes('data-pane-group'))).toEqual(['main', 'side', 'floating'],
      '主组列＋侧组列＋浮窗那一列（浮窗列只是绝对定位的容器，签归主组条尾收留）')
    expect(wrapper.findAll('.nx-page-tabstrip')).toHaveLength(2, '屏幕上只剩「每组一条」：全局那一条已撤，浮窗列不出条')
    expect(columns[2].find('.nx-page-tabstrip').exists(), '浮窗那一列不许自己长出条').toBe(false)

    // ② 一条只列本组：主组条＝本组的页＋条尾收留的浮窗与收起态；侧组条＝只有侧组那一页。
    const mainStrip = wrapper.find('.nx-page-tabstrip[data-tabstrip-group="main"]')
    const sideStrip = wrapper.find('.nx-page-tabstrip[data-tabstrip-group="side"]')
    expect(mainStrip.findAll('.nx-page-tab').map((node) => node.attributes('data-page-instance')))
      .toEqual(['novel.editor#1', 'outline.widget#1', 'outline.widget#2'], '主组条＝本组的页在前、没有页组归宿的挂条尾')
    expect(sideStrip.findAll('.nx-page-tab').map((node) => node.attributes('data-page-instance')))
      .toEqual(['outline.editor#1'], '侧组条只列侧组的页——别人家的页不许跨条混列')

    // ③ 互不抢：焦点在侧组，主组条仍亮着主组自己的当前页，侧组条亮侧组那一页（VS Code 两个编辑器组各亮各的）。
    expect(mainStrip.find('.nx-page-tab.is-active').attributes('data-page-instance')).toBe('novel.editor#1')
    expect(sideStrip.find('.nx-page-tab.is-active').attributes('data-page-instance')).toBe('outline.editor#1')
    expect(sideStrip.find('.nx-page-tab.is-active').attributes('aria-selected'), '侧组当前页的签要读得出「我是本组的当前页」').toBe('true')
    expect(columns[0].classes()).toContain('is-blurred-group', '焦点不在主组：那条底色退一档，但高亮照旧亮自己那组的页')
    expect(columns[1].classes()).not.toContain('is-blurred-group')
    // 侧组条带与窗体同一条左缘分隔（作者裁定：右半屏要「显示出那个窗口的名字」，分界得从标题行续到内容）。
    expect(sideStrip.classes()).toContain('is-group-side')

    // ④ 点另一组的签＝把焦点给那一组（不搬窗、不换形态）——这条语义在归组后仍然只由 setActive 那一句承担。
    await sideStrip.find('.nx-page-tab[data-page-instance="outline.editor#1"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.snapshot().focus).toBe('side')
    expect(formOf('outline.editor#1')).toBe('page')
    expect(groupOf('outline.editor#1')).toBe('side')

    // ⑤ 条尾收留的那两枚照样可以点回来：浮窗＝抬到最前（不改形态），收起态＝按 restore 放回它原来那一档。
    await mainStrip.find('.nx-page-tab[data-page-instance="outline.widget#1"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('floating')
    await mainStrip.find('.nx-page-tab[data-page-instance="outline.widget#2"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#2')).toBe('page')
    expect(groupOf('outline.widget#2')).toBe('main')
    expect(expectEveryPageHasItsGroupTab(wrapper)).toBe(1)
    wrapper.unmount()

    // ⑥ 侧组空了就整列不渲染：只有主组那一页时，屏幕上只有主组那一条，也不会有「侧组条配空内容」。
    const solo = { version: 3, entries: { 'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', resource: null, group: 'main', order: 0, form: 'page', geometry: null, z: 1, maximized: false } }, active: { main: 'novel.editor#1', side: null }, focus: 'main' }
    const soloWrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace: solo }) } })
    await flushPromises()
    expect(soloWrapper.findAll('[data-test="pane-group"]').map((node) => node.attributes('data-pane-group'))).toEqual(['main'])
    expect(soloWrapper.findAll('.nx-page-tabstrip').map((node) => node.attributes('data-tabstrip-group'))).toEqual(['main'])
    expectEveryPageHasItsGroupTab(soloWrapper)
    soloWrapper.unmount()
  })

  it('version:2 存档在 UI 层一次迁移到 v3：maximized→页、tab→标签、贴靠→对面页组、其余→浮窗', async () => {
    const workspace = {
      version: 2,
      entries: {
        'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', geometry: { x: 0, y: 0, w: 600, h: 400 }, z: 1, minimized: 'none', maximized: true, tiledWith: null, tileSide: null },
        'outline.editor#1': { instance: 'outline.editor#1', pane: 'outline.editor', geometry: { x: 24, y: 24, w: 500, h: 360 }, z: 2, minimized: 'tab', maximized: false, tiledWith: null, tileSide: null },
        'outline.widget#1': { instance: 'outline.widget#1', pane: 'outline.widget', geometry: { x: 40, y: 60, w: 320, h: 300 }, z: 3, minimized: 'none', maximized: false, tiledWith: null, tileSide: null },
        'novel.editor#2': { instance: 'novel.editor#2', pane: 'novel.editor', geometry: { x: 80, y: 80, w: 300, h: 300 }, z: 4, minimized: 'none', maximized: false, tiledWith: 'novel.editor#1', tileSide: 'right' }
      }
    }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()

    // 四条记录各归各的 v3 落点；v2 的几何只有浮窗那一条带得过来。
    expect(hostWorkspace.get('novel.editor#1')).toMatchObject({ form: 'page', group: 'main', geometry: null, maximized: false })
    expect(hostWorkspace.get('outline.editor#1')).toMatchObject({ form: 'tab', geometry: null })
    expect(hostWorkspace.get('outline.widget#1')).toMatchObject({ form: 'floating', resource: null })
    expect(hostWorkspace.get('outline.widget#1').geometry).toMatchObject({ x: 40, y: 60, w: 320, h: 300 })
    expect(hostWorkspace.get('novel.editor#2')).toMatchObject({ form: 'page', group: 'side' })
    // 内存里已是 v3，并把整批迁移如实记成警告（v2 没有「哪份文档」这一格）。
    const snap = hostWorkspace.snapshot()
    expect(snap.version).toBe(3)
    expect(snap.warnings).toContain('WORKSPACE_MIGRATED_V2')
    expect(snap.warnings).toContain('WORKSPACE_RESOURCE_UNKNOWN')

    // 界面按迁移结果渲染：球里一条（〔裁定B〕收起态不再有右缘缘签）、浮窗一条、
    // 屏上两张页（main＋side 各画自己的当前页＝对半）。
    expect(wrapper.findAll('.nx-pane-window-tab')).toHaveLength(0)
    expect(wrapper.find('[data-test="collapse-orb"]').attributes('data-orb-count')).toBe('1')
    expect(wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]').attributes('data-window-state')).toBe('floating')
    const half = wrapper.findAll('.nx-pane-window.is-page')
    expect(half.map((node) => node.attributes('data-window-instance'))).toEqual(['novel.editor#1', 'novel.editor#2'])
    expect(half[1].attributes('data-window-group')).toBe('side')
    expect(half[1].classes()).toContain('is-in-side')
    // 下一次变更才整份重写：落盘形状升到 v3（四格齐全）。这里用 Esc 收最上面那扇浮窗（窗头钮已撤）。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(wrapper.find('[data-test="collapse-orb"]').attributes('data-orb-count')).toBe('2')
    // 球里两条各验一路：v2 迁来的那条没有 restore 那一格 → 回**页态**（旧档如实如此，不猜形态）；
    // 本轮刚收进去的那条带着记忆 → 回浮窗并带回 (40,60,320,300)。
    await wrapper.find('[data-test="orb-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="orb-item"][data-orb-instance="outline.editor#1"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.editor#1')).toBe('page')
    await wrapper.find('[data-test="orb-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="orb-item"][data-orb-instance="outline.widget#1"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(hostWorkspace.get('outline.widget#1').geometry).toMatchObject({ x: 40, y: 60, w: 320, h: 300 })
    expect(workspace.version).toBe(3)
    expect(Object.keys(workspace.active).sort()).toEqual(['main', 'side'])
    expect(workspace.entries['novel.editor#2'].group).toBe('side')
    expect(workspace.entries['novel.editor#2'].form).toBe('page')
    wrapper.unmount()
  })

  it('空白卡修复（v3）：存档里开着的浮窗，挂载即补一次取数，窗口不摊空树', async () => {
    const workspace = {
      version: 3,
      entries: {
        'outline.widget#1': { instance: 'outline.widget#1', pane: 'outline.widget', resource: null, group: 'main', order: 0, form: 'floating', geometry: { x: 40, y: 60, w: 320, h: 300 }, z: 1, maximized: false }
      }
    }
    const bridge = pageBridge({ workspace })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 本次启动一次都没访问大纲板：这一页的数据面是水合时按记录自己补的那一次取数。
    expect(bridge.calls).toContain('pinax_outline_read')
    const widget = wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]')
    expect(widget.exists()).toBe(true)
    const rows = widget.findAll('.nx-overlay-tree .workspace-nav-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('开场：雨夜进城')
    wrapper.unmount()
  })

  it('停用载体＝解注册：该载体全部页记录清出工作区（v3 轴），别的载体原样', async () => {
    const workspace = {
      version: 3,
      entries: {
        'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', resource: 'chapter:正文/雨夜.md', group: 'main', order: 0, form: 'page', geometry: null, z: 1, maximized: false },
        'outline.editor#1': { instance: 'outline.editor#1', pane: 'outline.editor', resource: null, group: 'main', order: 1, form: 'page', geometry: null, z: 2, maximized: false },
        'outline.widget#1': { instance: 'outline.widget#1', pane: 'outline.widget', resource: null, group: 'main', order: 0, form: 'tab', geometry: null, z: 3, maximized: false },
        'outline.widget#2': { instance: 'outline.widget#2', pane: 'outline.widget', resource: null, group: 'main', order: 0, form: 'floating', geometry: { x: 200, y: 90, w: 320, h: 300 }, z: 4, maximized: false }
      },
      active: { main: 'novel.editor#1', side: null },
      focus: 'main'
    }
    const hostCustom = hostViewRegistry.resolve(CUSTOM_VIEW_TYPE)
    try {
      hostViewRegistry.unregister(CUSTOM_VIEW_TYPE)
      expect(hostViewRegistry.registerView(CUSTOM_VIEW_TYPE, () => ({ kind: 'custom-panel' }), { owner: 'pinax.carrier.outline' }).ok).toBe(true)

      const base = pageBridge({ workspace })
      const handlers = new Map()
      const setEnabled = vi.fn(async () => ({ ok: true, value: {} }))
      const request = vi.fn(async (channel, payload) => (channel === IPC_CHANNELS.carrierSetEnabled ? setEnabled(payload) : base.request(channel, payload)))
      const wrapper = mount(AppNext, { props: { bridge: { request, onEvent: (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }, channels: IPC_CHANNELS } } })
      await flushPromises()
      expect(formOf('outline.widget#1')).toBe('tab')
      expect(formOf('outline.widget#2')).toBe('floating')

      handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.carriers' })
      await flushPromises()
      const outlineRow = wrapper.find('[aria-label="载体管理"]').findAll('.carriers-row').find((row) => row.text().includes('大纲'))
      expect(outlineRow, '载体管理里应有非主载体大纲').toBeTruthy()
      await outlineRow.find('.carriers-toggle').trigger('click')
      await flushPromises()

      expect(setEnabled).toHaveBeenCalledWith({ pluginId: 'pinax.carrier.outline', enabled: false, expectedRevision: 1 })
      expect(hostViewRegistry.resolve(CUSTOM_VIEW_TYPE)).toBe(null)
      expect(hostViewRegistry.resolve('pinax.view.editor').builtin).toBe(true)
      expect(hostWorkspace.list().filter((entry) => entry.pane.startsWith('outline.'))).toEqual([])
      expect(hostWorkspace.get('outline.widget#2')).toBe(null)
      // 别的载体一条都不动：正文页仍是页态、仍装着它那篇稿子。
      expect(hostWorkspace.get('novel.editor#1')).toMatchObject({ form: 'page', group: 'main', resource: 'chapter:正文/雨夜.md' })
      expect(workspace.entries['outline.widget#1']).toBeUndefined()
      expect(typeof handlers.get(IPC_EVENT.projectEvent)).toBe('function')
      expect(() => handlers.get(IPC_EVENT.projectEvent)({ kind: 'chapter-saved', at: 1 })).not.toThrow()
      await flushPromises()
      expect(request).toHaveBeenCalledWith(IPC_CHANNELS.view, {})
      wrapper.unmount()

      // 再启用：存档里没有 outline.* 残留，重开浮窗从干净状态建记录。
      resetWorkspace()
      const remount = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
      await flushPromises()
      expect(Object.keys(workspace.entries).some((key) => key.startsWith('outline.'))).toBe(false)
      await railByName(remount, '大纲').trigger('click')
      await flushPromises()
      await openWidget(remount)
      const reopened = hostWorkspace.get('outline.widget#1')
      expect(reopened).toMatchObject({ pane: 'outline.widget', form: 'floating', resource: null })
      expect(reopened.geometry).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
      remount.unmount()
    } finally {
      hostViewRegistry.disposeOwner('pinax.carrier.outline')
      if (hostCustom) {
        hostViewRegistry.registerView(hostCustom.type, hostCustom.factory, { owner: hostCustom.owner, builtin: hostCustom.builtin })
      }
      globalThis.localStorage?.clear()
    }
  })

  /** 手势真按下去才算数：源码里有那句函数不够，得证明值确实流到 openTarget。 */
  function altClick(node) {
    node.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, altKey: true }))
  }

  function plainClick(node) {
    node.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  }

  function middleDown(node) {
    node.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }))
  }

  it('Alt＋点页签／竖条＝同一个动作换一形态（浮窗）；中键点页签＝关被点那一页（批次62 任务五）', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    expect(formOf('outline.editor#1')).toBe('page')
    expect(hostWorkspace.list().filter((entry) => entry.form !== 'page')).toEqual([])

    // 入口①：Alt＋点页签。落点判定没变（还是那一页），只有形态跟着手势走。
    altClick(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]'))
    await flushPromises()
    expect(formOf('outline.editor#1')).toBe('floating')
    expect(hostWorkspace.get('outline.editor#1').geometry).toBeTruthy()
    expect(hostWorkspace.list().filter((entry) => entry.pane === 'outline.editor')).toHaveLength(1,
      '手势不许另起一页：换形态是在原有那一页上换')

    // 入口②：Alt＋点竖条那一格（小说板此刻那一页是页态）。
    altClick(railByName(wrapper, '小说（夹具）'))
    await flushPromises()
    expect(formOf('novel.editor#1')).toBe('floating')

    // 不带 Alt 的普通点击一次都不拦：还是「揭示那一页」，形态由右键菜单说了算（批次61 语义）。
    plainClick(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]'))
    await flushPromises()
    expect(hostWorkspace.list().map((entry) => entry.instance).sort()).toEqual(['novel.editor#1', 'outline.editor#1'])
    expect(formOf('outline.editor#1')).toBe('floating', '普通点击不换形态')
    expect(hostWorkspace.snapshot().active.main, '两条都浮着时主组没有当前页：页位只由页态记录占据').toBe(null)

    // 中键：关的就是被点的那一条签，别的页原地不动。
    middleDown(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]'))
    await flushPromises()
    expect(hostWorkspace.get('outline.editor#1')).toBe(null)
    expect(hostWorkspace.get('novel.editor#1')).toBeTruthy()
    expect(wrapper.findAll('.nx-page-tab').map((tab) => tab.attributes('data-page-instance'))).toEqual(['novel.editor#1'])

    // 中键落在非页签处（正文里）＝不关任何东西：认不出页签就整体让位。
    middleDown(wrapper.find('.col-center'))
    await flushPromises()
    expect(hostWorkspace.get('novel.editor#1')).toBeTruthy()
    wrapper.unmount()
  })

  it('命令面板：Ctrl+P 唤起、子串过滤、Enter 经 command 通路执行；Esc 只收面板不收窗（批次62 任务三／四）', async () => {
    const handlers = new Map([[IPC_CHANNELS.commandList, () => ({
      ok: true,
      value: {
        total: 2,
        commands: [
          { id: 'project.proposals', title: '提案审阅…', owner: 'app.menu', ownerTitle: '应用菜单', group: 'menu', accelerator: 'CmdOrCtrl+Shift+R', run: 'menu:project.proposals' },
          { id: 'outline.open-editor', title: '打开大纲编辑', owner: 'pinax.carrier.outline', ownerTitle: '大纲', group: 'carrier', accelerator: '', run: 'pane:outline.editor' }
        ]
      }
    })]])
    const bridge = pageBridge({ workspace: { version: 3, entries: {} }, handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    expect(formOf('outline.widget#1')).toBe('floating')
    expect(wrapper.find('[data-test="command-palette"]').exists()).toBe(false, '面板不该常驻')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))
    await flushPromises()
    const palette = () => wrapper.find('[data-test="command-palette"]')
    expect(palette().exists(), 'Ctrl+P（CmdOrCtrl+P 在非 mac 上就是 Ctrl）必须唤得起面板').toBe(true)
    expect(palette().attributes('role')).toBe('dialog')
    const listedIds = palette().findAll('.nx-palette-item').map((item) => item.attributes('data-palette-id'))
    expect(listedIds).toContain('project.proposals', '表里必须有应用菜单动作')
    expect(listedIds).toContain('outline.open-editor', '表里必须有载体声明的命令（数据源＝command:list，不是面板自己拼的）')
    expect(listedIds.some((id) => String(id).startsWith('page.')), '表里还必须有当前焦点页可用的动作').toBe(true)
    expect(palette().find('[data-palette-id="project.proposals"]').attributes('data-palette-group')).toBe('menu')

    // 子串包含（本批只做这一档）：命中那条留下，其余整体消失。
    await palette().find('[data-test="palette-input"]').setValue('打开大纲')
    expect(palette().findAll('.nx-palette-item').map((item) => item.attributes('data-palette-id'))).toEqual(['outline.open-editor'])
    await palette().find('[data-test="palette-input"]').setValue('不会有的词')
    expect(palette().find('[data-test="palette-empty"]').exists()).toBe(true)
    await palette().find('[data-test="palette-input"]').setValue('打开大纲')

    // Enter＝执行：run 串 `pane:outline.editor` 落到宿主那条唯一的开窗通路（缺省形态仍是页，浮窗一条都不多）。
    palette().find('[data-test="palette-input"]').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(palette().exists()).toBe(false, '执行完就收：面板不该留在页上面')
    expect(formOf('outline.editor#1')).toBe('page')
    expect(hostWorkspace.list().filter((entry) => entry.form === 'floating').map((entry) => entry.instance)).toEqual(['outline.widget#1'])

    // Esc 的双重消费：面板开着时先关面板，叠序最高的那扇浮窗一条都不许动。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))
    await flushPromises()
    palette().find('[data-test="palette-input"]').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(palette().exists()).toBe(false)
    expect(formOf('outline.widget#1')).toBe('floating', '同一次 Esc 不许既关面板又收窗')

    // 面板关了以后，Esc 才回到它原来的那件事：收叠序最高的窗（批次61 语义）。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    wrapper.unmount()
  })

  /**
   * 状态栏（批次63 任务1）。三条判据逐条落在 DOM 上：
   *   · 四要素齐（服务灯／载体·页组／在册窗数／焦点文档字数），读数全从既有事实源现取；
   *   · 不做死按钮（作者裁定③）：整条状态栏只有服务灯那一个 button，点它开的是既有那一节；
   *   · 灯的颜色与未确认条数来自 serviceLogPool 快照（与竖条状态点同一来源，不是第二份账）。
   */
  it('状态栏：四要素读数、唯一可点件点开「服务与通知」，不新增任何动作（批次63 任务1）', async () => {
    const handlers = new Map([[IPC_CHANNELS.runtimeServiceLog, () => ({
      ok: true,
      value: {
        log: {
          at: '2026-11-02T00:00:00.000Z', ackedAt: null, entries: [],
          carriers: [
            { carrierId: 'pinax.carrier.outline', carrierTitle: '大纲', color: 'green', unackedNotices: 0, items: [] },
            { carrierId: 'fixture.novel', carrierTitle: '小说（夹具）', color: 'orange', unackedNotices: 2, items: [] }
          ]
        }
      }
    })]])
    const bridge = pageBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const bar = wrapper.find('[data-test="status-bar"]')
    expect(bar.exists(), '底栏必须常驻（不是悬浮层）').toBe(true)
    expect(bar.attributes('aria-label')).toBe('状态栏')
    // 挂在三栏之后：标题栏 → 三栏 → 状态栏，它是根的最后一段。
    expect(bar.element.previousElementSibling?.classList.contains('next-shell')).toBe(true)

    // ① 服务灯：一盏一载体，颜色与非色读数（标题名＋未确认条数）都在文本里。
    const lights = bar.findAll('.nx-status-light')
    expect(lights).toHaveLength(2)
    expect(lights[1].attributes('data-status')).toBe('orange')
    expect(bar.find('[data-test="status-services"]').text()).toContain('小说（夹具）')
    expect(bar.find('[data-test="status-services"]').text()).toContain('2')

    // ② 载体：开局站在主载体那块板上。
    expect(bar.find('[data-test="status-carrier"]').text()).toContain('小说（夹具）')

    // ③「1＋N 的 N」＝在册窗数：开局只有宿主补出来的那一页，正文自动载入第一章（夹具那份 3 字）。
    expect(bar.find('[data-test="status-windows"]').text()).toContain('1')
    expect(bar.find('[data-test="status-chars"]').text()).toContain('3 字')

    // ④ 焦点跟着走：切出大纲页＝在册两条，字数如实退回破折号（大纲不是可计字的文档）。
    await openOutlineBoard(wrapper)
    expect(bar.find('[data-test="status-windows"]').text()).toContain('2')
    expect(bar.find('[data-test="status-carrier"]').text()).toContain('大纲')
    expect(bar.find('[data-test="status-carrier"]').text()).toContain('主组')
    expect(bar.find('[data-test="status-chars"]').text()).toContain('—')

    // 回到正文那一页，读数又回来——同一个读数源（那一页自己的数据面），不是第二份账。
    await wrapper.find('.nx-page-tab[data-page-instance="novel.editor#1"]').trigger('click')
    await flushPromises()
    expect(bar.find('[data-test="status-carrier"]').text()).toContain('小说（夹具）')
    expect(bar.find('[data-test="status-chars"]').text()).toContain('3 字')

    // 不做死按钮：整条状态栏只有服务灯那一个钮，且它落在共享控件词汇里。
    const buttons = bar.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].classes()).toContain('control-quiet')
    expect(buttons[0].attributes('data-test')).toBe('status-services')

    // 点它＝打开既有的「服务与通知」节（与右栏／竖条状态点同一个落点），不是新动作。
    expect(wrapper.find('.workbench-modal').exists()).toBe(false)
    await buttons[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.workbench-modal').exists(), '状态灯点开的是统一弹窗').toBe(true)
    expect(wrapper.find('[role="tabpanel"][aria-label="服务与通知"]').exists()).toBe(true)
    wrapper.unmount()
  })

  /**
   * 收编b（批次63 任务4①）：菜单里的载体命令不再是「主进程答一声就完事」的假成功。
   * 原生菜单／页内菜单行按下的那条 id 若是载体声明的命令，渲染层要用命令面板同一条执行通路
   * 真的把 run 串跑掉——判据是工作区里确实多出了那一页。
   */
  it('菜单落载体命令＝真执行：走面板同款通路开出那一页，不报「未接线」（批次63 收编b）', async () => {
    const handlers = new Map()
    const bridge = pageBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    expect(hostWorkspace.get('outline.editor#1'), '开局不该已经开着大纲页').toBeFalsy()

    // 事件口径（原生菜单按下的那条路）：id 是载体命令，执行落点仍是渲染层。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'outline.open-editor' })
    await flushPromises()
    expect(formOf('outline.editor#1')).toBe('page')
    expect(wrapper.text()).not.toContain('未接线')

    // 应用菜单那条仍走原来的动作表（不经命令表回落），且不会把两者混起来。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    expect(wrapper.find('[role="tabpanel"][aria-label="偏好与模型"]').exists()).toBe(true)

    // 表里没有的 id：什么都不做（不假装成功，也不误开别人的页）。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'nope.not-a-command' })
    await flushPromises()
    expect(hostWorkspace.list().filter((entry) => entry.pane === 'novel.editor')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('大纲编辑器主体与世界书条目表格（批次28）', () => {
  const OUTLINE_NODES = [
    { id: 'n1', title: '开场：雨夜进城' },
    { id: 'n2', title: '第一折：停摆的表' },
    { id: 'n3', title: '第二折：钟楼' }
  ]
  const OUTLINE_EDGES = [{ from: 'n1', to: 'n2' }]
  const LONG_SUMMARY = '雪夜醒来的主角，袖中有一枚停摆的表，表针在雨夜重新走了起来，她却记不得自己是谁，也记不得这座城。'
  const ENTRIES = [
    { id: 'wb-1', name: '人物·柯秒', type: 'character', cat: '', tags: ['主角'], aliases: ['柯秒'], chars: 18, summary: LONG_SUMMARY, path: '世界书/人物·柯秒.md', revision: 1, contract: true },
    { id: null, name: '随手记', type: 'general', cat: '', tags: [], aliases: [], chars: 9, path: '世界书/随手记.md', revision: 1, contract: false }
  ]
  /** 类别层夹具（批次34）：世界书/ 下一级子目录＝类别，条目 path 带子路径（照大梦真数据结构）。 */
  const CATEGORIZED = [
    { id: 'wb-ch1', name: '编年·停摆的表', type: 'event', cat: '编年', tags: [], aliases: [], chars: 10, summary: '', path: '世界书/编年/编年·停摆的表.md', revision: 1, contract: true },
    { id: 'wb-ch2', name: '编年·雨夜', type: 'event', cat: '编年', tags: [], aliases: [], chars: 12, summary: '', path: '世界书/编年/编年·雨夜.md', revision: 1, contract: true },
    { id: 'wb-1', name: '人物·柯秒', type: 'character', cat: '人物', tags: ['主角'], aliases: ['柯秒'], chars: 18, summary: '', path: '世界书/人物/人物·柯秒.md', revision: 1, contract: true },
    { id: 'wb-p1', name: '地点·槐巷', type: 'location', cat: '人物', tags: [], aliases: ['槐巷'], chars: 20, summary: '', path: '世界书/人物/地点·槐巷.md', revision: 1, contract: true },
    { id: 'wb-s1', name: '设定·钟楼', type: 'setting', cat: '设定', tags: [], aliases: [], chars: 16, summary: '', path: '世界书/设定/设定·钟楼.md', revision: 1, contract: true }
  ]
  /** 工具返回的类别清单（字典序：编年 < 人物 < 设定）。 */
  const CATEGORIES = ['编年', '人物', '设定']

  /** 在 carrierView 上补世界书与大纲两块板（各自的目录窗 pane 前缀决定索引窗画哪棵树）。 */
  function writingView() {
    const base = carrierView()
    const worldbook = {
      id: 'pinax.carrier.worldbook',
      title: '世界书',
      primary: { projectKind: 'generic' },
      isPrimary: false,
      isEnabled: true,
      capabilities: ['setting.entries'],
      requires: [],
      scopes: ['file:世界书:rw', 'agent:ask'],
      dataDirs: ['世界书'],
      settings: [],
      tools: ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'],
      context: { providers: ['worldbook'], budgetChars: 20000 },
      panes: [
        // 批次44：窄栏退成类别导航树、核心区做成看板区（上图表列、下详情）——
        // 形态跟着声明走（view + kind），不再靠 id 前缀回落。
        { slot: 'left-dock', id: 'worldbook.board', title: '世界书板', icon: 'library', view: 'pinax.view.tree', kind: 'entries-categories' },
        { slot: 'center', id: 'worldbook.entries', title: '条目', icon: 'library', view: 'pinax.view.board', kind: 'entries-workspace' }
      ]
    }
    const outline = {
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
        { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list' }
      ]
    }
    return {
      ...base,
      project: { ...base.project, root: 'D:/tmp/大梦' },
      carriers: [...base.carriers, worldbook, outline],
      left: [
        ...base.left,
        { slot: 'left-dock', id: 'worldbook.board', title: '世界书板', icon: 'library', pluginId: 'pinax.carrier.worldbook', pluginTitle: '世界书', view: 'pinax.view.tree', kind: 'entries-categories' },
        { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ],
      center: [
        ...base.center,
        { slot: 'center', id: 'worldbook.entries', title: '条目', icon: 'library', pluginId: 'pinax.carrier.worldbook', pluginTitle: '世界书', view: 'pinax.view.board', kind: 'entries-workspace' },
        { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ]
    }
  }

  const CHAPTERS = [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }]

  function writingBridge({ nodes = OUTLINE_NODES, edges = OUTLINE_EDGES, entries = ENTRIES, categories = [], chapters = CHAPTERS, entryContent = '冷穿越剧版主角，醒来在雪夜。' } = {}) {
    const calls = []
    // 条目夹具是模块级常量：这里拷一份，保存用例改的是这一次挂载自己的账。
    const book = entries.map((item) => ({ ...item }))
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: writingView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        calls.push({ tool: payload.tool, args: payload.args })
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: chapters.length, truncated: false, chapters } } }
        }
        if (payload.tool === 'pinax_chapter_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, chapter: { index: 0, title: '雨夜', file: payload.args.file }, text: '雨夜。', totalChars: 3, truncated: false, revision: 1 } } }
        }
        if (payload.tool === 'pinax_outline_read') {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.outline', payload: { ok: true, source: '大纲/outline.json', nodes, edges, nodeTotal: nodes.length, truncated: false, revision: 1, warning: null } } }
        }
        if (payload.tool === 'pinax_outline_save') {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.outline', payload: { ok: true, file: '大纲/outline.json', revision: 2, nodeTotal: payload.args.nodes?.length ?? 0 } } }
        }
        if (payload.tool === 'pinax_worldbook_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: true, total: book.length, truncated: false, warnings: [], skippedDirs: [], categories: [...categories], projectRoot: 'D:/tmp/大梦', entries: book } } }
        }
        if (payload.tool === 'pinax_worldbook_read') {
          const hit = book.find((item) => (payload.args.path && item.path === payload.args.path) || (item.id && item.id === payload.args.id) || item.name === payload.args.name)
          if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '没有这条' } } }
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: true, entry: { ...hit, keys: hit.aliases, relations: Array.isArray(hit.relations) ? hit.relations : [], content: entryContent, contentChars: entryContent.length, contentTruncated: false }, warnings: [] } } }
        }
        if (payload.tool === 'pinax_worldbook_save') {
          const index = book.findIndex((item) => item.path === payload.args.path)
          if (index < 0) {
            // 新建（批次34）：类别子路径落一条新条目，返回的是带世界书/ 前缀的 path。
            if (payload.args.expectedRevision !== 0) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: '没有这条' } } }
            const file = `世界书/${payload.args.path}`
            const segments = String(payload.args.path).split('/')
            const created = {
              id: null,
              name: segments[segments.length - 1].replace(/\.md$/iu, ''),
              type: 'general',
              cat: segments.length > 1 ? segments[0] : '',
              tags: [],
              aliases: [],
              chars: String(payload.args.text ?? '').length,
              summary: '',
              path: file,
              revision: 1,
              contract: false
            }
            book.push(created)
            if (created.cat && !categories.includes(created.cat)) categories.push(created.cat)
            return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: true, file, revision: 1, created: true } } }
          }
          const hit = book[index]
          const next = { ...hit, revision: hit.revision + 1, content: payload.args.text }
          if (Array.isArray(payload.args.meta?.relations)) next.relations = payload.args.meta.relations.map((relation) => ({ ...relation }))
          book.splice(index, 1, next)
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: true, file: next.path, revision: next.revision, created: false } } }
        }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    return { request, calls }
  }

  async function openBoard(wrapper, label) {
    const rail = wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === label)
    expect(rail, `竖条应有「${label}」这一格`).toBeTruthy()
    await rail.trigger('click')
    await flushPromises()
  }

  it('大纲树按 edges 缩进（不再有「·」记号）；节点操作退到树行右键菜单，编辑面只剩文档', async () => {
    globalThis.localStorage?.clear()
    // 自动保存有 1.5 秒的停手窗口：接管计时器，这一例的保存次数才数得准。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const bridge = writingBridge()
      const wrapper = mount(AppNext, { props: { bridge } })
      await flushPromises()
      await openBoard(wrapper, '大纲')

      const rows = () => wrapper.findAll('.nx-index-window .nx-tree-item')
      expect(rows()).toHaveLength(3)
      expect(rows().map((row) => row.element.style.paddingInlineStart)).toEqual(['10px', '24px', '10px'])
      expect(wrapper.find('.nx-outline-mark').exists()).toBe(false)

      // 点第一行：中栏只剩文档——无框大标题＋无框备注，没有常驻的节点按钮行（P18）。
      await rows()[0].trigger('click')
      await flushPromises()
      const paneNow = () => wrapper.find('[data-pane-id="outline.editor"]')
      expect(paneNow().exists()).toBe(true)
      // 〔批次76 裁定A〕原判据「内容层头部那一行标题＝节点名」改判：那一行撤了；
      // 〔批次76-R2 任务2〕再上移一层——页态不渲染窗头，节点名读自这一页自己的页签。
      expect(paneNow().find('.doc-title').exists()).toBe(false)
      expect(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]').text()).toBe('大纲 · 开场：雨夜进城')
      // 批次43：大纲面默认是阅读态——正文是渲染出来的备注（标题那一行已由批次76 撤走）。
      expect(paneNow().find('[data-test="outline-rendered"]').exists()).toBe(true)
      expect(paneNow().find('.editor-foot').exists()).toBe(false)
      for (const gone of ['.outline-move', '.outline-remove', '.outline-add', '.pane-hint']) {
        expect(paneNow().find(gone).exists(), `${gone} 不该再长在编辑面上`).toBe(false)
      }
      // 批次43：底部那行不再摆「共 N 个节点」这类开发者信息（没有未落盘的改动时整行都不在）。
      expect(paneNow().find('.doc-meta-hint').exists()).toBe(false)

      // 进编辑态：备注是无框的一行文字（textarea.outline-note）。
      await paneNow().find('[data-test="outline-edit"]').trigger('click')
      await flushPromises()
      const note = paneNow().find('[aria-label="大纲节点备注（最多 200 字）"]')
      expect(note.exists()).toBe(true)
      expect(note.attributes('maxlength')).toBe('200')
      expect(note.classes()).toContain('doc-field')

      // 右键第一行＝节点菜单（批次31）：五项都在；首行上移禁用、下移可用；Esc 收起不改任何东西。
      const openMenu = async (row) => {
        row.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 200 }))
        await flushPromises()
        return wrapper.find('.nx-context-menu')
      }
      const menu = await openMenu(rows()[0])
      expect(menu.exists()).toBe(true)
      for (const key of ['outline-node-move-up', 'outline-node-move-down', 'outline-node-remove', 'outline-node-add-sibling', 'outline-node-add-child']) {
        expect(menu.find(`[data-test="${key}"]`).exists(), `节点菜单缺 ${key}`).toBe(true)
      }
      expect(menu.find('[data-test="outline-node-move-up"]').attributes('disabled')).toBeDefined()
      expect(menu.find('[data-test="outline-node-move-down"]').attributes('disabled')).toBeUndefined()
      // 批次59：Esc 归窗口（会收起当前窗），菜单用点外收起。
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await flushPromises()
      expect(wrapper.find('.nx-context-menu').exists()).toBe(false)
      expect(bridge.calls.filter((call) => call.tool === 'pinax_outline_save')).toHaveLength(0)

      // 备注只进草稿；Ctrl+S 才随整份文档走（nodes 透传，不改工具合同）。
      await note.setValue('开场要落一场雨')
      expect(bridge.calls.filter((call) => call.tool === 'pinax_outline_save')).toHaveLength(0)
      await note.trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      const saved = bridge.calls.filter((call) => call.tool === 'pinax_outline_save')
      expect(saved).toHaveLength(1)
      expect(saved[0].args.nodes[0].note).toBe('开场要落一场雨')
      expect(saved[0].args.edges).toEqual(OUTLINE_EDGES)

      // 下移：菜单里点一下，与同深度相邻节点互换（跨层不动），树当场换序；保存载荷跟着变。
      const moveMenu = await openMenu(rows()[0])
      await moveMenu.find('[data-test="outline-node-move-down"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.nx-context-menu').exists()).toBe(false)
      expect(rows().map((row) => row.text())).toEqual(['第二折：钟楼', '第一折：停摆的表', '开场：雨夜进城'])
      await paneNow().find('[aria-label="大纲节点备注（最多 200 字）"]').trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      const moved = bridge.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
      expect(moved.args.nodes.map((node) => node.id)).toEqual(['n3', 'n2', 'n1'])
      expect(moved.args.edges).toEqual(OUTLINE_EDGES)

      // 删除节点：连同它的连线一起从草稿里删掉；树当场少一行。
      // 批次43：换节点＝换文档，编辑态随之收掉（要继续改就先按「编辑」）。
      const removeMenu = await openMenu(rows()[2])
      await removeMenu.find('[data-test="outline-node-remove"]').trigger('click')
      await flushPromises()
      expect(rows()).toHaveLength(2)
      expect(paneNow().find('[data-test="outline-edit"]').exists()).toBe(true)
      await paneNow().find('[data-test="outline-edit"]').trigger('click')
      await flushPromises()
      await paneNow().find('[aria-label="大纲节点备注（最多 200 字）"]').trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      const removed = bridge.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
      expect(removed.args.nodes.map((node) => node.id)).toEqual(['n3', 'n2'])
      expect(removed.args.edges).toEqual([])

      // 「＋」（区标题行，hover 才显形）：在末尾追一个同级节点；同样只进草稿，Ctrl+S 才落盘。
      await wrapper.find('[data-test="outline-append-node"]').trigger('click')
      await flushPromises()
      expect(rows()).toHaveLength(3)
      expect(rows()[2].text()).toBe('未命名节点')
      // 批次43：追加节点＝换节点＝回到阅读态，按「编辑」才拿得到那枚标题输入框。
      await paneNow().find('[data-test="outline-edit"]').trigger('click')
      await flushPromises()
      await paneNow().find('[aria-label="大纲节点标题"]').trigger('keydown', { key: 's', ctrlKey: true })
      await flushPromises()
      const appended = bridge.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
      expect(appended.args.nodes.map((node) => node.title)).toEqual(['第二折：钟楼', '第一折：停摆的表', '未命名节点'])
      expect(appended.args.edges).toEqual([])
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('世界书条目表格：切换控件在看板区头上，表格列齐、截摘要 40 字，行点击与列表同一个 openEntry', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    // 批次44：图表列搬去了核心区的看板区（上图表列、下详情），条目行不再在窄栏里。
    // 窄栏退成类别导航树，所以条目行要在看板区里找。
    expect(wrapper.find('[data-test="entries-board"] .nx-tree-item').exists()).toBe(true)
    expect(wrapper.find('[data-test="entries-table"]').exists()).toBe(false)
    const toggle = wrapper.find('[data-test="entries-view-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('切换为表格视图')
    expect(toggle.text()).toBe('表')

    await toggle.trigger('click')
    await flushPromises()

    const table = wrapper.find('[data-test="entries-table"]')
    expect(table.exists()).toBe(true)
    // 批次34：表格加了一列「类别」（顶层旧项目的条目在这一列是「—」）。
    expect(table.findAll('th').map((th) => th.text())).toEqual(['名称', '类别', '类型', '关键词', '字数', '摘要'])
    const bodyRows = table.findAll('tbody tr')
    expect(bodyRows).toHaveLength(2)
    expect(bodyRows[0].findAll('td').map((td) => td.text())).toEqual([
      '人物·柯秒',
      '—',
      'character',
      '柯秒',
      '18',
      `${LONG_SUMMARY.slice(0, 40)}…`
    ])
    expect(bodyRows[1].text()).toContain('随手记')
    // 表格里不再重复列表那一列版本／未建档脚注（未建档在详情面看）。
    // 批次36：切换钮显示「下一步」——表格视图的下一步是图谱。
    expect(wrapper.find('[data-test="entries-view-toggle"]').attributes('aria-label')).toBe('切换为图谱视图')
    expect(wrapper.find('[data-test="entries-view-toggle"]').text()).toBe('图')

    // 行点击＝打开该条目（与列表同一 openEntry）：走 read、中栏换成条目详情。
    await bodyRows[0].trigger('click')
    await flushPromises()
    const lastRead = bridge.calls.filter((call) => call.tool === 'pinax_worldbook_read').at(-1)
    // 批次34 起按 path 打开（同一名字的条目可以分住两个类别目录，按 path 才不串）。
    expect(lastRead.args).toEqual({ path: '世界书/人物·柯秒.md' })
    expect(wrapper.find('[data-pane-id="worldbook.entries"]').text()).toContain('人物·柯秒')

    // 状态按项目根落 localStorage（照 paneForm 先例）。
    expect(globalThis.localStorage.getItem('entriesView.D:/tmp/大梦')).toBe('table')
    wrapper.unmount()

    // 重新挂载读回同一份选择：还是表格视图。批次36 起切换是三态循环（列表→表格→图谱）：
    // 表格再切是图谱，图谱再切才回列表——三档都落同一个键。
    const again = mount(AppNext, { props: { bridge: writingBridge() } })
    await flushPromises()
    await openBoard(again, '世界书')
    expect(again.find('[data-test="entries-table"]').exists()).toBe(true)
    await again.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    expect(again.find('[data-test="entries-table"]').exists()).toBe(false)
    expect(again.find('[data-test="entries-graph"]').exists()).toBe(true)
    expect(globalThis.localStorage.getItem('entriesView.D:/tmp/大梦')).toBe('graph')
    await again.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    expect(again.find('[data-test="entries-graph"]').exists()).toBe(false)
    expect(again.find('[data-test="entries-board"] .nx-tree-item').exists()).toBe(true)
    expect(globalThis.localStorage.getItem('entriesView.D:/tmp/大梦')).toBe('list')
    again.unmount()
  })

  it('世界书条目表格：没有条目时给一行说明，不摆空表格', async () => {
    globalThis.localStorage?.clear()
    const wrapper = mount(AppNext, { props: { bridge: writingBridge({ entries: [] }) } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="entries-table"]').exists()).toBe(false)
    // 批次59：世界书走 web 模板，没有左树——空态跟着看板区说。
    expect(wrapper.find('[data-test="entries-workspace"]').text()).toContain('这一栏还没有条目。')
    wrapper.unmount()
  })

  /**
   * 批次44 · 蓝色标签那件事（作者 2026-10-31：「你在前端设计了一些蓝色的标签，
   * 看上去能跳转，但是其实不行，非常矛盾」）。
   *
   * 纪律：看着能点就必须点得动。所以：
   *   - 染蓝的词必须**恰好**指向一条条目（指向两条以上的通用词不染蓝）；
   *   - 点蓝链走的是同一个 openEntry，按 path 定位到那一条。
   */
  it('批次44：蓝链只指向唯一一条条目，点它就跳到那一条', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({
      entries: CATEGORIZED,
      categories: [...CATEGORIES],
      entryContent: '他记得那场雨夜，冷穿越剧版主角，醒来在雪夜。'
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    // 打开「人物·柯秒」：正文里有别人的短名「雨夜」（唯一归属 编年·雨夜），
    // 还有自己的标签「主角」（链到自己等于没跳，不该染蓝）。
    const row = wrapper.findAll('[data-test="entries-board"] .nx-tree-item').find((item) => item.text().includes('人物·柯秒'))
    expect(row, '看板区里应有「人物·柯秒」这一行').toBeTruthy()
    await row.trigger('click')
    await flushPromises()

    const rendered = wrapper.find('[data-test="entry-rendered"]')
    expect(rendered.exists()).toBe(true)
    const links = rendered.findAll('.nx-wikilink')
    expect(links.map((link) => link.text())).toEqual(['雨夜'])
    expect(links[0].attributes('data-entry')).toBe('雨夜')
    // 自己的标签留在正文里，不是一条打不开的蓝链。
    expect(rendered.text()).toContain('主角')

    // 点那条蓝链 → 走 openEntry（按 path 定位），详情换成那一条。
    await links[0].trigger('click')
    await flushPromises()
    const read = bridge.calls.filter((call) => call.tool === 'pinax_worldbook_read').at(-1)
    expect(read.args).toEqual({ path: '世界书/编年/编年·雨夜.md' })
    // 〔批次76 裁定A〕原判据「详情面头部 .doc-title＝条目名」改判：那一行撤了；
    // 〔批次76-R2 任务2〕条目名读自这一页自己的页签（页态没有窗头）。详情面从正文第一行开始。
    // 〔批次68-R2 任务二〕再改判：作者口径「条目名＝大标题」（三栏维基阅读版的阅读列首），
    // 页签那一条仍在（两个面不冲突：页签是页的身份，大标题是文档的题）。断言密度只增不减。
    expect(wrapper.find('[data-pane-id="worldbook.entries"] .nx-wiki-title').text()).toBe('编年·雨夜')
    expect(wrapper.find('.nx-page-tab[data-page-instance="worldbook.entries#1"]').text()).toBe('世界书 · 编年·雨夜')
    wrapper.unmount()
  })

  it('批次44：两条共有的词不染蓝（染了也点不动，比不染更坏）', async () => {
    globalThis.localStorage?.clear()
    // 「主角」是两条共用的标签：它指向谁都不成立，正文里就当普通文字。
    const shared = [
      { id: 'wb-1', name: '人物·柯秒', type: 'character', cat: '人物', tags: ['主角'], aliases: ['柯秒'], chars: 18, summary: '', path: '世界书/人物/人物·柯秒.md', revision: 1, contract: true },
      { id: 'wb-ch2', name: '编年·雨夜', type: 'event', cat: '编年', tags: ['主角'], aliases: [], chars: 12, summary: '', path: '世界书/编年/编年·雨夜.md', revision: 1, contract: true }
    ]
    const bridge = writingBridge({
      entries: shared,
      categories: ['编年', '人物'],
      entryContent: '他记得那场雨夜，冷穿越剧版主角，醒来在雪夜。'
    })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    const row = wrapper.findAll('[data-test="entries-board"] .nx-tree-item').find((item) => item.text().includes('人物·柯秒'))
    await row.trigger('click')
    await flushPromises()

    const rendered = wrapper.find('[data-test="entry-rendered"]')
    // 「雨夜」仍是一条唯一入口，链上；「主角」是共有词，不链。
    const links = rendered.findAll('.nx-wikilink')
    expect(links.map((link) => link.text())).toEqual(['雨夜'])
    expect(links.some((link) => link.text() === '主角')).toBe(false)
    expect(rendered.text()).toContain('主角')
    wrapper.unmount()
  })

  /**
   * 批次44 · 排布 → 批次68-R2 · 任务二翻案（工单死口径：「树 : 阅读 : Infobox 起排
   * `260px : 1fr : min(46%,430px)`」，参照作者自有 NovelPedia 版式语言）。
   *
   * 原判据「上图表列、下详情」两段竖排随三栏阅读版退役（断言事实翻案、判定密度只增不减）：
   * 工作区单块交给 EntriesBoard，板内是三栏（树／阅读／信息卡），信息卡可一钮收起。
   */
  it('批次68-R2：世界书三栏维基阅读版——树260px、阅读1fr、信息卡min(46%,430px)，可收起', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ entries: CATEGORIZED, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    const workspace = wrapper.find('[data-pane-id="worldbook.entries"] .nx-entries-workspace')
    expect(workspace.exists(), '核心区该有一块世界书工作区').toBe(true)

    const cols = wrapper.find('[data-test="entries-wiki-cols"]')
    expect(cols.exists(), '看板区里该有且只有一块三栏排版').toBe(true)
    const children = [...cols.element.children]
    expect(children.map((node) => node.className), '三栏顺序：树、阅读、信息卡').toEqual([
      'nx-wiki-tree',
      'nx-wiki-center',
      'nx-wiki-infobox'
    ])

    // 死口径在声明层核对归 visual-contract.test.mjs（node 轨才有真文件系统读数）；
    // jsdom 这条链只核 DOM 结构：三栏在场、顺序与收起钮语义。

    // 切换控件仍在看板区里（[data-test="entries-board"] 锚点一字未动）。
    expect(wrapper.find('[data-test="entries-board"] [data-test="entries-view-toggle"]').exists()).toBe(true)

    // 批次59 铁律四：世界书是 web 模板，没有左树；类别导航树随左栏一起退场。
    expect(wrapper.find('.nx-index-window').exists()).toBe(false)
    expect(wrapper.find('[data-test="entry-category-tree"]').exists()).toBe(false)
    // 列表态：中栏是阅读列——表格与整书图谱都不在场（信息卡缩览另挂自己的锚点）。
    expect(wrapper.find('[data-test="entries-table"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="entries-graph"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="entries-infobox-graph"]').exists(), '信息卡底部该有图谱缩览').toBe(true)

    // 阅读列的 wiki 皮：条目名＝大标题（doc-title 族，展示体白名单内），正文容器挂 nx-wiki-article。
    const title = wrapper.find('[data-test="entry-wiki-title"]')
    expect(title.exists(), '阅读列首该有条目大标题').toBe(true)
    expect(title.classes()).toContain('doc-title')
    expect(wrapper.find('[data-test="entry-rendered"]').classes()).toContain('nx-wiki-article')

    // 树行的层级 dot：统计口径（被引用次数），title 里写明「按被引用次数统计」。
    const dot = wrapper.find('[data-test="entries-tree-col"] .nx-wiki-lvl-dot')
    expect(dot.exists(), '树行前缀该有层级 dot').toBe(true)
    expect(dot.attributes('title')).toContain('按被引用次数统计')

    // 信息卡收起／展开一钮：收起后阅读列吃满（is-infobox-collapsed），只剩展开钮。
    await wrapper.find('[data-test="entries-infobox-collapse"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="entries-wiki-cols"]').classes()).toContain('is-infobox-collapsed')
    expect(wrapper.find('[data-test="entries-infobox-expand"]').exists()).toBe(true)
    await wrapper.find('[data-test="entries-infobox-expand"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="entries-infobox-collapse"]').exists()).toBe(true)

    // 类别筛选与看板区共用 entriesFilterCat 一格：下拉一选，行数跟着变。
    await wrapper.find('[data-test="entries-filter-category"]').setValue('编年')
    await flushPromises()
    expect(wrapper.findAll('[data-test="entries-board"] .nx-tree-item')).toHaveLength(2)
    wrapper.unmount()
  })

  it('世界书关系边编辑（批次28 · 工单2b）：行编辑随 meta.relations 落盘，阅读态按「目标 · 类型 · 立场」显示', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    const paneNow = () => wrapper.find('[data-pane-id="worldbook.entries"]')
    // 批次44：条目行搬进了核心区的看板区，窄栏只剩类别导航树——点条目要点看板区那一行。
    await wrapper.findAll('[data-test="entries-board"] .nx-tree-item')[0].trigger('click')
    await flushPromises()
    expect(paneNow().find('[data-test="entry-relations-read"]').exists()).toBe(false, '没有关系就不摆这块')

    await paneNow().find('.entry-edit').trigger('click')
    await flushPromises()
    // 批次31（P18）：元数据默认折叠在一行「条目信息」里，点开才轮到关系区。
    expect(paneNow().find('[data-test="entry-relations"]').exists()).toBe(false)
    await paneNow().find('[data-test="entry-meta-toggle"]').trigger('click')
    await flushPromises()
    const relations = paneNow().find('[data-test="entry-relations"]')
    expect(relations.exists()).toBe(true)
    expect(relations.findAll('.entry-relation-row')).toHaveLength(0)
    expect(relations.find('.entry-relation-add').text()).toBe('加一条关系')
    // 目标输入的候选来自当前条目清单（datalist），不新增工具调用。
    expect(relations.find('datalist option').attributes('value')).toBe('人物·柯秒')

    await relations.find('.entry-relation-add').trigger('click')
    await flushPromises()
    expect(paneNow().findAll('.entry-relation-row')).toHaveLength(1)
    await paneNow().find('[aria-label="关系目标"]').setValue('地点·槐巷')
    await paneNow().find('[aria-label="关系类型"]').setValue('师徒')
    await paneNow().find('[aria-label="关系立场"]').setValue('护着')
    await paneNow().find('.entry-relation-covert input[type="checkbox"]').setValue(true)

    await paneNow().find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const saved = bridge.calls.filter((call) => call.tool === 'pinax_worldbook_save').at(-1)
    expect(saved.args.meta.relations).toEqual([{ to: '地点·槐巷', type: '师徒', stance: '护着', covert: true }])

    // 阅读态：目标 · 类型 · 立场（三栏都有就三栏都显示）。
    const read = paneNow().find('[data-test="entry-relations-read"]')
    expect(read.exists()).toBe(true)
    expect(read.findAll('li').map((li) => li.text())).toEqual(['地点·槐巷 · 师徒 · 护着'])

    // 删行：草稿里那条没了，保存时 relations 传空数组（＝清空）。
    // 再进编辑态：折叠层重新收起（P18：每次进来先看正文），展开才删行。
    await paneNow().find('.entry-edit').trigger('click')
    await flushPromises()
    expect(paneNow().find('[data-test="entry-relations"]').exists()).toBe(false)
    await paneNow().find('[data-test="entry-meta-toggle"]').trigger('click')
    await flushPromises()
    await paneNow().find('.entry-relation-remove').trigger('click')
    await flushPromises()
    expect(paneNow().find('.entry-relation-row').exists()).toBe(false)
    await paneNow().find('.editor-area').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const cleared = bridge.calls.filter((call) => call.tool === 'pinax_worldbook_save').at(-1)
    expect(cleared.args.meta.relations).toEqual([])
    expect(paneNow().find('[data-test="entry-relations-read"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('世界书类别层（批次34）：列表按类别分组（三组＋行数），表格有类别列，类别筛选下拉＝既有类别', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ entries: CATEGORIZED, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    // 列表视图：每组一个小节头（人物／编年／设定按工具给的顺序），组内是原来的条目行。
    // 批次44：这些组头与条目行搬进了核心区的看板区，窄栏只剩类别导航树。
    const sections = wrapper.findAll('[data-test="entries-board"] [data-test="entry-category"]')
    expect(sections.map((node) => node.text())).toEqual(CATEGORIES)
    const lists = wrapper.findAll('[data-test="entries-board"] .nx-tree')
    expect(lists.map((list) => list.findAll('.nx-tree-item').length)).toEqual([2, 2, 1])
    expect(wrapper.find('[data-test="entries-board"]').text()).not.toContain('未分类')

    // 表格视图：多一列「类别」，值来自条目的 cat；批次36 起表格按类别分组（组头带条数）。
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    const table = wrapper.find('[data-test="entries-table"]')
    expect(table.findAll('th').map((th) => th.text())).toEqual(['名称', '类别', '类型', '关键词', '字数', '摘要'])
    const groupRows = table.findAll('[data-test="entries-table-group"]')
    expect(groupRows.map((row) => row.text())).toEqual(['编年 · 2 条', '人物 · 2 条', '设定 · 1 条'])
    // 表格按工具给的顺序列条目（组头行不是数据行）。
    expect(table.findAll('tbody tr.nx-entries-row').map((row) => row.findAll('td')[1].text())).toEqual(CATEGORIZED.map((entry) => entry.cat))

    // 批次59：新建入口原先长在左树区头；web 模板没有左树，这一批随左栏退场（批次60 在看板区重建）。
    // 批次36：表格再切是图谱（节点都在），图谱再切才回列表。
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="entries-graph"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="entries-graph"]').findAll('.nx-entry-graph-node')).toHaveLength(CATEGORIZED.length)
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()

    // 类别筛选下拉仍是既有类别（与看板共用 entriesFilterCat 一格）。
    const filter = wrapper.find('[data-test="entries-filter-category"]')
    expect(filter.findAll('option').map((option) => option.text())).toEqual(['全部类别', ...CATEGORIES])
    await filter.setValue('设定')
    await flushPromises()
    expect(wrapper.findAll('[data-test="entries-board"] .nx-tree-item')).toHaveLength(1)
    await filter.setValue('')
    await flushPromises()
    expect(wrapper.findAll('[data-test="entries-board"] .nx-tree-item')).toHaveLength(CATEGORIZED.length)
    wrapper.unmount()
  })

  // —— 批次36：Dataview 式表格（排序／筛选）与知识图谱 ——————————————————————————

  it('世界书条目表格（批次36）：列头三态排序（升→降→默认），排序在组内生效、组头顺序不动', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ entries: CATEGORIZED, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()

    const names = () => wrapper.findAll('[data-test="entries-table"] tbody tr.nx-entries-row').map((row) => row.findAll('td')[0].text())
    const header = wrapper.find('[data-test="entries-sort-chars"]')
    expect(header.text()).toBe('字数', '默认不排序，列头没有指示符')
    expect(names()).toEqual(CATEGORIZED.map((entry) => entry.name))

    // 升序：组头仍是 编年/人物/设定，组内按字数 10,12／18,20／16 摆。
    await header.trigger('click')
    await flushPromises()
    expect(header.text()).toBe('字数▲')
    expect(names()).toEqual(['编年·停摆的表', '编年·雨夜', '人物·柯秒', '地点·槐巷', '设定·钟楼'])

    // 降序：组内倒过来，组头顺序不动。
    await header.trigger('click')
    await flushPromises()
    expect(header.text()).toBe('字数▼')
    expect(names()).toEqual(['编年·雨夜', '编年·停摆的表', '地点·槐巷', '人物·柯秒', '设定·钟楼'])

    // 第三下回默认：指示符消失，顺序回到工具给的。
    await header.trigger('click')
    await flushPromises()
    expect(header.text()).toBe('字数')
    expect(names()).toEqual(CATEGORIZED.map((entry) => entry.name))
    wrapper.unmount()
  })

  it('世界书条目表格（批次36）：筛选输入与类别下拉过滤行数，两者叠加；组头跟着只剩命中的组', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ entries: CATEGORIZED, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()

    const dataRows = () => wrapper.findAll('[data-test="entries-table"] tbody tr.nx-entries-row')
    const groupLabels = () => wrapper.findAll('[data-test="entries-table-group"]').map((row) => row.text())

    // 文本筛选命中名称，也命中关键词（槐巷是地点·槐巷的 aliases）与摘要。
    await wrapper.find('[data-test="entries-filter-input"]').setValue('柯秒')
    await flushPromises()
    expect(dataRows()).toHaveLength(1)
    expect(dataRows()[0].text()).toContain('人物·柯秒')
    await wrapper.find('[data-test="entries-filter-input"]').setValue('槐巷')
    await flushPromises()
    expect(dataRows()).toHaveLength(1)
    expect(dataRows()[0].text()).toContain('地点·槐巷')
    await wrapper.find('[data-test="entries-filter-input"]').setValue('查无此条')
    await flushPromises()
    expect(dataRows()).toHaveLength(0)
    expect(wrapper.find('[data-test="entries-table-group"]').exists()).toBe(false)

    // 清空文本回全量；类别下拉只留该组。
    await wrapper.find('[data-test="entries-filter-input"]').setValue('')
    await flushPromises()
    expect(dataRows()).toHaveLength(5)
    await wrapper.find('[data-test="entries-filter-category"]').setValue('编年')
    await flushPromises()
    expect(dataRows()).toHaveLength(2)
    expect(dataRows().every((row) => row.findAll('td')[1].text() === '编年')).toBe(true)
    expect(groupLabels()).toEqual(['编年 · 2 条'])

    // 叠加：类别编年 ＋ 文本雨夜＝1 行；换成设定后一条都不剩。
    await wrapper.find('[data-test="entries-filter-input"]').setValue('雨夜')
    await flushPromises()
    expect(dataRows()).toHaveLength(1)
    await wrapper.find('[data-test="entries-filter-category"]').setValue('设定')
    await flushPromises()
    expect(dataRows()).toHaveLength(0)
    wrapper.unmount()
  })

  it('世界书知识图谱（批次36）：SVG 在场、节点数＝条目数、hover 高亮邻边、点节点与列表同一个 openEntry、未落图如实计数', async () => {
    globalThis.localStorage?.clear()
    // 钟楼被两条编年引用（跨类边），另有一条边指向不存在的条目（如实计数，不画幽灵节点）。
    const withRelations = CATEGORIZED.map((entry, index) => ({
      ...entry,
      relations: index === 0
        ? [{ to: '设定·钟楼', type: '见证' }, { to: '查无此条', type: '悬空' }]
        : index === 1 ? [{ to: '设定·钟楼' }] : []
    }))
    const bridge = writingBridge({ entries: withRelations, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')
    // 列表 → 表格 → 图谱（三态循环两步）。
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()

    const graph = wrapper.find('[data-test="entries-graph"]')
    expect(graph.exists()).toBe(true)
    expect(graph.find('svg').exists()).toBe(true)
    expect(graph.findAll('.nx-entry-graph-node')).toHaveLength(withRelations.length, '每个条目一个节点，没有幽灵节点')
    expect(graph.findAll('.nx-entry-graph-edge')).toHaveLength(2, '跨类边落图（无向去重）')
    // 〔批次76 任务4-6〕有边的图不贴那句「还没有登记关系」（同一条文案不许在两种事实下都出现）。
    expect(wrapper.find('[data-test="entries-graph-no-relations"]').exists()).toBe(false)

    // 图例：三个类别各一枚色样；未落图的边如实计数。
    const legend = wrapper.find('[data-test="entries-graph-legend"]')
    expect(legend.exists()).toBe(true)
    expect(legend.findAll('.nx-entry-graph-legend-item').map((item) => item.text())).toEqual(['编年', '人物', '设定'])
    expect(wrapper.find('[data-test="entries-graph-unmatched"]').text()).toBe('1 条关系边未落图（目标不存在）')

    // hover 高亮邻边：停摆的表只连钟楼一条，其余压暗（柯秒没有关系边，悬停不高亮任何一条）。
    const node = graph.findAll('.nx-entry-graph-node').find((candidate) => candidate.text() === '编年·停摆的表')
    expect(node, '图谱里应有「编年·停摆的表」这个节点').toBeTruthy()
    await node.trigger('mouseenter')
    await flushPromises()
    expect(graph.findAll('.nx-entry-graph-edge.is-hi')).toHaveLength(1)
    expect(graph.findAll('.nx-entry-graph-edge.is-dim')).toHaveLength(1)
    await node.trigger('mouseleave')
    await flushPromises()
    expect(graph.findAll('.nx-entry-graph-edge.is-hi')).toHaveLength(0)

    // 点节点打开条目：与列表／表格同一个 openEntry（按 path）。
    await node.trigger('click')
    await flushPromises()
    const lastRead = bridge.calls.filter((call) => call.tool === 'pinax_worldbook_read').at(-1)
    expect(lastRead.args).toEqual({ path: '世界书/编年/编年·停摆的表.md' })
    expect(wrapper.find('[data-pane-id="worldbook.entries"]').text()).toContain('编年·停摆的表')
    wrapper.unmount()
  })

  it('世界书知识图谱（批次36）：没有关系也没有崩——节点都在、图例只有类别、没有未落图计数', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ entries: CATEGORIZED, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()

    const graph = wrapper.find('[data-test="entries-graph"]')
    expect(graph.findAll('.nx-entry-graph-node')).toHaveLength(CATEGORIZED.length)
    expect(graph.findAll('.nx-entry-graph-edge')).toHaveLength(0)
    expect(wrapper.find('[data-test="entries-graph-unmatched"]').exists()).toBe(false, '没有未落图的边就不摆这行计数')
    // 〔批次76 任务4-6〕0 边不再静默画一圈散点：图上角落要出一句人话。
    // 判据本身不动（边仍只认 relations[].to）——《大梦》13 条全是 relations: []，作者原来看不到任何解释。
    expect(wrapper.find('[data-test="entries-graph-no-relations"]').text()).toBe('这些条目之间还没有登记关系。')
    // 关系富集读失败的条目在索引窗的 warning 里可见（图谱少边时作者看得到原因）。
    expect(wrapper.find('.nx-index-warn').exists()).toBe(false)
    wrapper.unmount()
  })

  it('章节标题不带排序前缀（批次34）：行＝「倒带」，原名只留在行的 title 提示里', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ chapters: [{ index: 0, title: '倒带', file: '正文/003-倒带.md', name: '003-倒带.md', revision: 1 }] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    const row = wrapper.find('.nx-index-window .nx-tree-item')
    expect(row.exists()).toBe(true)
    expect(row.text()).toBe('倒带')
    expect(row.text()).not.toMatch(/^\d+-/u)
    // file 仍是原名：读写定位与排序靠它，只有 title 被剥了前缀。
    expect(row.attributes('title')).toContain('正文/003-倒带.md')
    wrapper.unmount()
  })
})

describe('大纲转换（批次30）', () => {
  /** 在 carrierView 上补一块大纲载体（左树／中栏），用于打开大纲栏看空态指引。 */
  function outlineView() {
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
        { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list' }
      ]
    }
    return {
      ...base,
      carriers: [...base.carriers, outlineCarrier],
      left: [...base.left, { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }],
      center: [...base.center, { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }]
    }
  }

  function outlineBridge({ handlers = new Map(), nodes = [] } = {}) {
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: outlineView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.runtimeToolCall && payload?.tool === 'pinax_outline_read') {
        return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.outline', payload: { ok: true, source: '大纲/outline.json', nodes, edges: [], nodeTotal: nodes.length, truncated: false, revision: 1, warning: null } } }
      }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    const onEvent = (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }
    return { request, onEvent }
  }

  const SCAN = {
    dryRun: true,
    files: 1,
    chapters: 2,
    imported: 2,
    reused: 0,
    revision: 0,
    nodeTotal: 2,
    items: [
      { title: '第一章《牛肉汤》', source: '大纲/001-004.md#第一章《牛肉汤》', status: 'imported', id: 'imp-1' },
      { title: '第二章《延迟》', source: '大纲/001-004.md#第二章《延迟》', status: 'imported', id: 'imp-2' }
    ],
    warnings: []
  }
  const APPLIED = { ...SCAN, dryRun: false, revision: 1, file: '大纲/outline.json' }

  it('转换节挂载即扫描（dryRun）→「转换并导入」落盘（dryRun:false）→ 结果逐条渲染并刷新外壳', async () => {
    const handlers = new Map()
    const calls = []
    handlers.set(IPC_CHANNELS.outlineImport, vi.fn(async (payload) => {
      calls.push(payload)
      return { ok: true, value: payload?.dryRun === false ? APPLIED : SCAN }
    }))
    const bridge = outlineBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 统一二级页的「文档 → 大纲转换」节。
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    const tab = wrapper.find('[data-test="settings-tab-outline-import"]')
    expect(tab.exists()).toBe(true)
    await tab.trigger('click')
    await flushPromises()

    const panel = wrapper.find('[aria-label="大纲转换"]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('tabpanel')
    // 挂载即扫描：dryRun:true 只读，不写盘。
    expect(calls[0]).toEqual({ dryRun: true })
    expect(panel.find('[data-test="outline-scan"]').text()).toContain('1 份 md · 2 个章节标题（待追加 2 章，复用 0 章）')

    const viewCallsBefore = bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length
    await panel.find('[data-test="outline-apply"]').trigger('click')
    await flushPromises()
    expect(calls.at(-1)).toEqual({ dryRun: false })
    expect(panel.find('[data-test="outline-done"]').text()).toContain('导入 2 章 / 复用 0 章')
    // 结果逐条：每章一行，状态是导入/复用。
    expect(panel.findAll('[data-test="outline-items"] li').map((node) => node.text()))
      .toEqual(['导入 · 第一章《牛肉汤》', '导入 · 第二章《延迟》'])
    // 成功后走既有刷新路径（emit changed → AppNext.refresh），不是事件总线。
    expect(bridge.request.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.view).length).toBeGreaterThan(viewCallsBefore)
    // 同一项目没换根，refresh 的 projectRoot 监听不会触发——转换后必须显式重列大纲树，左树才立刻长出节点。
    expect(bridge.request.mock.calls.some(([channel, payload]) => channel === IPC_CHANNELS.runtimeToolCall && payload?.tool === 'pinax_outline_read')).toBe(true)
    wrapper.unmount()
  })

  it('批次37：outline-changed 事件让本节自动重扫（dryRun），其它类别不动；离开设置后退订', async () => {
    const handlers = new Map()
    const calls = []
    handlers.set(IPC_CHANNELS.outlineImport, vi.fn(async (payload) => {
      calls.push(payload)
      return { ok: true, value: SCAN }
    }))
    const bridge = outlineBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    await wrapper.find('[data-test="settings-tab-outline-import"]').trigger('click')
    await flushPromises()

    const emit = handlers.get(IPC_EVENT.projectEvent)
    expect(typeof emit).toBe('function')
    const before = calls.length

    // 正文变了与本节无关：不重扫。
    emit({ kind: 'manuscript-changed', at: '2026-10-30T00:00:00.000Z' })
    await flushPromises()
    expect(calls.length).toBe(before)

    // 大纲目录变了（别处改/导入）：自动重扫一次，仍只读。
    emit({ kind: 'outline-changed', at: '2026-10-30T00:00:01.000Z' })
    await flushPromises()
    expect(calls.length).toBe(before + 1)
    expect(calls.at(-1)).toEqual({ dryRun: true })
    expect(wrapper.find('[aria-label="大纲转换"] [data-test="outline-scan"]').text()).toContain('2 个章节标题')

    wrapper.unmount()
    // 卸载后退订：事件表里已没有监听者（直接调上面捕获的旧函数不算，它绕过桥）。
    expect(handlers.has(IPC_EVENT.projectEvent)).toBe(false)
    await flushPromises()
    expect(calls.length).toBe(before + 1)
  })

  it('冲突与空目录如实摊开：STALE_REVISION 的 code 与 message 都显示，不假装成功', async () => {
    const handlers = new Map()
    handlers.set(IPC_CHANNELS.outlineImport, vi.fn(async () => ({
      ok: false,
      error: { code: 'PINAX_STALE_REVISION', message: '「大纲/outline.json」已被改动（第 2 版），本次基于第 1 版的写入被拒绝' }
    })))
    const bridge = outlineBridge({ handlers })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    handlers.get(IPC_EVENT.menuInvoked)({ id: 'settings.preferences' })
    await flushPromises()
    await wrapper.find('[data-test="settings-tab-outline-import"]').trigger('click')
    await flushPromises()

    const panel = wrapper.find('[aria-label="大纲转换"]')
    const failure = panel.find('[data-test="outline-error"]')
    expect(failure.exists()).toBe(true)
    expect(failure.text()).toContain('PINAX_STALE_REVISION')
    expect(failure.text()).toContain('已被改动')
    expect(panel.find('[data-test="outline-done"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('大纲空态一句话＋新建钮；转换指引收进 title（〔68-R3 指南层〕常驻版面不再摆第二句机制文案）', async () => {
    const bridge = outlineBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    const rail = wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === '大纲')
    expect(rail, '竖条应有大纲栏').toBeTruthy()
    await rail.trigger('click')
    await flushPromises()

    const hint = wrapper.find('[data-test="outline-import-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('大纲还没有内容')
    expect(hint.text(), '路径／转换入口不再上常驻版面').not.toContain('outline.json')
    expect(hint.attributes('title')).toContain('设置 → 大纲转换')
    expect(hint.find('button').text()).toBe('新建大纲')
    wrapper.unmount()
  })
})

/**
 * 故障隔离（批次63 任务2 · 框架规范 §9.3「单个载体失效不许拖垮宿主」的 UI 那一半）。
 *
 * 此前只写过内核侧的隔离，这一节补的是最狠的那一档：**把全部载体都停掉**。
 * 判据三条，全是对着作者的日常说的：
 *   1. 外壳不许白屏——三栏、右栏、状态栏照旧在，中栏给的是「没有已启用的载体」那句人话；
 *   2. 竖条照旧画出来（哪怕一块板都没有）：它是宿主的地盘，不是载体的延伸；
 *   3. 命令面照旧可用：Ctrl+P 唤得起、列得出应用菜单动作、Enter 真的执行得掉——
 *      「先命令面板把载体重新启用，再回去设置」这条路不能被自己的故障堵死。
 */
describe('故障隔离：全部载体停用（批次63 任务2）', () => {
  afterEach(() => {
    resetWorkspace()
    globalThis.localStorage?.clear()
  })

  /** 停用了全部载体的视图：清单还在（设置页要能把它们重新打开），槽位一个都不出。 */
  function disabledView() {
    const base = carrierView()
    return {
      ...base,
      carriers: base.carriers.map((carrier) => ({ ...carrier, isEnabled: false })),
      left: [],
      center: [],
      primary: null
    }
  }

  function disabledBridge() {
    const handlers = new Map([
      [IPC_CHANNELS.commandList, () => ({
        ok: true,
        value: {
          total: 2,
          commands: [
            { id: 'settings.carriers', title: '载体管理…', owner: 'app.menu', ownerTitle: '应用菜单', group: 'menu', accelerator: '', run: 'menu:settings.carriers' },
            { id: 'settings.preferences', title: '偏好与模型…', owner: 'app.menu', ownerTitle: '应用菜单', group: 'menu', accelerator: '', run: 'menu:settings.preferences' }
          ]
        }
      })],
      [IPC_CHANNELS.menuInvoke, () => ({ ok: true, value: { handled: true } })]
    ])
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: disabledView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.workspaceLoad) return { ok: true, value: { version: 3, entries: {}, active: null, focus: null } }
      if (channel === IPC_CHANNELS.workspaceSave) return { ok: true, value: { version: 3, entries: {} } }
      const handler = handlers.get(channel)
      if (handler) return handler(payload)
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    return { request, onEvent: (channel, handler) => { handlers.set(channel, handler); return () => handlers.delete(channel) }, channels: IPC_CHANNELS, handlers }
  }

  it('一块板都没有：三栏不塌、竖条不没、话要说得出来，状态栏照旧报数', async () => {
    const bridge = disabledBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    // 不白屏：骨架四件俱全。
    expect(wrapper.find('.nx-ribbon').exists(), '竖条是宿主的，不随载体消失').toBe(true)
    expect(wrapper.find('.nx-index-window').exists()).toBe(true)
    expect(wrapper.find('.col-center').exists()).toBe(true)
    expect(wrapper.find('.col-dock').exists(), '右栏运行时是公共池，与载体停用无关').toBe(true)
    // 竖条上没有载体格（一块都没启用），但底部那枚主题钮还在——整条没被清空。
    expect(wrapper.findAll('.nx-ribbon-item')).toHaveLength(1)
    expect(wrapper.find('.nx-ribbon-item.is-bottom').exists()).toBe(true)
    // 空态要说话，不是留一片白。
    expect(wrapper.text()).toContain('当前没有已启用的载体板块')

    // 状态栏照常挂载并报数：没有板就没有载体名，窗数为 0，字数留破折号。
    const bar = wrapper.find('[data-test="status-bar"]')
    expect(bar.exists(), '状态栏不依赖任何载体').toBe(true)
    expect(bar.find('[data-test="status-carrier"]').text()).toContain('—')
    expect(bar.find('[data-test="status-windows"]').text()).toContain('0')
    expect(bar.find('[data-test="status-chars"]').text()).toContain('—')
    wrapper.unmount()
  })

  it('命令面板照旧唤得起、列得出应用菜单动作、Enter 执行得掉（自救这条路不能堵）', async () => {
    const bridge = disabledBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))
    await flushPromises()
    const palette = wrapper.find('[data-test="command-palette"]')
    expect(palette.exists(), '全部载体停用后 Ctrl+P 仍要唤得起面板').toBe(true)
    const listed = palette.findAll('.nx-palette-item').map((item) => item.attributes('data-palette-id'))
    // 记账指标（不进闸）：此刻面板里剩的就是应用菜单那份——载体一条都不该在。
    expect(listed).toEqual(['settings.carriers', 'settings.preferences'])

    // 选「载体管理…」（重新启用载体的那一节），Enter 真的把它开出来。
    await palette.find('[data-test="palette-input"]').setValue('载体管理')
    expect(palette.findAll('.nx-palette-item').map((item) => item.attributes('data-palette-id'))).toEqual(['settings.carriers'])
    palette.find('[data-test="palette-input"]').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.find('[data-test="command-palette"]').exists(), '执行完就收面板').toBe(false)
    expect(wrapper.find('[aria-label="载体管理"]').exists(), '应用菜单动作必须真执行：这里就是打开载体管理节').toBe(true)
    expect(wrapper.text()).not.toContain('未接线')
    wrapper.unmount()
  })
})
