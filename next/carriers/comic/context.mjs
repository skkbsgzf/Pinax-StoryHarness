import { COMIC_CARRIER_ID } from './manifest.mjs'

/**
 * 漫画载体的上下文块构建器（references）：交「页清单」——页名＋格数＋第一句台词。
 *
 * 为什么只交清单：漫画页的正文与分镜动辄成百上千字，整段塞进信封会把约束与设定挤出去；
 * 模型真要读某一页时手上有 pinax_comic_read（面板与上下文同源，同一份文件服务）。
 * 读盘一律走 fileService 并带本载体的 pluginId——「漫画」目录的读权限是这块板块申请的。
 *
 * 只声明 references 一种：它是 shared/agentContextProfiles.js 里 authoring-knowledge／
 * storyboard-* 等只读档案都认的种类，漫画当主载体时信封组装拿得到；发明一个档案不认的
 * 新种类只会换来一条「已忽略」的 warning。
 */
const COMIC_DIR = '漫画'
const COMIC_FILE = '漫画.json'
const MAX_PAGES = 200

export function createComicBlocks(context = {}) {
  const pluginId = context.pluginId ?? COMIC_CARRIER_ID
  const fileService = context.fileService ?? null

  const build = () => comicPageBlock({ pluginId, fileService })
  return { references: build }
}

async function comicPageBlock({ pluginId, fileService }) {
  if (!fileService) {
    return { blocks: [], warnings: [`漫画载体 ${pluginId} 未绑定项目文件服务，references 块缺席。`] }
  }
  const read = await fileService.read({ pluginId, dir: COMIC_DIR, file: COMIC_FILE })
  if (!read.ok) {
    // 还没有 漫画.json 是常态（新项目），按「目录为空」记账，不冒充读到了。
    return { blocks: [], warnings: [`漫画页清单未取得：${read.error.message}`] }
  }
  let doc
  try {
    doc = JSON.parse(read.value.text)
  } catch {
    return { blocks: [], warnings: [`「${COMIC_DIR}/${COMIC_FILE}」不是合法 JSON，漫画页清单缺席。`] }
  }
  const records = Array.isArray(doc?.records) ? doc.records.filter((item) => item && typeof item === 'object') : []
  if (!records.length) return { blocks: [], warnings: [`「${COMIC_DIR}/${COMIC_FILE}」里还没有漫画页。`] }

  const warnings = []
  if (records.length > MAX_PAGES) warnings.push(`「${COMIC_DIR}/${COMIC_FILE}」有 ${records.length} 页，本次只列前 ${MAX_PAGES} 页。`)
  const ordered = records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => orderOf(a.record, a.index) - orderOf(b.record, b.index) || a.index - b.index)
    .slice(0, MAX_PAGES)
    .map(({ record }) => record)

  const lines = ordered.map((record, index) => {
    const panels = Array.isArray(record?.meta?.panels) ? record.meta.panels : []
    const firstLine = panels.map(lineOf).find(Boolean)
    return `${index + 1}. ${String(record.title || record.id || '未命名')} —— ${panels.length} 格${firstLine ? `，首句「${truncate(firstLine, 60)}」` : ''}`
  })
  return {
    blocks: [{
      kind: 'references',
      content: `# 漫画页清单（页名／格数／首句台词；正文与格内细节未放进上下文，要看请用 pinax_comic_read）\n${lines.join('\n')}`,
      sourceRefs: ordered.slice(0, 32).map((record) => `comic-page:${String(record.id || record.title || '').slice(0, 80)}`)
    }],
    warnings
  }
}

function lineOf(panel) {
  for (const key of ['dialogue', 'line', 'text', '台词']) {
    const value = panel?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function orderOf(record, index) {
  return Number.isSafeInteger(record?.order) ? record.order : Number.MAX_SAFE_INTEGER - 1_000_000 + index
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 漫画载体可提供的上下文块种类（与清单 context.providers 一致）。 */
export const COMIC_CONTEXT_KINDS = Object.freeze(['references'])

export default createComicBlocks
