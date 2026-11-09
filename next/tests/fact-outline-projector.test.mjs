import test from 'node:test'
import assert from 'node:assert/strict'
import {
  projectOutline,
  renderOutlineText,
  OUTLINE_EDGE_KINDS,
  PROJECTOR_VERSION
} from '../fact/usecases/deduce/outlineProjector.js'
import { migrateOutline } from '../fact/usecases/migrateLegacy.js'
import { extractChapter } from '../fact/usecases/pipeline/extract.js'
import { segmentText } from '../fact/domain/segment.js'

/**
 * 批次 M2：会话 → 章纲投影器（ADR M2）合同测试。
 *   1) 四类边/标记语义逐条：settle→node、相邻拍→causes、open→foreshadows、
 *      未选候选→alternative、导演注入→decidedBy:'author'；
 *   2) 幂等：同一会话流深度相等、不改输入；
 *   3) 形状对称：投影 { nodes, edges } 可直接喂 P2b migrateOutline；
 *   4) roundtrip：种子化 20 拍 → 投影 → 章纲文本 → P2a extract（fake LlmPort 回读）
 *      → 主干还原读数（节点名集 / 因果序 / 伏笔 open 数）与损失如实记账。
 *
 * 全程零网络、零真实模型、零宿主依赖：只用 next/fact/** 域内纯模块。
 */

const DOMAIN = '停摆之城'
const POV = '克莱恩'
const ROUNDS = 20
const INJECT_ROUNDS = new Set([5, 10, 15, 20])
const OPEN_ROUNDS = new Set([3, 8, 13, 18])
const UNADOPTED_PER_ROUND = 2

function beatText(round) {
  return `第${round}拍：${POV}在旧钟楼察觉到第${round}条线索。`
}

/**
 * 种子化 20 拍会话的 replay 事件流（确定性、无随机数）。
 * 每拍：candidates（2 条 adopted:false 戏剧/必然 ＋ 1 条命运已选）→ beat → 视情况 open 假设轨。
 * seq 单调唯一，candidates/beat/open 用 round 对齐，beat 文本即「拍文本」。
 */
function seedSession() {
  const events = []
  let seq = 1
  for (let round = 1; round <= ROUNDS; round += 1) {
    events.push({
      type: 'candidates',
      seq: seq++,
      round,
      candidates: [
        { id: `c${round}-drama`, text: `戏剧未选分支${round}`, source: '戏剧', adopted: false, proposed: true },
        { id: `c${round}-necessity`, text: `必然未选分支${round}`, source: '必然', adopted: false },
        { id: `c${round}-fate`, text: `命运骰${round}`, source: '命运', adopted: true }
      ]
    })

    const inject = INJECT_ROUNDS.has(round)
    const beat = {
      type: inject ? 'director-inject' : 'settle',
      seq: seq++,
      round,
      text: beatText(round),
      source: inject ? '导演注入' : (round % 2 ? '必然' : '命运')
    }
    if (inject) {
      beat.name = `作者注入${round}`
      beat.definition = beatText(round)
    }
    events.push(beat)

    if (OPEN_ROUNDS.has(round)) {
      events.push({
        type: round % 2 === 0 ? 'open' : 'hypothesis',
        seq: seq++,
        round,
        text: `悬而未决·第${round}拍`,
        open: true
      })
    }
  }
  return events
}

/* ---------- 1) 四类边/标记语义逐条 ---------- */

test('settle 一拍一节点：definition＝拍文本、seq 即序、大纲原生形状', () => {
  const events = seedSession()
  const { nodes } = projectOutline(events, { domain: DOMAIN })
  assert.equal(nodes.length, ROUNDS)
  // order＝紧凑拍序 1..N（大纲第几拍）
  assert.deepEqual(nodes.map((n) => n.order), Array.from({ length: ROUNDS }, (_, i) => i + 1))
  // seq＝事件流权威序号：seq 即序，节点按 seq 单调排序，且回指该拍 settle 事件的 seq
  const seqs = nodes.map((n) => n.seq)
  assert.ok(seqs.every((v, i) => i === 0 || v > seqs[i - 1]), 'seq 即序：按事件 seq 单调排序')
  const settleSeqs = events
    .filter((e) => e.type === 'settle' || e.type === 'director-inject')
    .map((e) => e.seq)
    .sort((a, b) => a - b)
  assert.deepEqual(seqs, settleSeqs, '每个节点的 seq 回指其 beat 事件的 seq')
  for (const node of nodes) {
    assert.equal(node.id, `beat-${node.order}`)
    assert.match(node.title, /^第\d+拍·/u)
    assert.ok(node.definition.length > 0)
    assert.equal(node.definition, node.intent, 'intent 镜像拍文本，供 P2b 还原 fact')
    assert.equal(node.definition, node.summary)
    assert.equal(node.status, 'adopted')
    assert.equal(node.domain, DOMAIN)
  }
  assert.equal(nodes[0].definition, beatText(1), 'definition 精确等于该拍文本')
})

test('相邻拍 → causes 导致边（因果链主干，n-1 条，from→to 连成链）', () => {
  const { nodes, edges } = projectOutline(seedSession(), { domain: DOMAIN })
  const causes = edges.filter((e) => e.kind === OUTLINE_EDGE_KINDS.CAUSES)
  assert.equal(causes.length, nodes.length - 1)
  for (let i = 0; i < causes.length; i += 1) {
    assert.equal(causes[i].fromNodeId, nodes[i].id)
    assert.equal(causes[i].toNodeId, nodes[i + 1].id)
    assert.equal(causes[i].kind, 'causes')
  }
})

test('open 假设轨 → foreshadows 伏笔边（payoff 留空、open:true）', () => {
  const { edges } = projectOutline(seedSession(), { domain: DOMAIN })
  const foreshadows = edges.filter((e) => e.kind === OUTLINE_EDGE_KINDS.FORESHADOWS)
  assert.equal(foreshadows.length, OPEN_ROUNDS.size)
  for (const edge of foreshadows) {
    assert.equal(edge.toNodeId, '', 'payoff 留空＝toNodeId 空')
    assert.equal(edge.open, true)
    assert.equal(edge.payoff, null)
    assert.ok(edge.fromNodeId, 'planted setup 挂到已发生的拍节点')
    assert.match(edge.note, /悬而未决/u)
  }
})

test('未选候选（adopted:false 戏剧/必然）→ alternative 边留档', () => {
  const { edges } = projectOutline(seedSession(), { domain: DOMAIN })
  const alternative = edges.filter((e) => e.kind === OUTLINE_EDGE_KINDS.ALTERNATIVE)
  assert.equal(alternative.length, ROUNDS * UNADOPTED_PER_ROUND)
  for (const edge of alternative) {
    assert.equal(edge.toNodeId, '', '未选分支不指向已提交节点')
    assert.equal(edge.archived, true)
    assert.ok(edge.note.length > 0)
    assert.ok(edge.fromNodeId)
    assert.ok(edge.source === '戏剧' || edge.source === '必然', 'adopted:true 命运骰不入 alternative')
  }
})

test('导演注入事件 → node 带 decidedBy:author（普通拍不带此标记）', () => {
  const { nodes } = projectOutline(seedSession(), { domain: DOMAIN })
  const author = nodes.filter((n) => n.decidedBy === 'author')
  assert.equal(author.length, INJECT_ROUNDS.size)
  for (const node of author) assert.ok(INJECT_ROUNDS.has(node.order))
  assert.equal(nodes.find((n) => n.order === 1).decidedBy, undefined)
})

/* ---------- 2) 幂等 ---------- */

test('幂等：同一会话流 → 深度相等投影，且不改输入；{events} 包装等价', (t) => {
  const events = seedSession()
  const snapshot = JSON.stringify(events)
  const options = { domain: DOMAIN }
  const a = projectOutline(events, options)
  const b = projectOutline(events, options)
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(events), snapshot, '输入事件流未被改动（纯函数）')
  assert.deepEqual(projectOutline({ events }, options), a)

  const byKind = (kind) => a.edges.filter((e) => e.kind === kind).length
  t.diagnostic(`[形状表] version=${PROJECTOR_VERSION} ` +
    `nodes=${a.nodes.length} causes=${byKind('causes')} ` +
    `foreshadows=${byKind('foreshadows')} alternative=${byKind('alternative')} ` +
    `authorNodes=${a.nodes.filter((n) => n.decidedBy === 'author').length} ` +
    `nodeFields=${Object.keys(a.nodes[0]).join('/')} ` +
    `edgeKinds=${[...new Set(a.edges.map((e) => e.kind))].join('/')}`)
})

/* ---------- 3) 与 P2b 输入形状对称 ---------- */

test('形状对称：投影 { nodes, edges } 可直接喂 P2b migrateOutline', () => {
  const outline = projectOutline(seedSession(), { domain: DOMAIN })
  const report = migrateOutline(outline, { domain: DOMAIN, book: DOMAIN })
  assert.equal(report.ok, true, '大纲形状被迁移器接受（无硬错误）')
  assert.equal(report.entries.length, outline.nodes.length, '每个拍节点迁出一个 plot 条目')
  assert.ok(report.entries.every((entry) => entry.layer === 'plot' && entry.status === 'proposed'))

  const causal = report.entries.flatMap((entry) => entry.relations ?? []).filter((r) => r.type === 'causal')
  const causesCount = outline.edges.filter((e) => e.kind === 'causes').length
  assert.equal(causal.length, causesCount, 'causes 边 → causal 关系')

  // foreshadows/alternative 的 toNodeId 留空：迁移器如实按缺端点记账，不静默造回收节点。
  const dropped = report.losses.filter((l) => l.code === 'outline-edge-dropped')
  assert.ok(dropped.length > 0, 'payoff/分支留空的边如实进 losses[]')
})

/* ---------- 4) roundtrip：投影 → P2a extract 拆书 → 主干还原 ---------- */

/** 从 extractChapter 拼出的提示词里取出「本片段原文」区域（不含 prevTail 头部）。 */
function fragmentOfPrompt(prompt) {
  const match = /下面是小说原文的一个片段[^\n]*\n\n([\s\S]*?)\n\n【任务】/u.exec(String(prompt ?? ''))
  return match ? match[1] : ''
}

/**
 * fake LlmPort「回读章纲文本」：解析本段的 〔拍N〕 / 〔伏笔·开放〕 标记，
 * 按抽取器口径产出 JSON——拍作为 event、伏笔作为 notes 备注。
 * 忠实于拆书引擎：未选分支是作者元信息、非故事事件，不回读（这是如实损失之一）。
 */
function readBackLlm() {
  const calls = []
  return {
    calls,
    async complete(request) {
      calls.push(request)
      const fragment = fragmentOfPrompt(request.prompt)
      const beats = [...fragment.matchAll(/〔拍(\d+)〕/gu)].map((m) => Number(m[1]))
      const foreshadows = (fragment.match(/〔伏笔·开放〕/gu) ?? []).length
      const notes = `${beats.map((n) => `〔拍${n}〕`).join('')}${'〔伏笔·开放〕'.repeat(foreshadows)}`
      const actinfo = beats.map((n) => ({ type: 'event', content: `〔拍${n}〕`, scope: ['*'] }))
      return {
        text: JSON.stringify({
          who: [],
          when: { story_time: '未明示', timeline: '顺叙' },
          where: '章纲',
          actinfo,
          notes
        })
      }
    }
  }
}

test('roundtrip：20 拍会话 → 投影 → P2a extract 拆书 → 主干还原读数与损失如实记账', async (t) => {
  const outline = projectOutline(seedSession(), { domain: DOMAIN })
  const outlineText = renderOutlineText(outline.nodes, outline.edges)

  // 章纲文本确实含三类标记（未选分支留档但拆书引擎不还原，先证明它在文本里）
  const altInText = (outlineText.match(/〔未选分支〕/gu) ?? []).length
  assert.equal(altInText, outline.edges.filter((e) => e.kind === 'alternative').length)

  const segments = segmentText(outlineText)
  const llm = readBackLlm()
  const result = await extractChapter({ text: outlineText, llm, domain: DOMAIN, chapterNo: 1 })

  assert.equal(result.ok, true, '单段抽取无失败')
  assert.equal(result.drafts.length, segments.length, '每段出一份 plot 草稿')
  assert.equal(llm.calls.length, segments.length, '每段一次模型调用（无重试）')

  // 还原事件集：从草稿 fact 里回读拍序 / 伏笔标记
  const recoveredSeqs = []
  let foreshadowRecovered = 0
  let alternativeRecovered = 0
  for (const draft of result.drafts) {
    const fact = String(draft.fact ?? '')
    for (const m of fact.matchAll(/〔拍(\d+)〕/gu)) recoveredSeqs.push(Number(m[1]))
    foreshadowRecovered += (fact.match(/〔伏笔·开放〕/gu) ?? []).length
    alternativeRecovered += (fact.match(/〔未选分支〕/gu) ?? []).length
  }

  const originalSeqs = outline.nodes.map((n) => n.order)
  const recoveredSet = [...new Set(recoveredSeqs)].sort((a, b) => a - b)
  const causalOrderPreserved = recoveredSeqs.every((v, i) => i === 0 || v > recoveredSeqs[i - 1])
  const openTotal = outline.edges.filter((e) => e.kind === 'foreshadows' && e.open).length
  const altTotal = outline.edges.filter((e) => e.kind === 'alternative').length

  const reading = {
    nodeNames: {
      total: originalSeqs.length,
      recovered: recoveredSet.length,
      rate: `${recoveredSet.length}/${originalSeqs.length}`
    },
    causalOrder: { preserved: causalOrderPreserved, recoveredSeqs },
    foreshadowOpen: { total: openTotal, recovered: foreshadowRecovered },
    alternative: { total: altTotal, recovered: alternativeRecovered },
    losses: [
      '显式边图不还原：extract 产出逐段独立 plot 草稿，不是 events/edges 图；只保住拍的线性顺序',
      '未选分支（alternative）不还原：作者元信息，非故事事件，拆书引擎不回读',
      '伏笔只回读为开放标记，payoff 仍留空、无回收节点',
      'status 降为 draft，provenance 只存 quote_hash（不存章纲原文），decidedBy/pov/runId 不还原'
    ]
  }
  t.diagnostic(`[roundtrip 还原读数] ${JSON.stringify(reading)}`)

  // 主干断言：节点名集全量、因果序保住、伏笔 open 数还原；未选分支如实记为损失
  assert.deepEqual(recoveredSet, originalSeqs, '节点名集（拍序）全量还原')
  assert.equal(causalOrderPreserved, true, '因果序（拍递增）保住')
  assert.equal(foreshadowRecovered, openTotal, '伏笔 open 数还原')
  assert.ok(alternativeRecovered < altTotal, '未选分支如实记为损失（不静默冒充还原）')
})
