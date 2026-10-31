import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ServicesSection from '../shell/settings/ServicesSection.vue'
import ActivityRail from '../shell/ActivityRail.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 服务与通知（批次49 · 工单④）：设置节四控件＋确认后橙点消退，竖条四色状态点。
 * 组件直接挂载（不经 AppNext）：快照由 props 灌入，确认/重启只回答「IPC → 父级重取快照」这一段。
 */

function logLine(level, message, at = '2026-10-31T10:00:00.000Z') {
  return { at, level, message }
}

function serviceItem(overrides = {}) {
  return {
    kind: 'service',
    id: 'comic-preview',
    title: '漫画预览',
    port: 8191,
    transport: null,
    status: 'crashed',
    statusText: '重启次数用尽',
    color: 'orange',
    message: '重启次数用尽',
    logs: [
      logLine('info', '第 1 条'),
      logLine('info', '第 2 条'),
      logLine('warn', '第 3 条'),
      logLine('warn', '第 4 条'),
      logLine('error', '第 5 条'),
      logLine('confirm', '第 6 条')
    ],
    ...overrides
  }
}

function mcpItem(overrides = {}) {
  return {
    kind: 'mcp',
    id: 'comfy',
    title: 'comfy 桥',
    port: null,
    transport: 'stdio',
    status: 'ready',
    statusText: '已连接',
    color: 'green',
    message: '已连接',
    logs: [logLine('info', 'comfy 已连接')],
    ...overrides
  }
}

function snapshot({ carriers } = {}) {
  return {
    at: '2026-10-31T10:00:00.000Z',
    ackedAt: null,
    carriers: carriers ?? [
      {
        carrierId: 'comic',
        carrierTitle: '漫画',
        color: 'orange',
        unackedNotices: 2,
        items: [serviceItem()]
      },
      {
        carrierId: 'novel',
        carrierTitle: '小说',
        color: 'green',
        unackedNotices: 0,
        items: [mcpItem()]
      }
    ],
    entries: []
  }
}

function bridgeStub({ ack = { ok: true, value: { ackedAt: '2026-10-31T10:05:00.000Z' } }, restart = { ok: true } } = {}) {
  const calls = []
  const bridge = {
    calls,
    async request(channel, payload) {
      calls.push({ channel, payload })
      if (channel === IPC_CHANNELS.runtimeServiceLogAck) return ack
      if (channel === IPC_CHANNELS.runtimeServiceRestart) return restart
      return { ok: false, error: { message: `未预期通道：${channel}` } }
    }
  }
  return bridge
}

describe('ServicesSection（批次49 · 服务与通知）', () => {
  it('一行一个声明项：载体名／id／端口或传输／四色状态／最近 5 条日志尾巴', () => {
    const wrapper = mount(ServicesSection, { props: { bridge: bridgeStub(), snapshot: snapshot() } })

    const serviceRow = wrapper.find('[data-test="service-row-comic-preview"]')
    expect(serviceRow.exists()).toBe(true)
    expect(serviceRow.find('.services-title').text()).toBe('漫画')
    expect(serviceRow.find('.services-id').text()).toBe('comic-preview')
    expect(serviceRow.find('.services-meta').text()).toBe('服务 · 端口 8191')
    expect(serviceRow.find('[data-test="service-status-comic-preview"]').attributes('data-status')).toBe('orange')
    expect(serviceRow.find('[data-test="service-status-comic-preview"]').classes()).toContain('is-orange')

    // 日志尾巴只留最近 5 条（span 取名字，避开 time 列）。
    const tailTexts = serviceRow.findAll('[data-test="service-log-tail-comic-preview"] li span')
      .map((node) => node.text())
    expect(tailTexts).toEqual(['第 2 条', '第 3 条', '第 4 条', '第 5 条', '第 6 条'])
    expect(serviceRow.find('[data-test="service-log-tail-comic-preview"] li.is-confirm').exists()).toBe(true)

    const mcpRow = wrapper.find('[data-test="service-row-comfy"]')
    expect(mcpRow.find('.services-meta').text()).toBe('外部 MCP · stdio')
    expect(mcpRow.find('[data-test="service-status-comfy"]').attributes('data-status')).toBe('green')
    // 重启只对服务出现（外部 MCP 没有手动重启口）；没有待确认通知时「知道了」禁用。
    expect(mcpRow.find('[data-test="service-restart-comfy"]').exists()).toBe(false)
    expect(mcpRow.find('[data-test="service-ack"]').attributes('disabled')).toBeDefined()
    expect(serviceRow.find('[data-test="service-restart-comic-preview"]').exists()).toBe(true)
    expect(serviceRow.find('[data-test="service-ack"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('确认：写 runtimeServiceLogAck（只带时间水位）并让父级重取快照，橙点随之消退', async () => {
    const bridge = bridgeStub()
    let wrapper
    const reload = async () => {
      // 池确认后的快照：未读归零、颜色回到绿（状态与日志尾巴不变，只变「未读」这一面）。
      await wrapper.setProps({
        snapshot: snapshot({
          carriers: [{
            carrierId: 'comic',
            carrierTitle: '漫画',
            color: 'green',
            unackedNotices: 0,
            items: [serviceItem({ status: 'ready', statusText: '运行中', color: 'green', message: '已就绪' })]
          }]
        })
      })
    }
    wrapper = mount(ServicesSection, { props: { bridge, snapshot: snapshot(), reload } })
    await flushPromises()
    expect(wrapper.find('[data-test="service-status-comic-preview"]').attributes('data-status')).toBe('orange')

    await wrapper.find('[data-test="service-ack"]').trigger('click')
    await flushPromises()

    const ackCall = bridge.calls.find((call) => call.channel === IPC_CHANNELS.runtimeServiceLogAck)
    expect(ackCall).toBeTruthy()
    expect(ackCall.payload.upToAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(wrapper.find('[data-test="service-status-comic-preview"]').attributes('data-status')).toBe('green')
    expect(wrapper.find('[data-test="service-ack"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.prefs-state').text()).toContain('已确认')
    wrapper.unmount()
  })

  it('重启：只对服务发 runtimeServiceRestart，成功后重取快照', async () => {
    const bridge = bridgeStub()
    const reload = vi.fn(async () => {})
    const wrapper = mount(ServicesSection, { props: { bridge, snapshot: snapshot(), reload } })
    await wrapper.find('[data-test="service-restart-comic-preview"]').trigger('click')
    await flushPromises()

    const restartCall = bridge.calls.find((call) => call.channel === IPC_CHANNELS.runtimeServiceRestart)
    expect(restartCall.payload).toEqual({ id: 'comic-preview' })
    expect(reload).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('空态：当前项目没有声明任何服务或外部 MCP', () => {
    const wrapper = mount(ServicesSection, {
      props: { bridge: bridgeStub(), snapshot: { at: null, ackedAt: null, carriers: [], entries: [] } }
    })
    expect(wrapper.find('[data-test="services-empty"]').text()).toBe('当前项目没有声明任何服务或外部 MCP')
    expect(wrapper.find('.services-row').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ActivityRail 状态点（批次49 · 四色）', () => {
  const boards = [{ id: 'comic', title: '漫画', icon: 'library' }]

  function mountRail(serviceStatus, project = { name: '测试项目' }) {
    return mount(ActivityRail, {
      props: { boards, activeId: 'comic', project, carriers: [], serviceStatus }
    })
  }

  it('四色修饰类齐备：green／orange／red／gray 都落成 is-<color>', () => {
    for (const color of ['green', 'orange', 'red', 'gray']) {
      const wrapper = mountRail({ comic: { color, unackedNotices: 0 } })
      const dot = wrapper.find('.nx-rail-status-dot')
      expect(dot.exists()).toBe(true)
      expect(dot.classes()).toContain(`is-${color}`)
      expect(dot.attributes('data-status')).toBe(color)
      expect(dot.attributes('aria-hidden')).toBe('true')
      wrapper.unmount()
    }
  })

  it('没声明服务／MCP 的板不画点；确认后（再灌快照）橙点转绿', async () => {
    const wrapper = mountRail({})
    expect(wrapper.find('.nx-rail-status-dot').exists()).toBe(false)

    await wrapper.setProps({ serviceStatus: { comic: { color: 'orange', unackedNotices: 1 } } })
    expect(wrapper.find('.nx-rail-status-dot').classes()).toContain('is-orange')

    await wrapper.setProps({ serviceStatus: { comic: { color: 'green', unackedNotices: 0 } } })
    expect(wrapper.find('.nx-rail-status-dot').classes()).toContain('is-green')
    wrapper.unmount()
  })
})
