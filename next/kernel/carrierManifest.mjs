import { fail, ok } from './errors.mjs'
import { isKnownCapability } from './capabilities.vocab.mjs'
import { isKnownKind, validatePhysicalDir } from './projectSkeleton.mjs'

/**
 * 载体清单校验器：`pinax-carrier@3`（写）＋ `@2`／`@1`（读，保留兼容）。
 * 纯函数、无 IO：主进程、渲染进程、门禁脚本都能同一份调用。
 *
 * v2 的五个声明面（工单 C §3）：
 *   provides      能力供给（v1 的 capabilities 的新名字）
 *   requires      ［不变］缺口即拒，且必须给 fix
 *   permissions   ［v1 的 scopes］结构化成 [{ type:'file', dir, mode }]
 *   contributes   { panes, commands, settings, renderers }
 *   subscriptions 今天只认 project.changed
 * 归一化结果同时保留 v1 字段（capabilities／scopes／settings／panes），
 * 这样依赖闭包、目录唯一主人、载体设置页都不用为改名再改一遍。
 *
 * v3（AgentCore 口径）在 v2 之上补「插件会自己动手」的四张牌：
 *   entry     自带面板：{ kind:'iframe', path:'ui/index.html' }，宿主在沙箱里加载
 *   services  本地服务：启动命令／参数／环境／端口／健康检查／崩溃重启策略
 *   mcp       外部 MCP 服务端：stdio 或 sse，挂进来的工具按 prefix 归命名空间
 *   agentMd   载体自己的 AGENT.md（插件目录内相对路径）：运行时组上下文时并入
 * v3 还收紧一条：pane 必须显式声明 kind（内容面词表），宿主不再按 id 前缀猜。
 * 这四张牌只在 @3 上生效——@2／@1 写了就拒装，避免「声明了却不生效」。
 */
export const CARRIER_SPEC_V1 = 'pinax-carrier@1'
export const CARRIER_SPEC_V2 = 'pinax-carrier@2'
export const CARRIER_SPEC_V3 = 'pinax-carrier@3'
export const CARRIER_SPEC = CARRIER_SPEC_V3
export const SUPPORTED_CARRIER_SPECS = Object.freeze([CARRIER_SPEC_V1, CARRIER_SPEC_V2, CARRIER_SPEC_V3])
const SPEC_MANIFEST_VERSIONS = Object.freeze({
  [CARRIER_SPEC_V1]: 1,
  [CARRIER_SPEC_V2]: 2,
  [CARRIER_SPEC_V3]: 3
})
/** 只有 @3 认的声明面：老版本写了就拒，不静默丢弃。 */
export const V3_ONLY_FIELDS = Object.freeze(['entry', 'services', 'mcp', 'agentMd'])

/** pane.kind：内容面词表（与 next/shell/viewRegistry.mjs 的宿主视图分工一一对应，测试会核）。 */
export const PANE_KIND_WORDS = Object.freeze([
  'chapter-editor',
  'outline-editor',
  'notes-editor',
  'entry-detail',
  'script-editor',
  'rule-editor',
  'document-detail',
  'records-editor',
  'proposal-review',
  // 世界书工作区（批次44）：看板区（上：列表／表格／图谱）＋ 文档区（下：选中条目的正文）。
  'entries-workspace',
  // 类别导航树（批次44）：窄栏那块，只管「按类别找条目」。
  'entries-categories',
  // 应用面（批次44）：外部端口上的网页应用，宿主给一块内嵌浏览器。
  'external-app',
  // 自带面板（协议 v3）：内容面由插件自己的页面提供，宿主只给一块沙箱 iframe。
  'custom-panel'
])

/** 应用面的视图类型（批次44）：与 custom 一样是「别人的页面，宿主只给一块地」，但走 http 地址。 */
export const APP_VIEW_TYPE = 'pinax.view.app'
export const APP_PANE_URL_MAX = 300

/** 自带面板目前只认沙箱 iframe；webview 等更宽的形态留待后续版本。 */
export const ENTRY_KINDS = Object.freeze(['iframe'])

/** 服务崩溃后的重启策略：on-failure 只在下游非零退出时拉起，never 只记状态。 */
export const SERVICE_RESTART_POLICIES = Object.freeze(['on-failure', 'never'])

/** 外部 MCP 的传输方式：stdio 起子进程，sse 连已有 HTTP 端点。 */
export const MCP_TRANSPORTS = Object.freeze(['stdio', 'sse'])

const ENTRY_PATH_MAX = 200
const AGENT_MD_PATH_MAX = 200
const SERVICE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u
const MCP_PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u
const SERVICE_COMMAND_MAX = 400
const SERVICE_ARGS_MAX = 32
const SERVICE_ARG_MAX = 400
const SERVICE_ENV_MAX = 64
const SERVICE_ENV_VALUE_MAX = 2000
const SERVICE_HEALTH_PATH_MAX = 200
const MCP_ALLOW_MAX = 256
const MCP_URL_MAX = 2000
export const KERNEL_CONTRACT_VERSION = '1'

/** 宿主认得的事件订阅（A 批收尾时发 project.changed）。 */
export const CARRIER_SUBSCRIPTIONS = Object.freeze(['project.changed'])

/** 宿主打开位置词表（与 next/shell/paneForms.mjs 的 PANE_FORMS 逐项相等，doctor 会核）。 */
export const PANE_FORM_WORDS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen', 'immersive'])

/** 设置控件的声明类型（v1 的 { id, title } 读成 section＝只出目录项、不带控件）。 */
export const SETTING_TYPES = Object.freeze(['section', 'string', 'number', 'boolean', 'enum'])

/** 载体可贡献的视图类型：v2 只开一个口（富视图沙箱不在本批）。 */
export const CARRIER_VIEW_TYPES = Object.freeze(['pinax.view.custom'])

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{0,79}$/u
const LOGICAL_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/u
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/u
/** 载体设置节 id：载体命名空间内的小写名（与工具名的命名家族一致，不带大写与空格）。 */
const SETTING_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u
const SETTING_TITLE_MAX = 40
/** pane.view 的命名家族：pinax.view.<name>（宿主六种与 pinax.view.custom 同族）。 */
const VIEW_TYPE_PATTERN = /^pinax\.view\.[a-z][a-z0-9.-]{0,63}$/u

/** 插件可用的槽位（C5）。right 是保留字——右栏归一级公民运行时，任何插件声明即拒。
 *  overlay 是协议 v1.1-C 的悬浮小工具窗（作者 2026-10-28 裁定）：载体只声明「要一枚悬浮窗」
 *  与它的宽度（width，200–600，缺省 300），**渲染与定位一律归宿主** next/shell/FloatingWidget.vue——
 *  载体声明意图，宿主管渲染；同一时刻每载体至多一个悬浮窗实例（多开后续批）。 */
export const OPEN_SLOTS = Object.freeze(['left-dock', 'center', 'overlay'])
export const RESERVED_SLOTS = Object.freeze(['right', 'top-menu'])

/** overlay 宽度（合同值域）：缺省 300，硬闸 200–600——不许某载体声明 1000px 把核心区盖死。 */
export const OVERLAY_WIDTH_DEFAULT = 300
export const OVERLAY_WIDTH_MIN = 200
export const OVERLAY_WIDTH_MAX = 600

export function validateCarrierManifest(input, { kinds = null } = {}) {
  if (!isPlainObject(input)) return fail('INVALID_MANIFEST', '载体清单必须是对象')
  const m = input

  if (!SUPPORTED_CARRIER_SPECS.includes(m.spec)) {
    return fail('INVALID_MANIFEST', `清单 spec 必须是 ${CARRIER_SPEC_V3}（旧版 ${CARRIER_SPEC_V2} / ${CARRIER_SPEC_V1} 仍可读），收到 ${String(m.spec)}`, { got: m.spec })
  }
  if (m.spec === CARRIER_SPEC_V1) {
    if (m.manifestVersion !== undefined && m.manifestVersion !== 1) {
      return fail('INVALID_MANIFEST', `${CARRIER_SPEC_V1} 的 manifestVersion 只能是 1，收到 ${String(m.manifestVersion)}`)
    }
  } else if (m.manifestVersion !== SPEC_MANIFEST_VERSIONS[m.spec]) {
    return fail('INVALID_MANIFEST', `${m.spec} 必须显式写 manifestVersion: ${SPEC_MANIFEST_VERSIONS[m.spec]}`, { manifestVersion: m.manifestVersion })
  }
  // v3 才认的四张牌：老清单写了就拒，避免「声明了却不生效」重演。
  if (m.spec !== CARRIER_SPEC_V3) {
    for (const field of V3_ONLY_FIELDS) {
      if (m[field] !== undefined) {
        return fail('INVALID_MANIFEST', `${m.id} 声明了 ${field}：这是 ${CARRIER_SPEC_V3} 的字段，请把清单 spec 与 manifestVersion 一并升级`, { pluginId: m.id, field })
      }
    }
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
  const contributes = validateContributes(m.contributes, m.id)
  if (!contributes.ok) return contributes
  // panes 只能有一个来源：v2 写 contributes.panes，v1 写顶层 panes；两处都写即拒。
  if (Array.isArray(m.panes) && Array.isArray(m.contributes?.panes)) {
    return fail('INVALID_MANIFEST', `${m.id} 同时写了 panes 与 contributes.panes：一份清单只能有一个来源`)
  }
  const panes = validatePanes(contributes.value.panes ?? m.panes, m.id, { requireKind: m.spec === CARRIER_SPEC_V3 })
  if (!panes.ok) return panes
  const entry = validateEntry(m.entry, m.id)
  if (!entry.ok) return entry
  const services = validateServices(m.services, m.id)
  if (!services.ok) return services
  const mcp = validateMcp(m.mcp, m.id)
  if (!mcp.ok) return mcp
  const agentMd = validateAgentMd(m.agentMd, m.id)
  if (!agentMd.ok) return agentMd
  // 自带面板与 pane 必须成对：只写 pane 得占位，只写 entry 没人挂——两种都是「声明了却不生效」。
  if (m.spec === CARRIER_SPEC_V3) {
    const customPanes = panes.value.filter((pane) => pane.view === CARRIER_VIEW_TYPES[0])
    if (entry.value && customPanes.length === 0) {
      return fail('INVALID_ENTRY', `${m.id} 声明了 entry，但没有 pane 用 ${CARRIER_VIEW_TYPES[0]} 挂它`, { pluginId: m.id })
    }
    if (!entry.value && customPanes.length > 0) {
      return fail('INVALID_ENTRY', `${m.id} 的 pane「${customPanes[0].id}」用了 ${CARRIER_VIEW_TYPES[0]}，却没有声明 entry——宿主只能出占位`, { pluginId: m.id })
    }
  }
  // provides 是 capabilities 的新名字：两个都写必须一致，写时只认 v2 那个。
  if (m.provides !== undefined && m.capabilities !== undefined && !sameStringSet(m.provides, m.capabilities)) {
    return fail('INVALID_MANIFEST', `${m.id} 的 provides 与 capabilities 不一致：v2 只写 provides`, { provides: m.provides, capabilities: m.capabilities })
  }
  const capabilities = validateCapabilities(m.provides ?? m.capabilities, m.id)
  if (!capabilities.ok) return capabilities
  const requires = validateRequires(m.requires, m.id)
  if (!requires.ok) return requires
  const tools = validateTools(m.tools, m.id)
  if (!tools.ok) return tools
  const context = validateContext(m.context, m.id)
  if (!context.ok) return context
  // permissions 是 scopes 的新名字：对象形状先归一成作用域串，再走同一条所有权校验。
  const normalizedPermissions = normalizePermissions(m.permissions ?? m.scopes, m.id)
  if (normalizedPermissions?.ok === false) return normalizedPermissions
  const scopes = validateScopes(normalizedPermissions, dataDirs.value, m.id)
  if (!scopes.ok) return scopes
  const settings = validateSettings(contributes.value.settings ?? m.settings, m.id)
  if (!settings.ok) return settings
  const subscriptions = validateSubscriptions(m.subscriptions, m.id)
  if (!subscriptions.ok) return subscriptions

  return ok({
    spec: m.spec === CARRIER_SPEC_V3 ? CARRIER_SPEC_V3 : CARRIER_SPEC_V2,
    manifestVersion: m.spec === CARRIER_SPEC_V3 ? 3 : 2,
    id: m.id,
    title: m.title.trim(),
    version: m.version,
    minKernel: String(m.minKernel),
    tier: 'carrier',
    primary: primary.value,
    dataDirs: dataDirs.value,
    panes: panes.value,
    capabilities: capabilities.value,
    provides: capabilities.value,
    requires: requires.value,
    tools: tools.value,
    context: context.value,
    scopes: scopes.value,
    permissions: permissionsFromScopes(scopes.value),
    settings: settings.value,
    commands: contributes.value.commands,
    renderers: contributes.value.renderers,
    subscriptions: subscriptions.value,
    entry: entry.value,
    services: services.value,
    mcp: mcp.value,
    agentMd: agentMd.value
  })
}

/** 同一组字符串（不看顺序）；两个都写时用来核 provides ↔ capabilities。 */
function sameStringSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size) return false
  for (const item of left) if (!right.has(item)) return false
  return true
}

/** scopes → permissions 的读时映射（v2 的对外口径）。 */
export function permissionsFromScopes(scopes) {
  return (Array.isArray(scopes) ? scopes : [])
    .filter((scope) => typeof scope === 'string' && scope.startsWith('file:'))
    .map((scope) => {
      const [, dir, mode] = scope.split(':')
      return { type: 'file', dir, mode }
    })
}

/** 对象形状的 permissions → 作用域串；字符串原样透传（v1 清单走这条）。 */
function normalizePermissions(value, pluginId) {
  if (!Array.isArray(value)) return value
  const out = []
  for (const raw of value) {
    if (typeof raw === 'string') {
      out.push(raw)
      continue
    }
    if (!isPlainObject(raw)) return fail('INVALID_MANIFEST', `${pluginId} 的 permissions 项必须是对象或作用域串`)
    for (const key of Object.keys(raw)) {
      if (key !== 'type' && key !== 'dir' && key !== 'mode') {
        return fail('INVALID_MANIFEST', `${pluginId} 的 permission 含未知字段 "${key}"：可声明 type／dir／mode`, { pluginId, key })
      }
    }
    if (raw.type !== 'file') {
      return fail('INVALID_MANIFEST', `${pluginId} 的 permission.type 目前只支持 file，收到 ${String(raw.type)}`)
    }
    if (typeof raw.dir !== 'string' || !raw.dir.trim()) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 permission.dir 必填（物理目录名）`)
    }
    const mode = raw.mode ?? 'r'
    if (!['r', 'rw'].includes(mode)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 permission.mode 只支持 r／rw，收到 ${String(mode)}`)
    }
    out.push(`file:${raw.dir.trim()}:${mode}`)
  }
  return out
}

/** contributes 段：只认 panes／commands／settings／renderers 四个键。 */
function validateContributes(value, pluginId) {
  const empty = { panes: null, commands: [], settings: null, renderers: [] }
  if (value === undefined || value === null) return ok(empty)
  if (!isPlainObject(value)) return fail('INVALID_MANIFEST', `${pluginId} 的 contributes 必须是对象`)
  for (const key of Object.keys(value)) {
    if (!['panes', 'commands', 'settings', 'renderers'].includes(key)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 contributes 含未知段 "${key}"：可用 panes／commands／settings／renderers`, { pluginId, key })
    }
  }
  if (value.panes !== undefined && !Array.isArray(value.panes)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 contributes.panes 必须是数组`)
  }
  if (value.settings !== undefined && !Array.isArray(value.settings)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 contributes.settings 必须是数组`)
  }
  const commands = validateCommands(value.commands, pluginId)
  if (!commands.ok) return commands
  const renderers = validateRenderers(value.renderers, pluginId)
  if (!renderers.ok) return renderers
  return ok({
    panes: Array.isArray(value.panes) ? value.panes : null,
    commands: commands.value,
    settings: Array.isArray(value.settings) ? value.settings : null,
    renderers: renderers.value
  })
}

const COMMAND_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u
const COMMAND_TITLE_MAX = 60

/** 命令：{ id, title, run }。run 是函数（进程内载体）或非空字符串（实现方按名字查）。 */
function validateCommands(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_MANIFEST', `${pluginId} 的 contributes.commands 必须是数组`)
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (!isPlainObject(item)) return fail('INVALID_MANIFEST', `${pluginId} 的 commands 项必须是对象`)
    for (const key of Object.keys(item)) {
      if (!['id', 'title', 'run'].includes(key)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 command 含未知字段 "${key}"：可声明 id／title／run`, { pluginId, key })
      }
    }
    if (typeof item.id !== 'string' || !COMMAND_ID_PATTERN.test(item.id)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 command id 须匹配 ${COMMAND_ID_PATTERN}`, { id: item.id })
    }
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title || title.length > COMMAND_TITLE_MAX) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 command(${item.id}) title 须是 1–${COMMAND_TITLE_MAX} 字的非空串`)
    }
    const runOk = typeof item.run === 'function' || (typeof item.run === 'string' && item.run.trim().length > 0 && item.run.length <= 120)
    if (!runOk) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 command(${item.id}) run 必须是函数或非空实现名（≤120 字）`, { id: item.id })
    }
    if (seen.has(item.id)) return fail('INVALID_MANIFEST', `${pluginId} 的 command id 重复：${item.id}`)
    seen.add(item.id)
    out.push({ id: item.id, title, run: item.run })
  }
  return ok(out)
}

/** renderers：v2 只开 pinax.view.custom 一个类型名（宿主六种视图不许被顶替）。 */
function validateRenderers(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_MANIFEST', `${pluginId} 的 contributes.renderers 必须是数组`)
  const out = []
  for (const raw of value) {
    const type = typeof raw === 'string' ? raw : raw?.type
    if (typeof type !== 'string' || !/^pinax\.view\.[a-z][a-z0-9.-]{0,63}$/u.test(type)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 renderer 类型不合法：${String(type)}`, { pluginId })
    }
    if (!CARRIER_VIEW_TYPES.includes(type)) {
      return fail('RESERVED_VIEW_TYPE', `${pluginId} 不能声明视图 ${type}：宿主六种视图归宿主，第三方只能用 ${CARRIER_VIEW_TYPES.join('/')}`, { pluginId, type })
    }
    if (typeof raw === 'object' && raw !== null) {
      for (const key of Object.keys(raw)) {
        if (key !== 'type') return fail('INVALID_MANIFEST', `${pluginId} 的 renderer 含未知字段 "${key}"：v2 只登记类型名`, { pluginId, key })
      }
    }
    if (!out.includes(type)) out.push(type)
  }
  return ok(out)
}

/** subscriptions：今天只认 project.changed；未订阅的载体收不到事件。 */
function validateSubscriptions(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_MANIFEST', `${pluginId} 的 subscriptions 必须是数组`)
  const out = []
  for (const item of value) {
    if (typeof item !== 'string' || !CARRIER_SUBSCRIPTIONS.includes(item)) {
      return fail('UNKNOWN_SUBSCRIPTION', `${pluginId} 订阅了宿主不认的事件：${String(item)}；可用：${CARRIER_SUBSCRIPTIONS.join(' / ')}`, { pluginId })
    }
    if (!out.includes(item)) out.push(item)
  }
  return ok(out)
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

/**
 * 应用面的地址（批次44）：{ url } —— 一台外部服务自己的网页地址。
 * 只接本机回环：http://127.0.0.1:8188/、http://localhost:3000/ 这类。
 * 远端地址本批不接：宿主的内容安全策略只放开回环端口，别处塞进去 iframe 只会白屏。
 */
function validateAppPane(value, pluginId, paneId) {
  if (!isPlainObject(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」kind 是 external-app 时必须声明 app: { url }（外部服务自己的网页地址）`, { pluginId, paneId })
  }
  const raw = String(value.url ?? '').trim()
  if (!raw) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」的 app.url 不能为空`, { pluginId, paneId })
  }
  if (raw.length > APP_PANE_URL_MAX) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」的 app.url 过长（上限 ${APP_PANE_URL_MAX} 字）`, { pluginId, paneId })
  }
  let url = null
  try {
    url = new URL(raw)
  } catch {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」的 app.url 不是合法地址：${raw}`, { pluginId, paneId })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」的 app.url 只认 http/https，收到 ${url.protocol}`, { pluginId, paneId })
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  if (!loopback) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」的 app.url 本批只接本机回环（127.0.0.1 / localhost / ::1），收到 ${url.hostname}`, { pluginId, paneId })
  }
  return ok({ url: raw })
}

function validatePanes(value, pluginId, { requireKind = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('INVALID_MANIFEST', `${pluginId} 必须声明至少一个 pane（C5）`)
  }
  const seen = new Set()
  const out = []
  let overlayCount = 0
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
    const normalized = {
      slot: pane.slot,
      id: pane.id.trim(),
      title: String(pane.title || pane.id).trim(),
      icon: typeof pane.icon === 'string' ? pane.icon.trim() : 'plugin'
    }
    // 协议 v2（工单 C §4）：pane 自己声明视图类型，宿主不再按 id 前缀猜；
    // 不声明时保留空串，宿主走 v1 前缀回退（一个版本周期）。
    if (pane.view !== undefined) {
      if (typeof pane.view !== 'string' || !VIEW_TYPE_PATTERN.test(pane.view)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」view 须匹配 ${VIEW_TYPE_PATTERN}`, { pluginId, paneId: pane.id, view: pane.view })
      }
      normalized.view = pane.view
    } else if (requireKind) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」必须声明 view（${CARRIER_SPEC_V3} 不再按 id 前缀回落渲染器）`, { pluginId, paneId: pane.id })
    }
    // 协议 v3：内容面显式声明，前缀猜测彻底退场（v1/v2 仍可省略，走外壳的兼容对照表）。
    if (pane.kind !== undefined) {
      if (typeof pane.kind !== 'string' || !PANE_KIND_WORDS.includes(pane.kind)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」kind 须是 ${PANE_KIND_WORDS.join(' / ')}，收到 ${String(pane.kind)}`, { pluginId, paneId: pane.id, kind: pane.kind })
      }
      normalized.kind = pane.kind
    } else if (requireKind) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」必须声明 kind（${PANE_KIND_WORDS.join(' / ')}）：${CARRIER_SPEC_V3} 不再按 id 前缀猜内容面`, { pluginId, paneId: pane.id })
    }
    // 自带面板与视图类型必须成对：view=pinax.view.custom 的 pane 内容面只能是 custom-panel，
    // 反过来也一样——写一半会让宿主不知道该挂 iframe 还是宿主视图。
    const isCustomView = normalized.view === CARRIER_VIEW_TYPES[0]
    if (isCustomView && normalized.kind !== 'custom-panel') {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」用 ${CARRIER_VIEW_TYPES[0]} 时 kind 必须是 custom-panel，收到 ${String(normalized.kind)}`, { pluginId, paneId: pane.id, kind: normalized.kind })
    }
    if (normalized.kind === 'custom-panel' && !isCustomView) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」kind 是 custom-panel 时 view 必须是 ${CARRIER_VIEW_TYPES[0]}`, { pluginId, paneId: pane.id, view: normalized.view ?? null })
    }
    // 应用面（批次44）：外部端口上的网页应用——地址必须声明，且只能是本机 http 地址。
    // 两条边界：① view 与 kind 必须成对（宿主据此决定给 iframe 还是给宿主视图）；
    // ② 地址只接本机回环（ComfyUI 那种 http://127.0.0.1:8188/）——
    // 远端地址本批不接：宿主的内容安全策略只放开回环端口，塞别的地址进去 iframe 只会白屏。
    const isAppView = normalized.view === APP_VIEW_TYPE
    if (isAppView && normalized.kind !== 'external-app') {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」用 ${APP_VIEW_TYPE} 时 kind 必须是 external-app，收到 ${String(normalized.kind)}`, { pluginId, paneId: pane.id, kind: normalized.kind })
    }
    if (normalized.kind === 'external-app') {
      if (!isAppView) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」kind 是 external-app 时 view 必须是 ${APP_VIEW_TYPE}`, { pluginId, paneId: pane.id, view: normalized.view ?? null })
      }
      const app = validateAppPane(pane.app, pluginId, pane.id)
      if (!app.ok) return app
      normalized.app = app.value
    }
    // forms：这块 pane 允许被摆到哪些位置（可空＝宿主打开位置全开）。
    if (pane.forms !== undefined) {
      if (!Array.isArray(pane.forms) || pane.forms.length === 0) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」forms 必须是非空数组（不声明＝全部位置开放）`, { pluginId, paneId: pane.id })
      }
      const forms = []
      for (const form of pane.forms) {
        if (!PANE_FORM_WORDS.includes(form)) {
          return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${pane.id}」forms 含未知位置 "${String(form)}"：可用 ${PANE_FORM_WORDS.join(' / ')}`, { pluginId, paneId: pane.id })
        }
        if (!forms.includes(form)) forms.push(form)
      }
      normalized.forms = forms
    }
    // overlay（协议 v1.1-C）：宽度是合同字段，过了校验才交给宿主 FloatingWidget 消费。
    // 其他槽位不认 width（静默丢弃会让「声明了却不生效」重演，所以只在 overlay 上保留并校验）。
    if (pane.slot === 'overlay') {
      // 每载体至多一枚悬浮窗（工单C 边界：不做多开）；多声明直接拒装，不靠宿主去猜哪枚算数。
      overlayCount += 1
      if (overlayCount > 1) {
        return fail('INVALID_MANIFEST', `${pluginId} 至多声明一枚 overlay pane（每载体至多一个悬浮窗实例；多开留待后续批）`, {
          pluginId, paneId: pane.id
        })
      }
      const width = pane.width === undefined ? OVERLAY_WIDTH_DEFAULT : pane.width
      if (!Number.isSafeInteger(width) || width < OVERLAY_WIDTH_MIN || width > OVERLAY_WIDTH_MAX) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 overlay pane「${pane.id}」width 须是 ${OVERLAY_WIDTH_MIN}–${OVERLAY_WIDTH_MAX} 的整数（缺省 ${OVERLAY_WIDTH_DEFAULT}）`, {
          pluginId, paneId: pane.id, width: pane.width
        })
      }
      normalized.width = width
    }
    out.push(normalized)
  }
  return ok(out)
}

/**
 * 插件目录内的相对路径（entry / agentMd / service cwd）：不得越出插件自己的目录。
 * 与项目内相对路径不同：这里解析基准是插件根，不是项目根，所以不收 `.pinax` 之类项目语义，
 * 只守八条——非空、小于上限、正斜杠、非绝对、非盘符、无 `.`/`..`/空段、不以点开头、扩展名对得上。
 */
function validatePluginRelativePath(value, { pluginId, field, ext = null, max = 200, code = 'INVALID_MANIFEST' } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    return fail(code, `${pluginId} 的 ${field} 必须是非空字符串`, { pluginId, field })
  }
  const raw = value.trim()
  if (raw.length > max) {
    return fail(code, `${pluginId} 的 ${field} 过长（上限 ${max} 字）：${raw}`, { pluginId, field })
  }
  if (raw.includes('\\')) {
    return fail(code, `${pluginId} 的 ${field} 请用正斜杠：${raw}`, { pluginId, field })
  }
  if (raw.includes(':') || raw.startsWith('/')) {
    return fail(code, `${pluginId} 的 ${field} 必须是插件目录内的相对路径：${raw}`, { pluginId, field })
  }
  const segments = raw.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    return fail(code, `${pluginId} 的 ${field} 含非法路径段：${raw}`, { pluginId, field })
  }
  if (ext && !raw.toLowerCase().endsWith(ext)) {
    return fail(code, `${pluginId} 的 ${field} 必须以 ${ext} 结尾：${raw}`, { pluginId, field })
  }
  return ok(raw)
}

/** entry：自带面板的入口声明（v3）。今天只认沙箱 iframe，路径相对插件目录。 */
function validateEntry(value, pluginId) {
  if (value === undefined || value === null) return ok(null)
  if (!isPlainObject(value)) return fail('INVALID_ENTRY', `${pluginId} 的 entry 必须是对象`)
  for (const key of Object.keys(value)) {
    if (!['kind', 'path'].includes(key)) {
      return fail('INVALID_ENTRY', `${pluginId} 的 entry 含未知字段 "${key}"：可声明 kind / path`, { pluginId, key })
    }
  }
  const kind = value.kind === undefined ? ENTRY_KINDS[0] : value.kind
  if (!ENTRY_KINDS.includes(kind)) {
    return fail('INVALID_ENTRY', `${pluginId} 的 entry.kind 目前只支持 ${ENTRY_KINDS.join(' / ')}，收到 ${String(kind)}`, { pluginId })
  }
  const path = validatePluginRelativePath(value.path, { pluginId, field: 'entry.path', ext: '.html', max: ENTRY_PATH_MAX, code: 'INVALID_ENTRY' })
  if (!path.ok) return path
  return ok({ kind, path: path.value })
}

/** agentMd：载体自己的 AGENT.md，插件目录内相对路径；内容读取在运行时侧，这里只守路径。 */
function validateAgentMd(value, pluginId) {
  if (value === undefined || value === null) return ok(null)
  const path = validatePluginRelativePath(value, { pluginId, field: 'agentMd', ext: '.md', max: AGENT_MD_PATH_MAX })
  if (!path.ok) return path
  return ok(path.value)
}

/** env：字面量键值（不接受函数／变量展开），键守 POSIX 环境变量名，值只收字符串。 */
function validateEnvMap(value, pluginId, field, code) {
  if (value === undefined || value === null) return ok({})
  if (!isPlainObject(value)) return fail(code, `${pluginId} 的 ${field} 必须是对象`, { pluginId, field })
  const keys = Object.keys(value)
  if (keys.length > SERVICE_ENV_MAX) {
    return fail(code, `${pluginId} 的 ${field} 最多 ${SERVICE_ENV_MAX} 项，收到 ${keys.length}`, { pluginId, field })
  }
  const out = {}
  for (const key of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key)) {
      return fail(code, `${pluginId} 的 ${field} 键不合法：${key}（须匹配 ^[A-Za-z_][A-Za-z0-9_]*$）`, { pluginId, field, key })
    }
    if (typeof value[key] !== 'string' || value[key].length > SERVICE_ENV_VALUE_MAX) {
      return fail(code, `${pluginId} 的 ${field}.${key} 必须是 ≤${SERVICE_ENV_VALUE_MAX} 字的字符串`, { pluginId, field, key })
    }
    out[key] = value[key]
  }
  return ok(out)
}

function validateStringArgs(value, pluginId, field, code) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail(code, `${pluginId} 的 ${field} 必须是字符串数组`, { pluginId, field })
  if (value.length > SERVICE_ARGS_MAX) {
    return fail(code, `${pluginId} 的 ${field} 最多 ${SERVICE_ARGS_MAX} 项，收到 ${value.length}`, { pluginId, field })
  }
  const out = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length > SERVICE_ARG_MAX) {
      return fail(code, `${pluginId} 的 ${field} 只收 ≤${SERVICE_ARG_MAX} 字的字符串`, { pluginId, field })
    }
    out.push(item)
  }
  return ok(out)
}

/**
 * services：插件自带的本地服务（v3）。
 * 缺省 autostart:true、restart:'on-failure'；healthPath 必须配 port（HTTP 健康检查才有靶子）。
 */
function validateServices(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_SERVICE', `${pluginId} 的 services 必须是数组`, { pluginId })
  const fields = ['id', 'command', 'args', 'env', 'cwd', 'port', 'healthPath', 'restart', 'autostart']
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (!isPlainObject(item)) return fail('INVALID_SERVICE', `${pluginId} 的 service 项必须是对象`, { pluginId })
    for (const key of Object.keys(item)) {
      if (!fields.includes(key)) {
        return fail('INVALID_SERVICE', `${pluginId} 的 service 含未知字段 "${key}"：可声明 ${fields.join(' / ')}`, { pluginId, key })
      }
    }
    if (typeof item.id !== 'string' || !SERVICE_ID_PATTERN.test(item.id)) {
      return fail('INVALID_SERVICE', `${pluginId} 的 service id 须匹配 ${SERVICE_ID_PATTERN}`, { id: item.id })
    }
    if (seen.has(item.id)) return fail('INVALID_SERVICE', `${pluginId} 的 service id 重复：${item.id}`, { pluginId, id: item.id })
    seen.add(item.id)
    if (typeof item.command !== 'string' || !item.command.trim() || item.command.trim().length > SERVICE_COMMAND_MAX) {
      return fail('INVALID_SERVICE', `${pluginId} 的 service(${item.id}) command 必填（≤${SERVICE_COMMAND_MAX} 字）`, { pluginId, id: item.id })
    }
    const args = validateStringArgs(item.args, pluginId, `service(${item.id}).args`, 'INVALID_SERVICE')
    if (!args.ok) return args
    const env = validateEnvMap(item.env, pluginId, `service(${item.id}).env`, 'INVALID_SERVICE')
    if (!env.ok) return env
    let cwd = null
    if (item.cwd !== undefined && item.cwd !== null) {
      const path = validatePluginRelativePath(item.cwd, { pluginId, field: `service(${item.id}).cwd`, code: 'INVALID_SERVICE', max: ENTRY_PATH_MAX })
      if (!path.ok) return path
      cwd = path.value
    }
    let port = null
    if (item.port !== undefined && item.port !== null) {
      if (!Number.isSafeInteger(item.port) || item.port < 1 || item.port > 65535) {
        return fail('INVALID_SERVICE', `${pluginId} 的 service(${item.id}).port 须是 1–65535 的整数`, { pluginId, id: item.id, port: item.port })
      }
      port = item.port
    }
    let healthPath = null
    if (item.healthPath !== undefined && item.healthPath !== null) {
      const raw = item.healthPath
      if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('..') || raw.length > SERVICE_HEALTH_PATH_MAX) {
        return fail('INVALID_SERVICE', `${pluginId} 的 service(${item.id}).healthPath 须是以 / 开头且不含 .. 的路径（≤${SERVICE_HEALTH_PATH_MAX} 字）`, { pluginId, id: item.id })
      }
      if (!port) {
        return fail('INVALID_SERVICE', `${pluginId} 的 service(${item.id}) 声明了 healthPath 却没给 port：健康检查没有靶子`, { pluginId, id: item.id })
      }
      healthPath = raw
    }
    const restart = item.restart === undefined ? 'on-failure' : item.restart
    if (!SERVICE_RESTART_POLICIES.includes(restart)) {
      return fail('INVALID_SERVICE', `${pluginId} 的 service(${item.id}).restart 须是 ${SERVICE_RESTART_POLICIES.join(' / ')}`, { pluginId, id: item.id })
    }
    if (item.autostart !== undefined && typeof item.autostart !== 'boolean') {
      return fail('INVALID_SERVICE', `${pluginId} 的 service(${item.id}).autostart 必须是布尔`, { pluginId, id: item.id })
    }
    out.push({
      id: item.id,
      command: item.command.trim(),
      args: args.value,
      env: env.value,
      cwd,
      port,
      healthPath,
      restart,
      autostart: item.autostart ?? true
    })
  }
  return ok(out)
}

/**
 * mcp：外部 MCP 服务端（v3）。stdio 起子进程、sse 连已有端点；
 * prefix 是挂进聚合工具面时的命名空间（安装期由注册表仲裁，跨载体不得撞名）。
 */
function validateMcp(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_MCP', `${pluginId} 的 mcp 必须是数组`, { pluginId })
  const fields = ['id', 'transport', 'prefix', 'command', 'args', 'env', 'url', 'allow']
  const seenIds = new Set()
  const seenPrefixes = new Set()
  const out = []
  for (const item of value) {
    if (!isPlainObject(item)) return fail('INVALID_MCP', `${pluginId} 的 mcp 项必须是对象`, { pluginId })
    for (const key of Object.keys(item)) {
      if (!fields.includes(key)) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp 项含未知字段 "${key}"：可声明 ${fields.join(' / ')}`, { pluginId, key })
      }
    }
    if (typeof item.id !== 'string' || !SERVICE_ID_PATTERN.test(item.id)) {
      return fail('INVALID_MCP', `${pluginId} 的 mcp id 须匹配 ${SERVICE_ID_PATTERN}`, { id: item.id })
    }
    if (seenIds.has(item.id)) return fail('INVALID_MCP', `${pluginId} 的 mcp id 重复：${item.id}`, { pluginId, id: item.id })
    seenIds.add(item.id)
    if (!MCP_TRANSPORTS.includes(item.transport)) {
      return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}).transport 须是 ${MCP_TRANSPORTS.join(' / ')}`, { pluginId, id: item.id })
    }
    if (typeof item.prefix !== 'string' || !MCP_PREFIX_PATTERN.test(item.prefix)) {
      return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}).prefix 须匹配 ${MCP_PREFIX_PATTERN}`, { pluginId, id: item.id })
    }
    if (seenPrefixes.has(item.prefix)) {
      return fail('INVALID_MCP', `${pluginId} 的两份 mcp 声明共用命名空间 ${item.prefix}`, { pluginId, prefix: item.prefix })
    }
    seenPrefixes.add(item.prefix)
    const normalized = { id: item.id, transport: item.transport, prefix: item.prefix, command: null, args: [], env: {}, url: null, allow: [] }
    if (item.transport === 'stdio') {
      if (item.url !== undefined) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}) 是 stdio，不该声明 url`, { pluginId, id: item.id })
      }
      if (typeof item.command !== 'string' || !item.command.trim() || item.command.trim().length > SERVICE_COMMAND_MAX) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}) 是 stdio，command 必填（≤${SERVICE_COMMAND_MAX} 字）`, { pluginId, id: item.id })
      }
      const args = validateStringArgs(item.args, pluginId, `mcp(${item.id}).args`, 'INVALID_MCP')
      if (!args.ok) return args
      const env = validateEnvMap(item.env, pluginId, `mcp(${item.id}).env`, 'INVALID_MCP')
      if (!env.ok) return env
      normalized.command = item.command.trim()
      normalized.args = args.value
      normalized.env = env.value
    } else {
      if (item.command !== undefined || item.args !== undefined || item.env !== undefined) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}) 是 sse，只收 url／allow`, { pluginId, id: item.id })
      }
      if (typeof item.url !== 'string' || !item.url.trim() || item.url.length > MCP_URL_MAX) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}) 是 sse，url 必填（≤${MCP_URL_MAX} 字）`, { pluginId, id: item.id })
      }
      let parsed
      try {
        parsed = new URL(item.url.trim())
      } catch {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}).url 不是合法 URL：${item.url}`, { pluginId, id: item.id })
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}).url 只支持 http/https`, { pluginId, id: item.id })
      }
      normalized.url = item.url.trim()
    }
    if (item.allow !== undefined) {
      if (!Array.isArray(item.allow) || item.allow.length > MCP_ALLOW_MAX) {
        return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}).allow 必须是不超过 ${MCP_ALLOW_MAX} 项的数组`, { pluginId, id: item.id })
      }
      const allow = []
      for (const name of item.allow) {
        if (typeof name !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(name)) {
          return fail('INVALID_MCP', `${pluginId} 的 mcp(${item.id}).allow 含不合法工具名：${String(name)}`, { pluginId, id: item.id })
        }
        if (!allow.includes(name)) allow.push(name)
      }
      normalized.allow = allow
    }
    out.push(normalized)
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

/**
 * 载体设置节声明（协议 P14 → v2 声明式控件，工单 C §3）。
 * v1 的 `{ id, title }` 读成 `type: 'section'`（只出目录项，控件仍由老 SFC 渲染）；
 * v2 可声明 `{ id, title, type, default, options }`，宿主按 type 渲染并持久化：
 *   string / number / boolean  → default 必须同型
 *   enum                       → options 为非空去重标量表，default 必须是其中一项
 *   section                    → 不带 default/options（带了就是「声明了却不生效」，拒装）
 * id 在该载体自己的命名空间里唯一；分组由设置页固定归「载体」，多写字段直接拒装。
 */
function validateSettings(value, pluginId) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) return fail('INVALID_INPUT', `${pluginId} 的 settings 必须是数组（可空，但声明了就得是数组）`)
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (!isPlainObject(item)) return fail('INVALID_INPUT', `${pluginId} 的 settings 项必须是对象`)
    for (const key of Object.keys(item)) {
      if (!['id', 'title', 'type', 'default', 'options'].includes(key)) {
        return fail('INVALID_INPUT', `${pluginId} 的 settings 项含未知字段 "${key}"：可声明 id / title / type / default / options（分组由设置页固定为「载体」）`, { pluginId, key })
      }
    }
    if (typeof item.id !== 'string' || !SETTING_ID_PATTERN.test(item.id)) {
      return fail('INVALID_INPUT', `${pluginId} 的 settings id 须匹配 ${SETTING_ID_PATTERN}（载体命名空间内的小写名）`, { id: item.id })
    }
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title || title.length > SETTING_TITLE_MAX) {
      return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) title 须是 1–${SETTING_TITLE_MAX} 字的非空串`, { title: item.title })
    }
    if (seen.has(item.id)) return fail('INVALID_INPUT', `${pluginId} 的 settings id 重复：${item.id}`)
    seen.add(item.id)
    const type = item.type === undefined ? 'section' : item.type
    if (!SETTING_TYPES.includes(type)) {
      return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) type 须是 ${SETTING_TYPES.join(' / ')}，收到 ${String(item.type)}`, { pluginId, id: item.id })
    }
    const normalized = { id: item.id, title, type }
    if (type === 'section') {
      if (item.default !== undefined || item.options !== undefined) {
        return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) 是 section：不带 default / options`, { pluginId, id: item.id })
      }
      out.push(normalized)
      continue
    }
    if (type === 'enum') {
      const options = Array.isArray(item.options) ? item.options : null
      if (!options || options.length === 0) {
        return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) 是 enum：必须给非空 options`, { pluginId, id: item.id })
      }
      const clean = []
      for (const option of options) {
        if (!['string', 'number', 'boolean'].includes(typeof option)) {
          return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) options 只收字符串／数字／布尔`, { pluginId, id: item.id })
        }
        if (!clean.includes(option)) clean.push(option)
      }
      normalized.options = clean
      if (item.default === undefined) {
        normalized.default = clean[0]
      } else if (!clean.includes(item.default)) {
        return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) default 必须在 options 里`, { pluginId, id: item.id, default: item.default })
      } else {
        normalized.default = item.default
      }
      out.push(normalized)
      continue
    }
    const fallback = type === 'number' ? 0 : type === 'boolean' ? false : ''
    if (item.default === undefined) {
      normalized.default = fallback
    } else if (typeof item.default !== type) {
      return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) default 须是 ${type}`, { pluginId, id: item.id, default: item.default })
    } else {
      normalized.default = item.default
    }
    if (type === 'number' && !Number.isFinite(normalized.default)) {
      return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) default 须是有限数字`, { pluginId, id: item.id })
    }
    if (item.options !== undefined) {
      return fail('INVALID_INPUT', `${pluginId} 的 settings(${item.id}) 不是 enum：不带 options`, { pluginId, id: item.id })
    }
    out.push(normalized)
  }
  return ok(out)
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
