/**
 * 剧本 md 区块词法契约（v1）——把「场/人物/动作/台词/内心/参考」变成可解析的结构。
 *
 * 为什么需要它（P-TRIM SCRIPT-1 / guimi A4）：剧本载体现在只把 `剧本/**\/*.md` 当纯 md 渲染，
 * `hubToScriptSkeleton` 产出的也只是 `# 第N集` ＋ 引用行 ＋「（场次待写）」。
 * 谁真要写剧本，格式只能各自临场定（guimi 轮就是这么干出来的 130 场），
 * 面板不会校验、不会高亮、不能结构化。本契约把那份事实标准固化成词法，双侧（写入/渲染）共用。
 *
 * 词法（每行一个区块，行首标记定类型；空行与非标记行是正文续行，归上一区块或散文）：
 *
 *   # 第N集 标题                      集头（正则：^#\s*第\s*(\d+)\s*集\s*(.*)$）
 *   ## 场N 〔时〕 〔地〕                场头（正则见 SCENE_HEADING；时/地是可选的〔〕段，0–2 个）
 *   **人物**：甲、乙                    在场人物（正则：^\*\*人物\*\*\s*[:：]\s*(.+)$）
 *   （感知·克莱恩）正文                  通道行：channel ∈ CHANNELS，角色名可缺（缺＝本场主视角）
 *   *克莱恩：动作或神态*                 动作行（斜体包裹；冒号后是动作内容）
 *   **克莱恩**：「台词」                 台词行（角色加粗＋可选的「说话方式」在前一动作行里）
 *   参考：@《实体》 @《实体》            引用行（复用 agentReferences 的 @《…》 token 口径）
 *   其余                                 散文行（归属上一条场/集；不报错，但计入 stats.prose）
 *
 * 解析语义（三条纪律）：
 *   1) **只认标记，不猜语义**：不认识的行一律进 prose，不硬塞成台词或动作；
 *   2) **行号可溯源**：每个区块带 line（1 基），便于 UI 定位与错误提示；
 *   3) **序列化可往返**：parse → serialize 得到**逐字节相同**的文本（空行处理见 serializeScript 注释）。
 *
 * 纯函数、零宿主依赖：不读盘、不 import 宿主模块（渲染层可直接引用）。
 */

export const SCRIPT_LEXICON_VERSION = 'script-lexicon/v1'

/** 通道词表（与抽取行的 channel 对齐：剧本只表达可演的感知/动作/台词/内心；event 是「客观发生」不带角色）。 */
export const SCRIPT_CHANNELS = Object.freeze({
  perceive: '感知',
  feel: '感受',
  state: '状态',
  do: '动作',
  say: '台词',
  think: '内心',
  recall: '回想',
  event: '事件'
})

const CHANNEL_LABELS = Object.freeze(Object.values(SCRIPT_CHANNELS))
const LABEL_TO_KEY = Object.freeze(Object.fromEntries(Object.entries(SCRIPT_CHANNELS).map(([key, label]) => [label, key])))

const RE_EPISODE = /^#\s*第\s*(\d+)\s*集\s*(.*)$/u
const RE_SCENE = /^##\s*场\s*(\d+)\s*(.*)$/u
const RE_CAST = /^\*\*人物\*\*\s*[:：]\s*(.+)$/u
// 通道行：左组取到**第一个**「·」为止（角色名本身可含「·」，如「罗塞尔·古斯塔夫」）。
const RE_CHANNEL = /^（([^）·]+)·([^）]+)）\s*(.*)$/u
const RE_ACTION = /^\*([^*：:]+)\s*[:：]\s*(.+)\*$/u
const RE_DIALOGUE = /^\*\*([^*]+)\*\*\s*[:：]\s*(.+)$/u
const RE_REFS = /^\s*参考\s*[:：]\s*(.*)$/u
const RE_BRACKET = /〔([^〕]*)〕/gu

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

/** 场头的〔时〕〔地〕段：0–2 个，按出现序给 time／place（第 3 个起不进字段，留在 raw 里）。 */
function sceneSlots(text) {
  const slots = [...str(text).matchAll(RE_BRACKET)].map((match) => trimmed(match[1])).filter(Boolean)
  return { time: slots[0] ?? '', place: slots[1] ?? '', extras: slots.slice(2) }
}

/** 「参考：@《甲》 @《乙》」→ 引用标题数组（去重保序；不完整 token 丢弃）。 */
function parseRefLine(text) {
  const titles = []
  for (const match of str(text).matchAll(/@《([^》]+)》/gu)) {
    const title = trimmed(match[1])
    if (title && !titles.includes(title)) titles.push(title)
  }
  return titles
}

/**
 * 解析剧本 md。
 * @param {string} text
 * @returns {{ok:true, version:string, episodes:Array, counts:Object}}
 *   episodes: [{index, title, line, scenes:[{index, time, place, extras, line, cast:[], blocks:[], refs:[], prose:[]}]}]
 *   blocks:   [{type:'channel'|'action'|'dialogue', line, ...}]
 */
export function parseScript(text) {
  const lines = str(text).replace(/\r\n?/g, '\n').split('\n')
  const episodes = []
  let episode = null
  let scene = null
  const counts = { episodes: 0, scenes: 0, channel: 0, action: 0, dialogue: 0, cast: 0, refs: 0, prose: 0, orphan: 0 }

  const ensureEpisode = (index, title, line) => {
    // note：集头下紧跟的散文（如「（本集由…转换而来；共 9 场）」）挂到这里——
    // 落进 episode.note 而不是丢掉，否则 serialize 往返就少一行（真实剧本实测的往返差异根因）。
    episode = { index, title: trimmed(title), line, note: '', scenes: [] }
    episodes.push(episode)
    counts.episodes += 1
    return episode
  }
  const ensureScene = (index, rest, line) => {
    const slots = sceneSlots(rest)
    scene = { index, time: slots.time, place: slots.place, extras: slots.extras, line, cast: [], blocks: [], refs: [], prose: [] }
    if (!episode) { ensureEpisode(null, '', line) } // 场先于集出现：容错建一个匿名集，孤儿场不丢
    episode.scenes.push(scene)
    counts.scenes += 1
    return scene
  }

  for (const [position, raw] of lines.entries()) {
    const line = position + 1
    const value = raw.trimEnd()
    const textValue = value.trim()
    if (!textValue) continue

    const episodeMatch = RE_EPISODE.exec(textValue)
    if (episodeMatch) {
      ensureEpisode(Number(episodeMatch[1]), episodeMatch[2], line)
      scene = null
      continue
    }
    const sceneMatch = RE_SCENE.exec(textValue)
    if (sceneMatch) {
      ensureScene(Number(sceneMatch[1]), sceneMatch[2], line)
      continue
    }
    const castMatch = RE_CAST.exec(textValue)
    if (castMatch) {
      const names = str(castMatch[1]).split(/[、,，/／\s]+/u).map(trimmed).filter(Boolean)
      if (!scene) ensureScene(null, '', line)
      for (const name of names) if (!scene.cast.includes(name)) scene.cast.push(name)
      counts.cast += names.length
      continue
    }
    const refsMatch = RE_REFS.exec(textValue)
    if (refsMatch) {
      const titles = parseRefLine(refsMatch[1])
      if (!scene) { ensureScene(null, '', line) }
      for (const title of titles) if (!scene.refs.includes(title)) scene.refs.push(title)
      counts.refs += titles.length
      continue
    }
    const channelMatch = RE_CHANNEL.exec(textValue)
    if (channelMatch) {
      // 通道行：`（标签·角色）正文`。分隔符是**第一个**「·」——角色名本身可能带「·」
      // （真实剧本实测：`（事件·罗塞尔·古斯塔夫）`＝channel 事件、who 罗塞尔·古斯塔夫）。
      // 标签不在词表时 channel='other'，label 原样保留（不猜语义）。
      const rawLeft = trimmed(channelMatch[1])
      const content = trimmed(channelMatch[3])
      const split = rawLeft.indexOf('·')
      const label = split >= 0 ? trimmed(rawLeft.slice(0, split)) : rawLeft
      const who = split >= 0 ? trimmed(rawLeft.slice(split + 1)) : trimmed(channelMatch[2])
      // 兼容旧写法：`（感知·克莱恩）`（正则第二组已是角色名）与 `（事件·罗塞尔）`（同形）
      const channel = LABEL_TO_KEY[label] ?? null
      if (!scene) ensureScene(null, '', line)
      scene.blocks.push({ type: 'channel', line, channel: channel ?? 'other', label, who, content })
      counts.channel += 1
      continue
    }
    const dialogueMatch = RE_DIALOGUE.exec(textValue)
    if (dialogueMatch) {
      if (!scene) ensureScene(null, '', line)
      scene.blocks.push({ type: 'dialogue', line, who: trimmed(dialogueMatch[1]), text: trimmed(dialogueMatch[2]) })
      counts.dialogue += 1
      continue
    }
    const actionMatch = RE_ACTION.exec(textValue)
    if (actionMatch) {
      if (!scene) ensureScene(null, '', line)
      scene.blocks.push({ type: 'action', line, who: trimmed(actionMatch[1]), text: trimmed(actionMatch[2]) })
      counts.action += 1
      continue
    }
    // 其余：散文行。在场里→场 prose；不在场但已开集→集 note（往返不丢）；都没有→孤儿
    if (scene) {
      scene.prose.push({ line, text: textValue })
      counts.prose += 1
    } else if (episode) {
      episode.note = episode.note ? `${episode.note}\n${textValue}` : textValue
      counts.prose += 1
    } else {
      counts.orphan += 1
    }
  }
  return { ok: true, version: SCRIPT_LEXICON_VERSION, episodes, counts }
}

const pad = (value) => String(value).padStart(2, '0')

/**
 * 结构化剧本 → md（parse 的逆运算）。
 * 空行处理：集头后空一行、场头后空一行、`**人物**` 后空一行、引用行前空一行、集与集之间空一行
 * ——与 guimi 轮实际产出的格式逐字节一致（parse→serialize 往返相同）。
 */
export function serializeScript(doc = {}) {
  const episodes = Array.isArray(doc?.episodes) ? doc.episodes : []
  const chunks = []
  for (const [episodePosition, episode] of episodes.entries()) {
    const header = `# 第${episode.index ?? episodePosition + 1}集${episode.title ? ` ${episode.title}` : ''}`
    const lines = [header]
    if (trimmed(episode.note)) { lines.push('', trimmed(episode.note)) }
    lines.push('')
    const scenes = Array.isArray(episode.scenes) ? episode.scenes : []
    for (const [scenePosition, scene] of scenes.entries()) {
      const slots = [trimmed(scene.time), trimmed(scene.place), ...(Array.isArray(scene.extras) ? scene.extras.map(trimmed) : [])].filter(Boolean)
      lines.push(`## 场${scene.index ?? scenePosition + 1}${slots.map((slot) => ` 〔${slot}〕`).join('')}`)
      lines.push('')
      const cast = Array.isArray(scene.cast) ? scene.cast.map(trimmed).filter(Boolean) : []
      if (cast.length) {
        lines.push(`**人物**：${cast.join('、')}`)
        lines.push('')
      }
      for (const block of Array.isArray(scene.blocks) ? scene.blocks : []) {
        if (block?.type === 'channel') {
          const label = trimmed(block.label) || SCRIPT_CHANNELS[block.channel] || '感知'
          lines.push(`（${label}·${trimmed(block.who)}）${str(block.content)}`)
        } else if (block?.type === 'dialogue') {
          lines.push(`**${trimmed(block.who)}**：${str(block.text)}`)
        } else if (block?.type === 'action') {
          lines.push(`*${trimmed(block.who)}：${str(block.text)}*`)
        }
      }
      for (const line of Array.isArray(scene.prose) ? scene.prose : []) {
        const content = trimmed(line?.text ?? line)
        if (content) lines.push(content)
      }
      const refs = Array.isArray(scene.refs) ? scene.refs.map(trimmed).filter(Boolean) : []
      if (refs.length) {
        lines.push('')
        lines.push(`参考：${refs.map((title) => `@《${title}》`).join(' ')}`)
      }
      lines.push('')
    }
    chunks.push(lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd())
  }
  return chunks.join('\n\n') + (chunks.length ? '\n' : '')
}

/**
 * 契约校验（写入前用）：只查结构性错误，不评判剧作质量。
 * @returns {{ok:boolean, errors:Array, warnings:Array}}
 */
export function validateScriptDocument(doc = {}) {
  const errors = []
  const warnings = []
  const episodes = Array.isArray(doc?.episodes) ? doc.episodes : []
  if (!episodes.length) errors.push({ field: 'episodes', message: '剧本至少要有一集' })
  const seenEpisodes = new Set()
  for (const [episodePosition, episode] of episodes.entries()) {
    const episodeIndex = episode?.index ?? episodePosition + 1
    if (seenEpisodes.has(episodeIndex)) errors.push({ field: `episodes[${episodePosition}].index`, message: `集号重复：${episodeIndex}` })
    seenEpisodes.add(episodeIndex)
    const scenes = Array.isArray(episode?.scenes) ? episode.scenes : []
    if (!scenes.length) warnings.push({ field: `episodes[${episodePosition}].scenes`, message: `第${episodeIndex}集没有场` })
    for (const [scenePosition, scene] of scenes.entries()) {
      const field = `episodes[${episodePosition}].scenes[${scenePosition}]`
      const blocks = Array.isArray(scene?.blocks) ? scene.blocks : []
      if (!blocks.length && !(Array.isArray(scene?.prose) && scene.prose.length)) {
        warnings.push({ field, message: `第${episodeIndex}集场${scene?.index ?? scenePosition + 1}没有任何区块` })
      }
      for (const [blockPosition, block] of blocks.entries()) {
        if (!['channel', 'action', 'dialogue'].includes(str(block?.type))) {
          errors.push({ field: `${field}.blocks[${blockPosition}].type`, message: `未知区块类型：${str(block?.type)}` })
        }
        if (block?.type !== 'channel' && !trimmed(block?.who)) {
          errors.push({ field: `${field}.blocks[${blockPosition}].who`, message: '动作/台词必须带角色名' })
        }
        if (block?.type === 'channel' && block?.channel === 'other') {
          warnings.push({ field: `${field}.blocks[${blockPosition}].channel`, message: `未知通道「${str(block.label)}」，将按原样保留` })
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** 剧本 doc → 每场的可演摘要（UI 场次列表用：场号＋时/地＋人物＋首句）。 */
export function sceneSummaries(doc = {}) {
  const out = []
  for (const episode of Array.isArray(doc?.episodes) ? doc.episodes : []) {
    for (const scene of Array.isArray(episode?.scenes) ? episode.scenes : []) {
      const first = (Array.isArray(scene?.blocks) ? scene.blocks : []).find((block) => block?.type === 'dialogue')
        ?? (Array.isArray(scene?.blocks) ? scene.blocks[0] : null)
      out.push({
        episode: episode?.index ?? null,
        scene: scene?.index ?? null,
        label: `第${episode?.index ?? '?'}集·场${scene?.index ?? '?'}`,
        where: [trimmed(scene?.time), trimmed(scene?.place)].filter(Boolean).join(' / '),
        cast: Array.isArray(scene?.cast) ? [...scene.cast] : [],
        opening: first ? (first.type === 'dialogue' ? `${first.who}：「${first.text}」` : `${first.who} ${first.content ?? first.text ?? ''}`.trim()) : '',
        line: scene?.line ?? null
      })
    }
  }
  return out
}

/** 剧本 doc → 时间轴（按场序展平成可拍清单；空场也列出，序号不断档）。 */
export function scriptTimeline(doc = {}) {
  return sceneSummaries(doc).map((scene, position) => ({ ...scene, order: position + 1, shot: `S${pad(position + 1)}` }))
}
