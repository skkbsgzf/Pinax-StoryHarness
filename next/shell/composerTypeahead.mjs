/**
 * 输入区 typeahead（批次77 任务3）——「一个弹层吃三类」的判定纯层。
 *
 * 分工口径与任务4 的 `conversationTimeline.mjs` 一致：**这里只出判断，`.vue` 只负责摆**。
 * 三件事都是纯函数，node:test 直接测，不用 jsdom：
 *   1) `detectComposerToken` —— 光标前那一段算不算一个待补全 token（含前导边界规则）；
 *   2) `buildComposerMenu`   —— 按触发符组菜单（`/` 命令＋技能、`@` 素材、`#` 工作流角色）；
 *   3) `applyComposerToken` ＋ `extractSkillToken` —— 选中后怎么改草稿、发送时技能 token 怎么抽。
 *
 * 命令词的数据仍在 `slashCommands.mjs`，引用的类别与摘要解析仍在 `agentReferences.mjs`——
 * 本模块不搬数据、不重复实现一遍，只负责「此刻是不是在敲一个 token」与「菜单里放什么」。
 */

/** 三类触发符（词表固定；`#` 的角色清单要等批次78 的产出方）。 */
export const COMPOSER_TRIGGERS = Object.freeze(['/', '@', '#'])

/** 菜单项的四类落点（`role` 本批只有空态，产出方＝批次78）。 */
export const COMPOSER_ITEM_KINDS = Object.freeze(['command', 'skill', 'reference', 'role'])

/** 每一类最多列几条（沿用对话框 `@` 弹层既有读数，不新增数值闸：这是排版的截断，不是判据）。 */
export const COMPOSER_PER_GROUP_LIMIT = 8

/** token 到此为止的字符：空白，与书名号（`@《已插好的标题》` 是成品，不是正在敲的 query——再弹菜单就是挡住正文了）。 */
function tokenBreaker(char) {
  return /\s/u.test(char) || char === '\u300a' || char === '\u300b'
}

/** 前导边界（工单第 2 条）：行首，或前一个字符是空白。DeepWrite 那处 `lastIndexOf` 的坑就在这——只找最后一个触发符不看前导，中文正文中段的 `/`、`@` 会把菜单唤出来。 */
function hasLeadingBoundary(text, index) {
  if (index <= 0) return true
  return /\s/u.test(text[index - 1])
}

/**
 * 光标前那一段是不是一个待补全 token。
 * 返回 `{ trigger, query, start, end }`；不算 token 就回 null（null 是「这里什么都没有」，不是「空查询」）。
 */
export function detectComposerToken(text, caret = null) {
  const value = String(text ?? '')
  // 没给光标（null／undefined）就按「整句末尾」读；`Number(null) === 0` 那种巧合不许当位置用。
  const given = typeof caret === 'number' && Number.isFinite(caret)
  const end = given ? Math.max(0, Math.min(value.length, Math.round(caret))) : value.length
  let start = end
  while (start > 0 && !tokenBreaker(value[start - 1])) start -= 1
  const segment = value.slice(start, end)
  if (!segment) return null
  const trigger = segment[0]
  if (!COMPOSER_TRIGGERS.includes(trigger)) return null
  // 触发符自己也得站在边界上：「第3/章」的那个 / 前面是数字，不算在敲命令。
  if (!hasLeadingBoundary(value, start)) return null
  const query = segment.slice(1)
  // 段里还有第二个触发符（`@a/b`）＝作者在敲的不是这一个 token。
  if (query.includes('/') || query.includes('@') || query.includes('#')) return null
  return { trigger, query, start, end }
}

function commandItem(command) {
  return {
    kind: 'command',
    key: `command:${command.name}`,
    label: String(command.name ?? ''),
    hint: String(command.desc ?? ''),
    // 命令的落点不是「插一段文本」：选中＝模板填进草稿＋命令词随提交带上去（pickCommand 在组件里办）。
    value: null,
    source: command
  }
}

function skillItem(skill, groupLabel = '技能') {
  const name = String(skill?.name ?? '')
  return {
    kind: 'skill',
    key: `skill:${name}`,
    label: `/${name}`,
    // 没有一句话描述时至少说清这一条属于哪一组（技能／风格），不许留一行光秃秃的 `/名字`。
    hint: String(skill?.description ?? skill?.desc ?? '').trim() || groupLabel,
    // 工单第 1 条：技能选中＝只插这一个文本 token，正文由运行时 pinax_skill_read 按名取。
    value: `/${name}`,
    name
  }
}

function referenceItem(item, groupLabel) {
  const title = String(item?.title ?? '')
  return {
    kind: 'reference',
    key: `reference:${groupLabel}:${title}`,
    label: `@《${title}》`,
    hint: groupLabel,
    value: `@《${title}》`,
    source: item
  }
}

function roleItem(role) {
  const name = String(role?.name ?? role?.title ?? '')
  return {
    kind: 'role',
    key: `role:${name}`,
    label: `#${name}`,
    hint: String(role?.desc ?? role?.description ?? '').trim(),
    value: `#${name}`,
    name
  }
}

function matched(item, needle, fields) {
  if (!needle) return true
  return fields.some((field) => String(item?.[field] ?? '').toLowerCase().includes(needle))
}

/**
 * 按触发符组菜单。返回 `{ groups, items, empty }`：
 * `groups` 是分类后的展示单元，`items` 是键盘那一条扁平序列（顺序＝屏上顺序），
 * `empty` 是「一类都没有」时那一句实话（渲染成一行文字，不是一枚点不动的钮）。
 */
export function buildComposerMenu({
  trigger = '',
  query = '',
  commands = [],
  skills = [],
  references = [],
  roles = [],
  referenceKindLabels = null,
  referenceKindOrder = null,
  limit = COMPOSER_PER_GROUP_LIMIT
} = {}) {
  const needle = String(query ?? '').trim().toLowerCase()
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : COMPOSER_PER_GROUP_LIMIT
  const groups = []

  if (trigger === '/') {
    const commandItems = (Array.isArray(commands) ? commands : [])
      .filter((command) => matched(command, needle, ['name', 'desc']))
      .slice(0, cap)
      .map(commandItem)
    // 技能与风格共用 `kind:'skill'` 这一类落点（插的都是 `/名字`），但**分两组摆**：
    // 批次77 任务5 把 `kind: style` 的风格包单列一组——作者按方法选和按口吻选是两件事，
    // 混在一列里要点三下才能找到「江南体」那种风格包。
    const skillPool = (Array.isArray(skills) ? skills : [])
      .filter((skill) => skill?.name)
      .filter((skill) => matched(skill, needle, ['name', 'description', 'desc']))
    const methodItems = skillPool.filter((skill) => skill.kind !== 'style').slice(0, cap).map((skill) => skillItem(skill, '技能'))
    const styleItems = skillPool.filter((skill) => skill.kind === 'style').slice(0, cap).map((skill) => skillItem(skill, '风格'))
    if (commandItems.length) groups.push({ kind: 'command', label: '命令', items: commandItems })
    if (methodItems.length) groups.push({ kind: 'skill', label: '技能', items: methodItems })
    if (styleItems.length) groups.push({ kind: 'skill', label: '风格', items: styleItems })
  } else if (trigger === '@') {
    const order = Array.isArray(referenceKindOrder) && referenceKindOrder.length ? referenceKindOrder : []
    const list = Array.isArray(references) ? references : []
    for (const kind of order) {
      const label = String(referenceKindLabels?.[kind] ?? kind)
      const items = list
        .filter((item) => item?.kind === kind && item?.title)
        .filter((item) => matched(item, needle, ['title']))
        .slice(0, cap)
        .map((item) => referenceItem(item, label))
      if (items.length) groups.push({ kind: 'reference', label, items })
    }
  } else if (trigger === '#') {
    const items = (Array.isArray(roles) ? roles : [])
      .filter((role) => role?.name || role?.title)
      .filter((role) => matched(role, needle, ['name', 'title', 'desc', 'description']))
      .slice(0, cap)
      .map(roleItem)
    if (items.length) groups.push({ kind: 'role', label: '工作流角色', items })
  }

  const items = groups.flatMap((group) => group.items)
  // 有项就没有空态；空态是「一类都没有」时那一句实话，不是第 N ＋ 1 条可选项。
  return { groups, items, empty: items.length ? null : emptyLineFor(trigger) }
}

/**
 * 空态那一句。三类各有各的「为什么是空的」，不许笼统一句「无结果」糊过去：
 * 技能没装载＝去设置里的技能库看拒装原因（批次77 任务5 那条面）；素材没打开栏目＝照实说；
 * 角色＝批次78 才产清单，本批只有这一句实话（工单：先出「暂无」空态，不留死钮）。
 */
function emptyLineFor(trigger) {
  if (trigger === '#') return { kind: 'role', empty: true, label: '这个项目还没有可引用的角色（在正文里写「角色：」那一类内容后这里就有）' }
  if (trigger === '/') return { kind: 'skill', empty: true, label: '没有可用的命令或技能。技能整包没装载时这里就是空的——去「设置 → 技能库」看每一条的拒装原因' }
  if (trigger === '@') return { kind: 'reference', empty: true, label: '当前项目还没有可引用的内容（打开对应栏目后这里就有）' }
  return null
}

/**
 * 选中菜单项后怎么写草稿：把 `[start, end)` 那一段（正在敲的 token）换成 `value`，后面补一个空格。
 * 纯字符串活，返回新草稿与新光标位——组件只管把这两个值交回 textarea。
 */
export function applyComposerToken(draft, token, value) {
  const text = String(draft ?? '')
  if (!token || typeof token !== 'object') return { draft: text, caret: text.length }
  const start = Math.max(0, Math.min(text.length, Number(token.start) || 0))
  const endRaw = Number(token.end)
  const end = Math.max(start, Math.min(text.length, Number.isFinite(endRaw) ? endRaw : text.length))
  const tokenText = String(value ?? '')
  const tail = text.slice(end)
  // 补一个空格是为了两件事：光标落在 token 之后、下一拍不会再被当成同一个 token 弹菜单。
  // 后面本来就有空白时不再补——补了就多出一个空格，作者还得回头删。
  const needsSpace = !tail || !/\s/u.test(tail[0])
  const gap = needsSpace ? ' ' : ''
  return { draft: `${text.slice(0, start)}${tokenText}${gap}${tail}`, caret: start + tokenText.length + gap.length }
}

/**
 * 发送时把草稿里的 `/技能名` token 抽出来。
 * 只认「装载清单里真有的名字」（整词匹配，词后必须是空白或结尾），命令词那些中文 slash 不误伤：
 * `/大纲 这一章` 里 `大纲` 不是技能名，原样留着走命令路由。
 * 多个技能 token 只取第一个当这一问的方法（一轮一问一个方法是既有口径），其余照实从正文里去掉——
 * 不去掉就会把 `/chapter-rewrite` 这种字面量喂给模型，那不是作者打的正文。
 */
export function extractSkillToken(text, skillNames = []) {
  const value = String(text ?? '')
  const names = (Array.isArray(skillNames) ? skillNames : []).map((name) => String(name ?? '').trim()).filter(Boolean)
  if (!names.length) return { text: value, skill: '', removed: 0 }
  let skill = ''
  let removed = 0
  const cleaned = value.replace(/(^|\s)\/([^\s/@#]{1,80})/gu, (whole, head, name) => {
    if (!names.includes(name)) return whole
    if (!skill) skill = name
    removed += 1
    return head
  })
  return { text: cleaned.trim(), skill, removed }
}

/** 技能名清单（从 catalog／names 两种形状里取，装载侧给哪一份都能读）。 */
export function skillNameList(skills) {
  const list = Array.isArray(skills) ? skills : []
  return list.map((item) => (typeof item === 'string' ? item : String(item?.name ?? ''))).map((name) => name.trim()).filter(Boolean)
}
