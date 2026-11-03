import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DOCTOR_STATES, diagnoseAll, diagnoseCarrier, loadHostDescriptor } from '../doctor.mjs'
import { PANE_FORMS } from '../shell/paneForms.mjs'
import { PANE_FORM_WORDS } from '../kernel/carrierManifest.mjs'
import { NOVEL_CARRIER } from '../carriers/novel/manifest.mjs'
import { OUTLINE_CARRIER } from '../carriers/outline/manifest.mjs'
import { NOTES_CARRIER } from '../carriers/notes/manifest.mjs'
import { WORLDBOOK_CARRIER } from '../carriers/worldbook/manifest.mjs'
import { DOSSIER_CARRIER } from '../carriers/dossier/manifest.mjs'
import { SCRIPT_CARRIER } from '../carriers/script/manifest.mjs'
import { MATERIAL_CARRIER } from '../carriers/material/manifest.mjs'
import { COMIC_CARRIER } from '../carriers/comic/manifest.mjs'
import { VIDEO_CARRIER } from '../carriers/video/manifest.mjs'
import { EXPERIENCE_CARRIER } from '../carriers/experience/manifest.mjs'
import { ONLINE_CARRIER } from '../carriers/online/manifest.mjs'
import { clone } from '../testing/fixtures.mjs'

/**
 * 宿主描述符与体检（M2.5-C 任务四）：五态各一条夹具，每种都带可执行的修复文案。
 * 描述符是「这台外壳今天是什么」的事实；doctor 只是把它和载体清单对表。
 */

/**
 * 批次66 前置裁定 Q2 删掉的两个整窗旧词。它们不在任何词表里了（词表就是「不许有它们」这件事），
 * 所以这份守卫自己点名——「全仓零声明」这条断言的判据只能写在测试里，不能写在被测模块里。
 */
const RETIRED_FORMS = Object.freeze(['fullscreen', 'immersive'])

const DESCRIPTOR = {
  descriptorVersion: 1,
  host: 'pinax-next-shell',
  kernelContract: '1',
  // 白名单照抄真实的 next/host-descriptor.json：批次52 起外壳认 @1/@2/@3/@4 四份合同。
  carrierSpecs: ['pinax-carrier@1', 'pinax-carrier@2', 'pinax-carrier@3', 'pinax-carrier@4'],
  trustMode: 'same-process',
  slots: ['left-dock', 'center', 'overlay'],
  reservedSlots: ['right', 'top-menu'],
  forms: ['dock', 'split', 'overlay'],
  // 批次58：画布用 pinax.view.app（真实描述符里也有这一项）；批次54 的来源层用例要能诊断漫画。
  views: ['pinax.view.tree', 'pinax.view.list', 'pinax.view.editor', 'pinax.view.reader', 'pinax.view.diff', 'pinax.view.graph', 'pinax.view.app', 'pinax.view.custom'],
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
  // 批次66（前置裁定 Q2）：形态词表收敛成三档，描述符由词表生成，所以这里就是那三档。
  assert.deepEqual(descriptor.forms, ['dock', 'split', 'overlay'])
  assert.ok(descriptor.views.includes('pinax.view.custom'))
  // 批次52：六态——adopted-external 是「合法清单，但服务由外部进程自管」的事实，不是故障。
  assert.deepEqual(DOCTOR_STATES, ['ok', 'adopted-external', 'needs-host-upgrade', 'missing-capability', 'permission-denied', 'incompatible-form'])
})

test('ok：真清单对得上宿主', () => {
  const report = diagnoseCarrier(NOVEL_CARRIER, { descriptor: DESCRIPTOR })
  assert.equal(report.state, 'ok', report.message)
  assert.equal(report.fix, '')
  assert.equal(report.manifestId, 'pinax.carrier.novel')
})

test('六个内置载体全部对得上真描述符：没有一个需要升级／降权／换形态', () => {
  const loaded = loadHostDescriptor()
  assert.equal(loaded.ok, true)
  const carriers = [NOVEL_CARRIER, OUTLINE_CARRIER, NOTES_CARRIER, WORLDBOOK_CARRIER, SCRIPT_CARRIER, DOSSIER_CARRIER]
  const reports = diagnoseAll(carriers, { descriptor: loaded.value })
  assert.equal(reports.length, 6)
  for (const report of reports) {
    assert.equal(report.state, 'ok', `${report.manifestId}: ${report.message} → ${report.fix}`)
  }
})

test('形态词表三档（批次66 裁定 Q2）：十一个载体的 forms 声明里没有整窗旧词，且全部落在词表内', async () => {
  const carriers = [NOVEL_CARRIER, OUTLINE_CARRIER, NOTES_CARRIER, WORLDBOOK_CARRIER, SCRIPT_CARRIER, DOSSIER_CARRIER,
    MATERIAL_CARRIER, COMIC_CARRIER, VIDEO_CARRIER, EXPERIENCE_CARRIER, ONLINE_CARRIER]
  const vocab = new Set(PANE_FORMS)
  let declared = 0
  for (const carrier of carriers) {
    for (const pane of carrier.contributes.panes) {
      if (!Array.isArray(pane.forms)) continue
      declared += 1
      for (const form of pane.forms) {
        assert.equal(vocab.has(form), true, `${carrier.id}/${pane.id} 声明了词表外形态：${form}`)
        assert.equal(RETIRED_FORMS.includes(form), false, `${carrier.id}/${pane.id} 又声明了整窗旧词：${form}`)
      }
    }
  }
  // 批次61 起这份声明就是右键菜单项的唯一来源：一个都没有＝菜单永远空，收敛收成删光了。
  assert.ok(declared >= 20, `带 forms 声明的 pane 只有 ${declared} 块，不像话`)

  // 声明面源码扫描：每份清单里 `forms: [...]` 那一串不许出现旧词（注释里讲历史不算违规）。
  const carriersDir = fileURLToPath(new URL('../carriers', import.meta.url))
  const dirs = (await readdir(carriersDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  assert.equal(dirs.length, 11, '载体数变了：这份守卫要跟着点名')
  for (const dir of dirs) {
    const source = await readFile(join(carriersDir, dir, 'manifest.mjs'), 'utf-8')
    const declarations = [...source.matchAll(/forms\s*:\s*\[([^\]]*)\]/gu)]
    assert.ok(declarations.length > 0, `carriers/${dir}/manifest.mjs 一条 forms 声明都没扫到：守卫写法失效了`)
    for (const match of declarations) {
      for (const word of RETIRED_FORMS) {
        assert.equal(match[1].includes(word), false, `carriers/${dir}/manifest.mjs 的 forms 声明残留旧词：[${match[1].trim()}]`)
      }
    }
  }
  // 两份词表（渲染层 / 内核校验层）也必须是三档——清单和宿主对不上就是体检红。
  assert.deepEqual(PANE_FORM_WORDS, [...PANE_FORMS])
  const loaded = loadHostDescriptor()
  assert.deepEqual(loaded.value.forms, [...PANE_FORMS])

  // 十一个载体在真描述符下仍然全部 ok（批次60 设定与资料合并后 12→11）。
  const all = diagnoseAll(carriers, { descriptor: loaded.value })
  assert.equal(all.length, 11)
  for (const report of all) assert.equal(report.state, 'ok', `${report.manifestId}: ${report.message}`)
})

test('needs-host-upgrade：minKernel 高于外壳合同 / 外壳不认 v2 合同', () => {
  const newer = clone(NOVEL_CARRIER)
  newer.minKernel = '3'
  const report = diagnoseCarrier(newer, { descriptor: DESCRIPTOR })
  assert.equal(report.state, 'needs-host-upgrade')
  assert.match(report.fix, /升级外壳/u)

  // 外壳合同太老（kernelContract 0）：@3 合同本身它认，但内核门槛过不了。
  const oldHost = { ...DESCRIPTOR, kernelContract: '0' }
  const legacyHost = diagnoseCarrier(OUTLINE_CARRIER, { descriptor: oldHost })
  assert.equal(legacyHost.state, 'needs-host-upgrade')
  assert.match(legacyHost.fix, /升级外壳/u)

  // 老描述符没有 carrierSpecs 白名单：只认 v1/v2，@3 载体直接被判「外壳不认这个合同」。
  const legacyDescriptor = { ...DESCRIPTOR }
  delete legacyDescriptor.carrierSpecs
  const unknownSpec = diagnoseCarrier(OUTLINE_CARRIER, { descriptor: legacyDescriptor })
  assert.equal(unknownSpec.state, 'needs-host-upgrade')
  assert.match(unknownSpec.fix, /pinax-carrier@1|升到/u)
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

test('批次54：来源层摊开——服务端口与设置值各自标明清单默认/工程覆盖', () => {
  // 服务：漫画预览端口被工程覆盖改过，诊断要给出合并后的端口与来源层。
  const comic = clone(COMIC_CARRIER)
  const comicReport = diagnoseCarrier(comic, {
    descriptor: DESCRIPTOR,
    overrides: { 'pinax.carrier.comic': { 'comic-preview': { port: 8200 } } }
  })
  assert.equal(comicReport.state, 'ok', comicReport.message)
  const serviceCheck = comicReport.checks.find((check) => check.name === 'service-port-source')
  assert.ok(serviceCheck, '服务端口来源层要有读取点')
  assert.equal(serviceCheck.services[0].id, 'comic-preview')
  assert.equal(serviceCheck.services[0].port, 8200)
  assert.equal(serviceCheck.services[0].portSource, 'override')
  assert.deepEqual(serviceCheck.services[0].overrideFields, ['port'])

  // 设置：novel 补一条可写声明（@4），覆盖值进 effective，来源标「工程覆盖」。
  const novel = clone(NOVEL_CARRIER)
  novel.contributes.settings.push({ id: 'novel.font', title: '字号', type: 'number', default: 17, min: 12, max: 24, step: 1, volatile: true })
  const novelReport = diagnoseCarrier(novel, {
    descriptor: DESCRIPTOR,
    overrides: { 'pinax.carrier.novel': { 'novel.font': 14 } },
    settings: {}
  })
  assert.equal(novelReport.state, 'ok', novelReport.message)
  const settingsCheck = novelReport.checks.find((check) => check.name === 'settings-source')
  assert.ok(settingsCheck, '设置值来源层要有读取点')
  const row = settingsCheck.settings.settings.find((item) => item.id === 'novel.font')
  assert.deepEqual(row, { id: 'novel.font', value: 14, source: 'override', label: '工程覆盖', volatile: true })

  // 项目设置优先于覆盖：stored 写了值就以 stored 为来源。
  const storedReport = diagnoseCarrier(novel, {
    descriptor: DESCRIPTOR,
    overrides: { 'pinax.carrier.novel': { 'novel.font': 14 } },
    settings: { 'pinax.carrier.novel': { 'novel.font': 16 } }
  })
  const storedRow = storedReport.checks
    .find((check) => check.name === 'settings-source')
    .settings.settings.find((item) => item.id === 'novel.font')
  assert.equal(storedRow.value, 16)
  assert.equal(storedRow.source, 'stored')
  assert.equal(storedRow.label, '项目设置')

  // 越界覆盖不生效：回清单默认，并在诊断里留一条警告。
  const badReport = diagnoseCarrier(novel, {
    descriptor: DESCRIPTOR,
    overrides: { 'pinax.carrier.novel': { 'novel.font': 99 } }
  })
  const badCheck = badReport.checks.find((check) => check.name === 'settings-source').settings
  assert.equal(badCheck.settings.find((item) => item.id === 'novel.font').value, 17)
  assert.ok(badCheck.warnings.includes('SETTING_OUT_OF_RANGE:novel.font:pinax.carrier.novel/novel.font'))
})

test('diagnoseAll：按输入顺序逐份出报告，installed 缺省即这批清单自己', () => {
  const reports = diagnoseAll([NOVEL_CARRIER, OUTLINE_CARRIER], { descriptor: DESCRIPTOR })
  assert.deepEqual(reports.map((item) => item.manifestId), ['pinax.carrier.novel', 'pinax.carrier.outline'])
  assert.equal(reports.every((item) => item.state === 'ok'), true, JSON.stringify(reports))
})
