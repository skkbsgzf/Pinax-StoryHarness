/**
 * 老键迁移（M2.5-C 任务一）：`paneForm.<paneId>`（形态）与 `overlay.<paneId>`（位置）→ `.pinax/workspace.json`。
 *
 * 这是 localStorage 的最后一块只读例外：
 *   - 只读、不写（setItem 一处都没有）；
 *   - 先搬进工作区状态、确认搬成功（store.adoptLegacy 返回 migrated／已有记录）之后才删键；
 *   - 删键失败就留着（下次还会再搬一次，幂等），不因为旧缓存删不掉而挡住界面。
 *
 * 搬完老键就没了，这块例外随之一并退役。
 */

export const LEGACY_PANE_FORM_PREFIX = 'paneForm.'
export const LEGACY_OVERLAY_PREFIX = 'overlay.'

/** 浏览器缓存访问只收在这一个函数里（沙箱 iframe 的属性访问本身可能抛）。 */
export function legacyLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readRaw(storage, key) {
  try {
    const raw = storage?.getItem?.(key)
    return typeof raw === 'string' && raw ? raw : null
  } catch {
    return null
  }
}

/** 老位置值 { left, top, snap } → 四轴的 geometry（w/h 由调用方按合同补）。 */
export function legacyGeometry(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.left ?? value.x)
  const y = Number(value.top ?? value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const snap = value.snap === 'left' || value.snap === 'right' ? value.snap : null
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), snap }
}

/**
 * 读一遍老键。返回 `{ panes: [{ paneId, form, geometry, keys }], warnings }`；
 * 解析不了的键只记账、不删（删了就把作者的东西丢了）。
 */
export function readLegacyWorkspace({ storage = legacyLocalStorage(), paneIds = [], parse = JSON.parse } = {}) {
  const panes = []
  const warnings = []
  const seen = new Set()
  for (const raw of Array.isArray(paneIds) ? paneIds : []) {
    const paneId = String(raw ?? '').trim()
    if (!paneId || seen.has(paneId)) continue
    seen.add(paneId)
    const formKey = `${LEGACY_PANE_FORM_PREFIX}${paneId}`
    const overlayKey = `${LEGACY_OVERLAY_PREFIX}${paneId}`
    const form = readRaw(storage, formKey)
    const overlay = readRaw(storage, overlayKey)
    if (form === null && overlay === null) continue
    const keys = []
    let geometry = null
    if (form !== null) keys.push(formKey)
    if (overlay !== null) {
      keys.push(overlayKey)
      try {
        geometry = legacyGeometry(parse(overlay))
      } catch {
        warnings.push(`BAD_LEGACY_OVERLAY:${paneId}`)
        // 解析不了的位置不参与迁移，但键也不删——等作者自己清。
        keys.pop()
      }
    }
    panes.push({ paneId, form: form ?? null, geometry, keys })
  }
  return { panes, warnings }
}

/**
 * 迁移一整轮：读老键 → 写进工作区 store（已有记录不覆盖）→ 只删真正搬过或已有记录的键。
 * 返回的 removed 是「真的删掉了几条」，kept 是「留着没动的键」。
 */
export function migrateLegacyWorkspace({ store, storage = legacyLocalStorage(), paneIds = [], parse = JSON.parse } = {}) {
  if (!store || typeof store.adoptLegacy !== 'function') {
    return { ok: false, reason: 'NO_STORE', migrated: 0, removed: 0, kept: [], warnings: [] }
  }
  const { panes, warnings } = readLegacyWorkspace({ storage, paneIds, parse })
  if (!panes.length) return { ok: true, migrated: 0, removed: 0, kept: [], warnings }
  const removable = []
  let migrated = 0
  for (const pane of panes) {
    const result = store.adoptLegacy(pane.paneId, { form: pane.form, geometry: pane.geometry })
    if (!result?.ok) {
      warnings.push(`ADOPT_FAILED:${pane.paneId}`)
      continue
    }
    if (result.migrated) migrated += 1
    // adoptLegacy 成功（无论是新搬的还是已有记录）都说明这份状态已在新真相里，老键可以退场。
    removable.push(...pane.keys)
  }
  let removed = 0
  const kept = []
  for (const key of removable) {
    try {
      storage?.removeItem?.(key)
      removed += 1
    } catch {
      kept.push(key)
    }
  }
  return { ok: true, migrated, removed, kept, warnings }
}
