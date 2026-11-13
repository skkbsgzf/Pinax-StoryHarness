/**
 * wiki 派生（S4 · WO-S4-01）：从 `devtools/build-wiki.mjs` 原样搬入内核的派生核心。
 *
 * 搬的是**算法**，不是页壳：buildBook 里的 HTML 拼装、SVG 生成、OpenDesign 设计系统解析
 * （extractPalette／resolveDesignSystem）一概不搬——这里只产纯 JSON，供 `fact:wiki:get`／
 * `fact:wiki:derive` 两通道与前端五页签消费。devtools 版保留作对照。
 *
 * 输入：拆解信封（`{book, source, entries, quality, perspective}`）或 entries 数组；
 * 输出：`deriveWiki()` 返回的对象。字段与 wiki-enrich 写出的 `result.wiki` 对齐，并追加
 * buildBook 原本只塞进 HTML `DETAIL` 的派生字段（chapters/characters/matrix/…）。
 * 输出先摊开传入的 wiki（增补窄窗的 characterProfiles／chapterSummaries／foreshadows 等），
 * 再覆盖派生字段——重复派生不丢增补，也不改变结果（纯函数幂等）。
 *
 * 伪章节切分与 `devtools/lib/pseudoChapters.mjs` 同式（内核不能反向依赖 devtools，
 * 故原样复制；enrich 与本侧用同一公式，伪章号才对得上）。
 */

/** 章标题：从原文提取（「第1章 相亲」）。无章节标记的书返回空表。 */
const CHAPTER_TITLE_LINE = /^[ \t\u3000]*(第\s*\d+\s*章[^\n]*)$/gmu

/** plot 的最小段号（事件缺失时退 Infinity，归最后一节）。 */
export function plotMinSegment(plot) {
  const indexes = (plot.events ?? []).flatMap((event) => (event.segments ?? []).map((segment) => segment.index)).filter(Number.isFinite)
  return indexes.length ? Math.min(...indexes) : Infinity
}

/** 伪章节数：每节约 2200 字，4–12 节封顶。 */
export function pseudoChapterCount(totalChars) {
  return Math.max(4, Math.min(12, Math.round(totalChars / 2200)))
}

/**
 * 按段号把全书均分成 K 节：每个 plot 落进其最小段号所在的节。
 * @param {Array} plots plot 条目数组
 * @param {number} totalChars 全文实际字数（source.chars ?? book.word_count）
 * @returns {{ no, title, segStart, segEnd, plots }[]}
 */
export function derivePseudoChapters(plots, totalChars) {
  if (!plots.length) return []
  const count = pseudoChapterCount(totalChars)
  const withSeg = plots.map((plot) => ({ plot, minSeg: plotMinSegment(plot) }))
  const known = withSeg.filter((item) => Number.isFinite(item.minSeg))
  if (!known.length) {
    // 全部无段信息：按 plot 计数均分成一节
    return [{ no: 1, title: '第 1 节', segStart: 0, segEnd: 0, plots }]
  }
  const segMin = Math.min(...known.map((item) => item.minSeg))
  const segMax = Math.max(...known.map((item) => item.minSeg))
  const width = Math.max(1, (segMax - segMin + 1) / count)

  const byNo = new Map()
  for (const item of withSeg) {
    // 无段信息的 plot 归最后一节
    const no = Number.isFinite(item.minSeg)
      ? Math.min(count, Math.max(1, Math.floor((item.minSeg - segMin) / width) + 1))
      : count
    if (!byNo.has(no)) byNo.set(no, [])
    byNo.get(no).push(item.plot)
  }

  return [...byNo.keys()].sort((a, b) => a - b).map((no) => {
    const group = byNo.get(no)
    const segs = group.map(plotMinSegment).filter(Number.isFinite)
    return {
      no,
      title: `第 ${no} 节`,
      segStart: segs.length ? Math.min(...segs) : 0,
      segEnd: segs.length ? Math.max(...segs) : 0,
      plots: group
    }
  })
}

/** 真章书判定：distinct validity.from > 1 即有真章，不走伪章。 */
export function hasRealChapters(plots) {
  return new Set(plots.map((plot) => plot.validity?.from).filter(Number.isInteger)).size > 1
}

/** 章标题表：原文里的「第N章 …」行 → Map<章号, 标题>。 */
export function chapterTitlesFromSource(text) {
  const map = new Map()
  for (const match of String(text ?? '').matchAll(CHAPTER_TITLE_LINE)) {
    const number = /^第\s*(\d+)\s*章/u.exec(match[1])
    if (number) map.set(Number(number[1]), match[1].trim())
  }
  return map
}

/** 人物派生：言行逐字 + 增补档案（identity/personality/summary）。 */
function deriveCharacter(entry, plots, profile) {
  const name = entry.name
  const aliases = entry.aliases ?? []
  const allNames = [name, ...aliases]
  const involved = plots.filter((plot) => {
    if ((plot.who ?? []).some((who) => allNames.includes(who))) return true
    return (plot.events ?? []).some((event) => allNames.includes(event.who))
  })
  const chapters = [...new Set(involved.map((plot) => plot.validity?.from).filter(Number.isInteger))].sort((a, b) => a - b)

  const speech = [...new Set([
    ...(entry.anchors?.speech ?? []),
    ...involved.flatMap((plot) => (plot.events ?? []).filter((event) => event.channel === 'say' && allNames.includes(event.who)).map((event) => event.content))
  ])].filter((line) => String(line).trim().length >= 6)

  const behavior = [...new Set([
    ...(entry.anchors?.behavior ?? []),
    ...involved.flatMap((plot) => (plot.events ?? []).filter((event) => event.channel === 'do' && allNames.includes(event.who)).map((event) => event.content))
  ])].filter((line) => String(line).trim().length >= 8)

  const cooccur = new Map()
  for (const plot of involved) {
    for (const other of plot.who ?? []) {
      if (allNames.includes(other)) continue
      cooccur.set(other, (cooccur.get(other) ?? 0) + 1)
    }
  }

  // 关系边：直接引用 + 别名都算（边可能来自「我→林逸」这类代词映射后的实体名）
  const edges = []
  const seen = new Set()
  for (const plot of plots) {
    for (const edge of plot.relations ?? []) {
      const from = edge.from, to = edge.to
      const involves = allNames.includes(from) ? { other: to, dir: 'out' }
        : allNames.includes(to) ? { other: from, dir: 'in' } : null
      if (!involves) continue
      const key = `${involves.other}|${edge.type}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ other: involves.other, dir: involves.dir, type: edge.type, how: edge.how ?? '' })
    }
  }

  return {
    name,
    aliases,
    identity: profile?.identity || entry.identity || '',
    archetype: profile?.archetype || '',
    goal: profile?.goal || '',
    personality: profile?.personality?.length ? profile.personality : (entry.traits ?? []),
    arc: profile?.arc ?? null,
    keyChoices: profile?.keyChoices ?? [],
    mirror: profile?.mirror || '',
    summary: profile?.summary || '',
    castTier: entry.castRole?.tier ?? null,
    appearances: involved.length,
    chapters,
    speech: speech.slice(0, 12),
    speechTotal: speech.length,
    behavior: behavior.slice(0, 10),
    cooccur: [...cooccur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    edges
  }
}

/** 三色标注：每章首次出场的人物。 */
function firstAppearances(plots, characters) {
  const firstCh = new Map()
  for (const person of characters) {
    const allNames = [person.name, ...(person.aliases ?? [])]
    for (const plot of plots) {
      const chapter = plot.validity?.from
      const present = (plot.who ?? []).some((who) => allNames.includes(who))
        || (plot.events ?? []).some((event) => allNames.includes(event.who))
      if (present && Number.isInteger(chapter)) {
        if (!firstCh.has(person.name) || chapter < firstCh.get(person.name)) firstCh.set(person.name, chapter)
        break
      }
    }
  }
  const byChapter = new Map()
  for (const [name, chapter] of firstCh) {
    if (!byChapter.has(chapter)) byChapter.set(chapter, [])
    byChapter.get(chapter).push(name)
  }
  return byChapter
}

/** 词条派生：world 层条目（当前 v3 管线为空，留好路径；mentions 从关系边统计）。 */
function deriveTerms(entries, plots, wiki = null) {
  const factTerms = entries.filter((entry) => entry.layer === 'world').map((entry) => {
    const mentions = plots.reduce((sum, plot) => sum + (plot.relations ?? []).filter((edge) => edge.from === entry.name || edge.to === entry.name).length, 0)
    const chapters = [...new Set(plots.filter((plot) =>
      (plot.who ?? []).includes(entry.name) || (plot.events ?? []).some((event) => event.who === entry.name)
    ).map((plot) => plot.validity?.from).filter(Number.isInteger))].sort((a, b) => a - b)
    const edges = plots.flatMap((plot) => (plot.relations ?? []).filter((edge) => edge.from === entry.name || edge.to === entry.name)
      .map((edge) => ({ person: edge.from === entry.name ? edge.to : edge.from, type: edge.type, how: edge.how ?? '' })))
    return { name: entry.name, kind: '设定', desc: entry.definition ?? '', mentions, chapters, edges }
  })
  // 世界要素（图谱一等公民同源）：场景/道具按权重（出现章数）入 wiki 词条
  const we = wiki?.worldElements ?? null
  const sceneTerms = (we?.scenes ?? []).map((scene) => ({ name: scene.name, kind: '场景', desc: scene.desc, mentions: scene.chapters.length, chapters: scene.chapters, edges: [] }))
  const itemTerms = (we?.items ?? []).map((item) => ({ name: item.name, kind: '道具', desc: `${item.desc}${item.holder ? `（掌握者：${item.holder}）` : ''}`, mentions: item.chapters.length, chapters: item.chapters, edges: [] }))
  return [...factTerms, ...sceneTerms, ...itemTerms]
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** 碎片降噪（显示侧过滤，不改 fact 数据）：绑定噪声与副词类 who。 */
const NOISE_NAMES = new Set(['最后', '然后', '突然', '继续', '应该', '生怕', '疑惑', '记得', '招呼', '简洁', '勇气', '心头', '自己', '相亲', '甚至', '许久才', '原来', '终于'])

/**
 * @param {object|Array} input 拆解信封（`{book, source, entries, quality, perspective}`）或 entries 数组
 * @param {object} [options]
 * @param {object|null} [options.wiki] 增补窄窗（readFactWiki 的 wiki；两代兼容由调用方完成）
 * @param {string} [options.sourceText] 正文全文（取章标题用；不给则章标题回退「第 N 章」）
 * @param {object} [options.book] 覆盖信封里的 book（`{id,title,author,word_count,subject_group,length_tier,url}`）
 * @param {object|null} [options.quality] 覆盖信封里的 quality（`{traceableRate}`）
 * @param {string|null} [options.perspective] 覆盖视角
 * @param {string} [options.id] bookId 兜底（信封 book.id 缺失时）
 * @returns {object} 纯 JSON（无 HTML/SVG/设计系统）。
 */
export function deriveWiki(input, options = {}) {
  const envelope = Array.isArray(input) ? { entries: input } : (isPlainObject(input) ? input : {})
  const entries = Array.isArray(envelope.entries) ? envelope.entries : []
  const wiki = isPlainObject(options.wiki) ? options.wiki : (isPlainObject(envelope.wiki) ? envelope.wiki : null)
  const book = isPlainObject(options.book) ? options.book : (isPlainObject(envelope.book) ? envelope.book : {})
  const source = isPlainObject(envelope.source) ? envelope.source : {}
  const quality = isPlainObject(options.quality) ? options.quality : (isPlainObject(envelope.quality) ? envelope.quality : {})
  const perspective = options.perspective ?? envelope.perspective ?? wiki?.perspective ?? null
  const id = options.id ?? book.id ?? null

  const plots = entries.filter((entry) => entry?.layer === 'plot')
  const characterEntries = entries.filter((entry) => entry?.layer === 'character')

  const enrichProfile = (name) => wiki?.characterProfiles?.find((item) => item.name === name) ?? null
  const chapterSummary = (chapter) => wiki?.chapterSummaries?.find((item) => item.chapter === chapter)?.summary ?? ''

  const chapterTitles = chapterTitlesFromSource(options.sourceText ?? '')

  // 按章分组：真章按 validity.from；无章节标记的书按段号切伪章
  const usePseudo = !hasRealChapters(plots)
  const byChapter = new Map()
  if (usePseudo) {
    for (const group of derivePseudoChapters(plots, source.chars ?? book.word_count ?? 0)) {
      byChapter.set(group.no, group.plots)
    }
  } else {
    const chapterOf = (plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : null)
    for (const plot of plots) {
      const chapter = chapterOf(plot)
      if (chapter === null) continue
      if (!byChapter.has(chapter)) byChapter.set(chapter, [])
      byChapter.get(chapter).push(plot)
    }
  }
  const chapterNumbers = [...byChapter.keys()].sort((a, b) => a - b)
  // 伪章标题优先用增补小标题（enrich 与本侧用同一伪章切分公式，章号对得上）
  const enrichTitle = (no) => (usePseudo ? (wiki?.chapterSummaries?.find((item) => item.chapter === no)?.title ?? '') : '')
  const chapterInfo = (no) => wiki?.chapterSummaries?.find((item) => item.chapter === no) ?? null

  // 人物派生
  const charactersAll = characterEntries.map((entry) => deriveCharacter(entry, plots, enrichProfile(entry.name)))
  const characters = charactersAll.filter((c) => !NOISE_NAMES.has(c.name) && (c.appearances >= 3 || c.identity || c.summary || c.archetype))
  const firstByChapter = firstAppearances(plots, characters)

  // 章数据（大纲/单章/时间线共用）
  const chapters = chapterNumbers.map((no) => {
    const chapterPlots = byChapter.get(no) ?? []
    const events = chapterPlots.flatMap((plot) => plot.events ?? [])
    return {
      no,
      title: enrichTitle(no) || (chapterTitles.get(no) ?? (usePseudo ? `第 ${no} 节` : `第 ${no} 章`)),
      summary: chapterSummary(no),
      // 细化层（kb/deconstruct/protocol）：章节功能九类＋核心情绪＋剧情点密度
      function: chapterInfo(no)?.function ?? '',
      emotion: chapterInfo(no)?.emotion ?? '',
      beats: chapterInfo(no)?.beats ?? null,
      segments: chapterPlots.length,
      events: events.length,
      chars: [...new Set(chapterPlots.flatMap((plot) => plot.who ?? []))],
      // 伏笔：语义层来自增补窄窗（wiki.foreshadows）；绑定层 hooks（v3 恒空）留作兜底
      foreshadow: [...new Set([
        ...(wiki?.foreshadows ?? []).filter((hook) => hook.chapter === no).map((hook) => String(hook.text)),
        ...chapterPlots.flatMap((plot) => plot.hooks ?? [])
      ])],
      newChars: firstByChapter.get(no) ?? []
    }
  })

  // 词条（world 层；当前为空）
  const terms = deriveTerms(entries, plots, wiki)

  // 知识图谱：节点＝人物＋事件＋场景/道具；边＝关系窄窗＋同场共现＋事件↔在场者
  const pairKey = (a, b) => [a, b].sort().join('|')
  const unitLabel = usePseudo ? '节' : '章'
  const eventNodeId = (no) => `事件·第${no}${unitLabel}`
  const graphEdges = []
  const edgeSeen = new Set()
  const addEdge = (a, b, type, weight) => {
    if (a === b) return
    const key = pairKey(a, b)
    if (edgeSeen.has(key)) return
    edgeSeen.add(key)
    graphEdges.push({ a, b, type, weight })
  }

  // ① 关系窄窗（两端都已知才收）
  const knownNames = new Set([...characters.map((c) => c.name), ...terms.map((t) => t.name)])
  for (const plot of plots) {
    for (const edge of plot.relations ?? []) {
      if (!knownNames.has(edge.from) || !knownNames.has(edge.to)) continue
      addEdge(edge.from, edge.to, edge.type)
    }
  }

  // ② 同场共现（确定性，≥2 次）
  const coCount = new Map()
  for (const plot of plots) {
    const who = [...new Set((plot.who ?? []).filter((name) => knownNames.has(name)))]
    for (let i = 0; i < who.length; i++) {
      for (let j = i + 1; j < who.length; j++) {
        const key = pairKey(who[i], who[j])
        coCount.set(key, (coCount.get(key) ?? 0) + 1)
      }
    }
  }
  const related = new Set(graphEdges.map((edge) => pairKey(edge.a, edge.b)))
  for (const [key, count] of [...coCount.entries()].filter(([key, count]) => count >= 2 && !related.has(key)).sort((a, b) => b[1] - a[1]).slice(0, 60)) {
    const [a, b] = key.split('|')
    addEdge(a, b, '同场', count)
  }

  // ③ 事件 ↔ 人物/场景/道具（结构性边：事件是图谱的一等公民，靠它把场景道具接进来）
  const eventNodes = []
  const sceneTermByName = new Map(terms.filter((t) => t.kind === '场景').map((t) => [t.name, t]))
  const itemTermByName = new Map(terms.filter((t) => t.kind === '道具').map((t) => [t.name, t]))
  const we = wiki?.worldElements ?? null
  for (const chapter of chapters) {
    const chapterPlots = byChapter.get(chapter.no) ?? []
    // 该节在场人物（按出现次数加权）
    const presence = new Map()
    for (const plot of chapterPlots) {
      for (const who of plot.who ?? []) if (knownNames.has(who)) presence.set(who, (presence.get(who) ?? 0) + 1)
    }
    // 该节涉及场景/道具（worldElements 的 chapters 列表）
    const scenes = (we?.scenes ?? []).filter((scene) => scene.chapters.includes(chapter.no))
    const items = (we?.items ?? []).filter((item) => item.chapters.includes(chapter.no))
    const beats = wiki?.chapterSummaries?.find((s) => s.chapter === chapter.no)?.beats ?? 1
    const nodeId = eventNodeId(chapter.no)
    eventNodes.push({
      id: nodeId,
      kind: 'event',
      r: 5 + Math.min(6, beats),
      label: chapter.title,
      no: chapter.no
    })
    for (const [name, count] of presence) addEdge(nodeId, name, '在场', count)
    for (const scene of scenes) {
      const target = sceneTermByName.get(scene.name)
      if (target) addEdge(nodeId, target.name, '发生于', 1)
    }
    for (const item of items) {
      const target = itemTermByName.get(item.name)
      if (target) addEdge(nodeId, target.name, '使用', 1)
    }
  }

  const maxApp = Math.max(...characters.map((c) => c.appearances), 1)
  const maxWeight = Math.max(...terms.map((t) => t.mentions), 1)
  const charGraph = {
    nodes: [
      ...characters.map((c) => ({ id: c.name, kind: 'person', r: 6 + Math.round(Math.sqrt(c.appearances / maxApp) * 10), label: c.name })),
      ...eventNodes,
      ...terms.map((t) => ({
        id: t.name,
        kind: t.kind === '场景' ? 'scene' : t.kind === '道具' ? 'item' : 'term',
        r: 6 + Math.round(Math.sqrt((t.mentions ?? 1) / maxWeight) * 7),
        label: t.name
      }))
    ],
    edges: graphEdges
  }

  // 时间线：按章归并事件
  const timeline = chapters.map((chapter) => ({
    no: chapter.no,
    title: chapter.title,
    events: (byChapter.get(chapter.no) ?? []).flatMap((plot) => (plot.events ?? []).map((event) => ({
      who: event.who ?? '', channel: event.channel ?? '', text: event.content ?? ''
    })))
  }))

  // 数据面板素材：matrix[人物][章]＝出场段数；channels[人物]＝{say, do, other} 渠道构成
  const matrix = characters.map((c) => {
    const allNames = [c.name, ...(c.aliases ?? [])]
    const present = (plot) => (plot.who ?? []).some((who) => allNames.includes(who))
      || (plot.events ?? []).some((event) => allNames.includes(event.who))
    return chapters.map((ch) => (byChapter.get(ch.no) ?? []).filter(present).length)
  })
  const channels = characters.map((c) => {
    const allNames = [c.name, ...(c.aliases ?? [])]
    const cnt = { say: 0, do: 0, other: 0 }
    for (const plot of plots) {
      for (const event of plot.events ?? []) {
        if (!allNames.includes(event.who)) continue
        if (event.channel === 'say') cnt.say++
        else if (event.channel === 'do') cnt.do++
        else cnt.other++
      }
    }
    return cnt
  })

  return {
    // 增补窄窗（wiki-enrich）先摊平：重复派生时 characterProfiles／chapterSummaries／
    // foreshadows／slots／worldElements 等不丢；下面覆盖的是纯计算派生字段。
    ...(wiki ?? {}),
    book: {
      id: book.id ?? id,
      title: book.title ?? '',
      author: book.author || '佚名',
      words: book.word_count ?? null,
      group: [book.subject_group, book.length_tier].filter(Boolean).join(' · '),
      url: book.url ?? null
    },
    pseudoChapters: usePseudo,
    chapters,
    characters,
    matrix,
    channels,
    terms,
    charGraph,
    timeline,
    enrich: {
      perspective,
      storySummary: wiki?.storySummary ?? '',
      arc: wiki?.arc ?? []
    },
    quality: { traceableRate: quality?.traceableRate ?? null },
    slots: wiki?.slots ?? null,
    excerpts: wiki?.excerpts ?? [],
    ledger: wiki?.ledger ?? null,
    enums: wiki?.enums ?? null
  }
}
