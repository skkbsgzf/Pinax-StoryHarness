/**
 * 世界书载体的上下文块构建器（协议 v1.1-A：从设定载体的 context.mjs 整块迁出，
 * 世界书取数口 readWorldbookEntries 随之迁来；设定载体只剩 rules/style 两块）。
 * 与小说载体同一套约定：`createWorldbookBlocks(projectCtx)` 返回 `{ kind: async (askCtx) => 素材包 }`，
 * 素材包 = { blocks:[{kind, content, sourceRefs}], warnings:[] }；读不到只记账，不硬失败。
 * 世界书的取数只有一条路：导出的 readWorldbookEntries()。上下文块与 pinax_worldbook_list / read
 * 共用它，所以面板上的条目清单与塞给模型的那份字节永远同源。
 *
 * 三条如实的限制写在这里，不假装覆盖面比这更大：
 *   1) 只看目录一级（世界书的 伏笔/、编年/ 等子目录会被记账跳过，文件服务当前不提供更深的列举）；
 *   2) 世界书条目按文件契约 v2 的 frontmatter 解析，解析不了的按整篇正文收录并留 warning；
 *   3) 单条字符上限是硬闸，超了在块里写明「已截断，原文 N 字」，绝不悄悄丢字。
 */
import { parseWorldbookEntryFile } from '../../../shared/worldbookFileContract.js'
import { WORLDBOOK_CARRIER, WORLDBOOK_CARRIER_ID } from './manifest.mjs'

const WORLDBOOK_DIR = WORLDBOOK_CARRIER.dataDirs.entries
const WORLDBOOK_ENTRY_LIMIT = 8
const WORLDBOOK_CHAR_CAP = 4000
/** 一次读回最多碰多少个世界书文件：与内核 pinax_worldbook_list 的 limit 上限（1000）同档，超了记账不静默。 */
const ENTRY_READ_LIMIT = 1000
const TEXT_FILE_PATTERN = /\.(?:md|txt)$/iu
const MENTION_SPLIT = /[·・|｜/\\（）()【】[\]{}<>《》〈〉「」『』、,，;；:：\s_-]+/u

export const WORLDBOOK_CONTEXT_KINDS = Object.freeze(['worldbook'])

export function createWorldbookBlocks(context = {}) {
  const pluginId = context.pluginId ?? WORLDBOOK_CARRIER_ID
  const fileService = context.fileService ?? null

  return {
    worldbook: (askCtx) => worldbookBlocks({ pluginId, fileService, question: askCtx?.question ?? '' })
  }
}

/**
 * 世界书读回（世界书板块唯一的取数口）。
 * 上下文块与 pinax_worldbook_list / pinax_worldbook_read 都吃这一份，所以「模型在上下文里读到的条目」
 * 和「作者在世界书面板里看到的条目」天然是同一批字节、同一次解析，不存在第二条会跑偏的路径。
 * 返回 { entries, warnings, skippedDirs, error }：error 非空表示目录都没取到（调用方决定是记账还是报错），
 * 单条文件的失败只进 warnings——一个坏文件不该让整块世界书缺席。
 * 只列一级：文件服务的 list 不递归，子目录如实记进 skippedDirs，绝不假装读到了。
 */
export async function readWorldbookEntries({ pluginId = WORLDBOOK_CARRIER_ID, fileService, limit = ENTRY_READ_LIMIT } = {}) {
  const warnings = []
  const skippedDirs = []
  if (!fileService) {
    return { entries: [], warnings: [`世界书载体 ${pluginId} 未绑定项目文件服务，世界书取不到。`], skippedDirs, error: null }
  }
  const listed = await fileService.list({ pluginId, dir: WORLDBOOK_DIR })
  if (!listed.ok) return { entries: [], warnings: [], skippedDirs, error: listed.error }
  const directories = listed.value.entries.filter((entry) => entry.kind === 'dir')
  skippedDirs.push(...directories.map((entry) => `${WORLDBOOK_DIR}/${entry.name}`))
  if (directories.length) {
    warnings.push(`「${WORLDBOOK_DIR}/」下有 ${directories.length} 个子目录（${directories.slice(0, 6).map((entry) => entry.name).join(' / ')}）未递归读取：文件服务只让一级列举。`)
  }
  const names = listed.value.entries
    .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    .map((entry) => entry.name)

  const cap = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, ENTRY_READ_LIMIT) : ENTRY_READ_LIMIT
  const entries = []
  for (const name of names.slice(0, cap)) {
    const read = await fileService.read({ pluginId, dir: WORLDBOOK_DIR, file: name })
    if (!read.ok) {
      warnings.push(`世界书「${name}」读失败：${read.error.message}`)
      continue
    }
    const parsed = parseWorldbookEntryFile(read.value.text)
    if (parsed.ok) {
      const content = String(parsed.entry.content ?? '').replace(/\r\n?/g, '\n').trim()
      entries.push({
        id: parsed.entry.id || null,
        name: parsed.entry.name || name.replace(TEXT_FILE_PATTERN, ''),
        type: parsed.entry.type || 'general',
        keys: [...(parsed.entry.keys ?? [])],
        tags: Array.isArray(parsed.entry.tags) ? parsed.entry.tags : [],
        // 收口包②（调度方裁定 dwfq-5c79bf4a-1）：摘要随条目一起透出，阅读态才「有值才显示」。
        summary: typeof parsed.entry.summary === 'string' ? parsed.entry.summary : '',
        relations: Array.isArray(parsed.entry.relations) ? parsed.entry.relations : [],
        content,
        path: read.value.relativePath,
        revision: read.value.revision,
        chars: content.length,
        contract: true
      })
      continue
    }
    // 作者手写的裸 md 也是条目：按整篇收录，但把「没走文件契约」记在账上，面板与上下文两头都说得清。
    const content = String(read.value.text).replace(/\r\n?/g, '\n').trim()
    entries.push({
      id: null,
      name: name.replace(TEXT_FILE_PATTERN, ''),
      type: 'general',
      keys: [],
      tags: [],
      relations: [],
      content,
      path: read.value.relativePath,
      revision: read.value.revision,
      chars: content.length,
      contract: false,
      contractError: parsed.error.message,
      unparsed: true
    })
  }
  if (names.length > cap) {
    warnings.push(`「${WORLDBOOK_DIR}/」有 ${names.length} 个文件，本次只读了前 ${cap} 个（上限 ${ENTRY_READ_LIMIT}）。`)
  }
  if (entries.some((entry) => entry.unparsed)) {
    warnings.push(`${entries.filter((entry) => entry.unparsed).length} 个世界书文件不符合文件契约（无 frontmatter 或缺 id），按整篇正文收录。`)
  }
  return { entries, warnings, skippedDirs, error: null }
}

/** 旧名字（next/index.mjs 经 carriers/index.mjs 再导出）：世界书取数口迁到本模块后保持这个名字可用。 */
export const readSettingEntries = readWorldbookEntries

async function worldbookBlocks({ pluginId, fileService, question }) {
  const read = await readWorldbookEntries({ pluginId, fileService })
  if (read.error) return { blocks: [], warnings: [`worldbook 块未取得：${read.error.message}`] }
  const warnings = [...read.warnings]
  const usable = read.entries.filter((entry) => entry.content)
  const asked = String(question || '')
  const ranked = usable
    .map((entry, order) => ({ entry, order, mentions: mentionCount(entry, asked) }))
    .sort((a, b) => (b.mentions - a.mentions) || (a.order - b.order))
    .slice(0, WORLDBOOK_ENTRY_LIMIT)
  if (usable.length > ranked.length) {
    warnings.push(`世界书共 ${usable.length} 条可读条目，按提问命中取了 ${ranked.length} 条进上下文。`)
  }
  const blocks = ranked.map(({ entry }) => ({
    kind: 'worldbook',
    content: `# 世界书：${entry.name}（${entry.type}${entry.unparsed ? '，未按契约建档' : ''}）\n${clip(entry.content, WORLDBOOK_CHAR_CAP)}`,
    sourceRefs: [`worldbook:${entry.path}`]
  }))
  if (!blocks.length && !warnings.length) warnings.push(`「${WORLDBOOK_DIR}/」没有可读条目。`)
  return { blocks, warnings }
}

/** 命中词：条目全名 + keys + tags + 按分隔符切出的短词，避免「人物·柯秒（冷穿越剧版）」永远匹配不上「柯秒」。 */
function mentionKeys(entry) {
  const keys = new Set()
  const raws = [entry.name, ...(Array.isArray(entry.keys) ? entry.keys : []), ...(Array.isArray(entry.tags) ? entry.tags : [])]
  for (const raw of raws) {
    const value = String(raw || '').trim()
    if (!value) continue
    if (value.length >= 2) keys.add(value)
    for (const part of value.split(MENTION_SPLIT)) {
      const token = part.trim()
      if (token.length < 2) continue
      keys.add(token)
      const stripped = token.replace(/(?:层|史|版|篇|录)$/u, '')
      if (stripped.length >= 2) keys.add(stripped)
    }
  }
  return [...keys]
}

function mentionCount(entry, question) {
  if (!question) return 0
  return mentionKeys(entry).filter((key) => question.includes(key)).length
}

function clip(text, cap) {
  return text.length > cap ? `${text.slice(0, cap)}\n……（已截断，原文 ${text.length} 字）` : text
}

export default createWorldbookBlocks
