/**
 * P2a 管线提示词（抽取组 + 挖掘组）。
 *
 * 来源（只读参照，业务语义原样搬运，不复制 Python 实现）：
 *   - D:\Pinax-e2e\ref-Novelpedia\src\prompts.py
 *     SYSTEM_PROMPT_V2 / V2_FEWSHOT / V2_USER_TMPL / build_v2_user（v2 薄 schema 抽取）
 *   - D:\Pinax-e2e\ref-Novelpedia\src\entity_registry.py
 *     REG_SYSTEM / REG_USER（稳定实体 + 别名归并）
 *   - D:\Pinax-e2e\ref-Novelpedia\src\character_agent.py
 *     RESUME_SYSTEM / RESUME_USER（人物简历式档案）
 *   - D:\Pinax-e2e\ref-Novelpedia\src\setting_agent.py
 *     SET_SYSTEM / SET_USER / SETTING_QUERY / STRENGTHEN_*（设定识别与定义）
 *
 * 改写口径（ADR P2a）：输出目标从 NovelPedia 的 scenes_meta / settings_graph
 * 改为 fact.data/v2 条目草稿——抽取组喂 plot 草稿（粒度＝100–300 字段），
 * 挖掘组喂 character 草稿（anchors/memoryPoints）与 worldview 草稿（definition）。
 * 提示词只描述「要什么 JSON」，条目 id/status/provenance 由 JS 侧确定性生成。
 */

export const PROMPT_SOURCE = Object.freeze({
  repository: 'NovelPedia（只读参照）',
  root: 'D:\\Pinax-e2e\\ref-Novelpedia',
  files: Object.freeze({
    extraction: 'src/prompts.py → SYSTEM_PROMPT_V2 / V2_FEWSHOT / V2_USER_TMPL / build_v2_user',
    registry: 'src/entity_registry.py → REG_SYSTEM / REG_USER',
    character: 'src/character_agent.py → RESUME_SYSTEM / RESUME_USER',
    setting: 'src/setting_agent.py → SET_SYSTEM / SET_USER / SETTING_QUERY / STRENGTHEN_*'
  }),
  target: 'fact.data/v2 entry drafts（plot / character / worldview）',
  rewritten: '2026-11-09'
})

/* ---------- 抽取组：小说片段 → 薄 schema（who/when/where/actinfo/notes） ---------- */

export const EXTRACT_SYSTEM_PROMPT = [
  '你是一位小说结构化抽取助手。任务：把给定小说片段「读薄」，',
  '抽取出场景锚点（who/when/where）、有序事件列表（actinfo）与备注（notes），',
  '严格按指定 JSON Schema 输出，输出长度必须小于原文。',
  '规则：1) 只输出 JSON，不要任何解释性文字；2) 字段缺失填空串 "" 或空数组 []，不要 null；',
  '3) who.role 只能是 主事/参与/提及 之一；4) when.timeline 只能是 顺叙/倒叙/插叙 之一；',
  '5) actinfo 按原文先后顺序排列；6) 不编造原文没有的信息。',
  '结果会映射为 fact.data/v2 plot 条目草稿（段粒度 100–300 字）：',
  '不要输出条目 id、status、provenance、向量或任何数据库字段。'
].join('')

function str(value) {
  return String(value ?? '')
}

function joinList(values) {
  const list = Array.isArray(values) ? values : []
  return list.filter(Boolean).join('、') || '(无)'
}

/**
 * 抽取组用户提示词（对应 NovelPedia 的 V2_USER_TMPL + build_v2_user）。
 * @param {Object} input
 * @param {{index:number, text:string, chars:number}} input.segment 一段原文（100–300 字）
 * @param {number} [input.chapterNo]
 * @param {number|string} [input.sceneId]
 * @param {string} [input.prevTail] 上一段末尾（跨段上下文）
 * @param {string[]} [input.knownNames] 已归一的角色名（供对齐）
 */
export function buildExtractPrompt(input = {}) {
  const segment = input.segment ?? {}
  const index = Number.isInteger(segment.index) ? segment.index : 1
  const chars = Number.isInteger(segment.chars) ? segment.chars : str(segment.text).length
  const head = input.prevTail
    ? `【上一段末尾（仅供衔接，不要抄进结果）】${str(input.prevTail)}\n\n`
    : ''
  const anchors = [
    input.chapterNo !== undefined ? `第 ${input.chapterNo} 章` : '',
    input.sceneId !== undefined ? `场景 ${input.sceneId}` : '',
    `段 ${index}（${chars} 字）`
  ].filter(Boolean).join(' · ')
  return `${head}下面是小说原文的一个片段（${anchors}）。

${str(segment.text)}

【任务】把本片段「读薄」成结构化数据，严格按以下 JSON 输出：
{
  "who": [{"name": "人物名", "role": "主事|参与|提及"}],
  "when": {"story_time": "故事内时间（如'入夜三更'）", "timeline": "顺叙|倒叙|插叙"},
  "where": "地点",
  "actinfo": [
    {"type": "act", "channel": "see|hear|feel|do|say|recall|reason", "who": "人物名", "content": "短语"},
    {"type": "event", "content": "客观事件", "scope": ["受影响人物"]}
  ],
  "notes": "补充信息"
}

要求：
- who 只收本片段真实出现或被提及的人物，不要把物品/组织当人物；role 只能是 主事/参与/提及。
- where 必填。原文未明写地点时，依据上下文给出最可能的场所；确实无从判断才填"未明示"。禁止留空。
- when：story_time 原文未明写填"未明示"；timeline 只能是 顺叙/倒叙/插叙 之一。
- actinfo 是按原文先后顺序排列的有序事件列表，总条数不超过 12 条：
  * act 条目＝某角色的行为/感知/话语/想法，必填 who（执行者）与 channel；
    channel 只能是：
      see=看见什么, hear=听见什么, feel=感受（体感＋情绪内心戏）,
      do=做了什么, say=说了什么, recall=回想过去线索, reason=推理得出结论
  * event 条目＝场景中客观发生的事件（非某角色行为），没有 who；
    必填 scope=受影响角色列表，波及所有人填 ["*"]。
  * act 的 who、event 的 scope 中出现的名字都必须能在顶层 who 数组里找到。
  * 同一角色同一 channel 最多 2 条；连续同类必须合并成一条，content 用"；"连接。
  * 每条 content 用短语概括 10–25 字，不要抄整句。
- notes：本片段无法塞入 actinfo 但重要的信息（伏笔、氛围铺垫、作者暗示、异常点），至少 1–2 条。
- 已知角色名（供对齐，可忽略）：${joinList(input.knownNames)}
- 不编造原文没有的信息；字段缺失填空串 "" 或空数组 []，不要 null。

只输出 JSON。`
}

/* ---------- 挖掘组 A：人物言行锚点 + 记忆点 ---------- */

export const MINE_CHARACTER_SYSTEM_PROMPT = [
  '你是资深编辑。为小说人物生成简历式档案——像求职简历一样清晰：身份/经历/关系/疑点；',
  '同时抽取可复用的言行锚点（speech/behavior/catchphrase）与记忆点（memoryPoints）。',
  '只输出 JSON。'
].join('')

/**
 * 人物挖掘用户提示词（对应 NovelPedia 的 RESUME_USER，补 v2 的 anchors/memoryPoints/castRole）。
 * @param {Object} input
 * @param {string} input.name
 * @param {string[]} [input.appearances]
 * @param {string[]} [input.sayings]
 * @param {string[]} [input.doings]
 * @param {Object} [input.coOccurrences] { 其他人物名: 共现次数 }
 * @param {string[]} [input.clues]
 */
export function buildMineCharacterPrompt(input = {}) {
  const coOccurrences = input.coOccurrences && typeof input.coOccurrences === 'object'
    ? Object.entries(input.coOccurrences).map(([name, count]) => `${name}(${count}次)`).join('、')
    : ''
  return `小说人物「${str(input.name)}」的行为档案（来自 actinfo 明线聚合）：

【出现】${joinList(input.appearances)}
【说过的话（节选）】${joinList(input.sayings)}
【做过的事（节选）】${joinList(input.doings)}
【共现人物（关系候选）】${coOccurrences || '(无)'}
【相关线索】${joinList(input.clues)}

请为「${str(input.name)}」生成简历式档案（用真实内容填充，不要复述本提示词）：
{
  "identity": "基于证据判断该人物的身份（2–3 句具体内容）",
  "trajectory": "按时间顺序的行为轨迹摘要（3–4 句，只述事实，引用具体行为）",
  "relations": [{"name": "其他人物名", "relation": "基于共现与言行的关系判断"}],
  "doubts": ["与该人物相关的疑点（引用证据内容，最多 3 条）"],
  "personality": "基于言行推断的性格（关键词＋一句说明）",
  "anchors": {"catchphrase": ["口头禅或标志性短句，最多 3 条，没有就 []"]},
  "memoryPoints": ["值得记住的具体瞬间/细节，最多 5 条，没有就 []"],
  "castRole": {"tier": "protagonist|supporting|minor", "goal": "该角色的塑造目标", "plotFunction": "该角色在剧情里的作用"}
}

要求：
- 内容必须来自上述档案，不脑补；身份不确定就写"暂未明示"。
- relations 最多 5 个；memoryPoints 最多 5 条；catchphrase 最多 3 条且只要短句。
- castRole.tier 为 supporting/minor 时，goal 与 plotFunction 必须写具体作用，不能空。
- 只输出 JSON 对象，不要输出 JSON 示例或占位符文字。`
}

/* ---------- 挖掘组 B：世界观设定识别 + 定义补充 ---------- */

export const MINE_SETTING_SYSTEM_PROMPT = [
  '你是网络小说世界观设定专家。从场景里识别本书专有的设定实体（特有名词/体系/规则/组织），',
  '给出客观定义，并判断它与已有设定的内在关联。只输出 JSON。'
].join('')

/**
 * 设定挖掘用户提示词（对应 NovelPedia 的 SET_USER）。
 * @param {Object} input
 * @param {number} [input.chapterNo]
 * @param {number|string} [input.sceneId]
 * @param {string} [input.where]
 * @param {string[]} [input.who]
 * @param {string[]} [input.actinfo] 已格式化的行为事件
 * @param {string} [input.notes]
 * @param {string[]} [input.existingTerms]
 */
export function buildMineSettingPrompt(input = {}) {
  return `下面是小说第 ${input.chapterNo ?? '?'} 章 scene${input.sceneId ?? '?'} 的抽取结果。

【场景】${str(input.where) || '未明示'}
【人物】${joinList(input.who)}
【行为事件】${joinList(input.actinfo)}
【备注】${str(input.notes) || '(无)'}
【已有设定名】（供判断关联/归并）：${joinList(input.existingTerms)}

【任务】识别本场景出现的设定实体（本书特有名词如力量/规则/组织/地点/物品），给定义＋判断关联。
注意：这些设定可能已在已有设定中（用已有名归并/复用），也可能新增。

【输出】严格 JSON 数组，每个元素：
{
  "name": "设定名（规范名，与已有同名则用已有名）",
  "category": "力量体系|规则|组织|地点|物品|世界观",
  "definition": "客观定义，2–3 句",
  "aliases": ["本场景出现的别名/近义名，无则 []"],
  "related": [{"to": "关联的设定名", "type": "关联|体系|地点|因果", "how": "一句话说明关联"}],
  "readerCognition": {"firstMention": false, "supplementNeeded": false}
}

要求：
- 只收本书专有名词，拒收通用名词：医院诊所学校酒吧、队友敌人朋友同伴、武器装备药水食物等
  现实/网文通用概念一律不收。判定标准：一个词放在别的小说里同样成立，就不收。
  例外：通用词被本书赋予特指含义时收（如"圣光医院"这个专有组织），但只收特指名。
- name 若与已有设定是同一实体，必须用已有规范名（归并，不新建）。
- aliases 只收"同一个实体的不同叫法/写法"，绝不收同场景出现的其他独立实体。
- related 只在有明确内在关联时填，没有就 []。
- readerCognition.firstMention 表示是否为读者第一次见到；supplementNeeded 表示定义是否还不够清楚。
- 只输出 JSON 数组。`
}

/* ---------- 分组导出（供 usecase 统一取用） ---------- */

export const EXTRACTION_PROMPTS = Object.freeze({
  system: EXTRACT_SYSTEM_PROMPT,
  buildUser: buildExtractPrompt
})

export const MINING_PROMPTS = Object.freeze({
  character: Object.freeze({
    system: MINE_CHARACTER_SYSTEM_PROMPT,
    buildUser: buildMineCharacterPrompt
  }),
  setting: Object.freeze({
    system: MINE_SETTING_SYSTEM_PROMPT,
    buildUser: buildMineSettingPrompt
  })
})
