import { SCRIPT_CARRIER_ID } from './manifest.mjs'

/**
 * 剧本载体的上下文块构建器（批次26 的素材侧）。
 * 与小说／资料载体同一套约定：`createScriptBlocks(projectCtx)` 返回 `{ kind: async (askCtx) => 素材包 }`，
 * 素材包 = { blocks:[{kind, content, sourceRefs}], warnings:[] }；读不到只记账，不硬失败。
 * 读盘一律走文件服务并带自己的 pluginId——「剧本」这个目录的读权限是这块板块在清单里申请的
 * （file:剧本:rw，写半边给 pinax_script_save），运行时自己没有。
 *
 * 只交「目录清单」这一块：篇名＋字数（照资料载体的 references 惯例），正文不放进上下文。
 * 理由：剧本动辄整集，把正文整段塞进信封会挤掉约束与设定那几块；模型真要读某一篇时，
 * 手上有 pinax_script_read 可以按需取（面板与上下文同源，同一份文件服务）。
 *
 * 两个块种类名指向同一份清单，各有用途：
 *   script      —— 本载体的原生种类名（清单 context.providers 里声明的那个）；
 *   references  —— shared/agentContextProfiles.js 的档案块表里有这个种类（authoring-knowledge 等
 *                  只读档案都含它），所以剧本当主载体时信封组装拿得到素材。档案表里没有 script，
 *                  原生那一块在组装时会被如实忽略（一条 warning，不静默）；
 *                  等共享档案表收下 script，删掉这一行别名即可，清单与工具都不用动。
 * 两条如实的限制与资料载体一致：只看目录一级（子目录记账跳过）、一次最多碰 200 个文件。
 */
const SCRIPT_DIR = '剧本'
const MARKDOWN_FILE_PATTERN = /\.md$/iu
const SCRIPT_READ_LIMIT = 200
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createScriptBlocks(context = {}) {
  const pluginId = context.pluginId ?? SCRIPT_CARRIER_ID
  const fileService = context.fileService ?? null

  const build = () => scriptCatalogBlock({ pluginId, fileService })
  return { script: build, references: build }
}

async function scriptCatalogBlock({ pluginId, fileService }) {
  if (!fileService) {
    return { blocks: [], warnings: [`剧本载体 ${pluginId} 未绑定项目文件服务，script 块缺席。`] }
  }
  const listed = await fileService.list({ pluginId, dir: SCRIPT_DIR })
  if (!listed.ok) return { blocks: [], warnings: [`script 块未取得：${listed.error.message}`] }

  const warnings = []
  const directories = listed.value.entries.filter((entry) => entry.kind === 'dir')
  if (directories.length) {
    warnings.push(`「${SCRIPT_DIR}/」下有 ${directories.length} 个子目录（${directories.slice(0, 6).map((entry) => entry.name).join(' / ')}）未递归读取：文件服务只让一级列举。`)
  }
  const names = listed.value.entries
    .filter((entry) => entry.kind === 'file' && MARKDOWN_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => collator.compare(a, b))

  // 字数取自真实读到的文本（不是估的）；只借长度，正文本身不进块。
  const entries = []
  for (const name of names.slice(0, SCRIPT_READ_LIMIT)) {
    const read = await fileService.read({ pluginId, dir: SCRIPT_DIR, file: name })
    if (!read.ok) {
      warnings.push(`剧本「${name}」读失败：${read.error.message}`)
      continue
    }
    entries.push({
      name: name.replace(MARKDOWN_FILE_PATTERN, ''),
      file: read.value.relativePath,
      chars: read.value.text.length
    })
  }
  if (names.length > SCRIPT_READ_LIMIT) {
    warnings.push(`「${SCRIPT_DIR}/」有 ${names.length} 个文件，本次只收了前 ${SCRIPT_READ_LIMIT} 个（上限 ${SCRIPT_READ_LIMIT}）。`)
  }
  if (!entries.length) {
    if (!warnings.length) warnings.push(`「${SCRIPT_DIR}/」没有可读的 .md 剧本。`)
    return { blocks: [], warnings }
  }

  const lines = entries.map((entry, index) => `${index + 1}. ${entry.name} —— ${entry.chars} 字（${entry.file}）`)
  return {
    blocks: [{
      kind: 'script',
      content: `# 剧本目录（只列篇目与字数，正文未放进上下文；要看某一篇请用 pinax_script_read）\n${lines.join('\n')}`,
      sourceRefs: entries.slice(0, 32).map((entry) => `script-scenes:${entry.file}`)
    }],
    warnings
  }
}

/** 剧本载体可提供的上下文块种类（与清单 context.providers 一致）。 */
export const SCRIPT_CONTEXT_KINDS = Object.freeze(['script', 'references'])

export default createScriptBlocks
