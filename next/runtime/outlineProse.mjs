/**
 * 散文大纲解析器（批次30 · 任务一）：把作者手上的散文章节稿读成「章节节点草稿」。
 *
 * 为什么需要它：作者真稿是 `大纲/001-004.md` 这种散文章节稿——一份文件里好几章，
 * 章用 `## 第一章《牛肉汤》` 起头，章内再用 `### 章功能／简纲／STAR／登记` 分小节。
 * 大纲载体的读工具只认 `outline.json`／`大纲.md` 两个名字（合同不动），
 * 所以转换这一步单独放在这里：解析是纯函数，不读盘、不写盘、不知道项目根。
 *
 * 诚实边界（工单钉住，别越界）：
 *   • 只认两级标题——文件题 `# …` 与章节 `## …`；`###` 及以下是小节，不立节点，
 *     也不替它编层级（真稿的层级在标题里只有两层）。
 *   • 没有 `## ` 行的文件按「整篇散文」处理：0 章 + 一条警告，绝不猜章节。
 *   • `## ` 标题为空的行跳过并记警告（不生成没有名字的节点）。
 *   • note 是正文 strip 掉 md 标记后的前 200 字（含省略号不超过 200——界面备注框 maxlength 200）。
 *
 * source 的格式 `${relativePath}#${title}` 是幂等去重与溯源的键：同一个文件里同名章节
 * 视为同一节（重跑导入不会重复追加），也是将来「跳回源文」的定位锚点（本批不做跳转）。
 */
const NOTE_LIMIT = 200

/** 标题行：行首 0–3 空格 + 1–6 个 # + 空白（markdown 的 ATX 标题）。 */
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*))?$/u
/** 列表符号：`-`／`*`／`+`／`1.`／`1)`／`1、`（简纲的编号清单就是这一类）。 */
const LIST_MARKER = /^(?:[-*+]|\d+[.)、])\s+/u
/** 整行只是分隔线（`---`／`***`／`___`）——md 视觉分隔，不是内容。 */
const RULE_LINE = /^[-*_]{3,}$/u

/**
 * 去掉 md 标记，只留纯文本行：标题行整行丢、列表符号去、加粗/斜体星号与行内代码去，
 * 空白收成单空格，最后按行用空格拼回一段（备注是一句话的位置，不是原文容器）。
 */
export function stripMarkdownLines(text) {
  const kept = []
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim()
    if (!line) continue
    if (RULE_LINE.test(line)) continue
    if (HEADING.test(line)) continue
    line = line.replace(/^>\s?/u, '')
    line = line.replace(LIST_MARKER, '')
    line = line.replace(/\*\*|__/gu, '')
    line = line.replace(/[`*]/gu, '')
    line = line.replace(/\s+/gu, ' ').trim()
    if (line) kept.push(line)
  }
  return kept.join(' ')
}

/**
 * 备注摘录：前 200 字；超长时截到 199 字再补「…」，总长仍是 200
 * （工单正文写「200 字处截断加…」，但界面备注框 maxlength=200、测试也钉 note ≤ 200，
 * 所以这里按「含省略号不超过 200」落地）。
 */
export function noteExcerpt(text) {
  const stripped = stripMarkdownLines(text)
  return stripped.length > NOTE_LIMIT ? `${stripped.slice(0, NOTE_LIMIT - 1)}…` : stripped
}

/**
 * parseOutlineProse(text, relativePath) → { docTitle, chapters, warnings }
 * chapters[i] = { title, note, source }；source = `${relativePath}#${title}`。
 */
export function parseOutlineProse(text, relativePath = '') {
  const warnings = []
  const file = String(relativePath ?? '').trim()
  const lines = String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n').split('\n')
  const chapters = []
  let docTitle = null
  let current = null
  let skippedTitleCount = 0

  for (const raw of lines) {
    const matched = HEADING.exec(raw)
    if (!matched) {
      if (current) current.body.push(raw)
      continue
    }
    const level = matched[1].length
    const title = String(matched[2] ?? '').trim()
    if (level === 1) {
      // 文件题只认第一个；`#` 出现在章内时它仍是标题行，strip 阶段会整行丢掉。
      if (docTitle === null && title) docTitle = title
      if (current) current.body.push(raw)
      continue
    }
    if (level === 2) {
      if (!title) {
        skippedTitleCount += 1
        current = null
        continue
      }
      current = { title, body: [] }
      chapters.push(current)
      continue
    }
    // `###` 及以下：小节不立节点；整行留在正文里，noteExcerpt 会把标题行去掉、只留内容。
    if (current) current.body.push(raw)
  }

  if (skippedTitleCount) {
    warnings.push(`${file || '该文件'}：有 ${skippedTitleCount} 个空的「## 」章节标题，已跳过（不生成没有名字的节点）`)
  }
  if (!chapters.length) {
    warnings.push(`${file || '该文件'}：该文件没有章节标题（找不到「## 」行），未生成节点；整篇散文不当作章节稿`)
    return { docTitle, chapters: [], warnings }
  }

  return {
    docTitle,
    chapters: chapters.map((chapter) => ({
      title: chapter.title,
      note: noteExcerpt(chapter.body.join('\n')),
      source: `${file}#${chapter.title}`
    })),
    warnings
  }
}

export const OUTLINE_PROSE_NOTE_LIMIT = NOTE_LIMIT

export default parseOutlineProse
