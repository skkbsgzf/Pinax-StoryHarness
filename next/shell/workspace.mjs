/**
 * 工作区窗口状态（批次59 · 协议 v1.3（批次59 窗口模型工作名））：窗口只有「一扇」，状态只剩窗口自己的几轴。
 *
 * 批次44/45 的四轴模型（placement／minimized／geometry／restore）把位置当成了枚举，
 * 于是每个位置各长一套按钮与一套菜单。批次59 作者裁定：任何打开的内容就是一扇
 * 带标题的窗口，位置只是这扇窗的此刻形态——
 *
 *   geometry   { x, y, w, h }     浮窗矩形（最大化／分屏时保留，用于还原）
 *   z          叠序（越大越靠前）
 *   minimized  none|tab           正常／收起成侧缘标签
 *   maximized  boolean            占满中栏（由标题栏双击切换）
 *   tiledWith  <paneId>#<n>|null  分屏搭档（对半贴时两扇互指）
 *   tileSide   left|right|null    这扇窗贴在搭档的哪一边
 *
 * 「记录存在＝窗口开着」：dock／overlay／fullscreen 这些词不再进状态机，关窗就是删记录。
 * 同一 pane 仍可开多份（实例 id `<paneId>#<n>`），multiplicity／scope 继续管能开几扇。
 *
 * 持久化走项目级 `.pinax/workspace.json`（version:2）；version:1 的旧档在读侧一次性迁移
 * （placement dock→关窗，overlay/split→浮窗，fullscreen/immersive→最大化，bubble/collapsed→侧缘标签）。
 * 老键 `paneForm.<paneId>` / `overlay.<paneId>` 由 next/shell/workspaceMigration.mjs 只读一次。
 * 本模块不碰 localStorage——纯数据，node:test 能直接测。
 */

export const WORKSPACE_VERSION = 2
export const WORKSPACE_FILE = '.pinax/workspace.json'

/** 最小化只有两态：正常，或收起成侧缘标签（气泡球随七钮一起退役）。 */
export const MINIMIZED_MODES = Object.freeze(['none', 'tab'])
export const DEFAULT_MINIMIZED = 'none'

/** 分屏的左右侧（对半贴：左边那扇是搭档，按标题栏「分屏」把当前窗贴到它右边）。 */
export const TILE_SIDES = Object.freeze(['left', 'right'])

export const GEOMETRY_MIN_W = 240
export const GEOMETRY_MAX_W = 2400
export const GEOMETRY_MIN_H = 160
export const GEOMETRY_MAX_H = 2000

/** 新窗的缺省矩形：右上角偏一点，够放正文的一栏宽。 */
export const DEFAULT_FLOATING_GEOMETRY = Object.freeze({ x: 48, y: 48, w: 760, h: 560 })

const PANE_ID_PATTERN = /^[a-z][a-zA-Z0-9._-]{0,79}$/u

export function isMinimized(value) {
  return MINIMIZED_MODES.includes(value)
}

export function isTileSide(value) {
  return TILE_SIDES.includes(value)
}

export function isPaneId(value) {
  return typeof value === 'string' && PANE_ID_PATTERN.test(value)
}

/** `<paneId>#<n>`；n 缺省 1。null／非法 pane id 返回空串（调用方自己拒绝，不靠异常）。 */
export function instanceIdFor(paneId, index = 1) {
  const id = String(paneId ?? '').trim()
  if (!isPaneId(id)) return ''
  const n = Number.isSafeInteger(index) && index > 0 ? index : 1
  return `${id}#${n}`
}

/** 拆实例 id；不带 # 的写法当作 #1（兼容手工传 pane id 的调用点）。 */
export function parseInstanceId(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = /^(.+?)#(\d+)$/u.exec(raw)
  if (!match) return isPaneId(raw) ? { pane: raw, index: 1, id: `${raw}#1` } : null
  if (!isPaneId(match[1])) return null
  const index = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(index) || index < 1 || index > 99) return null
  return { pane: match[1], index, id: `${match[1]}#${index}` }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.round(Math.min(max, Math.max(min, number)))
}

/** 几何净化：形状不对返回 null（改用缺省矩形）；数字越界钳回值域，不静默丢整块。 */
export function normalizeGeometry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const w = clampInt(value.w, GEOMETRY_MIN_W, GEOMETRY_MAX_W, DEFAULT_FLOATING_GEOMETRY.w)
  const h = clampInt(value.h, GEOMETRY_MIN_H, GEOMETRY_MAX_H, DEFAULT_FLOATING_GEOMETRY.h)
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w, h }
}

export function defaultEntry(paneId, index = 1) {
  return {
    instance: instanceIdFor(paneId, index),
    pane: paneId,
    geometry: null,
    z: 0,
    minimized: DEFAULT_MINIMIZED,
    maximized: false,
    tiledWith: null,
    tileSide: null
  }
}

/**
 * 一条窗口记录的净化：未知字段丢弃、越界值回落，绝不把脏数据带进状态机。
 * instance 以入参为准（存档里的 instance 不采信，避免一条错误记录挂到别的 pane 上）。
 * tiledWith／tileSide 必须成对；搭档指向自己也算脏（分屏没有「自己跟自己」）。
 */
export function normalizeEntry(value, fallbackInstance = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = parseInstanceId(fallbackInstance) ?? parseInstanceId(value.instance)
  if (!parsed) return null
  const paneId = isPaneId(value.pane) && value.pane === parsed.pane ? value.pane : parsed.pane
  const partner = parseInstanceId(value.tiledWith)
  const tiled = partner && partner.id !== parsed.id ? partner.id : null
  return {
    instance: parsed.id,
    pane: paneId,
    geometry: normalizeGeometry(value.geometry),
    z: Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0,
    minimized: isMinimized(value.minimized) ? value.minimized : DEFAULT_MINIMIZED,
    maximized: value.maximized === true,
    tiledWith: tiled,
    tileSide: tiled && isTileSide(value.tileSide) ? value.tileSide : null
  }
}

/**
 * version:1 → version:2 的单条迁移。`dock` 不是「开着的窗」，返回 null（记录被丢弃）；
 * 其余位置都收成一扇浮窗，全屏／沉浸按最大化处理，气泡球／侧缘标签折成 tab。
 */
export function migrateV1Entry(value, fallbackInstance = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = parseInstanceId(fallbackInstance) ?? parseInstanceId(value.instance)
  if (!parsed) return null
  const placement = typeof value.placement === 'string' ? value.placement : 'dock'
  if (placement === 'dock') return null
  const entry = {
    instance: parsed.id,
    pane: isPaneId(value.pane) && value.pane === parsed.pane ? value.pane : parsed.pane,
    geometry: normalizeGeometry(value.geometry),
    z: Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0,
    minimized: value.minimized === 'bubble' || value.minimized === 'collapsed' ? 'tab' : DEFAULT_MINIMIZED,
    // fullscreen／immersive 是「整窗」：v2 里它就是最大化，没有独立词表。
    maximized: placement === 'fullscreen' || placement === 'immersive',
    tiledWith: null,
    tileSide: null
  }
  // v1 的分屏没有留下几何：给一份缺省矩形，迁移后仍是可拖动的一扇窗。
  if (!entry.geometry) entry.geometry = { ...DEFAULT_FLOATING_GEOMETRY }
  return entry
}

/** 空工作区（新项目、坏档回落、没有存档都走它）。 */
export function emptyWorkspace() {
  return { version: WORKSPACE_VERSION, entries: {}, warnings: [] }
}

/** 分屏搭档必须双向一致且两扇都存在；加载／改动后统一走这里收口。 */
export function reconcileTiles(rawEntries) {
  const entries = rawEntries
  for (const entry of Object.values(entries)) {
    const partner = entry.tiledWith ? entries[entry.tiledWith] : null
    if (!entry.tiledWith || !partner || partner.tiledWith !== entry.instance) {
      entry.tiledWith = null
      entry.tileSide = null
      continue
    }
    if (entry.tileSide === partner.tileSide) {
      // 两边同侧＝脏档：按实例 id 顺序补成左／右，保持「一对」的对称。
      const leftFirst = entry.instance < partner.instance
      entry.tileSide = leftFirst ? 'left' : 'right'
      partner.tileSide = leftFirst ? 'right' : 'left'
    }
  }
  return entries
}

/**
 * 读盘结果的净化：坏文件不崩、不覆盖，回空工作区并记一条账。
 * version:1 的旧档在这里一次性迁移（不写回，等下次变更整份重写）。
 * 坏条目逐条丢弃并计数（不整份作废——一扇窗的脏数据不该把别人的位置也清掉）。
 */
export function normalizeWorkspace(value) {
  const warnings = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: WORKSPACE_VERSION, entries: {}, warnings: ['WORKSPACE_NOT_OBJECT'] }
  }
  const sourceVersion = Number(value.version)
  const legacy = sourceVersion === 1
  if (!legacy && sourceVersion !== WORKSPACE_VERSION) warnings.push(`WORKSPACE_VERSION_${String(value.version)}`)
  const entries = {}
  const rawEntries = value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries) ? value.entries : {}
  let dropped = 0
  for (const [key, raw] of Object.entries(rawEntries)) {
    const entry = legacy ? migrateV1Entry(raw, key) : normalizeEntry(raw, key)
    if (!entry || entry.instance !== key) {
      // v1 的 dock 记录不是窗口：迁移时正常消失，不算脏数据。
      if (!(legacy && raw && raw.placement === 'dock')) dropped += 1
      continue
    }
    entries[key] = entry
  }
  if (legacy) warnings.push('WORKSPACE_MIGRATED_V1')
  if (dropped) warnings.push(`WORKSPACE_DROPPED_${dropped}`)
  return { version: WORKSPACE_VERSION, entries: reconcileTiles(entries), warnings }
}

function cloneEntry(entry) {
  return {
    ...entry,
    geometry: entry.geometry ? { ...entry.geometry } : null
  }
}

/**
 * 一个工作区状态机实例。默认单例（宿主的 hostWorkspace）；测试注入独立实例，不共享模块级状态。
 *
 * 持久化是可注入的 save(snapshot)（与 agentSessions 同一形状）：有 save 就每次变更后整份回写；
 * 没有 save 时纯内存（浏览器预览、单测）——`persistent` 如实报 false，界面不假装落过盘。
 */
export function createWorkspaceStore({ initial = null, save = null } = {}) {
  const loaded = normalizeWorkspace(initial ?? emptyWorkspace())
  let entries = { ...loaded.entries }
  let warnings = [...loaded.warnings]
  let degraded = false
  let persistTo = typeof save === 'function' ? save : null
  const listeners = new Set()

  function snapshot() {
    return {
      version: WORKSPACE_VERSION,
      entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, cloneEntry(entry)])),
      warnings: [...warnings],
      persistent: Boolean(persistTo) && !degraded
    }
  }

  /** 存档形状：界面上读 snapshot（带 persistent／warnings），落盘只认 { version, entries }。 */
  function serialize() {
    return { version: WORKSPACE_VERSION, entries: snapshot().entries }
  }

  function persist() {
    if (!persistTo) return false
    try {
      const returned = persistTo(serialize())
      if (returned && typeof returned.then === 'function') {
        returned.then(() => { if (degraded) { degraded = false; emit() } }, () => { degraded = true; emit() })
      }
      return true
    } catch {
      degraded = true
      return false
    }
  }

  /** 外壳挂上/摘下主进程通道：换项目、拆窗口时重接，不影响内存里的状态。 */
  function attachPersistence(nextSave) {
    persistTo = typeof nextSave === 'function' ? nextSave : null
    degraded = false
    emit()
  }

  function emit() {
    const value = snapshot()
    for (const listener of [...listeners]) {
      try {
        listener(value)
      } catch {
        // 订阅者异常不拦其它订阅者与状态机。
      }
    }
  }

  function commit() {
    persist()
    emit()
  }

  function nextZ() {
    return Object.values(entries).reduce((max, entry) => Math.max(max, entry.z), 0) + 1
  }

  /** 解除一对贴靠：拖／最大化／收起／关窗都走这里，绝不留「半对」。 */
  function breakTile(entry) {
    if (!entry?.tiledWith) return
    const partner = entries[entry.tiledWith]
    if (partner) {
      partner.tiledWith = null
      partner.tileSide = null
    }
    entry.tiledWith = null
    entry.tileSide = null
  }

  function has(instance) {
    const parsed = parseInstanceId(instance)
    return Boolean(parsed && entries[parsed.id])
  }

  /** 关着的窗返回 null（「记录存在＝窗口开着」）；要缺省形态用 defaultEntry。 */
  function get(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return null
    return entries[parsed.id] ? cloneEntry(entries[parsed.id]) : null
  }

  function list() {
    return Object.values(entries)
      .map(cloneEntry)
      .sort((a, b) => a.z - b.z || a.instance.localeCompare(b.instance))
  }

  /** 某块 pane 此刻开着的实例；按序号升序。 */
  function instancesOf(paneId) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return []
    return Object.values(entries)
      .filter((entry) => entry.pane === id)
      .map((entry) => entry.instance)
      .sort((a, b) => (parseInstanceId(a)?.index ?? 0) - (parseInstanceId(b)?.index ?? 0))
  }

  /** 打开一扇窗：记录即开窗；已开只提叠序，不动几何。geometry 缺省用缺省矩形。 */
  function open(instance, { geometry = null } = {}) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '开窗需要 <paneId>#<n> 形式的实例 id' } }
    const existed = Boolean(entries[parsed.id])
    const entry = entries[parsed.id] ?? defaultEntry(parsed.pane, parsed.index)
    if (!existed) {
      const normalized = normalizeGeometry(geometry)
      entry.geometry = normalized ?? { ...DEFAULT_FLOATING_GEOMETRY }
    }
    entry.z = nextZ()
    entries[parsed.id] = entry
    commit()
    return { ok: true, changed: true, created: !existed, instance: entry.instance, geometry: { ...entry.geometry } }
  }

  /** 同一 pane 再开一份：取最小空位（#1 已被占用时给 #2）。返回新实例 id。 */
  function openInstance(paneId, { geometry = null } = {}) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return null
    let index = 1
    while (entries[`${id}#${index}`]) index += 1
    const instance = instanceIdFor(id, index)
    open(instance, { geometry })
    return instance
  }

  /** 关窗＝删记录；分屏搭档同时解除贴靠（不留半对）。 */
  function close(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '关窗需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: true, changed: false, instance: parsed.id, removed: false }
    breakTile(entry)
    delete entries[parsed.id]
    commit()
    return { ok: true, changed: true, instance: parsed.id, removed: true }
  }

  /** 拖动／缩放结束写入矩形：分屏贴靠就此解除，最大化也随之取消（作者拖了就是想要浮窗）。 */
  function setGeometry(instance, geometry) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '位置需要 <paneId>#<n> 形式的实例 id' } }
    const normalized = normalizeGeometry(geometry)
    if (!normalized) return { ok: false, error: { code: 'INVALID_GEOMETRY', message: '位置需要 { x, y, w?, h? }（x/y 必须是数字）' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这扇窗没有打开' } }
    const same = entry.geometry
      && entry.geometry.x === normalized.x && entry.geometry.y === normalized.y
      && entry.geometry.w === normalized.w && entry.geometry.h === normalized.h
    if (same && !entry.tiledWith && !entry.maximized) {
      return { ok: true, changed: false, instance: entry.instance, geometry: { ...normalized } }
    }
    breakTile(entry)
    entry.geometry = normalized
    entry.maximized = false
    commit()
    return { ok: true, changed: true, instance: entry.instance, geometry: { ...normalized } }
  }

  /** 最小化：tab（侧缘标签）／none（展开）；收起时解除分屏，几何保留。 */
  function minimize(instance, mode) {
    if (!isMinimized(mode)) {
      return { ok: false, error: { code: 'UNKNOWN_MINIMIZED', message: `不支持的最小化状态：${String(mode)}；可用：${MINIMIZED_MODES.join(' / ')}` } }
    }
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '最小化需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这扇窗没有打开' } }
    if (entry.minimized === mode) return { ok: true, changed: false, instance: entry.instance, minimized: mode }
    const previous = entry.minimized
    entry.minimized = mode
    if (mode !== 'none') breakTile(entry)
    commit()
    return { ok: true, changed: true, instance: entry.instance, minimized: mode, previous }
  }

  /** 展开：标签回正常态（位置不变）。 */
  function expand(instance) {
    return minimize(instance, 'none')
  }

  /** 最大化＝占满中栏（标题栏双击）；解除贴靠，几何保留供还原。 */
  function setMaximized(instance, maximized) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '最大化需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这扇窗没有打开' } }
    const next = maximized === true
    if (entry.maximized === next) return { ok: true, changed: false, instance: entry.instance, maximized: next }
    if (next) breakTile(entry)
    entry.maximized = next
    entry.minimized = 'none'
    entry.z = nextZ()
    commit()
    return { ok: true, changed: true, instance: entry.instance, maximized: next }
  }

  function toggleMaximized(instance) {
    const current = get(instance)
    if (!current) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这扇窗没有打开' } }
    return setMaximized(instance, !current.maximized)
  }

  /**
   * 分屏：把 a 贴到 b 的左边（a＝左、b＝右），两扇共享 a 的当前矩形。
   * 最大化／收起中的窗先展开；自贴、关着的窗一律拒绝（返回错误，不静默改别人的状态）。
   */
  function tile(instanceA, instanceB) {
    const a = parseInstanceId(instanceA)
    const b = parseInstanceId(instanceB)
    if (!a || !b || a.id === b.id) {
      return { ok: false, error: { code: 'INVALID_INSTANCE', message: '分屏需要两扇不同的、形如 <paneId>#<n> 的窗' } }
    }
    if (!entries[a.id] || !entries[b.id]) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '分屏的两扇窗都要开着' } }
    const left = entries[a.id]
    const right = entries[b.id]
    const rect = left.geometry ?? { ...DEFAULT_FLOATING_GEOMETRY }
    left.geometry = { ...rect }
    right.geometry = { ...rect }
    left.tiledWith = right.instance
    left.tileSide = 'left'
    right.tiledWith = left.instance
    right.tileSide = 'right'
    left.maximized = false
    right.maximized = false
    left.minimized = 'none'
    right.minimized = 'none'
    left.z = nextZ()
    right.z = left.z
    commit()
    return { ok: true, changed: true, pair: [left.instance, right.instance], geometry: { ...rect } }
  }

  /** 解除分屏：两扇都回到各自的浮窗矩形（矩形保留，只是不再对半贴）。 */
  function untile(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '解屏需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这扇窗没有打开' } }
    if (!entry.tiledWith) return { ok: true, changed: false, instances: [entry.instance] }
    const partner = entries[entry.tiledWith]
    const affected = [entry.instance]
    if (partner) {
      partner.tiledWith = null
      partner.tileSide = null
      affected.push(partner.instance)
    }
    entry.tiledWith = null
    entry.tileSide = null
    commit()
    return { ok: true, changed: true, instances: affected }
  }

  function bringToFront(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '叠序需要实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这扇窗没有打开' } }
    const z = nextZ()
    if (entry.z === z) return { ok: true, changed: false, instance: entry.instance, z }
    entry.z = z
    commit()
    return { ok: true, changed: true, instance: entry.instance, z }
  }

  /**
   * 解注册清理（批次45）：载体被禁用、它的 pane 从视图注册表里消失后，
   * 工作区里属于这些 pane 的每条窗口记录都要一并清掉（几何／叠序／分屏全清）。
   */
  function removePanes(paneIds) {
    const ids = new Set((Array.isArray(paneIds) ? paneIds : [paneIds]).map((id) => String(id ?? '').trim()).filter(isPaneId))
    const removed = []
    for (const [key, entry] of Object.entries(entries)) {
      if (!ids.has(entry.pane)) continue
      breakTile(entry)
      delete entries[key]
      removed.push(key)
    }
    if (removed.length) commit()
    return { ok: true, changed: removed.length > 0, instances: removed }
  }

  /**
   * 老键迁移：paneForm.<paneId> 的形态 + overlay.<paneId> 的位置搬进 #1 实例。
   * 只有「曾经开着」的形态才开窗（dock 什么也不做）；已有记录的不覆盖，只补几何。
   */
  function adoptLegacy(paneId, { form = null, geometry = null } = {}) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return { ok: false, migrated: false }
    const instance = instanceIdFor(id, 1)
    if (!entries[instance]) {
      // 只有 overlay.<paneId> 没有 paneForm.<paneId> 的老档也是「它曾浮着」。
      const floating = form === 'overlay' || form === 'split' || form === 'fullscreen' || form === 'immersive' || (form === null && Boolean(geometry))
      if (!floating) return { ok: true, migrated: false, instance }
      const entry = defaultEntry(id, 1)
      entry.geometry = normalizeGeometry(geometry) ?? { ...DEFAULT_FLOATING_GEOMETRY }
      entry.maximized = form === 'fullscreen' || form === 'immersive'
      entry.z = nextZ()
      entries[instance] = entry
      commit()
      return { ok: true, migrated: true, instance }
    }
    const entry = entries[instance]
    const normalized = geometry ? normalizeGeometry(geometry) : null
    if (normalized && !entry.geometry) {
      entry.geometry = normalized
      commit()
      return { ok: true, migrated: true, instance }
    }
    return { ok: true, migrated: false, instance }
  }

  /** 整份替换（主进程读回、换项目）；v1 旧档在这里迁移成 v2。 */
  function load(next) {
    const normalized = normalizeWorkspace(next ?? emptyWorkspace())
    entries = { ...normalized.entries }
    warnings = [...normalized.warnings]
    degraded = false
    emit()
    return snapshot()
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function reset() {
    entries = {}
    warnings = []
    degraded = false
    emit()
  }

  return {
    has,
    get,
    list,
    instancesOf,
    open,
    openInstance,
    close,
    setGeometry,
    minimize,
    expand,
    setMaximized,
    toggleMaximized,
    tile,
    untile,
    bringToFront,
    removePanes,
    adoptLegacy,
    load,
    attachPersistence,
    snapshot,
    serialize,
    subscribe,
    reset
  }
}

/**
 * 宿主唯一实例：AppNext 订阅它，窗口 chrome／竖条点击都经这里改状态。
 * 模块级单例是有意的——两个组件各持一份 map 就会「关掉一个、另一个还开着」。
 */
export const hostWorkspace = createWorkspaceStore()

/** 宿主统一入口（外壳与后续命令面都调这几个）。 */
export function openPaneWindow(paneId, options) {
  return hostWorkspace.open(instanceIdFor(paneId, 1), options)
}

export function paneEntry(instance) {
  return hostWorkspace.get(instance)
}

export function subscribeWorkspace(listener) {
  return hostWorkspace.subscribe(listener)
}

export function resetWorkspace() {
  hostWorkspace.reset()
}
