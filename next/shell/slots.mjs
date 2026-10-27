/**
 * 槽位合同（C5）：外壳只保证顶栏＋左竖条＋中栏＋右运行时栏。
 * 纯数据模块——主进程、渲染进程与门禁都能同一份判定，插件抢地盘在这里就被拒。
 */
export const SLOT_LEFT_DOCK = 'left-dock'
export const SLOT_CENTER = 'center'
export const OPEN_SLOTS = Object.freeze([SLOT_LEFT_DOCK, SLOT_CENTER])

/** right 归一级公民运行时；top-menu 归主进程应用菜单。插件声明即拒装。 */
export const RESERVED_SLOTS = Object.freeze({
  right: '右栏归 Pi-Agent 运行时（唯一一级公民），插件只能贡献左竖条与中栏',
  'top-menu': '应用级菜单由主进程建立，载体不得注入顶层菜单'
})

export function isReservedSlot(slot) {
  return Object.prototype.hasOwnProperty.call(RESERVED_SLOTS, String(slot || ''))
}

export function isOpenSlot(slot) {
  return OPEN_SLOTS.includes(slot)
}

export function slotReason(slot) {
  return RESERVED_SLOTS[String(slot || '')] ?? null
}

/**
 * 左竖条排序：主载体置顶（作者口径：每个项目先定「创作小说还是剧本」），
 * 其余按注册顺序。空启用集也要返回可用数组，外壳不因此报错。
 */
export function orderActivityItems(panes = [], { primaryPluginId = null } = {}) {
  const items = panes.filter((pane) => pane.slot === SLOT_LEFT_DOCK || pane.slot === undefined)
  return [...items].sort((a, b) => {
    const aPrimary = a.pluginId === primaryPluginId ? 1 : 0
    const bPrimary = b.pluginId === primaryPluginId ? 1 : 0
    if (aPrimary !== bPrimary) return bPrimary - aPrimary
    return (a.order ?? 0) - (b.order ?? 0)
  })
}
