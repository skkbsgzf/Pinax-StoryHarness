/**
 * 伪章节切分（2026-11-13，作者指出「大纲为什么这么简单」）。
 *
 * 番茄短篇正文普遍没有「第N章」标记——拆解后全部 plot 的 validity.from 都是 1，
 * 大纲/时间线/增补全塌成单章。真章书（如脱轨 38 章）不受影响。
 *
 * 切法（确定性，零模型）：每个 plot 取其事件的最小段号（event.segments[*].index），
 * 按段号把全书段范围均分成 K 节，plot 落进其最小段号所在的节。
 *   K = clamp(round(正文字数 / 2200), 4, 12)
 * 段号即阅读物理位置，切出来的节 ≈ 均匀字数的前后推进顺序。
 *
 * enrich 与 build-wiki 共用本模块——两边用同一公式，伪章号才能对上。
 */

/** plot 的最小段号（事件缺失时退 Infinity，归最后一节）。 */
export function plotMinSegment(plot) {
  const indexes = (plot.events ?? []).flatMap((event) => (event.segments ?? []).map((segment) => segment.index)).filter(Number.isFinite)
  return indexes.length ? Math.min(...indexes) : Infinity
}

/** 伪章节数：每节约 2200 字，4–12 节封顶。 */
export function pseudoChapterCount(totalChars) {
  return Math.max(4, Math.min(12, Math.round(totalChars / 2200)))
}

/**
 * @param {Array} plots plot 条目数组
 * @param {number} totalChars 全文实际字数（source.chars ?? book.word_count）
 * @returns {{ no, title, segStart, segEnd, plots }[]}
 */
export function derivePseudoChapters(plots, totalChars) {
  if (!plots.length) return []
  const count = pseudoChapterCount(totalChars)
  const withSeg = plots.map((plot) => ({ plot, minSeg: plotMinSegment(plot) }))
  const known = withSeg.filter((item) => Number.isFinite(item.minSeg))
  if (!known.length) {
    // 全部无段信息：按 plot 计数均分成一节
    return [{ no: 1, title: '第 1 节', segStart: 0, segEnd: 0, plots }]
  }
  const segMin = Math.min(...known.map((item) => item.minSeg))
  const segMax = Math.max(...known.map((item) => item.minSeg))
  const width = Math.max(1, (segMax - segMin + 1) / count)

  const byNo = new Map()
  for (const item of withSeg) {
    // 无段信息的 plot 归最后一节
    const no = Number.isFinite(item.minSeg)
      ? Math.min(count, Math.max(1, Math.floor((item.minSeg - segMin) / width) + 1))
      : count
    if (!byNo.has(no)) byNo.set(no, [])
    byNo.get(no).push(item.plot)
  }

  return [...byNo.keys()].sort((a, b) => a - b).map((no) => {
    const group = byNo.get(no)
    const segs = group.map(plotMinSegment).filter(Number.isFinite)
    return {
      no,
      title: `第 ${no} 节`,
      segStart: segs.length ? Math.min(...segs) : 0,
      segEnd: segs.length ? Math.max(...segs) : 0,
      plots: group
    }
  })
}

/** 真章书判定：distinct validity.from > 1 即有真章，不走伪章。 */
export function hasRealChapters(plots) {
  return new Set(plots.map((plot) => plot.validity?.from).filter(Number.isInteger)).size > 1
}
