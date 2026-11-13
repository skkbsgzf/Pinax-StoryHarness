import test from 'node:test'
import assert from 'node:assert/strict'
import { PREFS_DEFAULTS } from '../runtime/appPreferences.mjs'
import {
  applySectionReset,
  buildOverviewRows,
  canResetSection,
  CONTROL_HEIGHT,
  CONTROL_HEIGHT_TALL,
  FIELD_GAP,
  INPUT_MAX_WIDTH,
  OVERVIEW_FILE,
  OVERVIEW_KEYS,
  OVERVIEW_LAYER,
  overviewJson,
  resetSectionDefaults,
  SAVE_MODEL,
  saveModelNote,
  SECTION_GAP,
  TEXTAREA_MIN_HEIGHT,
  validatePrefsDraft,
  fieldStyleVars
} from '../shell/settings/fields.mjs'

/**
 * 设置页字段规范（工单 P2）的纯函数面：度量常量、保存模型文案、显式保存前的校验、
 * 「恢复本节默认」的载荷，以及设置总览的静态映射。
 * 这些是 SFC 与总览表共同引用的唯一一份数据——这里钉住，界面侧就不可能各写一套。
 */

test('字段行度量：节内 16／节间 32，控件高 36 或 40，输入 ≤480，长文本 ≥96', () => {
  assert.equal(FIELD_GAP, 16)
  assert.equal(SECTION_GAP, 32)
  assert.equal(CONTROL_HEIGHT, 36)
  assert.equal(CONTROL_HEIGHT_TALL, 40)
  assert.equal(INPUT_MAX_WIDTH, 480)
  assert.equal(TEXTAREA_MIN_HEIGHT, 96)

  // 注入到节根节点的变量与常量同源（写歪一个，界面就不是规范里那一档）。
  assert.deepEqual(fieldStyleVars(), {
    '--settings-field-gap': '16px',
    '--settings-section-gap': '32px',
    '--settings-control-height': '36px',
    '--settings-control-height-tall': '40px',
    '--settings-input-max': '480px',
    '--settings-textarea-min': '96px'
  })
})

test('保存模型：显式与即时各一句，写清「什么时候生效」；未知模型不编话', () => {
  assert.match(saveModelNote(SAVE_MODEL.explicit), /^显式保存：/u)
  assert.match(saveModelNote(SAVE_MODEL.explicit), /保存并生效/u)
  assert.match(saveModelNote(SAVE_MODEL.instant), /^即时保存：/u)
  assert.match(saveModelNote(SAVE_MODEL.instant), /改动即写/u)
  assert.equal(saveModelNote('unknown'), '')
  assert.equal(saveModelNote(undefined), '')
})

test('显式保存的校验：空端点归 null、非法端点与越界缩放逐字段报错', () => {
  const ok = validatePrefsDraft({ modelPlaneEndpoint: '  ', uiZoom: 1.1 })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.patch, { modelPlaneEndpoint: null, uiZoom: 1.1 })
  assert.deepEqual(ok.errors, {})

  const badEndpoint = validatePrefsDraft({ modelPlaneEndpoint: 'ftp://127.0.0.1:8451', uiZoom: 1 })
  assert.equal(badEndpoint.ok, false)
  assert.match(badEndpoint.errors.modelPlaneEndpoint, /http\(s\)/u)
  assert.equal(badEndpoint.errors.uiZoom, undefined)

  const badZoom = validatePrefsDraft({ modelPlaneEndpoint: 'http://127.0.0.1:8461', uiZoom: 2.5 })
  assert.equal(badZoom.ok, false)
  assert.match(badZoom.errors.uiZoom, /0\.5–2/u)
  assert.equal(badZoom.errors.modelPlaneEndpoint, undefined)

  // 空串／NaN 也是错：宁可拦在本地，也不发一个必被主进程拒的请求。
  assert.equal(validatePrefsDraft({ uiZoom: '' }).ok, false)
  assert.equal(validatePrefsDraft({ uiZoom: 'abc' }).ok, false)
  // 数字字符串照收（<input type="number"> 在 jsdom 里就是字符串）。
  assert.deepEqual(validatePrefsDraft({ uiZoom: '0.9' }).patch, { modelPlaneEndpoint: null, uiZoom: 0.9 })
})

test('恢复本节默认：载荷只有本节两个键，别的偏好一个都不动', () => {
  assert.equal(canResetSection('prefs'), true)
  assert.equal(canResetSection('services'), false)
  assert.equal(resetSectionDefaults('services'), null)

  const patch = resetSectionDefaults('prefs')
  assert.deepEqual(patch, { modelPlaneEndpoint: null, uiZoom: null })

  // 改返回的副本不影响常量（否则第二次「恢复默认」会带着上一轮的脏值）。
  patch.uiZoom = 1.7
  assert.deepEqual(resetSectionDefaults('prefs'), { modelPlaneEndpoint: null, uiZoom: null })

  const current = {
    modelPlaneEndpoint: 'http://127.0.0.1:8461',
    uiZoom: 1.6,
    writingFontSize: 20,
    writingLineHeight: 2.1,
    writingTypewriter: true,
    serviceNoticesAckedAt: '2026-11-01T00:00:00.000Z',
    recentProjects: [{ path: 'D:/books/大梦' }]
  }
  const merged = applySectionReset(current, 'prefs')
  assert.equal(merged.modelPlaneEndpoint, null)
  assert.equal(merged.uiZoom, null)
  // 只重置本节：写作排版、通知水位、最近库原值返回。
  assert.equal(merged.writingFontSize, 20)
  assert.equal(merged.writingLineHeight, 2.1)
  assert.equal(merged.writingTypewriter, true)
  assert.equal(merged.serviceNoticesAckedAt, '2026-11-01T00:00:00.000Z')
  assert.deepEqual(merged.recentProjects, [{ path: 'D:/books/大梦' }])
  assert.equal(applySectionReset(current, 'nope'), null)
})

test('设置总览：键表与应用级默认值逐个对账（加字段忘进总览会红）', () => {
  // 总览的键＝PREFS_DEFAULTS 的全部键＋theme（真源在偏好里，默认键不写在 DEFAULTS 里）。
  const expected = [...Object.keys(PREFS_DEFAULTS), 'theme'].sort()
  assert.deepEqual([...OVERVIEW_KEYS].sort(), expected)
  // 键不与 DEFAULTS 重复、也不漏（上面那条已覆盖），这里钉住「没有多出来的键」。
  assert.equal(new Set(OVERVIEW_KEYS).size, OVERVIEW_KEYS.length)
})

test('设置总览行：每个键都在，层与文件来自静态映射（快照断言）', () => {
  const prefs = {
    modelPlaneEndpoint: null,
    uiZoom: 0.9,
    historyIntervalMinutes: 5,
    writingFontSize: 17,
    writingLineHeight: 1.9,
    writingParagraphSpacing: 0.8,
    writingTextIndent: 2,
    writingTypewriter: false,
    writingFocusMode: false,
    serviceNoticesAckedAt: null,
    theme: 'dark',
    recentProjects: [{ path: 'D:/books/大梦', name: '大梦' }]
  }
  const rows = buildOverviewRows(prefs)
  assert.deepEqual(
    rows.map((row) => `${row.key}:${row.layer}:${row.file}`),
    [
      'modelPlaneEndpoint:应用:next-preferences.json',
      'uiZoom:应用:next-preferences.json',
      'historyIntervalMinutes:应用:next-preferences.json',
      'writingFontSize:应用:next-preferences.json',
      'writingLineHeight:应用:next-preferences.json',
      'writingParagraphSpacing:应用:next-preferences.json',
      'writingTextIndent:应用:next-preferences.json',
      'writingTypewriter:应用:next-preferences.json',
      'writingFocusMode:应用:next-preferences.json',
      'serviceNoticesAckedAt:应用:next-preferences.json',
      'theme:应用:next-preferences.json',
      'recentProjects:应用:next-preferences.json'
    ]
  )
  assert.equal(OVERVIEW_LAYER, '应用')
  assert.equal(OVERVIEW_FILE, 'next-preferences.json')

  const byKey = new Map(rows.map((row) => [row.key, row]))
  assert.equal(byKey.get('uiZoom').value, '0.9')
  assert.equal(byKey.get('theme').value, '"dark"', '字符串带引号：空串与 null 能分开看')
  assert.equal(byKey.get('modelPlaneEndpoint').value, 'null')
  assert.equal(byKey.get('writingTypewriter').value, 'false')
  assert.equal(byKey.get('recentProjects').value, '[{"path":"D:/books/大梦","name":"大梦"}]')
})

test('设置总览：缺值按 null 摆（不编默认），复制为 JSON 保留原值', () => {
  const rows = buildOverviewRows({ uiZoom: 1.2 })
  assert.equal(rows.find((row) => row.key === 'uiZoom').value, '1.2')
  assert.equal(rows.find((row) => row.key === 'theme').value, 'null')

  const parsed = JSON.parse(overviewJson(rows))
  assert.equal(parsed.uiZoom.layer, '应用')
  assert.equal(parsed.uiZoom.file, 'next-preferences.json')
  assert.equal(parsed.uiZoom.value, 1.2)
  // 缺值的键也在（排查时「这个键是空的」本身是信息）。
  assert.equal(parsed.theme.value, null)
  assert.ok('recentProjects' in parsed)

  // 空输入不炸：行表是空数组、JSON 是空对象。
  assert.deepEqual(buildOverviewRows(null).map((row) => row.key), [...OVERVIEW_KEYS])
  assert.equal(overviewJson([]), '{}')
})
