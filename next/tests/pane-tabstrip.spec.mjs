import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PaneTabStrip from '../shell/PaneTabStrip.vue'

/**
 * 〔批次76-R3 调度方补刀〕组签行的两处手感：
 *   ① 签名两段——「载体 · 文档」拆成 head／tail 两个节点，窄签先省略载体名、保住文档名
 *      （同一插件两面都以插件名开头，整串截断会把能区分它们的那半截切掉——实拍里右半的 ComfyUI
 *       签读成了「Toonflow ＋ ComfyUI · C…」）；拼起来的整串仍与裁定A 那一行逐字相同。
 *   ② 签多了横滚：竖滚轮在签行上换算成横滚（滚动条不画了，鼠标得有路可走）；没溢出时不吞滚轮。
 */
function page(overrides = {}) {
  return { instance: 'media.comfyui#1', pane: 'media.comfyui', form: 'page', group: 'side', address: '', ...overrides }
}

describe('PaneTabStrip 组签行手感（批次76-R3 补刀）', () => {
  it('签名拆两段：tail 是文档名、整串与「载体 · 文档」逐字相同', () => {
    const wrapper = mount(PaneTabStrip, {
      props: {
        group: 'side',
        currentInstance: 'media.comfyui#1',
        pages: [page({ title: 'Toonflow ＋ ComfyUI · ComfyUI', titleHead: 'Toonflow ＋ ComfyUI', titleTail: 'ComfyUI' })]
      }
    })
    const label = wrapper.find('.nx-page-tab-label')
    expect(wrapper.find('.nx-page-tab-head').text()).toBe('Toonflow ＋ ComfyUI')
    expect(wrapper.find('[data-test="page-tab-tail"]').text()).toBe('ComfyUI')
    expect(label.element.textContent).toBe('Toonflow ＋ ComfyUI · ComfyUI')
  })

  it('没拆段的行照旧一整段（不出 tail 节点）', () => {
    const wrapper = mount(PaneTabStrip, {
      props: { group: 'main', pages: [page({ instance: 'novel.editor#1', pane: 'novel.editor', group: 'main', title: '小说' })] }
    })
    expect(wrapper.find('.nx-page-tab-head').text()).toBe('小说')
    expect(wrapper.find('[data-test="page-tab-tail"]').exists()).toBe(false)
  })

  it('溢出时竖滚轮换算成横滚并吞掉这一下；不溢出时不吞', async () => {
    const wrapper = mount(PaneTabStrip, {
      props: { group: 'main', pages: [page({ title: '甲' }), page({ instance: 'b#1', title: '乙' })] }
    })
    const strip = wrapper.find('[data-test="page-tabstrip"]').element
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 800 })
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 })
    const overflowWheel = new WheelEvent('wheel', { deltaY: 60, cancelable: true })
    strip.dispatchEvent(overflowWheel)
    expect(strip.scrollLeft).toBe(60)
    expect(overflowWheel.defaultPrevented).toBe(true)

    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 300 })
    const fitWheel = new WheelEvent('wheel', { deltaY: 60, cancelable: true })
    strip.dispatchEvent(fitWheel)
    expect(fitWheel.defaultPrevented).toBe(false)
  })
})
