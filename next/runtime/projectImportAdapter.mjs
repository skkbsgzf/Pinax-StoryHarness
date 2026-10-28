import fs from 'node:fs'
import path from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { parseChapterNumber } from '../../server/mcp/projectImport.js'
import { parseWorldbookEntryFile } from '../../server/services/localMirrorService.js'

/**
 * Next 侧整目录导入（工单E1 · 裁定A：结构动作与建项目同级，走 shell 通道，不经写族闸）。
 *
 * 为什么不直接调 `pinax_project_import`：那份实现的分类与落盘全程经
 * `resolveProject()`（server/mcp/localProjects.js:62-72）——目标必须是 `spec=pinax-project@1`
 * 的本地项目；Next 建的项目写 `pinax-project@2`（next/kernel/projectSkeleton.mjs:11），
 * 一进门就 `ERR_SPEC_MISMATCH`。且它拒吃「源＝项目根」（server/mcp/projectImport.js:364-366），
 * 「选一个目录就地归类」这条路本身也不成立。所以这里走裁定给的第二条：Next 自写薄导入器。
 *
 * 同源约定（改动需双侧同步）：类别表、章节形态、目录白名单、跳过理由与大小上限逐条照抄
 * `server/mcp/projectImport.js:16-44`；中文序号解析直接复用它的 `parseChapterNumber`，
 * 世界书契约 v2 的判定复用内核同一个 `parseWorldbookEntryFile`——分类是规则不是语义，
 * 两边认不出的东西都不许替作者编号或编类别。
 *
 * 承诺（与 MCP 侧同一口径）：
 *   - 源目录永远只读：这里不写、不改、不删 sourcePath 下的任何文件；
 *   - 只新增标准目录里的文件，绝不覆盖：目标已存在且内容不同 → 记 write-failed（ERR_FILE_EXISTS），
 *     同内容 → reused，不重写；
 *   - 认不出类别的文件一律进 skipped 带 reason，不猜。
 */

/** 与 server/mcp/projectImport.js:11-13 同源。 */
export const IMPORT_LIMITS = Object.freeze({
  maxFiles: 400,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxDepth: 12
})

/** 源目录顶层名 → 类别（server/mcp/projectImport.js:16-28 的同一张表）。 */
export const IMPORT_CATEGORY_BY_DIR = Object.freeze({
  正文: 'chapter',
  大纲: 'outline',
  世界书: 'worldbook',
  规则: 'rule',
  约束: 'rule',
  构思: 'idea',
  资料: 'source',
  素材: 'source',
  参考: 'source',
  归档: 'source',
  日志: 'log'
})

/** 项目内允许写入的顶层目录（白名单；越出即拒绝，绝不写到项目外）。 */
const ALLOWED_PROJECT_DIRS = new Set(['正文', '大纲', '世界书', '构思', '资料', '日志', '约束'])

const CHAPTER_HEADING = /^\s*(?:#{1,6}\s*)?(?:第\s*([0-9零一二三四五六七八九十百千两]+)\s*[章节回]\s*[·・:：、,，.。_\-—]?\s*([^\n]{0,60})|([0-9]{1,3})\s*[._\-—]\s*([^\n]{1,60}))/u
const CHAPTER_DIR_NAME = /第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回]/u
const OUTLINE_NAME = /大纲|梗概|细纲|分集|节拍/u
const PROSE_NAME = /^(?:小说|正文|原稿|初稿)(?:[.。_-].*)?$/u
const TITLE_NOISE = /^[\s·・:：、,，.。_\-—"'「」『』《》〈〉“”‘’]+|[”“‘’'「」『』《》〈〉\s]+$/gu
const BINARY_EXTENSION = /\.(?:jpg|jpeg|png|gif|webp|bmp|tiff|ico|mp3|mp4|m4a|wav|flac|aac|psd|clip|avi|mov|ttf|otf|woff2?|eot|zip|7z|rar|gz|tar|exe|dll|so|dylib|pdf|docx?|xlsx?|pptx?)$/iu
const TEXT_EXTENSION = /\.(?:md|txt|markdown|json)$/iu
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/gu

const WORLDBOOK_DIR_BY_KIND = Object.freeze({
  character: '人物',
  location: '地理',
  organization: '势力',
  event: '编年',
  source: '资料'
})

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function cleanTitle(value) {
  const text = normalizeText(String(value ?? '').replace(TITLE_NOISE, ''))
  return text.length >= 2 && /[^\p{P}\s]/u.test(text) ? text.slice(0, 60) : ''
}

/** 单个路径片段的安全化：非法字符与分隔符换成下划线，认不出安全名就返回空串。 */
function safeSegment(value) {
  const text = String(value ?? '').replace(ILLEGAL_NAME_CHARS, '_').replace(TITLE_NOISE, '').replace(/\s+/gu, ' ').trim()
  if (!text || text === '.' || text === '..') return ''
  return text.slice(0, 120)
}

/** 保留源目录层级的项目内相对名（每一段单独安全化）。 */
function safeRelative(tail, name) {
  const dirs = String(tail || '').split('/').map(safeSegment).filter(Boolean)
  const file = safeSegment(name) || '未命名'
  return [...dirs, file].join('/')
}

function stripExtension(name) {
  return name.replace(/\.(?:md|txt|markdown|json)$/iu, '').trim()
}

function worldbookCategory(kind) {
  return WORLDBOOK_DIR_BY_KIND[String(kind || '').trim()] || '设定'
}

/** 从文件名/父目录/正文开头里取章节序号与标题；取不到返回 null（不编）。 */
function chapterShapeOf({ name, parents, text }) {
  const candidates = [stripExtension(name), ...parents.slice().reverse(), ...String(text || '').split('\n').slice(0, 8)]
  for (const candidate of candidates) {
    const line = String(candidate || '')
    const matched = CHAPTER_HEADING.exec(line)
    if (!matched) continue
    const number = parseChapterNumber(matched[1]) ?? parseChapterNumber(matched[3])
    const title = cleanTitle(matched[2] || matched[4] || '')
    if (number !== null || title) return { number, title: title || cleanTitle(stripExtension(line)) || line.trim().slice(0, 20) }
  }
  return null
}

/** 目录遍历：与 server/mcp/projectImport.js:108-131 同一口径（跳过点目录、深度 12、符号链接只记账）。 */
function walkSource(root, { maxDepth = IMPORT_LIMITS.maxDepth } = {}) {
  const found = []
  const symlinks = []
  const tooDeep = []
  function visit(dir, depth, chain) {
    if (depth > maxDepth) { tooDeep.push(relative(root, dir)); return }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of [...entries].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) { symlinks.push(relative(root, file)); continue }
      if (entry.isDirectory()) {
        if (entry.name === '.kb' || entry.name.startsWith('.')) continue
        if (depth === 0 && entry.name === 'pinax') continue
        visit(file, depth + 1, [...chain, entry.name])
        continue
      }
      if (entry.isFile()) found.push({ file, relative: relative(root, file), chain: [...chain, entry.name] })
    }
  }
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) visit(root, 0, [])
  return { files: found, symlinks, tooDeep }
}

function readSourceFile(file) {
  let text
  try { text = fs.readFileSync(file, 'utf-8') } catch { return null }
  if (Buffer.byteLength(text, 'utf-8') > IMPORT_LIMITS.maxFileBytes) return null
  // 二进制/非文本：出现 NUL 直接判不可读，避免把乱码灌进项目。
  if (text.includes('\u0000')) return null
  return text
}

/** 单文件分类：只认确定性形态，认不出归 skip 并给出原因（server/mcp/projectImport.js:176-312 的同源子集）。 */
function classifyFile({ entry, text }) {
  const name = path.posix.basename(entry.relative)
  const parents = entry.chain.slice(0, -1)
  const topDir = entry.chain[0]
  const tail = parents.length ? parents.slice(1).join('/') : ''
  const cleanName = stripExtension(name)
  const category = IMPORT_CATEGORY_BY_DIR[topDir]

  if (BINARY_EXTENSION.test(name)) {
    return { decision: 'skip', reason: 'binary-not-importable', detail: '图片/音视频/字体/压缩包/PDF 不是文本导入对象，保留在源目录' }
  }

  if (/\.json$/iu.test(name)) {
    let parsed = null
    try { parsed = JSON.parse(text) } catch { parsed = null }
    if (!parsed) return { decision: 'skip', reason: 'json-invalid', detail: `JSON 解析失败（${entry.relative}）` }
    if (topDir === '大纲' && cleanName.toLowerCase() === 'outline') {
      if (!Array.isArray(parsed.nodes)) {
        return { decision: 'skip', reason: 'outline-json-invalid', detail: '大纲/outline.json 缺 nodes 数组，未导入（不替作者补节点）' }
      }
      return { decision: 'outline-json', name: 'outline', target: '大纲/outline.json', nodes: parsed.nodes.length, chars: normalizeText(text).length }
    }
    if (topDir === '世界书' && /^(?:graph|manifest)$/iu.test(cleanName)) {
      return {
        decision: 'skip',
        reason: 'graph-owned-by-indexer',
        detail: `世界书/${cleanName}.json 由索引器按 世界书/ 条目重建，不是作者可导入的事实源；导条目而不是导 graph（${entry.relative}）`
      }
    }
    if (parsed.docId && Array.isArray(parsed.chunks)) {
      return { decision: 'source-json', name: cleanName || '归档', target: `资料/归档/${safeSegment(cleanName) || '归档'}.json`, chunks: parsed.chunks.length, chars: normalizeText(text).length }
    }
    return {
      decision: 'skip',
      reason: 'json-not-routed',
      detail: `未识别的 JSON（${entry.relative}）；只有 大纲/outline.json 与归档格式（含 docId + chunks 数组）的 资料/归档/*.json 有固定去处，世界书/graph|manifest.json 由索引器重建、不导入`
    }
  }

  if (!/\.(?:md|txt|markdown)$/iu.test(name)) {
    return { decision: 'skip', reason: 'not-text', detail: '只导入 md/txt/markdown/json' }
  }

  if (category === 'worldbook') {
    const isAuxiliary = /^0\d[-_]/u.test(name) || /^(?:README|纪律|台账|章账|索引|知识图谱)$/u.test(cleanName) || /^(?:README|纪律|台账|章账)$/u.test(name)
    if (isAuxiliary) {
      return { decision: 'auxiliary', name: cleanName || '世界书辅助', target: `资料/世界书辅助/${safeSegment(cleanName) || '世界书辅助'}.md`, chars: normalizeText(text).length }
    }
    const parsed = parseWorldbookEntryFile(text)
    if (!parsed.ok) {
      return {
        decision: 'skip',
        reason: 'worldbook-not-conform',
        code: parsed.error?.code || 'PARSE_FAILED',
        detail: `世界书条目不合契约 v2（${parsed.error?.message || '解析失败'}）；Next 侧薄导入器只导合规条目，请用 MCP 的 pinax_project_import（worldbookMode:"wrap"）重跑这一批，或单条用 pinax_worldbook_write 重写`
      }
    }
    const entryName = cleanTitle(parsed.entry.name) || cleanName
    const categoryDir = worldbookCategory(parsed.entry.kind)
    return {
      decision: 'worldbook',
      name: entryName,
      categoryDir,
      target: `世界书/${categoryDir}/${safeSegment(entryName)}.md`,
      type: String(parsed.entry.kind || 'general'),
      id: parsed.entry.id || null,
      chars: String(parsed.entry.content || '').length
    }
  }

  if (category === 'rule') {
    if (parents.length > 1) return { decision: 'skip', reason: 'rule-nested', detail: `约束只认单层文件（${entry.relative}）；请把内容并入一个文件或放到项目 约束/ 下` }
    return { decision: 'rule', name: cleanName, target: `约束/${safeSegment(cleanName)}.md`, chars: normalizeText(text).length }
  }

  const inChapterDir = parents.some((dir) => CHAPTER_DIR_NAME.test(dir))
  if (category === 'chapter' || (!category && inChapterDir && PROSE_NAME.test(name))) {
    const shape = chapterShapeOf({ name, parents, text })
    if (!shape) {
      return { decision: 'skip', reason: 'chapter-unidentified', detail: `认不出章节序号与标题（${entry.relative}）；正文需要 第N章 标题或 NNN-标题 形态（文件名、章节目录名或正文开头任一命中），不替作者编号` }
    }
    if (!shape.number) {
      return { decision: 'skip', reason: 'chapter-unnumbered', detail: `有标题但认不出序号（${entry.relative}）；确认后请用 pinax_chapter_import 指定 chapterNumber` }
    }
    return { decision: 'chapter', number: shape.number, title: shape.title || `第${shape.number}章`, target: `正文/${String(shape.number).padStart(3, '0')}-${safeSegment(shape.title || `第${shape.number}章`)}.md`, chars: normalizeText(text).length }
  }

  // 章节目录里的非正文兄弟（剧本/分镜/导演小记/提示词等衍生品）→ 资料/章节衍生/。
  if (inChapterDir) {
    const chapterDir = parents.slice().reverse().find((dir) => CHAPTER_DIR_NAME.test(dir))
    return {
      decision: 'material',
      name: cleanName,
      target: `资料/章节衍生/${safeSegment(chapterDir)}/${safeSegment(cleanName) || '衍生品'}.md`,
      chars: normalizeText(text).length,
      note: '章节目录内的非正文衍生品（剧本/分镜/提示词等），按 资料/ 收录'
    }
  }

  if (category === 'outline' || (!category && OUTLINE_NAME.test(name))) {
    return { decision: 'outline', name: cleanName, target: `大纲/${safeRelative(tail, cleanName)}.md`, chars: normalizeText(text).length }
  }
  if (category === 'idea') return { decision: 'idea', name: cleanName, target: `构思/${safeRelative(tail, cleanName)}.md`, chars: normalizeText(text).length }
  if (category === 'source') return { decision: 'source', name: cleanName, target: `资料/${safeRelative(tail, cleanName)}.md`, chars: normalizeText(text).length }
  if (category === 'log') return { decision: 'log', name: cleanName, target: `日志/${safeRelative(tail, cleanName)}.md`, chars: normalizeText(text).length }

  return {
    decision: 'skip',
    reason: 'unmapped',
    detail: `顶层目录「${topDir || path.posix.dirname(entry.relative)}」与文件名都没有固定类别（${entry.relative}）；需要导入请归入 正文/大纲/世界书/规则|约束/构思|素材/资料/日志 之一，或让章节文件位于 第N章-标题/ 目录并命名为 小说.md`
  }
}

function isSamePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function isInside(child, parent) {
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`
  return path.resolve(child).toLowerCase().startsWith(prefix.toLowerCase())
}

/** 入参校验：源/目标都是绝对目录、互不包含、源不是（曾是）Pinax 项目、目标必须是项目根。 */
function resolveInputs({ sourcePath, targetPath } = {}) {
  const source = typeof sourcePath === 'string' ? sourcePath.trim() : ''
  const target = typeof targetPath === 'string' ? targetPath.trim() : ''
  if (!source) return fail('INVALID_INPUT', '请提供稿子目录（sourcePath）：要导入的既有素材在哪个文件夹？')
  if (!target) return fail('INVALID_INPUT', '请提供新项目位置（targetPath）：稿子要收进哪个空目录？')
  for (const [label, value] of [['稿子目录', source], ['新项目位置', target]]) {
    if (!path.isAbsolute(value)) return fail('INVALID_INPUT', `${label}必须是绝对路径：${value}`)
    if (value.includes('..')) return fail('INVALID_INPUT', `${label}不允许包含 ..：${value}`)
  }
  const sourceRoot = path.resolve(source)
  const targetRoot = path.resolve(target)
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return fail('INVALID_INPUT', `稿子目录不存在或不是目录：${sourceRoot}`)
  }
  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    return fail('INVALID_INPUT', `新项目位置不存在或不是目录：${targetRoot}`)
  }
  if (isSamePath(sourceRoot, targetRoot)) {
    return fail('INVALID_INPUT', '稿子目录不能就是项目根：导入是把稿子收进项目的标准目录，两者必须是不同目录（原稿目录只读）。')
  }
  if (isInside(targetRoot, sourceRoot)) {
    return fail('INVALID_INPUT', '新项目位置不能在稿子目录里面：导入只新增目标项目里的文件，绝不往源目录写。')
  }
  if (isInside(sourceRoot, targetRoot)) {
    return fail('INVALID_INPUT', '稿子目录不能在新项目位置里面：导入只新增目标项目里的文件，绝不往源目录写。')
  }
  // 裁定第 5 条：源目录里已有 .pinax/ → 计划阶段如实报「该目录已是或曾是 Pinax 项目」并停，不猜。
  // 判据是 .pinax/ 目录本身而不是 project.json：骨架可能在（上一次导入/建项目留下的），清单不一定还在。
  if (fs.existsSync(path.join(sourceRoot, '.pinax'))) {
    return fail('INVALID_INPUT', `该目录已是或曾是 Pinax 项目（含 .pinax/ 元数据目录）：${sourceRoot}。导入源必须是作者的原稿目录——请另选一个目录，或先把 .pinax/ 移走再导入。`, { sourcePath: sourceRoot })
  }
  if (!fs.existsSync(path.join(targetRoot, '.pinax', 'project.json'))) {
    return fail('INVALID_INPUT', `新项目位置还不是 Pinax 项目（缺 .pinax/project.json）：${targetRoot}。向导会先用「先建项目」建好骨架再导入。`, { targetPath: targetRoot })
  }
  return ok({ sourceRoot, targetRoot })
}

/** 生成计划（纯读）：遍历 + 分类 + 同源收敛，不写任何文件（目标只在校验与落盘两步用到）。 */
function buildPlan({ sourceRoot }) {
  const scanned = walkSource(sourceRoot)
  const plan = []
  const skipped = []
  let bytesSeen = 0
  let considered = 0

  for (const entry of scanned.files) {
    if (considered >= IMPORT_LIMITS.maxFiles) {
      skipped.push({ file: entry.relative, reason: 'over-limit', detail: `已达 maxFiles=${IMPORT_LIMITS.maxFiles}，其余未处理` })
      continue
    }
    const baseName = path.posix.basename(entry.relative)
    if (BINARY_EXTENSION.test(baseName)) {
      skipped.push({ file: entry.relative, reason: 'binary-not-importable', detail: '图片/音视频/字体/压缩包/PDF 不是文本导入对象，保留在源目录' })
      continue
    }
    if (!TEXT_EXTENSION.test(baseName)) {
      skipped.push({ file: entry.relative, reason: 'not-text', detail: '只导入 md/txt/markdown/json' })
      continue
    }
    let stat
    try { stat = fs.statSync(path.join(sourceRoot, entry.relative)) } catch { continue }
    if (stat.size > IMPORT_LIMITS.maxFileBytes) {
      skipped.push({ file: entry.relative, reason: 'file-too-large', detail: `超过 ${IMPORT_LIMITS.maxFileBytes} 字节单文件上限` })
      continue
    }
    if (bytesSeen + stat.size > IMPORT_LIMITS.maxTotalBytes) {
      skipped.push({ file: entry.relative, reason: 'total-too-large', detail: `累计超过 ${IMPORT_LIMITS.maxTotalBytes} 字节上限` })
      continue
    }
    considered++
    bytesSeen += stat.size
    const text = readSourceFile(path.join(sourceRoot, entry.relative))
    if (text === null) { skipped.push({ file: entry.relative, reason: 'unreadable', detail: '读取失败、超限或含二进制字节' }); continue }
    const classified = classifyFile({ entry, text })
    if (classified.decision === 'skip') {
      skipped.push({ file: entry.relative, reason: classified.reason, code: classified.code || null, detail: classified.detail || '' })
      continue
    }
    plan.push({
      source: entry.relative,
      bytes: stat.size,
      chars: classified.chars ?? normalizeText(text).length,
      ...classified,
      text
    })
  }

  // 同源内容收敛：规则/约束 双写、世界书 平铺原文与副本 都在这一步合并，只留第一份。
  const seenContent = new Map()
  const seenTarget = new Map()
  const deduped = []
  const collapsed = []
  for (const item of plan) {
    const key = normalizeText(item.text)
    if (!key) { collapsed.push({ file: item.source, reason: 'empty-file', kept: null }); continue }
    const bodyKey = item.decision === 'worldbook' ? `wb:${item.name}` : key
    const holder = seenContent.get(bodyKey)
    if (holder) { collapsed.push({ file: item.source, reason: 'duplicate-content', kept: holder }); continue }
    const targetKey = item.decision === 'chapter' ? `正文#${item.number ?? 'auto'}` : `${item.target || item.decision}:${item.name || item.source}`
    const previous = seenTarget.get(targetKey)
    if (previous) { collapsed.push({ file: item.source, reason: 'same-slot', kept: previous }); continue }
    seenContent.set(bodyKey, item.source)
    seenTarget.set(targetKey, item.source)
    deduped.push(item)
  }

  const byDecision = {}
  for (const item of deduped) byDecision[item.decision] = (byDecision[item.decision] || 0) + 1
  const byReason = {}
  for (const item of skipped) byReason[item.reason] = (byReason[item.reason] || 0) + 1

  return { scanned, skipped, deduped, collapsed, bytesSeen, considered, byDecision, byReason }
}

function baseReport({ mode, sourceRoot, targetRoot, built }) {
  const warnings = [
    '正文/ 与 大纲/ 不在 RAG 输入集（世界书/资料/规则/约束/文风）里；要让 Agent 查到设定，需要 世界书 与 约束 有内容并跑 pinax_project_index。',
    '源目录只读：本次导入不写、不改、不删源目录下的任何文件。'
  ]
  if (built.scanned.symlinks.length) warnings.push(`源目录含 ${built.scanned.symlinks.length} 个符号链接，已跳过（知识索引遇到符号链接会整次拒绝）。`)
  if (built.scanned.tooDeep.length) warnings.push(`源目录有 ${built.scanned.tooDeep.length} 处层级超过 ${IMPORT_LIMITS.maxDepth} 层，已跳过。`)
  if (built.byReason['worldbook-not-conform']) warnings.push(`有 ${built.byReason['worldbook-not-conform']} 个世界书文件不合契约 v2；Next 侧薄导入器不改写作者文本，可用 MCP 的 pinax_project_import（worldbookMode:"wrap"）单独处理这一批。`)
  if (mode === 'plan') warnings.unshift('当前是计划模式（dryRun）：未写入任何文件；核对每项的 target 后再按「执行导入」落盘。')

  return {
    mode,
    sourceRoot,
    targetRoot,
    scanned: built.scanned.files.length,
    considered: built.considered,
    bytes: built.bytesSeen,
    importable: built.deduped.length,
    collapsedCount: built.collapsed.length,
    skippedCount: built.skipped.length,
    decisions: built.byDecision,
    skipReasons: built.byReason,
    items: built.deduped.map((item) => ({
      source: item.source,
      decision: item.decision,
      target: item.target,
      name: item.name || null,
      number: item.number ?? null,
      title: item.title ?? null,
      type: item.type ?? null,
      categoryDir: item.categoryDir ?? null,
      note: item.note || null,
      chars: item.chars
    })),
    skipped: built.skipped,
    collapsed: built.collapsed,
    written: [],
    writeFailures: [],
    createdCount: 0,
    reusedCount: 0,
    failedCount: 0,
    warnings,
    next: built.deduped.length
      ? (mode === 'plan'
        ? ['核对 items 的 decision 与 target', '需要调整类别就先整理源目录再重新生成计划', '按「执行导入」落盘', '跑 pinax_project_index 同步 RAG']
        : ['跑 pinax_project_index 同步 RAG', '用 project-bootstrap 状态卡复核剩余问题'])
      : ['没有可导入文件：按 skipped 的 reason 处置源目录']
  }
}

/** 目标相对路径 → 绝对路径（白名单 ＋ 越界检查，与 server/mcp/projectImport.js:314-324 同口径）。 */
function projectTarget(root, target) {
  if (!target || typeof target !== 'string') throw failure('ERR_TARGET_MISSING', '缺少目标路径，未写入。')
  if (target.includes('\\') || target.includes(':')) throw failure('ERR_TARGET_INVALID', `目标路径非法：${target}`)
  const segments = target.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw failure('ERR_TARGET_INVALID', `目标路径含越界片段：${target}`)
  if (!ALLOWED_PROJECT_DIRS.has(segments[0])) throw failure('ERR_TARGET_FORBIDDEN', `只允许写入项目标准目录（${[...ALLOWED_PROJECT_DIRS].join('/')}）：${target}`)
  const absolute = path.resolve(root, segments.join(path.sep))
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (!absolute.toLowerCase().startsWith(prefix.toLowerCase())) throw failure('ERR_TARGET_OUTSIDE', `目标越出项目根：${target}`)
  return absolute
}

/** 只新增：目标已存在且内容相同 → reused；不同 → 抛 ERR_FILE_EXISTS（不覆盖）。 */
function writeNewFile({ root, target, text }) {
  const absolute = projectTarget(root, target)
  const body = `${text}\n`
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
    const existing = fs.readFileSync(absolute, 'utf-8').replace(/\r\n?/g, '\n').trim()
    if (existing === normalizeText(text)) return { created: false, reused: true }
    throw failure('ERR_FILE_EXISTS', `${target} 已存在且内容不同；导入只新增不覆盖，请先人工核对。`)
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, body, { encoding: 'utf-8', flag: 'wx' })
  return { created: true, reused: false }
}

/** 分类计划（dryRun）：只读源目录，产出一份可给人核对的报告。 */
export function planImport({ sourcePath, targetPath } = {}) {
  const resolved = resolveInputs({ sourcePath, targetPath })
  if (!resolved.ok) return resolved
  try {
    const built = buildPlan(resolved.value)
    return ok(baseReport({ mode: 'plan', ...resolved.value, built }))
  } catch (error) {
    return fail('IO_FAILED', `生成导入计划失败：${String(error?.message || error)}`)
  }
}

/** 执行导入：按同一套计划落盘到目标项目的标准目录；失败逐条记账，不中断其余文件。 */
export function runImport({ sourcePath, targetPath } = {}) {
  const resolved = resolveInputs({ sourcePath, targetPath })
  if (!resolved.ok) return resolved
  try {
    const built = buildPlan(resolved.value)
    const report = baseReport({ mode: 'apply', ...resolved.value, built })
    for (const item of built.deduped) {
      const text = normalizeText(item.text)
      try {
        const written = writeNewFile({ root: resolved.value.targetRoot, target: item.target, text })
        report.written.push({ source: item.source, target: item.target, created: written.created, reused: written.reused })
      } catch (error) {
        const record = { source: item.source, target: item.target || null, reason: 'write-failed', code: error.code || 'ERR_WRITE_FAILED', detail: String(error.message || error) }
        report.writeFailures.push(record)
        report.skipped.push(record)
      }
    }
    report.createdCount = report.written.filter((item) => item.created).length
    report.reusedCount = report.written.filter((item) => item.reused).length
    report.failedCount = report.writeFailures.length
    report.skippedCount = report.skipped.length
    report.skipReasons = { ...built.byReason }
    for (const record of report.writeFailures) {
      report.skipReasons[record.code || 'write-failed'] = (report.skipReasons[record.code || 'write-failed'] || 0) + 1
    }
    if (report.failedCount) report.warnings.push(`有 ${report.failedCount} 个文件没有写入（目标已存在且内容不同，或写入失败），见 writeFailures；修正后重跑即可（已写入的不受影响）。`)
    return ok(report)
  } catch (error) {
    return fail('IO_FAILED', `执行导入失败：${String(error?.message || error)}`)
  }
}
