import { fail, ok } from '../../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../../fs/projectPath.mjs'
import { SETTING_CARRIER, SETTING_CARRIER_ID } from './manifest.mjs'

/**
 * 设定载体的工具实现（M2 批次 1 的第二块板块；工单E2 起带自有写入口；协议 v1.1-A 起只剩约束）。
 * 世界书三把（list/read/save，含批次21 C 的 meta 元数据口）已随目录迁去 next/carriers/worldbook/tools.mjs。
 * 约束（工单E2）：约束/ 申请 rw，按构思速记的同一套模式补最小编辑面——
 * pinax_rule_list 列篇目并把全文随手带回（单篇超 20000 字截断并标注），
 * pinax_rule_save 是它的写入口（expectedRevision 乐观并发，空 text 与非 .md 拒）。
 * 两把都是载体自有名字（内核只有 pinax_rule_write，不认领）；返回形状与构思那对一致。
 */
const MAX_TEXT_CHARS = 200_000
const RULES_DIR = SETTING_CARRIER.dataDirs.constraints
/** 约束列表随篇带回正文的上限（与构思速记的 pinax_notes_list 同一档）；超出截断并在条目上标注。 */
const RULE_LIST_TEXT_CHARS = 20_000
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createSettingTools(context = {}) {
  const pluginId = context.pluginId ?? SETTING_CARRIER_ID
  const fileService = context.fileService ?? null
  const root = context.root ?? fileService?.root ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /** 本地化轨的硬口径：这块板块只服务当前打开的 Next 项目，不接受第二个项目路径。 */
  function checkProjectRef(args) {
    const given = typeof args?.projectPath === 'string' ? args.projectPath.trim() : ''
    if (!given) return null
    const current = normalizeProjectRoot(root)
    if (!current) {
      return fail('INVALID_INPUT', `设定载体 ${pluginId} 没有项目根：请先打开一个含 .pinax/project.json 的本地文件夹`, { projectPath: given })
    }
    // 归一与比较用 next/fs 的同一份实现：载体与运行时写族闸判「是不是当前这个项目」必须同一条规矩。
    if (!isSameProjectRoot(given, current)) {
      return fail('INVALID_INPUT', `设定载体只服务当前打开的 Next 项目（${current}），不读别的项目路径`, {
        projectPath: given,
        currentRoot: current
      })
    }
    return null
  }

  /** 约束目录＝规则序列：与构思速记的 listNotes 同一个列法（文件名排序，正文随条目带回，
   *  单篇超长截断并标注；保存是覆盖式，截断时别整篇回写）。 */
  async function listRules() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: RULES_DIR })
    if (!listed.ok) return listed
    const names = listed.value.entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const rules = []
    for (const name of names) {
      const relativePath = `${RULES_DIR}/${name}`
      const read = await fileService.read({ pluginId, dir: RULES_DIR, file: name })
      rules.push({
        index: rules.length,
        title: name.replace(/\.md$/iu, ''),
        file: relativePath,
        name,
        revision: read.ok ? read.value.revision : await fileService.revisionOf(relativePath),
        text: read.ok ? read.value.text.slice(0, RULE_LIST_TEXT_CHARS) : '',
        totalChars: read.ok ? read.value.text.length : 0,
        truncated: read.ok ? read.value.text.length > RULE_LIST_TEXT_CHARS : false
      })
    }
    return ok({ rules, total: rules.length })
  }

  return [
    {
      name: 'pinax_rule_list',
      title: '列出约束（设定载体）',
      description: '按「约束/」文件名排序列出约束文件（序号、标题、相对路径、修订号），并把全文一并带回——约束是短文本，省一次单独的读取；单篇超过 20000 字时截断并在条目上标注，不谎报读全了。只读，不改任何文件。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectPath: { type: 'string', maxLength: 240, description: '当前项目根路径；与打开的项目不一致时直接拒绝，绝不换目录读。' },
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多返回多少篇，默认 200。' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const rejected = checkProjectRef(args)
        if (rejected) return rejected
        const limit = args.limit === undefined ? 200 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          return fail('INVALID_INPUT', 'limit 须是 1–500 的整数', { got: args.limit })
        }
        const all = await listRules()
        if (!all.ok) return all
        return ok({
          total: all.value.total,
          truncated: all.value.total > limit,
          projectRoot: root,
          rules: all.value.rules.slice(0, limit)
        })
      }
    },
    {
      name: 'pinax_rule_save',
      title: '保存约束（设定载体）',
      description: '作者确认后的约束落盘口：新建传 expectedRevision 0；改稿必须带回 pinax_rule_list 给的修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。写 约束/ 走文件服务三道闸（归属＋file:约束:rw＋并发）；文件名必须是 .md。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedRevision'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（约束/ 下），与 title 二选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '新建约束用标题，落成「约束/<标题>.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: '整篇内容（覆盖式保存，故必须带修订号）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'pinax_rule_list 给的修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const rejected = checkProjectRef(args)
        if (rejected) return rejected
        if (typeof args.text !== 'string' || !args.text.length) return fail('INVALID_INPUT', 'text 必填且非空')
        if (args.text.length > MAX_TEXT_CHARS) return fail('INVALID_INPUT', `text 超出单篇上限 ${MAX_TEXT_CHARS} 字符`, { got: args.text.length })
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 pinax_rule_list 给的修订号')
        }
        const target = args.file ?? ruleFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（约束/ 下的相对路径）或 title（新建约束标题）')
        const relative = toDirRelative(RULES_DIR, target)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '约束文件名必须以 .md 结尾', { file: target })

        const written = await fileService.write({ pluginId, dir: RULES_DIR, file: relative, text: args.text, expectedRevision: args.expectedRevision })
        if (!written.ok) return written
        return ok({
          file: written.value.relativePath,
          revision: written.value.revision,
          created: args.expectedRevision === 0,
          sha256: written.value.sha256,
          bytes: written.value.bytes
        })
      }
    }
  ]
}

/** 作者给的是「约束/xxx.md」还是「xxx.md」都接得住：文件服务那侧的入参是板块目录内的相对路径。 */
function toDirRelative(dir, path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 标题→文件名：与小说载体的 chapterFileNameFromTitle 同一套规则（非法字符与控制字符换空格）。 */
function ruleFileNameFromTitle(title) {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 120)
  if (!cleaned) return null
  return /\.md$/iu.test(cleaned) ? cleaned : `${cleaned}.md`
}

/** 设定板块的工具名（约束这对，均为载体自有名字）；供门禁核「认领面只增不减」。 */
export const SETTING_TOOL_NAMES = Object.freeze(['pinax_rule_list', 'pinax_rule_save'])

export default createSettingTools
