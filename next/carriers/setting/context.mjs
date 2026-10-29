import { SETTING_CARRIER_ID } from './manifest.mjs'

/**
 * 设定载体的上下文块构建器（M2 · WP3 的素材侧；协议 v1.1-A 起只剩 rules/style 两块）。
 * 与小说载体同一套约定：`createSettingBlocks(projectCtx)` 返回 `{ kind: async (askCtx) => 素材包 }`，
 * 素材包 = { blocks:[{kind, content, sourceRefs}], warnings:[] }；读不到只记账，不硬失败。
 * 读盘一律走文件服务并带自己的 pluginId——「约束」目录的读权限是这块板块在清单里申请来的
 * （file:约束:rw，工单E2 起写半边也归它），运行时自己没有。
 * 世界书块与它的取数口 readSettingEntries 已随协议 v1.1-A 迁去 next/carriers/worldbook/context.mjs。
 * 两条如实的限制写在这里，不假装覆盖面比这更大：
 *   1) 只看目录一级（约束/ 下的子目录不会被递归列举，文件服务当前不提供更深的列举）；
 *   2) 单条字符上限是硬闸，超了在块里写明「已截断，原文 N 字」，绝不悄悄丢字。
 */
const SETTING_DIRS = Object.freeze({ constraints: '约束' })
const RULE_FILE_LIMIT = 8
const RULE_CHAR_CAP = 6000
const STYLE_NAME_PATTERN = /(文风|风格|笔法|语感|腔调)/u
const TEXT_FILE_PATTERN = /\.(?:md|txt)$/iu

export const SETTING_CONTEXT_KINDS = Object.freeze(['rules', 'style'])

export function createSettingBlocks(context = {}) {
  const pluginId = context.pluginId ?? SETTING_CARRIER_ID
  const fileService = context.fileService ?? null

  const readers = {
    rules: () => constraintBlocks({ pluginId, fileService, kinds: ['rules'], excludeStyle: true, cap: RULE_CHAR_CAP, limit: RULE_FILE_LIMIT }),
    style: () => constraintBlocks({ pluginId, fileService, kinds: ['style'], onlyStyle: true, cap: RULE_CHAR_CAP, limit: RULE_FILE_LIMIT })
  }
  return readers
}

/** 「约束/」是作者手写自由区：文件名里带文风字样的进 style 块，其余进 rules 块。 */
async function constraintBlocks({ pluginId, fileService, kinds, excludeStyle = false, onlyStyle = false, cap, limit }) {
  const kind = kinds[0]
  if (!fileService) return { blocks: [], warnings: [`设定载体 ${pluginId} 未绑定项目文件服务，${kind} 块缺席。`] }
  const listed = await fileService.list({ pluginId, dir: SETTING_DIRS.constraints })
  if (!listed.ok) return { blocks: [], warnings: [`${kind} 块未取得：${listed.error.message}`] }
  const names = listed.value.entries
    .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    .map((entry) => entry.name)
    .filter((name) => (onlyStyle ? STYLE_NAME_PATTERN.test(name) : excludeStyle ? !STYLE_NAME_PATTERN.test(name) : true))

  const warnings = []
  const blocks = []
  for (const name of names.slice(0, limit)) {
    const read = await fileService.read({ pluginId, dir: SETTING_DIRS.constraints, file: name })
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
  if (!blocks.length && !warnings.length) warnings.push(`「${SETTING_DIRS.constraints}/」${onlyStyle ? '没有文风类文件' : '没有可读的约束文件'}。`)
  return { blocks, warnings }
}

export default createSettingBlocks
