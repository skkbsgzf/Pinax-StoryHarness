import test from 'node:test'
import assert from 'node:assert/strict'
import { segmentText, splitBuckets, segmentStats, toChapterNumber } from '../fact/domain/segmentBuckets.js'
import { detectPerspective, normalizeTitleName, isIdentityTitle, perspectiveContextOf } from '../fact/usecases/pipeline/perspectiveTitles.js'
import { identityRank, resolveIdentity, mergeIdentity, pickDisplayName, IDENTITY_RANK } from '../fact/usecases/pipeline/identityEvolution.js'

/**
 * 作者 2026-11-12 三条裁定的合同测试：
 *
 * 1) **分桶分段**：「优先按照桶的原理，一段一段文字放，优先保证完整章节」
 *    → 章为桶，段不跨章；一章末尾偏短也不并到下一章。
 * 2) **视角参数**：「Agent 扫文章时代入读者身份，文本本体带视角参数」
 *    → 第一人称下「男友」「妈妈」这类称谓即身份，不必等真名。
 * 3) **身份演进**：「采集先到先得，呈现时真名 > 昵称 > 视角关系」
 */

const CHAPTERED = [
  '第1章 开头',
  '',
  '　　这是第一章的正文。'.repeat(20),
  '',
  '第2章 转折',
  '',
  '　　这是第二章的正文。'.repeat(20),
  '',
  '第3章 结尾',
  '',
  '　　很短。'
].join('\n')

test('〔B1〕分桶：按章节标记切桶，章号解析正确', () => {
  const buckets = splitBuckets(CHAPTERED)
  assert.equal(buckets.length, 3, '三章三个桶')
  assert.deepEqual(buckets.map((bucket) => bucket.chapterNo), [1, 2, 3])
  assert.deepEqual(buckets.map((bucket) => bucket.title), ['第1章 开头', '第2章 转折', '第3章 结尾'])
})

test('〔B2〕分桶：中文数字章号也能解析', () => {
  assert.equal(toChapterNumber('十二'), 12)
  assert.equal(toChapterNumber('二十三'), 23)
  assert.equal(toChapterNumber('一百零五'), 105)
  assert.equal(toChapterNumber('7'), 7)
  assert.equal(toChapterNumber('不是数字'), null)
})

test('〔B3〕段不跨章：每段只属于一个章', () => {
  const units = segmentText(CHAPTERED)
  assert.ok(units.length >= 3)
  const chapters = new Set(units.map((unit) => unit.chapterNo))
  assert.deepEqual([...chapters].sort((a, b) => a - b), [1, 2, 3], '三段分布到三章')
  // 每段正文里不应出现第二个章标记
  for (const unit of units) {
    const marks = unit.text.match(/^第\s*\d+\s*章/gmu) ?? []
    assert.ok(marks.length <= 1, `段内出现多个章标记：${unit.text.slice(0, 40)}`)
  }
})

test('〔B4〕章末偏短不跨桶合并（宁可短，不缝章）', () => {
  const units = segmentText(CHAPTERED)
  const last = units[units.length - 1]
  assert.equal(last.chapterNo, 3)
  assert.ok(last.chars < 100, '第三章只有「很短。」，如实偏短')
  // 它没有把第二章内容缝进来
  assert.ok(!last.text.includes('第二章的正文'))
})

test('〔B5〕无章节标记时整篇一个桶', () => {
  const plain = '　　没有任何章节标记的正文。'.repeat(30)
  const buckets = splitBuckets(plain)
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].chapterNo, null)
  assert.equal(segmentStats(segmentText(plain)).buckets, 1)
})

test('〔B6〕段文本是原文切片（可逐字溯源）', () => {
  const raw = CHAPTERED
  for (const unit of segmentText(raw)) {
    // 段文本可能被 trim 过首尾空白，但内容必须能在原文里找到
    assert.ok(raw.includes(unit.text), `段不在原文里：${JSON.stringify(unit.text.slice(0, 40))}`)
  }
})

test('〔P1〕视角判定：第一人称 vs 第三人称', () => {
  const first = '我推开门。我看着他说：你来了。我想了想，还是决定不告诉他。'.repeat(10)
  const third = '他推开门。他看着她说：你来了。他想了想，还是决定不告诉她。'.repeat(10)
  assert.equal(detectPerspective(first).perspective, 'first')
  assert.equal(detectPerspective(third).perspective, 'third')
})

test('〔P2〕称谓归一：「我的男友」→「男友」', () => {
  assert.equal(normalizeTitleName('我的男友'), '男友')
  assert.equal(normalizeTitleName('我妈妈'), '妈妈')
  assert.equal(normalizeTitleName('她的闺蜜'), '闺蜜')
  assert.equal(normalizeTitleName('林逸'), '林逸')
})

test('〔P3〕称谓即身份：常见关系称谓都合法', () => {
  for (const title of ['男友', '妈妈', '闺蜜', '上司', '房东', '前男友', '未婚妻']) {
    assert.equal(isIdentityTitle(title), true, `${title} 应该可以作身份`)
  }
  assert.equal(isIdentityTitle('林逸'), false, '真名不是称谓')
})

test('〔P4〕第一人称段：称谓被识别为可确立身份', () => {
  const context = perspectiveContextOf({ text: '末世第一天，男友推了推我，着急道：快付款呀。' })
  assert.equal(context.perspective, 'third', '单段算不出第一人称（需要全书）')
  assert.ok(context.titles.includes('男友'), '段内称谓要被抓到')

  const withGlobal = perspectiveContextOf(
    { text: '男友推了推我。' },
    { perspective: { perspective: 'first' } }
  )
  assert.equal(withGlobal.perspective, 'first')
})

test('〔I1〕身份权重：真名 > 昵称 > 称谓', () => {
  assert.equal(identityRank('林逸').rank, IDENTITY_RANK.name)
  assert.equal(identityRank('小柯').rank, IDENTITY_RANK.alias)
  assert.equal(identityRank('老李').rank, IDENTITY_RANK.alias)
  assert.equal(identityRank('男友', { isTitle: true }).rank, IDENTITY_RANK.title)
  assert.ok(IDENTITY_RANK.name > IDENTITY_RANK.alias)
  assert.ok(IDENTITY_RANK.alias > IDENTITY_RANK.title)
})

test('〔I2〕先到先得：只有称谓时就用称谓当身份', () => {
  const state = resolveIdentity([{ name: '男友', isTitle: true }])
  assert.equal(state.displayName, '男友', '第一人称里称谓就是身份，不必等真名')
  assert.deepEqual(state.aliases, [])
})

test('〔I3〕后续补全：真名出现后升级显示名，称谓降别名', () => {
  const state = resolveIdentity([
    { name: '男友', isTitle: true },   // 先出现
    { name: '林逸' }                    // 后来才给真名
  ])
  assert.equal(state.displayName, '林逸', '真名压过称谓')
  assert.deepEqual(state.aliases, ['男友'], '旧称谓保留为别名，历史引用不断')
})

test('〔I4〕真名先到时不被称谓顶掉', () => {
  const state = resolveIdentity([{ name: '林逸' }, { name: '男友', isTitle: true }])
  assert.equal(state.displayName, '林逸')
  assert.ok(state.aliases.includes('男友'))
})

test('〔I5〕同 rank 取先到（确定性）', () => {
  const state = mergeIdentity({ displayName: '林逸', aliases: [] }, '沈岚')
  assert.equal(state.displayName, '林逸', '同为真名时先到者保持')
  assert.deepEqual(state.aliases, ['沈岚'])
})

test('〔I6〕挑显示名：真名 > 昵称 > 称谓，且都进别名', () => {
  const picked = pickDisplayName([
    { name: '男友', order: 0, isTitle: true },
    { name: '小柯', order: 1 },
    { name: '林逸', order: 2 }
  ])
  assert.equal(picked.displayName, '林逸')
  assert.deepEqual(picked.aliases.sort(), ['小柯', '男友'].sort())
})

/* ---------- 代词 → 实体映射（作者 2026-11-12 视角裁定） ---------- */

import { resolvePronoun } from '../fact/usecases/pipeline/pronounResolve.js'
import { detectFirstPersonProtagonist, normalizeVocativeToName } from '../fact/usecases/pipeline/protagonistDetect.js'
import { collectNameCandidates } from '../fact/usecases/pipeline/nameCandidates.js'

test('〔R1〕第一人称「我」映射到主角真名', () => {
  const ctx = { perspective: 'first', protagonist: '沈岚', others: ['林逸'] }
  assert.deepEqual(resolvePronoun('我', ctx), { name: '沈岚', mapped: true, reason: 'first-person-protagonist' })
})

test('〔R2〕第一人称无主角名时保留「我」（称谓即身份）', () => {
  const result = resolvePronoun('我', { perspective: 'first', protagonist: null })
  assert.equal(result.name, '我')
  assert.equal(result.mapped, true)
})

test('〔R3〕第三人称「他」：唯一候选取之，多候选不猜', () => {
  const unique = resolvePronoun('他', { perspective: 'first', protagonist: '沈岚', others: ['林逸'] })
  assert.equal(unique.name, '林逸')
  const ambiguous = resolvePronoun('他', { perspective: 'first', protagonist: '沈岚', others: ['林逸', '顾茵'] })
  assert.equal(ambiguous.name, '')
  assert.equal(ambiguous.mapped, false)
})

test('〔R4〕复合称谓归一：我爸 → 爸爸', () => {
  assert.equal(resolvePronoun('我爸', { perspective: 'first' }).name, '爸爸')
  assert.equal(resolvePronoun('我妈', { perspective: 'first' }).name, '妈妈')
  assert.equal(resolvePronoun('我的闺蜜', { perspective: 'first' }).name, '闺蜜')
})

test('〔R5〕主角识别：别人直呼的那个名字（不是出现最多的）', () => {
  const text = [
    '我叫沈岚。',
    '“沈岚，你也在啊。”林逸说。',
    '“沈岚你发什么疯！”',
    '林逸说完就走了。林逸很生气。林逸走了。'
  ].join('\n')
  const stats = collectNameCandidates(text)
  const detected = detectFirstPersonProtagonist(text, stats)
  assert.equal(detected.name, '沈岚', '被直呼的才是叙述者，不是高频的那个')
  assert.equal(detected.reason, 'vocative')
})

test('〔R6〕称呼形式归一到真名：余律师 → 余欢', () => {
  const text = '“余律师你回来了？”\n余欢说。余欢笑了。余欢走了。余欢坐下。余欢起身。'
  const stats = collectNameCandidates(text)
  assert.equal(normalizeVocativeToName('余律师', stats).name, '余欢')
})
