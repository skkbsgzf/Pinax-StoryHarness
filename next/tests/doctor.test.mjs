import test from 'node:test'
import assert from 'node:assert/strict'
import { DOCTOR_STATES, diagnoseAll, diagnoseCarrier, loadHostDescriptor } from '../doctor.mjs'
import { NOVEL_CARRIER } from '../carriers/novel/manifest.mjs'
import { OUTLINE_CARRIER } from '../carriers/outline/manifest.mjs'
import { NOTES_CARRIER } from '../carriers/notes/manifest.mjs'
import { WORLDBOOK_CARRIER } from '../carriers/worldbook/manifest.mjs'
import { SETTING_CARRIER } from '../carriers/setting/manifest.mjs'
import { SCRIPT_CARRIER } from '../carriers/script/manifest.mjs'
import { REFERENCE_CARRIER } from '../carriers/reference/manifest.mjs'
import { clone } from '../testing/fixtures.mjs'

/**
 * 宿主描述符与体检（M2.5-C 任务四）：五态各一条夹具，每种都带可执行的修复文案。
 * 描述符是「这台外壳今天是什么」的事实；doctor 只是把它和载体清单对表。
 */

const DESCRIPTOR = {
  descriptorVersion: 1,
  host: 'pinax-next-shell',
  kernelContract: '1',
  trustMode: 'same-process',
  slots: ['left-dock', 'center', 'overlay'],
  reservedSlots: ['right', 'top-menu'],
  forms: ['dock', 'split', 'overlay', 'fullscreen'],
  views: ['pinax.view.tree', 'pinax.view.list', 'pinax.view.editor', 'pinax.view.reader', 'pinax.view.diff', 'pinax.view.graph', 'pinax.view.custom'],
  uiLayers: ['shell-chrome', 'pane-content', 'floating-overlay'],
  supportsPopout: false,
  platforms: ['electron']
}

test('描述符：真实文件可读，字段齐全；不支持真多窗口如实写 false', () => {
  const loaded = loadHostDescriptor()
  assert.equal(loaded.ok, true, JSON.stringify(loaded.error ?? {}))
  const descriptor = loaded.value
  assert.equal(descriptor.descriptorVersion, 1)
  assert.equal(descriptor.kernelContract, '1')
  assert.equal(descriptor.host, 'pinax-next-shell')
  assert.equal(descriptor.supportsPopout, false, '今天的浮窗是应用内 absolute 卡片，不假装多窗口')
  assert.deepEqual(descriptor.slots, ['left-dock', 'center', 'overlay'])
  assert.deepEqual(descriptor.forms, ['dock', 'split', 'overlay', 'fullscreen'])
  assert.ok(descriptor.views.includes('pinax.view.custom'))
  assert.deepEqual(DOCTOR_STATES, ['ok', 'needs-host-upgrade', 'missing-capability', 'permission-denied', 'incompatible-form'])
})

test('ok：真清单对得上宿主', () => {
  const report = diagnoseCarrier(NOVEL_CARRIER, { descriptor: DESCRIPTOR })
  assert.equal(report.state, 'ok', report.message)
  assert.equal(report.fix, '')
  assert.equal(report.manifestId, 'pinax.carrier.novel')
})

test('七个内置载体全部对得上真描述符：没有一个需要升级／降权／换形态', () => {
  const loaded = loadHostDescriptor()
  assert.equal(loaded.ok, true)
  const carriers = [NOVEL_CARRIER, OUTLINE_CARRIER, NOTES_CARRIER, WORLDBOOK_CARRIER, SETTING_CARRIER, SCRIPT_CARRIER, REFERENCE_CARRIER]
  const reports = diagnoseAll(carriers, { descriptor: loaded.value })
  assert.equal(reports.length, 7)
  for (const report of reports) {
    assert.equal(report.state, 'ok', `${report.manifestId}: ${report.message} → ${report.fix}`)
  }
})

test('needs-host-upgrade：minKernel 高于外壳合同 / 外壳不认 v2 合同', () => {
  const newer = clone(NOVEL_CARRIER)
  newer.minKernel = '3'
  const report = diagnoseCarrier(newer, { descriptor: DESCRIPTOR })
  assert.equal(report.state, 'needs-host-upgrade')
  assert.match(report.fix, /升级外壳/u)

  const oldHost = { ...DESCRIPTOR, kernelContract: '0' }
  const legacyHost = diagnoseCarrier(OUTLINE_CARRIER, { descriptor: oldHost })
  assert.equal(legacyHost.state, 'needs-host-upgrade')
  assert.match(legacyHost.fix, /pinax-carrier@1|升到/u)
})

test('missing-capability：requires 在已安装集合里凑不齐，fix 用载体自己给的那句', () => {
  const demanding = clone(NOVEL_CARRIER)
  demanding.requires = [{ capability: 'outline.tree', min: 1, fix: '装大纲载体，或在 requires 里去掉它' }]
  const report = diagnoseCarrier(demanding, { descriptor: DESCRIPTOR, installed: [demanding] })
  assert.equal(report.state, 'missing-capability')
  assert.match(report.fix, /装大纲载体/u)

  const satisfied = diagnoseCarrier(demanding, { descriptor: DESCRIPTOR, installed: [demanding, OUTLINE_CARRIER] })
  assert.equal(satisfied.state, 'ok', satisfied.message)
})

test('permission-denied：保留槽 / 别人的目录 / 网络（same-process 没有网络层）', () => {
  const reserved = clone(NOVEL_CARRIER)
  reserved.contributes.panes.push({ slot: 'right', id: 'novel.chat', title: '聊天' })
  const reservedReport = diagnoseCarrier(reserved, { descriptor: DESCRIPTOR })
  assert.equal(reservedReport.state, 'permission-denied')
  assert.match(reservedReport.fix, /left-dock/u)

  const foreign = clone(NOVEL_CARRIER)
  foreign.permissions = [{ type: 'file', dir: '世界书', mode: 'rw' }]
  const foreignReport = diagnoseCarrier(foreign, { descriptor: DESCRIPTOR })
  assert.equal(foreignReport.state, 'permission-denied')
  assert.match(foreignReport.fix, /dataDirs/u)

  const network = clone(NOVEL_CARRIER)
  network.permissions = [{ type: 'file', dir: '正文', mode: 'rw' }, 'net:*']
  const networkReport = diagnoseCarrier(network, { descriptor: DESCRIPTOR })
  assert.equal(networkReport.state, 'permission-denied')
  assert.match(networkReport.fix, /网络/u)
})

test('incompatible-form：未知形态 / 未知视图类型', () => {
  const badForm = clone(NOVEL_CARRIER)
  badForm.contributes.panes[0].forms = ['dock', 'popout']
  const formReport = diagnoseCarrier(badForm, { descriptor: DESCRIPTOR })
  assert.equal(formReport.state, 'incompatible-form')
  assert.match(formReport.fix, /forms|宿主支持的集合/u)

  const badView = clone(NOVEL_CARRIER)
  badView.contributes.panes[0].view = 'pinax.view.kanban'
  const viewReport = diagnoseCarrier(badView, { descriptor: DESCRIPTOR })
  assert.equal(viewReport.state, 'incompatible-form')
  assert.match(viewReport.fix, /pinax\.view\./u)

  // 结构性错误也落到五态之一，而不是第五条之外的「未知」。
  const broken = clone(NOVEL_CARRIER)
  delete broken.primary
  const brokenReport = diagnoseCarrier(broken, { descriptor: DESCRIPTOR })
  assert.ok(DOCTOR_STATES.includes(brokenReport.state), brokenReport.state)
  assert.notEqual(brokenReport.state, 'ok')
  assert.ok(brokenReport.fix.length > 0, '每种状态都要给一句修复')
})

test('diagnoseAll：按输入顺序逐份出报告，installed 缺省即这批清单自己', () => {
  const reports = diagnoseAll([NOVEL_CARRIER, OUTLINE_CARRIER], { descriptor: DESCRIPTOR })
  assert.deepEqual(reports.map((item) => item.manifestId), ['pinax.carrier.novel', 'pinax.carrier.outline'])
  assert.equal(reports.every((item) => item.state === 'ok'), true, JSON.stringify(reports))
})
