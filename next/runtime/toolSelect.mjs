/**
 * 工具披露（M2.5-A 任务一）。
 *
 * 要治的是什么：模型面每回合只收 6 把工具（shared/generationToolContract.js 的
 * GENERATION_AGENT_LIMITS.maxTools），而运行时面上有 20 把。整张塞进去合同直接拒；
 * 随机截断又会让「改大纲」这种请求拿到世界书的工具。所以披露必须按意图确定性地选，
 * 不调模型、不读网络，单测能一条条钉住。
 *
 * 两条入口：
 *   - 命中技能：技能声明的 tools 就是答案（方法说明书自己说了要用哪几把），
 *     还有名额才补 project_context；缺的工具记进 dropped，不静默当没声明。
 *   - 没命中技能：恒定带上下文块 → 写意图按域选最多两把写工具 → 其余名额给读工具。
 *
 * 写工具照常披露：review 模式下它不是「不可用」，而是落地方式不同（见 writePolicy.mjs）。
 * 所以本模块不读 mode。
 */
export const TOOL_SELECT_LIMIT = 6

/** 写意图词。只做粗判：真正的安全边界在写策略层，不在选工具层。 */
const WRITE_INTENT = /(改|重写|改写|更新|保存|重构|调整|合并|拆分|新增|删除|落盘|润色|扩写|精简)/u

/** 域 → 意图词 / 工具名前缀。顺序即「同时命中两域时谁先」，靠前者优先。 */
const DOMAINS = Object.freeze([
  { id: 'outline', intent: /大纲|节点|卷章|结构|支线|伏笔/iu, tool: /outline/iu },
  { id: 'worldbook', intent: /世界书|条目|人物卡|暗线/iu, tool: /worldbook/iu },
  { id: 'chapter', intent: /章节|正文|原稿|这一章|上一章/iu, tool: /chapter/iu },
  // 漫画域排在剧本前：分镜既是剧本词也是漫画词，漫画页＋出图才是这一格的落点。
  // comfy_* 是在聚合面上带 comfy. 前缀的外部工具（出图桥）；comfy_submit 有意不进写族——
  // 出图不是写盘，审计缓冲会另外记账。
  { id: 'comic', intent: /漫画|分镜|画格|出图|comfy/iu, tool: /pinax_comic_|comfy_/iu },
  { id: 'script', intent: /剧本|场次|台词/iu, tool: /script/iu },
  { id: 'rule', intent: /约束|禁忌|规则|设定/iu, tool: /rule/iu },
  { id: 'notes', intent: /构思|灵感|随想/iu, tool: /notes/iu },
  { id: 'reference', intent: /资料|素材|归档/iu, tool: /document|reference|knowledge/iu }
])

// 写工具披露（批次46A 扩）：保存／写入／导入之外，删章与改名也是写盘动作——
// 不披露它们，模型在「删掉这一章」这类请求里会拿到读工具而没法落地写策略。
// 批次48 补上 `_remove`（记录型载体的删一条同样是写盘）。
const WRITE_TOOL = /(_save|_write|_import|_delete|_remove|_rename)$/u
const READ_TOOL = /(_read|_list|_search|_status|_context)$/u

function clampLimit(limit) {
  const value = Number.isSafeInteger(limit) ? limit : TOOL_SELECT_LIMIT
  return Math.max(1, Math.min(value, TOOL_SELECT_LIMIT))
}

/**
 * @param {object} input
 * @param {Array<object|string>} input.tools 面上的工具（MCP listTools 形状或裸名字）
 * @param {string} input.intent 作者这句话的原文
 * @param {{ tools?: string[] }|null} input.skill 命中的技能声明
 * @param {number} [input.limit]
 * @returns {{ names: string[], tools: Array<object|string>, dropped: Array<{name:string,reason:string}> }}
 */
export function selectTools({ tools = [], intent = '', skill = null, limit = TOOL_SELECT_LIMIT } = {}) {
  const cap = clampLimit(limit)
  const entries = (Array.isArray(tools) ? tools : [])
    .map((tool) => (typeof tool === 'string' ? { name: tool } : tool))
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
  const index = new Map(entries.map((tool, position) => [tool.name, position]))
  const picked = []
  const dropped = []

  const take = (name) => {
    const key = String(name || '')
    if (!key) return
    if (!index.has(key)) {
      dropped.push({ name: key, reason: 'not-on-surface' })
      return
    }
    if (picked.includes(key)) return
    if (picked.length >= cap) {
      dropped.push({ name: key, reason: 'limit' })
      return
    }
    picked.push(key)
  }

  const text = String(intent || '')

  if (Array.isArray(skill?.tools) && skill.tools.length) {
    for (const name of skill.tools) take(name)
    take('pinax_project_context')
    return finish(picked, entries, index, dropped)
  }

  take('pinax_project_context')

  const domain = DOMAINS.find((item) => item.intent.test(text)) ?? null
  const writes = domain
    ? entries.filter((tool) => domain.tool.test(tool.name) && WRITE_TOOL.test(tool.name))
    : []
  if (domain && WRITE_INTENT.test(text)) {
    // 每个域最多两把：通常是 save + import，多了会把读工具挤没。
    for (const tool of writes.slice(0, 2)) take(tool.name)
  }

  // 读池：常规读工具之外，域内「既非写、也非读」的外部工具（如 comfy_submit／comfy_result）
  // 也进池——它们不改本地文件，不披露就永远选不到出图这条路。真正的写盘边界仍在写策略层。
  const reads = entries.filter((tool) => READ_TOOL.test(tool.name) || (domain && domain.tool.test(tool.name) && !WRITE_TOOL.test(tool.name)))
  const inDomain = domain ? reads.filter((tool) => domain.tool.test(tool.name)) : []
  const other = reads.filter((tool) => !inDomain.includes(tool))
  for (const tool of [...inDomain, ...other]) take(tool.name)

  return finish(picked, entries, index, dropped)
}

/** 结果按面上的原顺序返回：同一句话两次跑，工具列表逐项相同。 */
function finish(picked, entries, index, dropped) {
  const names = [...picked].sort((left, right) => index.get(left) - index.get(right))
  return {
    names,
    tools: names.map((name) => entries[index.get(name)]),
    dropped: [...dropped]
  }
}
