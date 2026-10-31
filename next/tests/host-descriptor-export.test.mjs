import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_UI_LAYERS,
  buildHostDescriptor,
  checkHostDescriptor,
  diffHostDescriptor,
  serializeHostDescriptor
} from '../testing/exportHostDescriptor.mjs'
import { KERNEL_CONTRACT_VERSION, SUPPORTED_CARRIER_SPECS } from '../kernel/carrierManifest.mjs'
import { OPEN_SLOTS, RESERVED_SLOTS } from '../shell/slots.mjs'
import { PANE_FORMS } from '../shell/paneForms.mjs'
import { VIEW_TYPES } from '../shell/viewRegistry.mjs'

/**
 * 批次57：宿主描述符与注册表一致性（Cordis 线C「能力全表自动导出」）。
 *
 * 真正的保护是 bundleAssertions 的门禁 v；这里先把生成器自身钉住：
 *   1) 导出的每一项都能追溯到词表常量，不是第二份手抄；
 *   2) 盘上那份与生成器逐字段一致；
 *   3) 反向断言——任一字段被改错，diff 必须非空（门禁才会红）。
 */

test('生成器取值全部来自词表常量：views／forms／slots／reservedSlots／carrierSpecs／kernelContract', () => {
  const descriptor = buildHostDescriptor()
  assert.deepEqual(descriptor.views, [...VIEW_TYPES])
  assert.equal(descriptor.views.length, 9)
  assert.deepEqual(descriptor.forms, [...PANE_FORMS])
  assert.equal(descriptor.forms.length, 5)
  assert.deepEqual(descriptor.slots, [...OPEN_SLOTS])
  assert.deepEqual(descriptor.reservedSlots, Object.keys(RESERVED_SLOTS))
  assert.deepEqual(descriptor.carrierSpecs, [...SUPPORTED_CARRIER_SPECS])
  assert.equal(descriptor.kernelContract, KERNEL_CONTRACT_VERSION)
  assert.deepEqual(descriptor.uiLayers, [...HOST_UI_LAYERS])
  assert.equal(descriptor.supportsPopout, false, '浮窗仍是应用内 absolute 卡片，不假装多窗口')
  assert.deepEqual(descriptor.platforms, ['electron'])
})

test('盘上的 host-descriptor.json 与生成器逐字段一致（门禁 v 的同一口径）', async () => {
  const report = await checkHostDescriptor()
  assert.equal(report.error, null)
  assert.equal(report.ok, true, report.differences.map((item) => `${item.field}:${item.reason}`).join(', '))
  assert.deepEqual(report.differences, [])
})

test('反向断言：任一字段被人为改错，diffHostDescriptor 必须报出来（新增宿主视图忘改 descriptor 会被抓）', () => {
  const base = buildHostDescriptor()
  const mutations = [
    ['views', base.views.slice(0, -1)],
    ['views-order', [...base.views].reverse()],
    ['forms', base.forms.filter((form) => form !== 'immersive')],
    ['slots', [...base.slots, 'right']],
    ['reservedSlots', base.reservedSlots.slice(1)],
    ['carrierSpecs', base.carrierSpecs.slice(0, -1)],
    ['kernelContract', '9'],
    ['uiLayers', [...base.uiLayers, 'plugin-layer']],
    ['supportsPopout', true],
    ['platforms', ['electron', 'web']]
  ]
  for (const [label, value] of mutations) {
    const field = label.split('-')[0]
    const mutated = { ...base, [field]: value }
    assert.ok(diffHostDescriptor(mutated).length > 0, `${label} 改错后 diff 仍为空`)
  }
  // 多出来的顶层键也是漂移：描述符里写宿主不认识的东西，doctor 不会报，但门禁要报。
  const extra = { ...base, madeUpField: true }
  assert.deepEqual(diffHostDescriptor(extra).map((item) => item.field), ['madeUpField'])
  // 缺字段同样要报。
  const missing = { ...base }
  delete missing.views
  assert.deepEqual(diffHostDescriptor(missing).map((item) => `${item.field}:${item.reason}`), ['views:missing'])
})

test('规范序列化可回读，且解析结果与生成器相等（--write 不会改语义）', () => {
  const text = serializeHostDescriptor()
  assert.equal(text.endsWith('\n'), true)
  assert.deepEqual(JSON.parse(text), buildHostDescriptor())
  assert.deepEqual(diffHostDescriptor(JSON.parse(text)), [])
})
