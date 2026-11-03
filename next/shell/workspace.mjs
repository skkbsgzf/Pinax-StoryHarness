/**
 * 工作区页状态（批次61 · v3）：中心区是「页组 × 页列表 × 每组当前页 × 形态」，不是一堆浮窗。
 *
 * 批次59 的 v2 把窗口当成唯一实体（记录存在＝一扇浮着的窗，位置靠 maximized/tiledWith 拼），
 * 于是「打开一个新页面」只能表现为弹一扇窗。批次61 作者裁定：
 * ①缺省落点＝切页（先切换、再分屏、浮窗只在用户显式指定时才有）；③形态切换走右键，不做常驻钮；
 * ④底座与「每页一份文档」（D）同一轮落地。
 *
 *   group      main|side        这页住在哪个页组；side 组存在＝分屏（页组，不是形态）
 *   order      组内序号          页签栏的排列依据
 *   form       page|floating|tab 占页／浮窗／收成侧缘标签
 *   resource   string|null      这页装的是哪份文档（D）；null＝按 pane 缺省文档打开
 *   viewState  object|null      批次66 任务三：这一页自己的视图状态（folder 模板＝树收了哪几个卷）
 *   geometry   {x,y,w,h}|null   仅 floating 持有；页态为 null
 *   z          叠序（越大越靠前）  仅 floating 参与渲染
 *   maximized  boolean           仅 floating 的子态（双击标题栏占满中栏）
 *
 * 工作区级别多出 `active: { main, side }`（每组当前页）与 `focus`（新页进哪一组），
 * 批次66 任务二再加一份 `lastOpenFiles`（最近打开的文档，滚动封顶、去重置顶）：
 * 它是**预填不是恢复**——重启后不自动开任何一页，只把这份列表摆给作者点。
 * `maximized`／`tiledWith`／`tileSide`／`minimized` 全部退役：页态天然铺满所在页组，
 * 分屏由「side 组是否存在」表达——原来那对 tiledWith 互指只能装两个窗，是页组的退化形态。
 *
 * 一条纪律（沙盘实测抓到的 bug）：**任何让一页离开所在页组的动作，必须立刻修复该组的
 * active 指针**（repairActive）。否则 active 会指向一条已经不在这个组的记录，
 * 页签高亮与正文各说各话。修复只有一处实现，调用方不用自觉。
 *
 * 持久化走项目级 `.pinax/workspace.json`（version:3）；version:1／version:2 的旧档在读侧
 * 一次性迁移（migrateV1Entry → migrateV2Entry）。老键 `paneForm.<paneId>` / `overlay.<paneId>`
 * 由 next/shell/workspaceMigration.mjs 只读一次。本模块不碰 localStorage——纯数据，node:test 能直接测。
 */

export const WORKSPACE_VERSION = 3
export const WORKSPACE_FILE = '.pinax/workspace.json'

/** 页组：主组与侧组。side 组没有页时，主组铺满。 */
export const PAGE_GROUPS = Object.freeze(['main', 'side'])
export const DEFAULT_GROUP = 'main'

/** 页的形态：占页（缺省）／浮窗／收成侧缘标签。 */
export const PAGE_FORMS = Object.freeze(['page', 'floating', 'tab'])
export const DEFAULT_FORM = 'page'

/** resource 只是页与文档之间的标识，不解析语义；给长度上限防脏数据把存档撑爆。 */
const RESOURCE_MAX_LEN = 240

/** 「最近打开」的滚动封顶（批次66 任务二）：去重置顶，多出来的从尾巴上挤掉。 */
export const LAST_OPEN_FILES_LIMIT = 20

/** 每页 viewState 里最多记几个收起的树节点（批次66 任务三）：折叠态是有限集合，不留历史。 */
const VIEW_STATE_MAX_COLLAPSED = 200

export const GEOMETRY_MIN_W = 240
export const GEOMETRY_MAX_W = 2400
export const GEOMETRY_MIN_H = 160
export const GEOMETRY_MAX_H = 2000

/** 新浮窗的缺省矩形：右上角偏一点，够放正文的一栏宽。 */
export const DEFAULT_FLOATING_GEOMETRY = Object.freeze({ x: 48, y: 48, w: 760, h: 560 })

/** 级联步长：一屏内连着浮出多扇时错开，不至于叠成一坨。 */
export const FLOATING_CASCADE_STEP = 28

const PANE_ID_PATTERN = /^[a-z][a-zA-Z0-9._-]{0,79}$/u

export function isPageGroup(value) {
  return PAGE_GROUPS.includes(value)
}

export function isPageForm(value) {
  return PAGE_FORMS.includes(value)
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

/** 文档身份净化：非空字符串（去首尾空白），超长截断；其它一律 null＝按 pane 缺省打开。 */
export function normalizeResource(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > RESOURCE_MAX_LEN ? trimmed.slice(0, RESOURCE_MAX_LEN) : trimmed
}

/**
 * 「最近打开」的一条记录：pane＋resource 两个都在才算数——
 * 列表要能点回去（routeOpen 需要知道开哪块 pane），只记路径的那份清单点了没反应。
 */
function normalizeRecentFile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const pane = typeof value.pane === 'string' ? value.pane.trim() : ''
  if (!isPaneId(pane)) return null
  const resource = normalizeResource(value.resource)
  if (!resource) return null
  return { pane, resource }
}

/**
 * 最近打开列表的净化（读盘／整份替换都走它）：坏条目逐条丢（不整份作废），
 * 按 pane＋resource 去重保首个（首＝最新），封顶 LAST_OPEN_FILES_LIMIT。
 */
export function normalizeLastOpenFiles(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const files = []
  for (const item of value) {
    const entry = normalizeRecentFile(item)
    if (!entry) continue
    const key = `${entry.pane} ${entry.resource}`
    if (seen.has(key)) continue
    seen.add(key)
    files.push(entry)
    if (files.length >= LAST_OPEN_FILES_LIMIT) break
  }
  return files
}

/**
 * 记一笔「刚打开过这份文档」（批次66 任务二）：同一条重复打开＝置顶，不追加第二份；
 * 关闭文档不调这里——列表是「打开过什么」的历史，不是「现在开着什么」的镜像。
 */
export function pushRecentFile(files, { pane, resource } = {}) {
  const entry = normalizeRecentFile({ pane, resource })
  if (!entry) return normalizeLastOpenFiles(files)
  const key = `${entry.pane} ${entry.resource}`
  const rest = normalizeLastOpenFiles(files).filter((item) => `${item.pane} ${item.resource}` !== key)
  return [entry, ...rest].slice(0, LAST_OPEN_FILES_LIMIT)
}

/**
 * 每页自己的视图状态（批次66 任务三）。本批只有 folder 模板那棵树用得上：
 *   collapsed  收起的树节点名（卷名）列表——空集＝全展开，所以不记「展开」只记「收起」。
 * 「选中哪份文档」不在这里：那一格工作区早就有了（`entry.resource`，批次61〔D〕），
 * 再存一份就是两个真相来源，改一边就漂移——本仓的老纪律（selection 只从页数据面推，不另记）。
 * 其它视图（滚动位置等）本批登记不做，字段形状留着不扩——没有消费方的键不落盘。
 */
export function normalizeViewState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const collapsed = Array.isArray(value.collapsed)
    ? [...new Set(value.collapsed.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))].slice(0, VIEW_STATE_MAX_COLLAPSED)
    : []
  if (!collapsed.length) return null
  return { collapsed }
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

export function defaultEntry(paneId, index = 1, { group = DEFAULT_GROUP, form = DEFAULT_FORM, resource = null } = {}) {
  return {
    instance: instanceIdFor(paneId, index),
    pane: paneId,
    resource: normalizeResource(resource),
    group: isPageGroup(group) ? group : DEFAULT_GROUP,
    order: 0,
    form: isPageForm(form) ? form : DEFAULT_FORM,
    geometry: isPageForm(form) && form !== 'page' ? { ...DEFAULT_FLOATING_GEOMETRY } : null,
    z: 0,
    maximized: false,
    viewState: null
  }
}

/**
 * 一条页记录的净化（v3）：未知字段丢弃、越界值回落，绝不把脏数据带进状态机。
 * instance 以入参为准（存档里的 instance 不采信，避免一条错误记录挂到别的 pane 上）。
 * 只有浮窗持有几何：页态／侧缘标签的 geometry 一律收成 null（存档里残留的旧矩形不留效）。
 */
export function normalizeEntry(value, fallbackInstance = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = parseInstanceId(fallbackInstance) ?? parseInstanceId(value.instance)
  if (!parsed) return null
  const paneId = isPaneId(value.pane) && value.pane === parsed.pane ? value.pane : parsed.pane
  const form = isPageForm(value.form) ? value.form : DEFAULT_FORM
  const geometry = form === 'floating' ? normalizeGeometry(value.geometry) : null
  return {
    instance: parsed.id,
    pane: paneId,
    resource: normalizeResource(value.resource),
    group: isPageGroup(value.group) ? value.group : DEFAULT_GROUP,
    order: Number.isSafeInteger(value.order) && value.order >= 0 ? value.order : 0,
    form,
    geometry: geometry ?? (form === 'floating' ? { ...DEFAULT_FLOATING_GEOMETRY } : null),
    z: Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0,
    maximized: form === 'floating' && value.maximized === true,
    viewState: normalizeViewState(value.viewState)
  }
}

/**
 * version:1 → 中间态。v1 把位置当枚举（placement dock|overlay|split|fullscreen|immersive|bubble|collapsed）。
 * `dock` 不是「开着的页」，返回 null（记录被丢弃）；其余先收成 v2 的形状，再交给 migrateV2Entry 落到 v3。
 * 保留这条链是为了「老档读得回来」，不是为了再维护一套 v1 语义。
 */
export function migrateV1Entry(value, fallbackInstance = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = parseInstanceId(fallbackInstance) ?? parseInstanceId(value.instance)
  if (!parsed) return null
  const placement = typeof value.placement === 'string' ? value.placement : 'dock'
  if (placement === 'dock') return null
  const collapsed = value.minimized === 'bubble' || value.minimized === 'collapsed'
  const tiled = placement === 'split'
  const intermediate = {
    instance: parsed.id,
    pane: isPaneId(value.pane) && value.pane === parsed.pane ? value.pane : parsed.pane,
    geometry: normalizeGeometry(value.geometry) ?? { ...DEFAULT_FLOATING_GEOMETRY },
    z: Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0,
    minimized: collapsed ? 'tab' : 'none',
    // fullscreen／immersive 是「整窗」：v2 里它就是最大化，没有独立词表。
    maximized: placement === 'fullscreen' || placement === 'immersive',
    // v1 没留下搭档指针：分屏只能按「一左一右」各归一个页组（左半留 main、右半进 side 由 order 决定）。
    tiledWith: null,
    tileSide: tiled ? (parsed.index % 2 === 0 ? 'right' : 'left') : null
  }
  return migrateV2Entry(intermediate, parsed.id)
}

/**
 * version:2 → version:3 的单条迁移。三档互斥（v2 里最大化会-break 贴靠、收起也会 break 贴靠），
 * 所以按优先级收成一条链就够：
 *   minimized:'tab'  → form:'tab'
 *   maximized        → form:'page'（页态天然铺满，这就是它当年的意思）
 *   tiledWith        → form:'page'，左半留 main、右半进 side
 *   其余              → form:'floating'，几何与 z 原样带入
 * v2 没有「哪份文档」这一格，resource 只能留 null（打开时回落该 pane 的缺省文档）——如实记账，
 * 不猜：整批迁移带一条 WORKSPACE_MIGRATED_V2 警告，界面据此提示「页内文档待重开」。
 */
export function migrateV2Entry(value, fallbackInstance = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = parseInstanceId(fallbackInstance) ?? parseInstanceId(value.instance)
  if (!parsed) return null
  const paneId = isPaneId(value.pane) && value.pane === parsed.pane ? value.pane : parsed.pane
  const geometry = normalizeGeometry(value.geometry)
  const z = Number.isSafeInteger(value.z) && value.z >= 0 ? value.z : 0
  let form = 'floating'
  let group = DEFAULT_GROUP
  if (value.minimized === 'tab') {
    form = 'tab'
  } else if (value.maximized === true) {
    form = 'page'
  } else if (value.tiledWith) {
    form = 'page'
    group = value.tileSide === 'right' ? 'side' : DEFAULT_GROUP
  }
  return {
    instance: parsed.id,
    pane: paneId,
    resource: normalizeResource(value.resource),
    group,
    order: 0,
    form,
    // 浮窗的矩形是 v2 唯一能原样带走的位置信息；页态不需要几何。
    geometry: form === 'floating' ? (geometry ?? { ...DEFAULT_FLOATING_GEOMETRY }) : null,
    z,
    // v2 的 maximized 在浮窗档没有对应物（它已经被上面判成页态），不带走。
    maximized: false,
    // v2 没有「每页视图状态」这一格（批次66 才加的），迁移过来就是没记过。
    viewState: null
  }
}

/** 空工作区（新项目、坏档回落、没有存档都走它）。 */
export function emptyWorkspace() {
  return { version: WORKSPACE_VERSION, entries: {}, active: { main: null, side: null }, focus: DEFAULT_GROUP, lastOpenFiles: [], warnings: [] }
}

/**
 * 组内按 order 升序补齐序号（重复／空洞都算脏，一次收口成 0..n-1）。
 * 只有页态参与；浮窗与侧缘标签不占页组的位置编号。
 */
function reindexOrders(entries) {
  for (const group of PAGE_GROUPS) {
    const pages = Object.values(entries)
      .filter((entry) => entry.form === 'page' && entry.group === group)
      .sort((a, b) => a.order - b.order || a.instance.localeCompare(b.instance))
    pages.forEach((entry, index) => { entry.order = index })
  }
  return entries
}

/**
 * 每组的当前页必须指回「这个组里的一张页」。三种坏味道都在这修：
 * 指针悬空（记录不存在）、指错组（跨组搬页后没跟上）、指向非页态（浮窗／标签不算当前页）。
 * 这是沙盘实测抓到的那一条，收进状态机，调用方不可能忘。
 */
export function repairActive(entries, active) {
  const next = { main: null, side: null }
  for (const group of PAGE_GROUPS) {
    const current = active && active[group] ? entries[active[group]] : null
    if (current && current.group === group && current.form === 'page') {
      next[group] = current.instance
      continue
    }
    const first = Object.values(entries)
      .filter((entry) => entry.form === 'page' && entry.group === group)
      .sort((a, b) => a.order - b.order)[0]
    next[group] = first ? first.instance : null
  }
  return next
}

/**
 * 读盘结果的净化：坏文件不崩、不覆盖，回空工作区并记一条账。
 * version:1／version:2 的旧档在这里一次性迁移（不写回，等下次变更整份重写）。
 * 坏条目逐条丢弃并计数（不整份作废——一页的脏数据不该把别人的位置也清掉）。
 */
export function normalizeWorkspace(value) {
  const warnings = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...emptyWorkspace(), warnings: ['WORKSPACE_NOT_OBJECT'] }
  }
  const sourceVersion = Number(value.version)
  const fromV1 = sourceVersion === 1
  const fromV2 = sourceVersion === 2
  const migrating = fromV1 || fromV2
  if (!migrating && sourceVersion !== WORKSPACE_VERSION) warnings.push(`WORKSPACE_VERSION_${String(value.version)}`)
  const entries = {}
  const rawEntries = value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries) ? value.entries : {}
  let dropped = 0
  for (const [key, raw] of Object.entries(rawEntries)) {
    const entry = fromV1 ? migrateV1Entry(raw, key) : fromV2 ? migrateV2Entry(raw, key) : normalizeEntry(raw, key)
    if (!entry || entry.instance !== key) {
      // v1 的 dock 记录不是页：迁移时正常消失，不算脏数据。
      if (!(fromV1 && raw && raw.placement === 'dock')) dropped += 1
      continue
    }
    entries[key] = entry
  }
  if (fromV1) warnings.push('WORKSPACE_MIGRATED_V1')
  if (fromV2) warnings.push('WORKSPACE_MIGRATED_V2')
  if (migrating) warnings.push('WORKSPACE_RESOURCE_UNKNOWN')
  if (dropped) warnings.push(`WORKSPACE_DROPPED_${dropped}`)
  reindexOrders(entries)
  const focus = isPageGroup(value.focus) && !migrating ? value.focus : DEFAULT_GROUP
  return {
    version: WORKSPACE_VERSION,
    entries,
    active: repairActive(entries, value.active && typeof value.active === 'object' ? value.active : null),
    focus,
    lastOpenFiles: normalizeLastOpenFiles(value.lastOpenFiles),
    warnings
  }
}

/** 形态秩（页态在前）：list() 的稳定序据此，别让 floating／tab 互比不自洽。 */
const FORM_RANK = Object.freeze({ page: 0, floating: 1, tab: 2 })

function compareEntries(a, b) {
  return (FORM_RANK[a.form] ?? FORM_RANK.page) - (FORM_RANK[b.form] ?? FORM_RANK.page)
    || a.z - b.z || a.order - b.order || a.instance.localeCompare(b.instance)
}

function cloneEntry(entry) {
  return {
    ...entry,
    geometry: entry.geometry ? { ...entry.geometry } : null,
    viewState: entry.viewState ? { collapsed: [...entry.viewState.collapsed] } : null
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
  let active = { ...loaded.active }
  let focus = loaded.focus
  let lastOpenFiles = [...loaded.lastOpenFiles]
  let warnings = [...loaded.warnings]
  let degraded = false
  let persistTo = typeof save === 'function' ? save : null
  const listeners = new Set()

  function snapshot() {
    return {
      version: WORKSPACE_VERSION,
      entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, cloneEntry(entry)])),
      active: { ...active },
      focus,
      lastOpenFiles: lastOpenFiles.map((item) => ({ ...item })),
      warnings: [...warnings],
      persistent: Boolean(persistTo) && !degraded
    }
  }

  /** 存档形状：界面上读 snapshot（带 persistent／warnings），落盘认 { version, entries, active, focus, lastOpenFiles }。 */
  function serialize() {
    const copy = snapshot()
    return {
      version: WORKSPACE_VERSION,
      entries: copy.entries,
      active: copy.active,
      focus: copy.focus,
      lastOpenFiles: copy.lastOpenFiles
    }
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

  /** 级联偏移：第 n 扇浮窗相对缺省矩形错开 n×步长，界面上能数清叠了几扇。 */
  function cascadeGeometry(count) {
    const base = { ...DEFAULT_FLOATING_GEOMETRY }
    const step = FLOATING_CASCADE_STEP * Math.max(0, count)
    return {
      x: clampInt(base.x + step, 0, GEOMETRY_MAX_W, base.x),
      y: clampInt(base.y + step, 0, GEOMETRY_MAX_H, base.y),
      w: base.w,
      h: base.h
    }
  }

  /** 组内末尾序号（新页进哪一组就排到那组的最后）。 */
  function nextOrder(group) {
    const pages = Object.values(entries).filter((entry) => entry.form === 'page' && entry.group === group)
    return pages.reduce((max, entry) => Math.max(max, entry.order + 1), 0)
  }

  function has(instance) {
    const parsed = parseInstanceId(instance)
    return Boolean(parsed && entries[parsed.id])
  }

  /** 关着的页返回 null（「记录存在＝页开着」）；要缺省形态用 defaultEntry。 */
  function get(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return null
    return entries[parsed.id] ? cloneEntry(entries[parsed.id]) : null
  }

  /**
   * 全部页记录：先按形态（页态在前），再按叠序／组内序号，最后是实例 id（稳定序，测试可比数组）。
   * 形态用秩比较，不用「谁等于 page」——那样 floating 与 tab 互比都返回 1，
   * 比较器不自洽（既说 a 在前又说 b 在前），排序结果就成了引擎的实现细节，断言没法写。
   */
  function list() {
    return Object.values(entries).map(cloneEntry).sort(compareEntries)
  }

  /** 某个页组当前占页的那些页，按 order 升序——页签栏左半／右半的数据源。 */
  function pagesOf(group) {
    const target = isPageGroup(group) ? group : DEFAULT_GROUP
    return Object.values(entries)
      .filter((entry) => entry.form === 'page' && entry.group === target)
      .map(cloneEntry)
      .sort((a, b) => a.order - b.order || a.instance.localeCompare(b.instance))
  }

  /** 浮窗记录，按叠序升序（末尾＝最靠前，与 v2 的 activeWindow 约定一致）。 */
  function floatingList() {
    return Object.values(entries)
      .filter((entry) => entry.form === 'floating')
      .map(cloneEntry)
      .sort((a, b) => a.z - b.z || a.instance.localeCompare(b.instance))
  }

  /** 收成侧缘标签的记录，按叠序升序（侧缘那一竖列的数据源）。 */
  function tabList() {
    return Object.values(entries)
      .filter((entry) => entry.form === 'tab')
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

  /**
   * 让一页离开某个页组时的收口：离开后该组的当前页必须重指。
   * 所有形态／页组变更都经过这里，跨组搬页不留悬空指针（沙盘那一课）。
   */
  function afterShapeChange(touchedGroups) {
    reindexOrders(entries)
    for (const group of touchedGroups) {
      const current = active[group] ? entries[active[group]] : null
      if (!current || current.group !== group || current.form !== 'page') active[group] = null
    }
    active = repairActive(entries, active)
    if (!pagesOf(focus).length) {
      focus = pagesOf('main').length ? 'main' : pagesOf('side').length ? 'side' : DEFAULT_GROUP
    }
  }

  /**
   * 记一笔「这一页此刻落在哪份文档」（批次66 任务二）。只有带着 resource 的页才有得记：
   * null＝这块 pane 的缺省那份，不是一份可点回去的文档。判据跟着**真实发生的变更**走
   * （开出一页、把一页带回前台、换装文档），空点击不记——否则「最近打开」会被连点同一张页刷成噪音。
   */
  function noteRecent(entry) {
    if (!entry?.resource) return
    lastOpenFiles = pushRecentFile(lastOpenFiles, entry)
  }

  /**
   * 打开一页：记录即开页。已存在则只把它带回前台（页态→置为该组当前页；浮窗→提叠序），
   * 不动几何、不改 resource（换文档走 setResource，这条纪律让「重复点同一张页」零副作用）。
   */
  function open(instance, { resource = null, group = null, form = null, geometry = null } = {}) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '开页需要 <paneId>#<n> 形式的实例 id' } }
    const existed = Boolean(entries[parsed.id])
    if (!existed) {
      const targetGroup = isPageGroup(group) ? group : focus
      const targetForm = isPageForm(form) ? form : DEFAULT_FORM
      const entry = defaultEntry(parsed.pane, parsed.index, { group: targetGroup, form: targetForm, resource })
      entry.order = targetForm === 'page' ? nextOrder(targetGroup) : 0
      entry.geometry = targetForm === 'floating'
        ? (normalizeGeometry(geometry) ?? cascadeGeometry(Object.values(entries).filter((item) => item.form === 'floating').length))
        : null
      entry.z = nextZ()
      entries[parsed.id] = entry
      // 批次66 任务二：这一页带着文档开出来，就记一笔「最近打开」。
      noteRecent(entry)
      if (targetForm === 'page') {
        active[targetGroup] = entry.instance
        focus = targetGroup
      }
      commit()
      return { ok: true, changed: true, created: true, instance: entry.instance, form: entry.form, group: entry.group, resource: entry.resource }
    }
    const entry = entries[parsed.id]
    if (entry.form === 'page') {
      // 已经就是当前页 → 一次空点击不该写盘（竖条连点同一载体是最常见的动作）。
      if (active[entry.group] === entry.instance && focus === entry.group) {
        return { ok: true, changed: false, created: false, instance: entry.instance, form: entry.form, group: entry.group, resource: entry.resource }
      }
      active[entry.group] = entry.instance
      focus = entry.group
      noteRecent(entry)
      commit()
      return { ok: true, changed: true, created: false, instance: entry.instance, form: entry.form, group: entry.group, resource: entry.resource }
    }
    const top = Object.values(entries).reduce((max, item) => Math.max(max, item.z), 0)
    if (entry.z !== top) {
      entry.z = top + 1
      noteRecent(entry)
      commit()
    }
    return { ok: true, changed: entry.z !== top, created: false, instance: entry.instance, form: entry.form, group: entry.group, resource: entry.resource }
  }

  /**
   * 同一 pane 再开一页。〔裁定④后 multiplicity 归 next/shell/openTarget.mjs 判：
   * `keyed` 才允许按文档各开一页，`single` 在这之前就被拦下〕这里只管分配最小空位。
   */
  function openInstance(paneId, options = {}) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return null
    let index = 1
    while (entries[`${id}#${index}`]) index += 1
    const instance = instanceIdFor(id, index)
    open(instance, options)
    return instance
  }

  /** 关页＝删记录；所在组的当前页同时重指。 */
  function close(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '关页需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: true, changed: false, instance: parsed.id, removed: false }
    const group = entry.group
    delete entries[parsed.id]
    afterShapeChange([group])
    commit()
    return { ok: true, changed: true, instance: parsed.id, removed: true }
  }

  /**
   * 形态迁移的唯一入口：页 ⇄ 浮窗 ⇄ 侧缘标签。
   * 进浮窗才给几何（沿用原矩形，没有就级联一个新的）；出浮窗几何收成 null。
   * 侧缘标签不占页组，但仍留着它的 home group——「占为页」时回到原来那一侧。
   */
  function setForm(instance, form) {
    if (!isPageForm(form)) {
      return { ok: false, error: { code: 'UNKNOWN_FORM', message: `不支持的形态：${String(form)}；可用 ${PAGE_FORMS.join(' / ')}` } }
    }
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '改形态需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    if (entry.form === form) return { ok: true, changed: false, instance: entry.instance, form }
    const previous = entry.form
    const group = entry.group
    // 级联步数只数「已经在浮着的别人」：先算再改形态，否则第一扇浮窗会白错开一格。
    const floatingCount = Object.values(entries).filter((item) => item.form === 'floating').length
    entry.form = form
    if (form === 'floating') {
      entry.geometry = entry.geometry ?? cascadeGeometry(floatingCount)
      entry.z = nextZ()
    } else if (form === 'tab') {
      entry.geometry = null
      entry.maximized = false
    } else {
      entry.geometry = null
      entry.maximized = false
      entry.order = nextOrder(group)
      active[group] = entry.instance
      focus = group
    }
    afterShapeChange([group])
    commit()
    return { ok: true, changed: true, instance: entry.instance, form, previous, group: entry.group }
  }

  /** 分屏＝把一页搬进对面页组（对半就是两组各占一半，不需要另一套几何）。 */
  function moveToGroup(instance, group) {
    if (!isPageGroup(group)) {
      return { ok: false, error: { code: 'UNKNOWN_GROUP', message: `不支持的页组：${String(group)}；可用 ${PAGE_GROUPS.join(' / ')}` } }
    }
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '搬页需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    const from = entry.group
    if (from === group) return { ok: true, changed: false, instance: entry.instance, group }
    entry.group = group
    if (entry.form === 'page') {
      entry.order = nextOrder(group)
      active[group] = entry.instance
      focus = group
    }
    afterShapeChange([from, group])
    commit()
    return { ok: true, changed: true, instance: entry.instance, group, from }
  }

  /** 置为某组的当前页；只接受「这个组里的页」，别的都拒（不静默搬别人家的高亮）。 */
  function setActive(group, instance) {
    if (!isPageGroup(group)) return { ok: false, error: { code: 'UNKNOWN_GROUP', message: `不支持的页组：${String(group)}` } }
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '切页需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    if (entry.group !== group || entry.form !== 'page') {
      return { ok: false, error: { code: 'NOT_A_PAGE_IN_GROUP', message: `${parsed.id} 不在 ${group} 组的页列表里` } }
    }
    const changed = active[group] !== entry.instance || focus !== group
    active[group] = entry.instance
    focus = group
    if (changed) commit()
    return { ok: true, changed, instance: entry.instance, group }
  }

  /** 〔D〕这页换装哪份文档：null＝回落该 pane 的缺省文档。资源身份只在这一格改，别处不抄近路。 */
  function setResource(instance, resource) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '改文档需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    const next = normalizeResource(resource)
    if (entry.resource === next) return { ok: true, changed: false, instance: entry.instance, resource: next }
    entry.resource = next
    noteRecent(entry)
    commit()
    return { ok: true, changed: true, instance: entry.instance, resource: next }
  }

  /**
   * 〔批次66 任务三〕这一页自己的视图状态：folder 模板＝树的折叠集＋选中项。
   * 整份替换（不是合并）——状态的唯一作者就是那块视图本身，合并只会让两边各留半截真相。
   * 收成 null 的条件：净化后什么也没记（全展开＋没选中＝没有值得落盘的东西）。
   */
  function setViewState(instance, viewState) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '改视图状态需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    const next = normalizeViewState(viewState)
    const same = (entry.viewState?.collapsed ?? []).join('\u0000') === (next?.collapsed ?? []).join('\u0000')
    if (same) return { ok: true, changed: false, instance: entry.instance, viewState: entry.viewState }
    entry.viewState = next
    commit()
    return { ok: true, changed: true, instance: entry.instance, viewState: next }
  }

  /** 拖动／缩放结束写入矩形：只有浮窗有矩形可写，顺手取消它的最大化（作者拖了就是想要自由窗）。 */
  function setGeometry(instance, geometry) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '位置需要 <paneId>#<n> 形式的实例 id' } }
    const normalized = normalizeGeometry(geometry)
    if (!normalized) return { ok: false, error: { code: 'INVALID_GEOMETRY', message: '位置需要 { x, y, w?, h? }（x/y 必须是数字）' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    if (entry.form !== 'floating') return { ok: false, error: { code: 'NOT_FLOATING', message: `${parsed.id} 不是浮窗，没有可写的位置` } }
    const same = entry.geometry
      && entry.geometry.x === normalized.x && entry.geometry.y === normalized.y
      && entry.geometry.w === normalized.w && entry.geometry.h === normalized.h
    if (same && !entry.maximized) return { ok: true, changed: false, instance: entry.instance, geometry: { ...normalized } }
    entry.geometry = normalized
    entry.maximized = false
    commit()
    return { ok: true, changed: true, instance: entry.instance, geometry: { ...normalized } }
  }

  /** 浮窗的子态：最大化＝占满中栏（标题栏双击），几何留着供还原。页态没有这一档（页天然铺满）。 */
  function setMaximized(instance, maximized) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '最大化需要 <paneId>#<n> 形式的实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    if (entry.form !== 'floating') return { ok: false, error: { code: 'NOT_FLOATING', message: `${parsed.id} 不是浮窗，最大化只属于浮窗档` } }
    const next = maximized === true
    if (entry.maximized === next) return { ok: true, changed: false, instance: entry.instance, maximized: next }
    entry.maximized = next
    entry.z = nextZ()
    commit()
    return { ok: true, changed: true, instance: entry.instance, maximized: next }
  }

  function toggleMaximized(instance) {
    const current = get(instance)
    if (!current) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    return setMaximized(instance, !current.maximized)
  }

  /**
   * 置顶。页态＝置为该组当前页（叠序不参与渲染，别给点一下就涨一格的假变化——
   * 那会让每次点击都写一次盘）；浮窗／标签＝抬到最高叠序，本来就在顶就是 no-op。
   */
  function bringToFront(instance) {
    const parsed = parseInstanceId(instance)
    if (!parsed) return { ok: false, error: { code: 'INVALID_INSTANCE', message: '叠序需要实例 id' } }
    const entry = entries[parsed.id]
    if (!entry) return { ok: false, error: { code: 'UNKNOWN_INSTANCE', message: '这一页没有打开' } }
    if (entry.form === 'page') {
      if (active[entry.group] === entry.instance) return { ok: true, changed: false, instance: entry.instance, z: entry.z }
      active[entry.group] = entry.instance
      focus = entry.group
      commit()
      return { ok: true, changed: true, instance: entry.instance, z: entry.z }
    }
    const top = Object.values(entries).reduce((max, item) => Math.max(max, item.z), 0)
    if (entry.z === top) return { ok: true, changed: false, instance: entry.instance, z: entry.z }
    entry.z = top + 1
    commit()
    return { ok: true, changed: true, instance: entry.instance, z: entry.z }
  }

  /**
   * 解注册清理（批次45）：载体被禁用、它的 pane 从视图注册表里消失后，
   * 工作区里属于这些 pane 的每条页记录都要一并清掉（几何／叠序／页组／当前页全清）。
   */
  function removePanes(paneIds) {
    const ids = new Set((Array.isArray(paneIds) ? paneIds : [paneIds]).map((id) => String(id ?? '').trim()).filter(isPaneId))
    const removed = []
    const touched = new Set()
    for (const [key, entry] of Object.entries(entries)) {
      if (!ids.has(entry.pane)) continue
      touched.add(entry.group)
      delete entries[key]
      removed.push(key)
    }
    if (removed.length) {
      afterShapeChange([...touched])
      commit()
    }
    return { ok: true, changed: removed.length > 0, instances: removed }
  }

  /**
   * 老键迁移：paneForm.<paneId> 的形态 + overlay.<paneId> 的位置搬进 #1 实例。
   * 只有「曾经开着」的形态才开页（dock 什么也不做）；已有记录的不覆盖，只补几何。
   * v2 的形态词（overlay/split/fullscreen/immersive）都算「曾开着」，落成 v3 的浮窗。
   */
  function adoptLegacy(paneId, { form = null, geometry = null } = {}) {
    const id = String(paneId ?? '').trim()
    if (!isPaneId(id)) return { ok: false, migrated: false }
    const instance = instanceIdFor(id, 1)
    if (!entries[instance]) {
      // 只有 overlay.<paneId> 没有 paneForm.<paneId> 的老档也是「它曾浮着」。
      const floating = form === 'overlay' || form === 'split' || form === 'fullscreen' || form === 'immersive' || (form === null && Boolean(geometry))
      if (!floating) return { ok: true, migrated: false, instance }
      const entry = defaultEntry(id, 1, { form: 'floating' })
      entry.geometry = normalizeGeometry(geometry) ?? { ...DEFAULT_FLOATING_GEOMETRY }
      entry.z = nextZ()
      entries[instance] = entry
      afterShapeChange([entry.group])
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

  /** 整份替换（主进程读回、换项目）；v1／v2 旧档在这里迁移成 v3。 */
  function load(next) {
    const normalized = normalizeWorkspace(next ?? emptyWorkspace())
    entries = { ...normalized.entries }
    active = { ...normalized.active }
    focus = normalized.focus
    lastOpenFiles = [...normalized.lastOpenFiles]
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
    active = { main: null, side: null }
    focus = DEFAULT_GROUP
    lastOpenFiles = []
    warnings = []
    degraded = false
    emit()
  }

  /** 最近打开（批次66 任务二）的读数口径：副本，调用方改了不影响状态机。 */
  function recentFiles() {
    return lastOpenFiles.map((item) => ({ ...item }))
  }

  return {
    has,
    get,
    list,
    pagesOf,
    floatingList,
    tabList,
    instancesOf,
    recentFiles,
    open,
    openInstance,
    close,
    setForm,
    moveToGroup,
    setActive,
    setResource,
    setViewState,
    setGeometry,
    setMaximized,
    toggleMaximized,
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
 * 宿主唯一实例：AppNext 订阅它，页签栏／竖条点击／右键菜单都经这里改状态。
 * 模块级单例是有意的——两个组件各持一份 map 就会「关掉一页、另一页还开着」。
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
