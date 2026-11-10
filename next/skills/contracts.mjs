/**
 * 随包五张编剧技能卡的数据契约（ADR P3）。
 *
 * 为什么是「集中注册表」而不是随卡 `.contract` 导出：
 *   · 契约是**结构化数据**，不是方法正文的一部分——塞进 markdown 的 frontmatter 只能表达扁平字符串，
 *     而 requires.spans／produces 的白名单需要嵌套对象与数组；
 *   · 装载层（loadSkills）按技能名查一次即可校验，作者导入的第三方包不写契约也照样能装（缺省 null，
 *     向后兼容），不会因为「没登记」而被拒；
 *   · 校验器在 next/fact/usecases/skillContract.js（纯域件），这里只做登记与冻结，
 *     不在技能目录里长第二套校验逻辑。
 *
 * 写法约定：
 *   · requires.layers 只认 fact 三层（worldview／character／plot）；style 按 ADR S1 已解耦，
 *     文风约束走能力包，不在层词表里——chapter-rewrite 的「文风约束」在 SKILL.md 的数据契约段注明，
 *     由装配方另行补投影；
 *   · produces 的非条目产物（违规清单／关系边／场景骨架）用 nonEntry＋output 声明，
 *     它们不进 fact store，但仍要过契约白名单，不能被当成条目悄悄落库。
 */

import { defineSkillContract } from '../fact/usecases/skillContract.js'

/** 五张卡的名字必须与 next/skills/<name>/SKILL.md 的目录名一致（装载层会再核一次）。 */
export const SKILL_CONTRACTS = Object.freeze({
  // 正文来源由受控文件工具读取；不要求先有事实包才能从零开抽。
  'fact-extract': defineSkillContract({
    skill: 'fact-extract',
    requires: { layers: ['worldview', 'character', 'plot'] },
    produces: [
      { layer: 'plot', asStatus: 'draft', mode: 'analyze' },
      { layer: 'character', asStatus: 'proposed', mode: 'analyze' },
      { layer: 'worldview', asStatus: 'proposed', mode: 'analyze' }
    ]
  }),
  // 一致性检测：读全库三层投影，产出违规清单（非条目）——不改事实库。
  'fact-consistency': defineSkillContract({
    skill: 'fact-consistency',
    requires: { layers: ['worldview', 'character', 'plot'] },
    produces: [{ nonEntry: 'consistency-findings', output: 'checklist' }]
  }),
  /**
   * 章节改写：需要当前章的剧情事件＋前后跨度、在场角色锚点，产出正文增量（plot 草稿）
   * 与「因新设定触发而新增」的世界观提案（proposed，不直写 adopted）。
   */
  'chapter-rewrite': defineSkillContract({
    skill: 'chapter-rewrite',
    requires: {
      layers: ['plot', 'character'],
      spans: { current: true, before: 1, after: 1 },
      knowledgeOf: 'cast'
    },
    produces: [
      { layer: 'plot', asStatus: 'draft', mode: 'author' },
      { layer: 'worldview', asStatus: 'proposed', mode: 'author' }
    ]
  }),

  /**
   * 连续性核对：双时间轴＋知情矩阵＋有效性区间都要看到，产物是「一致性违规清单」——
   * 包装 precheck 的非条目结果，不落 fact store。
   */
  'continuity-check': defineSkillContract({
    skill: 'continuity-check',
    requires: {
      layers: ['worldview', 'character', 'plot'],
      spans: { current: true },
      knowledgeOf: 'cast'
    },
    produces: [
      { nonEntry: 'violation-list', output: 'checklist' }
    ]
  }),

  /**
   * 大纲重构：吃剧情事件图，产出 plot 提案与关系边（关系边是非条目产物）。
   * structureTemplates 目前不在事实包投影里（见 SKILL.md 数据契约段的限制说明）。
   */
  'outline-restructure': defineSkillContract({
    skill: 'outline-restructure',
    requires: {
      layers: ['plot']
    },
    produces: [
      { layer: 'plot', asStatus: 'proposed', mode: 'author' },
      { nonEntry: 'relation-edges', output: 'proposal' }
    ]
  }),

  /**
   * 场景扩写：吃当前场景投影与在场人物知情（事实包在查询时点已按 ledger 裁剪），
   * 产出场景骨架（非条目）＋情节提案（proposed）。
   */
  'scene-expand': defineSkillContract({
    skill: 'scene-expand',
    requires: {
      layers: ['plot', 'character'],
      spans: { current: true },
      knowledgeOf: 'cast'
    },
    produces: [
      { nonEntry: 'scene-skeleton', output: 'proposal' },
      { layer: 'plot', asStatus: 'proposed', mode: 'author' }
    ]
  }),

  /**
   * 世界书重整：只看世界观层、全槽位投影（不写 slots＝不限槽位），产出重组后的世界观提案。
   */
  'worldbook-refactor': defineSkillContract({
    skill: 'worldbook-refactor',
    requires: {
      layers: ['worldview']
    },
    produces: [
      { layer: 'worldview', asStatus: 'proposed', mode: 'author' }
    ]
  })
})
