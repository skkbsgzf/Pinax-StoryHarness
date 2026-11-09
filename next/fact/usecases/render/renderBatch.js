/**
 * 多章批量渲染 ＋ 多文风重渲染（ADR M3 第四段）。
 *
 * 同一章纲 × N 个 styleSpec → N 份正文（每个文风都渲染全部章节）。
 * 章节结构确定性一致：章分组只算一次（chapterize 纯函数、确定性），N 个文风变体共享
 * 完全相同的章节骨架（chapterId / nodeIds / beatCount），只是 styleSpecHash 与 prose 不同——
 * 同数据可重渲染：batchId / renderKey 全部由 sha1Hex + 稳定序列化算出，无时间戳 / 随机数。
 *
 * 纯函数 + LlmPort 注入、零宿主依赖：只 import 域内相对路径与 chapterize / prose，
 * 不碰 node 内置 / process / 文件系统 / wikihub。
 */

import { chapterize } from './chapterize.js'
import { renderChapter, normalizeStyleSpec, styleSpecHash } from './prose.js'
import { sha1Hex } from '../../domain/stableId.js'

export const RENDER_BATCH_VERSION = 'render-batch@1'

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

function structureSignature(list) {
  return list
    .map((item) => `${str(item.chapterId)}:${(item.nodeIds ?? []).join(',')}:${item.beatCount ?? 0}`)
    .join('|')
}

/**
 * @param {Object} input
 *   outline      章纲（数组或 { nodes }，来自 M2 projectOutline）
 *   entries      fact.data/v2 条目（供知情约束 / perspective gate）
 *   pov          缺省 POV；章自带 pov 标记时优先用章的
 *   styleSpecs   文风数组；也接受单个 styleSpec
 *   llm/llmPort  注入的 LlmPort
 *   chapterOptions 透传 chapterize（maxBeatsPerChapter / markerOf）
 *   atSpan       可选：覆盖各章时点（缺省用章 index）
 *   batchId      可选：覆盖确定性批次 id
 */
export async function renderBatch(input = {}) {
  const source = isObj(input) ? input : {}
  const grouped = chapterize(source.outline, isObj(source.chapterOptions) ? source.chapterOptions : {})
  const chapters = grouped.chapters

  const rawSpecs = Array.isArray(source.styleSpecs) && source.styleSpecs.length
    ? source.styleSpecs
    : [source.styleSpec]
  const styleSpecs = rawSpecs.filter(Boolean).map(normalizeStyleSpec)
  const styleHashes = styleSpecs.map(styleSpecHash)
  const pov = firstText(source.pov)
  const llm = source.llm ?? source.llmPort ?? null
  const atSpan = Number.isInteger(source.atSpan) ? source.atSpan : undefined

  const skeleton = chapters.map((chapter) => ({
    chapterId: chapter.id,
    nodeIds: chapter.nodeIds,
    beatCount: chapter.beatCount
  }))
  const skeletonSig = structureSignature(skeleton)
  const batchId = firstText(source.batchId)
    || sha1Hex([skeletonSig, pov, styleHashes.join(',')].join('|')).slice(0, 12)

  const variants = []
  for (let styleIndex = 0; styleIndex < styleSpecs.length; styleIndex += 1) {
    const rendered = []
    for (const chapter of chapters) {
      rendered.push(await renderChapter({
        chapter,
        entries: source.entries,
        pov: firstText(chapter.pov) || pov,
        atSpan,
        styleSpec: styleSpecs[styleIndex],
        llm,
        batchId
      }))
    }
    const variantSig = structureSignature(rendered.map((item) => item.structure))
    variants.push({
      styleIndex,
      styleSpecHash: styleHashes[styleIndex],
      structureSignature: variantSig,
      chapters: rendered
    })
  }

  const signatures = variants.map((variant) => variant.structureSignature)
  const structureConsistent = signatures.length > 0 && signatures.every((sig) => sig === skeletonSig)

  return {
    ok: variants.length > 0 && structureConsistent,
    version: RENDER_BATCH_VERSION,
    batchId,
    pov,
    chapterCount: chapters.length,
    styleCount: variants.length,
    styleSpecHashes: styleHashes,
    chapterSkeleton: skeleton.map((item) => ({ ...item, nodeIds: [...item.nodeIds] })),
    structureSignature: skeletonSig,
    structureConsistent,
    variants,
    counts: {
      nodes: grouped.counts.nodes,
      chapters: chapters.length,
      styles: variants.length,
      renders: variants.reduce((sum, variant) => sum + variant.chapters.length, 0),
      maxBeatsPerChapter: grouped.counts.maxBeatsPerChapter
    }
  }
}
