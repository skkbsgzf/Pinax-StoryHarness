import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount as vueMount } from '@vue/test-utils'
import AppNext from '../shell/AppNext.vue'
import DeducePanel from '../shell/DeducePanel.vue'
import { IPC_CHANNELS } from '../shell/ipcContract.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'
import { resetWorkspace } from '../shell/workspace.mjs'

/**
 * M1-c 推演面板的组件级用例（shell-ui 段）。
 *
 * 与内核用例的分工：deduce-view.test.mjs 用 node:test 钉纯封装的形状（归一／POV 裁剪／快照），
 * 这里用 jsdom 钉「上屏那一面」——场景卡四字段、三来源徽章、玩家／导演双模式、
 * 第一视角只见已知、快照留档，以及 AppNext 的挂载／开关／回执不越界。
 * 戏剧✦层需要外部 LlmPort，本批不注入，故只验词表在位、候选仍由必然＋命运凑够 2–4 条。
 */

/** 一份最小「世界书面」夹具：人物／地点／规则／事件四类，带 relations 与 knowledge。 */
function boardEntries() {
  return [
    { name: '克莱恩', cat: '人物', summary: '灰雾之上的复生者。', relations: [{ to: '旧钟楼', label: '驻守' }, { to: '未知的门', label: '窥见' }], knowledge: [{ fromEntry: '旧钟楼', kind: '驻守' }] },
    { name: '奥黛丽', cat: '人物', summary: '观众途径的非凡者。', relations: [{ to: '克莱恩', label: '同盟' }], knowledge: [{ fromEntry: '值夜者', kind: '听闻' }] },
    { name: '旧钟楼', cat: '地点', summary: '鲁恩王国北郊的钟楼。', relations: [{ to: '值夜者', label: '据点' }] },
    { name: '值夜者', cat: '组织', summary: '官方非凡者小队。' },
    { name: '序列魔药', cat: '规则', summary: '服食魔药才能晋升。' },
    { name: '沉船之夜', cat: '事件', summary: '那场改变航线的风暴。' }
  ]
}

/** 外壳是模块级单例（workspace），每个用例从空工作区起步。 */
beforeEach(() => {
  resetWorkspace()
})

/** 挂载台账：用例中途抛错也统一回卷，残壳的全局 keydown 不串进后续用例。 */
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
      // 已经死掉的壳就地丢弃，不让清理本身炸出第二个红。
    }
  }
})

/** 开局：setup 相点「冻结世界书并开局」，等 presentTurn 的异步候选生成落定。 */
async function openSession(wrapper) {
  await wrapper.find('[data-test="deduce-open"]').trigger('click')
  await flushPromises()
}

describe('M1-c · 推演面板（第一视角场景卡）', () => {
  it('开局后呈现简笔场景卡：who/where/张力/钩子 四字段齐、候选 2–4 条、三来源徽章词表在', async () => {
    const wrapper = mount(DeducePanel, { props: { entries: boardEntries(), worldName: '夹具世界' } })
    expect(wrapper.find('[data-test="deduce-setup"]').exists()).toBe(true)

    await openSession(wrapper)

    const card = wrapper.find('[data-test="deduce-scene-card"]')
    expect(card.exists()).toBe(true)
    const fields = card.findAll('.nx-deduce-field')
    expect(fields.map((field) => field.attributes('data-field'))).toEqual(['who', 'where', 'tension', 'hook'])
    for (const field of fields) {
      expect(field.find('.nx-deduce-field-value').text().trim().length).toBeGreaterThan(0)
    }

    const candidates = wrapper.find('[data-test="deduce-candidates"]').findAll('li')
    expect(candidates.length).toBeGreaterThanOrEqual(2)
    expect(candidates.length).toBeLessThanOrEqual(4)

    const legend = wrapper.find('[data-test="deduce-badge-legend"]').text()
    expect(legend).toContain('▮')
    expect(legend).toContain('⚙')
    expect(legend).toContain('✦')
    expect(legend).toContain('2d6')
  })

  it('命运候选带 2d6 骰点 trace 文案；玩家模式每条候选都有「选择」钮', async () => {
    const wrapper = mount(DeducePanel, { props: { entries: boardEntries() } })
    await openSession(wrapper)

    const fate = wrapper.find('[data-source="命运"]')
    expect(fate.exists()).toBe(true)
    expect(fate.find('.nx-deduce-trace').text()).toMatch(/2d6 \d+\+\d+=\d+/u)
    expect(wrapper.findAll('[data-test^="deduce-pick-"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-test="deduce-inject"]').exists()).toBe(false)
  })

  it('玩家／导演双模式：导演见否决／重掷／注入表单，切回玩家注入表单收起、选择钮回来', async () => {
    const wrapper = mount(DeducePanel, { props: { entries: boardEntries() } })
    await openSession(wrapper)

    expect(wrapper.findAll('[data-test^="deduce-pick-"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-test="deduce-inject"]').exists()).toBe(false)

    await wrapper.find('[data-test="deduce-mode-director"]').trigger('click')
    expect(wrapper.find('[data-test="deduce-inject"]').exists()).toBe(true)
    expect(wrapper.findAll('.nx-deduce-veto').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-test="deduce-reroll"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test^="deduce-pick-"]')).toHaveLength(0)

    await wrapper.find('[data-test="deduce-mode-player"]').trigger('click')
    expect(wrapper.find('[data-test="deduce-inject"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test^="deduce-pick-"]').length).toBeGreaterThan(0)
  })

  it('第一视角裁剪：已知情报与关系都只列 POV 已知实体，指向「未知的门」那条边不出现', async () => {
    const wrapper = mount(DeducePanel, { props: { entries: boardEntries() } })
    await openSession(wrapper)

    const known = wrapper.find('[data-test="deduce-known"]')
    expect(known.text()).toContain('旧钟楼')
    expect(known.text()).not.toContain('未知的门')
    expect(known.text()).not.toContain('值夜者')

    const relations = wrapper.find('[data-test="deduce-relations"]')
    expect(relations.text()).toContain('旧钟楼')
    expect(relations.text()).not.toContain('未知的门')
  })

  it('选一条候选结算：回执落 panel 的「本局回执」，并把知情增量并入 POV 已知集合', async () => {
    const wrapper = mount(DeducePanel, { props: { entries: boardEntries() } })
    await openSession(wrapper)

    await wrapper.find('[data-test^="deduce-pick-"]').trigger('click')
    await flushPromises()

    const receipts = wrapper.find('[data-test="deduce-receipts"]')
    expect(receipts.text()).toContain('拍')
    expect(wrapper.find('[data-test="deduce-scene-card"]').exists()).toBe(true)
  })

  it('收束本局：快照留档（局号／主视角／事件数／状态指纹），重新开局回到 setup 相', async () => {
    const wrapper = mount(DeducePanel, { props: { entries: boardEntries() } })
    await openSession(wrapper)

    await wrapper.find('[data-test="deduce-finish"]').trigger('click')
    const archived = wrapper.find('[data-test="deduce-archived"]')
    expect(archived.exists()).toBe(true)
    expect(archived.text()).toContain('本局已收束')
    expect(archived.text()).toContain('状态指纹')

    await wrapper.find('[data-test="deduce-reopen"]').trigger('click')
    expect(wrapper.find('[data-test="deduce-setup"]').exists()).toBe(true)
  })
})

describe('M1-c · 外壳接线（AppNext 直接挂载，不越界）', () => {
  function emptyFrameworkView() {
    return {
      kernel: { contractVersion: '1', kinds: ['novel'] },
      project: null,
      needsPrimary: true,
      openError: { code: 'PINAX_PRIMARY_CARRIER_MISSING', message: '《空框架项目》还没有主载体——请先选择「创作小说还是剧本」' },
      left: [], center: [], primary: null, carriers: [],
      skeletonDirs: [], ownedDirs: [],
      rejected: [{ pluginId: 'bad.carrier', error: { message: '槽位 "right" 是保留字' } }],
      runtime: {
        title: RUNTIME_CONTRACT.title,
        builtIn: RUNTIME_CONTRACT.builtIn,
        disableable: RUNTIME_CONTRACT.disableable,
        ownsSlot: RUNTIME_CONTRACT.ownsSlot,
        budgetPriority: RUNTIME_CONTRACT.budgetPriority,
        writeSurface: RUNTIME_CONTRACT.writeSurface,
        reservedSlotReason: '右栏归运行时',
        started: true,
        tools: Array.from({ length: 19 }, (_item, index) => ({ name: `pinax_tool_${index}`, title: `pinax_tool_${index}`, owner: 'kernel' }))
      }
    }
  }

  function stubBridge() {
    const request = vi.fn(async (channel) => {
      if (channel === IPC_CHANNELS.view) return { ok: true, value: emptyFrameworkView() }
      return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `未预期的通道：${channel}` } }
    })
    return { request, channels: IPC_CHANNELS }
  }

  it('标题栏「推演」开关直挂中栏覆盖层：开→面板在、关→面板收；挂载不新增桥通道', async () => {
    const bridge = stubBridge()
    const wrapper = mount(AppNext, { props: { bridge } })
    await flushPromises()

    expect(wrapper.find('[data-test="deduce-layer"]').exists()).toBe(false)
    await wrapper.find('[data-test="deduce-toggle"]').trigger('click')
    expect(wrapper.find('[data-test="deduce-layer"]').exists()).toBe(true)
    await wrapper.find('[data-test="deduce-close"]').trigger('click')
    expect(wrapper.find('[data-test="deduce-layer"]').exists()).toBe(false)

    // 推演面板不碰桥：外呼仍只有基线那几条（view／偏好／工作区／服务日志／快捷键）。
    const allowed = [IPC_CHANNELS.view, IPC_CHANNELS.prefsGet, IPC_CHANNELS.prefsSet, IPC_CHANNELS.workspaceLoad, IPC_CHANNELS.workspaceSave, IPC_CHANNELS.runtimeServiceLog, IPC_CHANNELS.hotkeysLoad]
    expect(bridge.request.mock.calls.every((call) => allowed.includes(call[0]))).toBe(true)
  })
})
