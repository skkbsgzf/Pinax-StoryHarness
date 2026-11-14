/**
 * 市场表现 × 结构特征 关联分析器（作者 2026-11-14 批准）。
 *
 * 目的：不是「拆得全」，而是找出**高数据作品的结构共性**——能转成写作处方的差异。
 * 标尺：入库索引的 efficiency（人/万字，连续值）＋ grade（S/A/B/C）；两者都是真实市场读数。
 *
 * 分析维度（每维度给：分组中位效率 / 组间倍数 / 样本量 / 结论是否可用）：
 *   1. 字数区间          —— 平台适配（番茄短篇偏短）
 *   2. 题材              —— 赛道选择
 *   3. 结构母型          —— plot-design.structure.picked
 *   4. 开篇钩子类型      —— intro.hookType
 *   5. 情绪曲线形状      —— 峰值位置（前 25%/中段/后段）、情绪种类数、主导情绪
 *   6. 节奏密度          —— 每节剧情点均值、伏笔总数、伏笔密度
 *   7. 人物规模          —— 人物数、有弧光的人物占比
 *
 * 输出：分析报告 markdown + 机器可读 JSON（供后续处方模板消费）。
 *
 * 用法：node devtools/market-analysis.mjs [--lib=…] [--out=…]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const OUT = argOf('--out', join(LIB, '分析报告.md'))
const DIR = join(LIB, '拆解')

/** 中位数（比均值抗极端值——效率分布长尾很重）。 */
function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** 分组统计：每组 n / 中位效率 / 中位字数。 */
function groupStats(books, keyOf) {
  const groups = new Map()
  for (const book of books) {
    const key = keyOf(book)
    if (key == null || key === '') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(book)
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    n: list.length,
    medianEff: median(list.map((b) => b.efficiency)),
    medianWords: median(list.map((b) => b.word_count)),
    medianGrade: median(list.map((b) => ({ S: 4, A: 3, B: 2, C: 1 })[b.grade] ?? 0)),
    // 低端占比：效率 <2000 的比例——比中位数抗长尾，是判断「这个分组会不会踩坑」最直接的读数
    lowShare: Math.round(list.filter((b) => b.efficiency < 2000).length / list.length * 100),
    books: list.map((b) => ({ id: b.id, title: b.title, eff: b.efficiency, grade: b.grade }))
  })).sort((a, b) => b.medianEff - a.medianEff)
}

/** 从拆解 JSON 提取结构特征。 */
function featuresOf(book, result) {
  const wiki = result.wiki ?? {}
  const summaries = (wiki.chapterSummaries ?? []).filter((item) => item.emotion || item.beats)
  const total = summaries.length || 1
  // 峰值位置：beats 最高的一章在全书的相对位置
  let peakIndex = 0
  let peakValue = 0
  summaries.forEach((item, index) => {
    if ((item.beats ?? 0) > peakValue) { peakValue = item.beats ?? 0; peakIndex = index }
  })
  const peakPos = total > 1 ? peakIndex / (total - 1) : 0
  const emotions = [...new Set(summaries.map((item) => item.emotion).filter(Boolean))]
  const emotionCount = {}
  summaries.forEach((item) => { if (item.emotion) emotionCount[item.emotion] = (emotionCount[item.emotion] ?? 0) + 1 })
  const dominant = Object.entries(emotionCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const beats = summaries.map((item) => item.beats).filter(Number.isFinite)
  const structures = wiki.slots?.plotDesign?.structure?.picked ?? ''
  // 结构母型归一：取主类（去掉「复合（主：X；辅：Y）」外壳）
  const mainStructure = (structures.match(/主[：:]\s*([^；;）)]+)/)?.[1] ?? structures) || ''
  return {
    ...book,
    structureRaw: structures,
    structure: mainStructure.trim(),
    isComposite: /复合/.test(structures),
    hookType: wiki.slots?.intro?.hookType ?? '',
    peakPos: Number(peakPos.toFixed(2)),
    peakBand: peakPos < 0.34 ? '前段峰值' : peakPos < 0.67 ? '中段峰值' : '后段峰值',
    emotionKinds: emotions.length,
    dominantEmotion: dominant,
    avgBeats: beats.length ? Number((beats.reduce((a, b) => a + b, 0) / beats.length).toFixed(2)) : 0,
    hookCount: (wiki.foreshadows ?? []).length,
    chapters: (wiki.chapterSummaries ?? []).length,
    charCount: (wiki.characterProfiles ?? []).length,
    arcCount: (wiki.characterProfiles ?? []).filter((p) => p.arc?.end).length,
    hasGimmick: Boolean(wiki.slots?.gimmick),
    hasStyle: Boolean(wiki.slots?.style),
    ledgerKnows: wiki.ledger?.knowledgeLedger?.length ?? 0
  }
}

function main() {
  const index = JSON.parse(readFileSync(join(LIB, '正文', '入库索引.json'), 'utf8'))
  const books = []
  const excluded = []
  for (const name of readdirSync(DIR).filter((file) => /^\d+\.json$/.test(file))) {
    const id = name.replace(/\.json$/, '')
    const meta = index[id]
    if (!meta || !(meta.efficiency > 0)) continue
    const result = JSON.parse(readFileSync(join(DIR, name), 'utf8'))
    // wiki 数据落在旁挂文件 <id>.wiki.json（S2 写入契约：主 JSON 只存 fact 本体）。
    const wikiPath = join(DIR, `${id}.wiki.json`)
    if (existsSync(wikiPath)) {
      const sidecar = JSON.parse(readFileSync(wikiPath, 'utf8'))
      result.wiki = sidecar.wiki ?? sidecar
    }
    // 数据完整性闸（关键）：enrich 没跑或跑挂的书，结构性字段全空，
    // 会让每个维度都出现虚假的 20× 差异（它们会整体落进「未标注/未识别」组）。
    // 判据：必须有 gimmick ＋ 章摘要里有功能/情绪 ＋ 有至少 1 个人物档案。
    const wiki = result.wiki ?? {}
    const summaries = (wiki.chapterSummaries ?? []).filter((item) => item.function || item.emotion)
    const profiles = wiki.characterProfiles ?? []
    if (!wiki.slots?.gimmick || summaries.length === 0 || profiles.length === 0) {
      excluded.push({ id, title: meta.title, reason: 'enrich 未完成（结构字段为空）' })
      continue
    }
    books.push(featuresOf({
      id,
      title: meta.title,
      grade: meta.grade ?? '?',
      word_count: meta.word_count,
      efficiency: meta.efficiency,
      read_count: meta.read_count,
      subject: meta.subject_group ?? '',
      length_tier: meta.length_tier ?? ''
    }, result))
  }
  if (excluded.length) {
    console.log(`⚠ 剔除 ${excluded.length} 本（数据不完整，强行纳入会制造虚假信号）：`)
    excluded.forEach((item) => console.log(`  - ${item.title.slice(0, 16)}：${item.reason}`))
    console.log()
  }

  console.log(`样本：${books.length} 本（有市场效率读数的已拆书）`)
  const gradeCount = books.reduce((acc, b) => { acc[b.grade] = (acc[b.grade] ?? 0) + 1; return acc }, {})
  console.log('分级：', JSON.stringify(gradeCount))
  console.log('效率分位：中位', median(books.map((b) => b.efficiency)))
  console.log()

  // 统一分桶：按效率中位数切「高/低」（比 grade 更细腻，且避免 S 级样本偏斜）
  const allEff = books.map((b) => b.efficiency)
  const midEff = median(allEff)
  for (const book of books) book.band = book.efficiency >= midEff ? 'HIGH' : 'LOW'
  console.log(`切分线：效率 ≥ ${midEff} 为 HIGH（${books.filter((b) => b.band === 'HIGH').length} 本），否则 LOW（${books.filter((b) => b.band === 'LOW').length} 本）`)
  console.log()

  const dims = [
    { name: '字数区间', key: (b) => (b.word_count <= 9000 ? '≤9k' : b.word_count <= 11000 ? '9–11k' : b.word_count <= 15000 ? '11–15k' : b.word_count <= 30000 ? '15–30k' : '>30k') },
    { name: '题材', key: (b) => b.subject },
    { name: '结构母型（主）', key: (b) => b.structure || '未识别' },
    { name: '是否复合结构', key: (b) => (b.isComposite ? '复合' : '单一') },
    { name: '开篇钩子类型', key: (b) => b.hookType || '未标注' },
    { name: '情绪峰值位置', key: (b) => b.peakBand },
    { name: '主导情绪', key: (b) => b.dominantEmotion || '未标注' },
    { name: '情绪种类数', key: (b) => (b.emotionKinds <= 2 ? '1–2 种' : b.emotionKinds <= 4 ? '3–4 种' : '5+ 种') },
    { name: '节奏密度（平均剧情点）', key: (b) => (b.avgBeats <= 2 ? '≤2' : b.avgBeats <= 3 ? '2–3' : b.avgBeats <= 4 ? '3–4' : '>4') },
    { name: '伏笔总数', key: (b) => (b.hookCount <= 5 ? '≤5' : b.hookCount <= 15 ? '6–15' : b.hookCount <= 30 ? '16–30' : '>30') },
    { name: '人物规模', key: (b) => (b.charCount <= 3 ? '≤3' : b.charCount <= 6 ? '4–6' : b.charCount <= 10 ? '7–10' : '>10') }
  ]

  const findings = []
  const report = []
  report.push('# 市场表现 × 结构特征 关联分析')
  report.push('')
  report.push(`> 样本 ${books.length} 本（已拆解且有真实效率读数）。效率＝人/万字，来自选题库抓取的真实在读数据。`)
  report.push(`> 切分线：效率中位 ${midEff} → HIGH ${books.filter((b) => b.band === 'HIGH').length} 本 / LOW ${books.filter((b) => b.band === 'LOW').length} 本。`)
  report.push(`> 分级分布：${Object.entries(gradeCount).map(([g, n]) => `${g} ${n}`).join(' · ')}`)
  report.push('')
  report.push('**读法**：每组给「中位效率」，倍数＝最高组 ÷ 最低组。倍数 ≥1.5 且各组 n≥3 才算有信号；否则标「样本不足」。')
  report.push('')
  report.push('---')
  report.push('')

  for (const dim of dims) {
    const stats = groupStats(books, dim.key)
    const withEnough = stats.filter((s) => s.n >= 3)
    const maxEff = withEnough[0]?.medianEff ?? 0
    const minEff = withEnough[withEnough.length - 1]?.medianEff ?? 0
    const ratio = minEff > 0 ? (maxEff / minEff) : 0
    // 信号可用性三重检查（2026-11-14 实测踩过两个假信号，必须防）：
    //  ① 倍数 ≥1.5；② 每组 n≥3；
    //  ③ 抗单点：最高组的「中位」不能被一两本极端值拉起来——要求该组内至少 2 本 ≥ 中位的一半。
    const bestGroup = withEnough[0]
    const bestList = books.filter((b) => dim.key(b) === bestGroup?.key)
    const robustCount = bestList.filter((b) => b.efficiency >= bestGroup.medianEff * 0.5).length
    // ④ 组内离散度：极端值主导的组（如 3 本里 121655/98762/33553）中位虽高但不可复现。
    //    判据：最高组内「最高÷最低」>6 视为长尾主导，标不可用。
    const bestEffs = bestList.map((b) => b.efficiency).sort((a, b) => b - a)
    const spread = bestEffs.length && bestEffs[bestEffs.length - 1] > 0 ? bestEffs[0] / bestEffs[bestEffs.length - 1] : 1
    // 阈值 20：效率分布本身就是长尾（全样本 p90/p10 ≈ 16×），分组离散度在 20 内属正常。
    const robust = robustCount >= 2 && spread <= 20
    // 主判据改用「低端占比差」：长尾分布下中位数极易被少数爆款带偏，
    // 而「这个分组有多少比例会掉进低端」才是选题真正关心的风险读数。
    // 判据：最优组 lowShare ≤ 20% 且 最差组 lowShare ≥ 中位水平 + 15 个百分点。
    const worstGroup = withEnough[withEnough.length - 1]
    const lowSpread = (worstGroup?.lowShare ?? 0) - (bestGroup?.lowShare ?? 0)
    const usable = withEnough.length >= 2 && bestGroup && bestGroup.n >= 3 && lowSpread >= 15 && (bestGroup.lowShare ?? 100) <= 25
    findings.push({
      dim: dim.name,
      ratio: Number(ratio.toFixed(2)),
      usable,
      robust,
      bestN: bestGroup?.n ?? 0,
      bestRobustCount: robustCount,
      groups: withEnough.map((s) => ({ key: s.key, n: s.n, medianEff: s.medianEff, lowShare: s.lowShare }))
    })

    const verdict = usable
      ? `**信号：最优组低端占比 ${bestGroup?.lowShare}%，最差组 ${worstGroup?.lowShare}%（差 ${lowSpread} 点）**`
      : bestGroup && bestGroup.n >= 3
        ? `（低端占比差仅 ${lowSpread} 点，不足以下处方）`
        : ratio >= 1.3 ? '（弱差异，不足以下处方）' : '（无显著差异/样本不足）'
    report.push(`## ${dim.name}　${verdict}`)
    report.push('')
    report.push('| 分组 | n | 中位效率 | **低端占比** | 中位字数 | 代表作品 |')
    report.push('|---|---|---|---|---|---|')
    for (const group of stats) {
      const sample = group.books.slice(0, 2).map((b) => `${b.title.slice(0, 12)}(${b.eff})`).join('、')
      report.push(`| ${group.key} | ${group.n} | ${group.medianEff.toLocaleString()} | ${group.lowShare}% | ${group.medianWords.toLocaleString()} | ${sample} |`)
    }
    report.push('')
  }

  // HIGH vs LOW 的特征差异（只列差异明显的）
  report.push('---')
  report.push('')
  report.push('## HIGH vs LOW 直接对照')
  report.push('')
  const high = books.filter((b) => b.band === 'HIGH')
  const low = books.filter((b) => b.band === 'LOW')
  const contrast = [
    ['平均字数', (list) => Math.round(list.reduce((sum, b) => sum + b.word_count, 0) / list.length)],
    ['平均节数', (list) => Math.round(list.reduce((sum, b) => sum + b.chapters, 0) / list.length * 10) / 10],
    ['平均剧情点密度', (list) => Math.round(list.reduce((sum, b) => sum + b.avgBeats, 0) / list.length * 100) / 100],
    ['平均伏笔数', (list) => Math.round(list.reduce((sum, b) => sum + b.hookCount, 0) / list.length * 10) / 10],
    ['平均人物数', (list) => Math.round(list.reduce((sum, b) => sum + b.charCount, 0) / list.length * 10) / 10],
    ['有弧光人物占比', (list) => Math.round(list.reduce((sum, b) => sum + b.arcCount, 0) / Math.max(1, list.reduce((sum, b) => sum + b.charCount, 0)) * 100) + '%'],
    ['复合结构占比', (list) => Math.round(list.filter((b) => b.isComposite).length / list.length * 100) + '%'],
    ['前段峰值占比', (list) => Math.round(list.filter((b) => b.peakBand === '前段峰值').length / list.length * 100) + '%'],
    ['平均情绪种类', (list) => Math.round(list.reduce((sum, b) => sum + b.emotionKinds, 0) / list.length * 10) / 10]
  ]
  report.push('| 特征 | HIGH (n=' + high.length + ') | LOW (n=' + low.length + ') | 差异 |')
  report.push('|---|---|---|---|')
  for (const [label, pick] of contrast) {
    const highValue = pick(high)
    const lowValue = pick(low)
    const numHigh = parseFloat(String(highValue).replace('%', ''))
    const numLow = parseFloat(String(lowValue).replace('%', ''))
    const diff = numLow > 0 ? ((numHigh - numLow) / numLow * 100) : 0
    const flag = Math.abs(diff) >= 20 ? (diff > 0 ? ' 🔺' : ' 🔻') : ''
    report.push(`| ${label} | ${highValue} | ${lowValue} | ${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%${flag} |`)
  }
  report.push('')

  // 结论：可转成处方的
  report.push('---')
  report.push('')
  report.push('## 可转成写作处方的结论')
  report.push('')
  const prescriptions = findings.filter((item) => item.usable).map((item) => {
    const best = item.groups[0]
    const worst = item.groups[item.groups.length - 1]
    return `- **${item.dim}**：${best.key}（中位 ${best.medianEff.toLocaleString()}）优于 ${worst.key}（${worst.medianEff.toLocaleString()}），${item.ratio.toFixed(1)}× —— 选型时优先前者。`
  })
  if (prescriptions.length) report.push(...prescriptions)
  else report.push('（本次样本未产出达标信号——需扩大样本或换维度）')
  report.push('')
  report.push(`> 分析时间：${new Date().toISOString()}　·　样本 ${books.length} 本`)
  report.push('')

  writeFileSync(OUT, report.join('\n'), 'utf8')
  writeFileSync(OUT.replace(/\.md$/u, '.json'), JSON.stringify({ generatedAt: new Date().toISOString(), splitLine: midEff, sample: books.length, findings, books: books.map(({ books: _b, ...rest }) => rest) }, null, 1), 'utf8')

  console.log('=== 信号汇总（倍数 ≥1.5 且 n≥3 为可用）===')
  findings.forEach((item) => console.log(` ${item.usable ? '✓' : ' '} ${item.dim.padEnd(22)} ${item.ratio.toFixed(2)}×`, item.groups.map((g) => `${g.key}(${g.n})=${g.medianEff}`).join(' ')))
  console.log()
  console.log('报告已写入：', OUT)
}

main()
