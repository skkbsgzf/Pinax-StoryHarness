/**
 * 代词 → 实体映射（作者 2026-11-12 视角裁定的落地）。
 *
 * 第一人称小说的关系抽取必然产出「我→林逸」「他→顾茵」这类边——
 * 但「我」「他」不是条目名，直接落库就是断链节点。映射规则：
 *   · `我` → 本段/本书的**主角**（第一人称叙述者）。有主角名就用它；
 *     取不到时保留「我」（称谓即身份，见 ADR §13.2）。
 *   · `他`/`她` → 仅在「本段只有一个其他人物候选」时映射；多候选不猜。
 *
 * 纯函数、零宿主依赖。
 */

/** 代词集合：这些不是条目名，但可以按视角映射到具体实体。 */
const FIRST_PERSON_PRONOUNS = new Set(['我', '我们', '咱', '咱们'])
const THIRD_PERSON_PRONOUNS = new Set(['他', '她', '他们', '她们'])

/**
 * @param {string} value 关系端点
 * @param {{perspective?:string, protagonist?:string|null, others?:string[]}} context
 * @returns {{name:string, mapped:boolean, reason:string}}
 */
export function resolvePronoun(value, context = {}) {
  const raw = String(value ?? '').trim()
  if (!raw) return { name: raw, mapped: false, reason: 'empty' }
  const perspective = context.perspective ?? 'third'
  const protagonist = context.protagonist ?? null
  const others = Array.isArray(context.others) ? context.others.filter(Boolean) : []

  if (FIRST_PERSON_PRONOUNS.has(raw)) {
    if (perspective === 'first') {
      return {
        name: protagonist || '我',
        mapped: true,
        reason: protagonist ? 'first-person-protagonist' : 'first-person-self'
      }
    }
    return { name: raw, mapped: false, reason: 'plural-without-anchor' }
  }

  if (THIRD_PERSON_PRONOUNS.has(raw)) {
    const unique = [...new Set(others)].filter((name) => name !== protagonist)
    // 只有一个候选取它（最稳）；多个候选不猜——猜错比不猜更糟。
    if (unique.length === 1) return { name: unique[0], mapped: true, reason: 'third-person-unique' }
    return { name: '', mapped: false, reason: unique.length ? 'third-person-ambiguous' : 'third-person-no-anchor' }
  }

  // 复合称谓（我爸/我妈/他爸妈/我的闺蜜）：领属词剥掉后剩下的称谓本身可作身份。
  // 这符合作者「称号本身也可以」的口径——不必强行找出真名。
  const stripped = raw.replace(/^(?:我的|我|他(?:的)?|她(?:的)?|你(?:的)?)/u, '').replace(/^的/u, '').trim()
  // 单字亲属称谓补全：「爸」→「爸爸」、「妈」→「妈妈」（单字条目名不利于检索与呈现）。
  const COMPLETE = { 爸: '爸爸', 妈: '妈妈', 哥: '哥哥', 姐: '姐姐', 弟: '弟弟', 妹: '妹妹', 爷: '爷爷', 奶: '奶奶', 舅: '舅舅', 叔: '叔叔' }
  const completed = COMPLETE[stripped] ?? stripped
  if (stripped && stripped !== raw && stripped.length <= 4) {
    return { name: completed, mapped: true, reason: 'possessive-title' }
  }

  return { name: raw, mapped: false, reason: 'not-pronoun' }
}

export const PRONOUN_MAP_VERSION = 'fact-pronoun@1'
