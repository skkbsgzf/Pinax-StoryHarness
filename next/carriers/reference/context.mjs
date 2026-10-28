import { REFERENCE_CARRIER_ID } from './manifest.mjs'

/**
 * 资料载体的上下文块构建器（工单G1 的素材侧）。
 * 与小说／设定载体同一套约定：`createReferenceBlocks(projectCtx)` 返回 `{ kind: async (askCtx) => 素材包 }`，
 * 素材包 = { blocks:[{kind, content, sourceRefs}], warnings:[] }；读不到只记账，不硬失败。
 * 读盘一律走文件服务并带自己的 pluginId——「资料」这个目录的读权限是这块板块在清单里申请的
 * （file:资料:rw，写半边给 pinax_document_save），运行时自己没有。
 *
 * 本批只交「目录清单」这一块：篇名＋字数，正文不放进上下文。
 * 理由很实在：资料是作者收着备查的东西，动辄长篇；把正文整段塞进信封会挤掉正文与设定那几块，
 * 而模型真要看某一篇时，手上有 pinax_document_read 可以按需取（面板与上下文同源，同一份文件服务）。
 * 两条如实的限制写在这里，不假装覆盖面比这更大：
 *   1) 只看目录一级（资料/ 下的子目录会被记账跳过，文件服务当前不提供更深的列举）；
 *   2) 一次最多碰 REFERENCE_READ_LIMIT 个文件，超了记账，不静默丢篇目。
 */
const REFERENCE_DIR = '资料'
const TEXT_FILE_PATTERN = /\.(?:md|txt)$/iu
/** 一次读回最多碰多少个资料文件：与内核列工具的 limit 上限（1000）同档但更保守，超了记账。 */
const REFERENCE_READ_LIMIT = 200
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createReferenceBlocks(context = {}) {
  const pluginId = context.pluginId ?? REFERENCE_CARRIER_ID
  const fileService = context.fileService ?? null

  return {
    references: () => referenceManifestBlock({ pluginId, fileService })
  }
}

async function referenceManifestBlock({ pluginId, fileService }) {
  if (!fileService) {
    return { blocks: [], warnings: [`资料载体 ${pluginId} 未绑定项目文件服务，reference 块缺席。`] }
  }
  const listed = await fileService.list({ pluginId, dir: REFERENCE_DIR })
  if (!listed.ok) return { blocks: [], warnings: [`reference 块未取得：${listed.error.message}`] }

  const warnings = []
  const directories = listed.value.entries.filter((entry) => entry.kind === 'dir')
  if (directories.length) {
    warnings.push(`「${REFERENCE_DIR}/」下有 ${directories.length} 个子目录（${directories.slice(0, 6).map((entry) => entry.name).join(' / ')}）未递归读取：文件服务只让一级列举。`)
  }
  const names = listed.value.entries
    .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => collator.compare(a, b))

  // 字数取自真实读到的文本（不是估的）；只借长度，正文本身不进块。
  const entries = []
  for (const name of names.slice(0, REFERENCE_READ_LIMIT)) {
    const read = await fileService.read({ pluginId, dir: REFERENCE_DIR, file: name })
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
    warnings.push(`「${REFERENCE_DIR}/」有 ${names.length} 个文件，本次只收了前 ${REFERENCE_READ_LIMIT} 个（上限 ${REFERENCE_READ_LIMIT}）。`)
  }
  if (!entries.length) {
    if (!warnings.length) warnings.push(`「${REFERENCE_DIR}/」没有可读的 .md/.txt 资料。`)
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

/** 资料载体提供的上下文块种类（与清单 context.providers 一致）。 */
export const REFERENCE_CONTEXT_KINDS = Object.freeze(['references'])

export default createReferenceBlocks
