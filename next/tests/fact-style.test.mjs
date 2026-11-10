import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStyleProfile,
  pickStyleSamples,
  styleSpecFromProfile,
  suggestLayers,
  STYLE_PROFILE_VERSION,
  STYLE_LAYERS
} from '../fact/usecases/render/styleProfile.js'
import { normalizeStyleSpec, styleSpecHash } from '../fact/usecases/render/prose.js'

/**
 * P-STYLE 合同测试：文风实例化。
 *
 * 三条口径各有一组断言：
 *   1) 只认材料里出现的数字——抽不到就进 missing，绝不拿默认值冒充「解出来的」；
 *   2) 区间推导可复核——每一步写进 derivation，作者能查这个区间怎么来的；
 *   3) 长篇只蒸部分、用户可选——suggestLayers 按语料规模给建议，styleSpecFromProfile 按层装配。
 *
 * 另钉版权红线：profile 只含统计量与短约束短语，不含任何原文 prose；
 * samples 只能从调用方传入的语料里挑，不传就是空（不编代表句）。
 */

/** 与真实蒸馏产物同形的夹具（数字与措辞照 异兽迷城-彭湃 那份，句子已改写）。 */
const LANGUAGE_DNA = `# 语言 DNA · 示例

| 指标 | 数值 | 解读 |
|---|---|---|
| 平均句长 | 23.4 字 | 中短 |
| 短句 ≤15 字占比 | 43.5% | 近半句是短句 |
| 段均字数 | 29.4 字 | 段极短 |

- 落刀规则：一句一动作成段。
- 忌：连续三句以上等长的长句；书面语复句套嵌。

- 强指纹：**「……」独占一行 = 场景/时空切换符**（现实↔梦境↔回忆之间）。复刻必留。
`

const WRITING_DNA = `# Writing-DNA · 示例

1. **短句＋一拍一段**：禁连续三句等长复句。
2. **对话驱动**：对白约占 1/4，配「说道/问道」＋神态。
3. 设定投放：禁开篇设定说明书。
   - 单独一行「……」= 场景/时空切换符，**必留**；
`

const STRUCTURE = `# 结构模板

## 一、单章骨架

\`\`\`
[场景落位：白描时间/地点/感官]
  → 对话或动作推进：短段连击
[章内转折 or 信息揭示]
  → 章末钩：停在新疑问，不做总结升华
\`\`\`
`

const PERSPECTIVE = `# 视角与认知

## L3 叙事视角与切入

- **紧贴主角的限制第三人称**为主，高频点名保证不迷向
- 穿插配角 POV 承担情感爆点，但不借配角之口做全知解说
- 切入偏「事件中途」：不从背景讲起

## L4 细节取材

- 生活物什做时代与情绪锚
`

function fixture(overrides = {}) {
  return {
    name: '示例文风',
    languageDna: LANGUAGE_DNA,
    writingDna: WRITING_DNA,
    structureTemplate: STRUCTURE,
    perspective: PERSPECTIVE,
    ...overrides
  }
}

test('版本与分层键：三层 L1/L2/L3-5', () => {
  assert.equal(STYLE_PROFILE_VERSION, 'style-profile/v1')
  assert.deepEqual([...STYLE_LAYERS], ['L1', 'L2', 'L3-5'])
})

test('只认出现的数字：四个统计量全部从表格/正文抽出，missing 为空', () => {
  const profile = parseStyleProfile(fixture())
  assert.equal(profile.ok, true)
  assert.equal(profile.metrics.avgSentenceChars, 23.4)
  assert.equal(profile.metrics.avgParagraphChars, 29.4)
  assert.equal(profile.metrics.shortSentenceRatio, 43.5)
  assert.deepEqual(profile.missing, [], '四类产出都抽到了，不该有 missing')
})

test('抽不到就进 missing，绝不拿默认值冒充解出来的', () => {
  const profile = parseStyleProfile({ name: '空材料' })
  assert.ok(profile.missing.includes('avgSentenceChars'))
  assert.ok(profile.missing.includes('avgParagraphChars'))
  assert.ok(profile.missing.includes('structure.skeleton'))
  assert.ok(profile.missing.includes('perspective.rules'))
  assert.deepEqual(profile.targets, {}, '一个数字都没有时 targets 必须为空，不能塞默认区间')
  assert.equal(profile.metrics.avgSentenceChars, null)
})

test('区间推导可复核：每个区间都写清怎么算来的', () => {
  const profile = parseStyleProfile(fixture())
  assert.deepEqual(profile.targets.sentenceChars, [12, 40])
  assert.match(profile.derivation.sentenceChars, /23\.4/)
  assert.match(profile.derivation.sentenceChars, /× 1\.7/)
  assert.ok(profile.targets.paragraphChars[0] >= 10)
  assert.match(profile.derivation.paragraphChars, /29\.4/)
  assert.deepEqual(profile.targets.dialogueRatio, [0.15, 0.4])
})

test('禁则与硬要求两份产物都扫：「忌：」与行内「禁…」都抽到，碎片被过滤', () => {
  const profile = parseStyleProfile(fixture())
  const forbidden = profile.constraints.forbidden.join(' | ')
  assert.match(forbidden, /连续三句以上等长的长句/, '语言DNA 的「忌：」条目要抽到')
  assert.match(forbidden, /书面语复句套嵌/)
  assert.match(forbidden, /禁开篇设定说明书/, 'Writing-DNA 的行内禁则也要抽到')
  assert.ok(profile.constraints.required.length >= 1)
  assert.match(profile.constraints.required.join(' | '), /场景\/时空切换符/)
  assert.ok(!profile.constraints.required.some((item) => item.length < 4), '不留碎片')
})

test('结构骨架与视角纪律：L2 骨架抽代码块，L3 抽该节句子', () => {
  const profile = parseStyleProfile(fixture())
  assert.match(profile.structure.skeleton, /场景落位/)
  assert.match(profile.structure.skeleton, /章末钩/)
  assert.ok(profile.perspective.rules.length >= 2)
  assert.match(profile.perspective.rules.join(' | '), /限制第三人称/)
  assert.ok(!profile.perspective.rules.some((rule) => rule.startsWith('#')), '标题不进纪律清单')
})

test('版权红线：profile 只含统计量与短约束短语，不含原文 prose', () => {
  const profile = parseStyleProfile(fixture())
  const serialized = JSON.stringify(profile)
  assert.ok(!serialized.includes('一句一动作成段'), '长解释句不该整段进 profile')
  assert.ok(!serialized.includes('落刀规则'), 'markdown 标签不该进 profile')
  // 所有约束都是可执行的短语，不是成段叙述
  for (const item of [...profile.constraints.forbidden, ...profile.constraints.required]) {
    assert.ok(item.length <= 80, `约束过长（${item.length} 字）：${item}`)
  }
  assert.equal(profile.samples, undefined, 'profile 本身不带 samples（代表句只从调用方语料挑）')
})

test('samples 只从传入语料挑：不传就是空并说明原因，绝不编代表句', () => {
  const empty = pickStyleSamples([])
  assert.deepEqual(empty.samples, [])
  assert.match(empty.note, /没有传入语料|为空/)

  const texts = [
    '第一句很短。第二句稍微长一点点，但也不超过上限。\n第三句话在这里出现，用来当代表句。',
    '第01章 章节标题不该被选中。另一句正常的叙述句子出现了。'
  ]
  const picked = pickStyleSamples(texts, { limit: 3 })
  assert.ok(picked.samples.length > 0)
  assert.ok(picked.samples.length <= 3)
  assert.ok(!picked.samples.some((item) => /^第?\s*\d+\s*[章节]/u.test(item)), '章名/目录行要排除')
  assert.match(picked.note, /句长中值/)
})

test('styleSpec 形状与渲染器对齐：normalizeStyleSpec 能吃，hash 稳定', () => {
  const profile = parseStyleProfile(fixture())
  const spec = styleSpecFromProfile(profile, { samples: ['代表句一。', '代表句二。'] })
  const normalized = normalizeStyleSpec(spec)
  assert.equal(normalized.name, '示例文风')
  assert.deepEqual(normalized.targets.sentenceChars, [12, 40])
  assert.equal(normalized.samples.length, 2)
  assert.ok(normalized.constraints.forbidden.length > 0)
  assert.equal(styleSpecHash(spec), styleSpecHash(styleSpecFromProfile(profile, { samples: ['代表句一。', '代表句二。'] })), '同输入同 hash（可重渲染）')
})

test('长篇只蒸部分、用户可选：按层装配，只挂 L1 时不带结构/视角', () => {
  const profile = parseStyleProfile(fixture())
  const l1Only = styleSpecFromProfile(profile, { layers: ['L1'] })
  assert.deepEqual(l1Only.layers, ['L1'])
  assert.ok(l1Only.targets.sentenceChars, 'L1 带目标区间')
  assert.ok(l1Only.constraints.forbidden.length > 0, 'L1 带禁则')
  assert.ok(!l1Only.constraints.required.some((item) => /场景落位|限制第三人称/u.test(item)), '只挂 L1 时不该混进结构与视角')

  const full = styleSpecFromProfile(profile)
  assert.equal(full.layers, undefined, '全挂时不打 layers 标记（它就是全量）')
  assert.ok(full.constraints.required.some((item) => /限制第三人称|场景\/时空切换符/u.test(item)))
})

test('语料规模建议按统计稳定性给，不是主观偏好', () => {
  const small = suggestLayers({ chapters: 5, chars: 12_000 })
  assert.deepEqual(small.layers, ['L1'])
  assert.equal(small.scope, 'minimal')
  const medium = suggestLayers({ chapters: 80, chars: 200_000 })
  assert.deepEqual(medium.layers, ['L1', 'L2'])
  assert.equal(medium.scope, 'partial')
  const large = suggestLayers({ chapters: 1306, chars: 3_040_000 })
  assert.deepEqual(large.layers, ['L1', 'L2', 'L3-5'])
  assert.equal(large.scope, 'full')
})

test('确定性：同材料两次解析得同一 id 与 digest（可直接当缓存键）', () => {
  const a = parseStyleProfile(fixture())
  const b = parseStyleProfile(fixture())
  assert.equal(a.id, b.id)
  assert.equal(a.digest, b.digest)
  // 材料变了 digest 必须变（否则重渲染会拿到旧缓存）
  const changed = parseStyleProfile(fixture({ languageDna: LANGUAGE_DNA.replace('23.4 字', '30.1 字') }))
  assert.notEqual(changed.digest, a.digest)
})

/* ---------- 随仓档案（novel-style-profiles/*.json）：形状与版权纪律 ---------- */

test('档案校验：samples 非空即报错（第三方原文不入仓），schema 必须对', async () => {
  const { validateStyleProfileDocument, STYLE_PROFILE_SCHEMA } = await import('../fact/usecases/render/styleProfileDoc.js')
  assert.equal(STYLE_PROFILE_SCHEMA, 'pinax-style-profile/v1')

  const good = validateStyleProfileDocument({
    $schema: STYLE_PROFILE_SCHEMA,
    profile: { name: '示例', targets: {}, constraints: {}, missing: [] },
    spec: { name: '示例', targets: {}, constraints: {}, samples: [] },
    samplePolicy: { inRepo: false }
  })
  assert.equal(good.ok, true, JSON.stringify(good.errors))

  const withProse = validateStyleProfileDocument({
    $schema: STYLE_PROFILE_SCHEMA,
    profile: { name: '示例', targets: {}, constraints: {}, missing: [] },
    spec: { name: '示例', targets: {}, constraints: {}, samples: ['一句原文'] }
  })
  assert.equal(withProse.ok, false)
  assert.match(withProse.errors.join(' | '), /samples 有 1 条/)

  const wrongSchema = validateStyleProfileDocument({ $schema: 'nope', profile: {}, spec: {} })
  assert.equal(wrongSchema.ok, false)
  assert.match(wrongSchema.errors.join(' | '), /pinax-style-profile\/v1/u)
})

test('档案取 spec：本地 samples 叠上去、按层裁剪结构/视角约束', async () => {
  const { styleSpecFromDocument } = await import('../fact/usecases/render/styleProfileDoc.js')
  const doc = {
    $schema: 'pinax-style-profile/v1',
    profile: { name: '示例', targets: { sentenceChars: [12, 40] }, constraints: { forbidden: ['禁长复句'], required: [] }, missing: [] },
    spec: {
      name: '示例',
      targets: { sentenceChars: [12, 40] },
      constraints: {
        forbidden: ['禁长复句'],
        required: ['「……」独占一行 = 场景切换符', '[场景落位：白描时间/地点]', '紧贴主角的限制第三人称，读者信息 ≤ 主角']
      },
      samples: []
    },
    samplePolicy: { inRepo: false }
  }
  const full = styleSpecFromDocument(doc, { samples: ['本地现取的一句。'] })
  assert.equal(full.ok, true)
  assert.deepEqual(full.spec.samples, ['本地现取的一句。'], '代表句只从调用方来')
  assert.equal(full.spec.constraints.required.length, 3)

  const l1 = styleSpecFromDocument(doc, { layers: ['L1'] })
  assert.equal(l1.ok, true)
  assert.deepEqual(l1.spec.layers, ['L1'])
  assert.ok(!l1.spec.constraints.required.some((item) => /场景落位/u.test(item)), 'L2 结构约束被摘掉')
  assert.ok(!l1.spec.constraints.required.some((item) => /限制第三人称/u.test(item)), 'L3 视角约束被摘掉')
  assert.ok(l1.spec.constraints.required.some((item) => /场景切换符/u.test(item)), '纯写作纪律保留（不属于结构/视角层）')
})

test('随仓档案实件可校验：异兽迷城-彭湃 形状合格且不含原文 prose', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { validateStyleProfileDocument } = await import('../fact/usecases/render/styleProfileDoc.js')
  const dir = new URL('../fact/packs/novel-style-profiles/', import.meta.url)
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'))
  assert.ok(files.length >= 1, '随仓档案至少一份')
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(dir.pathname.replace(/^\/([A-Za-z]:)/u, '$1'), file), 'utf8'))
    const checked = validateStyleProfileDocument(doc)
    assert.equal(checked.ok, true, `${file}: ${checked.errors.join(' | ')}`)
    assert.equal(doc.spec.samples.length, 0, `${file} 不许带原文代表句`)
    assert.ok(doc.profile.metrics.avgSentenceChars > 0, `${file} 该有句长统计`)
    assert.ok(doc.profile.targets.sentenceChars.length === 2, `${file} 该有句长区间`)
    assert.ok(doc.profile.constraints.forbidden.length >= 1, `${file} 该有禁则`)
  }
})
