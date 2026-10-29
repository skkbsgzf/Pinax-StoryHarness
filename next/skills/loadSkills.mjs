import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * 技能包加载器（M2.5-B · 任务一）。
 *
 * 只做三件事，别让它长成第二个插件系统：
 *   1) 解析 SKILL.md 的 frontmatter（name / description / tools / output）；
 *   2) 校验 tools 全在当前工具面上——少一把就**不装载**并记账，绝不虚列一个点了会炸的方法；
 *   3) 把 name/description 排成给系统提示的一行清单（渐进披露：正文只在 pinax_skill_read 时才展开）。
 *
 * 目录约定：next/skills/<name>/SKILL.md，name 必须与目录同名（两套名字会让「调哪份」不可判定）。
 * 技能是**方法说明书**，不是入口：入口仍是 slash 命令与自然语言提问。
 */
export const SKILL_FILE = 'SKILL.md'
export const SKILL_OUTPUTS = Object.freeze(['proposal', 'checklist'])
export const DEFAULT_SKILLS_DIR = fileURLToPath(new URL('./', import.meta.url))

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
 * @returns {{ ok: true, value: { name, description, tools, output, body, dir } } | { ok: false, error: { code, message } }}
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
  if (!body) return { ok: false, error: { code: 'SKILL_BODY_REQUIRED', message: `技能 ${name} 只有 frontmatter 没有正文` } }
  return { ok: true, value: { name, description, tools, output, body, dir } }
}

/**
 * 装载一整个技能目录。`availableTools` 是这一刻工具面上的名字（含 pinax_skill_read 自己）。
 * 返回 { skills, rejected }：rejected 里每条约 { dir, code, message }，不抛错、不静默吞。
 */
export async function loadSkills({ dir = DEFAULT_SKILLS_DIR, availableTools = [] } = {}) {
  const onSurface = new Set((Array.isArray(availableTools) ? availableTools : []).map((name) => String(name)))
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    return { skills: [], rejected: [{ dir, code: 'SKILLS_DIR_UNREADABLE', message: String(error?.message || error) }] }
  }
  const skills = []
  const rejected = []
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  for (const name of directories) {
    let markdown = ''
    try {
      markdown = await readFile(join(dir, name, SKILL_FILE), 'utf-8')
    } catch {
      rejected.push({ dir: name, code: 'SKILL_FILE_MISSING', message: `${name}/${SKILL_FILE} 不存在` })
      continue
    }
    const parsed = parseSkillMarkdown(markdown, { dir: name, nameHint: name })
    if (!parsed.ok) {
      rejected.push({ dir: name, ...parsed.error })
      continue
    }
    const missing = parsed.value.tools.filter((tool) => !onSurface.has(tool))
    if (missing.length) {
      rejected.push({
        dir: name,
        code: 'SKILL_TOOLS_NOT_ON_SURFACE',
        message: `技能 ${name} 声明的工具不在当前面上：${missing.join('、')}`
      })
      continue
    }
    skills.push(parsed.value)
  }
  return { skills, rejected }
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
      body: skill.body
    }
  }
}
