/**
 * 拖拽吸附的判定（批次76 · 作者〔裁定A〕后半句）。
 *
 * 「相关的页面形态转换按钮，用拖拽的形式去做，例如拖到侧边可以吸附，这个逻辑类似于 windows 的分屏，
 *   也类似于 obsidian 里的分区显示的逻辑。」
 *
 * 于是形态的换法从窗头那两枚死按钮（收起／分屏）挪到了动线上：拖到核心区哪个位置，就落哪个形态。
 * 本文件只做**纯函数**判定——不碰 DOM、不认识 Vue，所以能被 node --test 直接喂矩形验算，
 * 也逼着「命中圈」这一组数值只有一处定义（PaneWindow 画预览、AppNext 部落位，两边都从这里读）。
 *
 * 四条落点（按优先级，先判先赢）：
 *   orb    右下角悬浮球命中圈 → 收起（form:'tab'，进 CollapseOrb 的列表）
 *   top    顶缘 → 浮窗最大化（页态拖这里＝什么都不改：页天然铺满所在页组，v3 没有「再最大化」那一档）
 *   left   左缘 → 落进 main 页组（对半的左半边）
 *   right  右缘 → 落进 side 页组（对半的右半边，就是原来的「分屏」）
 *   null   阈值外 → 只改矩形，不改形态（〔工单守卫④〕无预览不落位）
 *
 * 数值口径：左右缘各取层宽的 12%、顶缘取层高 14%、球角取 96×96px 的方角。
 * 这三个数是**命中区尺寸**（跟「可点件 ≥24×24」同一类规范口径），不是质量阈值——
 * 它不进任何验收闸的数值线，改它要连 PaneWindow 的预览样式一起改。
 */

export const SNAP_TARGETS = Object.freeze(['orb', 'top', 'left', 'right'])
/** 左右缘命中圈＝层宽的 12%（Windows 分屏的手感档，Obsidian 的分区也在这个量级）。 */
export const SNAP_EDGE_RATIO = 0.12
/** 顶缘命中圈＝层高的 14%。 */
export const SNAP_TOP_RATIO = 0.14
/** 右下角悬浮球的命中边长（px）：球本体 48＋离边 24，再放一点余量到 96。 */
export const SNAP_ORB_EDGE = 96

/** 归一矩形：只认数字，缺了就是零尺寸（判定时先被 width/height 的守卫挡掉）。 */
function rectOf(value) {
  const x = Number(value?.x ?? value?.left ?? 0)
  const y = Number(value?.y ?? value?.top ?? 0)
  const width = Number(value?.width ?? value?.w ?? 0)
  const height = Number(value?.height ?? value?.h ?? 0)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  return { x, y, width, height }
}

/**
 * 指针（client 坐标）落在核心区的哪一块。
 *
 * @param point { x, y }｜{ clientX, clientY } 都可以，取不到就当没拖。
 * @param layer 窗口层（核心区）的矩形——吸附的分界线是它的边，不是屏幕的边。
 * @param options { form } 这一页此刻的形态：页态拖到顶缘没有「再最大化」那一档，返回 null。
 * @returns 'orb'｜'top'｜'left'｜'right'｜null
 */
export function snapTargetAt(point, layer, options = {}) {
  const area = rectOf(layer)
  if (area.width <= 0 || area.height <= 0) return null
  const px = Number(point?.x ?? point?.clientX ?? Number.NaN)
  const py = Number(point?.y ?? point?.clientY ?? Number.NaN)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null
  // 指针在层外（拖到竖条／右栏上面）不算吸附：那儿不是这一页的落点区。
  if (px < area.x || px > area.x + area.width || py < area.y || py > area.y + area.height) return null
  const right = area.x + area.width
  const bottom = area.y + area.height
  if (px >= right - SNAP_ORB_EDGE && py >= bottom - SNAP_ORB_EDGE) return 'orb'
  if (py <= area.y + area.height * SNAP_TOP_RATIO) return options.form === 'page' ? null : 'top'
  if (px <= area.x + Math.max(1, area.width * SNAP_EDGE_RATIO)) return 'left'
  if (px >= right - Math.max(1, area.width * SNAP_EDGE_RATIO)) return 'right'
  return null
}

/**
 * 落点 → 该页的目标状态（形态＋页组＋要不要最大化）。这里只出「要去哪」，
 * 真正动手仍是 workspace 的 setForm／moveToGroup／setMaximized——形态迁移的唯一入口不改。
 *
 * @returns null（不落位，只改矩形）｜{ form, group, maximized }
 */
export function snapPlan(target, current = {}) {
  if (!SNAP_TARGETS.includes(target)) return null
  if (target === 'orb') return { form: 'tab', group: current.group ?? null, maximized: false }
  if (target === 'top') {
    if (current.form === 'page') return null
    return { form: 'floating', group: current.group ?? null, maximized: true }
  }
  return { form: 'page', group: target === 'left' ? 'main' : 'side', maximized: false }
}

/** 预览要画的那一块（相对窗口层的百分比矩形）；null＝不画。 */
export function snapPreviewBox(target) {
  if (!SNAP_TARGETS.includes(target)) return null
  if (target === 'left') return { left: '0%', top: '0%', width: '50%', height: '100%' }
  if (target === 'right') return { left: '50%', top: '0%', width: '50%', height: '100%' }
  if (target === 'top') return { left: '0%', top: '0%', width: '100%', height: '100%' }
  return { right: '24px', bottom: '24px', width: '48px', height: '48px' }
}
