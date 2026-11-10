import { NOVEL_CARRIER_ID } from './manifest.mjs'
import { createNovelTools } from './tools.mjs'

/**
 * 小说载体的上下文块构建器（M2 · WP3 的素材侧；协议 v1.1-A 起只剩 selection 一块）。
 * 约定（与 next/carriers/index.mjs 的 impl.blocks 一致）：
 *   `createNovelBlocks(projectCtx)` 返回 `{ kind: async (askCtx) => 素材包 }`，
 *   askCtx = { question, context }，素材包 = { blocks: [{kind, content, sourceRefs}], warnings: [], target? }。
 * 两条硬规矩：
 *   1) 读盘一律复用载体自己的工具实现（createNovelTools 里那一份），不另开第二条取数路径——
 *      「模型 pinax_chapter_read 看到的正文」和「运行时替模型预先塞进上下文的正文」必须是同一份字节；
 *   2) 建块只记账不硬失败：读不到就给 warning＋空块，绝不为了组装上下文把整次提问打断。
 * 大纲块随大纲载体迁去 next/carriers/outline/context.mjs（协议 v1.1-A：一块素材只有一个主人）。
 */
const CHAPTER_BLOCK_CHARS = 20_000

export const NOVEL_CONTEXT_KINDS = Object.freeze(['selection'])

export function createNovelBlocks(context = {}) {
  const pluginId = context.pluginId ?? NOVEL_CARRIER_ID
  const fileService = context.fileService ?? null
  const tools = createNovelTools({ ...context, pluginId, fileService })

  /** 直接复用载体工具的执行体：它们的返回本就是 ok/fail 信封，不再包第二层。 */
  async function call(name, args) {
    const tool = tools.find((item) => item.name === name)
    if (!tool) return failLike(`小说载体没有工具 ${name}`)
    return tool.run(args ?? {})
  }

  return {
    /** selection＝当前章节正文块：定位优先级 chapterIndex > chapterTitle/chapter > file > 最后一章。 */
    selection: async (askCtx = {}) => selectionBlock(call, askCtx)
  }
}

function failLike(message) {
  return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message } }
}

async function selectionBlock(call, { context = {} }) {
  const warnings = []
  const locator = {}
  if (Number.isSafeInteger(context.chapterIndex)) locator.index = context.chapterIndex
  else if (titleOf(context)) locator.title = titleOf(context)
  else if (String(context.file || '').trim()) locator.file = String(context.file).trim()

  if (!Object.keys(locator).length) {
    const listed = await call('pinax_chapter_list', { limit: 500 })
    if (!listed.ok) return { blocks: [], warnings: [listed.error.message], target: null }
    const chapters = listed.value.chapters ?? []
    if (!chapters.length) {
      return { blocks: [], warnings: ['「正文/」还没有章节，本次提问没有正文上下文（先用 pinax_chapter_save 建一章）。'], target: null }
    }
    const last = chapters[chapters.length - 1]
    locator.index = last.index
    warnings.push(`未指定章节，默认取最后一章「${last.title}」（与既有 pinax_agent_ask 同口径）。`)
  }

  const read = await call('pinax_chapter_read', { ...locator, maxChars: CHAPTER_BLOCK_CHARS })
  if (!read.ok) return { blocks: [], warnings: [`正文块未取得：${read.error.message}`], target: null }
  const chapter = read.value.chapter
  if (read.value.truncated) {
    warnings.push(`章节「${chapter.title}」共 ${read.value.totalChars} 字，正文块只带前 ${read.value.text.length} 字；需要全文请用 pinax_chapter_read 分页。`)
  }
  return {
    blocks: [{
      kind: 'selection',
      content: `# 章节正文：${chapter.title}（${chapter.file}，共 ${read.value.totalChars} 字，第 ${read.value.revision} 版）\n${read.value.text}`,
      sourceRefs: [`novel-chapter:${chapter.file}`]
    }],
    warnings,
    target: {
      type: 'chapter',
      id: chapter.index === null ? chapter.file : String(chapter.index),
      revision: `novel-chapter:${chapter.file}:${read.value.revision}`
    }
  }
}

function titleOf(context) {
  const raw = String(context.chapterTitle ?? context.title ?? '').trim()
  return raw || null
}

export default createNovelBlocks
