/**
 * 拆解结果整合（P-2 落库，从 e2e/integrate-decompose.mjs 收编参数化）。
 *
 * 把拆解结果整合回番茄短篇库：
 *   1) 正文/入库索引.json 每条加 decompose 字段（状态/条目数/可溯源率/文件/时间）；
 *   2) 拆解/<id>.json 的 book 段补选题四维（subject_main/subject_names/audience/efficiency）；
 *   3) 生成 拆解/拆解索引.json（库级汇总，供程序读）；
 *   4) 生成 拆解/拆解报告.md（人读）。
 *
 * 只写派生层，不动 正文/ 与 选题库.json 原始数据。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** @param {string} lib 库根目录（D:/短篇选题库） */
export function runIntegrate(lib) {
  const OUT = join(lib, '拆解')
  const indexPath = join(lib, '正文', '入库索引.json')
  const topicsPath = join(lib, '选题库.json')

  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const topics = JSON.parse(readFileSync(topicsPath, 'utf8'))
  const topicList = Array.isArray(topics) ? topics : Object.values(topics)
  const topicById = new Map(topicList.map((item) => [item.id, item]))

  const files = Object.keys(index).filter((id) => existsSync(join(OUT, `${id}.json`)))
  const summaries = []

  for (const id of files) {
    const result = JSON.parse(readFileSync(join(OUT, `${id}.json`), 'utf8'))
    const book = index[id]
    const topic = topicById.get(id) ?? {}

    // ① 拆解结果补选题四维（让拆解文件自己带够上下文，不必回查选题库）
    result.book = {
      ...result.book,
      subject_main: topic.subject_main ?? null,
      subject_names: topic.subject_names ?? null,
      audience: topic.audience ?? null,
      efficiency: topic.efficiency ?? null,
      peak_read: topic.peak_read ?? null
    }

    // 可溯源率：事件正文能在原文找到的比例（质量硬指标）
    const sourceFile = join(lib, '正文', book.file)
    const raw = existsSync(sourceFile) ? readFileSync(sourceFile, 'utf8') : ''
    let total = 0
    let literal = 0
    for (const entry of result.entries) {
      for (const event of entry.events ?? []) {
        total += 1
        if (raw.includes(event.content)) literal += 1
      }
    }
    result.quality = {
      events: total,
      traceable: literal,
      traceableRate: total ? Number((literal / total).toFixed(4)) : null
    }
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(result, null, 2), 'utf8')

    // ② 索引加拆解读数（双向引用）
    const byLayer = result.entries.reduce((acc, entry) => { acc[entry.layer] = (acc[entry.layer] ?? 0) + 1; return acc }, {})
    const chapters = [...new Set(result.entries.filter((entry) => entry.layer === 'plot').map((entry) => entry.validity?.from).filter(Number.isInteger))]
    book.decompose = {
      status: 'ok',
      file: `拆解/${id}.json`,
      entries: result.entries.length,
      byLayer,
      chapters: chapters.length,
      segments: result.source.segments,
      blocks: result.source.blocks,
      calls: result.calls,
      perspective: result.perspective?.perspective ?? null,
      protagonist: result.protagonist ?? null,
      traceableRate: result.quality.traceableRate,
      decomposed_at: new Date().toISOString()
    }

    summaries.push({
      id, title: book.title, words: book.word_count, grade: book.grade,
      subject_group: book.subject_group,
      chapters: chapters.length,
      segments: result.source.segments, blocks: result.source.blocks,
      entries: result.entries.length, byLayer,
      traceableRate: result.quality.traceableRate,
      characters: result.entries.filter((entry) => entry.layer === 'character').map((entry) => entry.name),
      calls: result.calls
    })
  }

  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')

  // ③ 库级拆解索引
  const ledger = {
    version: 'fanqie-decompose@1',
    generated_at: new Date().toISOString(),
    library: lib,
    decomposed: summaries.length,
    total: Object.keys(index).length,
    books: summaries
  }
  writeFileSync(join(OUT, '拆解索引.json'), JSON.stringify(ledger, null, 2), 'utf8')

  // ④ 人读报告
  const lines = [
    '# 番茄短篇库 · 拆解报告',
    '',
    `生成时间：${ledger.generated_at}`,
    `已拆解：**${ledger.decomposed} / ${ledger.total}**`,
    '',
    '## 总览',
    '',
    '| 书名 | 字数 | 档级 | 题材 | 章 | 段 | 条目 | 角色数 | 可溯源 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...summaries.map((item) => `| ${item.title} | ${item.words} | ${item.grade} | ${item.subject_group} | ${item.chapters} | ${item.segments} | ${item.entries} | ${item.characters.length} | ${(item.traceableRate * 100).toFixed(1)}% |`),
    '',
    '## 逐本明细',
    ''
  ]

  for (const item of summaries) {
    lines.push(`### ${item.title}`, '')
    lines.push(`- 作者 / 题材 / 档级：${index[item.id].author} · ${item.subject_group} · ${item.grade}`)
    lines.push(`- 规模：${item.words} 字 → ${item.chapters} 章 → ${item.segments} 段 → ${item.blocks} 块`)
    lines.push(`- 产出：${item.entries} 条（${Object.entries(item.byLayer).map(([k, v]) => `${k} ${v}`).join(' / ')}）`)
    lines.push(`- 可溯源：${(item.traceableRate * 100).toFixed(1)}%（事件正文能在原文逐字找到的比例）`)
    lines.push(`- 角色：${item.characters.join('、') || '（无）'}`)
    lines.push('')
  }

  writeFileSync(join(OUT, '拆解报告.md'), lines.join('\n'), 'utf8')
  return { decomposed: summaries.length, total: Object.keys(index).length, books: summaries }
}
