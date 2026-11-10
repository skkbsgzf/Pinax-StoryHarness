import { DOSSIER_CARRIER, DOSSIER_CARRIER_ID } from './manifest.mjs'

/**
 * 设定与资料载体的上下文块构建器（批次60：setting／reference 两种块原样合并）。
 *
 * 三块：rules／style 来自「约束/」（作者手写规矩，文件名带文风字样的归 style），
 * references 来自「资料/」（只列篇目与字数，正文不放进上下文）。
 * 与其它载体同一套约定：返 `{ kind: async (askCtx) => 素材包 }`，
 * 素材包 = { blocks:[{kind, content, sourceRefs}], warnings:[] }；读不到只记账，不硬失败。
 * 读盘一律走文件服务并带自己的 pluginId——两个目录的读权限都是这块板块在清单里申请来的。
 *
 * 两条如实的限制写在这里，不假装覆盖面比这更大：
 *   1) 只看目录一级（子目录不会被递归列举，文件服务当前不提供更深的列举）；
 *   2) 单条字符上限是硬闸，超了在块里写明「已截断，原文 N 字」，绝不悄悄丢字。
 * 资料一次最多碰 REFERENCE_READ_LIMIT 个文件，超了记账，不静默丢篇目。
 */
const CONSTRAINTS_DIR = DOSSIER_CARRIER.dataDirs.constraints
const DOCUMENTS_DIR = DOSSIER_CARRIER.dataDirs.documents
const RULE_FILE_LIMIT = 8
const RULE_CHAR_CAP = 6000
const REFERENCE_READ_LIMIT = 200
const STYLE_NAME_PATTERN = /(文风|风格|笔法|语感|腔调)/u
const TEXT_FILE_PATTERN = /\.(?:md|txt)$/iu
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export const DOSSIER_CONTEXT_KINDS = Object.freeze(['rules', 'style', 'references'])

export function createDossierBlocks(context = {}) {
  const pluginId = context.pluginId ?? DOSSIER_CARRIER_ID
  const fileService = context.fileService ?? null

  const readers = {
    rules: () => constraintBlocks({ pluginId, fileService, kinds: ['rules'], excludeStyle: true, cap: RULE_CHAR_CAP, limit: RULE_FILE_LIMIT }),
    style: () => constraintBlocks({ pluginId, fileService, kinds: ['style'], onlyStyle: true, cap: RULE_CHAR_CAP, limit: RULE_FILE_LIMIT }),
    references: () => referenceManifestBlock({ pluginId, fileService })
  }
  return readers
}

/** 「约束/」是作者手写自由区：文件名里带文风字样的进 style 块，其余进 rules 块。 */
async function constraintBlocks({ pluginId, fileService, kinds, excludeStyle = false, onlyStyle = false, cap, limit }) {
  const kind = kinds[0]
  if (!fileService) return { blocks: [], warnings: [`设定与资料载体 ${pluginId} 未绑定项目文件服务，${kind} 块缺席。`] }
  const listed = await fileService.list({ pluginId, dir: CONSTRAINTS_DIR })
  if (!listed.ok) return { blocks: [], warnings: [`${kind} 块未取得：${listed.error.message}`] }
  const names = listed.value.entries
    .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    .map((entry) => entry.name)
    .filter((name) => (onlyStyle ? STYLE_NAME_PATTERN.test(name) : excludeStyle ? !STYLE_NAME_PATTERN.test(name) : true))

  const warnings = []
  const blocks = []
  for (const name of names.slice(0, limit)) {
    const read = await fileService.read({ pluginId, dir: CONSTRAINTS_DIR, file: name })
    if (!read.ok) {
      warnings.push(`约束「${name}」读失败：${read.error.message}`)
      continue
    }
    const body = String(read.value.text).replace(/\r\n?/g, '\n').trim()
    if (!body) continue
    const stem = name.replace(TEXT_FILE_PATTERN, '')
    const retained = body.length > cap ? `${body.slice(0, cap)}\n……（已截断，原文 ${body.length} 字）` : body
    blocks.push({
      kind,
      content: `# 约束：${stem}\n${retained}`,
      sourceRefs: [`setting-${kind}:${read.value.relativePath}`]
    })
  }
  if (names.length > limit) warnings.push(`约束文件超过 ${limit} 个，只附带前 ${limit} 个（其余 ${names.length - limit} 个未进上下文）。`)
  if (!blocks.length && !warnings.length) warnings.push(`「${CONSTRAINTS_DIR}/」${onlyStyle ? '没有文风类文件' : '没有可读的约束文件'}。`)
  return { blocks, warnings }
}

/** 「资料/」只交目录清单：篇名＋字数，正文不放进上下文（要看某一篇用 pinax_document_read）。 */
async function referenceManifestBlock({ pluginId, fileService }) {
  if (!fileService) {
    return { blocks: [], warnings: [`设定与资料载体 ${pluginId} 未绑定项目文件服务，reference 块缺席。`] }
  }
  const listed = await fileService.list({ pluginId, dir: DOCUMENTS_DIR })
  if (!listed.ok) return { blocks: [], warnings: [`reference 块未取得：${listed.error.message}`] }

  const warnings = []
  const directories = listed.value.entries.filter((entry) => entry.kind === 'dir')
  if (directories.length) {
    warnings.push(`「${DOCUMENTS_DIR}/」下有 ${directories.length} 个子目录（${directories.slice(0, 6).map((entry) => entry.name).join(' / ')}）未递归读取：文件服务只让一级列举。`)
  }
  const names = listed.value.entries
    .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => collator.compare(a, b))

  // 字数取自真实读到的文本（不是估的）；只借长度，正文本身不进块。
  const entries = []
  for (const name of names.slice(0, REFERENCE_READ_LIMIT)) {
    const read = await fileService.read({ pluginId, dir: DOCUMENTS_DIR, file: name })
    if (!read.ok) {
      warnings.push(`资料「${name}」读失败：${read.error.message}`)
      continue
    }
    entries.push({
      name: name.replace(TEXT_FILE_PATTERN, ''),
      file: read.value.relativePath,
      chars: read.value.text.length
    })
  }
  if (names.length > REFERENCE_READ_LIMIT) {
    warnings.push(`「${DOCUMENTS_DIR}/」有 ${names.length} 个文件，本次只收了前 ${REFERENCE_READ_LIMIT} 个（上限 ${REFERENCE_READ_LIMIT}）。`)
  }
  if (!entries.length) {
    if (!warnings.length) warnings.push(`「${DOCUMENTS_DIR}/」没有可读的 .md/.txt 资料。`)
    return { blocks: [], warnings }
  }

  const lines = entries.map((entry, index) => `${index + 1}. ${entry.name} —— ${entry.chars} 字（${entry.file}）`)
  return {
    blocks: [{
      kind: 'references',
      content: `# 资料目录（只列篇目与字数，正文未放进上下文；要看某一篇请用 pinax_document_read）\n${lines.join('\n')}`,
      sourceRefs: entries.slice(0, 32).map((entry) => `reference-documents:${entry.file}`)
    }],
    warnings
  }
}

export default createDossierBlocks
