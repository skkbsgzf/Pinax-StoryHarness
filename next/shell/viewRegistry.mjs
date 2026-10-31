/**
 * 视图注册表（M2.5-C 任务二）：pane 用 `view` 声明「用什么方式看」，宿主按注册表解析渲染器。
 *
 * 为什么要有它：CarrierPaneHost 里原先按 pane id 前缀写死了七个分支——加一块载体就得改外壳，
 * 第三方载体等于没法带自己的视图。注册表把「类型名 → 渲染器」变成一张可查的表：
 *   有则渲染，没有则占位（如实说这块视图还没做，不假装能编辑）。
 *
 * 三条边界（对齐 Obsidian 的 Views 协议）：
 *   1) 视图实例由宿主创建与销毁，插件不得持有引用——factory 是纯函数，每次解析现算；
 *   2) v2 只给第三方开 `pinax.view.custom` 一个类型名（富视图沙箱不在本批）；
 *   3) 宿主视图类型由宿主注册，载体不能顶替（注册同名即拒，与工具命名空间同一口径）。
 *
 * 批次44：宿主视图类型从六个加到八个——多的是两块形态（见 next/shell/formTaxonomy.mjs）：
 *   `pinax.view.board` 看板面（结构化数据的视图：列表／表格／图谱，核心区里成块的地方）；
 *   `pinax.view.app`   应用面（外部端口上的网页应用，宿主给一块内嵌浏览器，不手搓组件）。
 *
 * 纯数据模块，不 import Vue——node:test 直接测注册/解析/释放。
 */

/** 宿主自带的视图类型（P13 的渲染器词表落地版 ＋ 批次44 的看板面与应用面）。 */
export const HOST_VIEW_TYPES = Object.freeze([
  'pinax.view.tree',
  'pinax.view.list',
  'pinax.view.editor',
  'pinax.view.reader',
  'pinax.view.diff',
  'pinax.view.graph',
  'pinax.view.board',
  'pinax.view.app'
])

/** 第三方唯一可用的视图类型名（v2 只登记类型名，不跑第三方代码）。 */
export const CUSTOM_VIEW_TYPE = 'pinax.view.custom'

export const VIEW_TYPES = Object.freeze([...HOST_VIEW_TYPES, CUSTOM_VIEW_TYPE])

/**
 * v1 兼容绑定：老 pane 既没声明 view、也没声明 kind 时，按 id 前缀认内容面。
 * 这是「迁移期的一张对照表」，不是第二套真相——v3 的 pane 一律显式写 view 与 kind。
 * 顺序有意义：更长的前缀先匹配（outline.widget 先于 outline.）。
 */
export const LEGACY_VIEW_BINDINGS = Object.freeze([
  { prefix: 'novel.', view: 'pinax.view.editor', kind: 'chapter-editor' },
  { prefix: 'outline.', view: 'pinax.view.editor', kind: 'outline-editor' },
  { prefix: 'notes.', view: 'pinax.view.editor', kind: 'notes-editor' },
  { prefix: 'worldbook.', view: 'pinax.view.reader', kind: 'entry-detail' },
  { prefix: 'script.', view: 'pinax.view.editor', kind: 'script-editor' },
  { prefix: 'setting.', view: 'pinax.view.editor', kind: 'rule-editor' },
  { prefix: 'reference.', view: 'pinax.view.reader', kind: 'document-detail' },
  // 记录型载体（批次40 · M4／M5）：五栏共用一个记录详情面，载体 key 由 pane id 首段区分。
  { prefix: 'material.', view: 'pinax.view.editor', kind: 'records-editor' },
  { prefix: 'comic.', view: 'pinax.view.editor', kind: 'records-editor' },
  { prefix: 'video.', view: 'pinax.view.editor', kind: 'records-editor' },
  { prefix: 'experience.', view: 'pinax.view.editor', kind: 'records-editor' },
  { prefix: 'online.', view: 'pinax.view.editor', kind: 'records-editor' }
])

export function isViewType(value) {
  return typeof value === 'string' && /^pinax\.view\.[a-z][a-z0-9.-]{0,63}$/u.test(value)
}

/** 按 pane id 前缀找 v1 绑定（长前缀优先）。 */
export function legacyBindingForPane(paneId) {
  const id = String(paneId ?? '')
  let best = null
  for (const binding of LEGACY_VIEW_BINDINGS) {
    if (!id.startsWith(binding.prefix)) continue
    if (!best || binding.prefix.length > best.prefix.length) best = binding
  }
  return best
}

/**
 * 宿主工厂：给定 pane 与当前数据，算出要渲染的内容面。
 * v3：pane.kind 是权威来源；v1/v2 没写 kind 的 pane 才按 id 前缀回落（迁移期两条路并存）。
 * view 决定渲染器，kind 决定内容面——两者不再互相推导。
 */
export function hostViewFactory({ pane, data } = {}) {
  const binding = legacyBindingForPane(String(pane?.id ?? ''))
  let kind = typeof pane?.kind === 'string' ? pane.kind : (binding?.kind ?? null)
  if (!kind) return null
  // 提案审阅是「正文面 + selection=proposal」的一个状态，不是新视图类型（协议 v1.1-A）。
  if (kind === 'chapter-editor' && data?.selection?.type === 'proposal') kind = 'proposal-review'
  return { kind, view: pane?.view ?? binding?.view ?? null }
}

/**
 * 一个注册表实例。默认单例（宿主那份）；测试可建独立实例，不共享模块级状态。
 *
 * API：
 *   registerView(type, factory, { owner }) → { ok } | { ok:false, error }
 *     同名重复注册拒绝（宿主视图尤其不许被顶替）；同一个 owner 重复注册同名也拒。
 *   resolve(type) → { type, factory, owner, builtin } | null
 *   bind(pane, data) → { view, factory, result } | null   （解析 + 算内容面一步到位）
 *   unregister(type) → boolean
 *   disposeOwner(owner) → number   （载体停用：外壳先释放它注册的视图，再清工作区实例、交内核重建）
 *   list() → [{ type, owner, builtin }]
 */
export function createViewRegistry() {
  const views = new Map()

  function registerView(type, factory, { owner = 'host', builtin = false } = {}) {
    if (!isViewType(type)) {
      return { ok: false, error: { code: 'INVALID_VIEW_TYPE', message: `视图类型须是 pinax.view.<name>，收到 ${String(type)}` } }
    }
    if (typeof factory !== 'function') {
      return { ok: false, error: { code: 'INVALID_VIEW_FACTORY', message: `视图 ${type} 的工厂必须是函数` } }
    }
    const existing = views.get(type)
    if (existing) {
      return {
        ok: false,
        error: {
          code: 'DUPLICATE_VIEW',
          message: existing.builtin
            ? `视图 ${type} 是宿主内置类型，载体不得顶替（P13）`
            : `视图 ${type} 已由 ${existing.owner} 注册`,
          owner: existing.owner
        }
      }
    }
    // 第三方只能注册 pinax.view.custom（v2 的收敛口），宿主视图名一律保留。
    if (!builtin && HOST_VIEW_TYPES.includes(type)) {
      return { ok: false, error: { code: 'RESERVED_VIEW_TYPE', message: `视图 ${type} 归宿主，第三方请用 ${CUSTOM_VIEW_TYPE}` } }
    }
    views.set(type, { type, factory, owner: String(owner), builtin: Boolean(builtin) })
    return { ok: true, value: { type, owner: String(owner), builtin: Boolean(builtin) } }
  }

  function resolve(type) {
    const entry = views.get(String(type ?? ''))
    return entry ? { ...entry } : null
  }

  function bind(pane, data) {
    const declared = typeof pane?.view === 'string' ? pane.view : null
    const type = declared ?? legacyBindingForPane(pane?.id)?.view ?? null
    if (!type) return null
    const entry = views.get(type)
    if (!entry) return { type, factory: null, result: null, owner: null, builtin: false }
    const result = entry.factory({ pane, data })
    return { type, factory: entry.factory, result: result ?? null, owner: entry.owner, builtin: entry.builtin }
  }

  function unregister(type) {
    return views.delete(String(type ?? ''))
  }

  function disposeOwner(owner) {
    const id = String(owner ?? '')
    let removed = 0
    for (const [type, entry] of [...views]) {
      if (entry.builtin || entry.owner !== id) continue
      views.delete(type)
      removed += 1
    }
    return removed
  }

  function list() {
    return [...views.values()].map((entry) => ({ type: entry.type, owner: entry.owner, builtin: entry.builtin }))
  }

  return { registerView, resolve, bind, unregister, disposeOwner, list }
}

/**
 * 批次51：把「注册一个视图」纳入内核效应合同。
 *
 * 以前第三方视图靠 `disposeOwner(owner)` 手工扫尾（批次45–48 挂账的「零调用方」）；
 * 现在注册视图的同时登记一条内核效应，插件卸载或 `disposeEffects(owner)` 时由注册表
 * 逆序跑 disposer 自动解注册。`disposeOwner` 保留，作为宿主对历史注册的兜底扫帚。
 *
 * 返回：视图注册成功的 { ok:true, value }；任一步失败都是 { ok:false, error }。
 * 内核注册表拒绝（例如 EFFECT_ON_DISPOSED 抛出）时先把已注册的视图撤掉，不留半截状态。
 */
export function registerViewEffect({
  kernelRegistry,
  pluginId,
  type,
  factory,
  builtin = false,
  label = null,
  viewRegistry = hostViewRegistry
} = {}) {
  if (!kernelRegistry || typeof kernelRegistry.registerEffect !== 'function') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'registerViewEffect 需要带 registerEffect 的内核注册表' } }
  }
  const owner = String(pluginId ?? '')
  if (!owner) return { ok: false, error: { code: 'INVALID_INPUT', message: 'registerViewEffect 需要插件 id' } }
  const installed = viewRegistry.registerView(type, factory, { owner, builtin })
  if (!installed.ok) return installed
  let registered
  try {
    registered = kernelRegistry.registerEffect(owner, () => () => {
      viewRegistry.unregister(type)
    }, label ?? `view:${type}`)
  } catch (error) {
    viewRegistry.unregister(type)
    throw error
  }
  if (!registered?.ok) {
    viewRegistry.unregister(type)
    return registered
  }
  return installed
}

/**
 * 自带面板（协议 v3 的 `entry` 面）：内容面是插件自己的页面，宿主只给一块沙箱 iframe。
 * 所以这个类型名的渲染器只回答一件事——「这块 pane 的内容面是 custom-panel」。
 */
export function customViewFactory({ pane } = {}) {
  return { kind: 'custom-panel', view: CUSTOM_VIEW_TYPE, entry: pane?.entry ?? null }
}

/**
 * 应用面（批次44）：内容面是一台外部服务自己的网页（ComfyUI 那种自带端口的）。
 * 宿主只回答「这块 pane 的内容面是 external-app，地址是哪个」——界面由那块 iframe 自己长。
 * 地址取自 pane.app.url（载体清单里声明；内核校验过它必须是本机 http 地址）。
 */
export function appViewFactory({ pane } = {}) {
  return { kind: 'external-app', view: 'pinax.view.app', url: pane?.app?.url ?? null }
}

/** 宿主那份：视图类型都注册到 hostViewFactory（内容面由 pane 声明的 kind 决定）。 */
export const hostViewRegistry = createViewRegistry()
for (const type of HOST_VIEW_TYPES) {
  if (type === 'pinax.view.app') continue
  hostViewRegistry.registerView(type, hostViewFactory, { owner: 'host', builtin: true })
}
// 应用面用自己的工厂（内容面固定 external-app，地址从 pane 上取）。
hostViewRegistry.registerView('pinax.view.app', appViewFactory, { owner: 'host', builtin: true })
// custom 也占一个名字：它不是「认这个类型、但没有渲染器」，而是自带面板这一种内容面。
hostViewRegistry.registerView(CUSTOM_VIEW_TYPE, customViewFactory, { owner: 'host', builtin: true })

/**
 * CarrierPaneHost 的唯一入口：解析失败（类型不存在）返回 null，调用方出占位。
 */
export function resolvePaneView(pane, data) {
  return hostViewRegistry.bind(pane, data)
}

/* —— 资源认领裁决（批次53 · 协议 @4 的 claims／priority／canOpen／takes 消费面）——————————
 *
 * 同一份资源可能同时落进多块 pane 的 claim 范围（世界书的类别树与看板区、章节索引与正文编辑位）。
 * 归属按四步定，纯函数、无 IO：
 *   ① claims 的 glob 匹配资源路径（`**` 独占一段，可零段）；不命中即退出竞争；
 *   ② canOpen 谓词对资源字段求值（缺字段＝不放行，不猜）；
 *   ③ takes 分档：extension 优先于 fallback（没声明 takes 的排最后）；
 *   ④ 同档再比 priority（高者先），最后按 pane id 字典序——同样的清单永远得到同样的赢家。
 * 返回值里带全部参评者的落选原因，测试与界面据此断言「谁赢了、别人为什么没赢」。
 */

const TAKE_RANK = Object.freeze({ extension: 2, fallback: 1 })

/** 项目内路径归一：统一用 / 分段，去掉开头的 ./（工具回传的路径两种写法都见过）。 */
export function normalizeClaimPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
}

const SEGMENT_ESCAPE = /[.+^${}()|\\]/gu

function matchClaimSegment(pattern, value) {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const ch = pattern[index]
    if (ch === '*') source += '[^/]*'
    else if (ch === '?') source += '[^/]'
    else if (ch === '[') {
      const end = pattern.indexOf(']', index + 1)
      if (end === -1) {
        source += '\\['
        continue
      }
      source += `[${pattern.slice(index + 1, end)}]`
      index = end
    } else source += ch.replace(SEGMENT_ESCAPE, '\\$&')
  }
  return new RegExp(`^${source}$`, 'u').test(value)
}

function matchClaimSegments(patternSegs, pathSegs, patternIndex, pathIndex) {
  if (patternIndex === patternSegs.length) return pathIndex === pathSegs.length
  const segment = patternSegs[patternIndex]
  if (segment === '**') {
    if (matchClaimSegments(patternSegs, pathSegs, patternIndex + 1, pathIndex)) return true
    return pathIndex < pathSegs.length && matchClaimSegments(patternSegs, pathSegs, patternIndex, pathIndex + 1)
  }
  if (pathIndex >= pathSegs.length) return false
  return matchClaimSegment(segment, pathSegs[pathIndex])
    && matchClaimSegments(patternSegs, pathSegs, patternIndex + 1, pathIndex + 1)
}

/** 单条 claim（项目内相对 glob）是否命中资源路径。 */
export function matchClaimPath(claim, resourcePath) {
  const pattern = normalizeClaimPath(claim).split('/').filter(Boolean)
  const target = normalizeClaimPath(resourcePath).split('/').filter(Boolean)
  if (!pattern.length || !target.length) return false
  return matchClaimSegments(pattern, target, 0, 0)
}

function readResourceField(resource, field) {
  let value = resource
  for (const key of String(field ?? '').split('.')) {
    if (value === null || value === undefined) return undefined
    value = value[key]
  }
  return value
}

/** canOpen：声明式谓词求值；没声明谓词＝认领范围内全放行。 */
function evaluateCanOpen(canOpen, resource) {
  if (!canOpen) return { ok: true, reason: 'open' }
  const value = readResourceField(resource, canOpen.field)
  if (value === undefined) return { ok: false, reason: 'predicate-missing-field' }
  const matched = 'equals' in canOpen ? Object.is(value, canOpen.equals) : canOpen.in.includes(value)
  return matched ? { ok: true, reason: 'open' } : { ok: false, reason: 'predicate-miss' }
}

function compareClaimCandidates(a, b) {
  const takeDelta = (TAKE_RANK[b.takes] ?? 0) - (TAKE_RANK[a.takes] ?? 0)
  if (takeDelta !== 0) return takeDelta
  if (a.priority !== b.priority) return b.priority - a.priority
  return a.paneId < b.paneId ? -1 : a.paneId > b.paneId ? 1 : 0
}

/**
 * 裁决一份资源归属哪块 pane。
 *   panes    view.carriers[].panes 的扁平清单（声明了 claims 的才参评）
 *   resource { path, kind }（也接受裸路径串）
 * 返回 { path, kind, winner, considered }：
 *   winner 是赢家的 { paneId, pluginId, title, priority, takes, matchedClaim }（没人接＝null）；
 *   considered 按 pane 列全部参评者与结果：status＝won／lost／skipped，reason 说明落选原因。
 */
export function resolveResourceClaim(panes, resource = {}) {
  const target = typeof resource === 'string' ? { path: resource } : (resource ?? {})
  const resourcePath = normalizeClaimPath(target.path)
  const considered = []
  const eligible = []
  for (const pane of Array.isArray(panes) ? panes : []) {
    const paneId = String(pane?.id ?? '')
    if (!paneId) continue
    const claims = Array.isArray(pane.claims) ? pane.claims.filter((claim) => typeof claim === 'string') : []
    // 不认领文件的 pane 不参评（浮窗、应用面）——它们不参与资源归属的竞争。
    if (!claims.length) continue
    const base = {
      paneId,
      pluginId: pane.pluginId ?? null,
      title: pane.title ?? paneId,
      priority: Number.isSafeInteger(pane.priority) ? pane.priority : 0,
      takes: pane.takes ?? null
    }
    if (!resourcePath) {
      considered.push({ ...base, matchedClaim: null, status: 'skipped', reason: 'missing-path', won: false })
      continue
    }
    const matchedClaim = claims.find((claim) => matchClaimPath(claim, resourcePath)) ?? null
    if (!matchedClaim) {
      considered.push({ ...base, matchedClaim: null, status: 'skipped', reason: 'claim-miss', won: false })
      continue
    }
    const predicate = evaluateCanOpen(pane.canOpen ?? null, target)
    if (!predicate.ok) {
      considered.push({ ...base, matchedClaim, status: 'skipped', reason: predicate.reason, won: false })
      continue
    }
    const candidate = { ...base, matchedClaim, status: 'eligible', reason: 'open', won: false }
    considered.push(candidate)
    eligible.push(candidate)
  }
  eligible.sort(compareClaimCandidates)
  const winner = eligible[0] ?? null
  if (winner) {
    winner.status = 'won'
    winner.won = true
  }
  for (const entry of eligible) {
    if (entry !== winner) {
      entry.status = 'lost'
      entry.reason = (TAKE_RANK[winner.takes] ?? 0) > (TAKE_RANK[entry.takes] ?? 0)
        ? 'lost-take'
        : winner.priority !== entry.priority ? 'lost-priority' : 'lost-order'
    }
  }
  return {
    path: resourcePath,
    kind: target.kind ?? null,
    winner: winner ? { ...winner } : null,
    considered: considered.map((entry) => ({ ...entry }))
  }
}
