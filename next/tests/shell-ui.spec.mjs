import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import ActivityRail from '../shell/ActivityRail.vue'
import RuntimeDock from '../shell/RuntimeDock.vue'
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
    // 目录树在索引窗那一栏，不在核心区（P18 后索引窗不再有「只读归档」死区）。
    expect(wrapper.find('.nx-index-window').text()).toContain('正文')
    expect(wrapper.find('.nx-index-window').text()).not.toContain('只读归档')
    wrapper.unmount()
  })

  it('同载体双中栏 pane（批次58 实拍缺口）：顶部出切换条，点第二块换核心区', async () => {
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

    const tabs = wrapper.find('[data-test="center-pane-tabs"]')
    expect(tabs.exists()).toBe(true)
    expect(tabs.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['编辑器', '画布'])
    expect(tabs.find('[role="tab"][data-pane="comic.editor"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-pane-id="comic.editor"]').exists()).toBe(true)

    await tabs.find('[data-pane="comic.canvas"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-pane-id="comic.canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-pane-id="comic.editor"]').exists()).toBe(false)
    expect(wrapper.find('[role="tab"][data-pane="comic.canvas"]').attributes('aria-selected')).toBe('true')
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
    // 批次33：文档头只有一行标题「提案审阅 · 文件名」，meta 沉到底部 hint。
    expect(pane.text()).toContain(`提案审阅 · ${PROPOSAL.name}`)
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

    // 静态八节按组序排列：应用（偏好与模型/备份与恢复/服务与通知）→ 项目（载体管理/导入既有稿/新建项目/主载体选择）→ 文档（文档历史）。
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs.slice(0, 8)).toEqual(['偏好与模型', '备份与恢复', '服务与通知', '载体管理', '导入既有稿', '新建项目', '主载体选择', '文档历史'])
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

    // 清空：目录恢复（静态八节在前，载体占位节在后）。
    await search.setValue('')
    await flushPromises()
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs.slice(0, 8)).toEqual(['偏好与模型', '备份与恢复', '服务与通知', '载体管理', '导入既有稿', '新建项目', '主载体选择', '文档历史'])
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

    // 页签栏＝全部页（按叠序），高亮跟着此刻这一页；中心区只画当前那一张。
    const tabs = wrapper.findAll('.nx-page-tab')
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
    const tabs = () => wrapper.findAll('.nx-page-tab')
    expect(tabs().map((tab) => tab.attributes('data-page-instance'))).toEqual(['novel.editor#1', 'outline.editor#1', 'outline.widget#1'])
    // 浮窗也上签：否则「看得见」只覆盖了一半；签上的后缀标出它此刻是浮着的。
    expect(tabs()[2].attributes('data-page-form')).toBe('floating')
    expect(tabs()[2].find('.nx-page-tab-flag').text()).toBe('浮窗')

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
    // 大纲编辑声明了 dock／split／overlay／fullscreen：菜单出三项，fullscreen 被词表闸掉（v3 没有独立落点）。
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

  it('分屏＝把这一页搬进对面页组（不是第四种形态）：两组各占一半，再点搬回来', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)

    await wrapper.find('.nx-pane-window[data-window-pane="outline.editor"] [data-window-action="split"]').trigger('click')
    await flushPromises()
    // 形态没变，变的是页组：v3 的「分屏」就是 main／side 两组各摆自己那张页。
    expect(hostWorkspace.get('outline.editor#1')).toMatchObject({ form: 'page', group: 'side' })
    expect(hostWorkspace.get('outline.editor#1').geometry).toBe(null)
    const win = wrapper.find('.nx-pane-window[data-window-pane="outline.editor"]')
    expect(win.attributes('data-window-state')).toBe('page')
    expect(win.attributes('data-window-group')).toBe('side')
    expect(win.classes()).toContain('is-in-side')
    expect(wrapper.findAll('.nx-pane-window.is-page')).toHaveLength(2)
    expect(hostWorkspace.snapshot().active).toEqual({ main: 'novel.editor#1', side: 'outline.editor#1' })
    expect(workspace.entries['outline.editor#1'].group).toBe('side')

    // 再点＝解除：搬回对面那一组，side 组空了，屏幕上只剩一张页。
    await win.find('[data-window-action="split"]').trigger('click')
    await flushPromises()
    expect(groupOf('outline.editor#1')).toBe('main')
    expect(hostWorkspace.snapshot().active).toEqual({ main: 'outline.editor#1', side: null })
    expect(wrapper.findAll('.nx-pane-window.is-in-side')).toHaveLength(0)
    expect(wrapper.findAll('.nx-pane-window.is-page')).toHaveLength(1)
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
    await widget().find('[data-window-action="collapse"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.get('outline.widget#1').geometry).toBe(null)
    wrapper.unmount()

    // 重新挂载＝从同一份存档读回浮窗与坐标（不是二次打开；存档里那条收起态也读得回来）。
    const second = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(second.find('.nx-pane-window-tab[data-window-pane="outline.widget"]').exists()).toBe(true)
    await second.find('.nx-page-tab[data-page-instance="outline.widget#1"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('page')
    second.unmount()
  })

  it('统一 chrome：三枚钮＋没有第二套窗口壳；竖条右键不弹形态菜单', async () => {
    const wrapper = mount(AppNext, { props: { bridge: pageBridge() } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    const widget = wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]')
    expect(widget.findAll('[data-window-action]').map((node) => node.attributes('data-window-action'))).toEqual(['collapse', 'split', 'close'])
    expect(widget.attributes('aria-label')).toBe('大纲窗口')
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

  it('侧缘标签：收起＝退场留缘签，点缘签回页态；× 删记录（页签栏同时少一条）', async () => {
    const workspace = { version: 3, entries: {} }
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ workspace }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)

    await wrapper.find('.nx-pane-window[data-window-pane="outline.widget"] [data-window-action="collapse"]').trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]').exists()).toBe(false)
    const tab = wrapper.find('.nx-pane-window-tab[data-window-pane="outline.widget"]')
    expect(tab.exists()).toBe(true)
    expect(tab.attributes('data-window-state')).toBe('tab')
    expect(tab.attributes('aria-label')).toBe('展开大纲窗口')
    // 缘签按叠序依次下移，多扇收起不叠成一枚。
    expect(tab.attributes('style')).toContain('top: 120px')

    await tab.trigger('click')
    await flushPromises()
    expect(formOf('outline.widget#1')).toBe('page')
    expect(wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]').classes()).toContain('is-page')

    // × ＝删记录：窗口层与页签栏一起少一条，别的页不受牵连。
    await wrapper.find('.nx-page-tab[data-page-instance="outline.widget#1"] [data-page-action="close"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.get('outline.widget#1')).toBe(null)
    expect(workspace.entries['outline.widget#1']).toBeUndefined()
    expect(wrapper.findAll('.nx-page-tab').map((node) => node.attributes('data-page-instance'))).toEqual(['novel.editor#1', 'outline.editor#1'])
    // 中心区只画「所在组的当前页」：关掉的这页曾是 main 的当前页，指针随之回指组内第一张（novel）。
    // 大纲那条记录仍在册（页态、main 组），只是不占屏——所以这里断言记录与签，不断言 DOM 存在。
    expect(hostWorkspace.get('outline.editor#1')).toMatchObject({ form: 'page', group: 'main' })
    expect(wrapper.findAll('.nx-pane-window.is-page').map((node) => node.attributes('data-window-instance'))).toEqual(['novel.editor#1'])
    wrapper.unmount()
  })

  it('Esc＝把最上面那一页收成侧缘标签；统一二级页开着时 Esc 先归弹窗', async () => {
    const handlers = new Map()
    const wrapper = mount(AppNext, { props: { bridge: pageBridge({ handlers }) } })
    await flushPromises()
    await openOutlineBoard(wrapper)
    await openWidget(wrapper)
    expect(formOf('outline.widget#1')).toBe('floating')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    // 叠序最高的是刚开的浮窗 → 它成标签；页态那条不动。
    expect(formOf('outline.widget#1')).toBe('tab')
    expect(wrapper.find('.nx-pane-window-tab[data-window-pane="outline.widget"]').exists()).toBe(true)
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
    // 窗头与页签的标题跟着文档走：载体名 ＋ 文档标识末段。
    expect(wrapper.find('.nx-page-tab[data-page-instance="outline.editor#1"]').text()).toContain('大纲编辑 · 1')
    // 那一页的文档面确实换了（读态标题＝第二个节点）。
    expect(wrapper.find('[data-test="outline-reading-title"]').text()).toBe('第一折：停摆的表')

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
    expect(wrapper.findAll('.nx-page-tab').map((node) => node.text()).filter((text) => text.includes('大纲编辑')))
      .toEqual(['大纲编辑', '大纲编辑 · 0', '大纲编辑 · 1'])

    // 一页一份文档面（D-2）：揭示 #2 看到的是第一个节点，揭示 #3 看到的是第二个——两份草稿互不覆盖。
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#2"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="outline-reading-title"]').text()).toBe('开场：雨夜进城')
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#3"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="outline-reading-title"]').text()).toBe('第一折：停摆的表')

    // 关掉其中一页：另一页的记录与文档都不动。
    await wrapper.find('.nx-page-tab[data-page-instance="outline.editor#3"] [data-page-action="close"]').trigger('click')
    await flushPromises()
    expect(hostWorkspace.get('outline.editor#3')).toBe(null)
    expect(hostWorkspace.get('outline.editor#2').resource).toBe('outline:node:0')
    wrapper.unmount()
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

    // 界面按迁移结果渲染：缘签一条、浮窗一条、屏上两张页（main＋side 各画自己的当前页＝对半）。
    expect(wrapper.find('.nx-pane-window-tab[data-window-pane="outline.editor"]').exists()).toBe(true)
    expect(wrapper.find('.nx-pane-window[data-window-pane="outline.widget"]').attributes('data-window-state')).toBe('floating')
    const half = wrapper.findAll('.nx-pane-window.is-page')
    expect(half.map((node) => node.attributes('data-window-instance'))).toEqual(['novel.editor#1', 'novel.editor#2'])
    expect(half[1].attributes('data-window-group')).toBe('side')
    expect(half[1].classes()).toContain('is-in-side')
    // 下一次变更才整份重写：落盘形状升到 v3（四格齐全）。
    await wrapper.find('.nx-pane-window[data-window-pane="outline.widget"] [data-window-action="collapse"]').trigger('click')
    await flushPromises()
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
      expect(paneNow().find('.doc-title').exists()).toBe(true)
      // 批次43：大纲面默认是阅读态——头部那一行标题是节点名，正文是渲染出来的备注。
      expect(paneNow().find('[data-test="outline-reading-title"]').text()).toBe('开场：雨夜进城')
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
    expect(wrapper.find('[data-pane-id="worldbook.entries"] .doc-title').text()).toBe('编年·雨夜')
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
   * 批次44 · 排布（作者 2026-10-31：「图表列的切换全都挤在左侧小区域里进行，
   * 右侧大面积留空，非常别扭，更合理的一个情况是，上面放图表列，下面放详情信息」）。
   *
   * 机器钉子：核心区是竖排（看板在上、详情在下），窄栏退成类别导航树。
   */
  it('批次44：世界书核心区竖排——上图表列、下详情；窄栏只留类别导航', async () => {
    globalThis.localStorage?.clear()
    const bridge = writingBridge({ entries: CATEGORIZED, categories: [...CATEGORIES] })
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()
    await openBoard(wrapper, '世界书')

    const workspace = wrapper.find('[data-pane-id="worldbook.entries"] .nx-entries-workspace')
    expect(workspace.exists(), '核心区该有一块竖排工作区').toBe(true)
    const children = [...workspace.element.children]
    expect(children.length, '工作区就是两块：上图表列、下详情').toBe(2)
    expect(children[0].className).toContain('nx-entries-workspace-board')
    expect(children[1].className).toContain('nx-entries-workspace-detail')

    // 切换控件住在看板区头上，不在任何左栏里。
    expect(wrapper.find('[data-test="entries-board"] [data-test="entries-view-toggle"]').exists()).toBe(true)

    // 批次59 铁律四：世界书是 web 模板，没有左树；类别导航树随左栏一起退场。
    expect(wrapper.find('.nx-index-window').exists()).toBe(false)
    expect(wrapper.find('[data-test="entry-category-tree"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="entries-table"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="entries-graph"]').exists()).toBe(false)

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
