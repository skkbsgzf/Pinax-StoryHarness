import { fail, ok } from './errors.mjs'
import { isKnownCapability } from './capabilities.vocab.mjs'
import { isKnownKind, validatePhysicalDir } from './projectSkeleton.mjs'

/**
 * 载体清单 `pinax-carrier@1` 校验器（规范 v1 第 3 节 C1–C8）。
 * 纯函数、无 IO：主进程、渲染进程、门禁脚本都能同一份调用。
 */
export const CARRIER_SPEC = 'pinax-carrier@1'
export const KERNEL_CONTRACT_VERSION = '1'

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{0,79}$/u
const LOGICAL_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/u
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/u

/** 插件可用的槽位（C5）。right 是保留字——右栏归一级公民运行时，任何插件声明即拒。 */
export const OPEN_SLOTS = Object.freeze(['left-dock', 'center'])
export const RESERVED_SLOTS = Object.freeze(['right', 'top-menu'])

export function validateCarrierManifest(input, { kinds = null } = {}) {
  if (!isPlainObject(input)) return fail('INVALID_MANIFEST', '载体清单必须是对象')
  const m = input

  if (m.spec !== CARRIER_SPEC) {
    return fail('INVALID_MANIFEST', `清单 spec 必须是 ${CARRIER_SPEC}，收到 ${String(m.spec)}`, { got: m.spec })
  }
  if (typeof m.id !== 'string' || !PLUGIN_ID_PATTERN.test(m.id)) {
    return fail('INVALID_MANIFEST', '插件 id 须匹配 ^[a-z][a-z0-9.-]{0,79}$', { id: m.id })
  }
  if (typeof m.title !== 'string' || !m.title.trim() || m.title.trim().length > 120) {
    return fail('INVALID_MANIFEST', '插件 title 须是 1–120 字的非空串', { title: m.title })
  }
  if (typeof m.version !== 'string' || !SEMVER_PATTERN.test(m.version)) {
    return fail('INVALID_MANIFEST', '插件 version 须是 x.y.z', { version: m.version })
  }
  if (!compatibleKernel(m.minKernel)) {
    return fail('KERNEL_INCOMPATIBLE', `插件要求外壳合同 minKernel=${String(m.minKernel)}，当前内核为 ${KERNEL_CONTRACT_VERSION}`, {
      pluginId: m.id, minKernel: m.minKernel, kernel: KERNEL_CONTRACT_VERSION
    })
  }
  if (m.tier !== 'carrier') {
    return fail('INVALID_MANIFEST', `tier 固定为 "carrier"（运行时与文件服务不走这份合同），收到 ${String(m.tier)}`)
  }

  const primary = validatePrimary(m.primary, m.id, kinds)
  if (!primary.ok) return primary
  const dataDirs = validateDataDirs(m.dataDirs, m.id)
  if (!dataDirs.ok) return dataDirs
  const panes = validatePanes(m.panes, m.id)
  if (!panes.ok) return panes
  const capabilities = validateCapabilities(m.capabilities, m.id)
  if (!capabilities.ok) return capabilities
  const requires = validateRequires(m.requires, m.id)
  if (!requires.ok) return requires
  const tools = validateTools(m.tools, m.id)
  if (!tools.ok) return tools
  const context = validateContext(m.context, m.id)
  if (!context.ok) return context
  const scopes = validateScopes(m.scopes, dataDirs.value, m.id)
  if (!scopes.ok) return scopes

  return ok({
    spec: CARRIER_SPEC,
    id: m.id,
    title: m.title.trim(),
    version: m.version,
    minKernel: String(m.minKernel),
    tier: 'carrier',
    primary: primary.value,
    dataDirs: dataDirs.value,
    panes: panes.value,
    capabilities: capabilities.value,
    requires: requires.value,
    tools: tools.value,
    context: context.value,
    scopes: scopes.value
  })
}

/** 外壳合同兼容性：只认 major 版本，插件不得要求比自己更新的外壳。 */
export function compatibleKernel(minKernel) {
  const raw = String(minKernel ?? '').trim()
  if (!/^\d+(\.\d+){0,2}$/.test(raw)) return false
  return Number.parseInt(raw.split('.')[0], 10) <= Number.parseInt(KERNEL_CONTRACT_VERSION, 10)
}

function validatePrimary(value, pluginId, kinds) {
  if (!isPlainObject(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 必须声明 primary（D1：主载体是显式的，框架不做默认）`)
  }
  const kindOk = kinds ? kinds.includes(value.projectKind) : isKnownKind(value.projectKind)
  if (!kindOk) {
    return fail('INVALID_MANIFEST', `primary.projectKind 不在已登记的项目类型里：${String(value.projectKind)}`)
  }
  if (typeof value.defaultPane !== 'string' || !value.defaultPane.trim()) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 primary.defaultPane 必填`)
  }
  if (typeof value.contextProfile !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(value.contextProfile)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 primary.contextProfile 须是小写档案名`)
  }
  return ok({
    projectKind: value.projectKind,
    defaultPane: value.defaultPane.trim(),
    contextProfile: value.contextProfile
  })
}

function validateDataDirs(value, pluginId) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return fail('INVALID_MANIFEST', `${pluginId} 必须声明至少一个 dataDirs 逻辑名（C1：载体文件夹即数据结构）`)
  }
  const out = {}
  for (const [logical, physical] of Object.entries(value)) {
    if (!LOGICAL_NAME_PATTERN.test(logical)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 dataDirs 逻辑名不合法：${logical}`, { logical })
    }
    const dir = validatePhysicalDir(physical)
    if (!dir.ok) return dir
    if (Object.values(out).includes(dir.value)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的两个逻辑名指向同一物理目录：${dir.value}`, { logical })
    }
    out[logical] = dir.value
  }
  return ok(out)
}

function validatePanes(value, pluginId) {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('INVALID_MANIFEST', `${pluginId} 必须声明至少一个 pane（C5）`)
  }
  const seen = new Set()
  const out = []
  for (const pane of value) {
    if (!isPlainObject(pane) || typeof pane.id !== 'string' || !pane.id.trim()) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 panes 项必须有 id`)
    }
    if (RESERVED_SLOTS.includes(pane.slot)) {
      return fail('RESERVED_SLOT', `槽位 "${pane.slot}" 是保留字：右栏/顶层菜单归外壳与运行时，插件不得占用（C5）`, {
        pluginId, slot: pane.slot, paneId: pane.id
      })
    }
    if (!OPEN_SLOTS.includes(pane.slot)) {
      return fail('INVALID_MANIFEST', `未知槽位 "${String(pane.slot)}"，可用：${OPEN_SLOTS.join('/')}`, { pluginId })
    }
    if (seen.has(pane.id)) return fail('INVALID_MANIFEST', `${pluginId} 的 pane id 重复：${pane.id}`)
    seen.add(pane.id)
    out.push({
      slot: pane.slot,
      id: pane.id.trim(),
      title: String(pane.title || pane.id).trim(),
      icon: typeof pane.icon === 'string' ? pane.icon.trim() : 'plugin'
    })
  }
  return ok(out)
}

function validateCapabilities(value, pluginId) {
  if (!Array.isArray(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 capabilities 必须是数组（可空，但必须声明）`)
  }
  for (const id of value) {
    if (!isKnownCapability(id)) {
      return fail('UNKNOWN_CAPABILITY', `${pluginId} 声明了词表外的能力：${String(id)}；新增能力要先改进 next/kernel/capabilities.vocab.mjs`, { pluginId })
    }
  }
  return ok([...new Set(value)])
}

function validateRequires(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_MANIFEST', `${pluginId} 的 requires 必须是数组`)
  const out = []
  for (const item of value) {
    if (!isPlainObject(item) || !isKnownCapability(item.capability)) {
      return fail('UNKNOWN_CAPABILITY', `${pluginId} 的 requires 指向词表外的能力：${String(item?.capability)}`, { pluginId })
    }
    // D3/D4 的「缺口即拒＋给修复路径」：没有 fix 文案就不许只丢一个错误码给作者。
    if (typeof item.fix !== 'string' || !item.fix.trim()) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 requires(${item.capability}) 必须给 fix 修复路径文案（D4）`)
    }
    const min = item.min === undefined ? 1 : item.min
    if (!Number.isSafeInteger(min) || min < 1) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 requires(${item.capability}).min 须是 ≥1 的整数`)
    }
    out.push({ capability: item.capability, min, fix: item.fix.trim() })
  }
  return ok(out)
}

function validateTools(value, pluginId) {
  if (!Array.isArray(value)) return fail('INVALID_MANIFEST', `${pluginId} 的 tools 必须是数组（可空）`)
  const out = []
  for (const name of value) {
    if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
      return fail('TOOL_CONFLICT', `${pluginId} 的工具名不合法：${String(name)}；须匹配 ${TOOL_NAME_PATTERN}`, { pluginId })
    }
    if (out.includes(name)) return fail('TOOL_CONFLICT', `${pluginId} 重复声明工具 ${name}`)
    out.push(name)
  }
  return ok(out)
}

function validateContext(value, pluginId) {
  const context = value ?? {}
  if (!isPlainObject(context)) return fail('INVALID_MANIFEST', `${pluginId} 的 context 必须是对象`)
  const providers = Array.isArray(context.providers) ? context.providers.filter((item) => typeof item === 'string' && item.trim()) : []
  const budgetChars = context.budgetChars === undefined ? 20_000 : context.budgetChars
  if (!Number.isSafeInteger(budgetChars) || budgetChars < 0 || budgetChars > 400_000) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 context.budgetChars 须是 0–400000 的整数`)
  }
  return ok({ providers: [...new Set(providers.map((item) => item.trim()))], budgetChars })
}

function validateScopes(value, dataDirs, pluginId) {
  if (!Array.isArray(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 必须显式申请 scopes（未声明即拒绝，规范第 7 节）`)
  }
  const ownedDirs = new Set(Object.values(dataDirs))
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) return fail('INVALID_MANIFEST', `${pluginId} 的 scope 项必须是非空字符串`)
    const scope = raw.trim()
    const parts = scope.split(':')
    if (parts[0] === 'agent') {
      if (parts.length !== 2 || parts[1] !== 'ask') {
        return fail('INVALID_MANIFEST', `agent 作用域只支持 agent:ask，收到 ${scope}`, { pluginId })
      }
    } else if (parts[0] === 'state') {
      if (!['read', 'write'].includes(parts[1]) || parts.length !== 2) {
        return fail('INVALID_MANIFEST', `state 作用域只支持 state:read / state:write，收到 ${scope}`, { pluginId })
      }
    } else if (parts[0] === 'net') {
      if (parts.length !== 2 || !/^[a-z0-9.*-]+$/i.test(parts[1])) {
        return fail('INVALID_MANIFEST', `net 作用域须写成 net:<host> 或 net:*，收到 ${scope}`, { pluginId })
      }
    } else if (parts[0] === 'file') {
      const [, dir, mode] = parts
      if (parts.length !== 3 || !['r', 'rw'].includes(mode)) {
        return fail('INVALID_MANIFEST', `file 作用域须写成 file:<物理目录>:r|rw，收到 ${scope}`, { pluginId })
      }
      const physical = validatePhysicalDir(dir)
      if (!physical.ok) return physical
      // C3 的内核级落地：只能为自己的 dataDirs 申请文件权限，跨载体必须走对方的 tools。
      if (!ownedDirs.has(physical.value)) {
        return fail('SCOPE_OUTSIDE_OWNER', `${pluginId} 想申请 file:${dir}:${mode}，但 "${dir}" 不在它的 dataDirs 里（C3：跨载体请走对方声明的 tools）`, {
          pluginId, dir, dataDirs: Object.values(dataDirs)
        })
      }
    } else {
      return fail('INVALID_MANIFEST', `未知作用域前缀 "${parts[0]}"（可用：file / agent / state / net），收到 ${scope}`, { pluginId })
    }
    if (out.includes(scope)) continue
    out.push(scope)
  }
  return ok(out)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
