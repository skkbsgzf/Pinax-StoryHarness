import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CARRIER_SPEC_V1,
  CARRIER_SPEC_V2,
  KERNEL_CONTRACT_VERSION,
  OPEN_SLOTS,
  RESERVED_SLOTS,
  validateCarrierManifest
} from './kernel/carrierManifest.mjs'

/**
 * 宿主描述符 + 载体体检（工单 C4）。
 *
 * 描述符是「这台外壳今天是什么」的机器可读事实：能开哪些槽、认哪几种形态、认哪几种视图、
 * 有没有真多窗口（supportsPopout:false——今天的 FloatingWidget 是应用内 absolute 卡片）。
 * doctor 拿它和任意一份载体清单对表，产出五态之一，每种都带一句能照着做的修复：
 *
 *   ok                 清单与宿主对得上
 *   needs-host-upgrade 载体要的新合同／新内核，这台外壳还没有（升级外壳，或调低 minKernel）
 *   missing-capability 依赖的能力在已安装集合里凑不齐（装对应载体，或去掉 requires）
 *   permission-denied  要了宿主不给的东西：保留槽、别人的目录、网络（换槽／换目录／去掉申请）
 *   incompatible-form  形态／视图宿主不认（改用宿主支持的 forms／views）
 *
 * 纯函数为主：诊断不读盘也可以（descriptor 可注入）；CLI 只在被直接执行时才读文件。
 */
export const DOCTOR_STATES = Object.freeze([
  'ok',
  'needs-host-upgrade',
  'missing-capability',
  'permission-denied',
  'incompatible-form'
])

export const HOST_DESCRIPTOR_FILE = fileURLToPath(new URL('./host-descriptor.json', import.meta.url))

/** 读描述符；坏 JSON／缺字段都返回可渲染的失败载荷（doctor 自己先不崩）。 */
export function loadHostDescriptor(file = HOST_DESCRIPTOR_FILE) {
  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch (error) {
    return { ok: false, error: { code: 'DESCRIPTOR_UNREADABLE', message: `读不到宿主描述符 ${file}：${String(error?.message ?? error)}` } }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: { code: 'DESCRIPTOR_BAD_JSON', message: `宿主描述符不是合法 JSON：${String(error?.message ?? error)}` } }
  }
  const missing = ['descriptorVersion', 'host', 'kernelContract', 'trustMode', 'slots', 'forms', 'views', 'uiLayers', 'supportsPopout', 'platforms']
    .filter((key) => parsed?.[key] === undefined)
  if (missing.length) {
    return { ok: false, error: { code: 'DESCRIPTOR_INCOMPLETE', message: `宿主描述符缺字段：${missing.join(' / ')}` } }
  }
  return { ok: true, value: parsed }
}

/** 诊断一次：返回 { state, manifestId, message, fix, checks }。state 不在五态里就是 doctor 自身的 bug。 */
export function diagnoseCarrier(manifestInput, { descriptor, installed = [], kinds = null } = {}) {
  const host = descriptor ?? loadHostDescriptor()
  if (host?.ok === false) {
    return result('needs-host-upgrade', manifestInput, '宿主描述符不可读，无法判定兼容性', `先修好 ${HOST_DESCRIPTOR_FILE}（${host.error.message}）`, [])
  }
  const desc = host?.value ?? host
  const manifestId = String(manifestInput?.id ?? '(未命名)')
  const checks = []

  // 1) 合同版本与内核门槛：这两条不合适，后面的检查都无从谈起。
  // 描述符带 carrierSpecs 时按这份白名单判；老描述符没有这一项，只认 v1/v2（v3 必须显式声明）。
  const spec = manifestInput?.spec
  if (typeof spec === 'string' && spec !== CARRIER_SPEC_V1 && !descSupportsSpec(desc, spec)) {
    return result('needs-host-upgrade', { id: manifestId }, `外壳合同 ${desc.kernelContract} 还不认 ${spec}`, `把外壳升到认 ${spec} 的版本（描述符 carrierSpecs 里登记它），或让载体暂时写 ${CARRIER_SPEC_V1}`, checks)
  }
  if (!compatibleKernelFor(manifestInput?.minKernel, desc)) {
    return result('needs-host-upgrade', { id: manifestId }, `载体要求 minKernel=${String(manifestInput?.minKernel)}，外壳合同是 ${desc.kernelContract}`, '升级外壳，或把 minKernel 调到外壳合同版本以内', checks)
  }
  checks.push({ name: 'kernel', state: 'ok' })

  // 2) 权限与槽位：宿主不给的东西不靠「装上了再说」。
  const permission = checkPermissions(manifestInput, desc)
  if (permission) return permission
  checks.push({ name: 'permission', state: 'ok' })

  // 3) 形态与视图：先按 v2 的 contributes.panes，退回 v1 的顶层 panes。
  const panes = Array.isArray(manifestInput?.contributes?.panes)
    ? manifestInput.contributes.panes
    : Array.isArray(manifestInput?.panes) ? manifestInput.panes : []
  const forms = checkForms(panes, desc, manifestId)
  if (forms) return forms
  checks.push({ name: 'form', state: 'ok' })
  const views = checkViews(panes, manifestInput?.contributes?.renderers, desc, manifestId)
  if (views) return views
  checks.push({ name: 'view', state: 'ok' })

  // 4) 依赖闭包：已安装集合的 provides 凑不齐 requires 就是缺口。
  const gap = checkCapabilities(manifestInput, installed, kinds)
  if (gap) return gap
  checks.push({ name: 'capability', state: 'ok' })

  // 5) 整份清单过一遍内核校验器：前面没拦住的结构性错误仍要落到五态之一。
  const validation = validateCarrierManifest(manifestInput, { kinds })
  if (!validation.ok) {
    const mapped = mapValidationError(validation.error)
    return result(mapped.state, { id: manifestId }, validation.error.message, mapped.fix, checks)
  }
  checks.push({ name: 'manifest', state: 'ok' })
  return result('ok', { id: manifestId }, '清单与宿主对得上', '', checks)
}

/** 一次诊断多份：每份结果保持输入顺序。 */
export function diagnoseAll(manifests = [], options = {}) {
  const installed = options.installed ?? manifests
  return manifests.map((manifest) => diagnoseCarrier(manifest, { ...options, installed }))
}

function result(state, manifest, message, fix, checks) {
  return { state, manifestId: String(manifest?.id ?? '(未命名)'), message, fix, checks: [...checks] }
}

function descSupportsSpec(desc, spec) {
  if (Array.isArray(desc.carrierSpecs)) return desc.carrierSpecs.includes(spec)
  // 老描述符没有 carrierSpecs：按内核合同判定，等价于只认 v1/v2。
  const version = Number.parseInt(String(desc.kernelContract ?? '0').split('.')[0], 10)
  return version >= 1 && (spec === CARRIER_SPEC_V1 || spec === CARRIER_SPEC_V2)
}

function compatibleKernelFor(minKernel, desc) {
  const raw = String(minKernel ?? '').trim()
  if (!/^\d+(\.\d+){0,2}$/.test(raw)) return false
  const wanted = Number.parseInt(raw.split('.')[0], 10)
  const host = Number.parseInt(String(desc.kernelContract ?? KERNEL_CONTRACT_VERSION).split('.')[0], 10)
  return wanted <= host
}

function checkPermissions(manifest, desc) {
  const panes = Array.isArray(manifest?.contributes?.panes) ? manifest.contributes.panes : Array.isArray(manifest?.panes) ? manifest.panes : []
  const reserved = new Set([...(desc.reservedSlots ?? RESERVED_SLOTS)])
  const open = new Set(desc.slots ?? OPEN_SLOTS)
  for (const pane of panes) {
    if (reserved.has(pane?.slot)) {
      return result('permission-denied', manifest, `槽位「${pane.slot}」是宿主保留字（右栏/顶层菜单归外壳与运行时）`, `把 pane「${pane?.id ?? '?'}」换到 ${[...open].join(' / ')}`, [])
    }
    if (!open.has(pane?.slot)) {
      return result('permission-denied', manifest, `宿主不开槽「${String(pane?.slot)}」`, `改用宿主开放槽：${[...open].join(' / ')}`, [])
    }
  }
  const permissions = permissionList(manifest)
  const owned = new Set(Object.values(manifest?.dataDirs ?? {}))
  for (const entry of permissions) {
    if (entry.type === 'file') {
      if (!owned.has(entry.dir)) {
        return result('permission-denied', manifest, `想拿 file:${entry.dir}:${entry.mode}，但「${entry.dir}」不在 dataDirs`, `只申请自己 dataDirs 里的目录（${[...owned].join(' / ') || '先声明 dataDirs'}），跨载体请走对方的 tools`, [])
      }
    } else if (entry.type === 'net') {
      if (desc.trustMode === 'same-process') {
        return result('permission-denied', manifest, '要求网络访问，本外壳是 same-process 载体、没有网络层', '去掉网络权限申请；需要联网的素材请走主进程已声明的服务', [])
      }
    }
  }
  return null
}

/** v2 的 permissions（对象）与 v1 的 scopes（串）统一成 { type, dir, mode }。 */
function permissionList(manifest) {
  const raw = Array.isArray(manifest?.permissions) ? manifest.permissions : Array.isArray(manifest?.scopes) ? manifest.scopes : []
  const out = []
  for (const item of raw) {
    if (typeof item === 'object' && item !== null) {
      out.push({ type: String(item.type ?? 'file'), dir: item.dir, mode: item.mode ?? 'r' })
      continue
    }
    if (typeof item !== 'string') continue
    const parts = item.split(':')
    out.push({ type: parts[0], dir: parts[1], mode: parts[2] })
  }
  return out
}

function checkForms(panes, desc, manifestId) {
  const hostForms = new Set(desc.forms ?? [])
  for (const pane of panes) {
    if (!Array.isArray(pane?.forms)) continue
    for (const form of pane.forms) {
      if (!hostForms.has(form)) {
        return result('incompatible-form', { id: manifestId }, `pane「${pane?.id ?? '?'}」要求形态「${String(form)}」，宿主只认 ${[...hostForms].join(' / ')}`, `把 forms 收窄到宿主支持的集合，或去掉 forms 声明（缺省＝宿主全开）`, [])
      }
    }
  }
  return null
}

function checkViews(panes, renderers, desc, manifestId) {
  const hostViews = new Set(desc.views ?? [])
  for (const pane of panes) {
    if (typeof pane?.view !== 'string') continue
    if (!hostViews.has(pane.view)) {
      return result('incompatible-form', { id: manifestId }, `pane「${pane?.id ?? '?'}」声明视图 ${pane.view}，宿主没有这个视图类型`, `改用宿主视图：${[...hostViews].join(' / ')}；自定义面请声明 pinax.view.custom`, [])
    }
  }
  for (const renderer of Array.isArray(renderers) ? renderers : []) {
    const type = typeof renderer === 'string' ? renderer : renderer?.type
    if (typeof type === 'string' && !hostViews.has(type)) {
      return result('incompatible-form', { id: manifestId }, `renderer 类型 ${type} 宿主不认`, `只用宿主列出的视图类型（${[...hostViews].join(' / ')}）`, [])
    }
  }
  return null
}

function checkCapabilities(manifest, installed, kinds) {
  const requires = Array.isArray(manifest?.requires) ? manifest.requires : []
  if (!requires.length) return null
  const provided = new Map()
  for (const other of installed) {
    const list = Array.isArray(other?.provides) ? other.provides : Array.isArray(other?.capabilities) ? other.capabilities : []
    for (const capability of list) provided.set(capability, (provided.get(capability) ?? 0) + 1)
  }
  const own = Array.isArray(manifest?.provides) ? manifest.provides : Array.isArray(manifest?.capabilities) ? manifest.capabilities : []
  for (const capability of own) provided.set(capability, (provided.get(capability) ?? 0) + 1)
  const gaps = []
  for (const item of requires) {
    const capability = typeof item === 'string' ? item : item?.capability
    const min = typeof item === 'object' && Number.isSafeInteger(item?.min) ? item.min : 1
    if ((provided.get(capability) ?? 0) < min) gaps.push({ capability, min, have: provided.get(capability) ?? 0, fix: item?.fix })
  }
  if (!gaps.length) return null
  void kinds
  const first = gaps[0]
  return result('missing-capability', manifest, `缺 ${gaps.length} 个依赖能力（第一个：${first.capability}，要 ${first.min} 有 ${first.have}）`, first.fix || `安装提供 ${first.capability} 的载体，或从 requires 里去掉它`, [])
}

function mapValidationError(error) {
  const code = String(error?.code ?? '').replace(/^PINAX_/, '')
  if (code === 'KERNEL_INCOMPATIBLE') {
    return { state: 'needs-host-upgrade', fix: '升级外壳，或把 minKernel 调到外壳合同版本以内' }
  }
  if (code === 'SCOPE_OUTSIDE_OWNER' || code === 'RESERVED_SLOT') {
    return { state: 'permission-denied', fix: '只占用开放槽与自己的 dataDirs；跨载体请走对方声明的 tools' }
  }
  if (code === 'RESERVED_VIEW_TYPE') {
    return { state: 'incompatible-form', fix: '宿主视图类型归宿主，第三方只能声明 pinax.view.custom' }
  }
  return { state: 'incompatible-form', fix: '按错误文案修清单：字段名、取值域或声明位置不对' }
}

/** CLI：node next/doctor.mjs <manifest.mjs 导出的路径> —— 打印五态诊断，供作者自查。 */
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
// CLI 是终端工具，没有渲染层可报：用法／装载失败只能走 stdout/stderr。
/* eslint-disable no-console */
if (invokedDirectly) {
  const target = process.argv[2]
  const descriptor = loadHostDescriptor()
  if (!target) {
    console.error('用法：node next/doctor.mjs <载体清单模块.mjs>')
    process.exitCode = 2
  } else if (descriptor.ok === false) {
    console.error(descriptor.error.message)
    process.exitCode = 1
  } else {
    import(pathToFileURL(target).href)
      .then((mod) => {
        const manifest = mod.default ?? Object.values(mod).find((item) => item && item.spec)
        const report = diagnoseCarrier(manifest, { descriptor })
        console.log(JSON.stringify(report, null, 2))
        if (report.state !== 'ok') process.exitCode = 1
      })
      .catch((error) => {
        console.error(`装载清单失败：${String(error?.message ?? error)}`)
        process.exitCode = 1
      })
  }
}
