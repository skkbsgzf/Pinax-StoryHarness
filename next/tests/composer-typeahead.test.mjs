import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMPOSER_ITEM_KINDS,
  COMPOSER_PER_GROUP_LIMIT,
  COMPOSER_TRIGGERS,
  applyComposerToken,
  buildComposerMenu,
  detectComposerToken,
  extractSkillToken,
  skillNameList
} from '../shell/composerTypeahead.mjs'
import { REFERENCE_KIND_LABELS, REFERENCE_KIND_ORDER } from '../shell/agentReferences.mjs'
import { SLASH_COMMANDS } from '../shell/slashCommands.mjs'

/** 技能清单夹具：形状照 agentRuntime 的 skills().catalog（name + description）。 */
const SKILLS = [
  { name: 'chapter-rewrite', description: '重写这一章的场次节奏' },
  { name: 'scene-expand', description: '把这段戏展开' },
  { name: 'worldbook-refactor', description: '整理世界书条目' }
]

test('〔批次77 任务3〕触发符与菜单项 kinds 是闭集（长出第六类要先改工单）', () => {
  assert.deepEqual([...COMPOSER_TRIGGERS], ['/', '@', '#'])
  assert.deepEqual([...COMPOSER_ITEM_KINDS], ['command', 'skill', 'reference', 'role'])
  assert.ok(Number.isSafeInteger(COMPOSER_PER_GROUP_LIMIT) && COMPOSER_PER_GROUP_LIMIT > 0)
})

test('〔批次77 任务3〕前导边界：只有行首或空白后的 / @ # 才算 token（中文正文中段不误触）', () => {
  assert.deepEqual(detectComposerToken('/'), { trigger: '/', query: '', start: 0, end: 1 })
  assert.equal(detectComposerToken('看看 /审', 6)?.trigger, '/')
  // 工单点名的负断言：「第3/章」里那个斜杠前面是数字，不许唤出菜单。
  assert.equal(detectComposerToken('第3/章', 4), null, '数字后面的 / 不是 token')
  assert.equal(detectComposerToken('我去看了/然后', 7), null, '汉字后面的 / 不是 token')
  assert.equal(detectComposerToken('a@b', 2), null, '行中的 @ 是邮箱，不是引用')
  // 换行也算边界（多行草稿的第二行行首）。
  assert.equal(detectComposerToken('第一行\n#', 5)?.trigger, '#')
  // 段里再出现一个触发符＝不是同一个 token（@a/b 那种一手打歪的）。
  assert.equal(detectComposerToken('@a/b', 4), null)
  // 已经插好的 @《标题》 是成品，光标停在它后面不该再把菜单顶出来。
  assert.equal(detectComposerToken('@《开篇》', 5), null, '书名号是 token 的终止符')
  assert.equal(detectComposerToken('', 0), null)
})

test('〔批次77 任务3〕光标位置决定 token 区间（越界的 caret 夹进范围内，不越读写不出）', () => {
  const draft = '把 /scene 这段改写一下'
  // 索引：0把 1␣ 2/ 3s 4c 5e 6n 7e 8␣ —— 光标紧跟在 scene 后面就是 8。
  const token = detectComposerToken(draft, 8)
  assert.equal(token?.trigger, '/')
  assert.equal(token?.query, 'scene')
  assert.equal(token?.start, 2)
  assert.equal(token?.end, 8)
  // caret 给到超出末尾：夹到实际长度——事件里带的 selectionStart 晚一步就可能越过草稿。
  assert.equal(detectComposerToken('/ch', 99)?.end, 3)
  assert.equal(detectComposerToken('/ch', 99)?.query, 'ch')
  assert.equal(detectComposerToken('/ch', -5), null, '负数夹到开头：那一段是空，不是 token')

  // 光标停在 token 中间（作者回头改前面的字）：只看光标前那一段，后半句不参与判定。
  assert.equal(detectComposerToken('/scene-expand', 6)?.query, 'scene')
})

test('〔批次77 任务3〕/ 一个菜单吃两类：命令在前、技能在后，都按 query 过滤', () => {
  const menu = buildComposerMenu({ trigger: '/', query: '', commands: SLASH_COMMANDS, skills: SKILLS })
  assert.deepEqual(menu.groups.map((group) => group.kind), ['command', 'skill'])
  assert.deepEqual(menu.groups.map((group) => group.label), ['命令', '技能'])
  // 顺序＝屏上顺序＝键盘序列（扁平 items 与 groups 一条不差）。
  assert.deepEqual(menu.items.map((item) => item.kind), menu.groups.flatMap((group) => group.items).map((item) => item.kind))
  assert.equal(menu.items.filter((item) => item.kind === 'command').length, SLASH_COMMANDS.length)
  assert.equal(menu.items.filter((item) => item.kind === 'skill').length, SKILLS.length)
  assert.deepEqual(menu.items.find((item) => item.kind === 'skill').value, '/chapter-rewrite')
  assert.equal(menu.empty, null, '有项就不许出空态')

  const filtered = buildComposerMenu({ trigger: '/', query: 'scene', commands: SLASH_COMMANDS, skills: SKILLS })
  assert.deepEqual(filtered.groups.map((group) => group.kind), ['skill'], '命令里没有 scene，那一组整组不出（不留空标题）')
  assert.deepEqual(filtered.items.map((item) => item.label), ['/scene-expand'])

  const capped = buildComposerMenu({ trigger: '/', query: '', commands: SLASH_COMMANDS, skills: Array.from({ length: 20 }, (_item, index) => ({ name: `skill-${index}` })), limit: 2 })
  assert.deepEqual(capped.groups.map((group) => group.items.length), [2, 2], '每类各截 limit 条')
})

test('〔批次77 任务3〕@ 按类分组走既有词表（章节／条目／资料／剧本），# 本批只有空态', () => {
  const references = [
    { kind: 'chapter', title: '第一章 雪' },
    { kind: 'entry', title: '雪落无声' },
    { kind: 'entry', title: '长街' },
    { kind: 'script', title: '第一集' }
  ]
  const menu = buildComposerMenu({
    trigger: '@',
    query: '',
    references,
    referenceKindOrder: REFERENCE_KIND_ORDER,
    referenceKindLabels: REFERENCE_KIND_LABELS
  })
  assert.deepEqual(menu.groups.map((group) => group.label), ['章节', '条目', '剧本'], '顺序按既有词表，空的那一类不出标题')
  assert.deepEqual(menu.items.map((item) => item.value), ['@《第一章 雪》', '@《雪落无声》', '@《长街》', '@《第一集》'])
  assert.equal(menu.items.every((item) => item.kind === 'reference'), true)

  const search = buildComposerMenu({ trigger: '@', query: '长街', references, referenceKindOrder: REFERENCE_KIND_ORDER, referenceKindLabels: REFERENCE_KIND_LABELS })
  assert.deepEqual(search.items.map((item) => item.label), ['@《长街》'])

  // 工单第 1 条：# 的角色清单要等批次78——本批只出「暂无」那一句，且它不是一枚可点的钮。
  const roles = buildComposerMenu({ trigger: '#', query: '', roles: [] })
  assert.deepEqual(roles.items, [])
  assert.equal(roles.empty.kind, 'role')
  assert.equal(roles.empty.empty, true)
  assert.match(roles.empty.label, /批次78/u)
  const withRoles = buildComposerMenu({ trigger: '#', query: '', roles: [{ name: '研究员', desc: '查伏笔' }] })
  assert.deepEqual(withRoles.items.map((item) => item.value), ['#研究员'])
  assert.equal(withRoles.empty, null)
})

test('〔批次77 任务3〕空态那句要说清为什么是空的（技能没装载就指技能库，不许一句「无结果」糊过去）', () => {
  const noSkills = buildComposerMenu({ trigger: '/', query: 'zzz', commands: SLASH_COMMANDS, skills: [] })
  assert.equal(noSkills.empty.kind, 'skill')
  assert.match(noSkills.empty.label, /技能库/u)
  const noRefs = buildComposerMenu({ trigger: '@', query: '', references: [], referenceKindOrder: REFERENCE_KIND_ORDER, referenceKindLabels: REFERENCE_KIND_LABELS })
  assert.match(noRefs.empty.label, /还没有可引用的内容/u)
  // 词表外的触发符不配拥有那一句（回 null，界面上那块整个不画）。
  assert.equal(buildComposerMenu({ trigger: '', query: '' }).empty, null)
})

test('〔批次77 任务3〕选中＝把正在敲的那一段换成 token，光标落在它后面（正文其余部分不动）', () => {
  const draft = '把 /scene 这段改写一下'
  const token = detectComposerToken(draft, 8)
  const next = applyComposerToken(draft, token, '/scene-expand')
  assert.equal(next.draft, '把 /scene-expand 这段改写一下', '后半句一个字节没丢')
  assert.equal(next.caret, 15, '光标落在替换段末尾：start 2 ＋ token 长 13')
  assert.equal(next.draft.slice(next.caret), ' 这段改写一下', '后面本来就有空格就不再补一个（补了作者得回头删）')
  // token 在行尾时也不能把后面补出个不存在的字符。
  const tail = applyComposerToken('/ch', { trigger: '/', query: 'ch', start: 0, end: 3 }, '/chapter-rewrite')
  assert.equal(tail.draft, '/chapter-rewrite ')
  assert.equal(tail.caret, tail.draft.length)
  // 没有 token（比如命令那条路径）就原样返回，不改草稿。
  assert.equal(applyComposerToken('一句话', null, '/x').draft, '一句话')
})

test('〔批次77 任务3〕技能 token：只认真装载的名字，抽出来当 skill，正文本里不留字面量', () => {
  const one = extractSkillToken('/chapter-rewrite 把这场戏重写', skillNameList(SKILLS))
  assert.equal(one.skill, 'chapter-rewrite')
  assert.equal(one.text, '把这场戏重写')
  assert.equal(one.removed, 1)

  // 命令词不是技能名：/大纲 照原样留着，交给 slashCommands 那条路由。
  const command = extractSkillToken('/大纲 这一章', skillNameList(SKILLS))
  assert.equal(command.skill, '')
  assert.equal(command.text, '/大纲 这一章')

  // 正文中段的斜杠不算（与前导边界同口径）：「第3/章」里那个 /章 不能被当 token 吃掉。
  const midText = extractSkillToken('第3/章 改一下', skillNameList(SKILLS))
  assert.equal(midText.text, '第3/章 改一下')
  assert.equal(midText.skill, '')

  const two = extractSkillToken('/chapter-rewrite /worldbook-refactor 一起办', skillNameList(SKILLS))
  assert.equal(two.skill, 'chapter-rewrite', '一轮一问一个方法：取第一个')
  assert.equal(two.removed, 2, '第二个也得从正文里去掉，不然字面量喂给模型')
  assert.equal(two.text, '一起办')

  // 技能清单没到货（没开项目／未装载）＝一个都不抽，草稿原样走普通提问。
  const none = extractSkillToken('/chapter-rewrite 这一章', [])
  assert.equal(none.skill, '')
  assert.equal(none.text, '/chapter-rewrite 这一章')
})

test('〔批次77 任务3〕skillNameList 读得动 catalog 与 names 两种形状', () => {
  assert.deepEqual(skillNameList([{ name: 'a' }, 'b', { name: '  ' }, null]), ['a', 'b'])
  assert.deepEqual(skillNameList('不是数组'), [])
})
