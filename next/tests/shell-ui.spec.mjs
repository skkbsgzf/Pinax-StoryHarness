import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import ActivityRail from '../shell/ActivityRail.vue'
import RuntimeDock from '../shell/RuntimeDock.vue'
import CenterSlotHost from '../shell/CenterSlotHost.vue'
import { IPC_CHANNELS, IPC_EVENT, IPC_PUSH } from '../shell/ipcContract.mjs'
import { hostWorkspace, resetWorkspace } from '../shell/workspace.mjs'
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

    // 渲染层的外呼只有这几条：view（读视图）、偏好（D2 主题迁移/持久化）、
    // 以及 M2.5-C 的工作区四轴（workspaceLoad／workspaceSave 是唯一落盘点，坐标与形态都走它）。
    // 它拿不到内核实现，也就没有旁路写盘的可能。
    const allowedCalls = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet, IPC_CHANNELS.workspaceLoad, IPC_CHANNELS.workspaceSave]
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
    // 工作区通道（M2.5-C）随挂载就会走一次读：那是宿主状态，不是项目写入。
    const allowedCalls = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet, IPC_CHANNELS.workspaceLoad, IPC_CHANNELS.workspaceSave]
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

  /**
   * 工作区存档：缺省给一份空的 `{ version, entries }`，调用方传同一个对象即可跨挂载读回。
   * save 落在同一个对象上（主进程那份 .pinax/workspace.json 的替身），用例直接读 entries 断言。
   */
  function overlayBridge({ handlers = new Map(), nodes = OUTLINE_NODES, workspace = { version: 1, entries: {} } } = {}) {
    const calls = []
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: overlayView() }
      if (channel === IPC_CHANNELS.workspaceLoad) return { ok: true, value: { version: workspace.version ?? 1, entries: workspace.entries ?? {} } }
      if (channel === IPC_CHANNELS.workspaceSave) {
        workspace.version = payload?.snapshot?.version ?? 1
        workspace.entries = payload?.snapshot?.entries ?? {}
        return { ok: true, value: { version: workspace.version, entries: workspace.entries } }
      }
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

  it('位置记忆：拖动写进工作区存档的 outline.widget#1，重新挂载读回同一坐标', async () => {
    globalThis.localStorage?.clear()
    const workspace = { version: 1, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: overlayBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    const head = wrapper.find('.nx-overlay-head').element
    head.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 130, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 130, bubbles: true }))
    await flushPromises()

    // 坐标不再进 localStorage：落在工作区四轴的 geometry（M2.5-C）。
    expect(globalThis.localStorage.getItem('overlay.outline.widget')).toBe(null)
    expect(workspace.entries['outline.widget#1'].geometry).toMatchObject({ x: 40, y: 30, snap: null })
    expect(workspace.entries['outline.widget#1'].placement).toBe('overlay')
    expect(wrapper.find('.nx-overlay-widget').attributes('style')).toContain('left: 40px')
    wrapper.unmount()

    // 重新挂载＝从同一份存档读回形态与位置（浮窗仍然开着）。
    const second = mount(AppNext, { props: { bridge: overlayBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(second)
    if (!second.find('.nx-overlay-widget').exists()) await openWidget(second)
    const style = second.find('.nx-overlay-widget').attributes('style')
    expect(style).toContain('left: 40px')
    expect(style).toContain('top: 30px')
    second.unmount()
    globalThis.localStorage?.clear()
  })

  it('缩成气泡球：卡片退场、气泡留在原坐标；点气泡展开回原位置（最小化不啃 geometry）', async () => {
    globalThis.localStorage?.clear()
    const workspace = { version: 1, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: overlayBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    // 先把它拖到一个可辨认的位置。
    const head = wrapper.find('.nx-overlay-head').element
    head.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 260, clientY: 190, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 260, clientY: 190, bubbles: true }))
    await flushPromises()
    expect(workspace.entries['outline.widget#1'].geometry).toMatchObject({ x: 160, y: 90 })

    // 缩成气泡球：同一实例 placement 仍是 overlay，只换 minimized 这一轴。
    await wrapper.find('[aria-label="缩成气泡球"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(false)
    const bubble = wrapper.find('.nx-overlay-bubble')
    expect(bubble.exists()).toBe(true)
    expect(bubble.attributes('data-overlay-instance')).toBe('outline.widget#1')
    expect(bubble.attributes('data-minimized')).toBe('bubble')
    expect(hostWorkspace.get('outline.widget#1').minimized).toBe('bubble')
    expect(hostWorkspace.get('outline.widget#1').placement).toBe('overlay')
    // 气泡保留坐标（气泡球出现在原处，而不是弹回右上角默认位）。
    expect(bubble.attributes('style')).toContain('left: 160px')

    // 点气泡展开：回到卡片，位置没被最小化这一轴啃掉。
    await bubble.trigger('click')
    await flushPromises()
    const card = wrapper.find('.nx-overlay-widget')
    expect(card.exists()).toBe(true)
    expect(card.attributes('style')).toContain('left: 160px')
    expect(card.attributes('style')).toContain('top: 90px')
    expect(hostWorkspace.get('outline.widget#1').minimized).toBe('none')
    wrapper.unmount()
    globalThis.localStorage?.clear()
  })

  it('同一 pane 开两份（+1）：实例 id 是 outline.widget#2，位置／最小化不串', async () => {
    globalThis.localStorage?.clear()
    const workspace = { version: 1, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: overlayBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    // 把 #1 拖到一个可辨认的位置。
    const head = wrapper.find('.nx-overlay-head').element
    head.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, clientY: 130, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 130, bubbles: true }))
    await flushPromises()

    // 再开一份：#2 出现在同一块 pane 上，缺省落在右上角（没有继承 #1 的坐标）。
    await wrapper.find('[data-overlay-instance="outline.widget#1"] [aria-label="再开一份"]').trigger('click')
    await flushPromises()
    const widgets = wrapper.findAll('.nx-overlay-widget')
    expect(widgets.map((node) => node.attributes('data-overlay-instance'))).toEqual(['outline.widget#1', 'outline.widget#2'])
    expect(widgets[0].attributes('style')).toContain('left: 40px')
    expect(hostWorkspace.get('outline.widget#2').geometry?.x ?? null).not.toBe(40)

    // 拖 #2：只改 #2 的坐标，#1 原样。
    const head2 = widgets[1].find('.nx-overlay-head').element
    head2.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 200, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 200, bubbles: true }))
    await flushPromises()
    expect(hostWorkspace.get('outline.widget#1').geometry.x).toBe(40)
    expect(hostWorkspace.get('outline.widget#2').geometry.x).toBe(200)

    // 收起 #2：只有 #2 变侧缘标签，#1 的卡片还在。
    await wrapper.find('[data-overlay-instance="outline.widget#2"] [aria-label="收起悬浮窗"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.get('outline.widget#1').minimized).toBe('none')
    expect(hostWorkspace.get('outline.widget#2').minimized).toBe('collapsed')
    expect(wrapper.findAll('.nx-overlay-widget')).toHaveLength(1)
    const tabs = wrapper.findAll('.nx-overlay-tab')
    expect(tabs.map((node) => node.attributes('data-overlay-instance'))).toEqual(['outline.widget#2'])
    wrapper.unmount()
    globalThis.localStorage?.clear()
  })
})

describe('多形态打开（协议 v1.2 P18–P21）', () => {
  afterEach(() => {
    resetWorkspace()
    globalThis.localStorage?.clear()
  })

  const OUTLINE_PANES = [
    { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', forms: ['dock'] },
    // 'window' 是词表外形态：宿主过滤掉，不进菜单（P18）。
    // split:'side' 是协议 P11 的副栏声明——有它时这块 pane 优先当副 pane。
    { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', split: 'side', forms: ['dock', 'split', 'fullscreen', 'window'] },
    { slot: 'overlay', id: 'outline.widget', title: '大纲', width: 300, forms: ['overlay', 'fullscreen'] }
  ]
  const NOVEL_PANES = [
    { slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'outline', forms: ['dock'] },
    // split:'main' 是协议 P11 的主栏声明——分屏时由它当主 pane。
    { slot: 'center', id: 'novel.editor', title: '正文', icon: 'writing', split: 'main', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
  ]

  /** carrierView 上补两块带 forms 声明的载体：小说（左树/正文）与大纲（左树/编辑/悬浮窗）。 */
  function multiFormView() {
    const base = carrierView()
    return {
      ...base,
      carriers: [
        { ...base.carriers[0], panes: NOVEL_PANES },
        ...base.carriers.slice(1),
        {
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
          panes: OUTLINE_PANES
        }
      ],
      left: [
        { ...NOVEL_PANES[0], pluginId: 'fixture.novel', pluginTitle: '小说（夹具）', primary: true },
        { ...OUTLINE_PANES[0], pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ],
      center: [
        { ...NOVEL_PANES[1], pluginId: 'fixture.novel', pluginTitle: '小说（夹具）', primary: true },
        { ...OUTLINE_PANES[1], pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ]
    }
  }

  function multiFormBridge({ workspace = { version: 1, entries: {} } } = {}) {
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: multiFormView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { theme: 'light' } }
      if (channel === IPC_CHANNELS.workspaceLoad) return { ok: true, value: { version: workspace.version ?? 1, entries: workspace.entries ?? {} } }
      if (channel === IPC_CHANNELS.workspaceSave) {
        workspace.version = payload?.snapshot?.version ?? 1
        workspace.entries = payload?.snapshot?.entries ?? {}
        return { ok: true, value: { version: workspace.version, entries: workspace.entries } }
      }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        if (payload.tool === 'pinax_outline_read') {
          return {
            ok: true,
            value: {
              tool: payload.tool,
              owner: 'pinax.carrier.outline',
              payload: { ok: true, source: '大纲/outline.json', nodes: [{ id: 'n1', title: '开场：雨夜进城' }], edges: [], nodeTotal: 1, truncated: false, revision: 1, warning: null }
            }
          }
        }
        if (payload.tool === 'pinax_chapter_list') {
          return {
            ok: true,
            value: {
              tool: payload.tool,
              owner: 'fixture.novel',
              payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }] }
            }
          }
        }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    return { request, onEvent: () => () => {}, channels: IPC_CHANNELS }
  }

  function railByName(wrapper, name) {
    return wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === name)
  }

  async function openOutlineWidget(wrapper) {
    const outlineRail = railByName(wrapper, '大纲')
    expect(outlineRail, '竖条应有大纲栏').toBeTruthy()
    await outlineRail.trigger('click')
    await flushPromises()
    const toggle = wrapper.find('[aria-label="悬浮大纲"]')
    expect(toggle.exists(), '大纲区标题行右侧应有「悬浮」钮').toBe(true)
    await toggle.trigger('click')
    await flushPromises()
  }

  it('右键竖条格按 forms 声明列「打开方式」；选分屏→目标面板进副栏、主 pane 不变；树行右键同入口', async () => {
    resetWorkspace()
    globalThis.localStorage?.clear()
    const workspace = { version: 1, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: multiFormBridge({ workspace }) } })
    await flushPromises()

    const outlineRail = railByName(wrapper, '大纲')
    outlineRail.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }))
    await flushPromises()

    const menu = wrapper.find('.nx-context-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.find('.nx-context-group').text()).toBe('打开方式')
    // 只列 forms 声明过的四档（'window' 被词表过滤）；顺序按宿主词表。
    expect(menu.findAll('[data-form]').map((node) => node.attributes('data-form'))).toEqual(['dock', 'split', 'overlay', 'fullscreen'])

    await menu.find('[data-form="split"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-context-menu').exists()).toBe(false)

    const split = wrapper.find('.nx-split')
    expect(split.exists()).toBe(true)
    expect(split.attributes('data-split-pane')).toBe('outline.editor')
    expect(wrapper.find('.nx-split-main [data-pane-id="novel.editor"]').exists()).toBe(true)
    expect(wrapper.find('.nx-split-side [data-pane-id="outline.editor"]').exists()).toBe(true)
    const sideWidth = Number(/width:\s*(\d+)px/u.exec(wrapper.find('.nx-split-side').attributes('style') ?? '')?.[1] ?? 0)
    expect(sideWidth).toBeGreaterThanOrEqual(420)
    // 形态落进工作区四轴（M2.5-C）：内存与存档两处一致。
    expect(hostWorkspace.get('outline.editor#1').placement).toBe('split')
    expect(workspace.entries['outline.editor#1'].placement).toBe('split')

    // 分界可拖：往左 100px，副栏变宽 100px（与三栏 .resizer 同一套手势）。
    wrapper.find('.nx-split-divider').element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 900, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 800, bubbles: true }))
    await flushPromises()
    const dragWidth = Number(/width:\s*(\d+)px/u.exec(wrapper.find('.nx-split-side').attributes('style') ?? '')?.[1] ?? 0)
    expect(dragWidth).toBe(sideWidth + 100)

    // 索引窗树行右键：同一枚宿主菜单（切回小说板，树里才有章节行）。
    // 批次31 起大纲行例外——它先开「节点」菜单（见大纲那一条用例），打开方式在竖条右键照旧可达。
    const novelRail = railByName(wrapper, '小说（夹具）')
    expect(novelRail, '竖条应有小说栏').toBeTruthy()
    // 先切到大纲板（索引窗此刻是开着的），再切回小说板——这样点的是「换板」不是「收起索引窗」。
    await outlineRail.trigger('click')
    await flushPromises()
    await novelRail.trigger('click')
    await flushPromises()
    const row = wrapper.find('.nx-index-body .nx-tree-row')
    expect(row.exists()).toBe(true)
    row.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 200 }))
    await flushPromises()
    const rowMenu = wrapper.find('.nx-context-menu')
    expect(rowMenu.exists()).toBe(true)
    expect(rowMenu.findAll('[data-form]').map((node) => node.attributes('data-form'))).toEqual(['dock', 'split', 'overlay', 'fullscreen'])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.nx-context-menu').exists()).toBe(false)

    // 点菜单外也收起（同一枚宿主菜单的手势纪律）。
    row.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 200 }))
    await flushPromises()
    expect(wrapper.find('.nx-context-menu').exists()).toBe(true)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.nx-context-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('未声明 forms 的载体：右键只给说明，不伪造任何形态', async () => {
    resetWorkspace()
    globalThis.localStorage?.clear()
    const wrapper = mount(AppNext, { props: { bridge: stubBridge(carrierView()) } })
    await flushPromises()

    const novelRail = railByName(wrapper, '小说（夹具）')
    novelRail.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    await flushPromises()
    const menu = wrapper.find('.nx-context-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.findAll('[data-form]')).toHaveLength(0)
    expect(menu.find('.nx-context-empty').text()).toBe('该载体未声明打开形态')
    expect(menu.text()).toContain('在新窗口打开')
    wrapper.unmount()
  })

  it('浮窗吸附：拖到左缘吸附成半屏 dock，再拖离恢复浮动态', async () => {
    resetWorkspace()
    globalThis.localStorage?.clear()
    const workspace = { version: 1, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: multiFormBridge({ workspace }) } })
    await flushPromises()
    await openOutlineWidget(wrapper)

    const widget = wrapper.find('.nx-overlay-widget')
    expect(widget.exists()).toBe(true)
    widget.find('.nx-overlay-head').element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 100, bubbles: true }))
    await flushPromises()

    const snapped = wrapper.find('.nx-overlay-widget')
    expect(snapped.classes()).toContain('is-snapped-left')
    expect(snapped.attributes('data-snap')).toBe('left')
    expect(workspace.entries['outline.widget#1'].geometry.snap).toBe('left')

    // 从吸附态拖离 → 回浮动态；存档里的 snap 清掉（geometry 其余轴保留）。
    snapped.find('.nx-overlay-head').element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 320, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 320, clientY: 100, bubbles: true }))
    await flushPromises()

    const floating = wrapper.find('.nx-overlay-widget')
    expect(floating.classes()).not.toContain('is-snapped-left')
    const stored = workspace.entries['outline.widget#1'].geometry
    expect(stored.snap).toBe(null)
    expect(stored.x).toBeGreaterThan(32)
    expect(floating.attributes('style')).toContain(`left: ${stored.x}px`)
    wrapper.unmount()
  })

  it('扩至全屏：占满中栏，点「还原浮窗」回到浮动态', async () => {
    resetWorkspace()
    globalThis.localStorage?.clear()
    const workspace = { version: 1, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: multiFormBridge({ workspace }) } })
    await flushPromises()
    await openOutlineWidget(wrapper)

    const expand = wrapper.find('[aria-label="扩至全屏"]')
    expect(expand.exists()).toBe(true)
    await expand.trigger('click')
    await flushPromises()

    const bar = wrapper.find('.nx-form-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('data-form')).toBe('fullscreen')
    expect(bar.text()).toContain('全屏 · 大纲')
    expect(wrapper.find('.col-center [data-pane-id="outline.widget"]').exists()).toBe(true)
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(false)
    expect(wrapper.find('.nx-overlay-tab').exists()).toBe(false)
    expect(workspace.entries['outline.widget#1'].placement).toBe('fullscreen')

    await bar.find('.nx-form-bar-action').trigger('click')
    await flushPromises()
    expect(wrapper.find('.nx-form-bar').exists()).toBe(false)
    expect(wrapper.find('.nx-overlay-widget').exists()).toBe(true)
    // 还原目标是进全屏前的位置（restore 轴记住 overlay），不是外壳里的补丁 ref。
    expect(workspace.entries['outline.widget#1'].placement).toBe('overlay')
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
    { id: 'wb-1', name: '人物·柯秒', type: 'character', tags: ['主角'], aliases: ['柯秒'], chars: 18, summary: LONG_SUMMARY, path: '世界书/人物·柯秒.md', revision: 1, contract: true },
    { id: null, name: '随手记', type: 'general', tags: [], aliases: [], chars: 9, path: '世界书/随手记.md', revision: 1, contract: false }
  ]

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
        { slot: 'left-dock', id: 'worldbook.board', title: '世界书板', icon: 'library' },
        { slot: 'center', id: 'worldbook.entries', title: '条目', icon: 'library' }
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
        { slot: 'left-dock', id: 'worldbook.board', title: '世界书板', icon: 'library', pluginId: 'pinax.carrier.worldbook', pluginTitle: '世界书' },
        { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ],
      center: [
        ...base.center,
        { slot: 'center', id: 'worldbook.entries', title: '条目', icon: 'library', pluginId: 'pinax.carrier.worldbook', pluginTitle: '世界书' },
        { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', pluginId: 'pinax.carrier.outline', pluginTitle: '大纲' }
      ]
    }
  }

  function writingBridge({ nodes = OUTLINE_NODES, edges = OUTLINE_EDGES, entries = ENTRIES } = {}) {
    const calls = []
    // 条目夹具是模块级常量：这里拷一份，保存用例改的是这一次挂载自己的账。
    const book = entries.map((item) => ({ ...item }))
    const request = vi.fn(async (channel, payload) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: writingView() }
      if (channel === IPC_CHANNELS.prefsGet) return { ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85, theme: 'light' } }
      if (channel === IPC_CHANNELS.runtimeToolCall) {
        calls.push({ tool: payload.tool, args: payload.args })
        if (payload.tool === 'pinax_chapter_list') {
          return { ok: true, value: { tool: payload.tool, owner: 'fixture.novel', payload: { ok: true, total: 1, truncated: false, chapters: [{ index: 0, title: '雨夜', file: '正文/雨夜.md', name: '雨夜.md', revision: 1 }] } } }
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
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: true, total: book.length, truncated: false, warnings: [], skippedDirs: [], projectRoot: 'D:/tmp/大梦', entries: book } } }
        }
        if (payload.tool === 'pinax_worldbook_read') {
          const hit = book.find((item) => (item.id && item.id === payload.args.id) || item.name === payload.args.name)
          if (!hit) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: false, code: 'PINAX_INVALID_INPUT', message: '没有这条' } } }
          return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: true, entry: { ...hit, keys: hit.aliases, relations: Array.isArray(hit.relations) ? hit.relations : [], content: '冷穿越剧版主角，醒来在雪夜。', contentChars: 16, contentTruncated: false }, warnings: [] } } }
        }
        if (payload.tool === 'pinax_worldbook_save') {
          const index = book.findIndex((item) => item.path === payload.args.path)
          if (index < 0) return { ok: true, value: { tool: payload.tool, owner: 'pinax.carrier.worldbook', payload: { ok: false, code: 'PINAX_STALE_REVISION', message: '没有这条' } } }
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
    expect(paneNow().find('.doc-title').exists()).toBe(true)
    const note = paneNow().find('[aria-label="大纲节点备注（最多 200 字）"]')
    expect(note.exists()).toBe(true)
    expect(note.attributes('maxlength')).toBe('200')
    expect(note.classes()).toContain('doc-field')
    expect(paneNow().find('.editor-foot').exists()).toBe(false)
    for (const gone of ['.outline-move', '.outline-remove', '.outline-add', '.pane-hint']) {
      expect(paneNow().find(gone).exists(), `${gone} 不该再长在编辑面上`).toBe(false)
    }

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
    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
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
    expect(rows().map((row) => row.text())).toEqual(['1. 第二折：钟楼', '2. 第一折：停摆的表', '3. 开场：雨夜进城'])
    await paneNow().find('[aria-label="大纲节点备注（最多 200 字）"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const moved = bridge.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
    expect(moved.args.nodes.map((node) => node.id)).toEqual(['n3', 'n2', 'n1'])
    expect(moved.args.edges).toEqual(OUTLINE_EDGES)

    // 删除节点：连同它的连线一起从草稿里删掉；头部节点数当场变，树也跟着少一行。
    const removeMenu = await openMenu(rows()[2])
    await removeMenu.find('[data-test="outline-node-remove"]').trigger('click')
    await flushPromises()
    expect(rows()).toHaveLength(2)
    expect(paneNow().find('.editor-meta').text()).toContain('共 2 个节点')
    await paneNow().find('[aria-label="大纲节点备注（最多 200 字）"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const removed = bridge.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
    expect(removed.args.nodes.map((node) => node.id)).toEqual(['n3', 'n2'])
    expect(removed.args.edges).toEqual([])

    // 「＋」（区标题行，hover 才显形）：在末尾追一个同级节点；同样只进草稿，Ctrl+S 才落盘。
    await wrapper.find('[data-test="outline-append-node"]').trigger('click')
    await flushPromises()
    expect(rows()).toHaveLength(3)
    expect(rows()[2].text()).toContain('3. 未命名节点')
    await paneNow().find('[aria-label="大纲节点标题"]').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()
    const appended = bridge.calls.filter((call) => call.tool === 'pinax_outline_save').at(-1)
    expect(appended.args.nodes.map((node) => node.title)).toEqual(['第二折：钟楼', '第一折：停摆的表', '未命名节点'])
    expect(appended.args.edges).toEqual([])
    wrapper.unmount()
  })

  it('世界书条目表格：切换控件在区标题行，表格列齐、截摘要 40 字，行点击与列表同一个 openEntry', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    // 默认是列表视图：两行条目，没有表格。
    expect(wrapper.find('.nx-index-window .nx-tree-item').exists()).toBe(true)
    expect(wrapper.find('[data-test="entries-table"]').exists()).toBe(false)
    const toggle = wrapper.find('[data-test="entries-view-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('切换为表格视图')
    expect(toggle.text()).toBe('表')

    await toggle.trigger('click')
    await flushPromises()

    const table = wrapper.find('[data-test="entries-table"]')
    expect(table.exists()).toBe(true)
    expect(table.findAll('th').map((th) => th.text())).toEqual(['名称', '类型', '关键词', '字数', '摘要'])
    const bodyRows = table.findAll('tbody tr')
    expect(bodyRows).toHaveLength(2)
    expect(bodyRows[0].findAll('td').map((td) => td.text())).toEqual([
      '人物·柯秒',
      'character',
      '柯秒',
      '18',
      `${LONG_SUMMARY.slice(0, 40)}…`
    ])
    expect(bodyRows[1].text()).toContain('随手记')
    // 表格里不再重复列表那一列版本／未建档脚注（未建档在详情面看）。
    expect(wrapper.find('[data-test="entries-view-toggle"]').attributes('aria-label')).toBe('切换为列表视图')
    expect(wrapper.find('[data-test="entries-view-toggle"]').text()).toBe('列')

    // 行点击＝打开该条目（与列表同一 openEntry）：走 read、中栏换成条目详情。
    await bodyRows[0].trigger('click')
    await flushPromises()
    const lastRead = bridge.calls.filter((call) => call.tool === 'pinax_worldbook_read').at(-1)
    expect(lastRead.args).toEqual({ id: 'wb-1' })
    expect(wrapper.find('[data-pane-id="worldbook.entries"]').text()).toContain('人物·柯秒')

    // 状态按项目根落 localStorage（照 paneForm 先例）。
    expect(globalThis.localStorage.getItem('entriesView.D:/tmp/大梦')).toBe('table')
    wrapper.unmount()

    // 重新挂载读回同一份选择：还是表格视图。
    const again = mount(AppNext, { props: { bridge: writingBridge() } })
    await flushPromises()
    await openBoard(again, '世界书')
    expect(again.find('[data-test="entries-table"]').exists()).toBe(true)
    // 切回列表：状态同样落盘。
    await again.find('[data-test="entries-view-toggle"]').trigger('click')
    await flushPromises()
    expect(again.find('[data-test="entries-table"]').exists()).toBe(false)
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
    expect(wrapper.find('.nx-index-window').text()).toContain('这一栏还没有条目。')
    wrapper.unmount()
  })

  it('世界书关系边编辑（批次28 · 工单2b）：行编辑随 meta.relations 落盘，阅读态按「目标 · 类型 · 立场」显示', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    const paneNow = () => wrapper.find('[data-pane-id="worldbook.entries"]')
    await wrapper.findAll('.nx-index-window .nx-tree-item')[0].trigger('click')
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

  it('大纲空态带一句指引：章节稿可在 设置 → 大纲转换 生成节点（纯文案，不放按钮）', async () => {
    const bridge = outlineBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    const rail = wrapper.findAll('.nx-ribbon-item').find((node) => node.attributes('aria-label') === '大纲')
    expect(rail, '竖条应有大纲栏').toBeTruthy()
    await rail.trigger('click')
    await flushPromises()

    const hint = wrapper.find('[data-test="outline-import-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('设置 → 大纲转换')
    expect(hint.findAll('button')).toHaveLength(0)
    wrapper.unmount()
  })
})
