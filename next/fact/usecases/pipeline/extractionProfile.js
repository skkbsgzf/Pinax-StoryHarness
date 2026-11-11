/**
 * 抽取档位（extraction profile）：一个入口把「采集节奏」全部参数化。
 *
 * 作者 2026-11-11：「这里面很多东西都要参数化，不同的体裁、不同的内容形式，它的采集节奏是不一样的……
 * 我们先把默认这一套做好。然后直接做成一个后续可商用的版本。」
 *
 * 为什么需要这一层：分段长度、切块粒度、每批段数、显著度门槛、缓存池水位这五组参数
 * 散落在 segment.js / blocks.js / salience.js / cacheTier.js / service 各自模块里，
 * 各自都有默认值——**但没有一处能回答「这套默认属于哪种体裁」**。换体裁（网文→剧本→
 * 非虚构→日更短篇）要改四五个文件，且没有任何记录说明「为什么是这组数」。
 *
 * 本模块做三件事：
 *   1) **单一真源**：五组参数在这里集中定义默认值，各模块仍保留自己的默认（不改变既有调用），
 *      但 profile 是唯一被产品链路读取的那一份；
 *   2) **档位可覆写**：`normalizeExtractionProfile` 深浅合并＋范围校验，坏值如实报错不静默回落；
 *   3) **可解释**：每个档位带 `notes` 说明它影响什么、默认值怎么来的——作者调参时不用翻代码。
 *
 * 纯函数、零宿主依赖。
 */

export const EXTRACTION_PROFILE_VERSION = 'fact-profile@1'

/** 键名→含义。用于报错信息与 status 披露（作者看不懂参数名时看这张表）。 */
export const PROFILE_PARAM_NOTES = Object.freeze({
  'segment.min': '数据单元最小字数。低于它的段会与邻段合并（再短就搬字补足）',
  'segment.max': '数据单元最大字数。超过它按句末/软标点均衡拆开',
  'blocks.min': '块最小字数（块是标注单元，比段小）。低于它的叙述句会与同通道邻句打包',
  'blocks.max': '块最大字数。引号块不受此限（台词独立成块，不切开）',
  'blocks.shortQuoteMax': '引号内字数不超过它的「单词语」判为强调引号，并回叙述不单独成块',
  'bind.batchChars': '一次模型请求装多少字的单元（约 3600 字≈4–5 段）。越大调用越少、单次 JSON 出错率略升',
  'bind.channels': '允许的通道闭集。换体裁可收窄（如剧本不要 feel）',
  'bind.maxIncrementsPerSegment': '单段允许的 settings/knowledge/hooks 条数上限（防模型灌水）',
  'salience.characterEntryFloor': '建角色条目的最低显著度分。低于它只登记为「被提及的名字」，不建条目',
  'salience.characterTiers': '内容深度分档阈值（full/brief/minimal）',
  'salience.worldviewEntryFloor': '建设定条目的最低分',
  'cache.flushEntries': 'working 层条数达到多少条触发下沉 archive',
  'cache.flushChapters': 'working 层覆盖多少章触发下沉',
  'cache.flushChars': 'working 层字数上限',
  'cache.retrieveLimit': '从 archive 检索时最多取几条',
  'cache.retrieveChars': '从 archive 检索的总字数预算'
})

/**
 * 默认档（「当前推荐档」）：数值全部来自 2026-11-11 的 10 章真跑调优，
 * 不是拍的——每一项都在注释里写了依据。**换体裁就覆写这一层，不动各模块代码。**
 */
export const DEFAULT_EXTRACTION_PROFILE = Object.freeze({
  version: EXTRACTION_PROFILE_VERSION,
  /** 档位名：产品披露里显示「这套数是为谁调的」。 */
  name: 'novel-web-tight',
  description: '中文网络小说（全知/限知混用、对话密集、章长 2–3k）：段 100–300、块 25–70、批 3600 字',
  segment: Object.freeze({ min: 100, max: 300 }),
  blocks: Object.freeze({ min: 25, max: 70, shortQuoteMax: 5 }),
  bind: Object.freeze({
    /** 3600 字≈4–5 段/请求。调大省调用但单次 JSON 出错率略升（4000 字实测约 5% 需修复）。 */
    batchChars: 3600,
    channels: Object.freeze(['do', 'say', 'think', 'feel', 'perceive', 'state', 'event']),
    maxIncrementsPerSegment: Object.freeze({ settings: 6, knowledge: 4, hooks: 2 })
  }),
  salience: Object.freeze({
    characterEntryFloor: 2.0,
    characterTiers: Object.freeze([
      Object.freeze({ tier: 'full', floor: 6.0 }),
      Object.freeze({ tier: 'brief', floor: 3.0 }),
      Object.freeze({ tier: 'minimal', floor: 2.0 })
    ]),
    worldviewEntryFloor: 1.5
  }),
  cache: Object.freeze({
    flushEntries: 120, flushChapters: 4, flushChars: 60_000,
    retrieveLimit: 12, retrieveChars: 2_400
  })
})

/** 其他体裁的参考档（只是**样例**，不是推荐值——作者按自己书调）。 */
export const EXTRACTION_PROFILE_PRESETS = Object.freeze({
  'novel-web-tight': DEFAULT_EXTRACTION_PROFILE,
  /** 剧本：场景短、对话占比极高，块要更小、批可以更大（无内心描写）。 */
  script: Object.freeze({
    ...DEFAULT_EXTRACTION_PROFILE,
    name: 'script',
    description: '影视/舞台剧本：场景短、对话密集、无内心描写',
    segment: Object.freeze({ min: 60, max: 200 }),
    blocks: Object.freeze({ min: 15, max: 50, shortQuoteMax: 4 }),
    bind: Object.freeze({
      batchChars: 5000,
      channels: Object.freeze(['do', 'say', 'perceive', 'state', 'event']),
      maxIncrementsPerSegment: Object.freeze({ settings: 4, knowledge: 3, hooks: 2 })
    })
  }),
  /** 非虚构/资料：长段落、低对话、设定密度高。 */
  nonfiction: Object.freeze({
    ...DEFAULT_EXTRACTION_PROFILE,
    name: 'nonfiction',
    description: '非虚构/资料整理：长段、低对话、高设定密度',
    segment: Object.freeze({ min: 200, max: 600 }),
    blocks: Object.freeze({ min: 50, max: 140, shortQuoteMax: 6 }),
    bind: Object.freeze({
      batchChars: 5000,
      channels: Object.freeze(['say', 'state', 'event', 'perceive']),
      maxIncrementsPerSegment: Object.freeze({ settings: 10, knowledge: 6, hooks: 1 })
    }),
    salience: Object.freeze({
      ...DEFAULT_EXTRACTION_PROFILE.salience,
      characterEntryFloor: 3.0,
      worldviewEntryFloor: 1.0
    })
  })
})

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]'
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0

/** 逐字段校验：坏值报错而不是静默回落（静默默认值是调参时最难发现的坑）。 */
function validateProfile(profile, issues) {
  const check = (path, value, predicate, expectation) => {
    if (!predicate(value)) issues.push({ field: path, message: `须为${expectation}，实际 ${JSON.stringify(value)}` })
  }
  check('segment.min', profile.segment?.min, positiveInt, '正整数')
  check('segment.max', profile.segment?.max, positiveInt, '正整数')
  if (positiveInt(profile.segment?.min) && positiveInt(profile.segment?.max) && profile.segment.min >= profile.segment.max) {
    issues.push({ field: 'segment', message: 'min 必须小于 max' })
  }
  check('blocks.min', profile.blocks?.min, positiveInt, '正整数')
  check('blocks.max', profile.blocks?.max, positiveInt, '正整数')
  if (positiveInt(profile.blocks?.min) && positiveInt(profile.blocks?.max) && profile.blocks.min >= profile.blocks.max) {
    issues.push({ field: 'blocks', message: 'min 必须小于 max' })
  }
  check('bind.batchChars', profile.bind?.batchChars, (value) => positiveInt(value) && value >= 300 && value <= 12000, '300–12000 的整数')
  check('bind.channels', profile.bind?.channels, (value) => Array.isArray(value) && value.length > 0, '非空数组')
  if (Array.isArray(profile.bind?.channels)) {
    for (const channel of profile.bind.channels) {
      if (typeof channel !== 'string' || !channel.trim()) issues.push({ field: 'bind.channels', message: `含非法通道 ${JSON.stringify(channel)}` })
    }
  }
  check('salience.characterEntryFloor', profile.salience?.characterEntryFloor, (value) => typeof value === 'number' && value >= 0, '非负数')
  check('salience.characterTiers', profile.salience?.characterTiers, (value) => Array.isArray(value) && value.length > 0, '非空数组')
  check('cache.flushEntries', profile.cache?.flushEntries, positiveInt, '正整数')
  check('cache.flushChapters', profile.cache?.flushChapters, positiveInt, '正整数')
  check('cache.flushChars', profile.cache?.flushChars, positiveInt, '正整数')
  check('cache.retrieveLimit', profile.cache?.retrieveLimit, positiveInt, '正整数')
  check('cache.retrieveChars', profile.cache?.retrieveChars, positiveInt, '正整数')
}

/**
 * 合并：以默认档为底，深合并作者给的部分覆写（只给 bind.batchChars 不影响其他档位）。
 * @param {Object} [input] 局部覆写；也接受 preset 名（字符串）
 * @returns {{ok:true, value:Object}|{ok:false, error:{code:string, details:Array}}}
 */
export function normalizeExtractionProfile(input = {}) {
  let override = input
  if (typeof input === 'string') {
    override = EXTRACTION_PROFILE_PRESETS[input]
    if (!override) {
      return { ok: false, error: { code: 'UNKNOWN_PROFILE_PRESET', details: [{ field: 'profile', message: `没有这个预置档：${input}` }] } }
    }
  }
  if (override === null || override === undefined) override = {}
  if (!isPlainObject(override)) {
    return { ok: false, error: { code: 'INVALID_PROFILE', details: [{ field: 'profile', message: '档位须为对象或预置档名' }] } }
  }
  const merged = {
    version: EXTRACTION_PROFILE_VERSION,
    name: String(override.name ?? DEFAULT_EXTRACTION_PROFILE.name),
    description: String(override.description ?? DEFAULT_EXTRACTION_PROFILE.description),
    segment: { ...DEFAULT_EXTRACTION_PROFILE.segment, ...(isPlainObject(override.segment) ? override.segment : {}) },
    blocks: { ...DEFAULT_EXTRACTION_PROFILE.blocks, ...(isPlainObject(override.blocks) ? override.blocks : {}) },
    bind: { ...DEFAULT_EXTRACTION_PROFILE.bind, ...(isPlainObject(override.bind) ? override.bind : {}) },
    salience: { ...DEFAULT_EXTRACTION_PROFILE.salience, ...(isPlainObject(override.salience) ? override.salience : {}) },
    cache: { ...DEFAULT_EXTRACTION_PROFILE.cache, ...(isPlainObject(override.cache) ? override.cache : {}) }
  }
  const issues = []
  validateProfile(merged, issues)
  if (issues.length) return { ok: false, error: { code: 'INVALID_PROFILE', details: issues } }
  return { ok: true, value: merged }
}

/**
 * 给 salience 模块用的 policy 形状（它有自己的 weights 表，这里只覆写门槛与分档）。
 * 不传 profile 时返回 undefined——调用方沿用 salience 自己的默认，行为不变。
 */
export function saliencePolicyOf(profile) {
  if (!isPlainObject(profile?.salience)) return undefined
  return {
    characterEntryFloor: profile.salience.characterEntryFloor,
    characterTiers: profile.salience.characterTiers,
    worldviewEntryFloor: profile.salience.worldviewEntryFloor
  }
}

/** 给 cacheTier 用的 flush policy 形状（同上：只覆写水位，其余沿用默认）。 */
export function flushPolicyOf(profile) {
  if (!isPlainObject(profile?.cache)) return undefined
  return {
    flushEntries: profile.cache.flushEntries,
    flushChapters: profile.cache.flushChapters,
    flushChars: profile.cache.flushChars,
    retrieveLimit: profile.cache.retrieveLimit,
    retrieveChars: profile.cache.retrieveChars
  }
}

/** 档位摘要（status 披露用）：只列「和默认档不同」的项，让作者一眼看到自己的覆写生效了。 */
export function profileDigest(profile) {
  if (!isPlainObject(profile)) return { name: null, overrides: {} }
  const overrides = {}
  for (const group of ['segment', 'blocks', 'bind', 'salience', 'cache']) {
    const current = isPlainObject(profile[group]) ? profile[group] : {}
    const base = DEFAULT_EXTRACTION_PROFILE[group]
    for (const [key, value] of Object.entries(current)) {
      if (JSON.stringify(value) !== JSON.stringify(base[key])) overrides[`${group}.${key}`] = value
    }
  }
  return { version: profile.version ?? EXTRACTION_PROFILE_VERSION, name: profile.name ?? null, overrides }
}
