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
 *   3) 六个宿主视图 `pinax.view.tree|list|editor|reader|diff|graph` 由宿主注册，
 *      载体不能顶替（注册同名即拒，与工具命名空间同一口径）。
 *
 * 纯数据模块，不 import Vue——node:test 直接测注册/解析/释放。
 */

/** 宿主自带的六个视图类型（P13 的渲染器词表落地版）。 */
export const HOST_VIEW_TYPES = Object.freeze([
  'pinax.view.tree',
  'pinax.view.list',
  'pinax.view.editor',
  'pinax.view.reader',
  'pinax.view.diff',
  'pinax.view.graph'
])

/** 第三方唯一可用的视图类型名（v2 只登记类型名，不跑第三方代码）。 */
export const CUSTOM_VIEW_TYPE = 'pinax.view.custom'

export const VIEW_TYPES = Object.freeze([...HOST_VIEW_TYPES, CUSTOM_VIEW_TYPE])

/**
 * v1 兼容绑定：没有声明 view 的老 pane 按 id 前缀认内容面。
 * 这是「迁移期的一张对照表」，不是第二套真相——新 pane 一律写 view 字段。
 * 顺序有意义：更长的前缀先匹配（outline.widget 先于 outline.）。
 */
export const LEGACY_VIEW_BINDINGS = Object.freeze([
  { prefix: 'novel.', view: 'pinax.view.editor', kind: 'chapter-editor' },
  { prefix: 'outline.', view: 'pinax.view.editor', kind: 'outline-editor' },
  { prefix: 'notes.', view: 'pinax.view.editor', kind: 'notes-editor' },
  { prefix: 'worldbook.', view: 'pinax.view.reader', kind: 'entry-detail' },
  { prefix: 'script.', view: 'pinax.view.editor', kind: 'script-editor' },
  { prefix: 'setting.', view: 'pinax.view.editor', kind: 'rule-editor' },
  { prefix: 'reference.', view: 'pinax.view.reader', kind: 'document-detail' }
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
 * 声明了 view 的 pane 也必须落在宿主六个类型里（custom 走占位，因为 v2 不跑第三方代码）；
 * 没声明的按前缀回落——迁移期两条路并存，新 pane 一律写 view。
 */
export function hostViewFactory({ pane, data } = {}) {
  const paneId = String(pane?.id ?? '')
  const binding = legacyBindingForPane(paneId)
  // 提案审阅是「正文面 + selection=proposal」的一个状态，不是新视图类型（协议 v1.1-A）。
  if (binding?.prefix === 'novel.' && data?.selection?.type === 'proposal') {
    return { kind: 'proposal-review', view: pane?.view ?? binding.view }
  }
  if (!binding) return null
  return { kind: binding.kind, view: pane?.view ?? binding.view }
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
 *   disposeOwner(owner) → number   （插件卸载：把它注册的视图一并释放）
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

/** 宿主那份：六个类型都注册到 hostViewFactory（内容面由前缀 + 数据算）。 */
export const hostViewRegistry = createViewRegistry()
for (const type of HOST_VIEW_TYPES) {
  hostViewRegistry.registerView(type, hostViewFactory, { owner: 'host', builtin: true })
}
// custom 也先占一个名字：解析得到「认这个类型、但没有渲染器」，宿主据此出占位而不是报错。
hostViewRegistry.registerView(CUSTOM_VIEW_TYPE, () => null, { owner: 'host', builtin: true })

/**
 * CarrierPaneHost 的唯一入口：解析失败（类型不存在）返回 null，调用方出占位。
 */
export function resolvePaneView(pane, data) {
  return hostViewRegistry.bind(pane, data)
}
