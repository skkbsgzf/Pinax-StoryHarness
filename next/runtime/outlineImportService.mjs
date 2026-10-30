import { fail, ok } from '../kernel/errors.mjs'
import { OUTLINE_CARRIER, OUTLINE_CARRIER_ID } from '../carriers/outline/manifest.mjs'
import { parseOutlineProse } from './outlineProse.mjs'
import { emitProjectEvent } from './eventBus.mjs'

/**
 * 大纲转换服务（批次30 · 任务二）：散文章节稿 → `大纲/outline.json` 的章节节点。
 *
 * 口子只对「当前项目的 大纲/」开：外部稿子先走 E1 整目录导入拷进来，再来这里转换。
 * 这样源文件永远只读、落点永远在项目内、写盘仍走文件服务那三道闸（归属＋file:大纲:rw＋修订并发）。
 *
 * 合并规则（工单钉死，一条都不许松）：
 *   • 现有节点一律不动——作者改过的标题／备注／排序是作者的字；
 *   • 节点靠 `source` 判同一节：已存在就跳过（reused），不存在才追加；
 *   • 追加节点 id 用 `imp-<递增>`，与现有 id 不冲突；
 *   • edges 一律不新增（章节顺序＝nodes 数组序）；现有 edges 原样保留，不重排、不修补；
 *   • 追加数为 0 就是 ok（imported:0, reused:N）——重跑幂等，不报错；
 *   • 写盘用读到的 revision 作 expectedRevision；STALE_REVISION 原样上抛，不重试、不覆盖；
 *   • 源 md 一个字节不动（这里只 read，不 write 任何 .md）。
 *
 * `dryRun`（工单任务三的「扫描结果」）走同一条计算路径，只是不写盘：
 * 先摊开「N 份 md · M 个章节标题」，作者按下「转换并导入」才落盘。默认 dryRun=true
 * 与 E1 适配器同一口径（不显式传 false 就不写）。
 *
 * 与 `pinax_outline_read` 同源的部分：读 `大纲/outline.json` → 解析 nodes/edges/revision；
 * 文件不存在（INVALID_INPUT）按空大纲（nodes=[], revision=0）处理，其余失败原样上抛
 * （比如大纲载体没启用 → 归属闸 DIR_CONFLICT，不能假装是「空大纲」然后乱写）。
 */
const OUTLINE_DIR = OUTLINE_CARRIER.dataDirs.outline
const OUTLINE_FILE = 'outline.json'
const MARKDOWN = /\.md$/iu

/** fileService.read 的「文件不存在」形状：PINAX_INVALID_INPUT 且 details.path 指到那份文件。 */
function isMissingFile(error) {
  return error?.code === 'PINAX_INVALID_INPUT' && Boolean(error?.details?.path)
}

function listMarkdown(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.kind === 'file' && MARKDOWN.test(String(entry.name ?? '')))
    .map((entry) => String(entry.name))
    .sort((a, b) => a.localeCompare(b))
}

/** 读现有 outline.json（与 pinax_outline_read 同一段解析；没有就是空大纲）。 */
async function readExisting(fileService) {
  const existing = await fileService.read({ pluginId: OUTLINE_CARRIER_ID, dir: OUTLINE_DIR, file: OUTLINE_FILE })
  if (!existing.ok) {
    if (isMissingFile(existing.error)) return { ok: true, value: { nodes: [], edges: [], revision: 0, warning: null } }
    return existing
  }
  let parsed
  try {
    parsed = JSON.parse(existing.value.text)
  } catch (error) {
    return fail('IO_FAILED', `「${OUTLINE_DIR}/${OUTLINE_FILE}」不是合法 JSON：${String(error?.message || error)}`, { path: existing.value.relativePath })
  }
  const hasNodes = Array.isArray(parsed?.nodes)
  return {
    ok: true,
    value: {
      nodes: hasNodes ? parsed.nodes : [],
      edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
      revision: existing.value.revision,
      warning: hasNodes ? null : `${OUTLINE_DIR}/${OUTLINE_FILE} 里没有 nodes 数组，按空大纲合并（原文件保留原样，只在追加后整份写回）`
    }
  }
}

/** 下一枚不冲突的追加 id（`imp-<递增>`，跳过已有 id）。 */
function nextImportedId(taken, cursor) {
  let seq = cursor
  let id = `imp-${seq}`
  while (taken.has(id)) {
    seq += 1
    id = `imp-${seq}`
  }
  taken.add(id)
  return { id, cursor: seq + 1 }
}

/**
 * importOutlineChapters({ root, fileService, dryRun }) → { ok, value | error }
 * value: { dryRun, files, chapters, imported, reused, revision, nodeTotal, items, warnings }
 */
export async function importOutlineChapters({ root, fileService, dryRun = true } = {}) {
  if (!fileService || typeof fileService.list !== 'function' || typeof fileService.read !== 'function' || typeof fileService.write !== 'function') {
    return fail('INVALID_INPUT', '文件服务未接入：大纲转换需要当前项目的文件服务，这条通道现在只报缺，不写任何文件')
  }
  if (!root) return fail('INVALID_INPUT', '大纲转换需要先打开一个项目：只转换当前项目 大纲/ 里的章节稿')

  const listed = await fileService.list({ pluginId: OUTLINE_CARRIER_ID, dir: OUTLINE_DIR })
  if (!listed.ok) return listed
  const files = listMarkdown(listed.value?.entries)
  if (!files.length) {
    return fail('INVALID_INPUT', `${OUTLINE_DIR}/ 下没有可转换的 md（把章节稿放进项目的 ${OUTLINE_DIR}/ 目录再重试；大纲.md 与 outline.json 不影响这一步）`, {
      dir: OUTLINE_DIR,
      entries: Array.isArray(listed.value?.entries) ? listed.value.entries.map((entry) => entry.name) : []
    })
  }

  const warnings = []
  const parsedChapters = []
  for (const name of files) {
    const read = await fileService.read({ pluginId: OUTLINE_CARRIER_ID, dir: OUTLINE_DIR, file: name })
    if (!read.ok) return read
    const parsed = parseOutlineProse(read.value.text, `${OUTLINE_DIR}/${name}`)
    warnings.push(...parsed.warnings)
    parsedChapters.push(...parsed.chapters)
  }

  const existing = await readExisting(fileService)
  if (!existing.ok) return existing
  if (existing.value.warning) warnings.push(existing.value.warning)

  const nodes = existing.value.nodes.slice()
  const edges = existing.value.edges.slice()
  const takenIds = new Set(nodes.map((node) => (typeof node?.id === 'string' ? node.id : '')))
  const knownSources = new Set(
    nodes.map((node) => (typeof node?.source === 'string' && node.source ? node.source : ''))
  )
  knownSources.delete('')

  let cursor = 1
  let imported = 0
  let reused = 0
  const items = []
  for (const chapter of parsedChapters) {
    if (!chapter.source || knownSources.has(chapter.source)) {
      reused += 1
      items.push({ title: chapter.title, source: chapter.source, status: 'reused' })
      continue
    }
    const next = nextImportedId(takenIds, cursor)
    cursor = next.cursor
    const node = { id: next.id, title: chapter.title }
    if (chapter.note) node.note = chapter.note
    node.source = chapter.source
    nodes.push(node)
    knownSources.add(chapter.source)
    imported += 1
    items.push({ title: chapter.title, source: chapter.source, status: 'imported', id: next.id })
  }

  const base = {
    dryRun: Boolean(dryRun),
    files: files.length,
    chapters: parsedChapters.length,
    imported,
    reused,
    revision: existing.value.revision,
    nodeTotal: nodes.length,
    items,
    warnings
  }

  // 重跑幂等：没有新章节就不写盘（也就不用 revision——作者手上的修订号不会被无意义地推进）。
  if (!imported || dryRun) return ok(base)

  const written = await fileService.write({
    pluginId: OUTLINE_CARRIER_ID,
    dir: OUTLINE_DIR,
    file: OUTLINE_FILE,
    text: JSON.stringify({ nodes, edges }, null, 2),
    expectedRevision: existing.value.revision
  })
  // STALE_REVISION 原样上抛：不重试、不合并、不半写。
  if (!written.ok) return written

  // 批次37：大纲真的变了才发事件（重跑幂等与 dryRun 都不发）。
  // 事件是旁路：广播失败既不影响已经落盘的写入，也不改返回值。
  emitProjectEvent(root, { kind: 'outline-changed' })

  return ok({
    ...base,
    dryRun: false,
    revision: written.value.revision,
    file: written.value.relativePath,
    bytes: written.value.bytes,
    sha256: written.value.sha256
  })
}

export default importOutlineChapters
