/**
 * 工作区四轴状态（M2.5-C 任务一）：把「打开形态」从单枚举拆成四轴。
 *
 * 为什么不是第五种形态：作者原话是「大纲可以悬浮在小说上、可以展开、可以缩成气泡球」——
 * 「悬浮」是位置，「缩成气泡」是最小化状态，「展开」是回到最小化之前的那一轴。
 * 把气泡塞进 placement 词表，就会出现「气泡态里怎么全屏」这种没有答案的组合。
 * 所以状态是四个正交轴 + 一个还原记忆：
 *
 *   placement ∈ dock|split|overlay|fullscreen|immersive   放在哪一栏
 *   minimized ∈ none|bubble|collapsed            在那一栏里收成什么样子
 *   geometry  { x, y, w, h, snap }               像素与吸附边（只对 overlay 有意义）
 *   restore    上一次非全窗的 placement           全窗「还原」回到哪
 *   z          浮层叠序（越大越靠前）
 *   pinned     钉住（批次35）：位置锁定（禁拖）＋进存档；再点解除
 *
 * pinned 是加法字段（schema version 不动）：老存档没有它就当 false，新存档多出来的字段
 * 由 normalizeEntry 逐条判定（只认 true），脏值不影响其它轴。
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

/**
 * 打开位置（协议 v1.2 P21 的四档 ＋ 批次45 的沉浸态）。
 * `immersive` 与 `fullscreen` 同属「整窗」：面板占满窗体、z 提到最前、进入前记住来源。
 * 两者的差别只在外壳怎么让位（沉浸态连活动栏与运行坞一起收起），状态机里没有第二套几何。
 */
export const PLACEMENTS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen', 'immersive'])
/** 整窗位置：进入前记 restore、退出后按 restore 还原（fullscreen 与 immersive 共用一套记忆）。 */
export const FULL_WINDOW_PLACEMENTS = Object.freeze(['fullscreen', 'immersive'])
/** 最小化状态：none＝正常展开；bubble＝气泡球；collapsed＝侧缘小标签。 */
export const MINIMIZED_MODES = Object.freeze(['none', 'bubble', 'collapsed'])
export const SNAP_EDGES = Object.freeze(['left', 'right'])

export const DEFAULT_PLACEMENT = 'dock'
export const DEFAULT_MINIMIZED = 'none'

export function isFullWindowPlacement(value) {
  return FULL_WINDOW_PLACEMENTS.includes(value)
}

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
    z: 0,
    pinned: false
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
  const restore = isPlacement(value.restore) && !isFullWindowPlacement(value.restore) ? value.restore : DEFAULT_PLACEMENT
  return {
    instance: parsed.id,
    pane: paneId,
    placement,
    minimized,
    // 气泡态不展示几何，但保留下来：展开时要回到原位置。
    geometry: normalizeGeometry(value.geometry),
    restore,
    z: Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0,
    // 批次35：钉住只有 true 算数——'yes'／1／{} 一律当没钉（脏数据不带进状态机）。
    pinned: value.pinned === true
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
   * 换位置。进整窗（全屏／沉浸）时把来源记进 restore（已经在整窗就不再记，避免
   * 「整窗→整窗」把来源冲掉）；从整窗出来（还原）由 restorePlacement 负责。
   */
  function place(instance, placement, options = {}) {
    if (!isPlacement(placement)) {
      return { ok: false, error: { code: 'UNKNOWN_PLACEMENT', message: `宿主不支持的位置：${String(placement)}；可用：${PLACEMENTS.join(' / ')}` } }
    }
    const entry = ensure(instance)
    if (!entry) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '位置切换需要 <paneId>#<n> 形式的实例 id' } }
    const previous = { placement: entry.placement, minimized: entry.minimized }
    if (isFullWindowPlacement(placement)) {
      // 进整窗：把「从哪来」记进 restore（已经在整窗就不再记，免得把来源冲成整窗）。
      if (!isFullWindowPlacement(entry.placement)) entry.restore = entry.placement
    } else {
      // 非整窗位置本身就是下一次整窗的还原目标（显式指定优先）。
      entry.restore = isPlacement(options.restore) && !isFullWindowPlacement(options.restore) ? options.restore : placement
    }
    entry.placement = placement
    // 气泡只属于 overlay 一轴：换到别的位置就退出最小化。
    if (placement !== 'overlay') entry.minimized = 'none'
    if (placement === 'overlay' || isFullWindowPlacement(placement)) entry.z = nextZ()
    const changed = previous.placement !== entry.placement || previous.minimized !== entry.minimized
    if (changed) commit()
    return { ok: true, changed, instance: entry.instance, placement: entry.placement, previous }
  }

  /** 还原到整窗之前那一轴；没有记忆时回 dock。 */
  function restorePlacement(instance) {
    const entry = entries[parseInstanceId(instance)?.id ?? '']
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这条实例还没有状态记录' } }
    const target = isPlacement(entry.restore) && !isFullWindowPlacement(entry.restore) ? entry.restore : 'dock'
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

  /**
   * 钉住（批次35 作者原话「没有『钉子』可以去固定」）：位置锁定＋进 `.pinax/workspace.json`。
   * 只改这一轴——placement／minimized／geometry 一个字不动（钉住的是「现在这个样子」）；
   * 再点一下就解除。true 之外的入参一律按「解除」处理（按钮只会发 true／false）。
   */
  function setPinned(instance, pinned) {
    const entry = ensure(instance)
    if (!entry) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '钉住需要 <paneId>#<n> 形式的实例 id' } }
    const next = pinned === true
    if (entry.pinned === next) return { ok: true, changed: false, instance: entry.instance, pinned: next }
    entry.pinned = next
    commit()
    return { ok: true, changed: true, instance: entry.instance, pinned: next }
  }

  /**
   * 关闭一条浮窗实例（批次35 的「×」钮）：回到停靠，而不是收起成侧缘标签。
   * #1 是每块 pane 的缺省实例（instancesOf 永远给 #1），所以只把它收回 dock；
   * #2 起是「再开一份」造出来的临时实例，关掉就整条记录删除（否则它会以收起标签的形态赖着）。
   * 钉住不动：钉的是这条实例的位置，跟它此刻停在哪一栏无关。
   */
  function closeInstance(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '关闭需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: true, changed: false, instance: parsed.id, removed: false }
    if (parsed.index === 1) {
      const changed = entry.placement !== 'dock' || entry.minimized !== 'none'
      entry.placement = 'dock'
      entry.minimized = 'none'
      entry.restore = 'dock'
      if (changed) commit()
      return { ok: true, changed, instance: parsed.id, removed: false }
    }
    delete entries[parsed.id]
    commit()
    return { ok: true, changed: true, instance: parsed.id, removed: true }
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
   * 解注册清理（批次45）：载体被禁用、它的 pane 从视图注册表里消失后，
   * 工作区里属于这些 pane 的每条实例记录都要一并清掉（位置／几何／最小化／钉住全清）。
   * 只删记录、不碰别的 pane；返回被删的实例 id，界面据此同步关闭已开的浮窗。
   */
  function removePanes(paneIds) {
    const ids = new Set((Array.isArray(paneIds) ? paneIds : [paneIds]).map((id) => String(id ?? '').trim()).filter(isPaneId))
    const removed = []
    for (const [key, entry] of Object.entries(entries)) {
      if (!ids.has(entry.pane)) continue
      delete entries[key]
      removed.push(key)
    }
    if (removed.length) commit()
    return { ok: true, changed: removed.length > 0, instances: removed }
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
      entry.restore = isFullWindowPlacement(form) ? 'dock' : form
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
      if (entry.placement === 'overlay' || isFullWindowPlacement(entry.placement)) entry.z = nextZ()
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
    setPinned,
    closeInstance,
    bringToFront,
    dockPane,
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
