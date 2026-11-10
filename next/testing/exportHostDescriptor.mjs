#!/usr/bin/env node
/* eslint-disable no-console */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { KERNEL_CONTRACT_VERSION, SUPPORTED_CARRIER_SPECS } from '../kernel/carrierManifest.mjs'
import { OPEN_SLOTS, RESERVED_SLOTS } from '../shell/slots.mjs'
import { PANE_FORMS } from '../shell/paneForms.mjs'
import { VIEW_TYPES } from '../shell/viewRegistry.mjs'

/**
 * 批次57（Cordis 线C）：宿主描述符的**唯一生成器**。
 *
 * 病根：`next/host-descriptor.json` 一直是手填的。加了宿主视图／槽位／形态之后，
 * doctor 只核字段「在不在」，核不出「描述符写的和注册表真实支持的」不一致——
 * 于是文档悄悄漂移。这里把描述符从词表常量现算出来，打包门禁逐字段对比；
 * 想改描述符，就改生成器（或它读的词表），再跑 `node next/testing/exportHostDescriptor.mjs --write`。
 *
 * 取值来源：
 *   views          ← viewRegistry 的 VIEW_TYPES（宿主八视图 ＋ custom，共九项）
 *   forms          ← paneForms 的 PANE_FORMS（五态）
 *   slots          ← slots 的 OPEN_SLOTS（三槽）
 *   reservedSlots  ← slots 的 RESERVED_SLOTS 键（right／top-menu）
 *   carrierSpecs   ← carrierManifest 的 SUPPORTED_CARRIER_SPECS
 *   kernelContract ← carrierManifest 的 KERNEL_CONTRACT_VERSION
 *
 * 没有现成词表的三项（uiLayers／trustMode／supportsPopout／platforms）是宿主的结构事实，
 * 由本生成器持有；它们不在别处被消费成词表，所以生成器即权威，不需要第二份解释。
 */

export const HOST_DESCRIPTOR_FILE = fileURLToPath(new URL('../host-descriptor.json', import.meta.url))

/**
 * 宿主 UI 层序（由外到内、由底到顶）：外壳 chrome → pane 内容 → 悬浮浮窗。
 * 对应 next/shell/styles/next-shell.css 的 --z-floating-dock 层级与 FloatingWidget 的定位归属；
 * 宿主只承认这三层，插件不自带层（浮窗的定位／收起／记忆也归宿主）。
 */
export const HOST_UI_LAYERS = Object.freeze(['shell-chrome', 'pane-content', 'floating-overlay'])

/** 生成描述符：键序固定，数组顺序即词表顺序（对比时按序严格比较）。 */
export function buildHostDescriptor() {
  return {
    descriptorVersion: 1,
    host: 'pinax-next-shell',
    kernelContract: KERNEL_CONTRACT_VERSION,
    carrierSpecs: [...SUPPORTED_CARRIER_SPECS],
    trustMode: 'same-process',
    slots: [...OPEN_SLOTS],
    reservedSlots: Object.keys(RESERVED_SLOTS),
    forms: [...PANE_FORMS],
    views: [...VIEW_TYPES],
    uiLayers: [...HOST_UI_LAYERS],
    supportsPopout: false,
    platforms: ['electron']
  }
}

/** 规范输出：两格缩进＋末尾换行（与仓库里的 host-descriptor.json 同一形态）。 */
export function serializeHostDescriptor() {
  return `${JSON.stringify(buildHostDescriptor(), null, 2)}\n`
}

function jsonEqual(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]))
  }
  return false
}

/**
 * 逐字段对比：expected 来自生成器，actual 是盘上那份。
 * 返回的每一条都带 field／reason／expected／actual；空数组＝完全一致。
 * 多出来的顶层键也记一条（描述符里写宿主不认识的东西同样是漂移）。
 */
export function diffHostDescriptor(actual) {
  const expected = buildHostDescriptor()
  const source = actual && typeof actual === 'object' ? actual : {}
  const differences = []
  for (const field of Object.keys(expected)) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      differences.push({ field, reason: 'missing', expected: expected[field], actual: undefined })
      continue
    }
    if (!jsonEqual(expected[field], source[field])) {
      differences.push({ field, reason: 'value', expected: expected[field], actual: source[field] })
    }
  }
  for (const field of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(expected, field)) {
      differences.push({ field, reason: 'unexpected', expected: undefined, actual: source[field] })
    }
  }
  return differences
}

/** 读盘并对比；读不到／坏 JSON 也返回可渲染的失败载荷，门禁据此报红。 */
export async function checkHostDescriptor(file = HOST_DESCRIPTOR_FILE) {
  const generated = buildHostDescriptor()
  let text
  try {
    text = await readFile(file, 'utf-8')
  } catch (error) {
    return {
      ok: false,
      file,
      generated,
      actual: null,
      differences: [],
      error: { code: 'DESCRIPTOR_UNREADABLE', message: `读不到宿主描述符 ${file}：${String(error?.message ?? error)}` }
    }
  }
  let actual
  try {
    actual = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      file,
      generated,
      actual: null,
      differences: [],
      error: { code: 'DESCRIPTOR_BAD_JSON', message: `宿主描述符不是合法 JSON：${String(error?.message ?? error)}` }
    }
  }
  const differences = diffHostDescriptor(actual)
  return { ok: differences.length === 0, file, generated, actual, differences, error: null }
}

function describeDifference(difference) {
  const { field, reason } = difference
  const show = (value) => value === undefined ? '(缺)' : JSON.stringify(value)
  if (reason === 'missing') return `${field} 缺失（应为 ${show(difference.expected)}）`
  if (reason === 'unexpected') return `${field} 是生成器不认识的字段（实际 ${show(difference.actual)}）`
  return `${field} 不一致（应为 ${show(difference.expected)}，实际 ${show(difference.actual)}）`
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const args = process.argv.slice(2)
  if (args.includes('--write')) {
    await writeFile(HOST_DESCRIPTOR_FILE, serializeHostDescriptor(), 'utf-8')
    console.log(`已按生成器写出 ${HOST_DESCRIPTOR_FILE}`)
  } else if (args.includes('--print')) {
    process.stdout.write(serializeHostDescriptor())
  } else {
    const report = await checkHostDescriptor()
    if (report.error) {
      console.error(report.error.message)
      process.exitCode = 1
    } else if (!report.ok) {
      console.error(`宿主描述符与生成器不一致（${report.differences.length} 处）：`)
      for (const difference of report.differences) console.error(`  - ${describeDifference(difference)}`)
      console.error('改词表后跑 node next/testing/exportHostDescriptor.mjs --write 重新导出。')
      process.exitCode = 1
    } else {
      console.log('宿主描述符与生成器一致：views／forms／slots／uiLayers 等逐字段对上。')
    }
  }
}
