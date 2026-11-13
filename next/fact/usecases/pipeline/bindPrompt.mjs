/**
 * 窄绑定提示词（P-TRIM 三段式第二段：模型只做机械绑定，不做改写）。
 *
 * 与旧 `prompts.mjs` 的差别（真跑读数驱动）：
 *   · 旧提示词让模型**生成事件文本**，实测 71% 不能原文定位——那是改写，不是抽取；
 *   · 新提示词把块（代码已切好、带通道提示与说话人线索）交给模型，只问两件事：
 *       1) 主体是谁（给候选，不确定就留空——绝不编）；
 *       2) 通道对不对（只允许改成闭集里的另一个值）。
 *   · 事件正文由代码取块原文，模型不再产生任何事件文本 → 输出从 1613 字/段降到 ~300 字/段。
 *
 * 提示词**逐字节稳定**（B3）：固定前缀在前、变量在后、无时间戳/计数器。
 */

export const BIND_PROMPT_VERSION = 'fact-bind-prompt/v2'

/** 通道闭集：与 EXTRACTION_ROW_SCHEMA 的 events.channel 枚举同源（单一真源）。 */
export const BIND_CHANNELS = Object.freeze(['do', 'say', 'think', 'feel', 'perceive', 'state', 'event'])

export const BIND_SYSTEM_PROMPT = [
  '你是结构化标注器，不是改写器。用户给你一个已经切好的「块」列表（每块有 id 和原文），',
  '你的唯一工作是给每块指定：主体（谁做的/谁说的/谁感知的）与通道。',
  '',
  '输出 JSON：{"segments":[{"id":"段id","blocks":[{"id":"b1","who":"人名或空串","ch":"通道"}],',
  '"settings":[],"knowledge":[],"hooks":[],"aka":[],"relations":[]}]}',
  '规则（违反即算错）：',
  '1) **不要输出任何原文**。块原文已经由系统保存，重复它只会浪费配额。',
  '2) who 只能填**专有名词**：人名、地名、机构名。具体判据：',
  '   ✓ 对：余欢、沈逸林、高宴、Niettie、律所、茶水间；',
  '   ✗ 错：闯祸、犹豫、最终、刚才、我知、你要、连忙帮余欢倒、头疼地揉（这些是动作/状态/句子碎片，不是名字）；',
  '   判断不出就写 ""。绝不编造，绝不用「他/她/某人/大家/有人」这类代词或泛指。',
  '3) ch 只能是：do（动作）、say（说出口的话）、think（心里想的话）、feel（身体感受或情绪）、',
  '   perceive（看见/听见/闻到/注意到）、state（状态描写、环境、身份说明）、event（不可归类的客观事件）。',
  '4) 块里若有 `hint` 字段（系统给的线索），它只是建议：你有把握就照用，没把握就改成你判断的；',
  '   但 who 不能因为 hint 有值就盲抄——hint 可能是代词推断出来的。',
  '5) settings / knowledge / hooks 的每一项**必须是对象**，不是句子。给不出就留 []。',
  '   句子是剧情，不是设定——「某人把枪藏进抽屉」这类不要放进 settings。',
  '6) relations 这一轮**留空数组**：关系抽取是独立的一轮（需要一点推理），会在另一个请求里专门做。',
  '   你在这里只要把它原样输出成 []，不要顺手填。',
  '7) aka 只在原文**明确断言两者是同一人**时填（如「这就是现在的我，克莱恩·莫雷蒂？」），',
  '   写成 [["当前称呼","另一个称呼"]]；只是同一场戏出现两个名字不算。',
  '8) 视角规则：第一人称书（用户消息会标注叙述者）里，**无明确主语的叙事块（动作/状态/感知）who 填叙述者真名**——叙述者就是已知人物表的第一个名字；对话块仍标说话者；确实判不出才留空。',
  '   第三人称书同理：无主语块若上下文明确延续上一块的主体，可沿用该主体，判不出留空。',
  '9) 只输出 JSON，不要解释、不要 markdown 围栏。'
].join('\n')

/**
 * 用户消息：块清单 + 段级增量请求。
 * 结构刻意分成两段：前半是「必须绑定的块」，后半是「这一段还产生了什么新信息」。
 * @param {Object} input
 * @param {{id:string, index:number, chars:number, text:string, blocks:Array}} input.segment
 * @param {string[]} [input.knownNames] 本轮已确认的名字（供绑定参考，不是必须使用）
 * @param {string[]} [input.priorNames] 已抽过的人物名（用于区分「新人物」）
 */
export function buildBindPrompt(input = {}) {
  const segment = input.segment ?? {}
  const blocks = Array.isArray(segment.blocks) ? segment.blocks : []
  const knownNames = Array.isArray(input.knownNames) ? input.knownNames.filter(Boolean) : []
  const priorNames = Array.isArray(input.priorNames) ? input.priorNames.filter(Boolean) : []

  const blockLines = blocks.map((block) => {
    const hint = block.speakerHint ? ` hint=${block.speakerHint}` : ''
    return `[${block.id}] (${block.channelHint}${hint}) ${block.text}`
  })

  return [
    `=== ${segment.id} | 第 ${segment.index} 段 | ${segment.chars} 字 ===`,
    `【本段已切好的块】共 ${blocks.length} 块，逐块给 who 与 ch：`,
    ...blockLines,
    '',
    '【已知人物】（可作 who 的取值，也可写清单外的新名字）',
    knownNames.length ? knownNames.join('、') : '(无)',
    '',
    '【本段新信息】（可选，给不出就留空数组，不要编）',
    '输出同一次 JSON 里追加这三个字段：',
    '- "settings": [{"name":"设定/物品/组织/地点名","slot":"abilities|rules|locations|items|orgs|roles|creatures|concepts|events|other","definition":"一句话定义"}]',
    '  —— 只收**本段第一次出现**、且对后续有意义的名词；路过的普通物件不要收。',
    '- "knowledge": [{"character":"谁","source":"从哪知道的（人名/物件名，不知道就空串）","learned":"一句话学会了什么"}]',
    '  —— 只收**知情状态发生变化**的时刻（第一次听到某秘密、发现某物证）。',
    '- "hooks": ["一句话伏笔/悬念"] —— 只收真正留下的悬念，一段最多 2 条。',
    '',
    priorNames.length
      ? `【已抽过的人物】${priorNames.join('、')} —— 这些人的身份/性格不要再重复描述，只在有新变化时提一句。`
      : '【已抽过的人物】(无)',
    '',
    '【段内原文（仅供你核对块之间的关系，不要再抄一遍）】',
    String(segment.text ?? '')
  ].join('\n')
}

/**
 * 批式绑定：一次请求覆盖多段。批的好处是**固定前缀只发一次**（B3 前缀缓存），
 * 且模型能跨段保持称呼一致（同一批内前后文可见）。
 * @param {{segments: Array, knownNames?: string[], priorNames?: string[]}} input
 */
export function buildBatchBindPrompt(input = {}) {
  const segments = Array.isArray(input.segments) ? input.segments : []
  const knownNames = Array.isArray(input.knownNames) ? input.knownNames.filter(Boolean) : []
  const priorNames = Array.isArray(input.priorNames) ? input.priorNames.filter(Boolean) : []

  const section = segments.map((segment) => {
    const blocks = Array.isArray(segment.blocks) ? segment.blocks : []
    const blockLines = blocks.map((block) => {
      const hint = block.speakerHint ? ` hint=${block.speakerHint}` : ''
      return `  [${block.id}] (${block.channelHint}${hint}) ${block.text}`
    })
    return [
      // id 单独一行且**不加任何前缀**：实测带「段 」前缀时模型会把前缀抄进回包的 id。
      `=== ${segment.id} | 第 ${segment.index} 段 | ${segment.chars} 字 ===`,
      ...blockLines,
      '  【增量】settings:[{name,slot,definition}] knowledge:[{character,source,learned}] hooks:[一句话] aka:[[称呼,称呼]]'
    ].join('\n')
  })

  return [
    `共 ${segments.length} 段。逐段、逐块绑定，输出一次 JSON：`,
    '{"segments":[{"id":"段id","blocks":[{"id":"b1","who":"","ch":"state"}],"settings":[],"knowledge":[],"hooks":[],"aka":[]}]}',
    '',
    '【已知人物】' + (knownNames.length ? knownNames.join('、') : '(无)'),
    priorNames.length ? `【已抽过】${priorNames.join('、')}` : '',
    // 视角规则（v2）：第一人称时叙述者必须是已知人物表第一位，供规则 8 使用。
    input.perspective === 'first' && knownNames.length
      ? `【视角】第一人称 · 叙述者＝${knownNames[0]}：无明确主语的叙事块（do/state/perceive/feel）who 填「${knownNames[0]}」。`
      : '',
    '',
    ...section
  ].filter(Boolean).join('\n')
}

/**
 * 关系抽取的独立窄窗提示词（ADR §5.2 B4「窄窗特写」）。
 *
 * 为什么独立：真跑实测（10 章 / 30 批）主绑定调用里模型**从不填 relations**（0/130 段），
 * 但同一个模型在「只做关系」的窄请求上给出 7 条高质量关系。原因不是能力问题，是**任务性质冲突**：
 * 主绑定要求「不要思考、只贴标签」，关系抽取需要一点推理——混在一次请求里，模型会放弃后者。
 * 所以按 B4 拆开：一次窄窗只回答一个窄问题。
 */
export const RELATION_SYSTEM_PROMPT = [
  '你是实体关系标注器。用户给你一段小说原文（可能分成若干块），',
  '你只做一件事：列出这段原文里**明示的**实体间关系。',
  '',
  '输出 JSON：{"relations":[{"from":"实体名","to":"实体名","type":"关系性质","how":"依据短语"}]}',
  '规则（违反即算错）：',
  '1) from 与 to 必须是原文里**逐字出现**的名字或名词；不要用代词，不要用「X的父亲」这类称谓。',
  '2) type 写关系性质：师徒/敌对/亲属/隶属/持有/位于/交易/同事/朋友…',
  '3) how 用不超过 12 字说明依据（如「三兄妹之一」「一把拿走了怀表」）。',
  '4) 只收**这段原文里能看出**的关系；推测、常识、后文知识一律不要。',
  '5) 没有关系就给 {"relations":[]}——**不要为了填满而编**。',
  '6) 只输出 JSON，不要解释、不要 markdown 围栏。'
].join(String.fromCharCode(10))

/**
 * 关系窄窗的用户消息：一段原文 + 块清单（块给模型看边界，帮助定位实体）。
 * @param {{id:string,index:number,text:string,blocks:Array}} segment
 */
export function buildRelationPrompt(segment = {}) {
  const blocks = Array.isArray(segment.blocks) ? segment.blocks : []
  return [
    `【段 ${segment.id}｜第 ${segment.index} 段】`,
    '【原文】',
    String(segment.text ?? ''),
    '',
    '【块边界（仅供定位，不要复述）】',
    ...blocks.map((block) => `[${block.id}] ${block.text}`),
    '',
    '只输出 {"relations":[{"from":"","to":"","type":"","how":""}]}。'
  ].join(String.fromCharCode(10))
}
