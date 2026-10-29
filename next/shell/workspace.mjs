/**
 * 工作区四轴状态（M2.5-C 任务一）：把「打开形态」从单枚举拆成四轴。
 *
 * 为什么不是第五种形态：作者原话是「大纲可以悬浮在小说上、可以展开、可以缩成气泡球」——
 * 「悬浮」是位置，「缩成气泡」是最小化状态，「展开」是回到最小化之前的那一轴。
 * 把气泡塞进 placement 词表，就会出现「气泡态里怎么全屏」这种没有答案的组合。
 * 所以状态是四个正交轴 + 一个还原记忆：
 *
 *   placement ∈ dock|split|overlay|fullscreen   放在哪一栏
 *   minimized ∈ none|bubble|collapsed            在那一栏里收成什么样子
 *   geometry  { x, y, w, h, snap }               像素与吸附边（只对 overlay 有意义）
 *   restore    上一次非全屏的 placement           全屏「还原」回到哪
 *   z          浮层叠序（越大越靠前）
 *
 * 实例 id 是 `<paneId>#<n>`（n 从 1 起）：同一块 pane 可以开两份——「大纲浮在正文上的同时，
 * 中栏也能有一份树」。状态按实例存，所以两份互不串。
 *
 * 持久化走项目级 `.pinax/workspace.json`（version:1），渲染层只经主进程通道读写；
 * 老键 `paneForm.<paneId>` / `overlay.<paneId>` 由 next/shell/workspaceMigration.mjs 只读一次，
 * 搬进这里、成功后删键。本模块不碰 localStorage——纯数据，node:test 能直接测。
 */

export const WORKSPACE_VERSION = 1
export const WORKSPACE_FILE = '.pinax/workspace.json'

/** 打开位置（协议 v1.2 P21 的四档，一个不增一个不减）。 */
export const PLACEMENTS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen'])
/** 最小化状态：none＝正常展开；bubble＝气泡球；collapsed＝侧缘小标签。 */
export const MINIMIZED_MODES = Object.freeze(['none', 'bubble', 'collapsed'])
export const SNAP_EDGES = Object.freeze(['left', 'right'])

export const DEFAULT_PLACEMENT = 'dock'
export const DEFAULT_MINIMIZED = 'none'

/** 几何的合同值域：宽度沿用 overlay 合同的 200–600（宿主只做少量放宽给中栏浮窗），高度同理。 */
export const GEOMETRY_MIN_W = 200
export const GEOMETRY_MAX_W = 900
export const GEOMETRY_MIN_H = 120
export const GEOMETRY_MAX_H = 2000

const PANE_ID_PATTERN = /^[a-z][a-zA-Z0-9._-]{0,79}$/u

export function isPlacement(value) {
  return PLACEMENTS.includes(value)
}

export function isMinimized(value) {
  return MINIMIZED_MODES.includes(value)
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

/** 拆实例 id；不带 # 的旧写法当作 #1（兼容手工传 pane id 的调用点）。 */
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

/** 几何净化：形状不对返回 null（缺省位置）；数字越界钳回值域，不静默丢整块。 */
export function normalizeGeometry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const w = clampInt(value.w, GEOMETRY_MIN_W, GEOMETRY_MAX_W, 300)
  const h = clampInt(value.h, GEOMETRY_MIN_H, GEOMETRY_MAX_H, 420)
  const snap = SNAP_EDGES.includes(value.snap) ? value.snap : null
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w, h, snap }
}

export function defaultEntry(paneId, index = 1) {
  return {
    instance: instanceIdFor(paneId, index),
    pane: paneId,
    placement: DEFAULT_PLACEMENT,
    minimized: DEFAULT_MINIMIZED,
    geometry: null,
    restore: DEFAULT_PLACEMENT,
    z: 0
  }
}

/**
 * 一条状态记录的净化：未知字段丢弃、越界值回落，绝不把脏数据带进状态机。
 * instance 以入参为准（存档里的 instance 不采信，避免一条错误记录挂到别的 pane 上）。
 */
export function normalizeEntry(value, fallbackInstance = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = parseInstanceId(fallbackInstance) ?? parseInstanceId(value.instance)
  if (!parsed) return null
  const paneId = isPaneId(value.pane) && value.pane === parsed.pane ? value.pane : parsed.pane
  const placement = isPlacement(value.placement) ? value.placement : DEFAULT_PLACEMENT
  const minimized = isMinimized(value.minimized) ? value.minimized : DEFAULT_MINIMIZED
  const restore = isPlacement(value.restore) && value.restore !== 'fullscreen' ? value.restore : DEFAULT_PLACEMENT
  return {
    instance: parsed.id,
    pane: paneId,
    placement,
    minimized,
    // 气泡态不展示几何，但保留下来：展开时要回到原位置。
    geometry: normalizeGeometry(value.geometry),
    restore,
    z: Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0
  }
}

/** 空工作区（新项目、坏档回落、没有存档都走它）。 */
export function emptyWorkspace() {
  return { version: WORKSPACE_VERSION, entries: {}, warnings: [] }
}

/**
 * 读盘结果的净化：坏文件不崩、不覆盖，回空工作区并记一条账。
 * 坏条目逐条丢弃并计数（不整份作废——一块面板的脏数据不该把别人的位置也清掉）。
 */
export function normalizeWorkspace(value) {
  const warnings = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: WORKSPACE_VERSION, entries: {}, warnings: ['WORKSPACE_NOT_OBJECT'] }
  }
  if (value.version !== WORKSPACE_VERSION) warnings.push(`WORKSPACE_VERSION_${String(value.version)}`)
  const entries = {}
  const rawEntries = value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries) ? value.entries : {}
  let dropped = 0
  for (const [key, raw] of Object.entries(rawEntries)) {
    const entry = normalizeEntry(raw, key)
    if (!entry || entry.instance !== key) {
      dropped += 1
      continue
    }
    entries[key] = entry
  }
  if (dropped) warnings.push(`WORKSPACE_DROPPED_${dropped}`)
  return { version: WORKSPACE_VERSION, entries, warnings }
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

  function ensure(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return null
    if (!entries[parsed.id]) entries[parsed.id] = defaultEntry(parsed.pane, parsed.index)
    return entries[parsed.id]
  }

  function get(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return null
    return entries[parsed.id] ? cloneEntry(entries[parsed.id]) : defaultEntry(parsed.pane, parsed.index)
  }

  function list() {
    return Object.values(entries)
      .map(cloneEntry)
      .sort((a, b) => a.z - b.z || a.instance.localeCompare(b.instance))
  }

  /** 某块 pane 的全部实例；没有存档记录时至少给 #1（缺省实例不落盘，除非被改过）。 */
  function instancesOf(paneId) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return []
    const known = Object.values(entries).filter((entry) => entry.pane === id).map((entry) => entry.instance)
    if (!known.includes(`${id}#1`)) known.unshift(`${id}#1`)
    return known.sort((a, b) => {
      const ia = parseInstanceId(a)?.index ?? 0
      const ib = parseInstanceId(b)?.index ?? 0
      return ia - ib
    })
  }

  /** 再开一份：取最小空位（#1 已被占用时给 #2）。返回新实例 id。 */
  function openInstance(paneId, { placement = 'overlay' } = {}) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return null
    let index = 1
    while (entries[`${id}#${index}`]) index += 1
    const entry = defaultEntry(id, index)
    entry.placement = isPlacement(placement) ? placement : 'overlay'
    entry.restore = 'dock'
    entry.z = nextZ()
    entries[entry.instance] = entry
    commit()
    return entry.instance
  }

  function nextZ() {
    return Object.values(entries).reduce((max, entry) => Math.max(max, entry.z), 0) + 1
  }

  /**
   * 换位置。进全屏时把来源记进 restore（已经全屏就不再记，避免「全屏→全屏」把来源冲掉）；
   * 从全屏出来（还原）由 restorePlacement 负责。
   */
  function place(instance, placement, options = {}) {
    if (!isPlacement(placement)) {
      return { ok: false, error: { code: 'UNKNOWN_PLACEMENT', message: `宿主不支持的位置：${String(placement)}；可用：${PLACEMENTS.join(' / ')}` } }
    }
    const entry = ensure(instance)
    if (!entry) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '位置切换需要 <paneId>#<n> 形式的实例 id' } }
    const previous = { placement: entry.placement, minimized: entry.minimized }
    if (placement === 'fullscreen') {
      // 进全屏：把「从哪来」记进 restore（已经全屏就不再记，免得把来源冲成全屏）。
      if (entry.placement !== 'fullscreen') entry.restore = entry.placement
    } else {
      // 非全屏位置本身就是下一次全屏的还原目标（显式指定优先）。
      entry.restore = isPlacement(options.restore) && options.restore !== 'fullscreen' ? options.restore : placement
    }
    entry.placement = placement
    // 气泡只属于 overlay 一轴：换到别的位置就退出最小化。
    if (placement !== 'overlay') entry.minimized = 'none'
    if (placement === 'overlay' || placement === 'fullscreen') entry.z = nextZ()
    const changed = previous.placement !== entry.placement || previous.minimized !== entry.minimized
    if (changed) commit()
    return { ok: true, changed, instance: entry.instance, placement: entry.placement, previous }
  }

  /** 还原到全屏之前那一轴；没有记忆时回 dock。 */
  function restorePlacement(instance) {
    const entry = entries[parseInstanceId(instance)?.id ?? '']
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这条实例还没有状态记录' } }
    const target = isPlacement(entry.restore) && entry.restore !== 'fullscreen' ? entry.restore : 'dock'
    return place(instance, target)
  }

  /** 最小化：bubble（气泡球）／collapsed（侧缘标签）／none（展开）。 */
  function minimize(instance, mode) {
    if (!isMinimized(mode)) {
      return { ok: false, error: { code: 'UNKNOWN_MINIMIZED', message: `不支持的最小化状态：${String(mode)}；可用：${MINIMIZED_MODES.join(' / ')}` } }
    }
    const entry = ensure(instance)
    if (!entry) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '最小化需要 <paneId>#<n> 形式的实例 id' } }
    if (entry.minimized === mode) return { ok: true, changed: false, instance: entry.instance, minimized: mode }
    const previous = entry.minimized
    entry.minimized = mode
    commit()
    return { ok: true, changed: true, instance: entry.instance, minimized: mode, previous }
  }

  /** 展开：气泡／标签回正常态（位置不变）。 */
  function expand(instance) {
    return minimize(instance, 'none')
  }

  /** 拖拽结束后写入位置与吸附边。 */
  function setGeometry(instance, geometry) {
    const entry = ensure(instance)
    if (!entry) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '位置需要 <paneId>#<n> 形式的实例 id' } }
    const normalized = normalizeGeometry(geometry)
    if (!normalized) return { ok: false, error: { code: 'INVALID_GEOMETRY', message: '位置需要 { x, y, w?, h?, snap? }（x/y 必须是数字）' } }
    const same = entry.geometry
      && entry.geometry.x === normalized.x && entry.geometry.y === normalized.y
      && entry.geometry.w === normalized.w && entry.geometry.h === normalized.h
      && entry.geometry.snap === normalized.snap
    if (same) return { ok: true, changed: false, instance: entry.instance, geometry: { ...normalized } }
    entry.geometry = normalized
    if (normalized.snap) entry.minimized = 'none'
    commit()
    return { ok: true, changed: true, instance: entry.instance, geometry: { ...normalized } }
  }

  function bringToFront(instance) {
    const entry = ensure(instance)
    if (!entry) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '叠序需要实例 id' } }
    const z = nextZ()
    if (entry.z === z) return { ok: true, changed: false, instance: entry.instance, z }
    entry.z = z
    commit()
    return { ok: true, changed: true, instance: entry.instance, z }
  }

  /** 把某块 pane 的全部实例收回 dock 并展开（右键「停靠栏」）。 */
  function dockPane(paneId) {
    const affected = []
    for (const instance of instancesOf(paneId)) {
      const entry = ensure(instance)
      if (!entry) continue
      if (entry.placement !== 'dock' || entry.minimized !== 'none') {
        entry.placement = 'dock'
        entry.minimized = 'none'
        entry.restore = 'dock'
        affected.push(entry.instance)
      }
    }
    if (affected.length) commit()
    return { ok: true, changed: affected.length > 0, instances: affected }
  }

  /**
   * 老键迁移：paneForm.<paneId> 的形态 + overlay.<paneId> 的位置搬进 #1 实例。
   * 已有记录的不覆盖（新真相优先），只把缺的几何补上。
   */
  function adoptLegacy(paneId, { form = null, geometry = null } = {}) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return { ok: false, migrated: false }
    const instance = `${id}#1`
    const existed = Boolean(entries[instance])
    const entry = ensure(instance)
    let migrated = false
    if (!existed && isPlacement(form)) {
      entry.placement = form
      entry.restore = form === 'fullscreen' ? 'dock' : form
      if (form !== 'overlay') entry.minimized = 'none'
      migrated = true
    }
    if (geometry) {
      const normalized = normalizeGeometry({ ...geometry, w: geometry.w ?? entry.geometry?.w, h: geometry.h ?? entry.geometry?.h })
      if (normalized && !entry.geometry) {
        entry.geometry = normalized
        migrated = true
      }
    }
    if (migrated) {
      if (entry.placement === 'overlay' || entry.placement === 'fullscreen') entry.z = nextZ()
      commit()
    }
    return { ok: true, migrated, instance }
  }

  /** 整份替换（主进程读回、换项目）。 */
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
    get,
    list,
    instancesOf,
    openInstance,
    place,
    restorePlacement,
    minimize,
    expand,
    setGeometry,
    bringToFront,
    dockPane,
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
 * 宿主唯一实例：AppNext 订阅它，右键菜单／悬浮窗按钮都经这里改状态。
 * 模块级单例是有意的——两个组件各持一份 map 就会「关掉一个、另一个还开着」。
 */
export const hostWorkspace = createWorkspaceStore()

/** 宿主统一入口（外壳与后续命令面都调这几个）。 */
export function setPanePlacement(paneId, placement, options) {
  return hostWorkspace.place(instanceIdFor(paneId, 1), placement, options)
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
