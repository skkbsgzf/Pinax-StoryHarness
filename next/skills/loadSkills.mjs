import { readFile, readdir, writeFile, mkdir, rename, cp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * 技能包加载器（M2.5-B · 任务一）。
 *
 * 只做三件事，别让它长成第二个插件系统：
 *   1) 解析 SKILL.md 的 frontmatter（name / description / tools / output / domain / kind）；
 *   2) 校验 tools 全在当前工具面上——少一把就**不装载**并记账，绝不虚列一个点了会炸的方法；
 *   3) 把 name/description 排成给系统提示的一行清单（渐进披露：正文只在 pinax_skill_read 时才展开）。
 *
 * 目录约定：next/skills/<name>/SKILL.md，name 必须与目录同名（两套名字会让「调哪份」不可判定）。
 * 技能是**方法说明书**，不是入口：入口仍是 slash 命令与自然语言提问。
 *
 * 批次77 任务5 加的两件事都在「装载」这一层，不长到界面里去：
 *   · `domain`（适用任务域）与 `kind: style`（风格包）进 frontmatter 合同——缺 domain 不报错（未分域），非法值才拒；
 *   · 项目内 `.pinax/skills.json` 存启停真值（**不写全局设置**），随包那份技能关掉就从装载清单里剔除；
 *     作者自己导进来的包落在 `.pinax/skills/`，与随包目录一起扫，同名时随包那份赢（项目里那份不覆盖官方方法）。
 */
export const SKILL_FILE = 'SKILL.md'
export const SKILL_OUTPUTS = Object.freeze(['proposal', 'checklist'])
/** 适用任务域词表（批次77 任务5 的作者裁定四选一）；词表外的值＝拒装，缺这一行＝未分域（向后兼容）。 */
export const SKILL_DOMAINS = Object.freeze(['screenwriting', 'prose', 'worldbook', 'acceptance'])
export const SKILL_DOMAIN_LABELS = Object.freeze({
  screenwriting: '编剧',
  prose: '正文写作',
  worldbook: '世界书整理',
  acceptance: '审阅验收'
})
/** 没有 `domain` 这一行时的中文归处。它不是第五个域，是「作者还没分类」这一事实的如实说法。 */
export const SKILL_UNDOMAINED_LABEL = '未分域'
/** `kind` 词表：今天只有「风格」。技能与方法是两件事，风格包不是方法说明书，别混在一列里。 */
export const SKILL_KINDS = Object.freeze(['style'])
export const SKILL_KIND_LABELS = Object.freeze({ style: '风格' })
/** 启停真值的落点：项目内 `.pinax/skills.json`（与 workspace.json／hotkeys.json 同一族，不写全局偏好）。 */
export const SKILL_PREFS_DIR = '.pinax'
export const SKILL_PREFS_FILENAME = 'skills.json'
export const SKILL_PREFS_VERSION = 1
/** 作者导入的技能包落点：`.pinax/skills/<名字>/SKILL.md`。 */
export const SKILL_IMPORT_DIRNAME = 'skills'
/** 源码轨（开发态）的技能目录：next/skills/ 自身。打包后这个常量指向 bundle 目录，不能直接拿来用。 */
export const DEFAULT_SKILLS_DIR = fileURLToPath(new URL('./', import.meta.url))

/** 这个目录里至少有一个子目录带 SKILL.md 才算「技能目录」（空目录／别的东西不算）。 */
async function hasSkillDirectories(dir) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await readFile(join(dir, entry.name, SKILL_FILE), 'utf-8')
      return true
    } catch {
      // 这个子目录不是技能包，继续看下一个。
    }
  }
  return false
}

/**
 * 技能目录的落点解析（批次37 · 任务三）。
 *
 * 为什么要解析：loadSkills 在打包后的**外壳 bundle 里**运行（next/.build/pinax-next-shell-main.mjs），
 * `import.meta.url` 指向 bundle 文件本身——`./` 就成了 next/.build/，而技能源码在 next/skills/。
 * 于是装机后技能清单永远是空的（M2.5-B 已记账的欠账）。
 *
 * 三个候选，按顺序：
 *   1) PINAX_NEXT_SKILLS_DIR（验收／自定安装位用，显式覆盖优先）；
 *   2) <模块目录>/skills —— 装机轨：构建期把 next/skills/ 拷到 next/.build/skills/；
 *   3) <模块目录> 自身 —— 开发轨：模块就是 next/skills/loadSkills.mjs；
 *   4) <模块目录>/../skills —— 模块被再嵌一层时（如 .build/xxx/）的回退。
 * 找不到任何一个带 SKILL.md 的目录时返回第一个候选，让 readdir 的失败如实进 rejected。
 */
export async function resolveSkillsDir({ env = process.env, moduleDir = DEFAULT_SKILLS_DIR } = {}) {
  const candidates = [
    typeof env?.PINAX_NEXT_SKILLS_DIR === 'string' && env.PINAX_NEXT_SKILLS_DIR.trim()
      ? env.PINAX_NEXT_SKILLS_DIR.trim()
      : null,
    join(moduleDir, 'skills'),
    moduleDir,
    join(moduleDir, '..', 'skills')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await hasSkillDirectories(candidate)) return candidate
  }
  return candidates[0]
}

function unquote(value) {
  const text = String(value ?? '').trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

/** 数组既认 `tools: [a, b]` 也认换行块 `tools:\n  - a\n  - b`。 */
function parseArray(rawLines, startIndex) {
  const inline = rawLines[startIndex].slice(rawLines[startIndex].indexOf(':') + 1).trim()
  if (inline.startsWith('[')) {
    const inner = inline.replace(/^\[/u, '').replace(/\]$/u, '')
    return {
      value: inner.split(',').map((item) => unquote(item)).filter(Boolean),
      consumed: 0
    }
  }
  if (inline) return { value: [unquote(inline)], consumed: 0 }
  const items = []
  let index = startIndex + 1
  while (index < rawLines.length && /^\s*-\s+/u.test(rawLines[index])) {
    items.push(unquote(rawLines[index].replace(/^\s*-\s+/u, '')))
    index += 1
  }
  return { value: items.filter(Boolean), consumed: index - startIndex - 1 }
}

/**
 * @returns {{ ok: true, value: { name, description, tools, output, domain, kind, body, dir } } | { ok: false, error: { code, message } }}
 */
export function parseSkillMarkdown(markdown, { dir = '', nameHint = '' } = {}) {
  const text = String(markdown ?? '').replace(/^\uFEFF/u, '')
  const lines = text.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') {
    return { ok: false, error: { code: 'SKILL_FRONTMATTER_MISSING', message: 'SKILL.md 必须以 --- 开头的 frontmatter 开始' } }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) {
    return { ok: false, error: { code: 'SKILL_FRONTMATTER_UNCLOSED', message: 'frontmatter 没有闭合的 ---' } }
  }
  const head = lines.slice(1, end)
  const meta = {}
  for (let index = 0; index < head.length; index += 1) {
    const line = head[index]
    if (!line.trim() || /^\s*#/u.test(line)) continue
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/u.exec(line)
    if (!match) continue
    const key = match[1]
    const inline = match[2]
    if (key === 'tools') {
      const parsed = parseArray(head, index)
      meta.tools = parsed.value
      index += parsed.consumed
      continue
    }
    if (key === 'provides' || key === 'requires') {
      const parsed = parseArray(head, index)
      meta[key] = parsed.value
      index += parsed.consumed
      continue
    }
    meta[key] = unquote(inline)
  }

  const name = String(meta.name ?? '').trim() || nameHint
  const description = String(meta.description ?? '').trim()
  const tools = Array.isArray(meta.tools) ? meta.tools.map((item) => String(item).trim()).filter(Boolean) : []
  const output = String(meta.output ?? '').trim()
  // domain／kind 都是「可缺不可错」：缺＝归到未分域／普通方法（老的包不改也能装），
  // 写了但不在词表里＝拒装并说清词表是哪几个——静默归一会让作者以为分过类了。
  const domain = String(meta.domain ?? '').trim()
  const kind = String(meta.kind ?? '').trim()
  const body = lines.slice(end + 1).join('\n').trim()

  if (!name) return { ok: false, error: { code: 'SKILL_NAME_REQUIRED', message: 'frontmatter 缺 name' } }
  if (nameHint && name !== nameHint) {
    return { ok: false, error: { code: 'SKILL_NAME_MISMATCH', message: `name「${name}」与目录「${nameHint}」不一致` } }
  }
  if (!description) return { ok: false, error: { code: 'SKILL_DESCRIPTION_REQUIRED', message: `技能 ${name} 缺 description（系统提示只靠这一句认出它）` } }
  if (!tools.length) return { ok: false, error: { code: 'SKILL_TOOLS_REQUIRED', message: `技能 ${name} 的 tools 为空：没有方法落点的技能不装载` } }
  if (!SKILL_OUTPUTS.includes(output)) {
    return { ok: false, error: { code: 'SKILL_OUTPUT_INVALID', message: `技能 ${name} 的 output 必须是 ${SKILL_OUTPUTS.join(' / ')}` } }
  }
  if (domain && !SKILL_DOMAINS.includes(domain)) {
    return {
      ok: false,
      error: {
        code: 'SKILL_DOMAIN_INVALID',
        message: `技能 ${name} 的 domain「${domain}」不在词表里：可写 ${SKILL_DOMAINS.join(' / ')}（中文依次 ${SKILL_DOMAINS.map((item) => SKILL_DOMAIN_LABELS[item]).join(' / ')}）；不写这一行就是「${SKILL_UNDOMAINED_LABEL}」`
      }
    }
  }
  if (kind && !SKILL_KINDS.includes(kind)) {
    return {
      ok: false,
      error: {
        code: 'SKILL_KIND_INVALID',
        message: `技能 ${name} 的 kind「${kind}」不在词表里：可写 ${SKILL_KINDS.join(' / ')}（${SKILL_KINDS.map((item) => SKILL_KIND_LABELS[item]).join(' / ')}）；不写这一行就是普通方法说明书`
      }
    }
  }
  if (!body) return { ok: false, error: { code: 'SKILL_BODY_REQUIRED', message: `技能 ${name} 只有 frontmatter 没有正文` } }
  return { ok: true, value: { name, description, tools, output, domain, kind, body, dir } }
}

/**
 * 装载技能。`availableTools` 是这一刻工具面上的名字（含 pinax_skill_read 自己）。
 * 两个来源一起扫（批次77 任务5）：
 *   · 随包目录（`dir` 或按模块目录解析出来的 next/skills、.build/skills）；
 *   · 当前项目 `.pinax/skills/`（作者导入的那一层）。同名时**随包那份赢**——导入不该覆盖官方方法，
 *     被让位的那一条如实记进 rejected，设置面看得见原因。
 * 启停真值读项目内 `.pinax/skills.json`（显式传 `disabled` 时以它为准，给单测与诊断留口）。
 * 返回 { skills, disabledSkills, rejected, disabled, layers }：
 *   skills        ＝ 能装 ∧ 没关（进系统提示与 pinax_skill_read 的那一份）；
 *   disabledSkills＝ 能装但被作者关掉的那几条（**设置面要列得出来**，不然「停用」等于「消失」）；
 *   rejected      ＝ 装不上的每一条约 { dir, code, message, origin }（守卫⑪：原因必须看得见）；
 *   layers        ＝ 扫了哪两层目录、各自在不在（`exists:false` 是常态：没导入过就没有 .pinax/skills/）。
 */
export async function loadSkills({ dir = null, availableTools = [], projectRoot = null, disabled = null } = {}) {
  // 不传 dir 就按「开发轨／装机轨」解析（批次37）：打包后模块目录是 next/.build/，
  // 技能跟着拷到 .build/skills/；源码轨则直接是 next/skills/。
  const skillsDir = dir ?? await resolveSkillsDir()
  const onSurface = new Set((Array.isArray(availableTools) ? availableTools : []).map((name) => String(name)))
  const root = String(projectRoot ?? '').trim() || null
  const off = Array.isArray(disabled)
    ? normalizeDisabledNames(disabled)
    : (root ? readSkillPreferencesSync(root).disabled : [])

  const layerSpecs = [{ dir: skillsDir, origin: SKILL_ORIGINS.builtIn }]
  if (root) layerSpecs.push({ dir: join(root, SKILL_PREFS_DIR, SKILL_IMPORT_DIRNAME), origin: SKILL_ORIGINS.project })
  const rejected = []
  const collected = []
  const layers = []
  for (const layer of layerSpecs) {
    const read = await readSkillLayer(layer.dir, { onSurface, origin: layer.origin })
    layers.push({ ...layer, exists: read.exists })
    collected.push(...read.skills)
    rejected.push(...read.rejected)
  }

  // 同名仲裁：随包在前，项目层让位。让位那条必须记账——作者导进来一个同名包却屏上没变化，
  // 不写原因就只能靠猜。
  const seen = new Set()
  const named = []
  for (const skill of collected) {
    if (seen.has(skill.name)) {
      rejected.push({
        dir: skill.dir,
        origin: skill.origin,
        code: 'SKILL_NAME_DUPLICATE',
        message: `技能 ${skill.name} 已有一份随包的，${SKILL_ORIGIN_LABELS[skill.origin] ?? skill.origin}里那一份不覆盖官方方法`
      })
      continue
    }
    seen.add(skill.name)
    named.push(skill)
  }

  const enabled = []
  const disabledSkills = []
  for (const skill of named) {
    if (off.includes(skill.name)) disabledSkills.push(skill)
    else enabled.push(skill)
  }
  return { skills: enabled, disabledSkills, rejected, disabled: off, layers }
}

/**
 * 扫一层技能目录。目录不存在是常态（没导入过就没有 `.pinax/skills/`），ENOENT 如实标 exists:false、不记成拒装；
 * 其它读不动的错误照旧进 rejected——「扫不到」与「扫到但装不上」是两件事，不能混成一堆噪音。
 */
async function readSkillLayer(skillsDir, { onSurface, origin }) {
  const skills = []
  const rejected = []
  let entries = []
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return { skills, rejected, exists: false }
    return { skills, rejected: [{ dir: skillsDir, origin, code: 'SKILLS_DIR_UNREADABLE', message: String(error?.message || error) }], exists: false }
  }
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  for (const name of directories) {
    let markdown = ''
    try {
      markdown = await readFile(join(skillsDir, name, SKILL_FILE), 'utf-8')
    } catch {
      rejected.push({ dir: name, origin, code: 'SKILL_FILE_MISSING', message: `${name}/${SKILL_FILE} 不存在` })
      continue
    }
    const parsed = parseSkillMarkdown(markdown, { dir: name, nameHint: name })
    if (!parsed.ok) {
      rejected.push({ dir: name, origin, ...parsed.error })
      continue
    }
    const missing = parsed.value.tools.filter((tool) => !onSurface.has(tool))
    if (missing.length) {
      rejected.push({
        dir: name,
        origin,
        code: 'SKILL_TOOLS_NOT_ON_SURFACE',
        message: `技能 ${name} 声明的工具不在当前面上：${missing.join('、')}`
      })
      continue
    }
    skills.push({ ...parsed.value, origin })
  }
  return { skills, rejected, exists: true }
}

/**
 * 系统提示里的可用技能清单：一行一个，只有名字与一句话。
 * 不注入正文——正文走 pinax_skill_read，这就是渐进披露的那道闸。
 */
export function skillCatalogLines(skills = []) {
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => `- ${skill.name}：${skill.description}（产物：${skill.output}）`)
}

export function findSkill(skills = [], name = '') {
  const key = String(name ?? '').trim()
  if (!key) return null
  return (Array.isArray(skills) ? skills : []).find((skill) => skill.name === key) ?? null
}

/** 正文展开：未知技能如实报错，不做模糊匹配。 */
export function readSkillBody(skills = [], name = '') {
  const skill = findSkill(skills, name)
  if (!skill) {
    return {
      ok: false,
      error: { code: 'SKILL_NOT_FOUND', message: `没有这个技能：${String(name ?? '') || '(空)'}；可用技能见清单` }
    }
  }
  return {
    ok: true,
    value: {
      name: skill.name,
      description: skill.description,
      tools: [...skill.tools],
      output: skill.output,
      domain: skill.domain ?? '',
      kind: skill.kind ?? '',
      body: skill.body
    }
  }
}

/* ————————————————— 启停真值：项目内 .pinax/skills.json（批次77 任务5） ————————————————— */

export const SKILL_ORIGINS = Object.freeze({ builtIn: 'built-in', project: 'project' })
export const SKILL_ORIGIN_LABELS = Object.freeze({ 'built-in': '随包', project: '项目导入' })

/** 中文域名（界面只读这一句，不在组件里各写一份对照表）。 */
export function skillDomainLabel(domain) {
  return SKILL_DOMAIN_LABELS[String(domain ?? '').trim()] ?? SKILL_UNDOMAINED_LABEL
}

/** 关掉的那份清单：只认字符串名字，去重、去空。`skills.json` 是作者能手改的文件，脏值不许把装载打断。 */
export function normalizeDisabledNames(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  for (const item of list) {
    const name = String(item ?? '').trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

export function skillPreferencesPath(root) {
  return join(String(root ?? ''), SKILL_PREFS_DIR, SKILL_PREFS_FILENAME)
}

/** 作者导入的技能包落点（项目内，随项目走）。 */
export function projectSkillsDir(root) {
  return join(String(root ?? ''), SKILL_PREFS_DIR, SKILL_IMPORT_DIRNAME)
}

function emptyPreferences(exists) {
  return { version: SKILL_PREFS_VERSION, disabled: [], warnings: [], exists }
}

function parsePreferences(raw) {
  if (!raw || !raw.trim()) return emptyPreferences(true)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // eslint-disable-next-line no-console -- 主进程没有渲染层可报；坏档必须留痕，但照常按「全部启用」装载
    console.error('[pinax-next] .pinax/skills.json 不是合法 JSON：按「全部启用」继续（下次保存整份重写）')
    return { ...emptyPreferences(true), warnings: ['SKILLS_PREFS_BAD_JSON'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // eslint-disable-next-line no-console -- 同上
    console.error('[pinax-next] .pinax/skills.json 根不是对象：按「全部启用」继续')
    return { ...emptyPreferences(true), warnings: ['SKILLS_PREFS_NOT_OBJECT'] }
  }
  const warnings = []
  if (parsed.version !== SKILL_PREFS_VERSION) warnings.push(`SKILLS_PREFS_VERSION_${String(parsed.version)}`)
  if (parsed.disabled !== undefined && parsed.disabled !== null && !Array.isArray(parsed.disabled)) {
    warnings.push('SKILLS_PREFS_DISABLED_NOT_ARRAY')
  }
  return { version: SKILL_PREFS_VERSION, disabled: normalizeDisabledNames(parsed.disabled), warnings, exists: true }
}

/**
 * 同步读启停表：装载路径（createRuntimeSurface 装配那一次）与 advisor（每一问）都读这一个口。
 * 与 readCarrierOverridesSync 同一取舍——坏档回「全部启用」并记账，绝不抛错打断整条链。
 * 没有项目根＝没有启停概念（启停按项目存），回一份空表，不猜、不落盘。
 */
export function readSkillPreferencesSync(root) {
  if (!root) return emptyPreferences(false)
  try {
    return parsePreferences(readFileSync(skillPreferencesPath(root), 'utf-8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyPreferences(false)
    return { ...emptyPreferences(false), warnings: [`SKILLS_PREFS_READ_FAILED_${String(error?.code ?? 'UNKNOWN')}`] }
  }
}

/**
 * 清单里挑出没关的那些（装载层与 advisor 共用这一个谓词，不长第二套判定）。
 * 没给关闭名单时原样返回同一批引用之外的新数组——advisor 那份 catalog 是快照，别把它的数组改出副作用。
 */
export function enabledSkillList(list = [], disabledNames = []) {
  const source = Array.isArray(list) ? list : []
  const off = normalizeDisabledNames(disabledNames)
  if (!off.length) return [...source]
  return source.filter((skill) => !off.includes(String(skill?.name ?? '')))
}

/** 整份序列化（缩进两份；读盘与写盘共用，否则「内容没变不写」永远命不中）。 */
function serializePreferences(disabled) {
  return JSON.stringify({ version: SKILL_PREFS_VERSION, disabled: normalizeDisabledNames(disabled) }, null, 2)
}

export function skillsFail(code, message, details) {
  const error = { code: `PINAX_${code}`, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

/**
 * 启停表存储：三条硬规矩照抄 carrierOverridesStore（坏文件不崩不覆盖、`.tmp` ＋同目录 rename、内容没变不写）。
 * 文件系统可注入（单测喂假 fs），缺省 node:fs/promises。
 */
export function createFileSkillPreferencesStore({ root, fs = { readFile, writeFile, mkdir, rename } } = {}) {
  if (!root) throw new Error('createFileSkillPreferencesStore 需要项目根')
  const file = skillPreferencesPath(root)
  const tmpFile = `${file}.tmp`
  let queue = Promise.resolve()
  let lastWritten = null

  async function read() {
    try {
      const raw = await fs.readFile(file, 'utf-8')
      const value = parsePreferences(raw)
      lastWritten = serializePreferences(value.disabled)
      return { ok: true, value }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, value: emptyPreferences(false) }
      return { ok: true, value: { ...emptyPreferences(false), warnings: [`SKILLS_PREFS_READ_FAILED_${String(error?.code ?? 'UNKNOWN')}`] } }
    }
  }

  async function persist(disabled) {
    const text = serializePreferences(disabled)
    if (lastWritten === text) return { ok: true, value: { file, skipped: true, disabled: normalizeDisabledNames(disabled) } }
    try {
      await fs.mkdir(join(String(root), SKILL_PREFS_DIR), { recursive: true })
      await fs.writeFile(tmpFile, text, 'utf-8')
      await fs.rename(tmpFile, file)
      lastWritten = text
      return { ok: true, value: { file, skipped: false, bytes: Buffer.byteLength(text), disabled: normalizeDisabledNames(disabled) } }
    } catch (error) {
      return skillsFail('SKILLS_PREFS_WRITE_FAILED', `技能启停写盘失败：${String(error?.message ?? error)}`)
    }
  }

  /** 单条启停：读改写都在队列里做，连着点两枚钮不会吃掉前一笔。 */
  function setDisabled(name, off) {
    const skill = String(name ?? '').trim()
    if (!skill) return Promise.resolve(skillsFail('INVALID_INPUT', '技能启停要给出技能名'))
    const task = queue.then(async () => {
      const current = await read()
      const list = normalizeDisabledNames(current.value.disabled)
      const next = off
        ? (list.includes(skill) ? list : [...list, skill])
        : list.filter((item) => item !== skill)
      const written = await persist(next)
      return written.ok ? { ...written, value: { ...written.value, name: skill, enabled: !off } } : written
    })
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  /** 整份替换（诊断与恢复用）：形状不过就是一个字节都不写。 */
  function write(disabled) {
    if (disabled !== undefined && disabled !== null && !Array.isArray(disabled)) {
      return Promise.resolve(skillsFail('INVALID_INPUT', '技能启停清单必须是数组'))
    }
    const task = queue.then(() => persist(disabled ?? []))
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  return { root: String(root), file, read, write, setDisabled }
}

/* ————————————————— 导入：拷进 .pinax/skills/ 后跑一遍校验 ————————————————— */

/** 目录名闸：`.pinax/skills/` 下只收一个合法的包名，路径分隔符与 `..` 一律拒——作者选错目录不该把文件写到项目外面去。 */
function safeSkillDirName(name) {
  const text = String(name ?? '').trim()
  if (!text) return null
  if (text === '.' || text === '..') return null
  if (/[\\/]/u.test(text)) return null
  if (text.length > 80) return null
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(text)) return null
  return text
}

/**
 * 导入一个技能目录（批次77 任务5 第 4 条）。
 * 源可以是「一个包」（源目录自己带 SKILL.md），也可以是「一堆包的父目录」（每个子目录一个包）。
 * 落点恒为 `<项目根>/.pinax/skills/<包名>/`；拷完就地跑一遍**结构校验**（frontmatter 合同），
 * 不合格逐条列原因——拒装是正常态，不假装成功（批次37 的既有事实）。
 * 能不能真进面是另一件事：那要看这一刻的工具面，设置页那一列会把它自己的拒装原因摊出来。
 */
export async function importSkillDirectory({ sourceDir, projectRoot, fs = { cp, readdir, readFile, mkdir } } = {}) {
  const source = String(sourceDir ?? '').trim()
  const root = String(projectRoot ?? '').trim()
  if (!source) return skillsFail('INVALID_INPUT', '导入技能要给出源目录')
  if (!root) return skillsFail('INVALID_INPUT', '导入技能需要先打开一个项目：技能包落在项目内 .pinax/skills/')
  const target = projectSkillsDir(root)

  // 源形状判定：整包一个目录，还是父目录里若干包。
  let sourceIsPackage = false
  try {
    await fs.readFile(join(source, SKILL_FILE), 'utf-8')
    sourceIsPackage = true
  } catch {
    sourceIsPackage = false
  }

  let candidates = []
  if (sourceIsPackage) {
    candidates = [{ name: safeSkillDirName(basenameOf(source)), path: source }]
  } else {
    let entries = []
    try {
      entries = await fs.readdir(source, { withFileTypes: true })
    } catch (error) {
      return skillsFail('SKILLS_SOURCE_UNREADABLE', `读不动源目录：${String(error?.message ?? error)}`, { sourceDir: source })
    }
    candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: safeSkillDirName(entry.name), path: join(source, entry.name) }))
  }
  if (!candidates.length) {
    return skillsFail('SKILLS_SOURCE_EMPTY', '这里既没有 SKILL.md，也没有带 SKILL.md 的子目录：选的是技能包目录吗？', { sourceDir: source })
  }

  const imported = []
  const rejected = []
  for (const candidate of candidates) {
    if (!candidate.name) {
      rejected.push({ dir: String(candidate.path ?? ''), code: 'SKILL_DIR_NAME_INVALID', message: '目录名不能当技能名（含路径分隔符、过长或不是名字）' })
      continue
    }
    let markdown = ''
    try {
      markdown = await fs.readFile(join(candidate.path, SKILL_FILE), 'utf-8')
    } catch {
      rejected.push({ dir: candidate.name, code: 'SKILL_FILE_MISSING', message: `${candidate.name}/${SKILL_FILE} 不存在：这一层不是技能包` })
      continue
    }
    const parsed = parseSkillMarkdown(markdown, { dir: candidate.name, nameHint: candidate.name })
    if (!parsed.ok) {
      rejected.push({ dir: candidate.name, ...parsed.error })
      continue
    }
    try {
      await fs.mkdir(target, { recursive: true })
      await fs.cp(candidate.path, join(target, candidate.name), { recursive: true })
    } catch (error) {
      rejected.push({ dir: candidate.name, code: 'SKILL_COPY_FAILED', message: `拷贝失败：${String(error?.message ?? error)}` })
      continue
    }
    imported.push({ dir: candidate.name, name: parsed.value.name, description: parsed.value.description, domain: parsed.value.domain, kind: parsed.value.kind, output: parsed.value.output })
  }
  return { ok: true, value: { source: target, imported, rejected, total: candidates.length } }
}

/** basename 不带依赖：这里只要最后一段（正斜杠与反斜杠都当分隔符，Windows 与 POSIX 都能选目录）。 */
function basenameOf(path) {
  const parts = String(path ?? '').replace(/[\\/]+$/u, '').split(/[\\/]/u)
  return parts[parts.length - 1] ?? ''
}

/* ————————————————— 设置面那一份技能服务（批次77 任务5） ————————————————— */

/** 一行技能卡：装载层的原话＋中文域名／来源，**永远不带 body**（正文只在点了「查看正文」后单独取）。 */
function skillRow(skill, enabled) {
  return {
    name: skill.name,
    description: skill.description,
    domain: skill.domain ?? '',
    domainLabel: skillDomainLabel(skill.domain),
    kind: skill.kind ?? '',
    kindLabel: SKILL_KIND_LABELS[String(skill.kind ?? '').trim()] ?? '',
    output: skill.output,
    tools: [...skill.tools],
    origin: skill.origin ?? SKILL_ORIGINS.builtIn,
    originLabel: SKILL_ORIGIN_LABELS[skill.origin ?? SKILL_ORIGINS.builtIn] ?? String(skill.origin ?? ''),
    enabled,
    status: enabled ? 'loaded' : 'disabled'
  }
}

/**
 * 技能库设置面的四件事：列（含拒装原因）／启停／看正文／导入。
 *
 * 为什么这是一份服务而不是通道里的四段散代码：拒装原因、启停真值、两层目录这三件事的口径
 * 已经在装载层（loadSkills）一处定死了，设置面只是把它们摊开——再算一遍就等于允许两处答案不一致。
 * 项目根与工具面都靠 getter 现取（每次调用现读），所以「换个项目」「运行时还没起来」都不需要这条服务记得。
 *
 * 工具面为空时不装死：如实带 `surface.started:false`，装载层那条 `SKILL_TOOLS_NOT_ON_SURFACE`
 * 会把「装不上是因为工具面还没装配」这句话原样递到屏上——这是原因，不是错误。
 */
export function createSkillsService({
  getRoot = () => null,
  getAvailableTools = () => [],
  load = loadSkills,
  storeFactory = createFileSkillPreferencesStore,
  importer = importSkillDirectory
} = {}) {
  const currentRoot = () => String(getRoot() ?? '').trim() || null
  const toolsOnSurface = () => (Array.isArray(getAvailableTools()) ? getAvailableTools() : []).map((item) => String(item?.name ?? item ?? ''))
  // 启停存储按根缓存：lastWritten 是**这个项目**的内容指纹，换项目还复用会把 A 的启停当成 B 的「没变化」。
  let store = null
  function storeFor(root) {
    if (!store || store.root !== root) store = storeFactory({ root })
    return store
  }

  function needRoot() {
    const root = currentRoot()
    return root ?? skillsFail('INVALID_INPUT', '技能库要先打开一个项目：启停存在项目内 .pinax/skills.json，导入落在 .pinax/skills/')
  }

  async function list() {
    const root = needRoot()
    if (typeof root !== 'string') return root
    const availableTools = toolsOnSurface()
    const loaded = await load({ availableTools, projectRoot: root })
    const rows = [
      ...loaded.skills.map((skill) => skillRow(skill, true)),
      ...loaded.disabledSkills.map((skill) => skillRow(skill, false))
    ].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
    return {
      ok: true,
      value: {
        rows,
        // 守卫⑪：装不上的每一条都带 code＋原因＋它来自哪一层，设置面不许给空态。
        rejected: loaded.rejected.map((item) => ({ ...item, originLabel: SKILL_ORIGIN_LABELS[item.origin] ?? '' })),
        disabled: loaded.disabled,
        layers: loaded.layers,
        total: rows.length,
        surface: {
          availableTools: availableTools.length,
          started: availableTools.length > 0,
          note: availableTools.length > 0 ? '' : '运行时尚未就绪（工具面还没装配）：现在装不上的原因是「工具不在面上」，不是技能本身写坏了'
        }
      }
    }
  }

  async function toggle(name, enabled) {
    const root = needRoot()
    if (typeof root !== 'string') return root
    const skill = String(name ?? '').trim()
    if (!skill) return skillsFail('INVALID_INPUT', '技能启停要给出技能名')
    // 只认「装载层认得的名字」：往 skills.json 里写一个不存在的名，下一版删了这条技能它也永远留在盘上，
    // 那种脏名单没人会去清，比不写更糟。
    const loaded = await load({ availableTools: toolsOnSurface(), projectRoot: root })
    const known = [...loaded.skills, ...loaded.disabledSkills].some((item) => item.name === skill)
    if (!known) {
      const reason = loaded.rejected.find((item) => item.dir === skill || String(item.message ?? '').includes(skill))
      return skillsFail(
        'SKILL_NOT_FOUND',
        `「${skill}」不在可装载的技能里，启停没落点${reason ? `：${reason.message}` : ''}`,
        reason ? { rejectedCode: reason.code } : undefined
      )
    }
    return storeFor(root).setDisabled(skill, !enabled)
  }

  /**
   * 正文只在显式点开时展开——包括关掉的那一条：作者关掉的技能仍想看看它写了什么，这是设置面的用途；
   * 渐进披露那道闸管的是**系统提示**里不许出现正文，不是屏幕上不许读文件。
   */
  async function body(name) {
    const root = needRoot()
    if (typeof root !== 'string') return root
    const key = String(name ?? '').trim()
    if (!key) return skillsFail('INVALID_INPUT', '查看正文要给出技能名')
    const loaded = await load({ availableTools: toolsOnSurface(), projectRoot: root })
    const readable = [...loaded.skills, ...loaded.disabledSkills]
    const found = readSkillBody(readable, key)
    if (found.ok) return found
    const reason = loaded.rejected.find((item) => item.dir === key || String(item.message ?? '').includes(key))
    if (reason) {
      return skillsFail('SKILL_NOT_LOADED', `看不了「${key}」的正文：${reason.message}`, { rejectedCode: reason.code })
    }
    return found
  }

  async function importFrom(sourceDir) {
    const root = needRoot()
    if (typeof root !== 'string') return root
    return importer({ sourceDir, projectRoot: root })
  }

  return { list, toggle, body, importFrom }
}
