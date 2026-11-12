/**
 * 视角与称谓（作者 2026-11-12 裁定）。
 *
 * 作者原话：「人称视角问题，用我之前的经验。Agent 再扫文章的时候代入得是读者身份，
 * 文本本体都需要带入一个视角参数。例如以『我』作为第一人称叙述的时候，一些角色就是唯一的身份，
 * 例如我的爸妈男友闺蜜，这些时候无需给这个角色赋予直接的人名，这个称号本身也可以。
 * 后续出现真名，小名的时候再补全即可。」
 *
 * 三条规则：
 *   1) **先到先得**：采集过程中先出现的称呼就锁定为条目身份，不等到真名。
 *   2) **称谓即身份**：「男友」「妈妈」「闺蜜」「我上司」都是合法条目名——第一人称小说里
 *      这类称谓在全文可能一直是唯一指称，强行等真名会让条目整段丢失。
 *   3) **后续补全**：真名/小名出现时挂为别名（alias），呈现层按「真名 > 昵称 > 视角称谓」排序。
 *
 * 本模块只做确定性判定与归一，不调模型。需要跨章推理身份时由调用方（Host）决定开 thinking。
 */

export const PERSPECTIVE_VERSION = 'fact-perspective@1'

/** 视角类型：first＝第一人称「我」叙述；third＝第三人称。 */
export const PERSPECTIVES = Object.freeze(['first', 'third'])

/**
 * 第一人称里的**关系称谓**：它们本身就是身份标签，可直接做条目名。
 * 分三族：亲属 / 亲密关系 / 社会关系。
 */
const KINSHIP_TERMS = [
  '爸爸', '妈妈', '父亲', '母亲', '爸妈', '父母', '爹', '娘', '爷爷', '奶奶', '外公', '外婆',
  '姥爷', '姥姥', '哥哥', '弟弟', '姐姐', '妹妹', '兄弟', '姐妹', '儿子', '女儿',
  '叔叔', '舅舅', '姑姑', '姨妈', '舅妈', '婶婶', '表哥', '表姐', '表弟', '表妹',
  '堂哥', '堂姐', '堂弟', '堂妹', '继父', '继母', '养父', '养母', '前夫', '前妻',
  '老公', '老婆', '丈夫', '妻子', '丈夫', '未婚夫', '未婚妻', '男友', '女友', '男朋友', '女朋友',
  '初恋', '前男友', '前女友', '暗恋对象', '白月光', '未婚妻', '对象', '男神', '女神'
]
const SOCIAL_TERMS = [
  '闺蜜', '好友', '朋友', '死党', '室友', '同事', '同学', '同桌', '上司', '老板', '领导',
  '下属', '助理', '秘书', '司机', '房东', '邻居', '客户', '甲方', '乙方', '导师', '老师',
  '学生', '徒弟', '师父', '师傅', '搭档', '合伙人', '竞争对手', '对手', '敌人', '仇人'
]

/** 可作身份的称谓全集（含「我的X」剥壳后的 X）。 */
export const IDENTITY_TITLES = Object.freeze([...new Set([...KINSHIP_TERMS, ...SOCIAL_TERMS])])

const TITLE_SET = new Set(IDENTITY_TITLES)

/** 视角判定：全文里「我」的密度高、且「他/她」不被用作主叙述者 → first。 */
export function detectPerspective(text) {
  const source = String(text ?? '')
  if (!source.trim()) return { perspective: 'third', confidence: 0, firstPerson: 0, thirdPerson: 0 }
  const first = (source.match(/我(?!们)/gu) ?? []).length
  const third = (source.match(/[他她](?!们)/gu) ?? []).length
  // 第一人称叙述的特征：我 占比高（≥40%），且绝对数够多。
  const ratio = first + third > 0 ? first / (first + third) : 0
  return {
    perspective: ratio >= 0.4 && first >= 10 ? 'first' : 'third',
    confidence: Number(ratio.toFixed(3)),
    firstPerson: first,
    thirdPerson: third
  }
}

/**
 * 从「我的X」这类领属结构里抽称谓。
 * 第一人称小说写「我的男友」「我妈」，模型常把整串当 who；
 * 这里把它归一成「男友」「妈妈」——称谓本身即身份。
 * @returns {string} 归一后的称谓（不是称谓就原样返回）
 */
export function normalizeTitleName(raw) {
  let name = String(raw ?? '').trim()
  if (!name) return name
  // 剥掉领属前缀：我的 / 我 / 他 / 她的 / 她的
  name = name.replace(/^(?:我的|我|他(?:的)?|她(?:的)?|你(?:的)?)/u, '').trim()
  // 「我男友」「我妈妈」→ 已经剥过；再剥一次「的」
  name = name.replace(/^的/u, '').trim()
  return name
}

/** 是否是合法身份称谓（可直接作条目名）。 */
export function isIdentityTitle(name) {
  const value = normalizeTitleName(name)
  if (!value) return false
  if (TITLE_SET.has(value)) return true
  // 允许「X的Y」形式（如「余欢的男友」）——取尾部称谓判定
  const tail = /的(.+)$/u.exec(value)
  return Boolean(tail && TITLE_SET.has(tail[1]))
}

/**
 * 视角内的称谓唯一性：第一人称里「我的男友」在全文只指一个人，
 * 所以称谓本身可以作为**稳定身份**（不必等真名）。
 * 返回该段的视角上下文，供 bindRows 判定 who 是否可用。
 */
export function perspectiveContextOf(segment, options = {}) {
  const global = options.perspective ?? detectPerspective(options.text ?? segment?.text)
  const text = String(segment?.text ?? '')
  // 段内可确立的称谓身份，两个来源：
  //   a) 领属结构「我的X」/「我X」（我妈妈、我的闺蜜）；
  //   b) 称谓本身出现在本段且被当作主语（「男友推了推我」「妈妈走过来」）。
  const titles = []
  for (const match of text.matchAll(/我(?:的)?([\u4e00-\u9fa5]{2,6})/gu)) {
    const title = normalizeTitleName(match[1])
    if (isIdentityTitle(title) && !titles.includes(title)) titles.push(title)
  }
  for (const term of IDENTITY_TITLES) {
    // 只认「称谓 + 动作/说话」或「称谓 + 代词宾语」这类主语用法，避免把名词列举当身份。
    const used = new RegExp(`${term}(?=[，。！？；：、\\s]*(?:[推拉抓看走坐站笑叹说问答喊叫]|\\s)|的)`, 'u').test(text)
    if (used && !titles.includes(term)) titles.push(term)
  }
  return {
    perspective: global.perspective,
    confidence: global.confidence,
    // 本段可确立的称谓身份（去重、保序）
    titles
  }
}
