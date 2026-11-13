/**
 * 拆解 JSON → Pinax 知识目录导出器（作者 2026-11-13：「rag 部分呢，知识图谱」）。
 *
 * 产品的 RAG 底座（knowledgeService，零 HTTP worker）按项目五目录（世界书/资料/规则/约束/文风）
 * 建索引，动词 kb_search / kb_read / worldbook_search。本导出器把拆解+六槽位数据确定性翻译成
 * 该契约，使拆解产物直接可检索：
 *
 *   rag/<id>/
 *     .pinax/project.json          projectId（indexSync 入口需要）
 *     世界书/人物-<名>.md           人物卡（frontmatter id/cat/keys/summary ＋ 动机/弧光/选择/台词）
 *     世界书/伏笔/台账.md           伏笔清单（产品约定的特殊文件，作卡索引不作条目）
 *     世界书/编年/章账.md           章纲（功能/情绪/剧情点/梗概）
 *     世界书/状态台账.md            knowledgeLedger + stateLedger（continuity）
 *     资料/归档/拆解-<id>.json      事件流 chunks（每章一块，chunk 契约 {docId,meta,chunks}）
 *
 * 用法：
 *   node devtools/export-rag.mjs --lib=D:/Qbook/短篇选题库 --books=<id>[,<id>]     # 导出
 *   node devtools/export-rag.mjs --index=<id>                                      # 建索引（需内核+Python）
 *   node devtools/export-rag.mjs --index=<id> --q="余欢的动机" [--k=5]             # 检索抽查
 *
 * Windows：PINAX_PYTHON 要指到真 python（python3 常是商店存根）。
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivePseudoChapters, hasRealChapters } from './lib/pseudoChapters.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const BOOKS = (argOf('--books', '') || '').split(',').map((item) => item.trim()).filter(Boolean)
const INDEX_ID = argOf('--index', null)
const QUERY = argOf('--q', null)
const K = Number(argOf('--k', '5')) || 5
const RUNTIME_ROOT = 'D:/Pinax-next/.runtime/knowledge'
const CACHE_ROOT = argOf('--cache', join(LIB, 'knowledge-cache'))

/** 事件流归档 chunk：每章一块（梗概＋事件原文截断），≤500 卡契约内。 */
const EVENT_CAP = 900

function worldbookEntryMd(entry) {
  const lines = [
    '---',
    `id: ${entry.id}`,
    `title: ${entry.title}`,
    'cat: [人物]',
    `keys: [${entry.keys.join(', ')}]`,
    `summary: ${entry.summary}`,
    `links: [${entry.links.join(', ')}]`,
    '---',
    ''
  ]
  for (const section of entry.sections) {
    lines.push(`## ${section[0]}`, '', section[1], '')
  }
  return lines.join('\n')
}

/** 文件名净化：场景/道具名可能含括号、斜线等非法字符。 */
const safeFileName = (name) => String(name ?? '').replace(/[/\\:*?"<>|\s]+/gu, '_').slice(0, 40)

/** 单本导出：拆解 JSON → rag/<id>/ 项目目录。 */
function exportBookRag(id, lib = LIB) {
  const result = JSON.parse(readFileSync(join(lib, '拆解', `${id}.json`), 'utf8'))
  const book = result.book
  const wiki = result.wiki ?? {}
  const profiles = wiki.characterProfiles ?? []
  const unit = wiki.pseudoChapters ? '节' : '章'
  const root = join(lib, 'rag', id)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.pinax'), { recursive: true })
  mkdirSync(join(root, '世界书'), { recursive: true })

  // project.json 按 pinax-project@3 契约（validateProjectDocument 实测：中文载体 id「正文」通过）
  writeFileSync(join(root, '.pinax', 'project.json'), JSON.stringify({ spec: 'pinax-project@3', projectId: `proj_${id}`, name: book.title, kind: 'novel', createdAt: new Date().toISOString(), carriers: { primary: '正文', enabled: ['正文'], revision: 1 } }, null, 2), 'utf8')

  // 图谱一等公民（作者 2026-11-13）：人物/事件/场景/道具四类节点，按权重（出场/提及）排 links
  const charEntries = result.entries.filter((entry) => entry.layer === 'character')
  const idOf = new Map()
  charEntries.forEach((entry, index) => idOf.set(entry.name, `w-${String(index + 1).padStart(2, '0')}`))
  const profileOf = (name) => profiles.find((item) => item.name === name) ?? null
  let written = 0
  for (const entry of charEntries) {
    const profile = profileOf(entry.name)
    const allNames = [entry.name, ...(entry.aliases ?? [])]
    const involved = result.entries.filter((item) => item.layer === 'plot' && ((item.who ?? []).some((who) => allNames.includes(who)) || (item.events ?? []).some((event) => allNames.includes(event.who))))
    const relLines = []
    for (const plot of involved) {
      for (const edge of plot.relations ?? []) {
        if (allNames.includes(edge.from) && idOf.has(edge.to)) relLines.push(`- → ${edge.to}【${edge.type}】${edge.how ?? ''}`)
        else if (allNames.includes(edge.to) && idOf.has(edge.from)) relLines.push(`- ← ${edge.from}【${edge.type}】${edge.how ?? ''}`)
      }
    }
    const arc = profile?.arc
    const sections = [
      ['身份', profile?.identity || entry.identity || '（未归纳）'],
      ...(profile?.goal ? [['动机', profile.goal]] : []),
      ...(profile?.archetype ? [['人设模式', profile.archetype]] : []),
      ...(arc?.start || arc?.end ? [['人物弧光', `${arc.start ?? '—'} → ${arc.end ?? '—'}${arc.turnChapter ? `（转变于第 ${arc.turnChapter}${unit}，依据：${arc.evidence ?? ''}）` : ''}`]] : []),
      ['性格', (profile?.personality ?? entry.traits ?? []).join('／') || '（未归纳）'],
      ...(relLines.length ? [['关系', relLines.join('\n')]] : []),
      ...(profile?.keyChoices?.length ? [['关键选择', profile.keyChoices.map((choice) => `- 第${choice.chapter}${unit}：${choice.choice}`).join('\n')]] : []),
      ['台词样本', (entry.anchors?.speech ?? []).slice(0, 5).map((line) => `「${line}」`).join('\n') || '（无）']
    ]
    const md = worldbookEntryMd({
      id: idOf.get(entry.name),
      title: entry.name,
      keys: allNames,
      summary: [profile?.identity, profile?.goal ? `动机：${profile.goal}` : ''].filter(Boolean).join('；'),
      links: [...new Set(involved.flatMap((plot) => (plot.relations ?? []).flatMap((edge) => [edge.from, edge.to])).filter((name) => name !== entry.name && idOf.has(name)).map((name) => idOf.get(name)))],
      sections
    })
    writeFileSync(join(root, '世界书', `人物-${entry.name}.md`), md, 'utf8')
    written += 1
  }

  // 事件节点（图谱一等公民）：每「节」一个条目，权重=剧情点+事件量；links=参与人物
  const worldElements = wiki.worldElements ?? null
  const summariesList = wiki.chapterSummaries ?? []
  const plots = result.entries.filter((entry) => entry.layer === 'plot')
  const usePseudo = wiki.pseudoChapters ?? !hasRealChapters(plots)
  const groups = usePseudo
    ? derivePseudoChapters(plots, result.source?.chars ?? book.word_count ?? 0)
    : [...new Set(plots.map((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0)))].sort((a, b) => a - b)
        .map((chapter) => ({ no: chapter, plots: plots.filter((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0) === chapter) }))
  const eventIds = new Map()
  const sceneIds = new Map()
  const itemIds = new Map()
  for (const group of groups) eventIds.set(group.no, `e-${String(group.no).padStart(2, '0')}`)
  ;(worldElements?.scenes ?? []).forEach((scene, index) => sceneIds.set(scene.name, `s-${String(index + 1).padStart(2, '0')}`))
  ;(worldElements?.items ?? []).forEach((item, index) => itemIds.set(item.name, `i-${String(index + 1).padStart(2, '0')}`))

  for (const group of groups) {
    const summary = summariesList.find((item) => item.chapter === group.no)
    const eventContents = group.plots.flatMap((plot) => plot.events ?? []).map((event) => event.content)
    const charMentions = {}
    for (const plot of group.plots) {
      for (const who of plot.who ?? []) if (idOf.has(who)) charMentions[who] = (charMentions[who] ?? 0) + 1
    }
    const present = Object.entries(charMentions).sort((a, b) => b[1] - a[1])
    const mentionedScenes = (worldElements?.scenes ?? []).filter((scene) => scene.chapters.includes(group.no))
    const mentionedItems = (worldElements?.items ?? []).filter((item) => item.chapters.includes(group.no))
    const links = [
      ...present.map(([name]) => idOf.get(name)),
      ...mentionedScenes.map((scene) => sceneIds.get(scene.name)),
      ...mentionedItems.map((item) => itemIds.get(item.name))
    ].filter(Boolean)
    const md = worldbookEntryMd({
      id: eventIds.get(group.no),
      title: `第${group.no}${unit}·${summary?.title ?? ''}`,
      keys: [`${group.no}${unit}`, summary?.title ?? ''].filter(Boolean),
      summary: `功能:${summary?.function ?? '—'} 情绪:${summary?.emotion ?? '—'} 剧情点:${summary?.beats ?? '—'}｜${summary?.summary ?? ''}`.slice(0, 120),
      links: [...new Set(links)],
      sections: [
        ['权重', `剧情点 ${summary?.beats ?? '—'} · ${eventContents.length} 事件 · ${group.plots.length} 段 · 在场 ${present.map(([name, count]) => `${name}×${count}`).join('、') || '—'}`],
        ['梗概', summary?.summary || '（无）'],
        ...(mentionedScenes.length ? [['场景', mentionedScenes.map((scene) => `- ${scene.name}：${scene.desc}`).join('\n')]] : []),
        ...(mentionedItems.length ? [['道具', mentionedItems.map((item) => `- ${item.name}（${item.holder || '—'}）：${item.desc}`).join('\n')]] : []),
        ['事件流（原文）', eventContents.slice(0, 6).map((line) => `- ${line}`).join('\n')]
      ]
    })
    writeFileSync(join(root, '世界书', `事件-${String(group.no).padStart(2, '0')}.md`), md, 'utf8')
    written += 1
  }

  // 场景节点（权重=出现章数）
  for (const scene of worldElements?.scenes ?? []) {
    const relatedChars = profiles.filter((profile) => profile.chapters?.some((chapter) => scene.chapters.includes(chapter))).slice(0, 5)
    const md = worldbookEntryMd({
      id: sceneIds.get(scene.name),
      title: scene.name,
      keys: [scene.name],
      summary: `场景（${scene.chapters.length}${unit}）｜${scene.desc}`,
      links: relatedChars.map((profile) => idOf.get(profile.name)).filter(Boolean),
      sections: [
        ['权重', `${scene.chapters.length} ${unit}（第 ${scene.chapters.join('、')}${unit}）`],
        ['这里发生了什么', scene.desc],
        ...(relatedChars.length ? [['关联人物', relatedChars.map((profile) => `- ${profile.name}：${profile.identity || ''}`).join('\n')]] : [])
      ]
    })
    writeFileSync(join(root, '世界书', `场景-${safeFileName(scene.name)}.md`), md, 'utf8')
    written += 1
  }

  // 道具节点（权重=出现章数；holder=当前掌握者）
  for (const item of worldElements?.items ?? []) {
    const md = worldbookEntryMd({
      id: itemIds.get(item.name),
      title: item.name,
      keys: [item.name],
      summary: `道具（${item.chapters.length}${unit}，掌握者：${item.holder || '—'}）｜${item.desc}`,
      links: [],
      sections: [
        ['权重', `${item.chapters.length} ${unit}（第 ${item.chapters.join('、')}${unit}）`],
        ['掌握者', item.holder || '—'],
        ['推动了什么', item.desc]
      ]
    })
    writeFileSync(join(root, '世界书', `道具-${safeFileName(item.name)}.md`), md, 'utf8')
    written += 1
  }

  // 伏笔台账（特殊文件：作卡不作条目）
  const hooks = wiki.foreshadows ?? []
  if (hooks.length) {
    const byChapter = new Map()
    for (const hook of hooks) {
      if (!byChapter.has(hook.chapter)) byChapter.set(hook.chapter, [])
      byChapter.get(hook.chapter).push(hook.text)
    }
    const md = ['# 伏笔台账', '', ...[...byChapter.entries()].sort((a, b) => a[0] - b[0]).flatMap(([chapter, list]) => [`## 第 ${chapter} ${unit}`, ...list.map((text) => `- ${text}`), '']), '']
    mkdirSync(join(root, '世界书', '伏笔'), { recursive: true })
    writeFileSync(join(root, '世界书', '伏笔', '台账.md'), md.join('\n'), 'utf8')
    written += 1
  }

  // 章账（编年）
  const summaries = wiki.chapterSummaries ?? []
  if (summaries.length) {
    const md = ['# 章账（编年）', '', ...summaries.sort((a, b) => a.chapter - b.chapter).map((item) => `- 第 ${item.chapter} ${unit}「${item.title}」 功能:${item.function || '—'} 情绪:${item.emotion || '—'} 剧情点:${item.beats ?? '—'} —— ${item.summary}`), '']
    mkdirSync(join(root, '世界书', '编年'), { recursive: true })
    writeFileSync(join(root, '世界书', '编年', '章账.md'), md.join('\n'), 'utf8')
    written += 1
  }

  // 状态台账（continuity）
  const ledger = wiki.ledger
  if (ledger) {
    const md = ['# 状态台账', '',
      ...(ledger.knowledgeLedger?.length ? ['## 知情台账（谁知道什么）', ...ledger.knowledgeLedger.map((item) => `- ${item.character} 知道：${item.knows}（约第 ${item.chapter ?? '?'} ${unit}）`), ''] : []),
      ...(ledger.stateLedger?.length ? ['## 状态台账（关键物/关系终局）', ...ledger.stateLedger.map((item) => `- ${item.object}：${item.state}（第 ${item.chapter ?? '?'} ${unit} 确认）`), ''] : []),
      '']
    if (md.length > 3) { writeFileSync(join(root, '世界书', '状态台账.md'), md.join('\n'), 'utf8'); written += 1 }
  }

  // 事件流归档（kb_search 主力：每章一块；复用上面事件节点算好的 groups）
  const chunks = groups.map((group) => ({ id: `ch-${group.no}`, text: chapterChunkText(group.no, group.plots.flatMap((plot) => (plot.events ?? []).map((event) => event.content))) }))
  writeArchive()
  function chapterChunkText(no, contents) {
    const summary = summariesList.find((item) => item.chapter === no)
    const head = `第 ${no} ${unit}「${summary?.title ?? ''}」 功能:${summary?.function ?? '—'} 情绪:${summary?.emotion ?? '—'} 剧情点:${summary?.beats ?? '—'}\n${summary?.summary ?? ''}\n`
    return head + contents.join('\n').slice(0, EVENT_CAP)
  }
  function writeArchive() {
    const archivePath = join(root, '资料', '归档', `拆解-${id}.json`)
    mkdirSync(dirname(archivePath), { recursive: true })
    writeFileSync(archivePath, JSON.stringify({ docId: `chaijie-${id}`, meta: { title: `${book.title}·事件流` }, chunks }, null, 1), 'utf8')
    written += 1
  }

  return { id, title: book.title, root, files: written, chunks: chunks.length, characters: charEntries.length }
}

/* ---------- 索引与检索（需内核＋Python） ---------- */

async function serviceFor(lib) {
  const { createKnowledgeService } = await import('../next/runtime/knowledgeService.mjs')
  return createKnowledgeService({ runtimeRoot: RUNTIME_ROOT, cacheRoot: CACHE_ROOT })
}

const isCli = process.argv[1] && process.argv[1].endsWith('export-rag.mjs')
if (isCli) {
  if (INDEX_ID) {
    const service = await serviceFor(LIB)
    const root = join(LIB, 'rag', INDEX_ID)
    if (QUERY) {
      const searched = await service.search({ root, verb: 'kb_search', q: QUERY, k: K })
      if (!searched.ok) { console.error('检索失败：', JSON.stringify(searched.error)); process.exit(1) }
      const hits = searched.value?.hits ?? searched.value?.results ?? []
      for (const hit of hits) {
        console.log('-', JSON.stringify(hit).slice(0, 260))
      }
      if (!hits.length) console.log('(0 命中)')
    } else {
      const synced = await service.indexSync({ root, probe: '序' })
      if (!synced.ok) { console.error('索引失败：', JSON.stringify(synced.error)); process.exit(1) }
      console.log(JSON.stringify(synced.value, null, 1))
    }
  } else {
    if (!BOOKS.length) { console.error('用法：--books=<id,...> 导出｜--index=<id> [--q="查询"] 索引/检索'); process.exit(2) }
    console.log(JSON.stringify(BOOKS.map((id) => exportBookRag(id, LIB)), null, 1))
  }
}

export { exportBookRag }
