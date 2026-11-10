/**
 * 章纲 → 章分组（ADR M3 成书渲染第一段）。
 *
 * 设计目标＝「目标弧」分章：目标确立 → 转折 / 了结合成一章。
 * M3 务实启发式（结构化 template 驱动留后续批次）：
 *   1) 相邻拍的「POV / 目标标记」一变就另起一章（pov｜goal 复合标记）；
 *   2) 单章拍数上限可配（maxBeatsPerChapter），超过即切章，避免 POV 不变时章无限长；
 *   3) 每章结构确定性：章 id / index / 拍序列完全由输入决定，无时间戳、无随机数。
 *
 * 节点取自 M2 投影器 projectOutline 的 { nodes }：id/title/definition/intent/summary/order/domain…，
 * 可选显式标记 pov / character / viewpoint / goal / objective / arc / goalPhase。
 * 无任何标记时以 domain 作为 pov 兜底、goal 为空，分组仍确定（配合拍数上限切章）。
 *
 * 纯函数、零宿主依赖：不 import 任何模块，不碰 node 内置 / process / 文件系统；
 * 不改传入节点；同一章纲 → 深度相等的同一分组（可重渲染的确定性前提）。
 */

export const CHAPTERIZE_VERSION = 'chapterize@1'

export const DEFAULT_MAX_BEATS_PER_CHAPTER = 6

function isObj(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** 默认 POV / 目标标记：pov｜goal 复合键；缺字段按兜底取，不猜跨条目语义。 */
export function defaultChapterMarker(node) {
  const pov = firstText(node.pov, node.character, node.viewpoint, node.domain)
  const goal = firstText(node.goal, node.objective, node.arc, node.goalPhase)
  return { pov, goal, key: `${pov}∷${goal}` }
}

function beatOf(node, order) {
  const definition = firstText(node.definition, node.intent, node.summary, node.title)
  return {
    nodeId: str(node.id),
    order: Number.isInteger(node.order) ? node.order : order,
    title: str(node.title),
    definition,
    seq: Number.isInteger(node.seq) ? node.seq : null,
    domain: str(node.domain),
    // P-WIRE：把节点上的 pov/goal 带到拍上——renderChapter 逐拍取用时不必回查章纲。
    ...(firstText(node.pov) ? { pov: firstText(node.pov) } : {}),
    ...(firstText(node.goal) ? { goal: firstText(node.goal) } : {})
  }
}

/**
 * @param {Object[]|{nodes:Object[]}} outline 章纲节点（数组或 { nodes }）
 * @param {{maxBeatsPerChapter?:number, markerOf?:Function}} [options]
 * @returns {{ok:true, version, chapters, counts}}
 */
export function chapterize(outline, options = {}) {
  const nodes = Array.isArray(outline)
    ? outline
    : (isObj(outline) && Array.isArray(outline.nodes) ? outline.nodes : [])
  const list = nodes.filter(isObj)
  const maxBeats = Number.isInteger(options.maxBeatsPerChapter) && options.maxBeatsPerChapter > 0
    ? options.maxBeatsPerChapter
    : DEFAULT_MAX_BEATS_PER_CHAPTER
  const markerOf = typeof options.markerOf === 'function' ? options.markerOf : defaultChapterMarker

  const chapters = []
  let current = null
  let beatCounter = 0
  for (const node of list) {
    const raw = markerOf(node)
    const marker = isObj(raw) ? raw : { key: str(raw), pov: '', goal: '' }
    const key = str(marker.key)
    const pov = firstText(marker.pov)
    const goal = firstText(marker.goal)
    const needNew = !current || current.marker !== key || current.beats.length >= maxBeats
    if (needNew) {
      current = {
        id: `chapter-${chapters.length + 1}`,
        index: chapters.length + 1,
        marker: key,
        pov,
        goal,
        // P-WIRE：章上留下它承载的拍节点 id 与章末伏笔，供 renderChapter 注入 prompt。
        openHooks: [],
        beats: [],
        fromOrder: null,
        toOrder: null
      }
      chapters.push(current)
    }
    beatCounter += 1
    const beat = beatOf(node, beatCounter)
    // 节点自带的 openHooks（M2 投影器/调用方挂的）并进本章——成书时该回收的钩子不能丢。
    for (const hook of Array.isArray(node.openHooks) ? node.openHooks : []) {
      if (hook !== undefined && hook !== null && hook !== '') current.openHooks.push(hook)
    }
    if (current.fromOrder === null) current.fromOrder = beat.order
    current.toOrder = beat.order
    current.beats.push(beat)
  }

  for (const chapter of chapters) {
    chapter.beatCount = chapter.beats.length
    chapter.nodeIds = chapter.beats.map((beat) => beat.nodeId)
  }

  return {
    ok: true,
    version: CHAPTERIZE_VERSION,
    chapters,
    counts: {
      nodes: list.length,
      chapters: chapters.length,
      maxBeatsPerChapter: maxBeats,
      beats: beatCounter
    }
  }
}
