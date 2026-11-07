import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SettingsModal from '../shell/SettingsModal.vue'
import SkillsSection from '../shell/settings/SkillsSection.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 技能库设置节（批次77 任务5）。
 *
 * 这一节只证界面这一层的两件事：**装载层答出来的东西都摊在屏上**（含每一条拒装原因），
 * 以及**按下钮发的是哪条通道、带的是哪个载荷**。域与启停的语义在 next/tests/skills-settings.test.mjs 里钉，
 * 这里不重算一遍——两层各管各的判据，才不会出现「单测绿、屏上是另一套」。
 */

const ROWS = [
  {
    name: 'chapter-rewrite', description: '改写这一章。', domain: 'prose', domainLabel: '正文写作',
    kind: '', kindLabel: '', output: 'proposal', tools: ['pinax_chapter_read', 'pinax_chapter_save'],
    origin: 'built-in', originLabel: '随包', enabled: true, status: 'loaded'
  },
  {
    name: 'jiangnan-style', description: '江南那种吐槽流口吻。', domain: 'prose', domainLabel: '正文写作',
    kind: 'style', kindLabel: '风格', output: 'proposal', tools: ['pinax_chapter_read'],
    origin: 'project', originLabel: '项目导入', enabled: false, status: 'disabled'
  }
]

const REJECTED = [
  { dir: 'worldbook-refactor', origin: 'built-in', originLabel: '随包', code: 'SKILL_TOOLS_NOT_ON_SURFACE', message: '技能 worldbook-refactor 声明的工具不在当前面上：pinax_worldbook_save' }
]

function snapshot(overrides = {}) {
  return {
    rows: ROWS,
    rejected: REJECTED,
    disabled: ['jiangnan-style'],
    layers: [
      { dir: 'next/skills', origin: 'built-in', exists: true },
      { dir: '项目/.pinax/skills', origin: 'project', exists: false }
    ],
    total: 2,
    surface: { availableTools: 21, started: true, note: '' },
    ...overrides
  }
}

function bridgeStub(handlers = {}) {
  const calls = []
  const request = vi.fn(async (channel, payload) => {
    calls.push({ channel, payload })
    const handler = handlers[channel]
    if (handler) return handler(payload)
    if (channel === IPC_CHANNELS.skillsList) return { ok: true, value: snapshot() }
    if (channel === IPC_CHANNELS.skillsToggle) return { ok: true, value: { name: payload.name, enabled: payload.enabled } }
    if (channel === IPC_CHANNELS.skillsBody) return { ok: true, value: { name: payload.name, body: '## 步骤\n\n1. 先读。' } }
    if (channel === IPC_CHANNELS.skillsImport) return { ok: true, value: { source: '.pinax/skills', imported: [{ name: 'new-one' }], rejected: [{ dir: '坏包', code: 'SKILL_NAME_MISMATCH', message: 'name 与目录不一致' }], total: 2 } }
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
  })
  return { request, calls, channels: IPC_CHANNELS }
}

async function mounted(handlers = {}) {
  const bridge = bridgeStub(handlers)
  const wrapper = mount(SkillsSection, { props: { bridge } })
  await flushPromises()
  return { bridge, wrapper }
}

describe('技能库设置节', () => {
  it('挂载就扫一次：生效／停用分两列，域与来源都以中文chip 上屏', async () => {
    const { bridge, wrapper } = await mounted()
    expect(bridge.calls[0].channel).toBe(IPC_CHANNELS.skillsList)

    const groupLabels = wrapper.findAll('[data-test^="skills-group-"]').map((node) => node.text())
    expect(groupLabels).toEqual(['生效中', '已停用'])

    const live = wrapper.find('[data-test="skills-row-chapter-rewrite"]')
    expect(live.attributes('data-enabled')).toBe('true')
    expect(live.text()).toContain('正文写作')
    expect(live.text()).toContain('随包')
    expect(live.find('[data-test="skills-kind-label"]').exists()).toBe(false, '没 kind 的行不硬造一枚「风格」chip')

    // 「停用」不等于「消失」：关掉的那条仍在页上，按钮给的是「启用」。
    const off = wrapper.find('[data-test="skills-row-jiangnan-style"]')
    expect(off.attributes('data-enabled')).toBe('false')
    expect(off.find('[data-test="skills-kind-label"]').text()).toBe('风格')
    expect(off.find('[data-test="skills-toggle-jiangnan-style"]').text()).toBe('启用')
    expect(off.find('[data-test="skills-toggle-jiangnan-style"]').attributes('disabled')).toBeUndefined()
  })

  it('〔守卫⑪〕整包拒装时逐条给出原因，不许退化成「暂无技能」的空态', async () => {
    const { wrapper } = await mounted()
    const list = wrapper.find('[data-test="skills-rejected"]')
    expect(list.exists()).toBe(true)
    const row = wrapper.find('[data-test="skills-reject-worldbook-refactor"]')
    expect(row.text()).toContain('SKILL_TOOLS_NOT_ON_SURFACE')
    expect(row.text()).toContain('pinax_worldbook_save', '缺哪把工具要能抄下来去查')
    expect(row.text()).toContain('随包')
    expect(wrapper.find('[data-test="skills-empty"]').exists()).toBe(false)

    // 真的一条都没有（也没有拒装）时才是空态，那一格也要说清为什么。
    const empty = await mounted({ [IPC_CHANNELS.skillsList]: () => ({ ok: true, value: snapshot({ rows: [], rejected: [], total: 0, disabled: [] }) }) })
    expect(empty.wrapper.find('[data-test="skills-empty"]').exists()).toBe(true)
  })

  it('工具面没装配时说实话：note 上屏，不写成「没有技能」', async () => {
    const { wrapper } = await mounted({
      [IPC_CHANNELS.skillsList]: () => ({
        ok: true,
        value: snapshot({ rows: [], rejected: [{ dir: 'a', origin: 'built-in', originLabel: '随包', code: 'SKILL_TOOLS_NOT_ON_SURFACE', message: '不在面上' }], surface: { availableTools: 0, started: false, note: '运行时尚未就绪：装不上的原因是工具面还没装配' } })
      })
    })
    expect(wrapper.find('[data-test="skills-surface-note"]').text()).toContain('工具面还没装配')
  })

  it('按「停用」发的是 skillsToggle＋enabled:false，随后重扫一次清单', async () => {
    const { bridge, wrapper } = await mounted()
    await wrapper.find('[data-test="skills-toggle-chapter-rewrite"]').trigger('click')
    await flushPromises()

    const toggle = bridge.calls.find((call) => call.channel === IPC_CHANNELS.skillsToggle)
    expect(toggle.payload).toEqual({ name: 'chapter-rewrite', enabled: false })
    // 重扫（第一次挂载 + 启停后一次）——屏上那一行必须来自装载层，不是组件自己翻的布尔。
    expect(bridge.calls.filter((call) => call.channel === IPC_CHANNELS.skillsList)).toHaveLength(2)
    expect(wrapper.find('[data-test="skills-feedback"]').text()).toContain('已停用')
  })

  it('正文是点开才取的那一份：第一次发 skillsBody，再点收起不再发请求', async () => {
    const { bridge, wrapper } = await mounted()
    const row = wrapper.find('[data-test="skills-row-chapter-rewrite"]')
    expect(row.text()).not.toContain('先读。', '清单里不带正文——渐进披露那道闸')

    await row.findAll('button').at(0).trigger('click')
    await flushPromises()
    expect(bridge.calls.some((call) => call.channel === IPC_CHANNELS.skillsBody)).toBe(true)
    expect(wrapper.find('[data-test="skills-body-view"]').text()).toContain('先读。')

    await wrapper.find('[data-test="skills-row-chapter-rewrite"]').findAll('button').at(0).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="skills-body-view"]').exists()).toBe(false)
    expect(bridge.calls.filter((call) => call.channel === IPC_CHANNELS.skillsBody)).toHaveLength(1)
  })

  it('导入把源目录交回主进程，回来的不合格条目逐条列原因', async () => {
    const { bridge, wrapper } = await mounted()
    await wrapper.find('[data-test="skills-import-path"]').setValue('C:/稿子/我的技能包')
    await wrapper.find('[data-test="skills-import-run"]').trigger('click')
    await flushPromises()

    const call = bridge.calls.find((item) => item.channel === IPC_CHANNELS.skillsImport)
    expect(call.payload).toEqual({ sourceDir: 'C:/稿子/我的技能包' })
    const result = wrapper.find('[data-test="skills-import-result"]')
    expect(result.find('[data-test="skills-imported"]').text()).toContain('new-one')
    expect(result.find('[data-test="skills-import-rejected"]').text()).toContain('SKILL_NAME_MISMATCH')
    expect(result.find('[data-test="skills-import-rejected"]').text()).toContain('name 与目录不一致')
  })

  it('读清单失败时那句错误上屏，页面不白屏', async () => {
    const { wrapper } = await mounted({
      [IPC_CHANNELS.skillsList]: () => ({ ok: false, error: { message: '技能服务未接入（主进程未创建 skillsService）' } })
    })
    expect(wrapper.find('[data-test="skills-feedback"]').text()).toContain('技能服务未接入')
    expect(wrapper.find('.skills-section').exists()).toBe(true)
  })

  it('没有桥也照常渲染，并用作者读得懂的话说清连不上', async () => {
    const wrapper = mount(SkillsSection, { props: { bridge: null } })
    await flushPromises()
    // 〔批次68-R4 任务2〕常驻错误句去行话：不再出现「IPC／桥」，同一句话只说「连不上本地服务」。
    expect(wrapper.find('[data-test="skills-feedback"]').text()).toContain('这一格没连上本地服务')
    expect(wrapper.find('[data-test="skills-feedback"]').text()).not.toMatch(/IPC|桥|通道/u)
  })
})

describe('技能库进既有设置目录（批次77 任务5 第 1 条）', () => {
  function modalBridge() {
    return { request: vi.fn(async () => ({ ok: true, value: snapshot() })), channels: IPC_CHANNELS, onEvent: () => () => {} }
  }

  it('目录里出「技能库」这一格，搜「编剧」也命中它（技能域名进词表）', async () => {
    const wrapper = mount(SettingsModal, {
      props: { open: true, activeSection: 'skills', sections: [], carriers: [], bridge: modalBridge() }
    })
    await flushPromises()
    const tabs = wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())
    expect(tabs).toEqual(['技能库'])
    expect(wrapper.find('[data-test="settings-panel-skills"]').exists()).toBe(true)
    // 内容组件真的挂上了（不是空态占位）。
    expect(wrapper.find('[data-test="skills-import"]').exists()).toBe(true)

    await wrapper.find('[data-test="settings-search"]').setValue('编剧')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab').map((node) => node.text())).toEqual(['技能库'])

    await wrapper.find('[data-test="settings-search"]').setValue('不存在的设置项')
    await flushPromises()
    expect(wrapper.findAll('.settings-navigation .settings-tab')).toHaveLength(0)
  })
})
