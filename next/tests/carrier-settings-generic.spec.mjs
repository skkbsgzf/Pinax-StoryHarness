import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CarrierSettingsGeneric from '../shell/settings/CarrierSettingsGeneric.vue'
import SettingsModal from '../shell/SettingsModal.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 通用载体设置渲染器（批次45 · 任务③）：四类控件渲染、改值写回、未声明拒。
 * 组件直接挂载（不经 AppNext）——它只回答「声明 → 控件 → settings:save」这一段。
 */

function bridgeStub({ load = { ok: true, value: { version: 1, carriers: {} } }, save = null } = {}) {
  const calls = []
  const bridge = {
    calls,
    async request(channel, payload) {
      calls.push({ channel, payload })
      if (channel === IPC_CHANNELS.settingsLoad) return load
      if (channel === IPC_CHANNELS.settingsSave) {
        if (save) return save(payload)
        return { ok: true, value: { ...payload, skipped: false } }
      }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期通道：${channel}` } }
    }
  }
  return bridge
}

function mountGeneric(setting, { bridge = bridgeStub(), carrierId = 'fixture.outline' } = {}) {
  return mount(CarrierSettingsGeneric, {
    props: { bridge, carrierId, carrierTitle: '大纲', setting }
  })
}

describe('CarrierSettingsGeneric（批次45）', () => {
  it('四类控件：string→文本框、number→数字框（min/max/step）、boolean→开关、enum→下拉', async () => {
    const text = mountGeneric({ id: 'title', title: '标题', type: 'string', default: '卷首' })
    expect(text.find('[data-test="generic-string-title"]').element.value).toBe('卷首')

    const number = mountGeneric({ id: 'size', title: '字号', type: 'number', default: 16, min: 12, max: 24, step: 2 })
    const numberInput = number.find('[data-test="generic-number-size"]')
    expect(numberInput.attributes('type')).toBe('number')
    expect(numberInput.attributes('min')).toBe('12')
    expect(numberInput.attributes('max')).toBe('24')
    expect(numberInput.attributes('step')).toBe('2')
    expect(Number(numberInput.element.value)).toBe(16)

    const boolean = mountGeneric({ id: 'spellcheck', title: '拼写检查', type: 'boolean', default: true })
    const toggle = boolean.find('[data-test="generic-boolean-spellcheck"]')
    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.element.checked).toBe(true)

    const options = ['compact', 'comfortable']
    const enumControl = mountGeneric({ id: 'density', title: '密度', type: 'enum', options, default: 'comfortable' })
    const select = enumControl.find('[data-test="generic-enum-density"]')
    expect(select.element.value).toBe('comfortable')
    expect(select.findAll('option').map((node) => node.text())).toEqual(options)
  })

  it('读值：挂载时经 settings:load 取当前载体命名空间里的已存值', async () => {
    const bridge = bridgeStub({
      load: { ok: true, value: { version: 1, carriers: { 'fixture.outline': { density: 'compact' } } } }
    })
    const wrapper = mountGeneric({ id: 'density', title: '密度', type: 'enum', options: ['compact', 'comfortable'], default: 'comfortable' }, { bridge })
    await flushPromises()
    expect(wrapper.find('[data-test="generic-enum-density"]').element.value).toBe('compact')
    expect(bridge.calls[0].channel).toBe(IPC_CHANNELS.settingsLoad)
  })

  it('改值写回：保存带 carrierId／settingId／value，chip 回「已保存」', async () => {
    const bridge = bridgeStub()
    const wrapper = mountGeneric({ id: 'size', title: '字号', type: 'number', default: 16 }, { bridge })
    const input = wrapper.find('[data-test="generic-number-size"]')
    await input.setValue('20')
    await wrapper.find('[data-test="generic-save-size"]').trigger('click')
    await flushPromises()

    const saved = bridge.calls.find((call) => call.channel === IPC_CHANNELS.settingsSave)
    expect(saved.payload).toEqual({ carrierId: 'fixture.outline', settingId: 'size', value: 20 })
    const chip = wrapper.find('[data-test="generic-save-chip-size"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('nx-save-chip')
    expect(chip.text()).toContain('已保存')
  })

  it('未声明拒：主进程的拒绝原样显示，不假装保存成功', async () => {
    const bridge = bridgeStub({
      save: () => ({ ok: false, error: { code: 'PINAX_SETTING_NOT_DECLARED', message: '载体没有声明设置 size：不写盘' } })
    })
    const wrapper = mountGeneric({ id: 'size', title: '字号', type: 'number', default: 16 }, { bridge })
    await wrapper.find('[data-test="generic-save-size"]').trigger('click')
    await flushPromises()
    const chip = wrapper.find('[data-test="generic-save-chip-size"]')
    expect(chip.classes()).toContain('is-error')
    expect(chip.text()).toContain('没有声明设置')
  })

  it('section：只出分组标题，不出保存按钮', () => {
    const wrapper = mountGeneric({ id: 'group', title: '排版', type: 'section' })
    expect(wrapper.find('[data-test="generic-section-group"]').text()).toBe('排版')
    expect(wrapper.find('[data-test="generic-save-group"]').exists()).toBe(false)
  })
})

describe('SettingsModal 路由（批次45）', () => {
  const carriers = [{
    id: 'fixture.outline',
    title: '大纲（夹具）',
    dataDirs: ['大纲'],
    settings: [
      { id: 'density', title: '密度', type: 'enum', options: ['compact', 'comfortable'], default: 'comfortable' },
      { id: 'unknown', title: '未实现节' }
    ]
  }]

  it('未映射但声明了类型的设置 → 通用渲染器', async () => {
    const bridge = bridgeStub()
    const wrapper = mount(SettingsModal, {
      props: {
        open: true,
        activeSection: 'carrier:fixture.outline:density',
        sections: [],
        carriers,
        bridge
      }
    })
    await flushPromises()
    expect(wrapper.find('[data-test="generic-enum-density"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="carrier-settings-empty"]').exists()).toBe(false)
  })

  it('连类型都没声明的设置 → 仍是空态（注册制不编造控件）', async () => {
    const wrapper = mount(SettingsModal, {
      props: {
        open: true,
        activeSection: 'carrier:fixture.outline:unknown',
        sections: [],
        carriers,
        bridge: bridgeStub()
      }
    })
    await flushPromises()
    expect(wrapper.find('[data-test="carrier-settings-empty"]').text()).toBe('该载体的设置项还没有内容')
  })
})
